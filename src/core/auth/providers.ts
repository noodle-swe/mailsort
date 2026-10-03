import type { Provider } from '../types'
import type { OAuthProviderConfig } from './oauth'

export interface OAuthClientIds {
  googleClientId?: string
  googleClientSecret?: string
  microsoftClientId?: string
}

/** Encrypts tokens at rest. In the app this is Electron safeStorage (Windows DPAPI). */
export interface SecretBox {
  encrypt(plain: string): Uint8Array
  decrypt(data: Uint8Array): string
}

export function oauthConfig(provider: Provider, ids: OAuthClientIds): OAuthProviderConfig {
  if (provider === 'gmail') {
    if (!ids.googleClientId || !ids.googleClientSecret) {
      throw new Error('Gmail is not set up: add MAIN_VITE_GOOGLE_CLIENT_ID and MAIN_VITE_GOOGLE_CLIENT_SECRET to .env (see docs/SETUP.md).')
    }
    return {
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      clientId: ids.googleClientId,
      clientSecret: ids.googleClientSecret,
      scopes: ['https://www.googleapis.com/auth/gmail.modify'],
      // select_account: always show Google's account picker, so a second (third, …) Gmail can be added
      // even when the browser is already signed in to another one. consent: always return a refresh token.
      extraAuthParams: { access_type: 'offline', prompt: 'select_account consent' },
      redirectHost: '127.0.0.1'
    }
  }
  if (!ids.microsoftClientId) {
    throw new Error('Outlook is not set up: add MAIN_VITE_MICROSOFT_CLIENT_ID to .env (see docs/SETUP.md).')
  }
  return {
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    clientId: ids.microsoftClientId,
    scopes: ['offline_access', 'https://graph.microsoft.com/Mail.ReadWrite', 'https://graph.microsoft.com/User.Read'],
    // Always show Microsoft's account picker, so several Outlook / Microsoft 365 accounts can be added.
    extraAuthParams: { prompt: 'select_account' },
    redirectHost: 'localhost',
    scopeOnTokenRequest: true
  }
}
