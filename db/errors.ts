/**
 * DB Module - Unified Error Hierarchy
 *
 * This module provides standardized error classes for the entire db/ module.
 * All errors follow a consistent format: "[Component] Action failed: reason"
 *
 * Error Categories:
 * - DBError (base): All db module errors
 * - ValidationError: For invalid input/parameters
 * - NotFoundError: For missing resources
 * - DuplicateError: For constraint violations
 * - ConfigError: For configuration issues
 * - StorageError: For storage operation failures
 * - ConnectionError: For connection issues
 *
 * @module db/errors
 *
 * @example
 * ```typescript
 * import {
 *   DBError,
 *   ValidationError,
 *   NotFoundError,
 *   DuplicateError,
 * } from './errors'
 *
 * // Throw with component prefix
 * throw new ValidationError('ColumnarStore', 'insert', 'batch cannot be empty')
 *
 * // Results in: "[ColumnarStore] Insert failed: batch cannot be empty"
 * ```
 */

// ============================================================================
// ERROR CODES
// ============================================================================

export const ErrorCodes = {
  // Validation errors (E1xxx)
  VALIDATION: 'E1000',
  INVALID_FORMAT: 'E1001',
  INVALID_DURATION: 'E1002',
  INVALID_SIZE: 'E1003',
  MISSING_REQUIRED: 'E1004',
  EMPTY_VALUE: 'E1005',
  DIMENSION_MISMATCH: 'E1006',
  INVALID_MODE: 'E1007',
  INVALID_ROLE: 'E1008',
  INVALID_STATUS: 'E1009',
  INVALID_KIND: 'E1010',
  INVALID_TIER: 'E1011',

  // Not found errors (E2xxx)
  NOT_FOUND: 'E2000',
  THING_NOT_FOUND: 'E2001',
  EVENT_NOT_FOUND: 'E2002',
  DLQ_EVENT_NOT_FOUND: 'E2003',
  TOPIC_NOT_FOUND: 'E2004',
  SNAPSHOT_NOT_FOUND: 'E2005',
  MIGRATION_NOT_FOUND: 'E2006',
  VISIBILITY_CHANGE_NOT_FOUND: 'E2007',
  CONVERSATION_NOT_FOUND: 'E2008',
  TYPE_NOT_FOUND: 'E2009',

  // Duplicate/constraint errors (E3xxx)
  DUPLICATE: 'E3000',
  ALREADY_EXISTS: 'E3001',
  UNIQUE_CONSTRAINT: 'E3002',

  // Configuration errors (E4xxx)
  CONFIG: 'E4000',
  MISSING_CONFIG: 'E4001',
  UNSUPPORTED_OPERATION: 'E4002',
  UNKNOWN_CONFIG: 'E4003',

  // Storage errors (E5xxx)
  STORAGE: 'E5000',
  INSERT_FAILED: 'E5001',
  QUERY_FAILED: 'E5002',

  // Connection errors (E6xxx)
  CONNECTION: 'E6000',
  NOT_AVAILABLE: 'E6001',

  // State errors (E7xxx)
  INVALID_STATE: 'E7000',
  CONSUMER_CLOSED: 'E7001',
  STALE_GENERATION: 'E7002',
  ALREADY_ROLLED_BACK: 'E7003',

  // Circular reference errors (E8xxx)
  CIRCULAR: 'E8000',
  CIRCULAR_HANDOFF: 'E8001',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

// ============================================================================
// BASE ERROR
// ============================================================================

/**
 * Base error class for all db module errors.
 *
 * All db-related errors inherit from this class, enabling
 * unified error handling via `instanceof DBError`.
 *
 * Message format: "[Component] Action failed: reason"
 */
export class DBError extends Error {
  /** Error code for programmatic handling */
  readonly code: string
  /** Component that threw the error */
  readonly component: string
  /** Action that failed */
  readonly action: string
  /** Reason for failure */
  readonly reason: string

  constructor(
    component: string,
    action: string,
    reason: string,
    code: ErrorCode = ErrorCodes.STORAGE
  ) {
    const message = `[${component}] ${capitalize(action)} failed: ${reason}`
    super(message)
    this.name = 'DBError'
    this.code = code
    this.component = component
    this.action = action
    this.reason = reason

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}

/**
 * Capitalize first letter of a string
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

// ============================================================================
// VALIDATION ERRORS
// ============================================================================

/**
 * Error thrown when input validation fails.
 *
 * @example
 * ```typescript
 * throw new ValidationError('ColumnarStore', 'insert', 'batch cannot be empty')
 * // "[ColumnarStore] Insert failed: batch cannot be empty"
 * ```
 */
export class ValidationError extends DBError {
  /** The field that failed validation */
  readonly field?: string
  /** The invalid value */
  readonly value?: unknown

  constructor(
    component: string,
    action: string,
    reason: string,
    field?: string,
    value?: unknown,
    code: ErrorCode = ErrorCodes.VALIDATION
  ) {
    super(component, action, reason, code)
    this.name = 'ValidationError'
    this.field = field
    this.value = value
  }
}

/**
 * Error thrown when a required field is missing.
 */
export class MissingRequiredError extends ValidationError {
  constructor(component: string, field: string) {
    super(
      component,
      'validate',
      `required field missing: ${field}`,
      field,
      undefined,
      ErrorCodes.MISSING_REQUIRED
    )
    this.name = 'MissingRequiredError'
  }
}

/**
 * Error thrown when a value is empty but shouldn't be.
 */
export class EmptyValueError extends ValidationError {
  constructor(component: string, field: string) {
    super(component, 'validate', `${field} cannot be empty`, field, '', ErrorCodes.EMPTY_VALUE)
    this.name = 'EmptyValueError'
  }
}

/**
 * Error thrown when a duration format is invalid.
 */
export class InvalidDurationError extends ValidationError {
  constructor(component: string, duration: string, expectedFormat = '1d, 24h, 60m, etc.') {
    super(
      component,
      'parse',
      `invalid duration format: ${duration}. Expected format: ${expectedFormat}`,
      'duration',
      duration,
      ErrorCodes.INVALID_DURATION
    )
    this.name = 'InvalidDurationError'
  }
}

/**
 * Error thrown when a size format is invalid.
 */
export class InvalidSizeError extends ValidationError {
  constructor(component: string, size: string, expectedFormat = '1GB, 500MB, etc.') {
    super(
      component,
      'parse',
      `invalid size format: ${size}. Expected format: ${expectedFormat}`,
      'size',
      size,
      ErrorCodes.INVALID_SIZE
    )
    this.name = 'InvalidSizeError'
  }
}

/**
 * Error thrown when dimensions don't match.
 */
export class DimensionMismatchError extends ValidationError {
  constructor(component: string, expected?: number, actual?: number) {
    const reason =
      expected !== undefined && actual !== undefined
        ? `dimension mismatch: expected ${expected}, got ${actual}`
        : 'inconsistent embedding dimensions'
    super(component, 'validate', reason, 'dimensions', actual, ErrorCodes.DIMENSION_MISMATCH)
    this.name = 'DimensionMismatchError'
  }
}

/**
 * Error thrown when an invalid mode is provided.
 */
export class InvalidModeError extends ValidationError {
  readonly validModes: string[]

  constructor(component: string, mode: string, validModes: string[]) {
    super(
      component,
      'validate',
      `invalid mode: ${mode}. Valid modes are: ${validModes.join(', ')}`,
      'mode',
      mode,
      ErrorCodes.INVALID_MODE
    )
    this.name = 'InvalidModeError'
    this.validModes = validModes
  }
}

/**
 * Error thrown when an invalid role is provided.
 */
export class InvalidRoleError extends ValidationError {
  readonly validRoles: string[]

  constructor(component: string, role: string, validRoles: string[]) {
    super(
      component,
      'validate',
      `invalid role: ${role}. Valid roles are: ${validRoles.join(', ')}`,
      'role',
      role,
      ErrorCodes.INVALID_ROLE
    )
    this.name = 'InvalidRoleError'
    this.validRoles = validRoles
  }
}

/**
 * Error thrown when an invalid status is provided.
 */
export class InvalidStatusError extends ValidationError {
  readonly validStatuses: string[]

  constructor(component: string, status: string, validStatuses: string[]) {
    super(
      component,
      'validate',
      `invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`,
      'status',
      status,
      ErrorCodes.INVALID_STATUS
    )
    this.name = 'InvalidStatusError'
    this.validStatuses = validStatuses
  }
}

/**
 * Error thrown when an invalid kind is provided.
 */
export class InvalidKindError extends ValidationError {
  readonly validKinds: string[]

  constructor(component: string, kind: string, validKinds: string[]) {
    super(
      component,
      'validate',
      `invalid kind: ${kind}. Must be one of: ${validKinds.join(', ')}`,
      'kind',
      kind,
      ErrorCodes.INVALID_KIND
    )
    this.name = 'InvalidKindError'
    this.validKinds = validKinds
  }
}

/**
 * Error thrown when an invalid tier is provided.
 */
export class InvalidTierError extends ValidationError {
  readonly validTiers: string[]

  constructor(component: string, tier: string, validTiers: string[]) {
    super(
      component,
      'validate',
      `invalid tier: ${tier}. Must be one of: ${validTiers.join(', ')}`,
      'tier',
      tier,
      ErrorCodes.INVALID_TIER
    )
    this.name = 'InvalidTierError'
    this.validTiers = validTiers
  }
}

// ============================================================================
// NOT FOUND ERRORS
// ============================================================================

/**
 * Error thrown when a resource is not found.
 *
 * @example
 * ```typescript
 * throw new NotFoundError('EventLog', 'get', 'event-123')
 * // "[EventLog] Get failed: event-123 not found"
 * ```
 */
export class NotFoundError extends DBError {
  /** The ID of the resource that was not found */
  readonly resourceId: string
  /** The type of resource */
  readonly resourceType?: string

  constructor(
    component: string,
    action: string,
    resourceId: string,
    resourceType?: string,
    code: ErrorCode = ErrorCodes.NOT_FOUND
  ) {
    const typeStr = resourceType ? `${resourceType} ` : ''
    super(component, action, `${typeStr}${resourceId} not found`, code)
    this.name = 'NotFoundError'
    this.resourceId = resourceId
    this.resourceType = resourceType
  }
}

/**
 * Error thrown when a topic is not found.
 */
export class TopicNotFoundError extends NotFoundError {
  constructor(component: string, topicName: string) {
    super(component, 'get', topicName, 'topic', ErrorCodes.TOPIC_NOT_FOUND)
    this.name = 'TopicNotFoundError'
  }
}

/**
 * Error thrown when a snapshot is not found.
 */
export class SnapshotNotFoundError extends NotFoundError {
  constructor(component: string, snapshotId: string) {
    super(component, 'get', snapshotId, 'snapshot', ErrorCodes.SNAPSHOT_NOT_FOUND)
    this.name = 'SnapshotNotFoundError'
  }
}

/**
 * Error thrown when a migration is not found.
 */
export class MigrationNotFoundError extends NotFoundError {
  readonly version: number

  constructor(component: string, version: number) {
    super(component, 'get', `version ${version}`, 'migration', ErrorCodes.MIGRATION_NOT_FOUND)
    this.name = 'MigrationNotFoundError'
    this.version = version
  }
}

// ============================================================================
// DUPLICATE ERRORS
// ============================================================================

/**
 * Error thrown when a resource already exists.
 *
 * @example
 * ```typescript
 * throw new DuplicateError('WorkerStore', 'create', 'worker-123')
 * // "[WorkerStore] Create failed: worker-123 already exists"
 * ```
 */
export class DuplicateError extends DBError {
  /** The ID of the resource that already exists */
  readonly resourceId: string
  /** The type of resource */
  readonly resourceType?: string

  constructor(
    component: string,
    action: string,
    resourceId: string,
    resourceType?: string,
    code: ErrorCode = ErrorCodes.ALREADY_EXISTS
  ) {
    const typeStr = resourceType ? `${resourceType} ` : ''
    super(component, action, `${typeStr}${resourceId} already exists`, code)
    this.name = 'DuplicateError'
    this.resourceId = resourceId
    this.resourceType = resourceType
  }
}

/**
 * Error thrown when a topic already exists.
 */
export class TopicExistsError extends DuplicateError {
  constructor(component: string, topicName: string) {
    super(component, 'create', topicName, 'topic')
    this.name = 'TopicExistsError'
  }
}

/**
 * Error thrown when a unique constraint is violated.
 */
export class UniqueConstraintError extends DuplicateError {
  readonly tableName: string
  readonly columnName: string

  constructor(component: string, tableName: string, columnName: string) {
    super(
      component,
      'insert',
      `${tableName}.${columnName}`,
      'unique constraint',
      ErrorCodes.UNIQUE_CONSTRAINT
    )
    this.name = 'UniqueConstraintError'
    this.tableName = tableName
    this.columnName = columnName
  }
}

// ============================================================================
// CONFIGURATION ERRORS
// ============================================================================

/**
 * Error thrown when configuration is missing or invalid.
 *
 * @example
 * ```typescript
 * throw new ConfigError('CDCEmitter', 'initialize', 'ns option is required')
 * // "[CDCEmitter] Initialize failed: ns option is required"
 * ```
 */
export class ConfigError extends DBError {
  /** The configuration key that was missing or invalid */
  readonly configKey?: string

  constructor(
    component: string,
    action: string,
    reason: string,
    configKey?: string,
    code: ErrorCode = ErrorCodes.CONFIG
  ) {
    super(component, action, reason, code)
    this.name = 'ConfigError'
    this.configKey = configKey
  }
}

/**
 * Error thrown when an operation is not supported.
 */
export class UnsupportedOperationError extends ConfigError {
  readonly operation: string

  constructor(component: string, operation: string) {
    super(
      component,
      operation,
      `storage does not support ${operation}`,
      undefined,
      ErrorCodes.UNSUPPORTED_OPERATION
    )
    this.name = 'UnsupportedOperationError'
    this.operation = operation
  }
}

/**
 * Error thrown when an unknown configuration key is provided.
 */
export class UnknownConfigError extends ConfigError {
  constructor(component: string, key: string) {
    super(component, 'configure', `unknown config setting: ${key}`, key, ErrorCodes.UNKNOWN_CONFIG)
    this.name = 'UnknownConfigError'
  }
}

// ============================================================================
// CONNECTION ERRORS
// ============================================================================

/**
 * Error thrown when a connection is not available.
 *
 * @example
 * ```typescript
 * throw new ConnectionError('EventDeliveryStore', 'query', 'SQLite connection not available')
 * // "[EventDeliveryStore] Query failed: SQLite connection not available"
 * ```
 */
export class ConnectionError extends DBError {
  constructor(component: string, action: string, reason = 'connection not available') {
    super(component, action, reason, ErrorCodes.NOT_AVAILABLE)
    this.name = 'ConnectionError'
  }
}

// ============================================================================
// STATE ERRORS
// ============================================================================

/**
 * Error thrown when an operation is attempted in an invalid state.
 *
 * @example
 * ```typescript
 * throw new InvalidStateError('Consumer', 'poll', 'consumer is closed')
 * // "[Consumer] Poll failed: consumer is closed"
 * ```
 */
export class InvalidStateError extends DBError {
  /** The current state */
  readonly currentState?: string

  constructor(
    component: string,
    action: string,
    reason: string,
    currentState?: string,
    code: ErrorCode = ErrorCodes.INVALID_STATE
  ) {
    super(component, action, reason, code)
    this.name = 'InvalidStateError'
    this.currentState = currentState
  }
}

/**
 * Error thrown when a consumer is closed.
 */
export class ConsumerClosedError extends InvalidStateError {
  constructor(component: string) {
    super(component, 'poll', 'consumer is closed', 'closed', ErrorCodes.CONSUMER_CLOSED)
    this.name = 'ConsumerClosedError'
  }
}

/**
 * Error thrown when a stale generation is detected.
 */
export class StaleGenerationError extends InvalidStateError {
  readonly staleGeneration: number
  readonly currentGeneration: number

  constructor(component: string, staleGeneration: number, currentGeneration: number) {
    super(
      component,
      'commit',
      `stale generation ${staleGeneration}, current is ${currentGeneration}`,
      `generation ${staleGeneration}`,
      ErrorCodes.STALE_GENERATION
    )
    this.name = 'StaleGenerationError'
    this.staleGeneration = staleGeneration
    this.currentGeneration = currentGeneration
  }
}

// ============================================================================
// CIRCULAR REFERENCE ERRORS
// ============================================================================

/**
 * Error thrown when a circular reference is detected.
 *
 * @example
 * ```typescript
 * throw new CircularReferenceError('HandoffChain', 'handoff', 'agent-a')
 * // "[HandoffChain] Handoff failed: circular reference detected for agent-a"
 * ```
 */
export class CircularReferenceError extends DBError {
  /** The ID that caused the circular reference */
  readonly referenceId: string

  constructor(
    component: string,
    action: string,
    referenceId: string,
    code: ErrorCode = ErrorCodes.CIRCULAR
  ) {
    super(component, action, `circular reference detected for ${referenceId}`, code)
    this.name = 'CircularReferenceError'
    this.referenceId = referenceId
  }
}

/**
 * Error thrown when a circular handoff is detected.
 */
export class CircularHandoffError extends CircularReferenceError {
  constructor(component: string, agentId: string, isSelf = false) {
    super(
      component,
      'handoff',
      isSelf ? 'self' : agentId,
      ErrorCodes.CIRCULAR_HANDOFF
    )
    this.name = 'CircularHandoffError'
    // Override message for self-handoff
    if (isSelf) {
      (this as { message: string }).message = `[${component}] Handoff failed: cannot hand off to self`
    }
  }
}

// ============================================================================
// MESSAGE SIZE ERRORS
// ============================================================================

/**
 * Error thrown when a message exceeds the maximum size.
 */
export class MessageSizeError extends ValidationError {
  readonly actualSize: number
  readonly maxSize: number

  constructor(component: string, actualSize: number, maxSize: number) {
    super(
      component,
      'send',
      `message size ${actualSize} exceeds max size ${maxSize}`,
      'size',
      actualSize,
      ErrorCodes.VALIDATION
    )
    this.name = 'MessageSizeError'
    this.actualSize = actualSize
    this.maxSize = maxSize
  }
}

// ============================================================================
// STORE-SPECIFIC ERRORS
// ============================================================================

/**
 * Error thrown when a document already exists.
 *
 * @example
 * ```typescript
 * throw new DocumentExistsError('DocumentStore', 'doc-123')
 * // "[DocumentStore] Create failed: document 'doc-123' already exists"
 * ```
 */
export class DocumentExistsError extends DuplicateError {
  constructor(component: string, documentId: string) {
    super(component, 'create', documentId, 'document')
    this.name = 'DocumentExistsError'
  }
}

/**
 * Error thrown when a thing already exists.
 */
export class ThingExistsError extends DuplicateError {
  constructor(component: string, thingId: string) {
    super(component, 'create', thingId, 'thing')
    this.name = 'ThingExistsError'
  }
}

/**
 * Error thrown when a relationship already exists.
 *
 * @example
 * ```typescript
 * throw new RelationshipExistsError('GraphStore', 'owns', 'user-1', 'doc-1')
 * // "[GraphStore] Create failed: relationship 'owns' from 'user-1' to 'doc-1' already exists"
 * ```
 */
export class RelationshipExistsError extends DBError {
  readonly verb: string
  readonly from: string
  readonly to: string

  constructor(component: string, verb: string, from: string, to: string) {
    super(
      component,
      'create',
      `relationship '${verb}' from '${from}' to '${to}' already exists`,
      ErrorCodes.ALREADY_EXISTS
    )
    this.name = 'RelationshipExistsError'
    this.verb = verb
    this.from = from
    this.to = to
  }
}

/**
 * Error thrown when a vector already exists.
 */
export class VectorExistsError extends DuplicateError {
  constructor(component: string, vectorId: string) {
    super(component, 'insert', vectorId, 'vector')
    this.name = 'VectorExistsError'
  }
}

/**
 * Error thrown when an ID is invalid (empty or wrong format).
 */
export class InvalidIdError extends ValidationError {
  constructor(component: string, message = 'ID must be a non-empty string') {
    super(component, 'validate', message, 'id', '', ErrorCodes.EMPTY_VALUE)
    this.name = 'InvalidIdError'
  }
}

/**
 * Error thrown when content is invalid.
 */
export class InvalidContentError extends ValidationError {
  constructor(component: string, message = 'content must be a string') {
    super(component, 'validate', message, 'content', undefined, ErrorCodes.VALIDATION)
    this.name = 'InvalidContentError'
  }
}

/**
 * Error thrown when a store is not initialized.
 */
export class StoreNotInitializedError extends DBError {
  readonly storeName: string

  constructor(storeName: string) {
    super(storeName, 'execute', 'not initialized. Call initialize() first.', ErrorCodes.NOT_AVAILABLE)
    this.name = 'StoreNotInitializedError'
  }
}

/**
 * Error thrown when a batch operation fails due to duplicate IDs.
 */
export class BatchDuplicateError extends DuplicateError {
  constructor(component: string) {
    super(component, 'batch create', 'duplicate ID', 'batch')
    this.name = 'BatchDuplicateError'
  }
}

// ============================================================================
// ERROR FACTORY FUNCTIONS
// ============================================================================

/**
 * Factory functions for creating standardized errors.
 *
 * @example
 * ```typescript
 * import { Errors } from './errors'
 *
 * throw Errors.documentExists('DocumentStore', 'doc-123')
 * throw Errors.invalidId('VectorStore')
 * throw Errors.relationshipExists('GraphStore', 'owns', 'from-id', 'to-id')
 * ```
 */
export const Errors = {
  // Duplicate errors
  documentExists: (component: string, id: string) => new DocumentExistsError(component, id),
  thingExists: (component: string, id: string) => new ThingExistsError(component, id),
  relationshipExists: (component: string, verb: string, from: string, to: string) =>
    new RelationshipExistsError(component, verb, from, to),
  vectorExists: (component: string, id: string) => new VectorExistsError(component, id),
  duplicate: (component: string, action: string, id: string, type?: string) =>
    new DuplicateError(component, action, id, type),
  batchDuplicate: (component: string) => new BatchDuplicateError(component),

  // Validation errors
  invalidId: (component: string, message?: string) => new InvalidIdError(component, message),
  invalidContent: (component: string, message?: string) => new InvalidContentError(component, message),
  emptyValue: (component: string, field: string) => new EmptyValueError(component, field),
  missingRequired: (component: string, field: string) => new MissingRequiredError(component, field),
  dimensionMismatch: (component: string, expected?: number, actual?: number) =>
    new DimensionMismatchError(component, expected, actual),
  validation: (component: string, action: string, reason: string, field?: string, value?: unknown) =>
    new ValidationError(component, action, reason, field, value),

  // Not found errors
  notFound: (component: string, action: string, id: string, type?: string) =>
    new NotFoundError(component, action, id, type),

  // State errors
  notInitialized: (storeName: string) => new StoreNotInitializedError(storeName),
  invalidState: (component: string, action: string, reason: string, currentState?: string) =>
    new InvalidStateError(component, action, reason, currentState),

  // Connection errors
  connectionNotAvailable: (component: string, action: string, reason?: string) =>
    new ConnectionError(component, action, reason),
} as const

// ============================================================================
// RE-EXPORT GRAPH ERRORS FOR CONVENIENCE
// ============================================================================

// Re-export commonly used graph errors
export {
  GraphError,
  NodeNotFoundError,
  EdgeNotFoundError,
  ThingNotFoundError,
  RelationshipNotFoundError,
  TypeNotFoundError,
  ConversationNotFoundError,
  EventNotFoundError,
  DuplicateNodeError,
  DuplicateThingError,
  DuplicateEdgeError,
  DuplicateRelationshipError,
  DuplicateAgentError,
  DuplicateWorkerError,
  ValidationError as GraphValidationError,
  InvalidModeError as GraphInvalidModeError,
  InvalidRoleError as GraphInvalidRoleError,
  InvalidKindError as GraphInvalidKindError,
  InvalidTierError as GraphInvalidTierError,
  InvalidStatusError as GraphInvalidStatusError,
  InvalidMessageError,
  InvalidParticipantsError,
  NotAParticipantError,
  ConnectionNotAvailableError,
} from './graph/errors'
