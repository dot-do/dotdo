// Query Interface - fluent QueryBuilder for Things

import type { Thing, ThingsStore } from './things'

export interface QueryOptions {
  type?: string
  where?: Record<string, unknown>
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
  orderBy(field: string, order?: 'asc' | 'desc'): QueryBuilder
  limit(n: number): QueryBuilder
  offset(n: number): QueryBuilder
  select(...fields: string[]): QueryBuilder

  // Execute
  execute(): Promise<Thing[]>
  first(): Promise<Thing | null>
  count(): Promise<number>
}

export function createQuery(store: ThingsStore): QueryBuilder {
  const options: QueryOptions = {}

  const builder: QueryBuilder = {
    type(type: string) {
      options.type = type
      return builder
    },

    where(fieldOrConditions: string | Record<string, unknown>, value?: unknown) {
      if (typeof fieldOrConditions === 'string') {
        options.where = { ...options.where, [fieldOrConditions]: value }
      } else {
        options.where = { ...options.where, ...fieldOrConditions }
      }
      return builder
    },

    orderBy(field: string, order: 'asc' | 'desc' = 'desc') {
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
      options.select = fields
      return builder
    },

    async execute(): Promise<Thing[]> {
      // Get all things of the type
      let results = await store.list({
        type: options.type,
        limit: 1000 // Get more for filtering
      })

      // Apply where filters
      if (options.where) {
        results = results.filter(thing => {
          for (const [key, value] of Object.entries(options.where!)) {
            if (thing[key] !== value) return false
          }
          return true
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
      // For accurate count, we need to execute without limit
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
