import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { createCapabilityToken, CapabilityPayload } from '../../rpc/capability-token'

/**
 * DOCore Broker Integration Test Suite - TDD Approach
 *
 * Tests for the rpcCall() method that enables BrokerDO to call methods on DOCore
 * via stub.rpcCall(method, args, capability).
 *
 * This is part of the three-party handoff pattern:
 * 1. Client requests via BrokerDO
 * 2. BrokerDO routes to appropriate worker via rpcCall()
 * 3. Worker verifies capability and executes method
 */

// Helper to get a fresh DOCore instance
function getCore(name = 'broker-test') {
  const id = env.DOCore.idFromName(name)
  return env.DOCore.get(id)
}

// Test secret for capability verification
const TEST_SECRET = 'test-capability-secret-32-bytes!'

// Helper to create a test capability token
async function createTestCapability(
  options: Partial<CapabilityPayload> = {}
): Promise<string> {
  const payload: CapabilityPayload = {
    target: options.target ?? '*',
    methods: options.methods ?? ['*'],
    scope: options.scope ?? 'admin',
    exp: options.exp ?? Date.now() + 3600000, // 1 hour from now
    sub: options.sub ?? 'test-user',
  }
  return createCapabilityToken(payload, TEST_SECRET)
}

describe('DOCore Broker Integration', () => {
  describe('rpcCall() method exposure', () => {
    it('should expose rpcCall() method for broker communication', async () => {
      const core = getCore('rpcCall-expose-1')

      // rpcCall should be a callable method
      expect(typeof core.rpcCall).toBe('function')
    })

    it('should call ping() via rpcCall', async () => {
      const core = getCore('rpcCall-ping-1')

      const result = await core.rpcCall('ping', [])
      expect(result).toBe('pong')
    })

    it('should call add() via rpcCall', async () => {
      const core = getCore('rpcCall-add-1')

      const result = await core.rpcCall('add', [5, 3])
      expect(result).toBe(8)
    })

    it('should call add() with different arguments via rpcCall', async () => {
      const core = getCore('rpcCall-add-2')

      const result = await core.rpcCall('add', [10, 20])
      expect(result).toBe(30)
    })

    it('should return typed results from rpcCall', async () => {
      const core = getCore('rpcCall-typed-1')

      // String result
      const pingResult = await core.rpcCall('ping', [])
      expect(typeof pingResult).toBe('string')

      // Number result
      const addResult = await core.rpcCall('add', [1, 2])
      expect(typeof addResult).toBe('number')
    })
  })

  describe('rpcCall() with get/set operations', () => {
    it('should call set() via rpcCall', async () => {
      const core = getCore('rpcCall-set-1')

      const result = await core.rpcCall('set', ['test-key', 'test-value'])
      expect(result).toBe(true)
    })

    it('should call get() via rpcCall', async () => {
      const core = getCore('rpcCall-get-1')

      // First set a value
      await core.rpcCall('set', ['rpc-key', 'rpc-value'])

      // Then get it back
      const result = await core.rpcCall('get', ['rpc-key'])
      expect(result).toBe('rpc-value')
    })

    it('should call get/set round-trip via rpcCall', async () => {
      const core = getCore('rpcCall-roundtrip-1')

      // Set complex value
      const data = { name: 'Alice', count: 42 }
      await core.rpcCall('set', ['complex-key', data])

      // Get it back
      const result = await core.rpcCall('get', ['complex-key'])
      expect(result).toEqual(data)
    })
  })

  describe('rpcCall() error handling', () => {
    it('should throw on unknown method', async () => {
      const core = getCore('rpcCall-error-1')

      await expect(core.rpcCall('nonExistentMethod', [])).rejects.toThrow(
        'Method not found: nonExistentMethod'
      )
    })

    it('should propagate errors from called methods', async () => {
      const core = getCore('rpcCall-error-2')

      // throwError is an existing method that throws intentionally
      await expect(core.rpcCall('throwError', [])).rejects.toThrow(
        'Intentional error for testing'
      )
    })
  })

  describe('rpcCall() with async methods', () => {
    it('should handle async methods via rpcCall', async () => {
      const core = getCore('rpcCall-async-1')

      const result = await core.rpcCall('asyncOperation', ['test-input'])
      expect(result).toEqual({ status: 'complete', input: 'test-input' })
    })
  })

  describe('Capability verification', () => {
    it('should work standalone (no broker) by default', async () => {
      const core = getCore('capability-standalone-1')

      // Without capability, should work in development mode
      const result = await core.rpcCall('ping', [])
      expect(result).toBe('pong')
    })

    it('should work without capability when no secret is set', async () => {
      const core = getCore('capability-no-secret-1')

      // rpcCall without capability should work when capabilitySecret is not set
      const result = await core.rpcCall('add', [7, 8])
      expect(result).toBe(15)
    })

    it('should verify capabilities when provided with valid token', async () => {
      const core = getCore('capability-verify-1')

      // Set the capability secret first
      await core.setCapabilitySecretForTest(TEST_SECRET)

      // Create a valid capability
      const capability = await createTestCapability({
        methods: ['ping', 'add'],
        scope: 'read',
      })

      // Should succeed with valid capability
      const result = await core.rpcCall('ping', [], capability)
      expect(result).toBe('pong')
    })

    it('should verify capability allows the method being called', async () => {
      const core = getCore('capability-method-1')

      // Set the capability secret
      await core.setCapabilitySecretForTest(TEST_SECRET)

      // Create capability that only allows 'add'
      const capability = await createTestCapability({
        methods: ['add'],
        scope: 'read',
      })

      // Should succeed for 'add'
      const result = await core.rpcCall('add', [2, 3], capability)
      expect(result).toBe(5)
    })

    it('should reject invalid capabilities', async () => {
      const core = getCore('capability-reject-1')

      // Set the capability secret
      await core.setCapabilitySecretForTest(TEST_SECRET)

      // Use an invalid token
      const invalidToken = 'invalid.token.here'

      await expect(core.rpcCall('ping', [], invalidToken)).rejects.toThrow()
    })

    it('should reject expired capabilities', async () => {
      const core = getCore('capability-expired-1')

      // Set the capability secret
      await core.setCapabilitySecretForTest(TEST_SECRET)

      // Create an expired capability
      const capability = await createTestCapability({
        methods: ['*'],
        scope: 'admin',
        exp: Date.now() - 1000, // Expired 1 second ago
      })

      await expect(core.rpcCall('ping', [], capability)).rejects.toThrow('expired')
    })

    it('should reject capabilities that do not allow the method', async () => {
      const core = getCore('capability-method-reject-1')

      // Set the capability secret
      await core.setCapabilitySecretForTest(TEST_SECRET)

      // Create capability that only allows 'ping'
      const capability = await createTestCapability({
        methods: ['ping'],
        scope: 'read',
      })

      // Should fail for 'add' since it's not in the allowed methods
      await expect(core.rpcCall('add', [1, 2], capability)).rejects.toThrow(
        'Method not allowed: add'
      )
    })

    it('should allow wildcard method capabilities', async () => {
      const core = getCore('capability-wildcard-1')

      // Set the capability secret
      await core.setCapabilitySecretForTest(TEST_SECRET)

      // Create capability with wildcard methods
      const capability = await createTestCapability({
        methods: ['*'],
        scope: 'admin',
      })

      // Should work for any method
      const pingResult = await core.rpcCall('ping', [], capability)
      expect(pingResult).toBe('pong')

      const addResult = await core.rpcCall('add', [100, 200], capability)
      expect(addResult).toBe(300)
    })
  })

  describe('Backward compatibility', () => {
    it('should not break existing direct RPC calls', async () => {
      const core = getCore('compat-direct-1')

      // Direct RPC should still work (via stub RPC, which returns promises)
      expect(await core.ping()).toBe('pong')
      expect(await core.add(1, 2)).toBe(3)
    })

    it('should not break existing state operations', async () => {
      const core = getCore('compat-state-1')

      // Direct state operations should still work
      await core.set('direct-key', 'direct-value')
      const result = await core.get('direct-key')
      expect(result).toBe('direct-value')
    })

    it('should not break existing fetch operations', async () => {
      const core = getCore('compat-fetch-1')

      // Fetch should still work
      const response = await core.fetch('https://test.api.dotdo.dev/health')
      expect(response.status).toBe(200)

      const body = (await response.json()) as { path: string }
      expect(body.path).toBe('/health')
    })
  })
})
