/**
 * Strategy Configuration Module (Stub)
 *
 * Configuration validation and merging for the Better Auth strategy.
 * This is a stub module - tests will fail until properly implemented.
 *
 * @module @dotdo/payload/auth/config
 */

import type {
  AuthBridgeConfig,
  BetterAuthUser,
  PayloadUser,
} from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Validation error for a specific field.
 */
export interface StrategyConfigValidationError {
  /** Field path (e.g., 'usersCollection' or 'roleMapping.user') */
  field: string
  /** Human-readable error message */
  message: string
}

/**
 * Result of validating strategy configuration.
 * Uses discriminated union for type-safe success/failure handling.
 */
export type StrategyConfigValidationResult =
  | { valid: true }
  | { valid: false; errors: StrategyConfigValidationError[] }

/**
 * Session validator interface.
 */
export interface SessionValidator {
  validate(token: string): Promise<unknown>
}

/**
 * API key validator interface.
 */
export interface ApiKeyValidator {
  validate(key: string): Promise<unknown>
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
 * Strategy configuration options.
 */
export interface StrategyConfig {
  /** Auth bridge configuration */
  config?: AuthBridgeConfig
  /** Session validator */
  sessionValidator?: SessionValidator
  /** API key validator */
  apiKeyValidator?: ApiKeyValidator
  /** User provisioner */
  userProvisioner?: UserProvisioner
  /** Logger for auth events */
  logger?: AuthLogger
}

// ============================================================================
// Stub Implementations (Tests will fail)
// ============================================================================

/**
 * Get default AuthBridgeConfig values.
 *
 * TODO: Implement properly to make tests pass.
 */
export function getDefaultConfig(): AuthBridgeConfig {
  // Stub: returns incorrect defaults to make tests fail
  throw new Error('getDefaultConfig not implemented')
}

/**
 * Validate an AuthBridgeConfig object.
 *
 * TODO: Implement validation logic to make tests pass.
 */
export function validateAuthBridgeConfig(
  _config: AuthBridgeConfig
): StrategyConfigValidationResult {
  // Stub: always returns invalid to make tests fail
  throw new Error('validateAuthBridgeConfig not implemented')
}

/**
 * Validate a StrategyConfig object.
 *
 * TODO: Implement validation logic to make tests pass.
 */
export function validateStrategyConfig(
  _config: Partial<StrategyConfig>
): StrategyConfigValidationResult {
  // Stub: always returns invalid to make tests fail
  throw new Error('validateStrategyConfig not implemented')
}

/**
 * Merge user-provided config with defaults.
 *
 * TODO: Implement merging logic to make tests pass.
 */
export function mergeStrategyConfig(
  _config: Partial<StrategyConfig>
): StrategyConfig {
  // Stub: returns empty config to make tests fail
  throw new Error('mergeStrategyConfig not implemented')
}
