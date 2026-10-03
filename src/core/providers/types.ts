import type { Tag } from '../tags'
import type { IncomingMessage } from '../types'

export interface SyncHandlers {
  upsert(messages: IncomingMessage[]): void
  remove(providerIds: string[]): void
  patch(providerId: string, patch: { isRead?: boolean; providerLabels?: string[] }): void
  exists(providerId: string): boolean
  /** After a full sync: drop local messages the server no longer has in the inbox window. */
  keepOnly(providerIds: Set<string>): void
}

export interface TagChange {
  providerId: string
  tag: Tag
  /** Current Gmail label ids / Outlook categories, so non-AI ones are preserved. */
  providerLabels: string[]
}

export interface ApplyResult {
  ok: { providerId: string; providerLabels: string[] }[]
  failed: { providerId: string; error: string }[]
}

export interface MailProvider {
  /**
   * Full sync of the inbox window when cursor is null or expired, incremental otherwise.
   * Returns the cursor to store for next time.
   */
  sync(cursor: string | null, sinceMs: number, h: SyncHandlers, signal?: AbortSignal): Promise<string>
  fetchBody(providerId: string): Promise<{ content: string; isHtml: boolean }>
  applyTags(changes: TagChange[]): Promise<ApplyResult>
}
