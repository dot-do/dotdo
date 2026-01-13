/**
 * @dotdo/bullmq
 *
 * BullMQ compatible job queue SDK backed by Durable Objects.
 * Drop-in replacement for bullmq with edge-native implementation.
 *
 * Usage:
 * ```typescript
 * import { Queue, Worker, Job } from '@dotdo/bullmq'
 *
 * // Create a queue
 * const queue = new Queue('my-queue')
 *
 * // Add a job
 * const job = await queue.add('process-order', { orderId: '123' })
 *
 * // Create a worker to process jobs
 * const worker = new Worker('my-queue', async (job) => {
 *   console.log('Processing', job.data.orderId)
 *   return { processed: true }
 * })
 *
 * // Listen for events
 * worker.on('completed', (job, result) => {
 *   console.log('Job completed:', job.id, result)
 * })
 * ```
 *
 * @see https://docs.bullmq.io/
 */

// Export main classes
export {
  Queue,
  Worker,
  Job,
  QueueEvents,
  FlowProducer,
  _clearAll,
  _getQueues,
  delay,
} from './bullmq'

// Export all errors
export {
  BullMQError,
  JobNotFoundError,
  QueueNotFoundError,
  JobAlreadyExistsError,
  WorkerNotReadyError,
  QueuePausedError,
  InvalidJobDataError,
  JobLockError,
  JobTimeoutError,
} from './bullmq'

// Export all types
export type {
  // Job types
  JobState,
  JobOptions,
  JobJson,
  BackoffOptions,
  KeepJobs,
  ParentKeys,
  RepeatOptions,
  DebounceOptions,
  BulkJobOptions,

  // Queue types
  QueueOptions,
  QueueCounts,
  JobCounts,
  ConnectionOptions,
  MetricsOptions,

  // Worker types
  WorkerOptions,
  Processor,
  NamedProcessor,
  RateLimiterOptions,

  // Event types
  QueueEventType,
  WorkerEventType,
  QueueEvents as QueueEventsType,

  // Flow types
  FlowJob,
  FlowProducerOptions,
} from './types'
