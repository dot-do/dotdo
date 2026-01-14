/**
 * ACID Test Suite - Phase 5: E2E Test Context
 *
 * E2ETestContext interface and factory function for running E2E tests
 * against Cloudflare deployments. Provides methods for DO management,
 * event pipeline verification, and Iceberg querying.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 5 E2E Pipeline
 */

import {
  type E2EConfig,
  type TestEnvironment,
  getE2EConfig,
  generateTestResourceName,
  calculateRetryDelay,
} from './config'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Event data structure for pipeline events
 */
export interface PipelineEvent {
  /** Unique event ID */
  id: string
  /** Event type (e.g., 'thing.created', 'lifecycle.clone') */
  type: string
  /** Source DO namespace */
  source: string
  /** Event timestamp (ISO string) */
  timestamp: string
  /** Correlation ID for tracing */
  correlationId?: string
  /** Event payload */
  payload: Record<string, unknown>
  /** Event metadata */
  metadata?: {
    version?: number
    branch?: string
    sequence?: number
  }
}

/**
 * Iceberg partition descriptor
 */
export interface IcebergPartition {
  year: number
  month: number
  day: number
  hour?: number
}

/**
 * Iceberg partition info
 */
export interface PartitionInfo {
  fileCount: number
  rowCount: number
  sizeBytes: number
  lastModified: Date
}

/**
 * DO stub for interacting with Durable Objects
 */
export interface DOStub {
  /** GET request to DO */
  get<T = unknown>(path: string): Promise<T>
  /** POST request to DO */
  post<T = unknown>(path: string, body?: unknown): Promise<T>
  /** PUT request to DO */
  put<T = unknown>(path: string, body?: unknown): Promise<T>
  /** DELETE request to DO */
  delete(path: string): Promise<void>
  /** Generic fetch to DO */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

/**
 * Cloudflare API client for DO management
 */
export interface CloudflareAPIClient {
  /** Get DO namespace info */
  getNamespace(namespaceId: string): Promise<{ id: string; name: string }>
  /** List DOs in a namespace */
  listObjects(namespaceId: string): Promise<Array<{ id: string; name: string }>>
  /** Delete a DO instance */
  deleteObject(namespaceId: string, objectId: string): Promise<void>
  /** Get DO alarm info */
  getAlarms(namespaceId: string, objectId: string): Promise<Array<{ scheduledTime: string }>>
}

/**
 * E2E Test Context interface
 *
 * Provides all necessary methods for running E2E tests against
 * Cloudflare infrastructure, including DO management, pipeline
 * verification, and Iceberg querying.
 */
export interface E2ETestContext {
  /** Configuration for this context */
  config: E2EConfig

  /** Current test environment */
  environment: TestEnvironment

  /** Base URL for the environment */
  baseUrl: string

  /** Unique test run ID for isolation */
  testRunId: string

  /** Test resources created during this run (for cleanup) */
  createdResources: string[]

  // -------------------------------------------------------------------------
  // HTTP Client Methods
  // -------------------------------------------------------------------------

  /**
   * Fetch from the E2E endpoint
   */
  fetch(path: string, init?: RequestInit): Promise<Response>

  /**
   * JSON GET request
   */
  get<T = unknown>(path: string): Promise<T>

  /**
   * JSON POST request
   */
  post<T = unknown>(path: string, body?: unknown): Promise<T>

  // -------------------------------------------------------------------------
  // DO Management Methods
  // -------------------------------------------------------------------------

  /**
   * Get a stub for interacting with a specific DO
   */
  getDOStub(namespace: string): DOStub

  /**
   * Create a test DO namespace
   * Returns the namespace identifier for the test DO
   */
  createTestNamespace(suffix?: string): Promise<string>

  /**
   * Delete a test namespace and all its data
   */
  deleteTestNamespace(namespace: string): Promise<void>

  /**
   * Get Cloudflare API client for advanced DO management
   */
  getCloudflareAPI(): CloudflareAPIClient

  // -------------------------------------------------------------------------
  // Pipeline Verification Methods
  // -------------------------------------------------------------------------

  /**
   * Wait for an event to appear in the pipeline
   */
  waitForEvent(
    eventId: string,
    options?: {
      timeout?: number
      pollInterval?: number
    }
  ): Promise<PipelineEvent>

  /**
   * Wait for multiple events to appear
   */
  waitForEvents(
    filter: {
      type?: string
      source?: string
      correlationId?: string
      count?: number
    },
    options?: {
      timeout?: number
      pollInterval?: number
    }
  ): Promise<PipelineEvent[]>

  /**
   * Check if an event exists in the pipeline
   */
  eventExists(eventId: string): Promise<boolean>

  /**
   * Get pipeline statistics
   */
  getPipelineStats(): Promise<{
    totalEvents: number
    eventsPerMinute: number
    lastEventAt: Date | null
    backlog: number
  }>

  // -------------------------------------------------------------------------
  // R2/Iceberg Methods
  // -------------------------------------------------------------------------

  /**
   * Query the Iceberg table using SQL
   */
  queryIceberg<T = unknown>(query: string): Promise<T[]>

  /**
   * Verify an Iceberg partition exists and has data
   */
  verifyIcebergPartition(partition: IcebergPartition): Promise<PartitionInfo>

  /**
   * Wait for data to appear in Iceberg (accounting for batch delay)
   */
  waitForIcebergData(
    filter: {
      eventType?: string
      source?: string
      minCount?: number
    },
    options?: {
      timeout?: number
      pollInterval?: number
    }
  ): Promise<number>

  // -------------------------------------------------------------------------
  // Latency Measurement Methods
  // -------------------------------------------------------------------------

  /**
   * Measure end-to-end latency for an operation
   */
  measureLatency<T>(operation: () => Promise<T>): Promise<{
    result: T
    startTime: number
    endTime: number
    latencyMs: number
  }>

  /**
   * Measure event pipeline latency (DO write -> Iceberg query)
   */
  measurePipelineLatency(
    operation: () => Promise<{ eventId: string }>
  ): Promise<{
    writeLatencyMs: number
    pipelineLatencyMs: number
    icebergLatencyMs: number
    totalLatencyMs: number
  }>

  // -------------------------------------------------------------------------
  // Cleanup Methods
  // -------------------------------------------------------------------------

  /**
   * Cleanup all test resources created during this run
   */
  cleanup(): Promise<void>

  /**
   * Cleanup old test resources (from previous runs)
   */
  cleanupStale(maxAgeSeconds?: number): Promise<number>

  /**
   * Register a resource for cleanup
   */
  registerResource(resourceId: string): void
}

// ============================================================================
// CONTEXT IMPLEMENTATION
// ============================================================================

/**
 * Default implementation of E2ETestContext
 */
class E2ETestContextImpl implements E2ETestContext {
  config: E2EConfig
  environment: TestEnvironment
  baseUrl: string
  testRunId: string
  createdResources: string[] = []

  private headers: Record<string, string>

  constructor(config: E2EConfig) {
    this.config = config
    this.environment = config.environment
    this.baseUrl = config.endpoints[config.environment].baseUrl
    this.testRunId = generateTestResourceName('run')

    // Setup auth headers if required
    this.headers = {
      'Content-Type': 'application/json',
      'X-Test-Run-Id': this.testRunId,
    }

    if (config.credentials.apiToken) {
      this.headers['Authorization'] = `Bearer ${config.credentials.apiToken}`
    }
  }

  // -------------------------------------------------------------------------
  // HTTP Client Methods
  // -------------------------------------------------------------------------

  async fetch(path: string, init?: RequestInit): Promise<Response> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`

    const response = await globalThis.fetch(url, {
      ...init,
      headers: {
        ...this.headers,
        ...(init?.headers as Record<string, string>),
      },
    })

    return response
  }

  async get<T = unknown>(path: string): Promise<T> {
    const response = await this.fetch(path, { method: 'GET' })
    if (!response.ok) {
      throw new Error(`GET ${path} failed: ${response.status} ${response.statusText}`)
    }
    return response.json() as Promise<T>
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    const response = await this.fetch(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      throw new Error(`POST ${path} failed: ${response.status} ${response.statusText}`)
    }
    const text = await response.text()
    return text ? JSON.parse(text) : undefined
  }

  // -------------------------------------------------------------------------
  // DO Management Methods
  // -------------------------------------------------------------------------

  getDOStub(namespace: string): DOStub {
    const ctx = this
    const baseUrl = `${this.baseUrl}/do/${namespace}`

    return {
      async get<T>(path: string): Promise<T> {
        const response = await ctx.fetch(`${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`)
        if (!response.ok) {
          throw new Error(`DO GET ${path} failed: ${response.status}`)
        }
        return response.json() as Promise<T>
      },

      async post<T>(path: string, body?: unknown): Promise<T> {
        const response = await ctx.fetch(`${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`, {
          method: 'POST',
          body: body ? JSON.stringify(body) : undefined,
        })
        if (!response.ok) {
          throw new Error(`DO POST ${path} failed: ${response.status}`)
        }
        const text = await response.text()
        return text ? JSON.parse(text) : undefined
      },

      async put<T>(path: string, body?: unknown): Promise<T> {
        const response = await ctx.fetch(`${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`, {
          method: 'PUT',
          body: body ? JSON.stringify(body) : undefined,
        })
        if (!response.ok) {
          throw new Error(`DO PUT ${path} failed: ${response.status}`)
        }
        const text = await response.text()
        return text ? JSON.parse(text) : undefined
      },

      async delete(path: string): Promise<void> {
        const response = await ctx.fetch(`${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`, {
          method: 'DELETE',
        })
        if (!response.ok) {
          throw new Error(`DO DELETE ${path} failed: ${response.status}`)
        }
      },

      async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        const path = typeof input === 'string' ? input : input.toString()
        return ctx.fetch(`${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`, init)
      },
    }
  }

  async createTestNamespace(suffix?: string): Promise<string> {
    const namespace = generateTestResourceName(suffix)
    this.registerResource(namespace)

    // Initialize the namespace by making a request to create it
    await this.post(`/do/${namespace}/init`, {
      testRunId: this.testRunId,
      createdAt: new Date().toISOString(),
    })

    return namespace
  }

  async deleteTestNamespace(namespace: string): Promise<void> {
    try {
      await this.post(`/do/${namespace}/cleanup`, {
        force: true,
      })
    } catch (error) {
      // Ignore errors during cleanup - namespace might already be deleted
      console.warn(`Failed to cleanup namespace ${namespace}:`, error)
    }
  }

  getCloudflareAPI(): CloudflareAPIClient {
    const { accountId, apiToken } = this.config.credentials

    if (!accountId || !apiToken) {
      throw new Error('Cloudflare credentials not configured')
    }

    const baseUrl = 'https://api.cloudflare.com/client/v4'
    const headers = {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    }

    return {
      async getNamespace(namespaceId: string) {
        const response = await globalThis.fetch(
          `${baseUrl}/accounts/${accountId}/workers/durable_objects/namespaces/${namespaceId}`,
          { headers }
        )
        const data = await response.json() as { result: { id: string; name: string } }
        return data.result
      },

      async listObjects(namespaceId: string) {
        const response = await globalThis.fetch(
          `${baseUrl}/accounts/${accountId}/workers/durable_objects/namespaces/${namespaceId}/objects`,
          { headers }
        )
        const data = await response.json() as { result: Array<{ id: string; name: string }> }
        return data.result || []
      },

      async deleteObject(namespaceId: string, objectId: string) {
        await globalThis.fetch(
          `${baseUrl}/accounts/${accountId}/workers/durable_objects/namespaces/${namespaceId}/objects/${objectId}`,
          { method: 'DELETE', headers }
        )
      },

      async getAlarms(namespaceId: string, objectId: string) {
        const response = await globalThis.fetch(
          `${baseUrl}/accounts/${accountId}/workers/durable_objects/namespaces/${namespaceId}/objects/${objectId}/alarms`,
          { headers }
        )
        const data = await response.json() as { result: Array<{ scheduledTime: string }> }
        return data.result || []
      },
    }
  }

  // -------------------------------------------------------------------------
  // Pipeline Verification Methods
  // -------------------------------------------------------------------------

  async waitForEvent(
    eventId: string,
    options: { timeout?: number; pollInterval?: number } = {}
  ): Promise<PipelineEvent> {
    const timeout = options.timeout || this.config.timeouts.pipelineDelivery
    const pollInterval = options.pollInterval || 1000
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      try {
        const event = await this.get<PipelineEvent | null>(`/pipeline/events/${eventId}`)
        if (event) {
          return event
        }
      } catch {
        // Event not found yet, continue polling
      }

      await this.sleep(pollInterval)
    }

    throw new Error(`Timeout waiting for event ${eventId} after ${timeout}ms`)
  }

  async waitForEvents(
    filter: { type?: string; source?: string; correlationId?: string; count?: number },
    options: { timeout?: number; pollInterval?: number } = {}
  ): Promise<PipelineEvent[]> {
    const timeout = options.timeout || this.config.timeouts.pipelineDelivery
    const pollInterval = options.pollInterval || 1000
    const startTime = Date.now()
    const targetCount = filter.count || 1

    while (Date.now() - startTime < timeout) {
      try {
        const params = new URLSearchParams()
        if (filter.type) params.set('type', filter.type)
        if (filter.source) params.set('source', filter.source)
        if (filter.correlationId) params.set('correlationId', filter.correlationId)

        const events = await this.get<PipelineEvent[]>(`/pipeline/events?${params.toString()}`)

        if (events.length >= targetCount) {
          return events.slice(0, targetCount)
        }
      } catch {
        // Events not found yet, continue polling
      }

      await this.sleep(pollInterval)
    }

    throw new Error(`Timeout waiting for ${targetCount} events matching filter after ${timeout}ms`)
  }

  async eventExists(eventId: string): Promise<boolean> {
    try {
      await this.get(`/pipeline/events/${eventId}`)
      return true
    } catch {
      return false
    }
  }

  async getPipelineStats(): Promise<{
    totalEvents: number
    eventsPerMinute: number
    lastEventAt: Date | null
    backlog: number
  }> {
    return this.get('/pipeline/stats')
  }

  // -------------------------------------------------------------------------
  // R2/Iceberg Methods
  // -------------------------------------------------------------------------

  async queryIceberg<T = unknown>(query: string): Promise<T[]> {
    const response = await this.post<{ rows: T[] }>('/iceberg/query', { sql: query })
    return response.rows
  }

  async verifyIcebergPartition(partition: IcebergPartition): Promise<PartitionInfo> {
    const { year, month, day, hour } = partition
    const path = hour !== undefined
      ? `/iceberg/partitions/${year}/${month}/${day}/${hour}`
      : `/iceberg/partitions/${year}/${month}/${day}`

    const info = await this.get<{
      fileCount: number
      rowCount: number
      sizeBytes: number
      lastModified: string
    }>(path)

    return {
      ...info,
      lastModified: new Date(info.lastModified),
    }
  }

  async waitForIcebergData(
    filter: { eventType?: string; source?: string; minCount?: number },
    options: { timeout?: number; pollInterval?: number } = {}
  ): Promise<number> {
    const timeout = options.timeout || this.config.timeouts.icebergFlush
    const pollInterval = options.pollInterval || 5000
    const startTime = Date.now()
    const minCount = filter.minCount || 1

    while (Date.now() - startTime < timeout) {
      try {
        const conditions: string[] = []
        if (filter.eventType) conditions.push(`type = '${filter.eventType}'`)
        if (filter.source) conditions.push(`source = '${filter.source}'`)

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
        const query = `SELECT COUNT(*) as count FROM events ${whereClause}`

        const result = await this.queryIceberg<{ count: number }>(query)
        const count = result[0]?.count || 0

        if (count >= minCount) {
          return count
        }
      } catch {
        // Query failed, continue polling
      }

      await this.sleep(pollInterval)
    }

    throw new Error(`Timeout waiting for Iceberg data matching filter after ${timeout}ms`)
  }

  // -------------------------------------------------------------------------
  // Latency Measurement Methods
  // -------------------------------------------------------------------------

  async measureLatency<T>(operation: () => Promise<T>): Promise<{
    result: T
    startTime: number
    endTime: number
    latencyMs: number
  }> {
    const startTime = Date.now()
    const result = await operation()
    const endTime = Date.now()

    return {
      result,
      startTime,
      endTime,
      latencyMs: endTime - startTime,
    }
  }

  async measurePipelineLatency(
    operation: () => Promise<{ eventId: string }>
  ): Promise<{
    writeLatencyMs: number
    pipelineLatencyMs: number
    icebergLatencyMs: number
    totalLatencyMs: number
  }> {
    const startTime = Date.now()

    // Measure write operation
    const writeStart = Date.now()
    const { eventId } = await operation()
    const writeLatencyMs = Date.now() - writeStart

    // Measure pipeline delivery
    const pipelineStart = Date.now()
    await this.waitForEvent(eventId)
    const pipelineLatencyMs = Date.now() - pipelineStart

    // Measure Iceberg availability
    const icebergStart = Date.now()
    await this.waitForIcebergData({ minCount: 1 }, { timeout: this.config.timeouts.icebergFlush })
    const icebergLatencyMs = Date.now() - icebergStart

    const totalLatencyMs = Date.now() - startTime

    return {
      writeLatencyMs,
      pipelineLatencyMs,
      icebergLatencyMs,
      totalLatencyMs,
    }
  }

  // -------------------------------------------------------------------------
  // Cleanup Methods
  // -------------------------------------------------------------------------

  async cleanup(): Promise<void> {
    const errors: Error[] = []

    for (const resource of this.createdResources) {
      try {
        await this.deleteTestNamespace(resource)
      } catch (error) {
        errors.push(error as Error)
      }
    }

    this.createdResources = []

    if (errors.length > 0) {
      console.warn(`Cleanup completed with ${errors.length} errors`)
    }
  }

  async cleanupStale(maxAgeSeconds?: number): Promise<number> {
    const maxAge = maxAgeSeconds || this.config.cleanup.maxAge
    const cutoffTime = Date.now() - maxAge * 1000
    let cleanedCount = 0

    try {
      // Get list of test namespaces
      const namespaces = await this.get<Array<{ name: string; createdAt: string }>>('/test/namespaces')

      for (const ns of namespaces) {
        const createdAt = new Date(ns.createdAt).getTime()

        if (ns.name.startsWith(this.config.cleanup.prefix) && createdAt < cutoffTime) {
          try {
            await this.deleteTestNamespace(ns.name)
            cleanedCount++
          } catch {
            // Continue with other namespaces
          }
        }
      }
    } catch {
      // Failed to list namespaces, skip stale cleanup
    }

    return cleanedCount
  }

  registerResource(resourceId: string): void {
    this.createdResources.push(resourceId)
  }

  // -------------------------------------------------------------------------
  // Private Helper Methods
  // -------------------------------------------------------------------------

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create an E2E test context for the specified environment
 */
export function createE2EContext(environment?: TestEnvironment): E2ETestContext {
  const config = getE2EConfig()

  if (environment) {
    config.environment = environment
  }

  return new E2ETestContextImpl(config)
}

/**
 * Create an E2E test context with custom configuration
 */
export function createE2EContextWithConfig(config: E2EConfig): E2ETestContext {
  return new E2ETestContextImpl(config)
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Retry an operation with exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number
    shouldRetry?: (error: Error) => boolean
  } = {}
): Promise<T> {
  const config = getE2EConfig()
  const maxRetries = options.maxRetries ?? config.retries.testRetries
  const shouldRetry = options.shouldRetry ?? (() => true)

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error as Error

      if (attempt < maxRetries && shouldRetry(lastError)) {
        const delay = calculateRetryDelay(attempt)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError
}

/**
 * Skip test if E2E is not enabled for the current environment
 */
export function skipIfNoE2E(): boolean {
  const config = getE2EConfig()
  const endpoint = config.endpoints[config.environment]
  return !endpoint.e2eEnabled
}

/**
 * Skip test if environment is read-only
 */
export function skipIfReadOnly(): boolean {
  const config = getE2EConfig()
  const endpoint = config.endpoints[config.environment]
  return endpoint.readOnly
}

/**
 * Skip test if Cloudflare credentials are not available
 */
export function skipIfNoCredentials(): boolean {
  const config = getE2EConfig()
  return !config.credentials.accountId || !config.credentials.apiToken
}

// ============================================================================
// EXPORTS
// ============================================================================

export { E2EConfig, TestEnvironment } from './config'
