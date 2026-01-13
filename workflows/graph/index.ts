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
  // Types
  type EscalateOptions,
  type ApprovalDocument,
  type ApprovalDecision,
  type EscalationRelationship,
  type EscalationData,
  type ApprovalRelationship,
  type ApprovalData,
  type PendingApproval,
} from './human-escalation'
