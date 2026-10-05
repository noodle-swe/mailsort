import { useEffect } from 'react'
import { XIcon } from '@phosphor-icons/react'
import { SHORTCUT_GROUPS } from '../lib/useShortcuts'

function Key({ children }: { children: string }) {
  return <kbd className="grid h-6 min-w-6 place-items-center rounded-[6px] bg-field px-1.5 font-mono text-[11.5px] text-ink-soft">{children}</kbd>
}

export default function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' || e.key === '?') && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/25 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal aria-label="Keyboard shortcuts" className="glass-solid enter flex max-h-full w-[460px] max-w-full flex-col overflow-hidden">
        <header className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-[17px] font-semibold tracking-tight">Keyboard shortcuts</h2>
          <button onClick={onClose} className="press rounded-[8px] p-1 text-muted hover:bg-hover hover:text-ink" aria-label="Close shortcuts">
            <XIcon size={16} />
          </button>
        </header>
        <div className="flex flex-col gap-5 overflow-y-auto px-6 pb-6">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.title} className="flex flex-col gap-2">
              <h3 className="text-[13px] font-medium text-muted">{g.title}</h3>
              <ul className="flex flex-col gap-1.5">
                {g.items.map((it) => (
                  <li key={it.keys.join('+') + it.label} className="flex items-center justify-between gap-4 text-[13px]">
                    <span>{it.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {it.keys.map((k, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && <span className="text-xs text-muted">then</span>}
                          <Key>{k}</Key>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="text-xs leading-relaxed text-muted">Shortcuts pause while you type in a box. Hold Shift or Ctrl to select a range or several rows in the list.</p>
        </div>
      </div>
    </div>
  )
}
