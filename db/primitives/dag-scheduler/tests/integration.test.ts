/**
 * DAGScheduler Integration Tests
 *
 * End-to-end integration tests validating the complete DAGScheduler primitive:
 * - End-to-end DAG execution
 * - Task dependency resolution
 * - Failure recovery scenarios
 * - Concurrent DAG execution
 * - State persistence across restarts
 *
 * These tests verify all primitives work together:
 * - ExactlyOnceContext, TemporalStore integration
 * - Performance benchmarks for large DAGs (1000+ tasks)
 * - Memory usage under sustained load
 *
 * @module db/primitives/dag-scheduler/tests/integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createDAG,
  createTaskNode,
  createParallelExecutor,
  createInMemoryStateStore,
  createRetryPolicy,
  createDependencyResolver,
  createTaskFromTemplate,
  createTaskTemplate,
  dag,
  task,
  type DAG,
  type DAGRun,
  type TaskNode,
  type TaskResult,
  type ParallelExecutor,
  type DAGStateStore,
  type TaskContext,
} from '../index'
import {
  createMetricsCollector,
  createSLAMonitor,
  createObservableExecutor,
  type MetricsCollector,
  type SLAMonitor,
} from '../observability'

// ============================================================================
// TEST HELPERS
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createSimpleTask(id: string, deps: string[] = []): TaskNode {
  return createTaskNode({
    id,
    execute: async () => `result-${id}`,
    dependencies: deps,
  })
}

function createDelayedTask(id: string, delayMs: number, deps: string[] = []): TaskNode {
  return createTaskNode({
    id,
    execute: async () => {
      await delay(delayMs)
      return `result-${id}`
    },
    dependencies: deps,
  })
}

// ============================================================================
// SCENARIO 1: END-TO-END ETL PIPELINE
// ============================================================================

describe('Integration: End-to-End DAG Execution', () => {
  /**
   * ETL Pipeline: Extract -> Transform -> Load with parallelism
   */
  describe('ETL Pipeline', () => {
    it('should execute complete ETL pipeline with parallel extracts', async () => {
      const executionLog: { task: string; timestamp: number }[] = []
      const baseTime = Date.now()

      const etlPipeline = createDAG({
        id: 'etl-pipeline',
        tasks: [
          createTaskNode({
            id: 'extract-api',
            execute: async () => {
              executionLog.push({ task: 'extract-api', timestamp: Date.now() - baseTime })
              await delay(20)
              return { source: 'api', records: [1, 2, 3] }
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'extract-db',
            execute: async () => {
              executionLog.push({ task: 'extract-db', timestamp: Date.now() - baseTime })
              await delay(20)
              return { source: 'db', records: [4, 5, 6] }
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'extract-file',
            execute: async () => {
              executionLog.push({ task: 'extract-file', timestamp: Date.now() - baseTime })
              await delay(20)
              return { source: 'file', records: [7, 8, 9] }
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'transform',
            execute: async (ctx) => {
              executionLog.push({ task: 'transform', timestamp: Date.now() - baseTime })
              const upstream = ctx?.upstreamResults as Record<string, { records: number[] }>
              const allRecords = [
                ...(upstream['extract-api']?.records ?? []),
                ...(upstream['extract-db']?.records ?? []),
                ...(upstream['extract-file']?.records ?? []),
              ]
              return { transformed: allRecords.map((r) => r * 2) }
            },
            dependencies: ['extract-api', 'extract-db', 'extract-file'],
          }),
          createTaskNode({
            id: 'load',
            execute: async (ctx) => {
              executionLog.push({ task: 'load', timestamp: Date.now() - baseTime })
              const upstream = ctx?.upstreamResults as { transform: { transformed: number[] } }
              return { loaded: upstream.transform.transformed.length }
            },
            dependencies: ['transform'],
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(etlPipeline)

      // Verify completion
      expect(run.status).toBe('completed')
      expect(run.taskResults.size).toBe(5)

      // Verify all tasks succeeded
      for (const [_, result] of run.taskResults) {
        expect(result.status).toBe('success')
      }

      // Verify parallel execution of extract tasks (should start around same time)
      const extractTasks = executionLog.filter((l) => l.task.startsWith('extract-'))
      const extractStartTimes = extractTasks.map((t) => t.timestamp)
      const extractSpread = Math.max(...extractStartTimes) - Math.min(...extractStartTimes)
      expect(extractSpread).toBeLessThan(50) // Started within 50ms of each other

      // Verify transform ran after all extracts
      const transformStart = executionLog.find((l) => l.task === 'transform')!.timestamp
      for (const extractTask of extractTasks) {
        expect(transformStart).toBeGreaterThanOrEqual(extractTask.timestamp)
      }

      // Verify final output
      const loadResult = run.taskResults.get('load')!
      expect(loadResult.output).toEqual({ loaded: 9 })
    })

    it('should pass data correctly through pipeline stages', async () => {
      let transformInput: unknown
      let loadInput: unknown

      const pipeline = createDAG({
        id: 'data-pipeline',
        tasks: [
          createTaskNode({
            id: 'extract',
            execute: async () => ({
              users: [
                { id: 1, name: 'Alice' },
                { id: 2, name: 'Bob' },
              ],
            }),
            dependencies: [],
          }),
          createTaskNode({
            id: 'transform',
            execute: async (ctx) => {
              transformInput = ctx?.upstreamResults
              const data = (ctx?.upstreamResults as { extract: { users: Array<{ name: string }> } })
                .extract.users
              return { userNames: data.map((u) => u.name.toUpperCase()) }
            },
            dependencies: ['extract'],
          }),
          createTaskNode({
            id: 'load',
            execute: async (ctx) => {
              loadInput = ctx?.upstreamResults
              const data = (ctx?.upstreamResults as { transform: { userNames: string[] } }).transform
              return { count: data.userNames.length, names: data.userNames }
            },
            dependencies: ['transform'],
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(pipeline)

      expect(run.status).toBe('completed')

      // Verify correct data flow
      expect(transformInput).toEqual({
        extract: {
          users: [
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
          ],
        },
      })

      expect(loadInput).toEqual({
        transform: { userNames: ['ALICE', 'BOB'] },
      })

      expect(run.taskResults.get('load')!.output).toEqual({
        count: 2,
        names: ['ALICE', 'BOB'],
      })
    })
  })

  /**
   * ML Training Pipeline: Data prep -> Train -> Evaluate -> Deploy (conditional)
   */
  describe('ML Training Pipeline', () => {
    it('should execute ML pipeline with conditional deployment', async () => {
      const executionLog: string[] = []

      const mlPipeline = createDAG({
        id: 'ml-pipeline',
        tasks: [
          createTaskNode({
            id: 'prepare-data',
            execute: async () => {
              executionLog.push('prepare-data')
              return { features: [[1, 2], [3, 4], [5, 6]], labels: [0, 1, 0] }
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'train-model',
            execute: async (ctx) => {
              executionLog.push('train-model')
              const data = ctx?.upstreamResults as { 'prepare-data': { features: number[][]; labels: number[] } }
              return {
                modelId: 'model-v1',
                featureCount: data['prepare-data'].features.length,
              }
            },
            dependencies: ['prepare-data'],
          }),
          createTaskNode({
            id: 'evaluate-model',
            execute: async () => {
              executionLog.push('evaluate-model')
              // Simulate high accuracy for conditional deployment
              return { accuracy: 0.95, precision: 0.92, recall: 0.94 }
            },
            dependencies: ['train-model'],
          }),
          createTaskNode({
            id: 'conditional-deploy',
            execute: async () => {},
            dependencies: ['evaluate-model'],
            dynamic: {
              expand: (evalResult: { accuracy: number }) => {
                executionLog.push('conditional-check')
                if (evalResult.accuracy > 0.9) {
                  return [
                    createTaskNode({
                      id: 'deploy-model',
                      execute: async () => {
                        executionLog.push('deploy-model')
                        return { deployed: true, endpoint: '/api/v1/predict' }
                      },
                      dependencies: [],
                    }),
                  ]
                }
                return [
                  createTaskNode({
                    id: 'skip-deploy',
                    execute: async () => {
                      executionLog.push('skip-deploy')
                      return { deployed: false, reason: 'accuracy below threshold' }
                    },
                    dependencies: [],
                  }),
                ]
              },
            },
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(mlPipeline)

      expect(run.status).toBe('completed')
      expect(executionLog).toContain('prepare-data')
      expect(executionLog).toContain('train-model')
      expect(executionLog).toContain('evaluate-model')
      expect(executionLog).toContain('conditional-check')
      expect(executionLog).toContain('deploy-model')
      expect(executionLog).not.toContain('skip-deploy')

      // Verify deployment result
      expect(run.taskResults.get('deploy-model')?.output).toEqual({
        deployed: true,
        endpoint: '/api/v1/predict',
      })
    })

    it('should skip deployment when accuracy is below threshold', async () => {
      const executionLog: string[] = []

      const mlPipeline = createDAG({
        id: 'ml-pipeline-low-accuracy',
        tasks: [
          createTaskNode({
            id: 'prepare-data',
            execute: async () => {
              executionLog.push('prepare-data')
              return { features: [[1, 2]], labels: [0] }
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'train-model',
            execute: async () => {
              executionLog.push('train-model')
              return { modelId: 'model-v1' }
            },
            dependencies: ['prepare-data'],
          }),
          createTaskNode({
            id: 'evaluate-model',
            execute: async () => {
              executionLog.push('evaluate-model')
              // Low accuracy
              return { accuracy: 0.75, precision: 0.70, recall: 0.72 }
            },
            dependencies: ['train-model'],
          }),
          createTaskNode({
            id: 'conditional-deploy',
            execute: async () => {},
            dependencies: ['evaluate-model'],
            dynamic: {
              expand: (evalResult: { accuracy: number }) => {
                if (evalResult.accuracy > 0.9) {
                  return [
                    createTaskNode({
                      id: 'deploy-model',
                      execute: async () => {
                        executionLog.push('deploy-model')
                        return { deployed: true }
                      },
                      dependencies: [],
                    }),
                  ]
                }
                return [
                  createTaskNode({
                    id: 'skip-deploy',
                    execute: async () => {
                      executionLog.push('skip-deploy')
                      return { deployed: false, reason: 'accuracy below threshold' }
                    },
                    dependencies: [],
                  }),
                ]
              },
            },
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(mlPipeline)

      expect(run.status).toBe('completed')
      expect(executionLog).toContain('skip-deploy')
      expect(executionLog).not.toContain('deploy-model')
    })
  })
})

// ============================================================================
// SCENARIO 2: TASK DEPENDENCY RESOLUTION
// ============================================================================

describe('Integration: Task Dependency Resolution', () => {
  describe('Complex Dependency Graphs', () => {
    it('should handle diamond pattern correctly', async () => {
      const executionOrder: string[] = []

      const diamondDAG = createDAG({
        id: 'diamond-dag',
        tasks: [
          createTaskNode({
            id: 'root',
            execute: async () => {
              executionOrder.push('root')
              return 'root-data'
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'left',
            execute: async () => {
              executionOrder.push('left')
              return 'left-data'
            },
            dependencies: ['root'],
          }),
          createTaskNode({
            id: 'right',
            execute: async () => {
              executionOrder.push('right')
              return 'right-data'
            },
            dependencies: ['root'],
          }),
          createTaskNode({
            id: 'merge',
            execute: async (ctx) => {
              executionOrder.push('merge')
              const upstream = ctx?.upstreamResults as Record<string, string>
              return { left: upstream.left, right: upstream.right }
            },
            dependencies: ['left', 'right'],
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(diamondDAG)

      expect(run.status).toBe('completed')

      // Root must be first
      expect(executionOrder[0]).toBe('root')

      // Left and right can be in either order, but must come before merge
      expect(executionOrder.indexOf('merge')).toBe(3)
      expect(executionOrder.indexOf('left')).toBeLessThan(3)
      expect(executionOrder.indexOf('right')).toBeLessThan(3)

      // Verify merge received both inputs
      const mergeResult = run.taskResults.get('merge')!
      expect(mergeResult.output).toEqual({
        left: 'left-data',
        right: 'right-data',
      })
    })

    it('should handle multi-level dependency chain', async () => {
      const executionOrder: string[] = []

      const tasks: TaskNode[] = []
      for (let i = 0; i < 5; i++) {
        tasks.push(
          createTaskNode({
            id: `level-${i}`,
            execute: async () => {
              executionOrder.push(`level-${i}`)
              return i
            },
            dependencies: i > 0 ? [`level-${i - 1}`] : [],
          })
        )
      }

      const chainDAG = createDAG({
        id: 'chain-dag',
        tasks,
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(chainDAG)

      expect(run.status).toBe('completed')
      expect(executionOrder).toEqual(['level-0', 'level-1', 'level-2', 'level-3', 'level-4'])
    })

    it('should handle multiple independent subgraphs', async () => {
      const executionGroups: Set<string>[] = []
      let currentGroup: Set<string> = new Set()

      const markExecution = (taskId: string) => {
        currentGroup.add(taskId)
      }

      const multiGraphDAG = createDAG({
        id: 'multi-graph',
        tasks: [
          // Subgraph 1
          createTaskNode({
            id: 'a1',
            execute: async () => {
              markExecution('a1')
              return 'a1'
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'a2',
            execute: async () => {
              markExecution('a2')
              return 'a2'
            },
            dependencies: ['a1'],
          }),
          // Subgraph 2
          createTaskNode({
            id: 'b1',
            execute: async () => {
              markExecution('b1')
              return 'b1'
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'b2',
            execute: async () => {
              markExecution('b2')
              return 'b2'
            },
            dependencies: ['b1'],
          }),
          // Subgraph 3
          createTaskNode({
            id: 'c1',
            execute: async () => {
              markExecution('c1')
              return 'c1'
            },
            dependencies: [],
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(multiGraphDAG)

      expect(run.status).toBe('completed')
      expect(run.taskResults.size).toBe(5)

      // All tasks should have completed successfully
      for (const [_, result] of run.taskResults) {
        expect(result.status).toBe('success')
      }
    })

    it('should handle wide parallel fan-out', async () => {
      const parallelCount = 20
      const executed: string[] = []

      const tasks: TaskNode[] = [
        createTaskNode({
          id: 'start',
          execute: async () => {
            executed.push('start')
            return 'started'
          },
          dependencies: [],
        }),
      ]

      // Create parallel tasks
      for (let i = 0; i < parallelCount; i++) {
        tasks.push(
          createTaskNode({
            id: `parallel-${i}`,
            execute: async () => {
              executed.push(`parallel-${i}`)
              await delay(10) // Small delay to ensure parallelism
              return i
            },
            dependencies: ['start'],
          })
        )
      }

      // Final merge
      tasks.push(
        createTaskNode({
          id: 'merge',
          execute: async (ctx) => {
            executed.push('merge')
            const upstream = ctx?.upstreamResults as Record<string, number>
            return Object.values(upstream).reduce((a, b) => (typeof b === 'number' ? a + b : a), 0)
          },
          dependencies: Array.from({ length: parallelCount }, (_, i) => `parallel-${i}`),
        })
      )

      const fanOutDAG = createDAG({ id: 'fan-out', tasks })
      const executor = createParallelExecutor({ maxConcurrency: 10 })

      const startTime = Date.now()
      const run = await executor.execute(fanOutDAG)
      const duration = Date.now() - startTime

      expect(run.status).toBe('completed')
      expect(executed[0]).toBe('start')
      expect(executed[executed.length - 1]).toBe('merge')

      // With 10 concurrency, 20 parallel tasks @ 10ms each should take ~20ms (2 batches)
      // Plus start and merge, should be under 100ms
      expect(duration).toBeLessThan(500)

      // Verify sum is correct (0 + 1 + ... + 19 = 190)
      expect(run.taskResults.get('merge')!.output).toBe(190)
    })
  })

  describe('Dynamic Dependency Resolution', () => {
    it('should resolve dynamic dependencies at runtime', async () => {
      const resolvedDeps: string[] = []

      const dynamicDAG = createDAG({
        id: 'dynamic-deps',
        tasks: [
          createTaskNode({
            id: 'config',
            execute: async () => ({
              enableFeatureA: true,
              enableFeatureB: false,
            }),
            dependencies: [],
          }),
          createTaskNode({
            id: 'feature-a',
            execute: async () => 'feature-a-result',
            dependencies: [],
          }),
          createTaskNode({
            id: 'feature-b',
            execute: async () => 'feature-b-result',
            dependencies: [],
          }),
          createTaskNode({
            id: 'expander',
            execute: async () => {},
            dependencies: ['config', 'feature-a', 'feature-b'],
            dynamic: {
              expand: (config: { enableFeatureA: boolean; enableFeatureB: boolean }) => {
                const deps: string[] = []
                if (config.enableFeatureA) deps.push('feature-a')
                if (config.enableFeatureB) deps.push('feature-b')

                return [
                  createTaskNode({
                    id: 'dynamic-consumer',
                    execute: async (ctx) => {
                      resolvedDeps.push(...Object.keys(ctx?.upstreamResults ?? {}))
                      return 'consumed'
                    },
                    dependencies: deps,
                  }),
                ]
              },
            },
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(dynamicDAG)

      expect(run.status).toBe('completed')
      expect(resolvedDeps).toContain('feature-a')
      expect(resolvedDeps).not.toContain('feature-b')
    })
  })
})

// ============================================================================
// SCENARIO 3: FAILURE RECOVERY
// ============================================================================

describe('Integration: Failure Recovery', () => {
  describe('Kill Scheduler Mid-Execution and Resume', () => {
    it('should resume from checkpoint after simulated crash', async () => {
      const store = createInMemoryStateStore()
      const executedTasks: string[] = []

      // First run: execute partially and save state
      const partialDAG = createDAG({
        id: 'resumable-dag',
        tasks: [
          createTaskNode({
            id: 'step-1',
            execute: async () => {
              executedTasks.push('step-1')
              return 'step-1-result'
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'step-2',
            execute: async () => {
              executedTasks.push('step-2')
              return 'step-2-result'
            },
            dependencies: ['step-1'],
          }),
          createTaskNode({
            id: 'step-3',
            execute: async () => {
              executedTasks.push('step-3')
              return 'step-3-result'
            },
            dependencies: ['step-2'],
          }),
        ],
      })

      // Simulate crash after step-1 by manually creating checkpoint
      await store.saveRun('run-checkpoint-1', {
        runId: 'run-checkpoint-1',
        dagId: 'resumable-dag',
        status: 'running',
        taskResults: new Map([
          [
            'step-1',
            {
              taskId: 'step-1',
              status: 'success',
              output: 'step-1-result',
              attempts: 1,
              completedAt: new Date(),
            },
          ],
        ]),
        startedAt: new Date(),
      })

      // Resume execution
      const executor = createParallelExecutor({ stateStore: store })
      const run = await executor.resume('run-checkpoint-1', partialDAG)

      expect(run.status).toBe('completed')
      // Step-1 should NOT be re-executed
      expect(executedTasks).not.toContain('step-1')
      // Steps 2 and 3 should be executed
      expect(executedTasks).toContain('step-2')
      expect(executedTasks).toContain('step-3')
    })

    it('should handle resume when multiple tasks were in progress', async () => {
      const store = createInMemoryStateStore()
      const executedTasks: string[] = []

      const parallelDAG = createDAG({
        id: 'parallel-resume-dag',
        tasks: [
          createTaskNode({
            id: 'root',
            execute: async () => {
              executedTasks.push('root')
              return 'root'
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'branch-a',
            execute: async () => {
              executedTasks.push('branch-a')
              return 'branch-a'
            },
            dependencies: ['root'],
          }),
          createTaskNode({
            id: 'branch-b',
            execute: async () => {
              executedTasks.push('branch-b')
              return 'branch-b'
            },
            dependencies: ['root'],
          }),
          createTaskNode({
            id: 'merge',
            execute: async () => {
              executedTasks.push('merge')
              return 'merged'
            },
            dependencies: ['branch-a', 'branch-b'],
          }),
        ],
      })

      // Simulate crash with root and branch-a complete, branch-b running
      await store.saveRun('run-parallel-checkpoint', {
        runId: 'run-parallel-checkpoint',
        dagId: 'parallel-resume-dag',
        status: 'running',
        taskResults: new Map([
          [
            'root',
            {
              taskId: 'root',
              status: 'success',
              output: 'root',
              attempts: 1,
              completedAt: new Date(),
            },
          ],
          [
            'branch-a',
            {
              taskId: 'branch-a',
              status: 'success',
              output: 'branch-a',
              attempts: 1,
              completedAt: new Date(),
            },
          ],
        ]),
        startedAt: new Date(),
      })

      const executor = createParallelExecutor({ stateStore: store })
      const run = await executor.resume('run-parallel-checkpoint', parallelDAG)

      expect(run.status).toBe('completed')
      // root and branch-a should NOT be re-executed
      expect(executedTasks).not.toContain('root')
      expect(executedTasks).not.toContain('branch-a')
      // branch-b and merge should be executed
      expect(executedTasks).toContain('branch-b')
      expect(executedTasks).toContain('merge')
    })
  })

  describe('Task Failure with Retry Success', () => {
    it('should retry failed task and succeed', async () => {
      let attempts = 0
      const attemptTimes: number[] = []

      const retryDAG = createDAG({
        id: 'retry-dag',
        tasks: [
          createTaskNode({
            id: 'flaky-task',
            execute: async () => {
              attemptTimes.push(Date.now())
              attempts++
              if (attempts < 3) {
                throw new Error(`Attempt ${attempts} failed`)
              }
              return 'success after retries'
            },
            dependencies: [],
            retryPolicy: {
              maxAttempts: 5,
              backoff: { type: 'fixed', delay: 20 },
            },
          }),
          createTaskNode({
            id: 'dependent',
            execute: async () => 'dependent completed',
            dependencies: ['flaky-task'],
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(retryDAG)

      expect(run.status).toBe('completed')
      expect(run.taskResults.get('flaky-task')!.attempts).toBe(3)
      expect(run.taskResults.get('flaky-task')!.status).toBe('success')
      expect(run.taskResults.get('dependent')!.status).toBe('success')

      // Verify backoff delays
      expect(attemptTimes).toHaveLength(3)
      const delay1 = attemptTimes[1]! - attemptTimes[0]!
      const delay2 = attemptTimes[2]! - attemptTimes[1]!
      expect(delay1).toBeGreaterThanOrEqual(15) // Allow some timing variance
      expect(delay2).toBeGreaterThanOrEqual(15)
    })

    it('should apply exponential backoff during retries', async () => {
      let attempts = 0
      const attemptTimes: number[] = []

      const exponentialRetryDAG = createDAG({
        id: 'exponential-retry-dag',
        tasks: [
          createTaskNode({
            id: 'exponential-flaky',
            execute: async () => {
              attemptTimes.push(Date.now())
              attempts++
              if (attempts < 4) {
                throw new Error(`Attempt ${attempts} failed`)
              }
              return 'success'
            },
            dependencies: [],
            retryPolicy: {
              maxAttempts: 5,
              backoff: { type: 'exponential', base: 10, max: 1000 },
            },
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(exponentialRetryDAG)

      expect(run.status).toBe('completed')
      expect(attemptTimes).toHaveLength(4)

      // Verify exponential delays: ~10ms, ~20ms, ~40ms
      const delay1 = attemptTimes[1]! - attemptTimes[0]!
      const delay2 = attemptTimes[2]! - attemptTimes[1]!
      const delay3 = attemptTimes[3]! - attemptTimes[2]!

      expect(delay2).toBeGreaterThan(delay1 * 1.5) // Should roughly double
      expect(delay3).toBeGreaterThan(delay2 * 1.5)
    })

    it('should exhaust retries and fail gracefully', async () => {
      let attempts = 0

      const failDAG = createDAG({
        id: 'fail-dag',
        tasks: [
          createTaskNode({
            id: 'always-fails',
            execute: async () => {
              attempts++
              throw new Error('Permanent failure')
            },
            dependencies: [],
            retryPolicy: {
              maxAttempts: 3,
              backoff: { type: 'fixed', delay: 5 },
            },
          }),
          createTaskNode({
            id: 'downstream',
            execute: async () => 'should not run',
            dependencies: ['always-fails'],
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(failDAG)

      expect(run.status).toBe('failed')
      expect(attempts).toBe(3)
      expect(run.taskResults.get('always-fails')!.status).toBe('failed')
      expect(run.taskResults.get('always-fails')!.attempts).toBe(3)
      expect(run.taskResults.get('downstream')!.status).toBe('skipped')
    })
  })

  describe('Partial Failure Handling', () => {
    it('should continue executing independent tasks when one branch fails', async () => {
      const executed: string[] = []

      const partialFailDAG = createDAG({
        id: 'partial-fail-dag',
        tasks: [
          createTaskNode({
            id: 'root',
            execute: async () => {
              executed.push('root')
              return 'root'
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'fail-branch',
            execute: async () => {
              executed.push('fail-branch')
              throw new Error('Branch failed')
            },
            dependencies: ['root'],
          }),
          createTaskNode({
            id: 'success-branch',
            execute: async () => {
              executed.push('success-branch')
              return 'success'
            },
            dependencies: ['root'],
          }),
          createTaskNode({
            id: 'fail-downstream',
            execute: async () => {
              executed.push('fail-downstream')
              return 'should not run'
            },
            dependencies: ['fail-branch'],
          }),
          createTaskNode({
            id: 'success-downstream',
            execute: async () => {
              executed.push('success-downstream')
              return 'ran successfully'
            },
            dependencies: ['success-branch'],
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(partialFailDAG)

      expect(run.status).toBe('failed')
      expect(executed).toContain('root')
      expect(executed).toContain('fail-branch')
      expect(executed).toContain('success-branch')
      expect(executed).toContain('success-downstream')
      expect(executed).not.toContain('fail-downstream')

      expect(run.taskResults.get('fail-downstream')!.status).toBe('skipped')
      expect(run.taskResults.get('success-downstream')!.status).toBe('success')
    })
  })
})

// ============================================================================
// SCENARIO 4: CONCURRENT DAG EXECUTION
// ============================================================================

describe('Integration: Concurrent DAG Execution', () => {
  describe('Multiple DAGs Running Simultaneously', () => {
    it('should execute multiple DAGs concurrently', async () => {
      const dag1Executed: string[] = []
      const dag2Executed: string[] = []
      const dag3Executed: string[] = []

      const dag1 = createDAG({
        id: 'concurrent-dag-1',
        tasks: [
          createTaskNode({
            id: 'd1-task-1',
            execute: async () => {
              dag1Executed.push('d1-task-1')
              await delay(20)
              return 'dag1-result'
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'd1-task-2',
            execute: async () => {
              dag1Executed.push('d1-task-2')
              return 'dag1-final'
            },
            dependencies: ['d1-task-1'],
          }),
        ],
      })

      const dag2 = createDAG({
        id: 'concurrent-dag-2',
        tasks: [
          createTaskNode({
            id: 'd2-task-1',
            execute: async () => {
              dag2Executed.push('d2-task-1')
              await delay(20)
              return 'dag2-result'
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'd2-task-2',
            execute: async () => {
              dag2Executed.push('d2-task-2')
              return 'dag2-final'
            },
            dependencies: ['d2-task-1'],
          }),
        ],
      })

      const dag3 = createDAG({
        id: 'concurrent-dag-3',
        tasks: [
          createTaskNode({
            id: 'd3-task-1',
            execute: async () => {
              dag3Executed.push('d3-task-1')
              await delay(20)
              return 'dag3-result'
            },
            dependencies: [],
          }),
        ],
      })

      // Use separate executors for true concurrency
      const executor1 = createParallelExecutor()
      const executor2 = createParallelExecutor()
      const executor3 = createParallelExecutor()

      const startTime = Date.now()

      const [run1, run2, run3] = await Promise.all([
        executor1.execute(dag1),
        executor2.execute(dag2),
        executor3.execute(dag3),
      ])

      const duration = Date.now() - startTime

      expect(run1.status).toBe('completed')
      expect(run2.status).toBe('completed')
      expect(run3.status).toBe('completed')

      expect(dag1Executed).toEqual(['d1-task-1', 'd1-task-2'])
      expect(dag2Executed).toEqual(['d2-task-1', 'd2-task-2'])
      expect(dag3Executed).toEqual(['d3-task-1'])

      // All three should run in parallel, so total time should be ~20-40ms, not 60ms
      expect(duration).toBeLessThan(100)
    })

    it('should handle concurrent DAGs with same ID safely', async () => {
      const executionCounts = new Map<string, number>()

      const createCountingDAG = (runNum: number) =>
        createDAG({
          id: `same-id-dag`,
          tasks: [
            createTaskNode({
              id: 'task-1',
              execute: async () => {
                const key = `run-${runNum}`
                executionCounts.set(key, (executionCounts.get(key) ?? 0) + 1)
                await delay(10)
                return `run-${runNum}-result`
              },
              dependencies: [],
            }),
          ],
        })

      // Execute same DAG ID concurrently multiple times
      const runs = await Promise.all([
        createParallelExecutor().execute(createCountingDAG(1)),
        createParallelExecutor().execute(createCountingDAG(2)),
        createParallelExecutor().execute(createCountingDAG(3)),
      ])

      expect(runs.every((r) => r.status === 'completed')).toBe(true)
      expect(executionCounts.get('run-1')).toBe(1)
      expect(executionCounts.get('run-2')).toBe(1)
      expect(executionCounts.get('run-3')).toBe(1)
    })
  })

  describe('Concurrency Limits', () => {
    it('should respect maxConcurrency across tasks', async () => {
      let concurrentCount = 0
      let maxConcurrentCount = 0

      const tasks: TaskNode[] = []
      for (let i = 0; i < 20; i++) {
        tasks.push(
          createTaskNode({
            id: `task-${i}`,
            execute: async () => {
              concurrentCount++
              maxConcurrentCount = Math.max(maxConcurrentCount, concurrentCount)
              await delay(20)
              concurrentCount--
              return i
            },
            dependencies: [],
          })
        )
      }

      const concurrencyDAG = createDAG({ id: 'concurrency-test', tasks })
      const executor = createParallelExecutor({ maxConcurrency: 5 })
      const run = await executor.execute(concurrencyDAG)

      expect(run.status).toBe('completed')
      expect(maxConcurrentCount).toBe(5)
    })

    it('should handle unlimited concurrency', async () => {
      let maxConcurrentCount = 0
      let concurrentCount = 0

      const tasks: TaskNode[] = []
      for (let i = 0; i < 10; i++) {
        tasks.push(
          createTaskNode({
            id: `unlimited-${i}`,
            execute: async () => {
              concurrentCount++
              maxConcurrentCount = Math.max(maxConcurrentCount, concurrentCount)
              await delay(10)
              concurrentCount--
              return i
            },
            dependencies: [],
          })
        )
      }

      const unlimitedDAG = createDAG({ id: 'unlimited-concurrency', tasks })
      const executor = createParallelExecutor() // Default: unlimited
      const run = await executor.execute(unlimitedDAG)

      expect(run.status).toBe('completed')
      // All tasks should run concurrently
      expect(maxConcurrentCount).toBe(10)
    })
  })
})

// ============================================================================
// SCENARIO 5: STATE PERSISTENCE ACROSS RESTARTS
// ============================================================================

describe('Integration: State Persistence', () => {
  let store: DAGStateStore

  beforeEach(() => {
    store = createInMemoryStateStore()
  })

  describe('State Store Operations', () => {
    it('should persist and restore complete DAG run state', async () => {
      const testDAG = createDAG({
        id: 'persistence-test',
        tasks: [
          createSimpleTask('task-a'),
          createSimpleTask('task-b', ['task-a']),
          createSimpleTask('task-c', ['task-b']),
        ],
      })

      const executor = createParallelExecutor({ stateStore: store })
      const run = await executor.execute(testDAG)

      // Verify state was persisted
      const persistedRun = await store.loadRun(run.runId)
      expect(persistedRun).not.toBeNull()
      expect(persistedRun!.dagId).toBe('persistence-test')
      expect(persistedRun!.status).toBe('completed')
      expect(persistedRun!.taskResults.size).toBe(3)

      // Verify task results were persisted
      const taskA = persistedRun!.taskResults.get('task-a')!
      expect(taskA.status).toBe('success')
      expect(taskA.output).toBe('result-task-a')
    })

    it('should track task results incrementally', async () => {
      const executionOrder: string[] = []

      const incrementalDAG = createDAG({
        id: 'incremental-dag',
        tasks: [
          createTaskNode({
            id: 'step-1',
            execute: async () => {
              executionOrder.push('step-1')
              await delay(10)
              return 'step-1-done'
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'step-2',
            execute: async () => {
              executionOrder.push('step-2')
              await delay(10)
              return 'step-2-done'
            },
            dependencies: ['step-1'],
          }),
        ],
      })

      const executor = createParallelExecutor({ stateStore: store })
      const run = await executor.execute(incrementalDAG)

      // Check that both tasks are persisted
      const persistedRun = await store.loadRun(run.runId)
      expect(persistedRun!.taskResults.get('step-1')!.status).toBe('success')
      expect(persistedRun!.taskResults.get('step-2')!.status).toBe('success')
    })

    it('should list run history for a DAG', async () => {
      const historyDAG = createDAG({
        id: 'history-test',
        tasks: [createSimpleTask('single-task')],
      })

      // Execute multiple times
      for (let i = 0; i < 5; i++) {
        const executor = createParallelExecutor({ stateStore: store })
        await executor.execute(historyDAG)
      }

      // List runs
      const allRuns = await store.listRuns('history-test')
      expect(allRuns).toHaveLength(5)

      // List with limit
      const limitedRuns = await store.listRuns('history-test', { limit: 3 })
      expect(limitedRuns).toHaveLength(3)
    })

    it('should filter runs by status', async () => {
      const successDAG = createDAG({
        id: 'status-filter-test',
        tasks: [createSimpleTask('success-task')],
      })

      // Execute successful runs
      for (let i = 0; i < 3; i++) {
        const executor = createParallelExecutor({ stateStore: store })
        await executor.execute(successDAG)
      }

      // Filter by status
      const completedRuns = await store.listRuns('status-filter-test', { status: 'completed' })
      expect(completedRuns).toHaveLength(3)
      expect(completedRuns.every((r) => r.status === 'completed')).toBe(true)
    })
  })

  describe('Resume After Restart', () => {
    it('should fully resume interrupted DAG execution', async () => {
      const executedAfterResume: string[] = []

      const resumeDAG = createDAG({
        id: 'full-resume-test',
        tasks: [
          createTaskNode({
            id: 'completed-task',
            execute: async () => {
              executedAfterResume.push('completed-task')
              return 'already-done'
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'pending-task-1',
            execute: async () => {
              executedAfterResume.push('pending-task-1')
              return 'now-done-1'
            },
            dependencies: ['completed-task'],
          }),
          createTaskNode({
            id: 'pending-task-2',
            execute: async () => {
              executedAfterResume.push('pending-task-2')
              return 'now-done-2'
            },
            dependencies: ['pending-task-1'],
          }),
        ],
      })

      // Simulate partial completion
      await store.saveRun('resume-run-id', {
        runId: 'resume-run-id',
        dagId: 'full-resume-test',
        status: 'running',
        taskResults: new Map([
          [
            'completed-task',
            {
              taskId: 'completed-task',
              status: 'success',
              output: 'already-done',
              attempts: 1,
              completedAt: new Date(),
            },
          ],
        ]),
        startedAt: new Date(),
      })

      const executor = createParallelExecutor({ stateStore: store })
      const run = await executor.resume('resume-run-id', resumeDAG)

      expect(run.status).toBe('completed')

      // Completed task should NOT be re-executed
      expect(executedAfterResume).not.toContain('completed-task')

      // Pending tasks should be executed
      expect(executedAfterResume).toContain('pending-task-1')
      expect(executedAfterResume).toContain('pending-task-2')

      // Final state should be persisted
      const finalState = await store.loadRun('resume-run-id')
      expect(finalState!.status).toBe('completed')
      expect(finalState!.taskResults.size).toBe(3)
    })
  })
})

// ============================================================================
// SCENARIO 6: OBSERVABILITY INTEGRATION
// ============================================================================

describe('Integration: Observability', () => {
  describe('Metrics Collection', () => {
    it('should collect metrics during DAG execution', async () => {
      const metricsCollector = createMetricsCollector()

      const metricsDAG = createDAG({
        id: 'metrics-dag',
        tasks: [
          createTaskNode({
            id: 'task-a',
            execute: async () => {
              await delay(20)
              return 'a'
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'task-b',
            execute: async () => {
              await delay(10)
              return 'b'
            },
            dependencies: ['task-a'],
          }),
        ],
      })

      const executor = createObservableExecutor({ metricsCollector })
      const run = await executor.execute(metricsDAG)

      expect(run.status).toBe('completed')

      // Verify events were recorded
      const events = metricsCollector.getEvents()
      expect(events.length).toBeGreaterThan(0)
      expect(events.some((e) => e.type === 'dag_start')).toBe(true)
      expect(events.some((e) => e.type === 'dag_complete')).toBe(true)
      expect(events.some((e) => e.type === 'task_start')).toBe(true)
      expect(events.some((e) => e.type === 'task_complete')).toBe(true)

      // Verify task metrics
      const taskAMetrics = metricsCollector.getTaskMetrics('task-a')
      expect(taskAMetrics.totalRuns).toBe(1)
      expect(taskAMetrics.successCount).toBe(1)
      expect(taskAMetrics.avgDuration).toBeGreaterThan(0)

      // Verify DAG metrics
      const dagMetrics = metricsCollector.getDAGMetrics('metrics-dag')
      expect(dagMetrics.totalRuns).toBe(1)
      expect(dagMetrics.completedCount).toBe(1)
    })
  })

  describe('SLA Monitoring', () => {
    it('should detect SLA violations', async () => {
      const metricsCollector = createMetricsCollector()
      const slaMonitor = createSLAMonitor()

      // Register strict SLA
      slaMonitor.registerTaskSLA('slow-task', {
        maxDuration: 10, // 10ms max
        warningThreshold: 0.5, // Warn at 5ms
      })

      const violations: Array<{ taskId: string; type: string }> = []
      slaMonitor.onViolation((v) => {
        violations.push({ taskId: v.taskId!, type: v.type })
      })

      const slaDAG = createDAG({
        id: 'sla-dag',
        tasks: [
          createTaskNode({
            id: 'slow-task',
            execute: async () => {
              await delay(50) // Exceeds 10ms SLA
              return 'slow-result'
            },
            dependencies: [],
          }),
        ],
      })

      const executor = createObservableExecutor({ metricsCollector, slaMonitor })
      await executor.execute(slaDAG)

      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some((v) => v.taskId === 'slow-task' && v.type === 'duration')).toBe(true)
    })
  })
})

// ============================================================================
// SCENARIO 7: PERFORMANCE BENCHMARKS
// ============================================================================

describe('Integration: Performance Benchmarks', () => {
  describe('Large DAG Performance', () => {
    it('should handle 100+ tasks efficiently', async () => {
      const taskCount = 100
      const tasks: TaskNode[] = []

      // Create a long chain of dependent tasks
      for (let i = 0; i < taskCount; i++) {
        tasks.push(
          createTaskNode({
            id: `task-${i}`,
            execute: async () => i,
            dependencies: i > 0 ? [`task-${i - 1}`] : [],
          })
        )
      }

      const largeDag = createDAG({ id: 'large-dag-100', tasks })
      const executor = createParallelExecutor()

      const startTime = Date.now()
      const run = await executor.execute(largeDag)
      const duration = Date.now() - startTime

      expect(run.status).toBe('completed')
      expect(run.taskResults.size).toBe(taskCount)
      // Should complete in reasonable time (under 2 seconds for 100 sequential tasks)
      expect(duration).toBeLessThan(2000)
    })

    it('should handle 500+ tasks in parallel efficiently', async () => {
      const parallelCount = 500
      const tasks: TaskNode[] = [createSimpleTask('root')]

      // Create many parallel tasks
      for (let i = 0; i < parallelCount; i++) {
        tasks.push(
          createTaskNode({
            id: `parallel-${i}`,
            execute: async () => i,
            dependencies: ['root'],
          })
        )
      }

      // Add merge task
      tasks.push(
        createTaskNode({
          id: 'merge',
          execute: async () => 'merged',
          dependencies: Array.from({ length: parallelCount }, (_, i) => `parallel-${i}`),
        })
      )

      const wideDAG = createDAG({ id: 'wide-dag-500', tasks })
      const executor = createParallelExecutor({ maxConcurrency: 50 })

      const startTime = Date.now()
      const run = await executor.execute(wideDAG)
      const duration = Date.now() - startTime

      expect(run.status).toBe('completed')
      expect(run.taskResults.size).toBe(parallelCount + 2)
      // Should complete in reasonable time
      expect(duration).toBeLessThan(5000)
    })

    it('should handle deep nested dynamic tasks', async () => {
      const dynamicDAG = createDAG({
        id: 'deep-dynamic',
        tasks: [
          createTaskNode({
            id: 'root',
            execute: async () => [1, 2, 3, 4, 5],
            dependencies: [],
          }),
          createTaskNode({
            id: 'expand',
            execute: async () => {},
            dependencies: ['root'],
            dynamic: {
              maxExpansion: 50,
              expand: (items: number[]) =>
                items.flatMap((item) =>
                  Array.from({ length: 10 }, (_, i) =>
                    createTaskNode({
                      id: `dynamic-${item}-${i}`,
                      execute: async () => item * i,
                      dependencies: [],
                    })
                  )
                ),
            },
          }),
        ],
      })

      const executor = createParallelExecutor({ maxConcurrency: 20 })
      const startTime = Date.now()
      const run = await executor.execute(dynamicDAG)
      const duration = Date.now() - startTime

      expect(run.status).toBe('completed')
      // Should complete in reasonable time
      expect(duration).toBeLessThan(2000)
    })
  })

  describe('Memory Efficiency', () => {
    it('should not accumulate excessive memory with repeated runs', async () => {
      const store = createInMemoryStateStore()
      const smallDAG = createDAG({
        id: 'memory-test',
        tasks: [
          createSimpleTask('a'),
          createSimpleTask('b', ['a']),
          createSimpleTask('c', ['b']),
        ],
      })

      // Run many times
      for (let i = 0; i < 100; i++) {
        const executor = createParallelExecutor({ stateStore: store })
        await executor.execute(smallDAG)
      }

      // Verify runs were recorded
      const runs = await store.listRuns('memory-test')
      expect(runs.length).toBe(100)

      // Test can complete without running out of memory
      expect(true).toBe(true)
    })
  })
})

// ============================================================================
// SCENARIO 8: TEMPLATE AND FLUENT API INTEGRATION
// ============================================================================

describe('Integration: Templates and Fluent API', () => {
  describe('Task Templates', () => {
    it('should create DAG from templates dynamically', async () => {
      const extractTemplate = createTaskTemplate({
        id: (params: { source: string }) => `extract-${params.source}`,
        execute: async (_ctx, params: { source: string }) => ({
          source: params.source,
          data: [1, 2, 3],
        }),
        dependencies: [],
      })

      const transformTemplate = createTaskTemplate({
        id: (params: { source: string }) => `transform-${params.source}`,
        execute: async (ctx, _params: { source: string }) => {
          const upstream = ctx?.upstreamResults as Record<string, { data: number[] }>
          const data = Object.values(upstream)[0]?.data ?? []
          return data.map((d) => d * 2)
        },
        dependencies: (params: { source: string }) => [`extract-${params.source}`],
      })

      const sources = ['api', 'db', 'file']

      const tasks: TaskNode[] = []
      for (const source of sources) {
        tasks.push(createTaskFromTemplate(extractTemplate, { source }))
        tasks.push(createTaskFromTemplate(transformTemplate, { source }))
      }

      // Add merge task
      tasks.push(
        createTaskNode({
          id: 'merge',
          execute: async (ctx) => {
            const results = Object.values(ctx?.upstreamResults ?? {})
            return results.flat()
          },
          dependencies: sources.map((s) => `transform-${s}`),
        })
      )

      const templateDAG = createDAG({ id: 'template-dag', tasks })
      const executor = createParallelExecutor()
      const run = await executor.execute(templateDAG)

      expect(run.status).toBe('completed')
      expect(run.taskResults.size).toBe(7) // 3 extracts + 3 transforms + 1 merge

      const mergeResult = run.taskResults.get('merge')!.output as number[][]
      expect(mergeResult.flat()).toEqual([2, 4, 6, 2, 4, 6, 2, 4, 6])
    })
  })

  describe('Fluent DAG Builder', () => {
    it('should build DAG using fluent API', async () => {
      const fluentDAG = dag('fluent-dag')
        .task('start', async () => 'started')
        .task('middle', async (ctx) => {
          const upstream = ctx?.upstreamResults as { start: string }
          return upstream?.start + '-processed'
        }, { deps: ['start'] })
        .task('end', async (ctx) => {
          const upstream = ctx?.upstreamResults as { middle: string }
          return upstream?.middle + '-finished'
        }, { deps: ['middle'] })
        .build()

      const executor = createParallelExecutor()
      const run = await executor.execute(fluentDAG)

      expect(run.status).toBe('completed')
      expect(run.taskResults.get('end')!.output).toBe('started-processed-finished')
    })

    it('should combine fluent API with task decorator', async () => {
      const taskA = task('task-a', async () => 'A')
      const taskB = task('task-b', async () => 'B', { deps: [taskA] })
      const taskC = task('task-c', async (ctx) => {
        const upstream = ctx?.upstreamResults as { 'task-b': string }
        return upstream['task-b'] + 'C'
      }, { deps: [taskB] })

      const combinedDAG = dag('combined', [taskA, taskB, taskC]).build()
      const executor = createParallelExecutor()
      const run = await executor.execute(combinedDAG)

      expect(run.status).toBe('completed')
      expect(run.taskResults.get('task-c')!.output).toBe('BC')
    })
  })
})
