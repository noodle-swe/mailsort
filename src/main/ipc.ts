import { randomUUID } from 'node:crypto'
import { ipcMain, shell, type BrowserWindow } from 'electron'
import type { Core } from '../core/core'
import { isTag } from '../core/tags'
import { sanitizeQuery } from '../core/query'
import type { Provider } from '../core/types'
import type { AppEvent, AppStatus, ChatTurn } from '../preload/api'
import type { ChatAgent } from './agent'
import type { HttpMcpServer } from './http-mcp'

interface Deps {
  core: Core
  agent: ChatAgent
  httpMcp: HttpMcpServer
  window: () => BrowserWindow | null
  status: () => AppStatus
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

export function registerIpc({ core, agent, httpMcp, window, status }: Deps): void {
  const send = (event: AppEvent) => {
    const w = window()
    if (w && !w.isDestroyed()) w.webContents.send('app:event', event)
  }

  // Tagging emits one progress event per email; forward at most ~10 per second.
  let lastProgress = 0
  core.on((event) => {
    if (event.type === 'tagging-progress' && event.progress.stage !== 'done') {
      const now = Date.now()
      if (now - lastProgress < 100) return
      lastProgress = now
    }
    send(event)
  })

  const handle = (channel: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, (_event, ...args) => fn(...args))

  handle('status', () => status())

  handle('messages:list', (q) => core.store.listMessages(sanitizeQuery(q)))
  handle('messages:get', (id) => core.store.getMessage(String(id)))
  handle('messages:body', (id) => core.getBody(String(id)))
  handle('messages:markRead', (id) => {
    void core.markRead(String(id))
  })
  handle('messages:setRead', (ids, read) => {
    if (!Array.isArray(ids) || typeof read !== 'boolean') throw new Error('Invalid read request')
    void core.setRead(ids.map(String).slice(0, 1000), read)
  })
  handle('digest:get', (range) => {
    const o = (range ?? {}) as Record<string, unknown>
    return core.store.digest({
      since: typeof o.since === 'number' ? o.since : undefined,
      until: typeof o.until === 'number' ? o.until : undefined
    })
  })
  handle('messages:unread', () => core.store.unreadCounts())

  handle('tags:set', (ids, tag) => {
    if (!Array.isArray(ids) || !isTag(tag)) throw new Error('Invalid tag request')
    return core.setUserTag(ids.map(String), tag)
  })
  handle('tags:counts', (accountId) => core.store.tagCounts({ accountId: str(accountId) }))
  handle('tags:run', (opts) => {
    const o = (opts ?? {}) as Record<string, unknown>
    return core.runTagging({
      retag: o.retag === true,
      accountId: str(o.accountId),
      since: typeof o.since === 'number' ? o.since : undefined
    })
  })

  let adding: AbortController | null = null
  handle('accounts:list', () => core.store.listAccounts())
  handle('accounts:add', async (provider) => {
    if (provider !== 'gmail' && provider !== 'outlook') throw new Error('Unknown provider')
    adding?.abort()
    adding = new AbortController()
    try {
      return await core.addAccount(provider as Provider, adding.signal)
    } finally {
      adding = null
    }
  })
  handle('accounts:cancelAdd', () => adding?.abort())
  handle('accounts:remove', (id) => core.removeAccount(String(id)))
  handle('accounts:sync', (id) => {
    void (str(id) ? core.syncAccount(String(id)) : core.syncAll())
  })

  handle('settings:get', () => core.store.getSettings())
  handle('settings:update', async (patch) => {
    const settings = core.store.updateSettings((patch ?? {}) as Record<string, unknown>)
    if (settings.mcpHttpEnabled) await httpMcp.start(settings.mcpHttpPort)
    else await httpMcp.stop()
    return settings
  })
  handle('ollama:check', (url) => core.checkOllama(str(url)))

  handle('storage:stats', () => core.store.storageStats())
  handle('storage:clear', () => {
    core.store.clearBodyCache()
    return core.store.storageStats()
  })

  handle('chat:send', (turns) => {
    const clean: ChatTurn[] = (Array.isArray(turns) ? turns : [])
      .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
      .map((t) => ({ role: t.role, content: String(t.content).slice(0, 8000) }))
    const runId = randomUUID()
    void agent.run(runId, clean, send)
    return runId
  })
  handle('chat:cancel', (runId) => agent.cancel(String(runId)))

  handle('shell:open', (url) => {
    const u = String(url)
    if (/^(https?|mailto):/i.test(u)) return shell.openExternal(u)
  })
}
