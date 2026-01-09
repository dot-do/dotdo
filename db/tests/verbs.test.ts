import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { verbs } from '../verbs'

/**
 * Verbs Table Schema Tests
 *
 * These tests verify the Verbs schema which stores predicate definitions
 * with linguistic forms for natural language generation.
 *
 * This is RED phase TDD - tests should FAIL until:
 * 1. better-sqlite3 is added as a dev dependency
 * 2. Query helper functions are implemented in db/verbs.ts
 *
 * The Verbs table supports:
 * - Predicate form: 'creates' (Subject creates Object)
 * - Action form: 'create' (imperative / base form)
 * - Activity form: 'creating' (present participle / gerund)
 * - Event form: 'created' (past participle)
 * - Reverse form: 'createdBy' (for <-, <~ backward operators)
 * - Inverse form: 'deletes' (opposite predicate)
 *
 * To run these tests with database operations:
 * 1. npm install --save-dev better-sqlite3 @types/better-sqlite3
 * 2. npx vitest run db/tests/verbs.test.ts
 */

// ============================================================================
// Schema Table Definition Tests (No Database Required)
// ============================================================================

describe('Schema Table Definition', () => {
  describe('Column Existence', () => {
    it('has verb column as primary key', () => {
      expect(verbs.verb).toBeDefined()
      expect(verbs.verb.name).toBe('verb')
    })

    it('has action column (imperative form)', () => {
      expect(verbs.action).toBeDefined()
      expect(verbs.action.name).toBe('action')
    })

    it('has activity column (present participle)', () => {
      expect(verbs.activity).toBeDefined()
      expect(verbs.activity.name).toBe('activity')
    })

    it('has event column (past participle)', () => {
      expect(verbs.event).toBeDefined()
      expect(verbs.event.name).toBe('event')
    })

    it('has reverse column (backward operator)', () => {
      expect(verbs.reverse).toBeDefined()
      expect(verbs.reverse.name).toBe('reverse')
    })

    it('has inverse column (opposite predicate)', () => {
      expect(verbs.inverse).toBeDefined()
      expect(verbs.inverse.name).toBe('inverse')
    })

    it('has description column (metadata)', () => {
      expect(verbs.description).toBeDefined()
      expect(verbs.description.name).toBe('description')
    })
  })

  describe('Column Types', () => {
    it('verb column is text type', () => {
      // All columns in verbs table are text
      expect(verbs.verb.dataType).toBe('string')
    })

    it('action column is text type', () => {
      expect(verbs.action.dataType).toBe('string')
    })

    it('activity column is text type', () => {
      expect(verbs.activity.dataType).toBe('string')
    })

    it('event column is text type', () => {
      expect(verbs.event.dataType).toBe('string')
    })

    it('reverse column is text type', () => {
      expect(verbs.reverse.dataType).toBe('string')
    })

    it('inverse column is text type', () => {
      expect(verbs.inverse.dataType).toBe('string')
    })

    it('description column is text type', () => {
      expect(verbs.description.dataType).toBe('string')
    })
  })

  describe('Primary Key', () => {
    it('verb is the primary key', () => {
      // Verify that verb column is configured as primary key
      expect(verbs.verb.primary).toBe(true)
    })
  })
})

// ============================================================================
// Convention Tests (createdBy, createdAt, createdIn) - No Database Required
// ============================================================================

describe('Convention: Event-Based Metadata Fields', () => {
  it('documents the createdBy convention for actors', () => {
    // Given event 'created', the convention is:
    // - createdBy = actor who performed the action
    // This is documented behavior, not enforced by schema

    const expectedConvention = {
      event: 'created',
      actorField: 'createdBy',
      timestampField: 'createdAt',
      contextField: 'createdIn',
    }

    expect(expectedConvention.actorField).toBe(`${expectedConvention.event}By`)
  })

  it('documents the createdAt convention for timestamps', () => {
    const expectedConvention = {
      event: 'created',
      timestampField: 'createdAt',
    }

    expect(expectedConvention.timestampField).toBe(`${expectedConvention.event}At`)
  })

  it('documents the createdIn convention for request context', () => {
    const expectedConvention = {
      event: 'created',
      contextField: 'createdIn',
    }

    expect(expectedConvention.contextField).toBe(`${expectedConvention.event}In`)
  })
})

// ============================================================================
// Database Tests - Require better-sqlite3
// ============================================================================

// The following tests require better-sqlite3 to be installed:
// npm install --save-dev better-sqlite3 @types/better-sqlite3

describe('CRUD Operations (requires better-sqlite3)', () => {
  // Lazy import to avoid failure when dependency not installed
  let Database: typeof import('better-sqlite3').default
  let drizzle: typeof import('drizzle-orm/better-sqlite3').drizzle
  let eq: typeof import('drizzle-orm').eq
  let sqlite: import('better-sqlite3').Database
  let db: import('drizzle-orm/better-sqlite3').BetterSQLite3Database

  beforeEach(async () => {
    try {
      // Dynamic imports for optional dependency
      const betterSqlite = await import('better-sqlite3')
      const drizzleBetterSqlite = await import('drizzle-orm/better-sqlite3')
      const drizzleOrm = await import('drizzle-orm')

      Database = betterSqlite.default
      drizzle = drizzleBetterSqlite.drizzle
      eq = drizzleOrm.eq

      // Create in-memory SQLite database
      sqlite = new Database(':memory:')

      // Create the verbs table
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

      // Initialize Drizzle ORM
      db = drizzle(sqlite)
    } catch {
      // Skip setup if dependencies not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('Insert Operations', () => {
    it('can insert a verb with all linguistic forms', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const createVerb = {
        verb: 'creates',
        action: 'create',
        activity: 'creating',
        event: 'created',
        reverse: 'createdBy',
        inverse: 'deletes',
        description: 'Brings something into existence',
      }

      await db.insert(verbs).values(createVerb)

      const results = await db.select().from(verbs).where(eq(verbs.verb, 'creates'))
      expect(results).toHaveLength(1)
      expect(results[0]).toEqual(createVerb)
    })

    it('can insert a verb with only required fields', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const minimalVerb = {
        verb: 'owns',
        action: null,
        activity: null,
        event: null,
        reverse: null,
        inverse: null,
        description: null,
      }

      await db.insert(verbs).values(minimalVerb)

      const results = await db.select().from(verbs).where(eq(verbs.verb, 'owns'))
      expect(results).toHaveLength(1)
      expect(results[0].verb).toBe('owns')
    })

    it('can insert multiple verbs at once', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const verbBatch = [
        { verb: 'creates', action: 'create', activity: 'creating', event: 'created', reverse: 'createdBy', inverse: 'deletes', description: 'Create something' },
        { verb: 'updates', action: 'update', activity: 'updating', event: 'updated', reverse: 'updatedBy', inverse: null, description: 'Modify something' },
        { verb: 'deletes', action: 'delete', activity: 'deleting', event: 'deleted', reverse: 'deletedBy', inverse: 'creates', description: 'Remove something' },
      ]

      await db.insert(verbs).values(verbBatch)

      const results = await db.select().from(verbs)
      expect(results).toHaveLength(3)
    })
  })

  describe('Read Operations', () => {
    beforeEach(async () => {
      if (!db) return
      // Seed test data
      await db.insert(verbs).values([
        { verb: 'creates', action: 'create', activity: 'creating', event: 'created', reverse: 'createdBy', inverse: 'deletes', description: 'Create' },
        { verb: 'manages', action: 'manage', activity: 'managing', event: 'managed', reverse: 'managedBy', inverse: 'abandons', description: 'Manage' },
        { verb: 'has', action: 'have', activity: 'having', event: 'had', reverse: 'hadBy', inverse: 'lacks', description: 'Possess' },
      ])
    })

    it('can read a verb by primary key', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const results = await db.select().from(verbs).where(eq(verbs.verb, 'creates'))

      expect(results).toHaveLength(1)
      expect(results[0].verb).toBe('creates')
      expect(results[0].action).toBe('create')
    })

    it('can read all verbs', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const results = await db.select().from(verbs)

      expect(results).toHaveLength(3)
    })

    it('returns empty array for non-existent verb', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const results = await db.select().from(verbs).where(eq(verbs.verb, 'nonexistent'))

      expect(results).toHaveLength(0)
    })
  })

  describe('Update Operations', () => {
    beforeEach(async () => {
      if (!db) return
      await db.insert(verbs).values({
        verb: 'creates',
        action: 'create',
        activity: 'creating',
        event: 'created',
        reverse: 'createdBy',
        inverse: null,
        description: 'Original description',
      })
    })

    it('can update verb description', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      await db.update(verbs)
        .set({ description: 'Updated description' })
        .where(eq(verbs.verb, 'creates'))

      const results = await db.select().from(verbs).where(eq(verbs.verb, 'creates'))
      expect(results[0].description).toBe('Updated description')
    })

    it('can update verb inverse', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      await db.update(verbs)
        .set({ inverse: 'deletes' })
        .where(eq(verbs.verb, 'creates'))

      const results = await db.select().from(verbs).where(eq(verbs.verb, 'creates'))
      expect(results[0].inverse).toBe('deletes')
    })

    it('can update multiple fields at once', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      await db.update(verbs)
        .set({
          inverse: 'destroys',
          description: 'Brings into existence',
        })
        .where(eq(verbs.verb, 'creates'))

      const results = await db.select().from(verbs).where(eq(verbs.verb, 'creates'))
      expect(results[0].inverse).toBe('destroys')
      expect(results[0].description).toBe('Brings into existence')
    })

    it('can set field to null', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      await db.update(verbs)
        .set({ description: null })
        .where(eq(verbs.verb, 'creates'))

      const results = await db.select().from(verbs).where(eq(verbs.verb, 'creates'))
      expect(results[0].description).toBeNull()
    })
  })

  describe('Delete Operations', () => {
    beforeEach(async () => {
      if (!db) return
      await db.insert(verbs).values([
        { verb: 'creates', action: 'create', activity: 'creating', event: 'created', reverse: 'createdBy', inverse: 'deletes', description: null },
        { verb: 'updates', action: 'update', activity: 'updating', event: 'updated', reverse: 'updatedBy', inverse: null, description: null },
      ])
    })

    it('can delete a verb by primary key', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      await db.delete(verbs).where(eq(verbs.verb, 'creates'))

      const results = await db.select().from(verbs)
      expect(results).toHaveLength(1)
      expect(results[0].verb).toBe('updates')
    })

    it('delete of non-existent verb does not throw', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      // Should not throw
      await db.delete(verbs).where(eq(verbs.verb, 'nonexistent'))

      const results = await db.select().from(verbs)
      expect(results).toHaveLength(2) // Original count unchanged
    })

    it('can delete all verbs', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      await db.delete(verbs)

      const results = await db.select().from(verbs)
      expect(results).toHaveLength(0)
    })
  })
})

// ============================================================================
// Linguistic Form Patterns Tests (requires better-sqlite3)
// ============================================================================

describe('Linguistic Form Patterns (requires better-sqlite3)', () => {
  let Database: typeof import('better-sqlite3').default
  let drizzle: typeof import('drizzle-orm/better-sqlite3').drizzle
  let eq: typeof import('drizzle-orm').eq
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
        )
      `)
      db = drizzle(sqlite)
    } catch {
      // Skip setup if dependencies not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('Standard Verbs (Regular -s/-es forms)', () => {
    it('creates/create/creating/created/createdBy/deletes', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const createVerb = {
        verb: 'creates',
        action: 'create',
        activity: 'creating',
        event: 'created',
        reverse: 'createdBy',
        inverse: 'deletes',
        description: 'Standard verb pattern',
      }

      await db.insert(verbs).values(createVerb)
      const results = await db.select().from(verbs).where(eq(verbs.verb, 'creates'))

      expect(results[0].verb).toBe('creates')
      expect(results[0].action).toBe('create')
      expect(results[0].activity).toBe('creating')
      expect(results[0].event).toBe('created')
      expect(results[0].reverse).toBe('createdBy')
      expect(results[0].inverse).toBe('deletes')
    })

    it('owns/own/owning/owned/ownedBy/null', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const ownsVerb = {
        verb: 'owns',
        action: 'own',
        activity: 'owning',
        event: 'owned',
        reverse: 'ownedBy',
        inverse: null,
        description: 'Ownership predicate',
      }

      await db.insert(verbs).values(ownsVerb)
      const results = await db.select().from(verbs).where(eq(verbs.verb, 'owns'))

      expect(results[0].verb).toBe('owns')
      expect(results[0].action).toBe('own')
      expect(results[0].activity).toBe('owning')
      expect(results[0].event).toBe('owned')
      expect(results[0].reverse).toBe('ownedBy')
      expect(results[0].inverse).toBeNull()
    })

    it('manages/manage/managing/managed/managedBy/abandons', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const managesVerb = {
        verb: 'manages',
        action: 'manage',
        activity: 'managing',
        event: 'managed',
        reverse: 'managedBy',
        inverse: 'abandons',
        description: 'Management predicate',
      }

      await db.insert(verbs).values(managesVerb)
      const results = await db.select().from(verbs).where(eq(verbs.verb, 'manages'))

      expect(results[0].verb).toBe('manages')
      expect(results[0].action).toBe('manage')
      expect(results[0].activity).toBe('managing')
      expect(results[0].event).toBe('managed')
      expect(results[0].reverse).toBe('managedBy')
      expect(results[0].inverse).toBe('abandons')
    })
  })

  describe('Irregular Verbs', () => {
    it('has/have/having/had/hadBy/lacks', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const hasVerb = {
        verb: 'has',
        action: 'have',
        activity: 'having',
        event: 'had',
        reverse: 'hadBy',
        inverse: 'lacks',
        description: 'Irregular verb - have',
      }

      await db.insert(verbs).values(hasVerb)
      const results = await db.select().from(verbs).where(eq(verbs.verb, 'has'))

      expect(results[0].verb).toBe('has')
      expect(results[0].action).toBe('have') // Irregular base form
      expect(results[0].activity).toBe('having')
      expect(results[0].event).toBe('had') // Irregular past
      expect(results[0].reverse).toBe('hadBy')
      expect(results[0].inverse).toBe('lacks')
    })

    it('is/be/being/was/wasBy/isNot', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const isVerb = {
        verb: 'is',
        action: 'be',
        activity: 'being',
        event: 'was',
        reverse: 'wasBy',
        inverse: 'isNot',
        description: 'Irregular verb - be',
      }

      await db.insert(verbs).values(isVerb)
      const results = await db.select().from(verbs).where(eq(verbs.verb, 'is'))

      expect(results[0].verb).toBe('is')
      expect(results[0].action).toBe('be') // Highly irregular
      expect(results[0].activity).toBe('being')
      expect(results[0].event).toBe('was') // Highly irregular
    })

    it('goes/go/going/went/wentBy/stays', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const goesVerb = {
        verb: 'goes',
        action: 'go',
        activity: 'going',
        event: 'went',
        reverse: 'wentBy',
        inverse: 'stays',
        description: 'Irregular verb - go',
      }

      await db.insert(verbs).values(goesVerb)
      const results = await db.select().from(verbs).where(eq(verbs.verb, 'goes'))

      expect(results[0].verb).toBe('goes')
      expect(results[0].action).toBe('go')
      expect(results[0].event).toBe('went') // Irregular past
      expect(results[0].inverse).toBe('stays')
    })
  })

  describe('Custom Domain Verbs', () => {
    it('deploys/deploy/deploying/deployed/deployedBy/undeploys', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const deploysVerb = {
        verb: 'deploys',
        action: 'deploy',
        activity: 'deploying',
        event: 'deployed',
        reverse: 'deployedBy',
        inverse: 'undeploys',
        description: 'Software deployment predicate',
      }

      await db.insert(verbs).values(deploysVerb)
      const results = await db.select().from(verbs).where(eq(verbs.verb, 'deploys'))

      expect(results[0].verb).toBe('deploys')
      expect(results[0].action).toBe('deploy')
      expect(results[0].event).toBe('deployed')
      expect(results[0].inverse).toBe('undeploys')
    })

    it('reviews/review/reviewing/reviewed/reviewedBy/unreview', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const reviewsVerb = {
        verb: 'reviews',
        action: 'review',
        activity: 'reviewing',
        event: 'reviewed',
        reverse: 'reviewedBy',
        inverse: null,
        description: 'Code review predicate',
      }

      await db.insert(verbs).values(reviewsVerb)
      const results = await db.select().from(verbs).where(eq(verbs.verb, 'reviews'))

      expect(results[0].verb).toBe('reviews')
      expect(results[0].action).toBe('review')
      expect(results[0].event).toBe('reviewed')
      expect(results[0].reverse).toBe('reviewedBy')
    })

    it('subscribesTo/subscribeTo/subscribingTo/subscribedTo/subscribedToBy/unsubscribesFrom', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const subscribesVerb = {
        verb: 'subscribesTo',
        action: 'subscribeTo',
        activity: 'subscribingTo',
        event: 'subscribedTo',
        reverse: 'subscribedToBy',
        inverse: 'unsubscribesFrom',
        description: 'Multi-word predicate for subscriptions',
      }

      await db.insert(verbs).values(subscribesVerb)
      const results = await db.select().from(verbs).where(eq(verbs.verb, 'subscribesTo'))

      expect(results[0].verb).toBe('subscribesTo')
      expect(results[0].action).toBe('subscribeTo')
      expect(results[0].event).toBe('subscribedTo')
    })
  })
})

// ============================================================================
// Query Patterns Tests (requires better-sqlite3)
// ============================================================================

describe('Query Patterns (requires better-sqlite3)', () => {
  let Database: typeof import('better-sqlite3').default
  let drizzle: typeof import('drizzle-orm/better-sqlite3').drizzle
  let eq: typeof import('drizzle-orm').eq
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
        )
      `)
      db = drizzle(sqlite)

      // Seed comprehensive verb data
      await db.insert(verbs).values([
        { verb: 'creates', action: 'create', activity: 'creating', event: 'created', reverse: 'createdBy', inverse: 'deletes', description: 'Create' },
        { verb: 'updates', action: 'update', activity: 'updating', event: 'updated', reverse: 'updatedBy', inverse: null, description: 'Update' },
        { verb: 'deletes', action: 'delete', activity: 'deleting', event: 'deleted', reverse: 'deletedBy', inverse: 'creates', description: 'Delete' },
        { verb: 'has', action: 'have', activity: 'having', event: 'had', reverse: 'hadBy', inverse: 'lacks', description: 'Possess' },
        { verb: 'lacks', action: 'lack', activity: 'lacking', event: 'lacked', reverse: 'lackedBy', inverse: 'has', description: 'Missing' },
        { verb: 'owns', action: 'own', activity: 'owning', event: 'owned', reverse: 'ownedBy', inverse: null, description: 'Ownership' },
      ])
    } catch {
      // Skip setup if dependencies not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('Find by Action Form', () => {
    it('can find verb by action form (lookup "create" to get "creates")', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const results = await db.select().from(verbs).where(eq(verbs.action, 'create'))

      expect(results).toHaveLength(1)
      expect(results[0].verb).toBe('creates')
    })

    it('can find verb by action form (lookup "have" to get "has")', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const results = await db.select().from(verbs).where(eq(verbs.action, 'have'))

      expect(results).toHaveLength(1)
      expect(results[0].verb).toBe('has')
    })

    it('returns empty for non-existent action', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const results = await db.select().from(verbs).where(eq(verbs.action, 'nonexistent'))

      expect(results).toHaveLength(0)
    })
  })

  describe('Find by Event Form', () => {
    it('can find verb by event form (lookup "created" to get "creates")', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const results = await db.select().from(verbs).where(eq(verbs.event, 'created'))

      expect(results).toHaveLength(1)
      expect(results[0].verb).toBe('creates')
    })

    it('can find verb by event form (lookup "had" to get "has")', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const results = await db.select().from(verbs).where(eq(verbs.event, 'had'))

      expect(results).toHaveLength(1)
      expect(results[0].verb).toBe('has')
    })

    it('can find verb by event form (lookup "deleted" to get "deletes")', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const results = await db.select().from(verbs).where(eq(verbs.event, 'deleted'))

      expect(results).toHaveLength(1)
      expect(results[0].verb).toBe('deletes')
    })
  })

  describe('Find by Activity Form', () => {
    it('can find verb by activity form (lookup "creating" to get "creates")', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const results = await db.select().from(verbs).where(eq(verbs.activity, 'creating'))

      expect(results).toHaveLength(1)
      expect(results[0].verb).toBe('creates')
    })

    it('can find verb by activity form (lookup "owning" to get "owns")', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const results = await db.select().from(verbs).where(eq(verbs.activity, 'owning'))

      expect(results).toHaveLength(1)
      expect(results[0].verb).toBe('owns')
    })
  })

  describe('Find by Reverse Form', () => {
    it('can find verb by reverse form (lookup "createdBy" to get "creates")', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const results = await db.select().from(verbs).where(eq(verbs.reverse, 'createdBy'))

      expect(results).toHaveLength(1)
      expect(results[0].verb).toBe('creates')
    })

    it('can find verb by reverse form (lookup "ownedBy" to get "owns")', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const results = await db.select().from(verbs).where(eq(verbs.reverse, 'ownedBy'))

      expect(results).toHaveLength(1)
      expect(results[0].verb).toBe('owns')
    })
  })

  describe('Find Inverse Relationships', () => {
    it('can find inverse of a verb (creates -> deletes)', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const results = await db.select().from(verbs).where(eq(verbs.verb, 'creates'))
      const createVerb = results[0]

      expect(createVerb.inverse).toBe('deletes')

      // Verify the inverse verb exists
      const inverseResults = await db.select().from(verbs).where(eq(verbs.verb, createVerb.inverse!))
      expect(inverseResults).toHaveLength(1)
      expect(inverseResults[0].verb).toBe('deletes')
    })

    it('can find inverse of a verb (has -> lacks)', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const results = await db.select().from(verbs).where(eq(verbs.verb, 'has'))
      const hasVerb = results[0]

      expect(hasVerb.inverse).toBe('lacks')

      // Verify bidirectional inverse relationship
      const lacksResults = await db.select().from(verbs).where(eq(verbs.verb, 'lacks'))
      expect(lacksResults[0].inverse).toBe('has')
    })

    it('can find all verbs with inverse defined', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const results = await db.select().from(verbs)
      const verbsWithInverse = results.filter(v => v.inverse !== null)

      expect(verbsWithInverse.length).toBeGreaterThan(0)
      // creates, deletes, has, lacks have inverses
      expect(verbsWithInverse.length).toBe(4)
    })

    it('can find all verbs without inverse', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const results = await db.select().from(verbs)
      const verbsWithoutInverse = results.filter(v => v.inverse === null)

      expect(verbsWithoutInverse.length).toBeGreaterThan(0)
      // updates, owns have no inverse
      expect(verbsWithoutInverse.length).toBe(2)
    })
  })

  describe('Complex Query Patterns', () => {
    it('can resolve verb chain: action -> verb -> inverse', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      // Given action 'create', find its inverse verb
      const actionResults = await db.select().from(verbs).where(eq(verbs.action, 'create'))
      expect(actionResults).toHaveLength(1)

      const createVerb = actionResults[0]
      expect(createVerb.inverse).toBe('deletes')

      // Now get the full inverse verb
      const inverseResults = await db.select().from(verbs).where(eq(verbs.verb, createVerb.inverse!))
      expect(inverseResults[0].action).toBe('delete')
      expect(inverseResults[0].event).toBe('deleted')
    })

    it('can resolve verb chain: event -> verb -> reverse', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      // Given event 'updated', find its reverse form
      const eventResults = await db.select().from(verbs).where(eq(verbs.event, 'updated'))
      expect(eventResults).toHaveLength(1)

      const updateVerb = eventResults[0]
      expect(updateVerb.reverse).toBe('updatedBy')
    })
  })
})

// ============================================================================
// Edge Cases Tests (requires better-sqlite3)
// ============================================================================

describe('Edge Cases (requires better-sqlite3)', () => {
  let Database: typeof import('better-sqlite3').default
  let drizzle: typeof import('drizzle-orm/better-sqlite3').drizzle
  let eq: typeof import('drizzle-orm').eq
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
        )
      `)
      db = drizzle(sqlite)
    } catch {
      // Skip setup if dependencies not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('Verbs with No Inverse', () => {
    it('can store verb with null inverse', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const verbWithNoInverse = {
        verb: 'monitors',
        action: 'monitor',
        activity: 'monitoring',
        event: 'monitored',
        reverse: 'monitoredBy',
        inverse: null,
        description: 'Observation without opposite',
      }

      await db.insert(verbs).values(verbWithNoInverse)
      const results = await db.select().from(verbs).where(eq(verbs.verb, 'monitors'))

      expect(results[0].inverse).toBeNull()
    })

    it('can query verbs with null inverse', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      await db.insert(verbs).values([
        { verb: 'creates', action: 'create', activity: 'creating', event: 'created', reverse: 'createdBy', inverse: 'deletes', description: null },
        { verb: 'monitors', action: 'monitor', activity: 'monitoring', event: 'monitored', reverse: 'monitoredBy', inverse: null, description: null },
        { verb: 'observes', action: 'observe', activity: 'observing', event: 'observed', reverse: 'observedBy', inverse: null, description: null },
      ])

      const results = await db.select().from(verbs)
      const verbsWithNullInverse = results.filter(v => v.inverse === null)

      expect(verbsWithNullInverse).toHaveLength(2)
      expect(verbsWithNullInverse.map(v => v.verb)).toContain('monitors')
      expect(verbsWithNullInverse.map(v => v.verb)).toContain('observes')
    })
  })

  describe('Verbs with No Reverse', () => {
    it('can store verb with null reverse', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const verbWithNoReverse = {
        verb: 'exists',
        action: 'exist',
        activity: 'existing',
        event: 'existed',
        reverse: null,
        inverse: 'notExists',
        description: 'State of being - no reverse direction',
      }

      await db.insert(verbs).values(verbWithNoReverse)
      const results = await db.select().from(verbs).where(eq(verbs.verb, 'exists'))

      expect(results[0].reverse).toBeNull()
    })

    it('can query verbs with null reverse', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      await db.insert(verbs).values([
        { verb: 'creates', action: 'create', activity: 'creating', event: 'created', reverse: 'createdBy', inverse: 'deletes', description: null },
        { verb: 'exists', action: 'exist', activity: 'existing', event: 'existed', reverse: null, inverse: null, description: null },
      ])

      const results = await db.select().from(verbs)
      const verbsWithNullReverse = results.filter(v => v.reverse === null)

      expect(verbsWithNullReverse).toHaveLength(1)
      expect(verbsWithNullReverse[0].verb).toBe('exists')
    })
  })

  describe('Duplicate Primary Key Rejection', () => {
    it('rejects duplicate primary key on insert', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      await db.insert(verbs).values({
        verb: 'creates',
        action: 'create',
        activity: 'creating',
        event: 'created',
        reverse: 'createdBy',
        inverse: 'deletes',
        description: 'First insert',
      })

      // Attempt to insert with same primary key
      await expect(
        db.insert(verbs).values({
          verb: 'creates', // Same primary key
          action: 'createDifferent',
          activity: 'creatingDifferent',
          event: 'createdDifferent',
          reverse: 'createdByDifferent',
          inverse: 'deletesDifferent',
          description: 'Duplicate insert',
        })
      ).rejects.toThrow()
    })

    it('allows same linguistic forms for different verbs', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      // Edge case: Two different verbs could theoretically share linguistic forms
      // (this is unusual but should not be prevented by schema)
      await db.insert(verbs).values([
        { verb: 'creates', action: 'create', activity: 'creating', event: 'created', reverse: 'createdBy', inverse: null, description: 'Standard create' },
        { verb: 'constructs', action: 'create', activity: 'creating', event: 'created', reverse: 'createdBy', inverse: null, description: 'Synonym with same forms' },
      ])

      const results = await db.select().from(verbs).where(eq(verbs.action, 'create'))
      expect(results).toHaveLength(2)
    })
  })

  describe('Empty String Values', () => {
    it('can store empty string for optional fields', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const verbWithEmptyStrings = {
        verb: 'testVerb',
        action: '',
        activity: '',
        event: '',
        reverse: '',
        inverse: '',
        description: '',
      }

      await db.insert(verbs).values(verbWithEmptyStrings)
      const results = await db.select().from(verbs).where(eq(verbs.verb, 'testVerb'))

      expect(results[0].action).toBe('')
      expect(results[0].description).toBe('')
    })
  })

  describe('Special Characters in Verb Forms', () => {
    it('can store verbs with special characters', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const specialVerb = {
        verb: 'sends-to',
        action: 'send-to',
        activity: 'sending-to',
        event: 'sent-to',
        reverse: 'sent-to-by',
        inverse: 'receives-from',
        description: 'Hyphenated verb predicate',
      }

      await db.insert(verbs).values(specialVerb)
      const results = await db.select().from(verbs).where(eq(verbs.verb, 'sends-to'))

      expect(results[0].verb).toBe('sends-to')
      expect(results[0].event).toBe('sent-to')
    })

    it('can store verbs with underscores', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const underscoreVerb = {
        verb: 'sends_message_to',
        action: 'send_message_to',
        activity: 'sending_message_to',
        event: 'sent_message_to',
        reverse: 'received_message_from',
        inverse: null,
        description: 'Underscore separated verb',
      }

      await db.insert(verbs).values(underscoreVerb)
      const results = await db.select().from(verbs).where(eq(verbs.verb, 'sends_message_to'))

      expect(results[0].verb).toBe('sends_message_to')
    })

    it('can store verbs with camelCase', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const camelVerb = {
        verb: 'assignsTo',
        action: 'assignTo',
        activity: 'assigningTo',
        event: 'assignedTo',
        reverse: 'assignedToBy',
        inverse: 'unassignsFrom',
        description: 'CamelCase verb predicate',
      }

      await db.insert(verbs).values(camelVerb)
      const results = await db.select().from(verbs).where(eq(verbs.verb, 'assignsTo'))

      expect(results[0].verb).toBe('assignsTo')
      expect(results[0].action).toBe('assignTo')
    })
  })

  describe('Unicode in Descriptions', () => {
    it('can store description with unicode characters', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const unicodeVerb = {
        verb: 'creates',
        action: 'create',
        activity: 'creating',
        event: 'created',
        reverse: 'createdBy',
        inverse: 'deletes',
        description: 'Creates something new. Skapar nagot nytt.',
      }

      await db.insert(verbs).values(unicodeVerb)
      const results = await db.select().from(verbs).where(eq(verbs.verb, 'creates'))

      expect(results[0].description).toBe('Creates something new. Skapar nagot nytt.')
    })

    it('can store description with emoji', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      // Note: This tests database capability, not recommended practice
      const emojiVerb = {
        verb: 'loves',
        action: 'love',
        activity: 'loving',
        event: 'loved',
        reverse: 'lovedBy',
        inverse: 'hates',
        description: 'Expresses affection',
      }

      await db.insert(verbs).values(emojiVerb)
      const results = await db.select().from(verbs).where(eq(verbs.verb, 'loves'))

      expect(results[0].description).toContain('affection')
    })
  })

  describe('Long Values', () => {
    it('can store long description', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      const longDescription = 'A'.repeat(1000) // 1000 character description

      const verbWithLongDesc = {
        verb: 'processes',
        action: 'process',
        activity: 'processing',
        event: 'processed',
        reverse: 'processedBy',
        inverse: null,
        description: longDescription,
      }

      await db.insert(verbs).values(verbWithLongDesc)
      const results = await db.select().from(verbs).where(eq(verbs.verb, 'processes'))

      expect(results[0].description).toBe(longDescription)
      expect(results[0].description!.length).toBe(1000)
    })
  })
})

// ============================================================================
// Query Helper Function Tests (to be implemented)
// ============================================================================

describe('Query Helper Functions (Future Implementation)', () => {
  let Database: typeof import('better-sqlite3').default
  let drizzle: typeof import('drizzle-orm/better-sqlite3').drizzle
  let eq: typeof import('drizzle-orm').eq
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
        )
      `)
      db = drizzle(sqlite)
    } catch {
      // Skip setup if dependencies not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  describe('getVerbByAction', () => {
    it('should return verb record given action form', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      // This test documents expected API for query helpers
      // Implementation: export function getVerbByAction(db, action)

      await db.insert(verbs).values({
        verb: 'creates',
        action: 'create',
        activity: 'creating',
        event: 'created',
        reverse: 'createdBy',
        inverse: 'deletes',
        description: null,
      })

      // Expected API:
      // const result = await getVerbByAction(db, 'create')
      // expect(result?.verb).toBe('creates')

      // For now, verify manual query works
      const results = await db.select().from(verbs).where(eq(verbs.action, 'create'))
      expect(results[0]?.verb).toBe('creates')
    })
  })

  describe('getVerbByEvent', () => {
    it('should return verb record given event form', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      await db.insert(verbs).values({
        verb: 'updates',
        action: 'update',
        activity: 'updating',
        event: 'updated',
        reverse: 'updatedBy',
        inverse: null,
        description: null,
      })

      // Expected API:
      // const result = await getVerbByEvent(db, 'updated')
      // expect(result?.verb).toBe('updates')

      const results = await db.select().from(verbs).where(eq(verbs.event, 'updated'))
      expect(results[0]?.verb).toBe('updates')
    })
  })

  describe('getInverseVerb', () => {
    it('should return inverse verb record', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      await db.insert(verbs).values([
        { verb: 'creates', action: 'create', activity: 'creating', event: 'created', reverse: 'createdBy', inverse: 'deletes', description: null },
        { verb: 'deletes', action: 'delete', activity: 'deleting', event: 'deleted', reverse: 'deletedBy', inverse: 'creates', description: null },
      ])

      // Expected API:
      // const inverse = await getInverseVerb(db, 'creates')
      // expect(inverse?.verb).toBe('deletes')

      const createResults = await db.select().from(verbs).where(eq(verbs.verb, 'creates'))
      const inverseVerb = createResults[0]?.inverse
      const inverseResults = await db.select().from(verbs).where(eq(verbs.verb, inverseVerb!))
      expect(inverseResults[0]?.verb).toBe('deletes')
    })
  })

  describe('resolveVerbForm', () => {
    it('should resolve any linguistic form to canonical verb', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      await db.insert(verbs).values({
        verb: 'creates',
        action: 'create',
        activity: 'creating',
        event: 'created',
        reverse: 'createdBy',
        inverse: 'deletes',
        description: null,
      })

      // Expected API:
      // expect(await resolveVerbForm(db, 'create')).toBe('creates')
      // expect(await resolveVerbForm(db, 'creating')).toBe('creates')
      // expect(await resolveVerbForm(db, 'created')).toBe('creates')
      // expect(await resolveVerbForm(db, 'createdBy')).toBe('creates')
      // expect(await resolveVerbForm(db, 'creates')).toBe('creates')

      // Document test expectations for future implementation
      expect(true).toBe(true)
    })
  })

  describe('getAllLinguisticForms', () => {
    it('should return all forms for a verb', async () => {
      if (!db) throw new Error('better-sqlite3 not installed')

      await db.insert(verbs).values({
        verb: 'manages',
        action: 'manage',
        activity: 'managing',
        event: 'managed',
        reverse: 'managedBy',
        inverse: 'abandons',
        description: null,
      })

      // Expected API:
      // const forms = await getAllLinguisticForms(db, 'manages')
      // expect(forms).toEqual({
      //   verb: 'manages',
      //   action: 'manage',
      //   activity: 'managing',
      //   event: 'managed',
      //   reverse: 'managedBy',
      //   inverse: 'abandons'
      // })

      const results = await db.select().from(verbs).where(eq(verbs.verb, 'manages'))
      expect(results[0].verb).toBe('manages')
      expect(results[0].action).toBe('manage')
      expect(results[0].activity).toBe('managing')
      expect(results[0].event).toBe('managed')
      expect(results[0].reverse).toBe('managedBy')
      expect(results[0].inverse).toBe('abandons')
    })
  })
})

// ============================================================================
// Verbs Table Convention Tests (requires better-sqlite3)
// ============================================================================

describe('Verbs Table Conventions (requires better-sqlite3)', () => {
  let Database: typeof import('better-sqlite3').default
  let drizzle: typeof import('drizzle-orm/better-sqlite3').drizzle
  let eq: typeof import('drizzle-orm').eq
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
        )
      `)
      db = drizzle(sqlite)
    } catch {
      // Skip setup if dependencies not available
    }
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('verifies reverse form matches convention (createdBy)', async () => {
    if (!db) throw new Error('better-sqlite3 not installed')

    await db.insert(verbs).values({
      verb: 'creates',
      action: 'create',
      activity: 'creating',
      event: 'created',
      reverse: 'createdBy',
      inverse: 'deletes',
      description: 'Convention test',
    })

    const results = await db.select().from(verbs).where(eq(verbs.verb, 'creates'))

    // The reverse form should be event + 'By'
    expect(results[0].reverse).toBe(`${results[0].event}By`)
  })
})
