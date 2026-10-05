import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod'
import type { Core } from '../core/core'
import { ACTION_TAGS, TAGS, TAG_INFO, tagDefinitionsText, type Tag } from '../core/tags'
import type { MessageSummary, TaggingResult } from '../core/types'

export const SERVER_NAME = 'mailsort'
export const SERVER_VERSION = '0.1.0'

const TagSchema = z.enum(TAGS)
const SinceSchema = z
  .string()
  .optional()
  .describe('Only emails received after this. Either a date like 2026-09-01 or a relative age like 7d (days) or 12h (hours).')

/** "7d" / "12h" / ISO date → epoch ms. */
export function parseSince(since: string | undefined): number | undefined {
  if (!since) return undefined
  const rel = since.trim().match(/^(\d+)\s*([dhw])$/i)
  if (rel) {
    const unit = { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[rel[2].toLowerCase() as 'h' | 'd' | 'w']
    return Date.now() - Number(rel[1]) * unit
  }
  const t = Date.parse(since)
  if (Number.isNaN(t)) throw new Error(`Could not understand since="${since}". Use a date like 2026-09-01 or an age like 7d.`)
  return t
}

function fmtDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function line(m: MessageSummary): string {
  const from = m.fromName ? `${m.fromName} <${m.fromAddr ?? ''}>` : (m.fromAddr ?? 'unknown')
  return `- id=${m.id} | ${fmtDate(m.receivedAt)} | ${from} | ${m.subject ?? '(no subject)'} | tag=${m.tag ?? 'untagged'}${m.isRead ? '' : ' | unread'}`
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })
const fail = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true })

export function summarizeTagging(r: TaggingResult): string {
  if (r.total === 0) return 'No new emails to tag. Everything in range is already tagged.'
  const counts = TAGS.filter((t) => r.byTag[t])
    .map((t) => `${t} ${r.byTag[t]}`)
    .join(', ')
  const parts = [
    `Tagged ${r.tagged} of ${r.total} emails in ${(r.ms / 1000).toFixed(1)}s (${r.byRules} by rules, ${r.byLlm} by the model).`,
    counts ? `Counts: ${counts}.` : '',
    r.failed ? `${r.failed} could not be tagged.` : '',
    r.error ? `Problem: ${r.error}` : ''
  ]
  const examples = r.results.map((x) => `- [${x.tag}] ${x.from ?? 'unknown'}: ${x.subject ?? '(no subject)'}`)
  return [...parts.filter(Boolean), examples.length ? `Examples:\n${examples.join('\n')}` : ''].filter(Boolean).join('\n')
}

/** Builds an MCP server over the shared core. Create one per connection/transport. */
export function createMailMcpServer(core: Core): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Email tools for a job seeker\'s Gmail and Outlook inboxes. Use tag_emails to sort new mail into tags ' +
        `(${TAGS.join(', ')}), tag_summary for an overview, search_emails to find mail and get_email to read one.`
    }
  )

  server.registerResource(
    'tag-definitions',
    'mail://tags',
    { title: 'Email tag definitions', mimeType: 'text/plain' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/plain', text: tagDefinitionsText() }] })
  )

  server.registerTool(
    'list_accounts',
    {
      title: 'List mail accounts',
      description: 'List the connected Gmail and Outlook accounts with their last sync time and any error.',
      annotations: { readOnlyHint: true }
    },
    async () => {
      const accounts = core.store.listAccounts()
      if (!accounts.length) return text('No accounts connected yet. Add one in the MailSort app.')
      const unread = core.store.unreadCounts()
      return text(
        accounts
          .map(
            (a) =>
              `- id=${a.id} | ${a.provider} | ${a.email} | unread ${unread[a.id] ?? 0} | last sync ${a.lastSyncAt ? fmtDate(a.lastSyncAt) : 'never'}${a.lastError ? ` | error: ${a.lastError}` : ''}`
          )
          .join('\n')
      )
    }
  )

  server.registerTool(
    'sync_mail',
    {
      title: 'Sync mail',
      description: 'Fetch new mail from the servers now (one account or all).',
      inputSchema: { accountId: z.string().optional().describe('Account id from list_accounts; omit for all accounts.') }
    },
    async ({ accountId }) => {
      const ids = accountId ? [accountId] : core.store.listAccounts().map((a) => a.id)
      if (!ids.length) return text('No accounts connected.')
      const added = await Promise.all(ids.map((id) => core.syncAccount(id)))
      const errors = core.store
        .listAccounts()
        .filter((a) => ids.includes(a.id) && a.lastError)
        .map((a) => `${a.email}: ${a.lastError}`)
      return text(`Synced ${ids.length} account(s); ${added.reduce((a, b) => a + b, 0)} new email(s).${errors.length ? `\nErrors:\n${errors.join('\n')}` : ''}`)
    }
  )

  server.registerTool(
    'search_emails',
    {
      title: 'Search emails',
      description: 'Find emails by text, tag, sender, account, date or unread state. Newest first.',
      inputSchema: {
        query: z.string().optional().describe('Words to search in subject, sender and body.'),
        tag: z.enum([...TAGS, 'Untagged']).optional(),
        from: z.string().optional().describe('Part of the sender name or address.'),
        accountId: z.string().optional(),
        since: SinceSchema,
        until: z
          .string()
          .optional()
          .describe('Only emails received before this date, like 2026-09-28. With since, this gives an exact range such as last week.'),
        unreadOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).optional().describe('Default 20.')
      },
      annotations: { readOnlyHint: true }
    },
    async ({ query, tag, from, accountId, since, until, unreadOnly, limit }) => {
      const untilMs = until ? Date.parse(until) : undefined
      if (until && Number.isNaN(untilMs)) throw new Error(`Could not understand until="${until}". Use a date like 2026-09-28.`)
      const page = core.store.listMessages({ query, tag, from, accountId, since: parseSince(since), until: untilMs, unreadOnly, limit: limit ?? 20 })
      if (!page.items.length) return text('No emails match.')
      return text(`${page.items.length} email(s)${page.nextCursor ? ' (more exist; narrow the search)' : ''}:\n${page.items.map(line).join('\n')}`)
    }
  )

  server.registerTool(
    'get_email',
    {
      title: 'Read an email',
      description: 'Read one email: headers, tag and cleaned body text.',
      inputSchema: { id: z.string().describe('Email id from search_emails.') },
      annotations: { readOnlyHint: true }
    },
    async ({ id }) => {
      const m = core.store.getMessage(id)
      if (!m) return fail(`No email with id ${id}.`)
      return text(
        [
          `From: ${m.fromName ?? ''} <${m.fromAddr ?? ''}>`,
          `To: ${m.toAddrs ?? ''}`,
          `Date: ${fmtDate(m.receivedAt)}`,
          `Subject: ${m.subject ?? '(no subject)'}`,
          `Tag: ${m.tag ?? 'untagged'}${m.tagReason ? ` (${m.tagReason})` : ''}`,
          '',
          (m.bodyText ?? m.snippet ?? '').slice(0, 3000)
        ].join('\n')
      )
    }
  )

  server.registerTool(
    'tag_emails',
    {
      title: 'Tag emails',
      description:
        'Sort untagged emails into tags: ' +
        TAGS.map((t) => `${t} (${TAG_INFO[t].meaning})`).join('; ') +
        '. Uses fast rules first, then the local model. Returns counts and examples.',
      inputSchema: {
        since: SinceSchema,
        accountId: z.string().optional(),
        retag: z.boolean().optional().describe('Also re-tag emails that already have an automatic tag. Your manual tags are always kept.'),
        limit: z.number().int().min(1).max(2000).optional().describe('Max emails to process, newest first. Default 500.')
      }
    },
    async ({ since, accountId, retag, limit }, extra) => {
      const token = extra._meta?.progressToken
      let lastSent = 0
      const result = await core.runTagging({
        since: parseSince(since),
        accountId,
        retag,
        limit,
        signal: extra.signal,
        onProgress: (p) => {
          if (token === undefined || (Date.now() - lastSent < 250 && p.stage !== 'done')) return
          lastSent = Date.now()
          void extra
            .sendNotification({
              method: 'notifications/progress',
              params: { progressToken: token, progress: p.done, total: p.total, message: `Tagging ${p.done}/${p.total}` }
            })
            .catch(() => undefined)
        }
      })
      return text(summarizeTagging(result))
    }
  )

  server.registerTool(
    'set_tag',
    {
      title: 'Set tag',
      description: 'Manually set the tag of one or more emails. The app learns from these corrections.',
      inputSchema: { ids: z.array(z.string()).min(1).max(200), tag: TagSchema },
      annotations: { idempotentHint: true }
    },
    async ({ ids, tag }) => {
      const n = core.setUserTag(ids, tag as Tag)
      return text(n ? `Set ${n} email(s) to ${tag}.` : 'No matching emails.')
    }
  )

  server.registerTool(
    'tag_summary',
    {
      title: 'Tag summary',
      description: 'Counts per tag, plus the newest emails that need action (Meeting, Questions, Needs Attention).',
      inputSchema: { since: SinceSchema, accountId: z.string().optional() },
      annotations: { readOnlyHint: true }
    },
    async ({ since, accountId }) => {
      const sinceMs = parseSince(since)
      const counts = core.store.tagCounts({ since: sinceMs, accountId })
      const order = [...TAGS, 'Untagged']
      const countText = order.filter((t) => counts[t]).map((t) => `${t}: ${counts[t]}`).join(', ') || 'no emails'
      const action = ACTION_TAGS.flatMap((tag) => core.store.listMessages({ tag, since: sinceMs, accountId, limit: 5 }).items)
        .sort((a, b) => b.receivedAt - a.receivedAt)
        .slice(0, 10)
      return text(`${countText}\n${action.length ? `Needs action:\n${action.map(line).join('\n')}` : 'Nothing needs action.'}`)
    }
  )

  return server
}
