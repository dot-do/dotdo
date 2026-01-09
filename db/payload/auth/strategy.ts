/**
 * Better Auth Strategy Module (Stub)
 *
 * This is a stub file for the Payload-compatible authenticate() strategy.
 * The actual implementation will be done in the GREEN phase.
 *
 * @module @dotdo/payload/auth/strategy
 */

import type { BetterAuthUser, PayloadUser, AuthBridgeConfig } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Arguments passed to Payload's authenticate callback.
 */
export interface AuthenticateArgs {
  /** Payload instance */
  payload: unknown
  /** HTTP headers from the request */
  headers: Headers
}

/**
 * Result from authenticate function.
 */
export interface AuthenticateResult {
  /** The authenticated user, or null if not authenticated */
  user: PayloadUser | null
}

/**
 * Session validation result (reusing existing type).
 */
export interface SessionValidationResult {
  valid: boolean
  user?: BetterAuthUser
  session?: {
    id: string
    token: string
    expiresAt: Date
    userId: string
  }
  error?: string
}

/**
 * API key validation result (reusing existing type).
 */
export interface ApiKeyValidationResult {
  valid: boolean
  user?: BetterAuthUser
  apiKey?: {
    id: string
    name: string
    userId: string
    permissions: string[]
    expiresAt: Date | null
  }
  error?: string
  retryAfter?: number
}

/**
 * Session validator interface.
 */
export interface SessionValidator {
  validate(token: string): Promise<SessionValidationResult>
}

/**
 * API key validator interface.
 */
export interface ApiKeyValidator {
  validate(key: string): Promise<ApiKeyValidationResult>
}

/**
 * User provisioner interface.
 */
export interface UserProvisioner {
  provision(user: BetterAuthUser, config: AuthBridgeConfig): Promise<PayloadUser>
}

/**
 * Logger interface for auth events.
 */
export interface AuthLogger {
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
}

/**
 * Configuration for the Better Auth strategy.
 */
export interface StrategyConfig {
  /** Auth bridge configuration */
  config?: AuthBridgeConfig
  /** Session validator (for dependency injection/mocking) */
  sessionValidator?: SessionValidator
  /** API key validator (for dependency injection/mocking) */
  apiKeyValidator?: ApiKeyValidator
  /** User provisioner (for dependency injection/mocking) */
  userProvisioner?: UserProvisioner
  /** Logger for auth events */
  logger?: AuthLogger
}

/**
 * Payload-compatible strategy object.
 */
export interface BetterAuthStrategy {
  /** The name of the strategy */
  name: string
  /** The authenticate function */
  authenticate: (args: AuthenticateArgs) => Promise<AuthenticateResult>
}

// ============================================================================
// Stub Implementation (to be completed in GREEN phase)
// ============================================================================

/**
 * Authenticate a request using Better Auth credentials.
 *
 * @param args - The authenticate arguments from Payload
 * @param options - Strategy configuration options
 * @returns Authentication result with user or null
 */
export async function authenticate(
  _args: AuthenticateArgs,
  _options: StrategyConfig
): Promise<AuthenticateResult> {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented')
}

/**
 * Creates a Payload-compatible Better Auth strategy.
 *
 * @param options - Strategy configuration options
 * @returns A Payload-compatible strategy object
 */
export function createBetterAuthStrategy(_options: StrategyConfig): BetterAuthStrategy {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented')
}
