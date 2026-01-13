/**
 * EPCIS 2.0 Serializer/Deserializer
 *
 * Provides bidirectional mapping between internal BusinessEvent format and EPCIS 2.0:
 * - JSON-LD serialization with @context
 * - XML serialization (GS1 EPCIS 2.0 schema)
 * - CBV vocabulary integration
 * - All standard event types (ObjectEvent, AggregationEvent, TransactionEvent, TransformationEvent)
 *
 * Reference: https://ref.gs1.org/standards/epcis/
 *
 * @module db/primitives/business-event-store/epcis-serializer
 */

import {
  BusinessEvent,
  ObjectEvent,
  AggregationEvent,
  TransactionEvent,
  TransformationEvent,
  EventType,
  QuantityElement,
  SourceDest,
  BusinessTransaction,
  ObjectEventOptions,
  AggregationEventOptions,
  TransactionEventOptions,
  TransformationEventOptions,
} from './index'

// =============================================================================
// EPCIS Types
// =============================================================================

/**
 * EPCIS 2.0 JSON-LD Context
 */
export const EPCIS_CONTEXT = [
  'https://ref.gs1.org/standards/epcis/2.0.0/epcis-context.jsonld',
  'https://gs1.org/voc/',
]

/**
 * EPCIS Document type
 */
export interface EPCISDocument {
  '@context': string[]
  type: 'EPCISDocument'
  schemaVersion: string
  creationDate: string
  epcisHeader?: EPCISHeader
  epcisBody: {
    eventList: EPCISEvent[]
  }
}

/**
 * EPCIS Header with sender/receiver info
 */
export interface EPCISHeader {
  sender?: { id: string }
  receiver?: { id: string }
}

/**
 * Base EPCIS Event interface
 */
export interface EPCISEventBase {
  '@context'?: string[]
  type: string
  eventID?: string
  eventTime: string
  eventTimeZoneOffset?: string
  recordTime?: string
  readPoint?: { id: string }
  bizLocation?: { id: string }
  bizStep?: string
  disposition?: string
  sourceList?: EPCISSourceDest[]
  destinationList?: EPCISSourceDest[]
  // Extension fields (namespaced)
  [key: string]: unknown
}

/**
 * EPCIS Object Event
 */
export interface EPCISObjectEvent extends EPCISEventBase {
  type: 'ObjectEvent'
  action: 'ADD' | 'OBSERVE' | 'DELETE'
  epcList?: string[]
  quantityList?: EPCISQuantityElement[]
}

/**
 * EPCIS Aggregation Event
 */
export interface EPCISAggregationEvent extends EPCISEventBase {
  type: 'AggregationEvent'
  action: 'ADD' | 'OBSERVE' | 'DELETE'
  parentID: string
  childEPCs?: string[]
  childQuantityList?: EPCISQuantityElement[]
}

/**
 * EPCIS Transaction Event
 */
export interface EPCISTransactionEvent extends EPCISEventBase {
  type: 'TransactionEvent'
  action: 'ADD' | 'OBSERVE' | 'DELETE'
  parentID?: string
  epcList?: string[]
  quantityList?: EPCISQuantityElement[]
  bizTransactionList: EPCISBizTransaction[]
}

/**
 * EPCIS Transformation Event
 */
export interface EPCISTransformationEvent extends EPCISEventBase {
  type: 'TransformationEvent'
  transformationID?: string
  inputEPCList?: string[]
  inputQuantityList?: EPCISQuantityElement[]
  outputEPCList?: string[]
  outputQuantityList?: EPCISQuantityElement[]
}

/**
 * Union type for all EPCIS events
 */
export type EPCISEvent = EPCISObjectEvent | EPCISAggregationEvent | EPCISTransactionEvent | EPCISTransformationEvent

/**
 * EPCIS Quantity Element
 */
export interface EPCISQuantityElement {
  epcClass: string
  quantity: number
  uom?: string
}

/**
 * EPCIS Source/Destination
 */
export interface EPCISSourceDest {
  type: string
  source?: string
  destination?: string
}

/**
 * EPCIS Business Transaction
 */
export interface EPCISBizTransaction {
  type: string
  bizTransaction: string
}

// =============================================================================
// CBV (Core Business Vocabulary)
// =============================================================================

/**
 * CBV vocabulary helpers for EPCIS business steps, dispositions, etc.
 */
export const CBV = {
  // Business Steps
  bizStep: {
    shipping: 'urn:epcglobal:cbv:bizstep:shipping',
    receiving: 'urn:epcglobal:cbv:bizstep:receiving',
    commissioning: 'urn:epcglobal:cbv:bizstep:commissioning',
    decommissioning: 'urn:epcglobal:cbv:bizstep:decommissioning',
    packing: 'urn:epcglobal:cbv:bizstep:packing',
    unpacking: 'urn:epcglobal:cbv:bizstep:unpacking',
    transforming: 'urn:epcglobal:cbv:bizstep:transforming',
    inspecting: 'urn:epcglobal:cbv:bizstep:inspecting',
    storing: 'urn:epcglobal:cbv:bizstep:storing',
    picking: 'urn:epcglobal:cbv:bizstep:picking',
    loading: 'urn:epcglobal:cbv:bizstep:loading',
    departing: 'urn:epcglobal:cbv:bizstep:departing',
    arriving: 'urn:epcglobal:cbv:bizstep:arriving',
  } as Record<string, string>,

  // Dispositions
  disposition: {
    active: 'urn:epcglobal:cbv:disp:active',
    in_transit: 'urn:epcglobal:cbv:disp:in_transit',
    in_progress: 'urn:epcglobal:cbv:disp:in_progress',
    sellable_accessible: 'urn:epcglobal:cbv:disp:sellable_accessible',
    sellable_not_accessible: 'urn:epcglobal:cbv:disp:sellable_not_accessible',
    non_sellable_other: 'urn:epcglobal:cbv:disp:non_sellable_other',
    recalled: 'urn:epcglobal:cbv:disp:recalled',
    destroyed: 'urn:epcglobal:cbv:disp:destroyed',
    encoded: 'urn:epcglobal:cbv:disp:encoded',
    container_open: 'urn:epcglobal:cbv:disp:container_open',
    container_closed: 'urn:epcglobal:cbv:disp:container_closed',
  } as Record<string, string>,

  // Business Transaction Types
  bizTransactionType: {
    po: 'urn:epcglobal:cbv:btt:po',
    inv: 'urn:epcglobal:cbv:btt:inv',
    desadv: 'urn:epcglobal:cbv:btt:desadv',
    recadv: 'urn:epcglobal:cbv:btt:recadv',
    bol: 'urn:epcglobal:cbv:btt:bol',
    prodorder: 'urn:epcglobal:cbv:btt:prodorder',
  } as Record<string, string>,

  // Source/Destination Types
  sourceDestType: {
    possessing_party: 'urn:epcglobal:cbv:sdt:possessing_party',
    owning_party: 'urn:epcglobal:cbv:sdt:owning_party',
    location: 'urn:epcglobal:cbv:sdt:location',
  } as Record<string, string>,

  /**
   * Resolve a shorthand business step to full URN
   */
  resolveBizStep(step: string): string {
    if (step.startsWith('urn:')) return step
    return CBV.bizStep[step] ?? step
  },

  /**
   * Resolve a shorthand disposition to full URN
   */
  resolveDisposition(disp: string): string {
    if (disp.startsWith('urn:')) return disp
    return CBV.disposition[disp] ?? disp
  },

  /**
   * Resolve a shorthand business transaction type to full URN
   */
  resolveBizTransactionType(type: string): string {
    if (type.startsWith('urn:')) return type
    return CBV.bizTransactionType[type] ?? type
  },

  /**
   * Resolve a shorthand source/destination type to full URN
   */
  resolveSourceDestType(type: string): string {
    if (type.startsWith('urn:')) return type
    return CBV.sourceDestType[type] ?? type
  },

  /**
   * Extract shorthand from full URN
   */
  extractShorthand(urn: string, prefix: string): string {
    const prefixPattern = `urn:epcglobal:cbv:${prefix}:`
    if (urn.startsWith(prefixPattern)) {
      return urn.slice(prefixPattern.length)
    }
    return urn
  },
}

// =============================================================================
// Bidirectional Mappers
// =============================================================================

/**
 * Map internal BusinessEvent to EPCIS format
 */
export function toEPCIS(event: BusinessEvent): EPCISEvent {
  switch (event.type) {
    case 'ObjectEvent':
      return objectEventToEPCIS(event as ObjectEvent)
    case 'AggregationEvent':
      return aggregationEventToEPCIS(event as AggregationEvent)
    case 'TransactionEvent':
      return transactionEventToEPCIS(event as TransactionEvent)
    case 'TransformationEvent':
      return transformationEventToEPCIS(event as TransformationEvent)
    default:
      throw new Error(`Unsupported event type: ${(event as BusinessEvent).type}`)
  }
}

/**
 * Map EPCIS event to internal BusinessEvent format
 */
export function fromEPCIS(epcis: EPCISEvent): BusinessEvent {
  switch (epcis.type) {
    case 'ObjectEvent':
      return objectEventFromEPCIS(epcis as EPCISObjectEvent)
    case 'AggregationEvent':
      return aggregationEventFromEPCIS(epcis as EPCISAggregationEvent)
    case 'TransactionEvent':
      return transactionEventFromEPCIS(epcis as EPCISTransactionEvent)
    case 'TransformationEvent':
      return transformationEventFromEPCIS(epcis as EPCISTransformationEvent)
    default:
      throw new Error(`Invalid event type: ${(epcis as EPCISEventBase).type}`)
  }
}

// =============================================================================
// ObjectEvent Mappers
// =============================================================================

function objectEventToEPCIS(event: ObjectEvent): EPCISObjectEvent {
  const epcis: EPCISObjectEvent = {
    type: 'ObjectEvent',
    eventID: event.id,
    eventTime: event.when.toISOString(),
    recordTime: event.recordTime.toISOString(),
    action: event.action,
  }

  if (event.whenTimezoneOffset) {
    epcis.eventTimeZoneOffset = event.whenTimezoneOffset
  }

  if (event.what.length > 0) {
    epcis.epcList = event.what
  }

  if (event.quantityList?.length) {
    epcis.quantityList = event.quantityList.map(mapQuantityElement)
  }

  if (event.where) {
    epcis.readPoint = { id: event.where }
  }

  if (event.bizLocation) {
    epcis.bizLocation = { id: event.bizLocation }
  }

  if (event.why) {
    epcis.bizStep = CBV.resolveBizStep(event.why)
  }

  if (event.how) {
    epcis.disposition = CBV.resolveDisposition(event.how)
  }

  if (event.sourceList?.length) {
    epcis.sourceList = event.sourceList.map(mapSourceDestToEPCIS)
  }

  if (event.destinationList?.length) {
    epcis.destinationList = event.destinationList.map(mapDestToEPCIS)
  }

  // Map digital extensions to dotdo namespace
  mapDigitalExtensionsToEPCIS(event, epcis)

  // Map custom extensions
  if (event.extensions) {
    for (const [key, value] of Object.entries(event.extensions)) {
      epcis[key] = value
    }
  }

  return epcis
}

function objectEventFromEPCIS(epcis: EPCISObjectEvent): ObjectEvent {
  const options: ObjectEventOptions = {
    what: epcis.epcList || [],
    when: new Date(epcis.eventTime),
    action: epcis.action,
  }

  if (epcis.eventTimeZoneOffset) {
    options.whenTimezoneOffset = epcis.eventTimeZoneOffset
  }

  if (epcis.quantityList?.length) {
    options.quantityList = epcis.quantityList.map(mapQuantityElementFromEPCIS)
  }

  if (epcis.readPoint?.id) {
    options.where = epcis.readPoint.id
  }

  if (epcis.bizLocation?.id) {
    options.bizLocation = epcis.bizLocation.id
  }

  if (epcis.bizStep) {
    options.why = epcis.bizStep
  }

  if (epcis.disposition) {
    options.how = epcis.disposition
  }

  if (epcis.sourceList?.length) {
    options.sourceList = epcis.sourceList.map(mapSourceDestFromEPCIS)
  }

  if (epcis.destinationList?.length) {
    options.destinationList = epcis.destinationList.map(mapDestFromEPCIS)
  }

  // Extract digital extensions from dotdo namespace
  mapDigitalExtensionsFromEPCIS(epcis, options)

  // Extract custom extensions
  const extensions = extractExtensions(epcis)
  if (Object.keys(extensions).length > 0) {
    options.extensions = extensions
  }

  return new ObjectEvent(options)
}

// =============================================================================
// AggregationEvent Mappers
// =============================================================================

function aggregationEventToEPCIS(event: AggregationEvent): EPCISAggregationEvent {
  const epcis: EPCISAggregationEvent = {
    type: 'AggregationEvent',
    eventID: event.id,
    eventTime: event.when.toISOString(),
    recordTime: event.recordTime.toISOString(),
    action: event.action,
    parentID: event.parentID,
  }

  if (event.whenTimezoneOffset) {
    epcis.eventTimeZoneOffset = event.whenTimezoneOffset
  }

  if (event.childEPCs.length > 0) {
    epcis.childEPCs = event.childEPCs
  }

  if (event.childQuantityList?.length) {
    epcis.childQuantityList = event.childQuantityList.map(mapQuantityElement)
  }

  if (event.where) {
    epcis.readPoint = { id: event.where }
  }

  if (event.bizLocation) {
    epcis.bizLocation = { id: event.bizLocation }
  }

  if (event.why) {
    epcis.bizStep = CBV.resolveBizStep(event.why)
  }

  if (event.how) {
    epcis.disposition = CBV.resolveDisposition(event.how)
  }

  mapDigitalExtensionsToEPCIS(event, epcis)

  if (event.extensions) {
    for (const [key, value] of Object.entries(event.extensions)) {
      epcis[key] = value
    }
  }

  return epcis
}

function aggregationEventFromEPCIS(epcis: EPCISAggregationEvent): AggregationEvent {
  const options: AggregationEventOptions = {
    parentID: epcis.parentID,
    childEPCs: epcis.childEPCs || [],
    when: new Date(epcis.eventTime),
    action: epcis.action,
  }

  if (epcis.eventTimeZoneOffset) {
    options.whenTimezoneOffset = epcis.eventTimeZoneOffset
  }

  if (epcis.childQuantityList?.length) {
    options.childQuantityList = epcis.childQuantityList.map(mapQuantityElementFromEPCIS)
  }

  if (epcis.readPoint?.id) {
    options.where = epcis.readPoint.id
  }

  if (epcis.bizLocation?.id) {
    options.bizLocation = epcis.bizLocation.id
  }

  if (epcis.bizStep) {
    options.why = epcis.bizStep
  }

  if (epcis.disposition) {
    options.how = epcis.disposition
  }

  mapDigitalExtensionsFromEPCIS(epcis, options)

  const extensions = extractExtensions(epcis)
  if (Object.keys(extensions).length > 0) {
    options.extensions = extensions
  }

  return new AggregationEvent(options)
}

// =============================================================================
// TransactionEvent Mappers
// =============================================================================

function transactionEventToEPCIS(event: TransactionEvent): EPCISTransactionEvent {
  const epcis: EPCISTransactionEvent = {
    type: 'TransactionEvent',
    eventID: event.id,
    eventTime: event.when.toISOString(),
    recordTime: event.recordTime.toISOString(),
    action: event.action,
    bizTransactionList: event.bizTransactionList.map(mapBizTransactionToEPCIS),
  }

  if (event.whenTimezoneOffset) {
    epcis.eventTimeZoneOffset = event.whenTimezoneOffset
  }

  if (event.what.length > 0) {
    epcis.epcList = event.what
  }

  if (event.parentID) {
    epcis.parentID = event.parentID
  }

  if (event.quantityList?.length) {
    epcis.quantityList = event.quantityList.map(mapQuantityElement)
  }

  if (event.where) {
    epcis.readPoint = { id: event.where }
  }

  if (event.bizLocation) {
    epcis.bizLocation = { id: event.bizLocation }
  }

  if (event.why) {
    epcis.bizStep = CBV.resolveBizStep(event.why)
  }

  if (event.how) {
    epcis.disposition = CBV.resolveDisposition(event.how)
  }

  mapDigitalExtensionsToEPCIS(event, epcis)

  if (event.extensions) {
    for (const [key, value] of Object.entries(event.extensions)) {
      epcis[key] = value
    }
  }

  return epcis
}

function transactionEventFromEPCIS(epcis: EPCISTransactionEvent): TransactionEvent {
  const options: TransactionEventOptions = {
    what: epcis.epcList || [],
    bizTransactionList: epcis.bizTransactionList.map(mapBizTransactionFromEPCIS),
    when: new Date(epcis.eventTime),
    action: epcis.action,
  }

  if (epcis.eventTimeZoneOffset) {
    options.whenTimezoneOffset = epcis.eventTimeZoneOffset
  }

  if (epcis.parentID) {
    options.parentID = epcis.parentID
  }

  if (epcis.quantityList?.length) {
    options.quantityList = epcis.quantityList.map(mapQuantityElementFromEPCIS)
  }

  if (epcis.readPoint?.id) {
    options.where = epcis.readPoint.id
  }

  if (epcis.bizLocation?.id) {
    options.bizLocation = epcis.bizLocation.id
  }

  if (epcis.bizStep) {
    options.why = epcis.bizStep
  }

  if (epcis.disposition) {
    options.how = epcis.disposition
  }

  mapDigitalExtensionsFromEPCIS(epcis, options)

  const extensions = extractExtensions(epcis)
  if (Object.keys(extensions).length > 0) {
    options.extensions = extensions
  }

  return new TransactionEvent(options)
}

// =============================================================================
// TransformationEvent Mappers
// =============================================================================

function transformationEventToEPCIS(event: TransformationEvent): EPCISTransformationEvent {
  const epcis: EPCISTransformationEvent = {
    type: 'TransformationEvent',
    eventID: event.id,
    eventTime: event.when.toISOString(),
    recordTime: event.recordTime.toISOString(),
  }

  if (event.whenTimezoneOffset) {
    epcis.eventTimeZoneOffset = event.whenTimezoneOffset
  }

  if (event.transformationID) {
    epcis.transformationID = event.transformationID
  }

  if (event.inputEPCList.length > 0) {
    epcis.inputEPCList = event.inputEPCList
  }

  if (event.inputQuantityList?.length) {
    epcis.inputQuantityList = event.inputQuantityList.map(mapQuantityElement)
  }

  if (event.outputEPCList.length > 0) {
    epcis.outputEPCList = event.outputEPCList
  }

  if (event.outputQuantityList?.length) {
    epcis.outputQuantityList = event.outputQuantityList.map(mapQuantityElement)
  }

  if (event.where) {
    epcis.readPoint = { id: event.where }
  }

  if (event.bizLocation) {
    epcis.bizLocation = { id: event.bizLocation }
  }

  if (event.why) {
    epcis.bizStep = CBV.resolveBizStep(event.why)
  }

  if (event.how) {
    epcis.disposition = CBV.resolveDisposition(event.how)
  }

  mapDigitalExtensionsToEPCIS(event, epcis)

  if (event.extensions) {
    for (const [key, value] of Object.entries(event.extensions)) {
      epcis[key] = value
    }
  }

  return epcis
}

function transformationEventFromEPCIS(epcis: EPCISTransformationEvent): TransformationEvent {
  const options: TransformationEventOptions = {
    inputEPCList: epcis.inputEPCList || [],
    outputEPCList: epcis.outputEPCList || [],
    when: new Date(epcis.eventTime),
  }

  if (epcis.eventTimeZoneOffset) {
    options.whenTimezoneOffset = epcis.eventTimeZoneOffset
  }

  if (epcis.transformationID) {
    options.transformationID = epcis.transformationID
  }

  if (epcis.inputQuantityList?.length) {
    options.inputQuantityList = epcis.inputQuantityList.map(mapQuantityElementFromEPCIS)
  }

  if (epcis.outputQuantityList?.length) {
    options.outputQuantityList = epcis.outputQuantityList.map(mapQuantityElementFromEPCIS)
  }

  if (epcis.readPoint?.id) {
    options.where = epcis.readPoint.id
  }

  if (epcis.bizLocation?.id) {
    options.bizLocation = epcis.bizLocation.id
  }

  if (epcis.bizStep) {
    options.why = epcis.bizStep
  }

  if (epcis.disposition) {
    options.how = epcis.disposition
  }

  mapDigitalExtensionsFromEPCIS(epcis, options)

  const extensions = extractExtensions(epcis)
  if (Object.keys(extensions).length > 0) {
    options.extensions = extensions
  }

  return new TransformationEvent(options)
}

// =============================================================================
// Helper Mappers
// =============================================================================

function mapQuantityElement(qty: QuantityElement): EPCISQuantityElement {
  return {
    epcClass: qty.epcClass,
    quantity: qty.quantity,
    uom: qty.uom,
  }
}

function mapQuantityElementFromEPCIS(qty: EPCISQuantityElement): QuantityElement {
  return {
    epcClass: qty.epcClass,
    quantity: qty.quantity,
    uom: qty.uom,
  }
}

function mapSourceDestToEPCIS(sd: SourceDest): EPCISSourceDest {
  return {
    type: CBV.resolveSourceDestType(sd.type),
    source: sd.value,
  }
}

function mapDestToEPCIS(sd: SourceDest): EPCISSourceDest {
  return {
    type: CBV.resolveSourceDestType(sd.type),
    destination: sd.value,
  }
}

function mapSourceDestFromEPCIS(sd: EPCISSourceDest): SourceDest {
  return {
    type: CBV.extractShorthand(sd.type, 'sdt'),
    value: sd.source!,
  }
}

function mapDestFromEPCIS(sd: EPCISSourceDest): SourceDest {
  return {
    type: CBV.extractShorthand(sd.type, 'sdt'),
    value: sd.destination!,
  }
}

function mapBizTransactionToEPCIS(bt: BusinessTransaction): EPCISBizTransaction {
  return {
    type: CBV.resolveBizTransactionType(bt.type),
    bizTransaction: bt.value,
  }
}

function mapBizTransactionFromEPCIS(bt: EPCISBizTransaction): BusinessTransaction {
  return {
    type: CBV.extractShorthand(bt.type, 'btt'),
    value: bt.bizTransaction,
  }
}

// Digital extensions mapping
const DIGITAL_EXTENSION_KEYS = [
  'channel',
  'sessionId',
  'deviceId',
  'actorType',
  'confidence',
  'context',
] as const

function mapDigitalExtensionsToEPCIS(event: BusinessEvent, epcis: EPCISEventBase): void {
  if (event.channel) {
    epcis['dotdo:channel'] = event.channel
  }
  if (event.sessionId) {
    epcis['dotdo:sessionId'] = event.sessionId
  }
  if (event.deviceId) {
    epcis['dotdo:deviceId'] = event.deviceId
  }
  if (event.actorType) {
    epcis['dotdo:actorType'] = event.actorType
  }
  if (event.confidence !== undefined) {
    epcis['dotdo:confidence'] = event.confidence
  }
  if (event.context) {
    epcis['dotdo:context'] = event.context
  }
}

function mapDigitalExtensionsFromEPCIS(
  epcis: EPCISEventBase,
  options: ObjectEventOptions | AggregationEventOptions | TransactionEventOptions | TransformationEventOptions
): void {
  if (epcis['dotdo:channel']) {
    ;(options as ObjectEventOptions).channel = epcis['dotdo:channel'] as string
  }
  if (epcis['dotdo:sessionId']) {
    ;(options as ObjectEventOptions).sessionId = epcis['dotdo:sessionId'] as string
  }
  if (epcis['dotdo:deviceId']) {
    ;(options as ObjectEventOptions).deviceId = epcis['dotdo:deviceId'] as string
  }
  if (epcis['dotdo:actorType']) {
    ;(options as ObjectEventOptions).actorType = epcis['dotdo:actorType'] as 'human' | 'agent' | 'system' | 'webhook'
  }
  if (epcis['dotdo:confidence'] !== undefined) {
    ;(options as ObjectEventOptions).confidence = epcis['dotdo:confidence'] as number
  }
  if (epcis['dotdo:context']) {
    ;(options as ObjectEventOptions).context = epcis['dotdo:context'] as Record<string, unknown>
  }
}

// Standard EPCIS fields to exclude when extracting custom extensions
const STANDARD_EPCIS_FIELDS = new Set([
  '@context',
  'type',
  'eventID',
  'eventTime',
  'eventTimeZoneOffset',
  'recordTime',
  'readPoint',
  'bizLocation',
  'bizStep',
  'disposition',
  'sourceList',
  'destinationList',
  'action',
  'epcList',
  'quantityList',
  'parentID',
  'childEPCs',
  'childQuantityList',
  'bizTransactionList',
  'transformationID',
  'inputEPCList',
  'inputQuantityList',
  'outputEPCList',
  'outputQuantityList',
])

function extractExtensions(epcis: EPCISEventBase): Record<string, unknown> {
  const extensions: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(epcis)) {
    if (STANDARD_EPCIS_FIELDS.has(key)) continue
    if (key.startsWith('dotdo:')) continue // Digital extensions handled separately
    extensions[key] = value
  }

  return extensions
}

// =============================================================================
// Serializer Interface and Factory
// =============================================================================

/**
 * EPCIS Serializer interface
 */
export interface IEPCISSerializer {
  serializeEvent(event: BusinessEvent): string
  serializeDocument(events: BusinessEvent[], header?: EPCISHeader): string
  deserializeEvent(data: string): BusinessEvent
  deserializeDocument(data: string): BusinessEvent[]
}

/**
 * Serializer format options
 */
export type EPCISFormat = 'json-ld' | 'xml'

/**
 * Serializer options
 */
export interface EPCISSerializerOptions {
  format?: EPCISFormat
}

// =============================================================================
// JSON-LD Serializer
// =============================================================================

/**
 * EPCIS 2.0 JSON-LD Serializer
 */
export class EPCISJsonLdSerializer implements IEPCISSerializer {
  /**
   * Serialize a single event to JSON-LD
   */
  serializeEvent(event: BusinessEvent): string {
    const epcisEvent = toEPCIS(event)
    return JSON.stringify({
      '@context': EPCIS_CONTEXT,
      ...epcisEvent,
    })
  }

  /**
   * Serialize multiple events as an EPCIS Document
   */
  serializeDocument(events: BusinessEvent[], header?: EPCISHeader): string {
    const doc: EPCISDocument = {
      '@context': EPCIS_CONTEXT,
      type: 'EPCISDocument',
      schemaVersion: '2.0',
      creationDate: new Date().toISOString(),
      epcisBody: {
        eventList: events.map((e) => toEPCIS(e)),
      },
    }

    if (header) {
      doc.epcisHeader = header
    }

    return JSON.stringify(doc)
  }

  /**
   * Deserialize a JSON-LD event
   */
  deserializeEvent(data: string): BusinessEvent {
    const parsed = JSON.parse(data)

    if (!parsed.type) {
      throw new Error('Event type is required')
    }

    if (!['ObjectEvent', 'AggregationEvent', 'TransactionEvent', 'TransformationEvent'].includes(parsed.type)) {
      throw new Error(`Invalid event type: ${parsed.type}`)
    }

    return fromEPCIS(parsed as EPCISEvent)
  }

  /**
   * Deserialize a JSON-LD document
   */
  deserializeDocument(data: string): BusinessEvent[] {
    const doc = JSON.parse(data) as EPCISDocument

    if (!doc.epcisBody?.eventList) {
      return []
    }

    return doc.epcisBody.eventList.map((e) => fromEPCIS(e))
  }
}

// =============================================================================
// XML Serializer
// =============================================================================

/**
 * EPCIS 2.0 XML Serializer
 */
export class EPCISXmlSerializer implements IEPCISSerializer {
  /**
   * Serialize a single event to XML
   */
  serializeEvent(event: BusinessEvent): string {
    const epcisEvent = toEPCIS(event)
    return this.eventToXml(epcisEvent)
  }

  /**
   * Serialize multiple events as an EPCIS Document
   */
  serializeDocument(events: BusinessEvent[], _header?: EPCISHeader): string {
    const eventListXml = events.map((e) => this.eventToXmlFragment(toEPCIS(e))).join('\n')

    return `<?xml version="1.0" encoding="UTF-8"?>
<epcis:EPCISDocument xmlns:epcis="urn:epcglobal:epcis:xsd:2" xmlns:cbv="urn:epcglobal:cbv:xsd:1" schemaVersion="2.0" creationDate="${new Date().toISOString()}">
  <EPCISBody>
    <EventList>
${eventListXml}
    </EventList>
  </EPCISBody>
</epcis:EPCISDocument>`
  }

  /**
   * Deserialize an XML event
   */
  deserializeEvent(data: string): BusinessEvent {
    const eventType = this.extractEventType(data)

    if (!eventType) {
      throw new Error('Missing required event type')
    }

    switch (eventType) {
      case 'ObjectEvent':
        return this.parseObjectEvent(data)
      case 'AggregationEvent':
        return this.parseAggregationEvent(data)
      case 'TransactionEvent':
        return this.parseTransactionEvent(data)
      case 'TransformationEvent':
        return this.parseTransformationEvent(data)
      default:
        throw new Error(`Unsupported event type: ${eventType}`)
    }
  }

  /**
   * Deserialize an XML document
   */
  deserializeDocument(data: string): BusinessEvent[] {
    const events: BusinessEvent[] = []

    // Extract all event types from EventList
    const eventTypes = ['ObjectEvent', 'AggregationEvent', 'TransactionEvent', 'TransformationEvent'] as const

    for (const eventType of eventTypes) {
      const regex = new RegExp(`<${eventType}>[\\s\\S]*?</${eventType}>`, 'g')
      const matches = data.match(regex)

      if (matches) {
        for (const match of matches) {
          events.push(this.deserializeEvent(match))
        }
      }
    }

    return events
  }

  // XML Generation Helpers

  private eventToXml(event: EPCISEvent): string {
    // Single event XML with namespace declarations at the root
    const eventXml = this.eventToXmlFragment(event, false)
    return `<?xml version="1.0" encoding="UTF-8"?>
<epcis:EPCISEvent xmlns:epcis="urn:epcglobal:epcis:xsd:2" xmlns:cbv="urn:epcglobal:cbv:xsd:1">
${eventXml}
</epcis:EPCISEvent>`
  }

  private eventToXmlFragment(event: EPCISEvent, includeNamespace = false): string {
    switch (event.type) {
      case 'ObjectEvent':
        return this.objectEventToXml(event as EPCISObjectEvent, includeNamespace)
      case 'AggregationEvent':
        return this.aggregationEventToXml(event as EPCISAggregationEvent, includeNamespace)
      case 'TransactionEvent':
        return this.transactionEventToXml(event as EPCISTransactionEvent, includeNamespace)
      case 'TransformationEvent':
        return this.transformationEventToXml(event as EPCISTransformationEvent, includeNamespace)
    }
  }

  private objectEventToXml(event: EPCISObjectEvent, includeNamespace: boolean): string {
    const parts: string[] = []
    const attrs = includeNamespace ? ' xmlns:epcis="urn:epcglobal:epcis:xsd:2" xmlns:cbv="urn:epcglobal:cbv:xsd:1"' : ''

    parts.push(`<ObjectEvent${attrs}>`)
    parts.push(`  <eventTime>${event.eventTime}</eventTime>`)

    if (event.eventTimeZoneOffset) {
      parts.push(`  <eventTimeZoneOffset>${event.eventTimeZoneOffset}</eventTimeZoneOffset>`)
    }

    parts.push(`  <action>${event.action}</action>`)

    if (event.epcList?.length) {
      parts.push('  <epcList>')
      for (const epc of event.epcList) {
        parts.push(`    <epc>${epc}</epc>`)
      }
      parts.push('  </epcList>')
    }

    if (event.quantityList?.length) {
      parts.push('  <quantityList>')
      for (const qty of event.quantityList) {
        parts.push('    <quantityElement>')
        parts.push(`      <epcClass>${qty.epcClass}</epcClass>`)
        parts.push(`      <quantity>${qty.quantity}</quantity>`)
        if (qty.uom) {
          parts.push(`      <uom>${qty.uom}</uom>`)
        }
        parts.push('    </quantityElement>')
      }
      parts.push('  </quantityList>')
    }

    if (event.readPoint) {
      parts.push('  <readPoint>')
      parts.push(`    <id>${event.readPoint.id}</id>`)
      parts.push('  </readPoint>')
    }

    if (event.bizLocation) {
      parts.push('  <bizLocation>')
      parts.push(`    <id>${event.bizLocation.id}</id>`)
      parts.push('  </bizLocation>')
    }

    if (event.bizStep) {
      parts.push(`  <bizStep>${event.bizStep}</bizStep>`)
    }

    if (event.disposition) {
      parts.push(`  <disposition>${event.disposition}</disposition>`)
    }

    parts.push('</ObjectEvent>')

    return parts.join('\n')
  }

  private aggregationEventToXml(event: EPCISAggregationEvent, includeNamespace: boolean): string {
    const parts: string[] = []
    const attrs = includeNamespace ? ' xmlns:epcis="urn:epcglobal:epcis:xsd:2" xmlns:cbv="urn:epcglobal:cbv:xsd:1"' : ''

    parts.push(`<AggregationEvent${attrs}>`)
    parts.push(`  <eventTime>${event.eventTime}</eventTime>`)

    if (event.eventTimeZoneOffset) {
      parts.push(`  <eventTimeZoneOffset>${event.eventTimeZoneOffset}</eventTimeZoneOffset>`)
    }

    parts.push(`  <action>${event.action}</action>`)
    parts.push(`  <parentID>${event.parentID}</parentID>`)

    if (event.childEPCs?.length) {
      parts.push('  <childEPCs>')
      for (const epc of event.childEPCs) {
        parts.push(`    <epc>${epc}</epc>`)
      }
      parts.push('  </childEPCs>')
    }

    if (event.childQuantityList?.length) {
      parts.push('  <childQuantityList>')
      for (const qty of event.childQuantityList) {
        parts.push('    <quantityElement>')
        parts.push(`      <epcClass>${qty.epcClass}</epcClass>`)
        parts.push(`      <quantity>${qty.quantity}</quantity>`)
        if (qty.uom) {
          parts.push(`      <uom>${qty.uom}</uom>`)
        }
        parts.push('    </quantityElement>')
      }
      parts.push('  </childQuantityList>')
    }

    if (event.readPoint) {
      parts.push('  <readPoint>')
      parts.push(`    <id>${event.readPoint.id}</id>`)
      parts.push('  </readPoint>')
    }

    if (event.bizLocation) {
      parts.push('  <bizLocation>')
      parts.push(`    <id>${event.bizLocation.id}</id>`)
      parts.push('  </bizLocation>')
    }

    if (event.bizStep) {
      parts.push(`  <bizStep>${event.bizStep}</bizStep>`)
    }

    if (event.disposition) {
      parts.push(`  <disposition>${event.disposition}</disposition>`)
    }

    parts.push('</AggregationEvent>')

    return parts.join('\n')
  }

  private transactionEventToXml(event: EPCISTransactionEvent, includeNamespace: boolean): string {
    const parts: string[] = []
    const attrs = includeNamespace ? ' xmlns:epcis="urn:epcglobal:epcis:xsd:2" xmlns:cbv="urn:epcglobal:cbv:xsd:1"' : ''

    parts.push(`<TransactionEvent${attrs}>`)
    parts.push(`  <eventTime>${event.eventTime}</eventTime>`)

    if (event.eventTimeZoneOffset) {
      parts.push(`  <eventTimeZoneOffset>${event.eventTimeZoneOffset}</eventTimeZoneOffset>`)
    }

    parts.push(`  <action>${event.action}</action>`)

    if (event.parentID) {
      parts.push(`  <parentID>${event.parentID}</parentID>`)
    }

    if (event.epcList?.length) {
      parts.push('  <epcList>')
      for (const epc of event.epcList) {
        parts.push(`    <epc>${epc}</epc>`)
      }
      parts.push('  </epcList>')
    }

    parts.push('  <bizTransactionList>')
    for (const bt of event.bizTransactionList) {
      parts.push(`    <bizTransaction type="${bt.type}">${bt.bizTransaction}</bizTransaction>`)
    }
    parts.push('  </bizTransactionList>')

    if (event.readPoint) {
      parts.push('  <readPoint>')
      parts.push(`    <id>${event.readPoint.id}</id>`)
      parts.push('  </readPoint>')
    }

    if (event.bizLocation) {
      parts.push('  <bizLocation>')
      parts.push(`    <id>${event.bizLocation.id}</id>`)
      parts.push('  </bizLocation>')
    }

    if (event.bizStep) {
      parts.push(`  <bizStep>${event.bizStep}</bizStep>`)
    }

    if (event.disposition) {
      parts.push(`  <disposition>${event.disposition}</disposition>`)
    }

    parts.push('</TransactionEvent>')

    return parts.join('\n')
  }

  private transformationEventToXml(event: EPCISTransformationEvent, includeNamespace: boolean): string {
    const parts: string[] = []
    const attrs = includeNamespace ? ' xmlns:epcis="urn:epcglobal:epcis:xsd:2" xmlns:cbv="urn:epcglobal:cbv:xsd:1"' : ''

    parts.push(`<TransformationEvent${attrs}>`)
    parts.push(`  <eventTime>${event.eventTime}</eventTime>`)

    if (event.eventTimeZoneOffset) {
      parts.push(`  <eventTimeZoneOffset>${event.eventTimeZoneOffset}</eventTimeZoneOffset>`)
    }

    if (event.transformationID) {
      parts.push(`  <transformationID>${event.transformationID}</transformationID>`)
    }

    if (event.inputEPCList?.length) {
      parts.push('  <inputEPCList>')
      for (const epc of event.inputEPCList) {
        parts.push(`    <epc>${epc}</epc>`)
      }
      parts.push('  </inputEPCList>')
    }

    if (event.inputQuantityList?.length) {
      parts.push('  <inputQuantityList>')
      for (const qty of event.inputQuantityList) {
        parts.push('    <quantityElement>')
        parts.push(`      <epcClass>${qty.epcClass}</epcClass>`)
        parts.push(`      <quantity>${qty.quantity}</quantity>`)
        if (qty.uom) {
          parts.push(`      <uom>${qty.uom}</uom>`)
        }
        parts.push('    </quantityElement>')
      }
      parts.push('  </inputQuantityList>')
    }

    if (event.outputEPCList?.length) {
      parts.push('  <outputEPCList>')
      for (const epc of event.outputEPCList) {
        parts.push(`    <epc>${epc}</epc>`)
      }
      parts.push('  </outputEPCList>')
    }

    if (event.outputQuantityList?.length) {
      parts.push('  <outputQuantityList>')
      for (const qty of event.outputQuantityList) {
        parts.push('    <quantityElement>')
        parts.push(`      <epcClass>${qty.epcClass}</epcClass>`)
        parts.push(`      <quantity>${qty.quantity}</quantity>`)
        if (qty.uom) {
          parts.push(`      <uom>${qty.uom}</uom>`)
        }
        parts.push('    </quantityElement>')
      }
      parts.push('  </outputQuantityList>')
    }

    if (event.readPoint) {
      parts.push('  <readPoint>')
      parts.push(`    <id>${event.readPoint.id}</id>`)
      parts.push('  </readPoint>')
    }

    if (event.bizLocation) {
      parts.push('  <bizLocation>')
      parts.push(`    <id>${event.bizLocation.id}</id>`)
      parts.push('  </bizLocation>')
    }

    if (event.bizStep) {
      parts.push(`  <bizStep>${event.bizStep}</bizStep>`)
    }

    if (event.disposition) {
      parts.push(`  <disposition>${event.disposition}</disposition>`)
    }

    parts.push('</TransformationEvent>')

    return parts.join('\n')
  }

  // XML Parsing Helpers

  private extractEventType(xml: string): EventType | null {
    const eventTypes = ['ObjectEvent', 'AggregationEvent', 'TransactionEvent', 'TransformationEvent'] as const
    for (const type of eventTypes) {
      // Match opening tag with optional attributes (e.g., <ObjectEvent> or <ObjectEvent xmlns:...>)
      const regex = new RegExp(`<${type}(\\s|>)`)
      if (regex.test(xml)) {
        return type
      }
    }
    return null
  }

  private extractTag(xml: string, tag: string): string | null {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)
    const match = xml.match(regex)
    return match ? match[1]!.trim() : null
  }

  private extractAttribute(xml: string, tag: string, attr: string): string | null {
    const regex = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`)
    const match = xml.match(regex)
    return match ? match[1]! : null
  }

  private extractEpcList(xml: string, listTag: string): string[] {
    const listContent = this.extractTag(xml, listTag)
    if (!listContent) return []

    const epcs: string[] = []
    const epcRegex = /<epc>([^<]+)<\/epc>/g
    let match
    while ((match = epcRegex.exec(listContent)) !== null) {
      epcs.push(match[1]!)
    }
    return epcs
  }

  private extractQuantityList(xml: string, listTag: string): QuantityElement[] {
    const listContent = this.extractTag(xml, listTag)
    if (!listContent) return []

    const quantities: QuantityElement[] = []
    const qtyRegex = /<quantityElement>([\s\S]*?)<\/quantityElement>/g
    let match
    while ((match = qtyRegex.exec(listContent)) !== null) {
      const qtyXml = match[1]!
      const epcClass = this.extractTag(qtyXml, 'epcClass')
      const quantity = this.extractTag(qtyXml, 'quantity')
      const uom = this.extractTag(qtyXml, 'uom')

      if (epcClass && quantity) {
        quantities.push({
          epcClass,
          quantity: parseFloat(quantity),
          uom: uom || undefined,
        })
      }
    }
    return quantities
  }

  private parseObjectEvent(xml: string): ObjectEvent {
    const eventTime = this.extractTag(xml, 'eventTime')
    if (!eventTime) {
      throw new Error('Missing required eventTime')
    }

    const action = this.extractTag(xml, 'action')
    if (!action) {
      throw new Error('Missing required action')
    }

    const options: ObjectEventOptions = {
      what: this.extractEpcList(xml, 'epcList'),
      when: new Date(eventTime),
      action: action as 'ADD' | 'OBSERVE' | 'DELETE',
    }

    const eventTimeZoneOffset = this.extractTag(xml, 'eventTimeZoneOffset')
    if (eventTimeZoneOffset) {
      options.whenTimezoneOffset = eventTimeZoneOffset
    }

    const quantityList = this.extractQuantityList(xml, 'quantityList')
    if (quantityList.length > 0) {
      options.quantityList = quantityList
    }

    const readPointContent = this.extractTag(xml, 'readPoint')
    if (readPointContent) {
      const readPointId = this.extractTag(readPointContent, 'id')
      if (readPointId) {
        options.where = readPointId
      }
    }

    const bizLocationContent = this.extractTag(xml, 'bizLocation')
    if (bizLocationContent) {
      const bizLocationId = this.extractTag(bizLocationContent, 'id')
      if (bizLocationId) {
        options.bizLocation = bizLocationId
      }
    }

    const bizStep = this.extractTag(xml, 'bizStep')
    if (bizStep) {
      options.why = bizStep
    }

    const disposition = this.extractTag(xml, 'disposition')
    if (disposition) {
      options.how = disposition
    }

    return new ObjectEvent(options)
  }

  private parseAggregationEvent(xml: string): AggregationEvent {
    const eventTime = this.extractTag(xml, 'eventTime')
    if (!eventTime) {
      throw new Error('Missing required eventTime')
    }

    const action = this.extractTag(xml, 'action')
    if (!action) {
      throw new Error('Missing required action')
    }

    const parentID = this.extractTag(xml, 'parentID')
    if (!parentID) {
      throw new Error('Missing required parentID')
    }

    const options: AggregationEventOptions = {
      parentID,
      childEPCs: this.extractEpcList(xml, 'childEPCs'),
      when: new Date(eventTime),
      action: action as 'ADD' | 'OBSERVE' | 'DELETE',
    }

    const eventTimeZoneOffset = this.extractTag(xml, 'eventTimeZoneOffset')
    if (eventTimeZoneOffset) {
      options.whenTimezoneOffset = eventTimeZoneOffset
    }

    const childQuantityList = this.extractQuantityList(xml, 'childQuantityList')
    if (childQuantityList.length > 0) {
      options.childQuantityList = childQuantityList
    }

    const readPointContent = this.extractTag(xml, 'readPoint')
    if (readPointContent) {
      const readPointId = this.extractTag(readPointContent, 'id')
      if (readPointId) {
        options.where = readPointId
      }
    }

    const bizLocationContent = this.extractTag(xml, 'bizLocation')
    if (bizLocationContent) {
      const bizLocationId = this.extractTag(bizLocationContent, 'id')
      if (bizLocationId) {
        options.bizLocation = bizLocationId
      }
    }

    const bizStep = this.extractTag(xml, 'bizStep')
    if (bizStep) {
      options.why = bizStep
    }

    const disposition = this.extractTag(xml, 'disposition')
    if (disposition) {
      options.how = disposition
    }

    return new AggregationEvent(options)
  }

  private parseTransactionEvent(xml: string): TransactionEvent {
    const eventTime = this.extractTag(xml, 'eventTime')
    if (!eventTime) {
      throw new Error('Missing required eventTime')
    }

    const action = this.extractTag(xml, 'action')
    if (!action) {
      throw new Error('Missing required action')
    }

    // Parse bizTransactionList
    const bizTransactionListContent = this.extractTag(xml, 'bizTransactionList')
    if (!bizTransactionListContent) {
      throw new Error('Missing required bizTransactionList')
    }

    const bizTransactionList: BusinessTransaction[] = []
    const btRegex = /<bizTransaction type="([^"]+)">([^<]+)<\/bizTransaction>/g
    let btMatch
    while ((btMatch = btRegex.exec(bizTransactionListContent)) !== null) {
      bizTransactionList.push({
        type: CBV.extractShorthand(btMatch[1]!, 'btt'),
        value: btMatch[2]!,
      })
    }

    const options: TransactionEventOptions = {
      what: this.extractEpcList(xml, 'epcList'),
      bizTransactionList,
      when: new Date(eventTime),
      action: action as 'ADD' | 'OBSERVE' | 'DELETE',
    }

    const parentID = this.extractTag(xml, 'parentID')
    if (parentID) {
      options.parentID = parentID
    }

    const eventTimeZoneOffset = this.extractTag(xml, 'eventTimeZoneOffset')
    if (eventTimeZoneOffset) {
      options.whenTimezoneOffset = eventTimeZoneOffset
    }

    const quantityList = this.extractQuantityList(xml, 'quantityList')
    if (quantityList.length > 0) {
      options.quantityList = quantityList
    }

    const readPointContent = this.extractTag(xml, 'readPoint')
    if (readPointContent) {
      const readPointId = this.extractTag(readPointContent, 'id')
      if (readPointId) {
        options.where = readPointId
      }
    }

    const bizLocationContent = this.extractTag(xml, 'bizLocation')
    if (bizLocationContent) {
      const bizLocationId = this.extractTag(bizLocationContent, 'id')
      if (bizLocationId) {
        options.bizLocation = bizLocationId
      }
    }

    const bizStep = this.extractTag(xml, 'bizStep')
    if (bizStep) {
      options.why = bizStep
    }

    const disposition = this.extractTag(xml, 'disposition')
    if (disposition) {
      options.how = disposition
    }

    return new TransactionEvent(options)
  }

  private parseTransformationEvent(xml: string): TransformationEvent {
    const eventTime = this.extractTag(xml, 'eventTime')
    if (!eventTime) {
      throw new Error('Missing required eventTime')
    }

    const options: TransformationEventOptions = {
      inputEPCList: this.extractEpcList(xml, 'inputEPCList'),
      outputEPCList: this.extractEpcList(xml, 'outputEPCList'),
      when: new Date(eventTime),
    }

    const transformationID = this.extractTag(xml, 'transformationID')
    if (transformationID) {
      options.transformationID = transformationID
    }

    const eventTimeZoneOffset = this.extractTag(xml, 'eventTimeZoneOffset')
    if (eventTimeZoneOffset) {
      options.whenTimezoneOffset = eventTimeZoneOffset
    }

    const inputQuantityList = this.extractQuantityList(xml, 'inputQuantityList')
    if (inputQuantityList.length > 0) {
      options.inputQuantityList = inputQuantityList
    }

    const outputQuantityList = this.extractQuantityList(xml, 'outputQuantityList')
    if (outputQuantityList.length > 0) {
      options.outputQuantityList = outputQuantityList
    }

    const readPointContent = this.extractTag(xml, 'readPoint')
    if (readPointContent) {
      const readPointId = this.extractTag(readPointContent, 'id')
      if (readPointId) {
        options.where = readPointId
      }
    }

    const bizLocationContent = this.extractTag(xml, 'bizLocation')
    if (bizLocationContent) {
      const bizLocationId = this.extractTag(bizLocationContent, 'id')
      if (bizLocationId) {
        options.bizLocation = bizLocationId
      }
    }

    const bizStep = this.extractTag(xml, 'bizStep')
    if (bizStep) {
      options.why = bizStep
    }

    const disposition = this.extractTag(xml, 'disposition')
    if (disposition) {
      options.how = disposition
    }

    return new TransformationEvent(options)
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * EPCIS Serializer factory
 */
export const EPCISSerializer = {
  /**
   * Create a serializer based on format option
   */
  create(options?: EPCISSerializerOptions): IEPCISSerializer {
    const format = options?.format ?? 'json-ld'

    switch (format) {
      case 'json-ld':
        return new EPCISJsonLdSerializer()
      case 'xml':
        return new EPCISXmlSerializer()
      default:
        throw new Error(`Unsupported format: ${format}`)
    }
  },

  /**
   * Create a serializer based on content type
   */
  fromContentType(contentType: string): IEPCISSerializer {
    // Extract just the MIME type (ignore charset, etc.)
    const mimeType = contentType.split(';')[0]!.trim().toLowerCase()

    if (mimeType === 'application/xml' || mimeType === 'text/xml') {
      return new EPCISXmlSerializer()
    }

    // Default to JSON-LD for JSON types and unknown types
    return new EPCISJsonLdSerializer()
  },
}
