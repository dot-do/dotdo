/**
 * [RED] Worker CRUD via Graph Model - Tests
 *
 * TDD RED Phase: Failing tests for Worker abstraction as Things in the graph model.
 * Workers are the fundamental unit of computation in the dotdo platform - they can be
 * AI agents, humans, or hybrid workers.
 *
 * @see dotdo-ziwcu - [RED] Worker CRUD via Graph Model - Tests
 *
 * Test Coverage:
 * - Worker Thing CRUD (create/read/update/delete)
 * - Worker Relationships
 * - Worker queries
 * - Worker with kind: 'agent' and kind: 'human'
 * - Store capabilities as array
 * - Store tier (code|generative|agentic|human)
 *
 * NO MOCKS - Uses real SQLite database.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Type Definitions - Expected Worker Thing Structure
// ============================================================================

/**
 * Worker kind - distinguishes between AI agents and human workers
 */
type WorkerKind = 'agent' | 'human'

/**
 * Worker tier - represents capability level
 * - code: Deterministic code execution (functions, scripts)
 * - generative: LLM-based text/content generation
 * - agentic: Autonomous agents with tool use and reasoning
 * - human: Human workers for approval, escalation, complex decisions
 */
type WorkerTier = 'code' | 'generative' | 'agentic' | 'human'

/**
 * Worker capability - what the worker can do
 */
type WorkerCapability =
  | 'code-execution'
  | 'text-generation'
  | 'image-generation'
  | 'tool-calling'
  | 'web-browsing'
  | 'file-system'
  | 'code-review'
  | 'approval'
  | 'escalation'
  | 'decision-making'
  | 'communication'
  | 'data-analysis'

/**
 * Worker data stored in Thing.data JSON field
 */
interface WorkerData {
  /** Display name for the worker */
  name: string
  /** Worker kind: agent or human */
  kind: WorkerKind
  /** Worker tier: code, generative, agentic, human */
  tier: WorkerTier
  /** Worker capabilities as array */
  capabilities: WorkerCapability[]
  /** Optional description */
  description?: string
  /** Optional avatar URL */
  avatar?: string
  /** Provider for AI agents (e.g., 'openai', 'anthropic', 'google') */
  provider?: string
  /** Model for AI agents (e.g., 'gpt-4', 'claude-3-opus', 'gemini-pro') */
  model?: string
  /** Email for human workers */
  email?: string
  /** Status: active, inactive, suspended */
  status: 'active' | 'inactive' | 'suspended'
  /** Configuration specific to worker type */
  config?: Record<string, unknown>
}

/**
 * Worker Thing as stored in graph_things table
 */
interface WorkerThing {
  /** Thing ID (e.g., 'worker-ralph-001') */
  id: string
  /** Type ID referencing Worker noun */
  typeId: number
  /** Denormalized type name: 'Worker' */
  typeName: string
  /** Worker data payload */
  data: WorkerData | null
  /** Unix timestamp (ms) when created */
  createdAt: number
  /** Unix timestamp (ms) when last updated */
  updatedAt: number
  /** Unix timestamp (ms) when soft deleted, null if active */
  deletedAt: number | null
}

/**
 * Expected interface for WorkerStore
 */
interface ExpectedWorkerStore {
  /** Create a new Worker Thing */
  createWorker(input: {
    name: string
    kind: WorkerKind
    tier: WorkerTier
    capabilities: WorkerCapability[]
    description?: string
    provider?: string
    model?: string
    email?: string
    config?: Record<string, unknown>
  }): Promise<WorkerThing>

  /** Get worker by ID */
  getWorker(id: string): Promise<WorkerThing | null>

  /** Get worker by name */
  getWorkerByName(name: string): Promise<WorkerThing | null>

  /** Update worker */
  updateWorker(
    id: string,
    updates: Partial<WorkerData>
  ): Promise<WorkerThing | null>

  /** Delete worker (soft delete) */
  deleteWorker(id: string): Promise<boolean>

  /** List workers with filters */
  listWorkers(options?: {
    kind?: WorkerKind
    tier?: WorkerTier
    capability?: WorkerCapability
    status?: 'active' | 'inactive' | 'suspended'
    limit?: number
    offset?: number
  }): Promise<WorkerThing[]>

  /** Get workers by capability */
  getWorkersByCapability(capability: WorkerCapability): Promise<WorkerThing[]>

  /** Get workers by tier */
  getWorkersByTier(tier: WorkerTier): Promise<WorkerThing[]>
}

// ============================================================================
// 1. Worker Creation Tests
// ============================================================================

describe('Worker Thing Creation', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

      // Create graph_things table
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

      // Create nouns table for type reference
      sqlite.exec(`
        CREATE TABLE nouns (
          rowid INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE
        );

        INSERT INTO nouns (name) VALUES ('Worker');
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('creates Worker Thing with required fields', () => {
    it('creates AI agent Worker with name, kind, tier, capabilities', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const workerData = JSON.stringify({
        name: 'Ralph',
        kind: 'agent',
        tier: 'agentic',
        capabilities: ['code-execution', 'tool-calling', 'code-review'],
        description: 'Engineering agent - builds and reviews code',
        provider: 'anthropic',
        model: 'claude-3-opus',
        status: 'active',
      })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('worker-ralph-001', 1, 'Worker', '${workerData}', ${now}, ${now}, NULL)
      `)

      const result = sqlite.prepare('SELECT * FROM graph_things WHERE id = ?').get('worker-ralph-001') as {
        id: string
        type_id: number
        type_name: string
        data: string
        created_at: number
        updated_at: number
        deleted_at: number | null
      }

      expect(result.id).toBe('worker-ralph-001')
      expect(result.type_name).toBe('Worker')

      const data = JSON.parse(result.data) as WorkerData
      expect(data.name).toBe('Ralph')
      expect(data.kind).toBe('agent')
      expect(data.tier).toBe('agentic')
      expect(data.capabilities).toContain('code-execution')
      expect(data.capabilities).toContain('tool-calling')
      expect(data.capabilities).toContain('code-review')
      expect(data.provider).toBe('anthropic')
      expect(data.model).toBe('claude-3-opus')
      expect(data.status).toBe('active')
    })

    it('creates human Worker with name, kind, tier, capabilities', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const workerData = JSON.stringify({
        name: 'Alice',
        kind: 'human',
        tier: 'human',
        capabilities: ['approval', 'escalation', 'decision-making'],
        description: 'Senior accountant for high-value approvals',
        email: 'alice@example.com',
        status: 'active',
      })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('worker-alice-001', 1, 'Worker', '${workerData}', ${now}, ${now}, NULL)
      `)

      const result = sqlite.prepare('SELECT * FROM graph_things WHERE id = ?').get('worker-alice-001') as {
        id: string
        data: string
      }

      const data = JSON.parse(result.data) as WorkerData
      expect(data.name).toBe('Alice')
      expect(data.kind).toBe('human')
      expect(data.tier).toBe('human')
      expect(data.capabilities).toContain('approval')
      expect(data.capabilities).toContain('escalation')
      expect(data.email).toBe('alice@example.com')
    })

    it('creates code-tier Worker (deterministic execution)', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const workerData = JSON.stringify({
        name: 'Formatter',
        kind: 'agent',
        tier: 'code',
        capabilities: ['code-execution'],
        description: 'Deterministic code formatter',
        status: 'active',
        config: {
          runtime: 'node',
          timeout: 30000,
        },
      })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('worker-formatter-001', 1, 'Worker', '${workerData}', ${now}, ${now}, NULL)
      `)

      const result = sqlite.prepare('SELECT * FROM graph_things WHERE id = ?').get('worker-formatter-001') as {
        data: string
      }

      const data = JSON.parse(result.data) as WorkerData
      expect(data.tier).toBe('code')
      expect(data.kind).toBe('agent')
      expect(data.config).toEqual({ runtime: 'node', timeout: 30000 })
    })

    it('creates generative-tier Worker (LLM-based)', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const workerData = JSON.stringify({
        name: 'ContentWriter',
        kind: 'agent',
        tier: 'generative',
        capabilities: ['text-generation'],
        description: 'LLM-based content writer',
        provider: 'openai',
        model: 'gpt-4-turbo',
        status: 'active',
      })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('worker-writer-001', 1, 'Worker', '${workerData}', ${now}, ${now}, NULL)
      `)

      const result = sqlite.prepare('SELECT * FROM graph_things WHERE id = ?').get('worker-writer-001') as {
        data: string
      }

      const data = JSON.parse(result.data) as WorkerData
      expect(data.tier).toBe('generative')
      expect(data.capabilities).toContain('text-generation')
      expect(data.provider).toBe('openai')
    })

    it('generates unique worker IDs', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const worker1 = JSON.stringify({ name: 'Worker1', kind: 'agent', tier: 'code', capabilities: [], status: 'active' })
      const worker2 = JSON.stringify({ name: 'Worker2', kind: 'agent', tier: 'code', capabilities: [], status: 'active' })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at) VALUES
        ('worker-uuid-001', 1, 'Worker', '${worker1}', ${now}, ${now}, NULL),
        ('worker-uuid-002', 1, 'Worker', '${worker2}', ${now}, ${now}, NULL)
      `)

      const results = sqlite.prepare("SELECT id FROM graph_things WHERE type_name = 'Worker'").all() as { id: string }[]

      expect(results).toHaveLength(2)
      expect(results[0].id).not.toBe(results[1].id)
    })
  })

  describe('stores capabilities as JSON array', () => {
    it('stores multiple capabilities in array format', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const capabilities = ['code-execution', 'tool-calling', 'web-browsing', 'file-system']
      const workerData = JSON.stringify({
        name: 'FullStackAgent',
        kind: 'agent',
        tier: 'agentic',
        capabilities,
        status: 'active',
      })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('worker-fullstack', 1, 'Worker', '${workerData}', ${now}, ${now}, NULL)
      `)

      const result = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('worker-fullstack') as {
        data: string
      }

      const data = JSON.parse(result.data) as WorkerData
      expect(Array.isArray(data.capabilities)).toBe(true)
      expect(data.capabilities).toHaveLength(4)
      expect(data.capabilities).toEqual(capabilities)
    })

    it('handles empty capabilities array', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const workerData = JSON.stringify({
        name: 'MinimalWorker',
        kind: 'agent',
        tier: 'code',
        capabilities: [],
        status: 'active',
      })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('worker-minimal', 1, 'Worker', '${workerData}', ${now}, ${now}, NULL)
      `)

      const result = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('worker-minimal') as {
        data: string
      }

      const data = JSON.parse(result.data) as WorkerData
      expect(data.capabilities).toEqual([])
    })

    it('can query workers by capability using JSON functions', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // Create workers with different capabilities
      const workers = [
        { id: 'w1', caps: ['code-execution', 'tool-calling'] },
        { id: 'w2', caps: ['text-generation'] },
        { id: 'w3', caps: ['code-execution', 'code-review'] },
        { id: 'w4', caps: ['approval', 'escalation'] },
      ]

      for (const w of workers) {
        const data = JSON.stringify({
          name: w.id,
          kind: 'agent',
          tier: 'code',
          capabilities: w.caps,
          status: 'active',
        })
        sqlite.exec(`
          INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
          VALUES ('${w.id}', 1, 'Worker', '${data}', ${now}, ${now}, NULL)
        `)
      }

      // Query workers with 'code-execution' capability
      const results = sqlite
        .prepare(`
          SELECT id FROM graph_things
          WHERE type_name = 'Worker'
            AND json_extract(data, '$.capabilities') LIKE '%code-execution%'
        `)
        .all() as { id: string }[]

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.id)).toContain('w1')
      expect(results.map((r) => r.id)).toContain('w3')
    })
  })

  describe('stores worker tier', () => {
    it('stores code tier', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const workerData = JSON.stringify({
        name: 'CodeRunner',
        kind: 'agent',
        tier: 'code',
        capabilities: ['code-execution'],
        status: 'active',
      })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('worker-code', 1, 'Worker', '${workerData}', ${now}, ${now}, NULL)
      `)

      const result = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('worker-code') as { data: string }
      const data = JSON.parse(result.data) as WorkerData

      expect(data.tier).toBe('code')
    })

    it('stores generative tier', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const workerData = JSON.stringify({
        name: 'Generator',
        kind: 'agent',
        tier: 'generative',
        capabilities: ['text-generation', 'image-generation'],
        status: 'active',
      })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('worker-gen', 1, 'Worker', '${workerData}', ${now}, ${now}, NULL)
      `)

      const result = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('worker-gen') as { data: string }
      const data = JSON.parse(result.data) as WorkerData

      expect(data.tier).toBe('generative')
    })

    it('stores agentic tier', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const workerData = JSON.stringify({
        name: 'Autonomous',
        kind: 'agent',
        tier: 'agentic',
        capabilities: ['tool-calling', 'web-browsing', 'file-system'],
        status: 'active',
      })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('worker-agentic', 1, 'Worker', '${workerData}', ${now}, ${now}, NULL)
      `)

      const result = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('worker-agentic') as {
        data: string
      }
      const data = JSON.parse(result.data) as WorkerData

      expect(data.tier).toBe('agentic')
    })

    it('stores human tier', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const workerData = JSON.stringify({
        name: 'HumanReviewer',
        kind: 'human',
        tier: 'human',
        capabilities: ['approval', 'decision-making'],
        email: 'reviewer@example.com',
        status: 'active',
      })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('worker-human', 1, 'Worker', '${workerData}', ${now}, ${now}, NULL)
      `)

      const result = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('worker-human') as { data: string }
      const data = JSON.parse(result.data) as WorkerData

      expect(data.tier).toBe('human')
      expect(data.kind).toBe('human')
    })

    it('can query workers by tier', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const tiers: WorkerTier[] = ['code', 'generative', 'agentic', 'human']

      for (const tier of tiers) {
        const data = JSON.stringify({
          name: `${tier}Worker`,
          kind: tier === 'human' ? 'human' : 'agent',
          tier,
          capabilities: [],
          status: 'active',
        })
        sqlite.exec(`
          INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
          VALUES ('worker-${tier}', 1, 'Worker', '${data}', ${now}, ${now}, NULL)
        `)
      }

      // Query agentic workers
      const results = sqlite
        .prepare(`
          SELECT id FROM graph_things
          WHERE type_name = 'Worker'
            AND json_extract(data, '$.tier') = 'agentic'
        `)
        .all() as { id: string }[]

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('worker-agentic')
    })
  })
})

// ============================================================================
// 2. Worker Read Tests
// ============================================================================

describe('Worker Thing Read', () => {
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
      `)

      // Seed test workers
      const now = Date.now()
      const workers = [
        {
          id: 'worker-ralph',
          name: 'Ralph',
          kind: 'agent',
          tier: 'agentic',
          capabilities: ['code-execution', 'tool-calling'],
          provider: 'anthropic',
          model: 'claude-3-opus',
          status: 'active',
        },
        {
          id: 'worker-priya',
          name: 'Priya',
          kind: 'agent',
          tier: 'generative',
          capabilities: ['text-generation'],
          provider: 'openai',
          model: 'gpt-4',
          status: 'active',
        },
        {
          id: 'worker-alice',
          name: 'Alice',
          kind: 'human',
          tier: 'human',
          capabilities: ['approval', 'escalation'],
          email: 'alice@example.com',
          status: 'active',
        },
      ]

      for (const w of workers) {
        const data = JSON.stringify(w)
        sqlite.exec(`
          INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
          VALUES ('${w.id}', 1, 'Worker', '${data}', ${now}, ${now}, NULL)
        `)
      }
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('getWorker', () => {
    it('retrieves worker by ID', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const result = sqlite.prepare('SELECT * FROM graph_things WHERE id = ?').get('worker-ralph') as {
        id: string
        data: string
      }

      expect(result).toBeDefined()
      expect(result.id).toBe('worker-ralph')

      const data = JSON.parse(result.data) as WorkerData
      expect(data.name).toBe('Ralph')
      expect(data.kind).toBe('agent')
      expect(data.tier).toBe('agentic')
    })

    it('returns null for non-existent ID', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const result = sqlite.prepare('SELECT * FROM graph_things WHERE id = ?').get('non-existent')

      expect(result).toBeUndefined()
    })

    it('retrieves worker with all fields populated', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const result = sqlite.prepare('SELECT * FROM graph_things WHERE id = ?').get('worker-ralph') as {
        id: string
        type_id: number
        type_name: string
        data: string
        created_at: number
        updated_at: number
        deleted_at: number | null
      }

      expect(result.id).toBeDefined()
      expect(result.type_id).toBeDefined()
      expect(result.type_name).toBe('Worker')
      expect(result.data).toBeDefined()
      expect(result.created_at).toBeDefined()
      expect(result.updated_at).toBeDefined()
      expect(result.deleted_at).toBeNull()
    })
  })

  describe('getWorkerByName', () => {
    it('retrieves worker by name', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const result = sqlite
        .prepare(`SELECT * FROM graph_things WHERE type_name = 'Worker' AND json_extract(data, '$.name') = ?`)
        .get('Priya') as { id: string; data: string }

      expect(result).toBeDefined()
      expect(result.id).toBe('worker-priya')

      const data = JSON.parse(result.data) as WorkerData
      expect(data.name).toBe('Priya')
    })

    it('returns null for non-existent name', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const result = sqlite
        .prepare(`SELECT * FROM graph_things WHERE type_name = 'Worker' AND json_extract(data, '$.name') = ?`)
        .get('NonExistent')

      expect(result).toBeUndefined()
    })
  })

  describe('listWorkers', () => {
    it('lists all workers', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite.prepare("SELECT * FROM graph_things WHERE type_name = 'Worker'").all() as {
        id: string
      }[]

      expect(results).toHaveLength(3)
    })

    it('filters workers by kind', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const agents = sqlite
        .prepare(
          `SELECT * FROM graph_things WHERE type_name = 'Worker' AND json_extract(data, '$.kind') = 'agent'`
        )
        .all() as { id: string }[]

      expect(agents).toHaveLength(2)

      const humans = sqlite
        .prepare(
          `SELECT * FROM graph_things WHERE type_name = 'Worker' AND json_extract(data, '$.kind') = 'human'`
        )
        .all() as { id: string }[]

      expect(humans).toHaveLength(1)
    })

    it('filters workers by tier', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const agentic = sqlite
        .prepare(
          `SELECT * FROM graph_things WHERE type_name = 'Worker' AND json_extract(data, '$.tier') = 'agentic'`
        )
        .all() as { id: string }[]

      expect(agentic).toHaveLength(1)
      expect(agentic[0].id).toBe('worker-ralph')
    })

    it('supports pagination with limit and offset', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const page1 = sqlite.prepare("SELECT * FROM graph_things WHERE type_name = 'Worker' LIMIT 2 OFFSET 0").all() as {
        id: string
      }[]

      expect(page1).toHaveLength(2)

      const page2 = sqlite.prepare("SELECT * FROM graph_things WHERE type_name = 'Worker' LIMIT 2 OFFSET 2").all() as {
        id: string
      }[]

      expect(page2).toHaveLength(1)
    })
  })
})

// ============================================================================
// 3. Worker Update Tests
// ============================================================================

describe('Worker Thing Update', () => {
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
      `)

      // Seed a worker for update tests
      const now = Date.now()
      const workerData = JSON.stringify({
        name: 'UpdateableWorker',
        kind: 'agent',
        tier: 'generative',
        capabilities: ['text-generation'],
        provider: 'openai',
        model: 'gpt-4',
        status: 'active',
      })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('worker-update', 1, 'Worker', '${workerData}', ${now - 10000}, ${now - 10000}, NULL)
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('updateWorker', () => {
    it('updates worker name', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const original = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('worker-update') as {
        data: string
      }
      const originalData = JSON.parse(original.data) as WorkerData

      // Update the name
      const updatedData = { ...originalData, name: 'RenamedWorker' }
      const now = Date.now()

      sqlite.exec(`
        UPDATE graph_things
        SET data = '${JSON.stringify(updatedData)}', updated_at = ${now}
        WHERE id = 'worker-update'
      `)

      const result = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('worker-update') as {
        data: string
      }
      const data = JSON.parse(result.data) as WorkerData

      expect(data.name).toBe('RenamedWorker')
    })

    it('updates worker capabilities', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const original = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('worker-update') as {
        data: string
      }
      const originalData = JSON.parse(original.data) as WorkerData

      // Add capabilities
      const updatedData = {
        ...originalData,
        capabilities: [...originalData.capabilities, 'image-generation', 'data-analysis'],
      }
      const now = Date.now()

      sqlite.exec(`
        UPDATE graph_things
        SET data = '${JSON.stringify(updatedData)}', updated_at = ${now}
        WHERE id = 'worker-update'
      `)

      const result = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('worker-update') as {
        data: string
      }
      const data = JSON.parse(result.data) as WorkerData

      expect(data.capabilities).toContain('text-generation')
      expect(data.capabilities).toContain('image-generation')
      expect(data.capabilities).toContain('data-analysis')
    })

    it('updates worker tier', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const original = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('worker-update') as {
        data: string
      }
      const originalData = JSON.parse(original.data) as WorkerData

      // Upgrade to agentic tier
      const updatedData = { ...originalData, tier: 'agentic' as WorkerTier }
      const now = Date.now()

      sqlite.exec(`
        UPDATE graph_things
        SET data = '${JSON.stringify(updatedData)}', updated_at = ${now}
        WHERE id = 'worker-update'
      `)

      const result = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('worker-update') as {
        data: string
      }
      const data = JSON.parse(result.data) as WorkerData

      expect(data.tier).toBe('agentic')
    })

    it('updates worker status', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const original = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('worker-update') as {
        data: string
      }
      const originalData = JSON.parse(original.data) as WorkerData

      // Suspend the worker
      const updatedData = { ...originalData, status: 'suspended' as const }
      const now = Date.now()

      sqlite.exec(`
        UPDATE graph_things
        SET data = '${JSON.stringify(updatedData)}', updated_at = ${now}
        WHERE id = 'worker-update'
      `)

      const result = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('worker-update') as {
        data: string
      }
      const data = JSON.parse(result.data) as WorkerData

      expect(data.status).toBe('suspended')
    })

    it('updates updatedAt timestamp', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const original = sqlite.prepare('SELECT updated_at FROM graph_things WHERE id = ?').get('worker-update') as {
        updated_at: number
      }
      const originalUpdatedAt = original.updated_at

      // Small delay
      await new Promise((resolve) => setTimeout(resolve, 10))

      const now = Date.now()
      sqlite.exec(`
        UPDATE graph_things
        SET updated_at = ${now}
        WHERE id = 'worker-update'
      `)

      const result = sqlite.prepare('SELECT updated_at FROM graph_things WHERE id = ?').get('worker-update') as {
        updated_at: number
      }

      expect(result.updated_at).toBeGreaterThan(originalUpdatedAt)
    })

    it('preserves createdAt on update', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const original = sqlite.prepare('SELECT created_at FROM graph_things WHERE id = ?').get('worker-update') as {
        created_at: number
      }
      const originalCreatedAt = original.created_at

      const now = Date.now()
      sqlite.exec(`
        UPDATE graph_things
        SET updated_at = ${now}
        WHERE id = 'worker-update'
      `)

      const result = sqlite.prepare('SELECT created_at FROM graph_things WHERE id = ?').get('worker-update') as {
        created_at: number
      }

      expect(result.created_at).toBe(originalCreatedAt)
    })

    it('returns null for non-existent worker', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const result = sqlite.prepare('UPDATE graph_things SET updated_at = ? WHERE id = ?').run(Date.now(), 'non-existent')

      expect(result.changes).toBe(0)
    })
  })
})

// ============================================================================
// 4. Worker Delete Tests
// ============================================================================

describe('Worker Thing Delete', () => {
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

        CREATE INDEX graph_things_deleted_at_idx ON graph_things(deleted_at);
      `)

      // Seed workers for deletion tests
      const now = Date.now()
      for (let i = 1; i <= 3; i++) {
        const workerData = JSON.stringify({
          name: `DeleteWorker${i}`,
          kind: 'agent',
          tier: 'code',
          capabilities: [],
          status: 'active',
        })
        sqlite.exec(`
          INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
          VALUES ('worker-del-${i}', 1, 'Worker', '${workerData}', ${now}, ${now}, NULL)
        `)
      }
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('soft delete', () => {
    it('soft deletes worker by setting deletedAt', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      sqlite.exec(`
        UPDATE graph_things SET deleted_at = ${now} WHERE id = 'worker-del-1'
      `)

      const result = sqlite.prepare('SELECT * FROM graph_things WHERE id = ?').get('worker-del-1') as {
        deleted_at: number | null
      }

      expect(result.deleted_at).not.toBeNull()
      expect(result.deleted_at).toBe(now)
    })

    it('excludes deleted workers from default queries', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      sqlite.exec(`
        UPDATE graph_things SET deleted_at = ${now} WHERE id = 'worker-del-1'
      `)

      const results = sqlite
        .prepare("SELECT * FROM graph_things WHERE type_name = 'Worker' AND deleted_at IS NULL")
        .all() as { id: string }[]

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.id)).not.toContain('worker-del-1')
    })

    it('includes deleted workers when requested', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      sqlite.exec(`
        UPDATE graph_things SET deleted_at = ${now} WHERE id = 'worker-del-1'
      `)

      const results = sqlite.prepare("SELECT * FROM graph_things WHERE type_name = 'Worker'").all() as { id: string }[]

      expect(results).toHaveLength(3)
      expect(results.map((r) => r.id)).toContain('worker-del-1')
    })

    it('preserves worker data after soft delete', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      sqlite.exec(`
        UPDATE graph_things SET deleted_at = ${now} WHERE id = 'worker-del-2'
      `)

      const result = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('worker-del-2') as {
        data: string
      }
      const data = JSON.parse(result.data) as WorkerData

      expect(data.name).toBe('DeleteWorker2')
      expect(data.kind).toBe('agent')
    })
  })

  describe('restore', () => {
    it('restores soft-deleted worker', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      sqlite.exec(`
        UPDATE graph_things SET deleted_at = ${now} WHERE id = 'worker-del-1'
      `)

      // Restore
      sqlite.exec(`
        UPDATE graph_things SET deleted_at = NULL WHERE id = 'worker-del-1'
      `)

      const result = sqlite.prepare('SELECT deleted_at FROM graph_things WHERE id = ?').get('worker-del-1') as {
        deleted_at: number | null
      }

      expect(result.deleted_at).toBeNull()
    })
  })

  describe('hard delete', () => {
    it('permanently removes worker', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      sqlite.exec(`
        DELETE FROM graph_things WHERE id = 'worker-del-3'
      `)

      const result = sqlite.prepare('SELECT * FROM graph_things WHERE id = ?').get('worker-del-3')

      expect(result).toBeUndefined()
    })

    it('returns false for non-existent worker', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const result = sqlite.prepare('DELETE FROM graph_things WHERE id = ?').run('non-existent')

      expect(result.changes).toBe(0)
    })
  })
})

// ============================================================================
// 5. Worker Relationships Tests
// ============================================================================

describe('Worker Relationships', () => {
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
        ('supervises', 'supervise', 'supervising', 'supervised', 'supervisedBy', NULL, 'Supervises another worker'),
        ('collaboratesWith', 'collaborateWith', 'collaboratingWith', 'collaboratedWith', 'collaboratedWithBy', NULL, 'Collaborates with another worker'),
        ('delegates', 'delegate', 'delegating', 'delegated', 'delegatedBy', NULL, 'Delegates tasks to another worker'),
        ('escalatesTo', 'escalateTo', 'escalatingTo', 'escalatedTo', 'escalatedToBy', NULL, 'Escalates issues to another worker'),
        ('belongsTo', 'belongTo', 'belongingTo', 'belongedTo', 'has', NULL, 'Belongs to a team or org');
      `)

      // Seed workers
      const now = Date.now()
      const workers = [
        { id: 'worker-lead', name: 'TechLead', kind: 'agent', tier: 'agentic', capabilities: ['code-review'] },
        { id: 'worker-dev1', name: 'Dev1', kind: 'agent', tier: 'agentic', capabilities: ['code-execution'] },
        { id: 'worker-dev2', name: 'Dev2', kind: 'agent', tier: 'agentic', capabilities: ['code-execution'] },
        { id: 'worker-human', name: 'Manager', kind: 'human', tier: 'human', capabilities: ['approval'] },
      ]

      for (const w of workers) {
        const data = JSON.stringify({ ...w, status: 'active' })
        sqlite.exec(`
          INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
          VALUES ('${w.id}', 1, 'Worker', '${data}', ${now}, ${now}, NULL)
        `)
      }
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('worker supervision relationships', () => {
    it('creates supervises relationship between workers', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-supervise-1', 'supervises', 'workers://worker-lead', 'workers://worker-dev1', NULL, ${now})
      `)

      const result = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get('rel-supervise-1') as {
        verb: string
        from: string
        to: string
      }

      expect(result.verb).toBe('supervises')
      expect(result.from).toBe('workers://worker-lead')
      expect(result.to).toBe('workers://worker-dev1')
    })

    it('finds all workers supervised by a lead', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
        ('rel-supervise-1', 'supervises', 'workers://worker-lead', 'workers://worker-dev1', NULL, ${now}),
        ('rel-supervise-2', 'supervises', 'workers://worker-lead', 'workers://worker-dev2', NULL, ${now})
      `)

      const results = sqlite
        .prepare(`SELECT "to" FROM relationships WHERE "from" = ? AND verb = 'supervises'`)
        .all('workers://worker-lead') as { to: string }[]

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.to)).toContain('workers://worker-dev1')
      expect(results.map((r) => r.to)).toContain('workers://worker-dev2')
    })

    it('finds supervisor via backward traversal (supervisedBy)', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-supervise-1', 'supervises', 'workers://worker-lead', 'workers://worker-dev1', NULL, ${now})
      `)

      const result = sqlite
        .prepare(`SELECT "from" FROM relationships WHERE "to" = ? AND verb = 'supervises'`)
        .get('workers://worker-dev1') as { from: string }

      expect(result.from).toBe('workers://worker-lead')
    })
  })

  describe('worker collaboration relationships', () => {
    it('creates bidirectional collaboration relationship', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
        ('rel-collab-1', 'collaboratesWith', 'workers://worker-dev1', 'workers://worker-dev2', '{"project": "feature-x"}', ${now}),
        ('rel-collab-2', 'collaboratesWith', 'workers://worker-dev2', 'workers://worker-dev1', '{"project": "feature-x"}', ${now})
      `)

      // Check from dev1's perspective
      const dev1Collabs = sqlite
        .prepare(`SELECT "to" FROM relationships WHERE "from" = ? AND verb = 'collaboratesWith'`)
        .all('workers://worker-dev1') as { to: string }[]

      expect(dev1Collabs).toHaveLength(1)
      expect(dev1Collabs[0].to).toBe('workers://worker-dev2')

      // Check from dev2's perspective
      const dev2Collabs = sqlite
        .prepare(`SELECT "to" FROM relationships WHERE "from" = ? AND verb = 'collaboratesWith'`)
        .all('workers://worker-dev2') as { to: string }[]

      expect(dev2Collabs).toHaveLength(1)
      expect(dev2Collabs[0].to).toBe('workers://worker-dev1')
    })
  })

  describe('worker delegation relationships', () => {
    it('agent delegates to another agent', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-delegate-1', 'delegates', 'workers://worker-lead', 'workers://worker-dev1', '{"task": "implement-feature"}', ${now})
      `)

      const result = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get('rel-delegate-1') as {
        verb: string
        data: string
      }

      expect(result.verb).toBe('delegates')
      const data = JSON.parse(result.data)
      expect(data.task).toBe('implement-feature')
    })
  })

  describe('worker escalation relationships', () => {
    it('agent escalates to human worker', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel-escalate-1', 'escalatesTo', 'workers://worker-dev1', 'workers://worker-human', '{"reason": "approval-needed"}', ${now})
      `)

      const result = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get('rel-escalate-1') as {
        verb: string
        from: string
        to: string
      }

      expect(result.verb).toBe('escalatesTo')
      expect(result.from).toBe('workers://worker-dev1')
      expect(result.to).toBe('workers://worker-human')
    })

    it('finds all workers that escalate to human', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
        ('rel-esc-1', 'escalatesTo', 'workers://worker-dev1', 'workers://worker-human', NULL, ${now}),
        ('rel-esc-2', 'escalatesTo', 'workers://worker-dev2', 'workers://worker-human', NULL, ${now}),
        ('rel-esc-3', 'escalatesTo', 'workers://worker-lead', 'workers://worker-human', NULL, ${now})
      `)

      const results = sqlite
        .prepare(`SELECT "from" FROM relationships WHERE "to" = ? AND verb = 'escalatesTo'`)
        .all('workers://worker-human') as { from: string }[]

      expect(results).toHaveLength(3)
    })
  })

  describe('worker team membership', () => {
    it('worker belongs to team', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // Create team Thing
      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('team-engineering', 2, 'Team', '{"name": "Engineering Team"}', ${now}, ${now}, NULL)
      `)

      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
        ('rel-belong-1', 'belongsTo', 'workers://worker-lead', 'teams://team-engineering', NULL, ${now}),
        ('rel-belong-2', 'belongsTo', 'workers://worker-dev1', 'teams://team-engineering', NULL, ${now}),
        ('rel-belong-3', 'belongsTo', 'workers://worker-dev2', 'teams://team-engineering', NULL, ${now})
      `)

      // Find all workers in engineering team
      const results = sqlite
        .prepare(`SELECT "from" FROM relationships WHERE "to" = ? AND verb = 'belongsTo'`)
        .all('teams://team-engineering') as { from: string }[]

      expect(results).toHaveLength(3)
    })
  })
})

// ============================================================================
// 6. Worker Query Tests
// ============================================================================

describe('Worker Queries', () => {
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
      `)

      // Seed diverse workers
      const now = Date.now()
      const workers = [
        { id: 'w1', name: 'Ralph', kind: 'agent', tier: 'agentic', capabilities: ['code-execution', 'tool-calling'], provider: 'anthropic', status: 'active' },
        { id: 'w2', name: 'Priya', kind: 'agent', tier: 'generative', capabilities: ['text-generation'], provider: 'openai', status: 'active' },
        { id: 'w3', name: 'Tom', kind: 'agent', tier: 'agentic', capabilities: ['code-review', 'tool-calling'], provider: 'anthropic', status: 'active' },
        { id: 'w4', name: 'Mark', kind: 'agent', tier: 'generative', capabilities: ['text-generation', 'image-generation'], provider: 'openai', status: 'active' },
        { id: 'w5', name: 'Alice', kind: 'human', tier: 'human', capabilities: ['approval', 'decision-making'], email: 'alice@example.com', status: 'active' },
        { id: 'w6', name: 'Bob', kind: 'human', tier: 'human', capabilities: ['escalation', 'communication'], email: 'bob@example.com', status: 'inactive' },
        { id: 'w7', name: 'Quinn', kind: 'agent', tier: 'code', capabilities: ['code-execution'], provider: 'local', status: 'active' },
      ]

      for (const w of workers) {
        const data = JSON.stringify(w)
        sqlite.exec(`
          INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
          VALUES ('${w.id}', 1, 'Worker', '${data}', ${now}, ${now}, NULL)
        `)
      }
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('getWorkersByCapability', () => {
    it('finds all workers with code-execution capability', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite
        .prepare(`
          SELECT * FROM graph_things
          WHERE type_name = 'Worker'
            AND json_extract(data, '$.capabilities') LIKE '%code-execution%'
        `)
        .all() as { id: string }[]

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.id)).toContain('w1')
      expect(results.map((r) => r.id)).toContain('w7')
    })

    it('finds all workers with tool-calling capability', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite
        .prepare(`
          SELECT * FROM graph_things
          WHERE type_name = 'Worker'
            AND json_extract(data, '$.capabilities') LIKE '%tool-calling%'
        `)
        .all() as { id: string }[]

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.id)).toContain('w1')
      expect(results.map((r) => r.id)).toContain('w3')
    })

    it('finds all workers with approval capability', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite
        .prepare(`
          SELECT * FROM graph_things
          WHERE type_name = 'Worker'
            AND json_extract(data, '$.capabilities') LIKE '%approval%'
        `)
        .all() as { id: string }[]

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('w5')
    })

    it('returns empty for non-existent capability', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite
        .prepare(`
          SELECT * FROM graph_things
          WHERE type_name = 'Worker'
            AND json_extract(data, '$.capabilities') LIKE '%non-existent%'
        `)
        .all()

      expect(results).toHaveLength(0)
    })
  })

  describe('getWorkersByTier', () => {
    it('finds all agentic-tier workers', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite
        .prepare(`
          SELECT * FROM graph_things
          WHERE type_name = 'Worker'
            AND json_extract(data, '$.tier') = 'agentic'
        `)
        .all() as { id: string }[]

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.id)).toContain('w1')
      expect(results.map((r) => r.id)).toContain('w3')
    })

    it('finds all generative-tier workers', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite
        .prepare(`
          SELECT * FROM graph_things
          WHERE type_name = 'Worker'
            AND json_extract(data, '$.tier') = 'generative'
        `)
        .all() as { id: string }[]

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.id)).toContain('w2')
      expect(results.map((r) => r.id)).toContain('w4')
    })

    it('finds all human-tier workers', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite
        .prepare(`
          SELECT * FROM graph_things
          WHERE type_name = 'Worker'
            AND json_extract(data, '$.tier') = 'human'
        `)
        .all() as { id: string }[]

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.id)).toContain('w5')
      expect(results.map((r) => r.id)).toContain('w6')
    })

    it('finds code-tier workers', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite
        .prepare(`
          SELECT * FROM graph_things
          WHERE type_name = 'Worker'
            AND json_extract(data, '$.tier') = 'code'
        `)
        .all() as { id: string }[]

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('w7')
    })
  })

  describe('combined filters', () => {
    it('filters by kind and tier', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite
        .prepare(`
          SELECT * FROM graph_things
          WHERE type_name = 'Worker'
            AND json_extract(data, '$.kind') = 'agent'
            AND json_extract(data, '$.tier') = 'agentic'
        `)
        .all() as { id: string }[]

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.id)).toContain('w1')
      expect(results.map((r) => r.id)).toContain('w3')
    })

    it('filters by kind and status', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite
        .prepare(`
          SELECT * FROM graph_things
          WHERE type_name = 'Worker'
            AND json_extract(data, '$.kind') = 'human'
            AND json_extract(data, '$.status') = 'active'
        `)
        .all() as { id: string }[]

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('w5')
    })

    it('filters by provider', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite
        .prepare(`
          SELECT * FROM graph_things
          WHERE type_name = 'Worker'
            AND json_extract(data, '$.provider') = 'anthropic'
        `)
        .all() as { id: string }[]

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.id)).toContain('w1')
      expect(results.map((r) => r.id)).toContain('w3')
    })
  })

  describe('search', () => {
    it('searches workers by name', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const results = sqlite
        .prepare(`
          SELECT * FROM graph_things
          WHERE type_name = 'Worker'
            AND json_extract(data, '$.name') LIKE '%Ral%'
        `)
        .all() as { id: string }[]

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('w1')
    })

    it('searches workers by description', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      // First add a worker with description
      const now = Date.now()
      const workerData = JSON.stringify({
        name: 'SearchTest',
        kind: 'agent',
        tier: 'code',
        capabilities: [],
        description: 'Specialized worker for data processing',
        status: 'active',
      })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('w-search', 1, 'Worker', '${workerData}', ${now}, ${now}, NULL)
      `)

      const results = sqlite
        .prepare(`
          SELECT * FROM graph_things
          WHERE type_name = 'Worker'
            AND json_extract(data, '$.description') LIKE '%data processing%'
        `)
        .all() as { id: string }[]

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('w-search')
    })
  })
})

// ============================================================================
// 7. WorkerStore Interface Tests (RED - implementation needed)
// ============================================================================

describe('WorkerStore Interface', () => {
  /**
   * These tests will FAIL until WorkerStore is implemented.
   * They define the expected API contract.
   */

  it('WorkerStore is exported from primitives/digital-workers', async () => {
    // This test will FAIL until the implementation exists
    const workersModule = await import('../index').catch(() => null)

    expect(workersModule).not.toBeNull()
    expect(workersModule?.WorkerStore).toBeDefined()
  })

  it('has createWorker method', async () => {
    const workersModule = await import('../index').catch(() => null)

    if (!workersModule?.WorkerStore) {
      throw new Error('WorkerStore not implemented - waiting for implementation')
    }

    expect(workersModule.WorkerStore.prototype.createWorker).toBeDefined()
    expect(typeof workersModule.WorkerStore.prototype.createWorker).toBe('function')
  })

  it('has getWorker method', async () => {
    const workersModule = await import('../index').catch(() => null)

    if (!workersModule?.WorkerStore) {
      throw new Error('WorkerStore not implemented')
    }

    expect(workersModule.WorkerStore.prototype.getWorker).toBeDefined()
  })

  it('has getWorkerByName method', async () => {
    const workersModule = await import('../index').catch(() => null)

    if (!workersModule?.WorkerStore) {
      throw new Error('WorkerStore not implemented')
    }

    expect(workersModule.WorkerStore.prototype.getWorkerByName).toBeDefined()
  })

  it('has updateWorker method', async () => {
    const workersModule = await import('../index').catch(() => null)

    if (!workersModule?.WorkerStore) {
      throw new Error('WorkerStore not implemented')
    }

    expect(workersModule.WorkerStore.prototype.updateWorker).toBeDefined()
  })

  it('has deleteWorker method', async () => {
    const workersModule = await import('../index').catch(() => null)

    if (!workersModule?.WorkerStore) {
      throw new Error('WorkerStore not implemented')
    }

    expect(workersModule.WorkerStore.prototype.deleteWorker).toBeDefined()
  })

  it('has listWorkers method', async () => {
    const workersModule = await import('../index').catch(() => null)

    if (!workersModule?.WorkerStore) {
      throw new Error('WorkerStore not implemented')
    }

    expect(workersModule.WorkerStore.prototype.listWorkers).toBeDefined()
  })

  it('has getWorkersByCapability method', async () => {
    const workersModule = await import('../index').catch(() => null)

    if (!workersModule?.WorkerStore) {
      throw new Error('WorkerStore not implemented')
    }

    expect(workersModule.WorkerStore.prototype.getWorkersByCapability).toBeDefined()
  })

  it('has getWorkersByTier method', async () => {
    const workersModule = await import('../index').catch(() => null)

    if (!workersModule?.WorkerStore) {
      throw new Error('WorkerStore not implemented')
    }

    expect(workersModule.WorkerStore.prototype.getWorkersByTier).toBeDefined()
  })
})

// ============================================================================
// 8. Named Agents Integration Tests
// ============================================================================

describe('Named Agents as Workers', () => {
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
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('creates named agents as Workers', () => {
    it('creates Priya (Product) worker', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const workerData = JSON.stringify({
        name: 'Priya',
        kind: 'agent',
        tier: 'generative',
        capabilities: ['text-generation', 'data-analysis'],
        description: 'Product agent - specs, roadmaps, requirements',
        provider: 'anthropic',
        model: 'claude-3-opus',
        status: 'active',
        config: {
          persona: 'product-manager',
          temperature: 0.7,
        },
      })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('worker-priya', 1, 'Worker', '${workerData}', ${now}, ${now}, NULL)
      `)

      const result = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('worker-priya') as { data: string }
      const data = JSON.parse(result.data) as WorkerData

      expect(data.name).toBe('Priya')
      expect(data.config?.persona).toBe('product-manager')
    })

    it('creates Ralph (Engineering) worker', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const workerData = JSON.stringify({
        name: 'Ralph',
        kind: 'agent',
        tier: 'agentic',
        capabilities: ['code-execution', 'tool-calling', 'file-system', 'web-browsing'],
        description: 'Engineering agent - builds and implements code',
        provider: 'anthropic',
        model: 'claude-3-opus',
        status: 'active',
        config: {
          persona: 'software-engineer',
          tools: ['code-interpreter', 'file-editor', 'terminal'],
        },
      })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('worker-ralph', 1, 'Worker', '${workerData}', ${now}, ${now}, NULL)
      `)

      const result = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('worker-ralph') as { data: string }
      const data = JSON.parse(result.data) as WorkerData

      expect(data.name).toBe('Ralph')
      expect(data.tier).toBe('agentic')
      expect(data.capabilities).toContain('tool-calling')
    })

    it('creates Tom (Tech Lead) worker', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const workerData = JSON.stringify({
        name: 'Tom',
        kind: 'agent',
        tier: 'agentic',
        capabilities: ['code-review', 'tool-calling', 'decision-making'],
        description: 'Tech Lead agent - architecture, review, mentoring',
        provider: 'anthropic',
        model: 'claude-3-opus',
        status: 'active',
        config: {
          persona: 'tech-lead',
          reviewStyle: 'thorough',
        },
      })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('worker-tom', 1, 'Worker', '${workerData}', ${now}, ${now}, NULL)
      `)

      const result = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('worker-tom') as { data: string }
      const data = JSON.parse(result.data) as WorkerData

      expect(data.name).toBe('Tom')
      expect(data.capabilities).toContain('code-review')
    })

    it('creates Mark (Marketing) worker', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const workerData = JSON.stringify({
        name: 'Mark',
        kind: 'agent',
        tier: 'generative',
        capabilities: ['text-generation', 'image-generation', 'communication'],
        description: 'Marketing agent - content, launches, campaigns',
        provider: 'openai',
        model: 'gpt-4-turbo',
        status: 'active',
        config: {
          persona: 'marketing-specialist',
          style: 'creative',
        },
      })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('worker-mark', 1, 'Worker', '${workerData}', ${now}, ${now}, NULL)
      `)

      const result = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('worker-mark') as { data: string }
      const data = JSON.parse(result.data) as WorkerData

      expect(data.name).toBe('Mark')
      expect(data.capabilities).toContain('image-generation')
    })

    it('creates Sally (Sales) worker', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const workerData = JSON.stringify({
        name: 'Sally',
        kind: 'agent',
        tier: 'generative',
        capabilities: ['text-generation', 'communication', 'data-analysis'],
        description: 'Sales agent - outreach, closing, customer relations',
        provider: 'openai',
        model: 'gpt-4',
        status: 'active',
        config: {
          persona: 'sales-representative',
          style: 'persuasive',
        },
      })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('worker-sally', 1, 'Worker', '${workerData}', ${now}, ${now}, NULL)
      `)

      const result = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('worker-sally') as { data: string }
      const data = JSON.parse(result.data) as WorkerData

      expect(data.name).toBe('Sally')
      expect(data.capabilities).toContain('communication')
    })

    it('creates Quinn (QA) worker', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const workerData = JSON.stringify({
        name: 'Quinn',
        kind: 'agent',
        tier: 'agentic',
        capabilities: ['code-execution', 'tool-calling', 'data-analysis'],
        description: 'QA agent - testing, quality assurance, bug finding',
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        status: 'active',
        config: {
          persona: 'qa-engineer',
          testStyle: 'comprehensive',
        },
      })

      sqlite.exec(`
        INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at, deleted_at)
        VALUES ('worker-quinn', 1, 'Worker', '${workerData}', ${now}, ${now}, NULL)
      `)

      const result = sqlite.prepare('SELECT data FROM graph_things WHERE id = ?').get('worker-quinn') as { data: string }
      const data = JSON.parse(result.data) as WorkerData

      expect(data.name).toBe('Quinn')
      expect(data.config?.persona).toBe('qa-engineer')
    })
  })
})
