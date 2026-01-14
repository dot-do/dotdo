/**
 * RelationalStore - Typed relational storage with Drizzle ORM integration
 *
 * This is a stub file. The implementation is TBD.
 *
 * @see README.md for API documentation
 */

// Stub export - will fail at runtime but allows tests to compile
export class RelationalStore<T extends Record<string, unknown>> {
  constructor(_db: unknown, _schema: T) {
    throw new Error('RelationalStore is not yet implemented')
  }

  get schema(): T {
    throw new Error('RelationalStore is not yet implemented')
  }

  getColumns(_table: unknown): string[] {
    throw new Error('RelationalStore is not yet implemented')
  }

  getReferences(_table: unknown): Array<{ column: string; references: { table: string; column: string } }> {
    throw new Error('RelationalStore is not yet implemented')
  }

  getConstraints(_table: unknown): { primaryKey: string; unique: string[]; notNull: string[] } {
    throw new Error('RelationalStore is not yet implemented')
  }

  insert(_table: unknown): InsertBuilder {
    throw new Error('RelationalStore is not yet implemented')
  }

  select(_columns?: unknown): SelectBuilder {
    throw new Error('RelationalStore is not yet implemented')
  }

  update(_table: unknown): UpdateBuilder {
    throw new Error('RelationalStore is not yet implemented')
  }

  delete(_table: unknown): DeleteBuilder {
    throw new Error('RelationalStore is not yet implemented')
  }

  transaction<R>(_fn: (tx: RelationalStore<T>) => Promise<R>): Promise<R> {
    throw new Error('RelationalStore is not yet implemented')
  }

  execute(_sql: unknown): Promise<unknown[]> {
    throw new Error('RelationalStore is not yet implemented')
  }

  getMigrationHistory(): Promise<Array<{ version: number; appliedAt: Date }>> {
    throw new Error('RelationalStore is not yet implemented')
  }

  migrate(_migration: {
    version: number
    up: (db: unknown) => Promise<void>
    down: (db: unknown) => Promise<void>
  }): Promise<void> {
    throw new Error('RelationalStore is not yet implemented')
  }

  rollback(_version: number): Promise<void> {
    throw new Error('RelationalStore is not yet implemented')
  }

  onCDCEvent(_handler: (event: CDCEvent) => void): void {
    throw new Error('RelationalStore is not yet implemented')
  }
}

// Stub types for query builders
interface InsertBuilder {
  values(data: unknown): InsertBuilder
  returning(): Promise<unknown[]>
  onConflictDoNothing(): InsertBuilder
  onConflictDoUpdate(options: { target: unknown; set: unknown }): InsertBuilder
}

interface SelectBuilder {
  from(table: unknown): SelectBuilder
  where(condition: unknown): SelectBuilder
  leftJoin(table: unknown, condition: unknown): SelectBuilder
  innerJoin(table: unknown, condition: unknown): SelectBuilder
  orderBy(column: unknown): SelectBuilder
  groupBy(column: unknown): SelectBuilder
  limit(n: number): SelectBuilder
  offset(n: number): SelectBuilder
  then<R>(resolve: (value: unknown[]) => R): Promise<R>
}

interface UpdateBuilder {
  set(data: unknown): UpdateBuilder
  where(condition: unknown): UpdateBuilder
  returning(): Promise<unknown[]>
}

interface DeleteBuilder {
  where(condition: unknown): DeleteBuilder
  returning(): Promise<unknown[]>
}

interface CDCEvent {
  type: 'cdc.insert' | 'cdc.update' | 'cdc.delete'
  op: 'c' | 'u' | 'd'
  store: 'relational'
  table: string
  key: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  seq?: number
  ts?: number
  txId?: string
}
