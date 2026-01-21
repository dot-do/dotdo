/**
 * dotdo logout - Clear credentials
 * Implements: do-7rf.9.6 - oauth.do integration for CLI auth
 *
 * Clears stored OAuth tokens from ~/.dotdo/credentials.json
 */

import { clearToken, getConfigPath } from './login'

export interface LogoutOptions {
  verbose?: boolean
  /** Output as JSON for scripting */
  json?: boolean
}

/**
 * Result returned by logout command for JSON output
 */
export interface LogoutResult {
  success: boolean
  wasLoggedIn: boolean
  message?: string
  error?: string
}

/**
 * Logout command implementation
 */
export async function logout(options: LogoutOptions = {}): Promise<LogoutResult> {
  const jsonMode = options.json ?? false

  try {
    const wasLoggedIn = await clearToken()

    const result: LogoutResult = {
      success: true,
      wasLoggedIn,
      message: wasLoggedIn ? 'Logged out successfully' : 'Not currently logged in',
    }

    if (jsonMode) {
      console.log(JSON.stringify(result))
    } else {
      if (wasLoggedIn) {
        console.log('Logged out successfully')
        if (options.verbose) {
          console.log(`Credentials cleared from: ${getConfigPath()}`)
        }
      } else {
        console.log('Not currently logged in')
      }
    }

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    const result: LogoutResult = {
      success: false,
      wasLoggedIn: false,
      error: `Logout failed: ${message}`,
    }

    if (jsonMode) {
      console.log(JSON.stringify(result))
    } else {
      console.error('Logout failed:', message)
    }

    throw new Error(`Logout failed: ${message}`)
  }
}

// Export for CLI usage
export default logout
