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
