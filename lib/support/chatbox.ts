/**
 * MDXUI ChatBox Integration
 *
 * Agent-first support system that connects ChatBox components to named agents.
 * Supports topic-based routing, conversation context, and escalation.
 *
 * @example
 * ```typescript
 * import { sam, finn, sally } from 'agents.do'
 * import { createChatBox } from './chatbox'
 *
 * const chatbox = createChatBox({
 *   default: sam,
 *   topics: {
 *     billing: finn,
 *     sales: sally,
 *   },
 *   escalation: {
 *     sentiment: -0.5,
 *     loops: 3,
 *     explicit: true,
 *   },
 * })
 *
 * // Sam handles all support by default
 * // Topic routing via natural language
 * ```
 *
 * @see dotdo-crtzx - TDD: MDXUI ChatBox integration
 * @module lib/support/chatbox
 */

import type {
  Agent,
  Customer,
  Message,
  SupportConfig,
  EscalationSettings,
  HumanEscalationTarget,
} from './types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * ChatBox configuration extending SupportConfig
 */
export interface ChatBoxConfig extends SupportConfig {
  /** Optional callback for generating agent responses */
  responseGenerator?: (agent: Agent, messages: Message[], context: SessionContext) => Promise<string>
}

/**
 * Message in a ChatBox session
 */
export interface ChatBoxMessage extends Message {
  /** Optional agent ID who sent the message */
  agentId?: string
}

/**
 * Context maintained throughout a conversation session
 */
export interface SessionContext {
  /** Number of conversation loops (repeated similar questions) */
  loopCount: number
  /** Customer's plan (from metadata) */
  customerPlan?: string
  /** Customer's value (from metadata) */
  customerValue?: number
  /** Current conversation topic */
  currentTopic?: string
  /** Additional custom context */
  [key: string]: unknown
}

/**
 * A ChatBox conversation session
 */
export interface ChatBoxSession {
  /** Unique session identifier */
  id: string
  /** Customer in this session */
  customer: Customer
  /** Current agent handling the session */
  agent: Agent
  /** Messages in the session */
  messages: ChatBoxMessage[]
  /** When the session started */
  startedAt: Date
  /** Session context for routing and escalation */
  context: SessionContext
  /** Optional metadata (source, page, etc.) */
  metadata?: Record<string, unknown>
}

/**
 * Event types emitted by ChatBox
 */
export interface ChatBoxEvents {
  messageReceived: { session: ChatBoxSession; message: ChatBoxMessage }
  messageResponse: { session: ChatBoxSession; message: ChatBoxMessage }
  agentChange: {
    session: ChatBoxSession
    previousAgent: Agent
    newAgent: Agent
    reason: string
  }
  escalation: {
    session: ChatBoxSession
    trigger: 'sentiment' | 'loops' | 'explicit' | 'value'
    target: HumanEscalationTarget
  }
}

/**
 * Event handler type
 */
type EventHandler<T> = (data: T) => void

/**
 * Escalation check result
 */
export interface EscalationCheckResult {
  shouldEscalate: boolean
  reason?: 'sentiment' | 'loops' | 'explicit' | 'value'
}

/**
 * ChatBox instance
 */
export interface ChatBox {
  /** Default agent for handling conversations */
  defaultAgent: Agent
  /** Topic-specific agent routing */
  topics: Record<string, Agent | undefined>
  /** Escalation settings */
  escalation: EscalationSettings
  /** Human escalation target (if configured) */
  humanEscalation?: HumanEscalationTarget

  /** Create a new session for a customer */
  createSession(customer: Customer, metadata?: Record<string, unknown>): ChatBoxSession

  /** Handle an incoming message */
  handleMessage(session: ChatBoxSession, content: string): Promise<void>

  /** Check if a message should trigger escalation */
  shouldEscalate(content: string, session: ChatBoxSession): EscalationCheckResult

  /** Register event handler */
  on<K extends keyof ChatBoxEvents>(event: K, handler: EventHandler<ChatBoxEvents[K]>): void

  /** Remove event handler */
  off<K extends keyof ChatBoxEvents>(event: K, handler: EventHandler<ChatBoxEvents[K]>): void
}

// ============================================================================
// TOPIC DETECTION
// ============================================================================

/**
 * Keywords for detecting conversation topics
 */
const TOPIC_KEYWORDS: Record<string, string[]> = {
  billing: [
    'invoice',
    'payment',
    'refund',
    'subscription',
    'charge',
    'billing',
    'receipt',
    'credit',
    'debit',
    'transaction',
    'renewal',
    'cancel subscription',
  ],
  sales: [
    'pricing',
    'price',
    'plan',
    'plans',
    'upgrade',
    'demo',
    'enterprise',
    'discount',
    'quote',
    'purchase',
    'buy',
    'trial',
    'features',
    'compare',
  ],
  technical: [
    'api',
    'error',
    'bug',
    'crash',
    'integrate',
    'integration',
    'sdk',
    'code',
    'developer',
    'documentation',
    'endpoint',
    '500',
    '404',
    'timeout',
    'server',
    'broken',
  ],
  financial: [
    'budget',
    'cost',
    'expense',
    'roi',
    'revenue',
    'profit',
    'finance',
    'accounting',
    'tax',
  ],
}

/**
 * Detect the topic of a message based on keywords
 *
 * @param content - Message content to analyze
 * @returns Detected topic or null if no specific topic found
 */
export function detectTopic(content: string): string | null {
  const lowerContent = content.toLowerCase()

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerContent.includes(keyword.toLowerCase())) {
        return topic
      }
    }
  }

  return null
}

// ============================================================================
// ESCALATION DETECTION
// ============================================================================

/**
 * Phrases that explicitly request human assistance
 */
const EXPLICIT_ESCALATION_PHRASES = [
  'speak to a human',
  'talk to a human',
  'real person',
  'talk to a real',
  'speak to a real',
  'transfer me',
  'manager',
  'supervisor',
  'speak with support',
  'talk to support',
  'connect me to',
  'human agent',
  'live agent',
  'real agent',
  'person please',
  'human please',
]

/**
 * Check if content contains explicit escalation request
 */
function isExplicitEscalationRequest(content: string): boolean {
  const lowerContent = content.toLowerCase()
  return EXPLICIT_ESCALATION_PHRASES.some(phrase => lowerContent.includes(phrase))
}

// ============================================================================
// RESPONSE GENERATION
// ============================================================================

/**
 * Default response generator (mock for testing)
 */
async function defaultResponseGenerator(
  agent: Agent,
  messages: Message[],
  context: SessionContext
): Promise<string> {
  // In a real implementation, this would call the agent's template literal function
  // For testing, return a mock response
  return `[${agent.name}] Thank you for your message. How can I assist you further?`
}

// ============================================================================
// SESSION ID GENERATION
// ============================================================================

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `sess-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

// ============================================================================
// CHATBOX FACTORY
// ============================================================================

/**
 * Create a ChatBox instance with the given configuration
 *
 * @example
 * ```typescript
 * import { sam, finn, sally } from 'agents.do'
 *
 * const chatbox = createChatBox({
 *   default: sam,
 *   topics: {
 *     billing: finn,
 *     sales: sally,
 *   },
 *   escalation: {
 *     sentiment: -0.5,
 *     loops: 3,
 *     explicit: true,
 *   },
 * })
 *
 * const session = chatbox.createSession(customer)
 * await chatbox.handleMessage(session, 'I have a billing question')
 * // Agent automatically routes to finn
 * ```
 *
 * @param config - ChatBox configuration
 * @returns ChatBox instance
 */
export function createChatBox(config: ChatBoxConfig): ChatBox {
  const {
    default: defaultAgent,
    topics,
    escalation,
    humanEscalation,
    responseGenerator = defaultResponseGenerator,
  } = config

  // Event handlers storage
  const eventHandlers: Map<keyof ChatBoxEvents, Set<EventHandler<unknown>>> = new Map()

  /**
   * Emit an event to all registered handlers
   */
  function emit<K extends keyof ChatBoxEvents>(event: K, data: ChatBoxEvents[K]): void {
    const handlers = eventHandlers.get(event)
    if (handlers) {
      handlers.forEach(handler => handler(data))
    }
  }

  /**
   * Route to the appropriate agent based on topic
   */
  function routeToAgent(session: ChatBoxSession, topic: string | null): void {
    if (topic && topics[topic]) {
      const newAgent = topics[topic]!
      if (newAgent.id !== session.agent.id) {
        const previousAgent = session.agent
        session.agent = newAgent
        session.context.currentTopic = topic
        emit('agentChange', {
          session,
          previousAgent,
          newAgent,
          reason: `topic:${topic}`,
        })
      }
    }
  }

  /**
   * Check if escalation should be triggered
   */
  function checkEscalation(content: string, session: ChatBoxSession): EscalationCheckResult {
    // Check explicit escalation request
    if (escalation.explicit && isExplicitEscalationRequest(content)) {
      return { shouldEscalate: true, reason: 'explicit' }
    }

    // Check loop count
    if (session.context.loopCount >= escalation.loops) {
      return { shouldEscalate: true, reason: 'loops' }
    }

    // Check customer value threshold
    if (
      escalation.value !== undefined &&
      session.context.customerValue !== undefined &&
      session.context.customerValue >= escalation.value
    ) {
      return { shouldEscalate: true, reason: 'value' }
    }

    return { shouldEscalate: false }
  }

  const chatbox: ChatBox = {
    defaultAgent,
    topics,
    escalation,
    humanEscalation,

    createSession(customer: Customer, metadata?: Record<string, unknown>): ChatBoxSession {
      return {
        id: generateSessionId(),
        customer,
        agent: defaultAgent,
        messages: [],
        startedAt: new Date(),
        context: {
          loopCount: 0,
          customerPlan: customer.metadata?.plan as string | undefined,
          customerValue: customer.metadata?.value as number | undefined,
        },
        metadata,
      }
    },

    async handleMessage(session: ChatBoxSession, content: string): Promise<void> {
      // Create customer message
      const customerMessage: ChatBoxMessage = {
        role: 'customer',
        content,
        timestamp: new Date(),
      }

      // Add to session
      session.messages.push(customerMessage)

      // Emit messageReceived event
      emit('messageReceived', { session, message: customerMessage })

      // Detect topic and route if needed
      const topic = detectTopic(content)
      routeToAgent(session, topic)

      // Check for escalation
      const escalationCheck = checkEscalation(content, session)
      if (escalationCheck.shouldEscalate && humanEscalation) {
        emit('escalation', {
          session,
          trigger: escalationCheck.reason!,
          target: humanEscalation,
        })
      }

      // Generate agent response
      const responseContent = await responseGenerator(
        session.agent,
        session.messages.map(m => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        })),
        session.context
      )

      // Create agent message
      const agentMessage: ChatBoxMessage = {
        role: 'agent',
        content: responseContent,
        timestamp: new Date(),
        agentId: session.agent.id,
      }

      // Add to session
      session.messages.push(agentMessage)

      // Emit messageResponse event
      emit('messageResponse', { session, message: agentMessage })
    },

    shouldEscalate(content: string, session: ChatBoxSession): EscalationCheckResult {
      return checkEscalation(content, session)
    },

    on<K extends keyof ChatBoxEvents>(event: K, handler: EventHandler<ChatBoxEvents[K]>): void {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, new Set())
      }
      eventHandlers.get(event)!.add(handler as EventHandler<unknown>)
    },

    off<K extends keyof ChatBoxEvents>(event: K, handler: EventHandler<ChatBoxEvents[K]>): void {
      const handlers = eventHandlers.get(event)
      if (handlers) {
        handlers.delete(handler as EventHandler<unknown>)
      }
    },
  }

  return chatbox
}

// ============================================================================
// EXPORTS
// ============================================================================

export type { Agent, Customer, Message, SupportConfig } from './types'
