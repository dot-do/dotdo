/**
 * SOQL Executor
 *
 * Executes SOQL queries against in-memory data collections.
 * Used for local testing, mocking, and Durable Object storage.
 *
 * @module @dotdo/salesforce/soql/executor
 */

import { parse, ParserError } from './parser'
import type {
  SelectNode,
  FieldNode,
  WhereNode,
  OrderByNode,
  ValueNode,
  ComparisonNode,
  LogicalNode,
  InNode,
  LikeNode,
  NotNode,
  IncludesExcludesNode,
} from './ast'

/**
 * Record type for Salesforce-like objects
 */
export type SObjectRecord = Record<string, unknown>

/**
 * Query result from executor
 */
export interface ExecutorResult<T = SObjectRecord> {
  totalSize: number
  done: boolean
  records: T[]
}

/**
 * Bind variables for parameterized queries
 */
export type BindVariables = Record<string, unknown>

/**
 * Data source interface for the executor
 */
export interface DataSource {
  /**
   * Get all records for an SObject type
   */
  getRecords(sobjectType: string): SObjectRecord[]

  /**
   * Get related records for a relationship
   */
  getRelatedRecords?(
    sobjectType: string,
    parentId: string,
    relationshipName: string
  ): SObjectRecord[]
}

/**
 * Simple in-memory data source
 */
export class InMemoryDataSource implements DataSource {
  private data: Map<string, SObjectRecord[]> = new Map()

  constructor(data?: Record<string, SObjectRecord[]>) {
    if (data) {
      for (const [key, records] of Object.entries(data)) {
        this.data.set(key.toLowerCase(), records)
      }
    }
  }

  /**
   * Add records for an SObject type
   */
  addRecords(sobjectType: string, records: SObjectRecord[]): void {
    const existing = this.data.get(sobjectType.toLowerCase()) || []
    this.data.set(sobjectType.toLowerCase(), [...existing, ...records])
  }

  /**
   * Set records for an SObject type (replaces existing)
   */
  setRecords(sobjectType: string, records: SObjectRecord[]): void {
    this.data.set(sobjectType.toLowerCase(), records)
  }

  /**
   * Get all records for an SObject type
   */
  getRecords(sobjectType: string): SObjectRecord[] {
    return this.data.get(sobjectType.toLowerCase()) || []
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.data.clear()
  }
}

/**
 * SOQL Query Executor
 */
export class Executor {
  private dataSource: DataSource
  private bindVariables: BindVariables

  constructor(dataSource: DataSource, bindVariables: BindVariables = {}) {
    this.dataSource = dataSource
    this.bindVariables = bindVariables
  }

  /**
   * Execute a SOQL query
   */
  execute<T = SObjectRecord>(query: string): ExecutorResult<T> {
    const ast = parse(query)
    return this.executeAst<T>(ast)
  }

  /**
   * Execute a pre-parsed AST
   */
  executeAst<T = SObjectRecord>(ast: SelectNode): ExecutorResult<T> {
    // Get base records
    let records = this.dataSource.getRecords(ast.from.sobject)

    // Apply WHERE filter
    if (ast.where) {
      records = records.filter((record) => this.evaluateWhere(record, ast.where!))
    }

    // Apply GROUP BY (simplified - just unique values)
    if (ast.groupBy && ast.groupBy.length > 0) {
      records = this.applyGroupBy(records, ast.groupBy, ast.fields)
    }

    // Apply HAVING
    if (ast.having) {
      records = records.filter((record) => this.evaluateWhere(record, ast.having!))
    }

    // Apply ORDER BY
    if (ast.orderBy && ast.orderBy.length > 0) {
      records = this.applyOrderBy(records, ast.orderBy)
    }

    // Get total before pagination
    const totalSize = records.length

    // Apply OFFSET
    if (ast.offset !== undefined) {
      records = records.slice(ast.offset)
    }

    // Apply LIMIT
    if (ast.limit !== undefined) {
      records = records.slice(0, ast.limit)
    }

    // Project fields
    const projected = records.map((record) => this.projectFields(record, ast.fields))

    return {
      totalSize,
      done: true,
      records: projected as T[],
    }
  }

  private evaluateWhere(record: SObjectRecord, where: WhereNode): boolean {
    switch (where.type) {
      case 'Comparison':
        return this.evaluateComparison(record, where)

      case 'Logical':
        return this.evaluateLogical(record, where)

      case 'In':
        return this.evaluateIn(record, where)

      case 'Like':
        return this.evaluateLike(record, where)

      case 'Not':
        return !this.evaluateWhere(record, where.expression)

      case 'IncludesExcludes':
        return this.evaluateIncludesExcludes(record, where)

      default:
        return true
    }
  }

  private evaluateComparison(record: SObjectRecord, node: ComparisonNode): boolean {
    const fieldValue = this.getFieldValue(record, node.field)
    const compareValue = this.resolveValue(node.value)

    switch (node.operator) {
      case '=':
        return this.equals(fieldValue, compareValue)
      case '!=':
        return !this.equals(fieldValue, compareValue)
      case '<':
        return this.compare(fieldValue, compareValue) < 0
      case '>':
        return this.compare(fieldValue, compareValue) > 0
      case '<=':
        return this.compare(fieldValue, compareValue) <= 0
      case '>=':
        return this.compare(fieldValue, compareValue) >= 0
      default:
        return false
    }
  }

  private evaluateLogical(record: SObjectRecord, node: LogicalNode): boolean {
    const left = this.evaluateWhere(record, node.left)
    const right = this.evaluateWhere(record, node.right)

    switch (node.operator) {
      case 'AND':
        return left && right
      case 'OR':
        return left || right
      default:
        return false
    }
  }

  private evaluateIn(record: SObjectRecord, node: InNode): boolean {
    const fieldValue = this.getFieldValue(record, node.field)
    const values = node.values.map((v) => this.resolveValue(v))
    const inList = values.some((v) => this.equals(fieldValue, v))
    return node.negated ? !inList : inList
  }

  private evaluateLike(record: SObjectRecord, node: LikeNode): boolean {
    const fieldValue = this.getFieldValue(record, node.field)
    if (fieldValue === null || fieldValue === undefined) {
      return node.negated
    }

    // Convert SOQL LIKE pattern to regex
    // % = any characters, _ = single character
    const pattern = node.pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/%/g, '.*')
      .replace(/_/g, '.')

    const regex = new RegExp(`^${pattern}$`, 'i')
    const matches = regex.test(String(fieldValue))
    return node.negated ? !matches : matches
  }

  private evaluateIncludesExcludes(record: SObjectRecord, node: IncludesExcludesNode): boolean {
    const fieldValue = this.getFieldValue(record, node.field)
    if (fieldValue === null || fieldValue === undefined) {
      return false
    }

    // Multipicklist values are semicolon-separated
    const fieldValues = String(fieldValue)
      .split(';')
      .map((v) => v.trim().toLowerCase())
    const checkValues = node.values.map((v) => v.toLowerCase())

    if (node.operator === 'INCLUDES') {
      return checkValues.some((v) => fieldValues.includes(v))
    } else {
      return !checkValues.some((v) => fieldValues.includes(v))
    }
  }

  private getFieldValue(record: SObjectRecord, fieldPath: string): unknown {
    const parts = fieldPath.split('.')
    let current: unknown = record

    for (const part of parts) {
      if (current === null || current === undefined) {
        return null
      }
      current = (current as SObjectRecord)[part]
    }

    return current
  }

  private resolveValue(node: ValueNode): unknown {
    switch (node.type) {
      case 'StringValue':
        return node.value
      case 'NumberValue':
        return node.value
      case 'BooleanValue':
        return node.value
      case 'NullValue':
        return null
      case 'DateValue':
        return new Date(node.value)
      case 'DateTimeValue':
        return new Date(node.value)
      case 'DateLiteral':
        return this.resolveDateLiteral(node.literal, node.n)
      case 'BindVariable':
        return this.bindVariables[node.name]
      case 'FieldRef':
        return node.field // Will be resolved during comparison
      default:
        return null
    }
  }

  private resolveDateLiteral(literal: string, n?: number): Date {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    switch (literal) {
      case 'TODAY':
        return today
      case 'YESTERDAY':
        return new Date(today.getTime() - 24 * 60 * 60 * 1000)
      case 'TOMORROW':
        return new Date(today.getTime() + 24 * 60 * 60 * 1000)
      case 'LAST_WEEK':
        return new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
      case 'THIS_WEEK':
        const dayOfWeek = today.getDay()
        return new Date(today.getTime() - dayOfWeek * 24 * 60 * 60 * 1000)
      case 'NEXT_WEEK':
        const daysUntilNextWeek = 7 - today.getDay()
        return new Date(today.getTime() + daysUntilNextWeek * 24 * 60 * 60 * 1000)
      case 'LAST_MONTH':
        return new Date(today.getFullYear(), today.getMonth() - 1, 1)
      case 'THIS_MONTH':
        return new Date(today.getFullYear(), today.getMonth(), 1)
      case 'NEXT_MONTH':
        return new Date(today.getFullYear(), today.getMonth() + 1, 1)
      case 'LAST_YEAR':
        return new Date(today.getFullYear() - 1, 0, 1)
      case 'THIS_YEAR':
        return new Date(today.getFullYear(), 0, 1)
      case 'NEXT_YEAR':
        return new Date(today.getFullYear() + 1, 0, 1)
      case 'LAST_N_DAYS':
        return new Date(today.getTime() - (n || 0) * 24 * 60 * 60 * 1000)
      case 'NEXT_N_DAYS':
        return new Date(today.getTime() + (n || 0) * 24 * 60 * 60 * 1000)
      default:
        return today
    }
  }

  private equals(a: unknown, b: unknown): boolean {
    if (a === null || a === undefined) {
      return b === null || b === undefined
    }
    if (b === null || b === undefined) {
      return false
    }

    // Handle dates
    if (a instanceof Date && b instanceof Date) {
      return a.getTime() === b.getTime()
    }
    if (a instanceof Date) {
      return a.getTime() === new Date(String(b)).getTime()
    }
    if (b instanceof Date) {
      return new Date(String(a)).getTime() === b.getTime()
    }

    // Case-insensitive string comparison
    if (typeof a === 'string' && typeof b === 'string') {
      return a.toLowerCase() === b.toLowerCase()
    }

    return a === b
  }

  private compare(a: unknown, b: unknown): number {
    if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1
    if (b === null || b === undefined) return 1

    // Handle dates
    if (a instanceof Date && b instanceof Date) {
      return a.getTime() - b.getTime()
    }
    if (a instanceof Date) {
      return a.getTime() - new Date(String(b)).getTime()
    }
    if (b instanceof Date) {
      return new Date(String(a)).getTime() - b.getTime()
    }

    // Handle numbers
    if (typeof a === 'number' && typeof b === 'number') {
      return a - b
    }

    // Handle strings
    if (typeof a === 'string' && typeof b === 'string') {
      return a.localeCompare(b, undefined, { sensitivity: 'base' })
    }

    // Fallback to string comparison
    return String(a).localeCompare(String(b))
  }

  private applyOrderBy(records: SObjectRecord[], orderBy: OrderByNode[]): SObjectRecord[] {
    return [...records].sort((a, b) => {
      for (const order of orderBy) {
        const aVal = this.getFieldValue(a, order.field)
        const bVal = this.getFieldValue(b, order.field)

        // Handle nulls
        if ((aVal === null || aVal === undefined) && (bVal === null || bVal === undefined)) {
          continue
        }
        if (aVal === null || aVal === undefined) {
          return order.nulls === 'FIRST' ? -1 : 1
        }
        if (bVal === null || bVal === undefined) {
          return order.nulls === 'FIRST' ? 1 : -1
        }

        const cmp = this.compare(aVal, bVal)
        if (cmp !== 0) {
          return order.direction === 'DESC' ? -cmp : cmp
        }
      }
      return 0
    })
  }

  private applyGroupBy(
    records: SObjectRecord[],
    groupBy: FieldNode[],
    selectFields: FieldNode[]
  ): SObjectRecord[] {
    const groups = new Map<string, SObjectRecord[]>()

    // Group records by the group by fields
    for (const record of records) {
      const key = groupBy
        .map((field) => {
          if (field.type === 'SimpleField') {
            return String(this.getFieldValue(record, field.name))
          }
          if (field.type === 'RelationshipField') {
            return String(this.getFieldValue(record, field.path.join('.')))
          }
          return ''
        })
        .join('|')

      const existing = groups.get(key) || []
      existing.push(record)
      groups.set(key, existing)
    }

    // For each group, compute aggregates
    const result: SObjectRecord[] = []

    for (const [, groupRecords] of groups) {
      const row: SObjectRecord = {}

      for (const field of selectFields) {
        if (field.type === 'AggregateField') {
          const value = this.computeAggregate(groupRecords, field.function, field.field)
          const alias = field.alias || `${field.function}${field.field ? `_${field.field}` : ''}`
          row[alias] = value
        } else if (field.type === 'SimpleField') {
          // Use value from first record in group
          row[field.alias || field.name] = this.getFieldValue(groupRecords[0], field.name)
        } else if (field.type === 'RelationshipField') {
          const path = field.path.join('.')
          row[field.alias || path] = this.getFieldValue(groupRecords[0], path)
        }
      }

      result.push(row)
    }

    return result
  }

  private computeAggregate(
    records: SObjectRecord[],
    func: string,
    field?: string
  ): number {
    switch (func) {
      case 'COUNT':
        if (!field) {
          return records.length
        }
        return records.filter((r) => this.getFieldValue(r, field) !== null).length

      case 'COUNT_DISTINCT':
        if (!field) return records.length
        const uniqueValues = new Set(
          records.map((r) => this.getFieldValue(r, field)).filter((v) => v !== null)
        )
        return uniqueValues.size

      case 'SUM':
        if (!field) return 0
        return records.reduce((sum, r) => {
          const val = this.getFieldValue(r, field)
          return sum + (typeof val === 'number' ? val : 0)
        }, 0)

      case 'AVG':
        if (!field) return 0
        const values = records
          .map((r) => this.getFieldValue(r, field))
          .filter((v): v is number => typeof v === 'number')
        if (values.length === 0) return 0
        return values.reduce((a, b) => a + b, 0) / values.length

      case 'MIN':
        if (!field) return 0
        const minValues = records
          .map((r) => this.getFieldValue(r, field))
          .filter((v) => v !== null && v !== undefined)
        if (minValues.length === 0) return 0
        return Math.min(...minValues.map((v) => (typeof v === 'number' ? v : Number(v))))

      case 'MAX':
        if (!field) return 0
        const maxValues = records
          .map((r) => this.getFieldValue(r, field))
          .filter((v) => v !== null && v !== undefined)
        if (maxValues.length === 0) return 0
        return Math.max(...maxValues.map((v) => (typeof v === 'number' ? v : Number(v))))

      default:
        return 0
    }
  }

  private projectFields(record: SObjectRecord, fields: FieldNode[]): SObjectRecord {
    const result: SObjectRecord = {}

    for (const field of fields) {
      switch (field.type) {
        case 'SimpleField': {
          const value = this.getFieldValue(record, field.name)
          result[field.alias || field.name] = value
          break
        }

        case 'RelationshipField': {
          const path = field.path
          // Get the relationship object
          let current: unknown = record
          const resultPath = field.alias || path[path.length - 1]

          for (let i = 0; i < path.length - 1; i++) {
            if (current === null || current === undefined) break
            current = (current as SObjectRecord)[path[i]]
          }

          if (current !== null && current !== undefined) {
            const lastField = path[path.length - 1]
            result[resultPath] = (current as SObjectRecord)[lastField]
          } else {
            result[resultPath] = null
          }
          break
        }

        case 'AggregateField': {
          // Aggregates are already computed in groupBy
          const alias = field.alias || `${field.function}${field.field ? `_${field.field}` : ''}`
          if (alias in record) {
            result[alias] = record[alias]
          }
          break
        }

        case 'Subquery': {
          // Handle subqueries - get related records
          const relName = field.relationshipName
          const relRecords = (record[relName] as SObjectRecord[]) || []

          // Execute the subquery against the related records
          const subDataSource = new InMemoryDataSource()
          subDataSource.setRecords(field.select.from.sobject, relRecords)
          const subExecutor = new Executor(subDataSource, this.bindVariables)
          const subResult = subExecutor.executeAst(field.select)

          result[relName] = {
            totalSize: subResult.totalSize,
            done: true,
            records: subResult.records,
          }
          break
        }
      }
    }

    return result
  }
}

/**
 * Execute a SOQL query against in-memory data
 */
export function executeQuery<T = SObjectRecord>(
  query: string,
  data: Record<string, SObjectRecord[]>,
  bindVariables?: BindVariables
): ExecutorResult<T> {
  const dataSource = new InMemoryDataSource(data)
  const executor = new Executor(dataSource, bindVariables)
  return executor.execute<T>(query)
}
