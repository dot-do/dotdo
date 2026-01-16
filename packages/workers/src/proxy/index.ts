/**
 * @dotdo/workers/proxy - Promise pipelining and proxy utilities
 *
 * Cap'n Web style promise pipelining:
 * - PipelinedStub - Records property/method access
 * - PipelinedProxy - Executes pipelines via executor on await
 * - Serialization - Wire format for transmission
 *
 * @module @dotdo/workers/proxy
 */

export {
  createPipelinedStub,
  createPipelinedProxy,
  createPipelineExecutor,
  executePipeline,
  serializePipeline,
  deserializePipeline,
  PIPELINE_SYMBOL,
  TARGET_SYMBOL,
  type PipelinedStub,
  type PipelineStep,
  type SerializedPipeline,
  type PipelineExecutor,
  type ExecutablePipelineStub,
} from './PipelinedStub'

export type {
  PipelinedProxyOptions,
  PipelineResult,
  BatchOptions,
} from './types'
