import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface OAuthProviderConfig {
  authUrl: string
  tokenUrl: string
  clientId: string
  /** Google "Desktop app" clients need it even with PKCE (it is not treated as confidential). */
  clientSecret?: string
  scopes: string[]
  extraAuthParams?: Record<string, string>
  /** Microsoft wants http://localhost; Google accepts the 127.0.0.1 loopback address. */
  redirectHost: '127.0.0.1' | 'localhost'
  /** Send scope on token requests (required by Microsoft identity platform v2). */
  scopeOnTokenRequest?: boolean
}

export interface TokenSet {
  accessToken: string
  refreshToken: string
  /** Epoch ms. */
  expiresAt: number
}

export class AuthError extends Error {
  constructor(
    message: string,
    /** True when the user must sign in again (revoked or expired refresh token). */
    readonly needsReauth = false
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

const base64url = (buf: Buffer) => buf.toString('base64url')

const DONE_PAGE = (ok: boolean, msg: string) => `<!doctype html><meta charset="utf-8"><title>MailSort</title>
<body style="font:16px system-ui;display:grid;place-items:center;height:90vh;color:${ok ? '#15803d' : '#b91c1c'}">
<div><h2>${ok ? 'Signed in' : 'Sign-in failed'}</h2><p>${msg}</p></div></body>`

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/**
 * Authorization-code + PKCE flow through the system browser with a one-shot loopback server
 * (RFC 8252). Resolves with tokens, rejects on error, cancel or a 5 minute timeout.
 */
export async function runLoopbackFlow(
  cfg: OAuthProviderConfig,
  openUrl: (url: string) => void | Promise<void>,
  signal?: AbortSignal
): Promise<TokenSet> {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const state = base64url(randomBytes(16))

  const servers: Server[] = []
  let resolveCode!: (code: string) => void
  let rejectCode!: (err: Error) => void
  const codePromise = new Promise<string>((res, rej) => {
    resolveCode = res
    rejectCode = rej
  })

  const handler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/') {
      res.writeHead(404).end()
      return
    }
    const error = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    if (error) {
      const desc = url.searchParams.get('error_description') ?? error
      res.end(DONE_PAGE(false, escapeHtml(desc)))
      rejectCode(new AuthError(`Sign-in failed: ${desc}`))
    } else if (!code || url.searchParams.get('state') !== state) {
      res.end(DONE_PAGE(false, 'Invalid response. Please try again from MailSort.'))
      rejectCode(new AuthError('Sign-in failed: invalid state'))
    } else {
      res.end(DONE_PAGE(true, 'You can close this tab and return to MailSort.'))
      resolveCode(code)
    }
  }

  const listen = (server: Server, port: number, host: string) =>
    new Promise<number>((res, rej) => {
      server.once('error', rej)
      server.listen(port, host, () => res((server.address() as AddressInfo).port))
    })

  const primary = createServer(handler)
  servers.push(primary)
  const port = await listen(primary, 0, '127.0.0.1')
  if (cfg.redirectHost === 'localhost') {
    // Browsers may resolve "localhost" to ::1 first; listen there too when possible.
    const v6 = createServer(handler)
    try {
      await listen(v6, port, '::1')
      servers.push(v6)
    } catch {
      v6.close()
    }
  }
  const redirectUri = `http://${cfg.redirectHost}:${port}`

  const timer = setTimeout(() => rejectCode(new AuthError('Sign-in timed out')), 5 * 60_000)
  const onAbort = () => rejectCode(new AuthError('Sign-in cancelled'))
  signal?.addEventListener('abort', onAbort)

  try {
    const auth = new URL(cfg.authUrl)
    auth.search = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: cfg.scopes.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      ...cfg.extraAuthParams
    }).toString()
    await openUrl(auth.toString())
    const code = await codePromise
    return await tokenRequest(cfg, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier
    })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    for (const s of servers) s.close()
  }
}

export async function refreshTokens(cfg: OAuthProviderConfig, refreshToken: string): Promise<TokenSet> {
  const tokens = await tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken })
  // Google keeps the same refresh token; Microsoft rotates it.
  return { ...tokens, refreshToken: tokens.refreshToken || refreshToken }
}

async function tokenRequest(cfg: OAuthProviderConfig, params: Record<string, string>): Promise<TokenSet> {
  const body = new URLSearchParams({ client_id: cfg.clientId, ...params })
  if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret)
  if (cfg.scopeOnTokenRequest) body.set('scope', cfg.scopes.join(' '))
  let res: Response
  try {
    res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(30_000)
    })
  } catch (err) {
    throw new AuthError(`Could not reach the sign-in server: ${(err as Error).message}`)
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok || typeof json.access_token !== 'string') {
    const code = String(json.error ?? res.status)
    const desc = String(json.error_description ?? '')
    throw new AuthError(`Token request failed: ${code} ${desc}`.trim(), code === 'invalid_grant' || code === 'interaction_required')
  }
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : '',
    expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000
  }
}

/** Hands out fresh access tokens for one account and persists rotated refresh tokens. */
export class TokenManager {
  private refreshing: Promise<TokenSet> | null = null

  constructor(
    private readonly cfg: OAuthProviderConfig,
    private tokens: TokenSet,
    private readonly persist: (tokens: TokenSet) => void
  ) {}

  async accessToken(): Promise<string> {
    if (this.tokens.expiresAt - Date.now() > 60_000) return this.tokens.accessToken
    return (await this.refresh()).accessToken
  }

  /** Forces a refresh (e.g. after a 401). Concurrent callers share one request. */
  refresh(): Promise<TokenSet> {
    this.refreshing ??= refreshTokens(this.cfg, this.tokens.refreshToken)
      .then((t) => {
        this.tokens = t
        this.persist(t)
        return t
      })
      .finally(() => {
        this.refreshing = null
      })
    return this.refreshing
  }
}
