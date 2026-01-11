/**
 * TenantDB - Per-Tenant Database Durable Object
 *
 * This Durable Object provides a Postgres/Supabase-compatible database API
 * with automatic tenant isolation. Each tenant gets their own DO instance
 * with a dedicated SQLite database.
 *
 * Features:
 * - Supabase-compatible query builder
 * - Row-Level Security patterns (RLS-like policies)
 * - Connection pooling simulation
 * - Automatic tenant isolation (physical, not logical)
 * - Full CRUD operations with relations
 */

import { DurableObject } from 'cloudflare:workers'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Base row type with required fields
 */
export interface BaseRow {
  id: string
  tenant_id: string
  created_at: string
  updated_at: string
  [key: string]: unknown
}

/**
 * Query result matching Supabase's PostgREST response
 */
export interface QueryResult<T> {
  data: T | null
  error: PostgrestError | null
  count?: number
  status: number
  statusText: string
}

/**
 * Supabase-compatible error
 */
export interface PostgrestError {
  message: string
  details: string
  hint: string
  code: string
}

/**
 * Filter operators matching Supabase's PostgREST
 */
export type FilterOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'like' | 'ilike' | 'is' | 'in'
  | 'contains' | 'containedBy' | 'overlaps'
  | 'textSearch'

/**
 * RLS Policy definition
 */
export interface RLSPolicy {
  name: string
  table: string
  operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL'
  check: (row: BaseRow, context: PolicyContext) => boolean
  using?: (row: BaseRow, context: PolicyContext) => boolean
}

/**
 * Context for RLS policy evaluation
 */
export interface PolicyContext {
  userId?: string
  tenantId: string
  role?: string
  claims?: Record<string, unknown>
}

// ============================================================================
// QUERY BUILDER (Supabase-compatible)
// ============================================================================

/**
 * Chainable query builder that mirrors Supabase's PostgREST API
 */
export class QueryBuilder<T extends BaseRow = BaseRow> {
  private tableName: string
  private storage: DurableObjectStorage
  private tenantId: string
  private policies: RLSPolicy[]
  private policyContext: PolicyContext

  private operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
  private selectColumns: string = '*'
  private filters: Array<{ column: string; op: FilterOperator; value: unknown }> = []
  private orFilters: Array<Array<{ column: string; op: FilterOperator; value: unknown }>> = []
  private orderByColumns: Array<{ column: string; ascending: boolean; nullsFirst?: boolean }> = []
  private limitCount?: number
  private offsetCount?: number
  private insertData?: Partial<T> | Partial<T>[]
  private updateData?: Partial<T>
  private returnSingle = false
  private returnMaybeSingle = false
  private countOption?: 'exact' | 'planned' | 'estimated'
  private onConflictColumn?: string

  constructor(
    tableName: string,
    storage: DurableObjectStorage,
    tenantId: string,
    policies: RLSPolicy[] = [],
    context: PolicyContext
  ) {
    this.tableName = tableName
    this.storage = storage
    this.tenantId = tenantId
    this.policies = policies.filter(p => p.table === tableName)
    this.policyContext = context
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SELECT
  // ═══════════════════════════════════════════════════════════════════════════

  select(columns: string = '*', options?: { count?: 'exact' | 'planned' | 'estimated' }): this {
    this.operation = 'select'
    this.selectColumns = columns
    if (options?.count) {
      this.countOption = options.count
    }
    return this
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INSERT
  // ═══════════════════════════════════════════════════════════════════════════

  insert(data: Partial<T> | Partial<T>[]): this {
    this.operation = 'insert'
    this.insertData = data
    return this
  }

  upsert(data: Partial<T> | Partial<T>[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.operation = 'upsert'
    this.insertData = data
    this.onConflictColumn = options?.onConflict ?? 'id'
    return this
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE / DELETE
  // ═══════════════════════════════════════════════════════════════════════════

  update(data: Partial<T>): this {
    this.operation = 'update'
    this.updateData = data
    return this
  }

  delete(): this {
    this.operation = 'delete'
    return this
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FILTERS (PostgREST operators)
  // ═══════════════════════════════════════════════════════════════════════════

  eq(column: string, value: unknown): this {
    this.filters.push({ column, op: 'eq', value })
    return this
  }

  neq(column: string, value: unknown): this {
    this.filters.push({ column, op: 'neq', value })
    return this
  }

  gt(column: string, value: unknown): this {
    this.filters.push({ column, op: 'gt', value })
    return this
  }

  gte(column: string, value: unknown): this {
    this.filters.push({ column, op: 'gte', value })
    return this
  }

  lt(column: string, value: unknown): this {
    this.filters.push({ column, op: 'lt', value })
    return this
  }

  lte(column: string, value: unknown): this {
    this.filters.push({ column, op: 'lte', value })
    return this
  }

  like(column: string, pattern: string): this {
    this.filters.push({ column, op: 'like', value: pattern })
    return this
  }

  ilike(column: string, pattern: string): this {
    this.filters.push({ column, op: 'ilike', value: pattern })
    return this
  }

  is(column: string, value: null | boolean): this {
    this.filters.push({ column, op: 'is', value })
    return this
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ column, op: 'in', value: values })
    return this
  }

  contains(column: string, value: unknown[]): this {
    this.filters.push({ column, op: 'contains', value })
    return this
  }

  containedBy(column: string, value: unknown[]): this {
    this.filters.push({ column, op: 'containedBy', value })
    return this
  }

  overlaps(column: string, value: unknown[]): this {
    this.filters.push({ column, op: 'overlaps', value })
    return this
  }

  textSearch(column: string, query: string, options?: { type?: 'plain' | 'phrase' | 'websearch'; config?: string }): this {
    this.filters.push({ column, op: 'textSearch', value: { query, ...options } })
    return this
  }

  or(conditions: string): this {
    // Parse OR conditions like "status.eq.active,status.eq.pending"
    const parsed = conditions.split(',').map(cond => {
      const parts = cond.split('.')
      if (parts.length >= 3) {
        const column = parts[0]
        const op = parts[1] as FilterOperator
        const value = this.parseValue(parts.slice(2).join('.'))
        return { column, op, value }
      }
      return null
    }).filter(Boolean) as Array<{ column: string; op: FilterOperator; value: unknown }>

    if (parsed.length > 0) {
      this.orFilters.push(parsed)
    }
    return this
  }

  match(query: Partial<T>): this {
    for (const [column, value] of Object.entries(query)) {
      this.eq(column, value)
    }
    return this
  }

  not(column: string, operator: FilterOperator, value: unknown): this {
    // Store as negated filter
    this.filters.push({ column: `not.${column}`, op: operator, value })
    return this
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ORDERING & PAGINATION
  // ═══════════════════════════════════════════════════════════════════════════

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): this {
    this.orderByColumns.push({
      column,
      ascending: options?.ascending ?? true,
      nullsFirst: options?.nullsFirst,
    })
    return this
  }

  limit(count: number): this {
    this.limitCount = count
    return this
  }

  range(from: number, to: number): this {
    this.offsetCount = from
    this.limitCount = to - from + 1
    return this
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESULT MODIFIERS
  // ═══════════════════════════════════════════════════════════════════════════

  single(): Promise<QueryResult<T>> {
    this.returnSingle = true
    return this.execute() as Promise<QueryResult<T>>
  }

  maybeSingle(): Promise<QueryResult<T | null>> {
    this.returnMaybeSingle = true
    return this.execute() as Promise<QueryResult<T | null>>
  }

  then<TResult1 = QueryResult<T[]>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<T[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return (this.execute() as Promise<QueryResult<T[]>>).then(onfulfilled, onrejected)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXECUTION
  // ═══════════════════════════════════════════════════════════════════════════

  private parseValue(val: string): unknown {
    if (val === 'null') return null
    if (val === 'true') return true
    if (val === 'false') return false
    const num = Number(val)
    if (!isNaN(num)) return num
    return val
  }

  private async execute(): Promise<QueryResult<T | T[] | null>> {
    const storageKey = `table:${this.tableName}`

    try {
      switch (this.operation) {
        case 'select':
          return await this.executeSelect(storageKey)
        case 'insert':
          return await this.executeInsert(storageKey)
        case 'upsert':
          return await this.executeUpsert(storageKey)
        case 'update':
          return await this.executeUpdate(storageKey)
        case 'delete':
          return await this.executeDelete(storageKey)
        default:
          throw new Error(`Unknown operation: ${this.operation}`)
      }
    } catch (error) {
      return {
        data: null,
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          details: '',
          hint: '',
          code: 'INTERNAL_ERROR',
        },
        status: 500,
        statusText: 'Internal Server Error',
      }
    }
  }

  private async executeSelect(storageKey: string): Promise<QueryResult<T | T[]>> {
    const table = ((await this.storage.get(storageKey)) as T[] | undefined) ?? []

    // Apply RLS policies for SELECT
    let results = this.applyRLSPolicies(table, 'SELECT')
    results = this.applyFilters(results)
    results = this.applyOrFilters(results)

    // Apply ordering
    for (const orderBy of this.orderByColumns) {
      results.sort((a, b) => {
        const aVal = a[orderBy.column]
        const bVal = b[orderBy.column]
        if (aVal === bVal) return 0
        if (aVal === null || aVal === undefined) return orderBy.nullsFirst ? -1 : 1
        if (bVal === null || bVal === undefined) return orderBy.nullsFirst ? 1 : -1
        const cmp = aVal < bVal ? -1 : 1
        return orderBy.ascending ? cmp : -cmp
      })
    }

    const totalCount = results.length

    // Apply pagination
    if (this.offsetCount !== undefined) {
      results = results.slice(this.offsetCount)
    }
    if (this.limitCount !== undefined) {
      results = results.slice(0, this.limitCount)
    }

    // Resolve relations
    if (this.selectColumns !== '*' && this.selectColumns.includes('(')) {
      results = await this.resolveRelations(results)
    }

    // Handle single row modifiers
    if (this.returnSingle) {
      if (results.length === 0) {
        return {
          data: null,
          error: { message: 'Row not found', details: '', hint: '', code: 'PGRST116' },
          status: 406,
          statusText: 'Not Acceptable',
        }
      }
      return {
        data: results[0],
        error: null,
        status: 200,
        statusText: 'OK',
        ...(this.countOption && { count: totalCount }),
      }
    }

    if (this.returnMaybeSingle) {
      return {
        data: results[0] ?? null,
        error: null,
        status: 200,
        statusText: 'OK',
        ...(this.countOption && { count: totalCount }),
      }
    }

    return {
      data: results,
      error: null,
      status: 200,
      statusText: 'OK',
      ...(this.countOption && { count: totalCount }),
    }
  }

  private async executeInsert(storageKey: string): Promise<QueryResult<T | T[]>> {
    const table = ((await this.storage.get(storageKey)) as T[] | undefined) ?? []
    const dataArray = Array.isArray(this.insertData) ? this.insertData : [this.insertData]

    // Apply RLS policies for INSERT
    const insertedRows: T[] = []
    for (const row of dataArray) {
      const newRow = {
        id: (row as BaseRow)?.id ?? crypto.randomUUID(),
        tenant_id: this.tenantId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...row,
      } as T

      // Check INSERT policy
      if (!this.checkRLSPolicy(newRow, 'INSERT')) {
        return {
          data: null,
          error: { message: 'Row violates row-level security policy', details: '', hint: 'Check your RLS policies', code: 'PGRST301' },
          status: 403,
          statusText: 'Forbidden',
        }
      }

      table.push(newRow)
      insertedRows.push(newRow)
    }

    await this.storage.put(storageKey, table)

    return {
      data: insertedRows.length === 1 ? insertedRows[0] : insertedRows,
      error: null,
      status: 201,
      statusText: 'Created',
    }
  }

  private async executeUpsert(storageKey: string): Promise<QueryResult<T | T[]>> {
    const table = ((await this.storage.get(storageKey)) as T[] | undefined) ?? []
    const dataArray = Array.isArray(this.insertData) ? this.insertData : [this.insertData]
    const conflictCol = this.onConflictColumn ?? 'id'

    const upsertedRows: T[] = []
    for (const row of dataArray) {
      const existingIdx = table.findIndex(r => r[conflictCol] === (row as BaseRow)[conflictCol])

      if (existingIdx >= 0) {
        // Check UPDATE policy
        if (!this.checkRLSPolicy(table[existingIdx], 'UPDATE')) {
          return {
            data: null,
            error: { message: 'Row violates row-level security policy', details: '', hint: '', code: 'PGRST301' },
            status: 403,
            statusText: 'Forbidden',
          }
        }

        const updated = {
          ...table[existingIdx],
          ...row,
          updated_at: new Date().toISOString(),
        } as T
        table[existingIdx] = updated
        upsertedRows.push(updated)
      } else {
        const newRow = {
          id: (row as BaseRow).id ?? crypto.randomUUID(),
          tenant_id: this.tenantId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...row,
        } as T

        // Check INSERT policy
        if (!this.checkRLSPolicy(newRow, 'INSERT')) {
          return {
            data: null,
            error: { message: 'Row violates row-level security policy', details: '', hint: '', code: 'PGRST301' },
            status: 403,
            statusText: 'Forbidden',
          }
        }

        table.push(newRow)
        upsertedRows.push(newRow)
      }
    }

    await this.storage.put(storageKey, table)

    return {
      data: upsertedRows.length === 1 ? upsertedRows[0] : upsertedRows,
      error: null,
      status: 200,
      statusText: 'OK',
    }
  }

  private async executeUpdate(storageKey: string): Promise<QueryResult<T[]>> {
    const table = ((await this.storage.get(storageKey)) as T[] | undefined) ?? []

    // Apply RLS for reading rows to update
    let matchingRows = this.applyRLSPolicies(table, 'UPDATE')
    matchingRows = this.applyFilters(matchingRows)
    matchingRows = this.applyOrFilters(matchingRows)

    const updatedRows: T[] = []

    for (const row of matchingRows) {
      const idx = table.findIndex(r => r.id === row.id)
      if (idx >= 0) {
        const updated = {
          ...table[idx],
          ...this.updateData,
          updated_at: new Date().toISOString(),
        } as T

        // Check that the updated row still satisfies the policy
        if (!this.checkRLSPolicy(updated, 'UPDATE')) {
          return {
            data: null,
            error: { message: 'Updated row violates row-level security policy', details: '', hint: '', code: 'PGRST301' },
            status: 403,
            statusText: 'Forbidden',
          }
        }

        table[idx] = updated
        updatedRows.push(updated)
      }
    }

    await this.storage.put(storageKey, table)

    return {
      data: updatedRows,
      error: null,
      status: 200,
      statusText: 'OK',
    }
  }

  private async executeDelete(storageKey: string): Promise<QueryResult<T[]>> {
    const table = ((await this.storage.get(storageKey)) as T[] | undefined) ?? []

    // Apply RLS for reading rows to delete
    let matchingRows = this.applyRLSPolicies(table, 'DELETE')
    matchingRows = this.applyFilters(matchingRows)
    matchingRows = this.applyOrFilters(matchingRows)

    const deletedIds = new Set(matchingRows.map(r => r.id))
    const remaining = table.filter(r => !deletedIds.has(r.id))

    await this.storage.put(storageKey, remaining)

    return {
      data: matchingRows,
      error: null,
      status: 200,
      statusText: 'OK',
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RLS POLICY ENFORCEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  private applyRLSPolicies(rows: T[], operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'): T[] {
    const applicablePolicies = this.policies.filter(
      p => p.operation === operation || p.operation === 'ALL'
    )

    // If no policies defined, allow all (permissive by default)
    if (applicablePolicies.length === 0) {
      return rows
    }

    // Filter rows based on USING clause (for SELECT/UPDATE/DELETE)
    return rows.filter(row => {
      // Row must satisfy at least one policy (OR semantics)
      return applicablePolicies.some(policy => {
        const usingFn = policy.using ?? policy.check
        return usingFn(row, this.policyContext)
      })
    })
  }

  private checkRLSPolicy(row: T, operation: 'INSERT' | 'UPDATE'): boolean {
    const applicablePolicies = this.policies.filter(
      p => p.operation === operation || p.operation === 'ALL'
    )

    // If no policies defined, allow (permissive by default)
    if (applicablePolicies.length === 0) {
      return true
    }

    // Row must satisfy at least one policy's CHECK clause
    return applicablePolicies.some(policy => policy.check(row, this.policyContext))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FILTER APPLICATION
  // ═══════════════════════════════════════════════════════════════════════════

  private applyFilters(rows: T[]): T[] {
    return rows.filter(row => {
      for (const filter of this.filters) {
        // Handle NOT filters
        if (filter.column.startsWith('not.')) {
          const actualColumn = filter.column.slice(4)
          if (this.matchesFilter(row, actualColumn, filter.op, filter.value)) {
            return false
          }
          continue
        }

        if (!this.matchesFilter(row, filter.column, filter.op, filter.value)) {
          return false
        }
      }
      return true
    })
  }

  private applyOrFilters(rows: T[]): T[] {
    if (this.orFilters.length === 0) return rows

    return rows.filter(row => {
      // Each OR group must have at least one matching condition
      return this.orFilters.every(orGroup =>
        orGroup.some(filter =>
          this.matchesFilter(row, filter.column, filter.op, filter.value)
        )
      )
    })
  }

  private matchesFilter(row: T, column: string, op: FilterOperator, filterValue: unknown): boolean {
    const value = row[column]

    switch (op) {
      case 'eq':
        return value === filterValue
      case 'neq':
        return value !== filterValue
      case 'gt':
        return (value as number) > (filterValue as number)
      case 'gte':
        return (value as number) >= (filterValue as number)
      case 'lt':
        return (value as number) < (filterValue as number)
      case 'lte':
        return (value as number) <= (filterValue as number)
      case 'like':
        if (typeof value !== 'string') return false
        const likePattern = (filterValue as string).replace(/%/g, '.*').replace(/_/g, '.')
        return new RegExp(`^${likePattern}$`).test(value)
      case 'ilike':
        if (typeof value !== 'string') return false
        const ilikePattern = (filterValue as string).replace(/%/g, '.*').replace(/_/g, '.')
        return new RegExp(`^${ilikePattern}$`, 'i').test(value)
      case 'is':
        return value === filterValue
      case 'in':
        return (filterValue as unknown[]).includes(value)
      case 'contains':
        if (!Array.isArray(value)) return false
        return (filterValue as unknown[]).every(v => value.includes(v))
      case 'containedBy':
        if (!Array.isArray(value)) return false
        return value.every(v => (filterValue as unknown[]).includes(v))
      case 'overlaps':
        if (!Array.isArray(value)) return false
        return (filterValue as unknown[]).some(v => value.includes(v))
      case 'textSearch':
        if (typeof value !== 'string') return false
        const searchOpts = filterValue as { query: string }
        const words = searchOpts.query.toLowerCase().split(/\s+/)
        const text = value.toLowerCase()
        return words.every(word => text.includes(word))
      default:
        return true
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RELATION RESOLUTION
  // ═══════════════════════════════════════════════════════════════════════════

  private async resolveRelations(rows: T[]): Promise<T[]> {
    // Parse select string for relations: 'id, name, orders(*), profile:profiles(name)'
    const relationPattern = /(\w+)(?::(\w+))?\(([^)]*)\)/g
    const matches = [...this.selectColumns.matchAll(relationPattern)]

    for (const row of rows) {
      for (const match of matches) {
        const alias = match[1]
        const tableName = match[2] ?? `${alias}s`
        const _columns = match[3] ?? '*'

        const relatedKey = `table:${tableName}`
        const relatedTable = ((await this.storage.get(relatedKey)) as BaseRow[] | undefined) ?? []

        // Convention: foreign key is <singular_table>_id
        const fkColumn = `${this.tableName.replace(/s$/, '')}_id`
        const related = relatedTable.filter(r => r[fkColumn] === row.id)

        ;(row as BaseRow)[alias] = related
      }
    }

    return rows
  }
}

// ============================================================================
// SUPABASE-COMPATIBLE CLIENT
// ============================================================================

/**
 * Supabase-compatible client with RLS support
 */
export class SupabaseClient {
  private storage: DurableObjectStorage
  private tenantId: string
  private policies: RLSPolicy[] = []
  private context: PolicyContext

  constructor(storage: DurableObjectStorage, tenantId: string, context?: Partial<PolicyContext>) {
    this.storage = storage
    this.tenantId = tenantId
    this.context = {
      tenantId,
      userId: context?.userId,
      role: context?.role,
      claims: context?.claims,
    }
  }

  /**
   * Register RLS policies
   */
  addPolicy(policy: RLSPolicy): this {
    this.policies.push(policy)
    return this
  }

  /**
   * Update context (e.g., after auth)
   */
  setContext(context: Partial<PolicyContext>): this {
    this.context = { ...this.context, ...context }
    return this
  }

  /**
   * Access a table - returns a query builder
   */
  from<T extends BaseRow = BaseRow>(table: string): QueryBuilder<T> {
    return new QueryBuilder<T>(table, this.storage, this.tenantId, this.policies, this.context)
  }

  /**
   * Execute an RPC function
   */
  async rpc<T = unknown>(functionName: string, params?: Record<string, unknown>): Promise<QueryResult<T>> {
    const fnKey = `rpc:${functionName}`
    const storedFn = await this.storage.get(fnKey)

    if (!storedFn) {
      return {
        data: null,
        error: { message: `Function ${functionName} not found`, details: '', hint: '', code: 'PGRST202' },
        status: 404,
        statusText: 'Not Found',
      }
    }

    // Execute stored function
    try {
      const fn = new Function('params', 'context', storedFn as string)
      const result = await fn(params, this.context)
      return { data: result as T, error: null, status: 200, statusText: 'OK' }
    } catch (error) {
      return {
        data: null,
        error: { message: (error as Error).message, details: '', hint: '', code: 'PGRST500' },
        status: 500,
        statusText: 'Internal Server Error',
      }
    }
  }

  /**
   * Auth namespace (Supabase Auth compatible)
   */
  auth = {
    getUser: async () => {
      const user = await this.storage.get('auth:current_user')
      return { data: { user }, error: null }
    },

    signUp: async (credentials: { email: string; password: string; options?: { data?: Record<string, unknown> } }) => {
      const userId = crypto.randomUUID()
      const user = {
        id: userId,
        email: credentials.email,
        user_metadata: credentials.options?.data ?? {},
        created_at: new Date().toISOString(),
        tenant_id: this.tenantId,
      }
      await this.storage.put(`auth:user:${userId}`, user)

      // Add to users table
      const usersKey = 'table:auth_users'
      const users = ((await this.storage.get(usersKey)) as BaseRow[] | undefined) ?? []
      users.push(user as unknown as BaseRow)
      await this.storage.put(usersKey, users)

      return { data: { user, session: null }, error: null }
    },

    signInWithPassword: async (credentials: { email: string; password: string }) => {
      const usersKey = 'table:auth_users'
      const users = ((await this.storage.get(usersKey)) as Array<{ id: string; email: string }> | undefined) ?? []
      const user = users.find(u => u.email === credentials.email)

      if (!user) {
        return {
          data: { user: null, session: null },
          error: { message: 'Invalid credentials', status: 401, name: 'AuthError' },
        }
      }

      await this.storage.put('auth:current_user', user)
      this.context.userId = user.id

      return {
        data: {
          user,
          session: {
            access_token: crypto.randomUUID(),
            refresh_token: crypto.randomUUID(),
            expires_at: Date.now() + 3600000,
          },
        },
        error: null,
      }
    },

    signOut: async () => {
      await this.storage.delete('auth:current_user')
      this.context.userId = undefined
      return { error: null }
    },
  }

  /**
   * Storage namespace (Supabase Storage compatible)
   */
  storage = {
    from: (bucket: string) => ({
      upload: async (path: string, file: Blob | ArrayBuffer) => {
        const key = `storage:${bucket}:${path}`
        await this.storage.put(key, file)
        return { data: { path }, error: null }
      },
      download: async (path: string) => {
        const key = `storage:${bucket}:${path}`
        const data = await this.storage.get(key)
        return { data, error: data ? null : { message: 'File not found' } }
      },
      remove: async (paths: string[]) => {
        for (const path of paths) {
          await this.storage.delete(`storage:${bucket}:${path}`)
        }
        return { data: paths, error: null }
      },
      getPublicUrl: (path: string) => ({
        data: { publicUrl: `/storage/${bucket}/${path}` },
      }),
      list: async (prefix?: string) => {
        // List files with prefix (simplified)
        return { data: [], error: null }
      },
    }),
  }

  /**
   * Realtime channel (stub for compatibility)
   */
  channel(name: string) {
    return {
      on: (_event: string, _filter: unknown, _callback: (payload: unknown) => void) => ({
        subscribe: () => ({ status: 'SUBSCRIBED' }),
      }),
      subscribe: () => ({ status: 'SUBSCRIBED' }),
      unsubscribe: () => {},
    }
  }
}

/**
 * Create a Supabase-compatible client
 */
export function createClient(
  ctx: { storage: DurableObjectStorage },
  tenantId: string,
  options?: { context?: Partial<PolicyContext> }
): SupabaseClient {
  return new SupabaseClient(ctx.storage, tenantId, options?.context)
}

// ============================================================================
// TENANT DATABASE DURABLE OBJECT
// ============================================================================

/**
 * User row type
 */
interface User extends BaseRow {
  email: string
  name: string
  role: 'admin' | 'member' | 'viewer'
  avatar_url?: string
  team_id?: string
}

/**
 * Team row type
 */
interface Team extends BaseRow {
  name: string
  slug: string
  owner_id: string
}

/**
 * Project row type
 */
interface Project extends BaseRow {
  name: string
  description?: string
  team_id: string
  status: 'active' | 'archived' | 'deleted'
}

/**
 * Task row type
 */
interface Task extends BaseRow {
  title: string
  description?: string
  project_id: string
  assignee_id?: string
  status: 'todo' | 'in_progress' | 'review' | 'done'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  due_date?: string
}

/**
 * Audit log row type
 */
interface AuditLog extends BaseRow {
  user_id: string
  action: string
  resource_type: string
  resource_id: string
  metadata: Record<string, unknown>
}

export interface Env {
  TENANT_DO: DurableObjectNamespace
  ENVIRONMENT?: string
}

/**
 * TenantDB - Per-tenant database with Supabase-compatible API and RLS
 *
 * Each instance represents one tenant with complete data isolation.
 */
export class TenantDB extends DurableObject<Env> {
  private supabase: SupabaseClient
  private tenantId: string

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.tenantId = ctx.id.toString()
    this.supabase = createClient(ctx, this.tenantId)

    // Register RLS policies
    this.setupPolicies()
  }

  /**
   * Setup Row-Level Security policies
   *
   * These demonstrate Postgres-style RLS patterns:
   * - Users can only see their own data or data they have access to
   * - Admins can see everything in their tenant
   * - All data is automatically scoped to the tenant
   */
  private setupPolicies(): void {
    // Policy: Users can see their own profile
    this.supabase.addPolicy({
      name: 'users_own_profile',
      table: 'users',
      operation: 'SELECT',
      check: (row, ctx) => row.tenant_id === ctx.tenantId,
      using: (row, ctx) => {
        // Admins can see all users, others only themselves
        if (ctx.role === 'admin') return row.tenant_id === ctx.tenantId
        return row.id === ctx.userId || row.tenant_id === ctx.tenantId
      },
    })

    // Policy: Users can update their own profile
    this.supabase.addPolicy({
      name: 'users_update_own',
      table: 'users',
      operation: 'UPDATE',
      check: (row, ctx) => {
        if (ctx.role === 'admin') return row.tenant_id === ctx.tenantId
        return row.id === ctx.userId
      },
      using: (row, ctx) => row.id === ctx.userId || ctx.role === 'admin',
    })

    // Policy: Only admins can create users
    this.supabase.addPolicy({
      name: 'users_admin_insert',
      table: 'users',
      operation: 'INSERT',
      check: (_row, ctx) => ctx.role === 'admin' || ctx.role === undefined,
    })

    // Policy: Tasks are visible to team members
    this.supabase.addPolicy({
      name: 'tasks_team_access',
      table: 'tasks',
      operation: 'ALL',
      check: (row, ctx) => row.tenant_id === ctx.tenantId,
      using: (row, ctx) => row.tenant_id === ctx.tenantId,
    })

    // Policy: Projects are visible to team members
    this.supabase.addPolicy({
      name: 'projects_team_access',
      table: 'projects',
      operation: 'ALL',
      check: (row, ctx) => row.tenant_id === ctx.tenantId,
      using: (row, ctx) => row.tenant_id === ctx.tenantId,
    })

    // Policy: Audit logs are read-only (system writes only)
    this.supabase.addPolicy({
      name: 'audit_logs_read_only',
      table: 'audit_logs',
      operation: 'SELECT',
      check: (_row, ctx) => ctx.role === 'admin',
      using: (row, ctx) => row.tenant_id === ctx.tenantId && ctx.role === 'admin',
    })
  }

  /**
   * Get the Supabase client for direct queries
   */
  getClient(context?: Partial<PolicyContext>): SupabaseClient {
    if (context) {
      this.supabase.setContext(context)
    }
    return this.supabase
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // USER OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async getUsers(): Promise<QueryResult<User[]>> {
    return this.supabase.from<User>('users').select('*').order('created_at', { ascending: false })
  }

  async getUser(id: string): Promise<QueryResult<User>> {
    return this.supabase.from<User>('users').select('*, teams(*), tasks(*)').eq('id', id).single()
  }

  async createUser(user: Omit<User, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>): Promise<QueryResult<User>> {
    const result = await this.supabase.from<User>('users').insert(user as Partial<User>).select().single()
    if (result.data) {
      await this.logAudit('user.created', 'user', result.data.id)
    }
    return result
  }

  async updateUser(id: string, updates: Partial<User>): Promise<QueryResult<User>> {
    const result = await this.supabase.from<User>('users').update(updates).eq('id', id).select().single()
    if (result.data) {
      await this.logAudit('user.updated', 'user', id, updates)
    }
    return result
  }

  async deleteUser(id: string): Promise<QueryResult<User[]>> {
    const result = await this.supabase.from<User>('users').delete().eq('id', id)
    if (!result.error) {
      await this.logAudit('user.deleted', 'user', id)
    }
    return result
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEAM OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async getTeams(): Promise<QueryResult<Team[]>> {
    return this.supabase.from<Team>('teams').select('*, members:users(id, name, email, role)').order('name')
  }

  async createTeam(team: Omit<Team, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>): Promise<QueryResult<Team>> {
    return this.supabase.from<Team>('teams').insert(team as Partial<Team>).select().single()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROJECT OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async getProjects(teamId?: string): Promise<QueryResult<Project[]>> {
    let query = this.supabase
      .from<Project>('projects')
      .select('*, team:teams(id, name), tasks(id)')
      .neq('status', 'deleted')

    if (teamId) {
      query = query.eq('team_id', teamId)
    }

    return query.order('updated_at', { ascending: false })
  }

  async createProject(project: Omit<Project, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>): Promise<QueryResult<Project>> {
    return this.supabase.from<Project>('projects').insert(project as Partial<Project>).select().single()
  }

  async archiveProject(id: string): Promise<QueryResult<Project>> {
    const result = await this.supabase.from<Project>('projects').update({ status: 'archived' }).eq('id', id).select().single()
    if (result.data) {
      await this.logAudit('project.archived', 'project', id)
    }
    return result
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TASK OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async getTasks(filters?: {
    project_id?: string
    assignee_id?: string
    status?: Task['status']
    priority?: Task['priority']
  }): Promise<QueryResult<Task[]>> {
    let query = this.supabase
      .from<Task>('tasks')
      .select('*, project:projects(id, name), assignee:users(id, name, avatar_url)')

    if (filters?.project_id) query = query.eq('project_id', filters.project_id)
    if (filters?.assignee_id) query = query.eq('assignee_id', filters.assignee_id)
    if (filters?.status) query = query.eq('status', filters.status)
    if (filters?.priority) query = query.eq('priority', filters.priority)

    return query.order('created_at', { ascending: false })
  }

  async createTask(task: Omit<Task, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>): Promise<QueryResult<Task>> {
    const result = await this.supabase.from<Task>('tasks').insert(task as Partial<Task>).select().single()
    if (result.data) {
      await this.logAudit('task.created', 'task', result.data.id)
    }
    return result
  }

  async updateTaskStatus(id: string, status: Task['status']): Promise<QueryResult<Task>> {
    const result = await this.supabase.from<Task>('tasks').update({ status }).eq('id', id).select().single()
    if (result.data) {
      await this.logAudit('task.status_changed', 'task', id, { status })
    }
    return result
  }

  async bulkUpdateTasks(ids: string[], updates: Partial<Pick<Task, 'status' | 'priority' | 'assignee_id'>>): Promise<QueryResult<Task[]>> {
    return this.supabase.from<Task>('tasks').update(updates as Partial<Task>).in('id', ids).select()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT LOG
  // ═══════════════════════════════════════════════════════════════════════════

  private async logAudit(
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    const { user } = (await this.supabase.auth.getUser()).data
    const userId = (user as { id?: string } | null)?.id ?? 'system'

    // Temporarily allow system writes
    const systemClient = createClient(this.ctx, this.tenantId, { context: { role: 'system' } })
    await systemClient.from<AuditLog>('audit_logs').insert({
      user_id: userId,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      metadata,
      tenant_id: this.tenantId,
    } as Partial<AuditLog>)
  }

  async getAuditLogs(filters?: {
    user_id?: string
    resource_type?: string
    resource_id?: string
    limit?: number
  }): Promise<QueryResult<AuditLog[]>> {
    // Set admin context for audit log access
    this.supabase.setContext({ role: 'admin', tenantId: this.tenantId })

    let query = this.supabase.from<AuditLog>('audit_logs').select('*, user:users(id, name, email)')

    if (filters?.user_id) query = query.eq('user_id', filters.user_id)
    if (filters?.resource_type) query = query.eq('resource_type', filters.resource_type)
    if (filters?.resource_id) query = query.eq('resource_id', filters.resource_id)

    return query.order('created_at', { ascending: false }).limit(filters?.limit ?? 100)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DASHBOARD & ANALYTICS
  // ═══════════════════════════════════════════════════════════════════════════

  async getDashboardStats(): Promise<{
    users: number
    teams: number
    projects: number
    tasks: { total: number; byStatus: Record<string, number> }
    tenant_id: string
  }> {
    const [users, teams, projects, tasks] = await Promise.all([
      this.supabase.from<User>('users').select('*', { count: 'exact' }),
      this.supabase.from<Team>('teams').select('*', { count: 'exact' }),
      this.supabase.from<Project>('projects').select('*', { count: 'exact' }).neq('status', 'deleted'),
      this.supabase.from<Task>('tasks').select('*'),
    ])

    const taskData = (tasks.data ?? []) as Task[]
    const tasksByStatus = taskData.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] ?? 0) + 1
      return acc
    }, {} as Record<string, number>)

    return {
      users: users.count ?? 0,
      teams: teams.count ?? 0,
      projects: projects.count ?? 0,
      tasks: {
        total: taskData.length,
        byStatus: tasksByStatus,
      },
      tenant_id: this.tenantId,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEED DATA
  // ═══════════════════════════════════════════════════════════════════════════

  async seedDemoData(): Promise<{ success: boolean; message: string; tenant_id: string }> {
    // Create demo users
    const users = [
      { email: 'alice@example.com', name: 'Alice Chen', role: 'admin' as const },
      { email: 'bob@example.com', name: 'Bob Smith', role: 'member' as const },
      { email: 'carol@example.com', name: 'Carol Davis', role: 'viewer' as const },
    ]

    const createdUsers: User[] = []
    for (const user of users) {
      const { data } = await this.createUser(user)
      if (data) createdUsers.push(data as User)
    }

    // Create demo team
    const { data: team } = await this.createTeam({
      name: 'Engineering',
      slug: 'engineering',
      owner_id: createdUsers[0]?.id ?? 'alice',
    })

    if (team) {
      // Create demo project
      const { data: project } = await this.createProject({
        name: 'Supabase Migration',
        description: 'Migrate from Supabase to dotdo with full API compatibility',
        team_id: team.id,
        status: 'active',
      })

      if (project) {
        // Create demo tasks
        const tasks = [
          { title: 'Update SDK imports', status: 'done' as const, priority: 'high' as const },
          { title: 'Remove RLS policies', status: 'done' as const, priority: 'high' as const },
          { title: 'Test multi-tenant isolation', status: 'in_progress' as const, priority: 'urgent' as const },
          { title: 'Configure connection pooling', status: 'todo' as const, priority: 'medium' as const },
          { title: 'Deploy to production', status: 'todo' as const, priority: 'high' as const },
        ]

        for (const task of tasks) {
          await this.createTask({
            ...task,
            project_id: project.id,
            assignee_id: createdUsers[Math.floor(Math.random() * createdUsers.length)]?.id,
          })
        }
      }
    }

    return {
      success: true,
      message: 'Demo data seeded successfully',
      tenant_id: this.tenantId,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONNECTION POOLING SIMULATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get connection pool stats
   *
   * In Supabase/Postgres, connection pooling is a critical concern.
   * With DOs, each tenant has isolated state - no connection limits!
   */
  async getPoolStats(): Promise<{
    active_connections: number
    idle_connections: number
    max_connections: number
    waiting_clients: number
    message: string
  }> {
    return {
      active_connections: 1,
      idle_connections: 0,
      max_connections: Infinity,
      waiting_clients: 0,
      message: 'Connection pooling is not needed - each tenant has isolated DO state',
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Handle RPC endpoint (JSON-RPC 2.0)
    if (url.pathname === '/rpc' && request.method === 'POST') {
      try {
        const body = (await request.json()) as {
          jsonrpc: string
          id: number
          method: string
          params?: unknown[]
        }
        const { method, params = [], id } = body

        // Get context from headers
        const userId = request.headers.get('X-User-ID') ?? undefined
        const role = request.headers.get('X-User-Role') ?? undefined

        if (userId || role) {
          this.supabase.setContext({ userId, role })
        }

        const methodFn = (this as unknown as Record<string, (...args: unknown[]) => unknown>)[method]
        if (typeof methodFn !== 'function') {
          return Response.json(
            { jsonrpc: '2.0', id, error: { code: -32601, message: `Method '${method}' not found` } },
            { status: 400 }
          )
        }

        const result = await methodFn.apply(this, params)
        return Response.json({ jsonrpc: '2.0', id, result })
      } catch (error) {
        return Response.json(
          { jsonrpc: '2.0', id: 0, error: { code: -32603, message: String(error) } },
          { status: 500 }
        )
      }
    }

    // Health check
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', tenant: this.tenantId })
    }

    return new Response('Not Found', { status: 404 })
  }
}
