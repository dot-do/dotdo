/**
 * Browse Library - Provider Abstraction for Browser Automation
 *
 * Abstracts Stagehand usage across Cloudflare Browser Rendering and Browserbase.
 * Provides a unified interface for AI-powered browser automation.
 *
 * @example
 * ```typescript
 * // Cloudflare Browser Rendering
 * const session = await Browse.init({
 *   provider: 'cloudflare',
 *   env: { BROWSER: env.BROWSER },
 * })
 *
 * // Browserbase with live view
 * const session = await Browse.init({
 *   provider: 'browserbase',
 *   env: {
 *     BROWSERBASE_API_KEY: env.BROWSERBASE_API_KEY,
 *     BROWSERBASE_PROJECT_ID: env.BROWSERBASE_PROJECT_ID,
 *   },
 *   liveView: true,
 * })
 *
 * await session.goto('https://example.com.ai')
 * await session.act('Click the login button')
 * const data = await session.extract('Get the user profile')
 * await session.close()
 * ```
 */

import type { BrowserProvider } from '../../types/Browser'

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for initializing a Browse session
 */
export interface BrowseInitConfig {
  /** Browser provider to use (defaults to 'cloudflare') */
  provider?: BrowserProvider
  /** Environment bindings/credentials */
  env?: {
    /** Cloudflare Browser binding */
    BROWSER?: unknown
    /** Browserbase API key */
    BROWSERBASE_API_KEY?: string
    /** Browserbase project ID */
    BROWSERBASE_PROJECT_ID?: string
  }
  /** Enable live view for observing the session (Browserbase only) */
  liveView?: boolean
  /** Viewport dimensions */
  viewport?: { width: number; height: number }
  /** Enable stealth mode to avoid detection */
  stealth?: boolean
}

/**
 * Result from an act() operation
 */
export interface ActResult {
  /** Whether the action was successful */
  success: boolean
  /** Description of the action taken */
  action?: string
  /** Error message if action failed */
  error?: string
}

/**
 * Single observable action on the page
 */
export interface ObserveAction {
  /** Type of action (click, type, etc.) */
  action: string
  /** CSS selector for the element */
  selector?: string
  /** Human-readable description */
  description: string
}

/**
 * Result from an observe() operation
 */
export type ObserveResult = ObserveAction[]

/**
 * Options for screenshot capture
 */
export interface ScreenshotOptions {
  /** Capture full scrollable page */
  fullPage?: boolean
  /** CSS selector for specific element */
  selector?: string
  /** Image type */
  type?: 'png' | 'jpeg'
  /** JPEG quality (0-100) */
  quality?: number
}

/**
 * Browser session interface
 */
export interface BrowseSession {
  /** Navigate to a URL */
  goto(url: string): Promise<void>
  /** Execute an action via Stagehand */
  act(instruction: string): Promise<ActResult>
  /** Extract data from the page */
  extract<T = unknown>(instruction: string, schema?: unknown): Promise<T>
  /** Observe available actions on the page */
  observe(instruction?: string): Promise<ObserveResult>
  /** Take a screenshot */
  screenshot(options?: ScreenshotOptions): Promise<string>
  /** Close the session */
  close(): Promise<void>
  /** Live view URL (Browserbase only) */
  liveViewUrl?: string
}

/**
 * Provider interface for implementing browser backends
 */
export interface BrowseProvider {
  init(config: BrowseInitConfig): Promise<BrowseSession>
}

// ============================================================================
// Provider Implementations
// ============================================================================

import { CloudflareBrowseProvider } from './cloudflare'
import { BrowserbaseBrowseProvider } from './browserbase'

// ============================================================================
// Browse Factory
// ============================================================================

/**
 * Browse - Factory for creating browser automation sessions
 *
 * Abstracts browser automation across Cloudflare and Browserbase providers,
 * wrapping Stagehand for AI-powered interactions.
 */
export const Browse = {
  /**
   * Initialize a browser session with the specified provider
   */
  async init(config: BrowseInitConfig): Promise<BrowseSession> {
    const provider = config.provider ?? 'cloudflare'

    // Validate provider
    if (provider !== 'cloudflare' && provider !== 'browserbase') {
      throw new Error(`Invalid provider: ${provider}. Must be 'cloudflare' or 'browserbase'.`)
    }

    // Select and initialize provider
    const providerImpl: BrowseProvider =
      provider === 'cloudflare'
        ? new CloudflareBrowseProvider()
        : new BrowserbaseBrowseProvider()

    return providerImpl.init(config)
  },
}
