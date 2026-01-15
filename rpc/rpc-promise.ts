/**
 * RpcPromise - Cap'n Proto-style promise pipelining
 *
 * Enables calling methods and accessing properties on unresolved promises.
 * The pipeline is tracked and executed when the promise is finally awaited.
 *
 * KEY DESIGN: Lazy evaluation - the executor is NOT called until the promise
 * is awaited or .then() is called. This allows building up the pipeline without
 * executing anything.
 *
 * @example
 * ```typescript
 * const user = api.getUser(id)  // RpcPromise, not yet resolved
 * const email = user.email      // Still RpcPromise, property access recorded
 * await email                   // NOW the full pipeline executes
 * ```
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Represents a single operation in the pipeline
 */
export type PipelineOperation =
  | { type: 'property'; name: string }
  | { type: 'method'; name: string; args: unknown[] }

/**
 * Custom executor that receives the base value and full pipeline
 */
export type PipelineExecutor<T> = (
  baseValue: T,
  pipeline: PipelineOperation[]
) => Promise<unknown>

/**
 * Options for creating an RpcPromise
 */
export interface RpcPromiseOptions<T> {
  executor?: PipelineExecutor<T>
}

/**
 * RpcPromise type - a Promise that supports property/method pipelining
 */
export type RpcPromise<T> = Promise<T> & {
  pipeline: PipelineOperation[]
} & (T extends object
    ? {
        [K in keyof T]: T[K] extends (...args: infer A) => infer R
          ? (...args: A) => RpcPromise<R>
          : RpcPromise<T[K]>
      }
    : unknown)

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Default pipeline executor - walks the pipeline on the resolved value
 */
function defaultExecutor<T>(
  baseValue: T,
  pipeline: PipelineOperation[]
): unknown {
  let result: unknown = baseValue

  for (const op of pipeline) {
    if (result === null || result === undefined) {
      throw new TypeError(
        `Cannot read ${op.type === 'property' ? 'property' : 'call method'} '${op.name}' of ${result}`
      )
    }

    if (op.type === 'property') {
      result = (result as Record<string, unknown>)[op.name]
    } else if (op.type === 'method') {
      const method = (result as Record<string, unknown>)[op.name]
      if (typeof method !== 'function') {
        throw new TypeError(`${op.name} is not a function`)
      }
      result = method.apply(result, op.args)
    }
  }

  return result
}

/**
 * Internal state for lazy promises with memoization
 */
interface LazyPromiseState<T> {
  promiseExecutor: (
    resolve: (value: T) => void,
    reject: (reason?: unknown) => void
  ) => void
  customExecutor?: PipelineExecutor<T>
  // Memoization cache: key is JSON of pipeline, value is cached promise
  cache: Map<string, Promise<unknown>>
  // Base value cache - promiseExecutor only runs once
  basePromise: Promise<T> | null
}

/**
 * Creates a cache key for the pipeline
 */
function pipelineKey(pipeline: PipelineOperation[]): string {
  return JSON.stringify(pipeline)
}

/**
 * Creates a LAZY promise that defers execution until .then() is called.
 * Also implements memoization - same pipeline returns same cached promise.
 */
function createLazyPromise<T, R>(
  state: LazyPromiseState<T>,
  pipeline: PipelineOperation[]
): Promise<R> {
  const key = pipelineKey(pipeline)

  // Check cache
  if (state.cache.has(key)) {
    return state.cache.get(key) as Promise<R>
  }

  // Create a deferred promise that only executes when .then() is called
  let cachedPromise: Promise<R> | null = null

  const lazyPromise = {
    then<TResult1 = R, TResult2 = never>(
      onFulfilled?: ((value: R) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
      // Lazily create the real promise on first .then() call
      if (!cachedPromise) {
        // Lazy-create the base promise (promiseExecutor only runs once)
        if (!state.basePromise) {
          state.basePromise = new Promise<T>((resolve, reject) => {
            state.promiseExecutor(resolve, reject)
          })
        }

        // When a custom executor is provided with a pipeline, use it
        // The custom executor receives the resolved base value and the full pipeline
        if (state.customExecutor && pipeline.length > 0) {
          cachedPromise = state.basePromise.then((baseValue) => {
            return state.customExecutor!(baseValue, pipeline) as Promise<R>
          })
        } else {
          // No custom executor - use defaultExecutor to walk the pipeline
          cachedPromise = state.basePromise.then((baseValue) => {
            return defaultExecutor(baseValue, pipeline) as R
          })
        }
      }
      return cachedPromise.then(onFulfilled, onRejected)
    },

    catch<TResult = never>(
      onRejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
    ): Promise<R | TResult> {
      return this.then(null, onRejected)
    },

    finally(onFinally?: (() => void) | null): Promise<R> {
      return this.then(
        (value) => {
          onFinally?.()
          return value
        },
        (reason) => {
          onFinally?.()
          throw reason
        }
      )
    },

    [Symbol.toStringTag]: 'RpcPromise' as const
  }

  // Make instanceof Promise work
  Object.setPrototypeOf(lazyPromise, Promise.prototype)

  // Cache the lazy promise wrapper
  state.cache.set(key, lazyPromise as unknown as Promise<R>)

  return lazyPromise as unknown as Promise<R>
}

/**
 * Creates an RpcPromise with pipelining capabilities
 */
export function createRpcPromise<T>(
  promiseExecutor: (
    resolve: (value: T) => void,
    reject: (reason?: unknown) => void
  ) => void,
  options?: RpcPromiseOptions<T>
): RpcPromise<T> {
  // Create shared state for memoization
  const state: LazyPromiseState<T> = {
    promiseExecutor,
    customExecutor: options?.executor,
    cache: new Map(),
    basePromise: null
  }

  return createRpcPromiseInternal<T, T>(state, [])
}

/**
 * Internal factory that creates RpcPromise with existing pipeline
 */
function createRpcPromiseInternal<T, R>(
  state: LazyPromiseState<T>,
  pipeline: PipelineOperation[]
): RpcPromise<R> {
  // Create the lazy promise
  const lazyPromise = createLazyPromise<T, R>(state, pipeline)

  // Create proxy to intercept property access and method calls
  const proxy = new Proxy(lazyPromise, {
    get(target, prop) {
      // Handle Symbol.toStringTag specially
      if (prop === Symbol.toStringTag) {
        return 'RpcPromise'
      }

      // Handle Symbol properties - don't record them
      if (typeof prop === 'symbol') {
        return undefined
      }

      // Expose pipeline property
      if (prop === 'pipeline') {
        return pipeline
      }

      // Reserved Promise methods - pass through to lazy promise
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        const method = target[prop as keyof typeof target]
        if (typeof method === 'function') {
          return method.bind(target)
        }
      }

      // For all other properties, create a callable proxy
      // that can be used as either property access OR method call
      return createCallableProxy<T>(state, pipeline, prop as string)
    },
  })

  return proxy as RpcPromise<R>
}

/**
 * Creates a callable proxy that:
 * - When called as a function: records a method call in the pipeline
 * - When properties are accessed: records property access in the pipeline
 * - Is instanceof Promise (for compatibility)
 */
function createCallableProxy<T>(
  state: LazyPromiseState<T>,
  existingPipeline: PipelineOperation[],
  propertyName: string
): RpcPromise<unknown> {
  // The property pipeline (used when NOT called as a function)
  const propertyPipeline: PipelineOperation[] = [
    ...existingPipeline,
    { type: 'property', name: propertyName }
  ]

  // Create a function as the proxy target so `apply` trap works
  const callableTarget = function(...args: unknown[]) {
    const methodPipeline: PipelineOperation[] = [
      ...existingPipeline,
      { type: 'method', name: propertyName, args }
    ]
    return createRpcPromiseInternal<T, unknown>(state, methodPipeline)
  }

  // Create the lazy promise for property access
  const propertyPromise = createLazyPromise<T, unknown>(state, propertyPipeline)

  // Make the callable inherit from Promise for instanceof checks
  Object.setPrototypeOf(callableTarget, Promise.prototype)

  return new Proxy(callableTarget, {
    get(_target, prop) {
      // Handle Symbol.toStringTag
      if (prop === Symbol.toStringTag) {
        return 'RpcPromise'
      }

      // Symbols pass through
      if (typeof prop === 'symbol') {
        return undefined
      }

      // Pipeline property
      if (prop === 'pipeline') {
        return propertyPipeline
      }

      // Promise methods - delegate to the lazy property promise
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        const method = propertyPromise[prop as keyof typeof propertyPromise]
        if (typeof method === 'function') {
          return method.bind(propertyPromise)
        }
      }

      // Chain further property/method access
      return createCallableProxy<T>(state, propertyPipeline, prop as string)
    },

    apply(_target, _thisArg, args) {
      // Method call - create new pipeline with method operation
      const methodPipeline: PipelineOperation[] = [
        ...existingPipeline,
        { type: 'method', name: propertyName, args }
      ]

      return createRpcPromiseInternal<T, unknown>(state, methodPipeline)
    },

    // Make instanceof Promise work
    getPrototypeOf() {
      return Promise.prototype
    },
  }) as unknown as RpcPromise<unknown>
}
