/**
 * Browse Types - Shared type definitions for browser automation
 *
 * This module exists to break circular dependencies between:
 * - lib/browse/index.ts
 * - lib/browse/browserbase.ts
 * - lib/browse/cloudflare.ts
 *
 * By extracting shared types here, all modules can import from this
 * shared file without creating import cycles.
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
