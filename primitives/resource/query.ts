/**
 * Query DSL Implementation
 *
 * Provides filtering logic for the Resource abstraction.
 */

import type { Query, QueryOperators, Entity } from './types'

/**
 * Check if a value is a query operator object
 */
function isQueryOperator<T>(value: unknown): value is QueryOperators<T> {
  if (value === null || typeof value !== 'object') return false
  const keys = Object.keys(value as object)
  const operatorKeys = ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'in', 'nin', 'contains', 'startsWith', 'endsWith']
  return keys.some(k => operatorKeys.includes(k))
}

/**
 * Compare a field value against query operators
 */
function matchField<T>(fieldValue: T, condition: T | QueryOperators<T>): boolean {
  // Direct value comparison (shorthand for eq)
  if (!isQueryOperator<T>(condition)) {
    return fieldValue === condition
  }

  const ops = condition as QueryOperators<T>

  // eq operator
  if (ops.eq !== undefined && fieldValue !== ops.eq) {
    return false
  }

  // ne operator
  if (ops.ne !== undefined && fieldValue === ops.ne) {
    return false
  }

  // gt operator (works with numbers and dates)
  if (ops.gt !== undefined) {
    if (fieldValue instanceof Date && ops.gt instanceof Date) {
      if (fieldValue.getTime() <= ops.gt.getTime()) return false
    } else if (typeof fieldValue === 'number' && typeof ops.gt === 'number') {
      if (fieldValue <= ops.gt) return false
    } else {
      if (fieldValue as unknown <= (ops.gt as unknown)) return false
    }
  }

  // lt operator
  if (ops.lt !== undefined) {
    if (fieldValue instanceof Date && ops.lt instanceof Date) {
      if (fieldValue.getTime() >= ops.lt.getTime()) return false
    } else if (typeof fieldValue === 'number' && typeof ops.lt === 'number') {
      if (fieldValue >= ops.lt) return false
    } else {
      if (fieldValue as unknown >= (ops.lt as unknown)) return false
    }
  }

  // gte operator
  if (ops.gte !== undefined) {
    if (fieldValue instanceof Date && ops.gte instanceof Date) {
      if (fieldValue.getTime() < ops.gte.getTime()) return false
    } else if (typeof fieldValue === 'number' && typeof ops.gte === 'number') {
      if (fieldValue < ops.gte) return false
    } else {
      if (fieldValue as unknown < (ops.gte as unknown)) return false
    }
  }

  // lte operator
  if (ops.lte !== undefined) {
    if (fieldValue instanceof Date && ops.lte instanceof Date) {
      if (fieldValue.getTime() > ops.lte.getTime()) return false
    } else if (typeof fieldValue === 'number' && typeof ops.lte === 'number') {
      if (fieldValue > ops.lte) return false
    } else {
      if (fieldValue as unknown > (ops.lte as unknown)) return false
    }
  }

  // in operator
  if (ops.in !== undefined) {
    if (!ops.in.includes(fieldValue)) return false
  }

  // nin operator
  if (ops.nin !== undefined) {
    if (ops.nin.includes(fieldValue)) return false
  }

  // String operators (only work on string fields)
  if (typeof fieldValue === 'string') {
    // contains operator
    if (ops.contains !== undefined) {
      if (!fieldValue.includes(ops.contains)) return false
    }

    // startsWith operator
    if (ops.startsWith !== undefined) {
      if (!fieldValue.startsWith(ops.startsWith)) return false
    }

    // endsWith operator
    if (ops.endsWith !== undefined) {
      if (!fieldValue.endsWith(ops.endsWith)) return false
    }
  }

  return true
}

/**
 * Check if an entity matches a query
 * All conditions must match (AND logic)
 */
export function matchesQuery<T extends Entity>(entity: T, query?: Query<T>): boolean {
  if (!query) return true

  for (const [key, condition] of Object.entries(query)) {
    if (condition === undefined) continue

    const fieldValue = entity[key as keyof T]
    if (!matchField(fieldValue, condition as T[keyof T] | QueryOperators<T[keyof T]>)) {
      return false
    }
  }

  return true
}
