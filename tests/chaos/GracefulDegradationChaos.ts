/**
 * Chaos Testing Utilities for Graceful Degradation
 *
 * Specialized chaos injection tools for testing graceful degradation scenarios:
 * - Random DO failures during operations
 * - Network partition scenarios
 * - Gradual performance degradation
 * - Recovery from multiple concurrent failures
 *
 * ## Usage Patterns
 *
 * ### 1. Random DO Failures
 * ```typescript
 * import { DOFailureSimulator } from '../tests/chaos'
 *
 * const doFailure = new DOFailureSimulator()
 * doFailure.configure({
 *   doId: 'customer-do',
 *   normalFailureProbability: 0.3,
 *   recoveryFailureProbability: 0.7,
 *   errorType: 'timeout'
 * })
 *
 * // Wrap DO operations
 * const result = await doFailure.simulateRequest('customer-do', async () => {
 *   return stub.fetch(request)
 * })
 * ```
 *
 * ### 2. Gradual Degradation
 * ```typescript
 * import { GradualDegradationSimulator } from '../tests/chaos'
 *
 * const degradation = new GradualDegradationSimulator({
 *   phaseDurationMs: 5000,
 *   autoProgress: true,
 *   onPhaseChange: (phase, prev) => console.log(`Phase: ${prev} -> ${phase}`)
 * })
 *
 * degradation.startDegradation()
 *
 * // Operations experience increasing latency and failures
 * const result = await degradation.wrap(async () => doOperation())
 * console.log(`Phase: ${result.phase}, Latency: ${result.latencyMs}ms`)
 *
 * // Later: trigger recovery
 * degradation.startRecovery()
 * ```
 *
 * ### 3. Concurrent Failures
 * ```typescript
 * import { ConcurrentFailureSimulator } from '../tests/chaos'
 *
 * const concurrent = new ConcurrentFailureSimulator({
 *   concurrentFailures: 3,
 *   services: ['db-primary', 'db-replica', 'cache', 'api'],
 *   failureMode: 'cascading',
 *   cascadeDelayMs: 1000,
 *   onServiceFail: (svc) => console.log(`Service failed: ${svc}`)
 * })
 *
 * await concurrent.startFailures()
 *
 * // Check service availability
 * if (concurrent.isServiceFailed('db-primary')) {
 *   // Use replica
 * }
 *
 * // Trigger recovery
 * await concurrent.startRecovery()
 * ```
 *
 * ### 4. Circuit Breaker Chaos
 * ```typescript
 * import { CircuitBreakerChaosWrapper } from '../tests/chaos'
 *
 * // Force circuit to specific state
 * const chaos = new CircuitBreakerChaosWrapper({
 *   forceState: 'open'
 * })
 *
 * // Or simulate flapping
 * const flappingChaos = new CircuitBreakerChaosWrapper({
 *   enableFlapping: true,
 *   flappingIntervalMs: 1000
 * })
 *
 * // Add recovery delay
 * await chaos.applyRecoveryDelay()
 * ```
 *
 * ## Integration with Graceful Degradation Handler
 *
 * ```typescript
 * import { createEnhancedGracefulDegradationHandler } from '../../do/graceful-degradation'
 * import { DOFailureSimulator, NetworkPartitionSimulator } from '../tests/chaos'
 *
 * const handler = createEnhancedGracefulDegradationHandler({
 *   circuitBreakerConfig: { failureThreshold: 3 }
 * })
 *
 * const doFailure = new DOFailureSimulator()
 * doFailure.configure({ doId: 'test', normalFailureProbability: 0.5 })
 *
 * // Test graceful degradation behavior
 * const { response, status } = await handler.executeRequest('test', request, async () => {
 *   const result = await doFailure.simulateRequest('test', async () => {
 *     return new Response('OK', { status: 200 })
 *   })
 *   if (!result.success) throw result.error
 *   return result.result!
 * })
 *
 * // Check degradation status
 * console.log(`Mode: ${status.mode}, Circuit: ${status.circuitState}`)
 * ```
 *
 * @module tests/chaos/GracefulDegradationChaos
 * @see do-g63y
 */

import type { CircuitState } from '../../do/circuit-breaker'

// ============================================================================
// DO Failure Simulator
// ============================================================================

/**
 * Configuration for DO failure scenarios
 */
export interface DOFailureConfig {
  /** Node/DO identifier */
  doId: string

  /** Failure probability during normal operation (0-1) */
  normalFailureProbability?: number

  /** Failure probability during recovery (0-1) */
  recoveryFailureProbability?: number

  /** Error type to simulate */
  errorType?: 'timeout' | 'unavailable' | 'internal_error' | 'rate_limited'

  /** Custom error message */
  errorMessage?: string

  /** Latency to add before failure (ms) */
  failureLatencyMs?: number

  /** Whether DO is in maintenance mode */
  maintenanceMode?: boolean

  /** Scheduled failure windows (start/end timestamps) */
  failureWindows?: Array<{ start: number; end: number }>
}

/**
 * Statistics for DO failure simulation
 */
export interface DOFailureStats {
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  timeoutFailures: number
  unavailableFailures: number
  internalErrors: number
  rateLimitedFailures: number
  maintenanceRejections: number
  scheduledFailures: number
  avgFailureLatencyMs: number
}

/**
 * DOFailureSimulator - Simulates various DO failure scenarios
 *
 * Useful for testing:
 * - Random DO failures during operations
 * - Maintenance windows
 * - Rate limiting
 * - Timeout scenarios
 *
 * @example
 * ```typescript
 * const simulator = new DOFailureSimulator()
 *
 * // Configure a flaky DO
 * simulator.configure({
 *   doId: 'customer-do',
 *   normalFailureProbability: 0.3,
 *   errorType: 'timeout'
 * })
 *
 * // Simulate request
 * const result = await simulator.simulateRequest('customer-do', async () => {
 *   return stub.fetch(request)
 * })
 * ```
 */
export class DOFailureSimulator {
  private configs: Map<string, DOFailureConfig> = new Map()
  private stats: Map<string, DOFailureStats> = new Map()
  private enabled = true

  /**
   * Configure a DO for failure simulation
   */
  configure(config: DOFailureConfig): void {
    this.configs.set(config.doId, config)
    if (!this.stats.has(config.doId)) {
      this.stats.set(config.doId, this.createEmptyStats())
    }
  }

  /**
   * Remove DO configuration
   */
  unconfigure(doId: string): void {
    this.configs.delete(doId)
  }

  /**
   * Enable simulation
   */
  enable(): void {
    this.enabled = true
  }

  /**
   * Disable simulation
   */
  disable(): void {
    this.enabled = false
  }

  /**
   * Check if simulation is enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Simulate a request to a DO with potential failures
   */
  async simulateRequest<T>(
    doId: string,
    operation: () => Promise<T>,
    isRecovery = false
  ): Promise<{
    success: boolean
    result?: T
    error?: Error
    errorType?: DOFailureConfig['errorType']
    latencyMs: number
  }> {
    const config = this.configs.get(doId)
    const statsEntry = this.getOrCreateStats(doId)
    const startTime = Date.now()

    statsEntry.totalRequests++

    if (!this.enabled || !config) {
      try {
        const result = await operation()
        statsEntry.successfulRequests++
        return { success: true, result, latencyMs: Date.now() - startTime }
      } catch (error) {
        statsEntry.failedRequests++
        return {
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          latencyMs: Date.now() - startTime,
        }
      }
    }

    // Check maintenance mode
    if (config.maintenanceMode) {
      statsEntry.maintenanceRejections++
      statsEntry.failedRequests++
      return {
        success: false,
        error: new Error('DO is in maintenance mode'),
        errorType: 'unavailable',
        latencyMs: Date.now() - startTime,
      }
    }

    // Check scheduled failure windows
    const now = Date.now()
    if (config.failureWindows?.some((w) => now >= w.start && now <= w.end)) {
      statsEntry.scheduledFailures++
      statsEntry.failedRequests++
      return {
        success: false,
        error: new Error('Scheduled maintenance window'),
        errorType: 'unavailable',
        latencyMs: Date.now() - startTime,
      }
    }

    // Determine failure probability based on mode
    const failureProbability = isRecovery
      ? (config.recoveryFailureProbability ?? config.normalFailureProbability ?? 0)
      : (config.normalFailureProbability ?? 0)

    // Check if we should inject a failure
    if (Math.random() < failureProbability) {
      // Apply failure latency if configured
      if (config.failureLatencyMs) {
        await this.delay(config.failureLatencyMs)
      }

      const errorType = config.errorType ?? 'internal_error'
      const error = this.createError(errorType, config.errorMessage)

      statsEntry.failedRequests++
      this.incrementErrorTypeCount(statsEntry, errorType)

      return {
        success: false,
        error,
        errorType,
        latencyMs: Date.now() - startTime,
      }
    }

    // Execute the actual operation
    try {
      const result = await operation()
      statsEntry.successfulRequests++
      return { success: true, result, latencyMs: Date.now() - startTime }
    } catch (error) {
      statsEntry.failedRequests++
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        latencyMs: Date.now() - startTime,
      }
    }
  }

  /**
   * Set maintenance mode for a DO
   */
  setMaintenanceMode(doId: string, enabled: boolean): void {
    const config = this.configs.get(doId)
    if (config) {
      config.maintenanceMode = enabled
    }
  }

  /**
   * Add a scheduled failure window
   */
  addFailureWindow(doId: string, start: number, end: number): void {
    const config = this.configs.get(doId)
    if (config) {
      if (!config.failureWindows) {
        config.failureWindows = []
      }
      config.failureWindows.push({ start, end })
    }
  }

  /**
   * Get statistics for a DO
   */
  getStats(doId: string): DOFailureStats {
    return { ...this.getOrCreateStats(doId) }
  }

  /**
   * Get all statistics
   */
  getAllStats(): Map<string, DOFailureStats> {
    return new Map(this.stats)
  }

  /**
   * Reset statistics for a DO
   */
  resetStats(doId: string): void {
    this.stats.set(doId, this.createEmptyStats())
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.configs.clear()
    this.stats.clear()
    this.enabled = true
  }

  private createEmptyStats(): DOFailureStats {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      timeoutFailures: 0,
      unavailableFailures: 0,
      internalErrors: 0,
      rateLimitedFailures: 0,
      maintenanceRejections: 0,
      scheduledFailures: 0,
      avgFailureLatencyMs: 0,
    }
  }

  private getOrCreateStats(doId: string): DOFailureStats {
    if (!this.stats.has(doId)) {
      this.stats.set(doId, this.createEmptyStats())
    }
    return this.stats.get(doId)!
  }

  private createError(
    errorType: DOFailureConfig['errorType'],
    customMessage?: string
  ): Error {
    const messages: Record<NonNullable<DOFailureConfig['errorType']>, string> = {
      timeout: 'DO request timed out',
      unavailable: 'DO is unavailable',
      internal_error: 'Internal DO error',
      rate_limited: 'DO rate limit exceeded',
    }

    const error = new Error(customMessage ?? messages[errorType ?? 'internal_error'])
    ;(error as Error & { code: string }).code = `DO_${(errorType ?? 'internal_error').toUpperCase()}`
    return error
  }

  private incrementErrorTypeCount(
    stats: DOFailureStats,
    errorType: DOFailureConfig['errorType']
  ): void {
    switch (errorType) {
      case 'timeout':
        stats.timeoutFailures++
        break
      case 'unavailable':
        stats.unavailableFailures++
        break
      case 'internal_error':
        stats.internalErrors++
        break
      case 'rate_limited':
        stats.rateLimitedFailures++
        break
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================================
// Gradual Degradation Simulator
// ============================================================================

/**
 * Phase of gradual degradation
 */
export type DegradationPhase =
  | 'healthy' // Normal operation
  | 'warning' // Performance starting to degrade
  | 'degraded' // Significantly degraded
  | 'critical' // Near failure
  | 'failing' // Active failures
  | 'recovering' // Coming back from failure

/**
 * Configuration for gradual degradation simulation
 */
export interface GradualDegradationConfig {
  /** Duration of each phase in ms */
  phaseDurationMs?: number

  /** Latency multiplier per phase */
  latencyMultipliers?: Record<DegradationPhase, number>

  /** Failure probability per phase */
  failureProbabilities?: Record<DegradationPhase, number>

  /** Callback when phase changes */
  onPhaseChange?: (phase: DegradationPhase, previousPhase: DegradationPhase) => void

  /** Whether to auto-progress through phases */
  autoProgress?: boolean

  /** Recovery rate (how fast to recover, 0-1) */
  recoveryRate?: number
}

/**
 * Statistics for gradual degradation
 */
export interface GradualDegradationStats {
  currentPhase: DegradationPhase
  phaseStartTime: number
  phaseDuration: number
  requestsInPhase: number
  failuresInPhase: number
  totalLatencyMs: number
  phaseHistory: Array<{ phase: DegradationPhase; duration: number; failures: number }>
}

/**
 * GradualDegradationSimulator - Simulates gradual system degradation
 *
 * Useful for testing:
 * - Progressive failure detection
 * - Graceful degradation response
 * - Recovery patterns
 *
 * @example
 * ```typescript
 * const degradation = new GradualDegradationSimulator({
 *   phaseDurationMs: 5000,
 *   autoProgress: true
 * })
 *
 * // Start degradation sequence
 * degradation.startDegradation()
 *
 * // Operations will experience increasing latency and failure rates
 * const { result, latencyMs } = await degradation.wrap(async () => {
 *   return stub.fetch(request)
 * })
 * ```
 */
export class GradualDegradationSimulator {
  private currentPhase: DegradationPhase = 'healthy'
  private phaseStartTime = Date.now()
  private config: Required<GradualDegradationConfig>
  private progressionTimer: ReturnType<typeof setTimeout> | null = null
  private enabled = true

  private stats: GradualDegradationStats = {
    currentPhase: 'healthy',
    phaseStartTime: Date.now(),
    phaseDuration: 0,
    requestsInPhase: 0,
    failuresInPhase: 0,
    totalLatencyMs: 0,
    phaseHistory: [],
  }

  // Default latency multipliers per phase
  private static readonly DEFAULT_LATENCY_MULTIPLIERS: Record<DegradationPhase, number> = {
    healthy: 1,
    warning: 1.5,
    degraded: 3,
    critical: 5,
    failing: 10,
    recovering: 2,
  }

  // Default failure probabilities per phase
  private static readonly DEFAULT_FAILURE_PROBABILITIES: Record<DegradationPhase, number> = {
    healthy: 0,
    warning: 0.05,
    degraded: 0.2,
    critical: 0.5,
    failing: 0.8,
    recovering: 0.15,
  }

  // Degradation progression order
  private static readonly DEGRADATION_ORDER: DegradationPhase[] = [
    'healthy',
    'warning',
    'degraded',
    'critical',
    'failing',
  ]

  // Recovery progression order
  private static readonly RECOVERY_ORDER: DegradationPhase[] = [
    'failing',
    'recovering',
    'degraded',
    'warning',
    'healthy',
  ]

  constructor(config: GradualDegradationConfig = {}) {
    this.config = {
      phaseDurationMs: config.phaseDurationMs ?? 10000,
      latencyMultipliers:
        config.latencyMultipliers ?? GradualDegradationSimulator.DEFAULT_LATENCY_MULTIPLIERS,
      failureProbabilities:
        config.failureProbabilities ?? GradualDegradationSimulator.DEFAULT_FAILURE_PROBABILITIES,
      onPhaseChange: config.onPhaseChange ?? (() => {}),
      autoProgress: config.autoProgress ?? false,
      recoveryRate: config.recoveryRate ?? 0.5,
    }
  }

  /**
   * Get current degradation phase
   */
  getPhase(): DegradationPhase {
    return this.currentPhase
  }

  /**
   * Get time spent in current phase
   */
  getPhaseElapsedMs(): number {
    return Date.now() - this.phaseStartTime
  }

  /**
   * Start degradation sequence
   */
  startDegradation(): void {
    this.setPhase('warning')

    if (this.config.autoProgress) {
      this.scheduleProgression()
    }
  }

  /**
   * Start recovery sequence
   */
  startRecovery(): void {
    if (this.progressionTimer) {
      clearTimeout(this.progressionTimer)
      this.progressionTimer = null
    }

    this.setPhase('recovering')

    if (this.config.autoProgress) {
      this.scheduleRecovery()
    }
  }

  /**
   * Set degradation phase directly
   */
  setPhase(phase: DegradationPhase): void {
    if (phase !== this.currentPhase) {
      const previousPhase = this.currentPhase

      // Record history
      this.stats.phaseHistory.push({
        phase: previousPhase,
        duration: Date.now() - this.phaseStartTime,
        failures: this.stats.failuresInPhase,
      })

      // Update state
      this.currentPhase = phase
      this.phaseStartTime = Date.now()
      this.stats.currentPhase = phase
      this.stats.phaseStartTime = this.phaseStartTime
      this.stats.requestsInPhase = 0
      this.stats.failuresInPhase = 0

      this.config.onPhaseChange(phase, previousPhase)
    }
  }

  /**
   * Progress to next degradation phase
   */
  progressDegradation(): boolean {
    const currentIndex = GradualDegradationSimulator.DEGRADATION_ORDER.indexOf(this.currentPhase)
    if (currentIndex < GradualDegradationSimulator.DEGRADATION_ORDER.length - 1) {
      this.setPhase(GradualDegradationSimulator.DEGRADATION_ORDER[currentIndex + 1])
      return true
    }
    return false
  }

  /**
   * Progress recovery to next phase
   */
  progressRecovery(): boolean {
    const currentIndex = GradualDegradationSimulator.RECOVERY_ORDER.indexOf(this.currentPhase)
    if (currentIndex < GradualDegradationSimulator.RECOVERY_ORDER.length - 1) {
      this.setPhase(GradualDegradationSimulator.RECOVERY_ORDER[currentIndex + 1])
      return true
    }
    return false
  }

  /**
   * Wrap an operation with degradation simulation
   */
  async wrap<T>(operation: () => Promise<T>): Promise<{
    success: boolean
    result?: T
    error?: Error
    latencyMs: number
    phase: DegradationPhase
  }> {
    this.stats.requestsInPhase++

    if (!this.enabled) {
      const startTime = Date.now()
      try {
        const result = await operation()
        return {
          success: true,
          result,
          latencyMs: Date.now() - startTime,
          phase: this.currentPhase,
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          latencyMs: Date.now() - startTime,
          phase: this.currentPhase,
        }
      }
    }

    const latencyMultiplier = this.config.latencyMultipliers[this.currentPhase]
    const failureProbability = this.config.failureProbabilities[this.currentPhase]

    const startTime = Date.now()

    // Check for failure injection
    if (Math.random() < failureProbability) {
      // Add degradation-related latency before failure
      const failureDelay = Math.random() * 100 * latencyMultiplier
      await this.delay(failureDelay)

      this.stats.failuresInPhase++
      return {
        success: false,
        error: new Error(`Degradation-induced failure in ${this.currentPhase} phase`),
        latencyMs: Date.now() - startTime,
        phase: this.currentPhase,
      }
    }

    // Execute with added latency
    try {
      const result = await operation()
      const actualLatency = Date.now() - startTime
      const additionalLatency = actualLatency * (latencyMultiplier - 1)
      await this.delay(additionalLatency)

      const totalLatency = Date.now() - startTime
      this.stats.totalLatencyMs += totalLatency

      return {
        success: true,
        result,
        latencyMs: totalLatency,
        phase: this.currentPhase,
      }
    } catch (error) {
      this.stats.failuresInPhase++
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        latencyMs: Date.now() - startTime,
        phase: this.currentPhase,
      }
    }
  }

  /**
   * Get degradation statistics
   */
  getStats(): GradualDegradationStats {
    return {
      ...this.stats,
      phaseDuration: Date.now() - this.phaseStartTime,
    }
  }

  /**
   * Enable degradation simulation
   */
  enable(): void {
    this.enabled = true
  }

  /**
   * Disable degradation simulation
   */
  disable(): void {
    this.enabled = false
  }

  /**
   * Check if enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Reset to healthy state
   */
  reset(): void {
    if (this.progressionTimer) {
      clearTimeout(this.progressionTimer)
      this.progressionTimer = null
    }

    this.currentPhase = 'healthy'
    this.phaseStartTime = Date.now()
    this.enabled = true
    this.stats = {
      currentPhase: 'healthy',
      phaseStartTime: Date.now(),
      phaseDuration: 0,
      requestsInPhase: 0,
      failuresInPhase: 0,
      totalLatencyMs: 0,
      phaseHistory: [],
    }
  }

  private scheduleProgression(): void {
    this.progressionTimer = setTimeout(() => {
      if (this.progressDegradation()) {
        this.scheduleProgression()
      }
    }, this.config.phaseDurationMs)
  }

  private scheduleRecovery(): void {
    // Recovery is faster based on recovery rate
    const recoveryDuration = this.config.phaseDurationMs * this.config.recoveryRate

    this.progressionTimer = setTimeout(() => {
      if (this.progressRecovery()) {
        this.scheduleRecovery()
      }
    }, recoveryDuration)
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================================
// Concurrent Failure Simulator
// ============================================================================

/**
 * Configuration for concurrent failure simulation
 */
export interface ConcurrentFailureConfig {
  /** Number of concurrent failures to simulate */
  concurrentFailures: number

  /** Services/DOs to fail concurrently */
  services: string[]

  /** Failure mode */
  failureMode: 'random' | 'sequential' | 'simultaneous' | 'cascading'

  /** Delay between failures in cascading mode (ms) */
  cascadeDelayMs?: number

  /** Duration of failures (ms) */
  failureDurationMs?: number

  /** Recovery mode */
  recoveryMode?: 'random' | 'sequential' | 'simultaneous'

  /** Callback when a service fails */
  onServiceFail?: (service: string, index: number) => void

  /** Callback when a service recovers */
  onServiceRecover?: (service: string, index: number) => void
}

/**
 * Statistics for concurrent failure simulation
 */
export interface ConcurrentFailureStats {
  totalFailures: number
  currentlyFailed: string[]
  failureHistory: Array<{
    service: string
    failedAt: number
    recoveredAt: number | null
  }>
  maxConcurrentFailures: number
  avgRecoveryTimeMs: number
}

/**
 * ConcurrentFailureSimulator - Simulates multiple concurrent service failures
 *
 * Useful for testing:
 * - Multi-service failure handling
 * - Cascading failures
 * - Recovery prioritization
 *
 * @example
 * ```typescript
 * const simulator = new ConcurrentFailureSimulator({
 *   concurrentFailures: 3,
 *   services: ['db-1', 'db-2', 'cache-1', 'api-gateway'],
 *   failureMode: 'cascading',
 *   cascadeDelayMs: 1000
 * })
 *
 * // Start concurrent failures
 * await simulator.startFailures()
 *
 * // Check which services are currently failed
 * const failed = simulator.getFailedServices()
 * ```
 */
export class ConcurrentFailureSimulator {
  private config: ConcurrentFailureConfig
  private failedServices: Set<string> = new Set()
  private failureTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private enabled = true

  private stats: ConcurrentFailureStats = {
    totalFailures: 0,
    currentlyFailed: [],
    failureHistory: [],
    maxConcurrentFailures: 0,
    avgRecoveryTimeMs: 0,
  }

  constructor(config: ConcurrentFailureConfig) {
    this.config = {
      cascadeDelayMs: 1000,
      failureDurationMs: 30000,
      recoveryMode: 'sequential',
      ...config,
    }
  }

  /**
   * Start the failure simulation
   */
  async startFailures(): Promise<void> {
    if (!this.enabled) return

    const servicesToFail = this.selectServicesToFail()

    switch (this.config.failureMode) {
      case 'simultaneous':
        await this.failSimultaneously(servicesToFail)
        break
      case 'sequential':
        await this.failSequentially(servicesToFail)
        break
      case 'cascading':
        await this.failCascading(servicesToFail)
        break
      case 'random':
      default:
        await this.failRandom(servicesToFail)
        break
    }
  }

  /**
   * Start recovery process
   */
  async startRecovery(): Promise<void> {
    const failedServices = Array.from(this.failedServices)

    switch (this.config.recoveryMode) {
      case 'simultaneous':
        await this.recoverSimultaneously(failedServices)
        break
      case 'random':
        await this.recoverRandom(failedServices)
        break
      case 'sequential':
      default:
        await this.recoverSequentially(failedServices)
        break
    }
  }

  /**
   * Check if a service is currently failed
   */
  isServiceFailed(service: string): boolean {
    return this.failedServices.has(service)
  }

  /**
   * Get list of currently failed services
   */
  getFailedServices(): string[] {
    return Array.from(this.failedServices)
  }

  /**
   * Get count of currently failed services
   */
  getFailedCount(): number {
    return this.failedServices.size
  }

  /**
   * Manually fail a service
   */
  failService(service: string): void {
    if (!this.failedServices.has(service)) {
      this.failedServices.add(service)
      this.stats.totalFailures++
      this.stats.currentlyFailed = Array.from(this.failedServices)
      this.stats.maxConcurrentFailures = Math.max(
        this.stats.maxConcurrentFailures,
        this.failedServices.size
      )
      this.stats.failureHistory.push({
        service,
        failedAt: Date.now(),
        recoveredAt: null,
      })

      if (this.config.onServiceFail) {
        this.config.onServiceFail(service, this.stats.totalFailures)
      }

      // Schedule auto-recovery if duration is set
      if (this.config.failureDurationMs) {
        const timer = setTimeout(() => {
          this.recoverService(service)
        }, this.config.failureDurationMs)
        this.failureTimers.set(service, timer)
      }
    }
  }

  /**
   * Manually recover a service
   */
  recoverService(service: string): void {
    if (this.failedServices.has(service)) {
      this.failedServices.delete(service)
      this.stats.currentlyFailed = Array.from(this.failedServices)

      // Clear any pending timer
      const timer = this.failureTimers.get(service)
      if (timer) {
        clearTimeout(timer)
        this.failureTimers.delete(service)
      }

      // Update failure history
      const historyEntry = this.stats.failureHistory.find(
        (h) => h.service === service && h.recoveredAt === null
      )
      if (historyEntry) {
        historyEntry.recoveredAt = Date.now()
      }

      // Update avg recovery time
      const recoveredEntries = this.stats.failureHistory.filter((h) => h.recoveredAt !== null)
      if (recoveredEntries.length > 0) {
        const totalRecoveryTime = recoveredEntries.reduce(
          (sum, h) => sum + (h.recoveredAt! - h.failedAt),
          0
        )
        this.stats.avgRecoveryTimeMs = totalRecoveryTime / recoveredEntries.length
      }

      if (this.config.onServiceRecover) {
        this.config.onServiceRecover(service, this.failedServices.size)
      }
    }
  }

  /**
   * Get statistics
   */
  getStats(): ConcurrentFailureStats {
    return { ...this.stats }
  }

  /**
   * Enable simulation
   */
  enable(): void {
    this.enabled = true
  }

  /**
   * Disable simulation
   */
  disable(): void {
    this.enabled = false
  }

  /**
   * Check if enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Reset all state
   */
  reset(): void {
    // Clear all timers
    for (const timer of this.failureTimers.values()) {
      clearTimeout(timer)
    }
    this.failureTimers.clear()
    this.failedServices.clear()
    this.enabled = true
    this.stats = {
      totalFailures: 0,
      currentlyFailed: [],
      failureHistory: [],
      maxConcurrentFailures: 0,
      avgRecoveryTimeMs: 0,
    }
  }

  private selectServicesToFail(): string[] {
    const count = Math.min(this.config.concurrentFailures, this.config.services.length)
    const shuffled = [...this.config.services].sort(() => Math.random() - 0.5)
    return shuffled.slice(0, count)
  }

  private async failSimultaneously(services: string[]): Promise<void> {
    services.forEach((service) => this.failService(service))
  }

  private async failSequentially(services: string[]): Promise<void> {
    for (const service of services) {
      this.failService(service)
    }
  }

  private async failCascading(services: string[]): Promise<void> {
    for (let i = 0; i < services.length; i++) {
      this.failService(services[i])
      if (i < services.length - 1) {
        await this.delay(this.config.cascadeDelayMs ?? 1000)
      }
    }
  }

  private async failRandom(services: string[]): Promise<void> {
    const shuffled = services.sort(() => Math.random() - 0.5)
    for (const service of shuffled) {
      this.failService(service)
      await this.delay(Math.random() * 500)
    }
  }

  private async recoverSimultaneously(services: string[]): Promise<void> {
    services.forEach((service) => this.recoverService(service))
  }

  private async recoverSequentially(services: string[]): Promise<void> {
    for (const service of services) {
      this.recoverService(service)
      await this.delay(500)
    }
  }

  private async recoverRandom(services: string[]): Promise<void> {
    const shuffled = services.sort(() => Math.random() - 0.5)
    for (const service of shuffled) {
      this.recoverService(service)
      await this.delay(Math.random() * 1000)
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================================
// Circuit Breaker Chaos Wrapper
// ============================================================================

/**
 * Configuration for circuit breaker chaos testing
 */
export interface CircuitBreakerChaosConfig {
  /** Force circuit to specific state */
  forceState?: CircuitState

  /** Probability of state transitions (0-1) */
  stateTransitionProbability?: number

  /** Simulate slow recovery */
  slowRecoveryMs?: number

  /** Simulate flapping (rapid open/close) */
  enableFlapping?: boolean

  /** Flapping interval (ms) */
  flappingIntervalMs?: number
}

/**
 * CircuitBreakerChaosWrapper - Wraps circuit breaker with chaos injection
 *
 * @example
 * ```typescript
 * const chaos = new CircuitBreakerChaosWrapper({
 *   enableFlapping: true,
 *   flappingIntervalMs: 1000
 * })
 *
 * // Wrap circuit breaker operations
 * const result = await chaos.wrapExecution(circuit, operation)
 * ```
 */
export class CircuitBreakerChaosWrapper {
  private config: CircuitBreakerChaosConfig
  private flappingTimer: ReturnType<typeof setInterval> | null = null
  private currentForcedState: CircuitState | null = null

  constructor(config: CircuitBreakerChaosConfig = {}) {
    this.config = {
      stateTransitionProbability: 0.1,
      slowRecoveryMs: 0,
      enableFlapping: false,
      flappingIntervalMs: 1000,
      ...config,
    }

    if (this.config.enableFlapping) {
      this.startFlapping()
    }
  }

  /**
   * Get the current forced state (if any)
   */
  getForcedState(): CircuitState | null {
    return this.config.forceState ?? this.currentForcedState
  }

  /**
   * Should the circuit be forced to a specific state?
   */
  shouldForceState(): boolean {
    return this.getForcedState() !== null
  }

  /**
   * Get forced state or check if random transition should occur
   */
  getEffectiveState(actualState: CircuitState): CircuitState {
    const forcedState = this.getForcedState()
    if (forcedState) {
      return forcedState
    }

    // Random state transitions
    if (
      this.config.stateTransitionProbability &&
      Math.random() < this.config.stateTransitionProbability
    ) {
      const states: CircuitState[] = ['closed', 'open', 'half_open']
      return states[Math.floor(Math.random() * states.length)]
    }

    return actualState
  }

  /**
   * Add delay to simulate slow recovery
   */
  async applyRecoveryDelay(): Promise<void> {
    if (this.config.slowRecoveryMs && this.config.slowRecoveryMs > 0) {
      await this.delay(this.config.slowRecoveryMs)
    }
  }

  /**
   * Start flapping behavior
   */
  startFlapping(): void {
    if (this.flappingTimer) return

    this.flappingTimer = setInterval(() => {
      // Toggle between open and closed
      if (this.currentForcedState === 'open') {
        this.currentForcedState = 'closed'
      } else {
        this.currentForcedState = 'open'
      }
    }, this.config.flappingIntervalMs)
  }

  /**
   * Stop flapping behavior
   */
  stopFlapping(): void {
    if (this.flappingTimer) {
      clearInterval(this.flappingTimer)
      this.flappingTimer = null
      this.currentForcedState = null
    }
  }

  /**
   * Reset all chaos settings
   */
  reset(): void {
    this.stopFlapping()
    this.currentForcedState = null
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

