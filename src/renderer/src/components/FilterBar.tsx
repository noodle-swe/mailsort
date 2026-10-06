import { CaretDownIcon, XIcon } from '@phosphor-icons/react'
import {
  DATE_PRESETS,
  DATE_PRESET_LABEL,
  fromDateTimeInput,
  isDatePreset,
  startOfToday,
  toBoxToUntil,
  toDateTimeInput,
  untilToToBox,
  type CustomRange
} from '../../../core/dates'
import { activeCount, filterKeysFor, TOGGLE_HINT, TOGGLE_LABEL, type Filters, type ToggleKey } from '../lib/filters'
import type { View } from '../App'

interface Props {
  view: View
  filters: Filters
  onChange: (f: Filters) => void
}

const CUSTOM = 'custom'

/** Filters that make sense for this tag or mailbox; the choice is remembered per view by the app. */
export default function FilterBar({ view, filters, onChange }: Props) {
  const keys = filterKeysFor(view.tag)
  const active = activeCount(filters)
  const { range } = filters
  const dateOn = !!filters.date || !!range

  const pickDate = (value: string) => {
    if (value === CUSTOM) onChange({ ...filters, date: undefined, range: { since: startOfToday() } })
    else onChange({ ...filters, date: isDatePreset(value) ? value : undefined, range: undefined })
  }
  const setRange = (next: CustomRange) => onChange({ ...filters, date: undefined, range: next })

  return (
    <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-1.5 px-4 pb-2.5">
      {keys.map((k) =>
        k === 'date' ? (
          <label key={k} className="relative">
            <span className="sr-only">Date</span>
            <select
              value={range ? CUSTOM : (filters.date ?? '')}
              onChange={(e) => pickDate(e.target.value)}
              className={`press h-7 cursor-pointer appearance-none rounded-[8px] pr-6 pl-2.5 text-xs font-medium ${dateOn ? 'bg-primary text-on-primary' : 'bg-field text-ink-soft hover:text-ink'}`}
            >
              <option value="">Any time</option>
              {DATE_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {DATE_PRESET_LABEL[p]}
                </option>
              ))}
              <option value={CUSTOM}>Custom range</option>
            </select>
            <CaretDownIcon size={11} className={`pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 ${dateOn ? 'text-on-primary' : 'text-muted'}`} />
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
      {range && (
        <div className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1.5">
          <DateTimeField
            label="From"
            value={toDateTimeInput(range.since)}
            max={toDateTimeInput(untilToToBox(range.until))}
            onChange={(since) => setRange({ since, until: range.until })}
          />
          <DateTimeField
            label="To"
            value={toDateTimeInput(untilToToBox(range.until))}
            min={toDateTimeInput(range.since)}
            onChange={(last) => setRange({ since: range.since, until: last === undefined ? undefined : toBoxToUntil(last) })}
          />
        </div>
      )}
    </div>
  )
}

/** A date and time box in local time. Emptying it leaves that end of the range open. */
function DateTimeField({ label, value, min, max, onChange }: { label: string; value: string; min?: string; max?: string; onChange: (ms: number | undefined) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      <span className="w-8">{label}</span>
      <input
        type="datetime-local"
        value={value}
        min={min || undefined}
        max={max || undefined}
        onChange={(e) => onChange(fromDateTimeInput(e.target.value))}
        className="h-7 rounded-[8px] bg-field px-2 text-xs text-ink-soft tabular-nums outline-none focus:bg-selected"
      />
    </label>
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
