/**
 * Handoff Chain Tracking Tests - Agent Handoffs as Graph Relationships
 *
 * TDD RED Phase: Tests for tracking agent handoffs in the graph using the
 * `handedOffTo` relationship type.
 *
 * This test file validates:
 * 1. Handoff creates `handedOffTo` relationship with context
 * 2. Handoff chain traversal (forward and backward)
 * 3. Handoff reason and context preservation in relationship data
 * 4. Circular handoff prevention via graph query
 * 5. Handoff chain analytics (count by reason, agent participation)
 *
 * Uses REAL SQLite - NO MOCKS - per project testing philosophy.
 *
 * @see dotdo-jdofw - [RED] Handoff Chain Tracking - Tests
 * @see dotdo-ucolo - Agents as Graph Things (parent epic)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Types for Handoff Chain Tracking
// ============================================================================

/**
 * Handoff reason - why the handoff was initiated
 */
type HandoffReason =
  | 'specialization' // Target agent has better capabilities
  | 'escalation' // Issue requires higher authority
  | 'delegation' // Parallel task delegation
  | 'completion' // Current agent completed its part
  | 'routing' // Initial routing decision
  | 'error' // Current agent cannot proceed
  | 'custom' // Custom reason with description

/**
 * Context transferred during a handoff
 */
interface HandoffContextData {
  /** Summary of work done by source agent */
  summary?: string
  /** Specific instructions for target agent */
  instructions?: string
  /** Variables/state to pass along */
  variables?: Record<string, unknown>
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>
}

/**
 * Input for creating a handoff relationship
 */
interface CreateHandoffInput {
  /** Source agent Thing ID (the agent handing off) */
  from: string
  /** Target agent Thing ID (the agent receiving) */
  to: string
  /** Reason for the handoff */
  reason: HandoffReason
  /** Human-readable reason description */
  reasonDescription?: string
  /** Context to transfer */
  context?: HandoffContextData
  /** Conversation/task ID this handoff belongs to */
  conversationId?: string
}

/**
 * Handoff relationship as stored in the graph
 */
interface HandoffRelationship {
  id: string
  verb: 'handedOffTo'
  from: string
  to: string
  data: {
    reason: HandoffReason
    reasonDescription?: string
    context?: HandoffContextData
    conversationId?: string
    timestamp: string
  }
  createdAt: Date
}

/**
 * Entry in a handoff chain
 */
interface HandoffChainEntry {
  agentId: string
  handoffReason?: HandoffReason
  receivedAt: Date
  handedOffAt?: Date
  summary?: string
}

/**
 * Result of circular handoff detection
 */
interface CircularHandoffCheckResult {
  isCircular: boolean
  existingChain: string[]
}

/**
 * Analytics for handoff patterns
 */
interface HandoffAnalytics {
  /** Total handoffs in the system */
  totalHandoffs: number
  /** Handoffs grouped by reason */
  byReason: Record<HandoffReason, number>
  /** Most common handoff pairs (from -> to) */
  topHandoffPairs: Array<{ from: string; to: string; count: number }>
  /** Agents ranked by handoff participation */
  agentParticipation: Array<{ agentId: string; asSource: number; asTarget: number }>
}

// ============================================================================
// 1. Handoff Relationship Creation Tests
// ============================================================================

describe('Handoff Relationship Creation', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

      // Create verbs table with handedOffTo verb
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
          verb TEXT NOT NULL REFERENCES verbs(verb),
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

      // Seed handedOffTo verb
      sqlite.exec(`
        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('handedOffTo', 'handOff', 'handingOff', 'handedOff', 'receivedHandoffFrom', NULL, 'Agent transfers control to another agent');
      `)

      // Seed test agents as Things
      const now = Date.now()
      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at) VALUES
        ('agent:ralph', 1, 'Agent', '{"name": "ralph", "persona": "Engineering"}', ${now}, ${now}),
        ('agent:tom', 1, 'Agent', '{"name": "tom", "persona": "Tech Lead"}', ${now}, ${now}),
        ('agent:priya', 1, 'Agent', '{"name": "priya", "persona": "Product"}', ${now}, ${now}),
        ('agent:mark', 1, 'Agent', '{"name": "mark", "persona": "Marketing"}', ${now}, ${now}),
        ('agent:sally', 1, 'Agent', '{"name": "sally", "persona": "Sales"}', ${now}, ${now}),
        ('agent:quinn', 1, 'Agent', '{"name": "quinn", "persona": "QA"}', ${now}, ${now});
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('creates handedOffTo relationship between agents', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    // This will fail until createHandoffRelationship is implemented
    const { createHandoffRelationship } = await import('../index')

    const handoff = await createHandoffRelationship(sqlite, {
      from: 'agent:ralph',
      to: 'agent:tom',
      reason: 'specialization',
      reasonDescription: 'Code review needed',
    })

    expect(handoff.verb).toBe('handedOffTo')
    expect(handoff.from).toBe('agent:ralph')
    expect(handoff.to).toBe('agent:tom')
  })

  it('stores handoff reason in relationship data', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { createHandoffRelationship } = await import('../index')

    const handoff = await createHandoffRelationship(sqlite, {
      from: 'agent:ralph',
      to: 'agent:tom',
      reason: 'escalation',
      reasonDescription: 'Architecture decision required',
    })

    expect(handoff.data.reason).toBe('escalation')
    expect(handoff.data.reasonDescription).toBe('Architecture decision required')
  })

  it('stores context in relationship data', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { createHandoffRelationship } = await import('../index')

    const handoff = await createHandoffRelationship(sqlite, {
      from: 'agent:ralph',
      to: 'agent:tom',
      reason: 'completion',
      context: {
        summary: 'Feature implementation complete, needs code review',
        instructions: 'Check error handling in auth module',
        variables: { prNumber: 123, branch: 'feature/auth' },
        metadata: { linesChanged: 450, filesModified: 12 },
      },
    })

    expect(handoff.data.context?.summary).toBe('Feature implementation complete, needs code review')
    expect(handoff.data.context?.instructions).toBe('Check error handling in auth module')
    expect(handoff.data.context?.variables?.prNumber).toBe(123)
    expect(handoff.data.context?.metadata?.linesChanged).toBe(450)
  })

  it('includes timestamp in relationship data', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { createHandoffRelationship } = await import('../index')
    const before = new Date()

    const handoff = await createHandoffRelationship(sqlite, {
      from: 'agent:ralph',
      to: 'agent:tom',
      reason: 'specialization',
    })

    const after = new Date()
    const timestamp = new Date(handoff.data.timestamp)

    expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it('associates handoff with conversation ID', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { createHandoffRelationship } = await import('../index')

    const handoff = await createHandoffRelationship(sqlite, {
      from: 'agent:ralph',
      to: 'agent:tom',
      reason: 'delegation',
      conversationId: 'conv:task-123',
    })

    expect(handoff.data.conversationId).toBe('conv:task-123')
  })

  it('generates unique handoff relationship ID', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { createHandoffRelationship } = await import('../index')

    const handoff1 = await createHandoffRelationship(sqlite, {
      from: 'agent:ralph',
      to: 'agent:tom',
      reason: 'specialization',
      conversationId: 'conv:1',
    })

    const handoff2 = await createHandoffRelationship(sqlite, {
      from: 'agent:ralph',
      to: 'agent:priya',
      reason: 'completion',
      conversationId: 'conv:2',
    })

    expect(handoff1.id).toBeDefined()
    expect(handoff2.id).toBeDefined()
    expect(handoff1.id).not.toBe(handoff2.id)
  })

  it('validates source agent exists as Thing', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { createHandoffRelationship } = await import('../index')

    await expect(
      createHandoffRelationship(sqlite, {
        from: 'agent:nonexistent',
        to: 'agent:tom',
        reason: 'specialization',
      })
    ).rejects.toThrow(/agent not found|source.*not found/i)
  })

  it('validates target agent exists as Thing', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { createHandoffRelationship } = await import('../index')

    await expect(
      createHandoffRelationship(sqlite, {
        from: 'agent:ralph',
        to: 'agent:nonexistent',
        reason: 'specialization',
      })
    ).rejects.toThrow(/agent not found|target.*not found/i)
  })

  it('allows multiple handoffs between same agents in different conversations', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { createHandoffRelationship, getHandoffsBetweenAgents } = await import('../index')

    await createHandoffRelationship(sqlite, {
      from: 'agent:ralph',
      to: 'agent:tom',
      reason: 'specialization',
      conversationId: 'conv:1',
    })

    await createHandoffRelationship(sqlite, {
      from: 'agent:ralph',
      to: 'agent:tom',
      reason: 'escalation',
      conversationId: 'conv:2',
    })

    const handoffs = await getHandoffsBetweenAgents(sqlite, 'agent:ralph', 'agent:tom')
    expect(handoffs).toHaveLength(2)
  })
})

// ============================================================================
// 2. Handoff Chain Traversal Tests
// ============================================================================

describe('Handoff Chain Traversal', () => {
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
        CREATE INDEX rel_from_verb_idx ON relationships("from", verb);
        CREATE INDEX rel_to_verb_idx ON relationships("to", verb);
      `)

      sqlite.exec(`
        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('handedOffTo', 'handOff', 'handingOff', 'handedOff', 'receivedHandoffFrom', NULL, 'Agent transfers control to another agent');
      `)

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at) VALUES
        ('agent:ralph', 1, 'Agent', '{"name": "ralph"}', ${now}, ${now}),
        ('agent:tom', 1, 'Agent', '{"name": "tom"}', ${now}, ${now}),
        ('agent:priya', 1, 'Agent', '{"name": "priya"}', ${now}, ${now}),
        ('agent:mark', 1, 'Agent', '{"name": "mark"}', ${now}, ${now}),
        ('agent:sally', 1, 'Agent', '{"name": "sally"}', ${now}, ${now});
      `)

      // Seed a handoff chain: ralph -> tom -> priya
      const time1 = now - 2000
      const time2 = now - 1000
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
        ('handoff-001', 'handedOffTo', 'agent:ralph', 'agent:tom',
         '{"reason": "specialization", "conversationId": "conv:chain-test", "timestamp": "${new Date(time1).toISOString()}"}',
         ${time1}),
        ('handoff-002', 'handedOffTo', 'agent:tom', 'agent:priya',
         '{"reason": "completion", "conversationId": "conv:chain-test", "timestamp": "${new Date(time2).toISOString()}"}',
         ${time2});
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('gets forward handoff chain from starting agent', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { getHandoffChain } = await import('../index')

    // Chain: ralph -> tom -> priya
    const chain = await getHandoffChain(sqlite, 'agent:ralph')

    expect(chain).toHaveLength(3)
    expect(chain[0].agentId).toBe('agent:ralph')
    expect(chain[1].agentId).toBe('agent:tom')
    expect(chain[2].agentId).toBe('agent:priya')
  })

  it('returns single agent when no handoffs exist', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { getHandoffChain } = await import('../index')

    const chain = await getHandoffChain(sqlite, 'agent:mark')

    expect(chain).toHaveLength(1)
    expect(chain[0].agentId).toBe('agent:mark')
  })

  it('tracks handoff reasons in chain entries', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { getHandoffChain } = await import('../index')

    const chain = await getHandoffChain(sqlite, 'agent:ralph')

    expect(chain[0].handoffReason).toBe('specialization') // ralph -> tom
    expect(chain[1].handoffReason).toBe('completion') // tom -> priya
    expect(chain[2].handoffReason).toBeUndefined() // priya (end of chain)
  })

  it('gets chain for specific conversation', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { getHandoffChainForConversation } = await import('../index')

    const chain = await getHandoffChainForConversation(sqlite, 'conv:chain-test')

    expect(chain).toHaveLength(3)
    expect(chain.map((e) => e.agentId)).toEqual(['agent:ralph', 'agent:tom', 'agent:priya'])
  })

  it('returns empty chain for non-existent conversation', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { getHandoffChainForConversation } = await import('../index')

    const chain = await getHandoffChainForConversation(sqlite, 'conv:nonexistent')

    expect(chain).toHaveLength(0)
  })

  it('finds who an agent received handoff from (backward traversal)', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { getHandoffSource } = await import('../index')

    const source = await getHandoffSource(sqlite, 'agent:tom', 'conv:chain-test')

    expect(source).toBe('agent:ralph')
  })

  it('finds who an agent handed off to (forward traversal)', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { getHandoffTarget } = await import('../index')

    const target = await getHandoffTarget(sqlite, 'agent:tom', 'conv:chain-test')

    expect(target).toBe('agent:priya')
  })

  it('returns null for agent with no incoming handoff', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { getHandoffSource } = await import('../index')

    const source = await getHandoffSource(sqlite, 'agent:ralph', 'conv:chain-test')

    expect(source).toBeNull()
  })

  it('returns null for agent with no outgoing handoff', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { getHandoffTarget } = await import('../index')

    const target = await getHandoffTarget(sqlite, 'agent:priya', 'conv:chain-test')

    expect(target).toBeNull()
  })

  it('tracks timestamps in chain for duration analysis', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { getHandoffChain } = await import('../index')

    const chain = await getHandoffChain(sqlite, 'agent:ralph')

    // First agent received at chain start
    expect(chain[0].receivedAt).toBeDefined()
    // First agent handed off to second
    expect(chain[0].handedOffAt).toBeDefined()
    // Second agent received handoff
    expect(chain[1].receivedAt).toBeDefined()
    // Second agent handed off to third
    expect(chain[1].handedOffAt).toBeDefined()
    // Third agent received but hasn't handed off
    expect(chain[2].receivedAt).toBeDefined()
    expect(chain[2].handedOffAt).toBeUndefined()
  })
})

// ============================================================================
// 3. Circular Handoff Prevention Tests
// ============================================================================

describe('Circular Handoff Prevention', () => {
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
          created_at INTEGER NOT NULL
        );

        CREATE INDEX rel_from_idx ON relationships("from");
        CREATE INDEX rel_to_idx ON relationships("to");
        CREATE INDEX rel_verb_idx ON relationships(verb);
      `)

      sqlite.exec(`
        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('handedOffTo', 'handOff', 'handingOff', 'handedOff', 'receivedHandoffFrom', NULL, 'Agent transfers control');
      `)

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at) VALUES
        ('agent:ralph', 1, 'Agent', '{"name": "ralph"}', ${now}, ${now}),
        ('agent:tom', 1, 'Agent', '{"name": "tom"}', ${now}, ${now}),
        ('agent:priya', 1, 'Agent', '{"name": "priya"}', ${now}, ${now});
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('detects direct circular handoff (A -> B -> A)', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { createHandoffRelationship, checkCircularHandoff } = await import('../index')

    // ralph -> tom
    await createHandoffRelationship(sqlite, {
      from: 'agent:ralph',
      to: 'agent:tom',
      reason: 'specialization',
      conversationId: 'conv:circular-test',
    })

    // Check if tom -> ralph would be circular
    const result = await checkCircularHandoff(sqlite, 'agent:tom', 'agent:ralph', 'conv:circular-test')

    expect(result.isCircular).toBe(true)
    expect(result.existingChain).toContain('agent:ralph')
    expect(result.existingChain).toContain('agent:tom')
  })

  it('detects transitive circular handoff (A -> B -> C -> A)', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { checkCircularHandoff } = await import('../index')
    const now = Date.now()

    // Set up: ralph -> tom -> priya
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
      ('h1', 'handedOffTo', 'agent:ralph', 'agent:tom',
       '{"reason": "specialization", "conversationId": "conv:trans-test", "timestamp": "${new Date().toISOString()}"}',
       ${now - 2000}),
      ('h2', 'handedOffTo', 'agent:tom', 'agent:priya',
       '{"reason": "completion", "conversationId": "conv:trans-test", "timestamp": "${new Date().toISOString()}"}',
       ${now - 1000});
    `)

    // Check if priya -> ralph would be circular
    const result = await checkCircularHandoff(sqlite, 'agent:priya', 'agent:ralph', 'conv:trans-test')

    expect(result.isCircular).toBe(true)
    expect(result.existingChain).toEqual(['agent:ralph', 'agent:tom', 'agent:priya'])
  })

  it('returns false for non-circular handoff', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { checkCircularHandoff } = await import('../index')
    const now = Date.now()

    // ralph -> tom
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
      ('h1', 'handedOffTo', 'agent:ralph', 'agent:tom',
       '{"reason": "specialization", "conversationId": "conv:no-circle", "timestamp": "${new Date().toISOString()}"}',
       ${now});
    `)

    // tom -> priya should NOT be circular (priya not in chain yet)
    const result = await checkCircularHandoff(sqlite, 'agent:tom', 'agent:priya', 'conv:no-circle')

    expect(result.isCircular).toBe(false)
  })

  it('prevents circular handoff creation by throwing error', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { createHandoffRelationship } = await import('../index')
    const now = Date.now()

    // Set up: ralph -> tom
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
      ('h1', 'handedOffTo', 'agent:ralph', 'agent:tom',
       '{"reason": "specialization", "conversationId": "conv:prevent-test", "timestamp": "${new Date().toISOString()}"}',
       ${now});
    `)

    // Trying to create tom -> ralph should throw
    await expect(
      createHandoffRelationship(sqlite, {
        from: 'agent:tom',
        to: 'agent:ralph',
        reason: 'escalation',
        conversationId: 'conv:prevent-test',
      })
    ).rejects.toThrow(/circular.*handoff|cycle.*detected/i)
  })

  it('allows same agent in different conversations (not circular)', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { createHandoffRelationship } = await import('../index')
    const now = Date.now()

    // Conversation 1: ralph -> tom
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
      ('h1', 'handedOffTo', 'agent:ralph', 'agent:tom',
       '{"reason": "specialization", "conversationId": "conv:a", "timestamp": "${new Date().toISOString()}"}',
       ${now});
    `)

    // Conversation 2: tom -> ralph should be allowed (different conversation)
    const handoff = await createHandoffRelationship(sqlite, {
      from: 'agent:tom',
      to: 'agent:ralph',
      reason: 'delegation',
      conversationId: 'conv:b', // Different conversation
    })

    expect(handoff).toBeDefined()
    expect(handoff.from).toBe('agent:tom')
    expect(handoff.to).toBe('agent:ralph')
  })

  it('self-handoff is considered circular', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { createHandoffRelationship } = await import('../index')

    await expect(
      createHandoffRelationship(sqlite, {
        from: 'agent:ralph',
        to: 'agent:ralph',
        reason: 'specialization',
        conversationId: 'conv:self-test',
      })
    ).rejects.toThrow(/circular|self.*handoff|same.*agent/i)
  })
})

// ============================================================================
// 4. Handoff Analytics Tests
// ============================================================================

describe('Handoff Analytics', () => {
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
          created_at INTEGER NOT NULL
        );

        CREATE INDEX rel_from_idx ON relationships("from");
        CREATE INDEX rel_to_idx ON relationships("to");
        CREATE INDEX rel_verb_idx ON relationships(verb);
      `)

      sqlite.exec(`
        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('handedOffTo', 'handOff', 'handingOff', 'handedOff', 'receivedHandoffFrom', NULL, 'Agent transfers control');
      `)

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at) VALUES
        ('agent:ralph', 1, 'Agent', '{"name": "ralph"}', ${now}, ${now}),
        ('agent:tom', 1, 'Agent', '{"name": "tom"}', ${now}, ${now}),
        ('agent:priya', 1, 'Agent', '{"name": "priya"}', ${now}, ${now}),
        ('agent:mark', 1, 'Agent', '{"name": "mark"}', ${now}, ${now}),
        ('agent:sally', 1, 'Agent', '{"name": "sally"}', ${now}, ${now});
      `)

      // Seed handoff data for analytics
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
        ('h1', 'handedOffTo', 'agent:ralph', 'agent:tom', '{"reason": "specialization", "conversationId": "c1"}', ${now - 5000}),
        ('h2', 'handedOffTo', 'agent:tom', 'agent:priya', '{"reason": "completion", "conversationId": "c1"}', ${now - 4000}),
        ('h3', 'handedOffTo', 'agent:ralph', 'agent:tom', '{"reason": "specialization", "conversationId": "c2"}', ${now - 3000}),
        ('h4', 'handedOffTo', 'agent:ralph', 'agent:mark', '{"reason": "delegation", "conversationId": "c3"}', ${now - 2000}),
        ('h5', 'handedOffTo', 'agent:mark', 'agent:sally', '{"reason": "routing", "conversationId": "c3"}', ${now - 1000}),
        ('h6', 'handedOffTo', 'agent:priya', 'agent:tom', '{"reason": "escalation", "conversationId": "c4"}', ${now});
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('counts total handoffs', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { getHandoffAnalytics } = await import('../index')

    const analytics = await getHandoffAnalytics(sqlite)

    expect(analytics.totalHandoffs).toBe(6)
  })

  it('groups handoffs by reason', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { getHandoffAnalytics } = await import('../index')

    const analytics = await getHandoffAnalytics(sqlite)

    expect(analytics.byReason.specialization).toBe(2)
    expect(analytics.byReason.completion).toBe(1)
    expect(analytics.byReason.delegation).toBe(1)
    expect(analytics.byReason.routing).toBe(1)
    expect(analytics.byReason.escalation).toBe(1)
  })

  it('finds most common handoff pairs', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { getHandoffAnalytics } = await import('../index')

    const analytics = await getHandoffAnalytics(sqlite)

    // ralph -> tom appears twice, should be top
    expect(analytics.topHandoffPairs[0]).toEqual({
      from: 'agent:ralph',
      to: 'agent:tom',
      count: 2,
    })
  })

  it('ranks agents by handoff participation', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { getHandoffAnalytics } = await import('../index')

    const analytics = await getHandoffAnalytics(sqlite)

    // ralph handed off 3 times (as source)
    const ralph = analytics.agentParticipation.find((a) => a.agentId === 'agent:ralph')
    expect(ralph?.asSource).toBe(3)
    expect(ralph?.asTarget).toBe(0)

    // tom received 3 times (as target)
    const tom = analytics.agentParticipation.find((a) => a.agentId === 'agent:tom')
    expect(tom?.asSource).toBe(1)
    expect(tom?.asTarget).toBe(3)
  })

  it('filters analytics by time range', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { getHandoffAnalytics } = await import('../index')
    const now = Date.now()

    // Only get handoffs from last 2 seconds
    const analytics = await getHandoffAnalytics(sqlite, {
      from: new Date(now - 2500),
      to: new Date(now),
    })

    // Should only include h4, h5, h6
    expect(analytics.totalHandoffs).toBe(3)
  })

  it('filters analytics by conversation', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { getHandoffAnalytics } = await import('../index')

    const analytics = await getHandoffAnalytics(sqlite, {
      conversationId: 'c1',
    })

    expect(analytics.totalHandoffs).toBe(2)
  })

  it('gets handoff history for specific agent', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { getAgentHandoffHistory } = await import('../index')

    const history = await getAgentHandoffHistory(sqlite, 'agent:ralph')

    expect(history.outgoing).toHaveLength(3)
    expect(history.incoming).toHaveLength(0)
    expect(history.outgoing.map((h) => h.to)).toContain('agent:tom')
    expect(history.outgoing.map((h) => h.to)).toContain('agent:mark')
  })

  it('calculates average chain length', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { getHandoffAnalytics } = await import('../index')

    const analytics = await getHandoffAnalytics(sqlite)

    // c1: ralph -> tom -> priya (chain length 2)
    // c2: ralph -> tom (chain length 1)
    // c3: ralph -> mark -> sally (chain length 2)
    // c4: priya -> tom (chain length 1)
    // Average: (2 + 1 + 2 + 1) / 4 = 1.5
    expect(analytics.averageChainLength).toBeCloseTo(1.5, 1)
  })
})

// ============================================================================
// 5. Integration with HandoffProtocol Hooks Tests
// ============================================================================

describe('Integration with HandoffProtocol Hooks', () => {
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
          created_at INTEGER NOT NULL
        );

        CREATE INDEX rel_from_idx ON relationships("from");
        CREATE INDEX rel_to_idx ON relationships("to");
        CREATE INDEX rel_verb_idx ON relationships(verb);
      `)

      sqlite.exec(`
        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('handedOffTo', 'handOff', 'handingOff', 'handedOff', 'receivedHandoffFrom', NULL, 'Agent transfers control');
      `)

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at) VALUES
        ('agent:ralph', 1, 'Agent', '{"name": "ralph"}', ${now}, ${now}),
        ('agent:tom', 1, 'Agent', '{"name": "tom"}', ${now}, ${now}),
        ('agent:priya', 1, 'Agent', '{"name": "priya"}', ${now}, ${now});
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('creates graph-backed handoff hooks', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { createGraphBackedHandoffHooks } = await import('../index')

    const hooks = createGraphBackedHandoffHooks(sqlite)

    expect(hooks.onHandoffComplete).toBeDefined()
    expect(hooks.validateHandoff).toBeDefined()
    expect(typeof hooks.onHandoffComplete).toBe('function')
    expect(typeof hooks.validateHandoff).toBe('function')
  })

  it('validates handoff via graph circular check', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { createGraphBackedHandoffHooks } = await import('../index')
    const now = Date.now()

    // Set up existing handoff: ralph -> tom
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
      ('h1', 'handedOffTo', 'agent:ralph', 'agent:tom',
       '{"reason": "specialization", "conversationId": "conv:hooks-test", "timestamp": "${new Date().toISOString()}"}',
       ${now});
    `)

    const hooks = createGraphBackedHandoffHooks(sqlite)

    // Validate tom -> priya (should be allowed)
    const validRequest = {
      id: 'req-1',
      sourceAgentId: 'agent:tom',
      targetAgentId: 'agent:priya',
      reason: 'completion' as const,
      context: { messages: [], metadata: { conversationId: 'conv:hooks-test' } },
      initiatedAt: new Date(),
    }

    const isValid = await hooks.validateHandoff!(validRequest)
    expect(isValid).toBe(true)

    // Validate tom -> ralph (should be rejected - circular)
    const circularRequest = {
      id: 'req-2',
      sourceAgentId: 'agent:tom',
      targetAgentId: 'agent:ralph',
      reason: 'escalation' as const,
      context: { messages: [], metadata: { conversationId: 'conv:hooks-test' } },
      initiatedAt: new Date(),
    }

    const isCircular = await hooks.validateHandoff!(circularRequest)
    expect(isCircular).toBe(false)
  })

  it('records handoff relationship on complete', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { createGraphBackedHandoffHooks, getHandoffChain } = await import('../index')

    const hooks = createGraphBackedHandoffHooks(sqlite)

    const handoffResult = {
      request: {
        id: 'handoff-complete-test',
        sourceAgentId: 'agent:ralph',
        targetAgentId: 'agent:tom',
        reason: 'specialization' as const,
        context: {
          messages: [],
          summary: 'Code complete, needs review',
          metadata: { conversationId: 'conv:complete-test' },
        },
        initiatedAt: new Date(),
      },
      state: 'completed' as const,
      result: { text: 'Reviewed', messages: [], steps: 1 },
      completedAt: new Date(),
      durationMs: 1500,
    }

    await hooks.onHandoffComplete!(handoffResult)

    // Verify relationship was created
    const chain = await getHandoffChain(sqlite, 'agent:ralph', 'conv:complete-test')

    expect(chain).toHaveLength(2)
    expect(chain[0].agentId).toBe('agent:ralph')
    expect(chain[1].agentId).toBe('agent:tom')
  })

  it('includes handoff duration in relationship data', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { createGraphBackedHandoffHooks, getHandoffsBetweenAgents } = await import('../index')

    const hooks = createGraphBackedHandoffHooks(sqlite)

    const handoffResult = {
      request: {
        id: 'duration-test',
        sourceAgentId: 'agent:ralph',
        targetAgentId: 'agent:tom',
        reason: 'delegation' as const,
        context: {
          messages: [],
          metadata: { conversationId: 'conv:duration-test' },
        },
        initiatedAt: new Date(),
      },
      state: 'completed' as const,
      result: { text: 'Done', messages: [], steps: 1 },
      completedAt: new Date(),
      durationMs: 2500,
    }

    await hooks.onHandoffComplete!(handoffResult)

    const handoffs = await getHandoffsBetweenAgents(sqlite, 'agent:ralph', 'agent:tom', 'conv:duration-test')

    expect(handoffs[0].data.durationMs).toBe(2500)
  })
})

// ============================================================================
// 6. Edge Cases and Error Handling Tests
// ============================================================================

describe('Edge Cases and Error Handling', () => {
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
          created_at INTEGER NOT NULL
        );
      `)

      sqlite.exec(`
        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('handedOffTo', 'handOff', 'handingOff', 'handedOff', 'receivedHandoffFrom', NULL, 'Agent transfers control');
      `)

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at) VALUES
        ('agent:ralph', 1, 'Agent', '{"name": "ralph"}', ${now}, ${now}),
        ('agent:tom', 1, 'Agent', '{"name": "tom"}', ${now}, ${now});
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('handles empty context gracefully', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { createHandoffRelationship } = await import('../index')

    const handoff = await createHandoffRelationship(sqlite, {
      from: 'agent:ralph',
      to: 'agent:tom',
      reason: 'routing',
      // No context provided
    })

    expect(handoff.data.context).toBeUndefined()
  })

  it('handles very long context summary', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { createHandoffRelationship } = await import('../index')

    const longSummary = 'A'.repeat(10000)

    const handoff = await createHandoffRelationship(sqlite, {
      from: 'agent:ralph',
      to: 'agent:tom',
      reason: 'completion',
      context: { summary: longSummary },
    })

    expect(handoff.data.context?.summary?.length).toBe(10000)
  })

  it('handles special characters in context', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { createHandoffRelationship } = await import('../index')

    const handoff = await createHandoffRelationship(sqlite, {
      from: 'agent:ralph',
      to: 'agent:tom',
      reason: 'delegation',
      context: {
        summary: "User's request: <script>alert('xss')</script> & unicode: \u00e9\u00f1\u00fc",
        instructions: 'Handle "quoted" values and \\backslashes\\',
        variables: { json: '{"nested": "value"}' },
      },
    })

    expect(handoff.data.context?.summary).toContain('<script>')
    expect(handoff.data.context?.summary).toContain('\u00e9')
    expect(handoff.data.context?.instructions).toContain('"quoted"')
  })

  it('handles concurrent handoff creations', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { createHandoffRelationship } = await import('../index')

    // Create multiple handoffs concurrently
    const promises = Array.from({ length: 10 }, (_, i) =>
      createHandoffRelationship(sqlite, {
        from: 'agent:ralph',
        to: 'agent:tom',
        reason: 'delegation',
        conversationId: `conv:concurrent-${i}`,
      })
    )

    const results = await Promise.all(promises)

    // All should succeed with unique IDs
    const ids = results.map((r) => r.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(10)
  })

  it('handles deleted agent in chain', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { getHandoffChain } = await import('../index')
    const now = Date.now()

    // Create handoff chain
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
      ('h1', 'handedOffTo', 'agent:ralph', 'agent:tom',
       '{"reason": "specialization", "conversationId": "conv:deleted-test"}',
       ${now});
    `)

    // Mark tom as deleted
    sqlite.exec(`
      UPDATE graph_things SET deleted_at = ${now} WHERE id = 'agent:tom';
    `)

    // Chain should still work (historical data)
    const chain = await getHandoffChain(sqlite, 'agent:ralph', 'conv:deleted-test', {
      includeDeleted: true,
    })

    expect(chain).toHaveLength(2)
    expect(chain[1].agentId).toBe('agent:tom')
  })

  it('handles maximum chain depth', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const { getHandoffChain } = await import('../index')
    const now = Date.now()

    // Create 20 agents
    const agents = Array.from({ length: 20 }, (_, i) => `agent:agent${i}`)

    for (const agentId of agents) {
      sqlite.exec(`
        INSERT OR IGNORE INTO graph_things (id, type_id, type_name, data, created_at, updated_at)
        VALUES ('${agentId}', 1, 'Agent', '{"name": "${agentId}"}', ${now}, ${now});
      `)
    }

    // Create a long chain: agent0 -> agent1 -> ... -> agent19
    for (let i = 0; i < 19; i++) {
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
        ('chain-${i}', 'handedOffTo', '${agents[i]}', '${agents[i + 1]}',
         '{"reason": "delegation", "conversationId": "conv:long-chain"}',
         ${now + i});
      `)
    }

    // Chain retrieval should respect max depth
    const chain = await getHandoffChain(sqlite, 'agent:agent0', 'conv:long-chain', {
      maxDepth: 10,
    })

    expect(chain).toHaveLength(11) // 10 hops + starting agent
  })
})
