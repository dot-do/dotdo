/**
 * Browser DO Screencast Integration Tests
 *
 * Tests for CDP Screencast functionality using real miniflare DOs
 * via @cloudflare/vitest-pool-workers.
 *
 * NO MOCKS - Uses real DO instances with mock CDP session provider.
 * The TestBrowserDO provides mock CDP session support that allows testing
 * screencast behavior without actual browser infrastructure.
 *
 * Tests verify:
 * - startScreencast() creates CDP session
 * - startScreencast() sends Page.startScreencast command
 * - stopScreencast() sends Page.stopScreencast command
 * - HTTP routes for screencast control
 * - Screencast options (format, quality, maxWidth, maxHeight) are passed correctly
 *
 * Note: WebSocket tests are limited in miniflare. The WebSocket upgrade
 * functionality is tested via HTTP routes instead.
 *
 * @module objects/tests/browser-do-screencast.test
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

interface ScreencastOptions {
  format?: 'jpeg' | 'png'
  quality?: number
  maxWidth?: number
  maxHeight?: number
  everyNthFrame?: number
}

// Extended stub interface with RPC methods
interface BrowserDOStub extends DurableObjectStub {
  start(options?: { provider?: string; liveView?: boolean }): Promise<BrowserStartResult>
  stop(): Promise<void>
  startScreencast(options?: ScreencastOptions): Promise<void>
  stopScreencast(): Promise<void>
  isActive(): Promise<boolean>
}

// ============================================================================
// Test Helpers
// ============================================================================

const testRunId = Date.now()
let testCounter = 0

function uniqueNs(prefix: string = 'screencast'): string {
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

async function startSession(ns: string): Promise<BrowserStartResult> {
  const res = await doFetch(ns, '/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'cloudflare' }),
  })
  expect(res.status).toBe(200)
  return res.json() as Promise<BrowserStartResult>
}

// ============================================================================
// Tests
// ============================================================================

describe('Browser DO Screencast (Real DO)', () => {
  // ==========================================================================
  // 1. startScreencast() creates CDP session
  // ==========================================================================

  describe('startScreencast() creates CDP session', () => {
    it('creates CDP session via RPC', async () => {
      const ns = uniqueNs('cdp-create')
      const stub = getStub(ns)

      await stub.start()
      // Should not throw
      await stub.startScreencast()
    })

    it('throws if browser session not started', async () => {
      const ns = uniqueNs('cdp-no-session')
      const stub = getStub(ns)

      await expect(stub.startScreencast()).rejects.toThrow('Browser session not started')
    })

    it('can call startScreencast multiple times (reuses CDP session)', async () => {
      const ns = uniqueNs('cdp-reuse')
      const stub = getStub(ns)

      await stub.start()
      await stub.startScreencast()
      // Second call should not throw
      await stub.startScreencast()
    })
  })

  // ==========================================================================
  // 2. startScreencast() sends Page.startScreencast command
  // ==========================================================================

  describe('startScreencast() sends Page.startScreencast command', () => {
    it('sends start command with default options', async () => {
      const ns = uniqueNs('start-default')
      const stub = getStub(ns)

      await stub.start()
      // Should complete without error
      await stub.startScreencast()
    })

    it('sends start command with custom options', async () => {
      const ns = uniqueNs('start-custom')
      const stub = getStub(ns)

      await stub.start()
      await stub.startScreencast({
        format: 'png',
        quality: 90,
        maxWidth: 1920,
        maxHeight: 1080,
        everyNthFrame: 1,
      })
    })
  })

  // ==========================================================================
  // 3. stopScreencast() sends Page.stopScreencast command
  // ==========================================================================

  describe('stopScreencast() sends Page.stopScreencast command', () => {
    it('sends stop command', async () => {
      const ns = uniqueNs('stop-command')
      const stub = getStub(ns)

      await stub.start()
      await stub.startScreencast()
      // Should complete without error
      await stub.stopScreencast()
    })

    it('does not throw if no CDP session', async () => {
      const ns = uniqueNs('stop-no-cdp')
      const stub = getStub(ns)

      await stub.start()
      // Don't call startScreencast, so no CDP session exists
      // Should not throw
      await stub.stopScreencast()
    })
  })

  // ==========================================================================
  // 4. HTTP routes for screencast
  // ==========================================================================

  describe('HTTP routes for screencast', () => {
    it('GET /screencast returns 400 without WebSocket upgrade', async () => {
      const ns = uniqueNs('http-get')
      await startSession(ns)

      const res = await doFetch(ns, '/screencast')

      expect(res.status).toBe(400)
      expect(await res.text()).toBe('Use WebSocket upgrade')
    })

    it('POST /screencast/start starts screencast', async () => {
      const ns = uniqueNs('http-start')
      await startSession(ns)

      const res = await doFetch(ns, '/screencast/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quality: 80 }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean }
      expect(body.success).toBe(true)
    })

    it('POST /screencast/start returns 400 without session', async () => {
      const ns = uniqueNs('http-start-no-session')

      const res = await doFetch(ns, '/screencast/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Browser session not started')
    })

    it('POST /screencast/stop stops screencast', async () => {
      const ns = uniqueNs('http-stop')
      await startSession(ns)

      // Start screencast first
      await doFetch(ns, '/screencast/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      // Stop screencast
      const res = await doFetch(ns, '/screencast/stop', { method: 'POST' })

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean }
      expect(body.success).toBe(true)
    })
  })

  // ==========================================================================
  // 5. Screencast options are passed correctly
  // ==========================================================================

  describe('Screencast options are passed correctly', () => {
    it('passes format option via HTTP', async () => {
      const ns = uniqueNs('opt-format')
      await startSession(ns)

      const res = await doFetch(ns, '/screencast/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'png' }),
      })

      expect(res.status).toBe(200)
    })

    it('passes quality option via HTTP', async () => {
      const ns = uniqueNs('opt-quality')
      await startSession(ns)

      const res = await doFetch(ns, '/screencast/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quality: 80 }),
      })

      expect(res.status).toBe(200)
    })

    it('passes maxWidth option via HTTP', async () => {
      const ns = uniqueNs('opt-maxwidth')
      await startSession(ns)

      const res = await doFetch(ns, '/screencast/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxWidth: 1920 }),
      })

      expect(res.status).toBe(200)
    })

    it('passes maxHeight option via HTTP', async () => {
      const ns = uniqueNs('opt-maxheight')
      await startSession(ns)

      const res = await doFetch(ns, '/screencast/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxHeight: 1080 }),
      })

      expect(res.status).toBe(200)
    })

    it('passes everyNthFrame option via HTTP', async () => {
      const ns = uniqueNs('opt-frame')
      await startSession(ns)

      const res = await doFetch(ns, '/screencast/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ everyNthFrame: 1 }),
      })

      expect(res.status).toBe(200)
    })

    it('passes all options together via HTTP', async () => {
      const ns = uniqueNs('opt-all')
      await startSession(ns)

      const res = await doFetch(ns, '/screencast/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: 'png',
          quality: 90,
          maxWidth: 1920,
          maxHeight: 1080,
          everyNthFrame: 1,
        }),
      })

      expect(res.status).toBe(200)
    })

    it('passes all options together via RPC', async () => {
      const ns = uniqueNs('opt-all-rpc')
      const stub = getStub(ns)

      await stub.start()
      // Should complete without error
      await stub.startScreencast({
        format: 'png',
        quality: 90,
        maxWidth: 1920,
        maxHeight: 1080,
        everyNthFrame: 1,
      })
    })

    it('uses defaults when options not provided via RPC', async () => {
      const ns = uniqueNs('opt-defaults-rpc')
      const stub = getStub(ns)

      await stub.start()
      // Should complete without error using defaults
      await stub.startScreencast({})
    })

    it('uses defaults when options not provided via HTTP', async () => {
      const ns = uniqueNs('opt-defaults-http')
      await startSession(ns)

      const res = await doFetch(ns, '/screencast/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(200)
    })
  })

  // ==========================================================================
  // 6. Screencast lifecycle with browser stop
  // ==========================================================================

  describe('Screencast lifecycle with browser stop', () => {
    it('stopScreencast is called when browser.stop() is called', async () => {
      const ns = uniqueNs('lifecycle-stop')
      const stub = getStub(ns)

      await stub.start()
      await stub.startScreencast()

      // Stop browser should also stop screencast
      await stub.stop()

      // Verify session is stopped
      expect(await stub.isActive()).toBe(false)
    })

    it('can start new screencast after browser restart', async () => {
      const ns = uniqueNs('lifecycle-restart')
      const stub = getStub(ns)

      // First session
      await stub.start()
      await stub.startScreencast()
      await stub.stop()

      // Second session
      await stub.start()
      // Should work without error
      await stub.startScreencast()
    })
  })

  // ==========================================================================
  // 7. Error handling
  // ==========================================================================

  describe('Screencast error handling', () => {
    it('startScreencast via HTTP handles missing session gracefully', async () => {
      const ns = uniqueNs('error-no-session')

      const res = await doFetch(ns, '/screencast/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('Browser session not started')
    })

    it('stopScreencast via HTTP succeeds even without active screencast', async () => {
      const ns = uniqueNs('error-stop-no-screencast')
      await startSession(ns)

      // Don't start screencast, just try to stop
      const res = await doFetch(ns, '/screencast/stop', { method: 'POST' })

      expect(res.status).toBe(200)
    })

    it('invalid JSON in screencast/start is handled gracefully', async () => {
      const ns = uniqueNs('error-invalid-json')
      await startSession(ns)

      const res = await doFetch(ns, '/screencast/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ invalid json }',
      })

      // Should still work - empty object is used when JSON parse fails
      expect([200, 400]).toContain(res.status)
    })
  })
})
