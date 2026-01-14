/**
 * RPC Authentication Layer
 *
 * Provides token-based authentication for ShellApi.
 * Wraps ShellApiImpl with authentication requirements,
 * throwing errors on unauthenticated calls to exec() or spawn().
 *
 * @packageDocumentation
 */

import type {
  ShellApi,
  ShellStream,
  ShellResult,
  ShellExecOptions,
  ShellSpawnOptions,
} from '../../core/rpc/types.js'

// ============================================================================
// Auth Token Types
// ============================================================================

/**
 * Authentication token containing user/session information.
 */
export interface AuthToken {
  /** The raw token string */
  token: string

  /** User identifier (from auth provider) */
  userId?: string

  /** Session identifier */
  sessionId?: string

  /** Token expiration timestamp (milliseconds since epoch) */
  expiresAt?: number

  /** Permissions granted by this token */
  permissions?: string[]
}

// ============================================================================
// Token Validator Interface
// ============================================================================

/**
 * Interface for token validation backends.
 *
 * Implement this interface to integrate with different auth providers
 * (e.g., dotdo auth, JWT validation, OAuth, etc.)
 *
 * @example
 * ```typescript
 * // JWT validator example
 * const jwtValidator: TokenValidator = {
 *   async validate(token: string) {
 *     try {
 *       const decoded = jwt.verify(token, secret)
 *       return {
 *         token,
 *         userId: decoded.sub,
 *         expiresAt: decoded.exp * 1000,
 *         permissions: decoded.permissions
 *       }
 *     } catch {
 *       return null
 *     }
 *   }
 * }
 * ```
 */
export interface TokenValidator {
  /**
   * Validate a token and return auth information if valid.
   * @param token - Raw token string to validate
   * @returns AuthToken if valid, null if invalid
   */
  validate(token: string): Promise<AuthToken | null>

  /**
   * Optional: Refresh an expiring token.
   * @param token - Token to refresh
   * @returns New AuthToken if refresh succeeds, null otherwise
   */
  refresh?(token: string): Promise<AuthToken | null>
}

// ============================================================================
// Authenticated ShellApi Interface
// ============================================================================

/**
 * ShellApi extended with authentication capabilities.
 *
 * Before calling exec() or spawn(), clients must call authenticate()
 * with a valid token. Unauthenticated calls will throw an error.
 *
 * @example
 * ```typescript
 * const api = createAuthenticatedShellApi(shellApi, validator)
 *
 * // Must authenticate first
 * const success = await api.authenticate('my-token')
 * if (!success) {
 *   throw new Error('Authentication failed')
 * }
 *
 * // Now can execute commands
 * const result = await api.exec('ls -la')
 * ```
 */
export interface AuthenticatedShellApi extends ShellApi {
  /**
   * Authenticate with a token before executing commands.
   * Must be called before exec() or spawn().
   *
   * @param token - Authentication token string
   * @returns true if authentication succeeded, false otherwise
   */
  authenticate(token: string): Promise<boolean>

  /**
   * Check if currently authenticated.
   * Also checks token expiration.
   *
   * @returns true if authenticated with a valid, non-expired token
   */
  isAuthenticated(): boolean

  /**
   * Get current auth token info (if authenticated).
   *
   * @returns Current AuthToken or null if not authenticated
   */
  getAuthToken(): AuthToken | null

  /**
   * Logout and clear authentication state.
   * After calling this, authenticate() must be called again.
   */
  logout(): void
}

// ============================================================================
// AuthenticatedShellApiImpl - Main Implementation
// ============================================================================

/**
 * Implementation of AuthenticatedShellApi.
 *
 * Wraps a ShellApi implementation with token-based authentication.
 * All exec() and spawn() calls require prior authentication.
 *
 * @example
 * ```typescript
 * import { ShellApiImpl } from './shell-api-impl.js'
 * import { AuthenticatedShellApiImpl, createMemoryValidator } from './auth.js'
 *
 * const tokens = new Map([
 *   ['valid-token', { token: 'valid-token', userId: 'user-1' }]
 * ])
 *
 * const api = new AuthenticatedShellApiImpl(
 *   new ShellApiImpl(),
 *   createMemoryValidator(tokens)
 * )
 *
 * await api.authenticate('valid-token')
 * const result = await api.exec('echo hello')
 * ```
 */
export class AuthenticatedShellApiImpl implements AuthenticatedShellApi {
  private authToken: AuthToken | null = null

  /**
   * Create a new AuthenticatedShellApiImpl.
   *
   * @param api - Underlying ShellApi to wrap
   * @param validator - TokenValidator for authentication
   */
  constructor(
    private readonly api: ShellApi,
    private readonly validator: TokenValidator
  ) {}

  /**
   * Authenticate with a token.
   * Validates the token and stores auth state if valid.
   *
   * @param token - Token string to validate
   * @returns true if authentication succeeded
   */
  async authenticate(token: string): Promise<boolean> {
    const authToken = await this.validator.validate(token)
    if (authToken) {
      this.authToken = authToken
      return true
    }
    return false
  }

  /**
   * Check if currently authenticated with a valid, non-expired token.
   *
   * @returns true if authenticated
   */
  isAuthenticated(): boolean {
    if (!this.authToken) {
      return false
    }
    // Check token expiration
    if (this.authToken.expiresAt !== undefined && Date.now() > this.authToken.expiresAt) {
      this.authToken = null
      return false
    }
    return true
  }

  /**
   * Get current auth token info.
   *
   * @returns Current AuthToken or null
   */
  getAuthToken(): AuthToken | null {
    return this.authToken
  }

  /**
   * Clear authentication state.
   */
  logout(): void {
    this.authToken = null
  }

  /**
   * Internal: Require authentication before proceeding.
   * @throws Error if not authenticated
   */
  private requireAuth(): void {
    if (!this.isAuthenticated()) {
      throw new Error('Unauthenticated: call authenticate() first')
    }
  }

  /**
   * Execute a command (requires authentication).
   *
   * @param command - Shell command to execute
   * @param options - Execution options
   * @returns Promise resolving to ShellResult
   * @throws Error if not authenticated
   */
  async exec(command: string, options?: ShellExecOptions): Promise<ShellResult> {
    this.requireAuth()
    return this.api.exec(command, options)
  }

  /**
   * Spawn a process (requires authentication).
   *
   * @param command - Shell command to spawn
   * @param options - Spawn options
   * @returns ShellStream handle
   * @throws Error if not authenticated
   */
  spawn(command: string, options?: ShellSpawnOptions): ShellStream {
    this.requireAuth()
    return this.api.spawn(command, options)
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a simple in-memory token validator for testing.
 *
 * @param validTokens - Map of token strings to AuthToken objects
 * @returns TokenValidator that validates against the provided map
 *
 * @example
 * ```typescript
 * const tokens = new Map([
 *   ['test-token', {
 *     token: 'test-token',
 *     userId: 'user-123',
 *     permissions: ['shell:exec']
 *   }]
 * ])
 *
 * const validator = createMemoryValidator(tokens)
 * const result = await validator.validate('test-token')
 * // result === { token: 'test-token', userId: 'user-123', ... }
 * ```
 */
export function createMemoryValidator(validTokens: Map<string, AuthToken>): TokenValidator {
  return {
    async validate(token: string) {
      return validTokens.get(token) || null
    },
  }
}

/**
 * Create an AuthenticatedShellApi from a ShellApi and TokenValidator.
 *
 * @param api - ShellApi to wrap
 * @param validator - TokenValidator for authentication
 * @returns AuthenticatedShellApi instance
 *
 * @example
 * ```typescript
 * import { createShellApi } from './shell-api-impl.js'
 * import { createAuthenticatedShellApi, createMemoryValidator } from './auth.js'
 *
 * const tokens = new Map([['my-token', { token: 'my-token', userId: 'user-1' }]])
 * const api = createAuthenticatedShellApi(createShellApi(), createMemoryValidator(tokens))
 *
 * await api.authenticate('my-token')
 * const result = await api.exec('ls')
 * ```
 */
export function createAuthenticatedShellApi(
  api: ShellApi,
  validator: TokenValidator
): AuthenticatedShellApi {
  return new AuthenticatedShellApiImpl(api, validator)
}
