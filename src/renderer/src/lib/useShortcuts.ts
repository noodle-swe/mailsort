import { useEffect, useRef } from 'react'
import { TAGS, type Tag } from '../../../core/tags'

export interface ShortcutHandlers {
  move(delta: 1 | -1): void
  toggleCheck(): void
  toggleRead(): void
  setTag(tag: Tag): void
  focusSearch(): void
  /** Second key of a "g then ..." chord. Returns false when the key means nothing. */
  goTo(key: string): boolean
  toggleChat(): void
  escape(): void
  help(): void
}

/** Shown in the cheat sheet; keep in step with the switch below. */
export const SHORTCUT_GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  {
    title: 'Move',
    items: [
      { keys: ['j'], label: 'Next email' },
      { keys: ['k'], label: 'Previous email' },
      { keys: ['g', 'i'], label: 'Go to All inboxes' },
      { keys: ['g', 'a'], label: 'Go to Applied' },
      { keys: ['g', 'r'], label: 'Go to Rejected' },
      { keys: ['g', 'm'], label: 'Go to Meeting' },
      { keys: ['g', 'q'], label: 'Go to Questions' },
      { keys: ['g', 'n'], label: 'Go to Needs Attention' },
      { keys: ['g', 'j'], label: 'Go to Junk' },
      { keys: ['g', 'o'], label: 'Go to Other' },
      { keys: ['/'], label: 'Search' }
    ]
  },
  {
    title: 'Act on the open or selected emails',
    items: [
      { keys: ['x'], label: 'Select or unselect the current email' },
      { keys: ['u'], label: 'Mark read or unread' },
      ...TAGS.map((t, i) => ({ keys: [String(i + 1)], label: `Tag as ${t}` })),
      { keys: ['Esc'], label: 'Clear the selection, or go back to the list' }
    ]
  },
  {
    title: 'App',
    items: [
      { keys: ['c'], label: 'Show or hide the assistant' },
      { keys: ['?'], label: 'This list' }
    ]
  }
]

/** "g" then a letter, within this long. */
const CHORD_MS = 1000

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

/** App-wide single-key shortcuts. Ignored while typing, with a modifier held, or when `enabled` is false. */
export function useShortcuts(handlers: ShortcutHandlers, enabled: boolean): void {
  const ref = useRef(handlers)
  ref.current = handlers
  const chord = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return
    const clearChord = () => {
      if (chord.current) window.clearTimeout(chord.current)
      chord.current = null
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return
      const h = ref.current
      if (chord.current) {
        clearChord()
        if (h.goTo(e.key)) e.preventDefault()
        return
      }
      const n = Number(e.key)
      if (n >= 1 && n <= TAGS.length) {
        e.preventDefault()
        return h.setTag(TAGS[n - 1])
      }
      switch (e.key) {
        case 'j':
          e.preventDefault()
          return h.move(1)
        case 'k':
          e.preventDefault()
          return h.move(-1)
        case 'x':
          e.preventDefault()
          return h.toggleCheck()
        case 'u':
          e.preventDefault()
          return h.toggleRead()
        case '/':
          e.preventDefault()
          return h.focusSearch()
        case 'c':
          return h.toggleChat()
        case '?':
          e.preventDefault()
          return h.help()
        case 'Escape':
          return h.escape()
        case 'g':
          chord.current = window.setTimeout(clearChord, CHORD_MS)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      clearChord()
    }
  }, [enabled])
}
