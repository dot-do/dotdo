import { describe, it, expect, beforeEach } from 'vitest'
import { createServer } from '../server'

/**
 * RED Phase TDD Tests for RPC Method Whitelist Validation
 *
 * These tests define the expected behavior for method whitelisting in RPC.
 * RPC should only expose explicitly whitelisted methods to prevent
 * unintended access to internal implementation details.
 *
 * Issue: do-luhm.2
 */

/**
 * Helper to check authorization error response format
 * Method access denied should return 403 Forbidden with a generic message
 * that doesn't reveal whether the method exists (security best practice)
 */
interface AuthorizationErrorResponse {
  type: string
  code: string
  message: string
  details?: {
    method?: string
    exists?: boolean
  }
}

function expectMethodNotAllowed(json: AuthorizationErrorResponse) {
  expect(json.type).toBe('AuthorizationError')
  expect(json.code).toBe('AUTHORIZATION_ERROR')
  // Message should be generic - not reveal if method exists or not
  expect(json.message).toBe('Method not allowed')
}

/**
 * Test target class with various method types for whitelist testing
 */
class TestService {
  // Public methods that should be whitelistable
  public greet(name: string): string {
    return `Hello, ${name}!`
  }

  public getUser(id: string): { id: string; name: string } {
    return { id, name: 'Test User' }
  }

  public getUserProfile(id: string): { id: string; profile: object } {
    return { id, profile: { bio: 'Test bio' } }
  }

  public listUsers(): Array<{ id: string; name: string }> {
    return [{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }]
  }

  // Internal method prefixed with underscore - should never be callable via RPC
  public _internalHelper(): string {
    return 'internal data'
  }

  public _processData(data: unknown): unknown {
    return data
  }

  // Private method using # syntax - should never be callable via RPC
  // Note: TypeScript private fields are compiled differently, but the name pattern should still be blocked
  #privateMethod(): string {
    return 'truly private'
  }

  // Method that exposes private method for testing
  public callPrivate(): string {
    return this.#privateMethod()
  }

  // Admin methods that might need separate whitelist control
  public adminDelete(id: string): { deleted: true; id: string } {
    return { deleted: true, id }
  }

  public adminPromote(id: string): { promoted: true; id: string } {
    return { promoted: true, id }
  }
}

/**
 * Base class to test inherited method whitelist behavior
 */
class BaseService {
  public baseMethod(): string {
    return 'from base'
  }

  public sharedMethod(): string {
    return 'shared from base'
  }

  public _baseInternal(): string {
    return 'base internal'
  }
}

/**
 * Extended class to test that inherited methods respect whitelist
 */
class ExtendedService extends BaseService {
  public childMethod(): string {
    return 'from child'
  }

  public override sharedMethod(): string {
    return 'overridden in child'
  }
}

describe('RPC Method Whitelist Validation', () => {
  describe('1. Whitelisted method is callable via RPC', () => {
    it('should allow calling a method that is in the whitelist', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: ['greet']
      })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: ['World'] })
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toBe('Hello, World!')
    })

    it('should allow calling multiple whitelisted methods', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: ['greet', 'getUser', 'listUsers']
      })

      const res1 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: ['Test'] })
      })
      expect(res1.status).toBe(200)

      const res2 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'getUser', args: ['123'] })
      })
      expect(res2.status).toBe(200)

      const res3 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'listUsers', args: [] })
      })
      expect(res3.status).toBe(200)
    })
  })

  describe('2. Non-whitelisted method returns error', () => {
    it('should reject calling a method not in the whitelist', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: ['greet'] // Only greet is whitelisted
      })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'getUser', args: ['123'] })
      })

      expect(res.status).toBe(403)
      const json = await res.json()
      expectMethodNotAllowed(json)
    })

    it('should reject methods that exist on target but are not whitelisted', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: ['greet', 'listUsers']
      })

      // getUser exists but is not whitelisted
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'getUser', args: ['123'] })
      })

      expect(res.status).toBe(403)
      const json = await res.json()
      expectMethodNotAllowed(json)
    })
  })

  describe('3. Private methods (starting with _) are never callable', () => {
    it('should reject underscore-prefixed methods even if explicitly whitelisted', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: ['greet', '_internalHelper'] // Attempting to whitelist internal method
      })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: '_internalHelper', args: [] })
      })

      expect(res.status).toBe(403)
      const json = await res.json()
      expectMethodNotAllowed(json)
    })

    it('should reject all underscore-prefixed methods regardless of whitelist', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: ['*'] // Even with wildcard whitelist
      })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: '_processData', args: [{ test: true }] })
      })

      expect(res.status).toBe(403)
      const json = await res.json()
      expectMethodNotAllowed(json)
    })
  })

  describe('4. Internal methods (starting with #) are never callable', () => {
    it('should reject hash-prefixed private methods', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: ['*']
      })

      // Attempting to call a private field method directly
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: '#privateMethod', args: [] })
      })

      // Should fail at validation level - # is not allowed in method paths
      expect(res.status).toBe(400) // Invalid method path due to # character
    })

    it('should not allow accessing mangled private method names', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: ['*']
      })

      // JavaScript private fields are not directly accessible, but ensure
      // any attempts to access mangled names are blocked
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: '_TestService_privateMethod', args: [] })
      })

      expect(res.status).toBe(403)
      const json = await res.json()
      expectMethodNotAllowed(json)
    })
  })

  describe('5. Inherited methods from base class respect whitelist', () => {
    it('should allow inherited method only if whitelisted', async () => {
      const target = new ExtendedService()
      const app = createServer({
        target,
        whitelist: ['baseMethod', 'childMethod']
      })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'baseMethod', args: [] })
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toBe('from base')
    })

    it('should reject inherited method if not in whitelist', async () => {
      const target = new ExtendedService()
      const app = createServer({
        target,
        whitelist: ['childMethod'] // Only child method whitelisted
      })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'baseMethod', args: [] })
      })

      expect(res.status).toBe(403)
      const json = await res.json()
      expectMethodNotAllowed(json)
    })

    it('should reject inherited internal methods even with whitelist', async () => {
      const target = new ExtendedService()
      const app = createServer({
        target,
        whitelist: ['*', '_baseInternal']
      })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: '_baseInternal', args: [] })
      })

      expect(res.status).toBe(403)
      const json = await res.json()
      expectMethodNotAllowed(json)
    })
  })

  describe('6. Dynamic whitelist updates take effect', () => {
    it('should reflect whitelist changes after update', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: ['greet']
      })

      // First call - getUser should be blocked
      const res1 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'getUser', args: ['123'] })
      })
      expect(res1.status).toBe(403)

      // Update whitelist to include getUser
      app.updateWhitelist(['greet', 'getUser'])

      // Second call - getUser should now work
      const res2 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'getUser', args: ['123'] })
      })
      expect(res2.status).toBe(200)
    })

    it('should revoke access when method is removed from whitelist', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: ['greet', 'getUser']
      })

      // First call - getUser should work
      const res1 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'getUser', args: ['123'] })
      })
      expect(res1.status).toBe(200)

      // Update whitelist to remove getUser
      app.updateWhitelist(['greet'])

      // Second call - getUser should now be blocked
      const res2 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'getUser', args: ['123'] })
      })
      expect(res2.status).toBe(403)
    })
  })

  describe('7. Empty whitelist blocks all methods', () => {
    it('should block all methods when whitelist is empty array', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: []
      })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: ['World'] })
      })

      expect(res.status).toBe(403)
      const json = await res.json()
      expectMethodNotAllowed(json)
    })

    it('should block all methods including admin methods with empty whitelist', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: []
      })

      const methods = ['greet', 'getUser', 'listUsers', 'adminDelete', 'adminPromote']

      for (const method of methods) {
        const res = await app.request('/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method, args: [] })
        })

        expect(res.status).toBe(403)
        const json = await res.json()
        expectMethodNotAllowed(json)
      }
    })
  })

  describe('8. Whitelist supports glob patterns', () => {
    it('should allow methods matching "get*" pattern', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: ['get*'] // Matches getUser, getUserProfile
      })

      const res1 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'getUser', args: ['123'] })
      })
      expect(res1.status).toBe(200)

      const res2 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'getUserProfile', args: ['123'] })
      })
      expect(res2.status).toBe(200)
    })

    it('should reject methods not matching "get*" pattern', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: ['get*']
      })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'listUsers', args: [] })
      })

      expect(res.status).toBe(403)
      const json = await res.json()
      expectMethodNotAllowed(json)
    })

    it('should support "*" wildcard to allow all public methods', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: ['*']
      })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: ['World'] })
      })
      expect(res.status).toBe(200)

      const res2 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'listUsers', args: [] })
      })
      expect(res2.status).toBe(200)
    })

    it('should support "admin*" pattern for admin methods', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: ['admin*']
      })

      const res1 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'adminDelete', args: ['123'] })
      })
      expect(res1.status).toBe(200)

      const res2 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'adminPromote', args: ['123'] })
      })
      expect(res2.status).toBe(200)

      // Non-admin method should be blocked
      const res3 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: ['World'] })
      })
      expect(res3.status).toBe(403)
    })

    it('should support combining explicit methods with patterns', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: ['greet', 'get*', 'list*']
      })

      // Explicit method
      const res1 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: ['World'] })
      })
      expect(res1.status).toBe(200)

      // Pattern match get*
      const res2 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'getUser', args: ['123'] })
      })
      expect(res2.status).toBe(200)

      // Pattern match list*
      const res3 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'listUsers', args: [] })
      })
      expect(res3.status).toBe(200)

      // Not matching any pattern
      const res4 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'adminDelete', args: ['123'] })
      })
      expect(res4.status).toBe(403)
    })
  })

  describe('9. Error message does not reveal method existence', () => {
    it('should return same error for non-existent and non-whitelisted methods', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: ['greet']
      })

      // Call a method that exists but is not whitelisted
      const res1 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'getUser', args: ['123'] })
      })

      // Call a method that doesn't exist at all
      const res2 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'nonExistentMethod', args: [] })
      })

      // Both should return the same status code
      expect(res1.status).toBe(403)
      expect(res2.status).toBe(403)

      const json1 = await res1.json()
      const json2 = await res2.json()

      // Both should have identical error structure - cannot distinguish
      expect(json1.type).toBe(json2.type)
      expect(json1.code).toBe(json2.code)
      expect(json1.message).toBe(json2.message)

      // Message should be generic
      expect(json1.message).toBe('Method not allowed')

      // Should not include any method-specific details
      expect(json1.details?.method).toBeUndefined()
      expect(json1.details?.exists).toBeUndefined()
    })

    it('should not reveal internal methods in error details', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: ['greet']
      })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: '_internalHelper', args: [] })
      })

      expect(res.status).toBe(403)
      const json = await res.json()

      // Should use generic error message
      expect(json.message).toBe('Method not allowed')

      // Should not mention that it's an internal method
      expect(json.message).not.toContain('internal')
      expect(json.message).not.toContain('private')
      expect(json.message).not.toContain('_')
    })
  })

  describe('10. Whitelist is case-sensitive', () => {
    it('should reject method with different casing', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: ['greet'] // lowercase
      })

      // Try uppercase
      const res1 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'Greet', args: ['World'] })
      })
      expect(res1.status).toBe(403)

      // Try mixed case
      const res2 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'GREET', args: ['World'] })
      })
      expect(res2.status).toBe(403)

      // Correct case should work
      const res3 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: ['World'] })
      })
      expect(res3.status).toBe(200)
    })

    it('should be case-sensitive for glob patterns', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: ['get*'] // lowercase pattern
      })

      // Correct case should work
      const res1 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'getUser', args: ['123'] })
      })
      expect(res1.status).toBe(200)

      // Different case should fail
      const res2 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'GetUser', args: ['123'] })
      })
      expect(res2.status).toBe(403)

      const res3 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'GETUSER', args: ['123'] })
      })
      expect(res3.status).toBe(403)
    })
  })

  describe('Backward compatibility - no whitelist specified', () => {
    it('should allow all methods when no whitelist is provided (backward compat)', async () => {
      // When no whitelist is specified, the server should behave as before
      // allowing all own property methods (existing behavior)
      const target = new TestService()
      const app = createServer({ target }) // No whitelist option

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: ['World'] })
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toBe('Hello, World!')
    })
  })

  describe('Edge cases', () => {
    it('should handle whitelist with duplicate entries', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: ['greet', 'greet', 'greet']
      })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: ['World'] })
      })

      expect(res.status).toBe(200)
    })

    it('should handle whitelist with empty string entry', async () => {
      const target = new TestService()
      const app = createServer({
        target,
        whitelist: ['', 'greet']
      })

      // Empty string should not match anything
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: '', args: [] })
      })

      // Empty method path is invalid regardless of whitelist
      expect(res.status).toBe(400)
    })

    it('should support nested object method whitelisting', async () => {
      const target = {
        users: {
          create: (data: { name: string }) => ({ id: '1', ...data }),
          list: () => [{ id: '1', name: 'Alice' }],
          _internal: () => 'internal'
        }
      }

      const app = createServer({
        target,
        whitelist: ['users.create', 'users.list']
      })

      const res1 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users.create', args: [{ name: 'Bob' }] })
      })
      expect(res1.status).toBe(200)

      const res2 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users._internal', args: [] })
      })
      expect(res2.status).toBe(403)
    })

    it('should support glob patterns for nested paths', async () => {
      const target = {
        users: {
          get: () => ({ id: '1' }),
          getById: (id: string) => ({ id }),
          create: (data: { name: string }) => ({ id: '1', ...data })
        }
      }

      const app = createServer({
        target,
        whitelist: ['users.get*']
      })

      const res1 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users.get', args: [] })
      })
      expect(res1.status).toBe(200)

      const res2 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users.getById', args: ['123'] })
      })
      expect(res2.status).toBe(200)

      const res3 = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users.create', args: [{ name: 'Bob' }] })
      })
      expect(res3.status).toBe(403)
    })
  })
})
