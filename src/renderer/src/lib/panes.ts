import { useSyncExternalStore } from 'react'

import { clampPane, DEFAULT_PANES, parsePanes, RAIL_WIDTH, type PaneName, type Panes } from '../../../core/ui-prefs'

export { clampPane, DEFAULT_PANES, PANE_LIMITS, RAIL_WIDTH } from '../../../core/ui-prefs'
export type { PaneName, Panes } from '../../../core/ui-prefs'

const KEY = 'panes'

function load(): Panes {
  try {
    return parsePanes(JSON.parse(localStorage.getItem(KEY) ?? '{}'))
  } catch {
    return DEFAULT_PANES
  }
}

/** Writes the widths into CSS variables, which the layout reads (so dragging never re-renders React). */
function paint(p: Panes): void {
  const root = document.documentElement.style
  root.setProperty('--w-side', `${p.side}px`)
  root.setProperty('--w-list', `${p.list}px`)
  root.setProperty('--w-chat', `${p.chat}px`)
  root.setProperty('--side', p.sideCollapsed ? `${RAIL_WIDTH}px` : `${p.side}px`)
}

let state: Panes = load()
const listeners = new Set<() => void>()
if (typeof document !== 'undefined') paint(state)

function commit(next: Panes): void {
  state = next
  paint(next)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // not persisted; the sizes still apply for this session
  }
  listeners.forEach((l) => l())
}

/** Follows the pointer while a handle is dragged: CSS only, nothing is stored or re-rendered. */
export function previewPane(name: PaneName, width: number): void {
  const w = clampPane(name, width)
  const root = document.documentElement.style
  root.setProperty(`--w-${name}`, `${w}px`)
  if (name === 'side' && !state.sideCollapsed) root.setProperty('--side', `${w}px`)
}

export function setPane(name: PaneName, width: number): void {
  commit({ ...state, [name]: clampPane(name, width) })
}

export function setSideCollapsed(collapsed: boolean): void {
  commit({ ...state, sideCollapsed: collapsed })
}

export function resetPanes(): void {
  commit({ ...DEFAULT_PANES, sideCollapsed: state.sideCollapsed })
}

export function usePanes(): Panes {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state
  )
}
