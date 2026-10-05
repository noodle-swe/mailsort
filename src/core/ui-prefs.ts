// Layout and look choices, minus anything that touches the page, so they can be tested.

export type PaneName = 'side' | 'list' | 'chat'

/** Widths in px. The sidebar can also collapse to a narrow icon rail. */
export const PANE_LIMITS: Record<PaneName, { def: number; min: number; max: number }> = {
  side: { def: 232, min: 196, max: 320 },
  list: { def: 372, min: 300, max: 600 },
  chat: { def: 340, min: 280, max: 560 }
}
export const RAIL_WIDTH = 64

export interface Panes {
  side: number
  list: number
  chat: number
  sideCollapsed: boolean
}

export const DEFAULT_PANES: Panes = { side: PANE_LIMITS.side.def, list: PANE_LIMITS.list.def, chat: PANE_LIMITS.chat.def, sideCollapsed: false }

export function clampPane(name: PaneName, value: number): number {
  const { min, max, def } = PANE_LIMITS[name]
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : def
}

export function parsePanes(raw: unknown): Panes {
  const o = (raw ?? {}) as Partial<Panes>
  return {
    side: clampPane('side', o.side ?? DEFAULT_PANES.side),
    list: clampPane('list', o.list ?? DEFAULT_PANES.list),
    chat: clampPane('chat', o.chat ?? DEFAULT_PANES.chat),
    sideCollapsed: o.sideCollapsed === true
  }
}

export type Density = 'comfortable' | 'compact'
export type Frost = 'clear' | 'frosted' | 'solid'

export interface Appearance {
  backdrop: string
  density: Density
  frost: Frost
}

/** How much the panel tint multiplies, so panels range from see-through to nearly opaque. */
export const FROST_AMOUNT: Record<Frost, number> = { clear: 0.7, frosted: 1, solid: 1.25 }

/** Row height in the message list. */
export const ROW_HEIGHT: Record<Density, number> = { comfortable: 84, compact: 56 }

/** Reads saved choices; `backdrops` are the ids that exist, the first being the default. */
export function parseAppearance(raw: unknown, backdrops: readonly string[]): Appearance {
  const o = (raw ?? {}) as Partial<Appearance>
  return {
    backdrop: typeof o.backdrop === 'string' && backdrops.includes(o.backdrop) ? o.backdrop : backdrops[0],
    density: o.density === 'compact' ? 'compact' : 'comfortable',
    frost: o.frost === 'clear' || o.frost === 'solid' ? o.frost : 'frosted'
  }
}
