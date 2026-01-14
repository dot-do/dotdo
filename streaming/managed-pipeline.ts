/**
 * ManagedPipeline - HTTP adapter for sending events to our managed pipeline
 *
 * When a customer doesn't have their own Pipeline binding, but is authenticated
 * via oauth.do, events are sent to our shared managed pipeline.
 *
 * The managed pipeline:
 * 1. Accepts authenticated requests (oauth.do token)
 * 2. Routes events to the correct customer partition
 * 3. Writes to shared R2 Iceberg tables
 *
 * @example
 * ```typescript
 * const pipeline = new ManagedPipeline({
 *   endpoint: 'https://events.do/ingest',
 *   authToken: 'oauth.do-token',
 *   namespace: 'customer-ns',
 * })
 *
 * await pipeline.send([{ verb: 'Customer.created', source: 'customer-ns', timestamp: new Date().toISOString(), customerId: '123' }])
 * ```
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for ManagedPipeline
 */
export interface ManagedPipelineConfig {
  /** Managed pipeline endpoint URL */
  endpoint?: string
  /** OAuth token for authentication */
  authToken?: string
  /** Customer namespace for partitioning */
  namespace: string
  /** Organization ID (from oauth.do) */
  organizationId?: string
  /** Request timeout in ms */
  timeout?: number
  /** User agent string */
  userAgent?: string
}

/**
 * Pipeline event format - flat fields for R2/SQL compatibility
 *
 * Uses Noun.event semantic for verb field.
 * All fields are flat (no nested objects).
 */
export interface PipelineEvent {
  /** Event type in Noun.event format (e.g., 'Customer.created') */
  verb: string
  /** Origin of the event (DO namespace, worker name, etc.) */
  source: string
  /** ISO 8601 timestamp */
  timestamp: string
  /** Context (tenant namespace) */
  context?: string
  /** Stringified data payload (for complex objects) */
  data?: string
  /** All other fields are flat at root level */
  [key: string]: string | number | boolean | null | undefined
}

/**
 * Pipeline interface (compatible with Cloudflare Pipeline)
 */
export interface Pipeline {
  send(events: unknown[]): Promise<void>
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default managed pipeline endpoint - workers.do/events snippet */
export const DEFAULT_MANAGED_PIPELINE_URL = 'https://workers.do/events'

/** Default request timeout */
const DEFAULT_TIMEOUT = 30_000

// ============================================================================
// MANAGED PIPELINE CLASS
// ============================================================================

/**
 * ManagedPipeline - Sends events to our managed pipeline via HTTP
 */
export class ManagedPipeline implements Pipeline {
  private config: Required<Omit<ManagedPipelineConfig, 'authToken' | 'organizationId'>> & {
    authToken?: string
    organizationId?: string
  }

  constructor(config: ManagedPipelineConfig) {
    this.config = {
      endpoint: config.endpoint || DEFAULT_MANAGED_PIPELINE_URL,
      authToken: config.authToken,
      namespace: config.namespace,
      organizationId: config.organizationId,
      timeout: config.timeout || DEFAULT_TIMEOUT,
      userAgent: config.userAgent || 'dotdo/1.0',
    }
  }

  /**
   * Send events to the managed pipeline
   */
  async send(events: unknown[]): Promise<void> {
    if (events.length === 0) {
      return
    }

    // Enrich events with namespace metadata
    const enrichedEvents = events.map((event) => {
      const e = event as Partial<PipelineEvent>
      return {
        ...e,
        _meta: {
          ns: this.config.namespace,
          organizationId: this.config.organizationId,
          ...((e._meta as unknown as object) || {}),
        },
      }
    })

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': this.config.userAgent,
      'X-Namespace': this.config.namespace,
    }

    // Add auth header if we have a token
    if (this.config.authToken) {
      headers['Authorization'] = `Bearer ${this.config.authToken}`
    }

    if (this.config.organizationId) {
      headers['X-Organization-Id'] = this.config.organizationId
    }

    // Create abort controller for timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          events: enrichedEvents,
          timestamp: new Date().toISOString(),
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unknown error')
        throw new Error(`Managed pipeline error: ${response.status} ${response.statusText} - ${errorBody}`)
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Check if this pipeline is ready to send events
   * Returns true if we have an auth token
   */
  get isReady(): boolean {
    return !!this.config.authToken
  }

  /**
   * Get the endpoint URL
   */
  get endpoint(): string {
    return this.config.endpoint
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Get pipeline - returns native EVENTS binding or managed fallback
 *
 * oauth.do is the default auth provider for all DOs, so we can always
 * fall back to the managed pipeline. The namespace identifies the tenant.
 *
 * @param env - Cloudflare env with optional EVENTS binding
 * @param namespace - DO namespace (used as tenant identifier)
 * @returns Pipeline interface (native or managed)
 */
export function getPipeline(
  env: { EVENTS?: Pipeline },
  namespace: string
): Pipeline {
  // Prefer native EVENTS pipeline binding if available
  if (env.EVENTS) {
    return env.EVENTS
  }

  // Fall back to managed pipeline via workers.do/events
  // oauth.do is the default auth provider, so all DOs can send events
  return new ManagedPipeline({ namespace })
}
