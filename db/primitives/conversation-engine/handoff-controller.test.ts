/**
 * HandoffController Tests
 *
 * Tests for AI-to-human and human-to-AI handoff protocol:
 * - AI to human handoff triggers (confidence threshold, explicit request, sentiment)
 * - Human to AI handoff (resolution, after-hours, overflow)
 * - Context preservation during handoff
 * - Handoff notification to all parties
 * - Handoff reason and history tracking
 *
 * @module db/primitives/conversation-engine/handoff-controller.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createConversationEngine, type ConversationEngine, type Conversation } from './index'
import {
  createHandoffController,
  type HandoffController,
  type HandoffRequest,
  type HandoffRecord,
  type HandoffContext,
  type HandoffTriggerConfig,
  type HandoffEvent,
  type HandoffNotification,
  type TriggerEvaluation,
} from './handoff-controller'

// =============================================================================
// Test Setup
// =============================================================================

describe('HandoffController', () => {
  let engine: ConversationEngine
  let handoff: HandoffController
  let conversationId: string

  beforeEach(async () => {
    engine = createConversationEngine()
    handoff = createHandoffController(engine)

    // Create a test conversation with AI and customer
    const conv = await engine.createConversation({
      channel: 'chat',
      participants: [
        { id: 'customer_123', role: 'customer', name: 'John Doe' },
        { id: 'ai_bot', role: 'ai', name: 'Support Bot' },
      ],
      subject: 'Support Request',
    })
    conversationId = conv.id
  })

  // ===========================================================================
  // Basic Handoff Operations
  // ===========================================================================

  describe('basic operations', () => {
    it('should create a handoff controller', () => {
      expect(handoff).toBeDefined()
      expect(typeof handoff.initiateHandoff).toBe('function')
      expect(typeof handoff.acceptHandoff).toBe('function')
      expect(typeof handoff.completeHandoff).toBe('function')
    })

    it('should initiate AI to human handoff', async () => {
      const request: HandoffRequest = {
        from: { id: 'ai_bot', type: 'ai', name: 'Support Bot' },
        to: { id: 'agent_456', type: 'human', name: 'Agent Smith' },
        reason: 'low_confidence',
        context: {
          summary: 'Customer asking about refund policy',
          sentiment: 'frustrated',
        },
      }

      const record = await handoff.initiateHandoff(conversationId, request)

      expect(record).toBeDefined()
      expect(record.id).toBeDefined()
      expect(record.conversationId).toBe(conversationId)
      expect(record.from.id).toBe('ai_bot')
      expect(record.from.type).toBe('ai')
      expect(record.to.id).toBe('agent_456')
      expect(record.to.type).toBe('human')
      expect(record.status).toBe('pending')
      expect(record.reason.code).toBe('low_confidence')
      expect(record.context.summary).toBe('Customer asking about refund policy')
      expect(record.createdAt).toBeInstanceOf(Date)
    })

    it('should initiate human to AI handoff', async () => {
      const request: HandoffRequest = {
        from: { id: 'agent_456', type: 'human', name: 'Agent Smith' },
        to: { id: 'ai_bot', type: 'ai', name: 'Support Bot' },
        reason: 'issue_resolved',
        context: {
          summary: 'Simple FAQ question now resolved',
        },
      }

      const record = await handoff.initiateHandoff(conversationId, request)

      expect(record.from.type).toBe('human')
      expect(record.to.type).toBe('ai')
      expect(record.reason.code).toBe('issue_resolved')
    })

    it('should reject handoff for non-existent conversation', async () => {
      const request: HandoffRequest = {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'agent_456', type: 'human' },
        reason: 'low_confidence',
      }

      await expect(
        handoff.initiateHandoff('non_existent', request),
      ).rejects.toThrow(/not found/)
    })
  })

  // ===========================================================================
  // Handoff Lifecycle
  // ===========================================================================

  describe('handoff lifecycle', () => {
    let handoffId: string

    beforeEach(async () => {
      const record = await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'agent_456', type: 'human' },
        reason: 'customer_requested',
      })
      handoffId = record.id
    })

    it('should accept a pending handoff', async () => {
      const accepted = await handoff.acceptHandoff(handoffId, 'agent_456')

      expect(accepted.status).toBe('accepted')
      expect(accepted.acceptedAt).toBeInstanceOf(Date)
      expect(accepted.acceptedBy).toBe('agent_456')
    })

    it('should complete an accepted handoff', async () => {
      await handoff.acceptHandoff(handoffId, 'agent_456')
      const completed = await handoff.completeHandoff(handoffId)

      expect(completed.status).toBe('completed')
      expect(completed.completedAt).toBeInstanceOf(Date)
    })

    it('should reject a pending handoff', async () => {
      const rejected = await handoff.rejectHandoff(handoffId, 'Agent unavailable')

      expect(rejected.status).toBe('rejected')
      expect(rejected.rejectionReason).toBe('Agent unavailable')
    })

    it('should cancel a pending handoff', async () => {
      const cancelled = await handoff.cancelHandoff(handoffId, 'Customer disconnected')

      expect(cancelled.status).toBe('cancelled')
      expect(cancelled.metadata?.cancellationReason).toBe('Customer disconnected')
    })

    it('should not accept non-pending handoff', async () => {
      await handoff.acceptHandoff(handoffId, 'agent_456')

      await expect(
        handoff.acceptHandoff(handoffId, 'agent_789'),
      ).rejects.toThrow(/not pending/)
    })

    it('should not complete non-accepted handoff', async () => {
      await expect(
        handoff.completeHandoff(handoffId),
      ).rejects.toThrow(/must be accepted/)
    })

    it('should not cancel completed handoff', async () => {
      await handoff.acceptHandoff(handoffId, 'agent_456')
      await handoff.completeHandoff(handoffId)

      await expect(
        handoff.cancelHandoff(handoffId),
      ).rejects.toThrow(/Cannot cancel completed/)
    })
  })

  // ===========================================================================
  // Context Preservation
  // ===========================================================================

  describe('context preservation', () => {
    it('should preserve context during handoff', async () => {
      const context: HandoffContext = {
        summary: 'Customer wants to return a defective product',
        sentiment: 'frustrated',
        topics: ['returns', 'defective', 'refund'],
        intent: 'return_request',
        originalIssue: 'My laptop screen is cracked',
        lastAiResponse: 'I understand you want to return your laptop...',
        aiConfidence: 0.65,
        aiTurns: 3,
        suggestedActions: ['Process return', 'Offer replacement', 'Issue refund'],
        customerProfile: {
          id: 'customer_123',
          name: 'John Doe',
          tier: 'gold',
          lifetime_value: 5000,
          previous_tickets: 2,
        },
      }

      const record = await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'agent_456', type: 'human' },
        reason: 'low_confidence',
        context,
      })

      expect(record.context.summary).toBe(context.summary)
      expect(record.context.sentiment).toBe(context.sentiment)
      expect(record.context.topics).toEqual(context.topics)
      expect(record.context.customerProfile?.tier).toBe('gold')
      expect(record.context.suggestedActions).toHaveLength(3)
    })

    it('should update context during active handoff', async () => {
      const record = await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'agent_456', type: 'human' },
        reason: 'low_confidence',
        context: { summary: 'Initial summary' },
      })

      const updated = await handoff.updateContext(record.id, {
        summary: 'Updated summary with more details',
        suggestedActions: ['New action item'],
      })

      expect(updated.context.summary).toBe('Updated summary with more details')
      expect(updated.context.suggestedActions).toEqual(['New action item'])
    })

    it('should retrieve context by handoff ID', async () => {
      const record = await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'agent_456', type: 'human' },
        reason: 'low_confidence',
        context: { summary: 'Test summary', sentiment: 'negative' },
      })

      const context = await handoff.getContext(record.id)

      expect(context?.summary).toBe('Test summary')
      expect(context?.sentiment).toBe('negative')
    })

    it('should return undefined context for unknown handoff', async () => {
      const context = await handoff.getContext('unknown_id')
      expect(context).toBeUndefined()
    })
  })

  // ===========================================================================
  // AI to Human Triggers
  // ===========================================================================

  describe('AI to human triggers', () => {
    describe('confidence threshold trigger', () => {
      beforeEach(() => {
        handoff.configureTrigger({
          type: 'confidence_threshold',
          threshold: 0.7,
          action: 'escalate_to_human',
        })
      })

      it('should trigger when AI confidence is below threshold', async () => {
        await engine.addMessage(conversationId, {
          from: 'ai_bot',
          content: 'I think the answer might be...',
          contentType: 'text/plain',
          metadata: { aiConfidence: 0.5 },
        })

        const messages = await engine.getMessages(conversationId)
        const evaluations = await handoff.evaluateTriggers(conversationId, messages[0])

        expect(evaluations).toHaveLength(1)
        expect(evaluations[0].triggered).toBe(true)
        expect(evaluations[0].triggerType).toBe('confidence_threshold')
        expect(evaluations[0].confidence).toBe(0.5)
      })

      it('should not trigger when AI confidence is above threshold', async () => {
        await engine.addMessage(conversationId, {
          from: 'ai_bot',
          content: 'Here is the answer...',
          contentType: 'text/plain',
          metadata: { aiConfidence: 0.85 },
        })

        const messages = await engine.getMessages(conversationId)
        const evaluations = await handoff.evaluateTriggers(conversationId, messages[0])

        expect(evaluations).toHaveLength(0)
      })
    })

    describe('explicit request trigger', () => {
      beforeEach(() => {
        handoff.configureTrigger({
          type: 'explicit_request',
          keywords: ['human', 'agent', 'person', 'speak to someone'],
          action: 'escalate_to_human',
        })
      })

      it('should trigger when customer requests human agent', async () => {
        await engine.addMessage(conversationId, {
          from: 'customer_123',
          content: 'I want to speak to a human please',
          contentType: 'text/plain',
        })

        const messages = await engine.getMessages(conversationId)
        const evaluations = await handoff.evaluateTriggers(conversationId, messages[0])

        expect(evaluations).toHaveLength(1)
        expect(evaluations[0].triggered).toBe(true)
        expect(evaluations[0].triggerType).toBe('explicit_request')
        expect(evaluations[0].metadata?.matchedKeyword).toBe('human')
      })

      it('should trigger on various phrases', async () => {
        const phrases = [
          'Can I talk to an agent?',
          'I need a real person',
          'Let me speak to someone please',
        ]

        for (const phrase of phrases) {
          await engine.addMessage(conversationId, {
            from: 'customer_123',
            content: phrase,
            contentType: 'text/plain',
          })

          const messages = await engine.getMessages(conversationId)
          const lastMessage = messages[messages.length - 1]
          const evaluations = await handoff.evaluateTriggers(conversationId, lastMessage)

          expect(evaluations.length).toBeGreaterThan(0)
          expect(evaluations[0].triggered).toBe(true)
        }
      })
    })

    describe('negative sentiment trigger', () => {
      beforeEach(() => {
        handoff.configureTrigger({
          type: 'sentiment_negative',
          action: 'escalate_to_human',
        })
      })

      it('should trigger on negative sentiment', async () => {
        await engine.addMessage(conversationId, {
          from: 'customer_123',
          content: 'This is ridiculous!',
          contentType: 'text/plain',
          metadata: { sentiment: 'frustrated' },
        })

        const messages = await engine.getMessages(conversationId)
        const evaluations = await handoff.evaluateTriggers(conversationId, messages[0])

        expect(evaluations).toHaveLength(1)
        expect(evaluations[0].triggered).toBe(true)
        expect(evaluations[0].triggerType).toBe('sentiment_negative')
      })

      it('should trigger on angry sentiment', async () => {
        await engine.addMessage(conversationId, {
          from: 'customer_123',
          content: 'I am so angry right now!',
          contentType: 'text/plain',
          metadata: { sentiment: 'angry' },
        })

        const messages = await engine.getMessages(conversationId)
        const evaluations = await handoff.evaluateTriggers(conversationId, messages[0])

        expect(evaluations.some(e => e.triggerType === 'sentiment_negative')).toBe(true)
      })
    })

    describe('sensitive topic trigger', () => {
      beforeEach(() => {
        handoff.configureTrigger({
          type: 'topic_sensitive',
          topics: ['legal', 'lawsuit', 'refund', 'manager'],
          action: 'escalate_to_human',
        })
      })

      it('should trigger on sensitive topics', async () => {
        await engine.addMessage(conversationId, {
          from: 'customer_123',
          content: 'I want a full refund or I will take legal action',
          contentType: 'text/plain',
        })

        const messages = await engine.getMessages(conversationId)
        const evaluations = await handoff.evaluateTriggers(conversationId, messages[0])

        expect(evaluations.some(e => e.triggerType === 'topic_sensitive')).toBe(true)
      })

      it('should trigger when customer asks for manager', async () => {
        await engine.addMessage(conversationId, {
          from: 'customer_123',
          content: 'I want to speak to your manager',
          contentType: 'text/plain',
        })

        const messages = await engine.getMessages(conversationId)
        const evaluations = await handoff.evaluateTriggers(conversationId, messages[0])

        expect(evaluations.some(e => e.triggerType === 'topic_sensitive')).toBe(true)
      })
    })

    describe('max AI turns trigger', () => {
      beforeEach(() => {
        handoff.configureTrigger({
          type: 'max_ai_turns',
          maxTurns: 3,
          action: 'escalate_to_human',
        })
      })

      it('should trigger when max AI turns exceeded', async () => {
        // Add multiple AI messages
        for (let i = 0; i < 4; i++) {
          await engine.addMessage(conversationId, {
            from: 'ai_bot',
            content: `AI response ${i + 1}`,
            contentType: 'text/plain',
          })
        }

        const evaluations = await handoff.evaluateTriggers(conversationId)

        expect(evaluations.some(e => e.triggerType === 'max_ai_turns')).toBe(true)
      })

      it('should not trigger when under max turns', async () => {
        await engine.addMessage(conversationId, {
          from: 'ai_bot',
          content: 'First AI response',
          contentType: 'text/plain',
        })

        const evaluations = await handoff.evaluateTriggers(conversationId)

        expect(evaluations.some(e => e.triggerType === 'max_ai_turns')).toBe(false)
      })
    })

    describe('shouldHandoff helper', () => {
      it('should return true when triggers fire', async () => {
        handoff.configureTrigger({
          type: 'explicit_request',
          keywords: ['human'],
          action: 'escalate_to_human',
        })

        await engine.addMessage(conversationId, {
          from: 'customer_123',
          content: 'I need a human',
          contentType: 'text/plain',
        })

        const messages = await engine.getMessages(conversationId)
        const shouldHandoff = await handoff.shouldHandoff(conversationId, messages[0])

        expect(shouldHandoff).toBe(true)
      })

      it('should return false when no triggers fire', async () => {
        handoff.configureTrigger({
          type: 'explicit_request',
          keywords: ['human'],
          action: 'escalate_to_human',
        })

        await engine.addMessage(conversationId, {
          from: 'customer_123',
          content: 'What are your hours?',
          contentType: 'text/plain',
        })

        const messages = await engine.getMessages(conversationId)
        const shouldHandoff = await handoff.shouldHandoff(conversationId, messages[0])

        expect(shouldHandoff).toBe(false)
      })
    })
  })

  // ===========================================================================
  // Human to AI Triggers
  // ===========================================================================

  describe('human to AI triggers', () => {
    it('should support resolution-based handoff to AI', async () => {
      // First do AI to human handoff
      const aiToHuman = await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'agent_456', type: 'human' },
        reason: 'customer_requested',
      })
      await handoff.acceptHandoff(aiToHuman.id, 'agent_456')
      await handoff.completeHandoff(aiToHuman.id)

      // Then do human to AI handoff
      const humanToAi = await handoff.initiateHandoff(conversationId, {
        from: { id: 'agent_456', type: 'human' },
        to: { id: 'ai_bot', type: 'ai' },
        reason: 'issue_resolved',
        context: {
          summary: 'Refund processed, customer satisfied',
        },
      })

      expect(humanToAi.reason.code).toBe('issue_resolved')
      expect(humanToAi.from.type).toBe('human')
      expect(humanToAi.to.type).toBe('ai')
    })

    it('should support overflow to AI during high volume', async () => {
      const record = await handoff.initiateHandoff(conversationId, {
        from: { id: 'support_queue', type: 'queue' },
        to: { id: 'ai_bot', type: 'ai' },
        reason: 'overflow_to_ai',
        context: {
          summary: 'High queue volume, routing simple query to AI',
        },
      })

      expect(record.reason.code).toBe('overflow_to_ai')
      expect(record.to.type).toBe('ai')
    })

    it('should support routine inquiry handoff to AI', async () => {
      const record = await handoff.initiateHandoff(conversationId, {
        from: { id: 'agent_456', type: 'human' },
        to: { id: 'ai_bot', type: 'ai' },
        reason: 'routine_inquiry',
        context: {
          summary: 'Simple FAQ about business hours',
          intent: 'hours_inquiry',
        },
      })

      expect(record.reason.code).toBe('routine_inquiry')
    })
  })

  // ===========================================================================
  // Handoff Notifications
  // ===========================================================================

  describe('notifications', () => {
    it('should notify participants on handoff initiation', async () => {
      const notificationHandler = vi.fn()
      handoff.onNotification(notificationHandler)

      await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'agent_456', type: 'human' },
        reason: 'low_confidence',
        notifyParticipants: true,
      })

      expect(notificationHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'handoff_initiated',
          conversationId,
        }),
      )
    })

    it('should notify on handoff acceptance', async () => {
      const notificationHandler = vi.fn()
      handoff.onNotification(notificationHandler)

      const record = await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'agent_456', type: 'human' },
        reason: 'low_confidence',
      })

      await handoff.acceptHandoff(record.id, 'agent_456')

      expect(notificationHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'handoff_accepted',
        }),
      )
    })

    it('should notify on handoff completion', async () => {
      const notificationHandler = vi.fn()
      handoff.onNotification(notificationHandler)

      const record = await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'agent_456', type: 'human' },
        reason: 'low_confidence',
      })

      await handoff.acceptHandoff(record.id, 'agent_456')
      await handoff.completeHandoff(record.id)

      expect(notificationHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'handoff_completed',
        }),
      )
    })

    it('should notify on context update', async () => {
      const notificationHandler = vi.fn()
      handoff.onNotification(notificationHandler)

      const record = await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'agent_456', type: 'human' },
        reason: 'low_confidence',
      })

      await handoff.updateContext(record.id, {
        summary: 'Updated context',
      })

      expect(notificationHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'context_update',
        }),
      )
    })

    it('should allow removing notification handlers', async () => {
      const handler = vi.fn()
      handoff.onNotification(handler)
      handoff.offNotification(handler)

      await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'agent_456', type: 'human' },
        reason: 'low_confidence',
      })

      expect(handler).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Event Handling
  // ===========================================================================

  describe('event handling', () => {
    it('should emit event on handoff initiation', async () => {
      const eventHandler = vi.fn()
      handoff.on('handoff:initiated', eventHandler)

      const record = await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'agent_456', type: 'human' },
        reason: 'low_confidence',
      })

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'handoff:initiated',
          handoffId: record.id,
          conversationId,
        }),
      )
    })

    it('should emit event on handoff acceptance', async () => {
      const eventHandler = vi.fn()
      handoff.on('handoff:accepted', eventHandler)

      const record = await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'agent_456', type: 'human' },
        reason: 'low_confidence',
      })

      await handoff.acceptHandoff(record.id, 'agent_456')

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'handoff:accepted',
          data: expect.objectContaining({ acceptedBy: 'agent_456' }),
        }),
      )
    })

    it('should emit event on trigger detection', async () => {
      const eventHandler = vi.fn()
      handoff.on('trigger:detected', eventHandler)

      handoff.configureTrigger({
        type: 'explicit_request',
        keywords: ['human'],
        action: 'escalate_to_human',
      })

      await engine.addMessage(conversationId, {
        from: 'customer_123',
        content: 'I want a human',
        contentType: 'text/plain',
      })

      const messages = await engine.getMessages(conversationId)
      await handoff.evaluateTriggers(conversationId, messages[0])

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'trigger:detected',
        }),
      )
    })

    it('should allow removing event handlers', async () => {
      const handler = vi.fn()
      handoff.on('handoff:initiated', handler)
      handoff.off('handoff:initiated', handler)

      await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'agent_456', type: 'human' },
        reason: 'low_confidence',
      })

      expect(handler).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Handoff History and Queries
  // ===========================================================================

  describe('handoff history and queries', () => {
    it('should track handoff history per conversation', async () => {
      await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'agent_456', type: 'human' },
        reason: 'low_confidence',
      })

      await handoff.initiateHandoff(conversationId, {
        from: { id: 'agent_456', type: 'human' },
        to: { id: 'ai_bot', type: 'ai' },
        reason: 'issue_resolved',
      })

      const history = await handoff.getHandoffHistory(conversationId)

      expect(history).toHaveLength(2)
      expect(history[0].reason.code).toBe('low_confidence')
      expect(history[1].reason.code).toBe('issue_resolved')
    })

    it('should retrieve specific handoff by ID', async () => {
      const created = await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'agent_456', type: 'human' },
        reason: 'customer_requested',
      })

      const retrieved = await handoff.getHandoff(created.id)

      expect(retrieved).toBeDefined()
      expect(retrieved!.id).toBe(created.id)
      expect(retrieved!.reason.code).toBe('customer_requested')
    })

    it('should return undefined for unknown handoff ID', async () => {
      const result = await handoff.getHandoff('unknown_id')
      expect(result).toBeUndefined()
    })

    it('should query pending handoffs', async () => {
      await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'support_queue', type: 'queue' },
        reason: 'low_confidence',
      })

      const pending = await handoff.getPendingHandoffs()

      expect(pending).toHaveLength(1)
      expect(pending[0].status).toBe('pending')
    })

    it('should filter pending handoffs by queue', async () => {
      await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'support_queue', type: 'queue' },
        reason: 'low_confidence',
      })

      await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'billing_queue', type: 'queue' },
        reason: 'topic_sensitive',
      })

      const supportQueue = await handoff.getPendingHandoffs('support_queue')
      const billingQueue = await handoff.getPendingHandoffs('billing_queue')

      expect(supportQueue).toHaveLength(1)
      expect(billingQueue).toHaveLength(1)
      expect(supportQueue[0].to.id).toBe('support_queue')
      expect(billingQueue[0].to.id).toBe('billing_queue')
    })

    it('should sort pending handoffs by priority', async () => {
      await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'support_queue', type: 'queue' },
        reason: 'low_confidence',
        priority: 'low',
      })

      await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'support_queue', type: 'queue' },
        reason: 'customer_requested',
        priority: 'urgent',
      })

      await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'support_queue', type: 'queue' },
        reason: 'negative_sentiment',
        priority: 'high',
      })

      const pending = await handoff.getPendingHandoffs('support_queue')

      expect(pending[0].priority).toBe('urgent')
      expect(pending[1].priority).toBe('high')
      expect(pending[2].priority).toBe('low')
    })
  })

  // ===========================================================================
  // Trigger Configuration
  // ===========================================================================

  describe('trigger configuration', () => {
    it('should configure and retrieve triggers', () => {
      handoff.configureTrigger({
        type: 'confidence_threshold',
        threshold: 0.7,
        action: 'escalate_to_human',
      })

      handoff.configureTrigger({
        type: 'explicit_request',
        keywords: ['human', 'agent'],
        action: 'escalate_to_human',
      })

      const triggers = handoff.getTriggers()

      expect(triggers).toHaveLength(2)
      expect(triggers.some(t => t.type === 'confidence_threshold')).toBe(true)
      expect(triggers.some(t => t.type === 'explicit_request')).toBe(true)
    })

    it('should remove triggers', () => {
      handoff.configureTrigger({
        type: 'confidence_threshold',
        threshold: 0.7,
        action: 'escalate_to_human',
      })

      handoff.removeTrigger('confidence_threshold')

      const triggers = handoff.getTriggers()
      expect(triggers).toHaveLength(0)
    })

    it('should disable triggers', async () => {
      handoff.configureTrigger({
        type: 'explicit_request',
        keywords: ['human'],
        action: 'escalate_to_human',
        enabled: false,
      })

      await engine.addMessage(conversationId, {
        from: 'customer_123',
        content: 'I want a human',
        contentType: 'text/plain',
      })

      const messages = await engine.getMessages(conversationId)
      const evaluations = await handoff.evaluateTriggers(conversationId, messages[0])

      expect(evaluations).toHaveLength(0)
    })
  })

  // ===========================================================================
  // Handoff Reason Handling
  // ===========================================================================

  describe('handoff reason handling', () => {
    it('should normalize string reason codes', async () => {
      const record = await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'agent_456', type: 'human' },
        reason: 'low_confidence',
      })

      expect(record.reason.code).toBe('low_confidence')
      expect(record.reason.description).toBe('AI confidence below threshold')
    })

    it('should accept full reason objects', async () => {
      const record = await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'agent_456', type: 'human' },
        reason: {
          code: 'low_confidence',
          description: 'Custom description for low confidence',
          triggeredBy: 'confidence_threshold',
          metadata: { confidence: 0.4 },
        },
      })

      expect(record.reason.description).toBe('Custom description for low confidence')
      expect(record.reason.triggeredBy).toBe('confidence_threshold')
      expect(record.reason.metadata?.confidence).toBe(0.4)
    })
  })

  // ===========================================================================
  // Priority Handling
  // ===========================================================================

  describe('priority handling', () => {
    it('should default to normal priority', async () => {
      const record = await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'agent_456', type: 'human' },
        reason: 'low_confidence',
      })

      expect(record.priority).toBe('normal')
    })

    it('should accept custom priority', async () => {
      const record = await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'agent_456', type: 'human' },
        reason: 'negative_sentiment',
        priority: 'urgent',
      })

      expect(record.priority).toBe('urgent')
    })
  })

  // ===========================================================================
  // Participant Management
  // ===========================================================================

  describe('participant management', () => {
    it('should add target participant to conversation on handoff', async () => {
      await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'new_agent_789', type: 'human', name: 'New Agent' },
        reason: 'low_confidence',
      })

      const conv = await engine.getConversation(conversationId)
      const newAgent = conv!.participants.find(p => p.id === 'new_agent_789')

      expect(newAgent).toBeDefined()
      expect(newAgent!.role).toBe('agent')
      expect(newAgent!.name).toBe('New Agent')
    })

    it('should not fail if participant already exists', async () => {
      // Add agent first
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
        name: 'Existing Agent',
      })

      // Handoff should not throw
      const record = await handoff.initiateHandoff(conversationId, {
        from: { id: 'ai_bot', type: 'ai' },
        to: { id: 'agent_456', type: 'human' },
        reason: 'low_confidence',
      })

      expect(record.status).toBe('pending')
    })
  })
})
