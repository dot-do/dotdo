/**
 * SessionThingStore - Session storage using Graph Things and Relationships
 *
 * GREEN PHASE: Implements Session as Thing with belongsTo User relationships.
 *
 * @see dotdo-qb7wd - [GREEN] Session as Thing: Implementation
 *
 * Design:
 * - Sessions are stored as Things with typeName: 'Session'
 * - URL scheme: auth://sessions/{sessionId}
 * - belongsTo relationship connects Session -> User
 * - Supports session expiration filtering
 * - Uses GraphStore interface (NO MOCKS)
 *
 * Graph Model:
 * ```
 * Session Thing ──belongsTo──> User Thing
 * auth://sessions/{id}        auth://users/{id}
 * ```
 */

import { randomUUID } from 'crypto'
import type { GraphStore, GraphThing } from '../../../graph/types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Session data stored in Thing.data JSON field
 */
export interface SessionData {
  /** Unique session token for authentication */
  token: string
  /** Unix timestamp (ms) when session expires */
  expiresAt: number
  /** User-Agent string from the client */
  userAgent: string | null
  /** IP address of the client */
  ipAddress: string | null
  /** When the session was last accessed */
  lastAccessedAt?: number
}

/**
 * Session Thing as returned from the store
 */
export interface SessionThing {
  /** Thing ID (e.g., 'session-abc123') */
  id: string
  /** Type ID referencing Session noun */
  typeId: number
  /** Denormalized type name: 'Session' */
  typeName: string
  /** Session data payload */
  data: SessionData | null
  /** Unix timestamp (ms) when created */
  createdAt: number
  /** Unix timestamp (ms) when last updated */
  updatedAt: number
  /** Unix timestamp (ms) when soft deleted, null if active */
  deletedAt: number | null
}

/**
 * User Thing as returned from the store
 */
export interface UserThing {
  /** Thing ID (e.g., 'user-xyz789') */
  id: string
  /** Type ID referencing User noun */
  typeId: number
  /** Denormalized type name: 'User' */
  typeName: string
  /** User data payload */
  data: Record<string, unknown> | null
  /** Unix timestamp (ms) when created */
  createdAt: number
  /** Unix timestamp (ms) when last updated */
  updatedAt: number
  /** Unix timestamp (ms) when soft deleted, null if active */
  deletedAt: number | null
}

/**
 * Session with its associated User (from relationship traversal)
 */
export interface SessionAndUser {
  session: SessionThing
  user: UserThing
}

/**
 * Input for creating a new session
 */
export interface CreateSessionInput {
  /** User ID the session belongs to */
  userId: string
  /** Unique session token */
  token: string
  /** Expiration timestamp (ms) */
  expiresAt: number
  /** User-Agent string */
  userAgent?: string | null
  /** IP address */
  ipAddress?: string | null
}

// ============================================================================
// CONSTANTS
// ============================================================================

const TYPE_IDS = {
  User: 1,
  Session: 2,
} as const

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate URL for auth entity
 */
function authUrl(type: 'users' | 'sessions', id: string): string {
  return `auth://${type}/${id}`
}

/**
 * Extract ID from auth URL
 */
function extractId(url: string): string {
  const parts = url.split('/')
  return parts[parts.length - 1]!
}

/**
 * Convert GraphThing to SessionThing
 */
function toSessionThing(thing: GraphThing): SessionThing {
  return {
    id: thing.id,
    typeId: thing.typeId,
    typeName: thing.typeName,
    data: thing.data as unknown as SessionData | null,
    createdAt: thing.createdAt,
    updatedAt: thing.updatedAt,
    deletedAt: thing.deletedAt,
  }
}

/**
 * Convert GraphThing to UserThing
 */
function toUserThing(thing: GraphThing): UserThing {
  return {
    id: thing.id,
    typeId: thing.typeId,
    typeName: thing.typeName,
    data: thing.data as Record<string, unknown> | null,
    createdAt: thing.createdAt,
    updatedAt: thing.updatedAt,
    deletedAt: thing.deletedAt,
  }
}

// ============================================================================
// SessionThingStore CLASS
// ============================================================================

/**
 * SessionThingStore manages Session Things with belongsTo User relationships.
 *
 * Provides CRUD operations for sessions stored as graph Things, with
 * automatic relationship management for User association.
 *
 * @example
 * ```typescript
 * const store = new SQLiteGraphStore(':memory:')
 * await store.initialize()
 *
 * const sessionStore = new SessionThingStore(store)
 *
 * // Create a session
 * const session = await sessionStore.createSession({
 *   userId: 'user-alice',
 *   token: 'tok_abc123',
 *   expiresAt: Date.now() + 86400000,
 *   userAgent: 'Mozilla/5.0',
 *   ipAddress: '192.168.1.1',
 * })
 *
 * // Get session with user
 * const result = await sessionStore.getSessionAndUser('tok_abc123')
 * if (result) {
 *   console.log(result.session, result.user)
 * }
 *
 * // Delete user's sessions
 * const deleted = await sessionStore.deleteUserSessions('user-alice')
 * ```
 */
export class SessionThingStore {
  constructor(private store: GraphStore) {}

  // ==========================================================================
  // CREATE OPERATIONS
  // ==========================================================================

  /**
   * Create a new session Thing with belongsTo relationship to User.
   *
   * @param input - Session creation input
   * @returns The created SessionThing
   */
  async createSession(input: CreateSessionInput): Promise<SessionThing> {
    const id = randomUUID()
    const sessionData: SessionData = {
      token: input.token,
      expiresAt: input.expiresAt,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
    }

    // Create Session Thing
    const thing = await this.store.createThing({
      id,
      typeId: TYPE_IDS.Session,
      typeName: 'Session',
      data: sessionData as unknown as Record<string, unknown>,
    })

    // Create belongsTo relationship: Session -> User
    await this.store.createRelationship({
      id: randomUUID(),
      verb: 'belongsTo',
      from: authUrl('sessions', id),
      to: authUrl('users', input.userId),
    })

    return toSessionThing(thing)
  }

  // ==========================================================================
  // READ OPERATIONS
  // ==========================================================================

  /**
   * Get session by token.
   *
   * Returns null if:
   * - Token doesn't exist
   * - Session is expired
   * - Session is soft-deleted
   *
   * @param token - The session token
   * @returns The SessionThing or null
   */
  async getSession(token: string): Promise<SessionThing | null> {
    const sessions = await this.store.getThingsByType({ typeName: 'Session' })
    const now = Date.now()

    for (const session of sessions) {
      if (session.deletedAt !== null) continue

      const data = session.data as unknown as SessionData | null
      if (!data || data.token !== token) continue

      // Check if expired
      if (data.expiresAt <= now) continue

      return toSessionThing(session)
    }

    return null
  }

  /**
   * Get session and its user via relationship traversal.
   *
   * @param token - The session token
   * @returns SessionAndUser or null if not found
   */
  async getSessionAndUser(token: string): Promise<SessionAndUser | null> {
    const session = await this.getSession(token)
    if (!session) {
      return null
    }

    // Traverse belongsTo relationship to get User
    const sessionUrl = authUrl('sessions', session.id)
    const rels = await this.store.queryRelationshipsFrom(sessionUrl, { verb: 'belongsTo' })

    if (rels.length === 0) {
      return null
    }

    const userUrl = rels[0]!.to
    const userId = extractId(userUrl)
    const userThing = await this.store.getThing(userId)

    if (!userThing || userThing.typeName !== 'User' || userThing.deletedAt !== null) {
      return null
    }

    return {
      session,
      user: toUserThing(userThing),
    }
  }

  /**
   * Get all sessions for a user via backward traversal.
   *
   * @param userId - The user ID
   * @returns Array of SessionThings belonging to the user
   */
  async getUserSessions(userId: string): Promise<SessionThing[]> {
    const userUrl = authUrl('users', userId)
    const rels = await this.store.queryRelationshipsTo(userUrl, { verb: 'belongsTo' })

    const sessions: SessionThing[] = []
    const now = Date.now()

    for (const rel of rels) {
      // Check if this is a session
      if (!rel.from.startsWith('auth://sessions/')) continue

      const sessionId = extractId(rel.from)
      const thing = await this.store.getThing(sessionId)

      if (!thing || thing.typeName !== 'Session' || thing.deletedAt !== null) continue

      const data = thing.data as unknown as SessionData | null
      // Skip expired sessions
      if (data && data.expiresAt <= now) continue

      sessions.push(toSessionThing(thing))
    }

    return sessions
  }

  // ==========================================================================
  // DELETE OPERATIONS
  // ==========================================================================

  /**
   * Delete a session by ID.
   *
   * Removes both the Session Thing and its belongsTo relationship.
   *
   * @param sessionId - The session ID to delete
   * @returns true if deleted, false if not found
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const session = await this.store.getThing(sessionId)
    if (!session || session.typeName !== 'Session') {
      return false
    }

    // Delete relationships first
    const sessionUrl = authUrl('sessions', sessionId)
    const rels = await this.store.queryRelationshipsFrom(sessionUrl)
    for (const rel of rels) {
      await this.store.deleteRelationship(rel.id)
    }

    // Soft delete the session
    await this.store.deleteThing(sessionId)

    return true
  }

  /**
   * Delete all sessions for a user.
   *
   * @param userId - The user ID
   * @returns Number of sessions deleted
   */
  async deleteUserSessions(userId: string): Promise<number> {
    const userUrl = authUrl('users', userId)
    const rels = await this.store.queryRelationshipsTo(userUrl, { verb: 'belongsTo' })

    let count = 0

    for (const rel of rels) {
      if (!rel.from.startsWith('auth://sessions/')) continue

      const sessionId = extractId(rel.from)
      const thing = await this.store.getThing(sessionId)

      if (!thing || thing.typeName !== 'Session' || thing.deletedAt !== null) continue

      // Delete the relationship
      await this.store.deleteRelationship(rel.id)

      // Soft delete the session
      await this.store.deleteThing(sessionId)
      count++
    }

    return count
  }

  /**
   * Delete all expired sessions.
   *
   * @returns Number of expired sessions deleted
   */
  async deleteExpiredSessions(): Promise<number> {
    const sessions = await this.store.getThingsByType({ typeName: 'Session' })
    const now = Date.now()
    let count = 0

    for (const session of sessions) {
      if (session.deletedAt !== null) continue

      const data = session.data as unknown as SessionData | null
      if (!data || data.expiresAt >= now) continue

      // This session is expired - delete it
      const sessionUrl = authUrl('sessions', session.id)
      const rels = await this.store.queryRelationshipsFrom(sessionUrl)
      for (const rel of rels) {
        await this.store.deleteRelationship(rel.id)
      }

      await this.store.deleteThing(session.id)
      count++
    }

    return count
  }
}
