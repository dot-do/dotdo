/**
 * Graph-backed Experiment Store
 *
 * Persists A/B experiment data using the graph model (Things and Relationships).
 * This enables:
 * - Durable experiment definitions stored as Things
 * - Assignment tracking via Relationships (User -> assigned_to -> Experiment)
 * - Conversion tracking via Relationships (User -> converted -> ExperimentGoal)
 * - Integration with existing graph analytics and querying
 *
 * Thing Types:
 * - Experiment: The experiment definition (variants, goals, status)
 * - ExperimentAssignment: User assignment to a variant
 * - ExperimentConversion: Conversion event for a goal
 *
 * Relationships:
 * - User -[assigned_to]-> Experiment (with variant in data)
 * - User -[converted]-> ExperimentGoal (with value in data)
 * - ExperimentGoal -[belongs_to]-> Experiment
 *
 * @module db/primitives/feature-flags/experiment-graph-store
 */

import type { GraphStore, GraphThing, CreateRelationshipInput } from '../../graph/types'
import type {
  ExperimentStore,
  ExperimentDefinition,
  CreateExperimentOptions,
  ExperimentFilters,
  AllocationResult,
  ExperimentStatus,
  ExperimentVariant,
  ExperimentGoal,
} from './experiment'
import { createPercentageBucketing, type WeightedVariant } from './percentage-bucketing'

// =============================================================================
// CONSTANTS
// =============================================================================

/** Type ID for Experiment Things */
export const EXPERIMENT_TYPE_ID = 500
export const EXPERIMENT_TYPE_NAME = 'Experiment'

/** Type ID for ExperimentAssignment Things */
export const EXPERIMENT_ASSIGNMENT_TYPE_ID = 501
export const EXPERIMENT_ASSIGNMENT_TYPE_NAME = 'ExperimentAssignment'

/** Type ID for ExperimentConversion Things */
export const EXPERIMENT_CONVERSION_TYPE_ID = 502
export const EXPERIMENT_CONVERSION_TYPE_NAME = 'ExperimentConversion'

/** Type ID for ExperimentGoal Things */
export const EXPERIMENT_GOAL_TYPE_ID = 503
export const EXPERIMENT_GOAL_TYPE_NAME = 'ExperimentGoal'

/** Relationship verbs */
export const VERB_ASSIGNED_TO = 'assigned_to'
export const VERB_CONVERTED = 'converted'
export const VERB_HAS_GOAL = 'has_goal'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Data stored in Experiment Thing
 */
export interface ExperimentThingData {
  name: string
  description?: string
  flagKey?: string
  status: ExperimentStatus
  trafficAllocation: number
  variants: ExperimentVariant[]
  goals: ExperimentGoal[]
  targetingRules?: string[]
  hypothesis?: string
  owner?: string
  tags?: string[]
  startedAt?: number
  endedAt?: number
  winner?: string
  minSampleSize?: number
  significanceThreshold?: number
}

/**
 * Data stored in ExperimentAssignment Thing
 */
export interface AssignmentThingData {
  experimentId: string
  userId: string
  variant: string
  bucket?: number
  context?: Record<string, unknown>
}

/**
 * Data stored in ExperimentConversion Thing
 */
export interface ConversionThingData {
  experimentId: string
  goalId: string
  userId: string
  variant: string
  eventName: string
  value?: number
  timeSinceAssignment?: number
  properties?: Record<string, unknown>
}

/**
 * Data stored in ExperimentGoal Thing
 */
export interface GoalThingData {
  experimentId: string
  goalId: string
  name: string
  eventName: string
  type: string
  aggregation: string
  isPrimary?: boolean
  valueProperty?: string
  percentile?: number
}

/**
 * Options for graph-backed experiment store
 */
export interface GraphExperimentStoreOptions {
  /** Number of buckets for percentage allocation */
  bucketCount?: number
  /** Default significance threshold */
  defaultSignificanceThreshold?: number
  /** Default minimum sample size */
  defaultMinSampleSize?: number
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Graph-backed experiment store implementation
 *
 * Persists experiment data as Things in the graph database, enabling:
 * - Durable persistence across restarts
 * - Integration with graph queries and analytics
 * - Relationship-based tracking of assignments and conversions
 */
export class GraphExperimentStore implements ExperimentStore {
  private graphStore: GraphStore
  private bucketing = createPercentageBucketing()
  private options: Required<GraphExperimentStoreOptions>

  constructor(graphStore: GraphStore, options: GraphExperimentStoreOptions = {}) {
    this.graphStore = graphStore
    this.options = {
      bucketCount: options.bucketCount ?? 10000,
      defaultSignificanceThreshold: options.defaultSignificanceThreshold ?? 0.95,
      defaultMinSampleSize: options.defaultMinSampleSize ?? 100,
    }
  }

  // ===========================================================================
  // CRUD OPERATIONS
  // ===========================================================================

  async create(options: CreateExperimentOptions): Promise<ExperimentDefinition> {
    // Check if experiment already exists
    const existing = await this.get(options.id)
    if (existing) {
      throw new Error(`Experiment '${options.id}' already exists`)
    }

    if (options.variants.length < 2) {
      throw new Error('Experiment must have at least 2 variants')
    }

    if (options.goals.length === 0) {
      throw new Error('Experiment must have at least 1 goal')
    }

    // Ensure exactly one control variant
    const controlCount = options.variants.filter(v => v.isControl).length
    if (controlCount === 0) {
      options.variants[0].isControl = true
    } else if (controlCount > 1) {
      throw new Error('Experiment can only have one control variant')
    }

    // Calculate weights if not provided (equal distribution)
    const hasWeights = options.variants.some(v => v.weight !== undefined)
    const defaultWeight = 100 / options.variants.length

    const now = new Date()
    const nowMs = now.getTime()

    // Build experiment data
    const data: ExperimentThingData = {
      name: options.name,
      description: options.description,
      flagKey: options.flagKey,
      status: 'draft',
      trafficAllocation: options.trafficAllocation ?? 100,
      variants: options.variants.map(v => ({
        key: v.key,
        name: v.name,
        weight: v.weight ?? (hasWeights ? 0 : defaultWeight),
        description: v.description,
        payload: v.payload,
        isControl: v.isControl ?? false,
      })),
      goals: options.goals.map((g, i) => ({
        id: g.id,
        name: g.name,
        eventName: g.eventName,
        type: g.type ?? 'conversion',
        aggregation: g.aggregation ?? 'count',
        isPrimary: g.isPrimary ?? (i === 0),
        valueProperty: g.valueProperty,
        percentile: g.percentile,
      })),
      targetingRules: options.targetingRules,
      hypothesis: options.hypothesis,
      owner: options.owner,
      tags: options.tags,
      minSampleSize: options.minSampleSize ?? this.options.defaultMinSampleSize,
      significanceThreshold: options.significanceThreshold ?? this.options.defaultSignificanceThreshold,
    }

    // Ensure at least one primary goal
    const hasPrimary = data.goals.some(g => g.isPrimary)
    if (!hasPrimary && data.goals.length > 0) {
      data.goals[0].isPrimary = true
    }

    // Create Experiment Thing
    await this.graphStore.createThing({
      id: `experiment:${options.id}`,
      typeId: EXPERIMENT_TYPE_ID,
      typeName: EXPERIMENT_TYPE_NAME,
      data,
    })

    // Create Goal Things and relationships
    for (const goal of data.goals) {
      const goalId = `experiment-goal:${options.id}:${goal.id}`
      const goalData: GoalThingData = {
        experimentId: options.id,
        goalId: goal.id,
        name: goal.name,
        eventName: goal.eventName,
        type: goal.type,
        aggregation: goal.aggregation,
        isPrimary: goal.isPrimary,
        valueProperty: goal.valueProperty,
        percentile: goal.percentile,
      }

      await this.graphStore.createThing({
        id: goalId,
        typeId: EXPERIMENT_GOAL_TYPE_ID,
        typeName: EXPERIMENT_GOAL_TYPE_NAME,
        data: goalData,
      })

      // Create relationship: Goal -> belongs_to -> Experiment
      await this.graphStore.createRelationship({
        id: `rel:${goalId}:${VERB_HAS_GOAL}:experiment:${options.id}`,
        verb: VERB_HAS_GOAL,
        from: `experiment:${options.id}`,
        to: goalId,
      })
    }

    return this.thingToExperiment(
      await this.graphStore.getThing(`experiment:${options.id}`) as GraphThing,
      now,
      now
    )
  }

  async get(id: string): Promise<ExperimentDefinition | null> {
    const thing = await this.graphStore.getThing(`experiment:${id}`)
    if (!thing) {
      return null
    }
    return this.thingToExperiment(thing)
  }

  async list(filters?: ExperimentFilters): Promise<ExperimentDefinition[]> {
    const things = await this.graphStore.getThingsByType({
      typeId: EXPERIMENT_TYPE_ID,
      limit: filters?.limit ?? 100,
      offset: filters?.offset ?? 0,
    })

    let experiments = await Promise.all(
      things.map(t => this.thingToExperiment(t))
    )

    // Apply filters
    if (filters?.status) {
      experiments = experiments.filter(e => e.status === filters.status)
    }

    if (filters?.owner) {
      experiments = experiments.filter(e => e.owner === filters.owner)
    }

    if (filters?.tags && filters.tags.length > 0) {
      experiments = experiments.filter(e => e.tags?.some(t => filters.tags!.includes(t)))
    }

    if (filters?.flagKey) {
      experiments = experiments.filter(e => e.flagKey === filters.flagKey)
    }

    if (!filters?.includeCompleted) {
      experiments = experiments.filter(e => e.status !== 'completed')
    }

    // Sort by creation date (newest first)
    experiments.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    return experiments
  }

  async update(id: string, updates: Partial<ExperimentDefinition>): Promise<ExperimentDefinition> {
    const thing = await this.graphStore.getThing(`experiment:${id}`)
    if (!thing) {
      throw new Error(`Experiment '${id}' not found`)
    }

    const current = thing.data as ExperimentThingData

    // Prevent updates to running experiments except for certain fields
    if (current.status === 'running') {
      const allowedFields = ['name', 'description', 'tags', 'owner']
      const updateKeys = Object.keys(updates)
      const invalidUpdates = updateKeys.filter(k => !allowedFields.includes(k))
      if (invalidUpdates.length > 0) {
        throw new Error(`Cannot update ${invalidUpdates.join(', ')} on a running experiment`)
      }
    }

    // Merge updates into data
    const newData: ExperimentThingData = {
      ...current,
      name: updates.name ?? current.name,
      description: updates.description ?? current.description,
      tags: updates.tags ?? current.tags,
      owner: updates.owner ?? current.owner,
    }

    await this.graphStore.updateThing(`experiment:${id}`, {
      data: newData,
    })

    return this.get(id) as Promise<ExperimentDefinition>
  }

  async start(id: string): Promise<ExperimentDefinition> {
    const thing = await this.graphStore.getThing(`experiment:${id}`)
    if (!thing) {
      throw new Error(`Experiment '${id}' not found`)
    }

    const data = thing.data as ExperimentThingData
    if (data.status !== 'draft' && data.status !== 'paused') {
      throw new Error(`Cannot start experiment with status '${data.status}'`)
    }

    const now = Date.now()
    await this.graphStore.updateThing(`experiment:${id}`, {
      data: {
        ...data,
        status: 'running' as ExperimentStatus,
        startedAt: data.startedAt ?? now,
      },
    })

    return this.get(id) as Promise<ExperimentDefinition>
  }

  async pause(id: string): Promise<ExperimentDefinition> {
    const thing = await this.graphStore.getThing(`experiment:${id}`)
    if (!thing) {
      throw new Error(`Experiment '${id}' not found`)
    }

    const data = thing.data as ExperimentThingData
    if (data.status !== 'running') {
      throw new Error(`Cannot pause experiment with status '${data.status}'`)
    }

    await this.graphStore.updateThing(`experiment:${id}`, {
      data: {
        ...data,
        status: 'paused' as ExperimentStatus,
      },
    })

    return this.get(id) as Promise<ExperimentDefinition>
  }

  async resume(id: string): Promise<ExperimentDefinition> {
    const thing = await this.graphStore.getThing(`experiment:${id}`)
    if (!thing) {
      throw new Error(`Experiment '${id}' not found`)
    }

    const data = thing.data as ExperimentThingData
    if (data.status !== 'paused') {
      throw new Error(`Cannot resume experiment with status '${data.status}'`)
    }

    await this.graphStore.updateThing(`experiment:${id}`, {
      data: {
        ...data,
        status: 'running' as ExperimentStatus,
      },
    })

    return this.get(id) as Promise<ExperimentDefinition>
  }

  async complete(id: string, winner?: string): Promise<ExperimentDefinition> {
    const thing = await this.graphStore.getThing(`experiment:${id}`)
    if (!thing) {
      throw new Error(`Experiment '${id}' not found`)
    }

    const data = thing.data as ExperimentThingData
    if (data.status === 'completed') {
      throw new Error('Experiment is already completed')
    }

    if (winner && !data.variants.some(v => v.key === winner)) {
      throw new Error(`Invalid winner variant: '${winner}'`)
    }

    const now = Date.now()
    await this.graphStore.updateThing(`experiment:${id}`, {
      data: {
        ...data,
        status: 'completed' as ExperimentStatus,
        winner,
        endedAt: now,
      },
    })

    return this.get(id) as Promise<ExperimentDefinition>
  }

  async delete(id: string): Promise<void> {
    const thing = await this.graphStore.getThing(`experiment:${id}`)
    if (!thing) {
      throw new Error(`Experiment '${id}' not found`)
    }

    // Delete associated goals
    const data = thing.data as ExperimentThingData
    for (const goal of data.goals) {
      const goalId = `experiment-goal:${id}:${goal.id}`
      await this.graphStore.deleteThing(goalId)
    }

    // Delete experiment
    await this.graphStore.deleteThing(`experiment:${id}`)
  }

  // ===========================================================================
  // ALLOCATION
  // ===========================================================================

  async allocate(experimentId: string, userId: string): Promise<AllocationResult> {
    const thing = await this.graphStore.getThing(`experiment:${experimentId}`)

    if (!thing) {
      return {
        experimentId,
        inExperiment: false,
        variant: null,
        reason: 'experiment_not_found',
      }
    }

    const data = thing.data as ExperimentThingData

    if (data.status !== 'running') {
      return {
        experimentId,
        inExperiment: false,
        variant: null,
        reason: 'experiment_not_running',
      }
    }

    // Check traffic allocation
    const inTraffic = this.bucketing.isInRollout(experimentId, userId, data.trafficAllocation)
    if (!inTraffic) {
      return {
        experimentId,
        inExperiment: false,
        variant: null,
        reason: 'not_in_traffic',
      }
    }

    // Allocate to variant using weighted distribution
    const weightedVariants: WeightedVariant<ExperimentVariant>[] = data.variants.map(v => ({
      value: v,
      weight: v.weight,
    }))

    const selectedVariant = this.bucketing.getVariant(experimentId, userId, weightedVariants)
    const bucket = this.bucketing.getBucket(experimentId, userId)

    return {
      experimentId,
      inExperiment: true,
      variant: selectedVariant.key,
      payload: selectedVariant.payload,
      bucket,
      reason: 'allocated',
    }
  }

  // ===========================================================================
  // ASSIGNMENT TRACKING (Graph-backed)
  // ===========================================================================

  /**
   * Track a user's assignment to an experiment variant as a Thing
   */
  async trackAssignment(
    experimentId: string,
    userId: string,
    variant: string,
    options?: {
      bucket?: number
      context?: Record<string, unknown>
    }
  ): Promise<GraphThing> {
    const assignmentId = `experiment-assignment:${experimentId}:${userId}`

    // Check if assignment already exists
    const existing = await this.graphStore.getThing(assignmentId)
    if (existing) {
      return existing
    }

    const data: AssignmentThingData = {
      experimentId,
      userId,
      variant,
      bucket: options?.bucket,
      context: options?.context,
    }

    const assignment = await this.graphStore.createThing({
      id: assignmentId,
      typeId: EXPERIMENT_ASSIGNMENT_TYPE_ID,
      typeName: EXPERIMENT_ASSIGNMENT_TYPE_NAME,
      data,
    })

    // Create relationship: User -> assigned_to -> Experiment
    await this.graphStore.createRelationship({
      id: `rel:user:${userId}:${VERB_ASSIGNED_TO}:experiment:${experimentId}`,
      verb: VERB_ASSIGNED_TO,
      from: `user:${userId}`,
      to: `experiment:${experimentId}`,
      data: { variant, bucket: options?.bucket },
    })

    return assignment
  }

  /**
   * Get a user's assignment for an experiment
   */
  async getAssignment(
    experimentId: string,
    userId: string
  ): Promise<AssignmentThingData | null> {
    const assignmentId = `experiment-assignment:${experimentId}:${userId}`
    const thing = await this.graphStore.getThing(assignmentId)
    if (!thing) {
      return null
    }
    return thing.data as AssignmentThingData
  }

  /**
   * Get assignment counts per variant for an experiment
   */
  async getAssignmentSummary(experimentId: string): Promise<{
    totalAssignments: number
    variantCounts: Record<string, number>
  }> {
    // Query all assignments for this experiment
    const rels = await this.graphStore.queryRelationshipsTo(`experiment:${experimentId}`, {
      verb: VERB_ASSIGNED_TO,
    })

    const variantCounts: Record<string, number> = {}
    for (const rel of rels) {
      const variant = (rel.data as { variant?: string })?.variant
      if (variant) {
        variantCounts[variant] = (variantCounts[variant] ?? 0) + 1
      }
    }

    return {
      totalAssignments: rels.length,
      variantCounts,
    }
  }

  // ===========================================================================
  // CONVERSION TRACKING (Graph-backed)
  // ===========================================================================

  /**
   * Track a conversion event as a Thing
   */
  async trackConversion(
    experimentId: string,
    goalId: string,
    userId: string,
    options?: {
      value?: number
      properties?: Record<string, unknown>
      deduplicationKey?: string
    }
  ): Promise<GraphThing | null> {
    // Get user's assignment
    const assignment = await this.getAssignment(experimentId, userId)
    if (!assignment) {
      return null
    }

    // Generate conversion ID (with optional deduplication)
    const conversionId = options?.deduplicationKey
      ? `experiment-conversion:${experimentId}:${goalId}:${options.deduplicationKey}`
      : `experiment-conversion:${experimentId}:${goalId}:${userId}:${Date.now()}`

    // Check for deduplication
    if (options?.deduplicationKey) {
      const existing = await this.graphStore.getThing(conversionId)
      if (existing) {
        return null // Deduplicated
      }
    }

    // Get goal info
    const goalThingId = `experiment-goal:${experimentId}:${goalId}`
    const goalThing = await this.graphStore.getThing(goalThingId)
    const goalData = goalThing?.data as GoalThingData | undefined

    // Calculate time since assignment
    const assignmentThing = await this.graphStore.getThing(
      `experiment-assignment:${experimentId}:${userId}`
    )
    const timeSinceAssignment = assignmentThing
      ? Date.now() - assignmentThing.createdAt
      : undefined

    const data: ConversionThingData = {
      experimentId,
      goalId,
      userId,
      variant: assignment.variant,
      eventName: goalData?.eventName ?? goalId,
      value: options?.value,
      timeSinceAssignment,
      properties: options?.properties,
    }

    const conversion = await this.graphStore.createThing({
      id: conversionId,
      typeId: EXPERIMENT_CONVERSION_TYPE_ID,
      typeName: EXPERIMENT_CONVERSION_TYPE_NAME,
      data,
    })

    // Create relationship: User -> converted -> ExperimentGoal
    await this.graphStore.createRelationship({
      id: `rel:${conversionId}`,
      verb: VERB_CONVERTED,
      from: `user:${userId}`,
      to: goalThingId,
      data: {
        variant: assignment.variant,
        value: options?.value,
        conversionId,
      },
    })

    return conversion
  }

  /**
   * Get conversion metrics for a goal
   */
  async getGoalConversions(
    experimentId: string,
    goalId: string
  ): Promise<{
    totalConversions: number
    uniqueUsers: number
    variantConversions: Record<string, { count: number; totalValue: number; users: Set<string> }>
  }> {
    const goalThingId = `experiment-goal:${experimentId}:${goalId}`

    // Query all conversions for this goal
    const rels = await this.graphStore.queryRelationshipsTo(goalThingId, {
      verb: VERB_CONVERTED,
    })

    const variantConversions: Record<string, { count: number; totalValue: number; users: Set<string> }> = {}
    const uniqueUsers = new Set<string>()

    for (const rel of rels) {
      const data = rel.data as { variant?: string; value?: number; conversionId?: string }
      const variant = data?.variant
      if (variant) {
        if (!variantConversions[variant]) {
          variantConversions[variant] = { count: 0, totalValue: 0, users: new Set() }
        }
        variantConversions[variant].count++
        variantConversions[variant].totalValue += data?.value ?? 0

        // Extract userId from relationship 'from' field
        const userId = rel.from.replace('user:', '')
        variantConversions[variant].users.add(userId)
        uniqueUsers.add(userId)
      }
    }

    return {
      totalConversions: rels.length,
      uniqueUsers: uniqueUsers.size,
      variantConversions,
    }
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private thingToExperiment(
    thing: GraphThing,
    createdAtOverride?: Date,
    updatedAtOverride?: Date
  ): ExperimentDefinition {
    const data = thing.data as ExperimentThingData
    const id = thing.id.replace('experiment:', '')

    return {
      id,
      name: data.name,
      description: data.description,
      flagKey: data.flagKey,
      status: data.status,
      trafficAllocation: data.trafficAllocation,
      variants: data.variants,
      goals: data.goals,
      targetingRules: data.targetingRules,
      hypothesis: data.hypothesis,
      owner: data.owner,
      tags: data.tags,
      createdAt: createdAtOverride ?? new Date(thing.createdAt),
      updatedAt: updatedAtOverride ?? new Date(thing.updatedAt),
      startedAt: data.startedAt ? new Date(data.startedAt) : undefined,
      endedAt: data.endedAt ? new Date(data.endedAt) : undefined,
      winner: data.winner,
      minSampleSize: data.minSampleSize,
      significanceThreshold: data.significanceThreshold,
    }
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a graph-backed experiment store
 */
export function createGraphExperimentStore(
  graphStore: GraphStore,
  options?: GraphExperimentStoreOptions
): GraphExperimentStore {
  return new GraphExperimentStore(graphStore, options)
}
