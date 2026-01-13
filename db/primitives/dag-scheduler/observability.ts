/**
 * DAGScheduler Observability - Metrics, SLA monitoring, and hooks
 *
 * Provides comprehensive observability for workflow/DAG execution:
 * - Task and DAG metrics collection (duration, success/failure rates)
 * - SLA monitoring with deadline tracking and alerts
 * - Observer callbacks for custom integrations
 * - Tracing span creation and propagation
 * - Structured logging integration
 *
 * @module db/primitives/dag-scheduler/observability
 */

import type { DAG, TaskNode, DAGRun, TaskResult, TaskStatus, ParallelExecutor } from './index'
import { createParallelExecutor } from './index'

// ============================================================================
// METRIC TYPES
// ============================================================================

/** Individual metric event */
export interface MetricEvent {
  type: 'dag_start' | 'dag_complete' | 'task_start' | 'task_complete' | 'task_retry'
  timestamp: number
  dagId: string
  runId: string
  taskId?: string
  status?: TaskStatus | 'completed' | 'failed' | 'cancelled'
  duration?: number
  attempt?: number
  error?: Error
}

/** Aggregated task metrics */
export interface TaskMetrics {
  totalRuns: number
  successCount: number
  failureCount: number
  retryCount: number
  avgDuration: number
  minDuration: number
  maxDuration: number
  p50Duration: number
  p95Duration: number
  p99Duration: number
  successRate: number
  lastError?: Error
}

/** Aggregated DAG metrics */
export interface DAGMetrics {
  totalRuns: number
  completedCount: number
  failedCount: number
  cancelledCount: number
  avgDuration: number
  minDuration: number
  maxDuration: number
  taskStatusCounts: {
    success: number
    failed: number
    skipped: number
    pending: number
    running: number
  }
}

/** Options for filtering metrics */
export interface MetricsFilterOptions {
  windowMs?: number
  since?: number
}

/** Metrics collector interface */
export interface MetricsCollector {
  // Event recording
  recordDAGStart(dagId: string, runId: string): void
  recordDAGComplete(dagId: string, runId: string, status: string, duration: number): void
  recordTaskStart(dagId: string, runId: string, taskId: string): void
  recordTaskComplete(
    dagId: string,
    runId: string,
    taskId: string,
    status: TaskStatus | string,
    duration: number,
    error?: Error,
    timestamp?: number
  ): void
  recordRetry(dagId: string, runId: string, taskId: string, attempt: number, error: Error): void

  // Metrics retrieval
  getEvents(): MetricEvent[]
  getTaskMetrics(taskId: string, options?: MetricsFilterOptions): TaskMetrics
  getDAGMetrics(dagId: string, options?: MetricsFilterOptions): DAGMetrics
  getConcurrentTasks(runId: string): number

  // Export
  toPrometheus(): string
  toJSON(): { tasks: Record<string, TaskMetrics>; dags: Record<string, DAGMetrics> }

  // Management
  reset(): void
}

// ============================================================================
// SLA TYPES
// ============================================================================

/** SLA configuration for a task */
export interface TaskSLAConfig {
  maxDuration?: number
  successRateThreshold?: number
  warningThreshold?: number
}

/** SLA configuration for a DAG */
export interface DAGSLAConfig {
  maxDuration?: number
  deadline?: string
  warningThreshold?: number
}

/** SLA configuration (combined) */
export type SLAConfig = TaskSLAConfig | DAGSLAConfig

/** SLA violation record */
export interface SLAViolation {
  type: 'duration' | 'deadline' | 'success_rate' | 'duration_warning' | 'deadline_warning'
  dagId: string
  runId: string
  taskId?: string
  actual: number | string
  threshold: number | string
  timestamp: number
  message?: string
}

/** SLA violation callback */
export type SLAViolationCallback = (violation: SLAViolation) => void

/** Options for filtering violations */
export interface ViolationFilterOptions {
  since?: number
  type?: SLAViolation['type']
  dagId?: string
  taskId?: string
}

/** SLA monitor interface */
export interface SLAMonitor {
  // Configuration
  registerTaskSLA(taskId: string, config: TaskSLAConfig): void
  registerDAGSLA(dagId: string, config: DAGSLAConfig): void
  getTaskSLA(taskId: string): TaskSLAConfig | undefined
  getDAGSLA(dagId: string): DAGSLAConfig | undefined

  // Checking
  checkTaskDuration(
    dagId: string,
    runId: string,
    taskId: string,
    duration: number,
    timestamp?: number
  ): SLAViolation | null
  checkDAGDeadline(dagId: string, runId: string, timestamp?: number): SLAViolation | null
  checkSuccessRate(taskId: string, rate: number): SLAViolation | null

  // Alerts
  onViolation(callback: SLAViolationCallback): void
  onWarning(callback: SLAViolationCallback): void
  getViolationHistory(options?: ViolationFilterOptions): SLAViolation[]
}

// ============================================================================
// OBSERVER TYPES
// ============================================================================

/** Observer callback functions */
export interface ObserverCallbacks {
  onDAGStart?: (dag: DAG, runId: string) => void | Promise<void>
  onDAGComplete?: (dag: DAG, runId: string, result: DAGRun) => void | Promise<void>
  onTaskStart?: (task: TaskNode, runId: string) => void | Promise<void>
  onTaskComplete?: (task: TaskNode, runId: string, result: TaskResult) => void | Promise<void>
  onRetry?: (task: TaskNode, attempt: number, error: Error) => void | Promise<void>
}

/** DAG observer interface */
export interface DAGObserver extends ObserverCallbacks {
  // Additional methods can be added here
}

// ============================================================================
// TRACER TYPES
// ============================================================================

/** Span interface for tracing */
export interface Span {
  end(): void
  setAttribute(key: string, value: unknown): void
  recordException?(error: Error): void
}

/** Tracer interface */
export interface Tracer {
  startSpan(name: string, attributes: Record<string, unknown>): Span
}

// ============================================================================
// LOGGER TYPES
// ============================================================================

/** Structured logger interface */
export interface StructuredLogger {
  info(message: string, context: Record<string, unknown>): void
  warn(message: string, context: Record<string, unknown>): void
  error(message: string, context: Record<string, unknown>): void
}

// ============================================================================
// OBSERVABLE EXECUTOR TYPES
// ============================================================================

/** Observable executor options */
export interface ObservableExecutorOptions {
  metricsCollector?: MetricsCollector
  slaMonitor?: SLAMonitor
  observer?: DAGObserver
  observers?: DAGObserver[]
  tracer?: Tracer
  logger?: StructuredLogger
}

/** Observable executor interface */
export interface ObservableExecutor extends ParallelExecutor {
  getMetricsCollector(): MetricsCollector | undefined
  getSLAMonitor(): SLAMonitor | undefined
}

// ============================================================================
// METRICS COLLECTOR IMPLEMENTATION
// ============================================================================

/** Create a metrics collector */
export function createMetricsCollector(): MetricsCollector {
  const events: MetricEvent[] = []
  const taskDurations: Map<string, number[]> = new Map()
  const taskErrors: Map<string, Error> = new Map()
  const runningTasks: Map<string, Set<string>> = new Map()
  const taskRetries: Map<string, number> = new Map()
  const dagDurations: Map<string, number[]> = new Map()
  const dagTaskCounts: Map<string, { success: number; failed: number; skipped: number }> = new Map()

  const getOrCreateRunningSet = (runId: string): Set<string> => {
    let set = runningTasks.get(runId)
    if (!set) {
      set = new Set()
      runningTasks.set(runId, set)
    }
    return set
  }

  const filterEventsByTime = (allEvents: MetricEvent[], options?: MetricsFilterOptions): MetricEvent[] => {
    if (!options) return allEvents
    const now = Date.now()
    const cutoff = options.since ?? (options.windowMs ? now - options.windowMs : 0)
    return allEvents.filter((e) => e.timestamp >= cutoff)
  }

  const calculatePercentile = (sorted: number[], percentile: number): number => {
    if (sorted.length === 0) return 0
    const index = Math.ceil((percentile / 100) * sorted.length) - 1
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0
  }

  return {
    recordDAGStart(dagId: string, runId: string): void {
      events.push({
        type: 'dag_start',
        timestamp: Date.now(),
        dagId,
        runId,
      })
    },

    recordDAGComplete(dagId: string, runId: string, status: string, duration: number): void {
      events.push({
        type: 'dag_complete',
        timestamp: Date.now(),
        dagId,
        runId,
        status: status as 'completed' | 'failed' | 'cancelled',
        duration,
      })

      // Track DAG durations
      const durations = dagDurations.get(dagId) ?? []
      durations.push(duration)
      dagDurations.set(dagId, durations)
    },

    recordTaskStart(dagId: string, runId: string, taskId: string): void {
      events.push({
        type: 'task_start',
        timestamp: Date.now(),
        dagId,
        runId,
        taskId,
      })

      // Track concurrent tasks
      const running = getOrCreateRunningSet(runId)
      running.add(taskId)
    },

    recordTaskComplete(
      dagId: string,
      runId: string,
      taskId: string,
      status: TaskStatus | string,
      duration: number,
      error?: Error,
      timestamp?: number
    ): void {
      events.push({
        type: 'task_complete',
        timestamp: timestamp ?? Date.now(),
        dagId,
        runId,
        taskId,
        status: status as TaskStatus,
        duration,
        error,
      })

      // Track durations
      const durations = taskDurations.get(taskId) ?? []
      durations.push(duration)
      taskDurations.set(taskId, durations)

      // Track errors
      if (error) {
        taskErrors.set(taskId, error)
      }

      // Update concurrent count
      const running = runningTasks.get(runId)
      if (running) {
        running.delete(taskId)
      }

      // Update DAG task counts
      const counts = dagTaskCounts.get(dagId) ?? { success: 0, failed: 0, skipped: 0 }
      if (status === 'success') counts.success++
      else if (status === 'failed') counts.failed++
      else if (status === 'skipped') counts.skipped++
      dagTaskCounts.set(dagId, counts)
    },

    recordRetry(dagId: string, runId: string, taskId: string, attempt: number, error: Error): void {
      events.push({
        type: 'task_retry',
        timestamp: Date.now(),
        dagId,
        runId,
        taskId,
        attempt,
        error,
      })

      // Track retry count
      const current = taskRetries.get(taskId) ?? 0
      taskRetries.set(taskId, current + 1)
    },

    getEvents(): MetricEvent[] {
      return [...events]
    },

    getTaskMetrics(taskId: string, options?: MetricsFilterOptions): TaskMetrics {
      const relevantEvents = filterEventsByTime(events, options).filter((e) => e.taskId === taskId)

      const completeEvents = relevantEvents.filter((e) => e.type === 'task_complete')
      const successEvents = completeEvents.filter((e) => e.status === 'success')
      const failureEvents = completeEvents.filter((e) => e.status === 'failed')
      const retryEvents = relevantEvents.filter((e) => e.type === 'task_retry')

      const durations = completeEvents.map((e) => e.duration!).filter((d) => d !== undefined)
      const sortedDurations = [...durations].sort((a, b) => a - b)

      const totalRuns = completeEvents.length
      const successCount = successEvents.length
      const failureCount = failureEvents.length
      const retryCount = retryEvents.length
      const successRate = totalRuns > 0 ? successCount / totalRuns : 0

      const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0
      const minDuration = sortedDurations.length > 0 ? sortedDurations[0]! : 0
      const maxDuration = sortedDurations.length > 0 ? sortedDurations[sortedDurations.length - 1]! : 0

      const lastError = taskErrors.get(taskId)

      return {
        totalRuns,
        successCount,
        failureCount,
        retryCount,
        avgDuration,
        minDuration,
        maxDuration,
        p50Duration: calculatePercentile(sortedDurations, 50),
        p95Duration: calculatePercentile(sortedDurations, 95),
        p99Duration: calculatePercentile(sortedDurations, 99),
        successRate,
        lastError,
      }
    },

    getDAGMetrics(dagId: string, options?: MetricsFilterOptions): DAGMetrics {
      const relevantEvents = filterEventsByTime(events, options).filter((e) => e.dagId === dagId)

      const completeEvents = relevantEvents.filter((e) => e.type === 'dag_complete')
      const completedEvents = completeEvents.filter((e) => e.status === 'completed')
      const failedEvents = completeEvents.filter((e) => e.status === 'failed')
      const cancelledEvents = completeEvents.filter((e) => e.status === 'cancelled')

      const durations = completeEvents.map((e) => e.duration!).filter((d) => d !== undefined)
      const sortedDurations = [...durations].sort((a, b) => a - b)

      const counts = dagTaskCounts.get(dagId) ?? { success: 0, failed: 0, skipped: 0 }

      const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0

      return {
        totalRuns: completeEvents.length,
        completedCount: completedEvents.length,
        failedCount: failedEvents.length,
        cancelledCount: cancelledEvents.length,
        avgDuration,
        minDuration: sortedDurations.length > 0 ? sortedDurations[0]! : 0,
        maxDuration: sortedDurations.length > 0 ? sortedDurations[sortedDurations.length - 1]! : 0,
        taskStatusCounts: {
          success: counts.success,
          failed: counts.failed,
          skipped: counts.skipped,
          pending: 0,
          running: 0,
        },
      }
    },

    getConcurrentTasks(runId: string): number {
      const running = runningTasks.get(runId)
      return running ? running.size : 0
    },

    toPrometheus(): string {
      const lines: string[] = []

      // Task metrics
      lines.push('# HELP dag_task_runs_total Total number of task runs')
      lines.push('# TYPE dag_task_runs_total counter')
      for (const taskId of taskDurations.keys()) {
        const metrics = this.getTaskMetrics(taskId)
        lines.push(`dag_task_runs_total{task="${taskId}",status="success"} ${metrics.successCount}`)
        lines.push(`dag_task_runs_total{task="${taskId}",status="failed"} ${metrics.failureCount}`)
      }

      lines.push('# HELP dag_task_duration_seconds Task execution duration')
      lines.push('# TYPE dag_task_duration_seconds histogram')
      for (const taskId of taskDurations.keys()) {
        const metrics = this.getTaskMetrics(taskId)
        lines.push(`dag_task_duration_seconds{task="${taskId}",quantile="0.5"} ${metrics.p50Duration / 1000}`)
        lines.push(`dag_task_duration_seconds{task="${taskId}",quantile="0.95"} ${metrics.p95Duration / 1000}`)
        lines.push(`dag_task_duration_seconds{task="${taskId}",quantile="0.99"} ${metrics.p99Duration / 1000}`)
      }

      // DAG metrics
      lines.push('# HELP dag_runs_total Total number of DAG runs')
      lines.push('# TYPE dag_runs_total counter')
      for (const dagId of dagDurations.keys()) {
        const metrics = this.getDAGMetrics(dagId)
        lines.push(`dag_runs_total{dag="${dagId}",status="completed"} ${metrics.completedCount}`)
        lines.push(`dag_runs_total{dag="${dagId}",status="failed"} ${metrics.failedCount}`)
      }

      return lines.join('\n')
    },

    toJSON(): { tasks: Record<string, TaskMetrics>; dags: Record<string, DAGMetrics> } {
      const tasks: Record<string, TaskMetrics> = {}
      const dags: Record<string, DAGMetrics> = {}

      for (const taskId of taskDurations.keys()) {
        tasks[taskId] = this.getTaskMetrics(taskId)
      }

      for (const dagId of dagDurations.keys()) {
        dags[dagId] = this.getDAGMetrics(dagId)
      }

      return { tasks, dags }
    },

    reset(): void {
      events.length = 0
      taskDurations.clear()
      taskErrors.clear()
      runningTasks.clear()
      taskRetries.clear()
      dagDurations.clear()
      dagTaskCounts.clear()
    },
  }
}

// ============================================================================
// SLA MONITOR IMPLEMENTATION
// ============================================================================

/** Create an SLA monitor */
export function createSLAMonitor(): SLAMonitor {
  const taskSLAs: Map<string, TaskSLAConfig> = new Map()
  const dagSLAs: Map<string, DAGSLAConfig> = new Map()
  const violationHistory: SLAViolation[] = []
  const violationCallbacks: SLAViolationCallback[] = []
  const warningCallbacks: SLAViolationCallback[] = []

  const emitViolation = (violation: SLAViolation): void => {
    violationHistory.push(violation)
    for (const callback of violationCallbacks) {
      try {
        callback(violation)
      } catch {
        // Ignore callback errors
      }
    }
  }

  const emitWarning = (warning: SLAViolation): void => {
    for (const callback of warningCallbacks) {
      try {
        callback(warning)
      } catch {
        // Ignore callback errors
      }
    }
  }

  return {
    registerTaskSLA(taskId: string, config: TaskSLAConfig): void {
      taskSLAs.set(taskId, config)
    },

    registerDAGSLA(dagId: string, config: DAGSLAConfig): void {
      dagSLAs.set(dagId, config)
    },

    getTaskSLA(taskId: string): TaskSLAConfig | undefined {
      return taskSLAs.get(taskId)
    },

    getDAGSLA(dagId: string): DAGSLAConfig | undefined {
      return dagSLAs.get(dagId)
    },

    checkTaskDuration(
      dagId: string,
      runId: string,
      taskId: string,
      duration: number,
      timestamp?: number
    ): SLAViolation | null {
      const config = taskSLAs.get(taskId)
      if (!config?.maxDuration) return null

      const ts = timestamp ?? Date.now()

      // Check warning threshold
      if (config.warningThreshold) {
        const warningLimit = config.maxDuration * config.warningThreshold
        if (duration >= warningLimit && duration < config.maxDuration) {
          const warning: SLAViolation = {
            type: 'duration_warning',
            dagId,
            runId,
            taskId,
            actual: duration,
            threshold: warningLimit,
            timestamp: ts,
            message: `Task ${taskId} duration (${duration}ms) approaching SLA limit (${config.maxDuration}ms)`,
          }
          emitWarning(warning)
        }
      }

      // Check violation
      if (duration > config.maxDuration) {
        const violation: SLAViolation = {
          type: 'duration',
          dagId,
          runId,
          taskId,
          actual: duration,
          threshold: config.maxDuration,
          timestamp: ts,
          message: `Task ${taskId} exceeded duration SLA: ${duration}ms > ${config.maxDuration}ms`,
        }
        emitViolation(violation)
        return violation
      }

      return null
    },

    checkDAGDeadline(dagId: string, runId: string, timestamp?: number): SLAViolation | null {
      const config = dagSLAs.get(dagId)
      if (!config?.deadline) return null

      const ts = timestamp ?? Date.now()
      const deadlineTime = new Date(config.deadline).getTime()

      if (ts > deadlineTime) {
        const violation: SLAViolation = {
          type: 'deadline',
          dagId,
          runId,
          actual: new Date(ts).toISOString(),
          threshold: config.deadline,
          timestamp: ts,
          message: `DAG ${dagId} missed deadline: ${config.deadline}`,
        }
        emitViolation(violation)
        return violation
      }

      return null
    },

    checkSuccessRate(taskId: string, rate: number): SLAViolation | null {
      const config = taskSLAs.get(taskId)
      if (!config?.successRateThreshold) return null

      if (rate < config.successRateThreshold) {
        const violation: SLAViolation = {
          type: 'success_rate',
          dagId: '',
          runId: '',
          taskId,
          actual: rate,
          threshold: config.successRateThreshold,
          timestamp: Date.now(),
          message: `Task ${taskId} success rate (${(rate * 100).toFixed(1)}%) below threshold (${(config.successRateThreshold * 100).toFixed(1)}%)`,
        }
        emitViolation(violation)
        return violation
      }

      return null
    },

    onViolation(callback: SLAViolationCallback): void {
      violationCallbacks.push(callback)
    },

    onWarning(callback: SLAViolationCallback): void {
      warningCallbacks.push(callback)
    },

    getViolationHistory(options?: ViolationFilterOptions): SLAViolation[] {
      let filtered = [...violationHistory]

      if (options?.since) {
        filtered = filtered.filter((v) => v.timestamp >= options.since!)
      }
      if (options?.type) {
        filtered = filtered.filter((v) => v.type === options.type)
      }
      if (options?.dagId) {
        filtered = filtered.filter((v) => v.dagId === options.dagId)
      }
      if (options?.taskId) {
        filtered = filtered.filter((v) => v.taskId === options.taskId)
      }

      return filtered
    },
  }
}

// ============================================================================
// OBSERVER IMPLEMENTATION
// ============================================================================

/** Create a DAG observer */
export function createObserver(callbacks: ObserverCallbacks): DAGObserver {
  return {
    onDAGStart: callbacks.onDAGStart,
    onDAGComplete: callbacks.onDAGComplete,
    onTaskStart: callbacks.onTaskStart,
    onTaskComplete: callbacks.onTaskComplete,
    onRetry: callbacks.onRetry,
  }
}

// ============================================================================
// OBSERVABLE EXECUTOR IMPLEMENTATION
// ============================================================================

/** Create an observable executor */
export function createObservableExecutor(options: ObservableExecutorOptions = {}): ObservableExecutor {
  const { metricsCollector, slaMonitor, observer, observers = [], tracer, logger } = options
  const allObservers = observer ? [observer, ...observers] : observers

  // Create the base executor with our instrumented callbacks
  const baseExecutor = createParallelExecutor({
    onTaskStart: async (task) => {
      const runId = 'current' // Will be set properly in execute

      // Record metrics
      if (metricsCollector) {
        metricsCollector.recordTaskStart('', runId, task.id)
      }

      // Log
      if (logger) {
        logger.info('Task started', { taskId: task.id, runId })
      }

      // Call observers
      for (const obs of allObservers) {
        try {
          await obs.onTaskStart?.(task, runId)
        } catch {
          // Ignore observer errors
        }
      }
    },

    onTaskComplete: async (task, result) => {
      const runId = 'current' // Will be set properly in execute

      // Record metrics
      if (metricsCollector) {
        const duration =
          result.completedAt && result.startedAt
            ? result.completedAt.getTime() - result.startedAt.getTime()
            : 0
        metricsCollector.recordTaskComplete('', runId, task.id, result.status, duration, result.error)
      }

      // Check SLAs
      if (slaMonitor && result.completedAt && result.startedAt) {
        const duration = result.completedAt.getTime() - result.startedAt.getTime()
        slaMonitor.checkTaskDuration('', runId, task.id, duration)
      }

      // Log
      if (logger) {
        if (result.status === 'success') {
          logger.info('Task completed', { taskId: task.id, runId, status: result.status })
        } else if (result.status === 'failed') {
          logger.error('Task failed', {
            taskId: task.id,
            runId,
            status: result.status,
            error: result.error,
          })
        }
      }

      // Call observers
      for (const obs of allObservers) {
        try {
          await obs.onTaskComplete?.(task, runId, result)
        } catch {
          // Ignore observer errors
        }
      }
    },
  })

  // Wrap the execute method to add DAG-level instrumentation
  const wrappedExecute = async (dag: DAG, executeOptions?: Parameters<typeof baseExecutor.execute>[1]) => {
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const startTime = Date.now()
    let dagSpan: Span | undefined

    // Start DAG tracing span
    if (tracer) {
      dagSpan = tracer.startSpan('dag.run', { dagId: dag.id, runId })
    }

    // Record DAG start
    if (metricsCollector) {
      metricsCollector.recordDAGStart(dag.id, runId)
    }

    // Log DAG start
    if (logger) {
      logger.info('DAG started', { dagId: dag.id, runId })
    }

    // Call observers
    for (const obs of allObservers) {
      try {
        await obs.onDAGStart?.(dag, runId)
      } catch {
        // Ignore observer errors
      }
    }

    // Create instrumented callbacks
    const instrumentedOptions = {
      ...executeOptions,
      onTaskStart: async (task: TaskNode) => {
        // Start task span
        let taskSpan: Span | undefined
        if (tracer) {
          taskSpan = tracer.startSpan('task.run', { taskId: task.id, dagId: dag.id, runId })
        }

        // Record metrics
        if (metricsCollector) {
          metricsCollector.recordTaskStart(dag.id, runId, task.id)
        }

        // Log
        if (logger) {
          logger.info('Task started', { taskId: task.id, dagId: dag.id, runId })
        }

        // Call observers
        for (const obs of allObservers) {
          try {
            await obs.onTaskStart?.(task, runId)
          } catch {
            // Ignore observer errors
          }
        }

        // Original callback
        await executeOptions?.onTaskStart?.(task)
      },
      onTaskComplete: async (task: TaskNode, result: TaskResult) => {
        const duration =
          result.completedAt && result.startedAt
            ? result.completedAt.getTime() - result.startedAt.getTime()
            : 0

        // Record metrics
        if (metricsCollector) {
          metricsCollector.recordTaskComplete(dag.id, runId, task.id, result.status, duration, result.error)
        }

        // Check SLAs
        if (slaMonitor) {
          slaMonitor.checkTaskDuration(dag.id, runId, task.id, duration)
        }

        // Tracer - record error if failed
        if (tracer && result.status === 'failed' && result.error) {
          const span = tracer.startSpan('task.error', { taskId: task.id })
          span.recordException?.(result.error)
          span.end()
        }

        // Log
        if (logger) {
          if (result.status === 'success') {
            logger.info('Task completed', {
              taskId: task.id,
              dagId: dag.id,
              runId,
              status: result.status,
              duration,
            })
          } else if (result.status === 'failed') {
            logger.error('Task failed', {
              taskId: task.id,
              dagId: dag.id,
              runId,
              status: result.status,
              error: result.error,
              duration,
            })
          }
        }

        // Call observers
        for (const obs of allObservers) {
          try {
            await obs.onTaskComplete?.(task, runId, result)
          } catch {
            // Ignore observer errors
          }
        }

        // Original callback
        await executeOptions?.onTaskComplete?.(task, result)
      },
    }

    try {
      // Execute the DAG
      const result = await baseExecutor.execute(dag, instrumentedOptions)

      const duration = Date.now() - startTime

      // Record DAG complete
      if (metricsCollector) {
        metricsCollector.recordDAGComplete(dag.id, runId, result.status, duration)
      }

      // Check DAG SLAs
      if (slaMonitor) {
        slaMonitor.checkDAGDeadline(dag.id, runId)
      }

      // Log DAG complete
      if (logger) {
        logger.info('DAG completed', { dagId: dag.id, runId, status: result.status, duration })
      }

      // End DAG span
      if (dagSpan) {
        dagSpan.setAttribute('status', result.status)
        dagSpan.setAttribute('duration', duration)
        dagSpan.end()
      }

      // Call observers
      for (const obs of allObservers) {
        try {
          await obs.onDAGComplete?.(dag, runId, result)
        } catch {
          // Ignore observer errors
        }
      }

      return result
    } catch (error) {
      // Record error in span
      if (dagSpan) {
        dagSpan.recordException?.(error as Error)
        dagSpan.end()
      }

      throw error
    }
  }

  return {
    execute: wrappedExecute,
    cancel: baseExecutor.cancel,
    pause: baseExecutor.pause,
    resume: baseExecutor.resume,
    onDAGComplete: baseExecutor.onDAGComplete,

    getMetricsCollector(): MetricsCollector | undefined {
      return metricsCollector
    },

    getSLAMonitor(): SLAMonitor | undefined {
      return slaMonitor
    },
  }
}
