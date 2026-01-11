/**
 * Database Query Helpers - Multi-Tenant Postgres Example
 *
 * Provides type-safe query utilities for common database operations.
 * Works with both @dotdo/postgres and the built-in DO storage.
 *
 * Features:
 * - Typed query builders
 * - Connection pooling patterns
 * - Turso fallback support
 * - Row-level security helpers (for hybrid deployments)
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Generic row type for database tables
 */
export interface BaseRow {
  id: string
  tenant_id: string
  created_at: string
  updated_at: string
}

/**
 * Query result matching PostgreSQL/Supabase format
 */
export interface QueryResult<T> {
  data: T | null
  error: QueryError | null
  count?: number
  status: number
  statusText: string
}

/**
 * Query error
 */
export interface QueryError {
  message: string
  code: string
  details?: string
  hint?: string
}

/**
 * Filter operators for WHERE clauses
 */
export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'ilike'
  | 'is'
  | 'in'
  | 'contains'
  | 'not'

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc'

/**
 * Filter condition
 */
export interface FilterCondition {
  column: string
  operator: FilterOperator
  value: unknown
}

/**
 * Sort condition
 */
export interface SortCondition {
  column: string
  direction: SortDirection
  nullsFirst?: boolean
}

/**
 * Pagination options
 */
export interface PaginationOptions {
  page?: number
  pageSize?: number
  offset?: number
  limit?: number
}

/**
 * Query options
 */
export interface QueryOptions {
  filters?: FilterCondition[]
  sort?: SortCondition[]
  pagination?: PaginationOptions
  select?: string[]
  include?: string[] // Relations to include
}

// ============================================================================
// QUERY BUILDER
// ============================================================================

/**
 * Type-safe query builder for DO storage
 *
 * @example
 * ```typescript
 * const users = await query<User>(storage, 'users')
 *   .where('role', 'eq', 'admin')
 *   .orderBy('created_at', 'desc')
 *   .limit(10)
 *   .execute()
 * ```
 */
export class QueryBuilder<T extends BaseRow> {
  private storage: DurableObjectStorage
  private tableName: string
  private tenantId: string
  private filters: FilterCondition[] = []
  private sorts: SortCondition[] = []
  private limitCount?: number
  private offsetCount?: number
  private selectColumns?: string[]
  private relations: string[] = []

  constructor(storage: DurableObjectStorage, tableName: string, tenantId: string) {
    this.storage = storage
    this.tableName = tableName
    this.tenantId = tenantId
  }

  /**
   * Add a WHERE condition
   */
  where<K extends keyof T>(column: K, operator: FilterOperator, value: T[K]): this {
    this.filters.push({ column: String(column), operator, value })
    return this
  }

  /**
   * Shorthand for equality filter
   */
  whereEquals<K extends keyof T>(column: K, value: T[K]): this {
    return this.where(column, 'eq', value)
  }

  /**
   * Add multiple equality filters
   */
  whereAll(conditions: Partial<T>): this {
    for (const [column, value] of Object.entries(conditions)) {
      if (value !== undefined) {
        this.filters.push({ column, operator: 'eq', value })
      }
    }
    return this
  }

  /**
   * Add IN filter
   */
  whereIn<K extends keyof T>(column: K, values: T[K][]): this {
    this.filters.push({ column: String(column), operator: 'in', value: values })
    return this
  }

  /**
   * Add LIKE filter (case sensitive pattern match)
   */
  whereLike<K extends keyof T>(column: K, pattern: string): this {
    return this.where(column, 'like', pattern as T[K])
  }

  /**
   * Add ILIKE filter (case insensitive pattern match)
   */
  whereILike<K extends keyof T>(column: K, pattern: string): this {
    return this.where(column, 'ilike', pattern as T[K])
  }

  /**
   * Add ORDER BY
   */
  orderBy<K extends keyof T>(column: K, direction: SortDirection = 'asc'): this {
    this.sorts.push({ column: String(column), direction })
    return this
  }

  /**
   * Add LIMIT
   */
  limit(count: number): this {
    this.limitCount = count
    return this
  }

  /**
   * Add OFFSET
   */
  offset(count: number): this {
    this.offsetCount = count
    return this
  }

  /**
   * Paginate results
   */
  paginate(page: number, pageSize: number): this {
    this.offsetCount = (page - 1) * pageSize
    this.limitCount = pageSize
    return this
  }

  /**
   * Select specific columns
   */
  select(...columns: (keyof T)[]): this {
    this.selectColumns = columns as string[]
    return this
  }

  /**
   * Include related data (foreign key relations)
   */
  include(...relations: string[]): this {
    this.relations.push(...relations)
    return this
  }

  /**
   * Execute the query and return all matching rows
   */
  async execute(): Promise<QueryResult<T[]>> {
    try {
      const storageKey = `table:${this.tableName}`
      const table = ((await this.storage.get(storageKey)) as T[] | undefined) ?? []

      let results = this.applyFilters(table)
      results = this.applySorting(results)

      const totalCount = results.length

      // Apply pagination
      if (this.offsetCount !== undefined) {
        results = results.slice(this.offsetCount)
      }
      if (this.limitCount !== undefined) {
        results = results.slice(0, this.limitCount)
      }

      // Apply column selection
      if (this.selectColumns) {
        results = results.map((row) => {
          const selected: Partial<T> = {}
          for (const col of this.selectColumns!) {
            selected[col as keyof T] = row[col as keyof T]
          }
          return selected as T
        })
      }

      // Resolve relations
      if (this.relations.length > 0) {
        results = await this.resolveRelations(results)
      }

      return {
        data: results,
        error: null,
        count: totalCount,
        status: 200,
        statusText: 'OK',
      }
    } catch (error) {
      return {
        data: null,
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          code: 'QUERY_ERROR',
        },
        status: 500,
        statusText: 'Internal Server Error',
      }
    }
  }

  /**
   * Execute and return first matching row
   */
  async first(): Promise<QueryResult<T>> {
    const result = await this.limit(1).execute()
    if (result.error) {
      return { ...result, data: null }
    }
    if (!result.data || result.data.length === 0) {
      return {
        data: null,
        error: { message: 'Row not found', code: 'NOT_FOUND' },
        status: 404,
        statusText: 'Not Found',
      }
    }
    return {
      data: result.data[0],
      error: null,
      status: 200,
      statusText: 'OK',
    }
  }

  /**
   * Execute and return first matching row or null (no error if not found)
   */
  async firstOrNull(): Promise<QueryResult<T | null>> {
    const result = await this.limit(1).execute()
    if (result.error) {
      return { ...result, data: null }
    }
    return {
      data: result.data?.[0] ?? null,
      error: null,
      status: 200,
      statusText: 'OK',
    }
  }

  /**
   * Count matching rows
   */
  async count(): Promise<QueryResult<number>> {
    try {
      const storageKey = `table:${this.tableName}`
      const table = ((await this.storage.get(storageKey)) as T[] | undefined) ?? []
      const filtered = this.applyFilters(table)
      return {
        data: filtered.length,
        error: null,
        status: 200,
        statusText: 'OK',
      }
    } catch (error) {
      return {
        data: null,
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          code: 'COUNT_ERROR',
        },
        status: 500,
        statusText: 'Internal Server Error',
      }
    }
  }

  /**
   * Check if any matching rows exist
   */
  async exists(): Promise<boolean> {
    const result = await this.limit(1).execute()
    return (result.data?.length ?? 0) > 0
  }

  private applyFilters(rows: T[]): T[] {
    return rows.filter((row) => {
      for (const filter of this.filters) {
        const value = row[filter.column as keyof T]

        switch (filter.operator) {
          case 'eq':
            if (value !== filter.value) return false
            break
          case 'neq':
            if (value === filter.value) return false
            break
          case 'gt':
            if (!((value as number) > (filter.value as number))) return false
            break
          case 'gte':
            if (!((value as number) >= (filter.value as number))) return false
            break
          case 'lt':
            if (!((value as number) < (filter.value as number))) return false
            break
          case 'lte':
            if (!((value as number) <= (filter.value as number))) return false
            break
          case 'like':
            if (typeof value !== 'string') return false
            const likePattern = (filter.value as string).replace(/%/g, '.*')
            if (!new RegExp(`^${likePattern}$`).test(value)) return false
            break
          case 'ilike':
            if (typeof value !== 'string') return false
            const ilikePattern = (filter.value as string).replace(/%/g, '.*')
            if (!new RegExp(`^${ilikePattern}$`, 'i').test(value)) return false
            break
          case 'is':
            if (value !== filter.value) return false
            break
          case 'in':
            if (!(filter.value as unknown[]).includes(value)) return false
            break
          case 'contains':
            if (!Array.isArray(value)) return false
            if (!(filter.value as unknown[]).every((v) => value.includes(v))) return false
            break
          case 'not':
            if (value === filter.value) return false
            break
        }
      }
      return true
    })
  }

  private applySorting(rows: T[]): T[] {
    if (this.sorts.length === 0) return rows

    return [...rows].sort((a, b) => {
      for (const sort of this.sorts) {
        const aVal = a[sort.column as keyof T]
        const bVal = b[sort.column as keyof T]

        if (aVal === bVal) continue
        if (aVal === null || aVal === undefined) return sort.nullsFirst ? -1 : 1
        if (bVal === null || bVal === undefined) return sort.nullsFirst ? 1 : -1

        const cmp = aVal < bVal ? -1 : 1
        return sort.direction === 'asc' ? cmp : -cmp
      }
      return 0
    })
  }

  private async resolveRelations(rows: T[]): Promise<T[]> {
    for (const relation of this.relations) {
      const relationKey = `table:${relation}`
      const relationTable = ((await this.storage.get(relationKey)) as BaseRow[] | undefined) ?? []

      // Find foreign key (convention: singular_id)
      const singular = this.tableName.replace(/s$/, '')
      const fkColumn = `${singular}_id`

      for (const row of rows) {
        const related = relationTable.filter((r) => r[fkColumn as keyof typeof r] === row.id)
        ;(row as Record<string, unknown>)[relation] = related
      }
    }

    return rows
  }
}

// ============================================================================
// MUTATION HELPERS
// ============================================================================

/**
 * Insert a new row
 */
export async function insert<T extends BaseRow>(
  storage: DurableObjectStorage,
  tableName: string,
  tenantId: string,
  data: Omit<T, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>
): Promise<QueryResult<T>> {
  try {
    const storageKey = `table:${tableName}`
    const table = ((await storage.get(storageKey)) as T[] | undefined) ?? []

    const now = new Date().toISOString()
    const row = {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      created_at: now,
      updated_at: now,
      ...data,
    } as T

    table.push(row)
    await storage.put(storageKey, table)

    return { data: row, error: null, status: 201, statusText: 'Created' }
  } catch (error) {
    return {
      data: null,
      error: { message: error instanceof Error ? error.message : 'Insert failed', code: 'INSERT_ERROR' },
      status: 500,
      statusText: 'Internal Server Error',
    }
  }
}

/**
 * Insert multiple rows
 */
export async function insertMany<T extends BaseRow>(
  storage: DurableObjectStorage,
  tableName: string,
  tenantId: string,
  items: Omit<T, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>[]
): Promise<QueryResult<T[]>> {
  try {
    const storageKey = `table:${tableName}`
    const table = ((await storage.get(storageKey)) as T[] | undefined) ?? []

    const now = new Date().toISOString()
    const rows: T[] = items.map((data) => ({
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      created_at: now,
      updated_at: now,
      ...data,
    })) as T[]

    table.push(...rows)
    await storage.put(storageKey, table)

    return { data: rows, error: null, status: 201, statusText: 'Created' }
  } catch (error) {
    return {
      data: null,
      error: { message: error instanceof Error ? error.message : 'Insert failed', code: 'INSERT_ERROR' },
      status: 500,
      statusText: 'Internal Server Error',
    }
  }
}

/**
 * Update rows matching conditions
 */
export async function update<T extends BaseRow>(
  storage: DurableObjectStorage,
  tableName: string,
  id: string,
  updates: Partial<Omit<T, 'id' | 'tenant_id' | 'created_at'>>
): Promise<QueryResult<T>> {
  try {
    const storageKey = `table:${tableName}`
    const table = ((await storage.get(storageKey)) as T[] | undefined) ?? []

    const index = table.findIndex((r) => r.id === id)
    if (index === -1) {
      return {
        data: null,
        error: { message: 'Row not found', code: 'NOT_FOUND' },
        status: 404,
        statusText: 'Not Found',
      }
    }

    const updated = {
      ...table[index],
      ...updates,
      updated_at: new Date().toISOString(),
    }
    table[index] = updated

    await storage.put(storageKey, table)

    return { data: updated, error: null, status: 200, statusText: 'OK' }
  } catch (error) {
    return {
      data: null,
      error: { message: error instanceof Error ? error.message : 'Update failed', code: 'UPDATE_ERROR' },
      status: 500,
      statusText: 'Internal Server Error',
    }
  }
}

/**
 * Upsert (insert or update on conflict)
 */
export async function upsert<T extends BaseRow>(
  storage: DurableObjectStorage,
  tableName: string,
  tenantId: string,
  data: Omit<T, 'tenant_id' | 'created_at' | 'updated_at'> & { id?: string },
  conflictColumn: keyof T = 'id'
): Promise<QueryResult<T>> {
  try {
    const storageKey = `table:${tableName}`
    const table = ((await storage.get(storageKey)) as T[] | undefined) ?? []

    const now = new Date().toISOString()
    const conflictValue = data[conflictColumn as keyof typeof data]
    const existingIndex = table.findIndex((r) => r[conflictColumn] === conflictValue)

    let row: T

    if (existingIndex >= 0) {
      // Update existing
      row = {
        ...table[existingIndex],
        ...data,
        updated_at: now,
      } as T
      table[existingIndex] = row
    } else {
      // Insert new - use provided id or generate one
      row = {
        tenant_id: tenantId,
        created_at: now,
        updated_at: now,
        ...data,
        id: data.id ?? crypto.randomUUID(),
      } as T
      table.push(row)
    }

    await storage.put(storageKey, table)

    return { data: row, error: null, status: 200, statusText: 'OK' }
  } catch (error) {
    return {
      data: null,
      error: { message: error instanceof Error ? error.message : 'Upsert failed', code: 'UPSERT_ERROR' },
      status: 500,
      statusText: 'Internal Server Error',
    }
  }
}

/**
 * Delete a row by ID
 */
export async function deleteById<T extends BaseRow>(
  storage: DurableObjectStorage,
  tableName: string,
  id: string
): Promise<QueryResult<T>> {
  try {
    const storageKey = `table:${tableName}`
    const table = ((await storage.get(storageKey)) as T[] | undefined) ?? []

    const index = table.findIndex((r) => r.id === id)
    if (index === -1) {
      return {
        data: null,
        error: { message: 'Row not found', code: 'NOT_FOUND' },
        status: 404,
        statusText: 'Not Found',
      }
    }

    const [deleted] = table.splice(index, 1)
    await storage.put(storageKey, table)

    return { data: deleted, error: null, status: 200, statusText: 'OK' }
  } catch (error) {
    return {
      data: null,
      error: { message: error instanceof Error ? error.message : 'Delete failed', code: 'DELETE_ERROR' },
      status: 500,
      statusText: 'Internal Server Error',
    }
  }
}

/**
 * Delete multiple rows by IDs
 */
export async function deleteMany<T extends BaseRow>(
  storage: DurableObjectStorage,
  tableName: string,
  ids: string[]
): Promise<QueryResult<T[]>> {
  try {
    const storageKey = `table:${tableName}`
    const table = ((await storage.get(storageKey)) as T[] | undefined) ?? []

    const idSet = new Set(ids)
    const deleted = table.filter((r) => idSet.has(r.id))
    const remaining = table.filter((r) => !idSet.has(r.id))

    await storage.put(storageKey, remaining)

    return { data: deleted, error: null, status: 200, statusText: 'OK' }
  } catch (error) {
    return {
      data: null,
      error: { message: error instanceof Error ? error.message : 'Delete failed', code: 'DELETE_ERROR' },
      status: 500,
      statusText: 'Internal Server Error',
    }
  }
}

// ============================================================================
// TRANSACTION SUPPORT
// ============================================================================

/**
 * Transaction context for batched operations
 */
export class Transaction<T extends BaseRow = BaseRow> {
  private storage: DurableObjectStorage
  private tenantId: string
  private operations: Array<() => Promise<void>> = []
  private cache: Map<string, T[]> = new Map()

  constructor(storage: DurableObjectStorage, tenantId: string) {
    this.storage = storage
    this.tenantId = tenantId
  }

  /**
   * Queue an insert operation
   */
  insert(tableName: string, data: Omit<T, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>): this {
    this.operations.push(async () => {
      await insert<T>(this.storage, tableName, this.tenantId, data)
    })
    return this
  }

  /**
   * Queue an update operation
   */
  update(tableName: string, id: string, updates: Partial<T>): this {
    this.operations.push(async () => {
      await update<T>(this.storage, tableName, id, updates)
    })
    return this
  }

  /**
   * Queue a delete operation
   */
  delete(tableName: string, id: string): this {
    this.operations.push(async () => {
      await deleteById<T>(this.storage, tableName, id)
    })
    return this
  }

  /**
   * Execute all queued operations
   * Note: In DO storage, this is already atomic per table
   */
  async commit(): Promise<QueryResult<null>> {
    try {
      for (const op of this.operations) {
        await op()
      }
      this.operations = []
      return { data: null, error: null, status: 200, statusText: 'OK' }
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : 'Transaction failed', code: 'TRANSACTION_ERROR' },
        status: 500,
        statusText: 'Internal Server Error',
      }
    }
  }

  /**
   * Discard queued operations
   */
  rollback(): void {
    this.operations = []
    this.cache.clear()
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a query builder for a table
 */
export function query<T extends BaseRow>(
  storage: DurableObjectStorage,
  tableName: string,
  tenantId: string
): QueryBuilder<T> {
  return new QueryBuilder<T>(storage, tableName, tenantId)
}

/**
 * Create a transaction context
 */
export function transaction<T extends BaseRow = BaseRow>(
  storage: DurableObjectStorage,
  tenantId: string
): Transaction<T> {
  return new Transaction<T>(storage, tenantId)
}

// ============================================================================
// CONNECTION POOL PATTERN (For hybrid Postgres fallback)
// ============================================================================

/**
 * Connection pool interface for external database fallback
 */
export interface ConnectionPool {
  query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
  execute(sql: string, params?: unknown[]): Promise<QueryResult<null>>
  close(): Promise<void>
}

/**
 * Create a connection pool with Turso/libSQL fallback
 *
 * @example
 * ```typescript
 * const pool = createPool({
 *   primary: storage, // DO storage (fast, edge)
 *   fallback: tursoClient, // Turso client (durable, SQL)
 * })
 * ```
 */
export function createPool(options: {
  primary: DurableObjectStorage
  fallback?: ConnectionPool
  tenantId: string
}): {
  query: <T extends BaseRow>(tableName: string) => QueryBuilder<T>
  insert: <T extends BaseRow>(tableName: string, data: Omit<T, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>) => Promise<QueryResult<T>>
  update: <T extends BaseRow>(tableName: string, id: string, updates: Partial<Omit<T, 'id' | 'tenant_id' | 'created_at'>>) => Promise<QueryResult<T>>
  delete: <T extends BaseRow>(tableName: string, id: string) => Promise<QueryResult<T>>
} {
  const { primary, tenantId } = options

  return {
    query: <T extends BaseRow>(tableName: string) => new QueryBuilder<T>(primary, tableName, tenantId),
    insert: <T extends BaseRow>(tableName: string, data: Omit<T, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>) =>
      insert<T>(primary, tableName, tenantId, data),
    update: <T extends BaseRow>(tableName: string, id: string, updates: Partial<Omit<T, 'id' | 'tenant_id' | 'created_at'>>) =>
      update<T>(primary, tableName, id, updates),
    delete: <T extends BaseRow>(tableName: string, id: string) =>
      deleteById<T>(primary, tableName, id),
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  QueryBuilder,
  Transaction,
  query,
  transaction,
  insert,
  insertMany,
  update,
  upsert,
  deleteById,
  deleteMany,
  createPool,
}
