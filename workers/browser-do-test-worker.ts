/**
 * Browser DO Test Worker
 *
 * Test worker for Browser Durable Object integration tests.
 * Provides a TestBrowserDO that uses in-memory session mocking to test
 * Browser DO lifecycle, HTTP routes, and screencast functionality
 * without requiring actual browser infrastructure.
 *
 * The Browse.init is mocked at the DO level to return a controllable
 * mock session, allowing full testing of DO behavior.
 *
 * @module workers/browser-do-test-worker
 */

import { DurableObject } from 'cloudflare:workers'
import { Hono } from 'hono'
import type { BrowserProvider, BrowserStatus } from '../types/Browser'
import type {
  BrowseSession,
  ActResult,
  ObserveResult,
  ScreenshotOptions,
} from '../lib/browse'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for starting a browser session
 */
export interface BrowserStartOptions {
  provider?: BrowserProvider
  liveView?: boolean
  viewport?: { width: number; height: number }
  stealth?: boolean
}

/**
 * Result from starting a browser session
 */
export interface BrowserStartResult {
  sessionId: string
  provider: BrowserProvider
  liveViewUrl?: string
}

/**
 * Browser state returned by getState()
 */
export interface BrowserState {
  status: BrowserStatus
  provider?: BrowserProvider
  currentUrl?: string
  liveViewUrl?: string
}

/**
 * Result from agent execution
 */
export interface AgentResult {
  success: boolean
  steps?: string[]
  result?: unknown
  error?: string
}

/**
 * Options for CDP screencast streaming
 */
export interface ScreencastStreamOptions {
  format?: 'jpeg' | 'png'
  quality?: number
  maxWidth?: number
  maxHeight?: number
  everyNthFrame?: number
}

/**
 * Internal browser config stored in ctx.storage
 */
interface BrowserConfigStored {
  provider: BrowserProvider
  liveView: boolean
  viewport?: { width: number; height: number }
  stealth?: boolean
  sessionId?: string
}

// ============================================================================
// MOCK BROWSE SESSION
// ============================================================================

/**
 * Mock BrowseSession for testing without real browser.
 * Controllable via test configuration stored in DO storage.
 */
class MockBrowseSession implements BrowseSession {
  private currentUrl: string = ''
  private closed = false
  public liveViewUrl?: string

  // Mock page for CDP session
  public page?: {
    createCDPSession(): Promise<MockCDPSession>
  }

  // Agent capability
  public agent?: {
    execute(goal: string): Promise<AgentResult>
  }

  constructor(config: { liveViewUrl?: string; enableAgent?: boolean }) {
    this.liveViewUrl = config.liveViewUrl

    // Create mock page with CDP session support
    this.page = {
      createCDPSession: async () => new MockCDPSession(),
    }

    // Enable agent if configured
    if (config.enableAgent) {
      this.agent = {
        execute: async (goal: string): Promise<AgentResult> => {
          return {
            success: true,
            steps: [`Step 1: Analyze goal "${goal}"`, 'Step 2: Execute actions', 'Step 3: Complete'],
          }
        },
      }
    }
  }

  async goto(url: string): Promise<void> {
    if (this.closed) throw new Error('Session is closed')
    // Validate URL
    try {
      new URL(url)
    } catch {
      throw new Error(`Invalid URL: ${url}`)
    }
    this.currentUrl = url
  }

  async act(instruction: string): Promise<ActResult> {
    if (this.closed) throw new Error('Session is closed')
    return {
      success: true,
      action: `executed: ${instruction}`,
    }
  }

  async extract<T = unknown>(instruction: string, schema?: unknown): Promise<T> {
    if (this.closed) throw new Error('Session is closed')
    return { instruction, schema, extracted: true } as T
  }

  async observe(instruction?: string): Promise<ObserveResult> {
    if (this.closed) throw new Error('Session is closed')
    return [
      { action: 'click', selector: 'button.submit', description: 'Submit button' },
      { action: 'type', selector: 'input[name=email]', description: 'Email field' },
    ]
  }

  async screenshot(options?: ScreenshotOptions): Promise<string> {
    if (this.closed) throw new Error('Session is closed')
    // Return a valid base64 encoded 1x1 transparent PNG
    return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  }

  async close(): Promise<void> {
    this.closed = true
  }

  getCurrentUrl(): string {
    return this.currentUrl
  }
}

/**
 * Mock CDP Session for screencast testing
 */
class MockCDPSession {
  private listeners = new Map<string, Set<(data: unknown) => void>>()
  private frameInterval?: ReturnType<typeof setInterval>
  private frameSessionId = 1

  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (method === 'Page.startScreencast') {
      // Start sending mock frames periodically
      this.startMockFrames(params)
    } else if (method === 'Page.stopScreencast') {
      this.stopMockFrames()
    }
    return {}
  }

  on(event: string, handler: (data: unknown) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(handler)
  }

  off(event: string, handler: (data: unknown) => void): void {
    this.listeners.get(event)?.delete(handler)
  }

  private emit(event: string, data: unknown): void {
    this.listeners.get(event)?.forEach(handler => handler(data))
  }

  private startMockFrames(params?: Record<string, unknown>): void {
    // Emit a frame immediately for testing
    this.emit('Page.screencastFrame', {
      data: 'mock-frame-data-base64',
      metadata: {
        offsetTop: 0,
        pageScaleFactor: 1,
        deviceWidth: params?.maxWidth ?? 1280,
        deviceHeight: params?.maxHeight ?? 720,
      },
      sessionId: this.frameSessionId++,
    })
  }

  private stopMockFrames(): void {
    if (this.frameInterval) {
      clearInterval(this.frameInterval)
      this.frameInterval = undefined
    }
  }
}

// ============================================================================
// TEST BROWSER DURABLE OBJECT
// ============================================================================

/**
 * Test Browser DO for integration testing.
 * Uses mock Browse session instead of real browser infrastructure.
 */
export class TestBrowserDO extends DurableObject {
  private app: Hono
  private session: MockBrowseSession | null = null
  private storedConfig: BrowserConfigStored | null = null
  private lastActivity: number = 0
  private readonly SESSION_TIMEOUT = 5 * 60 * 1000
  private cdpSession: MockCDPSession | null = null
  private screencastClients = new Set<WebSocket>()
  private ns: string

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env)
    this.ns = ctx.id.toString()
    this.app = this.createApp()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP ROUTING
  // ═══════════════════════════════════════════════════════════════════════════

  private createApp(): Hono {
    const app = new Hono()

    // POST /start - Start browser session
    app.post('/start', async (c) => {
      try {
        let body: BrowserStartOptions = {}
        try {
          body = await c.req.json()
        } catch {
          return c.json({ error: 'Invalid JSON body' }, 400)
        }
        const result = await this.start(body)
        return c.json(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message.includes('already active')) {
          return c.json({ error: message }, 409)
        }
        if (message.includes('Invalid provider')) {
          return c.json({ error: message }, 400)
        }
        return c.json({ error: message }, 500)
      }
    })

    // POST /goto - Navigate to URL
    app.post('/goto', async (c) => {
      try {
        const body = await c.req.json().catch(() => ({}))
        if (!body.url) {
          return c.json({ error: 'Missing required field: url' }, 400)
        }
        await this.goto(body.url)
        return c.json({ success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message.includes('No active browser session')) {
          return c.json({ error: 'No active browser session' }, 400)
        }
        if (message.includes('Invalid URL')) {
          return c.json({ error: message }, 400)
        }
        return c.json({ error: message }, 500)
      }
    })

    // POST /act - Execute natural language action
    app.post('/act', async (c) => {
      try {
        const body = await c.req.json().catch(() => ({}))
        if (!body.instruction) {
          return c.json({ error: 'Missing required field: instruction' }, 400)
        }
        const result = await this.act(body.instruction)
        return c.json(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message.includes('No active browser session')) {
          return c.json({ error: 'No active browser session' }, 400)
        }
        return c.json({ error: message }, 500)
      }
    })

    // POST /extract - Extract structured data
    app.post('/extract', async (c) => {
      try {
        const body = await c.req.json().catch(() => ({}))
        if (!body.instruction) {
          return c.json({ error: 'Missing required field: instruction' }, 400)
        }
        const result = await this.extract(body.instruction, body.schema)
        return c.json(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message.includes('No active browser session')) {
          return c.json({ error: 'No active browser session' }, 400)
        }
        return c.json({ error: message }, 500)
      }
    })

    // POST /observe - Discover available actions
    app.post('/observe', async (c) => {
      try {
        const body = await c.req.json().catch(() => ({}))
        const result = await this.observe(body.instruction)
        return c.json(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message.includes('No active browser session')) {
          return c.json({ error: 'No active browser session' }, 400)
        }
        return c.json({ error: message }, 500)
      }
    })

    // POST /agent - Run autonomous agent
    app.post('/agent', async (c) => {
      try {
        const body = await c.req.json().catch(() => ({}))
        if (!body.goal) {
          return c.json({ error: 'Missing required field: goal' }, 400)
        }
        const result = await this.runAgent(body.goal)
        return c.json(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message.includes('No active browser session')) {
          return c.json({ error: 'No active browser session' }, 400)
        }
        if (message.includes('Agent not available')) {
          return c.json({ error: 'Agent not available on this browser session' }, 400)
        }
        return c.json({ error: message }, 500)
      }
    })

    // GET /state - Get browser state
    app.get('/state', async (c) => {
      const state = await this.getState()
      return c.json(state)
    })

    // GET /screenshot - Capture page screenshot
    app.get('/screenshot', async (c) => {
      try {
        const fullPage = c.req.query('fullPage') === 'true'
        const selector = c.req.query('selector')

        const options: ScreenshotOptions = {}
        if (fullPage) options.fullPage = true
        if (selector) options.selector = selector

        const image = await this.screenshot(Object.keys(options).length > 0 ? options : undefined)
        return c.json({ image })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message.includes('No active browser session')) {
          return c.json({ error: 'No active browser session' }, 400)
        }
        return c.json({ error: message }, 500)
      }
    })

    // POST /stop - Stop browser session
    app.post('/stop', async (c) => {
      try {
        await this.stop()
        return c.json({ success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message.includes('No active browser session')) {
          return c.json({ error: 'No active browser session' }, 400)
        }
        return c.json({ error: message }, 500)
      }
    })

    // GET /live - Redirect to live view
    app.get('/live', (c) => {
      const liveViewUrl = this.session?.liveViewUrl
      if (!liveViewUrl) {
        return c.json({ error: 'Live view not available' }, 404)
      }
      return c.redirect(liveViewUrl, 302)
    })

    // GET /screencast - WebSocket info
    app.get('/screencast', (c) => {
      return c.text('Use WebSocket upgrade', 400)
    })

    // POST /screencast/start - Start screencast streaming
    app.post('/screencast/start', async (c) => {
      try {
        const body = await c.req.json().catch(() => ({}))
        await this.startScreencast(body as ScreencastStreamOptions)
        return c.json({ success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message.includes('Browser session not started')) {
          return c.json({ error: message }, 400)
        }
        return c.json({ error: message }, 500)
      }
    })

    // POST /screencast/stop - Stop screencast streaming
    app.post('/screencast/stop', async (c) => {
      try {
        await this.stopScreencast()
        return c.json({ success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return c.json({ error: message }, 500)
      }
    })

    // Method not allowed handlers
    app.on(['GET'], ['/start', '/goto', '/act', '/extract', '/observe', '/agent', '/stop'], (c) => {
      return c.json({ error: 'Method not allowed' }, 405)
    })

    app.on(['POST', 'PUT', 'DELETE', 'PATCH'], ['/state', '/screenshot', '/live'], (c) => {
      return c.json({ error: 'Method not allowed' }, 405)
    })

    // 404 handler
    app.all('*', (c) => {
      return c.json({ error: 'Not found' }, 404)
    })

    return app
  }

  async fetch(request: Request): Promise<Response> {
    // Check for WebSocket upgrade on /screencast path
    const url = new URL(request.url)
    if (url.pathname === '/screencast' && request.headers.get('Upgrade') === 'websocket') {
      return this.handleScreencastWebSocket(request)
    }

    return this.app.fetch(request)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE METHODS
  // ═══════════════════════════════════════════════════════════════════════════

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

    // Create mock session
    const liveViewUrl = provider === 'browserbase' && liveView
      ? `https://live.browserbase.test/session-${crypto.randomUUID().slice(0, 8)}`
      : undefined

    this.session = new MockBrowseSession({
      liveViewUrl,
      enableAgent: true,
    })

    // Generate session ID
    const sessionId = crypto.randomUUID()

    // Store config
    this.storedConfig = {
      provider,
      liveView,
      viewport: options.viewport,
      stealth: options.stealth,
      sessionId,
    }

    await this.ctx.storage.put('browser:config', this.storedConfig)

    // Update last activity
    this.lastActivity = Date.now()
    await this.ctx.storage.put('browser:lastActivity', this.lastActivity)

    // Set alarm for keepAlive check
    const nextAlarm = Date.now() + 60_000
    await this.ctx.storage.setAlarm(nextAlarm)

    return {
      sessionId,
      provider,
      liveViewUrl: this.session.liveViewUrl,
    }
  }

  async stop(): Promise<void> {
    if (!this.session) {
      throw new Error('No active browser session')
    }

    // Stop screencast and cleanup CDP session
    if (this.cdpSession) {
      await this.stopScreencast().catch(() => {})
      this.cdpSession = null
    }

    // Close all screencast WebSocket clients
    for (const client of this.screencastClients) {
      try {
        client.close()
      } catch {
        // Ignore close errors
      }
    }
    this.screencastClients.clear()

    // Close session
    await this.session.close()

    // Clear alarm
    await this.ctx.storage.deleteAlarm()

    // Clear state
    this.session = null
    this.storedConfig = null
    this.lastActivity = 0

    // Clear stored config
    await this.ctx.storage.delete('browser:config')
    await this.ctx.storage.delete('browser:lastActivity')
  }

  async alarm(): Promise<void> {
    if (!this.session) {
      return
    }

    const now = Date.now()
    const storedLastActivity = await this.ctx.storage.get('browser:lastActivity') as number | undefined
    const lastActivity = storedLastActivity ?? this.lastActivity

    // Check if session has been inactive too long
    if (now - lastActivity > this.SESSION_TIMEOUT) {
      await this.stop()
    } else {
      // Session still active - reset alarm
      const nextAlarm = now + 60_000
      await this.ctx.storage.setAlarm(nextAlarm)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BROWSER OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  private async touch(): Promise<void> {
    this.lastActivity = Date.now()
    await this.ctx.storage.put('browser:lastActivity', this.lastActivity)
  }

  async goto(url: string): Promise<void> {
    if (!this.session) {
      throw new Error('No active browser session')
    }
    await this.touch()
    await this.session.goto(url)
  }

  async act(instruction: string): Promise<ActResult> {
    if (!this.session) {
      throw new Error('No active browser session')
    }
    await this.touch()
    return this.session.act(instruction)
  }

  async extract<T = unknown>(instruction: string, schema?: unknown): Promise<T> {
    if (!this.session) {
      throw new Error('No active browser session')
    }
    await this.touch()
    return this.session.extract(instruction, schema)
  }

  async observe(instruction?: string): Promise<ObserveResult> {
    if (!this.session) {
      throw new Error('No active browser session')
    }
    await this.touch()
    return this.session.observe(instruction)
  }

  async runAgent(goal: string): Promise<AgentResult> {
    if (!this.session) {
      throw new Error('No active browser session')
    }
    if (!this.session.agent) {
      throw new Error('Agent not available on this browser session')
    }
    await this.touch()
    return this.session.agent.execute(goal)
  }

  async screenshot(options?: ScreenshotOptions): Promise<string> {
    if (!this.session) {
      throw new Error('No active browser session')
    }
    await this.touch()
    return this.session.screenshot(options)
  }

  async getState(): Promise<BrowserState> {
    const status: BrowserStatus = this.session ? 'active' : 'stopped'
    const provider = this.storedConfig?.provider
    const currentUrl = this.session?.getCurrentUrl()
    const liveViewUrl = this.session?.liveViewUrl

    return {
      status,
      provider,
      currentUrl,
      liveViewUrl,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCREENCAST OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async startScreencast(options: ScreencastStreamOptions = {}): Promise<void> {
    if (!this.session?.page) {
      throw new Error('Browser session not started')
    }

    // Create CDP session if not exists
    if (!this.cdpSession) {
      this.cdpSession = await this.session.page.createCDPSession()

      // Listen for frames
      this.cdpSession.on('Page.screencastFrame', async (event: unknown) => {
        const { data, metadata, sessionId } = event as {
          data: string
          metadata?: unknown
          sessionId: number
        }

        // Broadcast to all connected clients
        this.broadcastFrame(data, metadata)

        // Acknowledge frame receipt
        await this.cdpSession?.send('Page.screencastFrameAck', { sessionId })
      })
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

  async stopScreencast(): Promise<void> {
    if (this.cdpSession) {
      await this.cdpSession.send('Page.stopScreencast')
    }
  }

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
        // Client disconnected, remove from set
        this.screencastClients.delete(client)
      }
    }
  }

  private handleScreencastWebSocket(request: Request): Response {
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    server!.accept()
    this.screencastClients.add(server!)

    server!.addEventListener('message', async (event) => {
      try {
        const msg = JSON.parse(event.data as string)
        if (msg.action === 'start') {
          await this.startScreencast(msg.options)
        } else if (msg.action === 'stop') {
          await this.stopScreencast()
        }
      } catch (e) {
        server!.send(JSON.stringify({ type: 'error', message: (e as Error).message }))
      }
    })

    server!.addEventListener('close', () => {
      this.screencastClients.delete(server!)
      // Stop screencast if no more clients
      if (this.screencastClients.size === 0) {
        this.stopScreencast().catch(() => {})
      }
    })

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RPC METHODS FOR DIRECT ACCESS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get namespace (RPC accessible)
   */
  getNs(): string {
    return this.ns
  }

  /**
   * Check if session is active (RPC accessible)
   */
  isActive(): boolean {
    return this.session !== null
  }

  /**
   * Get stored config (RPC accessible)
   */
  getConfig(): BrowserConfigStored | null {
    return this.storedConfig
  }

  /**
   * Get last activity timestamp (RPC accessible)
   */
  getLastActivity(): number {
    return this.lastActivity
  }
}

// ============================================================================
// WORKER ENTRY POINT
// ============================================================================

export interface TestBrowserEnv {
  BROWSER_DO: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: TestBrowserEnv): Promise<Response> {
    // Extract namespace from header or use default
    const ns = request.headers.get('X-DO-NS') || 'test'

    // Get DO stub by name
    const id = env.BROWSER_DO.idFromName(ns)
    const stub = env.BROWSER_DO.get(id)

    // Forward request to DO
    return stub.fetch(request)
  },
}
