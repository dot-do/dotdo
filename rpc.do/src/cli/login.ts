// CLI Login Commands - OAuth device flow integration for rpc.do CLI
// Provides login, logout, and whoami commands

import { DeviceFlow, DeviceFlowError, type DeviceFlowOptions } from '../auth/device-flow'
import { TokenStore, type ITokenStore, type StoredTokens } from '../auth/token-store'

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
 * Result of a CLI command
 */
export interface CommandResult {
  success: boolean
  error?: string
}

/**
 * Result of whoami command
 */
export interface WhoamiResult extends CommandResult {
  loggedIn?: boolean
  expiresAt?: number
}

/**
 * Options for login command
 */
export interface LoginOptions {
  /** Device flow client */
  deviceFlow: IDeviceFlow
  /** Token store for saving tokens */
  tokenStore: ITokenStore
  /** Force re-authentication even if already logged in */
  force?: boolean
  /** Output callback */
  onOutput?: (message: string) => void
}

/**
 * Options for logout command
 */
export interface LogoutOptions {
  /** Token store for deleting tokens */
  tokenStore: ITokenStore
  /** Output callback */
  onOutput?: (message: string) => void
}

/**
 * Options for whoami command
 */
export interface WhoamiOptions {
  /** Token store for reading tokens */
  tokenStore: ITokenStore
  /** Output callback */
  onOutput?: (message: string) => void
}

/**
 * Options for creating default login configuration
 */
export interface DefaultLoginOptionsConfig {
  /** OAuth client ID */
  clientId: string
  /** OAuth server base URL */
  oauthBaseUrl: string
  /** Custom tokens path (default: ~/.do/tokens.json) */
  tokensPath?: string
  /** OAuth scope */
  scope?: string
}

/**
 * Login command - initiates OAuth device flow
 *
 * @example
 * ```typescript
 * const result = await loginCommand({
 *   deviceFlow: new DeviceFlow({ ... }),
 *   tokenStore: new TokenStore(),
 *   onOutput: console.log,
 * })
 * ```
 */
export async function loginCommand(options: LoginOptions): Promise<CommandResult> {
  const { deviceFlow, tokenStore, force = false, onOutput = () => {} } = options

  try {
    // Check if already logged in
    if (!force) {
      const tokens = await tokenStore.getTokens()
      const isExpired = await tokenStore.isTokenExpired()

      if (tokens && !isExpired) {
        onOutput('Already logged in.')
        return { success: true }
      }
    }

    // Request device code
    onOutput('Initiating login...')
    const codeResponse = await deviceFlow.requestDeviceCode()

    // Display instructions to user
    onOutput('')
    onOutput('To authenticate, please visit:')
    onOutput(`  ${codeResponse.verification_uri}`)
    onOutput('')
    onOutput('And enter this code:')
    onOutput(`  ${codeResponse.user_code}`)
    onOutput('')
    onOutput('Waiting for authentication...')

    // Poll for token
    const tokenResponse = await deviceFlow.pollForToken(codeResponse.device_code)

    // Save tokens
    const expiresAt = Date.now() + tokenResponse.expires_in * 1000
    await tokenStore.saveTokens({
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token ?? '',
      expires_at: expiresAt,
    })

    onOutput('')
    onOutput('Successfully logged in!')
    return { success: true }
  } catch (error) {
    if (error instanceof DeviceFlowError) {
      if (error.code === 'expired_token') {
        onOutput('Login timed out. Please try again.')
        return { success: false, error: 'Device code expired. Please try again.' }
      }
      if (error.code === 'access_denied') {
        onOutput('Login was denied.')
        return { success: false, error: 'Access denied by user.' }
      }
      onOutput(`Login failed: ${error.message}`)
      return { success: false, error: error.message }
    }

    const errorMessage = error instanceof Error ? error.message : String(error)
    onOutput(`Login failed: ${errorMessage}`)
    return { success: false, error: errorMessage }
  }
}

/**
 * Logout command - clears stored tokens
 *
 * @example
 * ```typescript
 * const result = await logoutCommand({
 *   tokenStore: new TokenStore(),
 *   onOutput: console.log,
 * })
 * ```
 */
export async function logoutCommand(options: LogoutOptions): Promise<CommandResult> {
  const { tokenStore, onOutput = () => {} } = options

  try {
    const tokens = await tokenStore.getTokens()

    if (!tokens) {
      onOutput('Not logged in.')
      return { success: true }
    }

    await tokenStore.deleteTokens()
    onOutput('Successfully logged out.')
    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    onOutput(`Logout failed: ${errorMessage}`)
    return { success: false, error: errorMessage }
  }
}

/**
 * Whoami command - shows current authentication status
 *
 * @example
 * ```typescript
 * const result = await whoamiCommand({
 *   tokenStore: new TokenStore(),
 *   onOutput: console.log,
 * })
 * ```
 */
export async function whoamiCommand(options: WhoamiOptions): Promise<WhoamiResult> {
  const { tokenStore, onOutput = () => {} } = options

  try {
    const tokens = await tokenStore.getTokens()

    if (!tokens) {
      onOutput('Not logged in.')
      return { success: true, loggedIn: false }
    }

    const isExpired = await tokenStore.isTokenExpired()

    if (isExpired) {
      onOutput('Logged in (token expired, will refresh on next request).')
      return {
        success: true,
        loggedIn: false,
        expiresAt: tokens.expires_at,
      }
    }

    const expiresIn = Math.round((tokens.expires_at - Date.now()) / 1000 / 60)
    onOutput(`Logged in. Token expires in ${expiresIn} minutes.`)
    return {
      success: true,
      loggedIn: true,
      expiresAt: tokens.expires_at,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    onOutput(`Error checking auth status: ${errorMessage}`)
    return { success: false, error: errorMessage }
  }
}

/**
 * Create default login options with real DeviceFlow and TokenStore
 *
 * @example
 * ```typescript
 * const options = createDefaultLoginOptions({
 *   clientId: 'rpc-do-cli',
 *   oauthBaseUrl: 'https://oauth.do',
 * })
 * ```
 */
export function createDefaultLoginOptions(config: DefaultLoginOptionsConfig): {
  deviceFlow: DeviceFlow
  tokenStore: TokenStore
} {
  const deviceFlow = new DeviceFlow({
    clientId: config.clientId,
    oauthBaseUrl: config.oauthBaseUrl,
    scope: config.scope,
  })

  const tokenStore = new TokenStore(config.tokensPath)

  return { deviceFlow, tokenStore }
}
