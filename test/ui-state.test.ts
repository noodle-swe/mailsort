import { describe, expect, it } from 'vitest'
import { describeFinished, taggingStatus } from '../src/core/tagging-status'
import type { TaggingFinished } from '../src/core/types'
import { clampPane, DEFAULT_PANES, FROST_AMOUNT, PANE_LIMITS, parseAppearance, parsePanes, ROW_HEIGHT } from '../src/core/ui-prefs'
import { activeCount, cleanFilters, describeFilters, filterKeysFor, filtersToQuery, viewKey } from '../src/core/view-filters'

describe('panes', () => {
  it('keeps widths inside their limits', () => {
    expect(clampPane('list', 50)).toBe(PANE_LIMITS.list.min)
    expect(clampPane('list', 5000)).toBe(PANE_LIMITS.list.max)
    expect(clampPane('chat', 400.4)).toBe(400)
    expect(clampPane('side', Number.NaN)).toBe(PANE_LIMITS.side.def)
  })

  it('reads saved sizes defensively', () => {
    expect(parsePanes(null)).toEqual(DEFAULT_PANES)
    expect(parsePanes({ side: 9999, list: 'wide', chat: 300, sideCollapsed: 'yes' })).toEqual({
      side: PANE_LIMITS.side.max,
      list: PANE_LIMITS.list.def,
      chat: 300,
      sideCollapsed: false
    })
    expect(parsePanes({ sideCollapsed: true }).sideCollapsed).toBe(true)
  })
})

const IDS = ['highland', 'mist', 'dusk']
const DEFAULTS = { backdrop: 'highland', density: 'comfortable', frost: 'frosted' }

describe('appearance', () => {
  it('falls back to the defaults for anything unknown', () => {
    expect(parseAppearance(undefined, IDS)).toEqual(DEFAULTS)
    expect(parseAppearance({ backdrop: 'volcano', density: 'tiny', frost: 'wet' }, IDS)).toEqual(DEFAULTS)
  })

  it('keeps valid choices', () => {
    expect(parseAppearance({ backdrop: 'dusk', density: 'compact', frost: 'solid' }, IDS)).toEqual({ backdrop: 'dusk', density: 'compact', frost: 'solid' })
  })

  it('has a row height for every density and a tint for every panel style', () => {
    expect(ROW_HEIGHT.compact).toBeLessThan(ROW_HEIGHT.comfortable)
    expect(FROST_AMOUNT.clear).toBeLessThan(FROST_AMOUNT.frosted)
    expect(FROST_AMOUNT.frosted).toBeLessThan(FROST_AMOUNT.solid)
  })
})

describe('tagging status', () => {
  const finished = (o: Partial<TaggingFinished> = {}): TaggingFinished => ({ total: 10, tagged: 10, failed: 0, ms: 4200, auto: false, ...o })
  const idle = { progress: null, starting: false, finished: null }

  it('says Starting the moment the button is clicked, before any progress arrives', () => {
    const s = taggingStatus({ ...idle, starting: true })
    expect(s).toMatchObject({ busy: true, label: 'Starting', fraction: null })
    expect(s.line?.text).toBeTruthy()
  })

  it('counts up while tagging', () => {
    const s = taggingStatus({ ...idle, progress: { done: 3, total: 10, stage: 'llm' } })
    expect(s).toMatchObject({ busy: true, label: 'Tagging 3 of 10', fraction: 0.3, line: null })
  })

  it('explains the wait while Ollama loads the model', () => {
    const s = taggingStatus({ ...idle, progress: { done: 4, total: 10, stage: 'model' } })
    expect(s.fraction).toBeNull()
    expect(s.line?.text).toMatch(/Ollama.*loads the model/)
  })

  it('is ready again afterwards, and says how it went', () => {
    expect(taggingStatus(idle)).toMatchObject({ busy: false, label: 'Tag new emails', line: null })
    expect(taggingStatus({ ...idle, finished: finished() }).line).toEqual({ text: 'Tagged 10 emails in 4.2s.', tone: 'info' })
    expect(describeFinished(finished({ total: 1, tagged: 1, ms: 30 })).text).toBe('Tagged 1 email.')
    expect(describeFinished(finished({ tagged: 12, auto: true })).text).toBe('Tagged 12 emails that just arrived in 4.2s.')
  })

  it('never lets a click end in silence: nothing to tag, partial and failed runs all say so', () => {
    expect(describeFinished(finished({ total: 0, tagged: 0 }))).toEqual({ text: 'Nothing to tag. Every email already has a tag.', tone: 'info' })
    expect(describeFinished(finished({ tagged: 7, failed: 3 }))).toEqual({ text: 'Tagged 7 of 10. 3 emails could not be tagged.', tone: 'error' })
    const down = describeFinished(finished({ tagged: 2, failed: 8, error: "Can't reach Ollama at http://127.0.0.1:11434" }))
    expect(down.tone).toBe('error')
    expect(down.text).toBe("Tagged 2 of 10. Can't reach Ollama at http://127.0.0.1:11434")
  })
})

describe('filters', () => {
  it('shows different filters for different tags', () => {
    expect(filterKeysFor('Meeting')).toContain('invite')
    expect(filterKeysFor('Junk')).toContain('newsletter')
    expect(filterKeysFor('Other')).toContain('needsReview')
    expect(filterKeysFor(undefined)).toContain('actionOnly')
    expect(filterKeysFor('Applied')).not.toContain('invite')
  })

  it('names a view by account and tag', () => {
    expect(viewKey({})).toBe('all|all')
    expect(viewKey({ accountId: 'gmail-1', tag: 'Applied' })).toBe('gmail-1|Applied')
  })

  it('drops filters that are off or invalid', () => {
    expect(cleanFilters({ unread: false, attachments: true, date: 'week' })).toEqual({ attachments: true, date: 'week' })
    expect(cleanFilters({ date: 'yesterday' as never })).toEqual({})
    expect(activeCount({ unread: true, date: '30d' })).toBe(2)
    expect(activeCount(undefined)).toBe(0)
  })

  it('turns choices into a query, resolving the date when it is asked for', () => {
    const now = new Date(2026, 9, 7, 15, 30)
    const q = filtersToQuery({ date: 'lastWeek', unread: true, oldest: true }, now)
    expect(q).toMatchObject({ unreadOnly: true, oldestFirst: true, since: new Date(2026, 8, 28).getTime(), until: new Date(2026, 9, 5).getTime() })
    expect(filtersToQuery({}, now).since).toBeUndefined()
  })

  it('describes the active filters for the list header', () => {
    expect(describeFilters({ date: 'lastWeek', unread: true })).toBe('last week, unread')
    expect(describeFilters({})).toBe('')
  })

  it('offers the date control, with its custom range, in every view', () => {
    for (const tag of [undefined, 'Applied', 'Rejected', 'Meeting', 'Questions', 'Needs Attention', 'Junk', 'Other', 'Untagged'] as const) {
      expect(filterKeysFor(tag)).toContain('date')
    }
  })

  it('keeps a custom date and time range instead of a preset, and counts it as one filter', () => {
    const range = { since: new Date(2026, 9, 5, 9, 0).getTime(), until: new Date(2026, 9, 6, 17, 1).getTime() }
    expect(cleanFilters({ date: 'week', range })).toEqual({ range })
    expect(cleanFilters({ date: 'week', range: { since: 9, until: 5 } })).toEqual({ date: 'week' })
    expect(activeCount({ range, unread: true })).toBe(2)
  })

  it('sends the custom range as it is, without resolving it against today', () => {
    const range = { since: new Date(2026, 9, 5, 9, 0).getTime(), until: new Date(2026, 9, 6, 17, 1).getTime() }
    const q = filtersToQuery({ range, unread: true }, new Date(2030, 0, 1))
    expect(q).toMatchObject({ since: range.since, until: range.until, unreadOnly: true })
    expect(filtersToQuery({ range: { since: range.since } }).until).toBeUndefined()
  })

  it('describes a custom range for the list header', () => {
    const range = { since: new Date(2026, 9, 5, 9, 0).getTime(), until: new Date(2026, 9, 6, 17, 1).getTime() }
    // The clock style follows the system locale, so only the shape is checked here.
    expect(describeFilters({ range, unread: true })).toMatch(/ to .+, unread$/)
  })
})
