/**
 * Multi-Step Zap Support
 *
 * Enables chaining multiple actions in a single Zap with:
 * - Sequential step execution
 * - Data passing between steps (step output mapping)
 * - Conditional branching (Paths)
 * - Loop actions
 * - Per-step error handling with recovery options
 * - Partial execution state for resumption
 */

import type {
  Bundle,
  ZObject,
  ActionConfig,
  SearchConfig,
} from './types'
import { ZapierError, HaltedError } from './types'

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

/**
 * Step execution status
 */
export type StepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'halted'

/**
 * Error handling strategy for a step
 */
export type ErrorStrategy =
  | 'fail' // Stop execution, mark Zap as failed
  | 'continue' // Log error, continue to next step
  | 'retry' // Retry with exponential backoff
  | 'fallback' // Execute fallback action
  | 'halt' // Stop execution gracefully (HaltedError)

/**
 * Step error configuration
 */
export interface StepErrorConfig {
  strategy: ErrorStrategy
  maxRetries?: number
  retryDelayMs?: number
  fallbackAction?: string
  onError?: (error: Error, context: StepContext) => Promise<ErrorStrategy>
}

/**
 * Condition for conditional branching
 */
export interface BranchCondition {
  field: string
  operator:
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'not_contains'
    | 'greater_than'
    | 'less_than'
    | 'exists'
    | 'not_exists'
    | 'is_true'
    | 'is_false'
    | 'matches_regex'
  value?: unknown
}

/**
 * A branch path in conditional execution
 */
export interface BranchPath {
  name: string
  conditions: BranchCondition[]
  conditionLogic?: 'and' | 'or'
  steps: ZapStep[]
}

/**
 * Loop configuration
 */
export interface LoopConfig {
  type: 'foreach' | 'while' | 'times'
  /** For 'foreach': field containing array to iterate */
  sourceField?: string
  /** For 'while': condition to check before each iteration */
  condition?: BranchCondition
  /** For 'times': number of iterations */
  count?: number
  /** Maximum iterations to prevent infinite loops */
  maxIterations?: number
  /** Current item variable name (default: 'item') */
  itemVariable?: string
  /** Current index variable name (default: 'index') */
  indexVariable?: string
}

/**
 * Data mapping from previous steps
 */
export interface DataMapping {
  /** Source field path (e.g., "step_1.output.id" or "trigger.data.email") */
  source: string
  /** Target field in current step's input */
  target: string
  /** Optional transformation function */
  transform?: (value: unknown) => unknown
  /** Default value if source is not found */
  defaultValue?: unknown
}

/**
 * A step in a multi-step Zap
 */
export interface ZapStep {
  id: string
  name: string
  type: 'action' | 'search' | 'filter' | 'delay' | 'path' | 'loop' | 'code'

  /** For action/search steps */
  actionKey?: string
  searchKey?: string

  /** Input field mappings from previous steps */
  inputMappings?: DataMapping[]

  /** Static input data */
  staticInput?: Record<string, unknown>

  /** Error handling configuration */
  errorHandling?: StepErrorConfig

  /** For filter steps - conditions that must pass */
  filterConditions?: BranchCondition[]
  filterLogic?: 'and' | 'or'

  /** For delay steps - delay in milliseconds */
  delayMs?: number

  /** For path (branching) steps */
  paths?: BranchPath[]
  defaultPath?: string

  /** For loop steps */
  loopConfig?: LoopConfig
  loopSteps?: ZapStep[]

  /** For code steps - custom function */
  codeFunction?: (z: ZObject, bundle: Bundle, context: StepContext) => Promise<unknown>

  /** Whether this step should continue on filter fail */
  continueOnFilterFail?: boolean
}

/**
 * Step execution result
 */
export interface StepResult {
  stepId: string
  status: StepStatus
  output?: unknown
  error?: Error
  startedAt: number
  completedAt?: number
  retryCount?: number
  skippedReason?: string
  /** For loop steps, individual iteration results */
  iterationResults?: StepResult[]
  /** For path steps, which path was taken */
  pathTaken?: string
}

/**
 * Context available to each step during execution
 */
export interface StepContext {
  /** Results from all previous steps */
  stepResults: Map<string, StepResult>
  /** Trigger data */
  triggerData: Record<string, unknown>
  /** Current step index */
  currentStepIndex: number
  /** Total steps count */
  totalSteps: number
  /** Loop context (if inside a loop) */
  loopContext?: {
    currentItem: unknown
    currentIndex: number
    totalItems: number
    parentStepId: string
  }
  /** Auth data */
  authData: Record<string, unknown>
  /** Zap metadata */
  zapMeta: {
    id: string
    name?: string
    runId: string
    startedAt: number
  }
}

/**
 * Multi-step Zap configuration
 */
export interface MultiStepZapConfig {
  id: string
  name: string
  triggerKey: string
  steps: ZapStep[]
  /** Global error handling (default for all steps) */
  defaultErrorHandling?: StepErrorConfig
  /** Maximum execution time in ms (default: 30000) */
  maxExecutionTime?: number
  /** Whether to save partial state for resumption */
  enablePartialState?: boolean
}

/**
 * Zap execution state for resumption
 */
export interface ZapExecutionState {
  zapId: string
  runId: string
  status: 'running' | 'completed' | 'failed' | 'halted' | 'paused'
  currentStepIndex: number
  stepResults: Array<{
    stepId: string
    status: StepStatus
    output?: unknown
    error?: string
  }>
  triggerData: Record<string, unknown>
  authData: Record<string, unknown>
  startedAt: number
  updatedAt: number
  error?: string
}

/**
 * Zap execution result
 */
export interface ZapExecutionResult {
  zapId: string
  runId: string
  status: 'completed' | 'failed' | 'halted' | 'paused'
  stepResults: StepResult[]
  output?: unknown
  error?: Error
  startedAt: number
  completedAt: number
  partialState?: ZapExecutionState
}

// ============================================================================
// STEP EXECUTION ERROR
// ============================================================================

/**
 * Error thrown during step execution
 */
export class StepExecutionError extends ZapierError {
  stepId: string
  stepName: string
  originalError: Error
  retryCount: number

  constructor(
    stepId: string,
    stepName: string,
    originalError: Error,
    retryCount: number = 0
  ) {
    super(`Step "${stepName}" (${stepId}) failed: ${originalError.message}`)
    this.name = 'StepExecutionError'
    this.stepId = stepId
    this.stepName = stepName
    this.originalError = originalError
    this.retryCount = retryCount
  }
}

// ============================================================================
// DATA RESOLVER
// ============================================================================

/**
 * Resolves data mappings from step context
 */
export class DataResolver {
  /**
   * Resolve a single field path from context
   */
  static resolveField(path: string, context: StepContext): unknown {
    const parts = path.split('.')
    const source = parts[0]
    const fieldPath = parts.slice(1)

    let data: unknown

    if (source === 'trigger') {
      data = context.triggerData
    } else if (source === 'loop' && context.loopContext) {
      if (fieldPath[0] === 'item') {
        data = context.loopContext.currentItem
        fieldPath.shift()
      } else if (fieldPath[0] === 'index') {
        return context.loopContext.currentIndex
      }
    } else {
      // Source is a step ID
      const stepResult = context.stepResults.get(source)
      if (!stepResult) return undefined
      data = stepResult.output
    }

    // Navigate nested path
    for (const part of fieldPath) {
      if (data === null || data === undefined) return undefined
      if (typeof data === 'object' && part in (data as Record<string, unknown>)) {
        data = (data as Record<string, unknown>)[part]
      } else {
        return undefined
      }
    }

    return data
  }

  /**
   * Resolve all input mappings for a step
   */
  static resolveInputMappings(
    mappings: DataMapping[],
    staticInput: Record<string, unknown> | undefined,
    context: StepContext
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { ...staticInput }

    for (const mapping of mappings) {
      let value = this.resolveField(mapping.source, context)

      // Apply default if value is undefined
      if (value === undefined && mapping.defaultValue !== undefined) {
        value = mapping.defaultValue
      }

      // Apply transformation
      if (value !== undefined && mapping.transform) {
        value = mapping.transform(value)
      }

      if (value !== undefined) {
        this.setNestedField(result, mapping.target, value)
      }
    }

    return result
  }

  /**
   * Set a nested field value
   */
  private static setNestedField(
    obj: Record<string, unknown>,
    path: string,
    value: unknown
  ): void {
    const parts = path.split('.')
    let current = obj

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }

    current[parts[parts.length - 1]] = value
  }
}

// ============================================================================
// CONDITION EVALUATOR
// ============================================================================

/**
 * Evaluates branch conditions
 */
export class ConditionEvaluator {
  /**
   * Evaluate a single condition
   */
  static evaluateCondition(
    condition: BranchCondition,
    context: StepContext
  ): boolean {
    const fieldValue = DataResolver.resolveField(condition.field, context)

    switch (condition.operator) {
      case 'equals':
        return fieldValue === condition.value

      case 'not_equals':
        return fieldValue !== condition.value

      case 'contains':
        if (typeof fieldValue === 'string' && typeof condition.value === 'string') {
          return fieldValue.includes(condition.value)
        }
        if (Array.isArray(fieldValue)) {
          return fieldValue.includes(condition.value)
        }
        return false

      case 'not_contains':
        if (typeof fieldValue === 'string' && typeof condition.value === 'string') {
          return !fieldValue.includes(condition.value)
        }
        if (Array.isArray(fieldValue)) {
          return !fieldValue.includes(condition.value)
        }
        return true

      case 'greater_than':
        return Number(fieldValue) > Number(condition.value)

      case 'less_than':
        return Number(fieldValue) < Number(condition.value)

      case 'exists':
        return fieldValue !== undefined && fieldValue !== null

      case 'not_exists':
        return fieldValue === undefined || fieldValue === null

      case 'is_true':
        return fieldValue === true || fieldValue === 'true' || fieldValue === 1

      case 'is_false':
        return fieldValue === false || fieldValue === 'false' || fieldValue === 0

      case 'matches_regex':
        if (typeof fieldValue !== 'string' || typeof condition.value !== 'string') {
          return false
        }
        try {
          return new RegExp(condition.value).test(fieldValue)
        } catch {
          return false
        }

      default:
        return false
    }
  }

  /**
   * Evaluate multiple conditions with logic
   */
  static evaluateConditions(
    conditions: BranchCondition[],
    context: StepContext,
    logic: 'and' | 'or' = 'and'
  ): boolean {
    if (conditions.length === 0) return true

    if (logic === 'and') {
      return conditions.every(c => this.evaluateCondition(c, context))
    } else {
      return conditions.some(c => this.evaluateCondition(c, context))
    }
  }
}

// ============================================================================
// MULTI-STEP ZAP EXECUTOR
// ============================================================================

/**
 * Executes multi-step Zaps
 */
export class MultiStepZapExecutor {
  private config: MultiStepZapConfig
  private actions: Record<string, ActionConfig>
  private searches: Record<string, SearchConfig>
  private stateStorage?: {
    save: (state: ZapExecutionState) => Promise<void>
    load: (runId: string) => Promise<ZapExecutionState | undefined>
  }

  constructor(
    config: MultiStepZapConfig,
    actions: Record<string, ActionConfig>,
    searches: Record<string, SearchConfig>,
    stateStorage?: {
      save: (state: ZapExecutionState) => Promise<void>
      load: (runId: string) => Promise<ZapExecutionState | undefined>
    }
  ) {
    this.config = config
    this.actions = actions
    this.searches = searches
    this.stateStorage = stateStorage
  }

  /**
   * Execute the entire Zap
   */
  async execute(
    z: ZObject,
    triggerData: Record<string, unknown>,
    authData: Record<string, unknown>,
    existingRunId?: string
  ): Promise<ZapExecutionResult> {
    const runId = existingRunId || crypto.randomUUID()
    const startedAt = Date.now()
    const stepResults: StepResult[] = []

    // Create execution context
    const context: StepContext = {
      stepResults: new Map(),
      triggerData,
      currentStepIndex: 0,
      totalSteps: this.config.steps.length,
      authData,
      zapMeta: {
        id: this.config.id,
        name: this.config.name,
        runId,
        startedAt,
      },
    }

    // Load existing state if resuming
    if (existingRunId && this.stateStorage) {
      const savedState = await this.stateStorage.load(existingRunId)
      if (savedState) {
        context.currentStepIndex = savedState.currentStepIndex
        for (const sr of savedState.stepResults) {
          if (sr.status === 'completed') {
            context.stepResults.set(sr.stepId, {
              stepId: sr.stepId,
              status: sr.status,
              output: sr.output,
              startedAt: savedState.startedAt,
              completedAt: savedState.updatedAt,
            })
            stepResults.push({
              stepId: sr.stepId,
              status: sr.status,
              output: sr.output,
              startedAt: savedState.startedAt,
              completedAt: savedState.updatedAt,
            })
          }
        }
      }
    }

    try {
      // Execute steps sequentially
      for (let i = context.currentStepIndex; i < this.config.steps.length; i++) {
        const step = this.config.steps[i]
        context.currentStepIndex = i

        // Check execution timeout
        if (this.config.maxExecutionTime) {
          const elapsed = Date.now() - startedAt
          if (elapsed > this.config.maxExecutionTime) {
            throw new ZapierError('Zap execution timeout exceeded')
          }
        }

        // Execute the step
        const result = await this.executeStep(z, step, context)
        stepResults.push(result)
        context.stepResults.set(step.id, result)

        // Save partial state if enabled
        if (this.config.enablePartialState && this.stateStorage) {
          await this.saveState(context, stepResults, 'running')
        }

        // Check if we should stop execution
        if (result.status === 'failed') {
          throw new StepExecutionError(
            step.id,
            step.name,
            result.error || new Error('Unknown error'),
            result.retryCount
          )
        }

        if (result.status === 'halted') {
          return {
            zapId: this.config.id,
            runId,
            status: 'halted',
            stepResults,
            startedAt,
            completedAt: Date.now(),
          }
        }
      }

      // Get final output from last step
      const lastResult = stepResults[stepResults.length - 1]

      return {
        zapId: this.config.id,
        runId,
        status: 'completed',
        stepResults,
        output: lastResult?.output,
        startedAt,
        completedAt: Date.now(),
      }

    } catch (error) {
      // Save failed state
      if (this.config.enablePartialState && this.stateStorage) {
        await this.saveState(context, stepResults, 'failed', error as Error)
      }

      return {
        zapId: this.config.id,
        runId,
        status: 'failed',
        stepResults,
        error: error as Error,
        startedAt,
        completedAt: Date.now(),
        partialState: this.createState(context, stepResults, 'failed', error as Error),
      }
    }
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    z: ZObject,
    step: ZapStep,
    context: StepContext
  ): Promise<StepResult> {
    const startedAt = Date.now()
    const errorConfig = step.errorHandling || this.config.defaultErrorHandling
    let retryCount = 0

    while (true) {
      try {
        let output: unknown
        let status: StepStatus = 'completed'
        let pathTaken: string | undefined
        let iterationResults: StepResult[] | undefined

        switch (step.type) {
          case 'action':
            output = await this.executeAction(z, step, context)
            break

          case 'search':
            output = await this.executeSearch(z, step, context)
            break

          case 'filter':
            const filterPassed = ConditionEvaluator.evaluateConditions(
              step.filterConditions || [],
              context,
              step.filterLogic
            )
            if (!filterPassed) {
              if (step.continueOnFilterFail) {
                status = 'skipped'
                output = null
              } else {
                throw new HaltedError('Filter conditions not met')
              }
            }
            output = { passed: filterPassed }
            break

          case 'delay':
            await this.delay(step.delayMs || 0)
            output = { delayed: step.delayMs }
            break

          case 'path':
            const pathResult = await this.executePath(z, step, context)
            output = pathResult.output
            pathTaken = pathResult.pathTaken
            iterationResults = pathResult.stepResults
            break

          case 'loop':
            const loopResult = await this.executeLoop(z, step, context)
            output = loopResult.output
            iterationResults = loopResult.iterationResults
            break

          case 'code':
            if (step.codeFunction) {
              output = await step.codeFunction(z, this.createBundle(step, context), context)
            }
            break

          default:
            throw new ZapierError(`Unknown step type: ${step.type}`)
        }

        return {
          stepId: step.id,
          status,
          output,
          startedAt,
          completedAt: Date.now(),
          retryCount,
          pathTaken,
          iterationResults,
        }

      } catch (error) {
        // Handle HaltedError specially
        if (error instanceof HaltedError) {
          return {
            stepId: step.id,
            status: 'halted',
            error: error,
            startedAt,
            completedAt: Date.now(),
            retryCount,
            skippedReason: error.message,
          }
        }

        // Determine error strategy
        let strategy = errorConfig?.strategy || 'fail'

        if (errorConfig?.onError) {
          strategy = await errorConfig.onError(error as Error, context)
        }

        switch (strategy) {
          case 'retry':
            const maxRetries = errorConfig?.maxRetries || 3
            if (retryCount < maxRetries) {
              retryCount++
              const delay = (errorConfig?.retryDelayMs || 1000) * Math.pow(2, retryCount - 1)
              await this.delay(delay)
              continue // Retry the step
            }
            // Fall through to fail after max retries

          case 'fail':
            return {
              stepId: step.id,
              status: 'failed',
              error: error as Error,
              startedAt,
              completedAt: Date.now(),
              retryCount,
            }

          case 'continue':
            z.console.log(`Step ${step.id} failed but continuing: ${(error as Error).message}`)
            return {
              stepId: step.id,
              status: 'completed',
              output: { error: (error as Error).message, continued: true },
              startedAt,
              completedAt: Date.now(),
              retryCount,
            }

          case 'fallback':
            if (errorConfig?.fallbackAction && this.actions[errorConfig.fallbackAction]) {
              const fallbackStep: ZapStep = {
                ...step,
                id: `${step.id}_fallback`,
                actionKey: errorConfig.fallbackAction,
                type: 'action',
              }
              return this.executeStep(z, fallbackStep, context)
            }
            return {
              stepId: step.id,
              status: 'failed',
              error: error as Error,
              startedAt,
              completedAt: Date.now(),
              retryCount,
            }

          case 'halt':
            return {
              stepId: step.id,
              status: 'halted',
              error: error as Error,
              startedAt,
              completedAt: Date.now(),
              retryCount,
              skippedReason: (error as Error).message,
            }

          default:
            return {
              stepId: step.id,
              status: 'failed',
              error: error as Error,
              startedAt,
              completedAt: Date.now(),
              retryCount,
            }
        }
      }
    }
  }

  /**
   * Execute an action step
   */
  private async executeAction(
    z: ZObject,
    step: ZapStep,
    context: StepContext
  ): Promise<unknown> {
    if (!step.actionKey) {
      throw new ZapierError(`Action step ${step.id} missing actionKey`)
    }

    const action = this.actions[step.actionKey]
    if (!action) {
      throw new ZapierError(`Action "${step.actionKey}" not found`)
    }

    const bundle = this.createBundle(step, context)
    return action.operation.perform(z, bundle)
  }

  /**
   * Execute a search step
   */
  private async executeSearch(
    z: ZObject,
    step: ZapStep,
    context: StepContext
  ): Promise<unknown> {
    if (!step.searchKey) {
      throw new ZapierError(`Search step ${step.id} missing searchKey`)
    }

    const search = this.searches[step.searchKey]
    if (!search) {
      throw new ZapierError(`Search "${step.searchKey}" not found`)
    }

    const bundle = this.createBundle(step, context)
    return search.operation.perform(z, bundle)
  }

  /**
   * Execute a path (branching) step
   */
  private async executePath(
    z: ZObject,
    step: ZapStep,
    context: StepContext
  ): Promise<{ output: unknown; pathTaken: string; stepResults: StepResult[] }> {
    const paths = step.paths || []
    let selectedPath: BranchPath | undefined

    // Find first matching path
    for (const path of paths) {
      const matches = ConditionEvaluator.evaluateConditions(
        path.conditions,
        context,
        path.conditionLogic
      )
      if (matches) {
        selectedPath = path
        break
      }
    }

    // Use default path if no match
    if (!selectedPath && step.defaultPath) {
      selectedPath = paths.find(p => p.name === step.defaultPath)
    }

    if (!selectedPath) {
      return {
        output: { pathTaken: 'none', skipped: true },
        pathTaken: 'none',
        stepResults: [],
      }
    }

    // Execute steps in the selected path
    const pathResults: StepResult[] = []
    let lastOutput: unknown

    for (const pathStep of selectedPath.steps) {
      const result = await this.executeStep(z, pathStep, context)
      pathResults.push(result)
      context.stepResults.set(pathStep.id, result)
      lastOutput = result.output

      if (result.status === 'failed' || result.status === 'halted') {
        break
      }
    }

    return {
      output: lastOutput,
      pathTaken: selectedPath.name,
      stepResults: pathResults,
    }
  }

  /**
   * Execute a loop step
   */
  private async executeLoop(
    z: ZObject,
    step: ZapStep,
    context: StepContext
  ): Promise<{ output: unknown; iterationResults: StepResult[] }> {
    const loopConfig = step.loopConfig
    if (!loopConfig) {
      throw new ZapierError(`Loop step ${step.id} missing loopConfig`)
    }

    const loopSteps = step.loopSteps || []
    const maxIterations = loopConfig.maxIterations || 100
    const itemVariable = loopConfig.itemVariable || 'item'
    const indexVariable = loopConfig.indexVariable || 'index'

    const allResults: StepResult[] = []
    const outputs: unknown[] = []
    let iteration = 0

    // Determine iteration source
    let items: unknown[] = []

    switch (loopConfig.type) {
      case 'foreach':
        if (loopConfig.sourceField) {
          const source = DataResolver.resolveField(loopConfig.sourceField, context)
          if (Array.isArray(source)) {
            items = source
          } else if (source !== undefined) {
            items = [source]
          }
        }
        break

      case 'times':
        items = Array.from({ length: loopConfig.count || 0 }, (_, i) => i)
        break

      case 'while':
        // For while loops, we'll iterate until condition fails or max reached
        items = Array.from({ length: maxIterations }, (_, i) => i)
        break
    }

    // Execute loop iterations
    for (const item of items) {
      if (iteration >= maxIterations) {
        z.console.log(`Loop ${step.id} hit max iterations (${maxIterations})`)
        break
      }

      // For while loops, check condition first
      if (loopConfig.type === 'while' && loopConfig.condition) {
        // Create temporary context with loop vars for condition check
        const conditionPasses = ConditionEvaluator.evaluateCondition(
          loopConfig.condition,
          context
        )
        if (!conditionPasses) {
          break
        }
      }

      // Set loop context
      const previousLoopContext = context.loopContext
      context.loopContext = {
        currentItem: item,
        currentIndex: iteration,
        totalItems: items.length,
        parentStepId: step.id,
      }

      // Execute loop body steps
      let iterationOutput: unknown
      for (const loopStep of loopSteps) {
        const result = await this.executeStep(z, loopStep, context)
        allResults.push(result)

        // Store with iteration-prefixed ID
        context.stepResults.set(`${loopStep.id}_iter_${iteration}`, result)
        iterationOutput = result.output

        if (result.status === 'failed' || result.status === 'halted') {
          // Restore loop context and exit
          context.loopContext = previousLoopContext
          return { output: outputs, iterationResults: allResults }
        }
      }

      outputs.push(iterationOutput)
      iteration++

      // Restore previous loop context
      context.loopContext = previousLoopContext
    }

    return { output: outputs, iterationResults: allResults }
  }

  /**
   * Create a bundle for step execution
   */
  private createBundle(step: ZapStep, context: StepContext): Bundle {
    const inputData = DataResolver.resolveInputMappings(
      step.inputMappings || [],
      step.staticInput,
      context
    )

    return {
      inputData,
      authData: context.authData,
      meta: {
        zap: {
          id: context.zapMeta.id,
          name: context.zapMeta.name,
        },
      },
    }
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Save execution state
   */
  private async saveState(
    context: StepContext,
    results: StepResult[],
    status: ZapExecutionState['status'],
    error?: Error
  ): Promise<void> {
    if (!this.stateStorage) return

    const state = this.createState(context, results, status, error)
    await this.stateStorage.save(state)
  }

  /**
   * Create state object
   */
  private createState(
    context: StepContext,
    results: StepResult[],
    status: ZapExecutionState['status'],
    error?: Error
  ): ZapExecutionState {
    return {
      zapId: context.zapMeta.id,
      runId: context.zapMeta.runId,
      status,
      currentStepIndex: context.currentStepIndex,
      stepResults: results.map(r => ({
        stepId: r.stepId,
        status: r.status,
        output: r.output,
        error: r.error?.message,
      })),
      triggerData: context.triggerData,
      authData: context.authData,
      startedAt: context.zapMeta.startedAt,
      updatedAt: Date.now(),
      error: error?.message,
    }
  }
}

// ============================================================================
// MULTI-STEP ZAP BUILDER
// ============================================================================

/**
 * Fluent builder for creating multi-step Zaps
 */
export class MultiStepZapBuilder {
  private config: Partial<MultiStepZapConfig> = {
    steps: [],
  }

  id(id: string): this {
    this.config.id = id
    return this
  }

  name(name: string): this {
    this.config.name = name
    return this
  }

  trigger(triggerKey: string): this {
    this.config.triggerKey = triggerKey
    return this
  }

  step(step: ZapStep): this {
    this.config.steps!.push(step)
    return this
  }

  action(
    id: string,
    name: string,
    actionKey: string,
    options?: {
      inputMappings?: DataMapping[]
      staticInput?: Record<string, unknown>
      errorHandling?: StepErrorConfig
    }
  ): this {
    this.config.steps!.push({
      id,
      name,
      type: 'action',
      actionKey,
      ...options,
    })
    return this
  }

  search(
    id: string,
    name: string,
    searchKey: string,
    options?: {
      inputMappings?: DataMapping[]
      staticInput?: Record<string, unknown>
    }
  ): this {
    this.config.steps!.push({
      id,
      name,
      type: 'search',
      searchKey,
      ...options,
    })
    return this
  }

  filter(
    id: string,
    name: string,
    conditions: BranchCondition[],
    options?: {
      logic?: 'and' | 'or'
      continueOnFail?: boolean
    }
  ): this {
    this.config.steps!.push({
      id,
      name,
      type: 'filter',
      filterConditions: conditions,
      filterLogic: options?.logic,
      continueOnFilterFail: options?.continueOnFail,
    })
    return this
  }

  delay(id: string, name: string, delayMs: number): this {
    this.config.steps!.push({
      id,
      name,
      type: 'delay',
      delayMs,
    })
    return this
  }

  path(id: string, name: string, paths: BranchPath[], defaultPath?: string): this {
    this.config.steps!.push({
      id,
      name,
      type: 'path',
      paths,
      defaultPath,
    })
    return this
  }

  loop(
    id: string,
    name: string,
    loopConfig: LoopConfig,
    loopSteps: ZapStep[]
  ): this {
    this.config.steps!.push({
      id,
      name,
      type: 'loop',
      loopConfig,
      loopSteps,
    })
    return this
  }

  code(
    id: string,
    name: string,
    fn: (z: ZObject, bundle: Bundle, context: StepContext) => Promise<unknown>
  ): this {
    this.config.steps!.push({
      id,
      name,
      type: 'code',
      codeFunction: fn,
    })
    return this
  }

  defaultErrorHandling(config: StepErrorConfig): this {
    this.config.defaultErrorHandling = config
    return this
  }

  maxExecutionTime(ms: number): this {
    this.config.maxExecutionTime = ms
    return this
  }

  enablePartialState(enabled: boolean = true): this {
    this.config.enablePartialState = enabled
    return this
  }

  build(): MultiStepZapConfig {
    if (!this.config.id) throw new Error('Zap id is required')
    if (!this.config.name) throw new Error('Zap name is required')
    if (!this.config.triggerKey) throw new Error('Zap trigger is required')
    if (!this.config.steps || this.config.steps.length === 0) {
      throw new Error('Zap must have at least one step')
    }

    return this.config as MultiStepZapConfig
  }
}

/**
 * Start building a multi-step Zap
 */
export function multiStepZap(): MultiStepZapBuilder {
  return new MultiStepZapBuilder()
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a data mapping
 */
export function mapData(
  source: string,
  target: string,
  options?: {
    transform?: (value: unknown) => unknown
    defaultValue?: unknown
  }
): DataMapping {
  return {
    source,
    target,
    transform: options?.transform,
    defaultValue: options?.defaultValue,
  }
}

/**
 * Create a branch condition
 */
export function condition(
  field: string,
  operator: BranchCondition['operator'],
  value?: unknown
): BranchCondition {
  return { field, operator, value }
}

/**
 * Create a branch path
 */
export function path(
  name: string,
  conditions: BranchCondition[],
  steps: ZapStep[],
  conditionLogic?: 'and' | 'or'
): BranchPath {
  return { name, conditions, steps, conditionLogic }
}

/**
 * Create a foreach loop config
 */
export function foreachLoop(
  sourceField: string,
  options?: {
    maxIterations?: number
    itemVariable?: string
    indexVariable?: string
  }
): LoopConfig {
  return {
    type: 'foreach',
    sourceField,
    ...options,
  }
}

/**
 * Create a times loop config
 */
export function timesLoop(
  count: number,
  options?: {
    maxIterations?: number
  }
): LoopConfig {
  return {
    type: 'times',
    count,
    maxIterations: options?.maxIterations || count,
  }
}

/**
 * Create a while loop config
 */
export function whileLoop(
  conditionConfig: BranchCondition,
  options?: {
    maxIterations?: number
  }
): LoopConfig {
  return {
    type: 'while',
    condition: conditionConfig,
    maxIterations: options?.maxIterations || 100,
  }
}
