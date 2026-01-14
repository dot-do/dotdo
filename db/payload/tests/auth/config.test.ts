/**
 * Strategy Configuration Tests (RED Phase)
 *
 * These tests define the contract for strategy configuration validation
 * and merging. Configuration should be validated and merged with sensible
 * defaults before being used by the authentication strategy.
 *
 * Reference: dotdo-1vk6 - B20 RED: Strategy config tests
 */

import { describe, it, expect, vi } from 'vitest'
import type {
  BetterAuthUser,
  AuthBridgeConfig,
  RoleMapping,
  PayloadUser,
} from '../../auth/types'

// ============================================================================
// Placeholder imports (to be implemented)
// ============================================================================

// These will fail until the implementation is created
import {
  validateStrategyConfig,
  mergeStrategyConfig,
  validateAuthBridgeConfig,
  getDefaultConfig,
  type StrategyConfigValidationResult,
  type StrategyConfigValidationError,
} from '../../auth/config'

// ============================================================================
// Mock helpers
// ============================================================================

function createMockRoleMapping(overrides: Partial<RoleMapping> = {}): RoleMapping {
  return {
    user: 'viewer',
    admin: 'editor',
    owner: 'admin',
    ...overrides,
  }
}

function createMockAuthBridgeConfig(overrides: Partial<AuthBridgeConfig> = {}): AuthBridgeConfig {
  return {
    usersCollection: 'users',
    sessionCookieName: 'better-auth.session_token',
    apiKeyHeader: 'x-api-key',
    autoCreateUsers: true,
    ...overrides,
  }
}

function createMockUserMapper(): (user: BetterAuthUser, config?: AuthBridgeConfig) => PayloadUser {
  return (user: BetterAuthUser, config?: AuthBridgeConfig) => ({
    id: user.id,
    email: user.email,
    collection: config?.usersCollection ?? 'users',
  })
}

// ============================================================================
// Tests: Default Configuration
// ============================================================================

describe('Strategy Configuration', () => {
  describe('getDefaultConfig', () => {
    it('should return default AuthBridgeConfig values', () => {
      const defaults = getDefaultConfig()

      expect(defaults.usersCollection).toBe('users')
      expect(defaults.sessionCookieName).toBe('better-auth.session_token')
      expect(defaults.apiKeyHeader).toBe('x-api-key')
      expect(defaults.autoCreateUsers).toBe(true)
    })

    it('should not include optional fields in defaults', () => {
      const defaults = getDefaultConfig()

      // Optional fields should be undefined, not null
      expect(defaults.roleMapping).toBeUndefined()
      expect(defaults.userMapper).toBeUndefined()
    })

    it('should return a new object each time (not shared reference)', () => {
      const defaults1 = getDefaultConfig()
      const defaults2 = getDefaultConfig()

      expect(defaults1).not.toBe(defaults2)
      expect(defaults1).toEqual(defaults2)

      // Mutations should not affect other instances
      defaults1.usersCollection = 'modified'
      expect(defaults2.usersCollection).toBe('users')
    })
  })

  // ============================================================================
  // Tests: Configuration Validation
  // ============================================================================

  describe('validateAuthBridgeConfig', () => {
    describe('usersCollection validation', () => {
      it('should accept valid collection name', () => {
        const config = createMockAuthBridgeConfig({ usersCollection: 'members' })
        const result = validateAuthBridgeConfig(config)

        expect(result.valid).toBe(true)
      })

      it('should reject empty string collection name', () => {
        const config = createMockAuthBridgeConfig({ usersCollection: '' })
        const result = validateAuthBridgeConfig(config)

        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.errors).toContainEqual(
            expect.objectContaining({
              field: 'usersCollection',
              message: expect.stringContaining('empty'),
            })
          )
        }
      })

      it('should reject collection name with invalid characters', () => {
        const config = createMockAuthBridgeConfig({ usersCollection: 'users/admins' })
        const result = validateAuthBridgeConfig(config)

        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.errors).toContainEqual(
            expect.objectContaining({
              field: 'usersCollection',
              message: expect.stringContaining('invalid character'),
            })
          )
        }
      })

      it('should accept collection name with hyphens and underscores', () => {
        const config = createMockAuthBridgeConfig({ usersCollection: 'payload-users_v2' })
        const result = validateAuthBridgeConfig(config)

        expect(result.valid).toBe(true)
      })
    })

    describe('sessionCookieName validation', () => {
      it('should accept valid cookie name', () => {
        const config = createMockAuthBridgeConfig({
          sessionCookieName: 'custom-session-token',
        })
        const result = validateAuthBridgeConfig(config)

        expect(result.valid).toBe(true)
      })

      it('should reject empty string cookie name', () => {
        const config = createMockAuthBridgeConfig({ sessionCookieName: '' })
        const result = validateAuthBridgeConfig(config)

        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.errors).toContainEqual(
            expect.objectContaining({
              field: 'sessionCookieName',
              message: expect.stringContaining('empty'),
            })
          )
        }
      })

      it('should accept cookie name with dots', () => {
        const config = createMockAuthBridgeConfig({
          sessionCookieName: 'better-auth.session_token',
        })
        const result = validateAuthBridgeConfig(config)

        expect(result.valid).toBe(true)
      })
    })

    describe('apiKeyHeader validation', () => {
      it('should accept valid header name', () => {
        const config = createMockAuthBridgeConfig({ apiKeyHeader: 'X-Custom-Api-Key' })
        const result = validateAuthBridgeConfig(config)

        expect(result.valid).toBe(true)
      })

      it('should reject empty string header name', () => {
        const config = createMockAuthBridgeConfig({ apiKeyHeader: '' })
        const result = validateAuthBridgeConfig(config)

        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.errors).toContainEqual(
            expect.objectContaining({
              field: 'apiKeyHeader',
              message: expect.stringContaining('empty'),
            })
          )
        }
      })

      it('should accept header names with hyphens', () => {
        const config = createMockAuthBridgeConfig({ apiKeyHeader: 'x-api-key-v2' })
        const result = validateAuthBridgeConfig(config)

        expect(result.valid).toBe(true)
      })
    })

    describe('roleMapping validation', () => {
      it('should accept valid role mapping', () => {
        const config = createMockAuthBridgeConfig({
          roleMapping: createMockRoleMapping(),
        })
        const result = validateAuthBridgeConfig(config)

        expect(result.valid).toBe(true)
      })

      it('should accept custom access levels', () => {
        const config = createMockAuthBridgeConfig({
          roleMapping: {
            user: 'custom-viewer',
            admin: 'custom-editor',
            owner: 'super-admin',
          },
        })
        const result = validateAuthBridgeConfig(config)

        expect(result.valid).toBe(true)
      })

      it('should reject empty access level strings', () => {
        const config = createMockAuthBridgeConfig({
          roleMapping: {
            user: '',
            admin: 'editor',
            owner: 'admin',
          },
        })
        const result = validateAuthBridgeConfig(config)

        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.errors).toContainEqual(
            expect.objectContaining({
              field: 'roleMapping.user',
              message: expect.stringContaining('empty'),
            })
          )
        }
      })

      it('should accept undefined roleMapping (optional)', () => {
        const config = createMockAuthBridgeConfig()
        delete (config as Record<string, unknown>).roleMapping
        const result = validateAuthBridgeConfig(config)

        expect(result.valid).toBe(true)
      })
    })

    describe('userMapper validation', () => {
      it('should accept valid userMapper function', () => {
        const config = createMockAuthBridgeConfig({
          userMapper: createMockUserMapper(),
        })
        const result = validateAuthBridgeConfig(config)

        expect(result.valid).toBe(true)
      })

      it('should accept undefined userMapper (optional)', () => {
        const config = createMockAuthBridgeConfig()
        const result = validateAuthBridgeConfig(config)

        expect(result.valid).toBe(true)
      })

      it('should reject non-function userMapper', () => {
        const config = createMockAuthBridgeConfig({
          userMapper: 'not-a-function' as unknown as (
            user: BetterAuthUser,
            config?: AuthBridgeConfig
          ) => PayloadUser,
        })
        const result = validateAuthBridgeConfig(config)

        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.errors).toContainEqual(
            expect.objectContaining({
              field: 'userMapper',
              message: expect.stringContaining('function'),
            })
          )
        }
      })
    })

    describe('autoCreateUsers validation', () => {
      it('should accept true', () => {
        const config = createMockAuthBridgeConfig({ autoCreateUsers: true })
        const result = validateAuthBridgeConfig(config)

        expect(result.valid).toBe(true)
      })

      it('should accept false', () => {
        const config = createMockAuthBridgeConfig({ autoCreateUsers: false })
        const result = validateAuthBridgeConfig(config)

        expect(result.valid).toBe(true)
      })

      it('should accept undefined (defaults to true)', () => {
        const config = createMockAuthBridgeConfig()
        delete (config as Record<string, unknown>).autoCreateUsers
        const result = validateAuthBridgeConfig(config)

        expect(result.valid).toBe(true)
      })
    })

    describe('multiple validation errors', () => {
      it('should collect all validation errors', () => {
        const config = createMockAuthBridgeConfig({
          usersCollection: '',
          sessionCookieName: '',
          apiKeyHeader: '',
        })
        const result = validateAuthBridgeConfig(config)

        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.errors.length).toBeGreaterThanOrEqual(3)
        }
      })
    })
  })

  describe('validateStrategyConfig', () => {
    it('should accept empty config (uses defaults)', () => {
      const result = validateStrategyConfig({})

      expect(result.valid).toBe(true)
    })

    it('should accept config with only AuthBridgeConfig', () => {
      const result = validateStrategyConfig({
        config: createMockAuthBridgeConfig(),
      })

      expect(result.valid).toBe(true)
    })

    it('should accept config with sessionValidator', () => {
      const result = validateStrategyConfig({
        sessionValidator: {
          validate: vi.fn(),
        },
      })

      expect(result.valid).toBe(true)
    })

    it('should accept config with apiKeyValidator', () => {
      const result = validateStrategyConfig({
        apiKeyValidator: {
          validate: vi.fn(),
        },
      })

      expect(result.valid).toBe(true)
    })

    it('should accept config with userProvisioner', () => {
      const result = validateStrategyConfig({
        userProvisioner: {
          provision: vi.fn(),
        },
      })

      expect(result.valid).toBe(true)
    })

    it('should accept config with logger', () => {
      const result = validateStrategyConfig({
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      })

      expect(result.valid).toBe(true)
    })

    it('should reject invalid sessionValidator shape', () => {
      const result = validateStrategyConfig({
        sessionValidator: {
          // Missing validate method
        } as { validate: (token: string) => Promise<unknown> },
      })

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'sessionValidator',
            message: expect.stringContaining('validate'),
          })
        )
      }
    })

    it('should reject invalid apiKeyValidator shape', () => {
      const result = validateStrategyConfig({
        apiKeyValidator: {
          // Missing validate method
        } as { validate: (key: string) => Promise<unknown> },
      })

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'apiKeyValidator',
            message: expect.stringContaining('validate'),
          })
        )
      }
    })

    it('should reject invalid userProvisioner shape', () => {
      const result = validateStrategyConfig({
        userProvisioner: {
          // Missing provision method
        } as { provision: (user: BetterAuthUser, config: AuthBridgeConfig) => Promise<PayloadUser> },
      })

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'userProvisioner',
            message: expect.stringContaining('provision'),
          })
        )
      }
    })

    it('should reject invalid logger shape', () => {
      const result = validateStrategyConfig({
        logger: {
          info: vi.fn(),
          // Missing warn and error
        } as { info: () => void; warn: () => void; error: () => void },
      })

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'logger',
            message: expect.stringMatching(/warn|error/),
          })
        )
      }
    })
  })

  // ============================================================================
  // Tests: Configuration Merging
  // ============================================================================

  describe('mergeStrategyConfig', () => {
    it('should return defaults when no config provided', () => {
      const merged = mergeStrategyConfig({})

      expect(merged.config).toBeDefined()
      expect(merged.config?.usersCollection).toBe('users')
      expect(merged.config?.sessionCookieName).toBe('better-auth.session_token')
      expect(merged.config?.apiKeyHeader).toBe('x-api-key')
      expect(merged.config?.autoCreateUsers).toBe(true)
    })

    it('should override defaults with provided values', () => {
      const merged = mergeStrategyConfig({
        config: {
          usersCollection: 'members',
          sessionCookieName: 'custom-session',
          apiKeyHeader: 'x-custom-key',
          autoCreateUsers: false,
        },
      })

      expect(merged.config?.usersCollection).toBe('members')
      expect(merged.config?.sessionCookieName).toBe('custom-session')
      expect(merged.config?.apiKeyHeader).toBe('x-custom-key')
      expect(merged.config?.autoCreateUsers).toBe(false)
    })

    it('should merge partial config with defaults', () => {
      const merged = mergeStrategyConfig({
        config: {
          usersCollection: 'custom-users',
          // Other fields should use defaults
        } as AuthBridgeConfig,
      })

      expect(merged.config?.usersCollection).toBe('custom-users')
      expect(merged.config?.sessionCookieName).toBe('better-auth.session_token')
      expect(merged.config?.apiKeyHeader).toBe('x-api-key')
      expect(merged.config?.autoCreateUsers).toBe(true)
    })

    it('should preserve validators from input', () => {
      const sessionValidator = { validate: vi.fn() }
      const apiKeyValidator = { validate: vi.fn() }
      const userProvisioner = { provision: vi.fn() }
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

      const merged = mergeStrategyConfig({
        sessionValidator,
        apiKeyValidator,
        userProvisioner,
        logger,
      })

      expect(merged.sessionValidator).toBe(sessionValidator)
      expect(merged.apiKeyValidator).toBe(apiKeyValidator)
      expect(merged.userProvisioner).toBe(userProvisioner)
      expect(merged.logger).toBe(logger)
    })

    it('should preserve roleMapping from input', () => {
      const roleMapping = createMockRoleMapping({
        user: 'custom-viewer',
        admin: 'custom-editor',
      })

      const merged = mergeStrategyConfig({
        config: {
          usersCollection: 'users',
          sessionCookieName: 'session',
          apiKeyHeader: 'x-api-key',
          roleMapping,
        },
      })

      expect(merged.config?.roleMapping).toBe(roleMapping)
    })

    it('should preserve userMapper from input', () => {
      const userMapper = createMockUserMapper()

      const merged = mergeStrategyConfig({
        config: {
          usersCollection: 'users',
          sessionCookieName: 'session',
          apiKeyHeader: 'x-api-key',
          userMapper,
        },
      })

      expect(merged.config?.userMapper).toBe(userMapper)
    })

    it('should not mutate input config', () => {
      const inputConfig = createMockAuthBridgeConfig({
        usersCollection: 'original',
      })
      const originalCollection = inputConfig.usersCollection

      mergeStrategyConfig({ config: inputConfig })

      expect(inputConfig.usersCollection).toBe(originalCollection)
    })

    it('should return new object reference', () => {
      const input = { config: createMockAuthBridgeConfig() }
      const merged = mergeStrategyConfig(input)

      expect(merged).not.toBe(input)
      expect(merged.config).not.toBe(input.config)
    })
  })

  // ============================================================================
  // Tests: Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('should handle null config gracefully', () => {
      const result = validateStrategyConfig({ config: null as unknown as AuthBridgeConfig })

      // Should either accept null (use defaults) or provide clear error
      expect(result).toBeDefined()
    })

    it('should handle undefined fields in partial config', () => {
      const merged = mergeStrategyConfig({
        config: {
          usersCollection: undefined as unknown as string,
          sessionCookieName: 'session',
          apiKeyHeader: 'x-api-key',
        },
      })

      // Should use default when field is explicitly undefined
      expect(merged.config?.usersCollection).toBe('users')
    })

    it('should reject extremely long collection names', () => {
      const config = createMockAuthBridgeConfig({
        usersCollection: 'a'.repeat(256),
      })
      const result = validateAuthBridgeConfig(config)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'usersCollection',
            message: expect.stringMatching(/length|long/i),
          })
        )
      }
    })

    it('should reject collection names starting with underscore', () => {
      const config = createMockAuthBridgeConfig({
        usersCollection: '_internal',
      })
      const result = validateAuthBridgeConfig(config)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'usersCollection',
            message: expect.stringMatching(/underscore|reserved/i),
          })
        )
      }
    })

    it('should accept collection names starting with letter', () => {
      const config = createMockAuthBridgeConfig({
        usersCollection: 'Users',
      })
      const result = validateAuthBridgeConfig(config)

      expect(result.valid).toBe(true)
    })
  })

  // ============================================================================
  // Tests: Integration with Strategy
  // ============================================================================

  describe('integration with strategy', () => {
    it('should produce config compatible with authenticate()', () => {
      const merged = mergeStrategyConfig({
        config: createMockAuthBridgeConfig(),
      })

      // Verify the shape matches what authenticate() expects
      expect(merged).toHaveProperty('config')
      expect(merged.config).toHaveProperty('usersCollection')
      expect(merged.config).toHaveProperty('sessionCookieName')
      expect(merged.config).toHaveProperty('apiKeyHeader')
    })

    it('should produce config compatible with createBetterAuthStrategy()', () => {
      const merged = mergeStrategyConfig({
        config: createMockAuthBridgeConfig(),
        sessionValidator: { validate: vi.fn() },
      })

      // Verify the shape matches StrategyConfig type
      expect(merged).toHaveProperty('config')
      expect(merged).toHaveProperty('sessionValidator')
    })
  })
})

// ============================================================================
// Tests: Validation Result Type
// ============================================================================

describe('StrategyConfigValidationResult', () => {
  it('should have valid discriminated union for success', () => {
    const result: StrategyConfigValidationResult = {
      valid: true,
    }

    expect(result.valid).toBe(true)
  })

  it('should have valid discriminated union for failure', () => {
    const result: StrategyConfigValidationResult = {
      valid: false,
      errors: [
        { field: 'usersCollection', message: 'cannot be empty' },
      ],
    }

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
  })
})

describe('StrategyConfigValidationError', () => {
  it('should have field and message properties', () => {
    const error: StrategyConfigValidationError = {
      field: 'sessionCookieName',
      message: 'Invalid cookie name format',
    }

    expect(error.field).toBe('sessionCookieName')
    expect(error.message).toBe('Invalid cookie name format')
  })

  it('should support nested field paths', () => {
    const error: StrategyConfigValidationError = {
      field: 'roleMapping.user',
      message: 'Access level cannot be empty',
    }

    expect(error.field).toBe('roleMapping.user')
  })
})
