// ============================================================================
// CLICKHOUSE TYPES FOR DOTDO
// ============================================================================
//
// TypeScript types matching the ClickHouse schema.
// These types are used for:
// - Inserting data via S3Queue or direct HTTP
// - Query result typing
// - Pipeline transformations
//
// ============================================================================

import { Tag } from '../../lib/sqids'

// ============================================================================
// SQIDS TUPLE
// ============================================================================

/**
 * Sqids tuple for attribution and correlation.
 * Each field encodes tag-value pairs using sqidEncode.
 */
export interface SqidsTuple {
  /** Identity reference - always populated */
  ref: string
  /** Actor attribution - who/how */
  actor?: string | null
  /** Trace correlation - request/session/workflow */
  trace?: string | null
  /** Context attribution - experiments/channels/location */
  context?: string | null
}

/**
 * Extended sqids tuple for Relationships (includes edge)
 */
export interface RelationshipSqidsTuple extends SqidsTuple {
  /** Full edge identity */
  edge: string
}

/**
 * Extended sqids tuple for Events (includes source)
 */
export interface EventSqidsTuple extends SqidsTuple {
  /** Source thing reference */
  source: string
}

/**
 * Extended sqids tuple for Search (includes chunk)
 */
export interface SearchSqidsTuple extends Omit<SqidsTuple, 'context'> {
  /** Chunk identity including model/strategy */
  chunk: string
}

/**
 * Extended sqids tuple for Artifacts (includes parent)
 */
export interface ArtifactSqidsTuple extends Omit<SqidsTuple, 'context'> {
  /** Parent thing reference */
  parent: string
}

// ============================================================================
// VISIBILITY
// ============================================================================

export type Visibility =
  | 'public'
  | 'unlisted'
  | `org:${string}`
  | `user:${string}`
  | 'deleted'

// ============================================================================
// THINGS
// ============================================================================

export interface Thing {
  // Identity
  url: string
  ns: string
  type: string
  id: string
  ts: number // epoch millis

  // Content
  name?: string | null
  data: Record<string, unknown>
  meta: Record<string, unknown>
  relationships: Record<string, string[]> // { verb: [url, ...] }

  // Lifecycle
  branch?: string | null
  visibility?: Visibility | null

  // Sqids
  sqids: SqidsTuple
}

// ============================================================================
// RELATIONSHIPS
// ============================================================================

export interface Relationship {
  // Target
  to: string
  toNs: string
  toType: string
  toId: string

  // Source
  from: string
  fromNs: string
  fromType: string
  fromId: string

  // Verbs
  verb: string
  reverse: string

  // Lifecycle
  visibility?: Visibility | null

  // Metadata
  data: Record<string, unknown>
  ts: number

  // Sqids
  sqids: RelationshipSqidsTuple
}

// ============================================================================
// ACTIONS
// ============================================================================

export type ActionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'undone'
  | 'retrying'

export type ActionDurability = 'send' | 'try' | 'do'

export interface Action {
  // Identity
  url: string
  ns: string
  type: string
  id: string
  ts: number

  // Action details
  verb: string
  actor?: string | null
  target: string

  // Version references
  input?: number | null
  output?: number | null

  // Status
  status: ActionStatus
  durability: ActionDurability

  // Payloads
  options: Record<string, unknown>
  error: Record<string, unknown>

  // Correlation
  requestId?: string | null
  sessionId?: string | null
  workflowId?: string | null

  // Timing
  startedAt?: number | null
  completedAt?: number | null
  duration?: number | null

  // Sqids
  sqids: SqidsTuple
}

// ============================================================================
// EVENTS
// ============================================================================

export interface Event {
  // Identity
  url: string
  ns: string
  type: string
  id: string
  ts: number

  // Event details
  verb: string
  source: string
  object?: string | null
  result?: string | null

  // Payload
  data: Record<string, unknown>

  // Correlation
  actionId?: string | null
  sequence: number

  // Sqids
  sqids: EventSqidsTuple
}

// ============================================================================
// SEARCH
// ============================================================================

export interface SearchChunk {
  // Source identity
  url: string
  ns: string
  type: string
  id: string
  ts: number

  // Chunk identity
  chunkId: string
  chunkIndex: number

  // Content
  content: string
  embedding: number[]

  // Strategy
  model: string
  strategy: string
  dimensions: number

  // Metadata
  meta: Record<string, unknown>

  // Sqids
  sqids: SearchSqidsTuple
}

// ============================================================================
// ARTIFACTS
// ============================================================================

export interface Artifact {
  // Identity
  url: string
  ns: string
  type: string
  id: string
  ts: number

  // Parent reference
  thingUrl: string

  // Content
  content: string // base64 or raw
  contentType: string
  size: number
  hash: string

  // Metadata
  meta: Record<string, unknown>

  // Sqids
  sqids: ArtifactSqidsTuple
}

// ============================================================================
// QUERY RESULT TYPES
// ============================================================================

/**
 * Thing with inbound references (the 80% query pattern)
 */
export interface ThingWithReferences extends Thing {
  /** Inbound references grouped by reverse verb */
  references: Record<string, string | string[]>
}

/**
 * References grouped by reverse verb
 * Single value = string, multiple = array
 */
export type ReferencesMap = Record<string, string | string[]>

// ============================================================================
// SQID ENCODING HELPERS
// ============================================================================

/**
 * Tag-value pairs for sqid encoding.
 * Must be even length: [tag1, value1, tag2, value2, ...]
 */
export type TagValuePairs = number[]

/**
 * Create sqid encoding for Thing ref
 */
export function encodeThingRef(
  nsId: number,
  typeId: number,
  thingId: number,
  branchId: number,
  version: number
): TagValuePairs {
  return [Tag.NS, nsId, Tag.TYPE, typeId, Tag.THING, thingId, Tag.BRANCH, branchId, Tag.VERSION, version]
}

/**
 * Create sqid encoding for actor attribution
 */
export function encodeActor(
  actorId: number,
  methodId?: number,
  toolId?: number,
  modelId?: number
): TagValuePairs {
  const pairs: TagValuePairs = [Tag.ACTOR, actorId]
  if (methodId !== undefined) pairs.push(Tag.METHOD, methodId)
  if (toolId !== undefined) pairs.push(Tag.TOOL, toolId)
  if (modelId !== undefined) pairs.push(Tag.MODEL, modelId)
  return pairs
}

/**
 * Create sqid encoding for trace correlation
 */
export function encodeTrace(
  timestamp: number,
  requestId?: number,
  sessionId?: number,
  workflowId?: number
): TagValuePairs {
  const pairs: TagValuePairs = [Tag.TIMESTAMP, timestamp]
  // REQUEST, SESSION, WORKFLOW would need additional Tag values
  // For now, encode as positional after timestamp
  return pairs
}

/**
 * Create sqid encoding for context attribution
 */
export function encodeContext(
  experimentId?: number,
  variantId?: number,
  channelId?: number,
  locationId?: number
): TagValuePairs {
  const pairs: TagValuePairs = []
  if (experimentId !== undefined) pairs.push(Tag.EXPERIMENT, experimentId)
  if (variantId !== undefined) pairs.push(Tag.VARIANT, variantId)
  if (channelId !== undefined) pairs.push(Tag.CHANNEL, channelId)
  if (locationId !== undefined) pairs.push(Tag.LOCATION, locationId)
  return pairs
}
