/**
 * Audit Entry Types and Validators - Type Stubs for TDD
 *
 * This file provides type definitions and class stubs for the audit entry schema.
 * All implementations throw errors until the GREEN phase.
 *
 * @see dotdo-1eo97 - [RED] Audit entry schema tests
 * @see dotdo-9xw2u - [PRIMITIVE] AuditLog - Immutable compliance and audit trail
 */

// =============================================================================
// ACTOR TYPES
// =============================================================================

/**
 * Represents who performed an action in the audit log.
 * One of: userId, serviceId, or system must be provided.
 */
export interface Actor {
  /** Human user identifier */
  userId?: string
  /** Service/API client identifier */
  serviceId?: string
  /** System-generated action marker */
  system?: boolean
  /** Display name for the actor */
  displayName?: string
  /** IP address of the actor */
  ipAddress?: string
}

export type ActorType = 'user' | 'service' | 'system'

// =============================================================================
// ACTION TYPES
// =============================================================================

/**
 * Standard CRUD actions plus custom action support
 */
export type StandardAction = 'create' | 'read' | 'update' | 'delete'

export interface Action {
  /** The action type */
  type: StandardAction | string
  /** Whether this is a custom (non-standard) action */
  isCustom?: boolean
  /** Custom action namespace for organization */
  namespace?: string
}

// =============================================================================
// RESOURCE TYPES
// =============================================================================

/**
 * The target resource of an audit action
 */
export interface Resource {
  /** Resource type (e.g., 'User', 'Order', 'Document') */
  type: string
  /** Unique identifier for the resource */
  id: string
  /** Hierarchical path to the resource (e.g., '/orgs/acme/projects/alpha') */
  path?: string
  /** Additional resource attributes */
  attributes?: Record<string, unknown>
}

// =============================================================================
// TIMESTAMP TYPES
// =============================================================================

/**
 * Timestamp information with timezone support
 */
export interface AuditTimestamp {
  /** ISO 8601 formatted timestamp */
  iso: string
  /** Unix timestamp in milliseconds */
  epochMs: number
  /** Original timezone if provided */
  timezone?: string
}

// =============================================================================
// STATE CAPTURE TYPES
// =============================================================================

/**
 * Captures before and after state for change tracking
 */
export interface StateCapture {
  /** State before the action */
  before?: Record<string, unknown>
  /** State after the action */
  after?: Record<string, unknown>
  /** JSON diff between before and after */
  diff?: JsonDiff
}

/**
 * JSON diff format for state changes
 */
export interface JsonDiff {
  /** Added fields */
  added: Record<string, unknown>
  /** Removed fields */
  removed: Record<string, unknown>
  /** Modified fields with old and new values */
  modified: Record<string, { old: unknown; new: unknown }>
}

// =============================================================================
// METADATA TYPES
// =============================================================================

/**
 * Additional context metadata for audit entries
 */
export interface AuditMetadata {
  /** IP address of the request origin */
  ipAddress?: string
  /** User agent string */
  userAgent?: string
  /** Unique request identifier for tracing */
  requestId?: string
  /** Session identifier */
  sessionId?: string
  /** Geographic location */
  geoLocation?: {
    country?: string
    region?: string
    city?: string
  }
  /** Custom metadata fields */
  custom?: Record<string, unknown>
}

// =============================================================================
// CORRELATION TYPES
// =============================================================================

/**
 * Event correlation for linking related audit entries
 */
export interface EventCorrelation {
  /** Correlation ID for grouping related events */
  correlationId: string
  /** Causation ID - the event that caused this one */
  causationId?: string
  /** Parent event ID for hierarchical relationships */
  parentId?: string
  /** Transaction or batch ID */
  transactionId?: string
}

// =============================================================================
// MASKING TYPES
// =============================================================================

/**
 * Configuration for sensitive field masking
 */
export interface MaskingConfig {
  /** Fields to mask (supports dot notation for nested fields) */
  fields: string[]
  /** Masking strategy */
  strategy: 'redact' | 'hash' | 'partial' | 'tokenize'
  /** Partial masking options */
  partialOptions?: {
    showFirst?: number
    showLast?: number
    maskChar?: string
  }
}

/**
 * Result of masking operation
 */
export interface MaskingResult {
  /** Masked data */
  masked: Record<string, unknown>
  /** List of fields that were masked */
  maskedFields: string[]
}

// =============================================================================
// AUDIT ENTRY TYPES
// =============================================================================

/**
 * Complete audit entry structure
 */
export interface AuditEntry {
  /** Unique entry identifier */
  id: string
  /** Actor who performed the action */
  actor: Actor
  /** Action performed */
  action: Action
  /** Target resource */
  resource: Resource
  /** Timestamp information */
  timestamp: AuditTimestamp
  /** State capture (before/after) */
  state?: StateCapture
  /** Additional metadata */
  metadata?: AuditMetadata
  /** Event correlation */
  correlation?: EventCorrelation
  /** Entry creation timestamp (for immutability verification) */
  createdAt: string
  /** Schema version for evolution */
  schemaVersion: number
}

/**
 * Input for creating a new audit entry
 */
export interface CreateAuditEntryInput {
  actor: Actor | string
  action: StandardAction | string | Action
  resource: Resource | { type: string; id: string }
  timestamp?: string | Date
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  metadata?: AuditMetadata
  correlation?: Partial<EventCorrelation>
  maskingConfig?: MaskingConfig
}

/**
 * Batch creation input
 */
export interface BatchCreateInput {
  entries: CreateAuditEntryInput[]
  /** Shared correlation ID for the batch */
  batchCorrelationId?: string
  /** Atomic batch - all or nothing */
  atomic?: boolean
}

/**
 * Batch creation result
 */
export interface BatchCreateResult {
  /** Successfully created entries */
  created: AuditEntry[]
  /** Failed entries with errors */
  failed: Array<{ input: CreateAuditEntryInput; error: string }>
  /** Whether the batch was atomic */
  atomic: boolean
  /** Batch correlation ID */
  batchCorrelationId: string
}

// =============================================================================
// ERROR TYPES
// =============================================================================

export class AuditValidationError extends Error {
  constructor(
    message: string,
    public field: string,
    public value?: unknown
  ) {
    super(message)
    this.name = 'AuditValidationError'
  }
}

export class ActorValidationError extends AuditValidationError {
  constructor(message: string, value?: unknown) {
    super(message, 'actor', value)
    this.name = 'ActorValidationError'
  }
}

export class ActionValidationError extends AuditValidationError {
  constructor(message: string, value?: unknown) {
    super(message, 'action', value)
    this.name = 'ActionValidationError'
  }
}

export class ResourceValidationError extends AuditValidationError {
  constructor(message: string, value?: unknown) {
    super(message, 'resource', value)
    this.name = 'ResourceValidationError'
  }
}

export class TimestampValidationError extends AuditValidationError {
  constructor(message: string, value?: unknown) {
    super(message, 'timestamp', value)
    this.name = 'TimestampValidationError'
  }
}

export class ImmutabilityError extends Error {
  constructor(
    message: string,
    public entryId: string,
    public attemptedField: string
  ) {
    super(message)
    this.name = 'ImmutabilityError'
  }
}

export class BatchValidationError extends Error {
  constructor(
    message: string,
    public failedCount: number,
    public totalCount: number
  ) {
    super(message)
    this.name = 'BatchValidationError'
  }
}

// =============================================================================
// VALIDATOR CLASSES - IMPLEMENTATIONS
// =============================================================================

/**
 * Validates actor information
 */
export class ActorValidator {
  /**
   * Validates that exactly one of userId, serviceId, or system is provided
   */
  static validate(actor: Actor): void {
    const identifiers: string[] = []

    if (actor.userId !== undefined) {
      if (typeof actor.userId !== 'string' || actor.userId.trim() === '') {
        throw new ActorValidationError('userId must be a non-empty string', actor)
      }
      identifiers.push('userId')
    }

    if (actor.serviceId !== undefined) {
      if (typeof actor.serviceId !== 'string' || actor.serviceId.trim() === '') {
        throw new ActorValidationError('serviceId must be a non-empty string', actor)
      }
      identifiers.push('serviceId')
    }

    if (actor.system === true) {
      identifiers.push('system')
    }

    if (identifiers.length === 0) {
      throw new ActorValidationError('Actor must have exactly one of: userId, serviceId, or system=true', actor)
    }

    if (identifiers.length > 1) {
      throw new ActorValidationError(`Actor must have exactly one identifier, found: ${identifiers.join(', ')}`, actor)
    }

    // Validate optional fields
    if (actor.ipAddress !== undefined && !ActorValidator.validateIpAddress(actor.ipAddress)) {
      throw new ActorValidationError('Invalid IP address format', actor)
    }
  }

  /**
   * Determines the type of actor
   */
  static getType(actor: Actor): ActorType {
    if (actor.userId !== undefined) return 'user'
    if (actor.serviceId !== undefined) return 'service'
    if (actor.system === true) return 'system'
    throw new ActorValidationError('Cannot determine actor type', actor)
  }

  /**
   * Normalizes actor input (string -> Actor object)
   */
  static normalize(input: Actor | string): Actor {
    if (typeof input === 'string') {
      // Check for prefixes
      if (input.startsWith('service:')) {
        return { serviceId: input.substring(8) }
      }
      if (input.startsWith('system:') || input === 'system') {
        return { system: true }
      }
      // Default to userId
      return { userId: input }
    }
    return input
  }

  /**
   * Validates IP address format (IPv4 and IPv6)
   */
  static validateIpAddress(ip: string): boolean {
    // IPv4 pattern
    const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
    const ipv4Match = ip.match(ipv4Pattern)
    if (ipv4Match) {
      return ipv4Match.slice(1).every(octet => {
        const num = parseInt(octet, 10)
        return num >= 0 && num <= 255
      })
    }

    // IPv6 pattern (simplified - accepts full and compressed forms)
    const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/
    if (ipv6Pattern.test(ip)) {
      return true
    }

    // Full IPv6
    const fullIpv6Pattern = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/
    if (fullIpv6Pattern.test(ip)) {
      return true
    }

    return false
  }
}

/**
 * Validates action information
 */
export class ActionValidator {
  private static readonly STANDARD_ACTIONS: readonly string[] = ['create', 'read', 'update', 'delete']
  private static readonly VALID_ACTION_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/
  private static readonly NAMESPACE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/

  /**
   * Validates action type
   */
  static validate(action: Action | string): void {
    if (typeof action === 'string') {
      if (action.trim() === '') {
        throw new ActionValidationError('Action cannot be empty', action)
      }
      // Check for dotted namespace.action format
      if (action.includes('.')) {
        const [namespace, actionType] = action.split('.', 2)
        if (!ActionValidator.validateNamespace(namespace)) {
          throw new ActionValidationError('Invalid namespace format', action)
        }
        if (!actionType || !ActionValidator.VALID_ACTION_PATTERN.test(actionType)) {
          throw new ActionValidationError('Invalid action type format', action)
        }
      } else if (!ActionValidator.VALID_ACTION_PATTERN.test(action)) {
        throw new ActionValidationError('Action contains invalid characters', action)
      }
    } else {
      if (!action.type || action.type.trim() === '') {
        throw new ActionValidationError('Action type cannot be empty', action)
      }
      if (!ActionValidator.VALID_ACTION_PATTERN.test(action.type)) {
        throw new ActionValidationError('Action type contains invalid characters', action)
      }
      if (action.namespace !== undefined && !ActionValidator.validateNamespace(action.namespace)) {
        throw new ActionValidationError('Invalid namespace format', action)
      }
    }
  }

  /**
   * Checks if action is a standard CRUD action
   */
  static isStandardAction(action: string): action is StandardAction {
    return ActionValidator.STANDARD_ACTIONS.includes(action)
  }

  /**
   * Normalizes action input
   */
  static normalize(input: Action | string): Action {
    if (typeof input === 'string') {
      // Check for dotted namespace.action format
      if (input.includes('.')) {
        const [namespace, actionType] = input.split('.', 2)
        return {
          type: actionType,
          namespace,
          isCustom: !ActionValidator.isStandardAction(actionType),
        }
      }
      return {
        type: input,
        isCustom: !ActionValidator.isStandardAction(input),
      }
    }
    return {
      ...input,
      isCustom: input.isCustom ?? !ActionValidator.isStandardAction(input.type),
    }
  }

  /**
   * Validates custom action namespace format
   */
  static validateNamespace(namespace: string): boolean {
    if (!namespace || namespace.trim() === '') {
      return false
    }
    return ActionValidator.NAMESPACE_PATTERN.test(namespace)
  }
}

/**
 * Validates resource information
 */
export class ResourceValidator {
  private static readonly TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/
  private static readonly PATH_PATTERN = /^\/[a-zA-Z0-9_\-/]+$/

  /**
   * Validates resource structure
   */
  static validate(resource: Resource): void {
    if (!resource.type || resource.type.trim() === '') {
      throw new ResourceValidationError('Resource type is required', resource)
    }
    if (!ResourceValidator.validateType(resource.type)) {
      throw new ResourceValidationError('Invalid resource type format', resource)
    }
    if (!resource.id || resource.id.trim() === '') {
      throw new ResourceValidationError('Resource id is required', resource)
    }
    if (resource.path !== undefined && !ResourceValidator.validatePath(resource.path)) {
      throw new ResourceValidationError('Invalid resource path format', resource)
    }
  }

  /**
   * Validates resource type format
   */
  static validateType(type: string): boolean {
    if (!type || type.trim() === '') {
      return false
    }
    return ResourceValidator.TYPE_PATTERN.test(type)
  }

  /**
   * Validates resource path format
   */
  static validatePath(path: string): boolean {
    if (!path || path.trim() === '') {
      return false
    }
    // Allow paths starting with / and containing alphanumeric, _, -, /
    return ResourceValidator.PATH_PATTERN.test(path) || path.startsWith('/')
  }

  /**
   * Normalizes resource path
   */
  static normalizePath(path: string): string {
    // Ensure leading slash
    if (!path.startsWith('/')) {
      path = '/' + path
    }
    // Remove trailing slash
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1)
    }
    // Collapse multiple slashes
    path = path.replace(/\/+/g, '/')
    return path
  }
}

/**
 * Validates and handles timestamps
 */
export class TimestampValidator {
  private static readonly ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/

  /**
   * Validates ISO 8601 timestamp format
   */
  static validate(timestamp: string): void {
    if (!timestamp || timestamp.trim() === '') {
      throw new TimestampValidationError('Timestamp cannot be empty', timestamp)
    }
    const date = new Date(timestamp)
    if (isNaN(date.getTime())) {
      throw new TimestampValidationError('Invalid timestamp format', timestamp)
    }
  }

  /**
   * Parses and normalizes timestamp input
   */
  static parse(input: string | Date | number): AuditTimestamp {
    let date: Date
    let timezone: string | undefined

    if (typeof input === 'number') {
      date = new Date(input)
    } else if (input instanceof Date) {
      date = input
    } else {
      TimestampValidator.validate(input)
      date = new Date(input)
      // Extract timezone if present
      const tzMatch = input.match(/([+-]\d{2}:\d{2})$/)
      if (tzMatch) {
        timezone = tzMatch[1]
      } else if (input.endsWith('Z')) {
        timezone = 'UTC'
      }
    }

    return {
      iso: date.toISOString(),
      epochMs: date.getTime(),
      timezone,
    }
  }

  /**
   * Validates timezone string
   */
  static validateTimezone(timezone: string): boolean {
    if (!timezone || timezone.trim() === '') {
      return false
    }
    // Check for UTC
    if (timezone === 'UTC' || timezone === 'Z') {
      return true
    }
    // Check for offset format (+/-HH:MM)
    const offsetPattern = /^[+-]\d{2}:\d{2}$/
    if (offsetPattern.test(timezone)) {
      return true
    }
    // Check for IANA timezone names (simplified check)
    const ianaPattern = /^[A-Za-z_]+\/[A-Za-z_]+$/
    return ianaPattern.test(timezone)
  }

  /**
   * Converts timestamp to different timezone
   */
  static toTimezone(timestamp: AuditTimestamp, timezone: string): AuditTimestamp {
    if (!TimestampValidator.validateTimezone(timezone)) {
      throw new TimestampValidationError('Invalid timezone', timezone)
    }
    // For simplicity, we keep the same epochMs but update the timezone field
    // Full timezone conversion would require a library like date-fns-tz
    return {
      ...timestamp,
      timezone,
    }
  }

  /**
   * Gets current timestamp
   */
  static now(): AuditTimestamp {
    const date = new Date()
    return {
      iso: date.toISOString(),
      epochMs: date.getTime(),
      timezone: 'UTC',
    }
  }
}

/**
 * Handles state capture and diffing
 */
export class StateCapturer {
  /**
   * Creates a state capture from before/after objects
   */
  static capture(before?: Record<string, unknown>, after?: Record<string, unknown>): StateCapture {
    const result: StateCapture = {}

    if (before !== undefined) {
      result.before = StateCapturer.clone(before)
    }
    if (after !== undefined) {
      result.after = StateCapturer.clone(after)
    }
    if (before !== undefined && after !== undefined) {
      result.diff = StateCapturer.diff(before, after)
    }

    return result
  }

  /**
   * Computes JSON diff between two objects
   */
  static diff(before: Record<string, unknown>, after: Record<string, unknown>): JsonDiff {
    const added: Record<string, unknown> = {}
    const removed: Record<string, unknown> = {}
    const modified: Record<string, { old: unknown; new: unknown }> = {}

    // Find added and modified keys
    for (const key of Object.keys(after)) {
      if (!(key in before)) {
        added[key] = after[key]
      } else if (!StateCapturer.deepEqual(before[key], after[key])) {
        modified[key] = { old: before[key], new: after[key] }
      }
    }

    // Find removed keys
    for (const key of Object.keys(before)) {
      if (!(key in after)) {
        removed[key] = before[key]
      }
    }

    return { added, removed, modified }
  }

  /**
   * Deep equality check for state comparison
   */
  private static deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (typeof a !== typeof b) return false
    if (a === null || b === null) return a === b
    if (typeof a !== 'object') return false

    const objA = a as Record<string, unknown>
    const objB = b as Record<string, unknown>

    const keysA = Object.keys(objA)
    const keysB = Object.keys(objB)

    if (keysA.length !== keysB.length) return false

    return keysA.every(key => StateCapturer.deepEqual(objA[key], objB[key]))
  }

  /**
   * Validates state objects
   */
  static validate(state: StateCapture): void {
    if (state.before !== undefined && typeof state.before !== 'object') {
      throw new AuditValidationError('State before must be an object', 'state.before')
    }
    if (state.after !== undefined && typeof state.after !== 'object') {
      throw new AuditValidationError('State after must be an object', 'state.after')
    }
  }

  /**
   * Deep clones state to prevent mutation
   */
  static clone(state: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(state))
  }
}

/**
 * Validates metadata
 */
export class MetadataValidator {
  /**
   * Validates metadata structure
   */
  static validate(metadata: AuditMetadata): void {
    if (metadata.ipAddress !== undefined && !MetadataValidator.validateIpAddress(metadata.ipAddress)) {
      throw new AuditValidationError('Invalid IP address format', 'metadata.ipAddress', metadata.ipAddress)
    }
    if (metadata.userAgent !== undefined && !MetadataValidator.validateUserAgent(metadata.userAgent)) {
      throw new AuditValidationError('Invalid user agent', 'metadata.userAgent', metadata.userAgent)
    }
    if (metadata.requestId !== undefined && !MetadataValidator.validateRequestId(metadata.requestId)) {
      throw new AuditValidationError('Invalid request ID format', 'metadata.requestId', metadata.requestId)
    }
  }

  /**
   * Validates IP address format (IPv4 and IPv6)
   */
  static validateIpAddress(ip: string): boolean {
    return ActorValidator.validateIpAddress(ip)
  }

  /**
   * Validates user agent string
   */
  static validateUserAgent(userAgent: string): boolean {
    // User agent should be a non-empty string with reasonable length
    return typeof userAgent === 'string' && userAgent.length > 0 && userAgent.length < 2048
  }

  /**
   * Validates request ID format (UUID, ULID, etc.)
   */
  static validateRequestId(requestId: string): boolean {
    if (!requestId || requestId.trim() === '') {
      return false
    }
    // UUID format
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (uuidPattern.test(requestId)) {
      return true
    }
    // ULID format (26 characters, Crockford base32)
    const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/i
    if (ulidPattern.test(requestId)) {
      return true
    }
    // Allow alphanumeric IDs
    const alphanumericPattern = /^[a-zA-Z0-9_-]+$/
    return alphanumericPattern.test(requestId) && requestId.length >= 8 && requestId.length <= 128
  }
}

/**
 * Handles event correlation
 */
export class CorrelationManager {
  /**
   * Validates correlation structure
   */
  static validate(correlation: EventCorrelation): void {
    if (!correlation.correlationId || correlation.correlationId.trim() === '') {
      throw new AuditValidationError('Correlation ID is required', 'correlation.correlationId')
    }
  }

  /**
   * Generates a new correlation ID
   */
  static generateCorrelationId(): string {
    // Generate a UUID v4-like ID
    const hex = '0123456789abcdef'
    let result = ''
    for (let i = 0; i < 32; i++) {
      if (i === 8 || i === 12 || i === 16 || i === 20) {
        result += '-'
      }
      result += hex[Math.floor(Math.random() * 16)]
    }
    return result
  }

  /**
   * Links entries by correlation
   */
  static link(parentEntry: AuditEntry, childEntry: AuditEntry): EventCorrelation {
    const parentCorrelation = parentEntry.correlation
    return {
      correlationId: parentCorrelation?.correlationId ?? CorrelationManager.generateCorrelationId(),
      causationId: parentEntry.id,
      parentId: parentEntry.id,
      transactionId: parentCorrelation?.transactionId,
    }
  }

  /**
   * Creates a child correlation from parent
   */
  static createChild(parentCorrelation: EventCorrelation): EventCorrelation {
    return {
      correlationId: parentCorrelation.correlationId,
      causationId: parentCorrelation.correlationId,
      parentId: parentCorrelation.correlationId,
      transactionId: parentCorrelation.transactionId,
    }
  }
}

/**
 * Handles sensitive field masking
 */
export class SensitiveFieldMasker {
  private static readonly SENSITIVE_PATTERNS = [
    /password/i,
    /secret/i,
    /token/i,
    /api[_-]?key/i,
    /credential/i,
    /private[_-]?key/i,
    /ssn/i,
    /social[_-]?security/i,
    /credit[_-]?card/i,
    /cvv/i,
  ]

  /**
   * Masks sensitive fields in data
   */
  static mask(data: Record<string, unknown>, config: MaskingConfig): MaskingResult {
    SensitiveFieldMasker.validateConfig(config)

    const masked = JSON.parse(JSON.stringify(data))
    const maskedFields: string[] = []

    for (const field of config.fields) {
      const value = SensitiveFieldMasker.getNestedValue(masked, field)
      if (value !== undefined) {
        const maskedValue = SensitiveFieldMasker.applyStrategy(value, config.strategy, config.partialOptions)
        SensitiveFieldMasker.setNestedValue(masked, field, maskedValue)
        maskedFields.push(field)
      }
    }

    return { masked, maskedFields }
  }

  /**
   * Gets nested value from object using dot notation
   */
  private static getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined
      }
      current = (current as Record<string, unknown>)[part]
    }
    return current
  }

  /**
   * Sets nested value in object using dot notation
   */
  private static setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.')
    let current: Record<string, unknown> = obj
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }
    current[parts[parts.length - 1]] = value
  }

  /**
   * Detects potentially sensitive fields
   */
  static detectSensitiveFields(data: Record<string, unknown>, prefix = ''): string[] {
    const sensitiveFields: string[] = []

    for (const [key, value] of Object.entries(data)) {
      const fullPath = prefix ? `${prefix}.${key}` : key

      // Check if key matches sensitive patterns
      if (SensitiveFieldMasker.SENSITIVE_PATTERNS.some(pattern => pattern.test(key))) {
        sensitiveFields.push(fullPath)
      }

      // Recursively check nested objects
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        sensitiveFields.push(...SensitiveFieldMasker.detectSensitiveFields(value as Record<string, unknown>, fullPath))
      }
    }

    return sensitiveFields
  }

  /**
   * Applies specific masking strategy
   */
  static applyStrategy(value: unknown, strategy: MaskingConfig['strategy'], options?: MaskingConfig['partialOptions']): unknown {
    if (value === null || value === undefined) {
      return value
    }

    const stringValue = String(value)

    switch (strategy) {
      case 'redact':
        return '[REDACTED]'

      case 'hash':
        // Simple hash for masking purposes
        let hash = 0
        for (let i = 0; i < stringValue.length; i++) {
          const char = stringValue.charCodeAt(i)
          hash = ((hash << 5) - hash) + char
          hash = hash & hash
        }
        return `***${Math.abs(hash).toString(16)}***`

      case 'partial': {
        const showFirst = options?.showFirst ?? 0
        const showLast = options?.showLast ?? 0
        const maskChar = options?.maskChar ?? '*'

        if (stringValue.length <= showFirst + showLast) {
          return maskChar.repeat(stringValue.length)
        }

        const first = stringValue.slice(0, showFirst)
        const last = stringValue.slice(-showLast || undefined)
        const middleLength = stringValue.length - showFirst - showLast
        const middle = maskChar.repeat(Math.min(middleLength, 8))

        return showLast > 0 ? `${first}${middle}${last}` : `${first}${middle}`
      }

      case 'tokenize':
        return `tok_${Math.random().toString(36).substring(2, 15)}`

      default:
        return '[MASKED]'
    }
  }

  /**
   * Validates masking config
   */
  static validateConfig(config: MaskingConfig): void {
    if (!config.fields || !Array.isArray(config.fields)) {
      throw new AuditValidationError('Masking config must have fields array', 'maskingConfig.fields')
    }
    if (!config.strategy) {
      throw new AuditValidationError('Masking config must have a strategy', 'maskingConfig.strategy')
    }
    const validStrategies = ['redact', 'hash', 'partial', 'tokenize']
    if (!validStrategies.includes(config.strategy)) {
      throw new AuditValidationError(`Invalid masking strategy: ${config.strategy}`, 'maskingConfig.strategy')
    }
  }
}

// =============================================================================
// AUDIT ENTRY CLASS - STUB
// =============================================================================

/**
 * Main audit entry class with immutability guarantees
 */
export class AuditEntryBuilder {
  private _entry: Partial<AuditEntry> = {}
  private _frozen: boolean = false

  /**
   * Creates a new audit entry builder
   */
  static create(): AuditEntryBuilder {
    throw new Error('Not implemented')
  }

  /**
   * Sets the actor
   */
  actor(_actor: Actor | string): this {
    throw new Error('Not implemented')
  }

  /**
   * Sets the action
   */
  action(_action: Action | string): this {
    throw new Error('Not implemented')
  }

  /**
   * Sets the resource
   */
  resource(_resource: Resource): this {
    throw new Error('Not implemented')
  }

  /**
   * Sets the timestamp
   */
  timestamp(_timestamp: string | Date): this {
    throw new Error('Not implemented')
  }

  /**
   * Sets before state
   */
  before(_state: Record<string, unknown>): this {
    throw new Error('Not implemented')
  }

  /**
   * Sets after state
   */
  after(_state: Record<string, unknown>): this {
    throw new Error('Not implemented')
  }

  /**
   * Sets metadata
   */
  metadata(_metadata: AuditMetadata): this {
    throw new Error('Not implemented')
  }

  /**
   * Sets correlation
   */
  correlation(_correlation: EventCorrelation): this {
    throw new Error('Not implemented')
  }

  /**
   * Applies masking config
   */
  mask(_config: MaskingConfig): this {
    throw new Error('Not implemented')
  }

  /**
   * Builds and freezes the entry
   */
  build(): AuditEntry {
    throw new Error('Not implemented')
  }

  /**
   * Validates the entry without building
   */
  validate(): void {
    throw new Error('Not implemented')
  }
}

/**
 * Immutable audit entry wrapper
 */
export class ImmutableAuditEntry {
  private readonly _entry: AuditEntry

  constructor(_entry: AuditEntry) {
    throw new Error('Not implemented')
  }

  /**
   * Gets the entry data (readonly)
   */
  get data(): Readonly<AuditEntry> {
    throw new Error('Not implemented')
  }

  /**
   * Attempts to modify throws ImmutabilityError
   */
  modify(_field: string, _value: unknown): never {
    throw new Error('Not implemented')
  }

  /**
   * Creates a JSON representation
   */
  toJSON(): Record<string, unknown> {
    throw new Error('Not implemented')
  }

  /**
   * Verifies entry integrity
   */
  verifyIntegrity(): boolean {
    throw new Error('Not implemented')
  }
}

// =============================================================================
// BATCH OPERATIONS - STUB
// =============================================================================

/**
 * Handles batch audit entry creation
 */
export class BatchAuditCreator {
  /**
   * Creates multiple audit entries
   */
  static create(_input: BatchCreateInput): BatchCreateResult {
    throw new Error('Not implemented')
  }

  /**
   * Validates batch input
   */
  static validate(_input: BatchCreateInput): void {
    throw new Error('Not implemented')
  }

  /**
   * Creates entries atomically (all or nothing)
   */
  static createAtomic(_entries: CreateAuditEntryInput[]): AuditEntry[] {
    throw new Error('Not implemented')
  }

  /**
   * Creates entries with partial failure support
   */
  static createPartial(_entries: CreateAuditEntryInput[]): BatchCreateResult {
    throw new Error('Not implemented')
  }
}
