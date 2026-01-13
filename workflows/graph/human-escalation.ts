/**
 * Human Escalation via Verb Form Relationships
 *
 * Implements human-in-the-loop workflows using verb form state encoding.
 *
 * The key insight: verb form IS the state - no separate status column needed:
 * - Action form (escalate, approve) = pending/intent
 * - Activity form (escalating, approving) = in-progress
 * - Event form (escalated, approved) = completed
 *
 * Verb forms for human escalation:
 * - 'escalate' (action) -> 'escalating' (activity) -> 'escalated' (event)
 * - 'approve' (action) -> 'approving' (activity) -> 'approved' (event)
 * - 'reject' (action) -> 'rejecting' (activity) -> 'rejected' (event)
 *
 * SLA enforcement via relationship timestamps (createdAt + sla = expiresAt).
 *
 * @see dotdo-4brx6 - [GREEN] Implement human escalation via verb form relationships
 */

import { VerbFormStateMachine, getVerbFormType } from '../../db/graph/verb-forms'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Human escalation options
 */
export interface EscalateOptions {
  /** Reason for escalation */
  reason: string
  /** SLA in milliseconds (time allowed for human response) */
  sla?: number
  /** Priority level (1-5, 1 = highest) */
  priority?: number
  /** Communication channel (slack, email, etc.) */
  channel?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Approval request document
 */
export interface ApprovalDocument {
  /** Type of approval needed */
  type: string
  /** Description of what needs approval */
  description: string
  /** Data to be reviewed */
  data: Record<string, unknown>
  /** Additional context */
  context?: Record<string, unknown>
}

/**
 * Human decision on an approval request
 */
export interface ApprovalDecision {
  /** Whether approved */
  approved: boolean
  /** Reason for decision */
  reason?: string
  /** Additional comments */
  comment?: string
  /** Modifications requested (for conditional approvals) */
  modifications?: Record<string, unknown>
}

/**
 * Escalation relationship stored in the graph
 */
export interface EscalationRelationship {
  id: string
  /** Verb form encoding state: 'escalate', 'escalating', 'escalated' */
  verb: string
  /** Source: workflow instance URL */
  from: string
  /** Target: Human DO URL */
  to: string
  /** Escalation data */
  data: EscalationData
  /** When the escalation was created */
  createdAt: number
  /** When the escalation was last updated */
  updatedAt: number
}

/**
 * Data stored in an escalation relationship
 */
export interface EscalationData {
  /** Reason for escalation */
  reason: string
  /** SLA in milliseconds */
  sla?: number
  /** When the SLA expires (createdAt + sla) */
  expiresAt?: number
  /** Priority level */
  priority?: number
  /** Communication channel */
  channel?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Approval relationship stored in the graph
 */
export interface ApprovalRelationship {
  id: string
  /** Verb form encoding state: 'approve', 'approving', 'approved', or 'rejected' */
  verb: string
  /** Source: workflow instance URL */
  from: string
  /** Target: Human DO URL */
  to: string
  /** Approval data */
  data: ApprovalData
  /** When the approval was requested */
  createdAt: number
  /** When the approval was last updated */
  updatedAt: number
}

/**
 * Data stored in an approval relationship
 */
export interface ApprovalData {
  /** The document to approve */
  document: ApprovalDocument
  /** SLA in milliseconds */
  sla?: number
  /** When the SLA expires */
  expiresAt?: number
  /** Decision (set when approved/rejected) */
  decision?: ApprovalDecision
  /** When decision was made */
  decidedAt?: number
  /** Who made the decision */
  decidedBy?: string
}

/**
 * Pending approval for query results
 */
export interface PendingApproval {
  /** Relationship ID */
  id: string
  /** Workflow instance ID */
  instanceId: string
  /** Human ID */
  humanId: string
  /** Document to approve */
  document: ApprovalDocument
  /** When requested */
  requestedAt: Date
  /** When SLA expires (if set) */
  expiresAt?: Date
  /** Whether SLA is expired */
  isExpired: boolean
  /** Time remaining in milliseconds (negative if expired) */
  timeRemaining: number
}

// ============================================================================
// STATE MACHINES
// ============================================================================

/**
 * State machine for the 'escalate' verb lifecycle
 * escalate (pending) -> escalating (in-progress) -> escalated (completed)
 */
const escalateMachine = VerbFormStateMachine.fromBaseVerb('escalate')

/**
 * State machine for the 'approve' verb lifecycle
 * approve (pending) -> approving (in-progress) -> approved (completed)
 */
const approveMachine = VerbFormStateMachine.fromBaseVerb('approve')

/**
 * State machine for the 'reject' verb lifecycle
 * reject (pending) -> rejecting (in-progress) -> rejected (completed)
 */
const rejectMachine = VerbFormStateMachine.fromBaseVerb('reject')

// ============================================================================
// IN-MEMORY STORE (per-db isolation)
// ============================================================================

/**
 * In-memory stores for escalations and approvals (per-db isolation for testing)
 */
const escalationStores = new WeakMap<object, Map<string, EscalationRelationship>>()
const approvalStores = new WeakMap<object, Map<string, ApprovalRelationship>>()

/**
 * Get or create the escalation store for a database
 */
function getEscalationStore(db: object): Map<string, EscalationRelationship> {
  let store = escalationStores.get(db)
  if (!store) {
    store = new Map()
    escalationStores.set(db, store)
  }
  return store
}

/**
 * Get or create the approval store for a database
 */
function getApprovalStore(db: object): Map<string, ApprovalRelationship> {
  let store = approvalStores.get(db)
  if (!store) {
    store = new Map()
    approvalStores.set(db, store)
  }
  return store
}

// ============================================================================
// ID GENERATION
// ============================================================================

let idCounter = 0

/**
 * Generate a unique escalation ID
 */
function generateEscalationId(): string {
  idCounter++
  return `esc-${Date.now().toString(36)}-${idCounter.toString(36)}`
}

/**
 * Generate a unique approval ID
 */
function generateApprovalId(): string {
  idCounter++
  return `apr-${Date.now().toString(36)}-${idCounter.toString(36)}`
}

// ============================================================================
// ESCALATION OPERATIONS
// ============================================================================

/**
 * Escalate a workflow instance to a human for intervention.
 *
 * Creates an 'escalate' relationship from the workflow instance to the Human DO.
 * The verb form encodes the state:
 * - 'escalate' = pending (awaiting human attention)
 * - 'escalating' = in-progress (human is working on it)
 * - 'escalated' = completed (human has handled it)
 *
 * @param db - Database instance (or empty object for testing)
 * @param instanceId - The workflow instance ID (becomes 'from' URL)
 * @param humanId - The human DO ID (becomes 'to' URL)
 * @param options - Escalation options (reason, SLA, priority, etc.)
 * @returns The created EscalationRelationship
 */
export async function escalateToHuman(
  db: object,
  instanceId: string,
  humanId: string,
  options: EscalateOptions
): Promise<EscalationRelationship> {
  const store = getEscalationStore(db)

  const id = generateEscalationId()
  const now = Date.now()

  const data: EscalationData = {
    reason: options.reason,
    sla: options.sla,
    expiresAt: options.sla ? now + options.sla : undefined,
    priority: options.priority,
    channel: options.channel,
    metadata: options.metadata,
  }

  const escalation: EscalationRelationship = {
    id,
    verb: 'escalate', // Action form = pending state
    from: instanceId,
    to: humanId,
    data,
    createdAt: now,
    updatedAt: now,
  }

  store.set(id, escalation)

  return escalation
}

/**
 * Mark an escalation as being worked on (in-progress).
 *
 * Transitions the verb from 'escalate' (pending) to 'escalating' (in-progress).
 *
 * @param db - Database instance
 * @param escalationId - The escalation ID
 * @returns The updated EscalationRelationship
 * @throws Error if escalation not found or invalid transition
 */
export async function startEscalation(
  db: object,
  escalationId: string
): Promise<EscalationRelationship> {
  const store = getEscalationStore(db)
  const escalation = store.get(escalationId)

  if (!escalation) {
    throw new Error(`Escalation not found: ${escalationId}`)
  }

  const currentState = escalateMachine.getState(escalation.verb)
  if (currentState !== 'pending') {
    throw new Error(`Cannot start escalation in ${currentState} state`)
  }

  const updated: EscalationRelationship = {
    ...escalation,
    verb: 'escalating', // Activity form = in-progress
    updatedAt: Date.now(),
  }

  store.set(escalationId, updated)
  return updated
}

/**
 * Complete an escalation (human has handled it).
 *
 * Transitions the verb from 'escalating' (in-progress) to 'escalated' (completed).
 *
 * @param db - Database instance
 * @param escalationId - The escalation ID
 * @returns The updated EscalationRelationship
 * @throws Error if escalation not found or invalid transition
 */
export async function completeEscalation(
  db: object,
  escalationId: string
): Promise<EscalationRelationship> {
  const store = getEscalationStore(db)
  const escalation = store.get(escalationId)

  if (!escalation) {
    throw new Error(`Escalation not found: ${escalationId}`)
  }

  const currentState = escalateMachine.getState(escalation.verb)
  if (currentState !== 'in_progress') {
    throw new Error(`Cannot complete escalation in ${currentState} state`)
  }

  const updated: EscalationRelationship = {
    ...escalation,
    verb: 'escalated', // Event form = completed
    updatedAt: Date.now(),
  }

  store.set(escalationId, updated)
  return updated
}

/**
 * Get an escalation by ID.
 *
 * @param db - Database instance
 * @param escalationId - The escalation ID
 * @returns The escalation or null if not found
 */
export async function getEscalation(
  db: object,
  escalationId: string
): Promise<EscalationRelationship | null> {
  const store = getEscalationStore(db)
  return store.get(escalationId) ?? null
}

/**
 * Get the state of an escalation based on its verb form.
 *
 * @param escalation - The escalation relationship
 * @returns 'pending' | 'in_progress' | 'completed'
 */
export function getEscalationState(
  escalation: EscalationRelationship
): 'pending' | 'in_progress' | 'completed' {
  const state = escalateMachine.getState(escalation.verb)
  return state ?? 'pending'
}

// ============================================================================
// APPROVAL OPERATIONS
// ============================================================================

/**
 * Request approval from a human for a document.
 *
 * Creates an 'approve' action relationship from the workflow instance to the Human DO.
 * This pauses the workflow instance until the human responds.
 *
 * @param db - Database instance
 * @param instanceId - The workflow instance ID
 * @param humanId - The human DO ID
 * @param document - The document to approve
 * @param options - Optional SLA and metadata
 * @returns The created ApprovalRelationship
 */
export async function requestApproval(
  db: object,
  instanceId: string,
  humanId: string,
  document: ApprovalDocument,
  options?: { sla?: number; metadata?: Record<string, unknown> }
): Promise<ApprovalRelationship> {
  const store = getApprovalStore(db)

  const id = generateApprovalId()
  const now = Date.now()

  const data: ApprovalData = {
    document,
    sla: options?.sla,
    expiresAt: options?.sla ? now + options.sla : undefined,
  }

  const approval: ApprovalRelationship = {
    id,
    verb: 'approve', // Action form = pending approval
    from: instanceId,
    to: humanId,
    data,
    createdAt: now,
    updatedAt: now,
  }

  store.set(id, approval)

  return approval
}

/**
 * Record a human's approval decision.
 *
 * Transitions the approval state based on the decision:
 * - If approved: 'approve' -> 'approved'
 * - If rejected: 'approve' -> 'rejected'
 *
 * @param db - Database instance
 * @param approvalId - The approval ID
 * @param humanId - The human who made the decision
 * @param decision - The approval decision
 * @returns The updated ApprovalRelationship
 * @throws Error if approval not found or already decided
 */
export async function recordApproval(
  db: object,
  approvalId: string,
  humanId: string,
  decision: ApprovalDecision
): Promise<ApprovalRelationship> {
  const store = getApprovalStore(db)
  const approval = store.get(approvalId)

  if (!approval) {
    throw new Error(`Approval not found: ${approvalId}`)
  }

  // Check current state - must be pending (approve action form)
  const verbType = getVerbFormType(approval.verb)
  if (verbType !== 'action' || approval.verb !== 'approve') {
    throw new Error(`Approval already decided or in invalid state: ${approval.verb}`)
  }

  const now = Date.now()

  const updated: ApprovalRelationship = {
    ...approval,
    verb: decision.approved ? 'approved' : 'rejected', // Event form based on decision
    data: {
      ...approval.data,
      decision,
      decidedAt: now,
      decidedBy: humanId,
    },
    updatedAt: now,
  }

  store.set(approvalId, updated)
  return updated
}

/**
 * Get an approval by ID.
 *
 * @param db - Database instance
 * @param approvalId - The approval ID
 * @returns The approval or null if not found
 */
export async function getApproval(
  db: object,
  approvalId: string
): Promise<ApprovalRelationship | null> {
  const store = getApprovalStore(db)
  return store.get(approvalId) ?? null
}

/**
 * Get the state of an approval based on its verb form.
 *
 * @param approval - The approval relationship
 * @returns 'pending' | 'approved' | 'rejected'
 */
export function getApprovalState(
  approval: ApprovalRelationship
): 'pending' | 'approved' | 'rejected' {
  if (approval.verb === 'approved') return 'approved'
  if (approval.verb === 'rejected') return 'rejected'
  return 'pending'
}

// ============================================================================
// QUERY OPERATIONS
// ============================================================================

/**
 * Query pending approvals for a specific human.
 *
 * Uses verb form to identify pending approvals:
 * - 'approve' (action form) = pending
 *
 * @param db - Database instance
 * @param humanId - The human DO ID
 * @param options - Optional filters (expired only, limit)
 * @returns Array of pending approvals with SLA status
 */
export async function queryPendingApprovals(
  db: object,
  humanId: string,
  options?: { expiredOnly?: boolean; limit?: number }
): Promise<PendingApproval[]> {
  const store = getApprovalStore(db)
  const now = Date.now()

  let results: PendingApproval[] = []

  for (const approval of Array.from(store.values())) {
    // Filter by humanId (the 'to' field)
    if (approval.to !== humanId) continue

    // Filter by verb form (only pending approvals)
    if (approval.verb !== 'approve') continue

    const expiresAt = approval.data.expiresAt
    const isExpired = expiresAt ? now > expiresAt : false
    const timeRemaining = expiresAt ? expiresAt - now : Number.MAX_SAFE_INTEGER

    // Apply expiredOnly filter
    if (options?.expiredOnly && !isExpired) continue

    results.push({
      id: approval.id,
      instanceId: approval.from,
      humanId: approval.to,
      document: approval.data.document,
      requestedAt: new Date(approval.createdAt),
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      isExpired,
      timeRemaining,
    })
  }

  // Sort by urgency: expired first, then by time remaining
  results.sort((a, b) => {
    if (a.isExpired && !b.isExpired) return -1
    if (!a.isExpired && b.isExpired) return 1
    return a.timeRemaining - b.timeRemaining
  })

  // Apply limit
  if (options?.limit) {
    results = results.slice(0, options.limit)
  }

  return results
}

/**
 * Query pending escalations for a specific human.
 *
 * @param db - Database instance
 * @param humanId - The human DO ID
 * @param options - Optional filters
 * @returns Array of pending escalations
 */
export async function queryPendingEscalations(
  db: object,
  humanId: string,
  options?: { limit?: number }
): Promise<EscalationRelationship[]> {
  const store = getEscalationStore(db)

  let results: EscalationRelationship[] = []

  for (const escalation of Array.from(store.values())) {
    // Filter by humanId (the 'to' field)
    if (escalation.to !== humanId) continue

    // Filter by verb form (pending escalations)
    if (escalation.verb !== 'escalate') continue

    results.push(escalation)
  }

  // Sort by priority (lower = higher priority), then by createdAt
  results.sort((a, b) => {
    const priorityA = a.data.priority ?? 3
    const priorityB = b.data.priority ?? 3
    if (priorityA !== priorityB) return priorityA - priorityB
    return a.createdAt - b.createdAt
  })

  // Apply limit
  if (options?.limit) {
    results = results.slice(0, options.limit)
  }

  return results
}

/**
 * Query all escalations for a workflow instance.
 *
 * @param db - Database instance
 * @param instanceId - The workflow instance ID
 * @returns Array of escalations (in any state)
 */
export async function queryEscalationsByInstance(
  db: object,
  instanceId: string
): Promise<EscalationRelationship[]> {
  const store = getEscalationStore(db)

  const results: EscalationRelationship[] = []

  for (const escalation of Array.from(store.values())) {
    if (escalation.from === instanceId) {
      results.push(escalation)
    }
  }

  // Sort by createdAt (newest first)
  results.sort((a, b) => b.createdAt - a.createdAt)

  return results
}

/**
 * Query all approvals for a workflow instance.
 *
 * @param db - Database instance
 * @param instanceId - The workflow instance ID
 * @returns Array of approvals (in any state)
 */
export async function queryApprovalsByInstance(
  db: object,
  instanceId: string
): Promise<ApprovalRelationship[]> {
  const store = getApprovalStore(db)

  const results: ApprovalRelationship[] = []

  for (const approval of Array.from(store.values())) {
    if (approval.from === instanceId) {
      results.push(approval)
    }
  }

  // Sort by createdAt (newest first)
  results.sort((a, b) => b.createdAt - a.createdAt)

  return results
}

// ============================================================================
// SLA ENFORCEMENT
// ============================================================================

/**
 * Check SLA status for an approval.
 *
 * @param approval - The approval relationship
 * @returns SLA status information
 */
export function checkApprovalSLA(
  approval: ApprovalRelationship
): { hasExpired: boolean; timeRemaining: number; expiresAt: Date | null } {
  const now = Date.now()
  const expiresAt = approval.data.expiresAt

  if (!expiresAt) {
    return {
      hasExpired: false,
      timeRemaining: Number.MAX_SAFE_INTEGER,
      expiresAt: null,
    }
  }

  return {
    hasExpired: now > expiresAt,
    timeRemaining: expiresAt - now,
    expiresAt: new Date(expiresAt),
  }
}

/**
 * Check SLA status for an escalation.
 *
 * @param escalation - The escalation relationship
 * @returns SLA status information
 */
export function checkEscalationSLA(
  escalation: EscalationRelationship
): { hasExpired: boolean; timeRemaining: number; expiresAt: Date | null } {
  const now = Date.now()
  const expiresAt = escalation.data.expiresAt

  if (!expiresAt) {
    return {
      hasExpired: false,
      timeRemaining: Number.MAX_SAFE_INTEGER,
      expiresAt: null,
    }
  }

  return {
    hasExpired: now > expiresAt,
    timeRemaining: expiresAt - now,
    expiresAt: new Date(expiresAt),
  }
}

/**
 * Find all approvals with expired SLAs.
 *
 * @param db - Database instance
 * @returns Array of expired approvals
 */
export async function findExpiredApprovals(
  db: object
): Promise<ApprovalRelationship[]> {
  const store = getApprovalStore(db)
  const now = Date.now()

  const results: ApprovalRelationship[] = []

  for (const approval of Array.from(store.values())) {
    // Only check pending approvals
    if (approval.verb !== 'approve') continue

    // Check if SLA has expired
    const expiresAt = approval.data.expiresAt
    if (expiresAt && now > expiresAt) {
      results.push(approval)
    }
  }

  return results
}

/**
 * Find all escalations with expired SLAs.
 *
 * @param db - Database instance
 * @returns Array of expired escalations
 */
export async function findExpiredEscalations(
  db: object
): Promise<EscalationRelationship[]> {
  const store = getEscalationStore(db)
  const now = Date.now()

  const results: EscalationRelationship[] = []

  for (const escalation of Array.from(store.values())) {
    // Only check pending escalations
    if (escalation.verb !== 'escalate') continue

    // Check if SLA has expired
    const expiresAt = escalation.data.expiresAt
    if (expiresAt && now > expiresAt) {
      results.push(escalation)
    }
  }

  return results
}

// ============================================================================
// HUMAN DO STORE - SQLite-backed implementation via GraphStore
// ============================================================================

import type { SQLiteGraphStore } from '../../db/graph/stores/sqlite'
import type { GraphRelationship } from '../../db/graph/types'

/**
 * Human escalation relationship format for Human DO integration.
 * Uses proper DO URLs for from/to fields.
 */
export interface HumanEscalationRelationship {
  id: string
  verb: 'escalate' | 'escalating' | 'escalated'
  /** Source: WorkflowInstance DO URL */
  from: string // e.g., 'do://tenant/WorkflowInstance/instance-123'
  /** Target: Human DO URL */
  to: string // e.g., 'do://tenant/Human/ceo'
  data: {
    reason: string
    sla?: string // ISO duration or human-readable string
    priority?: number
    channel?: string
    startedAt?: number
    completedAt?: number
    result?: Record<string, unknown>
  }
  createdAt: number
  updatedAt: number
}

/**
 * Human approval relationship format for Human DO integration.
 */
export interface HumanApprovalRelationship {
  id: string
  verb: 'approve' | 'approving' | 'approved' | 'rejected'
  /** Source: WorkflowInstance DO URL */
  from: string
  /** Target: Human DO URL */
  to: string
  data: {
    document?: {
      type: string
      description: string
      data: Record<string, unknown>
    }
    sla?: string
    decision?: 'approved' | 'rejected'
    comment?: string
    reason?: string
    decidedAt?: number
    decidedBy?: string
  }
  createdAt: number
  updatedAt: number
}

/**
 * Human DO Store interface for approval workflows.
 * This wraps GraphStore and provides Human-specific operations.
 */
export interface HumanDOStore {
  /**
   * Create an escalation to a Human DO.
   * Creates 'escalate' relationship using proper DO URLs.
   */
  createEscalation(
    instanceUrl: string,
    humanUrl: string,
    options: { reason: string; sla?: string; priority?: number; channel?: string }
  ): Promise<HumanEscalationRelationship>

  /**
   * Start working on an escalation.
   * Transitions from 'escalate' to 'escalating'.
   */
  startEscalation(escalationId: string): Promise<HumanEscalationRelationship>

  /**
   * Complete an escalation.
   * Transitions from 'escalating' to 'escalated'.
   */
  completeEscalation(
    escalationId: string,
    result?: Record<string, unknown>
  ): Promise<HumanEscalationRelationship>

  /**
   * Request approval from a Human DO.
   * Creates 'approve' relationship.
   */
  requestApproval(
    instanceUrl: string,
    humanUrl: string,
    document: { type: string; description: string; data: Record<string, unknown> },
    options?: { sla?: string }
  ): Promise<HumanApprovalRelationship>

  /**
   * Human starts reviewing an approval.
   * Transitions from 'approve' to 'approving'.
   */
  startReview(approvalId: string, reviewerId: string): Promise<HumanApprovalRelationship>

  /**
   * Record approval decision.
   * Transitions from 'approving' to 'approved' or 'rejected'.
   */
  recordDecision(
    approvalId: string,
    decision: { approved: boolean; comment?: string; reason?: string }
  ): Promise<HumanApprovalRelationship>

  /**
   * Query pending approvals by Human DO URL.
   * Filters by 'approve' action verb.
   */
  queryPendingApprovals(humanUrl: string): Promise<HumanApprovalRelationship[]>

  /**
   * Query pending escalations by Human DO URL.
   */
  queryPendingEscalations(humanUrl: string): Promise<HumanEscalationRelationship[]>

  /**
   * Check SLA status for an approval or escalation.
   * Uses relationship timestamps for calculation.
   */
  checkSLA(relationshipId: string): Promise<{
    hasExpired: boolean
    timeRemaining: number
    sla: string | null
    createdAt: number
  }>
}

// ============================================================================
// SLA PARSING UTILITIES
// ============================================================================

/**
 * Parse an SLA string (human-readable or ISO 8601 duration) to milliseconds.
 *
 * Supports:
 * - ISO 8601 duration: 'PT4H' (4 hours), 'PT30M' (30 minutes), 'P1D' (1 day)
 * - Human-readable: '4 hours', '30 minutes', '1 hour', '24 hours', '1 day', '48 hours'
 *
 * @param sla - SLA string
 * @returns Milliseconds, or null if cannot parse
 */
function parseSLAToMs(sla: string): number | null {
  // ISO 8601 duration format
  const isoMatch = sla.match(/^PT?(\d+)([DHMS])$/i)
  if (isoMatch) {
    const value = parseInt(isoMatch[1]!, 10)
    const unit = isoMatch[2]!.toUpperCase()
    switch (unit) {
      case 'D':
        return value * 24 * 60 * 60 * 1000
      case 'H':
        return value * 60 * 60 * 1000
      case 'M':
        return value * 60 * 1000
      case 'S':
        return value * 1000
    }
  }

  // Handle P1D format for days
  const dayMatch = sla.match(/^P(\d+)D$/i)
  if (dayMatch) {
    return parseInt(dayMatch[1]!, 10) * 24 * 60 * 60 * 1000
  }

  // Human-readable format: '4 hours', '1 hour', '30 minutes', etc.
  const humanMatch = sla.match(/^(\d+)\s*(hour|hours|minute|minutes|day|days)$/i)
  if (humanMatch) {
    const value = parseInt(humanMatch[1]!, 10)
    const unit = humanMatch[2]!.toLowerCase()
    switch (unit) {
      case 'hour':
      case 'hours':
        return value * 60 * 60 * 1000
      case 'minute':
      case 'minutes':
        return value * 60 * 1000
      case 'day':
      case 'days':
        return value * 24 * 60 * 60 * 1000
    }
  }

  return null
}

// ============================================================================
// HUMAN DO STORE IMPLEMENTATION
// ============================================================================

/**
 * In-memory storage for relationship ID to full relationship mapping.
 * This is needed because GraphStore doesn't provide a getRelationship(id) method.
 */
interface HumanDOStoreState {
  escalations: Map<string, HumanEscalationRelationship>
  approvals: Map<string, HumanApprovalRelationship>
}

/**
 * Create a HumanDOStore wrapping a SQLiteGraphStore.
 *
 * @param graphStore - The underlying SQLite graph store
 * @returns HumanDOStore implementation
 */
export function createHumanDOStore(graphStore: SQLiteGraphStore): HumanDOStore {
  // Internal state for tracking relationships by ID
  const state: HumanDOStoreState = {
    escalations: new Map(),
    approvals: new Map(),
  }

  let idCounter = 0

  /**
   * Generate a unique escalation ID
   */
  function generateEscalationId(): string {
    idCounter++
    return `esc-${Date.now().toString(36)}-${idCounter.toString(36)}`
  }

  /**
   * Generate a unique approval ID
   */
  function generateApprovalId(): string {
    idCounter++
    return `apr-${Date.now().toString(36)}-${idCounter.toString(36)}`
  }

  /**
   * Convert a GraphRelationship to HumanEscalationRelationship
   */
  function graphToEscalation(rel: GraphRelationship): HumanEscalationRelationship {
    return {
      id: rel.id,
      verb: rel.verb as 'escalate' | 'escalating' | 'escalated',
      from: rel.from,
      to: rel.to,
      data: (rel.data as HumanEscalationRelationship['data']) ?? { reason: '' },
      createdAt: rel.createdAt.getTime(),
      updatedAt: (rel.data as Record<string, unknown>)?.updatedAt as number ?? rel.createdAt.getTime(),
    }
  }

  /**
   * Convert a GraphRelationship to HumanApprovalRelationship
   */
  function graphToApproval(rel: GraphRelationship): HumanApprovalRelationship {
    return {
      id: rel.id,
      verb: rel.verb as 'approve' | 'approving' | 'approved' | 'rejected',
      from: rel.from,
      to: rel.to,
      data: (rel.data as HumanApprovalRelationship['data']) ?? {},
      createdAt: rel.createdAt.getTime(),
      updatedAt: (rel.data as Record<string, unknown>)?.updatedAt as number ?? rel.createdAt.getTime(),
    }
  }

  return {
    async createEscalation(instanceUrl, humanUrl, options) {
      const id = generateEscalationId()
      const now = Date.now()

      const data: HumanEscalationRelationship['data'] = {
        reason: options.reason,
        sla: options.sla,
        priority: options.priority,
        channel: options.channel,
      }

      // Create the relationship in SQLite
      await graphStore.createRelationship({
        id,
        verb: 'escalate',
        from: instanceUrl,
        to: humanUrl,
        data: { ...data, updatedAt: now },
      })

      const escalation: HumanEscalationRelationship = {
        id,
        verb: 'escalate',
        from: instanceUrl,
        to: humanUrl,
        data,
        createdAt: now,
        updatedAt: now,
      }

      state.escalations.set(id, escalation)
      return escalation
    },

    async startEscalation(escalationId) {
      // Get the escalation from our state
      const escalation = state.escalations.get(escalationId)
      if (!escalation) {
        throw new Error(`Escalation not found: ${escalationId}`)
      }

      if (escalation.verb !== 'escalate') {
        throw new Error(`Cannot start escalation in ${escalation.verb} state`)
      }

      const now = Date.now()

      // Delete old relationship and create new one with updated verb
      await graphStore.deleteRelationship(escalationId)

      const newData = {
        ...escalation.data,
        startedAt: now,
        updatedAt: now,
      }

      await graphStore.createRelationship({
        id: escalationId,
        verb: 'escalating',
        from: escalation.from,
        to: escalation.to,
        data: newData,
      })

      const updated: HumanEscalationRelationship = {
        ...escalation,
        verb: 'escalating',
        data: newData,
        updatedAt: now,
      }

      state.escalations.set(escalationId, updated)
      return updated
    },

    async completeEscalation(escalationId, result) {
      const escalation = state.escalations.get(escalationId)
      if (!escalation) {
        throw new Error(`Escalation not found: ${escalationId}`)
      }

      if (escalation.verb !== 'escalating') {
        throw new Error(`Cannot complete escalation in ${escalation.verb} state (must be in pending state)`)
      }

      const now = Date.now()

      // Delete old relationship and create new one with updated verb
      await graphStore.deleteRelationship(escalationId)

      const newData = {
        ...escalation.data,
        completedAt: now,
        result,
        updatedAt: now,
      }

      await graphStore.createRelationship({
        id: escalationId,
        verb: 'escalated',
        from: escalation.from,
        to: escalation.to,
        data: newData,
      })

      const updated: HumanEscalationRelationship = {
        ...escalation,
        verb: 'escalated',
        data: newData,
        updatedAt: now,
      }

      state.escalations.set(escalationId, updated)
      return updated
    },

    async requestApproval(instanceUrl, humanUrl, document, options) {
      const id = generateApprovalId()
      const now = Date.now()

      const data: HumanApprovalRelationship['data'] = {
        document,
        sla: options?.sla,
      }

      // Create the relationship in SQLite
      await graphStore.createRelationship({
        id,
        verb: 'approve',
        from: instanceUrl,
        to: humanUrl,
        data: { ...data, updatedAt: now },
      })

      const approval: HumanApprovalRelationship = {
        id,
        verb: 'approve',
        from: instanceUrl,
        to: humanUrl,
        data,
        createdAt: now,
        updatedAt: now,
      }

      state.approvals.set(id, approval)
      return approval
    },

    async startReview(approvalId, reviewerId) {
      const approval = state.approvals.get(approvalId)
      if (!approval) {
        throw new Error(`Approval not found: ${approvalId}`)
      }

      if (approval.verb !== 'approve') {
        throw new Error(`Cannot start review in ${approval.verb} state`)
      }

      const now = Date.now()

      // Delete old relationship and create new one with updated verb
      await graphStore.deleteRelationship(approvalId)

      const newData = {
        ...approval.data,
        decidedBy: reviewerId,
        updatedAt: now,
      }

      await graphStore.createRelationship({
        id: approvalId,
        verb: 'approving',
        from: approval.from,
        to: approval.to,
        data: newData,
      })

      const updated: HumanApprovalRelationship = {
        ...approval,
        verb: 'approving',
        data: newData,
        updatedAt: now,
      }

      state.approvals.set(approvalId, updated)
      return updated
    },

    async recordDecision(approvalId, decision) {
      const approval = state.approvals.get(approvalId)
      if (!approval) {
        throw new Error(`Approval not found: ${approvalId}`)
      }

      if (approval.verb !== 'approving') {
        throw new Error(`Cannot record decision in ${approval.verb} state (must be in pending state)`)
      }

      const now = Date.now()
      const newVerb = decision.approved ? 'approved' : 'rejected'

      // Delete old relationship and create new one with updated verb
      await graphStore.deleteRelationship(approvalId)

      const newData = {
        ...approval.data,
        decision: newVerb as 'approved' | 'rejected',
        comment: decision.comment,
        reason: decision.reason,
        decidedAt: now,
        updatedAt: now,
      }

      await graphStore.createRelationship({
        id: approvalId,
        verb: newVerb,
        from: approval.from,
        to: approval.to,
        data: newData,
      })

      const updated: HumanApprovalRelationship = {
        ...approval,
        verb: newVerb,
        data: newData,
        updatedAt: now,
      }

      state.approvals.set(approvalId, updated)
      return updated
    },

    async queryPendingApprovals(humanUrl) {
      // Query from SQLite for 'approve' verb relationships to the human
      const rels = await graphStore.queryRelationshipsTo(humanUrl, { verb: 'approve' })

      // Convert to HumanApprovalRelationship format
      return rels.map(graphToApproval)
    },

    async queryPendingEscalations(humanUrl) {
      // Query from SQLite for 'escalate' verb relationships to the human
      const rels = await graphStore.queryRelationshipsTo(humanUrl, { verb: 'escalate' })

      // Convert to HumanEscalationRelationship format
      return rels.map(graphToEscalation)
    },

    async checkSLA(relationshipId) {
      // Check escalations first, then approvals
      const escalation = state.escalations.get(relationshipId)
      if (escalation) {
        const sla = escalation.data.sla
        if (!sla) {
          return {
            hasExpired: false,
            timeRemaining: Number.MAX_SAFE_INTEGER,
            sla: null,
            createdAt: escalation.createdAt,
          }
        }

        const slaMs = parseSLAToMs(sla)
        if (slaMs === null) {
          return {
            hasExpired: false,
            timeRemaining: Number.MAX_SAFE_INTEGER,
            sla,
            createdAt: escalation.createdAt,
          }
        }

        const expiresAt = escalation.createdAt + slaMs
        const now = Date.now()
        return {
          hasExpired: now > expiresAt,
          timeRemaining: expiresAt - now,
          sla,
          createdAt: escalation.createdAt,
        }
      }

      const approval = state.approvals.get(relationshipId)
      if (approval) {
        const sla = approval.data.sla
        if (!sla) {
          return {
            hasExpired: false,
            timeRemaining: Number.MAX_SAFE_INTEGER,
            sla: null,
            createdAt: approval.createdAt,
          }
        }

        const slaMs = parseSLAToMs(sla)
        if (slaMs === null) {
          return {
            hasExpired: false,
            timeRemaining: Number.MAX_SAFE_INTEGER,
            sla,
            createdAt: approval.createdAt,
          }
        }

        const expiresAt = approval.createdAt + slaMs
        const now = Date.now()
        return {
          hasExpired: now > expiresAt,
          timeRemaining: expiresAt - now,
          sla,
          createdAt: approval.createdAt,
        }
      }

      throw new Error(`Relationship not found: ${relationshipId}`)
    },
  }
}
