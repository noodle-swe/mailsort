import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TokenManager } from '../src/core/auth/oauth'
import { createHttp, HttpError } from '../src/core/providers/http'

const tokens = { accessToken: async () => 't', refresh: async () => undefined } as unknown as TokenManager
const quotaBody = JSON.stringify({ error: { code: 403, message: "Quota exceeded for quota metric 'Total Query Cost'" } })

describe('createHttp', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('retries a quota 403 and then succeeds', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(quotaBody, { status: 403 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const pending = createHttp(tokens).json<{ ok: boolean }>('https://gmail.googleapis.com/gmail/v1/users/me/labels')
    await vi.advanceTimersByTimeAsync(11_000)
    expect(await pending).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a permission 403', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":{"message":"Insufficient Permission"}}', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(createHttp(tokens).json('https://gmail.googleapis.com/x')).rejects.toBeInstanceOf(HttpError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
