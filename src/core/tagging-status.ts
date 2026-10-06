// What the "Tag new emails" button and the line under it say. No page access, so it can be tested.
import type { TaggingFinished, TaggingProgress } from './types'

export interface TaggingStatus {
  /** A run is going or about to start, so the button is disabled. */
  busy: boolean
  /** Text on the button. */
  label: string
  /** Share done for the bar; null when the wait has no measure yet (starting, waiting for the model). */
  fraction: number | null
  /** The line under the button. Errors use the danger color. */
  line: { text: string; tone: 'info' | 'error' } | null
}

const count = (n: number) => `${n} ${n === 1 ? 'email' : 'emails'}`

/** What a finished run says, in plain words. */
export function describeFinished(f: TaggingFinished): { text: string; tone: 'info' | 'error' } {
  if (f.total === 0) return { text: 'Nothing to tag. Every email already has a tag.', tone: 'info' }
  if (f.error) return { text: `Tagged ${f.tagged} of ${f.total}. ${f.error}`, tone: 'error' }
  if (f.failed > 0) return { text: `Tagged ${f.tagged} of ${f.total}. ${count(f.failed)} could not be tagged.`, tone: 'error' }
  const took = f.ms >= 1000 ? ` in ${(f.ms / 1000).toFixed(1)}s` : ''
  return { text: f.auto ? `Tagged ${count(f.tagged)} that just arrived${took}.` : `Tagged ${count(f.tagged)}${took}.`, tone: 'info' }
}

export function taggingStatus(s: { progress: TaggingProgress | null; starting: boolean; finished: TaggingFinished | null }): TaggingStatus {
  const { progress, starting, finished } = s
  if (progress) {
    const waiting = progress.stage === 'model'
    return {
      busy: true,
      label: `Tagging ${progress.done} of ${progress.total}`,
      fraction: waiting ? null : progress.done / Math.max(1, progress.total),
      line: waiting ? { text: 'Waiting for Ollama. The first email can take a minute while it loads the model.', tone: 'info' } : null
    }
  }
  if (starting) return { busy: true, label: 'Starting', fraction: null, line: { text: 'Looking for emails to tag.', tone: 'info' } }
  return { busy: false, label: 'Tag new emails', fraction: 0, line: finished ? describeFinished(finished) : null }
}
