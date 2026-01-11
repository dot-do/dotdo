/**
 * Browser DO HTTP Routes Tests
 *
 * RED TDD: Tests for Browser Durable Object Hono routes for external HTTP access.
 *
 * These tests verify the HTTP API for the Browser DO:
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
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ============================================================================
// MOCK BROWSE LIBRARY
// ============================================================================

/**
 * Mock BrowseSession for testing
 */
interface MockBrowseSession {
  goto: ReturnType<typeof vi.fn>
  act: ReturnType<typeof vi.fn>
  extract: ReturnType<typeof vi.fn>
  observe: ReturnType<typeof vi.fn>
  screenshot: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  liveViewUrl?: string
  agent?: {
    execute: ReturnType<typeof vi.fn>
  }
}

/**
 * Create a mock BrowseSession
 */
function createMockBrowseSession(liveViewUrl?: string): MockBrowseSession {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    act: vi.fn().mockResolvedValue({ success: true, action: 'clicked' }),
    extract: vi.fn().mockResolvedValue({ data: 'extracted' }),
    observe: vi.fn().mockResolvedValue([{ action: 'click', selector: 'button', description: 'Click button' }]),
    screenshot: vi.fn().mockResolvedValue('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
    close: vi.fn().mockResolvedValue(undefined),
    liveViewUrl,
    agent: {
      execute: vi.fn().mockResolvedValue({ success: true, steps: ['Step 1', 'Step 2'] }),
    },
  }
}

/**
 * Mock Browse library
 */
const mockBrowseInit = vi.fn()

vi.mock('../../lib/browse', () => ({
  Browse: {
    init: (config: unknown) => mockBrowseInit(config),
  },
}))

// ============================================================================
// MOCK DO ENVIRONMENT
// ============================================================================

/**
 * Mock DurableObjectState for testing
 */
function createMockDOState() {
  const storage = new Map<string, unknown>()
  const sqlData: Map<string, unknown[]> = new Map()

  // Initialize tables
  sqlData.set('things', [])
  sqlData.set('branches', [])
  sqlData.set('actions', [])
  sqlData.set('events', [])
  sqlData.set('objects', [])

  let alarm: number | null = null

  return {
    id: {
      toString: () => 'mock-browser-do-id-12345',
      name: 'test-browser-namespace',
    },
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      list: vi.fn(async () => storage),
      getAlarm: vi.fn(async () => alarm),
      setAlarm: vi.fn(async (time: number | Date) => {
        alarm = typeof time === 'number' ? time : time.getTime()
      }),
      deleteAlarm: vi.fn(async () => {
        alarm = null
      }),
      sql: {
        exec: vi.fn(() => {
          return { results: [] }
        }),
      },
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
    _storage: storage,
    _sqlData: sqlData,
    _getAlarm: () => alarm,
  }
}

/**
 * Mock environment bindings
 */
function createMockEnv() {
  return {
    BROWSER: { /* Cloudflare Browser binding mock */ },
    BROWSERBASE_API_KEY: 'test-api-key',
    BROWSERBASE_PROJECT_ID: 'test-project-id',
    DO: {
      get: vi.fn(() => ({
        fetch: vi.fn(async () => new Response('OK')),
      })),
      idFromName: vi.fn((name: string) => ({
        toString: () => `id-from-${name}`,
        name,
      })),
    },
    PIPELINE: {
      send: vi.fn(async () => {}),
    },
  }
}

// ============================================================================
// BROWSER DO TYPES
// ============================================================================

type BrowserProvider = 'cloudflare' | 'browserbase'

interface BrowserStartOptions {
  provider?: BrowserProvider
  liveView?: boolean
  viewport?: { width: number; height: number }
  stealth?: boolean
}

interface BrowserStartResult {
  sessionId: string
  provider: BrowserProvider
  liveViewUrl?: string
}

interface BrowserConfig {
  provider: BrowserProvider
  liveView: boolean
  viewport?: { width: number; height: number }
  stealth?: boolean
  sessionId?: string
}

interface BrowserState {
  status: 'active' | 'stopped'
  provider?: BrowserProvider
  currentUrl?: string
  liveViewUrl?: string
}

// ============================================================================
// IMPORTS
// ============================================================================

// Import the actual Browser class - this will test the real implementation
import { Browser } from '../Browser'

// ============================================================================
// HELPER: Create Browser DO with mocked internals
// ============================================================================

async function createTestBrowser() {
  const mockState = createMockDOState()
  const mockEnv = createMockEnv()
  const browser = new Browser(mockState as unknown as DurableObjectState, mockEnv as unknown as any)

  // Mock the protected methods to avoid Drizzle DB calls
  const logActionMock = vi.fn(async () => ({ rowid: 1 }))
  const emitMock = vi.fn(async () => {})
  const emitEventMock = vi.fn(async () => {})

  ;(browser as any).logBrowserAction = logActionMock
  ;(browser as any).emit = emitMock
  ;(browser as any).emitEvent = emitEventMock
  ;(browser as any).ns = 'https://browser.example.com.ai'

  return { browser, mockState, mockEnv, logActionMock, emitMock, emitEventMock }
}

/**
 * Helper function to make HTTP requests to the Browser DO
 */
async function request(
  browser: Browser,
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  }
  if (body !== undefined) {
    options.body = JSON.stringify(body)
  }
  const url = `https://browser.example.com.ai${path}`
  const req = new Request(url, options)
  return browser.fetch(req)
}

// ============================================================================
// TESTS
// ============================================================================

describe('Browser DO HTTP Routes', () => {
  let browser: Browser
  let mockSession: MockBrowseSession
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(async () => {
    vi.clearAllMocks()
    const setup = await createTestBrowser()
    browser = setup.browser
    mockState = setup.mockState
    mockEnv = setup.mockEnv
    mockSession = createMockBrowseSession('https://live.example.com.ai/session-123')
    mockBrowseInit.mockResolvedValue(mockSession)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // 1. POST /start - calls Browser.start() with options
  // ==========================================================================

  describe('POST /start - Start browser session', () => {
    it('returns 200 with session info on success', async () => {
      const res = await request(browser, 'POST', '/start', {
        provider: 'cloudflare',
      })

      expect(res.status).toBe(200)
      const body = await res.json() as BrowserStartResult
      expect(body.sessionId).toBeDefined()
      expect(body.provider).toBe('cloudflare')
    })

    it('passes options to Browser.start()', async () => {
      const res = await request(browser, 'POST', '/start', {
        provider: 'browserbase',
        liveView: true,
        viewport: { width: 1920, height: 1080 },
      })

      expect(res.status).toBe(200)
      expect(mockBrowseInit).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'browserbase',
          liveView: true,
          viewport: { width: 1920, height: 1080 },
        })
      )
    })

    it('returns liveViewUrl when available', async () => {
      const res = await request(browser, 'POST', '/start', {
        provider: 'browserbase',
        liveView: true,
      })

      expect(res.status).toBe(200)
      const body = await res.json() as BrowserStartResult
      expect(body.liveViewUrl).toBe('https://live.example.com.ai/session-123')
    })

    it('returns 400 for invalid provider', async () => {
      const res = await request(browser, 'POST', '/start', {
        provider: 'invalid',
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBeDefined()
    })

    it('returns 409 if session already active', async () => {
      // Start first session
      await request(browser, 'POST', '/start', { provider: 'cloudflare' })

      // Try to start second session
      const res = await request(browser, 'POST', '/start', { provider: 'cloudflare' })

      expect(res.status).toBe(409)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('already active')
    })
  })

  // ==========================================================================
  // 2. POST /goto - calls Browser.goto() with url
  // ==========================================================================

  describe('POST /goto - Navigate to URL', () => {
    beforeEach(async () => {
      // Start a session first
      await request(browser, 'POST', '/start', { provider: 'cloudflare' })
    })

    it('returns 200 on successful navigation', async () => {
      const res = await request(browser, 'POST', '/goto', {
        url: 'https://example.com.ai',
      })

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean }
      expect(body.success).toBe(true)
    })

    it('calls session.goto() with the URL', async () => {
      await request(browser, 'POST', '/goto', {
        url: 'https://example.com.ai/page',
      })

      expect(mockSession.goto).toHaveBeenCalledWith('https://example.com.ai/page')
    })

    it('returns 400 for missing URL', async () => {
      const res = await request(browser, 'POST', '/goto', {})

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('url')
    })

    it('returns 400 for invalid URL', async () => {
      const res = await request(browser, 'POST', '/goto', {
        url: 'not-a-valid-url',
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBeDefined()
    })

    it('returns 400 when no active session', async () => {
      // Create a new browser without starting a session
      const { browser: newBrowser } = await createTestBrowser()

      const res = await request(newBrowser, 'POST', '/goto', {
        url: 'https://example.com.ai',
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
    beforeEach(async () => {
      await request(browser, 'POST', '/start', { provider: 'cloudflare' })
    })

    it('returns 200 with act result on success', async () => {
      const res = await request(browser, 'POST', '/act', {
        instruction: 'Click the submit button',
      })

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean; action?: string }
      expect(body.success).toBe(true)
    })

    it('calls session.act() with the instruction', async () => {
      await request(browser, 'POST', '/act', {
        instruction: 'Fill in the email field',
      })

      expect(mockSession.act).toHaveBeenCalledWith('Fill in the email field')
    })

    it('returns act result from session', async () => {
      mockSession.act.mockResolvedValueOnce({
        success: true,
        action: 'typed',
        error: undefined,
      })

      const res = await request(browser, 'POST', '/act', {
        instruction: 'Type hello',
      })

      const body = await res.json() as { success: boolean; action?: string }
      expect(body.action).toBe('typed')
    })

    it('returns 400 for missing instruction', async () => {
      const res = await request(browser, 'POST', '/act', {})

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('instruction')
    })

    it('returns 400 when no active session', async () => {
      const { browser: newBrowser } = await createTestBrowser()

      const res = await request(newBrowser, 'POST', '/act', {
        instruction: 'Click button',
      })

      expect(res.status).toBe(400)
    })

    it('returns error result when action fails', async () => {
      mockSession.act.mockResolvedValueOnce({
        success: false,
        error: 'Element not found',
      })

      const res = await request(browser, 'POST', '/act', {
        instruction: 'Click missing button',
      })

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean; error?: string }
      expect(body.success).toBe(false)
      expect(body.error).toBe('Element not found')
    })
  })

  // ==========================================================================
  // 4. POST /extract - calls Browser.extract() with instruction, schema
  // ==========================================================================

  describe('POST /extract - Extract structured data', () => {
    beforeEach(async () => {
      await request(browser, 'POST', '/start', { provider: 'cloudflare' })
    })

    it('returns 200 with extracted data on success', async () => {
      mockSession.extract.mockResolvedValueOnce({
        products: ['Product A', 'Product B'],
      })

      const res = await request(browser, 'POST', '/extract', {
        instruction: 'Get all product names',
      })

      expect(res.status).toBe(200)
      const body = await res.json() as { products: string[] }
      expect(body.products).toEqual(['Product A', 'Product B'])
    })

    it('calls session.extract() with instruction', async () => {
      await request(browser, 'POST', '/extract', {
        instruction: 'Get page title',
      })

      expect(mockSession.extract).toHaveBeenCalledWith('Get page title', undefined)
    })

    it('passes schema to session.extract()', async () => {
      const schema = {
        type: 'object',
        properties: {
          title: { type: 'string' },
        },
      }

      await request(browser, 'POST', '/extract', {
        instruction: 'Get page title',
        schema,
      })

      expect(mockSession.extract).toHaveBeenCalledWith('Get page title', schema)
    })

    it('returns 400 for missing instruction', async () => {
      const res = await request(browser, 'POST', '/extract', {})

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('instruction')
    })

    it('returns 400 when no active session', async () => {
      const { browser: newBrowser } = await createTestBrowser()

      const res = await request(newBrowser, 'POST', '/extract', {
        instruction: 'Get data',
      })

      expect(res.status).toBe(400)
    })
  })

  // ==========================================================================
  // 5. POST /observe - calls Browser.observe()
  // ==========================================================================

  describe('POST /observe - Discover available actions', () => {
    beforeEach(async () => {
      await request(browser, 'POST', '/start', { provider: 'cloudflare' })
    })

    it('returns 200 with observed actions', async () => {
      const res = await request(browser, 'POST', '/observe', {})

      expect(res.status).toBe(200)
      const body = await res.json() as Array<{ action: string; selector: string }>
      expect(Array.isArray(body)).toBe(true)
    })

    it('calls session.observe() without instruction', async () => {
      await request(browser, 'POST', '/observe', {})

      expect(mockSession.observe).toHaveBeenCalledWith(undefined)
    })

    it('passes instruction to session.observe()', async () => {
      await request(browser, 'POST', '/observe', {
        instruction: 'Find login elements',
      })

      expect(mockSession.observe).toHaveBeenCalledWith('Find login elements')
    })

    it('returns observed actions from session', async () => {
      mockSession.observe.mockResolvedValueOnce([
        { action: 'click', selector: 'button.login', description: 'Login button' },
        { action: 'type', selector: 'input[name=email]', description: 'Email input' },
      ])

      const res = await request(browser, 'POST', '/observe', {})

      const body = await res.json() as Array<{ action: string; selector: string }>
      expect(body).toHaveLength(2)
      expect(body[0].action).toBe('click')
    })

    it('returns 400 when no active session', async () => {
      const { browser: newBrowser } = await createTestBrowser()

      const res = await request(newBrowser, 'POST', '/observe', {})

      expect(res.status).toBe(400)
    })
  })

  // ==========================================================================
  // 6. POST /agent - calls Browser.agent() with goal
  // ==========================================================================

  describe('POST /agent - Run autonomous agent', () => {
    beforeEach(async () => {
      await request(browser, 'POST', '/start', { provider: 'cloudflare' })
    })

    it('returns 200 with agent result on success', async () => {
      const res = await request(browser, 'POST', '/agent', {
        goal: 'Complete the checkout process',
      })

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean; steps?: string[] }
      expect(body.success).toBe(true)
    })

    it('calls agent.execute() with the goal', async () => {
      await request(browser, 'POST', '/agent', {
        goal: 'Fill out the contact form',
      })

      expect(mockSession.agent?.execute).toHaveBeenCalledWith('Fill out the contact form')
    })

    it('returns steps taken by agent', async () => {
      mockSession.agent!.execute.mockResolvedValueOnce({
        success: true,
        steps: ['Navigated to form', 'Filled name', 'Submitted'],
      })

      const res = await request(browser, 'POST', '/agent', {
        goal: 'Submit form',
      })

      const body = await res.json() as { success: boolean; steps: string[] }
      expect(body.steps).toHaveLength(3)
    })

    it('returns 400 for missing goal', async () => {
      const res = await request(browser, 'POST', '/agent', {})

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('goal')
    })

    it('returns 400 when no active session', async () => {
      const { browser: newBrowser } = await createTestBrowser()

      const res = await request(newBrowser, 'POST', '/agent', {
        goal: 'Do something',
      })

      expect(res.status).toBe(400)
    })

    it('returns 400 when agent not available', async () => {
      // Remove agent from session
      ;(mockSession as any).agent = undefined
      ;(browser as any).session = mockSession

      const res = await request(browser, 'POST', '/agent', {
        goal: 'Do something',
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error.toLowerCase()).toContain('agent')
    })
  })

  // ==========================================================================
  // 7. GET /state - returns Browser.getState()
  // ==========================================================================

  describe('GET /state - Get browser state', () => {
    it('returns 200 with state when session is active', async () => {
      await request(browser, 'POST', '/start', { provider: 'cloudflare' })

      const res = await request(browser, 'GET', '/state')

      expect(res.status).toBe(200)
      const body = await res.json() as BrowserState
      expect(body.status).toBe('active')
    })

    it('returns status as stopped when no session', async () => {
      const res = await request(browser, 'GET', '/state')

      expect(res.status).toBe(200)
      const body = await res.json() as BrowserState
      expect(body.status).toBe('stopped')
    })

    it('returns provider when session is active', async () => {
      await request(browser, 'POST', '/start', { provider: 'browserbase' })

      const res = await request(browser, 'GET', '/state')

      const body = await res.json() as BrowserState
      expect(body.provider).toBe('browserbase')
    })

    it('returns liveViewUrl when available', async () => {
      await request(browser, 'POST', '/start', {
        provider: 'browserbase',
        liveView: true,
      })

      const res = await request(browser, 'GET', '/state')

      const body = await res.json() as BrowserState
      expect(body.liveViewUrl).toBe('https://live.example.com.ai/session-123')
    })
  })

  // ==========================================================================
  // 8. GET /screenshot - returns base64 image
  // ==========================================================================

  describe('GET /screenshot - Capture page screenshot', () => {
    beforeEach(async () => {
      await request(browser, 'POST', '/start', { provider: 'cloudflare' })
    })

    it('returns 200 with base64 image', async () => {
      const res = await request(browser, 'GET', '/screenshot')

      expect(res.status).toBe(200)
      const body = await res.json() as { image: string }
      expect(body.image).toBeDefined()
      expect(typeof body.image).toBe('string')
    })

    it('calls session.screenshot()', async () => {
      await request(browser, 'GET', '/screenshot')

      expect(mockSession.screenshot).toHaveBeenCalled()
    })

    it('returns base64 encoded image data', async () => {
      const res = await request(browser, 'GET', '/screenshot')

      const body = await res.json() as { image: string }
      // Verify it's a valid base64 string
      expect(() => atob(body.image)).not.toThrow()
    })

    it('supports fullPage query parameter', async () => {
      const res = await request(browser, 'GET', '/screenshot?fullPage=true')

      expect(res.status).toBe(200)
      expect(mockSession.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({ fullPage: true })
      )
    })

    it('supports selector query parameter', async () => {
      const res = await request(browser, 'GET', '/screenshot?selector=%23main')

      expect(res.status).toBe(200)
      expect(mockSession.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({ selector: '#main' })
      )
    })

    it('returns 400 when no active session', async () => {
      const { browser: newBrowser } = await createTestBrowser()

      const res = await request(newBrowser, 'GET', '/screenshot')

      expect(res.status).toBe(400)
    })
  })

  // ==========================================================================
  // 9. POST /stop - calls Browser.stop()
  // ==========================================================================

  describe('POST /stop - Stop browser session', () => {
    beforeEach(async () => {
      await request(browser, 'POST', '/start', { provider: 'cloudflare' })
    })

    it('returns 200 on successful stop', async () => {
      const res = await request(browser, 'POST', '/stop', {})

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean }
      expect(body.success).toBe(true)
    })

    it('calls session.close()', async () => {
      await request(browser, 'POST', '/stop', {})

      expect(mockSession.close).toHaveBeenCalled()
    })

    it('clears the session after stop', async () => {
      await request(browser, 'POST', '/stop', {})

      // Check state to confirm session is stopped
      const stateRes = await request(browser, 'GET', '/state')
      const state = await stateRes.json() as BrowserState
      expect(state.status).toBe('stopped')
    })

    it('returns 400 when no active session', async () => {
      const { browser: newBrowser } = await createTestBrowser()

      const res = await request(newBrowser, 'POST', '/stop', {})

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
      await request(browser, 'POST', '/start', {
        provider: 'browserbase',
        liveView: true,
      })

      const res = await request(browser, 'GET', '/live')

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('https://live.example.com.ai/session-123')
    })

    it('returns 404 when no live view available', async () => {
      // Start without liveView
      mockSession.liveViewUrl = undefined
      await request(browser, 'POST', '/start', {
        provider: 'cloudflare',
      })

      const res = await request(browser, 'GET', '/live')

      expect(res.status).toBe(404)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('Live view not available')
    })

    it('returns 404 when no session active', async () => {
      const res = await request(browser, 'GET', '/live')

      expect(res.status).toBe(404)
      const body = await res.json() as { error: string }
      expect(body.error).toBeDefined()
    })
  })

  // ==========================================================================
  // 11. Routes return proper error responses
  // ==========================================================================

  describe('Error response handling', () => {
    it('returns JSON error for 400 responses', async () => {
      const res = await request(browser, 'POST', '/goto', {})

      expect(res.status).toBe(400)
      expect(res.headers.get('content-type')).toContain('application/json')
      const body = await res.json() as { error: string }
      expect(body.error).toBeDefined()
    })

    it('returns JSON error for 404 responses', async () => {
      const res = await request(browser, 'GET', '/nonexistent')

      expect(res.status).toBe(404)
      expect(res.headers.get('content-type')).toContain('application/json')
    })

    it('returns JSON error for 409 responses', async () => {
      await request(browser, 'POST', '/start', { provider: 'cloudflare' })
      const res = await request(browser, 'POST', '/start', { provider: 'cloudflare' })

      expect(res.status).toBe(409)
      expect(res.headers.get('content-type')).toContain('application/json')
    })

    it('includes error message in response body', async () => {
      await request(browser, 'POST', '/start', { provider: 'cloudflare' })

      const res = await request(browser, 'POST', '/goto', {
        url: 'not-valid-url',
      })

      const body = await res.json() as { error: string }
      expect(body.error).toBeTruthy()
      expect(typeof body.error).toBe('string')
    })

    it('handles internal errors gracefully', async () => {
      await request(browser, 'POST', '/start', { provider: 'cloudflare' })

      // Simulate an internal error
      mockSession.goto.mockRejectedValueOnce(new Error('Connection lost'))

      const res = await request(browser, 'POST', '/goto', {
        url: 'https://example.com.ai',
      })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBeDefined()
    })
  })

  // ==========================================================================
  // Content-Type and JSON handling
  // ==========================================================================

  describe('Content-Type and JSON handling', () => {
    it('accepts application/json for POST requests', async () => {
      const res = await browser.fetch(
        new Request('https://browser.example.com.ai/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'cloudflare' }),
        })
      )

      expect([200, 400]).toContain(res.status)
    })

    it('returns JSON content-type on all responses', async () => {
      const res = await request(browser, 'GET', '/state')

      expect(res.headers.get('content-type')).toContain('application/json')
    })

    it('handles malformed JSON gracefully', async () => {
      const res = await browser.fetch(
        new Request('https://browser.example.com.ai/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{ invalid json }',
        })
      )

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
      const res = await request(browser, 'POST', '/start', { provider: 'cloudflare' })
      expect([200, 400, 409]).toContain(res.status)
    })

    it('POST /goto is supported', async () => {
      const res = await request(browser, 'POST', '/goto', { url: 'https://example.com.ai' })
      expect([200, 400]).toContain(res.status)
    })

    it('POST /act is supported', async () => {
      const res = await request(browser, 'POST', '/act', { instruction: 'Click' })
      expect([200, 400]).toContain(res.status)
    })

    it('POST /extract is supported', async () => {
      const res = await request(browser, 'POST', '/extract', { instruction: 'Get data' })
      expect([200, 400]).toContain(res.status)
    })

    it('POST /observe is supported', async () => {
      const res = await request(browser, 'POST', '/observe', {})
      expect([200, 400]).toContain(res.status)
    })

    it('POST /agent is supported', async () => {
      const res = await request(browser, 'POST', '/agent', { goal: 'Do something' })
      expect([200, 400]).toContain(res.status)
    })

    it('GET /state is supported', async () => {
      const res = await request(browser, 'GET', '/state')
      expect(res.status).toBe(200)
    })

    it('GET /screenshot is supported', async () => {
      const res = await request(browser, 'GET', '/screenshot')
      expect([200, 400]).toContain(res.status)
    })

    it('POST /stop is supported', async () => {
      const res = await request(browser, 'POST', '/stop', {})
      expect([200, 400]).toContain(res.status)
    })

    it('GET /live is supported', async () => {
      const res = await request(browser, 'GET', '/live')
      expect([302, 404]).toContain(res.status)
    })

    it('returns 404 for unknown routes', async () => {
      const res = await request(browser, 'GET', '/unknown')
      expect(res.status).toBe(404)
    })

    it('returns 405 for unsupported methods', async () => {
      const res = await browser.fetch(
        new Request('https://browser.example.com.ai/start', { method: 'GET' })
      )
      expect(res.status).toBe(405)
    })
  })
})
