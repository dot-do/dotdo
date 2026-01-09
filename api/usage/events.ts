import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

/**
 * HTTP methods supported for usage events
 */
export const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
export type HttpMethod = z.infer<typeof HttpMethodSchema>

/**
 * Metadata captured with each usage event
 */
export const UsageEventMetadataSchema = z.object({
  /** User agent string */
  userAgent: z.string().optional(),
  /** Client IP address (hashed for privacy) */
  ipHash: z.string().optional(),
  /** Request content length in bytes */
  requestSize: z.number().nonnegative().optional(),
  /** Response content length in bytes */
  responseSize: z.number().nonnegative().optional(),
  /** Cloudflare ray ID */
  rayId: z.string().optional(),
  /** Cloudflare datacenter/colo */
  colo: z.string().optional(),
})

export type UsageEventMetadata = z.infer<typeof UsageEventMetadataSchema>

/**
 * ISO 8601 datetime string validation
 */
const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/

export const Iso8601TimestampSchema = z.string().refine(
  (val) => {
    if (!iso8601Regex.test(val)) return false
    // Also verify it's a valid date
    const date = new Date(val)
    return !isNaN(date.getTime())
  },
  { message: 'Invalid ISO 8601 timestamp' },
)

/**
 * UsageEvent - represents a single API request for analytics
 */
export const UsageEventSchema = z.object({
  /** Unique event ID */
  id: z.string().min(1),
  /** Timestamp in ISO 8601 format */
  timestamp: Iso8601TimestampSchema,
  /** User ID (if authenticated) */
  userId: z.string().optional(),
  /** API key ID (if authenticated via API key) */
  apiKeyId: z.string().optional(),
  /** Request endpoint path */
  endpoint: z.string().min(1),
  /** HTTP method */
  method: HttpMethodSchema,
  /** Response status code (100-599) */
  statusCode: z.number().int().min(100).max(599),
  /** Request latency in milliseconds */
  latencyMs: z.number().nonnegative(),
  /** Computed cost units for this request */
  cost: z.number().nonnegative(),
  /** Request metadata */
  metadata: UsageEventMetadataSchema.optional(),
})

export type UsageEvent = z.infer<typeof UsageEventSchema>

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a usage event against the schema.
 * Throws ZodError if validation fails.
 *
 * @param event - The event to validate
 * @returns true if valid
 * @throws ZodError if validation fails
 */
export function validateUsageEvent(event: unknown): boolean {
  UsageEventSchema.parse(event)
  return true
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Required fields for creating a usage event
 */
export interface CreateUsageEventInput {
  id?: string
  timestamp?: string
  userId?: string
  apiKeyId?: string
  endpoint: string
  method: HttpMethod
  statusCode: number
  latencyMs: number
  cost: number
  metadata?: UsageEventMetadata
}

/**
 * Create a usage event with auto-generated id and timestamp.
 *
 * @param data - Event data (endpoint, method, statusCode, latencyMs, cost required)
 * @returns A validated UsageEvent
 * @throws ZodError if required fields are missing or invalid
 */
export function createUsageEvent(data: Partial<UsageEvent>): UsageEvent {
  const event: UsageEvent = {
    id: data.id ?? crypto.randomUUID(),
    timestamp: data.timestamp ?? new Date().toISOString(),
    endpoint: data.endpoint!,
    method: data.method!,
    statusCode: data.statusCode!,
    latencyMs: data.latencyMs!,
    cost: data.cost!,
    ...(data.userId && { userId: data.userId }),
    ...(data.apiKeyId && { apiKeyId: data.apiKeyId }),
    ...(data.metadata && { metadata: data.metadata }),
  }

  // Validate the constructed event
  UsageEventSchema.parse(event)

  return event
}

// ============================================================================
// Batching
// ============================================================================

/**
 * Default batch size for pipeline ingestion
 */
export const DEFAULT_BATCH_SIZE = 1000

/**
 * Split usage events into batches for pipeline ingestion.
 *
 * @param events - Array of usage events to batch
 * @param maxBatchSize - Maximum events per batch (default: 1000)
 * @returns Array of event batches
 */
export function batchUsageEvents(events: UsageEvent[], maxBatchSize: number = DEFAULT_BATCH_SIZE): UsageEvent[][] {
  if (events.length === 0) {
    return []
  }

  const batches: UsageEvent[][] = []

  for (let i = 0; i < events.length; i += maxBatchSize) {
    batches.push(events.slice(i, i + maxBatchSize))
  }

  return batches
}
