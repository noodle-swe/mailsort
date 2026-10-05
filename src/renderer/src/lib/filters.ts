import { cleanFilters, type Filters } from '../../../core/view-filters'

export * from '../../../core/view-filters'

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
