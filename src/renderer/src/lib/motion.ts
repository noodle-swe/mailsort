import { flushSync } from 'react-dom'

export const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Runs a state change inside a View Transition, so the browser cross-fades the old and new screen and
 * slides any panel that has a view-transition-name to its new place. Falls back to a plain update when
 * the browser has no View Transitions or the user asked for reduced motion.
 */
export function withTransition(update: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (!doc.startViewTransition || prefersReducedMotion()) return update()
  doc.startViewTransition(() => flushSync(update))
}
