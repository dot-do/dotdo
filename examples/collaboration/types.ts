// Real-time collaboration example - Type definitions

/**
 * A collaborative document
 */
export interface Document {
  $type: 'Document'
  title: string
  content: string
  version: number
  lastEditedBy?: string
}

/**
 * A user participating in collaboration
 */
export interface Collaborator {
  $type: 'Collaborator'
  userId: string
  name: string
  color: string  // Cursor/selection color
  email?: string
  avatarUrl?: string
}

/**
 * Cursor position in the document
 */
export interface CursorPosition {
  userId: string
  position: number      // Character offset
  selection?: {
    start: number
    end: number
  }
  updatedAt: string
}

/**
 * Operation types for Operational Transformation (simplified)
 */
export type OperationType = 'insert' | 'delete' | 'retain'

/**
 * A single edit operation
 */
export interface Operation {
  type: OperationType
  position: number
  content?: string     // For insert
  length?: number      // For delete/retain
}

/**
 * A change event containing operations
 */
export interface DocumentChange {
  $type: 'DocumentChange'
  documentId: string
  userId: string
  version: number
  operations: Operation[]
  timestamp: string
}

/**
 * Edit session tracking who is actively editing
 */
export interface EditSession {
  $type: 'EditSession'
  documentId: string
  userId: string
  startedAt: string
  lastActivityAt: string
  status: 'active' | 'idle' | 'disconnected'
}

/**
 * Comment on the document
 */
export interface Comment {
  $type: 'Comment'
  documentId: string
  userId: string
  userName: string
  content: string
  position: {
    start: number
    end: number
  }
  resolved: boolean
  createdAt: string
  resolvedAt?: string
  resolvedBy?: string
}

// ============================================================================
// WebSocket Message Types
// ============================================================================

/**
 * Join document session
 */
export interface JoinMessage {
  type: 'join'
  documentId: string
  userId: string
  userName: string
}

/**
 * Leave document session
 */
export interface LeaveMessage {
  type: 'leave'
  documentId: string
  userId: string
}

/**
 * Document edit operation
 */
export interface EditMessage {
  type: 'edit'
  documentId: string
  userId: string
  operations: Operation[]
  baseVersion: number
}

/**
 * Cursor position update
 */
export interface CursorMessage {
  type: 'cursor'
  documentId: string
  userId: string
  position: number
  selection?: {
    start: number
    end: number
  }
}

/**
 * Request full document sync
 */
export interface SyncMessage {
  type: 'sync'
  documentId: string
}

/**
 * Presence update (who is online)
 */
export interface PresenceMessage {
  type: 'presence'
  documentId: string
  collaborators: Array<{
    userId: string
    name: string
    color: string
    cursor?: CursorPosition
  }>
}

/**
 * Document state broadcast
 */
export interface DocumentStateMessage {
  type: 'document'
  documentId: string
  title: string
  content: string
  version: number
}

/**
 * Error message
 */
export interface ErrorMessage {
  type: 'error'
  code: string
  message: string
}

/**
 * Acknowledgment of edit
 */
export interface AckMessage {
  type: 'ack'
  documentId: string
  version: number
}

/**
 * Union of all WebSocket message types
 */
export type WSMessage =
  | JoinMessage
  | LeaveMessage
  | EditMessage
  | CursorMessage
  | SyncMessage
  | PresenceMessage
  | DocumentStateMessage
  | ErrorMessage
  | AckMessage
