/**
 * Dynamic Task Generation Tests
 *
 * RED phase: Tests for advanced dynamic task generation patterns.
 * These tests define behavior for:
 * - TaskExpander: Runtime task generation from parent output
 * - BranchOperator: Conditional path selection
 * - MapReduceOperator: Parallel fan-out with aggregation
 * - Dynamic dependency resolution
 *
 * @module db/primitives/dag-scheduler/dynamic-task.test
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createDAG,
  createTaskNode,
  createParallelExecutor,
  type TaskNode,
  type TaskContext,
  type DAGRun,
} from './index'
import {
  TaskExpander,
  BranchOperator,
  MapReduceOperator,
  createTaskExpander,
  createBranchOperator,
  createMapReduceOperator,
  type TaskExpanderConfig,
  type BranchOperatorConfig,
  type MapReduceConfig,
  type BranchCondition,
  type MapFunction,
  type ReduceFunction,
} from './dynamic-task'

// ============================================================================
// TEST HELPERS
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// TASK EXPANDER - RUNTIME TASK GENERATION
// ============================================================================

describe('TaskExpander', () => {
  describe('createTaskExpander', () => {
    it('should create a task expander with configuration', () => {
      const expander = createTaskExpander({
        id: 'expand-files',
        expand: (input: string[]) =>
          input.map((file) =>
            createTaskNode({
              id: `process-${file}`,
              execute: async () => `processed-${file}`,
              dependencies: [],
            })
          ),
      })

      expect(expander.id).toBe('expand-files')
      expect(typeof expander.expand).toBe('function')
    })

    it('should expand tasks based on parent output', () => {
      const expander = createTaskExpander<string[], TaskNode[]>({
        id: 'file-expander',
        expand: (files) =>
          files.map((file) =>
            createTaskNode({
              id: `process-${file}`,
              execute: async () => `done-${file}`,
              dependencies: [],
            })
          ),
      })

      const files = ['a.txt', 'b.txt', 'c.txt']
      const tasks = expander.expand(files)

      expect(tasks).toHaveLength(3)
      expect(tasks.map((t) => t.id)).toEqual([
        'process-a.txt',
        'process-b.txt',
        'process-c.txt',
      ])
    })

    it('should support maximum expansion limit', () => {
      const expander = createTaskExpander({
        id: 'limited-expander',
        expand: (nums: number[]) =>
          nums.map((n) =>
            createTaskNode({
              id: `task-${n}`,
              execute: async () => n,
              dependencies: [],
            })
          ),
        maxTasks: 5,
      })

      const tasks = expander.expand([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      expect(tasks).toHaveLength(5)
    })

    it('should validate expanded tasks have unique IDs', () => {
      const expander = createTaskExpander({
        id: 'duplicate-expander',
        expand: () => [
          createTaskNode({ id: 'same-id', execute: async () => 1, dependencies: [] }),
          createTaskNode({ id: 'same-id', execute: async () => 2, dependencies: [] }),
        ],
        validateUnique: true,
      })

      expect(() => expander.expand(null)).toThrow(/duplicate/i)
    })

    it('should support context-aware expansion', () => {
      const expander = createTaskExpander<{ count: number }, TaskNode[]>({
        id: 'context-expander',
        expand: (input, context) => {
          const tasks: TaskNode[] = []
          for (let i = 0; i < input.count; i++) {
            tasks.push(
              createTaskNode({
                id: `task-${context?.runId}-${i}`,
                execute: async () => i,
                dependencies: [],
              })
            )
          }
          return tasks
        },
      })

      const tasks = expander.expand({ count: 3 }, { runId: 'run-123', dagId: 'dag-1' })
      expect(tasks.map((t) => t.id)).toEqual([
        'task-run-123-0',
        'task-run-123-1',
        'task-run-123-2',
      ])
    })
  })

  describe('integration with DAG execution', () => {
    it('should execute expanded tasks within DAG', async () => {
      const expander = createTaskExpander<string[], TaskNode[]>({
        id: 'process-expander',
        expand: (files) =>
          files.map((file) =>
            createTaskNode({
              id: `process-${file}`,
              execute: async () => `processed-${file}`,
              dependencies: [],
            })
          ),
      })

      const d = createDAG({
        id: 'dag-with-expander',
        tasks: [
          createTaskNode({
            id: 'list-files',
            execute: async () => ['a.csv', 'b.csv'],
            dependencies: [],
          }),
          createTaskNode({
            id: 'expand',
            execute: async () => {},
            dependencies: ['list-files'],
            dynamic: {
              expand: (files) => expander.expand(files as string[]),
            },
          }),
          createTaskNode({
            id: 'collect',
            execute: async (ctx) => ctx?.dynamicResults,
            dependencies: ['expand'],
            collectDynamic: true,
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.status).toBe('completed')
      expect(run.taskResults.has('process-a.csv')).toBe(true)
      expect(run.taskResults.has('process-b.csv')).toBe(true)
      expect(run.taskResults.get('collect')?.output).toEqual([
        'processed-a.csv',
        'processed-b.csv',
      ])
    })

    it('should support nested expansion', async () => {
      const outerExpander = createTaskExpander<string[], TaskNode[]>({
        id: 'outer-expander',
        expand: (categories) =>
          categories.map((cat) =>
            createTaskNode({
              id: `category-${cat}`,
              execute: async () => [`${cat}-item1`, `${cat}-item2`],
              dependencies: [],
              dynamic: {
                expand: (items: string[]) =>
                  items.map((item) =>
                    createTaskNode({
                      id: `process-${item}`,
                      execute: async () => `done-${item}`,
                      dependencies: [],
                    })
                  ),
              },
            })
          ),
        allowNested: true,
      })

      const d = createDAG({
        id: 'nested-dag',
        tasks: [
          createTaskNode({
            id: 'get-categories',
            execute: async () => ['cat-a', 'cat-b'],
            dependencies: [],
          }),
          createTaskNode({
            id: 'expand-outer',
            execute: async () => {},
            dependencies: ['get-categories'],
            dynamic: {
              expand: (cats) => outerExpander.expand(cats as string[]),
            },
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.status).toBe('completed')
      // Should have expanded nested tasks
      expect(run.taskResults.has('process-cat-a-item1')).toBe(true)
      expect(run.taskResults.has('process-cat-a-item2')).toBe(true)
      expect(run.taskResults.has('process-cat-b-item1')).toBe(true)
      expect(run.taskResults.has('process-cat-b-item2')).toBe(true)
    })
  })
})

// ============================================================================
// BRANCH OPERATOR - CONDITIONAL PATH SELECTION
// ============================================================================

describe('BranchOperator', () => {
  describe('createBranchOperator', () => {
    it('should create a branch operator with conditions', () => {
      const branch = createBranchOperator({
        id: 'status-branch',
        conditions: [
          {
            name: 'success',
            predicate: (result: { success: boolean }) => result.success,
            tasks: [
              createTaskNode({
                id: 'success-path',
                execute: async () => 'handled success',
                dependencies: [],
              }),
            ],
          },
          {
            name: 'failure',
            predicate: (result: { success: boolean }) => !result.success,
            tasks: [
              createTaskNode({
                id: 'failure-path',
                execute: async () => 'handled failure',
                dependencies: [],
              }),
            ],
          },
        ],
      })

      expect(branch.id).toBe('status-branch')
      expect(branch.conditions).toHaveLength(2)
    })

    it('should evaluate conditions and return matching branch', () => {
      const branch = createBranchOperator<{ status: string }>({
        id: 'multi-branch',
        conditions: [
          {
            name: 'approved',
            predicate: (r) => r.status === 'approved',
            tasks: [createTaskNode({ id: 'approved-task', execute: async () => 'approved', dependencies: [] })],
          },
          {
            name: 'rejected',
            predicate: (r) => r.status === 'rejected',
            tasks: [createTaskNode({ id: 'rejected-task', execute: async () => 'rejected', dependencies: [] })],
          },
          {
            name: 'pending',
            predicate: (r) => r.status === 'pending',
            tasks: [createTaskNode({ id: 'pending-task', execute: async () => 'pending', dependencies: [] })],
          },
        ],
      })

      const approvedTasks = branch.evaluate({ status: 'approved' })
      expect(approvedTasks.map((t) => t.id)).toEqual(['approved-task'])

      const rejectedTasks = branch.evaluate({ status: 'rejected' })
      expect(rejectedTasks.map((t) => t.id)).toEqual(['rejected-task'])
    })

    it('should support default branch when no conditions match', () => {
      const branch = createBranchOperator<number>({
        id: 'value-branch',
        conditions: [
          {
            name: 'positive',
            predicate: (n) => n > 0,
            tasks: [createTaskNode({ id: 'positive-task', execute: async () => 'positive', dependencies: [] })],
          },
          {
            name: 'negative',
            predicate: (n) => n < 0,
            tasks: [createTaskNode({ id: 'negative-task', execute: async () => 'negative', dependencies: [] })],
          },
        ],
        defaultBranch: [
          createTaskNode({ id: 'zero-task', execute: async () => 'zero', dependencies: [] }),
        ],
      })

      const zeroTasks = branch.evaluate(0)
      expect(zeroTasks.map((t) => t.id)).toEqual(['zero-task'])
    })

    it('should support multiple matching branches', () => {
      const branch = createBranchOperator<{ tags: string[] }>({
        id: 'multi-match-branch',
        conditions: [
          {
            name: 'urgent',
            predicate: (r) => r.tags.includes('urgent'),
            tasks: [createTaskNode({ id: 'urgent-handler', execute: async () => 'urgent', dependencies: [] })],
          },
          {
            name: 'important',
            predicate: (r) => r.tags.includes('important'),
            tasks: [createTaskNode({ id: 'important-handler', execute: async () => 'important', dependencies: [] })],
          },
        ],
        matchAll: true, // Execute all matching branches, not just first
      })

      const tasks = branch.evaluate({ tags: ['urgent', 'important'] })
      expect(tasks.map((t) => t.id).sort()).toEqual(['important-handler', 'urgent-handler'])
    })

    it('should throw when no conditions match and no default', () => {
      const branch = createBranchOperator<string>({
        id: 'strict-branch',
        conditions: [
          {
            name: 'a',
            predicate: (s) => s === 'a',
            tasks: [createTaskNode({ id: 'a-task', execute: async () => 'a', dependencies: [] })],
          },
        ],
        requireMatch: true,
      })

      expect(() => branch.evaluate('b')).toThrow(/no matching branch/i)
    })
  })

  describe('integration with DAG execution', () => {
    it('should execute only the matching branch in DAG', async () => {
      const executed: string[] = []

      const branch = createBranchOperator<{ approved: boolean }>({
        id: 'approval-branch',
        conditions: [
          {
            name: 'approved',
            predicate: (r) => r.approved,
            tasks: [
              createTaskNode({
                id: 'send-confirmation',
                execute: async () => {
                  executed.push('send-confirmation')
                  return 'confirmed'
                },
                dependencies: [],
              }),
            ],
          },
          {
            name: 'rejected',
            predicate: (r) => !r.approved,
            tasks: [
              createTaskNode({
                id: 'send-rejection',
                execute: async () => {
                  executed.push('send-rejection')
                  return 'rejected'
                },
                dependencies: [],
              }),
            ],
          },
        ],
      })

      const d = createDAG({
        id: 'branching-dag',
        tasks: [
          createTaskNode({
            id: 'check-approval',
            execute: async () => ({ approved: true }),
            dependencies: [],
          }),
          createTaskNode({
            id: 'branch',
            execute: async () => {},
            dependencies: ['check-approval'],
            dynamic: {
              expand: (result) => branch.evaluate(result as { approved: boolean }),
            },
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.status).toBe('completed')
      expect(executed).toContain('send-confirmation')
      expect(executed).not.toContain('send-rejection')
      expect(run.taskResults.has('send-confirmation')).toBe(true)
      expect(run.taskResults.has('send-rejection')).toBe(false)
    })

    it('should support chained branching', async () => {
      const primaryBranch = createBranchOperator<{ type: string }>({
        id: 'primary-branch',
        conditions: [
          {
            name: 'type-a',
            predicate: (r) => r.type === 'A',
            tasks: [
              createTaskNode({
                id: 'process-a',
                execute: async () => ({ subType: 'A1' }),
                dependencies: [],
              }),
            ],
          },
          {
            name: 'type-b',
            predicate: (r) => r.type === 'B',
            tasks: [
              createTaskNode({
                id: 'process-b',
                execute: async () => ({ subType: 'B1' }),
                dependencies: [],
              }),
            ],
          },
        ],
      })

      const d = createDAG({
        id: 'chained-branch-dag',
        tasks: [
          createTaskNode({
            id: 'determine-type',
            execute: async () => ({ type: 'A' }),
            dependencies: [],
          }),
          createTaskNode({
            id: 'branch-1',
            execute: async () => {},
            dependencies: ['determine-type'],
            dynamic: {
              expand: (r) => primaryBranch.evaluate(r as { type: string }),
            },
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.status).toBe('completed')
      expect(run.taskResults.has('process-a')).toBe(true)
      expect(run.taskResults.get('process-a')?.output).toEqual({ subType: 'A1' })
    })
  })
})

// ============================================================================
// MAP REDUCE OPERATOR - PARALLEL FAN-OUT WITH AGGREGATION
// ============================================================================

describe('MapReduceOperator', () => {
  describe('createMapReduceOperator', () => {
    it('should create a map-reduce operator', () => {
      const mapReduce = createMapReduceOperator<number, number, number>({
        id: 'sum-squares',
        map: (n) => n * n,
        reduce: (results) => results.reduce((a, b) => a + b, 0),
      })

      expect(mapReduce.id).toBe('sum-squares')
      expect(typeof mapReduce.map).toBe('function')
      expect(typeof mapReduce.reduce).toBe('function')
    })

    it('should generate map tasks for each input', () => {
      const mapReduce = createMapReduceOperator<string, string, string[]>({
        id: 'process-items',
        map: (item) => item.toUpperCase(),
        reduce: (results) => results,
      })

      const mapTasks = mapReduce.createMapTasks(['a', 'b', 'c'])
      expect(mapTasks).toHaveLength(3)
      expect(mapTasks.map((t) => t.id)).toEqual([
        'process-items-map-0',
        'process-items-map-1',
        'process-items-map-2',
      ])
    })

    it('should create reduce task that aggregates results', async () => {
      const mapReduce = createMapReduceOperator<number, number, number>({
        id: 'sum',
        map: (n) => n * 2,
        reduce: (results) => results.reduce((a, b) => a + b, 0),
      })

      const mapResults = [2, 4, 6, 8, 10] // Results from map phase
      const reduceTask = mapReduce.createReduceTask(mapResults)

      expect(reduceTask.id).toBe('sum-reduce')
      const result = await reduceTask.execute()
      expect(result).toBe(30) // 2+4+6+8+10
    })

    it('should support custom task ID generator', () => {
      const mapReduce = createMapReduceOperator<{ id: string; value: number }, number, number>({
        id: 'custom-id',
        map: (item) => item.value * 2,
        reduce: (results) => results.reduce((a, b) => a + b, 0),
        taskIdGenerator: (item, index) => `process-${item.id}`,
      })

      const items = [
        { id: 'item-a', value: 1 },
        { id: 'item-b', value: 2 },
        { id: 'item-c', value: 3 },
      ]

      const mapTasks = mapReduce.createMapTasks(items)
      expect(mapTasks.map((t) => t.id)).toEqual([
        'process-item-a',
        'process-item-b',
        'process-item-c',
      ])
    })

    it('should support parallel execution limit', () => {
      const mapReduce = createMapReduceOperator<number, number, number>({
        id: 'limited-parallel',
        map: (n) => n,
        reduce: (r) => r.reduce((a, b) => a + b, 0),
        maxParallel: 3,
      })

      expect(mapReduce.maxParallel).toBe(3)
    })

    it('should support chunked map operations', () => {
      const mapReduce = createMapReduceOperator<number, number[], number>({
        id: 'chunked',
        map: (chunk) => chunk.reduce((a, b) => a + b, 0),
        reduce: (r) => r.reduce((a, b) => a + b, 0),
        chunkSize: 3,
      })

      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      const mapTasks = mapReduce.createMapTasks(items)

      // Should create 4 tasks: [1,2,3], [4,5,6], [7,8,9], [10]
      expect(mapTasks).toHaveLength(4)
    })
  })

  describe('integration with DAG execution', () => {
    it('should execute map-reduce pattern in DAG', async () => {
      const mapReduce = createMapReduceOperator<number, number, number>({
        id: 'square-sum',
        map: (n) => n * n,
        reduce: (results) => results.reduce((a, b) => a + b, 0),
      })

      const d = createDAG({
        id: 'map-reduce-dag',
        tasks: [
          createTaskNode({
            id: 'generate-numbers',
            execute: async () => [1, 2, 3, 4, 5],
            dependencies: [],
          }),
          createTaskNode({
            id: 'map-phase',
            execute: async () => {},
            dependencies: ['generate-numbers'],
            dynamic: {
              expand: (nums) => mapReduce.createMapTasks(nums as number[]),
            },
          }),
          createTaskNode({
            id: 'reduce-phase',
            execute: async (ctx) => {
              const mapResults = ctx?.dynamicResults as number[]
              return mapReduce.reduce(mapResults)
            },
            dependencies: ['map-phase'],
            collectDynamic: true,
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.status).toBe('completed')
      // 1^2 + 2^2 + 3^2 + 4^2 + 5^2 = 1 + 4 + 9 + 16 + 25 = 55
      expect(run.taskResults.get('reduce-phase')?.output).toBe(55)
    })

    it('should handle empty input gracefully', async () => {
      const mapReduce = createMapReduceOperator<number, number, number>({
        id: 'empty-handler',
        map: (n) => n * 2,
        reduce: (results) => (results.length === 0 ? 0 : results.reduce((a, b) => a + b, 0)),
      })

      const d = createDAG({
        id: 'empty-map-reduce-dag',
        tasks: [
          createTaskNode({
            id: 'generate-empty',
            execute: async () => [],
            dependencies: [],
          }),
          createTaskNode({
            id: 'map-phase',
            execute: async () => {},
            dependencies: ['generate-empty'],
            dynamic: {
              expand: (nums) => mapReduce.createMapTasks(nums as number[]),
            },
          }),
          createTaskNode({
            id: 'reduce-phase',
            execute: async (ctx) => {
              const mapResults = (ctx?.dynamicResults as number[]) ?? []
              return mapReduce.reduce(mapResults)
            },
            dependencies: ['map-phase'],
            collectDynamic: true,
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.status).toBe('completed')
      expect(run.taskResults.get('reduce-phase')?.output).toBe(0)
    })

    it('should support combining multiple map-reduce operations', async () => {
      const mapReduce1 = createMapReduceOperator<number, number, number[]>({
        id: 'double',
        map: (n) => n * 2,
        reduce: (r) => r,
      })

      const mapReduce2 = createMapReduceOperator<number, number, number>({
        id: 'sum',
        map: (n) => n,
        reduce: (r) => r.reduce((a, b) => a + b, 0),
      })

      const d = createDAG({
        id: 'chained-map-reduce',
        tasks: [
          createTaskNode({
            id: 'input',
            execute: async () => [1, 2, 3],
            dependencies: [],
          }),
          createTaskNode({
            id: 'map-1',
            execute: async () => {},
            dependencies: ['input'],
            dynamic: {
              expand: (nums) => mapReduce1.createMapTasks(nums as number[]),
            },
          }),
          createTaskNode({
            id: 'reduce-1',
            execute: async (ctx) => mapReduce1.reduce(ctx?.dynamicResults as number[]),
            dependencies: ['map-1'],
            collectDynamic: true,
          }),
          createTaskNode({
            id: 'map-2',
            execute: async () => {},
            dependencies: ['reduce-1'],
            dynamic: {
              expand: (nums) => mapReduce2.createMapTasks(nums as number[]),
            },
          }),
          createTaskNode({
            id: 'reduce-2',
            execute: async (ctx) => mapReduce2.reduce(ctx?.dynamicResults as number[]),
            dependencies: ['map-2'],
            collectDynamic: true,
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.status).toBe('completed')
      // [1,2,3] -> double -> [2,4,6] -> sum -> 12
      expect(run.taskResults.get('reduce-2')?.output).toBe(12)
    })

    it('should respect maxParallel during execution', async () => {
      let maxConcurrent = 0
      let current = 0

      const mapReduce = createMapReduceOperator<number, number, number[]>({
        id: 'parallel-limited',
        map: async (n) => {
          current++
          maxConcurrent = Math.max(maxConcurrent, current)
          await delay(20)
          current--
          return n
        },
        reduce: (r) => r,
        maxParallel: 2,
      })

      const d = createDAG({
        id: 'parallel-limited-dag',
        tasks: [
          createTaskNode({
            id: 'input',
            execute: async () => [1, 2, 3, 4, 5],
            dependencies: [],
          }),
          createTaskNode({
            id: 'map-phase',
            execute: async () => {},
            dependencies: ['input'],
            dynamic: {
              expand: (nums) => mapReduce.createMapTasks(nums as number[]),
              maxExpansion: mapReduce.maxParallel,
            },
          }),
        ],
      })

      const executor = createParallelExecutor({ maxConcurrency: 10 })
      await executor.execute(d)

      // The map tasks should respect maxParallel
      expect(maxConcurrent).toBeLessThanOrEqual(2)
    })
  })
})

// ============================================================================
// DYNAMIC DEPENDENCY RESOLUTION
// ============================================================================

describe('DynamicDependencyResolution', () => {
  describe('runtime dependency injection', () => {
    it('should resolve dependencies at runtime based on output', async () => {
      const d = createDAG({
        id: 'dynamic-deps-dag',
        tasks: [
          createTaskNode({
            id: 'determine-path',
            execute: async () => ({ needsValidation: true, needsTransform: false }),
            dependencies: [],
          }),
          createTaskNode({
            id: 'conditional-expand',
            execute: async () => {},
            dependencies: ['determine-path'],
            dynamic: {
              expand: (config: { needsValidation: boolean; needsTransform: boolean }) => {
                const tasks: TaskNode[] = []
                if (config.needsValidation) {
                  tasks.push(
                    createTaskNode({
                      id: 'validate',
                      execute: async () => 'validated',
                      dependencies: [],
                    })
                  )
                }
                if (config.needsTransform) {
                  tasks.push(
                    createTaskNode({
                      id: 'transform',
                      execute: async () => 'transformed',
                      dependencies: [],
                    })
                  )
                }
                return tasks
              },
            },
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.status).toBe('completed')
      expect(run.taskResults.has('validate')).toBe(true)
      expect(run.taskResults.has('transform')).toBe(false)
    })

    it('should create dynamic task chains', async () => {
      const d = createDAG({
        id: 'dynamic-chain-dag',
        tasks: [
          createTaskNode({
            id: 'config',
            execute: async () => ({ steps: ['step-a', 'step-b', 'step-c'] }),
            dependencies: [],
          }),
          createTaskNode({
            id: 'build-chain',
            execute: async () => {},
            dependencies: ['config'],
            dynamic: {
              expand: (config: { steps: string[] }) => {
                const tasks: TaskNode[] = []
                for (let i = 0; i < config.steps.length; i++) {
                  tasks.push(
                    createTaskNode({
                      id: config.steps[i]!,
                      execute: async () => `done-${config.steps[i]}`,
                      dependencies: i > 0 ? [config.steps[i - 1]!] : [],
                    })
                  )
                }
                return tasks
              },
            },
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.status).toBe('completed')
      expect(run.taskResults.get('step-a')?.output).toBe('done-step-a')
      expect(run.taskResults.get('step-b')?.output).toBe('done-step-b')
      expect(run.taskResults.get('step-c')?.output).toBe('done-step-c')
    })

    it('should support dynamic fan-out with variable width', async () => {
      const executedTasks: string[] = []

      const d = createDAG({
        id: 'variable-fanout-dag',
        tasks: [
          createTaskNode({
            id: 'determine-parallelism',
            execute: async () => ({ parallelism: 5 }),
            dependencies: [],
          }),
          createTaskNode({
            id: 'fanout',
            execute: async () => {},
            dependencies: ['determine-parallelism'],
            dynamic: {
              expand: (config: { parallelism: number }) => {
                return Array.from({ length: config.parallelism }, (_, i) =>
                  createTaskNode({
                    id: `worker-${i}`,
                    execute: async () => {
                      executedTasks.push(`worker-${i}`)
                      return `result-${i}`
                    },
                    dependencies: [],
                  })
                )
              },
            },
          }),
          createTaskNode({
            id: 'fanin',
            execute: async (ctx) => (ctx?.dynamicResults as string[])?.length,
            dependencies: ['fanout'],
            collectDynamic: true,
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.status).toBe('completed')
      expect(executedTasks).toHaveLength(5)
      expect(run.taskResults.get('fanin')?.output).toBe(5)
    })
  })

  describe('error handling in dynamic tasks', () => {
    it('should handle errors in dynamically expanded tasks', async () => {
      const d = createDAG({
        id: 'error-handling-dag',
        tasks: [
          createTaskNode({
            id: 'generate',
            execute: async () => [1, 2, 3],
            dependencies: [],
          }),
          createTaskNode({
            id: 'expand',
            execute: async () => {},
            dependencies: ['generate'],
            dynamic: {
              expand: (nums: number[]) =>
                nums.map((n) =>
                  createTaskNode({
                    id: `process-${n}`,
                    execute: async () => {
                      if (n === 2) throw new Error('Failed on 2')
                      return n * 2
                    },
                    dependencies: [],
                  })
                ),
            },
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.status).toBe('failed')
      expect(run.taskResults.get('process-1')?.status).toBe('success')
      expect(run.taskResults.get('process-2')?.status).toBe('failed')
      expect(run.taskResults.get('process-3')?.status).toBe('success')
    })

    it('should support retry policy on dynamically expanded tasks', async () => {
      let attempt = 0

      const d = createDAG({
        id: 'retry-dynamic-dag',
        tasks: [
          createTaskNode({
            id: 'generate',
            execute: async () => ['flaky-item'],
            dependencies: [],
          }),
          createTaskNode({
            id: 'expand',
            execute: async () => {},
            dependencies: ['generate'],
            dynamic: {
              expand: (items: string[]) =>
                items.map((item) =>
                  createTaskNode({
                    id: `process-${item}`,
                    execute: async () => {
                      attempt++
                      if (attempt < 3) throw new Error('Flaky')
                      return 'success'
                    },
                    dependencies: [],
                    retryPolicy: {
                      maxAttempts: 3,
                      backoff: { type: 'fixed', delay: 10 },
                    },
                  })
                ),
            },
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.status).toBe('completed')
      expect(run.taskResults.get('process-flaky-item')?.attempts).toBe(3)
    })
  })
})
