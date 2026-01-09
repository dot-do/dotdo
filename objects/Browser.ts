/**
 * Browser - Durable Object for browser automation session management
 *
 * Provides lifecycle management for browser automation sessions using
 * the Browse library abstraction over Cloudflare Browser Rendering
 * and Browserbase providers.
 *
 * Features:
 * - Session lifecycle: start(), stop(), alarm() for keepAlive
 * - Provider abstraction: cloudflare and browserbase
 * - Live view support for browserbase
 * - Activity tracking with automatic timeout
 * - Event emission for observability
 * - AI operations: act, extract, observe
 * - Autonomous agent execution
 * - Screenshots
 *
 * @example
 * ```typescript
 * // Start a browser session with Cloudflare
 * const result = await browserDO.start({
 *   provider: 'cloudflare',
 *   viewport: { width: 1920, height: 1080 },
 * })
 *
 * // Start with Browserbase and live view
 * const result = await browserDO.start({
 *   provider: 'browserbase',
 *   liveView: true,
 * })
 * console.log('Watch at:', result.liveViewUrl)
 *
 * // Perform operations
 * await browserDO.goto('https://example.com')
 * await browserDO.act('Click the login button')
 * const data = await browserDO.extract('Get the user profile')
 *
 * // Stop the session
 * await browserDO.stop()
 * ```
 */

import { Hono } from 'hono'
import { DO, type Env } from './DO'
import { Browse, type BrowseSession, type BrowseInitConfig, type ActResult, type ObserveResult, type ScreenshotOptions } from '../lib/browse'
import type { BrowserConfig, BrowserProvider, BrowserStatus } from '../types/Browser'

// ============================================================================
// Types
// ============================================================================

/**
 * Environment bindings for Browser DO
 */
export interface BrowserEnv extends Env {
  /** Cloudflare Browser binding */
  BROWSER?: unknown
  /** Browserbase API key */
  BROWSERBASE_API_KEY?: string
  /** Browserbase project ID */
  BROWSERBASE_PROJECT_ID?: string
}

/**
 * Options for starting a browser session
 */
export interface BrowserStartOptions {
  /** Browser provider to use (defaults to 'cloudflare') */
  provider?: BrowserProvider
  /** Enable live view for observing the session (Browserbase only) */
  liveView?: boolean
  /** Viewport dimensions */
  viewport?: { width: number; height: number }
  /** Enable stealth mode to avoid detection */
  stealth?: boolean
}

/**
 * Result from starting a browser session
 */
export interface BrowserStartResult {
  /** Unique session ID */
  sessionId: string
  /** Provider used for this session */
  provider: BrowserProvider
  /** Live view URL (Browserbase with liveView enabled only) */
  liveViewUrl?: string
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
 * Extended session with optional agent capability
 */
interface BrowseSessionWithAgent extends BrowseSession {
  agent?: {
    execute(goal: string): Promise<AgentResult>
  }
}

// ============================================================================
// Browser Durable Object
// ============================================================================

export class Browser<E extends BrowserEnv = BrowserEnv> extends DO<E> {
  // ═══════════════════════════════════════════════════════════════════════════
  // TYPE DISCRIMINATOR
  // ═══════════════════════════════════════════════════════════════════════════

  static override readonly $type: string = 'Browser'

  // ═══════════════════════════════════════════════════════════════════════════
  // HONO HTTP APP
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Hono app for HTTP route handling (overrides DO.app)
   */
  protected override app: Hono

  constructor(ctx: DurableObjectState, env: E) {
    super(ctx, env)
    this.app = this.createApp()
  }

  /**
   * Create the Hono app with all browser routes
   */
  private createApp(): Hono {
    const app = new Hono()

    // ─────────────────────────────────────────────────────────────────────────
    // POST /start - Start browser session
    // ─────────────────────────────────────────────────────────────────────────
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

    // ─────────────────────────────────────────────────────────────────────────
    // POST /goto - Navigate to URL
    // ─────────────────────────────────────────────────────────────────────────
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

    // ─────────────────────────────────────────────────────────────────────────
    // POST /act - Execute natural language action
    // ─────────────────────────────────────────────────────────────────────────
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

    // ─────────────────────────────────────────────────────────────────────────
    // POST /extract - Extract structured data
    // ─────────────────────────────────────────────────────────────────────────
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

    // ─────────────────────────────────────────────────────────────────────────
    // POST /observe - Discover available actions
    // ─────────────────────────────────────────────────────────────────────────
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

    // ─────────────────────────────────────────────────────────────────────────
    // POST /agent - Run autonomous agent
    // ─────────────────────────────────────────────────────────────────────────
    app.post('/agent', async (c) => {
      try {
        const body = await c.req.json().catch(() => ({}))
        if (!body.goal) {
          return c.json({ error: 'Missing required field: goal' }, 400)
        }
        const result = await this.agent(body.goal)
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

    // ─────────────────────────────────────────────────────────────────────────
    // GET /state - Get browser state
    // ─────────────────────────────────────────────────────────────────────────
    app.get('/state', async (c) => {
      const state = await this.getState()
      return c.json(state)
    })

    // ─────────────────────────────────────────────────────────────────────────
    // GET /screenshot - Capture page screenshot
    // ─────────────────────────────────────────────────────────────────────────
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

    // ─────────────────────────────────────────────────────────────────────────
    // POST /stop - Stop browser session
    // ─────────────────────────────────────────────────────────────────────────
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

    // ─────────────────────────────────────────────────────────────────────────
    // GET /live - Redirect to live view
    // ─────────────────────────────────────────────────────────────────────────
    app.get('/live', (c) => {
      const liveViewUrl = this.session?.liveViewUrl
      if (!liveViewUrl) {
        return c.json({ error: 'Live view not available' }, 404)
      }
      return c.redirect(liveViewUrl, 302)
    })

    // ─────────────────────────────────────────────────────────────────────────
    // Method not allowed handler
    // ─────────────────────────────────────────────────────────────────────────
    app.on(['GET'], ['/start', '/goto', '/act', '/extract', '/observe', '/agent', '/stop'], (c) => {
      return c.json({ error: 'Method not allowed' }, 405)
    })

    app.on(['POST', 'PUT', 'DELETE', 'PATCH'], ['/state', '/screenshot', '/live'], (c) => {
      return c.json({ error: 'Method not allowed' }, 405)
    })

    // ─────────────────────────────────────────────────────────────────────────
    // 404 handler for unknown routes
    // ─────────────────────────────────────────────────────────────────────────
    app.all('*', (c) => {
      return c.json({ error: 'Not found' }, 404)
    })

    return app
  }

  /**
   * Handle incoming HTTP requests via Hono
   */
  async fetch(request: Request): Promise<Response> {
    return this.handleFetch(request)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION STATE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Active browser session (null when stopped)
   */
  protected session: BrowseSessionWithAgent | null = null

  /**
   * Browser configuration (stored version with sessionId)
   */
  protected storedConfig: BrowserConfigStored | null = null

  /**
   * Legacy config property for compatibility
   */
  protected config: BrowserConfig | null = null

  /**
   * Last activity timestamp for keep-alive
   */
  protected lastActivity: number = 0

  /**
   * Session timeout in milliseconds (5 minutes)
   */
  protected readonly SESSION_TIMEOUT = 5 * 60 * 1000

  /**
   * Keep-alive timeout in milliseconds (default: 5 minutes)
   * @deprecated Use SESSION_TIMEOUT instead
   */
  protected keepAliveTimeout: number = 5 * 60 * 1000

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Assert that a session is active, throw otherwise
   */
  protected requireSession(): asserts this is { session: BrowseSessionWithAgent } {
    if (!this.session) {
      throw new Error('No active browser session')
    }
  }

  /**
   * Check if a browser session is currently active
   */
  isActive(): boolean {
    return this.session !== null
  }

  /**
   * Get the current stored config
   */
  getConfig(): BrowserConfigStored | null {
    return this.storedConfig
  }

  /**
   * Get the last activity timestamp
   */
  getLastActivity(): number {
    return this.lastActivity
  }

  /**
   * Get the live view URL if available
   */
  getLiveViewUrl(): string | undefined {
    return this.session?.liveViewUrl
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // KEEP-ALIVE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Update last activity timestamp
   *
   * Called internally when browser operations are performed to
   * prevent session timeout.
   */
  async touch(): Promise<void> {
    this.lastActivity = Date.now()
    await this.ctx.storage.put('browser:lastActivity', this.lastActivity)
  }

  /**
   * Reset the keep-alive timer
   * Called after each operation to extend session lifetime
   * @deprecated Use touch() instead
   */
  protected async resetKeepAlive(): Promise<void> {
    await this.touch()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NAVIGATION OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Navigate to a URL
   *
   * @param url - The URL to navigate to
   * @throws Error if session is not started or URL is invalid
   */
  async goto(url: string): Promise<void> {
    this.requireSession()

    // Validate URL format
    try {
      new URL(url)
    } catch {
      throw new Error(`Invalid URL: ${url}`)
    }

    // Navigate
    await this.session.goto(url)

    // Reset keep-alive
    await this.resetKeepAlive()

    // Log action
    await this.logBrowserAction('goto', { url })

    // Emit event
    await this.emit('browser.navigated', { url })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AI OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute a natural language action on the page
   *
   * @param instruction - Natural language instruction (e.g., "Click the submit button")
   * @returns ActResult with success status and action details
   * @throws Error if session is not started
   */
  async act(instruction: string): Promise<ActResult> {
    this.requireSession()

    // Execute action
    const result = await this.session.act(instruction)

    // Reset keep-alive
    await this.resetKeepAlive()

    // Log action with result
    await this.logBrowserAction('act', { instruction, result })

    // Emit event
    await this.emit('browser.acted', { instruction, result })

    return result
  }

  /**
   * Extract structured data from the page
   *
   * @param instruction - Natural language description of what to extract
   * @param schema - Optional JSON schema for the extracted data
   * @returns Extracted data matching the schema
   * @throws Error if session is not started
   */
  async extract<T = unknown>(instruction: string, schema?: unknown): Promise<T> {
    this.requireSession()

    // Extract data
    const result = await this.session.extract<T>(instruction, schema)

    // Reset keep-alive
    await this.resetKeepAlive()

    // Log action with result
    await this.logBrowserAction('extract', { instruction, schema, result })

    // Emit event
    await this.emit('browser.extracted', { instruction, result })

    return result
  }

  /**
   * Observe available actions on the page
   *
   * @param instruction - Optional filter for what actions to observe
   * @returns Array of available actions with selectors and descriptions
   * @throws Error if session is not started
   */
  async observe(instruction?: string): Promise<ObserveResult> {
    this.requireSession()

    // Observe page
    const result = await this.session.observe(instruction)

    // Reset keep-alive
    await this.resetKeepAlive()

    // Log action
    await this.logBrowserAction('observe', { instruction, result })

    // Emit event
    await this.emit('browser.observed', { instruction, actions: result })

    return result
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Run an autonomous agent to accomplish a goal
   *
   * @param goal - The goal for the agent to accomplish
   * @returns AgentResult with success status and steps taken
   * @throws Error if session is not started or agent is not available
   */
  async agent(goal: string): Promise<AgentResult> {
    this.requireSession()

    // Check if agent is available on the session
    if (!this.session.agent) {
      throw new Error('Agent not available on this browser session')
    }

    // Execute agent
    const result = await this.session.agent.execute(goal)

    // Reset keep-alive
    await this.resetKeepAlive()

    // Log action
    await this.logBrowserAction('agent', { goal, result })

    // Emit event
    await this.emit('browser.agent.completed', { goal, result })

    return result
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCREENSHOT OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Take a screenshot of the current page
   *
   * @param options - Screenshot options (fullPage, selector, type, quality)
   * @returns Base64-encoded screenshot data
   * @throws Error if session is not started
   */
  async screenshot(options?: ScreenshotOptions): Promise<string> {
    this.requireSession()

    // Take screenshot
    const result = await this.session.screenshot(options)

    // Reset keep-alive
    await this.resetKeepAlive()

    // Log action
    await this.logBrowserAction('screenshot', { options })

    // Emit event
    await this.emit('browser.screenshot', { options })

    return result
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the current URL from the browser session
   */
  protected async getCurrentUrl(): Promise<string | undefined> {
    // This would typically get the URL from the page
    // For now, return undefined if not implemented
    return undefined
  }

  /**
   * Get the current browser state
   *
   * @returns BrowserState with status, provider, URLs
   */
  async getState(): Promise<BrowserState> {
    const status: BrowserStatus = this.session ? 'active' : 'stopped'
    const provider = this.config?.provider
    const currentUrl = await this.getCurrentUrl()
    const liveViewUrl = this.session?.liveViewUrl

    return {
      status,
      provider,
      currentUrl,
      liveViewUrl,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BROWSER ACTION LOGGING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Log a browser action
   * Helper method that wraps parent logAction with 'do' durability
   */
  protected async logBrowserAction(verb: string, data: Record<string, unknown>): Promise<{ rowid: number }> {
    // Call parent logAction with 'do' durability
    return super.logAction('do', verb, data)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start a new browser session
   *
   * @param options - Session configuration options
   * @returns Session info including sessionId and optional liveViewUrl
   * @throws If session already active or provider is invalid
   *
   * @example
   * ```typescript
   * // Start with Cloudflare (default)
   * const result = await browser.start()
   *
   * // Start with Browserbase and live view
   * const result = await browser.start({
   *   provider: 'browserbase',
   *   liveView: true,
   * })
   * ```
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
    const browseConfig: BrowseInitConfig = {
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
    this.session = await Browse.init(browseConfig) as BrowseSessionWithAgent

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

    // Also set legacy config for compatibility
    this.config = {
      provider,
      liveView,
      viewport: options.viewport,
      stealth: options.stealth,
    }

    await this.ctx.storage.put('browser:config', this.storedConfig)

    // Update last activity
    this.lastActivity = Date.now()
    await this.ctx.storage.put('browser:lastActivity', this.lastActivity)

    // Set alarm for keepAlive check (every minute)
    const nextAlarm = Date.now() + 60_000
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
   *
   * @throws If no active session
   *
   * @example
   * ```typescript
   * await browser.stop()
   * ```
   */
  async stop(): Promise<void> {
    if (!this.session) {
      throw new Error('No active browser session')
    }

    // Get session ID before clearing
    const sessionId = this.storedConfig?.sessionId

    // Close session
    await this.session.close()

    // Clear alarm
    await this.ctx.storage.deleteAlarm()

    // Clear state
    this.session = null
    this.storedConfig = null
    this.config = null
    this.lastActivity = 0

    // Clear stored config
    await this.ctx.storage.delete('browser:config')
    await this.ctx.storage.delete('browser:lastActivity')

    // Emit 'browser.stopped' event
    await this.emitEvent('browser.stopped', { sessionId })
  }

  /**
   * Alarm handler for session keepAlive and timeout
   *
   * Called periodically to check if the session should be kept alive
   * or closed due to inactivity.
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
        sessionId: this.storedConfig?.sessionId,
        inactiveMs: now - lastActivity,
      })
      await this.stop()
    } else {
      // Session still active - reset alarm
      const nextAlarm = now + 60_000 // Check again in 1 minute
      await this.ctx.storage.setAlarm(nextAlarm)
    }
  }
}

export default Browser
