/**
 * DBProxy - Main database accessor using Proxy pattern
 *
 * Provides type-safe access to entities via db.EntityName pattern.
 * Entities are accessed dynamically and cached for performance.
 *
 * @example
 * ```typescript
 * const db = createDBProxy(thingsStore)
 *
 * // CRUD operations
 * const lead = await db.Lead.get('lead-123')
 * const leads = await db.Lead.list()
 *
 * // Fluent queries
 * const active = await db.Lead
 *   .filter(l => l.data?.status === 'active')
 *   .sort((a, b) => b.data?.score - a.data?.score)
 *   .limit(10)
 *
 * // Natural language
 * const deals = await db.Lead`who closed deals this month?`
 * ```
 */

import type { ThingsStore, SearchStore } from '../db/stores/types'
import type { DBProxy as IDBProxy, EntityAccessor as IEntityAccessor } from './types'
import { createEntityAccessor, type NLQueryExecutor } from './EntityAccessor'

// ============================================================================
// DBPROXY FACTORY
// ============================================================================

/**
 * Options for creating a DBProxy
 */
export interface CreateDBProxyOptions {
  /**
   * Things store for CRUD operations
   */
  store: ThingsStore

  /**
   * Optional search store for full-text/semantic search
   */
  searchStore?: SearchStore

  /**
   * Optional NL query executor for template literal queries
   */
  nlExecutor?: NLQueryExecutor

  /**
   * Optional AI binding for NL query execution (if nlExecutor not provided)
   */
  ai?: unknown
}

/**
 * Create a DBProxy instance
 *
 * The proxy intercepts property access and returns EntityAccessor instances
 * for each entity type. Accessors are cached for performance.
 *
 * @example
 * ```typescript
 * // In a DO class
 * class MyDO extends DO {
 *   get db(): DBProxy {
 *     return createDBProxy({
 *       store: this.things,
 *       searchStore: this.search,
 *     })
 *   }
 *
 *   async processLeads() {
 *     const leads = await this.db.Lead.list()
 *     // ...
 *   }
 * }
 * ```
 */
export function createDBProxy(options: CreateDBProxyOptions): IDBProxy {
  const { store, searchStore, ai } = options

  // Cache entity accessors
  const accessorCache = new Map<string, IEntityAccessor>()

  // Create NL executor if AI is available
  const nlExecutor = options.nlExecutor ?? (ai ? createAINLExecutor(ai, store) : undefined)

  // Create proxy
  return new Proxy({} as IDBProxy, {
    get(_target, prop: string) {
      // Return cached accessor if available
      if (accessorCache.has(prop)) {
        return accessorCache.get(prop)!
      }

      // Create new accessor for this entity type
      const accessor = createEntityAccessor(prop, store, {
        nlExecutor,
        searchStore: searchStore
          ? {
              query: (text, opts) => searchStore.query(text, opts),
              semantic: (text, opts) => searchStore.semantic(text, opts),
            }
          : undefined,
      })

      // Cache and return
      accessorCache.set(prop, accessor)
      return accessor
    },

    has(_target, prop: string) {
      // All entity types are accessible
      return typeof prop === 'string' && prop !== ''
    },

    ownKeys() {
      // Return cached entity types
      return Array.from(accessorCache.keys())
    },

    getOwnPropertyDescriptor(_target, prop: string) {
      return {
        value: this.get!(_target, prop, {} as IDBProxy),
        writable: false,
        enumerable: true,
        configurable: true,
      }
    },
  })
}

// ============================================================================
// AI NL EXECUTOR
// ============================================================================

/**
 * Create an NL executor that uses Cloudflare AI for query understanding
 */
function createAINLExecutor(ai: unknown, store: ThingsStore): NLQueryExecutor {
  return {
    async execute(entityType, query, values) {
      // Replace placeholders with values
      let processedQuery = query
      values.forEach((value, i) => {
        processedQuery = processedQuery.replace(`$${i + 1}`, JSON.stringify(value))
      })

      // If AI is available, use it to understand the query
      const aiBinding = ai as {
        run?(model: string, input: unknown): Promise<{ response: string }>
      }

      if (aiBinding?.run) {
        try {
          // Build a prompt for query understanding
          const prompt = `You are a query parser. Convert this natural language query about ${entityType} entities into a JSON filter object.

Query: "${processedQuery}"

Respond with ONLY a JSON object with these optional fields:
- where: object of field=value conditions
- orderBy: field name to sort by
- order: "asc" or "desc"
- limit: number of results

Examples:
- "top 10 by revenue" -> {"orderBy": "revenue", "order": "desc", "limit": 10}
- "active leads" -> {"where": {"status": "active"}}
- "who closed deals" -> {"where": {"dealClosed": true}}

JSON response:`

          const result = await aiBinding.run('@cf/meta/llama-3.1-8b-instruct', {
            messages: [{ role: 'user', content: prompt }],
          })

          // Parse the response
          try {
            const parsed = JSON.parse(result.response.trim())

            // Execute the parsed query
            const results = await store.list({
              type: entityType,
              where: parsed.where,
              orderBy: parsed.orderBy,
              order: parsed.order,
              limit: parsed.limit,
            })

            return results
          } catch {
            // If parsing fails, fall back to basic search
          }
        } catch {
          // AI call failed, fall back to basic search
        }
      }

      // Fallback: return all entities of this type
      return store.list({ type: entityType })
    },
  }
}

// ============================================================================
// CONVENIENCE EXPORTS
// ============================================================================

export { EntityAccessor, createEntityAccessor } from './EntityAccessor'
export { DBPromise } from './DBPromise'
export type { NLQueryExecutor } from './EntityAccessor'
