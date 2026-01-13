/**
 * StorageQuotaMonitor - Monitors DO storage usage and emits warnings at 80% threshold
 *
 * Cloudflare Durable Object Storage Limits:
 * - 128KB max per value
 * - 128 keys max per batch operation
 * - Total DO storage varies by plan (~256KB-1GB)
 *
 * This monitor provides:
 * - Real-time tracking of storage usage by key
 * - Warnings at 80% of per-value limit (128KB)
 * - Warnings at 80% of batch limit (128 keys)
 * - Total usage statistics (used/total/percentage)
 * - Event emission for observability
 * - Pre-write validation to prevent limit violations
 */

const KB = 1024

// ============================================================================
// STORAGE LIMITS CONSTANTS
// ============================================================================

/**
 * Cloudflare DO storage limits and derived thresholds
 */
export const STORAGE_LIMITS = {
  /** Maximum size per value: 128KB */
  MAX_VALUE_SIZE: 128 * KB,

  /** Maximum keys per batch operation */
  MAX_BATCH_KEYS: 128,

  /** Warning threshold percentage (80%) */
  WARNING_THRESHOLD: 0.8,

  /** Value size that triggers warning (80% of 128KB) */
  VALUE_WARNING_THRESHOLD: Math.floor(128 * KB * 0.8),

  /** Batch size that triggers warning (80% of 128) */
  BATCH_WARNING_THRESHOLD: Math.floor(128 * 0.8),

  /** Default total storage limit (256KB - conservative default) */
  DEFAULT_TOTAL_LIMIT: 256 * KB,
} as const

// ============================================================================
// TYPES
// ============================================================================

/**
 * Types of quota warnings that can be emitted
 */
export type QuotaWarningType = 'value_size' | 'batch_size' | 'total_usage'

/**
 * Quota warning event structure
 */
export interface QuotaWarning {
  /** Type of warning */
  type: QuotaWarningType
  /** Current usage (bytes for value/total, count for batch) */
  currentUsage: number
  /** The applicable limit */
  limit: number
  /** Percentage of limit used (0-100+) */
  percentage: number
  /** Key that triggered the warning (for value_size) */
  key?: string
  /** Whether this would exceed the hard limit */
  wouldExceedLimit: boolean
  /** Timestamp when warning was generated */
  timestamp: number
}

/**
 * Storage usage statistics
 */
export interface UsageStats {
  /** Total bytes used across all keys */
  totalBytes: number
  /** Number of keys stored */
  keyCount: number
  /** Percentage of total limit used (0-100+) */
  percentage: number
  /** The total storage limit */
  limit: number
  /** Whether currently at warning threshold */
  isWarning: boolean
}

/**
 * Storage snapshot for observability
 */
export interface StorageSnapshot {
  /** When snapshot was taken */
  timestamp: number
  /** Current stats */
  stats: UsageStats
  /** Top N largest keys */
  largestKeys: Array<{ key: string; size: number }>
}

/**
 * Key size entry
 */
interface KeySizeEntry {
  key: string
  size: number
}

/**
 * Configuration options for StorageQuotaMonitor
 */
export interface StorageQuotaMonitorOptions {
  /** Total storage limit in bytes (default: 256KB) */
  totalLimit?: number
  /** Warning threshold as decimal (default: 0.8 = 80%) */
  warningThreshold?: number
  /** Max value size in bytes (default: 128KB) */
  maxValueSize?: number
  /** Max batch keys (default: 128) */
  maxBatchKeys?: number
  /** Whether to emit warning events (default: true) */
  emitWarnings?: boolean
}

/**
 * Wrapper options for storage operations
 */
export interface WrapperOptions {
  /** Throw error if operation would exceed limit */
  throwOnExceed?: boolean
}

// ============================================================================
// WARNING CALLBACK TYPES
// ============================================================================

type WarningCallback = (warning: QuotaWarning) => void

// ============================================================================
// STORAGE QUOTA MONITOR
// ============================================================================

/**
 * StorageQuotaMonitor - Tracks storage usage and warns at 80% threshold
 */
export class StorageQuotaMonitor {
  private keyUsage: Map<string, number> = new Map()
  private warningCallbacks: Set<WarningCallback> = new Set()

  // Configuration
  private readonly totalLimit: number
  private readonly warningThreshold: number
  private readonly maxValueSize: number
  private readonly maxBatchKeys: number
  private readonly emitWarnings: boolean

  constructor(options: StorageQuotaMonitorOptions = {}) {
    this.totalLimit = options.totalLimit ?? STORAGE_LIMITS.DEFAULT_TOTAL_LIMIT
    this.warningThreshold = options.warningThreshold ?? STORAGE_LIMITS.WARNING_THRESHOLD
    this.maxValueSize = options.maxValueSize ?? STORAGE_LIMITS.MAX_VALUE_SIZE
    this.maxBatchKeys = options.maxBatchKeys ?? STORAGE_LIMITS.MAX_BATCH_KEYS
    this.emitWarnings = options.emitWarnings ?? true
  }

  // ==========================================================================
  // SIZE CALCULATION
  // ==========================================================================

  /**
   * Calculate the serialized size of a value in bytes
   */
  calculateSize(value: unknown): number {
    if (value === null || value === undefined) {
      return 0
    }

    // Handle ArrayBuffer
    if (value instanceof ArrayBuffer) {
      return value.byteLength
    }

    // Handle TypedArrays
    if (ArrayBuffer.isView(value)) {
      return value.byteLength
    }

    // For objects and primitives, serialize to JSON and measure
    try {
      const seen = new WeakSet()
      const serialized = JSON.stringify(value, (key, val) => {
        // Handle circular references
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) {
            return '[Circular]'
          }
          seen.add(val)
        }
        return val
      })
      return new TextEncoder().encode(serialized).length
    } catch {
      // Fallback for non-serializable values
      return 0
    }
  }

  // ==========================================================================
  // USAGE TRACKING
  // ==========================================================================

  /**
   * Track a put operation for a key
   */
  trackPut(key: string, value: unknown): void {
    const size = this.calculateSize(value)
    const previousSize = this.keyUsage.get(key) ?? 0
    this.keyUsage.set(key, size)

    // Check if we crossed total usage threshold
    if (this.emitWarnings) {
      const stats = this.getUsageStats()
      if (stats.isWarning && (stats.totalBytes - previousSize + size) >= this.totalLimit * this.warningThreshold) {
        this.emitWarning({
          type: 'total_usage',
          currentUsage: stats.totalBytes,
          limit: this.totalLimit,
          percentage: stats.percentage,
          wouldExceedLimit: stats.percentage >= 100,
          timestamp: Date.now(),
        })
      }
    }
  }

  /**
   * Track a delete operation for a key
   */
  trackDelete(key: string): void {
    this.keyUsage.delete(key)
  }

  /**
   * Get the current usage for a specific key
   */
  getKeyUsage(key: string): number | undefined {
    return this.keyUsage.get(key)
  }

  /**
   * Clear all tracked usage
   */
  clear(): void {
    this.keyUsage.clear()
  }

  // ==========================================================================
  // PRE-WRITE VALIDATION
  // ==========================================================================

  /**
   * Check if a value would trigger warnings before writing
   * Returns null if no warning, otherwise returns the warning
   */
  checkBeforeWrite(key: string, value: unknown): QuotaWarning | null {
    const size = this.calculateSize(value)
    const threshold = this.maxValueSize * this.warningThreshold
    const percentage = (size / this.maxValueSize) * 100

    if (size >= threshold) {
      const warning: QuotaWarning = {
        type: 'value_size',
        currentUsage: size,
        limit: this.maxValueSize,
        percentage,
        key,
        wouldExceedLimit: size > this.maxValueSize,
        timestamp: Date.now(),
      }

      if (this.emitWarnings) {
        this.emitWarning(warning)
      }

      return warning
    }

    return null
  }

  /**
   * Check if a batch operation would trigger warnings
   */
  checkBatchBeforeWrite(batch: Record<string, unknown>): QuotaWarning | null {
    const keyCount = Object.keys(batch).length

    if (keyCount === 0) {
      return null
    }

    const threshold = this.maxBatchKeys * this.warningThreshold
    const percentage = (keyCount / this.maxBatchKeys) * 100

    if (keyCount >= threshold) {
      const warning: QuotaWarning = {
        type: 'batch_size',
        currentUsage: keyCount,
        limit: this.maxBatchKeys,
        percentage,
        wouldExceedLimit: keyCount > this.maxBatchKeys,
        timestamp: Date.now(),
      }

      if (this.emitWarnings) {
        this.emitWarning(warning)
      }

      return warning
    }

    return null
  }

  /**
   * Check all values in a batch for individual size warnings
   * Returns all warnings (batch size + individual value sizes)
   */
  checkBatchBeforeWriteAll(batch: Record<string, unknown>): QuotaWarning[] {
    const warnings: QuotaWarning[] = []

    // Check batch size
    const batchWarning = this.checkBatchBeforeWrite(batch)
    if (batchWarning) {
      warnings.push(batchWarning)
    }

    // Check individual values
    for (const [key, value] of Object.entries(batch)) {
      const valueWarning = this.checkBeforeWrite(key, value)
      if (valueWarning) {
        warnings.push(valueWarning)
      }
    }

    return warnings
  }

  // ==========================================================================
  // USAGE STATISTICS
  // ==========================================================================

  /**
   * Get current usage statistics
   */
  getUsageStats(): UsageStats {
    let totalBytes = 0
    for (const size of this.keyUsage.values()) {
      totalBytes += size
    }

    const percentage = (totalBytes / this.totalLimit) * 100
    const isWarning = percentage >= this.warningThreshold * 100

    return {
      totalBytes,
      keyCount: this.keyUsage.size,
      percentage,
      limit: this.totalLimit,
      isWarning,
    }
  }

  /**
   * Get per-key size breakdown
   */
  getKeyBreakdown(): Record<string, number> {
    const breakdown: Record<string, number> = {}
    for (const [key, size] of this.keyUsage) {
      breakdown[key] = size
    }
    return breakdown
  }

  /**
   * Get the N largest keys by size
   */
  getLargestKeys(n: number = 10): KeySizeEntry[] {
    const entries: KeySizeEntry[] = []
    for (const [key, size] of this.keyUsage) {
      entries.push({ key, size })
    }
    entries.sort((a, b) => b.size - a.size)
    return entries.slice(0, n)
  }

  /**
   * Get a snapshot of current storage state for observability
   */
  getSnapshot(): StorageSnapshot {
    return {
      timestamp: Date.now(),
      stats: this.getUsageStats(),
      largestKeys: this.getLargestKeys(10),
    }
  }

  // ==========================================================================
  // WARNING EVENT SYSTEM
  // ==========================================================================

  /**
   * Register a callback for warning events
   * Returns an unsubscribe function
   */
  onWarning(callback: WarningCallback): () => void {
    this.warningCallbacks.add(callback)
    return () => {
      this.warningCallbacks.delete(callback)
    }
  }

  /**
   * Emit a warning to all registered callbacks
   */
  private emitWarning(warning: QuotaWarning): void {
    for (const callback of this.warningCallbacks) {
      try {
        callback(warning)
      } catch {
        // Ignore callback errors
      }
    }
  }

  // ==========================================================================
  // STORAGE OPERATION WRAPPERS
  // ==========================================================================

  /**
   * Wrap a put function to automatically track usage and validate
   */
  wrapPut<T>(
    putFn: (key: string, value: T) => Promise<void>,
    options: WrapperOptions = {},
  ): (key: string, value: T) => Promise<void> {
    return async (key: string, value: T): Promise<void> => {
      const warning = this.checkBeforeWrite(key, value)

      if (options.throwOnExceed && warning?.wouldExceedLimit) {
        throw new Error(`Storage quota exceeded: ${warning.type} - ${warning.percentage.toFixed(1)}% of limit`)
      }

      await putFn(key, value)
      this.trackPut(key, value)
    }
  }

  /**
   * Wrap a delete function to automatically track usage
   */
  wrapDelete(
    deleteFn: (key: string) => Promise<boolean>,
  ): (key: string) => Promise<boolean> {
    return async (key: string): Promise<boolean> => {
      const result = await deleteFn(key)
      this.trackDelete(key)
      return result
    }
  }

  /**
   * Wrap a batch put function to automatically track usage and validate
   */
  wrapBatchPut<T>(
    putFn: (entries: Record<string, T>) => Promise<void>,
    options: WrapperOptions = {},
  ): (entries: Record<string, T>) => Promise<void> {
    return async (entries: Record<string, T>): Promise<void> => {
      const warnings = this.checkBatchBeforeWriteAll(entries as Record<string, unknown>)
      const exceedWarnings = warnings.filter((w) => w.wouldExceedLimit)

      if (options.throwOnExceed && exceedWarnings.length > 0) {
        const first = exceedWarnings[0]
        throw new Error(`Storage quota exceeded: ${first.type} - ${first.percentage.toFixed(1)}% of limit`)
      }

      await putFn(entries)

      // Track all keys
      for (const [key, value] of Object.entries(entries)) {
        this.trackPut(key, value)
      }
    }
  }
}
