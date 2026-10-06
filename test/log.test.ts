import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CoreEvent } from '../src/core/events'
import { Logger, localIso, redact } from '../src/core/log'
import { eventToLog } from '../src/core/log-events'
import { OllamaError } from '../src/core/ollama'
import { fakeClassifier, FIXTURES, seededCore } from './helpers'
import type { Tag } from '../src/core/tags'

const dirs: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'mailsort-log-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** A clock the test moves by hand. */
const clock = (start = Date.UTC(2026, 9, 5, 12)) => {
  let t = start
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) }
}

describe('redact', () => {
  it('hides mailbox addresses but keeps the domain', () => {
    expect(redact('sam.lee+jobs@gmail.com needs to sign in again')).toBe('***@gmail.com needs to sign in again')
  })

  it('hides sign-in tokens and secrets', () => {
    expect(redact('Authorization: Bearer ya29.a0AfH6SMBxyz-123')).toBe('Authorization: Bearer ***')
    expect(redact('{"access_token":"ya29.abc","refresh_token":"1//0gXYZ","other":"kept"}')).toBe('{"access_token":"***","refresh_token":"***","other":"kept"}')
    expect(redact('GET /cb?code=4/0AbCdEf&state=xyz HTTP/1.1')).toBe('GET /cb?code=***&state=*** HTTP/1.1')
    expect(redact('token eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl end')).toBe('token ***jwt*** end')
  })

  it('leaves the error codes that explain a problem', () => {
    const line = 'Error: read ECONNRESET (code: ECONNRESET) at http://127.0.0.1:11434'
    expect(redact(line)).toBe(line)
  })
})

describe('Logger', () => {
  it('writes one line per entry with time, level and scope', () => {
    const dir = tmp()
    const log = new Logger({ dir })
    log.info('app', 'started', { cpus: 12 })
    log.warn('sync', 'sync failed')
    const lines = readFileSync(log.path, 'utf8').trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2} INFO {2}app: started \{"cpus":12\}$/)
    expect(lines[1]).toMatch(/ WARN {2}sync: sync failed$/)
  })

  it('adds the stack under an error and keeps each message on one line', () => {
    const log = new Logger({ dir: tmp() })
    log.error('ipc', 'tags:run failed', new Error('first line\nsecond line'))
    const text = readFileSync(log.path, 'utf8')
    expect(text.split('\n')[0]).toMatch(/ERROR ipc: tags:run failed: first line \| second line$/)
    expect(text).toMatch(/\n {6}at /) // stack frames are indented under it
  })

  it('never writes addresses or tokens', () => {
    const log = new Logger({ dir: tmp() })
    log.warn('sync', 'sam@outlook.com needs to sign in again', { header: 'Bearer abc.def.ghi' })
    const text = readFileSync(log.path, 'utf8')
    expect(text).not.toContain('sam@outlook.com')
    expect(text).not.toContain('abc.def.ghi')
    expect(text).toContain('***@outlook.com')
  })

  it('counts the same entry repeating instead of writing it every time', () => {
    const c = clock()
    const log = new Logger({ dir: tmp(), now: c.now })
    for (let i = 0; i < 5; i++) {
      log.warn('sync', 'sync failed: offline')
      c.advance(60_000)
    }
    log.info('app', 'something else')
    const lines = readFileSync(log.path, 'utf8').trimEnd().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toMatch(/\(the line above repeated 4 more times\)$/)
  })

  it('does not mix up the same failure on two accounts', () => {
    const log = new Logger({ dir: tmp() })
    log.warn('sync', 'sync failed: offline', { account: 'gmail-1' })
    log.warn('sync', 'sync failed: offline', { account: 'outlook-2' })
    const text = readFileSync(log.path, 'utf8')
    expect(text).toContain('gmail-1')
    expect(text).toContain('outlook-2')
  })

  it('writes the entry again once the repeat window has passed', () => {
    const c = clock()
    const log = new Logger({ dir: tmp(), now: c.now })
    log.warn('sync', 'sync failed: offline')
    c.advance(11 * 60_000)
    log.warn('sync', 'sync failed: offline')
    expect(readFileSync(log.path, 'utf8').trimEnd().split('\n')).toHaveLength(2)
  })

  it('starts a new file when one gets too big, and keeps only a few old ones', () => {
    const dir = tmp()
    const log = new Logger({ dir, maxBytes: 300, keep: 2 })
    for (let i = 0; i < 40; i++) log.info('app', `entry number ${i} ${'x'.repeat(40)}`)
    const files = readdirSync(dir).sort()
    expect(files).toEqual(['mailsort.1.log', 'mailsort.2.log', 'mailsort.log'])
    expect(readFileSync(log.path, 'utf8')).toContain('entry number 39')
  })

  it('gives the newest lines, reaching into the previous file when the current one is short', () => {
    const dir = tmp()
    const log = new Logger({ dir, maxBytes: 400 })
    for (let i = 0; i < 12; i++) log.info('app', `entry ${String(i).padStart(2, '0')} ${'x'.repeat(50)}`)
    const tail = log.tail(5).split('\n')
    expect(tail).toHaveLength(5)
    expect(tail.at(-1)).toContain('entry 11')
    expect(tail[0]).toContain('entry 07')
  })

  it('has an empty tail before anything was written', () => {
    expect(new Logger({ dir: tmp() }).tail()).toBe('')
  })

  it('never throws when the log cannot be written', () => {
    const dir = tmp()
    const blocker = join(dir, 'not-a-folder')
    writeFileSync(blocker, 'x')
    const log = new Logger({ dir: join(blocker, 'logs') }) // a folder cannot be made under a file
    expect(() => log.error('main', 'boom', new Error('x'))).not.toThrow()
    expect(existsSync(join(blocker, 'logs'))).toBe(false)
  })

  it('writes time with its offset, like the Ollama log', () => {
    expect(localIso(new Date(2026, 9, 5, 9, 5, 7, 42))).toMatch(/^2026-10-05T09:05:07\.042[+-]\d{2}:\d{2}$/)
  })
})

describe('what goes into the log from app events', () => {
  const finished = (o: Partial<Extract<CoreEvent, { type: 'tagging-finished' }>['summary']> = {}): CoreEvent => ({
    type: 'tagging-finished',
    summary: { total: 222, tagged: 191, failed: 31, ms: 31_000, auto: false, ...o }
  })

  it('records a tagging run that stopped, with the kind of problem and the model', () => {
    const e = eventToLog(finished({ error: 'Ollama dropped the connection (ECONNRESET)', errorKind: 'dropped', model: 'qwen2.5:3b' }))
    expect(e).toMatchObject({ level: 'WARN', scope: 'tagging', message: expect.stringContaining('dropped the connection') })
    expect(e?.data).toMatchObject({ total: 222, tagged: 191, failed: 31, errorKind: 'dropped', model: 'qwen2.5:3b', auto: false })
  })

  it('records partial failures, and good runs as plain information', () => {
    expect(eventToLog(finished({ failed: 3 }))).toMatchObject({ level: 'WARN' })
    expect(eventToLog(finished({ failed: 0, tagged: 222 }))).toMatchObject({ level: 'INFO', message: 'tagged 222 of 222' })
  })

  it('stays quiet about an automatic run that found nothing, and about routine events', () => {
    expect(eventToLog(finished({ auto: true, total: 0, tagged: 0, failed: 0 }))).toBeNull()
    expect(eventToLog({ type: 'messages-changed', accountId: 'a' })).toBeNull()
    expect(eventToLog({ type: 'sync-status', accountId: 'a', syncing: false, error: null })).toBeNull()
    expect(eventToLog({ type: 'writeback', ok: 5, failed: 0 })).toBeNull()
  })

  it('records sync and write-back problems by account id, not by address', () => {
    expect(eventToLog({ type: 'sync-status', accountId: 'gmail-1a2b', syncing: false, error: 'Signed out - please sign in again' })).toEqual({
      level: 'WARN',
      scope: 'sync',
      message: 'sync failed: Signed out - please sign in again',
      data: { account: 'gmail-1a2b' }
    })
    expect(eventToLog({ type: 'writeback', ok: 2, failed: 3, error: 'HTTP 403' })).toMatchObject({ level: 'WARN', scope: 'writeback', data: { ok: 2, failed: 3, error: 'HTTP 403' } })
    expect(eventToLog({ type: 'auto-tag-paused', reason: 'Ollama is down', minutes: 30 })?.message).toMatch(/paused for 30 minutes: Ollama is down/)
  })

  it('never carries an email subject or sender', async () => {
    const { core } = seededCore(fakeClassifier(new Map<string, Tag>(), { fail: new OllamaError('Ollama dropped the connection', 'dropped') }))
    try {
      const entries: string[] = []
      core.on((e) => {
        const entry = eventToLog(e)
        if (entry) entries.push(JSON.stringify(entry))
      })
      await core.runTagging({ retryDelaysMs: [0, 0] })
      expect(entries.length).toBeGreaterThan(0)
      const all = entries.join('\n')
      for (const f of FIXTURES) {
        expect(all).not.toContain(f.subject!)
        if (f.fromAddr) expect(all).not.toContain(f.fromAddr)
      }
    } finally {
      core.close()
    }
  })
})
