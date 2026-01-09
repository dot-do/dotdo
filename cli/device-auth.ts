/**
 * CLI Device Authorization Module (Stub)
 *
 * This is a stub file to verify tests are syntactically correct.
 * Full implementation will be done in the GREEN phase.
 *
 * Uses oauth.do/node for OAuth 2.0 Device Authorization Grant (RFC 8628)
 *
 * @see https://oauth.do/node
 * @see https://datatracker.ietf.org/doc/html/rfc8628
 */

// ============================================================================
// Type Exports
// ============================================================================

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval: number
}

export interface TokenResponse {
  access_token: string
  token_type: string
  expires_in?: number
  refresh_token?: string
  scope?: string
}

export interface PollError extends Error {
  code: 'authorization_pending' | 'slow_down' | 'access_denied' | 'expired_token' | 'timeout'
}

export interface PollOptions {
  interval: number
  maxAttempts: number
  onProgress?: (status: { attempt: number; maxAttempts: number }) => void
}

export interface RequestDeviceCodeOptions {
  scope?: string
  clientId?: string
}

export interface StoredToken {
  access_token: string
  token_type: string
  refresh_token?: string
  expires_at?: number
  scope?: string
}

// ============================================================================
// Function Stubs - All throw "Not implemented" for RED phase
// ============================================================================

/**
 * Request a device code from the OAuth server
 * @throws {Error} Not implemented
 */
export async function requestDeviceCode(options?: RequestDeviceCodeOptions): Promise<DeviceCodeResponse> {
  throw new Error('Not implemented: requestDeviceCode')
}

/**
 * Poll the OAuth server for a token
 * @throws {Error} Not implemented
 */
export async function pollForToken(deviceCode: string, options: PollOptions): Promise<TokenResponse> {
  throw new Error('Not implemented: pollForToken')
}

/**
 * Store a token to the local config file
 * @throws {Error} Not implemented
 */
export async function storeToken(token: TokenResponse): Promise<void> {
  throw new Error('Not implemented: storeToken')
}

/**
 * Get the stored token from the local config file
 * @throws {Error} Not implemented
 */
export async function getStoredToken(): Promise<StoredToken | null> {
  throw new Error('Not implemented: getStoredToken')
}

/**
 * Clear the stored token
 * @throws {Error} Not implemented
 */
export async function clearToken(): Promise<boolean> {
  throw new Error('Not implemented: clearToken')
}

/**
 * Get the config file path
 * @throws {Error} Not implemented
 */
export function getConfigPath(): string {
  throw new Error('Not implemented: getConfigPath')
}
