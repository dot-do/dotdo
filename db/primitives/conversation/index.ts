/**
 * Conversation Primitives
 *
 * Provides conversation threading with message history, participant tracking,
 * thread hierarchy (parent/child threads), and read/unread tracking.
 *
 * @module db/primitives/conversation
 */

// Thread and Message models
export {
  createThreadManager,
  type Message,
  type MessageContent,
  type MessageRole,
  type Thread,
  type ThreadManager,
  type ThreadStatus,
  type CreateThreadOptions,
  type CreateMessageOptions,
  type PaginationOptions,
  type PaginatedResult,
  type ThreadFilterOptions,
} from './thread'

// State machine for conversation flow
export * from './state-machine'
