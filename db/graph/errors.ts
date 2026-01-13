/**
 * Graph Module - Unified Error Hierarchy
 *
 * This module provides a unified error hierarchy for the graph module.
 * All graph-related errors inherit from GraphError, enabling type-safe
 * error handling and consistent error messages across the module.
 *
 * Error Categories:
 * - GraphError (base): All graph module errors
 * - Not Found Errors: For missing entities
 * - Duplicate Errors: For constraint violations
 * - Validation Errors: For invalid input
 * - State Errors: For invalid state transitions
 * - Initialization Errors: For uninitialized stores
 *
 * @module db/graph/errors
 *
 * @example
 * ```typescript
 * import {
 *   GraphError,
 *   NodeNotFoundError,
 *   DuplicateNodeError,
 *   ValidationError,
 * } from './errors'
 *
 * try {
 *   await store.createThing({ id: 'thing-1', ... })
 * } catch (error) {
 *   if (error instanceof DuplicateNodeError) {
 *     console.log('Thing already exists:', error.nodeId)
 *   } else if (error instanceof GraphError) {
 *     console.log('Graph error:', error.message)
 *   }
 * }
 * ```
 */

// ============================================================================
// BASE ERROR
// ============================================================================

/**
 * Base error class for all graph module errors.
 *
 * All graph-related errors inherit from this class, enabling
 * unified error handling via `instanceof GraphError`.
 */
export class GraphError extends Error {
  /** Error code for programmatic handling */
  readonly code: string

  constructor(message: string, code = 'GRAPH_ERROR') {
    super(message)
    this.name = 'GraphError'
    this.code = code
    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}

// ============================================================================
// NOT FOUND ERRORS
// ============================================================================

/**
 * Error thrown when a node (Thing) is not found.
 */
export class NodeNotFoundError extends GraphError {
  /** The ID of the node that was not found */
  readonly nodeId: string

  constructor(id: string, message?: string) {
    super(message ?? `Node not found: ${id}`, 'NODE_NOT_FOUND')
    this.name = 'NodeNotFoundError'
    this.nodeId = id
  }
}

/**
 * Error thrown when an edge (Relationship) is not found.
 */
export class EdgeNotFoundError extends GraphError {
  /** The ID of the edge that was not found */
  readonly edgeId: string

  constructor(id: string, message?: string) {
    super(message ?? `Edge not found: ${id}`, 'EDGE_NOT_FOUND')
    this.name = 'EdgeNotFoundError'
    this.edgeId = id
  }
}

/**
 * Error thrown when a Thing is not found.
 * Alias for NodeNotFoundError with Thing-specific terminology.
 */
export class ThingNotFoundError extends GraphError {
  /** The ID of the thing that was not found */
  readonly thingId: string

  constructor(id: string, message?: string) {
    super(message ?? `Thing not found: ${id}`, 'THING_NOT_FOUND')
    this.name = 'ThingNotFoundError'
    this.thingId = id
  }
}

/**
 * Error thrown when a Relationship is not found.
 * Alias for EdgeNotFoundError with Relationship-specific terminology.
 */
export class RelationshipNotFoundError extends GraphError {
  /** The ID of the relationship that was not found */
  readonly relationshipId: string

  constructor(id: string, message?: string) {
    super(message ?? `Relationship not found: ${id}`, 'RELATIONSHIP_NOT_FOUND')
    this.name = 'RelationshipNotFoundError'
    this.relationshipId = id
  }
}

/**
 * Error thrown when a type (Noun) is not found.
 */
export class TypeNotFoundError extends GraphError {
  /** The name of the type that was not found */
  readonly typeName: string

  constructor(typeName: string, message?: string) {
    super(message ?? `Type '${typeName}' not found in nouns table`, 'TYPE_NOT_FOUND')
    this.name = 'TypeNotFoundError'
    this.typeName = typeName
  }
}

/**
 * Error thrown when a user is not found.
 */
export class UserNotFoundError extends GraphError {
  /** The ID of the user that was not found */
  readonly userId: string

  constructor(userId: string, message?: string) {
    super(message ?? `User not found: ${userId}`, 'USER_NOT_FOUND')
    this.name = 'UserNotFoundError'
    this.userId = userId
  }
}

/**
 * Error thrown when a role is not found.
 */
export class RoleNotFoundError extends GraphError {
  /** The ID of the role that was not found */
  readonly roleId: string

  constructor(roleId: string, message?: string) {
    super(message ?? `Role not found: ${roleId}`, 'ROLE_NOT_FOUND')
    this.name = 'RoleNotFoundError'
    this.roleId = roleId
  }
}

/**
 * Error thrown when an organization is not found.
 */
export class OrganizationNotFoundError extends GraphError {
  /** The ID of the organization that was not found */
  readonly orgId: string

  constructor(orgId: string, message?: string) {
    super(message ?? `Organization not found: ${orgId}`, 'ORGANIZATION_NOT_FOUND')
    this.name = 'OrganizationNotFoundError'
    this.orgId = orgId
  }
}

/**
 * Error thrown when a function is not found.
 */
export class FunctionNotFoundError extends GraphError {
  /** The ID of the function that was not found */
  readonly functionId: string

  constructor(functionId: string, message?: string) {
    super(message ?? `Function '${functionId}' not found`, 'FUNCTION_NOT_FOUND')
    this.name = 'FunctionNotFoundError'
    this.functionId = functionId
  }
}

/**
 * Error thrown when a workflow instance is not found.
 */
export class WorkflowInstanceNotFoundError extends GraphError {
  /** The ID of the workflow instance that was not found */
  readonly instanceId: string

  constructor(instanceId: string, message?: string) {
    super(message ?? `Instance not found: ${instanceId}`, 'WORKFLOW_INSTANCE_NOT_FOUND')
    this.name = 'WorkflowInstanceNotFoundError'
    this.instanceId = instanceId
  }
}

/**
 * Error thrown when an event is not found.
 */
export class EventNotFoundError extends GraphError {
  /** The ID of the event that was not found */
  readonly eventId: string

  constructor(eventId: string, message?: string) {
    super(message ?? `Event not found: ${eventId}`, 'EVENT_NOT_FOUND')
    this.name = 'EventNotFoundError'
    this.eventId = eventId
  }
}

/**
 * Error thrown when an action is not found.
 */
export class ActionNotFoundError extends GraphError {
  /** The ID of the action that was not found */
  readonly actionId: string

  constructor(actionId: string, message?: string) {
    super(message ?? `Action not found: ${actionId}`, 'ACTION_NOT_FOUND')
    this.name = 'ActionNotFoundError'
    this.actionId = actionId
  }
}

/**
 * Error thrown when a conversation is not found.
 */
export class ConversationNotFoundError extends GraphError {
  /** The ID of the conversation that was not found */
  readonly conversationId: string

  constructor(conversationId: string, message?: string) {
    super(message ?? `Conversation '${conversationId}' not found`, 'CONVERSATION_NOT_FOUND')
    this.name = 'ConversationNotFoundError'
    this.conversationId = conversationId
  }
}

/**
 * Error thrown when a step execution is not found.
 */
export class StepExecutionNotFoundError extends GraphError {
  /** The name of the step that was not found */
  readonly stepName: string
  /** The expected status of the step */
  readonly expectedStatus: string

  constructor(stepName: string, expectedStatus: string, message?: string) {
    super(message ?? `No ${expectedStatus} step execution found for ${stepName}`, 'STEP_EXECUTION_NOT_FOUND')
    this.name = 'StepExecutionNotFoundError'
    this.stepName = stepName
    this.expectedStatus = expectedStatus
  }
}

/**
 * Error thrown when an invitation is not found.
 */
export class InvitationNotFoundError extends GraphError {
  /** The ID of the invitation that was not found */
  readonly invitationId: string

  constructor(invitationId: string, message?: string) {
    super(message ?? `Invitation not found: ${invitationId}`, 'INVITATION_NOT_FOUND')
    this.name = 'InvitationNotFoundError'
    this.invitationId = invitationId
  }
}

/**
 * Error thrown when a Git ref is not found.
 */
export class RefNotFoundError extends GraphError {
  /** The name of the ref that was not found */
  readonly refName: string

  constructor(refName: string, message?: string) {
    super(message ?? `Ref '${refName}' not found`, 'REF_NOT_FOUND')
    this.name = 'RefNotFoundError'
    this.refName = refName
  }
}

// ============================================================================
// DUPLICATE / CONSTRAINT ERRORS
// ============================================================================

/**
 * Error thrown when attempting to create a duplicate node.
 */
export class DuplicateNodeError extends GraphError {
  /** The ID of the node that already exists */
  readonly nodeId: string

  constructor(id: string, message?: string) {
    super(message ?? `Node with ID '${id}' already exists`, 'DUPLICATE_NODE')
    this.name = 'DuplicateNodeError'
    this.nodeId = id
  }
}

/**
 * Error thrown when attempting to create a duplicate Thing.
 */
export class DuplicateThingError extends GraphError {
  /** The ID of the thing that already exists */
  readonly thingId: string

  constructor(id: string, message?: string) {
    super(message ?? `Thing with ID '${id}' already exists`, 'DUPLICATE_THING')
    this.name = 'DuplicateThingError'
    this.thingId = id
  }
}

/**
 * Error thrown when attempting to create a duplicate edge.
 */
export class DuplicateEdgeError extends GraphError {
  /** The verb of the duplicate relationship */
  readonly verb: string
  /** The source URL of the duplicate relationship */
  readonly from: string
  /** The target URL of the duplicate relationship */
  readonly to: string

  constructor(verb: string, from: string, to: string, message?: string) {
    super(
      message ?? `Relationship with verb '${verb}' from '${from}' to '${to}' already exists`,
      'DUPLICATE_EDGE'
    )
    this.name = 'DuplicateEdgeError'
    this.verb = verb
    this.from = from
    this.to = to
  }
}

/**
 * Error thrown when attempting to create a duplicate relationship.
 * Alias for DuplicateEdgeError with Relationship-specific terminology.
 */
export class DuplicateRelationshipError extends DuplicateEdgeError {
  constructor(verb: string, from: string, to: string, message?: string) {
    super(verb, from, to, message)
    this.name = 'DuplicateRelationshipError'
  }
}

/**
 * Error thrown when attempting to create a duplicate user.
 */
export class DuplicateUserError extends GraphError {
  /** The identifier (email or name) of the user that already exists */
  readonly identifier: string

  constructor(identifier: string, message?: string) {
    super(message ?? `User with email '${identifier}' already exists`, 'DUPLICATE_USER')
    this.name = 'DuplicateUserError'
    this.identifier = identifier
  }
}

/**
 * Error thrown when attempting to create a duplicate agent.
 */
export class DuplicateAgentError extends GraphError {
  /** The name of the agent that already exists */
  readonly agentName: string
  /** The ID of the existing agent (if known) */
  readonly existingId?: string

  constructor(agentName: string, existingId?: string, message?: string) {
    super(
      message ?? `Agent with name '${agentName}' already exists${existingId ? ` (ID: ${existingId})` : ''}`,
      'DUPLICATE_AGENT'
    )
    this.name = 'DuplicateAgentError'
    this.agentName = agentName
    this.existingId = existingId
  }
}

/**
 * Error thrown when attempting to create a duplicate worker.
 */
export class DuplicateWorkerError extends GraphError {
  /** The ID of the worker that already exists */
  readonly workerId: string

  constructor(workerId: string, message?: string) {
    super(message ?? `Worker with ID '${workerId}' already exists`, 'DUPLICATE_WORKER')
    this.name = 'DuplicateWorkerError'
    this.workerId = workerId
  }
}

/**
 * Error thrown when attempting to create a duplicate organization.
 */
export class DuplicateOrganizationError extends GraphError {
  /** The slug of the organization that already exists */
  readonly slug: string

  constructor(slug: string, message?: string) {
    super(message ?? `Organization with slug '${slug}' already exists`, 'DUPLICATE_ORGANIZATION')
    this.name = 'DuplicateOrganizationError'
    this.slug = slug
  }
}

// ============================================================================
// VALIDATION ERRORS
// ============================================================================

/**
 * Error thrown when input validation fails.
 */
export class ValidationError extends GraphError {
  /** The field that failed validation */
  readonly field?: string
  /** The value that was invalid */
  readonly value?: unknown

  constructor(message: string, field?: string, value?: unknown) {
    super(message, 'VALIDATION_ERROR')
    this.name = 'ValidationError'
    this.field = field
    this.value = value
  }
}

/**
 * Error thrown when a verb form is invalid.
 */
export class InvalidVerbFormError extends ValidationError {
  /** The verb that was invalid */
  readonly verb: string
  /** The expected verb form type */
  readonly expectedForm: string
  /** The actual verb form type */
  readonly actualForm: string

  constructor(verb: string, expectedForm: string, actualForm: string, message?: string) {
    super(
      message ??
        `Invalid verb form: '${verb}' is in ${actualForm} form. Use ${expectedForm} form (e.g., 'create', 'update', 'delete').`,
      'verb',
      verb
    )
    this.name = 'InvalidVerbFormError'
    this.verb = verb
    this.expectedForm = expectedForm
    this.actualForm = actualForm
  }
}

/**
 * Error thrown when an email format is invalid.
 */
export class InvalidEmailError extends ValidationError {
  /** The invalid email address */
  readonly email: string

  constructor(email: string, message?: string) {
    super(message ?? `Invalid email format: ${email}`, 'email', email)
    this.name = 'InvalidEmailError'
    this.email = email
  }
}

/**
 * Error thrown when a mode value is invalid.
 */
export class InvalidModeError extends ValidationError {
  /** The invalid mode value */
  readonly mode: string
  /** The list of valid modes */
  readonly validModes: string[]

  constructor(mode: string, validModes: string[], message?: string) {
    super(message ?? `Invalid agent mode: ${mode}. Valid modes are: ${validModes.join(', ')}`, 'mode', mode)
    this.name = 'InvalidModeError'
    this.mode = mode
    this.validModes = validModes
  }
}

/**
 * Error thrown when a message content is invalid.
 */
export class InvalidMessageError extends ValidationError {
  constructor(message?: string) {
    super(message ?? 'Message content cannot be empty', 'content')
    this.name = 'InvalidMessageError'
  }
}

/**
 * Error thrown when conversation participants are invalid.
 */
export class InvalidParticipantsError extends ValidationError {
  /** The number of participants provided */
  readonly count: number

  constructor(count: number, message?: string) {
    super(message ?? 'Conversation requires at least two participants', 'participants', count)
    this.name = 'InvalidParticipantsError'
    this.count = count
  }
}

/**
 * Error thrown when a participant is not part of a conversation.
 */
export class NotAParticipantError extends GraphError {
  /** The ID of the participant that was not found */
  readonly participantId: string
  /** The ID of the conversation */
  readonly conversationId: string

  constructor(participantId: string, conversationId: string, message?: string) {
    super(message ?? `'${participantId}' is not a participant in this conversation`, 'NOT_A_PARTICIPANT')
    this.name = 'NotAParticipantError'
    this.participantId = participantId
    this.conversationId = conversationId
  }
}

// ============================================================================
// STATE ERRORS
// ============================================================================

/**
 * Error thrown when an operation is attempted in an invalid state.
 */
export class InvalidStateError extends GraphError {
  /** The current state */
  readonly currentState: string
  /** The expected state(s) */
  readonly expectedStates: string[]
  /** The operation that was attempted */
  readonly operation: string

  constructor(operation: string, currentState: string, expectedStates: string[], message?: string) {
    super(
      message ?? `Cannot ${operation}: current state is ${currentState}, expected ${expectedStates.join(' or ')}`,
      'INVALID_STATE'
    )
    this.name = 'InvalidStateError'
    this.operation = operation
    this.currentState = currentState
    this.expectedStates = expectedStates
  }
}

/**
 * Error thrown when a cycle is detected in a graph operation.
 */
export class CycleDetectedError extends GraphError {
  /** The nodes involved in the cycle */
  readonly cycleNodes?: string[]

  constructor(message?: string, cycleNodes?: string[]) {
    super(message ?? 'Cycle detected in graph', 'CYCLE_DETECTED')
    this.name = 'CycleDetectedError'
    this.cycleNodes = cycleNodes
  }
}

/**
 * Error thrown when a workflow instance is in an invalid state for an operation.
 */
export class InvalidWorkflowStateError extends InvalidStateError {
  /** The ID of the workflow instance */
  readonly instanceId: string

  constructor(instanceId: string, operation: string, currentState: string, expectedStates: string[], message?: string) {
    super(
      operation,
      currentState,
      expectedStates,
      message ?? `Cannot ${operation} workflow instance ${instanceId}: status is ${currentState}, expected ${expectedStates.join(' or ')}`
    )
    this.name = 'InvalidWorkflowStateError'
    this.instanceId = instanceId
  }
}

/**
 * Error thrown when an invitation is in an invalid state.
 */
export class InvalidInvitationStateError extends InvalidStateError {
  /** The ID of the invitation */
  readonly invitationId: string

  constructor(invitationId: string, currentState: string, message?: string) {
    super('process', currentState, ['pending'], message ?? `Invitation is not pending: ${currentState}`)
    this.name = 'InvalidInvitationStateError'
    this.invitationId = invitationId
  }
}

/**
 * Error thrown when an invitation has expired.
 */
export class InvitationExpiredError extends GraphError {
  /** The ID of the expired invitation */
  readonly invitationId: string

  constructor(invitationId: string, message?: string) {
    super(message ?? 'Invitation has expired', 'INVITATION_EXPIRED')
    this.name = 'InvitationExpiredError'
    this.invitationId = invitationId
  }
}

/**
 * Error thrown when a user is not in the expected suspended state.
 */
export class NotSuspendedError extends GraphError {
  /** The entity type (user, organization, etc.) */
  readonly entityType: string
  /** The ID of the entity */
  readonly entityId: string

  constructor(entityType: string, entityId: string, message?: string) {
    super(message ?? `${entityType} ${entityId} is not suspended`, 'NOT_SUSPENDED')
    this.name = 'NotSuspendedError'
    this.entityType = entityType
    this.entityId = entityId
  }
}

/**
 * Error thrown when users attempt to follow themselves.
 */
export class SelfFollowError extends GraphError {
  /** The ID of the user */
  readonly userId: string

  constructor(userId: string, message?: string) {
    super(message ?? 'Users cannot follow themselves', 'SELF_FOLLOW')
    this.name = 'SelfFollowError'
    this.userId = userId
  }
}

// ============================================================================
// INITIALIZATION ERRORS
// ============================================================================

/**
 * Error thrown when a store is not initialized.
 */
export class StoreNotInitializedError extends GraphError {
  /** The name of the store that was not initialized */
  readonly storeName: string

  constructor(storeName: string, message?: string) {
    super(message ?? `${storeName} not initialized. Call initialize() first.`, 'STORE_NOT_INITIALIZED')
    this.name = 'StoreNotInitializedError'
    this.storeName = storeName
  }
}

/**
 * Error thrown when a SQLite connection is not available.
 */
export class ConnectionNotAvailableError extends GraphError {
  constructor(message?: string) {
    super(message ?? 'SQLite connection not available. Make sure the store is initialized.', 'CONNECTION_NOT_AVAILABLE')
    this.name = 'ConnectionNotAvailableError'
  }
}

/**
 * Error thrown when a workflow template is not created.
 */
export class TemplateNotCreatedError extends GraphError {
  constructor(message?: string) {
    super(message ?? 'Must call createTemplate() first', 'TEMPLATE_NOT_CREATED')
    this.name = 'TemplateNotCreatedError'
  }
}

/**
 * Error thrown when a workflow instance is not loaded.
 */
export class WorkflowNotLoadedError extends GraphError {
  constructor(message?: string) {
    super(message ?? 'No workflow instance. Call initialize() or load() first.', 'WORKFLOW_NOT_LOADED')
    this.name = 'WorkflowNotLoadedError'
  }
}

// ============================================================================
// FILE SYSTEM ERRORS
// ============================================================================

/**
 * Error thrown when a file or directory is not found.
 */
export class FileNotFoundError extends GraphError {
  /** The path that was not found */
  readonly path: string

  constructor(path: string, message?: string) {
    super(message ?? `ENOENT: no such file '${path}'`, 'FILE_NOT_FOUND')
    this.name = 'FileNotFoundError'
    this.path = path
  }
}

/**
 * Error thrown when a file already exists.
 */
export class FileExistsError extends GraphError {
  /** The path that already exists */
  readonly path: string

  constructor(path: string, message?: string) {
    super(message ?? `EEXIST: '${path}' already exists as a file`, 'FILE_EXISTS')
    this.name = 'FileExistsError'
    this.path = path
  }
}

/**
 * Error thrown when a directory is not empty.
 */
export class DirectoryNotEmptyError extends GraphError {
  /** The path of the non-empty directory */
  readonly path: string

  constructor(path: string, message?: string) {
    super(message ?? `ENOTEMPTY: directory '${path}' is not empty`, 'DIRECTORY_NOT_EMPTY')
    this.name = 'DirectoryNotEmptyError'
    this.path = path
  }
}

/**
 * Error thrown when an operation is not permitted.
 */
export class PermissionError extends GraphError {
  /** The operation that was not permitted */
  readonly operation: string

  constructor(operation: string, message?: string) {
    super(message ?? `EPERM: ${operation} not permitted`, 'PERMISSION_DENIED')
    this.name = 'PermissionError'
    this.operation = operation
  }
}

// ============================================================================
// BATCH OPERATION ERRORS
// ============================================================================

/**
 * Error thrown when a batch operation fails.
 */
export class BatchOperationError extends GraphError {
  /** The type of batch operation that failed */
  readonly operationType: string
  /** The number of items that failed */
  readonly failedCount?: number

  constructor(operationType: string, message?: string, failedCount?: number) {
    super(message ?? `Batch ${operationType} failed`, 'BATCH_OPERATION_FAILED')
    this.name = 'BatchOperationError'
    this.operationType = operationType
    this.failedCount = failedCount
  }
}

// ============================================================================
// DELIVERY ERRORS
// ============================================================================

/**
 * Error thrown when event delivery fails.
 */
export class DeliveryError extends GraphError {
  /** Whether the failure is transient and can be retried */
  readonly transient: boolean

  constructor(message: string, transient = false) {
    super(message, transient ? 'DELIVERY_TRANSIENT_ERROR' : 'DELIVERY_ERROR')
    this.name = 'DeliveryError'
    this.transient = transient
  }
}

/**
 * Error thrown when pipeline delivery fails.
 */
export class PipelineDeliveryError extends DeliveryError {
  constructor(message?: string) {
    super(message ?? 'Pipeline delivery failed', false)
    this.name = 'PipelineDeliveryError'
  }
}

// ============================================================================
// FACTORY ERRORS
// ============================================================================

/**
 * Error thrown when an unknown backend is specified.
 */
export class UnknownBackendError extends GraphError {
  /** The backend that was not recognized */
  readonly backend: string
  /** The list of supported backends */
  readonly supportedBackends: string[]

  constructor(backend: string, supportedBackends: string[], message?: string) {
    super(
      message ?? `Unknown GraphStore backend: ${backend}. Supported backends: ${supportedBackends.join(', ')}`,
      'UNKNOWN_BACKEND'
    )
    this.name = 'UnknownBackendError'
    this.backend = backend
    this.supportedBackends = supportedBackends
  }
}

/**
 * Error thrown when an incompatible configuration is provided.
 */
export class ConfigurationError extends GraphError {
  /** The configuration field that was invalid */
  readonly field: string

  constructor(field: string, message: string) {
    super(message, 'CONFIGURATION_ERROR')
    this.name = 'ConfigurationError'
    this.field = field
  }
}

// ============================================================================
// APPROVAL WORKFLOW ERRORS
// ============================================================================

/**
 * Error thrown when an approval request is not found.
 */
export class ApprovalRequestNotFoundError extends GraphError {
  /** The ID of the approval request that was not found */
  readonly requestId: string

  constructor(requestId: string, message?: string) {
    super(message ?? `Approval request not found: ${requestId}`, 'APPROVAL_REQUEST_NOT_FOUND')
    this.name = 'ApprovalRequestNotFoundError'
    this.requestId = requestId
  }
}

/**
 * Error thrown when an approval relationship is not found.
 */
export class ApprovalRelationshipNotFoundError extends GraphError {
  /** The ID of the approval request */
  readonly requestId: string

  constructor(requestId: string, message?: string) {
    super(message ?? `No approval relationship found for request ${requestId}`, 'APPROVAL_RELATIONSHIP_NOT_FOUND')
    this.name = 'ApprovalRelationshipNotFoundError'
    this.requestId = requestId
  }
}

/**
 * Error thrown when an approval request is in an invalid state.
 */
export class InvalidApprovalStateError extends InvalidStateError {
  /** The ID of the approval request */
  readonly requestId: string

  constructor(requestId: string, operation: string, currentState: string, expectedStates: string[], message?: string) {
    super(
      operation,
      currentState,
      expectedStates,
      message ?? `Cannot ${operation}: request is ${currentState}, expected ${expectedStates.join(' or ')}`
    )
    this.name = 'InvalidApprovalStateError'
    this.requestId = requestId
  }
}

/**
 * Error thrown when attempting to expire a request that is not past SLA.
 */
export class NotPastSlaError extends GraphError {
  /** The ID of the request */
  readonly requestId: string

  constructor(requestId: string, message?: string) {
    super(message ?? 'Cannot expire: request is not past SLA', 'NOT_PAST_SLA')
    this.name = 'NotPastSlaError'
    this.requestId = requestId
  }
}

// ============================================================================
// EVENT TYPE ERROR
// ============================================================================

/**
 * Error thrown when a relationship is not an event (wrong verb form).
 */
export class NotAnEventError extends GraphError {
  /** The ID of the relationship */
  readonly relationshipId: string
  /** The verb of the relationship */
  readonly verb: string
  /** The form type of the verb */
  readonly verbFormType: string

  constructor(relationshipId: string, verb: string, verbFormType: string, message?: string) {
    super(
      message ?? `Relationship '${relationshipId}' is not an event (verb '${verb}' is in ${verbFormType} form)`,
      'NOT_AN_EVENT'
    )
    this.name = 'NotAnEventError'
    this.relationshipId = relationshipId
    this.verb = verb
    this.verbFormType = verbFormType
  }
}
