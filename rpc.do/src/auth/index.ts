// Auth module - OAuth authentication for rpc.do
// Provides device flow, token storage, and authenticated transport

// Re-export all auth components
export * from './token-store'
export * from './device-flow'
export * from './auth-transport'
export * from './refresh'

import type { ITokenStore } from './token-store'

/**
 * Device flow interface for dependency injection
 */
export interface IDeviceFlow {
  requestDeviceCode(): Promise<{
    device_code: string
    user_code: string
    verification_uri: string
    expires_in: number
    interval?: number
  }>
  pollForToken(deviceCode: string): Promise<{
    access_token: string
    refresh_token?: string
    expires_in: number
  }>
}

/**
 * Display callback for showing device code to user
 */
export interface DisplayCodeParams {
  userCode: string
  verificationUri: string
}

/**
 * Options for ensureLoggedIn
 */
export interface EnsureLoggedInOptions {
  /** Token store for reading/writing tokens */
  tokenStore: ITokenStore
  /** Device flow client (required for interactive login) */
  deviceFlow?: IDeviceFlow
  /** Token refresh function */
  onRefreshToken?: (refreshToken: string) => Promise<{
    access_token: string
    refresh_token?: string
    expires_in: number
  }>
  /** Whether to prompt for interactive login if needed (default: true) */
  interactive?: boolean
  /** Callback to display device code to user */
  onDisplayCode?: (params: DisplayCodeParams) => void
}

/**
 * Ensure the user is logged in with valid tokens
 *
 * This function checks for valid tokens and handles:
 * 1. Valid token exists - returns true
 * 2. Token expired with refresh token - refreshes and returns true
 * 3. No token and interactive=true - initiates device flow
 * 4. No token and interactive=false - returns false
 *
 * @example
 * ```typescript
 * // In CLI before REPL
 * const loggedIn = await ensureLoggedIn({
 *   tokenStore: new TokenStore(),
 *   deviceFlow: new DeviceFlow({ clientId: 'cli', oauthBaseUrl: 'https://oauth.do' }),
 *   interactive: true,
 *   onDisplayCode: ({ userCode, verificationUri }) => {
 *     console.log(`Go to ${verificationUri} and enter: ${userCode}`)
 *   },
 * })
 *
 * if (!loggedIn) {
 *   console.error('Authentication required')
 *   process.exit(1)
 * }
 * ```
 *
 * @param options - Configuration options
 * @returns true if authenticated, false otherwise
 */
export async function ensureLoggedIn(options: EnsureLoggedInOptions): Promise<boolean> {
  const {
    tokenStore,
    deviceFlow,
    onRefreshToken,
    interactive = true,
    onDisplayCode,
  } = options

  // Check for existing valid token
  const tokens = await tokenStore.getTokens()
  const isExpired = await tokenStore.isTokenExpired()

  if (tokens && !isExpired) {
    // Valid token exists
    return true
  }

  // Token expired but we have refresh token
  if (tokens?.refresh_token && onRefreshToken) {
    try {
      const newTokens = await onRefreshToken(tokens.refresh_token)
      await tokenStore.saveTokens({
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token ?? tokens.refresh_token,
        expires_at: Date.now() + newTokens.expires_in * 1000,
      })
      return true
    } catch {
      // Refresh failed, fall through to device flow
    }
  }

  // No valid token, check if we can do interactive login
  if (!interactive) {
    return false
  }

  if (!deviceFlow) {
    return false
  }

  // Start device flow
  try {
    const codeResponse = await deviceFlow.requestDeviceCode()

    // Display code to user
    if (onDisplayCode) {
      onDisplayCode({
        userCode: codeResponse.user_code,
        verificationUri: codeResponse.verification_uri,
      })
    }

    // Poll for token
    const tokenResponse = await deviceFlow.pollForToken(codeResponse.device_code)

    // Save tokens
    await tokenStore.saveTokens({
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token ?? '',
      expires_at: Date.now() + tokenResponse.expires_in * 1000,
    })

    return true
  } catch {
    return false
  }
}

/**
 * Create an authenticated RPC client helper
 *
 * This is a convenience function that sets up the full auth stack
 * for CLI usage.
 *
 * @example
 * ```typescript
 * const { transport, tokenStore } = createAuthenticatedClient({
 *   url: 'https://api.do',
 *   clientId: 'my-cli',
 *   oauthBaseUrl: 'https://oauth.do',
 * })
 *
 * // Ensure logged in before using
 * await ensureLoggedIn({
 *   tokenStore,
 *   interactive: true,
 *   // ...
 * })
 *
 * // Create client with auth transport
 * const client = createClient({ transport })
 * ```
 */
export interface CreateAuthenticatedClientOptions {
  /** RPC endpoint URL */
  url: string
  /** OAuth client ID */
  clientId: string
  /** OAuth server base URL */
  oauthBaseUrl: string
  /** Custom tokens path (default: ~/.do/tokens.json) */
  tokensPath?: string
}
