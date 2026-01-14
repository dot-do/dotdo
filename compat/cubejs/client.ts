/**
 * @dotdo/cubejs - Cube.js Client
 *
 * A client for making queries to Cube.js-compatible APIs.
 * Supports both remote APIs and local execution.
 *
 * @example
 * ```typescript
 * import { CubeClient, QueryBuilder } from '@dotdo/cubejs'
 *
 * const client = new CubeClient({
 *   apiToken: 'your_api_token',
 *   apiUrl: 'https://cube.example.com/cubejs-api/v1',
 * })
 *
 * // Load data
 * const result = await client.load({
 *   measures: ['Orders.count'],
 *   dimensions: ['Orders.status'],
 * })
 *
 * // Use QueryBuilder
 * const query = new QueryBuilder()
 *   .select('Orders.count')
 *   .dimensions('Orders.status')
 *   .build()
 *
 * const result = await client.load(query)
 * ```
 */

import type { CubeSchema } from './schema'
import type { CubeQuery } from './query'
import { generateSQL } from './sql'
import { QueryError, AuthenticationError } from './errors'

// =============================================================================
// Client Types
// =============================================================================

/**
 * Security context for multi-tenancy
 */
export interface SecurityContext {
  [key: string]: unknown
}

/**
 * Load options
 */
export interface LoadOptions {
  /**
   * Security context for the request
   */
  securityContext?: SecurityContext

  /**
   * Request timeout in ms
   */
  timeout?: number

  /**
   * Progress callback
   */
  progressCallback?: (info: { stage: string }) => void
}

/**
 * Query result
 */
export interface QueryResult {
  /**
   * Result data rows
   */
  data: unknown[]

  /**
   * Query annotation with metadata
   */
  annotation: {
    measures: Record<string, { title: string; shortTitle: string; type: string }>
    dimensions: Record<string, { title: string; shortTitle: string; type: string }>
  }

  /**
   * The normalized query that was executed
   */
  query?: CubeQuery

  /**
   * Last refresh time of the data
   */
  lastRefreshTime?: string

  /**
   * Request ID for debugging
   */
  requestId?: string

  /**
   * Warning if row limit was hit
   */
  rowLimitWarning?: boolean
}

/**
 * Meta response
 */
export interface MetaResult {
  cubes: Array<{
    name: string
    title?: string
    measures: Array<{ name: string; title?: string; type: string }>
    dimensions: Array<{ name: string; title?: string; type: string }>
  }>
}

/**
 * Dry run response
 */
export interface DryRunResult {
  normalizedQueries: CubeQuery[]
  queryType: string
  pivotQuery: Record<string, unknown>
}

/**
 * Client options
 */
export interface CubeClientOptions {
  /**
   * API authentication token
   */
  apiToken: string

  /**
   * Base URL for the Cube.js API
   */
  apiUrl: string

  /**
   * Custom fetch implementation
   */
  fetch?: typeof fetch

  /**
   * Default timeout in ms
   * @default 120000
   */
  timeout?: number

  /**
   * Headers to include with every request
   */
  headers?: Record<string, string>
}

// =============================================================================
// Cube Client
// =============================================================================

/**
 * Client for making queries to Cube.js-compatible APIs
 */
export class CubeClient {
  private options: CubeClientOptions
  private schemas: Map<string, CubeSchema>
  private fetchFn: typeof fetch
  private subscriptions: Map<string, { query: CubeQuery; callback: (result: QueryResult) => void; interval: ReturnType<typeof setInterval> }>

  constructor(options: CubeClientOptions) {
    if (!options.apiToken) {
      throw new Error('API token is required')
    }

    this.options = {
      timeout: 120000,
      ...options,
    }

    this.schemas = new Map()
    this.fetchFn = options.fetch || fetch
    this.subscriptions = new Map()
  }

  // ===========================================================================
  // Schema Management
  // ===========================================================================

  /**
   * Register a cube schema for local SQL generation
   */
  registerCube(schema: CubeSchema): void {
    this.schemas.set(schema.name, schema)
  }

  /**
   * Get a registered cube schema
   */
  getCube(name: string): CubeSchema | undefined {
    return this.schemas.get(name)
  }

  // ===========================================================================
  // Query Methods
  // ===========================================================================

  /**
   * Load data for a query
   */
  async load(query: CubeQuery, options?: LoadOptions): Promise<QueryResult> {
    const response = await this.request('/load', {
      method: 'POST',
      body: JSON.stringify({ query }),
      securityContext: options?.securityContext,
      timeout: options?.timeout,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }))
      throw new QueryError(error.error || 'Query failed', {
        query,
        statusCode: response.status,
      })
    }

    return response.json()
  }

  /**
   * Get SQL for a query without executing
   */
  async sql(query: CubeQuery): Promise<{ sql: { sql: string[]; params?: unknown[] } }> {
    const response = await this.request('/sql', {
      method: 'POST',
      body: JSON.stringify({ query }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }))
      throw new QueryError(error.error || 'SQL generation failed', {
        query,
        statusCode: response.status,
      })
    }

    return response.json()
  }

  /**
   * Generate SQL locally using registered schemas
   */
  toSQL(query: CubeQuery): string {
    return generateSQL(query, this.schemas)
  }

  /**
   * Validate a query without executing (dry run)
   */
  async dryRun(query: CubeQuery): Promise<DryRunResult> {
    const response = await this.request('/dry-run', {
      method: 'POST',
      body: JSON.stringify({ query }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }))
      throw new QueryError(error.error || 'Dry run failed', {
        query,
        statusCode: response.status,
      })
    }

    return response.json()
  }

  /**
   * Get metadata about available cubes
   */
  async meta(): Promise<MetaResult> {
    const response = await this.request('/meta', {
      method: 'GET',
    })

    if (!response.ok) {
      throw new QueryError('Failed to fetch meta', {
        statusCode: response.status,
      })
    }

    return response.json()
  }

  // ===========================================================================
  // Subscription Methods
  // ===========================================================================

  /**
   * Subscribe to query results for real-time updates
   *
   * @param query - The query to subscribe to
   * @param callback - Callback when new data is available
   * @param pollInterval - Poll interval in ms (default: 5000)
   * @returns Unsubscribe function
   */
  subscribe(
    query: CubeQuery,
    callback: (result: QueryResult) => void,
    pollInterval: number = 5000
  ): () => void {
    const subscriptionId = Math.random().toString(36).substring(2, 15)

    // Initial load
    this.load({ ...query, renewQuery: true }).then(callback).catch(console.error)

    // Set up polling
    const interval = setInterval(async () => {
      try {
        const result = await this.load({ ...query, renewQuery: true })
        callback(result)
      } catch (error) {
        console.error('Subscription poll error:', error)
      }
    }, pollInterval)

    this.subscriptions.set(subscriptionId, { query, callback, interval })

    // Return unsubscribe function
    return () => {
      const sub = this.subscriptions.get(subscriptionId)
      if (sub) {
        clearInterval(sub.interval)
        this.subscriptions.delete(subscriptionId)
      }
    }
  }

  /**
   * Unsubscribe from all subscriptions
   */
  unsubscribeAll(): void {
    for (const [id, sub] of Array.from(this.subscriptions)) {
      clearInterval(sub.interval)
      this.subscriptions.delete(id)
    }
  }

  // ===========================================================================
  // Request Helper
  // ===========================================================================

  /**
   * Make a request to the Cube.js API
   */
  private async request(
    endpoint: string,
    options: {
      method: string
      body?: string
      securityContext?: SecurityContext
      timeout?: number
    }
  ): Promise<Response> {
    const url = `${this.options.apiUrl}${endpoint}`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': this.options.apiToken,
      ...this.options.headers,
    }

    if (options.securityContext) {
      headers['x-security-context'] = btoa(JSON.stringify(options.securityContext))
    }

    const controller = new AbortController()
    const timeout = options.timeout || this.options.timeout
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await this.fetchFn(url, {
        method: options.method,
        headers,
        body: options.body,
        signal: controller.signal,
      })

      return response
    } finally {
      clearTimeout(timeoutId)
    }
  }
}
