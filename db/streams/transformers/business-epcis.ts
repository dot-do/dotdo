/**
 * Business EPCIS Transformer
 *
 * Transforms GS1 EPCIS (Electronic Product Code Information Services) events
 * to the unified event schema. EPCIS is a global standard for supply chain
 * visibility and traceability.
 *
 * EPCIS event types:
 * - ObjectEvent: Tracks what happened to objects (products/assets)
 * - AggregationEvent: Tracks packing/unpacking of objects
 * - TransactionEvent: Links objects to business transactions
 * - TransformationEvent: Tracks manufacturing/processing
 * - AssociationEvent: Tracks relationships between objects (EPCIS 2.0)
 *
 * Actions:
 * - ADD: Objects were added to a container/location
 * - OBSERVE: Objects were observed at a location
 * - DELETE: Objects were removed from a container/location
 *
 * @module db/streams/transformers/business-epcis
 * @see https://www.gs1.org/standards/epcis
 */

import { createUnifiedEvent, type UnifiedEvent } from '../../../types/unified-event'

// ============================================================================
// EPCIS Type Definitions
// ============================================================================

/**
 * EPCIS event types as defined in the GS1 EPCIS standard.
 */
export type EPCISEventType =
  | 'ObjectEvent'
  | 'AggregationEvent'
  | 'TransactionEvent'
  | 'TransformationEvent'
  | 'AssociationEvent'

/**
 * EPCIS action types indicating what happened to the objects.
 */
export type EPCISAction = 'ADD' | 'OBSERVE' | 'DELETE'

/**
 * EPCIS business transaction structure.
 * Links events to business documents like POs, invoices, etc.
 */
export interface EPCISBusinessTransaction {
  /** Business transaction type (e.g., 'urn:epcglobal:cbv:btt:po' for purchase order) */
  type: string
  /** Business transaction identifier */
  bizTransaction: string
}

/**
 * EPCIS source/destination structure.
 * Used in TransactionEvent to track ownership transfer.
 */
export interface EPCISSourceDest {
  /** Source/destination type (e.g., 'urn:epcglobal:cbv:sdt:owning_party') */
  type: string
  /** Source/destination identifier */
  source?: string
  destination?: string
}

/**
 * EPCIS quantity element for class-level visibility.
 * Used when individual EPCs are not available.
 */
export interface EPCISQuantityElement {
  /** EPC class (product type identifier) */
  epcClass: string
  /** Quantity of items */
  quantity: number
  /** Unit of measure (optional) */
  uom?: string
}

/**
 * EPCIS event structure following GS1 EPCIS 2.0 JSON/JSON-LD format.
 */
export interface EPCISEvent {
  /** Event type classification */
  eventType: EPCISEventType
  /** Event timestamp in ISO 8601 format */
  eventTime: string
  /** Timezone offset of eventTime */
  eventTimeZoneOffset?: string
  /** Optional event ID */
  eventID?: string
  /** Record time (when event was recorded) */
  recordTime?: string

  // Object identification
  /** List of EPCs (Electronic Product Codes) */
  epcList?: string[]
  /** List of parent EPCs (for AggregationEvent) */
  parentID?: string
  /** List of child EPCs (for AggregationEvent) */
  childEPCs?: string[]
  /** Quantity elements for class-level visibility */
  quantityList?: EPCISQuantityElement[]
  /** Child quantity elements */
  childQuantityList?: EPCISQuantityElement[]

  // Input/Output for TransformationEvent
  /** Input EPCs for transformation */
  inputEPCList?: string[]
  /** Output EPCs from transformation */
  outputEPCList?: string[]
  /** Input quantities for transformation */
  inputQuantityList?: EPCISQuantityElement[]
  /** Output quantities from transformation */
  outputQuantityList?: EPCISQuantityElement[]

  // Action and business context
  /** Action type (ADD, OBSERVE, DELETE) */
  action?: EPCISAction
  /** Business step vocabulary (e.g., 'shipping', 'receiving') */
  bizStep?: string
  /** Disposition vocabulary (e.g., 'in_transit', 'in_progress') */
  disposition?: string
  /** Read point location where event was captured */
  readPoint?: { id: string }
  /** Business location where event occurred */
  bizLocation?: { id: string }

  // Business transactions
  /** List of business transactions */
  bizTransactionList?: EPCISBusinessTransaction[]

  // Source/Destination (for TransactionEvent)
  /** Source list */
  sourceList?: EPCISSourceDest[]
  /** Destination list */
  destinationList?: EPCISSourceDest[]

  // Extended attributes
  /** Sensor element list (for IoT data) */
  sensorElementList?: unknown[]
  /** Persistent disposition (EPCIS 2.0) */
  persistentDisposition?: {
    set?: string[]
    unset?: string[]
  }
  /** Custom extensions */
  extensions?: Record<string, unknown>
}

/**
 * Context for EPCIS transformation.
 */
export interface EPCISTransformContext {
  /** Namespace for the event */
  ns?: string
  /** Actor/user who triggered the event */
  actorId?: string
  /** Correlation ID for linking related events */
  correlationId?: string
}

// ============================================================================
// Business Step Vocabulary Mappings
// ============================================================================

/**
 * Common CBV (Core Business Vocabulary) business steps.
 * Maps URN format to human-readable names.
 */
export const BUSINESS_STEPS: Record<string, string> = {
  'urn:epcglobal:cbv:bizstep:accepting': 'accepting',
  'urn:epcglobal:cbv:bizstep:arriving': 'arriving',
  'urn:epcglobal:cbv:bizstep:assembling': 'assembling',
  'urn:epcglobal:cbv:bizstep:collecting': 'collecting',
  'urn:epcglobal:cbv:bizstep:commissioning': 'commissioning',
  'urn:epcglobal:cbv:bizstep:consigning': 'consigning',
  'urn:epcglobal:cbv:bizstep:creating_class_instance': 'creating_class_instance',
  'urn:epcglobal:cbv:bizstep:cycle_counting': 'cycle_counting',
  'urn:epcglobal:cbv:bizstep:decommissioning': 'decommissioning',
  'urn:epcglobal:cbv:bizstep:departing': 'departing',
  'urn:epcglobal:cbv:bizstep:destroying': 'destroying',
  'urn:epcglobal:cbv:bizstep:disassembling': 'disassembling',
  'urn:epcglobal:cbv:bizstep:dispensing': 'dispensing',
  'urn:epcglobal:cbv:bizstep:encoding': 'encoding',
  'urn:epcglobal:cbv:bizstep:entering_exiting': 'entering_exiting',
  'urn:epcglobal:cbv:bizstep:holding': 'holding',
  'urn:epcglobal:cbv:bizstep:inspecting': 'inspecting',
  'urn:epcglobal:cbv:bizstep:installing': 'installing',
  'urn:epcglobal:cbv:bizstep:killing': 'killing',
  'urn:epcglobal:cbv:bizstep:loading': 'loading',
  'urn:epcglobal:cbv:bizstep:other': 'other',
  'urn:epcglobal:cbv:bizstep:packing': 'packing',
  'urn:epcglobal:cbv:bizstep:picking': 'picking',
  'urn:epcglobal:cbv:bizstep:receiving': 'receiving',
  'urn:epcglobal:cbv:bizstep:removing': 'removing',
  'urn:epcglobal:cbv:bizstep:repackaging': 'repackaging',
  'urn:epcglobal:cbv:bizstep:repairing': 'repairing',
  'urn:epcglobal:cbv:bizstep:replacing': 'replacing',
  'urn:epcglobal:cbv:bizstep:reserving': 'reserving',
  'urn:epcglobal:cbv:bizstep:retail_selling': 'retail_selling',
  'urn:epcglobal:cbv:bizstep:sampling': 'sampling',
  'urn:epcglobal:cbv:bizstep:sensor_reporting': 'sensor_reporting',
  'urn:epcglobal:cbv:bizstep:shipping': 'shipping',
  'urn:epcglobal:cbv:bizstep:staging_outbound': 'staging_outbound',
  'urn:epcglobal:cbv:bizstep:stock_taking': 'stock_taking',
  'urn:epcglobal:cbv:bizstep:stocking': 'stocking',
  'urn:epcglobal:cbv:bizstep:storing': 'storing',
  'urn:epcglobal:cbv:bizstep:transporting': 'transporting',
  'urn:epcglobal:cbv:bizstep:unloading': 'unloading',
  'urn:epcglobal:cbv:bizstep:unpacking': 'unpacking',
  'urn:epcglobal:cbv:bizstep:void_shipping': 'void_shipping',
}

/**
 * Common CBV disposition values.
 */
export const DISPOSITIONS: Record<string, string> = {
  'urn:epcglobal:cbv:disp:active': 'active',
  'urn:epcglobal:cbv:disp:available': 'available',
  'urn:epcglobal:cbv:disp:completeness_inferred': 'completeness_inferred',
  'urn:epcglobal:cbv:disp:completeness_verified': 'completeness_verified',
  'urn:epcglobal:cbv:disp:conformant': 'conformant',
  'urn:epcglobal:cbv:disp:container_closed': 'container_closed',
  'urn:epcglobal:cbv:disp:container_open': 'container_open',
  'urn:epcglobal:cbv:disp:damaged': 'damaged',
  'urn:epcglobal:cbv:disp:destroyed': 'destroyed',
  'urn:epcglobal:cbv:disp:dispensed': 'dispensed',
  'urn:epcglobal:cbv:disp:disposed': 'disposed',
  'urn:epcglobal:cbv:disp:encoded': 'encoded',
  'urn:epcglobal:cbv:disp:expired': 'expired',
  'urn:epcglobal:cbv:disp:in_progress': 'in_progress',
  'urn:epcglobal:cbv:disp:in_transit': 'in_transit',
  'urn:epcglobal:cbv:disp:inactive': 'inactive',
  'urn:epcglobal:cbv:disp:mismatch': 'mismatch',
  'urn:epcglobal:cbv:disp:needs_replacement': 'needs_replacement',
  'urn:epcglobal:cbv:disp:no_pedigree_match': 'no_pedigree_match',
  'urn:epcglobal:cbv:disp:non_conformant': 'non_conformant',
  'urn:epcglobal:cbv:disp:non_sellable_other': 'non_sellable_other',
  'urn:epcglobal:cbv:disp:partially_dispensed': 'partially_dispensed',
  'urn:epcglobal:cbv:disp:recalled': 'recalled',
  'urn:epcglobal:cbv:disp:reserved': 'reserved',
  'urn:epcglobal:cbv:disp:retail_sold': 'retail_sold',
  'urn:epcglobal:cbv:disp:returned': 'returned',
  'urn:epcglobal:cbv:disp:sellable_accessible': 'sellable_accessible',
  'urn:epcglobal:cbv:disp:sellable_not_accessible': 'sellable_not_accessible',
  'urn:epcglobal:cbv:disp:stolen': 'stolen',
  'urn:epcglobal:cbv:disp:unknown': 'unknown',
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalizes a business step URN to a simple name.
 * Handles both URN format and simple names.
 */
function normalizeBizStep(bizStep: string | undefined): string | null {
  if (!bizStep) return null
  return BUSINESS_STEPS[bizStep] ?? bizStep.split(':').pop() ?? bizStep
}

/**
 * Normalizes a disposition URN to a simple name.
 */
function normalizeDisposition(disposition: string | undefined): string | null {
  if (!disposition) return null
  return DISPOSITIONS[disposition] ?? disposition.split(':').pop() ?? disposition
}

/**
 * Generates a unique event ID.
 */
function generateEventId(eventID?: string): string {
  if (eventID) return `epcis-${eventID}`
  return `epcis-${crypto.randomUUID()}`
}

/**
 * Extracts the first business transaction reference.
 */
function extractBizTransaction(
  bizTransactionList?: EPCISBusinessTransaction[]
): string | null {
  if (!bizTransactionList || bizTransactionList.length === 0) return null
  return bizTransactionList[0].bizTransaction
}

/**
 * Extracts resource information from EPC list.
 * Returns the first EPC as the primary resource.
 */
function extractResourceFromEpcs(
  epcList?: string[],
  parentID?: string
): { resourceType: string | null; resourceId: string | null } {
  if (parentID) {
    return { resourceType: 'container', resourceId: parentID }
  }
  if (epcList && epcList.length > 0) {
    return { resourceType: 'product', resourceId: epcList[0] }
  }
  return { resourceType: null, resourceId: null }
}

/**
 * Maps EPCIS action to a verb for the action_verb field.
 */
function mapActionToVerb(action?: EPCISAction): string {
  if (!action) return 'observe'
  switch (action) {
    case 'ADD':
      return 'add'
    case 'DELETE':
      return 'remove'
    case 'OBSERVE':
      return 'observe'
  }
}

/**
 * Derives partition fields from event time.
 */
function derivePartitionFields(eventTime: string): { hour: number; day: string } {
  const date = new Date(eventTime)
  return {
    hour: date.getUTCHours(),
    day: date.toISOString().slice(0, 10),
  }
}

// ============================================================================
// Main Transform Function
// ============================================================================

/**
 * Transforms an EPCIS event to a UnifiedEvent.
 *
 * Mapping:
 * - eventType -> event_name (ObjectEvent, AggregationEvent, etc.)
 * - eventTime -> timestamp
 * - bizStep -> biz_step (normalized)
 * - disposition -> biz_disposition (normalized)
 * - bizLocation.id -> biz_location
 * - readPoint.id -> biz_read_point
 * - bizTransactionList[0].bizTransaction -> biz_transaction
 * - epcList[0] or parentID -> resource_id
 * - action -> action_verb
 * - event_type = 'track' (EPCIS events are tracking events)
 *
 * @param event - The EPCIS event to transform
 * @param context - Optional transformation context
 * @returns UnifiedEvent with EPCIS-specific fields populated
 *
 * @example
 * ```typescript
 * const epcisEvent: EPCISEvent = {
 *   eventType: 'ObjectEvent',
 *   eventTime: '2024-01-15T10:30:00Z',
 *   epcList: ['urn:epc:id:sgtin:0614141.107346.2017'],
 *   action: 'OBSERVE',
 *   bizStep: 'urn:epcglobal:cbv:bizstep:shipping',
 *   disposition: 'urn:epcglobal:cbv:disp:in_transit',
 *   readPoint: { id: 'urn:epc:id:sgln:0614141.00001.0' },
 *   bizLocation: { id: 'urn:epc:id:sgln:0614141.00001.0' },
 * }
 *
 * const unified = transformEPCISEvent(epcisEvent, { ns: 'supply-chain' })
 * // unified.event_type === 'track'
 * // unified.event_name === 'ObjectEvent'
 * // unified.biz_step === 'shipping'
 * ```
 */
export function transformEPCISEvent(
  event: EPCISEvent,
  context?: EPCISTransformContext
): UnifiedEvent {
  const { hour, day } = derivePartitionFields(event.eventTime)
  const { resourceType, resourceId } = extractResourceFromEpcs(
    event.epcList,
    event.parentID
  )

  return createUnifiedEvent({
    // CoreIdentity
    id: generateEventId(event.eventID),
    event_type: 'track',
    event_name: event.eventType,
    ns: context?.ns ?? 'epcis',

    // CausalityChain
    correlation_id: context?.correlationId ?? null,

    // Actor
    actor_id: context?.actorId ?? null,

    // Resource
    resource_type: resourceType,
    resource_id: resourceId,

    // Timing
    timestamp: new Date(event.eventTime).toISOString(),

    // DoSpecific
    action_verb: mapActionToVerb(event.action),

    // BusinessEpcis
    biz_step: normalizeBizStep(event.bizStep),
    biz_disposition: normalizeDisposition(event.disposition),
    biz_transaction: extractBizTransaction(event.bizTransactionList),
    biz_location: event.bizLocation?.id ?? null,
    biz_read_point: event.readPoint?.id ?? null,

    // FlexiblePayloads - store full EPCIS data for reference
    data: {
      epcList: event.epcList,
      parentID: event.parentID,
      childEPCs: event.childEPCs,
      quantityList: event.quantityList,
      inputEPCList: event.inputEPCList,
      outputEPCList: event.outputEPCList,
      bizTransactionList: event.bizTransactionList,
      sourceList: event.sourceList,
      destinationList: event.destinationList,
      persistentDisposition: event.persistentDisposition,
      extensions: event.extensions,
    },

    // PartitionInternal
    hour,
    day,
    event_source: 'epcis',
  })
}

/**
 * Transforms multiple EPCIS events to UnifiedEvents.
 *
 * @param events - Array of EPCIS events
 * @param context - Optional transformation context (applied to all events)
 * @returns Array of UnifiedEvents
 */
export function transformEPCISEvents(
  events: EPCISEvent[],
  context?: EPCISTransformContext
): UnifiedEvent[] {
  return events.map(event => transformEPCISEvent(event, context))
}
