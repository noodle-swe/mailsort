import { OllamaError } from '../ollama'
import type { ClassifyCandidate, Store } from '../store'
import type { Tag } from '../tags'
import type { TaggingProgress, TaggingResult, TagSource } from '../types'
import { ConcurrencyTuner, DEFAULT_CEILING } from './autotune'
import type { LlmClassifier } from './llm'
import { applyRules, domainRuleAllowed, RULE_ACCEPT, type ClassifyInput, type Verdict } from './rules'

/** Bump when rules or prompts change in a way that should re-tag existing (non-user) tags. */
export const CLASSIFIER_VERSION = 1

export interface TaggingOptions {
  since?: number
  accountId?: string
  /** Recompute existing rule/LLM tags too (user tags are always kept). */
  retag?: boolean
  limit?: number
  ids?: string[]
  onProgress?: (p: TaggingProgress) => void
  signal?: AbortSignal
}

export function toClassifyInput(c: ClassifyCandidate): ClassifyInput {
  return {
    fromName: c.fromName,
    fromAddr: c.fromAddr,
    subject: c.subject,
    text: c.bodyText || c.snippet,
    linkDomains: c.linkDomains,
    hasCalendarInvite: c.hasCalendarInvite,
    listUnsubscribe: c.listUnsubscribe,
    providerLabels: c.providerLabels
  }
}

/** Runs fn over items with at most `limit()` in flight; the limit is re-read as work finishes, so it can change mid-run. */
export function pool<T>(items: T[], limit: () => number, fn: (item: T) => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    let next = 0
    let running = 0
    let failed = false
    const pump = () => {
      if (failed) return
      while (running < Math.max(1, limit()) && next < items.length) {
        running++
        fn(items[next++]).then(
          () => {
            running--
            pump()
          },
          (err) => {
            failed = true
            reject(err)
          }
        )
      }
      if (running === 0 && next >= items.length) resolve()
    }
    pump()
  })
}

export class Tagger {
  private queue: Promise<unknown> = Promise.resolve()
  private active = 0
  /** Parallelism the Auto mode settled on, so the next run starts there instead of at 1. */
  private tunedLevel = 1

  constructor(
    private readonly store: Store,
    private readonly getClassifier: () => LlmClassifier,
    private readonly onTagged: (ids: string[]) => void = () => {}
  ) {}

  get busy(): boolean {
    return this.active > 0
  }

  /** Runs are serialized so two "tag the emails" requests never classify the same message twice. */
  run(opts: TaggingOptions = {}): Promise<TaggingResult> {
    this.active++
    const result = this.queue.then(() => this.runNow(opts))
    this.queue = result.catch(() => undefined).finally(() => this.active--)
    return result
  }

  private async runNow(opts: TaggingOptions): Promise<TaggingResult> {
    const started = Date.now()
    const limit = Math.min(Math.max(opts.limit ?? 500, 1), 5000)
    const candidates = this.store.candidatesForTagging({
      version: CLASSIFIER_VERSION,
      since: opts.since,
      accountId: opts.accountId,
      retag: opts.retag,
      limit,
      ids: opts.ids
    })
    const result: TaggingResult = {
      total: candidates.length,
      tagged: 0,
      byTag: {},
      byRules: 0,
      byLlm: 0,
      failed: 0,
      ms: 0,
      results: []
    }
    let done = 0
    let pendingIds: string[] = []
    const progress = (stage: TaggingProgress['stage'], lastId?: string, lastTag?: Tag) =>
      opts.onProgress?.({ done, total: candidates.length, stage, lastId, lastTag })
    const flushTagged = () => {
      if (pendingIds.length) this.onTagged(pendingIds)
      pendingIds = []
    }
    const record = (c: ClassifyCandidate, v: Verdict, source: TagSource, model: string | null) => {
      this.store.setTag({
        messageId: c.id,
        tag: v.tag,
        source,
        confidence: v.confidence,
        reason: v.reason,
        model,
        version: CLASSIFIER_VERSION
      })
      result.tagged++
      result.byTag[v.tag] = (result.byTag[v.tag] ?? 0) + 1
      if (result.results.length < 20) result.results.push({ id: c.id, from: c.fromName || c.fromAddr, subject: c.subject, tag: v.tag, source })
      pendingIds.push(c.id)
    }

    // Stage 1: rules and learned sender preferences. Instant, no model call.
    const needsModel: ClassifyCandidate[] = []
    for (const c of candidates) {
      const learned = domainRuleAllowed(c.fromAddr) ? this.store.domainRule(c.fromAddr) : null
      const verdict: Verdict | null = learned
        ? { tag: learned, confidence: 0.9, reason: 'you tagged this sender this way before' }
        : applyRules(toClassifyInput(c))
      if (verdict && verdict.confidence >= RULE_ACCEPT) {
        record(c, verdict, 'rule', null)
        result.byRules++
        done++
        progress('rules', c.id, verdict.tag)
      } else {
        needsModel.push(c)
      }
    }
    flushTagged()

    // Stage 2: the model, for what rules could not settle.
    if (needsModel.length && !opts.signal?.aborted) {
      const classifier = this.getClassifier()
      const configured = this.store.getSettings().llmConcurrency
      // 0 = Auto: the first email runs alone (it loads the model), then the tuner takes over.
      let tuner: ConcurrencyTuner | null = null
      let fatal: Error | null = null
      let lastFlush = Date.now()
      const classifyOne = async (c: ClassifyCandidate) => {
        if (fatal || opts.signal?.aborted) return
        try {
          const examples = this.store.similarCorrections(c.fromAddr, 3)
          const verdict = await classifier.classify(toClassifyInput(c), examples, opts.signal)
          record(c, verdict, 'llm', classifier.model)
          result.byLlm++
          progress('llm', c.id, verdict.tag)
        } catch (err) {
          const kind = err instanceof OllamaError ? err.kind : null
          // Server down, model missing or cancelled: stop instead of failing every remaining email.
          if (kind === 'unreachable' || kind === 'model_missing' || kind === 'aborted') fatal ??= err as Error
          else result.failed++
          progress('llm')
        }
        done++
        tuner?.completed()
        if (Date.now() - lastFlush > 500) {
          flushTagged()
          lastFlush = Date.now()
        }
      }

      if (configured > 0) {
        await pool(needsModel, () => configured, classifyOne)
      } else {
        await classifyOne(needsModel[0])
        const ceiling = await classifier.concurrencyCeiling?.(opts.signal).catch(() => DEFAULT_CEILING)
        tuner = new ConcurrencyTuner(ceiling ?? DEFAULT_CEILING, this.tunedLevel)
        const active = tuner
        await pool(needsModel.slice(1), () => active.limit, classifyOne)
        this.tunedLevel = active.chosen
      }
      flushTagged()
      if (fatal) {
        result.error = (fatal as Error).message
        result.failed = needsModel.length - result.byLlm
      }
    }

    result.ms = Date.now() - started
    done = candidates.length
    progress('done')
    return result
  }
}
