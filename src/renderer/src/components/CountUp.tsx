import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from '../lib/motion'

/**
 * A number that counts up to its value. It writes the text straight into the element, so the
 * animation never re-renders React. Under reduced motion it just shows the number.
 */
export default function CountUp({ value, duration = 700 }: { value: number; duration?: number }) {
  const el = useRef<HTMLSpanElement>(null)
  const shown = useRef(0)

  useEffect(() => {
    const node = el.current
    if (!node) return
    const from = shown.current
    if (from === value || prefersReducedMotion()) {
      shown.current = value
      node.textContent = String(value)
      return
    }
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / duration)
      shown.current = Math.round(from + (value - from) * (1 - Math.pow(1 - k, 4)))
      node.textContent = String(shown.current)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])

  // The text is owned by the effect above; React never changes this child, so it never fights it.
  return (
    <span ref={el} className="tabular-nums">
      0
    </span>
  )
}
