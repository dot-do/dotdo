/**
 * PipelinedStub - Promise pipelining for Cap'n Web style RPC
 *
 * Records property access and method calls into a pipeline
 * for single round-trip execution.
 *
 * @module @dotdo/workers/proxy
 */

/**
 * Symbol for accessing the pipeline array
 */
export const PIPELINE_SYMBOL: unique symbol = Symbol('pipeline')

/**
 * Symbol for accessing the target
 */
export const TARGET_SYMBOL: unique symbol = Symbol('target')

/**
 * A step in the pipeline
 */
export type PipelineStep =
  | { type: 'property'; name: string }
  | { type: 'method'; name: string; args: unknown[] }

/**
 * Wire format for serializing pipelines
 */
export interface SerializedPipeline {
  target: string[]
  pipeline: PipelineStep[]
}

/**
 * The PipelinedStub type
 */
export interface PipelinedStub {
  [PIPELINE_SYMBOL]: PipelineStep[]
  [TARGET_SYMBOL]: string[]
  [key: string]: unknown
  [key: symbol]: unknown
}

/**
 * Create a plain (non-thenable) result object for Promise resolution
 * This avoids infinite loops when Promise.resolve tries to unwrap thenables
 */
function createPlainResult(target: string[], pipeline: PipelineStep[]): PipelinedStub {
  const result = {
    [PIPELINE_SYMBOL]: pipeline,
    [TARGET_SYMBOL]: target,
  } as PipelinedStub
  return result
}

/**
 * Create a callable function that acts as a PipelinedStub
 */
function createCallableStub(
  target: string[],
  pipeline: PipelineStep[],
  pendingPropertyName?: string
): PipelinedStub {
  // Calculate the current pipeline (including pending property if any)
  const currentPipeline = pendingPropertyName
    ? [...pipeline, { type: 'property' as const, name: pendingPropertyName }]
    : pipeline

  // Create a function that can be called (for method invocations)
  const fn = function(...args: unknown[]): PipelinedStub {
    if (pendingPropertyName) {
      // Convert the pending property access into a method call
      const methodPipeline = [...pipeline, { type: 'method' as const, name: pendingPropertyName, args }]
      return createCallableStub(target, methodPipeline)
    }
    return createCallableStub(target, pipeline)
  }

  // Add the symbol properties
  Object.defineProperty(fn, PIPELINE_SYMBOL, {
    value: currentPipeline,
    enumerable: false,
    writable: false,
  })

  Object.defineProperty(fn, TARGET_SYMBOL, {
    value: target,
    enumerable: false,
    writable: false,
  })

  // Create the thenable function once - returns a plain object to avoid thenable recursion
  const thenableFn = (
    onFulfilled?: (value: PipelinedStub) => unknown,
    onRejected?: (reason: unknown) => unknown
  ): Promise<unknown> => {
    // Create a plain (non-thenable) result to avoid Promise.resolve infinite loop
    const plainResult = createPlainResult(target, currentPipeline)

    return new Promise((resolve, reject) => {
      try {
        if (onFulfilled) {
          const result = onFulfilled(plainResult)
          resolve(result)
        } else {
          resolve(plainResult)
        }
      } catch (e) {
        if (onRejected) {
          resolve(onRejected(e))
        } else {
          reject(e)
        }
      }
    })
  }

  // Create proxy for property access
  return new Proxy(fn as unknown as PipelinedStub, {
    get(innerTarget, prop) {
      // Return internal symbols
      if (prop === PIPELINE_SYMBOL) {
        return innerTarget[PIPELINE_SYMBOL]
      }
      if (prop === TARGET_SYMBOL) {
        return innerTarget[TARGET_SYMBOL]
      }

      // Handle thenable interface for await compatibility - MUST return the function directly
      if (prop === 'then') {
        return thenableFn
      }

      // For any other property access, return a new callable stub
      return createCallableStub(target, currentPipeline, String(prop))
    },
    apply(_proxyTarget, _thisArg, args) {
      // Direct function call
      return fn(...args)
    },
  }) as PipelinedStub
}

/**
 * Create a PipelinedStub that records property/method access
 *
 * @param target - The target identifier (e.g., ['Customer', 'cust_123'])
 * @param pipeline - Optional existing pipeline to continue from
 * @returns A Proxy that records all property/method access
 *
 * @example
 * ```typescript
 * const stub = createPipelinedStub(['Customer', 'cust_123'])
 * const chain = stub.profile.email
 * // chain[PIPELINE_SYMBOL] = [
 * //   { type: 'property', name: 'profile' },
 * //   { type: 'property', name: 'email' }
 * // ]
 * ```
 */
export function createPipelinedStub(
  target: string[],
  pipeline: PipelineStep[] = []
): PipelinedStub {
  return createCallableStub(target, pipeline)
}

/**
 * Serialize a PipelinedStub to wire format
 *
 * @param stub - The stub to serialize
 * @returns Wire format object
 */
export function serializePipeline(stub: PipelinedStub): SerializedPipeline {
  return {
    target: stub[TARGET_SYMBOL],
    pipeline: stub[PIPELINE_SYMBOL],
  }
}

/**
 * Deserialize wire format to PipelinedStub
 *
 * @param wire - The wire format object
 * @returns A new PipelinedStub
 */
export function deserializePipeline(wire: SerializedPipeline): PipelinedStub {
  return createPipelinedStub(wire.target, wire.pipeline)
}

// =============================================================================
// Pipeline Execution
// =============================================================================

/**
 * A pipeline executor function that takes a serialized pipeline
 * and returns the result
 */
export type PipelineExecutor = (pipeline: SerializedPipeline) => Promise<unknown>

/**
 * Stub interface that supports pipeline execution
 */
export interface ExecutablePipelineStub {
  executePipeline(pipeline: SerializedPipeline): Promise<unknown>
}

/**
 * Create a pipeline executor from a stub
 *
 * @param stub - A stub that implements executePipeline
 * @returns A function that executes pipelines
 *
 * @example
 * ```typescript
 * const executor = createPipelineExecutor(doStub)
 * const result = await executor({ target: ['Customer'], pipeline: [...] })
 * ```
 */
export function createPipelineExecutor(stub: ExecutablePipelineStub): PipelineExecutor {
  return async (pipeline: SerializedPipeline): Promise<unknown> => {
    return stub.executePipeline(pipeline)
  }
}

/**
 * Execute a pipeline directly on a stub
 *
 * @param stub - A stub that implements executePipeline
 * @param pipeline - The serialized pipeline to execute
 * @returns The result of executing the pipeline
 *
 * @example
 * ```typescript
 * const result = await executePipeline(stub, {
 *   target: ['Customer'],
 *   pipeline: [{ type: 'property', name: 'name' }]
 * })
 * ```
 */
export async function executePipeline(
  stub: ExecutablePipelineStub,
  pipeline: SerializedPipeline
): Promise<unknown> {
  return stub.executePipeline(pipeline)
}

/**
 * Create an executable callable stub that sends to an executor on await
 */
function createExecutableCallableStub<T = unknown>(
  target: string[],
  pipeline: PipelineStep[],
  executor: PipelineExecutor,
  pendingPropertyName?: string
): T {
  // Calculate the current pipeline (including pending property if any)
  const currentPipeline = pendingPropertyName
    ? [...pipeline, { type: 'property' as const, name: pendingPropertyName }]
    : pipeline

  // Create a function that can be called (for method invocations)
  const fn = function(...args: unknown[]): T {
    if (pendingPropertyName) {
      // Convert the pending property access into a method call
      const methodPipeline = [...pipeline, { type: 'method' as const, name: pendingPropertyName, args }]
      return createExecutableCallableStub<T>(target, methodPipeline, executor)
    }
    return createExecutableCallableStub<T>(target, pipeline, executor)
  }

  // Add the symbol properties
  Object.defineProperty(fn, PIPELINE_SYMBOL, {
    value: currentPipeline,
    enumerable: false,
    writable: false,
  })

  Object.defineProperty(fn, TARGET_SYMBOL, {
    value: target,
    enumerable: false,
    writable: false,
  })

  // Create the thenable function that executes via the executor
  const thenableFn = (
    onFulfilled?: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown
  ): Promise<unknown> => {
    // Execute the pipeline via the executor
    const serialized: SerializedPipeline = {
      target,
      pipeline: currentPipeline,
    }

    const executionPromise = executor(serialized)

    // Chain the handlers
    return executionPromise.then(
      (result) => {
        if (onFulfilled) {
          return onFulfilled(result)
        }
        return result
      },
      (error) => {
        if (onRejected) {
          return onRejected(error)
        }
        throw error
      }
    )
  }

  // Create proxy for property access
  return new Proxy(fn as unknown as T, {
    get(innerTarget, prop) {
      // Return internal symbols
      if (prop === PIPELINE_SYMBOL) {
        return (innerTarget as unknown as PipelinedStub)[PIPELINE_SYMBOL]
      }
      if (prop === TARGET_SYMBOL) {
        return (innerTarget as unknown as PipelinedStub)[TARGET_SYMBOL]
      }

      // Handle thenable interface for await compatibility
      if (prop === 'then') {
        return thenableFn
      }

      // Handle catch for error handling
      if (prop === 'catch') {
        return (onRejected: (reason: unknown) => unknown): Promise<unknown> => {
          return thenableFn(undefined, onRejected)
        }
      }

      // Handle finally
      if (prop === 'finally') {
        return (onFinally: () => void): Promise<unknown> => {
          return thenableFn().finally(onFinally)
        }
      }

      // For any other property access, return a new callable stub
      return createExecutableCallableStub<T>(target, currentPipeline, executor, String(prop))
    },
    apply(_proxyTarget, _thisArg, args) {
      // Direct function call
      return fn(...args)
    },
  }) as T
}

/**
 * Create a pipelined proxy that executes via an executor when awaited
 *
 * This is the main entry point for creating executable pipelined proxies.
 * Every `.` builds a pipeline, and `await` triggers a single RPC call.
 *
 * @param target - The target identifier (e.g., ['Customer'])
 * @param executor - Function that executes the pipeline
 * @returns A proxy that accumulates calls and executes on await
 *
 * @example
 * ```typescript
 * const executor = createPipelineExecutor(doStub)
 * const Customer = createPipelinedProxy(['Customer'], executor)
 *
 * // This is ONE RPC call, not multiple
 * const result = await Customer.get('c-123').orders.list()
 *
 * // Pipeline sent: [get('c-123'), .orders, .list()]
 * // DO resolves entire chain in one call
 * ```
 */
export function createPipelinedProxy<T = unknown>(
  target: string[],
  executor: PipelineExecutor
): T {
  return createExecutableCallableStub<T>(target, [], executor)
}
