/**
 * TaskQueue Types
 * Background job queue primitives for the dotdo platform
 */

/** Unique identifier for a task */
export type TaskId = string

/** Type identifier for task handlers */
export type TaskType = string

/** Status of a task in the queue */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

/** A task to be processed */
export interface Task<T = unknown> {
  id: TaskId
  type: TaskType
  payload: T
  priority: number
  status: TaskStatus
  attempts: number
  createdAt: Date
  updatedAt: Date
  startedAt?: Date
  completedAt?: Date
  error?: string
}

/** Result of task execution */
export interface TaskResult<R = unknown> {
  success: boolean
  result?: R
  error?: Error
  duration: number
}

/** Handler function for processing tasks */
export type TaskHandler<T = unknown, R = unknown> = (
  task: Task<T>,
  context: TaskContext
) => Promise<R>

/** Context passed to task handlers */
export interface TaskContext {
  /** Report progress */
  progress: (current: number, total: number, message?: string) => void
  /** Check if task should abort */
  signal: AbortSignal
}

/** Configuration for the queue */
export interface QueueConfig {
  /** Maximum concurrent tasks (default: 1) */
  concurrency: number
  /** Maximum retry attempts (default: 3) */
  retries: number
  /** Task timeout in milliseconds (default: 30000) */
  timeout: number
  /** Backoff strategy */
  backoff: BackoffConfig
}

/** Backoff configuration for retries */
export interface BackoffConfig {
  /** Type of backoff strategy */
  type: 'fixed' | 'exponential' | 'linear'
  /** Initial delay in milliseconds */
  delay: number
  /** Maximum delay in milliseconds */
  maxDelay: number
  /** Multiplier for exponential backoff */
  factor: number
}

/** A scheduled task with timing information */
export interface ScheduledTask<T = unknown> {
  task: Omit<Task<T>, 'id' | 'status' | 'attempts' | 'createdAt' | 'updatedAt'>
  /** Specific time to run */
  runAt?: Date
  /** Cron expression for recurring tasks */
  cron?: string
}

/** Progress information for a running task */
export interface TaskProgress {
  taskId: TaskId
  current: number
  total: number
  message?: string
  percentage: number
  updatedAt: Date
}

/** Configuration for dead letter queue */
export interface DeadLetterConfig {
  /** Maximum age of failed tasks before removal (milliseconds) */
  maxAge: number
  /** Handler for dead letter tasks */
  handler?: (task: Task) => Promise<void>
}

/** Options for enqueueing a task */
export interface EnqueueOptions {
  /** Task priority (higher = more important, default: 0) */
  priority?: number
  /** Delay before task becomes available (milliseconds) */
  delay?: number
  /** Custom task ID */
  id?: TaskId
}

/** Events emitted by the TaskQueue */
export interface TaskQueueEvents {
  'task:enqueued': Task
  'task:started': Task
  'task:completed': Task & { result: TaskResult }
  'task:failed': Task & { error: Error }
  'task:cancelled': Task
  'task:progress': TaskProgress
  'task:retry': Task & { attempt: number; nextDelay: number }
  'task:deadletter': Task
  'queue:empty': void
  'queue:paused': void
  'queue:resumed': void
}

/** Event handler type */
export type TaskQueueEventHandler<K extends keyof TaskQueueEvents> = (
  data: TaskQueueEvents[K]
) => void

/** Default configuration values */
export const DEFAULT_CONFIG: QueueConfig = {
  concurrency: 1,
  retries: 3,
  timeout: 30000,
  backoff: {
    type: 'exponential',
    delay: 1000,
    maxDelay: 60000,
    factor: 2,
  },
}

/** Generate a unique task ID */
export function generateTaskId(): TaskId {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}
