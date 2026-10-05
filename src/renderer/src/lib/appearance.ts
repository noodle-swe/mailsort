import { useSyncExternalStore } from 'react'
import { backdropById, BACKDROPS, DEFAULT_BACKDROP } from './backdrops'
import { withTransition } from './motion'

import { FROST_AMOUNT, parseAppearance as parse, type Appearance } from '../../../core/ui-prefs'

export { FROST_AMOUNT, ROW_HEIGHT } from '../../../core/ui-prefs'
export type { Appearance, Density, Frost } from '../../../core/ui-prefs'

const BACKDROP_IDS = BACKDROPS.map((b) => b.id)
export const DEFAULTS: Appearance = { backdrop: DEFAULT_BACKDROP.id, density: 'comfortable', frost: 'frosted' }

export const parseAppearance = (raw: unknown): Appearance => parse(raw, BACKDROP_IDS)

const KEY = 'appearance'

function load(): Appearance {
  try {
    return parseAppearance(JSON.parse(localStorage.getItem(KEY) ?? '{}'))
  } catch {
    return DEFAULTS
  }
}

/** Absolute URL, so it resolves the same wherever the CSS that reads the variable lives. */
const css = (url: string) => `url("${new URL(url, document.baseURI).href}")`

/** Pushes the choices into CSS: the photo variables, the panel tint and the row density. */
export function applyAppearance(a: Appearance): void {
  const root = document.documentElement
  const b = backdropById(a.backdrop)
  root.style.setProperty('--photo', css(b.photo))
  root.style.setProperty('--photo-blur', css(b.blur))
  root.style.setProperty('--photo-base', b.base)
  root.style.setProperty('--frost', String(FROST_AMOUNT[a.frost]))
  root.dataset.density = a.density
  root.dataset.backdrop = b.id
}

let state: Appearance = load()
const listeners = new Set<() => void>()
if (typeof document !== 'undefined') applyAppearance(state)

function commit(next: Appearance): void {
  state = next
  applyAppearance(next)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // not persisted; the choice still applies for this session
  }
  listeners.forEach((l) => l())
}

/** Changing the photo cross-fades the whole window; the other options apply at once. */
export function setAppearance(patch: Partial<Appearance>): void {
  const next = parseAppearance({ ...state, ...patch })
  if (next.backdrop !== state.backdrop) withTransition(() => commit(next))
  else commit(next)
}

/** The next photo in the gallery, wrapping around. */
export function cycleBackdrop(): void {
  const i = BACKDROPS.findIndex((b) => b.id === state.backdrop)
  setAppearance({ backdrop: BACKDROPS[(i + 1) % BACKDROPS.length].id })
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state
  )
}
