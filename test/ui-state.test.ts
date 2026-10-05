import { describe, expect, it } from 'vitest'
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
})
