import type { Tag } from './tags'

export type Provider = 'gmail' | 'outlook'
export type TagSource = 'rule' | 'llm' | 'user'

export interface Account {
  id: string
  provider: Provider
  email: string
  name: string | null
  lastSyncAt: number | null
  lastError: string | null
}

/** A message as delivered by a provider during sync. */
export interface IncomingMessage {
  providerId: string
  threadId: string | null
  fromName: string | null
  fromAddr: string | null
  toAddrs: string | null
  subject: string | null
  snippet: string | null
  bodyText: string | null
  linkDomains: string[]
  hasCalendarInvite: boolean
  listUnsubscribe: boolean
  hasAttachments: boolean
  providerLabels: string[]
  receivedAt: number
  isRead: boolean
  webLink: string | null
}

export interface MessageSummary {
  id: string
  accountId: string
  fromName: string | null
  fromAddr: string | null
  subject: string | null
  snippet: string | null
  receivedAt: number
  isRead: boolean
  hasAttachments: boolean
  tag: Tag | null
  tagSource: TagSource | null
  tagConfidence: number | null
}

export interface MessageDetail extends MessageSummary {
  providerId: string
  threadId: string | null
  toAddrs: string | null
  bodyText: string | null
  linkDomains: string[]
  hasCalendarInvite: boolean
  listUnsubscribe: boolean
  providerLabels: string[]
  webLink: string | null
  tagReason: string | null
}

export interface ListQuery {
  accountId?: string
  /** A tag, or 'Untagged' for messages without one. */
  tag?: Tag | 'Untagged'
  /** Full-text search over subject, sender, snippet and body. */
  query?: string
  unreadOnly?: boolean
  from?: string
  /** Epoch ms, inclusive. */
  since?: number
  /** Epoch ms, exclusive. */
  until?: number
  hasAttachments?: boolean
  /** Has a calendar invite. */
  hasInvite?: boolean
  /** Newsletters and other bulk mail (has a List-Unsubscribe header). */
  isNewsletter?: boolean
  /** Tagged Meeting, Questions or Needs Attention. */
  actionOnly?: boolean
  /** Tagged by a rule or the model with low confidence, or the model said Other: worth a second look. */
  needsReview?: boolean
  /** Oldest first instead of newest first. */
  oldestFirst?: boolean
  /** Opaque cursor from a previous page. */
  cursor?: string
  limit?: number
}

/** Emails per account and tag in a date range. */
export interface DigestRow {
  accountId: string
  tag: string
  count: number
}

export interface ListPage {
  items: MessageSummary[]
  nextCursor: string | null
}

export interface StorageStats {
  dbBytes: number
  walBytes: number
  messages: number
  bodyCacheBytes: number
  bodyCacheCount: number
  bodyTextBytes: number
}

export interface TaggingProgress {
  done: number
  total: number
  /** `start`: the emails to tag are known. `model`: waiting for Ollama (it may be loading the model). */
  stage: 'start' | 'rules' | 'model' | 'llm' | 'done'
  lastId?: string
  lastTag?: Tag
}

/** How a tagging run ended, for the status line under the "Tag new emails" button. */
export interface TaggingFinished {
  total: number
  tagged: number
  failed: number
  ms: number
  error?: string
  /** Which kind of Ollama problem stopped the run (unreachable, dropped, model_missing, ...), for the log. */
  errorKind?: string
  /** The model that was asked; absent when the rules settled everything. */
  model?: string
  /** What the first email that failed on its own said, to help spot a pattern. */
  failureSample?: string
  /** Started by the sync after new mail arrived, not by the user. */
  auto: boolean
}

export interface TaggingResult {
  total: number
  tagged: number
  byTag: Partial<Record<Tag, number>>
  byRules: number
  byLlm: number
  failed: number
  ms: number
  error?: string
  errorKind?: string
  model?: string
  failureSample?: string
  results: { id: string; from: string | null; subject: string | null; tag: Tag; source: TagSource }[]
}
