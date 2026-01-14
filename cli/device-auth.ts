/**
 * CLI Device Authorization Module
 *
 * Uses oauth.do/node for OAuth 2.0 Device Authorization Grant (RFC 8628)
 *
 * @see https://oauth.do/node
 * @see https://datatracker.ietf.org/doc/html/rfc8628
 */

import { readFile, writeFile, unlink, mkdir, access } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

// ============================================================================
// Constants
// ============================================================================

const OAUTH_BASE_URL = 'https://oauth.do'
const DEFAULT_CLIENT_ID = 'org.ai-cli'
const CONFIG_DIR_NAME = '.org.ai'
const CREDENTIALS_FILE_NAME = 'credentials.json'

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
// Helper Functions
// ============================================================================

function createPollError(code: PollError['code'], message: string): PollError {
  const error = new Error(message) as PollError
  error.code = code
  return error
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// Config Path
// ============================================================================

/**
 * Get the config file path
 */
export function getConfigPath(): string {
  return join(homedir(), CONFIG_DIR_NAME, CREDENTIALS_FILE_NAME)
}

/**
 * Get the config directory path
 */
function getConfigDir(): string {
  return join(homedir(), CONFIG_DIR_NAME)
}

// ============================================================================
// Device Code Request
// ============================================================================

/**
 * Request a device code from the OAuth server
 */
export async function requestDeviceCode(options?: RequestDeviceCodeOptions): Promise<DeviceCodeResponse> {
  const clientId = options?.clientId ?? DEFAULT_CLIENT_ID
  const scope = options?.scope ?? 'openid profile email'

  const body = new URLSearchParams({
    client_id: clientId,
    scope: scope,
  })

  const response = await fetch(`${OAUTH_BASE_URL}/device/code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as { error?: string; error_description?: string }
    const errorCode = errorData.error || 'unknown_error'
    const errorDescription = errorData.error_description || `Request failed with status ${response.status}`
    throw new Error(`${errorCode}: ${errorDescription}`)
  }

  return response.json()
}

// ============================================================================
// Token Polling
// ============================================================================

/**
 * Poll the OAuth server for a token
 */
export async function pollForToken(deviceCode: string, options: PollOptions): Promise<TokenResponse> {
  const { maxAttempts, onProgress } = options
  let interval = options.interval
  let attempt = 0

  while (attempt < maxAttempts) {
    attempt++

    // Call onProgress before attempting (for first attempt)
    if (onProgress && attempt > 1) {
      onProgress({ attempt: attempt - 1, maxAttempts })
    }

    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: DEFAULT_CLIENT_ID,
    })

    const response = await fetch(`${OAUTH_BASE_URL}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })

    if (response.ok) {
      return response.json()
    }

    const errorData = await response.json().catch(() => ({ error: 'unknown_error' })) as { error?: string; error_description?: string }
    const errorCode = errorData.error

    if (errorCode === 'authorization_pending') {
      // Wait and continue polling
      await sleep(interval * 1000)
      continue
    }

    if (errorCode === 'slow_down') {
      // Increase interval by 5 seconds and continue polling
      interval += 5
      await sleep(interval * 1000)
      continue
    }

    if (errorCode === 'access_denied') {
      throw createPollError('access_denied', 'access_denied: User denied access')
    }

    if (errorCode === 'expired_token') {
      throw createPollError('expired_token', 'expired_token: Device code expired')
    }

    // Unknown error
    throw new Error(errorData.error_description || errorCode || 'Token request failed')
  }

  // Max attempts reached
  throw createPollError('timeout', 'timeout: Polling timed out waiting for authorization')
}

// ============================================================================
// Token Storage
// ============================================================================

/**
 * Store a token to the local config file
 */
export async function storeToken(token: TokenResponse): Promise<void> {
  const configDir = getConfigDir()
  const configPath = getConfigPath()

  // Check if directory exists, create if not
  try {
    await access(configDir)
  } catch {
    await mkdir(configDir, { recursive: true, mode: 0o700 })
  }

  // Build stored token data
  const storedToken: StoredToken = {
    access_token: token.access_token,
    token_type: token.token_type,
  }

  if (token.refresh_token) {
    storedToken.refresh_token = token.refresh_token
  }

  if (token.expires_in) {
    storedToken.expires_at = Date.now() + token.expires_in * 1000
  }

  if (token.scope) {
    storedToken.scope = token.scope
  }

  // Write token file with secure permissions
  await writeFile(configPath, JSON.stringify(storedToken, null, 2), { mode: 0o600 })
}

/**
 * Get the stored token from the local config file
 */
export async function getStoredToken(): Promise<StoredToken | null> {
  const configPath = getConfigPath()

  try {
    const content = await readFile(configPath, 'utf-8')
    const data = JSON.parse(content)

    // Validate token structure
    if (!data.access_token || !data.token_type) {
      return null
    }

    // Check expiration (only if no refresh token available)
    if (data.expires_at && data.expires_at < Date.now() && !data.refresh_token) {
      return null
    }

    return data as StoredToken
  } catch (error: unknown) {
    // File doesn't exist or other error
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    // JSON parse error or other issues
    return null
  }
}

/**
 * Clear the stored token
 */
export async function clearToken(): Promise<boolean> {
  const configPath = getConfigPath()

  try {
    await unlink(configPath)
    return true
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}
