// Scheduled Jobs Example - Type definitions

/**
 * A scheduled job definition
 */
export interface Job {
  $type: 'Job'
  name: string
  description?: string
  schedule: string // Cron expression or $.every pattern name
  handler: string // Handler name to invoke
  config?: Record<string, unknown>
  enabled: boolean
  timezone?: string
  retryPolicy?: RetryPolicy
  timeout?: number // Max execution time in ms
  createdAt: string
  updatedAt?: string
}

/**
 * Retry configuration for failed jobs
 */
export interface RetryPolicy {
  maxAttempts: number
  backoffMs: number
  backoffMultiplier: number
  maxBackoffMs: number
}

/**
 * A job execution record
 */
export interface JobRun {
  $type: 'JobRun'
  jobId: string
  jobName: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout'
  startedAt: string
  completedAt?: string
  duration?: number // ms
  result?: unknown
  error?: string
  attempt: number
  triggeredBy: 'schedule' | 'manual' | 'retry'
  metadata?: Record<string, unknown>
}

/**
 * Metrics for job performance
 */
export interface JobMetrics {
  $type: 'JobMetrics'
  jobId: string
  period: string // e.g., "2024-01-15"
  totalRuns: number
  successfulRuns: number
  failedRuns: number
  avgDuration: number
  minDuration: number
  maxDuration: number
  lastRunAt?: string
  lastSuccessAt?: string
  lastFailureAt?: string
}

/**
 * A webhook to notify on job events
 */
export interface Webhook {
  $type: 'Webhook'
  name: string
  url: string
  events: WebhookEvent[]
  secret?: string
  enabled: boolean
  createdAt: string
}

export type WebhookEvent = 'job.started' | 'job.completed' | 'job.failed' | 'job.timeout'

/**
 * A recurring report configuration
 */
export interface Report {
  $type: 'Report'
  name: string
  description?: string
  schedule: string
  type: 'daily_summary' | 'weekly_digest' | 'monthly_stats' | 'custom'
  recipients: string[]
  config?: Record<string, unknown>
  enabled: boolean
  lastSentAt?: string
  createdAt: string
}

/**
 * A data sync job
 */
export interface SyncJob {
  $type: 'SyncJob'
  name: string
  source: {
    type: 'api' | 'database' | 'file'
    config: Record<string, unknown>
  }
  destination: {
    type: 'api' | 'database' | 'file'
    config: Record<string, unknown>
  }
  schedule: string
  lastSyncAt?: string
  lastSyncStatus?: 'success' | 'failure'
  itemsSynced?: number
  enabled: boolean
  createdAt: string
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Create job request
 */
export interface CreateJobRequest {
  name: string
  description?: string
  schedule: string
  handler: string
  config?: Record<string, unknown>
  enabled?: boolean
  timezone?: string
  retryPolicy?: RetryPolicy
  timeout?: number
}

/**
 * Update job request
 */
export interface UpdateJobRequest {
  name?: string
  description?: string
  schedule?: string
  handler?: string
  config?: Record<string, unknown>
  enabled?: boolean
  timezone?: string
  retryPolicy?: RetryPolicy
  timeout?: number
}

/**
 * Job list response with stats
 */
export interface JobListResponse {
  data: Array<
    Job & {
      $id: string
      lastRun?: JobRun
      nextRunAt?: string
      stats?: {
        last24h: { runs: number; failures: number }
      }
    }
  >
}

/**
 * Trigger job request
 */
export interface TriggerJobRequest {
  config?: Record<string, unknown>
  metadata?: Record<string, unknown>
}
