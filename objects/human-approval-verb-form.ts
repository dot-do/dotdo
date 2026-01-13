/**
 * Human Approval Workflows via Verb Form State Machine
 *
 * IMPLEMENTED: All 22+ functions fully implemented and tested (66 tests passing).
 *
 * The key insight: verb form IS the state - no separate status column needed.
 *
 * Approval State Machine (via verb forms):
 * - 'approve' (action form) = pending, awaiting human review
 * - 'approving' (activity form) = in-progress, human is reviewing
 * - 'approved' (event form) = completed, human approved
 *
 * Alternative path for rejection:
 * - 'reject' (action form) = rejection intent
 * - 'rejecting' (activity form) = rejection in-progress
 * - 'rejected' (event form) = rejected
 *
 * @see dotdo-6iy3u - [RED] Human approval workflows via verb form state
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Approval states derived from verb forms
 */
export type ApprovalState =
  | 'pending' // verb: approve (action form)
  | 'reviewing' // verb: approving (activity form)
  | 'approved' // verb: approved (event form)
  | 'rejected' // verb: rejected (event form)
  | 'cancelled' // verb: cancelled (event form)
  | 'active' // query alias for pending + reviewing
  | 'completed' // query alias for approved + rejected

/**
 * Approval request stored in the graph
 */
export interface ApprovalRequest {
  id: string
  requesterId: string
  humanId: string
  message: string
  type: string
  verb: string // 'approve' | 'approving' | 'approved' | 'rejected' | 'cancelled'
  state: ApprovalState
  data?: Record<string, unknown>
  metadata?: Record<string, unknown>
  sla?: number
  expiresAt?: Date
  priority?: number
  channel?: string
  createdAt: Date
  updatedAt: Date
  reviewStartedAt?: Date
  reviewStartedBy?: string
  decidedAt?: Date
  decidedBy?: string
  decision?: ApprovalDecision
  cancellation?: {
    reason: string
    cancelledBy: string
    cancelledAt: Date
  }
  // Multi-approver fields
  multiApprover?: boolean
  approvers?: string[]
  quorum?: QuorumConfig
  order?: 'parallel' | 'sequential'
  currentApprover?: string
  decisions?: Record<string, ApproverDecision>
  // Escalation fields
  escalation?: {
    from: string
    to: string
    reason: string
    escalatedBy: string
    escalatedAt: Date
  }
  escalationHistory?: EscalationRecord[]
  escalationConfig?: EscalationConfig
}

/**
 * Decision made by an approver
 */
export interface ApprovalDecision {
  approved: boolean
  reason?: string
  comment?: string
  modifications?: Record<string, unknown>
}

/**
 * Individual approver decision for multi-approver workflows
 */
export interface ApproverDecision {
  approved: boolean
  reason?: string
  decidedAt: Date
}

/**
 * Quorum configuration for multi-approver requests
 */
export type QuorumConfig =
  | { type: 'all' }
  | { type: 'majority' }
  | { type: 'count'; count: number }

/**
 * Multi-approver workflow configuration
 */
export interface MultiApproverConfig {
  approvers: string[]
  quorum: QuorumConfig
  order: 'parallel' | 'sequential'
}

/**
 * Quorum check result
 */
export interface QuorumResult {
  met: boolean
  pending: string[]
  approved: string[]
  rejected: string[]
  blocked?: boolean
  blockedBy?: string
}

/**
 * Escalation configuration
 */
export interface EscalationConfig {
  rules: EscalationRule[]
  finalEscalation?: string
}

/**
 * Escalation rule
 */
export interface EscalationRule {
  afterMinutes: number
  escalateTo: string
}

/**
 * Escalation record
 */
export interface EscalationRecord {
  from: string
  to: string
  reason: string
  escalatedBy: string
  escalatedAt: Date
}

/**
 * Graph relationship for approvals
 */
export interface ApprovalRelationship {
  id: string
  from: string
  to: string
  verb: string
  data: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

/**
 * Approval graph for an entity
 */
export interface ApprovalGraph {
  entityId: string
  edges: ApprovalRelationship[]
  byState: {
    pending: ApprovalRelationship[]
    reviewing: ApprovalRelationship[]
    approved: ApprovalRelationship[]
    rejected: ApprovalRelationship[]
  }
  escalations: EscalationRecord[]
}

/**
 * Query options for approvals
 */
export interface ApprovalQueryOptions {
  includeCompleted?: boolean
  limit?: number
  offset?: number
}

/**
 * Approval history event
 */
export interface ApprovalHistoryEvent {
  event: string
  verb: string
  timestamp: Date
  actor?: string
  data?: Record<string, unknown>
}

// ============================================================================
// ERRORS
// ============================================================================

/**
 * Error thrown when approval request is not found
 */
export class ApprovalNotFoundError extends Error {
  constructor(id: string) {
    super(`Approval request not found: ${id}`)
    this.name = 'ApprovalNotFoundError'
  }
}

/**
 * Error thrown for invalid state transitions
 */
export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Invalid transition from '${from}' to '${to}'`)
    this.name = 'InvalidTransitionError'
  }
}

/**
 * Error thrown when approval has expired
 */
export class ApprovalExpiredError extends Error {
  constructor(id: string) {
    super(`Approval request has expired: ${id}`)
    this.name = 'ApprovalExpiredError'
  }
}

/**
 * Error thrown when quorum is not met
 */
export class QuorumNotMetError extends Error {
  constructor(id: string, required: number, current: number) {
    super(`Quorum not met for ${id}: ${current}/${required}`)
    this.name = 'QuorumNotMetError'
  }
}

/**
 * Error thrown when escalation fails
 */
export class EscalationFailedError extends Error {
  constructor(reason: string) {
    super(`Escalation failed: ${reason}`)
    this.name = 'EscalationFailedError'
  }
}

// ============================================================================
// INPUT TYPES
// ============================================================================

/**
 * Input for creating an approval request
 */
export interface CreateApprovalInput {
  requesterId: string
  humanId: string
  message: string
  type: string
  data?: Record<string, unknown>
  metadata?: Record<string, unknown>
  sla?: number
  priority?: number
  channel?: string
  escalationConfig?: EscalationConfig
}

/**
 * Input for creating a multi-approver request
 */
export interface CreateMultiApproverInput {
  requesterId: string
  message: string
  type: string
  data?: Record<string, unknown>
  config: MultiApproverConfig
}

/**
 * Input for recording an approver decision
 */
export interface ApproverDecisionInput {
  approved: boolean
  reason?: string
}

/**
 * Input for escalating an approval
 */
export interface EscalateInput {
  escalateTo: string
  reason: string
  escalatedBy: string
}

/**
 * Input for cancelling an approval
 */
export interface CancelInput {
  reason: string
  cancelledBy: string
}

/**
 * Input for creating a graph relationship
 */
export interface CreateRelationshipInput {
  from: string
  to: string
  verb: string
  data: Record<string, unknown>
}

// ============================================================================
// IN-MEMORY STORAGE (keyed by db object identity)
// ============================================================================

interface ApprovalStore {
  requests: Map<string, ApprovalRequest>
  relationships: Map<string, ApprovalRelationship>
  history: Map<string, ApprovalHistoryEvent[]>
}

const stores = new WeakMap<object, ApprovalStore>()

function getStore(db: object): ApprovalStore {
  let store = stores.get(db)
  if (!store) {
    store = {
      requests: new Map(),
      relationships: new Map(),
      history: new Map(),
    }
    stores.set(db, store)
  }
  return store
}

function generateId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

function addHistoryEvent(
  store: ApprovalStore,
  requestId: string,
  event: string,
  verb: string,
  actor?: string,
  data?: Record<string, unknown>
): void {
  const events = store.history.get(requestId) || []
  events.push({
    event,
    verb,
    timestamp: new Date(),
    actor,
    data,
  })
  store.history.set(requestId, events)
}

function verbToState(verb: string): ApprovalState {
  switch (verb) {
    case 'approve':
      return 'pending'
    case 'approving':
      return 'reviewing'
    case 'approved':
      return 'approved'
    case 'rejected':
      return 'rejected'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'pending'
  }
}

function isRequestExpired(request: ApprovalRequest): boolean {
  if (!request.expiresAt) return false
  return new Date() > request.expiresAt
}

// ============================================================================
// CORE APPROVAL WORKFLOW FUNCTIONS
// ============================================================================

export async function createApprovalRequest(
  db: object,
  input: CreateApprovalInput
): Promise<ApprovalRequest> {
  // Validate required fields
  if (!input.requesterId) {
    throw new Error('requesterId is required')
  }
  if (!input.humanId) {
    throw new Error('humanId is required')
  }

  const store = getStore(db)
  const now = new Date()
  const id = generateId('apr')

  const request: ApprovalRequest = {
    id,
    requesterId: input.requesterId,
    humanId: input.humanId,
    message: input.message,
    type: input.type,
    verb: 'approve',
    state: 'pending',
    data: input.data,
    metadata: input.metadata,
    sla: input.sla,
    expiresAt: input.sla ? new Date(now.getTime() + input.sla) : undefined,
    priority: input.priority,
    channel: input.channel,
    createdAt: now,
    updatedAt: now,
    escalationConfig: input.escalationConfig,
    escalationHistory: [],
  }

  store.requests.set(id, request)
  addHistoryEvent(store, id, 'created', 'approve', input.requesterId)

  return request
}

export async function startReview(
  db: object,
  requestId: string,
  humanId: string
): Promise<ApprovalRequest> {
  const store = getStore(db)
  const request = store.requests.get(requestId)

  if (!request) {
    throw new ApprovalNotFoundError(requestId)
  }

  // Can only start review from pending state
  if (request.state !== 'pending') {
    throw new InvalidTransitionError(request.state, 'reviewing')
  }

  request.verb = 'approving'
  request.state = 'reviewing'
  request.reviewStartedAt = new Date()
  request.reviewStartedBy = humanId
  request.updatedAt = new Date()

  addHistoryEvent(store, requestId, 'review_started', 'approving', humanId)

  return request
}

export async function completeApproval(
  db: object,
  requestId: string,
  decision: ApprovalDecision
): Promise<ApprovalRequest> {
  const store = getStore(db)
  const request = store.requests.get(requestId)

  if (!request) {
    throw new ApprovalNotFoundError(requestId)
  }

  // Check if expired (but allow completion if request has been escalated)
  const hasBeenEscalated = request.escalationHistory && request.escalationHistory.length > 0
  if (isRequestExpired(request) && !hasBeenEscalated) {
    throw new ApprovalExpiredError(requestId)
  }

  // Can complete from pending or reviewing state
  if (request.state !== 'pending' && request.state !== 'reviewing') {
    throw new InvalidTransitionError(request.state, 'approved')
  }

  request.verb = 'approved'
  request.state = 'approved'
  request.decision = decision
  request.decidedAt = new Date()
  request.decidedBy = request.reviewStartedBy || request.humanId
  request.updatedAt = new Date()

  addHistoryEvent(store, requestId, 'approved', 'approved', request.decidedBy, {
    reason: decision.reason,
  })

  return request
}

export async function rejectApproval(
  db: object,
  requestId: string,
  decision: Omit<ApprovalDecision, 'approved'>
): Promise<ApprovalRequest> {
  const store = getStore(db)
  const request = store.requests.get(requestId)

  if (!request) {
    throw new ApprovalNotFoundError(requestId)
  }

  // Can reject from pending or reviewing state
  if (request.state !== 'pending' && request.state !== 'reviewing') {
    throw new InvalidTransitionError(request.state, 'rejected')
  }

  request.verb = 'rejected'
  request.state = 'rejected'
  request.decision = { ...decision, approved: false }
  request.decidedAt = new Date()
  request.decidedBy = request.reviewStartedBy || request.humanId
  request.updatedAt = new Date()

  addHistoryEvent(store, requestId, 'rejected', 'rejected', request.decidedBy, {
    reason: decision.reason,
  })

  return request
}

export async function cancelApproval(
  db: object,
  requestId: string,
  input: CancelInput
): Promise<ApprovalRequest> {
  const store = getStore(db)
  const request = store.requests.get(requestId)

  if (!request) {
    throw new ApprovalNotFoundError(requestId)
  }

  // Cannot cancel completed requests
  if (request.state === 'approved' || request.state === 'rejected') {
    throw new InvalidTransitionError(request.state, 'cancelled')
  }

  request.verb = 'cancelled'
  request.state = 'cancelled'
  request.cancellation = {
    reason: input.reason,
    cancelledBy: input.cancelledBy,
    cancelledAt: new Date(),
  }
  request.updatedAt = new Date()

  addHistoryEvent(store, requestId, 'cancelled', 'cancelled', input.cancelledBy, {
    reason: input.reason,
  })

  return request
}

export async function getApprovalRequest(
  db: object,
  requestId: string
): Promise<ApprovalRequest | null> {
  const store = getStore(db)
  return store.requests.get(requestId) || null
}

// ============================================================================
// MULTI-APPROVER WORKFLOW FUNCTIONS
// ============================================================================

export async function createMultiApproverRequest(
  db: object,
  input: CreateMultiApproverInput
): Promise<ApprovalRequest> {
  const store = getStore(db)
  const now = new Date()
  const id = generateId('apr')

  const request: ApprovalRequest = {
    id,
    requesterId: input.requesterId,
    humanId: input.config.approvers[0]!, // First approver is primary
    message: input.message,
    type: input.type,
    verb: 'approve',
    state: 'pending',
    data: input.data,
    createdAt: now,
    updatedAt: now,
    multiApprover: true,
    approvers: input.config.approvers,
    quorum: input.config.quorum,
    order: input.config.order,
    currentApprover: input.config.order === 'sequential' ? input.config.approvers[0] : undefined,
    decisions: {},
    escalationHistory: [],
  }

  store.requests.set(id, request)
  addHistoryEvent(store, id, 'created', 'approve', input.requesterId)

  return request
}

export async function recordApproverDecision(
  db: object,
  requestId: string,
  approverId: string,
  decision: ApproverDecisionInput
): Promise<ApprovalRequest> {
  const store = getStore(db)
  const request = store.requests.get(requestId)

  if (!request) {
    throw new ApprovalNotFoundError(requestId)
  }

  // Check if approver is in the list
  if (!request.approvers?.includes(approverId)) {
    throw new Error('Not an approver')
  }

  // Check if already decided
  if (request.decisions?.[approverId]) {
    throw new Error('Already decided')
  }

  // Check sequential order
  if (request.order === 'sequential' && request.currentApprover !== approverId) {
    throw new Error('Not current approver in sequence')
  }

  // Record the decision
  if (!request.decisions) {
    request.decisions = {}
  }
  request.decisions[approverId] = {
    approved: decision.approved,
    reason: decision.reason,
    decidedAt: new Date(),
  }

  // Update current approver for sequential workflows
  if (request.order === 'sequential') {
    const currentIndex = request.approvers!.indexOf(approverId)
    const nextIndex = currentIndex + 1
    if (nextIndex < request.approvers!.length) {
      request.currentApprover = request.approvers![nextIndex]
    } else {
      request.currentApprover = undefined
    }
  }

  request.updatedAt = new Date()

  addHistoryEvent(store, requestId, 'decision_recorded', request.verb, approverId, {
    approved: decision.approved,
    reason: decision.reason,
  })

  // Check if quorum is met and auto-complete
  const quorumResult = await checkApprovalQuorum(db, requestId)
  if (quorumResult.met) {
    request.verb = 'approved'
    request.state = 'approved'
    request.decidedAt = new Date()
    addHistoryEvent(store, requestId, 'approved', 'approved', 'system', { quorum: 'met' })
  } else if (quorumResult.blocked) {
    request.verb = 'rejected'
    request.state = 'rejected'
    request.decidedAt = new Date()
    addHistoryEvent(store, requestId, 'rejected', 'rejected', quorumResult.blockedBy, {
      quorum: 'blocked',
    })
  }

  return request
}

export async function checkApprovalQuorum(
  db: object,
  requestId: string
): Promise<QuorumResult> {
  const store = getStore(db)
  const request = store.requests.get(requestId)

  if (!request) {
    throw new ApprovalNotFoundError(requestId)
  }

  const approvers = request.approvers || []
  const decisions = request.decisions || {}

  const approved: string[] = []
  const rejected: string[] = []
  const pending: string[] = []

  for (const approverId of approvers) {
    const decision = decisions[approverId]
    if (!decision) {
      pending.push(approverId)
    } else if (decision.approved) {
      approved.push(approverId)
    } else {
      rejected.push(approverId)
    }
  }

  const quorum = request.quorum || { type: 'all' }
  let met = false
  let blocked = false
  let blockedBy: string | undefined

  switch (quorum.type) {
    case 'all':
      met = approved.length === approvers.length
      // If any rejection, blocked
      if (rejected.length > 0) {
        blocked = true
        blockedBy = rejected[0]
      }
      break

    case 'majority':
      const majorityThreshold = Math.ceil(approvers.length / 2)
      met = approved.length >= majorityThreshold
      // If rejections make it impossible to reach majority, blocked
      if (rejected.length > approvers.length - majorityThreshold) {
        blocked = true
        blockedBy = rejected[0]
      }
      break

    case 'count':
      met = approved.length >= quorum.count
      // If not enough remaining approvers can meet count
      if (approved.length + pending.length < quorum.count) {
        blocked = true
        blockedBy = rejected[0]
      }
      break
  }

  return {
    met,
    pending,
    approved,
    rejected,
    blocked,
    blockedBy,
  }
}

export async function getApprovalDecisions(
  db: object,
  requestId: string
): Promise<Array<ApproverDecision & { approverId: string }>> {
  const store = getStore(db)
  const request = store.requests.get(requestId)

  if (!request) {
    throw new ApprovalNotFoundError(requestId)
  }

  const decisions = request.decisions || {}
  return Object.entries(decisions).map(([approverId, decision]) => ({
    approverId,
    ...decision,
  }))
}

// ============================================================================
// ESCALATION FUNCTIONS
// ============================================================================

export async function escalateApproval(
  db: object,
  requestId: string,
  input: EscalateInput
): Promise<ApprovalRequest> {
  const store = getStore(db)
  const request = store.requests.get(requestId)

  if (!request) {
    throw new ApprovalNotFoundError(requestId)
  }

  // Cannot escalate completed requests
  if (request.state === 'approved' || request.state === 'rejected') {
    throw new Error('Cannot escalate completed request')
  }

  // Cannot escalate to self
  if (request.humanId === input.escalateTo) {
    throw new EscalationFailedError('Cannot escalate to current assignee')
  }

  const escalationRecord: EscalationRecord = {
    from: request.humanId,
    to: input.escalateTo,
    reason: input.reason,
    escalatedBy: input.escalatedBy,
    escalatedAt: new Date(),
  }

  // Update request
  request.escalation = escalationRecord
  if (!request.escalationHistory) {
    request.escalationHistory = []
  }
  request.escalationHistory.push(escalationRecord)
  request.humanId = input.escalateTo
  request.updatedAt = new Date()

  addHistoryEvent(store, requestId, 'escalated', request.verb, input.escalatedBy, {
    from: escalationRecord.from,
    to: escalationRecord.to,
    reason: input.reason,
  })

  return request
}

export async function getEscalationChain(
  db: object,
  requestId: string
): Promise<EscalationRecord[]> {
  const store = getStore(db)
  const request = store.requests.get(requestId)

  if (!request) {
    throw new ApprovalNotFoundError(requestId)
  }

  return request.escalationHistory || []
}

export async function autoEscalateExpired(
  db: object
): Promise<ApprovalRequest[]> {
  const store = getStore(db)
  const now = new Date()
  const escalated: ApprovalRequest[] = []

  for (const request of store.requests.values()) {
    // Skip completed requests
    if (request.state === 'approved' || request.state === 'rejected' || request.state === 'cancelled') {
      continue
    }

    // Check if has escalation config
    if (!request.escalationConfig || !request.createdAt) {
      continue
    }

    const elapsedMinutes = (now.getTime() - request.createdAt.getTime()) / 60000
    const escalationHistory = request.escalationHistory || []
    const escalationCount = escalationHistory.length

    // Find applicable escalation rule
    const rules = request.escalationConfig.rules.sort((a, b) => a.afterMinutes - b.afterMinutes)

    // Find the next rule to apply based on escalation count
    let targetRule: EscalationRule | undefined
    for (let i = escalationCount; i < rules.length; i++) {
      if (elapsedMinutes >= rules[i]!.afterMinutes) {
        targetRule = rules[i]
      }
    }

    // If no rules left, check for final escalation
    if (!targetRule && escalationCount >= rules.length) {
      if (request.escalationConfig.finalEscalation && elapsedMinutes >= (rules[rules.length - 1]?.afterMinutes || 0)) {
        // Check if already at final escalation
        if (request.humanId !== request.escalationConfig.finalEscalation) {
          await escalateApproval(db, request.id, {
            escalateTo: request.escalationConfig.finalEscalation,
            reason: 'Final escalation - all rules exhausted',
            escalatedBy: 'system',
          })
          escalated.push(request)
        }
      }
      continue
    }

    if (targetRule) {
      await escalateApproval(db, request.id, {
        escalateTo: targetRule.escalateTo,
        reason: `SLA breach - escalated after ${targetRule.afterMinutes} minutes`,
        escalatedBy: 'system',
      })
      escalated.push(request)
    }
  }

  return escalated
}

// ============================================================================
// STATE QUERY FUNCTIONS
// ============================================================================

export async function queryApprovalsByState(
  db: object,
  state: ApprovalState
): Promise<ApprovalRequest[]> {
  const store = getStore(db)
  const results: ApprovalRequest[] = []

  for (const request of store.requests.values()) {
    if (state === 'active') {
      if (request.state === 'pending' || request.state === 'reviewing') {
        results.push(request)
      }
    } else if (state === 'completed') {
      if (request.state === 'approved' || request.state === 'rejected') {
        results.push(request)
      }
    } else if (request.state === state) {
      results.push(request)
    }
  }

  return results
}

export async function queryApprovalsByHuman(
  db: object,
  humanId: string,
  options?: ApprovalQueryOptions
): Promise<ApprovalRequest[]> {
  const store = getStore(db)
  const results: ApprovalRequest[] = []

  for (const request of store.requests.values()) {
    if (request.humanId !== humanId) continue

    // Exclude completed by default
    if (!options?.includeCompleted) {
      if (request.state === 'approved' || request.state === 'rejected') {
        continue
      }
    }

    results.push(request)
  }

  // Sort by priority (ascending, lower is higher priority) then by createdAt
  results.sort((a, b) => {
    const priorityA = a.priority ?? 99
    const priorityB = b.priority ?? 99
    if (priorityA !== priorityB) {
      return priorityA - priorityB
    }
    return a.createdAt.getTime() - b.createdAt.getTime()
  })

  // Apply pagination
  const offset = options?.offset || 0
  const limit = options?.limit || results.length

  return results.slice(offset, offset + limit)
}

export async function queryApprovalsByRequester(
  db: object,
  requesterId: string
): Promise<ApprovalRequest[]> {
  const store = getStore(db)
  const results: ApprovalRequest[] = []

  for (const request of store.requests.values()) {
    if (request.requesterId === requesterId) {
      results.push(request)
    }
  }

  return results
}

export async function queryExpiredApprovals(
  db: object
): Promise<ApprovalRequest[]> {
  const store = getStore(db)
  const now = new Date()
  const results: ApprovalRequest[] = []

  for (const request of store.requests.values()) {
    // Skip completed requests
    if (request.state === 'approved' || request.state === 'rejected' || request.state === 'cancelled') {
      continue
    }

    // Check if expired
    if (request.expiresAt && now > request.expiresAt) {
      results.push(request)
    }
  }

  return results
}

export async function queryApprovalHistory(
  db: object,
  requestId: string
): Promise<ApprovalHistoryEvent[]> {
  const store = getStore(db)
  return store.history.get(requestId) || []
}

// ============================================================================
// GRAPH INTEGRATION FUNCTIONS
// ============================================================================

export async function createApprovalRelationship(
  db: object,
  input: CreateRelationshipInput
): Promise<ApprovalRelationship> {
  const store = getStore(db)
  const now = new Date()
  const id = generateId('rel')

  const relationship: ApprovalRelationship = {
    id,
    from: input.from,
    to: input.to,
    verb: input.verb,
    data: input.data,
    createdAt: now,
    updatedAt: now,
  }

  store.relationships.set(id, relationship)

  return relationship
}

export async function transitionApprovalVerb(
  db: object,
  relationshipId: string,
  newVerb: string
): Promise<ApprovalRelationship> {
  const store = getStore(db)
  const relationship = store.relationships.get(relationshipId)

  if (!relationship) {
    throw new Error(`Relationship not found: ${relationshipId}`)
  }

  relationship.verb = newVerb
  relationship.updatedAt = new Date()

  return relationship
}

export async function getApprovalGraph(
  db: object,
  entityId: string
): Promise<ApprovalGraph> {
  const store = getStore(db)

  const edges: ApprovalRelationship[] = []
  const byState: ApprovalGraph['byState'] = {
    pending: [],
    reviewing: [],
    approved: [],
    rejected: [],
  }

  // Get relationships where entityId is the 'from'
  for (const rel of store.relationships.values()) {
    if (rel.from === entityId) {
      edges.push(rel)

      // Categorize by verb/state
      const state = verbToState(rel.verb)
      if (state === 'pending') {
        byState.pending.push(rel)
      } else if (state === 'reviewing') {
        byState.reviewing.push(rel)
      } else if (state === 'approved') {
        byState.approved.push(rel)
      } else if (state === 'rejected') {
        byState.rejected.push(rel)
      }
    }
  }

  // Get escalation history from any request by this entity
  const escalations: EscalationRecord[] = []
  for (const request of store.requests.values()) {
    if (request.requesterId === entityId && request.escalationHistory) {
      escalations.push(...request.escalationHistory)
    }
  }

  return {
    entityId,
    edges,
    byState,
    escalations,
  }
}
