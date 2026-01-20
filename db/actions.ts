// Actions Store - Linguistic model for metadata as source of truth
// Integrated from sdb (~/projects/sdb) per do-etru.2
//
// The key insight from sdb is that Actions (instances of Verbs) are the source
// of truth for all metadata like createdAt, createdBy, updatedAt, etc.
//
// Instead of storing these as fields on Things, we derive them from Actions:
//   - createdAt → from 'created' Action's `at` timestamp
//   - createdBy → from 'created' Action's `$by` field
//   - updatedAt → from most recent 'updated' Action's `at` timestamp
//
// This provides:
// 1. Full audit trail of all changes
// 2. Who/what/when for every mutation
// 3. Ability to reconstruct state at any point in time
// 4. Natural graph traversal via Actions as edges

import type { SqlStorage } from './sqlite'
import { generateId } from './id'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verb - Type definition for Actions (the relationship type)
 *
 * Linguistic model:
 * - action: imperative form ('create', 'update', 'delete')
 * - activity: present continuous ('creating', 'updating', 'deleting')
 * - event: past tense ('created', 'updated', 'deleted')
 * - reverse: predicates synthesized on Things (['createdBy', 'createdAt', 'createdIn'])
 * - inverse: opposite action ('delete' is inverse of 'create')
 */
export interface Verb {
  _id: number
  action: string       // 'create'
  activity: string     // 'creating'
  event: string        // 'created'
  reverse: string[]    // ['createdBy', 'createdAt', 'createdIn']
  inverse?: string     // 'delete'
}

/**
 * Action - An instance of a Verb (relationship between Things)
 *
 * Actions form the edges in the graph and serve as the source of truth
 * for all metadata. They read as sentences:
 *   "pst_xyz was created by usr_abc at 1705612800000 in req_abc123"
 */
export interface Action {
  _id: number           // Monotonic internal ID
  from: string          // Subject Thing $id (the thing that was acted upon)
  verb: string          // Event form: 'created', 'updated', 'followed'
  to: string            // Object Thing $id or external URL
  at: number            // When this action happened (timestamp)
  $by: string           // Who performed it (user email URL or system)
  $in: string           // Request context (ray ID, correlation ID)
}

/**
 * Input type for creating an Action
 */
export type ActionInput = Omit<Action, '_id'>

/**
 * Filter options for querying Actions
 */
export interface ActionFilter {
  from?: string
  to?: string
  verb?: string
  $by?: string
  since?: number
  until?: number
  limit?: number
}

/**
 * Actions store interface
 */
export interface ActionsStore {
  create(input: ActionInput): Promise<Action>
  get(id: number): Promise<Action | null>
  list(filter?: ActionFilter): Promise<Action[]>
  getByFrom(from: string, verb?: string, limit?: number): Promise<Action[]>
  getByTo(to: string, verb?: string, limit?: number): Promise<Action[]>
  getLatest(from: string, verb: string): Promise<Action | null>
  delete(id: number): Promise<boolean>
  deleteByKey(from: string, verb: string, to: string): Promise<boolean>
  count(filter?: ActionFilter): Promise<number>
  // Bulk operations
  bulkCreate(inputs: ActionInput[]): Promise<Action[]>
  // Internal for checkpoint
  loadFromSnapshot(actions: Action[]): void
  toSnapshot(): Action[]
}

/**
 * Verbs store interface
 */
export interface VerbsStore {
  get(action: string): Verb | undefined
  getByEvent(event: string): Verb | undefined
  list(): Verb[]
  add(verb: Omit<Verb, '_id'>): Verb
  seedDefaults(): void
}

// ═══════════════════════════════════════════════════════════════════════════
// Default Verbs (seeded on initialization)
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_VERBS: Omit<Verb, '_id'>[] = [
  // Write verbs (create Actions in DO)
  { action: 'create', activity: 'creating', event: 'created', reverse: ['createdBy', 'createdAt', 'createdIn'], inverse: 'delete' },
  { action: 'update', activity: 'updating', event: 'updated', reverse: ['updatedBy', 'updatedAt', 'updatedIn'] },
  { action: 'delete', activity: 'deleting', event: 'deleted', reverse: ['deletedBy', 'deletedAt', 'deletedIn'], inverse: 'create' },
  { action: 'link',   activity: 'linking',  event: 'linked',  reverse: ['linkedBy', 'linkedAt', 'linkedIn'], inverse: 'unlink' },
  { action: 'unlink', activity: 'unlinking', event: 'unlinked', reverse: ['unlinkedBy', 'unlinkedAt', 'unlinkedIn'], inverse: 'link' },
  // Read verbs (for analytics, no Actions stored in DO)
  { action: 'list',   activity: 'listing',   event: 'listed',   reverse: ['listedBy', 'listedAt', 'listedIn'] },
  { action: 'get',    activity: 'getting',   event: 'got',      reverse: ['gotBy', 'gotAt', 'gotIn'] },
  { action: 'search', activity: 'searching', event: 'searched', reverse: ['searchedBy', 'searchedAt', 'searchedIn'] },
]

// ═══════════════════════════════════════════════════════════════════════════
// In-Memory Actions Store
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create an in-memory Actions store
 * Uses Maps with indexes for efficient lookups
 */
export function createActionsStore(): ActionsStore {
  const actions = new Map<number, Action>()
  let nextId = 1

  // Indexes for efficient lookups
  const byFrom = new Map<string, Set<number>>()
  const byTo = new Map<string, Set<number>>()
  const byFromVerb = new Map<string, Map<string, Set<number>>>()

  function addToIndex(action: Action): void {
    // By from
    if (!byFrom.has(action.from)) {
      byFrom.set(action.from, new Set())
    }
    byFrom.get(action.from)!.add(action._id)

    // By to
    if (!byTo.has(action.to)) {
      byTo.set(action.to, new Set())
    }
    byTo.get(action.to)!.add(action._id)

    // By from + verb
    if (!byFromVerb.has(action.from)) {
      byFromVerb.set(action.from, new Map())
    }
    if (!byFromVerb.get(action.from)!.has(action.verb)) {
      byFromVerb.get(action.from)!.set(action.verb, new Set())
    }
    byFromVerb.get(action.from)!.get(action.verb)!.add(action._id)
  }

  function removeFromIndex(action: Action): void {
    byFrom.get(action.from)?.delete(action._id)
    byTo.get(action.to)?.delete(action._id)
    byFromVerb.get(action.from)?.get(action.verb)?.delete(action._id)
  }

  return {
    async create(input: ActionInput): Promise<Action> {
      const action: Action = {
        _id: nextId++,
        ...input,
      }
      actions.set(action._id, action)
      addToIndex(action)
      return action
    },

    async get(id: number): Promise<Action | null> {
      return actions.get(id) ?? null
    },

    async list(filter?: ActionFilter): Promise<Action[]> {
      let results = Array.from(actions.values())

      if (filter?.from) {
        const ids = byFrom.get(filter.from)
        if (!ids) return []
        results = results.filter(a => ids.has(a._id))
      }

      if (filter?.to) {
        const ids = byTo.get(filter.to)
        if (!ids) return []
        results = results.filter(a => ids.has(a._id))
      }

      if (filter?.verb) {
        results = results.filter(a => a.verb === filter.verb)
      }

      if (filter?.$by) {
        results = results.filter(a => a.$by === filter.$by)
      }

      if (filter?.since !== undefined) {
        results = results.filter(a => a.at >= filter.since!)
      }

      if (filter?.until !== undefined) {
        results = results.filter(a => a.at <= filter.until!)
      }

      // Sort by timestamp descending
      results.sort((a, b) => b.at - a.at)

      if (filter?.limit) {
        results = results.slice(0, filter.limit)
      }

      return results
    },

    async getByFrom(from: string, verb?: string, limit: number = 100): Promise<Action[]> {
      let ids: Set<number> | undefined

      if (verb) {
        ids = byFromVerb.get(from)?.get(verb)
      } else {
        ids = byFrom.get(from)
      }

      if (!ids) return []

      let results = Array.from(ids)
        .map(id => actions.get(id)!)
        .filter(Boolean)

      // Sort by timestamp descending
      results.sort((a, b) => b.at - a.at)

      return results.slice(0, limit)
    },

    async getByTo(to: string, verb?: string, limit: number = 100): Promise<Action[]> {
      const ids = byTo.get(to)
      if (!ids) return []

      let results = Array.from(ids)
        .map(id => actions.get(id)!)
        .filter(Boolean)

      if (verb) {
        results = results.filter(a => a.verb === verb)
      }

      // Sort by timestamp descending
      results.sort((a, b) => b.at - a.at)

      return results.slice(0, limit)
    },

    async getLatest(from: string, verb: string): Promise<Action | null> {
      const ids = byFromVerb.get(from)?.get(verb)
      if (!ids || ids.size === 0) return null

      let latest: Action | null = null
      for (const id of ids) {
        const action = actions.get(id)
        if (action && (!latest || action.at > latest.at)) {
          latest = action
        }
      }
      return latest
    },

    async delete(id: number): Promise<boolean> {
      const action = actions.get(id)
      if (!action) return false
      removeFromIndex(action)
      actions.delete(id)
      return true
    },

    async deleteByKey(from: string, verb: string, to: string): Promise<boolean> {
      const ids = byFromVerb.get(from)?.get(verb)
      if (!ids) return false

      for (const id of ids) {
        const action = actions.get(id)
        if (action && action.to === to) {
          removeFromIndex(action)
          actions.delete(id)
          return true
        }
      }
      return false
    },

    async count(filter?: ActionFilter): Promise<number> {
      const results = await this.list(filter)
      return results.length
    },

    async bulkCreate(inputs: ActionInput[]): Promise<Action[]> {
      const created: Action[] = []
      for (const input of inputs) {
        const action: Action = {
          _id: nextId++,
          ...input,
        }
        actions.set(action._id, action)
        addToIndex(action)
        created.push(action)
      }
      return created
    },

    loadFromSnapshot(snapshot: Action[]): void {
      // Clear existing data
      actions.clear()
      byFrom.clear()
      byTo.clear()
      byFromVerb.clear()
      nextId = 1

      // Load from snapshot
      for (const action of snapshot) {
        actions.set(action._id, action)
        addToIndex(action)
        if (action._id >= nextId) {
          nextId = action._id + 1
        }
      }
    },

    toSnapshot(): Action[] {
      return Array.from(actions.values())
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// In-Memory Verbs Store
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create an in-memory Verbs store
 */
export function createVerbsStore(): VerbsStore {
  const verbs = new Map<string, Verb>()
  const verbsByEvent = new Map<string, Verb>()
  let nextId = 1

  return {
    get(action: string): Verb | undefined {
      return verbs.get(action)
    },

    getByEvent(event: string): Verb | undefined {
      return verbsByEvent.get(event)
    },

    list(): Verb[] {
      return Array.from(verbs.values())
    },

    add(input: Omit<Verb, '_id'>): Verb {
      const verb: Verb = {
        _id: nextId++,
        ...input,
      }
      verbs.set(verb.action, verb)
      verbsByEvent.set(verb.event, verb)
      return verb
    },

    seedDefaults(): void {
      for (const verbInput of DEFAULT_VERBS) {
        if (!verbs.has(verbInput.action)) {
          this.add(verbInput)
        }
      }
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SQLite Actions Store
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a SQLite-backed Actions store
 */
export function createSQLiteActionsStore(sql: SqlStorage): ActionsStore {
  // Ensure schema exists
  sql.exec(`
    CREATE TABLE IF NOT EXISTS actions (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      "from" TEXT NOT NULL,
      verb TEXT NOT NULL,
      "to" TEXT NOT NULL,
      at INTEGER NOT NULL,
      by TEXT NOT NULL,
      context TEXT NOT NULL
    )
  `)

  sql.exec('CREATE INDEX IF NOT EXISTS idx_actions_from ON actions("from")')
  sql.exec('CREATE INDEX IF NOT EXISTS idx_actions_to ON actions("to")')
  sql.exec('CREATE INDEX IF NOT EXISTS idx_actions_verb ON actions(verb)')
  sql.exec('CREATE INDEX IF NOT EXISTS idx_actions_from_verb ON actions("from", verb)')
  sql.exec('CREATE INDEX IF NOT EXISTS idx_actions_at ON actions(at DESC)')

  return {
    async create(input: ActionInput): Promise<Action> {
      await sql
        .prepare('INSERT INTO actions ("from", verb, "to", at, by, context) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(input.from, input.verb, input.to, input.at, input.$by, input.$in)
        .run()

      // Get the last inserted ID
      const result = await sql
        .prepare('SELECT last_insert_rowid() as id')
        .bind()
        .first() as { id: number } | null

      return {
        _id: result?.id ?? 0,
        ...input,
      }
    },

    async get(id: number): Promise<Action | null> {
      const row = await sql
        .prepare('SELECT _id, "from", verb, "to", at, by, context FROM actions WHERE _id = ?')
        .bind(id)
        .first()

      if (!row) return null

      return {
        _id: row._id as number,
        from: row.from as string,
        verb: row.verb as string,
        to: row.to as string,
        at: row.at as number,
        $by: row.by as string,
        $in: row.context as string,
      }
    },

    async list(filter?: ActionFilter): Promise<Action[]> {
      const conditions: string[] = []
      const params: (string | number)[] = []

      if (filter?.from) {
        conditions.push('"from" = ?')
        params.push(filter.from)
      }
      if (filter?.to) {
        conditions.push('"to" = ?')
        params.push(filter.to)
      }
      if (filter?.verb) {
        conditions.push('verb = ?')
        params.push(filter.verb)
      }
      if (filter?.$by) {
        conditions.push('by = ?')
        params.push(filter.$by)
      }
      if (filter?.since !== undefined) {
        conditions.push('at >= ?')
        params.push(filter.since)
      }
      if (filter?.until !== undefined) {
        conditions.push('at <= ?')
        params.push(filter.until)
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const limitClause = filter?.limit ? `LIMIT ${filter.limit}` : 'LIMIT 100'

      const result = await sql
        .prepare(`SELECT _id, "from", verb, "to", at, by, context FROM actions ${whereClause} ORDER BY at DESC ${limitClause}`)
        .bind(...params)
        .all()

      return result.results.map(row => ({
        _id: row._id as number,
        from: row.from as string,
        verb: row.verb as string,
        to: row.to as string,
        at: row.at as number,
        $by: row.by as string,
        $in: row.context as string,
      }))
    },

    async getByFrom(from: string, verb?: string, limit: number = 100): Promise<Action[]> {
      let result
      if (verb) {
        result = await sql
          .prepare('SELECT _id, "from", verb, "to", at, by, context FROM actions WHERE "from" = ? AND verb = ? ORDER BY at DESC LIMIT ?')
          .bind(from, verb, limit)
          .all()
      } else {
        result = await sql
          .prepare('SELECT _id, "from", verb, "to", at, by, context FROM actions WHERE "from" = ? ORDER BY at DESC LIMIT ?')
          .bind(from, limit)
          .all()
      }

      return result.results.map(row => ({
        _id: row._id as number,
        from: row.from as string,
        verb: row.verb as string,
        to: row.to as string,
        at: row.at as number,
        $by: row.by as string,
        $in: row.context as string,
      }))
    },

    async getByTo(to: string, verb?: string, limit: number = 100): Promise<Action[]> {
      let result
      if (verb) {
        result = await sql
          .prepare('SELECT _id, "from", verb, "to", at, by, context FROM actions WHERE "to" = ? AND verb = ? ORDER BY at DESC LIMIT ?')
          .bind(to, verb, limit)
          .all()
      } else {
        result = await sql
          .prepare('SELECT _id, "from", verb, "to", at, by, context FROM actions WHERE "to" = ? ORDER BY at DESC LIMIT ?')
          .bind(to, limit)
          .all()
      }

      return result.results.map(row => ({
        _id: row._id as number,
        from: row.from as string,
        verb: row.verb as string,
        to: row.to as string,
        at: row.at as number,
        $by: row.by as string,
        $in: row.context as string,
      }))
    },

    async getLatest(from: string, verb: string): Promise<Action | null> {
      const row = await sql
        .prepare('SELECT _id, "from", verb, "to", at, by, context FROM actions WHERE "from" = ? AND verb = ? ORDER BY at DESC LIMIT 1')
        .bind(from, verb)
        .first()

      if (!row) return null

      return {
        _id: row._id as number,
        from: row.from as string,
        verb: row.verb as string,
        to: row.to as string,
        at: row.at as number,
        $by: row.by as string,
        $in: row.context as string,
      }
    },

    async delete(id: number): Promise<boolean> {
      await sql
        .prepare('DELETE FROM actions WHERE _id = ?')
        .bind(id)
        .run()
      // Note: We cannot reliably check if a row was deleted with this interface
      return true
    },

    async deleteByKey(from: string, verb: string, to: string): Promise<boolean> {
      await sql
        .prepare('DELETE FROM actions WHERE "from" = ? AND verb = ? AND "to" = ?')
        .bind(from, verb, to)
        .run()
      return true
    },

    async count(filter?: ActionFilter): Promise<number> {
      const conditions: string[] = []
      const params: (string | number)[] = []

      if (filter?.from) {
        conditions.push('"from" = ?')
        params.push(filter.from)
      }
      if (filter?.to) {
        conditions.push('"to" = ?')
        params.push(filter.to)
      }
      if (filter?.verb) {
        conditions.push('verb = ?')
        params.push(filter.verb)
      }
      if (filter?.$by) {
        conditions.push('by = ?')
        params.push(filter.$by)
      }
      if (filter?.since !== undefined) {
        conditions.push('at >= ?')
        params.push(filter.since)
      }
      if (filter?.until !== undefined) {
        conditions.push('at <= ?')
        params.push(filter.until)
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      const result = await sql
        .prepare(`SELECT COUNT(*) as count FROM actions ${whereClause}`)
        .bind(...params)
        .first() as { count: number } | null

      return result?.count ?? 0
    },

    async bulkCreate(inputs: ActionInput[]): Promise<Action[]> {
      const created: Action[] = []
      for (const input of inputs) {
        const action = await this.create(input)
        created.push(action)
      }
      return created
    },

    loadFromSnapshot(snapshot: Action[]): void {
      // Clear and reload
      sql.exec('DELETE FROM actions')
      for (const action of snapshot) {
        sql.exec('BEGIN TRANSACTION')
        try {
          // Temporarily use exec for bulk loading
          sql.exec(`
            INSERT INTO actions (_id, "from", verb, "to", at, by, context)
            VALUES (${action._id}, '${action.from.replace(/'/g, "''")}', '${action.verb.replace(/'/g, "''")}', '${action.to.replace(/'/g, "''")}', ${action.at}, '${action.$by.replace(/'/g, "''")}', '${action.$in.replace(/'/g, "''")}')
          `)
          sql.exec('COMMIT')
        } catch (e) {
          sql.exec('ROLLBACK')
          throw e
        }
      }
    },

    toSnapshot(): Action[] {
      const result = sql.exec('SELECT _id, "from", verb, "to", at, by, context FROM actions ORDER BY _id')
      return result.results.map(row => ({
        _id: row._id as number,
        from: row.from as string,
        verb: row.verb as string,
        to: row.to as string,
        at: row.at as number,
        $by: row.by as string,
        $in: row.context as string,
      }))
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper: Synthesize metadata from Actions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Synthesize metadata fields from Actions for a Thing.
 *
 * This is the core of the linguistic model - instead of storing
 * createdAt/updatedAt on Things, we derive them from Actions.
 */
export async function synthesizeMetadataFromActions(
  thingId: string,
  actionsStore: ActionsStore
): Promise<{
  createdAt?: number
  createdBy?: string
  createdIn?: string
  updatedAt?: number
  updatedBy?: string
  updatedIn?: string
  deletedAt?: number
  deletedBy?: string
  deletedIn?: string
}> {
  const metadata: Record<string, unknown> = {}

  // Get 'created' action
  const createdAction = await actionsStore.getLatest(thingId, 'created')
  if (createdAction) {
    metadata.createdAt = createdAction.at
    metadata.createdBy = createdAction.to
    metadata.createdIn = createdAction.$in
  }

  // Get latest 'updated' action
  const updatedAction = await actionsStore.getLatest(thingId, 'updated')
  if (updatedAction) {
    metadata.updatedAt = updatedAction.at
    metadata.updatedBy = updatedAction.to
    metadata.updatedIn = updatedAction.$in
  }

  // Get 'deleted' action (for soft delete)
  const deletedAction = await actionsStore.getLatest(thingId, 'deleted')
  if (deletedAction) {
    metadata.deletedAt = deletedAction.at
    metadata.deletedBy = deletedAction.to
    metadata.deletedIn = deletedAction.$in
  }

  return metadata as {
    createdAt?: number
    createdBy?: string
    createdIn?: string
    updatedAt?: number
    updatedBy?: string
    updatedIn?: string
    deletedAt?: number
    deletedBy?: string
    deletedIn?: string
  }
}
