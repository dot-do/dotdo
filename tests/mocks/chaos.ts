/**
 * Mock Chaos Infrastructure for Testing
 *
 * Provides mock implementations of chaos testing utilities for use in unit
 * and integration tests. Simulates network partitions, DO crashes, and
 * pipeline backpressure without actual infrastructure failures.
 *
 * @see types/Chaos.ts for type definitions
 * @task dotdo-ga1r (ACID Phase 6 - Failure Injection)
 */

import { vi, type Mock } from 'vitest'
import type {
  ChaosController,
  ChaosState,
  NetworkPartitionConfig,
  NetworkPartitionResult,
  DOCrashConfig,
  DOCrashResult,
  BackpressureConfig,
  BackpressureResult,
  BackpressureStats,
  ChaosScenario,
  ChaosExecutionResult,
  FailureInjection,
  FailureExecutionResult,
  FailureEffect,
  AssertionResult,
  ChaosAssertion,
  RecoveryStatus,
  RecoveryError,
} from '../../types/Chaos'

// ============================================================================
// Mock Network Partition Manager
// ============================================================================

export interface MockNetworkPartitionManager {
  /** Create a network partition */
  partition(config: NetworkPartitionConfig): NetworkPartitionResult
  /** Check if a node is partitioned */
  isPartitioned(nodeId: string): boolean
  /** Get partition affecting a node */
  getPartition(nodeId: string): NetworkPartitionResult | undefined
  /** Heal a partition */
  heal(partitionId: string): void
  /** Simulate request through partition */
  simulateRequest(fromNode: string, toNode: string): Promise<'success' | 'dropped' | 'timeout' | 'error'>
  /** Get all active partitions */
  getActivePartitions(): NetworkPartitionResult[]
  /** Reset all partitions */
  reset(): void
}

/**
 * Creates a mock network partition manager
 */
export function createMockNetworkPartitionManager(): MockNetworkPartitionManager {
  const partitions = new Map<string, NetworkPartitionResult>()
  const nodePartitions = new Map<string, string>() // nodeId -> partitionId
  let partitionCounter = 0

  return {
    partition(config: NetworkPartitionConfig): NetworkPartitionResult {
      const partitionId = `partition-${++partitionCounter}`
      const result: NetworkPartitionResult = {
        partitionId,
        partitionedNodes: config.affectedNodes,
        createdAt: new Date(),
        healAt: config.duration ? new Date(Date.now() + config.duration) : undefined,
        status: 'active',
      }

      partitions.set(partitionId, result)
      for (const node of config.affectedNodes) {
        nodePartitions.set(node, partitionId)
      }

      // Schedule auto-heal if duration is set
      if (config.duration) {
        setTimeout(() => {
          const p = partitions.get(partitionId)
          if (p && p.status === 'active') {
            p.status = 'healed'
            for (const node of config.affectedNodes) {
              nodePartitions.delete(node)
            }
          }
        }, config.duration)
      }

      return result
    },

    isPartitioned(nodeId: string): boolean {
      const partitionId = nodePartitions.get(nodeId)
      if (!partitionId) return false
      const partition = partitions.get(partitionId)
      return partition?.status === 'active' || false
    },

    getPartition(nodeId: string): NetworkPartitionResult | undefined {
      const partitionId = nodePartitions.get(nodeId)
      if (!partitionId) return undefined
      return partitions.get(partitionId)
    },

    heal(partitionId: string): void {
      const partition = partitions.get(partitionId)
      if (partition) {
        partition.status = 'healed'
        for (const node of partition.partitionedNodes) {
          nodePartitions.delete(node)
        }
      }
    },

    async simulateRequest(fromNode: string, toNode: string): Promise<'success' | 'dropped' | 'timeout' | 'error'> {
      const fromPartitioned = this.isPartitioned(fromNode)
      const toPartitioned = this.isPartitioned(toNode)

      if (!fromPartitioned && !toPartitioned) {
        return 'success'
      }

      // Get the partition config (simplified - just use first found)
      const partition = this.getPartition(fromNode) || this.getPartition(toNode)
      if (!partition) return 'success'

      // Simulate based on behavior (would need full config in real impl)
      // Default to 'dropped' for simplicity
      return 'dropped'
    },

    getActivePartitions(): NetworkPartitionResult[] {
      return Array.from(partitions.values()).filter((p) => p.status === 'active')
    },

    reset(): void {
      partitions.clear()
      nodePartitions.clear()
    },
  }
}

// ============================================================================
// Mock DO Crash Manager
// ============================================================================

export interface MockDOCrashManager {
  /** Crash a DO */
  crash(config: DOCrashConfig): Promise<DOCrashResult>
  /** Check if a DO is crashed */
  isCrashed(targetNs: string): boolean
  /** Get crash info for a DO */
  getCrashInfo(targetNs: string): DOCrashResult | undefined
  /** Restart a crashed DO */
  restart(targetNs: string): Promise<RecoveryStatus>
  /** Get all crashed DOs */
  getCrashedDOs(): DOCrashResult[]
  /** Reset all crashes */
  reset(): void
  /** Set recovery behavior for testing */
  setRecoveryBehavior(behavior: Partial<RecoveryStatus>): void
}

/**
 * Creates a mock DO crash manager
 */
export function createMockDOCrashManager(): MockDOCrashManager {
  const crashes = new Map<string, DOCrashResult>()
  let crashCounter = 0
  let recoveryBehavior: Partial<RecoveryStatus> = {}

  return {
    async crash(config: DOCrashConfig): Promise<DOCrashResult> {
      // Call beforeCrash callback if provided
      if (config.beforeCrash) {
        await config.beforeCrash()
      }

      const crashId = `crash-${++crashCounter}`
      const result: DOCrashResult = {
        crashId,
        targetNs: config.targetNs,
        crashedAt: new Date(),
        preservedState: config.statePreservation !== 'none'
          ? {
              itemCount: config.statePreservation === 'full' ? 100 : 50,
              pendingOperations: 0,
              walFlushed: config.crashType === 'graceful',
            }
          : undefined,
        recovery: {
          successful: false,
          strategy: 'none',
          itemsRecovered: 0,
          itemsLost: 0,
          recoveryTimeMs: 0,
          errors: [],
        },
      }

      crashes.set(config.targetNs, result)

      // Schedule auto-restart if configured
      if (config.autoRestart) {
        setTimeout(async () => {
          await this.restart(config.targetNs)
          if (config.afterRestart) {
            await config.afterRestart()
          }
        }, config.restartDelay || 0)
      }

      return result
    },

    isCrashed(targetNs: string): boolean {
      const crash = crashes.get(targetNs)
      return crash !== undefined && !crash.restartedAt
    },

    getCrashInfo(targetNs: string): DOCrashResult | undefined {
      return crashes.get(targetNs)
    },

    async restart(targetNs: string): Promise<RecoveryStatus> {
      const crash = crashes.get(targetNs)
      if (!crash) {
        return {
          successful: true,
          strategy: 'none',
          itemsRecovered: 0,
          itemsLost: 0,
          recoveryTimeMs: 0,
          errors: [],
        }
      }

      const startTime = Date.now()
      crash.restartedAt = new Date()

      // Simulate recovery based on preserved state
      const defaultRecovery: RecoveryStatus = {
        successful: true,
        strategy: crash.preservedState?.walFlushed ? 'wal_replay' : 'checkpoint',
        itemsRecovered: crash.preservedState?.itemCount || 0,
        itemsLost: crash.preservedState ? 0 : 10,
        recoveryTimeMs: Date.now() - startTime,
        errors: [],
      }

      crash.recovery = { ...defaultRecovery, ...recoveryBehavior }
      return crash.recovery
    },

    getCrashedDOs(): DOCrashResult[] {
      return Array.from(crashes.values()).filter((c) => !c.restartedAt)
    },

    reset(): void {
      crashes.clear()
      recoveryBehavior = {}
    },

    setRecoveryBehavior(behavior: Partial<RecoveryStatus>): void {
      recoveryBehavior = behavior
    },
  }
}

// ============================================================================
// Mock Pipeline Backpressure Manager
// ============================================================================

export interface MockBackpressureManager {
  /** Apply backpressure to a pipeline */
  apply(config: BackpressureConfig): BackpressureResult
  /** Check if pipeline has backpressure */
  hasBackpressure(pipeline: string): boolean
  /** Get backpressure info */
  getBackpressureInfo(pipeline: string): BackpressureResult | undefined
  /** Release backpressure */
  release(sessionId: string): BackpressureStats
  /** Simulate sending event through pipeline */
  sendEvent(pipeline: string, event: unknown): Promise<'queued' | 'dropped' | 'rejected' | 'sent'>
  /** Get queue for a pipeline */
  getQueue(pipeline: string): unknown[]
  /** Flush queue (when backpressure is released) */
  flushQueue(pipeline: string): Promise<number>
  /** Get active backpressure sessions */
  getActiveSessions(): BackpressureResult[]
  /** Reset all backpressure */
  reset(): void
}

/**
 * Creates a mock backpressure manager
 */
export function createMockBackpressureManager(): MockBackpressureManager {
  const sessions = new Map<string, BackpressureResult & { config: BackpressureConfig }>()
  const pipelineSessions = new Map<string, string>() // pipeline -> sessionId
  const queues = new Map<string, unknown[]>()
  const stats = new Map<string, BackpressureStats>()
  let sessionCounter = 0

  function getOrCreateStats(pipeline: string): BackpressureStats {
    if (!stats.has(pipeline)) {
      stats.set(pipeline, {
        eventsQueued: 0,
        eventsDropped: 0,
        eventsRejected: 0,
        eventsProcessed: 0,
        maxQueueDepth: 0,
        avgQueueWaitMs: 0,
        p99QueueWaitMs: 0,
      })
    }
    return stats.get(pipeline)!
  }

  return {
    apply(config: BackpressureConfig): BackpressureResult {
      const sessionId = `bp-session-${++sessionCounter}`
      const result: BackpressureResult = {
        sessionId,
        appliedAt: new Date(),
        stats: getOrCreateStats(config.pipeline),
      }

      sessions.set(sessionId, { ...result, config })
      pipelineSessions.set(config.pipeline, sessionId)
      queues.set(config.pipeline, [])

      // Schedule auto-release if duration is set
      if (config.duration) {
        setTimeout(() => {
          this.release(sessionId)
        }, config.duration)
      }

      return result
    },

    hasBackpressure(pipeline: string): boolean {
      const sessionId = pipelineSessions.get(pipeline)
      if (!sessionId) return false
      const session = sessions.get(sessionId)
      return session !== undefined && !session.releasedAt
    },

    getBackpressureInfo(pipeline: string): BackpressureResult | undefined {
      const sessionId = pipelineSessions.get(pipeline)
      if (!sessionId) return undefined
      return sessions.get(sessionId)
    },

    release(sessionId: string): BackpressureStats {
      const session = sessions.get(sessionId)
      if (!session) {
        return {
          eventsQueued: 0,
          eventsDropped: 0,
          eventsRejected: 0,
          eventsProcessed: 0,
          maxQueueDepth: 0,
          avgQueueWaitMs: 0,
          p99QueueWaitMs: 0,
        }
      }

      session.releasedAt = new Date()
      pipelineSessions.delete(session.config.pipeline)

      return session.stats
    },

    async sendEvent(pipeline: string, event: unknown): Promise<'queued' | 'dropped' | 'rejected' | 'sent'> {
      const sessionId = pipelineSessions.get(pipeline)
      const pipelineStats = getOrCreateStats(pipeline)

      if (!sessionId || !this.hasBackpressure(pipeline)) {
        pipelineStats.eventsProcessed++
        return 'sent'
      }

      const session = sessions.get(sessionId)!
      const queue = queues.get(pipeline) || []
      const config = session.config

      // Check queue capacity
      if (queue.length >= config.queueBehavior.maxQueueSize) {
        switch (config.queueBehavior.onQueueFull) {
          case 'drop_oldest':
            queue.shift()
            queue.push(event)
            pipelineStats.eventsDropped++
            pipelineStats.eventsQueued++
            return 'queued'
          case 'drop_newest':
            pipelineStats.eventsDropped++
            return 'dropped'
          case 'reject':
            pipelineStats.eventsRejected++
            return 'rejected'
          case 'block':
            // Simulate timeout
            pipelineStats.eventsRejected++
            return 'rejected'
        }
      }

      queue.push(event)
      pipelineStats.eventsQueued++
      pipelineStats.maxQueueDepth = Math.max(pipelineStats.maxQueueDepth, queue.length)
      queues.set(pipeline, queue)

      return 'queued'
    },

    getQueue(pipeline: string): unknown[] {
      return queues.get(pipeline) || []
    },

    async flushQueue(pipeline: string): Promise<number> {
      const queue = queues.get(pipeline) || []
      const flushed = queue.length
      const pipelineStats = getOrCreateStats(pipeline)

      pipelineStats.eventsProcessed += flushed
      queues.set(pipeline, [])

      return flushed
    },

    getActiveSessions(): BackpressureResult[] {
      return Array.from(sessions.values()).filter((s) => !s.releasedAt)
    },

    reset(): void {
      sessions.clear()
      pipelineSessions.clear()
      queues.clear()
      stats.clear()
    },
  }
}

// ============================================================================
// Mock Chaos Controller
// ============================================================================

export interface MockChaosControllerOptions {
  /** Custom partition manager */
  partitionManager?: MockNetworkPartitionManager
  /** Custom crash manager */
  crashManager?: MockDOCrashManager
  /** Custom backpressure manager */
  backpressureManager?: MockBackpressureManager
}

/**
 * Creates a mock chaos controller for testing
 */
export function createMockChaosController(
  options: MockChaosControllerOptions = {}
): ChaosController & {
  partitionManager: MockNetworkPartitionManager
  crashManager: MockDOCrashManager
  backpressureManager: MockBackpressureManager
} {
  const partitionManager = options.partitionManager ?? createMockNetworkPartitionManager()
  const crashManager = options.crashManager ?? createMockDOCrashManager()
  const backpressureManager = options.backpressureManager ?? createMockBackpressureManager()

  return {
    partitionManager,
    crashManager,
    backpressureManager,

    async partition(config: NetworkPartitionConfig): Promise<NetworkPartitionResult> {
      return partitionManager.partition(config)
    },

    async healPartition(partitionId: string): Promise<void> {
      partitionManager.heal(partitionId)
    },

    async crashDO(config: DOCrashConfig): Promise<DOCrashResult> {
      return crashManager.crash(config)
    },

    async restartDO(targetNs: string): Promise<void> {
      await crashManager.restart(targetNs)
    },

    async applyBackpressure(config: BackpressureConfig): Promise<BackpressureResult> {
      return backpressureManager.apply(config)
    },

    async releaseBackpressure(sessionId: string): Promise<BackpressureStats> {
      return backpressureManager.release(sessionId)
    },

    async runScenario(scenario: ChaosScenario): Promise<ChaosExecutionResult> {
      const startedAt = new Date()
      const failureResults: FailureExecutionResult[] = []
      const assertionResults: AssertionResult[] = []

      // Execute failures based on order
      if (scenario.order === 'parallel') {
        await Promise.all(
          scenario.failures.map(async (injection) => {
            const result = await executeFailure(injection, this)
            failureResults.push(result)
          })
        )
      } else {
        // Sequential execution
        for (const injection of scenario.failures) {
          const result = await executeFailure(injection, this)
          failureResults.push(result)
        }
      }

      // Run assertions
      for (const assertion of scenario.assertions) {
        const result = checkAssertion(assertion, failureResults)
        assertionResults.push(result)
      }

      const endedAt = new Date()
      const allPassed = assertionResults.every((r) => r.passed)

      return {
        scenario,
        startedAt,
        endedAt,
        durationMs: endedAt.getTime() - startedAt.getTime(),
        failureResults,
        assertionResults,
        status: allPassed ? 'passed' : 'failed',
        summary: {
          totalFailuresInjected: failureResults.filter((r) => r.injected).length,
          failuresHealed: failureResults.filter((r) => r.healedAt).length,
          assertionsPassed: assertionResults.filter((r) => r.passed).length,
          assertionsFailed: assertionResults.filter((r) => !r.passed).length,
          dataOperations: 0,
          dataOperationsFailed: 0,
          availabilityPercent: 100,
        },
      }
    },

    getState(): ChaosState {
      return {
        activePartitions: partitionManager.getActivePartitions(),
        crashedDOs: crashManager.getCrashedDOs(),
        activeBackpressure: backpressureManager.getActiveSessions(),
        pendingInjections: [],
      }
    },

    async reset(): Promise<void> {
      partitionManager.reset()
      crashManager.reset()
      backpressureManager.reset()
    },
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

async function executeFailure(
  injection: FailureInjection,
  controller: ChaosController
): Promise<FailureExecutionResult> {
  const effects: FailureEffect[] = []
  let injected = false
  let injectedAt: Date | undefined
  let healedAt: Date | undefined
  const errors: string[] = []

  try {
    switch (injection.type) {
      case 'network_partition':
        const partitionConfig = injection.config as NetworkPartitionConfig
        const partitionResult = await controller.partition(partitionConfig)
        injected = true
        injectedAt = partitionResult.createdAt
        if (partitionResult.healAt) {
          healedAt = partitionResult.healAt
        }
        effects.push({
          type: 'request_failed',
          count: 0,
          durationMs: injection.duration || 0,
        })
        break

      case 'do_crash':
        const crashConfig = injection.config as DOCrashConfig
        const crashResult = await controller.crashDO(crashConfig)
        injected = true
        injectedAt = crashResult.crashedAt
        if (crashResult.restartedAt) {
          healedAt = crashResult.restartedAt
        }
        effects.push({
          type: 'data_unavailable',
          count: 1,
          durationMs: injection.duration || 0,
        })
        break

      case 'pipeline_backpressure':
        const bpConfig = injection.config as BackpressureConfig
        const bpResult = await controller.applyBackpressure(bpConfig)
        injected = true
        injectedAt = bpResult.appliedAt
        if (bpResult.releasedAt) {
          healedAt = bpResult.releasedAt
        }
        effects.push({
          type: 'queue_buildup',
          count: 0,
          durationMs: injection.duration || 0,
        })
        break

      default:
        errors.push(`Unsupported failure type: ${injection.type}`)
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }

  return {
    injection,
    injected,
    injectedAt,
    healedAt,
    effects,
    errors,
  }
}

function checkAssertion(
  assertion: ChaosAssertion,
  _failureResults: FailureExecutionResult[]
): AssertionResult {
  // Simplified assertion checking for mock
  // Real implementation would inspect actual system state
  switch (assertion.property) {
    case 'data_integrity':
    case 'no_data_loss':
    case 'durability':
      // In mock, we assume these pass unless explicitly configured otherwise
      return {
        assertion,
        passed: true,
        actualValue: true,
      }

    case 'recovery_time':
      // Check if recovery time is within bounds
      const expectedMs = assertion.expected.value as number
      const actualMs = 100 // Mock value
      return {
        assertion,
        passed: actualMs <= expectedMs,
        actualValue: actualMs,
        errorMessage: actualMs > expectedMs
          ? `Recovery took ${actualMs}ms, expected <= ${expectedMs}ms`
          : undefined,
      }

    default:
      return {
        assertion,
        passed: true,
        actualValue: undefined,
      }
  }
}

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Creates a simple failure injection for testing
 */
export function createFailureInjection(
  type: FailureInjection['type'],
  config: Partial<FailureInjection> = {}
): FailureInjection {
  const defaults: Record<string, Partial<FailureInjection['config']>> = {
    network_partition: {
      type: 'full',
      affectedNodes: ['node-1'],
      behavior: { requestHandling: 'drop' },
    } as NetworkPartitionConfig,
    do_crash: {
      targetNs: 'https://test.do',
      crashType: 'immediate',
      autoRestart: true,
      restartDelay: 100,
      statePreservation: 'full',
    } as DOCrashConfig,
    pipeline_backpressure: {
      pipeline: 'PIPELINE',
      intensity: 'moderate',
      duration: 1000,
      queueBehavior: {
        maxQueueSize: 100,
        onQueueFull: 'drop_newest',
      },
    } as BackpressureConfig,
  }

  return {
    type,
    injectAt: 0,
    duration: 1000,
    severity: 'transient',
    config: defaults[type] as FailureInjection['config'],
    ...config,
  } as FailureInjection
}

/**
 * Creates a simple chaos scenario for testing
 */
export function createChaosScenario(
  name: string,
  failures: FailureInjection[],
  options: Partial<ChaosScenario> = {}
): ChaosScenario {
  return {
    name,
    description: `Test scenario: ${name}`,
    failures,
    order: 'sequential',
    duration: 5000,
    assertions: [
      {
        name: 'Data integrity maintained',
        property: 'data_integrity',
        expected: { type: 'true' },
      },
    ],
    ...options,
  }
}
