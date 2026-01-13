/**
 * Predicate Pushdown Rules for Query Federation
 *
 * Implements predicate pushdown optimization for the query federation optimizer.
 * This allows pushing WHERE clauses down to data sources that support them,
 * reducing data transfer and improving query performance.
 *
 * @see dotdo-43oni
 */

import type {
  PredicateNode,
  LogicalNode,
  QueryNode,
  ComparisonOp,
  LogicalOperator,
} from '../ast'
import { isPredicate, isLogical } from '../ast'

// =============================================================================
// Types
// =============================================================================

/**
 * Rule for handling specific predicate types during pushdown
 */
export interface PushdownRule {
  /** Unique name for this rule */
  name: string
  /** Operators this rule handles */
  operators: string[]
  /** Check if predicate can be pushed with given capabilities */
  canPush: (predicate: PredicateNode, capabilities: DataSourceCapabilities) => boolean
  /** Transform predicate for the target source (optional) */
  transform?: (predicate: PredicateNode) => PredicateNode
}

/**
 * Capabilities of a data source for predicate pushdown
 */
export interface DataSourceCapabilities {
  /** Operators the source can handle (=, !=, >, <, etc.) */
  supportedOperators: string[]
  /** Value types the source can handle (string, number, boolean, etc.) */
  supportedTypes: string[]
  /** Columns available in this source (optional - if not specified, all columns assumed available) */
  availableColumns?: string[]
  /** Logical operators the source supports (AND, OR, NOT) */
  supportsLogical?: LogicalOperator[]
  /** Estimated selectivity for cost estimation */
  estimatedSelectivity?: number
}

/**
 * Result of predicate analysis
 */
export interface PredicateAnalysis {
  /** All predicates extracted from the expression */
  predicates: PredicateNode[]
  /** All columns referenced */
  columns: string[]
  /** Whether the expression can be decomposed into individual predicates */
  isDecomposable: boolean
  /** The logical node if the expression is not decomposable */
  logicalNode?: LogicalNode
}

/**
 * Result of splitting predicates
 */
export interface SplitResult {
  /** Predicates that can be pushed to the source */
  pushable: PredicateNode[]
  /** Predicates that must remain for local filtering */
  remaining: PredicateNode[]
  /** Logical nodes that couldn't be fully pushed */
  remainingLogical?: LogicalNode
}

/**
 * Result of query optimization with pushdown
 */
export interface PushdownResult {
  /** Predicates pushed to the remote source */
  pushedPredicates: PredicateNode[]
  /** Predicates that must be evaluated locally */
  localPredicates: PredicateNode[]
  /** The optimized query with pushed predicates */
  optimizedQuery: QueryNode
  /** Estimated savings from pushdown (0-1 representing fraction of rows filtered remotely) */
  estimatedSavings: number
}

// =============================================================================
// PredicatePushdown Class
// =============================================================================

export class PredicatePushdown {
  private rules: PushdownRule[] = []

  constructor() {
    // Initialize with built-in rules
    this.initializeBuiltInRules()
  }

  /**
   * Initialize the built-in pushdown rules for common predicates
   */
  private initializeBuiltInRules(): void {
    // Equality rule
    this.rules.push({
      name: 'equality',
      operators: ['=', '!='],
      canPush: (pred, caps) => {
        return caps.supportedOperators.includes(pred.op) &&
          this.isValueTypeSupported(pred.value, caps)
      },
    })

    // Comparison rule
    this.rules.push({
      name: 'comparison',
      operators: ['>', '<', '>=', '<='],
      canPush: (pred, caps) => {
        return caps.supportedOperators.includes(pred.op) &&
          this.isValueTypeSupported(pred.value, caps)
      },
    })

    // IN rule
    this.rules.push({
      name: 'in',
      operators: ['IN', 'NOT IN'],
      canPush: (pred, caps) => {
        if (!caps.supportedOperators.includes(pred.op)) return false
        if (!caps.supportedTypes.includes('array')) return false
        return Array.isArray(pred.value)
      },
    })

    // LIKE rule
    this.rules.push({
      name: 'like',
      operators: ['LIKE'],
      canPush: (pred, caps) => {
        return caps.supportedOperators.includes('LIKE') &&
          typeof pred.value === 'string'
      },
    })

    // NULL rule
    this.rules.push({
      name: 'null',
      operators: ['IS NULL', 'IS NOT NULL'],
      canPush: (pred, caps) => {
        return caps.supportedOperators.includes(pred.op)
      },
    })

    // BETWEEN rule
    this.rules.push({
      name: 'between',
      operators: ['BETWEEN'],
      canPush: (pred, caps) => {
        return caps.supportedOperators.includes('BETWEEN') &&
          Array.isArray(pred.value) &&
          pred.value.length === 2
      },
    })
  }

  /**
   * Check if a value type is supported by the data source
   */
  private isValueTypeSupported(value: unknown, caps: DataSourceCapabilities): boolean {
    if (value === null) {
      return caps.supportedTypes.includes('null')
    }
    if (Array.isArray(value)) {
      return caps.supportedTypes.includes('array')
    }
    if (value instanceof Date) {
      return caps.supportedTypes.includes('date') || caps.supportedTypes.includes('number')
    }
    const valueType = typeof value
    if (valueType === 'object') {
      return caps.supportedTypes.includes('object')
    }
    return caps.supportedTypes.includes(valueType)
  }

  /**
   * Get the built-in rules (plus any registered custom rules)
   */
  getBuiltInRules(): PushdownRule[] {
    return [...this.rules]
  }

  /**
   * Register a custom pushdown rule
   */
  registerRule(rule: PushdownRule): void {
    // Remove existing rule with same name if present
    this.rules = this.rules.filter(r => r.name !== rule.name)
    this.rules.push(rule)
  }

  /**
   * Analyze predicates to extract information for pushdown decisions
   */
  analyzePredicates(node: QueryNode | null): PredicateAnalysis {
    if (!node) {
      return {
        predicates: [],
        columns: [],
        isDecomposable: true,
      }
    }

    const predicates: PredicateNode[] = []
    const columns: string[] = []

    if (isPredicate(node)) {
      predicates.push(node)
      columns.push(node.column)
      return {
        predicates,
        columns,
        isDecomposable: true,
      }
    }

    if (isLogical(node)) {
      // For AND, we can decompose into individual predicates
      if (node.op === 'AND') {
        for (const child of node.children) {
          const childAnalysis = this.analyzePredicates(child)
          predicates.push(...childAnalysis.predicates)
          columns.push(...childAnalysis.columns)
        }
        return {
          predicates,
          columns: Array.from(new Set(columns)),
          isDecomposable: true,
        }
      }

      // For OR and NOT, we can't easily decompose
      // But we still collect all predicates and columns
      for (const child of node.children) {
        const childAnalysis = this.analyzePredicates(child)
        predicates.push(...childAnalysis.predicates)
        columns.push(...childAnalysis.columns)
      }

      return {
        predicates,
        columns: Array.from(new Set(columns)),
        isDecomposable: false,
        logicalNode: node,
      }
    }

    return {
      predicates: [],
      columns: [],
      isDecomposable: true,
    }
  }

  /**
   * Check if a predicate can be pushed to a specific data source
   */
  canPushToSource(node: QueryNode, capabilities: DataSourceCapabilities): boolean {
    if (isPredicate(node)) {
      return this.canPushPredicate(node, capabilities)
    }

    if (isLogical(node)) {
      return this.canPushLogical(node, capabilities)
    }

    return false
  }

  /**
   * Check if a single predicate can be pushed
   */
  private canPushPredicate(pred: PredicateNode, caps: DataSourceCapabilities): boolean {
    // Check if column is available (if schema is specified)
    if (caps.availableColumns && !caps.availableColumns.includes(pred.column)) {
      // Handle qualified column names (e.g., "users.name")
      const unqualified = pred.column.split('.').pop()
      if (!unqualified || !caps.availableColumns.includes(unqualified)) {
        return false
      }
    }

    // Find a rule that handles this operator
    const rule = this.rules.find(r => r.operators.includes(pred.op))
    if (rule) {
      return rule.canPush(pred, caps)
    }

    // Default: check if operator is supported and value type is compatible
    if (!caps.supportedOperators.includes(pred.op)) {
      return false
    }

    return this.isValueTypeSupported(pred.value, caps)
  }

  /**
   * Check if a logical node can be pushed as a whole
   */
  private canPushLogical(node: LogicalNode, caps: DataSourceCapabilities): boolean {
    // Check if the logical operator itself is supported
    if (caps.supportsLogical && !caps.supportsLogical.includes(node.op)) {
      return false
    }

    // For OR, we need supportsLogical to include OR
    if (node.op === 'OR' && (!caps.supportsLogical || !caps.supportsLogical.includes('OR'))) {
      return false
    }

    // For NOT, we need supportsLogical to include NOT
    if (node.op === 'NOT' && (!caps.supportsLogical || !caps.supportsLogical.includes('NOT'))) {
      return false
    }

    // All children must be pushable
    for (const child of node.children) {
      if (!this.canPushToSource(child, caps)) {
        return false
      }
    }

    return true
  }

  /**
   * Split predicates into pushable and non-pushable sets
   */
  splitPredicates(node: QueryNode, capabilities: DataSourceCapabilities): SplitResult {
    const pushable: PredicateNode[] = []
    const remaining: PredicateNode[] = []
    let remainingLogical: LogicalNode | undefined

    if (isPredicate(node)) {
      if (this.canPushToSource(node, capabilities)) {
        pushable.push(node)
      } else {
        remaining.push(node)
      }
      return { pushable, remaining }
    }

    if (isLogical(node)) {
      if (node.op === 'AND') {
        // For AND, we can split - push what we can, keep the rest
        const remainingChildren: QueryNode[] = []

        for (const child of node.children) {
          if (isPredicate(child)) {
            if (this.canPushPredicate(child, capabilities)) {
              pushable.push(child)
            } else {
              remaining.push(child)
              remainingChildren.push(child)
            }
          } else if (isLogical(child)) {
            // Recurse for nested logical nodes
            const childResult = this.splitPredicates(child, capabilities)
            pushable.push(...childResult.pushable)
            remaining.push(...childResult.remaining)
            if (childResult.remainingLogical) {
              remainingChildren.push(childResult.remainingLogical)
            } else if (childResult.remaining.length > 0) {
              // Create a logical node for the remaining predicates
              if (childResult.remaining.length === 1) {
                remainingChildren.push(childResult.remaining[0])
              } else {
                remainingChildren.push({
                  type: 'logical',
                  op: 'AND',
                  children: childResult.remaining,
                })
              }
            }
          }
        }

        if (remainingChildren.length > 0) {
          if (remainingChildren.length === 1 && isLogical(remainingChildren[0])) {
            remainingLogical = remainingChildren[0] as LogicalNode
          } else {
            remainingLogical = {
              type: 'logical',
              op: 'AND',
              children: remainingChildren,
            }
          }
        }
      } else {
        // For OR and NOT, treat as atomic - either push the whole thing or don't
        if (this.canPushLogical(node, capabilities)) {
          // Extract all predicates from the logical node
          const analysis = this.analyzePredicates(node)
          pushable.push(...analysis.predicates)
        } else {
          // Can't push the logical node, put it in remaining
          const analysis = this.analyzePredicates(node)
          remaining.push(...analysis.predicates)
          remainingLogical = node
        }
      }
    }

    return { pushable, remaining, remainingLogical }
  }

  /**
   * Optimize a query by applying predicate pushdown
   */
  optimizeQuery(
    query: QueryNode,
    source: string,
    capabilities: DataSourceCapabilities
  ): PushdownResult {
    // Extract the WHERE clause from the query
    const queryObj = query as unknown as { where?: QueryNode; type: string; from: string }
    const whereClause = queryObj.where

    if (!whereClause) {
      return {
        pushedPredicates: [],
        localPredicates: [],
        optimizedQuery: query,
        estimatedSavings: 0,
      }
    }

    // Analyze and split predicates
    const splitResult = this.splitPredicates(whereClause, capabilities)

    // Filter predicates to only include those for this source
    const pushedPredicates = splitResult.pushable.filter(p => {
      // If predicate has a table prefix, check it matches the source
      if (p.column.includes('.')) {
        const [table] = p.column.split('.')
        return table === source
      }
      // If no prefix, assume it belongs to the source
      return true
    })

    const localPredicates = splitResult.remaining

    // Calculate estimated savings based on selectivity
    let estimatedSavings = 0
    if (pushedPredicates.length > 0 && capabilities.estimatedSelectivity !== undefined) {
      // Savings = fraction of rows filtered at source
      estimatedSavings = 1 - capabilities.estimatedSelectivity
    } else if (pushedPredicates.length > 0) {
      // Default estimate: 50% savings per pushed predicate (diminishing returns)
      estimatedSavings = 1 - Math.pow(0.5, pushedPredicates.length)
    }

    // Create optimized query with pushed predicates
    const optimizedQuery = this.createOptimizedQuery(query, pushedPredicates, localPredicates)

    return {
      pushedPredicates,
      localPredicates,
      optimizedQuery,
      estimatedSavings,
    }
  }

  /**
   * Create an optimized query with separated pushed and local predicates
   */
  private createOptimizedQuery(
    originalQuery: QueryNode,
    pushedPredicates: PredicateNode[],
    localPredicates: PredicateNode[]
  ): QueryNode {
    const queryObj = originalQuery as unknown as {
      type: string
      from: string
      where?: QueryNode
      [key: string]: unknown
    }

    // Create a copy of the query
    const optimized = { ...queryObj }

    // Set the pushed predicates as the remote WHERE clause
    if (pushedPredicates.length === 0) {
      delete optimized.where
    } else if (pushedPredicates.length === 1) {
      optimized.where = pushedPredicates[0]
    } else {
      optimized.where = {
        type: 'logical',
        op: 'AND',
        children: pushedPredicates,
      } as LogicalNode
    }

    // Add local predicates as a separate filter stage
    if (localPredicates.length > 0) {
      optimized.localFilter = localPredicates.length === 1
        ? localPredicates[0]
        : {
            type: 'logical',
            op: 'AND',
            children: localPredicates,
          }
    }

    return optimized as unknown as QueryNode
  }
}
