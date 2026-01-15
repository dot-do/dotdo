/**
 * @fileoverview Chaos Testing Framework for Unified Storage
 *
 * This module provides a chaos testing framework for injecting faults into
 * the unified storage system. It enables:
 * - Fault injection for testing error handling paths
 * - Pipeline failure injection
 * - SQLite failure injection
 * - Network latency simulation
 * - DO eviction/hibernation simulation
 * - Clock skew injection
 * - Probability-based failures
 * - Scoped fault injection
 *
 * @module objects/unified-storage/chaos-controller
 */

import type { Pipeline } from './types/pipeline'
import type { SqlStorage } from './lazy-checkpointer'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Types of faults that can be injected
 */
export type FaultType =
  | 'error'
  | 'latency'
  | 'latency-then-error'
  | 'eviction'
  | 'clock-skew'
  | 'clock-drift'

/**
 * Target for fault injection
 */
export type FaultTarget =
  | 'pipeline.send'
  | 'sql.exec'
  | 'do.eviction'
  | 'clock.skew'
  | 'network.latency'
  | string

/**
 * Scope configuration for fault injection
 */
export interface FaultScope {
  /** Regex pattern to match operations */
  pattern?: RegExp
  /** Tables to match for SQL operations */
  tables?: string[]
  /** Start time for time-windowed faults */
  startTime?: number
  /** End time for time-windowed faults */
  endTime?: number
  /** Namespaces to match */
  namespaces?: string[]
}

/**
 * Delay configuration for latency faults
 */
export type DelayConfig = number | { min: number; max: number }

/**
 * Configuration for a fault to inject
 */
export interface FaultConfig {
  /** Type of fault */
  type: FaultType
  /** Error to throw for error faults */
  error?: Error
  /** Delay in milliseconds for latency faults */
  delayMs?: DelayConfig
  /** Probability of fault occurring (0-1) */
  probability?: number
  /** Scope to limit fault application */
  scope?: FaultScope
  /** Maximum number of times to trigger before auto-clearing */
  maxTriggers?: number
  /** Duration in milliseconds before auto-clearing */
  durationMs?: number
  /** For eviction faults: cold start delay */
  coldStartDelayMs?: number
  /** For eviction faults: interval for periodic evictions */
  intervalMs?: number
  /** For clock-skew: offset in milliseconds */
  offsetMs?: number
  /** For clock-drift: drift rate in ms per second */
  driftRateMs?: number
  /** When true, chains this fault with existing faults on the target */
  chain?: boolean
}

/**
 * Injected fault with metadata
 */
export interface InjectedFault {
  /** Target of the fault */
  target: FaultTarget
  /** Fault configuration */
  config: FaultConfig
  /** Time when fault was injected */
  injectedAt: number
  /** Number of times fault has been triggered */
  triggerCount: number
  /** Unique ID for chained faults */
  id: string
}

/**
 * Statistics about chaos controller operation
 */
export interface ChaosStats {
  /** Total number of faults triggered across all targets */
  totalFaultsTriggered: number
  /** Map of target to trigger count */
  faultsTriggered: Record<string, number>
  /** Number of active faults */
  activeFaults: number
  /** Time chaos controller was created */
  createdAt: number
}

/**
 * Configuration for ChaosController
 */
export interface ChaosControllerConfig {
  /** Pipeline to wrap */
  pipeline: Pipeline
  /** SQL storage to wrap */
  sqlStorage: SqlStorage
  /** DO state (optional, for eviction simulation) */
  doState?: DOState
  /** Clock to wrap (optional, for time-based chaos) */
  clock?: Clock
  /** Namespace for scoped faults */
  namespace?: string
  /** Whether chaos is enabled (default: true) */
  enabled?: boolean
  /** Seed for reproducible randomness */
  seed?: number
  /** Callback when eviction is triggered */
  onEviction?: () => void
}

/**
 * DO state interface for eviction simulation
 */
export interface DOState {
  isHibernating: () => boolean
  triggerHibernation: () => void
  wake: () => void
}

/**
 * Clock interface for time manipulation
 */
export interface Clock {
  now: () => number
}

/**
 * Event types emitted by ChaosController
 */
export type ChaosEventType = 'fault-triggered' | 'eviction'

/**
 * Fault triggered event payload
 */
export interface FaultTriggeredEvent {
  target: FaultTarget
  config: FaultConfig
  timestamp: number
}

/**
 * Eviction event payload
 */
export interface EvictionEvent {
  timestamp: number
}

/**
 * Custom error class for chaos-related errors
 */
export class ChaosError extends Error {
  constructor(
    message: string,
    public readonly target: FaultTarget
  ) {
    super(message)
    this.name = 'ChaosError'
  }
}

// ============================================================================
// SEEDED RANDOM NUMBER GENERATOR
// ============================================================================

/**
 * Simple seeded random number generator using xorshift128+
 */
class SeededRandom {
  private s0: number
  private s1: number

  constructor(seed: number) {
    this.s0 = seed
    this.s1 = seed ^ 0xdeadbeef
    // Warm up the generator
    for (let i = 0; i < 20; i++) {
      this.next()
    }
  }

  next(): number {
    let s1 = this.s0
    const s0 = this.s1
    this.s0 = s0
    s1 ^= s1 << 23
    s1 ^= s1 >>> 17
    s1 ^= s0
    s1 ^= s0 >>> 26
    this.s1 = s1
    // Return a number between 0 and 1
    return (this.s0 >>> 0) / 0xffffffff
  }
}

// ============================================================================
// CHAOS CONTROLLER
// ============================================================================

/**
 * ChaosController - Fault injection framework for unified storage testing
 */
export class ChaosController {
  private pipeline: Pipeline
  private sqlStorage: SqlStorage
  private doState?: DOState
  private clock?: Clock
  private namespace: string
  private enabled: boolean
  private seed?: number
  private onEviction?: () => void
  private rng: SeededRandom | null

  private faults: Map<string, InjectedFault[]> = new Map()
  private stats: ChaosStats
  private eventHandlers: Map<ChaosEventType, Set<Function>> = new Map()
  private closed = false
  private faultIdCounter = 0
  private evictionIntervalId: NodeJS.Timeout | null = null
  private clockDriftStartTime: number | null = null

  constructor(config: ChaosControllerConfig) {
    this.pipeline = config.pipeline
    this.sqlStorage = config.sqlStorage
    this.doState = config.doState
    this.clock = config.clock
    this.namespace = config.namespace || 'default'
    this.enabled = config.enabled !== false
    this.seed = config.seed
    this.onEviction = config.onEviction
    this.rng = this.seed !== undefined ? new SeededRandom(this.seed) : null

    this.stats = {
      totalFaultsTriggered: 0,
      faultsTriggered: {},
      activeFaults: 0,
      createdAt: Date.now(),
    }

    this.eventHandlers.set('fault-triggered', new Set())
    this.eventHandlers.set('eviction', new Set())
  }

  // ============================================================================
  // FAULT INJECTION API
  // ============================================================================

  /**
   * Inject a fault on a target
   */
  injectFault(target: FaultTarget, config: FaultConfig): void {
    const fault: InjectedFault = {
      target,
      config,
      injectedAt: Date.now(),
      triggerCount: 0,
      id: `fault-${++this.faultIdCounter}`,
    }

    if (config.chain) {
      // Explicitly chain: Add to existing faults
      const existing = this.faults.get(target) || []
      existing.push(fault)
      this.faults.set(target, existing)
    } else if (config.scope) {
      // Scoped faults coexist with other scoped faults that have different patterns
      // This allows multiple scoped faults on the same target for different operations
      const existing = this.faults.get(target) || []
      // Keep existing scoped faults, add new one
      existing.push(fault)
      this.faults.set(target, existing)
    } else {
      // No chain, no scope: Replace existing faults
      this.faults.set(target, [fault])
    }

    this.stats.activeFaults = this.countActiveFaults()

    // Handle eviction with interval
    if (target === 'do.eviction' && config.intervalMs && config.type === 'eviction') {
      this.setupEvictionInterval(config.intervalMs)
    }

    // Handle clock drift - track start time
    if (config.type === 'clock-drift' && this.clockDriftStartTime === null) {
      this.clockDriftStartTime = Date.now()
    }
  }

  /**
   * Clear a specific fault
   */
  clearFault(target: FaultTarget): void {
    this.faults.delete(target)
    this.stats.activeFaults = this.countActiveFaults()

    if (target === 'do.eviction' && this.evictionIntervalId) {
      clearInterval(this.evictionIntervalId)
      this.evictionIntervalId = null
    }

    if (target === 'clock.skew') {
      this.clockDriftStartTime = null
    }
  }

  /**
   * Clear all faults
   */
  clearAllFaults(): void {
    this.faults.clear()
    this.stats.activeFaults = 0

    if (this.evictionIntervalId) {
      clearInterval(this.evictionIntervalId)
      this.evictionIntervalId = null
    }

    this.clockDriftStartTime = null
  }

  /**
   * Check if a fault is injected on a target
   */
  isInjected(target: FaultTarget): boolean {
    const faults = this.faults.get(target)
    return !!faults && faults.length > 0
  }

  /**
   * List all injected faults
   */
  listFaults(): InjectedFault[] {
    const result: InjectedFault[] = []
    for (const faults of this.faults.values()) {
      result.push(...faults)
    }
    return result
  }

  /**
   * Get fault details by target
   */
  getFault(target: FaultTarget): InjectedFault | undefined {
    const faults = this.faults.get(target)
    return faults?.[0]
  }

  // ============================================================================
  // WRAPPER METHODS
  // ============================================================================

  /**
   * Wrap a pipeline with chaos injection
   */
  wrapPipeline(pipeline: Pipeline): Pipeline {
    return {
      send: async (batch: unknown[]) => {
        if (!this.enabled) {
          return pipeline.send(batch)
        }

        // Add timestamps if clock skew is active
        const clockFaults = this.faults.get('clock.skew')
        if (clockFaults && clockFaults.length > 0) {
          const skewedTime = this.getSkewedTime()
          batch = batch.map((event: any) => ({
            ...event,
            timestamp: new Date(skewedTime).toISOString(),
          }))
        }

        await this.maybeApplyFault('pipeline.send', undefined)
        return pipeline.send(batch)
      },
    }
  }

  /**
   * Wrap SQL storage with chaos injection
   */
  wrapSqlStorage(sqlStorage: SqlStorage | MockSqlStorage): SqlStorage | MockSqlStorage {
    return {
      ...sqlStorage,
      exec: async (sql: string, ...args: unknown[]) => {
        if (!this.enabled) {
          return (sqlStorage as any).exec(sql, ...args)
        }

        await this.maybeApplyFault('sql.exec', sql)
        return (sqlStorage as any).exec(sql, ...args)
      },
    }
  }

  /**
   * Wrap a clock with chaos injection
   */
  wrapClock(clock: Clock): Clock {
    return {
      now: () => {
        if (!this.enabled) {
          return clock.now()
        }

        return this.getSkewedTime()
      },
    }
  }

  // ============================================================================
  // EVICTION SIMULATION
  // ============================================================================

  /**
   * Trigger DO eviction
   */
  async triggerEviction(): Promise<void> {
    if (this.doState) {
      this.doState.triggerHibernation()
    }

    if (this.onEviction) {
      this.onEviction()
    }

    this.emit('eviction', { timestamp: Date.now() })
  }

  /**
   * Simulate wake-up from hibernation
   */
  async simulateWakeUp(): Promise<void> {
    const fault = this.getFault('do.eviction')
    const coldStartDelay = fault?.config.coldStartDelayMs || 0

    if (coldStartDelay > 0) {
      await this.delay(coldStartDelay)
    }

    if (this.doState) {
      this.doState.wake()
    }
  }

  // ============================================================================
  // STATS AND EVENTS
  // ============================================================================

  /**
   * Get chaos controller statistics
   */
  getStats(): ChaosStats {
    return { ...this.stats }
  }

  /**
   * Register an event handler
   */
  on(event: ChaosEventType, handler: Function): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      handlers.add(handler)
    }
  }

  // ============================================================================
  // PRESETS
  // ============================================================================

  /**
   * Apply a chaos scenario preset
   */
  applyPreset(name: string): void {
    switch (name) {
      case 'network-instability':
        this.injectFault('pipeline.send', {
          type: 'latency',
          delayMs: { min: 50, max: 200 },
          probability: 0.3,
        })
        this.injectFault('pipeline.send', {
          type: 'error',
          error: new Error('Network timeout'),
          probability: 0.1,
          chain: true,
        })
        this.injectFault('sql.exec', {
          type: 'latency',
          delayMs: { min: 10, max: 50 },
          probability: 0.2,
        })
        break
      case 'sql-instability':
        this.injectFault('sql.exec', {
          type: 'error',
          error: new Error('SQLITE_BUSY: database is locked'),
          probability: 0.2,
        })
        this.injectFault('sql.exec', {
          type: 'latency',
          delayMs: { min: 50, max: 500 },
          probability: 0.3,
        })
        break
      case 'eviction-stress':
        this.injectFault('do.eviction', {
          type: 'eviction',
          intervalMs: 5000,
          coldStartDelayMs: 1000,
        })
        break
      default:
        throw new ChaosError(`Unknown preset: ${name}`, name)
    }
  }

  // ============================================================================
  // CONTROL METHODS
  // ============================================================================

  /**
   * Enable chaos mode
   */
  enable(): void {
    this.enabled = true
  }

  /**
   * Disable chaos mode
   */
  disable(): void {
    this.enabled = false
  }

  /**
   * Check if chaos mode is enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Set the namespace for scoped faults
   */
  setNamespace(namespace: string): void {
    this.namespace = namespace
  }

  /**
   * Reset all faults and stats
   */
  reset(): void {
    this.clearAllFaults()
    this.stats = {
      totalFaultsTriggered: 0,
      faultsTriggered: {},
      activeFaults: 0,
      createdAt: Date.now(),
    }
    this.clockDriftStartTime = null
  }

  /**
   * Close the chaos controller
   */
  async close(): Promise<void> {
    this.clearAllFaults()
    this.closed = true
  }

  /**
   * Check if the controller is closed
   */
  isClosed(): boolean {
    return this.closed
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Maybe apply a fault based on configuration
   */
  private async maybeApplyFault(target: FaultTarget, context?: string): Promise<void> {
    const faults = this.faults.get(target)
    if (!faults || faults.length === 0) {
      return
    }

    for (const fault of faults) {
      const shouldApply = await this.shouldApplyFault(fault, context)
      if (shouldApply) {
        await this.applyFault(fault, context)
      }
    }
  }

  /**
   * Check if a fault should be applied
   */
  private async shouldApplyFault(fault: InjectedFault, context?: string): Promise<boolean> {
    const config = fault.config

    // Check probability
    if (config.probability !== undefined) {
      const rand = this.rng ? this.rng.next() : Math.random()
      if (rand >= config.probability) {
        return false
      }
    }

    // Check scope
    if (config.scope) {
      if (!this.matchesScope(config.scope, context)) {
        return false
      }
    }

    // Check max triggers
    if (config.maxTriggers !== undefined && fault.triggerCount >= config.maxTriggers) {
      // Auto-clear the fault
      this.removeFault(fault)
      return false
    }

    // Check duration
    if (config.durationMs !== undefined) {
      const elapsed = Date.now() - fault.injectedAt
      if (elapsed >= config.durationMs) {
        // Auto-clear the fault
        this.removeFault(fault)
        return false
      }
    }

    return true
  }

  /**
   * Apply a fault
   */
  private async applyFault(fault: InjectedFault, _context?: string): Promise<void> {
    const config = fault.config

    // Increment trigger count
    fault.triggerCount++
    this.stats.totalFaultsTriggered++
    this.stats.faultsTriggered[fault.target] = (this.stats.faultsTriggered[fault.target] || 0) + 1

    // Emit event
    this.emit('fault-triggered', {
      target: fault.target,
      config: fault.config,
      timestamp: Date.now(),
    })

    // Apply the fault
    switch (config.type) {
      case 'error':
        throw config.error || new Error(`Chaos error on ${fault.target}`)

      case 'latency':
        await this.delay(this.getDelayMs(config.delayMs))
        break

      case 'latency-then-error':
        await this.delay(this.getDelayMs(config.delayMs))
        throw config.error || new Error(`Chaos error after delay on ${fault.target}`)

      case 'eviction':
        // Eviction is handled separately via triggerEviction()
        break

      case 'clock-skew':
      case 'clock-drift':
        // Clock manipulation is handled in wrapClock()
        break
    }
  }

  /**
   * Check if context matches scope
   */
  private matchesScope(scope: FaultScope, context?: string): boolean {
    // Check pattern
    if (scope.pattern && context) {
      if (!scope.pattern.test(context)) {
        return false
      }
    }

    // Check tables
    if (scope.tables && context) {
      const matchesTable = scope.tables.some((table) => {
        // Match table name in SQL context
        const tablePattern = new RegExp(`\\b${table}\\b`, 'i')
        return tablePattern.test(context)
      })
      if (!matchesTable) {
        return false
      }
    }

    // Check time window
    if (scope.startTime !== undefined || scope.endTime !== undefined) {
      const now = Date.now()
      if (scope.startTime !== undefined && now < scope.startTime) {
        return false
      }
      if (scope.endTime !== undefined && now > scope.endTime) {
        return false
      }
    }

    // Check namespaces
    if (scope.namespaces) {
      if (!scope.namespaces.includes(this.namespace)) {
        return false
      }
    }

    return true
  }

  /**
   * Remove a specific fault
   */
  private removeFault(fault: InjectedFault): void {
    const faults = this.faults.get(fault.target)
    if (faults) {
      const index = faults.findIndex((f) => f.id === fault.id)
      if (index !== -1) {
        faults.splice(index, 1)
        if (faults.length === 0) {
          this.faults.delete(fault.target)
        }
      }
    }
    this.stats.activeFaults = this.countActiveFaults()
  }

  /**
   * Get delay in milliseconds from config
   */
  private getDelayMs(delayMs?: DelayConfig): number {
    if (delayMs === undefined) {
      return 0
    }
    if (typeof delayMs === 'number') {
      return delayMs
    }
    // Random delay within range
    const rand = this.rng ? this.rng.next() : Math.random()
    return Math.floor(delayMs.min + rand * (delayMs.max - delayMs.min))
  }

  /**
   * Get skewed time based on clock faults
   */
  private getSkewedTime(): number {
    const baseTime = Date.now()
    const clockFaults = this.faults.get('clock.skew')

    if (!clockFaults || clockFaults.length === 0) {
      return baseTime
    }

    let totalOffset = 0

    for (const fault of clockFaults) {
      if (fault.config.type === 'clock-skew' && fault.config.offsetMs !== undefined) {
        totalOffset += fault.config.offsetMs
      } else if (fault.config.type === 'clock-drift' && fault.config.driftRateMs !== undefined) {
        // Calculate drift based on elapsed time since fault was injected
        const startTime = this.clockDriftStartTime || fault.injectedAt
        const elapsedSeconds = (baseTime - startTime) / 1000
        totalOffset += Math.floor(elapsedSeconds * fault.config.driftRateMs)
      }
    }

    return baseTime + totalOffset
  }

  /**
   * Setup eviction interval
   */
  private setupEvictionInterval(intervalMs: number): void {
    if (this.evictionIntervalId) {
      clearInterval(this.evictionIntervalId)
    }

    this.evictionIntervalId = setInterval(() => {
      this.triggerEviction()
    }, intervalMs)
  }

  /**
   * Emit an event to registered handlers
   */
  private emit(event: ChaosEventType, payload: FaultTriggeredEvent | EvictionEvent): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      for (const handler of handlers) {
        handler(payload)
      }
    }
  }

  /**
   * Count active faults
   */
  private countActiveFaults(): number {
    let count = 0
    for (const faults of this.faults.values()) {
      count += faults.length
    }
    return count
  }

  /**
   * Delay helper that works with fake timers.
   * Uses setTimeout which integrates with vitest fake timers.
   */
  private delay(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve()
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// Type for mock SQL storage
interface MockSqlStorage {
  exec: (sql: string, ...args: unknown[]) => Promise<{ rows: unknown[]; changes: number }>
  queries: string[]
  setFail: (fail: boolean, error?: Error) => void
  setLatency: (ms: number) => void
  clear: () => void
}
