/**
 * Events Snippet
 *
 * Two roles:
 * 1. Normalizer - Converts various event formats to the unified 5W+H schema
 * 2. Ingest Handler - Edge endpoint at workers.do/events that:
 *    - Accepts events from DOs without native Pipeline binding
 *    - Enriches with request metadata (CF geo, IP, timestamp)
 *    - Forwards to underlying worker with Pipeline binding
 *
 * The ingest handler is a Cloudflare Snippet - runs before the worker
 * for minimal cost while adding request context to events.
 *
 * Reference: docs/concepts/events.mdx
 */

// Cloudflare Workers types (when not using @cloudflare/workers-types)
declare global {
  interface ExecutionContext {
    waitUntil(promise: Promise<unknown>): void
    passThroughOnException(): void
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Event formats supported by the normalizer
 */
export enum EventFormat {
  Internal = 'internal',
  EPCIS = 'epcis',
  Evalite = 'evalite',
  Unknown = 'unknown',
}

/**
 * 5W+H Event Schema - the universal event format
 */
export interface Event5WH {
  // WHO - Identity
  actor: string
  source?: string
  destination?: string

  // WHAT - Objects
  object: string
  type: string
  quantity?: number

  // WHEN - Time
  timestamp: string // ISO datetime
  recorded: string // ISO datetime

  // WHERE - Location
  ns: string
  location?: string
  readPoint?: string

  // WHY - Purpose
  verb: string
  disposition?: string
  reason?: string

  // HOW - Method
  method?: 'code' | 'generative' | 'agentic' | 'human'
  branch?: string
  model?: string
  tools?: string[]
  channel?: string
  cascade?: Record<string, unknown>
  transaction?: string
  context?: Record<string, unknown>
}

// ============================================================================
// Format Detection
// ============================================================================

/**
 * Detect the format of an input event or batch of events
 */
export function detectFormat(input: unknown): EventFormat {
  if (input === null || input === undefined) {
    return EventFormat.Unknown
  }

  // Handle arrays - detect based on first element
  if (Array.isArray(input)) {
    if (input.length === 0) {
      return EventFormat.Unknown
    }
    return detectFormat(input[0])
  }

  if (typeof input !== 'object') {
    return EventFormat.Unknown
  }

  const obj = input as Record<string, unknown>

  // Check for EPCIS format
  if (isEPCISEvent(obj)) {
    return EventFormat.EPCIS
  }

  // Check for Evalite trace format
  if (isEvaliteTrace(obj)) {
    return EventFormat.Evalite
  }

  // Check for Internal 5W+H format
  if (isInternalEvent(obj)) {
    return EventFormat.Internal
  }

  return EventFormat.Unknown
}

/**
 * Check if object is an EPCIS event
 */
function isEPCISEvent(obj: Record<string, unknown>): boolean {
  const epcisEventTypes = [
    'ObjectEvent',
    'AggregationEvent',
    'TransactionEvent',
    'TransformationEvent',
    'AssociationEvent',
  ]
  return typeof obj.eventType === 'string' && epcisEventTypes.includes(obj.eventType)
}

/**
 * Check if object is an Evalite trace
 */
function isEvaliteTrace(obj: Record<string, unknown>): boolean {
  return typeof obj.traceId === 'string' && typeof obj.name === 'string'
}

/**
 * Check if object is an internal 5W+H event
 */
function isInternalEvent(obj: Record<string, unknown>): boolean {
  return (
    typeof obj.actor === 'string' &&
    typeof obj.object === 'string' &&
    typeof obj.type === 'string' &&
    typeof obj.verb === 'string' &&
    typeof obj.timestamp === 'string' &&
    typeof obj.ns === 'string'
  )
}

/**
 * Check if object looks like a partial internal 5W+H event
 * (has some internal fields but not all required ones)
 */
function isPartialInternalEvent(obj: Record<string, unknown>): boolean {
  const internalFields = ['actor', 'object', 'type', 'verb', 'timestamp', 'ns']
  // Has at least one internal field
  return internalFields.some((f) => typeof obj[f] === 'string')
}

// ============================================================================
// Normalization
// ============================================================================

/**
 * Normalize any event format to 5W+H events
 * @throws Error if input is invalid or format is unrecognized
 */
export function normalize(input: unknown): Event5WH[] {
  // Validate input
  if (input === null || input === undefined) {
    throw new Error('Invalid input: cannot normalize null or undefined')
  }

  if (typeof input !== 'object') {
    throw new Error('Invalid input: expected object or array')
  }

  // Handle EPCIS document wrapper
  const obj = input as Record<string, unknown>
  if (obj.type === 'EPCISDocument' && Array.isArray(obj.eventList)) {
    return normalizeArray(obj.eventList as unknown[])
  }

  // Handle arrays
  if (Array.isArray(input)) {
    return normalizeArray(input)
  }

  // Handle single event
  return normalizeSingle(input)
}

/**
 * Normalize an array of events
 */
function normalizeArray(events: unknown[]): Event5WH[] {
  if (events.length === 0) {
    return []
  }

  const results: Event5WH[] = []

  for (const event of events) {
    const format = detectFormat(event)

    // Skip invalid events in batch processing
    if (format === EventFormat.Unknown) {
      continue
    }

    try {
      const normalized = normalizeSingle(event)
      results.push(...normalized)
    } catch {
      // Skip invalid events in batch
      continue
    }
  }

  return results
}

/**
 * Normalize a single event based on detected format
 * @throws Error if format is unrecognized or event is invalid
 */
function normalizeSingle(input: unknown): Event5WH[] {
  const format = detectFormat(input)
  const obj = input as Record<string, unknown>

  switch (format) {
    case EventFormat.Internal:
      return [normalizeInternal(obj)]
    case EventFormat.EPCIS:
      return normalizeEPCIS(obj)
    case EventFormat.Evalite:
      return [normalizeEvalite(obj)]
    case EventFormat.Unknown:
    default:
      // Check if it looks like a partial internal event and give a better error message
      if (isPartialInternalEvent(obj)) {
        const requiredFields = ['actor', 'object', 'type', 'verb', 'timestamp', 'ns']
        const missing = requiredFields.filter((f) => typeof obj[f] !== 'string')
        throw new Error(`Missing required fields: ${missing.join(', ')}`)
      }
      throw new Error('Unrecognized event format. Expected Internal (5W+H), EPCIS, or Evalite format.')
  }
}

// ============================================================================
// Internal Format Normalization
// ============================================================================

/**
 * Normalize an internal 5W+H event (mostly passthrough with validation)
 */
function normalizeInternal(obj: Record<string, unknown>): Event5WH {
  // Validate required fields
  const requiredFields = ['actor', 'object', 'type', 'verb', 'timestamp', 'ns']
  const missing = requiredFields.filter((f) => !obj[f])
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`)
  }

  return {
    // WHO
    actor: obj.actor as string,
    source: obj.source as string | undefined,
    destination: obj.destination as string | undefined,

    // WHAT
    object: obj.object as string,
    type: obj.type as string,
    quantity: obj.quantity as number | undefined,

    // WHEN
    timestamp: obj.timestamp as string,
    recorded: (obj.recorded as string) || new Date().toISOString(),

    // WHERE
    ns: obj.ns as string,
    location: obj.location as string | undefined,
    readPoint: obj.readPoint as string | undefined,

    // WHY
    verb: obj.verb as string,
    disposition: obj.disposition as string | undefined,
    reason: obj.reason as string | undefined,

    // HOW
    method: obj.method as Event5WH['method'],
    branch: obj.branch as string | undefined,
    model: obj.model as string | undefined,
    tools: obj.tools as string[] | undefined,
    channel: obj.channel as string | undefined,
    cascade: obj.cascade as Record<string, unknown> | undefined,
    transaction: obj.transaction as string | undefined,
    context: obj.context as Record<string, unknown> | undefined,
  }
}

// ============================================================================
// EPCIS Format Normalization
// ============================================================================

/**
 * Normalize an EPCIS event to 5W+H events
 * May return multiple events if the EPCIS event contains multiple EPCs
 */
function normalizeEPCIS(obj: Record<string, unknown>): Event5WH[] {
  const eventType = obj.eventType as string

  // Validate required fields
  if (!obj.eventTime) {
    throw new Error('Missing required EPCIS field: eventTime')
  }

  switch (eventType) {
    case 'ObjectEvent':
      return normalizeEPCISObjectEvent(obj)
    case 'AggregationEvent':
      return [normalizeEPCISAggregationEvent(obj)]
    case 'TransformationEvent':
      return [normalizeEPCISTransformationEvent(obj)]
    default:
      throw new Error(`Unsupported EPCIS event type: ${eventType}`)
  }
}

/**
 * Extract verb from EPCIS bizStep URN
 * urn:epcglobal:cbv:bizstep:shipping -> shipping
 */
function extractBizStep(bizStep: string | undefined): string {
  if (!bizStep) return 'observed'
  const parts = bizStep.split(':')
  return parts[parts.length - 1] || 'observed'
}

/**
 * Extract disposition from EPCIS disposition URN
 * urn:epcglobal:cbv:disp:in_transit -> in_transit
 */
function extractDisposition(disposition: string | undefined): string | undefined {
  if (!disposition) return undefined
  const parts = disposition.split(':')
  return parts[parts.length - 1]
}

/**
 * Extract source from EPCIS sourceList
 */
function extractSource(sourceList: unknown[] | undefined): string | undefined {
  if (!sourceList || sourceList.length === 0) return undefined
  const first = sourceList[0] as Record<string, unknown>
  return first.source as string | undefined
}

/**
 * Extract destination from EPCIS destinationList
 */
function extractDestination(destinationList: unknown[] | undefined): string | undefined {
  if (!destinationList || destinationList.length === 0) return undefined
  const first = destinationList[0] as Record<string, unknown>
  return first.destination as string | undefined
}

/**
 * Extract transaction from EPCIS bizTransactionList
 */
function extractTransaction(bizTransactionList: unknown[] | undefined): string | undefined {
  if (!bizTransactionList || bizTransactionList.length === 0) return undefined
  const first = bizTransactionList[0] as Record<string, unknown>
  return first.bizTransaction as string | undefined
}

/**
 * Normalize EPCIS ObjectEvent
 * Creates one event per EPC in epcList, or one per quantity in quantityList
 */
function normalizeEPCISObjectEvent(obj: Record<string, unknown>): Event5WH[] {
  const epcList = obj.epcList as string[] | undefined
  const quantityList = obj.quantityList as Array<{ epcClass: string; quantity: number; uom?: string }> | undefined

  const events: Event5WH[] = []
  const baseEvent = buildEPCISBaseEvent(obj)

  // Handle epcList - one event per EPC
  if (epcList && epcList.length > 0) {
    for (const epc of epcList) {
      events.push({
        ...baseEvent,
        object: epc,
      })
    }
  }

  // Handle quantityList - one event per quantity element
  if (quantityList && quantityList.length > 0) {
    for (const item of quantityList) {
      const context: Record<string, unknown> = { ...baseEvent.context }
      if (item.uom) {
        context.uom = item.uom
      }
      events.push({
        ...baseEvent,
        object: item.epcClass,
        quantity: item.quantity,
        context,
      })
    }
  }

  // If neither epcList nor quantityList, throw error
  if (events.length === 0) {
    throw new Error('EPCIS ObjectEvent missing epcList or quantityList')
  }

  return events
}

/**
 * Normalize EPCIS AggregationEvent
 */
function normalizeEPCISAggregationEvent(obj: Record<string, unknown>): Event5WH {
  const baseEvent = buildEPCISBaseEvent(obj)

  // For aggregation, the parent is the main object
  const parentID = obj.parentID as string | undefined
  const childEPCs = obj.childEPCs as string[] | undefined

  return {
    ...baseEvent,
    object: parentID || '',
    context: {
      ...baseEvent.context,
      childEPCs,
    },
  }
}

/**
 * Normalize EPCIS TransformationEvent
 */
function normalizeEPCISTransformationEvent(obj: Record<string, unknown>): Event5WH {
  const baseEvent = buildEPCISBaseEvent(obj)

  const inputEPCList = obj.inputEPCList as string[] | undefined
  const inputQuantityList = obj.inputQuantityList as unknown[] | undefined
  const outputEPCList = obj.outputEPCList as string[] | undefined
  const outputQuantityList = obj.outputQuantityList as unknown[] | undefined

  return {
    ...baseEvent,
    object: inputEPCList?.[0] || outputEPCList?.[0] || 'transformation',
    context: {
      ...baseEvent.context,
      inputEPCList,
      inputQuantityList,
      outputEPCList,
      outputQuantityList,
    },
  }
}

/**
 * Build base event structure from EPCIS fields
 */
function buildEPCISBaseEvent(obj: Record<string, unknown>): Event5WH {
  const eventType = obj.eventType as string
  const eventTime = obj.eventTime as string
  const recordTime = obj.recordTime as string | undefined
  const action = obj.action as string | undefined
  const bizStep = obj.bizStep as string | undefined
  const disposition = obj.disposition as string | undefined
  const readPoint = obj.readPoint as { id: string } | undefined
  const bizLocation = obj.bizLocation as { id: string } | undefined
  const sourceList = obj.sourceList as unknown[] | undefined
  const destinationList = obj.destinationList as unknown[] | undefined
  const bizTransactionList = obj.bizTransactionList as unknown[] | undefined

  // Build context with action
  const context: Record<string, unknown> = {}
  if (action) {
    context.action = action
  }

  return {
    // WHO
    actor: 'system', // EPCIS events typically don't have explicit actor
    source: extractSource(sourceList),
    destination: extractDestination(destinationList),

    // WHAT
    object: '', // Will be filled by specific event type handler
    type: eventType,

    // WHEN
    timestamp: eventTime,
    recorded: recordTime || new Date().toISOString(),

    // WHERE
    ns: 'epcis', // Default namespace for EPCIS events
    location: bizLocation?.id,
    readPoint: readPoint?.id,

    // WHY
    verb: extractBizStep(bizStep),
    disposition: extractDisposition(disposition),

    // HOW
    transaction: extractTransaction(bizTransactionList),
    context: Object.keys(context).length > 0 ? context : undefined,
  }
}

// ============================================================================
// Evalite Format Normalization
// ============================================================================

/**
 * Normalize an Evalite trace to 5W+H event
 */
function normalizeEvalite(obj: Record<string, unknown>): Event5WH {
  const traceId = obj.traceId as string
  const spanId = obj.spanId as string | undefined
  const name = obj.name as string
  const model = obj.model as string | undefined
  const branch = obj.branch as string | undefined
  const tools = obj.tools as string[] | undefined
  const score = obj.score as number | undefined
  const duration = obj.duration as number | undefined
  const tokens = obj.tokens as Record<string, unknown> | undefined
  const input = obj.input as Record<string, unknown> | undefined
  const output = obj.output as Record<string, unknown> | undefined
  const startTime = obj.startTime as string | undefined
  const metadata = obj.metadata as Record<string, unknown> | undefined

  // Determine method based on whether tools were used
  const method: Event5WH['method'] = tools && tools.length > 0 ? 'agentic' : 'generative'

  // Build context with eval-specific data
  const context: Record<string, unknown> = {
    traceId,
  }
  if (spanId) context.spanId = spanId
  if (score !== undefined) context.score = score
  if (duration !== undefined) context.duration = duration
  if (tokens) context.tokens = tokens
  if (input) context.input = input
  if (output) context.output = output

  // Extract namespace from metadata if available
  const ns = (metadata?.namespace as string) || 'evals'

  return {
    // WHO
    actor: 'system',

    // WHAT
    object: name,
    type: 'eval',

    // WHEN
    timestamp: startTime || new Date().toISOString(),
    recorded: new Date().toISOString(),

    // WHERE
    ns,

    // WHY
    verb: 'evaluated',

    // HOW
    method,
    branch,
    model,
    tools,
    context,
  }
}

// ============================================================================
// Ingest Types
// ============================================================================

/**
 * Request body format from ManagedPipeline
 */
export interface IngestRequest {
  events: Array<{
    verb: string
    source: string
    $context: string
    data: unknown
    timestamp: string
    _meta?: {
      ns: string
      organizationId?: string
    }
  }>
  timestamp: string
}

/**
 * Request metadata extracted from CF request
 */
export interface RequestMeta {
  /** Client IP address */
  ip: string | null
  /** Country code */
  country: string | null
  /** City */
  city: string | null
  /** Region/state */
  region: string | null
  /** ASN */
  asn: number | null
  /** Cloudflare colo */
  colo: string | null
  /** Request ID */
  requestId: string
  /** Receipt timestamp */
  receivedAt: string
  /** User agent */
  userAgent: string | null
}

// ============================================================================
// Ingest Handler
// ============================================================================

/**
 * Extract request metadata from Cloudflare request
 */
export function extractRequestMeta(request: Request): RequestMeta {
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf || {}

  return {
    ip: request.headers.get('CF-Connecting-IP'),
    country: (cf.country as string) || null,
    city: (cf.city as string) || null,
    region: (cf.region as string) || null,
    asn: (cf.asn as number) || null,
    colo: (cf.colo as string) || null,
    requestId: request.headers.get('CF-Ray') || crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    userAgent: request.headers.get('User-Agent'),
  }
}

/**
 * Enrich events with request metadata
 */
export function enrichEvents(events: IngestRequest['events'], meta: RequestMeta): IngestRequest['events'] {
  return events.map((event) => ({
    ...event,
    _meta: {
      ...event._meta,
      ns: event._meta?.ns || 'unknown',
      _request: {
        ip: meta.ip,
        country: meta.country,
        city: meta.city,
        region: meta.region,
        asn: meta.asn,
        colo: meta.colo,
        requestId: meta.requestId,
        receivedAt: meta.receivedAt,
        userAgent: meta.userAgent,
      },
    },
  }))
}

/**
 * Validate ingest request
 */
export function validateIngestRequest(body: unknown): { valid: true; data: IngestRequest } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be an object' }
  }

  const obj = body as Record<string, unknown>

  if (!Array.isArray(obj.events)) {
    return { valid: false, error: 'Missing or invalid events array' }
  }

  if (obj.events.length === 0) {
    return { valid: false, error: 'Events array is empty' }
  }

  // Validate each event has required fields
  for (let i = 0; i < obj.events.length; i++) {
    const event = obj.events[i] as Record<string, unknown>
    if (!event.verb || typeof event.verb !== 'string') {
      return { valid: false, error: `Event ${i}: missing or invalid verb` }
    }
    if (!event.timestamp || typeof event.timestamp !== 'string') {
      return { valid: false, error: `Event ${i}: missing or invalid timestamp` }
    }
  }

  return { valid: true, data: obj as unknown as IngestRequest }
}

/**
 * Events ingest handler (Cloudflare Snippet)
 *
 * This runs at workers.do/events before the underlying worker.
 * It enriches events with request metadata and forwards to the worker
 * which has the actual Pipeline binding.
 *
 * Flow:
 * 1. DO calls ManagedPipeline.send() → POST to workers.do/events
 * 2. This snippet intercepts, validates, and enriches with CF metadata
 * 3. Forwards enriched request to underlying worker
 * 4. Worker sends to Cloudflare Pipeline → R2/Iceberg
 */
const eventsIngestHandler = {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // Only handle POST to /events or /ingest paths
    if (request.method !== 'POST' || (!url.pathname.endsWith('/events') && !url.pathname.endsWith('/ingest'))) {
      // Pass through to underlying worker
      return fetch(request)
    }

    // Validate content type
    const contentType = request.headers.get('Content-Type') || ''
    if (!contentType.includes('application/json')) {
      return new Response(JSON.stringify({ error: 'Content-Type must be application/json' }), {
        status: 415,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Parse and validate body
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const validation = validateIngestRequest(body)
    if (!validation.valid) {
      const errorResponse = validation as { valid: false; error: string }
      return new Response(JSON.stringify({ error: errorResponse.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Extract request metadata
    const meta = extractRequestMeta(request)

    // Enrich events with metadata
    const enrichedEvents = enrichEvents(validation.data.events, meta)

    // Get auth headers to forward
    const headers = new Headers()
    headers.set('Content-Type', 'application/json')

    // Forward namespace header
    const namespace = request.headers.get('X-Namespace')
    if (namespace) {
      headers.set('X-Namespace', namespace)
    }

    // Forward organization ID header
    const orgId = request.headers.get('X-Organization-Id')
    if (orgId) {
      headers.set('X-Organization-Id', orgId)
    }

    // Forward auth header
    const auth = request.headers.get('Authorization')
    if (auth) {
      headers.set('Authorization', auth)
    }

    // Add request metadata header
    headers.set('X-Request-Meta', JSON.stringify(meta))

    // Create enriched request for underlying worker
    const enrichedBody: IngestRequest = {
      events: enrichedEvents,
      timestamp: validation.data.timestamp,
    }

    const enrichedRequest = new Request(request.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(enrichedBody),
    })

    // Forward to underlying worker (which has Pipeline binding)
    const response = await fetch(enrichedRequest)

    // Return response from underlying worker
    return response
  },
}

export { eventsIngestHandler }
export default eventsIngestHandler
