/**
 * Support System Module
 *
 * Exports types and utilities for AI agent-driven customer support.
 */

export type {
  Agent,
  Customer,
  Message,
  MessageRole,
  Conversation,
  Ticket,
  TicketStatus,
  TicketPriority,
  EscalationTrigger,
  EscalationTriggerType,
  EscalationSettings,
  HumanEscalationTarget,
  SupportConfig,
} from './types'

// ChatBox integration
export {
  createChatBox,
  detectTopic,
  type ChatBox,
  type ChatBoxConfig,
  type ChatBoxMessage,
  type ChatBoxSession,
  type ChatBoxEvents,
  type SessionContext,
  type EscalationCheckResult,
} from './chatbox'

// Topic-based routing
export {
  createRouter,
  createAITopicDetector,
  type TopicDetector,
  type TopicDetectionResult,
  type Router,
  type RouterResult,
  type RouterOptions,
  type AIClassifier,
  type AITopicDetectorOptions,
} from './routing'
