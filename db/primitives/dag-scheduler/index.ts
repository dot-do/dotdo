/**
 * DAGScheduler - Workflow orchestration primitive
 *
 * Provides Directed Acyclic Graph scheduling with:
 * - Task definitions with dependencies
 * - Topological sort and cycle detection
 * - Parallel execution with concurrency limits
 * - Retry policies with exponential backoff
 * - State persistence for recovery
 * - Cron scheduling
 * - Dynamic task generation
 * - Cross-DAG dependencies
 *
 * @module db/primitives/dag-scheduler
 */

// ============================================================================
// TYPES
// ============================================================================

/** Task execution context */
export interface TaskContext {
  runId?: string
  dagId?: string
  upstreamResults?: Record<string, unknown>
  triggerPayload?: unknown
  dynamicResults?: unknown[]
}

/** Task status */
export type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

/** DAG run status */
export type DAGRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'

/** Result of a single task execution */
export interface TaskResult<T = unknown> {
  taskId: string
  status: TaskStatus
  output?: T
  error?: Error
  startedAt?: Date
  completedAt?: Date
  attempts: number
}

/** Result of a DAG run */
export interface DAGRun {
  runId: string
  dagId: string
  status: DAGRunStatus
  taskResults: Map<string, TaskResult>
  startedAt: Date
  completedAt?: Date
}

/** Task template for parameter substitution */
export interface TaskTemplate<T = unknown, P = unknown> {
  id: string | ((params: P) => string)
  execute: (ctx?: TaskContext, params?: P) => Promise<T>
  dependencies: string[] | ((params: P) => string[])
  retryPolicy?: RetryPolicy
  timeout?: number
  metadata?: Record<string, unknown> | ((params: P) => Record<string, unknown>)
}

/** Dynamic task generator configuration */
export interface DynamicTaskGenerator<T = unknown> {
  expand: (parentOutput: unknown, context?: TaskContext) => TaskNode[] | Promise<TaskNode[]>
  maxExpansion?: number
  /** Allow nested dynamic expansion (generated tasks can also have dynamic generators) */
  allowNested?: boolean
}

/** Dynamic dependency resolver */
export interface DynamicDependencyResolver {
  /** Resolve dependencies at runtime based on context */
  resolve: (context: TaskContext) => string[] | Promise<string[]>
}

/** Task node definition */
export interface TaskNode<T = unknown> {
  id: string
  execute: (ctx?: TaskContext) => Promise<T>
  dependencies: string[]
  retryPolicy?: RetryPolicy
  timeout?: number
  metadata?: Record<string, unknown>
  dynamic?: DynamicTaskGenerator<T>
  collectDynamic?: boolean
  /** Dynamic dependency resolver for runtime dependency computation */
  dynamicDependencies?: DynamicDependencyResolver
  /** Parent task ID if this was dynamically generated */
  expandedFrom?: string
  /** Template parameters used for this task instance */
  templateParams?: unknown
}

/** Options for creating a task node */
export interface TaskNodeOptions<T = unknown> {
  id: string
  execute: (ctx?: TaskContext) => Promise<T>
  dependencies: string[]
  retryPolicy?: RetryPolicy
  timeout?: number
  metadata?: Record<string, unknown>
  dynamic?: DynamicTaskGenerator<T>
  collectDynamic?: boolean
  dynamicDependencies?: DynamicDependencyResolver
  expandedFrom?: string
  templateParams?: unknown
}

/** External dependency on another DAG */
export interface ExternalDependency {
  dagId: string
  taskId?: string
  condition?: 'success' | 'completed' | 'any'
}

/** DAG trigger configuration */
export interface DAGTrigger {
  type: 'dag-complete' | 'task-complete' | 'sensor'
  source: ExternalDependency
  payload?: (result: DAGRun) => unknown
}

/** DAG definition */
export interface DAG {
  id: string
  tasks: Map<string, TaskNode>
  schedule?: string
  triggers?: DAGTrigger[]
  run: (options?: ExecutorOptions) => Promise<DAGRun>
}

/** Options for creating a DAG */
export interface DAGOptions {
  id: string
  tasks: TaskNode[]
  schedule?: string
  triggers?: DAGTrigger[]
}

// ============================================================================
// BACKOFF STRATEGIES
// ============================================================================

/** Fixed delay backoff */
export interface FixedBackoff {
  type: 'fixed'
  delay: number
}

/** Exponential backoff */
export interface ExponentialBackoff {
  type: 'exponential'
  base: number
  max: number
}

/** Exponential backoff with jitter */
export interface ExponentialJitterBackoff {
  type: 'exponential-jitter'
  base: number
  max: number
}

/** Custom delay sequence */
export interface CustomBackoff {
  type: 'custom'
  delays: number[]
}

/** All backoff strategy types */
export type BackoffStrategy = FixedBackoff | ExponentialBackoff | ExponentialJitterBackoff | CustomBackoff

/** Retry policy configuration */
export interface RetryPolicy {
  maxAttempts: number
  backoff: BackoffStrategy
  retryableErrors?: (error: Error) => boolean
  onRetry?: (attempt: number, error: Error) => void
}

/** Retry policy with computed methods */
export interface RetryPolicyInstance extends RetryPolicy {
  getDelay: (attempt: number) => number
  shouldRetry: (attempt: number, error: Error) => boolean
}

// ============================================================================
// STATE PERSISTENCE TYPES
// ============================================================================

/** Persisted DAG run state */
export interface DAGRunState {
  runId: string
  dagId: string
  status: DAGRunStatus
  taskResults: Map<string, TaskResult>
  startedAt: Date
  completedAt?: Date
}

/** Options for listing runs */
export interface ListRunsOptions {
  limit?: number
  status?: DAGRunStatus
}

/** State storage interface */
export interface DAGStateStore {
  saveRun(runId: string, state: DAGRunState): Promise<void>
  loadRun(runId: string): Promise<DAGRunState | null>
  updateTask(runId: string, taskId: string, result: TaskResult): Promise<void>
  listRuns(dagId: string, options?: ListRunsOptions): Promise<DAGRunState[]>
}

// ============================================================================
// CRON TYPES
// ============================================================================

/** Parsed cron expression */
export interface ParsedCron {
  minute: number | '*' | { start: number; end: number } | { step: number }
  hour: number | '*' | { start: number; end: number } | { step: number }
  dayOfMonth: number | '*' | { start: number; end: number } | { step: number }
  month: number | '*' | { start: number; end: number } | { step: number }
  dayOfWeek: number | '*' | { start: number; end: number } | { step: number }
}

/** Cron trigger options */
export interface CronTriggerOptions {
  timezone?: string
  catchup?: boolean
}

/** Cron trigger interface */
export interface CronTrigger {
  expression: string
  options: CronTriggerOptions
  getNextRun(from: Date): Date
  getMissedRuns(lastRun: Date, now: Date): Date[]
}

/** Schedule trigger types */
export interface CronScheduleTrigger {
  type: 'cron'
  cron: string
  timezone?: string
  catchup?: boolean
}

export interface IntervalScheduleTrigger {
  type: 'interval'
  interval: number
}

export interface EventScheduleTrigger {
  type: 'event'
  event: string
  filter?: Record<string, unknown>
}

export type ScheduleTrigger = CronScheduleTrigger | IntervalScheduleTrigger | EventScheduleTrigger

// ============================================================================
// SENSOR TYPES
// ============================================================================

/** Sensor configuration */
export interface SensorOptions {
  id: string
  poke: () => Promise<boolean>
  interval: number
  timeout: number
}

/** Sensor interface */
export interface Sensor {
  id: string
  wait(): Promise<boolean>
}

// ============================================================================
// DEPENDENCY RESOLVER
// ============================================================================

/** Options for getDependents */
export interface GetDependentsOptions {
  transitive?: boolean
}

/** Dependency resolver interface */
export interface DependencyResolver {
  getExecutionOrder(dag: DAG): TaskNode[]
  detectCycles(dag: DAG): string[][] | null
  getReadyTasks(dag: DAG, completed: Set<string>): TaskNode[]
  getDependents(dag: DAG, taskId: string, options?: GetDependentsOptions): TaskNode[]
}

/** Create a dependency resolver */
export function createDependencyResolver(): DependencyResolver {
  return {
    getExecutionOrder(dag: DAG): TaskNode[] {
      const result: TaskNode[] = []
      const visited = new Set<string>()
      const inDegree = new Map<string, number>()

      // Calculate in-degrees
      for (const [id, task] of dag.tasks) {
        inDegree.set(id, task.dependencies.length)
      }

      // Kahn's algorithm
      const queue: string[] = []
      for (const [id, degree] of inDegree) {
        if (degree === 0) queue.push(id)
      }

      while (queue.length > 0) {
        const id = queue.shift()!
        visited.add(id)
        result.push(dag.tasks.get(id)!)

        // Find all tasks that depend on this one
        for (const [depId, task] of dag.tasks) {
          if (task.dependencies.includes(id)) {
            const newDegree = inDegree.get(depId)! - 1
            inDegree.set(depId, newDegree)
            if (newDegree === 0 && !visited.has(depId)) {
              queue.push(depId)
            }
          }
        }
      }

      return result
    },

    detectCycles(dag: DAG): string[][] | null {
      const visited = new Set<string>()
      const recursionStack = new Set<string>()
      const cycles: string[][] = []

      function dfs(id: string, path: string[]): boolean {
        visited.add(id)
        recursionStack.add(id)
        path.push(id)

        const task = dag.tasks.get(id)
        if (task) {
          for (const dep of task.dependencies) {
            if (!visited.has(dep)) {
              if (dfs(dep, [...path])) {
                return true
              }
            } else if (recursionStack.has(dep)) {
              // Found cycle
              const cycleStart = path.indexOf(dep)
              cycles.push(path.slice(cycleStart))
              return true
            }
          }
        }

        recursionStack.delete(id)
        return false
      }

      for (const id of dag.tasks.keys()) {
        if (!visited.has(id)) {
          dfs(id, [])
        }
      }

      return cycles.length > 0 ? cycles : null
    },

    getReadyTasks(dag: DAG, completed: Set<string>): TaskNode[] {
      const ready: TaskNode[] = []

      for (const [id, task] of dag.tasks) {
        if (completed.has(id)) continue

        const allDepsComplete = task.dependencies.every((dep) => completed.has(dep))
        if (allDepsComplete) {
          ready.push(task)
        }
      }

      return ready
    },

    getDependents(dag: DAG, taskId: string, options?: GetDependentsOptions): TaskNode[] {
      const directDependents: TaskNode[] = []

      for (const [_, task] of dag.tasks) {
        if (task.dependencies.includes(taskId)) {
          directDependents.push(task)
        }
      }

      if (!options?.transitive) {
        return directDependents
      }

      // Get transitive dependents
      const allDependents = new Set<string>()
      const queue = directDependents.map((t) => t.id)

      while (queue.length > 0) {
        const id = queue.shift()!
        if (allDependents.has(id)) continue
        allDependents.add(id)

        for (const [_, task] of dag.tasks) {
          if (task.dependencies.includes(id) && !allDependents.has(task.id)) {
            queue.push(task.id)
          }
        }
      }

      return [...allDependents].map((id) => dag.tasks.get(id)!)
    },
  }
}

// ============================================================================
// TASK NODE FACTORY
// ============================================================================

/** Create a task node */
export function createTaskNode<T = unknown>(options: TaskNodeOptions<T>): TaskNode<T> {
  // Validation
  if (!options.id || options.id.trim() === '') {
    throw new Error('Task id cannot be empty')
  }

  if (options.dependencies.includes(options.id)) {
    throw new Error('Task cannot depend on itself')
  }

  const uniqueDeps = new Set(options.dependencies)
  if (uniqueDeps.size !== options.dependencies.length) {
    throw new Error('Duplicate dependency detected')
  }

  return {
    id: options.id,
    execute: options.execute,
    dependencies: options.dependencies,
    retryPolicy: options.retryPolicy,
    timeout: options.timeout,
    metadata: options.metadata,
    dynamic: options.dynamic,
    collectDynamic: options.collectDynamic,
    dynamicDependencies: options.dynamicDependencies,
    expandedFrom: options.expandedFrom,
    templateParams: options.templateParams,
  }
}

// ============================================================================
// TASK TEMPLATE FACTORY
// ============================================================================

/** Create a task from a template with parameters */
export function createTaskFromTemplate<T = unknown, P = unknown>(
  template: TaskTemplate<T, P>,
  params: P
): TaskNode<T> {
  const id = typeof template.id === 'function' ? template.id(params) : template.id
  const dependencies = typeof template.dependencies === 'function'
    ? template.dependencies(params)
    : template.dependencies
  const metadata = typeof template.metadata === 'function'
    ? template.metadata(params)
    : template.metadata

  return createTaskNode({
    id,
    execute: (ctx) => template.execute(ctx, params),
    dependencies,
    retryPolicy: template.retryPolicy,
    timeout: template.timeout,
    metadata,
    templateParams: params,
  })
}

/** Create a task template */
export function createTaskTemplate<T = unknown, P = unknown>(
  template: TaskTemplate<T, P>
): TaskTemplate<T, P> {
  return template
}

// ============================================================================
// DAG FACTORY
// ============================================================================

/** Create a DAG */
export function createDAG(options: DAGOptions): DAG {
  const tasks = new Map<string, TaskNode>()

  // Check for duplicate IDs
  const ids = new Set<string>()
  for (const task of options.tasks) {
    if (ids.has(task.id)) {
      throw new Error(`Duplicate task id: ${task.id}`)
    }
    ids.add(task.id)
    tasks.set(task.id, task)
  }

  // Validate dependencies exist
  for (const task of options.tasks) {
    for (const dep of task.dependencies) {
      if (!ids.has(dep)) {
        throw new Error(`Task '${task.id}' depends on unknown task '${dep}'`)
      }
    }
  }

  // Check for cycles
  const resolver = createDependencyResolver()
  const tempDag: DAG = {
    id: options.id,
    tasks,
    run: async () => ({} as DAGRun),
  }
  const cycles = resolver.detectCycles(tempDag)
  if (cycles) {
    throw new Error(`Cycle detected in DAG: ${cycles[0]!.join(' -> ')}`)
  }

  const dag: DAG = {
    id: options.id,
    tasks,
    schedule: options.schedule,
    triggers: options.triggers,
    run: async (execOptions?: ExecutorOptions) => {
      const executor = createParallelExecutor(execOptions)
      return executor.execute(dag, execOptions)
    },
  }

  return dag
}

// ============================================================================
// FLUENT DAG BUILDER
// ============================================================================

/** Fluent DAG builder */
export interface DAGBuilder {
  task<T>(
    id: string,
    execute: (ctx?: TaskContext) => Promise<T>,
    options?: { deps?: string[] | TaskNode[]; timeout?: number; retryPolicy?: RetryPolicy }
  ): DAGBuilder
  build(): DAG
}

/** Task decorator for fluent API */
export function task<T>(
  id: string,
  execute: (ctx?: TaskContext) => Promise<T>,
  options?: { deps?: (string | TaskNode)[] }
): TaskNode<T> {
  const dependencies = (options?.deps ?? []).map((d) => (typeof d === 'string' ? d : d.id))
  return createTaskNode({ id, execute, dependencies })
}

/** Start building a DAG with fluent API */
export function dag(id: string, initialTasks?: TaskNode[]): DAGBuilder {
  const tasks: TaskNode[] = initialTasks ? [...initialTasks] : []

  const builder: DAGBuilder = {
    task<T>(
      taskId: string,
      execute: (ctx?: TaskContext) => Promise<T>,
      options?: { deps?: string[] | TaskNode[]; timeout?: number; retryPolicy?: RetryPolicy }
    ): DAGBuilder {
      const dependencies = (options?.deps ?? []).map((d) => (typeof d === 'string' ? d : d.id))
      tasks.push(
        createTaskNode({
          id: taskId,
          execute,
          dependencies,
          timeout: options?.timeout,
          retryPolicy: options?.retryPolicy,
        })
      )
      return builder
    },
    build(): DAG {
      return createDAG({ id, tasks })
    },
  }

  return builder
}

// ============================================================================
// RETRY POLICY FACTORY
// ============================================================================

/** Create a retry policy with computed methods */
export function createRetryPolicy(config: RetryPolicy): RetryPolicyInstance {
  const getDelay = (attempt: number): number => {
    const backoff = config.backoff

    switch (backoff.type) {
      case 'fixed':
        return backoff.delay

      case 'exponential': {
        const delay = backoff.base * Math.pow(2, attempt - 1)
        return Math.min(delay, backoff.max)
      }

      case 'exponential-jitter': {
        const baseDelay = backoff.base * Math.pow(2, attempt - 1)
        const cappedDelay = Math.min(baseDelay, backoff.max)
        // Add jitter: random value between 0 and cappedDelay
        return Math.random() * cappedDelay
      }

      case 'custom':
        return backoff.delays![attempt - 1] ?? backoff.delays![backoff.delays!.length - 1] ?? 0

      default:
        return 0
    }
  }

  const shouldRetry = (attempt: number, error: Error): boolean => {
    if (attempt >= config.maxAttempts) return false
    if (config.retryableErrors && !config.retryableErrors(error)) return false
    return true
  }

  return {
    ...config,
    getDelay,
    shouldRetry,
  }
}

// ============================================================================
// PARALLEL EXECUTOR
// ============================================================================

/** Executor options */
export interface ExecutorOptions {
  maxConcurrency?: number
  taskTimeout?: number
  onTaskStart?: (task: TaskNode) => void
  onTaskComplete?: (task: TaskNode, result: TaskResult) => void
  stateStore?: DAGStateStore
  triggerPayload?: unknown
}

/** DAG complete callback type */
export type DAGCompleteCallback = (dagId: string, result: DAGRun) => void | Promise<void>

/** Parallel executor interface */
export interface ParallelExecutor {
  execute(dag: DAG, options?: ExecutorOptions): Promise<DAGRun>
  cancel(): Promise<void>
  pause(): void
  resume(): void
  onDAGComplete(callback: DAGCompleteCallback): void
  resume(runId: string, dag: DAG): Promise<DAGRun>
}

/** Create a parallel executor */
export function createParallelExecutor(defaultOptions?: ExecutorOptions): ParallelExecutor {
  let cancelled = false
  let paused = false
  let pausePromise: Promise<void> | null = null
  let resumePause: (() => void) | null = null
  const dagCompleteCallbacks: DAGCompleteCallback[] = []

  const waitForResume = (): Promise<void> => {
    if (!paused) return Promise.resolve()
    if (!pausePromise) {
      pausePromise = new Promise((resolve) => {
        resumePause = resolve
      })
    }
    return pausePromise
  }

  const executeWithTimeout = async <T>(
    fn: () => Promise<T>,
    timeout?: number
  ): Promise<T> => {
    if (!timeout) return fn()

    return Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error('Task timeout exceeded')), timeout)
      }),
    ])
  }

  const executeTask = async (
    task: TaskNode,
    context: TaskContext,
    options?: ExecutorOptions
  ): Promise<TaskResult> => {
    const result: TaskResult = {
      taskId: task.id,
      status: 'running',
      attempts: 0,
      startedAt: new Date(),
    }

    const policy = task.retryPolicy ? createRetryPolicy(task.retryPolicy) : null
    const maxAttempts = policy?.maxAttempts ?? 1

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      result.attempts = attempt

      try {
        await waitForResume()
        if (cancelled) {
          result.status = 'skipped'
          return result
        }

        await options?.onTaskStart?.(task)

        const timeout = task.timeout ?? options?.taskTimeout
        const output = await executeWithTimeout(() => task.execute(context), timeout)

        result.status = 'success'
        result.output = output
        result.completedAt = new Date()
        await options?.onTaskComplete?.(task, result)
        return result
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))

        if (policy && policy.shouldRetry(attempt, err)) {
          policy.onRetry?.(attempt, err)
          await new Promise((resolve) => setTimeout(resolve, policy.getDelay(attempt)))
          continue
        }

        result.status = 'failed'
        result.error = err
        result.completedAt = new Date()
        await options?.onTaskComplete?.(task, result)
        return result
      }
    }

    return result
  }

  const executor: ParallelExecutor = {
    async execute(dag: DAG, options?: ExecutorOptions): Promise<DAGRun> {
      const mergedOptions = { ...defaultOptions, ...options }
      const maxConcurrency = mergedOptions?.maxConcurrency ?? Infinity
      const resolver = createDependencyResolver()

      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      const run: DAGRun = {
        runId,
        dagId: dag.id,
        status: 'running',
        taskResults: new Map(),
        startedAt: new Date(),
      }

      // Initialize all tasks as pending
      for (const [id] of dag.tasks) {
        run.taskResults.set(id, { taskId: id, status: 'pending', attempts: 0 })
      }

      // Track expanded dynamic tasks
      const dynamicTasks = new Map<string, TaskNode>()
      const dynamicResults = new Map<string, unknown[]>()

      const completed = new Set<string>()
      const failed = new Set<string>()
      const running = new Set<string>()
      const skipped = new Set<string>()

      // Get all tasks including dynamic
      const getAllTasks = (): Map<string, TaskNode> => {
        const all = new Map(dag.tasks)
        for (const [id, task] of dynamicTasks) {
          all.set(id, task)
        }
        return all
      }

      // Mark downstream tasks as skipped
      const skipDownstream = (taskId: string) => {
        const allTasks = getAllTasks()
        for (const [id, task] of allTasks) {
          if (task.dependencies.includes(taskId) && !completed.has(id) && !failed.has(id)) {
            skipped.add(id)
            run.taskResults.set(id, { taskId: id, status: 'skipped', attempts: 0 })
            skipDownstream(id)
          }
        }
      }

      // Process tasks
      while (true) {
        await waitForResume()

        if (cancelled) {
          run.status = 'cancelled'
          break
        }

        const allTasks = getAllTasks()
        const pendingCount =
          allTasks.size - completed.size - failed.size - running.size - skipped.size

        if (pendingCount === 0 && running.size === 0) {
          break
        }

        // Find ready tasks
        const ready: TaskNode[] = []
        for (const [id, task] of allTasks) {
          if (completed.has(id) || failed.has(id) || running.has(id) || skipped.has(id)) continue

          const allDepsComplete = task.dependencies.every(
            (dep) => completed.has(dep) || dynamicResults.has(dep)
          )
          const anyDepFailed = task.dependencies.some((dep) => failed.has(dep) || skipped.has(dep))

          if (anyDepFailed) {
            skipped.add(id)
            run.taskResults.set(id, { taskId: id, status: 'skipped', attempts: 0 })
            continue
          }

          if (allDepsComplete) {
            ready.push(task)
          }
        }

        if (ready.length === 0 && running.size === 0) {
          // No progress possible
          break
        }

        // Start tasks up to concurrency limit
        const toStart = ready.slice(0, maxConcurrency - running.size)

        const taskPromises = toStart.map(async (task) => {
          running.add(task.id)

          // Build context with upstream results
          const upstreamResults: Record<string, unknown> = {}
          for (const dep of task.dependencies) {
            const depResult = run.taskResults.get(dep)
            if (depResult?.status === 'success') {
              upstreamResults[dep] = depResult.output
            }
          }

          // Add dynamic results if collecting
          let dynResults: unknown[] | undefined
          if (task.collectDynamic) {
            // Find the dynamic parent task
            for (const dep of task.dependencies) {
              if (dynamicResults.has(dep)) {
                dynResults = dynamicResults.get(dep)
              }
            }
          }

          const context: TaskContext = {
            runId,
            dagId: dag.id,
            upstreamResults,
            triggerPayload: mergedOptions?.triggerPayload,
            dynamicResults: dynResults,
          }

          const result = await executeTask(task, context, mergedOptions)
          run.taskResults.set(task.id, result)

          // Save to state store if available
          if (mergedOptions?.stateStore) {
            await mergedOptions.stateStore.updateTask(runId, task.id, result)
          }

          running.delete(task.id)

          if (result.status === 'success') {
            completed.add(task.id)

            // Handle dynamic task expansion
            if (task.dynamic) {
              // Get the upstream result to expand from (first dependency's output)
              const upstreamOutput = task.dependencies.length > 0
                ? upstreamResults[task.dependencies[0]!]
                : result.output

              // Support async expand functions
              let expandedTasks = await Promise.resolve(task.dynamic.expand(upstreamOutput, context))

              // Apply max expansion limit
              if (task.dynamic.maxExpansion) {
                expandedTasks = expandedTasks.slice(0, task.dynamic.maxExpansion)
              }

              const expandedResults: unknown[] = []

              // Mark expanded tasks with their parent
              for (const expandedTask of expandedTasks) {
                // Add expandedFrom to track origin
                const markedTask = {
                  ...expandedTask,
                  expandedFrom: task.id,
                }

                // Strip dynamic generator from nested tasks unless allowNested is true
                if (!task.dynamic.allowNested && markedTask.dynamic) {
                  delete markedTask.dynamic
                }

                dynamicTasks.set(markedTask.id, markedTask)
                run.taskResults.set(markedTask.id, {
                  taskId: markedTask.id,
                  status: 'pending',
                  attempts: 0,
                })
              }

              // Store reference for fan-in collection
              dynamicResults.set(task.id, expandedResults)

              // Execute dynamic tasks and collect results
              // Handle nested dynamic expansion recursively
              const executeExpandedTask = async (expandedTask: TaskNode): Promise<void> => {
                // Resolve dynamic dependencies if present
                let resolvedDeps = expandedTask.dependencies
                if (expandedTask.dynamicDependencies) {
                  const dynamicCtx: TaskContext = {
                    runId,
                    dagId: dag.id,
                    upstreamResults: {},
                  }
                  resolvedDeps = await Promise.resolve(expandedTask.dynamicDependencies.resolve(dynamicCtx))
                }

                // Wait for dynamic dependencies to complete
                const depsComplete = resolvedDeps.every(
                  (dep) => completed.has(dep) || dynamicResults.has(dep)
                )
                if (!depsComplete) {
                  // Re-add to dynamic tasks for later processing
                  return
                }

                const taskContext: TaskContext = {
                  runId,
                  dagId: dag.id,
                  upstreamResults: {},
                }

                // Gather upstream results for expanded task
                for (const dep of resolvedDeps) {
                  const depResult = run.taskResults.get(dep)
                  if (depResult?.status === 'success') {
                    taskContext.upstreamResults![dep] = depResult.output
                  }
                }

                const dynResult = await executeTask(expandedTask, taskContext, mergedOptions)
                run.taskResults.set(expandedTask.id, dynResult)

                if (dynResult.status === 'success') {
                  completed.add(expandedTask.id)
                  expandedResults.push(dynResult.output)

                  // Handle nested dynamic expansion if allowNested is true
                  if (task.dynamic?.allowNested && expandedTask.dynamic) {
                    const nestedOutput = dynResult.output
                    let nestedTasks = await Promise.resolve(
                      expandedTask.dynamic.expand(nestedOutput, taskContext)
                    )

                    if (expandedTask.dynamic.maxExpansion) {
                      nestedTasks = nestedTasks.slice(0, expandedTask.dynamic.maxExpansion)
                    }

                    for (const nestedTask of nestedTasks) {
                      const markedNested = {
                        ...nestedTask,
                        expandedFrom: expandedTask.id,
                      }
                      dynamicTasks.set(markedNested.id, markedNested)
                      run.taskResults.set(markedNested.id, {
                        taskId: markedNested.id,
                        status: 'pending',
                        attempts: 0,
                      })
                    }

                    // Execute nested tasks
                    for (const nestedTask of nestedTasks) {
                      await executeExpandedTask(nestedTask)
                    }
                  }
                } else {
                  failed.add(expandedTask.id)
                }
              }

              for (const expandedTask of expandedTasks) {
                await executeExpandedTask(dynamicTasks.get(expandedTask.id) || expandedTask)
              }
            }
          } else if (result.status === 'failed') {
            failed.add(task.id)
            skipDownstream(task.id)
          }
        })

        // Wait for at least one task to complete
        if (taskPromises.length > 0) {
          await Promise.race(taskPromises)
        } else {
          // Give other tasks a chance to complete
          await new Promise((resolve) => setTimeout(resolve, 1))
        }
      }

      // Determine final status
      if (run.status !== 'cancelled') {
        run.status = failed.size > 0 ? 'failed' : 'completed'
      }
      run.completedAt = new Date()

      // Save final state
      if (mergedOptions?.stateStore) {
        await mergedOptions.stateStore.saveRun(runId, {
          runId,
          dagId: dag.id,
          status: run.status,
          taskResults: run.taskResults,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
        })
      }

      // Fire completion callbacks
      for (const callback of dagCompleteCallbacks) {
        try {
          await callback(dag.id, run)
        } catch {
          // Ignore callback errors
        }
      }

      return run
    },

    async cancel(): Promise<void> {
      cancelled = true
    },

    pause(): void {
      paused = true
      pausePromise = null
      resumePause = null
    },

    resume(runIdOrVoid?: string, dag?: DAG): Promise<DAGRun> | void {
      // Handle overloaded signature
      if (typeof runIdOrVoid === 'string' && dag) {
        // Resume from checkpoint
        return this.resumeFromCheckpoint(runIdOrVoid, dag)
      }

      // Regular resume from pause
      paused = false
      if (resumePause) {
        resumePause()
        resumePause = null
        pausePromise = null
      }
    },

    async resumeFromCheckpoint(runId: string, dag: DAG): Promise<DAGRun> {
      const mergedOptions = defaultOptions
      const store = mergedOptions?.stateStore
      if (!store) {
        throw new Error('State store required for resume')
      }

      const savedState = await store.loadRun(runId)
      if (!savedState) {
        throw new Error(`Run ${runId} not found`)
      }

      // Create run from saved state
      const run: DAGRun = {
        runId: savedState.runId,
        dagId: savedState.dagId,
        status: 'running',
        taskResults: new Map(savedState.taskResults),
        startedAt: savedState.startedAt,
      }

      const resolver = createDependencyResolver()
      const maxConcurrency = mergedOptions?.maxConcurrency ?? Infinity

      const completed = new Set<string>()
      const failed = new Set<string>()
      const running = new Set<string>()

      // Restore completed/failed from saved state
      for (const [id, result] of run.taskResults) {
        if (result.status === 'success') {
          completed.add(id)
        } else if (result.status === 'failed') {
          failed.add(id)
        }
      }

      // Continue execution
      while (true) {
        const pendingCount = dag.tasks.size - completed.size - failed.size - running.size
        if (pendingCount === 0 && running.size === 0) break

        const ready = resolver.getReadyTasks(dag, completed).filter(
          (t) => !failed.has(t.id) && !running.has(t.id)
        )

        if (ready.length === 0 && running.size === 0) break

        const toStart = ready.slice(0, maxConcurrency - running.size)

        const taskPromises = toStart.map(async (task) => {
          running.add(task.id)

          const upstreamResults: Record<string, unknown> = {}
          for (const dep of task.dependencies) {
            const depResult = run.taskResults.get(dep)
            if (depResult?.status === 'success') {
              upstreamResults[dep] = depResult.output
            }
          }

          const context: TaskContext = {
            runId,
            dagId: dag.id,
            upstreamResults,
          }

          const result = await executeTask(task, context, mergedOptions)
          run.taskResults.set(task.id, result)
          await store.updateTask(runId, task.id, result)

          running.delete(task.id)

          if (result.status === 'success') {
            completed.add(task.id)
          } else if (result.status === 'failed') {
            failed.add(task.id)
          }
        })

        if (taskPromises.length > 0) {
          await Promise.race(taskPromises)
        } else {
          await new Promise((resolve) => setTimeout(resolve, 1))
        }
      }

      run.status = failed.size > 0 ? 'failed' : 'completed'
      run.completedAt = new Date()

      await store.saveRun(runId, {
        runId,
        dagId: dag.id,
        status: run.status,
        taskResults: run.taskResults,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      })

      return run
    },

    onDAGComplete(callback: DAGCompleteCallback): void {
      dagCompleteCallbacks.push(callback)
    },
  } as ParallelExecutor & { resumeFromCheckpoint: (runId: string, dag: DAG) => Promise<DAGRun> }

  return executor
}

// ============================================================================
// STATE STORE FACTORY
// ============================================================================

/** Create an in-memory state store */
export function createInMemoryStateStore(): DAGStateStore {
  const runs = new Map<string, DAGRunState>()

  return {
    async saveRun(runId: string, state: DAGRunState): Promise<void> {
      runs.set(runId, {
        ...state,
        taskResults: new Map(state.taskResults),
      })
    },

    async loadRun(runId: string): Promise<DAGRunState | null> {
      const state = runs.get(runId)
      if (!state) return null
      return {
        ...state,
        taskResults: new Map(state.taskResults),
      }
    },

    async updateTask(runId: string, taskId: string, result: TaskResult): Promise<void> {
      const state = runs.get(runId)
      if (state) {
        state.taskResults.set(taskId, result)
      }
    },

    async listRuns(dagId: string, options?: ListRunsOptions): Promise<DAGRunState[]> {
      const filtered = [...runs.values()].filter((r) => r.dagId === dagId)

      if (options?.status) {
        const statusFiltered = filtered.filter((r) => r.status === options.status)
        return statusFiltered.slice(0, options?.limit)
      }

      return filtered.slice(0, options?.limit)
    },
  }
}

// ============================================================================
// CRON TRIGGER FACTORY
// ============================================================================

/** Day name to number mapping */
const DAY_NAMES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
}

/** Parse a cron expression */
export function parseCronExpression(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error('Invalid cron expression: must have 5 parts')
  }

  const parsePart = (
    part: string,
    min: number,
    max: number
  ): number | '*' | { start: number; end: number } | { step: number } => {
    if (part === '*') return '*'

    // Step pattern: */n
    if (part.startsWith('*/')) {
      const step = parseInt(part.slice(2), 10)
      if (isNaN(step) || step <= 0) {
        throw new Error(`Invalid step value: ${part}`)
      }
      return { step }
    }

    // Range pattern: n-m
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-') as [string, string]
      let start = parseInt(startStr!, 10)
      let end = parseInt(endStr!, 10)

      // Handle day names
      if (isNaN(start) && DAY_NAMES[startStr!.toUpperCase()] !== undefined) {
        start = DAY_NAMES[startStr!.toUpperCase()]!
      }
      if (isNaN(end) && DAY_NAMES[endStr!.toUpperCase()] !== undefined) {
        end = DAY_NAMES[endStr!.toUpperCase()]!
      }

      if (isNaN(start) || isNaN(end) || start < min || end > max) {
        throw new Error(`Invalid range: ${part}`)
      }
      return { start, end }
    }

    // Single value
    let value = parseInt(part, 10)
    if (isNaN(value) && DAY_NAMES[part.toUpperCase()] !== undefined) {
      value = DAY_NAMES[part.toUpperCase()]!
    }
    if (isNaN(value) || value < min || value > max) {
      throw new Error(`Invalid value: ${part} (must be ${min}-${max})`)
    }
    return value
  }

  return {
    minute: parsePart(parts[0]!, 0, 59),
    hour: parsePart(parts[1]!, 0, 23),
    dayOfMonth: parsePart(parts[2]!, 1, 31),
    month: parsePart(parts[3]!, 1, 12),
    dayOfWeek: parsePart(parts[4]!, 0, 6),
  }
}

/** Create a cron trigger */
export function createCronTrigger(expression: string, options?: CronTriggerOptions): CronTrigger {
  const parsed = parseCronExpression(expression)
  const opts = options ?? {}

  const getNextValue = (
    current: number,
    spec: number | '*' | { start: number; end: number } | { step: number },
    min: number,
    max: number
  ): { value: number; wrapped: boolean } => {
    if (spec === '*') {
      return { value: current, wrapped: false }
    }

    if (typeof spec === 'number') {
      if (current <= spec) {
        return { value: spec, wrapped: false }
      }
      return { value: spec, wrapped: true }
    }

    if ('step' in spec) {
      const next = Math.ceil(current / spec.step) * spec.step
      if (next <= max) {
        return { value: next, wrapped: false }
      }
      return { value: 0, wrapped: true }
    }

    if ('start' in spec && 'end' in spec) {
      if (current >= spec.start && current <= spec.end) {
        return { value: current, wrapped: false }
      }
      if (current < spec.start) {
        return { value: spec.start, wrapped: false }
      }
      return { value: spec.start, wrapped: true }
    }

    return { value: current, wrapped: false }
  }

  return {
    expression,
    options: opts,

    getNextRun(from: Date): Date {
      // Adjust for timezone
      let date = new Date(from)
      if (opts.timezone) {
        // Simple timezone offset (for production, use a proper library)
        const offset = getTimezoneOffset(opts.timezone, date)
        date = new Date(date.getTime() + offset)
      }

      // Start from next minute
      date = new Date(date)
      date.setUTCSeconds(0)
      date.setUTCMilliseconds(0)
      date.setUTCMinutes(date.getUTCMinutes() + 1)

      // Iterate to find next match (max 366 days)
      for (let i = 0; i < 366 * 24 * 60; i++) {
        const minute = date.getUTCMinutes()
        const hour = date.getUTCHours()
        const dayOfMonth = date.getUTCDate()
        const month = date.getUTCMonth() + 1
        const dayOfWeek = date.getUTCDay()

        // Check if current time matches
        if (
          matchesCronPart(minute, parsed.minute) &&
          matchesCronPart(hour, parsed.hour) &&
          matchesCronPart(dayOfMonth, parsed.dayOfMonth) &&
          matchesCronPart(month, parsed.month) &&
          matchesCronPart(dayOfWeek, parsed.dayOfWeek)
        ) {
          // Convert back from timezone
          if (opts.timezone) {
            const offset = getTimezoneOffset(opts.timezone, date)
            return new Date(date.getTime() - offset)
          }
          return date
        }

        // Advance by one minute
        date.setUTCMinutes(date.getUTCMinutes() + 1)
      }

      throw new Error('Could not find next run time')
    },

    getMissedRuns(lastRun: Date, now: Date): Date[] {
      if (!opts.catchup) return []

      const missed: Date[] = []
      let current = new Date(lastRun)

      while (true) {
        const next = this.getNextRun(current)
        if (next >= now) break
        missed.push(next)
        current = next
      }

      return missed
    },
  }
}

/** Check if a value matches a cron part spec */
function matchesCronPart(
  value: number,
  spec: number | '*' | { start: number; end: number } | { step: number }
): boolean {
  if (spec === '*') return true
  if (typeof spec === 'number') return value === spec
  if ('step' in spec) return value % spec.step === 0
  if ('start' in spec && 'end' in spec) return value >= spec.start && value <= spec.end
  return false
}

/** Get timezone offset in milliseconds */
function getTimezoneOffset(timezone: string, date: Date): number {
  // Simple implementation for common timezones
  // In production, use Intl.DateTimeFormat or a library like date-fns-tz
  const offsets: Record<string, number> = {
    'America/New_York': -5 * 60 * 60 * 1000, // EST (simplified, doesn't handle DST)
    'America/Los_Angeles': -8 * 60 * 60 * 1000,
    'Europe/London': 0,
    UTC: 0,
  }
  return offsets[timezone] ?? 0
}

// ============================================================================
// SENSOR FACTORY
// ============================================================================

/** Create a sensor */
export function createSensor(options: SensorOptions): Sensor {
  return {
    id: options.id,

    async wait(): Promise<boolean> {
      const startTime = Date.now()

      while (Date.now() - startTime < options.timeout) {
        const result = await options.poke()
        if (result) return true
        await new Promise((resolve) => setTimeout(resolve, options.interval))
      }

      throw new Error(`Sensor ${options.id} timeout after ${options.timeout}ms`)
    },
  }
}

// ============================================================================
// DAG SCHEDULE MANAGER
// ============================================================================

export {
  createDAGScheduleManager,
  createDAGScheduleEveryProxy,
  type DAGScheduleManager,
  type DAGScheduleManagerConfig,
  type ScheduledDAG,
  type RegisterOptions,
  type ScheduledRunResult,
  type ScheduledRunEvent,
  type DAGScheduleBuilder,
  type DAGScheduleTimeProxy,
  type DAGScheduleEveryProxy,
} from './schedule-manager'

// ============================================================================
// CROSS-DAG DEPENDENCIES AND ORCHESTRATION
// ============================================================================

/** Dataset definition for dataset-based triggers */
export interface Dataset {
  id: string
  location: string
  partitions?: Record<string, string>
  metadata?: Record<string, unknown>
}

/** Dataset event types */
export type DatasetEventType = 'created' | 'updated' | 'deleted' | 'partition_added'

/** Dataset event */
export interface DatasetEvent {
  type: DatasetEventType
  dataset: Dataset
  timestamp: Date
  partition?: Record<string, string>
}

/** Dataset trigger configuration */
export interface DatasetTrigger {
  type: 'dataset'
  datasets: string[]
  condition?: 'all' | 'any'
  filter?: (event: DatasetEvent) => boolean
}

/** Cross-DAG shared state */
export interface CrossDAGState {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T, ttl?: number): Promise<void>
  delete(key: string): Promise<void>
  getDAGResult(dagId: string, runId?: string): Promise<DAGRun | undefined>
  setDAGResult(dagId: string, runId: string, result: DAGRun): Promise<void>
}

/** DAG registry for managing multiple DAGs */
export interface DAGRegistry {
  register(dag: DAG): void
  unregister(dagId: string): void
  get(dagId: string): DAG | undefined
  getAll(): DAG[]
  getDependents(dagId: string): DAG[]
  getDependencies(dagId: string): string[]
  validateDependencies(): void
}

/** DAG orchestrator for coordinating cross-DAG execution */
export interface DAGOrchestrator {
  registry: DAGRegistry
  state: CrossDAGState
  executor: ParallelExecutor
  trigger(dagId: string, payload?: unknown): Promise<DAGRun>
  triggerDataset(event: DatasetEvent): Promise<DAGRun[]>
  getRunHistory(dagId: string, limit?: number): Promise<DAGRun[]>
  waitForDAG(dagId: string, condition?: ExternalDependency['condition']): Promise<DAGRun>
  onDAGComplete(callback: DAGCompleteCallback): void
}

/** External DAG sensor - waits for another DAG to complete */
export interface ExternalDAGSensor extends Sensor {
  dagId: string
  taskId?: string
  condition: ExternalDependency['condition']
  getResult(): DAGRun | undefined
}

/** Options for creating an external DAG sensor */
export interface ExternalDAGSensorOptions {
  orchestrator: DAGOrchestrator
  dependency: ExternalDependency
  interval?: number
  timeout?: number
}

/** Create an external DAG sensor that waits for another DAG */
export function createExternalDAGSensor(options: ExternalDAGSensorOptions): ExternalDAGSensor {
  const { orchestrator, dependency, interval = 1000, timeout = 3600000 } = options
  let lastResult: DAGRun | undefined

  return {
    id: `dag-sensor-${dependency.dagId}${dependency.taskId ? `-${dependency.taskId}` : ''}`,
    dagId: dependency.dagId,
    taskId: dependency.taskId,
    condition: dependency.condition ?? 'success',

    async wait(): Promise<boolean> {
      const startTime = Date.now()
      const condition = dependency.condition ?? 'success'

      while (Date.now() - startTime < timeout) {
        // Check for latest run of the target DAG
        const runs = await orchestrator.getRunHistory(dependency.dagId, 1)
        const run = runs[0]

        if (run) {
          // Check if specific task condition is met
          if (dependency.taskId) {
            const taskResult = run.taskResults.get(dependency.taskId)
            if (taskResult) {
              const meetsCondition =
                condition === 'any' ||
                (condition === 'completed' && (taskResult.status === 'success' || taskResult.status === 'failed')) ||
                (condition === 'success' && taskResult.status === 'success')

              if (meetsCondition) {
                lastResult = run
                return true
              }
            }
          } else {
            // Check DAG-level condition
            const meetsCondition =
              condition === 'any' ||
              (condition === 'completed' && (run.status === 'completed' || run.status === 'failed')) ||
              (condition === 'success' && run.status === 'completed')

            if (meetsCondition) {
              lastResult = run
              return true
            }
          }
        }

        await new Promise((resolve) => setTimeout(resolve, interval))
      }

      throw new Error(`External DAG sensor timeout waiting for ${dependency.dagId}`)
    },

    getResult(): DAGRun | undefined {
      return lastResult
    },
  }
}

/** Create an in-memory cross-DAG state store */
export function createCrossDAGState(): CrossDAGState {
  const store = new Map<string, { value: unknown; expiresAt?: number }>()
  const dagResults = new Map<string, Map<string, DAGRun>>()

  return {
    async get<T>(key: string): Promise<T | undefined> {
      const entry = store.get(key)
      if (!entry) return undefined
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        store.delete(key)
        return undefined
      }
      return entry.value as T
    },

    async set<T>(key: string, value: T, ttl?: number): Promise<void> {
      store.set(key, {
        value,
        expiresAt: ttl ? Date.now() + ttl : undefined,
      })
    },

    async delete(key: string): Promise<void> {
      store.delete(key)
    },

    async getDAGResult(dagId: string, runId?: string): Promise<DAGRun | undefined> {
      const dagRuns = dagResults.get(dagId)
      if (!dagRuns) return undefined
      if (runId) return dagRuns.get(runId)
      // Return most recent run
      let latest: DAGRun | undefined
      for (const run of dagRuns.values()) {
        if (!latest || run.startedAt > latest.startedAt) {
          latest = run
        }
      }
      return latest
    },

    async setDAGResult(dagId: string, runId: string, result: DAGRun): Promise<void> {
      let dagRuns = dagResults.get(dagId)
      if (!dagRuns) {
        dagRuns = new Map()
        dagResults.set(dagId, dagRuns)
      }
      dagRuns.set(runId, result)
    },
  }
}

/** Create a DAG registry */
export function createDAGRegistry(): DAGRegistry {
  const dags = new Map<string, DAG>()

  const registry: DAGRegistry = {
    register(dag: DAG): void {
      dags.set(dag.id, dag)
    },

    unregister(dagId: string): void {
      dags.delete(dagId)
    },

    get(dagId: string): DAG | undefined {
      return dags.get(dagId)
    },

    getAll(): DAG[] {
      return [...dags.values()]
    },

    getDependents(dagId: string): DAG[] {
      const dependents: DAG[] = []
      for (const dag of dags.values()) {
        for (const trigger of dag.triggers ?? []) {
          if (trigger.type === 'dag-complete' && trigger.source.dagId === dagId) {
            dependents.push(dag)
            break
          }
        }
      }
      return dependents
    },

    getDependencies(dagId: string): string[] {
      const dag = dags.get(dagId)
      if (!dag) return []
      const deps: string[] = []
      for (const trigger of dag.triggers ?? []) {
        if (trigger.type === 'dag-complete') {
          deps.push(trigger.source.dagId)
        }
      }
      return deps
    },

    validateDependencies(): void {
      validateDAGDependencies([...dags.values()])
    },
  }

  return registry
}

/** Validate cross-DAG dependencies for cycles */
export function validateDAGDependencies(dags: DAG[]): void {
  const dagMap = new Map(dags.map((d) => [d.id, d]))
  const visited = new Set<string>()
  const recursionStack = new Set<string>()
  const cyclePath: string[] = []

  function detectCycle(dagId: string, path: string[]): boolean {
    visited.add(dagId)
    recursionStack.add(dagId)

    const dag = dagMap.get(dagId)
    for (const trigger of dag?.triggers ?? []) {
      if (trigger.type === 'dag-complete') {
        const depId = trigger.source.dagId
        if (!visited.has(depId)) {
          if (detectCycle(depId, [...path, depId])) {
            return true
          }
        } else if (recursionStack.has(depId)) {
          // Found cycle - build the cycle path
          const cycleStart = path.indexOf(depId)
          if (cycleStart >= 0) {
            cyclePath.push(...path.slice(cycleStart), depId)
          } else {
            cyclePath.push(...path, depId)
          }
          return true
        }
      }
    }

    recursionStack.delete(dagId)
    return false
  }

  for (const dag of dags) {
    if (!visited.has(dag.id)) {
      if (detectCycle(dag.id, [dag.id])) {
        throw new Error(`Circular DAG dependency detected: ${cyclePath.join(' -> ')}`)
      }
    }
  }
}

/** Options for creating a DAG orchestrator */
export interface DAGOrchestratorOptions {
  executor?: ParallelExecutor
  state?: CrossDAGState
  registry?: DAGRegistry
}

/** Create a DAG orchestrator */
export function createDAGOrchestrator(options?: DAGOrchestratorOptions): DAGOrchestrator {
  const registry = options?.registry ?? createDAGRegistry()
  const state = options?.state ?? createCrossDAGState()
  const executor = options?.executor ?? createParallelExecutor()

  const dagCompleteCallbacks: DAGCompleteCallback[] = []
  const datasetSubscriptions = new Map<string, DAG[]>()

  // Wire up the executor's onDAGComplete to trigger dependent DAGs
  executor.onDAGComplete(async (dagId, result) => {
    // Store the result
    await state.setDAGResult(dagId, result.runId, result)

    // Trigger all dependent DAGs
    const dependents = registry.getDependents(dagId)
    for (const dependent of dependents) {
      const trigger = dependent.triggers?.find(
        (t) => t.type === 'dag-complete' && t.source.dagId === dagId
      )
      if (trigger) {
        const payload = trigger.payload?.(result)
        // Execute dependent DAG
        await executor.execute(dependent, { triggerPayload: payload })
      }
    }

    // Fire user callbacks
    for (const callback of dagCompleteCallbacks) {
      try {
        await callback(dagId, result)
      } catch {
        // Ignore callback errors
      }
    }
  })

  const orchestrator: DAGOrchestrator = {
    registry,
    state,
    executor,

    async trigger(dagId: string, payload?: unknown): Promise<DAGRun> {
      const dag = registry.get(dagId)
      if (!dag) {
        throw new Error(`DAG ${dagId} not found in registry`)
      }
      const result = await executor.execute(dag, { triggerPayload: payload })
      await state.setDAGResult(dagId, result.runId, result)
      return result
    },

    async triggerDataset(event: DatasetEvent): Promise<DAGRun[]> {
      const results: DAGRun[] = []
      const subscribedDags = datasetSubscriptions.get(event.dataset.id) ?? []

      for (const dag of subscribedDags) {
        // Check if this DAG has a dataset trigger that matches
        const datasetTrigger = dag.triggers?.find(
          (t): t is DAGTrigger & { dataset?: DatasetTrigger } =>
            'dataset' in t &&
            (t as DAGTrigger & { dataset?: DatasetTrigger }).dataset?.datasets.includes(event.dataset.id) === true
        )

        if (datasetTrigger) {
          const dsConfig = (datasetTrigger as unknown as { dataset: DatasetTrigger }).dataset
          // Check filter if present
          if (dsConfig.filter && !dsConfig.filter(event)) {
            continue
          }
          const result = await executor.execute(dag, { triggerPayload: event })
          results.push(result)
        }
      }

      return results
    },

    async getRunHistory(dagId: string, limit?: number): Promise<DAGRun[]> {
      const storeWithHistory = state as CrossDAGState & {
        getDAGHistory?: (dagId: string, limit?: number) => Promise<DAGRun[]>
      }

      if (storeWithHistory.getDAGHistory) {
        return storeWithHistory.getDAGHistory(dagId, limit)
      }

      // Fallback - return latest result if available
      const result = await state.getDAGResult(dagId)
      return result ? [result] : []
    },

    async waitForDAG(dagId: string, condition?: ExternalDependency['condition']): Promise<DAGRun> {
      const sensor = createExternalDAGSensor({
        orchestrator,
        dependency: { dagId, condition: condition ?? 'success' },
      })
      await sensor.wait()
      return sensor.getResult()!
    },

    onDAGComplete(callback: DAGCompleteCallback): void {
      dagCompleteCallbacks.push(callback)
    },
  }

  return orchestrator
}

/** Dataset-aware state store with event tracking */
export interface DatasetAwareState extends CrossDAGState {
  registerDataset(dataset: Dataset): void
  emitDatasetEvent(event: DatasetEvent): Promise<void>
  subscribeToDataset(datasetId: string, dag: DAG): void
  unsubscribeFromDataset(datasetId: string, dagId: string): void
  getDataset(datasetId: string): Dataset | undefined
}

/** Create a dataset-aware cross-DAG state store */
export function createDatasetAwareState(): DatasetAwareState {
  const baseState = createCrossDAGState()
  const datasets = new Map<string, Dataset>()
  const subscriptions = new Map<string, Map<string, DAG>>()
  const eventCallbacks: ((event: DatasetEvent) => Promise<void>)[] = []

  return {
    ...baseState,

    registerDataset(dataset: Dataset): void {
      datasets.set(dataset.id, dataset)
    },

    async emitDatasetEvent(event: DatasetEvent): Promise<void> {
      for (const callback of eventCallbacks) {
        try {
          await callback(event)
        } catch {
          // Ignore callback errors
        }
      }
    },

    subscribeToDataset(datasetId: string, dag: DAG): void {
      let dagSubscriptions = subscriptions.get(datasetId)
      if (!dagSubscriptions) {
        dagSubscriptions = new Map()
        subscriptions.set(datasetId, dagSubscriptions)
      }
      dagSubscriptions.set(dag.id, dag)
    },

    unsubscribeFromDataset(datasetId: string, dagId: string): void {
      const dagSubscriptions = subscriptions.get(datasetId)
      if (dagSubscriptions) {
        dagSubscriptions.delete(dagId)
      }
    },

    getDataset(datasetId: string): Dataset | undefined {
      return datasets.get(datasetId)
    },
  }
}

/** Task that waits for an external DAG completion */
export function createExternalDAGTask(
  id: string,
  orchestrator: DAGOrchestrator,
  dependency: ExternalDependency
): TaskNode {
  return createTaskNode({
    id,
    execute: async () => {
      const sensor = createExternalDAGSensor({
        orchestrator,
        dependency,
      })
      await sensor.wait()
      return sensor.getResult()
    },
    dependencies: [],
  })
}

/** Create a dataset sensor task */
export function createDatasetSensorTask(
  id: string,
  datasetId: string,
  state: DatasetAwareState,
  options?: { interval?: number; timeout?: number }
): TaskNode {
  return createTaskNode({
    id,
    execute: async () => {
      const sensor = createSensor({
        id: `dataset-sensor-${datasetId}`,
        poke: async () => {
          const dataset = state.getDataset(datasetId)
          return dataset !== undefined
        },
        interval: options?.interval ?? 1000,
        timeout: options?.timeout ?? 3600000,
      })
      await sensor.wait()
      return state.getDataset(datasetId)
    },
    dependencies: [],
  })
}
