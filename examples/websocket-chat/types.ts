// WebSocket Chat Example - Type definitions

/**
 * A chat room
 */
export interface Room {
  $type: 'Room'
  name: string
  description?: string
  isPrivate: boolean
  maxMembers?: number
  createdBy: string
  createdAt: string
}

/**
 * A chat participant
 */
export interface Participant {
  $type: 'Participant'
  roomId: string
  userId: string
  userName: string
  avatar?: string
  role: 'owner' | 'moderator' | 'member'
  joinedAt: string
  lastSeenAt?: string
}

/**
 * A chat message
 */
export interface ChatMessage {
  $type: 'ChatMessage'
  roomId: string
  userId: string
  userName: string
  content: string
  type: 'text' | 'system' | 'image' | 'file'
  replyTo?: string
  editedAt?: string
  createdAt: string
}

/**
 * Typing indicator state
 */
export interface TypingState {
  userId: string
  userName: string
  startedAt: string
}

// ============================================================================
// WebSocket Message Types
// ============================================================================

/**
 * Base WebSocket message
 */
export interface WSMessage {
  type: string
  [key: string]: unknown
}

/**
 * Client -> Server: Join a room
 */
export interface JoinRoomMessage {
  type: 'join'
  roomId: string
  userId: string
  userName: string
  avatar?: string
}

/**
 * Client -> Server: Leave a room
 */
export interface LeaveRoomMessage {
  type: 'leave'
  roomId: string
  userId: string
}

/**
 * Client -> Server: Send a message
 */
export interface SendMessage {
  type: 'message'
  roomId: string
  content: string
  replyTo?: string
}

/**
 * Client -> Server: Edit a message
 */
export interface EditMessage {
  type: 'edit'
  messageId: string
  content: string
}

/**
 * Client -> Server: Delete a message
 */
export interface DeleteMessage {
  type: 'delete'
  messageId: string
}

/**
 * Client -> Server: Typing indicator
 */
export interface TypingMessage {
  type: 'typing'
  roomId: string
  isTyping: boolean
}

/**
 * Server -> Client: Room state
 */
export interface RoomStateMessage {
  type: 'room_state'
  room: Room
  participants: Array<{
    userId: string
    userName: string
    avatar?: string
    role: Participant['role']
    online: boolean
  }>
  recentMessages: ChatMessage[]
}

/**
 * Server -> Client: New message
 */
export interface NewMessageEvent {
  type: 'new_message'
  message: ChatMessage
}

/**
 * Server -> Client: Message edited
 */
export interface MessageEditedEvent {
  type: 'message_edited'
  messageId: string
  content: string
  editedAt: string
}

/**
 * Server -> Client: Message deleted
 */
export interface MessageDeletedEvent {
  type: 'message_deleted'
  messageId: string
}

/**
 * Server -> Client: User joined
 */
export interface UserJoinedEvent {
  type: 'user_joined'
  userId: string
  userName: string
  avatar?: string
}

/**
 * Server -> Client: User left
 */
export interface UserLeftEvent {
  type: 'user_left'
  userId: string
  userName: string
}

/**
 * Server -> Client: Typing indicator
 */
export interface TypingEvent {
  type: 'typing_update'
  users: Array<{
    userId: string
    userName: string
  }>
}

/**
 * Server -> Client: Error
 */
export interface ErrorEvent {
  type: 'error'
  code: string
  message: string
}

/**
 * Server -> Client: Acknowledgment
 */
export interface AckEvent {
  type: 'ack'
  id?: string
  messageId?: string
}
