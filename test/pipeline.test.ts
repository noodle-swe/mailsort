import { afterEach, describe, expect, it } from 'vitest'
import { OllamaError } from '../src/core/ollama'
import type { Core } from '../src/core/core'
import type { Tag } from '../src/core/tags'
import { fakeClassifier, FIXTURES, seededCore } from './helpers'

const answers = new Map<string, Tag>(FIXTURES.map((f) => [f.subject!, f.expected]))
let core: Core | undefined

afterEach(() => core?.close())

describe('Tagger', () => {
  it('tags every email: rules first, the model for the rest', async () => {
    const llm = fakeClassifier(answers)
    ;({ core } = seededCore(llm))
    const r = await core.runTagging()
    expect(r.total).toBe(FIXTURES.length)
    expect(r.tagged).toBe(FIXTURES.length)
    expect(r.byRules + r.byLlm).toBe(FIXTURES.length)
    expect(r.byRules).toBeGreaterThan(0)
    expect(llm.calls).toBe(r.byLlm)
    // Every fixture ends with its expected tag (rules are precise, the fake model answers correctly).
    const wrong = FIXTURES.map((f, i) => ({ f, tag: core!.store.getTag(`gmail-test:m${i}`)?.tag })).filter(({ f, tag }) => tag !== f.expected)
    expect(wrong).toEqual([])
  })

  it('never classifies the same email twice', async () => {
    const llm = fakeClassifier(answers)
    ;({ core } = seededCore(llm))
    await core.runTagging()
    const calls = llm.calls
    const again = await core.runTagging()
    expect(again.total).toBe(0)
    expect(llm.calls).toBe(calls)
  })

  it('keeps user tags on retag and learns from them', async () => {
    const llm = fakeClassifier(answers)
    ;({ core } = seededCore(llm))
    await core.runTagging()
    const id = 'gmail-test:m0'
    core.setUserTag([id], 'Other')
    const r = await core.runTagging({ retag: true })
    expect(r.total).toBe(FIXTURES.length - 1)
    expect(core.store.getTag(id)).toEqual({ tag: 'Other', source: 'user' })
  })

  it('applies a learned sender-domain rule after two consistent corrections', async () => {
    const llm = fakeClassifier(new Map())
    ;({ core } = seededCore(llm))
    const uniqloIdx = FIXTURES.findIndex((f) => f.fromAddr === 'news@uniqlo.com')
    // Correct two emails from the same (non-ATS) domain.
    core.store.upsertMessages('gmail-test', [
      { ...minimal('x1'), fromAddr: 'deals@uniqlo.com', subject: 'Deal 1' },
      { ...minimal('x2'), fromAddr: 'deals@uniqlo.com', subject: 'Deal 2' }
    ])
    core.setUserTag(['gmail-test:x1', 'gmail-test:x2'], 'Other')
    await core.runTagging({ ids: [`gmail-test:m${uniqloIdx}`] })
    expect(core.store.getTag(`gmail-test:m${uniqloIdx}`)?.tag).toBe('Other')
  })

  it('stops early with a clear error when Ollama is unreachable, keeping rule tags', async () => {
    const llm = fakeClassifier(answers, { fail: new OllamaError("Can't reach Ollama", 'unreachable') })
    ;({ core } = seededCore(llm))
    const r = await core.runTagging()
    expect(r.error).toMatch(/reach Ollama/)
    expect(r.byRules).toBeGreaterThan(0)
    expect(r.byLlm).toBe(0)
    expect(r.failed).toBe(r.total - r.byRules)
    expect(llm.calls).toBeLessThanOrEqual(4) // at most one call per worker before stopping
  })

  it('reports progress from the start, through the wait for the model, up to done', async () => {
    ;({ core } = seededCore(fakeClassifier(answers)))
    const seen: string[] = []
    await core.runTagging({ onProgress: (p) => seen.push(p.stage) })
    expect(seen[0]).toBe('start')
    expect(seen.at(-1)).toBe('done')
    expect(seen).toContain('rules')
    expect(seen.indexOf('model')).toBeGreaterThan(seen.indexOf('rules'))
    expect(seen.indexOf('model')).toBeLessThan(seen.indexOf('llm'))
  })

  it('says nothing is starting when there is nothing to tag', async () => {
    ;({ core } = seededCore(fakeClassifier(answers)))
    await core.runTagging()
    const seen: string[] = []
    await core.runTagging({ onProgress: (p) => seen.push(p.stage) })
    expect(seen).toEqual(['done'])
  })

  describe('when the connection to Ollama drops', () => {
    const dropped = () => new OllamaError('Ollama dropped the connection (ECONNRESET)', 'dropped')
    const noWait = [0, 0]

    it('retries the email and carries on', async () => {
      const opts: { fail?: Error } = { fail: dropped() }
      const llm = fakeClassifier(answers, opts)
      // The first answer fails once, then Ollama is back.
      const classify = llm.classify.bind(llm)
      llm.classify = async (...args) => {
        const out = classify(...args)
        opts.fail = undefined
        return out
      }
      ;({ core } = seededCore(llm))
      const r = await core.runTagging({ retryDelaysMs: noWait })
      expect(r.error).toBeUndefined()
      expect(r.tagged).toBe(FIXTURES.length)
      expect(r.failed).toBe(0)
    })

    it('stops with a clear message once the retries are used up', async () => {
      const llm = fakeClassifier(answers, { fail: dropped() })
      ;({ core } = seededCore(llm))
      const r = await core.runTagging({ retryDelaysMs: noWait })
      expect(r.error).toMatch(/dropped the connection/)
      expect(llm.calls).toBe(3) // the first try and two retries, then it stops instead of hammering Ollama
      expect(r.byRules).toBeGreaterThan(0) // what the rules settled is kept
      expect(r.byLlm).toBe(0)
    })

    it('records what kind of problem it was and which model was asked, for the log', async () => {
      ;({ core } = seededCore(fakeClassifier(answers, { fail: dropped() })))
      const r = await core.runTagging({ retryDelaysMs: noWait })
      expect(r.errorKind).toBe('dropped')
      expect(r.model).toBe('fake')
    })

    it('does not retry an Ollama that is not running at all', async () => {
      const llm = fakeClassifier(answers, { fail: new OllamaError("Can't reach Ollama", 'unreachable') })
      ;({ core } = seededCore(llm))
      await core.runTagging({ retryDelaysMs: noWait })
      expect(llm.calls).toBeLessThanOrEqual(4)
      expect(llm.calls).toBeGreaterThan(0)
    })
  })

  it('stops after five emails in a row fail, instead of failing them all', async () => {
    const llm = fakeClassifier(answers, { fail: new OllamaError('Ollama error 500: model runner crashed', 'http') })
    ;({ core } = seededCore(llm))
    const r = await core.runTagging({ retryDelaysMs: [0, 0] })
    expect(r.error).toMatch(/5 emails failed in a row/)
    expect(r.failureSample).toMatch(/model runner crashed/) // the first failure is kept as a clue
    expect(llm.calls).toBeLessThan(r.total - r.byRules)
  })
})

function minimal(id: string) {
  return {
    providerId: id,
    threadId: null,
    fromName: null,
    fromAddr: null,
    toAddrs: null,
    subject: null,
    snippet: 'Big sale',
    bodyText: 'Big sale this weekend',
    linkDomains: [],
    hasCalendarInvite: false,
    listUnsubscribe: false,
    hasAttachments: false,
    providerLabels: [],
    receivedAt: Date.now(),
    isRead: false,
    webLink: null
  }
}
