/**
 * Schedule Trigger Relationships Tests - TDD RED Phase
 *
 * Tests for schedule triggers stored as graph relationships between Schedule and Workflow Things.
 *
 * Schedule triggers model the relationship between:
 * - Schedule (Thing) - Defines when to trigger (cron, timezone, etc.)
 * - Workflow (Thing) - Defines what to execute
 * - Trigger (Relationship with verb forms) - Connects them with execution metadata
 *
 * Key features tested:
 * 1. Schedule->Workflow relationships with 'triggers' verb
 * 2. Trigger verb forms (triggers/triggering/triggered/triggeredBy)
 * 3. Query schedules by workflow (find all schedules for a workflow)
 * 4. Trigger history tracking (triggered events as relationships)
 * 5. Next execution queries (schedules due to run)
 *
 * Uses real SQLite, NO MOCKS - per project testing philosophy.
 *
 * @see dotdo-sciot - [RED] Schedule triggers as relationships - tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Types for Schedule Trigger Relationships
// ============================================================================

/**
 * Schedule Thing data structure
 */
interface ScheduleThingData {
  name: string
  cronExpression: string
  timezone?: string
  enabled: boolean
  metadata?: Record<string, unknown>
}

/**
 * Workflow Thing data structure
 */
interface WorkflowThingData {
  name: string
  description?: string
  version?: string
  steps?: unknown[]
}

/**
 * Trigger relationship data (edge properties)
 */
interface TriggerRelationshipData {
  /** When this trigger was created/registered */
  registeredAt: number
  /** Priority if multiple triggers for same workflow */
  priority?: number
  /** Condition expression for conditional triggers */
  condition?: string
  /** Whether this trigger is currently active */
  active: boolean
}

/**
 * Trigger execution record (for history tracking)
 */
interface TriggerExecutionData {
  /** When the trigger fired */
  firedAt: number
  /** Duration of execution in ms */
  durationMs?: number
  /** Execution status */
  status: 'success' | 'failure' | 'timeout' | 'skipped'
  /** Error message if failed */
  error?: string
  /** Execution result metadata */
  result?: Record<string, unknown>
}

// ============================================================================
// Type IDs (matching existing graph model)
// ============================================================================

const SCHEDULE_TYPE_ID = 10
const SCHEDULE_TYPE_NAME = 'Schedule'
const WORKFLOW_TYPE_ID = 11
const WORKFLOW_TYPE_NAME = 'Workflow'

// ============================================================================
// 1. ScheduleTriggerStore Interface Tests
// ============================================================================

describe('ScheduleTriggerStore Interface', () => {
  /**
   * The ScheduleTriggerStore should be importable from db/graph
   */
  it('ScheduleTriggerStore is exported from db/graph', async () => {
    // This will fail until ScheduleTriggerStore is implemented
    const module = await import('../index')
    expect((module as Record<string, unknown>).ScheduleTriggerStore).toBeDefined()
  })

  it('has createTrigger method', async () => {
    const module = await import('../index')
    const ScheduleTriggerStore = (module as Record<string, unknown>).ScheduleTriggerStore as new () => object
    expect(ScheduleTriggerStore.prototype.createTrigger).toBeDefined()
  })

  it('has getTriggersForWorkflow method', async () => {
    const module = await import('../index')
    const ScheduleTriggerStore = (module as Record<string, unknown>).ScheduleTriggerStore as new () => object
    expect(ScheduleTriggerStore.prototype.getTriggersForWorkflow).toBeDefined()
  })

  it('has getTriggersForSchedule method', async () => {
    const module = await import('../index')
    const ScheduleTriggerStore = (module as Record<string, unknown>).ScheduleTriggerStore as new () => object
    expect(ScheduleTriggerStore.prototype.getTriggersForSchedule).toBeDefined()
  })

  it('has recordExecution method', async () => {
    const module = await import('../index')
    const ScheduleTriggerStore = (module as Record<string, unknown>).ScheduleTriggerStore as new () => object
    expect(ScheduleTriggerStore.prototype.recordExecution).toBeDefined()
  })

  it('has getExecutionHistory method', async () => {
    const module = await import('../index')
    const ScheduleTriggerStore = (module as Record<string, unknown>).ScheduleTriggerStore as new () => object
    expect(ScheduleTriggerStore.prototype.getExecutionHistory).toBeDefined()
  })

  it('has getSchedulesDueSoon method', async () => {
    const module = await import('../index')
    const ScheduleTriggerStore = (module as Record<string, unknown>).ScheduleTriggerStore as new () => object
    expect(ScheduleTriggerStore.prototype.getSchedulesDueSoon).toBeDefined()
  })

  it('has deleteTrigger method', async () => {
    const module = await import('../index')
    const ScheduleTriggerStore = (module as Record<string, unknown>).ScheduleTriggerStore as new () => object
    expect(ScheduleTriggerStore.prototype.deleteTrigger).toBeDefined()
  })
})

// ============================================================================
// 2. Schedule->Workflow Relationship Tests (requires better-sqlite3)
// ============================================================================

describe('Schedule->Workflow Relationships', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

      // Create verbs table with trigger verb forms
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

      // Create things table for Schedule and Workflow nodes
      sqlite.exec(`
        CREATE TABLE things (
          id TEXT PRIMARY KEY,
          type_id INTEGER NOT NULL,
          type_name TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        )
      `)

      // Create relationships table for triggers
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

      // Seed trigger verb forms
      sqlite.exec(`
        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('triggers', 'trigger', 'triggering', 'triggered', 'triggeredBy', 'cancels', 'Initiates execution of a workflow'),
        ('cancels', 'cancel', 'cancelling', 'cancelled', 'cancelledBy', 'triggers', 'Stops or prevents execution')
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('Create Schedule->Workflow Trigger', () => {
    it('creates a trigger relationship between schedule and workflow', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // Create a Schedule Thing
      const scheduleData = JSON.stringify({
        name: 'daily-report',
        cronExpression: '0 9 * * *',
        timezone: 'America/New_York',
        enabled: true,
      } satisfies ScheduleThingData)

      sqlite.exec(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
        VALUES ('schedule-daily-report', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '${scheduleData}', ${now}, ${now})
      `)

      // Create a Workflow Thing
      const workflowData = JSON.stringify({
        name: 'generate-report',
        description: 'Generate daily analytics report',
        version: '1.0.0',
      } satisfies WorkflowThingData)

      sqlite.exec(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
        VALUES ('workflow-generate-report', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '${workflowData}', ${now}, ${now})
      `)

      // Create trigger relationship
      const triggerData = JSON.stringify({
        registeredAt: now,
        priority: 1,
        active: true,
      } satisfies TriggerRelationshipData)

      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('trigger-001', 'triggers', 'schedule-daily-report', 'workflow-generate-report', '${triggerData}', ${now})
      `)

      // Verify the relationship
      const result = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get('trigger-001') as {
        id: string
        verb: string
        from: string
        to: string
        data: string
      }

      expect(result.verb).toBe('triggers')
      expect(result.from).toBe('schedule-daily-report')
      expect(result.to).toBe('workflow-generate-report')

      const parsedData = JSON.parse(result.data) as TriggerRelationshipData
      expect(parsedData.active).toBe(true)
      expect(parsedData.priority).toBe(1)
    })

    it('enforces unique constraint on schedule-workflow pair', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // Setup things
      sqlite.exec(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at) VALUES
        ('schedule-1', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{}', ${now}, ${now}),
        ('workflow-1', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '{}', ${now}, ${now})
      `)

      // First trigger
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('trigger-dup-001', 'triggers', 'schedule-1', 'workflow-1', '{}', ${now})
      `)

      // Duplicate should fail
      expect(() => {
        sqlite.exec(`
          INSERT INTO relationships (id, verb, "from", "to", data, created_at)
          VALUES ('trigger-dup-002', 'triggers', 'schedule-1', 'workflow-1', '{}', ${now})
        `)
      }).toThrow(/UNIQUE constraint failed/)
    })

    it('allows same schedule to trigger multiple workflows', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // Setup things
      sqlite.exec(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at) VALUES
        ('schedule-multi', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{}', ${now}, ${now}),
        ('workflow-a', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '{}', ${now}, ${now}),
        ('workflow-b', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '{}', ${now}, ${now}),
        ('workflow-c', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '{}', ${now}, ${now})
      `)

      // Create multiple triggers from same schedule
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
        ('trigger-multi-a', 'triggers', 'schedule-multi', 'workflow-a', '{"priority": 1}', ${now}),
        ('trigger-multi-b', 'triggers', 'schedule-multi', 'workflow-b', '{"priority": 2}', ${now}),
        ('trigger-multi-c', 'triggers', 'schedule-multi', 'workflow-c', '{"priority": 3}', ${now})
      `)

      const results = sqlite
        .prepare('SELECT * FROM relationships WHERE "from" = ? AND verb = ?')
        .all('schedule-multi', 'triggers') as { to: string }[]

      expect(results).toHaveLength(3)
      expect(results.map((r) => r.to)).toContain('workflow-a')
      expect(results.map((r) => r.to)).toContain('workflow-b')
      expect(results.map((r) => r.to)).toContain('workflow-c')
    })

    it('allows same workflow to be triggered by multiple schedules', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()

      // Setup things
      sqlite.exec(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at) VALUES
        ('schedule-hourly', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{}', ${now}, ${now}),
        ('schedule-daily', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{}', ${now}, ${now}),
        ('schedule-weekly', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{}', ${now}, ${now}),
        ('workflow-shared', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '{}', ${now}, ${now})
      `)

      // Multiple schedules trigger same workflow
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
        ('trigger-hourly', 'triggers', 'schedule-hourly', 'workflow-shared', '{}', ${now}),
        ('trigger-daily', 'triggers', 'schedule-daily', 'workflow-shared', '{}', ${now}),
        ('trigger-weekly', 'triggers', 'schedule-weekly', 'workflow-shared', '{}', ${now})
      `)

      const results = sqlite
        .prepare('SELECT * FROM relationships WHERE "to" = ? AND verb = ?')
        .all('workflow-shared', 'triggers') as { from: string }[]

      expect(results).toHaveLength(3)
      expect(results.map((r) => r.from)).toContain('schedule-hourly')
      expect(results.map((r) => r.from)).toContain('schedule-daily')
      expect(results.map((r) => r.from)).toContain('schedule-weekly')
    })
  })
})

// ============================================================================
// 3. Trigger Verb Forms Tests
// ============================================================================

describe('Trigger Verb Forms', () => {
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

        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('triggers', 'trigger', 'triggering', 'triggered', 'triggeredBy', 'cancels', 'Initiates execution'),
        ('cancels', 'cancel', 'cancelling', 'cancelled', 'cancelledBy', 'triggers', 'Stops execution')
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('provides all trigger verb conjugations', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const verb = sqlite.prepare('SELECT * FROM verbs WHERE verb = ?').get('triggers') as {
      verb: string
      action: string
      activity: string
      event: string
      reverse: string
      inverse: string
    }

    expect(verb.verb).toBe('triggers')      // Predicate form: Schedule triggers Workflow
    expect(verb.action).toBe('trigger')     // Imperative: trigger the workflow
    expect(verb.activity).toBe('triggering') // Present participle: triggering...
    expect(verb.event).toBe('triggered')    // Past participle: was triggered
    expect(verb.reverse).toBe('triggeredBy') // Reverse: Workflow triggeredBy Schedule
    expect(verb.inverse).toBe('cancels')    // Inverse operation
  })

  it('can query using event form (past participle) for history', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('trigger-event-001', 'triggers', 'schedule-a', 'workflow-b', '{}', ${now})
    `)

    // Query: "Which workflows were triggered?" using verb event form
    const results = sqlite
      .prepare(`
        SELECT r.*, v.event
        FROM relationships r
        JOIN verbs v ON r.verb = v.verb
        WHERE v.event = ?
      `)
      .all('triggered') as { id: string; to: string; event: string }[]

    expect(results).toHaveLength(1)
    expect(results[0]!.to).toBe('workflow-b')
    expect(results[0]!.event).toBe('triggered')
  })

  it('can query using reverse form (triggeredBy) for backward traversal', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
      ('trigger-rev-001', 'triggers', 'schedule-morning', 'workflow-report', '{}', ${now}),
      ('trigger-rev-002', 'triggers', 'schedule-evening', 'workflow-report', '{}', ${now})
    `)

    // Query: "What is workflow-report triggeredBy?" (find all schedules)
    // This uses the reverse form concept for backward traversal
    const results = sqlite
      .prepare(`
        SELECT r."from" as schedule_id, v.reverse as relationship
        FROM relationships r
        JOIN verbs v ON r.verb = v.verb
        WHERE r."to" = ? AND v.reverse = ?
      `)
      .all('workflow-report', 'triggeredBy') as { schedule_id: string; relationship: string }[]

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.schedule_id)).toContain('schedule-morning')
    expect(results.map((r) => r.schedule_id)).toContain('schedule-evening')
  })

  it('can find inverse relationships (triggers <-> cancels)', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const triggersVerb = sqlite.prepare('SELECT inverse FROM verbs WHERE verb = ?').get('triggers') as { inverse: string }
    expect(triggersVerb.inverse).toBe('cancels')

    const cancelsVerb = sqlite.prepare('SELECT inverse FROM verbs WHERE verb = ?').get('cancels') as { inverse: string }
    expect(cancelsVerb.inverse).toBe('triggers')
  })

  it('supports activity form (triggering) for in-progress state', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()

    // Store a trigger with "triggering" state in data to indicate in-progress
    const triggerData = JSON.stringify({
      state: 'triggering',
      startedAt: now,
    })

    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('trigger-inprog-001', 'triggers', 'schedule-x', 'workflow-y', '${triggerData}', ${now})
    `)

    // Query in-progress triggers using activity form
    const results = sqlite
      .prepare(`
        SELECT r.*, v.activity
        FROM relationships r
        JOIN verbs v ON r.verb = v.verb
        WHERE json_extract(r.data, '$.state') = v.activity
      `)
      .all() as { id: string; activity: string }[]

    expect(results).toHaveLength(1)
    expect(results[0]!.activity).toBe('triggering')
  })
})

// ============================================================================
// 4. Query Schedules by Workflow Tests
// ============================================================================

describe('Query Schedules by Workflow', () => {
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

        CREATE TABLE things (
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

        CREATE INDEX rel_to_verb_idx ON relationships("to", verb);
        CREATE INDEX things_type_idx ON things(type_id);

        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('triggers', 'trigger', 'triggering', 'triggered', 'triggeredBy', 'cancels', 'Initiates execution')
      `)

      // Seed test data
      const now = Date.now()
      const hour = 3600000

      // Schedules with different cron patterns
      sqlite.exec(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at) VALUES
        ('schedule-hourly', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{"cronExpression": "0 * * * *", "enabled": true}', ${now}, ${now}),
        ('schedule-daily-9am', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{"cronExpression": "0 9 * * *", "enabled": true}', ${now}, ${now}),
        ('schedule-weekly', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{"cronExpression": "0 0 * * 1", "enabled": true}', ${now}, ${now}),
        ('schedule-disabled', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{"cronExpression": "0 0 * * *", "enabled": false}', ${now}, ${now})
      `)

      // Workflows
      sqlite.exec(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at) VALUES
        ('workflow-analytics', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '{"name": "analytics-report"}', ${now}, ${now}),
        ('workflow-backup', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '{"name": "database-backup"}', ${now}, ${now}),
        ('workflow-cleanup', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '{"name": "temp-cleanup"}', ${now}, ${now})
      `)

      // Triggers (relationships)
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
        ('trigger-h-a', 'triggers', 'schedule-hourly', 'workflow-analytics', '{"priority": 1}', ${now}),
        ('trigger-d-a', 'triggers', 'schedule-daily-9am', 'workflow-analytics', '{"priority": 2}', ${now}),
        ('trigger-w-b', 'triggers', 'schedule-weekly', 'workflow-backup', '{"priority": 1}', ${now}),
        ('trigger-dis-c', 'triggers', 'schedule-disabled', 'workflow-cleanup', '{"priority": 1}', ${now})
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('finds all schedules that trigger a specific workflow', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const results = sqlite
      .prepare(`
        SELECT t.*, r.data as trigger_data
        FROM relationships r
        JOIN things t ON r."from" = t.id
        WHERE r."to" = ? AND r.verb = ?
      `)
      .all('workflow-analytics', 'triggers') as { id: string; data: string }[]

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.id)).toContain('schedule-hourly')
    expect(results.map((r) => r.id)).toContain('schedule-daily-9am')
  })

  it('finds only active schedules for a workflow', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    // For cleanup workflow, should return none because schedule is disabled
    const results = sqlite
      .prepare(`
        SELECT t.*, r.data as trigger_data
        FROM relationships r
        JOIN things t ON r."from" = t.id
        WHERE r."to" = ?
          AND r.verb = 'triggers'
          AND json_extract(t.data, '$.enabled') = true
      `)
      .all('workflow-cleanup') as { id: string }[]

    expect(results).toHaveLength(0)
  })

  it('returns empty array for workflow with no schedules', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
      VALUES ('workflow-orphan', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '{}', ${now}, ${now})
    `)

    const results = sqlite
      .prepare(`
        SELECT t.*
        FROM relationships r
        JOIN things t ON r."from" = t.id
        WHERE r."to" = ? AND r.verb = ?
      `)
      .all('workflow-orphan', 'triggers') as { id: string }[]

    expect(results).toHaveLength(0)
  })

  it('includes schedule data in query results', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const results = sqlite
      .prepare(`
        SELECT t.id, t.data, r.data as trigger_data
        FROM relationships r
        JOIN things t ON r."from" = t.id
        WHERE r."to" = ? AND r.verb = ?
        ORDER BY json_extract(r.data, '$.priority') ASC
      `)
      .all('workflow-analytics', 'triggers') as { id: string; data: string; trigger_data: string }[]

    expect(results).toHaveLength(2)

    // First result should be priority 1 (schedule-hourly)
    const first = results[0]!
    expect(first.id).toBe('schedule-hourly')
    const scheduleData = JSON.parse(first.data)
    expect(scheduleData.cronExpression).toBe('0 * * * *')
    expect(scheduleData.enabled).toBe(true)
  })

  it('can count schedules per workflow', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const results = sqlite
      .prepare(`
        SELECT r."to" as workflow_id, COUNT(*) as schedule_count
        FROM relationships r
        WHERE r.verb = 'triggers'
        GROUP BY r."to"
        ORDER BY schedule_count DESC
      `)
      .all() as { workflow_id: string; schedule_count: number }[]

    expect(results).toHaveLength(3)
    expect(results[0]!.workflow_id).toBe('workflow-analytics')
    expect(results[0]!.schedule_count).toBe(2)
  })
})

// ============================================================================
// 5. Trigger History Tracking Tests
// ============================================================================

describe('Trigger History Tracking', () => {
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

        CREATE TABLE things (
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

        -- Execution history table (separate from relationships for performance)
        CREATE TABLE trigger_executions (
          id TEXT PRIMARY KEY,
          trigger_id TEXT NOT NULL REFERENCES relationships(id),
          schedule_id TEXT NOT NULL,
          workflow_id TEXT NOT NULL,
          fired_at INTEGER NOT NULL,
          duration_ms INTEGER,
          status TEXT NOT NULL CHECK(status IN ('success', 'failure', 'timeout', 'skipped')),
          error TEXT,
          result TEXT
        );

        CREATE INDEX exec_trigger_idx ON trigger_executions(trigger_id);
        CREATE INDEX exec_schedule_idx ON trigger_executions(schedule_id);
        CREATE INDEX exec_workflow_idx ON trigger_executions(workflow_id);
        CREATE INDEX exec_fired_at_idx ON trigger_executions(fired_at);
        CREATE INDEX exec_status_idx ON trigger_executions(status);

        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('triggers', 'trigger', 'triggering', 'triggered', 'triggeredBy', 'cancels', 'Initiates execution')
      `)

      // Seed test data
      const now = Date.now()
      const hour = 3600000
      const day = 86400000

      // Things
      sqlite.exec(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at) VALUES
        ('schedule-hist', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{"cronExpression": "0 * * * *"}', ${now}, ${now}),
        ('workflow-hist', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '{"name": "history-test"}', ${now}, ${now})
      `)

      // Trigger relationship
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('trigger-hist-001', 'triggers', 'schedule-hist', 'workflow-hist', '{}', ${now})
      `)

      // Historical executions
      sqlite.exec(`
        INSERT INTO trigger_executions (id, trigger_id, schedule_id, workflow_id, fired_at, duration_ms, status, error, result) VALUES
        ('exec-001', 'trigger-hist-001', 'schedule-hist', 'workflow-hist', ${now - 5 * hour}, 1250, 'success', NULL, '{"processed": 100}'),
        ('exec-002', 'trigger-hist-001', 'schedule-hist', 'workflow-hist', ${now - 4 * hour}, 1300, 'success', NULL, '{"processed": 105}'),
        ('exec-003', 'trigger-hist-001', 'schedule-hist', 'workflow-hist', ${now - 3 * hour}, 8500, 'failure', 'Database connection timeout', NULL),
        ('exec-004', 'trigger-hist-001', 'schedule-hist', 'workflow-hist', ${now - 2 * hour}, 1200, 'success', NULL, '{"processed": 98}'),
        ('exec-005', 'trigger-hist-001', 'schedule-hist', 'workflow-hist', ${now - hour}, 1400, 'success', NULL, '{"processed": 110}')
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('records execution with success status', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const execId = `exec-new-${now}`

    sqlite.exec(`
      INSERT INTO trigger_executions (id, trigger_id, schedule_id, workflow_id, fired_at, duration_ms, status, result)
      VALUES ('${execId}', 'trigger-hist-001', 'schedule-hist', 'workflow-hist', ${now}, 1500, 'success', '{"items": 50}')
    `)

    const result = sqlite.prepare('SELECT * FROM trigger_executions WHERE id = ?').get(execId) as {
      status: string
      duration_ms: number
      result: string
    }

    expect(result.status).toBe('success')
    expect(result.duration_ms).toBe(1500)
    expect(JSON.parse(result.result)).toEqual({ items: 50 })
  })

  it('records execution with failure status and error message', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const execId = `exec-fail-${now}`
    const errorMsg = 'Connection refused: workflow endpoint unreachable'

    sqlite.exec(`
      INSERT INTO trigger_executions (id, trigger_id, schedule_id, workflow_id, fired_at, duration_ms, status, error)
      VALUES ('${execId}', 'trigger-hist-001', 'schedule-hist', 'workflow-hist', ${now}, 5000, 'failure', '${errorMsg}')
    `)

    const result = sqlite.prepare('SELECT * FROM trigger_executions WHERE id = ?').get(execId) as {
      status: string
      error: string
    }

    expect(result.status).toBe('failure')
    expect(result.error).toBe(errorMsg)
  })

  it('retrieves execution history for a trigger ordered by time', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const results = sqlite
      .prepare(`
        SELECT * FROM trigger_executions
        WHERE trigger_id = ?
        ORDER BY fired_at DESC
      `)
      .all('trigger-hist-001') as { id: string; status: string; fired_at: number }[]

    expect(results).toHaveLength(5)
    // Most recent first
    expect(results[0]!.id).toBe('exec-005')
    expect(results[4]!.id).toBe('exec-001')
  })

  it('retrieves execution history with pagination', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    // Page 1: limit 2
    const page1 = sqlite
      .prepare(`
        SELECT * FROM trigger_executions
        WHERE trigger_id = ?
        ORDER BY fired_at DESC
        LIMIT 2 OFFSET 0
      `)
      .all('trigger-hist-001') as { id: string }[]

    expect(page1).toHaveLength(2)
    expect(page1[0]!.id).toBe('exec-005')
    expect(page1[1]!.id).toBe('exec-004')

    // Page 2
    const page2 = sqlite
      .prepare(`
        SELECT * FROM trigger_executions
        WHERE trigger_id = ?
        ORDER BY fired_at DESC
        LIMIT 2 OFFSET 2
      `)
      .all('trigger-hist-001') as { id: string }[]

    expect(page2).toHaveLength(2)
    expect(page2[0]!.id).toBe('exec-003')
    expect(page2[1]!.id).toBe('exec-002')
  })

  it('counts executions by status', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const results = sqlite
      .prepare(`
        SELECT status, COUNT(*) as count
        FROM trigger_executions
        WHERE trigger_id = ?
        GROUP BY status
      `)
      .all('trigger-hist-001') as { status: string; count: number }[]

    const statusCounts = Object.fromEntries(results.map((r) => [r.status, r.count]))

    expect(statusCounts['success']).toBe(4)
    expect(statusCounts['failure']).toBe(1)
  })

  it('calculates average execution duration', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const result = sqlite
      .prepare(`
        SELECT AVG(duration_ms) as avg_duration
        FROM trigger_executions
        WHERE trigger_id = ? AND status = 'success'
      `)
      .get('trigger-hist-001') as { avg_duration: number }

    // (1250 + 1300 + 1200 + 1400) / 4 = 1287.5
    expect(result.avg_duration).toBeCloseTo(1287.5, 0)
  })

  it('retrieves execution history for a workflow (all triggers)', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const results = sqlite
      .prepare(`
        SELECT * FROM trigger_executions
        WHERE workflow_id = ?
        ORDER BY fired_at DESC
      `)
      .all('workflow-hist') as { id: string }[]

    expect(results).toHaveLength(5)
  })

  it('finds recent failures for alerting', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const fourHoursAgo = now - 4 * 3600000

    const results = sqlite
      .prepare(`
        SELECT e.*, r."from" as schedule_id, r."to" as workflow_id
        FROM trigger_executions e
        JOIN relationships r ON e.trigger_id = r.id
        WHERE e.status = 'failure'
          AND e.fired_at > ?
        ORDER BY e.fired_at DESC
      `)
      .all(fourHoursAgo) as { id: string; error: string }[]

    expect(results).toHaveLength(1)
    expect(results[0]!.error).toBe('Database connection timeout')
  })
})

// ============================================================================
// 6. Next Execution Queries Tests
// ============================================================================

describe('Next Execution Queries', () => {
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

        CREATE TABLE things (
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

        -- Schedule metadata table for next run tracking
        CREATE TABLE schedule_runs (
          schedule_id TEXT PRIMARY KEY REFERENCES things(id),
          next_run_at INTEGER,
          last_run_at INTEGER,
          run_count INTEGER DEFAULT 0
        );

        CREATE INDEX sched_next_run_idx ON schedule_runs(next_run_at);

        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('triggers', 'trigger', 'triggering', 'triggered', 'triggeredBy', 'cancels', 'Initiates execution')
      `)

      // Seed test data with various next_run_at times
      const now = Date.now()
      const minute = 60000
      const hour = 3600000

      // Schedules
      sqlite.exec(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at) VALUES
        ('schedule-due-now', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{"cronExpression": "* * * * *", "enabled": true}', ${now}, ${now}),
        ('schedule-due-soon', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{"cronExpression": "*/5 * * * *", "enabled": true}', ${now}, ${now}),
        ('schedule-due-later', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{"cronExpression": "0 * * * *", "enabled": true}', ${now}, ${now}),
        ('schedule-disabled', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{"cronExpression": "0 0 * * *", "enabled": false}', ${now}, ${now}),
        ('schedule-no-runs', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{"cronExpression": "0 9 * * *", "enabled": true}', ${now}, ${now})
      `)

      // Workflows
      sqlite.exec(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at) VALUES
        ('workflow-target', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '{"name": "target"}', ${now}, ${now})
      `)

      // Triggers
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
        ('trigger-now', 'triggers', 'schedule-due-now', 'workflow-target', '{}', ${now}),
        ('trigger-soon', 'triggers', 'schedule-due-soon', 'workflow-target', '{}', ${now}),
        ('trigger-later', 'triggers', 'schedule-due-later', 'workflow-target', '{}', ${now}),
        ('trigger-disabled', 'triggers', 'schedule-disabled', 'workflow-target', '{}', ${now})
      `)

      // Schedule run metadata
      sqlite.exec(`
        INSERT INTO schedule_runs (schedule_id, next_run_at, last_run_at, run_count) VALUES
        ('schedule-due-now', ${now + minute}, ${now - minute}, 100),
        ('schedule-due-soon', ${now + 5 * minute}, ${now - 5 * minute}, 50),
        ('schedule-due-later', ${now + hour}, ${now - hour}, 24),
        ('schedule-disabled', NULL, ${now - 24 * hour}, 10)
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('finds schedules due to run within time window', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const tenMinutes = 10 * 60000

    const results = sqlite
      .prepare(`
        SELECT t.id, t.data, sr.next_run_at
        FROM things t
        JOIN schedule_runs sr ON t.id = sr.schedule_id
        WHERE t.type_id = ?
          AND json_extract(t.data, '$.enabled') = true
          AND sr.next_run_at IS NOT NULL
          AND sr.next_run_at <= ?
        ORDER BY sr.next_run_at ASC
      `)
      .all(SCHEDULE_TYPE_ID, now + tenMinutes) as { id: string; next_run_at: number }[]

    expect(results).toHaveLength(2)
    expect(results[0]!.id).toBe('schedule-due-now')
    expect(results[1]!.id).toBe('schedule-due-soon')
  })

  it('excludes disabled schedules from due list', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const oneDay = 86400000

    const results = sqlite
      .prepare(`
        SELECT t.id
        FROM things t
        JOIN schedule_runs sr ON t.id = sr.schedule_id
        WHERE t.type_id = ?
          AND json_extract(t.data, '$.enabled') = true
          AND sr.next_run_at IS NOT NULL
          AND sr.next_run_at <= ?
      `)
      .all(SCHEDULE_TYPE_ID, now + oneDay) as { id: string }[]

    const ids = results.map((r) => r.id)
    expect(ids).not.toContain('schedule-disabled')
  })

  it('finds the single next schedule to run', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const result = sqlite
      .prepare(`
        SELECT t.id, t.data, sr.next_run_at
        FROM things t
        JOIN schedule_runs sr ON t.id = sr.schedule_id
        WHERE t.type_id = ?
          AND json_extract(t.data, '$.enabled') = true
          AND sr.next_run_at IS NOT NULL
        ORDER BY sr.next_run_at ASC
        LIMIT 1
      `)
      .get(SCHEDULE_TYPE_ID) as { id: string; next_run_at: number } | null

    expect(result).not.toBeNull()
    expect(result!.id).toBe('schedule-due-now')
  })

  it('finds schedules with associated workflows', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const oneHour = 3600000

    const results = sqlite
      .prepare(`
        SELECT
          t.id as schedule_id,
          t.data as schedule_data,
          sr.next_run_at,
          r.id as trigger_id,
          tw.id as workflow_id,
          tw.data as workflow_data
        FROM things t
        JOIN schedule_runs sr ON t.id = sr.schedule_id
        JOIN relationships r ON t.id = r."from" AND r.verb = 'triggers'
        JOIN things tw ON r."to" = tw.id
        WHERE t.type_id = ?
          AND json_extract(t.data, '$.enabled') = true
          AND sr.next_run_at IS NOT NULL
          AND sr.next_run_at <= ?
        ORDER BY sr.next_run_at ASC
      `)
      .all(SCHEDULE_TYPE_ID, now + oneHour) as {
        schedule_id: string
        workflow_id: string
        next_run_at: number
      }[]

    expect(results.length).toBeGreaterThanOrEqual(2)
    // All results should have associated workflows
    for (const r of results) {
      expect(r.workflow_id).toBeDefined()
    }
  })

  it('updates next_run_at after execution', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const newNextRun = now + 60000 // 1 minute from now

    // Simulate post-execution update
    sqlite.exec(`
      UPDATE schedule_runs
      SET last_run_at = ${now},
          next_run_at = ${newNextRun},
          run_count = run_count + 1
      WHERE schedule_id = 'schedule-due-now'
    `)

    const result = sqlite
      .prepare('SELECT * FROM schedule_runs WHERE schedule_id = ?')
      .get('schedule-due-now') as { last_run_at: number; next_run_at: number; run_count: number }

    expect(result.last_run_at).toBe(now)
    expect(result.next_run_at).toBe(newNextRun)
    expect(result.run_count).toBe(101)
  })

  it('handles schedules with no next_run_at (never scheduled)', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    // schedule-no-runs has no entry in schedule_runs yet
    const result = sqlite
      .prepare('SELECT * FROM schedule_runs WHERE schedule_id = ?')
      .get('schedule-no-runs') as { next_run_at: number | null } | undefined

    // Should be undefined because we didn't insert it (SQLite returns undefined for missing rows)
    expect(result).toBeUndefined()

    // Query should exclude it
    const now = Date.now()
    const results = sqlite
      .prepare(`
        SELECT t.id
        FROM things t
        LEFT JOIN schedule_runs sr ON t.id = sr.schedule_id
        WHERE t.type_id = ?
          AND json_extract(t.data, '$.enabled') = true
          AND (sr.next_run_at IS NULL OR sr.schedule_id IS NULL)
      `)
      .all(SCHEDULE_TYPE_ID) as { id: string }[]

    expect(results.map((r) => r.id)).toContain('schedule-no-runs')
  })

  it('computes time until next execution', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()

    const results = sqlite
      .prepare(`
        SELECT
          t.id,
          sr.next_run_at,
          (sr.next_run_at - ${now}) as ms_until_next
        FROM things t
        JOIN schedule_runs sr ON t.id = sr.schedule_id
        WHERE t.type_id = ?
          AND json_extract(t.data, '$.enabled') = true
          AND sr.next_run_at IS NOT NULL
        ORDER BY ms_until_next ASC
      `)
      .all(SCHEDULE_TYPE_ID) as { id: string; ms_until_next: number }[]

    expect(results.length).toBeGreaterThan(0)
    // First result should have smallest ms_until_next
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.ms_until_next).toBeLessThanOrEqual(results[i]!.ms_until_next)
    }
  })
})

// ============================================================================
// 7. Integration: Full Trigger Lifecycle Tests
// ============================================================================

describe('Integration: Full Trigger Lifecycle', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

      // Full schema setup
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

        CREATE TABLE things (
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

        CREATE TABLE schedule_runs (
          schedule_id TEXT PRIMARY KEY,
          next_run_at INTEGER,
          last_run_at INTEGER,
          run_count INTEGER DEFAULT 0
        );

        CREATE TABLE trigger_executions (
          id TEXT PRIMARY KEY,
          trigger_id TEXT NOT NULL,
          schedule_id TEXT NOT NULL,
          workflow_id TEXT NOT NULL,
          fired_at INTEGER NOT NULL,
          duration_ms INTEGER,
          status TEXT NOT NULL,
          error TEXT,
          result TEXT
        );

        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('triggers', 'trigger', 'triggering', 'triggered', 'triggeredBy', 'cancels', 'Initiates execution')
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('completes full lifecycle: create schedule, workflow, trigger, execute, record history', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()

    // Step 1: Create Schedule Thing
    const scheduleData = JSON.stringify({
      name: 'daily-sync',
      cronExpression: '0 6 * * *',
      timezone: 'UTC',
      enabled: true,
    })
    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
      VALUES ('schedule-daily-sync', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '${scheduleData}', ${now}, ${now})
    `)

    // Step 2: Create Workflow Thing
    const workflowData = JSON.stringify({
      name: 'data-sync',
      description: 'Sync data from external API',
      version: '1.0.0',
    })
    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
      VALUES ('workflow-data-sync', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '${workflowData}', ${now}, ${now})
    `)

    // Step 3: Create Trigger Relationship
    const triggerData = JSON.stringify({
      registeredAt: now,
      priority: 1,
      active: true,
    })
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('trigger-daily-sync', 'triggers', 'schedule-daily-sync', 'workflow-data-sync', '${triggerData}', ${now})
    `)

    // Step 4: Initialize Schedule Run Metadata
    const nextRun = now + 3600000 // 1 hour from now
    sqlite.exec(`
      INSERT INTO schedule_runs (schedule_id, next_run_at, run_count)
      VALUES ('schedule-daily-sync', ${nextRun}, 0)
    `)

    // Verify setup
    const trigger = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get('trigger-daily-sync') as {
      verb: string
      from: string
      to: string
    }
    expect(trigger.verb).toBe('triggers')
    expect(trigger.from).toBe('schedule-daily-sync')
    expect(trigger.to).toBe('workflow-data-sync')

    // Step 5: Simulate Execution
    const executionTime = now + 3600000
    const executionId = `exec-${executionTime}`
    const resultData = JSON.stringify({ recordsSynced: 1500, duration: 12500 })

    sqlite.exec(`
      INSERT INTO trigger_executions (id, trigger_id, schedule_id, workflow_id, fired_at, duration_ms, status, result)
      VALUES ('${executionId}', 'trigger-daily-sync', 'schedule-daily-sync', 'workflow-data-sync', ${executionTime}, 12500, 'success', '${resultData}')
    `)

    // Step 6: Update Schedule Run Metadata
    const nextNextRun = executionTime + 86400000 // +24 hours
    sqlite.exec(`
      UPDATE schedule_runs
      SET last_run_at = ${executionTime},
          next_run_at = ${nextNextRun},
          run_count = run_count + 1
      WHERE schedule_id = 'schedule-daily-sync'
    `)

    // Verify final state
    const scheduleRun = sqlite.prepare('SELECT * FROM schedule_runs WHERE schedule_id = ?').get('schedule-daily-sync') as {
      run_count: number
      last_run_at: number
      next_run_at: number
    }
    expect(scheduleRun.run_count).toBe(1)
    expect(scheduleRun.last_run_at).toBe(executionTime)
    expect(scheduleRun.next_run_at).toBe(nextNextRun)

    const execution = sqlite.prepare('SELECT * FROM trigger_executions WHERE id = ?').get(executionId) as {
      status: string
      result: string
    }
    expect(execution.status).toBe('success')
    expect(JSON.parse(execution.result)).toEqual({ recordsSynced: 1500, duration: 12500 })
  })

  it('supports querying complete trigger graph with all related data', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()

    // Setup: Create a complete trigger graph
    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at) VALUES
      ('schedule-comprehensive', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{"cronExpression": "0 * * * *", "enabled": true}', ${now}, ${now}),
      ('workflow-comprehensive', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '{"name": "comp-workflow"}', ${now}, ${now});

      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('trigger-comprehensive', 'triggers', 'schedule-comprehensive', 'workflow-comprehensive', '{"active": true}', ${now});

      INSERT INTO schedule_runs (schedule_id, next_run_at, last_run_at, run_count)
      VALUES ('schedule-comprehensive', ${now + 3600000}, ${now - 3600000}, 5);

      INSERT INTO trigger_executions (id, trigger_id, schedule_id, workflow_id, fired_at, duration_ms, status) VALUES
      ('exec-comp-1', 'trigger-comprehensive', 'schedule-comprehensive', 'workflow-comprehensive', ${now - 7200000}, 1000, 'success'),
      ('exec-comp-2', 'trigger-comprehensive', 'schedule-comprehensive', 'workflow-comprehensive', ${now - 3600000}, 1100, 'success')
    `)

    // Comprehensive query: Schedule + Trigger + Workflow + Run Metadata + Recent Executions
    const result = sqlite
      .prepare(`
        SELECT
          s.id as schedule_id,
          s.data as schedule_data,
          r.id as trigger_id,
          r.data as trigger_data,
          w.id as workflow_id,
          w.data as workflow_data,
          sr.next_run_at,
          sr.last_run_at,
          sr.run_count,
          (SELECT COUNT(*) FROM trigger_executions WHERE trigger_id = r.id) as total_executions,
          (SELECT COUNT(*) FROM trigger_executions WHERE trigger_id = r.id AND status = 'success') as successful_executions
        FROM things s
        JOIN relationships r ON s.id = r."from" AND r.verb = 'triggers'
        JOIN things w ON r."to" = w.id
        LEFT JOIN schedule_runs sr ON s.id = sr.schedule_id
        WHERE s.id = ?
      `)
      .get('schedule-comprehensive') as {
        schedule_id: string
        workflow_id: string
        trigger_id: string
        run_count: number
        total_executions: number
        successful_executions: number
      }

    expect(result.schedule_id).toBe('schedule-comprehensive')
    expect(result.workflow_id).toBe('workflow-comprehensive')
    expect(result.trigger_id).toBe('trigger-comprehensive')
    expect(result.run_count).toBe(5)
    expect(result.total_executions).toBe(2)
    expect(result.successful_executions).toBe(2)
  })
})
