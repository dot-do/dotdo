/**
 * Predicate Compiler
 *
 * Converts unified AST predicates to TypedColumnStore predicates.
 * Handles type coercion, optimization hints, and predicate execution.
 *
 * @see dotdo-ai6no
 */

import type {
  QueryNode,
  PredicateNode,
  LogicalNode,
  ComparisonOp,
} from '../ast'

// =============================================================================
// Types
// =============================================================================

/**
 * TCS Predicate format
 */
export interface TCSPredicate {
  column: string
  op: string
  value: unknown
}

/**
 * Column statistics for selectivity estimation
 */
export interface ColumnStatistics {
  distinctCount?: number
  nullCount?: number
  rowCount?: number
  min?: unknown
  max?: unknown
}

/**
 * Compilation options
 */
export interface CompilationOptions {
  columnTypes?: Record<string, string>
  statistics?: Record<string, ColumnStatistics>
}

/**
 * Vector search configuration
 */
export interface VectorConfig {
  metric: 'cosine' | 'euclidean' | 'dotProduct'
  k: number
}

/**
 * Compiled predicate with optimization hints
 */
export interface CompiledPredicate {
  tcsPredicate: TCSPredicate
  useBloomFilter?: boolean
  useMinMax?: boolean
  useFTSIndex?: boolean
  useVectorIndex?: boolean
  vectorConfig?: VectorConfig
  partitionPrunable?: boolean
  pushdownSafe?: boolean
  estimatedSelectivity?: number
}

/**
 * Compilation result for a branch (used in OR scenarios)
 */
export interface CompilationBranch {
  predicates: CompiledPredicate[]
  logicalOp?: 'AND' | 'OR'
}

/**
 * Result of compiling a query AST
 */
export interface CompilationResult {
  predicates: CompiledPredicate[]
  logicalOp?: 'AND' | 'OR'
  requiresUnion?: boolean
  branches?: CompilationBranch[]
}

/**
 * Mock column batch for execution results
 */
export interface ColumnBatch {
  columns: Map<string, unknown[]>
  rowCount: number
}

/**
 * TypedColumnStore interface (simplified for compilation)
 */
export interface TypedColumnStore {
  filter(predicate: TCSPredicate): ColumnBatch
  project(columns: string[]): ColumnBatch
  bloomFilter(column: string): { mightContain(value: unknown): boolean } | null
  minMax(column: string): { min: unknown; max: unknown } | null
}

// =============================================================================
// Operator Mappings
// =============================================================================

const AST_TO_TCS_OP: Record<string, string> = {
  '=': '=',
  '!=': '!=',
  '>': '>',
  '>=': '>=',
  '<': '<',
  '<=': '<=',
  'IN': 'in',
  'NOT IN': 'not_in',
  'BETWEEN': 'between',
  'LIKE': 'like',
  'CONTAINS': 'contains',
  'STARTS_WITH': 'starts_with',
  'IS NULL': 'is_null',
  'IS NOT NULL': 'is_not_null',
  'NEAR': 'near',
}

const NEGATED_OP: Record<string, string> = {
  '=': '!=',
  '!=': '=',
  '>': '<=',
  '>=': '<',
  '<': '>=',
  '<=': '>',
  'IN': 'NOT IN',
  'NOT IN': 'IN',
  'IS NULL': 'IS NOT NULL',
  'IS NOT NULL': 'IS NULL',
}

// =============================================================================
// PredicateCompiler Class
// =============================================================================

export class PredicateCompiler {
  private visitedNodes = new WeakSet<object>()

  /**
   * Compile an AST node to TCS predicates
   */
  compile(ast: QueryNode, options: CompilationOptions = {}): CompilationResult {
    this.visitedNodes = new WeakSet()
    return this.compileNode(ast, options, false)
  }

  /**
   * Execute compiled predicates against a column store
   */
  execute(result: CompilationResult, columnStore: TypedColumnStore): ColumnBatch {
    // Handle empty result
    if (result.predicates.length === 0) {
      return { columns: new Map(), rowCount: 0 }
    }

    // Process predicates in order
    for (const compiled of result.predicates) {
      // Check bloom filter first if applicable
      if (compiled.useBloomFilter && compiled.tcsPredicate.op === '=') {
        const bloom = columnStore.bloomFilter(compiled.tcsPredicate.column)
        if (bloom && !bloom.mightContain(compiled.tcsPredicate.value)) {
          return { columns: new Map(), rowCount: 0 }
        }
      }

      // Check min/max for range pruning
      if (compiled.useMinMax) {
        const minMax = columnStore.minMax(compiled.tcsPredicate.column)
        if (minMax) {
          const { min, max } = minMax
          const value = compiled.tcsPredicate.value as number
          const op = compiled.tcsPredicate.op

          // Prune if condition can never be true
          if (op === '>' && value >= (max as number)) {
            return { columns: new Map(), rowCount: 0 }
          }
          if (op === '>=' && value > (max as number)) {
            return { columns: new Map(), rowCount: 0 }
          }
          if (op === '<' && value <= (min as number)) {
            return { columns: new Map(), rowCount: 0 }
          }
          if (op === '<=' && value < (min as number)) {
            return { columns: new Map(), rowCount: 0 }
          }
        }
      }

      // Execute the actual filter
      columnStore.filter(compiled.tcsPredicate)
    }

    // Return the result of the last filter (in real implementation, would chain)
    return columnStore.filter(result.predicates[result.predicates.length - 1].tcsPredicate)
  }

  private compileNode(
    node: QueryNode,
    options: CompilationOptions,
    negated: boolean
  ): CompilationResult {
    // Check for circular references
    if (typeof node === 'object' && node !== null) {
      if (this.visitedNodes.has(node)) {
        throw new Error('Circular reference detected in predicate tree')
      }
      this.visitedNodes.add(node)
    }

    switch (node.type) {
      case 'predicate':
        return this.compilePredicate(node, options, negated)
      case 'logical':
        return this.compileLogical(node, options, negated)
      default:
        // For other node types, return empty result
        return { predicates: [] }
    }
  }

  private compilePredicate(
    node: PredicateNode,
    options: CompilationOptions,
    negated: boolean
  ): CompilationResult {
    // Validate operator
    let op = node.op
    if (!AST_TO_TCS_OP[op]) {
      throw new Error(`Unknown operator: ${op}`)
    }

    // Apply negation if needed
    if (negated) {
      const negatedOp = NEGATED_OP[op]
      if (negatedOp) {
        op = negatedOp as ComparisonOp
      }
    }

    // Validate value for specific operators
    if (op === 'IN' || op === 'NOT IN') {
      if (!Array.isArray(node.value)) {
        throw new Error('IN operator requires an array value')
      }
    }

    if (op === 'BETWEEN') {
      if (!Array.isArray(node.value) || node.value.length !== 2) {
        throw new Error('BETWEEN operator requires a [low, high] array value')
      }
    }

    // Coerce value based on column type
    let value = this.coerceValue(node.value, node.column, options)

    // Build TCS predicate
    const tcsPredicate: TCSPredicate = {
      column: node.column,
      op: AST_TO_TCS_OP[op] || op,
      value,
    }

    // Determine optimization hints
    const compiled: CompiledPredicate = {
      tcsPredicate,
      useBloomFilter: this.shouldUseBloomFilter(op, value),
      useMinMax: this.shouldUseMinMax(op),
      useFTSIndex: op === 'CONTAINS',
      useVectorIndex: op === 'NEAR',
      partitionPrunable: op === 'BETWEEN' || this.shouldUseMinMax(op),
      pushdownSafe: true,
    }

    // Add vector config if applicable
    if (op === 'NEAR' && node.metric && node.k) {
      compiled.vectorConfig = {
        metric: node.metric,
        k: node.k,
      }
    }

    // Estimate selectivity
    compiled.estimatedSelectivity = this.estimateSelectivity(node, op, options)

    return {
      predicates: [compiled],
      logicalOp: undefined,
    }
  }

  private compileLogical(
    node: LogicalNode,
    options: CompilationOptions,
    negated: boolean
  ): CompilationResult {
    const effectiveOp = negated ? this.negateLogicalOp(node.op) : node.op
    const childNegated = negated ? (node.op === 'NOT' ? false : true) : (node.op === 'NOT')

    if (effectiveOp === 'NOT') {
      // NOT with single child
      if (node.children.length === 1) {
        // Handle double negation
        const child = node.children[0]
        if (child.type === 'logical' && child.op === 'NOT') {
          // NOT(NOT(x)) = x
          return this.compileNode(child.children[0], options, negated)
        }
        return this.compileNode(child, options, !negated)
      }
    }

    if (effectiveOp === 'AND') {
      // Flatten AND predicates
      const allPredicates: CompiledPredicate[] = []

      for (const child of node.children) {
        const childResult = this.compileNode(child, options, node.op === 'NOT' || negated)
        allPredicates.push(...childResult.predicates)
      }

      return {
        predicates: allPredicates,
        logicalOp: 'AND',
      }
    }

    if (effectiveOp === 'OR') {
      // OR requires union of separate scans
      const branches: CompilationBranch[] = []

      for (const child of node.children) {
        const childResult = this.compileNode(child, options, node.op === 'NOT' || negated)
        branches.push({
          predicates: childResult.predicates,
          logicalOp: childResult.logicalOp,
        })
      }

      // Flatten to single predicate list for simple cases
      const allPredicates = branches.flatMap(b => b.predicates)

      return {
        predicates: allPredicates,
        logicalOp: 'OR',
        requiresUnion: true,
        branches,
      }
    }

    return { predicates: [] }
  }

  private negateLogicalOp(op: 'AND' | 'OR' | 'NOT'): 'AND' | 'OR' | 'NOT' {
    switch (op) {
      case 'AND': return 'OR'
      case 'OR': return 'AND'
      case 'NOT': return 'NOT'
    }
  }

  private shouldUseBloomFilter(op: string, value: unknown): boolean {
    // Bloom filters work well for equality checks on string values
    return op === '=' && typeof value === 'string'
  }

  private shouldUseMinMax(op: string): boolean {
    return ['>', '>=', '<', '<=', 'BETWEEN'].includes(op)
  }

  private coerceValue(
    value: unknown,
    column: string,
    options: CompilationOptions
  ): unknown {
    const columnType = options.columnTypes?.[column]

    if (!columnType || value === null || value === undefined) {
      return value
    }

    if (columnType === 'int64' || columnType === 'number' || columnType === 'float64') {
      if (typeof value === 'string') {
        const num = Number(value)
        if (isNaN(num)) {
          throw new Error(`Cannot coerce "${value}" to number for column ${column}`)
        }
        return num
      }
      return value
    }

    if (columnType === 'timestamp') {
      if (typeof value === 'string') {
        // Handle relative date strings
        if (value.startsWith('now')) {
          const match = value.match(/^now([+-])(\d+)([dhmsy])$/)
          if (match) {
            const [, sign, amount, unit] = match
            const multipliers: Record<string, number> = {
              's': 1000,
              'm': 60 * 1000,
              'h': 60 * 60 * 1000,
              'd': 24 * 60 * 60 * 1000,
              'y': 365 * 24 * 60 * 60 * 1000,
            }
            const delta = parseInt(amount) * multipliers[unit]
            return sign === '-' ? Date.now() - delta : Date.now() + delta
          }
        }
        // ISO date string
        const timestamp = Date.parse(value)
        if (!isNaN(timestamp)) {
          return timestamp
        }
      }
      return value
    }

    if (columnType === 'boolean') {
      if (typeof value === 'string') {
        if (value.toLowerCase() === 'true') return true
        if (value.toLowerCase() === 'false') return false
      }
      return value
    }

    if (columnType === 'objectId') {
      // Keep ObjectId as string
      return value
    }

    return value
  }

  private estimateSelectivity(
    node: PredicateNode,
    op: string,
    options: CompilationOptions
  ): number {
    const stats = options.statistics?.[node.column]

    if (!stats) {
      // Default selectivity estimates
      switch (op) {
        case '=': return 0.1
        case '!=': return 0.9
        case '>':
        case '<':
        case '>=':
        case '<=': return 0.33
        case 'IN': return Array.isArray(node.value) ? Math.min(0.5, node.value.length * 0.1) : 0.1
        case 'NOT IN': return 0.9
        case 'BETWEEN': return 0.25
        case 'LIKE': return 0.1
        default: return 0.5
      }
    }

    const { distinctCount, min, max, rowCount } = stats

    switch (op) {
      case '=':
        // Selectivity = 1 / distinctCount
        if (distinctCount && distinctCount > 0) {
          return 1 / distinctCount
        }
        return 0.1

      case '!=':
        if (distinctCount && distinctCount > 0) {
          return 1 - (1 / distinctCount)
        }
        return 0.9

      case '>':
      case '>=':
      case '<':
      case '<=':
        // Range selectivity based on min/max
        if (min !== undefined && max !== undefined && typeof node.value === 'number') {
          const range = (max as number) - (min as number)
          if (range > 0) {
            const valuePos = (node.value - (min as number)) / range
            if (op === '>' || op === '>=') {
              return Math.max(0, Math.min(1, 1 - valuePos))
            } else {
              return Math.max(0, Math.min(1, valuePos))
            }
          }
        }
        return 0.33

      case 'IN':
        if (distinctCount && Array.isArray(node.value)) {
          return Math.min(1, node.value.length / distinctCount)
        }
        return 0.1

      case 'NOT IN':
        if (distinctCount && Array.isArray(node.value)) {
          return Math.max(0, 1 - (node.value.length / distinctCount))
        }
        return 0.9

      default:
        return 0.5
    }
  }
}

// =============================================================================
// Exports
// =============================================================================

export type { TypedColumnStore as TypedColumnStoreInterface }
