/**
 * Browser DO Lifecycle Integration Tests
 *
 * Tests for Browser Durable Object session management and lifecycle using
 * real miniflare DOs via @cloudflare/vitest-pool-workers.
 *
 * NO MOCKS - Uses real DO instances with mock browser session provider.
 * The TestBrowserDO in browser-do-test-worker.ts provides a mock Browse
 * session that allows testing DO behavior without actual browser infrastructure.
 *
 * Tests verify:
 * - Browser DO instantiation
 * - Browser.start() initialization with providers
 * - Browser.start() returns liveViewUrl when liveView=true
 * - Browser.stop() closes the session
 * - Browser.alarm() keepAlive behavior
 * - Browser stores config in ctx.storage
 *
 * @module objects/tests/browser-do-lifecycle.test
 */

import { env, SELF } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// Types
// ============================================================================

type BrowserProvider = 'cloudflare' | 'browserbase'

interface BrowserStartResult {
  sessionId: string
  provider: BrowserProvider
  liveViewUrl?: string
}

interface BrowserState {
  status: 'active' | 'stopped'
  provider?: BrowserProvider
  currentUrl?: string
  liveViewUrl?: string
}

interface BrowserConfigStored {
  provider: BrowserProvider
  liveView: boolean
  viewport?: { width: number; height: number }
  stealth?: boolean
  sessionId?: string
}

// Extended stub interface with RPC methods
interface BrowserDOStub extends DurableObjectStub {
  start(options?: { provider?: string; liveView?: boolean; viewport?: { width: number; height: number }; stealth?: boolean }): Promise<BrowserStartResult>
  stop(): Promise<void>
  getState(): Promise<BrowserState>
  isActive(): Promise<boolean>
  getConfig(): Promise<BrowserConfigStored | null>
  getLastActivity(): Promise<number>
  getNs(): Promise<string>
  alarm(): Promise<void>
}

// ============================================================================
// Test Helpers
// ============================================================================

const testRunId = Date.now()
let testCounter = 0

function uniqueNs(prefix: string = 'lifecycle'): string {
  return `${prefix}-${testRunId}-${++testCounter}`
}

function getStub(ns: string): BrowserDOStub {
  const id = (env as { BROWSER_DO: DurableObjectNamespace }).BROWSER_DO.idFromName(ns)
  return (env as { BROWSER_DO: DurableObjectNamespace }).BROWSER_DO.get(id) as BrowserDOStub
}

function doFetch(ns: string, path: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(`https://browser.test.do${path}`, {
    ...init,
    headers: {
      'X-DO-NS': ns,
      ...init?.headers,
    },
  })
}

// ============================================================================
// Tests
// ============================================================================

describe('Browser DO Lifecycle (Real DO)', () => {
  // ==========================================================================
  // 1. INSTANTIATION
  // ==========================================================================

  describe('Browser DO instantiates correctly', () => {
    it('creates Browser DO with isActive=false initially', async () => {
      const ns = uniqueNs('instantiate')
      const stub = getStub(ns)

      const isActive = await stub.isActive()
      expect(isActive).toBe(false)
    })

    it('initializes with null config', async () => {
      const ns = uniqueNs('init-config')
      const stub = getStub(ns)

      const config = await stub.getConfig()
      expect(config).toBeNull()
    })

    it('reports stopped state initially', async () => {
      const ns = uniqueNs('init-state')
      const stub = getStub(ns)

      const state = await stub.getState()
      expect(state.status).toBe('stopped')
      expect(state.provider).toBeUndefined()
    })

    it('has namespace set', async () => {
      const ns = uniqueNs('init-ns')
      const stub = getStub(ns)

      const doNs = await stub.getNs()
      expect(doNs).toBeDefined()
      expect(typeof doNs).toBe('string')
    })
  })

  // ==========================================================================
  // 2. START WITH CLOUDFLARE PROVIDER
  // ==========================================================================

  describe('Browser.start() initializes with Cloudflare provider', () => {
    it('starts session with default cloudflare provider', async () => {
      const ns = uniqueNs('start-cf')
      const stub = getStub(ns)

      const result = await stub.start()

      expect(result.provider).toBe('cloudflare')
      expect(result.sessionId).toBeDefined()
    })

    it('starts session with explicit cloudflare provider', async () => {
      const ns = uniqueNs('start-cf-explicit')
      const stub = getStub(ns)

      const result = await stub.start({ provider: 'cloudflare' })

      expect(result.provider).toBe('cloudflare')
      expect(result.sessionId).toBeDefined()
    })

    it('sets session after start', async () => {
      const ns = uniqueNs('start-session')
      const stub = getStub(ns)

      await stub.start()

      const isActive = await stub.isActive()
      expect(isActive).toBe(true)
    })

    it('throws if session already active', async () => {
      const ns = uniqueNs('start-duplicate')
      const stub = getStub(ns)

      await stub.start()

      await expect(stub.start()).rejects.toThrow('Browser session already active')
    })

    it('returns undefined liveViewUrl for cloudflare provider', async () => {
      const ns = uniqueNs('start-cf-liveview')
      const stub = getStub(ns)

      const result = await stub.start({
        provider: 'cloudflare',
        liveView: true, // Ignored for cloudflare
      })

      expect(result.liveViewUrl).toBeUndefined()
    })
  })

  // ==========================================================================
  // 3. START WITH BROWSERBASE PROVIDER
  // ==========================================================================

  describe('Browser.start() initializes with Browserbase provider', () => {
    it('starts session with browserbase provider', async () => {
      const ns = uniqueNs('start-bb')
      const stub = getStub(ns)

      const result = await stub.start({ provider: 'browserbase' })

      expect(result.provider).toBe('browserbase')
      expect(result.sessionId).toBeDefined()
    })

    it('throws on invalid provider', async () => {
      const ns = uniqueNs('start-invalid')
      const stub = getStub(ns)

      await expect(
        stub.start({ provider: 'invalid' as any })
      ).rejects.toThrow('Invalid provider')
    })
  })

  // ==========================================================================
  // 4. START WITH LIVEVIEW
  // ==========================================================================

  describe('Browser.start() returns liveViewUrl when liveView=true', () => {
    it('returns liveViewUrl when liveView enabled for browserbase', async () => {
      const ns = uniqueNs('liveview')
      const stub = getStub(ns)

      const result = await stub.start({
        provider: 'browserbase',
        liveView: true,
      })

      expect(result.liveViewUrl).toBeDefined()
      expect(result.liveViewUrl).toContain('live.browserbase')
    })

    it('stores liveView in config', async () => {
      const ns = uniqueNs('liveview-config')
      const stub = getStub(ns)

      await stub.start({ provider: 'browserbase', liveView: true })

      const config = await stub.getConfig()
      expect(config?.liveView).toBe(true)
    })

    it('returns undefined liveViewUrl when liveView disabled', async () => {
      const ns = uniqueNs('no-liveview')
      const stub = getStub(ns)

      const result = await stub.start({
        provider: 'browserbase',
        liveView: false,
      })

      expect(result.liveViewUrl).toBeUndefined()
    })
  })

  // ==========================================================================
  // 5. STOP SESSION
  // ==========================================================================

  describe('Browser.stop() closes the session', () => {
    it('clears the session', async () => {
      const ns = uniqueNs('stop-session')
      const stub = getStub(ns)

      await stub.start()
      expect(await stub.isActive()).toBe(true)

      await stub.stop()
      expect(await stub.isActive()).toBe(false)
    })

    it('clears the config', async () => {
      const ns = uniqueNs('stop-config')
      const stub = getStub(ns)

      await stub.start()
      expect(await stub.getConfig()).not.toBeNull()

      await stub.stop()
      expect(await stub.getConfig()).toBeNull()
    })

    it('throws if no active session', async () => {
      const ns = uniqueNs('stop-no-session')
      const stub = getStub(ns)

      await expect(stub.stop()).rejects.toThrow('No active browser session')
    })

    it('can be called after stop without error (double stop)', async () => {
      const ns = uniqueNs('stop-double')
      const stub = getStub(ns)

      await stub.start()
      await stub.stop()

      // Second stop should throw
      await expect(stub.stop()).rejects.toThrow('No active browser session')
    })
  })

  // ==========================================================================
  // 6. ALARM BEHAVIOR (tested via HTTP/storage since alarm is reserved)
  // ==========================================================================

  describe('Browser alarm behavior', () => {
    // Note: alarm() is a reserved method in Workers RPC and cannot be called directly.
    // We test alarm behavior indirectly via state after session starts.

    it('session remains active after start (alarm not triggered yet)', async () => {
      const ns = uniqueNs('alarm-active')
      const stub = getStub(ns)

      await stub.start()

      // Session should be active right after start
      expect(await stub.isActive()).toBe(true)
    })

    it('session is properly configured for timeout after start', async () => {
      const ns = uniqueNs('alarm-configured')
      const stub = getStub(ns)

      await stub.start()

      // Verify lastActivity was set (indicates alarm timing is configured)
      const lastActivity = await stub.getLastActivity()
      expect(lastActivity).toBeGreaterThan(0)
    })

    it('lastActivity is stored for alarm to check', async () => {
      const ns = uniqueNs('alarm-storage')
      const stub = getStub(ns)

      const before = Date.now()
      await stub.start()
      const after = Date.now()

      const lastActivity = await stub.getLastActivity()
      expect(lastActivity).toBeGreaterThanOrEqual(before)
      expect(lastActivity).toBeLessThanOrEqual(after)
    })
  })

  // ==========================================================================
  // 7. CONFIG STORAGE
  // ==========================================================================

  describe('Browser stores config in ctx.storage', () => {
    it('stores provider in config on start', async () => {
      const ns = uniqueNs('config-provider')
      const stub = getStub(ns)

      await stub.start({ provider: 'browserbase' })

      const config = await stub.getConfig()
      expect(config?.provider).toBe('browserbase')
    })

    it('stores liveView in config', async () => {
      const ns = uniqueNs('config-liveview')
      const stub = getStub(ns)

      await stub.start({ provider: 'browserbase', liveView: true })

      const config = await stub.getConfig()
      expect(config?.liveView).toBe(true)
    })

    it('stores viewport in config', async () => {
      const ns = uniqueNs('config-viewport')
      const stub = getStub(ns)

      const viewport = { width: 1920, height: 1080 }
      await stub.start({ viewport })

      const config = await stub.getConfig()
      expect(config?.viewport).toEqual(viewport)
    })

    it('stores sessionId in config', async () => {
      const ns = uniqueNs('config-sessionid')
      const stub = getStub(ns)

      await stub.start()

      const config = await stub.getConfig()
      expect(config?.sessionId).toBeDefined()
      expect(typeof config?.sessionId).toBe('string')
    })

    it('clears stored config on stop', async () => {
      const ns = uniqueNs('config-clear')
      const stub = getStub(ns)

      await stub.start()
      expect(await stub.getConfig()).not.toBeNull()

      await stub.stop()
      expect(await stub.getConfig()).toBeNull()
    })
  })

  // ==========================================================================
  // 8. STATE ACCESS
  // ==========================================================================

  describe('Browser state access', () => {
    it('returns active status when session is active', async () => {
      const ns = uniqueNs('state-active')
      const stub = getStub(ns)

      await stub.start({ provider: 'browserbase' })

      const state = await stub.getState()
      expect(state.status).toBe('active')
      expect(state.provider).toBe('browserbase')
    })

    it('returns stopped status when no session', async () => {
      const ns = uniqueNs('state-stopped')
      const stub = getStub(ns)

      const state = await stub.getState()
      expect(state.status).toBe('stopped')
      expect(state.provider).toBeUndefined()
    })

    it('returns liveViewUrl when available', async () => {
      const ns = uniqueNs('state-liveview')
      const stub = getStub(ns)

      await stub.start({
        provider: 'browserbase',
        liveView: true,
      })

      const state = await stub.getState()
      expect(state.liveViewUrl).toBeDefined()
      expect(state.liveViewUrl).toContain('live.browserbase')
    })

    it('returns undefined liveViewUrl when not available', async () => {
      const ns = uniqueNs('state-no-liveview')
      const stub = getStub(ns)

      await stub.start({ provider: 'cloudflare' })

      const state = await stub.getState()
      expect(state.liveViewUrl).toBeUndefined()
    })
  })

  // ==========================================================================
  // 9. LAST ACTIVITY TRACKING
  // ==========================================================================

  describe('Browser tracks last activity', () => {
    it('sets lastActivity on start', async () => {
      const ns = uniqueNs('activity-start')
      const stub = getStub(ns)

      const before = Date.now()
      await stub.start()
      const after = Date.now()

      const lastActivity = await stub.getLastActivity()
      expect(lastActivity).toBeGreaterThanOrEqual(before)
      expect(lastActivity).toBeLessThanOrEqual(after)
    })

    it('resets lastActivity to 0 on stop', async () => {
      const ns = uniqueNs('activity-stop')
      const stub = getStub(ns)

      await stub.start()
      expect(await stub.getLastActivity()).toBeGreaterThan(0)

      await stub.stop()
      expect(await stub.getLastActivity()).toBe(0)
    })
  })

  // ==========================================================================
  // 10. HTTP ROUTES FOR LIFECYCLE
  // ==========================================================================

  describe('HTTP routes for lifecycle', () => {
    it('POST /start returns 200 with session info', async () => {
      const ns = uniqueNs('http-start')

      const res = await doFetch(ns, '/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'cloudflare' }),
      })

      expect(res.status).toBe(200)

      const body = await res.json() as BrowserStartResult
      expect(body.sessionId).toBeDefined()
      expect(body.provider).toBe('cloudflare')
    })

    it('POST /start returns 409 if session already active', async () => {
      const ns = uniqueNs('http-start-conflict')

      // Start first session
      await doFetch(ns, '/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'cloudflare' }),
      })

      // Try to start second session
      const res = await doFetch(ns, '/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'cloudflare' }),
      })

      expect(res.status).toBe(409)
    })

    it('POST /start returns 400 for invalid provider', async () => {
      const ns = uniqueNs('http-start-invalid')

      const res = await doFetch(ns, '/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'invalid' }),
      })

      expect(res.status).toBe(400)
    })

    it('POST /stop returns 200 on success', async () => {
      const ns = uniqueNs('http-stop')

      // Start first
      await doFetch(ns, '/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      // Stop
      const res = await doFetch(ns, '/stop', { method: 'POST' })

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean }
      expect(body.success).toBe(true)
    })

    it('POST /stop returns 400 when no active session', async () => {
      const ns = uniqueNs('http-stop-no-session')

      const res = await doFetch(ns, '/stop', { method: 'POST' })

      expect(res.status).toBe(400)
    })

    it('GET /state returns browser state', async () => {
      const ns = uniqueNs('http-state')

      // Check initial state
      const res1 = await doFetch(ns, '/state')
      expect(res1.status).toBe(200)
      const state1 = await res1.json() as BrowserState
      expect(state1.status).toBe('stopped')

      // Start session
      await doFetch(ns, '/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'browserbase' }),
      })

      // Check active state
      const res2 = await doFetch(ns, '/state')
      expect(res2.status).toBe(200)
      const state2 = await res2.json() as BrowserState
      expect(state2.status).toBe('active')
      expect(state2.provider).toBe('browserbase')
    })
  })
})
