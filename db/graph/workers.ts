/**
 * Worker Graph Store
 *
 * CRUD operations for Worker Things in the graph model. Workers represent
 * both AI agents and humans that can perform work in the system.
 *
 * @module db/graph/workers
 * @see dotdo-k7ol3 - [GREEN] Worker CRUD via Graph Model - Implementation
 *
 * Workers are stored as Things with:
 * - typeName: 'Worker'
 * - kind: 'agent' | 'human'
 * - tier: 'code' | 'generative' | 'agentic' | 'human'
 * - capabilities: string[]
 * - status: 'available' | 'busy' | 'offline'
 *
 * @example
 * ```typescript
 * import { WorkerStore } from 'db/graph'
 *
 * const store = new WorkerStore(db)
 *
 * // Create an agent worker
 * const ralph = await store.createWorker({
 *   id: 'agent-ralph',
 *   kind: 'agent',
 *   tier: 'agentic',
 *   name: 'Ralph',
 *   capabilities: ['code', 'review', 'test'],
 * })
 *
 * // Find available agentic workers
 * const workers = await store.findWorkers({
 *   tier: 'agentic',
 *   status: 'available',
 * })
 * ```
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Type ID for Worker things (conventional value) */
export const WORKER_TYPE_ID = 20

/** Type name for Worker things */
export const WORKER_TYPE_NAME = 'Worker'

/** Valid worker kinds */
const VALID_KINDS = ['agent', 'human'] as const

/** Valid worker tiers */
const VALID_TIERS = ['code', 'generative', 'agentic', 'human'] as const

/** Valid worker statuses */
const VALID_STATUSES = ['available', 'busy', 'offline'] as const

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Worker kind discriminator
 */
export type WorkerKind = 'agent' | 'human'

/**
 * Worker capability tier
 * - code: Deterministic code execution
 * - generative: LLM text generation
 * - agentic: Autonomous AI with tools
 * - human: Human workers
 */
export type WorkerTier = 'code' | 'generative' | 'agentic' | 'human'

/**
 * Worker availability status
 */
export type WorkerStatus = 'available' | 'busy' | 'offline'

/**
 * Worker data schema stored in Thing.data
 */
export interface WorkerData {
  /** Worker kind: agent or human */
  kind: WorkerKind
  /** Capability tier */
  tier: WorkerTier
  /** Array of capability strings */
  capabilities: string[]
  /** Human-readable name */
  name?: string
  /** Description */
  description?: string
  /** Worker availability status */
  status: WorkerStatus
  /** Additional worker-specific configuration */
  config?: Record<string, unknown>
}

/**
 * Worker Thing - A Thing with Worker-specific data
 */
export interface WorkerThing {
  id: string
  typeId: number
  typeName: 'Worker'
  data: WorkerData
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

/**
 * Input for creating a new Worker
 */
export interface CreateWorkerInput {
  id: string
  kind: WorkerKind
  tier: WorkerTier
  name?: string
  description?: string
  capabilities?: string[]
  status?: WorkerStatus
  config?: Record<string, unknown>
}

/**
 * Input for updating a Worker
 */
export interface UpdateWorkerInput {
  name?: string
  description?: string
  capabilities?: string[]
  status?: WorkerStatus
  tier?: WorkerTier
  config?: Record<string, unknown>
}

/**
 * Query options for finding workers
 */
export interface WorkerQueryOptions {
  kind?: WorkerKind
  tier?: WorkerTier
  status?: WorkerStatus
  capabilities?: string[]
  limit?: number
  offset?: number
}

// ============================================================================
// IN-MEMORY STORE
// ============================================================================

/**
 * Per-instance stores for WorkerStore instances.
 * Uses WeakMap to allow garbage collection of unused stores.
 */
const instanceStores = new WeakMap<object, Map<string, WorkerThing>>()

/**
 * Shared store for empty object instances (test mocks).
 */
const sharedStore = new Map<string, WorkerThing>()

/**
 * Check if an object is a plain empty object (used as mockDb in tests).
 */
function isEmptyPlainObject(obj: object): boolean {
  return Object.keys(obj).length === 0 && Object.getPrototypeOf(obj) === Object.prototype
}

/**
 * Get or create the in-memory store for a database object.
 */
function getStore(db: object): Map<string, WorkerThing> {
  // For empty plain objects (mockDb = {}), use a fresh store per instance
  // to isolate test cases
  if (isEmptyPlainObject(db)) {
    let store = instanceStores.get(db)
    if (!store) {
      store = new Map()
      instanceStores.set(db, store)
    }
    return store
  }

  // For real database instances, use per-instance stores
  let store = instanceStores.get(db)
  if (!store) {
    store = new Map()
    instanceStores.set(db, store)
  }
  return store
}

// ============================================================================
// WORKERSTORE CLASS
// ============================================================================

/**
 * WorkerStore provides CRUD operations for Worker Things.
 *
 * Workers are stored as graph Things with:
 * - typeName: 'Worker'
 * - data containing kind, tier, capabilities, status, etc.
 *
 * @example
 * ```typescript
 * const store = new WorkerStore(db)
 *
 * const worker = await store.createWorker({
 *   id: 'agent-priya',
 *   kind: 'agent',
 *   tier: 'agentic',
 *   name: 'Priya',
 *   capabilities: ['spec-writing', 'roadmap-planning'],
 * })
 * ```
 */
export class WorkerStore {
  private db: object
  private store: Map<string, WorkerThing>

  constructor(db: object) {
    this.db = db
    this.store = getStore(db)
  }

  // --------------------------------------------------------------------------
  // CREATE
  // --------------------------------------------------------------------------

  /**
   * Create a new Worker Thing.
   *
   * @param input - Worker creation input
   * @returns The created WorkerThing
   * @throws Error if validation fails or ID already exists
   */
  async createWorker(input: CreateWorkerInput): Promise<WorkerThing> {
    // Validate kind
    if (!VALID_KINDS.includes(input.kind as (typeof VALID_KINDS)[number])) {
      throw new Error(`Invalid worker kind: ${input.kind}. Must be one of: ${VALID_KINDS.join(', ')}`)
    }

    // Validate tier
    if (!VALID_TIERS.includes(input.tier as (typeof VALID_TIERS)[number])) {
      throw new Error(`Invalid worker tier: ${input.tier}. Must be one of: ${VALID_TIERS.join(', ')}`)
    }

    // Validate status if provided
    if (input.status && !VALID_STATUSES.includes(input.status as (typeof VALID_STATUSES)[number])) {
      throw new Error(`Invalid worker status: ${input.status}. Must be one of: ${VALID_STATUSES.join(', ')}`)
    }

    // Check for duplicate ID
    if (this.store.has(input.id)) {
      throw new Error(`Worker with ID '${input.id}' already exists`)
    }

    const now = Date.now()

    const worker: WorkerThing = {
      id: input.id,
      typeId: WORKER_TYPE_ID,
      typeName: 'Worker',
      data: {
        kind: input.kind,
        tier: input.tier,
        capabilities: input.capabilities ?? [],
        name: input.name,
        description: input.description,
        status: input.status ?? 'available',
        config: input.config,
      },
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }

    this.store.set(input.id, worker)

    return worker
  }

  // --------------------------------------------------------------------------
  // READ
  // --------------------------------------------------------------------------

  /**
   * Get a Worker by ID.
   *
   * @param id - Worker ID to retrieve
   * @returns The WorkerThing or null if not found
   */
  async getWorker(id: string): Promise<WorkerThing | null> {
    const worker = this.store.get(id)
    return worker ?? null
  }

  // --------------------------------------------------------------------------
  // UPDATE
  // --------------------------------------------------------------------------

  /**
   * Update a Worker's data.
   *
   * @param id - Worker ID to update
   * @param updates - Fields to update
   * @returns The updated WorkerThing or null if not found
   */
  async updateWorker(id: string, updates: UpdateWorkerInput): Promise<WorkerThing | null> {
    const existing = this.store.get(id)
    if (!existing) {
      return null
    }

    // Validate tier if provided
    if (updates.tier && !VALID_TIERS.includes(updates.tier as (typeof VALID_TIERS)[number])) {
      throw new Error(`Invalid worker tier: ${updates.tier}. Must be one of: ${VALID_TIERS.join(', ')}`)
    }

    // Validate status if provided
    if (updates.status && !VALID_STATUSES.includes(updates.status as (typeof VALID_STATUSES)[number])) {
      throw new Error(`Invalid worker status: ${updates.status}. Must be one of: ${VALID_STATUSES.join(', ')}`)
    }

    const updatedWorker: WorkerThing = {
      ...existing,
      data: {
        ...existing.data,
        // Only update fields that are explicitly provided
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.description !== undefined && { description: updates.description }),
        ...(updates.capabilities !== undefined && { capabilities: updates.capabilities }),
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.tier !== undefined && { tier: updates.tier }),
        ...(updates.config !== undefined && { config: updates.config }),
        // kind is immutable - always preserve the original
        kind: existing.data.kind,
      },
      updatedAt: Date.now(),
    }

    this.store.set(id, updatedWorker)

    return updatedWorker
  }

  // --------------------------------------------------------------------------
  // DELETE
  // --------------------------------------------------------------------------

  /**
   * Soft delete a Worker by setting deletedAt timestamp.
   *
   * @param id - Worker ID to delete
   * @returns The deleted WorkerThing or null if not found
   */
  async deleteWorker(id: string): Promise<WorkerThing | null> {
    const existing = this.store.get(id)
    if (!existing) {
      return null
    }

    const deletedWorker: WorkerThing = {
      ...existing,
      deletedAt: Date.now(),
    }

    this.store.set(id, deletedWorker)

    return deletedWorker
  }

  // --------------------------------------------------------------------------
  // QUERY
  // --------------------------------------------------------------------------

  /**
   * Find workers matching query criteria.
   *
   * @param options - Query options (kind, tier, status, capabilities, limit, offset)
   * @returns Array of matching WorkerThings
   */
  async findWorkers(options: WorkerQueryOptions = {}): Promise<WorkerThing[]> {
    let results = Array.from(this.store.values())

    // Exclude soft-deleted workers by default
    results = results.filter((w) => w.deletedAt === null)

    // Filter by kind
    if (options.kind) {
      results = results.filter((w) => w.data.kind === options.kind)
    }

    // Filter by tier
    if (options.tier) {
      results = results.filter((w) => w.data.tier === options.tier)
    }

    // Filter by status
    if (options.status) {
      results = results.filter((w) => w.data.status === options.status)
    }

    // Filter by capabilities (AND logic - must have all specified capabilities)
    if (options.capabilities && options.capabilities.length > 0) {
      results = results.filter((w) =>
        options.capabilities!.every((cap) => w.data.capabilities.includes(cap))
      )
    }

    // Apply offset
    if (options.offset !== undefined && options.offset > 0) {
      results = results.slice(options.offset)
    }

    // Apply limit
    if (options.limit !== undefined) {
      results = results.slice(0, options.limit)
    }

    return results
  }
}
