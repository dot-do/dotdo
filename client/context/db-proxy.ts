/**
 * $.db Proxy Factory for SaasKit
 *
 * Creates a proxy that provides fluent database access:
 *   const db = create$DbProxy<MySchemas>({ client })
 *   const user = await db.User.create({ name: 'Alice' })
 *
 * Features:
 * - Lazy evaluation: no network calls until method is invoked
 * - Type-safe: infers types from schema
 * - Caches noun proxies for performance
 * - Supports context binding for multi-tenant scenarios
 *
 * @see dotdo-tju8l
 */

/**
 * Database client interface expected by the proxy
 */
export interface DbClient {
  create(noun: string, data: unknown): Promise<unknown>
  get(noun: string, id: string): Promise<unknown>
  update(noun: string, id: string, data: unknown): Promise<unknown>
  delete(noun: string, id: string): Promise<unknown>
  list(noun: string, options?: ListOptions, context?: Record<string, unknown>): Promise<unknown>
  find(noun: string, filter: Record<string, unknown>): Promise<unknown>
  search(noun: string, query: string, options?: SearchOptions): Promise<unknown>
  semanticSearch(noun: string, query: string, options?: SemanticSearchOptions): Promise<unknown>
}

/**
 * Configuration for the db proxy
 */
export interface DbProxyConfig {
  client: DbClient
  context?: Record<string, unknown>
}

/**
 * Creates a proxy that provides fluent database access for all Noun types
 */
export function create$DbProxy<TSchemas extends Record<string, unknown>>(
  config: DbProxyConfig
): DbProxy<TSchemas> {
  const { client, context } = config

  // Cache for noun proxies - ensures same noun access returns same proxy instance
  const nounProxyCache = new Map<string, NounProxy<unknown>>()

  // Create the main db proxy that intercepts property access for Nouns
  return new Proxy({} as DbProxy<TSchemas>, {
    get(_target, noun: string) {
      // Return cached proxy if exists
      if (nounProxyCache.has(noun)) {
        return nounProxyCache.get(noun)
      }

      // Create a new noun proxy with all CRUD and query methods
      const nounProxy = createNounProxy(noun, client, context)
      nounProxyCache.set(noun, nounProxy)

      return nounProxy
    }
  })
}

/**
 * Creates a proxy for a specific Noun type with all database operations
 */
function createNounProxy<T>(
  noun: string,
  client: DbClient,
  context?: Record<string, unknown>
): NounProxy<T> {
  // Method implementations that delegate to the client
  // Only pass context when it's defined to avoid extra undefined argument
  const methods: NounProxy<T> = {
    create: (data: Partial<T>) => client.create(noun, data) as Promise<T>,

    get: (id: string) => client.get(noun, id) as Promise<T | null>,

    update: (id: string, data: Partial<T>) =>
      client.update(noun, id, data) as Promise<T>,

    delete: (id: string) =>
      client.delete(noun, id) as Promise<{ deleted: boolean; id: string }>,

    list: (options?: ListOptions) => {
      // Only pass context as third argument if it's defined
      if (context) {
        return client.list(noun, options, context) as Promise<ListResult<T>>
      }
      return client.list(noun, options) as Promise<ListResult<T>>
    },

    find: (filter: Record<string, unknown>) =>
      client.find(noun, filter) as Promise<T[]>,

    search: (query: string, options?: SearchOptions) => {
      // Only pass options as third argument if provided
      if (options !== undefined) {
        return client.search(noun, query, options) as Promise<SearchResult<T>>
      }
      return client.search(noun, query) as Promise<SearchResult<T>>
    },

    semanticSearch: (query: string, options?: SemanticSearchOptions) => {
      // Only pass options as third argument if provided
      if (options !== undefined) {
        return client.semanticSearch(noun, query, options) as Promise<SemanticSearchResult<T>>
      }
      return client.semanticSearch(noun, query) as Promise<SemanticSearchResult<T>>
    },
  }

  // Create a proxy that allows method access but binds 'this' correctly
  // This enables storing method references: const createUser = db.User.create
  return new Proxy(methods, {
    get(target, prop: string) {
      const method = target[prop as keyof NounProxy<T>]
      if (typeof method === 'function') {
        // Return bound method so it can be stored and invoked later
        return method.bind(target)
      }
      return method
    }
  })
}

/**
 * Type definition for the db proxy
 * Provides type-safe access to database operations for each Noun type
 */
export type DbProxy<TSchemas extends Record<string, unknown>> = {
  [K in keyof TSchemas]: NounProxy<TSchemas[K]>
}

/**
 * Proxy for a single Noun type with all CRUD and query operations
 */
export interface NounProxy<T> {
  create(data: Partial<T>): Promise<T>
  get(id: string): Promise<T | null>
  update(id: string, data: Partial<T>): Promise<T>
  delete(id: string): Promise<{ deleted: boolean; id: string }>
  list(options?: ListOptions): Promise<ListResult<T>>
  find(filter: Record<string, unknown>): Promise<T[]>
  search(query: string, options?: SearchOptions): Promise<SearchResult<T>>
  semanticSearch(query: string, options?: SemanticSearchOptions): Promise<SemanticSearchResult<T>>
}

/**
 * Options for list operations
 */
export interface ListOptions {
  limit?: number
  cursor?: string
  orderBy?: string
  order?: 'asc' | 'desc'
}

/**
 * Result from list operations
 */
export interface ListResult<T> {
  data: T[]
  cursor: string | null
  hasMore: boolean
}

/**
 * Options for full-text search
 */
export interface SearchOptions {
  fields?: string[]
  limit?: number
  highlight?: boolean
}

/**
 * Result from full-text search
 */
export interface SearchResult<T> {
  results: T[]
  total: number
}

/**
 * Options for semantic (AI-powered) search
 */
export interface SemanticSearchOptions {
  limit?: number
  minScore?: number
  includeVector?: boolean
}

/**
 * Result from semantic search
 */
export interface SemanticSearchResult<T> {
  results: Array<{ item: T; score: number }>
  total: number
}
