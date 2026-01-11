import { describe, it, expect, expectTypeOf } from 'vitest'

/**
 * Auth Bridge Types Tests (GREEN Phase)
 *
 * These tests verify TypeScript types that bridge Better Auth's authentication
 * model to Payload CMS's expected auth interface.
 *
 * Types implemented in db/payload/auth/types.ts:
 * - BetterAuthUser: User from Better Auth sessions table
 * - PayloadUser: User type expected by Payload's authenticate()
 * - AuthBridgeConfig: Configuration for the auth bridge
 * - SessionValidationResult: Result of validating a Better Auth session
 * - ApiKeyValidationResult: Result of validating an API key
 * - BetterAuthToPayloadUser: Mapping function type
 * - RoleMapping: Maps Better Auth roles to Payload access levels
 * - BetterAuthRole: Union type for Better Auth roles
 * - PayloadAccessLevel: Type for Payload access levels
 *
 * Reference: dotdo-46rt - B01 GREEN: Auth bridge types
 */

// ============================================================================
// Import the types under test
// ============================================================================

import type {
  BetterAuthUser,
  PayloadUser,
  AuthBridgeConfig,
  SessionValidationResult,
  ApiKeyValidationResult,
  BetterAuthToPayloadUser,
  RoleMapping,
  PayloadAccessLevel,
  BetterAuthRole,
  SessionData,
  ApiKeyData,
} from '../../auth/types'

// ============================================================================
// BetterAuthUser Type Tests
// ============================================================================

describe('Auth Bridge Types', () => {
  describe('BetterAuthUser type', () => {
    it('should export BetterAuthUser type', () => {
      const user: BetterAuthUser = {
        id: 'user-123',
        name: 'Alice Smith',
        email: 'alice@example.com.ai',
        emailVerified: true,
        role: 'user',
        image: null,
        banned: false,
        banReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expectTypeOf(user).toMatchTypeOf<BetterAuthUser>()
      expect(user.id).toBe('user-123')
    })

    it('should require id, name, and email fields', () => {
      expectTypeOf<BetterAuthUser>().toHaveProperty('id')
      expectTypeOf<BetterAuthUser>().toHaveProperty('name')
      expectTypeOf<BetterAuthUser>().toHaveProperty('email')
    })

    it('should include role field with Better Auth role types', () => {
      const userWithRole: BetterAuthUser = {
        id: 'user-456',
        name: 'Bob',
        email: 'bob@example.com.ai',
        emailVerified: false,
        role: 'admin',
        image: null,
        banned: false,
        banReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expectTypeOf(userWithRole.role).toMatchTypeOf<BetterAuthRole | null>()
      expect(userWithRole.role).toBe('admin')
    })

    it('should include ban-related fields', () => {
      expectTypeOf<BetterAuthUser>().toHaveProperty('banned')
      expectTypeOf<BetterAuthUser>().toHaveProperty('banReason')
    })
  })

  // ============================================================================
  // PayloadUser Type Tests
  // ============================================================================

  describe('PayloadUser type', () => {
    it('should export PayloadUser type', () => {
      const payloadUser: PayloadUser = {
        id: 'user-123',
        email: 'alice@example.com.ai',
        collection: 'users',
      }

      expectTypeOf(payloadUser).toMatchTypeOf<PayloadUser>()
      expect(payloadUser.id).toBe('user-123')
    })

    it('should require id and collection fields', () => {
      expectTypeOf<PayloadUser>().toHaveProperty('id')
      expectTypeOf<PayloadUser>().toHaveProperty('collection')
    })

    it('should have optional email field', () => {
      const serviceUser: PayloadUser = {
        id: 'service-001',
        collection: 'users',
        // email is optional
      }

      expect(serviceUser.email).toBeUndefined()
    })

    it('should allow custom data extension', () => {
      interface ExtendedPayloadUser extends PayloadUser {
        organizationId?: string
        permissions?: string[]
      }

      const extendedUser: ExtendedPayloadUser = {
        id: 'user-789',
        email: 'extended@example.com.ai',
        collection: 'users',
        organizationId: 'org-001',
        permissions: ['read', 'write'],
      }

      expectTypeOf(extendedUser).toMatchTypeOf<PayloadUser>()
      expect(extendedUser.organizationId).toBe('org-001')
    })
  })

  // ============================================================================
  // AuthBridgeConfig Type Tests
  // ============================================================================

  describe('AuthBridgeConfig type', () => {
    it('should export AuthBridgeConfig type', () => {
      const config: AuthBridgeConfig = {
        usersCollection: 'users',
        sessionCookieName: 'better_auth.session_token',
        apiKeyHeader: 'x-api-key',
      }

      expectTypeOf(config).toMatchTypeOf<AuthBridgeConfig>()
      expect(config.usersCollection).toBe('users')
    })

    it('should define usersCollection option', () => {
      expectTypeOf<AuthBridgeConfig>().toHaveProperty('usersCollection')
    })

    it('should define sessionCookieName option', () => {
      expectTypeOf<AuthBridgeConfig>().toHaveProperty('sessionCookieName')
    })

    it('should define apiKeyHeader option', () => {
      expectTypeOf<AuthBridgeConfig>().toHaveProperty('apiKeyHeader')
    })

    it('should optionally define roleMapping', () => {
      const configWithMapping: AuthBridgeConfig = {
        usersCollection: 'users',
        sessionCookieName: 'session',
        apiKeyHeader: 'x-api-key',
        roleMapping: {
          user: 'viewer',
          admin: 'editor',
          owner: 'admin',
        },
      }

      expect(configWithMapping.roleMapping).toBeDefined()
      expect(configWithMapping.roleMapping?.user).toBe('viewer')
    })

    it('should optionally define autoCreateUsers flag', () => {
      const configWithAutoCreate: AuthBridgeConfig = {
        usersCollection: 'users',
        sessionCookieName: 'session',
        apiKeyHeader: 'x-api-key',
        autoCreateUsers: true,
      }

      expect(configWithAutoCreate.autoCreateUsers).toBe(true)
    })

    it('should optionally define userMapper function', () => {
      const configWithMapper: AuthBridgeConfig = {
        usersCollection: 'users',
        sessionCookieName: 'session',
        apiKeyHeader: 'x-api-key',
        userMapper: (user: BetterAuthUser) => ({
          id: user.id,
          email: user.email,
          collection: 'users',
        }),
      }

      expect(configWithMapper.userMapper).toBeDefined()
    })
  })

  // ============================================================================
  // SessionValidationResult Type Tests
  // ============================================================================

  describe('SessionValidationResult type', () => {
    it('should export SessionValidationResult type', () => {
      const successResult: SessionValidationResult = {
        valid: true,
        user: {
          id: 'user-123',
          name: 'Alice',
          email: 'alice@example.com.ai',
          emailVerified: true,
          role: 'user',
          image: null,
          banned: false,
          banReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        session: {
          id: 'session-abc',
          token: 'token-xyz',
          expiresAt: new Date(),
          userId: 'user-123',
        },
      }

      expectTypeOf(successResult).toMatchTypeOf<SessionValidationResult>()
      expect(successResult.valid).toBe(true)
    })

    it('should have valid boolean flag', () => {
      const result: SessionValidationResult = { valid: false, error: 'test' }
      expectTypeOf(result.valid).toBeBoolean()
    })

    it('should include user when valid', () => {
      const validResult: SessionValidationResult = {
        valid: true,
        user: {
          id: 'user-123',
          name: 'Test',
          email: 'test@example.com.ai',
          emailVerified: true,
          role: 'user',
          image: null,
          banned: false,
          banReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        session: {
          id: 'session-abc',
          token: 'token-xyz',
          expiresAt: new Date(),
          userId: 'user-123',
        },
      }

      expect(validResult.user).toBeDefined()
      expect(validResult.user.id).toBe('user-123')
    })

    it('should include session data when valid', () => {
      const validResult: SessionValidationResult = {
        valid: true,
        user: {
          id: 'user-123',
          name: 'Test',
          email: 'test@example.com.ai',
          emailVerified: true,
          role: 'user',
          image: null,
          banned: false,
          banReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        session: {
          id: 'session-abc',
          token: 'token-xyz',
          expiresAt: new Date(),
          userId: 'user-123',
        },
      }

      expectTypeOf(validResult.session).toMatchTypeOf<SessionData>()
      expect(validResult.session.id).toBe('session-abc')
    })

    it('should represent invalid session state', () => {
      const invalidResult: SessionValidationResult = {
        valid: false,
        error: 'Session expired',
      }

      expectTypeOf(invalidResult).toMatchTypeOf<SessionValidationResult>()
      expect(invalidResult.valid).toBe(false)
    })

    it('should include error message when invalid', () => {
      const errorResult: SessionValidationResult = {
        valid: false,
        error: 'Invalid session token',
      }

      expect(errorResult.error).toBe('Invalid session token')
    })
  })

  // ============================================================================
  // ApiKeyValidationResult Type Tests
  // ============================================================================

  describe('ApiKeyValidationResult type', () => {
    it('should export ApiKeyValidationResult type', () => {
      const successResult: ApiKeyValidationResult = {
        valid: true,
        user: {
          id: 'user-123',
          name: 'API User',
          email: 'api@example.com.ai',
          emailVerified: true,
          role: 'user',
          image: null,
          banned: false,
          banReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        apiKey: {
          id: 'key-123',
          name: 'Production Key',
          userId: 'user-123',
          permissions: ['read', 'write'],
          expiresAt: null,
        },
      }

      expectTypeOf(successResult).toMatchTypeOf<ApiKeyValidationResult>()
      expect(successResult.valid).toBe(true)
    })

    it('should have valid boolean flag', () => {
      const result: ApiKeyValidationResult = { valid: false, error: 'test' }
      expectTypeOf(result.valid).toBeBoolean()
    })

    it('should include user when valid', () => {
      const validResult: ApiKeyValidationResult = {
        valid: true,
        user: {
          id: 'user-123',
          name: 'Test',
          email: 'test@example.com.ai',
          emailVerified: true,
          role: 'user',
          image: null,
          banned: false,
          banReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        apiKey: {
          id: 'key-123',
          name: 'Test Key',
          userId: 'user-123',
          permissions: ['read'],
          expiresAt: null,
        },
      }

      expect(validResult.user).toBeDefined()
      expect(validResult.user.id).toBe('user-123')
    })

    it('should include apiKey metadata when valid', () => {
      const result: ApiKeyValidationResult = {
        valid: true,
        user: {
          id: 'user-456',
          name: 'Admin',
          email: 'admin@example.com.ai',
          emailVerified: true,
          role: 'admin',
          image: null,
          banned: false,
          banReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        apiKey: {
          id: 'key-456',
          name: 'Admin Key',
          userId: 'user-456',
          permissions: ['admin'],
          expiresAt: new Date('2025-12-31'),
        },
      }

      expectTypeOf(result.apiKey).toMatchTypeOf<ApiKeyData>()
      expect(result.apiKey.id).toBe('key-456')
      expect(result.apiKey.permissions).toContain('admin')
    })

    it('should represent invalid API key state', () => {
      const invalidResult: ApiKeyValidationResult = {
        valid: false,
        error: 'API key revoked',
      }

      expectTypeOf(invalidResult).toMatchTypeOf<ApiKeyValidationResult>()
      expect(invalidResult.valid).toBe(false)
    })

    it('should support rate limit exceeded error', () => {
      const rateLimitedResult: ApiKeyValidationResult = {
        valid: false,
        error: 'Rate limit exceeded',
        retryAfter: 60,
      }

      expect(rateLimitedResult.retryAfter).toBe(60)
    })
  })

  // ============================================================================
  // BetterAuthToPayloadUser Mapping Type Tests
  // ============================================================================

  describe('BetterAuthToPayloadUser mapping', () => {
    it('should define BetterAuthToPayloadUser mapping type', () => {
      const mapper: BetterAuthToPayloadUser = (user: BetterAuthUser) => ({
        id: user.id,
        email: user.email,
        collection: 'users',
      })

      const betterAuthUser: BetterAuthUser = {
        id: 'user-map-123',
        name: 'Mapper Test',
        email: 'mapper@example.com.ai',
        emailVerified: true,
        role: 'user',
        image: null,
        banned: false,
        banReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const payloadUser = mapper(betterAuthUser)

      expectTypeOf(mapper).toMatchTypeOf<BetterAuthToPayloadUser>()
      expect(payloadUser.id).toBe('user-map-123')
    })

    it('should accept BetterAuthUser as input', () => {
      const mapper: BetterAuthToPayloadUser = (user) => ({
        id: user.id,
        email: user.email,
        collection: 'users',
      })
      expectTypeOf(mapper).parameter(0).toMatchTypeOf<BetterAuthUser>()
    })

    it('should return PayloadUser as output', () => {
      const mapper: BetterAuthToPayloadUser = (user) => ({
        id: user.id,
        email: user.email,
        collection: 'users',
      })
      expectTypeOf(mapper).returns.toMatchTypeOf<PayloadUser>()
    })

    it('should optionally accept config as second parameter', () => {
      const mapperWithConfig: BetterAuthToPayloadUser = (user, config) => ({
        id: user.id,
        email: user.email,
        collection: config?.usersCollection ?? 'users',
      })

      const user: BetterAuthUser = {
        id: 'user-config-123',
        name: 'Config Test',
        email: 'config@example.com.ai',
        emailVerified: true,
        role: 'user',
        image: null,
        banned: false,
        banReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const config: AuthBridgeConfig = {
        usersCollection: 'members',
        sessionCookieName: 'session',
        apiKeyHeader: 'x-api-key',
      }

      const result = mapperWithConfig(user, config)
      expect(result.collection).toBe('members')
    })
  })

  // ============================================================================
  // RoleMapping Type Tests
  // ============================================================================

  describe('RoleMapping type', () => {
    it('should define RoleMapping type', () => {
      const roleMapping: RoleMapping = {
        user: 'viewer',
        admin: 'editor',
        owner: 'admin',
      }

      expectTypeOf(roleMapping).toMatchTypeOf<RoleMapping>()
      expect(roleMapping.user).toBe('viewer')
    })

    it('should map "user" role', () => {
      const mapping: RoleMapping = { user: 'viewer', admin: 'editor', owner: 'admin' }
      expectTypeOf(mapping.user).toMatchTypeOf<PayloadAccessLevel>()
      expect(mapping.user).toBe('viewer')
    })

    it('should map "admin" role', () => {
      const mapping: RoleMapping = { user: 'viewer', admin: 'editor', owner: 'admin' }
      expectTypeOf(mapping.admin).toMatchTypeOf<PayloadAccessLevel>()
      expect(mapping.admin).toBe('editor')
    })

    it('should map "owner" role', () => {
      const mapping: RoleMapping = { user: 'viewer', admin: 'editor', owner: 'admin' }
      expectTypeOf(mapping.owner).toMatchTypeOf<PayloadAccessLevel>()
      expect(mapping.owner).toBe('admin')
    })

    it('should support custom Payload access levels', () => {
      const customMapping: RoleMapping = {
        user: 'reader',
        admin: 'contributor',
        owner: 'superadmin',
      }

      expect(customMapping.owner).toBe('superadmin')
    })

    it('should be indexable by BetterAuthRole', () => {
      const mapping: RoleMapping = { user: 'viewer', admin: 'editor', owner: 'admin' }
      const role: BetterAuthRole = 'admin'
      const accessLevel = mapping[role]

      expect(accessLevel).toBe('editor')
    })
  })

  // ============================================================================
  // BetterAuthRole Type Tests
  // ============================================================================

  describe('BetterAuthRole type', () => {
    it('should be union of "user" | "admin" | "owner"', () => {
      const userRole: BetterAuthRole = 'user'
      const adminRole: BetterAuthRole = 'admin'
      const ownerRole: BetterAuthRole = 'owner'

      expect(userRole).toBe('user')
      expect(adminRole).toBe('admin')
      expect(ownerRole).toBe('owner')

      // Type-level assertion that BetterAuthRole is a union of string literals
      expectTypeOf<BetterAuthRole>().toMatchTypeOf<'user' | 'admin' | 'owner'>()
    })
  })

  // ============================================================================
  // PayloadAccessLevel Type Tests
  // ============================================================================

  describe('PayloadAccessLevel type', () => {
    it('should accept standard access levels', () => {
      const viewer: PayloadAccessLevel = 'viewer'
      const editor: PayloadAccessLevel = 'editor'
      const admin: PayloadAccessLevel = 'admin'

      expect(viewer).toBe('viewer')
      expect(editor).toBe('editor')
      expect(admin).toBe('admin')
    })

    it('should be a string type for custom levels', () => {
      const customLevel: PayloadAccessLevel = 'custom-level'
      expectTypeOf(customLevel).toMatchTypeOf<string>()
      expect(customLevel).toBe('custom-level')
    })
  })

  // ============================================================================
  // Type Compatibility Tests
  // ============================================================================

  describe('Type Compatibility', () => {
    it('should allow PayloadUser in Payload authenticate context', () => {
      type PayloadAuthenticate = (args: { req: Request }) => Promise<PayloadUser | null>

      const authenticate: PayloadAuthenticate = async () => ({
        id: 'user-123',
        email: 'auth@example.com.ai',
        collection: 'users',
      })

      expectTypeOf(authenticate).toMatchTypeOf<PayloadAuthenticate>()
    })

    it('should allow SessionValidationResult in middleware context', () => {
      type SessionMiddleware = (token: string) => Promise<SessionValidationResult>

      const validateSession: SessionMiddleware = async (token) => {
        if (token.length === 0) {
          return { valid: false, error: 'Empty token' }
        }
        return {
          valid: true,
          user: {
            id: 'user-123',
            name: 'Test',
            email: 'test@example.com.ai',
            emailVerified: true,
            role: 'user',
            image: null,
            banned: false,
            banReason: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          session: {
            id: 'session-123',
            token,
            expiresAt: new Date(),
            userId: 'user-123',
          },
        }
      }

      expectTypeOf(validateSession).toMatchTypeOf<SessionMiddleware>()
    })

    it('should allow ApiKeyValidationResult in API context', () => {
      type ApiKeyValidator = (key: string) => Promise<ApiKeyValidationResult>

      const validateApiKey: ApiKeyValidator = async (key) => {
        if (!key.startsWith('dotdo_')) {
          return { valid: false, error: 'Invalid key prefix' }
        }
        return {
          valid: true,
          user: {
            id: 'user-123',
            name: 'API User',
            email: 'api@example.com.ai',
            emailVerified: true,
            role: 'user',
            image: null,
            banned: false,
            banReason: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          apiKey: {
            id: 'key-123',
            name: 'Test Key',
            userId: 'user-123',
            permissions: ['read'],
            expiresAt: null,
          },
        }
      }

      expectTypeOf(validateApiKey).toMatchTypeOf<ApiKeyValidator>()
    })
  })
})
