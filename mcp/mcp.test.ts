/**
 * MCP Tests
 *
 * Tests for MCP server infrastructure, JWT validation,
 * OAuth flow, and permission checking.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import {
  createJwt,
  validateJwt,
  decodeJwt,
  extractBearerToken,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  tokenNeedsRefresh,
} from './auth/jwt'
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from './auth/oauth'
import {
  mapRolesToPermissions,
  getPrimaryOrgId,
} from './auth/authkit'
import { toolRegistry, textResult, jsonResult, errorResult } from './tools'
import type { JwtPayload, WorkOSUser, McpTool } from './types'

// =============================================================================
// JWT Tests
// =============================================================================

describe('JWT Validation', () => {
  const testSecret = 'test-secret-key-for-jwt-signing-that-is-long-enough'

  describe('createJwt', () => {
    it('should create a valid JWT token', async () => {
      const token = await createJwt(
        {
          sub: 'user-123',
          email: 'test@example.com',
          permissions: ['tools:read', 'tools:execute'],
        },
        testSecret
      )

      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
      expect(token.split('.')).toHaveLength(3) // JWT has 3 parts
    })

    it('should create a token with custom expiration', async () => {
      const token = await createJwt(
        {
          sub: 'user-123',
          permissions: [],
        },
        testSecret,
        { expiresIn: '1h' }
      )

      const decoded = decodeJwt(token)
      expect(decoded).not.toBeNull()
      // 1 hour expiry should be roughly 3600 seconds from now
      const expectedExp = Math.floor(Date.now() / 1000) + 3600
      expect(decoded!.exp).toBeGreaterThan(expectedExp - 60) // Allow 60s tolerance
      expect(decoded!.exp).toBeLessThan(expectedExp + 60)
    })
  })

  describe('validateJwt', () => {
    it('should validate a valid token', async () => {
      const token = await createJwt(
        {
          sub: 'user-123',
          email: 'test@example.com',
          permissions: ['tools:read'],
        },
        testSecret
      )

      const result = await validateJwt(token, testSecret)

      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.payload.sub).toBe('user-123')
        expect(result.payload.email).toBe('test@example.com')
        expect(result.payload.permissions).toContain('tools:read')
      }
    })

    it('should reject a token with wrong secret', async () => {
      const token = await createJwt(
        { sub: 'user-123', permissions: [] },
        testSecret
      )

      const result = await validateJwt(token, 'wrong-secret')

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toContain('signature')
      }
    })

    it('should reject an invalid token format', async () => {
      const result = await validateJwt('not-a-valid-token', testSecret)

      expect(result.valid).toBe(false)
    })
  })

  describe('decodeJwt', () => {
    it('should decode a token without verification', async () => {
      const token = await createJwt(
        {
          sub: 'user-456',
          email: 'decode@example.com',
          permissions: ['*'],
        },
        testSecret
      )

      const decoded = decodeJwt(token)

      expect(decoded).not.toBeNull()
      expect(decoded!.sub).toBe('user-456')
      expect(decoded!.email).toBe('decode@example.com')
    })

    it('should return null for invalid tokens', () => {
      const decoded = decodeJwt('invalid')
      expect(decoded).toBeNull()
    })
  })

  describe('extractBearerToken', () => {
    it('should extract token from Authorization header', () => {
      const request = new Request('https://example.com', {
        headers: { Authorization: 'Bearer test-token-123' },
      })

      const token = extractBearerToken(request)
      expect(token).toBe('test-token-123')
    })

    it('should return null without Authorization header', () => {
      const request = new Request('https://example.com')
      const token = extractBearerToken(request)
      expect(token).toBeNull()
    })

    it('should return null for non-Bearer auth', () => {
      const request = new Request('https://example.com', {
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      })

      const token = extractBearerToken(request)
      expect(token).toBeNull()
    })
  })
})

// =============================================================================
// Permission Tests
// =============================================================================

describe('Permission Checking', () => {
  describe('hasPermission', () => {
    it('should return true for wildcard permission', () => {
      expect(hasPermission(['*'], 'anything')).toBe(true)
      expect(hasPermission(['*'], 'tools:execute')).toBe(true)
    })

    it('should return true for exact match', () => {
      expect(hasPermission(['tools:read'], 'tools:read')).toBe(true)
      expect(hasPermission(['admin', 'tools:read'], 'admin')).toBe(true)
    })

    it('should return true for hierarchical wildcard', () => {
      expect(hasPermission(['tools:*'], 'tools:read')).toBe(true)
      expect(hasPermission(['tools:*'], 'tools:execute')).toBe(true)
      expect(hasPermission(['resources:*'], 'resources:fetch:all')).toBe(true)
    })

    it('should return false for missing permission', () => {
      expect(hasPermission(['tools:read'], 'tools:execute')).toBe(false)
      expect(hasPermission(['admin'], 'tools:read')).toBe(false)
      expect(hasPermission([], 'anything')).toBe(false)
    })
  })

  describe('hasAllPermissions', () => {
    it('should return true when all permissions present', () => {
      const perms = ['tools:read', 'tools:execute', 'resources:fetch']
      expect(hasAllPermissions(perms, ['tools:read', 'tools:execute'])).toBe(true)
    })

    it('should return false when any permission missing', () => {
      const perms = ['tools:read']
      expect(hasAllPermissions(perms, ['tools:read', 'tools:execute'])).toBe(false)
    })

    it('should return true for empty required', () => {
      expect(hasAllPermissions(['tools:read'], [])).toBe(true)
    })
  })

  describe('hasAnyPermission', () => {
    it('should return true when any permission present', () => {
      const perms = ['tools:read']
      expect(hasAnyPermission(perms, ['tools:read', 'tools:execute'])).toBe(true)
    })

    it('should return false when no permissions match', () => {
      const perms = ['admin']
      expect(hasAnyPermission(perms, ['tools:read', 'tools:execute'])).toBe(false)
    })
  })

  describe('tokenNeedsRefresh', () => {
    it('should return true when token expires soon', () => {
      const payload: JwtPayload = {
        sub: 'user-123',
        iat: Math.floor(Date.now() / 1000) - 3600,
        exp: Math.floor(Date.now() / 1000) + 60, // Expires in 1 minute
        permissions: [],
      }
      expect(tokenNeedsRefresh(payload)).toBe(true)
    })

    it('should return false when token has plenty of time', () => {
      const payload: JwtPayload = {
        sub: 'user-123',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600, // Expires in 1 hour
        permissions: [],
      }
      expect(tokenNeedsRefresh(payload)).toBe(false)
    })
  })
})

// =============================================================================
// PKCE Tests
// =============================================================================

describe('PKCE (OAuth)', () => {
  describe('generateCodeVerifier', () => {
    it('should generate a URL-safe string', () => {
      const verifier = generateCodeVerifier()
      expect(verifier).toBeDefined()
      expect(verifier.length).toBeGreaterThan(0)
      // Should only contain URL-safe characters
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('should generate unique values', () => {
      const v1 = generateCodeVerifier()
      const v2 = generateCodeVerifier()
      expect(v1).not.toBe(v2)
    })
  })

  describe('generateCodeChallenge', () => {
    it('should generate a challenge from verifier', async () => {
      const verifier = generateCodeVerifier()
      const challenge = await generateCodeChallenge(verifier)

      expect(challenge).toBeDefined()
      expect(challenge.length).toBeGreaterThan(0)
      // SHA-256 base64url encoded is 43 chars
      expect(challenge.length).toBe(43)
    })

    it('should generate same challenge for same verifier', async () => {
      const verifier = 'test-verifier'
      const c1 = await generateCodeChallenge(verifier)
      const c2 = await generateCodeChallenge(verifier)
      expect(c1).toBe(c2)
    })
  })

  describe('generateState', () => {
    it('should generate a random state', () => {
      const state = generateState()
      expect(state).toBeDefined()
      expect(state.length).toBeGreaterThan(0)
    })

    it('should generate unique states', () => {
      const s1 = generateState()
      const s2 = generateState()
      expect(s1).not.toBe(s2)
    })
  })
})

// =============================================================================
// AuthKit Tests
// =============================================================================

describe('AuthKit Integration', () => {
  describe('mapRolesToPermissions', () => {
    it('should return default permissions for user without roles', () => {
      const user: WorkOSUser = {
        id: 'user-123',
        email: 'test@example.com',
      }
      const perms = mapRolesToPermissions(user)
      expect(perms).toContain('tools:read')
      expect(perms).toContain('resources:read')
    })

    it('should grant all permissions to admin', () => {
      const user: WorkOSUser = {
        id: 'admin-123',
        email: 'admin@example.com',
        organizationMemberships: [
          {
            id: 'mem-1',
            organizationId: 'org-1',
            role: { slug: 'admin' },
          },
        ],
      }
      const perms = mapRolesToPermissions(user)
      expect(perms).toContain('*')
    })

    it('should grant execute permission to member', () => {
      const user: WorkOSUser = {
        id: 'member-123',
        email: 'member@example.com',
        organizationMemberships: [
          {
            id: 'mem-1',
            organizationId: 'org-1',
            role: { slug: 'member' },
          },
        ],
      }
      const perms = mapRolesToPermissions(user)
      expect(perms).toContain('tools:execute')
    })
  })

  describe('getPrimaryOrgId', () => {
    it('should return undefined without memberships', () => {
      const user: WorkOSUser = {
        id: 'user-123',
        email: 'test@example.com',
      }
      expect(getPrimaryOrgId(user)).toBeUndefined()
    })

    it('should return first org id', () => {
      const user: WorkOSUser = {
        id: 'user-123',
        email: 'test@example.com',
        organizationMemberships: [
          { id: 'mem-1', organizationId: 'org-abc', role: { slug: 'member' } },
          { id: 'mem-2', organizationId: 'org-xyz', role: { slug: 'admin' } },
        ],
      }
      expect(getPrimaryOrgId(user)).toBe('org-abc')
    })
  })
})

// =============================================================================
// Tool Registry Tests
// =============================================================================

describe('Tool Registry', () => {
  describe('register/get', () => {
    it('should register and retrieve a tool', () => {
      const tool: McpTool = {
        name: 'test-tool',
        description: 'A test tool',
        inputSchema: {
          type: 'object',
          properties: { input: { type: 'string' } },
        },
      }

      toolRegistry.register(tool, async () => textResult('result'))

      const retrieved = toolRegistry.get('test-tool')
      expect(retrieved).toBeDefined()
      expect(retrieved!.name).toBe('test-tool')

      // Clean up
      toolRegistry.unregister('test-tool')
    })

    it('should return undefined for unknown tool', () => {
      expect(toolRegistry.get('nonexistent')).toBeUndefined()
    })
  })

  describe('has/unregister', () => {
    it('should check tool existence', () => {
      // Built-in tools should exist
      expect(toolRegistry.has('echo')).toBe(true)
      expect(toolRegistry.has('ping')).toBe(true)
      expect(toolRegistry.has('nonexistent')).toBe(false)
    })

    it('should unregister tools', () => {
      toolRegistry.register(
        {
          name: 'temp-tool',
          description: 'Temporary',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => textResult('temp')
      )

      expect(toolRegistry.has('temp-tool')).toBe(true)
      toolRegistry.unregister('temp-tool')
      expect(toolRegistry.has('temp-tool')).toBe(false)
    })
  })

  describe('getHandler', () => {
    it('should return handler for registered tool', async () => {
      const handler = toolRegistry.getHandler('echo')
      expect(handler).toBeDefined()

      const result = await handler!({ message: 'test' }, { userId: 'u1', permissions: [] }, {} as any)
      expect(result.content[0].text).toContain('Echo: test')
    })

    it('should return undefined for unknown tool', () => {
      expect(toolRegistry.getHandler('nonexistent')).toBeUndefined()
    })
  })

  describe('result helpers', () => {
    it('textResult creates text content', () => {
      const result = textResult('hello')
      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toBe('hello')
      expect(result.isError).toBe(false)
    })

    it('jsonResult creates JSON content', () => {
      const result = jsonResult({ foo: 'bar' })
      expect(result.content[0].text).toBe(JSON.stringify({ foo: 'bar' }, null, 2))
    })

    it('errorResult creates error content', () => {
      const result = errorResult('something went wrong')
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toBe('something went wrong')
    })
  })
})

// =============================================================================
// Built-in Tools Tests
// =============================================================================

describe('Built-in Tools', () => {
  describe('echo tool', () => {
    it('should echo message', async () => {
      const handler = toolRegistry.getHandler('echo')!
      const result = await handler(
        { message: 'Hello, MCP!' },
        { userId: 'user-1', permissions: ['tools:read'] },
        {} as any
      )

      expect(result.isError).toBeFalsy()
      expect(result.content[0].text).toBe('Echo: Hello, MCP!')
    })
  })

  describe('ping tool', () => {
    it('should return pong', async () => {
      const handler = toolRegistry.getHandler('ping')!
      const result = await handler(
        {},
        { userId: 'user-1', permissions: [] },
        {} as any
      )

      expect(result.isError).toBeFalsy()
      expect(result.content[0].text).toBe('pong')
    })
  })
})
