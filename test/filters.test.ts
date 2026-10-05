import { afterEach, describe, expect, it } from 'vitest'
import type { Core } from '../src/core/core'
import { dateRange } from '../src/core/dates'
import { sanitizeQuery } from '../src/core/query'
import type { Tag } from '../src/core/tags'
import type { IncomingMessage } from '../src/core/types'
import { FIXTURES, makeCore, plainSecrets, toIncoming } from './helpers'

let core: Core | undefined
afterEach(() => core?.close())

const day = (m: number, d: number, h = 12) => new Date(2026, m - 1, d, h).getTime()

describe('dateRange', () => {
  // Wednesday, October 7 2026, 15:30 local time. Weeks start on Monday.
  const wed = new Date(2026, 9, 7, 15, 30)

  it('starts today and this week at local midnight', () => {
    expect(dateRange('today', wed)).toEqual({ since: new Date(2026, 9, 7).getTime() })
    expect(dateRange('week', wed)).toEqual({ since: new Date(2026, 9, 5).getTime() })
  })

  it('treats last week as the Monday-to-Monday span before this week', () => {
    expect(dateRange('lastWeek', wed)).toEqual({ since: new Date(2026, 8, 28).getTime(), until: new Date(2026, 9, 5).getTime() })
  })

  it('puts Sunday in the week that started the Monday before', () => {
    const sun = new Date(2026, 9, 11, 9)
    expect(dateRange('week', sun).since).toBe(new Date(2026, 9, 5).getTime())
    expect(dateRange('week', new Date(2026, 9, 5, 0, 0)).since).toBe(new Date(2026, 9, 5).getTime())
  })

  it('counts 30 days back from now', () => {
    expect(dateRange('30d', wed)).toEqual({ since: wed.getTime() - 30 * 86_400_000 })
  })
})

describe('sanitizeQuery', () => {
  it('keeps valid filters and drops unknown or mistyped ones', () => {
    const q = sanitizeQuery({
      tag: 'Applied',
      since: 5,
      until: 'tomorrow',
      hasInvite: true,
      isNewsletter: 'yes',
      oldestFirst: true,
      bogus: 1
    })
    expect(q).toMatchObject({ tag: 'Applied', since: 5, hasInvite: true, oldestFirst: true })
    expect(q.until).toBeUndefined()
    expect(q.isNewsletter).toBeUndefined()
    expect('bogus' in q).toBe(false)
  })

  it('rejects non-finite numbers and unknown tags', () => {
    const q = sanitizeQuery({ since: Number.NaN, tag: 'Spam' })
    expect(q.since).toBeUndefined()
    expect(q.tag).toBeUndefined()
  })
})

/** Eight emails on distinct days with known tags, attachments, invites and newsletter flags. */
function filterCore(): Core {
  const c = makeCore()
  c.store.insertAccount({ id: 'a', provider: 'gmail', email: 'a@gmail.com', name: null, tokenEnc: plainSecrets.encrypt('{}') })
  c.store.insertAccount({ id: 'b', provider: 'outlook', email: 'b@outlook.com', name: null, tokenEnc: plainSecrets.encrypt('{}') })
  const mk = (i: number, receivedAt: number, patch: Partial<IncomingMessage> = {}): IncomingMessage => ({
    ...toIncoming(FIXTURES[i], i, receivedAt),
    hasAttachments: false,
    hasCalendarInvite: false,
    listUnsubscribe: false,
    isRead: false,
    ...patch
  })
  c.store.upsertMessages('a', [
    mk(0, day(9, 29)), // last week
    mk(1, day(9, 30), { hasAttachments: true }), // last week
    mk(2, day(10, 5, 9), { hasCalendarInvite: true }), // this week
    mk(3, day(10, 6), { listUnsubscribe: true, isRead: true }), // this week
    mk(4, day(10, 7)) // this week
  ])
  c.store.upsertMessages('b', [mk(5, day(9, 29)), mk(6, day(10, 6))])
  const tag = (account: string, i: number, t: Tag, source: 'rule' | 'llm' | 'user', confidence: number) =>
    c.store.setTag({ messageId: `${account}:m${i}`, tag: t, source, confidence, reason: 'test', model: null, version: 1 })
  tag('a', 0, 'Applied', 'rule', 0.95)
  tag('a', 1, 'Applied', 'llm', 0.9)
  tag('a', 2, 'Meeting', 'rule', 0.95)
  tag('a', 3, 'Junk', 'rule', 0.9)
  tag('a', 4, 'Other', 'llm', 0.8)
  tag('b', 5, 'Applied', 'llm', 0.6)
  tag('b', 6, 'Questions', 'user', 1)
  return c
}

const ids = (c: Core, q: Parameters<Core['store']['listMessages']>[0]) =>
  c.store
    .listMessages({ limit: 200, ...q })
    .items.map((m) => m.id)
    .sort()

describe('listMessages filters', () => {
  it('gives exactly last week with since and until, and per account', () => {
    core = filterCore()
    const lastWeek = dateRange('lastWeek', new Date(2026, 9, 7, 15, 30))
    expect(ids(core, { tag: 'Applied', ...lastWeek })).toEqual(['a:m0', 'a:m1', 'b:m5'])
    expect(ids(core, { tag: 'Applied', accountId: 'b', ...lastWeek })).toEqual(['b:m5'])
    expect(ids(core, { ...dateRange('week', new Date(2026, 9, 7, 15, 30)) })).toEqual(['a:m2', 'a:m3', 'a:m4', 'b:m6'])
  })

  it('filters attachments, invites and newsletters', () => {
    core = filterCore()
    expect(ids(core, { hasAttachments: true })).toEqual(['a:m1'])
    expect(ids(core, { hasInvite: true })).toEqual(['a:m2'])
    expect(ids(core, { isNewsletter: true })).toEqual(['a:m3'])
  })

  it('action only keeps Meeting, Questions and Needs Attention', () => {
    core = filterCore()
    expect(ids(core, { actionOnly: true })).toEqual(['a:m2', 'b:m6'])
  })

  it('needs review: low confidence or a model "Other", never user tags', () => {
    core = filterCore()
    expect(ids(core, { needsReview: true })).toEqual(['a:m4', 'b:m5'])
  })

  it('combines filters', () => {
    core = filterCore()
    expect(ids(core, { unreadOnly: true, tag: 'Applied', ...dateRange('lastWeek', new Date(2026, 9, 7)) })).toEqual(['a:m0', 'a:m1', 'b:m5'])
    expect(ids(core, { unreadOnly: true, accountId: 'a', since: day(10, 5, 0) })).toEqual(['a:m2', 'a:m4'])
  })

  it('pages oldest first with a stable cursor', () => {
    core = filterCore()
    const seen: string[] = []
    let cursor: string | undefined
    do {
      const page = core.store.listMessages({ limit: 3, oldestFirst: true, cursor })
      seen.push(...page.items.map((m) => m.id))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(seen).toHaveLength(7)
    expect(new Set(seen).size).toBe(7)
    const times = seen.map((id) => core!.store.getMessage(id)!.receivedAt)
    expect(times).toEqual([...times].sort((x, y) => x - y))
  })

  it('pages newest first through an until bound', () => {
    core = filterCore()
    const seen: string[] = []
    let cursor: string | undefined
    do {
      const page = core.store.listMessages({ limit: 2, until: day(10, 6, 23), cursor })
      seen.push(...page.items.map((m) => m.id))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(seen).toHaveLength(6)
    expect(seen.includes('a:m4')).toBe(false)
  })
})

describe('digest', () => {
  it('counts emails per account and tag inside the range', () => {
    core = filterCore()
    const rows = core.store.digest(dateRange('lastWeek', new Date(2026, 9, 7, 15, 30)))
    const key = (r: { accountId: string; tag: string; count: number }) => `${r.accountId}/${r.tag}=${r.count}`
    expect(rows.map(key).sort()).toEqual(['a/Applied=2', 'b/Applied=1'])
    const all = core.store.digest({})
    expect(all.reduce((n, r) => n + r.count, 0)).toBe(7)
  })

  it('counts untagged mail under "Untagged" and honours until in tagCounts', () => {
    core = filterCore()
    core.store.upsertMessages('a', [{ ...toIncoming(FIXTURES[7], 7, day(10, 6, 20)), hasAttachments: false }])
    expect(core.store.digest({ since: day(10, 6, 0), until: day(10, 7, 0) }).find((r) => r.tag === 'Untagged')).toMatchObject({ accountId: 'a', count: 1 })
    expect(core.store.tagCounts({ since: day(9, 28, 0), until: day(10, 5, 0) })).toEqual({ Applied: 3 })
  })
})
