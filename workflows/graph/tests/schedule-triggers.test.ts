/**
 * Schedule Triggers as Graph Relationships Tests - TDD RED Phase
 *
 * Tests for schedule/cron triggers as verb form relationships in the graph model.
 *
 * Graph Model:
 * - Schedule Thing --triggers--> Workflow Thing
 * - Schedule Thing --triggered--> Instance Thing (with data: { scheduledAt, triggeredAt })
 * - Instance Thing --triggeredBy--> Schedule Thing (reverse lookup)
 *
 * Verb Form State Encoding:
 * - 'trigger' (action form) = scheduled, pending execution
 * - 'triggering' (activity form) = currently firing
 * - 'triggered' (event form) = completed execution
 *
 * Expected Things:
 * ```typescript
 * Thing {
 *   id: 'schedule:daily-report',
 *   typeName: 'Schedule',
 *   data: {
 *     name: 'daily-report',
 *     cronExpression: '0 9 * * *',
 *     timezone: 'America/New_York',
 *     workflowId: 'workflow:generate-report',
 *     nextRunAt: timestamp,
 *     lastRunAt: timestamp,
 *     status: 'active' | 'paused'
 *   }
 * }
 * ```
 *
 * Expected Relationships:
 * ```typescript
 * // Schedule to Workflow (what workflow to trigger)
 * Relationship { verb: 'triggers', from: 'schedule:daily-report', to: 'workflow:generate-report' }
 *
 * // Trigger event (each execution)
 * Relationship {
 *   verb: 'triggered',
 *   from: 'schedule:daily-report',
 *   to: 'instance:triggered-123',
 *   data: { scheduledAt: timestamp, triggeredAt: timestamp }
 * }
 *
 * // Reverse lookup from instance
 * Relationship { verb: 'triggeredBy', from: 'instance:123', to: 'schedule:daily-report' }
 * ```
 *
 * Uses real SQLite, NO MOCKS per CLAUDE.md guidelines.
 *
 * @see dotdo-sciot - [RED] Schedule triggers as relationships - tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Types for Schedule Trigger Graph Model
// ============================================================================

/**
 * Schedule Thing data structure as stored in the graph
 */
interface ScheduleThingData {
  name: string
  cronExpression: string
  timezone?: string
  workflowId?: string
  nextRunAt?: number | null
  lastRunAt?: number | null
  runCount?: number
  status: 'active' | 'paused'
  metadata?: Record<string, unknown>
}

/**
 * Workflow Thing data structure
 */
interface WorkflowThingData {
  name: string
  description?: string
  version?: string
}

/**
 * Instance Thing data structure
 */
interface InstanceThingData {
  workflowId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  input?: Record<string, unknown>
  output?: Record<string, unknown>
}

/**
 * Trigger relationship data (for both 'triggered' and 'triggeredBy')
 */
interface TriggerEventData {
  scheduledAt: number
  triggeredAt: number
  cronExpression?: string
  timezone?: string
  isCatchup?: boolean
  executionDurationMs?: number
  error?: string
}

// ============================================================================
// Type Constants
// ============================================================================

const SCHEDULE_TYPE_ID = 200
const SCHEDULE_TYPE_NAME = 'Schedule'
const WORKFLOW_TYPE_ID = 201
const WORKFLOW_TYPE_NAME = 'Workflow'
const INSTANCE_TYPE_ID = 202
const INSTANCE_TYPE_NAME = 'Instance'

// ============================================================================
// 1. Schedule Thing as Graph Node Tests
// ============================================================================

describe('Schedule Thing as Graph Node', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

      // Create things table matching graph model
      sqlite.exec(`
        CREATE TABLE things (
          id TEXT PRIMARY KEY,
          type_id INTEGER NOT NULL,
          type_name TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE INDEX things_type_idx ON things(type_id);
        CREATE INDEX things_type_name_idx ON things(type_name);
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('createScheduleThing', () => {
    it('creates a Schedule Thing with required fields', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const scheduleData: ScheduleThingData = {
        name: 'daily-report',
        cronExpression: '0 9 * * *',
        timezone: 'America/New_York',
        status: 'active',
      }

      sqlite.exec(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
        VALUES ('schedule:daily-report', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '${JSON.stringify(scheduleData)}', ${now}, ${now})
      `)

      const result = sqlite.prepare('SELECT * FROM things WHERE id = ?').get('schedule:daily-report') as {
        id: string
        type_id: number
        type_name: string
        data: string
      }

      expect(result.id).toBe('schedule:daily-report')
      expect(result.type_name).toBe('Schedule')
      expect(result.type_id).toBe(SCHEDULE_TYPE_ID)

      const data = JSON.parse(result.data) as ScheduleThingData
      expect(data.name).toBe('daily-report')
      expect(data.cronExpression).toBe('0 9 * * *')
      expect(data.timezone).toBe('America/New_York')
      expect(data.status).toBe('active')
    })

    it('stores cron expression in Schedule Thing data', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const cronPatterns = [
        { name: 'every-minute', cron: '* * * * *' },
        { name: 'hourly', cron: '0 * * * *' },
        { name: 'daily-9am', cron: '0 9 * * *' },
        { name: 'weekly-monday', cron: '0 9 * * 1' },
        { name: 'monthly-first', cron: '0 9 1 * *' },
        { name: 'weekdays-8am', cron: '0 8 * * 1-5' },
      ]

      for (const pattern of cronPatterns) {
        const scheduleData: ScheduleThingData = {
          name: pattern.name,
          cronExpression: pattern.cron,
          status: 'active',
        }

        sqlite.exec(`
          INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
          VALUES ('schedule:${pattern.name}', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '${JSON.stringify(scheduleData)}', ${now}, ${now})
        `)
      }

      const results = sqlite
        .prepare(`SELECT id, json_extract(data, '$.cronExpression') as cron FROM things WHERE type_name = ?`)
        .all('Schedule') as { id: string; cron: string }[]

      expect(results).toHaveLength(6)
      expect(results.find((r) => r.id === 'schedule:daily-9am')?.cron).toBe('0 9 * * *')
      expect(results.find((r) => r.id === 'schedule:weekdays-8am')?.cron).toBe('0 8 * * 1-5')
    })

    it('stores nextRunAt timestamp in Schedule Thing', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const nextRun = now + 3600000 // 1 hour from now

      const scheduleData: ScheduleThingData = {
        name: 'with-next-run',
        cronExpression: '0 * * * *',
        status: 'active',
        nextRunAt: nextRun,
      }

      sqlite.exec(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
        VALUES ('schedule:with-next-run', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '${JSON.stringify(scheduleData)}', ${now}, ${now})
      `)

      const result = sqlite
        .prepare(`SELECT json_extract(data, '$.nextRunAt') as next_run FROM things WHERE id = ?`)
        .get('schedule:with-next-run') as { next_run: number }

      expect(result.next_run).toBe(nextRun)
    })

    it('stores workflowId reference in Schedule Thing', async () => {
      if (!sqlite) throw new Error('better-sqlite3 not installed')

      const now = Date.now()
      const scheduleData: ScheduleThingData = {
        name: 'linked-schedule',
        cronExpression: '0 9 * * *',
        status: 'active',
        workflowId: 'workflow:generate-report',
      }

      sqlite.exec(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
        VALUES ('schedule:linked', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '${JSON.stringify(scheduleData)}', ${now}, ${now})
      `)

      const result = sqlite
        .prepare(`SELECT json_extract(data, '$.workflowId') as workflow_id FROM things WHERE id = ?`)
        .get('schedule:linked') as { workflow_id: string }

      expect(result.workflow_id).toBe('workflow:generate-report')
    })
  })
})

// ============================================================================
// 2. Schedule -> Workflow 'triggers' Relationship Tests
// ============================================================================

describe('Schedule triggers Workflow Relationship', () => {
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

        CREATE INDEX rel_from_verb_idx ON relationships("from", verb);
        CREATE INDEX rel_to_verb_idx ON relationships("to", verb);

        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('triggers', 'trigger', 'triggering', 'triggered', 'triggeredBy', 'cancels', 'Schedule initiates workflow execution'),
        ('triggeredBy', 'triggerBy', 'triggeringBy', 'triggeredBy', 'triggers', 'cancelledBy', 'Reverse of triggers')
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('creates triggers relationship from Schedule to Workflow', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()

    // Create Schedule and Workflow Things
    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at) VALUES
      ('schedule:daily-report', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{"name": "daily-report", "cronExpression": "0 9 * * *", "status": "active"}', ${now}, ${now}),
      ('workflow:generate-report', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '{"name": "generate-report"}', ${now}, ${now})
    `)

    // Create triggers relationship
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('rel:triggers-001', 'triggers', 'schedule:daily-report', 'workflow:generate-report', '{}', ${now})
    `)

    const result = sqlite
      .prepare(`SELECT * FROM relationships WHERE verb = 'triggers' AND "from" = ?`)
      .get('schedule:daily-report') as { from: string; to: string; verb: string }

    expect(result.verb).toBe('triggers')
    expect(result.from).toBe('schedule:daily-report')
    expect(result.to).toBe('workflow:generate-report')
  })

  it('one Schedule can trigger multiple Workflows', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()

    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at) VALUES
      ('schedule:multi-trigger', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{"name": "multi-trigger", "cronExpression": "0 * * * *", "status": "active"}', ${now}, ${now}),
      ('workflow:report-a', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '{"name": "report-a"}', ${now}, ${now}),
      ('workflow:report-b', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '{"name": "report-b"}', ${now}, ${now}),
      ('workflow:report-c', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '{"name": "report-c"}', ${now}, ${now})
    `)

    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
      ('rel:t-001', 'triggers', 'schedule:multi-trigger', 'workflow:report-a', '{"priority": 1}', ${now}),
      ('rel:t-002', 'triggers', 'schedule:multi-trigger', 'workflow:report-b', '{"priority": 2}', ${now}),
      ('rel:t-003', 'triggers', 'schedule:multi-trigger', 'workflow:report-c', '{"priority": 3}', ${now})
    `)

    const results = sqlite
      .prepare(`SELECT "to" as workflow_id FROM relationships WHERE "from" = ? AND verb = 'triggers'`)
      .all('schedule:multi-trigger') as { workflow_id: string }[]

    expect(results).toHaveLength(3)
    expect(results.map((r) => r.workflow_id)).toContain('workflow:report-a')
    expect(results.map((r) => r.workflow_id)).toContain('workflow:report-b')
    expect(results.map((r) => r.workflow_id)).toContain('workflow:report-c')
  })

  it('multiple Schedules can trigger the same Workflow', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()

    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at) VALUES
      ('schedule:hourly', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{"name": "hourly", "cronExpression": "0 * * * *", "status": "active"}', ${now}, ${now}),
      ('schedule:daily', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{"name": "daily", "cronExpression": "0 9 * * *", "status": "active"}', ${now}, ${now}),
      ('schedule:weekly', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{"name": "weekly", "cronExpression": "0 9 * * 1", "status": "active"}', ${now}, ${now}),
      ('workflow:shared-workflow', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '{"name": "shared-workflow"}', ${now}, ${now})
    `)

    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
      ('rel:hourly-shared', 'triggers', 'schedule:hourly', 'workflow:shared-workflow', '{}', ${now}),
      ('rel:daily-shared', 'triggers', 'schedule:daily', 'workflow:shared-workflow', '{}', ${now}),
      ('rel:weekly-shared', 'triggers', 'schedule:weekly', 'workflow:shared-workflow', '{}', ${now})
    `)

    // Query using triggeredBy (reverse traversal)
    const results = sqlite
      .prepare(`
        SELECT "from" as schedule_id
        FROM relationships
        WHERE "to" = ? AND verb = 'triggers'
      `)
      .all('workflow:shared-workflow') as { schedule_id: string }[]

    expect(results).toHaveLength(3)
    expect(results.map((r) => r.schedule_id)).toContain('schedule:hourly')
    expect(results.map((r) => r.schedule_id)).toContain('schedule:daily')
    expect(results.map((r) => r.schedule_id)).toContain('schedule:weekly')
  })
})

// ============================================================================
// 3. Trigger Verb Form State Transitions Tests
// ============================================================================

describe('Trigger Verb Form State Transitions', () => {
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
          "to" TEXT,
          data TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER
        );

        INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description) VALUES
        ('triggers', 'trigger', 'triggering', 'triggered', 'triggeredBy', 'cancels', 'Schedule initiates workflow')
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('trigger (action form) represents scheduled state', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const scheduledAt = now + 3600000 // 1 hour from now

    const triggerData = JSON.stringify({
      scheduledAt,
      cronExpression: '0 9 * * *',
    })

    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('trigger:scheduled-001', 'trigger', 'schedule:daily', 'workflow:report', '${triggerData}', ${now})
    `)

    const result = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get('trigger:scheduled-001') as {
      verb: string
      to: string | null
      data: string
    }

    // Action form = scheduled/pending state
    expect(result.verb).toBe('trigger')
    expect(result.to).toBe('workflow:report') // Target workflow known
    const data = JSON.parse(result.data)
    expect(data.scheduledAt).toBe(scheduledAt)
  })

  it('triggering (activity form) represents firing state with to=null', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const firedAt = now

    const triggerData = JSON.stringify({
      scheduledAt: now - 1000,
      firedAt,
      cronExpression: '0 9 * * *',
    })

    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at, updated_at)
      VALUES ('trigger:firing-001', 'triggering', 'schedule:daily', NULL, '${triggerData}', ${now - 1000}, ${now})
    `)

    const result = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get('trigger:firing-001') as {
      verb: string
      to: string | null
      data: string
    }

    // Activity form = firing/in-progress state
    expect(result.verb).toBe('triggering')
    expect(result.to).toBeNull() // Result not yet known
    const data = JSON.parse(result.data)
    expect(data.firedAt).toBe(firedAt)
  })

  it('triggered (event form) represents completed state with to=instance', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const scheduledAt = now - 5000
    const triggeredAt = now - 1000

    const triggerData = JSON.stringify({
      scheduledAt,
      triggeredAt,
      executionDurationMs: 150,
      cronExpression: '0 9 * * *',
    })

    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at, updated_at)
      VALUES ('trigger:completed-001', 'triggered', 'schedule:daily', 'instance:run-123', '${triggerData}', ${scheduledAt}, ${now})
    `)

    const result = sqlite.prepare('SELECT * FROM relationships WHERE id = ?').get('trigger:completed-001') as {
      verb: string
      to: string | null
      data: string
    }

    // Event form = completed state
    expect(result.verb).toBe('triggered')
    expect(result.to).toBe('instance:run-123') // Result: created instance
    const data = JSON.parse(result.data)
    expect(data.triggeredAt).toBe(triggeredAt)
    expect(data.executionDurationMs).toBe(150)
  })

  it('transitions from trigger -> triggering -> triggered', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const triggerId = 'trigger:lifecycle-001'

    // Step 1: Create in 'trigger' state (scheduled)
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('${triggerId}', 'trigger', 'schedule:daily', 'workflow:report', '{"scheduledAt": ${now}, "cronExpression": "0 9 * * *"}', ${now})
    `)

    let result = sqlite.prepare('SELECT verb FROM relationships WHERE id = ?').get(triggerId) as { verb: string }
    expect(result.verb).toBe('trigger')

    // Step 2: Transition to 'triggering' state (firing)
    const fireTime = now + 1000
    sqlite.exec(`
      UPDATE relationships
      SET verb = 'triggering',
          "to" = NULL,
          data = '{"scheduledAt": ${now}, "firedAt": ${fireTime}, "cronExpression": "0 9 * * *"}',
          updated_at = ${fireTime}
      WHERE id = '${triggerId}' AND verb = 'trigger'
    `)

    result = sqlite.prepare('SELECT verb, "to" as target FROM relationships WHERE id = ?').get(triggerId) as { verb: string; target: string | null }
    expect(result.verb).toBe('triggering')
    expect(result.target).toBeNull()

    // Step 3: Transition to 'triggered' state (completed)
    const completeTime = now + 2000
    sqlite.exec(`
      UPDATE relationships
      SET verb = 'triggered',
          "to" = 'instance:result-abc',
          data = '{"scheduledAt": ${now}, "firedAt": ${fireTime}, "triggeredAt": ${completeTime}, "executionDurationMs": 1000}',
          updated_at = ${completeTime}
      WHERE id = '${triggerId}' AND verb = 'triggering'
    `)

    result = sqlite.prepare('SELECT verb, "to" as target FROM relationships WHERE id = ?').get(triggerId) as { verb: string; target: string | null }
    expect(result.verb).toBe('triggered')
    expect(result.target).toBe('instance:result-abc')
  })
})

// ============================================================================
// 4. Schedule Pause/Resume via Status Field Tests
// ============================================================================

describe('Schedule Pause/Resume via Status', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

      sqlite.exec(`
        CREATE TABLE things (
          id TEXT PRIMARY KEY,
          type_id INTEGER NOT NULL,
          type_name TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('creates active schedule by default', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const scheduleData: ScheduleThingData = {
      name: 'new-schedule',
      cronExpression: '0 9 * * *',
      status: 'active',
    }

    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
      VALUES ('schedule:new', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '${JSON.stringify(scheduleData)}', ${now}, ${now})
    `)

    const result = sqlite
      .prepare(`SELECT json_extract(data, '$.status') as status FROM things WHERE id = ?`)
      .get('schedule:new') as { status: string }

    expect(result.status).toBe('active')
  })

  it('pauses schedule by updating status to paused', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const scheduleData: ScheduleThingData = {
      name: 'to-pause',
      cronExpression: '0 9 * * *',
      status: 'active',
    }

    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
      VALUES ('schedule:to-pause', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '${JSON.stringify(scheduleData)}', ${now}, ${now})
    `)

    // Pause the schedule
    const pausedData = { ...scheduleData, status: 'paused', nextRunAt: null }
    sqlite.exec(`
      UPDATE things
      SET data = '${JSON.stringify(pausedData)}',
          updated_at = ${now + 1000}
      WHERE id = 'schedule:to-pause'
    `)

    const result = sqlite
      .prepare(`SELECT json_extract(data, '$.status') as status, json_extract(data, '$.nextRunAt') as next_run FROM things WHERE id = ?`)
      .get('schedule:to-pause') as { status: string; next_run: number | null }

    expect(result.status).toBe('paused')
    expect(result.next_run).toBeNull()
  })

  it('resumes schedule by updating status to active and setting nextRunAt', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const scheduleData: ScheduleThingData = {
      name: 'to-resume',
      cronExpression: '0 9 * * *',
      status: 'paused',
      nextRunAt: null,
    }

    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
      VALUES ('schedule:to-resume', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '${JSON.stringify(scheduleData)}', ${now}, ${now})
    `)

    // Resume the schedule
    const nextRun = now + 3600000
    const resumedData = { ...scheduleData, status: 'active', nextRunAt: nextRun }
    sqlite.exec(`
      UPDATE things
      SET data = '${JSON.stringify(resumedData)}',
          updated_at = ${now + 1000}
      WHERE id = 'schedule:to-resume'
    `)

    const result = sqlite
      .prepare(`SELECT json_extract(data, '$.status') as status, json_extract(data, '$.nextRunAt') as next_run FROM things WHERE id = ?`)
      .get('schedule:to-resume') as { status: string; next_run: number }

    expect(result.status).toBe('active')
    expect(result.next_run).toBe(nextRun)
  })

  it('queries only active schedules', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()

    // Create mix of active and paused schedules
    const activeSchedule: ScheduleThingData = { name: 'active-1', cronExpression: '0 * * * *', status: 'active' }
    const pausedSchedule: ScheduleThingData = { name: 'paused-1', cronExpression: '0 * * * *', status: 'paused' }

    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at) VALUES
      ('schedule:active-1', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '${JSON.stringify(activeSchedule)}', ${now}, ${now}),
      ('schedule:active-2', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '${JSON.stringify({ ...activeSchedule, name: 'active-2' })}', ${now}, ${now}),
      ('schedule:paused-1', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '${JSON.stringify(pausedSchedule)}', ${now}, ${now}),
      ('schedule:paused-2', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '${JSON.stringify({ ...pausedSchedule, name: 'paused-2' })}', ${now}, ${now})
    `)

    const activeResults = sqlite
      .prepare(`SELECT id FROM things WHERE type_name = ? AND json_extract(data, '$.status') = 'active'`)
      .all('Schedule') as { id: string }[]

    const pausedResults = sqlite
      .prepare(`SELECT id FROM things WHERE type_name = ? AND json_extract(data, '$.status') = 'paused'`)
      .all('Schedule') as { id: string }[]

    expect(activeResults).toHaveLength(2)
    expect(pausedResults).toHaveLength(2)
  })
})

// ============================================================================
// 5. Query Triggered Instances by triggeredBy Relationship Tests
// ============================================================================

describe('Query Triggered Instances by triggeredBy', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

      sqlite.exec(`
        CREATE TABLE things (
          id TEXT PRIMARY KEY,
          type_id INTEGER NOT NULL,
          type_name TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE relationships (
          id TEXT PRIMARY KEY,
          verb TEXT NOT NULL,
          "from" TEXT NOT NULL,
          "to" TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX rel_from_verb_idx ON relationships("from", verb);
        CREATE INDEX rel_to_verb_idx ON relationships("to", verb);
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('creates triggeredBy relationship from Instance to Schedule', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()

    // Create things
    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at) VALUES
      ('schedule:hourly', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{"name": "hourly", "cronExpression": "0 * * * *", "status": "active"}', ${now}, ${now}),
      ('instance:run-001', ${INSTANCE_TYPE_ID}, '${INSTANCE_TYPE_NAME}', '{"workflowId": "workflow:report", "status": "completed"}', ${now}, ${now})
    `)

    // Create triggeredBy relationship
    const triggerData: TriggerEventData = {
      scheduledAt: now - 5000,
      triggeredAt: now - 4000,
    }

    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('rel:triggeredby-001', 'triggeredBy', 'instance:run-001', 'schedule:hourly', '${JSON.stringify(triggerData)}', ${now})
    `)

    const result = sqlite
      .prepare(`SELECT * FROM relationships WHERE "from" = ? AND verb = 'triggeredBy'`)
      .get('instance:run-001') as { from: string; to: string; verb: string }

    expect(result.from).toBe('instance:run-001')
    expect(result.to).toBe('schedule:hourly')
    expect(result.verb).toBe('triggeredBy')
  })

  it('queries which Schedule triggered a specific Instance', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()

    // Setup data
    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at) VALUES
      ('schedule:source', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{"name": "source", "cronExpression": "0 9 * * *", "status": "active"}', ${now}, ${now}),
      ('instance:target', ${INSTANCE_TYPE_ID}, '${INSTANCE_TYPE_NAME}', '{"workflowId": "workflow:report", "status": "completed"}', ${now}, ${now})
    `)

    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('rel:tb-001', 'triggeredBy', 'instance:target', 'schedule:source', '{"scheduledAt": ${now - 1000}, "triggeredAt": ${now}}', ${now})
    `)

    // Query: What schedule triggered instance:target?
    const result = sqlite
      .prepare(`
        SELECT
          r."to" as schedule_id,
          t.data as schedule_data,
          r.data as trigger_data
        FROM relationships r
        JOIN things t ON r."to" = t.id
        WHERE r."from" = ? AND r.verb = 'triggeredBy'
      `)
      .get('instance:target') as { schedule_id: string; schedule_data: string; trigger_data: string }

    expect(result.schedule_id).toBe('schedule:source')
    const scheduleData = JSON.parse(result.schedule_data)
    expect(scheduleData.name).toBe('source')
  })

  it('queries all Instances triggered by a specific Schedule', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const hour = 3600000

    // Setup schedule and multiple instances
    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at) VALUES
      ('schedule:hourly', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{"name": "hourly", "cronExpression": "0 * * * *", "status": "active"}', ${now}, ${now}),
      ('instance:run-1', ${INSTANCE_TYPE_ID}, '${INSTANCE_TYPE_NAME}', '{"status": "completed"}', ${now - 3 * hour}, ${now - 3 * hour}),
      ('instance:run-2', ${INSTANCE_TYPE_ID}, '${INSTANCE_TYPE_NAME}', '{"status": "completed"}', ${now - 2 * hour}, ${now - 2 * hour}),
      ('instance:run-3', ${INSTANCE_TYPE_ID}, '${INSTANCE_TYPE_NAME}', '{"status": "completed"}', ${now - hour}, ${now - hour}),
      ('instance:run-4', ${INSTANCE_TYPE_ID}, '${INSTANCE_TYPE_NAME}', '{"status": "running"}', ${now}, ${now})
    `)

    // Create triggeredBy relationships (reverse direction for lookup)
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at) VALUES
      ('rel:tb-1', 'triggeredBy', 'instance:run-1', 'schedule:hourly', '{"triggeredAt": ${now - 3 * hour}}', ${now - 3 * hour}),
      ('rel:tb-2', 'triggeredBy', 'instance:run-2', 'schedule:hourly', '{"triggeredAt": ${now - 2 * hour}}', ${now - 2 * hour}),
      ('rel:tb-3', 'triggeredBy', 'instance:run-3', 'schedule:hourly', '{"triggeredAt": ${now - hour}}', ${now - hour}),
      ('rel:tb-4', 'triggeredBy', 'instance:run-4', 'schedule:hourly', '{"triggeredAt": ${now}}', ${now})
    `)

    // Query: What instances were triggered by schedule:hourly?
    // Use reverse traversal: find all relationships where to=schedule and verb=triggeredBy
    const results = sqlite
      .prepare(`
        SELECT
          r."from" as instance_id,
          t.data as instance_data,
          json_extract(r.data, '$.triggeredAt') as triggered_at
        FROM relationships r
        JOIN things t ON r."from" = t.id
        WHERE r."to" = ? AND r.verb = 'triggeredBy'
        ORDER BY json_extract(r.data, '$.triggeredAt') DESC
      `)
      .all('schedule:hourly') as { instance_id: string; triggered_at: number }[]

    expect(results).toHaveLength(4)
    expect(results[0]!.instance_id).toBe('instance:run-4') // Most recent first
    expect(results[3]!.instance_id).toBe('instance:run-1') // Oldest last
  })

  it('counts instances triggered by schedule', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()

    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at) VALUES
      ('schedule:daily', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{"name": "daily"}', ${now}, ${now}),
      ('schedule:weekly', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{"name": "weekly"}', ${now}, ${now})
    `)

    // Daily has 5 triggers, weekly has 2
    for (let i = 0; i < 5; i++) {
      sqlite.exec(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
        VALUES ('instance:daily-${i}', ${INSTANCE_TYPE_ID}, '${INSTANCE_TYPE_NAME}', '{}', ${now}, ${now})
      `)
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel:daily-${i}', 'triggeredBy', 'instance:daily-${i}', 'schedule:daily', '{}', ${now})
      `)
    }

    for (let i = 0; i < 2; i++) {
      sqlite.exec(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
        VALUES ('instance:weekly-${i}', ${INSTANCE_TYPE_ID}, '${INSTANCE_TYPE_NAME}', '{}', ${now}, ${now})
      `)
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel:weekly-${i}', 'triggeredBy', 'instance:weekly-${i}', 'schedule:weekly', '{}', ${now})
      `)
    }

    const results = sqlite
      .prepare(`
        SELECT
          r."to" as schedule_id,
          COUNT(*) as trigger_count
        FROM relationships r
        WHERE r.verb = 'triggeredBy'
        GROUP BY r."to"
        ORDER BY trigger_count DESC
      `)
      .all() as { schedule_id: string; trigger_count: number }[]

    expect(results).toHaveLength(2)
    expect(results[0]!.schedule_id).toBe('schedule:daily')
    expect(results[0]!.trigger_count).toBe(5)
    expect(results[1]!.schedule_id).toBe('schedule:weekly')
    expect(results[1]!.trigger_count).toBe(2)
  })
})

// ============================================================================
// 6. Next Run Time Calculation and Storage Tests
// ============================================================================

describe('Next Run Time Calculation and Storage', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

      sqlite.exec(`
        CREATE TABLE things (
          id TEXT PRIMARY KEY,
          type_id INTEGER NOT NULL,
          type_name TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        -- Index for querying by nextRunAt
        CREATE INDEX things_next_run_idx ON things(
          type_name,
          json_extract(data, '$.nextRunAt')
        );
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('stores nextRunAt timestamp in Schedule Thing', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const nextRun = now + 3600000 // 1 hour from now

    const scheduleData: ScheduleThingData = {
      name: 'with-next-run',
      cronExpression: '0 * * * *',
      status: 'active',
      nextRunAt: nextRun,
    }

    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
      VALUES ('schedule:test', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '${JSON.stringify(scheduleData)}', ${now}, ${now})
    `)

    const result = sqlite
      .prepare(`SELECT json_extract(data, '$.nextRunAt') as next_run FROM things WHERE id = ?`)
      .get('schedule:test') as { next_run: number }

    expect(result.next_run).toBe(nextRun)
  })

  it('updates nextRunAt after trigger execution', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const oldNextRun = now
    const newNextRun = now + 3600000 // Next hour

    const scheduleData: ScheduleThingData = {
      name: 'hourly',
      cronExpression: '0 * * * *',
      status: 'active',
      nextRunAt: oldNextRun,
      lastRunAt: null,
      runCount: 0,
    }

    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
      VALUES ('schedule:hourly', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '${JSON.stringify(scheduleData)}', ${now}, ${now})
    `)

    // Simulate trigger execution - update lastRunAt, nextRunAt, runCount
    const updatedData: ScheduleThingData = {
      ...scheduleData,
      nextRunAt: newNextRun,
      lastRunAt: now,
      runCount: 1,
    }

    sqlite.exec(`
      UPDATE things
      SET data = '${JSON.stringify(updatedData)}',
          updated_at = ${now}
      WHERE id = 'schedule:hourly'
    `)

    const result = sqlite
      .prepare(`
        SELECT
          json_extract(data, '$.nextRunAt') as next_run,
          json_extract(data, '$.lastRunAt') as last_run,
          json_extract(data, '$.runCount') as run_count
        FROM things
        WHERE id = ?
      `)
      .get('schedule:hourly') as { next_run: number; last_run: number; run_count: number }

    expect(result.next_run).toBe(newNextRun)
    expect(result.last_run).toBe(now)
    expect(result.run_count).toBe(1)
  })

  it('queries schedules due to run within time window', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const minute = 60000
    const hour = 3600000

    // Create schedules with various nextRunAt times
    const schedules = [
      { id: 'overdue', nextRunAt: now - minute, name: 'overdue' },     // Overdue by 1 min
      { id: 'now', nextRunAt: now, name: 'now' },                       // Due now
      { id: 'soon', nextRunAt: now + 5 * minute, name: 'soon' },       // Due in 5 min
      { id: 'later', nextRunAt: now + hour, name: 'later' },           // Due in 1 hour
      { id: 'paused', nextRunAt: null, name: 'paused' },               // Paused (no nextRunAt)
    ]

    for (const s of schedules) {
      const data: ScheduleThingData = {
        name: s.name,
        cronExpression: '0 * * * *',
        status: s.nextRunAt ? 'active' : 'paused',
        nextRunAt: s.nextRunAt,
      }
      sqlite.exec(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
        VALUES ('schedule:${s.id}', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '${JSON.stringify(data)}', ${now}, ${now})
      `)
    }

    // Query schedules due within 10 minutes
    const tenMinutes = 10 * minute
    const results = sqlite
      .prepare(`
        SELECT
          id,
          json_extract(data, '$.name') as name,
          json_extract(data, '$.nextRunAt') as next_run
        FROM things
        WHERE type_name = ?
          AND json_extract(data, '$.status') = 'active'
          AND json_extract(data, '$.nextRunAt') IS NOT NULL
          AND json_extract(data, '$.nextRunAt') <= ?
        ORDER BY json_extract(data, '$.nextRunAt') ASC
      `)
      .all('Schedule', now + tenMinutes) as { id: string; name: string; next_run: number }[]

    expect(results).toHaveLength(3) // overdue, now, soon
    expect(results[0]!.name).toBe('overdue')
    expect(results[1]!.name).toBe('now')
    expect(results[2]!.name).toBe('soon')
  })

  it('finds the next schedule to run across all schedules', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const minute = 60000

    const schedules = [
      { id: 'a', nextRunAt: now + 30 * minute },
      { id: 'b', nextRunAt: now + 5 * minute },   // Soonest
      { id: 'c', nextRunAt: now + 60 * minute },
    ]

    for (const s of schedules) {
      const data: ScheduleThingData = {
        name: `schedule-${s.id}`,
        cronExpression: '0 * * * *',
        status: 'active',
        nextRunAt: s.nextRunAt,
      }
      sqlite.exec(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
        VALUES ('schedule:${s.id}', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '${JSON.stringify(data)}', ${now}, ${now})
      `)
    }

    const result = sqlite
      .prepare(`
        SELECT
          id,
          json_extract(data, '$.nextRunAt') as next_run
        FROM things
        WHERE type_name = ?
          AND json_extract(data, '$.status') = 'active'
          AND json_extract(data, '$.nextRunAt') IS NOT NULL
        ORDER BY json_extract(data, '$.nextRunAt') ASC
        LIMIT 1
      `)
      .get('Schedule') as { id: string; next_run: number } | undefined

    expect(result).toBeDefined()
    expect(result!.id).toBe('schedule:b')
    expect(result!.next_run).toBe(now + 5 * minute)
  })

  it('computes time until next run', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const minute = 60000

    const data: ScheduleThingData = {
      name: 'compute-test',
      cronExpression: '0 * * * *',
      status: 'active',
      nextRunAt: now + 15 * minute,
    }

    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
      VALUES ('schedule:compute', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '${JSON.stringify(data)}', ${now}, ${now})
    `)

    const result = sqlite
      .prepare(`
        SELECT
          (json_extract(data, '$.nextRunAt') - ${now}) as ms_until_next
        FROM things
        WHERE id = ?
      `)
      .get('schedule:compute') as { ms_until_next: number }

    expect(result.ms_until_next).toBe(15 * minute)
  })
})

// ============================================================================
// 7. Integration: Full Schedule Trigger Lifecycle Tests
// ============================================================================

describe('Integration: Full Schedule Trigger Lifecycle', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    try {
      const betterSqlite = await import('better-sqlite3')
      Database = betterSqlite.default
      sqlite = new Database(':memory:')

      sqlite.exec(`
        CREATE TABLE things (
          id TEXT PRIMARY KEY,
          type_id INTEGER NOT NULL,
          type_name TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE relationships (
          id TEXT PRIMARY KEY,
          verb TEXT NOT NULL,
          "from" TEXT NOT NULL,
          "to" TEXT,
          data TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER
        );

        CREATE INDEX things_type_idx ON things(type_name);
        CREATE INDEX rel_from_verb_idx ON relationships("from", verb);
        CREATE INDEX rel_to_verb_idx ON relationships("to", verb);
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('completes full lifecycle: create -> configure -> trigger -> track', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()

    // Step 1: Create Schedule Thing with cron expression
    const scheduleData: ScheduleThingData = {
      name: 'daily-report',
      cronExpression: '0 9 * * *',
      timezone: 'America/New_York',
      status: 'active',
      nextRunAt: now + 3600000,
      runCount: 0,
    }

    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
      VALUES ('schedule:daily-report', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '${JSON.stringify(scheduleData)}', ${now}, ${now})
    `)

    // Step 2: Create Workflow Thing
    const workflowData: WorkflowThingData = {
      name: 'generate-report',
      description: 'Generate daily analytics report',
      version: '1.0.0',
    }

    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
      VALUES ('workflow:generate-report', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '${JSON.stringify(workflowData)}', ${now}, ${now})
    `)

    // Step 3: Create 'triggers' relationship (Schedule -> Workflow)
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('rel:triggers-001', 'triggers', 'schedule:daily-report', 'workflow:generate-report', '{}', ${now})
    `)

    // Verify triggers relationship
    const triggersRel = sqlite
      .prepare(`SELECT * FROM relationships WHERE verb = 'triggers' AND "from" = ?`)
      .get('schedule:daily-report') as { to: string }

    expect(triggersRel.to).toBe('workflow:generate-report')

    // Step 4: Simulate trigger firing - create Instance Thing
    const triggerTime = now + 3600000
    const instanceData: InstanceThingData = {
      workflowId: 'workflow:generate-report',
      status: 'running',
    }

    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
      VALUES ('instance:run-001', ${INSTANCE_TYPE_ID}, '${INSTANCE_TYPE_NAME}', '${JSON.stringify(instanceData)}', ${triggerTime}, ${triggerTime})
    `)

    // Step 5: Create 'triggered' relationship (Schedule -> Instance)
    const triggerEventData: TriggerEventData = {
      scheduledAt: scheduleData.nextRunAt!,
      triggeredAt: triggerTime,
      cronExpression: scheduleData.cronExpression,
      timezone: scheduleData.timezone,
    }

    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('rel:triggered-001', 'triggered', 'schedule:daily-report', 'instance:run-001', '${JSON.stringify(triggerEventData)}', ${triggerTime})
    `)

    // Step 6: Create 'triggeredBy' relationship (Instance -> Schedule)
    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('rel:triggeredby-001', 'triggeredBy', 'instance:run-001', 'schedule:daily-report', '${JSON.stringify(triggerEventData)}', ${triggerTime})
    `)

    // Step 7: Update Schedule Thing (lastRunAt, nextRunAt, runCount)
    const nextNextRun = triggerTime + 86400000 // +24 hours
    const updatedScheduleData: ScheduleThingData = {
      ...scheduleData,
      lastRunAt: triggerTime,
      nextRunAt: nextNextRun,
      runCount: 1,
    }

    sqlite.exec(`
      UPDATE things
      SET data = '${JSON.stringify(updatedScheduleData)}',
          updated_at = ${triggerTime}
      WHERE id = 'schedule:daily-report'
    `)

    // Verify complete state
    const schedule = sqlite
      .prepare(`SELECT data FROM things WHERE id = ?`)
      .get('schedule:daily-report') as { data: string }

    const finalScheduleData = JSON.parse(schedule.data) as ScheduleThingData
    expect(finalScheduleData.runCount).toBe(1)
    expect(finalScheduleData.lastRunAt).toBe(triggerTime)
    expect(finalScheduleData.nextRunAt).toBe(nextNextRun)

    // Verify triggered relationship exists
    const triggeredRel = sqlite
      .prepare(`SELECT * FROM relationships WHERE verb = 'triggered' AND "from" = ?`)
      .get('schedule:daily-report') as { to: string }

    expect(triggeredRel.to).toBe('instance:run-001')

    // Verify triggeredBy relationship exists
    const triggeredByRel = sqlite
      .prepare(`SELECT * FROM relationships WHERE verb = 'triggeredBy' AND "from" = ?`)
      .get('instance:run-001') as { to: string }

    expect(triggeredByRel.to).toBe('schedule:daily-report')
  })

  it('tracks multiple trigger executions over time', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const hour = 3600000

    // Create Schedule
    const scheduleData: ScheduleThingData = {
      name: 'hourly-job',
      cronExpression: '0 * * * *',
      status: 'active',
      nextRunAt: now,
      runCount: 0,
    }

    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
      VALUES ('schedule:hourly', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '${JSON.stringify(scheduleData)}', ${now}, ${now})
    `)

    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
      VALUES ('workflow:hourly-task', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '{"name": "hourly-task"}', ${now}, ${now})
    `)

    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('rel:triggers-hourly', 'triggers', 'schedule:hourly', 'workflow:hourly-task', '{}', ${now})
    `)

    // Simulate 5 trigger executions
    for (let i = 0; i < 5; i++) {
      const triggerTime = now + i * hour
      const instanceId = `instance:run-${i}`

      // Create instance
      sqlite.exec(`
        INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
        VALUES ('${instanceId}', ${INSTANCE_TYPE_ID}, '${INSTANCE_TYPE_NAME}', '{"status": "completed"}', ${triggerTime}, ${triggerTime})
      `)

      // Create triggered relationship
      const triggerData: TriggerEventData = {
        scheduledAt: triggerTime,
        triggeredAt: triggerTime + 100, // Small delay
        executionDurationMs: 500 + i * 100,
      }

      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel:triggered-${i}', 'triggered', 'schedule:hourly', '${instanceId}', '${JSON.stringify(triggerData)}', ${triggerTime})
      `)

      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel:triggeredby-${i}', 'triggeredBy', '${instanceId}', 'schedule:hourly', '${JSON.stringify(triggerData)}', ${triggerTime})
      `)
    }

    // Update schedule with final state
    const finalScheduleData: ScheduleThingData = {
      ...scheduleData,
      runCount: 5,
      lastRunAt: now + 4 * hour + 100,
      nextRunAt: now + 5 * hour,
    }

    sqlite.exec(`
      UPDATE things
      SET data = '${JSON.stringify(finalScheduleData)}',
          updated_at = ${now + 4 * hour}
      WHERE id = 'schedule:hourly'
    `)

    // Query trigger history
    const history = sqlite
      .prepare(`
        SELECT
          r."to" as instance_id,
          json_extract(r.data, '$.triggeredAt') as triggered_at,
          json_extract(r.data, '$.executionDurationMs') as duration_ms
        FROM relationships r
        WHERE r."from" = ? AND r.verb = 'triggered'
        ORDER BY json_extract(r.data, '$.triggeredAt') DESC
      `)
      .all('schedule:hourly') as { instance_id: string; triggered_at: number; duration_ms: number }[]

    expect(history).toHaveLength(5)
    expect(history[0]!.instance_id).toBe('instance:run-4') // Most recent

    // Verify schedule state
    const schedule = sqlite
      .prepare(`SELECT data FROM things WHERE id = ?`)
      .get('schedule:hourly') as { data: string }

    const scheduleState = JSON.parse(schedule.data) as ScheduleThingData
    expect(scheduleState.runCount).toBe(5)
  })
})

// ============================================================================
// 8. Edge Cases and Error Handling Tests
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
        CREATE TABLE things (
          id TEXT PRIMARY KEY,
          type_id INTEGER NOT NULL,
          type_name TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE relationships (
          id TEXT PRIMARY KEY,
          verb TEXT NOT NULL,
          "from" TEXT NOT NULL,
          "to" TEXT,
          data TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(verb, "from", "to")
        )
      `)
    } catch {
      // Skip if better-sqlite3 not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('handles schedule with no triggers relationship', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()

    // Create orphan schedule (no triggers relationship)
    const scheduleData: ScheduleThingData = {
      name: 'orphan-schedule',
      cronExpression: '0 9 * * *',
      status: 'active',
    }

    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at)
      VALUES ('schedule:orphan', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '${JSON.stringify(scheduleData)}', ${now}, ${now})
    `)

    // Query should return no results
    const results = sqlite
      .prepare(`
        SELECT t.id, r."to" as workflow_id
        FROM things t
        LEFT JOIN relationships r ON t.id = r."from" AND r.verb = 'triggers'
        WHERE t.id = ?
      `)
      .get('schedule:orphan') as { id: string; workflow_id: string | null }

    expect(results.id).toBe('schedule:orphan')
    expect(results.workflow_id).toBeNull()
  })

  it('handles duplicate triggers relationship', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()

    sqlite.exec(`
      INSERT INTO things (id, type_id, type_name, data, created_at, updated_at) VALUES
      ('schedule:dup-test', ${SCHEDULE_TYPE_ID}, '${SCHEDULE_TYPE_NAME}', '{}', ${now}, ${now}),
      ('workflow:dup-target', ${WORKFLOW_TYPE_ID}, '${WORKFLOW_TYPE_NAME}', '{}', ${now}, ${now})
    `)

    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('rel:first', 'triggers', 'schedule:dup-test', 'workflow:dup-target', '{}', ${now})
    `)

    // Attempt duplicate should fail
    expect(() => {
      sqlite.exec(`
        INSERT INTO relationships (id, verb, "from", "to", data, created_at)
        VALUES ('rel:second', 'triggers', 'schedule:dup-test', 'workflow:dup-target', '{}', ${now})
      `)
    }).toThrow(/UNIQUE constraint failed/)
  })

  it('handles trigger failure with error data', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()

    const triggerData: TriggerEventData = {
      scheduledAt: now - 5000,
      triggeredAt: now,
      error: 'Workflow execution failed: timeout after 30s',
    }

    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('rel:failed-trigger', 'triggered', 'schedule:test', NULL, '${JSON.stringify(triggerData)}', ${now})
    `)

    const result = sqlite
      .prepare(`SELECT * FROM relationships WHERE id = ?`)
      .get('rel:failed-trigger') as { verb: string; to: string | null; data: string }

    expect(result.verb).toBe('triggered')
    expect(result.to).toBeNull() // No instance created due to failure
    const data = JSON.parse(result.data) as TriggerEventData
    expect(data.error).toContain('timeout')
  })

  it('handles catchup trigger marking', async () => {
    if (!sqlite) throw new Error('better-sqlite3 not installed')

    const now = Date.now()
    const missedTime = now - 7200000 // 2 hours ago

    const triggerData: TriggerEventData = {
      scheduledAt: missedTime,
      triggeredAt: now,
      isCatchup: true,
    }

    sqlite.exec(`
      INSERT INTO relationships (id, verb, "from", "to", data, created_at)
      VALUES ('rel:catchup', 'triggered', 'schedule:test', 'instance:catchup-001', '${JSON.stringify(triggerData)}', ${now})
    `)

    // Query catchup triggers
    const results = sqlite
      .prepare(`
        SELECT id
        FROM relationships
        WHERE verb = 'triggered'
          AND json_extract(data, '$.isCatchup') = true
      `)
      .all() as { id: string }[]

    expect(results).toHaveLength(1)
    expect(results[0]!.id).toBe('rel:catchup')
  })
})
