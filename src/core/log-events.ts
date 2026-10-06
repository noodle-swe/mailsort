import type { CoreEvent } from './events'
export interface LogEntry {
  /** Routine events are INFO and problems are WARN; ERROR is kept for things that threw. */
  level: 'INFO' | 'WARN'
  scope: string
  message: string
  data?: Record<string, unknown>
}

/** Drops fields that are undefined, so the log line only carries what is known. */
const known = (o: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

/**
 * What goes into the log for an app event, or null when it is routine. Only counts, ids of accounts, model names
 * and error text are logged: never an email's subject, sender or text.
 */
export function eventToLog(e: CoreEvent): LogEntry | null {
  switch (e.type) {
    case 'sync-status':
      return e.error ? { level: 'WARN', scope: 'sync', message: `sync failed: ${e.error}`, data: { account: e.accountId } } : null
    case 'tagging-finished': {
      const s = e.summary
      const data = known({ total: s.total, tagged: s.tagged, failed: s.failed, ms: s.ms, auto: s.auto, model: s.model, errorKind: s.errorKind, failureSample: s.failureSample })
      if (s.error) return { level: 'WARN', scope: 'tagging', message: `run stopped: ${s.error}`, data }
      if (s.failed > 0) return { level: 'WARN', scope: 'tagging', message: `run finished, ${s.failed} could not be tagged`, data }
      if (s.auto && s.total === 0) return null
      return { level: 'INFO', scope: 'tagging', message: `tagged ${s.tagged} of ${s.total}`, data }
    }
    case 'auto-tag-paused':
      return { level: 'WARN', scope: 'tagging', message: `automatic tagging paused for ${e.minutes} minutes: ${e.reason}` }
    case 'writeback':
      return e.failed ? { level: 'WARN', scope: 'writeback', message: 'tags could not be saved to the mailbox', data: known({ ok: e.ok, failed: e.failed, error: e.error }) } : null
    case 'read-sync-failed':
      return { level: 'WARN', scope: 'sync', message: `could not mark mail read in the mailbox: ${e.error}`, data: { account: e.accountId } }
    case 'ollama-pull':
      if (e.error) return { level: 'WARN', scope: 'ollama', message: `model download failed: ${e.error}`, data: { model: e.model } }
      return e.done ? { level: 'INFO', scope: 'ollama', message: `model download ${e.status.toLowerCase()}`, data: { model: e.model } } : null
    default:
      return null
  }
}
