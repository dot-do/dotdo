/**
 * $group Stage - MongoDB-style grouping and aggregation
 *
 * Supports:
 * - Single field grouping ($group by $field)
 * - Multi-field grouping ($group by { field1: $f1, field2: $f2 })
 * - Null _id for global aggregation
 * - Accumulators: $sum, $count, $avg, $min, $max, $first, $last, $push, $addToSet
 * - Expression support in accumulators
 * - Nested field access
 */

import type { Stage } from '../index'
import type { AggregateFunction } from '../../typed-column-store'

// ============================================================================
// Types
// ============================================================================

/**
 * Accumulator types
 */
export type AccumulatorType = '$sum' | '$count' | '$avg' | '$min' | '$max' | '$first' | '$last' | '$push' | '$addToSet'

/**
 * Accumulator definition
 */
export type Accumulator<T = unknown> =
  | { $sum: string | number | Expression }
  | { $count: Record<string, never> }
  | { $avg: string }
  | { $min: string }
  | { $max: string }
  | { $first: string }
  | { $last: string }
  | { $push: string }
  | { $addToSet: string }

/**
 * Expression types for computed values
 */
export interface Expression {
  $multiply?: (string | number)[]
  $add?: (string | number)[]
  $subtract?: (string | number)[]
  $divide?: (string | number)[]
  $cond?: [Expression | object, number, number] | { if: object; then: unknown; else: unknown }
  $gt?: [string | number, number]
  $dateToString?: { format: string; date: string }
}

/**
 * Group key can be a field reference, null, or an object with multiple fields
 */
export type GroupKey<T> = string | null | { [key: string]: string | Expression }

/**
 * Group specification
 */
export interface GroupSpec<T> {
  _id: GroupKey<T>
  [key: string]: Accumulator<T> | GroupKey<T>
}

/**
 * Group result type (dynamic based on spec)
 */
export type GroupResult<T, TSpec extends GroupSpec<T>> = {
  _id: TSpec['_id'] extends null
    ? null
    : TSpec['_id'] extends string
      ? unknown
      : TSpec['_id'] extends object
        ? { [K in keyof TSpec['_id']]: unknown }
        : unknown
} & {
  [K in keyof Omit<TSpec, '_id'>]: unknown
}

/**
 * Group stage interface
 */
export interface GroupStage<T> extends Stage<T, unknown> {
  name: '$group'
  specification: GroupSpec<T>
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a nested value from an object using dot notation or field reference
 */
function getFieldValue(obj: unknown, field: string): unknown {
  if (obj === null || obj === undefined) return undefined

  // Handle field references ($field or $field.nested)
  const path = field.startsWith('$') ? field.slice(1) : field

  // Special case: $$ROOT returns the entire document
  if (field === '$$ROOT') return obj

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
 * Evaluate an expression
 */
function evaluateExpression(expr: unknown, doc: unknown): unknown {
  if (expr === null || expr === undefined) return expr

  // Field reference
  if (typeof expr === 'string' && expr.startsWith('$')) {
    return getFieldValue(doc, expr)
  }

  // Literal value
  if (typeof expr !== 'object') {
    return expr
  }

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

  // $subtract
  if (exprObj.$subtract) {
    const [a, b] = (exprObj.$subtract as (string | number)[]).map((v) =>
      typeof v === 'string' && v.startsWith('$')
        ? (getFieldValue(doc, v) as number) || 0
        : (v as number)
    ) as [number, number]
    return a - b
  }

  // $divide
  if (exprObj.$divide) {
    const [a, b] = (exprObj.$divide as (string | number)[]).map((v) =>
      typeof v === 'string' && v.startsWith('$')
        ? (getFieldValue(doc, v) as number) || 0
        : (v as number)
    ) as [number, number]
    return b !== 0 ? a / b : 0
  }

  // $cond
  if (exprObj.$cond) {
    const cond = exprObj.$cond
    if (Array.isArray(cond)) {
      const [condition, thenValue, elseValue] = cond
      const condResult = evaluateCondition(condition, doc)
      return condResult ? thenValue : elseValue
    } else if (cond && typeof cond === 'object') {
      const { if: ifCond, then: thenValue, else: elseValue } = cond as {
        if: unknown
        then: unknown
        else: unknown
      }
      const condResult = evaluateCondition(ifCond, doc)
      return condResult ? thenValue : elseValue
    }
  }

  // $dateToString
  if (exprObj.$dateToString) {
    const { format, date } = exprObj.$dateToString as { format: string; date: string }
    const dateValue = getFieldValue(doc, date) as Date
    if (dateValue instanceof Date) {
      return formatDate(dateValue, format)
    }
    return null
  }

  return expr
}

/**
 * Evaluate a condition expression
 */
function evaluateCondition(condition: unknown, doc: unknown): boolean {
  if (typeof condition !== 'object' || condition === null) {
    return Boolean(condition)
  }

  const condObj = condition as Record<string, unknown>

  // $gt
  if (condObj.$gt) {
    const [a, b] = (condObj.$gt as (string | number)[]).map((v) =>
      typeof v === 'string' && v.startsWith('$')
        ? (getFieldValue(doc, v) as number) || 0
        : (v as number)
    ) as [number, number]
    return a > b
  }

  // $lt
  if (condObj.$lt) {
    const [a, b] = (condObj.$lt as (string | number)[]).map((v) =>
      typeof v === 'string' && v.startsWith('$')
        ? (getFieldValue(doc, v) as number) || 0
        : (v as number)
    ) as [number, number]
    return a < b
  }

  // $eq
  if (condObj.$eq) {
    const [a, b] = (condObj.$eq as (string | unknown)[]).map((v) =>
      typeof v === 'string' && v.startsWith('$')
        ? getFieldValue(doc, v)
        : v
    ) as [unknown, unknown]
    return a === b
  }

  // $gte
  if (condObj.$gte) {
    const [a, b] = (condObj.$gte as (string | number)[]).map((v) =>
      typeof v === 'string' && v.startsWith('$')
        ? (getFieldValue(doc, v) as number) || 0
        : (v as number)
    ) as [number, number]
    return a >= b
  }

  return false
}

/**
 * Format a date according to a format string
 */
function formatDate(date: Date, format: string): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')

  return format
    .replace('%Y', String(date.getFullYear()))
    .replace('%m', pad(date.getMonth() + 1))
    .replace('%d', pad(date.getDate()))
    .replace('%H', pad(date.getHours()))
    .replace('%M', pad(date.getMinutes()))
    .replace('%S', pad(date.getSeconds()))
}

/**
 * Check if an object is an expression (has keys starting with $)
 */
function isExpression(obj: unknown): boolean {
  if (obj === null || typeof obj !== 'object') return false
  const keys = Object.keys(obj as object)
  return keys.length > 0 && keys.every((k) => k.startsWith('$'))
}

/**
 * Generate a group key for a document
 */
function generateGroupKey<T>(doc: T, keySpec: GroupKey<T>): unknown {
  if (keySpec === null) return null

  if (typeof keySpec === 'string') {
    return getFieldValue(doc, keySpec)
  }

  // Check if this is an expression (like $dateToString) rather than a multi-field key
  if (isExpression(keySpec)) {
    return evaluateExpression(keySpec, doc)
  }

  // Object key (multi-field grouping)
  const result: Record<string, unknown> = {}
  for (const [outField, fieldRef] of Object.entries(keySpec)) {
    if (typeof fieldRef === 'string') {
      result[outField] = getFieldValue(doc, fieldRef)
    } else {
      result[outField] = evaluateExpression(fieldRef, doc)
    }
  }
  return result
}

/**
 * Stringify a group key for use as Map key
 */
function stringifyKey(key: unknown): string {
  if (key === null) return 'null'
  if (key === undefined) return 'undefined'
  if (typeof key === 'object') return JSON.stringify(key)
  return String(key)
}

/**
 * Accumulator state
 */
interface AccumulatorState {
  type: AccumulatorType
  field?: string
  expression?: unknown
  value: unknown
  count?: number // For avg
  values?: unknown[] // For push, addToSet
  set?: Set<string> // For addToSet deduplication
}

/**
 * Initialize accumulator state
 */
function initAccumulator(acc: Accumulator): AccumulatorState {
  if ('$sum' in acc) {
    return { type: '$sum', field: typeof acc.$sum === 'string' ? acc.$sum : undefined, expression: typeof acc.$sum === 'object' ? acc.$sum : (typeof acc.$sum === 'number' ? acc.$sum : undefined), value: 0 }
  }
  if ('$count' in acc) {
    return { type: '$count', value: 0 }
  }
  if ('$avg' in acc) {
    return { type: '$avg', field: acc.$avg, value: 0, count: 0 }
  }
  if ('$min' in acc) {
    return { type: '$min', field: acc.$min, value: undefined }
  }
  if ('$max' in acc) {
    return { type: '$max', field: acc.$max, value: undefined }
  }
  if ('$first' in acc) {
    return { type: '$first', field: acc.$first, value: undefined }
  }
  if ('$last' in acc) {
    return { type: '$last', field: acc.$last, value: undefined }
  }
  if ('$push' in acc) {
    return { type: '$push', field: acc.$push, value: [], values: [] }
  }
  if ('$addToSet' in acc) {
    return { type: '$addToSet', field: acc.$addToSet, value: [], values: [], set: new Set() }
  }

  throw new Error(`Unknown accumulator type`)
}

/**
 * Update accumulator with a document
 */
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
        if (state.value === undefined) {
          state.value = val
        } else if (val instanceof Date && state.value instanceof Date) {
          if (val < state.value) state.value = val
        } else if (typeof val === 'string' && typeof state.value === 'string') {
          if (val < state.value) state.value = val
        } else if (typeof val === 'number' && typeof state.value === 'number') {
          if (val < state.value) state.value = val
        }
      }
      break
    }

    case '$max': {
      const val = getFieldValue(doc, state.field!)
      if (val !== null && val !== undefined) {
        if (state.value === undefined) {
          state.value = val
        } else if (val instanceof Date && state.value instanceof Date) {
          if (val > state.value) state.value = val
        } else if (typeof val === 'string' && typeof state.value === 'string') {
          if (val > state.value) state.value = val
        } else if (typeof val === 'number' && typeof state.value === 'number') {
          if (val > state.value) state.value = val
        }
      }
      break
    }

    case '$first': {
      if (state.value === undefined) {
        if (state.field === '$$ROOT') {
          state.value = doc
        } else {
          state.value = getFieldValue(doc, state.field!)
        }
      }
      break
    }

    case '$last': {
      if (state.field === '$$ROOT') {
        state.value = doc
      } else {
        state.value = getFieldValue(doc, state.field!)
      }
      break
    }

    case '$push': {
      let val: unknown
      if (state.field === '$$ROOT') {
        val = doc
      } else {
        val = getFieldValue(doc, state.field!)
      }
      (state.values as unknown[]).push(val)
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

/**
 * Finalize accumulator value
 */
function finalizeAccumulator(state: AccumulatorState): unknown {
  if (state.type === '$avg') {
    if (state.count === 0) return null
    return (state.value as number) / state.count!
  }
  return state.value
}

// ============================================================================
// Group Stage Factory
// ============================================================================

/**
 * Create a $group stage
 */
export function createGroupStage<T>(spec: GroupSpec<T>): GroupStage<T> {
  return {
    name: '$group',
    specification: spec,

    process(input: T[]): unknown[] {
      if (input.length === 0) return []

      // Get accumulator field names (excluding _id)
      const accumulatorFields = Object.keys(spec).filter((k) => k !== '_id')

      // Group documents
      const groups = new Map<string, {
        key: unknown
        states: Map<string, AccumulatorState>
        order: number
      }>()

      let orderCounter = 0

      for (const doc of input) {
        const key = generateGroupKey(doc, spec._id)
        const keyStr = stringifyKey(key)

        if (!groups.has(keyStr)) {
          // Initialize accumulator states for this group
          const states = new Map<string, AccumulatorState>()
          for (const field of accumulatorFields) {
            const accDef = spec[field] as Accumulator
            states.set(field, initAccumulator(accDef))
          }
          groups.set(keyStr, { key, states, order: orderCounter++ })
        }

        // Update accumulators
        const group = groups.get(keyStr)!
        for (const field of accumulatorFields) {
          const state = group.states.get(field)!
          updateAccumulator(state, doc)
        }
      }

      // Build results in insertion order
      const results: unknown[] = []
      const sortedGroups = Array.from(groups.values()).sort((a, b) => a.order - b.order)

      for (const group of sortedGroups) {
        const result: Record<string, unknown> = { _id: group.key }

        for (const field of accumulatorFields) {
          const state = group.states.get(field)!
          result[field] = finalizeAccumulator(state)
        }

        results.push(result)
      }

      return results
    },
  }
}
