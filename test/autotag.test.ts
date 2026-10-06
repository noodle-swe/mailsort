import { afterEach, describe, expect, it } from 'vitest'
import { AUTO_TAG_LIMIT, type Core } from '../src/core/core'
import type { CoreEvent } from '../src/core/events'
import { OllamaError } from '../src/core/ollama'
import type { Tag } from '../src/core/tags'
import { fakeClassifier, FIXTURES, seededCore, toIncoming } from './helpers'

const answers = new Map<string, Tag>(FIXTURES.map((f) => [f.subject!, f.expected]))
const REMOTE = 'http://10.0.0.5:11434'
const ids = FIXTURES.map((_, i) => `gmail-test:m${i}`)
let core: Core | undefined

afterEach(() => core?.close())

/** `count` plain emails no rule can settle, so each one needs the model. Oldest first. */
function bulk(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    ...toIncoming(FIXTURES[0], 100 + i, Date.UTC(2026, 9, 1) + i * 60_000),
    providerId: `bulk${i}`,
    fromAddr: `friend${i}@example.org`,
    subject: `Hello ${i}`,
    snippet: 'Hi there',
    bodyText: 'Hi there',
    linkDomains: [],
    providerLabels: ['INBOX']
  }))
}

describe('automatic tagging after a sync', () => {
  it('waits for the button when Ollama runs on this PC', async () => {
    const llm = fakeClassifier(answers)
    ;({ core } = seededCore(llm)) // the default address is this PC
    expect(await core.autoTagNew(ids)).toBeNull()
    expect(llm.calls).toBe(0)
    expect(core.store.getTag(ids[0])).toBeFalsy()
  })

  it('tags on arrival when Ollama is on another PC', async () => {
    const llm = fakeClassifier(answers)
    ;({ core } = seededCore(llm))
    core.store.updateSettings({ ollamaUrl: REMOTE })
    const r = await core.autoTagNew(ids)
    expect(r?.tagged).toBe(FIXTURES.length)
  })

  it('honours the setting: "on" tags even a local Ollama, "off" never tags', async () => {
    const llm = fakeClassifier(answers)
    ;({ core } = seededCore(llm))
    core.store.updateSettings({ autoTag: 'on' })
    expect(await core.autoTagNew(ids)).not.toBeNull()
    core.store.updateSettings({ ollamaUrl: REMOTE, autoTag: 'off' })
    expect(await core.autoTagNew(ids)).toBeNull()
  })

  it('never tags more than the limit at once, and takes the newest first', async () => {
    ;({ core } = seededCore(fakeClassifier(answers)))
    core.store.updateSettings({ ollamaUrl: REMOTE })
    const added = core.store.upsertMessages('gmail-test', bulk(AUTO_TAG_LIMIT + 10))
    const r = await core.autoTagNew(added)
    expect(r?.total).toBe(AUTO_TAG_LIMIT)
    expect(added.filter((id) => core!.store.getTag(id))).toHaveLength(AUTO_TAG_LIMIT)
    expect(core.store.getTag('gmail-test:bulk59')).toBeTruthy() // the newest
    expect(core.store.getTag('gmail-test:bulk0')).toBeFalsy() // the oldest waits for the button
  })

  it('does nothing when no new email arrived', async () => {
    const llm = fakeClassifier(answers)
    ;({ core } = seededCore(llm))
    core.store.updateSettings({ ollamaUrl: REMOTE })
    expect(await core.autoTagNew([])).toBeNull()
    expect(llm.calls).toBe(0)
  })

  it('says whether a run was automatic, so the UI can stay quiet about the empty ones', async () => {
    ;({ core } = seededCore(fakeClassifier(answers)))
    core.store.updateSettings({ ollamaUrl: REMOTE })
    const finished: boolean[] = []
    core.on((e) => e.type === 'tagging-finished' && finished.push(e.summary.auto))
    await core.autoTagNew(ids)
    await core.runTagging()
    expect(finished).toEqual([true, false])
  })

  describe('when Ollama keeps failing', () => {
    const t0 = Date.UTC(2026, 9, 5, 12)
    const setup = () => {
      const opts: { fail?: Error } = { fail: new OllamaError("Can't reach Ollama at http://10.0.0.5:11434", 'unreachable') }
      const llm = fakeClassifier(answers, opts)
      ;({ core } = seededCore(llm))
      core.store.updateSettings({ ollamaUrl: REMOTE })
      const events: CoreEvent[] = []
      core.on((e) => events.push(e))
      const paused = () => events.filter((e) => e.type === 'auto-tag-paused')
      return { opts, llm, paused }
    }

    it('pauses itself after two failed runs, and says why', async () => {
      const { llm, paused } = setup()
      const first = await core!.autoTagNew(ids, t0)
      expect(first?.error).toMatch(/reach Ollama/)
      expect(paused()).toHaveLength(0) // one failure is not yet a pattern
      await core!.autoTagNew(ids, t0 + 60_000)
      expect(paused()).toMatchObject([{ type: 'auto-tag-paused', minutes: 30, reason: expect.stringMatching(/reach Ollama/) }])

      const calls = llm.calls
      expect(await core!.autoTagNew(ids, t0 + 120_000)).toBeNull()
      expect(llm.calls).toBe(calls) // paused: Ollama is left alone
    })

    it('tries again once the pause is over', async () => {
      const { llm } = setup()
      await core!.autoTagNew(ids, t0)
      await core!.autoTagNew(ids, t0 + 1000)
      const calls = llm.calls
      expect(await core!.autoTagNew(ids, t0 + 31 * 60_000)).not.toBeNull()
      expect(llm.calls).toBeGreaterThan(calls)
    })

    it('lifts the pause when the Ollama address changes', async () => {
      const { llm } = setup()
      await core!.autoTagNew(ids, t0)
      await core!.autoTagNew(ids, t0 + 1000)
      core!.store.updateSettings({ ollamaUrl: 'http://10.0.0.6:11434' })
      const calls = llm.calls
      expect(await core!.autoTagNew(ids, t0 + 2000)).not.toBeNull()
      expect(llm.calls).toBeGreaterThan(calls)
    })

    it('lifts the pause when the user tags by hand and it works', async () => {
      const { opts } = setup()
      await core!.autoTagNew(ids, t0)
      await core!.autoTagNew(ids, t0 + 1000)
      expect(await core!.autoTagNew(ids, t0 + 2000)).toBeNull()
      opts.fail = undefined // Ollama is back
      const manual = await core!.runTagging()
      expect(manual.tagged).toBeGreaterThan(0)
      expect(await core!.autoTagNew(ids, t0 + 3000)).not.toBeNull()
    })

    it('forgets earlier failures after a run that works', async () => {
      const { opts, paused } = setup()
      const down = opts.fail
      await core!.autoTagNew(ids, t0) // fails once
      opts.fail = undefined
      expect((await core!.autoTagNew(ids, t0 + 1000))?.error).toBeUndefined() // works, so the count starts again
      opts.fail = down
      const more = core!.store.upsertMessages('gmail-test', bulk(3))
      await core!.autoTagNew(more, t0 + 2000) // fails once more, but not twice in a row
      expect(paused()).toHaveLength(0)
    })
  })
})
