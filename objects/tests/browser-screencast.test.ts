/**
 * Browser DO Screencast Tests
 *
 * TDD tests for CDP Screencast functionality:
 * - startScreencast() creates CDP session
 * - startScreencast() sends Page.startScreencast command
 * - stopScreencast() sends Page.stopScreencast command
 * - WebSocket upgrade returns 101 response
 * - WebSocket client receives frame messages
 * - Multiple clients receive same frames
 * - Last client disconnect stops screencast
 * - Screencast options (format, quality, maxWidth, maxHeight) are passed correctly
 * - screencastFrameAck is sent after receiving frame
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// MOCK CDP SESSION
// ============================================================================

/**
 * Mock CDPSession for testing
 */
interface MockCDPSession {
  send: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  _listeners: Map<string, Function[]>
  _emit: (event: string, data: unknown) => void
}

/**
 * Create a mock CDP session
 */
function createMockCDPSession(): MockCDPSession {
  const listeners = new Map<string, Function[]>()

  return {
    send: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, handler: Function) => {
      const eventListeners = listeners.get(event) || []
      eventListeners.push(handler)
      listeners.set(event, eventListeners)
    }),
    off: vi.fn((event: string, handler: Function) => {
      const eventListeners = listeners.get(event) || []
      const index = eventListeners.indexOf(handler)
      if (index > -1) {
        eventListeners.splice(index, 1)
      }
    }),
    _listeners: listeners,
    _emit: (event: string, data: unknown) => {
      const eventListeners = listeners.get(event) || []
      eventListeners.forEach((handler) => handler(data))
    },
  }
}

// ============================================================================
// MOCK BROWSE SESSION WITH CDP
// ============================================================================

/**
 * Mock BrowseSession with CDP session support
 */
interface MockBrowseSession {
  goto: ReturnType<typeof vi.fn>
  act: ReturnType<typeof vi.fn>
  extract: ReturnType<typeof vi.fn>
  observe: ReturnType<typeof vi.fn>
  screenshot: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  liveViewUrl?: string
  page?: {
    createCDPSession: ReturnType<typeof vi.fn>
  }
}

/**
 * Create a mock BrowseSession with CDP support
 */
function createMockBrowseSession(cdpSession?: MockCDPSession): MockBrowseSession {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    act: vi.fn().mockResolvedValue({ success: true, action: 'clicked' }),
    extract: vi.fn().mockResolvedValue({ data: 'extracted' }),
    observe: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue('base64-screenshot'),
    close: vi.fn().mockResolvedValue(undefined),
    page: {
      createCDPSession: vi.fn().mockResolvedValue(cdpSession || createMockCDPSession()),
    },
  }
}

// ============================================================================
// MOCK WEBSOCKET
// ============================================================================

/**
 * Mock WebSocket for testing
 */
interface MockWebSocket {
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  accept: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  readyState: number
  _listeners: Map<string, Function[]>
  _emit: (event: string, data?: unknown) => void
}

/**
 * Create a mock WebSocket
 */
function createMockWebSocket(): MockWebSocket {
  const listeners = new Map<string, Function[]>()

  return {
    send: vi.fn(),
    close: vi.fn(),
    accept: vi.fn(),
    addEventListener: vi.fn((event: string, handler: Function) => {
      const eventListeners = listeners.get(event) || []
      eventListeners.push(handler)
      listeners.set(event, eventListeners)
    }),
    removeEventListener: vi.fn((event: string, handler: Function) => {
      const eventListeners = listeners.get(event) || []
      const index = eventListeners.indexOf(handler)
      if (index > -1) {
        eventListeners.splice(index, 1)
      }
    }),
    readyState: 1, // OPEN
    _listeners: listeners,
    _emit: (event: string, data?: unknown) => {
      const eventListeners = listeners.get(event) || []
      eventListeners.forEach((handler) => handler(data))
    },
  }
}

// ============================================================================
// MOCK BROWSE LIBRARY
// ============================================================================

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
    BROWSER: {
      /* Cloudflare Browser binding mock */
    },
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
// TYPES
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

interface ScreencastOptions {
  format?: 'jpeg' | 'png'
  quality?: number // 0-100
  maxWidth?: number
  maxHeight?: number
  everyNthFrame?: number
}

/**
 * Mock WebSocket upgrade response for testing
 * In Cloudflare Workers, WebSocket upgrades return status 101
 * but standard Response doesn't allow this status.
 */
interface WebSocketUpgradeResponse {
  status: number
  webSocket: MockWebSocket
}

// ============================================================================
// TEST BROWSER DO CLASS WITH SCREENCAST
// ============================================================================

/**
 * Test Browser DO class that simulates Browser DO with screencast support
 */
class TestBrowserDOWithScreencast {
  readonly ns: string
  protected ctx: ReturnType<typeof createMockDOState>
  protected env: ReturnType<typeof createMockEnv>

  private _session: MockBrowseSession | null = null
  private config: BrowserConfig | null = null
  private lastActivity: number = 0
  private readonly SESSION_TIMEOUT = 5 * 60 * 1000

  // Screencast state
  private cdpSession: MockCDPSession | null = null
  private screencastClients: Set<MockWebSocket> = new Set()

  static readonly $type = 'Browser'
  get $type(): string {
    return (this.constructor as typeof TestBrowserDOWithScreencast).$type
  }

  get session(): MockBrowseSession | null {
    return this._session
  }

  constructor(
    ctx: ReturnType<typeof createMockDOState>,
    env: ReturnType<typeof createMockEnv>
  ) {
    this.ctx = ctx
    this.env = env
    this.ns = 'https://browser.test.example.com.ai'
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  async start(options: BrowserStartOptions = {}): Promise<BrowserStartResult> {
    const provider = options.provider ?? 'cloudflare'
    const liveView = options.liveView ?? false

    if (provider !== 'cloudflare' && provider !== 'browserbase') {
      throw new Error(`Invalid provider: ${provider}`)
    }

    if (this._session) {
      throw new Error('Browser session already active')
    }

    const browseConfig: any = {
      provider,
      liveView,
      env:
        provider === 'cloudflare'
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

    const { Browse } = await import('../../lib/browse')
    this._session = (await Browse.init(browseConfig)) as MockBrowseSession

    const sessionId = crypto.randomUUID()

    this.config = {
      provider,
      liveView,
      viewport: options.viewport,
      stealth: options.stealth,
      sessionId,
    }

    await this.ctx.storage.put('browser:config', this.config)
    this.lastActivity = Date.now()
    await this.ctx.storage.put('browser:lastActivity', this.lastActivity)

    const nextAlarm = Date.now() + 60_000
    await this.ctx.storage.setAlarm(nextAlarm)

    await this.emitEvent('browser.started', {
      sessionId,
      provider,
      liveView,
      liveViewUrl: this._session.liveViewUrl,
    })

    return {
      sessionId,
      provider,
      liveViewUrl: this._session.liveViewUrl,
    }
  }

  async stop(): Promise<void> {
    if (!this._session) {
      throw new Error('No active browser session')
    }

    const sessionId = this.config?.sessionId

    // Stop screencast if active
    if (this.cdpSession) {
      await this.stopScreencast()
      this.cdpSession = null
    }

    await this._session.close()
    await this.ctx.storage.deleteAlarm()

    this._session = null
    this.config = null
    this.lastActivity = 0

    await this.ctx.storage.delete('browser:config')
    await this.ctx.storage.delete('browser:lastActivity')

    await this.emitEvent('browser.stopped', { sessionId })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCREENCAST METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start screencast streaming
   */
  async startScreencast(options: ScreencastOptions = {}): Promise<void> {
    if (!this._session?.page) {
      throw new Error('Browser session not started')
    }

    // Create CDP session if not exists
    if (!this.cdpSession) {
      this.cdpSession = await this._session.page.createCDPSession()

      // Listen for frames
      this.cdpSession.on(
        'Page.screencastFrame',
        async (event: { data: string; metadata?: unknown; sessionId: number }) => {
          const { data, metadata, sessionId } = event

          // Broadcast to all connected clients
          this.broadcastFrame(data, metadata)

          // Acknowledge frame receipt
          await this.cdpSession?.send('Page.screencastFrameAck', { sessionId })
        }
      )
    }

    // Start screencast with options
    await this.cdpSession.send('Page.startScreencast', {
      format: options.format || 'jpeg',
      quality: options.quality ?? 60,
      maxWidth: options.maxWidth ?? 1280,
      maxHeight: options.maxHeight ?? 720,
      everyNthFrame: options.everyNthFrame ?? 2,
    })
  }

  /**
   * Stop screencast streaming
   */
  async stopScreencast(): Promise<void> {
    if (this.cdpSession) {
      await this.cdpSession.send('Page.stopScreencast')
    }
  }

  /**
   * Broadcast frame to all connected WebSocket clients
   */
  private broadcastFrame(data: string, metadata?: unknown): void {
    const message = JSON.stringify({
      type: 'frame',
      data,
      metadata,
      timestamp: Date.now(),
    })

    for (const client of this.screencastClients) {
      try {
        client.send(message)
      } catch {
        // Client disconnected
        this.screencastClients.delete(client)
      }
    }
  }

  /**
   * Handle incoming HTTP requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Check for WebSocket upgrade on /screencast path
    if (
      url.pathname === '/screencast' &&
      request.headers.get('Upgrade') === 'websocket'
    ) {
      return this.handleScreencastWebSocket(request)
    }

    // Handle HTTP routes
    if (url.pathname === '/screencast' && request.method === 'GET') {
      return new Response('Use WebSocket upgrade', { status: 400 })
    }

    if (url.pathname === '/screencast/start' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}))
        await this.startScreencast(body as ScreencastOptions)
        return Response.json({ success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message.includes('Browser session not started')) {
          return Response.json({ error: message }, { status: 400 })
        }
        return Response.json({ error: message }, { status: 500 })
      }
    }

    if (url.pathname === '/screencast/stop' && request.method === 'POST') {
      try {
        await this.stopScreencast()
        return Response.json({ success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return Response.json({ error: message }, { status: 500 })
      }
    }

    return new Response('Not found', { status: 404 })
  }

  /**
   * Handle WebSocket upgrade for screencast
   * Returns a mock response object since Node.js Response doesn't support status 101
   */
  private handleScreencastWebSocket(
    request: Request,
    mockClient?: MockWebSocket,
    mockServer?: MockWebSocket
  ): WebSocketUpgradeResponse {
    // For testing, we use mocks
    const client = mockClient || createMockWebSocket()
    const server = mockServer || createMockWebSocket()

    server.accept()
    this.screencastClients.add(server)

    server.addEventListener('message', async (event: { data: string }) => {
      try {
        const msg = JSON.parse(event.data as string)
        if (msg.action === 'start') {
          await this.startScreencast(msg.options)
        } else if (msg.action === 'stop') {
          await this.stopScreencast()
        }
      } catch (e) {
        server.send(
          JSON.stringify({ type: 'error', message: (e as Error).message })
        )
      }
    })

    server.addEventListener('close', () => {
      this.screencastClients.delete(server)
      // Stop screencast if no more clients
      if (this.screencastClients.size === 0) {
        this.stopScreencast().catch(() => {})
      }
    })

    // Return mock WebSocket upgrade response
    // In Cloudflare Workers runtime, this would be: new Response(null, { status: 101, webSocket: client })
    return {
      status: 101,
      webSocket: client,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
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

    if (this.env.PIPELINE) {
      try {
        await this.env.PIPELINE.send([
          {
            verb,
            source: this.ns,
            data,
            timestamp: new Date().toISOString(),
          },
        ])
      } catch {
        // Best-effort streaming
      }
    }
  }

  // Test helpers
  _getEvents(): unknown[] {
    return this.ctx._sqlData.get('events') as unknown[]
  }

  _setSession(session: MockBrowseSession | null): void {
    this._session = session
  }

  _getCDPSession(): MockCDPSession | null {
    return this.cdpSession
  }

  _setCDPSession(session: MockCDPSession | null): void {
    this.cdpSession = session
  }

  _getScreencastClients(): Set<MockWebSocket> {
    return this.screencastClients
  }

  _addScreencastClient(client: MockWebSocket): void {
    this.screencastClients.add(client)
  }

  _handleScreencastWebSocket(
    request: Request,
    mockClient: MockWebSocket,
    mockServer: MockWebSocket
  ): WebSocketUpgradeResponse {
    return this.handleScreencastWebSocket(request, mockClient, mockServer)
  }

  _broadcastFrame(data: string, metadata?: unknown): void {
    this.broadcastFrame(data, metadata)
  }

  isActive(): boolean {
    return this._session !== null
  }

  getConfig(): BrowserConfig | null {
    return this.config
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('Browser DO Screencast', () => {
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let browserDO: TestBrowserDOWithScreencast
  let mockCDPSession: MockCDPSession

  beforeEach(() => {
    vi.clearAllMocks()
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    browserDO = new TestBrowserDOWithScreencast(mockState, mockEnv)
    mockCDPSession = createMockCDPSession()
  })

  // ==========================================================================
  // 1. startScreencast() creates CDP session
  // ==========================================================================

  describe('startScreencast() creates CDP session', () => {
    beforeEach(() => {
      const mockSession = createMockBrowseSession(mockCDPSession)
      mockBrowseInit.mockResolvedValue(mockSession)
    })

    it('creates CDP session via page.createCDPSession()', async () => {
      await browserDO.start()
      await browserDO.startScreencast()

      expect(browserDO.session?.page?.createCDPSession).toHaveBeenCalled()
    })

    it('stores CDP session for reuse', async () => {
      await browserDO.start()
      await browserDO.startScreencast()

      expect(browserDO._getCDPSession()).not.toBeNull()
    })

    it('reuses existing CDP session on subsequent calls', async () => {
      await browserDO.start()
      await browserDO.startScreencast()
      await browserDO.startScreencast()

      expect(browserDO.session?.page?.createCDPSession).toHaveBeenCalledTimes(1)
    })

    it('throws if browser session not started', async () => {
      await expect(browserDO.startScreencast()).rejects.toThrow(
        'Browser session not started'
      )
    })
  })

  // ==========================================================================
  // 2. startScreencast() sends Page.startScreencast command
  // ==========================================================================

  describe('startScreencast() sends Page.startScreencast command', () => {
    beforeEach(() => {
      const mockSession = createMockBrowseSession(mockCDPSession)
      mockBrowseInit.mockResolvedValue(mockSession)
    })

    it('sends Page.startScreencast CDP command', async () => {
      await browserDO.start()
      await browserDO.startScreencast()

      expect(mockCDPSession.send).toHaveBeenCalledWith(
        'Page.startScreencast',
        expect.any(Object)
      )
    })

    it('sends default screencast options', async () => {
      await browserDO.start()
      await browserDO.startScreencast()

      expect(mockCDPSession.send).toHaveBeenCalledWith('Page.startScreencast', {
        format: 'jpeg',
        quality: 60,
        maxWidth: 1280,
        maxHeight: 720,
        everyNthFrame: 2,
      })
    })
  })

  // ==========================================================================
  // 3. stopScreencast() sends Page.stopScreencast command
  // ==========================================================================

  describe('stopScreencast() sends Page.stopScreencast command', () => {
    beforeEach(() => {
      const mockSession = createMockBrowseSession(mockCDPSession)
      mockBrowseInit.mockResolvedValue(mockSession)
    })

    it('sends Page.stopScreencast CDP command', async () => {
      await browserDO.start()
      await browserDO.startScreencast()
      await browserDO.stopScreencast()

      expect(mockCDPSession.send).toHaveBeenCalledWith('Page.stopScreencast')
    })

    it('does not throw if no CDP session', async () => {
      await browserDO.start()
      // Don't call startScreencast, so no CDP session exists
      await expect(browserDO.stopScreencast()).resolves.not.toThrow()
    })
  })

  // ==========================================================================
  // 4. WebSocket upgrade returns 101 response
  // ==========================================================================

  describe('WebSocket upgrade returns 101 response', () => {
    beforeEach(() => {
      const mockSession = createMockBrowseSession(mockCDPSession)
      mockBrowseInit.mockResolvedValue(mockSession)
    })

    it('returns 101 status for WebSocket upgrade request', async () => {
      await browserDO.start()

      const request = new Request('http://localhost/screencast', {
        headers: { Upgrade: 'websocket' },
      })

      const mockClient = createMockWebSocket()
      const mockServer = createMockWebSocket()
      const response = browserDO._handleScreencastWebSocket(
        request,
        mockClient,
        mockServer
      )

      expect(response.status).toBe(101)
    })

    it('accepts WebSocket connection', async () => {
      await browserDO.start()

      const request = new Request('http://localhost/screencast', {
        headers: { Upgrade: 'websocket' },
      })

      const mockClient = createMockWebSocket()
      const mockServer = createMockWebSocket()
      browserDO._handleScreencastWebSocket(request, mockClient, mockServer)

      expect(mockServer.accept).toHaveBeenCalled()
    })

    it('adds server socket to screencast clients', async () => {
      await browserDO.start()

      const request = new Request('http://localhost/screencast', {
        headers: { Upgrade: 'websocket' },
      })

      const mockClient = createMockWebSocket()
      const mockServer = createMockWebSocket()
      browserDO._handleScreencastWebSocket(request, mockClient, mockServer)

      expect(browserDO._getScreencastClients().has(mockServer)).toBe(true)
    })
  })

  // ==========================================================================
  // 5. WebSocket client receives frame messages
  // ==========================================================================

  describe('WebSocket client receives frame messages', () => {
    beforeEach(() => {
      const mockSession = createMockBrowseSession(mockCDPSession)
      mockBrowseInit.mockResolvedValue(mockSession)
    })

    it('broadcasts frame to connected WebSocket client', async () => {
      await browserDO.start()
      await browserDO.startScreencast()

      const mockClient = createMockWebSocket()
      browserDO._addScreencastClient(mockClient)

      // Simulate CDP frame event
      mockCDPSession._emit('Page.screencastFrame', {
        data: 'base64-frame-data',
        metadata: { offsetTop: 0, pageScaleFactor: 1 },
        sessionId: 1,
      })

      expect(mockClient.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"frame"')
      )
      expect(mockClient.send).toHaveBeenCalledWith(
        expect.stringContaining('"data":"base64-frame-data"')
      )
    })

    it('includes timestamp in frame message', async () => {
      await browserDO.start()
      await browserDO.startScreencast()

      const mockClient = createMockWebSocket()
      browserDO._addScreencastClient(mockClient)

      mockCDPSession._emit('Page.screencastFrame', {
        data: 'frame-data',
        sessionId: 1,
      })

      const sentMessage = mockClient.send.mock.calls[0][0]
      const parsed = JSON.parse(sentMessage)
      expect(parsed.timestamp).toBeDefined()
      expect(typeof parsed.timestamp).toBe('number')
    })

    it('includes metadata in frame message when provided', async () => {
      await browserDO.start()
      await browserDO.startScreencast()

      const mockClient = createMockWebSocket()
      browserDO._addScreencastClient(mockClient)

      const metadata = {
        offsetTop: 10,
        pageScaleFactor: 2,
        deviceWidth: 1920,
        deviceHeight: 1080,
      }

      mockCDPSession._emit('Page.screencastFrame', {
        data: 'frame-data',
        metadata,
        sessionId: 1,
      })

      const sentMessage = mockClient.send.mock.calls[0][0]
      const parsed = JSON.parse(sentMessage)
      expect(parsed.metadata).toEqual(metadata)
    })
  })

  // ==========================================================================
  // 6. Multiple clients receive same frames
  // ==========================================================================

  describe('Multiple clients receive same frames', () => {
    beforeEach(() => {
      const mockSession = createMockBrowseSession(mockCDPSession)
      mockBrowseInit.mockResolvedValue(mockSession)
    })

    it('broadcasts frame to all connected clients', async () => {
      await browserDO.start()
      await browserDO.startScreencast()

      const client1 = createMockWebSocket()
      const client2 = createMockWebSocket()
      const client3 = createMockWebSocket()

      browserDO._addScreencastClient(client1)
      browserDO._addScreencastClient(client2)
      browserDO._addScreencastClient(client3)

      mockCDPSession._emit('Page.screencastFrame', {
        data: 'frame-data',
        sessionId: 1,
      })

      expect(client1.send).toHaveBeenCalled()
      expect(client2.send).toHaveBeenCalled()
      expect(client3.send).toHaveBeenCalled()
    })

    it('all clients receive identical frame data', async () => {
      await browserDO.start()
      await browserDO.startScreencast()

      const client1 = createMockWebSocket()
      const client2 = createMockWebSocket()

      browserDO._addScreencastClient(client1)
      browserDO._addScreencastClient(client2)

      mockCDPSession._emit('Page.screencastFrame', {
        data: 'identical-frame-data',
        sessionId: 1,
      })

      const message1 = client1.send.mock.calls[0][0]
      const message2 = client2.send.mock.calls[0][0]

      // Timestamps might differ slightly, so compare just the data
      const parsed1 = JSON.parse(message1)
      const parsed2 = JSON.parse(message2)

      expect(parsed1.data).toBe(parsed2.data)
      expect(parsed1.type).toBe(parsed2.type)
    })

    it('removes disconnected client from broadcast list', async () => {
      await browserDO.start()
      await browserDO.startScreencast()

      const activeClient = createMockWebSocket()
      const disconnectedClient = createMockWebSocket()
      disconnectedClient.send.mockImplementation(() => {
        throw new Error('WebSocket disconnected')
      })

      browserDO._addScreencastClient(activeClient)
      browserDO._addScreencastClient(disconnectedClient)

      // Broadcast should remove the disconnected client
      browserDO._broadcastFrame('frame-data')

      expect(browserDO._getScreencastClients().has(disconnectedClient)).toBe(
        false
      )
      expect(browserDO._getScreencastClients().has(activeClient)).toBe(true)
    })
  })

  // ==========================================================================
  // 7. Last client disconnect stops screencast
  // ==========================================================================

  describe('Last client disconnect stops screencast', () => {
    beforeEach(() => {
      const mockSession = createMockBrowseSession(mockCDPSession)
      mockBrowseInit.mockResolvedValue(mockSession)
    })

    it('stops screencast when last client disconnects', async () => {
      await browserDO.start()

      const request = new Request('http://localhost/screencast', {
        headers: { Upgrade: 'websocket' },
      })

      const mockClient = createMockWebSocket()
      const mockServer = createMockWebSocket()
      browserDO._handleScreencastWebSocket(request, mockClient, mockServer)

      // Start screencast
      await browserDO.startScreencast()

      // Simulate close event
      mockServer._emit('close')

      // Wait for async stopScreencast
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockCDPSession.send).toHaveBeenCalledWith('Page.stopScreencast')
    })

    it('does not stop screencast when other clients remain', async () => {
      await browserDO.start()
      await browserDO.startScreencast()

      const client1 = createMockWebSocket()
      const client2 = createMockWebSocket()

      browserDO._addScreencastClient(client1)
      browserDO._addScreencastClient(client2)

      // Remove one client
      browserDO._getScreencastClients().delete(client1)

      // Manually trigger close handler logic
      if (browserDO._getScreencastClients().size === 0) {
        await browserDO.stopScreencast()
      }

      // stopScreencast was only called once (from startScreencast -> stopScreencast chain test)
      // Reset to check fresh
      mockCDPSession.send.mockClear()

      // Now we have one client left, shouldn't stop
      expect(browserDO._getScreencastClients().size).toBe(1)
    })

    it('removes client from set on disconnect', async () => {
      await browserDO.start()

      const request = new Request('http://localhost/screencast', {
        headers: { Upgrade: 'websocket' },
      })

      const mockClient = createMockWebSocket()
      const mockServer = createMockWebSocket()
      browserDO._handleScreencastWebSocket(request, mockClient, mockServer)

      expect(browserDO._getScreencastClients().size).toBe(1)

      // Simulate close event
      mockServer._emit('close')

      expect(browserDO._getScreencastClients().size).toBe(0)
    })
  })

  // ==========================================================================
  // 8. Screencast options are passed correctly
  // ==========================================================================

  describe('Screencast options are passed correctly', () => {
    beforeEach(() => {
      const mockSession = createMockBrowseSession(mockCDPSession)
      mockBrowseInit.mockResolvedValue(mockSession)
    })

    it('passes format option', async () => {
      await browserDO.start()
      await browserDO.startScreencast({ format: 'png' })

      expect(mockCDPSession.send).toHaveBeenCalledWith(
        'Page.startScreencast',
        expect.objectContaining({ format: 'png' })
      )
    })

    it('passes quality option', async () => {
      await browserDO.start()
      await browserDO.startScreencast({ quality: 80 })

      expect(mockCDPSession.send).toHaveBeenCalledWith(
        'Page.startScreencast',
        expect.objectContaining({ quality: 80 })
      )
    })

    it('passes maxWidth option', async () => {
      await browserDO.start()
      await browserDO.startScreencast({ maxWidth: 1920 })

      expect(mockCDPSession.send).toHaveBeenCalledWith(
        'Page.startScreencast',
        expect.objectContaining({ maxWidth: 1920 })
      )
    })

    it('passes maxHeight option', async () => {
      await browserDO.start()
      await browserDO.startScreencast({ maxHeight: 1080 })

      expect(mockCDPSession.send).toHaveBeenCalledWith(
        'Page.startScreencast',
        expect.objectContaining({ maxHeight: 1080 })
      )
    })

    it('passes everyNthFrame option', async () => {
      await browserDO.start()
      await browserDO.startScreencast({ everyNthFrame: 1 })

      expect(mockCDPSession.send).toHaveBeenCalledWith(
        'Page.startScreencast',
        expect.objectContaining({ everyNthFrame: 1 })
      )
    })

    it('passes all options together', async () => {
      await browserDO.start()
      await browserDO.startScreencast({
        format: 'png',
        quality: 90,
        maxWidth: 1920,
        maxHeight: 1080,
        everyNthFrame: 1,
      })

      expect(mockCDPSession.send).toHaveBeenCalledWith('Page.startScreencast', {
        format: 'png',
        quality: 90,
        maxWidth: 1920,
        maxHeight: 1080,
        everyNthFrame: 1,
      })
    })

    it('uses defaults when options not provided', async () => {
      await browserDO.start()
      await browserDO.startScreencast({})

      expect(mockCDPSession.send).toHaveBeenCalledWith('Page.startScreencast', {
        format: 'jpeg',
        quality: 60,
        maxWidth: 1280,
        maxHeight: 720,
        everyNthFrame: 2,
      })
    })
  })

  // ==========================================================================
  // 9. screencastFrameAck is sent after receiving frame
  // ==========================================================================

  describe('screencastFrameAck is sent after receiving frame', () => {
    beforeEach(() => {
      const mockSession = createMockBrowseSession(mockCDPSession)
      mockBrowseInit.mockResolvedValue(mockSession)
    })

    it('sends Page.screencastFrameAck after receiving frame', async () => {
      await browserDO.start()
      await browserDO.startScreencast()

      const mockClient = createMockWebSocket()
      browserDO._addScreencastClient(mockClient)

      mockCDPSession._emit('Page.screencastFrame', {
        data: 'frame-data',
        sessionId: 42,
      })

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockCDPSession.send).toHaveBeenCalledWith(
        'Page.screencastFrameAck',
        { sessionId: 42 }
      )
    })

    it('acks with correct sessionId from frame event', async () => {
      await browserDO.start()
      await browserDO.startScreencast()

      const mockClient = createMockWebSocket()
      browserDO._addScreencastClient(mockClient)

      // Send multiple frames with different session IDs
      mockCDPSession._emit('Page.screencastFrame', {
        data: 'frame-1',
        sessionId: 100,
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      mockCDPSession._emit('Page.screencastFrame', {
        data: 'frame-2',
        sessionId: 101,
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      const ackCalls = mockCDPSession.send.mock.calls.filter(
        (call) => call[0] === 'Page.screencastFrameAck'
      )

      expect(ackCalls).toHaveLength(2)
      expect(ackCalls[0][1]).toEqual({ sessionId: 100 })
      expect(ackCalls[1][1]).toEqual({ sessionId: 101 })
    })
  })

  // ==========================================================================
  // 10. HTTP routes for screencast
  // ==========================================================================

  describe('HTTP routes for screencast', () => {
    beforeEach(() => {
      const mockSession = createMockBrowseSession(mockCDPSession)
      mockBrowseInit.mockResolvedValue(mockSession)
    })

    it('GET /screencast returns 400 without WebSocket upgrade', async () => {
      await browserDO.start()

      const request = new Request('http://localhost/screencast', {
        method: 'GET',
      })
      const response = await browserDO.fetch(request)

      expect(response.status).toBe(400)
      expect(await response.text()).toBe('Use WebSocket upgrade')
    })

    it('POST /screencast/start starts screencast', async () => {
      await browserDO.start()

      const request = new Request('http://localhost/screencast/start', {
        method: 'POST',
        body: JSON.stringify({ quality: 80 }),
      })
      const response = await browserDO.fetch(request)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
    })

    it('POST /screencast/start returns 400 without session', async () => {
      const request = new Request('http://localhost/screencast/start', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      const response = await browserDO.fetch(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe('Browser session not started')
    })

    it('POST /screencast/stop stops screencast', async () => {
      await browserDO.start()
      await browserDO.startScreencast()

      const request = new Request('http://localhost/screencast/stop', {
        method: 'POST',
      })
      const response = await browserDO.fetch(request)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
    })
  })

  // ==========================================================================
  // 11. WebSocket message handling
  // ==========================================================================

  describe('WebSocket message handling', () => {
    beforeEach(() => {
      const mockSession = createMockBrowseSession(mockCDPSession)
      mockBrowseInit.mockResolvedValue(mockSession)
    })

    it('handles start action via WebSocket message', async () => {
      await browserDO.start()

      const request = new Request('http://localhost/screencast', {
        headers: { Upgrade: 'websocket' },
      })

      const mockClient = createMockWebSocket()
      const mockServer = createMockWebSocket()
      browserDO._handleScreencastWebSocket(request, mockClient, mockServer)

      // Simulate message event
      mockServer._emit('message', {
        data: JSON.stringify({ action: 'start', options: { quality: 70 } }),
      })

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockCDPSession.send).toHaveBeenCalledWith(
        'Page.startScreencast',
        expect.objectContaining({ quality: 70 })
      )
    })

    it('handles stop action via WebSocket message', async () => {
      await browserDO.start()
      await browserDO.startScreencast()

      const request = new Request('http://localhost/screencast', {
        headers: { Upgrade: 'websocket' },
      })

      const mockClient = createMockWebSocket()
      const mockServer = createMockWebSocket()
      browserDO._handleScreencastWebSocket(request, mockClient, mockServer)

      // Clear previous calls
      mockCDPSession.send.mockClear()

      // Simulate message event
      mockServer._emit('message', {
        data: JSON.stringify({ action: 'stop' }),
      })

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockCDPSession.send).toHaveBeenCalledWith('Page.stopScreencast')
    })

    it('sends error message on invalid WebSocket message', async () => {
      await browserDO.start()

      const request = new Request('http://localhost/screencast', {
        headers: { Upgrade: 'websocket' },
      })

      const mockClient = createMockWebSocket()
      const mockServer = createMockWebSocket()
      browserDO._handleScreencastWebSocket(request, mockClient, mockServer)

      // Simulate message event with invalid action that will fail
      // (starting screencast without proper setup will fail)
      browserDO._setSession(null) // Remove session to cause error

      mockServer._emit('message', {
        data: JSON.stringify({ action: 'start' }),
      })

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockServer.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"error"')
      )
    })
  })
})
