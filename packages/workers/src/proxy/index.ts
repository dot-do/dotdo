/**
 * @dotdo/workers/proxy - Promise pipelining and proxy utilities
 *
 * Cap'n Web style promise pipelining:
 * - PipelinedStub - Records property/method access
 * - Serialization - Wire format for transmission
 *
 * @module @dotdo/workers/proxy
 */

export {
  createPipelinedStub,
  serializePipeline,
  deserializePipeline,
  PIPELINE_SYMBOL,
  TARGET_SYMBOL,
  type PipelinedStub,
  type PipelineStep,
  type SerializedPipeline,
} from './PipelinedStub'

export type {
  PipelinedProxyOptions,
  PipelineResult,
  BatchOptions,
} from './types'
