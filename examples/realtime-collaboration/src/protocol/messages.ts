/**
 * Protocol Message Types
 *
 * All messages are JSON-encoded for simplicity.
 * In production, consider using binary encoding (MessagePack, Protocol Buffers)
 * for better performance.
 */

import type { Operation } from '../crdt/operations'
import type { ItemId } from '../crdt/id'

// ============================================================================
// Base Message Types
// ============================================================================

export type MessageType =
  // Connection
  | 'connect'
  | 'connected'
  | 'disconnect'
  | 'ping'
  | 'pong'
  | 'error'
  // Document sync
  | 'sync:request'
  | 'sync:response'
  | 'sync:update'
  | 'sync:ack'
  // Presence
  | 'presence:join'
  | 'presence:leave'
  | 'presence:update'
  | 'presence:sync'
  // Cursor
  | 'cursor:update'
  | 'cursor:sync'
  // Channel
  | 'channel:subscribe'
  | 'channel:unsubscribe'
  | 'channel:message'
  | 'channel:history'
  | 'channel:typing'
  // Whiteboard
  | 'whiteboard:draw'
  | 'whiteboard:update'
  | 'whiteboard:delete'
  | 'whiteboard:lock'
  | 'whiteboard:unlock'
  | 'whiteboard:sync'

export interface BaseMessage {
  type: MessageType
  id?: string // Optional message ID for acknowledgment
  timestamp?: number
}

// ============================================================================
// Connection Messages
// ============================================================================

export interface ConnectMessage extends BaseMessage {
  type: 'connect'
  clientId: string
  documentId?: string
  channelId?: string
  auth?: {
    token: string
    userId?: string
  }
}

export interface ConnectedMessage extends BaseMessage {
  type: 'connected'
  clientId: string
  sessionId: string
  serverTime: number
}

export interface DisconnectMessage extends BaseMessage {
  type: 'disconnect'
  reason?: string
}

export interface PingMessage extends BaseMessage {
  type: 'ping'
}

export interface PongMessage extends BaseMessage {
  type: 'pong'
  serverTime: number
}

export interface ErrorMessage extends BaseMessage {
  type: 'error'
  code: string
  message: string
  details?: unknown
}

// ============================================================================
// Document Sync Messages
// ============================================================================

export interface SyncRequestMessage extends BaseMessage {
  type: 'sync:request'
  documentId: string
  stateVector: Record<string, number> // Client's vector clock
}

export interface SyncResponseMessage extends BaseMessage {
  type: 'sync:response'
  documentId: string
  state: string // Encoded document state
  version: number
  stateVector: Record<string, number>
}

export interface SyncUpdateMessage extends BaseMessage {
  type: 'sync:update'
  documentId: string
  operations: Operation[]
  origin: string
  version: number
}

export interface SyncAckMessage extends BaseMessage {
  type: 'sync:ack'
  documentId: string
  version: number
  receivedOperations: number
}

// ============================================================================
// Presence Messages
// ============================================================================

export interface PresenceUser {
  clientId: string
  userId?: string
  name?: string
  avatar?: string
  color?: string
  status: 'online' | 'away' | 'busy'
  lastSeen: number
  metadata?: Record<string, unknown>
}

export interface PresenceJoinMessage extends BaseMessage {
  type: 'presence:join'
  user: PresenceUser
  roomId: string
}

export interface PresenceLeaveMessage extends BaseMessage {
  type: 'presence:leave'
  clientId: string
  roomId: string
}

export interface PresenceUpdateMessage extends BaseMessage {
  type: 'presence:update'
  clientId: string
  roomId: string
  updates: Partial<PresenceUser>
}

export interface PresenceSyncMessage extends BaseMessage {
  type: 'presence:sync'
  roomId: string
  users: PresenceUser[]
}

// ============================================================================
// Cursor Messages
// ============================================================================

export interface CursorPosition {
  clientId: string
  documentId: string
  // Text cursor
  index?: number
  length?: number // Selection length
  // Canvas cursor
  x?: number
  y?: number
  // Metadata
  color?: string
  name?: string
}

export interface CursorUpdateMessage extends BaseMessage {
  type: 'cursor:update'
  cursor: CursorPosition
}

export interface CursorSyncMessage extends BaseMessage {
  type: 'cursor:sync'
  documentId: string
  cursors: CursorPosition[]
}

// ============================================================================
// Channel Messages
// ============================================================================

export interface ChannelMessage {
  id: string
  channelId: string
  senderId: string
  senderName?: string
  content: string
  type: 'text' | 'system' | 'action'
  timestamp: number
  replyTo?: string
  metadata?: Record<string, unknown>
}

export interface ChannelSubscribeMessage extends BaseMessage {
  type: 'channel:subscribe'
  channelId: string
  lastMessageId?: string // For resuming from last seen
}

export interface ChannelUnsubscribeMessage extends BaseMessage {
  type: 'channel:unsubscribe'
  channelId: string
}

export interface ChannelMessageMessage extends BaseMessage {
  type: 'channel:message'
  message: ChannelMessage
}

export interface ChannelHistoryMessage extends BaseMessage {
  type: 'channel:history'
  channelId: string
  messages: ChannelMessage[]
  hasMore: boolean
  oldestId?: string
}

export interface ChannelTypingMessage extends BaseMessage {
  type: 'channel:typing'
  channelId: string
  clientId: string
  isTyping: boolean
}

// ============================================================================
// Whiteboard Messages
// ============================================================================

export type ShapeType = 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'path' | 'text' | 'sticky' | 'image'

export interface Shape {
  id: string
  type: ShapeType
  x: number
  y: number
  width?: number
  height?: number
  points?: Array<{ x: number; y: number }>
  rotation?: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  text?: string
  fontSize?: number
  fontFamily?: string
  opacity?: number
  locked?: boolean
  lockedBy?: string
  createdBy: string
  createdAt: number
  updatedAt: number
  zIndex: number
}

export interface WhiteboardDrawMessage extends BaseMessage {
  type: 'whiteboard:draw'
  boardId: string
  shape: Shape
}

export interface WhiteboardUpdateMessage extends BaseMessage {
  type: 'whiteboard:update'
  boardId: string
  shapeId: string
  updates: Partial<Shape>
}

export interface WhiteboardDeleteMessage extends BaseMessage {
  type: 'whiteboard:delete'
  boardId: string
  shapeIds: string[]
}

export interface WhiteboardLockMessage extends BaseMessage {
  type: 'whiteboard:lock'
  boardId: string
  shapeId: string
  clientId: string
}

export interface WhiteboardUnlockMessage extends BaseMessage {
  type: 'whiteboard:unlock'
  boardId: string
  shapeId: string
}

export interface WhiteboardSyncMessage extends BaseMessage {
  type: 'whiteboard:sync'
  boardId: string
  shapes: Shape[]
  cursors: CursorPosition[]
}

// ============================================================================
// Union Type
// ============================================================================

export type Message =
  // Connection
  | ConnectMessage
  | ConnectedMessage
  | DisconnectMessage
  | PingMessage
  | PongMessage
  | ErrorMessage
  // Sync
  | SyncRequestMessage
  | SyncResponseMessage
  | SyncUpdateMessage
  | SyncAckMessage
  // Presence
  | PresenceJoinMessage
  | PresenceLeaveMessage
  | PresenceUpdateMessage
  | PresenceSyncMessage
  // Cursor
  | CursorUpdateMessage
  | CursorSyncMessage
  // Channel
  | ChannelSubscribeMessage
  | ChannelUnsubscribeMessage
  | ChannelMessageMessage
  | ChannelHistoryMessage
  | ChannelTypingMessage
  // Whiteboard
  | WhiteboardDrawMessage
  | WhiteboardUpdateMessage
  | WhiteboardDeleteMessage
  | WhiteboardLockMessage
  | WhiteboardUnlockMessage
  | WhiteboardSyncMessage

// ============================================================================
// Message Factories
// ============================================================================

let messageIdCounter = 0

function generateMessageId(): string {
  return `msg_${Date.now()}_${++messageIdCounter}`
}

export function createMessage<T extends Message>(msg: Omit<T, 'id' | 'timestamp'> & Partial<Pick<T, 'id' | 'timestamp'>>): T {
  return {
    ...msg,
    id: msg.id ?? generateMessageId(),
    timestamp: msg.timestamp ?? Date.now(),
  } as T
}

export function createConnectMessage(clientId: string, options?: { documentId?: string; channelId?: string; auth?: { token: string; userId?: string } }): ConnectMessage {
  return createMessage<ConnectMessage>({
    type: 'connect',
    clientId,
    ...options,
  })
}

export function createSyncUpdateMessage(documentId: string, operations: Operation[], origin: string, version: number): SyncUpdateMessage {
  return createMessage<SyncUpdateMessage>({
    type: 'sync:update',
    documentId,
    operations,
    origin,
    version,
  })
}

export function createPresenceUpdateMessage(clientId: string, roomId: string, updates: Partial<PresenceUser>): PresenceUpdateMessage {
  return createMessage<PresenceUpdateMessage>({
    type: 'presence:update',
    clientId,
    roomId,
    updates,
  })
}

export function createCursorUpdateMessage(cursor: CursorPosition): CursorUpdateMessage {
  return createMessage<CursorUpdateMessage>({
    type: 'cursor:update',
    cursor,
  })
}

export function createChannelMessageMessage(message: ChannelMessage): ChannelMessageMessage {
  return createMessage<ChannelMessageMessage>({
    type: 'channel:message',
    message,
  })
}

export function createWhiteboardDrawMessage(boardId: string, shape: Shape): WhiteboardDrawMessage {
  return createMessage<WhiteboardDrawMessage>({
    type: 'whiteboard:draw',
    boardId,
    shape,
  })
}

export function createErrorMessage(code: string, message: string, details?: unknown): ErrorMessage {
  return createMessage<ErrorMessage>({
    type: 'error',
    code,
    message,
    details,
  })
}
