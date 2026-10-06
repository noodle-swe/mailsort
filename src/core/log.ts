import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'INFO' | 'WARN' | 'ERROR'

export interface LoggerOptions {
  /** Folder for the log files; created when missing. */
  dir: string
  /** The newest file; older ones become `name.1.log`, `name.2.log`, ... Default `mailsort.log`. */
  file?: string
  /** A file is rotated once it passes this size. Default 1 MB. */
  maxBytes?: number
  /** How many rotated files to keep besides the current one. Default 3. */
  keep?: number
  /** For tests. */
  now?: () => Date
}

const MAX_DATA_CHARS = 1500
const MAX_STACK_LINES = 12
/** The same line again within this long is counted instead of written. */
const REPEAT_WINDOW_MS = 10 * 60_000

/**
 * Masks what must not leave the PC in a log that gets sent to someone for help: mailbox addresses (the domain stays,
 * it is useful), sign-in tokens and secrets. Email subjects and text are never logged in the first place.
 */
export function redact(text: string): string {
  return text
    .replace(/\b[\w.+-]+@([\w-]+(?:\.[\w-]+)+)\b/g, '***@$1')
    .replace(/\bBearer\s+[\w.~+/=-]+/gi, 'Bearer ***')
    .replace(/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}\b/g, '***jwt***')
    .replace(/(["']?(?:access_token|refresh_token|id_token|client_secret|password)["']?\s*[=:]\s*["']?)[^\s"'&,}]+/gi, '$1***')
    // The one-time code in a sign-in redirect URL (not Node error codes such as ECONNRESET, which are what we want to see).
    .replace(/([?&](?:code|state)=)[^&\s"']+/gi, '$1***')
}

/** Local time with its offset, like Ollama's own log, so the two can be read side by side. */
export function localIso(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  const off = -d.getTimezoneOffset()
  const a = Math.abs(off)
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}` +
    `${off >= 0 ? '+' : '-'}${p(Math.floor(a / 60))}:${p(a % 60)}`
  )
}

/**
 * A plain-text log file, one entry per line (errors add an indented stack). It never throws: a log that cannot
 * be written must not break the app. Identical entries in a row are counted, so a sync that fails every minute
 * does not bury everything else.
 */
export class Logger {
  readonly dir: string
  readonly path: string
  private readonly maxBytes: number
  private readonly keep: number
  private readonly now: () => Date
  private readonly base: string
  private last: { key: string; at: number; skipped: number } | null = null

  constructor(opts: LoggerOptions) {
    this.dir = opts.dir
    this.base = (opts.file ?? 'mailsort.log').replace(/\.log$/, '')
    this.path = join(opts.dir, `${this.base}.log`)
    this.maxBytes = opts.maxBytes ?? 1_000_000
    this.keep = opts.keep ?? 3
    this.now = opts.now ?? (() => new Date())
    try {
      mkdirSync(opts.dir, { recursive: true })
    } catch {
      /* the first write reports nothing and is skipped */
    }
  }

  info(scope: string, message: string, data?: Record<string, unknown>): void {
    this.write('INFO', scope, message, undefined, data)
  }

  warn(scope: string, message: string, data?: Record<string, unknown>): void {
    this.write('WARN', scope, message, undefined, data)
  }

  /** `err` may be an Error or anything thrown; its stack is added under the line. */
  error(scope: string, message: string, err?: unknown, data?: Record<string, unknown>): void {
    this.write('ERROR', scope, message, err, data)
  }

  /** The last `maxLines` lines (reaching into the previous file when this one is short), for pasting into a bug report. */
  tail(maxLines = 200): string {
    const read = (p: string) => {
      try {
        return existsSync(p) ? readFileSync(p, 'utf8') : ''
      } catch {
        return ''
      }
    }
    let lines = read(this.path).split(/\r?\n/).filter(Boolean)
    if (lines.length < maxLines) lines = [...read(join(this.dir, `${this.base}.1.log`)).split(/\r?\n/).filter(Boolean), ...lines]
    return lines.slice(-maxLines).join('\n')
  }

  private write(level: LogLevel, scope: string, message: string, err?: unknown, data?: Record<string, unknown>): void {
    try {
      const at = this.now()
      const errText = err === undefined ? '' : err instanceof Error ? err.message : String(err)
      const head = [message, errText && !message.includes(errText) ? errText : ''].filter(Boolean).join(': ')
      const json = data && Object.keys(data).length ? JSON.stringify(data) : ''
      // The extra details are part of the match: the same failure for two accounts is two entries.
      const key = `${level}|${scope}|${head}|${json}`
      if (this.last && this.last.key === key && at.getTime() - this.last.at < REPEAT_WINDOW_MS) {
        this.last.skipped++
        return
      }
      const out: string[] = []
      if (this.last?.skipped) out.push(`${localIso(at)} ${' '.repeat(5)} (the line above repeated ${this.last.skipped} more ${this.last.skipped === 1 ? 'time' : 'times'})`)
      let line = `${localIso(at)} ${level.padEnd(5)} ${scope}: ${head.replace(/\s*\r?\n\s*/g, ' | ')}`
      if (json) line += ` ${json.length > MAX_DATA_CHARS ? json.slice(0, MAX_DATA_CHARS) + '...' : json}`
      out.push(line)
      if (err instanceof Error && err.stack) {
        const stack = err.stack.split('\n').slice(1, 1 + MAX_STACK_LINES)
        for (const s of stack) out.push(`      ${s.trim()}`)
      }
      this.rotateIfNeeded()
      appendFileSync(this.path, redact(out.join('\n')) + '\n', 'utf8')
      this.last = { key, at: at.getTime(), skipped: 0 }
    } catch {
      /* never let logging break the app */
    }
  }

  private rotateIfNeeded(): void {
    try {
      if (!existsSync(this.path) || statSync(this.path).size < this.maxBytes) return
      const file = (n: number) => join(this.dir, `${this.base}.${n}.log`)
      rmSync(file(this.keep), { force: true })
      for (let n = this.keep - 1; n >= 1; n--) if (existsSync(file(n))) renameSync(file(n), file(n + 1))
      renameSync(this.path, file(1))
    } catch {
      /* keep appending to the current file */
    }
  }
}
