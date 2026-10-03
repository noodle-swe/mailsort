import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChatAgent } from '../src/main/agent'
import { createOllamaClassifier } from '../src/core/classify/llm'
import { checkOllama } from '../src/core/ollama'
import type { Core } from '../src/core/core'
import type { ChatEvent } from '../src/preload/api'
import type { Tag } from '../src/core/tags'
import { fakeClassifier, FIXTURES, seededCore } from './helpers'

/** A fake Ollama: answers /api/chat from a queue of scripted replies and records requests. */
class FakeOllama {
  server!: Server
  url = ''
  requests: Record<string, any>[] = []
  replies: ((body: Record<string, any>) => { status?: number; chunks?: object[]; json?: object })[] = []

  async start() {
    this.server = createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.12.0' }))
        if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:7b', size: 4.7e9, details: {} }] }))
        const body = raw ? JSON.parse(raw) : {}
        this.requests.push(body)
        const reply = this.replies.shift()?.(body) ?? { chunks: [{ message: { role: 'assistant', content: 'ok' }, done: true }] }
        res.statusCode = reply.status ?? 200
        if (reply.json) return res.end(JSON.stringify(reply.json))
        for (const c of reply.chunks ?? []) res.write(JSON.stringify(c) + '\n')
        res.end()
      })
    })
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r))
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }
  stop() {
    this.server.close()
  }
}

let ollama: FakeOllama
let core: Core

beforeEach(async () => {
  ollama = new FakeOllama()
  await ollama.start()
  const answers = new Map<string, Tag>(FIXTURES.map((f) => [f.subject!, f.expected]))
  ;({ core } = seededCore(fakeClassifier(answers)))
  core.store.updateSettings({ ollamaUrl: ollama.url, chatModel: 'qwen2.5:7b' })
})
afterEach(() => {
  ollama.stop()
  core.close()
})

async function chat(text: string): Promise<ChatEvent[]> {
  const events: ChatEvent[] = []
  await new ChatAgent(core).run('r1', [{ role: 'user', content: text }], (e) => events.push(e))
  return events
}

describe('ChatAgent', () => {
  it('answers "tag the emails" by calling tag_emails directly, without a model call', async () => {
    const events = await chat('tag the emails')
    expect(ollama.requests).toHaveLength(0)
    expect(events.find((e) => e.kind === 'tool-start')).toMatchObject({ name: 'tag_emails' })
    expect(events.some((e) => e.kind === 'tool-progress')).toBe(true)
    const done = events.find((e) => e.kind === 'done') as Extract<ChatEvent, { kind: 'done' }>
    expect(done.text).toMatch(/Tagged \d+ of \d+ emails/)
  })

  it.each(['Tag my new emails', 'please sort the inbox', 'categorize emails'])('treats "%s" as the tag shortcut', async (text) => {
    const events = await chat(text)
    expect(events.find((e) => e.kind === 'tool-start')).toMatchObject({ name: 'tag_emails' })
    expect(ollama.requests).toHaveLength(0)
  })

  it('runs the tool loop: model calls a tool, gets the result, then answers', async () => {
    ollama.replies.push(
      () => ({ chunks: [{ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'search_emails', arguments: { tag: 'Rejected' } } }] }, done: true }] }),
      () => ({ chunks: [{ message: { role: 'assistant', content: 'You have ' }, done: false }, { message: { role: 'assistant', content: '2 rejections.' }, done: true }] })
    )
    // Tag first so search by tag has results.
    await core.runTagging()
    const events = await chat('Which companies rejected me?')
    expect(ollama.requests).toHaveLength(2)
    expect(ollama.requests[0].tools.map((t: any) => t.function.name)).toContain('tag_emails')
    const toolMsg = ollama.requests[1].messages.find((m: any) => m.role === 'tool')
    expect(toolMsg.tool_name).toBe('search_emails')
    expect(toolMsg.content).toContain('tag=Rejected')
    expect(events.filter((e) => e.kind === 'token').map((e) => (e as any).text).join('')).toBe('You have 2 rejections.')
    expect(events.at(-1)).toMatchObject({ kind: 'done', text: 'You have 2 rejections.' })
  })

  it('explains when the chat model cannot call tools', async () => {
    ollama.replies.push(() => ({ status: 400, json: { error: 'registry.ollama.ai/library/gemma:2b does not support tools' } }))
    const events = await chat('hello')
    expect(events.at(-1)).toMatchObject({ kind: 'error' })
    expect((events.at(-1) as any).error).toMatch(/does not support tool calling/)
  })

  it('reports a missing model with the pull command', async () => {
    ollama.replies.push(() => ({ status: 404, json: { error: 'model "qwen2.5:7b" not found, try pulling it first' } }))
    const events = await chat('hello')
    expect((events.at(-1) as any).error).toMatch(/ollama pull qwen2.5:7b/)
  })
})

describe('Ollama classifier over HTTP', () => {
  it('sends a JSON-schema format, a stable system prompt and small context', async () => {
    ollama.replies.push(() => ({ json: { message: { role: 'assistant', content: '{"reason":"invite","tag":"Meeting","confidence":0.93}' }, done: true } }))
    const c = createOllamaClassifier({ url: ollama.url, model: 'qwen2.5:7b' })
    const v = await c.classify(
      { fromName: 'Jane', fromAddr: 'jane@x.com', subject: 'Chat?', text: 'Free Tuesday?', linkDomains: [], hasCalendarInvite: false, listUnsubscribe: false, providerLabels: [] },
      []
    )
    expect(v).toEqual({ tag: 'Meeting', confidence: 0.93, reason: 'invite' })
    const req = ollama.requests[0]
    expect(req.format.properties.tag.enum).toContain('Needs Attention')
    expect(req.options).toMatchObject({ temperature: 0, num_ctx: 3072 })
    expect(req.stream).toBe(false)
    expect(req.messages[0].role).toBe('system')
    expect(req.messages.at(-1).content).toContain('Subject: Chat?')
  })

  it('health check lists models and flags missing ones', async () => {
    const h = await checkOllama(ollama.url, ['qwen2.5:7b', 'llama3.1:8b'])
    expect(h).toMatchObject({ ok: false, version: '0.12.0', missing: ['llama3.1:8b'] })
    const down = await checkOllama('http://127.0.0.1:9', ['x'])
    expect(down.ok).toBe(false)
    expect(down.error).toMatch(/Can't reach Ollama/)
  })
})
