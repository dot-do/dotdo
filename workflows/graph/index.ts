/**
 * Workflows Graph Module
 *
 * Provides graph-based workflow primitives using the DO Graph data model.
 *
 * @module workflows/graph
 */

// WorkflowInstance Thing with verb form state
export {
  createInstance,
  getInstance,
  getInstanceState,
  startInstance,
  completeInstance,
  pauseInstance,
  resumeInstance,
  failInstance,
  queryInstancesByState,
  type WorkflowInstanceThing,
  type WorkflowInstanceData,
  type CreateInstanceInput,
  type QueryInstanceOptions,
  type InstanceState,
} from './instance-thing'

// Human Escalation via verb form relationships
export {
  // Escalation operations
  escalateToHuman,
  startEscalation,
  completeEscalation,
  getEscalation,
  getEscalationState,
  // Approval operations
  requestApproval,
  recordApproval,
  getApproval,
  getApprovalState,
  // Query operations
  queryPendingApprovals,
  queryPendingEscalations,
  queryEscalationsByInstance,
  queryApprovalsByInstance,
  // SLA enforcement
  checkApprovalSLA,
  checkEscalationSLA,
  findExpiredApprovals,
  findExpiredEscalations,
  // Human DO Store (SQLite-backed)
  createHumanDOStore,
  // Types
  type EscalateOptions,
  type ApprovalDocument,
  type ApprovalDecision,
  type EscalationRelationship,
  type EscalationData,
  type ApprovalRelationship,
  type ApprovalData,
  type PendingApproval,
  type HumanDOStore,
  type HumanEscalationRelationship,
  type HumanApprovalRelationship,
} from './human-escalation'

// WaitForEvent via verb form relationships
export {
  // Wait operations
  createWaitForEvent,
  startWaiting,
  deliverEvent,
  deliverEventByCorrelation,
  cancelWait,
  timeoutWait,
  // Query operations
  getWait,
  getWaitState,
  hasWaitError,
  queryPendingWaits,
  queryActiveWaits,
  queryIncompleteWaits,
  queryWaitsByInstance,
  findExpiredWaits,
  // Timeout handling
  checkWaitTimeout,
  getNextWaitTimeout,
  // Statistics
  getWaitStats,
  // Utilities
  parseDuration,
  // Errors
  WaitTimeoutError,
  WaitCancelledError,
  WaitEventMismatchError,
  // Types
  type WaitForEventOptions,
  type WaitForEventRelationship,
  type WaitForEventData,
  type WaitResult,
  type PendingWait as GraphPendingWait,
} from './wait-for-event'

// Schedule Triggers via verb form relationships
export {
  // Schedule CRUD
  createSchedule,
  getSchedule,
  getScheduleByUrl,
  listSchedules,
  updateSchedule,
  deleteSchedule,
  // Trigger CRUD
  createTrigger,
  getTrigger,
  getTriggerState,
  // Trigger state transitions
  startTrigger,
  completeTrigger,
  failTrigger,
  // Query operations
  queryTriggersByState,
  querySchedulesByWorkflow,
  queryTriggersBySchedule,
  // History
  getTriggerHistory,
  getRecentTriggerHistory,
  // ScheduleManager integration
  fireScheduleTrigger,
  recordTriggerCompletion,
  recordTriggerFailure,
  // Utilities
  verbFormToState as triggerVerbFormToState,
  stateToVerbForm as triggerStateToVerbForm,
  buildScheduleUrl,
  buildWorkflowUrl,
  // Types
  type ScheduleThing,
  type TriggerRelationship,
  type TriggerState,
  type TriggerData,
  type CreateTriggerInput,
  type CreateScheduleInput,
  type QueryTriggerOptions,
  type ScheduleByWorkflow,
  type TriggerHistoryEntry,
} from './schedule-triggers'

// Step Execution Store via verb form relationships
export {
  // Factory
  createStepExecutionStore,
  // Store class
  StepExecutionStore,
  // Types
  type StepExecutionState,
  type StepExecutionData,
  type StepExecutionRelationship,
  type CreateStepExecutionInput,
  type CompleteStepExecutionInput,
  type FailStepExecutionInput,
  type QueryStepExecutionOptions,
} from './step-execution-store'

// Pause/Resume Store via verb form relationships
export {
  // Factory
  createPauseResumeStore,
  // Store class
  PauseResumeStore,
  // Types
  type PauseResumeState,
  type PauseData,
  type ResumeData,
  type WaitForEventData as PauseResumeWaitForEventData,
  type PauseResumeRelationship,
  type WaitForEventRelationship as PauseResumeWaitForEventRelationship,
  type PauseInput,
  type ResumeInput,
  type WaitForEventInput as PauseResumeWaitForEventInput,
} from './pause-resume-store'
