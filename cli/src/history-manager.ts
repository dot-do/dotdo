/**
 * History Manager - Persistent REPL history with optimized file I/O
 *
 * Features:
 * - Persists history to ~/.dotdo/repl_history
 * - Creates directory with 0700 permissions
 * - Creates file with 0600 permissions
 * - Filters sensitive commands (token, password, secret, key - case insensitive)
 * - Max size default 1000, FIFO removal
 * - Handles malformed files gracefully
 *
 * Optimizations (v2):
 * - Async file operations via fs.promises
 * - Write batching/debouncing to reduce I/O
 * - File locking to prevent corruption
 * - Lazy loading support for large history files
 */

import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'

export interface HistoryManagerOptions {
  historyPath?: string
  maxSize?: number
  /** Debounce interval for writes in ms (default: 500ms) */
  debounceMs?: number
  /** Enable lazy loading for large history files */
  lazyLoad?: boolean
  /** Number of entries to load initially when lazy loading (default: 100) */
  initialLoadSize?: number
}

// Sensitive patterns - case insensitive
const SENSITIVE_PATTERNS = ['token', 'password', 'secret', 'key']

function isSensitive(entry: string): boolean {
  const lower = entry.toLowerCase()
  return SENSITIVE_PATTERNS.some((pattern) => lower.includes(pattern))
}

/**
 * Simple file lock implementation using lockfile pattern
 * Creates a .lock file to indicate exclusive access
 */
class FileLock {
  private readonly lockPath: string
  private locked = false
  private lockFd: fsp.FileHandle | null = null

  constructor(filePath: string) {
    this.lockPath = `${filePath}.lock`
  }

  /**
   * Acquire lock with timeout
   * Uses exclusive file creation to ensure only one process holds the lock
   */
  async acquire(timeoutMs = 5000): Promise<boolean> {
    const startTime = Date.now()
    const retryInterval = 50

    while (Date.now() - startTime < timeoutMs) {
      try {
        // Try to create lock file exclusively (O_CREAT | O_EXCL)
        this.lockFd = await fsp.open(this.lockPath, 'wx')
        // Write PID for debugging
        await this.lockFd.write(String(process.pid))
        this.locked = true
        return true
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          // Lock exists, check if it's stale (older than 10 seconds)
          try {
            const stats = await fsp.stat(this.lockPath)
            const age = Date.now() - stats.mtimeMs
            if (age > 10000) {
              // Stale lock, try to remove it
              await fsp.unlink(this.lockPath).catch(() => {})
            }
          } catch {
            // Stat failed, lock file may have been removed
          }
          // Wait and retry
          await new Promise((resolve) => setTimeout(resolve, retryInterval))
        } else {
          // Other error (e.g., permission denied, no space)
          return false
        }
      }
    }
    return false
  }

  /**
   * Release the lock
   */
  async release(): Promise<void> {
    if (!this.locked) return

    try {
      if (this.lockFd) {
        await this.lockFd.close()
        this.lockFd = null
      }
      await fsp.unlink(this.lockPath).catch(() => {})
    } finally {
      this.locked = false
    }
  }

  /**
   * Check if lock is held
   */
  isLocked(): boolean {
    return this.locked
  }
}

/**
 * Debounced writer that batches multiple writes into a single I/O operation
 */
class DebouncedWriter {
  private pendingWrite: string | null = null
  private writeTimer: ReturnType<typeof setTimeout> | null = null
  private readonly debounceMs: number
  private readonly filePath: string
  private readonly lock: FileLock
  private writeInProgress = false
  private writePromise: Promise<void> | null = null

  constructor(filePath: string, debounceMs: number) {
    this.filePath = filePath
    this.debounceMs = debounceMs
    this.lock = new FileLock(filePath)
  }

  /**
   * Schedule a write operation
   * Multiple calls within debounceMs will be batched
   */
  write(content: string): void {
    this.pendingWrite = content

    // Clear existing timer
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
    }

    // Schedule new write
    this.writeTimer = setTimeout(() => {
      this._flush().catch(() => {})
    }, this.debounceMs)
  }

  /**
   * Immediately flush any pending writes
   */
  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }

    // Wait for any in-progress write
    if (this.writePromise) {
      await this.writePromise
    }

    // Flush pending content
    if (this.pendingWrite !== null) {
      await this._flush()
    }
  }

  /**
   * Internal flush implementation with locking
   */
  private async _flush(): Promise<void> {
    if (this.writeInProgress || this.pendingWrite === null) {
      return
    }

    this.writeInProgress = true
    const content = this.pendingWrite
    this.pendingWrite = null

    this.writePromise = (async () => {
      try {
        // Acquire lock
        const acquired = await this.lock.acquire(2000)
        if (!acquired) {
          // Couldn't acquire lock, re-queue the write
          this.pendingWrite = content
          return
        }

        try {
          // Write to temp file first, then rename (atomic operation)
          const tempPath = `${this.filePath}.tmp.${process.pid}`
          await fsp.writeFile(tempPath, content, {
            encoding: 'utf-8',
            mode: 0o600,
          })
          await fsp.rename(tempPath, this.filePath)
        } finally {
          await this.lock.release()
        }
      } catch {
        // Re-queue on error
        if (this.pendingWrite === null) {
          this.pendingWrite = content
        }
      } finally {
        this.writeInProgress = false
        this.writePromise = null
      }
    })()

    await this.writePromise
  }

  /**
   * Cancel any pending writes (useful for shutdown)
   */
  cancel(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    this.pendingWrite = null
  }
}

export class HistoryManager {
  private readonly _historyPath: string
  private readonly _dotdoDir: string
  private readonly _maxSize: number
  private readonly _debounceMs: number
  private readonly _lazyLoad: boolean
  private readonly _initialLoadSize: number
  private _history: string[] = []
  private _debouncedWriter: DebouncedWriter | null = null
  private _fullyLoaded = false
  private _totalEntriesOnDisk = 0

  constructor(options?: HistoryManagerOptions) {
    this._historyPath = options?.historyPath ?? path.join(os.homedir(), '.dotdo', 'repl_history')
    this._dotdoDir = path.dirname(this._historyPath)
    this._maxSize = options?.maxSize ?? 1000
    this._debounceMs = options?.debounceMs ?? 500
    this._lazyLoad = options?.lazyLoad ?? false
    this._initialLoadSize = options?.initialLoadSize ?? 100
  }

  get maxSize(): number {
    return this._maxSize
  }

  get size(): number {
    return this._history.length
  }

  /**
   * Check if all history has been loaded (for lazy loading mode)
   */
  get fullyLoaded(): boolean {
    return this._fullyLoaded
  }

  /**
   * Total entries available on disk (may be more than currently loaded)
   */
  get totalEntries(): number {
    return this._lazyLoad ? this._totalEntriesOnDisk : this._history.length
  }

  /**
   * Synchronous initialization (backward compatible)
   * Uses sync fs operations for compatibility with existing tests
   */
  initialize(): void {
    // Ensure directory exists with proper permissions
    this._ensureDirectory()

    // Load existing history
    this._loadHistory()

    // Check and fix file permissions if needed
    this._checkPermissions()

    // Initialize debounced writer for async operations
    this._debouncedWriter = new DebouncedWriter(this._historyPath, this._debounceMs)
  }

  /**
   * Async initialization (preferred for new code)
   * Uses fs.promises for non-blocking I/O
   */
  async initializeAsync(): Promise<void> {
    // Ensure directory exists with proper permissions
    await this._ensureDirectoryAsync()

    // Load existing history
    await this._loadHistoryAsync()

    // Check and fix file permissions if needed
    await this._checkPermissionsAsync()

    // Initialize debounced writer
    this._debouncedWriter = new DebouncedWriter(this._historyPath, this._debounceMs)
  }

  add(entry: string): void {
    // Skip empty or whitespace-only entries
    if (!entry || !entry.trim()) {
      return
    }

    // Skip duplicate consecutive entries
    if (this._history.length > 0 && this._history[this._history.length - 1] === entry) {
      return
    }

    // Add to in-memory history
    this._history.push(entry)

    // Enforce max size (FIFO removal)
    while (this._history.length > this._maxSize) {
      this._history.shift()
    }

    // Only persist non-sensitive commands
    if (!isSensitive(entry)) {
      this._persistHistory()
    }
  }

  /**
   * Async add with debounced write
   */
  async addAsync(entry: string): Promise<void> {
    // Skip empty or whitespace-only entries
    if (!entry || !entry.trim()) {
      return
    }

    // Skip duplicate consecutive entries
    if (this._history.length > 0 && this._history[this._history.length - 1] === entry) {
      return
    }

    // Add to in-memory history
    this._history.push(entry)

    // Enforce max size (FIFO removal)
    while (this._history.length > this._maxSize) {
      this._history.shift()
    }

    // Only persist non-sensitive commands (uses debounced writer)
    if (!isSensitive(entry)) {
      this._persistHistoryAsync()
    }
  }

  getHistory(): string[] {
    return [...this._history]
  }

  /**
   * Get history with pagination support
   * @param offset Starting index (0 = oldest)
   * @param limit Maximum entries to return
   */
  getHistoryPage(offset: number, limit: number): string[] {
    const start = Math.max(0, offset)
    const end = Math.min(this._history.length, start + limit)
    return this._history.slice(start, end)
  }

  getEntry(index: number): string | undefined {
    if (index < 0 || index >= this._history.length) {
      return undefined
    }
    return this._history[index]
  }

  clear(): void {
    this._history = []
    this._persistHistory()
  }

  /**
   * Async clear with immediate flush
   */
  async clearAsync(): Promise<void> {
    this._history = []
    await this._persistHistoryAsync()
    if (this._debouncedWriter) {
      await this._debouncedWriter.flush()
    }
  }

  search(query: string): string[] {
    return this._history.filter((entry) => entry.includes(query))
  }

  /**
   * Search with pagination for large histories
   */
  searchPaginated(query: string, offset = 0, limit = 50): { results: string[]; total: number } {
    const allMatches = this._history.filter((entry) => entry.includes(query))
    return {
      results: allMatches.slice(offset, offset + limit),
      total: allMatches.length,
    }
  }

  /**
   * Load more history entries when in lazy load mode
   */
  async loadMore(count: number): Promise<string[]> {
    if (this._fullyLoaded || !this._lazyLoad) {
      return []
    }

    try {
      const content = await fsp.readFile(this._historyPath, 'utf-8')
      const allLines = content.split('\n').filter((line) => line.trim() !== '')

      // Already have some entries, load more from the beginning
      const currentCount = this._history.length
      const startIndex = Math.max(0, allLines.length - currentCount - count)
      const endIndex = allLines.length - currentCount

      if (startIndex >= endIndex) {
        this._fullyLoaded = true
        return []
      }

      const newEntries = allLines.slice(startIndex, endIndex)
      // Prepend to history (these are older entries)
      this._history = [...newEntries, ...this._history]
      this._fullyLoaded = startIndex === 0

      return newEntries
    } catch {
      this._fullyLoaded = true
      return []
    }
  }

  /**
   * Flush any pending writes and cleanup
   */
  async shutdown(): Promise<void> {
    if (this._debouncedWriter) {
      await this._debouncedWriter.flush()
    }
  }

  // =============================================================================
  // Private methods - Sync (backward compatible)
  // =============================================================================

  private _ensureDirectory(): void {
    try {
      if (!fs.existsSync(this._dotdoDir)) {
        fs.mkdirSync(this._dotdoDir, {
          recursive: true,
          mode: 0o700,
        })
      }
    } catch {
      // Silently handle errors - history is optional
    }
  }

  private _loadHistory(): void {
    try {
      if (!fs.existsSync(this._historyPath)) {
        this._history = []
        this._fullyLoaded = true
        return
      }

      const content = fs.readFileSync(this._historyPath, 'utf-8')
      const lines = content.split('\n').filter((line) => line.trim() !== '')

      this._totalEntriesOnDisk = lines.length

      if (this._lazyLoad && lines.length > this._initialLoadSize) {
        // Only load the most recent entries initially
        this._history = lines.slice(-this._initialLoadSize)
        this._fullyLoaded = false
      } else {
        // Respect max size - keep most recent entries
        if (lines.length > this._maxSize) {
          this._history = lines.slice(-this._maxSize)
        } else {
          this._history = lines
        }
        this._fullyLoaded = true
      }
    } catch {
      // Handle read errors gracefully - start with empty history
      this._history = []
      this._fullyLoaded = true
    }
  }

  private _checkPermissions(): void {
    try {
      if (!fs.existsSync(this._historyPath)) {
        return
      }

      const stats = fs.statSync(this._historyPath)
      // Check if permissions are not 0600 (owner read/write only)
      // The mode includes file type bits, so we mask to get just permissions
      const permissions = stats.mode & 0o777
      if (permissions !== 0o600) {
        fs.chmodSync(this._historyPath, 0o600)
      }
    } catch {
      // Silently handle permission check errors
    }
  }

  private _persistHistory(): void {
    try {
      // Filter out sensitive commands before persisting
      const nonSensitiveHistory = this._history.filter((entry) => !isSensitive(entry))
      const content = nonSensitiveHistory.join('\n')

      fs.writeFileSync(this._historyPath, content, {
        encoding: 'utf-8',
        mode: 0o600,
      })
    } catch {
      // Silently handle write errors - in-memory history is still valid
    }
  }

  // =============================================================================
  // Private methods - Async (optimized)
  // =============================================================================

  private async _ensureDirectoryAsync(): Promise<void> {
    try {
      await fsp.mkdir(this._dotdoDir, {
        recursive: true,
        mode: 0o700,
      })
    } catch (err) {
      // EEXIST is fine, other errors we silently ignore
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        // Silently handle errors - history is optional
      }
    }
  }

  private async _loadHistoryAsync(): Promise<void> {
    try {
      const content = await fsp.readFile(this._historyPath, 'utf-8')
      const lines = content.split('\n').filter((line) => line.trim() !== '')

      this._totalEntriesOnDisk = lines.length

      if (this._lazyLoad && lines.length > this._initialLoadSize) {
        // Only load the most recent entries initially
        this._history = lines.slice(-this._initialLoadSize)
        this._fullyLoaded = false
      } else {
        // Respect max size - keep most recent entries
        if (lines.length > this._maxSize) {
          this._history = lines.slice(-this._maxSize)
        } else {
          this._history = lines
        }
        this._fullyLoaded = true
      }
    } catch {
      // Handle read errors gracefully - start with empty history
      this._history = []
      this._fullyLoaded = true
    }
  }

  private async _checkPermissionsAsync(): Promise<void> {
    try {
      const stats = await fsp.stat(this._historyPath)
      // Check if permissions are not 0600 (owner read/write only)
      const permissions = stats.mode & 0o777
      if (permissions !== 0o600) {
        await fsp.chmod(this._historyPath, 0o600)
      }
    } catch {
      // Silently handle permission check errors
    }
  }

  private _persistHistoryAsync(): void {
    if (!this._debouncedWriter) {
      // Fall back to sync if writer not initialized
      this._persistHistory()
      return
    }

    // Filter out sensitive commands before persisting
    const nonSensitiveHistory = this._history.filter((entry) => !isSensitive(entry))
    const content = nonSensitiveHistory.join('\n')

    // Use debounced writer for batched async writes
    this._debouncedWriter.write(content)
  }
}
