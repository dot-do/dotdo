/**
 * MongoDB Query to SQL Translation
 *
 * Translates MongoDB query operators to SQLite-compatible SQL with JSON functions.
 * Supports all standard MongoDB comparison, logical, element, and array operators.
 */

// ============================================================================
// Types
// ============================================================================

export type ComparisonOperator = '$eq' | '$ne' | '$gt' | '$gte' | '$lt' | '$lte' | '$in' | '$nin'
export type LogicalOperator = '$and' | '$or' | '$not' | '$nor'
export type ElementOperator = '$exists' | '$type'
export type ArrayOperator = '$all' | '$elemMatch' | '$size'

/** MongoDB query filter */
export interface MongoFilter {
  [key: string]: unknown
}

/** Update operators */
export interface MongoUpdate {
  $set?: Record<string, unknown>
  $unset?: Record<string, 1 | ''>
  $inc?: Record<string, number>
  $push?: Record<string, unknown>
  $pull?: Record<string, unknown>
  $addToSet?: Record<string, unknown>
  $pop?: Record<string, 1 | -1>
  $min?: Record<string, unknown>
  $max?: Record<string, unknown>
  $mul?: Record<string, number>
  $rename?: Record<string, string>
}

/** Parsed SQL condition */
export interface SQLCondition {
  sql: string
  params: unknown[]
}

/** MongoDB sort specification */
export interface SortSpec {
  [field: string]: 1 | -1
}

/** Projection specification */
export interface ProjectionSpec {
  [field: string]: 0 | 1
}

// ============================================================================
// Query Parser
// ============================================================================

export class QueryParser {
  private paramIndex = 0

  /**
   * Parse a MongoDB filter into SQL WHERE clause
   */
  parseFilter(filter: MongoFilter): SQLCondition {
    this.paramIndex = 0

    if (!filter || Object.keys(filter).length === 0) {
      return { sql: '1=1', params: [] }
    }

    const conditions: string[] = []
    const params: unknown[] = []

    for (const [key, value] of Object.entries(filter)) {
      const result = this.parseFieldCondition(key, value)
      conditions.push(result.sql)
      params.push(...result.params)
    }

    return {
      sql: conditions.join(' AND '),
      params,
    }
  }

  /**
   * Parse a single field condition
   */
  private parseFieldCondition(key: string, value: unknown): SQLCondition {
    // Handle logical operators at top level
    if (key === '$and') {
      return this.parseAnd(value as MongoFilter[])
    }
    if (key === '$or') {
      return this.parseOr(value as MongoFilter[])
    }
    if (key === '$nor') {
      const orResult = this.parseOr(value as MongoFilter[])
      return { sql: `NOT (${orResult.sql})`, params: orResult.params }
    }
    if (key === '$not') {
      const innerResult = this.parseFilter(value as MongoFilter)
      return { sql: `NOT (${innerResult.sql})`, params: innerResult.params }
    }

    // Handle _id field specially (stored as 'id' column)
    const column = key === '_id' ? 'id' : key

    // Direct value comparison (equality)
    if (value === null) {
      return { sql: this.jsonExtract(column) + ' IS NULL', params: [] }
    }

    if (typeof value !== 'object' || value instanceof Date || value instanceof RegExp) {
      if (value instanceof RegExp) {
        return this.parseRegex(column, value)
      }
      if (value instanceof Date) {
        return { sql: `${this.jsonExtract(column)} = ?`, params: [value.toISOString()] }
      }
      return { sql: `${this.jsonExtract(column)} = ?`, params: [this.normalizeValue(value)] }
    }

    // Operator expression
    const operators = value as Record<string, unknown>
    const conditions: string[] = []
    const params: unknown[] = []

    for (const [op, opValue] of Object.entries(operators)) {
      const result = this.parseOperator(column, op, opValue)
      conditions.push(result.sql)
      params.push(...result.params)
    }

    return {
      sql: conditions.length > 1 ? `(${conditions.join(' AND ')})` : conditions[0],
      params,
    }
  }

  /**
   * Parse a single operator
   */
  private parseOperator(column: string, op: string, value: unknown): SQLCondition {
    const extract = this.jsonExtract(column)

    switch (op) {
      // Comparison operators
      case '$eq':
        if (value === null) {
          return { sql: `${extract} IS NULL`, params: [] }
        }
        return { sql: `${extract} = ?`, params: [this.normalizeValue(value)] }

      case '$ne':
        if (value === null) {
          return { sql: `${extract} IS NOT NULL`, params: [] }
        }
        return { sql: `(${extract} != ? OR ${extract} IS NULL)`, params: [this.normalizeValue(value)] }

      case '$gt':
        return { sql: `${extract} > ?`, params: [this.normalizeValue(value)] }

      case '$gte':
        return { sql: `${extract} >= ?`, params: [this.normalizeValue(value)] }

      case '$lt':
        return { sql: `${extract} < ?`, params: [this.normalizeValue(value)] }

      case '$lte':
        return { sql: `${extract} <= ?`, params: [this.normalizeValue(value)] }

      case '$in': {
        const arr = value as unknown[]
        if (arr.length === 0) {
          return { sql: '0=1', params: [] } // Always false
        }
        const placeholders = arr.map(() => '?').join(', ')
        return {
          sql: `${extract} IN (${placeholders})`,
          params: arr.map(v => this.normalizeValue(v)),
        }
      }

      case '$nin': {
        const arr = value as unknown[]
        if (arr.length === 0) {
          return { sql: '1=1', params: [] } // Always true
        }
        const placeholders = arr.map(() => '?').join(', ')
        return {
          sql: `(${extract} NOT IN (${placeholders}) OR ${extract} IS NULL)`,
          params: arr.map(v => this.normalizeValue(v)),
        }
      }

      // Element operators
      case '$exists':
        if (value) {
          return { sql: `${extract} IS NOT NULL`, params: [] }
        }
        return { sql: `${extract} IS NULL`, params: [] }

      case '$type': {
        const typeMap: Record<string, string> = {
          'string': 'text',
          'number': 'real',
          'int': 'integer',
          'double': 'real',
          'bool': 'integer', // SQLite stores booleans as integers
          'boolean': 'integer',
          'array': 'text', // Arrays are stored as JSON text
          'object': 'text', // Objects are stored as JSON text
          'null': 'null',
        }
        const sqlType = typeMap[value as string] || value
        return { sql: `typeof(${extract}) = ?`, params: [sqlType] }
      }

      // Array operators
      case '$all': {
        const arr = value as unknown[]
        const conditions = arr.map(() => {
          return `json_extract(doc, ?) LIKE '%' || ? || '%'`
        })
        const params: unknown[] = []
        for (const v of arr) {
          params.push(`$.${column}`, JSON.stringify(v))
        }
        return { sql: `(${conditions.join(' AND ')})`, params }
      }

      case '$elemMatch': {
        // For elemMatch, we check if any array element matches the condition
        // This is simplified - full elemMatch would need more complex logic
        const filter = value as MongoFilter
        const innerParser = new QueryParser()
        const innerResult = innerParser.parseFilter(filter)
        // For arrays stored as JSON, we use json_each to iterate
        return {
          sql: `EXISTS (SELECT 1 FROM json_each(json_extract(doc, ?)) WHERE ${innerResult.sql.replace(/json_extract\(doc, '\$\.(\w+)'\)/g, 'json_extract(value, "$.$1"')})`,
          params: [`$.${column}`, ...innerResult.params],
        }
      }

      case '$size': {
        return {
          sql: `json_array_length(json_extract(doc, ?)) = ?`,
          params: [`$.${column}`, value],
        }
      }

      // Text operators
      case '$regex': {
        let pattern = value as string | RegExp
        if (pattern instanceof RegExp) {
          pattern = pattern.source
        }
        // SQLite uses GLOB or LIKE, convert regex to LIKE pattern
        const likePattern = this.regexToLike(pattern)
        return { sql: `${extract} LIKE ?`, params: [likePattern] }
      }

      case '$options':
        // Handled with $regex
        return { sql: '1=1', params: [] }

      // Logical operators (nested)
      case '$not': {
        const innerResult = this.parseOperator(column, Object.keys(value as object)[0], Object.values(value as object)[0])
        return { sql: `NOT (${innerResult.sql})`, params: innerResult.params }
      }

      default:
        // Unknown operator - treat as equality
        console.warn(`Unknown operator: ${op}`)
        return { sql: '1=1', params: [] }
    }
  }

  /**
   * Parse $and operator
   */
  private parseAnd(filters: MongoFilter[]): SQLCondition {
    const conditions: string[] = []
    const params: unknown[] = []

    for (const filter of filters) {
      const result = this.parseFilter(filter)
      conditions.push(`(${result.sql})`)
      params.push(...result.params)
    }

    return {
      sql: conditions.join(' AND '),
      params,
    }
  }

  /**
   * Parse $or operator
   */
  private parseOr(filters: MongoFilter[]): SQLCondition {
    const conditions: string[] = []
    const params: unknown[] = []

    for (const filter of filters) {
      const result = this.parseFilter(filter)
      conditions.push(`(${result.sql})`)
      params.push(...result.params)
    }

    return {
      sql: `(${conditions.join(' OR ')})`,
      params,
    }
  }

  /**
   * Parse regex pattern
   */
  private parseRegex(column: string, regex: RegExp): SQLCondition {
    const pattern = this.regexToLike(regex.source)
    const extract = this.jsonExtract(column)
    return { sql: `${extract} LIKE ?`, params: [pattern] }
  }

  /**
   * Convert regex pattern to SQLite LIKE pattern
   */
  private regexToLike(pattern: string): string {
    // Simple conversion - full regex support would need more work
    return pattern
      .replace(/^\^/, '')  // Remove start anchor
      .replace(/\$$/, '')  // Remove end anchor
      .replace(/\.\*/g, '%')  // .* to %
      .replace(/\./g, '_')    // . to _
      .replace(/\*/g, '%')    // * to %
      .replace(/\?/g, '_')    // ? to _
  }

  /**
   * Generate JSON extract expression for a field
   */
  private jsonExtract(field: string): string {
    if (field === 'id' || field === '_id') {
      return 'id'
    }
    // Handle nested paths (e.g., "address.city" -> "$.address.city")
    const path = field.includes('.') ? field : field
    return `json_extract(doc, '$.${path}')`
  }

  /**
   * Normalize value for SQL binding
   */
  private normalizeValue(value: unknown): unknown {
    if (value instanceof Date) {
      return value.toISOString()
    }
    if (typeof value === 'boolean') {
      return value ? 1 : 0
    }
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value)
    }
    return value
  }

  /**
   * Parse sort specification to SQL ORDER BY
   */
  parseSort(sort: SortSpec | null): string {
    if (!sort || Object.keys(sort).length === 0) {
      return ''
    }

    const clauses = Object.entries(sort).map(([field, direction]) => {
      const column = field === '_id' ? 'id' : `json_extract(doc, '$.${field}')`
      return `${column} ${direction === 1 ? 'ASC' : 'DESC'}`
    })

    return `ORDER BY ${clauses.join(', ')}`
  }

  /**
   * Parse projection specification
   */
  parseProjection(projection: ProjectionSpec | null): { select: string; isInclusion: boolean } {
    if (!projection || Object.keys(projection).length === 0) {
      return { select: 'id, doc', isInclusion: false }
    }

    const entries = Object.entries(projection)
    const hasInclusion = entries.some(([, v]) => v === 1)
    const hasExclusion = entries.some(([k, v]) => v === 0 && k !== '_id')

    if (hasInclusion && !hasExclusion) {
      // Inclusion mode - return specific fields
      const fields = entries
        .filter(([, v]) => v === 1)
        .map(([k]) => k)

      // Always include _id unless explicitly excluded
      if (!projection._id || projection._id !== 0) {
        if (!fields.includes('_id')) fields.unshift('_id')
      }

      return { select: 'id, doc', isInclusion: true }
    }

    // Exclusion mode or mixed - return full doc and filter later
    return { select: 'id, doc', isInclusion: false }
  }
}

// ============================================================================
// Update Parser
// ============================================================================

export class UpdateParser {
  /**
   * Apply MongoDB update operators to a document
   */
  applyUpdate(doc: Record<string, unknown>, update: MongoUpdate): Record<string, unknown> {
    const result = { ...doc }

    // $set - set field values
    if (update.$set) {
      for (const [key, value] of Object.entries(update.$set)) {
        this.setNestedValue(result, key, value)
      }
    }

    // $unset - remove fields
    if (update.$unset) {
      for (const key of Object.keys(update.$unset)) {
        this.deleteNestedValue(result, key)
      }
    }

    // $inc - increment numeric values
    if (update.$inc) {
      for (const [key, amount] of Object.entries(update.$inc)) {
        const current = this.getNestedValue(result, key)
        const currentNum = typeof current === 'number' ? current : 0
        this.setNestedValue(result, key, currentNum + amount)
      }
    }

    // $mul - multiply numeric values
    if (update.$mul) {
      for (const [key, amount] of Object.entries(update.$mul)) {
        const current = this.getNestedValue(result, key)
        const currentNum = typeof current === 'number' ? current : 0
        this.setNestedValue(result, key, currentNum * amount)
      }
    }

    // $min - set to minimum of current and given value
    if (update.$min) {
      for (const [key, value] of Object.entries(update.$min)) {
        const current = this.getNestedValue(result, key)
        if (current === undefined || this.compareValues(value, current) < 0) {
          this.setNestedValue(result, key, value)
        }
      }
    }

    // $max - set to maximum of current and given value
    if (update.$max) {
      for (const [key, value] of Object.entries(update.$max)) {
        const current = this.getNestedValue(result, key)
        if (current === undefined || this.compareValues(value, current) > 0) {
          this.setNestedValue(result, key, value)
        }
      }
    }

    // $push - push value to array
    if (update.$push) {
      for (const [key, value] of Object.entries(update.$push)) {
        let arr = this.getNestedValue(result, key) as unknown[]
        if (!Array.isArray(arr)) {
          arr = []
        }

        if (typeof value === 'object' && value !== null && '$each' in value) {
          const eachValue = value as { $each: unknown[]; $position?: number; $slice?: number; $sort?: SortSpec }
          const items = eachValue.$each
          const position = eachValue.$position
          const slice = eachValue.$slice
          const sort = eachValue.$sort

          // Insert at position or append
          if (position !== undefined) {
            arr = [...arr.slice(0, position), ...items, ...arr.slice(position)]
          } else {
            arr = [...arr, ...items]
          }

          // Sort if specified
          if (sort) {
            const sortField = Object.keys(sort)[0]
            const sortDir = sort[sortField]
            arr.sort((a, b) => {
              const aVal = (a as Record<string, unknown>)[sortField]
              const bVal = (b as Record<string, unknown>)[sortField]
              return sortDir * this.compareValues(aVal, bVal)
            })
          }

          // Slice if specified
          if (slice !== undefined) {
            if (slice >= 0) {
              arr = arr.slice(0, slice)
            } else {
              arr = arr.slice(slice)
            }
          }
        } else {
          arr = [...arr, value]
        }

        this.setNestedValue(result, key, arr)
      }
    }

    // $pull - remove matching values from array
    if (update.$pull) {
      for (const [key, condition] of Object.entries(update.$pull)) {
        const arr = this.getNestedValue(result, key)
        if (Array.isArray(arr)) {
          const filtered = arr.filter(item => {
            if (typeof condition === 'object' && condition !== null) {
              // Query condition
              return !this.matchesCondition(item, condition as MongoFilter)
            }
            // Direct value match
            return !this.deepEquals(item, condition)
          })
          this.setNestedValue(result, key, filtered)
        }
      }
    }

    // $addToSet - add to array only if not present
    if (update.$addToSet) {
      for (const [key, value] of Object.entries(update.$addToSet)) {
        let arr = this.getNestedValue(result, key) as unknown[]
        if (!Array.isArray(arr)) {
          arr = []
        }

        if (typeof value === 'object' && value !== null && '$each' in value) {
          const items = (value as { $each: unknown[] }).$each
          for (const item of items) {
            if (!arr.some(existing => this.deepEquals(existing, item))) {
              arr = [...arr, item]
            }
          }
        } else {
          if (!arr.some(existing => this.deepEquals(existing, value))) {
            arr = [...arr, value]
          }
        }

        this.setNestedValue(result, key, arr)
      }
    }

    // $pop - remove first or last element from array
    if (update.$pop) {
      for (const [key, direction] of Object.entries(update.$pop)) {
        const arr = this.getNestedValue(result, key)
        if (Array.isArray(arr)) {
          if (direction === 1) {
            this.setNestedValue(result, key, arr.slice(0, -1))
          } else {
            this.setNestedValue(result, key, arr.slice(1))
          }
        }
      }
    }

    // $rename - rename fields
    if (update.$rename) {
      for (const [oldKey, newKey] of Object.entries(update.$rename)) {
        const value = this.getNestedValue(result, oldKey)
        if (value !== undefined) {
          this.deleteNestedValue(result, oldKey)
          this.setNestedValue(result, newKey, value)
        }
      }
    }

    return result
  }

  /**
   * Get nested value from object
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
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
   * Set nested value in object
   */
  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.')
    let current: Record<string, unknown> = obj
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (current[part] === undefined || current[part] === null || typeof current[part] !== 'object') {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }
    current[parts[parts.length - 1]] = value
  }

  /**
   * Delete nested value from object
   */
  private deleteNestedValue(obj: Record<string, unknown>, path: string): void {
    const parts = path.split('.')
    let current: Record<string, unknown> = obj
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (current[part] === undefined) return
      current = current[part] as Record<string, unknown>
    }
    delete current[parts[parts.length - 1]]
  }

  /**
   * Compare two values
   */
  private compareValues(a: unknown, b: unknown): number {
    if (a === b) return 0
    if (a === null || a === undefined) return -1
    if (b === null || b === undefined) return 1
    if (typeof a === 'number' && typeof b === 'number') return a - b
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b)
    if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
    return String(a).localeCompare(String(b))
  }

  /**
   * Deep equality check
   */
  private deepEquals(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (a === null || b === null) return a === b
    if (a === undefined || b === undefined) return a === b

    if (a instanceof Date && b instanceof Date) {
      return a.getTime() === b.getTime()
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false
      return a.every((v, i) => this.deepEquals(v, b[i]))
    }

    if (typeof a === 'object' && typeof b === 'object') {
      const keysA = Object.keys(a as object)
      const keysB = Object.keys(b as object)
      if (keysA.length !== keysB.length) return false
      return keysA.every(key =>
        this.deepEquals((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
      )
    }

    return false
  }

  /**
   * Check if item matches condition
   */
  private matchesCondition(item: unknown, condition: MongoFilter): boolean {
    if (typeof item !== 'object' || item === null) {
      // For primitive arrays, compare directly
      for (const [, value] of Object.entries(condition)) {
        if (!this.deepEquals(item, value)) return false
      }
      return true
    }

    // For object arrays, check each condition
    const doc = item as Record<string, unknown>
    for (const [key, value] of Object.entries(condition)) {
      const fieldValue = doc[key]
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Operator check
        for (const [op, opValue] of Object.entries(value as Record<string, unknown>)) {
          switch (op) {
            case '$eq':
              if (!this.deepEquals(fieldValue, opValue)) return false
              break
            case '$ne':
              if (this.deepEquals(fieldValue, opValue)) return false
              break
            case '$gt':
              if (this.compareValues(fieldValue, opValue) <= 0) return false
              break
            case '$gte':
              if (this.compareValues(fieldValue, opValue) < 0) return false
              break
            case '$lt':
              if (this.compareValues(fieldValue, opValue) >= 0) return false
              break
            case '$lte':
              if (this.compareValues(fieldValue, opValue) > 0) return false
              break
            case '$in':
              if (!(opValue as unknown[]).some(v => this.deepEquals(fieldValue, v))) return false
              break
          }
        }
      } else {
        // Direct equality
        if (!this.deepEquals(fieldValue, value)) return false
      }
    }

    return true
  }
}

// ============================================================================
// Exports
// ============================================================================

export const queryParser = new QueryParser()
export const updateParser = new UpdateParser()
