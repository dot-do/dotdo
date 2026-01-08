import type { RpcPromise } from 'capnweb'
import type { Thing, ThingData, ThingDO } from './Thing'

// ============================================================================
// THINGS - Typed collection (can BE a Durable Object)
//
// A Things<T> is a collection of Things of type T.
// It can either:
//   1. Live inside another DO (as a collection accessor)
//   2. BE a DO itself (when promoted or created as top-level)
//
// Example:
//   - https://startups.studio IS a Things<Startup>
//   - Each startup (https://startups.studio/headless.ly) is a Thing
// ============================================================================

export interface ThingsData {
  // Fully qualified URLs
  $id: string // URL: 'https://startups.studio'
  $type: string // URL: 'https://schema.org.ai/Things' (meta-type)
  itemType: string // URL: 'https://startups.studio/Startup' (what it contains)

  // Metadata
  name?: string
  description?: string
  createdAt: Date
  updatedAt: Date
}

export interface CreateOptions {
  // Cascade generation options (from ai-database)
  cascade?: boolean
  maxDepth?: number
  cascadeTypes?: string[]
  onProgress?: (progress: CascadeProgress) => void
}

export interface CascadeProgress {
  phase: 'generating' | 'resolving' | 'complete'
  currentType: string
  currentDepth: number
  totalEntitiesCreated: number
  typesGenerated: string[]
}

export interface ForEachOptions {
  concurrency?: number
  maxRetries?: number
  retryDelay?: number
  onProgress?: (progress: ForEachProgress) => void
  onError?: (error: Error, item: Thing) => 'skip' | 'retry' | 'abort'
  persist?: boolean
  resume?: string
}

export interface ForEachProgress {
  total: number
  completed: number
  failed: number
  skipped: number
}

export interface Query {
  where?: Record<string, unknown>
  orderBy?: string | string[]
  limit?: number
  offset?: number
}

// ============================================================================
// THINGS<T> - Collection (can be a DO itself)
// ============================================================================

export interface Things<T extends Thing = Thing> extends ThingsData {
  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY
  // ═══════════════════════════════════════════════════════════════════════════

  readonly $id: string // URL: 'https://startups.studio'
  readonly $type: string // URL: 'https://schema.org.ai/Things'
  readonly itemType: string // URL: 'https://startups.studio/Startup'

  // Is this collection itself a DO?
  readonly isDO: boolean

  // ═══════════════════════════════════════════════════════════════════════════
  // CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  get(id: string): RpcPromise<T>
  create(data: Partial<Omit<T, '$id' | '$type' | 'ns'>>, options?: CreateOptions): RpcPromise<T>
  update(id: string, data: Partial<T>): RpcPromise<T>
  delete(id: string): RpcPromise<void>

  // ═══════════════════════════════════════════════════════════════════════════
  // QUERY
  // ═══════════════════════════════════════════════════════════════════════════

  list(): RpcPromise<T[]>
  find(query: Query): RpcPromise<T[]>
  first(query?: Query): RpcPromise<T | null>
  count(query?: Query): RpcPromise<number>
  search(text: string, limit?: number): RpcPromise<T[]>

  // ═══════════════════════════════════════════════════════════════════════════
  // ASYNC ITERATION (via RpcPromise)
  // ═══════════════════════════════════════════════════════════════════════════

  // Async iterable - works with for-await-of
  [Symbol.asyncIterator](): AsyncIterator<T>

  // Stream results as RpcPromise
  stream(): RpcPromise<AsyncIterable<T>>

  // ═══════════════════════════════════════════════════════════════════════════
  // CHAINING (DBPromise pattern from ai-database)
  // ═══════════════════════════════════════════════════════════════════════════

  filter(predicate: (item: T) => boolean): Things<T>
  map<U extends Thing>(mapper: (item: T) => U): Things<U>
  sort(compareFn: (a: T, b: T) => number): Things<T>
  limit(n: number): Things<T>
  offset(n: number): Things<T>

  // ═══════════════════════════════════════════════════════════════════════════
  // BATCH PROCESSING (ai-database forEach)
  // ═══════════════════════════════════════════════════════════════════════════

  forEach(fn: (item: T) => Promise<void>, options?: ForEachOptions): RpcPromise<ForEachProgress>

  // ═══════════════════════════════════════════════════════════════════════════
  // NATURAL LANGUAGE QUERY (template literal)
  // ═══════════════════════════════════════════════════════════════════════════

  // Usage: db.Startup`who closed deals this month?`
  (strings: TemplateStringsArray, ...values: unknown[]): RpcPromise<T[]>

  // ═══════════════════════════════════════════════════════════════════════════
  // PROMOTION
  // ═══════════════════════════════════════════════════════════════════════════

  // Promote this collection to its own DO (if not already)
  promote(): RpcPromise<ThingsDO<T>>
}

// ============================================================================
// THINGS DO - A Things collection that IS a Durable Object
// ============================================================================

export interface ThingsDO<T extends Thing = Thing> extends Things<T> {
  readonly isDO: true

  // When a Things IS a DO, it has the full DO capabilities
  // (nouns, verbs, relationships, actions, events, search, $, ai-*)

  // Resolve any URL
  resolve(url: string): RpcPromise<Thing>

  // Promote a Thing within this collection to its own DO
  promoteThing(id: string): RpcPromise<ThingDO>
}

// ============================================================================
// THINGS COLLECTION WRAPPER
// ============================================================================

// Wrap Things to integrate with CapnWeb RpcPromise
export type ThingsCollection<T extends Thing = Thing> = Things<T> & {
  // RpcPromise integration for method chaining across RPC boundary
  then<TResult>(onfulfilled?: (value: T[]) => TResult | PromiseLike<TResult>): RpcPromise<TResult>
}
