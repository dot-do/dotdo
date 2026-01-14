/**
 * @dotdo/bullmq types
 *
 * BullMQ compatible type definitions for the job queue
 * backed by Durable Objects with in-memory storage
 *
 * @see https://docs.bullmq.io/
 */

// ============================================================================
// JOB TYPES
// ============================================================================

/**
 * Job state
 */
export type JobState =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed'
  | 'prioritized'
  | 'paused'

/**
 * Job options
 */
export interface JobOptions {
  /** Job priority (1 = highest, 21 = lowest, default: 0) */
  priority?: number
  /** Delay in milliseconds before job becomes active */
  delay?: number
  /** Number of retry attempts on failure */
  attempts?: number
  /** Backoff configuration for retries */
  backoff?: number | BackoffOptions
  /** LIFO order (last in, first out) */
  lifo?: boolean
  /** Maximum job timeout in milliseconds */
  timeout?: number
  /** Remove job on completion (true = immediately, number = keep count) */
  removeOnComplete?: boolean | number | KeepJobs
  /** Remove job on failure (true = immediately, number = keep count) */
  removeOnFail?: boolean | number | KeepJobs
  /** Unique job ID (prevents duplicates with same ID) */
  jobId?: string
  /** Stack trace limit on errors */
  stackTraceLimit?: number
  /** Parent job for dependency chains */
  parent?: ParentKeys
  /** Repeat configuration for repeatable jobs */
  repeat?: RepeatOptions
  /** Prevent parent from completing until all children complete */
  prevMillis?: number
  /** Custom data passed to job processor */
  sizeLimit?: number
  /** Debounce configuration */
  debounce?: DebounceOptions
}

/**
 * Backoff configuration
 */
export interface BackoffOptions {
  /** Backoff type */
  type: 'fixed' | 'exponential' | 'custom'
  /** Delay in milliseconds */
  delay?: number
}

/**
 * Keep jobs configuration
 */
export interface KeepJobs {
  /** Maximum number of jobs to keep */
  count?: number
  /** Maximum age in milliseconds */
  age?: number
}

/**
 * Parent job keys
 */
export interface ParentKeys {
  /** Parent queue name */
  queue: string
  /** Parent job ID */
  id: string
}

/**
 * Repeat options for scheduled jobs
 */
export interface RepeatOptions {
  /** Cron pattern (e.g., "* * * * *") */
  pattern?: string
  /** Milliseconds between repeats */
  every?: number
  /** Maximum number of times to repeat */
  limit?: number
  /** Start date for repeat */
  startDate?: Date | string | number
  /** End date for repeat */
  endDate?: Date | string | number
  /** Key to identify repeatable job */
  key?: string
  /** Count of times job has repeated */
  count?: number
  /** Timezone for cron (IANA timezone) */
  tz?: string
  /** Immediately run first iteration */
  immediately?: boolean
}

/**
 * Debounce options
 */
export interface DebounceOptions {
  /** Debounce ID */
  id: string
  /** Time to live for debounce in milliseconds */
  ttl?: number
}

/**
 * Job JSON representation
 */
export interface JobJson<T = unknown, R = unknown> {
  /** Job ID */
  id: string
  /** Job name */
  name: string
  /** Job data */
  data: T
  /** Job options */
  opts: JobOptions
  /** Current progress (0-100 or custom object) */
  progress: number | object
  /** Delay timestamp */
  delay?: number
  /** Timestamp when job was created */
  timestamp: number
  /** Timestamp when job was finished */
  finishedOn?: number
  /** Timestamp when job was processed */
  processedOn?: number
  /** Number of attempts made */
  attemptsMade: number
  /** Stack trace from failure */
  stacktrace?: string[]
  /** Return value from job */
  returnvalue?: R
  /** Failure reason */
  failedReason?: string
  /** Parent job reference */
  parent?: ParentKeys
  /** Parent key string */
  parentKey?: string
  /** Repeat job key */
  repeatJobKey?: string
}

/**
 * Bulk job definition
 */
export interface BulkJobOptions<T = unknown> {
  /** Job name */
  name: string
  /** Job data */
  data: T
  /** Job options */
  opts?: JobOptions
}

// ============================================================================
// QUEUE TYPES
// ============================================================================

/**
 * Queue options
 */
export interface QueueOptions {
  /** Connection options */
  connection?: ConnectionOptions
  /** Default job options */
  defaultJobOptions?: JobOptions
  /** Queue prefix */
  prefix?: string
  /** Shared connection */
  sharedConnection?: boolean
  /** Metrics configuration */
  metrics?: MetricsOptions
}

/**
 * Connection options (for Redis compatibility)
 */
export interface ConnectionOptions {
  /** Redis host */
  host?: string
  /** Redis port */
  port?: number
  /** Redis password */
  password?: string
  /** Redis database */
  db?: number
  /** TLS options */
  tls?: boolean
  /** Connection timeout */
  connectTimeout?: number
}

/**
 * Metrics options
 */
export interface MetricsOptions {
  /** Maximum data points */
  maxDataPoints?: number
}

/**
 * Queue counts
 */
export interface QueueCounts {
  /** Jobs waiting to be processed */
  waiting: number
  /** Jobs currently being processed */
  active: number
  /** Successfully completed jobs */
  completed: number
  /** Failed jobs */
  failed: number
  /** Delayed jobs */
  delayed: number
  /** Prioritized jobs */
  prioritized: number
  /** Paused jobs */
  paused: number
}

/**
 * Queue job counts by type
 */
export interface JobCounts extends QueueCounts {
  /** Total count */
  total: number
}

// ============================================================================
// WORKER TYPES
// ============================================================================

/**
 * Worker options
 */
export interface WorkerOptions {
  /** Connection options */
  connection?: ConnectionOptions
  /** Number of concurrent jobs */
  concurrency?: number
  /** Maximum jobs to keep in memory */
  maxStalledCount?: number
  /** Stalled job check interval */
  stalledInterval?: number
  /** Lock duration in milliseconds */
  lockDuration?: number
  /** Lock renew time */
  lockRenewTime?: number
  /** Auto run worker on instantiation */
  autorun?: boolean
  /** Limiter configuration */
  limiter?: RateLimiterOptions
  /** Queue prefix */
  prefix?: string
  /** Metrics configuration */
  metrics?: MetricsOptions
  /** Skip stalled check */
  skipStalledCheck?: boolean
  /** Use sandbox (separate process) */
  useWorkerThreads?: boolean
}

/**
 * Rate limiter options
 */
export interface RateLimiterOptions {
  /** Maximum jobs in duration */
  max: number
  /** Duration in milliseconds */
  duration: number
  /** Bounce back delay */
  bounceBack?: boolean
  /** Group key for rate limiting */
  groupKey?: string
}

/**
 * Processor function signature
 */
export type Processor<T = unknown, R = unknown> = (
  job: Job<T, R>
) => Promise<R> | R

/**
 * Named processor mapping
 */
export type NamedProcessor<T = unknown, R = unknown> = {
  [name: string]: Processor<T, R>
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Queue event types
 */
export type QueueEventType =
  | 'active'
  | 'completed'
  | 'delayed'
  | 'drained'
  | 'error'
  | 'failed'
  | 'paused'
  | 'progress'
  | 'removed'
  | 'resumed'
  | 'stalled'
  | 'waiting'

/**
 * Worker event types
 */
export type WorkerEventType =
  | 'active'
  | 'closed'
  | 'completed'
  | 'drained'
  | 'error'
  | 'failed'
  | 'paused'
  | 'progress'
  | 'ready'
  | 'resumed'
  | 'stalled'

/**
 * Queue events listener
 */
export interface QueueEvents {
  on(event: 'active', listener: (args: { jobId: string; prev?: string }) => void): this
  on(event: 'completed', listener: (args: { jobId: string; returnvalue: string; prev?: string }) => void): this
  on(event: 'delayed', listener: (args: { jobId: string; delay: number }) => void): this
  on(event: 'drained', listener: () => void): this
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'failed', listener: (args: { jobId: string; failedReason: string; prev?: string }) => void): this
  on(event: 'paused', listener: () => void): this
  on(event: 'progress', listener: (args: { jobId: string; data: number | object }) => void): this
  on(event: 'removed', listener: (args: { jobId: string }) => void): this
  on(event: 'resumed', listener: () => void): this
  on(event: 'stalled', listener: (args: { jobId: string }) => void): this
  on(event: 'waiting', listener: (args: { jobId: string }) => void): this
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Base BullMQ error
 */
export class BullMQError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BullMQError'
  }
}

/**
 * Job not found error
 */
export class JobNotFoundError extends BullMQError {
  constructor(jobId: string) {
    super(`Job ${jobId} not found`)
    this.name = 'JobNotFoundError'
  }
}

/**
 * Queue not found error
 */
export class QueueNotFoundError extends BullMQError {
  constructor(queueName: string) {
    super(`Queue ${queueName} not found`)
    this.name = 'QueueNotFoundError'
  }
}

/**
 * Job already exists error (for unique job IDs)
 */
export class JobAlreadyExistsError extends BullMQError {
  constructor(jobId: string) {
    super(`Job ${jobId} already exists`)
    this.name = 'JobAlreadyExistsError'
  }
}

/**
 * Worker not ready error
 */
export class WorkerNotReadyError extends BullMQError {
  constructor() {
    super('Worker is not ready')
    this.name = 'WorkerNotReadyError'
  }
}

/**
 * Queue paused error
 */
export class QueuePausedError extends BullMQError {
  constructor(queueName: string) {
    super(`Queue ${queueName} is paused`)
    this.name = 'QueuePausedError'
  }
}

/**
 * Invalid job data error
 */
export class InvalidJobDataError extends BullMQError {
  constructor(message = 'Invalid job data') {
    super(message)
    this.name = 'InvalidJobDataError'
  }
}

/**
 * Job lock error
 */
export class JobLockError extends BullMQError {
  constructor(jobId: string) {
    super(`Failed to acquire lock for job ${jobId}`)
    this.name = 'JobLockError'
  }
}

/**
 * Job timeout error
 */
export class JobTimeoutError extends BullMQError {
  constructor(jobId: string, timeout: number) {
    super(`Job ${jobId} timed out after ${timeout}ms`)
    this.name = 'JobTimeoutError'
  }
}

// ============================================================================
// JOB CLASS INTERFACE
// ============================================================================

/**
 * Job interface (actual implementation in bullmq.ts)
 */
export interface Job<T = unknown, R = unknown> {
  /** Job ID */
  readonly id: string
  /** Job name */
  readonly name: string
  /** Queue name */
  readonly queueName: string
  /** Job data */
  data: T
  /** Job options */
  readonly opts: JobOptions
  /** Current progress */
  progress: number | object
  /** Timestamp when created */
  readonly timestamp: number
  /** Number of attempts made */
  attemptsMade: number
  /** Stack trace from failures */
  stacktrace: string[]
  /** Return value */
  returnvalue?: R
  /** Failed reason */
  failedReason?: string
  /** Finished timestamp */
  finishedOn?: number
  /** Processed timestamp */
  processedOn?: number

  /** Update job progress */
  updateProgress(progress: number | object): Promise<void>
  /** Get current job state */
  getState(): Promise<JobState>
  /** Move job to waiting state */
  moveToWaiting(token: string): Promise<boolean | void>
  /** Move job to failed state */
  moveToFailed(error: Error, token: string): Promise<void>
  /** Move job to delayed state */
  moveToDelayed(delay: number): Promise<void>
  /** Retry the job */
  retry(state?: JobState): Promise<void>
  /** Remove the job */
  remove(): Promise<void>
  /** Convert to JSON */
  toJSON(): JobJson<T, R>
  /** Log message for job */
  log(message: string): Promise<void>
  /** Get logs for job */
  getLogs(): Promise<{ logs: string[]; count: number }>
  /** Is job active */
  isActive(): Promise<boolean>
  /** Is job completed */
  isCompleted(): Promise<boolean>
  /** Is job failed */
  isFailed(): Promise<boolean>
  /** Is job delayed */
  isDelayed(): Promise<boolean>
  /** Is job waiting */
  isWaiting(): Promise<boolean>
}

// ============================================================================
// FLOW TYPES
// ============================================================================

/**
 * Flow job definition
 */
export interface FlowJob<T = unknown> {
  /** Job name */
  name: string
  /** Queue name */
  queueName: string
  /** Job data */
  data: T
  /** Job options */
  opts?: Omit<JobOptions, 'parent'>
  /** Child jobs */
  children?: FlowJob<T>[]
}

/**
 * Flow producer options
 */
export interface FlowProducerOptions {
  /** Connection options */
  connection?: ConnectionOptions
  /** Queue prefix */
  prefix?: string
}
