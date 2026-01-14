/**
 * Support System Type Definitions
 *
 * Types for conversations, tickets, escalation triggers, and support configuration.
 * Designed to integrate with ChatBox components and AI agent-driven customer support.
 */

// ============================================================================
// AGENT & CUSTOMER TYPES
// ============================================================================

/**
 * AI Agent or human support representative
 */
export interface Agent {
  /** Unique agent identifier */
  id: string
  /** Display name */
  name: string
  /** Optional list of topic specialties */
  specialties?: string[]
}

/**
 * Customer in a support conversation
 */
export interface Customer {
  /** Unique customer identifier */
  id: string
  /** Customer name */
  name: string
  /** Customer email */
  email: string
  /** Optional metadata (plan, value, etc.) */
  metadata?: Record<string, unknown>
}

// ============================================================================
// MESSAGE TYPE
// ============================================================================

/**
 * Role of the message sender
 */
export type MessageRole = 'agent' | 'customer' | 'system'

/**
 * A single message in a support conversation
 */
export interface Message {
  /** Who sent the message */
  role: MessageRole
  /** Message content */
  content: string
  /** When the message was sent */
  timestamp: Date
}

// ============================================================================
// CONVERSATION TYPE
// ============================================================================

/**
 * A support conversation with a customer
 */
export interface Conversation {
  /** Unique conversation identifier */
  id: string
  /** Messages in the conversation */
  messages: Message[]
  /** Customer in this conversation */
  customer: Customer
  /** Current agent handling the conversation */
  agent: Agent
  /** When the conversation started */
  startedAt: Date
  /** Optional metadata (source, topic, etc.) */
  metadata?: Record<string, unknown>
}

// ============================================================================
// TICKET TYPE
// ============================================================================

/**
 * Ticket status
 */
export type TicketStatus = 'open' | 'pending' | 'resolved'

/**
 * Ticket priority level
 */
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent'

/**
 * A support ticket linked to a conversation
 */
export interface Ticket {
  /** Unique ticket identifier */
  id: string
  /** Current ticket status */
  status: TicketStatus
  /** Priority level */
  priority: TicketPriority
  /** Associated conversation ID */
  conversationId: string
  /** When the ticket was created */
  createdAt: Date
  /** Optional ticket subject */
  subject?: string
  /** Optional ticket description */
  description?: string
  /** Optional assigned agent */
  assignee?: Agent
}

// ============================================================================
// ESCALATION TRIGGER TYPE
// ============================================================================

/**
 * Types of escalation triggers
 */
export type EscalationTriggerType = 'sentiment' | 'loops' | 'explicit' | 'value'

/**
 * Configuration for when to escalate to a human
 */
export interface EscalationTrigger {
  /** Type of trigger */
  type: EscalationTriggerType
  /** Threshold value for triggering escalation */
  threshold: number | boolean
  /** Optional description of the trigger */
  description?: string
}

// ============================================================================
// SUPPORT CONFIG TYPE
// ============================================================================

/**
 * Escalation settings for automatic human escalation
 */
export interface EscalationSettings {
  /** Sentiment score threshold (e.g., -0.5 means escalate when sentiment drops below -0.5) */
  sentiment: number
  /** Number of conversation loops before escalating */
  loops: number
  /** Whether to escalate on explicit customer request */
  explicit: boolean
  /** Optional value threshold (e.g., escalate for high-value customers) */
  value?: number
}

/**
 * Human escalation target configuration
 */
export interface HumanEscalationTarget {
  /** Role to escalate to (e.g., 'support-lead', 'manager') */
  role: string
  /** SLA for human response (e.g., '4 hours') */
  sla: string
}

/**
 * Support system configuration
 *
 * @example
 * ```typescript
 * const support: SupportConfig = {
 *   default: sam,
 *   topics: {
 *     billing: finn,
 *     technical: ralph,
 *   },
 *   escalation: {
 *     sentiment: -0.5,
 *     loops: 3,
 *     explicit: true,
 *   },
 * }
 * ```
 */
export interface SupportConfig {
  /** Default agent for handling conversations */
  default: Agent
  /** Topic-specific agent routing */
  topics: Record<string, Agent | undefined>
  /** Escalation trigger settings */
  escalation: EscalationSettings
  /** Optional human escalation target */
  humanEscalation?: HumanEscalationTarget
}
