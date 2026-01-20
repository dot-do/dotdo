// Query Interface - fluent QueryBuilder for Things
// Implements SQL WHERE clause generation to prevent client-side filtering (do-5k2l)

import type { Thing, ThingsStore } from './things'

// Supported SQL operators for WHERE clauses
export type WhereOperator =
  | '='
  | '!='
  | '<'
  | '>'
  | '<='
  | '>='
  | 'LIKE'
  | 'IN'
  | 'NOT IN'
  | 'IS NULL'
  | 'IS NOT NULL'

// A where condition with operator support
export interface WhereCondition {
  field: string
  operator: WhereOperator
  value: unknown
}

export interface QueryOptions {
  type?: string
  where?: Record<string, unknown>
  whereConditions?: WhereCondition[]
  orderBy?: string
  order?: 'asc' | 'desc'
  limit?: number
  offset?: number
  select?: string[]
}

export interface QueryBuilder {
  type(type: string): QueryBuilder
  where(field: string, value: unknown): QueryBuilder
  where(conditions: Record<string, unknown>): QueryBuilder
  whereOp(field: string, operator: WhereOperator, value: unknown): QueryBuilder
  orderBy(field: string, order?: 'asc' | 'desc'): QueryBuilder
  limit(n: number): QueryBuilder
  offset(n: number): QueryBuilder
  select(...fields: string[]): QueryBuilder

  // Execute
  execute(): Promise<Thing[]>
  first(): Promise<Thing | null>
  count(): Promise<number>

  // For SQL stores - get the generated query info
  getQueryInfo(): { options: QueryOptions }
}

// Regex for validating field names (alphanumeric + underscore + $ prefix for system fields)
const VALID_FIELD_NAME = /^[$a-zA-Z_][a-zA-Z0-9_$]*$/

/**
 * Validates a field name to prevent SQL injection
 * Throws an error if the field name is invalid
 */
function validateFieldName(field: string): void {
  if (!VALID_FIELD_NAME.test(field)) {
    throw new Error(`Invalid field name: "${field}". Field names must be alphanumeric (with underscores) and start with a letter, underscore, or $.`)
  }
}

/**
 * Apply a where condition to filter a thing (client-side evaluation)
 * Used for in-memory stores or when SQL filtering is not available
 */
function matchesCondition(thing: Thing, condition: WhereCondition): boolean {
  const { field, operator, value } = condition
  const thingValue = thing[field]

  switch (operator) {
    case '=':
      return thingValue === value
    case '!=':
      return thingValue !== value
    case '<':
      return (thingValue as number) < (value as number)
    case '>':
      return (thingValue as number) > (value as number)
    case '<=':
      return (thingValue as number) <= (value as number)
    case '>=':
      return (thingValue as number) >= (value as number)
    case 'LIKE':
      if (typeof thingValue !== 'string' || typeof value !== 'string') return false
      // Convert SQL LIKE pattern to regex
      const pattern = value
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except % and _
        .replace(/%/g, '.*')
        .replace(/_/g, '.')
      return new RegExp(`^${pattern}$`, 'i').test(thingValue)
    case 'IN':
      if (!Array.isArray(value)) return false
      if (value.length === 0) return false
      return value.includes(thingValue)
    case 'NOT IN':
      if (!Array.isArray(value)) return true
      if (value.length === 0) return true
      return !value.includes(thingValue)
    case 'IS NULL':
      return thingValue === null || thingValue === undefined
    case 'IS NOT NULL':
      return thingValue !== null && thingValue !== undefined
    default:
      return false
  }
}

export function createQuery(store: ThingsStore): QueryBuilder {
  const options: QueryOptions = {
    whereConditions: []
  }

  const builder: QueryBuilder = {
    type(type: string) {
      options.type = type
      return builder
    },

    where(fieldOrConditions: string | Record<string, unknown>, value?: unknown) {
      if (typeof fieldOrConditions === 'string') {
        validateFieldName(fieldOrConditions)
        options.where = { ...options.where, [fieldOrConditions]: value }
        // Also add as a whereCondition with '=' operator for unified handling
        options.whereConditions!.push({
          field: fieldOrConditions,
          operator: '=',
          value
        })
      } else {
        // Validate all field names in the object
        for (const field of Object.keys(fieldOrConditions)) {
          validateFieldName(field)
        }
        options.where = { ...options.where, ...fieldOrConditions }
        // Add each as a whereCondition
        for (const [field, val] of Object.entries(fieldOrConditions)) {
          options.whereConditions!.push({
            field,
            operator: '=',
            value: val
          })
        }
      }
      return builder
    },

    whereOp(field: string, operator: WhereOperator, value: unknown) {
      validateFieldName(field)
      options.whereConditions!.push({ field, operator, value })
      return builder
    },

    orderBy(field: string, order: 'asc' | 'desc' = 'desc') {
      validateFieldName(field)
      options.orderBy = field
      options.order = order
      return builder
    },

    limit(n: number) {
      options.limit = n
      return builder
    },

    offset(n: number) {
      options.offset = n
      return builder
    },

    select(...fields: string[]) {
      for (const field of fields) {
        validateFieldName(field)
      }
      options.select = fields
      return builder
    },

    getQueryInfo() {
      return { options }
    },

    async execute(): Promise<Thing[]> {
      // Check if the store supports SQL-native queries
      // The SQLite store will implement queryWithConditions
      const sqlStore = store as ThingsStore & {
        queryWithConditions?: (options: QueryOptions) => Promise<Thing[]>
      }

      if (sqlStore.queryWithConditions) {
        // Use SQL-native filtering - much more efficient!
        return sqlStore.queryWithConditions(options)
      }

      // Fallback: In-memory filtering (for non-SQL stores or testing)
      // Get all things of the type
      let results = await store.list({
        type: options.type,
        limit: 1000 // Get more for filtering
      })

      // Apply whereConditions (unified filter handling)
      if (options.whereConditions && options.whereConditions.length > 0) {
        results = results.filter(thing => {
          return options.whereConditions!.every(condition =>
            matchesCondition(thing, condition)
          )
        })
      }

      // Apply ordering
      if (options.orderBy) {
        const field = options.orderBy
        const multiplier = options.order === 'asc' ? 1 : -1
        results.sort((a, b) => {
          const aVal = a[field] as string | number | boolean | null | undefined
          const bVal = b[field] as string | number | boolean | null | undefined
          if (aVal == null && bVal == null) return 0
          if (aVal == null) return 1 * multiplier
          if (bVal == null) return -1 * multiplier
          if (aVal < bVal) return -1 * multiplier
          if (aVal > bVal) return 1 * multiplier
          return 0
        })
      }

      // Apply pagination
      const offset = options.offset || 0
      const limit = options.limit || 100
      results = results.slice(offset, offset + limit)

      // Apply projection
      if (options.select && options.select.length > 0) {
        const fields = ['$id', '$type', ...options.select]
        results = results.map(thing => {
          const projected: Record<string, unknown> = {}
          for (const field of fields) {
            if (field in thing) {
              projected[field] = thing[field]
            }
          }
          return projected as Thing
        })
      }

      return results
    },

    async first(): Promise<Thing | null> {
      const results = await builder.limit(1).execute()
      return results[0] || null
    },

    async count(): Promise<number> {
      // Check if the store supports SQL-native count
      const sqlStore = store as ThingsStore & {
        countWithConditions?: (options: QueryOptions) => Promise<number>
      }

      if (sqlStore.countWithConditions) {
        return sqlStore.countWithConditions(options)
      }

      // Fallback: For accurate count, we need to execute without limit
      const originalLimit = options.limit
      options.limit = 10000
      const results = await builder.execute()
      options.limit = originalLimit
      return results.length
    }
  }

  return builder
}

// Convenience function
export function query(store: ThingsStore): QueryBuilder {
  return createQuery(store)
}

// ============================================================
// SQL WHERE clause generation utilities
// Used by SQLite-backed stores for efficient database queries
// ============================================================

/**
 * Builds SQL WHERE clause and parameters from QueryOptions
 * Returns { clause: string, params: unknown[] }
 *
 * IMPORTANT: This uses parameterized queries to prevent SQL injection.
 * Field names are validated with VALID_FIELD_NAME regex.
 * Values are bound as parameters, never interpolated into SQL.
 */
export function buildWhereClause(options: QueryOptions): {
  clause: string
  params: unknown[]
} {
  const clauses: string[] = []
  const params: unknown[] = []

  // Handle type filter
  if (options.type) {
    clauses.push('type = ?')
    params.push(options.type)
  }

  // Handle whereConditions
  if (options.whereConditions && options.whereConditions.length > 0) {
    for (const condition of options.whereConditions) {
      const { field, operator, value } = condition

      // Map field names - $type, $id etc. map to columns
      const sqlField = mapFieldToColumn(field)

      switch (operator) {
        case '=':
        case '!=':
        case '<':
        case '>':
        case '<=':
        case '>=':
          // For JSON-stored fields, use json_extract
          if (isJsonField(field)) {
            clauses.push(`json_extract(data, '$.${field}') ${operator} ?`)
          } else {
            clauses.push(`${sqlField} ${operator} ?`)
          }
          params.push(value)
          break

        case 'LIKE':
          if (isJsonField(field)) {
            clauses.push(`json_extract(data, '$.${field}') LIKE ?`)
          } else {
            clauses.push(`${sqlField} LIKE ?`)
          }
          params.push(value)
          break

        case 'IN':
          if (!Array.isArray(value) || value.length === 0) {
            // Empty IN clause - always false
            clauses.push('1 = 0')
          } else {
            const placeholders = value.map(() => '?').join(', ')
            if (isJsonField(field)) {
              clauses.push(`json_extract(data, '$.${field}') IN (${placeholders})`)
            } else {
              clauses.push(`${sqlField} IN (${placeholders})`)
            }
            params.push(...value)
          }
          break

        case 'NOT IN':
          if (!Array.isArray(value) || value.length === 0) {
            // Empty NOT IN clause - always true (no-op)
            // Don't add any clause
          } else {
            const placeholders = value.map(() => '?').join(', ')
            if (isJsonField(field)) {
              clauses.push(`json_extract(data, '$.${field}') NOT IN (${placeholders})`)
            } else {
              clauses.push(`${sqlField} NOT IN (${placeholders})`)
            }
            params.push(...value)
          }
          break

        case 'IS NULL':
          if (isJsonField(field)) {
            clauses.push(`(json_extract(data, '$.${field}') IS NULL OR json_type(data, '$.${field}') = 'null')`)
          } else {
            clauses.push(`${sqlField} IS NULL`)
          }
          break

        case 'IS NOT NULL':
          if (isJsonField(field)) {
            clauses.push(`(json_extract(data, '$.${field}') IS NOT NULL AND json_type(data, '$.${field}') != 'null')`)
          } else {
            clauses.push(`${sqlField} IS NOT NULL`)
          }
          break
      }
    }
  }

  const clause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  return { clause, params }
}

/**
 * Maps a Thing field name to the corresponding SQL column name
 */
function mapFieldToColumn(field: string): string {
  switch (field) {
    case '$id':
      return 'id'
    case '$type':
      return 'type'
    case '$createdAt':
      return 'created_at'
    case '$updatedAt':
      return 'updated_at'
    default:
      return field
  }
}

/**
 * Checks if a field is stored in the JSON data column
 * System fields ($id, $type, etc.) are stored as regular columns
 */
function isJsonField(field: string): boolean {
  return !field.startsWith('$')
}

/**
 * Builds the ORDER BY clause
 */
export function buildOrderByClause(options: QueryOptions): string {
  if (!options.orderBy) {
    return 'ORDER BY created_at DESC'
  }

  const sqlField = isJsonField(options.orderBy)
    ? `json_extract(data, '$.${options.orderBy}')`
    : mapFieldToColumn(options.orderBy)

  const direction = options.order === 'asc' ? 'ASC' : 'DESC'
  return `ORDER BY ${sqlField} ${direction}`
}

/**
 * Builds pagination clause
 */
export function buildPaginationClause(options: QueryOptions): {
  clause: string
  params: unknown[]
} {
  const limit = options.limit || 100
  const offset = options.offset || 0
  return {
    clause: 'LIMIT ? OFFSET ?',
    params: [limit, offset]
  }
}
