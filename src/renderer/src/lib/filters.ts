import { dateRange, DATE_PRESET_LABEL, isDatePreset, type DatePreset } from '../../../core/dates'
import type { Tag } from '../../../core/tags'
import type { ListQuery } from '../../../core/types'

/** What the filter bar can set. Dates are preset ids, so the query key stays stable until the user changes it. */
export interface Filters {
  date?: DatePreset
  unread?: boolean
  attachments?: boolean
  invite?: boolean
  newsletter?: boolean
  actionOnly?: boolean
  needsReview?: boolean
  oldest?: boolean
}

export type ToggleKey = Exclude<keyof Filters, 'date'>
export type FilterKey = keyof Filters

export const TOGGLE_LABEL: Record<ToggleKey, string> = {
  unread: 'Unread',
  attachments: 'Attachments',
  invite: 'Has invite',
  newsletter: 'Newsletters',
  actionOnly: 'Needs action',
  needsReview: 'Needs review',
  oldest: 'Oldest first'
}

export const TOGGLE_HINT: Record<ToggleKey, string> = {
  unread: 'Only emails you have not opened',
  attachments: 'Only emails with attachments',
  invite: 'Only emails with a calendar invite',
  newsletter: 'Only bulk mail with an unsubscribe link',
  actionOnly: 'Only Meeting, Questions and Needs Attention',
  needsReview: 'Low confidence tags and model guesses of "Other"',
  oldest: 'Oldest emails at the top, to work through a backlog'
}

type ViewTag = Tag | 'Untagged' | undefined

/** The filters worth showing for each tag; the last entry is for account and "All inboxes" views. */
const BY_TAG: Record<string, FilterKey[]> = {
  Applied: ['date', 'unread'],
  Rejected: ['date', 'unread'],
  Meeting: ['date', 'unread', 'invite'],
  Questions: ['date', 'unread', 'oldest'],
  'Needs Attention': ['unread', 'oldest', 'date'],
  Junk: ['date', 'newsletter', 'attachments'],
  Other: ['needsReview', 'date', 'unread'],
  Untagged: ['date'],
  '': ['date', 'unread', 'attachments', 'actionOnly']
}

export function filterKeysFor(tag: ViewTag): FilterKey[] {
  return BY_TAG[tag ?? '']
}

export function viewKey(view: { accountId?: string; tag?: ViewTag }): string {
  return `${view.accountId ?? 'all'}|${view.tag ?? 'all'}`
}

const TOGGLES = Object.keys(TOGGLE_LABEL) as ToggleKey[]

/** Keeps only filters that are on, so equal states compare equal and storage stays small. */
export function cleanFilters(f: Filters | undefined): Filters {
  const out: Filters = {}
  if (!f) return out
  if (isDatePreset(f.date)) out.date = f.date
  for (const k of TOGGLES) if (f[k] === true) out[k] = true
  return out
}

export function activeCount(f: Filters | undefined): number {
  const c = cleanFilters(f)
  return Object.keys(c).length
}

/** Fetch-time translation to the core query ("this week" is resolved now, not when it was chosen). */
export function filtersToQuery(f: Filters | undefined, now = new Date()): Partial<ListQuery> {
  const c = cleanFilters(f)
  return {
    ...(c.date ? dateRange(c.date, now) : {}),
    unreadOnly: c.unread,
    hasAttachments: c.attachments,
    hasInvite: c.invite,
    isNewsletter: c.newsletter,
    actionOnly: c.actionOnly,
    needsReview: c.needsReview,
    oldestFirst: c.oldest
  }
}

/** Short phrase for the list header, e.g. "last week, unread". */
export function describeFilters(f: Filters | undefined): string {
  const c = cleanFilters(f)
  const parts: string[] = []
  if (c.date) parts.push(DATE_PRESET_LABEL[c.date].toLowerCase())
  for (const k of TOGGLES) if (c[k]) parts.push(TOGGLE_LABEL[k].toLowerCase())
  return parts.join(', ')
}

const STORAGE_KEY = 'filters'

export function loadFilters(): Record<string, Filters> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, Filters>
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, cleanFilters(v)]))
  } catch {
    return {}
  }
}

export function saveFilters(all: Record<string, Filters>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // not persisted; the choice still applies for this session
  }
}
