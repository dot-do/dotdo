/**
 * Query Builder for Payload Database Adapter
 *
 * Translates Payload CMS where clauses to Drizzle ORM queries.
 * Supports MongoDB-like query syntax with operators:
 * - equals, not_equals
 * - in, not_in
 * - greater_than, greater_than_equal, less_than, less_than_equal
 * - like, contains
 * - exists
 * - and, or (logical operators)
 *
 * @module @dotdo/payload/adapter/query-builder
 */

import { sql, eq, ne, inArray, notInArray, gt, gte, lt, lte, like, and, or, isNull, isNotNull } from 'drizzle-orm'
import type { SQL, SQLWrapper } from 'drizzle-orm'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Payload where clause operator definitions
 */
export interface WhereOperator {
  equals?: unknown
  not_equals?: unknown
  in?: unknown[]
  not_in?: unknown[]
  greater_than?: number | string | Date
  greater_than_equal?: number | string | Date
  less_than?: number | string | Date
  less_than_equal?: number | string | Date
  like?: string
  contains?: string
  exists?: boolean
}

/**
 * Payload where clause structure
 * Supports field operators and logical AND/OR
 */
export interface WhereClause {
  [field: string]: WhereOperator | WhereClause[] | undefined
  and?: WhereClause[]
  or?: WhereClause[]
}

/**
 * Table type with column references for optimization
 */
export interface QueryTable {
  [column: string]: SQLWrapper | undefined
  data?: SQLWrapper
}

// ============================================================================
// PATH UTILITIES
// ============================================================================

/**
 * Validate a field path format
 * @throws Error if the path is invalid
 */
export function validateFieldPath(path: string): void {
  if (!path || path.length === 0) {
    throw new Error('Field path cannot be empty')
  }
  if (path.startsWith('.')) {
    throw new Error('Field path cannot start with a dot')
  }
  if (path.includes('..')) {
    throw new Error('Field path cannot contain consecutive dots')
  }
}

/**
 * Convert a dot-notation field path to a JSON path for SQLite json_extract
 * Handles both object property access (dot) and array indices (numeric segments)
 *
 * @example
 * toJsonPath('status') // '$.status'
 * toJsonPath('meta.featured') // '$.meta.featured'
 * toJsonPath('tags.0') // '$.tags[0]'
 * toJsonPath('blocks.0.content.text') // '$.blocks[0].content.text'
 */
export function toJsonPath(field: string): string {
  validateFieldPath(field)

  const parts = field.split('.')
  let path = '$'

  for (const part of parts) {
    // Check if the part is a numeric index
    if (/^\d+$/.test(part)) {
      path += `[${part}]`
    } else {
      path += `.${part}`
    }
  }

  return path
}

// ============================================================================
// FIELD REFERENCE UTILITIES
// ============================================================================

/**
 * Get a SQL reference to a field, using direct column access when available
 * or falling back to json_extract for nested/data fields
 */
export function getFieldRef(field: string, table: QueryTable): SQL {
  // Direct column access for top-level indexed fields
  const isNested = field.includes('.')

  if (!isNested && table[field]) {
    // Use direct column reference if available
    return sql`${table[field]}`
  }

  // Fall back to json_extract for nested or data fields
  const jsonPath = toJsonPath(field)
  const dataCol = table.data || sql`data`
  return sql`json_extract(${dataCol}, ${jsonPath})`
}

// ============================================================================
// OPERATOR HANDLERS
// ============================================================================

/**
 * Build a SQL condition for a single field with operators
 */
export function buildFieldCondition(field: string, ops: WhereOperator, table: QueryTable): SQL | undefined {
  const conditions: SQL[] = []
  const fieldRef = getFieldRef(field, table)

  // Handle each operator
  for (const [op, value] of Object.entries(ops)) {
    const condition = buildOperatorCondition(fieldRef, op, value)
    if (condition) {
      conditions.push(condition)
    }
  }

  // Multiple operators on same field are ANDed together
  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]
  return and(...conditions)
}

/**
 * Build a SQL condition for a single operator
 */
function buildOperatorCondition(fieldRef: SQL, op: string, value: unknown): SQL | undefined {
  switch (op) {
    case 'equals':
      if (value === null) {
        return isNull(fieldRef)
      }
      return eq(fieldRef, value)

    case 'not_equals':
      if (value === null) {
        return isNotNull(fieldRef)
      }
      return ne(fieldRef, value)

    case 'in':
      if (!Array.isArray(value)) return undefined
      if (value.length === 0) {
        // Empty IN is always false - use impossible condition
        return sql`1 = 0`
      }
      return inArray(fieldRef, value)

    case 'not_in':
      if (!Array.isArray(value)) return undefined
      if (value.length === 0) {
        // Empty NOT IN is always true
        return sql`1 = 1`
      }
      return notInArray(fieldRef, value)

    case 'greater_than':
      return gt(fieldRef, value)

    case 'greater_than_equal':
      return gte(fieldRef, value)

    case 'less_than':
      return lt(fieldRef, value)

    case 'less_than_equal':
      return lte(fieldRef, value)

    case 'like':
      return like(fieldRef, value as string)

    case 'contains':
      // contains is syntactic sugar for LIKE with wildcards
      return like(fieldRef, `%${value}%`)

    case 'exists':
      return value === true ? isNotNull(fieldRef) : isNull(fieldRef)

    default:
      throw new Error(`Unknown operator: ${op}`)
  }
}

// ============================================================================
// WHERE CLAUSE BUILDER
// ============================================================================

/**
 * Build a Drizzle SQL condition from a Payload where clause
 *
 * @param where - Payload where clause object
 * @param table - Drizzle table reference with column definitions
 * @returns SQL condition or undefined if no conditions
 *
 * @example
 * // Simple equals
 * buildWhere({ status: { equals: 'published' } }, things)
 *
 * // AND/OR logic
 * buildWhere({
 *   and: [
 *     { status: { equals: 'published' } },
 *     { or: [
 *       { featured: { equals: true } },
 *       { pinned: { equals: true } }
 *     ]}
 *   ]
 * }, things)
 */
export function buildWhere(where: WhereClause | undefined, table: QueryTable): SQL | undefined {
  if (!where || Object.keys(where).length === 0) {
    return undefined
  }

  const conditions: SQL[] = []

  // Handle explicit AND
  if (where.and && Array.isArray(where.and)) {
    if (where.and.length === 0) {
      // Empty AND is always true (matches all)
      // Don't add any condition
    } else {
      const andConditions = where.and
        .map(w => buildWhere(w, table))
        .filter((c): c is SQL => c !== undefined)

      if (andConditions.length > 0) {
        conditions.push(and(...andConditions)!)
      }
    }
  }

  // Handle explicit OR
  if (where.or && Array.isArray(where.or)) {
    if (where.or.length === 0) {
      // Empty OR is always false (matches none)
      conditions.push(sql`1 = 0`)
    } else {
      const orConditions = where.or
        .map(w => buildWhere(w, table))
        .filter((c): c is SQL => c !== undefined)

      if (orConditions.length > 0) {
        conditions.push(or(...orConditions)!)
      }
    }
  }

  // Handle field operators (implicit AND between fields)
  for (const [field, operators] of Object.entries(where)) {
    if (field === 'and' || field === 'or') continue
    if (!operators || typeof operators !== 'object') continue

    const fieldCondition = buildFieldCondition(field, operators as WhereOperator, table)
    if (fieldCondition) {
      conditions.push(fieldCondition)
    }
  }

  // Combine all conditions with AND
  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]
  return and(...conditions)
}

// ============================================================================
// SORT BUILDER
// ============================================================================

/**
 * Build a sort clause from a Payload sort string or array
 *
 * @param sort - Sort field(s): 'field' for ASC, '-field' for DESC
 * @param table - Drizzle table reference with column definitions
 * @returns SQL sort clause(s) or undefined
 *
 * @example
 * buildSort('createdAt', things) // ORDER BY createdAt ASC
 * buildSort('-createdAt', things) // ORDER BY createdAt DESC
 * buildSort(['status', '-createdAt'], things) // ORDER BY status ASC, createdAt DESC
 */
export function buildSort(sort: string | string[] | undefined, table: QueryTable): SQL | SQL[] | undefined {
  if (!sort) return undefined

  // Handle array of sort fields
  if (Array.isArray(sort)) {
    const sortClauses = sort
      .map(s => buildSingleSort(s, table))
      .filter((s): s is SQL => s !== undefined)

    if (sortClauses.length === 0) return undefined
    if (sortClauses.length === 1) return sortClauses[0]
    return sortClauses
  }

  // Handle single sort field
  return buildSingleSort(sort, table)
}

/**
 * Build a single sort clause
 */
function buildSingleSort(sort: string, table: QueryTable): SQL | undefined {
  if (!sort) return undefined

  const isDesc = sort.startsWith('-')
  const field = isDesc ? sort.slice(1) : sort

  const fieldRef = getFieldRef(field, table)

  return isDesc ? sql`${fieldRef} DESC` : sql`${fieldRef} ASC`
}
