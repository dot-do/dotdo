/**
 * Query Builder for DrizzleStorageStrategy
 *
 * Translates Payload where clauses into Drizzle query conditions.
 * Handles operators, sorting, pagination, and relationship JOINs.
 *
 * @module @dotdo/payload/strategies/drizzle/query-builder
 */

import { sql, eq, ne, gt, gte, lt, lte, like, inArray, notInArray, isNull, isNotNull, and, or, asc, desc } from 'drizzle-orm'
import type { SQL, SQLWrapper } from 'drizzle-orm'
import type { SQLiteTableWithColumns, SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { WhereClause, WhereOperator } from '../types'
import type { PayloadField } from '../../adapter/types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Query builder configuration
 */
export interface QueryBuilderConfig {
  /** The main table to query */
  table: SQLiteTableWithColumns<any>
  /** Field definitions for type information */
  fields?: PayloadField[]
  /** Relation tables for JOINs */
  relationTables?: Map<string, SQLiteTableWithColumns<any>>
  /** Array tables for JOINs */
  arrayTables?: Map<string, SQLiteTableWithColumns<any>>
}

/**
 * Built query result
 */
export interface BuiltQuery {
  /** WHERE conditions to apply */
  conditions: SQL | undefined
  /** ORDER BY expressions */
  orderBy: SQL | undefined
  /** Fields that require JOINs */
  joinFields: string[]
}

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc'

/**
 * Parsed sort field
 */
export interface ParsedSort {
  field: string
  direction: SortDirection
}

// ============================================================================
// QUERY BUILDER CLASS
// ============================================================================

/**
 * Builds Drizzle queries from Payload query parameters.
 *
 * Translates Payload's where clause format into Drizzle conditions,
 * handles sorting with direction prefix, and identifies fields that
 * require JOINs for relationship queries.
 */
export class QueryBuilder {
  private table: SQLiteTableWithColumns<any>
  private fields: Map<string, PayloadField>
  private relationTables: Map<string, SQLiteTableWithColumns<any>>
  private arrayTables: Map<string, SQLiteTableWithColumns<any>>

  constructor(config: QueryBuilderConfig) {
    this.table = config.table
    this.fields = new Map()
    this.relationTables = config.relationTables ?? new Map()
    this.arrayTables = config.arrayTables ?? new Map()

    // Build field map
    if (config.fields) {
      for (const field of config.fields) {
        this.fields.set(field.name, field)
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Build a complete query from Payload parameters.
   *
   * @param where - Payload where clause
   * @param sort - Sort string (e.g., '-createdAt' for descending)
   * @returns Built query with conditions and order
   */
  build(where?: WhereClause, sort?: string): BuiltQuery {
    const conditions = where ? this.buildWhere(where) : undefined
    const orderBy = sort ? this.buildSort(sort) : undefined
    const joinFields = where ? this.identifyJoinFields(where) : []

    return { conditions, orderBy, joinFields }
  }

  /**
   * Build WHERE conditions from Payload where clause.
   *
   * @param where - Payload where clause
   * @returns Drizzle SQL condition or undefined
   */
  buildWhere(where: WhereClause): SQL | undefined {
    const conditions: SQL[] = []

    // Handle AND
    if (where.and && Array.isArray(where.and)) {
      const andConditions = where.and
        .map((clause) => this.buildWhere(clause))
        .filter((c): c is SQL => c !== undefined)

      if (andConditions.length > 0) {
        conditions.push(and(...andConditions)!)
      }
    }

    // Handle OR
    if (where.or && Array.isArray(where.or)) {
      const orConditions = where.or
        .map((clause) => this.buildWhere(clause))
        .filter((c): c is SQL => c !== undefined)

      if (orConditions.length > 0) {
        conditions.push(or(...orConditions)!)
      }
    }

    // Handle field conditions
    for (const [fieldName, operators] of Object.entries(where)) {
      if (fieldName === 'and' || fieldName === 'or') continue
      if (!operators || typeof operators !== 'object') continue

      const fieldCondition = this.buildFieldConditions(fieldName, operators as WhereOperator)
      if (fieldCondition) {
        conditions.push(fieldCondition)
      }
    }

    if (conditions.length === 0) {
      return undefined
    }

    if (conditions.length === 1) {
      return conditions[0]
    }

    return and(...conditions)
  }

  /**
   * Build ORDER BY expression from sort string.
   *
   * @param sort - Sort string (e.g., 'name', '-createdAt')
   * @returns Drizzle SQL ORDER BY or undefined
   */
  buildSort(sort: string): SQL | undefined {
    const parsed = this.parseSort(sort)
    const column = this.getColumn(parsed.field)

    if (!column) {
      // Fall back to raw SQL for unknown columns
      return parsed.direction === 'desc'
        ? sql`${sql.raw(parsed.field)} DESC`
        : sql`${sql.raw(parsed.field)} ASC`
    }

    return parsed.direction === 'desc' ? desc(column) : asc(column)
  }

  /**
   * Parse sort string into field and direction.
   *
   * @param sort - Sort string (e.g., '-createdAt')
   * @returns Parsed sort with field and direction
   */
  parseSort(sort: string): ParsedSort {
    if (sort.startsWith('-')) {
      return { field: sort.slice(1), direction: 'desc' }
    }
    if (sort.startsWith('+')) {
      return { field: sort.slice(1), direction: 'asc' }
    }
    return { field: sort, direction: 'asc' }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FIELD CONDITIONS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Build conditions for a single field.
   */
  private buildFieldConditions(fieldName: string, operators: WhereOperator): SQL | undefined {
    const conditions: SQL[] = []
    const column = this.getColumn(fieldName)

    for (const [op, value] of Object.entries(operators)) {
      const condition = this.buildOperatorCondition(fieldName, column, op, value)
      if (condition) {
        conditions.push(condition)
      }
    }

    if (conditions.length === 0) {
      return undefined
    }

    if (conditions.length === 1) {
      return conditions[0]
    }

    return and(...conditions)
  }

  /**
   * Build a single operator condition.
   */
  private buildOperatorCondition(
    fieldName: string,
    column: SQLiteColumn | undefined,
    operator: string,
    value: unknown
  ): SQL | undefined {
    // If no column found, use raw SQL with JSON extraction
    if (!column) {
      return this.buildJsonCondition(fieldName, operator, value)
    }

    switch (operator) {
      case 'equals':
        if (value === null) {
          return isNull(column)
        }
        return eq(column, value as any)

      case 'not_equals':
        if (value === null) {
          return isNotNull(column)
        }
        return ne(column, value as any)

      case 'in':
        if (Array.isArray(value) && value.length > 0) {
          return inArray(column, value as any[])
        }
        return undefined

      case 'not_in':
        if (Array.isArray(value) && value.length > 0) {
          return notInArray(column, value as any[])
        }
        return undefined

      case 'greater_than':
        return gt(column, value as any)

      case 'greater_than_equal':
        return gte(column, value as any)

      case 'less_than':
        return lt(column, value as any)

      case 'less_than_equal':
        return lte(column, value as any)

      case 'like':
        return like(column, value as string)

      case 'contains':
        return like(column, `%${value}%`)

      case 'exists':
        return value === true ? isNotNull(column) : isNull(column)

      default:
        return undefined
    }
  }

  /**
   * Build a condition using JSON extraction for nested fields.
   */
  private buildJsonCondition(fieldPath: string, operator: string, value: unknown): SQL | undefined {
    const jsonPath = `$.${fieldPath}`

    switch (operator) {
      case 'equals':
        if (value === null) {
          return sql`json_extract(data, ${jsonPath}) IS NULL`
        }
        return sql`json_extract(data, ${jsonPath}) = ${JSON.stringify(value)}`

      case 'not_equals':
        if (value === null) {
          return sql`json_extract(data, ${jsonPath}) IS NOT NULL`
        }
        return sql`json_extract(data, ${jsonPath}) != ${JSON.stringify(value)}`

      case 'in':
        if (Array.isArray(value) && value.length > 0) {
          const vals = value.map((v) => JSON.stringify(v)).join(', ')
          return sql`json_extract(data, ${jsonPath}) IN (${sql.raw(vals)})`
        }
        return undefined

      case 'greater_than':
        return sql`json_extract(data, ${jsonPath}) > ${value}`

      case 'greater_than_equal':
        return sql`json_extract(data, ${jsonPath}) >= ${value}`

      case 'less_than':
        return sql`json_extract(data, ${jsonPath}) < ${value}`

      case 'less_than_equal':
        return sql`json_extract(data, ${jsonPath}) <= ${value}`

      case 'like':
        return sql`json_extract(data, ${jsonPath}) LIKE ${value}`

      case 'contains':
        return sql`json_extract(data, ${jsonPath}) LIKE ${`%${value}%`}`

      case 'exists':
        return value === true
          ? sql`json_extract(data, ${jsonPath}) IS NOT NULL`
          : sql`json_extract(data, ${jsonPath}) IS NULL`

      default:
        return undefined
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COLUMN ACCESS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a column reference from the table.
   */
  private getColumn(fieldName: string): SQLiteColumn | undefined {
    // Handle dot notation for nested fields
    const topLevelField = fieldName.split('.')[0]

    // Check if column exists on table
    const column = (this.table as any)[topLevelField]
    if (column && typeof column === 'object' && 'name' in column) {
      return column
    }

    return undefined
  }

  // ─────────────────────────────────────────────────────────────────────────
  // JOIN IDENTIFICATION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Identify fields in the where clause that require JOINs.
   *
   * Relationship fields and array fields stored in separate tables
   * need to be JOINed when queried.
   */
  private identifyJoinFields(where: WhereClause): string[] {
    const joinFields: string[] = []

    // Check AND clauses
    if (where.and && Array.isArray(where.and)) {
      for (const clause of where.and) {
        joinFields.push(...this.identifyJoinFields(clause))
      }
    }

    // Check OR clauses
    if (where.or && Array.isArray(where.or)) {
      for (const clause of where.or) {
        joinFields.push(...this.identifyJoinFields(clause))
      }
    }

    // Check field conditions
    for (const fieldName of Object.keys(where)) {
      if (fieldName === 'and' || fieldName === 'or') continue

      const field = this.fields.get(fieldName)
      if (!field) continue

      // Relationship fields with hasMany need JOINs
      if ((field.type === 'relationship' || field.type === 'upload') && field.hasMany) {
        if (this.relationTables.has(fieldName)) {
          joinFields.push(fieldName)
        }
      }

      // Complex array fields need JOINs
      if (field.type === 'array' && this.arrayTables.has(fieldName)) {
        joinFields.push(fieldName)
      }
    }

    return [...new Set(joinFields)]
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a QueryBuilder instance.
 *
 * @param config - Builder configuration
 * @returns Configured QueryBuilder
 */
export function createQueryBuilder(config: QueryBuilderConfig): QueryBuilder {
  return new QueryBuilder(config)
}

// ============================================================================
// STANDALONE FUNCTIONS
// ============================================================================

/**
 * Build WHERE conditions from a Payload where clause.
 *
 * Standalone function for simple use cases without full QueryBuilder.
 *
 * @param table - The table to query
 * @param where - Payload where clause
 * @returns Drizzle SQL condition or undefined
 */
export function buildWhereConditions(
  table: SQLiteTableWithColumns<any>,
  where: WhereClause
): SQL | undefined {
  const builder = new QueryBuilder({ table })
  return builder.buildWhere(where)
}

/**
 * Build ORDER BY from a sort string.
 *
 * @param table - The table to query
 * @param sort - Sort string (e.g., '-createdAt')
 * @returns Drizzle SQL ORDER BY or undefined
 */
export function buildOrderBy(
  table: SQLiteTableWithColumns<any>,
  sort: string
): SQL | undefined {
  const builder = new QueryBuilder({ table })
  return builder.buildSort(sort)
}

/**
 * Parse a sort string into field and direction.
 *
 * @param sort - Sort string (e.g., '-createdAt', 'name')
 * @returns Parsed sort info
 */
export function parseSort(sort: string): ParsedSort {
  if (sort.startsWith('-')) {
    return { field: sort.slice(1), direction: 'desc' }
  }
  if (sort.startsWith('+')) {
    return { field: sort.slice(1), direction: 'asc' }
  }
  return { field: sort, direction: 'asc' }
}

// ============================================================================
// PAGINATION HELPERS
// ============================================================================

/**
 * Calculate pagination offset from page and limit.
 *
 * @param page - Page number (1-indexed)
 * @param limit - Items per page
 * @returns Offset for SQL query
 */
export function calculateOffset(page: number, limit: number): number {
  return Math.max(0, (page - 1) * limit)
}

/**
 * Calculate total pages from total count and limit.
 *
 * @param totalDocs - Total document count
 * @param limit - Items per page
 * @returns Total number of pages
 */
export function calculateTotalPages(totalDocs: number, limit: number): number {
  return Math.max(1, Math.ceil(totalDocs / limit))
}

/**
 * Build pagination metadata.
 *
 * @param page - Current page
 * @param limit - Items per page
 * @param totalDocs - Total document count
 * @returns Pagination metadata
 */
export function buildPaginationMeta(page: number, limit: number, totalDocs: number) {
  const totalPages = calculateTotalPages(totalDocs, limit)

  return {
    page,
    limit,
    totalDocs,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  }
}
