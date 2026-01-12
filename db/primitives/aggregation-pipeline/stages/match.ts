/**
 * $match Stage - MongoDB-style filtering
 *
 * Supports:
 * - Exact value matching
 * - Comparison operators ($gt, $gte, $lt, $lte, $eq, $ne)
 * - Range operators ($in, $nin, $between)
 * - Compound conditions ($and, $or, $nor, $not)
 * - Nested field access (dot notation)
 * - Regex matching ($regex, $options)
 * - Array operators ($elemMatch, $all, $size)
 * - Existence operators ($exists)
 * - Type operators ($type)
 */

import type { Stage } from '../index'
import type { ComparisonOp, Predicate } from '../../typed-column-store'

// ============================================================================
// Types
// ============================================================================

/**
 * Comparison operator expressions
 */
export interface ComparisonOperators<T = unknown> {
  $eq?: T
  $ne?: T
  $gt?: T
  $gte?: T
  $lt?: T
  $lte?: T
  $in?: T[]
  $nin?: T[]
  $between?: [T, T]
}

/**
 * Regex operators
 */
export interface RegexOperators {
  $regex?: RegExp | string
  $options?: string
}

/**
 * Array operators
 */
export interface ArrayOperators<T = unknown> {
  $elemMatch?: FieldPredicate<T>
  $all?: T[]
  $size?: number
}

/**
 * Existence and type operators
 */
export interface ExistenceOperators {
  $exists?: boolean
  $type?: string
}

/**
 * Negation operator
 */
export interface NotOperator<T = unknown> {
  $not?: FieldPredicate<T>
}

/**
 * Field-level predicate (combination of operators or direct value)
 */
export type FieldPredicate<T = unknown> =
  | T
  | ComparisonOperators<T>
  | RegexOperators
  | ArrayOperators<T>
  | ExistenceOperators
  | NotOperator<T>

/**
 * Compound predicate with logical operators
 */
export interface CompoundPredicate<T> {
  $and?: MatchPredicate<T>[]
  $or?: MatchPredicate<T>[]
  $nor?: MatchPredicate<T>[]
}

/**
 * Complete match predicate
 */
export type MatchPredicate<T> = {
  [K in keyof T]?: FieldPredicate<T[K]>
} & CompoundPredicate<T> & {
  // Allow dot notation for nested fields
  [key: string]: unknown
}

/**
 * Match stage interface
 */
export interface MatchStage<T> extends Stage<T, T> {
  name: '$match'
  predicate: MatchPredicate<T>
  toColumnStorePredicate(): Predicate
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) return undefined

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
 * Check if a value is a comparison operator object
 */
function isOperatorObject(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const keys = Object.keys(value)
  return keys.some((k) => k.startsWith('$'))
}

/**
 * Evaluate a field predicate against a value
 */
function evaluateFieldPredicate(value: unknown, predicate: FieldPredicate<unknown>): boolean {
  // Handle null/undefined predicates
  if (predicate === null) {
    return value === null
  }
  if (predicate === undefined) {
    return value === undefined
  }

  // Handle RegExp directly
  if (predicate instanceof RegExp) {
    return typeof value === 'string' && predicate.test(value)
  }

  // Handle non-operator predicates (direct value matching)
  if (typeof predicate !== 'object') {
    // For arrays, check if the predicate value is in the array
    if (Array.isArray(value)) {
      return value.includes(predicate)
    }
    return value === predicate
  }

  // Handle Date objects
  if (predicate instanceof Date) {
    if (value instanceof Date) {
      return value.getTime() === predicate.getTime()
    }
    return false
  }

  // Handle operator objects
  const ops = predicate as Record<string, unknown>

  // Check each operator
  for (const op of Object.keys(ops)) {
    const opValue = ops[op]

    switch (op) {
      case '$eq':
        if (opValue instanceof Date && value instanceof Date) {
          if (value.getTime() !== opValue.getTime()) return false
        } else if (value !== opValue) {
          return false
        }
        break

      case '$ne':
        if (value === opValue) return false
        break

      case '$gt':
        if (value instanceof Date && opValue instanceof Date) {
          if (value.getTime() <= opValue.getTime()) return false
        } else {
          if ((value as number) <= (opValue as number)) return false
        }
        break

      case '$gte':
        if (value instanceof Date && opValue instanceof Date) {
          if (value.getTime() < opValue.getTime()) return false
        } else {
          if ((value as number) < (opValue as number)) return false
        }
        break

      case '$lt':
        if (value instanceof Date && opValue instanceof Date) {
          if (value.getTime() >= opValue.getTime()) return false
        } else {
          if ((value as number) >= (opValue as number)) return false
        }
        break

      case '$lte':
        if (value instanceof Date && opValue instanceof Date) {
          if (value.getTime() > opValue.getTime()) return false
        } else {
          if ((value as number) > (opValue as number)) return false
        }
        break

      case '$in':
        if (!Array.isArray(opValue)) return false
        if (!opValue.includes(value)) return false
        break

      case '$nin':
        if (!Array.isArray(opValue)) return false
        if (opValue.includes(value)) return false
        break

      case '$between':
        if (!Array.isArray(opValue) || opValue.length !== 2) return false
        if ((value as number) < (opValue[0] as number) || (value as number) > (opValue[1] as number)) {
          return false
        }
        break

      case '$regex': {
        if (typeof value !== 'string') return false
        let regex: RegExp
        if (opValue instanceof RegExp) {
          regex = opValue
        } else {
          const options = (ops.$options as string) || ''
          regex = new RegExp(opValue as string, options)
        }
        if (!regex.test(value)) return false
        break
      }

      case '$options':
        // Handled with $regex
        break

      case '$exists':
        if (opValue === true && value === undefined) return false
        if (opValue === false && value !== undefined) return false
        break

      case '$type':
        if (typeof value !== opValue) return false
        break

      case '$elemMatch':
        if (!Array.isArray(value)) return false
        const elemPredicate = opValue as FieldPredicate<unknown>
        if (!value.some((elem) => evaluateFieldPredicate(elem, elemPredicate))) {
          return false
        }
        break

      case '$all':
        if (!Array.isArray(value) || !Array.isArray(opValue)) return false
        for (const item of opValue) {
          if (!value.includes(item)) return false
        }
        break

      case '$size':
        if (!Array.isArray(value)) return false
        if (value.length !== opValue) return false
        break

      case '$not':
        if (evaluateFieldPredicate(value, opValue as FieldPredicate<unknown>)) {
          return false
        }
        break

      default:
        // Check if it's a nested object predicate (not starting with $)
        if (!op.startsWith('$') && typeof opValue !== 'undefined') {
          // This is a nested object match like { customer: { tier: 'gold' } }
          const nestedValue = (value as Record<string, unknown>)?.[op]
          if (!evaluateFieldPredicate(nestedValue, opValue as FieldPredicate<unknown>)) {
            return false
          }
        }
    }
  }

  return true
}

/**
 * Evaluate a complete predicate against a document
 */
function evaluatePredicate<T>(doc: T, predicate: MatchPredicate<T>): boolean {
  // Handle $and
  if (predicate.$and) {
    for (const subPredicate of predicate.$and) {
      if (!evaluatePredicate(doc, subPredicate)) {
        return false
      }
    }
  }

  // Handle $or
  if (predicate.$or) {
    let anyMatch = false
    for (const subPredicate of predicate.$or) {
      if (evaluatePredicate(doc, subPredicate)) {
        anyMatch = true
        break
      }
    }
    if (!anyMatch) return false
  }

  // Handle $nor
  if (predicate.$nor) {
    for (const subPredicate of predicate.$nor) {
      if (evaluatePredicate(doc, subPredicate)) {
        return false
      }
    }
  }

  // Handle field predicates
  for (const [field, fieldPredicate] of Object.entries(predicate)) {
    // Skip compound operators
    if (field === '$and' || field === '$or' || field === '$nor') continue

    // Get the field value (supports dot notation)
    const value = field.includes('.')
      ? getNestedValue(doc, field)
      : (doc as Record<string, unknown>)[field]

    // Evaluate the field predicate
    if (!evaluateFieldPredicate(value, fieldPredicate as FieldPredicate<unknown>)) {
      return false
    }
  }

  return true
}

/**
 * Convert a match predicate to TypedColumnStore Predicate format
 */
function toColumnStorePredicate<T>(predicate: MatchPredicate<T>): Predicate {
  // Find the first simple field predicate
  for (const [field, fieldPredicate] of Object.entries(predicate)) {
    if (field.startsWith('$')) continue

    if (fieldPredicate && typeof fieldPredicate === 'object' && !Array.isArray(fieldPredicate)) {
      const ops = fieldPredicate as Record<string, unknown>
      const opKeys = Object.keys(ops).filter((k) => k.startsWith('$'))

      if (opKeys.length > 0) {
        const op = opKeys[0]
        const value = ops[op]

        const opMap: Record<string, ComparisonOp> = {
          $eq: '=',
          $ne: '!=',
          $gt: '>',
          $lt: '<',
          $gte: '>=',
          $lte: '<=',
          $in: 'in',
          $between: 'between',
        }

        return {
          column: field,
          op: opMap[op] || '=',
          value,
        }
      }
    }

    // Direct value equality
    return {
      column: field,
      op: '=',
      value: fieldPredicate,
    }
  }

  // Default fallback
  return {
    column: '',
    op: '=',
    value: null,
  }
}

// ============================================================================
// Match Stage Factory
// ============================================================================

/**
 * Create a $match stage
 */
export function createMatchStage<T>(predicate: MatchPredicate<T>): MatchStage<T> {
  return {
    name: '$match',
    predicate,

    process(input: T[]): T[] {
      // Empty predicate matches all
      if (Object.keys(predicate).length === 0) {
        return input
      }

      return input.filter((doc) => evaluatePredicate(doc, predicate))
    },

    toColumnStorePredicate(): Predicate {
      return toColumnStorePredicate(predicate)
    },
  }
}
