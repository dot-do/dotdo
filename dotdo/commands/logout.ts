/**
 * dotdo logout - Clear credentials
 * Implements: do-7rf.9.6 - oauth.do integration for CLI auth
 *
 * Clears stored OAuth tokens from ~/.dotdo/credentials.json
 */

import { clearToken, getConfigPath } from './login'

export interface LogoutOptions {
  verbose?: boolean
}

/**
 * Logout command implementation
 */
export async function logout(options: LogoutOptions = {}): Promise<void> {
  try {
    const wasLoggedIn = await clearToken()

    if (wasLoggedIn) {
      console.log('Logged out successfully')
      if (options.verbose) {
        console.log(`Credentials cleared from: ${getConfigPath()}`)
      }
    } else {
      console.log('Not currently logged in')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Logout failed:', message)
    throw new Error(`Logout failed: ${message}`)
  }
}

// Export for CLI usage
export default logout
