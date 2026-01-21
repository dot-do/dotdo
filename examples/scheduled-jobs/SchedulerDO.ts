// Scheduled Jobs Durable Object
// Demonstrates: $.every scheduling, alarms, recurring tasks, job queues, retries
// Key patterns: Fluent scheduler DSL, durable execution, job metrics

import { Hono } from 'hono'
import { DO, type DOEnv, createContext, type WorkflowContext } from '../../do'
import type {
  Job,
  JobRun,
  JobMetrics,
  Webhook,
  Report,
  SyncJob,
  CreateJobRequest,
  UpdateJobRequest,
  TriggerJobRequest,
} from './types'

// Constants
const DEFAULT_TIMEOUT = 30000 // 30 seconds
const MAX_TIMEOUT = 300000 // 5 minutes
const DEFAULT_RETRY_POLICY = {
  maxAttempts: 3,
  backoffMs: 1000,
  backoffMultiplier: 2,
  maxBackoffMs: 60000,
}

export class SchedulerDO extends DO {
  protected declare override $: WorkflowContext

  // Track pending retries
  private pendingRetries: Map<string, NodeJS.Timeout> = new Map()

  constructor(state: DurableObjectState, env: DOEnv) {
    super(state, env)

    this.$ = createContext(state, env)

    // ========================================================================
    // Event Handlers for Job Lifecycle
    // ========================================================================

    this.$.on.Job.started(async (event) => {
      const { jobId, runId, jobName } = (event as { type: string; payload: { jobId: string; runId: string; jobName: string } }).payload
      console.log(`[Event] Job started: ${jobName} (run: ${runId})`)

      // Notify webhooks
      await this.notifyWebhooks('job.started', { jobId, runId, jobName })
    })

    this.$.on.Job.completed(async (event) => {
      const { jobId, runId, jobName, duration } = (event as { type: string; payload: { jobId: string; runId: string; jobName: string; duration: number } }).payload
      console.log(`[Event] Job completed: ${jobName} in ${duration}ms`)

      await this.notifyWebhooks('job.completed', { jobId, runId, jobName, duration })
      await this.updateMetrics(jobId, 'success', duration)
    })

    this.$.on.Job.failed(async (event) => {
      const { jobId, runId, jobName, error, attempt, willRetry } = (event as { type: string; payload: { jobId: string; runId: string; jobName: string; error: string; attempt: number; willRetry: boolean } }).payload
      console.log(`[Event] Job failed: ${jobName} (attempt ${attempt}): ${error}`)

      await this.notifyWebhooks('job.failed', { jobId, runId, jobName, error, attempt, willRetry })
      await this.updateMetrics(jobId, 'failure', 0)
    })

    this.$.on.Job.timeout(async (event) => {
      const { jobId, runId, jobName, timeout } = (event as { type: string; payload: { jobId: string; runId: string; jobName: string; timeout: number } }).payload
      console.log(`[Event] Job timeout: ${jobName} after ${timeout}ms`)

      await this.notifyWebhooks('job.timeout', { jobId, runId, jobName, timeout })
    })

    // ========================================================================
    // Built-in Scheduled Tasks using $.every pattern
    // ========================================================================

    // Every minute - check for jobs to run
    this.$.every.minute(async () => {
      await this.checkScheduledJobs()
    })

    // Every hour - aggregate metrics
    this.$.every.hour(async () => {
      await this.aggregateHourlyMetrics()
    })

    // Every day at midnight - clean up old job runs
    this.$.every.day.atmidnight(async () => {
      await this.cleanupOldRuns()
    })

    // Every day at 6am - send daily digest
    this.$.every.day.at6am(async () => {
      await this.sendDailyDigest()
    })

    // Every Monday at 9am - send weekly report
    this.$.every.Monday.at9am(async () => {
      await this.sendWeeklyReport()
    })

    // Every first of month - send monthly stats
    this.$.every.month(async () => {
      await this.sendMonthlyStats()
    })
  }

  protected routes(app: Hono): void {
    // ========================================================================
    // Jobs CRUD
    // ========================================================================

    // List all jobs
    app.get('/jobs', async (c) => {
      const jobs = await this.things.list({ type: 'Job' })
      const runs = await this.things.list({ type: 'JobRun' })

      const enrichedJobs = await Promise.all(
        (jobs as unknown as (Job & { $id: string })[]).map(async (job) => {
          // Get last run
          const jobRuns = (runs as unknown as (JobRun & { $id: string })[])
            .filter((r) => r.jobId === job.$id)
            .sort(
              (a, b) =>
                new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
            )

          const lastRun = jobRuns[0]

          // Calculate 24h stats
          const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
          const last24hRuns = jobRuns.filter(
            (r) => new Date(r.startedAt).getTime() > oneDayAgo
          )

          return {
            ...job,
            lastRun,
            stats: {
              last24h: {
                runs: last24hRuns.length,
                failures: last24hRuns.filter(
                  (r) => r.status === 'failed' || r.status === 'timeout'
                ).length,
              },
            },
          }
        })
      )

      return c.json({ data: enrichedJobs })
    })

    // Create job
    app.post('/jobs', async (c) => {
      const body = await c.req.json<CreateJobRequest>()

      if (!body.name || !body.schedule || !body.handler) {
        return c.json({ error: 'Name, schedule, and handler are required' }, 400)
      }

      const job = await this.things.create({
        $type: 'Job',
        name: body.name,
        description: body.description,
        schedule: body.schedule,
        handler: body.handler,
        config: body.config,
        enabled: body.enabled ?? true,
        timezone: body.timezone,
        retryPolicy: body.retryPolicy || DEFAULT_RETRY_POLICY,
        timeout: Math.min(body.timeout || DEFAULT_TIMEOUT, MAX_TIMEOUT),
        createdAt: new Date().toISOString(),
      })

      c.header('Location', `/jobs/${job.$id}`)
      return c.json(job, 201)
    })

    // Get job
    app.get('/jobs/:id', async (c) => {
      const job = await this.things.get(c.req.param('id'))

      if (!job || job.$type !== 'Job') {
        return c.json({ error: 'Job not found' }, 404)
      }

      // Get recent runs
      const allRuns = await this.things.list({ type: 'JobRun' })
      const recentRuns = (allRuns as unknown as (JobRun & { $id: string })[])
        .filter((r) => r.jobId === job.$id)
        .sort(
          (a, b) =>
            new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
        )
        .slice(0, 10)

      return c.json({
        job,
        recentRuns,
        _links: {
          self: { href: `/jobs/${job.$id}` },
          runs: { href: `/jobs/${job.$id}/runs` },
          trigger: { href: `/jobs/${job.$id}/trigger`, method: 'POST' },
        },
      })
    })

    // Update job
    app.patch('/jobs/:id', async (c) => {
      const jobId = c.req.param('id')
      const body = await c.req.json<UpdateJobRequest>()

      const job = await this.things.get(jobId)
      if (!job || job.$type !== 'Job') {
        return c.json({ error: 'Job not found' }, 404)
      }

      const updates: Partial<Job> = { updatedAt: new Date().toISOString() }

      if (body.name !== undefined) updates.name = body.name
      if (body.description !== undefined) updates.description = body.description
      if (body.schedule !== undefined) updates.schedule = body.schedule
      if (body.handler !== undefined) updates.handler = body.handler
      if (body.config !== undefined) updates.config = body.config
      if (body.enabled !== undefined) updates.enabled = body.enabled
      if (body.timezone !== undefined) updates.timezone = body.timezone
      if (body.retryPolicy !== undefined) updates.retryPolicy = body.retryPolicy
      if (body.timeout !== undefined) {
        updates.timeout = Math.min(body.timeout, MAX_TIMEOUT)
      }

      const updated = await this.things.update(jobId, updates)
      return c.json(updated)
    })

    // Delete job
    app.delete('/jobs/:id', async (c) => {
      const jobId = c.req.param('id')

      const job = await this.things.get(jobId)
      if (!job || job.$type !== 'Job') {
        return c.json({ error: 'Job not found' }, 404)
      }

      // Cancel any pending retries
      const retryKey = `retry:${jobId}`
      const pending = this.pendingRetries.get(retryKey)
      if (pending) {
        clearTimeout(pending)
        this.pendingRetries.delete(retryKey)
      }

      await this.things.delete(jobId)

      return c.body(null, 204)
    })

    // ========================================================================
    // Job Execution
    // ========================================================================

    // Trigger job manually
    app.post('/jobs/:id/trigger', async (c) => {
      const jobId = c.req.param('id')
      const body = await c.req.json<TriggerJobRequest>().catch(() => ({}))

      const job = await this.things.get(jobId)
      if (!job || job.$type !== 'Job') {
        return c.json({ error: 'Job not found' }, 404)
      }

      const jobData = job as unknown as Job & { $id: string }

      // Merge config
      const mergedConfig = { ...jobData.config, ...body.config }

      // Execute job
      const run = await this.executeJob(
        jobData,
        mergedConfig,
        'manual',
        body.metadata
      )

      return c.json(run, 202)
    })

    // Get job runs
    app.get('/jobs/:id/runs', async (c) => {
      const jobId = c.req.param('id')
      const limit = parseInt(c.req.query('limit') || '50')
      const status = c.req.query('status') as JobRun['status'] | undefined

      const allRuns = await this.things.list({ type: 'JobRun' })
      let runs = (allRuns as unknown as (JobRun & { $id: string })[])
        .filter((r) => r.jobId === jobId)
        .sort(
          (a, b) =>
            new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
        )

      if (status) {
        runs = runs.filter((r) => r.status === status)
      }

      return c.json({
        data: runs.slice(0, limit),
        pagination: { total: runs.length, limit },
      })
    })

    // Get specific run
    app.get('/runs/:id', async (c) => {
      const run = await this.things.get(c.req.param('id'))

      if (!run || run.$type !== 'JobRun') {
        return c.json({ error: 'Run not found' }, 404)
      }

      return c.json(run)
    })

    // Cancel running job
    app.post('/runs/:id/cancel', async (c) => {
      const runId = c.req.param('id')
      const run = await this.things.get(runId)

      if (!run || run.$type !== 'JobRun') {
        return c.json({ error: 'Run not found' }, 404)
      }

      const runData = run as unknown as JobRun
      if (runData.status !== 'running' && runData.status !== 'pending') {
        return c.json({ error: 'Run is not cancellable' }, 400)
      }

      await this.things.update(runId, {
        status: 'cancelled',
        completedAt: new Date().toISOString(),
      })

      return c.json({ message: 'Run cancelled' })
    })

    // ========================================================================
    // Metrics
    // ========================================================================

    // Get job metrics
    app.get('/jobs/:id/metrics', async (c) => {
      const jobId = c.req.param('id')
      const days = parseInt(c.req.query('days') || '7')

      const allMetrics = await this.things.list({ type: 'JobMetrics' })
      const jobMetrics = (allMetrics as unknown as (JobMetrics & { $id: string })[])
        .filter((m) => m.jobId === jobId)
        .sort((a, b) => b.period.localeCompare(a.period))
        .slice(0, days)

      return c.json({ data: jobMetrics })
    })

    // Get overall metrics
    app.get('/metrics', async (c) => {
      const allRuns = await this.things.list({ type: 'JobRun' })
      const runs = allRuns as unknown as (JobRun & { $id: string })[]

      const now = Date.now()
      const last24h = runs.filter(
        (r) => now - new Date(r.startedAt).getTime() < 24 * 60 * 60 * 1000
      )

      const completed = last24h.filter((r) => r.status === 'completed')
      const failed = last24h.filter(
        (r) => r.status === 'failed' || r.status === 'timeout'
      )

      const avgDuration =
        completed.length > 0
          ? completed.reduce((sum, r) => sum + (r.duration || 0), 0) /
            completed.length
          : 0

      return c.json({
        last24h: {
          totalRuns: last24h.length,
          completed: completed.length,
          failed: failed.length,
          successRate:
            last24h.length > 0
              ? ((completed.length / last24h.length) * 100).toFixed(1) + '%'
              : 'N/A',
          avgDuration: Math.round(avgDuration),
        },
      })
    })

    // ========================================================================
    // Webhooks
    // ========================================================================

    app.get('/webhooks', async (c) => {
      const webhooks = await this.things.list({ type: 'Webhook' })
      return c.json({ data: webhooks })
    })

    app.post('/webhooks', async (c) => {
      const body = await c.req.json<{
        name: string
        url: string
        events: Webhook['events']
        secret?: string
      }>()

      const webhook = await this.things.create({
        $type: 'Webhook',
        name: body.name,
        url: body.url,
        events: body.events,
        secret: body.secret,
        enabled: true,
        createdAt: new Date().toISOString(),
      })

      return c.json(webhook, 201)
    })

    app.delete('/webhooks/:id', async (c) => {
      await this.things.delete(c.req.param('id'))
      return c.body(null, 204)
    })

    // ========================================================================
    // Reports
    // ========================================================================

    app.get('/reports', async (c) => {
      const reports = await this.things.list({ type: 'Report' })
      return c.json({ data: reports })
    })

    app.post('/reports', async (c) => {
      const body = await c.req.json<{
        name: string
        description?: string
        schedule: string
        type: Report['type']
        recipients: string[]
        config?: Record<string, unknown>
      }>()

      const report = await this.things.create({
        $type: 'Report',
        name: body.name,
        description: body.description,
        schedule: body.schedule,
        type: body.type,
        recipients: body.recipients,
        config: body.config,
        enabled: true,
        createdAt: new Date().toISOString(),
      })

      return c.json(report, 201)
    })

    // ========================================================================
    // Health Check
    // ========================================================================

    app.get('/health', async (c) => {
      const jobs = await this.things.list({ type: 'Job' })
      const enabledJobs = jobs.filter((j) => (j as unknown as Job).enabled)

      const allRuns = await this.things.list({ type: 'JobRun' })
      const recentRuns = (allRuns as unknown as JobRun[]).filter(
        (r) => Date.now() - new Date(r.startedAt).getTime() < 60 * 60 * 1000
      )
      const recentFailures = recentRuns.filter(
        (r) => r.status === 'failed' || r.status === 'timeout'
      )

      return c.json({
        status: recentFailures.length > recentRuns.length / 2 ? 'degraded' : 'healthy',
        jobs: {
          total: jobs.length,
          enabled: enabledJobs.length,
        },
        lastHour: {
          runs: recentRuns.length,
          failures: recentFailures.length,
        },
      })
    })
  }

  // ==========================================================================
  // Job Execution Engine
  // ==========================================================================

  private async executeJob(
    job: Job & { $id: string },
    config: Record<string, unknown> | undefined,
    triggeredBy: JobRun['triggeredBy'],
    metadata?: Record<string, unknown>,
    attempt = 1
  ): Promise<JobRun & { $id: string }> {
    const startedAt = new Date().toISOString()

    // Create run record
    const run = await this.things.create({
      $type: 'JobRun',
      jobId: job.$id,
      jobName: job.name,
      status: 'running',
      startedAt,
      attempt,
      triggeredBy,
      metadata,
    }) as unknown as JobRun & { $id: string }

    // Fire started event
    this.$.send({
      type: 'Job.started',
      payload: { jobId: job.$id, runId: run.$id, jobName: job.name },
    })

    const timeout = job.timeout || DEFAULT_TIMEOUT

    try {
      // Execute handler with timeout
      const result = await Promise.race([
        this.runHandler(job.handler, config),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), timeout)
        ),
      ])

      const completedAt = new Date().toISOString()
      const duration = new Date(completedAt).getTime() - new Date(startedAt).getTime()

      // Update run record
      await this.things.update(run.$id, {
        status: 'completed',
        completedAt,
        duration,
        result,
      })

      // Fire completed event
      this.$.send({
        type: 'Job.completed',
        payload: { jobId: job.$id, runId: run.$id, jobName: job.name, duration },
      })

      return { ...run, status: 'completed', completedAt, duration, result }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const isTimeout = errorMessage === 'TIMEOUT'

      const completedAt = new Date().toISOString()
      const duration = new Date(completedAt).getTime() - new Date(startedAt).getTime()

      // Check if should retry
      const retryPolicy = job.retryPolicy || DEFAULT_RETRY_POLICY
      const willRetry = !isTimeout && attempt < retryPolicy.maxAttempts

      // Update run record
      await this.things.update(run.$id, {
        status: isTimeout ? 'timeout' : 'failed',
        completedAt,
        duration,
        error: errorMessage,
      })

      // Fire appropriate event
      if (isTimeout) {
        this.$.send({
          type: 'Job.timeout',
          payload: { jobId: job.$id, runId: run.$id, jobName: job.name, timeout },
        })
      } else {
        this.$.send({
          type: 'Job.failed',
          payload: {
            jobId: job.$id,
            runId: run.$id,
            jobName: job.name,
            error: errorMessage,
            attempt,
            willRetry,
          },
        })
      }

      // Schedule retry if applicable
      if (willRetry) {
        const backoffMs = Math.min(
          retryPolicy.backoffMs * Math.pow(retryPolicy.backoffMultiplier, attempt - 1),
          retryPolicy.maxBackoffMs
        )

        console.log(
          `[Scheduler] Scheduling retry ${attempt + 1} for ${job.name} in ${backoffMs}ms`
        )

        const retryKey = `retry:${job.$id}`
        const existingRetry = this.pendingRetries.get(retryKey)
        if (existingRetry) {
          clearTimeout(existingRetry)
        }

        const retryTimeout = setTimeout(async () => {
          this.pendingRetries.delete(retryKey)
          await this.executeJob(job, config, 'retry', metadata, attempt + 1)
        }, backoffMs)

        this.pendingRetries.set(retryKey, retryTimeout)
      }

      return {
        ...run,
        status: isTimeout ? 'timeout' : 'failed',
        completedAt,
        duration,
        error: errorMessage,
      }
    }
  }

  /**
   * Run the named handler
   * In production, this would dynamically invoke registered handlers
   */
  private async runHandler(
    handlerName: string,
    config?: Record<string, unknown>
  ): Promise<unknown> {
    console.log(`[Handler] Running: ${handlerName}`, config)

    // Built-in handlers for demonstration
    switch (handlerName) {
      case 'cleanup':
        return this.handlerCleanup(config)

      case 'sync':
        return this.handlerSync(config)

      case 'report':
        return this.handlerReport(config)

      case 'healthcheck':
        return this.handlerHealthcheck(config)

      case 'backup':
        return this.handlerBackup(config)

      default:
        console.log(`[Handler] Unknown handler: ${handlerName}`)
        return { message: `Handler ${handlerName} executed`, config }
    }
  }

  // ==========================================================================
  // Built-in Job Handlers
  // ==========================================================================

  private async handlerCleanup(
    config?: Record<string, unknown>
  ): Promise<{ deleted: number }> {
    const daysToKeep = (config?.daysToKeep as number) || 30
    const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString()

    const runs = await this.things.list({ type: 'JobRun' })
    let deleted = 0

    for (const run of runs) {
      if ((run as unknown as JobRun).startedAt < cutoff) {
        await this.things.delete(run.$id)
        deleted++
      }
    }

    return { deleted }
  }

  private async handlerSync(
    config?: Record<string, unknown>
  ): Promise<{ synced: number }> {
    // Simulated sync - in production, actually sync data
    const synced = Math.floor(Math.random() * 100)
    console.log(`[Sync] Synced ${synced} items`)
    return { synced }
  }

  private async handlerReport(
    config?: Record<string, unknown>
  ): Promise<{ sent: boolean }> {
    // Simulated report - in production, generate and send report
    console.log('[Report] Generating report...')
    return { sent: true }
  }

  private async handlerHealthcheck(
    config?: Record<string, unknown>
  ): Promise<{ healthy: boolean; checks: Record<string, boolean> }> {
    return {
      healthy: true,
      checks: {
        database: true,
        api: true,
        storage: true,
      },
    }
  }

  private async handlerBackup(
    config?: Record<string, unknown>
  ): Promise<{ backed_up: number }> {
    // Simulated backup
    const allThings = await this.things.list({})
    return { backed_up: allThings.length }
  }

  // ==========================================================================
  // Scheduled Task Implementations
  // ==========================================================================

  private async checkScheduledJobs(): Promise<void> {
    const jobs = await this.things.list({ type: 'Job' })
    const enabledJobs = (jobs as unknown as (Job & { $id: string })[]).filter(
      (j) => j.enabled
    )

    for (const job of enabledJobs) {
      // Check if job should run based on schedule
      // In production, use proper cron parsing
      if (this.shouldRunNow(job.schedule)) {
        console.log(`[Scheduler] Triggering scheduled job: ${job.name}`)
        await this.executeJob(job, job.config, 'schedule')
      }
    }
  }

  private shouldRunNow(schedule: string): boolean {
    // Simplified schedule check
    // In production, use a proper cron parser like `cron-parser`
    const now = new Date()

    if (schedule === '* * * * *') {
      return true // Every minute
    }

    if (schedule === '0 * * * *') {
      return now.getMinutes() === 0 // Every hour
    }

    if (schedule === '0 0 * * *') {
      return now.getHours() === 0 && now.getMinutes() === 0 // Every day at midnight
    }

    // For $.every patterns, they're handled by the constructor
    return false
  }

  private async aggregateHourlyMetrics(): Promise<void> {
    console.log('[Scheduler] Aggregating hourly metrics...')

    const jobs = await this.things.list({ type: 'Job' })
    const runs = await this.things.list({ type: 'JobRun' })
    const today = new Date().toISOString().split('T')[0]

    for (const job of jobs) {
      const jobRuns = (runs as unknown as JobRun[]).filter(
        (r) => r.jobId === job.$id && r.startedAt.startsWith(today)
      )

      if (jobRuns.length === 0) continue

      const completed = jobRuns.filter((r) => r.status === 'completed')
      const failed = jobRuns.filter(
        (r) => r.status === 'failed' || r.status === 'timeout'
      )

      const durations = completed
        .map((r) => r.duration || 0)
        .filter((d) => d > 0)

      // Update or create metrics for today
      const existingMetrics = await this.things.list({ type: 'JobMetrics' })
      const todayMetrics = existingMetrics.find(
        (m) =>
          (m as unknown as JobMetrics).jobId === job.$id &&
          (m as unknown as JobMetrics).period === today
      )

      const metricsData = {
        totalRuns: jobRuns.length,
        successfulRuns: completed.length,
        failedRuns: failed.length,
        avgDuration:
          durations.length > 0
            ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
            : 0,
        minDuration: durations.length > 0 ? Math.min(...durations) : 0,
        maxDuration: durations.length > 0 ? Math.max(...durations) : 0,
        lastRunAt: jobRuns[jobRuns.length - 1]?.startedAt,
        lastSuccessAt: completed[completed.length - 1]?.startedAt,
        lastFailureAt: failed[failed.length - 1]?.startedAt,
      }

      if (todayMetrics) {
        await this.things.update(todayMetrics.$id, metricsData)
      } else {
        await this.things.create({
          $type: 'JobMetrics',
          jobId: job.$id,
          period: today,
          ...metricsData,
        })
      }
    }
  }

  private async cleanupOldRuns(): Promise<void> {
    console.log('[Scheduler] Cleaning up old runs...')
    await this.runHandler('cleanup', { daysToKeep: 30 })
  }

  private async sendDailyDigest(): Promise<void> {
    console.log('[Scheduler] Sending daily digest...')

    const reports = await this.things.list({ type: 'Report' })
    const dailyReports = (reports as unknown as Report[]).filter(
      (r) => r.type === 'daily_summary' && r.enabled
    )

    for (const report of dailyReports) {
      // In production, generate and send actual report
      console.log(`[Report] Sending daily summary to: ${report.recipients.join(', ')}`)
    }
  }

  private async sendWeeklyReport(): Promise<void> {
    console.log('[Scheduler] Sending weekly report...')

    const reports = await this.things.list({ type: 'Report' })
    const weeklyReports = (reports as unknown as Report[]).filter(
      (r) => r.type === 'weekly_digest' && r.enabled
    )

    for (const report of weeklyReports) {
      console.log(`[Report] Sending weekly digest to: ${report.recipients.join(', ')}`)
    }
  }

  private async sendMonthlyStats(): Promise<void> {
    console.log('[Scheduler] Sending monthly stats...')

    const reports = await this.things.list({ type: 'Report' })
    const monthlyReports = (reports as unknown as Report[]).filter(
      (r) => r.type === 'monthly_stats' && r.enabled
    )

    for (const report of monthlyReports) {
      console.log(`[Report] Sending monthly stats to: ${report.recipients.join(', ')}`)
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private async notifyWebhooks(
    event: Webhook['events'][number],
    payload: Record<string, unknown>
  ): Promise<void> {
    const webhooks = await this.things.list({ type: 'Webhook' })
    const matchingWebhooks = (webhooks as unknown as Webhook[]).filter(
      (w) => w.enabled && w.events.includes(event)
    )

    for (const webhook of matchingWebhooks) {
      try {
        // In production, implement proper webhook delivery with retries
        console.log(`[Webhook] Notifying ${webhook.url} of ${event}`)
        // await fetch(webhook.url, { method: 'POST', body: JSON.stringify(payload) })
      } catch (error) {
        console.error(`[Webhook] Failed to notify ${webhook.url}:`, error)
      }
    }
  }

  private async updateMetrics(
    jobId: string,
    status: 'success' | 'failure',
    duration: number
  ): Promise<void> {
    const today = new Date().toISOString().split('T')[0]
    const existingMetrics = await this.things.list({ type: 'JobMetrics' })
    const todayMetrics = existingMetrics.find(
      (m) =>
        (m as unknown as JobMetrics).jobId === jobId &&
        (m as unknown as JobMetrics).period === today
    ) as (JobMetrics & { $id: string }) | undefined

    if (todayMetrics) {
      const updates: Partial<JobMetrics> = {
        totalRuns: todayMetrics.totalRuns + 1,
      }

      if (status === 'success') {
        updates.successfulRuns = todayMetrics.successfulRuns + 1
        updates.lastSuccessAt = new Date().toISOString()
        if (duration > 0) {
          const newAvg =
            (todayMetrics.avgDuration * todayMetrics.successfulRuns + duration) /
            (todayMetrics.successfulRuns + 1)
          updates.avgDuration = Math.round(newAvg)
          updates.minDuration = Math.min(todayMetrics.minDuration || duration, duration)
          updates.maxDuration = Math.max(todayMetrics.maxDuration || 0, duration)
        }
      } else {
        updates.failedRuns = todayMetrics.failedRuns + 1
        updates.lastFailureAt = new Date().toISOString()
      }

      updates.lastRunAt = new Date().toISOString()

      await this.things.update(todayMetrics.$id, updates)
    }
  }
}

// Export for worker binding
export { SchedulerDO as DO }
