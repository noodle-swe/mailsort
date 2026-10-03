import { afterEach, describe, expect, it } from 'vitest'
import { GmailProvider, parseGmailMessage } from '../src/core/providers/gmail'
import { OutlookProvider, parseGraphMessage } from '../src/core/providers/outlook'
import { HttpError, type Http } from '../src/core/providers/http'
import type { SyncHandlers } from '../src/core/providers/types'
import type { Core } from '../src/core/core'
import type { IncomingMessage } from '../src/core/types'
import { makeCore, plainSecrets } from './helpers'

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url')

/** Routes requests to handlers by URL substring; records every call. */
function fakeHttp(routes: [string | RegExp, (url: string, init?: RequestInit) => unknown][]): Http & { calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = []
  const handle = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const route = routes.find(([m]) => (typeof m === 'string' ? url.includes(m) : m.test(url)))
    if (!route) throw new Error(`unexpected request ${url}`)
    return route[1](url, init)
  }
  return {
    calls,
    fetch: async (url, init) => new Response(JSON.stringify(await handle(url, init))),
    json: async <T,>(url: string, init?: RequestInit) => (await handle(url, init)) as T
  }
}

function recorder(existing: Set<string> = new Set()) {
  const log = { upserted: [] as IncomingMessage[], removed: [] as string[], patched: [] as [string, unknown][], kept: null as Set<string> | null }
  const h: SyncHandlers = {
    upsert: (m) => log.upserted.push(...m),
    remove: (ids) => log.removed.push(...ids),
    patch: (id, p) => log.patched.push([id, p]),
    exists: (id) => existing.has(id),
    keepOnly: (ids) => (log.kept = ids)
  }
  return { h, log }
}

const gmailMsg = (id: string, labels = ['INBOX', 'UNREAD']) => ({
  id,
  threadId: 't-' + id,
  labelIds: labels,
  snippet: 'We&#39;d love to chat',
  internalDate: '1759500000000',
  payload: {
    mimeType: 'multipart/mixed',
    headers: [
      { name: 'From', value: '"Jane Park" <Jane@Shopify.com>' },
      { name: 'To', value: 'sam@example.com' },
      { name: 'Subject', value: 'Interview invite' },
      { name: 'List-Unsubscribe', value: '<mailto:u@x.com>' }
    ],
    parts: [
      {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }], body: { data: b64('Hi Sam,\nBook a time: https://calendly.com/jane/30\n\nOn Mon Jane wrote:\n> old') } },
          { mimeType: 'text/html', body: { data: b64('<p>Hi Sam</p><a href="https://calendly.com/jane/30">Book</a>') } }
        ]
      },
      { mimeType: 'text/calendar', filename: 'invite.ics', body: { attachmentId: 'att1', size: 900 } }
    ]
  }
})

describe('parseGmailMessage', () => {
  it('extracts headers, cleaned text, links, invite and flags', () => {
    const m = parseGmailMessage(gmailMsg('g1') as never, 'sam@example.com')
    expect(m).toMatchObject({
      providerId: 'g1',
      fromName: 'Jane Park',
      fromAddr: 'jane@shopify.com',
      subject: 'Interview invite',
      snippet: "We'd love to chat",
      hasCalendarInvite: true,
      hasAttachments: true,
      listUnsubscribe: true,
      isRead: false,
      receivedAt: 1759500000000
    })
    expect(m.bodyText).toBe('Hi Sam,\nBook a time: [link:calendly.com]')
    expect(m.linkDomains).toContain('calendly.com')
  })
})

describe('GmailProvider', () => {
  let core: Core | undefined
  afterEach(() => core?.close())

  it('full sync lists the inbox window, fetches only unknown messages and returns the historyId', async () => {
    core = makeCore()
    const http = fakeHttp([
      ['/profile', () => ({ emailAddress: 'sam@example.com', historyId: '500' })],
      ['/messages?q=', () => ({ messages: [{ id: 'known' }, { id: 'new1' }] })],
      ['/messages/new1?format=full', () => gmailMsg('new1')]
    ])
    const { h, log } = recorder(new Set(['known']))
    const cursor = await new GmailProvider('acc', 'sam@example.com', http, core.store).sync(null, Date.now() - 86_400_000, h)
    expect(cursor).toBe('500')
    expect(log.upserted.map((m) => m.providerId)).toEqual(['new1'])
    expect([...log.kept!].sort()).toEqual(['known', 'new1'])
    expect(decodeURIComponent(http.calls[1].url)).toMatch(/q=in:inbox after:\d+/)
  })

  it('incremental sync handles new mail, archive, read state, and ignores our own AI label changes', async () => {
    core = makeCore()
    core.store.insertAccount({ id: 'acc', provider: 'gmail', email: 'sam@example.com', name: null, tokenEnc: plainSecrets.encrypt('{}') })
    core.store.setLabelId('acc', 'AI/Meeting', 'Label_ai_meeting')
    const http = fakeHttp([
      [
        '/history?',
        () => ({
          historyId: '620',
          history: [
            { messagesAdded: [{ message: { id: 'n1', labelIds: ['INBOX', 'UNREAD'] } }] },
            { labelsAdded: [{ message: { id: 'm0' }, labelIds: ['Label_ai_meeting'] }] },
            { labelsRemoved: [{ message: { id: 'm1' }, labelIds: ['INBOX'] }] },
            { labelsRemoved: [{ message: { id: 'm2' }, labelIds: ['UNREAD'] }] }
          ]
        })
      ],
      ['/messages/n1?format=full', () => gmailMsg('n1')],
      ['/messages/m2?format=minimal', () => ({ id: 'm2', labelIds: ['INBOX'] })]
    ])
    const { h, log } = recorder(new Set(['m0', 'm1', 'm2']))
    const cursor = await new GmailProvider('acc', 'sam@example.com', http, core.store).sync('600', 0, h)
    expect(cursor).toBe('620')
    expect(log.upserted.map((m) => m.providerId)).toEqual(['n1'])
    expect(log.removed).toEqual(['m1'])
    expect(log.patched).toEqual([['m2', { isRead: true, providerLabels: ['INBOX'] }]])
    expect(http.calls.some((c) => c.url.includes('/messages/m0'))).toBe(false)
  })

  it('falls back to a full sync when the historyId expired (404)', async () => {
    core = makeCore()
    const http = fakeHttp([
      ['/history?', () => { throw new HttpError(404, 'notFound', 'https://gmail.googleapis.com/x') }],
      ['/profile', () => ({ emailAddress: 'sam@example.com', historyId: '900' })],
      ['/messages?q=', () => ({ messages: [] })]
    ])
    const { h } = recorder()
    expect(await new GmailProvider('acc', 'sam@example.com', http, core.store).sync('1', 0, h)).toBe('900')
  })

  it('writes tags as AI/<Tag> labels, creating them once and swapping old AI labels', async () => {
    core = makeCore()
    core.store.insertAccount({ id: 'acc', provider: 'gmail', email: 'sam@example.com', name: null, tokenEnc: plainSecrets.encrypt('{}') })
    let created = 0
    const http = fakeHttp([
      ['/labels', (_u, init) => (init?.method === 'POST' ? { id: `L${++created}` } : { labels: [{ id: 'Lx', name: 'AI/Junk' }] })],
      ['/messages/batchModify', () => undefined]
    ])
    const p = new GmailProvider('acc', 'sam@example.com', http, core.store)
    const res = await p.applyTags([{ providerId: 'g1', tag: 'Meeting', providerLabels: ['INBOX', 'Lx'] }])
    expect(created).toBe(7) // "AI" parent + 6 missing tag labels (AI/Junk already existed)
    const batch = JSON.parse(http.calls.find((c) => c.url.includes('batchModify'))!.init!.body as string)
    const meetingId = core.store.getLabelId('acc', 'AI/Meeting')
    expect(batch).toMatchObject({ ids: ['g1'], addLabelIds: [meetingId] })
    expect(batch.removeLabelIds).toContain('Lx')
    expect(res.ok[0].providerLabels).toEqual(['INBOX', meetingId])
    // Second call reuses cached label ids: no more label requests.
    const before = http.calls.length
    await p.applyTags([{ providerId: 'g2', tag: 'Junk', providerLabels: [] }])
    expect(http.calls.slice(before).every((c) => c.url.includes('batchModify'))).toBe(true)
  })
})

describe('Outlook', () => {
  it('parses Graph messages, including meeting invites and List-Unsubscribe', () => {
    const m = parseGraphMessage({
      id: 'o1',
      '@odata.type': '#microsoft.graph.eventMessage',
      conversationId: 'c1',
      subject: 'Interview',
      from: { emailAddress: { name: 'Contoso HR', address: 'HR@contoso.com' } },
      toRecipients: [{ emailAddress: { address: 'sam@outlook.com' } }],
      receivedDateTime: '2026-10-01T10:00:00Z',
      isRead: true,
      bodyPreview: 'Join us',
      body: { contentType: 'text', content: 'Join: https://teams.microsoft.com/l/meetup-join/123' },
      categories: ['Blue'],
      internetMessageHeaders: [{ name: 'List-Unsubscribe', value: '<x>' }]
    })
    expect(m).toMatchObject({ fromAddr: 'hr@contoso.com', hasCalendarInvite: true, listUnsubscribe: true, isRead: true, providerLabels: ['Blue'] })
    expect(m.linkDomains).toEqual(['teams.microsoft.com'])
  })

  it('follows delta pages, applies removals and returns the deltaLink', async () => {
    const page = (n: number) => ({ id: `o${n}`, subject: `S${n}`, receivedDateTime: '2026-10-01T10:00:00Z', body: { contentType: 'text', content: 'hi' } })
    const http = fakeHttp([
      ['/delta?$select', () => ({ value: [page(1), page(2)], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next2' })],
      ['/next2', () => ({ value: [page(3), { id: 'o9', '@removed': { reason: 'deleted' } }], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta3' })]
    ])
    const { h, log } = recorder()
    const cursor = await new OutlookProvider(http).sync(null, Date.now() - 86_400_000, h)
    expect(cursor).toBe('https://graph.microsoft.com/v1.0/delta3')
    expect(log.upserted.map((m) => m.providerId)).toEqual(['o1', 'o2', 'o3'])
    expect(log.removed).toEqual(['o9'])
    expect([...log.kept!]).toEqual(['o1', 'o2', 'o3'])
    expect((http.calls[0].init!.headers as Record<string, string>).prefer).toContain('outlook.body-content-type="text"')
  })

  it('restarts with a full sync when the delta token expired (410)', async () => {
    const http = fakeHttp([
      ['/old-delta', () => { throw new HttpError(410, 'syncStateNotFound', 'https://graph.microsoft.com/v1.0/old-delta') }],
      ['/delta?$select', () => ({ value: [], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/fresh' })]
    ])
    const { h } = recorder()
    expect(await new OutlookProvider(http).sync('https://graph.microsoft.com/v1.0/old-delta', 0, h)).toBe('https://graph.microsoft.com/v1.0/fresh')
  })

  it('writes categories in $batch requests, keeping non-AI categories', async () => {
    const http = fakeHttp([
      ['/$batch', (_u, init) => {
        const { requests } = JSON.parse(init!.body as string)
        return { responses: requests.map((r: { id: string }) => ({ id: r.id, status: r.id === '1' ? 404 : 200 })) }
      }]
    ])
    const res = await new OutlookProvider(http).applyTags([
      { providerId: 'o1', tag: 'Rejected', providerLabels: ['Blue', 'AI/Applied'] },
      { providerId: 'o2', tag: 'Junk', providerLabels: [] }
    ])
    const sent = JSON.parse(http.calls[0].init!.body as string).requests
    expect(sent[0].body.categories).toEqual(['Blue', 'AI/Rejected'])
    expect(res.ok).toEqual([{ providerId: 'o1', providerLabels: ['Blue', 'AI/Rejected'] }])
    expect(res.failed[0]).toMatchObject({ providerId: 'o2' })
  })
})
