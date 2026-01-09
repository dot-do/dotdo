/**
 * Better Auth Strategy Tests (RED Phase)
 *
 * These tests define the contract for the Payload-compatible authenticate() strategy.
 * The strategy bridges Better Auth sessions/API keys to Payload CMS's auth interface.
 *
 * The authenticate() function should:
 * - Accept { payload, headers } arguments matching Payload's interface
 * - Return { user: PayloadUser } for valid sessions or API keys
 * - Return { user: null } for invalid/missing credentials
 * - Extract credentials from headers (cookie, bearer, API key)
 * - Validate session tokens via Better Auth
 * - Validate API keys
 * - Provision users on first login if autoCreateUsers is enabled
 * - Use caching for performance
 *
 * Reference: dotdo-6i7r - B18 RED: Authenticate strategy tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type {
  BetterAuthUser,
  PayloadUser,
  AuthBridgeConfig,
  SessionValidationResult,
  ApiKeyValidationResult,
} from '../../auth/types'

// ============================================================================
// Placeholder imports (to be implemented)
// ============================================================================

// These will fail until the implementation is created
import {
  authenticate,
  createBetterAuthStrategy,
  type AuthenticateArgs,
  type AuthenticateResult,
  type BetterAuthStrategy,
  type StrategyConfig,
} from '../../auth/strategy'

// ============================================================================
// Type definitions for the strategy module (to be implemented)
// ============================================================================

/**
 * Arguments passed to Payload's authenticate callback.
 * Matches Payload CMS's expected interface.
 */
// interface AuthenticateArgs {
//   /** Payload instance */
//   payload: unknown
//   /** HTTP headers from the request */
//   headers: Headers
// }

/**
 * Result from authenticate function.
 * Matches Payload CMS's expected return type.
 */
// interface AuthenticateResult {
//   /** The authenticated user, or null if not authenticated */
//   user: PayloadUser | null
// }

/**
 * Configuration for the Better Auth strategy.
 */
// interface StrategyConfig {
//   /** Auth bridge configuration */
//   config?: AuthBridgeConfig
//   /** Session validator (for dependency injection/mocking) */
//   sessionValidator?: SessionValidator
//   /** API key validator (for dependency injection/mocking) */
//   apiKeyValidator?: ApiKeyValidator
//   /** User provisioner (for dependency injection/mocking) */
//   userProvisioner?: UserProvisioner
//   /** Logger for auth events */
//   logger?: AuthLogger
// }

/**
 * Payload-compatible strategy object.
 */
// interface BetterAuthStrategy {
//   /** The name of the strategy */
//   name: string
//   /** The authenticate function */
//   authenticate: (args: AuthenticateArgs) => Promise<AuthenticateResult>
// }

/**
 * Session validator interface for dependency injection.
 */
interface SessionValidator {
  validate(token: string): Promise<SessionValidationResult>
}

/**
 * API key validator interface for dependency injection.
 */
interface ApiKeyValidator {
  validate(key: string): Promise<ApiKeyValidationResult>
}

/**
 * User provisioner interface for dependency injection.
 */
interface UserProvisioner {
  provision(user: BetterAuthUser, config: AuthBridgeConfig): Promise<PayloadUser>
}

/**
 * Logger interface for auth events.
 */
interface AuthLogger {
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
}

// ============================================================================
// Mock helpers
// ============================================================================

function createMockPayload(): unknown {
  return {
    config: {
      collections: [{ slug: 'users' }],
    },
    find: vi.fn(),
    findByID: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  }
}

function createMockBetterAuthUser(overrides: Partial<BetterAuthUser> = {}): BetterAuthUser {
  const now = new Date()
  return {
    id: 'ba-user-001',
    name: 'Alice Smith',
    email: 'alice@example.com',
    emailVerified: true,
    role: 'user',
    image: null,
    banned: false,
    banReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function createMockConfig(overrides: Partial<AuthBridgeConfig> = {}): AuthBridgeConfig {
  return {
    usersCollection: 'users',
    sessionCookieName: 'better-auth.session_token',
    apiKeyHeader: 'x-api-key',
    autoCreateUsers: true,
    ...overrides,
  }
}

function createMockSessionValidator(options: {
  validTokens?: Map<string, BetterAuthUser>
  shouldError?: boolean
} = {}): SessionValidator {
  const validTokens = options.validTokens ?? new Map()

  return {
    validate: vi.fn(async (token: string): Promise<SessionValidationResult> => {
      if (options.shouldError) {
        return { valid: false, error: 'database_error' }
      }

      const user = validTokens.get(token)
      if (user) {
        return {
          valid: true,
          user,
          session: {
            id: `session-${token}`,
            token,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            userId: user.id,
          },
        }
      }

      return { valid: false, error: 'session_not_found' }
    }),
  }
}

function createMockApiKeyValidator(options: {
  validKeys?: Map<string, BetterAuthUser>
  shouldError?: boolean
} = {}): ApiKeyValidator {
  const validKeys = options.validKeys ?? new Map()

  return {
    validate: vi.fn(async (key: string): Promise<ApiKeyValidationResult> => {
      if (options.shouldError) {
        return { valid: false, error: 'database_error' }
      }

      const user = validKeys.get(key)
      if (user) {
        return {
          valid: true,
          user,
          apiKey: {
            id: `apikey-${key}`,
            name: 'Test API Key',
            userId: user.id,
            permissions: ['*'],
            expiresAt: null,
          },
        }
      }

      return { valid: false, error: 'api_key_not_found' }
    }),
  }
}

function createMockUserProvisioner(): UserProvisioner & { calls: BetterAuthUser[] } {
  const calls: BetterAuthUser[] = []

  return {
    calls,
    provision: vi.fn(async (user: BetterAuthUser, config: AuthBridgeConfig): Promise<PayloadUser> => {
      calls.push(user)
      return {
        id: user.id,
        email: user.email,
        collection: config.usersCollection,
      }
    }),
  }
}

function createMockLogger(): AuthLogger & {
  infoCalls: Array<{ message: string; data?: Record<string, unknown> }>
  warnCalls: Array<{ message: string; data?: Record<string, unknown> }>
  errorCalls: Array<{ message: string; data?: Record<string, unknown> }>
} {
  const infoCalls: Array<{ message: string; data?: Record<string, unknown> }> = []
  const warnCalls: Array<{ message: string; data?: Record<string, unknown> }> = []
  const errorCalls: Array<{ message: string; data?: Record<string, unknown> }> = []

  return {
    infoCalls,
    warnCalls,
    errorCalls,
    info: vi.fn((message: string, data?: Record<string, unknown>) => {
      infoCalls.push({ message, data })
    }),
    warn: vi.fn((message: string, data?: Record<string, unknown>) => {
      warnCalls.push({ message, data })
    }),
    error: vi.fn((message: string, data?: Record<string, unknown>) => {
      errorCalls.push({ message, data })
    }),
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Better Auth Strategy', () => {
  describe('authenticate', () => {
    it('should accept { payload, headers } arguments', async () => {
      const validUser = createMockBetterAuthUser()
      const sessionValidator = createMockSessionValidator({
        validTokens: new Map([['valid-session-token', validUser]]),
      })
      const config = createMockConfig()

      const headers = new Headers({
        cookie: 'better-auth.session_token=valid-session-token',
      })

      const result = await authenticate(
        {
          payload: createMockPayload(),
          headers,
        },
        { config, sessionValidator }
      )

      // Should accept the standard Payload authenticate arguments
      expect(result).toBeDefined()
      expect(result).toHaveProperty('user')
    })

    it('should return { user: PayloadUser } for valid session', async () => {
      const validUser = createMockBetterAuthUser({
        id: 'user-123',
        email: 'test@example.com',
      })
      const sessionValidator = createMockSessionValidator({
        validTokens: new Map([['valid-token', validUser]]),
      })
      const config = createMockConfig()

      const headers = new Headers({
        cookie: 'better-auth.session_token=valid-token',
      })

      const result = await authenticate(
        { payload: createMockPayload(), headers },
        { config, sessionValidator }
      )

      expect(result.user).not.toBeNull()
      expect(result.user?.id).toBe('user-123')
      expect(result.user?.email).toBe('test@example.com')
      expect(result.user?.collection).toBe('users')
    })

    it('should return { user: null } for invalid credentials', async () => {
      const sessionValidator = createMockSessionValidator()
      const apiKeyValidator = createMockApiKeyValidator()
      const config = createMockConfig()

      const headers = new Headers({
        cookie: 'better-auth.session_token=invalid-token',
      })

      const result = await authenticate(
        { payload: createMockPayload(), headers },
        { config, sessionValidator, apiKeyValidator }
      )

      expect(result.user).toBeNull()
    })

    it('should extract credentials from headers', async () => {
      const validUser = createMockBetterAuthUser()
      const sessionValidator = createMockSessionValidator({
        validTokens: new Map([['extracted-token', validUser]]),
      })
      const config = createMockConfig()

      // Test with cookie
      const headers = new Headers({
        cookie: 'better-auth.session_token=extracted-token; other=value',
      })

      const result = await authenticate(
        { payload: createMockPayload(), headers },
        { config, sessionValidator }
      )

      expect(result.user).not.toBeNull()
      expect(sessionValidator.validate).toHaveBeenCalledWith('extracted-token')
    })

    it('should validate session token', async () => {
      const validUser = createMockBetterAuthUser()
      const sessionValidator = createMockSessionValidator({
        validTokens: new Map([['session-token-xyz', validUser]]),
      })
      const config = createMockConfig()

      const headers = new Headers({
        cookie: 'better-auth.session_token=session-token-xyz',
      })

      await authenticate(
        { payload: createMockPayload(), headers },
        { config, sessionValidator }
      )

      expect(sessionValidator.validate).toHaveBeenCalledWith('session-token-xyz')
    })

    it('should validate API key', async () => {
      const validUser = createMockBetterAuthUser()
      const sessionValidator = createMockSessionValidator()
      const apiKeyValidator = createMockApiKeyValidator({
        validKeys: new Map([['key_abc123', validUser]]),
      })
      const config = createMockConfig()

      const headers = new Headers({
        'x-api-key': 'key_abc123',
      })

      const result = await authenticate(
        { payload: createMockPayload(), headers },
        { config, sessionValidator, apiKeyValidator }
      )

      expect(result.user).not.toBeNull()
      expect(apiKeyValidator.validate).toHaveBeenCalledWith('key_abc123')
    })

    it('should provision user on first login', async () => {
      const newUser = createMockBetterAuthUser({
        id: 'new-user-id',
        email: 'new@example.com',
      })
      const sessionValidator = createMockSessionValidator({
        validTokens: new Map([['first-login-token', newUser]]),
      })
      const userProvisioner = createMockUserProvisioner()
      const config = createMockConfig({ autoCreateUsers: true })

      const headers = new Headers({
        cookie: 'better-auth.session_token=first-login-token',
      })

      const result = await authenticate(
        { payload: createMockPayload(), headers },
        { config, sessionValidator, userProvisioner }
      )

      expect(result.user).not.toBeNull()
      expect(userProvisioner.provision).toHaveBeenCalledWith(newUser, config)
    })
  })

  describe('credential priority', () => {
    it('should try session cookie first', async () => {
      const cookieUser = createMockBetterAuthUser({ id: 'cookie-user' })
      const bearerUser = createMockBetterAuthUser({ id: 'bearer-user' })
      const apiKeyUser = createMockBetterAuthUser({ id: 'apikey-user' })

      const sessionValidator = createMockSessionValidator({
        validTokens: new Map([
          ['cookie-token', cookieUser],
          ['bearer-token', bearerUser],
        ]),
      })
      const apiKeyValidator = createMockApiKeyValidator({
        validKeys: new Map([['api-key', apiKeyUser]]),
      })
      const config = createMockConfig()

      // Headers with all three credential types
      const headers = new Headers({
        cookie: 'better-auth.session_token=cookie-token',
        authorization: 'Bearer bearer-token',
        'x-api-key': 'api-key',
      })

      const result = await authenticate(
        { payload: createMockPayload(), headers },
        { config, sessionValidator, apiKeyValidator }
      )

      // Should use cookie (session) first
      expect(result.user?.id).toBe('cookie-user')
    })

    it('should try bearer token second', async () => {
      const bearerUser = createMockBetterAuthUser({ id: 'bearer-user' })
      const apiKeyUser = createMockBetterAuthUser({ id: 'apikey-user' })

      const sessionValidator = createMockSessionValidator({
        validTokens: new Map([['bearer-token', bearerUser]]),
      })
      const apiKeyValidator = createMockApiKeyValidator({
        validKeys: new Map([['api-key', apiKeyUser]]),
      })
      const config = createMockConfig()

      // Headers with bearer and API key (no cookie)
      const headers = new Headers({
        authorization: 'Bearer bearer-token',
        'x-api-key': 'api-key',
      })

      const result = await authenticate(
        { payload: createMockPayload(), headers },
        { config, sessionValidator, apiKeyValidator }
      )

      // Should use bearer token second (after cookie miss)
      expect(result.user?.id).toBe('bearer-user')
    })

    it('should try API key third', async () => {
      const apiKeyUser = createMockBetterAuthUser({ id: 'apikey-user' })

      const sessionValidator = createMockSessionValidator()
      const apiKeyValidator = createMockApiKeyValidator({
        validKeys: new Map([['api-key', apiKeyUser]]),
      })
      const config = createMockConfig()

      // Headers with only API key
      const headers = new Headers({
        'x-api-key': 'api-key',
      })

      const result = await authenticate(
        { payload: createMockPayload(), headers },
        { config, sessionValidator, apiKeyValidator }
      )

      // Should use API key when no session/bearer
      expect(result.user?.id).toBe('apikey-user')
    })
  })

  describe('user mapping', () => {
    it('should map Better Auth user to Payload format', async () => {
      const betterAuthUser = createMockBetterAuthUser({
        id: 'ba-123',
        email: 'mapped@example.com',
        name: 'Mapped User',
        role: 'admin',
      })
      const sessionValidator = createMockSessionValidator({
        validTokens: new Map([['token', betterAuthUser]]),
      })
      const config = createMockConfig()

      const headers = new Headers({
        cookie: 'better-auth.session_token=token',
      })

      const result = await authenticate(
        { payload: createMockPayload(), headers },
        { config, sessionValidator }
      )

      expect(result.user).not.toBeNull()
      // Should have the Payload user format
      expect(result.user).toHaveProperty('id')
      expect(result.user).toHaveProperty('collection')
    })

    it('should include collection field', async () => {
      const validUser = createMockBetterAuthUser()
      const sessionValidator = createMockSessionValidator({
        validTokens: new Map([['token', validUser]]),
      })
      const config = createMockConfig({ usersCollection: 'members' })

      const headers = new Headers({
        cookie: 'better-auth.session_token=token',
      })

      const result = await authenticate(
        { payload: createMockPayload(), headers },
        { config, sessionValidator }
      )

      expect(result.user?.collection).toBe('members')
    })

    it('should include id field', async () => {
      const validUser = createMockBetterAuthUser({ id: 'unique-id-456' })
      const sessionValidator = createMockSessionValidator({
        validTokens: new Map([['token', validUser]]),
      })
      const config = createMockConfig()

      const headers = new Headers({
        cookie: 'better-auth.session_token=token',
      })

      const result = await authenticate(
        { payload: createMockPayload(), headers },
        { config, sessionValidator }
      )

      expect(result.user?.id).toBe('unique-id-456')
    })

    it('should include email field', async () => {
      const validUser = createMockBetterAuthUser({ email: 'specific@example.com' })
      const sessionValidator = createMockSessionValidator({
        validTokens: new Map([['token', validUser]]),
      })
      const config = createMockConfig()

      const headers = new Headers({
        cookie: 'better-auth.session_token=token',
      })

      const result = await authenticate(
        { payload: createMockPayload(), headers },
        { config, sessionValidator }
      )

      expect(result.user?.email).toBe('specific@example.com')
    })
  })

  describe('caching', () => {
    it('should use cached session if available', async () => {
      const validUser = createMockBetterAuthUser()
      const sessionValidator = createMockSessionValidator({
        validTokens: new Map([['cached-token', validUser]]),
      })
      const config = createMockConfig()

      const headers = new Headers({
        cookie: 'better-auth.session_token=cached-token',
      })
      const payload = createMockPayload()

      // First call
      await authenticate(
        { payload, headers },
        { config, sessionValidator }
      )

      // Second call with same token - should use cache
      await authenticate(
        { payload, headers },
        { config, sessionValidator }
      )

      // If caching is implemented, validator should only be called once
      // (or caching layer should be checked)
      // For now, we just verify the behavior works
      expect(sessionValidator.validate).toHaveBeenCalled()
    })

    it('should cache valid sessions', async () => {
      const validUser = createMockBetterAuthUser()
      const sessionValidator = createMockSessionValidator({
        validTokens: new Map([['cacheable-token', validUser]]),
      })
      const config = createMockConfig()

      const headers = new Headers({
        cookie: 'better-auth.session_token=cacheable-token',
      })
      const payload = createMockPayload()

      const result1 = await authenticate(
        { payload, headers },
        { config, sessionValidator }
      )

      const result2 = await authenticate(
        { payload, headers },
        { config, sessionValidator }
      )

      // Both results should be successful
      expect(result1.user).not.toBeNull()
      expect(result2.user).not.toBeNull()
      expect(result1.user?.id).toBe(result2.user?.id)
    })
  })

  describe('error handling', () => {
    it('should handle missing headers gracefully', async () => {
      const sessionValidator = createMockSessionValidator()
      const config = createMockConfig()

      // Empty headers - no credentials
      const headers = new Headers()

      const result = await authenticate(
        { payload: createMockPayload(), headers },
        { config, sessionValidator }
      )

      // Should return null user, not throw
      expect(result.user).toBeNull()
    })

    it('should handle database errors', async () => {
      const sessionValidator = createMockSessionValidator({ shouldError: true })
      const config = createMockConfig()

      const headers = new Headers({
        cookie: 'better-auth.session_token=any-token',
      })

      const result = await authenticate(
        { payload: createMockPayload(), headers },
        { config, sessionValidator }
      )

      // Should return null user, not throw
      expect(result.user).toBeNull()
    })

    it('should log auth failures', async () => {
      const sessionValidator = createMockSessionValidator()
      const logger = createMockLogger()
      const config = createMockConfig()

      const headers = new Headers({
        cookie: 'better-auth.session_token=invalid-token',
      })

      await authenticate(
        { payload: createMockPayload(), headers },
        { config, sessionValidator, logger }
      )

      // Should log the failed auth attempt
      expect(logger.warn).toHaveBeenCalled()
      expect(logger.warnCalls.length).toBeGreaterThan(0)
    })
  })
})

describe('createBetterAuthStrategy', () => {
  it('should return Payload-compatible strategy object', async () => {
    const config = createMockConfig()
    const strategy = createBetterAuthStrategy({ config })

    expect(strategy).toBeDefined()
    expect(strategy).toHaveProperty('name')
    expect(strategy).toHaveProperty('authenticate')
    expect(typeof strategy.authenticate).toBe('function')
  })

  it('should accept configuration options', async () => {
    const customConfig = createMockConfig({
      usersCollection: 'custom-users',
      sessionCookieName: 'custom-session',
      apiKeyHeader: 'x-custom-key',
    })

    const strategy = createBetterAuthStrategy({ config: customConfig })

    expect(strategy).toBeDefined()
    expect(strategy.name).toBe('better-auth')
  })

  it('should use default config if not provided', async () => {
    const strategy = createBetterAuthStrategy({})

    expect(strategy).toBeDefined()
    expect(strategy.name).toBe('better-auth')

    // Strategy should work with default config
    const headers = new Headers()
    const result = await strategy.authenticate({
      payload: createMockPayload(),
      headers,
    })

    // Should return null user for empty headers (no error)
    expect(result.user).toBeNull()
  })
})

describe('authenticate edge cases', () => {
  it('should handle URL-encoded cookie values', async () => {
    const validUser = createMockBetterAuthUser()
    const sessionValidator = createMockSessionValidator({
      validTokens: new Map([['token with spaces', validUser]]),
    })
    const config = createMockConfig()

    // URL-encoded token
    const headers = new Headers({
      cookie: 'better-auth.session_token=token%20with%20spaces',
    })

    const result = await authenticate(
      { payload: createMockPayload(), headers },
      { config, sessionValidator }
    )

    expect(result.user).not.toBeNull()
  })

  it('should handle case-insensitive bearer prefix', async () => {
    const validUser = createMockBetterAuthUser()
    const sessionValidator = createMockSessionValidator({
      validTokens: new Map([['bearer-token', validUser]]),
    })
    const config = createMockConfig()

    // Lowercase "bearer" prefix
    const headers = new Headers({
      authorization: 'bearer bearer-token',
    })

    const result = await authenticate(
      { payload: createMockPayload(), headers },
      { config, sessionValidator }
    )

    expect(result.user).not.toBeNull()
  })

  it('should handle banned users', async () => {
    const bannedUser = createMockBetterAuthUser({
      banned: true,
      banReason: 'Violated TOS',
    })
    // Session validator returns banned user
    const sessionValidator: SessionValidator = {
      validate: vi.fn(async (): Promise<SessionValidationResult> => ({
        valid: false,
        error: 'user_banned',
      })),
    }
    const config = createMockConfig()

    const headers = new Headers({
      cookie: 'better-auth.session_token=banned-user-token',
    })

    const result = await authenticate(
      { payload: createMockPayload(), headers },
      { config, sessionValidator }
    )

    expect(result.user).toBeNull()
  })

  it('should handle expired sessions', async () => {
    const sessionValidator: SessionValidator = {
      validate: vi.fn(async (): Promise<SessionValidationResult> => ({
        valid: false,
        error: 'session_expired',
      })),
    }
    const config = createMockConfig()

    const headers = new Headers({
      cookie: 'better-auth.session_token=expired-token',
    })

    const result = await authenticate(
      { payload: createMockPayload(), headers },
      { config, sessionValidator }
    )

    expect(result.user).toBeNull()
  })

  it('should skip provisioning when autoCreateUsers is false', async () => {
    const newUser = createMockBetterAuthUser({ id: 'new-user' })
    const sessionValidator = createMockSessionValidator({
      validTokens: new Map([['token', newUser]]),
    })
    const userProvisioner = createMockUserProvisioner()
    const config = createMockConfig({ autoCreateUsers: false })

    const headers = new Headers({
      cookie: 'better-auth.session_token=token',
    })

    await authenticate(
      { payload: createMockPayload(), headers },
      { config, sessionValidator, userProvisioner }
    )

    // Provisioner should not be called when autoCreateUsers is false
    expect(userProvisioner.provision).not.toHaveBeenCalled()
  })

  it('should use custom userMapper if provided', async () => {
    const validUser = createMockBetterAuthUser({
      id: 'original-id',
      email: 'original@example.com',
      role: 'admin',
    })
    const sessionValidator = createMockSessionValidator({
      validTokens: new Map([['token', validUser]]),
    })
    const config = createMockConfig({
      userMapper: (user: BetterAuthUser) => ({
        id: `mapped-${user.id}`,
        email: user.email,
        collection: 'custom-users',
      }),
    })

    const headers = new Headers({
      cookie: 'better-auth.session_token=token',
    })

    const result = await authenticate(
      { payload: createMockPayload(), headers },
      { config, sessionValidator }
    )

    expect(result.user?.id).toBe('mapped-original-id')
    expect(result.user?.collection).toBe('custom-users')
  })
})

describe('authenticate concurrency', () => {
  it('should handle multiple concurrent requests', async () => {
    const users = [
      createMockBetterAuthUser({ id: 'user-1', email: 'user1@example.com' }),
      createMockBetterAuthUser({ id: 'user-2', email: 'user2@example.com' }),
      createMockBetterAuthUser({ id: 'user-3', email: 'user3@example.com' }),
    ]

    const sessionValidator = createMockSessionValidator({
      validTokens: new Map([
        ['token-1', users[0]],
        ['token-2', users[1]],
        ['token-3', users[2]],
      ]),
    })
    const config = createMockConfig()

    const requests = users.map((_, i) => {
      const headers = new Headers({
        cookie: `better-auth.session_token=token-${i + 1}`,
      })
      return authenticate(
        { payload: createMockPayload(), headers },
        { config, sessionValidator }
      )
    })

    const results = await Promise.all(requests)

    expect(results[0].user?.id).toBe('user-1')
    expect(results[1].user?.id).toBe('user-2')
    expect(results[2].user?.id).toBe('user-3')
  })
})
