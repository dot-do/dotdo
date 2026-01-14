/**
 * @module human
 * @description Human worker interfaces and types
 *
 * Defines interfaces for human participants in workflows with
 * approval queues, notifications, and escalation policies.
 */

import type { IWorker, WorkerConfig, ApprovalRequest, ApprovalResult, Channel } from './worker'

// =============================================================================
// NOTIFICATION TYPES
// =============================================================================

/**
 * Notification priority levels
 */
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent'

/**
 * Extended notification channel with priority
 */
export interface NotificationChannel {
  /** Channel type */
  type: 'email' | 'slack' | 'sms' | 'webhook' | 'discord'
  /** Channel target */
  target: string
  /** Priority level */
  priority: NotificationPriority
}

// =============================================================================
// ESCALATION TYPES
// =============================================================================

/**
 * Escalation rule configuration
 */
export interface EscalationRule {
  /** Minutes to wait before escalating */
  afterMinutes: number
  /** Who to escalate to */
  escalateTo: string
  /** Notification channels for escalation */
  notifyChannels: NotificationChannel[]
}

/**
 * Escalation policy configuration
 */
export interface EscalationPolicy {
  /** Ordered list of escalation rules */
  rules: EscalationRule[]
  /** Final escalation target (if all rules exhausted) */
  finalEscalation?: string
}

// =============================================================================
// PENDING APPROVAL TYPES
// =============================================================================

/**
 * Pending approval record
 */
export interface PendingApproval {
  /** The approval request */
  request: ApprovalRequest
  /** When request was received */
  receivedAt: Date
  /** When last reminder was sent */
  remindedAt?: Date
  /** Who the request was escalated to */
  escalatedTo?: string
}

// =============================================================================
// BLOCKING APPROVAL TYPES
// =============================================================================

/**
 * Blocking approval request status
 */
export type BlockingApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'

/**
 * Blocking approval request type
 */
export type BlockingApprovalType = 'approval' | 'question' | 'review'

/**
 * Blocking approval request (for template literal pattern)
 */
export interface BlockingApprovalRequest {
  /** Unique request identifier */
  requestId: string
  /** Human role */
  role: string
  /** Request message */
  message: string
  /** SLA in milliseconds */
  sla?: number
  /** Notification channel */
  channel?: string
  /** Request type */
  type: BlockingApprovalType
  /** When created */
  createdAt: string
  /** When expires */
  expiresAt?: string
  /** Current status */
  status: BlockingApprovalStatus
  /** Result (if completed) */
  result?: {
    approved: boolean
    approver?: string
    reason?: string
    respondedAt?: string
  }
}

// =============================================================================
// HUMAN INTERFACE
// =============================================================================

/**
 * Human interface extending worker with approval flows
 *
 * Humans can:
 * - Receive and process approval requests
 * - Configure notification channels
 * - Set escalation policies
 * - Handle blocking approval requests
 */
export interface IHuman extends IWorker {
  /**
   * Configure notification channels
   * @param channels - Channels to configure
   */
  setChannels(channels: NotificationChannel[]): Promise<void>

  /**
   * Get configured notification channels
   */
  getChannels(): Promise<NotificationChannel[]>

  /**
   * Configure escalation policy
   * @param policy - Policy to set
   */
  setEscalationPolicy(policy: EscalationPolicy): Promise<void>

  /**
   * Get configured escalation policy
   */
  getEscalationPolicy(): Promise<EscalationPolicy | null>

  /**
   * Request approval from this human
   * @param request - Approval request
   */
  requestApproval(request: ApprovalRequest): Promise<void>

  /**
   * Submit an approval decision
   * @param requestId - Request to approve/reject
   * @param approved - Whether approved
   * @param reason - Reason for decision
   */
  submitApproval(requestId: string, approved: boolean, reason?: string): Promise<ApprovalResult>

  /**
   * Get pending approval requests
   */
  getPendingApprovals(): Promise<PendingApproval[]>

  /**
   * Check for and process escalations
   */
  checkEscalations(): Promise<void>

  /**
   * Submit a blocking approval request (for template literal pattern)
   * @param params - Request parameters
   */
  submitBlockingRequest(params: {
    requestId: string
    role: string
    message: string
    sla?: number
    channel?: string
    type?: BlockingApprovalType
  }): Promise<BlockingApprovalRequest>

  /**
   * Get a blocking request by ID
   * @param requestId - Request ID
   */
  getBlockingRequest(requestId: string): Promise<BlockingApprovalRequest | null>

  /**
   * Respond to a blocking approval request
   * @param params - Response parameters
   */
  respondToBlockingRequest(params: {
    requestId: string
    approved: boolean
    approver?: string
    reason?: string
  }): Promise<BlockingApprovalRequest>

  /**
   * List blocking requests
   * @param status - Filter by status
   */
  listBlockingRequests(status?: BlockingApprovalStatus): Promise<BlockingApprovalRequest[]>
}

// =============================================================================
// HUMAN CONFIG
// =============================================================================

/**
 * Configuration for creating a human
 */
export interface HumanConfig extends WorkerConfig {
  /** Notification channels */
  notificationChannels?: NotificationChannel[]
  /** Escalation policy */
  escalationPolicy?: EscalationPolicy
  /** Default SLA in milliseconds */
  defaultSla?: number
}
