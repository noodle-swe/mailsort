// Types shared by the preload bridge and the renderer. Type-only: no runtime imports.
import type { CoreEvent } from '../core/events'
import type { OllamaHealth, PullProgress } from '../core/ollama'
import type { Settings } from '../core/settings'
import type { Tag } from '../core/tags'
import type {
  Account,
  DigestRow,
  ListPage,
  ListQuery,
  MessageDetail,
  Provider,
  StorageStats,
  TaggingResult
} from '../core/types'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export type ChatEvent =
  | { type: 'chat'; runId: string; kind: 'token'; text: string }
  | { type: 'chat'; runId: string; kind: 'tool-start'; name: string; args: Record<string, unknown> }
  | { type: 'chat'; runId: string; kind: 'tool-progress'; name: string; progress: number; total?: number }
  | { type: 'chat'; runId: string; kind: 'tool-end'; name: string; ok: boolean }
  | { type: 'chat'; runId: string; kind: 'done'; text: string }
  | { type: 'chat'; runId: string; kind: 'error'; error: string }

export type AppEvent = CoreEvent | ChatEvent

export interface AppStatus {
  /** Whether OAuth client ids are configured for each provider. */
  configured: Record<Provider, boolean>
  dataDir: string
  /** The log file MailSort writes problems to (see Settings, Troubleshooting). */
  logPath: string
  mcpHttpUrl: string | null
  /** Command + args other MCP clients use to launch MailSort as a stdio MCP server. */
  stdioCommand: { command: string; args: string[]; env: Record<string, string> }
}

export interface MailApi {
  status(): Promise<AppStatus>
  listMessages(q: ListQuery): Promise<ListPage>
  getMessage(id: string): Promise<MessageDetail | null>
  getBody(id: string): Promise<{ content: string; isHtml: boolean } | null>
  markRead(id: string): Promise<void>
  setRead(ids: string[], read: boolean): Promise<void>
  digest(range: { since?: number; until?: number }): Promise<DigestRow[]>
  setTag(ids: string[], tag: Tag): Promise<number>
  tagCounts(accountId?: string): Promise<Record<string, number>>
  unreadCounts(): Promise<Record<string, number>>
  listAccounts(): Promise<Account[]>
  addAccount(provider: Provider): Promise<Account>
  cancelAddAccount(): Promise<void>
  removeAccount(id: string): Promise<void>
  syncNow(accountId?: string): Promise<void>
  runTagging(opts: { retag?: boolean; accountId?: string; since?: number }): Promise<TaggingResult>
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  checkOllama(url?: string): Promise<OllamaHealth>
  startOllama(url?: string): Promise<OllamaHealth>
  pullModel(model: string, url?: string): Promise<void>
  cancelPull(model: string): Promise<void>
  pullStatus(): Promise<PullProgress[]>
  storageStats(): Promise<StorageStats>
  clearCache(): Promise<StorageStats>
  chat(turns: ChatTurn[]): Promise<string>
  cancelChat(runId: string): Promise<void>
  openExternal(url: string): Promise<void>
  /** Shows the folder with the log files. */
  openLogFolder(): Promise<void>
  /** Puts the newest log lines on the clipboard; resolves with how many lines. */
  copyLog(): Promise<number>
  onEvent(listener: (event: AppEvent) => void): () => void
}
