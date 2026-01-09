/**
 * AI Database Module
 *
 * Provides type-safe database access with:
 * - db.Entity.get/list/find/search/create/update/delete
 * - Natural language queries via template literals: db.Lead`who closed deals?`
 * - DBPromise chaining: .filter/.map/.sort/.limit
 * - forEach with concurrency, retries, progress tracking, and crash recovery
 *
 * @example
 * ```typescript
 * import { createDBProxy } from 'dotdo/ai-database'
 *
 * // In a DO class
 * class MyDO extends DO {
 *   get db() {
 *     return createDBProxy({
 *       store: this.things,
 *       searchStore: this.search,
 *     })
 *   }
 *
 *   async process() {
 *     // CRUD
 *     const lead = await this.db.Lead.get('lead-123')
 *     const leads = await this.db.Lead.list()
 *
 *     // Fluent queries
 *     const active = await this.db.Lead
 *       .filter(l => l.data?.status === 'active')
 *       .sort((a, b) => b.data?.score - a.data?.score)
 *       .limit(10)
 *
 *     // Natural language
 *     const deals = await this.db.Lead`who closed deals this month?`
 *
 *     // Batch processing with concurrency
 *     await this.db.Lead
 *       .filter(l => l.data?.needsEmail)
 *       .forEach(async lead => {
 *         await sendEmail(lead)
 *       }, {
 *         concurrency: 5,
 *         persist: true,
 *         onProgress: p => console.log(`${p.completed}/${p.total}`)
 *       })
 *   }
 * }
 * ```
 */

// Core exports
export { createDBProxy, type CreateDBProxyOptions } from './DBProxy'
export { DBPromise, type DBPromiseDataSource } from './DBPromise'
export { EntityAccessor, createEntityAccessor, type NLQueryExecutor } from './EntityAccessor'

// Type exports
export type {
  DBPromise as IDBPromise,
  DBProxy,
  EntityAccessor as IEntityAccessor,
  ForEachOptions,
  ForEachProgress,
  ForEachResult,
  ListOptions,
  SearchOptions,
  NLQueryContext,
  EntitySchema,
  FieldSchema,
  RelationshipSchema,
  ForEachTracker,
} from './types'
