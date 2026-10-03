import type { CSSProperties } from 'react'
import { TAG_INFO, type Tag } from '../../../core/tags'
import type { TagSource } from '../../../core/types'

const SOURCE_LABEL: Record<TagSource, string> = { rule: 'by rule', llm: 'by model', user: 'by you' }

export function tagColor(tag: Tag): string {
  return TAG_INFO[tag].color
}

export function TagSwatch({ tag }: { tag: Tag | 'Untagged' }) {
  return (
    <span
      aria-hidden
      className="h-2 w-2 shrink-0 rounded-[3px]"
      style={{ background: tag === 'Untagged' ? 'color-mix(in srgb, var(--muted) 55%, transparent)' : tagColor(tag) }}
    />
  )
}

export default function TagChip({ tag, source, small }: { tag: Tag; source?: TagSource | null; small?: boolean }) {
  return (
    <span
      title={`${TAG_INFO[tag].meaning}${source ? ` (${SOURCE_LABEL[source]})` : ''}`}
      className={`chip inline-flex shrink-0 items-center rounded-[7px] font-medium whitespace-nowrap ${small ? 'px-1.5 py-px text-[11px]' : 'px-2 py-0.5 text-xs'}`}
      style={{ '--tag': tagColor(tag) } as CSSProperties}
    >
      {tag}
    </span>
  )
}
