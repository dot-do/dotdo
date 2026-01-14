/**
 * Conversation Analytics Tests - TDD RED Phase
 *
 * Tests for conversation analytics metrics:
 * - First Response Time: Time from customer message to first agent/AI response
 * - Resolution Time: Total time from conversation open to close
 * - CSAT Scoring: Customer satisfaction tracking (1-5 scale)
 * - Handoff Frequency: Tracking transfers between agents/AI
 * - Agent Performance: Per-agent metrics (response time, resolutions, CSAT)
 *
 * Following TDD, these tests are written FIRST and define the expected behavior.
 *
 * @module db/primitives/conversation/tests/analytics
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createConversationAnalytics,
  type ConversationAnalytics,
  type ConversationEvent,
  type FirstResponseMetrics,
  type ResolutionMetrics,
  type CSATRating,
  type CSATMetrics,
  type HandoffEvent,
  type HandoffMetrics,
  type AgentPerformanceMetrics,
  type AggregatedMetrics,
  type TimeRange,
} from '../analytics'

// =============================================================================
// Test Helpers
// =============================================================================

function createMessageEvent(
  conversationId: string,
  participantId: string,
  participantRole: 'customer' | 'agent' | 'ai' | 'system',
  timestamp: Date
): ConversationEvent {
  return {
    type: 'message',
    conversationId,
    participantId,
    participantRole,
    timestamp,
    messageId: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  }
}

function createConversationOpenEvent(
  conversationId: string,
  timestamp: Date,
  channel: string = 'chat'
): ConversationEvent {
  return {
    type: 'conversation_open',
    conversationId,
    timestamp,
    metadata: { channel },
  }
}

function createConversationCloseEvent(
  conversationId: string,
  timestamp: Date,
  resolution?: string
): ConversationEvent {
  return {
    type: 'conversation_close',
    conversationId,
    timestamp,
    metadata: { resolution },
  }
}

function createHandoffEvent(
  conversationId: string,
  fromParticipantId: string,
  toParticipantId: string,
  timestamp: Date,
  handoffType: 'transfer' | 'escalation' = 'transfer'
): ConversationEvent {
  return {
    type: 'handoff',
    conversationId,
    timestamp,
    fromParticipantId,
    toParticipantId,
    handoffType,
  }
}

function createCSATEvent(
  conversationId: string,
  rating: number,
  timestamp: Date,
  comment?: string
): ConversationEvent {
  return {
    type: 'csat_submitted',
    conversationId,
    timestamp,
    rating,
    comment,
  }
}

// =============================================================================
// TDD Cycle 1: First Response Time Tracking
// =============================================================================

describe('First Response Time Tracking', () => {
  let analytics: ConversationAnalytics

  beforeEach(() => {
    analytics = createConversationAnalytics()
  })

  it('should track first response time when agent responds to customer', async () => {
    const convId = 'conv_1'
    const baseTime = new Date('2024-01-15T10:00:00Z')

    // Customer opens conversation and sends message
    await analytics.recordEvent(createConversationOpenEvent(convId, baseTime))
    await analytics.recordEvent(
      createMessageEvent(convId, 'customer_1', 'customer', new Date(baseTime.getTime() + 1000))
    )

    // Agent responds after 30 seconds
    await analytics.recordEvent(
      createMessageEvent(convId, 'agent_1', 'agent', new Date(baseTime.getTime() + 31000))
    )

    const metrics = await analytics.getFirstResponseMetrics(convId)
    expect(metrics).toBeDefined()
    expect(metrics!.firstResponseTimeMs).toBe(30000) // 30 seconds
    expect(metrics!.responderId).toBe('agent_1')
    expect(metrics!.responderRole).toBe('agent')
  })

  it('should track first response time when AI responds to customer', async () => {
    const convId = 'conv_2'
    const baseTime = new Date('2024-01-15T10:00:00Z')

    await analytics.recordEvent(createConversationOpenEvent(convId, baseTime))
    await analytics.recordEvent(
      createMessageEvent(convId, 'customer_1', 'customer', new Date(baseTime.getTime() + 1000))
    )

    // AI bot responds after 2 seconds
    await analytics.recordEvent(
      createMessageEvent(convId, 'ai_bot', 'ai', new Date(baseTime.getTime() + 3000))
    )

    const metrics = await analytics.getFirstResponseMetrics(convId)
    expect(metrics!.firstResponseTimeMs).toBe(2000) // 2 seconds
    expect(metrics!.responderRole).toBe('ai')
  })

  it('should only count first non-customer message as first response', async () => {
    const convId = 'conv_3'
    const baseTime = new Date('2024-01-15T10:00:00Z')

    await analytics.recordEvent(createConversationOpenEvent(convId, baseTime))
    await analytics.recordEvent(
      createMessageEvent(convId, 'customer_1', 'customer', new Date(baseTime.getTime() + 1000))
    )
    // Customer sends another message
    await analytics.recordEvent(
      createMessageEvent(convId, 'customer_1', 'customer', new Date(baseTime.getTime() + 5000))
    )
    // Agent responds
    await analytics.recordEvent(
      createMessageEvent(convId, 'agent_1', 'agent', new Date(baseTime.getTime() + 10000))
    )

    const metrics = await analytics.getFirstResponseMetrics(convId)
    // First response time is from first customer message
    expect(metrics!.firstResponseTimeMs).toBe(9000) // 9 seconds from first customer msg
  })

  it('should ignore system messages in first response calculation', async () => {
    const convId = 'conv_4'
    const baseTime = new Date('2024-01-15T10:00:00Z')

    await analytics.recordEvent(createConversationOpenEvent(convId, baseTime))
    await analytics.recordEvent(
      createMessageEvent(convId, 'customer_1', 'customer', new Date(baseTime.getTime() + 1000))
    )
    // System message
    await analytics.recordEvent(
      createMessageEvent(convId, 'system', 'system', new Date(baseTime.getTime() + 2000))
    )
    // Agent responds
    await analytics.recordEvent(
      createMessageEvent(convId, 'agent_1', 'agent', new Date(baseTime.getTime() + 10000))
    )

    const metrics = await analytics.getFirstResponseMetrics(convId)
    expect(metrics!.firstResponseTimeMs).toBe(9000) // System message ignored
    expect(metrics!.responderRole).toBe('agent')
  })

  it('should return null for conversations without first response', async () => {
    const convId = 'conv_5'
    const baseTime = new Date('2024-01-15T10:00:00Z')

    await analytics.recordEvent(createConversationOpenEvent(convId, baseTime))
    await analytics.recordEvent(
      createMessageEvent(convId, 'customer_1', 'customer', new Date(baseTime.getTime() + 1000))
    )

    const metrics = await analytics.getFirstResponseMetrics(convId)
    expect(metrics).toBeNull()
  })

  it('should aggregate first response times over time range', async () => {
    const baseTime = new Date('2024-01-15T10:00:00Z')

    // Conversation 1: 30s FRT
    await analytics.recordEvent(createConversationOpenEvent('conv_a', baseTime))
    await analytics.recordEvent(
      createMessageEvent('conv_a', 'cust_1', 'customer', new Date(baseTime.getTime() + 1000))
    )
    await analytics.recordEvent(
      createMessageEvent('conv_a', 'agent_1', 'agent', new Date(baseTime.getTime() + 31000))
    )

    // Conversation 2: 60s FRT
    await analytics.recordEvent(
      createConversationOpenEvent('conv_b', new Date(baseTime.getTime() + 60000))
    )
    await analytics.recordEvent(
      createMessageEvent('conv_b', 'cust_2', 'customer', new Date(baseTime.getTime() + 61000))
    )
    await analytics.recordEvent(
      createMessageEvent('conv_b', 'agent_2', 'agent', new Date(baseTime.getTime() + 121000))
    )

    const aggregated = await analytics.getAggregatedFirstResponseMetrics({
      start: baseTime,
      end: new Date(baseTime.getTime() + 200000),
    })

    expect(aggregated.count).toBe(2)
    expect(aggregated.averageMs).toBe(45000) // (30000 + 60000) / 2
    expect(aggregated.medianMs).toBe(45000)
    expect(aggregated.p90Ms).toBeDefined()
    expect(aggregated.p95Ms).toBeDefined()
  })
})

// =============================================================================
// TDD Cycle 2: Resolution Time Tracking
// =============================================================================

describe('Resolution Time Tracking', () => {
  let analytics: ConversationAnalytics

  beforeEach(() => {
    analytics = createConversationAnalytics()
  })

  it('should track resolution time from open to close', async () => {
    const convId = 'conv_res_1'
    const openTime = new Date('2024-01-15T10:00:00Z')
    const closeTime = new Date('2024-01-15T10:30:00Z')

    await analytics.recordEvent(createConversationOpenEvent(convId, openTime))
    await analytics.recordEvent(
      createMessageEvent(convId, 'customer_1', 'customer', new Date(openTime.getTime() + 1000))
    )
    await analytics.recordEvent(
      createMessageEvent(convId, 'agent_1', 'agent', new Date(openTime.getTime() + 60000))
    )
    await analytics.recordEvent(createConversationCloseEvent(convId, closeTime, 'resolved'))

    const metrics = await analytics.getResolutionMetrics(convId)
    expect(metrics).toBeDefined()
    expect(metrics!.resolutionTimeMs).toBe(30 * 60 * 1000) // 30 minutes
    expect(metrics!.resolution).toBe('resolved')
  })

  it('should track different resolution types', async () => {
    const baseTime = new Date('2024-01-15T10:00:00Z')

    // Resolved conversation
    await analytics.recordEvent(createConversationOpenEvent('conv_r1', baseTime))
    await analytics.recordEvent(
      createConversationCloseEvent('conv_r1', new Date(baseTime.getTime() + 60000), 'resolved')
    )

    // Abandoned conversation
    await analytics.recordEvent(createConversationOpenEvent('conv_r2', baseTime))
    await analytics.recordEvent(
      createConversationCloseEvent('conv_r2', new Date(baseTime.getTime() + 120000), 'abandoned')
    )

    const m1 = await analytics.getResolutionMetrics('conv_r1')
    const m2 = await analytics.getResolutionMetrics('conv_r2')

    expect(m1!.resolution).toBe('resolved')
    expect(m2!.resolution).toBe('abandoned')
  })

  it('should return null for open conversations', async () => {
    const convId = 'conv_open'
    await analytics.recordEvent(
      createConversationOpenEvent(convId, new Date('2024-01-15T10:00:00Z'))
    )

    const metrics = await analytics.getResolutionMetrics(convId)
    expect(metrics).toBeNull()
  })

  it('should track message count in resolution metrics', async () => {
    const convId = 'conv_msgs'
    const baseTime = new Date('2024-01-15T10:00:00Z')

    await analytics.recordEvent(createConversationOpenEvent(convId, baseTime))
    await analytics.recordEvent(
      createMessageEvent(convId, 'customer_1', 'customer', new Date(baseTime.getTime() + 1000))
    )
    await analytics.recordEvent(
      createMessageEvent(convId, 'agent_1', 'agent', new Date(baseTime.getTime() + 5000))
    )
    await analytics.recordEvent(
      createMessageEvent(convId, 'customer_1', 'customer', new Date(baseTime.getTime() + 10000))
    )
    await analytics.recordEvent(
      createMessageEvent(convId, 'agent_1', 'agent', new Date(baseTime.getTime() + 15000))
    )
    await analytics.recordEvent(
      createConversationCloseEvent(convId, new Date(baseTime.getTime() + 20000), 'resolved')
    )

    const metrics = await analytics.getResolutionMetrics(convId)
    expect(metrics!.messageCount).toBe(4)
    expect(metrics!.participantCount).toBe(2) // customer_1, agent_1
  })

  it('should aggregate resolution metrics over time range', async () => {
    const baseTime = new Date('2024-01-15T10:00:00Z')

    // 3 conversations with different resolution times
    for (let i = 0; i < 3; i++) {
      const convId = `conv_agg_${i}`
      await analytics.recordEvent(
        createConversationOpenEvent(convId, new Date(baseTime.getTime() + i * 1000))
      )
      await analytics.recordEvent(
        createConversationCloseEvent(
          convId,
          new Date(baseTime.getTime() + i * 1000 + (i + 1) * 60000),
          'resolved'
        )
      )
    }

    const aggregated = await analytics.getAggregatedResolutionMetrics({
      start: baseTime,
      end: new Date(baseTime.getTime() + 300000),
    })

    expect(aggregated.count).toBe(3)
    expect(aggregated.resolvedCount).toBe(3)
    expect(aggregated.averageMs).toBeDefined()
    expect(aggregated.resolutionRate).toBe(1.0) // 100% resolved
  })
})

// =============================================================================
// TDD Cycle 3: CSAT Scoring
// =============================================================================

describe('CSAT Scoring', () => {
  let analytics: ConversationAnalytics

  beforeEach(() => {
    analytics = createConversationAnalytics()
  })

  it('should record CSAT rating for conversation', async () => {
    const convId = 'conv_csat_1'
    const baseTime = new Date('2024-01-15T10:00:00Z')

    await analytics.recordEvent(createConversationOpenEvent(convId, baseTime))
    await analytics.recordEvent(
      createConversationCloseEvent(convId, new Date(baseTime.getTime() + 60000), 'resolved')
    )
    await analytics.recordEvent(createCSATEvent(convId, 5, new Date(baseTime.getTime() + 70000)))

    const csat = await analytics.getCSATForConversation(convId)
    expect(csat).toBeDefined()
    expect(csat!.rating).toBe(5)
    expect(csat!.conversationId).toBe(convId)
  })

  it('should validate CSAT rating range (1-5)', async () => {
    const convId = 'conv_csat_invalid'

    await expect(
      analytics.recordEvent(createCSATEvent(convId, 0, new Date()))
    ).rejects.toThrow(/rating must be between 1 and 5/i)

    await expect(
      analytics.recordEvent(createCSATEvent(convId, 6, new Date()))
    ).rejects.toThrow(/rating must be between 1 and 5/i)
  })

  it('should track CSAT with optional comment', async () => {
    const convId = 'conv_csat_comment'
    const baseTime = new Date('2024-01-15T10:00:00Z')

    await analytics.recordEvent(createConversationOpenEvent(convId, baseTime))
    await analytics.recordEvent(
      createCSATEvent(convId, 4, new Date(baseTime.getTime() + 60000), 'Very helpful support!')
    )

    const csat = await analytics.getCSATForConversation(convId)
    expect(csat!.comment).toBe('Very helpful support!')
  })

  it('should aggregate CSAT metrics over time range', async () => {
    const baseTime = new Date('2024-01-15T10:00:00Z')

    // 5 CSAT ratings: 5, 4, 4, 3, 1
    const ratings = [5, 4, 4, 3, 1]
    for (let i = 0; i < ratings.length; i++) {
      const convId = `conv_csat_agg_${i}`
      await analytics.recordEvent(
        createConversationOpenEvent(convId, new Date(baseTime.getTime() + i * 1000))
      )
      await analytics.recordEvent(
        createCSATEvent(convId, ratings[i], new Date(baseTime.getTime() + i * 1000 + 60000))
      )
    }

    const aggregated = await analytics.getAggregatedCSATMetrics({
      start: baseTime,
      end: new Date(baseTime.getTime() + 100000),
    })

    expect(aggregated.responseCount).toBe(5)
    expect(aggregated.averageRating).toBe(3.4) // (5+4+4+3+1)/5
    expect(aggregated.ratingDistribution).toEqual({
      1: 1,
      2: 0,
      3: 1,
      4: 2,
      5: 1,
    })
    // CSAT score is % of 4 and 5 ratings
    expect(aggregated.csatScore).toBe(0.6) // 3/5 = 60%
  })

  it('should link CSAT to agent who handled conversation', async () => {
    const convId = 'conv_csat_agent'
    const baseTime = new Date('2024-01-15T10:00:00Z')

    await analytics.recordEvent(createConversationOpenEvent(convId, baseTime))
    await analytics.recordEvent(
      createMessageEvent(convId, 'customer_1', 'customer', new Date(baseTime.getTime() + 1000))
    )
    await analytics.recordEvent(
      createMessageEvent(convId, 'agent_1', 'agent', new Date(baseTime.getTime() + 5000))
    )
    await analytics.recordEvent(
      createConversationCloseEvent(convId, new Date(baseTime.getTime() + 60000), 'resolved')
    )
    await analytics.recordEvent(createCSATEvent(convId, 5, new Date(baseTime.getTime() + 70000)))

    const csat = await analytics.getCSATForConversation(convId)
    expect(csat!.agentId).toBe('agent_1')
  })
})

// =============================================================================
// TDD Cycle 4: Handoff Frequency Metrics
// =============================================================================

describe('Handoff Frequency Metrics', () => {
  let analytics: ConversationAnalytics

  beforeEach(() => {
    analytics = createConversationAnalytics()
  })

  it('should track transfer handoff', async () => {
    const convId = 'conv_handoff_1'
    const baseTime = new Date('2024-01-15T10:00:00Z')

    await analytics.recordEvent(createConversationOpenEvent(convId, baseTime))
    await analytics.recordEvent(
      createMessageEvent(convId, 'agent_1', 'agent', new Date(baseTime.getTime() + 1000))
    )
    await analytics.recordEvent(
      createHandoffEvent(convId, 'agent_1', 'agent_2', new Date(baseTime.getTime() + 60000), 'transfer')
    )

    const metrics = await analytics.getHandoffMetrics(convId)
    expect(metrics.handoffCount).toBe(1)
    expect(metrics.handoffs[0].fromParticipantId).toBe('agent_1')
    expect(metrics.handoffs[0].toParticipantId).toBe('agent_2')
    expect(metrics.handoffs[0].handoffType).toBe('transfer')
  })

  it('should track escalation handoff', async () => {
    const convId = 'conv_escalation'
    const baseTime = new Date('2024-01-15T10:00:00Z')

    await analytics.recordEvent(createConversationOpenEvent(convId, baseTime))
    await analytics.recordEvent(
      createHandoffEvent(convId, 'ai_bot', 'agent_1', new Date(baseTime.getTime() + 30000), 'escalation')
    )

    const metrics = await analytics.getHandoffMetrics(convId)
    expect(metrics.handoffs[0].handoffType).toBe('escalation')
  })

  it('should track multiple handoffs in single conversation', async () => {
    const convId = 'conv_multi_handoff'
    const baseTime = new Date('2024-01-15T10:00:00Z')

    await analytics.recordEvent(createConversationOpenEvent(convId, baseTime))
    // AI -> Agent 1
    await analytics.recordEvent(
      createHandoffEvent(convId, 'ai_bot', 'agent_1', new Date(baseTime.getTime() + 30000), 'escalation')
    )
    // Agent 1 -> Agent 2
    await analytics.recordEvent(
      createHandoffEvent(convId, 'agent_1', 'agent_2', new Date(baseTime.getTime() + 120000), 'transfer')
    )
    // Agent 2 -> Agent 3 (supervisor)
    await analytics.recordEvent(
      createHandoffEvent(convId, 'agent_2', 'agent_3', new Date(baseTime.getTime() + 180000), 'escalation')
    )

    const metrics = await analytics.getHandoffMetrics(convId)
    expect(metrics.handoffCount).toBe(3)
    expect(metrics.escalationCount).toBe(2)
    expect(metrics.transferCount).toBe(1)
  })

  it('should return zero handoffs for conversations without transfers', async () => {
    const convId = 'conv_no_handoff'
    const baseTime = new Date('2024-01-15T10:00:00Z')

    await analytics.recordEvent(createConversationOpenEvent(convId, baseTime))
    await analytics.recordEvent(
      createMessageEvent(convId, 'customer_1', 'customer', new Date(baseTime.getTime() + 1000))
    )
    await analytics.recordEvent(
      createMessageEvent(convId, 'agent_1', 'agent', new Date(baseTime.getTime() + 5000))
    )

    const metrics = await analytics.getHandoffMetrics(convId)
    expect(metrics.handoffCount).toBe(0)
    expect(metrics.handoffs).toHaveLength(0)
  })

  it('should aggregate handoff metrics over time range', async () => {
    const baseTime = new Date('2024-01-15T10:00:00Z')

    // Conversation 1: 1 escalation
    await analytics.recordEvent(createConversationOpenEvent('conv_h1', baseTime))
    await analytics.recordEvent(
      createHandoffEvent('conv_h1', 'ai_bot', 'agent_1', new Date(baseTime.getTime() + 10000), 'escalation')
    )

    // Conversation 2: 2 transfers
    await analytics.recordEvent(
      createConversationOpenEvent('conv_h2', new Date(baseTime.getTime() + 20000))
    )
    await analytics.recordEvent(
      createHandoffEvent('conv_h2', 'agent_1', 'agent_2', new Date(baseTime.getTime() + 30000), 'transfer')
    )
    await analytics.recordEvent(
      createHandoffEvent('conv_h2', 'agent_2', 'agent_3', new Date(baseTime.getTime() + 40000), 'transfer')
    )

    // Conversation 3: no handoffs
    await analytics.recordEvent(
      createConversationOpenEvent('conv_h3', new Date(baseTime.getTime() + 50000))
    )

    const aggregated = await analytics.getAggregatedHandoffMetrics({
      start: baseTime,
      end: new Date(baseTime.getTime() + 100000),
    })

    expect(aggregated.totalConversations).toBe(3)
    expect(aggregated.conversationsWithHandoffs).toBe(2)
    expect(aggregated.totalHandoffs).toBe(3)
    expect(aggregated.totalEscalations).toBe(1)
    expect(aggregated.totalTransfers).toBe(2)
    expect(aggregated.handoffRate).toBeCloseTo(2 / 3) // 66.7%
    expect(aggregated.averageHandoffsPerConversation).toBe(1) // 3/3
  })
})

// =============================================================================
// TDD Cycle 5: Agent Performance Metrics
// =============================================================================

describe('Agent Performance Metrics', () => {
  let analytics: ConversationAnalytics

  beforeEach(() => {
    analytics = createConversationAnalytics()
  })

  it('should track agent first response time', async () => {
    const baseTime = new Date('2024-01-15T10:00:00Z')

    // Agent handles 2 conversations with different FRT
    for (let i = 0; i < 2; i++) {
      const convId = `conv_agent_${i}`
      await analytics.recordEvent(createConversationOpenEvent(convId, new Date(baseTime.getTime() + i * 100000)))
      await analytics.recordEvent(
        createMessageEvent(convId, 'customer_1', 'customer', new Date(baseTime.getTime() + i * 100000 + 1000))
      )
      // Agent responds: 10s for first, 20s for second
      await analytics.recordEvent(
        createMessageEvent(convId, 'agent_1', 'agent', new Date(baseTime.getTime() + i * 100000 + 1000 + (i + 1) * 10000))
      )
    }

    const metrics = await analytics.getAgentPerformanceMetrics('agent_1', {
      start: baseTime,
      end: new Date(baseTime.getTime() + 300000),
    })

    expect(metrics.agentId).toBe('agent_1')
    expect(metrics.conversationsHandled).toBe(2)
    expect(metrics.averageFirstResponseTimeMs).toBe(15000) // (10000 + 20000) / 2
  })

  it('should track agent resolution count', async () => {
    const baseTime = new Date('2024-01-15T10:00:00Z')

    // Agent resolves 3 conversations
    for (let i = 0; i < 3; i++) {
      const convId = `conv_res_agent_${i}`
      await analytics.recordEvent(
        createConversationOpenEvent(convId, new Date(baseTime.getTime() + i * 10000))
      )
      await analytics.recordEvent(
        createMessageEvent(convId, 'agent_1', 'agent', new Date(baseTime.getTime() + i * 10000 + 1000))
      )
      await analytics.recordEvent(
        createConversationCloseEvent(
          convId,
          new Date(baseTime.getTime() + i * 10000 + 5000),
          i < 2 ? 'resolved' : 'abandoned'
        )
      )
    }

    const metrics = await analytics.getAgentPerformanceMetrics('agent_1', {
      start: baseTime,
      end: new Date(baseTime.getTime() + 100000),
    })

    expect(metrics.resolutionsCount).toBe(2)
    expect(metrics.resolutionRate).toBeCloseTo(2 / 3)
  })

  it('should track agent CSAT', async () => {
    const baseTime = new Date('2024-01-15T10:00:00Z')

    // Agent gets CSAT ratings: 5, 4, 3
    const ratings = [5, 4, 3]
    for (let i = 0; i < ratings.length; i++) {
      const convId = `conv_csat_agent_${i}`
      await analytics.recordEvent(
        createConversationOpenEvent(convId, new Date(baseTime.getTime() + i * 10000))
      )
      await analytics.recordEvent(
        createMessageEvent(convId, 'agent_1', 'agent', new Date(baseTime.getTime() + i * 10000 + 1000))
      )
      await analytics.recordEvent(
        createConversationCloseEvent(convId, new Date(baseTime.getTime() + i * 10000 + 5000), 'resolved')
      )
      await analytics.recordEvent(
        createCSATEvent(convId, ratings[i], new Date(baseTime.getTime() + i * 10000 + 6000))
      )
    }

    const metrics = await analytics.getAgentPerformanceMetrics('agent_1', {
      start: baseTime,
      end: new Date(baseTime.getTime() + 100000),
    })

    expect(metrics.csatCount).toBe(3)
    expect(metrics.averageCSAT).toBe(4) // (5+4+3)/3
    expect(metrics.csatScore).toBeCloseTo(2 / 3) // 2 out of 3 are 4+
  })

  it('should track agent handoff rate', async () => {
    const baseTime = new Date('2024-01-15T10:00:00Z')

    // Agent handles 3 conversations, transfers 1
    for (let i = 0; i < 3; i++) {
      const convId = `conv_handoff_agent_${i}`
      await analytics.recordEvent(
        createConversationOpenEvent(convId, new Date(baseTime.getTime() + i * 10000))
      )
      await analytics.recordEvent(
        createMessageEvent(convId, 'agent_1', 'agent', new Date(baseTime.getTime() + i * 10000 + 1000))
      )
      if (i === 1) {
        // Transfer on second conversation
        await analytics.recordEvent(
          createHandoffEvent(convId, 'agent_1', 'agent_2', new Date(baseTime.getTime() + i * 10000 + 3000), 'transfer')
        )
      }
    }

    const metrics = await analytics.getAgentPerformanceMetrics('agent_1', {
      start: baseTime,
      end: new Date(baseTime.getTime() + 100000),
    })

    expect(metrics.handoffsInitiated).toBe(1)
    expect(metrics.handoffRate).toBeCloseTo(1 / 3)
  })

  it('should compare multiple agents', async () => {
    const baseTime = new Date('2024-01-15T10:00:00Z')

    // Agent 1: 2 conversations, fast FRT
    for (let i = 0; i < 2; i++) {
      const convId = `conv_cmp_a1_${i}`
      await analytics.recordEvent(createConversationOpenEvent(convId, new Date(baseTime.getTime() + i * 10000)))
      await analytics.recordEvent(
        createMessageEvent(convId, 'customer_1', 'customer', new Date(baseTime.getTime() + i * 10000 + 1000))
      )
      await analytics.recordEvent(
        createMessageEvent(convId, 'agent_1', 'agent', new Date(baseTime.getTime() + i * 10000 + 5000))
      )
    }

    // Agent 2: 3 conversations, slower FRT
    for (let i = 0; i < 3; i++) {
      const convId = `conv_cmp_a2_${i}`
      await analytics.recordEvent(createConversationOpenEvent(convId, new Date(baseTime.getTime() + i * 10000 + 50000)))
      await analytics.recordEvent(
        createMessageEvent(convId, 'customer_2', 'customer', new Date(baseTime.getTime() + i * 10000 + 51000))
      )
      await analytics.recordEvent(
        createMessageEvent(convId, 'agent_2', 'agent', new Date(baseTime.getTime() + i * 10000 + 61000))
      )
    }

    const timeRange: TimeRange = {
      start: baseTime,
      end: new Date(baseTime.getTime() + 200000),
    }

    const agent1Metrics = await analytics.getAgentPerformanceMetrics('agent_1', timeRange)
    const agent2Metrics = await analytics.getAgentPerformanceMetrics('agent_2', timeRange)

    expect(agent1Metrics.conversationsHandled).toBe(2)
    expect(agent2Metrics.conversationsHandled).toBe(3)
    expect(agent1Metrics.averageFirstResponseTimeMs).toBeLessThan(
      agent2Metrics.averageFirstResponseTimeMs
    )
  })

  it('should return empty metrics for agent with no activity', async () => {
    const metrics = await analytics.getAgentPerformanceMetrics('unknown_agent', {
      start: new Date('2024-01-15T10:00:00Z'),
      end: new Date('2024-01-15T11:00:00Z'),
    })

    expect(metrics.conversationsHandled).toBe(0)
    expect(metrics.averageFirstResponseTimeMs).toBeNull()
    expect(metrics.csatCount).toBe(0)
  })
})

// =============================================================================
// TDD Cycle 6: Aggregated Metrics Dashboard
// =============================================================================

describe('Aggregated Metrics Dashboard', () => {
  let analytics: ConversationAnalytics

  beforeEach(() => {
    analytics = createConversationAnalytics()
  })

  it('should provide comprehensive metrics summary', async () => {
    const baseTime = new Date('2024-01-15T10:00:00Z')

    // Create diverse conversation data
    for (let i = 0; i < 5; i++) {
      const convId = `conv_dashboard_${i}`
      await analytics.recordEvent(
        createConversationOpenEvent(convId, new Date(baseTime.getTime() + i * 10000))
      )
      await analytics.recordEvent(
        createMessageEvent(
          convId,
          'customer_1',
          'customer',
          new Date(baseTime.getTime() + i * 10000 + 1000)
        )
      )
      await analytics.recordEvent(
        createMessageEvent(
          convId,
          `agent_${i % 2}`,
          'agent',
          new Date(baseTime.getTime() + i * 10000 + 10000)
        )
      )
      await analytics.recordEvent(
        createConversationCloseEvent(
          convId,
          new Date(baseTime.getTime() + i * 10000 + 60000),
          i < 4 ? 'resolved' : 'abandoned'
        )
      )
      if (i < 3) {
        await analytics.recordEvent(
          createCSATEvent(convId, 4 + (i % 2), new Date(baseTime.getTime() + i * 10000 + 70000))
        )
      }
    }

    const summary = await analytics.getMetricsSummary({
      start: baseTime,
      end: new Date(baseTime.getTime() + 500000),
    })

    expect(summary.totalConversations).toBe(5)
    expect(summary.firstResponse.count).toBe(5)
    expect(summary.resolution.count).toBe(5)
    expect(summary.resolution.resolvedCount).toBe(4)
    expect(summary.csat.responseCount).toBe(3)
    expect(summary.handoffs).toBeDefined()
  })

  it('should filter metrics by channel', async () => {
    const baseTime = new Date('2024-01-15T10:00:00Z')

    // Chat conversation
    await analytics.recordEvent({
      type: 'conversation_open',
      conversationId: 'conv_chat',
      timestamp: baseTime,
      metadata: { channel: 'chat' },
    })
    await analytics.recordEvent(
      createMessageEvent('conv_chat', 'customer_1', 'customer', new Date(baseTime.getTime() + 1000))
    )
    await analytics.recordEvent(
      createMessageEvent('conv_chat', 'agent_1', 'agent', new Date(baseTime.getTime() + 5000))
    )

    // Email conversation
    await analytics.recordEvent({
      type: 'conversation_open',
      conversationId: 'conv_email',
      timestamp: new Date(baseTime.getTime() + 10000),
      metadata: { channel: 'email' },
    })
    await analytics.recordEvent(
      createMessageEvent('conv_email', 'customer_2', 'customer', new Date(baseTime.getTime() + 11000))
    )
    await analytics.recordEvent(
      createMessageEvent('conv_email', 'agent_2', 'agent', new Date(baseTime.getTime() + 30000))
    )

    const chatMetrics = await analytics.getMetricsSummary(
      { start: baseTime, end: new Date(baseTime.getTime() + 100000) },
      { channel: 'chat' }
    )
    const emailMetrics = await analytics.getMetricsSummary(
      { start: baseTime, end: new Date(baseTime.getTime() + 100000) },
      { channel: 'email' }
    )

    expect(chatMetrics.totalConversations).toBe(1)
    expect(emailMetrics.totalConversations).toBe(1)
    // Chat has faster FRT than email
    expect(chatMetrics.firstResponse.averageMs).toBeLessThan(emailMetrics.firstResponse.averageMs)
  })

  it('should provide leaderboard of top agents', async () => {
    const baseTime = new Date('2024-01-15T10:00:00Z')

    // Create conversations for multiple agents with varying performance
    const agentData = [
      { id: 'agent_1', conversations: 5, avgFRT: 5000, csatAvg: 4.8 },
      { id: 'agent_2', conversations: 8, avgFRT: 15000, csatAvg: 4.2 },
      { id: 'agent_3', conversations: 3, avgFRT: 8000, csatAvg: 4.5 },
    ]

    for (const agent of agentData) {
      for (let i = 0; i < agent.conversations; i++) {
        const convId = `conv_lb_${agent.id}_${i}`
        const startTime = baseTime.getTime() + Math.random() * 100000
        await analytics.recordEvent(
          createConversationOpenEvent(convId, new Date(startTime))
        )
        await analytics.recordEvent(
          createMessageEvent(convId, 'customer_1', 'customer', new Date(startTime + 1000))
        )
        await analytics.recordEvent(
          createMessageEvent(convId, agent.id, 'agent', new Date(startTime + 1000 + agent.avgFRT))
        )
        await analytics.recordEvent(
          createConversationCloseEvent(convId, new Date(startTime + 60000), 'resolved')
        )
        // Add CSAT for some conversations
        if (i < 3) {
          await analytics.recordEvent(
            createCSATEvent(convId, Math.round(agent.csatAvg), new Date(startTime + 70000))
          )
        }
      }
    }

    const leaderboard = await analytics.getAgentLeaderboard({
      start: baseTime,
      end: new Date(baseTime.getTime() + 200000),
    })

    expect(leaderboard).toHaveLength(3)
    // Sorted by some performance metric (e.g., conversations handled or CSAT)
    expect(leaderboard[0]).toHaveProperty('agentId')
    expect(leaderboard[0]).toHaveProperty('conversationsHandled')
    expect(leaderboard[0]).toHaveProperty('averageCSAT')
  })
})

// =============================================================================
// TDD Cycle 7: Real-time Event Processing
// =============================================================================

describe('Real-time Event Processing', () => {
  let analytics: ConversationAnalytics

  beforeEach(() => {
    analytics = createConversationAnalytics()
  })

  it('should support event listeners', async () => {
    const events: ConversationEvent[] = []

    analytics.on('event', (event) => {
      events.push(event)
    })

    const baseTime = new Date('2024-01-15T10:00:00Z')
    await analytics.recordEvent(createConversationOpenEvent('conv_events', baseTime))
    await analytics.recordEvent(
      createMessageEvent('conv_events', 'customer_1', 'customer', new Date(baseTime.getTime() + 1000))
    )

    expect(events).toHaveLength(2)
    expect(events[0].type).toBe('conversation_open')
    expect(events[1].type).toBe('message')
  })

  it('should emit metric threshold alerts', async () => {
    const alerts: Array<{ metric: string; value: number; threshold: number }> = []

    analytics.on('alert', (alert) => {
      alerts.push(alert)
    })

    // Configure alert threshold
    analytics.setAlertThreshold('firstResponseTime', 30000) // 30s threshold

    const baseTime = new Date('2024-01-15T10:00:00Z')
    await analytics.recordEvent(createConversationOpenEvent('conv_slow', baseTime))
    await analytics.recordEvent(
      createMessageEvent('conv_slow', 'customer_1', 'customer', new Date(baseTime.getTime() + 1000))
    )
    // Slow response: 60 seconds
    await analytics.recordEvent(
      createMessageEvent('conv_slow', 'agent_1', 'agent', new Date(baseTime.getTime() + 61000))
    )

    expect(alerts).toHaveLength(1)
    expect(alerts[0].metric).toBe('firstResponseTime')
    expect(alerts[0].value).toBe(60000)
    expect(alerts[0].threshold).toBe(30000)
  })

  it('should support removing event listeners', async () => {
    const events: ConversationEvent[] = []
    const handler = (event: ConversationEvent) => events.push(event)

    analytics.on('event', handler)
    await analytics.recordEvent(createConversationOpenEvent('conv_1', new Date()))

    analytics.off('event', handler)
    await analytics.recordEvent(createConversationOpenEvent('conv_2', new Date()))

    expect(events).toHaveLength(1) // Only first event
  })
})

// =============================================================================
// TDD Cycle 8: Data Persistence
// =============================================================================

describe('Data Persistence', () => {
  it('should export metrics data', async () => {
    const analytics = createConversationAnalytics()
    const baseTime = new Date('2024-01-15T10:00:00Z')

    await analytics.recordEvent(createConversationOpenEvent('conv_export', baseTime))
    await analytics.recordEvent(
      createMessageEvent('conv_export', 'customer_1', 'customer', new Date(baseTime.getTime() + 1000))
    )
    await analytics.recordEvent(
      createMessageEvent('conv_export', 'agent_1', 'agent', new Date(baseTime.getTime() + 5000))
    )
    await analytics.recordEvent(
      createConversationCloseEvent('conv_export', new Date(baseTime.getTime() + 60000), 'resolved')
    )

    const exported = await analytics.exportMetrics({
      start: baseTime,
      end: new Date(baseTime.getTime() + 100000),
    })

    expect(exported).toHaveProperty('conversations')
    expect(exported).toHaveProperty('firstResponseMetrics')
    expect(exported).toHaveProperty('resolutionMetrics')
    expect(exported.conversations).toHaveLength(1)
  })

  it('should import previously exported metrics', async () => {
    const analytics = createConversationAnalytics()

    const exportedData = {
      conversations: [
        {
          id: 'conv_imported',
          openedAt: '2024-01-15T10:00:00Z',
          closedAt: '2024-01-15T10:30:00Z',
          channel: 'chat',
        },
      ],
      firstResponseMetrics: [
        {
          conversationId: 'conv_imported',
          firstResponseTimeMs: 10000,
          responderId: 'agent_1',
          responderRole: 'agent',
        },
      ],
      resolutionMetrics: [
        {
          conversationId: 'conv_imported',
          resolutionTimeMs: 1800000,
          resolution: 'resolved',
        },
      ],
    }

    await analytics.importMetrics(exportedData)

    const frt = await analytics.getFirstResponseMetrics('conv_imported')
    expect(frt).toBeDefined()
    expect(frt!.firstResponseTimeMs).toBe(10000)

    const resolution = await analytics.getResolutionMetrics('conv_imported')
    expect(resolution).toBeDefined()
    expect(resolution!.resolutionTimeMs).toBe(1800000)
  })
})
