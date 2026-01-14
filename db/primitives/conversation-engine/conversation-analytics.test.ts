/**
 * ConversationAnalytics Tests
 *
 * Tests for conversation analytics including:
 * - First response time metrics
 * - Resolution time metrics
 * - Handle time per agent
 * - CSAT score tracking
 * - Volume by channel/time
 * - SLA compliance tracking
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createConversationAnalytics,
  type ConversationAnalytics,
  type SLATarget,
} from './conversation-analytics'

describe('ConversationAnalytics', () => {
  let analytics: ConversationAnalytics

  beforeEach(() => {
    analytics = createConversationAnalytics()
  })

  describe('First Response Time', () => {
    it('should calculate first response time correctly', () => {
      const createdAt = new Date('2025-01-01T10:00:00Z')
      const respondedAt = new Date('2025-01-01T10:05:00Z')

      analytics.recordConversationCreated({
        conversationId: 'conv_1',
        channel: 'chat',
        priority: 'normal',
        createdAt,
      })

      analytics.recordFirstResponse({
        conversationId: 'conv_1',
        agentId: 'agent_1',
        respondedAt,
      })

      const metrics = analytics.getMetrics()

      // 5 minutes = 300,000 ms
      expect(metrics.averageFirstResponseTimeMs).toBe(300000)
      expect(metrics.medianFirstResponseTimeMs).toBe(300000)
    })

    it('should calculate percentiles for multiple conversations', () => {
      const baseTime = new Date('2025-01-01T10:00:00Z')

      // Create conversations with different response times
      const responseTimes = [60000, 120000, 180000, 240000, 300000] // 1-5 minutes

      responseTimes.forEach((responseMs, i) => {
        const convId = `conv_${i}`
        analytics.recordConversationCreated({
          conversationId: convId,
          channel: 'chat',
          priority: 'normal',
          createdAt: baseTime,
        })

        analytics.recordFirstResponse({
          conversationId: convId,
          agentId: 'agent_1',
          respondedAt: new Date(baseTime.getTime() + responseMs),
        })
      })

      const metrics = analytics.getMetrics()

      expect(metrics.averageFirstResponseTimeMs).toBe(180000) // 3 minutes average
      expect(metrics.medianFirstResponseTimeMs).toBe(180000) // 3 minutes median
      expect(metrics.p90FirstResponseTimeMs).toBe(300000) // 5 minutes
    })

    it('should only record first response once', () => {
      const createdAt = new Date('2025-01-01T10:00:00Z')

      analytics.recordConversationCreated({
        conversationId: 'conv_1',
        channel: 'chat',
        createdAt,
      })

      analytics.recordFirstResponse({
        conversationId: 'conv_1',
        agentId: 'agent_1',
        respondedAt: new Date('2025-01-01T10:05:00Z'),
      })

      // Second response should be ignored
      analytics.recordFirstResponse({
        conversationId: 'conv_1',
        agentId: 'agent_2',
        respondedAt: new Date('2025-01-01T10:10:00Z'),
      })

      const metrics = analytics.getMetrics()
      expect(metrics.averageFirstResponseTimeMs).toBe(300000) // Still 5 minutes
    })
  })

  describe('Resolution Time', () => {
    it('should calculate resolution time correctly', () => {
      const createdAt = new Date('2025-01-01T10:00:00Z')
      const closedAt = new Date('2025-01-01T11:00:00Z')

      analytics.recordConversationCreated({
        conversationId: 'conv_1',
        channel: 'email',
        priority: 'high',
        createdAt,
      })

      analytics.recordConversationClosed({
        conversationId: 'conv_1',
        closedAt,
        status: 'resolved',
        closeReason: 'Issue resolved',
      })

      const metrics = analytics.getMetrics()

      // 1 hour = 3,600,000 ms
      expect(metrics.averageResolutionTimeMs).toBe(3600000)
    })

    it('should calculate resolution percentiles', () => {
      const baseTime = new Date('2025-01-01T10:00:00Z')

      // Create conversations with different resolution times
      const resolutionTimes = [
        1800000, // 30 min
        3600000, // 1 hr
        7200000, // 2 hr
        14400000, // 4 hr
        28800000, // 8 hr
      ]

      resolutionTimes.forEach((resMs, i) => {
        const convId = `conv_${i}`
        analytics.recordConversationCreated({
          conversationId: convId,
          channel: 'email',
          createdAt: baseTime,
        })

        analytics.recordConversationClosed({
          conversationId: convId,
          closedAt: new Date(baseTime.getTime() + resMs),
          status: 'resolved',
        })
      })

      const metrics = analytics.getMetrics()

      expect(metrics.medianResolutionTimeMs).toBe(7200000) // 2 hours
      expect(metrics.p90ResolutionTimeMs).toBe(28800000) // 8 hours
    })
  })

  describe('Agent Handle Time', () => {
    it('should track handle time per agent', () => {
      const createdAt = new Date('2025-01-01T10:00:00Z')
      const assignedAt = new Date('2025-01-01T10:05:00Z')
      const closedAt = new Date('2025-01-01T10:35:00Z')

      analytics.recordConversationCreated({
        conversationId: 'conv_1',
        channel: 'chat',
        createdAt,
      })

      analytics.recordAgentAssigned({
        conversationId: 'conv_1',
        agentId: 'agent_1',
        assignedAt,
      })

      analytics.recordConversationClosed({
        conversationId: 'conv_1',
        closedAt,
        status: 'resolved',
      })

      const agentMetrics = analytics.getAgentMetrics('agent_1')

      // 30 minutes handle time
      expect(agentMetrics.averageHandleTimeMs).toBe(1800000)
      expect(agentMetrics.totalConversationsHandled).toBe(1)
    })

    it('should track multiple agents on same conversation', () => {
      const createdAt = new Date('2025-01-01T10:00:00Z')

      analytics.recordConversationCreated({
        conversationId: 'conv_1',
        channel: 'chat',
        createdAt,
      })

      // First agent handles for 15 min
      analytics.recordAgentAssigned({
        conversationId: 'conv_1',
        agentId: 'agent_1',
        assignedAt: new Date('2025-01-01T10:00:00Z'),
      })

      analytics.recordTransfer({
        conversationId: 'conv_1',
        fromAgent: 'agent_1',
        toAgent: 'agent_2',
        reason: 'Escalation',
        transferredAt: new Date('2025-01-01T10:15:00Z'),
      })

      // Second agent handles for 30 min
      analytics.recordConversationClosed({
        conversationId: 'conv_1',
        closedAt: new Date('2025-01-01T10:45:00Z'),
        status: 'resolved',
      })

      const agent1Metrics = analytics.getAgentMetrics('agent_1')
      const agent2Metrics = analytics.getAgentMetrics('agent_2')

      expect(agent1Metrics.averageHandleTimeMs).toBe(900000) // 15 min
      expect(agent2Metrics.averageHandleTimeMs).toBe(1800000) // 30 min
    })

    it('should track agent message count', () => {
      analytics.recordConversationCreated({
        conversationId: 'conv_1',
        channel: 'chat',
        createdAt: new Date(),
      })

      analytics.recordAgentAssigned({
        conversationId: 'conv_1',
        agentId: 'agent_1',
        assignedAt: new Date(),
      })

      analytics.recordAgentMessage('conv_1', 'agent_1')
      analytics.recordAgentMessage('conv_1', 'agent_1')
      analytics.recordAgentMessage('conv_1', 'agent_1')

      const state = analytics.getConversationState('conv_1')
      expect(state?.agentAssignments[0]?.messageCount).toBe(3)
    })
  })

  describe('CSAT Score Tracking', () => {
    it('should calculate average CSAT score', () => {
      // Create conversations and record CSAT
      for (let i = 0; i < 5; i++) {
        analytics.recordConversationCreated({
          conversationId: `conv_${i}`,
          channel: 'chat',
          createdAt: new Date(),
        })

        analytics.recordCSAT({
          conversationId: `conv_${i}`,
          agentId: 'agent_1',
          score: i + 1, // 1, 2, 3, 4, 5
          maxScore: 5,
          submittedAt: new Date(),
        })
      }

      const metrics = analytics.getMetrics()

      // Average of 1,2,3,4,5 = 3, normalized to 60%
      expect(metrics.csat.averageScore).toBe(60)
      expect(metrics.csat.totalResponses).toBe(5)
    })

    it('should calculate CSAT distribution', () => {
      analytics.recordConversationCreated({
        conversationId: 'conv_1',
        channel: 'chat',
        createdAt: new Date(),
      })

      // Multiple CSAT submissions
      analytics.recordCSAT({
        conversationId: 'conv_1',
        score: 5,
        maxScore: 5,
        submittedAt: new Date(),
      })

      analytics.recordConversationCreated({
        conversationId: 'conv_2',
        channel: 'chat',
        createdAt: new Date(),
      })

      analytics.recordCSAT({
        conversationId: 'conv_2',
        score: 5,
        maxScore: 5,
        submittedAt: new Date(),
      })

      analytics.recordConversationCreated({
        conversationId: 'conv_3',
        channel: 'chat',
        createdAt: new Date(),
      })

      analytics.recordCSAT({
        conversationId: 'conv_3',
        score: 3,
        maxScore: 5,
        submittedAt: new Date(),
      })

      const metrics = analytics.getMetrics()

      expect(metrics.csat.distribution[5]).toBe(2)
      expect(metrics.csat.distribution[3]).toBe(1)
    })

    it('should track CSAT trend over time', () => {
      // Week 1 - lower scores
      for (let i = 0; i < 3; i++) {
        const convId = `conv_w1_${i}`
        analytics.recordConversationCreated({
          conversationId: convId,
          channel: 'chat',
          createdAt: new Date('2025-01-01'),
        })

        analytics.recordCSAT({
          conversationId: convId,
          score: 3,
          submittedAt: new Date('2025-01-01'),
        })
      }

      // Week 2 - higher scores
      for (let i = 0; i < 3; i++) {
        const convId = `conv_w2_${i}`
        analytics.recordConversationCreated({
          conversationId: convId,
          channel: 'chat',
          createdAt: new Date('2025-01-08'),
        })

        analytics.recordCSAT({
          conversationId: convId,
          score: 5,
          submittedAt: new Date('2025-01-08'),
        })
      }

      const trend = analytics.getCSATTrend({
        from: new Date('2025-01-01'),
        to: new Date('2025-01-15'),
        groupBy: 'week',
      })

      expect(trend.length).toBe(2)
      expect(trend[0]!.csat.averageScore).toBe(60) // 3/5 = 60%
      expect(trend[1]!.csat.averageScore).toBe(100) // 5/5 = 100%
    })

    it('should filter CSAT by agent', () => {
      analytics.recordConversationCreated({
        conversationId: 'conv_1',
        channel: 'chat',
        createdAt: new Date(),
      })

      analytics.recordCSAT({
        conversationId: 'conv_1',
        agentId: 'agent_1',
        score: 5,
        submittedAt: new Date(),
      })

      analytics.recordConversationCreated({
        conversationId: 'conv_2',
        channel: 'chat',
        createdAt: new Date(),
      })

      analytics.recordCSAT({
        conversationId: 'conv_2',
        agentId: 'agent_2',
        score: 2,
        submittedAt: new Date(),
      })

      const agent1Metrics = analytics.getAgentMetrics('agent_1')
      const agent2Metrics = analytics.getAgentMetrics('agent_2')

      expect(agent1Metrics.csatScore).toBe(100) // 5/5
      expect(agent2Metrics.csatScore).toBe(40) // 2/5
    })
  })

  describe('Volume by Channel', () => {
    it('should calculate volume by channel', () => {
      // Create conversations across channels
      const channels: Array<'chat' | 'email' | 'voice'> = ['chat', 'chat', 'chat', 'email', 'voice']

      channels.forEach((channel, i) => {
        analytics.recordConversationCreated({
          conversationId: `conv_${i}`,
          channel,
          createdAt: new Date(),
        })
      })

      const volumeByChannel = analytics.getVolumeByChannel()

      expect(volumeByChannel.find(v => v.channel === 'chat')?.total).toBe(3)
      expect(volumeByChannel.find(v => v.channel === 'chat')?.percentage).toBe(0.6)
      expect(volumeByChannel.find(v => v.channel === 'email')?.total).toBe(1)
      expect(volumeByChannel.find(v => v.channel === 'voice')?.total).toBe(1)
    })

    it('should calculate volume by priority', () => {
      const priorities: Array<'low' | 'normal' | 'high' | 'urgent'> = [
        'urgent',
        'high',
        'high',
        'normal',
        'normal',
        'normal',
        'low',
      ]

      priorities.forEach((priority, i) => {
        analytics.recordConversationCreated({
          conversationId: `conv_${i}`,
          channel: 'chat',
          priority,
          createdAt: new Date(),
        })
      })

      const metrics = analytics.getMetrics()

      expect(metrics.conversationsByPriority.urgent).toBe(1)
      expect(metrics.conversationsByPriority.high).toBe(2)
      expect(metrics.conversationsByPriority.normal).toBe(3)
      expect(metrics.conversationsByPriority.low).toBe(1)
    })
  })

  describe('Volume by Time', () => {
    it('should group conversations by day', () => {
      // Create conversations over multiple days
      analytics.recordConversationCreated({
        conversationId: 'conv_1',
        channel: 'chat',
        createdAt: new Date('2025-01-01T10:00:00Z'),
      })

      analytics.recordConversationCreated({
        conversationId: 'conv_2',
        channel: 'chat',
        createdAt: new Date('2025-01-01T14:00:00Z'),
      })

      analytics.recordConversationCreated({
        conversationId: 'conv_3',
        channel: 'chat',
        createdAt: new Date('2025-01-02T10:00:00Z'),
      })

      const volumeByTime = analytics.getVolumeByTime({
        from: new Date('2025-01-01'),
        to: new Date('2025-01-03'),
        groupBy: 'day',
      })

      expect(volumeByTime.length).toBe(2)
      expect(volumeByTime[0]!.newConversations).toBe(2) // Jan 1
      expect(volumeByTime[1]!.newConversations).toBe(1) // Jan 2
    })

    it('should track closed and reopened conversations', () => {
      analytics.recordConversationCreated({
        conversationId: 'conv_1',
        channel: 'chat',
        createdAt: new Date('2025-01-01T10:00:00Z'),
      })

      analytics.recordConversationClosed({
        conversationId: 'conv_1',
        closedAt: new Date('2025-01-01T12:00:00Z'),
        status: 'resolved',
      })

      analytics.recordConversationReopened({
        conversationId: 'conv_1',
        reopenedAt: new Date('2025-01-01T15:00:00Z'),
      })

      const volumeByTime = analytics.getVolumeByTime({
        from: new Date('2025-01-01'),
        to: new Date('2025-01-02'),
        groupBy: 'day',
      })

      expect(volumeByTime[0]!.closedConversations).toBe(1)
      expect(volumeByTime[0]!.reopenedConversations).toBe(1)
    })

    it('should calculate time distribution by hour', () => {
      // Create conversations at different hours
      const hours = [9, 9, 10, 10, 10, 14, 14, 15]

      hours.forEach((hour, i) => {
        analytics.recordConversationCreated({
          conversationId: `conv_${i}`,
          channel: 'chat',
          createdAt: new Date(`2025-01-01T${hour.toString().padStart(2, '0')}:00:00Z`),
        })
      })

      const distribution = analytics.getTimeDistribution()

      expect(distribution[9]!.count).toBe(2)
      expect(distribution[10]!.count).toBe(3)
      expect(distribution[14]!.count).toBe(2)
      expect(distribution[15]!.count).toBe(1)
    })
  })

  describe('SLA Compliance', () => {
    beforeEach(() => {
      // Add SLA targets
      analytics.addSLATarget({
        id: 'sla_frt_normal',
        name: 'First Response - Normal',
        type: 'first_response',
        targetMs: 300000, // 5 minutes
        priority: 'normal',
      })

      analytics.addSLATarget({
        id: 'sla_frt_urgent',
        name: 'First Response - Urgent',
        type: 'first_response',
        targetMs: 60000, // 1 minute
        priority: 'urgent',
      })

      analytics.addSLATarget({
        id: 'sla_resolution',
        name: 'Resolution Time',
        type: 'resolution',
        targetMs: 86400000, // 24 hours
      })
    })

    it('should track SLA compliance for first response', () => {
      // Conversation meets SLA
      analytics.recordConversationCreated({
        conversationId: 'conv_1',
        channel: 'chat',
        priority: 'normal',
        createdAt: new Date('2025-01-01T10:00:00Z'),
      })

      analytics.recordFirstResponse({
        conversationId: 'conv_1',
        agentId: 'agent_1',
        respondedAt: new Date('2025-01-01T10:03:00Z'), // 3 min
      })

      // Conversation breaches SLA
      analytics.recordConversationCreated({
        conversationId: 'conv_2',
        channel: 'chat',
        priority: 'normal',
        createdAt: new Date('2025-01-01T11:00:00Z'),
      })

      analytics.recordFirstResponse({
        conversationId: 'conv_2',
        agentId: 'agent_1',
        respondedAt: new Date('2025-01-01T11:10:00Z'), // 10 min - breached
      })

      const compliance = analytics.getSLACompliance()
      const frtCompliance = compliance.find(c => c.slaTargetId === 'sla_frt_normal')

      expect(frtCompliance?.totalEvaluated).toBe(2)
      expect(frtCompliance?.totalMet).toBe(1)
      expect(frtCompliance?.totalBreached).toBe(1)
      expect(frtCompliance?.complianceRate).toBe(0.5)
    })

    it('should track SLA compliance for resolution', () => {
      analytics.recordConversationCreated({
        conversationId: 'conv_1',
        channel: 'chat',
        createdAt: new Date('2025-01-01T10:00:00Z'),
      })

      // Resolved within SLA
      analytics.recordConversationClosed({
        conversationId: 'conv_1',
        closedAt: new Date('2025-01-01T18:00:00Z'), // 8 hours
        status: 'resolved',
      })

      analytics.recordConversationCreated({
        conversationId: 'conv_2',
        channel: 'chat',
        createdAt: new Date('2025-01-02T10:00:00Z'),
      })

      // Resolved outside SLA
      analytics.recordConversationClosed({
        conversationId: 'conv_2',
        closedAt: new Date('2025-01-04T10:00:00Z'), // 48 hours - breached
        status: 'resolved',
      })

      const compliance = analytics.getSLACompliance()
      const resCompliance = compliance.find(c => c.slaTargetId === 'sla_resolution')

      expect(resCompliance?.totalMet).toBe(1)
      expect(resCompliance?.totalBreached).toBe(1)
    })

    it('should apply SLA targets based on priority', () => {
      // Urgent conversation
      analytics.recordConversationCreated({
        conversationId: 'conv_urgent',
        channel: 'chat',
        priority: 'urgent',
        createdAt: new Date('2025-01-01T10:00:00Z'),
      })

      analytics.recordFirstResponse({
        conversationId: 'conv_urgent',
        agentId: 'agent_1',
        respondedAt: new Date('2025-01-01T10:02:00Z'), // 2 min - breached urgent SLA
      })

      const compliance = analytics.getSLACompliance()

      // Should be evaluated against urgent SLA (1 min) not normal SLA
      const urgentCompliance = compliance.find(c => c.slaTargetId === 'sla_frt_urgent')
      expect(urgentCompliance?.totalBreached).toBe(1)

      // Should NOT be evaluated against normal SLA
      const normalCompliance = compliance.find(c => c.slaTargetId === 'sla_frt_normal')
      expect(normalCompliance).toBeUndefined()
    })

    it('should manage SLA targets', () => {
      const targets = analytics.getSLATargets()
      expect(targets.length).toBe(3)

      analytics.removeSLATarget('sla_frt_normal')

      const updatedTargets = analytics.getSLATargets()
      expect(updatedTargets.length).toBe(2)
      expect(updatedTargets.find(t => t.id === 'sla_frt_normal')).toBeUndefined()
    })
  })

  describe('Real-time Metrics', () => {
    it('should count active conversations', () => {
      analytics.recordConversationCreated({
        conversationId: 'conv_1',
        channel: 'chat',
        createdAt: new Date(),
      })

      analytics.recordConversationCreated({
        conversationId: 'conv_2',
        channel: 'chat',
        createdAt: new Date(),
      })

      expect(analytics.getActiveConversationsCount()).toBe(2)

      analytics.recordConversationClosed({
        conversationId: 'conv_1',
        closedAt: new Date(),
        status: 'resolved',
      })

      expect(analytics.getActiveConversationsCount()).toBe(1)
    })

    it('should calculate queue depth', () => {
      // Create unresponded conversations
      analytics.recordConversationCreated({
        conversationId: 'conv_1',
        channel: 'chat',
        createdAt: new Date(),
      })

      analytics.recordConversationCreated({
        conversationId: 'conv_2',
        channel: 'email',
        createdAt: new Date(),
      })

      analytics.recordConversationCreated({
        conversationId: 'conv_3',
        channel: 'chat',
        createdAt: new Date(),
      })

      // Respond to one
      analytics.recordFirstResponse({
        conversationId: 'conv_1',
        agentId: 'agent_1',
        respondedAt: new Date(),
      })

      expect(analytics.getQueueDepth()).toBe(2)
      expect(analytics.getQueueDepth('chat')).toBe(1)
      expect(analytics.getQueueDepth('email')).toBe(1)
    })

    it('should calculate average wait time', () => {
      const now = Date.now()

      // Create conversations waiting for response
      analytics.recordConversationCreated({
        conversationId: 'conv_1',
        channel: 'chat',
        createdAt: new Date(now - 60000), // 1 min ago
      })

      analytics.recordConversationCreated({
        conversationId: 'conv_2',
        channel: 'chat',
        createdAt: new Date(now - 120000), // 2 min ago
      })

      const avgWait = analytics.getAverageWaitTime()

      // Should be approximately 90000ms (1.5 min)
      expect(avgWait).toBeGreaterThan(80000)
      expect(avgWait).toBeLessThan(100000)
    })
  })

  describe('Escalation and Transfer Tracking', () => {
    it('should track escalations', () => {
      analytics.recordConversationCreated({
        conversationId: 'conv_1',
        channel: 'chat',
        createdAt: new Date(),
      })

      analytics.recordEscalation({
        conversationId: 'conv_1',
        fromAgent: 'agent_1',
        toQueue: 'tier2',
        reason: 'Complex issue',
        escalatedAt: new Date(),
      })

      const volumeByTime = analytics.getVolumeByTime({ groupBy: 'day' })
      expect(volumeByTime[0]!.escalatedConversations).toBe(1)
    })

    it('should track transfers', () => {
      analytics.recordConversationCreated({
        conversationId: 'conv_1',
        channel: 'chat',
        createdAt: new Date(),
      })

      analytics.recordTransfer({
        conversationId: 'conv_1',
        fromAgent: 'agent_1',
        toAgent: 'agent_2',
        reason: 'Specialist required',
        transferredAt: new Date(),
      })

      const volumeByTime = analytics.getVolumeByTime({ groupBy: 'day' })
      expect(volumeByTime[0]!.transferredConversations).toBe(1)
    })
  })

  describe('Query Filtering', () => {
    beforeEach(() => {
      // Set up test data
      analytics.recordConversationCreated({
        conversationId: 'conv_chat_high',
        channel: 'chat',
        priority: 'high',
        createdAt: new Date('2025-01-01T10:00:00Z'),
      })

      analytics.recordAgentAssigned({
        conversationId: 'conv_chat_high',
        agentId: 'agent_1',
        assignedAt: new Date('2025-01-01T10:00:00Z'),
      })

      analytics.recordConversationCreated({
        conversationId: 'conv_email_normal',
        channel: 'email',
        priority: 'normal',
        createdAt: new Date('2025-01-02T10:00:00Z'),
      })

      analytics.recordAgentAssigned({
        conversationId: 'conv_email_normal',
        agentId: 'agent_2',
        assignedAt: new Date('2025-01-02T10:00:00Z'),
      })

      analytics.recordConversationCreated({
        conversationId: 'conv_chat_normal',
        channel: 'chat',
        priority: 'normal',
        createdAt: new Date('2025-01-03T10:00:00Z'),
      })

      analytics.recordAgentAssigned({
        conversationId: 'conv_chat_normal',
        agentId: 'agent_1',
        assignedAt: new Date('2025-01-03T10:00:00Z'),
      })
    })

    it('should filter by date range', () => {
      const metrics = analytics.getMetrics({
        from: new Date('2025-01-01'),
        to: new Date('2025-01-02'),
      })

      expect(metrics.totalConversations).toBe(2)
    })

    it('should filter by channel', () => {
      const metrics = analytics.getMetrics({
        channel: ['chat'],
      })

      expect(metrics.totalConversations).toBe(2)
    })

    it('should filter by priority', () => {
      const metrics = analytics.getMetrics({
        priority: ['high'],
      })

      expect(metrics.totalConversations).toBe(1)
    })

    it('should filter by agent', () => {
      const metrics = analytics.getMetrics({
        agentId: 'agent_1',
      })

      expect(metrics.totalConversations).toBe(2)
    })

    it('should combine filters', () => {
      const metrics = analytics.getMetrics({
        channel: ['chat'],
        priority: ['normal'],
        agentId: 'agent_1',
      })

      expect(metrics.totalConversations).toBe(1)
    })
  })

  describe('Agent Performance Metrics', () => {
    it('should calculate comprehensive agent metrics', () => {
      const baseTime = new Date('2025-01-01T10:00:00Z')

      // Create and handle multiple conversations
      for (let i = 0; i < 3; i++) {
        const convId = `conv_${i}`

        analytics.recordConversationCreated({
          conversationId: convId,
          channel: 'chat',
          createdAt: baseTime,
        })

        analytics.recordAgentAssigned({
          conversationId: convId,
          agentId: 'agent_1',
          assignedAt: new Date(baseTime.getTime() + 60000), // 1 min
        })

        analytics.recordFirstResponse({
          conversationId: convId,
          agentId: 'agent_1',
          respondedAt: new Date(baseTime.getTime() + 120000), // 2 min
        })

        analytics.recordCSAT({
          conversationId: convId,
          agentId: 'agent_1',
          score: 4 + (i % 2), // Alternating 4 and 5
          submittedAt: new Date(baseTime.getTime() + 3600000),
        })

        analytics.recordConversationClosed({
          conversationId: convId,
          closedAt: new Date(baseTime.getTime() + 1800000), // 30 min
          status: 'resolved',
        })
      }

      const agentMetrics = analytics.getAgentMetrics('agent_1')

      expect(agentMetrics.totalConversationsHandled).toBe(3)
      expect(agentMetrics.averageResponseTimeMs).toBe(120000) // 2 min
      expect(agentMetrics.csatResponses).toBe(3)
      expect(agentMetrics.conversationsByStatus.resolved).toBe(3)
    })
  })

  describe('Clear Data', () => {
    it('should clear all analytics data', () => {
      analytics.recordConversationCreated({
        conversationId: 'conv_1',
        channel: 'chat',
        createdAt: new Date(),
      })

      analytics.addSLATarget({
        id: 'sla_1',
        name: 'Test SLA',
        type: 'first_response',
        targetMs: 60000,
      })

      expect(analytics.getActiveConversationsCount()).toBe(1)
      expect(analytics.getSLATargets().length).toBe(1)

      analytics.clear()

      expect(analytics.getActiveConversationsCount()).toBe(0)
      expect(analytics.getSLATargets().length).toBe(0)
      expect(analytics.getMetrics().totalConversations).toBe(0)
    })
  })
})
