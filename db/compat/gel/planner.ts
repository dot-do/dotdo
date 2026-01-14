/**
 * Query Planner - EdgeQL AST to Execution Plan
 *
 * Creates an intermediate representation (execution plan) from EdgeQL AST.
 * The plan can then be optimized and translated to SQL.
 *
 * @module planner
 * @see tests/query-planner.test.ts - TDD RED phase tests
 */

import type { Schema } from './sdl-parser'

// =============================================================================
// PLAN TYPES
// =============================================================================

/**
 * Base interface for all plan nodes
 */
export interface BasePlan {
  /** Estimated cost for query optimization */
  estimatedCost: number
  /** Parameters used in this plan */
  parameters: string[]
  /** Optional parameter flag by name */
  optionalParameters?: string[]
  /** Parameter types by name */
  parameterTypes?: Record<string, string>
}

/**
 * SELECT execution plan
 */
export interface SelectPlan extends BasePlan {
  type: 'select'
  /** Root table to select from */
  rootTable: string
  /** JOINs needed for link traversal */
  joins: JoinPlan[]
  /** Filter conditions */
  filter?: FilterPlan
  /** Columns to select */
  projections: ProjectionPlan[]
  /** ORDER BY clause */
  orderBy?: OrderPlan
  /** LIMIT value */
  limit?: number
  /** OFFSET value */
  offset?: number
  /** Whether to use DISTINCT */
  distinct?: boolean
}

/**
 * INSERT execution plan
 */
export interface InsertPlan extends BasePlan {
  type: 'insert'
  /** Target table */
  targetTable: string
  /** Columns to insert */
  columns: string[]
  /** Values to insert */
  values: ValuePlan[]
  /** Nested inserts for linked objects */
  nestedInserts: InsertPlan[]
}

/**
 * UPDATE execution plan
 */
export interface UpdatePlan extends BasePlan {
  type: 'update'
  /** Target table */
  targetTable: string
  /** Filter to find rows to update */
  filter?: FilterPlan
  /** Column assignments */
  assignments: AssignmentPlan[]
}

/**
 * DELETE execution plan
 */
export interface DeletePlan extends BasePlan {
  type: 'delete'
  /** Target table */
  targetTable: string
  /** Filter to find rows to delete */
  filter?: FilterPlan
}

/**
 * Union type of all query plans
 */
export type QueryPlan = SelectPlan | InsertPlan | UpdatePlan | DeletePlan

/**
 * JOIN plan for link traversal
 */
export interface JoinPlan {
  /** Type of join */
  joinType: 'INNER' | 'LEFT' | 'RIGHT'
  /** Target table to join */
  targetTable: string
  /** Alias for the joined table */
  alias: string
  /** Source column (FK) */
  sourceColumn: string
  /** Target column (usually 'id') */
  targetColumn: string
  /** Whether this is a backlink traversal */
  isBacklink?: boolean
}

/**
 * Filter plan (WHERE clause)
 */
export interface FilterPlan {
  /** Filter type */
  type: 'comparison' | 'logical' | 'in' | 'like' | 'exists'
  /** Operator for comparison/logical */
  operator?: string
  /** Left operand for comparison */
  left?: ColumnRef
  /** Right operand for comparison */
  right?: ValueRef
  /** Child conditions for logical operators */
  conditions?: FilterPlan[]
  /** Values for IN expressions */
  values?: unknown[]
}

/**
 * Column reference in a plan
 */
export interface ColumnRef {
  /** Column name */
  column: string
  /** Table name or alias */
  table?: string
  /** Function applied to column */
  function?: string
}

/**
 * Value reference in a plan
 */
export interface ValueRef {
  /** Literal value */
  value?: unknown
  /** Whether this is a parameter */
  isParameter?: boolean
  /** Parameter name if isParameter is true */
  parameterName?: string
}

/**
 * Projection plan (SELECT columns)
 */
export interface ProjectionPlan {
  /** Column name */
  column: string
  /** Table name or alias */
  table?: string
  /** Output alias */
  alias?: string
  /** Column type */
  type?: string
  /** Whether this is a computed field */
  computed?: boolean
  /** Expression for computed fields */
  expression?: unknown
  /** Aggregate function if applicable */
  aggregate?: string
}

/**
 * ORDER BY plan
 */
export interface OrderPlan {
  /** Order by expressions */
  expressions: OrderExpression[]
}

/**
 * Single ORDER BY expression
 */
export interface OrderExpression {
  /** Column name */
  column: string
  /** Table name or alias */
  table?: string
  /** Sort direction */
  direction: 'asc' | 'desc'
  /** NULLS position */
  nullsPosition?: 'first' | 'last'
}

/**
 * Value plan for INSERT
 */
export interface ValuePlan {
  /** Literal value */
  value?: unknown
  /** Whether this is a parameter */
  isParameter?: boolean
  /** Parameter name */
  parameterName?: string
  /** Expression for computed values */
  expression?: unknown
}

/**
 * Assignment plan for UPDATE
 */
export interface AssignmentPlan {
  /** Target column */
  column: string
  /** Value to assign */
  value: ValuePlan
}

// =============================================================================
// PLANNER OPTIONS
// =============================================================================

export interface PlannerOptions {
  /** Schema for type-aware planning */
  schema?: Schema
  /** Whether to optimize the plan */
  optimize?: boolean
}

// =============================================================================
// MAIN API - STUB IMPLEMENTATION
// =============================================================================

/**
 * Plan a query from EdgeQL AST
 *
 * @param ast - The EdgeQL AST to plan
 * @param options - Planner options
 * @returns The query execution plan
 *
 * @throws Error - Not yet implemented (RED phase)
 */
export function planQuery(ast: unknown, options?: PlannerOptions): QueryPlan {
  // RED PHASE: This will fail all tests
  throw new Error('planQuery not implemented - RED phase')
}
