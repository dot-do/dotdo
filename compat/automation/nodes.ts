/**
 * Flow Control Nodes - n8n-compatible flow control
 *
 * Implements flow control nodes for workflow automation:
 * - IfNode: Conditional branching
 * - SwitchNode: Multi-way branching
 * - LoopNode: Iteration over items
 * - MergeNode: Combining branches
 * - SplitNode: Splitting arrays
 * - FilterNode: Filtering items
 * - NoOpNode: Pass-through
 * - WaitNode: Delays and waits
 */

// ============================================================================
// TYPES
// ============================================================================

export type ComparisonOperator =
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'regex'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'exists'

export interface Condition {
  field?: string
  operator?: ComparisonOperator
  value?: unknown
  expression?: string
}

export interface ExecutionBranch {
  branch: 'true' | 'false'
  output: unknown
}

export interface NodeOutput {
  data: unknown
  loopIndex?: number
  isFirst?: boolean
  isLast?: boolean
}

// ============================================================================
// IF NODE
// ============================================================================

export interface IfNodeConfig {
  conditions: Condition[]
  combineWith?: 'and' | 'or'
}

export class IfNode {
  readonly conditions: Condition[]
  private combineWith: 'and' | 'or'

  constructor(config: IfNodeConfig) {
    this.conditions = config.conditions
    this.combineWith = config.combineWith ?? 'and'
  }

  async execute(input: unknown): Promise<ExecutionBranch> {
    const result = this.evaluateConditions(input)

    return {
      branch: result ? 'true' : 'false',
      output: input,
    }
  }

  private evaluateConditions(input: unknown): boolean {
    const results = this.conditions.map((condition) =>
      this.evaluateCondition(condition, input)
    )

    if (this.combineWith === 'and') {
      return results.every(Boolean)
    } else {
      return results.some(Boolean)
    }
  }

  private evaluateCondition(condition: Condition, input: unknown): boolean {
    // Expression-based condition
    if (condition.expression) {
      return this.evaluateExpression(condition.expression, input)
    }

    // Field-based condition
    if (!condition.field || !condition.operator) {
      return false
    }

    const fieldValue = this.getValueByPath(input, condition.field)

    return this.compare(fieldValue, condition.operator, condition.value)
  }

  private evaluateExpression(expression: string, input: unknown): boolean {
    // Handle ={{...}} syntax
    let expr = expression
    if (expr.startsWith('={{') && expr.endsWith('}}')) {
      expr = expr.slice(3, -2)
    }

    try {
      const fn = new Function('input', `return ${expr}`)
      return Boolean(fn(input))
    } catch {
      return false
    }
  }

  private compare(
    fieldValue: unknown,
    operator: ComparisonOperator,
    compareValue: unknown
  ): boolean {
    switch (operator) {
      case 'equals':
        return fieldValue === compareValue

      case 'notEquals':
        return fieldValue !== compareValue

      case 'greaterThan':
        return Number(fieldValue) > Number(compareValue)

      case 'greaterThanOrEqual':
        return Number(fieldValue) >= Number(compareValue)

      case 'lessThan':
        return Number(fieldValue) < Number(compareValue)

      case 'lessThanOrEqual':
        return Number(fieldValue) <= Number(compareValue)

      case 'contains':
        return String(fieldValue).includes(String(compareValue))

      case 'notContains':
        return !String(fieldValue).includes(String(compareValue))

      case 'startsWith':
        return String(fieldValue).startsWith(String(compareValue))

      case 'endsWith':
        return String(fieldValue).endsWith(String(compareValue))

      case 'regex':
        try {
          const regex = new RegExp(String(compareValue))
          return regex.test(String(fieldValue))
        } catch {
          return false
        }

      case 'isEmpty':
        return fieldValue === '' || fieldValue === null || fieldValue === undefined

      case 'isNotEmpty':
        return fieldValue !== '' && fieldValue !== null && fieldValue !== undefined

      case 'exists':
        return fieldValue !== undefined

      default:
        return false
    }
  }

  private getValueByPath(obj: unknown, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj

    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      current = (current as Record<string, unknown>)[part]
    }

    return current
  }
}

// ============================================================================
// SWITCH NODE
// ============================================================================

export interface SwitchRule {
  output: number | string
  conditions: Condition[]
}

export interface SwitchNodeConfig {
  rules: SwitchRule[]
  fallbackOutput?: number | string
  mode?: 'first' | 'all'
}

export interface SwitchResult {
  outputIndex?: number
  outputName?: string
  outputs: (number | string)[]
  output: unknown
}

export class SwitchNode {
  readonly rules: SwitchRule[]
  readonly fallbackOutput?: number | string
  private mode: 'first' | 'all'

  constructor(config: SwitchNodeConfig) {
    this.rules = config.rules
    this.fallbackOutput = config.fallbackOutput
    this.mode = config.mode ?? 'first'
  }

  async execute(input: unknown): Promise<SwitchResult> {
    const matchedOutputs: (number | string)[] = []

    for (const rule of this.rules) {
      const ifNode = new IfNode({
        conditions: rule.conditions,
        combineWith: 'and',
      })

      const result = await ifNode.execute(input)

      if (result.branch === 'true') {
        matchedOutputs.push(rule.output)

        if (this.mode === 'first') {
          break
        }
      }
    }

    // Use fallback if no matches
    if (matchedOutputs.length === 0 && this.fallbackOutput !== undefined) {
      matchedOutputs.push(this.fallbackOutput)
    }

    const primaryOutput = matchedOutputs[0]

    return {
      outputIndex: typeof primaryOutput === 'number' ? primaryOutput : undefined,
      outputName: typeof primaryOutput === 'string' ? primaryOutput : undefined,
      outputs: matchedOutputs,
      output: input,
    }
  }
}

// ============================================================================
// LOOP NODE
// ============================================================================

export interface LoopNodeConfig {
  loopOver?: string
  mode?: 'forEach' | 'while'
  condition?: Condition
  batchSize?: number
  maxIterations?: number
  collectResults?: boolean
}

export interface LoopCallbacks {
  onItem?: (output: NodeOutput) => { break?: boolean; continue?: boolean } | Record<string, unknown>
  onBatch?: (output: NodeOutput) => void
}

export interface LoopResult {
  completed: boolean
  iterations: number
  collectedResults?: unknown[]
}

export class LoopNode {
  readonly loopOver?: string
  private config: LoopNodeConfig

  constructor(config: LoopNodeConfig) {
    this.loopOver = config.loopOver
    this.config = config
  }

  async execute(
    input: Record<string, unknown>,
    callbacks: LoopCallbacks
  ): Promise<LoopResult> {
    const mode = this.config.mode ?? 'forEach'

    if (mode === 'while') {
      return this.executeWhile(input, callbacks)
    } else {
      return this.executeForEach(input, callbacks)
    }
  }

  private async executeForEach(
    input: Record<string, unknown>,
    callbacks: LoopCallbacks
  ): Promise<LoopResult> {
    const items = this.getValueByPath(input, this.loopOver!) as unknown[]

    if (!Array.isArray(items)) {
      return { completed: true, iterations: 0 }
    }

    const collectedResults: unknown[] = []
    let iterations = 0

    // Handle batch mode
    if (this.config.batchSize && this.config.batchSize > 1) {
      const batches = this.chunkArray(items, this.config.batchSize)

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i]
        const output: NodeOutput = {
          data: batch,
          loopIndex: i,
          isFirst: i === 0,
          isLast: i === batches.length - 1,
        }

        callbacks.onBatch?.(output)
        iterations++
      }

      return { completed: true, iterations }
    }

    // Handle individual items
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const output: NodeOutput = {
        data: item,
        loopIndex: i,
        isFirst: i === 0,
        isLast: i === items.length - 1,
      }

      const result = callbacks.onItem?.(output)

      // Only check for control flow if result is an object
      if (result && typeof result === 'object' && result !== null) {
        if ('break' in result && (result as { break?: boolean }).break) {
          return { completed: false, iterations, collectedResults }
        }

        if ('continue' in result && (result as { continue?: boolean }).continue) {
          continue
        }
      }

      if (this.config.collectResults && result) {
        collectedResults.push(result)
      }

      iterations++
    }

    return {
      completed: true,
      iterations,
      collectedResults: this.config.collectResults ? collectedResults : undefined,
    }
  }

  private async executeWhile(
    input: Record<string, unknown>,
    callbacks: LoopCallbacks
  ): Promise<LoopResult> {
    const maxIterations = this.config.maxIterations ?? 1000
    let iterations = 0
    let currentInput = input

    const ifNode = new IfNode({
      conditions: this.config.condition ? [this.config.condition] : [],
    })

    while (iterations < maxIterations) {
      const conditionResult = await ifNode.execute(currentInput)

      if (conditionResult.branch !== 'true') {
        break
      }

      const output: NodeOutput = {
        data: currentInput,
        loopIndex: iterations,
        isFirst: iterations === 0,
        isLast: false,
      }

      const result = callbacks.onItem?.(output) as Record<string, unknown> | undefined

      if (result) {
        currentInput = { ...currentInput, ...result }
      }

      iterations++
    }

    return { completed: iterations < maxIterations, iterations }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size))
    }
    return chunks
  }

  private getValueByPath(obj: unknown, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj

    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      current = (current as Record<string, unknown>)[part]
    }

    return current
  }
}

// ============================================================================
// MERGE NODE
// ============================================================================

export type MergeMode = 'wait' | 'combine' | 'append' | 'passThrough' | 'multiplex'

export interface MergeNodeConfig {
  mode: MergeMode
  inputCount?: number
  joinKey?: string
  timeout?: number
}

export interface MergeInput {
  data: unknown
  branch?: string
}

export interface MergeResult {
  ready: boolean
  output?: unknown
  timedOut?: boolean
  missingInputs?: number[]
}

export class MergeNode {
  readonly mode: MergeMode
  private inputCount: number
  private inputs: Map<number, MergeInput> = new Map()
  private timeoutId?: ReturnType<typeof setTimeout>
  private resolveTimeout?: () => void
  private config: MergeNodeConfig
  private passThroughComplete = false

  constructor(config: MergeNodeConfig) {
    this.mode = config.mode
    this.inputCount = config.inputCount ?? 2
    this.config = config
  }

  async addInput(index: number, input: MergeInput): Promise<MergeResult> {
    this.inputs.set(index, input)

    // PassThrough mode returns immediately on first input, ignores subsequent
    if (this.mode === 'passThrough') {
      if (!this.passThroughComplete) {
        this.passThroughComplete = true
        return {
          ready: true,
          output: input.data,
        }
      }
      // Subsequent inputs in passThrough mode are ignored
      return { ready: false }
    }

    // Check if all inputs received
    if (this.inputs.size < this.inputCount) {
      // Start timeout if configured
      if (this.config.timeout && !this.timeoutId) {
        this.startTimeout()
      }

      return { ready: false }
    }

    // Process merge
    return this.merge()
  }

  async getResult(): Promise<MergeResult> {
    // Check for timeout
    if (this.inputs.size < this.inputCount) {
      const missingInputs: number[] = []
      for (let i = 0; i < this.inputCount; i++) {
        if (!this.inputs.has(i)) {
          missingInputs.push(i)
        }
      }

      return {
        ready: false,
        timedOut: true,
        missingInputs,
      }
    }

    return this.merge()
  }

  reset(): void {
    this.inputs.clear()
    this.passThroughComplete = false
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = undefined
    }
  }

  private startTimeout(): void {
    if (!this.config.timeout) return

    this.timeoutId = setTimeout(() => {
      this.resolveTimeout?.()
    }, this.config.timeout)
  }

  private merge(): MergeResult {
    let output: unknown

    switch (this.mode) {
      case 'wait': {
        // Return array of all inputs in order
        const results: unknown[] = []
        for (let i = 0; i < this.inputCount; i++) {
          results.push(this.inputs.get(i)?.data)
        }
        output = results
        break
      }

      case 'combine': {
        // Merge all objects into one
        let combined: Record<string, unknown> = {}
        this.inputs.forEach((input) => {
          if (typeof input.data === 'object' && input.data !== null) {
            combined = { ...combined, ...(input.data as Record<string, unknown>) }
          }
        })
        output = combined
        break
      }

      case 'append': {
        // Concatenate all arrays
        const arrays: unknown[] = []
        this.inputs.forEach((input) => {
          if (Array.isArray(input.data)) {
            arrays.push(...input.data)
          }
        })
        output = arrays
        break
      }

      case 'multiplex': {
        // Join arrays on key
        const joinKey = this.config.joinKey!
        const inputArrays = Array.from(this.inputs.values())
          .map((i) => i.data as unknown[])
          .filter(Array.isArray)

        if (inputArrays.length < 2) {
          output = inputArrays[0] ?? []
          break
        }

        // Build lookup from second array
        const lookup = new Map<unknown, Record<string, unknown>>()
        for (const item of inputArrays[1] as Record<string, unknown>[]) {
          lookup.set(item[joinKey], item)
        }

        // Join with first array
        output = (inputArrays[0] as Record<string, unknown>[]).map((item) => {
          const match = lookup.get(item[joinKey])
          return match ? { ...item, ...match } : item
        })
        break
      }

      default:
        output = this.inputs.get(0)?.data
    }

    return {
      ready: true,
      output,
    }
  }
}

// ============================================================================
// SPLIT NODE
// ============================================================================

export interface SplitNodeConfig {
  splitOn: string
  delimiter?: string
  includeContext?: boolean
}

export interface SplitResult {
  items: unknown[]
}

export class SplitNode {
  private config: SplitNodeConfig

  constructor(config: SplitNodeConfig) {
    this.config = config
  }

  async execute(input: Record<string, unknown>): Promise<SplitResult> {
    const value = this.getValueByPath(input, this.config.splitOn)

    let items: unknown[]

    if (typeof value === 'string' && this.config.delimiter) {
      // Split string by delimiter
      items = value.split(this.config.delimiter)
    } else if (Array.isArray(value)) {
      // Already an array
      items = value
    } else {
      items = []
    }

    // Include context if requested
    if (this.config.includeContext) {
      const context = { ...input }
      delete (context as Record<string, unknown>)[this.config.splitOn]

      items = items.map((item) => ({
        item,
        context,
      }))
    }

    return { items }
  }

  private getValueByPath(obj: unknown, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj

    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      current = (current as Record<string, unknown>)[part]
    }

    return current
  }
}

// ============================================================================
// FILTER NODE
// ============================================================================

export interface FilterNodeConfig {
  conditions: Condition[]
  combineWith?: 'and' | 'or'
  outputFiltered?: boolean
}

export interface FilterResult {
  kept: unknown[]
  filtered?: unknown[]
  passed?: boolean
  output?: unknown
}

export class FilterNode {
  private config: FilterNodeConfig
  private ifNode: IfNode

  constructor(config: FilterNodeConfig) {
    this.config = config
    this.ifNode = new IfNode({
      conditions: config.conditions,
      combineWith: config.combineWith ?? 'and',
    })
  }

  async execute(input: unknown): Promise<FilterResult> {
    // Handle array input
    if (typeof input === 'object' && input !== null && 'items' in input) {
      const items = (input as { items: unknown[] }).items

      const kept: unknown[] = []
      const filtered: unknown[] = []

      for (const item of items) {
        const result = await this.ifNode.execute(item)
        if (result.branch === 'true') {
          kept.push(item)
        } else {
          filtered.push(item)
        }
      }

      return {
        kept,
        filtered: this.config.outputFiltered ? filtered : undefined,
      }
    }

    // Handle single item input
    const result = await this.ifNode.execute(input)

    return {
      kept: result.branch === 'true' ? [input] : [],
      passed: result.branch === 'true',
      output: result.branch === 'true' ? input : undefined,
    }
  }
}

// ============================================================================
// NO-OP NODE
// ============================================================================

export interface NoOpNodeConfig {
  notes?: string
}

export class NoOpNode {
  readonly notes?: string

  constructor(config: NoOpNodeConfig = {}) {
    this.notes = config.notes
  }

  async execute(input: unknown): Promise<{ output: unknown }> {
    return { output: input }
  }
}

// ============================================================================
// WAIT NODE
// ============================================================================

export interface WaitNodeConfig {
  duration?: string
  until?: string
  resumeOn?: 'webhook' | 'event'
  webhookPath?: string
  timeout?: string
}

export interface WaitResult {
  success: boolean
  waitedMs?: number
  timedOut?: boolean
  resumeData?: unknown
}

export class WaitNode {
  private config: WaitNodeConfig
  private resumeResolve?: (data: unknown) => void
  private resumeReject?: (error: Error) => void

  constructor(config: WaitNodeConfig) {
    this.config = config
  }

  getDurationMs(): number {
    if (this.config.duration) {
      return this.parseDuration(this.config.duration)
    }
    return 0
  }

  async execute(_input: unknown): Promise<WaitResult> {
    const startTime = Date.now()

    if (this.config.duration) {
      // Wait for duration
      const ms = this.parseDuration(this.config.duration)
      await this.sleep(ms)

      return {
        success: true,
        waitedMs: Date.now() - startTime,
      }
    }

    if (this.config.until) {
      // Wait until specific time
      const targetTime = new Date(this.config.until).getTime()
      const now = Date.now()
      const delay = Math.max(0, targetTime - now)

      await this.sleep(delay)

      return {
        success: true,
        waitedMs: Date.now() - startTime,
      }
    }

    if (this.config.resumeOn) {
      // Wait for external trigger
      const timeoutMs = this.config.timeout
        ? this.parseDuration(this.config.timeout)
        : undefined

      try {
        const resumeData = await this.waitForResume(timeoutMs)

        return {
          success: true,
          waitedMs: Date.now() - startTime,
          resumeData,
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'timeout') {
          return {
            success: false,
            waitedMs: Date.now() - startTime,
            timedOut: true,
          }
        }
        throw error
      }
    }

    return { success: true, waitedMs: 0 }
  }

  resume(data: unknown): void {
    this.resumeResolve?.(data)
  }

  private waitForResume(timeoutMs?: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.resumeResolve = resolve
      this.resumeReject = reject

      if (timeoutMs) {
        setTimeout(() => {
          reject(new Error('timeout'))
        }, timeoutMs)
      }
    })
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)(ms|s|m|h|d)$/)
    if (!match) {
      throw new Error(`Invalid duration format: ${duration}`)
    }

    const value = parseInt(match[1], 10)
    const unit = match[2]

    switch (unit) {
      case 'ms':
        return value
      case 's':
        return value * 1000
      case 'm':
        return value * 60 * 1000
      case 'h':
        return value * 60 * 60 * 1000
      case 'd':
        return value * 24 * 60 * 60 * 1000
      default:
        return value
    }
  }
}
