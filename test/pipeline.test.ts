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

  it('reports progress up to done', async () => {
    ;({ core } = seededCore(fakeClassifier(answers)))
    const seen: string[] = []
    await core.runTagging({ onProgress: (p) => seen.push(p.stage) })
    expect(seen.at(-1)).toBe('done')
    expect(seen).toContain('rules')
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
