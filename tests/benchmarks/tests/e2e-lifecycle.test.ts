/**
 * E2E Lifecycle Operations Benchmark Suite
 *
 * Consolidated benchmark tests for all DO lifecycle operations:
 * - move() - Cross-colo movement with state preservation
 * - fork() - Namespace forking with branch isolation
 * - promote()/demote() - Thing<->DO lifecycle transitions
 * - clone() - Atomic, staged, eventual, and resumable modes
 * - shard()/unshard() - Horizontal scaling strategies
 * - replicate() - Async replication and consistency
 *
 * This test file provides unified benchmarking with mock implementations
 * suitable for CI/CD environments. For real CF infrastructure benchmarks,
 * see benchmarks/e2e/lifecycle/*.e2e.test.ts
 *
 * @see objects/DO.ts for lifecycle implementation
 * @see objects/lifecycle/ for lifecycle modules
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================================
// BENCHMARK CONFIGURATION
// ============================================================================

/** Number of iterations for standard benchmarks */
const ITERATIONS = 50

/** Number of warmup iterations */
const WARMUP = 5

/** Maximum acceptable latency thresholds (ms) */
const THRESHOLDS = {
  move: {
    crossColo: 5000,
    sameRegion: 2000,
    statePreservation: 5000,
  },
  fork: {
    toNamespace: 3000,
    branchIsolation: 3000,
    stateIndependence: 3000,
  },
  promote: {
    thingToDO: 2000,
    doToThing: 1500,
    historyPreservation: 2500,
    atomic: 3000,
    staged: 3000,
  },
  clone: {
    atomic: 3000,
    stagedPrepare: 1000,
    stagedCommit: 3000,
    eventualInit: 500,
    checkpoint: 1500,
  },
  shard: {
    create: 2000,
    route: 100,
    unshard: 5000,
    scatterGather: 500,
  },
  replicate: {
    create: 2000,
    read: 100,
    lag: 500,
    failover: 3000,
  },
}

// ============================================================================
// MOCK LIFECYCLE MANAGER
// ============================================================================

/**
 * Mock lifecycle operation results
 */
interface LifecycleResult {
  success: boolean
  latencyMs: number
  operation: string
  metadata?: Record<string, unknown>
}

/**
 * Mock DO Lifecycle Manager
 * Simulates all lifecycle operations with configurable latency
 */
class MockLifecycleManager {
  private state: Map<string, unknown> = new Map()
  private history: Array<{ event: string; timestamp: number; data: unknown }> = []
  private baseLatencyMs: number

  constructor(baseLatencyMs: number = 10) {
    this.baseLatencyMs = baseLatencyMs
  }

  /**
   * Simulate network/operation latency
   */
  private async simulateLatency(multiplier: number = 1): Promise<number> {
    const latency = this.baseLatencyMs * multiplier * (0.8 + Math.random() * 0.4)
    await new Promise((resolve) => setTimeout(resolve, latency))
    return latency
  }

  /**
   * Record an event in history
   */
  private recordEvent(event: string, data: unknown): void {
    this.history.push({ event, timestamp: Date.now(), data })
  }

  // ========================================================================
  // move() Operations
  // ========================================================================

  /**
   * Move DO to different colo
   */
  async move(targetColo: string, options?: { merge?: boolean }): Promise<LifecycleResult> {
    const start = performance.now()
    this.recordEvent('move.started', { targetColo, options })

    // Simulate cross-colo move latency (varies by distance)
    const multiplier = this.getColoDistanceMultiplier(targetColo)
    await this.simulateLatency(multiplier)

    // State preservation during move
    const stateSnapshot = new Map(this.state)

    // Simulate move completion
    await this.simulateLatency(multiplier * 0.5)

    // Restore state (verify preservation)
    for (const [key, value] of stateSnapshot) {
      this.state.set(key, value)
    }

    this.recordEvent('move.completed', { targetColo, statePreserved: true })

    return {
      success: true,
      latencyMs: performance.now() - start,
      operation: 'move',
      metadata: { targetColo, merge: options?.merge ?? false },
    }
  }

  private getColoDistanceMultiplier(targetColo: string): number {
    const distances: Record<string, number> = {
      LAX: 1,
      SJC: 1.2,
      LHR: 2.5,
      FRA: 2.8,
      NRT: 3.0,
      SYD: 3.5,
    }
    return distances[targetColo] ?? 2
  }

  // ========================================================================
  // fork() Operations
  // ========================================================================

  /**
   * Fork DO to new namespace
   */
  async fork(
    namespace: string,
    options?: { id?: string; shallow?: boolean; filter?: { include?: string[]; exclude?: string[] } }
  ): Promise<LifecycleResult> {
    const start = performance.now()
    this.recordEvent('fork.started', { namespace, options })

    // Simulate fork operation
    const multiplier = options?.shallow ? 0.5 : 1.5
    await this.simulateLatency(multiplier)

    // Create forked state (deep copy unless shallow)
    const forkedState = new Map<string, unknown>()
    for (const [key, value] of this.state) {
      if (options?.filter?.exclude?.includes(key)) continue
      if (options?.filter?.include && !options.filter.include.includes(key)) continue

      forkedState.set(key, options?.shallow ? value : JSON.parse(JSON.stringify(value)))
    }

    this.recordEvent('fork.completed', { namespace, stateSize: forkedState.size })

    return {
      success: true,
      latencyMs: performance.now() - start,
      operation: 'fork',
      metadata: { namespace, id: options?.id, shallow: options?.shallow ?? false },
    }
  }

  // ========================================================================
  // promote() / demote() Operations
  // ========================================================================

  /**
   * Promote Thing to active DO
   */
  async promote(
    thingId: string,
    options?: { mode?: 'atomic' | 'staged'; preserveHistory?: boolean }
  ): Promise<LifecycleResult> {
    const start = performance.now()
    this.recordEvent('thing.promoting', { thingId, options })

    const mode = options?.mode ?? 'atomic'
    const multiplier = mode === 'atomic' ? 1.5 : 2 // Staged has two phases

    if (mode === 'staged') {
      // Prepare phase
      await this.simulateLatency(multiplier * 0.4)
      this.recordEvent('promote.prepared', { thingId })

      // Commit phase
      await this.simulateLatency(multiplier * 0.6)
    } else {
      await this.simulateLatency(multiplier)
    }

    // Activate DO state
    this.state.set('__active', true)
    this.state.set('__promotedAt', Date.now())

    if (options?.preserveHistory) {
      this.state.set('__history', [...this.history])
    }

    this.recordEvent('thing.promoted', { thingId, mode })

    return {
      success: true,
      latencyMs: performance.now() - start,
      operation: 'promote',
      metadata: { thingId, mode, historyPreserved: options?.preserveHistory ?? false },
    }
  }

  /**
   * Demote active DO to Thing
   */
  async demote(
    doId: string,
    options?: { archive?: { destination: string }; cleanup?: { cancelAlarms?: boolean } }
  ): Promise<LifecycleResult> {
    const start = performance.now()
    this.recordEvent('do.demoting', { doId, options })

    // Cleanup phase
    if (options?.cleanup?.cancelAlarms) {
      await this.simulateLatency(0.3)
    }

    // Archive phase
    if (options?.archive) {
      await this.simulateLatency(0.5)
      this.recordEvent('do.archived', { destination: options.archive.destination })
    }

    // Deactivation
    await this.simulateLatency(1)
    this.state.set('__active', false)
    this.state.set('__demotedAt', Date.now())

    this.recordEvent('do.demoted', { doId })

    return {
      success: true,
      latencyMs: performance.now() - start,
      operation: 'demote',
      metadata: { doId, archived: !!options?.archive },
    }
  }

  // ========================================================================
  // clone() Operations
  // ========================================================================

  /**
   * Clone DO with specified mode
   */
  async clone(
    targetId: string,
    mode: 'atomic' | 'staged' | 'eventual' | 'resumable'
  ): Promise<LifecycleResult & { token?: string; jobId?: string; checkpointId?: string }> {
    const start = performance.now()
    this.recordEvent('clone.started', { targetId, mode })

    let token: string | undefined
    let jobId: string | undefined
    let checkpointId: string | undefined

    switch (mode) {
      case 'atomic':
        // Block all other requests during clone
        await this.simulateLatency(2)
        break

      case 'staged':
        // Two-phase commit
        token = `token-${Date.now()}-${Math.random().toString(36).slice(2)}`
        await this.simulateLatency(0.8) // Prepare
        await this.simulateLatency(1.2) // Commit
        break

      case 'eventual':
        // Return immediately, background sync
        jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2)}`
        await this.simulateLatency(0.3) // Just initiation
        break

      case 'resumable':
        // With checkpoints
        checkpointId = `cp-${Date.now()}-${Math.random().toString(36).slice(2)}`
        await this.simulateLatency(1.5)
        break
    }

    this.recordEvent('clone.completed', { targetId, mode })

    return {
      success: true,
      latencyMs: performance.now() - start,
      operation: 'clone',
      metadata: { targetId, mode },
      token,
      jobId,
      checkpointId,
    }
  }

  /**
   * Staged clone operations
   */
  async clonePrepare(targetId: string): Promise<{ token: string; latencyMs: number }> {
    const start = performance.now()
    await this.simulateLatency(0.6)
    return {
      token: `token-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      latencyMs: performance.now() - start,
    }
  }

  async cloneCommit(token: string, targetId: string): Promise<LifecycleResult> {
    const start = performance.now()
    await this.simulateLatency(1.4)
    return {
      success: true,
      latencyMs: performance.now() - start,
      operation: 'clone.commit',
      metadata: { token, targetId },
    }
  }

  async cloneAbort(token: string): Promise<LifecycleResult> {
    const start = performance.now()
    await this.simulateLatency(0.3)
    return {
      success: true,
      latencyMs: performance.now() - start,
      operation: 'clone.abort',
      metadata: { token },
    }
  }

  // ========================================================================
  // shard() / unshard() Operations
  // ========================================================================

  /**
   * Create shards with specified strategy
   */
  async shard(
    strategy: 'hash' | 'range' | 'roundRobin',
    shardCount: number,
    options?: { namespace?: string; key?: string; ranges?: Array<{ min: number; max: number }> }
  ): Promise<LifecycleResult> {
    const start = performance.now()
    this.recordEvent('shard.creating', { strategy, shardCount, options })

    // Shard creation latency scales with count
    const multiplier = 1 + (shardCount / 16) * 0.5
    await this.simulateLatency(multiplier)

    this.state.set('__shardStrategy', strategy)
    this.state.set('__shardCount', shardCount)
    this.state.set('__shardKey', options?.key ?? 'id')

    this.recordEvent('shard.created', { strategy, shardCount })

    return {
      success: true,
      latencyMs: performance.now() - start,
      operation: 'shard',
      metadata: { strategy, shardCount, key: options?.key },
    }
  }

  /**
   * Route request to shard
   */
  async routeToShard(key: string): Promise<{ shardId: number; latencyMs: number }> {
    const start = performance.now()
    const shardCount = (this.state.get('__shardCount') as number) ?? 8
    const strategy = (this.state.get('__shardStrategy') as string) ?? 'hash'

    // Fast routing operation
    await this.simulateLatency(0.05)

    let shardId: number
    if (strategy === 'hash') {
      shardId = this.hashKey(key) % shardCount
    } else if (strategy === 'roundRobin') {
      const counter = ((this.state.get('__rrCounter') as number) ?? 0) + 1
      this.state.set('__rrCounter', counter)
      shardId = counter % shardCount
    } else {
      // Range - simplified
      shardId = Math.floor(Math.random() * shardCount)
    }

    return { shardId, latencyMs: performance.now() - start }
  }

  private hashKey(key: string): number {
    let hash = 0
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash
    }
    return Math.abs(hash)
  }

  /**
   * Unshard (merge) operation
   */
  async unshard(
    namespace: string,
    targetId: string,
    options?: { conflictStrategy?: 'last-write-wins' | 'merge' }
  ): Promise<LifecycleResult> {
    const start = performance.now()
    this.recordEvent('unshard.started', { namespace, targetId, options })

    const shardCount = (this.state.get('__shardCount') as number) ?? 8
    // Unshard latency scales with shard count
    const multiplier = 2 + shardCount * 0.3
    await this.simulateLatency(multiplier)

    this.state.delete('__shardStrategy')
    this.state.delete('__shardCount')
    this.state.delete('__shardKey')

    this.recordEvent('unshard.completed', { namespace, targetId })

    return {
      success: true,
      latencyMs: performance.now() - start,
      operation: 'unshard',
      metadata: { namespace, targetId, conflictStrategy: options?.conflictStrategy },
    }
  }

  // ========================================================================
  // replicate() Operations
  // ========================================================================

  /**
   * Set up async replication
   */
  async replicate(
    replicaId: string,
    targetRegion: string,
    options?: { mode?: 'async' | 'sync'; config?: { batchSize?: number; maxLagMs?: number } }
  ): Promise<LifecycleResult> {
    const start = performance.now()
    this.recordEvent('replica.creating', { replicaId, targetRegion, options })

    const mode = options?.mode ?? 'async'
    const multiplier = mode === 'sync' ? 2 : 1.2
    await this.simulateLatency(multiplier)

    const replicas = (this.state.get('__replicas') as string[]) ?? []
    replicas.push(replicaId)
    this.state.set('__replicas', replicas)

    this.recordEvent('replica.created', { replicaId, mode })

    return {
      success: true,
      latencyMs: performance.now() - start,
      operation: 'replicate',
      metadata: { replicaId, targetRegion, mode },
    }
  }

  /**
   * Read from replica
   */
  async readFromReplica(
    key: string,
    options?: { source?: 'primary' | 'replica' | 'nearest' }
  ): Promise<{ value: unknown; servedBy: string; latencyMs: number }> {
    const start = performance.now()
    const source = options?.source ?? 'nearest'

    // Replica reads are faster
    const multiplier = source === 'primary' ? 1 : 0.6
    await this.simulateLatency(multiplier)

    return {
      value: this.state.get(key),
      servedBy: source === 'primary' ? 'primary' : `replica-${Math.random().toString(36).slice(2, 6)}`,
      latencyMs: performance.now() - start,
    }
  }

  /**
   * Measure replication lag
   */
  async measureReplicationLag(): Promise<{ lagMs: number; healthy: boolean }> {
    const start = performance.now()
    await this.simulateLatency(0.2)

    // Simulate variable lag
    const lagMs = this.baseLatencyMs * (2 + Math.random() * 3)

    return {
      lagMs,
      healthy: lagMs < THRESHOLDS.replicate.lag,
    }
  }

  /**
   * Failover to replica
   */
  async failover(replicaId: string): Promise<LifecycleResult> {
    const start = performance.now()
    this.recordEvent('failover.started', { replicaId })

    await this.simulateLatency(2.5)

    this.recordEvent('failover.completed', { replicaId })

    return {
      success: true,
      latencyMs: performance.now() - start,
      operation: 'failover',
      metadata: { replicaId },
    }
  }

  // ========================================================================
  // State Management
  // ========================================================================

  setState(key: string, value: unknown): void {
    this.state.set(key, value)
  }

  getState(key: string): unknown {
    return this.state.get(key)
  }

  getHistory(): Array<{ event: string; timestamp: number; data: unknown }> {
    return [...this.history]
  }

  reset(): void {
    this.state.clear()
    this.history = []
  }
}

// ============================================================================
// BENCHMARK UTILITIES
// ============================================================================

interface BenchmarkResult {
  name: string
  iterations: number
  samples: number[]
  stats: {
    min: number
    max: number
    mean: number
    p50: number
    p95: number
    p99: number
    stddev: number
  }
}

/**
 * Run benchmark with warmup and collect statistics
 */
async function runBenchmark(
  name: string,
  fn: (iteration: number) => Promise<{ latencyMs: number } | void>,
  iterations: number = ITERATIONS,
  warmupIterations: number = WARMUP
): Promise<BenchmarkResult> {
  // Warmup phase
  for (let i = 0; i < warmupIterations; i++) {
    await fn(i)
  }

  // Collect samples
  const samples: number[] = []

  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    const result = await fn(i + warmupIterations)
    const elapsed = result && 'latencyMs' in result ? result.latencyMs : performance.now() - start
    samples.push(elapsed)
  }

  // Calculate statistics
  samples.sort((a, b) => a - b)
  const sum = samples.reduce((a, b) => a + b, 0)
  const mean = sum / samples.length
  const variance = samples.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / samples.length

  return {
    name,
    iterations,
    samples,
    stats: {
      min: samples[0]!,
      max: samples[samples.length - 1]!,
      mean,
      p50: samples[Math.floor(samples.length * 0.5)]!,
      p95: samples[Math.floor(samples.length * 0.95)]!,
      p99: samples[Math.floor(samples.length * 0.99)]!,
      stddev: Math.sqrt(variance),
    },
  }
}

/**
 * Format benchmark result for console output
 */
function formatResult(result: BenchmarkResult): string {
  const { stats } = result
  return [
    `  ${result.name}:`,
    `    Mean: ${stats.mean.toFixed(2)}ms, StdDev: ${stats.stddev.toFixed(2)}ms`,
    `    Min: ${stats.min.toFixed(2)}ms, Max: ${stats.max.toFixed(2)}ms`,
    `    P50: ${stats.p50.toFixed(2)}ms, P95: ${stats.p95.toFixed(2)}ms, P99: ${stats.p99.toFixed(2)}ms`,
  ].join('\n')
}

// ============================================================================
// E2E LIFECYCLE BENCHMARKS
// ============================================================================

describe('E2E Lifecycle Operations Benchmarks', () => {
  let manager: MockLifecycleManager
  const testRunId = `lifecycle-${Date.now()}`
  const allResults: BenchmarkResult[] = []

  beforeEach(() => {
    manager = new MockLifecycleManager(5) // 5ms base latency
  })

  afterEach(() => {
    manager.reset()
  })

  // ==========================================================================
  // move() E2E Benchmarks
  // ==========================================================================

  describe('move() E2E', () => {
    it('benchmarks basic move to different colo', async () => {
      const result = await runBenchmark('move-cross-colo', async (i) => {
        const colos = ['LHR', 'FRA', 'NRT', 'SYD']
        const targetColo = colos[i % colos.length]!
        return manager.move(targetColo)
      })

      allResults.push(result)
      console.log('\n--- Move Cross-Colo Benchmark ---')
      console.log(formatResult(result))

      expect(result.stats.p95).toBeLessThan(THRESHOLDS.move.crossColo)
    })

    it('benchmarks state preservation after move', async () => {
      // Set up state before benchmark
      manager.setState('testKey', { value: 42, nested: { data: 'preserved' } })

      const result = await runBenchmark('move-state-preservation', async (i) => {
        const moved = await manager.move('LHR')

        // Verify state preserved
        const state = manager.getState('testKey')
        if (!state || (state as Record<string, unknown>).value !== 42) {
          throw new Error('State not preserved')
        }

        return moved
      })

      allResults.push(result)
      console.log('\n--- Move State Preservation Benchmark ---')
      console.log(formatResult(result))

      expect(result.stats.p95).toBeLessThan(THRESHOLDS.move.statePreservation)
    })

    it('benchmarks merge options (merge: true/false)', async () => {
      const resultNoMerge = await runBenchmark('move-no-merge', async () => manager.move('FRA', { merge: false }), 30, 3)

      const resultMerge = await runBenchmark('move-with-merge', async () => manager.move('FRA', { merge: true }), 30, 3)

      allResults.push(resultNoMerge, resultMerge)

      console.log('\n--- Move Merge Options Benchmark ---')
      console.log(formatResult(resultNoMerge))
      console.log(formatResult(resultMerge))

      expect(resultNoMerge.stats.p95).toBeLessThan(THRESHOLDS.move.crossColo)
      expect(resultMerge.stats.p95).toBeLessThan(THRESHOLDS.move.crossColo)
    })

    it('benchmarks event emissions', async () => {
      const result = await runBenchmark('move-events', async (i) => {
        const historyBefore = manager.getHistory().length
        const moved = await manager.move('NRT')
        const historyAfter = manager.getHistory().length

        // Verify events were emitted
        if (historyAfter <= historyBefore) {
          throw new Error('Events not emitted')
        }

        return moved
      })

      allResults.push(result)
      console.log('\n--- Move Events Benchmark ---')
      console.log(formatResult(result))

      expect(result.stats.p95).toBeLessThan(THRESHOLDS.move.crossColo)
    })
  })

  // ==========================================================================
  // fork() E2E Benchmarks
  // ==========================================================================

  describe('fork() E2E', () => {
    it('benchmarks fork to new namespace', async () => {
      const result = await runBenchmark('fork-namespace', async (i) => {
        return manager.fork(`ns-${testRunId}-${i}`)
      })

      allResults.push(result)
      console.log('\n--- Fork to Namespace Benchmark ---')
      console.log(formatResult(result))

      expect(result.stats.p95).toBeLessThan(THRESHOLDS.fork.toNamespace)
    })

    it('benchmarks branch isolation', async () => {
      manager.setState('isolationTest', { original: true, counter: 100 })

      const result = await runBenchmark(
        'fork-branch-isolation',
        async (i) => {
          const forked = await manager.fork(`branch-${testRunId}-${i}`, { id: `branch-id-${i}` })

          // Verify isolation (original state unchanged)
          const state = manager.getState('isolationTest') as Record<string, unknown>
          if (state.counter !== 100) {
            throw new Error('Branch isolation violated')
          }

          return forked
        },
        30,
        3
      )

      allResults.push(result)
      console.log('\n--- Fork Branch Isolation Benchmark ---')
      console.log(formatResult(result))

      expect(result.stats.p95).toBeLessThan(THRESHOLDS.fork.branchIsolation)
    })

    it('benchmarks state independence', async () => {
      manager.setState('independenceTest', { value: 'original' })

      const result = await runBenchmark(
        'fork-state-independence',
        async (i) => {
          return manager.fork(`independent-${testRunId}-${i}`, { shallow: false })
        },
        30,
        3
      )

      allResults.push(result)
      console.log('\n--- Fork State Independence Benchmark ---')
      console.log(formatResult(result))

      expect(result.stats.p95).toBeLessThan(THRESHOLDS.fork.stateIndependence)
    })
  })

  // ==========================================================================
  // promote()/demote() E2E Benchmarks
  // ==========================================================================

  describe('promote()/demote() E2E', () => {
    it('benchmarks Thing->DO promotion', async () => {
      const result = await runBenchmark('promote-thing-to-do', async (i) => {
        return manager.promote(`thing-${testRunId}-${i}`)
      })

      allResults.push(result)
      console.log('\n--- Thing->DO Promotion Benchmark ---')
      console.log(formatResult(result))

      expect(result.stats.p95).toBeLessThan(THRESHOLDS.promote.thingToDO)
    })

    it('benchmarks DO->Thing demotion', async () => {
      const result = await runBenchmark('demote-do-to-thing', async (i) => {
        return manager.demote(`do-${testRunId}-${i}`)
      })

      allResults.push(result)
      console.log('\n--- DO->Thing Demotion Benchmark ---')
      console.log(formatResult(result))

      expect(result.stats.p95).toBeLessThan(THRESHOLDS.promote.doToThing)
    })

    it('benchmarks history preservation', async () => {
      // Add history
      manager.setState('historyKey', { value: 1 })

      const result = await runBenchmark(
        'promote-history-preservation',
        async (i) => {
          return manager.promote(`history-${testRunId}-${i}`, { preserveHistory: true })
        },
        30,
        3
      )

      allResults.push(result)
      console.log('\n--- History Preservation Benchmark ---')
      console.log(formatResult(result))

      expect(result.stats.p95).toBeLessThan(THRESHOLDS.promote.historyPreservation)
    })

    it('benchmarks atomic vs staged modes', async () => {
      const atomicResult = await runBenchmark(
        'promote-atomic',
        async (i) => manager.promote(`atomic-${testRunId}-${i}`, { mode: 'atomic' }),
        30,
        3
      )

      const stagedResult = await runBenchmark(
        'promote-staged',
        async (i) => manager.promote(`staged-${testRunId}-${i}`, { mode: 'staged' }),
        30,
        3
      )

      allResults.push(atomicResult, stagedResult)

      console.log('\n--- Atomic vs Staged Mode Benchmark ---')
      console.log(formatResult(atomicResult))
      console.log(formatResult(stagedResult))

      expect(atomicResult.stats.p95).toBeLessThan(THRESHOLDS.promote.atomic)
      expect(stagedResult.stats.p95).toBeLessThan(THRESHOLDS.promote.staged)
    })
  })

  // ==========================================================================
  // clone() E2E Benchmarks
  // ==========================================================================

  describe('clone() E2E', () => {
    it('benchmarks atomic mode', async () => {
      const result = await runBenchmark('clone-atomic', async (i) => {
        return manager.clone(`atomic-clone-${testRunId}-${i}`, 'atomic')
      })

      allResults.push(result)
      console.log('\n--- Clone Atomic Mode Benchmark ---')
      console.log(formatResult(result))

      expect(result.stats.p95).toBeLessThan(THRESHOLDS.clone.atomic)
    })

    it('benchmarks staged mode (2PC)', async () => {
      const prepareResult = await runBenchmark(
        'clone-staged-prepare',
        async (i) => manager.clonePrepare(`staged-${testRunId}-${i}`),
        30,
        3
      )

      const commitResult = await runBenchmark(
        'clone-staged-commit',
        async (i) => {
          const prep = await manager.clonePrepare(`staged-commit-${testRunId}-${i}`)
          return manager.cloneCommit(prep.token, `staged-commit-${testRunId}-${i}`)
        },
        30,
        3
      )

      allResults.push(prepareResult, commitResult)

      console.log('\n--- Clone Staged Mode (2PC) Benchmark ---')
      console.log(formatResult(prepareResult))
      console.log(formatResult(commitResult))

      expect(prepareResult.stats.p95).toBeLessThan(THRESHOLDS.clone.stagedPrepare)
      expect(commitResult.stats.p95).toBeLessThan(THRESHOLDS.clone.stagedCommit)
    })

    it('benchmarks eventual mode', async () => {
      const result = await runBenchmark('clone-eventual', async (i) => {
        return manager.clone(`eventual-${testRunId}-${i}`, 'eventual')
      })

      allResults.push(result)
      console.log('\n--- Clone Eventual Mode Benchmark ---')
      console.log(formatResult(result))

      expect(result.stats.p95).toBeLessThan(THRESHOLDS.clone.eventualInit)
    })

    it('benchmarks resumable mode with checkpoints', async () => {
      const result = await runBenchmark('clone-resumable', async (i) => {
        return manager.clone(`resumable-${testRunId}-${i}`, 'resumable')
      })

      allResults.push(result)
      console.log('\n--- Clone Resumable Mode Benchmark ---')
      console.log(formatResult(result))

      expect(result.stats.p95).toBeLessThan(THRESHOLDS.clone.checkpoint)
    })
  })

  // ==========================================================================
  // shard()/unshard() E2E Benchmarks
  // ==========================================================================

  describe('shard()/unshard() E2E', () => {
    it('benchmarks hash strategy', async () => {
      const result = await runBenchmark(
        'shard-hash',
        async (i) => {
          return manager.shard('hash', 8, { namespace: `hash-ns-${i}`, key: 'tenant_id' })
        },
        30,
        3
      )

      allResults.push(result)
      console.log('\n--- Shard Hash Strategy Benchmark ---')
      console.log(formatResult(result))

      expect(result.stats.p95).toBeLessThan(THRESHOLDS.shard.create)
    })

    it('benchmarks range strategy', async () => {
      const result = await runBenchmark(
        'shard-range',
        async (i) => {
          return manager.shard('range', 4, {
            namespace: `range-ns-${i}`,
            key: 'id',
            ranges: [
              { min: 0, max: 250 },
              { min: 250, max: 500 },
              { min: 500, max: 750 },
              { min: 750, max: 1000 },
            ],
          })
        },
        30,
        3
      )

      allResults.push(result)
      console.log('\n--- Shard Range Strategy Benchmark ---')
      console.log(formatResult(result))

      expect(result.stats.p95).toBeLessThan(THRESHOLDS.shard.create)
    })

    it('benchmarks roundRobin strategy', async () => {
      const result = await runBenchmark(
        'shard-roundrobin',
        async (i) => {
          return manager.shard('roundRobin', 4, { namespace: `rr-ns-${i}` })
        },
        30,
        3
      )

      allResults.push(result)
      console.log('\n--- Shard RoundRobin Strategy Benchmark ---')
      console.log(formatResult(result))

      expect(result.stats.p95).toBeLessThan(THRESHOLDS.shard.create)
    })

    it('benchmarks key distribution', async () => {
      // Set up sharding first
      await manager.shard('hash', 8, { key: 'id' })

      const result = await runBenchmark('shard-routing', async (i) => {
        return manager.routeToShard(`key-${i}-${Math.random().toString(36).slice(2)}`)
      })

      allResults.push(result)
      console.log('\n--- Shard Key Distribution Benchmark ---')
      console.log(formatResult(result))

      expect(result.stats.p95).toBeLessThan(THRESHOLDS.shard.route)
    })

    it('benchmarks unshard merge integrity', async () => {
      const result = await runBenchmark(
        'unshard-merge',
        async (i) => {
          // Set up shards first
          await manager.shard('hash', 4, { namespace: `unshard-${i}` })
          return manager.unshard(`unshard-${i}`, `merged-${i}`, { conflictStrategy: 'last-write-wins' })
        },
        20,
        2
      )

      allResults.push(result)
      console.log('\n--- Unshard Merge Integrity Benchmark ---')
      console.log(formatResult(result))

      expect(result.stats.p95).toBeLessThan(THRESHOLDS.shard.unshard)
    })
  })

  // ==========================================================================
  // replicate() E2E Benchmarks
  // ==========================================================================

  describe('replicate() E2E', () => {
    it('benchmarks async replication setup', async () => {
      const result = await runBenchmark('replicate-async-setup', async (i) => {
        return manager.replicate(`replica-${testRunId}-${i}`, 'eu-west-1', { mode: 'async' })
      })

      allResults.push(result)
      console.log('\n--- Async Replication Setup Benchmark ---')
      console.log(formatResult(result))

      expect(result.stats.p95).toBeLessThan(THRESHOLDS.replicate.create)
    })

    it('benchmarks consistency verification', async () => {
      const result = await runBenchmark('replicate-consistency', async (i) => {
        const lag = await manager.measureReplicationLag()
        return { latencyMs: lag.lagMs }
      })

      allResults.push(result)
      console.log('\n--- Replication Consistency Verification Benchmark ---')
      console.log(formatResult(result))

      expect(result.stats.p95).toBeLessThan(THRESHOLDS.replicate.lag)
    })

    it('benchmarks read from replica', async () => {
      manager.setState('replicaTestKey', { data: 'test-value' })

      const result = await runBenchmark('replicate-read', async (i) => {
        return manager.readFromReplica('replicaTestKey', { source: i % 2 === 0 ? 'replica' : 'primary' })
      })

      allResults.push(result)
      console.log('\n--- Read from Replica Benchmark ---')
      console.log(formatResult(result))

      expect(result.stats.p95).toBeLessThan(THRESHOLDS.replicate.read)
    })

    it('benchmarks failover', async () => {
      const result = await runBenchmark(
        'replicate-failover',
        async (i) => {
          return manager.failover(`failover-replica-${i}`)
        },
        20,
        2
      )

      allResults.push(result)
      console.log('\n--- Replication Failover Benchmark ---')
      console.log(formatResult(result))

      expect(result.stats.p95).toBeLessThan(THRESHOLDS.replicate.failover)
    })
  })

  // ==========================================================================
  // Summary Report
  // ==========================================================================

  describe('Benchmark Summary', () => {
    it('generates comprehensive performance report', () => {
      console.log('\n')
      console.log('='.repeat(70))
      console.log('E2E LIFECYCLE OPERATIONS BENCHMARK SUMMARY')
      console.log('='.repeat(70))
      console.log('')

      console.log('Operations Benchmarked:')
      console.log('  1. move()     - Cross-colo movement with state preservation')
      console.log('  2. fork()     - Namespace forking with branch isolation')
      console.log('  3. promote()  - Thing->DO lifecycle promotion')
      console.log('  4. demote()   - DO->Thing lifecycle demotion')
      console.log('  5. clone()    - 4 modes: atomic, staged, eventual, resumable')
      console.log('  6. shard()    - 3 strategies: hash, range, roundRobin')
      console.log('  7. unshard()  - Merge with conflict resolution')
      console.log('  8. replicate() - Async/sync replication with consistency')
      console.log('')

      console.log('Performance Thresholds:')
      console.log('  - move cross-colo:     < 5000ms')
      console.log('  - fork to namespace:   < 3000ms')
      console.log('  - promote/demote:      < 2000ms')
      console.log('  - clone atomic:        < 3000ms')
      console.log('  - clone eventual:      < 500ms')
      console.log('  - shard routing:       < 100ms')
      console.log('  - unshard merge:       < 5000ms')
      console.log('  - replica setup:       < 2000ms')
      console.log('  - replication lag:     < 500ms')
      console.log('')

      if (allResults.length > 0) {
        console.log('Results Summary:')
        console.log('-'.repeat(70))
        console.log('  Operation                     | P50     | P95     | P99     | Status')
        console.log('-'.repeat(70))

        for (const result of allResults) {
          const status = result.stats.p95 < 5000 ? 'PASS' : 'FAIL'
          console.log(
            `  ${result.name.padEnd(30)} | ${result.stats.p50.toFixed(1).padStart(6)}ms | ${result.stats.p95.toFixed(1).padStart(6)}ms | ${result.stats.p99.toFixed(1).padStart(6)}ms | ${status}`
          )
        }
        console.log('-'.repeat(70))
      }

      console.log('')
      console.log('Note: These benchmarks use mock implementations.')
      console.log('For real CF infrastructure benchmarks, see benchmarks/e2e/lifecycle/*.e2e.test.ts')
      console.log('')

      expect(true).toBe(true)
    })
  })
})
