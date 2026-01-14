/**
 * @dotdo/sentry - Breadcrumbs Module
 *
 * Breadcrumb management with factory functions and filtering.
 *
 * @module @dotdo/sentry/breadcrumbs
 */

import type { Breadcrumb, BreadcrumbType, SeverityLevel, BreadcrumbHint } from './types.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for BreadcrumbManager.
 */
export interface BreadcrumbManagerConfig {
  /** Maximum number of breadcrumbs to store */
  maxBreadcrumbs?: number
  /** Hook to process breadcrumbs before adding */
  beforeBreadcrumb?: (breadcrumb: Breadcrumb, hint?: BreadcrumbHint) => Breadcrumb | null
  /** Only allow these categories (whitelist) */
  enabledCategories?: string[]
  /** Block these categories (blacklist) */
  disabledCategories?: string[]
}

/**
 * Options for creating HTTP breadcrumbs.
 */
export interface HttpBreadcrumbOptions {
  /** HTTP method (GET, POST, etc.) */
  method: string
  /** Request URL */
  url: string
  /** Response status code */
  statusCode?: number
  /** Request duration in milliseconds */
  duration?: number
  /** Request body size in bytes */
  requestBodySize?: number
  /** Response body size in bytes */
  responseBodySize?: number
  /** Request reason (if failed) */
  reason?: string
}

/**
 * Options for creating navigation breadcrumbs.
 */
export interface NavigationBreadcrumbOptions {
  /** Previous URL/route */
  from: string
  /** New URL/route */
  to: string
  /** Navigation type (push, replace, pop) */
  navigationType?: 'push' | 'replace' | 'pop' | 'initial'
}

/**
 * Options for creating click breadcrumbs.
 */
export interface ClickBreadcrumbOptions {
  /** CSS selector or element identifier */
  target: string
  /** Element text content */
  text?: string
  /** Element attributes */
  attributes?: Record<string, string>
}

/**
 * Options for creating query breadcrumbs.
 */
export interface QueryBreadcrumbOptions {
  /** Database system (postgresql, mysql, etc.) */
  system: string
  /** Query string */
  query: string
  /** Query duration in milliseconds */
  duration?: number
  /** Number of rows returned/affected */
  rowCount?: number
  /** Threshold for slow query warning (ms) */
  slowThreshold?: number
}

// =============================================================================
// Breadcrumb Manager
// =============================================================================

/**
 * Manages breadcrumb collection with filtering and limits.
 */
export class BreadcrumbManager {
  private breadcrumbs: Breadcrumb[] = []
  private readonly config: Required<Pick<BreadcrumbManagerConfig, 'maxBreadcrumbs'>> & BreadcrumbManagerConfig

  constructor(config: BreadcrumbManagerConfig = {}) {
    this.config = {
      maxBreadcrumbs: config.maxBreadcrumbs ?? 100,
      beforeBreadcrumb: config.beforeBreadcrumb,
      enabledCategories: config.enabledCategories,
      disabledCategories: config.disabledCategories,
    }
  }

  /**
   * Add a breadcrumb.
   */
  add(breadcrumb: Breadcrumb, hint?: BreadcrumbHint): void {
    // Check category filters
    if (breadcrumb.category) {
      if (this.config.enabledCategories && !this.config.enabledCategories.includes(breadcrumb.category)) {
        return
      }
      if (this.config.disabledCategories && this.config.disabledCategories.includes(breadcrumb.category)) {
        return
      }
    }

    // Apply beforeBreadcrumb hook
    let processed: Breadcrumb | null = breadcrumb
    if (this.config.beforeBreadcrumb) {
      processed = this.config.beforeBreadcrumb(breadcrumb, hint)
    }

    if (processed === null) {
      return
    }

    // Add timestamp if not present
    const enriched: Breadcrumb = {
      ...processed,
      timestamp: processed.timestamp ?? Date.now() / 1000,
    }

    this.breadcrumbs.push(enriched)

    // Trim to max
    if (this.breadcrumbs.length > this.config.maxBreadcrumbs) {
      this.breadcrumbs = this.breadcrumbs.slice(-this.config.maxBreadcrumbs)
    }
  }

  /**
   * Get all breadcrumbs.
   */
  getAll(): Breadcrumb[] {
    return [...this.breadcrumbs]
  }

  /**
   * Get breadcrumbs by category.
   */
  getByCategory(category: string): Breadcrumb[] {
    return this.breadcrumbs.filter((b) => b.category === category)
  }

  /**
   * Get breadcrumbs by level.
   */
  getByLevel(level: SeverityLevel): Breadcrumb[] {
    return this.breadcrumbs.filter((b) => b.level === level)
  }

  /**
   * Get breadcrumbs since a timestamp.
   */
  getSince(timestamp: number): Breadcrumb[] {
    return this.breadcrumbs.filter((b) => (b.timestamp ?? 0) >= timestamp)
  }

  /**
   * Get the last N breadcrumbs.
   */
  getLast(count: number): Breadcrumb[] {
    return this.breadcrumbs.slice(-count)
  }

  /**
   * Clear all breadcrumbs.
   */
  clear(): void {
    this.breadcrumbs = []
  }

  /**
   * Get the number of breadcrumbs.
   */
  get length(): number {
    return this.breadcrumbs.length
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an HTTP request/response breadcrumb.
 */
export function createHttpBreadcrumb(options: HttpBreadcrumbOptions): Breadcrumb {
  let level: SeverityLevel = 'info'

  if (options.statusCode !== undefined) {
    if (options.statusCode >= 500) {
      level = 'error'
    } else if (options.statusCode >= 400) {
      level = 'warning'
    }
  }

  const data: Record<string, unknown> = {
    method: options.method,
    url: options.url,
  }

  if (options.statusCode !== undefined) {
    data.status_code = options.statusCode
  }
  if (options.duration !== undefined) {
    data.duration_ms = options.duration
  }
  if (options.requestBodySize !== undefined) {
    data.request_body_size = options.requestBodySize
  }
  if (options.responseBodySize !== undefined) {
    data.response_body_size = options.responseBodySize
  }
  if (options.reason !== undefined) {
    data.reason = options.reason
  }

  return {
    type: 'http',
    category: 'http',
    level,
    message: `${options.method} ${options.url}`,
    data,
    timestamp: Date.now() / 1000,
  }
}

/**
 * Create a navigation breadcrumb.
 */
export function createNavigationBreadcrumb(options: NavigationBreadcrumbOptions): Breadcrumb {
  const data: Record<string, unknown> = {
    from: options.from,
    to: options.to,
  }

  if (options.navigationType) {
    data.navigation_type = options.navigationType
  }

  return {
    type: 'navigation',
    category: 'navigation',
    level: 'info',
    message: `Navigating from ${options.from} to ${options.to}`,
    data,
    timestamp: Date.now() / 1000,
  }
}

/**
 * Create a console breadcrumb.
 */
export function createConsoleBreadcrumb(
  logLevel: 'log' | 'info' | 'warn' | 'error' | 'debug',
  message: string,
  args?: unknown[]
): Breadcrumb {
  let level: SeverityLevel

  switch (logLevel) {
    case 'error':
      level = 'error'
      break
    case 'warn':
      level = 'warning'
      break
    case 'info':
      level = 'info'
      break
    case 'debug':
      level = 'debug'
      break
    default:
      level = 'log'
  }

  const breadcrumb: Breadcrumb = {
    type: 'debug',
    category: 'console',
    level,
    message,
    timestamp: Date.now() / 1000,
  }

  if (args && args.length > 0) {
    breadcrumb.data = { arguments: args }
  }

  return breadcrumb
}

/**
 * Create a UI click breadcrumb.
 */
export function createClickBreadcrumb(options: ClickBreadcrumbOptions): Breadcrumb {
  const data: Record<string, unknown> = {
    target: options.target,
  }

  if (options.attributes) {
    Object.assign(data, options.attributes)
  }

  return {
    type: 'ui',
    category: 'ui.click',
    level: 'info',
    message: options.text || options.target,
    data,
    timestamp: Date.now() / 1000,
  }
}

/**
 * Create an error breadcrumb.
 */
export function createErrorBreadcrumb(
  error: Error,
  customMessage?: string
): Breadcrumb {
  const data: Record<string, unknown> = {
    name: error.name,
  }

  if (customMessage) {
    data.original_message = error.message
  }

  if (error.stack) {
    data.stack = error.stack
  }

  return {
    type: 'error',
    category: 'error',
    level: 'error',
    message: customMessage || error.message,
    data,
    timestamp: Date.now() / 1000,
  }
}

/**
 * Create a database query breadcrumb.
 */
export function createQueryBreadcrumb(options: QueryBreadcrumbOptions): Breadcrumb {
  let level: SeverityLevel = 'info'

  if (options.slowThreshold && options.duration && options.duration > options.slowThreshold) {
    level = 'warning'
  }

  const data: Record<string, unknown> = {
    'db.system': options.system,
  }

  if (options.duration !== undefined) {
    data.duration_ms = options.duration
  }
  if (options.rowCount !== undefined) {
    data.row_count = options.rowCount
  }

  return {
    type: 'query',
    category: 'query',
    level,
    message: options.query,
    data,
    timestamp: Date.now() / 1000,
  }
}

/**
 * Create a custom breadcrumb.
 */
export function createBreadcrumb(
  category: string,
  message: string,
  options: {
    type?: BreadcrumbType
    level?: SeverityLevel
    data?: Record<string, unknown>
  } = {}
): Breadcrumb {
  return {
    type: options.type ?? 'default',
    category,
    level: options.level ?? 'info',
    message,
    data: options.data,
    timestamp: Date.now() / 1000,
  }
}
