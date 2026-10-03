import type { Store } from '../store'
import { TAGS, providerLabel, PROVIDER_PREFIX } from '../tags'
import { cleanBody, extractLinkDomains, htmlToText, parseAddress } from '../text'
import type { IncomingMessage } from '../types'
import { chunk, HttpError, mapLimit, type Http } from './http'
import type { ApplyResult, MailProvider, SyncHandlers, TagChange } from './types'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
/** messages.get costs 5 quota units; 250 units/s per user allows ~50/s, so 8 in flight is safe. */
const FETCH_CONCURRENCY = 8
const UPSERT_BATCH = 50

interface GmailPart {
  mimeType?: string
  filename?: string
  headers?: { name: string; value: string }[]
  body?: { data?: string; attachmentId?: string; size?: number }
  parts?: GmailPart[]
}

interface GmailMessage {
  id: string
  threadId?: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: GmailPart
}

interface HistoryRecord {
  messagesAdded?: { message: { id: string; labelIds?: string[] } }[]
  messagesDeleted?: { message: { id: string } }[]
  labelsAdded?: { message: { id: string; labelIds?: string[] }; labelIds: string[] }[]
  labelsRemoved?: { message: { id: string; labelIds?: string[] }; labelIds: string[] }[]
}

function header(part: GmailPart | undefined, name: string): string | null {
  const h = part?.headers?.find((x) => x.name.toLowerCase() === name)
  return h?.value ?? null
}

function decodePart(part: GmailPart): string {
  const data = part.body?.data
  if (!data) return ''
  const bytes = Buffer.from(data, 'base64url')
  const charset = header(part, 'content-type')?.match(/charset="?([^";\s]+)/i)?.[1] ?? 'utf-8'
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return bytes.toString('utf8')
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

interface Walked {
  plain: string | null
  html: string | null
  calendar: boolean
  attachments: boolean
}

function walk(part: GmailPart | undefined, acc: Walked = { plain: null, html: null, calendar: false, attachments: false }): Walked {
  if (!part) return acc
  const type = (part.mimeType ?? '').toLowerCase()
  const isAttachment = !!part.filename
  if (type === 'text/calendar' || part.filename?.toLowerCase().endsWith('.ics')) acc.calendar = true
  if (isAttachment && part.body?.attachmentId) acc.attachments = true
  if (!isAttachment && type === 'text/plain' && acc.plain === null) acc.plain = decodePart(part)
  if (!isAttachment && type === 'text/html' && acc.html === null) acc.html = decodePart(part)
  for (const p of part.parts ?? []) walk(p, acc)
  return acc
}

export function parseGmailMessage(msg: GmailMessage, accountEmail: string): IncomingMessage {
  const p = msg.payload
  const from = parseAddress(header(p, 'from'))
  const w = walk(p)
  // Prefer text/plain. Some senders put only a "view in browser" stub there, so for short plain
  // parts use the HTML version when it carries clearly more text.
  let text = w.plain ?? ''
  const plainLen = text.trim().length
  if (w.html && plainLen < 200) {
    const fromHtml = htmlToText(w.html)
    if (!plainLen || fromHtml.length > plainLen * 2 + 100) text = fromHtml
  }
  const labels = msg.labelIds ?? []
  return {
    providerId: msg.id,
    threadId: msg.threadId ?? null,
    fromName: from.name,
    fromAddr: from.addr,
    toAddrs: header(p, 'to'),
    subject: header(p, 'subject'),
    snippet: msg.snippet ? decodeEntities(msg.snippet) : null,
    bodyText: cleanBody(text),
    linkDomains: extractLinkDomains(w.plain, w.html),
    hasCalendarInvite: w.calendar,
    listUnsubscribe: !!header(p, 'list-unsubscribe'),
    hasAttachments: w.attachments,
    providerLabels: labels,
    receivedAt: Number(msg.internalDate) || Date.now(),
    isRead: !labels.includes('UNREAD'),
    webLink: `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountEmail)}#all/${msg.id}`
  }
}

export class GmailProvider implements MailProvider {
  constructor(
    private readonly accountId: string,
    private readonly accountEmail: string,
    private readonly http: Http,
    private readonly store: Store
  ) {}

  static async profile(http: Http): Promise<{ emailAddress: string; historyId: string }> {
    return http.json(`${API}/profile`)
  }

  async sync(cursor: string | null, sinceMs: number, h: SyncHandlers, signal?: AbortSignal): Promise<string> {
    if (cursor) {
      try {
        return await this.incremental(cursor, h, signal)
      } catch (err) {
        // historyId too old: Gmail answers 404 and we must do a full sync.
        if (!(err instanceof HttpError && err.status === 404)) throw err
      }
    }
    return this.full(sinceMs, h, signal)
  }

  private async full(sinceMs: number, h: SyncHandlers, signal?: AbortSignal): Promise<string> {
    // Read historyId first so changes made during the full sync are picked up next time.
    const { historyId } = await GmailProvider.profile(this.http)
    const q = `in:inbox after:${Math.floor(sinceMs / 1000)}`
    const seen = new Set<string>()
    let pageToken: string | undefined
    do {
      const url = `${API}/messages?q=${encodeURIComponent(q)}&maxResults=500${pageToken ? `&pageToken=${pageToken}` : ''}`
      const page = await this.http.json<{ messages?: { id: string }[]; nextPageToken?: string }>(url, undefined, signal)
      const ids = (page.messages ?? []).map((m) => m.id)
      ids.forEach((id) => seen.add(id))
      await this.fetchAndStore(ids.filter((id) => !h.exists(id)), h, signal)
      pageToken = page.nextPageToken
    } while (pageToken)
    h.keepOnly(seen)
    return historyId
  }

  private async incremental(startHistoryId: string, h: SyncHandlers, signal?: AbortSignal): Promise<string> {
    const aiLabelIds = new Set(TAGS.map((t) => this.store.getLabelId(this.accountId, providerLabel(t))).filter(Boolean))
    const added = new Set<string>()
    const removed = new Set<string>()
    const changed = new Set<string>()
    let latest = startHistoryId
    let pageToken: string | undefined
    do {
      const url = `${API}/history?startHistoryId=${startHistoryId}&maxResults=500${pageToken ? `&pageToken=${pageToken}` : ''}`
      const page = await this.http.json<{ history?: HistoryRecord[]; historyId: string; nextPageToken?: string }>(url, undefined, signal)
      for (const rec of page.history ?? []) {
        for (const a of rec.messagesAdded ?? []) {
          if (a.message.labelIds?.includes('INBOX')) added.add(a.message.id)
        }
        for (const d of rec.messagesDeleted ?? []) {
          removed.add(d.message.id)
          added.delete(d.message.id)
        }
        for (const l of rec.labelsAdded ?? []) {
          if (l.labelIds.includes('INBOX')) {
            added.add(l.message.id)
            removed.delete(l.message.id)
          } else if (!l.labelIds.every((id) => aiLabelIds.has(id))) changed.add(l.message.id)
        }
        for (const l of rec.labelsRemoved ?? []) {
          if (l.labelIds.includes('INBOX')) {
            removed.add(l.message.id)
            added.delete(l.message.id)
          } else if (!l.labelIds.every((id) => aiLabelIds.has(id))) changed.add(l.message.id)
        }
      }
      latest = page.historyId
      pageToken = page.nextPageToken
    } while (pageToken)

    if (removed.size) h.remove([...removed])
    const fresh = [...added].filter((id) => !h.exists(id))
    for (const id of added) if (h.exists(id)) changed.add(id)
    await this.fetchAndStore(fresh, h, signal)

    // Label/read-state changes only need the cheap "minimal" format.
    const known = [...changed].filter((id) => !removed.has(id) && h.exists(id))
    await mapLimit(known, FETCH_CONCURRENCY, async (id) => {
      try {
        const m = await this.http.json<GmailMessage>(`${API}/messages/${id}?format=minimal`, undefined, signal)
        const labels = m.labelIds ?? []
        if (!labels.includes('INBOX')) h.remove([id])
        else h.patch(id, { isRead: !labels.includes('UNREAD'), providerLabels: labels })
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) h.remove([id])
        else throw err
      }
    })
    return latest
  }

  private async fetchAndStore(ids: string[], h: SyncHandlers, signal?: AbortSignal): Promise<void> {
    for (const batch of chunk(ids, UPSERT_BATCH)) {
      const msgs = await mapLimit(batch, FETCH_CONCURRENCY, async (id) => {
        try {
          return await this.http.json<GmailMessage>(`${API}/messages/${id}?format=full`, undefined, signal)
        } catch (err) {
          if (err instanceof HttpError && err.status === 404) return null // deleted meanwhile
          throw err
        }
      })
      h.upsert(msgs.filter((m): m is GmailMessage => !!m).map((m) => parseGmailMessage(m, this.accountEmail)))
    }
  }

  async fetchBody(providerId: string): Promise<{ content: string; isHtml: boolean }> {
    const m = await this.http.json<GmailMessage>(`${API}/messages/${providerId}?format=full`)
    const w = walk(m.payload)
    return w.html ? { content: w.html, isHtml: true } : { content: w.plain ?? '', isHtml: false }
  }

  /** Makes sure "AI/<Tag>" labels exist and returns tag label name → id. */
  private async ensureLabels(): Promise<Map<string, string>> {
    const names = TAGS.map(providerLabel)
    const ids = new Map<string, string>()
    for (const n of names) {
      const id = this.store.getLabelId(this.accountId, n)
      if (id) ids.set(n, id)
    }
    if (ids.size === names.length) return ids

    const { labels = [] } = await this.http.json<{ labels?: { id: string; name: string }[] }>(`${API}/labels`)
    const byName = new Map(labels.map((l) => [l.name, l.id]))
    const parent = PROVIDER_PREFIX.replace(/\/$/, '')
    if (!byName.has(parent)) await this.createLabel(parent).catch(() => undefined) // nests "AI/…" in the Gmail UI
    for (const n of names) {
      const id = byName.get(n) ?? (await this.createLabel(n))
      this.store.setLabelId(this.accountId, n, id)
      ids.set(n, id)
    }
    return ids
  }

  private async createLabel(name: string): Promise<string> {
    const label = await this.http.json<{ id: string }>(`${API}/labels`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' })
    })
    return label.id
  }

  async applyTags(changes: TagChange[]): Promise<ApplyResult> {
    const result: ApplyResult = { ok: [], failed: [] }
    let labels: Map<string, string>
    try {
      labels = await this.ensureLabels()
    } catch (err) {
      return { ok: [], failed: changes.map((c) => ({ providerId: c.providerId, error: (err as Error).message })) }
    }
    const allAi = [...labels.values()]
    const byTag = new Map<string, TagChange[]>()
    for (const c of changes) byTag.set(c.tag, [...(byTag.get(c.tag) ?? []), c])

    for (const [tag, group] of byTag) {
      const addId = labels.get(providerLabel(tag as TagChange['tag']))!
      const removeIds = allAi.filter((id) => id !== addId)
      for (const part of chunk(group, 1000)) {
        try {
          await this.http.json(`${API}/messages/batchModify`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ids: part.map((c) => c.providerId), addLabelIds: [addId], removeLabelIds: removeIds })
          })
          for (const c of part) {
            const kept = c.providerLabels.filter((l) => !allAi.includes(l))
            result.ok.push({ providerId: c.providerId, providerLabels: [...kept, addId] })
          }
        } catch (err) {
          // A label deleted in Gmail leaves a stale id; forget cached ids so the next flush recreates them.
          if (err instanceof HttpError && err.status === 400) this.store.clearLabelCache(this.accountId)
          for (const c of part) result.failed.push({ providerId: c.providerId, error: (err as Error).message })
        }
      }
    }
    return result
  }
}
