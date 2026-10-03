import type { ReactNode } from 'react'
import { isTag, type Tag } from '../../../core/tags'
import TagChip from './TagChip'

interface MailRow {
  date: string
  sender: string
  address: string
  subject: string
  tag: Tag | null
}

type Block = { kind: 'text'; text: string } | { kind: 'rows'; rows: MailRow[] }

/** Tool output the model echoes back: "- id=... | 2026-08-17 15:01 | Name <a@b.c> | Subject | tag=Meeting". */
const ROW = /^\s*[-*]\s*id=\S+\s*\|(.+)$/

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function shortDate(raw: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim())
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : raw.trim()
}

function parseRow(rest: string): MailRow | null {
  const parts = rest.split(' | ').map((p) => p.trim())
  if (parts.length < 3) return null
  const last = parts.at(-1) ?? ''
  const tagName = last.startsWith('tag=') ? last.slice(4) : null
  const subject = parts.slice(2, tagName === null ? undefined : -1).join(' | ')
  const from = /^(.*?)\s*<([^>]+)>$/.exec(parts[1])
  return {
    date: shortDate(parts[0]),
    sender: from ? from[1] || from[2] : parts[1],
    address: from ? from[2] : '',
    subject,
    tag: tagName && isTag(tagName) ? tagName : null
  }
}

function toBlocks(content: string): Block[] {
  const blocks: Block[] = []
  for (const line of content.split('\n')) {
    const row = ROW.exec(line)
    const parsed = row ? parseRow(row[1]) : null
    const last = blocks.at(-1)
    if (parsed) {
      if (last?.kind === 'rows') last.rows.push(parsed)
      else blocks.push({ kind: 'rows', rows: [parsed] })
    } else if (last?.kind === 'text') {
      last.text += `\n${line}`
    } else {
      blocks.push({ kind: 'text', text: line })
    }
  }
  return blocks
}

/** **bold** and `code` only; everything else stays plain text. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i} className="rounded-[5px] bg-field px-1 py-px text-[12px]">{part.slice(1, -1)}</code>
    return part
  })
}

export default function AssistantMessage({ content }: { content: string }) {
  return (
    <div className="selectable flex min-w-0 flex-col gap-2.5 text-[13px] leading-relaxed [overflow-wrap:anywhere]">
      {toBlocks(content).map((b, i) =>
        b.kind === 'rows' ? (
          <ul key={i} className="flex flex-col divide-y divide-line overflow-hidden rounded-[10px] bg-field">
            {b.rows.map((r, j) => (
              <li key={j} className="flex flex-col gap-1 px-3 py-2">
                <span className="line-clamp-2 font-medium text-ink">{r.subject}</span>
                <span className="flex items-center justify-between gap-2 text-xs text-muted">
                  <span className="min-w-0 truncate" title={r.address}>
                    {r.sender}
                    <span className="tabular-nums"> · {r.date}</span>
                  </span>
                  {r.tag && <TagChip tag={r.tag} small />}
                </span>
              </li>
            ))}
          </ul>
        ) : b.text.trim() ? (
          <p key={i} className="whitespace-pre-wrap text-ink-soft [text-wrap:pretty]">
            {inline(b.text.trim())}
          </p>
        ) : null
      )}
    </div>
  )
}
