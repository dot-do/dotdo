/**
 * Human Module
 *
 * Shared abstractions for human-in-the-loop functionality.
 * Consolidates logic previously duplicated between:
 * - lib/executors/HumanFunctionExecutor.ts
 * - objects/Human.ts
 *
 * @module lib/human
 */

// ============================================================================
// CHANNELS
// ============================================================================

export {
  // Error classes
  HumanChannelError,
  HumanNotificationFailedError,

  // Types
  type HumanChannelType,
  type NotificationPriority,
  type FormFieldDefinition,
  type FormDefinition,
  type NotificationAction,
  type HumanNotificationPayload,
  type HumanResponse,
  type ChannelSendResult,
  type ChannelConfig,
  type NotificationChannel,
  type NotificationBuildOptions,
  type DeliveryConfig,

  // Classes
  ChannelRegistry,

  // Functions
  buildNotificationPayload,
  sendWithRetry,
  interpolatePrompt,
  generateTaskId,

  // Constants
  DEFAULT_DELIVERY_CONFIG,
} from './channels'

// ============================================================================
// VALIDATION
// ============================================================================

export {
  // Error classes
  HumanValidationError,

  // Types
  type ActionDefinition,
  type FormValidationResult,
  type ValidationSchema,
  type SchemaValidationResult,
  type ValidationContext,
  type CustomValidator,
  type ValidateResponseOptions,
  type ValidationResult,

  // Functions
  validateAction,
  validateForm,
  validateSchema,
  runCustomValidator,
  validateResponse,
} from './validation'

// ============================================================================
// WORKFLOWS
// ============================================================================

export {
  // Error classes
  HumanApprovalRejectedError,
  HumanEscalationError,
  HumanTimeoutError,
  HumanCancelledError,

  // Types
  type ApprovalLevel,
  type ApprovalWorkflow,
  type EscalationConfig,
  type ApprovalWorkflowResult,
  type WorkflowContext,
  type EscalationOptions,
  type DefaultOnTimeout,

  // Functions
  executeSequentialApproval,
  executeParallelApproval,
  executeConditionalApproval,
  executeApprovalWorkflow,
  buildEscalatedTask,
  hasEscalation,
  createTimeoutDefaultResponse,
  createTimeoutPromise,
  createAbortPromise,
} from './workflows'
