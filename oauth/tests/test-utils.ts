/**
 * @dotdo/oauth Test Utilities
 *
 * Provides real implementations for OAuth testing following the NO MOCKS philosophy.
 * These are NOT mocks - they are real, deterministic implementations that behave
 * exactly like production code but with configurable behavior for testing.
 *
 * @module @dotdo/oauth/tests/test-utils
 */

import type { OAuthProvider, UserInfo } from '../src/providers/interface'
import type { SessionData, SessionStore, SessionStoreOptions } from '../src/storage/interface'
import type { TokenResponse } from '../src/core/types'

/**
 * Configuration for a test OAuth provider.
 */
export interface TestProviderConfig {
  /** Provider name (default: 'test') */
  name?: string
  /** User to return from getUser (default: test user) */
  user?: UserInfo
  /** Token response to return from exchangeCode (default: valid token) */
  tokenResponse?: TokenResponse
  /** Refresh token response (default: new valid token) */
  refreshTokenResponse?: TokenResponse
  /** Token exchange response for MCP flows */
  tokenExchangeResponse?: TokenResponse
  /** Whether to fail token exchange (throws error) */
  failExchangeCode?: boolean
  /** Whether to fail getUser (throws error) */
  failGetUser?: boolean
  /** Whether to fail refresh (throws error) */
  failRefresh?: boolean
  /** Whether to fail token exchange (throws error) */
  failTokenExchange?: boolean
  /** Error message for failures */
  errorMessage?: string
  /** Track calls for verification */
  trackCalls?: boolean
  /** Whether to omit refreshToken method (for testing providers without refresh support) */
  noRefreshToken?: boolean
  /** Whether to omit tokenExchange method (for testing providers without token exchange support) */
  noTokenExchange?: boolean
}

/**
 * Call tracking for test verification.
 */
export interface ProviderCallTracker {
  getAuthorizationUrlCalls: Array<{ state: string; challenge: string; params?: Record<string, string> }>
  exchangeCodeCalls: Array<{ code: string; verifier: string; params?: Record<string, string> }>
  getUserCalls: Array<{ accessToken: string }>
  refreshTokenCalls: Array<{ refreshToken: string; params?: Record<string, string> }>
  tokenExchangeCalls: Array<{ subjectToken: string; tokenType: string; params?: Record<string, string> }>
}

/**
 * Test OAuth provider - a real implementation with configurable behavior.
 *
 * This is NOT a mock. It's a complete OAuth provider implementation that:
 * - Generates valid authorization URLs
 * - Returns configurable token responses
 * - Returns configurable user information
 * - Can be configured to simulate failures
 * - Tracks calls for test verification (optional)
 */
export class TestProvider implements OAuthProvider {
  readonly name: string
  private config: TestProviderConfig
  private _calls: ProviderCallTracker

  constructor(config: TestProviderConfig = {}) {
    this.name = config.name ?? 'test'
    this.config = config
    this._calls = {
      getAuthorizationUrlCalls: [],
      exchangeCodeCalls: [],
      getUserCalls: [],
      refreshTokenCalls: [],
      tokenExchangeCalls: [],
    }
  }

  /** Get tracked calls for verification */
  get calls(): ProviderCallTracker {
    return this._calls
  }

  /** Reset call tracking */
  resetCalls(): void {
    this._calls = {
      getAuthorizationUrlCalls: [],
      exchangeCodeCalls: [],
      getUserCalls: [],
      refreshTokenCalls: [],
      tokenExchangeCalls: [],
    }
  }

  getAuthorizationUrl(state: string, codeChallenge: string, params?: Record<string, string>): string {
    if (this.config.trackCalls) {
      this._calls.getAuthorizationUrlCalls.push({ state, challenge: codeChallenge, params })
    }

    const url = new URL(`https://${this.name}.provider.test/authorize`)
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value)
      }
    }

    return url.toString()
  }

  async exchangeCode(code: string, codeVerifier: string, params?: Record<string, string>): Promise<TokenResponse> {
    if (this.config.trackCalls) {
      this._calls.exchangeCodeCalls.push({ code, verifier: codeVerifier, params })
    }

    if (this.config.failExchangeCode) {
      throw new Error(this.config.errorMessage ?? 'Token exchange failed')
    }

    return (
      this.config.tokenResponse ?? {
        access_token: 'test-access-token',
        token_type: 'Bearer' as const,
        expires_in: 3600,
        refresh_token: 'test-refresh-token',
      }
    )
  }

  async getUser(accessToken: string): Promise<UserInfo> {
    if (this.config.trackCalls) {
      this._calls.getUserCalls.push({ accessToken })
    }

    if (this.config.failGetUser) {
      throw new Error(this.config.errorMessage ?? 'Failed to get user info')
    }

    return (
      this.config.user ?? {
        id: 'test-user-123',
        email: 'test@example.com',
        name: 'Test User',
      }
    )
  }

  async refreshToken(refreshToken: string, params?: Record<string, string>): Promise<TokenResponse> {
    if (this.config.trackCalls) {
      this._calls.refreshTokenCalls.push({ refreshToken, params })
    }

    if (this.config.failRefresh) {
      throw new Error(this.config.errorMessage ?? 'Refresh failed')
    }

    return (
      this.config.refreshTokenResponse ?? {
        access_token: 'new-access-token',
        token_type: 'Bearer' as const,
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      }
    )
  }

  async tokenExchange(
    subjectToken: string,
    subjectTokenType: string,
    params?: Record<string, string>
  ): Promise<TokenResponse> {
    if (this.config.trackCalls) {
      this._calls.tokenExchangeCalls.push({ subjectToken, tokenType: subjectTokenType, params })
    }

    if (this.config.failTokenExchange) {
      throw new Error(this.config.errorMessage ?? 'Token exchange not supported')
    }

    return (
      this.config.tokenExchangeResponse ?? {
        access_token: 'exchanged-access-token',
        token_type: 'Bearer' as const,
        expires_in: 3600,
      }
    )
  }
}

/**
 * Factory function to create a test provider with specific configuration.
 */
export function createTestProvider(config: TestProviderConfig = {}): TestProvider {
  return new TestProvider({ trackCalls: true, ...config })
}

/**
 * Create a minimal provider without optional methods (refreshToken, tokenExchange).
 * Useful for testing error handling when these methods are not available.
 */
export function createMinimalProvider(config: TestProviderConfig = {}): OAuthProvider {
  const provider = new TestProvider({ trackCalls: true, ...config })

  // Return only the required methods
  const minimalProvider: OAuthProvider = {
    name: provider.name,
    getAuthorizationUrl: provider.getAuthorizationUrl.bind(provider),
    exchangeCode: provider.exchangeCode.bind(provider),
    getUser: provider.getUser.bind(provider),
  }

  // Optionally include refreshToken
  if (!config.noRefreshToken) {
    minimalProvider.refreshToken = provider.refreshToken.bind(provider)
  }

  // Optionally include tokenExchange
  if (!config.noTokenExchange) {
    minimalProvider.tokenExchange = provider.tokenExchange.bind(provider)
  }

  return minimalProvider
}

/**
 * Test session store - a real in-memory implementation.
 *
 * This is NOT a mock. It's a complete session store implementation that:
 * - Stores sessions in a Map with TTL support
 * - Provides access to the internal map for test verification
 * - Handles all edge cases (expiration, rotation, cleanup)
 */
export class TestSessionStore implements SessionStore {
  readonly sessions: Map<string, { data: SessionData; expiresAt: number }>
  private defaultTTL: number

  constructor(options: SessionStoreOptions = {}) {
    this.sessions = new Map()
    this.defaultTTL = options.defaultTTL ?? 24 * 60 * 60 * 1000 // 24 hours
  }

  async get(sessionId: string): Promise<SessionData | null> {
    const stored = this.sessions.get(sessionId)
    if (!stored) return null

    // Check expiration
    if (Date.now() > stored.expiresAt) {
      this.sessions.delete(sessionId)
      return null
    }

    return stored.data
  }

  async set(sessionId: string, data: SessionData, ttl?: number): Promise<void> {
    const expiresAt = Date.now() + (ttl ?? this.defaultTTL)
    this.sessions.set(sessionId, { data, expiresAt })
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId)
  }

  async cleanup(): Promise<void> {
    const now = Date.now()
    for (const [sessionId, stored] of this.sessions) {
      if (now > stored.expiresAt) {
        this.sessions.delete(sessionId)
      }
    }
  }

  async rotate(oldSessionId: string, newSessionId: string): Promise<string | null> {
    const stored = this.sessions.get(oldSessionId)
    if (!stored) return null

    // Check expiration
    if (Date.now() > stored.expiresAt) {
      this.sessions.delete(oldSessionId)
      return null
    }

    // Move to new ID
    this.sessions.set(newSessionId, stored)
    this.sessions.delete(oldSessionId)
    return newSessionId
  }

  /** Get session data directly for test verification (bypasses expiration check) */
  getSessionData(sessionId: string): SessionData | undefined {
    return this.sessions.get(sessionId)?.data
  }

  /** Check if a session exists (for test verification) */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /** Get all session IDs (for test verification) */
  getSessionIds(): string[] {
    return Array.from(this.sessions.keys())
  }

  /** Clear all sessions (for test cleanup) */
  clear(): void {
    this.sessions.clear()
  }
}

/**
 * Factory function to create a test session store.
 */
export function createTestSessionStore(options: SessionStoreOptions = {}): TestSessionStore {
  return new TestSessionStore(options)
}

/**
 * Test KV namespace - a real in-memory implementation matching KVNamespace interface.
 *
 * This is NOT a mock. It's a complete KV implementation that:
 * - Stores values with optional TTL
 * - Supports JSON parsing
 * - Handles expiration correctly
 */
export class TestKVNamespace {
  private store: Map<string, { value: string; expiresAt?: number }>

  constructor() {
    this.store = new Map()
  }

  async get(key: string, type?: 'text' | 'json' | 'arrayBuffer' | 'stream'): Promise<unknown> {
    const item = this.store.get(key)
    if (!item) return null

    // Check expiration
    if (item.expiresAt && item.expiresAt < Date.now()) {
      this.store.delete(key)
      return null
    }

    if (type === 'json') {
      return JSON.parse(item.value)
    }
    return item.value
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiresAt = options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : undefined
    this.store.set(key, { value, expiresAt })
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async list(): Promise<{ keys: Array<{ name: string }> }> {
    const keys = Array.from(this.store.keys()).map((name) => ({ name }))
    return { keys }
  }

  /** Get raw value for test verification */
  getRaw(key: string): string | undefined {
    return this.store.get(key)?.value
  }

  /** Check if key exists */
  has(key: string): boolean {
    return this.store.has(key)
  }

  /** Clear all entries */
  clear(): void {
    this.store.clear()
  }
}

/**
 * Factory function to create a test KV namespace.
 */
export function createTestKV(): TestKVNamespace {
  return new TestKVNamespace()
}

/**
 * Test D1 database - a real in-memory implementation matching D1Database interface.
 *
 * This is NOT a mock. It's a simplified D1 implementation that:
 * - Stores rows in a Map
 * - Supports basic SQL operations (INSERT OR REPLACE, SELECT, DELETE)
 * - Handles session-specific queries correctly
 */
export class TestD1Database {
  readonly rows: Map<string, Record<string, unknown>>

  constructor() {
    this.rows = new Map()
  }

  prepare(query: string): TestD1Statement {
    return new TestD1Statement(query, this.rows)
  }

  /** Clear all rows for test cleanup */
  clear(): void {
    this.rows.clear()
  }
}

/**
 * Test D1 prepared statement.
 */
export class TestD1Statement {
  private query: string
  private rows: Map<string, Record<string, unknown>>
  private boundValues: unknown[] = []

  constructor(query: string, rows: Map<string, Record<string, unknown>>) {
    this.query = query
    this.rows = rows
  }

  bind(...values: unknown[]): this {
    this.boundValues = values
    return this
  }

  async first(): Promise<Record<string, unknown> | null> {
    // SELECT query
    if (this.query.includes('SELECT')) {
      const id = this.boundValues[0] as string
      const now = this.boundValues[1] as number
      const row = this.rows.get(id)
      if (!row) return null

      // Check session expiration
      if (row['session_expires_at'] && (row['session_expires_at'] as number) <= now) {
        return null
      }
      return row
    }
    return null
  }

  async run(): Promise<{ success: boolean }> {
    // INSERT OR REPLACE query
    if (this.query.includes('INSERT OR REPLACE')) {
      const [id, user_id, access_token, refresh_token, expires_at, provider, metadata, created_at, session_expires_at] =
        this.boundValues

      this.rows.set(id as string, {
        id,
        user_id,
        access_token,
        refresh_token,
        expires_at,
        provider,
        metadata,
        created_at,
        session_expires_at,
      })
      return { success: true }
    }

    // DELETE by ID query
    if (this.query.includes('DELETE') && this.query.includes('WHERE id')) {
      this.rows.delete(this.boundValues[0] as string)
      return { success: true }
    }

    // DELETE expired sessions
    if (this.query.includes('DELETE') && this.query.includes('session_expires_at')) {
      const now = this.boundValues[0] as number
      for (const [id, row] of this.rows.entries()) {
        if ((row['session_expires_at'] as number) <= now) {
          this.rows.delete(id)
        }
      }
      return { success: true }
    }

    return { success: true }
  }

  async all(): Promise<{ results: Array<Record<string, unknown>> }> {
    return { results: Array.from(this.rows.values()) }
  }
}

/**
 * Factory function to create a test D1 database.
 */
export function createTestD1(): TestD1Database {
  return new TestD1Database()
}

/**
 * Create a simple JWT-like token for testing.
 * This is NOT a real JWT - just a base64-encoded payload for testing.
 */
export function createTestToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify(payload))
  return `${header}.${body}.test-signature`
}

/**
 * Parse a test token back to its payload.
 */
export function parseTestToken(token: string): Record<string, unknown> | null {
  try {
    const [, body] = token.split('.')
    return JSON.parse(atob(body))
  } catch {
    return null
  }
}

/**
 * Create a test verification function for JWT tokens.
 * Returns payload if token matches expected format, null otherwise.
 */
export function createTestTokenVerifier(validTokens: Map<string, Record<string, unknown>>) {
  return async (token: string): Promise<Record<string, unknown> | null> => {
    return validTokens.get(token) ?? null
  }
}
