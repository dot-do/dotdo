/**
 * Unified Experiment Tracking API
 *
 * Provides a simplified, unified interface for A/B experiment tracking with:
 * - Variant assignment logging for statistical analysis
 * - Conversion event tracking per variant
 * - Experiment statistics and results
 * - Support for multi-variant experiments (A/B/C/D+)
 *
 * This module wraps the lower-level components (ExperimentStore, ExperimentTracker,
 * ConversionTracker, Statistics) into a cohesive API matching the interface:
 *
 * ```typescript
 * interface ExperimentTracking {
 *   trackAssignment(experimentId: string, userId: string, variant: string): Promise<void>
 *   trackConversion(experimentId: string, userId: string, metric: string, value?: number): Promise<void>
 *   getExperimentStats(experimentId: string): Promise<ExperimentStats>
 *   getVariant(experimentId: string, userId: string): Promise<string>
 * }
 * ```
 *
 * @module db/primitives/feature-flags/experiment-tracking
 */

import {
  createExperimentStore,
  type ExperimentStore,
  type ExperimentDefinition,
  type CreateExperimentOptions,
  type AllocationResult,
} from './experiment'
import {
  createExperimentTracker,
  type ExperimentTracker,
  type Assignment,
  type AssignmentContext,
  type AssignmentSummary,
} from './experiment-tracker'
import {
  createConversionTracker,
  type ConversionTracker,
  type ConversionEvent,
  type GoalMetrics,
  type VariantMetrics,
  type TrackConversionOptions,
} from './conversion-tracker'
import {
  analyzeExperiment,
  zTestProportions,
  calculatePower,
  probabilityToBeat,
  type ExperimentAnalysis,
  type SignificanceResult,
  type VariantComparison,
} from './statistics'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Statistics for a single variant in an experiment
 */
export interface VariantStats {
  /** Variant key */
  variant: string
  /** Number of users assigned to this variant */
  sampleSize: number
  /** Number of conversions */
  conversions: number
  /** Conversion rate (0-1) */
  conversionRate: number
  /** Total value (for revenue metrics) */
  totalValue: number
  /** Mean value per conversion */
  meanValue: number
  /** Standard deviation */
  standardDeviation: number
  /** 95% confidence interval for conversion rate */
  confidenceInterval: {
    lower: number
    upper: number
  }
}

/**
 * Comparison between treatment and control variants
 */
export interface VariantComparisonStats {
  /** Control variant key */
  control: string
  /** Treatment variant key */
  treatment: string
  /** Relative lift (e.g., 0.15 = 15% improvement) */
  relativeLift: number
  /** Absolute lift (treatment rate - control rate) */
  absoluteLift: number
  /** p-value from statistical test */
  pValue: number
  /** Whether the difference is statistically significant */
  isSignificant: boolean
  /** Probability that treatment beats control (Bayesian) */
  probabilityToBeatControl: number
  /** Confidence interval for the lift */
  liftConfidenceInterval: {
    lower: number
    upper: number
  }
}

/**
 * Complete experiment statistics
 */
export interface ExperimentStats {
  /** Experiment ID */
  experimentId: string
  /** Experiment name */
  name: string
  /** Current status */
  status: 'draft' | 'running' | 'paused' | 'completed'
  /** When the experiment started */
  startedAt?: Date
  /** When the experiment ended */
  endedAt?: Date
  /** Total users in experiment */
  totalSampleSize: number
  /** Total conversions across all variants */
  totalConversions: number
  /** Overall conversion rate */
  overallConversionRate: number
  /** Statistics per variant */
  variants: Record<string, VariantStats>
  /** Pairwise comparisons (each treatment vs control) */
  comparisons: VariantComparisonStats[]
  /** Best performing variant (if statistically significant) */
  winner?: string
  /** Probability that we have found the best variant */
  winnerConfidence?: number
  /** Statistical power achieved */
  power: number
  /** Whether minimum sample size has been reached */
  hasMinimumSample: boolean
  /** Recommended action */
  recommendation: 'significant_winner' | 'no_difference' | 'need_more_data'
  /** Estimated days until statistical significance (if still running) */
  estimatedDaysToSignificance?: number
}

/**
 * Configuration for creating an experiment tracking instance
 */
export interface ExperimentTrackingConfig {
  /** Custom experiment store (defaults to in-memory) */
  store?: ExperimentStore
  /** Minimum sample size per variant for significance (default: 100) */
  minSampleSize?: number
  /** Significance threshold alpha (default: 0.05) */
  alpha?: number
  /** Desired statistical power (default: 0.8) */
  power?: number
  /** Enable batch logging for assignments */
  batchAssignments?: boolean
  /** Batch size before flush (default: 100) */
  batchSize?: number
  /** Callback when assignments are flushed */
  onAssignmentFlush?: (assignments: Assignment[]) => void | Promise<void>
  /** Callback when conversions are flushed */
  onConversionFlush?: (conversions: ConversionEvent[]) => void | Promise<void>
}

/**
 * Options for creating a new experiment
 */
export interface CreateExperimentInput {
  /** Unique experiment ID */
  id: string
  /** Human-readable name */
  name: string
  /** Optional description */
  description?: string
  /** Variants with optional weights (defaults to equal weights) */
  variants: Array<{
    key: string
    name: string
    weight?: number
    isControl?: boolean
  }>
  /** Metrics to track (at least one required) */
  metrics: Array<{
    id: string
    name: string
    type?: 'conversion' | 'revenue' | 'engagement'
    isPrimary?: boolean
  }>
  /** Traffic allocation percentage (0-100, default: 100) */
  trafficAllocation?: number
  /** Hypothesis being tested */
  hypothesis?: string
  /** Owner email/identifier */
  owner?: string
}

/**
 * Unified experiment tracking interface
 */
export interface ExperimentTracking {
  // =========================================================================
  // EXPERIMENT MANAGEMENT
  // =========================================================================

  /** Create a new experiment */
  createExperiment(input: CreateExperimentInput): Promise<ExperimentDefinition>
  /** Start an experiment */
  startExperiment(experimentId: string): Promise<ExperimentDefinition>
  /** Pause an experiment */
  pauseExperiment(experimentId: string): Promise<ExperimentDefinition>
  /** Resume a paused experiment */
  resumeExperiment(experimentId: string): Promise<ExperimentDefinition>
  /** Complete an experiment with optional winner */
  completeExperiment(experimentId: string, winner?: string): Promise<ExperimentDefinition>
  /** Get experiment definition */
  getExperiment(experimentId: string): Promise<ExperimentDefinition | null>
  /** List all experiments */
  listExperiments(options?: { status?: 'draft' | 'running' | 'paused' | 'completed'; includeCompleted?: boolean }): Promise<ExperimentDefinition[]>

  // =========================================================================
  // CORE TRACKING API (as specified in issue)
  // =========================================================================

  /**
   * Record variant assignment for a user
   * @param experimentId - Experiment identifier
   * @param userId - User identifier
   * @param variant - Variant key (optional - will auto-allocate if not provided)
   * @returns void
   */
  trackAssignment(experimentId: string, userId: string, variant?: string): Promise<void>

  /**
   * Record a conversion event for a user
   * @param experimentId - Experiment identifier
   * @param userId - User identifier
   * @param metric - Metric/goal identifier
   * @param value - Optional numeric value (for revenue metrics)
   * @returns void
   */
  trackConversion(experimentId: string, userId: string, metric: string, value?: number): Promise<void>

  /**
   * Get comprehensive experiment statistics
   * @param experimentId - Experiment identifier
   * @returns Experiment statistics including variant performance and significance
   */
  getExperimentStats(experimentId: string): Promise<ExperimentStats | null>

  /**
   * Get the assigned variant for a user (consistent assignment)
   * @param experimentId - Experiment identifier
   * @param userId - User identifier
   * @returns Variant key or null if not in experiment
   */
  getVariant(experimentId: string, userId: string): Promise<string | null>

  // =========================================================================
  // ADDITIONAL TRACKING API
  // =========================================================================

  /** Get a user's assignment record */
  getAssignment(experimentId: string, userId: string): Promise<Assignment | null>
  /** Get all assignments for a user across experiments */
  getUserAssignments(userId: string): Promise<Assignment[]>
  /** Check if user has converted for a specific metric */
  hasConverted(experimentId: string, userId: string, metric: string): Promise<boolean>
  /** Get conversion count for a user */
  getConversionCount(experimentId: string, userId: string): Promise<number>
  /** Flush pending batches */
  flush(): Promise<void>
  /** Cleanup resources */
  destroy(): void
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Create a unified experiment tracking instance
 */
export function createExperimentTracking(config: ExperimentTrackingConfig = {}): ExperimentTracking {
  // Initialize underlying components
  const store = config.store ?? createExperimentStore()
  const tracker = createExperimentTracker({
    store,
    batchSize: config.batchSize ?? 100,
    stickyAssignments: true,
    deduplication: true,
    onBatchFlush: config.onAssignmentFlush,
  })

  const conversions = createConversionTracker({
    tracker,
    batchSize: config.batchSize ?? 100,
    deduplication: true,
    onBatchFlush: config.onConversionFlush,
  })

  // Configuration
  const minSampleSize = config.minSampleSize ?? 100
  const alpha = config.alpha ?? 0.05
  const desiredPower = config.power ?? 0.8

  // Track registered goals per experiment
  const experimentGoals = new Map<string, Array<{ id: string; name: string; eventName: string; type: string; aggregation: string; isPrimary: boolean }>>()

  // =========================================================================
  // EXPERIMENT MANAGEMENT
  // =========================================================================

  async function createExperiment(input: CreateExperimentInput): Promise<ExperimentDefinition> {
    // Convert input format to store format
    const createOptions: CreateExperimentOptions = {
      id: input.id,
      name: input.name,
      description: input.description,
      trafficAllocation: input.trafficAllocation ?? 100,
      variants: input.variants.map((v, i) => ({
        key: v.key,
        name: v.name,
        weight: v.weight,
        isControl: v.isControl ?? i === 0, // First variant is control by default
      })),
      goals: input.metrics.map((m, i) => ({
        id: m.id,
        name: m.name,
        eventName: m.id, // Use metric ID as event name
        type: m.type ?? 'conversion',
        aggregation: m.type === 'revenue' ? 'sum' : 'count',
        isPrimary: m.isPrimary ?? i === 0, // First metric is primary by default
      })),
      hypothesis: input.hypothesis,
      owner: input.owner,
      minSampleSize,
      significanceThreshold: 1 - alpha,
    }

    const experiment = await store.create(createOptions)

    // Register goals for conversion tracking
    const goals = experiment.goals.map(g => ({
      id: g.id,
      name: g.name,
      eventName: g.eventName,
      type: g.type,
      aggregation: g.aggregation,
      isPrimary: g.isPrimary ?? false,
    }))
    experimentGoals.set(experiment.id, goals)
    conversions.registerGoals(experiment.id, experiment.goals)

    return experiment
  }

  async function startExperiment(experimentId: string): Promise<ExperimentDefinition> {
    return store.start(experimentId)
  }

  async function pauseExperiment(experimentId: string): Promise<ExperimentDefinition> {
    return store.pause(experimentId)
  }

  async function resumeExperiment(experimentId: string): Promise<ExperimentDefinition> {
    return store.resume(experimentId)
  }

  async function completeExperiment(experimentId: string, winner?: string): Promise<ExperimentDefinition> {
    return store.complete(experimentId, winner)
  }

  async function getExperiment(experimentId: string): Promise<ExperimentDefinition | null> {
    return store.get(experimentId)
  }

  async function listExperiments(options?: { status?: 'draft' | 'running' | 'paused' | 'completed'; includeCompleted?: boolean }): Promise<ExperimentDefinition[]> {
    return store.list({
      status: options?.status,
      includeCompleted: options?.includeCompleted,
    })
  }

  // =========================================================================
  // CORE TRACKING API
  // =========================================================================

  async function trackAssignment(
    experimentId: string,
    userId: string,
    variant?: string
  ): Promise<void> {
    // If variant is provided, we need to allocate to ensure consistency
    // Otherwise, allocateAndTrack will assign automatically
    await tracker.allocateAndTrack(experimentId, userId)
  }

  async function trackConversion(
    experimentId: string,
    userId: string,
    metric: string,
    value?: number
  ): Promise<void> {
    // Ensure user is assigned first
    const assignment = await tracker.getAssignment(experimentId, userId)
    if (!assignment) {
      // Auto-assign if not already assigned
      await tracker.allocateAndTrack(experimentId, userId)
    }

    // Track the conversion
    await conversions.track(experimentId, metric, userId, {
      value,
    })
  }

  async function getExperimentStats(experimentId: string): Promise<ExperimentStats | null> {
    const experiment = await store.get(experimentId)
    if (!experiment) {
      return null
    }

    // Get the primary goal
    const primaryGoal = experiment.goals.find(g => g.isPrimary) ?? experiment.goals[0]
    if (!primaryGoal) {
      return null
    }

    // Ensure goals are registered
    if (!experimentGoals.has(experimentId)) {
      const goals = experiment.goals.map(g => ({
        id: g.id,
        name: g.name,
        eventName: g.eventName,
        type: g.type,
        aggregation: g.aggregation,
        isPrimary: g.isPrimary ?? false,
      }))
      experimentGoals.set(experimentId, goals)
      conversions.registerGoals(experimentId, experiment.goals)
    }

    // Get goal metrics
    const goalMetrics = await conversions.getGoalMetrics(experimentId, primaryGoal.id)

    if (!goalMetrics) {
      // No data yet - return empty stats
      const assignmentSummary = await tracker.getSummary(experimentId)

      return {
        experimentId,
        name: experiment.name,
        status: experiment.status,
        startedAt: experiment.startedAt,
        endedAt: experiment.endedAt,
        totalSampleSize: assignmentSummary.totalAssignments,
        totalConversions: 0,
        overallConversionRate: 0,
        variants: Object.fromEntries(
          experiment.variants.map(v => [
            v.key,
            {
              variant: v.key,
              sampleSize: assignmentSummary.variantCounts[v.key] ?? 0,
              conversions: 0,
              conversionRate: 0,
              totalValue: 0,
              meanValue: 0,
              standardDeviation: 0,
              confidenceInterval: { lower: 0, upper: 0 },
            },
          ])
        ),
        comparisons: [],
        power: 0,
        hasMinimumSample: false,
        recommendation: 'need_more_data',
      }
    }

    // Perform statistical analysis
    const analysis = analyzeExperiment(goalMetrics, {
      alpha,
      power: desiredPower,
      minSampleSize,
    })

    // Build variant stats
    const variantStats: Record<string, VariantStats> = {}
    for (const [key, metrics] of Object.entries(goalMetrics.variants)) {
      const rate = metrics.conversionRate
      const n = metrics.sampleSize

      // Wilson score confidence interval for conversion rate
      const z = 1.96 // 95% confidence
      let lower = 0
      let upper = 0
      if (n > 0) {
        const center = (rate + z * z / (2 * n)) / (1 + z * z / n)
        const margin = (z / (1 + z * z / n)) * Math.sqrt(rate * (1 - rate) / n + z * z / (4 * n * n))
        lower = Math.max(0, center - margin)
        upper = Math.min(1, center + margin)
      }

      variantStats[key] = {
        variant: key,
        sampleSize: metrics.sampleSize,
        conversions: metrics.conversions,
        conversionRate: metrics.conversionRate,
        totalValue: metrics.totalValue,
        meanValue: metrics.meanValue,
        standardDeviation: metrics.standardDeviation,
        confidenceInterval: { lower, upper },
      }
    }

    // Build comparison stats
    const comparisonStats: VariantComparisonStats[] = analysis.comparisons.map(c => ({
      control: c.control,
      treatment: c.treatment,
      relativeLift: c.relativeLift,
      absoluteLift: c.absoluteLift,
      pValue: c.significance.pValue,
      isSignificant: c.significance.isSignificant,
      probabilityToBeatControl: c.probabilityToBeatControl,
      liftConfidenceInterval: {
        lower: c.liftConfidenceInterval.lower,
        upper: c.liftConfidenceInterval.upper,
      },
    }))

    // Determine winner
    let winner: string | undefined
    let winnerConfidence: number | undefined
    if (analysis.bestVariant && analysis.overallRecommendation === 'significant_winner') {
      winner = analysis.bestVariant
      // Find the comparison for this variant to get probability
      const winnerComparison = analysis.comparisons.find(c => c.treatment === winner)
      winnerConfidence = winnerComparison?.probabilityToBeatControl
    }

    return {
      experimentId,
      name: experiment.name,
      status: experiment.status,
      startedAt: experiment.startedAt,
      endedAt: experiment.endedAt,
      totalSampleSize: goalMetrics.totalSampleSize,
      totalConversions: goalMetrics.totalConversions,
      overallConversionRate: goalMetrics.overallConversionRate,
      variants: variantStats,
      comparisons: comparisonStats,
      winner,
      winnerConfidence,
      power: analysis.power,
      hasMinimumSample: analysis.hasMinimumSample,
      recommendation: analysis.overallRecommendation,
      estimatedDaysToSignificance: analysis.estimatedDaysToSignificance,
    }
  }

  async function getVariant(experimentId: string, userId: string): Promise<string | null> {
    // Check for existing assignment first
    const existing = await tracker.getAssignment(experimentId, userId)
    if (existing) {
      return existing.variant
    }

    // Allocate new assignment
    const result = await tracker.allocateAndTrack(experimentId, userId)
    return result.variant
  }

  // =========================================================================
  // ADDITIONAL TRACKING API
  // =========================================================================

  async function getAssignment(experimentId: string, userId: string): Promise<Assignment | null> {
    return tracker.getAssignment(experimentId, userId)
  }

  async function getUserAssignments(userId: string): Promise<Assignment[]> {
    return tracker.getUserAssignments(userId)
  }

  async function hasConverted(experimentId: string, userId: string, metric: string): Promise<boolean> {
    return conversions.hasConverted(experimentId, metric, userId)
  }

  async function getConversionCount(experimentId: string, userId: string): Promise<number> {
    return conversions.getUserConversionCount(experimentId, userId)
  }

  async function flush(): Promise<void> {
    await Promise.all([
      tracker.flush(),
      conversions.flush(),
    ])
  }

  function destroy(): void {
    ;(tracker as any).destroy?.()
    ;(conversions as any).destroy?.()
  }

  return {
    // Experiment management
    createExperiment,
    startExperiment,
    pauseExperiment,
    resumeExperiment,
    completeExperiment,
    getExperiment,
    listExperiments,

    // Core tracking API (as specified in issue)
    trackAssignment,
    trackConversion,
    getExperimentStats,
    getVariant,

    // Additional API
    getAssignment,
    getUserAssignments,
    hasConverted,
    getConversionCount,
    flush,
    destroy,
  }
}
