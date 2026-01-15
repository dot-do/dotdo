/**
 * RpcPromise - Cap'n Proto-style promise pipelining
 *
 * Enables calling methods and accessing properties on unresolved promises.
 * The pipeline is tracked and executed when the promise is finally awaited.
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
 * Creates the underlying promise that executes the pipeline
 */
function createBasePromise<T, R>(
  promiseExecutor: (
    resolve: (value: T) => void,
    reject: (reason?: unknown) => void
  ) => void,
  pipeline: PipelineOperation[],
  customExecutor?: PipelineExecutor<T>
): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    promiseExecutor(
      (baseValue: T) => {
        try {
          if (customExecutor && pipeline.length > 0) {
            Promise.resolve(customExecutor(baseValue, pipeline))
              .then((r) => resolve(r as R))
              .catch(reject)
            return
          }

          const result = defaultExecutor(baseValue, pipeline)
          resolve(result as R)
        } catch (err) {
          reject(err)
        }
      },
      reject
    )
  })
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
  return createRpcPromiseInternal<T, T>(promiseExecutor, [], options)
}

/**
 * Internal factory that creates RpcPromise with existing pipeline
 */
function createRpcPromiseInternal<T, R>(
  promiseExecutor: (
    resolve: (value: T) => void,
    reject: (reason?: unknown) => void
  ) => void,
  pipeline: PipelineOperation[],
  options?: RpcPromiseOptions<T>
): RpcPromise<R> {
  const basePromise = createBasePromise<T, R>(
    promiseExecutor,
    pipeline,
    options?.executor
  )

  // Create proxy to intercept property access and method calls
  const proxy = new Proxy(basePromise, {
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

      // Reserved Promise methods - pass through to actual promise
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        const method = target[prop as keyof Promise<R>]
        if (typeof method === 'function') {
          return method.bind(target)
        }
      }

      // For all other properties, create a callable proxy
      // that can be used as either property access OR method call
      return createCallableProxy<T>(
        promiseExecutor,
        pipeline,
        prop as string,
        options
      )
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
  promiseExecutor: (
    resolve: (value: T) => void,
    reject: (reason?: unknown) => void
  ) => void,
  existingPipeline: PipelineOperation[],
  propertyName: string,
  options?: RpcPromiseOptions<T>
): RpcPromise<unknown> {
  // The property pipeline (used when NOT called as a function)
  const propertyPipeline: PipelineOperation[] = [
    ...existingPipeline,
    { type: 'property', name: propertyName }
  ]

  // Create a function as the proxy target so `apply` trap works
  // This function returns the method-call version when invoked
  const callableTarget = function(...args: unknown[]) {
    const methodPipeline: PipelineOperation[] = [
      ...existingPipeline,
      { type: 'method', name: propertyName, args }
    ]
    return createRpcPromiseInternal<T, unknown>(
      promiseExecutor,
      methodPipeline,
      options
    )
  }

  // Create the underlying promise for property access
  const propertyPromise = createBasePromise<T, unknown>(
    promiseExecutor,
    propertyPipeline,
    options?.executor
  )

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

      // Promise methods - delegate to the property promise
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        const method = propertyPromise[prop as keyof Promise<unknown>]
        if (typeof method === 'function') {
          return method.bind(propertyPromise)
        }
      }

      // Chain further property/method access
      return createCallableProxy<T>(
        promiseExecutor,
        propertyPipeline,
        prop as string,
        options
      )
    },

    apply(_target, _thisArg, args) {
      // Method call - create new pipeline with method operation
      const methodPipeline: PipelineOperation[] = [
        ...existingPipeline,
        { type: 'method', name: propertyName, args }
      ]

      return createRpcPromiseInternal<T, unknown>(
        promiseExecutor,
        methodPipeline,
        options
      )
    },

    // Make instanceof Promise work
    getPrototypeOf() {
      return Promise.prototype
    },
  }) as RpcPromise<unknown>
}
