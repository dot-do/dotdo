/**
 * Conversation Analytics - Event-based metrics tracking
 *
 * Provides comprehensive conversation analytics through an event-driven API:
 * - First Response Time: Time from customer message to first agent/AI response
 * - Resolution Time: Total time from conversation open to close
 * - CSAT Scoring: Customer satisfaction tracking (1-5 scale)
 * - Handoff Frequency: Tracking transfers between agents/AI
 * - Agent Performance: Per-agent metrics (response time, resolutions, CSAT)
 *
 * @example
 * ```typescript
 * import { createConversationAnalytics } from 'db/primitives/conversation/analytics'
 *
 * const analytics = createConversationAnalytics()
 *
 * // Record events
 * await analytics.recordEvent({
 *   type: 'conversation_open',
 *   conversationId: 'conv_123',
 *   timestamp: new Date(),
 *   metadata: { channel: 'chat' },
 * })
 *
 * await analytics.recordEvent({
 *   type: 'message',
 *   conversationId: 'conv_123',
 *   participantId: 'customer_1',
 *   participantRole: 'customer',
 *   timestamp: new Date(),
 * })
 *
 * // Get metrics
 * const frt = await analytics.getFirstResponseMetrics('conv_123')
 * const summary = await analytics.getMetricsSummary({ start: new Date(), end: new Date() })
 * ```
 *
 * @module db/primitives/conversation/analytics
 */

// =============================================================================
// Types - Events
// =============================================================================

export type ConversationEventType =
  | 'conversation_open'
  | 'conversation_close'
  | 'message'
  | 'handoff'
  | 'csat_submitted'

export type ParticipantRole = 'customer' | 'agent' | 'ai' | 'system'

export interface ConversationEvent {
  type: ConversationEventType
  conversationId: string
  timestamp: Date
  // Message-specific
  participantId?: string
  participantRole?: ParticipantRole
  messageId?: string
  // Handoff-specific
  fromParticipantId?: string
  toParticipantId?: string
  handoffType?: 'transfer' | 'escalation'
  // CSAT-specific
  rating?: number
  comment?: string
  // Metadata
  metadata?: Record<string, unknown>
}

// =============================================================================
// Types - Time Range
// =============================================================================

export interface TimeRange {
  start: Date
  end: Date
}

// =============================================================================
// Types - First Response Metrics
// =============================================================================

export interface FirstResponseMetrics {
  conversationId: string
  firstResponseTimeMs: number
  responderId: string
  responderRole: ParticipantRole
}

export interface AggregatedFirstResponseMetrics {
  count: number
  averageMs: number
  medianMs: number
  p90Ms: number
  p95Ms: number
}

// =============================================================================
// Types - Resolution Metrics
// =============================================================================

export interface ResolutionMetrics {
  conversationId: string
  resolutionTimeMs: number
  resolution: string
  messageCount: number
  participantCount: number
}

export interface AggregatedResolutionMetrics {
  count: number
  resolvedCount: number
  abandonedCount: number
  averageMs: number
  medianMs: number
  p90Ms: number
  p95Ms: number
  resolutionRate: number
}

// =============================================================================
// Types - CSAT Metrics
// =============================================================================

export interface CSATRating {
  conversationId: string
  rating: number
  comment?: string
  agentId?: string
  timestamp: Date
}

export interface CSATMetrics {
  responseCount: number
  averageRating: number
  ratingDistribution: Record<number, number>
  csatScore: number // Percentage of 4+ ratings
}

export interface AggregatedCSATMetrics extends CSATMetrics {}

// =============================================================================
// Types - Handoff Metrics
// =============================================================================

export interface HandoffEvent {
  conversationId: string
  fromParticipantId: string
  toParticipantId: string
  handoffType: 'transfer' | 'escalation'
  timestamp: Date
}

export interface HandoffMetrics {
  conversationId: string
  handoffCount: number
  escalationCount: number
  transferCount: number
  handoffs: HandoffEvent[]
}

export interface AggregatedHandoffMetrics {
  totalConversations: number
  conversationsWithHandoffs: number
  totalHandoffs: number
  totalEscalations: number
  totalTransfers: number
  handoffRate: number
  averageHandoffsPerConversation: number
}

// =============================================================================
// Types - Agent Performance Metrics
// =============================================================================

export interface AgentPerformanceMetrics {
  agentId: string
  conversationsHandled: number
  averageFirstResponseTimeMs: number | null
  resolutionsCount: number
  resolutionRate: number
  csatCount: number
  averageCSAT: number | null
  csatScore: number | null
  handoffsInitiated: number
  handoffRate: number
}

// =============================================================================
// Types - Aggregated Metrics
// =============================================================================

export interface AggregatedMetrics {
  totalConversations: number
  firstResponse: AggregatedFirstResponseMetrics
  resolution: AggregatedResolutionMetrics
  csat: AggregatedCSATMetrics
  handoffs: AggregatedHandoffMetrics
}

export interface MetricsFilter {
  channel?: string
  agentId?: string
}

// =============================================================================
// Types - Leaderboard
// =============================================================================

export interface AgentLeaderboardEntry {
  agentId: string
  conversationsHandled: number
  averageFirstResponseTimeMs: number | null
  averageCSAT: number | null
  csatScore: number | null
  resolutionRate: number
}

// =============================================================================
// Types - Export/Import
// =============================================================================

export interface ExportedMetrics {
  conversations: Array<{
    id: string
    openedAt: string
    closedAt?: string
    channel?: string
  }>
  firstResponseMetrics: Array<{
    conversationId: string
    firstResponseTimeMs: number
    responderId: string
    responderRole: string
  }>
  resolutionMetrics: Array<{
    conversationId: string
    resolutionTimeMs: number
    resolution: string
  }>
}

// =============================================================================
// Types - Alert
// =============================================================================

export interface AlertThreshold {
  metric: string
  threshold: number
}

export interface Alert {
  metric: string
  value: number
  threshold: number
}

// =============================================================================
// Types - ConversationAnalytics Interface
// =============================================================================

export type EventCallback = (event: ConversationEvent) => void
export type AlertCallback = (alert: Alert) => void

export interface ConversationAnalytics {
  // Event recording
  recordEvent(event: ConversationEvent): Promise<void>

  // First response metrics
  getFirstResponseMetrics(conversationId: string): Promise<FirstResponseMetrics | null>
  getAggregatedFirstResponseMetrics(timeRange: TimeRange): Promise<AggregatedFirstResponseMetrics>

  // Resolution metrics
  getResolutionMetrics(conversationId: string): Promise<ResolutionMetrics | null>
  getAggregatedResolutionMetrics(timeRange: TimeRange): Promise<AggregatedResolutionMetrics>

  // CSAT metrics
  getCSATForConversation(conversationId: string): Promise<CSATRating | null>
  getAggregatedCSATMetrics(timeRange: TimeRange): Promise<AggregatedCSATMetrics>

  // Handoff metrics
  getHandoffMetrics(conversationId: string): Promise<HandoffMetrics>
  getAggregatedHandoffMetrics(timeRange: TimeRange): Promise<AggregatedHandoffMetrics>

  // Agent performance
  getAgentPerformanceMetrics(agentId: string, timeRange: TimeRange): Promise<AgentPerformanceMetrics>
  getAgentLeaderboard(timeRange: TimeRange): Promise<AgentLeaderboardEntry[]>

  // Aggregated metrics
  getMetricsSummary(timeRange: TimeRange, filter?: MetricsFilter): Promise<AggregatedMetrics>

  // Event listeners
  on(event: 'event', callback: EventCallback): void
  on(event: 'alert', callback: AlertCallback): void
  off(event: 'event', callback: EventCallback): void
  off(event: 'alert', callback: AlertCallback): void

  // Alert thresholds
  setAlertThreshold(metric: string, threshold: number): void

  // Data export/import
  exportMetrics(timeRange: TimeRange): Promise<ExportedMetrics>
  importMetrics(data: ExportedMetrics): Promise<void>
}

// =============================================================================
// Internal Types
// =============================================================================

interface ConversationState {
  id: string
  openedAt: Date
  closedAt?: Date
  resolution?: string
  channel?: string
  participants: Set<string>
  messages: Array<{
    participantId: string
    participantRole: ParticipantRole
    timestamp: Date
  }>
  firstCustomerMessageAt?: Date
  firstResponseAt?: Date
  firstResponderId?: string
  firstResponderRole?: ParticipantRole
  handoffs: HandoffEvent[]
  csat?: CSATRating
  lastAgentId?: string
}

// =============================================================================
// Helper Functions
// =============================================================================

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0

  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.ceil((percentile / 100) * sorted.length) - 1
  return sorted[Math.max(0, index)]!
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0

  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)

  if (sorted.length % 2 === 0) {
    // Even number of elements: average the two middle values
    return (sorted[mid - 1]! + sorted[mid]!) / 2
  } else {
    // Odd number of elements: return the middle value
    return sorted[mid]!
  }
}

function calculateAverage(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function isInTimeRange(date: Date, range: TimeRange): boolean {
  return date >= range.start && date <= range.end
}

// =============================================================================
// Implementation
// =============================================================================

class ConversationAnalyticsImpl implements ConversationAnalytics {
  private conversations = new Map<string, ConversationState>()
  private eventListeners: EventCallback[] = []
  private alertListeners: AlertCallback[] = []
  private alertThresholds = new Map<string, number>()

  // ===========================================================================
  // Event Recording
  // ===========================================================================

  async recordEvent(event: ConversationEvent): Promise<void> {
    // Validate CSAT rating
    if (event.type === 'csat_submitted' && event.rating !== undefined) {
      if (event.rating < 1 || event.rating > 5) {
        throw new Error('CSAT rating must be between 1 and 5')
      }
    }

    // Emit event to listeners
    for (const listener of this.eventListeners) {
      listener(event)
    }

    // Process event based on type
    switch (event.type) {
      case 'conversation_open':
        this.handleConversationOpen(event)
        break
      case 'conversation_close':
        this.handleConversationClose(event)
        break
      case 'message':
        this.handleMessage(event)
        break
      case 'handoff':
        this.handleHandoff(event)
        break
      case 'csat_submitted':
        this.handleCSAT(event)
        break
    }
  }

  private handleConversationOpen(event: ConversationEvent): void {
    const state: ConversationState = {
      id: event.conversationId,
      openedAt: event.timestamp,
      channel: event.metadata?.channel as string | undefined,
      participants: new Set(),
      messages: [],
      handoffs: [],
    }
    this.conversations.set(event.conversationId, state)
  }

  private handleConversationClose(event: ConversationEvent): void {
    const state = this.conversations.get(event.conversationId)
    if (!state) return

    state.closedAt = event.timestamp
    state.resolution = event.metadata?.resolution as string | undefined
  }

  private handleMessage(event: ConversationEvent): void {
    const state = this.conversations.get(event.conversationId)
    if (!state) return

    const participantId = event.participantId!
    const participantRole = event.participantRole!

    // Add to participants
    state.participants.add(participantId)

    // Record message
    state.messages.push({
      participantId,
      participantRole,
      timestamp: event.timestamp,
    })

    // Track first customer message
    if (participantRole === 'customer' && !state.firstCustomerMessageAt) {
      state.firstCustomerMessageAt = event.timestamp
    }

    // Track first response (non-customer, non-system)
    if (
      !state.firstResponseAt &&
      state.firstCustomerMessageAt &&
      participantRole !== 'customer' &&
      participantRole !== 'system'
    ) {
      state.firstResponseAt = event.timestamp
      state.firstResponderId = participantId
      state.firstResponderRole = participantRole

      // Calculate FRT and check threshold
      const frtMs = event.timestamp.getTime() - state.firstCustomerMessageAt.getTime()
      this.checkThreshold('firstResponseTime', frtMs)
    }

    // Track last agent for CSAT attribution
    if (participantRole === 'agent') {
      state.lastAgentId = participantId
    }
  }

  private handleHandoff(event: ConversationEvent): void {
    const state = this.conversations.get(event.conversationId)
    if (!state) return

    const handoff: HandoffEvent = {
      conversationId: event.conversationId,
      fromParticipantId: event.fromParticipantId!,
      toParticipantId: event.toParticipantId!,
      handoffType: event.handoffType!,
      timestamp: event.timestamp,
    }
    state.handoffs.push(handoff)
  }

  private handleCSAT(event: ConversationEvent): void {
    const state = this.conversations.get(event.conversationId)
    if (!state) return

    state.csat = {
      conversationId: event.conversationId,
      rating: event.rating!,
      comment: event.comment,
      agentId: state.lastAgentId,
      timestamp: event.timestamp,
    }
  }

  private checkThreshold(metric: string, value: number): void {
    const threshold = this.alertThresholds.get(metric)
    if (threshold !== undefined && value > threshold) {
      const alert: Alert = { metric, value, threshold }
      for (const listener of this.alertListeners) {
        listener(alert)
      }
    }
  }

  // ===========================================================================
  // First Response Metrics
  // ===========================================================================

  async getFirstResponseMetrics(conversationId: string): Promise<FirstResponseMetrics | null> {
    const state = this.conversations.get(conversationId)
    if (!state || !state.firstResponseAt || !state.firstCustomerMessageAt) {
      return null
    }

    return {
      conversationId,
      firstResponseTimeMs: state.firstResponseAt.getTime() - state.firstCustomerMessageAt.getTime(),
      responderId: state.firstResponderId!,
      responderRole: state.firstResponderRole!,
    }
  }

  async getAggregatedFirstResponseMetrics(
    timeRange: TimeRange
  ): Promise<AggregatedFirstResponseMetrics> {
    const frtValues: number[] = []

    for (const state of this.conversations.values()) {
      if (
        isInTimeRange(state.openedAt, timeRange) &&
        state.firstResponseAt &&
        state.firstCustomerMessageAt
      ) {
        frtValues.push(
          state.firstResponseAt.getTime() - state.firstCustomerMessageAt.getTime()
        )
      }
    }

    return {
      count: frtValues.length,
      averageMs: calculateAverage(frtValues),
      medianMs: calculateMedian(frtValues),
      p90Ms: calculatePercentile(frtValues, 90),
      p95Ms: calculatePercentile(frtValues, 95),
    }
  }

  // ===========================================================================
  // Resolution Metrics
  // ===========================================================================

  async getResolutionMetrics(conversationId: string): Promise<ResolutionMetrics | null> {
    const state = this.conversations.get(conversationId)
    if (!state || !state.closedAt) {
      return null
    }

    return {
      conversationId,
      resolutionTimeMs: state.closedAt.getTime() - state.openedAt.getTime(),
      resolution: state.resolution ?? 'unknown',
      messageCount: state.messages.length,
      participantCount: state.participants.size,
    }
  }

  async getAggregatedResolutionMetrics(
    timeRange: TimeRange
  ): Promise<AggregatedResolutionMetrics> {
    const resolutionTimes: number[] = []
    let resolvedCount = 0
    let abandonedCount = 0

    for (const state of this.conversations.values()) {
      if (isInTimeRange(state.openedAt, timeRange) && state.closedAt) {
        resolutionTimes.push(state.closedAt.getTime() - state.openedAt.getTime())
        if (state.resolution === 'resolved') {
          resolvedCount++
        } else if (state.resolution === 'abandoned') {
          abandonedCount++
        }
      }
    }

    const count = resolutionTimes.length

    return {
      count,
      resolvedCount,
      abandonedCount,
      averageMs: calculateAverage(resolutionTimes),
      medianMs: calculateMedian(resolutionTimes),
      p90Ms: calculatePercentile(resolutionTimes, 90),
      p95Ms: calculatePercentile(resolutionTimes, 95),
      resolutionRate: count > 0 ? resolvedCount / count : 0,
    }
  }

  // ===========================================================================
  // CSAT Metrics
  // ===========================================================================

  async getCSATForConversation(conversationId: string): Promise<CSATRating | null> {
    const state = this.conversations.get(conversationId)
    return state?.csat ?? null
  }

  async getAggregatedCSATMetrics(timeRange: TimeRange): Promise<AggregatedCSATMetrics> {
    const ratings: number[] = []
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }

    for (const state of this.conversations.values()) {
      if (isInTimeRange(state.openedAt, timeRange) && state.csat) {
        ratings.push(state.csat.rating)
        distribution[state.csat.rating] = (distribution[state.csat.rating] ?? 0) + 1
      }
    }

    const satisfiedCount = ratings.filter((r) => r >= 4).length

    return {
      responseCount: ratings.length,
      averageRating: ratings.length > 0 ? calculateAverage(ratings) : 0,
      ratingDistribution: distribution,
      csatScore: ratings.length > 0 ? satisfiedCount / ratings.length : 0,
    }
  }

  // ===========================================================================
  // Handoff Metrics
  // ===========================================================================

  async getHandoffMetrics(conversationId: string): Promise<HandoffMetrics> {
    const state = this.conversations.get(conversationId)
    if (!state) {
      return {
        conversationId,
        handoffCount: 0,
        escalationCount: 0,
        transferCount: 0,
        handoffs: [],
      }
    }

    const escalationCount = state.handoffs.filter((h) => h.handoffType === 'escalation').length
    const transferCount = state.handoffs.filter((h) => h.handoffType === 'transfer').length

    return {
      conversationId,
      handoffCount: state.handoffs.length,
      escalationCount,
      transferCount,
      handoffs: [...state.handoffs],
    }
  }

  async getAggregatedHandoffMetrics(timeRange: TimeRange): Promise<AggregatedHandoffMetrics> {
    let totalConversations = 0
    let conversationsWithHandoffs = 0
    let totalHandoffs = 0
    let totalEscalations = 0
    let totalTransfers = 0

    for (const state of this.conversations.values()) {
      if (isInTimeRange(state.openedAt, timeRange)) {
        totalConversations++
        if (state.handoffs.length > 0) {
          conversationsWithHandoffs++
        }
        totalHandoffs += state.handoffs.length
        totalEscalations += state.handoffs.filter((h) => h.handoffType === 'escalation').length
        totalTransfers += state.handoffs.filter((h) => h.handoffType === 'transfer').length
      }
    }

    return {
      totalConversations,
      conversationsWithHandoffs,
      totalHandoffs,
      totalEscalations,
      totalTransfers,
      handoffRate: totalConversations > 0 ? conversationsWithHandoffs / totalConversations : 0,
      averageHandoffsPerConversation: totalConversations > 0 ? totalHandoffs / totalConversations : 0,
    }
  }

  // ===========================================================================
  // Agent Performance Metrics
  // ===========================================================================

  async getAgentPerformanceMetrics(
    agentId: string,
    timeRange: TimeRange
  ): Promise<AgentPerformanceMetrics> {
    const frtValues: number[] = []
    let conversationsHandled = 0
    let resolutionsCount = 0
    let totalClosedConversations = 0
    const csatRatings: number[] = []
    let handoffsInitiated = 0

    for (const state of this.conversations.values()) {
      if (!isInTimeRange(state.openedAt, timeRange)) continue

      // Check if agent participated
      const agentMessages = state.messages.filter(
        (m) => m.participantId === agentId && m.participantRole === 'agent'
      )
      if (agentMessages.length === 0) continue

      conversationsHandled++

      // First response time for this agent
      if (state.firstResponderId === agentId && state.firstCustomerMessageAt) {
        frtValues.push(
          state.firstResponseAt!.getTime() - state.firstCustomerMessageAt.getTime()
        )
      }

      // Resolution tracking
      if (state.closedAt) {
        totalClosedConversations++
        if (state.resolution === 'resolved') {
          resolutionsCount++
        }
      }

      // CSAT for this agent
      if (state.csat && state.lastAgentId === agentId) {
        csatRatings.push(state.csat.rating)
      }

      // Handoffs initiated by this agent
      handoffsInitiated += state.handoffs.filter(
        (h) => h.fromParticipantId === agentId
      ).length
    }

    const satisfiedCount = csatRatings.filter((r) => r >= 4).length

    return {
      agentId,
      conversationsHandled,
      averageFirstResponseTimeMs: frtValues.length > 0 ? calculateAverage(frtValues) : null,
      resolutionsCount,
      resolutionRate: totalClosedConversations > 0 ? resolutionsCount / totalClosedConversations : 0,
      csatCount: csatRatings.length,
      averageCSAT: csatRatings.length > 0 ? calculateAverage(csatRatings) : null,
      csatScore: csatRatings.length > 0 ? satisfiedCount / csatRatings.length : null,
      handoffsInitiated,
      handoffRate: conversationsHandled > 0 ? handoffsInitiated / conversationsHandled : 0,
    }
  }

  async getAgentLeaderboard(timeRange: TimeRange): Promise<AgentLeaderboardEntry[]> {
    // Collect all agents
    const agentIds = new Set<string>()
    for (const state of this.conversations.values()) {
      if (!isInTimeRange(state.openedAt, timeRange)) continue
      for (const msg of state.messages) {
        if (msg.participantRole === 'agent') {
          agentIds.add(msg.participantId)
        }
      }
    }

    // Get metrics for each agent
    const entries: AgentLeaderboardEntry[] = []
    for (const agentId of agentIds) {
      const metrics = await this.getAgentPerformanceMetrics(agentId, timeRange)
      entries.push({
        agentId,
        conversationsHandled: metrics.conversationsHandled,
        averageFirstResponseTimeMs: metrics.averageFirstResponseTimeMs,
        averageCSAT: metrics.averageCSAT,
        csatScore: metrics.csatScore,
        resolutionRate: metrics.resolutionRate,
      })
    }

    // Sort by conversations handled (descending)
    entries.sort((a, b) => b.conversationsHandled - a.conversationsHandled)

    return entries
  }

  // ===========================================================================
  // Aggregated Metrics
  // ===========================================================================

  async getMetricsSummary(
    timeRange: TimeRange,
    filter?: MetricsFilter
  ): Promise<AggregatedMetrics> {
    // Apply filter to conversations
    const filteredConversations: ConversationState[] = []
    for (const state of this.conversations.values()) {
      if (!isInTimeRange(state.openedAt, timeRange)) continue
      if (filter?.channel && state.channel !== filter.channel) continue
      if (filter?.agentId) {
        const hasAgent = state.messages.some(
          (m) => m.participantId === filter.agentId && m.participantRole === 'agent'
        )
        if (!hasAgent) continue
      }
      filteredConversations.push(state)
    }

    // Calculate metrics from filtered conversations
    const frtValues: number[] = []
    const resolutionTimes: number[] = []
    let resolvedCount = 0
    let abandonedCount = 0
    const csatRatings: number[] = []
    const csatDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    let conversationsWithHandoffs = 0
    let totalHandoffs = 0
    let totalEscalations = 0
    let totalTransfers = 0

    for (const state of filteredConversations) {
      // FRT
      if (state.firstResponseAt && state.firstCustomerMessageAt) {
        frtValues.push(
          state.firstResponseAt.getTime() - state.firstCustomerMessageAt.getTime()
        )
      }

      // Resolution
      if (state.closedAt) {
        resolutionTimes.push(state.closedAt.getTime() - state.openedAt.getTime())
        if (state.resolution === 'resolved') resolvedCount++
        if (state.resolution === 'abandoned') abandonedCount++
      }

      // CSAT
      if (state.csat) {
        csatRatings.push(state.csat.rating)
        csatDistribution[state.csat.rating] = (csatDistribution[state.csat.rating] ?? 0) + 1
      }

      // Handoffs
      if (state.handoffs.length > 0) {
        conversationsWithHandoffs++
      }
      totalHandoffs += state.handoffs.length
      totalEscalations += state.handoffs.filter((h) => h.handoffType === 'escalation').length
      totalTransfers += state.handoffs.filter((h) => h.handoffType === 'transfer').length
    }

    const totalConversations = filteredConversations.length
    const resolutionCount = resolutionTimes.length
    const satisfiedCount = csatRatings.filter((r) => r >= 4).length

    return {
      totalConversations,
      firstResponse: {
        count: frtValues.length,
        averageMs: calculateAverage(frtValues),
        medianMs: calculateMedian(frtValues),
        p90Ms: calculatePercentile(frtValues, 90),
        p95Ms: calculatePercentile(frtValues, 95),
      },
      resolution: {
        count: resolutionCount,
        resolvedCount,
        abandonedCount,
        averageMs: calculateAverage(resolutionTimes),
        medianMs: calculateMedian(resolutionTimes),
        p90Ms: calculatePercentile(resolutionTimes, 90),
        p95Ms: calculatePercentile(resolutionTimes, 95),
        resolutionRate: resolutionCount > 0 ? resolvedCount / resolutionCount : 0,
      },
      csat: {
        responseCount: csatRatings.length,
        averageRating: csatRatings.length > 0 ? calculateAverage(csatRatings) : 0,
        ratingDistribution: csatDistribution,
        csatScore: csatRatings.length > 0 ? satisfiedCount / csatRatings.length : 0,
      },
      handoffs: {
        totalConversations,
        conversationsWithHandoffs,
        totalHandoffs,
        totalEscalations,
        totalTransfers,
        handoffRate: totalConversations > 0 ? conversationsWithHandoffs / totalConversations : 0,
        averageHandoffsPerConversation:
          totalConversations > 0 ? totalHandoffs / totalConversations : 0,
      },
    }
  }

  // ===========================================================================
  // Event Listeners
  // ===========================================================================

  on(event: 'event', callback: EventCallback): void
  on(event: 'alert', callback: AlertCallback): void
  on(event: 'event' | 'alert', callback: EventCallback | AlertCallback): void {
    if (event === 'event') {
      this.eventListeners.push(callback as EventCallback)
    } else {
      this.alertListeners.push(callback as AlertCallback)
    }
  }

  off(event: 'event', callback: EventCallback): void
  off(event: 'alert', callback: AlertCallback): void
  off(event: 'event' | 'alert', callback: EventCallback | AlertCallback): void {
    if (event === 'event') {
      const index = this.eventListeners.indexOf(callback as EventCallback)
      if (index !== -1) {
        this.eventListeners.splice(index, 1)
      }
    } else {
      const index = this.alertListeners.indexOf(callback as AlertCallback)
      if (index !== -1) {
        this.alertListeners.splice(index, 1)
      }
    }
  }

  // ===========================================================================
  // Alert Thresholds
  // ===========================================================================

  setAlertThreshold(metric: string, threshold: number): void {
    this.alertThresholds.set(metric, threshold)
  }

  // ===========================================================================
  // Data Export/Import
  // ===========================================================================

  async exportMetrics(timeRange: TimeRange): Promise<ExportedMetrics> {
    const conversations: ExportedMetrics['conversations'] = []
    const firstResponseMetrics: ExportedMetrics['firstResponseMetrics'] = []
    const resolutionMetrics: ExportedMetrics['resolutionMetrics'] = []

    for (const state of this.conversations.values()) {
      if (!isInTimeRange(state.openedAt, timeRange)) continue

      conversations.push({
        id: state.id,
        openedAt: state.openedAt.toISOString(),
        closedAt: state.closedAt?.toISOString(),
        channel: state.channel,
      })

      if (state.firstResponseAt && state.firstCustomerMessageAt) {
        firstResponseMetrics.push({
          conversationId: state.id,
          firstResponseTimeMs:
            state.firstResponseAt.getTime() - state.firstCustomerMessageAt.getTime(),
          responderId: state.firstResponderId!,
          responderRole: state.firstResponderRole!,
        })
      }

      if (state.closedAt) {
        resolutionMetrics.push({
          conversationId: state.id,
          resolutionTimeMs: state.closedAt.getTime() - state.openedAt.getTime(),
          resolution: state.resolution ?? 'unknown',
        })
      }
    }

    return {
      conversations,
      firstResponseMetrics,
      resolutionMetrics,
    }
  }

  async importMetrics(data: ExportedMetrics): Promise<void> {
    // Import conversations
    for (const conv of data.conversations) {
      const state: ConversationState = {
        id: conv.id,
        openedAt: new Date(conv.openedAt),
        closedAt: conv.closedAt ? new Date(conv.closedAt) : undefined,
        channel: conv.channel,
        participants: new Set(),
        messages: [],
        handoffs: [],
      }
      this.conversations.set(conv.id, state)
    }

    // Import first response metrics
    for (const frt of data.firstResponseMetrics) {
      const state = this.conversations.get(frt.conversationId)
      if (state) {
        // Calculate the timestamps from the FRT
        state.firstCustomerMessageAt = state.openedAt
        state.firstResponseAt = new Date(state.openedAt.getTime() + frt.firstResponseTimeMs)
        state.firstResponderId = frt.responderId
        state.firstResponderRole = frt.responderRole as ParticipantRole
      }
    }

    // Import resolution metrics
    for (const res of data.resolutionMetrics) {
      const state = this.conversations.get(res.conversationId)
      if (state) {
        state.closedAt = new Date(state.openedAt.getTime() + res.resolutionTimeMs)
        state.resolution = res.resolution
      }
    }
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
