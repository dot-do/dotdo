/**
 * Browser DO HTTP Routes Integration Tests
 *
 * Tests for Browser Durable Object Hono routes using real miniflare DOs
 * via @cloudflare/vitest-pool-workers.
 *
 * NO MOCKS - Uses real DO instances with mock browser session provider.
 * The TestBrowserDO provides a mock Browse session that allows testing
 * HTTP API behavior without actual browser infrastructure.
 *
 * Tests verify:
 * 1. POST /start - calls Browser.start() with options
 * 2. POST /goto - calls Browser.goto() with url
 * 3. POST /act - calls Browser.act() with instruction
 * 4. POST /extract - calls Browser.extract() with instruction, schema
 * 5. POST /observe - calls Browser.observe()
 * 6. POST /agent - calls Browser.agent() with goal
 * 7. GET /state - returns Browser.getState()
 * 8. GET /screenshot - returns base64 image
 * 9. POST /stop - calls Browser.stop()
 * 10. GET /live - redirects to liveViewUrl (if available)
 * 11. Routes return proper error responses
 *
 * @module objects/tests/browser-do-routes.test
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

interface ActResult {
  success: boolean
  action?: string
  error?: string
}

interface AgentResult {
  success: boolean
  steps?: string[]
  error?: string
}

// ============================================================================
// Test Helpers
// ============================================================================

const testRunId = Date.now()
let testCounter = 0

function uniqueNs(prefix: string = 'routes'): string {
  return `${prefix}-${testRunId}-${++testCounter}`
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

async function startSession(ns: string, options: object = {}): Promise<BrowserStartResult> {
  const res = await doFetch(ns, '/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'cloudflare', ...options }),
  })
  expect(res.status).toBe(200)
  return res.json() as Promise<BrowserStartResult>
}

// ============================================================================
// Tests
// ============================================================================

describe('Browser DO HTTP Routes (Real DO)', () => {
  // ==========================================================================
  // 1. POST /start - calls Browser.start() with options
  // ==========================================================================

  describe('POST /start - Start browser session', () => {
    it('returns 200 with session info on success', async () => {
      const ns = uniqueNs('start')

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

    it('passes options to Browser.start()', async () => {
      const ns = uniqueNs('start-options')

      const res = await doFetch(ns, '/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'browserbase',
          liveView: true,
          viewport: { width: 1920, height: 1080 },
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as BrowserStartResult
      expect(body.provider).toBe('browserbase')
      expect(body.liveViewUrl).toBeDefined()
    })

    it('returns liveViewUrl when available', async () => {
      const ns = uniqueNs('start-liveview')

      const res = await doFetch(ns, '/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'browserbase',
          liveView: true,
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as BrowserStartResult
      expect(body.liveViewUrl).toContain('live.browserbase')
    })

    it('returns 400 for invalid provider', async () => {
      const ns = uniqueNs('start-invalid')

      const res = await doFetch(ns, '/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'invalid' }),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBeDefined()
    })

    it('returns 409 if session already active', async () => {
      const ns = uniqueNs('start-conflict')

      // Start first session
      await startSession(ns)

      // Try to start second session
      const res = await doFetch(ns, '/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'cloudflare' }),
      })

      expect(res.status).toBe(409)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('already active')
    })
  })

  // ==========================================================================
  // 2. POST /goto - calls Browser.goto() with url
  // ==========================================================================

  describe('POST /goto - Navigate to URL', () => {
    it('returns 200 on successful navigation', async () => {
      const ns = uniqueNs('goto')
      await startSession(ns)

      const res = await doFetch(ns, '/goto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean }
      expect(body.success).toBe(true)
    })

    it('returns 400 for missing URL', async () => {
      const ns = uniqueNs('goto-missing')
      await startSession(ns)

      const res = await doFetch(ns, '/goto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('url')
    })

    it('returns 400 for invalid URL', async () => {
      const ns = uniqueNs('goto-invalid')
      await startSession(ns)

      const res = await doFetch(ns, '/goto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'not-a-valid-url' }),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBeDefined()
    })

    it('returns 400 when no active session', async () => {
      const ns = uniqueNs('goto-no-session')

      const res = await doFetch(ns, '/goto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('session')
    })
  })

  // ==========================================================================
  // 3. POST /act - calls Browser.act() with instruction
  // ==========================================================================

  describe('POST /act - Execute natural language action', () => {
    it('returns 200 with act result on success', async () => {
      const ns = uniqueNs('act')
      await startSession(ns)

      const res = await doFetch(ns, '/act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: 'Click the submit button' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as ActResult
      expect(body.success).toBe(true)
    })

    it('returns act result from session', async () => {
      const ns = uniqueNs('act-result')
      await startSession(ns)

      const res = await doFetch(ns, '/act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: 'Type hello' }),
      })

      const body = await res.json() as ActResult
      expect(body.action).toContain('Type hello')
    })

    it('returns 400 for missing instruction', async () => {
      const ns = uniqueNs('act-missing')
      await startSession(ns)

      const res = await doFetch(ns, '/act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('instruction')
    })

    it('returns 400 when no active session', async () => {
      const ns = uniqueNs('act-no-session')

      const res = await doFetch(ns, '/act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: 'Click button' }),
      })

      expect(res.status).toBe(400)
    })
  })

  // ==========================================================================
  // 4. POST /extract - calls Browser.extract() with instruction, schema
  // ==========================================================================

  describe('POST /extract - Extract structured data', () => {
    it('returns 200 with extracted data on success', async () => {
      const ns = uniqueNs('extract')
      await startSession(ns)

      const res = await doFetch(ns, '/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: 'Get all product names' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as { instruction: string; extracted: boolean }
      expect(body.extracted).toBe(true)
    })

    it('passes schema to extract', async () => {
      const ns = uniqueNs('extract-schema')
      await startSession(ns)

      const schema = {
        type: 'object',
        properties: {
          title: { type: 'string' },
        },
      }

      const res = await doFetch(ns, '/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction: 'Get page title',
          schema,
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as { schema: typeof schema }
      expect(body.schema).toBeDefined()
    })

    it('returns 400 for missing instruction', async () => {
      const ns = uniqueNs('extract-missing')
      await startSession(ns)

      const res = await doFetch(ns, '/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('instruction')
    })

    it('returns 400 when no active session', async () => {
      const ns = uniqueNs('extract-no-session')

      const res = await doFetch(ns, '/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: 'Get data' }),
      })

      expect(res.status).toBe(400)
    })
  })

  // ==========================================================================
  // 5. POST /observe - calls Browser.observe()
  // ==========================================================================

  describe('POST /observe - Discover available actions', () => {
    it('returns 200 with observed actions', async () => {
      const ns = uniqueNs('observe')
      await startSession(ns)

      const res = await doFetch(ns, '/observe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as Array<{ action: string; selector: string }>
      expect(Array.isArray(body)).toBe(true)
    })

    it('returns observed actions from session', async () => {
      const ns = uniqueNs('observe-result')
      await startSession(ns)

      const res = await doFetch(ns, '/observe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const body = await res.json() as Array<{ action: string; selector: string; description: string }>
      expect(body.length).toBeGreaterThan(0)
      expect(body[0].action).toBeDefined()
    })

    it('passes instruction to observe', async () => {
      const ns = uniqueNs('observe-instruction')
      await startSession(ns)

      const res = await doFetch(ns, '/observe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: 'Find login elements' }),
      })

      expect(res.status).toBe(200)
    })

    it('returns 400 when no active session', async () => {
      const ns = uniqueNs('observe-no-session')

      const res = await doFetch(ns, '/observe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
    })
  })

  // ==========================================================================
  // 6. POST /agent - calls Browser.agent() with goal
  // ==========================================================================

  describe('POST /agent - Run autonomous agent', () => {
    it('returns 200 with agent result on success', async () => {
      const ns = uniqueNs('agent')
      await startSession(ns)

      const res = await doFetch(ns, '/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: 'Complete the checkout process' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as AgentResult
      expect(body.success).toBe(true)
    })

    it('returns steps taken by agent', async () => {
      const ns = uniqueNs('agent-steps')
      await startSession(ns)

      const res = await doFetch(ns, '/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: 'Submit form' }),
      })

      const body = await res.json() as AgentResult
      expect(body.steps).toBeDefined()
      expect(Array.isArray(body.steps)).toBe(true)
      expect(body.steps!.length).toBeGreaterThan(0)
    })

    it('returns 400 for missing goal', async () => {
      const ns = uniqueNs('agent-missing')
      await startSession(ns)

      const res = await doFetch(ns, '/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('goal')
    })

    it('returns 400 when no active session', async () => {
      const ns = uniqueNs('agent-no-session')

      const res = await doFetch(ns, '/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: 'Do something' }),
      })

      expect(res.status).toBe(400)
    })
  })

  // ==========================================================================
  // 7. GET /state - returns Browser.getState()
  // ==========================================================================

  describe('GET /state - Get browser state', () => {
    it('returns 200 with state when session is active', async () => {
      const ns = uniqueNs('state-active')
      await startSession(ns)

      const res = await doFetch(ns, '/state')

      expect(res.status).toBe(200)
      const body = await res.json() as BrowserState
      expect(body.status).toBe('active')
    })

    it('returns status as stopped when no session', async () => {
      const ns = uniqueNs('state-stopped')

      const res = await doFetch(ns, '/state')

      expect(res.status).toBe(200)
      const body = await res.json() as BrowserState
      expect(body.status).toBe('stopped')
    })

    it('returns provider when session is active', async () => {
      const ns = uniqueNs('state-provider')
      await startSession(ns, { provider: 'browserbase' })

      const res = await doFetch(ns, '/state')

      const body = await res.json() as BrowserState
      expect(body.provider).toBe('browserbase')
    })

    it('returns liveViewUrl when available', async () => {
      const ns = uniqueNs('state-liveview')
      await startSession(ns, { provider: 'browserbase', liveView: true })

      const res = await doFetch(ns, '/state')

      const body = await res.json() as BrowserState
      expect(body.liveViewUrl).toContain('live.browserbase')
    })
  })

  // ==========================================================================
  // 8. GET /screenshot - returns base64 image
  // ==========================================================================

  describe('GET /screenshot - Capture page screenshot', () => {
    it('returns 200 with base64 image', async () => {
      const ns = uniqueNs('screenshot')
      await startSession(ns)

      const res = await doFetch(ns, '/screenshot')

      expect(res.status).toBe(200)
      const body = await res.json() as { image: string }
      expect(body.image).toBeDefined()
      expect(typeof body.image).toBe('string')
    })

    it('returns base64 encoded image data', async () => {
      const ns = uniqueNs('screenshot-base64')
      await startSession(ns)

      const res = await doFetch(ns, '/screenshot')

      const body = await res.json() as { image: string }
      // Verify it's a valid base64 string
      expect(() => atob(body.image)).not.toThrow()
    })

    it('supports fullPage query parameter', async () => {
      const ns = uniqueNs('screenshot-fullpage')
      await startSession(ns)

      const res = await doFetch(ns, '/screenshot?fullPage=true')

      expect(res.status).toBe(200)
    })

    it('supports selector query parameter', async () => {
      const ns = uniqueNs('screenshot-selector')
      await startSession(ns)

      const res = await doFetch(ns, '/screenshot?selector=%23main')

      expect(res.status).toBe(200)
    })

    it('returns 400 when no active session', async () => {
      const ns = uniqueNs('screenshot-no-session')

      const res = await doFetch(ns, '/screenshot')

      expect(res.status).toBe(400)
    })
  })

  // ==========================================================================
  // 9. POST /stop - calls Browser.stop()
  // ==========================================================================

  describe('POST /stop - Stop browser session', () => {
    it('returns 200 on successful stop', async () => {
      const ns = uniqueNs('stop')
      await startSession(ns)

      const res = await doFetch(ns, '/stop', { method: 'POST' })

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean }
      expect(body.success).toBe(true)
    })

    it('clears the session after stop', async () => {
      const ns = uniqueNs('stop-clear')
      await startSession(ns)

      await doFetch(ns, '/stop', { method: 'POST' })

      // Check state to confirm session is stopped
      const stateRes = await doFetch(ns, '/state')
      const state = await stateRes.json() as BrowserState
      expect(state.status).toBe('stopped')
    })

    it('returns 400 when no active session', async () => {
      const ns = uniqueNs('stop-no-session')

      const res = await doFetch(ns, '/stop', { method: 'POST' })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('session')
    })
  })

  // ==========================================================================
  // 10. GET /live - redirects to liveViewUrl (if available)
  // ==========================================================================

  describe('GET /live - Redirect to live view', () => {
    it('returns 302 redirect to liveViewUrl when available', async () => {
      const ns = uniqueNs('live')
      // Start session with browserbase and liveView=true
      const startRes = await doFetch(ns, '/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'browserbase', liveView: true }),
      })
      expect(startRes.status).toBe(200)
      const started = await startRes.json() as BrowserStartResult
      expect(started.liveViewUrl).toContain('live.browserbase')

      // Request /live with redirect: 'manual' to capture the 302 response
      const res = await SELF.fetch(`https://browser.test.do/live`, {
        headers: { 'X-DO-NS': ns },
        redirect: 'manual',
      })

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('live.browserbase')
    })

    it('returns 404 when no live view available', async () => {
      const ns = uniqueNs('live-none')
      await startSession(ns, { provider: 'cloudflare' })

      const res = await doFetch(ns, '/live')

      expect(res.status).toBe(404)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('Live view not available')
    })

    it('returns 404 when no session active', async () => {
      const ns = uniqueNs('live-no-session')

      const res = await doFetch(ns, '/live')

      expect(res.status).toBe(404)
    })
  })

  // ==========================================================================
  // 11. Routes return proper error responses
  // ==========================================================================

  describe('Error response handling', () => {
    it('returns JSON error for 400 responses', async () => {
      const ns = uniqueNs('error-400')
      await startSession(ns)

      const res = await doFetch(ns, '/goto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
      expect(res.headers.get('content-type')).toContain('application/json')
      const body = await res.json() as { error: string }
      expect(body.error).toBeDefined()
    })

    it('returns JSON error for 404 responses', async () => {
      const ns = uniqueNs('error-404')

      const res = await doFetch(ns, '/nonexistent')

      expect(res.status).toBe(404)
      expect(res.headers.get('content-type')).toContain('application/json')
    })

    it('returns JSON error for 409 responses', async () => {
      const ns = uniqueNs('error-409')
      await startSession(ns)

      const res = await doFetch(ns, '/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'cloudflare' }),
      })

      expect(res.status).toBe(409)
      expect(res.headers.get('content-type')).toContain('application/json')
    })

    it('includes error message in response body', async () => {
      const ns = uniqueNs('error-message')
      await startSession(ns)

      const res = await doFetch(ns, '/goto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'not-valid-url' }),
      })

      const body = await res.json() as { error: string }
      expect(body.error).toBeTruthy()
      expect(typeof body.error).toBe('string')
    })
  })

  // ==========================================================================
  // Content-Type and JSON handling
  // ==========================================================================

  describe('Content-Type and JSON handling', () => {
    it('accepts application/json for POST requests', async () => {
      const ns = uniqueNs('content-type')

      const res = await doFetch(ns, '/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'cloudflare' }),
      })

      expect([200, 400]).toContain(res.status)
    })

    it('returns JSON content-type on all responses', async () => {
      const ns = uniqueNs('content-type-response')

      const res = await doFetch(ns, '/state')

      expect(res.headers.get('content-type')).toContain('application/json')
    })

    it('handles malformed JSON gracefully', async () => {
      const ns = uniqueNs('malformed-json')

      const res = await doFetch(ns, '/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ invalid json }',
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBeDefined()
    })
  })

  // ==========================================================================
  // HTTP Methods
  // ==========================================================================

  describe('HTTP Methods', () => {
    it('POST /start is supported', async () => {
      const ns = uniqueNs('method-start')

      const res = await doFetch(ns, '/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'cloudflare' }),
      })
      expect([200, 400, 409]).toContain(res.status)
    })

    it('POST /goto is supported', async () => {
      const ns = uniqueNs('method-goto')

      const res = await doFetch(ns, '/goto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
      })
      expect([200, 400]).toContain(res.status)
    })

    it('POST /act is supported', async () => {
      const ns = uniqueNs('method-act')

      const res = await doFetch(ns, '/act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: 'Click' }),
      })
      expect([200, 400]).toContain(res.status)
    })

    it('POST /extract is supported', async () => {
      const ns = uniqueNs('method-extract')

      const res = await doFetch(ns, '/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: 'Get data' }),
      })
      expect([200, 400]).toContain(res.status)
    })

    it('POST /observe is supported', async () => {
      const ns = uniqueNs('method-observe')

      const res = await doFetch(ns, '/observe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect([200, 400]).toContain(res.status)
    })

    it('POST /agent is supported', async () => {
      const ns = uniqueNs('method-agent')

      const res = await doFetch(ns, '/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: 'Do something' }),
      })
      expect([200, 400]).toContain(res.status)
    })

    it('GET /state is supported', async () => {
      const ns = uniqueNs('method-state')

      const res = await doFetch(ns, '/state')
      expect(res.status).toBe(200)
    })

    it('GET /screenshot is supported', async () => {
      const ns = uniqueNs('method-screenshot')

      const res = await doFetch(ns, '/screenshot')
      expect([200, 400]).toContain(res.status)
    })

    it('POST /stop is supported', async () => {
      const ns = uniqueNs('method-stop')

      const res = await doFetch(ns, '/stop', { method: 'POST' })
      expect([200, 400]).toContain(res.status)
    })

    it('GET /live is supported', async () => {
      const ns = uniqueNs('method-live')

      const res = await doFetch(ns, '/live')
      expect([302, 404]).toContain(res.status)
    })

    it('returns 404 for unknown routes', async () => {
      const ns = uniqueNs('method-unknown')

      const res = await doFetch(ns, '/unknown')
      expect(res.status).toBe(404)
    })

    it('returns 405 for unsupported methods', async () => {
      const ns = uniqueNs('method-unsupported')

      const res = await doFetch(ns, '/start', { method: 'GET' })
      expect(res.status).toBe(405)
    })
  })
})
