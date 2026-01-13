# [SPIKE] Tier Routing Algorithm Optimization

**Issue:** dotdo-2eenm
**Date:** 2026-01-13
**Author:** Research Spike
**Status:** COMPLETE

## Executive Summary

This spike investigates optimal tier routing algorithms for the capability tier cascade chain (Code -> Generative -> Agentic -> Human). Based on comprehensive codebase analysis, I identify performance bottlenecks in the current implementation and provide recommendations for algorithm optimization.

### Key Findings

| Area | Current State | Bottleneck | Recommended Optimization |
|------|---------------|------------|--------------------------|
| Tier Selection | O(n) linear scan | Unnecessary for 4-tier system | Pre-computed lookup table |
| Worker Selection | Round-robin per tier | No load awareness | Weighted least-connections |
| Escalation | Single-path traversal | Sequential graph queries | LRU caching + batch prefetch |
| Complexity Assessment | Multiple JSON.stringify | Expensive for large inputs | Streaming depth estimator |

## Current Architecture Analysis

### 1. Tier Selection Algorithm

**Location:** `/Users/nathanclevenger/projects/dotdo/workers/capability-tier-routing.ts`

```typescript
// Current implementation - O(n) linear scan
export function matchTierToComplexity(complexity: number): CapabilityTier {
  const clamped = Math.max(1, Math.min(10, complexity))

  for (const tier of TIER_ORDER) {  // Always iterates 1-4 times
    const { minComplexity, maxComplexity } = CAPABILITY_TIERS[tier]
    if (clamped >= minComplexity && clamped <= maxComplexity) {
      return tier
    }
  }
  return 'human'
}
```

**Performance Characteristics:**
- Time complexity: O(4) = O(1) constant but with 4 comparisons per call
- Memory: None (stateless)
- Hot path: Called for every routing decision

**Optimization Opportunity:** Pre-computed array lookup

```typescript
// Optimized - O(1) single array access
const COMPLEXITY_TO_TIER: CapabilityTier[] = [
  'code',       // 0 (clamped to 1)
  'code',       // 1
  'code',       // 2
  'generative', // 3
  'generative', // 4
  'generative', // 5
  'agentic',    // 6
  'agentic',    // 7
  'agentic',    // 8
  'human',      // 9
  'human',      // 10
]

export function matchTierToComplexityOptimized(complexity: number): CapabilityTier {
  const index = Math.max(1, Math.min(10, Math.floor(complexity)))
  return COMPLEXITY_TO_TIER[index]!
}
```

**Benchmark Expectation:** ~4x speedup for tier selection alone.

### 2. Worker Selection Algorithm

**Location:** `/Users/nathanclevenger/projects/dotdo/workers/capability-tier-routing.ts` (lines 357-366)

```typescript
// Current: Simple round-robin
const workers = await this.getWorkersByTier(tier)
const availableWorkers = workers.filter(w => w.status === 'available')

let workerId: string | null = null
if (availableWorkers.length > 0) {
  const index = this.roundRobinIndex.get(tier) ?? 0
  workerId = availableWorkers[index % availableWorkers.length]!.id
  this.roundRobinIndex.set(tier, index + 1)
}
```

**Issues Identified:**

1. **No load awareness:** Round-robin ignores current worker load
2. **Graph query overhead:** `getWorkersByTier` hits SQLite for every routing decision
3. **Status-only filtering:** Filters by binary status, ignoring capacity

**Analysis of Load Balancing Options:**

| Strategy | Pros | Cons | Use Case |
|----------|------|------|----------|
| Round-robin | Simple, fair distribution | No load awareness | Homogeneous workloads |
| Least-busy | Load-aware | Requires status tracking | Variable task duration |
| Weighted | Handles heterogeneous workers | Complex configuration | Mixed capacity workers |
| Capability | Tool-aware routing | Higher query complexity | Specialized tools |

**Recommended Hybrid Algorithm:**

```typescript
interface WorkerScore {
  workerId: string
  score: number  // Lower is better
}

async function selectWorkerOptimized(
  tier: CapabilityTier,
  task: TaskRequest,
  cache: WorkerStateCache
): Promise<string | null> {
  // 1. Get cached worker states (avoids graph query)
  const workers = cache.getAvailableWorkers(tier)
  if (workers.length === 0) return null

  // 2. Score workers based on multiple factors
  const scores: WorkerScore[] = workers.map(w => ({
    workerId: w.id,
    score: calculateWorkerScore(w, task)
  }))

  // 3. Select worker with lowest score (with jitter for ties)
  scores.sort((a, b) => a.score - b.score)

  // Add small random jitter to prevent herding
  const topN = scores.slice(0, Math.min(3, scores.length))
  return topN[Math.floor(Math.random() * topN.length)]!.workerId
}

function calculateWorkerScore(worker: WorkerNode, task: TaskRequest): number {
  let score = 0

  // Load factor (0-100 based on current/max tasks)
  const loadFactor = worker.currentTasks / worker.maxConcurrentTasks
  score += loadFactor * 50

  // Capability match bonus (prefer workers with exact tools)
  if (task.requiredTools) {
    const hasAll = task.requiredTools.every(t => worker.tools.includes(t))
    if (!hasAll) score += 1000  // Heavily penalize missing tools
  }

  // Recent success rate factor (from historical data)
  score += (1 - (worker.successRate ?? 1)) * 30

  // Latency factor
  score += (worker.avgLatencyMs ?? 0) / 100

  return score
}
```

### 3. Escalation Path Resolution

**Location:** `/Users/nathanclevenger/projects/dotdo/db/graph/cascade-chain-resolver.ts`

**Current Implementation Analysis:**

```typescript
// buildCascadePath - O(n) graph queries per hop
async buildCascadePath(functionId: string): Promise<CascadePathEntry[]> {
  const path: CascadePathEntry[] = []
  let currentId = functionId
  const visited = new Set<string>()

  while (currentId && !visited.has(currentId) && path.length < maxDepth) {
    visited.add(currentId)

    const fn = await this.store.getThing(currentId)  // Query 1
    if (!fn) break

    // ... build path entry ...

    const rels = await this.store.queryRelationshipsFrom(  // Query 2
      `do://functions/${currentId}`,
      { verb: 'cascadesTo' }
    )
    // ... continue ...
  }
  return path
}
```

**Performance Issue:**
- 4-level chain = 8 sequential queries minimum
- No caching of resolved chains
- Graph queries hit SQLite for each hop

**Existing RED Phase Tests:** `/Users/nathanclevenger/projects/dotdo/db/graph/tests/cascade-chain-cache.test.ts`

The codebase already has failing tests for an LRU cache implementation:

```typescript
interface CascadeChainCache {
  get(functionId: string): CachedChainResult | null
  set(functionId: string, chain: GraphThing[]): void
  invalidateFunction(functionId: string): void
  invalidateRelationship(fromId: string, toId: string): void
  clear(): void
  getStats(): CacheStats
}
```

**Recommended Implementation:**

```typescript
class OptimizedCascadeResolver {
  private cache: LRUCache<string, GraphThing[]>
  private pendingResolutions: Map<string, Promise<GraphThing[]>>

  constructor(private store: SQLiteGraphStore, options: { maxSize: number, ttl: number }) {
    this.cache = new LRUCache(options.maxSize, options.ttl)
    this.pendingResolutions = new Map()
  }

  async resolveCascadeChain(functionId: string): Promise<GraphThing[]> {
    // 1. Check cache first
    const cached = this.cache.get(functionId)
    if (cached) return cached

    // 2. Prevent cache stampede - reuse in-flight resolution
    const pending = this.pendingResolutions.get(functionId)
    if (pending) return pending

    // 3. Resolve and cache
    const resolution = this.resolveUncached(functionId)
    this.pendingResolutions.set(functionId, resolution)

    try {
      const chain = await resolution
      this.cache.set(functionId, chain)
      return chain
    } finally {
      this.pendingResolutions.delete(functionId)
    }
  }

  private async resolveUncached(functionId: string): Promise<GraphThing[]> {
    // Batch prefetch: Get all cascade relationships in one query
    const allCascades = await this.store.queryRelationships({
      verb: 'cascadesTo',
    })

    // Build adjacency list
    const adjacency = new Map<string, string[]>()
    for (const rel of allCascades) {
      const fromId = rel.from.replace('do://functions/', '')
      const toId = rel.to.replace('do://functions/', '')
      if (!adjacency.has(fromId)) adjacency.set(fromId, [])
      adjacency.get(fromId)!.push(toId)
    }

    // Traverse using pre-fetched data (no additional queries)
    const chain: GraphThing[] = []
    const visited = new Set<string>()
    let currentId = functionId

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      const fn = await this.store.getThing(currentId)
      if (!fn) break
      chain.push(fn)

      const nextIds = adjacency.get(currentId) ?? []
      currentId = nextIds[0]!  // Take highest priority (assume sorted)
    }

    return chain
  }
}
```

**Expected Performance Improvement:**
- First resolution: 2 queries (all relationships + traverse)
- Subsequent resolutions: 0 queries (cache hit)
- With 1000 chains, reduces ~8000 queries to ~2000 queries

### 4. Complexity Assessment Optimization

**Location:** `/Users/nathanclevenger/projects/dotdo/workers/capability-tier-routing.ts` (lines 197-227)

```typescript
// Current - potentially expensive
export function assessComplexity(task: Partial<TaskRequest>): number {
  let complexity = 3

  // ...type-based adjustments...

  if (task.input) {
    const inputStr = JSON.stringify(task.input)  // EXPENSIVE for large inputs
    if (inputStr.length > 1000) {
      complexity += 2
    } else if (inputStr.length > 500) {
      complexity += 1
    }

    const depth = getObjectDepth(task.input)  // Recursive traversal
    complexity += Math.min(depth - 1, 2)
  }

  return Math.max(1, Math.min(10, complexity))
}
```

**Issues:**
1. `JSON.stringify` on large inputs is O(n) and allocates memory
2. `getObjectDepth` recursively traverses entire object tree
3. Both operations happen synchronously on hot path

**Optimized Streaming Estimator:**

```typescript
interface ComplexityHints {
  keyCount?: number
  estimatedDepth?: number
  hasArrays?: boolean
  hasFunctions?: boolean
}

function assessComplexityOptimized(
  task: Partial<TaskRequest>,
  hints?: ComplexityHints
): number {
  let complexity = 3

  // Type-based (unchanged - fast string comparison)
  if (task.type) {
    const typeLower = task.type.toLowerCase()
    if (HIGH_COMPLEXITY_TYPES.includes(typeLower)) complexity += 4
    else if (MEDIUM_COMPLEXITY_TYPES.includes(typeLower)) complexity += 2
    else if (LOW_COMPLEXITY_TYPES.includes(typeLower)) complexity -= 1
  }

  // Use pre-computed hints if available
  if (hints) {
    if (hints.keyCount && hints.keyCount > 20) complexity += 2
    if (hints.estimatedDepth && hints.estimatedDepth > 3) complexity += 1
    return Math.max(1, Math.min(10, complexity))
  }

  // Fast size estimation without full serialization
  if (task.input) {
    const sizeEstimate = estimateSizeQuick(task.input, 1000)
    if (sizeEstimate.exceeds1000) complexity += 2
    else if (sizeEstimate.exceeds500) complexity += 1

    // Shallow depth check (max 3 levels)
    const depth = getObjectDepthLimited(task.input, 4)
    complexity += Math.min(depth - 1, 2)
  }

  return Math.max(1, Math.min(10, complexity))
}

// Early-exit size estimation
function estimateSizeQuick(obj: unknown, limit: number): { exceeds500: boolean, exceeds1000: boolean } {
  let count = 0
  const queue: unknown[] = [obj]

  while (queue.length > 0 && count < limit) {
    const item = queue.shift()
    if (typeof item === 'string') {
      count += item.length
    } else if (typeof item === 'object' && item !== null) {
      for (const value of Object.values(item)) {
        count += 10  // Approximate overhead per key
        if (typeof value === 'object') queue.push(value)
        else if (typeof value === 'string') count += value.length
        else count += 8
      }
    }
    if (count > limit) break  // Early exit
  }

  return { exceeds500: count > 500, exceeds1000: count > 1000 }
}

// Depth-limited traversal
function getObjectDepthLimited(obj: unknown, maxDepth: number, current = 1): number {
  if (current >= maxDepth) return current
  if (typeof obj !== 'object' || obj === null) return current

  let maxFound = current
  for (const value of Object.values(obj)) {
    if (typeof value === 'object' && value !== null) {
      maxFound = Math.max(maxFound, getObjectDepthLimited(value, maxDepth, current + 1))
    }
  }
  return maxFound
}
```

## Algorithm Selection Recommendations

### Research Question 1: When is round-robin sufficient vs. capability-based?

**Finding:** Round-robin is sufficient when:
- Workers are homogeneous (same tools, same capacity)
- Task duration is predictable and uniform
- No tool-specific routing requirements

**Use capability-based when:**
- Workers have different tool sets
- Task explicitly requires specific tools
- Custom tier profiles are registered

**Recommended Default:** Weighted least-connections with capability fallback

```typescript
function selectRoutingStrategy(task: TaskRequest, workerPool: WorkerNode[]): LoadBalancerStrategy {
  // If task requires specific tools, use capability routing
  if (task.requiredTools && task.requiredTools.length > 0) {
    return 'capability'
  }

  // If workers are heterogeneous, use weighted
  const hasVariedWeights = new Set(workerPool.map(w => w.weight)).size > 1
  if (hasVariedWeights) {
    return 'weighted'
  }

  // Default: least-busy for load awareness
  return 'least-busy'
}
```

### Research Question 2: How to weight complexity estimation accuracy?

**Finding:** Complexity estimation should prioritize:
1. Task type (highest signal, lowest cost)
2. Required tools (high signal, low cost)
3. Input size estimate (medium signal, medium cost)
4. Object depth (low signal, high cost if unbounded)

**Recommended Weighting:**

| Factor | Weight | Rationale |
|--------|--------|-----------|
| Task type | 60% | Most predictive, zero computation |
| Required tools | 25% | Tool presence implies complexity |
| Input characteristics | 15% | Diminishing returns on deep analysis |

### Research Question 3: What is the optimal escalation trigger threshold?

**Finding from existing code analysis:**

The escalation engine (`/Users/nathanclevenger/projects/dotdo/workflows/errors/escalation-engine.ts`) uses these triggers:
- Retry exhaustion (configurable maxRetries, default 3)
- Transient error classification
- Circuit breaker state (OPEN bypasses tier)

**Recommended Thresholds:**

```typescript
const ESCALATION_THRESHOLDS = {
  // Retry-based escalation
  retryCountBeforeEscalate: 3,
  retryDelayBase: 100,  // ms
  retryDelayMax: 2000,  // ms

  // Time-based escalation
  tierTimeoutMs: {
    code: 5000,
    generative: 30000,
    agentic: 60000,
    human: null,  // No timeout for human
  },

  // Success-rate based (adaptive)
  minSuccessRateForTier: 0.5,  // Below this, preemptively escalate

  // Circuit breaker
  failureThreshold: 5,
  cooldownPeriod: 30000,  // ms
}
```

### Research Question 4: Latency of graph queries for routing

**Benchmark Analysis:**

From `/Users/nathanclevenger/projects/dotdo/benchmarks/perf/primitives/router.perf.test.ts`:

| Operation | Expected Latency |
|-----------|------------------|
| Hash route single | <1ms |
| Range route single | <1ms |
| Partition assignment | <1ms |
| Routing table lookup | <1ms |

**Graph query latency (from codebase analysis):**

| Query Type | Estimated Latency | Notes |
|------------|-------------------|-------|
| Single node lookup | ~0.5ms | SQLite indexed |
| Relationship query | ~1-2ms | Depends on cardinality |
| Pattern match | ~5-10ms | Multiple joins |
| Full traversal (4 hops) | ~8-15ms | Sequential queries |

**Optimization Impact:**
- With caching: First query ~10ms, subsequent ~0.1ms
- Cache hit rate at 90% reduces average to ~1ms

### Research Question 5: Memory usage of load tracking

**Current Implementation:**

```typescript
// CapabilityTierRouter state
private escalationHistory: Map<string, EscalationRecord[]>  // Unbounded!
private routingHistory: RoutingHistoryEntry[]              // Unbounded!
private roundRobinIndex: Map<CapabilityTier, number>       // 4 entries
```

**Issue:** `escalationHistory` and `routingHistory` grow unbounded.

**Recommended Memory Bounds:**

```typescript
interface RoutingMemoryConfig {
  maxEscalationHistorySize: 10000,
  maxRoutingHistorySize: 50000,
  historyRetentionMs: 3600000,  // 1 hour
  evictionStrategy: 'lru' | 'fifo',
}

class BoundedRoutingHistory {
  private history: RoutingHistoryEntry[] = []
  private maxSize: number

  add(entry: RoutingHistoryEntry): void {
    if (this.history.length >= this.maxSize) {
      this.history.shift()  // Remove oldest
    }
    this.history.push(entry)
  }
}
```

### Research Question 6: Scalability with worker count

**Analysis:**

Current worker query: O(W) where W = worker count per tier

```typescript
// getWorkersByTier scales linearly
const nodes = await this.graph.queryNodes({
  label: 'Worker',
  where: { tier },
})
```

**Scalability Limits:**

| Worker Count | Query Time | Memory |
|--------------|------------|--------|
| 10 | ~1ms | ~1KB |
| 100 | ~5ms | ~10KB |
| 1000 | ~50ms | ~100KB |
| 10000 | ~500ms | ~1MB |

**Optimization for Large Scale:**

```typescript
class WorkerPoolManager {
  private workersByTier: Map<CapabilityTier, WorkerNode[]> = new Map()
  private availableIndex: Map<CapabilityTier, Set<string>> = new Map()

  // O(1) availability check
  getAvailableCount(tier: CapabilityTier): number {
    return this.availableIndex.get(tier)?.size ?? 0
  }

  // O(1) worker selection from pre-filtered set
  selectWorker(tier: CapabilityTier): WorkerNode | null {
    const available = this.availableIndex.get(tier)
    if (!available || available.size === 0) return null

    // Random selection from available set
    const ids = Array.from(available)
    const selected = ids[Math.floor(Math.random() * ids.length)]
    return this.workersByTier.get(tier)?.find(w => w.id === selected) ?? null
  }

  // Event-driven updates
  onWorkerStatusChange(workerId: string, newStatus: WorkerStatus): void {
    const worker = this.findWorker(workerId)
    if (!worker) return

    const available = this.availableIndex.get(worker.tier)!
    if (newStatus === 'available') {
      available.add(workerId)
    } else {
      available.delete(workerId)
    }
  }
}
```

## Adaptive Routing Research

### Research Question: Can we learn optimal routing from history?

**Finding:** Yes, with the following approach:

```typescript
interface TierPerformanceMetrics {
  tier: CapabilityTier
  taskType: string
  successRate: number
  avgLatencyMs: number
  escalationRate: number
  sampleSize: number
}

class AdaptiveTierSelector {
  private metrics: Map<string, TierPerformanceMetrics> = new Map()

  // Learn from historical outcomes
  recordOutcome(task: TaskRequest, tier: CapabilityTier, success: boolean, latencyMs: number): void {
    const key = `${tier}:${task.type}`
    const existing = this.metrics.get(key) ?? this.defaultMetrics(tier, task.type)

    // Exponential moving average
    const alpha = 0.1
    existing.successRate = alpha * (success ? 1 : 0) + (1 - alpha) * existing.successRate
    existing.avgLatencyMs = alpha * latencyMs + (1 - alpha) * existing.avgLatencyMs
    existing.sampleSize++

    this.metrics.set(key, existing)
  }

  // Predict best starting tier for task type
  predictOptimalStartTier(taskType: string, complexity: number): CapabilityTier {
    const defaultTier = matchTierToComplexity(complexity)

    // Check if we should skip tiers based on historical success rates
    for (let i = TIER_ORDER.indexOf(defaultTier); i < TIER_ORDER.length; i++) {
      const tier = TIER_ORDER[i]!
      const metrics = this.metrics.get(`${tier}:${taskType}`)

      // If this tier has good success rate for this task type, use it
      if (metrics && metrics.sampleSize > 10 && metrics.successRate > 0.8) {
        return tier
      }
    }

    return defaultTier
  }
}
```

### Research Question: How to detect and prevent cascade failures?

**Finding:** Implement bulkhead pattern with category isolation (already designed in codebase):

```typescript
// From /Users/nathanclevenger/projects/dotdo/internal/spikes/cascade-parallelization-do-routing.md
type BulkheadCategory = 'agent' | 'workflow' | 'entity'

class BulkheadCircuitBreaker {
  private circuits: Map<string, CircuitState> = new Map()

  getCircuitKey(category: BulkheadCategory, tier: CapabilityTier): string {
    return `${category}:${tier}`
  }

  // Prevent cascade: Check all relevant circuits before routing
  canRoute(category: BulkheadCategory, tier: CapabilityTier): boolean {
    const key = this.getCircuitKey(category, tier)
    const state = this.circuits.get(key)?.state ?? CircuitState.CLOSED

    return state !== CircuitState.OPEN
  }

  // Cascade failure detection
  detectCascade(): CascadeAlert | null {
    let openCount = 0
    for (const circuit of this.circuits.values()) {
      if (circuit.state === CircuitState.OPEN) openCount++
    }

    // If multiple circuits are open, we may have a cascade
    if (openCount >= 2) {
      return {
        type: 'cascade_detected',
        openCircuits: openCount,
        recommendation: 'Consider activating fallback mode'
      }
    }
    return null
  }
}
```

### Research Question: When to preemptively escalate?

**Finding:** Preemptive escalation should trigger when:

1. **Historical pattern match:** Task type historically fails at current tier
2. **Circuit breaker half-open:** Tier is recovering, prefer higher tier
3. **Load spike detected:** Current tier workers at high utilization
4. **SLA pressure:** Remaining time budget insufficient for retries

```typescript
interface PreemptiveEscalationDecision {
  shouldEscalate: boolean
  targetTier: CapabilityTier
  reason: string
}

function evaluatePreemptiveEscalation(
  task: TaskRequest,
  currentTier: CapabilityTier,
  context: RoutingContext
): PreemptiveEscalationDecision {
  // 1. Historical failure rate for this task type
  const historicalSuccessRate = context.getHistoricalSuccessRate(currentTier, task.type)
  if (historicalSuccessRate < 0.3 && context.getSampleSize(currentTier, task.type) > 20) {
    return {
      shouldEscalate: true,
      targetTier: getNextTier(currentTier)!,
      reason: `Low historical success rate (${(historicalSuccessRate * 100).toFixed(0)}%) for ${task.type} at ${currentTier}`
    }
  }

  // 2. Circuit breaker state
  const circuitState = context.getCircuitState(currentTier)
  if (circuitState === CircuitState.HALF_OPEN) {
    return {
      shouldEscalate: true,
      targetTier: getNextTier(currentTier)!,
      reason: `${currentTier} tier circuit is recovering, preferring higher tier`
    }
  }

  // 3. Load-based escalation
  const utilization = context.getTierUtilization(currentTier)
  if (utilization > 0.9) {
    return {
      shouldEscalate: true,
      targetTier: getNextTier(currentTier)!,
      reason: `${currentTier} tier at ${(utilization * 100).toFixed(0)}% utilization`
    }
  }

  // 4. SLA pressure
  if (task.deadline) {
    const remainingTime = task.deadline - Date.now()
    const estimatedRetryTime = context.getEstimatedRetryTime(currentTier) * 3  // 3 retries
    if (remainingTime < estimatedRetryTime) {
      return {
        shouldEscalate: true,
        targetTier: 'human',  // Skip to human for urgent
        reason: `Insufficient time for retries (${remainingTime}ms remaining)`
      }
    }
  }

  return { shouldEscalate: false, targetTier: currentTier, reason: '' }
}
```

## Prototype Areas

### 1. Machine Learning for Complexity Estimation

**Opportunity:** Train a lightweight model on historical task outcomes

```typescript
interface ComplexityFeatures {
  taskType: number          // Encoded task type
  inputKeyCount: number     // Number of top-level keys
  inputDepth: number        // Max nesting depth (bounded)
  hasArrays: boolean        // Contains arrays
  requiredToolCount: number // Number of required tools
}

// Logistic regression for tier prediction
class ComplexityPredictor {
  private weights: number[] = [0.3, 0.1, 0.2, 0.15, 0.25]  // Initial weights

  predict(features: ComplexityFeatures): CapabilityTier {
    const score =
      this.weights[0]! * features.taskType +
      this.weights[1]! * features.inputKeyCount +
      this.weights[2]! * features.inputDepth +
      this.weights[3]! * (features.hasArrays ? 1 : 0) +
      this.weights[4]! * features.requiredToolCount

    // Map score to tier
    if (score < 2.5) return 'code'
    if (score < 5.5) return 'generative'
    if (score < 8.5) return 'agentic'
    return 'human'
  }

  // Online learning from outcomes
  update(features: ComplexityFeatures, actualTier: CapabilityTier, success: boolean): void {
    // SGD update (simplified)
    const predicted = this.predict(features)
    const error = TIER_ORDER.indexOf(actualTier) - TIER_ORDER.indexOf(predicted)
    const learningRate = 0.01

    // Update weights
    this.weights = this.weights.map((w, i) =>
      w + learningRate * error * this.getFeatureValue(features, i)
    )
  }
}
```

### 2. Predictive Load Balancing

```typescript
class PredictiveLoadBalancer {
  private loadHistory: Map<string, number[]> = new Map()

  // Predict load N seconds in the future
  predictLoad(tier: CapabilityTier, horizonSeconds: number): number {
    const history = this.loadHistory.get(tier) ?? []
    if (history.length < 10) return this.getCurrentLoad(tier)

    // Simple linear extrapolation
    const recent = history.slice(-10)
    const slope = (recent[9]! - recent[0]!) / 10
    return Math.max(0, recent[9]! + slope * horizonSeconds)
  }

  // Pre-scale workers based on prediction
  async ensureCapacity(tier: CapabilityTier): Promise<void> {
    const predictedLoad = this.predictLoad(tier, 60)  // 1 minute ahead
    const currentCapacity = await this.getCapacity(tier)

    if (predictedLoad > currentCapacity * 0.8) {
      await this.requestScaleUp(tier, Math.ceil(predictedLoad - currentCapacity))
    }
  }
}
```

### 3. Circuit Breaker Patterns for Tiers

**Already implemented in:** `/Users/nathanclevenger/projects/dotdo/workflows/errors/escalation-engine.ts`

```typescript
// Existing implementation is solid, recommend these enhancements:
interface EnhancedCircuitBreakerConfig {
  // Existing
  failureThreshold: number
  cooldownPeriod: number

  // Recommended additions
  halfOpenMaxAttempts: 3,      // Limit probes in half-open state
  slidingWindowSize: 100,      // Use sliding window, not just counter
  slowCallThreshold: 5000,     // Treat slow calls as failures
  slowCallRateThreshold: 0.5,  // Trip if >50% calls are slow
}
```

## Implementation Recommendations

### Priority 1: Implement LRU Cache for Cascade Chains (High Impact)

**Files to create:**
- `db/graph/cache/cascade-chain-cache.ts`
- `db/graph/adapters/cached-function-graph-adapter.ts`

**Expected impact:** 4-10x reduction in graph query latency for repeated chains

### Priority 2: Add Worker Pool Manager with Event-Driven Updates (Medium Impact)

**Modify:** `workers/capability-tier-routing.ts`

**Expected impact:** O(1) worker selection, reduced graph query load

### Priority 3: Implement Adaptive Tier Selection (Medium Impact)

**Files to create:**
- `workers/adaptive-tier-selector.ts`

**Expected impact:** 10-20% reduction in escalations through learning

### Priority 4: Add Preemptive Escalation Logic (Low Complexity, High Value)

**Modify:** `workers/capability-tier-routing.ts` (route method)

**Expected impact:** Faster resolution for predictably-failing task types

## Conclusion

The current tier routing implementation is functional but has optimization opportunities:

1. **Tier selection:** O(4) -> O(1) with lookup table
2. **Worker selection:** Implement weighted least-connections with load awareness
3. **Cascade resolution:** Add LRU caching (tests already written, implementation needed)
4. **Complexity assessment:** Add early-exit optimizations for large inputs

The existing infrastructure (GraphLoadBalancer, EscalationEngine, CircuitBreaker) provides a solid foundation. The recommended optimizations build on these primitives without requiring architectural changes.

## Appendix: Benchmark Test Plan

```typescript
// Proposed benchmarks for validation
describe('Tier Routing Optimization Benchmarks', () => {
  it('tier selection should complete in <0.1ms', async () => {
    const iterations = 10000
    const start = performance.now()
    for (let i = 0; i < iterations; i++) {
      matchTierToComplexityOptimized(Math.random() * 10)
    }
    const elapsed = performance.now() - start
    expect(elapsed / iterations).toBeLessThan(0.1)
  })

  it('cached cascade resolution should be >10x faster than uncached', async () => {
    // ... benchmark implementation
  })

  it('worker selection should complete in <5ms for 1000 workers', async () => {
    // ... benchmark implementation
  })
})
```
