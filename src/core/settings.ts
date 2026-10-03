export interface Settings {
  /** Ollama base URL, e.g. http://192.168.1.50:11434 for a GPU PC on the LAN. */
  ollamaUrl: string
  /** Model used by the chat agent (needs tool calling). */
  chatModel: string
  /** Model used to classify emails. Empty = same as chatModel (avoids swapping models in VRAM). */
  classifierModel: string
  /** Classify new mail automatically after each sync. */
  autoTag: boolean
  /** Write tags back as Gmail labels / Outlook categories. */
  writeBack: boolean
  /** How far back the first sync of an account goes. */
  syncDays: number
  syncIntervalSec: number
  /** Parallel Ollama requests. 0 = Auto: measure the speed and pick (see classify/autotune.ts). */
  llmConcurrency: number
  /** Cap for cached full HTML bodies. */
  bodyCacheMB: number
  /** Cleaned body text older than this is dropped (metadata and tags are kept). 0 = keep forever. */
  retentionDays: number
  /** Serve the MCP server over Streamable HTTP on 127.0.0.1 for other MCP clients. */
  mcpHttpEnabled: boolean
  mcpHttpPort: number
}

export const DEFAULT_SETTINGS: Settings = {
  ollamaUrl: 'http://127.0.0.1:11434',
  chatModel: 'qwen2.5:7b',
  classifierModel: '',
  autoTag: true,
  writeBack: true,
  syncDays: 90,
  syncIntervalSec: 60,
  llmConcurrency: 0,
  bodyCacheMB: 200,
  retentionDays: 365,
  mcpHttpEnabled: false,
  mcpHttpPort: 3917
}

export function classifierModelOf(s: Settings): string {
  return s.classifierModel.trim() || s.chatModel
}

/** Keeps only known keys with the right primitive type and clamps numbers to sane ranges. */
export function sanitizeSettings(patch: Record<string, unknown>): Partial<Settings> {
  const out: Partial<Settings> = {}
  const num = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : undefined
  for (const [key, value] of Object.entries(patch)) {
    switch (key as keyof Settings) {
      case 'ollamaUrl':
        if (typeof value === 'string' && /^https?:\/\/\S+$/i.test(value.trim())) out.ollamaUrl = value.trim().replace(/\/+$/, '')
        break
      case 'chatModel':
      case 'classifierModel':
        if (typeof value === 'string') out[key as 'chatModel'] = value.trim()
        break
      case 'autoTag':
      case 'writeBack':
      case 'mcpHttpEnabled':
        if (typeof value === 'boolean') out[key as 'autoTag'] = value
        break
      case 'syncDays':
        out.syncDays = num(value, 1, 3650)
        break
      case 'syncIntervalSec':
        out.syncIntervalSec = num(value, 15, 3600)
        break
      case 'llmConcurrency':
        out.llmConcurrency = num(value, 0, 16)
        break
      case 'bodyCacheMB':
        out.bodyCacheMB = num(value, 10, 10_000)
        break
      case 'retentionDays':
        out.retentionDays = num(value, 0, 36_500)
        break
      case 'mcpHttpPort':
        out.mcpHttpPort = num(value, 1024, 65_535)
        break
    }
  }
  for (const k of Object.keys(out) as (keyof Settings)[]) if (out[k] === undefined) delete out[k]
  return out
}
