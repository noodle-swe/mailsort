import { providerLabel, PROVIDER_PREFIX } from '../tags'
import { cleanBody, extractLinkDomains } from '../text'
import type { IncomingMessage } from '../types'
import { chunk, HttpError, type Http } from './http'
import type { ApplyResult, MailProvider, SyncHandlers, TagChange } from './types'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const BASE_SELECT = 'id,conversationId,subject,from,toRecipients,receivedDateTime,isRead,bodyPreview,body,hasAttachments,categories,webLink'

interface GraphRecipient {
  emailAddress?: { name?: string; address?: string }
}

interface GraphMessage {
  id: string
  '@odata.type'?: string
  '@removed'?: { reason: string }
  conversationId?: string
  subject?: string | null
  from?: GraphRecipient
  toRecipients?: GraphRecipient[]
  receivedDateTime?: string
  isRead?: boolean
  bodyPreview?: string
  body?: { contentType: 'text' | 'html'; content: string }
  hasAttachments?: boolean
  categories?: string[]
  webLink?: string
  internetMessageHeaders?: { name: string; value: string }[]
}

interface DeltaPage {
  value: GraphMessage[]
  '@odata.nextLink'?: string
  '@odata.deltaLink'?: string
}

export function parseGraphMessage(m: GraphMessage): IncomingMessage {
  const text = m.body?.content ?? ''
  const headers = m.internetMessageHeaders ?? []
  return {
    providerId: m.id,
    threadId: m.conversationId ?? null,
    fromName: m.from?.emailAddress?.name ?? null,
    fromAddr: m.from?.emailAddress?.address?.toLowerCase() ?? null,
    toAddrs:
      (m.toRecipients ?? [])
        .map((r) => r.emailAddress?.address)
        .filter(Boolean)
        .join(', ') || null,
    subject: m.subject ?? null,
    snippet: m.bodyPreview ?? null,
    bodyText: cleanBody(text),
    linkDomains: extractLinkDomains(text),
    hasCalendarInvite: (m['@odata.type'] ?? '').includes('eventMessage'),
    listUnsubscribe: headers.some((h) => h.name.toLowerCase() === 'list-unsubscribe'),
    hasAttachments: !!m.hasAttachments,
    providerLabels: m.categories ?? [],
    receivedAt: m.receivedDateTime ? Date.parse(m.receivedDateTime) : Date.now(),
    isRead: !!m.isRead,
    webLink: m.webLink ?? null
  }
}

export class OutlookProvider implements MailProvider {
  /** Some mailboxes reject internetMessageHeaders in a delta $select; we then sync without it. */
  private withHeaders = true

  constructor(private readonly http: Http) {}

  static async me(http: Http): Promise<{ displayName?: string; mail?: string; userPrincipalName: string }> {
    return http.json(`${GRAPH}/me?$select=displayName,mail,userPrincipalName`)
  }

  async sync(cursor: string | null, sinceMs: number, h: SyncHandlers, signal?: AbortSignal): Promise<string> {
    if (cursor) {
      try {
        return await this.run(cursor, h, null, signal)
      } catch (err) {
        // Expired delta token: 410 Gone (or 400 with a sync-state error). Start over.
        if (!(err instanceof HttpError && (err.status === 410 || (err.status === 400 && /sync/i.test(err.body))))) throw err
      }
    }
    return this.run(this.initialUrl(sinceMs), h, sinceMs, signal)
  }

  private initialUrl(sinceMs: number): string {
    const select = this.withHeaders ? `${BASE_SELECT},internetMessageHeaders` : BASE_SELECT
    const filter = `receivedDateTime ge ${new Date(sinceMs).toISOString()}`
    return `${GRAPH}/me/mailFolders/inbox/messages/delta?$select=${select}&$filter=${encodeURIComponent(filter)}`
  }

  /** Follows delta pages from startUrl. fullSince is set for a full sync (null when incremental). */
  private async run(startUrl: string, h: SyncHandlers, fullSince: number | null, signal?: AbortSignal): Promise<string> {
    const full = fullSince !== null
    const seen = new Set<string>()
    let url = startUrl
    for (;;) {
      let page: DeltaPage
      try {
        page = await this.http.json<DeltaPage>(
          url,
          { headers: { prefer: 'odata.maxpagesize=50, outlook.body-content-type="text"' } },
          signal
        )
      } catch (err) {
        if (full && this.withHeaders && err instanceof HttpError && err.status === 400 && /internetMessageHeaders/i.test(err.body)) {
          this.withHeaders = false
          return this.run(this.initialUrl(fullSince), h, fullSince, signal)
        }
        throw err
      }
      const removed: string[] = []
      const upserts: IncomingMessage[] = []
      for (const m of page.value) {
        if (m['@removed']) removed.push(m.id)
        else {
          seen.add(m.id)
          upserts.push(parseGraphMessage(m))
        }
      }
      if (removed.length) h.remove(removed)
      if (upserts.length) h.upsert(upserts)
      if (page['@odata.nextLink']) url = page['@odata.nextLink']
      else if (page['@odata.deltaLink']) {
        if (full) h.keepOnly(seen)
        return page['@odata.deltaLink']
      } else throw new Error('Graph delta response had neither nextLink nor deltaLink')
    }
  }

  async fetchBody(providerId: string): Promise<{ content: string; isHtml: boolean }> {
    const m = await this.http.json<GraphMessage>(`${GRAPH}/me/messages/${encodeURIComponent(providerId)}?$select=body`)
    return { content: m.body?.content ?? '', isHtml: m.body?.contentType === 'html' }
  }

  async setRead(providerIds: string[], read: boolean): Promise<void> {
    for (const part of chunk(providerIds, 20)) {
      const requests = part.map((id, i) => ({
        id: String(i),
        method: 'PATCH',
        url: `/me/messages/${encodeURIComponent(id)}`,
        headers: { 'content-type': 'application/json' },
        body: { isRead: read }
      }))
      const res = await this.http.json<{ responses: { id: string; status: number; body?: { error?: { message?: string } } }[] }>(`${GRAPH}/$batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requests })
      })
      const bad = res.responses.find((r) => r.status < 200 || r.status >= 300)
      if (bad) throw new Error(`HTTP ${bad.status} ${bad.body?.error?.message ?? ''}`.trim())
    }
  }

  async applyTags(changes: TagChange[]): Promise<ApplyResult> {
    const result: ApplyResult = { ok: [], failed: [] }
    // JSON batching: up to 20 requests per call.
    for (const part of chunk(changes, 20)) {
      const categoriesFor = new Map<string, string[]>()
      const requests = part.map((c, i) => {
        const categories = [...c.providerLabels.filter((l) => !l.startsWith(PROVIDER_PREFIX)), providerLabel(c.tag)]
        categoriesFor.set(String(i), categories)
        return {
          id: String(i),
          method: 'PATCH',
          url: `/me/messages/${encodeURIComponent(c.providerId)}`,
          headers: { 'content-type': 'application/json' },
          body: { categories }
        }
      })
      try {
        const res = await this.http.json<{ responses: { id: string; status: number; body?: { error?: { message?: string } } }[] }>(
          `${GRAPH}/$batch`,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requests }) }
        )
        for (const r of res.responses) {
          const c = part[Number(r.id)]
          if (r.status >= 200 && r.status < 300) result.ok.push({ providerId: c.providerId, providerLabels: categoriesFor.get(r.id)! })
          else result.failed.push({ providerId: c.providerId, error: `HTTP ${r.status} ${r.body?.error?.message ?? ''}`.trim() })
        }
      } catch (err) {
        for (const c of part) result.failed.push({ providerId: c.providerId, error: (err as Error).message })
      }
    }
    return result
  }
}
