/**
 * Conversation State Machine - XState v5
 *
 * DO-backed durable state machine for conversation lifecycle management.
 * Supports multi-channel conversations with persistence and timeouts.
 */

export * from './types.js'
export { Conversation, defaultConversationConfig } from './conversation.js'
