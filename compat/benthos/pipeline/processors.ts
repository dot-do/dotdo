/**
 * GREEN Phase Implementation: Benthos Processors
 * Issue: dotdo-7mfvb
 *
 * Implements processors for transforming and filtering Benthos messages.
 * Processors use Bloblang expressions for mapping and filtering logic.
 */

import {
  BenthosMessage,
  BenthosBatch,
  createMessage,
  createBatch,
  isMessage,
  isBatch
} from '../core/message'
import { parse } from '../bloblang/parser'
import { Interpreter, DELETED, NOTHING } from '../bloblang/interpreter'
import type { ASTNode, AssignNode } from '../bloblang/ast'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Result of processing a message - can be:
 * - A single message
 * - An array of messages (for splitting)
 * - null (to drop the message)
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

// ============================================================================
// Mapping Processor
// ============================================================================

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

    // Parse the expression once at construction
    try {
      this.ast = parse(this.expression)
      this.parseMapping(this.ast)
    } catch (err) {
      throw new Error(`Failed to parse mapping expression: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * Parse the mapping to extract assignments
   */
  private parseMapping(node: ASTNode): void {
    // Handle different mapping forms:
    // 1. Direct assignment (root = ..., field = ...)
    // 2. Expression (treat as root replacement)

    if (node.type === 'Assign') {
      const assignNode = node as AssignNode
      if (assignNode.field === 'root') {
        this.rootAssignment = assignNode.value
      } else {
        this.assignments.push(assignNode)
      }
    } else {
      // If not an assignment, treat as root replacement
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

  /**
   * Apply the mapping to a message
   */
  private applyMapping(msg: BenthosMessage): BenthosMessage {
    // Use the Interpreter to evaluate the entire AST
    // The parser handles sequences (semicolon-separated statements)
    // and the interpreter handles assignments to root/fields/meta
    const interpreter = new Interpreter(msg)
    const result = interpreter.evaluate(this.ast)

    // After evaluation, get the final state from the message
    // The interpreter modifies the message directly for assignments
    const currentData = msg.root
    const currentMetadata = msg.metadata.toObject()

    // If the result is not an assignment (just an expression), use it as root
    // Unless the result is undefined (meaning it was an assignment)
    let finalData = currentData
    if (result !== undefined && result !== DELETED && this.ast.type !== 'Assign' && this.ast.type !== 'Sequence') {
      finalData = result
    } else if (result !== undefined && result !== DELETED && this.ast.type === 'Assign') {
      // Assignment returns the assigned value, but we use the modified message
      finalData = currentData
    } else if (result !== undefined && result !== DELETED && this.ast.type === 'Sequence') {
      // For sequences, check if the last statement is an expression (not assignment)
      // If so, that's the result. Otherwise, use the modified message.
      const seqNode = this.ast as import('../bloblang/ast').SequenceNode
      const lastStmt = seqNode.statements[seqNode.statements.length - 1]
      if (lastStmt && lastStmt.type !== 'Assign') {
        finalData = result
      }
    }

    // Create message with the result
    if (typeof finalData === 'string') {
      // For string results, create message with JSON-encoded bytes
      const jsonString = JSON.stringify(finalData)
      const bytes = new TextEncoder().encode(jsonString)
      const resultMsg = new BenthosMessage(bytes, currentMetadata)
      // Set the JSON cache to the actual value
      ;(resultMsg as any)._jsonCache = finalData
      return resultMsg
    }
    return new BenthosMessage(finalData, currentMetadata)
  }

  /**
   * Evaluate a single statement
   */
  private evaluateStatement(
    ast: ASTNode,
    originalMsg: BenthosMessage,
    currentData: unknown,
    currentMetadata: Record<string, string>
  ): { data?: unknown; metadata?: Record<string, string> } {
    // Create message with current state
    const msg = createMessage(currentData, currentMetadata)
    const interpreter = new Interpreter(msg)

    // Check if this is a metadata assignment
    if (ast.type === 'Assign') {
      const assignNode = ast as AssignNode
      const field = assignNode.field

      // Handle meta() assignments
      if (field.startsWith('meta(')) {
        const metaMatch = field.match(/meta\("([^"]+)"\)/)
        if (metaMatch) {
          const key = metaMatch[1]
          const value = interpreter.evaluate(assignNode.value)
          return {
            metadata: { [key]: String(value) }
          }
        }
      }

      // Handle root assignment
      if (field === 'root') {
        const value = interpreter.evaluate(assignNode.value)
        return { data: value }
      }

      // Handle root.field assignment
      if (field.startsWith('root.')) {
        const path = field.substring(5)
        const value = interpreter.evaluate(assignNode.value)

        let newData = typeof currentData === 'object' && currentData !== null
          ? { ...(currentData as Record<string, unknown>) }
          : {}

        this.setPath(newData as Record<string, unknown>, path, value)
        return { data: newData }
      }
    }

    // Otherwise, evaluate as expression and use as new root
    const value = interpreter.evaluate(ast)
    return { data: value }
  }

  /**
   * Set a nested path in an object
   */
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

    // Handle deleted() function - check for DELETED symbol
    if (value === DELETED) {
      delete current[lastPart]
    } else if (value === NOTHING) {
      // NOTHING means don't change the value
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
        // Skip dropped messages
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

// ============================================================================
// Filter Processor
// ============================================================================

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

    // Parse the condition once at construction
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

      // Check if result is truthy
      if (this.isTruthy(result)) {
        return msg
      }

      return null
    } catch (err) {
      // On evaluation error, drop the message
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

// ============================================================================
// Identity Processor
// ============================================================================

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

// ============================================================================
// Split Processor
// ============================================================================

/**
 * Splits array content into multiple messages
 */
class SplitProcessor implements Processor {
  name = 'split'
  config: ProcessorConfig = { type: 'split' }

  process(msg: BenthosMessage, _ctx: ProcessorContext): ProcessorResult {
    const content = msg.json()

    // If content is an array, split into messages
    if (Array.isArray(content)) {
      return content.map(item => createMessage(item, msg.metadata.toObject()))
    }

    // If content has an 'items' field that's an array
    if (typeof content === 'object' && content !== null && 'items' in content) {
      const items = (content as any).items
      if (Array.isArray(items)) {
        return items.map(item => createMessage(item, msg.metadata.toObject()))
      }
    }

    // Otherwise return as-is
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

// ============================================================================
// Factory Functions
// ============================================================================

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
