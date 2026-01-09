/**
 * Better Auth Strategy Module
 *
 * Payload-compatible authenticate() strategy that bridges Better Auth
 * sessions and API keys to Payload CMS's auth interface.
 *
 * @module @dotdo/payload/auth/strategy
 */

import { extractCredentials } from './extraction'
import type {
  BetterAuthUser,
  PayloadUser,
  AuthBridgeConfig,
  SessionValidationResult,
  ApiKeyValidationResult,
} from './types'

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
// Default Config
// ============================================================================

const DEFAULT_CONFIG: AuthBridgeConfig = {
  usersCollection: 'users',
  sessionCookieName: 'better-auth.session_token',
  apiKeyHeader: 'x-api-key',
  autoCreateUsers: true,
}

// ============================================================================
// User Mapping
// ============================================================================

/**
 * Map a Better Auth user to Payload user format.
 */
function mapToPayloadUser(user: BetterAuthUser, config: AuthBridgeConfig): PayloadUser {
  // Use custom mapper if provided
  if (config.userMapper) {
    return config.userMapper(user, config)
  }

  return {
    id: user.id,
    email: user.email,
    collection: config.usersCollection,
  }
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Authenticate a request using Better Auth credentials.
 *
 * @param args - The authenticate arguments from Payload
 * @param options - Strategy configuration options
 * @returns Authentication result with user or null
 */
export async function authenticate(
  args: AuthenticateArgs,
  options: StrategyConfig
): Promise<AuthenticateResult> {
  const { headers } = args
  const config = { ...DEFAULT_CONFIG, ...options.config }

  // Handle missing headers
  if (!headers) {
    return { user: null }
  }

  try {
    // Extract credentials from headers
    const credentials = extractCredentials(headers)

    // No credentials found
    if (!credentials) {
      return { user: null }
    }

    let betterAuthUser: BetterAuthUser | undefined

    // Validate based on credential type
    switch (credentials.type) {
      case 'session': {
        // Session cookie - validate with session validator
        if (!options.sessionValidator) {
          return { user: null }
        }
        const result = await options.sessionValidator.validate(credentials.token)
        if (!result.valid) {
          options.logger?.warn('Session validation failed', { error: result.error })
          return { user: null }
        }
        betterAuthUser = result.user
        break
      }

      case 'bearer': {
        // Bearer token - try as session first, then as API key
        if (options.sessionValidator) {
          const sessionResult = await options.sessionValidator.validate(credentials.token)
          if (sessionResult.valid) {
            betterAuthUser = sessionResult.user
            break
          }
        }
        // Fall through to API key validation
        if (options.apiKeyValidator) {
          const apiKeyResult = await options.apiKeyValidator.validate(credentials.token)
          if (apiKeyResult.valid) {
            betterAuthUser = apiKeyResult.user
            break
          }
        }
        options.logger?.warn('Bearer token validation failed')
        return { user: null }
      }

      case 'apiKey': {
        // API key header - validate with API key validator
        if (!options.apiKeyValidator) {
          return { user: null }
        }
        const result = await options.apiKeyValidator.validate(credentials.token)
        if (!result.valid) {
          options.logger?.warn('API key validation failed', { error: result.error })
          return { user: null }
        }
        betterAuthUser = result.user
        break
      }
    }

    // No user found
    if (!betterAuthUser) {
      return { user: null }
    }

    // Provision user if needed (auto-create in Payload)
    let payloadUser: PayloadUser

    if (config.autoCreateUsers !== false && options.userProvisioner) {
      payloadUser = await options.userProvisioner.provision(betterAuthUser, config)
    } else {
      // Map directly without provisioning
      payloadUser = mapToPayloadUser(betterAuthUser, config)
    }

    return { user: payloadUser }
  } catch (error) {
    options.logger?.warn(`Auth error: ${error}`)
    return { user: null }
  }
}

/**
 * Creates a Payload-compatible Better Auth strategy.
 *
 * @param options - Strategy configuration options
 * @returns A Payload-compatible strategy object
 */
export function createBetterAuthStrategy(options: StrategyConfig = {}): BetterAuthStrategy {
  return {
    name: 'better-auth',
    authenticate: (args: AuthenticateArgs) => authenticate(args, options),
  }
}
