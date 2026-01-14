/**
 * Unified AST Representation for Query Engine
 *
 * This module provides a unified AST that can represent queries from:
 * - MongoDB queries
 * - SQL queries
 * - Elasticsearch DSL
 * - Cypher graph queries
 *
 * @see dotdo-uwkx0
 */

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Comparison operators supported across all query languages
 */
export type ComparisonOp =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'IN'
  | 'NOT IN'
  | 'BETWEEN'
  | 'LIKE'
  | 'CONTAINS'
  | 'STARTS_WITH'
  | 'IS NULL'
  | 'IS NOT NULL'
  | 'NEAR'

/**
 * Distance metrics for vector similarity search
 */
export type DistanceMetric = 'cosine' | 'euclidean' | 'dotProduct'

/**
 * Aggregate functions supported across all query languages
 */
export type AggregateFunction = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'first' | 'last' | 'push' | 'addToSet'

/**
 * Arithmetic operators for expression nodes
 */
export type ArithmeticOperator = 'add' | 'subtract' | 'multiply' | 'divide' | 'modulo'

/**
 * Logical operators for combining predicates
 */
export type LogicalOperator = 'AND' | 'OR' | 'NOT'

/**
 * Join types for relational queries
 */
export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'CROSS'

/**
 * Graph traversal directions
 */
export type TraversalDirection = 'OUT' | 'IN' | 'BOTH'

/**
 * Sort direction
 */
export type SortDirection = 'ASC' | 'DESC'

/**
 * Nulls ordering
 */
export type NullsOrder = 'first' | 'last'

// =============================================================================
// Node Types
// =============================================================================

/**
 * Predicate node - represents a comparison condition
 */
export interface PredicateNode {
  type: 'predicate'
  column: string
  op: ComparisonOp
  value: unknown
  /** Distance metric for vector NEAR operations */
  metric?: DistanceMetric
  /** Number of nearest neighbors for vector search */
  k?: number
}

/**
 * Logical node - combines predicates with AND/OR/NOT
 */
export interface LogicalNode {
  type: 'logical'
  op: LogicalOperator
  children: QueryNode[]
}

/**
 * Expression node - represents computed values
 */
export interface ExpressionNode {
  type: 'expression'
  operator: ArithmeticOperator
  operands: Array<string | number | ExpressionNode>
}

/**
 * Column specification for projections
 */
export interface ColumnSpec {
  source: string | ExpressionNode
  alias?: string
  include: boolean
}

/**
 * Projection node - selects/excludes columns
 */
export interface ProjectionNode {
  type: 'projection'
  columns: ColumnSpec[]
}

/**
 * Aggregation node - represents aggregate functions
 */
export interface AggregationNode {
  type: 'aggregation'
  function: AggregateFunction
  column?: string
  distinct?: boolean
}

/**
 * Aggregation with alias for GroupBy
 */
export interface AliasedAggregation {
  alias: string
  aggregation: AggregationNode
}

/**
 * GroupBy node - groups rows and applies aggregations
 */
export interface GroupByNode {
  type: 'groupBy'
  columns: string[]
  aggregations: AliasedAggregation[]
  having?: QueryNode
}

/**
 * Sort column specification
 */
export interface SortColumn {
  column: string
  direction: SortDirection
  nulls?: NullsOrder
}

/**
 * Sort node - orders results
 */
export interface SortNode {
  type: 'sort'
  columns: SortColumn[]
}

/**
 * Reference to a column in another table (for joins)
 */
export interface ColumnRef {
  $ref: string
}

/**
 * Join node - combines tables
 */
export interface JoinNode {
  type: 'join'
  joinType: JoinType
  left: string
  right: string
  on: PredicateNode
}

/**
 * Traversal node - graph traversal operations
 */
export interface TraversalNode {
  type: 'traversal'
  direction: TraversalDirection
  edgeTypes?: string[]
  minHops: number
  maxHops: number
  filter?: QueryNode
}

/**
 * Union type of all query nodes
 */
export type QueryNode =
  | PredicateNode
  | LogicalNode
  | ProjectionNode
  | AggregationNode
  | GroupByNode
  | SortNode
  | JoinNode
  | TraversalNode

// =============================================================================
// Helper Functions - Node Creators
// =============================================================================

/**
 * Create a predicate node for a simple comparison
 */
export function createPredicate(
  column: string,
  op: ComparisonOp,
  value: unknown,
  options?: { metric?: DistanceMetric; k?: number }
): PredicateNode {
  return {
    type: 'predicate',
    column,
    op,
    value,
    ...options,
  }
}

/**
 * Create an equality predicate
 */
export function eq(column: string, value: unknown): PredicateNode {
  return createPredicate(column, '=', value)
}

/**
 * Create an inequality predicate
 */
export function neq(column: string, value: unknown): PredicateNode {
  return createPredicate(column, '!=', value)
}

/**
 * Create a greater than predicate
 */
export function gt(column: string, value: unknown): PredicateNode {
  return createPredicate(column, '>', value)
}

/**
 * Create a greater than or equal predicate
 */
export function gte(column: string, value: unknown): PredicateNode {
  return createPredicate(column, '>=', value)
}

/**
 * Create a less than predicate
 */
export function lt(column: string, value: unknown): PredicateNode {
  return createPredicate(column, '<', value)
}

/**
 * Create a less than or equal predicate
 */
export function lte(column: string, value: unknown): PredicateNode {
  return createPredicate(column, '<=', value)
}

/**
 * Create an IN predicate
 */
export function inSet(column: string, values: unknown[]): PredicateNode {
  return createPredicate(column, 'IN', values)
}

/**
 * Create a NOT IN predicate
 */
export function notInSet(column: string, values: unknown[]): PredicateNode {
  return createPredicate(column, 'NOT IN', values)
}

/**
 * Create a BETWEEN predicate
 */
export function between(column: string, min: unknown, max: unknown): PredicateNode {
  return createPredicate(column, 'BETWEEN', [min, max])
}

/**
 * Create a LIKE predicate
 */
export function like(column: string, pattern: string): PredicateNode {
  return createPredicate(column, 'LIKE', pattern)
}

/**
 * Create a CONTAINS predicate
 */
export function contains(column: string, value: string): PredicateNode {
  return createPredicate(column, 'CONTAINS', value)
}

/**
 * Create a STARTS_WITH predicate
 */
export function startsWith(column: string, prefix: string): PredicateNode {
  return createPredicate(column, 'STARTS_WITH', prefix)
}

/**
 * Create an IS NULL predicate
 */
export function isNull(column: string): PredicateNode {
  return createPredicate(column, 'IS NULL', null)
}

/**
 * Create an IS NOT NULL predicate
 */
export function isNotNull(column: string): PredicateNode {
  return createPredicate(column, 'IS NOT NULL', null)
}

/**
 * Create a NEAR predicate for vector similarity search
 */
export function near(
  column: string,
  vector: number[],
  options: { metric: DistanceMetric; k: number }
): PredicateNode {
  return createPredicate(column, 'NEAR', vector, options)
}

/**
 * Create a logical AND node
 */
export function and(...children: QueryNode[]): LogicalNode {
  return {
    type: 'logical',
    op: 'AND',
    children,
  }
}

/**
 * Create a logical OR node
 */
export function or(...children: QueryNode[]): LogicalNode {
  return {
    type: 'logical',
    op: 'OR',
    children,
  }
}

/**
 * Create a logical NOT node
 */
export function not(child: QueryNode): LogicalNode {
  return {
    type: 'logical',
    op: 'NOT',
    children: [child],
  }
}

/**
 * Create an expression node
 */
export function createExpression(
  operator: ArithmeticOperator,
  ...operands: Array<string | number | ExpressionNode>
): ExpressionNode {
  return {
    type: 'expression',
    operator,
    operands,
  }
}

/**
 * Create a projection node
 */
export function createProjection(columns: ColumnSpec[]): ProjectionNode {
  return {
    type: 'projection',
    columns,
  }
}

/**
 * Create a column selection (include)
 */
export function select(...columns: string[]): ProjectionNode {
  return createProjection(columns.map((source) => ({ source, include: true })))
}

/**
 * Create a column exclusion
 */
export function exclude(...columns: string[]): ProjectionNode {
  return createProjection(columns.map((source) => ({ source, include: false })))
}

/**
 * Create an aggregation node
 */
export function createAggregation(
  fn: AggregateFunction,
  column?: string,
  distinct?: boolean
): AggregationNode {
  return {
    type: 'aggregation',
    function: fn,
    column,
    distinct,
  }
}

/**
 * Create a COUNT aggregation
 */
export function count(column?: string, distinct?: boolean): AggregationNode {
  return createAggregation('count', column, distinct)
}

/**
 * Create a SUM aggregation
 */
export function sum(column: string): AggregationNode {
  return createAggregation('sum', column)
}

/**
 * Create an AVG aggregation
 */
export function avg(column: string): AggregationNode {
  return createAggregation('avg', column)
}

/**
 * Create a MIN aggregation
 */
export function min(column: string): AggregationNode {
  return createAggregation('min', column)
}

/**
 * Create a MAX aggregation
 */
export function max(column: string): AggregationNode {
  return createAggregation('max', column)
}

/**
 * Create a GroupBy node
 */
export function createGroupBy(
  columns: string[],
  aggregations: AliasedAggregation[],
  having?: QueryNode
): GroupByNode {
  return {
    type: 'groupBy',
    columns,
    aggregations,
    having,
  }
}

/**
 * Create a sort node
 */
export function createSort(...columns: SortColumn[]): SortNode {
  return {
    type: 'sort',
    columns,
  }
}

/**
 * Create an ascending sort column
 */
export function asc(column: string, nulls?: NullsOrder): SortColumn {
  return { column, direction: 'ASC', nulls }
}

/**
 * Create a descending sort column
 */
export function desc(column: string, nulls?: NullsOrder): SortColumn {
  return { column, direction: 'DESC', nulls }
}

/**
 * Create a join node
 */
export function createJoin(
  joinType: JoinType,
  left: string,
  right: string,
  on: PredicateNode
): JoinNode {
  return {
    type: 'join',
    joinType,
    left,
    right,
    on,
  }
}

/**
 * Create an inner join
 */
export function innerJoin(left: string, right: string, on: PredicateNode): JoinNode {
  return createJoin('INNER', left, right, on)
}

/**
 * Create a left join
 */
export function leftJoin(left: string, right: string, on: PredicateNode): JoinNode {
  return createJoin('LEFT', left, right, on)
}

/**
 * Create a right join
 */
export function rightJoin(left: string, right: string, on: PredicateNode): JoinNode {
  return createJoin('RIGHT', left, right, on)
}

/**
 * Create a traversal node for graph queries
 */
export function createTraversal(
  direction: TraversalDirection,
  minHops: number,
  maxHops: number,
  options?: { edgeTypes?: string[]; filter?: QueryNode }
): TraversalNode {
  return {
    type: 'traversal',
    direction,
    minHops,
    maxHops,
    ...options,
  }
}

/**
 * Create a column reference for joins
 */
export function ref(columnPath: string): ColumnRef {
  return { $ref: columnPath }
}

// =============================================================================
// Visitor Pattern
// =============================================================================

/**
 * Visitor interface for traversing AST nodes
 */
export interface ASTVisitor<T> {
  visitPredicate(node: PredicateNode): T
  visitLogical(node: LogicalNode): T
  visitProjection(node: ProjectionNode): T
  visitAggregation(node: AggregationNode): T
  visitGroupBy(node: GroupByNode): T
  visitSort(node: SortNode): T
  visitJoin(node: JoinNode): T
  visitTraversal(node: TraversalNode): T
}

/**
 * Visit an AST node with the appropriate visitor method
 */
export function visit<T>(node: QueryNode, visitor: ASTVisitor<T>): T {
  switch (node.type) {
    case 'predicate':
      return visitor.visitPredicate(node)
    case 'logical':
      return visitor.visitLogical(node)
    case 'projection':
      return visitor.visitProjection(node)
    case 'aggregation':
      return visitor.visitAggregation(node)
    case 'groupBy':
      return visitor.visitGroupBy(node)
    case 'sort':
      return visitor.visitSort(node)
    case 'join':
      return visitor.visitJoin(node)
    case 'traversal':
      return visitor.visitTraversal(node)
    default:
      throw new Error(`Unknown node type: ${(node as QueryNode).type}`)
  }
}

/**
 * Abstract base visitor with default implementations that recurse into children
 */
export abstract class BaseVisitor<T> implements ASTVisitor<T> {
  abstract visitPredicate(node: PredicateNode): T
  abstract visitLogical(node: LogicalNode): T
  abstract visitProjection(node: ProjectionNode): T
  abstract visitAggregation(node: AggregationNode): T
  abstract visitGroupBy(node: GroupByNode): T
  abstract visitSort(node: SortNode): T
  abstract visitJoin(node: JoinNode): T
  abstract visitTraversal(node: TraversalNode): T

  visit(node: QueryNode): T {
    return visit(node, this)
  }
}

/**
 * Visitor that collects all column names referenced in a query
 */
export class ColumnCollector extends BaseVisitor<string[]> {
  private columns: Set<string> = new Set()

  visitPredicate(node: PredicateNode): string[] {
    this.columns.add(node.column)
    return Array.from(this.columns)
  }

  visitLogical(node: LogicalNode): string[] {
    for (const child of node.children) {
      this.visit(child)
    }
    return Array.from(this.columns)
  }

  visitProjection(node: ProjectionNode): string[] {
    for (const col of node.columns) {
      if (typeof col.source === 'string') {
        this.columns.add(col.source)
      }
    }
    return Array.from(this.columns)
  }

  visitAggregation(node: AggregationNode): string[] {
    if (node.column) {
      this.columns.add(node.column)
    }
    return Array.from(this.columns)
  }

  visitGroupBy(node: GroupByNode): string[] {
    for (const col of node.columns) {
      this.columns.add(col)
    }
    for (const agg of node.aggregations) {
      this.visit(agg.aggregation)
    }
    if (node.having) {
      this.visit(node.having)
    }
    return Array.from(this.columns)
  }

  visitSort(node: SortNode): string[] {
    for (const col of node.columns) {
      this.columns.add(col.column)
    }
    return Array.from(this.columns)
  }

  visitJoin(node: JoinNode): string[] {
    this.visit(node.on)
    return Array.from(this.columns)
  }

  visitTraversal(node: TraversalNode): string[] {
    if (node.filter) {
      this.visit(node.filter)
    }
    return Array.from(this.columns)
  }

  getColumns(): string[] {
    return Array.from(this.columns)
  }
}

/**
 * Collect all columns referenced in a query
 */
export function collectColumns(node: QueryNode): string[] {
  const collector = new ColumnCollector()
  collector.visit(node)
  return collector.getColumns()
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a node is a PredicateNode
 */
export function isPredicate(node: QueryNode): node is PredicateNode {
  return node.type === 'predicate'
}

/**
 * Check if a node is a LogicalNode
 */
export function isLogical(node: QueryNode): node is LogicalNode {
  return node.type === 'logical'
}

/**
 * Check if a node is a ProjectionNode
 */
export function isProjection(node: QueryNode): node is ProjectionNode {
  return node.type === 'projection'
}

/**
 * Check if a node is an AggregationNode
 */
export function isAggregation(node: QueryNode): node is AggregationNode {
  return node.type === 'aggregation'
}

/**
 * Check if a node is a GroupByNode
 */
export function isGroupBy(node: QueryNode): node is GroupByNode {
  return node.type === 'groupBy'
}

/**
 * Check if a node is a SortNode
 */
export function isSort(node: QueryNode): node is SortNode {
  return node.type === 'sort'
}

/**
 * Check if a node is a JoinNode
 */
export function isJoin(node: QueryNode): node is JoinNode {
  return node.type === 'join'
}

/**
 * Check if a node is a TraversalNode
 */
export function isTraversal(node: QueryNode): node is TraversalNode {
  return node.type === 'traversal'
}

/**
 * Check if a value is a column reference
 */
export function isColumnRef(value: unknown): value is ColumnRef {
  return typeof value === 'object' && value !== null && '$ref' in value
}
