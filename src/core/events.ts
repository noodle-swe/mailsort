import type { TaggingProgress } from './types'

export type CoreEvent =
  | { type: 'messages-changed'; accountId: string }
  | { type: 'tags-changed'; ids: string[] }
  | { type: 'sync-status'; accountId: string; syncing: boolean; error: string | null }
  | { type: 'tagging-progress'; progress: TaggingProgress }
  | { type: 'accounts-changed' }
  | { type: 'writeback'; ok: number; failed: number; error?: string }

export type CoreListener = (event: CoreEvent) => void

export class Emitter {
  private listeners = new Set<CoreListener>()

  on(listener: CoreListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: CoreEvent): void {
    for (const l of this.listeners) {
      try {
        l(event)
      } catch (err) {
        console.error('event listener failed', err)
      }
    }
  }
}
