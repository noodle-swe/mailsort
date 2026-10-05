import { useRef } from 'react'
import { clampPane, PANE_LIMITS, previewPane, setPane, usePanes, type PaneName } from '../lib/panes'

const STEP = 16

/**
 * The gap between two panels, draggable to resize the one named by `pane`.
 * `grow` is +1 when dragging right makes the pane wider (panels left of the handle) and -1 for panels to its right.
 * Arrow keys nudge it, Shift makes the steps bigger, double-click or Enter restores the default width.
 */
export default function ResizeHandle({ pane, label, grow }: { pane: PaneName; label: string; grow: 1 | -1 }) {
  const width = usePanes()[pane]
  const drag = useRef<{ x: number; w: number; now: number } | null>(null)
  const { min, max, def } = PANE_LIMITS[pane]

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, w: width, now: width }
    document.documentElement.dataset.resizing = 'true'
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    d.now = clampPane(pane, d.w + grow * (e.clientX - d.x))
    previewPane(pane, d.now)
  }
  const end = () => {
    const d = drag.current
    drag.current = null
    delete document.documentElement.dataset.resizing
    if (d) setPane(pane, d.now)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = (e.shiftKey ? 3 : 1) * STEP
    if (e.key === 'ArrowLeft') setPane(pane, width - grow * step)
    else if (e.key === 'ArrowRight') setPane(pane, width + grow * step)
    else if (e.key === 'Enter' || e.key === 'Home') setPane(pane, def)
    else return
    e.preventDefault()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => setPane(pane, def)}
      onKeyDown={onKeyDown}
      className="group no-drag relative z-[1] w-2.5 shrink-0 cursor-col-resize touch-none outline-none"
    >
      <span className="absolute inset-y-8 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-white/0 transition-colors duration-200 group-hover:bg-white/45 group-focus-visible:bg-white/70 group-active:bg-white/80" />
    </div>
  )
}
