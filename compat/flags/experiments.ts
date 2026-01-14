/**
 * @dotdo/flags - A/B Testing and Experiments
 *
 * Provides experiment support including:
 * - Experiment variant assignment
 * - Experiment tracking
 * - Metrics collection
 * - Result aggregation
 */

import { murmurHash3_32 } from '../../db/primitives/utils/murmur3'
import {
  type LDFlagValue,
  type LDContext,
  type LDUser,
  type Experiment,
  type ExperimentVariant,
  type ExperimentResult,
  type WeightedVariation,
  type FeatureFlag,
} from './types'
import { getContextKey } from './evaluation'

// =============================================================================
// Constants
// =============================================================================

const BUCKET_SCALE = 100000

// =============================================================================
// Experiment Assignment
// =============================================================================

/**
 * Assign a user to an experiment variant
 */
export function assignExperimentVariant(
  experiment: Experiment,
  context: LDContext,
  salt?: string
): ExperimentResult {
  const userKey = getContextKey(context, 'user')
  if (!userKey) {
    // Return first variant as control for unknown users
    const control = experiment.variants[0]
    return {
      experimentKey: experiment.key,
      variantId: control?.id ?? 'control',
      variantValue: control?.value ?? null,
      inExperiment: false,
    }
  }

  // Check if experiment is running
  if (experiment.status !== 'running') {
    const control = experiment.variants[0]
    return {
      experimentKey: experiment.key,
      variantId: control?.id ?? 'control',
      variantValue: control?.value ?? null,
      inExperiment: false,
    }
  }

  // Calculate bucket for this user
  const experimentSalt = salt ?? experiment.key
  const bucket = getBucket(userKey, experimentSalt)

  // Select variant based on weights
  const { variant, inExperiment } = selectVariant(bucket, experiment.variants)

  return {
    experimentKey: experiment.key,
    variantId: variant.id,
    variantValue: variant.value,
    inExperiment,
  }
}

/**
 * Calculate bucket value for a user
 */
function getBucket(userKey: string, salt: string): number {
  const hashInput = `${salt}.${userKey}`
  const hash = murmurHash3_32(hashInput)
  return Math.abs(hash) % BUCKET_SCALE
}

/**
 * Select variant based on bucket and weights
 */
function selectVariant(
  bucket: number,
  variants: ExperimentVariant[]
): { variant: ExperimentVariant; inExperiment: boolean } {
  // Normalize weights to BUCKET_SCALE
  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0)
  const scaledVariants = variants.map((v) => ({
    ...v,
    scaledWeight: Math.round((v.weight / totalWeight) * BUCKET_SCALE),
  }))

  let sum = 0
  for (const variant of scaledVariants) {
    sum += variant.scaledWeight
    if (bucket < sum) {
      return { variant, inExperiment: true }
    }
  }

  // Fallback to last variant
  const last = variants[variants.length - 1] ?? variants[0]
  return { variant: last!, inExperiment: true }
}

// =============================================================================
// Experiment Event Tracking
// =============================================================================

/**
 * Event for experiment exposure
 */
export interface ExperimentExposureEvent {
  kind: 'experiment_exposure'
  experimentKey: string
  variantId: string
  userKey: string
  timestamp: number
}

/**
 * Event for experiment conversion
 */
export interface ExperimentConversionEvent {
  kind: 'experiment_conversion'
  experimentKey: string
  variantId: string
  userKey: string
  metricKey: string
  value?: number
  timestamp: number
}

/**
 * Create an exposure event
 */
export function createExposureEvent(
  experimentKey: string,
  variantId: string,
  userKey: string
): ExperimentExposureEvent {
  return {
    kind: 'experiment_exposure',
    experimentKey,
    variantId,
    userKey,
    timestamp: Date.now(),
  }
}

/**
 * Create a conversion event
 */
export function createConversionEvent(
  experimentKey: string,
  variantId: string,
  userKey: string,
  metricKey: string,
  value?: number
): ExperimentConversionEvent {
  return {
    kind: 'experiment_conversion',
    experimentKey,
    variantId,
    userKey,
    metricKey,
    value,
    timestamp: Date.now(),
  }
}

// =============================================================================
// Experiment Metrics
// =============================================================================

/**
 * Metrics aggregation for an experiment variant
 */
export interface VariantMetrics {
  variantId: string
  exposures: number
  conversions: Record<string, number>
  conversionValues: Record<string, number>
  conversionRates: Record<string, number>
  users: Set<string>
}

/**
 * Metrics aggregation for an experiment
 */
export interface ExperimentMetrics {
  experimentKey: string
  variants: Record<string, VariantMetrics>
  startTime?: number
  endTime?: number
}

/**
 * Create empty metrics for a variant
 */
export function createVariantMetrics(variantId: string): VariantMetrics {
  return {
    variantId,
    exposures: 0,
    conversions: {},
    conversionValues: {},
    conversionRates: {},
    users: new Set(),
  }
}

/**
 * Create empty metrics for an experiment
 */
export function createExperimentMetrics(experimentKey: string): ExperimentMetrics {
  return {
    experimentKey,
    variants: {},
  }
}

/**
 * Record an exposure in metrics
 */
export function recordExposure(
  metrics: ExperimentMetrics,
  event: ExperimentExposureEvent
): void {
  if (!metrics.variants[event.variantId]) {
    metrics.variants[event.variantId] = createVariantMetrics(event.variantId)
  }

  const variant = metrics.variants[event.variantId]!
  variant.exposures++
  variant.users.add(event.userKey)

  if (!metrics.startTime || event.timestamp < metrics.startTime) {
    metrics.startTime = event.timestamp
  }
  if (!metrics.endTime || event.timestamp > metrics.endTime) {
    metrics.endTime = event.timestamp
  }
}

/**
 * Record a conversion in metrics
 */
export function recordConversion(
  metrics: ExperimentMetrics,
  event: ExperimentConversionEvent
): void {
  if (!metrics.variants[event.variantId]) {
    metrics.variants[event.variantId] = createVariantMetrics(event.variantId)
  }

  const variant = metrics.variants[event.variantId]!
  variant.conversions[event.metricKey] = (variant.conversions[event.metricKey] ?? 0) + 1

  if (event.value !== undefined) {
    variant.conversionValues[event.metricKey] =
      (variant.conversionValues[event.metricKey] ?? 0) + event.value
  }

  // Update conversion rate
  if (variant.exposures > 0) {
    variant.conversionRates[event.metricKey] =
      variant.conversions[event.metricKey]! / variant.exposures
  }

  if (!metrics.endTime || event.timestamp > metrics.endTime) {
    metrics.endTime = event.timestamp
  }
}

// =============================================================================
// Experiment Helpers
// =============================================================================

/**
 * Check if a flag is configured as an experiment
 */
export function isExperimentFlag(flag: FeatureFlag): boolean {
  if (flag.trackEvents && flag.fallthrough?.rollout?.kind === 'experiment') {
    return true
  }

  if (flag.rules) {
    for (const rule of flag.rules) {
      if (rule.rollout?.kind === 'experiment') {
        return true
      }
    }
  }

  return false
}

/**
 * Create an experiment from a flag definition
 */
export function createExperimentFromFlag(
  flagKey: string,
  flag: FeatureFlag
): Experiment | null {
  if (!flag.variations || flag.variations.length < 2) {
    return null
  }

  // Get rollout config
  let rollout = flag.fallthrough?.rollout
  if (!rollout?.kind || rollout.kind !== 'experiment') {
    // Check rules for experiment rollout
    for (const rule of flag.rules ?? []) {
      if (rule.rollout?.kind === 'experiment') {
        rollout = rule.rollout
        break
      }
    }
  }

  if (!rollout) {
    return null
  }

  // Build variants from variations and weights
  const variants: ExperimentVariant[] = rollout.variations.map((wv, index) => ({
    id: `variant-${wv.variation}`,
    name: `Variant ${wv.variation}`,
    value: flag.variations![wv.variation]!,
    weight: wv.weight,
  }))

  return {
    key: flagKey,
    name: flagKey,
    variants,
    status: flag.on === false ? 'paused' : 'running',
  }
}

// =============================================================================
// Statistical Analysis (Basic)
// =============================================================================

/**
 * Calculate basic statistics for a variant
 */
export interface VariantStats {
  variantId: string
  sampleSize: number
  uniqueUsers: number
  conversionRates: Record<string, number>
  meanValues: Record<string, number>
}

/**
 * Calculate statistics for an experiment
 */
export function calculateExperimentStats(
  metrics: ExperimentMetrics
): Record<string, VariantStats> {
  const stats: Record<string, VariantStats> = {}

  for (const [variantId, variantMetrics] of Object.entries(metrics.variants)) {
    const meanValues: Record<string, number> = {}

    for (const [metricKey, totalValue] of Object.entries(variantMetrics.conversionValues)) {
      const conversions = variantMetrics.conversions[metricKey] ?? 0
      if (conversions > 0) {
        meanValues[metricKey] = totalValue / conversions
      }
    }

    stats[variantId] = {
      variantId,
      sampleSize: variantMetrics.exposures,
      uniqueUsers: variantMetrics.users.size,
      conversionRates: { ...variantMetrics.conversionRates },
      meanValues,
    }
  }

  return stats
}

/**
 * Simple A/B test significance check (uses approximate z-test)
 * Returns true if the difference is statistically significant at p < 0.05
 */
export function isStatisticallySignificant(
  controlConversions: number,
  controlTotal: number,
  treatmentConversions: number,
  treatmentTotal: number
): boolean {
  if (controlTotal === 0 || treatmentTotal === 0) {
    return false
  }

  const p1 = controlConversions / controlTotal
  const p2 = treatmentConversions / treatmentTotal

  // Pooled proportion
  const p = (controlConversions + treatmentConversions) / (controlTotal + treatmentTotal)

  // Standard error
  const se = Math.sqrt(p * (1 - p) * (1 / controlTotal + 1 / treatmentTotal))

  if (se === 0) {
    return false
  }

  // Z-score
  const z = Math.abs(p2 - p1) / se

  // Two-tailed test at 95% confidence (z > 1.96)
  return z > 1.96
}
