import { describe, expect, it } from 'vitest'
import { ConcurrencyTuner, concurrencyCeiling } from '../src/core/classify/autotune'
import { pool } from '../src/core/classify/pipeline'

const GB = 1024 ** 3

/** Feeds the tuner a machine that finishes `perSecond(level)` emails per second. */
function drive(max: number, perSecond: (level: number) => number, emails = 400, start = 1) {
  let t = 0
  const tuner = new ConcurrencyTuner(max, start, () => t)
  for (let i = 0; i < emails; i++) {
    t += 1000 / perSecond(tuner.limit)
    tuner.completed()
  }
  return tuner
}

describe('concurrencyCeiling', () => {
  it('allows more when the model is fully on the GPU', () => {
    expect(concurrencyCeiling({ name: 'm', model: 'm', size: 3 * GB, sizeVram: 3 * GB })).toBe(8)
  })

  it('stays low when part of the model runs on the CPU', () => {
    expect(concurrencyCeiling({ name: 'm', model: 'm', size: 3.4 * GB, sizeVram: 2.3 * GB })).toBe(2)
    expect(concurrencyCeiling({ name: 'm', model: 'm', size: 3 * GB, sizeVram: 0 })).toBe(2)
  })

  it('uses the default when the model is not reported', () => {
    expect(concurrencyCeiling(undefined)).toBe(4)
  })
})

describe('ConcurrencyTuner', () => {
  it('stays at 1 when the server runs one request at a time', () => {
    expect(drive(8, () => 0.1).chosen).toBe(1)
  })

  it('climbs while throughput scales, and stops where it flattens', () => {
    // Scales up to 4 parallel requests (the server's limit), then flat.
    const tuner = drive(8, (level) => 1 * Math.min(level, 4))
    expect(tuner.chosen).toBe(4)
    expect(tuner.limit).toBe(4)
  })

  it('never goes above the ceiling', () => {
    expect(drive(2, (level) => level).limit).toBeLessThanOrEqual(2)
  })

  it('starts from the level a previous run settled on', () => {
    expect(new ConcurrencyTuner(8, 3).limit).toBe(3)
    expect(new ConcurrencyTuner(2, 6).limit).toBe(2)
  })
})

describe('pool', () => {
  it('honours a limit that changes while it runs', async () => {
    let limit = 1
    let running = 0
    let peak = 0
    const peaks: number[] = []
    await pool([...Array(12).keys()], () => limit, async (i) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 2))
      running--
      if (i === 3) {
        peaks.push(peak)
        limit = 3
        peak = 0
      }
    })
    expect(peaks[0]).toBe(1)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('rejects when a task throws', async () => {
    await expect(
      pool([1, 2, 3], () => 2, async (n) => {
        if (n === 2) throw new Error('boom')
      })
    ).rejects.toThrow('boom')
  })

  it('resolves immediately for no items', async () => {
    await expect(pool([], () => 4, async () => undefined)).resolves.toBeUndefined()
  })
})
