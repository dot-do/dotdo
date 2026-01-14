/**
 * Error Handling Audit Tests - Graph Module
 *
 * Audit and document error handling patterns across the graph module.
 * This test file verifies:
 *
 * 1. All errors extend GraphError (proper hierarchy)
 * 2. Errors preserve stack traces
 * 3. Error messages are consistent and descriptive
 * 4. Error codes are present and follow conventions
 * 5. Error properties are accessible and typed
 *
 * @see dotdo-q2m06 - [REFACTOR] Error Handling Consistency
 *
 * NO MOCKS - Tests use real error instantiation
 *
 * @module db/graph/tests/error-handling-audit.test.ts
 */

import { describe, it, expect } from 'vitest'
import {
  // Base error
  GraphError,
  // Not found errors
  NodeNotFoundError,
  EdgeNotFoundError,
  ThingNotFoundError,
  RelationshipNotFoundError,
  TypeNotFoundError,
  UserNotFoundError,
  RoleNotFoundError,
  OrganizationNotFoundError,
  FunctionNotFoundError,
  WorkflowInstanceNotFoundError,
  EventNotFoundError,
  ActionNotFoundError,
  ConversationNotFoundError,
  StepExecutionNotFoundError,
  InvitationNotFoundError,
  RefNotFoundError,
  // Duplicate/constraint errors
  DuplicateNodeError,
  DuplicateThingError,
  DuplicateEdgeError,
  DuplicateRelationshipError,
  DuplicateUserError,
  DuplicateAgentError,
  DuplicateWorkerError,
  DuplicateOrganizationError,
  // Validation errors
  ValidationError,
  InvalidVerbFormError,
  InvalidEmailError,
  InvalidModeError,
  InvalidMessageError,
  InvalidParticipantsError,
  NotAParticipantError,
  // State errors
  InvalidStateError,
  CycleDetectedError,
  InvalidWorkflowStateError,
  InvalidInvitationStateError,
  InvitationExpiredError,
  NotSuspendedError,
  SelfFollowError,
  // Initialization errors
  StoreNotInitializedError,
  ConnectionNotAvailableError,
  TemplateNotCreatedError,
  WorkflowNotLoadedError,
  // File system errors
  FileNotFoundError,
  FileExistsError,
  DirectoryNotEmptyError,
  PermissionError,
  // Batch operation errors
  BatchOperationError,
  // Delivery errors
  DeliveryError,
  PipelineDeliveryError,
  // Factory errors
  UnknownBackendError,
  ConfigurationError,
  // Approval workflow errors
  ApprovalRequestNotFoundError,
  ApprovalRelationshipNotFoundError,
  InvalidApprovalStateError,
  NotPastSlaError,
  // Event type errors
  NotAnEventError,
} from '../errors'

// ============================================================================
// ERROR HIERARCHY TESTS
// ============================================================================

describe('Error Handling Consistency', () => {
  describe('Error Hierarchy', () => {
    describe('Base GraphError', () => {
      it('GraphError should extend Error', () => {
        const error = new GraphError('test message')
        expect(error).toBeInstanceOf(Error)
        expect(error).toBeInstanceOf(GraphError)
      })

      it('GraphError should have name property', () => {
        const error = new GraphError('test message')
        expect(error.name).toBe('GraphError')
      })

      it('GraphError should have code property', () => {
        const error = new GraphError('test message', 'CUSTOM_CODE')
        expect(error.code).toBe('CUSTOM_CODE')
      })

      it('GraphError should default code to GRAPH_ERROR', () => {
        const error = new GraphError('test message')
        expect(error.code).toBe('GRAPH_ERROR')
      })
    })

    describe('Not Found Errors', () => {
      it('ThingNotFoundError should extend GraphError', () => {
        const error = new ThingNotFoundError('test-id')
        expect(error).toBeInstanceOf(GraphError)
        expect(error).toBeInstanceOf(Error)
      })

      it('NodeNotFoundError should extend GraphError', () => {
        const error = new NodeNotFoundError('test-id')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('EdgeNotFoundError should extend GraphError', () => {
        const error = new EdgeNotFoundError('test-id')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('RelationshipNotFoundError should extend GraphError', () => {
        const error = new RelationshipNotFoundError('test-id')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('TypeNotFoundError should extend GraphError', () => {
        const error = new TypeNotFoundError('Customer')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('UserNotFoundError should extend GraphError', () => {
        const error = new UserNotFoundError('user-123')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('RoleNotFoundError should extend GraphError', () => {
        const error = new RoleNotFoundError('admin')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('OrganizationNotFoundError should extend GraphError', () => {
        const error = new OrganizationNotFoundError('org-123')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('FunctionNotFoundError should extend GraphError', () => {
        const error = new FunctionNotFoundError('processOrder')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('WorkflowInstanceNotFoundError should extend GraphError', () => {
        const error = new WorkflowInstanceNotFoundError('instance-123')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('EventNotFoundError should extend GraphError', () => {
        const error = new EventNotFoundError('event-123')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('ActionNotFoundError should extend GraphError', () => {
        const error = new ActionNotFoundError('action-123')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('ConversationNotFoundError should extend GraphError', () => {
        const error = new ConversationNotFoundError('conv-123')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('StepExecutionNotFoundError should extend GraphError', () => {
        const error = new StepExecutionNotFoundError('processPayment', 'pending')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('InvitationNotFoundError should extend GraphError', () => {
        const error = new InvitationNotFoundError('invite-123')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('RefNotFoundError should extend GraphError', () => {
        const error = new RefNotFoundError('refs/heads/main')
        expect(error).toBeInstanceOf(GraphError)
      })
    })

    describe('Duplicate/Constraint Errors', () => {
      it('DuplicateNodeError should extend GraphError', () => {
        const error = new DuplicateNodeError('node-123')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('DuplicateThingError should extend GraphError', () => {
        const error = new DuplicateThingError('thing-123')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('DuplicateEdgeError should extend GraphError', () => {
        const error = new DuplicateEdgeError('purchased', 'from-url', 'to-url')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('DuplicateRelationshipError should extend DuplicateEdgeError', () => {
        const error = new DuplicateRelationshipError('follows', 'from-url', 'to-url')
        expect(error).toBeInstanceOf(DuplicateEdgeError)
        expect(error).toBeInstanceOf(GraphError)
      })

      it('DuplicateUserError should extend GraphError', () => {
        const error = new DuplicateUserError('alice@example.com')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('DuplicateAgentError should extend GraphError', () => {
        const error = new DuplicateAgentError('ralph')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('DuplicateWorkerError should extend GraphError', () => {
        const error = new DuplicateWorkerError('worker-123')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('DuplicateOrganizationError should extend GraphError', () => {
        const error = new DuplicateOrganizationError('acme')
        expect(error).toBeInstanceOf(GraphError)
      })
    })

    describe('Validation Errors', () => {
      it('ValidationError should extend GraphError', () => {
        const error = new ValidationError('Invalid input')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('InvalidVerbFormError should extend ValidationError', () => {
        const error = new InvalidVerbFormError('creating', 'base', 'progressive')
        expect(error).toBeInstanceOf(ValidationError)
        expect(error).toBeInstanceOf(GraphError)
      })

      it('InvalidEmailError should extend ValidationError', () => {
        const error = new InvalidEmailError('not-an-email')
        expect(error).toBeInstanceOf(ValidationError)
        expect(error).toBeInstanceOf(GraphError)
      })

      it('InvalidModeError should extend ValidationError', () => {
        const error = new InvalidModeError('invalid', ['auto', 'manual'])
        expect(error).toBeInstanceOf(ValidationError)
        expect(error).toBeInstanceOf(GraphError)
      })

      it('InvalidMessageError should extend ValidationError', () => {
        const error = new InvalidMessageError()
        expect(error).toBeInstanceOf(ValidationError)
        expect(error).toBeInstanceOf(GraphError)
      })

      it('InvalidParticipantsError should extend ValidationError', () => {
        const error = new InvalidParticipantsError(1)
        expect(error).toBeInstanceOf(ValidationError)
        expect(error).toBeInstanceOf(GraphError)
      })

      it('NotAParticipantError should extend GraphError', () => {
        const error = new NotAParticipantError('user-123', 'conv-456')
        expect(error).toBeInstanceOf(GraphError)
      })
    })

    describe('State Errors', () => {
      it('InvalidStateError should extend GraphError', () => {
        const error = new InvalidStateError('complete', 'pending', ['running'])
        expect(error).toBeInstanceOf(GraphError)
      })

      it('CycleDetectedError should extend GraphError', () => {
        const error = new CycleDetectedError()
        expect(error).toBeInstanceOf(GraphError)
      })

      it('InvalidWorkflowStateError should extend InvalidStateError', () => {
        const error = new InvalidWorkflowStateError('wf-123', 'cancel', 'completed', ['running', 'paused'])
        expect(error).toBeInstanceOf(InvalidStateError)
        expect(error).toBeInstanceOf(GraphError)
      })

      it('InvalidInvitationStateError should extend InvalidStateError', () => {
        const error = new InvalidInvitationStateError('invite-123', 'accepted')
        expect(error).toBeInstanceOf(InvalidStateError)
        expect(error).toBeInstanceOf(GraphError)
      })

      it('InvitationExpiredError should extend GraphError', () => {
        const error = new InvitationExpiredError('invite-123')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('NotSuspendedError should extend GraphError', () => {
        const error = new NotSuspendedError('user', 'user-123')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('SelfFollowError should extend GraphError', () => {
        const error = new SelfFollowError('user-123')
        expect(error).toBeInstanceOf(GraphError)
      })
    })

    describe('Initialization Errors', () => {
      it('StoreNotInitializedError should extend GraphError', () => {
        const error = new StoreNotInitializedError('ThingsStore')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('ConnectionNotAvailableError should extend GraphError', () => {
        const error = new ConnectionNotAvailableError()
        expect(error).toBeInstanceOf(GraphError)
      })

      it('TemplateNotCreatedError should extend GraphError', () => {
        const error = new TemplateNotCreatedError()
        expect(error).toBeInstanceOf(GraphError)
      })

      it('WorkflowNotLoadedError should extend GraphError', () => {
        const error = new WorkflowNotLoadedError()
        expect(error).toBeInstanceOf(GraphError)
      })
    })

    describe('File System Errors', () => {
      it('FileNotFoundError should extend GraphError', () => {
        const error = new FileNotFoundError('/path/to/file.txt')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('FileExistsError should extend GraphError', () => {
        const error = new FileExistsError('/path/to/file.txt')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('DirectoryNotEmptyError should extend GraphError', () => {
        const error = new DirectoryNotEmptyError('/path/to/dir')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('PermissionError should extend GraphError', () => {
        const error = new PermissionError('write')
        expect(error).toBeInstanceOf(GraphError)
      })
    })

    describe('Batch Operation Errors', () => {
      it('BatchOperationError should extend GraphError', () => {
        const error = new BatchOperationError('delete')
        expect(error).toBeInstanceOf(GraphError)
      })
    })

    describe('Delivery Errors', () => {
      it('DeliveryError should extend GraphError', () => {
        const error = new DeliveryError('Failed to deliver event')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('PipelineDeliveryError should extend DeliveryError', () => {
        const error = new PipelineDeliveryError()
        expect(error).toBeInstanceOf(DeliveryError)
        expect(error).toBeInstanceOf(GraphError)
      })
    })

    describe('Factory Errors', () => {
      it('UnknownBackendError should extend GraphError', () => {
        const error = new UnknownBackendError('redis', ['sqlite', 'document'])
        expect(error).toBeInstanceOf(GraphError)
      })

      it('ConfigurationError should extend GraphError', () => {
        const error = new ConfigurationError('connectionString', 'Connection string is required')
        expect(error).toBeInstanceOf(GraphError)
      })
    })

    describe('Approval Workflow Errors', () => {
      it('ApprovalRequestNotFoundError should extend GraphError', () => {
        const error = new ApprovalRequestNotFoundError('request-123')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('ApprovalRelationshipNotFoundError should extend GraphError', () => {
        const error = new ApprovalRelationshipNotFoundError('request-123')
        expect(error).toBeInstanceOf(GraphError)
      })

      it('InvalidApprovalStateError should extend InvalidStateError', () => {
        const error = new InvalidApprovalStateError('request-123', 'approve', 'rejected', ['pending'])
        expect(error).toBeInstanceOf(InvalidStateError)
        expect(error).toBeInstanceOf(GraphError)
      })

      it('NotPastSlaError should extend GraphError', () => {
        const error = new NotPastSlaError('request-123')
        expect(error).toBeInstanceOf(GraphError)
      })
    })

    describe('Event Type Errors', () => {
      it('NotAnEventError should extend GraphError', () => {
        const error = new NotAnEventError('rel-123', 'create', 'base')
        expect(error).toBeInstanceOf(GraphError)
      })
    })
  })

  // ============================================================================
  // STACK TRACE PRESERVATION TESTS
  // ============================================================================

  describe('Stack Trace Preservation', () => {
    it('GraphError should preserve stack trace', () => {
      const error = new GraphError('test error')
      expect(error.stack).toBeDefined()
      expect(error.stack).toContain('GraphError')
    })

    it('ThingNotFoundError should preserve stack trace', () => {
      const error = new ThingNotFoundError('test-id')
      expect(error.stack).toBeDefined()
      expect(error.stack).toContain('ThingNotFoundError')
    })

    it('ValidationError should preserve stack trace', () => {
      const error = new ValidationError('Invalid input')
      expect(error.stack).toBeDefined()
      expect(error.stack).toContain('ValidationError')
    })

    it('InvalidStateError should preserve stack trace', () => {
      const error = new InvalidStateError('transition', 'current', ['expected'])
      expect(error.stack).toBeDefined()
      expect(error.stack).toContain('InvalidStateError')
    })

    it('DuplicateEdgeError should preserve stack trace', () => {
      const error = new DuplicateEdgeError('verb', 'from', 'to')
      expect(error.stack).toBeDefined()
      expect(error.stack).toContain('DuplicateEdgeError')
    })

    it('stack trace should point to the throw location', () => {
      function innerFunction(): never {
        throw new ThingNotFoundError('nested-error')
      }

      function outerFunction(): never {
        innerFunction()
      }

      try {
        outerFunction()
      } catch (error) {
        expect(error).toBeInstanceOf(ThingNotFoundError)
        expect((error as Error).stack).toContain('innerFunction')
      }
    })
  })

  // ============================================================================
  // ERROR MESSAGE CONSISTENCY TESTS
  // ============================================================================

  describe('Error Message Consistency', () => {
    describe('Not Found Errors should include ID', () => {
      it('ThingNotFoundError message includes ID', () => {
        const error = new ThingNotFoundError('thing-abc-123')
        expect(error.message).toContain('thing-abc-123')
      })

      it('NodeNotFoundError message includes ID', () => {
        const error = new NodeNotFoundError('node-xyz')
        expect(error.message).toContain('node-xyz')
      })

      it('EdgeNotFoundError message includes ID', () => {
        const error = new EdgeNotFoundError('edge-456')
        expect(error.message).toContain('edge-456')
      })

      it('UserNotFoundError message includes user ID', () => {
        const error = new UserNotFoundError('user-alice')
        expect(error.message).toContain('user-alice')
      })

      it('OrganizationNotFoundError message includes org ID', () => {
        const error = new OrganizationNotFoundError('org-acme')
        expect(error.message).toContain('org-acme')
      })

      it('FunctionNotFoundError message includes function ID', () => {
        const error = new FunctionNotFoundError('myFunction')
        expect(error.message).toContain('myFunction')
      })
    })

    describe('Duplicate Errors should include identifier', () => {
      it('DuplicateThingError message includes ID', () => {
        const error = new DuplicateThingError('duplicate-id')
        expect(error.message).toContain('duplicate-id')
      })

      it('DuplicateEdgeError message includes verb and URLs', () => {
        const error = new DuplicateEdgeError('purchased', 'do://t/customers/alice', 'do://t/products/widget')
        expect(error.message).toContain('purchased')
        expect(error.message).toContain('do://t/customers/alice')
        expect(error.message).toContain('do://t/products/widget')
      })

      it('DuplicateUserError message includes identifier', () => {
        const error = new DuplicateUserError('alice@example.com')
        expect(error.message).toContain('alice@example.com')
      })

      it('DuplicateAgentError message includes agent name', () => {
        const error = new DuplicateAgentError('ralph', 'agent-123')
        expect(error.message).toContain('ralph')
        expect(error.message).toContain('agent-123')
      })
    })

    describe('Validation Errors should describe the issue', () => {
      it('ValidationError accepts custom message', () => {
        const error = new ValidationError('Custom validation message')
        expect(error.message).toBe('Custom validation message')
      })

      it('InvalidEmailError message includes invalid email', () => {
        const error = new InvalidEmailError('not-valid')
        expect(error.message).toContain('not-valid')
      })

      it('InvalidModeError message includes mode and valid options', () => {
        const error = new InvalidModeError('invalid-mode', ['auto', 'manual', 'hybrid'])
        expect(error.message).toContain('invalid-mode')
        expect(error.message).toContain('auto')
        expect(error.message).toContain('manual')
        expect(error.message).toContain('hybrid')
      })

      it('InvalidVerbFormError message includes verb and forms', () => {
        const error = new InvalidVerbFormError('creating', 'base', 'progressive')
        expect(error.message).toContain('creating')
        expect(error.message).toContain('progressive')
        expect(error.message).toContain('base')
      })
    })

    describe('State Errors should describe the state issue', () => {
      it('InvalidStateError message includes operation and states', () => {
        const error = new InvalidStateError('cancel', 'completed', ['running', 'paused'])
        expect(error.message).toContain('cancel')
        expect(error.message).toContain('completed')
        expect(error.message).toContain('running')
        expect(error.message).toContain('paused')
      })

      it('InvalidWorkflowStateError message includes instance ID', () => {
        const error = new InvalidWorkflowStateError('wf-instance-123', 'resume', 'completed', ['paused'])
        expect(error.message).toContain('wf-instance-123')
      })

      it('CycleDetectedError has default message', () => {
        const error = new CycleDetectedError()
        expect(error.message).toContain('Cycle detected')
      })

      it('CycleDetectedError can include cycle nodes', () => {
        const error = new CycleDetectedError('Cycle found: A -> B -> C -> A', ['A', 'B', 'C'])
        expect(error.message).toContain('A -> B -> C -> A')
        expect(error.cycleNodes).toEqual(['A', 'B', 'C'])
      })
    })

    describe('File System Errors should follow POSIX conventions', () => {
      it('FileNotFoundError message includes ENOENT', () => {
        const error = new FileNotFoundError('/path/to/missing.txt')
        expect(error.message).toContain('ENOENT')
        expect(error.message).toContain('/path/to/missing.txt')
      })

      it('FileExistsError message includes EEXIST', () => {
        const error = new FileExistsError('/path/to/existing.txt')
        expect(error.message).toContain('EEXIST')
        expect(error.message).toContain('/path/to/existing.txt')
      })

      it('DirectoryNotEmptyError message includes ENOTEMPTY', () => {
        const error = new DirectoryNotEmptyError('/path/to/dir')
        expect(error.message).toContain('ENOTEMPTY')
        expect(error.message).toContain('/path/to/dir')
      })

      it('PermissionError message includes EPERM', () => {
        const error = new PermissionError('delete')
        expect(error.message).toContain('EPERM')
        expect(error.message).toContain('delete')
      })
    })
  })

  // ============================================================================
  // ERROR CODE TESTS
  // ============================================================================

  describe('Error Codes', () => {
    describe('Not Found Error Codes', () => {
      it('ThingNotFoundError has code THING_NOT_FOUND', () => {
        const error = new ThingNotFoundError('id')
        expect(error.code).toBe('THING_NOT_FOUND')
      })

      it('NodeNotFoundError has code NODE_NOT_FOUND', () => {
        const error = new NodeNotFoundError('id')
        expect(error.code).toBe('NODE_NOT_FOUND')
      })

      it('EdgeNotFoundError has code EDGE_NOT_FOUND', () => {
        const error = new EdgeNotFoundError('id')
        expect(error.code).toBe('EDGE_NOT_FOUND')
      })

      it('UserNotFoundError has code USER_NOT_FOUND', () => {
        const error = new UserNotFoundError('id')
        expect(error.code).toBe('USER_NOT_FOUND')
      })

      it('OrganizationNotFoundError has code ORGANIZATION_NOT_FOUND', () => {
        const error = new OrganizationNotFoundError('id')
        expect(error.code).toBe('ORGANIZATION_NOT_FOUND')
      })
    })

    describe('Duplicate Error Codes', () => {
      it('DuplicateNodeError has code DUPLICATE_NODE', () => {
        const error = new DuplicateNodeError('id')
        expect(error.code).toBe('DUPLICATE_NODE')
      })

      it('DuplicateThingError has code DUPLICATE_THING', () => {
        const error = new DuplicateThingError('id')
        expect(error.code).toBe('DUPLICATE_THING')
      })

      it('DuplicateEdgeError has code DUPLICATE_EDGE', () => {
        const error = new DuplicateEdgeError('v', 'f', 't')
        expect(error.code).toBe('DUPLICATE_EDGE')
      })

      it('DuplicateUserError has code DUPLICATE_USER', () => {
        const error = new DuplicateUserError('email')
        expect(error.code).toBe('DUPLICATE_USER')
      })
    })

    describe('Validation Error Codes', () => {
      it('ValidationError has code VALIDATION_ERROR', () => {
        const error = new ValidationError('msg')
        expect(error.code).toBe('VALIDATION_ERROR')
      })
    })

    describe('State Error Codes', () => {
      it('InvalidStateError has code INVALID_STATE', () => {
        const error = new InvalidStateError('op', 'cur', ['exp'])
        expect(error.code).toBe('INVALID_STATE')
      })

      it('CycleDetectedError has code CYCLE_DETECTED', () => {
        const error = new CycleDetectedError()
        expect(error.code).toBe('CYCLE_DETECTED')
      })
    })

    describe('Initialization Error Codes', () => {
      it('StoreNotInitializedError has code STORE_NOT_INITIALIZED', () => {
        const error = new StoreNotInitializedError('Store')
        expect(error.code).toBe('STORE_NOT_INITIALIZED')
      })

      it('ConnectionNotAvailableError has code CONNECTION_NOT_AVAILABLE', () => {
        const error = new ConnectionNotAvailableError()
        expect(error.code).toBe('CONNECTION_NOT_AVAILABLE')
      })
    })

    describe('File System Error Codes', () => {
      it('FileNotFoundError has code FILE_NOT_FOUND', () => {
        const error = new FileNotFoundError('/path')
        expect(error.code).toBe('FILE_NOT_FOUND')
      })

      it('FileExistsError has code FILE_EXISTS', () => {
        const error = new FileExistsError('/path')
        expect(error.code).toBe('FILE_EXISTS')
      })

      it('DirectoryNotEmptyError has code DIRECTORY_NOT_EMPTY', () => {
        const error = new DirectoryNotEmptyError('/path')
        expect(error.code).toBe('DIRECTORY_NOT_EMPTY')
      })

      it('PermissionError has code PERMISSION_DENIED', () => {
        const error = new PermissionError('op')
        expect(error.code).toBe('PERMISSION_DENIED')
      })
    })

    describe('Delivery Error Codes', () => {
      it('DeliveryError has code DELIVERY_ERROR for permanent failures', () => {
        const error = new DeliveryError('Failed', false)
        expect(error.code).toBe('DELIVERY_ERROR')
      })

      it('DeliveryError has code DELIVERY_TRANSIENT_ERROR for transient failures', () => {
        const error = new DeliveryError('Retry later', true)
        expect(error.code).toBe('DELIVERY_TRANSIENT_ERROR')
      })
    })
  })

  // ============================================================================
  // ERROR PROPERTY TESTS
  // ============================================================================

  describe('Error Properties', () => {
    describe('Not Found Errors have ID properties', () => {
      it('ThingNotFoundError has thingId property', () => {
        const error = new ThingNotFoundError('thing-123')
        expect(error.thingId).toBe('thing-123')
      })

      it('NodeNotFoundError has nodeId property', () => {
        const error = new NodeNotFoundError('node-456')
        expect(error.nodeId).toBe('node-456')
      })

      it('EdgeNotFoundError has edgeId property', () => {
        const error = new EdgeNotFoundError('edge-789')
        expect(error.edgeId).toBe('edge-789')
      })

      it('UserNotFoundError has userId property', () => {
        const error = new UserNotFoundError('user-abc')
        expect(error.userId).toBe('user-abc')
      })

      it('OrganizationNotFoundError has orgId property', () => {
        const error = new OrganizationNotFoundError('org-xyz')
        expect(error.orgId).toBe('org-xyz')
      })

      it('TypeNotFoundError has typeName property', () => {
        const error = new TypeNotFoundError('Customer')
        expect(error.typeName).toBe('Customer')
      })
    })

    describe('Duplicate Errors have identifier properties', () => {
      it('DuplicateNodeError has nodeId property', () => {
        const error = new DuplicateNodeError('dup-node')
        expect(error.nodeId).toBe('dup-node')
      })

      it('DuplicateThingError has thingId property', () => {
        const error = new DuplicateThingError('dup-thing')
        expect(error.thingId).toBe('dup-thing')
      })

      it('DuplicateEdgeError has verb, from, to properties', () => {
        const error = new DuplicateEdgeError('purchased', 'from-url', 'to-url')
        expect(error.verb).toBe('purchased')
        expect(error.from).toBe('from-url')
        expect(error.to).toBe('to-url')
      })

      it('DuplicateUserError has identifier property', () => {
        const error = new DuplicateUserError('alice@test.com')
        expect(error.identifier).toBe('alice@test.com')
      })

      it('DuplicateAgentError has agentName and existingId properties', () => {
        const error = new DuplicateAgentError('ralph', 'existing-id-123')
        expect(error.agentName).toBe('ralph')
        expect(error.existingId).toBe('existing-id-123')
      })
    })

    describe('Validation Errors have field and value properties', () => {
      it('ValidationError has optional field property', () => {
        const error = new ValidationError('Invalid', 'email')
        expect(error.field).toBe('email')
      })

      it('ValidationError has optional value property', () => {
        const error = new ValidationError('Invalid', 'email', 'not-valid')
        expect(error.value).toBe('not-valid')
      })

      it('InvalidVerbFormError has verb, expectedForm, actualForm properties', () => {
        const error = new InvalidVerbFormError('creating', 'base', 'progressive')
        expect(error.verb).toBe('creating')
        expect(error.expectedForm).toBe('base')
        expect(error.actualForm).toBe('progressive')
      })

      it('InvalidEmailError has email property', () => {
        const error = new InvalidEmailError('bad-email')
        expect(error.email).toBe('bad-email')
      })

      it('InvalidModeError has mode and validModes properties', () => {
        const error = new InvalidModeError('invalid', ['auto', 'manual'])
        expect(error.mode).toBe('invalid')
        expect(error.validModes).toEqual(['auto', 'manual'])
      })
    })

    describe('State Errors have state-related properties', () => {
      it('InvalidStateError has operation, currentState, expectedStates properties', () => {
        const error = new InvalidStateError('cancel', 'completed', ['running', 'paused'])
        expect(error.operation).toBe('cancel')
        expect(error.currentState).toBe('completed')
        expect(error.expectedStates).toEqual(['running', 'paused'])
      })

      it('InvalidWorkflowStateError has instanceId property', () => {
        const error = new InvalidWorkflowStateError('wf-123', 'op', 'cur', ['exp'])
        expect(error.instanceId).toBe('wf-123')
      })

      it('CycleDetectedError has optional cycleNodes property', () => {
        const error = new CycleDetectedError('Cycle', ['A', 'B', 'C'])
        expect(error.cycleNodes).toEqual(['A', 'B', 'C'])
      })

      it('NotSuspendedError has entityType and entityId properties', () => {
        const error = new NotSuspendedError('user', 'user-123')
        expect(error.entityType).toBe('user')
        expect(error.entityId).toBe('user-123')
      })

      it('SelfFollowError has userId property', () => {
        const error = new SelfFollowError('user-123')
        expect(error.userId).toBe('user-123')
      })
    })

    describe('Initialization Errors have store-related properties', () => {
      it('StoreNotInitializedError has storeName property', () => {
        const error = new StoreNotInitializedError('ThingsStore')
        expect(error.storeName).toBe('ThingsStore')
      })
    })

    describe('File System Errors have path properties', () => {
      it('FileNotFoundError has path property', () => {
        const error = new FileNotFoundError('/missing/file.txt')
        expect(error.path).toBe('/missing/file.txt')
      })

      it('FileExistsError has path property', () => {
        const error = new FileExistsError('/existing/file.txt')
        expect(error.path).toBe('/existing/file.txt')
      })

      it('DirectoryNotEmptyError has path property', () => {
        const error = new DirectoryNotEmptyError('/non/empty/dir')
        expect(error.path).toBe('/non/empty/dir')
      })

      it('PermissionError has operation property', () => {
        const error = new PermissionError('write')
        expect(error.operation).toBe('write')
      })
    })

    describe('Delivery Errors have transient property', () => {
      it('DeliveryError has transient property for permanent failures', () => {
        const error = new DeliveryError('Failed permanently', false)
        expect(error.transient).toBe(false)
      })

      it('DeliveryError has transient property for transient failures', () => {
        const error = new DeliveryError('Temporary failure', true)
        expect(error.transient).toBe(true)
      })
    })

    describe('Factory Errors have configuration properties', () => {
      it('UnknownBackendError has backend and supportedBackends properties', () => {
        const error = new UnknownBackendError('redis', ['sqlite', 'document'])
        expect(error.backend).toBe('redis')
        expect(error.supportedBackends).toEqual(['sqlite', 'document'])
      })

      it('ConfigurationError has field property', () => {
        const error = new ConfigurationError('connectionString', 'Required')
        expect(error.field).toBe('connectionString')
      })
    })

    describe('Batch Operation Errors have operation properties', () => {
      it('BatchOperationError has operationType property', () => {
        const error = new BatchOperationError('delete')
        expect(error.operationType).toBe('delete')
      })

      it('BatchOperationError has optional failedCount property', () => {
        const error = new BatchOperationError('update', 'Batch update failed', 5)
        expect(error.failedCount).toBe(5)
      })
    })
  })

  // ============================================================================
  // ERROR CUSTOM MESSAGE OVERRIDE TESTS
  // ============================================================================

  describe('Custom Message Overrides', () => {
    it('ThingNotFoundError accepts custom message', () => {
      const error = new ThingNotFoundError('id', 'Custom not found message')
      expect(error.message).toBe('Custom not found message')
    })

    it('DuplicateNodeError accepts custom message', () => {
      const error = new DuplicateNodeError('id', 'Custom duplicate message')
      expect(error.message).toBe('Custom duplicate message')
    })

    it('ValidationError uses provided message', () => {
      const error = new ValidationError('Field X must be positive')
      expect(error.message).toBe('Field X must be positive')
    })

    it('InvalidStateError accepts custom message', () => {
      const error = new InvalidStateError('op', 'cur', ['exp'], 'Custom state message')
      expect(error.message).toBe('Custom state message')
    })

    it('FileNotFoundError accepts custom message', () => {
      const error = new FileNotFoundError('/path', 'Custom file message')
      expect(error.message).toBe('Custom file message')
    })

    it('CycleDetectedError accepts custom message', () => {
      const error = new CycleDetectedError('Circular dependency detected in import chain')
      expect(error.message).toBe('Circular dependency detected in import chain')
    })
  })

  // ============================================================================
  // ERROR NAME PROPERTY TESTS
  // ============================================================================

  describe('Error Name Properties', () => {
    it('GraphError has correct name', () => {
      expect(new GraphError('msg').name).toBe('GraphError')
    })

    it('ThingNotFoundError has correct name', () => {
      expect(new ThingNotFoundError('id').name).toBe('ThingNotFoundError')
    })

    it('DuplicateThingError has correct name', () => {
      expect(new DuplicateThingError('id').name).toBe('DuplicateThingError')
    })

    it('ValidationError has correct name', () => {
      expect(new ValidationError('msg').name).toBe('ValidationError')
    })

    it('InvalidStateError has correct name', () => {
      expect(new InvalidStateError('op', 'cur', ['exp']).name).toBe('InvalidStateError')
    })

    it('FileNotFoundError has correct name', () => {
      expect(new FileNotFoundError('/path').name).toBe('FileNotFoundError')
    })

    it('DeliveryError has correct name', () => {
      expect(new DeliveryError('msg').name).toBe('DeliveryError')
    })

    it('StoreNotInitializedError has correct name', () => {
      expect(new StoreNotInitializedError('Store').name).toBe('StoreNotInitializedError')
    })
  })
})
