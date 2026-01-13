# Cascade Parallelization and DO Routing

**Issue:** dotdo-brzfm
**Date:** 2026-01-13
**Author:** Research Spike
**Status:** COMPLETE

## Executive Summary

This spike investigates cascade parallelization patterns and Durable Object (DO) routing strategies for load distribution in the dotdo platform. Based on codebase analysis, we find robust existing infrastructure for parallel execution, load balancing, and circuit breaker patterns that can be leveraged and extended for cascade operations.

### Key Findings

| Area | Finding | Recommendation |
|------|---------|----------------|
| Parallel Execution | `Promise.all/allSettled` widely used | Extend with `CascadeExecutor` batching |
| DO Routing | Graph-based load balancing exists | Integrate with hostname-proxy for cascade distribution |
| Error Handling | Circuit breaker patterns defined | Implement `BulkheadCircuitBreaker` for category isolation |
| Fan-out/Fan-in | `PipelinePromise` supports parallel analysis | Add explicit cascade stages |

## Current State Analysis

### 1. Existing Parallel Execution Patterns

The codebase uses several parallel execution patterns:

#### CascadeExecutor (`lib/executors/CascadeExecutor.ts`)

```typescript
// Batches independent operations for parallel execution
export class CascadeExecutor {
  async executeBatch<T>(operations: CascadeOperation[]): Promise<T[]> {
    const { independent, dependent } = analyzeExpressions(operations)

    // Execute independent operations in parallel
    const results = await Promise.all(
      independent.map(op => this.execute(op))
    )

    // Then execute dependent operations
    return this.executeSequential(dependent, results)
  }
}
```

#### ParallelStepExecutor (`lib/executors/ParallelStepExecutor.ts`)

```typescript
// Workflow step execution with parallel branches
export class ParallelStepExecutor {
  async executeParallel<T>(steps: WorkflowStep[]): Promise<T[]> {
    return Promise.allSettled(
      steps.map(step => this.executeStep(step))
    ).then(results => this.handleSettledResults(results))
  }
}
```

#### PipelinePromise (`workflows/pipeline-promise.ts`)

The most sophisticated pattern - captures expressions for analysis:

```typescript
// Expression analysis for parallel execution
export function analyzeExpressions(expressions: PipelinePromise[]): {
  independent: PipelinePromise[]
  dependent: PipelinePromise[]
} {
  const independent: PipelinePromise[] = []
  const dependent: PipelinePromise[] = []

  const exprSet = new Set(expressions.map(e => e.__expr))

  for (const expr of expressions) {
    const deps = findDependencies(expr.__expr, exprSet)
    if (deps.length > 0) {
      dependent.push(expr)
    } else {
      independent.push(expr)
    }
  }

  return { independent, dependent }
}
```

### 2. DO Stub Routing Mechanisms

#### Hostname-Based Proxy (`workers/hostname-proxy.ts`)

Three routing modes for DO resolution:

```typescript
export interface ProxyConfig {
  mode: 'hostname' | 'path' | 'fixed'
  basepath?: string
  defaultNs?: string
  hostname?: { stripLevels?: number; rootDomain: string }
  fixed?: { namespace: string }
}

// Route resolution
function resolveNamespace(request: Request, config: ProxyConfig): string | null {
  switch (config.mode) {
    case 'fixed': return config.fixed?.namespace || null
    case 'hostname': /* Extract from subdomain */
    case 'path': /* Extract from URL path */
  }
}
```

#### Graph-Based Load Balancer (`workers/load-balancing-graph.ts`)

Comprehensive load balancing with multiple strategies:

```typescript
export type LoadBalancerStrategy = 'round-robin' | 'least-busy' | 'capability' | 'weighted'

export class GraphLoadBalancer {
  async route(
    task: TaskRequest,
    strategy: LoadBalancerStrategy,
    options?: RouteOptions
  ): Promise<RouteResult> {
    switch (strategy) {
      case 'round-robin': return this.routeRoundRobin(task)
      case 'least-busy': return this.routeLeastBusy(task, options)
      case 'capability': return this.routeCapability(task)
      case 'weighted': return this.routeWeighted(task)
    }
  }
}
```

Key features:
- **Round-robin**: Simple cyclic selection
- **Least-busy**: Selects worker with lowest current task count
- **Capability-based**: Routes to workers with required capabilities
- **Weighted**: Distributes based on worker weights

### 3. Error Handling Infrastructure

#### CompatError System (`packages/core/src/errors.ts`)

Unified error format across all SDKs:

```typescript
export class CompatError extends Error {
  public readonly code: string
  public readonly statusCode: number
  public readonly retryable: boolean

  constructor(options: CompatErrorOptions) {
    // Auto-determines retryable based on status code
    this.retryable = options.retryable ?? (this.statusCode >= 500 || this.statusCode === 429)
  }
}
```

Specialized error types:
- `ValidationError` (400)
- `AuthenticationError` (401)
- `AuthorizationError` (403)
- `NotFoundError` (404)
- `RateLimitError` (429) - with `retryAfter` support
- `ServiceError` (5xx) - retryable by default

#### Circuit Breaker Bulkhead Pattern (`objects/circuit-breaker-bulkhead.ts`)

Planned implementation for category isolation:

```typescript
type BulkheadCategory = 'agent' | 'workflow' | 'entity'

export class BulkheadCircuitBreaker {
  // Independent failure tracking per category
  recordFailure(category: BulkheadCategory, namespace: string): void
  recordSuccess(category: BulkheadCategory, namespace: string): void

  // Category-aware execution
  async execute<T>(
    category: BulkheadCategory,
    namespace: string,
    fn: () => Promise<T>
  ): Promise<T>

  // State: closed -> open -> half-open -> closed
  getState(category: BulkheadCategory, namespace: string): 'closed' | 'open' | 'half-open'
}
```

## Proposed Cascade Parallelization Architecture

### 1. Cascade Stage Model

```typescript
interface CascadeStage {
  id: string
  operations: CascadeOperation[]
  dependencies: string[]  // IDs of previous stages
  parallelism: 'full' | 'limited' | 'sequential'
  maxConcurrency?: number
}

interface CascadePlan {
  stages: CascadeStage[]
  routing: RoutingConfig
  errorHandling: ErrorConfig
}
```

### 2. Cascade Executor with DO Distribution

```typescript
class DistributedCascadeExecutor {
  private loadBalancer: GraphLoadBalancer
  private circuitBreaker: BulkheadCircuitBreaker

  async execute(plan: CascadePlan): Promise<CascadeResult> {
    const results: Map<string, unknown> = new Map()

    for (const stage of this.topologicalSort(plan.stages)) {
      // Wait for dependencies
      await this.waitForDependencies(stage, results)

      // Route and execute operations
      const stageResults = await this.executeStage(stage)
      results.set(stage.id, stageResults)
    }

    return { results, metrics: this.collectMetrics() }
  }

  private async executeStage(stage: CascadeStage): Promise<unknown[]> {
    const operations = stage.operations.map(async op => {
      // Route to appropriate DO
      const route = await this.loadBalancer.route({
        id: op.id,
        type: op.type,
        requiredCapabilities: op.capabilities,
      }, 'least-busy')

      if (!route.workerId) {
        throw new ServiceError({ message: 'No worker available' })
      }

      // Execute with circuit breaker
      return this.circuitBreaker.execute(
        this.categorize(op),
        route.endpoint!,
        () => this.executeOnDO(route, op)
      )
    })

    switch (stage.parallelism) {
      case 'full':
        return Promise.all(operations)
      case 'limited':
        return this.executeWithConcurrencyLimit(operations, stage.maxConcurrency!)
      case 'sequential':
        return this.executeSequentially(operations)
    }
  }
}
```

### 3. Fan-Out/Fan-In Pattern

```typescript
interface FanOutConfig {
  source: CascadeOperation
  targets: DODescriptor[]
  aggregator: AggregatorFunction
  timeout: number
  partialResultPolicy: 'fail' | 'continue' | 'best-effort'
}

class FanOutExecutor {
  async execute<T, R>(config: FanOutConfig): Promise<R> {
    const startTime = Date.now()
    const results: Map<string, T | Error> = new Map()

    // Fan-out: dispatch to all targets in parallel
    const promises = config.targets.map(async target => {
      try {
        const route = await this.router.routeTo(target)
        const result = await this.executeWithTimeout(
          route,
          config.source,
          config.timeout
        )
        results.set(target.id, result)
      } catch (error) {
        results.set(target.id, error as Error)
      }
    })

    // Wait for all with configurable policy
    if (config.partialResultPolicy === 'fail') {
      await Promise.all(promises)
    } else {
      await Promise.allSettled(promises)
    }

    // Fan-in: aggregate results
    return config.aggregator(results, {
      elapsed: Date.now() - startTime,
      totalTargets: config.targets.length,
      successCount: [...results.values()].filter(r => !(r instanceof Error)).length,
    })
  }
}
```

### 4. Load Balancing Integration

```typescript
interface CascadeRoutingConfig {
  strategy: LoadBalancerStrategy
  affinityKey?: string  // Route related operations to same DO
  locality: 'any' | 'same-colo' | 'same-region'
  fallback: 'queue' | 'reject' | 'retry'
}

class CascadeRouter {
  async routeCascade(
    cascade: CascadePlan,
    config: CascadeRoutingConfig
  ): Promise<Map<string, RouteResult>> {
    const routes = new Map<string, RouteResult>()

    // Group operations by affinity key for co-location
    const groups = this.groupByAffinity(cascade, config.affinityKey)

    for (const [affinityKey, operations] of groups) {
      // All operations in group go to same DO
      const route = await this.loadBalancer.route({
        id: affinityKey,
        type: 'cascade-group',
        requiredCapabilities: this.mergeCapabilities(operations),
      }, config.strategy)

      for (const op of operations) {
        routes.set(op.id, route)
      }
    }

    return routes
  }
}
```

## Prototype: Cascade Parallelization

### Type Definitions

```typescript
// /lib/cascade/types.ts

export type CascadeParallelism = 'full' | 'limited' | 'sequential'

export interface CascadeOperation<T = unknown> {
  id: string
  type: string
  payload: T
  capabilities?: string[]
  timeout?: number
  retryable?: boolean
}

export interface CascadeStageConfig {
  parallelism: CascadeParallelism
  maxConcurrency?: number
  timeout?: number
  onPartialFailure?: 'abort' | 'continue' | 'collect'
}

export interface CascadeStage<T = unknown> {
  id: string
  operations: CascadeOperation<T>[]
  config: CascadeStageConfig
  dependencies: string[]
}

export interface CascadePlan {
  id: string
  stages: CascadeStage[]
  routing: {
    strategy: LoadBalancerStrategy
    affinityKey?: string
  }
  errorHandling: {
    circuitBreaker: boolean
    maxRetries: number
    backoffMs: number
  }
}

export interface CascadeResult<T = unknown> {
  planId: string
  stages: Map<string, StageResult<T>>
  metrics: CascadeMetrics
  errors: CascadeError[]
}

export interface StageResult<T = unknown> {
  stageId: string
  results: Map<string, T | Error>
  elapsed: number
  completed: number
  failed: number
}

export interface CascadeMetrics {
  totalElapsed: number
  stageTimings: Map<string, number>
  operationCount: number
  successCount: number
  failureCount: number
  retriedCount: number
}

export interface CascadeError {
  stageId: string
  operationId: string
  error: Error
  retried: boolean
  fatal: boolean
}
```

### Cascade Executor Implementation

```typescript
// /lib/cascade/executor.ts

import { GraphLoadBalancer, RouteResult } from '../../workers/load-balancing-graph'
import { BulkheadCircuitBreaker } from '../../objects/circuit-breaker-bulkhead'
import { ServiceError, RateLimitError } from '../../packages/core/src/errors'
import type {
  CascadePlan,
  CascadeResult,
  CascadeStage,
  CascadeOperation,
  CascadeError,
  StageResult
} from './types'

export class CascadeExecutor {
  constructor(
    private loadBalancer: GraphLoadBalancer,
    private circuitBreaker: BulkheadCircuitBreaker,
    private doInvoker: DOInvoker
  ) {}

  async execute<T>(plan: CascadePlan): Promise<CascadeResult<T>> {
    const startTime = Date.now()
    const stageResults = new Map<string, StageResult<T>>()
    const errors: CascadeError[] = []
    let operationCount = 0
    let successCount = 0
    let failureCount = 0
    let retriedCount = 0

    // Topological sort to respect dependencies
    const sortedStages = this.topologicalSort(plan.stages)

    for (const stage of sortedStages) {
      // Wait for all dependency stages to complete
      for (const depId of stage.dependencies) {
        const depResult = stageResults.get(depId)
        if (!depResult || depResult.failed > 0) {
          // Check failure policy
          if (stage.config.onPartialFailure === 'abort') {
            throw new Error(`Dependency stage ${depId} failed`)
          }
        }
      }

      // Execute stage
      const stageResult = await this.executeStage(stage, plan)
      stageResults.set(stage.id, stageResult)

      // Collect metrics
      operationCount += stage.operations.length
      successCount += stageResult.completed
      failureCount += stageResult.failed

      // Collect errors
      for (const [opId, result] of stageResult.results) {
        if (result instanceof Error) {
          errors.push({
            stageId: stage.id,
            operationId: opId,
            error: result,
            retried: false, // Would be tracked in actual implementation
            fatal: stage.config.onPartialFailure === 'abort',
          })
        }
      }
    }

    return {
      planId: plan.id,
      stages: stageResults,
      metrics: {
        totalElapsed: Date.now() - startTime,
        stageTimings: new Map([...stageResults].map(
          ([id, r]) => [id, r.elapsed]
        )),
        operationCount,
        successCount,
        failureCount,
        retriedCount,
      },
      errors,
    }
  }

  private async executeStage<T>(
    stage: CascadeStage,
    plan: CascadePlan
  ): Promise<StageResult<T>> {
    const startTime = Date.now()
    const results = new Map<string, T | Error>()

    // Route all operations
    const routes = await this.routeOperations(stage.operations, plan.routing)

    // Execute based on parallelism mode
    switch (stage.config.parallelism) {
      case 'full':
        await this.executeParallel(stage, routes, results, plan)
        break
      case 'limited':
        await this.executeLimited(
          stage,
          routes,
          results,
          plan,
          stage.config.maxConcurrency ?? 10
        )
        break
      case 'sequential':
        await this.executeSequential(stage, routes, results, plan)
        break
    }

    return {
      stageId: stage.id,
      results,
      elapsed: Date.now() - startTime,
      completed: [...results.values()].filter(r => !(r instanceof Error)).length,
      failed: [...results.values()].filter(r => r instanceof Error).length,
    }
  }

  private async executeParallel<T>(
    stage: CascadeStage,
    routes: Map<string, RouteResult>,
    results: Map<string, T | Error>,
    plan: CascadePlan
  ): Promise<void> {
    const promises = stage.operations.map(op =>
      this.executeOperation(op, routes.get(op.id)!, plan)
        .then(result => results.set(op.id, result as T))
        .catch(error => results.set(op.id, error))
    )

    await Promise.allSettled(promises)
  }

  private async executeLimited<T>(
    stage: CascadeStage,
    routes: Map<string, RouteResult>,
    results: Map<string, T | Error>,
    plan: CascadePlan,
    limit: number
  ): Promise<void> {
    const queue = [...stage.operations]
    const inFlight = new Set<Promise<void>>()

    while (queue.length > 0 || inFlight.size > 0) {
      // Fill up to concurrency limit
      while (inFlight.size < limit && queue.length > 0) {
        const op = queue.shift()!
        const promise = this.executeOperation(op, routes.get(op.id)!, plan)
          .then(result => results.set(op.id, result as T))
          .catch(error => results.set(op.id, error))
          .finally(() => inFlight.delete(promise))
        inFlight.add(promise)
      }

      // Wait for at least one to complete
      if (inFlight.size > 0) {
        await Promise.race(inFlight)
      }
    }
  }

  private async executeSequential<T>(
    stage: CascadeStage,
    routes: Map<string, RouteResult>,
    results: Map<string, T | Error>,
    plan: CascadePlan
  ): Promise<void> {
    for (const op of stage.operations) {
      try {
        const result = await this.executeOperation(op, routes.get(op.id)!, plan)
        results.set(op.id, result as T)
      } catch (error) {
        results.set(op.id, error as Error)
        if (stage.config.onPartialFailure === 'abort') {
          break
        }
      }
    }
  }

  private async executeOperation<T>(
    operation: CascadeOperation,
    route: RouteResult,
    plan: CascadePlan
  ): Promise<T> {
    if (!route.workerId) {
      throw new ServiceError({
        message: `No worker available for operation ${operation.id}`,
        service: 'cascade-executor',
      })
    }

    const category = this.categorizeOperation(operation)

    // Execute with circuit breaker protection
    return this.circuitBreaker.execute(
      category,
      route.endpoint!,
      async () => {
        const result = await this.doInvoker.invoke(
          route.endpoint!,
          operation,
          operation.timeout ?? 30000
        )
        return result as T
      }
    )
  }

  private categorizeOperation(op: CascadeOperation): 'agent' | 'workflow' | 'entity' {
    if (op.type.startsWith('agent.')) return 'agent'
    if (op.type.startsWith('workflow.')) return 'workflow'
    return 'entity'
  }

  private async routeOperations(
    operations: CascadeOperation[],
    routing: CascadePlan['routing']
  ): Promise<Map<string, RouteResult>> {
    const routes = new Map<string, RouteResult>()

    for (const op of operations) {
      const route = await this.loadBalancer.route({
        id: op.id,
        type: op.type,
        requiredCapabilities: op.capabilities,
      }, routing.strategy)

      routes.set(op.id, route)
    }

    return routes
  }

  private topologicalSort(stages: CascadeStage[]): CascadeStage[] {
    const result: CascadeStage[] = []
    const visited = new Set<string>()
    const visiting = new Set<string>()
    const stageMap = new Map(stages.map(s => [s.id, s]))

    const visit = (stage: CascadeStage) => {
      if (visited.has(stage.id)) return
      if (visiting.has(stage.id)) {
        throw new Error(`Circular dependency detected at stage ${stage.id}`)
      }

      visiting.add(stage.id)

      for (const depId of stage.dependencies) {
        const dep = stageMap.get(depId)
        if (dep) visit(dep)
      }

      visiting.delete(stage.id)
      visited.add(stage.id)
      result.push(stage)
    }

    for (const stage of stages) {
      visit(stage)
    }

    return result
  }
}

// DO Invoker interface
interface DOInvoker {
  invoke(endpoint: string, operation: CascadeOperation, timeout: number): Promise<unknown>
}
```

## Recommendations

### Immediate Actions

1. **Implement `BulkheadCircuitBreaker`**: The test file exists but implementation is missing. This is critical for preventing agent failures from cascading to workflows.

2. **Add affinity routing to hostname-proxy**: Currently routes statically. Add support for:
   ```typescript
   const config: ProxyConfig = {
     mode: 'affinity',
     affinityHeader: 'X-Cascade-Affinity',
     // Routes requests with same affinity to same DO
   }
   ```

3. **Integrate load balancer with CascadeExecutor**: The `GraphLoadBalancer` has all needed strategies; wire it into cascade execution.

### Medium-Term Improvements

1. **Add cascade-specific metrics**:
   - `cascade.stage.duration` - per-stage timing
   - `cascade.operation.failures` - failure rates by operation type
   - `cascade.concurrency.active` - active parallel operations

2. **Implement partial result handling**: Currently most patterns are all-or-nothing. Add:
   ```typescript
   interface PartialResultConfig {
     minSuccess: number | 'majority' | 'all'
     fallback: (partial: Map<string, T | Error>) => T
   }
   ```

3. **Add priority queue for operations**: Some cascades may have urgent operations that should be executed first regardless of stage order.

### Long-Term Architecture

1. **Cascade DAG visualization**: Build tooling to visualize cascade execution plans and actual execution traces.

2. **Adaptive parallelism**: Automatically adjust concurrency based on:
   - Worker health metrics
   - Current system load
   - Historical performance data

3. **Cascade checkpointing**: For long-running cascades, checkpoint progress to enable resume after failure.

## Conclusion

The dotdo codebase has strong foundations for cascade parallelization:

- **`PipelinePromise`** provides expression analysis for dependency detection
- **`GraphLoadBalancer`** offers multiple load balancing strategies
- **`CompatError`** provides unified error handling with retryability
- **`BulkheadCircuitBreaker`** (in TDD red phase) will provide fault isolation

The proposed `CascadeExecutor` builds on these primitives to provide a complete solution for parallel cascade execution with DO routing, error handling, and observability.

Key metrics to track after implementation:
- Cascade completion rate
- Average cascade latency by stage count
- Circuit breaker open rate by category
- Worker utilization distribution
