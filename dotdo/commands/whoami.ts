/**
 * dotdo whoami - Show current user
 * Implements: do-7rf.9.6 - oauth.do integration for CLI auth
 *
 * Displays information about the currently logged-in user
 */

import { getStoredToken } from './login'

export interface WhoamiOptions {
  verbose?: boolean
  json?: boolean
}

export interface UserInfo {
  id: string
  email?: string
  name?: string
  picture?: string
}

/**
 * Fetch user information from the OAuth server
 */
async function getUserInfo(accessToken: string): Promise<UserInfo | null> {
  try {
    const response = await fetch('https://oauth.do/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    return data as UserInfo
  } catch (error) {
    return null
  }
}

/**
 * Whoami command implementation
 */
export async function whoami(options: WhoamiOptions = {}): Promise<void> {
  try {
    // Check if logged in
    const token = await getStoredToken()

    if (!token) {
      if (options.json) {
        console.log(JSON.stringify({ error: 'not_logged_in', message: 'Not logged in' }))
      } else {
        console.log('Not logged in')
        console.log('Run: dotdo login')
      }
      return
    }

    // Check if token is expired (only if no refresh_token available)
    if (token.expires_at && token.expires_at < Date.now() && !token.refresh_token) {
      if (options.json) {
        console.log(JSON.stringify({ error: 'session_expired', message: 'Session expired' }))
      } else {
        console.log('Session expired')
        console.log('Run: dotdo login')
      }
      return
    }

    // Fetch user info
    const userInfo = await getUserInfo(token.access_token)

    if (!userInfo) {
      if (options.json) {
        console.log(JSON.stringify({ error: 'fetch_failed', message: 'Failed to fetch user information' }))
      } else {
        console.log('Failed to fetch user information')
        console.log('Session may be invalid. Run: dotdo login')
      }
      return
    }

    // Display user info
    if (options.json) {
      console.log(JSON.stringify(userInfo))
    } else {
      console.log(`Logged in as: ${userInfo.email || userInfo.id}`)

      if (options.verbose) {
        if (userInfo.name) {
          console.log(`Name: ${userInfo.name}`)
        }
        if (userInfo.id) {
          console.log(`User ID: ${userInfo.id}`)
        }
        if (token.scope) {
          console.log(`Scopes: ${token.scope}`)
        }
        if (token.expires_at) {
          const expiresDate = new Date(token.expires_at)
          console.log(`Token expires: ${expiresDate.toISOString()}`)
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (options.json) {
      console.log(JSON.stringify({ error: 'exception', message }))
    } else {
      console.error('Failed to get user info:', message)
    }
    throw new Error(`Failed to get user info: ${message}`)
  }
}

// Export for CLI usage
export default whoami
