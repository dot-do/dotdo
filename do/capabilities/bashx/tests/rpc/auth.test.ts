/**
 * RPC Authentication Layer Tests
 *
 * Tests for AuthenticatedShellApiImpl, TokenValidator, and related utilities.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ShellApi, ShellStream, ShellResult, ShellSpawnOptions } from '../../core/rpc/types.js'
import {
  AuthenticatedShellApiImpl,
  createMemoryValidator,
  createAuthenticatedShellApi,
  type AuthToken,
  type TokenValidator,
} from '../../src/rpc/auth.js'

// ============================================================================
// Mock ShellApi for testing
// ============================================================================

function createMockShellApi(): ShellApi & {
  execCalls: Array<{ command: string; options?: unknown }>
  spawnCalls: Array<{ command: string; options?: unknown }>
} {
  const api = {
    execCalls: [] as Array<{ command: string; options?: unknown }>,
    spawnCalls: [] as Array<{ command: string; options?: unknown }>,

    async exec(command: string, options?: unknown): Promise<ShellResult> {
      api.execCalls.push({ command, options })
      return {
        stdout: `output of: ${command}`,
        stderr: '',
        exitCode: 0,
        duration: 10,
      }
    },

    spawn(command: string, options?: ShellSpawnOptions): ShellStream {
      api.spawnCalls.push({ command, options })
      // Return a minimal mock ShellStream
      return {
        pid: 12345,
        write: vi.fn(),
        closeStdin: vi.fn(),
        kill: vi.fn(),
        onData: vi.fn(() => vi.fn()),
        onStderr: vi.fn(() => vi.fn()),
        onExit: vi.fn(() => vi.fn()),
        wait: vi.fn(() => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })),
        [Symbol.dispose]: vi.fn(),
      }
    },
  }
  return api
}

// ============================================================================
// Test Suites
// ============================================================================

describe('AuthenticatedShellApiImpl', () => {
  let mockApi: ReturnType<typeof createMockShellApi>
  let validTokens: Map<string, AuthToken>
  let validator: TokenValidator
  let authApi: AuthenticatedShellApiImpl

  beforeEach(() => {
    mockApi = createMockShellApi()
    validTokens = new Map([
      [
        'valid-token',
        {
          token: 'valid-token',
          userId: 'user-123',
          sessionId: 'session-abc',
          permissions: ['shell:exec', 'shell:spawn'],
        },
      ],
      [
        'expiring-token',
        {
          token: 'expiring-token',
          userId: 'user-456',
          expiresAt: Date.now() + 60000, // Expires in 1 minute
        },
      ],
      [
        'expired-token',
        {
          token: 'expired-token',
          userId: 'user-789',
          expiresAt: Date.now() - 1000, // Already expired
        },
      ],
    ])
    validator = createMemoryValidator(validTokens)
    authApi = new AuthenticatedShellApiImpl(mockApi, validator)
  })

  describe('authenticate()', () => {
    it('should return true for valid tokens', async () => {
      const result = await authApi.authenticate('valid-token')
      expect(result).toBe(true)
    })

    it('should return false for invalid tokens', async () => {
      const result = await authApi.authenticate('invalid-token')
      expect(result).toBe(false)
    })

    it('should return false for empty token', async () => {
      const result = await authApi.authenticate('')
      expect(result).toBe(false)
    })

    it('should store auth token on successful authentication', async () => {
      await authApi.authenticate('valid-token')
      const token = authApi.getAuthToken()

      expect(token).not.toBeNull()
      expect(token?.userId).toBe('user-123')
      expect(token?.sessionId).toBe('session-abc')
    })

    it('should not store token on failed authentication', async () => {
      await authApi.authenticate('invalid-token')
      expect(authApi.getAuthToken()).toBeNull()
    })

    it('should replace previous auth token on re-authentication', async () => {
      await authApi.authenticate('valid-token')
      await authApi.authenticate('expiring-token')

      const token = authApi.getAuthToken()
      expect(token?.userId).toBe('user-456')
    })
  })

  describe('isAuthenticated()', () => {
    it('should return false when not authenticated', () => {
      expect(authApi.isAuthenticated()).toBe(false)
    })

    it('should return true after successful authentication', async () => {
      await authApi.authenticate('valid-token')
      expect(authApi.isAuthenticated()).toBe(true)
    })

    it('should return false after failed authentication', async () => {
      await authApi.authenticate('invalid-token')
      expect(authApi.isAuthenticated()).toBe(false)
    })

    it('should return true for non-expired token', async () => {
      await authApi.authenticate('expiring-token')
      expect(authApi.isAuthenticated()).toBe(true)
    })

    it('should return false for expired token', async () => {
      await authApi.authenticate('expired-token')
      expect(authApi.isAuthenticated()).toBe(false)
    })

    it('should clear auth token when expired', async () => {
      await authApi.authenticate('expired-token')
      authApi.isAuthenticated() // This should clear the token
      expect(authApi.getAuthToken()).toBeNull()
    })

    it('should return true for token without expiration', async () => {
      await authApi.authenticate('valid-token')
      expect(authApi.isAuthenticated()).toBe(true)
    })
  })

  describe('getAuthToken()', () => {
    it('should return null when not authenticated', () => {
      expect(authApi.getAuthToken()).toBeNull()
    })

    it('should return auth token when authenticated', async () => {
      await authApi.authenticate('valid-token')
      const token = authApi.getAuthToken()

      expect(token).toEqual({
        token: 'valid-token',
        userId: 'user-123',
        sessionId: 'session-abc',
        permissions: ['shell:exec', 'shell:spawn'],
      })
    })
  })

  describe('logout()', () => {
    it('should clear authentication state', async () => {
      await authApi.authenticate('valid-token')
      expect(authApi.isAuthenticated()).toBe(true)

      authApi.logout()

      expect(authApi.isAuthenticated()).toBe(false)
      expect(authApi.getAuthToken()).toBeNull()
    })

    it('should be safe to call when not authenticated', () => {
      expect(() => authApi.logout()).not.toThrow()
    })
  })

  describe('exec()', () => {
    it('should throw when not authenticated', async () => {
      await expect(authApi.exec('ls')).rejects.toThrow('Unauthenticated: call authenticate() first')
    })

    it('should execute command when authenticated', async () => {
      await authApi.authenticate('valid-token')
      const result = await authApi.exec('ls -la')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('ls -la')
      expect(mockApi.execCalls).toHaveLength(1)
      expect(mockApi.execCalls[0].command).toBe('ls -la')
    })

    it('should pass options to underlying exec', async () => {
      await authApi.authenticate('valid-token')
      await authApi.exec('ls', { cwd: '/tmp', timeout: 5000 })

      expect(mockApi.execCalls[0].options).toEqual({ cwd: '/tmp', timeout: 5000 })
    })

    it('should throw after logout', async () => {
      await authApi.authenticate('valid-token')
      authApi.logout()

      await expect(authApi.exec('ls')).rejects.toThrow('Unauthenticated')
    })

    it('should throw when token expires', async () => {
      // Create a token that will expire during the test
      const tokens = new Map<string, AuthToken>([
        [
          'short-lived',
          {
            token: 'short-lived',
            userId: 'user',
            expiresAt: Date.now() + 50, // Expires in 50ms
          },
        ],
      ])
      const shortLivedValidator = createMemoryValidator(tokens)
      const api = new AuthenticatedShellApiImpl(mockApi, shortLivedValidator)

      await api.authenticate('short-lived')
      expect(api.isAuthenticated()).toBe(true)

      // Wait for token to expire
      await new Promise((resolve) => setTimeout(resolve, 100))

      await expect(api.exec('ls')).rejects.toThrow('Unauthenticated')
    })
  })

  describe('spawn()', () => {
    it('should throw when not authenticated', () => {
      expect(() => authApi.spawn('cat')).toThrow('Unauthenticated: call authenticate() first')
    })

    it('should spawn process when authenticated', async () => {
      await authApi.authenticate('valid-token')
      const stream = authApi.spawn('cat')

      expect(stream.pid).toBe(12345)
      expect(mockApi.spawnCalls).toHaveLength(1)
      expect(mockApi.spawnCalls[0].command).toBe('cat')
    })

    it('should pass options to underlying spawn', async () => {
      await authApi.authenticate('valid-token')
      authApi.spawn('bash', { cwd: '/home', env: { FOO: 'bar' } })

      expect(mockApi.spawnCalls[0].options).toEqual({
        cwd: '/home',
        env: { FOO: 'bar' },
      })
    })

    it('should throw after logout', async () => {
      await authApi.authenticate('valid-token')
      authApi.logout()

      expect(() => authApi.spawn('cat')).toThrow('Unauthenticated')
    })
  })
})

describe('createMemoryValidator', () => {
  it('should validate tokens in the map', async () => {
    const tokens = new Map<string, AuthToken>([
      ['token-1', { token: 'token-1', userId: 'user-1' }],
      ['token-2', { token: 'token-2', userId: 'user-2' }],
    ])
    const validator = createMemoryValidator(tokens)

    const result1 = await validator.validate('token-1')
    expect(result1?.userId).toBe('user-1')

    const result2 = await validator.validate('token-2')
    expect(result2?.userId).toBe('user-2')
  })

  it('should return null for unknown tokens', async () => {
    const tokens = new Map<string, AuthToken>([['known', { token: 'known' }]])
    const validator = createMemoryValidator(tokens)

    const result = await validator.validate('unknown')
    expect(result).toBeNull()
  })

  it('should work with empty map', async () => {
    const validator = createMemoryValidator(new Map())
    const result = await validator.validate('any-token')
    expect(result).toBeNull()
  })

  it('should preserve all token properties', async () => {
    const fullToken: AuthToken = {
      token: 'full-token',
      userId: 'user-123',
      sessionId: 'session-456',
      expiresAt: 1700000000000,
      permissions: ['read', 'write', 'execute'],
    }
    const tokens = new Map([['full-token', fullToken]])
    const validator = createMemoryValidator(tokens)

    const result = await validator.validate('full-token')
    expect(result).toEqual(fullToken)
  })
})

describe('createAuthenticatedShellApi', () => {
  it('should create an AuthenticatedShellApi instance', async () => {
    const mockApi = createMockShellApi()
    const tokens = new Map<string, AuthToken>([['test', { token: 'test' }]])
    const validator = createMemoryValidator(tokens)

    const authApi = createAuthenticatedShellApi(mockApi, validator)

    expect(authApi.isAuthenticated()).toBe(false)
    await authApi.authenticate('test')
    expect(authApi.isAuthenticated()).toBe(true)
  })

  it('should properly delegate to underlying api', async () => {
    const mockApi = createMockShellApi()
    const tokens = new Map<string, AuthToken>([['test', { token: 'test' }]])
    const validator = createMemoryValidator(tokens)
    const authApi = createAuthenticatedShellApi(mockApi, validator)

    await authApi.authenticate('test')
    await authApi.exec('echo hello')

    expect(mockApi.execCalls).toHaveLength(1)
    expect(mockApi.execCalls[0].command).toBe('echo hello')
  })
})

describe('TokenValidator integration patterns', () => {
  describe('custom validator with async validation', () => {
    it('should work with async token validation', async () => {
      const asyncValidator: TokenValidator = {
        async validate(token: string) {
          // Simulate async validation (e.g., database lookup)
          await new Promise((resolve) => setTimeout(resolve, 10))

          if (token === 'async-valid') {
            return { token, userId: 'async-user' }
          }
          return null
        },
      }

      const mockApi = createMockShellApi()
      const authApi = new AuthenticatedShellApiImpl(mockApi, asyncValidator)

      const result = await authApi.authenticate('async-valid')
      expect(result).toBe(true)
      expect(authApi.getAuthToken()?.userId).toBe('async-user')
    })
  })

  describe('validator with refresh capability', () => {
    it('should support token refresh', async () => {
      let refreshCount = 0
      const refreshableValidator: TokenValidator = {
        async validate(token: string) {
          if (token.startsWith('valid-')) {
            return { token, userId: 'user', expiresAt: Date.now() + 60000 }
          }
          return null
        },
        async refresh(token: string) {
          refreshCount++
          return {
            token: `refreshed-${refreshCount}`,
            userId: 'user',
            expiresAt: Date.now() + 60000,
          }
        },
      }

      // Verify refresh is available
      expect(refreshableValidator.refresh).toBeDefined()

      const newToken = await refreshableValidator.refresh?.('old-token')
      expect(newToken?.token).toBe('refreshed-1')
      expect(refreshCount).toBe(1)
    })
  })

  describe('validator that throws on error', () => {
    it('should handle validator errors gracefully', async () => {
      const errorValidator: TokenValidator = {
        async validate(token: string) {
          if (token === 'error') {
            throw new Error('Validation service unavailable')
          }
          return { token, userId: 'user' }
        },
      }

      const mockApi = createMockShellApi()
      const authApi = new AuthenticatedShellApiImpl(mockApi, errorValidator)

      // Should propagate the error
      await expect(authApi.authenticate('error')).rejects.toThrow(
        'Validation service unavailable'
      )
    })
  })
})

describe('Token expiration edge cases', () => {
  it('should handle expiresAt of 0 as expired', async () => {
    const tokens = new Map<string, AuthToken>([
      ['zero-expiry', { token: 'zero-expiry', expiresAt: 0 }],
    ])
    const validator = createMemoryValidator(tokens)
    const mockApi = createMockShellApi()
    const authApi = new AuthenticatedShellApiImpl(mockApi, validator)

    await authApi.authenticate('zero-expiry')
    expect(authApi.isAuthenticated()).toBe(false)
  })

  it('should handle very large expiresAt values', async () => {
    const farFuture = Date.now() + 1000 * 60 * 60 * 24 * 365 * 100 // 100 years
    const tokens = new Map<string, AuthToken>([
      ['long-lived', { token: 'long-lived', expiresAt: farFuture }],
    ])
    const validator = createMemoryValidator(tokens)
    const mockApi = createMockShellApi()
    const authApi = new AuthenticatedShellApiImpl(mockApi, validator)

    await authApi.authenticate('long-lived')
    expect(authApi.isAuthenticated()).toBe(true)
  })

  it('should handle undefined expiresAt as never expiring', async () => {
    const tokens = new Map<string, AuthToken>([
      ['no-expiry', { token: 'no-expiry', userId: 'user' }],
    ])
    const validator = createMemoryValidator(tokens)
    const mockApi = createMockShellApi()
    const authApi = new AuthenticatedShellApiImpl(mockApi, validator)

    await authApi.authenticate('no-expiry')
    expect(authApi.isAuthenticated()).toBe(true)
    expect(authApi.getAuthToken()?.expiresAt).toBeUndefined()
  })
})

describe('Concurrent authentication scenarios', () => {
  it('should handle multiple authenticate calls', async () => {
    const tokens = new Map<string, AuthToken>([
      ['token-1', { token: 'token-1', userId: 'user-1' }],
      ['token-2', { token: 'token-2', userId: 'user-2' }],
    ])
    const validator = createMemoryValidator(tokens)
    const mockApi = createMockShellApi()
    const authApi = new AuthenticatedShellApiImpl(mockApi, validator)

    // Start both authentications concurrently
    const [result1, result2] = await Promise.all([
      authApi.authenticate('token-1'),
      authApi.authenticate('token-2'),
    ])

    expect(result1).toBe(true)
    expect(result2).toBe(true)
    // Last one wins
    const token = authApi.getAuthToken()
    expect(['user-1', 'user-2']).toContain(token?.userId)
  })
})
