/**
 * Relationships Table Tests - Core Graph Schema
 *
 * TDD RED Phase: Tests for the Relationships table that validates Verb instance storage.
 *
 * The Relationships table stores edges in the DO graph model:
 * - verb: Reference to a Verb instance (from verbs table)
 * - from: Source URL (Thing URL within or across DOs)
 * - to: Target URL (Thing URL within or across DOs)
 * - data: JSON edge properties
 * - timestamp: Creation time
 *
 * Key features:
 * - Verb as Verb instance (foreign key to verbs table)
 * - Query relationships by from URL (forward traversal)
 * - Query relationships by to URL (backward traversal)
 * - Query relationships by verb
 * - Unique constraint on (verb, from, to)
 * - Cross-DO URL references
 *
 * Uses real SQLite, NO MOCKS - per project testing philosophy.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Types for Graph Relationships with Verb Instances
// ============================================================================

/**
 * Verb instance as stored in verbs table
 */
interface VerbInstance {
  verb: string // 'creates' (predicate form)
  action: string // 'create' (imperative)
  activity: string // 'creating' (present participle)
  event: string // 'created' (past participle)
  reverse: string // 'createdBy' (backward operator)
  inverse: string | null // 'deletes' (opposite)
  description: string | null
}

/**
 * Relationship edge with Verb instance reference
 */
interface GraphRelationship {
  id: string
  verb: string // References VerbInstance.verb (foreign key)
  from: string // Source Thing URL
  to: string // Target Thing URL
  data: Record<string, unknown> | null
  createdAt: Date
}

/**
 * Relationship with expanded Verb instance (for queries with JOIN)
 */
interface ExpandedRelationship extends GraphRelationship {
  verbInstance: VerbInstance
}

// ============================================================================
// 1. RelationshipsStore Interface Tests
// ============================================================================

describe('RelationshipsStore Interface', () => {
  /**
   * The RelationshipsStore should be importable from db/graph
   */
  it('RelationshipsStore is exported from db/graph', async () => {
    // This will fail until RelationshipsStore is implemented
    const { RelationshipsStore } = await import('../index')
    expect(RelationshipsStore).toBeDefined()
  })

  it('has create method', async () => {
    const { RelationshipsStore } = await import('../index')
    expect(RelationshipsStore.prototype.create).toBeDefined()
  })

  it('has queryByFrom method', async () => {
    const { RelationshipsStore } = await import('../index')
    expect(RelationshipsStore.prototype.queryByFrom).toBeDefined()
  })

  it('has queryByTo method', async () => {
    const { RelationshipsStore } = await import('../index')
    expect(RelationshipsStore.prototype.queryByTo).toBeDefined()
  })

  it('has queryByVerb method', async () => {
    const { RelationshipsStore } = await import('../index')
    expect(RelationshipsStore.prototype.queryByVerb).toBeDefined()
  })

  it('has delete method', async () => {
    const { RelationshipsStore } = await import('../index')
    expect(RelationshipsStore.prototype.delete).toBeDefined()
  })
})

// ============================================================================
// 2. Verb Instance Reference Tests (requires better-sqlite3)
// ============================================================================

describe('Verb Instance Reference', () => {
  let Database: typeof import('better-sqlite3').default
  let drizzle: typeof import('drizzle-orm/better-sqlite3').drizzle
  let eq: typeof import('drizzle-orm').eq
  let and: typeof import('drizzle-orm').and
  let sqlite: import('better-sqlite3').Database
  let db: import('drizzle-orm/better-sqlite3').BetterSQLite3Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      const drizzleBetterSqlite = await import('drizzle-orm/better-sqlite3')
      const drizzleOrm = await import('drizzle-orm')

      Database = betterSqlite.default
      drizzle = drizzleBetterSqlite.drizzle
      eq = drizzleOrm.eq
      and = drizzleOrm.and

      sqlite = new Database(':memory:')

      // Create verbs table (Verb instances)
      sqlite.exec(`
        CREATE TABLE verbs (
          verb TEXT PRIMARY KEY,
          action TEXT,
          activity TEXT,
          event TEXT,
          reverse TEXT,
          inverse TEXT,
          description TEXT
        )
      `)

      // Create relationships table with verb as foreign key to verbs.verb
      sqlite.exec(`
        CREATE TABLE relationships (
          id TEXT PRIMARY KEY,
          verb TEXT NOT NULL REFERENCES verbs(verb),
          "from" TEXT NOT NULL,
          "to" TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(verb, "from", "to")
        )
      `)

      // Create indexes for efficient queries
      sqlite.exec(`
        CREATE INDEX rel_from_idx ON relationships("from");
        CREATE INDEX rel_to_idx ON relationships("to");
        CREATE INDEX rel_verb_idx ON relationships(verb);
        CREATE INDEX rel_from_verb_idx ON relationships("from", verb);
        CREATE INDEX rel_to_verb_idx ON relationships("to", verb);
      `)

      db = drizzle(sqlite)

      // Seed standard verbs
      sqlite.exec(`
        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('creates', 'create', 'creating', 'created', 'createdBy', 'deletes', 'Brings into existence'),
        ('owns', 'own', 'owning', 'owned', 'ownedBy', NULL, 'Possesses'),
        ('manages', 'manage', 'managing', 'managed', 'managedBy', 'abandons', 'Oversees'),
        ('dependsOn', 'dependOn', 'dependingOn', 'dependedOn', 'dependedOnBy', NULL, 'Requires');
      `)
    } catch {
      // Skip setup if dependencies not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('Create Relationship with Verb Instance', () => {
    it('creates relationship referencing valid verb', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-001', 'creates', 'https://startups.studio/nathan', 'https://startups.studio/headless.ly', '{"role": "founder"}', ${now})
      `)

      const result = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get('rel-001') as {
        id: string
        verb: string
        from: string
        to: string
        data: string
        created_at: number
      }

      expect(result.id).toBe('rel-001')
      expect(result.verb).toBe('creates')
      expect(result.from).toBe('https://startups.studio/nathan')
      expect(result.to).toBe('https://startups.studio/headless.ly')
      expect(JSON.parse(result.data)).toEqual({ role: 'founder' })
    })

    it('rejects relationship with invalid verb (foreign key violation)', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      // Enable foreign key constraints
      sqlite.exec('PRAGMA foreign_keys = ON')

      const now = Date.now()
      expect(() => {
        sqlite.exec(`
          INSERT INTO relationships (id, verb, "from", "to", data, created_at)
          VALUES ('rel-invalid', 'nonExistentVerb', 'https://a.com/x', 'https://b.com/y', NULL, ${now})
        `)
      }).toThrow()
    })

    it('can join relationship with verb instance', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-join-001', 'creates', 'https://startups.studio/nathan', 'https://startups.studio/app', NULL, ${now})
      `)

      const result = sqlite
        .prepare(
          `
        SELECT r.*, v.action, v.activity, v.event, v.reverse, v.inverse
        FROM relationships r
        JOIN verbs v ON r.verb = v.verb
        WHERE r.id = ?
      `
        )
        .get('rel-join-001') as {
        id: string
        verb: string
        from: string
        to: string
        action: string
        activity: string
        event: string
        reverse: string
        inverse: string | null
      }

      expect(result.verb).toBe('creates')
      expect(result.action).toBe('create')
      expect(result.activity).toBe('creating')
      expect(result.event).toBe('created')
      expect(result.reverse).toBe('createdBy')
      expect(result.inverse).toBe('deletes')
    })
  })

  describe('Verb Instance Linguistic Forms in Queries', () => {
    beforeEach(async () => {
      if (!sqlite) return

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
        ('rel-lng-001', 'creates', 'https://startups.studio/nathan', 'https://startups.studio/headless.ly', NULL, ${now}),
        ('rel-lng-002', 'owns', 'https://startups.studio/nathan', 'https://startups.studio/docs.do', NULL, ${now}),
        ('rel-lng-003', 'manages', 'https://startups.studio/nathan', 'https://startups.studio/alice', NULL, ${now});
      `)
    })

    it('can query relationships by verb event form (past participle)', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      // Find relationships where the verb event is 'created'
      const results = sqlite
        .prepare(
          `
        SELECT r.*, v.event
        FROM relationships r
        JOIN verbs v ON r.verb = v.verb
        WHERE v.event = ?
      `
        )
        .all('created') as { id: string; verb: string; event: string }[]

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('rel-lng-001')
      expect(results[0].event).toBe('created')
    })

    it('can query relationships by verb reverse form (for backward traversal)', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      // Find relationships where reverse form is 'ownedBy'
      const results = sqlite
        .prepare(
          `
        SELECT r.*, v.reverse
        FROM relationships r
        JOIN verbs v ON r.verb = v.verb
        WHERE v.reverse = ?
      `
        )
        .all('ownedBy') as { id: string; verb: string; reverse: string }[]

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('rel-lng-002')
      expect(results[0].reverse).toBe('ownedBy')
    })

    it('can get all linguistic forms when fetching relationship', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const result = sqlite
        .prepare(
          `
        SELECT r.id, r.verb, r."from", r."to",
               v.action, v.activity, v.event, v.reverse, v.inverse, v.description
        FROM relationships r
        JOIN verbs v ON r.verb = v.verb
        WHERE r.id = ?
      `
        )
        .get('rel-lng-003') as {
        id: string
        verb: string
        from: string
        to: string
        action: string
        activity: string
        event: string
        reverse: string
        inverse: string | null
        description: string | null
      }

      expect(result.verb).toBe('manages')
      expect(result.action).toBe('manage')
      expect(result.activity).toBe('managing')
      expect(result.event).toBe('managed')
      expect(result.reverse).toBe('managedBy')
      expect(result.inverse).toBe('abandons')
    })
  })
})

// ============================================================================
// 3. Query by From URL Tests (Forward Traversal)
// ============================================================================

describe('Query Relationships by From URL', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

      // Create tables
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
        CREATE INDEX rel_from_verb_idx ON relationships("from", verb);
      `)

      // Seed verbs
      sqlite.exec(`
        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('owns', 'own', 'owning', 'owned', 'ownedBy', NULL, 'Possesses'),
        ('manages', 'manage', 'managing', 'managed', 'managedBy', 'abandons', 'Oversees'),
        ('contributesTo', 'contributeTo', 'contributingTo', 'contributedTo', 'contributedToBy', NULL, 'Contributes');
      `)

      // Seed relationships
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
        ('fwd-001', 'owns', 'https://startups.studio/nathan', 'https://startups.studio/headless.ly', NULL, ${now}),
        ('fwd-002', 'owns', 'https://startups.studio/nathan', 'https://startups.studio/docs.do', NULL, ${now}),
        ('fwd-003', 'manages', 'https://startups.studio/nathan', 'https://startups.studio/alice', NULL, ${now}),
        ('fwd-004', 'contributesTo', 'https://startups.studio/alice', 'https://startups.studio/headless.ly', NULL, ${now}),
        ('fwd-005', 'contributesTo', 'https://startups.studio/alice', 'https://startups.studio/docs.do', NULL, ${now});
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('gets all outgoing relationships from a URL', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const results = sqlite
      .prepare('SELECT * FROM relationships WHERE "from" = ?')
      .all('https://startups.studio/nathan') as { id: string }[]

    expect(results).toHaveLength(3)
    expect(results.map((r) => r.id)).toContain('fwd-001')
    expect(results.map((r) => r.id)).toContain('fwd-002')
    expect(results.map((r) => r.id)).toContain('fwd-003')
  })

  it('gets outgoing relationships filtered by verb', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const results = sqlite
      .prepare('SELECT * FROM relationships WHERE "from" = ? AND verb = ?')
      .all('https://startups.studio/nathan', 'owns') as { id: string; to: string }[]

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.to)).toContain('https://startups.studio/headless.ly')
    expect(results.map((r) => r.to)).toContain('https://startups.studio/docs.do')
  })

  it('returns empty array for URL with no outgoing relationships', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const results = sqlite
      .prepare('SELECT * FROM relationships WHERE "from" = ?')
      .all('https://startups.studio/nobody') as { id: string }[]

    expect(results).toHaveLength(0)
  })

  it('can get target URLs only (for graph traversal)', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const results = sqlite
      .prepare('SELECT "to" FROM relationships WHERE "from" = ?')
      .all('https://startups.studio/alice') as { to: string }[]

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.to)).toContain('https://startups.studio/headless.ly')
    expect(results.map((r) => r.to)).toContain('https://startups.studio/docs.do')
  })
})

// ============================================================================
// 4. Query by To URL Tests (Backward Traversal)
// ============================================================================

describe('Query Relationships by To URL', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

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

        CREATE TABLE relationships (
          id TEXT PRIMARY KEY,
          verb TEXT NOT NULL,
          "from" TEXT NOT NULL,
          "to" TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(verb, "from", "to")
        );

        CREATE INDEX rel_to_idx ON relationships("to");
        CREATE INDEX rel_to_verb_idx ON relationships("to", verb);
      `)

      sqlite.exec(`
        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('owns', 'own', 'owning', 'owned', 'ownedBy', NULL, 'Possesses'),
        ('contributesTo', 'contributeTo', 'contributingTo', 'contributedTo', 'contributedToBy', NULL, 'Contributes'),
        ('dependsOn', 'dependOn', 'dependingOn', 'dependedOn', 'dependedOnBy', NULL, 'Requires');
      `)

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
        ('bwd-001', 'owns', 'https://startups.studio/nathan', 'https://startups.studio/headless.ly', NULL, ${now}),
        ('bwd-002', 'contributesTo', 'https://startups.studio/alice', 'https://startups.studio/headless.ly', NULL, ${now}),
        ('bwd-003', 'contributesTo', 'https://startups.studio/bob', 'https://startups.studio/headless.ly', NULL, ${now}),
        ('bwd-004', 'dependsOn', 'https://startups.studio/headless.ly', 'https://startups.studio/docs.do', NULL, ${now});
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('gets all incoming relationships to a URL', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const results = sqlite
      .prepare('SELECT * FROM relationships WHERE "to" = ?')
      .all('https://startups.studio/headless.ly') as { id: string }[]

    expect(results).toHaveLength(3)
    expect(results.map((r) => r.id)).toContain('bwd-001')
    expect(results.map((r) => r.id)).toContain('bwd-002')
    expect(results.map((r) => r.id)).toContain('bwd-003')
  })

  it('gets incoming relationships filtered by verb', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const results = sqlite
      .prepare('SELECT * FROM relationships WHERE "to" = ? AND verb = ?')
      .all('https://startups.studio/headless.ly', 'contributesTo') as { id: string; from: string }[]

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.from)).toContain('https://startups.studio/alice')
    expect(results.map((r) => r.from)).toContain('https://startups.studio/bob')
  })

  it('finds owner via backward traversal (ownedBy pattern)', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    // Find who owns headless.ly (reverse of 'owns' is 'ownedBy')
    const results = sqlite
      .prepare('SELECT "from" FROM relationships WHERE "to" = ? AND verb = ?')
      .all('https://startups.studio/headless.ly', 'owns') as { from: string }[]

    expect(results).toHaveLength(1)
    expect(results[0].from).toBe('https://startups.studio/nathan')
  })

  it('returns empty array for URL with no incoming relationships', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const results = sqlite
      .prepare('SELECT * FROM relationships WHERE "to" = ?')
      .all('https://startups.studio/orphan') as { id: string }[]

    expect(results).toHaveLength(0)
  })
})

// ============================================================================
// 5. Query by Verb Tests
// ============================================================================

describe('Query Relationships by Verb', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

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

        CREATE TABLE relationships (
          id TEXT PRIMARY KEY,
          verb TEXT NOT NULL,
          "from" TEXT NOT NULL,
          "to" TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(verb, "from", "to")
        );

        CREATE INDEX rel_verb_idx ON relationships(verb);
      `)

      sqlite.exec(`
        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('owns', 'own', 'owning', 'owned', 'ownedBy', NULL, 'Possesses'),
        ('manages', 'manage', 'managing', 'managed', 'managedBy', 'abandons', 'Oversees'),
        ('integratesWith', 'integrateWith', 'integratingWith', 'integratedWith', 'integratedWithBy', NULL, 'Integrates');
      `)

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
        ('verb-001', 'owns', 'https://startups.studio/nathan', 'https://startups.studio/headless.ly', NULL, ${now}),
        ('verb-002', 'owns', 'https://startups.studio/nathan', 'https://startups.studio/docs.do', NULL, ${now}),
        ('verb-003', 'owns', 'https://startups.studio/alice', 'https://startups.studio/workers.do', NULL, ${now}),
        ('verb-004', 'manages', 'https://startups.studio/nathan', 'https://startups.studio/alice', NULL, ${now}),
        ('verb-005', 'integratesWith', 'https://startups.studio/headless.ly', 'https://github.com/headlessly', NULL, ${now});
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('gets all relationships of a specific verb type', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const results = sqlite.prepare('SELECT * FROM relationships WHERE verb = ?').all('owns') as { id: string }[]

    expect(results).toHaveLength(3)
    expect(results.map((r) => r.id)).toContain('verb-001')
    expect(results.map((r) => r.id)).toContain('verb-002')
    expect(results.map((r) => r.id)).toContain('verb-003')
  })

  it('counts relationships by verb', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const results = sqlite
      .prepare('SELECT verb, COUNT(*) as count FROM relationships GROUP BY verb')
      .all() as { verb: string; count: number }[]

    const verbCounts = Object.fromEntries(results.map((r) => [r.verb, r.count]))

    expect(verbCounts['owns']).toBe(3)
    expect(verbCounts['manages']).toBe(1)
    expect(verbCounts['integratesWith']).toBe(1)
  })

  it('finds all unique verbs used in relationships', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const results = sqlite.prepare('SELECT DISTINCT verb FROM relationships').all() as { verb: string }[]

    expect(results).toHaveLength(3)
    expect(results.map((r) => r.verb)).toContain('owns')
    expect(results.map((r) => r.verb)).toContain('manages')
    expect(results.map((r) => r.verb)).toContain('integratesWith')
  })
})

// ============================================================================
// 6. Unique Constraint Tests
// ============================================================================

describe('Unique Constraint on (verb, from, to)', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

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

        CREATE TABLE relationships (
          id TEXT PRIMARY KEY,
          verb TEXT NOT NULL,
          "from" TEXT NOT NULL,
          "to" TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(verb, "from", "to")
        );
      `)

      sqlite.exec(`
        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('owns', 'own', 'owning', 'owned', 'ownedBy', NULL, 'Possesses'),
        ('creates', 'create', 'creating', 'created', 'createdBy', 'deletes', 'Creates');
      `)

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('unique-001', 'owns', 'https://a.com/x', 'https://b.com/y', NULL, ${now})
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('rejects duplicate (verb, from, to) combination', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    expect(() => {
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('unique-002', 'owns', 'https://a.com/x', 'https://b.com/y', NULL, ${now})
      `)
    }).toThrow(/UNIQUE constraint failed/)
  })

  it('allows same from+to with different verb', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    // Should not throw - different verb
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('unique-003', 'creates', 'https://a.com/x', 'https://b.com/y', NULL, ${now})
    `)

    const results = sqlite
      .prepare('SELECT * FROM relationships WHERE "from" = ? AND "to" = ?')
      .all('https://a.com/x', 'https://b.com/y') as { id: string; verb: string }[]

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.verb)).toContain('owns')
    expect(results.map((r) => r.verb)).toContain('creates')
  })

  it('allows same verb+from with different to', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    // Should not throw - different to
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('unique-004', 'owns', 'https://a.com/x', 'https://c.com/z', NULL, ${now})
    `)

    const results = sqlite
      .prepare('SELECT * FROM relationships WHERE verb = ? AND "from" = ?')
      .all('owns', 'https://a.com/x') as { id: string; to: string }[]

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.to)).toContain('https://b.com/y')
    expect(results.map((r) => r.to)).toContain('https://c.com/z')
  })

  it('allows same verb+to with different from', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    // Should not throw - different from
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('unique-005', 'owns', 'https://d.com/w', 'https://b.com/y', NULL, ${now})
    `)

    const results = sqlite
      .prepare('SELECT * FROM relationships WHERE verb = ? AND "to" = ?')
      .all('owns', 'https://b.com/y') as { id: string; from: string }[]

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.from)).toContain('https://a.com/x')
    expect(results.map((r) => r.from)).toContain('https://d.com/w')
  })
})

// ============================================================================
// 7. Cross-DO URL Reference Tests
// ============================================================================

describe('Cross-DO URL References', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

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

      sqlite.exec(`
        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('deployedTo', 'deployTo', 'deployingTo', 'deployedTo', 'deployedToBy', 'undeployedFrom', 'Deploys'),
        ('uses', 'use', 'using', 'used', 'usedBy', NULL, 'Uses'),
        ('integratesWith', 'integrateWith', 'integratingWith', 'integratedWith', 'integratedWithBy', NULL, 'Integrates'),
        ('referencedBy', 'referenceBy', 'referencingBy', 'referencedBy', 'references', NULL, 'References');
      `)

      const now = Date.now()
      // Cross-DO relationships between different namespaces
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
        ('cross-001', 'deployedTo', 'https://apps.do/my-app', 'https://workers.do/my-worker', '{"region": "us-east"}', ${now}),
        ('cross-002', 'uses', 'https://apis.do/payment-api', 'https://queues.do/payment-queue', NULL, ${now}),
        ('cross-003', 'integratesWith', 'https://startups.studio/headless.ly', 'https://github.com/headlessly/repo', '{"branch": "main"}', ${now}),
        ('cross-004', 'integratesWith', 'https://startups.studio/headless.ly', 'https://linear.app/headlessly/project', NULL, ${now}),
        ('cross-005', 'referencedBy', 'https://docs.do/api-reference', 'https://startups.studio/headless.ly', NULL, ${now});
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('stores relationships between different DO namespaces', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const result = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get('cross-001') as {
      from: string
      to: string
    }

    expect(result.from).toBe('https://apps.do/my-app')
    expect(result.to).toBe('https://workers.do/my-worker')
    expect(new URL(result.from).hostname).not.toBe(new URL(result.to).hostname)
  })

  it('stores relationships to external services (github, linear)', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const results = sqlite
      .prepare('SELECT * FROM relationships WHERE "from" = ?')
      .all('https://startups.studio/headless.ly') as { to: string }[]

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.to)).toContain('https://github.com/headlessly/repo')
    expect(results.map((r) => r.to)).toContain('https://linear.app/headlessly/project')
  })

  it('can find all external integrations', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    // Find all relationships where 'to' is not a .do domain
    const results = sqlite
      .prepare(
        `
      SELECT * FROM relationships
      WHERE "to" NOT LIKE '%.do/%'
    `
      )
      .all() as { id: string; to: string }[]

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.to)).toContain('https://github.com/headlessly/repo')
    expect(results.map((r) => r.to)).toContain('https://linear.app/headlessly/project')
  })

  it('can find relationships across specific DO pairs', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    // Find all relationships from apps.do to workers.do
    const results = sqlite
      .prepare(
        `
      SELECT * FROM relationships
      WHERE "from" LIKE 'https://apps.do/%'
        AND "to" LIKE 'https://workers.do/%'
    `
      )
      .all() as { id: string }[]

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('cross-001')
  })

  it('can traverse cross-DO relationships', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    // Start from apis.do and find what it connects to
    const step1 = sqlite.prepare('SELECT "to" FROM relationships WHERE "from" = ?').all('https://apis.do/payment-api') as {
      to: string
    }[]

    expect(step1).toHaveLength(1)
    expect(step1[0].to).toBe('https://queues.do/payment-queue')

    // Could continue traversal from the target
    const step2 = sqlite.prepare('SELECT * FROM relationships WHERE "from" = ?').all(step1[0].to) as { id: string }[]

    // No outgoing relationships from the queue (expected)
    expect(step2).toHaveLength(0)
  })
})

// ============================================================================
// 8. Edge Data Tests (JSON Properties)
// ============================================================================

describe('Relationship Edge Data', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

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

        CREATE TABLE relationships (
          id TEXT PRIMARY KEY,
          verb TEXT NOT NULL,
          "from" TEXT NOT NULL,
          "to" TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(verb, "from", "to")
        );
      `)

      sqlite.exec(`
        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('owns', 'own', 'owning', 'owned', 'ownedBy', NULL, 'Possesses'),
        ('manages', 'manage', 'managing', 'managed', 'managedBy', 'abandons', 'Oversees');
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('stores complex JSON data on edge', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const edgeData = JSON.stringify({
      role: 'founder',
      percentage: 60,
      since: '2024-01-01',
      permissions: ['admin', 'write', 'delete'],
      nested: { level1: { level2: 'deep value' } },
    })

    const now = Date.now()
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('data-001', 'owns', 'https://a.com/x', 'https://b.com/y', '${edgeData}', ${now})
    `)

    const result = sqlite.prepare('SELECT data FROM relationships WHERE id = ?').get('data-001') as { data: string }
    const parsed = JSON.parse(result.data)

    expect(parsed.role).toBe('founder')
    expect(parsed.percentage).toBe(60)
    expect(parsed.permissions).toHaveLength(3)
    expect(parsed.nested.level1.level2).toBe('deep value')
  })

  it('allows null data', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('data-null-001', 'owns', 'https://c.com/z', 'https://d.com/w', NULL, ${now})
    `)

    const result = sqlite.prepare('SELECT data FROM relationships WHERE id = ?').get('data-null-001') as {
      data: string | null
    }

    expect(result.data).toBeNull()
  })

  it('can query by JSON data using SQLite JSON functions', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
      ('json-001', 'owns', 'https://a.com/1', 'https://b.com/1', '{"percentage": 60, "role": "founder"}', ${now}),
      ('json-002', 'owns', 'https://a.com/2', 'https://b.com/2', '{"percentage": 40, "role": "co-founder"}', ${now}),
      ('json-003', 'owns', 'https://a.com/3', 'https://b.com/3', '{"percentage": 100, "role": "sole-owner"}', ${now});
    `)

    // Query where percentage > 50 using SQLite JSON extract
    const results = sqlite
      .prepare(
        `
      SELECT * FROM relationships
      WHERE json_extract(data, '$.percentage') > 50
    `
      )
      .all() as { id: string }[]

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.id)).toContain('json-001')
    expect(results.map((r) => r.id)).toContain('json-003')
  })

  it('can update edge data', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('update-001', 'manages', 'https://a.com/x', 'https://b.com/y', '{"scope": "limited"}', ${now})
    `)

    // Update the data
    sqlite.exec(`
      UPDATE relationships SET data = '{"scope": "full", "updated": true}' WHERE id = 'update-001'
    `)

    const result = sqlite.prepare('SELECT data FROM relationships WHERE id = ?').get('update-001') as { data: string }
    const parsed = JSON.parse(result.data)

    expect(parsed.scope).toBe('full')
    expect(parsed.updated).toBe(true)
  })
})

// ============================================================================
// 9. Timestamp Tests
// ============================================================================

describe('Relationship Timestamps', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

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

        CREATE TABLE relationships (
          id TEXT PRIMARY KEY,
          verb TEXT NOT NULL,
          "from" TEXT NOT NULL,
          "to" TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(verb, "from", "to")
        );

        CREATE INDEX rel_created_at_idx ON relationships(created_at);
      `)

      sqlite.exec(`
        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('owns', 'own', 'owning', 'owned', 'ownedBy', NULL, 'Possesses');
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('stores timestamp as integer (Unix epoch milliseconds)', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('ts-001', 'owns', 'https://a.com/x', 'https://b.com/y', NULL, ${now})
    `)

    const result = sqlite.prepare('SELECT created_at FROM relationships WHERE id = ?').get('ts-001') as {
      created_at: number
    }

    expect(result.created_at).toBe(now)
    expect(typeof result.created_at).toBe('number')
  })

  it('can query relationships by time range', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const baseTime = Date.now()
    const oneHourAgo = baseTime - 3600000
    const twoHoursAgo = baseTime - 7200000

    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
      ('ts-old', 'owns', 'https://a.com/1', 'https://b.com/1', NULL, ${twoHoursAgo}),
      ('ts-mid', 'owns', 'https://a.com/2', 'https://b.com/2', NULL, ${oneHourAgo}),
      ('ts-new', 'owns', 'https://a.com/3', 'https://b.com/3', NULL, ${baseTime});
    `)

    // Get relationships from last 90 minutes
    const cutoff = baseTime - 5400000 // 90 minutes ago
    const results = sqlite.prepare('SELECT * FROM relationships WHERE created_at > ?').all(cutoff) as { id: string }[]

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.id)).toContain('ts-mid')
    expect(results.map((r) => r.id)).toContain('ts-new')
  })

  it('can order relationships by creation time', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const time1 = 1700000000000
    const time2 = 1700000001000
    const time3 = 1700000002000

    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
      ('order-2', 'owns', 'https://a.com/2', 'https://b.com/2', NULL, ${time2}),
      ('order-1', 'owns', 'https://a.com/1', 'https://b.com/1', NULL, ${time1}),
      ('order-3', 'owns', 'https://a.com/3', 'https://b.com/3', NULL, ${time3});
    `)

    const results = sqlite.prepare('SELECT id FROM relationships ORDER BY created_at ASC').all() as { id: string }[]

    expect(results[0].id).toBe('order-1')
    expect(results[1].id).toBe('order-2')
    expect(results[2].id).toBe('order-3')
  })
})

// ============================================================================
// 10. Self-Referential and Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

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

        CREATE TABLE relationships (
          id TEXT PRIMARY KEY,
          verb TEXT NOT NULL,
          "from" TEXT NOT NULL,
          "to" TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(verb, "from", "to")
        );
      `)

      sqlite.exec(`
        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('references', 'reference', 'referencing', 'referenced', 'referencedBy', NULL, 'References'),
        ('linksTo', 'linkTo', 'linkingTo', 'linkedTo', 'linkedToBy', NULL, 'Links');
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('allows self-referential relationship (from = to)', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('self-001', 'references', 'https://docs.do/intro', 'https://docs.do/intro', '{"section": "footnote"}', ${now})
    `)

    const result = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get('self-001') as {
      from: string
      to: string
    }

    expect(result.from).toBe(result.to)
    expect(result.from).toBe('https://docs.do/intro')
  })

  it('handles very long URLs', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const longPath = 'a'.repeat(1900)
    const longUrl = `https://example.com/${longPath}`

    const now = Date.now()
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('long-001', 'linksTo', 'https://short.com/x', '${longUrl}', NULL, ${now})
    `)

    const result = sqlite.prepare('SELECT "to" FROM relationships WHERE id = ?').get('long-001') as { to: string }

    expect(result.to.length).toBeGreaterThan(1900)
  })

  it('handles URLs with special characters (percent-encoded)', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const encodedUrl = 'https://example.com/path%20with%20spaces?query=%E6%97%A5%E6%9C%AC'

    const now = Date.now()
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('special-001', 'linksTo', 'https://normal.com/x', '${encodedUrl}', NULL, ${now})
    `)

    const result = sqlite.prepare('SELECT "to" FROM relationships WHERE id = ?').get('special-001') as { to: string }

    expect(result.to).toBe(encodedUrl)
  })

  it('handles URLs with query parameters and fragments', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const urlWithParams = 'https://api.example.com/v1/resource?param1=value1&param2=value2#section'

    const now = Date.now()
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('params-001', 'linksTo', 'https://client.com/x', '${urlWithParams}', NULL, ${now})
    `)

    const result = sqlite.prepare('SELECT "to" FROM relationships WHERE id = ?').get('params-001') as { to: string }

    expect(result.to).toContain('param1=value1')
    expect(result.to).toContain('#section')
  })
})

// ============================================================================
// 11. Integration with Verb Instance System
// ============================================================================

describe('Integration: Verb Instance Lookup', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

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

        CREATE TABLE relationships (
          id TEXT PRIMARY KEY,
          verb TEXT NOT NULL,
          "from" TEXT NOT NULL,
          "to" TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(verb, "from", "to")
        );
      `)

      sqlite.exec(`
        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('creates', 'create', 'creating', 'created', 'createdBy', 'deletes', 'Creates'),
        ('deletes', 'delete', 'deleting', 'deleted', 'deletedBy', 'creates', 'Deletes');
      `)

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('int-001', 'creates', 'https://users.do/alice', 'https://projects.do/project-1', NULL, ${now})
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('can resolve relationship verb to full Verb instance', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const result = sqlite
      .prepare(
        `
      SELECT r.id, r."from", r."to",
             v.verb, v.action, v.activity, v.event, v.reverse, v.inverse
      FROM relationships r
      JOIN verbs v ON r.verb = v.verb
      WHERE r.id = ?
    `
      )
      .get('int-001') as {
      id: string
      from: string
      to: string
      verb: string
      action: string
      activity: string
      event: string
      reverse: string
      inverse: string
    }

    expect(result.verb).toBe('creates')
    expect(result.action).toBe('create')
    expect(result.event).toBe('created')
    expect(result.reverse).toBe('createdBy')
    expect(result.inverse).toBe('deletes')
  })

  it('can find inverse relationships', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    // Given a relationship, find if there's an inverse relationship
    const original = sqlite
      .prepare(
        `
      SELECT r.*, v.inverse
      FROM relationships r
      JOIN verbs v ON r.verb = v.verb
      WHERE r.id = ?
    `
      )
      .get('int-001') as {
      from: string
      to: string
      inverse: string
    }

    // Check if inverse relationship exists (deletes from project-1 to alice)
    // In this case there isn't one, but the query pattern is demonstrated
    const inverseRel = sqlite
      .prepare(
        `
      SELECT * FROM relationships
      WHERE verb = ? AND "from" = ? AND "to" = ?
    `
      )
      .get(original.inverse, original.to, original.from)

    expect(inverseRel).toBeUndefined() // No inverse relationship created yet
  })

  it('can build event description using verb forms', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const result = sqlite
      .prepare(
        `
      SELECT r."from" as subject, v.event as verbEvent, r."to" as object
      FROM relationships r
      JOIN verbs v ON r.verb = v.verb
      WHERE r.id = ?
    `
      )
      .get('int-001') as {
      subject: string
      verbEvent: string
      object: string
    }

    // Build natural language: "alice created project-1"
    const subjectName = new URL(result.subject).pathname.slice(1)
    const objectName = new URL(result.object).pathname.slice(1)
    const description = `${subjectName} ${result.verbEvent} ${objectName}`

    expect(description).toBe('alice created project-1')
  })
})
