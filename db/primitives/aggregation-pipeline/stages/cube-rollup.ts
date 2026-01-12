/**
 * CUBE and ROLLUP Stages - SQL OLAP multi-dimensional aggregations
 *
 * CUBE generates all possible combinations of grouping dimensions:
 * - CUBE(a, b, c) generates groups for (a,b,c), (a,b), (a,c), (b,c), (a), (b), (c), ()
 *
 * ROLLUP generates hierarchical subtotals:
 * - ROLLUP(a, b, c) generates groups for (a,b,c), (a,b), (a), ()
 *
 * GROUPING SETS allows explicit specification of groupings:
 * - GROUPING SETS((a,b), (a), ()) generates exactly those three groupings
 *
 * Also provides:
 * - grouping(field) function to detect NULL from aggregation vs data
 * - grouping_id() for efficient grouping identification
 */

import type { Stage } from '../index'
import type { Accumulator } from './group'

// ============================================================================
// Types
// ============================================================================

/**
 * CUBE specification
 */
export interface CubeSpec<T> {
  dimensions: (keyof T)[]
  measures: {
    [key: string]: Accumulator<T>
  }
  // Keep aggregations as alias for backward compatibility
  aggregations?: {
    [key: string]: Accumulator<T>
  }
}

/**
 * ROLLUP specification
 */
export interface RollupSpec<T> {
  dimensions: (keyof T)[]
  measures: {
    [key: string]: Accumulator<T>
  }
  // Keep aggregations as alias for backward compatibility
  aggregations?: {
    [key: string]: Accumulator<T>
  }
}

/**
 * GROUPING SETS specification
 */
export interface GroupingSetsSpec<T> {
  sets: (keyof T)[][]
  measures: {
    [key: string]: Accumulator<T>
  }
  // Keep aggregations as alias for backward compatibility
  aggregations?: {
    [key: string]: Accumulator<T>
  }
}

/**
 * Result row with grouping information
 */
export interface GroupedRow {
  _id?: Record<string, unknown> | null
  _grouping?: Record<string, 0 | 1>
  _grouping_id?: number
  _groupingLevel?: number
  _groupingSet?: number
  [key: string]: unknown
}

/**
 * CUBE stage interface
 */
export interface CubeStage<T> extends Stage<T, GroupedRow> {
  name: '$cube'
  specification: CubeSpec<T>
}

/**
 * ROLLUP stage interface
 */
export interface RollupStage<T> extends Stage<T, GroupedRow> {
  name: '$rollup'
  specification: RollupSpec<T>
}

/**
 * GROUPING SETS stage interface
 */
export interface GroupingSetsStage<T> extends Stage<T, GroupedRow> {
  name: '$groupingSets'
  specification: GroupingSetsSpec<T>
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate all subsets of an array (power set)
 */
function powerSet<T>(arr: T[]): T[][] {
  const result: T[][] = [[]]

  for (const item of arr) {
    const len = result.length
    for (let i = 0; i < len; i++) {
      result.push([...result[i], item])
    }
  }

  return result
}

/**
 * Generate hierarchical prefixes for rollup
 */
function rollupSets<T>(arr: T[]): T[][] {
  const result: T[][] = [[]]

  for (let i = 1; i <= arr.length; i++) {
    result.push(arr.slice(0, i))
  }

  return result
}

/**
 * Get nested value from object
 */
function getFieldValue(obj: unknown, field: string): unknown {
  if (obj === null || obj === undefined) return undefined

  // Handle field references ($field)
  const path = field.startsWith('$') ? field.slice(1) : field

  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Calculate grouping_id for a set of dimensions
 * Each dimension that is aggregated (null due to grouping) gets a 1 bit
 */
function calculateGroupingId(allDimensions: string[], activeDimensions: string[]): number {
  let id = 0
  const activeSet = new Set(activeDimensions)

  for (let i = 0; i < allDimensions.length; i++) {
    if (!activeSet.has(allDimensions[i])) {
      id |= 1 << (allDimensions.length - 1 - i)
    }
  }

  return id
}

/**
 * Calculate grouping indicators for each dimension
 */
function calculateGroupingIndicators(
  allDimensions: string[],
  activeDimensions: string[]
): Record<string, 0 | 1> {
  const activeSet = new Set(activeDimensions)
  const result: Record<string, 0 | 1> = {}

  for (const dim of allDimensions) {
    result[dim] = activeSet.has(dim) ? 0 : 1
  }

  return result
}

/**
 * Calculate the grouping level (number of aggregated dimensions)
 */
function calculateGroupingLevel(
  allDimensions: string[],
  activeDimensions: string[]
): number {
  return allDimensions.length - activeDimensions.length
}

/**
 * Evaluate an expression for aggregation
 */
function evaluateExpression(expr: unknown, doc: unknown): unknown {
  if (typeof expr === 'string' && expr.startsWith('$')) {
    return getFieldValue(doc, expr)
  }
  if (typeof expr !== 'object' || expr === null) return expr

  const exprObj = expr as Record<string, unknown>

  // $multiply
  if (exprObj.$multiply) {
    const values = (exprObj.$multiply as (string | number)[]).map((v) =>
      typeof v === 'string' && v.startsWith('$')
        ? (getFieldValue(doc, v) as number) || 0
        : (v as number)
    )
    return values.reduce((a, b) => a * b, 1)
  }

  // $add
  if (exprObj.$add) {
    const values = (exprObj.$add as (string | number)[]).map((v) =>
      typeof v === 'string' && v.startsWith('$')
        ? (getFieldValue(doc, v) as number) || 0
        : (v as number)
    )
    return values.reduce((a, b) => a + b, 0)
  }

  return expr
}

/**
 * Accumulator state
 */
interface AccumulatorState {
  type: string
  field?: string
  expression?: unknown
  value: unknown
  count?: number
  values?: unknown[]
  set?: Set<string>
  // For $grouping and $groupingId
  dimension?: string
  dimensions?: string[]
  condSpec?: { if: unknown; then: unknown; else: unknown }
}

function initAccumulator(acc: Accumulator | Record<string, unknown>): AccumulatorState {
  if ('$sum' in acc) {
    return {
      type: '$sum',
      field: typeof acc.$sum === 'string' ? acc.$sum : undefined,
      expression: typeof acc.$sum === 'object' ? acc.$sum : (typeof acc.$sum === 'number' ? acc.$sum : undefined),
      value: 0,
    }
  }
  if ('$count' in acc) {
    return { type: '$count', value: 0 }
  }
  if ('$avg' in acc) {
    return { type: '$avg', field: acc.$avg as string, value: 0, count: 0 }
  }
  if ('$min' in acc) {
    return { type: '$min', field: acc.$min as string, value: undefined }
  }
  if ('$max' in acc) {
    return { type: '$max', field: acc.$max as string, value: undefined }
  }
  if ('$first' in acc) {
    return { type: '$first', field: acc.$first as string, value: undefined }
  }
  if ('$last' in acc) {
    return { type: '$last', field: acc.$last as string, value: undefined }
  }
  if ('$push' in acc) {
    return { type: '$push', field: acc.$push as string, value: [], values: [] }
  }
  if ('$addToSet' in acc) {
    return { type: '$addToSet', field: acc.$addToSet as string, value: [], values: [], set: new Set() }
  }
  // $grouping: 'dimension' - returns 1 if dimension is aggregated, 0 otherwise
  if ('$grouping' in acc) {
    return {
      type: '$grouping',
      dimension: acc.$grouping as string,
      value: 0
    }
  }
  // $groupingId: ['dim1', 'dim2'] - returns bitmask of which dimensions are aggregated
  if ('$groupingId' in acc) {
    return {
      type: '$groupingId',
      dimensions: acc.$groupingId as string[],
      value: 0
    }
  }
  // $cond: { if: ..., then: ..., else: ... } - conditional expression
  if ('$cond' in acc) {
    const condSpec = acc.$cond as { if: unknown; then: unknown; else: unknown }
    return {
      type: '$cond',
      condSpec,
      value: undefined
    }
  }

  throw new Error(`Unknown accumulator type`)
}

function updateAccumulator(state: AccumulatorState, doc: unknown): void {
  switch (state.type) {
    case '$sum': {
      let addValue: number
      if (typeof state.expression === 'number') {
        addValue = state.expression
      } else if (state.expression) {
        const result = evaluateExpression(state.expression, doc)
        addValue = typeof result === 'number' ? result : 0
      } else if (state.field) {
        const val = getFieldValue(doc, state.field)
        addValue = typeof val === 'number' ? val : 0
      } else {
        addValue = 0
      }
      state.value = (state.value as number) + addValue
      break
    }

    case '$count':
      state.value = (state.value as number) + 1
      break

    case '$avg': {
      const val = getFieldValue(doc, state.field!)
      if (val !== null && val !== undefined && typeof val === 'number') {
        state.value = (state.value as number) + val
        state.count = (state.count || 0) + 1
      }
      break
    }

    case '$min': {
      const val = getFieldValue(doc, state.field!)
      if (val !== null && val !== undefined) {
        if (state.value === undefined || (val as number) < (state.value as number)) {
          state.value = val
        }
      }
      break
    }

    case '$max': {
      const val = getFieldValue(doc, state.field!)
      if (val !== null && val !== undefined) {
        if (state.value === undefined || (val as number) > (state.value as number)) {
          state.value = val
        }
      }
      break
    }

    case '$first': {
      if (state.value === undefined) {
        state.value = getFieldValue(doc, state.field!)
      }
      break
    }

    case '$last': {
      state.value = getFieldValue(doc, state.field!)
      break
    }

    case '$push': {
      const val = getFieldValue(doc, state.field!)
      ;(state.values as unknown[]).push(val)
      state.value = state.values
      break
    }

    case '$addToSet': {
      const val = getFieldValue(doc, state.field!)
      const key = JSON.stringify(val)
      if (!state.set!.has(key)) {
        state.set!.add(key)
        ;(state.values as unknown[]).push(val)
        state.value = state.values
      }
      break
    }
  }
}

function finalizeAccumulator(state: AccumulatorState): unknown {
  if (state.type === '$avg') {
    if (!state.count || state.count === 0) return null
    return (state.value as number) / state.count
  }
  return state.value
}

/**
 * Generate a group key for a document based on active dimensions
 */
function generateGroupKey(doc: unknown, activeDimensions: string[]): string {
  if (activeDimensions.length === 0) return 'null'

  const keyParts: unknown[] = []
  for (const dim of activeDimensions) {
    keyParts.push(getFieldValue(doc, dim))
  }

  return JSON.stringify(keyParts.length === 1 ? keyParts[0] : keyParts)
}

/**
 * Evaluate a $cond expression given the grouping context
 */
function evaluateCondExpression(
  condSpec: { if: unknown; then: unknown; else: unknown },
  groupingIndicators: Record<string, 0 | 1>,
  row: Record<string, unknown>
): unknown {
  // Evaluate the 'if' condition
  const condition = evaluateConditionExpression(condSpec.if, groupingIndicators, row)

  if (condition) {
    return evaluateThenElse(condSpec.then, groupingIndicators, row)
  } else {
    return evaluateThenElse(condSpec.else, groupingIndicators, row)
  }
}

function evaluateConditionExpression(
  expr: unknown,
  groupingIndicators: Record<string, 0 | 1>,
  row: Record<string, unknown>
): boolean {
  if (typeof expr !== 'object' || expr === null) return Boolean(expr)

  const exprObj = expr as Record<string, unknown>

  // $eq: [left, right]
  if ('$eq' in exprObj) {
    const [left, right] = exprObj.$eq as [unknown, unknown]
    const leftVal = evaluateThenElse(left, groupingIndicators, row)
    const rightVal = evaluateThenElse(right, groupingIndicators, row)
    return leftVal === rightVal
  }

  // $grouping: 'dimension' - returns 1 if aggregated, 0 if not
  if ('$grouping' in exprObj) {
    const dim = exprObj.$grouping as string
    return groupingIndicators[dim] === 1
  }

  return Boolean(expr)
}

function evaluateThenElse(
  expr: unknown,
  groupingIndicators: Record<string, 0 | 1>,
  row: Record<string, unknown>
): unknown {
  if (typeof expr === 'string' && expr.startsWith('$')) {
    // Field reference
    const field = expr.slice(1)
    return row[field]
  }

  if (typeof expr !== 'object' || expr === null) return expr

  const exprObj = expr as Record<string, unknown>

  // { $grouping: 'dimension' }
  if ('$grouping' in exprObj) {
    const dim = exprObj.$grouping as string
    return groupingIndicators[dim] ?? 0
  }

  return expr
}

/**
 * Calculate groupingId for specific dimension order
 */
function calculateGroupingIdForDimensions(
  orderedDimensions: string[],
  activeDimensions: string[]
): number {
  let id = 0
  const activeSet = new Set(activeDimensions)

  for (let i = 0; i < orderedDimensions.length; i++) {
    if (!activeSet.has(orderedDimensions[i])) {
      id |= 1 << (orderedDimensions.length - 1 - i)
    }
  }

  return id
}

/**
 * Aggregate documents for a specific grouping
 */
function aggregateForGrouping<T>(
  input: T[],
  activeDimensions: string[],
  measures: { [key: string]: Accumulator<T> | Record<string, unknown> },
  allDimensions: string[]
): GroupedRow[] {
  // Get measure field names
  const measureFields = Object.keys(measures)

  // Separate regular accumulators from grouping-related ones
  const regularAccumulators: string[] = []
  const groupingAccumulators: string[] = []

  for (const field of measureFields) {
    const accDef = measures[field] as Record<string, unknown>
    if ('$grouping' in accDef || '$groupingId' in accDef || '$cond' in accDef) {
      groupingAccumulators.push(field)
    } else {
      regularAccumulators.push(field)
    }
  }

  // Group documents
  const groups = new Map<string, {
    key: Record<string, unknown>
    states: Map<string, AccumulatorState>
  }>()

  for (const doc of input) {
    const keyStr = generateGroupKey(doc, activeDimensions)

    if (!groups.has(keyStr)) {
      // Build the key object
      const key: Record<string, unknown> = {}
      for (const dim of allDimensions) {
        if (activeDimensions.includes(dim)) {
          key[dim] = getFieldValue(doc, dim)
        } else {
          key[dim] = null
        }
      }

      // Initialize accumulator states for regular accumulators only
      const states = new Map<string, AccumulatorState>()
      for (const field of regularAccumulators) {
        const accDef = measures[field]
        states.set(field, initAccumulator(accDef))
      }

      groups.set(keyStr, { key, states })
    }

    // Update accumulators
    const group = groups.get(keyStr)!
    for (const field of regularAccumulators) {
      const state = group.states.get(field)!
      updateAccumulator(state, doc)
    }
  }

  // Calculate grouping metadata
  const groupingId = calculateGroupingId(allDimensions, activeDimensions)
  const groupingIndicators = calculateGroupingIndicators(allDimensions, activeDimensions)
  const groupingLevel = calculateGroupingLevel(allDimensions, activeDimensions)

  // Build results
  const results: GroupedRow[] = []

  for (const group of groups.values()) {
    const result: GroupedRow = {
      ...group.key,
      _id: activeDimensions.length > 0 ? group.key : null,
      _grouping: groupingIndicators,
      _grouping_id: groupingId,
      _groupingLevel: groupingLevel,
      _groupingSet: groupingId, // Same as grouping_id
    }

    // Finalize regular accumulators
    for (const field of regularAccumulators) {
      const state = group.states.get(field)!
      result[field] = finalizeAccumulator(state)
    }

    // Compute grouping-related measures
    for (const field of groupingAccumulators) {
      const accDef = measures[field] as Record<string, unknown>

      if ('$grouping' in accDef) {
        // Return 1 if the dimension is aggregated (not in activeDimensions), 0 otherwise
        const dim = accDef.$grouping as string
        result[field] = groupingIndicators[dim] ?? 0
      } else if ('$groupingId' in accDef) {
        // Calculate bitmask based on the provided dimension order
        const dims = accDef.$groupingId as string[]
        result[field] = calculateGroupingIdForDimensions(dims, activeDimensions)
      } else if ('$cond' in accDef) {
        // Evaluate conditional expression
        const condSpec = accDef.$cond as { if: unknown; then: unknown; else: unknown }
        result[field] = evaluateCondExpression(condSpec, groupingIndicators, group.key)
      }
    }

    results.push(result)
  }

  return results
}

// ============================================================================
// CUBE Stage Factory
// ============================================================================

/**
 * Create a CUBE stage
 *
 * CUBE generates all possible combinations of grouping dimensions.
 * For dimensions [a, b, c], it generates:
 * - (a, b, c) - all dimensions
 * - (a, b), (a, c), (b, c) - pairs
 * - (a), (b), (c) - singles
 * - () - grand total
 */
export function createCubeStage<T>(spec: CubeSpec<T>): CubeStage<T> {
  const dimensions = spec.dimensions.map(String)
  const measures = spec.measures || spec.aggregations || {}

  return {
    name: '$cube',
    specification: spec,

    process(input: T[]): GroupedRow[] {
      if (input.length === 0) {
        // Return at least the grand total for empty input
        const result: GroupedRow = {
          _id: null,
          _grouping: {},
          _grouping_id: (1 << dimensions.length) - 1,
          _groupingLevel: dimensions.length,
          _groupingSet: (1 << dimensions.length) - 1,
        }
        for (const dim of dimensions) {
          result[dim] = null
          result._grouping![dim] = 1
        }
        for (const field of Object.keys(measures)) {
          result[field] = 0
        }
        return [result]
      }

      const allGroupings = powerSet(dimensions)
      const results: GroupedRow[] = []

      for (const grouping of allGroupings) {
        const groupedRows = aggregateForGrouping(
          input,
          grouping,
          measures as { [key: string]: Accumulator<T> },
          dimensions
        )
        results.push(...groupedRows)
      }

      // Sort by grouping level (most detailed first)
      results.sort((a, b) => {
        return (a._groupingLevel || 0) - (b._groupingLevel || 0)
      })

      return results
    },
  }
}

// ============================================================================
// ROLLUP Stage Factory
// ============================================================================

/**
 * Create a ROLLUP stage
 *
 * ROLLUP generates hierarchical subtotals.
 * For dimensions [a, b, c], it generates:
 * - (a, b, c) - all dimensions
 * - (a, b) - first two
 * - (a) - first only
 * - () - grand total
 */
export function createRollupStage<T>(spec: RollupSpec<T>): RollupStage<T> {
  const dimensions = spec.dimensions.map(String)
  const measures = spec.measures || spec.aggregations || {}

  return {
    name: '$rollup',
    specification: spec,

    process(input: T[]): GroupedRow[] {
      if (input.length === 0) return []

      const allGroupings = rollupSets(dimensions)
      const results: GroupedRow[] = []

      for (const grouping of allGroupings) {
        const groupedRows = aggregateForGrouping(
          input,
          grouping,
          measures as { [key: string]: Accumulator<T> },
          dimensions
        )
        results.push(...groupedRows)
      }

      // Sort by grouping level (most detailed first)
      results.sort((a, b) => {
        return (a._groupingLevel || 0) - (b._groupingLevel || 0)
      })

      return results
    },
  }
}

// ============================================================================
// GROUPING SETS Stage Factory
// ============================================================================

/**
 * Create a GROUPING SETS stage
 *
 * GROUPING SETS allows explicit specification of exactly which groupings to compute.
 */
export function createGroupingSetsStage<T>(spec: GroupingSetsSpec<T>): GroupingSetsStage<T> {
  // Get all unique dimensions across all sets
  const allDimensions = [...new Set(spec.sets.flat().map(String))]
  const measures = spec.measures || spec.aggregations || {}

  return {
    name: '$groupingSets',
    specification: spec,

    process(input: T[]): GroupedRow[] {
      if (input.length === 0) return []

      const results: GroupedRow[] = []

      for (const grouping of spec.sets) {
        const groupingStrings = grouping.map(String)
        const groupedRows = aggregateForGrouping(
          input,
          groupingStrings,
          measures as { [key: string]: Accumulator<T> },
          allDimensions
        )
        results.push(...groupedRows)
      }

      // Sort by grouping level (most detailed first)
      results.sort((a, b) => {
        return (a._groupingLevel || 0) - (b._groupingLevel || 0)
      })

      return results
    },
  }
}

// ============================================================================
// Grouping Functions
// ============================================================================

/**
 * Check if a dimension value is NULL because of grouping (aggregation)
 * vs NULL from actual data.
 *
 * Returns 1 if the NULL is from grouping, 0 if from data or not null.
 */
export function grouping(row: GroupedRow, dimension: string): 0 | 1 {
  if (!row._grouping) return 0
  return row._grouping[dimension] ?? 0
}

/**
 * Get the grouping ID for a row.
 * This is a bitmap where each bit represents whether a dimension is grouped.
 */
export function groupingId(row: GroupedRow): number {
  return row._grouping_id ?? 0
}

/**
 * Helper to check if a row is a subtotal row (has any grouped dimensions)
 */
export function isSubtotal(row: GroupedRow): boolean {
  if (!row._grouping) return false
  return Object.values(row._grouping).some((v) => v === 1)
}

/**
 * Helper to check if a row is the grand total (all dimensions grouped)
 */
export function isGrandTotal(row: GroupedRow): boolean {
  if (!row._grouping) return false
  return Object.values(row._grouping).every((v) => v === 1)
}

/**
 * Get the list of active (non-grouped) dimensions for a row
 */
export function getActiveDimensions(row: GroupedRow): string[] {
  if (!row._grouping) return []
  return Object.entries(row._grouping)
    .filter(([_, v]) => v === 0)
    .map(([k, _]) => k)
}
