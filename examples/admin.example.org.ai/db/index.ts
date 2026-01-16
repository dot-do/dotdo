/**
 * Drizzle Adapter for Admin DO
 *
 * Provides CRUD operations for all admin tables via SQLite storage.
 * This adapter wraps SQLite storage from a Durable Object context
 * and provides drizzle-like query methods.
 *
 * @module examples/admin.example.org.ai/db
 */

import type { SqlStorage } from '@cloudflare/workers-types'
import type {
  Noun,
  NewNoun,
  Verb,
  NewVerb,
  Action,
  NewAction,
  Relationship,
  NewRelationship,
  Function,
  NewFunction,
} from './schema'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Query options for list operations
 */
export interface ListOptions<T> {
  where?: Partial<T>
  limit?: number
  offset?: number
}

/**
 * Generic table accessor interface for CRUD operations
 */
export interface TableAccessor<T, CreateT = Partial<T>> {
  list(options?: ListOptions<T>): T[]
  get(id: string): T | null
  create(data: CreateT): T
  update(id: string, data: Partial<T>): T
  delete(id: string): boolean
  count(where?: Partial<T>): number
}

// ============================================================================
// SQL TABLE CREATION
// ============================================================================

const CREATE_NOUNS_TABLE = `
CREATE TABLE IF NOT EXISTS nouns (
  noun TEXT PRIMARY KEY,
  plural TEXT,
  description TEXT,
  schema TEXT,
  do_class TEXT,
  sharded INTEGER DEFAULT 0,
  shard_count INTEGER DEFAULT 1,
  shard_key TEXT,
  storage TEXT DEFAULT 'hot',
  ttl_days INTEGER,
  indexed_fields TEXT,
  ns_strategy TEXT DEFAULT 'tenant',
  replica_regions TEXT,
  consistency_mode TEXT DEFAULT 'eventual',
  replica_binding TEXT
)
`

const CREATE_VERBS_TABLE = `
CREATE TABLE IF NOT EXISTS verbs (
  verb TEXT PRIMARY KEY,
  action TEXT,
  activity TEXT,
  event TEXT,
  reverse TEXT,
  inverse TEXT,
  description TEXT
)
`

const CREATE_ACTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  verb TEXT NOT NULL,
  actor TEXT,
  target TEXT NOT NULL,
  input INTEGER,
  output INTEGER,
  options TEXT,
  durability TEXT DEFAULT 'try',
  status TEXT DEFAULT 'pending',
  error TEXT,
  request_id TEXT,
  session_id TEXT,
  workflow_id TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  duration INTEGER,
  created_at INTEGER NOT NULL
)
`

const CREATE_RELATIONSHIPS_TABLE = `
CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  verb TEXT NOT NULL,
  "from" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  data TEXT,
  created_at INTEGER NOT NULL
)
`

const CREATE_FUNCTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS functions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'code',
  description TEXT,
  code TEXT,
  model TEXT,
  prompt TEXT,
  inputs TEXT,
  outputs TEXT,
  version TEXT,
  created_at INTEGER,
  updated_at INTEGER
)
`

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateId(): string {
  return crypto.randomUUID()
}

function parseJSON<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }
  return value as T
}

function toJSON(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

// ============================================================================
// NOUNS ACCESSOR
// ============================================================================

class NounsAccessor implements TableAccessor<Noun, NewNoun> {
  constructor(private sql: SqlStorage) {}

  list(options?: ListOptions<Noun>): Noun[] {
    let query = 'SELECT * FROM nouns'
    const params: unknown[] = []
    const conditions: string[] = []

    if (options?.where) {
      for (const [key, value] of Object.entries(options.where)) {
        if (value !== undefined) {
          const columnName = this.toColumnName(key)
          conditions.push(`${columnName} = ?`)
          params.push(value)
        }
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    query += ' ORDER BY noun ASC'

    if (options?.limit) {
      query += ' LIMIT ?'
      params.push(options.limit)
    }

    if (options?.offset) {
      query += ' OFFSET ?'
      params.push(options.offset)
    }

    const rows = this.sql.exec(query, ...params).toArray()
    return rows.map((row: Record<string, unknown>) => this.rowToNoun(row))
  }

  get(id: string): Noun | null {
    const rows = this.sql.exec('SELECT * FROM nouns WHERE noun = ?', id).toArray()
    if (rows.length === 0) return null
    return this.rowToNoun(rows[0])
  }

  create(data: NewNoun): Noun {
    const now = Date.now()
    const noun: Noun = {
      noun: data.noun,
      plural: data.plural ?? null,
      description: data.description ?? null,
      schema: data.schema ?? null,
      doClass: data.doClass ?? null,
      sharded: data.sharded ?? false,
      shardCount: data.shardCount ?? 1,
      shardKey: data.shardKey ?? null,
      storage: data.storage ?? 'hot',
      ttlDays: data.ttlDays ?? null,
      indexedFields: data.indexedFields ?? null,
      nsStrategy: data.nsStrategy ?? 'tenant',
      replicaRegions: data.replicaRegions ?? null,
      consistencyMode: data.consistencyMode ?? 'eventual',
      replicaBinding: data.replicaBinding ?? null,
    }

    this.sql.exec(
      `INSERT INTO nouns (noun, plural, description, schema, do_class, sharded, shard_count, shard_key, storage, ttl_days, indexed_fields, ns_strategy, replica_regions, consistency_mode, replica_binding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      noun.noun,
      noun.plural,
      noun.description,
      toJSON(noun.schema),
      noun.doClass,
      noun.sharded ? 1 : 0,
      noun.shardCount,
      noun.shardKey,
      noun.storage,
      noun.ttlDays,
      toJSON(noun.indexedFields),
      noun.nsStrategy,
      toJSON(noun.replicaRegions),
      noun.consistencyMode,
      noun.replicaBinding
    )

    return noun
  }

  update(id: string, data: Partial<Noun>): Noun {
    const existing = this.get(id)
    if (!existing) {
      throw new Error(`Noun not found: ${id}`)
    }

    const updates: string[] = []
    const params: unknown[] = []

    for (const [key, value] of Object.entries(data)) {
      if (key !== 'noun' && value !== undefined) {
        const columnName = this.toColumnName(key)
        updates.push(`${columnName} = ?`)
        if (['schema', 'indexedFields', 'replicaRegions'].includes(key)) {
          params.push(toJSON(value))
        } else if (key === 'sharded') {
          params.push(value ? 1 : 0)
        } else {
          params.push(value)
        }
      }
    }

    if (updates.length > 0) {
      params.push(id)
      this.sql.exec(`UPDATE nouns SET ${updates.join(', ')} WHERE noun = ?`, ...params)
    }

    return this.get(id)!
  }

  delete(id: string): boolean {
    const existing = this.get(id)
    if (!existing) return false

    this.sql.exec('DELETE FROM nouns WHERE noun = ?', id)
    return true
  }

  count(where?: Partial<Noun>): number {
    let query = 'SELECT COUNT(*) as count FROM nouns'
    const params: unknown[] = []
    const conditions: string[] = []

    if (where) {
      for (const [key, value] of Object.entries(where)) {
        if (value !== undefined) {
          const columnName = this.toColumnName(key)
          conditions.push(`${columnName} = ?`)
          params.push(value)
        }
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    const rows = this.sql.exec(query, ...params).toArray()
    return (rows[0]?.count as number) ?? 0
  }

  private toColumnName(key: string): string {
    const mapping: Record<string, string> = {
      doClass: 'do_class',
      shardCount: 'shard_count',
      shardKey: 'shard_key',
      ttlDays: 'ttl_days',
      indexedFields: 'indexed_fields',
      nsStrategy: 'ns_strategy',
      replicaRegions: 'replica_regions',
      consistencyMode: 'consistency_mode',
      replicaBinding: 'replica_binding',
    }
    return mapping[key] ?? key
  }

  private rowToNoun(row: Record<string, unknown>): Noun {
    return {
      noun: row.noun as string,
      plural: row.plural as string | null,
      description: row.description as string | null,
      schema: parseJSON(row.schema),
      doClass: row.do_class as string | null,
      sharded: Boolean(row.sharded),
      shardCount: (row.shard_count as number) ?? 1,
      shardKey: row.shard_key as string | null,
      storage: (row.storage as string) ?? 'hot',
      ttlDays: row.ttl_days as number | null,
      indexedFields: parseJSON(row.indexed_fields),
      nsStrategy: (row.ns_strategy as string) ?? 'tenant',
      replicaRegions: parseJSON(row.replica_regions),
      consistencyMode: (row.consistency_mode as string) ?? 'eventual',
      replicaBinding: row.replica_binding as string | null,
    }
  }
}

// ============================================================================
// VERBS ACCESSOR
// ============================================================================

class VerbsAccessor implements TableAccessor<Verb, NewVerb> {
  constructor(private sql: SqlStorage) {}

  list(options?: ListOptions<Verb>): Verb[] {
    let query = 'SELECT * FROM verbs'
    const params: unknown[] = []
    const conditions: string[] = []

    if (options?.where) {
      for (const [key, value] of Object.entries(options.where)) {
        if (value !== undefined) {
          conditions.push(`${key} = ?`)
          params.push(value)
        }
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    query += ' ORDER BY verb ASC'

    if (options?.limit) {
      query += ' LIMIT ?'
      params.push(options.limit)
    }

    if (options?.offset) {
      query += ' OFFSET ?'
      params.push(options.offset)
    }

    const rows = this.sql.exec(query, ...params).toArray()
    return rows.map((row: Record<string, unknown>) => this.rowToVerb(row))
  }

  get(id: string): Verb | null {
    const rows = this.sql.exec('SELECT * FROM verbs WHERE verb = ?', id).toArray()
    if (rows.length === 0) return null
    return this.rowToVerb(rows[0])
  }

  create(data: NewVerb): Verb {
    const verb: Verb = {
      verb: data.verb,
      action: data.action ?? null,
      activity: data.activity ?? null,
      event: data.event ?? null,
      reverse: data.reverse ?? null,
      inverse: data.inverse ?? null,
      description: data.description ?? null,
    }

    this.sql.exec(
      `INSERT INTO verbs (verb, action, activity, event, reverse, inverse, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      verb.verb,
      verb.action,
      verb.activity,
      verb.event,
      verb.reverse,
      verb.inverse,
      verb.description
    )

    return verb
  }

  update(id: string, data: Partial<Verb>): Verb {
    const existing = this.get(id)
    if (!existing) {
      throw new Error(`Verb not found: ${id}`)
    }

    const updates: string[] = []
    const params: unknown[] = []

    for (const [key, value] of Object.entries(data)) {
      if (key !== 'verb' && value !== undefined) {
        updates.push(`${key} = ?`)
        params.push(value)
      }
    }

    if (updates.length > 0) {
      params.push(id)
      this.sql.exec(`UPDATE verbs SET ${updates.join(', ')} WHERE verb = ?`, ...params)
    }

    return this.get(id)!
  }

  delete(id: string): boolean {
    const existing = this.get(id)
    if (!existing) return false

    this.sql.exec('DELETE FROM verbs WHERE verb = ?', id)
    return true
  }

  count(where?: Partial<Verb>): number {
    let query = 'SELECT COUNT(*) as count FROM verbs'
    const params: unknown[] = []
    const conditions: string[] = []

    if (where) {
      for (const [key, value] of Object.entries(where)) {
        if (value !== undefined) {
          conditions.push(`${key} = ?`)
          params.push(value)
        }
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    const rows = this.sql.exec(query, ...params).toArray()
    return (rows[0]?.count as number) ?? 0
  }

  private rowToVerb(row: Record<string, unknown>): Verb {
    return {
      verb: row.verb as string,
      action: row.action as string | null,
      activity: row.activity as string | null,
      event: row.event as string | null,
      reverse: row.reverse as string | null,
      inverse: row.inverse as string | null,
      description: row.description as string | null,
    }
  }
}

// ============================================================================
// ACTIONS ACCESSOR
// ============================================================================

class ActionsAccessor implements TableAccessor<Action, NewAction> {
  constructor(private sql: SqlStorage) {}

  list(options?: ListOptions<Action>): Action[] {
    let query = 'SELECT * FROM actions'
    const params: unknown[] = []
    const conditions: string[] = []

    if (options?.where) {
      for (const [key, value] of Object.entries(options.where)) {
        if (value !== undefined) {
          const columnName = this.toColumnName(key)
          conditions.push(`${columnName} = ?`)
          params.push(value)
        }
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    query += ' ORDER BY created_at DESC'

    if (options?.limit) {
      query += ' LIMIT ?'
      params.push(options.limit)
    }

    if (options?.offset) {
      query += ' OFFSET ?'
      params.push(options.offset)
    }

    const rows = this.sql.exec(query, ...params).toArray()
    return rows.map((row: Record<string, unknown>) => this.rowToAction(row))
  }

  get(id: string): Action | null {
    const rows = this.sql.exec('SELECT * FROM actions WHERE id = ?', id).toArray()
    if (rows.length === 0) return null
    return this.rowToAction(rows[0])
  }

  create(data: NewAction): Action {
    const now = Date.now()
    const id = data.id ?? generateId()

    const action: Action = {
      id,
      verb: data.verb,
      actor: data.actor ?? null,
      target: data.target,
      input: data.input ?? null,
      output: data.output ?? null,
      options: data.options ?? null,
      durability: data.durability ?? 'try',
      status: data.status ?? 'pending',
      error: data.error ?? null,
      requestId: data.requestId ?? null,
      sessionId: data.sessionId ?? null,
      workflowId: data.workflowId ?? null,
      startedAt: data.startedAt ?? null,
      completedAt: data.completedAt ?? null,
      duration: data.duration ?? null,
      createdAt: data.createdAt ?? new Date(now),
    }

    this.sql.exec(
      `INSERT INTO actions (id, verb, actor, target, input, output, options, durability, status, error, request_id, session_id, workflow_id, started_at, completed_at, duration, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      action.id,
      action.verb,
      action.actor,
      action.target,
      action.input,
      action.output,
      toJSON(action.options),
      action.durability,
      action.status,
      toJSON(action.error),
      action.requestId,
      action.sessionId,
      action.workflowId,
      action.startedAt ? action.startedAt.getTime() : null,
      action.completedAt ? action.completedAt.getTime() : null,
      action.duration,
      action.createdAt.getTime()
    )

    return action
  }

  update(id: string, data: Partial<Action>): Action {
    const existing = this.get(id)
    if (!existing) {
      throw new Error(`Action not found: ${id}`)
    }

    const updates: string[] = []
    const params: unknown[] = []

    for (const [key, value] of Object.entries(data)) {
      if (key !== 'id' && value !== undefined) {
        const columnName = this.toColumnName(key)
        updates.push(`${columnName} = ?`)
        if (['options', 'error'].includes(key)) {
          params.push(toJSON(value))
        } else if (['startedAt', 'completedAt', 'createdAt'].includes(key)) {
          params.push(value instanceof Date ? value.getTime() : value)
        } else {
          params.push(value)
        }
      }
    }

    if (updates.length > 0) {
      params.push(id)
      this.sql.exec(`UPDATE actions SET ${updates.join(', ')} WHERE id = ?`, ...params)
    }

    return this.get(id)!
  }

  delete(id: string): boolean {
    const existing = this.get(id)
    if (!existing) return false

    this.sql.exec('DELETE FROM actions WHERE id = ?', id)
    return true
  }

  count(where?: Partial<Action>): number {
    let query = 'SELECT COUNT(*) as count FROM actions'
    const params: unknown[] = []
    const conditions: string[] = []

    if (where) {
      for (const [key, value] of Object.entries(where)) {
        if (value !== undefined) {
          const columnName = this.toColumnName(key)
          conditions.push(`${columnName} = ?`)
          params.push(value)
        }
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    const rows = this.sql.exec(query, ...params).toArray()
    return (rows[0]?.count as number) ?? 0
  }

  private toColumnName(key: string): string {
    const mapping: Record<string, string> = {
      requestId: 'request_id',
      sessionId: 'session_id',
      workflowId: 'workflow_id',
      startedAt: 'started_at',
      completedAt: 'completed_at',
      createdAt: 'created_at',
    }
    return mapping[key] ?? key
  }

  private rowToAction(row: Record<string, unknown>): Action {
    return {
      id: row.id as string,
      verb: row.verb as string,
      actor: row.actor as string | null,
      target: row.target as string,
      input: row.input as number | null,
      output: row.output as number | null,
      options: parseJSON(row.options),
      durability: (row.durability as 'send' | 'try' | 'do') ?? 'try',
      status: (row.status as Action['status']) ?? 'pending',
      error: parseJSON(row.error),
      requestId: row.request_id as string | null,
      sessionId: row.session_id as string | null,
      workflowId: row.workflow_id as string | null,
      startedAt: row.started_at ? new Date(row.started_at as number) : null,
      completedAt: row.completed_at ? new Date(row.completed_at as number) : null,
      duration: row.duration as number | null,
      createdAt: new Date((row.created_at as number) ?? Date.now()),
    }
  }
}

// ============================================================================
// RELATIONSHIPS ACCESSOR
// ============================================================================

class RelationshipsAccessor implements TableAccessor<Relationship, NewRelationship> {
  constructor(private sql: SqlStorage) {}

  list(options?: ListOptions<Relationship>): Relationship[] {
    let query = 'SELECT * FROM relationships'
    const params: unknown[] = []
    const conditions: string[] = []

    if (options?.where) {
      for (const [key, value] of Object.entries(options.where)) {
        if (value !== undefined) {
          const columnName = this.toColumnName(key)
          conditions.push(`${columnName} = ?`)
          params.push(value)
        }
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    query += ' ORDER BY created_at DESC'

    if (options?.limit) {
      query += ' LIMIT ?'
      params.push(options.limit)
    }

    if (options?.offset) {
      query += ' OFFSET ?'
      params.push(options.offset)
    }

    const rows = this.sql.exec(query, ...params).toArray()
    return rows.map((row: Record<string, unknown>) => this.rowToRelationship(row))
  }

  get(id: string): Relationship | null {
    const rows = this.sql.exec('SELECT * FROM relationships WHERE id = ?', id).toArray()
    if (rows.length === 0) return null
    return this.rowToRelationship(rows[0])
  }

  create(data: NewRelationship): Relationship {
    const now = Date.now()
    const id = data.id ?? generateId()

    const relationship: Relationship = {
      id,
      verb: data.verb,
      from: data.from,
      to: data.to,
      data: data.data ?? null,
      createdAt: data.createdAt ?? new Date(now),
    }

    this.sql.exec(
      `INSERT INTO relationships (id, verb, "from", "to", data, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      relationship.id,
      relationship.verb,
      relationship.from,
      relationship.to,
      toJSON(relationship.data),
      relationship.createdAt.getTime()
    )

    return relationship
  }

  update(id: string, data: Partial<Relationship>): Relationship {
    const existing = this.get(id)
    if (!existing) {
      throw new Error(`Relationship not found: ${id}`)
    }

    const updates: string[] = []
    const params: unknown[] = []

    for (const [key, value] of Object.entries(data)) {
      if (key !== 'id' && value !== undefined) {
        const columnName = this.toColumnName(key)
        updates.push(`${columnName} = ?`)
        if (key === 'data') {
          params.push(toJSON(value))
        } else if (key === 'createdAt') {
          params.push(value instanceof Date ? value.getTime() : value)
        } else {
          params.push(value)
        }
      }
    }

    if (updates.length > 0) {
      params.push(id)
      this.sql.exec(`UPDATE relationships SET ${updates.join(', ')} WHERE id = ?`, ...params)
    }

    return this.get(id)!
  }

  delete(id: string): boolean {
    const existing = this.get(id)
    if (!existing) return false

    this.sql.exec('DELETE FROM relationships WHERE id = ?', id)
    return true
  }

  count(where?: Partial<Relationship>): number {
    let query = 'SELECT COUNT(*) as count FROM relationships'
    const params: unknown[] = []
    const conditions: string[] = []

    if (where) {
      for (const [key, value] of Object.entries(where)) {
        if (value !== undefined) {
          const columnName = this.toColumnName(key)
          conditions.push(`${columnName} = ?`)
          params.push(value)
        }
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    const rows = this.sql.exec(query, ...params).toArray()
    return (rows[0]?.count as number) ?? 0
  }

  private toColumnName(key: string): string {
    const mapping: Record<string, string> = {
      from: '"from"',
      to: '"to"',
      createdAt: 'created_at',
    }
    return mapping[key] ?? key
  }

  private rowToRelationship(row: Record<string, unknown>): Relationship {
    return {
      id: row.id as string,
      verb: row.verb as string,
      from: row.from as string,
      to: row.to as string,
      data: parseJSON(row.data),
      createdAt: new Date((row.created_at as number) ?? Date.now()),
    }
  }
}

// ============================================================================
// FUNCTIONS ACCESSOR
// ============================================================================

class FunctionsAccessor implements TableAccessor<Function, NewFunction> {
  constructor(private sql: SqlStorage) {}

  list(options?: ListOptions<Function>): Function[] {
    let query = 'SELECT * FROM functions'
    const params: unknown[] = []
    const conditions: string[] = []

    if (options?.where) {
      for (const [key, value] of Object.entries(options.where)) {
        if (value !== undefined) {
          const columnName = this.toColumnName(key)
          conditions.push(`${columnName} = ?`)
          params.push(value)
        }
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    query += ' ORDER BY name ASC'

    if (options?.limit) {
      query += ' LIMIT ?'
      params.push(options.limit)
    }

    if (options?.offset) {
      query += ' OFFSET ?'
      params.push(options.offset)
    }

    const rows = this.sql.exec(query, ...params).toArray()
    return rows.map((row: Record<string, unknown>) => this.rowToFunction(row))
  }

  get(id: string): Function | null {
    const rows = this.sql.exec('SELECT * FROM functions WHERE id = ?', id).toArray()
    if (rows.length === 0) return null
    return this.rowToFunction(rows[0])
  }

  create(data: NewFunction): Function {
    const now = Date.now()
    const id = data.id ?? generateId()

    const func: Function = {
      id,
      name: data.name,
      type: data.type ?? 'code',
      description: data.description ?? null,
      code: data.code ?? null,
      model: data.model ?? null,
      prompt: data.prompt ?? null,
      inputs: data.inputs ?? [],
      outputs: data.outputs ?? [],
      version: data.version ?? null,
      createdAt: data.createdAt ?? new Date(now),
      updatedAt: data.updatedAt ?? new Date(now),
    }

    this.sql.exec(
      `INSERT INTO functions (id, name, type, description, code, model, prompt, inputs, outputs, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      func.id,
      func.name,
      func.type,
      func.description,
      func.code,
      func.model,
      func.prompt,
      toJSON(func.inputs),
      toJSON(func.outputs),
      func.version,
      func.createdAt ? func.createdAt.getTime() : now,
      func.updatedAt ? func.updatedAt.getTime() : now
    )

    return func
  }

  update(id: string, data: Partial<Function>): Function {
    const existing = this.get(id)
    if (!existing) {
      throw new Error(`Function not found: ${id}`)
    }

    const updates: string[] = []
    const params: unknown[] = []

    // Always update updated_at
    updates.push('updated_at = ?')
    params.push(Date.now())

    for (const [key, value] of Object.entries(data)) {
      if (key !== 'id' && key !== 'updatedAt' && value !== undefined) {
        const columnName = this.toColumnName(key)
        updates.push(`${columnName} = ?`)
        if (['inputs', 'outputs'].includes(key)) {
          params.push(toJSON(value))
        } else if (key === 'createdAt') {
          params.push(value instanceof Date ? value.getTime() : value)
        } else {
          params.push(value)
        }
      }
    }

    if (updates.length > 0) {
      params.push(id)
      this.sql.exec(`UPDATE functions SET ${updates.join(', ')} WHERE id = ?`, ...params)
    }

    return this.get(id)!
  }

  delete(id: string): boolean {
    const existing = this.get(id)
    if (!existing) return false

    this.sql.exec('DELETE FROM functions WHERE id = ?', id)
    return true
  }

  count(where?: Partial<Function>): number {
    let query = 'SELECT COUNT(*) as count FROM functions'
    const params: unknown[] = []
    const conditions: string[] = []

    if (where) {
      for (const [key, value] of Object.entries(where)) {
        if (value !== undefined) {
          const columnName = this.toColumnName(key)
          conditions.push(`${columnName} = ?`)
          params.push(value)
        }
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    const rows = this.sql.exec(query, ...params).toArray()
    return (rows[0]?.count as number) ?? 0
  }

  private toColumnName(key: string): string {
    const mapping: Record<string, string> = {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
    return mapping[key] ?? key
  }

  private rowToFunction(row: Record<string, unknown>): Function {
    return {
      id: row.id as string,
      name: row.name as string,
      type: (row.type as Function['type']) ?? 'code',
      description: row.description as string | null,
      code: row.code as string | null,
      model: row.model as string | null,
      prompt: row.prompt as string | null,
      inputs: parseJSON(row.inputs) ?? [],
      outputs: parseJSON(row.outputs) ?? [],
      version: row.version as string | null,
      createdAt: row.created_at ? new Date(row.created_at as number) : null,
      updatedAt: row.updated_at ? new Date(row.updated_at as number) : null,
    }
  }
}

// ============================================================================
// DRIZZLE ADAPTER
// ============================================================================

/**
 * DrizzleAdapter wraps SQLite storage and provides CRUD operations
 * for all admin tables.
 */
export class DrizzleAdapter {
  readonly nouns: NounsAccessor
  readonly verbs: VerbsAccessor
  readonly actions: ActionsAccessor
  readonly relationships: RelationshipsAccessor
  readonly functions: FunctionsAccessor

  constructor(sql: SqlStorage) {
    // Create tables if they don't exist
    this.initTables(sql)

    // Create accessors
    this.nouns = new NounsAccessor(sql)
    this.verbs = new VerbsAccessor(sql)
    this.actions = new ActionsAccessor(sql)
    this.relationships = new RelationshipsAccessor(sql)
    this.functions = new FunctionsAccessor(sql)
  }

  private initTables(sql: SqlStorage): void {
    sql.exec(CREATE_NOUNS_TABLE)
    sql.exec(CREATE_VERBS_TABLE)
    sql.exec(CREATE_ACTIONS_TABLE)
    sql.exec(CREATE_RELATIONSHIPS_TABLE)
    sql.exec(CREATE_FUNCTIONS_TABLE)
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export type {
  Noun,
  NewNoun,
  Verb,
  NewVerb,
  Action,
  NewAction,
  Relationship,
  NewRelationship,
  Function,
  NewFunction,
}
