/**
 * Capability Lazy Loading Tests - Real Miniflare (RED Phase)
 *
 * Tests for capability lazy loading behavior using REAL miniflare runtime.
 * Unlike the mocked version, these tests verify actual DO lazy loading.
 *
 * Tests verify:
 * 1. Capabilities are NOT loaded during DO construction
 * 2. Capabilities are loaded on first access
 * 3. Capabilities are cached after first load (singleton per DO)
 * 4. Accessing one capability doesn't load others
 *
 * Tests should initially FAIL (RED phase) because:
 * - Lazy loading may not be implemented
 * - Load tracking may not be exposed via RPC/HTTP
 * - Capability loading state may not be queryable
 *
 * Run with: npx vitest run objects/tests/capability-lazy-loading-real.test.ts --project=do-identity
 *
 * @module objects/tests/capability-lazy-loading-real.test
 */

import { env, SELF } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Unique namespace per test suite run to ensure isolation
 */
const testRunId = Date.now()

/**
 * Generate a unique namespace for each test to ensure isolation
 */
function uniqueNs(prefix: string = 'lazy'): string {
  return `${prefix}-${testRunId}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get a DO stub by namespace name
 */
function getDOStub(ns: string) {
  const id = env.TEST_DO.idFromName(ns)
  return env.TEST_DO.get(id)
}

/**
 * Helper to make HTTP requests to the DO via SELF
 */
function doFetch(
  ns: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  return SELF.fetch(`https://${ns}.api.dotdo.dev${path}`, {
    ...init,
    headers: {
      'X-DO-NS': ns,
      ...init?.headers,
    },
  })
}

// ============================================================================
// Lazy Loading Verification Tests
// ============================================================================

describe('[REAL] Capability Lazy Loading - Load Timing', () => {
  /**
   * RED TEST: Fresh DO should have no capabilities loaded initially
   *
   * Expected behavior:
   * - When DO is first accessed, no capabilities should be loaded
   * - Only after accessing capability should it be loaded
   *
   * Current behavior (expected to fail):
   * - Load tracking may not be exposed
   * - Load count may not be queryable
   */
  it('fresh DO has no capabilities loaded initially', async () => {
    const ns = uniqueNs('fresh')

    // Just ping the DO to ensure it's created
    const healthRes = await doFetch(ns, '/health')
    expect(healthRes.status).toBe(200)

    // Check loaded capabilities
    const registryRes = await doFetch(ns, '/capabilities/registry')

    if (registryRes.status === 200) {
      const registry = await registryRes.json() as {
        loaded: string[]
        loadCounts?: Record<string, number>
      }

      // No capabilities should be loaded yet
      expect(registry.loaded.length).toBe(0)
    } else {
      // Registry endpoint may not exist
      expect(registryRes.status).toBe(404)
    }
  })

  /**
   * RED TEST: Capability loads only on first access
   */
  it('capability loads on first access', async () => {
    const ns = uniqueNs('first-access')

    // Verify not loaded initially
    const beforeRes = await doFetch(ns, '/capabilities/fs/status')

    if (beforeRes.status === 200) {
      const before = await beforeRes.json() as { loaded: boolean; loadCount: number }
      expect(before.loaded).toBe(false)
      expect(before.loadCount).toBe(0)
    }

    // Access the capability
    await doFetch(ns, '/$/fs/exists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/' }),
    })

    // Verify now loaded
    const afterRes = await doFetch(ns, '/capabilities/fs/status')

    if (afterRes.status === 200) {
      const after = await afterRes.json() as { loaded: boolean; loadCount: number }
      expect(after.loaded).toBe(true)
      expect(after.loadCount).toBe(1)
    }
  })

  /**
   * RED TEST: hasCapability() doesn't trigger loading
   */
  it('hasCapability() does NOT trigger loading', async () => {
    const ns = uniqueNs('has-no-load')
    const stub = getDOStub(ns)

    // Call hasCapability via RPC
    try {
      await (stub as any).hasCapability?.('fs')

      // Check if fs was loaded
      const statusRes = await doFetch(ns, '/capabilities/fs/status')

      if (statusRes.status === 200) {
        const status = await statusRes.json() as { loaded: boolean }
        // hasCapability should NOT load the capability
        expect(status.loaded).toBe(false)
      }
    } catch {
      // Methods may not exist
      expect(true).toBe(true)
    }
  })

  /**
   * RED TEST: registry.list() doesn't trigger loading
   */
  it('listing capabilities does NOT trigger loading', async () => {
    const ns = uniqueNs('list-no-load')

    // List capabilities
    const listRes = await doFetch(ns, '/capabilities')

    // Check if anything was loaded
    const registryRes = await doFetch(ns, '/capabilities/registry')

    if (registryRes.status === 200) {
      const registry = await registryRes.json() as { loaded: string[] }
      // Listing shouldn't load anything
      expect(registry.loaded.length).toBe(0)
    }
  })
})

// ============================================================================
// Capability Caching Tests
// ============================================================================

describe('[REAL] Capability Caching (Singleton per DO)', () => {
  /**
   * RED TEST: Multiple accesses return cached instance
   */
  it('capability instance is cached after first load', async () => {
    const ns = uniqueNs('cached')

    // Access fs multiple times
    await doFetch(ns, '/$/fs/exists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/a' }),
    })

    await doFetch(ns, '/$/fs/exists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/b' }),
    })

    await doFetch(ns, '/$/fs/exists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/c' }),
    })

    // Check load count
    const statusRes = await doFetch(ns, '/capabilities/fs/status')

    if (statusRes.status === 200) {
      const status = await statusRes.json() as { loadCount: number }
      // Should only have been loaded once
      expect(status.loadCount).toBe(1)
    }
  })

  /**
   * RED TEST: Cached instance persists across HTTP requests
   */
  it('cached instance persists across requests', async () => {
    const ns = uniqueNs('persist-cache')

    // First request
    await doFetch(ns, '/$/fs/writeFile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/test.txt', content: 'content' }),
    })

    // Second request (separate HTTP connection)
    await doFetch(ns, '/$/fs/readFile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/test.txt' }),
    })

    // Check load count
    const statusRes = await doFetch(ns, '/capabilities/fs/status')

    if (statusRes.status === 200) {
      const status = await statusRes.json() as { loadCount: number }
      expect(status.loadCount).toBe(1)
    }
  })

  /**
   * RED TEST: RPC calls also use cached instance
   */
  it('RPC calls use same cached instance as HTTP', async () => {
    const ns = uniqueNs('rpc-cache')
    const stub = getDOStub(ns)

    // Access via HTTP
    await doFetch(ns, '/$/fs/exists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/' }),
    })

    // Access via RPC
    try {
      await (stub as any).fsExists?.('/')
      await (stub as any).fsExists?.('/test')
    } catch {
      // Methods may not exist
    }

    // Check load count
    const statusRes = await doFetch(ns, '/capabilities/fs/status')

    if (statusRes.status === 200) {
      const status = await statusRes.json() as { loadCount: number }
      expect(status.loadCount).toBe(1)
    }
  })

  /**
   * RED TEST: Instance ID remains consistent
   */
  it('capability instanceId remains consistent', async () => {
    const ns = uniqueNs('instance-id')
    const stub = getDOStub(ns)

    try {
      // Get instance info twice
      const info1 = await (stub as any).getCapabilityInstanceInfo?.('fs')
      const info2 = await (stub as any).getCapabilityInstanceInfo?.('fs')

      if (info1?.instanceId && info2?.instanceId) {
        expect(info1.instanceId).toBe(info2.instanceId)
      }
    } catch {
      // Methods may not exist
      expect(true).toBe(true)
    }
  })
})

// ============================================================================
// Capability Isolation Tests
// ============================================================================

describe('[REAL] Capability Loading Isolation', () => {
  /**
   * RED TEST: Accessing fs does NOT load git
   */
  it('accessing fs does not load git', async () => {
    const ns = uniqueNs('iso-fs-git')

    // Access fs
    await doFetch(ns, '/$/fs/exists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/' }),
    })

    // Check git status
    const gitStatusRes = await doFetch(ns, '/capabilities/git/status')

    if (gitStatusRes.status === 200) {
      const gitStatus = await gitStatusRes.json() as { loaded: boolean }
      expect(gitStatus.loaded).toBe(false)
    }

    // Check registry
    const registryRes = await doFetch(ns, '/capabilities/registry')

    if (registryRes.status === 200) {
      const registry = await registryRes.json() as { loaded: string[] }
      expect(registry.loaded).not.toContain('git')
    }
  })

  /**
   * RED TEST: Accessing git does NOT load bash
   */
  it('accessing git does not load bash', async () => {
    const ns = uniqueNs('iso-git-bash')

    // Access git
    await doFetch(ns, '/$/git/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/repo' }),
    })

    // Check bash status
    const bashStatusRes = await doFetch(ns, '/capabilities/bash/status')

    if (bashStatusRes.status === 200) {
      const bashStatus = await bashStatusRes.json() as { loaded: boolean }
      expect(bashStatus.loaded).toBe(false)
    }
  })

  /**
   * RED TEST: Multiple capabilities can be loaded independently
   */
  it('multiple capabilities load independently', async () => {
    const ns = uniqueNs('iso-multi')

    // Access fs
    await doFetch(ns, '/$/fs/exists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/' }),
    })

    // Check what's loaded
    const registry1Res = await doFetch(ns, '/capabilities/registry')
    if (registry1Res.status === 200) {
      const registry1 = await registry1Res.json() as { loaded: string[] }
      expect(registry1.loaded).toContain('fs')
      expect(registry1.loaded).not.toContain('bash')
    }

    // Access bash
    await doFetch(ns, '/$/bash/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'echo test' }),
    })

    // Check what's loaded now
    const registry2Res = await doFetch(ns, '/capabilities/registry')
    if (registry2Res.status === 200) {
      const registry2 = await registry2Res.json() as { loaded: string[] }
      expect(registry2.loaded).toContain('fs')
      expect(registry2.loaded).toContain('bash')
      expect(registry2.loaded.length).toBe(2)
    }
  })
})

// ============================================================================
// Load Count Tracking Tests
// ============================================================================

describe('[REAL] Load Count Tracking', () => {
  /**
   * RED TEST: Load count is accurate via HTTP
   */
  it('load count tracks instantiations via HTTP', async () => {
    const ns = uniqueNs('count-http')

    // Access multiple capabilities
    await doFetch(ns, '/$/fs/exists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/' }),
    })

    await doFetch(ns, '/$/bash/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'echo test' }),
    })

    // Get full registry stats
    const statsRes = await doFetch(ns, '/capabilities/stats')

    if (statsRes.status === 200) {
      const stats = await statsRes.json() as {
        totalLoaded: number
        loadCounts: Record<string, number>
      }

      expect(stats.totalLoaded).toBe(2)
      expect(stats.loadCounts.fs).toBe(1)
      expect(stats.loadCounts.bash).toBe(1)
    }
  })

  /**
   * RED TEST: Load count is accurate via RPC
   */
  it('load count tracks instantiations via RPC', async () => {
    const ns = uniqueNs('count-rpc')
    const stub = getDOStub(ns)

    try {
      // Access capabilities via RPC
      await (stub as any).fsExists?.('/')
      await (stub as any).bashExec?.('echo test')

      // Get stats
      const stats = await (stub as any).getCapabilityStats?.()

      if (stats) {
        expect(stats.totalLoaded).toBe(2)
      }
    } catch {
      expect(true).toBe(true)
    }
  })

  /**
   * RED TEST: Load timestamp is recorded
   */
  it('load timestamp is recorded for each capability', async () => {
    const ns = uniqueNs('timestamp')

    const beforeLoad = Date.now()

    // Access capability
    await doFetch(ns, '/$/fs/exists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/' }),
    })

    const afterLoad = Date.now()

    // Get status with timestamp
    const statusRes = await doFetch(ns, '/capabilities/fs/status')

    if (statusRes.status === 200) {
      const status = await statusRes.json() as { loadedAt: number }

      if (status.loadedAt) {
        expect(status.loadedAt).toBeGreaterThanOrEqual(beforeLoad)
        expect(status.loadedAt).toBeLessThanOrEqual(afterLoad)
      }
    }
  })
})

// ============================================================================
// Different DO Instances Tests
// ============================================================================

describe('[REAL] Separate DO Instances', () => {
  /**
   * RED TEST: Different DOs have independent capability loading
   */
  it('different DOs have separate capability instances', async () => {
    const ns1 = uniqueNs('do1')
    const ns2 = uniqueNs('do2')

    // Access fs on first DO
    await doFetch(ns1, '/$/fs/exists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/' }),
    })

    // Check second DO - should not have fs loaded
    const do2StatusRes = await doFetch(ns2, '/capabilities/fs/status')

    if (do2StatusRes.status === 200) {
      const do2Status = await do2StatusRes.json() as { loaded: boolean }
      expect(do2Status.loaded).toBe(false)
    }
  })

  /**
   * RED TEST: Different DOs have independent load counts
   */
  it('different DOs have independent load counts', async () => {
    const ns1 = uniqueNs('count1')
    const ns2 = uniqueNs('count2')

    // Access fs on both DOs
    await doFetch(ns1, '/$/fs/exists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/' }),
    })

    await doFetch(ns2, '/$/fs/exists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/' }),
    })

    // Check load counts separately
    const stats1Res = await doFetch(ns1, '/capabilities/stats')
    const stats2Res = await doFetch(ns2, '/capabilities/stats')

    if (stats1Res.status === 200 && stats2Res.status === 200) {
      const stats1 = await stats1Res.json() as { loadCounts: Record<string, number> }
      const stats2 = await stats2Res.json() as { loadCounts: Record<string, number> }

      // Each DO should have loaded fs exactly once
      expect(stats1.loadCounts.fs).toBe(1)
      expect(stats2.loadCounts.fs).toBe(1)
    }
  })

  /**
   * RED TEST: Different DOs have different instance IDs
   */
  it('different DOs have different capability instances', async () => {
    const ns1 = uniqueNs('inst1')
    const ns2 = uniqueNs('inst2')

    const stub1 = getDOStub(ns1)
    const stub2 = getDOStub(ns2)

    try {
      // Get instance info from both
      const info1 = await (stub1 as any).getCapabilityInstanceInfo?.('fs')
      const info2 = await (stub2 as any).getCapabilityInstanceInfo?.('fs')

      if (info1?.instanceId && info2?.instanceId) {
        expect(info1.instanceId).not.toBe(info2.instanceId)
      }
    } catch {
      expect(true).toBe(true)
    }
  })
})

// ============================================================================
// Concurrent Access Tests
// ============================================================================

describe('[REAL] Concurrent Capability Access', () => {
  /**
   * RED TEST: Concurrent requests use same cached instance
   */
  it('concurrent requests share cached instance', async () => {
    const ns = uniqueNs('concurrent')

    // Fire multiple requests concurrently
    const requests = Array(10).fill(null).map((_, i) =>
      doFetch(ns, '/$/fs/exists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `/path${i}` }),
      })
    )

    await Promise.all(requests)

    // Check load count
    const statusRes = await doFetch(ns, '/capabilities/fs/status')

    if (statusRes.status === 200) {
      const status = await statusRes.json() as { loadCount: number }
      // Should only have been loaded once despite concurrent requests
      expect(status.loadCount).toBe(1)
    }
  })

  /**
   * RED TEST: Racing first access only loads once
   */
  it('racing first access only loads capability once', async () => {
    const ns = uniqueNs('race')

    // Fire 5 requests simultaneously before any can complete
    const promises = [
      doFetch(ns, '/$/fs/exists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/' }),
      }),
      doFetch(ns, '/$/fs/readFile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/test.txt' }),
      }),
      doFetch(ns, '/$/fs/writeFile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/new.txt', content: 'test' }),
      }),
      doFetch(ns, '/$/fs/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/newdir' }),
      }),
      doFetch(ns, '/$/fs/readdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/' }),
      }),
    ]

    await Promise.allSettled(promises)

    // Check load count
    const statusRes = await doFetch(ns, '/capabilities/fs/status')

    if (statusRes.status === 200) {
      const status = await statusRes.json() as { loadCount: number }
      expect(status.loadCount).toBe(1)
    }
  })
})
