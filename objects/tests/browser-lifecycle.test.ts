/**
 * Browser DO Lifecycle Tests
 *
 * RED TDD: Tests for Browser Durable Object session management and lifecycle:
 * - Browser DO instantiation
 * - Browser.start() initialization with Cloudflare and Browserbase providers
 * - Browser.start() returns liveViewUrl when liveView=true
 * - Browser.stop() closes the session
 * - Browser.alarm() keepAlive behavior
 * - Browser stores config in ctx.storage
 * - Browser emits lifecycle events
 *
 * These tests define the expected behavior for browser automation session
 * management within Durable Objects.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

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
}

/**
 * Create a mock BrowseSession
 */
function createMockBrowseSession(liveViewUrl?: string): MockBrowseSession {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    act: vi.fn().mockResolvedValue({ success: true, action: 'clicked' }),
    extract: vi.fn().mockResolvedValue({ data: 'extracted' }),
    observe: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue('base64-screenshot'),
    close: vi.fn().mockResolvedValue(undefined),
    liveViewUrl,
  }
}

/**
 * Mock Browse library
 */
const mockBrowseInit = vi.fn()

vi.mock('../../lib/browse', () => ({
  Browse: {
    init: (config: any) => mockBrowseInit(config),
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
        exec: vi.fn((sql: string) => {
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

// ============================================================================
// TEST BROWSER DO CLASS
// ============================================================================

/**
 * Test Browser DO class that simulates the Browser DO behavior
 * This mirrors the actual Browser class implementation for testing
 */
class TestBrowserDO {
  readonly ns: string
  protected ctx: ReturnType<typeof createMockDOState>
  protected env: ReturnType<typeof createMockEnv>

  private session: MockBrowseSession | null = null
  private config: BrowserConfig | null = null
  private lastActivity: number = 0
  private readonly SESSION_TIMEOUT = 5 * 60 * 1000 // 5 minutes

  static readonly $type = 'Browser'
  get $type(): string {
    return (this.constructor as typeof TestBrowserDO).$type
  }

  constructor(ctx: ReturnType<typeof createMockDOState>, env: ReturnType<typeof createMockEnv>) {
    this.ctx = ctx
    this.env = env
    this.ns = 'https://browser.test.example.com.ai'
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start a browser session
   */
  async start(options: BrowserStartOptions = {}): Promise<BrowserStartResult> {
    const provider = options.provider ?? 'cloudflare'
    const liveView = options.liveView ?? false

    // Validate provider
    if (provider !== 'cloudflare' && provider !== 'browserbase') {
      throw new Error(`Invalid provider: ${provider}`)
    }

    // Check if session already exists
    if (this.session) {
      throw new Error('Browser session already active')
    }

    // Prepare Browse.init config based on provider
    const browseConfig: any = {
      provider,
      liveView,
      env: provider === 'cloudflare'
        ? { BROWSER: this.env.BROWSER }
        : {
            BROWSERBASE_API_KEY: this.env.BROWSERBASE_API_KEY,
            BROWSERBASE_PROJECT_ID: this.env.BROWSERBASE_PROJECT_ID,
          },
    }

    if (options.viewport) {
      browseConfig.viewport = options.viewport
    }

    if (options.stealth) {
      browseConfig.stealth = options.stealth
    }

    // Initialize session via Browse.init()
    const { Browse } = await import('../../lib/browse')
    this.session = await Browse.init(browseConfig) as MockBrowseSession

    // Generate session ID
    const sessionId = crypto.randomUUID()

    // Store config
    this.config = {
      provider,
      liveView,
      viewport: options.viewport,
      stealth: options.stealth,
      sessionId,
    }

    await this.ctx.storage.put('browser:config', this.config)

    // Update last activity
    this.lastActivity = Date.now()
    await this.ctx.storage.put('browser:lastActivity', this.lastActivity)

    // Set alarm for keepAlive
    const nextAlarm = Date.now() + 60_000 // Check every minute
    await this.ctx.storage.setAlarm(nextAlarm)

    // Emit 'browser.started' event
    await this.emitEvent('browser.started', {
      sessionId,
      provider,
      liveView,
      liveViewUrl: this.session.liveViewUrl,
    })

    return {
      sessionId,
      provider,
      liveViewUrl: this.session.liveViewUrl,
    }
  }

  /**
   * Stop the browser session
   */
  async stop(): Promise<void> {
    if (!this.session) {
      throw new Error('No active browser session')
    }

    // Get session ID before clearing
    const sessionId = this.config?.sessionId

    // Close session
    await this.session.close()

    // Clear alarm
    await this.ctx.storage.deleteAlarm()

    // Clear state
    this.session = null
    this.config = null
    this.lastActivity = 0

    // Clear stored config
    await this.ctx.storage.delete('browser:config')
    await this.ctx.storage.delete('browser:lastActivity')

    // Emit 'browser.stopped' event
    await this.emitEvent('browser.stopped', { sessionId })
  }

  /**
   * Alarm handler for keepAlive
   */
  async alarm(): Promise<void> {
    if (!this.session) {
      // No session, nothing to do
      return
    }

    const now = Date.now()
    const storedLastActivity = await this.ctx.storage.get('browser:lastActivity') as number | undefined
    const lastActivity = storedLastActivity ?? this.lastActivity

    // Check if session has been inactive too long
    if (now - lastActivity > this.SESSION_TIMEOUT) {
      // Session timed out - close it
      await this.emitEvent('browser.timeout', {
        sessionId: this.config?.sessionId,
        inactiveMs: now - lastActivity,
      })
      await this.stop()
    } else {
      // Session still active - reset alarm
      const nextAlarm = now + 60_000 // Check again in 1 minute
      await this.ctx.storage.setAlarm(nextAlarm)
    }
  }

  /**
   * Update last activity timestamp (called when browser operations are performed)
   */
  async touch(): Promise<void> {
    this.lastActivity = Date.now()
    await this.ctx.storage.put('browser:lastActivity', this.lastActivity)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BROWSER OPERATIONS (delegated to session)
  // ═══════════════════════════════════════════════════════════════════════════

  async goto(url: string): Promise<void> {
    if (!this.session) {
      throw new Error('No active browser session')
    }
    await this.touch()
    await this.session.goto(url)
  }

  async act(instruction: string): Promise<{ success: boolean; action?: string; error?: string }> {
    if (!this.session) {
      throw new Error('No active browser session')
    }
    await this.touch()
    return await this.session.act(instruction)
  }

  async extract<T = unknown>(instruction: string, schema?: unknown): Promise<T> {
    if (!this.session) {
      throw new Error('No active browser session')
    }
    await this.touch()
    return await this.session.extract(instruction, schema)
  }

  async observe(instruction?: string): Promise<unknown[]> {
    if (!this.session) {
      throw new Error('No active browser session')
    }
    await this.touch()
    return await this.session.observe(instruction)
  }

  async screenshot(options?: { fullPage?: boolean; selector?: string }): Promise<string> {
    if (!this.session) {
      throw new Error('No active browser session')
    }
    await this.touch()
    return await this.session.screenshot(options)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE ACCESSORS
  // ═══════════════════════════════════════════════════════════════════════════

  getSession(): MockBrowseSession | null {
    return this.session
  }

  getConfig(): BrowserConfig | null {
    return this.config
  }

  getLastActivity(): number {
    return this.lastActivity
  }

  isActive(): boolean {
    return this.session !== null
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT EMISSION
  // ═══════════════════════════════════════════════════════════════════════════

  protected async emitEvent(verb: string, data: unknown): Promise<void> {
    const events = this.ctx._sqlData.get('events') as unknown[]
    events.push({
      id: crypto.randomUUID(),
      verb,
      source: this.ns,
      data,
      sequence: events.length + 1,
      streamed: false,
      createdAt: new Date(),
    })

    // Stream to Pipeline if configured
    if (this.env.PIPELINE) {
      try {
        await this.env.PIPELINE.send([{
          verb,
          source: this.ns,
          data,
          timestamp: new Date().toISOString(),
        }])
      } catch {
        // Best-effort streaming
      }
    }
  }

  // Helper to get events
  _getEvents(): unknown[] {
    return this.ctx._sqlData.get('events') as unknown[]
  }

  // Helper to manually set session for testing
  _setSession(session: MockBrowseSession | null): void {
    this.session = session
  }

  // Helper to manually set lastActivity for testing
  _setLastActivity(timestamp: number): void {
    this.lastActivity = timestamp
  }

  // Helper to set config for testing
  _setConfig(config: BrowserConfig | null): void {
    this.config = config
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('Browser DO Lifecycle', () => {
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let browserDO: TestBrowserDO

  beforeEach(() => {
    vi.clearAllMocks()
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    browserDO = new TestBrowserDO(mockState, mockEnv)
  })

  // ==========================================================================
  // 1. INSTANTIATION
  // ==========================================================================

  describe('Browser DO instantiates correctly', () => {
    it('creates Browser DO with correct $type', () => {
      expect(browserDO.$type).toBe('Browser')
    })

    it('initializes with null session', () => {
      expect(browserDO.getSession()).toBeNull()
    })

    it('initializes with null config', () => {
      expect(browserDO.getConfig()).toBeNull()
    })

    it('reports isActive as false initially', () => {
      expect(browserDO.isActive()).toBe(false)
    })

    it('has namespace set', () => {
      expect(browserDO.ns).toBeDefined()
      expect(browserDO.ns).toContain('browser')
    })
  })

  // ==========================================================================
  // 2. START WITH CLOUDFLARE PROVIDER
  // ==========================================================================

  describe('Browser.start() initializes with Cloudflare provider', () => {
    beforeEach(() => {
      mockBrowseInit.mockResolvedValue(createMockBrowseSession())
    })

    it('starts session with default cloudflare provider', async () => {
      const result = await browserDO.start()

      expect(result.provider).toBe('cloudflare')
      expect(result.sessionId).toBeDefined()
    })

    it('calls Browse.init with correct cloudflare config', async () => {
      await browserDO.start({ provider: 'cloudflare' })

      expect(mockBrowseInit).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'cloudflare',
          env: expect.objectContaining({
            BROWSER: mockEnv.BROWSER,
          }),
        })
      )
    })

    it('passes viewport to Browse.init', async () => {
      const viewport = { width: 1920, height: 1080 }
      await browserDO.start({ provider: 'cloudflare', viewport })

      expect(mockBrowseInit).toHaveBeenCalledWith(
        expect.objectContaining({
          viewport,
        })
      )
    })

    it('passes stealth option to Browse.init', async () => {
      await browserDO.start({ provider: 'cloudflare', stealth: true })

      expect(mockBrowseInit).toHaveBeenCalledWith(
        expect.objectContaining({
          stealth: true,
        })
      )
    })

    it('sets session after start', async () => {
      await browserDO.start()

      expect(browserDO.getSession()).not.toBeNull()
      expect(browserDO.isActive()).toBe(true)
    })

    it('throws if session already active', async () => {
      await browserDO.start()

      await expect(browserDO.start()).rejects.toThrow('Browser session already active')
    })
  })

  // ==========================================================================
  // 3. START WITH BROWSERBASE PROVIDER
  // ==========================================================================

  describe('Browser.start() initializes with Browserbase provider', () => {
    beforeEach(() => {
      mockBrowseInit.mockResolvedValue(createMockBrowseSession())
    })

    it('starts session with browserbase provider', async () => {
      const result = await browserDO.start({ provider: 'browserbase' })

      expect(result.provider).toBe('browserbase')
      expect(result.sessionId).toBeDefined()
    })

    it('calls Browse.init with correct browserbase config', async () => {
      await browserDO.start({ provider: 'browserbase' })

      expect(mockBrowseInit).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'browserbase',
          env: expect.objectContaining({
            BROWSERBASE_API_KEY: 'test-api-key',
            BROWSERBASE_PROJECT_ID: 'test-project-id',
          }),
        })
      )
    })

    it('throws on invalid provider', async () => {
      await expect(
        browserDO.start({ provider: 'invalid' as BrowserProvider })
      ).rejects.toThrow('Invalid provider')
    })
  })

  // ==========================================================================
  // 4. START WITH LIVEVIEW
  // ==========================================================================

  describe('Browser.start() returns liveViewUrl when liveView=true', () => {
    it('returns liveViewUrl when liveView enabled for browserbase', async () => {
      const liveViewUrl = 'https://browserbase.com/live/session-123'
      mockBrowseInit.mockResolvedValue(createMockBrowseSession(liveViewUrl))

      const result = await browserDO.start({
        provider: 'browserbase',
        liveView: true,
      })

      expect(result.liveViewUrl).toBe(liveViewUrl)
    })

    it('passes liveView option to Browse.init', async () => {
      mockBrowseInit.mockResolvedValue(createMockBrowseSession())

      await browserDO.start({ provider: 'browserbase', liveView: true })

      expect(mockBrowseInit).toHaveBeenCalledWith(
        expect.objectContaining({
          liveView: true,
        })
      )
    })

    it('returns undefined liveViewUrl when liveView disabled', async () => {
      mockBrowseInit.mockResolvedValue(createMockBrowseSession())

      const result = await browserDO.start({
        provider: 'browserbase',
        liveView: false,
      })

      expect(result.liveViewUrl).toBeUndefined()
    })

    it('returns undefined liveViewUrl for cloudflare provider', async () => {
      mockBrowseInit.mockResolvedValue(createMockBrowseSession())

      const result = await browserDO.start({
        provider: 'cloudflare',
        liveView: true, // Ignored for cloudflare
      })

      expect(result.liveViewUrl).toBeUndefined()
    })
  })

  // ==========================================================================
  // 5. STOP SESSION
  // ==========================================================================

  describe('Browser.stop() closes the session', () => {
    let mockSession: MockBrowseSession

    beforeEach(async () => {
      mockSession = createMockBrowseSession()
      mockBrowseInit.mockResolvedValue(mockSession)
      await browserDO.start()
    })

    it('calls session.close()', async () => {
      await browserDO.stop()

      expect(mockSession.close).toHaveBeenCalled()
    })

    it('clears the session', async () => {
      await browserDO.stop()

      expect(browserDO.getSession()).toBeNull()
      expect(browserDO.isActive()).toBe(false)
    })

    it('clears the config', async () => {
      await browserDO.stop()

      expect(browserDO.getConfig()).toBeNull()
    })

    it('clears the alarm', async () => {
      await browserDO.stop()

      expect(mockState.storage.deleteAlarm).toHaveBeenCalled()
    })

    it('removes stored config', async () => {
      await browserDO.stop()

      expect(mockState.storage.delete).toHaveBeenCalledWith('browser:config')
      expect(mockState.storage.delete).toHaveBeenCalledWith('browser:lastActivity')
    })

    it('throws if no active session', async () => {
      await browserDO.stop()

      await expect(browserDO.stop()).rejects.toThrow('No active browser session')
    })
  })

  // ==========================================================================
  // 6. ALARM KEEPS SESSION ALIVE
  // ==========================================================================

  describe('Browser.alarm() keeps session alive under timeout', () => {
    let mockSession: MockBrowseSession

    beforeEach(async () => {
      mockSession = createMockBrowseSession()
      mockBrowseInit.mockResolvedValue(mockSession)
      await browserDO.start()
    })

    it('resets alarm when session is active and within timeout', async () => {
      // Session just started, lastActivity is recent
      await browserDO.alarm()

      expect(mockState.storage.setAlarm).toHaveBeenCalled()
      expect(browserDO.isActive()).toBe(true)
    })

    it('does not close session within timeout period', async () => {
      // Touch to update lastActivity
      await browserDO.touch()

      // Alarm fires
      await browserDO.alarm()

      // Session should still be active
      expect(browserDO.isActive()).toBe(true)
      expect(mockSession.close).not.toHaveBeenCalled()
    })

    it('does nothing when no session exists', async () => {
      await browserDO.stop()

      // Should not throw
      await browserDO.alarm()

      expect(mockState.storage.setAlarm).toHaveBeenCalledTimes(1) // Only from start()
    })
  })

  // ==========================================================================
  // 7. ALARM CLOSES SESSION AFTER TIMEOUT
  // ==========================================================================

  describe('Browser.alarm() closes session after timeout exceeded', () => {
    let mockSession: MockBrowseSession

    beforeEach(async () => {
      mockSession = createMockBrowseSession()
      mockBrowseInit.mockResolvedValue(mockSession)
      await browserDO.start()
    })

    it('closes session when inactive beyond timeout', async () => {
      // Set lastActivity to 6 minutes ago (beyond 5 minute timeout)
      const sixMinutesAgo = Date.now() - 6 * 60 * 1000
      browserDO._setLastActivity(sixMinutesAgo)
      await mockState.storage.put('browser:lastActivity', sixMinutesAgo)

      await browserDO.alarm()

      expect(mockSession.close).toHaveBeenCalled()
      expect(browserDO.isActive()).toBe(false)
    })

    it('emits browser.timeout event before closing', async () => {
      const sixMinutesAgo = Date.now() - 6 * 60 * 1000
      browserDO._setLastActivity(sixMinutesAgo)
      await mockState.storage.put('browser:lastActivity', sixMinutesAgo)

      await browserDO.alarm()

      const events = browserDO._getEvents()
      expect(events.some((e: any) => e.verb === 'browser.timeout')).toBe(true)
    })

    it('timeout event includes inactivity duration', async () => {
      const sixMinutesAgo = Date.now() - 6 * 60 * 1000
      browserDO._setLastActivity(sixMinutesAgo)
      await mockState.storage.put('browser:lastActivity', sixMinutesAgo)

      await browserDO.alarm()

      const events = browserDO._getEvents()
      const timeoutEvent = events.find((e: any) => e.verb === 'browser.timeout') as any
      expect(timeoutEvent?.data?.inactiveMs).toBeGreaterThan(5 * 60 * 1000)
    })
  })

  // ==========================================================================
  // 8. CONFIG STORAGE
  // ==========================================================================

  describe('Browser stores config in ctx.storage', () => {
    beforeEach(() => {
      mockBrowseInit.mockResolvedValue(createMockBrowseSession())
    })

    it('stores browser:config on start', async () => {
      await browserDO.start({ provider: 'browserbase', liveView: true })

      expect(mockState.storage.put).toHaveBeenCalledWith(
        'browser:config',
        expect.objectContaining({
          provider: 'browserbase',
          liveView: true,
        })
      )
    })

    it('stores browser:lastActivity on start', async () => {
      const before = Date.now()
      await browserDO.start()
      const after = Date.now()

      const putCalls = mockState.storage.put.mock.calls
      const lastActivityCall = putCalls.find(
        (call) => call[0] === 'browser:lastActivity'
      )

      expect(lastActivityCall).toBeDefined()
      const storedTime = lastActivityCall![1] as number
      expect(storedTime).toBeGreaterThanOrEqual(before)
      expect(storedTime).toBeLessThanOrEqual(after)
    })

    it('stores viewport in config', async () => {
      const viewport = { width: 1280, height: 720 }
      await browserDO.start({ viewport })

      expect(mockState.storage.put).toHaveBeenCalledWith(
        'browser:config',
        expect.objectContaining({ viewport })
      )
    })

    it('stores sessionId in config', async () => {
      await browserDO.start()

      const putCalls = mockState.storage.put.mock.calls
      const configCall = putCalls.find((call) => call[0] === 'browser:config')
      const config = configCall![1] as BrowserConfig

      expect(config.sessionId).toBeDefined()
      expect(typeof config.sessionId).toBe('string')
    })

    it('clears stored config on stop', async () => {
      await browserDO.start()
      await browserDO.stop()

      expect(mockState.storage.delete).toHaveBeenCalledWith('browser:config')
    })
  })

  // ==========================================================================
  // 9. LIFECYCLE EVENTS
  // ==========================================================================

  describe('Browser emits lifecycle events', () => {
    let mockSession: MockBrowseSession

    beforeEach(() => {
      mockSession = createMockBrowseSession('https://live.example.com.ai')
      mockBrowseInit.mockResolvedValue(mockSession)
    })

    it('emits browser.started event on start', async () => {
      await browserDO.start({ provider: 'browserbase' })

      const events = browserDO._getEvents()
      expect(events.some((e: any) => e.verb === 'browser.started')).toBe(true)
    })

    it('browser.started event contains sessionId', async () => {
      const result = await browserDO.start()

      const events = browserDO._getEvents()
      const startedEvent = events.find((e: any) => e.verb === 'browser.started') as any
      expect(startedEvent?.data?.sessionId).toBe(result.sessionId)
    })

    it('browser.started event contains provider', async () => {
      await browserDO.start({ provider: 'cloudflare' })

      const events = browserDO._getEvents()
      const startedEvent = events.find((e: any) => e.verb === 'browser.started') as any
      expect(startedEvent?.data?.provider).toBe('cloudflare')
    })

    it('browser.started event contains liveViewUrl when available', async () => {
      await browserDO.start({ provider: 'browserbase', liveView: true })

      const events = browserDO._getEvents()
      const startedEvent = events.find((e: any) => e.verb === 'browser.started') as any
      expect(startedEvent?.data?.liveViewUrl).toBe('https://live.example.com.ai')
    })

    it('emits browser.stopped event on stop', async () => {
      await browserDO.start()
      await browserDO.stop()

      const events = browserDO._getEvents()
      expect(events.some((e: any) => e.verb === 'browser.stopped')).toBe(true)
    })

    it('browser.stopped event contains sessionId', async () => {
      const { sessionId } = await browserDO.start()
      await browserDO.stop()

      const events = browserDO._getEvents()
      const stoppedEvent = events.find((e: any) => e.verb === 'browser.stopped') as any
      expect(stoppedEvent?.data?.sessionId).toBe(sessionId)
    })

    it('streams events to pipeline', async () => {
      await browserDO.start()

      expect(mockEnv.PIPELINE.send).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            verb: 'browser.started',
          }),
        ])
      )
    })
  })

  // ==========================================================================
  // 10. BROWSER OPERATIONS UPDATE ACTIVITY
  // ==========================================================================

  describe('Browser operations update lastActivity', () => {
    let mockSession: MockBrowseSession

    beforeEach(async () => {
      mockSession = createMockBrowseSession()
      mockBrowseInit.mockResolvedValue(mockSession)
      await browserDO.start()
    })

    it('goto updates lastActivity', async () => {
      const before = browserDO.getLastActivity()
      await new Promise((r) => setTimeout(r, 10))
      await browserDO.goto('https://example.com.ai')

      expect(browserDO.getLastActivity()).toBeGreaterThan(before)
    })

    it('act updates lastActivity', async () => {
      const before = browserDO.getLastActivity()
      await new Promise((r) => setTimeout(r, 10))
      await browserDO.act('click button')

      expect(browserDO.getLastActivity()).toBeGreaterThan(before)
    })

    it('extract updates lastActivity', async () => {
      const before = browserDO.getLastActivity()
      await new Promise((r) => setTimeout(r, 10))
      await browserDO.extract('get data')

      expect(browserDO.getLastActivity()).toBeGreaterThan(before)
    })

    it('observe updates lastActivity', async () => {
      const before = browserDO.getLastActivity()
      await new Promise((r) => setTimeout(r, 10))
      await browserDO.observe()

      expect(browserDO.getLastActivity()).toBeGreaterThan(before)
    })

    it('screenshot updates lastActivity', async () => {
      const before = browserDO.getLastActivity()
      await new Promise((r) => setTimeout(r, 10))
      await browserDO.screenshot()

      expect(browserDO.getLastActivity()).toBeGreaterThan(before)
    })
  })

  // ==========================================================================
  // 11. ERROR HANDLING FOR OPERATIONS WITHOUT SESSION
  // ==========================================================================

  describe('Browser operations throw without active session', () => {
    it('goto throws without session', async () => {
      await expect(browserDO.goto('https://example.com.ai')).rejects.toThrow(
        'No active browser session'
      )
    })

    it('act throws without session', async () => {
      await expect(browserDO.act('click')).rejects.toThrow('No active browser session')
    })

    it('extract throws without session', async () => {
      await expect(browserDO.extract('get data')).rejects.toThrow(
        'No active browser session'
      )
    })

    it('observe throws without session', async () => {
      await expect(browserDO.observe()).rejects.toThrow('No active browser session')
    })

    it('screenshot throws without session', async () => {
      await expect(browserDO.screenshot()).rejects.toThrow('No active browser session')
    })
  })
})
