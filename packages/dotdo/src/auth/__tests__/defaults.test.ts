/**
 * Auth Defaults Tests (RED phase - TDD)
 *
 * These tests define the contract for default authentication configuration.
 * Tests are expected to FAIL until the implementation is created.
 *
 * The default auth system provides:
 * - DEFAULT_AUTH_CONFIG constant with secure defaults for all methods
 * - mergeAuthConfig() to merge user config with defaults
 * - matchAuthPattern() to match wildcards like 'bashx.*'
 * - getMethodAuth() to retrieve auth requirements for a specific method
 * - Visibility levels: public, user, admin, system
 *
 * ## Expected Interface
 *
 * ```typescript
 * interface MethodAuthConfig {
 *   public?: boolean           // No auth required
 *   requireAuth?: boolean      // Any authenticated user
 *   roles?: Role[]             // Specific roles required
 *   permissions?: string[]     // Specific permissions required
 *   audit?: 'none' | 'basic' | 'full'  // Audit level
 * }
 *
 * type Role = 'public' | 'user' | 'admin' | 'system'
 *
 * type AuthConfig = Record<string, MethodAuthConfig>
 *
 * const DEFAULT_AUTH_CONFIG: AuthConfig
 * function mergeAuthConfig(custom: Partial<AuthConfig>): AuthConfig
 * function matchAuthPattern(method: string, pattern: string): boolean
 * function getMethodAuth(method: string, config?: AuthConfig): MethodAuthConfig
 * ```
 *
 * @see packages/dotdo/src/auth/defaults.ts (implementation to be created)
 * @see docs/plans/2026-01-10-do-dashboard-design.md (design reference)
 */

import { describe, it, expect } from 'vitest'

// Import the module under test (will fail until implemented)
import {
  DEFAULT_AUTH_CONFIG,
  mergeAuthConfig,
  matchAuthPattern,
  getMethodAuth,
  type MethodAuthConfig,
  type Role,
  type AuthConfig,
} from '../defaults'

// =============================================================================
// DEFAULT_AUTH_CONFIG Tests
// =============================================================================

describe('DEFAULT_AUTH_CONFIG', () => {
  describe('constant existence and structure', () => {
    it('exports DEFAULT_AUTH_CONFIG constant', () => {
      expect(DEFAULT_AUTH_CONFIG).toBeDefined()
      expect(typeof DEFAULT_AUTH_CONFIG).toBe('object')
    })

    it('is immutable (frozen)', () => {
      expect(Object.isFrozen(DEFAULT_AUTH_CONFIG)).toBe(true)
    })
  })

  describe('system endpoints', () => {
    it('$introspect requires authentication', () => {
      expect(DEFAULT_AUTH_CONFIG['$introspect']).toBeDefined()
      expect(DEFAULT_AUTH_CONFIG['$introspect'].requireAuth).toBe(true)
    })

    it('$health is public', () => {
      expect(DEFAULT_AUTH_CONFIG['$health']).toBeDefined()
      expect(DEFAULT_AUTH_CONFIG['$health'].public).toBe(true)
    })

    it('$version is public', () => {
      expect(DEFAULT_AUTH_CONFIG['$version']).toBeDefined()
      expect(DEFAULT_AUTH_CONFIG['$version'].public).toBe(true)
    })

    it('$metrics requires admin role', () => {
      expect(DEFAULT_AUTH_CONFIG['$metrics']).toBeDefined()
      expect(DEFAULT_AUTH_CONFIG['$metrics'].roles).toContain('admin')
    })
  })

  describe('things endpoints', () => {
    it('things.list requires authentication', () => {
      expect(DEFAULT_AUTH_CONFIG['things.list']).toBeDefined()
      expect(DEFAULT_AUTH_CONFIG['things.list'].requireAuth).toBe(true)
    })

    it('things.get requires authentication', () => {
      expect(DEFAULT_AUTH_CONFIG['things.get']).toBeDefined()
      expect(DEFAULT_AUTH_CONFIG['things.get'].requireAuth).toBe(true)
    })

    it('things.create requires authentication and write permission', () => {
      expect(DEFAULT_AUTH_CONFIG['things.create']).toBeDefined()
      expect(DEFAULT_AUTH_CONFIG['things.create'].requireAuth).toBe(true)
      expect(DEFAULT_AUTH_CONFIG['things.create'].permissions).toContain('write')
    })

    it('things.update requires authentication and write permission', () => {
      expect(DEFAULT_AUTH_CONFIG['things.update']).toBeDefined()
      expect(DEFAULT_AUTH_CONFIG['things.update'].requireAuth).toBe(true)
      expect(DEFAULT_AUTH_CONFIG['things.update'].permissions).toContain('write')
    })

    it('things.delete requires admin role and full audit', () => {
      expect(DEFAULT_AUTH_CONFIG['things.delete']).toBeDefined()
      expect(DEFAULT_AUTH_CONFIG['things.delete'].roles).toContain('admin')
      expect(DEFAULT_AUTH_CONFIG['things.delete'].audit).toBe('full')
    })
  })

  describe('actions and events (admin only)', () => {
    it('actions.* requires admin role', () => {
      expect(DEFAULT_AUTH_CONFIG['actions.*']).toBeDefined()
      expect(DEFAULT_AUTH_CONFIG['actions.*'].roles).toContain('admin')
    })

    it('events.* requires admin role', () => {
      expect(DEFAULT_AUTH_CONFIG['events.*']).toBeDefined()
      expect(DEFAULT_AUTH_CONFIG['events.*'].roles).toContain('admin')
    })
  })

  describe('storage endpoints', () => {
    it('fsx.* requires authentication', () => {
      expect(DEFAULT_AUTH_CONFIG['fsx.*']).toBeDefined()
      expect(DEFAULT_AUTH_CONFIG['fsx.*'].requireAuth).toBe(true)
    })

    it('gitx.* requires authentication', () => {
      expect(DEFAULT_AUTH_CONFIG['gitx.*']).toBeDefined()
      expect(DEFAULT_AUTH_CONFIG['gitx.*'].requireAuth).toBe(true)
    })

    it('bashx.* requires admin role and full audit', () => {
      expect(DEFAULT_AUTH_CONFIG['bashx.*']).toBeDefined()
      expect(DEFAULT_AUTH_CONFIG['bashx.*'].roles).toContain('admin')
      expect(DEFAULT_AUTH_CONFIG['bashx.*'].audit).toBe('full')
    })

    it('r2.* requires admin role', () => {
      expect(DEFAULT_AUTH_CONFIG['r2.*']).toBeDefined()
      expect(DEFAULT_AUTH_CONFIG['r2.*'].roles).toContain('admin')
    })

    it('sql.* requires admin role', () => {
      expect(DEFAULT_AUTH_CONFIG['sql.*']).toBeDefined()
      expect(DEFAULT_AUTH_CONFIG['sql.*'].roles).toContain('admin')
    })
  })

  describe('platform endpoints', () => {
    it('users.me requires authentication', () => {
      expect(DEFAULT_AUTH_CONFIG['users.me']).toBeDefined()
      expect(DEFAULT_AUTH_CONFIG['users.me'].requireAuth).toBe(true)
    })

    it('users.* requires admin role', () => {
      expect(DEFAULT_AUTH_CONFIG['users.*']).toBeDefined()
      expect(DEFAULT_AUTH_CONFIG['users.*'].roles).toContain('admin')
    })

    it('orgs.* requires admin role', () => {
      expect(DEFAULT_AUTH_CONFIG['orgs.*']).toBeDefined()
      expect(DEFAULT_AUTH_CONFIG['orgs.*'].roles).toContain('admin')
    })
  })

  describe('system internals', () => {
    it('dlq.* requires system role', () => {
      expect(DEFAULT_AUTH_CONFIG['dlq.*']).toBeDefined()
      expect(DEFAULT_AUTH_CONFIG['dlq.*'].roles).toContain('system')
    })

    it('objects.* requires system role', () => {
      expect(DEFAULT_AUTH_CONFIG['objects.*']).toBeDefined()
      expect(DEFAULT_AUTH_CONFIG['objects.*'].roles).toContain('system')
    })
  })
})

// =============================================================================
// mergeAuthConfig Tests
// =============================================================================

describe('mergeAuthConfig', () => {
  it('exports mergeAuthConfig function', () => {
    expect(mergeAuthConfig).toBeDefined()
    expect(typeof mergeAuthConfig).toBe('function')
  })

  it('returns defaults when no custom config provided', () => {
    const result = mergeAuthConfig({})
    expect(result).toEqual(DEFAULT_AUTH_CONFIG)
  })

  it('merges custom config with defaults', () => {
    const custom: Partial<AuthConfig> = {
      'custom.endpoint': { requireAuth: true },
    }

    const result = mergeAuthConfig(custom)

    // Should have default entries
    expect(result['$health']).toBeDefined()
    expect(result['$health'].public).toBe(true)

    // Should have custom entry
    expect(result['custom.endpoint']).toBeDefined()
    expect(result['custom.endpoint'].requireAuth).toBe(true)
  })

  it('overrides defaults with custom config', () => {
    const custom: Partial<AuthConfig> = {
      '$health': { requireAuth: true, public: false },
    }

    const result = mergeAuthConfig(custom)

    // Custom should override default
    expect(result['$health'].public).toBe(false)
    expect(result['$health'].requireAuth).toBe(true)
  })

  it('preserves unspecified default properties when overriding', () => {
    const custom: Partial<AuthConfig> = {
      'things.delete': { roles: ['admin', 'superuser'] },
    }

    const result = mergeAuthConfig(custom)

    // Roles should be overridden
    expect(result['things.delete'].roles).toContain('superuser')

    // Audit should be preserved from default
    expect(result['things.delete'].audit).toBe('full')
  })

  it('does not mutate original configs', () => {
    const custom: Partial<AuthConfig> = {
      'new.endpoint': { public: true },
    }

    const originalDefault = { ...DEFAULT_AUTH_CONFIG }
    const originalCustom = { ...custom }

    mergeAuthConfig(custom)

    expect(DEFAULT_AUTH_CONFIG).toEqual(originalDefault)
    expect(custom).toEqual(originalCustom)
  })

  it('returns frozen object', () => {
    const result = mergeAuthConfig({ 'test.endpoint': { public: true } })
    expect(Object.isFrozen(result)).toBe(true)
  })
})

// =============================================================================
// matchAuthPattern Tests
// =============================================================================

describe('matchAuthPattern', () => {
  it('exports matchAuthPattern function', () => {
    expect(matchAuthPattern).toBeDefined()
    expect(typeof matchAuthPattern).toBe('function')
  })

  describe('exact matches', () => {
    it('matches exact method name', () => {
      expect(matchAuthPattern('users.me', 'users.me')).toBe(true)
    })

    it('returns false for non-matching exact names', () => {
      expect(matchAuthPattern('users.me', 'users.list')).toBe(false)
    })

    it('matches $-prefixed methods', () => {
      expect(matchAuthPattern('$health', '$health')).toBe(true)
      expect(matchAuthPattern('$introspect', '$introspect')).toBe(true)
    })
  })

  describe('wildcard patterns', () => {
    it('matches single-level wildcard (bashx.*)', () => {
      expect(matchAuthPattern('bashx.exec', 'bashx.*')).toBe(true)
      expect(matchAuthPattern('bashx.run', 'bashx.*')).toBe(true)
      expect(matchAuthPattern('bashx.kill', 'bashx.*')).toBe(true)
    })

    it('does not match nested levels with single wildcard', () => {
      // bashx.* should not match bashx.scripts.run
      expect(matchAuthPattern('bashx.scripts.run', 'bashx.*')).toBe(false)
    })

    it('matches double wildcard for nested levels (fsx.**)', () => {
      expect(matchAuthPattern('fsx.read', 'fsx.**')).toBe(true)
      expect(matchAuthPattern('fsx.files.read', 'fsx.**')).toBe(true)
      expect(matchAuthPattern('fsx.files.nested.read', 'fsx.**')).toBe(true)
    })

    it('matches actions.* pattern', () => {
      expect(matchAuthPattern('actions.create', 'actions.*')).toBe(true)
      expect(matchAuthPattern('actions.list', 'actions.*')).toBe(true)
      expect(matchAuthPattern('actions.replay', 'actions.*')).toBe(true)
    })

    it('matches events.* pattern', () => {
      expect(matchAuthPattern('events.list', 'events.*')).toBe(true)
      expect(matchAuthPattern('events.subscribe', 'events.*')).toBe(true)
    })

    it('matches users.* pattern but not users.me specifically', () => {
      // users.me should have its own specific rule, not match users.*
      expect(matchAuthPattern('users.list', 'users.*')).toBe(true)
      expect(matchAuthPattern('users.create', 'users.*')).toBe(true)
      // Note: users.me matching users.* is valid, but the config lookup
      // should prefer the specific users.me rule
    })
  })

  describe('edge cases', () => {
    it('returns false for empty method', () => {
      expect(matchAuthPattern('', 'bashx.*')).toBe(false)
    })

    it('returns false for empty pattern', () => {
      expect(matchAuthPattern('bashx.exec', '')).toBe(false)
    })

    it('handles methods with multiple dots', () => {
      expect(matchAuthPattern('storage.r2.buckets.list', 'storage.r2.*')).toBe(false)
      expect(matchAuthPattern('storage.r2.buckets.list', 'storage.r2.**')).toBe(true)
    })

    it('is case-sensitive', () => {
      expect(matchAuthPattern('Bashx.exec', 'bashx.*')).toBe(false)
      expect(matchAuthPattern('bashx.Exec', 'bashx.*')).toBe(true)
    })

    it('handles leading/trailing dots gracefully', () => {
      expect(matchAuthPattern('.bashx.exec', 'bashx.*')).toBe(false)
      expect(matchAuthPattern('bashx.exec.', 'bashx.*')).toBe(false)
    })
  })
})

// =============================================================================
// getMethodAuth Tests
// =============================================================================

describe('getMethodAuth', () => {
  it('exports getMethodAuth function', () => {
    expect(getMethodAuth).toBeDefined()
    expect(typeof getMethodAuth).toBe('function')
  })

  describe('exact method lookups', () => {
    it('returns config for exact method match', () => {
      const auth = getMethodAuth('$health')

      expect(auth).toBeDefined()
      expect(auth.public).toBe(true)
    })

    it('returns config for things.list', () => {
      const auth = getMethodAuth('things.list')

      expect(auth).toBeDefined()
      expect(auth.requireAuth).toBe(true)
    })

    it('returns config for things.delete with audit', () => {
      const auth = getMethodAuth('things.delete')

      expect(auth).toBeDefined()
      expect(auth.roles).toContain('admin')
      expect(auth.audit).toBe('full')
    })
  })

  describe('wildcard pattern lookups', () => {
    it('returns config for bashx.exec via bashx.* pattern', () => {
      const auth = getMethodAuth('bashx.exec')

      expect(auth).toBeDefined()
      expect(auth.roles).toContain('admin')
      expect(auth.audit).toBe('full')
    })

    it('returns config for fsx.readFile via fsx.* pattern', () => {
      const auth = getMethodAuth('fsx.readFile')

      expect(auth).toBeDefined()
      expect(auth.requireAuth).toBe(true)
    })

    it('returns config for actions.replay via actions.* pattern', () => {
      const auth = getMethodAuth('actions.replay')

      expect(auth).toBeDefined()
      expect(auth.roles).toContain('admin')
    })

    it('returns config for dlq.retry via dlq.* pattern', () => {
      const auth = getMethodAuth('dlq.retry')

      expect(auth).toBeDefined()
      expect(auth.roles).toContain('system')
    })
  })

  describe('precedence rules', () => {
    it('prefers exact match over wildcard', () => {
      // users.me should match users.me, not users.*
      const auth = getMethodAuth('users.me')

      expect(auth).toBeDefined()
      expect(auth.requireAuth).toBe(true)
      // users.* requires admin, but users.me should just require auth
      expect(auth.roles).toBeUndefined()
    })

    it('prefers more specific pattern over less specific', () => {
      // If there were patterns like "storage.*" and "storage.r2.*",
      // storage.r2.upload should match storage.r2.*
      // This test documents expected behavior for the implementation
      const customConfig: AuthConfig = {
        ...DEFAULT_AUTH_CONFIG,
        'storage.*': { requireAuth: true },
        'storage.r2.*': { roles: ['admin'] },
      }

      const auth = getMethodAuth('storage.r2.upload', customConfig)

      expect(auth).toBeDefined()
      expect(auth.roles).toContain('admin')
    })
  })

  describe('unknown methods', () => {
    it('returns restrictive default for unknown method', () => {
      const auth = getMethodAuth('completely.unknown.method')

      expect(auth).toBeDefined()
      // Unknown methods should require authentication at minimum
      expect(auth.requireAuth).toBe(true)
    })

    it('does not throw for unknown method', () => {
      expect(() => getMethodAuth('nonexistent.method')).not.toThrow()
    })
  })

  describe('custom config parameter', () => {
    it('uses custom config when provided', () => {
      const customConfig: AuthConfig = {
        'custom.endpoint': { public: true },
      }

      const auth = getMethodAuth('custom.endpoint', customConfig)

      expect(auth).toBeDefined()
      expect(auth.public).toBe(true)
    })

    it('falls back to defaults for methods not in custom config', () => {
      const customConfig: AuthConfig = {
        'custom.endpoint': { public: true },
      }

      const auth = getMethodAuth('$health', customConfig)

      expect(auth).toBeDefined()
      expect(auth.public).toBe(true)
    })
  })
})

// =============================================================================
// Type Export Tests
// =============================================================================

describe('type exports', () => {
  it('MethodAuthConfig type is usable', () => {
    const config: MethodAuthConfig = {
      public: true,
      requireAuth: false,
      roles: ['admin'],
      permissions: ['read', 'write'],
      audit: 'full',
    }

    expect(config.public).toBe(true)
    expect(config.roles).toContain('admin')
  })

  it('Role type accepts valid values', () => {
    const roles: Role[] = ['public', 'user', 'admin', 'system']

    expect(roles).toContain('public')
    expect(roles).toContain('user')
    expect(roles).toContain('admin')
    expect(roles).toContain('system')
  })

  it('AuthConfig type is a record of method to config', () => {
    const config: AuthConfig = {
      'test.method': { requireAuth: true },
      'another.method': { public: true },
    }

    expect(Object.keys(config)).toHaveLength(2)
  })
})

// =============================================================================
// Visibility Level Tests
// =============================================================================

describe('visibility levels', () => {
  describe('public visibility', () => {
    it('public endpoints have public: true', () => {
      const healthAuth = getMethodAuth('$health')
      const versionAuth = getMethodAuth('$version')

      expect(healthAuth.public).toBe(true)
      expect(versionAuth.public).toBe(true)
    })

    it('public endpoints do not require auth', () => {
      const healthAuth = getMethodAuth('$health')

      expect(healthAuth.requireAuth).toBeFalsy()
    })
  })

  describe('user visibility', () => {
    it('user-level endpoints require authentication', () => {
      const thingsListAuth = getMethodAuth('things.list')
      const usersmeAuth = getMethodAuth('users.me')
      const fsxReadAuth = getMethodAuth('fsx.read')

      expect(thingsListAuth.requireAuth).toBe(true)
      expect(usersmeAuth.requireAuth).toBe(true)
      expect(fsxReadAuth.requireAuth).toBe(true)
    })

    it('user-level endpoints do not require specific roles', () => {
      const thingsListAuth = getMethodAuth('things.list')

      expect(thingsListAuth.roles).toBeUndefined()
    })
  })

  describe('admin visibility', () => {
    it('admin endpoints require admin role', () => {
      const metricsAuth = getMethodAuth('$metrics')
      const bashxAuth = getMethodAuth('bashx.exec')
      const usersListAuth = getMethodAuth('users.list')

      expect(metricsAuth.roles).toContain('admin')
      expect(bashxAuth.roles).toContain('admin')
      expect(usersListAuth.roles).toContain('admin')
    })

    it('admin role is sufficient for admin endpoints', () => {
      const metricsAuth = getMethodAuth('$metrics')

      // Should not require system role
      expect(metricsAuth.roles).not.toContain('system')
    })
  })

  describe('system visibility', () => {
    it('system endpoints require system role', () => {
      const dlqAuth = getMethodAuth('dlq.process')
      const objectsAuth = getMethodAuth('objects.list')

      expect(dlqAuth.roles).toContain('system')
      expect(objectsAuth.roles).toContain('system')
    })

    it('system role is higher than admin', () => {
      // System-only endpoints should not be accessible to admin
      const dlqAuth = getMethodAuth('dlq.process')

      expect(dlqAuth.roles).toContain('system')
      // If admin is in roles, system should also be there
      // or admin should not be present
      if (dlqAuth.roles?.includes('admin')) {
        expect(dlqAuth.roles).toContain('system')
      }
    })
  })

  describe('role hierarchy', () => {
    it('documents the role hierarchy (public < user < admin < system)', () => {
      // This test documents expected behavior:
      // - public: no auth required
      // - user: any authenticated user
      // - admin: admin role required
      // - system: system role required (internal use only)

      const publicAuth = getMethodAuth('$health')
      const userAuth = getMethodAuth('things.list')
      const adminAuth = getMethodAuth('$metrics')
      const systemAuth = getMethodAuth('dlq.process')

      // Public has no requirements
      expect(publicAuth.public).toBe(true)

      // User requires auth but no specific role
      expect(userAuth.requireAuth).toBe(true)
      expect(userAuth.roles).toBeUndefined()

      // Admin requires admin role
      expect(adminAuth.roles).toContain('admin')

      // System requires system role
      expect(systemAuth.roles).toContain('system')
    })
  })
})

// =============================================================================
// Audit Configuration Tests
// =============================================================================

describe('audit configuration', () => {
  it('destructive operations have full audit', () => {
    const deleteAuth = getMethodAuth('things.delete')
    const bashxAuth = getMethodAuth('bashx.exec')

    expect(deleteAuth.audit).toBe('full')
    expect(bashxAuth.audit).toBe('full')
  })

  it('regular operations do not require full audit', () => {
    const listAuth = getMethodAuth('things.list')
    const getAuth = getMethodAuth('things.get')

    // Audit should be undefined, 'none', or 'basic'
    expect(listAuth.audit).not.toBe('full')
    expect(getAuth.audit).not.toBe('full')
  })

  it('audit levels are none, basic, or full', () => {
    const validAuditLevels = ['none', 'basic', 'full', undefined]

    const deleteAuth = getMethodAuth('things.delete')
    const listAuth = getMethodAuth('things.list')

    expect(validAuditLevels).toContain(deleteAuth.audit)
    expect(validAuditLevels).toContain(listAuth.audit)
  })
})
