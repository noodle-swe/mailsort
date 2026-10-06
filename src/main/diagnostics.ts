import os from 'node:os'
import { basename } from 'node:path'
import { app, powerMonitor, type BrowserWindow } from 'electron'
import type { Core } from '../core/core'
import type { Logger } from '../core/log'
import { eventToLog } from '../core/log-events'
import { OllamaClient } from '../core/ollama'

const gb = (n: number) => Math.round((n / 1024 ** 3) * 10) / 10

/** Free and total memory in GB: the first thing to look at when the PC slowed down. */
export const memory = () => ({ freeRamGB: gb(os.freemem()), totalRamGB: gb(os.totalmem()) })

/** Errors nobody caught and processes that died: the things that otherwise vanish without a trace. */
export function watchProcess(log: Logger): void {
  process.on('uncaughtException', (err) => log.error('main', 'uncaught exception', err))
  process.on('unhandledRejection', (reason) => log.error('main', 'unhandled promise rejection', reason))
  app.on('render-process-gone', (_e, _wc, d) => log.error('renderer', `window process gone: ${d.reason}`, undefined, { exitCode: d.exitCode }))
  app.on('child-process-gone', (_e, d) => log.error('process', `${d.type} process gone: ${d.reason}`, undefined, { exitCode: d.exitCode, name: d.name }))
}

/** One line about this PC and this build, so a log is understood without asking which laptop it came from. */
export async function logStartup(log: Logger, core: Core): Promise<void> {
  const s = core.store.getSettings()
  let gpu: unknown
  try {
    const info = (await Promise.race([app.getGPUInfo('basic'), new Promise((r) => setTimeout(() => r(null), 3000))])) as {
      gpuDevice?: { vendorId?: number; deviceId?: number; active?: boolean; driverVersion?: string }[]
    } | null
    gpu = info?.gpuDevice?.map((d) => ({ vendor: d.vendorId, device: d.deviceId, active: d.active, driver: d.driverVersion }))
  } catch {
    /* not available */
  }
  log.info('app', `MailSort ${app.getVersion()} started`, {
    packaged: app.isPackaged,
    electron: process.versions.electron,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpus: os.cpus().length,
    ...memory(),
    gpu,
    settings: { ollamaUrl: s.ollamaUrl, chatModel: s.chatModel, classifierModel: s.classifierModel || undefined, autoTag: s.autoTag, parallel: s.llmConcurrency }
  })
  const h = await core.checkOllama()
  log.info('ollama', h.reachable ? 'reachable at startup' : 'not reachable at startup', {
    version: h.version,
    models: h.models?.map((m) => m.name),
    missing: h.missing?.length ? h.missing : undefined,
    error: h.error
  })
}

/** What Ollama has loaded right now and how much memory it takes, written after a tagging problem. */
async function logOllamaState(log: Logger, core: Core): Promise<void> {
  const url = core.store.getSettings().ollamaUrl
  const client = new OllamaClient(url)
  const version = await client.version().catch((err) => `unreachable (${(err as Error).message})`)
  const loaded = await client.running().catch(() => null)
  log.info('ollama', 'state after the problem', {
    url,
    version,
    loaded: loaded?.map((m) => ({ name: m.name, totalGB: gb(m.size), inGpuGB: gb(m.sizeVram) })),
    ...memory()
  })
}

/** App events (sync, tagging, write-back, power) into the log. */
export function watchApp(log: Logger, core: Core): void {
  core.on((event) => {
    const entry = eventToLog(event)
    if (!entry) return
    const data = entry.scope === 'tagging' ? { ...entry.data, ...memory() } : entry.data
    if (entry.level === 'WARN') log.warn(entry.scope, entry.message, data)
    else log.info(entry.scope, entry.message, data)
    if (event.type === 'tagging-finished' && (event.summary.error || event.summary.failed > 0)) void logOllamaState(log, core)
  })
  powerMonitor.on('suspend', () => log.info('power', 'the computer is going to sleep'))
  powerMonitor.on('resume', () => log.info('power', 'the computer woke up'))
}

/** Window freezes and errors printed by the interface code. */
export function watchWindow(log: Logger, win: BrowserWindow): void {
  win.on('unresponsive', () => log.warn('window', 'the window is not responding'))
  win.on('responsive', () => log.info('window', 'the window responds again'))
  win.webContents.on('did-fail-load', (_e, code, description) => log.error('window', `page failed to load: ${description}`, undefined, { code }))
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error') log.error('renderer', details.message, undefined, { file: basename(details.sourceId), line: details.lineNumber })
  })
}
