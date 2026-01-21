/**
 * dotdo login - OAuth CLI Authentication
 * Implements: do-7rf.9.6 - oauth.do integration for CLI auth
 *
 * Features:
 * - OAuth Device Authorization Grant (RFC 8628)
 * - Browser-based authentication flow
 * - Secure token storage in ~/.dotdo/credentials.json
 * - Token refresh support
 * - CI/CD token flag support
 */

import { readFile, writeFile, unlink, mkdir, access } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// ============================================================================
// Constants
// ============================================================================

const OAUTH_BASE_URL = 'https://oauth.do'
const DEFAULT_CLIENT_ID = 'dotdo-cli'
const CONFIG_DIR_NAME = '.dotdo'
const CREDENTIALS_FILE_NAME = 'credentials.json'

// ============================================================================
// Types
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

export interface StoredToken {
  access_token: string
  token_type: string
  refresh_token?: string
  expires_at?: number
  scope?: string
  created_at: number
}

export interface LoginOptions {
  token?: string
  verbose?: boolean
  noBrowser?: boolean
  /** Output as JSON for scripting */
  json?: boolean
}

/**
 * Result returned by login command for JSON output
 */
export interface LoginResult {
  success: boolean
  message?: string
  error?: string
  isNewLogin?: boolean
  tokenPath?: string
}

// ============================================================================
// Config Path Helpers
// ============================================================================

/**
 * Custom config directory for testing (set via setConfigDir or DOTDO_CONFIG_DIR env var)
 */
let customConfigDir: string | undefined

/**
 * Set a custom config directory (for testing)
 */
export function setConfigDir(dir: string | undefined): void {
  customConfigDir = dir
}

/**
 * Get the config directory path.
 * Uses custom dir if set, DOTDO_CONFIG_DIR env var, or defaults to ~/.dotdo
 */
function getConfigDir(): string {
  if (customConfigDir) {
    return customConfigDir
  }
  if (process.env['DOTDO_CONFIG_DIR']) {
    return process.env['DOTDO_CONFIG_DIR']
  }
  return join(homedir(), CONFIG_DIR_NAME)
}

/**
 * Get the credentials file path
 */
export function getConfigPath(): string {
  return join(getConfigDir(), CREDENTIALS_FILE_NAME)
}

// ============================================================================
// Browser Helpers
// ============================================================================

/**
 * Open a URL in the default browser
 */
async function openBrowser(url: string): Promise<void> {
  const platform = process.platform
  let command: string

  if (platform === 'darwin') {
    command = `open "${url}"`
  } else if (platform === 'win32') {
    command = `start "" "${url}"`
  } else {
    // Linux and other Unix-like systems
    command = `xdg-open "${url}"`
  }

  try {
    await execAsync(command)
  } catch (error) {
    console.error('Failed to open browser automatically')
    console.log(`Please open this URL manually: ${url}`)
  }
}

// ============================================================================
// OAuth Flow
// ============================================================================

/**
 * Request a device code from the OAuth server
 */
async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const body = new URLSearchParams({
    client_id: DEFAULT_CLIENT_ID,
    scope: 'openid profile email',
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

/**
 * Poll the OAuth server for a token
 */
async function pollForToken(
  deviceCode: string,
  interval: number,
  maxAttempts: number = 60
): Promise<TokenResponse> {
  let attempt = 0
  let pollInterval = interval

  while (attempt < maxAttempts) {
    attempt++

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

    const errorData = await response.json().catch(() => ({ error: 'unknown_error' })) as { error?: string }
    const errorCode = errorData.error

    if (errorCode === 'authorization_pending') {
      // Wait and continue polling
      await new Promise((resolve) => setTimeout(resolve, pollInterval * 1000))
      continue
    }

    if (errorCode === 'slow_down') {
      // Increase interval by 5 seconds and continue polling
      pollInterval += 5
      await new Promise((resolve) => setTimeout(resolve, pollInterval * 1000))
      continue
    }

    if (errorCode === 'access_denied') {
      throw new Error('Access denied: User denied authorization')
    }

    if (errorCode === 'expired_token') {
      throw new Error('Device code expired. Please try again.')
    }

    // Unknown error
    throw new Error(`Token request failed: ${errorCode}`)
  }

  throw new Error('Authorization timeout: User did not complete authentication in time')
}

// ============================================================================
// Token Storage
// ============================================================================

/**
 * Store a token to the local config file
 */
async function storeToken(token: TokenResponse): Promise<void> {
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
    created_at: Date.now(),
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

    return data as StoredToken
  } catch (error: unknown) {
    // File doesn't exist or parse error
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

/**
 * Check if a token is expired
 */
function isTokenExpired(token: StoredToken): boolean {
  if (!token.expires_at) {
    return false
  }
  return token.expires_at < Date.now()
}

// ============================================================================
// Refresh Token
// ============================================================================

/**
 * Refresh an expired token using refresh_token
 */
async function refreshToken(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: DEFAULT_CLIENT_ID,
  })

  const response = await fetch(`${OAUTH_BASE_URL}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  if (!response.ok) {
    throw new Error('Failed to refresh token')
  }

  return response.json()
}

// ============================================================================
// Main Login Function
// ============================================================================

/**
 * Login command implementation
 */
export async function login(options: LoginOptions = {}): Promise<LoginResult> {
  const jsonMode = options.json ?? false

  // Check if user provided a token directly (for CI/CD)
  if (options.token) {
    if (options.verbose && !jsonMode) {
      console.log('[dotdo login] Storing provided token')
    }

    const token: TokenResponse = {
      access_token: options.token,
      token_type: 'Bearer',
    }

    await storeToken(token)

    const result: LoginResult = {
      success: true,
      message: 'Token stored successfully',
      isNewLogin: true,
      tokenPath: getConfigPath(),
    }

    if (jsonMode) {
      console.log(JSON.stringify(result))
    } else {
      console.log('Token stored successfully')
    }

    return result
  }

  // Check if already logged in
  const existingToken = await getStoredToken()
  if (existingToken) {
    // Check if token is expired
    if (isTokenExpired(existingToken)) {
      if (existingToken.refresh_token) {
        if (!jsonMode) {
          console.log('Token expired, refreshing...')
        }
        try {
          const newToken = await refreshToken(existingToken.refresh_token)
          await storeToken(newToken)

          const result: LoginResult = {
            success: true,
            message: 'Token refreshed successfully',
            isNewLogin: false,
            tokenPath: getConfigPath(),
          }

          if (jsonMode) {
            console.log(JSON.stringify(result))
          } else {
            console.log('Token refreshed successfully')
          }

          return result
        } catch (error) {
          if (!jsonMode) {
            console.log('Failed to refresh token, starting new login...')
          }
        }
      } else {
        if (!jsonMode) {
          console.log('Token expired, please login again...')
        }
      }
    } else {
      const result: LoginResult = {
        success: true,
        message: 'Already logged in',
        isNewLogin: false,
        tokenPath: getConfigPath(),
      }

      if (jsonMode) {
        console.log(JSON.stringify(result))
      } else {
        console.log('Already logged in')
        if (options.verbose) {
          console.log(`Token expires at: ${new Date(existingToken.expires_at || 0).toISOString()}`)
        }
      }

      return result
    }
  }

  // Start OAuth Device Authorization Flow
  if (!jsonMode) {
    console.log('Starting OAuth login flow...')
  }

  try {
    // Step 1: Request device code
    const deviceCodeData = await requestDeviceCode()

    // Step 2: Display user code and open browser
    if (!jsonMode) {
      console.log('\nTo authenticate, please follow these steps:')
      console.log(`1. Visit: ${deviceCodeData.verification_uri}`)
      console.log(`2. Enter code: ${deviceCodeData.user_code}`)
      console.log('')
    }

    // Open browser automatically unless disabled
    if (!options.noBrowser) {
      const url = deviceCodeData.verification_uri_complete || deviceCodeData.verification_uri
      if (!jsonMode) {
        console.log('Opening browser...')
      }
      await openBrowser(url)
    }

    if (!jsonMode) {
      console.log('Waiting for authorization...')
    }

    // Step 3: Poll for token
    const token = await pollForToken(
      deviceCodeData.device_code,
      deviceCodeData.interval,
      Math.floor(deviceCodeData.expires_in / deviceCodeData.interval)
    )

    // Step 4: Store token
    await storeToken(token)

    const result: LoginResult = {
      success: true,
      message: 'Login successful',
      isNewLogin: true,
      tokenPath: getConfigPath(),
    }

    if (jsonMode) {
      console.log(JSON.stringify(result))
    } else {
      console.log('\nLogin successful!')
      if (options.verbose) {
        console.log(`Token stored at: ${getConfigPath()}`)
      }
    }

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    const result: LoginResult = {
      success: false,
      error: `Login failed: ${message}`,
    }

    if (jsonMode) {
      console.log(JSON.stringify(result))
    } else {
      console.error('\nLogin failed:', message)
    }

    throw new Error(`Login failed: ${message}`)
  }
}

// Export for CLI usage
export default login
