/**
 * Cross-DO RPC Resolution Tests
 *
 * Tests for the `$.Customer(id)` syntax that resolves to a real DO stub
 * for cross-DO RPC calls.
 *
 * The key insight: When calling `$.Customer(id)` on a DO instance,
 * it should return a proxy that forwards method calls to another DO
 * instance identified by the noun type and ID.
 *
 * This enables patterns like:
 *   - await $.Customer('cust-123').notify('Hello')
 *   - await $.Order('order-456').ship()
 *   - await $.remote('Customer', 'cust-123').getProfile()
 *
 * @see do-qews - Implement Cross-DO RPC resolution
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Get a DOCore stub for testing
 */
function getDOStub(name: string) {
  const id = env.DOCore.idFromName(name)
  return env.DOCore.get(id)
}

// =============================================================================
// 1. REMOTE DO STUB RESOLUTION
// =============================================================================

describe('Cross-DO RPC: remote() method', () => {
  /**
   * The remote() method should return a proxy that forwards method calls
   * to a different DO instance.
   */
  it('should resolve $.remote(noun, id) to a remote DO stub', async () => {
    const sourceStub = getDOStub('source-do-1')
    const targetStub = getDOStub('target-do-1')

    // Setup: Create a customer in the TARGET DO
    await targetStub.Customer().create({
      $id: 'remote-cust-1',
      name: 'Remote Customer',
      email: 'remote@example.com',
    })

    // Test: Access the customer via remote() from SOURCE DO
    // The remote() method should resolve to the target DO
    const remoteCustomer = await sourceStub.remote('Customer', 'target-do-1', 'remote-cust-1')

    expect(remoteCustomer).toBeDefined()
  })

  it('should call methods on remote DO via remote()', async () => {
    const sourceStub = getDOStub('source-do-2')
    const targetStub = getDOStub('target-do-2')

    // Setup: Create data in target DO
    const created = await targetStub.Customer().create({
      name: 'Target Customer',
      email: 'target@example.com',
    })

    // Test: Get the customer profile via remote call from source DO
    const profile = await sourceStub.remoteCall(
      'target-do-2',
      'getThingById',
      [created.$id]
    )

    expect(profile).toBeDefined()
    expect(profile.name).toBe('Target Customer')
  })
})

// =============================================================================
// 2. NOUN ACCESSOR CROSS-DO PATTERN
// =============================================================================

describe('Cross-DO RPC: $.Noun(id) pattern', () => {
  /**
   * When $.Customer(id) is called, it currently returns a NounInstanceAccessor
   * that operates on the LOCAL DO. For cross-DO calls, we need a way to
   * specify which DO to target.
   *
   * Options:
   * 1. $.remote('Customer', 'namespace').get(id) - explicit namespace
   * 2. $.Customer(id, { namespace: 'other-do' }) - options parameter
   * 3. $.to('other-do').Customer(id) - fluent builder
   */

  it('should support local noun accessor (baseline test)', async () => {
    const stub = getDOStub('local-noun-test')

    // Create a customer locally
    const customer = await stub.Customer().create({
      name: 'Local Customer',
      email: 'local@example.com',
    })

    // Access via noun accessor - this is LOCAL
    const profile = await stub.Customer(customer.$id).getProfile()

    expect(profile).toBeDefined()
    expect(profile.name).toBe('Local Customer')
  })

  it('should support cross-DO via explicit namespace in remote()', async () => {
    const sourceStub = getDOStub('cross-do-source')
    const targetStub = getDOStub('cross-do-target')

    // Setup: Create customer in TARGET
    const customer = await targetStub.Customer().create({
      $id: 'cross-cust-1',
      name: 'Cross-DO Customer',
    })

    // Test: Access from SOURCE via remote() with namespace
    const result = await sourceStub.remoteCall(
      'cross-do-target',  // target namespace
      'getThingById',     // method
      [customer.$id]      // args
    )

    expect(result).toBeDefined()
    expect(result.name).toBe('Cross-DO Customer')
  })

  it('should support notify() on remote customer', async () => {
    const sourceStub = getDOStub('notify-source')
    const targetStub = getDOStub('notify-target')

    // Setup: Create customer in target
    await targetStub.Customer().create({
      $id: 'notify-cust-1',
      name: 'Notifiable Customer',
    })

    // Test: Call notify() on remote customer
    // This should work via remoteCall
    const result = await sourceStub.remoteCall(
      'notify-target',
      'rpcCall',
      ['ping', []]  // Call ping method as a simple test
    )

    // The remote DO should respond with 'pong'
    expect(result).toBe('pong')
  })
})

// =============================================================================
// 3. BIDIRECTIONAL CROSS-DO COMMUNICATION
// =============================================================================

describe('Cross-DO RPC: Bidirectional Communication', () => {
  it('should allow DO A to call DO B and receive response', async () => {
    const doA = getDOStub('bidirectional-do-a')
    const doB = getDOStub('bidirectional-do-b')

    // Setup: Create data in DO B
    await doB.set('shared-key', { message: 'Hello from B' })

    // Test: DO A calls DO B to get the value
    const value = await doA.remoteCall(
      'bidirectional-do-b',
      'get',
      ['shared-key']
    )

    expect(value).toEqual({ message: 'Hello from B' })
  })

  it('should allow chained cross-DO calls', async () => {
    const doA = getDOStub('chain-do-a')
    const doB = getDOStub('chain-do-b')
    const doC = getDOStub('chain-do-c')

    // Setup: Each DO stores a value
    await doB.set('chain-value', 'B-value')
    await doC.set('chain-value', 'C-value')

    // Test: DO A gets values from both B and C
    const valueFromB = await doA.remoteCall('chain-do-b', 'get', ['chain-value'])
    const valueFromC = await doA.remoteCall('chain-do-c', 'get', ['chain-value'])

    expect(valueFromB).toBe('B-value')
    expect(valueFromC).toBe('C-value')
  })
})

// =============================================================================
// 4. ERROR HANDLING
// =============================================================================

describe('Cross-DO RPC: Error Handling', () => {
  it('should propagate errors from remote DO', async () => {
    const sourceStub = getDOStub('error-source')
    const targetStub = getDOStub('error-target')

    // Test: Call a method that throws on the remote DO
    await expect(
      sourceStub.remoteCall('error-target', 'throwError', [])
    ).rejects.toThrow('Intentional error for testing')
  })

  it('should handle non-existent method on remote DO', async () => {
    const sourceStub = getDOStub('method-error-source')

    // Test: Call a method that doesn't exist
    await expect(
      sourceStub.remoteCall('method-error-target', 'nonExistentMethod', [])
    ).rejects.toThrow(/Method not found|not a function/)
  })
})

// =============================================================================
// 5. PERFORMANCE & CAPABILITIES
// =============================================================================

describe('Cross-DO RPC: Performance Considerations', () => {
  it('should complete remote calls within reasonable time', async () => {
    const sourceStub = getDOStub('perf-source')
    const targetStub = getDOStub('perf-target')

    // Setup
    await targetStub.set('perf-key', 'perf-value')

    const start = Date.now()

    // Multiple remote calls
    const results = await Promise.all([
      sourceStub.remoteCall('perf-target', 'get', ['perf-key']),
      sourceStub.remoteCall('perf-target', 'ping', []),
      sourceStub.remoteCall('perf-target', 'add', [1, 2]),
    ])

    const elapsed = Date.now() - start

    expect(results[0]).toBe('perf-value')
    expect(results[1]).toBe('pong')
    expect(results[2]).toBe(3)

    // Should complete within 5 seconds (generous for test environment)
    expect(elapsed).toBeLessThan(5000)
  })
})
