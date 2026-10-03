import { brotliCompressSync, brotliDecompressSync, constants as zlib } from 'node:zlib'
import { statSync } from 'node:fs'
import type { StatementSync, SQLInputValue } from 'node:sqlite'
import { transaction, type Db } from './db'
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from './settings'
import { isTag, type Tag } from './tags'
import type {
  Account,
  IncomingMessage,
  ListPage,
  ListQuery,
  MessageDetail,
  MessageSummary,
  Provider,
  StorageStats,
  TagSource
} from './types'

type Row = Record<string, SQLInputValue>

const SUMMARY_COLUMNS = `
  m.id, m.account_id AS accountId, m.from_name AS fromName, m.from_addr AS fromAddr,
  m.subject, m.snippet, m.received_at AS receivedAt, m.is_read AS isRead,
  m.has_attachments AS hasAttachments,
  t.tag, t.source AS tagSource, t.confidence AS tagConfidence`

export interface ClassifyCandidate {
  id: string
  accountId: string
  fromName: string | null
  fromAddr: string | null
  subject: string | null
  snippet: string | null
  bodyText: string | null
  linkDomains: string[]
  hasCalendarInvite: boolean
  listUnsubscribe: boolean
  providerLabels: string[]
}

export interface PendingWriteback {
  messageId: string
  accountId: string
  providerId: string
  tag: Tag
  syncedTag: Tag | null
  providerLabels: string[]
}

export interface Correction {
  fromTag: Tag | null
  toTag: Tag
  fromAddr: string | null
  subject: string | null
  excerpt: string | null
}

export function domainOf(addr: string | null | undefined): string | null {
  const at = addr?.lastIndexOf('@') ?? -1
  return at >= 0 ? addr!.slice(at + 1).toLowerCase() : null
}

/** Turns free text into a safe FTS5 prefix query: each word becomes "word"*. */
export function toFtsQuery(input: string): string | null {
  const words = input.match(/[\p{L}\p{N}][\p{L}\p{N}@._'-]*/gu)
  if (!words?.length) return null
  return words
    .slice(0, 12)
    .map((w) => `"${w.replace(/"/g, '""')}"*`)
    .join(' ')
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function toSummary(r: Record<string, unknown>): MessageSummary {
  return {
    id: r.id as string,
    accountId: r.accountId as string,
    fromName: (r.fromName as string) ?? null,
    fromAddr: (r.fromAddr as string) ?? null,
    subject: (r.subject as string) ?? null,
    snippet: (r.snippet as string) ?? null,
    receivedAt: r.receivedAt as number,
    isRead: !!r.isRead,
    hasAttachments: !!r.hasAttachments,
    tag: isTag(r.tag) ? r.tag : null,
    tagSource: (r.tagSource as TagSource) ?? null,
    tagConfidence: (r.tagConfidence as number) ?? null
  }
}

export class Store {
  private stmts = new Map<string, StatementSync>()
  private settingsCache: Settings | null = null

  constructor(
    readonly db: Db,
    private readonly dbPath: string
  ) {}

  private q(sql: string): StatementSync {
    let s = this.stmts.get(sql)
    if (!s) {
      s = this.db.prepare(sql)
      this.stmts.set(sql, s)
    }
    return s
  }

  // ---------------------------------------------------------------- settings

  getSettings(): Settings {
    if (this.settingsCache) return this.settingsCache
    const rows = this.q('SELECT key, value FROM settings').all() as { key: string; value: string }[]
    const stored: Record<string, unknown> = {}
    for (const { key, value } of rows) {
      try {
        stored[key] = JSON.parse(value)
      } catch {
        /* ignore corrupt values */
      }
    }
    this.settingsCache = { ...DEFAULT_SETTINGS, ...sanitizeSettings(stored) }
    return this.settingsCache
  }

  updateSettings(patch: Record<string, unknown>): Settings {
    const clean = sanitizeSettings(patch)
    const upsert = this.q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    transaction(this.db, () => {
      for (const [k, v] of Object.entries(clean)) upsert.run(k, JSON.stringify(v))
    })
    this.settingsCache = null
    return this.getSettings()
  }

  // ---------------------------------------------------------------- accounts

  listAccounts(): Account[] {
    return this.q(
      `SELECT id, provider, email, name, last_sync_at AS lastSyncAt, last_error AS lastError
       FROM accounts ORDER BY created_at`
    ).all() as unknown as Account[]
  }

  getAccount(id: string): (Account & { tokenEnc: Uint8Array | null; syncCursor: string | null }) | null {
    const row = this.q(
      `SELECT id, provider, email, name, last_sync_at AS lastSyncAt, last_error AS lastError,
              token_enc AS tokenEnc, sync_cursor AS syncCursor
       FROM accounts WHERE id = ?`
    ).get(id)
    return (row as never) ?? null
  }

  findAccount(provider: Provider, email: string): Account | null {
    const row = this.q('SELECT id FROM accounts WHERE provider = ? AND lower(email) = lower(?)').get(provider, email) as
      | { id: string }
      | undefined
    return row ? this.getAccount(row.id) : null
  }

  insertAccount(a: { id: string; provider: Provider; email: string; name: string | null; tokenEnc: Uint8Array }): void {
    this.q(
      `INSERT INTO accounts (id, provider, email, name, token_enc, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET email = excluded.email, name = excluded.name, token_enc = excluded.token_enc, last_error = NULL`
    ).run(a.id, a.provider, a.email, a.name, a.tokenEnc, Date.now())
  }

  updateAccountToken(id: string, tokenEnc: Uint8Array): void {
    this.q('UPDATE accounts SET token_enc = ? WHERE id = ?').run(tokenEnc, id)
  }

  setSyncState(id: string, state: { cursor?: string | null; error?: string | null; syncedAt?: number }): void {
    if (state.cursor !== undefined) this.q('UPDATE accounts SET sync_cursor = ? WHERE id = ?').run(state.cursor, id)
    if (state.error !== undefined) this.q('UPDATE accounts SET last_error = ? WHERE id = ?').run(state.error, id)
    if (state.syncedAt !== undefined) this.q('UPDATE accounts SET last_sync_at = ? WHERE id = ?').run(state.syncedAt, id)
  }

  deleteAccount(id: string): void {
    this.q('DELETE FROM accounts WHERE id = ?').run(id)
  }

  // ---------------------------------------------------------------- messages

  /** Inserts or updates messages; returns ids that were not stored before. */
  upsertMessages(accountId: string, messages: IncomingMessage[]): string[] {
    if (!messages.length) return []
    const exists = this.q('SELECT 1 FROM messages WHERE id = ?')
    const upsert = this.q(`
      INSERT INTO messages (id, account_id, provider_id, thread_id, from_name, from_addr, to_addrs, subject, snippet,
        body_text, link_domains, has_calendar_invite, list_unsubscribe, has_attachments, provider_labels,
        received_at, is_read, web_link)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        thread_id = excluded.thread_id, from_name = excluded.from_name, from_addr = excluded.from_addr,
        to_addrs = excluded.to_addrs, subject = excluded.subject, snippet = excluded.snippet,
        body_text = coalesce(excluded.body_text, messages.body_text), link_domains = excluded.link_domains,
        has_calendar_invite = excluded.has_calendar_invite, list_unsubscribe = excluded.list_unsubscribe,
        has_attachments = excluded.has_attachments, provider_labels = excluded.provider_labels,
        received_at = excluded.received_at, is_read = excluded.is_read, web_link = excluded.web_link`)
    const added: string[] = []
    transaction(this.db, () => {
      for (const m of messages) {
        const id = `${accountId}:${m.providerId}`
        if (!exists.get(id)) added.push(id)
        upsert.run(
          id,
          accountId,
          m.providerId,
          m.threadId,
          m.fromName,
          m.fromAddr?.toLowerCase() ?? null,
          m.toAddrs,
          m.subject,
          m.snippet,
          m.bodyText,
          m.linkDomains.join(' ') || null,
          m.hasCalendarInvite ? 1 : 0,
          m.listUnsubscribe ? 1 : 0,
          m.hasAttachments ? 1 : 0,
          JSON.stringify(m.providerLabels),
          m.receivedAt,
          m.isRead ? 1 : 0,
          m.webLink
        )
      }
    })
    return added
  }

  /** Small updates from incremental sync (read state, labels) without refetching the message. */
  patchMessage(accountId: string, providerId: string, patch: { isRead?: boolean; providerLabels?: string[] }): void {
    const id = `${accountId}:${providerId}`
    if (patch.isRead !== undefined) this.q('UPDATE messages SET is_read = ? WHERE id = ?').run(patch.isRead ? 1 : 0, id)
    if (patch.providerLabels) this.q('UPDATE messages SET provider_labels = ? WHERE id = ?').run(JSON.stringify(patch.providerLabels), id)
  }

  deleteMessages(accountId: string, providerIds: string[]): number {
    const del = this.q('DELETE FROM messages WHERE id = ?')
    let n = 0
    transaction(this.db, () => {
      for (const pid of providerIds) n += Number(del.run(`${accountId}:${pid}`).changes)
    })
    return n
  }

  /** Deletes the account's messages whose provider id is not in keep. */
  keepOnlyMessages(accountId: string, keep: Set<string>): number {
    const rows = this.q('SELECT provider_id AS pid FROM messages WHERE account_id = ?').all(accountId) as { pid: string }[]
    const stale = rows.map((r) => r.pid).filter((pid) => !keep.has(pid))
    return stale.length ? this.deleteMessages(accountId, stale) : 0
  }

  hasMessage(accountId: string, providerId: string): boolean {
    return !!this.q('SELECT 1 FROM messages WHERE id = ?').get(`${accountId}:${providerId}`)
  }

  listMessages(query: ListQuery): ListPage {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    const where: string[] = []
    const params: SQLInputValue[] = []
    let from = 'messages m LEFT JOIN tags t ON t.message_id = m.id'

    const fts = query.query ? toFtsQuery(query.query) : null
    if (fts) {
      from = `messages_fts f JOIN messages m ON m.rowid = f.rowid LEFT JOIN tags t ON t.message_id = m.id`
      where.push('messages_fts MATCH ?')
      params.push(fts)
    }
    if (query.accountId) {
      where.push('m.account_id = ?')
      params.push(query.accountId)
    }
    if (query.tag === 'Untagged') where.push('t.tag IS NULL')
    else if (query.tag) {
      where.push('t.tag = ?')
      params.push(query.tag)
    }
    if (query.unreadOnly) where.push('m.is_read = 0')
    if (query.from) {
      where.push('(m.from_addr LIKE ? OR m.from_name LIKE ?)')
      params.push(`%${query.from}%`, `%${query.from}%`)
    }
    if (query.since) {
      where.push('m.received_at >= ?')
      params.push(query.since)
    }
    if (query.cursor) {
      const sep = query.cursor.indexOf('|')
      const ts = Number(query.cursor.slice(0, sep))
      const id = query.cursor.slice(sep + 1)
      if (sep > 0 && Number.isFinite(ts)) {
        where.push('(m.received_at < ? OR (m.received_at = ? AND m.id < ?))')
        params.push(ts, ts, id)
      }
    }
    const sql = `SELECT ${SUMMARY_COLUMNS} FROM ${from}
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY m.received_at DESC, m.id DESC LIMIT ${limit + 1}`
    // Dynamic SQL has a bounded number of shapes, so caching the statement is fine.
    const rows = this.q(sql).all(...params) as Record<string, unknown>[]
    const items = rows.slice(0, limit).map(toSummary)
    const last = items[items.length - 1]
    return { items, nextCursor: rows.length > limit && last ? `${last.receivedAt}|${last.id}` : null }
  }

  getMessage(id: string): MessageDetail | null {
    const r = this.q(
      `SELECT ${SUMMARY_COLUMNS}, m.provider_id AS providerId, m.thread_id AS threadId, m.to_addrs AS toAddrs,
              m.body_text AS bodyText, m.link_domains AS linkDomains, m.has_calendar_invite AS hasCalendarInvite,
              m.list_unsubscribe AS listUnsubscribe, m.provider_labels AS providerLabels, m.web_link AS webLink,
              t.reason AS tagReason
       FROM messages m LEFT JOIN tags t ON t.message_id = m.id WHERE m.id = ?`
    ).get(id) as Record<string, unknown> | undefined
    if (!r) return null
    return {
      ...toSummary(r),
      providerId: r.providerId as string,
      threadId: (r.threadId as string) ?? null,
      toAddrs: (r.toAddrs as string) ?? null,
      bodyText: (r.bodyText as string) ?? null,
      linkDomains: typeof r.linkDomains === 'string' && r.linkDomains ? r.linkDomains.split(' ') : [],
      hasCalendarInvite: !!r.hasCalendarInvite,
      listUnsubscribe: !!r.listUnsubscribe,
      providerLabels: parseJsonArray(r.providerLabels),
      webLink: (r.webLink as string) ?? null,
      tagReason: (r.tagReason as string) ?? null
    }
  }

  markRead(id: string): void {
    this.q('UPDATE messages SET is_read = 1 WHERE id = ?').run(id)
  }

  tagCounts(opts: { accountId?: string; since?: number } = {}): Record<string, number> {
    const where: string[] = []
    const params: SQLInputValue[] = []
    if (opts.accountId) {
      where.push('m.account_id = ?')
      params.push(opts.accountId)
    }
    if (opts.since) {
      where.push('m.received_at >= ?')
      params.push(opts.since)
    }
    const rows = this.q(
      `SELECT coalesce(t.tag, 'Untagged') AS tag, count(*) AS n
       FROM messages m LEFT JOIN tags t ON t.message_id = m.id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} GROUP BY 1`
    ).all(...params) as { tag: string; n: number }[]
    return Object.fromEntries(rows.map((r) => [r.tag, r.n]))
  }

  unreadCounts(): Record<string, number> {
    const rows = this.q('SELECT account_id AS a, count(*) AS n FROM messages WHERE is_read = 0 GROUP BY 1').all() as {
      a: string
      n: number
    }[]
    return Object.fromEntries(rows.map((r) => [r.a, r.n]))
  }

  // ---------------------------------------------------------------- classification

  /**
   * Messages that need a tag: untagged ones, plus ones tagged by an older classifier.
   * With retag, every non-user tag is recomputed. User tags are never overwritten.
   */
  candidatesForTagging(opts: { version: number; since?: number; accountId?: string; retag?: boolean; limit: number; ids?: string[] }): ClassifyCandidate[] {
    const where: string[] = [opts.retag ? "(t.source IS NULL OR t.source <> 'user')" : '(t.message_id IS NULL OR (t.source <> \'user\' AND t.classifier_version < ?))']
    const params: SQLInputValue[] = opts.retag ? [] : [opts.version]
    if (opts.since) {
      where.push('m.received_at >= ?')
      params.push(opts.since)
    }
    if (opts.accountId) {
      where.push('m.account_id = ?')
      params.push(opts.accountId)
    }
    if (opts.ids?.length) {
      where.push(`m.id IN (${opts.ids.map(() => '?').join(',')})`)
      params.push(...opts.ids)
    }
    const rows = this.db
      .prepare(
        `SELECT m.id, m.account_id AS accountId, m.from_name AS fromName, m.from_addr AS fromAddr, m.subject,
                m.snippet, m.body_text AS bodyText, m.link_domains AS linkDomains,
                m.has_calendar_invite AS hasCalendarInvite, m.list_unsubscribe AS listUnsubscribe,
                m.provider_labels AS providerLabels
         FROM messages m LEFT JOIN tags t ON t.message_id = m.id
         WHERE ${where.join(' AND ')}
         ORDER BY m.received_at DESC LIMIT ?`
      )
      .all(...params, opts.limit) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r.id as string,
      accountId: r.accountId as string,
      fromName: (r.fromName as string) ?? null,
      fromAddr: (r.fromAddr as string) ?? null,
      subject: (r.subject as string) ?? null,
      snippet: (r.snippet as string) ?? null,
      bodyText: (r.bodyText as string) ?? null,
      linkDomains: typeof r.linkDomains === 'string' && r.linkDomains ? r.linkDomains.split(' ') : [],
      hasCalendarInvite: !!r.hasCalendarInvite,
      listUnsubscribe: !!r.listUnsubscribe,
      providerLabels: parseJsonArray(r.providerLabels)
    }))
  }

  setTag(t: {
    messageId: string
    tag: Tag
    source: TagSource
    confidence: number | null
    reason: string | null
    model: string | null
    version: number
  }): void {
    this.q(
      `INSERT INTO tags (message_id, tag, source, confidence, reason, model, classifier_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (message_id) DO UPDATE SET tag = excluded.tag, source = excluded.source,
         confidence = excluded.confidence, reason = excluded.reason, model = excluded.model,
         classifier_version = excluded.classifier_version, created_at = excluded.created_at, sync_error = NULL`
    ).run(t.messageId, t.tag, t.source, t.confidence, t.reason, t.model, t.version, Date.now())
  }

  getTag(messageId: string): { tag: Tag; source: TagSource } | null {
    const r = this.q('SELECT tag, source FROM tags WHERE message_id = ?').get(messageId) as
      | { tag: string; source: TagSource }
      | undefined
    return r && isTag(r.tag) ? { tag: r.tag, source: r.source } : null
  }

  addCorrection(c: { messageId: string; fromTag: Tag | null; toTag: Tag }): void {
    const m = this.q('SELECT from_addr, subject, coalesce(snippet, substr(body_text, 1, 300)) AS excerpt FROM messages WHERE id = ?').get(
      c.messageId
    ) as { from_addr: string | null; subject: string | null; excerpt: string | null } | undefined
    this.q(
      `INSERT INTO corrections (message_id, from_tag, to_tag, from_domain, from_addr, subject, excerpt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(c.messageId, c.fromTag, c.toTag, domainOf(m?.from_addr), m?.from_addr ?? null, m?.subject ?? null, m?.excerpt ?? null, Date.now())
  }

  /** The tag a user gave this sender's domain at least twice in their latest corrections, if consistent. */
  domainRule(fromAddr: string | null): Tag | null {
    const domain = domainOf(fromAddr)
    if (!domain) return null
    const rows = this.q('SELECT to_tag FROM corrections WHERE from_domain = ? ORDER BY created_at DESC LIMIT 3').all(domain) as {
      to_tag: string
    }[]
    if (rows.length < 2) return null
    const latest = rows[0].to_tag
    const agreeing = rows.filter((r) => r.to_tag === latest).length
    return agreeing >= 2 && isTag(latest) ? latest : null
  }

  /** Up to `limit` past corrections most similar to this email (same sender, then same domain, then recent). */
  similarCorrections(fromAddr: string | null, limit = 3): Correction[] {
    const rows = this.q(
      `SELECT from_tag AS fromTag, to_tag AS toTag, from_addr AS fromAddr, subject, excerpt
       FROM corrections
       ORDER BY (from_addr = ?) DESC, (from_domain = ?) DESC, created_at DESC
       LIMIT ?`
    ).all(fromAddr ?? '', domainOf(fromAddr) ?? '', limit) as unknown as Correction[]
    return rows.filter((r) => isTag(r.toTag))
  }

  // ---------------------------------------------------------------- write-back

  pendingWriteback(limit = 2000): PendingWriteback[] {
    const rows = this.q(
      `SELECT t.message_id AS messageId, m.account_id AS accountId, m.provider_id AS providerId, t.tag,
              t.synced_tag AS syncedTag, m.provider_labels AS providerLabels
       FROM tags t JOIN messages m ON m.id = t.message_id
       WHERE t.synced_tag IS NOT t.tag AND t.sync_error IS NULL
       LIMIT ?`
    ).all(limit) as Record<string, unknown>[]
    return rows.map((r) => ({
      messageId: r.messageId as string,
      accountId: r.accountId as string,
      providerId: r.providerId as string,
      tag: r.tag as Tag,
      syncedTag: isTag(r.syncedTag) ? r.syncedTag : null,
      providerLabels: parseJsonArray(r.providerLabels)
    }))
  }

  markSynced(messageId: string, tag: Tag): void {
    this.q('UPDATE tags SET synced_tag = ?, sync_error = NULL WHERE message_id = ? AND tag = ?').run(tag, messageId, tag)
  }

  markSyncError(messageId: string, error: string): void {
    this.q('UPDATE tags SET sync_error = ? WHERE message_id = ?').run(error.slice(0, 500), messageId)
  }

  /** Lets messages that failed to sync be retried (called after a successful sync of their account). */
  clearSyncErrors(accountId: string): void {
    this.q(
      'UPDATE tags SET sync_error = NULL WHERE sync_error IS NOT NULL AND message_id IN (SELECT id FROM messages WHERE account_id = ?)'
    ).run(accountId)
  }

  getLabelId(accountId: string, name: string): string | null {
    const r = this.q('SELECT provider_label_id AS id FROM label_cache WHERE account_id = ? AND name = ?').get(accountId, name) as
      | { id: string }
      | undefined
    return r?.id ?? null
  }

  setLabelId(accountId: string, name: string, id: string): void {
    this.q(
      'INSERT INTO label_cache (account_id, name, provider_label_id) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET provider_label_id = excluded.provider_label_id'
    ).run(accountId, name, id)
  }

  clearLabelCache(accountId: string): void {
    this.q('DELETE FROM label_cache WHERE account_id = ?').run(accountId)
  }

  // ---------------------------------------------------------------- bodies (LRU cache)

  getBody(messageId: string): { content: string; isHtml: boolean } | null {
    const r = this.q('SELECT content, is_html AS isHtml FROM bodies WHERE message_id = ?').get(messageId) as
      | { content: Uint8Array; isHtml: number }
      | undefined
    if (!r) return null
    this.q('UPDATE bodies SET accessed_at = ? WHERE message_id = ?').run(Date.now(), messageId)
    return { content: brotliDecompressSync(r.content).toString('utf8'), isHtml: !!r.isHtml }
  }

  putBody(messageId: string, content: string, isHtml: boolean, capBytes: number): void {
    const compressed = brotliCompressSync(Buffer.from(content, 'utf8'), {
      params: { [zlib.BROTLI_PARAM_QUALITY]: 5, [zlib.BROTLI_PARAM_SIZE_HINT]: content.length }
    })
    this.q(
      `INSERT INTO bodies (message_id, content, is_html, size, accessed_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (message_id) DO UPDATE SET content = excluded.content, is_html = excluded.is_html,
         size = excluded.size, accessed_at = excluded.accessed_at`
    ).run(messageId, compressed, isHtml ? 1 : 0, compressed.length, Date.now())
    this.pruneBodies(capBytes)
  }

  pruneBodies(capBytes: number): number {
    const { total } = this.q('SELECT coalesce(sum(size), 0) AS total FROM bodies').get() as { total: number }
    if (total <= capBytes) return 0
    // Evict least-recently-opened bodies down to 90% of the cap so we don't prune on every insert.
    const target = total - capBytes * 0.9
    const victims = this.q('SELECT message_id AS id, size FROM bodies ORDER BY accessed_at').iterate() as Iterable<{ id: string; size: number }>
    const del = this.q('DELETE FROM bodies WHERE message_id = ?')
    let freed = 0
    let n = 0
    const ids: string[] = []
    for (const v of victims) {
      if (freed >= target) break
      ids.push(v.id)
      freed += v.size
    }
    transaction(this.db, () => {
      for (const id of ids) n += Number(del.run(id).changes)
    })
    return n
  }

  clearBodyCache(): void {
    this.q('DELETE FROM bodies').run()
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;')
  }

  /** Drops cleaned body text for old mail. Metadata, snippet and tags stay. */
  applyRetention(retentionDays: number): number {
    if (retentionDays <= 0) return 0
    const cutoff = Date.now() - retentionDays * 86_400_000
    return Number(this.q('UPDATE messages SET body_text = NULL WHERE received_at < ? AND body_text IS NOT NULL').run(cutoff).changes)
  }

  storageStats(): StorageStats {
    const size = (p: string) => {
      try {
        return statSync(p).size
      } catch {
        return 0
      }
    }
    const bodies = this.q('SELECT coalesce(sum(size), 0) AS bytes, count(*) AS n FROM bodies').get() as { bytes: number; n: number }
    const msgs = this.q('SELECT count(*) AS n, coalesce(sum(length(body_text)), 0) AS textBytes FROM messages').get() as {
      n: number
      textBytes: number
    }
    return {
      dbBytes: this.dbPath === ':memory:' ? 0 : size(this.dbPath),
      walBytes: this.dbPath === ':memory:' ? 0 : size(this.dbPath + '-wal'),
      messages: msgs.n,
      bodyCacheBytes: bodies.bytes,
      bodyCacheCount: bodies.n,
      bodyTextBytes: msgs.textBytes
    }
  }
}

export type { Row }
