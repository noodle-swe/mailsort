import { createServer, type RequestListener, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Core } from '../src/core/core'
import type { CoreEvent } from '../src/core/events'
import { checkOllama, isLocalUrl, isValidModelName, OllamaClient, PullTracker, type PullChunk } from '../src/core/ollama'
import { candidatePaths, findOllamaBinary } from '../src/core/ollama-local'
import { supportsTools } from '../src/core/ollama-models'
import { makeCore } from './helpers'

/** A fake Ollama with a mutable model list and a scripted /api/pull stream. */
class FakeOllama {
  server!: Server
  url = ''
  models: string[] = ['qwen2.5:7b']
  pullLines: (object | string)[] = []
  pullStatus = 200
  pullDelayMs = 0
  pulled: string[] = []

  async start() {
    this.server = createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.35.1' }))
        if (req.url === '/api/tags') return res.end(JSON.stringify({ models: this.models.map((name) => ({ name, size: 2e9, details: { parameter_size: '4B' } })) }))
        if (req.url === '/api/pull') {
          this.pulled.push(JSON.parse(raw).model)
          res.statusCode = this.pullStatus
          const lines = [...this.pullLines]
          const next = () => {
            const line = lines.shift()
            if (line === undefined) return res.end()
            res.write((typeof line === 'string' ? line : JSON.stringify(line)) + '\n')
            setTimeout(next, this.pullDelayMs)
          }
          return next()
        }
        res.statusCode = 404
        res.end('{}')
      })
    })
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r))
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }
  stop() {
    this.server.closeAllConnections()
    this.server.close()
  }
}

let ollama: FakeOllama
let core: Core | undefined

beforeEach(async () => {
  ollama = new FakeOllama()
  await ollama.start()
})
afterEach(() => {
  ollama.stop()
  core?.close()
  core = undefined
})

const layer = (digest: string, completed: number, total: number): PullChunk => ({ status: `pulling ${digest}`, digest, total, completed })

describe('PullTracker', () => {
  it('sums layers into one completed/total and labels the step', () => {
    const t = new PullTracker()
    expect(t.update({ status: 'pulling manifest' })).toEqual({ status: 'Starting', completed: undefined, total: undefined })
    expect(t.update(layer('a', 100, 1000))).toEqual({ status: 'Downloading', completed: 100, total: 1000 })
    expect(t.update(layer('b', 50, 500))).toEqual({ status: 'Downloading', completed: 150, total: 1500 })
    expect(t.update(layer('a', 1000, 1000))).toMatchObject({ completed: 1050, total: 1500 })
    expect(t.update({ status: 'verifying sha256 digest' })).toMatchObject({ status: 'Verifying', completed: 1050 })
    expect(t.update({ status: 'writing manifest' }).status).toBe('Finishing')
    expect(t.update({ status: 'success' }).status).toBe('Done')
  })

  it('never reports more than the total for a layer', () => {
    const t = new PullTracker()
    expect(t.update(layer('a', 2000, 1000))).toMatchObject({ completed: 1000, total: 1000 })
  })
})

describe('model names and addresses', () => {
  it('accepts normal Ollama names and rejects anything odd', () => {
    for (const ok of ['qwen3:4b', 'llama3.2:3b', 'library/llama3.1:8b', 'hf.co/user/model-GGUF:Q4_K_M', 'mistral']) expect(isValidModelName(ok)).toBe(true)
    for (const bad of ['', 'qwen 3', 'a;rm -rf', '../etc', 'x'.repeat(101), 'model:', ':tag']) expect(isValidModelName(bad)).toBe(false)
  })

  it('knows which addresses are this PC', () => {
    expect(isLocalUrl('http://127.0.0.1:11434')).toBe(true)
    expect(isLocalUrl('http://localhost:11434')).toBe(true)
    expect(isLocalUrl('http://192.168.1.50:11434')).toBe(false)
    expect(isLocalUrl('not a url')).toBe(false)
  })

  it('flags models without tool calling', () => {
    expect(supportsTools('gemma3:4b')).toBe(false)
    expect(supportsTools('qwen3:4b')).toBe(true)
    expect(supportsTools('some-new-model:1b')).toBeNull()
  })
})

describe('finding the Ollama program', () => {
  it('looks in the install folder first on Windows, then on PATH', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\Sam\\AppData\\Local', ProgramFiles: 'C:\\Program Files', Path: 'C:\\Tools;C:\\Other' }
    expect(candidatePaths({ platform: 'win32', env })).toEqual([
      'C:\\Users\\Sam\\AppData\\Local\\Programs\\Ollama\\ollama.exe',
      'C:\\Program Files\\Ollama\\ollama.exe',
      'C:\\Tools\\ollama.exe',
      'C:\\Other\\ollama.exe'
    ])
  })

  it('returns the first path that exists, or null when Ollama is not installed', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\Sam\\AppData\\Local', Path: 'C:\\Tools' }
    const hit = 'C:\\Tools\\ollama.exe'
    expect(findOllamaBinary({ platform: 'win32', env, exists: (p) => p === hit })).toBe(hit)
    expect(findOllamaBinary({ platform: 'win32', env, exists: () => false })).toBeNull()
  })

  it('uses the usual folders on macOS and Linux', () => {
    expect(candidatePaths({ platform: 'darwin', env: { PATH: '/bin' } })).toContain('/Applications/Ollama.app/Contents/Resources/ollama')
    expect(candidatePaths({ platform: 'linux', env: { PATH: '/opt/bin' } })).toEqual(['/usr/local/bin/ollama', '/usr/bin/ollama', '/opt/bin/ollama'])
  })
})

describe('health check', () => {
  it('reports a reachable server on this PC as installed', async () => {
    const h = await checkOllama(ollama.url, ['qwen2.5:7b'])
    expect(h).toMatchObject({ ok: true, reachable: true, local: true, installed: true, version: '0.35.1' })
    expect(h.models?.[0]).toMatchObject({ name: 'qwen2.5:7b', parameterSize: '4B' })
  })

  it('reports an unreachable address as not reachable, with no guess about installation', async () => {
    const h = await checkOllama('http://192.0.2.1:9', ['x'])
    expect(h).toMatchObject({ ok: false, reachable: false, local: false, installed: null })
  })

  it('Core fills in installed for an address on this PC even when the server is down', async () => {
    core = makeCore()
    const h = await core.checkOllama('http://127.0.0.1:9')
    expect(h).toMatchObject({ reachable: false, local: true })
    expect(typeof h.installed).toBe('boolean')
  })
})

describe('pullStream', () => {
  it('streams progress lines', async () => {
    ollama.pullLines = [{ status: 'pulling manifest' }, layer('a', 10, 100), { status: 'success' }]
    const seen: string[] = []
    for await (const c of new OllamaClient(ollama.url).pullStream('qwen3:4b')) seen.push(c.status)
    expect(seen).toEqual(['pulling manifest', 'pulling a', 'success'])
    expect(ollama.pulled).toEqual(['qwen3:4b'])
  })

  it('turns an error line (unknown model) into an error', async () => {
    ollama.pullLines = [{ status: 'pulling manifest' }, { error: 'pull model manifest: file does not exist' }]
    const run = async () => {
      for await (const c of new OllamaClient(ollama.url).pullStream('nope:1b')) void c
    }
    await expect(run()).rejects.toThrow('file does not exist')
  })
})

describe('Core.pullModel', () => {
  const waitFor = async (cond: () => boolean) => {
    for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 20))
    expect(cond()).toBe(true)
  }
  const pullEvents = (events: CoreEvent[]) => events.filter((e): e is Extract<CoreEvent, { type: 'ollama-pull' }> => e.type === 'ollama-pull')

  it('downloads in the background and reports progress, then Done', async () => {
    core = makeCore()
    const events: CoreEvent[] = []
    core.on((e) => events.push(e))
    ollama.pullLines = [{ status: 'pulling manifest' }, layer('a', 50, 100), layer('a', 100, 100), { status: 'verifying sha256 digest' }, { status: 'success' }]
    core.pullModel('qwen3:4b', ollama.url)
    await waitFor(() => pullEvents(events).some((e) => e.done))
    const last = pullEvents(events).at(-1)!
    expect(last).toMatchObject({ model: 'qwen3:4b', status: 'Done', done: true, completed: 100, total: 100 })
    expect(core.pullStatus()).toMatchObject([{ model: 'qwen3:4b', status: 'Done' }])
  })

  it('reports a failure with the reason', async () => {
    core = makeCore()
    const events: CoreEvent[] = []
    core.on((e) => events.push(e))
    ollama.pullLines = [{ error: 'pull model manifest: file does not exist' }]
    core.pullModel('nope:1b', ollama.url)
    await waitFor(() => pullEvents(events).some((e) => e.done))
    expect(pullEvents(events).at(-1)).toMatchObject({ status: 'Failed', error: expect.stringContaining('file does not exist') })
  })

  it('rejects odd names and ignores a second pull of the same model while one runs', async () => {
    core = makeCore()
    expect(() => core!.pullModel('a;b', ollama.url)).toThrow('not a valid model name')
    const events: CoreEvent[] = []
    core.on((e) => events.push(e))
    ollama.pullDelayMs = 40
    ollama.pullLines = [{ status: 'pulling manifest' }, layer('a', 1, 10), layer('a', 5, 10), { status: 'success' }]
    core.pullModel('qwen3:4b', ollama.url)
    core.pullModel('qwen3:4b', ollama.url)
    await waitFor(() => pullEvents(events).some((e) => e.done))
    expect(ollama.pulled).toEqual(['qwen3:4b'])
  })

  it('cancels a download', async () => {
    core = makeCore()
    const events: CoreEvent[] = []
    core.on((e) => events.push(e))
    ollama.pullDelayMs = 100
    ollama.pullLines = Array.from({ length: 30 }, (_, i) => layer('a', i, 30))
    core.pullModel('qwen3:4b', ollama.url)
    await waitFor(() => pullEvents(events).some((e) => e.status === 'Downloading'))
    core.cancelPull('qwen3:4b')
    await waitFor(() => pullEvents(events).some((e) => e.done))
    expect(pullEvents(events).at(-1)).toMatchObject({ status: 'Cancelled', done: true })
    expect(pullEvents(events).at(-1)!.error).toBeUndefined()
  })

  it('will not start Ollama for a server on another computer', async () => {
    core = makeCore()
    await expect(core.startOllama('http://192.168.1.50:11434')).rejects.toThrow('another computer')
  })
})

describe('OllamaClient connection errors', () => {
  const listen = async (handler: RequestListener = (_req, res) => res.end('{}')) => {
    const server = createServer(handler)
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
  }
  const ask = (url: string) => new OllamaClient(url).chat({ model: 'm', messages: [] })

  it('calls a connection that Ollama closes "dropped", so the caller can retry it', async () => {
    const { server, url } = await listen((req) => req.socket.destroy())
    try {
      await expect(ask(url)).rejects.toMatchObject({ name: 'OllamaError', kind: 'dropped' })
    } finally {
      server.closeAllConnections()
      server.close()
    }
  })

  it('calls a port nobody listens on "unreachable", which is not worth retrying', async () => {
    const { server, url } = await listen()
    await new Promise<void>((r) => server.close(() => r()))
    await expect(ask(url)).rejects.toMatchObject({ name: 'OllamaError', kind: 'unreachable' })
  })
})
