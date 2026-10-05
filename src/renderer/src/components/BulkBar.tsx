import { CaretDownIcon, EnvelopeSimpleIcon, EnvelopeSimpleOpenIcon, XIcon } from '@phosphor-icons/react'
import { TAGS, type Tag } from '../../../core/tags'

interface Props {
  count: number
  loaded: number
  onSelectAll: () => void
  onRead: (read: boolean) => void
  onTag: (tag: Tag) => void
  onClear: () => void
}

const btn = 'press flex h-7 items-center gap-1.5 rounded-[8px] bg-field px-2.5 text-xs font-medium text-ink-soft hover:bg-selected hover:text-ink'

/** Replaces the filter bar while emails are checked. */
export default function BulkBar({ count, loaded, onSelectAll, onRead, onTag, onClear }: Props) {
  return (
    <div role="toolbar" aria-label="Selected emails" className="enter flex flex-wrap items-center gap-1.5 px-4 pb-2.5">
      <span className="mr-1 text-xs font-medium tabular-nums">{count} selected</span>
      <button onClick={() => onRead(true)} className={btn} title="Mark as read">
        <EnvelopeSimpleOpenIcon size={13} />
        Read
      </button>
      <button onClick={() => onRead(false)} className={btn} title="Mark as unread">
        <EnvelopeSimpleIcon size={13} />
        Unread
      </button>
      <label className="relative">
        <span className="sr-only">Set tag for selected emails</span>
        <select
          value=""
          onChange={(e) => e.target.value && onTag(e.target.value as Tag)}
          className="press h-7 cursor-pointer appearance-none rounded-[8px] bg-field pr-6 pl-2.5 text-xs font-medium text-ink-soft hover:bg-selected hover:text-ink"
        >
          <option value="" disabled>
            Set tag
          </option>
          {TAGS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <CaretDownIcon size={11} className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-muted" />
      </label>
      {count < loaded && (
        <button onClick={onSelectAll} className="press h-7 rounded-[8px] px-2 text-xs text-muted hover:text-ink">
          Select all {loaded}
        </button>
      )}
      <button onClick={onClear} className="press ml-auto grid h-7 w-7 place-items-center rounded-[8px] text-muted hover:bg-hover hover:text-ink" aria-label="Clear selection" title="Clear selection (Esc)">
        <XIcon size={13} />
      </button>
    </div>
  )
}
