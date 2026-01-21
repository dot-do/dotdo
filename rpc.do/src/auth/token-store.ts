// Token Store - Read/write OAuth tokens to ~/.do/tokens.json
// Provides persistent storage for OAuth tokens in the local filesystem

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

/**
 * Stored token data format
 */
export interface StoredTokens {
  /** OAuth access token */
  access_token: string
  /** OAuth refresh token */
  refresh_token: string
  /** Token expiration timestamp (Unix milliseconds) */
  expires_at: number
}

/**
 * Token store interface for dependency injection
 */
export interface ITokenStore {
  getTokens(): Promise<StoredTokens | null>
  saveTokens(tokens: StoredTokens): Promise<void>
  deleteTokens(): Promise<void>
  isTokenExpired(): Promise<boolean>
}

/**
 * Default path for token storage
 */
export function getDefaultTokensPath(): string {
  return path.join(os.homedir(), '.do', 'tokens.json')
}

/**
 * Token Store - manages persistent OAuth token storage
 *
 * Stores tokens in a JSON file (default: ~/.do/tokens.json)
 * Creates the directory if it doesn't exist.
 *
 * @example
 * ```typescript
 * const store = new TokenStore()
 * const tokens = await store.getTokens()
 * if (tokens && !await store.isTokenExpired()) {
 *   // Use tokens.access_token
 * }
 * ```
 */
export class TokenStore implements ITokenStore {
  private readonly tokensPath: string

  constructor(tokensPath: string = getDefaultTokensPath()) {
    this.tokensPath = tokensPath
  }

  /**
   * Get stored tokens from the filesystem
   * @returns StoredTokens if they exist, null otherwise
   */
  async getTokens(): Promise<StoredTokens | null> {
    try {
      if (!fs.existsSync(this.tokensPath)) {
        return null
      }
      const content = fs.readFileSync(this.tokensPath, 'utf-8')
      return JSON.parse(content) as StoredTokens
    } catch {
      return null
    }
  }

  /**
   * Save tokens to the filesystem
   * Creates the directory if it doesn't exist
   * @param tokens - The tokens to save
   */
  async saveTokens(tokens: StoredTokens): Promise<void> {
    const dir = path.dirname(this.tokensPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(this.tokensPath, JSON.stringify(tokens, null, 2))
  }

  /**
   * Delete stored tokens
   */
  async deleteTokens(): Promise<void> {
    try {
      if (fs.existsSync(this.tokensPath)) {
        fs.unlinkSync(this.tokensPath)
      }
    } catch {
      // Ignore errors when deleting
    }
  }

  /**
   * Check if the stored token is expired
   * Returns true if no token exists or if the token has expired
   * @param bufferMs - Buffer time in ms to consider token expired before actual expiry (default: 60000 = 1 minute)
   */
  async isTokenExpired(bufferMs: number = 60000): Promise<boolean> {
    const tokens = await this.getTokens()
    if (!tokens) {
      return true
    }
    // Consider token expired if it will expire within the buffer time
    return Date.now() >= tokens.expires_at - bufferMs
  }
}
