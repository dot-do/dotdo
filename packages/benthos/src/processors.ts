/**
 * Benthos Processors
 * @dotdo/benthos - Benthos-compatible stream processing SDK
 *
 * Processors for transforming and filtering messages using Bloblang.
 */

import {
  BenthosMessage,
  BenthosBatch,
  createMessage,
  createBatch,
  isMessage,
  isBatch
} from './message'
import { parse } from './bloblang/parser'
import { Interpreter, DELETED, NOTHING } from './bloblang/interpreter'
import type { ASTNode, AssignNode, SequenceNode } from './bloblang/ast'

/**
 * Result of processing a message
 */
export type ProcessorResult = BenthosMessage | BenthosMessage[] | null

/**
 * Processor context for logging and metrics
 */
export interface ProcessorContext {
  id: string
  logger: {
    debug: (msg: string) => void
    info: (msg: string) => void
    warn: (msg: string) => void
    error: (msg: string) => void
  }
  metrics: {
    increment: (name: string) => void
    gauge: (name: string, value: number) => void
    histogram: (name: string, value: number) => void
  }
}

/**
 * Base processor configuration
 */
export interface ProcessorConfig {
  type?: string
  [key: string]: unknown
}

/**
 * Configuration for mapping processor
 */
export interface MappingProcessorConfig {
  expression: string
  skip_on_error?: boolean
}

/**
 * Configuration for filter processor
 */
export interface FilterProcessorConfig {
  condition: string
}

/**
 * Base processor interface
 */
export interface Processor {
  name: string
  config: ProcessorConfig
  process(msg: BenthosMessage, ctx: ProcessorContext): ProcessorResult
  processBatch?(batch: BenthosBatch, ctx: ProcessorContext): BenthosBatch | null
}

/**
 * Evaluates a Bloblang mapping expression to transform messages
 */
export class MappingProcessor implements Processor {
  name = 'mapping'
  config: ProcessorConfig
  private expression: string
  private skipOnError: boolean
  private ast: ASTNode
  private assignments: AssignNode[] = []
  private rootAssignment?: ASTNode

  constructor(config: MappingProcessorConfig) {
    if (!config.expression || config.expression.trim() === '') {
      throw new Error('Mapping processor requires non-empty expression')
    }

    this.expression = config.expression
    this.skipOnError = config.skip_on_error ?? false
    this.config = { type: 'mapping', ...config }

    try {
      this.ast = parse(this.expression)
      this.parseMapping(this.ast)
    } catch (err) {
      throw new Error(`Failed to parse mapping expression: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private parseMapping(node: ASTNode): void {
    if (node.type === 'Assign') {
      const assignNode = node as AssignNode
      if (assignNode.field === 'root') {
        this.rootAssignment = assignNode.value
      } else {
        this.assignments.push(assignNode)
      }
    } else {
      this.rootAssignment = node
    }
  }

  process(msg: BenthosMessage, _ctx: ProcessorContext): ProcessorResult {
    try {
      return this.applyMapping(msg)
    } catch (err) {
      if (this.skipOnError) {
        return null
      }
      throw err
    }
  }

  private applyMapping(msg: BenthosMessage): BenthosMessage {
    const interpreter = new Interpreter(msg)
    const result = interpreter.evaluate(this.ast)

    const currentData = msg.jsonSafe() ?? msg.content
    const currentMetadata = msg.metadata.toObject()

    let finalData = currentData
    if (result !== undefined && result !== DELETED && this.ast.type !== 'Assign' && this.ast.type !== 'Sequence') {
      finalData = result
    } else if (result !== undefined && result !== DELETED && this.ast.type === 'Assign') {
      finalData = currentData
    } else if (result !== undefined && result !== DELETED && this.ast.type === 'Sequence') {
      const seqNode = this.ast as SequenceNode
      const lastStmt = seqNode.statements[seqNode.statements.length - 1]
      if (lastStmt && lastStmt.type !== 'Assign') {
        finalData = result
      }
    }

    if (typeof finalData === 'string') {
      const jsonString = JSON.stringify(finalData)
      const bytes = new TextEncoder().encode(jsonString)
      const resultMsg = new BenthosMessage(bytes, currentMetadata)
      ;(resultMsg as any)._jsonCache = finalData
      return resultMsg
    }
    return new BenthosMessage(finalData, currentMetadata)
  }

  private setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.')
    let current = obj

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }

    const lastPart = parts[parts.length - 1]

    if (value === DELETED) {
      delete current[lastPart]
    } else if (value === NOTHING) {
      return
    } else {
      current[lastPart] = value
    }
  }

  processBatch(batch: BenthosBatch, ctx: ProcessorContext): BenthosBatch | null {
    const messages: BenthosMessage[] = []

    for (const msg of batch) {
      const result = this.process(msg, ctx)
      if (result === null) {
        continue
      } else if (Array.isArray(result)) {
        messages.push(...result)
      } else {
        messages.push(result)
      }
    }

    return createBatch(messages, batch.metadata.toObject())
  }
}

/**
 * Evaluates a Bloblang condition to filter messages
 */
export class FilterProcessor implements Processor {
  name = 'filter'
  config: ProcessorConfig
  private condition: string
  private ast: ASTNode

  constructor(config: FilterProcessorConfig) {
    if (!config.condition || config.condition.trim() === '') {
      throw new Error('Filter processor requires non-empty condition')
    }

    this.condition = config.condition
    this.config = { type: 'filter', ...config }

    try {
      this.ast = parse(this.condition)
    } catch (err) {
      throw new Error(`Failed to parse filter condition: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  process(msg: BenthosMessage, _ctx: ProcessorContext): ProcessorResult {
    try {
      const interpreter = new Interpreter(msg)
      const result = interpreter.evaluate(this.ast)

      if (this.isTruthy(result)) {
        return msg
      }

      return null
    } catch (err) {
      return null
    }
  }

  private isTruthy(value: unknown): boolean {
    if (value === null || value === undefined) return false
    if (value === false) return false
    if (value === 0) return false
    if (value === '') return false
    return true
  }

  processBatch(batch: BenthosBatch, ctx: ProcessorContext): BenthosBatch | null {
    const messages: BenthosMessage[] = []

    for (const msg of batch) {
      const result = this.process(msg, ctx)
      if (result !== null) {
        messages.push(result)
      }
    }

    return createBatch(messages, batch.metadata.toObject())
  }
}

/**
 * Pass-through processor that returns message unchanged
 */
class IdentityProcessor implements Processor {
  name = 'identity'
  config: ProcessorConfig = { type: 'identity' }

  process(msg: BenthosMessage, _ctx: ProcessorContext): ProcessorResult {
    return msg
  }

  processBatch(batch: BenthosBatch, _ctx: ProcessorContext): BenthosBatch | null {
    return batch
  }
}

/**
 * Splits array content into multiple messages
 */
class SplitProcessor implements Processor {
  name = 'split'
  config: ProcessorConfig = { type: 'split' }

  process(msg: BenthosMessage, _ctx: ProcessorContext): ProcessorResult {
    const content = msg.json()

    if (Array.isArray(content)) {
      return content.map(item => createMessage(item, msg.metadata.toObject()))
    }

    if (typeof content === 'object' && content !== null && 'items' in content) {
      const items = (content as any).items
      if (Array.isArray(items)) {
        return items.map(item => createMessage(item, msg.metadata.toObject()))
      }
    }

    return [msg]
  }

  processBatch(batch: BenthosBatch, ctx: ProcessorContext): BenthosBatch | null {
    const messages: BenthosMessage[] = []

    for (const msg of batch) {
      const result = this.process(msg, ctx)
      if (result === null) {
        continue
      } else if (Array.isArray(result)) {
        messages.push(...result)
      } else {
        messages.push(result)
      }
    }

    return createBatch(messages, batch.metadata.toObject())
  }
}

/**
 * Create a processor from name and config
 */
export function createProcessor(name: string, config: ProcessorConfig): Processor {
  switch (name) {
    case 'identity':
      return new IdentityProcessor()

    case 'mapping':
      if (!('expression' in config)) {
        throw new Error('Mapping processor requires "expression" in config')
      }
      return new MappingProcessor(config as MappingProcessorConfig)

    case 'filter':
      if (!('condition' in config)) {
        throw new Error('Filter processor requires "condition" in config')
      }
      return new FilterProcessor(config as FilterProcessorConfig)

    case 'split':
      return new SplitProcessor()

    default:
      throw new Error(`Unknown processor type: ${name}`)
  }
}
