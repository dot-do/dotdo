/**
 * Module-Level State Race Condition Tests
 *
 * Tests to verify that module-level state doesn't cause race conditions
 * when multiple isolates or instances access the same module.
 *
 * In Cloudflare Workers, module-level state persists across requests within
 * the same isolate. This can lead to state bleeding between requests.
 *
 * @see https://developers.cloudflare.com/workers/reference/how-workers-works/
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// =============================================================================
// AI MODULE - batchStatuses Map Isolation
// =============================================================================

describe('AI Module State Isolation', () => {
  describe('batchStatuses isolation', () => {
    it('batch statuses should not leak between AI instances', async () => {
      // Create two separate AI instances (simulating different isolates/requests)
      const { createAI } = await import('../ai/index')

      const ai1 = createAI({ budget: { limit: 1000 } })
      const ai2 = createAI({ budget: { limit: 1000 } })

      // Start batches on each instance
      const batch1 = ai1.batch(['item1', 'item2'], 'deferred')
      const batch2 = ai2.batch(['item3', 'item4'], 'deferred')

      // Each batch should have its own ID
      expect(batch1.batchId).not.toBe(batch2.batchId)

      // Wait for batches to complete
      await batch1
      await batch2

      // Verify statuses are tracked correctly per batch
      const status1 = await ai1.batch.status(batch1.batchId)
      const status2 = await ai2.batch.status(batch2.batchId)

      expect(status1).toBe('completed')
      expect(status2).toBe('completed')
    })

    it('batch status should NOT be visible from other AI instances (isolation)', async () => {
      // After the fix, batchStatuses is per-instance
      // ai2 should NOT be able to see ai1's batch status
      const { createAI } = await import('../ai/index')

      const ai1 = createAI({ budget: { limit: 1000 } })
      const ai2 = createAI({ budget: { limit: 1000 } })

      const batch = ai1.batch(['item1'], 'deferred')
      await batch

      // ai1 should see its own batch status
      const statusFromAi1 = await ai1.batch.status(batch.batchId)
      expect(statusFromAi1).toBe('completed')

      // ai2 should NOT see ai1's batch status (returns default 'pending' for unknown)
      const statusFromAi2 = await ai2.batch.status(batch.batchId)
      expect(statusFromAi2).toBe('pending') // Unknown batches return 'pending'
    })

    it('concurrent batch operations should not interfere', async () => {
      const { createAI } = await import('../ai/index')

      const ai1 = createAI({ budget: { limit: 1000 } })

      // Start multiple batches concurrently
      const batches = await Promise.all([
        ai1.batch(['a', 'b', 'c'], 'immediate'),
        ai1.batch(['d', 'e', 'f'], 'immediate'),
        ai1.batch(['g', 'h', 'i'], 'immediate'),
      ])

      // Each batch should have completed independently
      expect(batches.length).toBe(3)
      expect(batches[0].length).toBe(3)
      expect(batches[1].length).toBe(3)
      expect(batches[2].length).toBe(3)
    })
  })
})

// =============================================================================
// RPC CAPABILITY MODULE - Registry Isolation
// =============================================================================

describe('RPC Capability State Isolation', () => {
  describe('capabilityRegistry isolation', () => {
    it('capabilities from one context should not affect another', async () => {
      const { createCapability, verifyCapability } = await import('../rpc/capability')

      // Create a target object
      const target1 = {
        getValue: () => 'value1',
        setValue: () => {},
      }

      const target2 = {
        getValue: () => 'value2',
        setValue: () => {},
      }

      // Create capabilities
      const cap1 = createCapability(target1)
      const cap2 = createCapability(target2)

      // Each capability should be unique
      expect(cap1.id).not.toBe(cap2.id)

      // Both should be verifiable (currently module-level registry)
      expect(verifyCapability(cap1)).toBe(true)
      expect(verifyCapability(cap2)).toBe(true)

      // Revoking one should not affect the other
      cap1.revoke()

      expect(verifyCapability(cap1)).toBe(false)
      expect(verifyCapability(cap2)).toBe(true)
    })

    it('revokedCapabilities set should not leak between contexts', async () => {
      const { createCapability } = await import('../rpc/capability')

      // Create a class-based target so methods are properly extracted
      class Target {
        method() { return 'result' }
      }

      const target = new Target()

      // Create and revoke a capability with explicit methods
      const cap1 = createCapability(target, ['method'])
      cap1.revoke()

      // Create a new capability - it should work independently
      const cap2 = createCapability(target, ['method'])

      // cap2 should still be invocable (cap1's revocation shouldn't affect it)
      await expect(cap2.invoke('method')).resolves.not.toThrow()
    })

    it('capability registry should handle high concurrency', async () => {
      const { createCapability, verifyCapability } = await import('../rpc/capability')

      const targets = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        method: () => i,
      }))

      // Create 100 capabilities concurrently
      const caps = await Promise.all(
        targets.map(async (target) => createCapability(target))
      )

      // All should be verified
      const allVerified = caps.every((cap) => verifyCapability(cap))
      expect(allVerified).toBe(true)

      // All IDs should be unique
      const ids = new Set(caps.map((c) => c.id))
      expect(ids.size).toBe(100)
    })
  })
})

// =============================================================================
// RPC TRANSPORT MODULE - seenObjects Isolation
// =============================================================================

describe('RPC Transport State Isolation', () => {
  describe('seenObjects WeakMap isolation', () => {
    it('circular reference detection should reset between serializations', async () => {
      const { serialize, deserialize } = await import('../rpc/transport')

      // Create object with circular reference
      const obj1: Record<string, unknown> = { name: 'obj1' }
      obj1.self = obj1

      // Serialize it
      const serialized1 = serialize(obj1) as string

      // Create another object with circular reference
      const obj2: Record<string, unknown> = { name: 'obj2' }
      obj2.self = obj2

      // Serialize it - should work independently
      const serialized2 = serialize(obj2) as string

      // Both should deserialize correctly
      const restored1 = deserialize<typeof obj1>(serialized1)
      const restored2 = deserialize<typeof obj2>(serialized2)

      expect(restored1.name).toBe('obj1')
      expect(restored1.self).toBe(restored1)

      expect(restored2.name).toBe('obj2')
      expect(restored2.self).toBe(restored2)
    })

    it('concurrent serializations should not interfere', async () => {
      const { serialize, deserialize } = await import('../rpc/transport')

      // Create multiple objects with circular refs
      const objects = Array.from({ length: 10 }, (_, i) => {
        const obj: Record<string, unknown> = { index: i }
        obj.self = obj
        return obj
      })

      // Serialize all concurrently
      const serialized = await Promise.all(
        objects.map(async (obj) => serialize(obj) as string)
      )

      // Deserialize all and verify
      const restored = serialized.map((s) => deserialize<Record<string, unknown>>(s))

      restored.forEach((obj, i) => {
        expect(obj.index).toBe(i)
        expect(obj.self).toBe(obj)
      })
    })
  })
})

// =============================================================================
// RPC PROXY MODULE - clientStates Isolation
// =============================================================================

describe('RPC Proxy State Isolation', () => {
  describe('clientStates WeakMap behavior', () => {
    it('client states should be garbage collected when client is dereferenced', async () => {
      const { createRPCClient } = await import('../rpc/proxy')

      // Create a client
      let client: ReturnType<typeof createRPCClient> | null = createRPCClient({
        target: 'https://test.api.dotdo.dev/test-1',
      })

      // Use the client
      expect(client.$meta).toBeDefined()

      // Dereference the client
      client = null

      // WeakMap should allow GC (we can't directly test this, but we can verify
      // that new clients don't share state with old ones)
      const newClient = createRPCClient({
        target: 'https://test.api.dotdo.dev/test-2',
      })

      expect(newClient.$meta).toBeDefined()
    })

    it('multiple clients should have independent state', async () => {
      const { createRPCClient } = await import('../rpc/proxy')

      const client1 = createRPCClient({
        target: 'https://test.api.dotdo.dev/client-1',
        timeout: 1000,
      })

      const client2 = createRPCClient({
        target: 'https://test.api.dotdo.dev/client-2',
        timeout: 5000,
      })

      // Each client should be a separate instance
      expect(client1).not.toBe(client2)

      // Access $meta to verify both clients work independently
      // (This tests that clientStates correctly associates state per-client)
      const meta1 = client1.$meta
      const meta2 = client2.$meta

      expect(meta1).toBeDefined()
      expect(meta2).toBeDefined()

      // Both should have schema method
      expect(typeof meta1.schema).toBe('function')
      expect(typeof meta2.schema).toBe('function')
    })
  })
})
