import type { ThingData } from './Thing'

// ============================================================================
// BROWSER - Browser automation session
// ============================================================================

/**
 * BrowserProvider - Supported browser automation providers
 */
export type BrowserProvider = 'cloudflare' | 'browserbase'

/**
 * BrowserStatus - Current state of the browser session
 */
export type BrowserStatus = 'idle' | 'active' | 'paused' | 'stopped'

/**
 * Browser - Represents a browser automation session
 * Extends ThingData with browser-specific fields
 */
export interface Browser extends ThingData {
  /** Must be 'Browser' */
  $type: 'Browser'

  /** Current status of the browser session */
  status: BrowserStatus

  /** The browser provider being used */
  provider: BrowserProvider

  /** Current URL being viewed (optional) */
  currentUrl?: string

  /** Live view URL for observing the session (optional) */
  liveViewUrl?: string

  /** Provider's session ID (optional) */
  sessionId?: string

  /** Viewport dimensions (optional) */
  viewport?: {
    width: number
    height: number
  }
}

/**
 * BrowserConfig - Configuration for creating a browser session
 */
export interface BrowserConfig {
  /** Browser provider to use */
  provider?: BrowserProvider

  /** Enable live view for observing the session */
  liveView?: boolean

  /** Enable stealth mode to avoid detection */
  stealth?: boolean

  /** Viewport dimensions */
  viewport?: {
    width: number
    height: number
  }

  /** Custom user agent */
  userAgent?: string

  /** Proxy configuration */
  proxy?: {
    url: string
    username?: string
    password?: string
  }
}

// ============================================================================
// Validation Types
// ============================================================================

export interface ValidationError {
  field: string
  message: string
}

export interface ValidationResult {
  success: boolean
  errors: ValidationError[]
}

// ============================================================================
// Validation Functions
// ============================================================================

const VALID_PROVIDERS: BrowserProvider[] = ['cloudflare', 'browserbase']

/**
 * Validates a BrowserConfig object
 */
export function validateBrowserConfig(config: BrowserConfig): ValidationResult {
  const errors: ValidationError[] = []

  // Validate provider
  if (config.provider !== undefined && !VALID_PROVIDERS.includes(config.provider)) {
    errors.push({
      field: 'provider',
      message: `provider must be one of: ${VALID_PROVIDERS.join(', ')}`,
    })
  }

  // Validate viewport dimensions
  if (config.viewport !== undefined) {
    if (config.viewport.width <= 0 || config.viewport.height <= 0) {
      errors.push({
        field: 'viewport',
        message: 'viewport width and height must be positive numbers',
      })
    }
  }

  return {
    success: errors.length === 0,
    errors,
  }
}
