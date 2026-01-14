/**
 * SchedulerEngine Types
 *
 * Comprehensive type definitions for the job scheduling system.
 */

/**
 * Job status values
 */
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

/**
 * Cron expression components
 */
export interface CronExpression {
  minute: string | number  // 0-59 or '*' or ranges like '0-30' or lists like '0,15,30,45'
  hour: string | number    // 0-23 or '*'
  day: string | number     // 1-31 or '*'
  month: string | number   // 1-12 or '*'
  weekday: string | number // 0-6 (Sunday=0) or '*'
}

/**
 * Job schedule definition - supports cron, interval, or one-time
 */
export interface JobSchedule {
  /** Cron expression (string format: '0 9 * * 1' or structured CronExpression) */
  cron?: string | CronExpression
  /** Interval in milliseconds */
  interval?: number
  /** One-time execution at specific date/time */
  at?: Date | number
  /** Timezone for scheduling (default: 'UTC') */
  timezone?: string
}

/**
 * Job execution options
 */
export interface JobOptions {
  /** Retry configuration */
  retry?: {
    /** Maximum retry attempts (default: 0) */
    maxAttempts?: number
    /** Delay between retries in ms (default: 1000) */
    delay?: number
    /** Exponential backoff factor (default: 1 - no backoff) */
    backoff?: number
  }
  /** Job timeout in ms (default: 30000) */
  timeout?: number
  /** Allow overlapping executions (default: false) */
  overlap?: boolean
  /** Job priority (higher = more priority, default: 0) */
  priority?: number
}

/**
 * Job handler function type
 */
export type JobHandler<T = unknown> = (context: JobContext) => Promise<T> | T

/**
 * Context passed to job handlers
 */
export interface JobContext {
  /** Job ID */
  jobId: string
  /** Job name */
  jobName: string
  /** Execution ID (unique per run) */
  executionId: string
  /** Scheduled time */
  scheduledAt: Date
  /** Actual start time */
  startedAt: Date
  /** Retry attempt number (0 for first attempt) */
  attempt: number
  /** Signal for cancellation */
  signal: AbortSignal
}

/**
 * Job definition
 */
export interface Job<T = unknown> {
  /** Unique job identifier */
  id: string
  /** Human-readable job name */
  name: string
  /** Job handler function */
  handler: JobHandler<T>
  /** Schedule configuration */
  schedule: JobSchedule
  /** Job options */
  options?: JobOptions
  /** Whether job is enabled (default: true) */
  enabled?: boolean
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Job execution record
 */
export interface JobExecution {
  /** Unique execution identifier */
  id: string
  /** Job ID */
  jobId: string
  /** Job name (denormalized for convenience) */
  jobName: string
  /** Execution started at */
  startedAt: Date
  /** Execution completed at (null if still running) */
  completedAt: Date | null
  /** Execution status */
  status: JobStatus
  /** Result from successful execution */
  result?: unknown
  /** Error from failed execution */
  error?: string
  /** Retry attempt number */
  attempt: number
  /** Scheduled time */
  scheduledAt: Date
  /** Duration in ms (null if still running) */
  duration: number | null
}

/**
 * Scheduler configuration
 */
export interface SchedulerConfig {
  /** Maximum concurrent job executions (default: 10) */
  concurrency?: number
  /** Default timezone (default: 'UTC') */
  timezone?: string
  /** Enable persistence (default: false) */
  persistence?: boolean
  /** Tick interval in ms for checking schedules (default: 1000) */
  tickInterval?: number
  /** Error handler for uncaught job errors */
  onError?: (error: Error, job: Job, execution: JobExecution) => void
}

/**
 * Scheduled job entry in the scheduler
 */
export interface ScheduledJob<T = unknown> {
  /** Job definition */
  job: Job<T>
  /** Next scheduled execution time */
  nextRun: Date | null
  /** Last execution time */
  lastRun: Date | null
  /** Is job paused */
  paused: boolean
  /** Current execution (if running) */
  currentExecution: JobExecution | null
}

/**
 * Job status info returned by getStatus
 */
export interface JobStatusInfo {
  /** Job ID */
  id: string
  /** Job name */
  name: string
  /** Is job scheduled (exists in scheduler) */
  scheduled: boolean
  /** Is job paused */
  paused: boolean
  /** Is job currently running */
  running: boolean
  /** Next scheduled run */
  nextRun: Date | null
  /** Last run time */
  lastRun: Date | null
  /** Last execution status */
  lastStatus: JobStatus | null
}

/**
 * Events emitted by the scheduler
 */
export interface SchedulerEvents {
  'job:scheduled': { job: Job }
  'job:unscheduled': { jobId: string }
  'job:started': { job: Job; execution: JobExecution }
  'job:completed': { job: Job; execution: JobExecution }
  'job:failed': { job: Job; execution: JobExecution; error: Error }
  'job:cancelled': { job: Job; execution: JobExecution }
  'job:paused': { job: Job }
  'job:resumed': { job: Job }
  'scheduler:started': Record<string, never>
  'scheduler:stopped': Record<string, never>
  'scheduler:tick': { time: Date }
}
