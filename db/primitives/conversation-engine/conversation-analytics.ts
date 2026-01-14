/**
 * ConversationAnalytics - Support metrics and conversation performance tracking
 *
 * Provides comprehensive analytics for support and conversation metrics:
 * - First response time (FRT) - time from conversation start to first agent response
 * - Resolution time (TRT) - total time from creation to closure
 * - Handle time per agent - time spent by each agent on conversations
 * - CSAT score tracking - customer satisfaction scores with aggregations
 * - Volume by channel/time - conversation volume analysis
 * - SLA compliance tracking - target vs actual performance
 *
 * @example
 * ```typescript
 * import { createConversationAnalytics } from 'db/primitives/conversation-engine/conversation-analytics'
 *
 * const analytics = createConversationAnalytics()
 *
 * // Record conversation events
 * analytics.recordConversationCreated({
 *   conversationId: 'conv_123',
 *   channel: 'chat',
 *   priority: 'high',
 *   createdAt: new Date()
 * })
 *
 * analytics.recordFirstResponse({
 *   conversationId: 'conv_123',
 *   agentId: 'agent_456',
 *   respondedAt: new Date()
 * })
 *
 * // Get metrics
 * const metrics = analytics.getMetrics({
 *   from: new Date('2025-01-01'),
 *   to: new Date('2025-01-31'),
 *   groupBy: 'day'
 * })
 * ```
 *
 * @module db/primitives/conversation-engine/conversation-analytics
 */

import type {
  ChannelType,
  Priority,
  Conversation,
  ConversationStatus,
} from './index'

// =============================================================================
// Types - Time Metrics
// =============================================================================

export interface ResponseTimeMetric {
  conversationId: string
  firstResponseTimeMs: number
  agentId: string
  channel: ChannelType
  priority: Priority
  timestamp: Date
}

export interface ResolutionTimeMetric {
  conversationId: string
  resolutionTimeMs: number
  channel: ChannelType
  priority: Priority
  status: ConversationStatus
  closeReason?: string
  createdAt: Date
  closedAt: Date
}

export interface AgentHandleTimeMetric {
  conversationId: string
  agentId: string
  handleTimeMs: number
  messageCount: number
  startedAt: Date
  endedAt: Date
}

// =============================================================================
// Types - CSAT
// =============================================================================

export interface CSATScore {
  conversationId: string
  agentId?: string
  score: number // 1-5 typically
  maxScore: number
  feedback?: string
  submittedAt: Date
  channel: ChannelType
}

export interface CSATAggregation {
  averageScore: number
  totalResponses: number
  distribution: Record<number, number> // score -> count
  npsScore?: number // Net Promoter Score if applicable
}

// =============================================================================
// Types - Volume
// =============================================================================

export interface VolumeMetric {
  period: Date
  periodType: 'hour' | 'day' | 'week' | 'month'
  channel: ChannelType
  totalConversations: number
  newConversations: number
  closedConversations: number
  reopenedConversations: number
  escalatedConversations: number
  transferredConversations: number
}

export interface ChannelVolume {
  channel: ChannelType
  total: number
  percentage: number
}

export interface TimeDistribution {
  hour: number
  count: number
  averageResponseTimeMs: number
}

// =============================================================================
// Types - SLA
// =============================================================================

export type SLAType = 'first_response' | 'resolution' | 'update_response'

export interface SLATarget {
  id: string
  name: string
  type: SLAType
  targetMs: number
  priority?: Priority
  channel?: ChannelType
  warningThresholdMs?: number
  businessHoursOnly?: boolean
}

export interface SLAResult {
  conversationId: string
  slaTargetId: string
  targetMs: number
  actualMs: number
  met: boolean
  breachMs?: number // How much over the target
  timestamp: Date
}

export interface SLACompliance {
  slaTargetId: string
  slaName: string
  totalEvaluated: number
  totalMet: number
  totalBreached: number
  complianceRate: number // 0-1
  averageActualMs: number
  p50Ms: number
  p90Ms: number
  p99Ms: number
}

// =============================================================================
// Types - Query Options
// =============================================================================

export interface MetricsQuery {
  from?: Date
  to?: Date
  channel?: ChannelType[]
  priority?: Priority[]
  agentId?: string
  groupBy?: 'hour' | 'day' | 'week' | 'month'
}

export interface ConversationMetrics {
  // Response time metrics
  averageFirstResponseTimeMs: number
  medianFirstResponseTimeMs: number
  p90FirstResponseTimeMs: number
  p99FirstResponseTimeMs: number

  // Resolution time metrics
  averageResolutionTimeMs: number
  medianResolutionTimeMs: number
  p90ResolutionTimeMs: number
  p99ResolutionTimeMs: number

  // Agent metrics
  averageHandleTimeMs: number
  totalAgentInteractions: number

  // Volume metrics
  totalConversations: number
  conversationsByChannel: ChannelVolume[]
  conversationsByPriority: Record<Priority, number>

  // CSAT metrics
  csat: CSATAggregation

  // SLA metrics
  slaCompliance: SLACompliance[]

  // Time period
  periodStart: Date
  periodEnd: Date
}

export interface AgentPerformanceMetrics {
  agentId: string
  totalConversationsHandled: number
  averageHandleTimeMs: number
  averageResponseTimeMs: number
  csatScore: number
  csatResponses: number
  slaComplianceRate: number
  conversationsByStatus: Record<ConversationStatus, number>
}

// =============================================================================
// Types - Events for Recording
// =============================================================================

export interface ConversationCreatedEvent {
  conversationId: string
  channel: ChannelType
  priority?: Priority
  createdAt: Date
}

export interface FirstResponseEvent {
  conversationId: string
  agentId: string
  respondedAt: Date
}

export interface ConversationClosedEvent {
  conversationId: string
  closedAt: Date
  closeReason?: string
  status: ConversationStatus
}

export interface ConversationReopenedEvent {
  conversationId: string
  reopenedAt: Date
}

export interface AgentAssignedEvent {
  conversationId: string
  agentId: string
  assignedAt: Date
}

export interface AgentUnassignedEvent {
  conversationId: string
  agentId: string
  unassignedAt: Date
}

export interface EscalationEvent {
  conversationId: string
  fromAgent?: string
  toQueue: string
  reason: string
  escalatedAt: Date
}

export interface TransferEvent {
  conversationId: string
  fromAgent: string
  toAgent: string
  reason: string
  transferredAt: Date
}

export interface CSATSubmittedEvent {
  conversationId: string
  agentId?: string
  score: number
  maxScore?: number
  feedback?: string
  submittedAt: Date
}

// =============================================================================
// Types - Internal Tracking
// =============================================================================

interface ConversationTrackingState {
  conversationId: string
  channel: ChannelType
  priority: Priority
  status: ConversationStatus
  createdAt: Date
  firstResponseAt?: Date
  firstResponderId?: string
  closedAt?: Date
  closeReason?: string
  reopenedAt?: Date
  agentAssignments: AgentAssignment[]
  escalations: EscalationRecord[]
  transfers: TransferRecord[]
  csatScores: CSATScore[]
}

interface AgentAssignment {
  agentId: string
  assignedAt: Date
  unassignedAt?: Date
  messageCount: number
}

interface EscalationRecord {
  fromAgent?: string
  toQueue: string
  reason: string
  escalatedAt: Date
}

interface TransferRecord {
  fromAgent: string
  toAgent: string
  reason: string
  transferredAt: Date
}

// =============================================================================
// Types - Analytics Interface
// =============================================================================

export interface ConversationAnalytics {
  // Configure SLA targets
  addSLATarget(target: SLATarget): void
  removeSLATarget(targetId: string): void
  getSLATargets(): SLATarget[]

  // Record events
  recordConversationCreated(event: ConversationCreatedEvent): void
  recordFirstResponse(event: FirstResponseEvent): void
  recordConversationClosed(event: ConversationClosedEvent): void
  recordConversationReopened(event: ConversationReopenedEvent): void
  recordAgentAssigned(event: AgentAssignedEvent): void
  recordAgentUnassigned(event: AgentUnassignedEvent): void
  recordEscalation(event: EscalationEvent): void
  recordTransfer(event: TransferEvent): void
  recordCSAT(event: CSATSubmittedEvent): void
  recordAgentMessage(conversationId: string, agentId: string): void

  // Query metrics
  getMetrics(query?: MetricsQuery): ConversationMetrics
  getAgentMetrics(agentId: string, query?: MetricsQuery): AgentPerformanceMetrics
  getVolumeByTime(query?: MetricsQuery): VolumeMetric[]
  getVolumeByChannel(query?: MetricsQuery): ChannelVolume[]
  getTimeDistribution(query?: MetricsQuery): TimeDistribution[]
  getSLACompliance(query?: MetricsQuery): SLACompliance[]
  getCSATTrend(query?: MetricsQuery): Array<{ period: Date; csat: CSATAggregation }>

  // Real-time metrics
  getActiveConversationsCount(): number
  getAverageWaitTime(): number
  getQueueDepth(channel?: ChannelType): number

  // Conversation state
  getConversationState(conversationId: string): ConversationTrackingState | undefined

  // Clear data (for testing)
  clear(): void
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0

  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.ceil((percentile / 100) * sorted.length) - 1
  return sorted[Math.max(0, index)]!
}

function calculateMedian(values: number[]): number {
  return calculatePercentile(values, 50)
}

function calculateAverage(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function getPeriodStart(date: Date, periodType: 'hour' | 'day' | 'week' | 'month'): Date {
  const d = new Date(date)

  switch (periodType) {
    case 'hour':
      d.setMinutes(0, 0, 0)
      break
    case 'day':
      d.setHours(0, 0, 0, 0)
      break
    case 'week': {
      const day = d.getDay()
      d.setDate(d.getDate() - day)
      d.setHours(0, 0, 0, 0)
      break
    }
    case 'month':
      d.setDate(1)
      d.setHours(0, 0, 0, 0)
      break
  }

  return d
}

function isInDateRange(date: Date, from?: Date, to?: Date): boolean {
  if (from && date < from) return false
  if (to && date > to) return false
  return true
}

// =============================================================================
// Implementation
// =============================================================================

class ConversationAnalyticsImpl implements ConversationAnalytics {
  private conversations = new Map<string, ConversationTrackingState>()
  private slaTargets = new Map<string, SLATarget>()
  private slaResults: SLAResult[] = []
  private responseTimeMetrics: ResponseTimeMetric[] = []
  private resolutionTimeMetrics: ResolutionTimeMetric[] = []

  // ==========================================================================
  // SLA Target Management
  // ==========================================================================

  addSLATarget(target: SLATarget): void {
    if (!target.id) {
      target.id = generateId()
    }
    this.slaTargets.set(target.id, target)
  }

  removeSLATarget(targetId: string): void {
    this.slaTargets.delete(targetId)
  }

  getSLATargets(): SLATarget[] {
    return Array.from(this.slaTargets.values())
  }

  // ==========================================================================
  // Event Recording
  // ==========================================================================

  recordConversationCreated(event: ConversationCreatedEvent): void {
    const state: ConversationTrackingState = {
      conversationId: event.conversationId,
      channel: event.channel,
      priority: event.priority ?? 'normal',
      status: 'open',
      createdAt: event.createdAt,
      agentAssignments: [],
      escalations: [],
      transfers: [],
      csatScores: [],
    }

    this.conversations.set(event.conversationId, state)
  }

  recordFirstResponse(event: FirstResponseEvent): void {
    const state = this.conversations.get(event.conversationId)
    if (!state) return

    if (!state.firstResponseAt) {
      state.firstResponseAt = event.respondedAt
      state.firstResponderId = event.agentId

      const firstResponseTimeMs = event.respondedAt.getTime() - state.createdAt.getTime()

      // Record metric
      this.responseTimeMetrics.push({
        conversationId: event.conversationId,
        firstResponseTimeMs,
        agentId: event.agentId,
        channel: state.channel,
        priority: state.priority,
        timestamp: event.respondedAt,
      })

      // Evaluate SLA for first response
      this.evaluateSLA(state, 'first_response', firstResponseTimeMs, event.respondedAt)
    }
  }

  recordConversationClosed(event: ConversationClosedEvent): void {
    const state = this.conversations.get(event.conversationId)
    if (!state) return

    state.status = event.status
    state.closedAt = event.closedAt
    state.closeReason = event.closeReason

    // Close any open agent assignments
    for (const assignment of state.agentAssignments) {
      if (!assignment.unassignedAt) {
        assignment.unassignedAt = event.closedAt
      }
    }

    const resolutionTimeMs = event.closedAt.getTime() - state.createdAt.getTime()

    // Record metric
    this.resolutionTimeMetrics.push({
      conversationId: event.conversationId,
      resolutionTimeMs,
      channel: state.channel,
      priority: state.priority,
      status: event.status,
      closeReason: event.closeReason,
      createdAt: state.createdAt,
      closedAt: event.closedAt,
    })

    // Evaluate SLA for resolution
    this.evaluateSLA(state, 'resolution', resolutionTimeMs, event.closedAt)
  }

  recordConversationReopened(event: ConversationReopenedEvent): void {
    const state = this.conversations.get(event.conversationId)
    if (!state) return

    state.status = 'open'
    state.reopenedAt = event.reopenedAt
    state.closedAt = undefined
    state.closeReason = undefined
  }

  recordAgentAssigned(event: AgentAssignedEvent): void {
    const state = this.conversations.get(event.conversationId)
    if (!state) return

    state.agentAssignments.push({
      agentId: event.agentId,
      assignedAt: event.assignedAt,
      messageCount: 0,
    })
  }

  recordAgentUnassigned(event: AgentUnassignedEvent): void {
    const state = this.conversations.get(event.conversationId)
    if (!state) return

    const assignment = state.agentAssignments.find(
      a => a.agentId === event.agentId && !a.unassignedAt
    )
    if (assignment) {
      assignment.unassignedAt = event.unassignedAt
    }
  }

  recordAgentMessage(conversationId: string, agentId: string): void {
    const state = this.conversations.get(conversationId)
    if (!state) return

    const assignment = state.agentAssignments.find(
      a => a.agentId === agentId && !a.unassignedAt
    )
    if (assignment) {
      assignment.messageCount++
    }
  }

  recordEscalation(event: EscalationEvent): void {
    const state = this.conversations.get(event.conversationId)
    if (!state) return

    state.escalations.push({
      fromAgent: event.fromAgent,
      toQueue: event.toQueue,
      reason: event.reason,
      escalatedAt: event.escalatedAt,
    })
  }

  recordTransfer(event: TransferEvent): void {
    const state = this.conversations.get(event.conversationId)
    if (!state) return

    state.transfers.push({
      fromAgent: event.fromAgent,
      toAgent: event.toAgent,
      reason: event.reason,
      transferredAt: event.transferredAt,
    })

    // Close previous agent's assignment
    const prevAssignment = state.agentAssignments.find(
      a => a.agentId === event.fromAgent && !a.unassignedAt
    )
    if (prevAssignment) {
      prevAssignment.unassignedAt = event.transferredAt
    }

    // Create new assignment for receiving agent
    state.agentAssignments.push({
      agentId: event.toAgent,
      assignedAt: event.transferredAt,
      messageCount: 0,
    })
  }

  recordCSAT(event: CSATSubmittedEvent): void {
    const state = this.conversations.get(event.conversationId)
    if (!state) return

    state.csatScores.push({
      conversationId: event.conversationId,
      agentId: event.agentId,
      score: event.score,
      maxScore: event.maxScore ?? 5,
      feedback: event.feedback,
      submittedAt: event.submittedAt,
      channel: state.channel,
    })
  }

  // ==========================================================================
  // SLA Evaluation
  // ==========================================================================

  private evaluateSLA(
    state: ConversationTrackingState,
    type: SLAType,
    actualMs: number,
    timestamp: Date
  ): void {
    for (const target of this.slaTargets.values()) {
      if (target.type !== type) continue

      // Check if this SLA applies based on priority/channel filters
      if (target.priority && target.priority !== state.priority) continue
      if (target.channel && target.channel !== state.channel) continue

      const met = actualMs <= target.targetMs
      const breachMs = met ? undefined : actualMs - target.targetMs

      this.slaResults.push({
        conversationId: state.conversationId,
        slaTargetId: target.id,
        targetMs: target.targetMs,
        actualMs,
        met,
        breachMs,
        timestamp,
      })
    }
  }

  // ==========================================================================
  // Query Metrics
  // ==========================================================================

  getMetrics(query?: MetricsQuery): ConversationMetrics {
    const from = query?.from ?? new Date(0)
    const to = query?.to ?? new Date()

    // Filter conversations based on query
    const filteredStates = this.filterConversations(query)

    // Calculate first response times
    const frtValues = this.responseTimeMetrics
      .filter(m => isInDateRange(m.timestamp, from, to))
      .filter(m => !query?.channel || query.channel.includes(m.channel))
      .filter(m => !query?.priority || query.priority.includes(m.priority))
      .filter(m => !query?.agentId || m.agentId === query.agentId)
      .map(m => m.firstResponseTimeMs)

    // Calculate resolution times
    const rtValues = this.resolutionTimeMetrics
      .filter(m => isInDateRange(m.closedAt, from, to))
      .filter(m => !query?.channel || query.channel.includes(m.channel))
      .filter(m => !query?.priority || query.priority.includes(m.priority))
      .map(m => m.resolutionTimeMs)

    // Calculate agent handle times
    const handleTimes: number[] = []
    let totalAgentInteractions = 0

    for (const state of filteredStates) {
      for (const assignment of state.agentAssignments) {
        if (!query?.agentId || assignment.agentId === query.agentId) {
          const endTime = assignment.unassignedAt ?? state.closedAt ?? new Date()
          const handleTime = endTime.getTime() - assignment.assignedAt.getTime()
          handleTimes.push(handleTime)
          totalAgentInteractions++
        }
      }
    }

    // Calculate volume by channel
    const channelCounts = new Map<ChannelType, number>()
    for (const state of filteredStates) {
      const count = channelCounts.get(state.channel) ?? 0
      channelCounts.set(state.channel, count + 1)
    }

    const totalConversations = filteredStates.length
    const conversationsByChannel: ChannelVolume[] = []
    for (const [channel, count] of channelCounts) {
      conversationsByChannel.push({
        channel,
        total: count,
        percentage: totalConversations > 0 ? count / totalConversations : 0,
      })
    }

    // Calculate volume by priority
    const conversationsByPriority: Record<Priority, number> = {
      low: 0,
      normal: 0,
      high: 0,
      urgent: 0,
    }
    for (const state of filteredStates) {
      conversationsByPriority[state.priority]++
    }

    // Calculate CSAT
    const csatScores: CSATScore[] = []
    for (const state of filteredStates) {
      for (const csat of state.csatScores) {
        if (isInDateRange(csat.submittedAt, from, to)) {
          if (!query?.agentId || csat.agentId === query.agentId) {
            csatScores.push(csat)
          }
        }
      }
    }

    const csat = this.aggregateCSAT(csatScores)

    // Calculate SLA compliance
    const slaCompliance = this.calculateSLACompliance(query)

    return {
      averageFirstResponseTimeMs: calculateAverage(frtValues),
      medianFirstResponseTimeMs: calculateMedian(frtValues),
      p90FirstResponseTimeMs: calculatePercentile(frtValues, 90),
      p99FirstResponseTimeMs: calculatePercentile(frtValues, 99),

      averageResolutionTimeMs: calculateAverage(rtValues),
      medianResolutionTimeMs: calculateMedian(rtValues),
      p90ResolutionTimeMs: calculatePercentile(rtValues, 90),
      p99ResolutionTimeMs: calculatePercentile(rtValues, 99),

      averageHandleTimeMs: calculateAverage(handleTimes),
      totalAgentInteractions,

      totalConversations,
      conversationsByChannel,
      conversationsByPriority,

      csat,
      slaCompliance,

      periodStart: from,
      periodEnd: to,
    }
  }

  getAgentMetrics(agentId: string, query?: MetricsQuery): AgentPerformanceMetrics {
    const from = query?.from ?? new Date(0)
    const to = query?.to ?? new Date()

    const filteredStates = this.filterConversations(query)

    // Find conversations handled by this agent
    const agentConversations = filteredStates.filter(state =>
      state.agentAssignments.some(a => a.agentId === agentId)
    )

    // Calculate handle times
    const handleTimes: number[] = []
    for (const state of agentConversations) {
      for (const assignment of state.agentAssignments) {
        if (assignment.agentId === agentId) {
          const endTime = assignment.unassignedAt ?? state.closedAt ?? new Date()
          handleTimes.push(endTime.getTime() - assignment.assignedAt.getTime())
        }
      }
    }

    // Calculate response times for this agent
    const responseTimes = this.responseTimeMetrics
      .filter(m => m.agentId === agentId)
      .filter(m => isInDateRange(m.timestamp, from, to))
      .map(m => m.firstResponseTimeMs)

    // Calculate CSAT for this agent
    const agentCSATScores = agentConversations
      .flatMap(state => state.csatScores)
      .filter(csat => csat.agentId === agentId)
      .filter(csat => isInDateRange(csat.submittedAt, from, to))

    const csatValues = agentCSATScores.map(c => (c.score / c.maxScore) * 100)

    // Calculate SLA compliance for agent
    const agentConvIds = new Set(agentConversations.map(c => c.conversationId))
    const agentSLAResults = this.slaResults
      .filter(r => agentConvIds.has(r.conversationId))
      .filter(r => isInDateRange(r.timestamp, from, to))

    const slaComplianceRate =
      agentSLAResults.length > 0
        ? agentSLAResults.filter(r => r.met).length / agentSLAResults.length
        : 1

    // Calculate status breakdown
    const conversationsByStatus: Record<ConversationStatus, number> = {
      open: 0,
      closed: 0,
      pending: 0,
      resolved: 0,
    }
    for (const state of agentConversations) {
      conversationsByStatus[state.status]++
    }

    return {
      agentId,
      totalConversationsHandled: agentConversations.length,
      averageHandleTimeMs: calculateAverage(handleTimes),
      averageResponseTimeMs: calculateAverage(responseTimes),
      csatScore: calculateAverage(csatValues),
      csatResponses: agentCSATScores.length,
      slaComplianceRate,
      conversationsByStatus,
    }
  }

  getVolumeByTime(query?: MetricsQuery): VolumeMetric[] {
    const from = query?.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const to = query?.to ?? new Date()
    const periodType = query?.groupBy ?? 'day'

    const filteredStates = this.filterConversations(query)

    // Group by period
    const periodMap = new Map<string, VolumeMetric>()

    for (const state of filteredStates) {
      const periodStart = getPeriodStart(state.createdAt, periodType)
      const periodKey = periodStart.toISOString()

      if (!periodMap.has(periodKey)) {
        periodMap.set(periodKey, {
          period: periodStart,
          periodType,
          channel: state.channel,
          totalConversations: 0,
          newConversations: 0,
          closedConversations: 0,
          reopenedConversations: 0,
          escalatedConversations: 0,
          transferredConversations: 0,
        })
      }

      const metric = periodMap.get(periodKey)!
      metric.totalConversations++

      if (isInDateRange(state.createdAt, from, to)) {
        metric.newConversations++
      }

      if (state.closedAt && isInDateRange(state.closedAt, from, to)) {
        metric.closedConversations++
      }

      if (state.reopenedAt && isInDateRange(state.reopenedAt, from, to)) {
        metric.reopenedConversations++
      }

      if (
        state.escalations.length > 0 &&
        state.escalations.some(e => isInDateRange(e.escalatedAt, from, to))
      ) {
        metric.escalatedConversations++
      }

      if (
        state.transfers.length > 0 &&
        state.transfers.some(t => isInDateRange(t.transferredAt, from, to))
      ) {
        metric.transferredConversations++
      }
    }

    return Array.from(periodMap.values()).sort(
      (a, b) => a.period.getTime() - b.period.getTime()
    )
  }

  getVolumeByChannel(query?: MetricsQuery): ChannelVolume[] {
    const filteredStates = this.filterConversations(query)

    const channelCounts = new Map<ChannelType, number>()
    for (const state of filteredStates) {
      const count = channelCounts.get(state.channel) ?? 0
      channelCounts.set(state.channel, count + 1)
    }

    const total = filteredStates.length
    const result: ChannelVolume[] = []

    for (const [channel, count] of channelCounts) {
      result.push({
        channel,
        total: count,
        percentage: total > 0 ? count / total : 0,
      })
    }

    return result.sort((a, b) => b.total - a.total)
  }

  getTimeDistribution(query?: MetricsQuery): TimeDistribution[] {
    const from = query?.from ?? new Date(0)
    const to = query?.to ?? new Date()

    const hourBuckets: Array<{ counts: number[]; responseTimes: number[] }> = []
    for (let i = 0; i < 24; i++) {
      hourBuckets.push({ counts: [], responseTimes: [] })
    }

    const filteredStates = this.filterConversations(query)

    for (const state of filteredStates) {
      if (!isInDateRange(state.createdAt, from, to)) continue

      const hour = state.createdAt.getHours()
      hourBuckets[hour]!.counts.push(1)

      if (state.firstResponseAt) {
        const responseTime = state.firstResponseAt.getTime() - state.createdAt.getTime()
        hourBuckets[hour]!.responseTimes.push(responseTime)
      }
    }

    return hourBuckets.map((bucket, hour) => ({
      hour,
      count: bucket.counts.length,
      averageResponseTimeMs: calculateAverage(bucket.responseTimes),
    }))
  }

  getSLACompliance(query?: MetricsQuery): SLACompliance[] {
    return this.calculateSLACompliance(query)
  }

  getCSATTrend(query?: MetricsQuery): Array<{ period: Date; csat: CSATAggregation }> {
    const from = query?.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const to = query?.to ?? new Date()
    const periodType = query?.groupBy ?? 'day'

    const filteredStates = this.filterConversations(query)

    // Collect all CSAT scores
    const allScores: Array<CSATScore & { period: Date }> = []

    for (const state of filteredStates) {
      for (const csat of state.csatScores) {
        if (!isInDateRange(csat.submittedAt, from, to)) continue
        if (query?.agentId && csat.agentId !== query.agentId) continue

        allScores.push({
          ...csat,
          period: getPeriodStart(csat.submittedAt, periodType),
        })
      }
    }

    // Group by period
    const periodMap = new Map<string, CSATScore[]>()
    for (const score of allScores) {
      const key = score.period.toISOString()
      if (!periodMap.has(key)) {
        periodMap.set(key, [])
      }
      periodMap.get(key)!.push(score)
    }

    // Calculate aggregations
    const result: Array<{ period: Date; csat: CSATAggregation }> = []
    for (const [key, scores] of periodMap) {
      result.push({
        period: new Date(key),
        csat: this.aggregateCSAT(scores),
      })
    }

    return result.sort((a, b) => a.period.getTime() - b.period.getTime())
  }

  // ==========================================================================
  // Real-time Metrics
  // ==========================================================================

  getActiveConversationsCount(): number {
    let count = 0
    for (const state of this.conversations.values()) {
      if (state.status === 'open' || state.status === 'pending') {
        count++
      }
    }
    return count
  }

  getAverageWaitTime(): number {
    const now = new Date()
    const waitTimes: number[] = []

    for (const state of this.conversations.values()) {
      if (state.status === 'open' && !state.firstResponseAt) {
        waitTimes.push(now.getTime() - state.createdAt.getTime())
      }
    }

    return calculateAverage(waitTimes)
  }

  getQueueDepth(channel?: ChannelType): number {
    let count = 0
    for (const state of this.conversations.values()) {
      if (state.status === 'open' && !state.firstResponseAt) {
        if (!channel || state.channel === channel) {
          count++
        }
      }
    }
    return count
  }

  getConversationState(conversationId: string): ConversationTrackingState | undefined {
    return this.conversations.get(conversationId)
  }

  clear(): void {
    this.conversations.clear()
    this.slaTargets.clear()
    this.slaResults = []
    this.responseTimeMetrics = []
    this.resolutionTimeMetrics = []
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private filterConversations(query?: MetricsQuery): ConversationTrackingState[] {
    const from = query?.from ?? new Date(0)
    const to = query?.to ?? new Date()

    return Array.from(this.conversations.values()).filter(state => {
      if (!isInDateRange(state.createdAt, from, to)) return false
      if (query?.channel && !query.channel.includes(state.channel)) return false
      if (query?.priority && !query.priority.includes(state.priority)) return false
      if (query?.agentId) {
        const hasAgent = state.agentAssignments.some(a => a.agentId === query.agentId)
        if (!hasAgent) return false
      }
      return true
    })
  }

  private aggregateCSAT(scores: CSATScore[]): CSATAggregation {
    if (scores.length === 0) {
      return {
        averageScore: 0,
        totalResponses: 0,
        distribution: {},
      }
    }

    const distribution: Record<number, number> = {}
    let sum = 0

    for (const score of scores) {
      // Normalize to percentage (0-100)
      const normalized = (score.score / score.maxScore) * 100
      sum += normalized

      distribution[score.score] = (distribution[score.score] ?? 0) + 1
    }

    return {
      averageScore: sum / scores.length,
      totalResponses: scores.length,
      distribution,
    }
  }

  private calculateSLACompliance(query?: MetricsQuery): SLACompliance[] {
    const from = query?.from ?? new Date(0)
    const to = query?.to ?? new Date()

    // Group results by SLA target
    const targetResults = new Map<string, SLAResult[]>()

    for (const result of this.slaResults) {
      if (!isInDateRange(result.timestamp, from, to)) continue

      // Check if conversation matches query filters
      const state = this.conversations.get(result.conversationId)
      if (!state) continue
      if (query?.channel && !query.channel.includes(state.channel)) continue
      if (query?.priority && !query.priority.includes(state.priority)) continue
      if (query?.agentId) {
        const hasAgent = state.agentAssignments.some(a => a.agentId === query.agentId)
        if (!hasAgent) continue
      }

      if (!targetResults.has(result.slaTargetId)) {
        targetResults.set(result.slaTargetId, [])
      }
      targetResults.get(result.slaTargetId)!.push(result)
    }

    const compliance: SLACompliance[] = []

    for (const [targetId, results] of targetResults) {
      const target = this.slaTargets.get(targetId)
      if (!target) continue

      const totalMet = results.filter(r => r.met).length
      const actualTimes = results.map(r => r.actualMs)

      compliance.push({
        slaTargetId: targetId,
        slaName: target.name,
        totalEvaluated: results.length,
        totalMet,
        totalBreached: results.length - totalMet,
        complianceRate: results.length > 0 ? totalMet / results.length : 1,
        averageActualMs: calculateAverage(actualTimes),
        p50Ms: calculateMedian(actualTimes),
        p90Ms: calculatePercentile(actualTimes, 90),
        p99Ms: calculatePercentile(actualTimes, 99),
      })
    }

    return compliance
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createConversationAnalytics(): ConversationAnalytics {
  return new ConversationAnalyticsImpl()
}

// =============================================================================
// Export the implementation class for testing
// =============================================================================

export { ConversationAnalyticsImpl }
