/**
 * Store Types for DO Base Class
 *
 * These types define the interfaces for the store accessors on the DO class:
 * - ThingsStore (this.things)
 * - RelationshipsStore (this.rels)
 * - ActionsStore (this.actions)
 * - EventsStore (this.events)
 * - SearchStore (this.search)
 * - ObjectsStore (this.objects)
 */

import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type * as schema from '../../db'

// ============================================================================
// STORE CONTEXT
// ============================================================================

/**
 * Context passed to stores for initialization
 */
export interface StoreContext {
  db: DrizzleD1Database<typeof schema>
  ns: string
  currentBranch: string
  env: {
    AI?: unknown
    PIPELINE?: { send(data: unknown): Promise<void> }
    DO?: unknown // DurableObjectNamespace from cloudflare:workers
  }
  typeCache: Map<string, number>
}

// ============================================================================
// THING TYPES
// ============================================================================

/** Thing entity returned from ThingsStore operations */
export interface ThingEntity {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
  branch?: string | null
  version?: number
  deleted?: boolean
}

/** Options for ThingsStore get operation */
export interface ThingsGetOptions {
  branch?: string
  version?: number
  includeDeleted?: boolean
}

/** Options for ThingsStore list operation */
export interface ThingsListOptions {
  type?: string
  branch?: string
  orderBy?: string
  order?: 'asc' | 'desc'
  limit?: number
  offset?: number
  after?: string
  includeDeleted?: boolean
  where?: Record<string, unknown>
}

/** Options for ThingsStore create operation */
export interface ThingsCreateOptions {
  branch?: string
}

/** Options for ThingsStore update operation */
export interface ThingsUpdateOptions {
  merge?: boolean
  branch?: string
}

/** Options for ThingsStore delete operation */
export interface ThingsDeleteOptions {
  hard?: boolean
  branch?: string
}

/** ThingsStore interface - CRUD operations for Things */
export interface ThingsStore {
  get(id: string, options?: ThingsGetOptions): Promise<ThingEntity | null>
  list(options?: ThingsListOptions): Promise<ThingEntity[]>
  create(data: Partial<ThingEntity>, options?: ThingsCreateOptions): Promise<ThingEntity>
  update(id: string, data: Partial<ThingEntity>, options?: ThingsUpdateOptions): Promise<ThingEntity>
  delete(id: string, options?: ThingsDeleteOptions): Promise<ThingEntity>
  versions(id: string): Promise<ThingEntity[]>
}

// ============================================================================
// RELATIONSHIP TYPES
// ============================================================================

/** Relationship entity returned from RelationshipsStore operations */
export interface RelationshipEntity {
  id: string
  verb: string
  from: string
  to: string
  data?: Record<string, unknown> | null
  createdAt: Date
}

/** Options for RelationshipsStore list operation */
export interface RelationshipsListOptions {
  from?: string
  to?: string
  verb?: string
  limit?: number
  offset?: number
}

/** Options for RelationshipsStore traversal */
export interface RelationshipsTraversalOptions {
  verb?: string
}

/** RelationshipsStore interface - relationship CRUD and traversal */
export interface RelationshipsStore {
  create(data: { verb: string; from: string; to: string; data?: Record<string, unknown> }): Promise<RelationshipEntity>
  list(options?: RelationshipsListOptions): Promise<RelationshipEntity[]>
  delete(id: string): Promise<RelationshipEntity>
  deleteWhere(criteria: { from?: string; to?: string; verb?: string }): Promise<number>
  from(url: string, options?: RelationshipsTraversalOptions): Promise<RelationshipEntity[]>
  to(url: string, options?: RelationshipsTraversalOptions): Promise<RelationshipEntity[]>
}

// ============================================================================
// ACTION TYPES
// ============================================================================

/** Action entity returned from ActionsStore operations */
export interface ActionEntity {
  id: string
  verb: string
  actor?: string | null
  target: string
  input?: number | Record<string, unknown> | null
  output?: number | Record<string, unknown> | null
  options?: Record<string, unknown> | null
  durability: 'send' | 'try' | 'do'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'undone' | 'retrying'
  error?: Record<string, unknown> | null
  requestId?: string | null
  sessionId?: string | null
  workflowId?: string | null
  createdAt: Date
  startedAt?: Date | null
  completedAt?: Date | null
  duration?: number | null
  retryCount?: number
}

/** Options for ActionsStore log operation */
export interface ActionsLogOptions {
  verb: string
  target: string
  actor?: string
  input?: number | Record<string, unknown>
  output?: number
  durability?: 'send' | 'try' | 'do'
  requestId?: string
  sessionId?: string
  workflowId?: string
}

/** Options for ActionsStore list operation */
export interface ActionsListOptions {
  target?: string
  actor?: string
  status?: string
  verb?: string
}

/** ActionsStore interface - action logging and lifecycle */
export interface ActionsStore {
  log(options: ActionsLogOptions): Promise<ActionEntity>
  complete(id: string, output: unknown): Promise<ActionEntity>
  fail(id: string, error: Error | Record<string, unknown>): Promise<ActionEntity>
  retry(id: string): Promise<ActionEntity>
  get(id: string): Promise<ActionEntity | null>
  list(options?: ActionsListOptions): Promise<ActionEntity[]>
  pending(): Promise<ActionEntity[]>
  failed(): Promise<ActionEntity[]>
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/** Event entity returned from EventsStore operations */
export interface EventEntity {
  id: string
  verb: string
  source: string
  data: Record<string, unknown>
  actionId?: string | null
  sequence: number
  streamed: boolean
  streamedAt?: Date | null
  createdAt: Date
}

/** Options for EventsStore emit operation */
export interface EventsEmitOptions {
  verb: string
  source: string
  data: Record<string, unknown>
  actionId?: string
}

/** Options for EventsStore list operation */
export interface EventsListOptions {
  source?: string
  verb?: string
  afterSequence?: number
  orderBy?: string
  order?: 'asc' | 'desc'
}

/** Options for EventsStore replay operation */
export interface EventsReplayOptions {
  fromSequence: number
  limit?: number
}

/** EventsStore interface - event emission and streaming */
export interface EventsStore {
  emit(options: EventsEmitOptions): Promise<EventEntity>
  stream(id: string): Promise<EventEntity>
  streamPending(): Promise<number>
  get(id: string): Promise<EventEntity | null>
  list(options?: EventsListOptions): Promise<EventEntity[]>
  replay(options: EventsReplayOptions): Promise<EventEntity[]>
}

// ============================================================================
// SEARCH TYPES
// ============================================================================

/** Search entry returned from SearchStore operations */
export interface SearchEntry {
  $id: string
  $type: string
  content: string
  embedding?: Buffer | null
  embeddingDim?: number
  indexedAt: Date
}

/** Search result with score */
export interface SearchResult extends SearchEntry {
  score: number
}

/** Options for SearchStore query operation */
export interface SearchQueryOptions {
  type?: string
  limit?: number
}

/** SearchStore interface - full-text and semantic search */
export interface SearchStore {
  index(entry: { $id: string; $type: string; content: string }): Promise<SearchEntry>
  indexMany(entries: { $id: string; $type: string; content: string }[]): Promise<SearchEntry[]>
  remove(id: string): Promise<void>
  removeMany(ids: string[]): Promise<number>
  query(text: string, options?: SearchQueryOptions): Promise<SearchResult[]>
  semantic(text: string, options?: SearchQueryOptions): Promise<SearchResult[]>
  reindexType(type: string): Promise<number>
}

// ============================================================================
// OBJECTS TYPES
// ============================================================================

/** DO Object entry returned from ObjectsStore operations */
export interface DOObjectEntity {
  ns: string
  id: string
  class: string
  relation?: string | null
  shardKey?: string | null
  shardIndex?: number | null
  region?: string | null
  primary?: boolean | null
  cached?: Record<string, unknown> | null
  createdAt: Date
}

/** Options for ObjectsStore register operation */
export interface ObjectsRegisterOptions {
  ns: string
  id: string
  class: string
  relation?: string
  shardKey?: string
  shardIndex?: number
  region?: string
  primary?: boolean
}

/** Options for ObjectsStore list operation */
export interface ObjectsListOptions {
  relation?: string
  class?: string
}

/** ObjectsStore interface - DO registry and resolution */
export interface ObjectsStore {
  register(options: ObjectsRegisterOptions): Promise<DOObjectEntity>
  get(ns: string): Promise<DOObjectEntity | null>
  list(options?: ObjectsListOptions): Promise<DOObjectEntity[]>
  shards(key: string): Promise<DOObjectEntity[]>
  primary(ns: string): Promise<DOObjectEntity | null>
  update(ns: string, data: Partial<DOObjectEntity>): Promise<DOObjectEntity>
  delete(ns: string): Promise<void>
  resolve(ns: string): Promise<unknown> // Returns DurableObjectStub
}
