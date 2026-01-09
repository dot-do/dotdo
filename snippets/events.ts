/**
 * Events Normalizer
 *
 * Converts various event formats to the unified 5W+H schema.
 * Supports: Internal (5W+H), EPCIS, Evalite trace formats
 *
 * Reference: docs/concepts/events.mdx
 */

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
