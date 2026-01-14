/**
 * EventSchema - 5W+H Schema Validation with Extensible Dimensions
 *
 * Provides comprehensive validation and introspection for business events
 * following the 5W+H paradigm (What, When, Where, Why, Who, How) extended
 * from EPCIS for digital business events.
 *
 * Features:
 * - Core 5W+H field validation with TypeScript types
 * - Digital extensions (session, device, channel, actor type, confidence)
 * - Extensibility mechanism for custom dimensions
 * - Schema validation (Zod-compatible patterns)
 * - Type-safe accessors and introspection
 *
 * @module db/primitives/business-event-store/event-schema
 */

import type { BusinessEvent, ActorType, ChannelType, EventType, EventAction } from './index'

// =============================================================================
// Schema Type Definitions
// =============================================================================

/**
 * Complete 5W+H Schema definition
 */
export interface FiveWHSchema {
  what: WhatSchema
  when: WhenSchema
  where: WhereSchema
  why: WhySchema
  who: WhoSchema
  how: HowSchema
}

/**
 * What (Object/Entity) schema definition
 */
export interface WhatSchema {
  required: boolean
  types: ('epc' | 'urn' | 'custom' | 'uuid')[]
  allowQuantityOnly: boolean
}

/**
 * When (Timestamp) schema definition
 */
export interface WhenSchema {
  required: boolean
  precision: 'second' | 'millisecond' | 'microsecond'
  timezoneRequired: boolean
}

/**
 * Where (Location/Context) schema definition
 */
export interface WhereSchema {
  required: boolean
  types: ('gln' | 'sgln' | 'custom')[]
  allowBizLocation: boolean
}

/**
 * Why (Business Step/Reason) schema definition
 */
export interface WhySchema {
  required: boolean
  allowCbvUrn: boolean
  allowCustom: boolean
}

/**
 * Who (Parties) schema definition
 */
export interface WhoSchema {
  required: boolean
  actorTypes: ActorType[]
  confidenceRequired: boolean
}

/**
 * How (Method/Disposition) schema definition
 */
export interface HowSchema {
  required: boolean
  allowDisposition: boolean
  allowChannel: boolean
  channelTypes: ChannelType[]
}

/**
 * Validation result for a single dimension
 */
export interface DimensionValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Complete event validation result
 */
export interface EventValidationResult {
  valid: boolean
  dimensions: {
    what: DimensionValidationResult
    when: DimensionValidationResult
    where: DimensionValidationResult
    why: DimensionValidationResult
    who: DimensionValidationResult
    how: DimensionValidationResult
  }
}

/**
 * Custom dimension schema definition
 */
export interface CustomDimensionSchema {
  required: boolean
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  validate?: (value: unknown) => boolean
  description?: string
}

/**
 * Schema version information
 */
export interface SchemaVersion {
  version: string
  compatible: string[]
}

// =============================================================================
// EPC URN Validation
// =============================================================================

/**
 * EPC URN patterns for validation
 * Supports SGTIN, SGLN, SSCC, GRAI, GIAI, PGLN, LGTIN (class-level)
 */
const EPC_URN_PATTERNS: Record<string, RegExp> = {
  sgtin: /^urn:epc:id:sgtin:(\d{6,12})\.(\d{1,7})\.(\w+)$/,
  sgln: /^urn:epc:id:sgln:(\d{6,12})\.(\d{1,6})\.(\w*)$/,
  sscc: /^urn:epc:id:sscc:(\d{6,12})\.(\d{1,17})$/,
  grai: /^urn:epc:id:grai:(\d{6,12})\.(\d{1,6})\.(\w+)$/,
  giai: /^urn:epc:id:giai:(\d{6,12})\.(\w+)$/,
  pgln: /^urn:epc:id:pgln:(\d{6,12})\.(\d{1,6})$/,
  lgtin: /^urn:epc:class:lgtin:(\d{6,12})\.(\d{1,7})\.(\w+)$/,
}

/**
 * UUID URN pattern
 */
const UUID_URN_PATTERN = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Validate EPC URN format
 */
export function validateEPC(epc: string): boolean {
  // Check for class-level EPC (lgtin)
  if (epc.startsWith('urn:epc:class:')) {
    const type = epc.split(':')[3]
    const pattern = EPC_URN_PATTERNS[type ?? '']
    return pattern ? pattern.test(epc) : false
  }

  // Check for instance-level EPC
  if (epc.startsWith('urn:epc:id:')) {
    const type = epc.split(':')[3]
    const pattern = EPC_URN_PATTERNS[type ?? '']
    return pattern ? pattern.test(epc) : false
  }

  return false
}

/**
 * Validate What field and determine identifier types
 */
export function validateWhatSchema(what: string[]): { valid: boolean; types: string[] } {
  const types = new Set<string>()
  let valid = true

  for (const identifier of what) {
    // Check for EPC URN
    if (identifier.startsWith('urn:epc:')) {
      if (validateEPC(identifier)) {
        types.add('epc')
      } else {
        valid = false
      }
    }
    // Check for UUID URN
    else if (identifier.startsWith('urn:uuid:')) {
      if (UUID_URN_PATTERN.test(identifier)) {
        types.add('uuid')
      } else {
        valid = false
      }
    }
    // Check for other URN formats
    else if (identifier.startsWith('urn:')) {
      types.add('urn')
    }
    // Custom identifier (any format with prefix:value)
    else if (identifier.includes(':')) {
      types.add('custom')
    }
    // Plain identifier
    else {
      types.add('custom')
    }
  }

  return { valid, types: Array.from(types) }
}

// =============================================================================
// Timestamp Validation
// =============================================================================

/**
 * Validate timestamp precision
 */
export function validateTimestampPrecision(date: Date): { precision: string; valid: boolean } {
  const iso = date.toISOString()

  // Check millisecond precision (has .XXX)
  if (/\.\d{3}Z$/.test(iso)) {
    const ms = date.getMilliseconds()
    if (ms > 0) {
      return { precision: 'millisecond', valid: true }
    }
    // Has milliseconds but they're 0 - could be second precision
    return { precision: 'second', valid: true }
  }

  return { precision: 'second', valid: true }
}

/**
 * Validate timezone offset format
 * Accepts: Z, +HH:MM, -HH:MM
 */
export function validateTimezoneOffset(offset: string): boolean {
  // UTC shorthand
  if (offset === 'Z') return true

  // +00:00 format
  const match = offset.match(/^([+-])(\d{2}):(\d{2})$/)
  if (!match) return false

  const hours = parseInt(match[2]!, 10)
  const minutes = parseInt(match[3]!, 10)

  // Valid hour range: 00-23
  if (hours < 0 || hours > 23) return false
  // Valid minute range: 00-59
  if (minutes < 0 || minutes > 59) return false

  return true
}

/**
 * Validate event timing (event time vs record time)
 */
export function validateEventTiming(event: BusinessEvent): {
  eventTime: Date
  recordTime: Date
  lag: number
} {
  return {
    eventTime: event.when,
    recordTime: event.recordTime,
    lag: event.recordTime.getTime() - event.when.getTime(),
  }
}

// =============================================================================
// Location Validation
// =============================================================================

/**
 * GLN pattern (13 digits)
 */
const GLN_PATTERN = /^\d{13}$/

/**
 * SGLN URN pattern
 */
const SGLN_URN_PATTERN = /^urn:epc:id:sgln:(\d{6,12})\.(\d{1,6})\.(\w*)$/

/**
 * Validate location identifier format
 */
export function validateLocation(location: string): { valid: boolean; type: string } {
  // SGLN URN
  if (SGLN_URN_PATTERN.test(location)) {
    return { valid: true, type: 'sgln' }
  }

  // GLN (13 digits)
  if (GLN_PATTERN.test(location)) {
    return { valid: true, type: 'gln' }
  }

  // Custom location (has prefix)
  if (location.includes(':')) {
    return { valid: true, type: 'custom' }
  }

  // Plain identifier - still valid as custom
  return { valid: true, type: 'custom' }
}

/**
 * Validate source/destination pairs
 */
export function validateSourceDest(
  sourceList: Array<{ type: string; value: string }>,
  destinationList: Array<{ type: string; value: string }>
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const validTypes = ['possessing_party', 'owning_party', 'location']

  for (const source of sourceList) {
    if (!validTypes.includes(source.type) && !source.type.startsWith('urn:')) {
      // Custom types are allowed
    }
    if (!source.value) {
      errors.push(`Source ${source.type} has empty value`)
    }
  }

  for (const dest of destinationList) {
    if (!dest.value) {
      errors.push(`Destination ${dest.type} has empty value`)
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Validate location semantics (read point vs business location)
 */
export function validateLocationSemantics(
  where: string | undefined,
  bizLocation: string | undefined
): {
  hasReadPoint: boolean
  hasBusinessLocation: boolean
  semanticallyValid: boolean
} {
  return {
    hasReadPoint: !!where,
    hasBusinessLocation: !!bizLocation,
    // Both can be present, or just one, or neither - all are valid
    semanticallyValid: true,
  }
}

// =============================================================================
// Business Step (Why) Validation
// =============================================================================

/**
 * CBV Business Step URN pattern
 */
const CBV_BIZSTEP_PATTERN = /^urn:epcglobal:cbv:bizstep:(\w+)$/

/**
 * Standard CBV business steps
 */
const CBV_BUSINESS_STEPS = [
  'accepting',
  'arriving',
  'assembling',
  'collecting',
  'commissioning',
  'consigning',
  'creating_class_instance',
  'cycle_counting',
  'decommissioning',
  'departing',
  'destroying',
  'disassembling',
  'dispensing',
  'encoding',
  'entering_exiting',
  'holding',
  'inspecting',
  'installing',
  'killing',
  'loading',
  'other',
  'packing',
  'picking',
  'receiving',
  'removing',
  'repackaging',
  'repairing',
  'replacing',
  'reserving',
  'retail_selling',
  'sampling',
  'sensor_reporting',
  'shipping',
  'staging_outbound',
  'stock_taking',
  'stocking',
  'storing',
  'transforming',
  'transporting',
  'unloading',
  'unpacking',
  'void_shipping',
]

/**
 * Business step categories
 */
const BUSINESS_STEP_CATEGORIES: Record<string, { category: 'supply_chain' | 'customer' | 'financial' | 'custom'; description: string }> = {
  shipping: { category: 'supply_chain', description: 'Shipping products' },
  receiving: { category: 'supply_chain', description: 'Receiving products' },
  storing: { category: 'supply_chain', description: 'Storing products' },
  packing: { category: 'supply_chain', description: 'Packing products' },
  unpacking: { category: 'supply_chain', description: 'Unpacking products' },
  customer_signup: { category: 'customer', description: 'Customer registration' },
  customer_login: { category: 'customer', description: 'Customer login' },
  customer_logout: { category: 'customer', description: 'Customer logout' },
  payment_processed: { category: 'financial', description: 'Payment processing' },
  payment_failed: { category: 'financial', description: 'Payment failure' },
  refund_issued: { category: 'financial', description: 'Refund issuance' },
  invoice_created: { category: 'financial', description: 'Invoice creation' },
}

/**
 * Validate business step (why)
 */
export function validateBusinessStep(step: string): { valid: boolean; isCbv: boolean } {
  // Check for CBV URN
  if (CBV_BIZSTEP_PATTERN.test(step)) {
    const match = step.match(CBV_BIZSTEP_PATTERN)
    const bizStep = match?.[1]
    return {
      valid: bizStep ? CBV_BUSINESS_STEPS.includes(bizStep) : false,
      isCbv: true,
    }
  }

  // Custom business steps are always valid
  return { valid: true, isCbv: false }
}

/**
 * Validate against allowed steps list
 */
export function validateAgainstAllowedSteps(step: string, allowedSteps: string[]): boolean {
  // Extract step name if it's a CBV URN
  if (CBV_BIZSTEP_PATTERN.test(step)) {
    const match = step.match(CBV_BIZSTEP_PATTERN)
    const bizStep = match?.[1]
    return bizStep ? allowedSteps.includes(bizStep) : false
  }

  return allowedSteps.includes(step)
}

/**
 * Categorize business step
 */
export function categorizeBusinessStep(step: string): {
  category: 'supply_chain' | 'customer' | 'financial' | 'custom'
  description: string
} {
  // Extract step name if it's a CBV URN
  let stepName = step
  if (CBV_BIZSTEP_PATTERN.test(step)) {
    const match = step.match(CBV_BIZSTEP_PATTERN)
    stepName = match?.[1] ?? step
  }

  const categorized = BUSINESS_STEP_CATEGORIES[stepName]
  if (categorized) {
    return categorized
  }

  return { category: 'custom', description: `Custom business step: ${stepName}` }
}

// =============================================================================
// Party (Who) Validation
// =============================================================================

/**
 * PGLN URN pattern
 */
const PGLN_URN_PATTERN = /^urn:epc:id:pgln:(\d{6,12})\.(\d{1,6})$/

/**
 * Party identifier patterns
 */
const PARTY_PATTERNS: Record<string, RegExp> = {
  pgln: PGLN_URN_PATTERN,
  user: /^user:(.+)$/,
  agent: /^agent:(.+)$/,
  system: /^system:(.+)$/,
  webhook: /^webhook:(.+)$/,
}

/**
 * Valid actor types
 */
const VALID_ACTOR_TYPES: ActorType[] = ['human', 'agent', 'system', 'webhook']

/**
 * Validate party identifier format
 */
export function validateParty(party: string): { valid: boolean; format: string } {
  for (const [format, pattern] of Object.entries(PARTY_PATTERNS)) {
    if (pattern.test(party)) {
      return { valid: true, format }
    }
  }

  // Generic identifier is valid
  return { valid: true, format: 'custom' }
}

/**
 * Validate actor type consistency with party format
 */
export function validateActorTypeConsistency(
  party: string,
  actorType: ActorType
): { consistent: boolean; expectedActorType: ActorType } {
  // Determine expected actor type from party format
  let expectedActorType: ActorType = 'human'

  if (party.startsWith('user:')) {
    expectedActorType = 'human'
  } else if (party.startsWith('agent:')) {
    expectedActorType = 'agent'
  } else if (party.startsWith('system:')) {
    expectedActorType = 'system'
  } else if (party.startsWith('webhook:')) {
    expectedActorType = 'webhook'
  } else if (PGLN_URN_PATTERN.test(party)) {
    // PGLN could be any type
    expectedActorType = actorType
  }

  return {
    consistent: actorType === expectedActorType,
    expectedActorType,
  }
}

/**
 * Validate confidence score for actors
 */
export function validateConfidence(
  actorType: ActorType,
  confidence: number | undefined
): { valid: boolean; required: boolean; error?: string } {
  // Agent actors require confidence
  const required = actorType === 'agent'

  if (required && confidence === undefined) {
    return { valid: false, required: true, error: 'Confidence required for agent actors' }
  }

  if (confidence !== undefined) {
    if (confidence < 0 || confidence > 1) {
      return { valid: false, required, error: 'Confidence must be between 0 and 1' }
    }
  }

  return { valid: true, required }
}

/**
 * Validate actor type
 */
export function validateActorType(actorType: string): boolean {
  return VALID_ACTOR_TYPES.includes(actorType as ActorType)
}

// =============================================================================
// Disposition (How) Validation
// =============================================================================

/**
 * CBV Disposition URN pattern
 */
const CBV_DISPOSITION_PATTERN = /^urn:epcglobal:cbv:disp:(\w+)$/

/**
 * Standard CBV dispositions
 */
const CBV_DISPOSITIONS = [
  'active',
  'available',
  'completeness_inferred',
  'completeness_verified',
  'container_closed',
  'container_open',
  'damaged',
  'destroyed',
  'dispensed',
  'disposed',
  'encoded',
  'expired',
  'in_progress',
  'in_transit',
  'inactive',
  'needs_replacement',
  'no_pedigree_match',
  'non_sellable_other',
  'partially_dispensed',
  'recalled',
  'reserved',
  'retail_sold',
  'returned',
  'sellable_accessible',
  'sellable_not_accessible',
  'stolen',
  'unknown',
]

/**
 * Standard channel types
 */
const STANDARD_CHANNELS: ChannelType[] = ['web', 'mobile', 'api', 'email', 'automation']

/**
 * Validate disposition
 */
export function validateDisposition(disposition: string): { valid: boolean; isCbv: boolean } {
  // Check for CBV URN
  if (CBV_DISPOSITION_PATTERN.test(disposition)) {
    const match = disposition.match(CBV_DISPOSITION_PATTERN)
    const disp = match?.[1]
    return {
      valid: disp ? CBV_DISPOSITIONS.includes(disp) : false,
      isCbv: true,
    }
  }

  // Custom dispositions are always valid
  return { valid: true, isCbv: false }
}

/**
 * Validate channel type
 */
export function validateChannel(channel: string): { valid: boolean; isStandard: boolean } {
  const isStandard = STANDARD_CHANNELS.includes(channel as ChannelType)
  return { valid: true, isStandard }
}

/**
 * Validate session ID format
 */
export function validateSessionId(sessionId: string): boolean {
  return sessionId.length > 0
}

/**
 * Validate device ID format
 */
export function validateDeviceId(deviceId: string): { valid: boolean; type: string } {
  if (!deviceId) {
    return { valid: false, type: 'unknown' }
  }

  // Extract type from prefix if present
  const colonIndex = deviceId.indexOf(':')
  if (colonIndex > 0) {
    const type = deviceId.substring(0, colonIndex)
    return { valid: true, type }
  }

  return { valid: true, type: 'custom' }
}

/**
 * Validate context object structure
 */
export function validateContext(context: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Context can contain any JSON-serializable data
  try {
    JSON.stringify(context)
  } catch {
    errors.push('Context must be JSON-serializable')
  }

  return { valid: errors.length === 0, errors }
}

// =============================================================================
// Schema Introspection
// =============================================================================

/**
 * Get What schema definition
 */
export function getWhatSchema(): WhatSchema {
  return {
    required: true,
    types: ['epc', 'urn', 'custom', 'uuid'],
    allowQuantityOnly: true,
  }
}

/**
 * Get When schema definition
 */
export function getWhenSchema(): WhenSchema {
  return {
    required: true,
    precision: 'millisecond',
    timezoneRequired: false,
  }
}

/**
 * Get Where schema definition
 */
export function getWhereSchema(): WhereSchema {
  return {
    required: false,
    types: ['gln', 'sgln', 'custom'],
    allowBizLocation: true,
  }
}

/**
 * Get Why schema definition
 */
export function getWhySchema(): WhySchema {
  return {
    required: false,
    allowCbvUrn: true,
    allowCustom: true,
  }
}

/**
 * Get Who schema definition
 */
export function getWhoSchema(): WhoSchema {
  return {
    required: false,
    actorTypes: ['human', 'agent', 'system', 'webhook'],
    confidenceRequired: false, // Only required for agents
  }
}

/**
 * Get How schema definition
 */
export function getHowSchema(): HowSchema {
  return {
    required: false,
    allowDisposition: true,
    allowChannel: true,
    channelTypes: ['web', 'mobile', 'api', 'email', 'automation'],
  }
}

/**
 * Get complete 5W+H schema definition
 */
export function getFiveWHSchema(): FiveWHSchema {
  return {
    what: getWhatSchema(),
    when: getWhenSchema(),
    where: getWhereSchema(),
    why: getWhySchema(),
    who: getWhoSchema(),
    how: getHowSchema(),
  }
}

// =============================================================================
// Complete Event Validation
// =============================================================================

/**
 * Validate complete event schema
 */
export function validateEventSchema(event: BusinessEvent): EventValidationResult {
  const dimensions: EventValidationResult['dimensions'] = {
    what: { valid: true, errors: [] },
    when: { valid: true, errors: [] },
    where: { valid: true, errors: [] },
    why: { valid: true, errors: [] },
    who: { valid: true, errors: [] },
    how: { valid: true, errors: [] },
  }

  // Validate What
  if (!event.what || (event.what.length === 0 && !event.quantityList?.length)) {
    dimensions.what = { valid: false, errors: ['What (or quantityList) is required'] }
  } else {
    const whatResult = validateWhatSchema(event.what)
    if (!whatResult.valid) {
      dimensions.what = { valid: false, errors: ['Invalid identifier format in what'] }
    }
  }

  // Validate When
  if (!event.when) {
    dimensions.when = { valid: false, errors: ['When is required'] }
  } else {
    if (event.whenTimezoneOffset && !validateTimezoneOffset(event.whenTimezoneOffset)) {
      dimensions.when = { valid: false, errors: ['Invalid timezone offset format'] }
    }
  }

  // Validate Where
  if (event.where) {
    const whereResult = validateLocation(event.where)
    if (!whereResult.valid) {
      dimensions.where = { valid: false, errors: ['Invalid location format'] }
    }
  }

  // Validate Why
  if (event.why) {
    const whyResult = validateBusinessStep(event.why)
    if (!whyResult.valid) {
      dimensions.why = { valid: false, errors: ['Invalid business step'] }
    }
  }

  // Validate Who
  if (event.who) {
    const whoResult = validateParty(event.who)
    if (!whoResult.valid) {
      dimensions.who = { valid: false, errors: ['Invalid party identifier'] }
    }

    // Check actor type consistency
    if (event.actorType) {
      if (!validateActorType(event.actorType)) {
        dimensions.who.valid = false
        dimensions.who.errors.push('Invalid actor type')
      } else {
        const consistency = validateActorTypeConsistency(event.who, event.actorType)
        if (!consistency.consistent) {
          dimensions.who.valid = false
          dimensions.who.errors.push(`Actor type ${event.actorType} inconsistent with party ${event.who}`)
        }
      }

      // Check confidence for agent actors
      const confidenceResult = validateConfidence(event.actorType, event.confidence)
      if (!confidenceResult.valid) {
        dimensions.who.valid = false
        dimensions.who.errors.push(confidenceResult.error ?? 'Invalid confidence')
      }
    }
  }

  // Validate How
  if (event.how) {
    const howResult = validateDisposition(event.how)
    if (!howResult.valid) {
      dimensions.how = { valid: false, errors: ['Invalid disposition'] }
    }
  }

  if (event.channel) {
    const channelResult = validateChannel(event.channel)
    if (!channelResult.valid) {
      dimensions.how.valid = false
      dimensions.how.errors.push('Invalid channel')
    }
  }

  if (event.sessionId !== undefined && event.sessionId !== null) {
    if (!validateSessionId(event.sessionId)) {
      dimensions.how.valid = false
      dimensions.how.errors.push('Invalid session ID')
    }
  }

  if (event.context) {
    const contextResult = validateContext(event.context)
    if (!contextResult.valid) {
      dimensions.how.valid = false
      dimensions.how.errors.push(...contextResult.errors)
    }
  }

  // Overall validity
  const valid = Object.values(dimensions).every((d) => d.valid)

  return { valid, dimensions }
}

/**
 * Validate event type schema requirements
 */
export function validateEventTypeSchema(eventType: string): {
  requiredDimensions: string[]
  optionalDimensions: string[]
} {
  const allDimensions = ['what', 'when', 'where', 'why', 'who', 'how']

  switch (eventType) {
    case 'ObjectEvent':
      return {
        requiredDimensions: ['what', 'when'],
        optionalDimensions: ['where', 'why', 'who', 'how'],
      }
    case 'AggregationEvent':
      return {
        requiredDimensions: ['when'], // parentID is also required but handled separately
        optionalDimensions: ['what', 'where', 'why', 'who', 'how'],
      }
    case 'TransactionEvent':
      return {
        requiredDimensions: ['when'], // bizTransactionList is also required
        optionalDimensions: ['what', 'where', 'why', 'who', 'how'],
      }
    case 'TransformationEvent':
      return {
        requiredDimensions: ['when'], // inputs/outputs are also required
        optionalDimensions: ['what', 'where', 'why', 'who', 'how'],
      }
    default:
      return {
        requiredDimensions: ['when'],
        optionalDimensions: allDimensions.filter((d) => d !== 'when'),
      }
  }
}

// =============================================================================
// Extensibility
// =============================================================================

/**
 * Registry for custom dimensions
 */
const customDimensionRegistry: Map<string, CustomDimensionSchema> = new Map()

/**
 * Register a custom dimension
 */
export function registerCustomDimension(name: string, schema: CustomDimensionSchema): boolean {
  if (customDimensionRegistry.has(name)) {
    return false // Already registered
  }
  customDimensionRegistry.set(name, schema)
  return true
}

/**
 * Get registered custom dimension
 */
export function getCustomDimension(name: string): CustomDimensionSchema | undefined {
  return customDimensionRegistry.get(name)
}

/**
 * Validate extension fields against registered schemas
 */
export function validateExtensions(extensions: Record<string, unknown>): {
  valid: boolean
  unrecognized: string[]
  invalid: string[]
} {
  const unrecognized: string[] = []
  const invalid: string[] = []

  for (const [key, value] of Object.entries(extensions)) {
    // Check if this is a namespaced extension (prefix:name)
    const colonIndex = key.indexOf(':')
    if (colonIndex === -1) {
      unrecognized.push(key)
      continue
    }

    const prefix = key.substring(0, colonIndex)
    const schema = customDimensionRegistry.get(prefix) || customDimensionRegistry.get(key)

    if (!schema) {
      // Unknown prefix - mark as unrecognized unless it's a known extension namespace
      const knownPrefixes = ['example', 'custom', 'cbv', 'epcis']
      if (!knownPrefixes.includes(prefix)) {
        unrecognized.push(key)
      }
    } else {
      // Validate against schema
      if (schema.validate && !schema.validate(value)) {
        invalid.push(key)
      }
    }
  }

  return {
    valid: invalid.length === 0,
    unrecognized,
    invalid,
  }
}

/**
 * Get schema version information
 */
export function getSchemaVersion(): SchemaVersion {
  return {
    version: '1.0.0',
    compatible: ['1.0.0'],
  }
}

// =============================================================================
// Type Safety Utilities
// =============================================================================

/**
 * Type mismatch detection result
 */
export interface TypeMismatch {
  field: string
  expected: string
  actual: string
}

/**
 * Detect type mismatches in an event-like object
 */
export function detectTypeMismatches(event: Record<string, unknown>): {
  mismatches: TypeMismatch[]
} {
  const mismatches: TypeMismatch[] = []

  // What should be array
  if (event.what !== undefined && !Array.isArray(event.what)) {
    mismatches.push({
      field: 'what',
      expected: 'array',
      actual: typeof event.what,
    })
  }

  // When should be Date
  if (event.when !== undefined && !(event.when instanceof Date)) {
    mismatches.push({
      field: 'when',
      expected: 'Date',
      actual: typeof event.when,
    })
  }

  // Action should be string
  if (event.action !== undefined && typeof event.action !== 'string') {
    mismatches.push({
      field: 'action',
      expected: 'string',
      actual: typeof event.action,
    })
  }

  // Confidence should be number
  if (event.confidence !== undefined && typeof event.confidence !== 'number') {
    mismatches.push({
      field: 'confidence',
      expected: 'number',
      actual: typeof event.confidence,
    })
  }

  return { mismatches }
}

/**
 * Coerce input to schema types
 */
export function coerceToSchema(input: Record<string, unknown>): BusinessEvent {
  const result: Partial<BusinessEvent> = { ...input } as Partial<BusinessEvent>

  // Coerce when to Date if it's a string
  if (typeof input.when === 'string') {
    result.when = new Date(input.when)
  }

  // Coerce recordTime to Date if it's a string
  if (typeof input.recordTime === 'string') {
    result.recordTime = new Date(input.recordTime)
  } else if (!input.recordTime) {
    result.recordTime = new Date()
  }

  // Ensure what is an array
  if (input.what && !Array.isArray(input.what)) {
    result.what = [String(input.what)]
  }

  // Generate ID if not present
  if (!result.id) {
    result.id = `evt_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`
  }

  // Default type
  if (!result.type) {
    result.type = 'ObjectEvent'
  }

  return result as BusinessEvent
}

/**
 * Enforce types at runtime with validation
 */
export function enforceTypes<T>(value: unknown, _schema: Record<string, unknown>): T {
  // For now, just return the value cast to T
  // A full implementation would validate against the schema
  return value as T
}
