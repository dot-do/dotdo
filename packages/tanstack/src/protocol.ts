/**
 * Protocol types shared between server and client
 *
 * Defines the message format for WebSocket sync communication.
 */

// ============================================================================
// THING DATA - Minimal representation for sync
// ============================================================================

/**
 * Minimal Thing representation for sync messages.
 * Matches the core ThingData structure but simplified for wire format.
 */
export interface SyncThing {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
  meta?: Record<string, unknown>
  branch?: string | null
  createdAt: string // ISO timestamp
  updatedAt: string // ISO timestamp
  deletedAt?: string | null
}

// ============================================================================
// CLIENT -> SERVER MESSAGES
// ============================================================================

/**
 * Subscribe to a collection for real-time updates
 */
export interface SubscribeMessage {
  type: 'subscribe'
  collection: string
  branch?: string | null
  query?: QueryOptions
}

/**
 * Unsubscribe from a collection
 */
export interface UnsubscribeMessage {
  type: 'unsubscribe'
  collection: string
}

/**
 * Request sync from a specific transaction ID
 */
export interface SyncFromMessage {
  type: 'sync-from'
  collection: string
  branch?: string | null
  txid: number
}

/**
 * Query options for filtering/pagination
 */
export interface QueryOptions {
  limit?: number
  offset?: number
  orderBy?: {
    field: string
    direction: 'asc' | 'desc'
  }
  where?: Record<string, unknown>
}

export type ClientMessage = SubscribeMessage | UnsubscribeMessage | SyncFromMessage

// ============================================================================
// SERVER -> CLIENT MESSAGES
// ============================================================================

/**
 * Initial state message sent when client subscribes
 */
export interface InitialMessage {
  type: 'initial'
  collection: string
  branch?: string | null
  items: SyncThing[]
  txid: number // Max rowid in collection, used for subsequent sync
}

/**
 * Change message for a single thing operation
 */
export interface ChangeMessage {
  type: 'change'
  collection: string
  branch?: string | null
  txid: number // rowid of the change
  operation: 'insert' | 'update' | 'delete'
  thing?: SyncThing // Present for insert/update, absent for delete
  id?: string // Present for delete to identify which thing was deleted
}

/**
 * Acknowledgment of subscription
 */
export interface SubscribedMessage {
  type: 'subscribed'
  collection: string
  branch?: string | null
}

/**
 * Error message
 */
export interface ErrorMessage {
  type: 'error'
  code: string
  message: string
  collection?: string
}

export type ServerMessage = InitialMessage | ChangeMessage | SubscribedMessage | ErrorMessage

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Extract collection name from a $type URL
 * e.g., 'https://example.com/Task' -> 'Task'
 */
export function getCollectionFromType($type: string): string {
  try {
    const url = new URL($type)
    return url.pathname.slice(1) // Remove leading /
  } catch {
    // If not a URL, treat as plain collection name
    return $type
  }
}

/**
 * Serialize a thing for sync messages
 */
export function serializeThing(thing: {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
  meta?: Record<string, unknown>
  branch?: string | null
  createdAt: Date | string
  updatedAt: Date | string
  deletedAt?: Date | string | null
}): SyncThing {
  return {
    $id: thing.$id,
    $type: thing.$type,
    name: thing.name,
    data: thing.data,
    meta: thing.meta,
    branch: thing.branch ?? null,
    createdAt: thing.createdAt instanceof Date ? thing.createdAt.toISOString() : thing.createdAt,
    updatedAt: thing.updatedAt instanceof Date ? thing.updatedAt.toISOString() : thing.updatedAt,
    deletedAt: thing.deletedAt
      ? thing.deletedAt instanceof Date
        ? thing.deletedAt.toISOString()
        : thing.deletedAt
      : null,
  }
}
