import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMailMcpServer, parseSince } from '../src/mcp/server'
import type { Core } from '../src/core/core'
import type { Tag } from '../src/core/tags'
import { fakeClassifier, FIXTURES, seededCore } from './helpers'

let core: Core | undefined
let client: Client | undefined

afterEach(async () => {
  await client?.close()
  core?.close()
})

async function connect(): Promise<Client> {
  const answers = new Map<string, Tag>(FIXTURES.map((f) => [f.subject!, f.expected]))
  ;({ core } = seededCore(fakeClassifier(answers)))
  const [a, b] = InMemoryTransport.createLinkedPair()
  await createMailMcpServer(core).connect(a)
  client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(b)
  return client
}

const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content[0].text)

describe('MCP server', () => {
  it('lists the email tools', async () => {
    const c = await connect()
    const names = (await c.listTools()).tools.map((t) => t.name).sort()
    expect(names).toEqual(['get_email', 'list_accounts', 'search_emails', 'set_tag', 'sync_mail', 'tag_emails', 'tag_summary'])
  })

  it('tags emails with progress and summarizes by tag', async () => {
    const c = await connect()
    const progress: number[] = []
    const res = await c.callTool({ name: 'tag_emails', arguments: {} }, undefined, { onprogress: (p) => progress.push(p.progress) })
    const out = textOf(res)
    expect(out).toMatch(new RegExp(`Tagged ${FIXTURES.length} of ${FIXTURES.length} emails`))
    expect(out).toContain('Meeting')
    expect(progress.at(-1)).toBe(FIXTURES.length)

    const summary = textOf(await c.callTool({ name: 'tag_summary', arguments: {} }))
    expect(summary).toMatch(/Applied: \d+/)
    expect(summary).toContain('Needs action:')
  })

  it('searches, reads and re-tags an email', async () => {
    const c = await connect()
    const found = textOf(await c.callTool({ name: 'search_emails', arguments: { query: 'lasagna' } }))
    const id = found.match(/id=(\S+)/)![1]
    const email = textOf(await c.callTool({ name: 'get_email', arguments: { id } }))
    expect(email).toContain('Subject: Dinner on Sunday?')
    expect(textOf(await c.callTool({ name: 'set_tag', arguments: { ids: [id], tag: 'Junk' } }))).toBe('Set 1 email(s) to Junk.')
    expect(core!.store.getTag(id)).toEqual({ tag: 'Junk', source: 'user' })
  })

  it('rejects unknown tags through the schema', async () => {
    const c = await connect()
    const res = await c.callTool({ name: 'set_tag', arguments: { ids: ['x'], tag: 'Spam' } })
    expect(res.isError).toBe(true)
  })

  it('reads the tag definitions resource', async () => {
    const c = await connect()
    const r = await c.readResource({ uri: 'mail://tags' })
    expect((r.contents[0] as { text: string }).text).toContain('Needs Attention: Application is not complete')
  })
})

describe('parseSince', () => {
  it('handles relative and absolute dates', () => {
    expect(Date.now() - parseSince('7d')!).toBeGreaterThan(6.9 * 86_400_000)
    expect(parseSince('2026-09-01')).toBe(Date.parse('2026-09-01'))
    expect(parseSince(undefined)).toBeUndefined()
    expect(() => parseSince('last tuesday')).toThrow()
  })
})
