/**
 * WatchManager - File watching with per-path debounce support
 *
 * This module provides a WatchManager class that handles file system event
 * notifications with intelligent debouncing. It coalesces rapid changes to
 * the same path into single events, reducing noise from frequent file operations.
 *
 * Key features:
 * - Per-path debounce tracking
 * - Configurable debounce delay
 * - Smart event coalescing (create + modify = create, modify + delete = delete)
 * - Timer cleanup on watcher removal
 */

/** Event types emitted by file watchers */
export type WatchEventType = 'change' | 'rename'

/** Callback signature for watch event listeners */
export type WatchListener = (eventType: WatchEventType, filename: string) => void

/** Debounce mode - when events are emitted relative to the debounce window */
export type DebounceMode = 'leading' | 'trailing' | 'both'

/**
 * Internal representation of a registered watcher.
 */
export interface WatchEntry {
  /** Unique identifier for the watcher */
  id: number
  /** Path being watched (normalized) */
  path: string
  /** Whether to watch subdirectories recursively */
  recursive: boolean
  /** Callback to invoke on file system events */
  listener: WatchListener
  /** Whether the watcher has been closed */
  closed: boolean
  /** AbortController for cancellation support */
  abortController: AbortController
}

/**
 * Pending event information for debouncing
 */
interface PendingEvent {
  /** The event type to emit */
  eventType: WatchEventType
  /** The original/first event type (for smart coalescing) */
  originalEventType: WatchEventType
  /** The affected path */
  path: string
  /** The timer handle for debounce */
  timer: ReturnType<typeof setTimeout>
  /** The timer handle for max wait (optional) */
  maxWaitTimer?: ReturnType<typeof setTimeout>
  /** Timestamp of first event in this batch */
  firstEventTime: number
  /** Whether leading edge event has been emitted */
  leadingEmitted: boolean
}

/**
 * Manages file watchers for a single FSx instance with debouncing support.
 *
 * Optimized for handling many concurrent watchers by using:
 * - Path prefix indexing for O(log n) lookup of potentially matching watchers
 * - Per-path debouncing to coalesce rapid events
 * - Proper cancellation support via AbortController
 *
 * Since FSx runs in a Durable Object environment without native fs.watch,
 * this class implements watching by hooking into FSx operations directly.
 * When a file operation occurs, the WatchManager debounces and then emits
 * events to all registered watchers that match the affected path.
 *
 * @example
 * ```typescript
 * const manager = new WatchManager()
 * const entry = manager.addWatcher('/home/user', true, (event, filename) => {
 *   console.log(`${event}: ${filename}`)
 * })
 *
 * // Emit events (will be debounced)
 * manager.emit('change', '/home/user/file.txt')
 * manager.emit('change', '/home/user/file.txt')
 *
 * // Later, remove the watcher
 * manager.removeWatcher(entry)
 * ```
 */
export class WatchManager {
  /** Counter for generating unique watcher IDs */
  private nextId: number = 0

  /** All registered watchers indexed by ID for fast removal */
  private watchersById: Map<number, WatchEntry> = new Map()

  /**
   * Index of watchers by their normalized path.
   * Multiple watchers can watch the same path.
   */
  private watchersByPath: Map<string, Set<WatchEntry>> = new Map()

  /**
   * Pending events waiting to be emitted after debounce delay.
   * Key is the affected path.
   */
  private pendingEvents: Map<string, PendingEvent> = new Map()

  /**
   * Debounce delay in milliseconds.
   * Default is 50ms which balances responsiveness with coalescing.
   */
  private debounceDelay: number = 50

  /**
   * Per-path debounce delay overrides.
   * Key is the path pattern (can be glob), value is delay in ms.
   */
  private pathDebounceDelays: Map<string, number> = new Map()

  /**
   * Debounce mode - leading, trailing, or both.
   * Default is 'trailing' (emit after debounce period ends).
   */
  private debounceMode: DebounceMode = 'trailing'

  /**
   * Max wait time in milliseconds.
   * If set, forces event emission even if debounce keeps resetting.
   */
  private maxWait: number | undefined = undefined

  /**
   * Per-path max wait time overrides.
   */
  private pathMaxWaits: Map<string, number> = new Map()

  /**
   * Whether smart coalescing is enabled.
   * Default is true (create + modify = create, modify + delete = delete).
   */
  private smartCoalescing: boolean = true

  /**
   * Register a new file system watcher.
   *
   * @param path - The path to watch (file or directory)
   * @param recursive - Whether to watch subdirectories recursively
   * @param listener - Callback function to invoke on events
   * @returns The watch entry for later removal
   */
  addWatcher(path: string, recursive: boolean, listener: WatchListener): WatchEntry {
    const normalizedPath = this.normalizePath(path)
    const entry: WatchEntry = {
      id: this.nextId++,
      path: normalizedPath,
      recursive,
      listener,
      closed: false,
      abortController: new AbortController(),
    }

    // Add to ID index
    this.watchersById.set(entry.id, entry)

    // Add to path index
    let pathWatchers = this.watchersByPath.get(normalizedPath)
    if (!pathWatchers) {
      pathWatchers = new Set()
      this.watchersByPath.set(normalizedPath, pathWatchers)
    }
    pathWatchers.add(entry)

    return entry
  }

  /**
   * Remove a watcher and clean up its resources.
   *
   * @param entry - The watch entry to remove
   */
  removeWatcher(entry: WatchEntry): void {
    entry.closed = true
    entry.abortController.abort()

    // Remove from ID index
    this.watchersById.delete(entry.id)

    // Remove from path index
    const pathWatchers = this.watchersByPath.get(entry.path)
    if (pathWatchers) {
      pathWatchers.delete(entry)
      if (pathWatchers.size === 0) {
        this.watchersByPath.delete(entry.path)
      }
    }

    // Clear any pending events that would have been delivered to this watcher
    // We need to check if there are any other watchers for paths this watcher covered
    this.cleanupPendingEventsForClosedWatcher(entry)
  }

  /**
   * Clean up pending events when a watcher is removed.
   * If no watchers remain for a pending event's path, clear both timers.
   */
  private cleanupPendingEventsForClosedWatcher(closedEntry: WatchEntry): void {
    for (const [pendingPath, pending] of this.pendingEvents) {
      // Check if this pending event would have matched the closed watcher
      if (this.wouldMatch(closedEntry, pendingPath)) {
        // Check if there are any remaining watchers that would receive this event
        const hasRemainingWatchers = this.findMatchingWatchers(pending.eventType, pendingPath).length > 0
        if (!hasRemainingWatchers) {
          clearTimeout(pending.timer)
          // Also clear maxWait timer to prevent timer leak
          if (pending.maxWaitTimer) {
            clearTimeout(pending.maxWaitTimer)
          }
          this.pendingEvents.delete(pendingPath)
        }
      }
    }
  }

  /**
   * Check if a watcher would match a given path.
   */
  private wouldMatch(watcher: WatchEntry, affectedPath: string): boolean {
    const normalizedAffected = this.normalizePath(affectedPath)
    const watcherPath = watcher.path

    // Exact match
    if (watcherPath === normalizedAffected) return true

    // Parent directory match
    const parentPath = this.getParentPath(normalizedAffected)
    if (watcherPath === parentPath) return true

    // Recursive ancestor match
    if (watcher.recursive) {
      let currentPath = parentPath
      while (currentPath !== '/') {
        if (watcherPath === currentPath) return true
        currentPath = this.getParentPath(currentPath)
      }
      // Check root
      if (watcherPath === '/') return true
    }

    return false
  }

  /**
   * Get the AbortSignal for a watcher, useful for cancellation.
   *
   * @param entry - The watch entry
   * @returns The AbortSignal that will be triggered when the watcher is closed
   */
  getAbortSignal(entry: WatchEntry): AbortSignal {
    return entry.abortController.signal
  }

  /**
   * Get the total number of active watchers.
   *
   * @returns Number of registered watchers
   */
  get watcherCount(): number {
    return this.watchersById.size
  }

  /**
   * Set the debounce delay for coalescing rapid events.
   *
   * @param ms - Delay in milliseconds (0 for immediate emission)
   */
  setDebounceDelay(ms: number): void {
    this.debounceDelay = ms
  }

  /**
   * Get the current debounce delay.
   *
   * @returns Delay in milliseconds
   */
  getDebounceDelay(): number {
    return this.debounceDelay
  }

  /**
   * Set a debounce delay for a specific path pattern.
   * The pattern can be a literal path or a glob pattern (e.g., '*.log').
   *
   * @param pathPattern - Path or glob pattern to configure
   * @param ms - Delay in milliseconds
   */
  setPathDebounceDelay(pathPattern: string, ms: number): void {
    this.pathDebounceDelays.set(pathPattern, ms)
  }

  /**
   * Get the debounce delay for a specific path.
   * Checks path-specific configurations first, falls back to global.
   *
   * @param path - The path to check
   * @returns Delay in milliseconds
   */
  getPathDebounceDelay(path: string): number {
    const normalizedPath = this.normalizePath(path)

    // Check for exact path match first
    const exactMatch = this.pathDebounceDelays.get(normalizedPath)
    if (exactMatch !== undefined) {
      return exactMatch
    }

    // Check for prefix matches (path under configured directory)
    for (const [configuredPath, delay] of this.pathDebounceDelays) {
      // Skip glob patterns - they're handled separately
      if (configuredPath.includes('*')) continue

      const normalizedConfigured = this.normalizePath(configuredPath)
      // Check if path is under the configured directory
      if (normalizedPath === normalizedConfigured || normalizedPath.startsWith(normalizedConfigured + '/')) {
        return delay
      }
    }

    // Check for glob pattern matches
    for (const [pattern, delay] of this.pathDebounceDelays) {
      if (this.matchesGlobPattern(normalizedPath, pattern)) {
        return delay
      }
    }

    // Fall back to global delay
    return this.debounceDelay
  }

  /**
   * Clear a path-specific debounce delay configuration.
   *
   * @param pathPattern - The path pattern to clear
   */
  clearPathDebounceDelay(pathPattern: string): void {
    this.pathDebounceDelays.delete(pathPattern)
  }

  /**
   * Set the debounce mode (leading, trailing, or both).
   *
   * @param mode - The debounce mode to use
   */
  setDebounceMode(mode: DebounceMode): void {
    this.debounceMode = mode
  }

  /**
   * Get the current debounce mode.
   *
   * @returns The current debounce mode
   */
  getDebounceMode(): DebounceMode {
    return this.debounceMode
  }

  /**
   * Set the maximum wait time before forcing event emission.
   * Even if debounce keeps resetting, events will be emitted after this time.
   *
   * @param ms - Max wait in milliseconds, or undefined to disable
   */
  setMaxWait(ms: number | undefined): void {
    this.maxWait = ms
  }

  /**
   * Get the current max wait time.
   *
   * @returns Max wait in milliseconds, or undefined if disabled
   */
  getMaxWait(): number | undefined {
    return this.maxWait
  }

  /**
   * Set a max wait time for a specific path.
   *
   * @param pathPattern - Path or pattern to configure
   * @param ms - Max wait in milliseconds
   */
  setPathMaxWait(pathPattern: string, ms: number): void {
    this.pathMaxWaits.set(pathPattern, ms)
  }

  /**
   * Get the max wait time for a specific path.
   *
   * @param path - The path to check
   * @returns Max wait in milliseconds, or undefined if not set
   */
  getPathMaxWait(path: string): number | undefined {
    const normalizedPath = this.normalizePath(path)

    // Check for exact path match first
    const exactMatch = this.pathMaxWaits.get(normalizedPath)
    if (exactMatch !== undefined) {
      return exactMatch
    }

    // Check for prefix matches (path under configured directory)
    for (const [configuredPath, maxWait] of this.pathMaxWaits) {
      // Skip glob patterns - they're handled separately
      if (configuredPath.includes('*')) continue

      const normalizedConfigured = this.normalizePath(configuredPath)
      // Check if path is under the configured directory
      if (normalizedPath === normalizedConfigured || normalizedPath.startsWith(normalizedConfigured + '/')) {
        return maxWait
      }
    }

    // Check for glob pattern matches
    for (const [pattern, maxWait] of this.pathMaxWaits) {
      if (this.matchesGlobPattern(normalizedPath, pattern)) {
        return maxWait
      }
    }

    // Fall back to global max wait
    return this.maxWait
  }

  /**
   * Enable or disable smart coalescing.
   * When enabled: create + modify = create, modify + delete = delete
   *
   * @param enabled - Whether to enable smart coalescing
   */
  setSmartCoalescing(enabled: boolean): void {
    this.smartCoalescing = enabled
  }

  /**
   * Check if smart coalescing is enabled.
   *
   * @returns True if smart coalescing is enabled
   */
  isSmartCoalescing(): boolean {
    return this.smartCoalescing
  }

  /**
   * Get the number of pending events waiting to be emitted.
   *
   * @returns Number of pending events
   */
  getPendingCount(): number {
    return this.pendingEvents.size
  }

  /**
   * Immediately flush all pending events without waiting for debounce timers.
   * Useful for testing or forced cleanup.
   */
  flushPending(): void {
    for (const [path, pending] of this.pendingEvents) {
      clearTimeout(pending.timer)
      if (pending.maxWaitTimer) {
        clearTimeout(pending.maxWaitTimer)
      }
      this.emitNow(pending.eventType, path)
    }
    this.pendingEvents.clear()
  }

  /**
   * Emit a file system event to all matching watchers.
   * Events are debounced per-path to coalesce rapid changes.
   *
   * @param eventType - 'change' for content modifications, 'rename' for create/delete/rename
   * @param affectedPath - The full normalized path that was affected
   */
  emit(eventType: WatchEventType, affectedPath: string): void {
    const normalizedPath = this.normalizePath(affectedPath)
    const existingPending = this.pendingEvents.get(normalizedPath)
    const pathDelay = this.getPathDebounceDelay(normalizedPath)
    const pathMaxWait = this.getPathMaxWait(normalizedPath)

    if (existingPending) {
      // Update existing pending event with smart coalescing
      clearTimeout(existingPending.timer)

      // Apply coalescing rules based on configuration
      const coalescedEventType = this.smartCoalescing
        ? this.coalesceEventTypes(existingPending.originalEventType, eventType)
        : eventType

      existingPending.eventType = coalescedEventType
      existingPending.timer = this.scheduleEmit(normalizedPath, coalescedEventType, pathDelay)
    } else {
      // Create new pending event
      const now = Date.now()
      const pending: PendingEvent = {
        eventType,
        originalEventType: eventType,
        path: normalizedPath,
        timer: null as unknown as ReturnType<typeof setTimeout>,
        firstEventTime: now,
        leadingEmitted: false,
      }

      // Handle leading edge emission
      if (this.debounceMode === 'leading' || this.debounceMode === 'both') {
        // Emit immediately on first event
        pending.leadingEmitted = true
        this.emitNow(eventType, normalizedPath)
      }

      // Schedule trailing edge emission (even for leading mode, to track the cooldown)
      pending.timer = this.scheduleEmit(normalizedPath, eventType, pathDelay)

      // Set up max wait timer if configured
      if (pathMaxWait !== undefined) {
        pending.maxWaitTimer = setTimeout(() => {
          const currentPending = this.pendingEvents.get(normalizedPath)
          if (currentPending) {
            clearTimeout(currentPending.timer)
            this.pendingEvents.delete(normalizedPath)
            this.emitNow(currentPending.eventType, normalizedPath)
          }
        }, pathMaxWait)
      }

      this.pendingEvents.set(normalizedPath, pending)
    }
  }

  /**
   * Apply smart coalescing rules to determine the final event type.
   *
   * Rules:
   * - 'rename' (create) + 'change' (modify) = 'rename' (file was created, subsequent modifies don't matter)
   * - 'change' (modify) + 'rename' (delete) = 'rename' (file was deleted, ignore prior modifications)
   * - Same types = keep the type
   */
  private coalesceEventTypes(
    originalType: WatchEventType,
    newType: WatchEventType
  ): WatchEventType {
    // If original was 'rename' (create), keep it regardless of subsequent changes
    // because the important event is that a new file appeared
    if (originalType === 'rename' && newType === 'change') {
      return 'rename'
    }

    // If new event is 'rename' (could be delete), it takes precedence
    // because file deletion is the final state
    if (newType === 'rename') {
      return 'rename'
    }

    // Otherwise use the new event type
    return newType
  }

  /**
   * Schedule an emit to happen after the debounce delay.
   */
  private scheduleEmit(path: string, eventType: WatchEventType, delay: number): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      const pending = this.pendingEvents.get(path)
      if (pending) {
        // Clear max wait timer if set
        if (pending.maxWaitTimer) {
          clearTimeout(pending.maxWaitTimer)
        }
        this.pendingEvents.delete(path)

        // For leading mode, don't emit again on trailing edge (unless mode is 'both')
        // For trailing mode, always emit
        // For both mode, emit on trailing edge (leading already emitted)
        if (this.debounceMode === 'trailing' || this.debounceMode === 'both') {
          // Only emit if this is trailing mode OR if it's 'both' and we had events after the leading edge
          if (this.debounceMode === 'trailing' || (this.debounceMode === 'both' && pending.leadingEmitted)) {
            this.emitNow(eventType, path)
          }
        }
      }
    }, delay)
  }

  /**
   * Immediately emit an event to all matching watchers without debouncing.
   */
  private emitNow(eventType: WatchEventType, affectedPath: string): void {
    const matchingWatchers = this.findMatchingWatchers(eventType, affectedPath)

    // Fire all callbacks asynchronously using queueMicrotask for batching
    for (const { watcher, filename } of matchingWatchers) {
      queueMicrotask(() => {
        if (!watcher.closed) {
          try {
            watcher.listener(eventType, filename)
          } catch {
            // Swallow listener errors to prevent breaking other watchers
          }
        }
      })
    }
  }

  /**
   * Find all watchers that match a given path.
   */
  private findMatchingWatchers(
    _eventType: WatchEventType,
    affectedPath: string
  ): Array<{ watcher: WatchEntry; filename: string }> {
    const normalizedAffected = this.normalizePath(affectedPath)
    const matchingWatchers: Array<{ watcher: WatchEntry; filename: string }> = []

    // 1. Check for exact path watchers (watching this specific file/dir)
    const exactWatchers = this.watchersByPath.get(normalizedAffected)
    if (exactWatchers) {
      for (const watcher of exactWatchers) {
        if (!watcher.closed) {
          const filename = this.getBasename(normalizedAffected)
          matchingWatchers.push({ watcher, filename })
        }
      }
    }

    // 2. Check for parent directory watchers
    let currentPath = this.getParentPath(normalizedAffected)
    if (currentPath !== normalizedAffected) {
      // Direct parent watchers (both recursive and non-recursive)
      const parentWatchers = this.watchersByPath.get(currentPath)
      if (parentWatchers) {
        for (const watcher of parentWatchers) {
          if (!watcher.closed) {
            const filename = this.getBasename(normalizedAffected)
            matchingWatchers.push({ watcher, filename })
          }
        }
      }

      // 3. Check for ancestor directory watchers (recursive only)
      let ancestorPath = this.getParentPath(currentPath)
      while (ancestorPath !== currentPath) {
        const ancestorWatchers = this.watchersByPath.get(ancestorPath)
        if (ancestorWatchers) {
          for (const watcher of ancestorWatchers) {
            if (!watcher.closed && watcher.recursive) {
              const filename = this.getRelativePath(ancestorPath, normalizedAffected)
              matchingWatchers.push({ watcher, filename })
            }
          }
        }
        currentPath = ancestorPath
        ancestorPath = this.getParentPath(ancestorPath)
      }

      // Check root watchers if we're not at root
      if (currentPath !== '/') {
        const rootWatchers = this.watchersByPath.get('/')
        if (rootWatchers) {
          for (const watcher of rootWatchers) {
            if (!watcher.closed && watcher.recursive) {
              const filename = normalizedAffected.slice(1) // Remove leading /
              matchingWatchers.push({ watcher, filename })
            }
          }
        }
      }
    }

    return matchingWatchers
  }

  /**
   * Normalize a path by removing trailing slashes (except for root).
   */
  private normalizePath(path: string): string {
    if (path === '/' || path === '') return '/'
    return path.endsWith('/') ? path.slice(0, -1) : path
  }

  /**
   * Get the parent directory path.
   */
  private getParentPath(path: string): string {
    if (path === '/') return '/'
    const lastSlash = path.lastIndexOf('/')
    if (lastSlash <= 0) return '/'
    return path.slice(0, lastSlash)
  }

  /**
   * Get the basename (final component) of a path.
   */
  private getBasename(path: string): string {
    const lastSlash = path.lastIndexOf('/')
    return lastSlash >= 0 ? path.slice(lastSlash + 1) : path
  }

  /**
   * Get the relative path from a base to a target.
   */
  private getRelativePath(basePath: string, targetPath: string): string {
    const normalizedBase = this.normalizePath(basePath)
    const normalizedTarget = this.normalizePath(targetPath)

    if (normalizedBase === '/') {
      return normalizedTarget.slice(1)
    }

    if (normalizedTarget.startsWith(normalizedBase + '/')) {
      return normalizedTarget.slice(normalizedBase.length + 1)
    }

    return normalizedTarget
  }

  /**
   * Check if a path matches a glob pattern.
   * Supports simple glob patterns like *.log, /path/*, etc.
   */
  private matchesGlobPattern(path: string, pattern: string): boolean {
    // Exact match
    if (path === pattern) return true

    // Check if pattern is a glob
    if (!pattern.includes('*')) return false

    // Convert glob pattern to regex
    // Escape special regex chars except *
    const escapedPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')

    const regex = new RegExp(`^${escapedPattern}$`)
    return regex.test(path) || regex.test(this.getBasename(path))
  }
}
