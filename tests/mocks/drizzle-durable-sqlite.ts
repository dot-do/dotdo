/**
 * Mock for drizzle-orm/durable-sqlite module
 *
 * This mock allows tests to import modules that depend on drizzle-orm/durable-sqlite
 * without requiring the actual Durable Object SQLite storage.
 */

/**
 * Mock DrizzleSqliteDODatabase type
 */
export type DrizzleSqliteDODatabase<TSchema extends Record<string, unknown> = Record<string, never>> = {
  select: () => {
    from: (table: unknown) => Promise<unknown[]>
  }
  insert: (table: unknown) => {
    values: (data: unknown) => Promise<unknown>
  }
  update: (table: unknown) => {
    set: (data: unknown) => {
      where: (condition: unknown) => Promise<unknown>
    }
  }
  delete: (table: unknown) => {
    where: (condition: unknown) => Promise<unknown>
  }
}

/**
 * Mock drizzle function
 */
export function drizzle<TSchema extends Record<string, unknown> = Record<string, never>>(
  _storage: unknown,
  _options?: { schema?: TSchema }
): DrizzleSqliteDODatabase<TSchema> {
  const mockData: Map<string, unknown[]> = new Map()

  return {
    select: () => ({
      from: async (table: unknown) => {
        const tableName = (table as { name?: string })?.name || 'unknown'
        return mockData.get(tableName) || []
      },
    }),
    insert: (table: unknown) => ({
      values: async (data: unknown) => {
        const tableName = (table as { name?: string })?.name || 'unknown'
        const existing = mockData.get(tableName) || []
        existing.push(data)
        mockData.set(tableName, existing)
        return { rowsAffected: 1 }
      },
    }),
    update: (table: unknown) => ({
      set: (data: unknown) => ({
        where: async (condition: unknown) => {
          return { rowsAffected: 1 }
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async (condition: unknown) => {
        return { rowsAffected: 1 }
      },
    }),
  } as unknown as DrizzleSqliteDODatabase<TSchema>
}

export default { drizzle }
