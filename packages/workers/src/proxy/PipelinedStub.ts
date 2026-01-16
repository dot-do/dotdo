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
