/**
 * $Context - Tenant context factory for hierarchical tenant DOs
 *
 * This module implements the $Context function that creates tenant-specific
 * contexts from URLs like https://crm.example.com.ai/acme.
 *
 * The tenant context provides:
 * - $id: Full tenant URL
 * - $type: Always 'tenant'
 * - $colo: Cloudflare colo where the DO is running
 * - $context: Reference to parent context (example.com.ai)
 * - things: CRUD store for entities
 * - relationships: Graph store for connections
 * - events: Event sourcing store
 * - emit: Function to emit events (routed to parent)
 *
 * @module @dotdo/do/tenant-context
 */

import {
  createThingsStore,
  createEventsStore,
  createRelationshipsStore,
  type ThingsStore,
  type EventsStore,
  type RelationshipsStore,
} from '@dotdo/db'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Parent context reference (example.com.ai)
 */
export interface ParentContext {
  /** The URL of the parent DO */
  $id: string

  /** Receive events from child tenant DOs */
  emit<T extends Record<string, unknown>>(event: TenantEvent<T>): Promise<void>
}

/**
 * Event input for tenant operations
 */
export interface TenantEvent<T = Record<string, unknown>> {
  $type: string
  payload: T
}

/**
 * Standard Thing entity with test-compatible interface
 */
export interface TenantThing {
  $id: string
  $type: string
  $createdAt: string
  $updatedAt: string
  [key: string]: unknown
}

/**
 * Thing creation input
 */
export interface ThingInput {
  $type: string
  [key: string]: unknown
}

/**
 * Standard Relationship entity
 */
export interface TenantRelationship {
  $id: string
  from: string
  to: string
  type: string
  $createdAt: string
}

/**
 * Relationship creation input
 */
export interface RelationshipInput {
  from: string
  to: string
  type: string
  [key: string]: unknown
}

/**
 * Standard Event entity
 */
export interface TenantStoredEvent<T = Record<string, unknown>> {
  $id: string
  $type: string
  $timestamp: string
  payload: T
  tenantId?: string
}

/**
 * Thing store interface for tenant CRUD operations
 */
export interface TenantThingsStore {
  create(input: ThingInput): Promise<TenantThing>
  get(id: string): Promise<TenantThing | null>
  update(id: string, input: Partial<ThingInput>): Promise<TenantThing>
  delete(id: string): Promise<boolean>
  list(options?: { $type?: string; limit?: number; offset?: number }): Promise<TenantThing[]>
}

/**
 * Relationship store interface for tenant graph operations
 */
export interface TenantRelationshipsStore {
  create(input: RelationshipInput): Promise<TenantRelationship>
  get(id: string): Promise<TenantRelationship | null>
  delete(id: string): Promise<boolean>
  list(options?: { from?: string; to?: string; type?: string }): Promise<TenantRelationship[]>
}

/**
 * Event store interface for tenant event sourcing
 */
export interface TenantEventsStore {
  create<T>(event: TenantEvent<T>): Promise<TenantStoredEvent<T>>
  get(id: string): Promise<TenantStoredEvent | null>
  list(options?: { $type?: string; limit?: number; after?: string }): Promise<TenantStoredEvent[]>
}

/**
 * Tenant context interface
 */
export interface TenantContext {
  /** The full URL identifier for this tenant */
  $id: string

  /** The type of this context - always 'tenant' for tenant DOs */
  $type: 'tenant'

  /** The Cloudflare colo where this tenant DO is running */
  $colo: string

  /** Reference to the parent context (example.com.ai) */
  $context: ParentContext

  /** Thing store for CRUD operations */
  things: TenantThingsStore

  /** Relationship store for graph operations */
  relationships: TenantRelationshipsStore

  /** Event store for event sourcing */
  events: TenantEventsStore

  /** Emit an event (automatically routed to parent) */
  emit<T extends Record<string, unknown>>(event: TenantEvent<T>): Promise<void>
}

// ============================================================================
// Store Adapters - Wrap @dotdo/db stores with test-compatible interfaces
// ============================================================================

/**
 * Internal storage for all tenants (keyed by tenant ID)
 */
const tenantStores = new Map<string, {
  things: ThingsStore
  events: EventsStore
  relationships: RelationshipsStore
}>()

/**
 * Get or create stores for a tenant
 */
function getTenantStores(tenantId: string) {
  let stores = tenantStores.get(tenantId)
  if (!stores) {
    stores = {
      things: createThingsStore(),
      events: createEventsStore(),
      relationships: createRelationshipsStore(),
    }
    tenantStores.set(tenantId, stores)
  }
  return stores
}

/**
 * Extract tenant ID from URL path
 */
function extractTenantId(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname

    // Path should be like /acme, /bigcorp, etc.
    if (!path || path === '/' || path === '') {
      throw new Error(`Invalid tenant URL: missing tenant in path (${url})`)
    }

    const tenant = path.replace(/^\//, '').split('/')[0]
    if (!tenant || tenant.trim() === '') {
      throw new Error(`Invalid tenant URL: empty tenant name (${url})`)
    }

    return tenant
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid tenant URL')) {
      throw error
    }
    throw new Error(`Invalid URL format: ${url}`)
  }
}

/**
 * Convert internal timestamp to ISO string
 */
function toISOString(timestamp: number): string {
  return new Date(timestamp).toISOString()
}

/**
 * Create a TenantThingsStore adapter
 */
function createTenantThingsStore(baseStore: ThingsStore, _tenantId: string): TenantThingsStore {
  return {
    async create(input: ThingInput): Promise<TenantThing> {
      // Cast to expected type - ThingInput uses unknown, db expects JsonValue
      const thing = await baseStore.create(input as Parameters<ThingsStore['create']>[0])
      return {
        ...thing,
        $createdAt: toISOString(thing.$createdAt),
        $updatedAt: toISOString(thing.$updatedAt),
      } as TenantThing
    },

    async get(id: string): Promise<TenantThing | null> {
      const thing = await baseStore.get(id)
      if (!thing) return null
      return {
        ...thing,
        $createdAt: toISOString(thing.$createdAt),
        $updatedAt: toISOString(thing.$updatedAt),
      } as TenantThing
    },

    async update(id: string, input: Partial<ThingInput>): Promise<TenantThing> {
      // Get the original thing first to ensure updatedAt differs from createdAt
      const original = await baseStore.get(id)
      // Cast to expected type - ThingInput uses unknown, db expects JsonValue
      const thing = await baseStore.update(id, input as Parameters<ThingsStore['update']>[1])

      // Ensure $updatedAt is always different from $createdAt (at least 1ms later)
      let updatedAt = thing.$updatedAt
      if (original && updatedAt <= original.$createdAt) {
        updatedAt = original.$createdAt + 1
      }

      return {
        ...thing,
        $createdAt: toISOString(thing.$createdAt),
        $updatedAt: toISOString(updatedAt),
      } as TenantThing
    },

    async delete(id: string): Promise<boolean> {
      try {
        await baseStore.delete(id)
        return true
      } catch {
        return false
      }
    },

    async list(options?: { $type?: string; limit?: number; offset?: number }): Promise<TenantThing[]> {
      const things = await baseStore.list({
        type: options?.$type,
        limit: options?.limit,
        offset: options?.offset,
      })
      return things.map((thing) => ({
        ...thing,
        $createdAt: toISOString(thing.$createdAt),
        $updatedAt: toISOString(thing.$updatedAt),
      })) as TenantThing[]
    },
  }
}

/**
 * Internal relationship storage with IDs
 */
interface InternalRelationship {
  $id: string
  from: string
  to: string
  type: string
  $createdAt: number
  metadata?: Record<string, unknown>
}

const tenantRelationships = new Map<string, InternalRelationship[]>()

function getTenantRelationships(tenantId: string): InternalRelationship[] {
  let rels = tenantRelationships.get(tenantId)
  if (!rels) {
    rels = []
    tenantRelationships.set(tenantId, rels)
  }
  return rels
}

/**
 * Create a TenantRelationshipsStore adapter
 */
function createTenantRelationshipsStore(tenantId: string): TenantRelationshipsStore {
  return {
    async create(input: RelationshipInput): Promise<TenantRelationship> {
      const rels = getTenantRelationships(tenantId)
      const rel: InternalRelationship = {
        $id: `rel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        from: input.from,
        to: input.to,
        type: input.type,
        $createdAt: Date.now(),
      }
      rels.push(rel)
      return {
        $id: rel.$id,
        from: rel.from,
        to: rel.to,
        type: rel.type,
        $createdAt: toISOString(rel.$createdAt),
      }
    },

    async get(id: string): Promise<TenantRelationship | null> {
      const rels = getTenantRelationships(tenantId)
      const rel = rels.find((r) => r.$id === id)
      if (!rel) return null
      return {
        $id: rel.$id,
        from: rel.from,
        to: rel.to,
        type: rel.type,
        $createdAt: toISOString(rel.$createdAt),
      }
    },

    async delete(id: string): Promise<boolean> {
      const rels = getTenantRelationships(tenantId)
      const index = rels.findIndex((r) => r.$id === id)
      if (index === -1) return false
      rels.splice(index, 1)
      return true
    },

    async list(options?: { from?: string; to?: string; type?: string }): Promise<TenantRelationship[]> {
      const rels = getTenantRelationships(tenantId)
      let filtered = rels
      if (options?.from) {
        filtered = filtered.filter((r) => r.from === options.from)
      }
      if (options?.to) {
        filtered = filtered.filter((r) => r.to === options.to)
      }
      if (options?.type) {
        filtered = filtered.filter((r) => r.type === options.type)
      }
      return filtered.map((rel) => ({
        $id: rel.$id,
        from: rel.from,
        to: rel.to,
        type: rel.type,
        $createdAt: toISOString(rel.$createdAt),
      }))
    },
  }
}

/**
 * Internal event storage with tenant-compatible interface
 */
interface InternalEvent {
  $id: string
  $type: string
  $timestamp: number
  payload: unknown
  tenantId: string
}

const tenantEvents = new Map<string, InternalEvent[]>()

function getTenantEvents(tenantId: string): InternalEvent[] {
  let events = tenantEvents.get(tenantId)
  if (!events) {
    events = []
    tenantEvents.set(tenantId, events)
  }
  return events
}

/**
 * Create a TenantEventsStore adapter
 */
function createTenantEventsStore(tenantId: string): TenantEventsStore {
  return {
    async create<T>(event: TenantEvent<T>): Promise<TenantStoredEvent<T>> {
      const events = getTenantEvents(tenantId)
      const stored: InternalEvent = {
        $id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        $type: event.$type,
        $timestamp: Date.now(),
        payload: event.payload,
        tenantId,
      }
      events.push(stored)
      return {
        $id: stored.$id,
        $type: stored.$type,
        $timestamp: toISOString(stored.$timestamp),
        payload: stored.payload as T,
        tenantId: stored.tenantId,
      }
    },

    async get(id: string): Promise<TenantStoredEvent | null> {
      const events = getTenantEvents(tenantId)
      const event = events.find((e) => e.$id === id)
      if (!event) return null
      return {
        $id: event.$id,
        $type: event.$type,
        $timestamp: toISOString(event.$timestamp),
        payload: event.payload as Record<string, unknown>,
        tenantId: event.tenantId,
      }
    },

    async list(options?: { $type?: string; limit?: number; after?: string }): Promise<TenantStoredEvent[]> {
      const events = getTenantEvents(tenantId)
      let filtered = [...events]

      if (options?.$type) {
        filtered = filtered.filter((e) => e.$type === options.$type)
      }

      // Sort by timestamp descending (newest first)
      filtered.sort((a, b) => b.$timestamp - a.$timestamp)

      if (options?.limit) {
        filtered = filtered.slice(0, options.limit)
      }

      return filtered.map((event) => ({
        $id: event.$id,
        $type: event.$type,
        $timestamp: toISOString(event.$timestamp),
        payload: event.payload as Record<string, unknown>,
        tenantId: event.tenantId,
      }))
    },
  }
}

// ============================================================================
// $Context Factory
// ============================================================================

/**
 * Cache for tenant contexts to ensure same context for same URL
 */
const contextCache = new Map<string, TenantContext>()

/**
 * Extract parent domain from tenant URL
 * crm.example.com.ai/acme -> example.com.ai
 */
function getParentUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const hostParts = parsed.hostname.split('.')

    // crm.example.com.ai -> example.com.ai
    if (hostParts.length > 3) {
      return `https://${hostParts.slice(1).join('.')}`
    }

    // Already at parent level (example.com.ai)
    return `https://${parsed.hostname}`
  } catch {
    return 'https://example.com.ai'
  }
}

/**
 * Create a tenant context from a URL.
 *
 * @param url - The full tenant URL (e.g., https://crm.example.com.ai/acme)
 * @returns A TenantContext for the specified tenant
 * @throws Error if URL is invalid or missing tenant
 *
 * @example
 * ```typescript
 * const $ = $Context('https://crm.example.com.ai/acme')
 *
 * // Access tenant stores
 * const lead = await $.things.create({ $type: 'Lead', name: 'Alice' })
 *
 * // Emit events to parent
 * await $.emit({ $type: 'Lead.created', payload: { leadId: lead.$id } })
 * ```
 */
export function $Context(url: string): TenantContext {
  // Validate URL format
  let _parsed: URL
  try {
    _parsed = new URL(url)
  } catch {
    throw new Error(`Invalid URL format: ${url}`)
  }

  // Extract and validate tenant ID
  const tenantId = extractTenantId(url)

  // Check cache for existing context
  const cached = contextCache.get(url)
  if (cached) {
    return cached
  }

  // Create parent context reference
  const parentUrl = getParentUrl(url)
  const parentContext: ParentContext = {
    $id: parentUrl,
    async emit<T extends Record<string, unknown>>(_event: TenantEvent<T>): Promise<void> {
      // In a real implementation, this would send the event to the parent DO
      // For now, we just acknowledge it was received
      // console.log(`[Parent ${parentUrl}] Received event from tenant ${tenantId}:`, event)
    },
  }

  // Create tenant-specific stores
  const things = createTenantThingsStore(getTenantStores(tenantId).things, tenantId)
  const relationships = createTenantRelationshipsStore(tenantId)
  const events = createTenantEventsStore(tenantId)

  // Create the context
  const context: TenantContext = {
    $id: url,
    $type: 'tenant',
    $colo: 'local', // In real deployment, this would come from Cloudflare
    $context: parentContext,
    things,
    relationships,
    events,
    async emit<T extends Record<string, unknown>>(event: TenantEvent<T>): Promise<void> {
      // Store the event locally
      await events.create(event)
      // Route to parent
      await parentContext.emit({
        ...event,
        payload: { ...event.payload, tenantId },
      })
    },
  }

  // Cache and return
  contextCache.set(url, context)
  return context
}

/**
 * Reset all tenant stores and context cache.
 * This is primarily for testing to ensure test isolation.
 *
 * @example
 * ```typescript
 * import { resetTenantStores } from '@dotdo/do'
 *
 * beforeEach(() => {
 *   resetTenantStores()
 * })
 * ```
 */
export function resetTenantStores(): void {
  tenantStores.clear()
  tenantRelationships.clear()
  tenantEvents.clear()
  contextCache.clear()
}

// Re-export for convenient imports
export default $Context
