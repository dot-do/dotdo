/**
 * Browser DO Operations Tests
 *
 * RED TDD: These tests should FAIL because the Browser DO operations don't exist yet.
 *
 * These tests verify the Browser DO methods that wrap Stagehand primitives
 * for browser automation via the BrowseSession interface.
 *
 * Tests cover:
 * 1. Browser.goto(url) calls session.goto()
 * 2. Browser.act(instruction) calls session.act()
 * 3. Browser.extract(instruction, schema) calls session.extract()
 * 4. Browser.observe(instruction?) calls session.observe()
 * 5. Browser.agent(goal) runs agent.execute() (if available)
 * 6. Browser.screenshot() returns base64
 * 7. Browser.getState() returns current URL, status, provider
 * 8. Operations reset keepAlive timer
 * 9. Operations log actions via logAction()
 * 10. Operations emit events via emit()
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// These imports will FAIL - implementation doesn't exist yet
import { Browser } from '../Browser'
import type { BrowseSession, ActResult, ObserveResult } from '../../lib/browse'
import type { BrowserConfig, BrowserProvider } from '../../types/Browser'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock SQL storage cursor result
 */
interface MockSqlCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[]
}

/**
 * Mock SQL storage that simulates Cloudflare's SqlStorage API
 */
function createMockSqlStorage() {
  const tables = new Map<string, unknown[]>()

  return {
    exec(query: string, ...params: unknown[]): MockSqlCursor {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
    _tables: tables,
  }
}

/**
 * Mock KV storage for Durable Object state
 */
function createMockKvStorage() {
  const storage = new Map<string, unknown>()

  return {
    get: vi.fn(async <T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined> => {
      if (Array.isArray(key)) {
        const result = new Map<string, T>()
        for (const k of key) {
          const value = storage.get(k)
          if (value !== undefined) {
            result.set(k, value as T)
          }
        }
        return result as Map<string, T>
      }
      return storage.get(key) as T | undefined
    }),
    put: vi.fn(async <T>(key: string | Record<string, T>, value?: T): Promise<void> => {
      if (typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) {
          storage.set(k, v)
        }
      } else {
        storage.set(key, value)
      }
    }),
    delete: vi.fn(async (key: string | string[]): Promise<boolean | number> => {
      if (Array.isArray(key)) {
        let count = 0
        for (const k of key) {
          if (storage.delete(k)) count++
        }
        return count
      }
      return storage.delete(key)
    }),
    deleteAll: vi.fn(async (): Promise<void> => {
      storage.clear()
    }),
    list: vi.fn(async <T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> => {
      const result = new Map<string, T>()
      for (const [key, value] of storage) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.set(key, value as T)
        }
      }
      return result
    }),
    setAlarm: vi.fn(async (time: number | Date): Promise<void> => {}),
    getAlarm: vi.fn(async (): Promise<number | null> => null),
    deleteAlarm: vi.fn(async (): Promise<void> => {}),
    _storage: storage,
  }
}

/**
 * Create a mock DurableObjectId
 */
function createMockDOId(name: string = 'test-browser-id'): DurableObjectId {
  return {
    toString: () => name,
    equals: (other: DurableObjectId) => other.toString() === name,
    name,
  }
}

/**
 * Create a mock DurableObjectState with both KV and SQL storage
 */
function createMockState(idName: string = 'test-browser-id'): DurableObjectState {
  const kvStorage = createMockKvStorage()
  const sqlStorage = createMockSqlStorage()

  return {
    id: createMockDOId(idName),
    storage: {
      ...kvStorage,
      sql: sqlStorage,
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async <T>(callback: () => Promise<T>): Promise<T> => callback()),
  } as unknown as DurableObjectState
}

/**
 * Create a mock environment
 */
function createMockEnv(overrides?: Record<string, unknown>) {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
    BROWSER: {}, // Cloudflare Browser binding mock
    BROWSERBASE_API_KEY: 'test-api-key',
    BROWSERBASE_PROJECT_ID: 'test-project-id',
    ...overrides,
  }
}

/**
 * Create a mock BrowseSession for testing
 */
function createMockBrowseSession(): BrowseSession & {
  _goto: ReturnType<typeof vi.fn>
  _act: ReturnType<typeof vi.fn>
  _extract: ReturnType<typeof vi.fn>
  _observe: ReturnType<typeof vi.fn>
  _screenshot: ReturnType<typeof vi.fn>
  _close: ReturnType<typeof vi.fn>
} {
  const gotoFn = vi.fn(async () => {})
  const actFn = vi.fn(async () => ({ success: true, action: 'clicked' }))
  const extractFn = vi.fn(async () => ({ data: 'extracted' }))
  const observeFn = vi.fn(async () => [{ action: 'click', selector: 'button', description: 'Click button' }])
  const screenshotFn = vi.fn(async () => 'base64-screenshot-data')
  const closeFn = vi.fn(async () => {})

  return {
    goto: gotoFn,
    act: actFn,
    extract: extractFn,
    observe: observeFn,
    screenshot: screenshotFn,
    close: closeFn,
    liveViewUrl: 'https://live.example.com.ai/session-123',
    _goto: gotoFn,
    _act: actFn,
    _extract: extractFn,
    _observe: observeFn,
    _screenshot: screenshotFn,
    _close: closeFn,
  }
}

// ============================================================================
// TYPE DECLARATIONS FOR TESTS
// ============================================================================

interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  name?: string
}

interface DurableObjectState {
  id: DurableObjectId
  storage: DurableObjectStorage
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

interface DurableObjectStorage {
  get<T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined>
  put<T>(key: string | Record<string, T>, value?: T): Promise<void>
  delete(key: string | string[]): Promise<boolean | number>
  deleteAll(): Promise<void>
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>
  setAlarm(time: number | Date): Promise<void>
  getAlarm(): Promise<number | null>
  deleteAlarm(): Promise<void>
  sql: unknown
}

// ============================================================================
// TESTS
// ============================================================================

describe('Browser DO Operations', () => {
  let mockState: DurableObjectState
  let mockEnv: ReturnType<typeof createMockEnv>
  let browser: Browser
  let mockSession: ReturnType<typeof createMockBrowseSession>
  let logActionMock: ReturnType<typeof vi.fn>
  let emitMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    browser = new Browser(mockState, mockEnv)
    mockSession = createMockBrowseSession()

    // Mock logBrowserAction and emit to avoid Drizzle DB calls
    logActionMock = vi.fn(async () => ({ rowid: 1 }))
    emitMock = vi.fn(async () => {})

    // Override the protected methods to use mocks
    ;(browser as unknown as { logBrowserAction: typeof logActionMock }).logBrowserAction = logActionMock
    ;(browser as unknown as { emit: typeof emitMock }).emit = emitMock

    // Set namespace directly (avoid initialize which may touch DB)
    ;(browser as unknown as { ns: string }).ns = 'https://browser.example.com.ai'

    // Inject mock session for testing operations
    // The Browser class should have a way to set the session (via start() or directly for testing)
    ;(browser as unknown as { session: BrowseSession | null }).session = mockSession
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // 1. Browser.goto(url) calls session.goto()
  // ==========================================================================

  describe('1. goto() - Navigate to URL', () => {
    it('calls session.goto() with the provided URL', async () => {
      await browser.goto('https://example.com.ai')

      expect(mockSession._goto).toHaveBeenCalledWith('https://example.com.ai')
    })

    it('throws error when session is not started', async () => {
      // Remove the session to simulate not started
      ;(browser as unknown as { session: BrowseSession | null }).session = null

      await expect(browser.goto('https://example.com.ai')).rejects.toThrow(
        /session not started/i
      )
    })

    it('propagates session.goto() errors', async () => {
      mockSession._goto.mockRejectedValueOnce(new Error('Navigation failed'))

      await expect(browser.goto('https://example.com.ai')).rejects.toThrow(
        'Navigation failed'
      )
    })

    it('validates URL format', async () => {
      await expect(browser.goto('not-a-valid-url')).rejects.toThrow(/invalid url/i)
    })
  })

  // ==========================================================================
  // 2. Browser.act(instruction) calls session.act()
  // ==========================================================================

  describe('2. act() - Execute natural language action', () => {
    it('calls session.act() with the instruction', async () => {
      const result = await browser.act('Click the submit button')

      expect(mockSession._act).toHaveBeenCalledWith('Click the submit button')
      expect(result).toMatchObject({ success: true })
    })

    it('returns ActResult from session', async () => {
      mockSession._act.mockResolvedValueOnce({
        success: true,
        action: 'clicked',
        error: undefined,
      })

      const result = await browser.act('Click login button')

      expect(result.success).toBe(true)
      expect(result.action).toBe('clicked')
    })

    it('throws error when session is not started', async () => {
      ;(browser as unknown as { session: BrowseSession | null }).session = null

      await expect(browser.act('Click button')).rejects.toThrow(
        /session not started/i
      )
    })

    it('returns failure result on action failure', async () => {
      mockSession._act.mockResolvedValueOnce({
        success: false,
        error: 'Element not found',
      })

      const result = await browser.act('Click nonexistent button')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Element not found')
    })
  })

  // ==========================================================================
  // 3. Browser.extract(instruction, schema) calls session.extract()
  // ==========================================================================

  describe('3. extract() - Pull structured data', () => {
    it('calls session.extract() with instruction', async () => {
      await browser.extract('Get all product names')

      expect(mockSession._extract).toHaveBeenCalledWith(
        'Get all product names',
        undefined
      )
    })

    it('passes schema to session.extract()', async () => {
      const schema = {
        type: 'object',
        properties: {
          products: { type: 'array', items: { type: 'string' } },
        },
      }

      await browser.extract('Get all product names', schema)

      expect(mockSession._extract).toHaveBeenCalledWith(
        'Get all product names',
        schema
      )
    })

    it('returns extracted data from session', async () => {
      mockSession._extract.mockResolvedValueOnce({
        products: ['Product A', 'Product B'],
      })

      const result = await browser.extract('Get products')

      expect(result).toEqual({ products: ['Product A', 'Product B'] })
    })

    it('throws error when session is not started', async () => {
      ;(browser as unknown as { session: BrowseSession | null }).session = null

      await expect(browser.extract('Get data')).rejects.toThrow(
        /session not started/i
      )
    })

    it('supports typed extraction', async () => {
      interface PageData {
        title: string
        links: string[]
      }

      mockSession._extract.mockResolvedValueOnce({
        title: 'Example Page',
        links: ['https://link1.com', 'https://link2.com'],
      })

      const result = await browser.extract<PageData>('Get page data')

      expect(result.title).toBe('Example Page')
      expect(result.links).toHaveLength(2)
    })
  })

  // ==========================================================================
  // 4. Browser.observe(instruction?) calls session.observe()
  // ==========================================================================

  describe('4. observe() - Discover available actions', () => {
    it('calls session.observe() without instruction', async () => {
      await browser.observe()

      expect(mockSession._observe).toHaveBeenCalledWith(undefined)
    })

    it('calls session.observe() with instruction', async () => {
      await browser.observe('Find login elements')

      expect(mockSession._observe).toHaveBeenCalledWith('Find login elements')
    })

    it('returns ObserveResult from session', async () => {
      mockSession._observe.mockResolvedValueOnce([
        { action: 'click', selector: 'button.login', description: 'Login button' },
        { action: 'type', selector: 'input[name=email]', description: 'Email input' },
      ])

      const result = await browser.observe()

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        action: 'click',
        selector: 'button.login',
      })
    })

    it('throws error when session is not started', async () => {
      ;(browser as unknown as { session: BrowseSession | null }).session = null

      await expect(browser.observe()).rejects.toThrow(/session not started/i)
    })

    it('returns empty array when no actions available', async () => {
      mockSession._observe.mockResolvedValueOnce([])

      const result = await browser.observe()

      expect(result).toEqual([])
    })
  })

  // ==========================================================================
  // 5. Browser.agent(goal) runs agent.execute() (if available)
  // ==========================================================================

  describe('5. agent() - Run autonomous goal', () => {
    it('executes agent with the provided goal', async () => {
      // Mock agent capability on session
      const agentExecute = vi.fn(async () => ({
        success: true,
        steps: ['Navigated to page', 'Clicked button', 'Filled form'],
      }))

      ;(mockSession as unknown as { agent: { execute: typeof agentExecute } }).agent = {
        execute: agentExecute,
      }

      const result = await browser.agent('Complete the checkout process')

      expect(agentExecute).toHaveBeenCalledWith('Complete the checkout process')
      expect(result.success).toBe(true)
    })

    it('throws error when agent is not available', async () => {
      // Session without agent capability
      ;(mockSession as unknown as { agent: undefined }).agent = undefined

      await expect(browser.agent('Do something')).rejects.toThrow(
        /agent not available/i
      )
    })

    it('throws error when session is not started', async () => {
      ;(browser as unknown as { session: BrowseSession | null }).session = null

      await expect(browser.agent('Do something')).rejects.toThrow(
        /session not started/i
      )
    })

    it('returns agent result with steps taken', async () => {
      const agentExecute = vi.fn(async () => ({
        success: true,
        steps: ['Step 1', 'Step 2'],
        result: { formSubmitted: true },
      }))

      ;(mockSession as unknown as { agent: { execute: typeof agentExecute } }).agent = {
        execute: agentExecute,
      }

      const result = await browser.agent('Submit form')

      expect(result.steps).toHaveLength(2)
      expect(result.result).toEqual({ formSubmitted: true })
    })
  })

  // ==========================================================================
  // 6. Browser.screenshot() returns base64
  // ==========================================================================

  describe('6. screenshot() - Capture page', () => {
    it('calls session.screenshot() and returns base64', async () => {
      mockSession._screenshot.mockResolvedValueOnce('iVBORw0KGgoAAAANSUhEUgAA...')

      const result = await browser.screenshot()

      expect(mockSession._screenshot).toHaveBeenCalled()
      expect(result).toBe('iVBORw0KGgoAAAANSUhEUgAA...')
    })

    it('passes fullPage option to session', async () => {
      await browser.screenshot({ fullPage: true })

      expect(mockSession._screenshot).toHaveBeenCalledWith({ fullPage: true })
    })

    it('passes selector option for element screenshot', async () => {
      await browser.screenshot({ selector: '#main-content' })

      expect(mockSession._screenshot).toHaveBeenCalledWith({ selector: '#main-content' })
    })

    it('throws error when session is not started', async () => {
      ;(browser as unknown as { session: BrowseSession | null }).session = null

      await expect(browser.screenshot()).rejects.toThrow(/session not started/i)
    })

    it('supports type option (png/jpeg)', async () => {
      await browser.screenshot({ type: 'jpeg', quality: 80 })

      expect(mockSession._screenshot).toHaveBeenCalledWith({
        type: 'jpeg',
        quality: 80,
      })
    })
  })

  // ==========================================================================
  // 7. Browser.getState() returns current URL, status, provider
  // ==========================================================================

  describe('7. getState() - Get browser state', () => {
    it('returns status as active when session exists', async () => {
      const state = await browser.getState()

      expect(state.status).toBe('active')
    })

    it('returns status as stopped when no session', async () => {
      ;(browser as unknown as { session: BrowseSession | null }).session = null

      const state = await browser.getState()

      expect(state.status).toBe('stopped')
    })

    it('returns provider from config', async () => {
      // Set config on browser
      ;(browser as unknown as { config: BrowserConfig | null }).config = {
        provider: 'browserbase',
      }

      const state = await browser.getState()

      expect(state.provider).toBe('browserbase')
    })

    it('returns current URL from session', async () => {
      // Mock getCurrentUrl method
      ;(browser as unknown as { getCurrentUrl: () => Promise<string> }).getCurrentUrl = vi.fn(
        async () => 'https://current.page.com'
      )

      const state = await browser.getState()

      expect(state.currentUrl).toBe('https://current.page.com')
    })

    it('returns liveViewUrl from session', async () => {
      const state = await browser.getState()

      expect(state.liveViewUrl).toBe('https://live.example.com.ai/session-123')
    })

    it('returns complete BrowserState object', async () => {
      ;(browser as unknown as { config: BrowserConfig | null }).config = {
        provider: 'cloudflare',
      }
      ;(browser as unknown as { getCurrentUrl: () => Promise<string> }).getCurrentUrl = vi.fn(
        async () => 'https://example.com.ai'
      )

      const state = await browser.getState()

      expect(state).toMatchObject({
        status: 'active',
        provider: 'cloudflare',
        currentUrl: 'https://example.com.ai',
        liveViewUrl: 'https://live.example.com.ai/session-123',
      })
    })
  })

  // ==========================================================================
  // 8. Operations reset keepAlive timer
  // ==========================================================================

  describe('8. Operations reset keepAlive timer', () => {
    it('goto() resets lastActivity timestamp', async () => {
      const beforeTime = Date.now()

      await browser.goto('https://example.com.ai')

      const lastActivity = (browser as unknown as { lastActivity: number }).lastActivity
      expect(lastActivity).toBeGreaterThanOrEqual(beforeTime)
    })

    it('act() resets lastActivity timestamp', async () => {
      const beforeTime = Date.now()

      await browser.act('Click button')

      const lastActivity = (browser as unknown as { lastActivity: number }).lastActivity
      expect(lastActivity).toBeGreaterThanOrEqual(beforeTime)
    })

    it('extract() resets lastActivity timestamp', async () => {
      const beforeTime = Date.now()

      await browser.extract('Get data')

      const lastActivity = (browser as unknown as { lastActivity: number }).lastActivity
      expect(lastActivity).toBeGreaterThanOrEqual(beforeTime)
    })

    it('observe() resets lastActivity timestamp', async () => {
      const beforeTime = Date.now()

      await browser.observe()

      const lastActivity = (browser as unknown as { lastActivity: number }).lastActivity
      expect(lastActivity).toBeGreaterThanOrEqual(beforeTime)
    })

    it('screenshot() resets lastActivity timestamp', async () => {
      const beforeTime = Date.now()

      await browser.screenshot()

      const lastActivity = (browser as unknown as { lastActivity: number }).lastActivity
      expect(lastActivity).toBeGreaterThanOrEqual(beforeTime)
    })

    it('operations reset the alarm timer', async () => {
      await browser.goto('https://example.com.ai')

      // Check that setAlarm was called to reset the keepAlive
      expect(mockState.storage.setAlarm).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // 9. Operations log actions via logAction()
  // ==========================================================================

  describe('9. Operations log actions via logAction()', () => {
    // Note: logActionMock is already set up in the parent beforeEach

    it('goto() logs a navigation action', async () => {
      await browser.goto('https://example.com.ai')

      expect(logActionMock).toHaveBeenCalledWith(
        'goto',
        expect.objectContaining({ url: 'https://example.com.ai' })
      )
    })

    it('act() logs the instruction action', async () => {
      await browser.act('Click the button')

      expect(logActionMock).toHaveBeenCalledWith(
        'act',
        expect.objectContaining({ instruction: 'Click the button' })
      )
    })

    it('extract() logs the extraction action', async () => {
      await browser.extract('Get products')

      expect(logActionMock).toHaveBeenCalledWith(
        'extract',
        expect.objectContaining({ instruction: 'Get products' })
      )
    })

    it('observe() logs the observation action', async () => {
      await browser.observe('Find buttons')

      expect(logActionMock).toHaveBeenCalledWith(
        'observe',
        expect.objectContaining({ instruction: 'Find buttons' })
      )
    })

    it('screenshot() logs the screenshot action', async () => {
      await browser.screenshot()

      expect(logActionMock).toHaveBeenCalledWith(
        'screenshot',
        expect.any(Object)
      )
    })

    it('action logs include result on success', async () => {
      mockSession._act.mockResolvedValueOnce({ success: true, action: 'clicked' })

      await browser.act('Click button')

      expect(logActionMock).toHaveBeenCalledWith(
        'act',
        expect.objectContaining({
          instruction: 'Click button',
          result: expect.objectContaining({ success: true }),
        })
      )
    })
  })

  // ==========================================================================
  // 10. Operations emit events via emit()
  // ==========================================================================

  describe('10. Operations emit events via emit()', () => {
    // Note: emitMock is already set up in the parent beforeEach

    it('goto() emits browser.navigated event', async () => {
      await browser.goto('https://example.com.ai')

      expect(emitMock).toHaveBeenCalledWith(
        'browser.navigated',
        expect.objectContaining({ url: 'https://example.com.ai' })
      )
    })

    it('act() emits browser.acted event', async () => {
      await browser.act('Click button')

      expect(emitMock).toHaveBeenCalledWith(
        'browser.acted',
        expect.objectContaining({ instruction: 'Click button' })
      )
    })

    it('extract() emits browser.extracted event', async () => {
      mockSession._extract.mockResolvedValueOnce({ data: 'extracted' })

      await browser.extract('Get data')

      expect(emitMock).toHaveBeenCalledWith(
        'browser.extracted',
        expect.objectContaining({ instruction: 'Get data' })
      )
    })

    it('observe() emits browser.observed event', async () => {
      await browser.observe()

      expect(emitMock).toHaveBeenCalledWith(
        'browser.observed',
        expect.any(Object)
      )
    })

    it('screenshot() emits browser.screenshot event', async () => {
      await browser.screenshot()

      expect(emitMock).toHaveBeenCalledWith(
        'browser.screenshot',
        expect.any(Object)
      )
    })

    it('events include result data', async () => {
      mockSession._act.mockResolvedValueOnce({ success: true, action: 'typed' })

      await browser.act('Type in field')

      expect(emitMock).toHaveBeenCalledWith(
        'browser.acted',
        expect.objectContaining({
          instruction: 'Type in field',
          result: expect.objectContaining({ success: true, action: 'typed' }),
        })
      )
    })
  })

  // ==========================================================================
  // Additional Edge Cases
  // ==========================================================================

  describe('Edge Cases and Error Handling', () => {
    it('requireSession() throws descriptive error', async () => {
      ;(browser as unknown as { session: BrowseSession | null }).session = null

      const requireSession = (browser as unknown as { requireSession: () => void }).requireSession

      expect(() => requireSession.call(browser)).toThrow('Browser session not started')
    })

    it('operations work after session is started', async () => {
      // Re-attach session
      ;(browser as unknown as { session: BrowseSession | null }).session = mockSession

      // All operations should work
      await expect(browser.goto('https://example.com.ai')).resolves.not.toThrow()
      await expect(browser.act('Click')).resolves.not.toThrow()
      await expect(browser.extract('Get')).resolves.not.toThrow()
      await expect(browser.observe()).resolves.not.toThrow()
      await expect(browser.screenshot()).resolves.not.toThrow()
    })

    it('handles concurrent operations', async () => {
      const operations = [
        browser.goto('https://example.com.ai'),
        browser.observe(),
        browser.screenshot(),
      ]

      const results = await Promise.all(operations)

      expect(mockSession._goto).toHaveBeenCalled()
      expect(mockSession._observe).toHaveBeenCalled()
      expect(mockSession._screenshot).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Type Verification
  // ==========================================================================

  describe('Type Verification', () => {
    it('Browser extends DO base class', () => {
      expect(browser.$type).toBe('Browser')
    })

    it('goto accepts string URL', async () => {
      // TypeScript should accept this
      await browser.goto('https://example.com.ai')
    })

    it('act accepts string instruction', async () => {
      // TypeScript should accept this
      await browser.act('Click the button')
    })

    it('extract accepts instruction and optional schema', async () => {
      // Without schema
      await browser.extract('Get data')

      // With schema
      await browser.extract('Get data', { type: 'object' })
    })

    it('observe accepts optional instruction', async () => {
      // Without instruction
      await browser.observe()

      // With instruction
      await browser.observe('Find buttons')
    })

    it('screenshot accepts optional options', async () => {
      // Without options
      await browser.screenshot()

      // With options
      await browser.screenshot({ fullPage: true })
      await browser.screenshot({ selector: '#element' })
      await browser.screenshot({ type: 'jpeg', quality: 80 })
    })
  })
})
