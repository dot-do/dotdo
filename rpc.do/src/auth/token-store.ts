/**
 * @module rpc.do/auth/token-store
 *
 * Persistent OAuth token storage for the local filesystem.
 *
 * This module provides the {@link TokenStore} class for reading and writing
 * OAuth tokens to a JSON file (default: `~/.do/tokens.json`).
 *
 * @example
 * ```typescript
 * import { TokenStore } from 'rpc.do'
 *
 * const store = new TokenStore()
 *
 * // Save tokens after login
 * await store.saveTokens({
 *   access_token: 'eyJ...',
 *   refresh_token: 'dGhp...',
 *   expires_at: Date.now() + 3600000,
 * })
 *
 * // Check if logged in
 * const tokens = await store.getTokens()
 * if (tokens && !await store.isTokenExpired()) {
 *   console.log('Logged in!')
 * }
 *
 * // Logout
 * await store.deleteTokens()
 * ```
 */

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
 * Get the default path for token storage.
 *
 * Returns `~/.do/tokens.json` where `~` is the user's home directory.
 *
 * @returns The default tokens file path
 *
 * @example
 * ```typescript
 * import { getDefaultTokensPath } from 'rpc.do'
 *
 * console.log(getDefaultTokensPath())
 * // => "/home/user/.do/tokens.json" (Linux)
 * // => "/Users/user/.do/tokens.json" (macOS)
 * // => "C:\\Users\\user\\.do\\tokens.json" (Windows)
 * ```
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
   * @throws Error if file exists but contains invalid JSON or malformed tokens
   */
  async getTokens(): Promise<StoredTokens | null> {
    if (!fs.existsSync(this.tokensPath)) {
      return null
    }

    let content: string
    try {
      content = fs.readFileSync(this.tokensPath, 'utf-8')
    } catch (error) {
      throw new Error(
        `Failed to read tokens from ${this.tokensPath}: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch (error) {
      throw new Error(
        `Failed to parse tokens from ${this.tokensPath}: invalid JSON - ${error instanceof Error ? error.message : String(error)}`
      )
    }

    // Validate token structure
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`Invalid token structure in ${this.tokensPath}: expected object`)
    }

    const tokens = parsed as Record<string, unknown>

    if (typeof tokens['access_token'] !== 'string') {
      throw new Error(`Invalid token structure in ${this.tokensPath}: missing or invalid access_token`)
    }

    if (typeof tokens['refresh_token'] !== 'string') {
      throw new Error(`Invalid token structure in ${this.tokensPath}: missing or invalid refresh_token`)
    }

    if (typeof tokens['expires_at'] !== 'number') {
      throw new Error(`Invalid token structure in ${this.tokensPath}: missing or invalid expires_at (expected number)`)
    }

    return {
      access_token: tokens['access_token'],
      refresh_token: tokens['refresh_token'],
      expires_at: tokens['expires_at'],
    }
  }

  /**
   * Save tokens to the filesystem with secure permissions
   * Creates the directory if it doesn't exist (mode 0700)
   * Uses atomic writes (write to temp file, then rename)
   * Sets file permissions to 0600 (owner read/write only)
   * @param tokens - The tokens to save
   * @throws Error if save fails
   */
  async saveTokens(tokens: StoredTokens): Promise<void> {
    const dir = path.dirname(this.tokensPath)

    // Create directory with secure permissions (0700 = owner rwx only)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    }

    // Atomic write: write to temp file, then rename
    const tempPath = `${this.tokensPath}.tmp.${process.pid}`
    const content = JSON.stringify(tokens, null, 2)

    try {
      // Write to temp file with secure permissions (0600 = owner rw only)
      fs.writeFileSync(tempPath, content, { mode: 0o600 })

      // Atomic rename
      fs.renameSync(tempPath, this.tokensPath)
    } catch (error) {
      // Clean up temp file on failure
      try {
        fs.unlinkSync(tempPath)
      } catch {
        // Ignore cleanup errors
      }
      throw new Error(
        `Failed to save tokens to ${this.tokensPath}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
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
