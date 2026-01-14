/**
 * A/B Experiment Tracking
 *
 * Provides experiment definition and management for A/B testing with:
 * - Experiment lifecycle management (draft -> running -> completed)
 * - Variant definition with weights and metadata
 * - Goal/metric configuration for success tracking
 * - Traffic allocation with consistent bucketing
 *
 * @module db/primitives/feature-flags/experiment
 */

import { createPercentageBucketing, type WeightedVariant } from './percentage-bucketing'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Experiment status lifecycle
 */
export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed'

/**
 * Metric type for measuring experiment success
 */
export type MetricType = 'conversion' | 'revenue' | 'engagement' | 'retention' | 'custom'

/**
 * Aggregation method for metric values
 */
export type MetricAggregation = 'count' | 'sum' | 'mean' | 'median' | 'percentile'

/**
 * A goal/metric definition for measuring experiment success
 */
export interface ExperimentGoal {
  /** Unique identifier for the goal */
  id: string
  /** Human-readable name */
  name: string
  /** Event name or pattern to track */
  eventName: string
  /** Type of metric */
  type: MetricType
  /** How to aggregate the metric */
  aggregation: MetricAggregation
  /** Whether this is the primary goal */
  isPrimary?: boolean
  /** Optional value property to extract from events */
  valueProperty?: string
  /** Optional percentile value (if aggregation is percentile) */
  percentile?: number
}

/**
 * A variant in an experiment
 */
export interface ExperimentVariant {
  /** Unique key for the variant */
  key: string
  /** Human-readable name */
  name: string
  /** Weight for traffic allocation (typically 0-100) */
  weight: number
  /** Optional description */
  description?: string
  /** Optional payload/configuration for this variant */
  payload?: Record<string, unknown>
  /** Whether this is the control variant */
  isControl?: boolean
}

/**
 * Experiment definition
 */
export interface ExperimentDefinition {
  /** Unique identifier */
  id: string
  /** Human-readable name */
  name: string
  /** Optional description */
  description?: string
  /** Associated feature flag key (optional) */
  flagKey?: string
  /** Experiment status */
  status: ExperimentStatus
  /** Traffic allocation percentage (0-100) */
  trafficAllocation: number
  /** Variants in the experiment */
  variants: ExperimentVariant[]
  /** Goals/metrics to track */
  goals: ExperimentGoal[]
  /** Targeting rules (user segments, etc.) */
  targetingRules?: string[]
  /** Hypothesis being tested */
  hypothesis?: string
  /** Owner email or identifier */
  owner?: string
  /** Tags for organization */
  tags?: string[]
  /** When the experiment was created */
  createdAt: Date
  /** When the experiment was last updated */
  updatedAt: Date
  /** When the experiment started running */
  startedAt?: Date
  /** When the experiment ended */
  endedAt?: Date
  /** Winning variant key (when completed) */
  winner?: string
  /** Minimum sample size per variant */
  minSampleSize?: number
  /** Statistical significance threshold (default 0.95) */
  significanceThreshold?: number
}

/**
 * Options for creating an experiment
 */
export interface CreateExperimentOptions {
  id: string
  name: string
  description?: string
  flagKey?: string
  trafficAllocation?: number
  variants: Array<{
    key: string
    name: string
    weight?: number
    description?: string
    payload?: Record<string, unknown>
    isControl?: boolean
  }>
  goals: Array<{
    id: string
    name: string
    eventName: string
    type?: MetricType
    aggregation?: MetricAggregation
    isPrimary?: boolean
    valueProperty?: string
    percentile?: number
  }>
  targetingRules?: string[]
  hypothesis?: string
  owner?: string
  tags?: string[]
  minSampleSize?: number
  significanceThreshold?: number
}

/**
 * Result of variant allocation for a user
 */
export interface AllocationResult {
  /** Experiment ID */
  experimentId: string
  /** Whether the user is in the experiment */
  inExperiment: boolean
  /** Assigned variant key (null if not in experiment) */
  variant: string | null
  /** Variant payload (if any) */
  payload?: Record<string, unknown>
  /** Bucket value used for assignment */
  bucket?: number
  /** Reason for allocation result */
  reason: 'allocated' | 'not_in_traffic' | 'experiment_not_running' | 'experiment_not_found'
}

/**
 * Experiment store interface
 */
export interface ExperimentStore {
  /** Create a new experiment */
  create(options: CreateExperimentOptions): Promise<ExperimentDefinition>
  /** Get an experiment by ID */
  get(id: string): Promise<ExperimentDefinition | null>
  /** List all experiments */
  list(filters?: ExperimentFilters): Promise<ExperimentDefinition[]>
  /** Update an experiment */
  update(id: string, updates: Partial<ExperimentDefinition>): Promise<ExperimentDefinition>
  /** Start an experiment */
  start(id: string): Promise<ExperimentDefinition>
  /** Pause an experiment */
  pause(id: string): Promise<ExperimentDefinition>
  /** Resume a paused experiment */
  resume(id: string): Promise<ExperimentDefinition>
  /** Complete an experiment with a winner */
  complete(id: string, winner?: string): Promise<ExperimentDefinition>
  /** Delete an experiment */
  delete(id: string): Promise<void>
  /** Allocate a user to a variant */
  allocate(experimentId: string, userId: string): Promise<AllocationResult>
}

/**
 * Filters for listing experiments
 */
export interface ExperimentFilters {
  /** Filter by status */
  status?: ExperimentStatus
  /** Filter by owner */
  owner?: string
  /** Filter by tags (matches any) */
  tags?: string[]
  /** Filter by flag key */
  flagKey?: string
  /** Include completed experiments */
  includeCompleted?: boolean
  /** Pagination limit */
  limit?: number
  /** Pagination offset */
  offset?: number
}

/**
 * Options for creating an experiment store
 */
export interface ExperimentStoreOptions {
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
 * In-memory experiment store implementation
 */
class InMemoryExperimentStore implements ExperimentStore {
  private experiments: Map<string, ExperimentDefinition> = new Map()
  private bucketing = createPercentageBucketing()
  private options: Required<ExperimentStoreOptions>

  constructor(options: ExperimentStoreOptions = {}) {
    this.options = {
      bucketCount: options.bucketCount ?? 10000,
      defaultSignificanceThreshold: options.defaultSignificanceThreshold ?? 0.95,
      defaultMinSampleSize: options.defaultMinSampleSize ?? 100,
    }
  }

  async create(options: CreateExperimentOptions): Promise<ExperimentDefinition> {
    if (this.experiments.has(options.id)) {
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
      // Mark first variant as control if none specified
      options.variants[0].isControl = true
    } else if (controlCount > 1) {
      throw new Error('Experiment can only have one control variant')
    }

    // Calculate weights if not provided (equal distribution)
    const hasWeights = options.variants.some(v => v.weight !== undefined)
    const defaultWeight = 100 / options.variants.length

    const now = new Date()
    const experiment: ExperimentDefinition = {
      id: options.id,
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
      goals: options.goals.map(g => ({
        id: g.id,
        name: g.name,
        eventName: g.eventName,
        type: g.type ?? 'conversion',
        aggregation: g.aggregation ?? 'count',
        isPrimary: g.isPrimary ?? false,
        valueProperty: g.valueProperty,
        percentile: g.percentile,
      })),
      targetingRules: options.targetingRules,
      hypothesis: options.hypothesis,
      owner: options.owner,
      tags: options.tags,
      createdAt: now,
      updatedAt: now,
      minSampleSize: options.minSampleSize ?? this.options.defaultMinSampleSize,
      significanceThreshold: options.significanceThreshold ?? this.options.defaultSignificanceThreshold,
    }

    // Ensure at least one primary goal
    const hasPrimary = experiment.goals.some(g => g.isPrimary)
    if (!hasPrimary && experiment.goals.length > 0) {
      experiment.goals[0].isPrimary = true
    }

    this.experiments.set(options.id, experiment)
    return { ...experiment }
  }

  async get(id: string): Promise<ExperimentDefinition | null> {
    const experiment = this.experiments.get(id)
    return experiment ? { ...experiment } : null
  }

  async list(filters?: ExperimentFilters): Promise<ExperimentDefinition[]> {
    let experiments = Array.from(this.experiments.values())

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

    // Pagination
    const offset = filters?.offset ?? 0
    const limit = filters?.limit ?? experiments.length
    experiments = experiments.slice(offset, offset + limit)

    return experiments.map(e => ({ ...e }))
  }

  async update(id: string, updates: Partial<ExperimentDefinition>): Promise<ExperimentDefinition> {
    const experiment = this.experiments.get(id)
    if (!experiment) {
      throw new Error(`Experiment '${id}' not found`)
    }

    // Prevent updates to running experiments except for certain fields
    if (experiment.status === 'running') {
      const allowedFields = ['name', 'description', 'tags', 'owner']
      const updateKeys = Object.keys(updates)
      const invalidUpdates = updateKeys.filter(k => !allowedFields.includes(k))
      if (invalidUpdates.length > 0) {
        throw new Error(`Cannot update ${invalidUpdates.join(', ')} on a running experiment`)
      }
    }

    const updated: ExperimentDefinition = {
      ...experiment,
      ...updates,
      id: experiment.id, // Prevent ID change
      createdAt: experiment.createdAt, // Prevent creation date change
      updatedAt: new Date(),
    }

    this.experiments.set(id, updated)
    return { ...updated }
  }

  async start(id: string): Promise<ExperimentDefinition> {
    const experiment = this.experiments.get(id)
    if (!experiment) {
      throw new Error(`Experiment '${id}' not found`)
    }

    if (experiment.status !== 'draft' && experiment.status !== 'paused') {
      throw new Error(`Cannot start experiment with status '${experiment.status}'`)
    }

    const now = new Date()
    const updated: ExperimentDefinition = {
      ...experiment,
      status: 'running',
      startedAt: experiment.startedAt ?? now,
      updatedAt: now,
    }

    this.experiments.set(id, updated)
    return { ...updated }
  }

  async pause(id: string): Promise<ExperimentDefinition> {
    const experiment = this.experiments.get(id)
    if (!experiment) {
      throw new Error(`Experiment '${id}' not found`)
    }

    if (experiment.status !== 'running') {
      throw new Error(`Cannot pause experiment with status '${experiment.status}'`)
    }

    const updated: ExperimentDefinition = {
      ...experiment,
      status: 'paused',
      updatedAt: new Date(),
    }

    this.experiments.set(id, updated)
    return { ...updated }
  }

  async resume(id: string): Promise<ExperimentDefinition> {
    const experiment = this.experiments.get(id)
    if (!experiment) {
      throw new Error(`Experiment '${id}' not found`)
    }

    if (experiment.status !== 'paused') {
      throw new Error(`Cannot resume experiment with status '${experiment.status}'`)
    }

    const updated: ExperimentDefinition = {
      ...experiment,
      status: 'running',
      updatedAt: new Date(),
    }

    this.experiments.set(id, updated)
    return { ...updated }
  }

  async complete(id: string, winner?: string): Promise<ExperimentDefinition> {
    const experiment = this.experiments.get(id)
    if (!experiment) {
      throw new Error(`Experiment '${id}' not found`)
    }

    if (experiment.status === 'completed') {
      throw new Error('Experiment is already completed')
    }

    if (winner && !experiment.variants.some(v => v.key === winner)) {
      throw new Error(`Invalid winner variant: '${winner}'`)
    }

    const now = new Date()
    const updated: ExperimentDefinition = {
      ...experiment,
      status: 'completed',
      winner,
      endedAt: now,
      updatedAt: now,
    }

    this.experiments.set(id, updated)
    return { ...updated }
  }

  async delete(id: string): Promise<void> {
    if (!this.experiments.has(id)) {
      throw new Error(`Experiment '${id}' not found`)
    }
    this.experiments.delete(id)
  }

  async allocate(experimentId: string, userId: string): Promise<AllocationResult> {
    const experiment = this.experiments.get(experimentId)

    if (!experiment) {
      return {
        experimentId,
        inExperiment: false,
        variant: null,
        reason: 'experiment_not_found',
      }
    }

    if (experiment.status !== 'running') {
      return {
        experimentId,
        inExperiment: false,
        variant: null,
        reason: 'experiment_not_running',
      }
    }

    // Check traffic allocation
    const inTraffic = this.bucketing.isInRollout(experimentId, userId, experiment.trafficAllocation)
    if (!inTraffic) {
      return {
        experimentId,
        inExperiment: false,
        variant: null,
        reason: 'not_in_traffic',
      }
    }

    // Allocate to variant using weighted distribution
    const weightedVariants: WeightedVariant<ExperimentVariant>[] = experiment.variants.map(v => ({
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
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new experiment store
 */
export function createExperimentStore(options?: ExperimentStoreOptions): ExperimentStore {
  return new InMemoryExperimentStore(options)
}
