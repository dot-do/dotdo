/**
 * @dotdo/rpc - Cap'n Web RPC Promise Pipelining
 *
 * Implements Cap'n Proto style promise pipelining for efficient RPC:
 * - Multiple dependent calls execute in a single network round trip
 * - Pipeline references allow chaining without awaiting intermediate results
 * - Automatic dependency resolution and parallel execution
 *
 * Key pattern: A calls B which calls C -> single round trip
 *
 * @example
 * ```typescript
 * const proxy = createPipelineProxy<UserService>(executor)
 *
 * // Build a pipeline (no network calls yet)
 * const userPromise = proxy.getUser('user-123')
 * const postsPromise = userPromise.getPosts()
 * const titlePromise = postsPromise[0].title
 *
 * // Execute entire pipeline in single round trip
 * const title = await resolvePipeline(titlePromise)
 * ```
 *
 * @module @dotdo/rpc/pipeline
 */

// =============================================================================
// Types
// =============================================================================

/**
 * A single call in the pipeline
 */
export interface PipelineCall {
  /** Unique ID for this call */
  id: string
  /** Method to invoke */
  method: string
  /** Arguments for the method */
  args?: unknown[]
  /** Property name for __get__ operations */
  property?: string
  /** Target promise ID for chained calls */
  targetPromiseId?: string
  /** Pipeline arguments (references to other promises) */
  pipelineArgs?: PipelineArg[]
  /** Resolved arguments (filled in during execution) */
  resolvedArgs?: unknown[]
}

/**
 * Pipeline argument that references another promise
 */
export interface PipelineArg {
  type: 'value' | 'promise'
  value?: unknown
  promiseId?: string
}

/**
 * Result of executing a pipeline call
 */
export interface PipelineResult {
  /** Result value on success */
  value?: unknown
  /** Error on failure */
  error?: PipelineError
}

/**
 * Pipeline error structure
 */
export interface PipelineError {
  code: string
  message: string
  data?: unknown
}

/**
 * Serialized pipeline for transport
 */
export interface SerializedPipeline {
  calls: PipelineCall[]
}

/**
 * Handler function for executing a single pipeline call
 */
export type PipelineHandler = (
  call: PipelineCall,
  results: Map<string, PipelineResult>
) => Promise<unknown>

// =============================================================================
// ID Generation
// =============================================================================

let pipelineCallId = 0

function generateCallId(): string {
  return `pipe_${++pipelineCallId}`
}

/**
 * Reset call ID counter (for testing)
 */
export function resetPipelineCallIdCounter(): void {
  pipelineCallId = 0
}

// =============================================================================
// PipelineCollector
// =============================================================================

/**
 * Collects pipeline calls and manages dependencies
 */
export class PipelineCollector {
  calls: PipelineCall[] = []
  private dependencies = new Map<string, Set<string>>()

  /**
   * Add a call to the pipeline
   */
  addCall(call: Omit<PipelineCall, 'id'> & { id?: string }): string {
    const id = call.id ?? generateCallId()
    const fullCall: PipelineCall = { ...call, id }
    this.calls.push(fullCall)

    // Track dependencies
    const deps = new Set<string>()

    if (call.targetPromiseId) {
      deps.add(call.targetPromiseId)
    }

    if (call.pipelineArgs) {
      for (const arg of call.pipelineArgs) {
        if (arg.type === 'promise' && arg.promiseId) {
          deps.add(arg.promiseId)
        }
      }
    }

    this.dependencies.set(id, deps)

    return id
  }

  /**
   * Get dependencies for a call
   */
  getDependencies(callId: string): string[] {
    return Array.from(this.dependencies.get(callId) || [])
  }

  /**
   * Build execution stages using topological sort
   * Each stage contains calls that can run in parallel
   */
  buildExecutionStages(): PipelineCall[][] {
    // Create reverse dependency map (dependents)
    const dependents = new Map<string, Set<string>>()
    const callMap = new Map(this.calls.map((c) => [c.id, c]))

    for (const call of this.calls) {
      if (!dependents.has(call.id)) {
        dependents.set(call.id, new Set())
      }

      const deps = this.dependencies.get(call.id) || new Set()
      for (const dep of deps) {
        if (!dependents.has(dep)) {
          dependents.set(dep, new Set())
        }
        dependents.get(dep)!.add(call.id)
      }
    }

    // Kahn's algorithm for topological sort
    const inDegree = new Map<string, number>()
    const remaining = new Set(this.calls.map((c) => c.id))

    // Calculate initial in-degrees
    for (const call of this.calls) {
      const deps = this.dependencies.get(call.id) || new Set()
      // Only count dependencies within this batch
      const validDeps = [...deps].filter((d) => callMap.has(d))
      inDegree.set(call.id, validDeps.length)
    }

    const stages: PipelineCall[][] = []

    while (remaining.size > 0) {
      // Find all nodes with in-degree 0
      const stage: PipelineCall[] = []
      for (const id of remaining) {
        if ((inDegree.get(id) || 0) === 0) {
          const call = callMap.get(id)
          if (call) {
            stage.push(call)
          }
        }
      }

      if (stage.length === 0) {
        // No progress possible - circular dependency
        const cycle = this.findCycle(remaining, this.dependencies)
        throw new Error(`Circular dependency detected: ${cycle.join(' -> ')}`)
      }

      // Remove nodes from remaining and update in-degrees
      for (const call of stage) {
        remaining.delete(call.id)
        const deps = dependents.get(call.id) || new Set()
        for (const depId of deps) {
          const degree = inDegree.get(depId) || 0
          inDegree.set(depId, degree - 1)
        }
      }

      stages.push(stage)
    }

    return stages
  }

  /**
   * Find a cycle in the dependency graph for error reporting
   */
  private findCycle(remaining: Set<string>, dependencies: Map<string, Set<string>>): string[] {
    const visited = new Set<string>()
    const path: string[] = []
    const pathSet = new Set<string>()

    const dfs = (node: string): string[] | null => {
      if (pathSet.has(node)) {
        const cycleStart = path.indexOf(node)
        return [...path.slice(cycleStart), node]
      }

      if (visited.has(node)) {
        return null
      }

      visited.add(node)
      path.push(node)
      pathSet.add(node)

      const deps = dependencies.get(node) || new Set()
      for (const dep of deps) {
        if (remaining.has(dep)) {
          const cycle = dfs(dep)
          if (cycle) return cycle
        }
      }

      path.pop()
      pathSet.delete(node)
      return null
    }

    for (const node of remaining) {
      const cycle = dfs(node)
      if (cycle) return cycle
    }

    return ['unknown cycle']
  }

  /**
   * Serialize the pipeline for HTTP transport
   */
  serialize(): SerializedPipeline {
    return {
      calls: this.calls.map((call) => ({
        id: call.id,
        method: call.method,
        ...(call.args !== undefined && { args: call.args }),
        ...(call.property !== undefined && { property: call.property }),
        ...(call.targetPromiseId !== undefined && { targetPromiseId: call.targetPromiseId }),
        ...(call.pipelineArgs !== undefined && { pipelineArgs: call.pipelineArgs }),
      })),
    }
  }

  /**
   * Clear all calls
   */
  clear(): void {
    this.calls = []
    this.dependencies.clear()
  }
}

// =============================================================================
// PipelinePromise
// =============================================================================

/** Symbol to identify pipeline promises */
const PIPELINE_PROMISE_SYMBOL = Symbol('PipelinePromise')

/**
 * A promise-like object that captures method chains for pipelining
 */
export class PipelinePromise<T = unknown> {
  [PIPELINE_PROMISE_SYMBOL] = true

  readonly callId: string
  private collector: PipelineCollector

  constructor(
    collector: PipelineCollector,
    method: string,
    args?: unknown[],
    targetPromiseId?: string,
    property?: string
  ) {
    this.collector = collector

    this.callId = collector.addCall({
      method,
      args,
      targetPromiseId,
      property,
    })
  }

  /**
   * Proxy handler for chaining method calls and property access
   */
  private createChainProxy(): T & PipelinePromise<T> {
    return new Proxy(this as unknown as T & PipelinePromise<T>, {
      get: (target, prop) => {
        // Return own properties
        if (prop === PIPELINE_PROMISE_SYMBOL) return true
        if (prop === 'callId') return this.callId
        if (prop === 'collector') return this.collector

        // Handle Promise-like properties to prevent confusion
        if (prop === 'then' || prop === 'catch' || prop === 'finally') {
          return undefined
        }

        // Handle symbols
        if (typeof prop === 'symbol') {
          return undefined
        }

        const propStr = String(prop)

        // Handle array-like methods
        if (propStr === 'map') {
          return (mapFn: (item: unknown) => unknown) => {
            // Extract property from map function (simplified)
            // In real use, we analyze the function to extract property access
            const mapSpec = extractMapSpec(mapFn)
            return new PipelinePromise(
              this.collector,
              '__map__',
              [mapSpec],
              this.callId
            ).createChainProxy()
          }
        }

        if (propStr === 'filter') {
          return (filterFn: (item: unknown) => boolean) => {
            const filterSpec = extractFilterSpec(filterFn)
            return new PipelinePromise(
              this.collector,
              '__filter__',
              [filterSpec],
              this.callId
            ).createChainProxy()
          }
        }

        // Property access creates a __get__ call
        if (/^\d+$/.test(propStr)) {
          // Array index access
          return new PipelinePromise(
            this.collector,
            '__get__',
            undefined,
            this.callId,
            propStr
          ).createChainProxy()
        }

        // Create a function that returns a new PipelinePromise when called
        const methodProxy = (...args: unknown[]) => {
          return new PipelinePromise(
            this.collector,
            propStr,
            args,
            this.callId
          ).createChainProxy()
        }

        // Also allow property access (for cases like user.name)
        // Return a Proxy that can be both called and accessed
        return new Proxy(methodProxy, {
          get: (_, nestedProp) => {
            if (nestedProp === 'then' || nestedProp === 'catch' || nestedProp === 'finally') {
              // Property access, not method call
              const propPromise = new PipelinePromise(
                this.collector,
                '__get__',
                undefined,
                this.callId,
                propStr
              )
              // Now access the nested property
              return propPromise.createChainProxy()[nestedProp as keyof T]
            }
            if (typeof nestedProp === 'symbol') {
              return undefined
            }
            // Direct property access: user.name (not user.name())
            const propPromise = new PipelinePromise(
              this.collector,
              '__get__',
              undefined,
              this.callId,
              propStr
            )
            return propPromise.createChainProxy()[nestedProp as keyof T]
          },
          apply: (_, thisArg, args) => {
            return methodProxy(...args)
          },
        })
      },
      apply: (target, thisArg, args) => {
        // This shouldn't be called directly on PipelinePromise
        throw new Error('PipelinePromise cannot be called directly')
      },
    })
  }

  /**
   * Get the chainable proxy for this promise
   */
  static create<T>(
    collector: PipelineCollector,
    method: string,
    args?: unknown[],
    targetPromiseId?: string
  ): T & PipelinePromise<T> {
    const promise = new PipelinePromise<T>(collector, method, args, targetPromiseId)
    return promise.createChainProxy()
  }

  // Make PipelinePromise properties accessible via getter
  getProfile(): PipelinePromise<unknown> & unknown {
    return new PipelinePromise(
      this.collector,
      'getProfile',
      undefined,
      this.callId
    ).createChainProxy() as PipelinePromise<unknown> & unknown
  }

  get name(): PipelinePromise<string> & string {
    return new PipelinePromise(
      this.collector,
      '__get__',
      undefined,
      this.callId,
      'name'
    ).createChainProxy() as unknown as PipelinePromise<string> & string
  }

  // Array-like access
  [index: number]: PipelinePromise<unknown>
}

// Add dynamic property access support
const pipelinePromiseProto = PipelinePromise.prototype

Object.defineProperty(pipelinePromiseProto, Symbol.iterator, {
  value: function* (this: PipelinePromise) {
    // Not really iterable, but needed for type compatibility
    throw new Error('PipelinePromise is not iterable - use resolvePipeline() first')
  },
})

/**
 * Extract map specification from a map function
 */
function extractMapSpec(mapFn: (item: unknown) => unknown): { property: string } {
  // Simple extraction - looks for property access pattern
  const fnStr = mapFn.toString()
  const match = fnStr.match(/\.(\w+)(?:\s*\)|$)/)
  if (match) {
    return { property: match[1] }
  }
  // Fallback: assume identity
  return { property: '' }
}

/**
 * Extract filter specification from a filter function
 */
function extractFilterSpec(filterFn: (item: unknown) => boolean): { property: string; equals: unknown } {
  const fnStr = filterFn.toString()
  // Match patterns like: item.active === true, x.foo === 'bar'
  const match = fnStr.match(/\.(\w+)\s*===?\s*(true|false|'[^']*'|"[^"]*"|\d+)/)
  if (match) {
    let value: unknown = match[2]
    if (value === 'true') value = true
    else if (value === 'false') value = false
    else if (/^['"]/.test(value as string)) value = (value as string).slice(1, -1)
    else if (/^\d+$/.test(value as string)) value = parseInt(value as string, 10)

    return { property: match[1], equals: value }
  }
  return { property: '', equals: undefined }
}

/**
 * Check if a value is a PipelinePromise (or lazy accessor)
 */
export function isPipelinePromise(value: unknown): value is PipelinePromise {
  if (value === null || value === undefined) {
    return false
  }
  // Check for objects and functions (lazy accessors are function proxies)
  if (typeof value !== 'object' && typeof value !== 'function') {
    return false
  }
  // Check for the pipeline promise symbol
  try {
    return PIPELINE_PROMISE_SYMBOL in (value as object)
  } catch {
    return false
  }
}

// =============================================================================
// PipelineExecutor
// =============================================================================

/**
 * Executes pipeline calls with dependency resolution
 */
export class PipelineExecutor {
  private handler: PipelineHandler

  constructor(handler: PipelineHandler) {
    this.handler = handler
  }

  /**
   * Execute a batch of pipeline calls
   */
  async execute(calls: PipelineCall[]): Promise<Map<string, PipelineResult>> {
    const collector = new PipelineCollector()
    for (const call of calls) {
      collector.addCall(call)
    }

    const results = new Map<string, PipelineResult>()
    const stages = collector.buildExecutionStages()

    for (const stage of stages) {
      // Execute all calls in stage in parallel
      const stagePromises = stage.map(async (call) => {
        // Check if any dependency failed
        const deps = collector.getDependencies(call.id)
        for (const depId of deps) {
          const depResult = results.get(depId)
          if (depResult?.error) {
            return {
              id: call.id,
              result: {
                error: {
                  code: 'DEPENDENCY_FAILED',
                  message: `Dependency ${depId} failed: ${depResult.error.message}`,
                },
              },
            }
          }
        }

        // Resolve pipeline arguments
        const resolvedArgs = await this.resolveArgs(call, results)
        const enrichedCall = { ...call, resolvedArgs }

        try {
          const value = await this.handler(enrichedCall, results)
          return { id: call.id, result: { value } }
        } catch (error) {
          return {
            id: call.id,
            result: {
              error: {
                code: 'EXECUTION_ERROR',
                message: error instanceof Error ? error.message : String(error),
              },
            },
          }
        }
      })

      const stageResults = await Promise.all(stagePromises)

      for (const { id, result } of stageResults) {
        results.set(id, result)
      }
    }

    return results
  }

  /**
   * Resolve pipeline arguments to actual values
   */
  private async resolveArgs(
    call: PipelineCall,
    results: Map<string, PipelineResult>
  ): Promise<unknown[] | undefined> {
    if (!call.pipelineArgs) {
      return call.args
    }

    return call.pipelineArgs.map((arg) => {
      if (arg.type === 'value') {
        return arg.value
      }
      if (arg.type === 'promise' && arg.promiseId) {
        return results.get(arg.promiseId)?.value
      }
      return undefined
    })
  }
}

// =============================================================================
// Pipeline Proxy Factory
// =============================================================================

/** Symbol to get collector from proxy */
const PIPELINE_COLLECTOR_SYMBOL = Symbol('PipelineCollector')

/**
 * Create a pipeline proxy for building call chains
 */
function _createPipelineProxy<T>(executor: PipelineExecutor): T {
  const collector = new PipelineCollector()

  const proxy = new Proxy({} as T, {
    get(target, prop) {
      if (prop === PIPELINE_COLLECTOR_SYMBOL) {
        return collector
      }

      // Handle Promise-like properties
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined
      }

      if (typeof prop === 'symbol') {
        return undefined
      }

      const propStr = String(prop)

      // Return a function that creates a PipelinePromise
      return (...args: unknown[]) => {
        // Check if any args are pipeline promises
        const pipelineArgs: PipelineArg[] = args.map((arg) => {
          if (isPipelinePromise(arg)) {
            return { type: 'promise' as const, promiseId: arg.callId }
          }
          return { type: 'value' as const, value: arg }
        })

        const hasPipelineArgs = pipelineArgs.some((a) => a.type === 'promise')

        const callId = collector.addCall({
          method: propStr,
          args: hasPipelineArgs ? undefined : args,
          pipelineArgs: hasPipelineArgs ? pipelineArgs : undefined,
        })

        // Create and return a chainable promise
        const promise = Object.create(PipelinePromise.prototype) as PipelinePromise
        ;(promise as { callId: string }).callId = callId
        ;(promise as { collector: PipelineCollector }).collector = collector
        ;(promise as { [PIPELINE_PROMISE_SYMBOL]: boolean })[PIPELINE_PROMISE_SYMBOL] = true

        // Return a proxy that enables chaining
        return createChainableProxy(promise, collector)
      }
    },
  })

  // Store executor for resolution
  ;(proxy as { [key: symbol]: unknown })[Symbol.for('executor')] = executor

  return proxy
}

/**
 * Create a chainable proxy for a PipelinePromise
 */
function createChainableProxy<T>(
  promise: PipelinePromise<T>,
  collector: PipelineCollector
): T & PipelinePromise<T> {
  return new Proxy(promise as unknown as T & PipelinePromise<T>, {
    get(target, prop) {
      // Return PipelinePromise properties
      if (prop === PIPELINE_PROMISE_SYMBOL) return true
      if (prop === 'callId') return promise.callId
      if (prop === 'collector') return collector

      // Handle Promise-like to allow await detection
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined
      }

      if (typeof prop === 'symbol') {
        return undefined
      }

      const propStr = String(prop)

      // Handle array methods
      if (propStr === 'map') {
        return (mapFn: (item: unknown) => unknown) => {
          const mapSpec = extractMapSpec(mapFn)
          const newCallId = collector.addCall({
            method: '__map__',
            args: [mapSpec],
            targetPromiseId: promise.callId,
          })
          const newPromise = Object.create(PipelinePromise.prototype) as PipelinePromise
          ;(newPromise as { callId: string }).callId = newCallId
          ;(newPromise as { collector: PipelineCollector }).collector = collector
          ;(newPromise as { [PIPELINE_PROMISE_SYMBOL]: boolean })[PIPELINE_PROMISE_SYMBOL] = true
          return createChainableProxy(newPromise, collector)
        }
      }

      if (propStr === 'filter') {
        return (filterFn: (item: unknown) => boolean) => {
          const filterSpec = extractFilterSpec(filterFn)
          const newCallId = collector.addCall({
            method: '__filter__',
            args: [filterSpec],
            targetPromiseId: promise.callId,
          })
          const newPromise = Object.create(PipelinePromise.prototype) as PipelinePromise
          ;(newPromise as { callId: string }).callId = newCallId
          ;(newPromise as { collector: PipelineCollector }).collector = collector
          ;(newPromise as { [PIPELINE_PROMISE_SYMBOL]: boolean })[PIPELINE_PROMISE_SYMBOL] = true
          return createChainableProxy(newPromise, collector)
        }
      }

      // Array index access
      if (/^\d+$/.test(propStr)) {
        const newCallId = collector.addCall({
          method: '__get__',
          property: propStr,
          targetPromiseId: promise.callId,
        })
        const newPromise = Object.create(PipelinePromise.prototype) as PipelinePromise
        ;(newPromise as { callId: string }).callId = newCallId
        ;(newPromise as { collector: PipelineCollector }).collector = collector
        ;(newPromise as { [PIPELINE_PROMISE_SYMBOL]: boolean })[PIPELINE_PROMISE_SYMBOL] = true
        return createChainableProxy(newPromise, collector)
      }

      // Return a callable that also supports property access
      const methodHandler = (...args: unknown[]) => {
        const pipelineArgs: PipelineArg[] = args.map((arg) => {
          if (isPipelinePromise(arg)) {
            return { type: 'promise' as const, promiseId: arg.callId }
          }
          return { type: 'value' as const, value: arg }
        })

        const hasPipelineArgs = pipelineArgs.some((a) => a.type === 'promise')

        const newCallId = collector.addCall({
          method: propStr,
          args: hasPipelineArgs ? undefined : args,
          pipelineArgs: hasPipelineArgs ? pipelineArgs : undefined,
          targetPromiseId: promise.callId,
        })

        const newPromise = Object.create(PipelinePromise.prototype) as PipelinePromise
        ;(newPromise as { callId: string }).callId = newCallId
        ;(newPromise as { collector: PipelineCollector }).collector = collector
        ;(newPromise as { [PIPELINE_PROMISE_SYMBOL]: boolean })[PIPELINE_PROMISE_SYMBOL] = true

        return createChainableProxy(newPromise, collector)
      }

      // Create a lazy accessor that defers the decision between method call and property access
      // until we know which one it is
      return createLazyAccessor(collector, promise.callId, propStr)
    },
  })
}

/**
 * Creates a lazy accessor that can be either:
 * - Called as a function (method call)
 * - Accessed as a property (property access)
 *
 * This is the key to making promise pipelining work in JavaScript
 */
function createLazyAccessor(
  collector: PipelineCollector,
  targetPromiseId: string,
  propName: string
): unknown {
  // We'll create a Proxy over a function so it can be both called and accessed
  const lazyFn = function (...args: unknown[]) {
    // This is a method call
    const pipelineArgs: PipelineArg[] = args.map((arg) => {
      if (isPipelinePromise(arg)) {
        return { type: 'promise' as const, promiseId: arg.callId }
      }
      return { type: 'value' as const, value: arg }
    })

    const hasPipelineArgs = pipelineArgs.some((a) => a.type === 'promise')

    const newCallId = collector.addCall({
      method: propName,
      args: hasPipelineArgs ? undefined : args,
      pipelineArgs: hasPipelineArgs ? pipelineArgs : undefined,
      targetPromiseId,
    })

    const newPromise = Object.create(PipelinePromise.prototype) as PipelinePromise
    ;(newPromise as { callId: string }).callId = newCallId
    ;(newPromise as { collector: PipelineCollector }).collector = collector
    ;(newPromise as { [PIPELINE_PROMISE_SYMBOL]: boolean })[PIPELINE_PROMISE_SYMBOL] = true

    return createChainableProxy(newPromise, collector)
  }

  // Track if we've materialized this as a property access
  let materializedAsProperty = false
  let propertyCallId: string | null = null

  const materializeAsProperty = () => {
    if (!materializedAsProperty) {
      propertyCallId = collector.addCall({
        method: '__get__',
        property: propName,
        targetPromiseId,
      })
      materializedAsProperty = true
    }
    return propertyCallId!
  }

  return new Proxy(lazyFn, {
    // Handle 'in' operator for isPipelinePromise check
    has(target, prop) {
      if (prop === PIPELINE_PROMISE_SYMBOL) {
        return true
      }
      return prop in target
    },

    // When called as a function
    apply(target, thisArg, args) {
      return target(...args)
    },

    // When accessed as a property
    get(target, nestedProp) {
      // Handle promise-like detection
      if (nestedProp === 'then' || nestedProp === 'catch' || nestedProp === 'finally') {
        // This is property access - materialize it
        const callId = materializeAsProperty()
        const propPromise = Object.create(PipelinePromise.prototype) as PipelinePromise
        ;(propPromise as { callId: string }).callId = callId
        ;(propPromise as { collector: PipelineCollector }).collector = collector
        ;(propPromise as { [PIPELINE_PROMISE_SYMBOL]: boolean })[PIPELINE_PROMISE_SYMBOL] = true
        return undefined // Not a real promise
      }

      // Handle PipelinePromise identification
      if (nestedProp === PIPELINE_PROMISE_SYMBOL) {
        // This is being checked as a pipeline promise - materialize it
        materializeAsProperty()
        return true
      }

      if (nestedProp === 'callId') {
        materializeAsProperty()
        return propertyCallId
      }

      if (nestedProp === 'collector') {
        return collector
      }

      // Handle Symbol.toPrimitive and other conversion attempts
      if (nestedProp === Symbol.toPrimitive) {
        return () => `[PipelinePromise:${propName}]`
      }

      if (nestedProp === Symbol.toStringTag) {
        return 'PipelinePromise'
      }

      if (typeof nestedProp === 'symbol') {
        return undefined
      }

      // This is chained property access (e.g., .name.length)
      // First materialize as property, then chain
      const callId = materializeAsProperty()
      const propPromise = Object.create(PipelinePromise.prototype) as PipelinePromise
      ;(propPromise as { callId: string }).callId = callId
      ;(propPromise as { collector: PipelineCollector }).collector = collector
      ;(propPromise as { [PIPELINE_PROMISE_SYMBOL]: boolean })[PIPELINE_PROMISE_SYMBOL] = true

      return createChainableProxy(propPromise, collector)[nestedProp as keyof unknown]
    },
  })
}

// =============================================================================
// Pipeline Resolution
// =============================================================================

/**
 * Resolve a pipeline promise by executing all collected calls
 */
export async function resolvePipeline<T>(promise: PipelinePromise<T> | T): Promise<T> {
  if (!isPipelinePromise(promise)) {
    // Not a pipeline promise, return as-is
    return promise
  }

  const collector = (promise as { collector: PipelineCollector }).collector
  const targetCallId = promise.callId

  // Find the executor from the root proxy
  // For now, we need to pass it differently
  // This is a limitation we'll address by attaching executor to collector

  // Get executor from collector (we'll set this when creating the proxy)
  const executor = (collector as { executor?: PipelineExecutor }).executor
  if (!executor) {
    throw new Error('No executor attached to pipeline collector')
  }

  // Execute all calls
  const results = await executor.execute(collector.calls)

  // Get the result for the target call
  const result = results.get(targetCallId)
  if (!result) {
    throw new Error(`No result for call ${targetCallId}`)
  }

  if (result.error) {
    throw new Error(result.error.message)
  }

  return result.value as T
}

/**
 * Alternative: Resolve with explicit executor
 */
export async function resolvePipelineWith<T>(
  promise: PipelinePromise<T> | T,
  executor: PipelineExecutor
): Promise<T> {
  if (!isPipelinePromise(promise)) {
    return promise
  }

  const collector = (promise as { collector: PipelineCollector }).collector
  const targetCallId = (promise as PipelinePromise).callId

  if (!collector) {
    throw new Error('No collector found on pipeline promise')
  }

  if (!targetCallId) {
    throw new Error('No callId found on pipeline promise')
  }

  // Attach executor to collector for nested resolution
  ;(collector as { executor?: PipelineExecutor }).executor = executor

  const results = await executor.execute(collector.calls)
  const result = results.get(targetCallId)

  if (!result) {
    throw new Error(`No result for call ${targetCallId}. Available: ${Array.from(results.keys()).join(', ')}`)
  }

  if (result.error) {
    throw new Error(result.error.message)
  }

  return result.value as T
}

// =============================================================================
// Updated createPipelineProxy to attach executor
// =============================================================================

/**
 * Create a pipeline proxy with executor attached
 */
export function createPipelineProxyWithExecutor<T>(executor: PipelineExecutor): T {
  const collector = new PipelineCollector()
  // Attach executor to collector
  ;(collector as { executor?: PipelineExecutor }).executor = executor

  const proxy = new Proxy({} as T, {
    get(target, prop) {
      if (prop === PIPELINE_COLLECTOR_SYMBOL) {
        return collector
      }

      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined
      }

      if (typeof prop === 'symbol') {
        return undefined
      }

      const propStr = String(prop)

      return (...args: unknown[]) => {
        const pipelineArgs: PipelineArg[] = args.map((arg) => {
          if (isPipelinePromise(arg)) {
            return { type: 'promise' as const, promiseId: arg.callId }
          }
          return { type: 'value' as const, value: arg }
        })

        const hasPipelineArgs = pipelineArgs.some((a) => a.type === 'promise')

        const callId = collector.addCall({
          method: propStr,
          args: hasPipelineArgs ? undefined : args,
          pipelineArgs: hasPipelineArgs ? pipelineArgs : undefined,
        })

        const promise = Object.create(PipelinePromise.prototype) as PipelinePromise
        ;(promise as { callId: string }).callId = callId
        ;(promise as { collector: PipelineCollector }).collector = collector
        ;(promise as { [PIPELINE_PROMISE_SYMBOL]: boolean })[PIPELINE_PROMISE_SYMBOL] = true

        return createChainableProxy(promise, collector)
      }
    },
  })

  return proxy
}

// Export the version that attaches executor
export { createPipelineProxyWithExecutor as createPipelineProxy }
