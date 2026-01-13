/**
 * Tool Provider Graph Implementation
 *
 * Issue: dotdo-q900r
 *
 * Thing-based graph API for Tool -> Provider relationships.
 * Implements:
 * - Provider Thing storage and CRUD
 * - Tool -> Provider 'providedBy' relationships
 * - Provider -> Credential 'authenticatedBy' relationships
 * - Multi-provider failover and health tracking
 * - Query APIs (findByType, getRelationshipsFrom/To)
 *
 * @see db/compat/graph/tests/tool-providers.test.ts for usage examples
 */

import { createGraphStorage, GraphStorage, type StoredNode, type StoredRelationship } from '../neo4j/graph-storage'

// ============================================================================
// Types
// ============================================================================

/**
 * Provider health status
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy'

/**
 * Provider Thing data schema
 */
export interface ProviderThingData {
  name: string
  category: string
  apiBaseUrl?: string
  docsUrl?: string
  healthStatus?: HealthStatus
  lastHealthCheck?: number
  failoverPriority?: number
  compatModule?: string
  sdkVersion?: string
  capabilities?: string[]
}

/**
 * Tool Thing data schema
 */
export interface ToolThingData {
  id: string
  name: string
  description?: string
  category?: string
  compatMethod?: string
  capability?: string
}

/**
 * Credential Thing data schema
 */
export interface CredentialThingData {
  type: 'api_key' | 'oauth' | 'bearer_token' | 'basic_auth'
  provider: string
  secretRef: string
  createdAt: number
  expiresAt?: number
  rotatedAt?: number
  revokedAt?: number
  revocationReason?: string
}

/**
 * Base Thing interface
 */
export interface BaseThing<TData = Record<string, unknown>> {
  $type: string
  $id: string
  data: TData
}

/**
 * Provider Thing
 */
export type ProviderThing = BaseThing<ProviderThingData>

/**
 * Tool Thing
 */
export type ToolThing = BaseThing<ToolThingData>

/**
 * Credential Thing
 */
export type CredentialThing = BaseThing<CredentialThingData>

/**
 * Generic Thing union type
 */
export type AnyThing = ProviderThing | ToolThing | CredentialThing | BaseThing

/**
 * Relationship with optional metadata
 */
export interface ThingRelationship {
  id: string
  verb: string
  from: string
  to: string
  data?: Record<string, unknown>
  createdAt: number
}

/**
 * Create Thing input
 */
export interface CreateThingInput<TData = Record<string, unknown>> {
  $type: string
  data: TData
}

/**
 * Create relationship input
 */
export interface CreateRelationshipInput {
  verb: string
  from: string
  to: string
  data?: Record<string, unknown>
}

/**
 * Update Thing input
 */
export interface UpdateThingInput<TData = Record<string, unknown>> {
  data: Partial<TData>
}

/**
 * Query filter for findByType
 */
export interface QueryFilter {
  where?: Record<string, unknown>
}

/**
 * Options for creating ToolProviderGraph
 */
export interface ToolProviderGraphOptions {
  namespace: string
}

/**
 * Tool Provider Graph interface
 */
export interface ToolProviderGraph {
  // Thing CRUD
  create<T extends AnyThing>(input: CreateThingInput<T['data']>): Promise<T>
  get<T extends AnyThing>(id: string): Promise<T | null>
  update<T extends AnyThing>(id: string, input: UpdateThingInput<T['data']>): Promise<T | null>
  delete(id: string): Promise<boolean>

  // Relationship operations
  createRelationship(input: CreateRelationshipInput): Promise<ThingRelationship>
  getRelationshipsFrom(thingId: string, verb: string): Promise<ThingRelationship[]>
  getRelationshipsTo(thingId: string, verb: string): Promise<ThingRelationship[]>

  // Query operations
  findByType<T extends AnyThing>(type: string, filter?: QueryFilter): Promise<T[]>

  // Maintenance
  clear(): Promise<void>
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Internal mapping from Thing to GraphStorage node
 */
function thingToNode<T extends AnyThing>(thing: T): StoredNode {
  return {
    id: thing.$id,
    labels: [thing.$type],
    properties: thing.data as Record<string, unknown>,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

/**
 * Internal mapping from GraphStorage node to Thing
 */
function nodeToThing<T extends AnyThing>(node: StoredNode): T {
  return {
    $type: node.labels[0] || 'Unknown',
    $id: node.id,
    data: node.properties,
  } as T
}

/**
 * Internal mapping from GraphStorage relationship to ThingRelationship
 */
function storedRelToThingRel(rel: StoredRelationship): ThingRelationship {
  return {
    id: rel.id,
    verb: rel.type,
    from: rel.sourceId,
    to: rel.targetId,
    data: rel.properties,
    createdAt: rel.createdAt,
  }
}

/**
 * Create a ToolProviderGraph instance
 */
export function createToolProviderGraph(options: ToolProviderGraphOptions): ToolProviderGraph {
  const storage = createGraphStorage()
  const namespace = options.namespace

  // ID counter for generating unique IDs
  let idCounter = 0

  /**
   * Generate a unique Thing ID
   */
  function generateId(type: string): string {
    return `${namespace}:${type.toLowerCase()}:${++idCounter}`
  }

  return {
    /**
     * Create a new Thing
     */
    async create<T extends AnyThing>(input: CreateThingInput<T['data']>): Promise<T> {
      const id = generateId(input.$type)

      const node = await storage.createNode([input.$type], input.data as Record<string, unknown>)

      return {
        $type: input.$type,
        $id: node.id,
        data: node.properties,
      } as T
    },

    /**
     * Get a Thing by ID
     */
    async get<T extends AnyThing>(id: string): Promise<T | null> {
      const node = await storage.getNode(id)

      if (!node || node.properties._deleted) {
        return null
      }

      return nodeToThing<T>(node)
    },

    /**
     * Update a Thing
     */
    async update<T extends AnyThing>(id: string, input: UpdateThingInput<T['data']>): Promise<T | null> {
      const existing = await storage.getNode(id)

      if (!existing || existing.properties._deleted) {
        return null
      }

      const updated = await storage.updateNode(id, input.data as Record<string, unknown>)

      if (!updated) {
        return null
      }

      return nodeToThing<T>(updated)
    },

    /**
     * Delete a Thing
     */
    async delete(id: string): Promise<boolean> {
      return storage.deleteNode(id)
    },

    /**
     * Create a relationship between Things
     */
    async createRelationship(input: CreateRelationshipInput): Promise<ThingRelationship> {
      const rel = await storage.createRelationship(
        input.verb,
        input.from,
        input.to,
        input.data || {}
      )

      return storedRelToThingRel(rel)
    },

    /**
     * Get relationships from a Thing (outgoing)
     */
    async getRelationshipsFrom(thingId: string, verb: string): Promise<ThingRelationship[]> {
      const rels = await storage.findOutgoingRelationships(thingId, verb)
      return rels.map(storedRelToThingRel)
    },

    /**
     * Get relationships to a Thing (incoming)
     */
    async getRelationshipsTo(thingId: string, verb: string): Promise<ThingRelationship[]> {
      const rels = await storage.findIncomingRelationships(thingId, verb)
      return rels.map(storedRelToThingRel)
    },

    /**
     * Find Things by type with optional filtering
     */
    async findByType<T extends AnyThing>(type: string, filter?: QueryFilter): Promise<T[]> {
      let nodes: StoredNode[]

      if (filter?.where) {
        nodes = await storage.findNodesByLabelAndProperties(type, filter.where)
      } else {
        nodes = await storage.findNodesByLabel(type)
      }

      return nodes
        .filter((n) => !n.properties._deleted)
        .map((n) => nodeToThing<T>(n))
    },

    /**
     * Clear all data
     */
    async clear(): Promise<void> {
      await storage.clear()
      idCounter = 0
    },
  }
}

// ============================================================================
// Type exports for consumers
// ============================================================================

export type {
  HealthStatus,
  ProviderThingData,
  ToolThingData,
  CredentialThingData,
  BaseThing,
  AnyThing,
  ThingRelationship,
  CreateThingInput,
  CreateRelationshipInput,
  UpdateThingInput,
  QueryFilter,
  ToolProviderGraphOptions,
}
