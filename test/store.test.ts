import { afterEach, describe, expect, it } from 'vitest'
import { toFtsQuery } from '../src/core/store'
import type { Core } from '../src/core/core'
import { FIXTURES, seededCore, toIncoming } from './helpers'

let core: Core | undefined
afterEach(() => core?.close())

describe('Store', () => {
  it('pages newest first with a stable cursor', () => {
    ;({ core } = seededCore())
    const seen: string[] = []
    let cursor: string | undefined
    do {
      const page = core.store.listMessages({ limit: 7, cursor })
      seen.push(...page.items.map((m) => m.id))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(seen).toHaveLength(FIXTURES.length)
    expect(new Set(seen).size).toBe(FIXTURES.length)
    expect(seen[0]).toBe(`gmail-test:m${FIXTURES.length - 1}`)
  })

  it('full-text search matches prefixes across subject and body', () => {
    ;({ core } = seededCore())
    const hits = core.store.listMessages({ query: 'lasag' }).items
    expect(hits.map((h) => h.subject)).toEqual(['Dinner on Sunday?'])
    expect(core.store.listMessages({ query: 'calendly' }).items.length).toBeGreaterThan(0)
  })

  it('keeps the FTS index in sync on update and delete', () => {
    ;({ core } = seededCore())
    const f = { ...FIXTURES[0], fromName: 'Zoo', subject: 'Totally different zebra subject', text: 'zebra body' }
    core.store.upsertMessages('gmail-test', [toIncoming(f, 0)])
    expect(core.store.listMessages({ query: 'zebra' }).items).toHaveLength(1)
    expect(core.store.listMessages({ query: 'Stripe' }).items.some((m) => m.id === 'gmail-test:m0')).toBe(false)
    core.store.deleteMessages('gmail-test', ['m0'])
    expect(core.store.listMessages({ query: 'zebra' }).items).toHaveLength(0)
  })

  it('escapes FTS syntax in user input', () => {
    expect(toFtsQuery('AND "x" OR (y*')).toBe('"AND"* "x"* "OR"* "y"*')
    expect(toFtsQuery('  ')).toBeNull()
  })

  it('reports new ids only once on upsert', () => {
    ;({ core } = seededCore())
    expect(core.store.upsertMessages('gmail-test', [toIncoming(FIXTURES[0], 0)])).toEqual([])
    expect(core.store.upsertMessages('gmail-test', [toIncoming(FIXTURES[0], 999)])).toEqual(['gmail-test:m999'])
  })

  it('keepOnly removes messages the server no longer has', () => {
    ;({ core } = seededCore())
    core.store.keepOnlyMessages('gmail-test', new Set(['m0', 'm1']))
    expect(core.store.listMessages({}).items.map((m) => m.id).sort()).toEqual(['gmail-test:m0', 'gmail-test:m1'])
  })

  it('compresses bodies and evicts least recently opened ones over the cap', () => {
    ;({ core } = seededCore())
    const html = '<p>' + 'hello world '.repeat(5000) + '</p>'
    core.store.putBody('gmail-test:m0', html, true, 1e9)
    expect(core.store.getBody('gmail-test:m0')).toEqual({ content: html, isHtml: true })
    const stats = core.store.storageStats()
    expect(stats.bodyCacheBytes).toBeLessThan(html.length / 10)
    // Cap below one body: inserting another evicts the older one.
    const cap = stats.bodyCacheBytes + 10
    core.store.putBody('gmail-test:m1', html.replace('hello', 'howdy'), true, cap)
    expect(core.store.getBody('gmail-test:m0')).toBeNull()
    expect(core.store.getBody('gmail-test:m1')).not.toBeNull()
  })

  it('tracks write-back state per tag', () => {
    ;({ core } = seededCore())
    core.setUserTag(['gmail-test:m0'], 'Applied')
    expect(core.store.pendingWriteback().map((p) => p.tag)).toEqual(['Applied'])
    core.store.markSynced('gmail-test:m0', 'Applied')
    expect(core.store.pendingWriteback()).toEqual([])
    core.setUserTag(['gmail-test:m0'], 'Rejected')
    expect(core.store.pendingWriteback()[0]).toMatchObject({ tag: 'Rejected', syncedTag: 'Applied' })
  })

  it('sanitizes settings', () => {
    ;({ core } = seededCore())
    const s = core.store.updateSettings({ llmConcurrency: 99, ollamaUrl: 'http://10.0.0.5:11434/', bogus: 1, autoTag: 'yes' })
    expect(s.llmConcurrency).toBe(16)
    expect(s.ollamaUrl).toBe('http://10.0.0.5:11434')
    expect(s.autoTag).toBe(true)
  })
})
