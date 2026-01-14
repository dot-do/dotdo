import { describe, it, expect, expectTypeOf } from 'vitest'
import type {
  Message,
  Conversation,
  Ticket,
  TicketStatus,
  TicketPriority,
  EscalationTrigger,
  EscalationTriggerType,
  SupportConfig,
  Agent,
  Customer,
} from '../types'

describe('Support Types', () => {
  // ============================================================================
  // MESSAGE TYPE
  // ============================================================================
  describe('Message', () => {
    it('should have role, content, and timestamp', () => {
      const message: Message = {
        role: 'customer',
        content: 'I need help with my order',
        timestamp: new Date(),
      }

      expect(message.role).toBe('customer')
      expect(message.content).toBe('I need help with my order')
      expect(message.timestamp).toBeInstanceOf(Date)
    })

    it('should support agent, customer, and system roles', () => {
      const agentMessage: Message = { role: 'agent', content: 'Hello', timestamp: new Date() }
      const customerMessage: Message = { role: 'customer', content: 'Hi', timestamp: new Date() }
      const systemMessage: Message = { role: 'system', content: 'Ticket created', timestamp: new Date() }

      expect(agentMessage.role).toBe('agent')
      expect(customerMessage.role).toBe('customer')
      expect(systemMessage.role).toBe('system')
    })
  })

  // ============================================================================
  // CONVERSATION TYPE
  // ============================================================================
  describe('Conversation', () => {
    it('should have messages array, customer ref, and current agent', () => {
      const conversation: Conversation = {
        id: 'conv-123',
        messages: [],
        customer: { id: 'cust-456', name: 'John Doe', email: 'john@example.com' },
        agent: { id: 'sam', name: 'Sam' },
        startedAt: new Date(),
      }

      expect(conversation.id).toBe('conv-123')
      expect(Array.isArray(conversation.messages)).toBe(true)
      expect(conversation.customer.id).toBe('cust-456')
      expect(conversation.agent.id).toBe('sam')
      expect(conversation.startedAt).toBeInstanceOf(Date)
    })

    it('should allow messages to be added', () => {
      const conversation: Conversation = {
        id: 'conv-123',
        messages: [
          { role: 'customer', content: 'Help!', timestamp: new Date() },
          { role: 'agent', content: 'How can I assist?', timestamp: new Date() },
        ],
        customer: { id: 'cust-1', name: 'Jane', email: 'jane@example.com' },
        agent: { id: 'sam', name: 'Sam' },
        startedAt: new Date(),
      }

      expect(conversation.messages.length).toBe(2)
      expect(conversation.messages[0].role).toBe('customer')
      expect(conversation.messages[1].role).toBe('agent')
    })

    it('should support optional metadata', () => {
      const conversation: Conversation = {
        id: 'conv-123',
        messages: [],
        customer: { id: 'cust-1', name: 'Jane', email: 'jane@example.com' },
        agent: { id: 'sam', name: 'Sam' },
        startedAt: new Date(),
        metadata: { source: 'chatbox', topic: 'billing' },
      }

      expect(conversation.metadata?.source).toBe('chatbox')
      expect(conversation.metadata?.topic).toBe('billing')
    })
  })

  // ============================================================================
  // TICKET TYPE
  // ============================================================================
  describe('Ticket', () => {
    it('should have id, status, priority, and assignee', () => {
      const ticket: Ticket = {
        id: 'ticket-001',
        status: 'open',
        priority: 'medium',
        assignee: { id: 'sam', name: 'Sam' },
        conversationId: 'conv-123',
        createdAt: new Date(),
      }

      expect(ticket.id).toBe('ticket-001')
      expect(ticket.status).toBe('open')
      expect(ticket.priority).toBe('medium')
      expect(ticket.assignee?.id).toBe('sam')
      expect(ticket.conversationId).toBe('conv-123')
    })

    it('should have status as open | pending | resolved', () => {
      const openTicket: Ticket = {
        id: 't1',
        status: 'open',
        priority: 'low',
        conversationId: 'c1',
        createdAt: new Date(),
      }
      const pendingTicket: Ticket = {
        id: 't2',
        status: 'pending',
        priority: 'medium',
        conversationId: 'c2',
        createdAt: new Date(),
      }
      const resolvedTicket: Ticket = {
        id: 't3',
        status: 'resolved',
        priority: 'high',
        conversationId: 'c3',
        createdAt: new Date(),
      }

      expect(openTicket.status).toBe('open')
      expect(pendingTicket.status).toBe('pending')
      expect(resolvedTicket.status).toBe('resolved')
    })

    it('should support priority levels', () => {
      const lowPriority: Ticket = {
        id: 't1',
        status: 'open',
        priority: 'low',
        conversationId: 'c1',
        createdAt: new Date(),
      }
      const mediumPriority: Ticket = {
        id: 't2',
        status: 'open',
        priority: 'medium',
        conversationId: 'c2',
        createdAt: new Date(),
      }
      const highPriority: Ticket = {
        id: 't3',
        status: 'open',
        priority: 'high',
        conversationId: 'c3',
        createdAt: new Date(),
      }
      const urgentPriority: Ticket = {
        id: 't4',
        status: 'open',
        priority: 'urgent',
        conversationId: 'c4',
        createdAt: new Date(),
      }

      expect(lowPriority.priority).toBe('low')
      expect(mediumPriority.priority).toBe('medium')
      expect(highPriority.priority).toBe('high')
      expect(urgentPriority.priority).toBe('urgent')
    })

    it('should support optional subject and description', () => {
      const ticket: Ticket = {
        id: 'ticket-001',
        status: 'open',
        priority: 'high',
        subject: 'Cannot access account',
        description: 'User reports login issues',
        conversationId: 'conv-123',
        createdAt: new Date(),
      }

      expect(ticket.subject).toBe('Cannot access account')
      expect(ticket.description).toBe('User reports login issues')
    })
  })

  // ============================================================================
  // ESCALATION TRIGGER TYPE
  // ============================================================================
  describe('EscalationTrigger', () => {
    it('should have type as sentiment | loops | explicit | value', () => {
      const sentimentTrigger: EscalationTrigger = { type: 'sentiment', threshold: -0.5 }
      const loopsTrigger: EscalationTrigger = { type: 'loops', threshold: 3 }
      const explicitTrigger: EscalationTrigger = { type: 'explicit', threshold: true }
      const valueTrigger: EscalationTrigger = { type: 'value', threshold: 10000 }

      expect(sentimentTrigger.type).toBe('sentiment')
      expect(loopsTrigger.type).toBe('loops')
      expect(explicitTrigger.type).toBe('explicit')
      expect(valueTrigger.type).toBe('value')
    })

    it('should have threshold value', () => {
      const sentimentTrigger: EscalationTrigger = { type: 'sentiment', threshold: -0.5 }
      const loopsTrigger: EscalationTrigger = { type: 'loops', threshold: 3 }

      expect(sentimentTrigger.threshold).toBe(-0.5)
      expect(loopsTrigger.threshold).toBe(3)
    })

    it('should support optional description', () => {
      const trigger: EscalationTrigger = {
        type: 'sentiment',
        threshold: -0.7,
        description: 'Escalate when customer sentiment drops below -0.7',
      }

      expect(trigger.description).toBe('Escalate when customer sentiment drops below -0.7')
    })
  })

  // ============================================================================
  // SUPPORT CONFIG TYPE
  // ============================================================================
  describe('SupportConfig', () => {
    it('should have default agent, topics map, and escalation triggers', () => {
      const config: SupportConfig = {
        default: { id: 'sam', name: 'Sam' },
        topics: {
          billing: { id: 'finn', name: 'Finn' },
          technical: { id: 'ralph', name: 'Ralph' },
        },
        escalation: {
          sentiment: -0.5,
          loops: 3,
          explicit: true,
        },
      }

      expect(config.default.id).toBe('sam')
      expect(config.topics.billing?.id).toBe('finn')
      expect(config.topics.technical?.id).toBe('ralph')
      expect(config.escalation.sentiment).toBe(-0.5)
      expect(config.escalation.loops).toBe(3)
      expect(config.escalation.explicit).toBe(true)
    })

    it('should match the design doc pattern', () => {
      // This test verifies the config matches the design doc example
      const sam = { id: 'sam', name: 'Sam' }
      const finn = { id: 'finn', name: 'Finn' }
      const ralph = { id: 'ralph', name: 'Ralph' }

      const support: SupportConfig = {
        default: sam,
        topics: {
          billing: finn,
          technical: ralph,
        },
        escalation: {
          sentiment: -0.5,
          loops: 3,
          explicit: true,
        },
      }

      expect(support.default).toBe(sam)
      expect(support.topics['billing']).toBe(finn)
      expect(support.topics['technical']).toBe(ralph)
      expect(support.escalation.sentiment).toBe(-0.5)
      expect(support.escalation.loops).toBe(3)
      expect(support.escalation.explicit).toBe(true)
    })

    it('should support optional value-based escalation', () => {
      const config: SupportConfig = {
        default: { id: 'sam', name: 'Sam' },
        topics: {},
        escalation: {
          sentiment: -0.5,
          loops: 3,
          explicit: true,
          value: 10000, // Escalate for high-value customers/transactions
        },
      }

      expect(config.escalation.value).toBe(10000)
    })

    it('should support optional human escalation target', () => {
      const config: SupportConfig = {
        default: { id: 'sam', name: 'Sam' },
        topics: {},
        escalation: {
          sentiment: -0.5,
          loops: 3,
          explicit: true,
        },
        humanEscalation: {
          role: 'support-lead',
          sla: '4 hours',
        },
      }

      expect(config.humanEscalation?.role).toBe('support-lead')
      expect(config.humanEscalation?.sla).toBe('4 hours')
    })
  })

  // ============================================================================
  // CUSTOMER TYPE
  // ============================================================================
  describe('Customer', () => {
    it('should have id, name, and email', () => {
      const customer: Customer = {
        id: 'cust-123',
        name: 'John Doe',
        email: 'john@example.com',
      }

      expect(customer.id).toBe('cust-123')
      expect(customer.name).toBe('John Doe')
      expect(customer.email).toBe('john@example.com')
    })

    it('should support optional metadata', () => {
      const customer: Customer = {
        id: 'cust-123',
        name: 'John Doe',
        email: 'john@example.com',
        metadata: { plan: 'enterprise', value: 50000 },
      }

      expect(customer.metadata?.plan).toBe('enterprise')
      expect(customer.metadata?.value).toBe(50000)
    })
  })

  // ============================================================================
  // AGENT TYPE
  // ============================================================================
  describe('Agent', () => {
    it('should have id and name', () => {
      const agent: Agent = {
        id: 'sam',
        name: 'Sam',
      }

      expect(agent.id).toBe('sam')
      expect(agent.name).toBe('Sam')
    })

    it('should support optional specialties', () => {
      const agent: Agent = {
        id: 'finn',
        name: 'Finn',
        specialties: ['billing', 'payments', 'subscriptions'],
      }

      expect(agent.specialties).toContain('billing')
      expect(agent.specialties).toContain('payments')
    })
  })
})
