/**
 * @dotdo/segment - Protocols (Schema Validation)
 *
 * Segment Protocols compatibility layer providing:
 * - Tracking Plan management for event schemas
 * - JSON Schema-based validation for events
 * - Property validation (required, type, enum, range)
 * - Violation tracking and reporting
 * - Event blocking and property sanitization
 *
 * @module @dotdo/segment/protocols
 */

import type { SegmentEvent } from './types.js'

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
