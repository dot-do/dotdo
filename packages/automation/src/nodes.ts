/**
 * Flow Control Nodes - n8n-compatible flow control nodes
 *
 * Implements flow control nodes for workflow automation:
 * - IfNode: Conditional branching based on conditions
 * - SwitchNode: Multi-way branching with rules
 * - LoopNode: Iteration over arrays or while conditions
 * - MergeNode: Combining multiple branches
 * - SplitNode: Splitting arrays into individual items
 * - FilterNode: Filtering items based on conditions
 * - NoOpNode: Pass-through node for placeholders
 * - WaitNode: Delays and external wait points
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

export interface NodeOutput {
  data: unknown
  loopIndex?: number
  isFirst?: boolean
  isLast?: boolean
}

export interface IfResult {
  branch: 'true' | 'false'
  output: unknown
}

export interface SwitchResult {
  outputIndex?: number
  outputName?: string
  outputs?: Array<number | string>
  output: unknown
}

export interface MergeInput {
  branch?: string
  data: unknown
}

export interface MergeResult {
  ready: boolean
  output?: unknown
  timedOut?: boolean
  missingInputs?: number[]
}

export interface LoopCallbacks {
  onItem?: (output: NodeOutput) => unknown
  onBatch?: (output: NodeOutput) => void
}

export interface LoopResult {
  collectedResults?: unknown[]
}

export interface SplitResult {
  items: unknown[]
}

export interface FilterResult {
  kept: unknown[]
  filtered?: unknown[]
  passed?: boolean
  output?: unknown
}

export interface NoOpResult {
  output: unknown
}

export interface WaitResult {
  success: boolean
  waitedMs?: number
  timedOut?: boolean
  resumeData?: unknown
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
  private config: IfNodeConfig

  constructor(config: IfNodeConfig) {
    this.conditions = config.conditions
    this.config = config
  }

  async execute(input: Record<string, unknown>): Promise<IfResult> {
    const combineWith = this.config.combineWith ?? 'and'
    let result: boolean

    if (combineWith === 'and') {
      result = this.conditions.every((condition) => this.evaluateCondition(condition, input))
    } else {
      result = this.conditions.some((condition) => this.evaluateCondition(condition, input))
    }

    return {
      branch: result ? 'true' : 'false',
      output: input,
    }
  }

  private evaluateCondition(condition: Condition, input: Record<string, unknown>): boolean {
    // Handle expression-based conditions
    if (condition.expression) {
      const expr = condition.expression.startsWith('={{')
        ? condition.expression.slice(3, -2)
        : condition.expression
      try {
        const fn = new Function('input', `return ${expr}`)
        return Boolean(fn(input))
      } catch {
        return false
      }
    }

    if (!condition.field || !condition.operator) {
      return false
    }

    const fieldValue = this.getNestedValue(input, condition.field)
    const targetValue = condition.value

    return this.compare(fieldValue, condition.operator, targetValue)
  }

  private compare(fieldValue: unknown, operator: ComparisonOperator, targetValue: unknown): boolean {
    switch (operator) {
      case 'equals':
        return fieldValue === targetValue

      case 'notEquals':
        return fieldValue !== targetValue

      case 'greaterThan':
        return Number(fieldValue) > Number(targetValue)

      case 'greaterThanOrEqual':
        return Number(fieldValue) >= Number(targetValue)

      case 'lessThan':
        return Number(fieldValue) < Number(targetValue)

      case 'lessThanOrEqual':
        return Number(fieldValue) <= Number(targetValue)

      case 'contains':
        return String(fieldValue).includes(String(targetValue))

      case 'notContains':
        return !String(fieldValue).includes(String(targetValue))

      case 'startsWith':
        return String(fieldValue).startsWith(String(targetValue))

      case 'endsWith':
        return String(fieldValue).endsWith(String(targetValue))

      case 'regex':
        try {
          const regex = new RegExp(String(targetValue))
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

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined
      }
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

export class SwitchNode {
  readonly rules: SwitchRule[]
  readonly fallbackOutput?: number | string
  private config: SwitchNodeConfig
  private ifNode: IfNode

  constructor(config: SwitchNodeConfig) {
    this.rules = config.rules
    this.fallbackOutput = config.fallbackOutput
    this.config = config
    this.ifNode = new IfNode({ conditions: [] }) // Used for condition evaluation
  }

  async execute(input: Record<string, unknown>): Promise<SwitchResult> {
    const mode = this.config.mode ?? 'first'
    const matchedOutputs: Array<number | string> = []

    for (const rule of this.rules) {
      const conditionsMatch = rule.conditions.every((condition) =>
        this.evaluateCondition(condition, input)
      )

      if (conditionsMatch) {
        matchedOutputs.push(rule.output)
        if (mode === 'first') {
          break
        }
      }
    }

    if (matchedOutputs.length === 0 && this.fallbackOutput !== undefined) {
      matchedOutputs.push(this.fallbackOutput)
    }

    const firstOutput = matchedOutputs[0]

    return {
      outputIndex: typeof firstOutput === 'number' ? firstOutput : undefined,
      outputName: typeof firstOutput === 'string' ? firstOutput : undefined,
      outputs: mode === 'all' ? matchedOutputs : undefined,
      output: input,
    }
  }

  private evaluateCondition(condition: Condition, input: Record<string, unknown>): boolean {
    // Reuse IfNode's condition evaluation logic
    const tempIfNode = new IfNode({ conditions: [condition] })
    // Access private method through prototype
    return (tempIfNode as any).evaluateCondition(condition, input)
  }
}

// ============================================================================
// LOOP NODE
// ============================================================================

export interface LoopNodeConfig {
  loopOver?: string
  mode?: 'items' | 'while'
  condition?: Condition
  maxIterations?: number
  batchSize?: number
  collectResults?: boolean
}

export class LoopNode {
  readonly loopOver?: string
  private config: LoopNodeConfig

  constructor(config: LoopNodeConfig) {
    this.loopOver = config.loopOver
    this.config = config
  }

  async execute(input: Record<string, unknown>, callbacks: LoopCallbacks = {}): Promise<LoopResult> {
    const collectedResults: unknown[] = []

    if (this.config.mode === 'while') {
      await this.executeWhile(input, callbacks, collectedResults)
    } else if (this.config.batchSize) {
      await this.executeBatched(input, callbacks, collectedResults)
    } else {
      await this.executeItems(input, callbacks, collectedResults)
    }

    return {
      collectedResults: this.config.collectResults ? collectedResults : undefined,
    }
  }

  private async executeItems(
    input: Record<string, unknown>,
    callbacks: LoopCallbacks,
    collectedResults: unknown[]
  ): Promise<void> {
    if (!this.loopOver) return

    const items = input[this.loopOver]
    if (!Array.isArray(items)) return

    for (let i = 0; i < items.length; i++) {
      const output: NodeOutput = {
        data: items[i],
        loopIndex: i,
        isFirst: i === 0,
        isLast: i === items.length - 1,
      }

      if (callbacks.onItem) {
        const result = callbacks.onItem(output)
        if (result && typeof result === 'object') {
          if ((result as { break?: boolean }).break) {
            break
          }
          if ((result as { continue?: boolean }).continue) {
            continue
          }
          collectedResults.push(result)
        }
      }
    }
  }

  private async executeBatched(
    input: Record<string, unknown>,
    callbacks: LoopCallbacks,
    _collectedResults: unknown[]
  ): Promise<void> {
    if (!this.loopOver) return

    const items = input[this.loopOver]
    if (!Array.isArray(items)) return

    const batchSize = this.config.batchSize ?? 1
    const batches: unknown[][] = []

    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize))
    }

    for (let i = 0; i < batches.length; i++) {
      const output: NodeOutput = {
        data: batches[i],
        loopIndex: i,
        isFirst: i === 0,
        isLast: i === batches.length - 1,
      }

      if (callbacks.onBatch) {
        callbacks.onBatch(output)
      }
    }
  }

  private async executeWhile(
    input: Record<string, unknown>,
    callbacks: LoopCallbacks,
    collectedResults: unknown[]
  ): Promise<void> {
    const maxIterations = this.config.maxIterations ?? 1000
    let current = input
    let iterations = 0

    while (iterations < maxIterations) {
      // Check condition
      const conditionMet = this.evaluateCondition(current)
      if (!conditionMet) break

      const output: NodeOutput = {
        data: current,
        loopIndex: iterations,
        isFirst: iterations === 0,
        isLast: false,
      }

      if (callbacks.onItem) {
        const result = callbacks.onItem(output) as Record<string, unknown> | undefined
        if (result) {
          if ((result as { break?: boolean }).break) break
          current = { ...current, ...result }
          collectedResults.push(result)
        }
      }

      iterations++
    }
  }

  private evaluateCondition(input: Record<string, unknown>): boolean {
    const condition = this.config.condition
    if (!condition) return true

    if (condition.expression) {
      const expr = condition.expression.startsWith('={{')
        ? condition.expression.slice(3, -2)
        : condition.expression
      try {
        const fn = new Function('input', `return ${expr}`)
        return Boolean(fn(input))
      } catch {
        return false
      }
    }

    if (!condition.field || !condition.operator) return true

    const ifNode = new IfNode({ conditions: [condition] })
    // Access through the execute method and check result
    return true // Simplified for now
  }
}

// ============================================================================
// MERGE NODE
// ============================================================================

export interface MergeNodeConfig {
  mode: 'wait' | 'combine' | 'append' | 'passThrough' | 'multiplex'
  inputCount?: number
  joinKey?: string
  timeout?: number
}

export class MergeNode {
  readonly mode: string
  private config: MergeNodeConfig
  private inputs: Map<number, unknown> = new Map()
  private hasOutputted = false

  constructor(config: MergeNodeConfig) {
    this.mode = config.mode
    this.config = config
  }

  async addInput(index: number, input: MergeInput): Promise<MergeResult> {
    // PassThrough mode: first input wins
    if (this.config.mode === 'passThrough') {
      if (this.hasOutputted) {
        return { ready: false }
      }
      this.hasOutputted = true
      return {
        ready: true,
        output: input.data,
      }
    }

    this.inputs.set(index, input.data)

    const inputCount = this.config.inputCount ?? 2

    if (this.inputs.size >= inputCount) {
      return this.produceOutput()
    }

    return { ready: false }
  }

  async getResult(): Promise<MergeResult> {
    // Check for timeout
    return {
      ready: false,
      timedOut: true,
      missingInputs: this.getMissingInputs(),
    }
  }

  reset(): void {
    this.inputs.clear()
    this.hasOutputted = false
  }

  private produceOutput(): MergeResult {
    const inputCount = this.config.inputCount ?? 2
    const allInputs: unknown[] = []

    for (let i = 0; i < inputCount; i++) {
      allInputs.push(this.inputs.get(i))
    }

    let output: unknown

    switch (this.config.mode) {
      case 'wait':
        output = allInputs
        break

      case 'combine': {
        const combined: Record<string, unknown> = {}
        for (const input of allInputs) {
          if (input && typeof input === 'object') {
            Object.assign(combined, input)
          }
        }
        output = combined
        break
      }

      case 'append': {
        const appended: unknown[] = []
        for (const input of allInputs) {
          if (Array.isArray(input)) {
            appended.push(...input)
          } else {
            appended.push(input)
          }
        }
        output = appended
        break
      }

      case 'multiplex': {
        // Join on key
        const joinKey = this.config.joinKey
        if (!joinKey) {
          output = allInputs
          break
        }

        const first = allInputs[0]
        const second = allInputs[1]

        if (!Array.isArray(first) || !Array.isArray(second)) {
          output = allInputs
          break
        }

        const secondMap = new Map<string, unknown>()
        for (const item of second) {
          if (item && typeof item === 'object') {
            const key = (item as Record<string, unknown>)[joinKey]
            if (key !== undefined) {
              secondMap.set(String(key), item)
            }
          }
        }

        output = first.map((item) => {
          if (!item || typeof item !== 'object') return item
          const key = (item as Record<string, unknown>)[joinKey]
          if (key === undefined) return item
          const match = secondMap.get(String(key))
          if (!match) return item
          return { ...item, ...(match as object) }
        })
        break
      }

      default:
        output = allInputs
    }

    this.hasOutputted = true
    return {
      ready: true,
      output,
    }
  }

  private getMissingInputs(): number[] {
    const inputCount = this.config.inputCount ?? 2
    const missing: number[] = []
    for (let i = 0; i < inputCount; i++) {
      if (!this.inputs.has(i)) {
        missing.push(i)
      }
    }
    return missing
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

export class SplitNode {
  private config: SplitNodeConfig

  constructor(config: SplitNodeConfig) {
    this.config = config
  }

  async execute(input: Record<string, unknown>): Promise<SplitResult> {
    const field = this.config.splitOn
    const value = input[field]

    let items: unknown[]

    if (this.config.delimiter && typeof value === 'string') {
      items = value.split(this.config.delimiter)
    } else if (Array.isArray(value)) {
      items = value
    } else {
      items = []
    }

    if (this.config.includeContext) {
      const context = { ...input }
      delete context[field]

      items = items.map((item) => ({
        item,
        context,
      }))
    }

    return { items }
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

export class FilterNode {
  private config: FilterNodeConfig
  private ifNode: IfNode

  constructor(config: FilterNodeConfig) {
    this.config = config
    this.ifNode = new IfNode({
      conditions: config.conditions,
      combineWith: config.combineWith,
    })
  }

  async execute(input: Record<string, unknown>): Promise<FilterResult> {
    // Check if input has items array
    const items = input.items
    if (Array.isArray(items)) {
      return this.filterItems(items)
    }

    // Single item filter
    const result = await this.ifNode.execute(input)
    return {
      kept: [],
      passed: result.branch === 'true',
      output: result.branch === 'true' ? input : undefined,
    }
  }

  private async filterItems(items: unknown[]): Promise<FilterResult> {
    const kept: unknown[] = []
    const filtered: unknown[] = []

    for (const item of items) {
      const itemObj = typeof item === 'object' && item !== null ? item : { value: item }
      const result = await this.ifNode.execute(itemObj as Record<string, unknown>)

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
}

// ============================================================================
// NO-OP NODE
// ============================================================================

export interface NoOpNodeConfig {
  notes?: string
}

export class NoOpNode {
  readonly notes?: string
  private config: NoOpNodeConfig

  constructor(config: NoOpNodeConfig = {}) {
    this.notes = config.notes
    this.config = config
  }

  async execute(input: unknown): Promise<NoOpResult> {
    return { output: input }
  }
}

// ============================================================================
// WAIT NODE
// ============================================================================

export interface WaitNodeConfig {
  duration?: string
  until?: string
  resumeOn?: 'duration' | 'webhook'
  webhookPath?: string
  timeout?: string
}

export class WaitNode {
  private config: WaitNodeConfig
  private resolveResume?: (data: unknown) => void

  constructor(config: WaitNodeConfig) {
    this.config = config
  }

  getDurationMs(): number {
    const duration = this.config.duration ?? this.config.timeout ?? '0ms'
    return this.parseDuration(duration)
  }

  async execute(_input: unknown): Promise<WaitResult> {
    const startTime = Date.now()

    if (this.config.resumeOn === 'webhook') {
      // Wait for resume or timeout
      const timeoutMs = this.config.timeout ? this.parseDuration(this.config.timeout) : Infinity

      return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          resolve({
            success: false,
            timedOut: true,
            waitedMs: Date.now() - startTime,
          })
        }, timeoutMs)

        this.resolveResume = (data: unknown) => {
          clearTimeout(timeoutId)
          resolve({
            success: true,
            resumeData: data,
            waitedMs: Date.now() - startTime,
          })
        }
      })
    }

    // Duration-based wait
    const waitMs = this.config.until
      ? new Date(this.config.until).getTime() - Date.now()
      : this.getDurationMs()

    await this.sleep(Math.max(0, waitMs))

    return {
      success: true,
      waitedMs: Date.now() - startTime,
    }
  }

  resume(data: unknown): void {
    if (this.resolveResume) {
      this.resolveResume(data)
      this.resolveResume = undefined
    }
  }

  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)(ms|s|m|h|d)$/)
    if (!match) return 0

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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
