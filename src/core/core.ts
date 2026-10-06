import { randomUUID } from 'node:crypto'
import { AuthError, runLoopbackFlow, TokenManager, type TokenSet } from './auth/oauth'
import { oauthConfig, type OAuthClientIds, type SecretBox } from './auth/providers'
import { createOllamaClassifier, type LlmClassifier } from './classify/llm'
import { Tagger, type TaggingOptions } from './classify/pipeline'
import { openDb } from './db'
import { Emitter, type CoreListener } from './events'
import { checkOllama, isLocalUrl, isValidModelName, OllamaClient, OllamaError, PullTracker, type OllamaHealth, type PullProgress } from './ollama'
import { findOllamaBinary, startOllamaProcess } from './ollama-local'
import { createHttp } from './providers/http'
import { GmailProvider } from './providers/gmail'
import { OutlookProvider } from './providers/outlook'
import type { MailProvider, SyncHandlers } from './providers/types'
import { autoTagActive, classifierModelOf, type Settings } from './settings'
import { Store } from './store'
import type { Tag } from './tags'
import type { Account, Provider, TaggingResult } from './types'

export interface CoreOptions {
  dbPath: string
  secrets: SecretBox
  clientIds: OAuthClientIds
  /** Opens the sign-in page in the system browser. */
  openUrl: (url: string) => void | Promise<void>
  /** Override the email classifier (tests). Defaults to Ollama with the configured model. */
  createClassifier?: (settings: Settings) => LlmClassifier
}

const DAY = 86_400_000

/** Most emails tagged automatically after one sync. A big import must not make the PC load a model for thousands of emails. */
export const AUTO_TAG_LIMIT = 50
/** Automatic runs in a row that fail before automatic tagging pauses itself, and for how long. */
const AUTO_TAG_MAX_FAILURES = 2
const AUTO_TAG_PAUSE_MIN = 30

/** Calls fn at most once per `ms` per key, always delivering the latest call. */
function throttleByKey(ms: number, fn: (key: string) => void): (key: string) => void {
  const timers = new Map<string, NodeJS.Timeout>()
  return (key) => {
    if (timers.has(key)) return
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key)
        fn(key)
      }, ms)
    )
  }
}

/**
 * Everything the app, the MCP server and the chat agent share: the database, mail providers,
 * background sync, the tagging pipeline and tag write-back.
 */
export class Core {
  readonly store: Store
  readonly tagger: Tagger
  private readonly events = new Emitter()
  private readonly providers = new Map<string, MailProvider>()
  private readonly syncing = new Map<string, Promise<number>>()
  private syncTimer: NodeJS.Timeout | null = null
  private maintenanceTimer: NodeJS.Timeout | null = null
  private writebackTimer: NodeJS.Timeout | null = null
  private writebackRunning: Promise<void> | null = null
  private writebackAgain = false
  private autoTagFailures = 0
  private autoTagPause: { key: string; until: number } | null = null
  private readonly pulls = new Map<string, { controller: AbortController; progress: PullProgress }>()
  private readonly notifyMessages = throttleByKey(400, (accountId) => this.events.emit({ type: 'messages-changed', accountId }))

  constructor(private readonly opts: CoreOptions) {
    this.store = new Store(openDb(opts.dbPath), opts.dbPath)
    this.tagger = new Tagger(
      this.store,
      () => {
        const s = this.store.getSettings()
        return opts.createClassifier?.(s) ?? createOllamaClassifier({ url: s.ollamaUrl, model: classifierModelOf(s) })
      },
      (ids) => {
        this.events.emit({ type: 'tags-changed', ids })
        this.scheduleWriteback()
      }
    )
  }

  on(listener: CoreListener): () => void {
    return this.events.on(listener)
  }

  /** Starts periodic sync and daily storage maintenance (the GUI app does this; stdio MCP mode does not). */
  startBackground(): void {
    const loop = () => {
      void this.syncAll()
      this.syncTimer = setTimeout(loop, this.store.getSettings().syncIntervalSec * 1000)
    }
    loop()
    const maintain = () => {
      this.maintenance()
      this.maintenanceTimer = setTimeout(maintain, DAY)
    }
    this.maintenanceTimer = setTimeout(maintain, 30_000)
  }

  close(): void {
    for (const t of [this.syncTimer, this.maintenanceTimer, this.writebackTimer]) if (t) clearTimeout(t)
    for (const p of this.pulls.values()) p.controller.abort()
    if (this.store.db.isOpen) this.store.db.close()
  }

  // ---------------------------------------------------------------- accounts

  private tokenManager(provider: Provider, tokens: TokenSet, accountId: string | null): TokenManager {
    return new TokenManager(oauthConfig(provider, this.opts.clientIds), tokens, (t) => {
      if (accountId) this.store.updateAccountToken(accountId, this.opts.secrets.encrypt(JSON.stringify(t)))
    })
  }

  private providerFor(accountId: string): MailProvider {
    const cached = this.providers.get(accountId)
    if (cached) return cached
    const acct = this.store.getAccount(accountId)
    if (!acct) throw new Error(`Unknown account ${accountId}`)
    let tokens: TokenSet
    try {
      tokens = JSON.parse(this.opts.secrets.decrypt(acct.tokenEnc ?? new Uint8Array())) as TokenSet
      if (!tokens.refreshToken) throw new Error('no refresh token')
    } catch {
      throw new AuthError(`${acct.email} needs to sign in again`, true)
    }
    const http = createHttp(this.tokenManager(acct.provider, tokens, accountId))
    const provider =
      acct.provider === 'gmail' ? new GmailProvider(accountId, acct.email, http, this.store) : new OutlookProvider(http)
    this.providers.set(accountId, provider)
    return provider
  }

  /** Runs the browser sign-in, stores the account (or refreshes an existing one) and starts its first sync. */
  async addAccount(provider: Provider, signal?: AbortSignal): Promise<Account> {
    const cfg = oauthConfig(provider, this.opts.clientIds)
    const tokens = await runLoopbackFlow(cfg, this.opts.openUrl, signal)
    if (!tokens.refreshToken) throw new AuthError('The sign-in did not return a refresh token. Remove the app from your account permissions and try again.')
    const http = createHttp(this.tokenManager(provider, tokens, null))
    let email: string
    let name: string | null = null
    if (provider === 'gmail') {
      email = (await GmailProvider.profile(http)).emailAddress
    } else {
      const me = await OutlookProvider.me(http)
      email = me.mail || me.userPrincipalName
      name = me.displayName ?? null
    }
    const existing = this.store.findAccount(provider, email)
    const id = existing?.id ?? `${provider}-${randomUUID().slice(0, 8)}`
    this.store.insertAccount({ id, provider, email, name, tokenEnc: this.opts.secrets.encrypt(JSON.stringify(tokens)) })
    this.providers.delete(id)
    this.events.emit({ type: 'accounts-changed' })
    void this.syncAccount(id)
    return this.store.getAccount(id)!
  }

  removeAccount(id: string): void {
    this.providers.delete(id)
    this.store.deleteAccount(id)
    this.events.emit({ type: 'accounts-changed' })
  }

  // ---------------------------------------------------------------- sync

  syncAll(): Promise<number[]> {
    return Promise.all(this.store.listAccounts().map((a) => this.syncAccount(a.id).catch(() => 0)))
  }

  /** Syncs one account; concurrent calls share the same run. Resolves with the number of new messages. */
  syncAccount(accountId: string): Promise<number> {
    const running = this.syncing.get(accountId)
    if (running) return running
    const run = this.doSync(accountId).finally(() => this.syncing.delete(accountId))
    this.syncing.set(accountId, run)
    return run
  }

  private async doSync(accountId: string): Promise<number> {
    const acct = this.store.getAccount(accountId)
    if (!acct) return 0
    const settings = this.store.getSettings()
    const added: string[] = []
    const h: SyncHandlers = {
      upsert: (msgs) => {
        added.push(...this.store.upsertMessages(accountId, msgs))
        this.notifyMessages(accountId)
      },
      remove: (ids) => {
        if (this.store.deleteMessages(accountId, ids)) this.notifyMessages(accountId)
      },
      patch: (pid, p) => {
        this.store.patchMessage(accountId, pid, p)
        this.notifyMessages(accountId)
      },
      exists: (pid) => this.store.hasMessage(accountId, pid),
      keepOnly: (pids) => {
        if (this.store.keepOnlyMessages(accountId, pids)) this.notifyMessages(accountId)
      }
    }
    this.events.emit({ type: 'sync-status', accountId, syncing: true, error: null })
    let error: string | null = null
    try {
      const provider = this.providerFor(accountId)
      const cursor = await provider.sync(acct.syncCursor, Date.now() - settings.syncDays * DAY, h)
      this.store.setSyncState(accountId, { cursor, error: null, syncedAt: Date.now() })
      this.store.clearSyncErrors(accountId)
    } catch (err) {
      error = err instanceof AuthError && err.needsReauth ? 'Signed out - please sign in again' : (err as Error).message
      this.store.setSyncState(accountId, { error })
      if (err instanceof AuthError) this.providers.delete(accountId)
    }
    this.events.emit({ type: 'sync-status', accountId, syncing: false, error })
    void this.autoTagNew(added).catch(() => undefined)
    if (!error) this.scheduleWriteback()
    return added.length
  }

  // ---------------------------------------------------------------- bodies

  /** Full body for the reading pane: from the LRU cache, else fetched from the provider and cached. */
  async getBody(messageId: string): Promise<{ content: string; isHtml: boolean } | null> {
    const cached = this.store.getBody(messageId)
    if (cached) return cached
    const msg = this.store.getMessage(messageId)
    if (!msg) return null
    const body = await this.providerFor(msg.accountId).fetchBody(msg.providerId)
    this.store.putBody(messageId, body.content, body.isHtml, this.store.getSettings().bodyCacheMB * 1024 * 1024)
    return body
  }

  /**
   * Marks messages read or unread here at once, then in Gmail/Outlook in the background (it never blocks the UI).
   * Messages that already have the wanted state are skipped.
   */
  async setRead(messageIds: string[], read: boolean): Promise<void> {
    const changed = messageIds.map((id) => this.store.getMessage(id)).filter((m): m is NonNullable<typeof m> => !!m && m.isRead !== read)
    for (const m of changed) this.store.setRead(m.id, read)
    for (const [accountId, items] of Map.groupBy(changed, (m) => m.accountId)) {
      this.notifyMessages(accountId)
      try {
        await this.providerFor(accountId).setRead(items.map((m) => m.providerId), read)
      } catch (err) {
        this.events.emit({ type: 'read-sync-failed', accountId, error: (err as Error).message })
      }
    }
  }

  markRead(messageId: string): Promise<void> {
    return this.setRead([messageId], true)
  }

  // ---------------------------------------------------------------- tagging

  /**
   * Tags emails and reports every step as events: progress while it runs, and a summary when it ends
   * (`auto` marks a run started by the sync rather than by the user).
   */
  async runTagging(opts: TaggingOptions & { auto?: boolean } = {}): Promise<TaggingResult> {
    const { auto = false, ...options } = opts
    let result: TaggingResult
    try {
      result = await this.tagger.run({
        ...options,
        onProgress: (progress) => {
          this.events.emit({ type: 'tagging-progress', progress })
          options.onProgress?.(progress)
        }
      })
    } catch (err) {
      // Never leave the UI waiting on a run that is not running any more.
      this.events.emit({ type: 'tagging-progress', progress: { done: 0, total: 0, stage: 'done' } })
      this.events.emit({ type: 'tagging-finished', summary: { total: 0, tagged: 0, failed: 0, ms: 0, error: (err as Error).message, auto } })
      throw err
    }
    this.events.emit({
      type: 'tagging-finished',
      summary: {
        total: result.total,
        tagged: result.tagged,
        failed: result.failed,
        ms: result.ms,
        error: result.error,
        errorKind: result.errorKind,
        model: result.model,
        failureSample: result.failureSample,
        auto
      }
    })
    // A run the user started that worked means Ollama is fine again: let automatic tagging resume.
    if (!auto && !result.error && result.tagged > 0) {
      this.autoTagFailures = 0
      this.autoTagPause = null
    }
    return result
  }

  /**
   * Tags the newest of the just-synced emails, a few at a time. It does nothing when automatic tagging is off
   * (or waits for the button because Ollama runs on this PC), and it pauses itself when Ollama keeps failing.
   * Whatever it leaves untagged waits for the "Tag new emails" button.
   */
  async autoTagNew(added: string[], now = Date.now()): Promise<TaggingResult | null> {
    const settings = this.store.getSettings()
    if (!added.length || !autoTagActive(settings)) return null
    // A pause only holds for the Ollama address and model it was set for; changing either lifts it.
    const key = `${settings.ollamaUrl}|${classifierModelOf(settings)}`
    if (this.autoTagPause?.key === key && now < this.autoTagPause.until) return null

    let result: TaggingResult
    try {
      result = await this.runTagging({ ids: added.slice(0, 5000), limit: AUTO_TAG_LIMIT, auto: true })
    } catch {
      return null // runTagging already told the UI
    }
    const failed = !!result.error || (result.total > 0 && result.tagged === 0)
    if (!failed) {
      this.autoTagFailures = 0
    } else if (++this.autoTagFailures >= AUTO_TAG_MAX_FAILURES) {
      this.autoTagFailures = 0
      this.autoTagPause = { key, until: now + AUTO_TAG_PAUSE_MIN * 60_000 }
      this.events.emit({ type: 'auto-tag-paused', reason: result.error ?? 'No email could be tagged.', minutes: AUTO_TAG_PAUSE_MIN })
    }
    return result
  }

  /** A tag chosen by the user: wins over rules and the model, and is remembered as a correction. */
  setUserTag(messageIds: string[], tag: Tag): number {
    let n = 0
    for (const id of messageIds) {
      if (!this.store.getMessage(id)) continue
      const previous = this.store.getTag(id)
      if (previous?.tag !== tag) this.store.addCorrection({ messageId: id, fromTag: previous?.tag ?? null, toTag: tag })
      this.store.setTag({ messageId: id, tag, source: 'user', confidence: 1, reason: 'set by you', model: null, version: 0 })
      n++
    }
    if (n) {
      this.events.emit({ type: 'tags-changed', ids: messageIds })
      this.scheduleWriteback()
    }
    return n
  }

  /** Server reachable? Models pulled? And, for a server on this PC, whether Ollama is installed. */
  async checkOllama(url?: string): Promise<OllamaHealth> {
    const s = this.store.getSettings()
    const health = await checkOllama(url ?? s.ollamaUrl, [s.chatModel, classifierModelOf(s)])
    if (!health.local) return health
    const binary = findOllamaBinary()
    return { ...health, installed: health.reachable || !!binary, binary: binary ?? undefined }
  }

  /** Starts the Ollama server on this PC and waits until it answers. Returns its health. */
  async startOllama(url?: string): Promise<OllamaHealth> {
    const target = url ?? this.store.getSettings().ollamaUrl
    if (!isLocalUrl(target)) throw new Error('MailSort can only start Ollama on this PC. The server address is another computer.')
    const already = await this.checkOllama(target)
    if (already.reachable) return already
    const binary = findOllamaBinary()
    if (!binary) throw new Error('Ollama is not installed on this PC. Download it from ollama.com/download.')
    startOllamaProcess(binary)
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500))
      const health = await this.checkOllama(target)
      if (health.reachable) return health
    }
    throw new Error('Ollama did not start. Try opening it from the Start menu.')
  }

  /**
   * Downloads a model on the Ollama host in the background. Progress arrives as "ollama-pull" events
   * and pullStatus(). Pulling a model that is already downloading does nothing.
   */
  pullModel(model: string, url?: string): void {
    const name = model.trim()
    if (!isValidModelName(name)) throw new Error(`"${model}" is not a valid model name. Use a name like qwen3:4b.`)
    if (this.pulls.has(name) && !this.pulls.get(name)!.progress.done) return
    const controller = new AbortController()
    const progress: PullProgress = { model: name, status: 'Starting' }
    this.pulls.set(name, { controller, progress })
    const client = new OllamaClient(url ?? this.store.getSettings().ollamaUrl)
    const tracker = new PullTracker()
    let lastEmit = 0
    const update = (patch: Partial<PullProgress>, force = false) => {
      Object.assign(progress, patch)
      const now = Date.now()
      if (force || now - lastEmit >= 150) {
        lastEmit = now
        this.events.emit({ type: 'ollama-pull', ...progress })
      }
    }
    void (async () => {
      try {
        update({}, true)
        for await (const chunk of client.pullStream(name, controller.signal)) update(tracker.update(chunk))
        update({ status: 'Done', done: true }, true)
      } catch (err) {
        const cancelled = err instanceof OllamaError && err.kind === 'aborted'
        update({ status: cancelled ? 'Cancelled' : 'Failed', done: true, error: cancelled ? undefined : (err as Error).message }, true)
      }
      // Finished downloads stay listed for a minute so a reopened Settings sheet can still show the result.
      setTimeout(() => {
        if (this.pulls.get(name)?.progress === progress) this.pulls.delete(name)
      }, 60_000).unref()
    })()
  }

  cancelPull(model: string): void {
    this.pulls.get(model.trim())?.controller.abort()
  }

  /** Downloads in progress or finished in the last minute. */
  pullStatus(): PullProgress[] {
    return [...this.pulls.values()].map((p) => ({ ...p.progress }))
  }

  // ---------------------------------------------------------------- write-back

  scheduleWriteback(delayMs = 2000): void {
    if (this.writebackTimer) clearTimeout(this.writebackTimer)
    this.writebackTimer = setTimeout(() => {
      this.writebackTimer = null
      void this.flushWriteback()
    }, delayMs)
  }

  /** Pushes pending tags to Gmail labels / Outlook categories. Safe to call any time. */
  async flushWriteback(): Promise<void> {
    if (this.writebackRunning) {
      this.writebackAgain = true
      return this.writebackRunning
    }
    this.writebackRunning = (async () => {
      do {
        this.writebackAgain = false
        if (!this.store.getSettings().writeBack) return
        const pending = this.store.pendingWriteback()
        if (!pending.length) return
        let ok = 0
        let failed = 0
        let lastError: string | undefined
        const byAccount = Map.groupBy(pending, (p) => p.accountId)
        for (const [accountId, items] of byAccount) {
          let res
          try {
            res = await this.providerFor(accountId).applyTags(
              items.map((p) => ({ providerId: p.providerId, tag: p.tag, providerLabels: p.providerLabels }))
            )
          } catch (err) {
            // Account signed out etc.: park these until its next successful sync clears the errors.
            lastError = (err as Error).message
            for (const p of items) this.store.markSyncError(p.messageId, lastError)
            failed += items.length
            continue
          }
          const tagOf = new Map(items.map((p) => [p.providerId, p.tag]))
          for (const r of res.ok) {
            this.store.markSynced(`${accountId}:${r.providerId}`, tagOf.get(r.providerId)!)
            this.store.patchMessage(accountId, r.providerId, { providerLabels: r.providerLabels })
          }
          for (const f of res.failed) {
            this.store.markSyncError(`${accountId}:${f.providerId}`, f.error)
            lastError = f.error
          }
          ok += res.ok.length
          failed += res.failed.length
        }
        this.events.emit({ type: 'writeback', ok, failed, error: lastError })
      } while (this.writebackAgain)
    })().finally(() => {
      this.writebackRunning = null
    })
    return this.writebackRunning
  }

  // ---------------------------------------------------------------- storage

  maintenance(): { textDropped: number; bodiesPruned: number } {
    const s = this.store.getSettings()
    return {
      textDropped: this.store.applyRetention(s.retentionDays),
      bodiesPruned: this.store.pruneBodies(s.bodyCacheMB * 1024 * 1024)
    }
  }
}
