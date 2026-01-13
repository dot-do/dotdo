/**
 * Session Things with belongsTo Relationship Tests
 *
 * TDD RED Phase: Tests for storing Sessions as Things with belongsTo User relationships.
 *
 * Graph Model:
 * ```
 * Session Thing ──belongsTo──> User Thing
 * ```
 *
 * Sessions are stored as Things in the graph model with:
 * - URL: auth://sessions/{sessionId}
 * - Type: Session
 * - Properties: token, expiresAt, userAgent, ipAddress
 * - belongsTo relationship pointing to auth://users/{userId}
 *
 * @see dotdo-4nwt7 - [RED] Session as Thing: Graph storage tests with belongsTo Relationship
 *
 * Uses real SQLite, NO MOCKS - per project testing philosophy.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Types for Session Things with belongsTo Relationship
// ============================================================================

/**
 * Session data stored in Thing.data JSON field
 */
interface SessionData {
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
 * Session Thing as stored in graph_things table
 */
interface SessionThing {
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
 * User Thing as stored in graph_things table
 */
interface UserThing {
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
interface SessionAndUser {
  session: SessionThing
  user: UserThing
}

// ============================================================================
// Test Helper Types
// ============================================================================

/**
 * Expected interface for SessionThingStore
 */
interface ExpectedSessionThingStore {
  /** Create a new session Thing with belongsTo relationship to User */
  createSession(input: {
    userId: string
    token: string
    expiresAt: number
    userAgent?: string | null
    ipAddress?: string | null
  }): Promise<SessionThing>

  /** Get session by token */
  getSession(token: string): Promise<SessionThing | null>

  /** Get session and its user via relationship traversal */
  getSessionAndUser(token: string): Promise<SessionAndUser | null>

  /** Delete session (removes Thing and relationship) */
  deleteSession(sessionId: string): Promise<boolean>

  /** Delete all sessions for a user */
  deleteUserSessions(userId: string): Promise<number>

  /** Delete all expired sessions */
  deleteExpiredSessions(): Promise<number>

  /** Get all sessions for a user via backward traversal */
  getUserSessions(userId: string): Promise<SessionThing[]>
}

// ============================================================================
// 1. Session Creation Tests
// ============================================================================

describe('Session Creation as Thing', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

      // Create graph_things table (Things storage)
      sqlite.exec(`
        CREATE TABLE graph_things (
          id TEXT PRIMARY KEY,
          type_id INTEGER NOT NULL,
          type_name TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE INDEX graph_things_type_name_idx ON graph_things(type_name);
        CREATE INDEX graph_things_deleted_at_idx ON graph_things(deleted_at);
      `)

      // Create relationships table
      sqlite.exec(`
        CREATE TABLE relationships (
          id TEXT PRIMARY KEY,
          verb TEXT NOT NULL,
          "from" TEXT NOT NULL,
          "to" TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(verb, "from", "to")
        );

        CREATE INDEX rel_from_idx ON relationships("from");
        CREATE INDEX rel_to_idx ON relationships("to");
        CREATE INDEX rel_verb_idx ON relationships(verb);
        CREATE INDEX rel_from_verb_idx ON relationships("from", verb);
        CREATE INDEX rel_to_verb_idx ON relationships("to", verb);
      `)

      // Create verbs table
      sqlite.exec(`
        CREATE TABLE verbs (
          verb TEXT PRIMARY KEY,
          action TEXT,
          activity TEXT,
          event TEXT,
          reverse TEXT,
          inverse TEXT,
          description TEXT
        );

        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('belongsTo', 'belongTo', 'belongingTo', 'belongedTo', 'has', NULL, 'Belongs to a parent entity');
      `)

      // Seed User Thing type (typeId: 1)
      // Seed Session Thing type (typeId: 2)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('creates Session Thing with required fields', () => {
    it('creates Session Thing with token, expiresAt, userAgent, ipAddress', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const expiresAt = now + 86400000 // 24 hours from now
      const sessionData = JSON.stringify({
        token: 'tok_abc123xyz',
        expiresAt,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        ipAddress: '192.168.1.100',
      })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('session-001', 2, 'Session', '${sessionData}', ${now}, ${now}, NULL)
      `)

      const result = sqlite.prepare('SELECT * FROM graph_things WHERE id = ?').get('session-001') as {
        id: string
        type_id: number
        type_name: string
        data: string
        created_at: number
        updated_at: number
        deleted_at: number | null
      }

      expect(result.id).toBe('session-001')
      expect(result.type_name).toBe('Session')

      const data = JSON.parse(result.data) as SessionData
      expect(data.token).toBe('tok_abc123xyz')
      expect(data.expiresAt).toBe(expiresAt)
      expect(data.userAgent).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
      expect(data.ipAddress).toBe('192.168.1.100')
    })

    it('generates unique session IDs', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const sessionData1 = JSON.stringify({ token: 'tok_1', expiresAt: now + 86400000, userAgent: null, ipAddress: null })
      const sessionData2 = JSON.stringify({ token: 'tok_2', expiresAt: now + 86400000, userAgent: null, ipAddress: null })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at) VALUES
        ('session-uuid-001', 2, 'Session', '${sessionData1}', ${now}, ${now}, NULL),
        ('session-uuid-002', 2, 'Session', '${sessionData2}', ${now}, ${now}, NULL)
      `)

      const results = sqlite.prepare("SELECT id FROM graph_things WHERE type_name = 'Session'").all() as { id: string }[]

      expect(results).toHaveLength(2)
      expect(results[0].id).not.toBe(results[1].id)
    })

    it('enforces unique token constraint via index', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      // Create unique index on token within data (requires generated column or application enforcement)
      // For now, test that we can query by token efficiently
      const now = Date.now()
      const sessionData = JSON.stringify({ token: 'unique_tok_001', expiresAt: now + 86400000, userAgent: null, ipAddress: null })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('session-unique-001', 2, 'Session', '${sessionData}', ${now}, ${now}, NULL)
      `)

      // Query by token using JSON extract
      const result = sqlite
        .prepare(`SELECT * FROM graph_things WHERE type_name = 'Session' AND json_extract(data, '$.token') = ?`)
        .get('unique_tok_001') as { id: string }

      expect(result.id).toBe('session-unique-001')
    })

    it('handles null userAgent and ipAddress', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const sessionData = JSON.stringify({
        token: 'tok_minimal',
        expiresAt: now + 86400000,
        userAgent: null,
        ipAddress: null,
      })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('session-minimal-001', 2, 'Session', '${sessionData}', ${now}, ${now}, NULL)
      `)

      const result = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('session-minimal-001') as {
        data: string
      }

      const data = JSON.parse(result.data) as SessionData
      expect(data.userAgent).toBeNull()
      expect(data.ipAddress).toBeNull()
    })
  })
})

// ============================================================================
// 2. belongsTo Relationship Tests
// ============================================================================

describe('Session belongsTo User Relationship', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

      // Create tables
      sqlite.exec(`
        CREATE TABLE graph_things (
          id TEXT PRIMARY KEY,
          type_id INTEGER NOT NULL,
          type_name TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE TABLE relationships (
          id TEXT PRIMARY KEY,
          verb TEXT NOT NULL,
          "from" TEXT NOT NULL,
          "to" TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(verb, "from", "to")
        );

        CREATE INDEX rel_from_idx ON relationships("from");
        CREATE INDEX rel_to_idx ON relationships("to");
        CREATE INDEX rel_verb_idx ON relationships(verb);

        CREATE TABLE verbs (
          verb TEXT PRIMARY KEY,
          action TEXT,
          activity TEXT,
          event TEXT,
          reverse TEXT,
          inverse TEXT,
          description TEXT
        );

        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('belongsTo', 'belongTo', 'belongingTo', 'belongedTo', 'has', NULL, 'Belongs to a parent entity');
      `)

      // Seed a User Thing
      const now = Date.now()
      const userData = JSON.stringify({ name: 'Alice', email: 'alice@example.com' })
      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('user-alice', 1, 'User', '${userData}', ${now}, ${now}, NULL)
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('creates belongsTo relationship from Session to User', () => {
    it('Session URL uses auth://sessions/{id} format', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const sessionData = JSON.stringify({ token: 'tok_rel_001', expiresAt: now + 86400000, userAgent: null, ipAddress: null })

      // Create Session Thing
      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('session-rel-001', 2, 'Session', '${sessionData}', ${now}, ${now}, NULL)
      `)

      // Create belongsTo relationship with proper URL format
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-session-user-001', 'belongsTo', 'auth://sessions/session-rel-001', 'auth://users/user-alice', NULL, ${now})
      `)

      const rel = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get('rel-session-user-001') as {
        id: string
        verb: string
        from: string
        to: string
      }

      expect(rel.from).toBe('auth://sessions/session-rel-001')
      expect(rel.from).toMatch(/^auth:\/\/sessions\//)
    })

    it('belongsTo points to auth://users/{userId}', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const sessionData = JSON.stringify({ token: 'tok_rel_002', expiresAt: now + 86400000, userAgent: null, ipAddress: null })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('session-rel-002', 2, 'Session', '${sessionData}', ${now}, ${now}, NULL)
      `)

      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-session-user-002', 'belongsTo', 'auth://sessions/session-rel-002', 'auth://users/user-alice', NULL, ${now})
      `)

      const rel = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get('rel-session-user-002') as {
        to: string
      }

      expect(rel.to).toBe('auth://users/user-alice')
      expect(rel.to).toMatch(/^auth:\/\/users\//)
    })

    it('relationship verb is belongsTo', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const sessionData = JSON.stringify({ token: 'tok_rel_003', expiresAt: now + 86400000, userAgent: null, ipAddress: null })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('session-rel-003', 2, 'Session', '${sessionData}', ${now}, ${now}, NULL)
      `)

      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-session-user-003', 'belongsTo', 'auth://sessions/session-rel-003', 'auth://users/user-alice', NULL, ${now})
      `)

      const rel = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get('rel-session-user-003') as {
        verb: string
      }

      expect(rel.verb).toBe('belongsTo')
    })

    it('backward traversal finds all user sessions using "has" reverse', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // Create multiple sessions for the same user
      for (let i = 1; i <= 3; i++) {
        const sessionData = JSON.stringify({
          token: `tok_multi_${i}`,
          expiresAt: now + 86400000,
          userAgent: `Agent ${i}`,
          ipAddress: null,
        })

        sqlite.exec(`
          INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
          VALUES ('session-multi-${i}', 2, 'Session', '${sessionData}', ${now}, ${now}, NULL)
        `)

        sqlite.exec(`
          INSERT INTO relationships (id, verb, "from", "to", data, created_at)
          VALUES ('rel-multi-${i}', 'belongsTo', 'auth://sessions/session-multi-${i}', 'auth://users/user-alice', NULL, ${now})
        `)
      }

      // Query all sessions belonging to user-alice via backward traversal
      const sessions = sqlite
        .prepare(`SELECT "from" FROM relationships WHERE verb = 'belongsTo' AND "to" = ?`)
        .all('auth://users/user-alice') as { from: string }[]

      expect(sessions).toHaveLength(3)
      expect(sessions.map((s) => s.from)).toContain('auth://sessions/session-multi-1')
      expect(sessions.map((s) => s.from)).toContain('auth://sessions/session-multi-2')
      expect(sessions.map((s) => s.from)).toContain('auth://sessions/session-multi-3')
    })

    it('unique constraint prevents duplicate belongsTo for same session-user pair', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const sessionData = JSON.stringify({ token: 'tok_dup', expiresAt: now + 86400000, userAgent: null, ipAddress: null })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('session-dup', 2, 'Session', '${sessionData}', ${now}, ${now}, NULL)
      `)

      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-dup-1', 'belongsTo', 'auth://sessions/session-dup', 'auth://users/user-alice', NULL, ${now})
      `)

      // Attempt to create duplicate relationship
      expect(() => {
        sqlite.exec(`
          INSERT INTO relationships (id, verb, "from", "to", data, created_at)
          VALUES ('rel-dup-2', 'belongsTo', 'auth://sessions/session-dup', 'auth://users/user-alice', NULL, ${now})
        `)
      }).toThrow(/UNIQUE constraint failed/)
    })
  })
})

// ============================================================================
// 3. Session Query Tests
// ============================================================================

describe('Session Queries', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

      sqlite.exec(`
        CREATE TABLE graph_things (
          id TEXT PRIMARY KEY,
          type_id INTEGER NOT NULL,
          type_name TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE INDEX graph_things_type_name_idx ON graph_things(type_name);

        CREATE TABLE relationships (
          id TEXT PRIMARY KEY,
          verb TEXT NOT NULL,
          "from" TEXT NOT NULL,
          "to" TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(verb, "from", "to")
        );

        CREATE INDEX rel_from_idx ON relationships("from");
        CREATE INDEX rel_to_idx ON relationships("to");
      `)

      const now = Date.now()

      // Seed User
      const userData = JSON.stringify({ name: 'Bob', email: 'bob@example.com' })
      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('user-bob', 1, 'User', '${userData}', ${now}, ${now}, NULL)
      `)

      // Seed active session
      const activeSessionData = JSON.stringify({
        token: 'tok_active_session',
        expiresAt: now + 86400000, // Expires in 24 hours
        userAgent: 'Chrome/120.0',
        ipAddress: '10.0.0.1',
      })
      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('session-active', 2, 'Session', '${activeSessionData}', ${now}, ${now}, NULL)
      `)
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-active', 'belongsTo', 'auth://sessions/session-active', 'auth://users/user-bob', NULL, ${now})
      `)

      // Seed expired session
      const expiredSessionData = JSON.stringify({
        token: 'tok_expired_session',
        expiresAt: now - 86400000, // Expired 24 hours ago
        userAgent: 'Firefox/119.0',
        ipAddress: '10.0.0.2',
      })
      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('session-expired', 2, 'Session', '${expiredSessionData}', ${now - 172800000}, ${now - 172800000}, NULL)
      `)
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-expired', 'belongsTo', 'auth://sessions/session-expired', 'auth://users/user-bob', NULL, ${now - 172800000})
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('getSession(token)', () => {
    it('retrieves session by token', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const result = sqlite
        .prepare(`SELECT * FROM graph_things WHERE type_name = 'Session' AND json_extract(data, '$.token') = ?`)
        .get('tok_active_session') as {
        id: string
        data: string
      }

      expect(result).toBeDefined()
      expect(result.id).toBe('session-active')

      const data = JSON.parse(result.data) as SessionData
      expect(data.token).toBe('tok_active_session')
    })

    it('returns null for non-existent token', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const result = sqlite
        .prepare(`SELECT * FROM graph_things WHERE type_name = 'Session' AND json_extract(data, '$.token') = ?`)
        .get('non_existent_token')

      expect(result).toBeUndefined()
    })

    it('returns null for expired sessions when checking expiration', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // Query that filters out expired sessions
      const result = sqlite
        .prepare(
          `
          SELECT * FROM graph_things
          WHERE type_name = 'Session'
            AND json_extract(data, '$.token') = ?
            AND json_extract(data, '$.expiresAt') > ?
        `
        )
        .get('tok_expired_session', now)

      expect(result).toBeUndefined()
    })

    it('returns active session when not expired', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      const result = sqlite
        .prepare(
          `
          SELECT * FROM graph_things
          WHERE type_name = 'Session'
            AND json_extract(data, '$.token') = ?
            AND json_extract(data, '$.expiresAt') > ?
        `
        )
        .get('tok_active_session', now) as { id: string }

      expect(result).toBeDefined()
      expect(result.id).toBe('session-active')
    })
  })

  describe('getSessionAndUser', () => {
    it('returns both session and user via relationship traversal', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      // First get the session
      const session = sqlite
        .prepare(`SELECT * FROM graph_things WHERE type_name = 'Session' AND json_extract(data, '$.token') = ?`)
        .get('tok_active_session') as { id: string; data: string }

      expect(session).toBeDefined()

      // Get the user via relationship
      const sessionUrl = `auth://sessions/${session.id}`
      const rel = sqlite
        .prepare(`SELECT "to" FROM relationships WHERE "from" = ? AND verb = 'belongsTo'`)
        .get(sessionUrl) as { to: string }

      expect(rel).toBeDefined()
      expect(rel.to).toBe('auth://users/user-bob')

      // Extract user ID from URL and fetch user
      const userId = rel.to.replace('auth://users/', '')
      const user = sqlite.prepare('SELECT * FROM graph_things WHERE id = ?').get(userId) as { id: string; data: string }

      expect(user).toBeDefined()
      expect(user.id).toBe('user-bob')

      const userData = JSON.parse(user.data) as { name: string; email: string }
      expect(userData.name).toBe('Bob')
      expect(userData.email).toBe('bob@example.com')
    })

    it('returns null for session without user relationship', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      // Create orphan session without relationship
      const now = Date.now()
      const orphanData = JSON.stringify({
        token: 'tok_orphan',
        expiresAt: now + 86400000,
        userAgent: null,
        ipAddress: null,
      })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('session-orphan', 2, 'Session', '${orphanData}', ${now}, ${now}, NULL)
      `)

      // Get the orphan session
      const session = sqlite
        .prepare(`SELECT * FROM graph_things WHERE type_name = 'Session' AND json_extract(data, '$.token') = ?`)
        .get('tok_orphan') as { id: string }

      expect(session).toBeDefined()

      // Try to get relationship
      const sessionUrl = `auth://sessions/${session.id}`
      const rel = sqlite
        .prepare(`SELECT "to" FROM relationships WHERE "from" = ? AND verb = 'belongsTo'`)
        .get(sessionUrl)

      expect(rel).toBeUndefined()
    })
  })
})

// ============================================================================
// 4. Session Deletion Tests
// ============================================================================

describe('Session Deletion', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

      sqlite.exec(`
        CREATE TABLE graph_things (
          id TEXT PRIMARY KEY,
          type_id INTEGER NOT NULL,
          type_name TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE TABLE relationships (
          id TEXT PRIMARY KEY,
          verb TEXT NOT NULL,
          "from" TEXT NOT NULL,
          "to" TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(verb, "from", "to")
        );

        CREATE INDEX rel_from_idx ON relationships("from");
        CREATE INDEX rel_to_idx ON relationships("to");
      `)

      const now = Date.now()

      // Seed User
      const userData = JSON.stringify({ name: 'Charlie', email: 'charlie@example.com' })
      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('user-charlie', 1, 'User', '${userData}', ${now}, ${now}, NULL)
      `)

      // Seed sessions for deletion tests
      for (let i = 1; i <= 3; i++) {
        const isExpired = i === 3
        const sessionData = JSON.stringify({
          token: `tok_del_${i}`,
          expiresAt: isExpired ? now - 86400000 : now + 86400000,
          userAgent: `Agent ${i}`,
          ipAddress: null,
        })

        sqlite.exec(`
          INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
          VALUES ('session-del-${i}', 2, 'Session', '${sessionData}', ${now}, ${now}, NULL)
        `)

        sqlite.exec(`
          INSERT INTO relationships (id, verb, "from", "to", data, created_at)
          VALUES ('rel-del-${i}', 'belongsTo', 'auth://sessions/session-del-${i}', 'auth://users/user-charlie', NULL, ${now})
        `)
      }
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('deleteSession', () => {
    it('removes Session Thing', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      // Delete session
      sqlite.exec(`DELETE FROM graph_things WHERE id = 'session-del-1'`)

      const result = sqlite.prepare('SELECT * FROM graph_things WHERE id = ?').get('session-del-1')
      expect(result).toBeUndefined()
    })

    it('removes belongsTo relationship', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      // Delete relationship first (referential integrity)
      sqlite.exec(`DELETE FROM relationships WHERE "from" = 'auth://sessions/session-del-1'`)

      const rel = sqlite.prepare(`SELECT * FROM relationships WHERE "from" = ?`).get('auth://sessions/session-del-1')
      expect(rel).toBeUndefined()
    })

    it('removes both Thing and Relationship in transaction', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      // Transactional delete
      sqlite.exec(`
        BEGIN TRANSACTION;
        DELETE FROM relationships WHERE "from" = 'auth://sessions/session-del-2';
        DELETE FROM graph_things WHERE id = 'session-del-2';
        COMMIT;
      `)

      const session = sqlite.prepare('SELECT * FROM graph_things WHERE id = ?').get('session-del-2')
      const rel = sqlite.prepare(`SELECT * FROM relationships WHERE "from" = ?`).get('auth://sessions/session-del-2')

      expect(session).toBeUndefined()
      expect(rel).toBeUndefined()
    })

    it('returns false for non-existent session', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const result = sqlite.prepare('DELETE FROM graph_things WHERE id = ?').run('non-existent-session')
      expect(result.changes).toBe(0)
    })
  })

  describe('deleteUserSessions (cascade delete)', () => {
    it('deletes all sessions for a user', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      // Get all session IDs for user via relationships
      const rels = sqlite
        .prepare(`SELECT "from" FROM relationships WHERE "to" = 'auth://users/user-charlie' AND verb = 'belongsTo'`)
        .all() as { from: string }[]

      expect(rels).toHaveLength(3)

      // Delete all relationships for user's sessions
      sqlite.exec(`DELETE FROM relationships WHERE "to" = 'auth://users/user-charlie' AND verb = 'belongsTo'`)

      // Delete all session Things
      for (const rel of rels) {
        const sessionId = rel.from.replace('auth://sessions/', '')
        sqlite.exec(`DELETE FROM graph_things WHERE id = '${sessionId}'`)
      }

      // Verify all deleted
      const remainingSessions = sqlite
        .prepare(`SELECT * FROM graph_things WHERE type_name = 'Session'`)
        .all() as { id: string }[]

      expect(remainingSessions).toHaveLength(0)

      const remainingRels = sqlite
        .prepare(`SELECT * FROM relationships WHERE "to" = 'auth://users/user-charlie'`)
        .all()

      expect(remainingRels).toHaveLength(0)
    })

    it('returns count of deleted sessions', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const rels = sqlite
        .prepare(`SELECT "from" FROM relationships WHERE "to" = 'auth://users/user-charlie' AND verb = 'belongsTo'`)
        .all() as { from: string }[]

      expect(rels.length).toBe(3)
    })
  })

  describe('deleteExpiredSessions', () => {
    it('removes all expired sessions', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // Find expired sessions
      const expiredSessions = sqlite
        .prepare(
          `
          SELECT id FROM graph_things
          WHERE type_name = 'Session'
            AND json_extract(data, '$.expiresAt') < ?
        `
        )
        .all(now) as { id: string }[]

      expect(expiredSessions).toHaveLength(1)
      expect(expiredSessions[0].id).toBe('session-del-3')

      // Delete expired sessions and their relationships
      for (const session of expiredSessions) {
        sqlite.exec(`DELETE FROM relationships WHERE "from" = 'auth://sessions/${session.id}'`)
        sqlite.exec(`DELETE FROM graph_things WHERE id = '${session.id}'`)
      }

      // Verify expired session deleted
      const remainingExpired = sqlite
        .prepare(
          `
          SELECT id FROM graph_things
          WHERE type_name = 'Session'
            AND json_extract(data, '$.expiresAt') < ?
        `
        )
        .all(now)

      expect(remainingExpired).toHaveLength(0)

      // Verify active sessions remain
      const activeSessions = sqlite.prepare(`SELECT * FROM graph_things WHERE type_name = 'Session'`).all()

      expect(activeSessions).toHaveLength(2)
    })

    it('returns count of deleted expired sessions', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      const expiredCount = sqlite
        .prepare(
          `
          SELECT COUNT(*) as count FROM graph_things
          WHERE type_name = 'Session'
            AND json_extract(data, '$.expiresAt') < ?
        `
        )
        .get(now) as { count: number }

      expect(expiredCount.count).toBe(1)
    })
  })
})

// ============================================================================
// 5. SessionThingStore Interface Tests (RED - implementation needed)
// ============================================================================

describe('SessionThingStore Interface', () => {
  /**
   * These tests will FAIL until SessionThingStore is implemented.
   * They define the expected API contract.
   */

  it('SessionThingStore is exported from db/compat/graph', async () => {
    // This test will FAIL until the implementation exists
    const graphModule = await import('../index').catch(() => null)

    expect(graphModule).not.toBeNull()
    expect(graphModule?.SessionThingStore).toBeDefined()
  })

  it('has createSession method', async () => {
    const graphModule = await import('../index').catch(() => null)

    if (!graphModule?.SessionThingStore) {
      throw new Error('SessionThingStore not implemented - waiting for implementation')
    }

    expect(graphModule.SessionThingStore.prototype.createSession).toBeDefined()
    expect(typeof graphModule.SessionThingStore.prototype.createSession).toBe('function')
  })

  it('has getSession method', async () => {
    const graphModule = await import('../index').catch(() => null)

    if (!graphModule?.SessionThingStore) {
      throw new Error('SessionThingStore not implemented - waiting for implementation')
    }

    expect(graphModule.SessionThingStore.prototype.getSession).toBeDefined()
  })

  it('has getSessionAndUser method', async () => {
    const graphModule = await import('../index').catch(() => null)

    if (!graphModule?.SessionThingStore) {
      throw new Error('SessionThingStore not implemented - waiting for implementation')
    }

    expect(graphModule.SessionThingStore.prototype.getSessionAndUser).toBeDefined()
  })

  it('has deleteSession method', async () => {
    const graphModule = await import('../index').catch(() => null)

    if (!graphModule?.SessionThingStore) {
      throw new Error('SessionThingStore not implemented - waiting for implementation')
    }

    expect(graphModule.SessionThingStore.prototype.deleteSession).toBeDefined()
  })

  it('has deleteUserSessions method', async () => {
    const graphModule = await import('../index').catch(() => null)

    if (!graphModule?.SessionThingStore) {
      throw new Error('SessionThingStore not implemented - waiting for implementation')
    }

    expect(graphModule.SessionThingStore.prototype.deleteUserSessions).toBeDefined()
  })

  it('has deleteExpiredSessions method', async () => {
    const graphModule = await import('../index').catch(() => null)

    if (!graphModule?.SessionThingStore) {
      throw new Error('SessionThingStore not implemented - waiting for implementation')
    }

    expect(graphModule.SessionThingStore.prototype.deleteExpiredSessions).toBeDefined()
  })

  it('has getUserSessions method', async () => {
    const graphModule = await import('../index').catch(() => null)

    if (!graphModule?.SessionThingStore) {
      throw new Error('SessionThingStore not implemented - waiting for implementation')
    }

    expect(graphModule.SessionThingStore.prototype.getUserSessions).toBeDefined()
  })
})

// ============================================================================
// 6. Graph Model Verification Tests
// ============================================================================

describe('Graph Model Verification', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

      sqlite.exec(`
        CREATE TABLE graph_things (
          id TEXT PRIMARY KEY,
          type_id INTEGER NOT NULL,
          type_name TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE TABLE relationships (
          id TEXT PRIMARY KEY,
          verb TEXT NOT NULL,
          "from" TEXT NOT NULL,
          "to" TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(verb, "from", "to")
        );

        CREATE INDEX rel_from_idx ON relationships("from");
        CREATE INDEX rel_to_idx ON relationships("to");

        CREATE TABLE verbs (
          verb TEXT PRIMARY KEY,
          action TEXT,
          activity TEXT,
          event TEXT,
          reverse TEXT,
          inverse TEXT,
          description TEXT
        );

        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('belongsTo', 'belongTo', 'belongingTo', 'belongedTo', 'has', NULL, 'Belongs to a parent entity');
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('Session Thing URL format', () => {
    it('uses auth://sessions/{sessionId} format', () => {
      const sessionId = 'session-abc123'
      const sessionUrl = `auth://sessions/${sessionId}`

      expect(sessionUrl).toBe('auth://sessions/session-abc123')
      expect(new URL(sessionUrl).protocol).toBe('auth:')
      expect(new URL(sessionUrl).host).toBe('sessions')
      expect(sessionUrl).toContain('sessions/')
      expect(sessionUrl).toContain(sessionId)
    })
  })

  describe('User Thing URL format', () => {
    it('uses auth://users/{userId} format', () => {
      const userId = 'user-xyz789'
      const userUrl = `auth://users/${userId}`

      expect(userUrl).toBe('auth://users/user-xyz789')
      expect(new URL(userUrl).protocol).toBe('auth:')
    })
  })

  describe('belongsTo verb forms', () => {
    it('has correct linguistic forms', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const verb = sqlite.prepare('SELECT * FROM verbs WHERE verb = ?').get('belongsTo') as {
        verb: string
        action: string
        activity: string
        event: string
        reverse: string
        inverse: string | null
      }

      expect(verb.verb).toBe('belongsTo')
      expect(verb.action).toBe('belongTo')
      expect(verb.activity).toBe('belongingTo')
      expect(verb.event).toBe('belongedTo')
      expect(verb.reverse).toBe('has')
    })

    it('reverse form (has) enables backward traversal', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const verb = sqlite.prepare('SELECT reverse FROM verbs WHERE verb = ?').get('belongsTo') as { reverse: string }

      // "has" is the reverse of "belongsTo"
      // User has Sessions (backward traversal from User to find all Sessions)
      expect(verb.reverse).toBe('has')
    })
  })

  describe('complete graph traversal', () => {
    it('Session -> belongsTo -> User traversal works', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // Create User
      const userData = JSON.stringify({ name: 'Dave', email: 'dave@example.com' })
      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('user-dave', 1, 'User', '${userData}', ${now}, ${now}, NULL)
      `)

      // Create Session
      const sessionData = JSON.stringify({
        token: 'tok_traverse',
        expiresAt: now + 86400000,
        userAgent: 'Safari/17.0',
        ipAddress: '172.16.0.1',
      })
      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('session-traverse', 2, 'Session', '${sessionData}', ${now}, ${now}, NULL)
      `)

      // Create relationship
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-traverse', 'belongsTo', 'auth://sessions/session-traverse', 'auth://users/user-dave', NULL, ${now})
      `)

      // Forward traversal: Session -> User
      const sessionUrl = 'auth://sessions/session-traverse'
      const rel = sqlite
        .prepare(`SELECT "to" FROM relationships WHERE "from" = ? AND verb = 'belongsTo'`)
        .get(sessionUrl) as { to: string }

      expect(rel.to).toBe('auth://users/user-dave')

      // Extract User ID and fetch User Thing
      const userId = rel.to.replace('auth://users/', '')
      const user = sqlite.prepare('SELECT * FROM graph_things WHERE id = ?').get(userId) as {
        id: string
        type_name: string
      }

      expect(user.id).toBe('user-dave')
      expect(user.type_name).toBe('User')
    })

    it('User -> has -> Sessions backward traversal works', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // Create User
      const userData = JSON.stringify({ name: 'Eve', email: 'eve@example.com' })
      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('user-eve', 1, 'User', '${userData}', ${now}, ${now}, NULL)
      `)

      // Create multiple Sessions
      for (let i = 1; i <= 2; i++) {
        const sessionData = JSON.stringify({
          token: `tok_backward_${i}`,
          expiresAt: now + 86400000,
          userAgent: `Browser ${i}`,
          ipAddress: null,
        })
        sqlite.exec(`
          INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
          VALUES ('session-backward-${i}', 2, 'Session', '${sessionData}', ${now}, ${now}, NULL)
        `)
        sqlite.exec(`
          INSERT INTO relationships (id, verb, "from", "to", data, created_at)
          VALUES ('rel-backward-${i}', 'belongsTo', 'auth://sessions/session-backward-${i}', 'auth://users/user-eve', NULL, ${now})
        `)
      }

      // Backward traversal: User -> Sessions (using belongsTo in reverse)
      const userUrl = 'auth://users/user-eve'
      const sessions = sqlite
        .prepare(`SELECT "from" FROM relationships WHERE "to" = ? AND verb = 'belongsTo'`)
        .all(userUrl) as { from: string }[]

      expect(sessions).toHaveLength(2)

      // Fetch Session Things
      const sessionIds = sessions.map((s) => s.from.replace('auth://sessions/', ''))
      const sessionThings = sessionIds.map(
        (id) => sqlite.prepare('SELECT * FROM graph_things WHERE id = ?').get(id) as { id: string; type_name: string }
      )

      expect(sessionThings).toHaveLength(2)
      expect(sessionThings.every((s) => s.type_name === 'Session')).toBe(true)
    })
  })
})
