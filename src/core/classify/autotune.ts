import type { OllamaRunningModel } from '../ollama'

/** Used when Ollama can't tell us how the model is loaded. */
export const DEFAULT_CEILING = 4
/** Most requests worth having in flight when the whole model sits in GPU memory. */
const GPU_CEILING = 8
/** Part of the model runs on the CPU: more parallel requests mostly queue and grow the KV cache. */
const OFFLOADED_CEILING = 2

/**
 * Upper bound for parallel requests from how Ollama loaded the model (/api/ps).
 * The tuner then finds the best value below it by measuring.
 */
export function concurrencyCeiling(loaded: OllamaRunningModel | undefined): number {
  if (!loaded || loaded.size <= 0) return DEFAULT_CEILING
  return loaded.sizeVram >= loaded.size * 0.97 ? GPU_CEILING : OFFLOADED_CEILING
}

/**
 * Hill-climbing choice of how many requests to run at once.
 *
 * Ollama serves as many requests in parallel as its OLLAMA_NUM_PARALLEL allows, and the client cannot read that
 * value. So instead of guessing, it measures: after each window of finished emails it compares throughput with the
 * best level so far, tries one more worker while that pays off by at least 15%, and falls back otherwise.
 * The first window is thrown away because it includes loading the model.
 */
export class ConcurrencyTuner {
  private level: number
  private best: { level: number; rate: number } | null = null
  private settled = false
  private warm = false
  private windowStart: number
  private windowDone = 0

  constructor(
    private readonly max: number,
    start = 1,
    private readonly now: () => number = Date.now
  ) {
    this.level = Math.min(Math.max(1, start), max)
    this.windowStart = now()
  }

  /** How many requests may run right now. */
  get limit(): number {
    return this.level
  }

  /** The level to start from next time (the one measured best, or the current one while still probing). */
  get chosen(): number {
    return this.best?.level ?? this.level
  }

  /** Call once per finished email. */
  completed(): void {
    this.windowDone++
    if (this.windowDone < Math.max(4, this.level * 3)) return
    const t = this.now()
    const rate = this.windowDone / Math.max(1, t - this.windowStart)
    this.windowStart = t
    this.windowDone = 0
    if (!this.warm) {
      this.warm = true
      return
    }
    if (this.settled) return

    if (!this.best || rate > this.best.rate * 1.15) {
      this.best = { level: this.level, rate }
      if (this.level < this.max) this.level++
      else this.settled = true
    } else {
      // The extra worker did not help: go back to the best level and stay there.
      this.level = this.best.level
      this.settled = true
    }
  }
}
