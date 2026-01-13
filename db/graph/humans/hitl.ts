/**
 * Human-in-the-Loop Graph Integration
 *
 * Integrates human requests (ApprovalRequest, TaskRequest, DecisionRequest, ReviewRequest)
 * with the dotdo Graph Model using verb form state encoding.
 *
 * ## Key Concepts
 *
 * **State via Verb Forms:**
 * - Action form (request, approve, etc.) = intent/pending
 * - Activity form (-ing) = in-progress
 * - Event form (-ed) = completed
 *
 * **Relationships:**
 * - Request `assignedTo` Human/Role/Team
 * - Request `escalatesTo` Human/Role
 * - Human `responded` Request
 * - Notification `deliveredVia` Channel
 *
 * @module db/graph/humans/hitl
 *
 * @see dotdo-z9jo6 - Human-in-the-Loop Graph Integration epic
 */

import type { GraphStore, GraphThing, GraphRelationship } from '../types'
import {
  HUMAN_TYPE_IDS,
  HUMAN_TYPE_NAMES,
  HUMAN_VERBS,
  HumanUrls,
  DEFAULT_SLA_CONFIG,
  type NotificationPriority,
  type NotificationChannelType,
  type ApprovalRequestThingData,
  type ApprovalResponse,
  type TaskRequestThingData,
  type TaskResponse,
  type TaskState,
  type TaskTimestamps,
  type DecisionRequestThingData,
  type DecisionOption,
  type DecisionResult,
  type DecisionTimestamps,
  type ReviewRequestThingData,
  type ReviewResult,
  type ReviewTimestamps,
  type ReviewType,
  type EscalationData,
  type NotificationDeliveryData,
  type SLAConfiguration,
  type HumanRequestThingData,
  isApprovalRequestThingData,
  isTaskRequestThingData,
  isDecisionRequestThingData,
  isReviewRequestThingData,
} from './types'
import { HUMAN_REQUEST_TYPE_IDS } from '../constants'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Request type enum
 */
export type HumanRequestType = 'approval' | 'task' | 'decision' | 'review'

/**
 * Common fields for creating any human request
 */
export interface CreateHumanRequestBase {
  /** Optional ID (auto-generated if not provided) */
  id?: string
  /** Priority */
  priority?: NotificationPriority
  /** SLA in milliseconds */
  sla?: number
  /** Deadline timestamp */
  deadline?: number
  /** Requester ID */
  requesterId: string
  /** Target role */
  targetRole?: string
  /** Target user ID */
  targetUserId?: string
  /** Notification channel preference */
  channel?: NotificationChannelType
  /** Context data */
  context?: Record<string, unknown>
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/**
 * Input for creating a task request
 */
export interface CreateTaskRequestInput extends CreateHumanRequestBase {
  title: string
  instructions: string
  tools?: string[]
  estimatedEffort?: number
}

/**
 * Input for creating a decision request
 */
export interface CreateDecisionRequestInput extends CreateHumanRequestBase {
  title: string
  question: string
  options: DecisionOption[]
  criteria?: string[]
}

/**
 * Input for creating a review request
 */
export interface CreateReviewRequestInput extends CreateHumanRequestBase {
  title: string
  content: string
  criteria?: string[]
  reviewType: ReviewType
}

/**
 * SLA tracking result
 */
export interface SLAStatus {
  /** Whether the SLA has been breached */
  breached: boolean
  /** Time remaining in milliseconds (negative if breached) */
  timeRemaining: number
  /** Whether we're in warning zone */
  warning: boolean
  /** Deadline timestamp */
  deadline: number
  /** Percentage of SLA consumed (0-1, can exceed 1 if breached) */
  consumed: number
}

/**
 * Escalation target info
 */
export interface EscalationTarget {
  type: 'user' | 'role' | 'team'
  id: string
  name?: string
  sla?: number
}

// ============================================================================
// TYPE IDS
// ============================================================================

export const REQUEST_TYPE_IDS = {
  approval: HUMAN_REQUEST_TYPE_IDS.approval,
  task: HUMAN_REQUEST_TYPE_IDS.task,
  decision: HUMAN_REQUEST_TYPE_IDS.decision,
  review: HUMAN_REQUEST_TYPE_IDS.review,
} as const

export const REQUEST_TYPE_NAMES = {
  approval: HUMAN_TYPE_NAMES.ApprovalRequest,
  task: HUMAN_TYPE_NAMES.TaskRequest,
  decision: HUMAN_TYPE_NAMES.DecisionRequest,
  review: HUMAN_TYPE_NAMES.ReviewRequest,
} as const

// ============================================================================
// VERB FORM STATE MACHINE
// ============================================================================

/**
 * Valid verb forms for each request type
 */
export const REQUEST_VERB_FORMS = {
  approval: {
    action: HUMAN_VERBS.APPROVE,
    activity: HUMAN_VERBS.APPROVING,
    event: HUMAN_VERBS.APPROVED,
    rejected: HUMAN_VERBS.REJECTED,
  },
  task: {
    action: HUMAN_VERBS.ASSIGN,
    activity: HUMAN_VERBS.ASSIGNING,
    event: HUMAN_VERBS.ASSIGNED,
    complete: HUMAN_VERBS.COMPLETE,
    completing: HUMAN_VERBS.COMPLETING,
    completed: HUMAN_VERBS.COMPLETED,
  },
  decision: {
    action: HUMAN_VERBS.DECIDE,
    activity: HUMAN_VERBS.DECIDING,
    event: HUMAN_VERBS.DECIDED,
  },
  review: {
    action: HUMAN_VERBS.REVIEW,
    activity: HUMAN_VERBS.REVIEWING,
    event: HUMAN_VERBS.REVIEWED,
  },
} as const

/**
 * Map verb to semantic state
 */
export function getStateFromVerb(verb: string): 'pending' | 'in_progress' | 'completed' | 'rejected' {
  // Event forms (completed)
  if (
    verb === HUMAN_VERBS.APPROVED ||
    verb === HUMAN_VERBS.ASSIGNED ||
    verb === HUMAN_VERBS.COMPLETED ||
    verb === HUMAN_VERBS.DECIDED ||
    verb === HUMAN_VERBS.REVIEWED ||
    verb === HUMAN_VERBS.RESPONDED ||
    verb === HUMAN_VERBS.REQUESTED
  ) {
    return 'completed'
  }

  // Rejection
  if (verb === HUMAN_VERBS.REJECTED) {
    return 'rejected'
  }

  // Activity forms (in progress)
  if (
    verb === HUMAN_VERBS.APPROVING ||
    verb === HUMAN_VERBS.ASSIGNING ||
    verb === HUMAN_VERBS.COMPLETING ||
    verb === HUMAN_VERBS.DECIDING ||
    verb === HUMAN_VERBS.REVIEWING ||
    verb === HUMAN_VERBS.RESPONDING ||
    verb === HUMAN_VERBS.REQUESTING ||
    verb === HUMAN_VERBS.ESCALATING
  ) {
    return 'in_progress'
  }

  // Default: action form (pending)
  return 'pending'
}

/**
 * Transition a verb form to the next state
 */
export function transitionVerb(
  currentVerb: string,
  transition: 'start' | 'complete' | 'reject' | 'cancel'
): string {
  const state = getStateFromVerb(currentVerb)

  // Cannot transition from completed/rejected states
  if (state === 'completed' || state === 'rejected') {
    throw new Error(`Cannot transition from ${state} state (verb: ${currentVerb})`)
  }

  switch (transition) {
    case 'start':
      if (state !== 'pending') {
        throw new Error(`Can only start from pending state (current: ${state})`)
      }
      // Map action -> activity
      switch (currentVerb) {
        case HUMAN_VERBS.APPROVE:
          return HUMAN_VERBS.APPROVING
        case HUMAN_VERBS.ASSIGN:
          return HUMAN_VERBS.ASSIGNING
        case HUMAN_VERBS.COMPLETE:
          return HUMAN_VERBS.COMPLETING
        case HUMAN_VERBS.DECIDE:
          return HUMAN_VERBS.DECIDING
        case HUMAN_VERBS.REVIEW:
          return HUMAN_VERBS.REVIEWING
        case HUMAN_VERBS.REQUEST:
          return HUMAN_VERBS.REQUESTING
        case HUMAN_VERBS.ESCALATE:
          return HUMAN_VERBS.ESCALATING
        case HUMAN_VERBS.RESPOND:
          return HUMAN_VERBS.RESPONDING
        default:
          return currentVerb + 'ing'
      }

    case 'complete':
      // Map activity -> event, or action -> event (immediate completion)
      switch (currentVerb) {
        case HUMAN_VERBS.APPROVE:
        case HUMAN_VERBS.APPROVING:
          return HUMAN_VERBS.APPROVED
        case HUMAN_VERBS.ASSIGN:
        case HUMAN_VERBS.ASSIGNING:
          return HUMAN_VERBS.ASSIGNED
        case HUMAN_VERBS.COMPLETE:
        case HUMAN_VERBS.COMPLETING:
          return HUMAN_VERBS.COMPLETED
        case HUMAN_VERBS.DECIDE:
        case HUMAN_VERBS.DECIDING:
          return HUMAN_VERBS.DECIDED
        case HUMAN_VERBS.REVIEW:
        case HUMAN_VERBS.REVIEWING:
          return HUMAN_VERBS.REVIEWED
        case HUMAN_VERBS.REQUEST:
        case HUMAN_VERBS.REQUESTING:
          return HUMAN_VERBS.REQUESTED
        case HUMAN_VERBS.ESCALATE:
        case HUMAN_VERBS.ESCALATING:
          return HUMAN_VERBS.ESCALATED
        case HUMAN_VERBS.RESPOND:
        case HUMAN_VERBS.RESPONDING:
          return HUMAN_VERBS.RESPONDED
        default:
          return currentVerb.endsWith('ing') ? currentVerb.slice(0, -3) + 'ed' : currentVerb + 'd'
      }

    case 'reject':
      return HUMAN_VERBS.REJECTED

    case 'cancel':
      // Return to action form
      switch (currentVerb) {
        case HUMAN_VERBS.APPROVING:
          return HUMAN_VERBS.APPROVE
        case HUMAN_VERBS.ASSIGNING:
          return HUMAN_VERBS.ASSIGN
        case HUMAN_VERBS.COMPLETING:
          return HUMAN_VERBS.COMPLETE
        case HUMAN_VERBS.DECIDING:
          return HUMAN_VERBS.DECIDE
        case HUMAN_VERBS.REVIEWING:
          return HUMAN_VERBS.REVIEW
        default:
          if (currentVerb.endsWith('ing')) {
            return currentVerb.slice(0, -3).replace(/([^aeiou])$/, '$1')
          }
          return currentVerb
      }
  }
}

// ============================================================================
// TASK REQUEST OPERATIONS
// ============================================================================

/**
 * Create a new task request
 */
export async function createTaskRequest(
  graph: GraphStore,
  input: CreateTaskRequestInput
): Promise<{ thing: GraphThing; relationship: GraphRelationship }> {
  const requestId = input.id ?? `task-${crypto.randomUUID()}`
  const now = Date.now()

  // Calculate deadline from SLA if provided
  const sla = input.sla ?? DEFAULT_SLA_CONFIG.byPriority[input.priority ?? 'normal']
  const deadline = input.deadline ?? now + sla

  const timestamps: TaskTimestamps = {
    createdAt: now,
  }

  const requestData: TaskRequestThingData = {
    title: input.title,
    instructions: input.instructions,
    tools: input.tools,
    estimatedEffort: input.estimatedEffort,
    priority: input.priority ?? 'normal',
    sla,
    deadline,
    requesterId: input.requesterId,
    targetRole: input.targetRole,
    targetUserId: input.targetUserId,
    channel: input.channel,
    state: 'pending',
    timestamps,
    context: input.context,
    metadata: input.metadata,
  }

  const thing = await graph.createThing({
    id: requestId,
    typeId: REQUEST_TYPE_IDS.task,
    typeName: REQUEST_TYPE_NAMES.task,
    data: requestData,
  })

  // Create assignment relationship with intent verb
  const targetId = input.targetUserId ?? input.targetRole ?? 'pending'
  const relationship = await graph.createRelationship({
    id: `${requestId}-${HUMAN_VERBS.ASSIGN}-${targetId}-${now}`,
    verb: HUMAN_VERBS.ASSIGN,
    from: HumanUrls.task(requestId),
    to: HumanUrls.user(targetId),
    data: {
      priority: input.priority ?? 'normal',
      sla,
      deadline,
      requestedAt: now,
    },
  })

  return { thing, relationship }
}

/**
 * Get a task request by ID
 */
export async function getTaskRequest(
  graph: GraphStore,
  requestId: string
): Promise<GraphThing | null> {
  const thing = await graph.getThing(requestId)
  if (!thing || thing.typeName !== REQUEST_TYPE_NAMES.task || thing.deletedAt !== null) {
    return null
  }
  return thing
}

/**
 * Assign a task to a user
 */
export async function assignTask(
  graph: GraphStore,
  requestId: string,
  assigneeId: string
): Promise<{ thing: GraphThing; relationship: GraphRelationship }> {
  const thing = await getTaskRequest(graph, requestId)
  if (!thing) {
    throw new Error(`Task request not found: ${requestId}`)
  }

  const data = thing.data as TaskRequestThingData
  if (data.state !== 'pending') {
    throw new Error(`Cannot assign: task is ${data.state}, expected pending`)
  }

  const now = Date.now()

  // Update thing state and timestamps
  const newTimestamps: TaskTimestamps = {
    ...data.timestamps,
    assignedAt: now,
    firstResponseAt: data.timestamps.firstResponseAt ?? now,
  }

  await graph.updateThing(requestId, {
    data: {
      ...data,
      state: 'assigned' as TaskState,
      targetUserId: assigneeId,
      timestamps: newTimestamps,
    },
  })

  // Find and delete old relationship
  const oldRels = await graph.queryRelationshipsFrom(HumanUrls.task(requestId))
  for (const rel of oldRels) {
    if (rel.verb === HUMAN_VERBS.ASSIGN) {
      await graph.deleteRelationship(rel.id)
    }
  }

  // Create new relationship with assigned verb
  const relationship = await graph.createRelationship({
    id: `${requestId}-${HUMAN_VERBS.ASSIGNED}-${assigneeId}-${now}`,
    verb: HUMAN_VERBS.ASSIGNED,
    from: HumanUrls.task(requestId),
    to: HumanUrls.user(assigneeId),
    data: {
      assignedAt: now,
    },
  })

  const updatedThing = await getTaskRequest(graph, requestId)
  return { thing: updatedThing!, relationship }
}

/**
 * Start working on a task
 */
export async function startTask(
  graph: GraphStore,
  requestId: string,
  workerId: string
): Promise<GraphThing> {
  const thing = await getTaskRequest(graph, requestId)
  if (!thing) {
    throw new Error(`Task request not found: ${requestId}`)
  }

  const data = thing.data as TaskRequestThingData
  if (data.state !== 'assigned' && data.state !== 'pending') {
    throw new Error(`Cannot start: task is ${data.state}, expected assigned or pending`)
  }

  const now = Date.now()

  const newTimestamps: TaskTimestamps = {
    ...data.timestamps,
    assignedAt: data.timestamps.assignedAt ?? now,
    startedAt: now,
    firstResponseAt: data.timestamps.firstResponseAt ?? now,
  }

  await graph.updateThing(requestId, {
    data: {
      ...data,
      state: 'in_progress' as TaskState,
      targetUserId: workerId,
      timestamps: newTimestamps,
    },
  })

  return (await getTaskRequest(graph, requestId))!
}

/**
 * Complete a task
 */
export async function completeTask(
  graph: GraphStore,
  requestId: string,
  response: TaskResponse
): Promise<{ thing: GraphThing; relationship: GraphRelationship }> {
  const thing = await getTaskRequest(graph, requestId)
  if (!thing) {
    throw new Error(`Task request not found: ${requestId}`)
  }

  const data = thing.data as TaskRequestThingData
  if (data.state !== 'in_progress' && data.state !== 'assigned') {
    throw new Error(`Cannot complete: task is ${data.state}`)
  }

  const now = Date.now()

  const newTimestamps: TaskTimestamps = {
    ...data.timestamps,
    completedAt: now,
  }

  await graph.updateThing(requestId, {
    data: {
      ...data,
      state: 'completed' as TaskState,
      timestamps: newTimestamps,
      response,
    },
  })

  // Create completed relationship
  const relationship = await graph.createRelationship({
    id: `${requestId}-${HUMAN_VERBS.COMPLETED}-${response.completedBy}-${now}`,
    verb: HUMAN_VERBS.COMPLETED,
    from: HumanUrls.task(requestId),
    to: HumanUrls.user(response.completedBy),
    data: {
      completedAt: now,
      result: response.result,
      notes: response.notes,
    },
  })

  const updatedThing = await getTaskRequest(graph, requestId)
  return { thing: updatedThing!, relationship }
}

// ============================================================================
// DECISION REQUEST OPERATIONS
// ============================================================================

/**
 * Create a new decision request
 */
export async function createDecisionRequest(
  graph: GraphStore,
  input: CreateDecisionRequestInput
): Promise<{ thing: GraphThing; relationship: GraphRelationship }> {
  const requestId = input.id ?? `decision-${crypto.randomUUID()}`
  const now = Date.now()

  const sla = input.sla ?? DEFAULT_SLA_CONFIG.byPriority[input.priority ?? 'normal']
  const deadline = input.deadline ?? now + sla

  const timestamps: DecisionTimestamps = {
    createdAt: now,
  }

  const requestData: DecisionRequestThingData = {
    title: input.title,
    question: input.question,
    options: input.options,
    criteria: input.criteria,
    priority: input.priority ?? 'normal',
    sla,
    deadline,
    requesterId: input.requesterId,
    targetRole: input.targetRole,
    targetUserId: input.targetUserId,
    channel: input.channel,
    timestamps,
    context: input.context,
    metadata: input.metadata,
  }

  const thing = await graph.createThing({
    id: requestId,
    typeId: REQUEST_TYPE_IDS.decision,
    typeName: REQUEST_TYPE_NAMES.decision,
    data: requestData,
  })

  const targetId = input.targetUserId ?? input.targetRole ?? 'pending'
  const relationship = await graph.createRelationship({
    id: `${requestId}-${HUMAN_VERBS.DECIDE}-${targetId}-${now}`,
    verb: HUMAN_VERBS.DECIDE,
    from: HumanUrls.decision(requestId),
    to: HumanUrls.user(targetId),
    data: {
      priority: input.priority ?? 'normal',
      sla,
      deadline,
      requestedAt: now,
    },
  })

  return { thing, relationship }
}

/**
 * Get a decision request by ID
 */
export async function getDecisionRequest(
  graph: GraphStore,
  requestId: string
): Promise<GraphThing | null> {
  const thing = await graph.getThing(requestId)
  if (!thing || thing.typeName !== REQUEST_TYPE_NAMES.decision || thing.deletedAt !== null) {
    return null
  }
  return thing
}

/**
 * Start making a decision
 */
export async function startDecision(
  graph: GraphStore,
  requestId: string,
  deciderId: string
): Promise<GraphRelationship> {
  const thing = await getDecisionRequest(graph, requestId)
  if (!thing) {
    throw new Error(`Decision request not found: ${requestId}`)
  }

  const data = thing.data as DecisionRequestThingData
  if (data.decision) {
    throw new Error(`Decision already made for request ${requestId}`)
  }

  const now = Date.now()

  // Update timestamps
  const newTimestamps: DecisionTimestamps = {
    ...data.timestamps,
    assignedAt: now,
    firstResponseAt: data.timestamps.firstResponseAt ?? now,
  }

  await graph.updateThing(requestId, {
    data: {
      ...data,
      timestamps: newTimestamps,
    },
  })

  // Delete old relationship and create deciding relationship
  const oldRels = await graph.queryRelationshipsFrom(HumanUrls.decision(requestId))
  for (const rel of oldRels) {
    if (rel.verb === HUMAN_VERBS.DECIDE) {
      await graph.deleteRelationship(rel.id)
    }
  }

  return graph.createRelationship({
    id: `${requestId}-${HUMAN_VERBS.DECIDING}-${deciderId}-${now}`,
    verb: HUMAN_VERBS.DECIDING,
    from: HumanUrls.decision(requestId),
    to: HumanUrls.user(deciderId),
    data: {
      startedAt: now,
    },
  })
}

/**
 * Make a decision
 */
export async function makeDecision(
  graph: GraphStore,
  requestId: string,
  decision: DecisionResult
): Promise<{ thing: GraphThing; relationship: GraphRelationship }> {
  const thing = await getDecisionRequest(graph, requestId)
  if (!thing) {
    throw new Error(`Decision request not found: ${requestId}`)
  }

  const data = thing.data as DecisionRequestThingData
  if (data.decision) {
    throw new Error(`Decision already made for request ${requestId}`)
  }

  // Validate option exists
  const option = data.options.find((o) => o.id === decision.selectedOptionId)
  if (!option) {
    throw new Error(`Invalid option ID: ${decision.selectedOptionId}`)
  }

  const now = Date.now()

  const newTimestamps: DecisionTimestamps = {
    ...data.timestamps,
    decidedAt: now,
  }

  await graph.updateThing(requestId, {
    data: {
      ...data,
      timestamps: newTimestamps,
      decision,
    },
  })

  // Delete old relationships
  const oldRels = await graph.queryRelationshipsFrom(HumanUrls.decision(requestId))
  for (const rel of oldRels) {
    if (rel.verb === HUMAN_VERBS.DECIDE || rel.verb === HUMAN_VERBS.DECIDING) {
      await graph.deleteRelationship(rel.id)
    }
  }

  const relationship = await graph.createRelationship({
    id: `${requestId}-${HUMAN_VERBS.DECIDED}-${decision.decidedBy}-${now}`,
    verb: HUMAN_VERBS.DECIDED,
    from: HumanUrls.decision(requestId),
    to: HumanUrls.user(decision.decidedBy),
    data: {
      decidedAt: now,
      selectedOptionId: decision.selectedOptionId,
      reasoning: decision.reasoning,
      confidence: decision.confidence,
    },
  })

  const updatedThing = await getDecisionRequest(graph, requestId)
  return { thing: updatedThing!, relationship }
}

// ============================================================================
// REVIEW REQUEST OPERATIONS
// ============================================================================

/**
 * Create a new review request
 */
export async function createReviewRequest(
  graph: GraphStore,
  input: CreateReviewRequestInput
): Promise<{ thing: GraphThing; relationship: GraphRelationship }> {
  const requestId = input.id ?? `review-${crypto.randomUUID()}`
  const now = Date.now()

  const sla = input.sla ?? DEFAULT_SLA_CONFIG.byPriority[input.priority ?? 'normal']
  const deadline = input.deadline ?? now + sla

  const timestamps: ReviewTimestamps = {
    createdAt: now,
  }

  const requestData: ReviewRequestThingData = {
    title: input.title,
    content: input.content,
    criteria: input.criteria,
    reviewType: input.reviewType,
    priority: input.priority ?? 'normal',
    sla,
    deadline,
    requesterId: input.requesterId,
    targetRole: input.targetRole,
    targetUserId: input.targetUserId,
    channel: input.channel,
    timestamps,
    context: input.context,
    metadata: input.metadata,
  }

  const thing = await graph.createThing({
    id: requestId,
    typeId: REQUEST_TYPE_IDS.review,
    typeName: REQUEST_TYPE_NAMES.review,
    data: requestData,
  })

  const targetId = input.targetUserId ?? input.targetRole ?? 'pending'
  const relationship = await graph.createRelationship({
    id: `${requestId}-${HUMAN_VERBS.REVIEW}-${targetId}-${now}`,
    verb: HUMAN_VERBS.REVIEW,
    from: HumanUrls.review(requestId),
    to: HumanUrls.user(targetId),
    data: {
      priority: input.priority ?? 'normal',
      sla,
      deadline,
      requestedAt: now,
    },
  })

  return { thing, relationship }
}

/**
 * Get a review request by ID
 */
export async function getReviewRequest(
  graph: GraphStore,
  requestId: string
): Promise<GraphThing | null> {
  const thing = await graph.getThing(requestId)
  if (!thing || thing.typeName !== REQUEST_TYPE_NAMES.review || thing.deletedAt !== null) {
    return null
  }
  return thing
}

/**
 * Start reviewing
 */
export async function startReviewRequest(
  graph: GraphStore,
  requestId: string,
  reviewerId: string
): Promise<GraphRelationship> {
  const thing = await getReviewRequest(graph, requestId)
  if (!thing) {
    throw new Error(`Review request not found: ${requestId}`)
  }

  const data = thing.data as ReviewRequestThingData
  if (data.review) {
    throw new Error(`Review already completed for request ${requestId}`)
  }

  const now = Date.now()

  const newTimestamps: ReviewTimestamps = {
    ...data.timestamps,
    assignedAt: now,
    startedAt: now,
    firstResponseAt: data.timestamps.firstResponseAt ?? now,
  }

  await graph.updateThing(requestId, {
    data: {
      ...data,
      timestamps: newTimestamps,
    },
  })

  // Delete old relationship
  const oldRels = await graph.queryRelationshipsFrom(HumanUrls.review(requestId))
  for (const rel of oldRels) {
    if (rel.verb === HUMAN_VERBS.REVIEW) {
      await graph.deleteRelationship(rel.id)
    }
  }

  return graph.createRelationship({
    id: `${requestId}-${HUMAN_VERBS.REVIEWING}-${reviewerId}-${now}`,
    verb: HUMAN_VERBS.REVIEWING,
    from: HumanUrls.review(requestId),
    to: HumanUrls.user(reviewerId),
    data: {
      startedAt: now,
    },
  })
}

/**
 * Complete a review
 */
export async function completeReview(
  graph: GraphStore,
  requestId: string,
  result: ReviewResult
): Promise<{ thing: GraphThing; relationship: GraphRelationship }> {
  const thing = await getReviewRequest(graph, requestId)
  if (!thing) {
    throw new Error(`Review request not found: ${requestId}`)
  }

  const data = thing.data as ReviewRequestThingData
  if (data.review) {
    throw new Error(`Review already completed for request ${requestId}`)
  }

  const now = Date.now()

  const newTimestamps: ReviewTimestamps = {
    ...data.timestamps,
    completedAt: now,
  }

  await graph.updateThing(requestId, {
    data: {
      ...data,
      timestamps: newTimestamps,
      review: result,
    },
  })

  // Delete old relationships
  const oldRels = await graph.queryRelationshipsFrom(HumanUrls.review(requestId))
  for (const rel of oldRels) {
    if (rel.verb === HUMAN_VERBS.REVIEW || rel.verb === HUMAN_VERBS.REVIEWING) {
      await graph.deleteRelationship(rel.id)
    }
  }

  const relationship = await graph.createRelationship({
    id: `${requestId}-${HUMAN_VERBS.REVIEWED}-${result.reviewedBy}-${now}`,
    verb: HUMAN_VERBS.REVIEWED,
    from: HumanUrls.review(requestId),
    to: HumanUrls.user(result.reviewedBy),
    data: {
      reviewedAt: now,
      approved: result.approved,
      score: result.score,
      feedback: result.feedback,
      issueCount: result.issues?.length ?? 0,
    },
  })

  const updatedThing = await getReviewRequest(graph, requestId)
  return { thing: updatedThing!, relationship }
}

// ============================================================================
// SLA TRACKING
// ============================================================================

/**
 * Calculate SLA status for a request
 */
export function calculateSLAStatus(
  request: HumanRequestThingData,
  config?: SLAConfiguration
): SLAStatus {
  const now = Date.now()
  const slaConfig = config ?? DEFAULT_SLA_CONFIG

  // Get deadline from request
  const deadline = request.deadline ?? now + slaConfig.default
  const sla = request.sla ?? slaConfig.default

  const timeRemaining = deadline - now
  const consumed = sla > 0 ? (sla - timeRemaining) / sla : 0
  const breached = timeRemaining < 0
  const warningThreshold = slaConfig.warningThreshold
  const warning = consumed >= warningThreshold && !breached

  return {
    breached,
    timeRemaining,
    warning,
    deadline,
    consumed: Math.max(0, consumed),
  }
}

/**
 * Get SLA status for a task request
 */
export async function getTaskSLAStatus(
  graph: GraphStore,
  requestId: string,
  config?: SLAConfiguration
): Promise<SLAStatus | null> {
  const thing = await getTaskRequest(graph, requestId)
  if (!thing) return null
  return calculateSLAStatus(thing.data as TaskRequestThingData, config)
}

/**
 * Get SLA status for a decision request
 */
export async function getDecisionSLAStatus(
  graph: GraphStore,
  requestId: string,
  config?: SLAConfiguration
): Promise<SLAStatus | null> {
  const thing = await getDecisionRequest(graph, requestId)
  if (!thing) return null
  return calculateSLAStatus(thing.data as DecisionRequestThingData, config)
}

/**
 * Get SLA status for a review request
 */
export async function getReviewSLAStatus(
  graph: GraphStore,
  requestId: string,
  config?: SLAConfiguration
): Promise<SLAStatus | null> {
  const thing = await getReviewRequest(graph, requestId)
  if (!thing) return null
  return calculateSLAStatus(thing.data as ReviewRequestThingData, config)
}

/**
 * Calculate time metrics for a completed request
 */
export function calculateTimeMetrics(timestamps: TaskTimestamps | DecisionTimestamps | ReviewTimestamps): {
  timeToFirstResponse: number | null
  timeToCompletion: number | null
  timePerEscalation: number[]
} {
  const createdAt = timestamps.createdAt
  const firstResponseAt = timestamps.firstResponseAt
  const completedAt = 'completedAt' in timestamps ? timestamps.completedAt : ('decidedAt' in timestamps ? timestamps.decidedAt : undefined)

  const timeToFirstResponse = firstResponseAt ? firstResponseAt - createdAt : null
  const timeToCompletion = completedAt ? completedAt - createdAt : null

  const escalations = timestamps.escalations ?? []
  const timePerEscalation: number[] = []

  for (let i = 0; i < escalations.length; i++) {
    const prevTime = i === 0 ? createdAt : escalations[i - 1]!.escalatedAt
    timePerEscalation.push(escalations[i]!.escalatedAt - prevTime)
  }

  return {
    timeToFirstResponse,
    timeToCompletion,
    timePerEscalation,
  }
}

// ============================================================================
// ESCALATION
// ============================================================================

/**
 * Escalate a task request
 */
export async function escalateTaskRequest(
  graph: GraphStore,
  requestId: string,
  escalation: {
    toUserId?: string
    toRole?: string
    reason?: string
    escalatedBy?: string
    sla?: number
  }
): Promise<GraphRelationship> {
  const thing = await getTaskRequest(graph, requestId)
  if (!thing) {
    throw new Error(`Task request not found: ${requestId}`)
  }

  const data = thing.data as TaskRequestThingData
  if (data.state === 'completed' || data.state === 'cancelled') {
    throw new Error(`Cannot escalate: task is ${data.state}`)
  }

  const now = Date.now()

  // Get current escalation level
  const currentEscalations = data.timestamps.escalations ?? []
  const level = currentEscalations.length + 1

  // Add escalation to timestamps
  const targetId = escalation.toUserId ?? escalation.toRole ?? 'escalated'
  const newEscalations = [
    ...currentEscalations,
    {
      level,
      escalatedAt: now,
      target: targetId,
    },
  ]

  const newTimestamps: TaskTimestamps = {
    ...data.timestamps,
    escalations: newEscalations,
  }

  // Update thing
  await graph.updateThing(requestId, {
    data: {
      ...data,
      targetUserId: escalation.toUserId ?? data.targetUserId,
      targetRole: escalation.toRole ?? data.targetRole,
      timestamps: newTimestamps,
      metadata: {
        ...data.metadata,
        escalationLevel: level,
        lastEscalatedAt: now,
      },
    },
  })

  // Create escalation relationship
  const escalationData: EscalationData = {
    requestId,
    level,
    reason: escalation.reason,
    escalatedAt: now,
    escalatedBy: escalation.escalatedBy,
    sla: escalation.sla,
  }

  return graph.createRelationship({
    id: `${requestId}-${HUMAN_VERBS.ESCALATED}-${targetId}-${now}`,
    verb: HUMAN_VERBS.ESCALATED,
    from: HumanUrls.task(requestId),
    to: HumanUrls.user(targetId),
    data: escalationData,
  })
}

/**
 * Get escalation chain for a task request
 */
export async function getTaskEscalationChain(
  graph: GraphStore,
  requestId: string
): Promise<Array<{ relationship: GraphRelationship; target: GraphThing | null }>> {
  const escalations = await graph.queryRelationshipsFrom(HumanUrls.task(requestId), {
    verb: HUMAN_VERBS.ESCALATED,
  })

  // Sort by level
  escalations.sort((a, b) => {
    const aLevel = (a.data as EscalationData)?.level ?? 0
    const bLevel = (b.data as EscalationData)?.level ?? 0
    return aLevel - bLevel
  })

  const results: Array<{ relationship: GraphRelationship; target: GraphThing | null }> = []

  for (const rel of escalations) {
    const targetId = HumanUrls.extractId(rel.to)
    const target = await graph.getThing(targetId)
    results.push({ relationship: rel, target })
  }

  return results
}

// ============================================================================
// NOTIFICATION TRACKING
// ============================================================================

/**
 * Record a notification delivery for any request type
 */
export async function recordRequestNotification(
  graph: GraphStore,
  requestType: HumanRequestType,
  requestId: string,
  delivery: NotificationDeliveryData
): Promise<GraphRelationship> {
  const urlFn = {
    approval: HumanUrls.approval,
    task: HumanUrls.task,
    decision: HumanUrls.decision,
    review: HumanUrls.review,
  }[requestType]

  return graph.createRelationship({
    id: `${requestId}-${HUMAN_VERBS.NOTIFIED_VIA}-${delivery.channel}-${Date.now()}`,
    verb: HUMAN_VERBS.NOTIFIED_VIA,
    from: urlFn(requestId),
    to: `channels://${delivery.channel}/${delivery.messageId ?? 'unknown'}`,
    data: delivery,
  })
}

/**
 * Get notification history for any request type
 */
export async function getRequestNotificationHistory(
  graph: GraphStore,
  requestType: HumanRequestType,
  requestId: string
): Promise<NotificationDeliveryData[]> {
  const urlFn = {
    approval: HumanUrls.approval,
    task: HumanUrls.task,
    decision: HumanUrls.decision,
    review: HumanUrls.review,
  }[requestType]

  const relationships = await graph.queryRelationshipsFrom(urlFn(requestId), {
    verb: HUMAN_VERBS.NOTIFIED_VIA,
  })

  return relationships.map((rel) => rel.data as NotificationDeliveryData)
}

// ============================================================================
// QUERY HELPERS
// ============================================================================

/**
 * Get pending tasks for a user
 */
export async function getPendingTasks(
  graph: GraphStore,
  userId: string
): Promise<GraphThing[]> {
  const relationships = await graph.queryRelationshipsTo(HumanUrls.user(userId), {
    verb: HUMAN_VERBS.ASSIGN,
  })

  const results: GraphThing[] = []
  for (const rel of relationships) {
    const requestId = HumanUrls.extractId(rel.from)
    const thing = await getTaskRequest(graph, requestId)
    if (thing) {
      const data = thing.data as TaskRequestThingData
      if (data.state === 'pending' || data.state === 'assigned') {
        results.push(thing)
      }
    }
  }

  return results
}

/**
 * Get pending decisions for a user
 */
export async function getPendingDecisions(
  graph: GraphStore,
  userId: string
): Promise<GraphThing[]> {
  const relationships = await graph.queryRelationshipsTo(HumanUrls.user(userId), {
    verb: HUMAN_VERBS.DECIDE,
  })

  const results: GraphThing[] = []
  for (const rel of relationships) {
    const requestId = HumanUrls.extractId(rel.from)
    const thing = await getDecisionRequest(graph, requestId)
    if (thing) {
      const data = thing.data as DecisionRequestThingData
      if (!data.decision) {
        results.push(thing)
      }
    }
  }

  return results
}

/**
 * Get pending reviews for a user
 */
export async function getPendingReviews(
  graph: GraphStore,
  userId: string
): Promise<GraphThing[]> {
  const relationships = await graph.queryRelationshipsTo(HumanUrls.user(userId), {
    verb: HUMAN_VERBS.REVIEW,
  })

  const results: GraphThing[] = []
  for (const rel of relationships) {
    const requestId = HumanUrls.extractId(rel.from)
    const thing = await getReviewRequest(graph, requestId)
    if (thing) {
      const data = thing.data as ReviewRequestThingData
      if (!data.review) {
        results.push(thing)
      }
    }
  }

  return results
}

/**
 * Get all pending human requests for a user
 */
export async function getAllPendingRequests(
  graph: GraphStore,
  userId: string
): Promise<{
  tasks: GraphThing[]
  decisions: GraphThing[]
  reviews: GraphThing[]
}> {
  const [tasks, decisions, reviews] = await Promise.all([
    getPendingTasks(graph, userId),
    getPendingDecisions(graph, userId),
    getPendingReviews(graph, userId),
  ])

  return { tasks, decisions, reviews }
}
