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
  /** Epoch ms. */
  since?: number
  /** Opaque cursor from a previous page. */
  cursor?: string
  limit?: number
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
  stage: 'rules' | 'llm' | 'done'
  lastId?: string
  lastTag?: Tag
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
  results: { id: string; from: string | null; subject: string | null; tag: Tag; source: TagSource }[]
}
