/**
 * @dotdo/segment - Protocols (Schema Validation)
 *
 * Segment Protocols compatibility layer providing:
 * - Tracking Plan management for event schemas
 * - JSON Schema-based validation for events
 * - Property validation (required, type, enum, range)
 * - Format validation (email, uri, date-time, uuid, etc.)
 * - Nested object property validation
 * - Violation tracking and reporting
 * - Violation persistence and export
 * - Event blocking and property sanitization
 * - Protocol middleware for Analytics integration
 *
 * @module @dotdo/segment/protocols
 */

import type { SegmentEvent, SourceMiddleware } from './types.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Property types supported in schemas
 */
export type PropertyType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null' | 'any'

/**
 * Schema definition for a single property
 */
export interface PropertySchema {
  /** Property type */
  type: PropertyType
  /** Whether the property is required */
  required?: boolean
  /** Description of the property */
  description?: string
  /** Allowed enum values (for strings/numbers) */
  enum?: (string | number)[]
  /** Minimum value (for numbers) */
  minimum?: number
  /** Maximum value (for numbers) */
  maximum?: number
  /** Minimum length (for strings) */
  minLength?: number
  /** Maximum length (for strings) */
  maxLength?: number
  /** Regex pattern (for strings) */
  pattern?: string
  /** Minimum items (for arrays) */
  minItems?: number
  /** Maximum items (for arrays) */
  maxItems?: number
  /** Format hint (e.g., 'email', 'uri', 'date-time') */
  format?: string
  /** Default value */
  default?: unknown
  /** Nested properties (for objects) */
  properties?: Record<string, PropertySchema>
}

/**
 * Schema definition for an event
 */
export interface EventSchema {
  /** Event description */
  description?: string
  /** Property schemas */
  properties: Record<string, PropertySchema>
  /** Labels/tags for the event */
  labels?: string[]
}

/**
 * Schema for identify calls
 */
export interface IdentifySchema {
  /** Trait schemas */
  traits: Record<string, PropertySchema>
}

/**
 * Schema for group calls
 */
export interface GroupSchema {
  /** Trait schemas */
  traits: Record<string, PropertySchema>
}

/**
 * Tracking plan configuration
 */
export interface TrackingPlanConfig {
  /** Plan name */
  name: string
  /** Plan description */
  description?: string
  /** Event schemas by event name */
  events: Record<string, EventSchema>
  /** Identify call schema */
  identifySchema?: IdentifySchema
  /** Group call schema */
  groupSchema?: GroupSchema
  /** Version string */
  version?: string
  /** Created timestamp */
  createdAt?: string
  /** Updated timestamp */
  updatedAt?: string
}

/**
 * Supported format types for string validation
 */
export type FormatType =
  | 'email'
  | 'uri'
  | 'uri-reference'
  | 'date'
  | 'date-time'
  | 'time'
  | 'uuid'
  | 'hostname'
  | 'ipv4'
  | 'ipv6'
  | 'phone'

/**
 * Violation types
 */
export type ViolationType =
  | 'missing_required'
  | 'type_mismatch'
  | 'invalid_enum'
  | 'range_violation'
  | 'pattern_mismatch'
  | 'string_length'
  | 'array_length'
  | 'format_violation'
  | 'nested_property_violation'
  | 'unknown_event'
  | 'unknown_property'

/**
 * A schema violation
 */
export interface Violation {
  /** Violation type */
  type: ViolationType
  /** Property path that violated */
  property: string
  /** Event name (if applicable) */
  eventName?: string
  /** Message ID of the event */
  messageId?: string
  /** Human-readable message */
  message: string
  /** Expected value/type */
  expected?: string
  /** Actual value/type */
  actual?: string
  /** Timestamp of violation */
  timestamp: string
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether the event is valid */
  valid: boolean
  /** Whether the event should be blocked */
  blocked: boolean
  /** List of violations */
  violations: Violation[]
  /** Sanitized event (with invalid properties removed) */
  sanitizedEvent?: SegmentEvent
}

/**
 * Schema validator options
 */
export interface SchemaValidatorOptions {
  /** Allow events not in the tracking plan (default: true) */
  allowUnknownEvents?: boolean
  /** Allow properties not in the schema (default: true) */
  allowUnknownProperties?: boolean
  /** Block events with violations (default: false) */
  blockInvalidEvents?: boolean
  /** Remove invalid properties from events (default: false) */
  omitInvalidProperties?: boolean
  /** Callback when violations occur */
  onViolation?: (violation: Violation) => void
}

/**
 * Validation statistics
 */
export interface ValidationStats {
  /** Total events validated */
  totalValidated: number
  /** Valid event count */
  validCount: number
  /** Invalid event count */
  invalidCount: number
  /** Blocked event count */
  blockedCount: number
  /** Violations by type */
  violationsByType: Record<ViolationType, number>
  /** Violations by event name */
  violationsByEvent: Record<string, number>
}

// =============================================================================
// TrackingPlan Class
// =============================================================================

/**
 * Tracking Plan manages event schemas for validation.
 */
export class TrackingPlan {
  readonly name: string
  readonly description?: string
  readonly version?: string

  private events: Map<string, EventSchema> = new Map()
  private identifySchema?: IdentifySchema
  private groupSchema?: GroupSchema
  private createdAt: string
  private updatedAt: string

  constructor(config: TrackingPlanConfig) {
    this.name = config.name
    this.description = config.description
    this.version = config.version
    this.createdAt = config.createdAt || new Date().toISOString()
    this.updatedAt = config.updatedAt || this.createdAt

    // Load events
    for (const [name, schema] of Object.entries(config.events)) {
      this.events.set(name, schema)
    }

    // Load identify/group schemas
    this.identifySchema = config.identifySchema
    this.groupSchema = config.groupSchema
  }

  /**
   * Add an event schema.
   */
  addEvent(name: string, schema: EventSchema): void {
    this.events.set(name, schema)
    this.updatedAt = new Date().toISOString()
  }

  /**
   * Remove an event schema.
   */
  removeEvent(name: string): boolean {
    const result = this.events.delete(name)
    if (result) {
      this.updatedAt = new Date().toISOString()
    }
    return result
  }

  /**
   * Check if an event exists.
   */
  hasEvent(name: string): boolean {
    return this.events.has(name)
  }

  /**
   * Get an event schema.
   */
  getEventSchema(name: string): EventSchema | undefined {
    return this.events.get(name)
  }

  /**
   * Get all event names.
   */
  getEventNames(): string[] {
    return Array.from(this.events.keys())
  }

  /**
   * Get identify schema.
   */
  getIdentifySchema(): IdentifySchema | undefined {
    return this.identifySchema
  }

  /**
   * Set identify schema.
   */
  setIdentifySchema(schema: IdentifySchema): void {
    this.identifySchema = schema
    this.updatedAt = new Date().toISOString()
  }

  /**
   * Get group schema.
   */
  getGroupSchema(): GroupSchema | undefined {
    return this.groupSchema
  }

  /**
   * Set group schema.
   */
  setGroupSchema(schema: GroupSchema): void {
    this.groupSchema = schema
    this.updatedAt = new Date().toISOString()
  }

  /**
   * Export to JSON.
   */
  toJSON(): TrackingPlanConfig {
    return {
      name: this.name,
      description: this.description,
      version: this.version,
      events: Object.fromEntries(this.events),
      identifySchema: this.identifySchema,
      groupSchema: this.groupSchema,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    }
  }

  /**
   * Create from JSON.
   */
  static fromJSON(json: TrackingPlanConfig): TrackingPlan {
    return new TrackingPlan(json)
  }
}

// =============================================================================
// SchemaValidator Class
// =============================================================================

/**
 * Schema Validator validates events against a tracking plan.
 */
export class SchemaValidator {
  private readonly plan: TrackingPlan
  private readonly options: Required<SchemaValidatorOptions>
  private stats: ValidationStats

  constructor(plan: TrackingPlan, options?: SchemaValidatorOptions) {
    this.plan = plan
    this.options = {
      allowUnknownEvents: options?.allowUnknownEvents ?? true,
      allowUnknownProperties: options?.allowUnknownProperties ?? true,
      blockInvalidEvents: options?.blockInvalidEvents ?? false,
      omitInvalidProperties: options?.omitInvalidProperties ?? false,
      onViolation: options?.onViolation ?? (() => {}),
    }

    this.stats = this.createEmptyStats()
  }

  /**
   * Validate an event against the tracking plan.
   */
  validate(event: SegmentEvent): ValidationResult {
    const violations: Violation[] = []
    const timestamp = new Date().toISOString()

    // Validate based on event type
    switch (event.type) {
      case 'track':
        this.validateTrackEvent(event, violations, timestamp)
        break
      case 'identify':
        this.validateIdentifyEvent(event, violations, timestamp)
        break
      case 'group':
        this.validateGroupEvent(event, violations, timestamp)
        break
      // page, screen, alias - no validation needed by default
    }

    // Update statistics
    this.stats.totalValidated++
    const valid = violations.length === 0
    if (valid) {
      this.stats.validCount++
    } else {
      this.stats.invalidCount++
    }

    // Track violations
    for (const violation of violations) {
      // Update type stats
      this.stats.violationsByType[violation.type] =
        (this.stats.violationsByType[violation.type] || 0) + 1

      // Update event stats
      if (violation.eventName) {
        this.stats.violationsByEvent[violation.eventName] =
          (this.stats.violationsByEvent[violation.eventName] || 0) + 1
      }

      // Call violation callback
      this.options.onViolation(violation)
    }

    // Determine if blocked
    const blocked = !valid && this.options.blockInvalidEvents
    if (blocked) {
      this.stats.blockedCount++
    }

    // Create sanitized event if configured
    let sanitizedEvent: SegmentEvent | undefined
    if (this.options.omitInvalidProperties && !valid) {
      sanitizedEvent = this.sanitizeEvent(event, violations)
    }

    return {
      valid,
      blocked,
      violations,
      sanitizedEvent,
    }
  }

  /**
   * Get validation statistics.
   */
  getStats(): ValidationStats {
    return { ...this.stats }
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.stats = this.createEmptyStats()
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  private createEmptyStats(): ValidationStats {
    return {
      totalValidated: 0,
      validCount: 0,
      invalidCount: 0,
      blockedCount: 0,
      violationsByType: {} as Record<ViolationType, number>,
      violationsByEvent: {},
    }
  }

  private validateTrackEvent(
    event: SegmentEvent,
    violations: Violation[],
    timestamp: string
  ): void {
    const eventName = event.event
    if (!eventName) return

    // Check if event is in tracking plan
    const schema = this.plan.getEventSchema(eventName)
    if (!schema) {
      if (!this.options.allowUnknownEvents) {
        violations.push({
          type: 'unknown_event',
          property: '',
          eventName,
          messageId: event.messageId,
          message: `Event "${eventName}" is not defined in the tracking plan`,
          timestamp,
        })
      }
      return
    }

    // Validate properties
    this.validateProperties(
      event.properties || {},
      schema.properties,
      eventName,
      event.messageId,
      violations,
      timestamp
    )
  }

  private validateIdentifyEvent(
    event: SegmentEvent,
    violations: Violation[],
    timestamp: string
  ): void {
    const schema = this.plan.getIdentifySchema()
    if (!schema) return

    // Validate traits
    this.validateProperties(
      event.traits || {},
      schema.traits,
      'identify',
      event.messageId,
      violations,
      timestamp
    )
  }

  private validateGroupEvent(
    event: SegmentEvent,
    violations: Violation[],
    timestamp: string
  ): void {
    const schema = this.plan.getGroupSchema()
    if (!schema) return

    // Validate traits
    this.validateProperties(
      event.traits || {},
      schema.traits,
      'group',
      event.messageId,
      violations,
      timestamp
    )
  }

  private validateProperties(
    properties: Record<string, unknown>,
    schema: Record<string, PropertySchema>,
    eventName: string,
    messageId: string,
    violations: Violation[],
    timestamp: string
  ): void {
    // Check for required properties
    for (const [propName, propSchema] of Object.entries(schema)) {
      if (propSchema.required && !(propName in properties)) {
        violations.push({
          type: 'missing_required',
          property: propName,
          eventName,
          messageId,
          message: `Required property "${propName}" is missing`,
          expected: 'present',
          actual: 'missing',
          timestamp,
        })
      }
    }

    // Validate each provided property
    for (const [propName, value] of Object.entries(properties)) {
      const propSchema = schema[propName]

      // Check for unknown properties
      if (!propSchema) {
        if (!this.options.allowUnknownProperties) {
          violations.push({
            type: 'unknown_property',
            property: propName,
            eventName,
            messageId,
            message: `Property "${propName}" is not defined in the schema`,
            timestamp,
          })
        }
        continue
      }

      // Validate the property value
      this.validatePropertyValue(
        propName,
        value,
        propSchema,
        eventName,
        messageId,
        violations,
        timestamp
      )
    }
  }

  private validatePropertyValue(
    propName: string,
    value: unknown,
    schema: PropertySchema,
    eventName: string,
    messageId: string,
    violations: Violation[],
    timestamp: string
  ): void {
    // Skip validation if value is undefined/null and not required
    if (value === undefined || value === null) {
      return
    }

    // Type validation
    const actualType = this.getValueType(value)
    if (schema.type !== 'any' && actualType !== schema.type) {
      violations.push({
        type: 'type_mismatch',
        property: propName,
        eventName,
        messageId,
        message: `Property "${propName}" expected type "${schema.type}" but got "${actualType}"`,
        expected: schema.type,
        actual: actualType,
        timestamp,
      })
      return // Don't continue validating if type is wrong
    }

    // Enum validation
    if (schema.enum && !schema.enum.includes(value as string | number)) {
      violations.push({
        type: 'invalid_enum',
        property: propName,
        eventName,
        messageId,
        message: `Property "${propName}" value "${value}" is not in allowed values: ${schema.enum.join(', ')}`,
        expected: schema.enum.join(', '),
        actual: String(value),
        timestamp,
      })
    }

    // Number range validation
    if (schema.type === 'number') {
      const numValue = value as number
      if (schema.minimum !== undefined && numValue < schema.minimum) {
        violations.push({
          type: 'range_violation',
          property: propName,
          eventName,
          messageId,
          message: `Property "${propName}" value ${numValue} is below minimum ${schema.minimum}`,
          expected: `>= ${schema.minimum}`,
          actual: String(numValue),
          timestamp,
        })
      }
      if (schema.maximum !== undefined && numValue > schema.maximum) {
        violations.push({
          type: 'range_violation',
          property: propName,
          eventName,
          messageId,
          message: `Property "${propName}" value ${numValue} is above maximum ${schema.maximum}`,
          expected: `<= ${schema.maximum}`,
          actual: String(numValue),
          timestamp,
        })
      }
    }

    // String validations
    if (schema.type === 'string') {
      const strValue = value as string

      // Length validation
      if (schema.minLength !== undefined && strValue.length < schema.minLength) {
        violations.push({
          type: 'string_length',
          property: propName,
          eventName,
          messageId,
          message: `Property "${propName}" length ${strValue.length} is below minimum ${schema.minLength}`,
          expected: `length >= ${schema.minLength}`,
          actual: String(strValue.length),
          timestamp,
        })
      }
      if (schema.maxLength !== undefined && strValue.length > schema.maxLength) {
        violations.push({
          type: 'string_length',
          property: propName,
          eventName,
          messageId,
          message: `Property "${propName}" length ${strValue.length} is above maximum ${schema.maxLength}`,
          expected: `length <= ${schema.maxLength}`,
          actual: String(strValue.length),
          timestamp,
        })
      }

      // Pattern validation
      if (schema.pattern) {
        const regex = new RegExp(schema.pattern)
        if (!regex.test(strValue)) {
          violations.push({
            type: 'pattern_mismatch',
            property: propName,
            eventName,
            messageId,
            message: `Property "${propName}" value "${strValue}" does not match pattern "${schema.pattern}"`,
            expected: schema.pattern,
            actual: strValue,
            timestamp,
          })
        }
      }

      // Format validation
      if (schema.format) {
        const formatError = this.validateFormat(strValue, schema.format)
        if (formatError) {
          violations.push({
            type: 'format_violation',
            property: propName,
            eventName,
            messageId,
            message: `Property "${propName}" value "${strValue}" does not match format "${schema.format}": ${formatError}`,
            expected: schema.format,
            actual: strValue,
            timestamp,
          })
        }
      }
    }

    // Nested object property validation
    if (schema.type === 'object' && schema.properties && typeof value === 'object' && value !== null) {
      const nestedObj = value as Record<string, unknown>
      for (const [nestedPropName, nestedSchema] of Object.entries(schema.properties)) {
        const nestedPath = `${propName}.${nestedPropName}`

        // Check required nested properties
        if (nestedSchema.required && !(nestedPropName in nestedObj)) {
          violations.push({
            type: 'nested_property_violation',
            property: nestedPath,
            eventName,
            messageId,
            message: `Required nested property "${nestedPath}" is missing`,
            expected: 'present',
            actual: 'missing',
            timestamp,
          })
          continue
        }

        // Recursively validate nested property if present
        if (nestedPropName in nestedObj) {
          this.validatePropertyValue(
            nestedPath,
            nestedObj[nestedPropName],
            nestedSchema,
            eventName,
            messageId,
            violations,
            timestamp
          )
        }
      }
    }

    // Array validations
    if (schema.type === 'array' && Array.isArray(value)) {
      const arrValue = value as unknown[]

      if (schema.minItems !== undefined && arrValue.length < schema.minItems) {
        violations.push({
          type: 'array_length',
          property: propName,
          eventName,
          messageId,
          message: `Property "${propName}" has ${arrValue.length} items, minimum is ${schema.minItems}`,
          expected: `>= ${schema.minItems} items`,
          actual: `${arrValue.length} items`,
          timestamp,
        })
      }
      if (schema.maxItems !== undefined && arrValue.length > schema.maxItems) {
        violations.push({
          type: 'array_length',
          property: propName,
          eventName,
          messageId,
          message: `Property "${propName}" has ${arrValue.length} items, maximum is ${schema.maxItems}`,
          expected: `<= ${schema.maxItems} items`,
          actual: `${arrValue.length} items`,
          timestamp,
        })
      }
    }
  }

  private getValueType(value: unknown): PropertyType {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    if (typeof value === 'object') return 'object'
    if (typeof value === 'string') return 'string'
    if (typeof value === 'number') return 'number'
    if (typeof value === 'boolean') return 'boolean'
    return 'any'
  }

  /**
   * Validate string format.
   * Returns error message if invalid, undefined if valid.
   */
  private validateFormat(value: string, format: string): string | undefined {
    switch (format) {
      case 'email': {
        // RFC 5322 simplified email pattern
        const emailPattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
        if (!emailPattern.test(value)) {
          return 'invalid email format'
        }
        break
      }
      case 'uri': {
        try {
          const url = new URL(value)
          // Must have scheme (http/https)
          if (!url.protocol || !['http:', 'https:', 'ftp:', 'mailto:'].includes(url.protocol)) {
            return 'missing or invalid URI scheme'
          }
        } catch {
          return 'invalid URI format'
        }
        break
      }
      case 'uri-reference': {
        // More lenient - can be relative
        if (value.includes('://')) {
          try {
            new URL(value)
          } catch {
            return 'invalid URI reference format'
          }
        }
        break
      }
      case 'date': {
        // ISO 8601 date (YYYY-MM-DD)
        const datePattern = /^\d{4}-\d{2}-\d{2}$/
        if (!datePattern.test(value)) {
          return 'invalid date format (expected YYYY-MM-DD)'
        }
        const date = new Date(value)
        if (isNaN(date.getTime())) {
          return 'invalid date value'
        }
        break
      }
      case 'date-time': {
        // ISO 8601 date-time
        const date = new Date(value)
        if (isNaN(date.getTime())) {
          return 'invalid date-time format'
        }
        break
      }
      case 'time': {
        // ISO 8601 time (HH:MM:SS or HH:MM:SS.sss)
        const timePattern = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/
        if (!timePattern.test(value)) {
          return 'invalid time format (expected HH:MM:SS)'
        }
        break
      }
      case 'uuid': {
        // UUID v4 pattern
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        if (!uuidPattern.test(value)) {
          return 'invalid UUID format'
        }
        break
      }
      case 'hostname': {
        // RFC 1123 hostname
        const hostnamePattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
        if (!hostnamePattern.test(value) || value.length > 253) {
          return 'invalid hostname format'
        }
        break
      }
      case 'ipv4': {
        const ipv4Pattern = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})$/
        if (!ipv4Pattern.test(value)) {
          return 'invalid IPv4 address format'
        }
        break
      }
      case 'ipv6': {
        // Simplified IPv6 pattern
        const ipv6Pattern = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,7}:$|^(?:[0-9a-fA-F]{1,4}:){0,6}::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}$/
        if (!ipv6Pattern.test(value)) {
          return 'invalid IPv6 address format'
        }
        break
      }
      case 'phone': {
        // E.164 phone number format
        const phonePattern = /^\+?[1-9]\d{1,14}$/
        const cleaned = value.replace(/[\s\-().]/g, '')
        if (!phonePattern.test(cleaned)) {
          return 'invalid phone number format'
        }
        break
      }
      default:
        // Unknown format - skip validation
        break
    }
    return undefined
  }

  private sanitizeEvent(event: SegmentEvent, violations: Violation[]): SegmentEvent {
    // Get property names with violations
    const invalidProps = new Set(
      violations
        .filter((v) => v.type === 'type_mismatch' || v.type === 'unknown_property')
        .map((v) => v.property)
    )

    // Create sanitized properties
    const sanitizedProperties: Record<string, unknown> = {}
    if (event.properties) {
      for (const [key, value] of Object.entries(event.properties)) {
        if (!invalidProps.has(key)) {
          sanitizedProperties[key] = value
        }
      }
    }

    // Create sanitized traits
    const sanitizedTraits: Record<string, unknown> = {}
    if (event.traits) {
      for (const [key, value] of Object.entries(event.traits)) {
        if (!invalidProps.has(key)) {
          sanitizedTraits[key] = value
        }
      }
    }

    return {
      ...event,
      properties: Object.keys(sanitizedProperties).length > 0 ? sanitizedProperties : undefined,
      traits: Object.keys(sanitizedTraits).length > 0 ? sanitizedTraits : undefined,
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a tracking plan.
 */
export function createTrackingPlan(config: TrackingPlanConfig): TrackingPlan {
  return new TrackingPlan(config)
}

/**
 * Create a schema validator.
 */
export function createSchemaValidator(
  plan: TrackingPlan,
  options?: SchemaValidatorOptions
): SchemaValidator {
  return new SchemaValidator(plan, options)
}

// =============================================================================
// Violation Store
// =============================================================================

/**
 * Options for violation store
 */
export interface ViolationStoreOptions {
  /** Maximum violations to store (default: 10000) */
  maxViolations?: number
  /** Retention period in ms (default: 7 days) */
  retentionPeriod?: number
  /** Group violations by event name */
  groupByEvent?: boolean
}

/**
 * Violation summary for reporting
 */
export interface ViolationSummary {
  /** Total violation count */
  total: number
  /** Violations by type */
  byType: Record<ViolationType, number>
  /** Violations by event name */
  byEvent: Record<string, number>
  /** Most common violations */
  topViolations: Array<{
    type: ViolationType
    property: string
    eventName?: string
    count: number
  }>
  /** First violation timestamp */
  firstSeen?: string
  /** Last violation timestamp */
  lastSeen?: string
}

/**
 * Export format for violations
 */
export interface ViolationExport {
  /** Export timestamp */
  exportedAt: string
  /** Tracking plan name */
  trackingPlan: string
  /** Summary statistics */
  summary: ViolationSummary
  /** All violations (if includeDetails is true) */
  violations?: Violation[]
}

/**
 * Violation Store for persisting and analyzing violations.
 */
export class ViolationStore {
  private readonly violations: Violation[] = []
  private readonly options: Required<ViolationStoreOptions>
  private readonly violationCounts: Map<string, number> = new Map()

  constructor(options?: ViolationStoreOptions) {
    this.options = {
      maxViolations: options?.maxViolations ?? 10000,
      retentionPeriod: options?.retentionPeriod ?? 7 * 24 * 60 * 60 * 1000, // 7 days
      groupByEvent: options?.groupByEvent ?? true,
    }
  }

  /**
   * Add a violation to the store.
   */
  add(violation: Violation): void {
    // Check retention and max limits
    this.pruneExpired()

    if (this.violations.length >= this.options.maxViolations) {
      // Remove oldest violations
      this.violations.splice(0, Math.floor(this.options.maxViolations * 0.1))
    }

    this.violations.push(violation)

    // Update count for grouping
    const key = this.getViolationKey(violation)
    this.violationCounts.set(key, (this.violationCounts.get(key) || 0) + 1)
  }

  /**
   * Add multiple violations.
   */
  addBatch(violations: Violation[]): void {
    for (const violation of violations) {
      this.add(violation)
    }
  }

  /**
   * Get all stored violations.
   */
  getAll(): Violation[] {
    this.pruneExpired()
    return [...this.violations]
  }

  /**
   * Get violations for a specific event.
   */
  getByEvent(eventName: string): Violation[] {
    this.pruneExpired()
    return this.violations.filter((v) => v.eventName === eventName)
  }

  /**
   * Get violations by type.
   */
  getByType(type: ViolationType): Violation[] {
    this.pruneExpired()
    return this.violations.filter((v) => v.type === type)
  }

  /**
   * Get summary statistics.
   */
  getSummary(): ViolationSummary {
    this.pruneExpired()

    const byType: Record<string, number> = {}
    const byEvent: Record<string, number> = {}
    let firstSeen: string | undefined
    let lastSeen: string | undefined

    for (const v of this.violations) {
      byType[v.type] = (byType[v.type] || 0) + 1

      if (v.eventName) {
        byEvent[v.eventName] = (byEvent[v.eventName] || 0) + 1
      }

      if (!firstSeen || v.timestamp < firstSeen) {
        firstSeen = v.timestamp
      }
      if (!lastSeen || v.timestamp > lastSeen) {
        lastSeen = v.timestamp
      }
    }

    // Get top violations
    const topViolations = Array.from(this.violationCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, count]) => {
        const [type, property, eventName] = key.split('|')
        return {
          type: type as ViolationType,
          property: property || '',
          eventName: eventName || undefined,
          count,
        }
      })

    return {
      total: this.violations.length,
      byType: byType as Record<ViolationType, number>,
      byEvent,
      topViolations,
      firstSeen,
      lastSeen,
    }
  }

  /**
   * Export violations for reporting.
   */
  export(trackingPlanName: string, includeDetails = false): ViolationExport {
    return {
      exportedAt: new Date().toISOString(),
      trackingPlan: trackingPlanName,
      summary: this.getSummary(),
      violations: includeDetails ? this.getAll() : undefined,
    }
  }

  /**
   * Clear all violations.
   */
  clear(): void {
    this.violations.length = 0
    this.violationCounts.clear()
  }

  /**
   * Get violation count.
   */
  get count(): number {
    return this.violations.length
  }

  private getViolationKey(violation: Violation): string {
    return `${violation.type}|${violation.property}|${violation.eventName || ''}`
  }

  private pruneExpired(): void {
    const cutoff = new Date(Date.now() - this.options.retentionPeriod).toISOString()
    let pruneCount = 0

    for (let i = 0; i < this.violations.length; i++) {
      const v = this.violations[i]
      if (v && v.timestamp < cutoff) {
        pruneCount++
        // Decrement count
        const key = this.getViolationKey(v)
        const count = this.violationCounts.get(key) || 0
        if (count <= 1) {
          this.violationCounts.delete(key)
        } else {
          this.violationCounts.set(key, count - 1)
        }
      } else {
        break // Violations are in order, so we can stop early
      }
    }

    if (pruneCount > 0) {
      this.violations.splice(0, pruneCount)
    }
  }
}

/**
 * Create a violation store.
 */
export function createViolationStore(options?: ViolationStoreOptions): ViolationStore {
  return new ViolationStore(options)
}

// =============================================================================
// Protocol Middleware
// =============================================================================

/**
 * Options for protocol middleware
 */
export interface ProtocolMiddlewareOptions extends SchemaValidatorOptions {
  /** Violation store for persistence */
  violationStore?: ViolationStore
  /** Log violations to console */
  logViolations?: boolean
}

/**
 * Create a source middleware that validates events against a tracking plan.
 * Can be used with Analytics.addSourceMiddleware() for automatic validation.
 *
 * @example
 * ```typescript
 * const plan = createTrackingPlan(myTrackingPlanConfig)
 * const middleware = createProtocolMiddleware(plan, {
 *   blockInvalidEvents: true,
 *   logViolations: true,
 * })
 *
 * analytics.addSourceMiddleware(middleware)
 * ```
 */
export function createProtocolMiddleware(
  plan: TrackingPlan,
  options?: ProtocolMiddlewareOptions
): SourceMiddleware {
  const validator = new SchemaValidator(plan, options)
  const violationStore = options?.violationStore
  const logViolations = options?.logViolations ?? false

  return (event: SegmentEvent): SegmentEvent | null => {
    const result = validator.validate(event)

    // Store violations if store provided
    if (violationStore && result.violations.length > 0) {
      violationStore.addBatch(result.violations)
    }

    // Log violations if enabled
    if (logViolations && result.violations.length > 0) {
      console.warn(
        `[Segment Protocols] Event "${event.event || event.type}" has ${result.violations.length} violation(s):`,
        result.violations.map((v) => `${v.type}: ${v.message}`).join(', ')
      )
    }

    // Block invalid events if configured
    if (result.blocked) {
      return null
    }

    // Return sanitized event if available, otherwise original
    return result.sanitizedEvent || event
  }
}

/**
 * Get the validator's current statistics.
 * Utility function for accessing stats from middleware context.
 */
export function createValidatorWithStore(
  plan: TrackingPlan,
  options?: SchemaValidatorOptions
): { validator: SchemaValidator; store: ViolationStore } {
  const store = new ViolationStore()
  const validator = new SchemaValidator(plan, {
    ...options,
    onViolation: (violation) => {
      store.add(violation)
      options?.onViolation?.(violation)
    },
  })

  return { validator, store }
}

// =============================================================================
// Built-in Event Schemas
// =============================================================================

/**
 * E-commerce tracking plan with common events.
 */
export const ecommerceTrackingPlan: TrackingPlanConfig = {
  name: 'E-commerce Tracking Plan',
  description: 'Standard e-commerce event schemas based on Segment E-commerce Spec',
  version: '1.0.0',
  events: {
    'Products Searched': {
      description: 'User searched for products',
      properties: {
        query: { type: 'string', required: true, description: 'Search query' },
      },
    },
    'Product List Viewed': {
      description: 'User viewed a product list or category',
      properties: {
        list_id: { type: 'string', description: 'List or category ID' },
        category: { type: 'string', description: 'Category name' },
        products: { type: 'array', description: 'List of products' },
      },
    },
    'Product Clicked': {
      description: 'User clicked on a product',
      properties: {
        product_id: { type: 'string', required: true },
        sku: { type: 'string' },
        name: { type: 'string', required: true },
        price: { type: 'number', minimum: 0 },
        category: { type: 'string' },
        position: { type: 'number', minimum: 0 },
      },
    },
    'Product Viewed': {
      description: 'User viewed a product detail page',
      properties: {
        product_id: { type: 'string', required: true },
        sku: { type: 'string' },
        name: { type: 'string', required: true },
        price: { type: 'number', minimum: 0 },
        category: { type: 'string' },
        brand: { type: 'string' },
        variant: { type: 'string' },
      },
    },
    'Product Added': {
      description: 'User added a product to cart',
      properties: {
        cart_id: { type: 'string' },
        product_id: { type: 'string', required: true },
        sku: { type: 'string' },
        name: { type: 'string', required: true },
        price: { type: 'number', minimum: 0, required: true },
        quantity: { type: 'number', minimum: 1, required: true },
        category: { type: 'string' },
      },
    },
    'Product Removed': {
      description: 'User removed a product from cart',
      properties: {
        cart_id: { type: 'string' },
        product_id: { type: 'string', required: true },
        sku: { type: 'string' },
        name: { type: 'string', required: true },
        price: { type: 'number', minimum: 0 },
        quantity: { type: 'number', minimum: 1 },
      },
    },
    'Cart Viewed': {
      description: 'User viewed their cart',
      properties: {
        cart_id: { type: 'string' },
        products: { type: 'array', required: true },
      },
    },
    'Checkout Started': {
      description: 'User started the checkout process',
      properties: {
        order_id: { type: 'string' },
        affiliation: { type: 'string' },
        value: { type: 'number', minimum: 0, required: true },
        revenue: { type: 'number', minimum: 0 },
        shipping: { type: 'number', minimum: 0 },
        tax: { type: 'number', minimum: 0 },
        discount: { type: 'number', minimum: 0 },
        coupon: { type: 'string' },
        currency: { type: 'string' },
        products: { type: 'array', required: true },
      },
    },
    'Order Completed': {
      description: 'User completed an order',
      properties: {
        order_id: { type: 'string', required: true },
        affiliation: { type: 'string' },
        total: { type: 'number', minimum: 0, required: true },
        revenue: { type: 'number', minimum: 0 },
        shipping: { type: 'number', minimum: 0 },
        tax: { type: 'number', minimum: 0 },
        discount: { type: 'number', minimum: 0 },
        coupon: { type: 'string' },
        currency: { type: 'string' },
        products: { type: 'array', required: true, minItems: 1 },
      },
    },
    'Order Refunded': {
      description: 'An order was refunded',
      properties: {
        order_id: { type: 'string', required: true },
        total: { type: 'number', minimum: 0, required: true },
        products: { type: 'array' },
      },
    },
  },
  identifySchema: {
    traits: {
      email: { type: 'string', required: true, format: 'email' },
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      phone: { type: 'string' },
    },
  },
}

/**
 * SaaS tracking plan with common events.
 */
export const saasTrackingPlan: TrackingPlanConfig = {
  name: 'SaaS Tracking Plan',
  description: 'Standard SaaS product event schemas',
  version: '1.0.0',
  events: {
    'Signed Up': {
      description: 'User signed up for an account',
      properties: {
        plan: { type: 'string' },
        source: { type: 'string' },
        referrer: { type: 'string' },
      },
    },
    'Signed In': {
      description: 'User signed into their account',
      properties: {
        method: { type: 'string', enum: ['email', 'google', 'github', 'sso'] },
      },
    },
    'Signed Out': {
      description: 'User signed out of their account',
      properties: {},
    },
    'Trial Started': {
      description: 'User started a trial',
      properties: {
        plan: { type: 'string', required: true },
        trial_end_date: { type: 'string' },
      },
    },
    'Trial Ended': {
      description: 'User trial ended',
      properties: {
        plan: { type: 'string', required: true },
        converted: { type: 'boolean', required: true },
      },
    },
    'Account Created': {
      description: 'A new account/workspace was created',
      properties: {
        account_name: { type: 'string', required: true },
        plan: { type: 'string' },
      },
    },
    'Account Deleted': {
      description: 'An account was deleted',
      properties: {
        account_name: { type: 'string', required: true },
        reason: { type: 'string' },
      },
    },
    'Invite Sent': {
      description: 'User sent an invite',
      properties: {
        invitee_email: { type: 'string', required: true },
        role: { type: 'string' },
      },
    },
    'Invite Accepted': {
      description: 'An invite was accepted',
      properties: {
        inviter_id: { type: 'string' },
      },
    },
    'Subscription Created': {
      description: 'User subscribed to a plan',
      properties: {
        plan: { type: 'string', required: true },
        billing_cycle: { type: 'string', enum: ['monthly', 'annual'] },
        mrr: { type: 'number', minimum: 0 },
      },
    },
    'Subscription Cancelled': {
      description: 'User cancelled their subscription',
      properties: {
        plan: { type: 'string', required: true },
        reason: { type: 'string' },
        mrr_loss: { type: 'number', minimum: 0 },
      },
    },
    'Subscription Upgraded': {
      description: 'User upgraded their subscription',
      properties: {
        previous_plan: { type: 'string', required: true },
        new_plan: { type: 'string', required: true },
        mrr_change: { type: 'number' },
      },
    },
    'Subscription Downgraded': {
      description: 'User downgraded their subscription',
      properties: {
        previous_plan: { type: 'string', required: true },
        new_plan: { type: 'string', required: true },
        mrr_change: { type: 'number' },
      },
    },
    'Feature Used': {
      description: 'User used a specific feature',
      properties: {
        feature_name: { type: 'string', required: true },
        feature_category: { type: 'string' },
      },
    },
  },
  identifySchema: {
    traits: {
      email: { type: 'string', required: true, format: 'email' },
      name: { type: 'string' },
      company: { type: 'string' },
      plan: { type: 'string' },
      createdAt: { type: 'string' },
    },
  },
  groupSchema: {
    traits: {
      name: { type: 'string', required: true },
      industry: { type: 'string' },
      employees: { type: 'number', minimum: 1 },
      plan: { type: 'string' },
      mrr: { type: 'number', minimum: 0 },
    },
  },
}
