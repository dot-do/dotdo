/**
 * Approval Workflow Graph Store
 *
 * Human-in-the-loop approval workflows using verb form state encoding:
 * - approve (intent) -> approving (in-progress) -> approved/rejected (completed)
 *
 * Integrates with ceo`approve`, legal`review` template literal patterns.
 *
 * @module db/graph/humans/approval
 */

import type { GraphStore, GraphThing, GraphRelationship } from '../types'
import {
  HUMAN_TYPE_IDS,
  HUMAN_TYPE_NAMES,
  HUMAN_VERBS,
  HumanUrls,
  type ApprovalRequestThingData,
  type ApprovalResponse,
  type ApprovalStatus,
  type EscalationData,
  type NotificationDeliveryData,
  type NotificationPriority,
  type NotificationChannelType,
  isApprovalRequestThingData,
} from './types'

// ============================================================================
// CONSTANTS
// ============================================================================

export const APPROVAL_TYPE_ID = HUMAN_TYPE_IDS.ApprovalRequest
export const APPROVAL_TYPE_NAME = HUMAN_TYPE_NAMES.ApprovalRequest

/**
 * Map verb forms to approval status
 */
export const VERB_TO_STATUS: Record<string, ApprovalStatus> = {
  [HUMAN_VERBS.APPROVE]: 'pending',
  [HUMAN_VERBS.APPROVING]: 'approving',
  [HUMAN_VERBS.APPROVED]: 'approved',
  [HUMAN_VERBS.REJECTED]: 'rejected',
  [HUMAN_VERBS.REVIEW]: 'pending',
  [HUMAN_VERBS.REVIEWING]: 'approving',
  [HUMAN_VERBS.REVIEWED]: 'approved',
}

/**
 * Map approval status to verb form
 */
export const STATUS_TO_VERB: Record<ApprovalStatus, string> = {
  pending: HUMAN_VERBS.APPROVE,
  approving: HUMAN_VERBS.APPROVING,
  approved: HUMAN_VERBS.APPROVED,
  rejected: HUMAN_VERBS.REJECTED,
  expired: HUMAN_VERBS.REJECTED,
  cancelled: HUMAN_VERBS.REJECTED,
}

// ============================================================================
// APPROVAL REQUEST CRUD
// ============================================================================

/**
 * Create a new approval request
 */
export async function createApprovalRequest(
  graph: GraphStore,
  data: ApprovalRequestThingData,
  options?: { id?: string; targetId?: string }
): Promise<{ thing: GraphThing; relationship: GraphRelationship }> {
  const requestId = options?.id ?? `approval-${crypto.randomUUID()}`

  // Calculate deadline from SLA if provided
  const deadline = data.sla ? Date.now() + data.sla : data.deadline

  const requestData: ApprovalRequestThingData = {
    ...data,
    deadline,
    priority: data.priority ?? 'normal',
  }

  const thing = await graph.createThing({
    id: requestId,
    typeId: APPROVAL_TYPE_ID,
    typeName: APPROVAL_TYPE_NAME,
    data: requestData,
  })

  // Determine target ID (specific user or role-based)
  const targetId = options?.targetId ?? data.targetUserId ?? data.targetRole ?? 'pending'

  // Create the approval relationship with intent verb
  const verb = data.type === 'review' ? HUMAN_VERBS.REVIEW : HUMAN_VERBS.APPROVE
  const relationship = await graph.createRelationship({
    id: `${requestId}-${verb}-${targetId}-${Date.now()}`,
    verb,
    from: HumanUrls.approval(requestId),
    to: HumanUrls.user(targetId),
    data: {
      priority: data.priority,
      sla: data.sla,
      deadline,
      channel: data.channel,
      requestedAt: Date.now(),
    },
  })

  return { thing, relationship }
}

/**
 * Get an approval request by ID
 */
export async function getApprovalRequest(
  graph: GraphStore,
  requestId: string
): Promise<GraphThing | null> {
  const thing = await graph.getThing(requestId)
  if (!thing || thing.typeName !== APPROVAL_TYPE_NAME || thing.deletedAt !== null) {
    return null
  }
  return thing
}

/**
 * Get the current status of an approval request from its relationship verb
 */
export async function getApprovalStatus(
  graph: GraphStore,
  requestId: string
): Promise<{ status: ApprovalStatus; relationship: GraphRelationship | null }> {
  // Find the approval relationship
  const relationships = await graph.queryRelationshipsFrom(HumanUrls.approval(requestId))

  // Find the most recent approval-related relationship
  const approvalVerbs = [
    HUMAN_VERBS.APPROVE,
    HUMAN_VERBS.APPROVING,
    HUMAN_VERBS.APPROVED,
    HUMAN_VERBS.REJECTED,
    HUMAN_VERBS.REVIEW,
    HUMAN_VERBS.REVIEWING,
    HUMAN_VERBS.REVIEWED,
  ]

  const approvalRel = relationships.find((rel) => approvalVerbs.includes(rel.verb))

  if (!approvalRel) {
    return { status: 'pending', relationship: null }
  }

  const status = VERB_TO_STATUS[approvalRel.verb] ?? 'pending'
  return { status, relationship: approvalRel }
}

// ============================================================================
// APPROVAL STATE TRANSITIONS
// ============================================================================

/**
 * Start review (transition: approve -> approving)
 */
export async function startReview(
  graph: GraphStore,
  requestId: string,
  reviewerId: string
): Promise<GraphRelationship> {
  const { status, relationship } = await getApprovalStatus(graph, requestId)

  if (status !== 'pending') {
    throw new Error(`Cannot start review: request is ${status}, expected pending`)
  }

  if (!relationship) {
    throw new Error(`No approval relationship found for request ${requestId}`)
  }

  // Delete the old relationship
  await graph.deleteRelationship(relationship.id)

  // Create new relationship with in-progress verb
  const newVerb = relationship.verb === HUMAN_VERBS.REVIEW
    ? HUMAN_VERBS.REVIEWING
    : HUMAN_VERBS.APPROVING

  return graph.createRelationship({
    id: `${requestId}-${newVerb}-${reviewerId}-${Date.now()}`,
    verb: newVerb,
    from: HumanUrls.approval(requestId),
    to: HumanUrls.user(reviewerId),
    data: {
      ...relationship.data,
      startedAt: Date.now(),
      reviewerId,
    },
  })
}

/**
 * Complete approval (transition: approving -> approved/rejected)
 */
export async function completeApproval(
  graph: GraphStore,
  requestId: string,
  response: ApprovalResponse
): Promise<{ thing: GraphThing; relationship: GraphRelationship }> {
  const { status, relationship } = await getApprovalStatus(graph, requestId)

  if (status !== 'approving' && status !== 'pending') {
    throw new Error(`Cannot complete approval: request is ${status}`)
  }

  // Delete the old relationship
  if (relationship) {
    await graph.deleteRelationship(relationship.id)
  }

  // Update the thing with response data
  const thing = await getApprovalRequest(graph, requestId)
  if (!thing) {
    throw new Error(`Approval request not found: ${requestId}`)
  }

  const data = thing.data as ApprovalRequestThingData
  await graph.updateThing(requestId, {
    data: { ...data, response },
  })

  // Create new relationship with completed verb
  const newVerb = response.approved ? HUMAN_VERBS.APPROVED : HUMAN_VERBS.REJECTED
  const newRelationship = await graph.createRelationship({
    id: `${requestId}-${newVerb}-${response.responderId}-${Date.now()}`,
    verb: newVerb,
    from: HumanUrls.approval(requestId),
    to: HumanUrls.user(response.responderId),
    data: {
      ...relationship?.data,
      completedAt: response.respondedAt,
      reason: response.reason,
      approved: response.approved,
    },
  })

  const updatedThing = await getApprovalRequest(graph, requestId)
  return { thing: updatedThing!, relationship: newRelationship }
}

/**
 * Approve a request (shorthand)
 */
export async function approve(
  graph: GraphStore,
  requestId: string,
  approverId: string,
  reason?: string
): Promise<{ thing: GraphThing; relationship: GraphRelationship }> {
  return completeApproval(graph, requestId, {
    approved: true,
    responderId: approverId,
    respondedAt: Date.now(),
    reason,
  })
}

/**
 * Reject a request (shorthand)
 */
export async function reject(
  graph: GraphStore,
  requestId: string,
  rejecterId: string,
  reason?: string
): Promise<{ thing: GraphThing; relationship: GraphRelationship }> {
  return completeApproval(graph, requestId, {
    approved: false,
    responderId: rejecterId,
    respondedAt: Date.now(),
    reason,
  })
}

/**
 * Cancel an approval request
 */
export async function cancelApproval(
  graph: GraphStore,
  requestId: string,
  reason?: string
): Promise<void> {
  const { status, relationship } = await getApprovalStatus(graph, requestId)

  if (status === 'approved' || status === 'rejected') {
    throw new Error(`Cannot cancel: request is already ${status}`)
  }

  // Delete the relationship
  if (relationship) {
    await graph.deleteRelationship(relationship.id)
  }

  // Update the thing
  const thing = await getApprovalRequest(graph, requestId)
  if (thing) {
    const data = thing.data as ApprovalRequestThingData
    await graph.updateThing(requestId, {
      data: {
        ...data,
        response: {
          approved: false,
          responderId: 'system',
          respondedAt: Date.now(),
          reason: reason ?? 'Cancelled',
        },
      },
    })
  }
}

// ============================================================================
// APPROVAL QUERIES
// ============================================================================

/**
 * Get pending approvals for a user
 */
export async function getPendingApprovals(
  graph: GraphStore,
  userId: string,
  options?: { type?: 'approval' | 'review' }
): Promise<GraphThing[]> {
  const verbs = options?.type === 'review'
    ? [HUMAN_VERBS.REVIEW, HUMAN_VERBS.REVIEWING]
    : [HUMAN_VERBS.APPROVE, HUMAN_VERBS.APPROVING]

  const results: GraphThing[] = []

  for (const verb of verbs) {
    const relationships = await graph.queryRelationshipsTo(HumanUrls.user(userId), { verb })

    for (const rel of relationships) {
      const requestId = HumanUrls.extractId(rel.from)
      const thing = await getApprovalRequest(graph, requestId)
      if (thing) {
        results.push(thing)
      }
    }
  }

  return results
}

/**
 * Get pending approvals for a role
 */
export async function getPendingApprovalsForRole(
  graph: GraphStore,
  role: string
): Promise<GraphThing[]> {
  // Get all approval requests and filter by target role
  const requests = await graph.getThingsByType({
    typeName: APPROVAL_TYPE_NAME,
    limit: 1000,
  })

  const results: GraphThing[] = []

  for (const request of requests) {
    if (request.deletedAt !== null) continue

    const data = request.data as ApprovalRequestThingData
    if (data.targetRole !== role) continue

    const { status } = await getApprovalStatus(graph, request.id)
    if (status === 'pending' || status === 'approving') {
      results.push(request)
    }
  }

  return results
}

/**
 * Get approval history for a user (as approver)
 */
export async function getApprovalHistory(
  graph: GraphStore,
  userId: string,
  options?: { limit?: number; approved?: boolean }
): Promise<GraphThing[]> {
  const verbs = options?.approved === undefined
    ? [HUMAN_VERBS.APPROVED, HUMAN_VERBS.REJECTED, HUMAN_VERBS.REVIEWED]
    : options.approved
      ? [HUMAN_VERBS.APPROVED, HUMAN_VERBS.REVIEWED]
      : [HUMAN_VERBS.REJECTED]

  const results: GraphThing[] = []

  for (const verb of verbs) {
    const relationships = await graph.queryRelationshipsTo(HumanUrls.user(userId), { verb })

    for (const rel of relationships) {
      const requestId = HumanUrls.extractId(rel.from)
      const thing = await getApprovalRequest(graph, requestId)
      if (thing) {
        results.push(thing)
      }
    }
  }

  // Sort by completion time (most recent first) and apply limit
  results.sort((a, b) => {
    const aData = a.data as ApprovalRequestThingData
    const bData = b.data as ApprovalRequestThingData
    return (bData.response?.respondedAt ?? 0) - (aData.response?.respondedAt ?? 0)
  })

  if (options?.limit && results.length > options.limit) {
    return results.slice(0, options.limit)
  }

  return results
}

/**
 * Get actions/requests created by a user
 */
export async function getRequestedApprovals(
  graph: GraphStore,
  requesterId: string,
  options?: { status?: ApprovalStatus; limit?: number }
): Promise<GraphThing[]> {
  const requests = await graph.getThingsByType({
    typeName: APPROVAL_TYPE_NAME,
    limit: options?.limit ?? 100,
  })

  const results: GraphThing[] = []

  for (const request of requests) {
    if (request.deletedAt !== null) continue

    const data = request.data as ApprovalRequestThingData
    if (data.requesterId !== requesterId) continue

    if (options?.status) {
      const { status } = await getApprovalStatus(graph, request.id)
      if (status !== options.status) continue
    }

    results.push(request)
  }

  return results
}

// ============================================================================
// ESCALATION
// ============================================================================

/**
 * Escalate an approval request to another user/role
 */
export async function escalateApproval(
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
  const { status, relationship } = await getApprovalStatus(graph, requestId)

  if (status === 'approved' || status === 'rejected') {
    throw new Error(`Cannot escalate: request is already ${status}`)
  }

  // Get existing escalation level
  const existingEscalations = await graph.queryRelationshipsFrom(
    HumanUrls.approval(requestId),
    { verb: HUMAN_VERBS.ESCALATED }
  )

  const level = existingEscalations.length + 1

  // Create escalation relationship
  const targetId = escalation.toUserId ?? escalation.toRole ?? 'escalated'
  const escalationData: EscalationData = {
    requestId,
    level,
    reason: escalation.reason,
    escalatedAt: Date.now(),
    escalatedBy: escalation.escalatedBy,
    sla: escalation.sla,
  }

  const escalationRel = await graph.createRelationship({
    id: `${requestId}-${HUMAN_VERBS.ESCALATED}-${targetId}-${Date.now()}`,
    verb: HUMAN_VERBS.ESCALATED,
    from: HumanUrls.approval(requestId),
    to: HumanUrls.user(targetId),
    data: escalationData,
  })

  // Update the request thing with new target
  const thing = await getApprovalRequest(graph, requestId)
  if (thing) {
    const data = thing.data as ApprovalRequestThingData
    await graph.updateThing(requestId, {
      data: {
        ...data,
        targetUserId: escalation.toUserId ?? data.targetUserId,
        targetRole: escalation.toRole ?? data.targetRole,
        metadata: {
          ...data.metadata,
          escalationLevel: level,
          lastEscalatedAt: Date.now(),
        },
      },
    })
  }

  // If there was an existing pending/approving relationship, delete it
  if (relationship && (status === 'pending' || status === 'approving')) {
    await graph.deleteRelationship(relationship.id)

    // Create new pending relationship to the escalation target
    await graph.createRelationship({
      id: `${requestId}-${HUMAN_VERBS.APPROVE}-${targetId}-${Date.now()}`,
      verb: HUMAN_VERBS.APPROVE,
      from: HumanUrls.approval(requestId),
      to: HumanUrls.user(targetId),
      data: {
        priority: 'urgent', // Escalated requests are urgent
        sla: escalation.sla,
        escalationLevel: level,
        requestedAt: Date.now(),
      },
    })
  }

  return escalationRel
}

/**
 * Get escalation chain for a request
 */
export async function getEscalationChain(
  graph: GraphStore,
  requestId: string
): Promise<Array<{ relationship: GraphRelationship; target: GraphThing | null }>> {
  const escalations = await graph.queryRelationshipsFrom(
    HumanUrls.approval(requestId),
    { verb: HUMAN_VERBS.ESCALATED }
  )

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
 * Record a notification delivery
 */
export async function recordNotificationDelivery(
  graph: GraphStore,
  requestId: string,
  delivery: NotificationDeliveryData
): Promise<GraphRelationship> {
  return graph.createRelationship({
    id: `${requestId}-${HUMAN_VERBS.NOTIFIED_VIA}-${delivery.channel}-${Date.now()}`,
    verb: HUMAN_VERBS.NOTIFIED_VIA,
    from: HumanUrls.approval(requestId),
    to: `channels://${delivery.channel}/${delivery.messageId ?? 'unknown'}`,
    data: delivery,
  })
}

/**
 * Get notification delivery history for a request
 */
export async function getNotificationHistory(
  graph: GraphStore,
  requestId: string
): Promise<NotificationDeliveryData[]> {
  const relationships = await graph.queryRelationshipsFrom(
    HumanUrls.approval(requestId),
    { verb: HUMAN_VERBS.NOTIFIED_VIA }
  )

  return relationships.map((rel) => rel.data as NotificationDeliveryData)
}

// ============================================================================
// SLA AND EXPIRY
// ============================================================================

/**
 * Check if an approval request is past its SLA
 */
export async function checkSLABreach(
  graph: GraphStore,
  requestId: string
): Promise<{ breached: boolean; overdueBy?: number }> {
  const thing = await getApprovalRequest(graph, requestId)
  if (!thing) {
    return { breached: false }
  }

  const { status } = await getApprovalStatus(graph, requestId)
  if (status === 'approved' || status === 'rejected' || status === 'cancelled') {
    return { breached: false }
  }

  const data = thing.data as ApprovalRequestThingData
  if (!data.deadline) {
    return { breached: false }
  }

  const now = Date.now()
  if (now > data.deadline) {
    return { breached: true, overdueBy: now - data.deadline }
  }

  return { breached: false }
}

/**
 * Expire an approval request that's past its deadline
 */
export async function expireApproval(
  graph: GraphStore,
  requestId: string
): Promise<void> {
  const { breached } = await checkSLABreach(graph, requestId)
  if (!breached) {
    throw new Error(`Cannot expire: request is not past SLA`)
  }

  await cancelApproval(graph, requestId, 'Expired due to SLA breach')
}

/**
 * Get all breached SLA requests
 */
export async function getBreachedSLARequests(graph: GraphStore): Promise<GraphThing[]> {
  const requests = await graph.getThingsByType({
    typeName: APPROVAL_TYPE_NAME,
    limit: 1000,
  })

  const results: GraphThing[] = []

  for (const request of requests) {
    if (request.deletedAt !== null) continue

    const { breached } = await checkSLABreach(graph, request.id)
    if (breached) {
      results.push(request)
    }
  }

  return results
}

// ============================================================================
// METRICS
// ============================================================================

/**
 * Get approval metrics for a user (as approver)
 */
export async function getApproverMetrics(
  graph: GraphStore,
  userId: string,
  options?: { since?: number }
): Promise<{
  totalApproved: number
  totalRejected: number
  totalReviewed: number
  avgResponseTime: number
}> {
  const verbs = [HUMAN_VERBS.APPROVED, HUMAN_VERBS.REJECTED, HUMAN_VERBS.REVIEWED]
  let totalApproved = 0
  let totalRejected = 0
  let totalReviewed = 0
  let totalResponseTime = 0
  let responseCount = 0

  for (const verb of verbs) {
    const relationships = await graph.queryRelationshipsTo(HumanUrls.user(userId), { verb })

    for (const rel of relationships) {
      const data = rel.data as Record<string, unknown>
      const completedAt = data.completedAt as number | undefined
      const requestedAt = data.requestedAt as number | undefined

      if (options?.since && completedAt && completedAt < options.since) continue

      if (verb === HUMAN_VERBS.APPROVED) totalApproved++
      else if (verb === HUMAN_VERBS.REJECTED) totalRejected++
      else if (verb === HUMAN_VERBS.REVIEWED) totalReviewed++

      if (completedAt && requestedAt) {
        totalResponseTime += completedAt - requestedAt
        responseCount++
      }
    }
  }

  return {
    totalApproved,
    totalRejected,
    totalReviewed,
    avgResponseTime: responseCount > 0 ? Math.round(totalResponseTime / responseCount) : 0,
  }
}
