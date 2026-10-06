export type DatePreset = 'today' | 'week' | 'lastWeek' | '30d'

export const DATE_PRESETS: readonly DatePreset[] = ['today', 'week', 'lastWeek', '30d']

export const DATE_PRESET_LABEL: Record<DatePreset, string> = {
  today: 'Today',
  week: 'This week',
  lastWeek: 'Last week',
  '30d': '30 days'
}

export function isDatePreset(v: unknown): v is DatePreset {
  return typeof v === 'string' && (DATE_PRESETS as readonly string[]).includes(v)
}

const DAY = 86_400_000
const MINUTE = 60_000

/** A range picked by hand: `since` is inclusive and `until` exclusive (epoch ms). Either end may be open. */
export interface CustomRange {
  since?: number
  until?: number
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Value for an `<input type="datetime-local">` in local time; empty when the end is open. */
export function toDateTimeInput(ms: number | undefined): string {
  if (ms === undefined) return ''
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Reads a `datetime-local` value as local time; undefined when it is empty or not a date. */
export function fromDateTimeInput(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : undefined
}

/** The "to" box names the last minute to include, so the exclusive `until` is the end of that minute. */
export const toBoxToUntil = (ms: number): number => ms + MINUTE
export const untilToToBox = (until: number | undefined): number | undefined => (until === undefined ? undefined : until - MINUTE)

/** Keeps a custom range only when at least one end is set and it is not backwards; otherwise undefined. */
export function cleanRange(r: unknown): CustomRange | undefined {
  if (!r || typeof r !== 'object') return undefined
  const { since, until } = r as Record<string, unknown>
  const s = typeof since === 'number' && Number.isFinite(since) ? since : undefined
  const u = typeof until === 'number' && Number.isFinite(until) ? until : undefined
  if (s === undefined && u === undefined) return undefined
  if (s !== undefined && u !== undefined && u <= s) return undefined
  return { ...(s !== undefined ? { since: s } : {}), ...(u !== undefined ? { until: u } : {}) }
}

/** Short text for a range in the system's clock style (so it matches the date boxes), e.g. "Oct 5, 09:00 AM to Oct 6, 05:30 PM", "from Oct 5, 09:00 AM" or "until Oct 6, 05:30 PM". */
export function describeRange(r: CustomRange, locale?: string): string {
  const fmt = (ms: number) => new Date(ms).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const last = r.until === undefined ? undefined : r.until - MINUTE
  if (r.since !== undefined && last !== undefined) return `${fmt(r.since)} to ${fmt(last)}`
  if (r.since !== undefined) return `from ${fmt(r.since)}`
  return last !== undefined ? `until ${fmt(last)}` : ''
}

/** Local midnight today, a sensible start when someone switches to a custom range. */
export function startOfToday(now: Date = new Date()): number {
  return startOfDay(now).getTime()
}

/** Local midnight at the start of `d`'s day. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Local midnight on the Monday of `d`'s week. */
function startOfWeek(d: Date): Date {
  const day = startOfDay(d)
  const sinceMonday = (day.getDay() + 6) % 7
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - sinceMonday)
}

/** `since` is inclusive and `until` exclusive (epoch ms); `until` is absent for ranges that run up to now. Weeks start on Monday. */
export function dateRange(preset: DatePreset, now: Date = new Date()): { since: number; until?: number } {
  switch (preset) {
    case 'today':
      return { since: startOfDay(now).getTime() }
    case 'week':
      return { since: startOfWeek(now).getTime() }
    case 'lastWeek': {
      const thisMonday = startOfWeek(now)
      return { since: new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7).getTime(), until: thisMonday.getTime() }
    }
    case '30d':
      return { since: now.getTime() - 30 * DAY }
  }
}
