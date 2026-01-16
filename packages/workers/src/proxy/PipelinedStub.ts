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
  _target: string[],
  _pipeline?: PipelineStep[]
): PipelinedStub {
  throw new Error('createPipelinedStub not implemented yet')
}

/**
 * Serialize a PipelinedStub to wire format
 *
 * @param stub - The stub to serialize
 * @returns Wire format object
 */
export function serializePipeline(_stub: PipelinedStub): SerializedPipeline {
  throw new Error('serializePipeline not implemented yet')
}

/**
 * Deserialize wire format to PipelinedStub
 *
 * @param wire - The wire format object
 * @returns A new PipelinedStub
 */
export function deserializePipeline(_wire: SerializedPipeline): PipelinedStub {
  throw new Error('deserializePipeline not implemented yet')
}
