import type { TokenManager } from '../auth/oauth'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    url: string
  ) {
    super(`HTTP ${status} from ${new URL(url).pathname}: ${body.slice(0, 300)}`)
    this.name = 'HttpError'
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new Error('aborted'))
    })
  })

export interface Http {
  fetch(url: string, init?: RequestInit, signal?: AbortSignal): Promise<Response>
  json<T>(url: string, init?: RequestInit, signal?: AbortSignal): Promise<T>
}

/**
 * Authorized fetch: refreshes the token once on 401 and backs off on 429/5xx
 * (honoring Retry-After), up to 5 attempts.
 */
export function createHttp(tokens: TokenManager): Http {
  async function doFetch(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    let refreshed = false
    for (let attempt = 0; ; attempt++) {
      const token = await tokens.accessToken()
      const res = await fetch(url, {
        ...init,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
        headers: { authorization: `Bearer ${token}`, ...init.headers }
      })
      if (res.ok) return res
      if (res.status === 401 && !refreshed) {
        refreshed = true
        await tokens.refresh()
        continue
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        const retryAfter = Number(res.headers.get('retry-after'))
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt + Math.random() * 250
        await res.body?.cancel()
        await sleep(Math.min(wait, 30_000), signal)
        continue
      }
      throw new HttpError(res.status, await res.text().catch(() => ''), url)
    }
  }
  return {
    fetch: doFetch,
    async json<T>(url: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
      const res = await doFetch(url, init, signal)
      if (res.status === 204) return undefined as T
      return (await res.json()) as T
    }
  }
}

/** Runs fn over items with bounded concurrency, collecting results in order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    })
  )
  return out
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
