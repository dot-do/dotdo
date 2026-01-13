/**
 * DAGScheduler Observability Tests
 *
 * RED phase: These tests define the expected behavior of observability hooks and metrics.
 * All tests should FAIL until implementation is complete.
 *
 * Observability features:
 * - Task execution metrics (duration, success, failure)
 * - DAG run statistics
 * - SLA monitoring and alerts
 * - Custom callback hooks
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createDAG,
  createTaskNode,
  createParallelExecutor,
  type DAG,
  type TaskNode,
  type DAGRun,
  type TaskResult,
} from './index'

// Import observability types and factories (to be implemented)
import {
  // Metrics
  type MetricsCollector,
  type TaskMetrics,
  type DAGMetrics,
  type MetricEvent,
  createMetricsCollector,
  // SLA Monitoring
  type SLAMonitor,
  type SLAConfig,
  type SLAViolation,
  createSLAMonitor,
  // Callback Hooks
  type DAGObserver,
  type ObserverCallbacks,
  createObserver,
  // Integration
  type ObservableExecutor,
  createObservableExecutor,
} from './observability'

// ============================================================================
// TEST HELPERS
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createSimpleTask(id: string, deps: string[] = [], delayMs = 0): TaskNode {
  return createTaskNode({
    id,
    execute: async () => {
      if (delayMs > 0) await delay(delayMs)
      return `result-${id}`
    },
    dependencies: deps,
  })
}

function createFailingTask(id: string, deps: string[] = []): TaskNode {
  return createTaskNode({
    id,
    execute: async () => {
      throw new Error(`Task ${id} failed`)
    },
    dependencies: deps,
  })
}

// ============================================================================
// METRICS COLLECTOR - TASK EXECUTION METRICS
// ============================================================================

describe('MetricsCollector', () => {
  let collector: MetricsCollector

  beforeEach(() => {
    collector = createMetricsCollector()
  })

  describe('task metrics', () => {
    it('should record task start event', () => {
      collector.recordTaskStart('dag-1', 'run-1', 'task-a')

      const events = collector.getEvents()
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'task_start',
          dagId: 'dag-1',
          runId: 'run-1',
          taskId: 'task-a',
        })
      )
    })

    it('should record task success with duration', () => {
      const startTime = Date.now()
      collector.recordTaskStart('dag-1', 'run-1', 'task-a')
      collector.recordTaskComplete('dag-1', 'run-1', 'task-a', 'success', 150)

      const metrics = collector.getTaskMetrics('task-a')
      expect(metrics.totalRuns).toBe(1)
      expect(metrics.successCount).toBe(1)
      expect(metrics.failureCount).toBe(0)
      expect(metrics.avgDuration).toBe(150)
    })

    it('should record task failure with error', () => {
      collector.recordTaskStart('dag-1', 'run-1', 'task-a')
      collector.recordTaskComplete('dag-1', 'run-1', 'task-a', 'failed', 50, new Error('Failed'))

      const metrics = collector.getTaskMetrics('task-a')
      expect(metrics.totalRuns).toBe(1)
      expect(metrics.successCount).toBe(0)
      expect(metrics.failureCount).toBe(1)
      expect(metrics.lastError?.message).toBe('Failed')
    })

    it('should track retry attempts', () => {
      collector.recordRetry('dag-1', 'run-1', 'task-a', 1, new Error('Retry'))
      collector.recordRetry('dag-1', 'run-1', 'task-a', 2, new Error('Retry'))

      const metrics = collector.getTaskMetrics('task-a')
      expect(metrics.retryCount).toBe(2)
    })

    it('should calculate success rate', () => {
      collector.recordTaskComplete('dag-1', 'run-1', 'task-a', 'success', 100)
      collector.recordTaskComplete('dag-1', 'run-2', 'task-a', 'success', 100)
      collector.recordTaskComplete('dag-1', 'run-3', 'task-a', 'failed', 100)
      collector.recordTaskComplete('dag-1', 'run-4', 'task-a', 'success', 100)

      const metrics = collector.getTaskMetrics('task-a')
      expect(metrics.successRate).toBeCloseTo(0.75, 2)
    })

    it('should calculate percentile durations', () => {
      // Record 100 tasks with varying durations
      for (let i = 1; i <= 100; i++) {
        collector.recordTaskComplete('dag-1', `run-${i}`, 'task-a', 'success', i * 10)
      }

      const metrics = collector.getTaskMetrics('task-a')
      expect(metrics.p50Duration).toBeCloseTo(500, -1) // ~500ms
      expect(metrics.p95Duration).toBeCloseTo(950, -1) // ~950ms
      expect(metrics.p99Duration).toBeCloseTo(990, -1) // ~990ms
    })

    it('should track min/max duration', () => {
      collector.recordTaskComplete('dag-1', 'run-1', 'task-a', 'success', 50)
      collector.recordTaskComplete('dag-1', 'run-2', 'task-a', 'success', 200)
      collector.recordTaskComplete('dag-1', 'run-3', 'task-a', 'success', 100)

      const metrics = collector.getTaskMetrics('task-a')
      expect(metrics.minDuration).toBe(50)
      expect(metrics.maxDuration).toBe(200)
    })
  })

  describe('DAG metrics', () => {
    it('should record DAG start event', () => {
      collector.recordDAGStart('dag-1', 'run-1')

      const events = collector.getEvents()
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'dag_start',
          dagId: 'dag-1',
          runId: 'run-1',
        })
      )
    })

    it('should record DAG complete with status', () => {
      collector.recordDAGStart('dag-1', 'run-1')
      collector.recordDAGComplete('dag-1', 'run-1', 'completed', 1500)

      const metrics = collector.getDAGMetrics('dag-1')
      expect(metrics.totalRuns).toBe(1)
      expect(metrics.completedCount).toBe(1)
      expect(metrics.failedCount).toBe(0)
      expect(metrics.avgDuration).toBe(1500)
    })

    it('should track concurrent tasks gauge', () => {
      collector.recordTaskStart('dag-1', 'run-1', 'task-a')
      collector.recordTaskStart('dag-1', 'run-1', 'task-b')
      expect(collector.getConcurrentTasks('run-1')).toBe(2)

      collector.recordTaskComplete('dag-1', 'run-1', 'task-a', 'success', 100)
      expect(collector.getConcurrentTasks('run-1')).toBe(1)

      collector.recordTaskComplete('dag-1', 'run-1', 'task-b', 'success', 100)
      expect(collector.getConcurrentTasks('run-1')).toBe(0)
    })

    it('should track tasks per status', () => {
      collector.recordTaskComplete('dag-1', 'run-1', 'task-a', 'success', 100)
      collector.recordTaskComplete('dag-1', 'run-1', 'task-b', 'failed', 50)
      collector.recordTaskComplete('dag-1', 'run-1', 'task-c', 'skipped', 0)

      const metrics = collector.getDAGMetrics('dag-1')
      expect(metrics.taskStatusCounts.success).toBe(1)
      expect(metrics.taskStatusCounts.failed).toBe(1)
      expect(metrics.taskStatusCounts.skipped).toBe(1)
    })
  })

  describe('aggregations', () => {
    it('should aggregate metrics by time window', () => {
      const now = Date.now()
      // Simulate events over time
      collector.recordTaskComplete('dag-1', 'run-1', 'task-a', 'success', 100, undefined, now - 60000)
      collector.recordTaskComplete('dag-1', 'run-2', 'task-a', 'success', 150, undefined, now - 30000)
      collector.recordTaskComplete('dag-1', 'run-3', 'task-a', 'success', 200, undefined, now)

      const last30s = collector.getTaskMetrics('task-a', { windowMs: 30000 })
      expect(last30s.totalRuns).toBe(2) // Only last 30 seconds

      const last90s = collector.getTaskMetrics('task-a', { windowMs: 90000 })
      expect(last90s.totalRuns).toBe(3) // All events
    })

    it('should return empty metrics for unknown task', () => {
      const metrics = collector.getTaskMetrics('unknown-task')
      expect(metrics.totalRuns).toBe(0)
      expect(metrics.successCount).toBe(0)
      expect(metrics.avgDuration).toBe(0)
    })

    it('should reset metrics', () => {
      collector.recordTaskComplete('dag-1', 'run-1', 'task-a', 'success', 100)
      collector.reset()

      const metrics = collector.getTaskMetrics('task-a')
      expect(metrics.totalRuns).toBe(0)
      expect(collector.getEvents()).toEqual([])
    })
  })

  describe('export formats', () => {
    it('should export metrics as Prometheus format', () => {
      collector.recordTaskComplete('dag-1', 'run-1', 'task-a', 'success', 100)
      collector.recordDAGComplete('dag-1', 'run-1', 'completed', 500)

      const prometheus = collector.toPrometheus()
      expect(prometheus).toContain('dag_task_runs_total')
      expect(prometheus).toContain('dag_task_duration_seconds')
      expect(prometheus).toContain('dag_runs_total')
    })

    it('should export metrics as JSON', () => {
      collector.recordTaskComplete('dag-1', 'run-1', 'task-a', 'success', 100)

      const json = collector.toJSON()
      expect(json.tasks['task-a']).toBeDefined()
      expect(json.tasks['task-a'].totalRuns).toBe(1)
    })
  })
})

// ============================================================================
// SLA MONITOR - DEADLINE TRACKING AND ALERTS
// ============================================================================

describe('SLAMonitor', () => {
  let monitor: SLAMonitor

  beforeEach(() => {
    monitor = createSLAMonitor()
  })

  describe('configuration', () => {
    it('should register SLA for task', () => {
      monitor.registerTaskSLA('task-a', {
        maxDuration: 1000, // 1 second
        successRateThreshold: 0.95,
      })

      const config = monitor.getTaskSLA('task-a')
      expect(config).toBeDefined()
      expect(config?.maxDuration).toBe(1000)
    })

    it('should register SLA for DAG', () => {
      monitor.registerDAGSLA('dag-1', {
        maxDuration: 60000, // 1 minute
        deadline: '2026-01-13T10:00:00Z',
      })

      const config = monitor.getDAGSLA('dag-1')
      expect(config).toBeDefined()
      expect(config?.maxDuration).toBe(60000)
    })

    it('should allow updating SLA config', () => {
      monitor.registerTaskSLA('task-a', { maxDuration: 1000 })
      monitor.registerTaskSLA('task-a', { maxDuration: 2000 })

      const config = monitor.getTaskSLA('task-a')
      expect(config?.maxDuration).toBe(2000)
    })
  })

  describe('violation detection', () => {
    it('should detect task duration violation', () => {
      monitor.registerTaskSLA('task-a', { maxDuration: 100 })

      const violation = monitor.checkTaskDuration('dag-1', 'run-1', 'task-a', 150)

      expect(violation).not.toBeNull()
      expect(violation?.type).toBe('duration')
      expect(violation?.taskId).toBe('task-a')
      expect(violation?.actual).toBe(150)
      expect(violation?.threshold).toBe(100)
    })

    it('should not report violation when under threshold', () => {
      monitor.registerTaskSLA('task-a', { maxDuration: 100 })

      const violation = monitor.checkTaskDuration('dag-1', 'run-1', 'task-a', 50)

      expect(violation).toBeNull()
    })

    it('should detect DAG deadline violation', () => {
      const deadline = new Date(Date.now() - 1000).toISOString() // 1 second ago
      monitor.registerDAGSLA('dag-1', { deadline })

      const violation = monitor.checkDAGDeadline('dag-1', 'run-1')

      expect(violation).not.toBeNull()
      expect(violation?.type).toBe('deadline')
      expect(violation?.dagId).toBe('dag-1')
    })

    it('should detect success rate violation', () => {
      monitor.registerTaskSLA('task-a', { successRateThreshold: 0.9 })

      // Record metrics showing 80% success rate
      const violation = monitor.checkSuccessRate('task-a', 0.8)

      expect(violation).not.toBeNull()
      expect(violation?.type).toBe('success_rate')
      expect(violation?.actual).toBe(0.8)
      expect(violation?.threshold).toBe(0.9)
    })
  })

  describe('alerts', () => {
    it('should trigger alert callback on violation', async () => {
      const alerts: SLAViolation[] = []
      monitor.onViolation((violation) => {
        alerts.push(violation)
      })

      monitor.registerTaskSLA('task-a', { maxDuration: 100 })
      monitor.checkTaskDuration('dag-1', 'run-1', 'task-a', 150)

      expect(alerts).toHaveLength(1)
      expect(alerts[0].taskId).toBe('task-a')
    })

    it('should support multiple alert handlers', () => {
      const alerts1: SLAViolation[] = []
      const alerts2: SLAViolation[] = []

      monitor.onViolation((v) => alerts1.push(v))
      monitor.onViolation((v) => alerts2.push(v))

      monitor.registerTaskSLA('task-a', { maxDuration: 100 })
      monitor.checkTaskDuration('dag-1', 'run-1', 'task-a', 150)

      expect(alerts1).toHaveLength(1)
      expect(alerts2).toHaveLength(1)
    })

    it('should track violation history', () => {
      monitor.registerTaskSLA('task-a', { maxDuration: 100 })
      monitor.checkTaskDuration('dag-1', 'run-1', 'task-a', 150)
      monitor.checkTaskDuration('dag-1', 'run-2', 'task-a', 200)

      const history = monitor.getViolationHistory()
      expect(history).toHaveLength(2)
    })

    it('should filter violations by time range', () => {
      const now = Date.now()
      monitor.registerTaskSLA('task-a', { maxDuration: 100 })

      // Simulate violations at different times
      monitor.checkTaskDuration('dag-1', 'run-1', 'task-a', 150, now - 60000)
      monitor.checkTaskDuration('dag-1', 'run-2', 'task-a', 150, now)

      const recent = monitor.getViolationHistory({ since: now - 30000 })
      expect(recent).toHaveLength(1)
    })
  })

  describe('warning thresholds', () => {
    it('should emit warning before violation', () => {
      const warnings: SLAViolation[] = []
      monitor.onWarning((warning) => {
        warnings.push(warning)
      })

      monitor.registerTaskSLA('task-a', {
        maxDuration: 100,
        warningThreshold: 0.8, // Warn at 80% of limit
      })

      // 85ms is above warning (80ms) but below violation (100ms)
      monitor.checkTaskDuration('dag-1', 'run-1', 'task-a', 85)

      expect(warnings).toHaveLength(1)
      expect(warnings[0].type).toBe('duration_warning')
    })
  })
})

// ============================================================================
// OBSERVER CALLBACKS - CUSTOM INTEGRATION HOOKS
// ============================================================================

describe('DAGObserver', () => {
  describe('callback hooks', () => {
    it('should call onDAGStart when DAG begins', async () => {
      const calls: { dagId: string; runId: string }[] = []
      const observer = createObserver({
        onDAGStart: (dag, runId) => {
          calls.push({ dagId: dag.id, runId })
        },
      })

      const d = createDAG({
        id: 'test-dag',
        tasks: [createSimpleTask('a')],
      })

      const executor = createObservableExecutor({ observer })
      await executor.execute(d)

      expect(calls).toHaveLength(1)
      expect(calls[0].dagId).toBe('test-dag')
    })

    it('should call onDAGComplete when DAG finishes', async () => {
      const calls: { dagId: string; status: string }[] = []
      const observer = createObserver({
        onDAGComplete: (dag, runId, result) => {
          calls.push({ dagId: dag.id, status: result.status })
        },
      })

      const d = createDAG({
        id: 'test-dag',
        tasks: [createSimpleTask('a')],
      })

      const executor = createObservableExecutor({ observer })
      await executor.execute(d)

      expect(calls).toHaveLength(1)
      expect(calls[0].status).toBe('completed')
    })

    it('should call onTaskStart before each task', async () => {
      const calls: string[] = []
      const observer = createObserver({
        onTaskStart: (task, runId) => {
          calls.push(task.id)
        },
      })

      const d = createDAG({
        id: 'test-dag',
        tasks: [
          createSimpleTask('a'),
          createSimpleTask('b', ['a']),
        ],
      })

      const executor = createObservableExecutor({ observer })
      await executor.execute(d)

      expect(calls).toEqual(['a', 'b'])
    })

    it('should call onTaskComplete after each task', async () => {
      const calls: { taskId: string; status: string }[] = []
      const observer = createObserver({
        onTaskComplete: (task, runId, result) => {
          calls.push({ taskId: task.id, status: result.status })
        },
      })

      const d = createDAG({
        id: 'test-dag',
        tasks: [createSimpleTask('a'), createFailingTask('b', ['a'])],
      })

      const executor = createObservableExecutor({ observer })
      await executor.execute(d)

      expect(calls).toContainEqual({ taskId: 'a', status: 'success' })
      expect(calls).toContainEqual({ taskId: 'b', status: 'failed' })
    })

    it('should call onRetry when task retries', async () => {
      const retries: { taskId: string; attempt: number }[] = []
      const observer = createObserver({
        onRetry: (task, attempt, error) => {
          retries.push({ taskId: task.id, attempt })
        },
      })

      let attempts = 0
      const d = createDAG({
        id: 'test-dag',
        tasks: [
          createTaskNode({
            id: 'flaky',
            execute: async () => {
              attempts++
              if (attempts < 3) throw new Error('Retry')
              return 'success'
            },
            dependencies: [],
            retryPolicy: {
              maxAttempts: 3,
              backoff: { type: 'fixed', delay: 10 },
            },
          }),
        ],
      })

      const executor = createObservableExecutor({ observer })
      await executor.execute(d)

      expect(retries).toHaveLength(2)
      expect(retries[0].attempt).toBe(1)
      expect(retries[1].attempt).toBe(2)
    })
  })

  describe('async callbacks', () => {
    it('should await async callbacks', async () => {
      const order: string[] = []
      const observer = createObserver({
        onTaskComplete: async (task) => {
          await delay(10)
          order.push(`callback-${task.id}`)
        },
      })

      const d = createDAG({
        id: 'test-dag',
        tasks: [createSimpleTask('a'), createSimpleTask('b', ['a'])],
      })

      const executor = createObservableExecutor({ observer })
      await executor.execute(d)

      expect(order).toEqual(['callback-a', 'callback-b'])
    })

    it('should handle callback errors gracefully', async () => {
      const observer = createObserver({
        onTaskComplete: async () => {
          throw new Error('Callback failed')
        },
      })

      const d = createDAG({
        id: 'test-dag',
        tasks: [createSimpleTask('a')],
      })

      const executor = createObservableExecutor({ observer })
      // Should not throw, just log the error
      const run = await executor.execute(d)

      expect(run.status).toBe('completed')
    })
  })

  describe('multiple observers', () => {
    it('should support multiple observers', async () => {
      const obs1Calls: string[] = []
      const obs2Calls: string[] = []

      const observer1 = createObserver({
        onTaskStart: (task) => obs1Calls.push(task.id),
      })
      const observer2 = createObserver({
        onTaskStart: (task) => obs2Calls.push(task.id),
      })

      const d = createDAG({
        id: 'test-dag',
        tasks: [createSimpleTask('a')],
      })

      const executor = createObservableExecutor({ observers: [observer1, observer2] })
      await executor.execute(d)

      expect(obs1Calls).toEqual(['a'])
      expect(obs2Calls).toEqual(['a'])
    })
  })
})

// ============================================================================
// OBSERVABLE EXECUTOR - INTEGRATED OBSERVABILITY
// ============================================================================

describe('ObservableExecutor', () => {
  describe('integrated metrics', () => {
    it('should automatically collect metrics during execution', async () => {
      const collector = createMetricsCollector()
      const executor = createObservableExecutor({ metricsCollector: collector })

      const d = createDAG({
        id: 'test-dag',
        tasks: [
          createSimpleTask('a', [], 20),
          createSimpleTask('b', ['a'], 30),
        ],
      })

      await executor.execute(d)

      const taskAMetrics = collector.getTaskMetrics('a')
      expect(taskAMetrics.totalRuns).toBe(1)
      expect(taskAMetrics.successCount).toBe(1)
      expect(taskAMetrics.avgDuration).toBeGreaterThanOrEqual(20)

      const dagMetrics = collector.getDAGMetrics('test-dag')
      expect(dagMetrics.totalRuns).toBe(1)
      expect(dagMetrics.completedCount).toBe(1)
    })

    it('should track failed tasks in metrics', async () => {
      const collector = createMetricsCollector()
      const executor = createObservableExecutor({ metricsCollector: collector })

      const d = createDAG({
        id: 'test-dag',
        tasks: [createFailingTask('a')],
      })

      await executor.execute(d)

      const metrics = collector.getTaskMetrics('a')
      expect(metrics.failureCount).toBe(1)
      expect(metrics.lastError?.message).toContain('failed')
    })
  })

  describe('integrated SLA monitoring', () => {
    it('should check SLAs during execution', async () => {
      const monitor = createSLAMonitor()
      const violations: SLAViolation[] = []

      monitor.registerTaskSLA('slow-task', { maxDuration: 10 })
      monitor.onViolation((v) => violations.push(v))

      const executor = createObservableExecutor({ slaMonitor: monitor })

      const d = createDAG({
        id: 'test-dag',
        tasks: [createSimpleTask('slow-task', [], 50)],
      })

      await executor.execute(d)

      expect(violations).toHaveLength(1)
      expect(violations[0].taskId).toBe('slow-task')
    })
  })

  describe('combined observability', () => {
    it('should support all observability features together', async () => {
      const collector = createMetricsCollector()
      const monitor = createSLAMonitor()
      const observerCalls: string[] = []

      const observer = createObserver({
        onDAGStart: () => observerCalls.push('dag-start'),
        onDAGComplete: () => observerCalls.push('dag-complete'),
        onTaskStart: (task) => observerCalls.push(`task-start-${task.id}`),
        onTaskComplete: (task) => observerCalls.push(`task-complete-${task.id}`),
      })

      monitor.registerTaskSLA('a', { maxDuration: 1000 })
      monitor.registerDAGSLA('test-dag', { maxDuration: 5000 })

      const executor = createObservableExecutor({
        metricsCollector: collector,
        slaMonitor: monitor,
        observer,
      })

      const d = createDAG({
        id: 'test-dag',
        tasks: [createSimpleTask('a'), createSimpleTask('b', ['a'])],
      })

      const run = await executor.execute(d)

      // Verify all systems working
      expect(run.status).toBe('completed')
      expect(collector.getTaskMetrics('a').totalRuns).toBe(1)
      expect(collector.getDAGMetrics('test-dag').totalRuns).toBe(1)
      expect(observerCalls).toContain('dag-start')
      expect(observerCalls).toContain('dag-complete')
    })
  })
})

// ============================================================================
// TRACING INTEGRATION
// ============================================================================

describe('Tracing', () => {
  describe('span creation', () => {
    it('should create span for DAG execution', async () => {
      const spans: { name: string; attributes: Record<string, unknown> }[] = []
      const tracer = {
        startSpan: (name: string, attributes: Record<string, unknown>) => {
          const span = { name, attributes, ended: false }
          spans.push(span)
          return {
            end: () => {
              (span as any).ended = true
            },
            setAttribute: (key: string, value: unknown) => {
              span.attributes[key] = value
            },
          }
        },
      }

      const executor = createObservableExecutor({ tracer })

      const d = createDAG({
        id: 'test-dag',
        tasks: [createSimpleTask('a')],
      })

      await executor.execute(d)

      const dagSpan = spans.find((s) => s.name === 'dag.run')
      expect(dagSpan).toBeDefined()
      expect(dagSpan?.attributes.dagId).toBe('test-dag')
    })

    it('should create child spans for tasks', async () => {
      const spans: { name: string; parent?: string }[] = []
      let currentParent: string | undefined

      const tracer = {
        startSpan: (name: string, attributes: Record<string, unknown>) => {
          const span = { name, parent: currentParent }
          spans.push(span)
          const prevParent = currentParent
          if (name === 'dag.run') {
            currentParent = name
          }
          return {
            end: () => {
              if (name === 'dag.run') {
                currentParent = prevParent
              }
            },
            setAttribute: () => {},
          }
        },
      }

      const executor = createObservableExecutor({ tracer })

      const d = createDAG({
        id: 'test-dag',
        tasks: [createSimpleTask('a')],
      })

      await executor.execute(d)

      const taskSpan = spans.find((s) => s.name === 'task.run')
      expect(taskSpan).toBeDefined()
      expect(taskSpan?.parent).toBe('dag.run')
    })

    it('should record error in span on task failure', async () => {
      let errorRecorded = false
      const tracer = {
        startSpan: () => ({
          end: () => {},
          setAttribute: () => {},
          recordException: (error: Error) => {
            errorRecorded = true
          },
        }),
      }

      const executor = createObservableExecutor({ tracer })

      const d = createDAG({
        id: 'test-dag',
        tasks: [createFailingTask('a')],
      })

      await executor.execute(d)

      expect(errorRecorded).toBe(true)
    })
  })
})

// ============================================================================
// STRUCTURED LOGGING
// ============================================================================

describe('StructuredLogging', () => {
  it('should emit structured log events', async () => {
    const logs: { level: string; message: string; context: Record<string, unknown> }[] = []
    const logger = {
      info: (message: string, context: Record<string, unknown>) => {
        logs.push({ level: 'info', message, context })
      },
      error: (message: string, context: Record<string, unknown>) => {
        logs.push({ level: 'error', message, context })
      },
      warn: (message: string, context: Record<string, unknown>) => {
        logs.push({ level: 'warn', message, context })
      },
    }

    const executor = createObservableExecutor({ logger })

    const d = createDAG({
      id: 'test-dag',
      tasks: [createSimpleTask('a')],
    })

    await executor.execute(d)

    expect(logs.some((l) => l.message.includes('DAG started'))).toBe(true)
    expect(logs.some((l) => l.message.includes('Task completed'))).toBe(true)
    expect(logs.some((l) => l.message.includes('DAG completed'))).toBe(true)
  })

  it('should log errors with stack traces', async () => {
    const logs: { level: string; context: Record<string, unknown> }[] = []
    const logger = {
      info: () => {},
      error: (message: string, context: Record<string, unknown>) => {
        logs.push({ level: 'error', context })
      },
      warn: () => {},
    }

    const executor = createObservableExecutor({ logger })

    const d = createDAG({
      id: 'test-dag',
      tasks: [createFailingTask('a')],
    })

    await executor.execute(d)

    const errorLog = logs.find((l) => l.level === 'error')
    expect(errorLog).toBeDefined()
    expect(errorLog?.context.error).toBeDefined()
    expect(errorLog?.context.taskId).toBe('a')
  })
})

// ============================================================================
// HEALTH CHECK INTEGRATION
// ============================================================================

import {
  createDAGHealthCheck,
  createHealthEndpointHandler,
  type DAGHealthStatus,
  type HealthEndpointResponse,
} from './observability'

describe('DAGHealthCheck', () => {
  describe('createDAGHealthCheck', () => {
    it('should return healthy status with no metrics', () => {
      const healthCheck = createDAGHealthCheck()
      const result = healthCheck()

      expect(result.status).toBe('healthy')
      expect(result.message).toBe('DAG scheduler is healthy')
      expect(result.details.metricsAvailable).toBe(false)
    })

    it('should return healthy status with no failures', () => {
      const collector = createMetricsCollector()
      collector.recordTaskComplete('dag-1', 'run-1', 'task-a', 'success', 100)

      const healthCheck = createDAGHealthCheck({ metricsCollector: collector })
      const result = healthCheck()

      expect(result.status).toBe('healthy')
      expect(result.details.recentFailures).toBe(0)
      expect(result.details.metricsAvailable).toBe(true)
    })

    it('should return degraded status with few failures', () => {
      const collector = createMetricsCollector()
      collector.recordTaskComplete('dag-1', 'run-1', 'task-a', 'failed', 100)

      const healthCheck = createDAGHealthCheck({
        metricsCollector: collector,
        failureThreshold: 5,
      })
      const result = healthCheck()

      expect(result.status).toBe('degraded')
      expect(result.details.recentFailures).toBe(1)
    })

    it('should return unhealthy status with many failures', () => {
      const collector = createMetricsCollector()
      for (let i = 0; i < 5; i++) {
        collector.recordTaskComplete('dag-1', `run-${i}`, 'task-a', 'failed', 100)
      }

      const healthCheck = createDAGHealthCheck({
        metricsCollector: collector,
        failureThreshold: 5,
      })
      const result = healthCheck()

      expect(result.status).toBe('unhealthy')
      expect(result.details.recentFailures).toBe(5)
    })

    it('should return degraded status with SLA violations', () => {
      const collector = createMetricsCollector()
      const monitor = createSLAMonitor()

      monitor.registerTaskSLA('task-a', { maxDuration: 100 })
      monitor.checkTaskDuration('dag-1', 'run-1', 'task-a', 150)

      const healthCheck = createDAGHealthCheck({
        metricsCollector: collector,
        slaMonitor: monitor,
        slaViolationThreshold: 1,
      })
      const result = healthCheck()

      expect(result.status).toBe('degraded')
      expect(result.details.slaViolations).toBe(1)
    })

    it('should track active DAGs and running tasks', () => {
      const collector = createMetricsCollector()

      // Start a DAG and task
      collector.recordDAGStart('dag-1', 'run-1')
      collector.recordTaskStart('dag-1', 'run-1', 'task-a')

      const healthCheck = createDAGHealthCheck({ metricsCollector: collector })
      const result = healthCheck()

      expect(result.details.activeDags).toBe(1)
      expect(result.details.runningTasks).toBe(1)

      // Complete the task and DAG
      collector.recordTaskComplete('dag-1', 'run-1', 'task-a', 'success', 100)
      collector.recordDAGComplete('dag-1', 'run-1', 'completed', 100)

      const result2 = healthCheck()
      expect(result2.details.activeDags).toBe(0)
      expect(result2.details.runningTasks).toBe(0)
    })

    it('should respect failure window', async () => {
      const collector = createMetricsCollector()

      // Record an old failure (outside window)
      const oldTimestamp = Date.now() - 400000 // 400 seconds ago
      collector.recordTaskComplete('dag-1', 'run-1', 'task-a', 'failed', 100, undefined, oldTimestamp)

      const healthCheck = createDAGHealthCheck({
        metricsCollector: collector,
        failureWindowMs: 300000, // 5 minutes
      })
      const result = healthCheck()

      // Old failure should be outside the window
      expect(result.details.recentFailures).toBe(0)
      expect(result.status).toBe('healthy')
    })
  })

  describe('createHealthEndpointHandler', () => {
    it('should return healthy response with no executor', async () => {
      const handler = createHealthEndpointHandler({ version: '1.0.0' })
      const result = await handler()

      expect(result.status).toBe('healthy')
      expect(result.version).toBe('1.0.0')
      expect(result.timestamp).toBeDefined()
      expect(result.checks).toEqual([])
    })

    it('should include DAG scheduler check when executor provided', async () => {
      const collector = createMetricsCollector()
      const executor = createObservableExecutor({ metricsCollector: collector })

      const handler = createHealthEndpointHandler({ executor, version: '1.0.0' })
      const result = await handler()

      expect(result.checks.some((c) => c.name === 'dag-scheduler')).toBe(true)
    })

    it('should include metrics when executor has metrics collector', async () => {
      const collector = createMetricsCollector()
      collector.recordTaskComplete('dag-1', 'run-1', 'task-a', 'success', 100)
      collector.recordDAGComplete('dag-1', 'run-1', 'completed', 500)

      const executor = createObservableExecutor({ metricsCollector: collector })

      const handler = createHealthEndpointHandler({ executor })
      const result = await handler()

      expect(result.metrics).toBeDefined()
      expect(result.metrics?.taskRuns.success).toBe(1)
      expect(result.metrics?.dagRuns.completed).toBe(1)
    })

    it('should run additional checks', async () => {
      const handler = createHealthEndpointHandler({
        additionalChecks: [
          {
            name: 'custom-check',
            check: async () => ({ status: 'healthy', message: 'Custom check passed' }),
          },
        ],
      })
      const result = await handler()

      expect(result.checks).toHaveLength(1)
      expect(result.checks[0].name).toBe('custom-check')
      expect(result.checks[0].status).toBe('healthy')
      expect(result.checks[0].duration).toBeDefined()
    })

    it('should aggregate status from all checks', async () => {
      const handler = createHealthEndpointHandler({
        additionalChecks: [
          {
            name: 'healthy-check',
            check: async () => ({ status: 'healthy', message: 'OK' }),
          },
          {
            name: 'degraded-check',
            check: async () => ({ status: 'degraded', message: 'Slow' }),
          },
        ],
      })
      const result = await handler()

      expect(result.status).toBe('degraded')
    })

    it('should handle check failures gracefully', async () => {
      const handler = createHealthEndpointHandler({
        additionalChecks: [
          {
            name: 'failing-check',
            check: async () => {
              throw new Error('Check crashed')
            },
          },
        ],
      })
      const result = await handler()

      expect(result.status).toBe('unhealthy')
      expect(result.checks[0].status).toBe('unhealthy')
      expect(result.checks[0].message).toBe('Check crashed')
    })
  })
})
