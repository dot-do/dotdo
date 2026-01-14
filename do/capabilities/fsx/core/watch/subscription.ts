/**
 * SubscriptionManager - WebSocket subscription management for file watching
 *
 * This module provides subscription management for WebSocket connections
 * that want to receive file system change notifications. It tracks which
 * paths each connection is subscribed to and provides utilities for
 * managing subscriptions.
 *
 * Key features:
 * - Track subscriptions per WebSocket connection
 * - Add/remove paths from subscription sets
 * - Wildcard pattern matching (* and **)
 * - Subscription groups for bulk management
 * - Configurable subscription limits per connection
 * - Query subscribers for a given path
 * - Handle JSON messages for subscribe/unsubscribe
 * - Clean up all subscriptions when connection closes
 *
 * @example
 * ```typescript
 * const manager = new SubscriptionManager()
 *
 * // Handle WebSocket connection
 * ws.addEventListener('message', (event) => {
 *   const result = manager.handleMessage(ws, event.data)
 *   ws.send(JSON.stringify(result))
 * })
 *
 * // When connection closes
 * ws.addEventListener('close', () => {
 *   manager.removeConnection(ws)
 * })
 *
 * // Notify subscribers of a change
 * const subscribers = manager.getSubscribersForPath('/changed/path')
 * for (const ws of subscribers) {
 *   ws.send(JSON.stringify({ type: 'change', path: '/changed/path' }))
 * }
 * ```
 *
 * @example Wildcard subscriptions
 * ```typescript
 * // Subscribe to all files in a directory
 * manager.subscribe(ws, '/home/*')
 *
 * // Subscribe recursively to all descendants
 * manager.subscribe(ws, '/home/**')
 *
 * // Match specific file patterns
 * manager.subscribe(ws, '/src/**\/*.ts')
 * ```
 *
 * @example Subscription groups
 * ```typescript
 * // Add subscriptions to named groups
 * manager.subscribe(ws, '/home/*', { group: 'user-files' })
 * manager.subscribe(ws, '/var/log/*', { group: 'logs' })
 *
 * // Unsubscribe entire group at once
 * manager.unsubscribeGroup(ws, 'user-files')
 * ```
 */

/**
 * Message format for subscription requests
 */
export interface SubscribeMessage {
  type: 'subscribe'
  path: string
}

/**
 * Message format for unsubscription requests
 */
export interface UnsubscribeMessage {
  type: 'unsubscribe'
  path: string
}

/**
 * Union type for all subscription-related messages
 */
export type SubscriptionMessage = SubscribeMessage | UnsubscribeMessage

/**
 * Result of handling a subscription message
 */
export interface HandleMessageResult {
  success: boolean
  type?: 'subscribe' | 'unsubscribe'
  path?: string
  error?: 'invalid_json' | 'missing_type' | 'unknown_type' | 'missing_path' | 'invalid_path' | 'limit_reached'
}

/**
 * Options for subscribing to a path
 */
export interface SubscribeOptions {
  /**
   * Optional group name to categorize this subscription.
   * Useful for bulk unsubscribe operations.
   */
  group?: string
}

/**
 * Configuration options for SubscriptionManager
 */
export interface SubscriptionManagerOptions {
  /**
   * Maximum number of subscriptions allowed per connection.
   * Set to 0 or undefined for unlimited subscriptions.
   * @default undefined (unlimited)
   */
  maxSubscriptionsPerConnection?: number
}

/**
 * Internal structure for storing subscription metadata
 */
interface SubscriptionEntry {
  /** The normalized path or pattern */
  pattern: string
  /** Optional group this subscription belongs to */
  group?: string
  /** Pre-compiled regex for pattern matching (cached for performance) */
  regex?: RegExp
  /** Whether this is a wildcard pattern */
  isPattern: boolean
}

/**
 * Manages WebSocket subscriptions to file system paths.
 *
 * This class maintains a mapping of WebSocket connections to the paths
 * they are subscribed to, and provides utilities for managing these
 * subscriptions. Supports wildcard patterns (* and **) for flexible
 * path matching.
 *
 * Pattern matching:
 * - `*` matches any single path segment (e.g., `/home/*` matches `/home/user` but not `/home/user/docs`)
 * - `**` matches zero or more path segments (e.g., `/home/**` matches `/home`, `/home/user`, `/home/user/docs`)
 * - Patterns can be combined (e.g., `/src/**\/*.ts` matches all .ts files under /src)
 */
export class SubscriptionManager {
  /**
   * Map of WebSocket connections to their subscription entries.
   * Each connection has a Map of pattern -> SubscriptionEntry.
   */
  private subscriptions: Map<WebSocket, Map<string, SubscriptionEntry>> = new Map()

  /**
   * Maximum subscriptions allowed per connection (0 = unlimited)
   */
  private maxSubscriptionsPerConnection: number

  /**
   * Cache of compiled regex patterns for performance
   */
  private regexCache: Map<string, RegExp> = new Map()

  /**
   * Creates a new SubscriptionManager instance.
   *
   * @param options - Configuration options
   * @example
   * ```typescript
   * // Unlimited subscriptions
   * const manager = new SubscriptionManager()
   *
   * // With subscription limit
   * const limitedManager = new SubscriptionManager({ maxSubscriptionsPerConnection: 100 })
   * ```
   */
  constructor(options: SubscriptionManagerOptions = {}) {
    this.maxSubscriptionsPerConnection = options.maxSubscriptionsPerConnection ?? 0
  }

  /**
   * Subscribe a WebSocket connection to a path or pattern.
   *
   * Supports wildcard patterns:
   * - `*` matches any single path segment
   * - `**` matches zero or more path segments
   *
   * @param ws - The WebSocket connection
   * @param path - The path or pattern to subscribe to
   * @param options - Optional subscription options (group, etc.)
   * @returns true if the subscription was added, false if already subscribed or limit reached
   *
   * @example
   * ```typescript
   * // Exact path subscription
   * manager.subscribe(ws, '/home/user')
   *
   * // Wildcard pattern
   * manager.subscribe(ws, '/home/*')
   *
   * // Recursive pattern
   * manager.subscribe(ws, '/home/**')
   *
   * // With group
   * manager.subscribe(ws, '/var/log/*', { group: 'logs' })
   * ```
   */
  subscribe(ws: WebSocket, path: string, options: SubscribeOptions = {}): boolean {
    const normalizedPath = this.normalizePath(path)
    let entries = this.subscriptions.get(ws)

    if (!entries) {
      entries = new Map()
      this.subscriptions.set(ws, entries)
    }

    // Check if already subscribed
    if (entries.has(normalizedPath)) {
      return false
    }

    // Check subscription limit
    if (this.maxSubscriptionsPerConnection > 0 && entries.size >= this.maxSubscriptionsPerConnection) {
      return false
    }

    const isPattern = this.hasPattern(normalizedPath)
    const entry: SubscriptionEntry = {
      pattern: normalizedPath,
      group: options.group,
      isPattern,
      regex: isPattern ? this.compilePattern(normalizedPath) : undefined,
    }

    entries.set(normalizedPath, entry)
    return true
  }

  /**
   * Unsubscribe a WebSocket connection from a path or pattern.
   *
   * @param ws - The WebSocket connection
   * @param path - The path or pattern to unsubscribe from
   * @returns true if the subscription was removed, false if not subscribed
   *
   * @example
   * ```typescript
   * manager.unsubscribe(ws, '/home/user')
   * manager.unsubscribe(ws, '/home/*')
   * ```
   */
  unsubscribe(ws: WebSocket, path: string): boolean {
    const normalizedPath = this.normalizePath(path)
    const entries = this.subscriptions.get(ws)

    if (!entries) {
      return false
    }

    const result = entries.delete(normalizedPath)

    // Clean up empty subscription maps
    if (entries.size === 0) {
      this.subscriptions.delete(ws)
    }

    return result
  }

  /**
   * Unsubscribe all paths in a named group for a connection.
   *
   * @param ws - The WebSocket connection
   * @param group - The group name to unsubscribe
   * @returns Number of subscriptions removed
   *
   * @example
   * ```typescript
   * // Subscribe to multiple paths in a group
   * manager.subscribe(ws, '/home/*', { group: 'user-files' })
   * manager.subscribe(ws, '/home/shared/*', { group: 'user-files' })
   *
   * // Unsubscribe entire group
   * const removed = manager.unsubscribeGroup(ws, 'user-files')
   * console.log(`Removed ${removed} subscriptions`)
   * ```
   */
  unsubscribeGroup(ws: WebSocket, group: string): number {
    const entries = this.subscriptions.get(ws)
    if (!entries) return 0

    let removed = 0
    for (const [pattern, entry] of entries) {
      if (entry.group === group) {
        entries.delete(pattern)
        removed++
      }
    }

    // Clean up empty subscription maps
    if (entries.size === 0) {
      this.subscriptions.delete(ws)
    }

    return removed
  }

  /**
   * Get all subscriptions for a connection that belong to a specific group.
   *
   * @param ws - The WebSocket connection
   * @param group - The group name to filter by
   * @returns Array of patterns in the group
   *
   * @example
   * ```typescript
   * const logPatterns = manager.getSubscriptionsByGroup(ws, 'logs')
   * // Returns: ['/var/log/*', '/var/log/nginx/**']
   * ```
   */
  getSubscriptionsByGroup(ws: WebSocket, group: string): string[] {
    const entries = this.subscriptions.get(ws)
    if (!entries) return []

    const result: string[] = []
    for (const [pattern, entry] of entries) {
      if (entry.group === group) {
        result.push(pattern)
      }
    }

    return result
  }

  /**
   * Check if a WebSocket connection is subscribed to a path.
   * This checks for exact pattern match, not wildcard matching.
   *
   * @param ws - The WebSocket connection
   * @param path - The path to check
   * @returns true if subscribed, false otherwise
   *
   * @example
   * ```typescript
   * manager.subscribe(ws, '/home/*')
   * manager.isSubscribed(ws, '/home/*')   // true
   * manager.isSubscribed(ws, '/home/user') // false (use pathMatches for wildcard checking)
   * ```
   */
  isSubscribed(ws: WebSocket, path: string): boolean {
    const normalizedPath = this.normalizePath(path)
    const entries = this.subscriptions.get(ws)
    return entries?.has(normalizedPath) ?? false
  }

  /**
   * Get all paths/patterns a WebSocket connection is subscribed to.
   *
   * @param ws - The WebSocket connection
   * @returns Array of subscribed paths/patterns
   *
   * @example
   * ```typescript
   * const subs = manager.getSubscriptions(ws)
   * // Returns: ['/home/*', '/var/log/**', '/etc/config']
   * ```
   */
  getSubscriptions(ws: WebSocket): string[] {
    const entries = this.subscriptions.get(ws)
    return entries ? Array.from(entries.keys()) : []
  }

  /**
   * Get the number of subscriptions for a WebSocket connection.
   *
   * @param ws - The WebSocket connection
   * @returns Number of subscribed paths/patterns
   */
  getSubscriptionCount(ws: WebSocket): number {
    const entries = this.subscriptions.get(ws)
    return entries?.size ?? 0
  }

  /**
   * Get all WebSocket connections whose subscriptions match a given path.
   * This performs wildcard pattern matching.
   *
   * @param path - The concrete path to check (not a pattern)
   * @returns Array of WebSocket connections that should be notified
   *
   * @example
   * ```typescript
   * // Connection 1 subscribed to '/home/**'
   * // Connection 2 subscribed to '/home/user/*'
   * // Connection 3 subscribed to '/var/**'
   *
   * const subscribers = manager.getSubscribersForPath('/home/user/docs')
   * // Returns: [ws1, ws2] (ws3 doesn't match)
   * ```
   */
  getSubscribersForPath(path: string): WebSocket[] {
    const normalizedPath = this.normalizePath(path)
    const subscribers: WebSocket[] = []

    for (const [ws, entries] of this.subscriptions) {
      for (const entry of entries.values()) {
        if (this.matchPattern(entry, normalizedPath)) {
          subscribers.push(ws)
          break // Only add each connection once
        }
      }
    }

    return subscribers
  }

  /**
   * Get all patterns from a connection that match a given path.
   *
   * @param ws - The WebSocket connection
   * @param path - The concrete path to check
   * @returns Array of patterns that match the path
   *
   * @example
   * ```typescript
   * manager.subscribe(ws, '/home/**')
   * manager.subscribe(ws, '/home/user/*')
   * manager.subscribe(ws, '/home/user/docs')
   *
   * const patterns = manager.getMatchingPatterns(ws, '/home/user/docs')
   * // Returns: ['/home/**', '/home/user/*', '/home/user/docs']
   * ```
   */
  getMatchingPatterns(ws: WebSocket, path: string): string[] {
    const normalizedPath = this.normalizePath(path)
    const entries = this.subscriptions.get(ws)
    if (!entries) return []

    const matching: string[] = []
    for (const entry of entries.values()) {
      if (this.matchPattern(entry, normalizedPath)) {
        matching.push(entry.pattern)
      }
    }

    return matching
  }

  /**
   * Remove all subscriptions for a WebSocket connection.
   * Call this when a connection closes.
   *
   * @param ws - The WebSocket connection to remove
   *
   * @example
   * ```typescript
   * ws.addEventListener('close', () => {
   *   manager.removeConnection(ws)
   * })
   * ```
   */
  removeConnection(ws: WebSocket): void {
    this.subscriptions.delete(ws)
  }

  /**
   * Get the total number of active connections.
   *
   * @returns Number of connections with subscriptions
   */
  getConnectionCount(): number {
    return this.subscriptions.size
  }

  /**
   * Handle an incoming message from a WebSocket connection.
   * Parses the message and performs the appropriate action.
   *
   * @param ws - The WebSocket connection
   * @param message - The raw message string
   * @returns Result of handling the message
   *
   * @example
   * ```typescript
   * ws.addEventListener('message', (event) => {
   *   const result = manager.handleMessage(ws, event.data)
   *   ws.send(JSON.stringify(result))
   * })
   * ```
   */
  handleMessage(ws: WebSocket, message: string): HandleMessageResult {
    // Parse JSON
    let parsed: unknown
    try {
      parsed = JSON.parse(message)
    } catch {
      return { success: false, error: 'invalid_json' }
    }

    // Validate message structure
    if (typeof parsed !== 'object' || parsed === null) {
      return { success: false, error: 'invalid_json' }
    }

    const msg = parsed as Record<string, unknown>

    // Check for type field
    if (!('type' in msg)) {
      return { success: false, error: 'missing_type' }
    }

    const type = msg.type

    // Validate type
    if (type !== 'subscribe' && type !== 'unsubscribe') {
      return { success: false, error: 'unknown_type' }
    }

    // Check for path field
    if (!('path' in msg)) {
      return { success: false, error: 'missing_path' }
    }

    const path = msg.path

    // Validate path type
    if (typeof path !== 'string') {
      return { success: false, error: 'invalid_path' }
    }

    // Perform action
    if (type === 'subscribe') {
      const added = this.subscribe(ws, path)
      if (!added && this.isSubscribed(ws, path)) {
        // Already subscribed - still success
        return { success: true, type: 'subscribe', path }
      }
      if (!added) {
        // Limit reached
        return { success: false, error: 'limit_reached' }
      }
      return { success: true, type: 'subscribe', path }
    } else {
      this.unsubscribe(ws, path)
      return { success: true, type: 'unsubscribe', path }
    }
  }

  /**
   * Check if a path or pattern contains wildcard characters.
   *
   * @param path - The path or pattern to check
   * @returns true if the path contains * or **, false otherwise
   *
   * @example
   * ```typescript
   * manager.hasPattern('/home/*')    // true
   * manager.hasPattern('/home/**')   // true
   * manager.hasPattern('/home/user') // false
   * ```
   */
  hasPattern(path: string): boolean {
    return path.includes('*')
  }

  /**
   * Normalize a path by removing trailing slashes (except for root).
   *
   * @param path - The path to normalize
   * @returns Normalized path
   *
   * @example
   * ```typescript
   * normalizePath('/home/user/')  // '/home/user'
   * normalizePath('/')            // '/'
   * normalizePath('')             // '/'
   * ```
   */
  private normalizePath(path: string): string {
    if (path === '/' || path === '') return '/'
    return path.endsWith('/') ? path.slice(0, -1) : path
  }

  /**
   * Compile a glob pattern into a regular expression.
   * Uses caching for performance with repeated patterns.
   *
   * Pattern syntax:
   * - '*' matches any characters except '/' (single path segment)
   * - '**' matches zero or more path segments (can match nothing)
   *
   * Special cases:
   * - '/home/**' matches '/home', '/home/user', '/home/user/docs'
   * - '/home/**\/file' matches '/home/file', '/home/a/file', '/home/a/b/file'
   * - '/src/**\/*.ts' matches '/src/index.ts', '/src/lib/utils.ts'
   *
   * @param pattern - The glob pattern to compile
   * @returns Compiled regular expression
   */
  private compilePattern(pattern: string): RegExp {
    // Check cache first
    const cached = this.regexCache.get(pattern)
    if (cached) return cached

    // Escape special regex characters except * and /
    let regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')

    // Handle **/ at the start or after / (matches zero or more path segments with trailing /)
    // Pattern: /home/**/file -> matches /home/file, /home/a/file, /home/a/b/file
    regexStr = regexStr.replace(/\*\*\//g, '<<<GLOBSTAR_SLASH>>>')

    // Handle /** at the end (matches everything from this point)
    // Pattern: /home/** -> matches /home, /home/user, /home/user/docs
    regexStr = regexStr.replace(/\/\*\*$/g, '<<<SLASH_GLOBSTAR_END>>>')

    // Handle remaining ** (matches any path segments)
    regexStr = regexStr.replace(/\*\*/g, '<<<GLOBSTAR>>>')

    // Handle single * (single segment match - anything except /)
    regexStr = regexStr.replace(/\*/g, '[^/]*')

    // Replace globstar placeholders with appropriate regex
    // **/ can match empty string or path segments ending with /
    regexStr = regexStr.replace(/<<<GLOBSTAR_SLASH>>>/g, '(?:.*/)?')

    // /** matches the directory itself or anything under it
    regexStr = regexStr.replace(/<<<SLASH_GLOBSTAR_END>>>/g, '(?:/.*)?')

    // Standalone ** matches any path segments
    regexStr = regexStr.replace(/<<<GLOBSTAR>>>/g, '.*')

    // Anchor the pattern
    const regex = new RegExp(`^${regexStr}$`)

    // Cache the compiled regex
    this.regexCache.set(pattern, regex)

    return regex
  }

  /**
   * Check if a subscription entry matches a given path.
   *
   * @param entry - The subscription entry with pattern info
   * @param path - The concrete path to match against
   * @returns true if the pattern matches the path
   */
  private matchPattern(entry: SubscriptionEntry, path: string): boolean {
    if (!entry.isPattern) {
      // Exact match
      return entry.pattern === path
    }

    // Use the compiled regex
    if (entry.regex) {
      return entry.regex.test(path)
    }

    // Fallback: compile on the fly (shouldn't happen with proper setup)
    const regex = this.compilePattern(entry.pattern)
    return regex.test(path)
  }
}
