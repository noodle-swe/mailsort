/** Minimal Ollama HTTP client (https://github.com/ollama/ollama/blob/main/docs/api.md) with AbortSignal support. */

export interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> }
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: OllamaToolCall[]
  tool_name?: string
}

export interface OllamaTool {
  type: 'function'
  function: { name: string; description?: string; parameters: Record<string, unknown> }
}

export interface ChatRequest {
  model: string
  messages: OllamaMessage[]
  tools?: OllamaTool[]
  format?: 'json' | Record<string, unknown>
  options?: Record<string, unknown>
  keep_alive?: string | number
  think?: boolean
}

export interface ChatChunk {
  message: OllamaMessage
  done: boolean
  total_duration?: number
  eval_count?: number
}

export type OllamaErrorKind = 'unreachable' | 'model_missing' | 'timeout' | 'aborted' | 'http'

export class OllamaError extends Error {
  constructor(
    message: string,
    readonly kind: OllamaErrorKind
  ) {
    super(message)
    this.name = 'OllamaError'
  }
}

export interface OllamaModel {
  name: string
  size: number
  parameterSize?: string
  quantization?: string
}

export interface OllamaRunningModel {
  name: string
  model: string
  size: number
  sizeVram: number
}

const DEFAULT_TIMEOUT_MS = 180_000
const PULL_TIMEOUT_MS = 12 * 3_600_000

export class OllamaClient {
  constructor(readonly baseUrl: string) {}

  private async request(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
    const timeout = AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    let res: Response
    try {
      res = await fetch(this.baseUrl + path, {
        ...init,
        signal,
        headers: { 'content-type': 'application/json', ...init.headers }
      })
    } catch (err) {
      if (init.signal?.aborted) throw new OllamaError('Request cancelled', 'aborted')
      if (timeout.aborted) throw new OllamaError(`Ollama at ${this.baseUrl} did not answer in time`, 'timeout')
      throw new OllamaError(
        `Can't reach Ollama at ${this.baseUrl} (${(err as Error).cause ?? (err as Error).message}). ` +
          'Check that Ollama is running, OLLAMA_HOST=0.0.0.0 is set on that PC, and port 11434 is open.',
        'unreachable'
      )
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let msg = text
      try {
        msg = JSON.parse(text).error ?? text
      } catch {
        /* plain text error */
      }
      if (res.status === 404 && /model.*not found/i.test(msg)) {
        const model = msg.match(/model "?([^"\s]+)"?/i)?.[1] ?? ''
        throw new OllamaError(`Model ${model} is not on the Ollama host. Run: ollama pull ${model}`, 'model_missing')
      }
      throw new OllamaError(`Ollama error ${res.status}: ${msg || res.statusText}`, 'http')
    }
    return res
  }

  async version(signal?: AbortSignal): Promise<string> {
    const res = await this.request('/api/version', { signal, timeoutMs: 5000 })
    return ((await res.json()) as { version: string }).version
  }

  async models(signal?: AbortSignal): Promise<OllamaModel[]> {
    const res = await this.request('/api/tags', { signal, timeoutMs: 5000 })
    const body = (await res.json()) as {
      models: { name: string; size: number; details?: { parameter_size?: string; quantization_level?: string } }[]
    }
    return body.models.map((m) => ({
      name: m.name,
      size: m.size,
      parameterSize: m.details?.parameter_size,
      quantization: m.details?.quantization_level
    }))
  }

  /** Models currently loaded, with how much of each sits in GPU memory (size_vram < size means part runs on the CPU). */
  async running(signal?: AbortSignal): Promise<OllamaRunningModel[]> {
    const res = await this.request('/api/ps', { signal, timeoutMs: 5000 })
    const body = (await res.json()) as { models?: { name: string; model?: string; size: number; size_vram?: number }[] }
    return (body.models ?? []).map((m) => ({ name: m.name, model: m.model ?? m.name, size: m.size, sizeVram: m.size_vram ?? 0 }))
  }

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatChunk> {
    const res = await this.request('/api/chat', { method: 'POST', body: JSON.stringify({ ...req, stream: false }), signal })
    return (await res.json()) as ChatChunk
  }

  /** Streams NDJSON chunks from /api/chat. */
  async *chatStream(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatChunk> {
    const res = await this.request('/api/chat', { method: 'POST', body: JSON.stringify({ ...req, stream: true }), signal })
    yield* ndjson<ChatChunk>(res, signal)
  }

  /** Downloads a model onto the Ollama host, streaming progress. Large models take a long time, hence the timeout. */
  async *pullStream(model: string, signal?: AbortSignal): AsyncGenerator<PullChunk> {
    const res = await this.request('/api/pull', { method: 'POST', body: JSON.stringify({ model, stream: true }), signal, timeoutMs: PULL_TIMEOUT_MS })
    yield* ndjson<PullChunk>(res, signal)
  }
}

/** Reads a newline-delimited JSON response; an {"error": ...} line becomes an OllamaError. */
async function* ndjson<T extends object>(res: Response, signal?: AbortSignal): AsyncGenerator<T> {
  if (!res.body) throw new OllamaError('Empty response from Ollama', 'http')
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(part, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        const chunk = JSON.parse(line) as T
        const error = (chunk as { error?: string }).error
        if (error) throw new OllamaError(error, 'http')
        yield chunk
      }
    }
  } catch (err) {
    if (signal?.aborted) throw new OllamaError('Request cancelled', 'aborted')
    throw err
  }
  if (buffer.trim()) yield JSON.parse(buffer) as T
}

export interface PullChunk {
  status: string
  digest?: string
  total?: number
  completed?: number
  error?: string
}

/** Progress of one model download, as shown in Settings. */
export interface PullProgress {
  model: string
  /** Plain-language step: Starting, Downloading, Verifying, Finishing, Done, Cancelled, Failed. */
  status: string
  completed?: number
  total?: number
  done?: boolean
  error?: string
}

/**
 * Ollama reports one progress line per layer ("pulling <digest>"). This sums the layers into one
 * completed/total pair and turns the raw status into a short label.
 */
export class PullTracker {
  private readonly layers = new Map<string, { total: number; completed: number }>()
  private status = 'Starting'

  update(chunk: PullChunk): Pick<PullProgress, 'status' | 'completed' | 'total'> {
    if (chunk.digest && chunk.total) this.layers.set(chunk.digest, { total: chunk.total, completed: chunk.completed ?? 0 })
    const raw = chunk.status.toLowerCase()
    if (raw === 'success') this.status = 'Done'
    else if (raw.startsWith('verifying')) this.status = 'Verifying'
    else if (raw.startsWith('writing') || raw.startsWith('removing')) this.status = 'Finishing'
    else if (chunk.digest && chunk.total) this.status = 'Downloading'
    else if (raw.includes('manifest')) this.status = 'Starting'
    let total = 0
    let completed = 0
    for (const l of this.layers.values()) {
      total += l.total
      completed += Math.min(l.completed, l.total)
    }
    return { status: this.status, completed: total ? completed : undefined, total: total || undefined }
  }
}

/** Model names like "qwen3:4b" or "library/llama3.2:3b": letters, digits and . _ - / : only. */
export function isValidModelName(name: string): boolean {
  return name.length <= 100 && /^[\w.-]+(\/[\w.-]+)*(:[\w.-]+)?$/.test(name) && !name.split(/[/:]/).some((part) => /^\.+$/.test(part))
}

/** True when the server address points at this PC, so Ollama could be installed or started here. */
export function isLocalUrl(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(url).hostname)
  } catch {
    return false
  }
}

export interface OllamaHealth {
  /** Reachable and every configured model is pulled. */
  ok: boolean
  url: string
  /** The server answered. */
  reachable: boolean
  /** The address points at this PC. */
  local: boolean
  /** Whether Ollama is installed here: null when the server is on another PC and cannot be checked. */
  installed: boolean | null
  /** Where the local Ollama program was found. */
  binary?: string
  version?: string
  models?: OllamaModel[]
  missing?: string[]
  error?: string
}

/** Checks the server and that the configured models are pulled. */
export async function checkOllama(url: string, requiredModels: string[]): Promise<OllamaHealth> {
  const client = new OllamaClient(url)
  const local = isLocalUrl(url)
  try {
    const [version, models] = await Promise.all([client.version(), client.models()])
    const names = new Set(models.flatMap((m) => [m.name, m.name.replace(/:latest$/, '')]))
    const missing = [...new Set(requiredModels.filter(Boolean))].filter((m) => !names.has(m) && !names.has(`${m}:latest`))
    return { ok: missing.length === 0, url, reachable: true, local, installed: local ? true : null, version, models, missing }
  } catch (err) {
    return { ok: false, url, reachable: false, local, installed: null, error: (err as Error).message }
  }
}
