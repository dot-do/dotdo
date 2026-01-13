/**
 * Worker Store - Graph-backed Worker CRUD Operations
 *
 * Provides a specialized interface for managing Workers as Things in the graph model.
 * Workers unify agents and humans under a common interface with capability-based
 * routing and tier-based escalation.
 *
 * @module workers/worker-store
 */

import { DocumentGraphStore } from '../db/graph/stores/document'
import type { GraphStore, GraphThing, GraphRelationship } from '../db/graph/types'

// ============================================================================
// Worker Types
// ============================================================================

/**
 * Worker kinds - either an AI agent or a human
 */
export type WorkerKind = 'agent' | 'human'

/**
 * Capability tiers for routing decisions
 * - code: Fast, deterministic operations
 * - generative: AI generation (text, images, etc.)
 * - agentic: Multi-step reasoning and tool use
 * - human: Oversight, judgment, approval
 */
export type WorkerTier = 'code' | 'generative' | 'agentic' | 'human'

/**
 * Worker status for availability tracking
 */
export type WorkerStatus = 'available' | 'busy' | 'offline'

/**
 * Worker data schema stored in Thing.data
 */
export interface WorkerData {
  kind: WorkerKind
  name: string
  capabilities: string[]
  tier: WorkerTier
  status?: WorkerStatus
  metadata?: Record<string, unknown>
}

/**
 * Worker as a Thing entity
 */
export interface WorkerThing {
  $id: string
  $type: 'Worker'
  name: string
  data: WorkerData
  deleted?: boolean
  createdAt?: number
  updatedAt?: number
}

/**
 * Input for creating a new Worker
 */
export interface CreateWorkerInput {
  $id?: string
  kind: WorkerKind
  name: string
  capabilities: string[]
  tier: WorkerTier
  status?: WorkerStatus
  metadata?: Record<string, unknown>
}

/**
 * Input for updating a Worker
 */
export interface UpdateWorkerInput {
  kind?: WorkerKind
  name?: string
  capabilities?: string[]
  tier?: WorkerTier
  status?: WorkerStatus
  metadata?: Record<string, unknown>
}

// ============================================================================
// Validation
// ============================================================================

const VALID_TIERS: WorkerTier[] = ['code', 'generative', 'agentic', 'human']
const VALID_KINDS: WorkerKind[] = ['agent', 'human']
const VALID_STATUSES: WorkerStatus[] = ['available', 'busy', 'offline']

/**
 * Validate worker data schema
 */
function validateWorkerData(data: unknown): data is WorkerData {
  if (typeof data !== 'object' || data === null) {
    return false
  }

  const d = data as Record<string, unknown>

  // Required: kind must be valid
  if (!d.kind || !VALID_KINDS.includes(d.kind as WorkerKind)) {
    throw new Error(`Invalid worker kind: ${d.kind}. Must be one of: ${VALID_KINDS.join(', ')}`)
  }

  // Required: name must be a string
  if (typeof d.name !== 'string') {
    throw new Error('Worker name must be a string')
  }

  // Required: capabilities must be an array
  if (!Array.isArray(d.capabilities)) {
    throw new Error('Worker capabilities must be an array')
  }

  // Required: tier must be valid
  if (!d.tier || !VALID_TIERS.includes(d.tier as WorkerTier)) {
    throw new Error(`Invalid worker tier: ${d.tier}. Must be one of: ${VALID_TIERS.join(', ')}`)
  }

  // Optional: status must be valid if provided
  if (d.status !== undefined && !VALID_STATUSES.includes(d.status as WorkerStatus)) {
    throw new Error(`Invalid worker status: ${d.status}. Must be one of: ${VALID_STATUSES.join(', ')}`)
  }

  return true
}

// ============================================================================
// WorkerStore Interface
// ============================================================================

/**
 * WorkerStore provides specialized methods for managing Workers in the graph.
 */
export interface WorkerStore {
  /**
   * Create a new Worker.
   */
  createWorker(input: CreateWorkerInput): Promise<WorkerThing>

  /**
   * Get a Worker by ID.
   */
  getWorker(id: string): Promise<WorkerThing | null>

  /**
   * List all Workers with optional filtering.
   */
  listWorkers(options?: { type?: string; includeDeleted?: boolean }): Promise<WorkerThing[]>

  /**
   * Update a Worker.
   */
  updateWorker(id: string, updates: UpdateWorkerInput): Promise<WorkerThing>

  /**
   * Delete a Worker (soft delete).
   */
  deleteWorker(id: string): Promise<WorkerThing>

  /**
   * Find Workers by capabilities.
   * Returns workers that have ALL specified capabilities.
   */
  findByCapabilities(capabilities: string[]): Promise<WorkerThing[]>

  /**
   * Find Workers by tier.
   */
  findByTier(tier: WorkerTier): Promise<WorkerThing[]>

  /**
   * Find available Workers.
   */
  findAvailable(): Promise<WorkerThing[]>

  /**
   * Find Workers by kind (agent or human).
   */
  findByKind(kind: WorkerKind): Promise<WorkerThing[]>

  /**
   * Create a relationship between workers.
   */
  createRelationship(input: {
    verb: string
    from: string
    to: string
    data?: Record<string, unknown>
  }): Promise<GraphRelationship>

  /**
   * Query relationships from a worker.
   */
  queryRelationshipsFrom(workerId: string, verb?: string): Promise<GraphRelationship[]>

  /**
   * Query relationships to a worker.
   */
  queryRelationshipsTo(workerId: string, verb?: string): Promise<GraphRelationship[]>
}

// ============================================================================
// WorkerStore Implementation
// ============================================================================

/**
 * GraphWorkerStore implements WorkerStore using the graph model.
 */
export class GraphWorkerStore implements WorkerStore {
  private store: GraphStore
  private ns: string
  private typeId = 1 // Fixed type ID for Worker
  private idCounter = 0

  constructor(store: GraphStore, ns: string = 'https://workers.do') {
    this.store = store
    this.ns = ns
  }

  private generateId(): string {
    return `worker-${Date.now()}-${this.idCounter++}`
  }

  private thingToWorker(thing: GraphThing): WorkerThing {
    const data = thing.data as WorkerData
    return {
      $id: thing.id,
      $type: 'Worker',
      name: data.name,
      data,
      deleted: thing.deletedAt !== null,
      createdAt: thing.createdAt,
      updatedAt: thing.updatedAt,
    }
  }

  async createWorker(input: CreateWorkerInput): Promise<WorkerThing> {
    const workerData: WorkerData = {
      kind: input.kind,
      name: input.name,
      capabilities: input.capabilities,
      tier: input.tier,
      status: input.status ?? 'available',
      metadata: input.metadata,
    }

    // Validate the data
    validateWorkerData(workerData)

    const id = input.$id ?? this.generateId()

    const thing = await this.store.createThing({
      id,
      typeId: this.typeId,
      typeName: 'Worker',
      data: workerData,
    })

    return this.thingToWorker(thing)
  }

  async getWorker(id: string): Promise<WorkerThing | null> {
    const thing = await this.store.getThing(id)
    if (!thing || thing.deletedAt !== null) {
      return null
    }
    return this.thingToWorker(thing)
  }

  async listWorkers(options?: { type?: string; includeDeleted?: boolean }): Promise<WorkerThing[]> {
    const things = await this.store.getThingsByType({
      typeName: 'Worker',
      includeDeleted: options?.includeDeleted ?? false,
    })

    return things.map((thing) => this.thingToWorker(thing))
  }

  async updateWorker(id: string, updates: UpdateWorkerInput): Promise<WorkerThing> {
    const existing = await this.store.getThing(id)
    if (!existing) {
      throw new Error(`Worker not found: ${id}`)
    }

    const existingData = existing.data as WorkerData
    const newData: WorkerData = {
      ...existingData,
      ...updates,
    }

    // Validate the updated data
    validateWorkerData(newData)

    const updated = await this.store.updateThing(id, { data: newData })
    if (!updated) {
      throw new Error(`Failed to update worker: ${id}`)
    }

    return this.thingToWorker(updated)
  }

  async deleteWorker(id: string): Promise<WorkerThing> {
    const deleted = await this.store.deleteThing(id)
    if (!deleted) {
      throw new Error(`Worker not found: ${id}`)
    }

    return this.thingToWorker(deleted)
  }

  async findByCapabilities(capabilities: string[]): Promise<WorkerThing[]> {
    const workers = await this.listWorkers()
    return workers.filter((worker) => {
      const workerCaps = worker.data.capabilities
      return capabilities.every((cap) => workerCaps.includes(cap))
    })
  }

  async findByTier(tier: WorkerTier): Promise<WorkerThing[]> {
    const workers = await this.listWorkers()
    return workers.filter((worker) => worker.data.tier === tier)
  }

  async findAvailable(): Promise<WorkerThing[]> {
    const workers = await this.listWorkers()
    return workers.filter((worker) => worker.data.status === 'available')
  }

  async findByKind(kind: WorkerKind): Promise<WorkerThing[]> {
    const workers = await this.listWorkers()
    return workers.filter((worker) => worker.data.kind === kind)
  }

  async createRelationship(input: {
    verb: string
    from: string
    to: string
    data?: Record<string, unknown>
  }): Promise<GraphRelationship> {
    const id = `rel-${Date.now()}-${this.idCounter++}`
    return this.store.createRelationship({
      id,
      verb: input.verb,
      from: input.from,
      to: input.to,
      data: input.data,
    })
  }

  async queryRelationshipsFrom(workerId: string, verb?: string): Promise<GraphRelationship[]> {
    return this.store.queryRelationshipsFrom(workerId, verb ? { verb } : undefined)
  }

  async queryRelationshipsTo(workerId: string, verb?: string): Promise<GraphRelationship[]> {
    return this.store.queryRelationshipsTo(workerId, verb ? { verb } : undefined)
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * StoreContext for creating WorkerStore
 */
export interface StoreContext {
  db: GraphStore
  ns: string
  currentBranch: string
  env: Record<string, unknown>
  typeCache: Map<string, unknown>
}

/**
 * Create a WorkerStore from a StoreContext.
 *
 * @param ctx - Store context with database connection
 * @returns A WorkerStore instance
 */
export function createWorkerStore(ctx: StoreContext): WorkerStore {
  return new GraphWorkerStore(ctx.db, ctx.ns)
}

// ============================================================================
// Convenience Classes for Tests
// ============================================================================

/**
 * ThingsStore - Wrapper for graph Things operations with Worker-like interface.
 * Used for TDD compatibility with the test file.
 */
export class ThingsStore {
  private store: GraphStore
  private ns: string
  private idCounter = 0

  constructor(ctx: { db: GraphStore; ns: string }) {
    this.store = ctx.db
    this.ns = ctx.ns
  }

  private generateId(): string {
    return `thing-${Date.now()}-${this.idCounter++}`
  }

  async create(input: {
    $type: string
    $id?: string
    name: string
    data: Record<string, unknown>
  }): Promise<{
    $id: string
    $type: string
    name: string
    data: Record<string, unknown>
    deleted?: boolean
  }> {
    // Validate Worker data if type is Worker
    if (input.$type === 'Worker') {
      validateWorkerData(input.data)
    }

    const id = input.$id ?? this.generateId()
    const thing = await this.store.createThing({
      id,
      typeId: 1,
      typeName: input.$type,
      data: { ...input.data, name: input.name },
    })

    return {
      $id: thing.id,
      $type: thing.typeName,
      name: input.name,
      data: thing.data as Record<string, unknown>,
    }
  }

  async get(
    id: string,
    options?: { includeDeleted?: boolean }
  ): Promise<{
    $id: string
    $type: string
    name: string
    data: Record<string, unknown>
    deleted?: boolean
  } | null> {
    const thing = await this.store.getThing(id)
    if (!thing) return null
    if (!options?.includeDeleted && thing.deletedAt !== null) return null

    const data = thing.data as Record<string, unknown>
    return {
      $id: thing.id,
      $type: thing.typeName,
      name: (data.name as string) ?? '',
      data,
      deleted: thing.deletedAt !== null,
    }
  }

  async list(options?: { type?: string }): Promise<
    Array<{
      $id: string
      $type: string
      name: string
      data: Record<string, unknown>
      deleted?: boolean
    }>
  > {
    const things = await this.store.getThingsByType({
      typeName: options?.type,
      includeDeleted: false,
    })

    return things.map((thing) => {
      const data = thing.data as Record<string, unknown>
      return {
        $id: thing.id,
        $type: thing.typeName,
        name: (data.name as string) ?? '',
        data,
        deleted: thing.deletedAt !== null,
      }
    })
  }

  async update(
    id: string,
    updates: { data?: Record<string, unknown> }
  ): Promise<{
    $id: string
    $type: string
    name: string
    data: Record<string, unknown>
  }> {
    const existing = await this.store.getThing(id)
    if (!existing) {
      throw new Error(`Thing not found: ${id}`)
    }

    // Validate if Worker
    if (existing.typeName === 'Worker' && updates.data) {
      validateWorkerData(updates.data)
    }

    const updated = await this.store.updateThing(id, { data: updates.data })
    if (!updated) {
      throw new Error(`Failed to update thing: ${id}`)
    }

    const data = updated.data as Record<string, unknown>
    return {
      $id: updated.id,
      $type: updated.typeName,
      name: (data.name as string) ?? '',
      data,
    }
  }

  async delete(id: string): Promise<{
    $id: string
    $type: string
    deleted: boolean
  }> {
    const deleted = await this.store.deleteThing(id)
    if (!deleted) {
      throw new Error(`Thing not found: ${id}`)
    }

    return {
      $id: deleted.id,
      $type: deleted.typeName,
      deleted: true,
    }
  }
}

/**
 * RelationshipsStore - Wrapper for graph Relationships operations.
 * Used for TDD compatibility with the test file.
 */
export class RelationshipsStore {
  private store: GraphStore
  private idCounter = 0

  constructor(ctx: { db: GraphStore }) {
    this.store = ctx.db
  }

  private generateId(): string {
    return `rel-${Date.now()}-${this.idCounter++}`
  }

  async create(input: {
    verb: string
    from: string
    to: string
    data?: Record<string, unknown>
  }): Promise<GraphRelationship> {
    const id = this.generateId()
    return this.store.createRelationship({
      id,
      verb: input.verb,
      from: input.from,
      to: input.to,
      data: input.data,
    })
  }

  async list(options?: { from?: string; to?: string; verb?: string }): Promise<GraphRelationship[]> {
    if (options?.from) {
      return this.store.queryRelationshipsFrom(options.from, options.verb ? { verb: options.verb } : undefined)
    }
    if (options?.to) {
      return this.store.queryRelationshipsTo(options.to, options.verb ? { verb: options.verb } : undefined)
    }
    if (options?.verb) {
      return this.store.queryRelationshipsByVerb(options.verb)
    }
    // Return all relationships - query by common verbs
    return []
  }
}
