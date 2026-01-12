/**
 * StepResultStorage - Stores and retrieves workflow step execution results
 *
 * Provides:
 * - Store step results with metadata (timing, status, retry count)
 * - Retrieve results by step name
 * - Get all results with filtering
 * - Result persistence to Durable Object storage
 * - Cleanup utilities for old results
 *
 * This integrates with WorkflowRuntime to provide step result caching
 * and inspection capabilities.
 */

/// <reference types="@cloudflare/workers-types" />

// ============================================================================
// TYPES
// ============================================================================

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface StepResultInput {
  /** The output value from the step */
  output: unknown
  /** Current status of the step */
  status: StepStatus
  /** Execution duration in milliseconds */
  duration?: number
  /** Number of retry attempts */
  retryCount?: number
  /** When the step started executing */
  startedAt?: Date
  /** When the step finished executing */
  completedAt?: Date
  /** Error information if step failed */
  error?: {
    message: string
    name: string
    stack?: string
  }
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

export interface StoredStepResult {
  /** The step name */
  stepName: string
  /** The output value from the step */
  output: unknown
  /** Current status of the step */
  status: StepStatus
  /** Execution duration in milliseconds */
  duration?: number
  /** Number of retry attempts */
  retryCount?: number
  /** When the step started executing */
  startedAt?: Date
  /** When the step finished executing */
  completedAt?: Date
  /** Error information if step failed */
  error?: {
    message: string
    name: string
    stack?: string
  }
  /** Custom metadata */
  metadata?: Record<string, unknown>
  /** When the result was stored */
  storedAt?: string
}

interface PersistedStepResult {
  stepName: string
  output: unknown
  status: StepStatus
  duration?: number
  retryCount?: number
  startedAt?: string
  completedAt?: string
  error?: {
    message: string
    name: string
    stack?: string
  }
  metadata?: Record<string, unknown>
  storedAt: string
}

export interface GetAllOptions {
  /** Filter by status */
  status?: StepStatus
  /** Limit number of results */
  limit?: number
}

export interface ResultSummary {
  /** Total number of results */
  total: number
  /** Number of completed steps */
  completed: number
  /** Number of failed steps */
  failed: number
  /** Total duration of all steps */
  totalDuration: number
  /** List of step names in order */
  stepNames: string[]
}

// ============================================================================
// DURATION PARSING
// ============================================================================

function parseDuration(duration: string | number): number {
  if (typeof duration === 'number') {
    return duration
  }

  // Support formats like "100ms", "1 second", "30 seconds", "1 hour", etc.
  const match = duration.match(
    /^(\d+(?:\.\d+)?)\s*(ms|millisecond|s|sec|second|m|min|minute|h|hr|hour|d|day|w|week)s?$/i,
  )
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`)
  }

  const value = parseFloat(match[1]!)
  const unit = match[2]!.toLowerCase()

  const multipliers: Record<string, number> = {
    ms: 1,
    millisecond: 1,
    s: 1000,
    sec: 1000,
    second: 1000,
    m: 60 * 1000,
    min: 60 * 1000,
    minute: 60 * 1000,
    h: 60 * 60 * 1000,
    hr: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
  }

  return value * (multipliers[unit] || 1000)
}

// ============================================================================
// STEP RESULT STORAGE
// ============================================================================

const STORAGE_PREFIX = 'step-result:'

export class StepResultStorage {
  private readonly storage: DurableObjectStorage

  constructor(state: DurableObjectState) {
    this.storage = state.storage
  }

  // ==========================================================================
  // STORE
  // ==========================================================================

  /**
   * Store a step result with metadata
   */
  async store(stepName: string, result: StepResultInput): Promise<void> {
    const persisted: PersistedStepResult = {
      stepName,
      output: result.output,
      status: result.status,
      duration: result.duration,
      retryCount: result.retryCount,
      startedAt: result.startedAt?.toISOString(),
      completedAt: result.completedAt?.toISOString(),
      error: result.error,
      metadata: result.metadata,
      storedAt: new Date().toISOString(),
    }

    await this.storage.put(`${STORAGE_PREFIX}${stepName}`, persisted)
  }

  // ==========================================================================
  // GET
  // ==========================================================================

  /**
   * Retrieve a step result by name
   */
  async get(stepName: string): Promise<StoredStepResult | undefined> {
    const persisted = await this.storage.get<PersistedStepResult>(`${STORAGE_PREFIX}${stepName}`)

    if (!persisted) {
      return undefined
    }

    return this.hydrate(persisted)
  }

  /**
   * Alias for get - convenience method for WorkflowRuntime integration
   */
  async getStepResult(stepName: string): Promise<StoredStepResult | undefined> {
    return this.get(stepName)
  }

  /**
   * Check if a step has a stored result
   */
  async hasResult(stepName: string): Promise<boolean> {
    const result = await this.storage.get(`${STORAGE_PREFIX}${stepName}`)
    return result !== undefined
  }

  // ==========================================================================
  // GET ALL
  // ==========================================================================

  /**
   * Get all stored step results with optional filtering
   */
  async getAll(options: GetAllOptions = {}): Promise<StoredStepResult[]> {
    const entries = await this.storage.list<PersistedStepResult>({ prefix: STORAGE_PREFIX })

    let results: StoredStepResult[] = []

    for (const [, persisted] of entries) {
      const hydrated = this.hydrate(persisted)

      // Apply status filter
      if (options.status && hydrated.status !== options.status) {
        continue
      }

      results.push(hydrated)
    }

    // Sort by stored time (oldest first)
    results.sort((a, b) => {
      const timeA = a.storedAt ? new Date(a.storedAt).getTime() : 0
      const timeB = b.storedAt ? new Date(b.storedAt).getTime() : 0
      return timeA - timeB
    })

    // Apply limit
    if (options.limit && options.limit > 0) {
      results = results.slice(0, options.limit)
    }

    return results
  }

  /**
   * Get a summary of all step results
   */
  async getSummary(): Promise<ResultSummary> {
    const results = await this.getAll()

    const summary: ResultSummary = {
      total: results.length,
      completed: 0,
      failed: 0,
      totalDuration: 0,
      stepNames: [],
    }

    for (const result of results) {
      summary.stepNames.push(result.stepName)

      if (result.status === 'completed') {
        summary.completed++
      } else if (result.status === 'failed') {
        summary.failed++
      }

      if (result.duration) {
        summary.totalDuration += result.duration
      }
    }

    return summary
  }

  // ==========================================================================
  // CLEAR / CLEANUP
  // ==========================================================================

  /**
   * Clear a specific step result
   */
  async clear(stepName: string): Promise<void> {
    await this.storage.delete(`${STORAGE_PREFIX}${stepName}`)
  }

  /**
   * Clear all step results
   */
  async clearAll(): Promise<void> {
    const entries = await this.storage.list({ prefix: STORAGE_PREFIX })
    const keys = Array.from(entries.keys())

    for (const key of keys) {
      await this.storage.delete(key)
    }
  }

  /**
   * Clear results older than specified duration
   * @param maxAge Duration string (e.g., "1 hour", "30 minutes") or milliseconds
   */
  async clearOlderThan(maxAge: string | number): Promise<number> {
    const maxAgeMs = typeof maxAge === 'string' ? parseDuration(maxAge) : maxAge
    const cutoffTime = Date.now() - maxAgeMs

    const entries = await this.storage.list<PersistedStepResult>({ prefix: STORAGE_PREFIX })
    let clearedCount = 0

    for (const [key, persisted] of entries) {
      const storedTime = persisted.storedAt ? new Date(persisted.storedAt).getTime() : 0

      if (storedTime < cutoffTime) {
        await this.storage.delete(key)
        clearedCount++
      }
    }

    return clearedCount
  }

  /**
   * Clear results by status
   */
  async clearByStatus(status: StepStatus): Promise<number> {
    const entries = await this.storage.list<PersistedStepResult>({ prefix: STORAGE_PREFIX })
    let clearedCount = 0

    for (const [key, persisted] of entries) {
      if (persisted.status === status) {
        await this.storage.delete(key)
        clearedCount++
      }
    }

    return clearedCount
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Convert persisted data to StoredStepResult with proper Date objects
   */
  private hydrate(persisted: PersistedStepResult): StoredStepResult {
    return {
      stepName: persisted.stepName,
      output: persisted.output,
      status: persisted.status,
      duration: persisted.duration,
      retryCount: persisted.retryCount,
      startedAt: persisted.startedAt ? new Date(persisted.startedAt) : undefined,
      completedAt: persisted.completedAt ? new Date(persisted.completedAt) : undefined,
      error: persisted.error,
      metadata: persisted.metadata,
      storedAt: persisted.storedAt,
    }
  }
}

export default StepResultStorage
