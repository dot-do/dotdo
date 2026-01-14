/**
 * Query Compiler for Document Store
 *
 * Translates MongoDB-style query operators into SQL predicates for efficient
 * querying against SQLite-backed storage (TypedColumnStore).
 *
 * ## Features
 * - MongoDB operator translation ($eq, $gt, $gte, $lt, $lte, $in, $nin, $ne)
 * - Logical operator support ($and, $or, $not, $nor)
 * - Nested field path support (up to 3 levels: a.b.c)
 * - Index hint generation for optimal query planning
 * - SQL parameter binding for injection safety
 *
 * ## Architecture
 *
 * The query compiler produces:
 * - SQL WHERE clause fragments
 * - Bound parameters (for prepared statements)
 * - Index hints for query optimization
 * - Predicate functions for in-memory filtering fallback
 *
 * @module db/primitives/document-store/query-compiler
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Supported MongoDB comparison operators
 */
export type ComparisonOperator = '$eq' | '$ne' | '$gt' | '$gte' | '$lt' | '$lte' | '$in' | '$nin'

/**
 * Supported MongoDB logical operators
 */
export type LogicalOperator = '$and' | '$or' | '$not' | '$nor'

/**
 * Supported MongoDB element operators
 */
export type ElementOperator = '$exists' | '$type'

/**
 * Supported MongoDB array operators
 */
export type ArrayOperator = '$all' | '$elemMatch' | '$size'

/**
 * Supported MongoDB evaluation operators
 */
export type EvaluationOperator = '$regex' | '$mod'

/**
 * All supported operators
 */
export type QueryOperator =
  | ComparisonOperator
  | LogicalOperator
  | ElementOperator
  | ArrayOperator
  | EvaluationOperator

/**
 * Query filter type (MongoDB-style)
 */
export interface QueryFilter {
  [key: string]: unknown
}

/**
 * Field operator expression
 */
export interface FieldOperators {
  $eq?: unknown
  $ne?: unknown
  $gt?: unknown
  $gte?: unknown
  $lt?: unknown
  $lte?: unknown
  $in?: unknown[]
  $nin?: unknown[]
  $exists?: boolean
  $type?: string
  $regex?: string | RegExp
  $options?: string
  $all?: unknown[]
  $elemMatch?: QueryFilter
  $size?: number
  $mod?: [number, number]
  $not?: FieldOperators
}

/**
 * Compiled query result
 */
export interface CompiledQuery {
  /** SQL WHERE clause (without WHERE keyword) */
  sql: string
  /** Bound parameters for the SQL query */
  params: unknown[]
  /** Field paths that could benefit from indexes */
  indexHints: string[]
  /** In-memory predicate function for fallback filtering */
  predicate: (doc: Record<string, unknown>) => boolean
  /** Whether the query can be fully executed in SQL */
  fullyIndexable: boolean
  /** Estimated selectivity (0-1, lower is more selective) */
  selectivity: number
}

/**
 * Index definition for query optimization
 */
export interface IndexDefinition {
  /** Index name */
  name: string
  /** Indexed field paths */
  fields: string[]
  /** Whether index is unique */
  unique?: boolean
  /** Whether index is sparse */
  sparse?: boolean
}

/**
 * Query compiler options
 */
export interface QueryCompilerOptions {
  /** Available indexes for optimization */
  indexes?: IndexDefinition[]
  /** Maximum nested field depth (default: 3) */
  maxFieldDepth?: number
  /** Column name for JSON document storage */
  documentColumn?: string
  /** Table name for SQL generation */
  tableName?: string
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_MAX_FIELD_DEPTH = 3
const DEFAULT_DOCUMENT_COLUMN = 'doc'
const DEFAULT_TABLE_NAME = 'documents'

/** SQL operator mappings */
const SQL_OPERATORS: Record<ComparisonOperator, string> = {
  $eq: '=',
  $ne: '!=',
  $gt: '>',
  $gte: '>=',
  $lt: '<',
  $lte: '<=',
  $in: 'IN',
  $nin: 'NOT IN',
}

/** Type mappings for $type operator */
const BSON_TYPE_MAP: Record<string, string[]> = {
  string: ['text'],
  number: ['real', 'integer'],
  int: ['integer'],
  long: ['integer'],
  double: ['real'],
  decimal: ['real'],
  bool: ['integer'], // SQLite stores booleans as 0/1
  boolean: ['integer'],
  object: ['text'], // JSON objects stored as text
  array: ['text'], // JSON arrays stored as text
  null: ['null'],
  date: ['text', 'integer'], // ISO string or timestamp
}

// =============================================================================
// QUERY COMPILER CLASS
// =============================================================================

/**
 * MongoDB to SQL Query Compiler
 *
 * Compiles MongoDB-style query filters into SQL WHERE clauses with
 * parameter binding and index optimization hints.
 */
export class QueryCompiler {
  private readonly options: Required<QueryCompilerOptions>
  private paramCounter: number = 0

  constructor(options: QueryCompilerOptions = {}) {
    this.options = {
      indexes: options.indexes ?? [],
      maxFieldDepth: options.maxFieldDepth ?? DEFAULT_MAX_FIELD_DEPTH,
      documentColumn: options.documentColumn ?? DEFAULT_DOCUMENT_COLUMN,
      tableName: options.tableName ?? DEFAULT_TABLE_NAME,
    }
  }

  /**
   * Compile a MongoDB-style filter into a SQL query
   */
  compile(filter: QueryFilter): CompiledQuery {
    this.paramCounter = 0
    const params: unknown[] = []
    const indexHints: string[] = []
    let fullyIndexable = true

    const { sql, predicate, indexable } = this.compileFilter(filter, params, indexHints)

    if (!indexable) {
      fullyIndexable = false
    }

    return {
      sql: sql || '1=1', // Empty filter matches all
      params,
      indexHints: [...new Set(indexHints)],
      predicate,
      fullyIndexable,
      selectivity: this.estimateSelectivity(filter),
    }
  }

  /**
   * Compile a filter expression
   */
  private compileFilter(
    filter: QueryFilter,
    params: unknown[],
    indexHints: string[]
  ): { sql: string; predicate: (doc: Record<string, unknown>) => boolean; indexable: boolean } {
    if (!filter || Object.keys(filter).length === 0) {
      return { sql: '', predicate: () => true, indexable: true }
    }

    const clauses: string[] = []
    const predicates: Array<(doc: Record<string, unknown>) => boolean> = []
    let allIndexable = true

    for (const [key, value] of Object.entries(filter)) {
      if (key.startsWith('$')) {
        // Logical operator
        const { sql, predicate, indexable } = this.compileLogicalOperator(
          key as LogicalOperator,
          value,
          params,
          indexHints
        )
        if (sql) clauses.push(sql)
        predicates.push(predicate)
        if (!indexable) allIndexable = false
      } else {
        // Field condition
        const { sql, predicate, indexable } = this.compileFieldCondition(key, value, params, indexHints)
        if (sql) clauses.push(sql)
        predicates.push(predicate)
        if (!indexable) allIndexable = false
      }
    }

    return {
      sql: clauses.length > 0 ? clauses.join(' AND ') : '',
      predicate: (doc) => predicates.every((p) => p(doc)),
      indexable: allIndexable,
    }
  }

  /**
   * Compile a logical operator ($and, $or, $not, $nor)
   */
  private compileLogicalOperator(
    operator: LogicalOperator,
    operand: unknown,
    params: unknown[],
    indexHints: string[]
  ): { sql: string; predicate: (doc: Record<string, unknown>) => boolean; indexable: boolean } {
    switch (operator) {
      case '$and': {
        if (!Array.isArray(operand)) {
          throw new QueryCompilerError(`$and requires an array, got ${typeof operand}`)
        }
        const results = operand.map((subFilter) =>
          this.compileFilter(subFilter as QueryFilter, params, indexHints)
        )
        return {
          sql: results.map((r) => `(${r.sql})`).join(' AND '),
          predicate: (doc) => results.every((r) => r.predicate(doc)),
          indexable: results.every((r) => r.indexable),
        }
      }

      case '$or': {
        if (!Array.isArray(operand)) {
          throw new QueryCompilerError(`$or requires an array, got ${typeof operand}`)
        }
        const results = operand.map((subFilter) =>
          this.compileFilter(subFilter as QueryFilter, params, indexHints)
        )
        return {
          sql: `(${results.map((r) => `(${r.sql})`).join(' OR ')})`,
          predicate: (doc) => results.some((r) => r.predicate(doc)),
          indexable: false, // OR queries typically can't use indexes efficiently
        }
      }

      case '$not': {
        const result = this.compileFilter(operand as QueryFilter, params, indexHints)
        return {
          sql: `NOT (${result.sql})`,
          predicate: (doc) => !result.predicate(doc),
          indexable: false, // NOT queries typically can't use indexes efficiently
        }
      }

      case '$nor': {
        if (!Array.isArray(operand)) {
          throw new QueryCompilerError(`$nor requires an array, got ${typeof operand}`)
        }
        const results = operand.map((subFilter) =>
          this.compileFilter(subFilter as QueryFilter, params, indexHints)
        )
        return {
          sql: `NOT (${results.map((r) => `(${r.sql})`).join(' OR ')})`,
          predicate: (doc) => !results.some((r) => r.predicate(doc)),
          indexable: false,
        }
      }

      default:
        throw new QueryCompilerError(`Unknown logical operator: ${operator}`)
    }
  }

  /**
   * Compile a field condition (field: value or field: { $op: value })
   */
  private compileFieldCondition(
    field: string,
    condition: unknown,
    params: unknown[],
    indexHints: string[]
  ): { sql: string; predicate: (doc: Record<string, unknown>) => boolean; indexable: boolean } {
    // Validate field depth
    const depth = field.split('.').length
    if (depth > this.options.maxFieldDepth) {
      throw new QueryCompilerError(
        `Field path '${field}' exceeds maximum depth of ${this.options.maxFieldDepth}`
      )
    }

    // Add to index hints
    indexHints.push(field)

    // Handle direct equality
    if (condition === null || typeof condition !== 'object' || condition instanceof RegExp) {
      return this.compileEquality(field, condition, params)
    }

    // Handle operator expression
    if (this.hasOperators(condition as Record<string, unknown>)) {
      return this.compileOperators(field, condition as FieldOperators, params, indexHints)
    }

    // Treat as embedded document equality
    return this.compileEquality(field, condition, params)
  }

  /**
   * Check if an object contains query operators
   */
  private hasOperators(obj: Record<string, unknown>): boolean {
    return Object.keys(obj).some((key) => key.startsWith('$'))
  }

  /**
   * Compile equality condition
   */
  private compileEquality(
    field: string,
    value: unknown,
    params: unknown[]
  ): { sql: string; predicate: (doc: Record<string, unknown>) => boolean; indexable: boolean } {
    const paramIndex = params.length
    const jsonPath = this.fieldToJsonPath(field)

    if (value === null) {
      return {
        sql: `(${jsonPath} IS NULL OR json_type(${jsonPath}) = 'null')`,
        predicate: (doc) => this.getFieldValue(doc, field) === null,
        indexable: true,
      }
    }

    params.push(this.valueToSqlParam(value))

    return {
      sql: `${jsonPath} = ?`,
      predicate: (doc) => this.isEqual(this.getFieldValue(doc, field), value),
      indexable: true,
    }
  }

  /**
   * Compile operator expressions
   */
  private compileOperators(
    field: string,
    operators: FieldOperators,
    params: unknown[],
    indexHints: string[]
  ): { sql: string; predicate: (doc: Record<string, unknown>) => boolean; indexable: boolean } {
    const clauses: string[] = []
    const predicates: Array<(doc: Record<string, unknown>) => boolean> = []
    let allIndexable = true
    const jsonPath = this.fieldToJsonPath(field)

    for (const [op, value] of Object.entries(operators)) {
      switch (op as QueryOperator) {
        case '$eq': {
          const result = this.compileEquality(field, value, params)
          clauses.push(result.sql)
          predicates.push(result.predicate)
          break
        }

        case '$ne': {
          params.push(this.valueToSqlParam(value))
          clauses.push(`(${jsonPath} IS NULL OR ${jsonPath} != ?)`)
          predicates.push((doc) => !this.isEqual(this.getFieldValue(doc, field), value))
          allIndexable = false // NE queries don't use indexes well
          break
        }

        case '$gt': {
          params.push(value)
          clauses.push(`${jsonPath} > ?`)
          predicates.push((doc) => {
            const fieldVal = this.getFieldValue(doc, field)
            return typeof fieldVal === 'number' && typeof value === 'number' && fieldVal > value
          })
          break
        }

        case '$gte': {
          params.push(value)
          clauses.push(`${jsonPath} >= ?`)
          predicates.push((doc) => {
            const fieldVal = this.getFieldValue(doc, field)
            return typeof fieldVal === 'number' && typeof value === 'number' && fieldVal >= value
          })
          break
        }

        case '$lt': {
          params.push(value)
          clauses.push(`${jsonPath} < ?`)
          predicates.push((doc) => {
            const fieldVal = this.getFieldValue(doc, field)
            return typeof fieldVal === 'number' && typeof value === 'number' && fieldVal < value
          })
          break
        }

        case '$lte': {
          params.push(value)
          clauses.push(`${jsonPath} <= ?`)
          predicates.push((doc) => {
            const fieldVal = this.getFieldValue(doc, field)
            return typeof fieldVal === 'number' && typeof value === 'number' && fieldVal <= value
          })
          break
        }

        case '$in': {
          if (!Array.isArray(value)) {
            throw new QueryCompilerError(`$in requires an array, got ${typeof value}`)
          }
          if (value.length === 0) {
            clauses.push('0=1') // Empty $in never matches
            predicates.push(() => false)
          } else {
            const placeholders = value.map(() => '?').join(', ')
            params.push(...value.map((v) => this.valueToSqlParam(v)))
            clauses.push(`${jsonPath} IN (${placeholders})`)
            predicates.push((doc) => {
              const fieldVal = this.getFieldValue(doc, field)
              return (value as unknown[]).some((v) => this.isEqual(fieldVal, v))
            })
          }
          break
        }

        case '$nin': {
          if (!Array.isArray(value)) {
            throw new QueryCompilerError(`$nin requires an array, got ${typeof value}`)
          }
          if (value.length === 0) {
            clauses.push('1=1') // Empty $nin matches all
            predicates.push(() => true)
          } else {
            const placeholders = value.map(() => '?').join(', ')
            params.push(...value.map((v) => this.valueToSqlParam(v)))
            clauses.push(`(${jsonPath} IS NULL OR ${jsonPath} NOT IN (${placeholders}))`)
            predicates.push((doc) => {
              const fieldVal = this.getFieldValue(doc, field)
              return !(value as unknown[]).some((v) => this.isEqual(fieldVal, v))
            })
          }
          allIndexable = false
          break
        }

        case '$exists': {
          if (value) {
            clauses.push(`${jsonPath} IS NOT NULL`)
            predicates.push((doc) => this.getFieldValue(doc, field) !== undefined)
          } else {
            clauses.push(`${jsonPath} IS NULL`)
            predicates.push((doc) => this.getFieldValue(doc, field) === undefined)
          }
          allIndexable = false
          break
        }

        case '$type': {
          const sqlTypes = BSON_TYPE_MAP[value as string] || []
          if (sqlTypes.length === 0) {
            clauses.push('0=1')
            predicates.push(() => false)
          } else {
            const typeChecks = sqlTypes.map((t) => `json_type(${jsonPath}) = '${t}'`).join(' OR ')
            clauses.push(`(${typeChecks})`)
            predicates.push((doc) => this.matchesType(this.getFieldValue(doc, field), value as string))
          }
          allIndexable = false
          break
        }

        case '$regex': {
          const flags = operators.$options || ''
          const pattern = value instanceof RegExp ? value.source : String(value)
          // SQLite doesn't have native regex, but we can use LIKE for simple patterns
          // or REGEXP if the extension is available
          const sqlPattern = this.regexToSqlLike(pattern)
          if (sqlPattern) {
            params.push(sqlPattern)
            const caseClause = flags.includes('i') ? 'COLLATE NOCASE' : ''
            clauses.push(`${jsonPath} LIKE ? ${caseClause}`)
          } else {
            // Fall back to in-memory filtering
            clauses.push('1=1')
            allIndexable = false
          }
          const regex = new RegExp(pattern, flags)
          predicates.push((doc) => {
            const fieldVal = this.getFieldValue(doc, field)
            return typeof fieldVal === 'string' && regex.test(fieldVal)
          })
          allIndexable = false
          break
        }

        case '$options':
          // Handled by $regex
          break

        case '$size': {
          clauses.push(`json_array_length(${jsonPath}) = ?`)
          params.push(value)
          predicates.push((doc) => {
            const fieldVal = this.getFieldValue(doc, field)
            return Array.isArray(fieldVal) && fieldVal.length === value
          })
          allIndexable = false
          break
        }

        case '$all': {
          if (!Array.isArray(value)) {
            throw new QueryCompilerError(`$all requires an array, got ${typeof value}`)
          }
          // For each element, check if it exists in the array
          const allClauses = value.map((_, i) => {
            params.push(this.valueToSqlParam(value[i]))
            return `EXISTS (SELECT 1 FROM json_each(${jsonPath}) WHERE value = ?)`
          })
          clauses.push(`(${allClauses.join(' AND ')})`)
          predicates.push((doc) => {
            const fieldVal = this.getFieldValue(doc, field)
            if (!Array.isArray(fieldVal)) return false
            return (value as unknown[]).every((v) => fieldVal.some((fv) => this.isEqual(fv, v)))
          })
          allIndexable = false
          break
        }

        case '$elemMatch': {
          // Compile the nested filter
          const nestedParams: unknown[] = []
          const nestedIndexHints: string[] = []
          const nestedResult = this.compileFilter(value as QueryFilter, nestedParams, nestedIndexHints)

          // For SQL, we need to check if any array element matches
          // This is complex in SQLite, so we fall back to in-memory
          clauses.push('1=1')
          params.push(...nestedParams)
          predicates.push((doc) => {
            const fieldVal = this.getFieldValue(doc, field)
            if (!Array.isArray(fieldVal)) return false
            return fieldVal.some((item) => {
              if (typeof item === 'object' && item !== null) {
                return nestedResult.predicate(item as Record<string, unknown>)
              }
              // For primitives, check against operators directly
              return this.matchesPrimitiveElemMatch(item, value as FieldOperators)
            })
          })
          allIndexable = false
          break
        }

        case '$mod': {
          if (!Array.isArray(value) || value.length !== 2) {
            throw new QueryCompilerError(`$mod requires [divisor, remainder], got ${JSON.stringify(value)}`)
          }
          const [divisor, remainder] = value as [number, number]
          params.push(divisor, remainder)
          clauses.push(`(${jsonPath} % ? = ?)`)
          predicates.push((doc) => {
            const fieldVal = this.getFieldValue(doc, field)
            return typeof fieldVal === 'number' && fieldVal % divisor === remainder
          })
          allIndexable = false
          break
        }

        case '$not': {
          const notResult = this.compileOperators(field, value as FieldOperators, params, indexHints)
          clauses.push(`NOT (${notResult.sql})`)
          predicates.push((doc) => !notResult.predicate(doc))
          allIndexable = false
          break
        }

        default:
          if (op.startsWith('$')) {
            throw new QueryCompilerError(`Unknown operator: ${op}`)
          }
      }
    }

    return {
      sql: clauses.length > 0 ? clauses.join(' AND ') : '1=1',
      predicate: (doc) => predicates.every((p) => p(doc)),
      indexable: allIndexable,
    }
  }

  /**
   * Convert field path to SQLite JSON extraction path
   */
  private fieldToJsonPath(field: string): string {
    const { documentColumn } = this.options
    const parts = field.split('.')
    // SQLite JSON path: json_extract(doc, '$.field.nested')
    return `json_extract(${documentColumn}, '$.${parts.join('.')}')`
  }

  /**
   * Convert a value to SQL parameter format
   */
  private valueToSqlParam(value: unknown): unknown {
    if (value === null || value === undefined) {
      return null
    }
    if (typeof value === 'object') {
      return JSON.stringify(value)
    }
    return value
  }

  /**
   * Get field value from document using dot notation
   */
  private getFieldValue(doc: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.')
    let value: unknown = doc

    for (const part of parts) {
      if (value === null || value === undefined) {
        return undefined
      }
      if (typeof value !== 'object') {
        return undefined
      }
      value = (value as Record<string, unknown>)[part]
    }

    return value
  }

  /**
   * Deep equality check
   */
  private isEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (a === null || b === null) return a === b
    if (typeof a !== typeof b) return false

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false
      return a.every((item, i) => this.isEqual(item, b[i]))
    }

    if (typeof a === 'object' && typeof b === 'object') {
      const aKeys = Object.keys(a as object)
      const bKeys = Object.keys(b as object)
      if (aKeys.length !== bKeys.length) return false
      return aKeys.every((key) =>
        this.isEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
      )
    }

    return false
  }

  /**
   * Check if value matches a BSON type
   */
  private matchesType(value: unknown, type: string): boolean {
    switch (type) {
      case 'string':
        return typeof value === 'string'
      case 'number':
      case 'int':
      case 'long':
      case 'double':
      case 'decimal':
        return typeof value === 'number'
      case 'bool':
      case 'boolean':
        return typeof value === 'boolean'
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value)
      case 'array':
        return Array.isArray(value)
      case 'null':
        return value === null
      case 'undefined':
        return value === undefined
      case 'date':
        return value instanceof Date
      default:
        return false
    }
  }

  /**
   * Convert simple regex patterns to SQL LIKE patterns
   * Returns null for complex patterns that can't be converted
   */
  private regexToSqlLike(pattern: string): string | null {
    // Only handle simple patterns
    if (pattern.includes('|') || pattern.includes('(') || pattern.includes('[')) {
      return null
    }

    let result = pattern
      .replace(/\.\*/g, '%') // .* -> %
      .replace(/\./g, '_') // . -> _
      .replace(/\^/g, '') // ^ (start anchor, handled by no leading %)
      .replace(/\$/g, '') // $ (end anchor, handled by no trailing %)

    // Check if we still have regex special chars
    if (/[+?{}\\]/.test(result)) {
      return null
    }

    // Add wildcards based on anchors
    if (!pattern.startsWith('^')) {
      result = '%' + result
    }
    if (!pattern.endsWith('$')) {
      result = result + '%'
    }

    return result
  }

  /**
   * Match primitive value against $elemMatch operators
   */
  private matchesPrimitiveElemMatch(value: unknown, operators: FieldOperators): boolean {
    for (const [op, operand] of Object.entries(operators)) {
      switch (op) {
        case '$eq':
          if (!this.isEqual(value, operand)) return false
          break
        case '$ne':
          if (this.isEqual(value, operand)) return false
          break
        case '$gt':
          if (typeof value !== 'number' || typeof operand !== 'number' || !(value > operand)) return false
          break
        case '$gte':
          if (typeof value !== 'number' || typeof operand !== 'number' || !(value >= operand)) return false
          break
        case '$lt':
          if (typeof value !== 'number' || typeof operand !== 'number' || !(value < operand)) return false
          break
        case '$lte':
          if (typeof value !== 'number' || typeof operand !== 'number' || !(value <= operand)) return false
          break
        case '$in':
          if (!Array.isArray(operand) || !operand.some((v) => this.isEqual(value, v))) return false
          break
        case '$nin':
          if (!Array.isArray(operand) || operand.some((v) => this.isEqual(value, v))) return false
          break
      }
    }
    return true
  }

  /**
   * Estimate query selectivity (0-1, lower is more selective)
   */
  private estimateSelectivity(filter: QueryFilter): number {
    if (!filter || Object.keys(filter).length === 0) {
      return 1.0 // Matches everything
    }

    let selectivity = 1.0

    for (const [key, value] of Object.entries(filter)) {
      if (key === '$and') {
        // AND reduces selectivity
        if (Array.isArray(value)) {
          for (const subFilter of value) {
            selectivity *= this.estimateSelectivity(subFilter as QueryFilter)
          }
        }
      } else if (key === '$or') {
        // OR increases selectivity
        if (Array.isArray(value)) {
          let orSelectivity = 0
          for (const subFilter of value) {
            orSelectivity += this.estimateSelectivity(subFilter as QueryFilter)
          }
          selectivity *= Math.min(orSelectivity, 1.0)
        }
      } else if (key === '$not' || key === '$nor') {
        selectivity *= 0.5 // Assume NOT filters half
      } else {
        // Field condition
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          selectivity *= this.estimateOperatorSelectivity(value as FieldOperators)
        } else {
          // Equality - assume very selective
          selectivity *= 0.01
        }
      }
    }

    return Math.max(selectivity, 0.001) // Never return 0
  }

  /**
   * Estimate selectivity for operator expressions
   */
  private estimateOperatorSelectivity(operators: FieldOperators): number {
    let selectivity = 1.0

    for (const op of Object.keys(operators)) {
      switch (op) {
        case '$eq':
          selectivity *= 0.01
          break
        case '$ne':
          selectivity *= 0.99
          break
        case '$gt':
        case '$gte':
        case '$lt':
        case '$lte':
          selectivity *= 0.3
          break
        case '$in': {
          const inArray = operators.$in
          selectivity *= Array.isArray(inArray) ? Math.min(inArray.length * 0.01, 0.5) : 0.1
          break
        }
        case '$nin':
          selectivity *= 0.9
          break
        case '$exists':
          selectivity *= 0.5
          break
        case '$regex':
          selectivity *= 0.2
          break
        default:
          selectivity *= 0.5
      }
    }

    return selectivity
  }

  /**
   * Get the best index for this query
   */
  suggestIndex(filter: QueryFilter): IndexDefinition | null {
    const { indexHints } = this.compile(filter)

    if (indexHints.length === 0) {
      return null
    }

    // Check if any existing index covers the query
    for (const index of this.options.indexes) {
      if (indexHints.every((hint) => index.fields.includes(hint))) {
        return index
      }
    }

    // Suggest a new index
    return {
      name: `idx_${indexHints.join('_')}`,
      fields: indexHints.slice(0, 3), // Max 3 fields
    }
  }
}

// =============================================================================
// ERROR CLASS
// =============================================================================

/**
 * Error thrown by the query compiler
 */
export class QueryCompilerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueryCompilerError'
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new QueryCompiler instance
 */
export function createQueryCompiler(options?: QueryCompilerOptions): QueryCompiler {
  return new QueryCompiler(options)
}

/**
 * Compile a MongoDB filter to SQL (convenience function)
 */
export function compileQuery(filter: QueryFilter, options?: QueryCompilerOptions): CompiledQuery {
  return createQueryCompiler(options).compile(filter)
}
