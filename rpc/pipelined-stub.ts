/**
 * PipelinedStub - A Proxy that records property/method access into a pipeline
 * for Cap'n Proto-style promise pipelining.
 *
 * Allows chained access like `stub.a.b.c()` to be recorded and later executed
 * in a single round-trip.
 *
 * @see do-n3c - GREEN: Implement PipelinedStub
 * @see do-aby - True Cap'n Web Pipelining epic
 */

// ============================================================================
// SYMBOLS
// ============================================================================

/**
 * Symbol used to access the pipeline array from a PipelinedStub.
 * Both the unique symbol and Symbol.for('pipeline') work.
 */
export const PIPELINE_SYMBOL: unique symbol = Symbol('pipeline')

/**
 * Symbol used to access the target from a PipelinedStub.
 * Both the unique symbol and Symbol.for('target') work.
 */
export const TARGET_SYMBOL: unique symbol = Symbol('target')

// Also register with Symbol.for for alternative access
const PIPELINE_SYMBOL_FOR = Symbol.for('pipeline')
const TARGET_SYMBOL_FOR = Symbol.for('target')

// ============================================================================
// TYPES
// ============================================================================

/**
 * A step in the pipeline - either property access or method call.
 */
export type PipelineStep =
  | { type: 'property'; name: string }
  | { type: 'method'; name: string; args: unknown[] }

/**
 * Wire format for serializing pipelines.
 */
export interface SerializedPipeline {
  target: string[]
  pipeline: PipelineStep[]
}

/**
 * The PipelinedStub type - a Proxy that records property/method access.
 */
export interface PipelinedStub {
  [PIPELINE_SYMBOL]: PipelineStep[]
  [TARGET_SYMBOL]: string[]
  [key: string]: unknown
  [key: symbol]: unknown
}

// ============================================================================
// THENABLE PROPERTIES
// ============================================================================

/**
 * Properties that are handled specially for Promise compatibility.
 * These are NOT recorded as pipeline steps.
 */
const THENABLE_PROPS = new Set(['then', 'catch', 'finally'])

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Creates a new PipelinedStub that records property access and method calls.
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
  // Use a plain object as the proxy target so typeof returns 'object'
  // Property access returns callable stubs (functions) for method invocation
  const proxyTarget = {} as object

  const handler: ProxyHandler<object> = {
    get(_target, prop: string | symbol): unknown {
      // Handle special symbols for accessing internal state
      if (prop === PIPELINE_SYMBOL || prop === PIPELINE_SYMBOL_FOR) {
        return pipeline
      }
      if (prop === TARGET_SYMBOL || prop === TARGET_SYMBOL_FOR) {
        return target
      }

      // Handle Symbol.toStringTag for proper toString representation
      if (prop === Symbol.toStringTag) {
        return 'PipelinedStub'
      }

      // Non-special symbols return undefined
      if (typeof prop === 'symbol') {
        return undefined
      }

      // Handle thenable properties specially for Promise/await compatibility
      if (THENABLE_PROPS.has(prop)) {
        // Return a function that makes the stub thenable
        // This allows `await stub` to work
        if (prop === 'then') {
          return (
            resolve?: (value: PipelinedStub) => unknown,
            reject?: (reason: unknown) => unknown
          ) => {
            // Return a new stub (unchanged) when resolved
            // This makes the stub work with await
            return resolve
              ? Promise.resolve(createPipelinedStub(target, pipeline)).then(resolve)
              : Promise.resolve(createPipelinedStub(target, pipeline))
          }
        }
        if (prop === 'catch') {
          return (reject?: (reason: unknown) => unknown) => {
            return Promise.resolve(createPipelinedStub(target, pipeline)).catch(reject)
          }
        }
        if (prop === 'finally') {
          return (onFinally?: () => void) => {
            return Promise.resolve(createPipelinedStub(target, pipeline)).finally(onFinally)
          }
        }
      }

      // For any other string property, create a new stub that is callable
      // This allows both `stub.foo` and `stub.foo()` to work
      const newPipeline = [...pipeline, { type: 'property' as const, name: prop }]

      // Return a callable proxy that can either:
      // 1. Be called as a function (will convert property to method)
      // 2. Have more properties accessed (will add more property steps)
      return createCallableStub(target, newPipeline, prop)
    },

    // Handle 'in' operator
    has(_target, prop: string | symbol): boolean {
      // Symbols we handle
      if (
        prop === PIPELINE_SYMBOL ||
        prop === PIPELINE_SYMBOL_FOR ||
        prop === TARGET_SYMBOL ||
        prop === TARGET_SYMBOL_FOR
      ) {
        return true
      }
      // Thenable props
      if (typeof prop === 'string' && THENABLE_PROPS.has(prop)) {
        return true
      }
      // All other string props are valid (for chaining)
      return typeof prop === 'string'
    },
  }

  return new Proxy(proxyTarget, handler) as unknown as PipelinedStub
}

/**
 * Creates a callable stub that can be either called as a function
 * (converting the last property access to a method call) or have
 * more properties accessed.
 */
function createCallableStub(
  target: string[],
  pipeline: PipelineStep[],
  lastPropName: string
): PipelinedStub {
  // Use a function as the proxy target so we can intercept apply
  const proxyTarget = function () {} as unknown as object

  const handler: ProxyHandler<object> = {
    get(_target, prop: string | symbol): unknown {
      // Handle special symbols
      if (prop === PIPELINE_SYMBOL || prop === PIPELINE_SYMBOL_FOR) {
        return pipeline
      }
      if (prop === TARGET_SYMBOL || prop === TARGET_SYMBOL_FOR) {
        return target
      }
      if (prop === Symbol.toStringTag) {
        return 'PipelinedStub'
      }

      // Non-special symbols return undefined
      if (typeof prop === 'symbol') {
        return undefined
      }

      // Handle thenable properties
      if (THENABLE_PROPS.has(prop)) {
        if (prop === 'then') {
          return (
            resolve?: (value: PipelinedStub) => unknown,
            reject?: (reason: unknown) => unknown
          ) => {
            return resolve
              ? Promise.resolve(createPipelinedStub(target, pipeline)).then(resolve)
              : Promise.resolve(createPipelinedStub(target, pipeline))
          }
        }
        if (prop === 'catch') {
          return (reject?: (reason: unknown) => unknown) => {
            return Promise.resolve(createPipelinedStub(target, pipeline)).catch(reject)
          }
        }
        if (prop === 'finally') {
          return (onFinally?: () => void) => {
            return Promise.resolve(createPipelinedStub(target, pipeline)).finally(onFinally)
          }
        }
      }

      // Continue property chain
      const newPipeline = [...pipeline, { type: 'property' as const, name: prop }]
      return createCallableStub(target, newPipeline, prop)
    },

    apply(_target, _thisArg, args: unknown[]): PipelinedStub {
      // Called as a function - convert the last property access to a method call
      // Remove the last property step and replace with a method step
      const pipelineWithoutLast = pipeline.slice(0, -1)
      const newPipeline = [
        ...pipelineWithoutLast,
        { type: 'method' as const, name: lastPropName, args },
      ]
      return createPipelinedStub(target, newPipeline)
    },

    has(_target, prop: string | symbol): boolean {
      if (
        prop === PIPELINE_SYMBOL ||
        prop === PIPELINE_SYMBOL_FOR ||
        prop === TARGET_SYMBOL ||
        prop === TARGET_SYMBOL_FOR
      ) {
        return true
      }
      if (typeof prop === 'string' && THENABLE_PROPS.has(prop)) {
        return true
      }
      return typeof prop === 'string'
    },
  }

  return new Proxy(proxyTarget, handler) as unknown as PipelinedStub
}

// ============================================================================
// SERIALIZATION
// ============================================================================

/**
 * Serializes a PipelinedStub to wire format for transmission.
 *
 * @param stub - The PipelinedStub to serialize
 * @returns The wire format object
 *
 * @example
 * ```typescript
 * const stub = createPipelinedStub(['Customer', 'cust_123'])
 * const chain = stub.profile.email
 * const wire = serializePipeline(chain)
 * // {
 * //   target: ['Customer', 'cust_123'],
 * //   pipeline: [
 * //     { type: 'property', name: 'profile' },
 * //     { type: 'property', name: 'email' }
 * //   ]
 * // }
 * ```
 */
export function serializePipeline(stub: PipelinedStub): SerializedPipeline {
  return {
    target: stub[TARGET_SYMBOL],
    pipeline: stub[PIPELINE_SYMBOL],
  }
}

/**
 * Deserializes wire format back to a PipelinedStub.
 *
 * @param wire - The wire format object
 * @returns A new PipelinedStub with the deserialized state
 *
 * @example
 * ```typescript
 * const wire = { target: ['Customer', 'cust_123'], pipeline: [...] }
 * const stub = deserializePipeline(wire)
 * ```
 */
export function deserializePipeline(wire: SerializedPipeline): PipelinedStub {
  return createPipelinedStub(wire.target, wire.pipeline)
}
