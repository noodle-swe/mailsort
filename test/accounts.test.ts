import { afterEach, describe, expect, it } from 'vitest'
import { oauthConfig } from '../src/core/auth/providers'
import type { Core } from '../src/core/core'
import type { Tag } from '../src/core/tags'
import { fakeClassifier, FIXTURES, makeCore, plainSecrets, toIncoming } from './helpers'

let core: Core | undefined
afterEach(() => core?.close())

const ACCOUNTS = [
  { id: 'gmail-a', provider: 'gmail' as const, email: 'jobs@gmail.com' },
  { id: 'gmail-b', provider: 'gmail' as const, email: 'personal@gmail.com' },
  { id: 'gmail-c', provider: 'gmail' as const, email: 'side@gmail.com' },
  { id: 'outlook-a', provider: 'outlook' as const, email: 'me@outlook.com' },
  { id: 'outlook-b', provider: 'outlook' as const, email: 'me@company.com' }
]

/** Five accounts; every fixture email lands in every account under the same provider id. */
function multiCore(): Core {
  const answers = new Map<string, Tag>(FIXTURES.map((f) => [f.subject!, f.expected]))
  const c = makeCore(fakeClassifier(answers))
  for (const a of ACCOUNTS) {
    c.store.insertAccount({ ...a, name: null, tokenEnc: plainSecrets.encrypt('{}') })
    c.store.upsertMessages(a.id, FIXTURES.map((f, i) => toIncoming(f, i)))
  }
  return c
}

describe('several Gmail and Outlook accounts', () => {
  it('keeps every account and its mail separate, even with identical provider ids', () => {
    core = multiCore()
    expect(core.store.listAccounts().map((a) => a.email)).toEqual(ACCOUNTS.map((a) => a.email))
    for (const a of ACCOUNTS) {
      const page = core.store.listMessages({ accountId: a.id, limit: 200 })
      expect(page.items).toHaveLength(FIXTURES.length)
      expect(page.items.every((m) => m.accountId === a.id)).toBe(true)
    }
  })

  it('shows all accounts together in the unified inbox', () => {
    core = multiCore()
    const seen = new Set<string>()
    let cursor: string | undefined
    do {
      const page = core.store.listMessages({ limit: 50, cursor })
      page.items.forEach((m) => seen.add(m.id))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(seen.size).toBe(FIXTURES.length * ACCOUNTS.length)
    expect(Object.values(core.store.unreadCounts())).toHaveLength(ACCOUNTS.length)
  })

  it('tags all accounts in one run and counts per account', async () => {
    core = multiCore()
    const r = await core.runTagging({ limit: 5000 })
    expect(r.tagged).toBe(FIXTURES.length * ACCOUNTS.length)
    const perAccount = core.store.tagCounts({ accountId: 'outlook-b' })
    expect(perAccount.Untagged).toBeUndefined()
    expect(Object.values(perAccount).reduce((a, b) => a + b, 0)).toBe(FIXTURES.length)
  })

  it('can tag just one account', async () => {
    core = multiCore()
    const r = await core.runTagging({ accountId: 'gmail-b' })
    expect(r.total).toBe(FIXTURES.length)
    expect(core.store.tagCounts({ accountId: 'gmail-a' }).Untagged).toBe(FIXTURES.length)
  })

  it('finds an existing account by address (re-sign-in) without mixing providers', () => {
    core = multiCore()
    expect(core.store.findAccount('gmail', 'JOBS@gmail.com')?.id).toBe('gmail-a')
    expect(core.store.findAccount('outlook', 'jobs@gmail.com')).toBeNull()
  })

  it('removing one account leaves the others untouched', () => {
    core = multiCore()
    core.removeAccount('gmail-b')
    expect(core.store.listAccounts()).toHaveLength(ACCOUNTS.length - 1)
    expect(core.store.listMessages({ accountId: 'gmail-b' }).items).toHaveLength(0)
    expect(core.store.listMessages({ accountId: 'gmail-a', limit: 200 }).items).toHaveLength(FIXTURES.length)
  })

  it('always shows the provider account picker so another account can be added', () => {
    const google = oauthConfig('gmail', { googleClientId: 'id', googleClientSecret: 'secret' })
    expect(google.extraAuthParams?.prompt).toContain('select_account')
    expect(google.extraAuthParams?.prompt).toContain('consent')
    const microsoft = oauthConfig('outlook', { microsoftClientId: 'id' })
    expect(microsoft.extraAuthParams?.prompt).toBe('select_account')
  })
})
