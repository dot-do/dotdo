/**
 * BusinessEventStore - Universal 5W+H event capture (EPCIS-extended)
 *
 * Provides universal business event capture extending EPCIS 5W+H paradigm:
 * - What: Object/Entity being tracked (EPC URN, product ID, customer ID)
 * - Where: Location/Context (physical location, service, endpoint)
 * - When: Timestamp with timezone
 * - Why: Business step/reason (shipping, receiving, payment)
 * - Who: Parties involved (organization, user, system)
 * - How: Method/disposition (in_transit, completed, manual)
 *
 * Event Types (EPCIS 2.0 compatible):
 * - ObjectEvent: Single object actions (ADD, OBSERVE, DELETE)
 * - AggregationEvent: Object grouping/ungrouping
 * - TransactionEvent: Business transaction linking
 * - TransformationEvent: Object transformation (input->output)
 *
 * @module db/primitives/business-event-store
 */

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Event action types (EPCIS compliant)
 */
export type EventAction = 'ADD' | 'OBSERVE' | 'DELETE'

/**
 * Business step - why the event occurred
 * Can be a CBV URN or custom string
 */
export type BusinessStep = string

/**
 * Disposition - current state of objects after event
 * Can be a CBV URN or custom string
 */
export type Disposition = string

/**
 * Actor types for digital events
 */
export type ActorType = 'human' | 'agent' | 'system' | 'webhook'

/**
 * Channel types for digital events
 */
export type ChannelType = 'web' | 'mobile' | 'api' | 'email' | 'automation' | string

/**
 * Event types
 */
export type EventType = 'ObjectEvent' | 'AggregationEvent' | 'TransactionEvent' | 'TransformationEvent'

/**
 * Event link types for event relationships
 */
export type EventLinkType = 'caused_by' | 'parent_child' | 'related'

/**
 * List of EPCs (Electronic Product Codes)
 */
export type EPCList = string[]

/**
 * Quantity element for class-level identifiers
 */
export interface QuantityElement {
  epcClass: string
  quantity: number
  uom?: string // Unit of measure
}

/**
 * Business transaction reference
 */
export interface BusinessTransaction {
  type: string // e.g., 'purchase_order', 'invoice', CBV URN
  value: string
}

/**
 * Source/Destination element
 */
export interface SourceDest {
  type: string // e.g., 'possessing_party', 'location', 'owning_party'
  value: string
}

/**
 * Party reference
 */
export type Party = string // GLN, PGLN, or custom identifier

/**
 * Location reference
 */
export type Location = string // GLN, SGLN, or custom identifier

/**
 * Event link between events
 */
export interface EventLink {
  sourceId: string
  targetId: string
  type: EventLinkType
  createdAt: Date
}

/**
 * Base event options shared by all event types
 */
export interface BaseEventOptions {
  // When
  when: Date
  whenTimezoneOffset?: string

  // Where
  where?: Location
  bizLocation?: Location
  sourceList?: SourceDest[]
  destinationList?: SourceDest[]

  // Why
  why?: BusinessStep

  // Who
  who?: Party
  actorType?: ActorType
  confidence?: number // 0-1 for AI/agent actors

  // How
  how?: Disposition
  channel?: ChannelType
  sessionId?: string
  deviceId?: string
  context?: Record<string, unknown>

  // Linking
  causedBy?: string
  parentEventId?: string
  correlationId?: string

  // Extensions
  extensions?: Record<string, unknown>
}

/**
 * Object event options
 */
export interface ObjectEventOptions extends BaseEventOptions {
  what: EPCList
  quantityList?: QuantityElement[]
  action: EventAction
}

/**
 * Aggregation event options
 */
export interface AggregationEventOptions extends BaseEventOptions {
  parentID: string
  childEPCs: EPCList
  childQuantityList?: QuantityElement[]
  action: EventAction
}

/**
 * Transaction event options
 */
export interface TransactionEventOptions extends BaseEventOptions {
  parentID?: string
  what: EPCList
  quantityList?: QuantityElement[]
  bizTransactionList: BusinessTransaction[]
  action: EventAction
}

/**
 * Transformation event options
 */
export interface TransformationEventOptions extends BaseEventOptions {
  transformationID?: string
  inputEPCList: EPCList
  inputQuantityList?: QuantityElement[]
  outputEPCList: EPCList
  outputQuantityList?: QuantityElement[]
}

/**
 * Base business event interface
 */
export interface BusinessEvent {
  id: string
  type: EventType
  recordTime: Date

  // 5W+H
  what: EPCList
  quantityList?: QuantityElement[]
  when: Date
  whenTimezoneOffset?: string
  where?: Location
  bizLocation?: Location
  sourceList?: SourceDest[]
  destinationList?: SourceDest[]
  why?: BusinessStep
  who?: Party
  actorType?: ActorType
  confidence?: number
  how?: Disposition
  channel?: ChannelType
  sessionId?: string
  deviceId?: string
  context?: Record<string, unknown>

  // Event-specific
  action?: EventAction

  // Linking
  causedBy?: string
  parentEventId?: string
  correlationId?: string

  // Extensions
  extensions?: Record<string, unknown>
}

/**
 * Event query parameters
 */
export interface EventQuery {
  // What
  what?: string | string[]

  // When
  when?: {
    gte?: Date
    lte?: Date
  }

  // Where
  where?: Location | Location[]

  // Why
  why?: BusinessStep | BusinessStep[]

  // Who
  who?: Party | Party[]

  // How
  how?: Disposition | Disposition[]

  // Type
  type?: EventType | EventType[]

  // Action
  action?: EventAction | EventAction[]

  // Extensions
  extensions?: Record<string, unknown>
}

/**
 * Query options for pagination and ordering
 */
export interface QueryOptions {
  limit?: number
  offset?: number
  orderBy?: 'when' | 'recordTime'
  orderDirection?: 'asc' | 'desc'
}

/**
 * Object state derived from events
 */
export interface ObjectState {
  location?: Location
  disposition?: Disposition
  parentContainer?: string
  lastEventTime?: Date
}

/**
 * Object history with all events and current state
 */
export interface ObjectHistory {
  objectId: string
  events: BusinessEvent[]
  currentState?: ObjectState
}

/**
 * Causation chain from root to a specific event
 */
export interface CausationChain {
  root: BusinessEvent
  events: BusinessEvent[]
  depth: number
}

// =============================================================================
// Event Classes
// =============================================================================

/**
 * Generate a unique event ID
 */
function generateEventId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `evt_${timestamp}_${random}`
}

/**
 * Validate event action
 */
function validateAction(action: string): asserts action is EventAction {
  if (!['ADD', 'OBSERVE', 'DELETE'].includes(action)) {
    throw new Error(`Invalid action: ${action}. Must be ADD, OBSERVE, or DELETE`)
  }
}

/**
 * ObjectEvent - Single object actions
 */
export class ObjectEvent implements BusinessEvent {
  readonly type: EventType = 'ObjectEvent'
  readonly id: string
  readonly recordTime: Date

  // 5W+H
  readonly what: EPCList
  readonly quantityList?: QuantityElement[]
  readonly when: Date
  readonly whenTimezoneOffset?: string
  readonly where?: Location
  readonly bizLocation?: Location
  readonly sourceList?: SourceDest[]
  readonly destinationList?: SourceDest[]
  readonly why?: BusinessStep
  readonly who?: Party
  readonly actorType?: ActorType
  readonly confidence?: number
  readonly how?: Disposition
  readonly channel?: ChannelType
  readonly sessionId?: string
  readonly deviceId?: string
  readonly context?: Record<string, unknown>

  // Event-specific
  readonly action: EventAction

  // Linking
  readonly causedBy?: string
  readonly parentEventId?: string
  readonly correlationId?: string

  // Extensions
  readonly extensions?: Record<string, unknown>

  constructor(options: ObjectEventOptions) {
    if (!options.when) {
      throw new Error('ObjectEvent requires "when" field')
    }
    if (!options.what && !options.quantityList?.length) {
      throw new Error('ObjectEvent requires "what" or "quantityList"')
    }
    validateAction(options.action)

    this.id = generateEventId()
    this.recordTime = new Date()

    this.what = options.what || []
    this.quantityList = options.quantityList
    this.when = options.when
    this.whenTimezoneOffset = options.whenTimezoneOffset
    this.where = options.where
    this.bizLocation = options.bizLocation
    this.sourceList = options.sourceList
    this.destinationList = options.destinationList
    this.why = options.why
    this.who = options.who
    this.actorType = options.actorType
    this.confidence = options.confidence
    this.how = options.how
    this.channel = options.channel
    this.sessionId = options.sessionId
    this.deviceId = options.deviceId
    this.context = options.context
    this.action = options.action
    this.causedBy = options.causedBy
    this.parentEventId = options.parentEventId
    this.correlationId = options.correlationId
    this.extensions = options.extensions
  }
}

/**
 * AggregationEvent - Object grouping/ungrouping
 */
export class AggregationEvent implements BusinessEvent {
  readonly type: EventType = 'AggregationEvent'
  readonly id: string
  readonly recordTime: Date

  // 5W+H (what is derived from parent + children)
  readonly what: EPCList
  readonly when: Date
  readonly whenTimezoneOffset?: string
  readonly where?: Location
  readonly bizLocation?: Location
  readonly sourceList?: SourceDest[]
  readonly destinationList?: SourceDest[]
  readonly why?: BusinessStep
  readonly who?: Party
  readonly actorType?: ActorType
  readonly confidence?: number
  readonly how?: Disposition
  readonly channel?: ChannelType
  readonly sessionId?: string
  readonly deviceId?: string
  readonly context?: Record<string, unknown>

  // Event-specific
  readonly action: EventAction
  readonly parentID: string
  readonly childEPCs: EPCList
  readonly childQuantityList?: QuantityElement[]

  // Linking
  readonly causedBy?: string
  readonly parentEventId?: string
  readonly correlationId?: string

  // Extensions
  readonly extensions?: Record<string, unknown>

  constructor(options: AggregationEventOptions) {
    if (!options.when) {
      throw new Error('AggregationEvent requires "when" field')
    }
    if (!options.parentID) {
      throw new Error('AggregationEvent requires "parentID"')
    }
    validateAction(options.action)

    this.id = generateEventId()
    this.recordTime = new Date()

    this.parentID = options.parentID
    this.childEPCs = options.childEPCs || []
    this.childQuantityList = options.childQuantityList
    // Derive 'what' from parent and children
    this.what = [options.parentID, ...this.childEPCs]
    this.when = options.when
    this.whenTimezoneOffset = options.whenTimezoneOffset
    this.where = options.where
    this.bizLocation = options.bizLocation
    this.sourceList = options.sourceList
    this.destinationList = options.destinationList
    this.why = options.why
    this.who = options.who
    this.actorType = options.actorType
    this.confidence = options.confidence
    this.how = options.how
    this.channel = options.channel
    this.sessionId = options.sessionId
    this.deviceId = options.deviceId
    this.context = options.context
    this.action = options.action
    this.causedBy = options.causedBy
    this.parentEventId = options.parentEventId
    this.correlationId = options.correlationId
    this.extensions = options.extensions
  }
}

/**
 * TransactionEvent - Business transaction linking
 */
export class TransactionEvent implements BusinessEvent {
  readonly type: EventType = 'TransactionEvent'
  readonly id: string
  readonly recordTime: Date

  // 5W+H
  readonly what: EPCList
  readonly quantityList?: QuantityElement[]
  readonly when: Date
  readonly whenTimezoneOffset?: string
  readonly where?: Location
  readonly bizLocation?: Location
  readonly sourceList?: SourceDest[]
  readonly destinationList?: SourceDest[]
  readonly why?: BusinessStep
  readonly who?: Party
  readonly actorType?: ActorType
  readonly confidence?: number
  readonly how?: Disposition
  readonly channel?: ChannelType
  readonly sessionId?: string
  readonly deviceId?: string
  readonly context?: Record<string, unknown>

  // Event-specific
  readonly action: EventAction
  readonly parentID?: string
  readonly bizTransactionList: BusinessTransaction[]

  // Linking
  readonly causedBy?: string
  readonly parentEventId?: string
  readonly correlationId?: string

  // Extensions
  readonly extensions?: Record<string, unknown>

  constructor(options: TransactionEventOptions) {
    if (!options.when) {
      throw new Error('TransactionEvent requires "when" field')
    }
    if (!options.bizTransactionList?.length) {
      throw new Error('TransactionEvent requires "bizTransactionList"')
    }
    validateAction(options.action)

    this.id = generateEventId()
    this.recordTime = new Date()

    this.what = options.what || []
    this.quantityList = options.quantityList
    this.when = options.when
    this.whenTimezoneOffset = options.whenTimezoneOffset
    this.where = options.where
    this.bizLocation = options.bizLocation
    this.sourceList = options.sourceList
    this.destinationList = options.destinationList
    this.why = options.why
    this.who = options.who
    this.actorType = options.actorType
    this.confidence = options.confidence
    this.how = options.how
    this.channel = options.channel
    this.sessionId = options.sessionId
    this.deviceId = options.deviceId
    this.context = options.context
    this.action = options.action
    this.parentID = options.parentID
    this.bizTransactionList = options.bizTransactionList
    this.causedBy = options.causedBy
    this.parentEventId = options.parentEventId
    this.correlationId = options.correlationId
    this.extensions = options.extensions
  }
}

/**
 * TransformationEvent - Object transformation (input->output)
 */
export class TransformationEvent implements BusinessEvent {
  readonly type: EventType = 'TransformationEvent'
  readonly id: string
  readonly recordTime: Date

  // 5W+H (what is derived from inputs and outputs)
  readonly what: EPCList
  readonly when: Date
  readonly whenTimezoneOffset?: string
  readonly where?: Location
  readonly bizLocation?: Location
  readonly sourceList?: SourceDest[]
  readonly destinationList?: SourceDest[]
  readonly why?: BusinessStep
  readonly who?: Party
  readonly actorType?: ActorType
  readonly confidence?: number
  readonly how?: Disposition
  readonly channel?: ChannelType
  readonly sessionId?: string
  readonly deviceId?: string
  readonly context?: Record<string, unknown>

  // Event-specific (no action for TransformationEvent)
  readonly transformationID?: string
  readonly inputEPCList: EPCList
  readonly inputQuantityList?: QuantityElement[]
  readonly outputEPCList: EPCList
  readonly outputQuantityList?: QuantityElement[]

  // Linking
  readonly causedBy?: string
  readonly parentEventId?: string
  readonly correlationId?: string

  // Extensions
  readonly extensions?: Record<string, unknown>

  constructor(options: TransformationEventOptions) {
    if (!options.when) {
      throw new Error('TransformationEvent requires "when" field')
    }

    this.id = generateEventId()
    this.recordTime = new Date()

    this.transformationID = options.transformationID
    this.inputEPCList = options.inputEPCList || []
    this.inputQuantityList = options.inputQuantityList
    this.outputEPCList = options.outputEPCList || []
    this.outputQuantityList = options.outputQuantityList
    // Derive 'what' from inputs and outputs
    this.what = [...this.inputEPCList, ...this.outputEPCList]
    this.when = options.when
    this.whenTimezoneOffset = options.whenTimezoneOffset
    this.where = options.where
    this.bizLocation = options.bizLocation
    this.sourceList = options.sourceList
    this.destinationList = options.destinationList
    this.why = options.why
    this.who = options.who
    this.actorType = options.actorType
    this.confidence = options.confidence
    this.how = options.how
    this.channel = options.channel
    this.sessionId = options.sessionId
    this.deviceId = options.deviceId
    this.context = options.context
    this.causedBy = options.causedBy
    this.parentEventId = options.parentEventId
    this.correlationId = options.correlationId
    this.extensions = options.extensions
  }
}

// =============================================================================
// BusinessEventStore Interface and Implementation
// =============================================================================

/**
 * BusinessEventStore interface
 */
export interface BusinessEventStore {
  // Capture
  capture(event: BusinessEvent): Promise<string>
  captureBatch(events: BusinessEvent[]): Promise<string[]>

  // Retrieval
  get(id: string): Promise<BusinessEvent | null>

  // Query
  query(query: EventQuery, options?: QueryOptions): Promise<BusinessEvent[]>

  // Object Tracking
  trackObject(objectId: string): Promise<ObjectHistory>

  // Event Linking
  linkEvents(sourceId: string, targetId: string, type: EventLinkType): Promise<void>
  getEventLinks(eventId: string): Promise<EventLink[]>
  getCausationChain(eventId: string): Promise<CausationChain>
  getEventDescendants(eventId: string): Promise<BusinessEvent[]>
  getChildEvents(eventId: string): Promise<BusinessEvent[]>
  getParentEvent(eventId: string): Promise<BusinessEvent | null>
  getCorrelatedEvents(correlationId: string): Promise<BusinessEvent[]>
}

/**
 * Match pattern with wildcard support
 */
function matchPattern(value: string, pattern: string): boolean {
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2)
    return value.startsWith(prefix)
  }
  return value === pattern
}

/**
 * In-memory implementation of BusinessEventStore
 */
class InMemoryBusinessEventStore implements BusinessEventStore {
  private events: Map<string, BusinessEvent> = new Map()
  private links: EventLink[] = []

  // Indexes for efficient querying
  private byObject: Map<string, Set<string>> = new Map() // objectId -> eventIds
  private byTime: { eventId: string; when: number }[] = [] // sorted by when
  private byType: Map<EventType, Set<string>> = new Map()
  private byWhy: Map<string, Set<string>> = new Map()
  private byWhere: Map<string, Set<string>> = new Map()
  private byCausedBy: Map<string, Set<string>> = new Map() // parentEventId -> childEventIds
  private byParentEvent: Map<string, Set<string>> = new Map()
  private byCorrelation: Map<string, Set<string>> = new Map()

  async capture(event: BusinessEvent): Promise<string> {
    // Store the event
    this.events.set(event.id, event)

    // Index by objects (what)
    for (const objectId of event.what) {
      let eventIds = this.byObject.get(objectId)
      if (!eventIds) {
        eventIds = new Set()
        this.byObject.set(objectId, eventIds)
      }
      eventIds.add(event.id)
    }

    // Also index by quantityList if present
    if (event.quantityList) {
      for (const qty of event.quantityList) {
        let eventIds = this.byObject.get(qty.epcClass)
        if (!eventIds) {
          eventIds = new Set()
          this.byObject.set(qty.epcClass, eventIds)
        }
        eventIds.add(event.id)
      }
    }

    // Index by time (insert sorted)
    const timeEntry = { eventId: event.id, when: event.when.getTime() }
    const insertIdx = this.byTime.findIndex((e) => e.when > timeEntry.when)
    if (insertIdx === -1) {
      this.byTime.push(timeEntry)
    } else {
      this.byTime.splice(insertIdx, 0, timeEntry)
    }

    // Index by type
    let typeEvents = this.byType.get(event.type)
    if (!typeEvents) {
      typeEvents = new Set()
      this.byType.set(event.type, typeEvents)
    }
    typeEvents.add(event.id)

    // Index by why
    if (event.why) {
      let whyEvents = this.byWhy.get(event.why)
      if (!whyEvents) {
        whyEvents = new Set()
        this.byWhy.set(event.why, whyEvents)
      }
      whyEvents.add(event.id)
    }

    // Index by where
    if (event.where) {
      let whereEvents = this.byWhere.get(event.where)
      if (!whereEvents) {
        whereEvents = new Set()
        this.byWhere.set(event.where, whereEvents)
      }
      whereEvents.add(event.id)
    }

    // Index by causedBy
    if (event.causedBy) {
      let causedByEvents = this.byCausedBy.get(event.causedBy)
      if (!causedByEvents) {
        causedByEvents = new Set()
        this.byCausedBy.set(event.causedBy, causedByEvents)
      }
      causedByEvents.add(event.id)
    }

    // Index by parentEventId
    if (event.parentEventId) {
      let parentEvents = this.byParentEvent.get(event.parentEventId)
      if (!parentEvents) {
        parentEvents = new Set()
        this.byParentEvent.set(event.parentEventId, parentEvents)
      }
      parentEvents.add(event.id)
    }

    // Index by correlationId
    if (event.correlationId) {
      let correlatedEvents = this.byCorrelation.get(event.correlationId)
      if (!correlatedEvents) {
        correlatedEvents = new Set()
        this.byCorrelation.set(event.correlationId, correlatedEvents)
      }
      correlatedEvents.add(event.id)
    }

    return event.id
  }

  async captureBatch(events: BusinessEvent[]): Promise<string[]> {
    const ids: string[] = []
    for (const event of events) {
      const id = await this.capture(event)
      ids.push(id)
    }
    return ids
  }

  async get(id: string): Promise<BusinessEvent | null> {
    return this.events.get(id) ?? null
  }

  async query(query: EventQuery, options?: QueryOptions): Promise<BusinessEvent[]> {
    let candidateIds: Set<string> | null = null

    // Filter by what (object IDs)
    if (query.what) {
      const whatPatterns = Array.isArray(query.what) ? query.what : [query.what]
      const matchingIds = new Set<string>()

      for (const pattern of whatPatterns) {
        // Check if it's a wildcard pattern
        if (pattern.endsWith('.*')) {
          // Need to scan all objects
          for (const [objectId, eventIds] of this.byObject) {
            if (matchPattern(objectId, pattern)) {
              for (const id of eventIds) {
                matchingIds.add(id)
              }
            }
          }
        } else {
          const eventIds = this.byObject.get(pattern)
          if (eventIds) {
            for (const id of eventIds) {
              matchingIds.add(id)
            }
          }
        }
      }

      candidateIds = matchingIds
    }

    // Filter by type
    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type]
      const typeIds = new Set<string>()
      for (const t of types) {
        const ids = this.byType.get(t)
        if (ids) {
          for (const id of ids) {
            typeIds.add(id)
          }
        }
      }
      candidateIds = candidateIds
        ? new Set([...candidateIds].filter((id) => typeIds.has(id)))
        : typeIds
    }

    // Filter by why
    if (query.why) {
      const whys = Array.isArray(query.why) ? query.why : [query.why]
      const whyIds = new Set<string>()
      for (const w of whys) {
        const ids = this.byWhy.get(w)
        if (ids) {
          for (const id of ids) {
            whyIds.add(id)
          }
        }
      }
      candidateIds = candidateIds
        ? new Set([...candidateIds].filter((id) => whyIds.has(id)))
        : whyIds
    }

    // Filter by where
    if (query.where) {
      const wheres = Array.isArray(query.where) ? query.where : [query.where]
      const whereIds = new Set<string>()
      for (const w of wheres) {
        const ids = this.byWhere.get(w)
        if (ids) {
          for (const id of ids) {
            whereIds.add(id)
          }
        }
      }
      candidateIds = candidateIds
        ? new Set([...candidateIds].filter((id) => whereIds.has(id)))
        : whereIds
    }

    // Get all events if no filters applied yet
    if (candidateIds === null) {
      candidateIds = new Set(this.events.keys())
    }

    // Convert to array and filter by remaining criteria
    let results: BusinessEvent[] = []
    for (const id of candidateIds) {
      const event = this.events.get(id)
      if (event) {
        results.push(event)
      }
    }

    // Filter by time range
    if (query.when) {
      results = results.filter((event) => {
        const eventTime = event.when.getTime()
        if (query.when!.gte && eventTime < query.when!.gte.getTime()) {
          return false
        }
        if (query.when!.lte && eventTime > query.when!.lte.getTime()) {
          return false
        }
        return true
      })
    }

    // Filter by extensions
    if (query.extensions) {
      results = results.filter((event) => {
        if (!event.extensions) return false
        for (const [key, value] of Object.entries(query.extensions!)) {
          if (event.extensions[key] !== value) {
            return false
          }
        }
        return true
      })
    }

    // Sort by time (descending by default)
    const orderDirection = options?.orderDirection ?? 'desc'
    results.sort((a, b) => {
      const timeA = a.when.getTime()
      const timeB = b.when.getTime()
      return orderDirection === 'desc' ? timeB - timeA : timeA - timeB
    })

    // Apply pagination
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? results.length
    results = results.slice(offset, offset + limit)

    return results
  }

  async trackObject(objectId: string): Promise<ObjectHistory> {
    const eventIds = this.byObject.get(objectId)

    if (!eventIds || eventIds.size === 0) {
      return {
        objectId,
        events: [],
        currentState: undefined,
      }
    }

    // Get all events for this object
    const events: BusinessEvent[] = []
    for (const id of eventIds) {
      const event = this.events.get(id)
      if (event) {
        events.push(event)
      }
    }

    // Sort by time ascending
    events.sort((a, b) => a.when.getTime() - b.when.getTime())

    // Derive current state from events
    let currentState: ObjectState | undefined
    if (events.length > 0) {
      currentState = {}

      for (const event of events) {
        if (event.where) {
          currentState.location = event.where
        }
        if (event.how) {
          currentState.disposition = event.how
        }
        currentState.lastEventTime = event.when

        // Check for aggregation events
        if (event.type === 'AggregationEvent') {
          const aggEvent = event as AggregationEvent
          if (aggEvent.action === 'ADD' && aggEvent.childEPCs.includes(objectId)) {
            currentState.parentContainer = aggEvent.parentID
          } else if (aggEvent.action === 'DELETE' && aggEvent.childEPCs.includes(objectId)) {
            currentState.parentContainer = undefined
          }
        }
      }
    }

    return {
      objectId,
      events,
      currentState,
    }
  }

  async linkEvents(sourceId: string, targetId: string, type: EventLinkType): Promise<void> {
    const source = this.events.get(sourceId)
    const target = this.events.get(targetId)

    if (!source) {
      throw new Error(`Source event not found: ${sourceId}`)
    }
    if (!target) {
      throw new Error(`Target event not found: ${targetId}`)
    }

    // Create bidirectional links for 'related' type
    this.links.push({
      sourceId,
      targetId,
      type,
      createdAt: new Date(),
    })

    if (type === 'related') {
      this.links.push({
        sourceId: targetId,
        targetId: sourceId,
        type,
        createdAt: new Date(),
      })
    }
  }

  async getEventLinks(eventId: string): Promise<EventLink[]> {
    return this.links.filter((l) => l.sourceId === eventId)
  }

  async getCausationChain(eventId: string): Promise<CausationChain> {
    const events: BusinessEvent[] = []
    let currentEvent = this.events.get(eventId)

    // Walk up the causation chain
    while (currentEvent) {
      events.unshift(currentEvent)
      if (currentEvent.causedBy) {
        currentEvent = this.events.get(currentEvent.causedBy)
      } else {
        break
      }
    }

    if (events.length === 0) {
      throw new Error(`Event not found: ${eventId}`)
    }

    return {
      root: events[0]!,
      events,
      depth: events.length,
    }
  }

  async getEventDescendants(eventId: string): Promise<BusinessEvent[]> {
    const descendants: BusinessEvent[] = []
    const childIds = this.byCausedBy.get(eventId)

    if (childIds) {
      for (const id of childIds) {
        const event = this.events.get(id)
        if (event) {
          descendants.push(event)
          // Recursively get descendants
          const subDescendants = await this.getEventDescendants(id)
          descendants.push(...subDescendants)
        }
      }
    }

    return descendants
  }

  async getChildEvents(eventId: string): Promise<BusinessEvent[]> {
    const childIds = this.byParentEvent.get(eventId)
    if (!childIds) return []

    const children: BusinessEvent[] = []
    for (const id of childIds) {
      const event = this.events.get(id)
      if (event) {
        children.push(event)
      }
    }

    return children
  }

  async getParentEvent(eventId: string): Promise<BusinessEvent | null> {
    const event = this.events.get(eventId)
    if (!event || !event.parentEventId) {
      return null
    }
    return this.events.get(event.parentEventId) ?? null
  }

  async getCorrelatedEvents(correlationId: string): Promise<BusinessEvent[]> {
    const eventIds = this.byCorrelation.get(correlationId)
    if (!eventIds) return []

    const events: BusinessEvent[] = []
    for (const id of eventIds) {
      const event = this.events.get(id)
      if (event) {
        events.push(event)
      }
    }

    // Sort by time
    events.sort((a, b) => a.when.getTime() - b.when.getTime())

    return events
  }
}

/**
 * Factory function to create a BusinessEventStore instance
 */
export function createBusinessEventStore(): BusinessEventStore {
  return new InMemoryBusinessEventStore()
}

// Re-export EventSchema types and functions
export {
  // Schema types
  type FiveWHSchema,
  type WhatSchema,
  type WhenSchema,
  type WhereSchema,
  type WhySchema,
  type WhoSchema,
  type HowSchema,
  type DimensionValidationResult,
  type EventValidationResult,
  type CustomDimensionSchema,
  type SchemaVersion,
  type TypeMismatch,

  // Validation functions - What
  validateEPC,
  validateWhatSchema,

  // Validation functions - When
  validateTimestampPrecision,
  validateTimezoneOffset,
  validateEventTiming,

  // Validation functions - Where
  validateLocation,
  validateSourceDest,
  validateLocationSemantics,

  // Validation functions - Why
  validateBusinessStep,
  validateAgainstAllowedSteps,
  categorizeBusinessStep,

  // Validation functions - Who
  validateParty,
  validateActorTypeConsistency,
  validateConfidence,
  validateActorType,

  // Validation functions - How
  validateDisposition,
  validateChannel,
  validateSessionId,
  validateDeviceId,
  validateContext,

  // Schema introspection
  getWhatSchema,
  getWhenSchema,
  getWhereSchema,
  getWhySchema,
  getWhoSchema,
  getHowSchema,
  getFiveWHSchema,

  // Complete validation
  validateEventSchema,
  validateEventTypeSchema,

  // Extensibility
  registerCustomDimension,
  getCustomDimension,
  validateExtensions,
  getSchemaVersion,

  // Type safety
  detectTypeMismatches,
  coerceToSchema,
  enforceTypes,
} from './event-schema'

// Re-export EventCompression types and functions
export {
  // Types
  type HashAlgorithm,
  type CompressionLevel,
  type DeduplicationStrategy,
  type BatchingStrategy,
  type CompressionPolicy,
  type EventSignature,
  type EventBatch,
  type BatchMetadata,
  type CompressedEvent,
  type CompressionDictionary,
  type CompressionStats,
  type DeduplicationResult,
  type BatchingResult,

  // Constants
  DEFAULT_COMPRESSION_POLICY,

  // Classes
  EventDeduplicator,
  EventBatcher,
  EventCompressor,
  EventCompressionPipeline,

  // Factory functions
  createEventDeduplicator,
  createEventBatcher,
  createEventCompressor,
  createCompressionPipeline,
} from './event-compression'

// Re-export ProcessMining types and functions
export {
  // Types
  type ProcessMiningFieldMapping,
  type ActivityInstance,
  type ProcessTrace,
  type ActivityTransition,
  type ProcessModel,
  type ProcessVariant,
  type ConformanceDeviation,
  type ConformanceResult,
  type ExpectedProcessModel,
  type Bottleneck,
  type ProcessPerformanceMetrics,
  type ActivityPerformance,
  type TransitionPerformance,
  type ProcessMiningOptions,

  // Classes
  ProcessMiningEngine,

  // Factory functions
  createProcessMiningEngine,
} from './process-mining'
