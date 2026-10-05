import { CaretDownIcon, XIcon } from '@phosphor-icons/react'
import { DATE_PRESETS, DATE_PRESET_LABEL, isDatePreset } from '../../../core/dates'
import { activeCount, filterKeysFor, TOGGLE_HINT, TOGGLE_LABEL, type Filters, type ToggleKey } from '../lib/filters'
import type { View } from '../App'

interface Props {
  view: View
  filters: Filters
  onChange: (f: Filters) => void
}

/** Filters that make sense for this tag or mailbox; the choice is remembered per view by the app. */
export default function FilterBar({ view, filters, onChange }: Props) {
  const keys = filterKeysFor(view.tag)
  const active = activeCount(filters)

  return (
    <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-1.5 px-4 pb-2.5">
      {keys.map((k) =>
        k === 'date' ? (
          <label key={k} className="relative">
            <span className="sr-only">Date</span>
            <select
              value={filters.date ?? ''}
              onChange={(e) => onChange({ ...filters, date: isDatePreset(e.target.value) ? e.target.value : undefined })}
              className={`press h-7 cursor-pointer appearance-none rounded-[8px] pr-6 pl-2.5 text-xs font-medium ${filters.date ? 'bg-primary text-on-primary' : 'bg-field text-ink-soft hover:text-ink'}`}
            >
              <option value="">Any time</option>
              {DATE_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {DATE_PRESET_LABEL[p]}
                </option>
              ))}
            </select>
            <CaretDownIcon size={11} className={`pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 ${filters.date ? 'text-on-primary' : 'text-muted'}`} />
          </label>
        ) : (
          <Chip key={k} on={!!filters[k]} label={TOGGLE_LABEL[k as ToggleKey]} hint={TOGGLE_HINT[k as ToggleKey]} onClick={() => onChange({ ...filters, [k]: !filters[k] })} />
        )
      )}
      {active > 0 && (
        <button onClick={() => onChange({})} className="press flex h-7 items-center gap-1 rounded-[8px] px-2 text-xs text-muted hover:text-ink">
          <XIcon size={11} />
          Clear
        </button>
      )}
    </div>
  )
}

function Chip({ on, label, hint, onClick }: { on: boolean; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      title={hint}
      className={`press h-7 rounded-[8px] px-2.5 text-xs font-medium ${on ? 'bg-primary text-on-primary' : 'bg-field text-ink-soft hover:text-ink'}`}
    >
      {label}
    </button>
  )
}
