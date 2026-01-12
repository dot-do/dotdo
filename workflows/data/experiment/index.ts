/**
 * $.experiment - A/B Testing API
 *
 * Part of the $ Data API for Business-as-Code.
 *
 * Usage:
 * ```typescript
 * // Define experiment
 * $.experiment.define('pricing-page-v2', {
 *   variants: ['control', 'value-based', 'usage-based'],
 *   weights: [0.34, 0.33, 0.33],
 *   goal: $.track.ratio('Purchase', 'PageView:/pricing'),
 *   audience: (user) => user.createdAt > '2024-01-01',
 *   duration: '14d',
 *   minSampleSize: 1000,
 * })
 *
 * // Start experiment
 * await $.experiment('pricing-page-v2').start()
 *
 * // Assign user to variant
 * const { variant, inExperiment } = await $.experiment('pricing-page-v2').assign(userId)
 *
 * // Get results
 * const results = await $.experiment('pricing-page-v2').results()
 *
 * // Graduate winner
 * await $.experiment('pricing-page-v2').graduate('value-based')
 * ```
 *
 * @module workflows/data/experiment
 */

import { murmurHash3 } from '../../../db/primitives/utils/murmur3'

// =============================================================================
// TYPES
// =============================================================================

export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'stopped' | 'graduated'

export interface Goal {
  type: 'ratio' | 'count' | 'measure'
  numerator?: string
  denominator?: string
  event?: string
  metric?: string
  aggregation?: string
}

export interface ExperimentDefinition {
  name: string
  variants: string[]
  weights?: number[]
  goal: Goal
  audience?: (user: any) => boolean
  duration?: string
  minSampleSize?: number
  status: ExperimentStatus
  startedAt?: number
  stoppedAt?: number
  graduatedVariant?: string
  createdAt: number
}

export interface VariantAssignment {
  variant: string | null
  inExperiment: boolean
}

export interface VariantResults {
  users: number
  conversions: number
  rate: number
  lift?: string
  pValue?: number
}

export interface ExperimentResults {
  status: ExperimentStatus
  variants: Record<string, VariantResults>
  winner?: string
  confidence?: number
  canCall: boolean
}

export interface ExperimentDataContext {
  experiment: ExperimentNamespace
  track: TrackProxy
  measure: MeasureProxy
  _storage: ExperimentStorage
}

export interface ExperimentNamespace {
  define: (name: string, options: ExperimentDefineOptions) => void
  list: (filters?: ExperimentListFilters) => Promise<ExperimentDefinition[]>
  (name: string): ExperimentInstance
}

export interface ExperimentDefineOptions {
  variants: string[]
  weights?: number[]
  goal: Goal
  audience?: (user: any) => boolean
  duration?: string
  minSampleSize?: number
}

export interface ExperimentListFilters {
  status?: ExperimentStatus
}

export interface ExperimentInstance {
  get: () => Promise<ExperimentDefinition | undefined>
  start: () => Promise<void>
  pause: () => Promise<void>
  stop: () => Promise<void>
  graduate: (variant: string) => Promise<void>
  assign: (userId: string, user?: any) => Promise<VariantAssignment>
  assignBatch: (userIds: string[]) => Promise<VariantAssignment[]>
  activate: (userId: string, user?: any) => Promise<string | null>
  results: () => Promise<ExperimentResults>
  _forceAssign: (userId: string, variant: string) => Promise<void>
}

export interface TrackProxy {
  ratio: (numerator: string, denominator: string) => Goal
  count: (event: string) => Goal
  [event: string]: any
}

export interface MeasureProxy {
  [metric: string]: {
    sum: () => Goal
    avg: () => Goal
  }
}

export interface ExperimentStorage {
  experiments: Map<string, ExperimentDefinition>
  assignments: Map<string, Map<string, string>> // experimentName -> userId -> variant
  events: Map<string, TrackedEvent[]> // experimentName -> events
  activations: Map<string, Set<string>> // experimentName -> userIds
}

export interface TrackedEvent {
  id: string
  type: string
  data: Record<string, any>
  timestamp: number
  experiment?: string
  variant?: string
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Create a new experiment data context
 */
export function createExperimentDataContext(existingStorage?: ExperimentStorage): ExperimentDataContext {
  const storage: ExperimentStorage = existingStorage ?? {
    experiments: new Map(),
    assignments: new Map(),
    events: new Map(),
    activations: new Map(),
  }

  // Create track proxy
  const trackProxy = createTrackProxy(storage)

  // Create measure proxy
  const measureProxy = createMeasureProxy()

  // Create experiment namespace
  const experimentNamespace = createExperimentNamespace(storage, trackProxy)

  return {
    experiment: experimentNamespace,
    track: trackProxy,
    measure: measureProxy,
    _storage: storage,
  }
}

function createTrackProxy(storage: ExperimentStorage): TrackProxy {
  const proxy = {
    ratio: (numerator: string, denominator: string): Goal => ({
      type: 'ratio',
      numerator,
      denominator,
    }),
    count: (event: string): Goal => ({
      type: 'count',
      event,
    }),
  } as TrackProxy

  return new Proxy(proxy, {
    get(target, prop: string) {
      if (prop === 'ratio' || prop === 'count') {
        return target[prop]
      }
      // Return a tracking function for any event name
      return async (data: Record<string, any>, options?: { experiment?: string }) => {
        if (options?.experiment) {
          const event: TrackedEvent = {
            id: generateId(),
            type: prop,
            data,
            timestamp: Date.now(),
            experiment: options.experiment,
          }

          // Get the user's variant
          const userId = data.userId
          if (userId) {
            const assignments = storage.assignments.get(options.experiment)
            const variant = assignments?.get(userId)
            if (variant) {
              event.variant = variant
            }
          }

          const events = storage.events.get(options.experiment) || []
          events.push(event)
          storage.events.set(options.experiment, events)
        }
      }
    },
  })
}

function createMeasureProxy(): MeasureProxy {
  return new Proxy({} as MeasureProxy, {
    get(target, prop: string) {
      return {
        sum: (): Goal => ({
          type: 'measure',
          metric: prop,
          aggregation: 'sum',
        }),
        avg: (): Goal => ({
          type: 'measure',
          metric: prop,
          aggregation: 'avg',
        }),
      }
    },
  })
}

function createExperimentNamespace(storage: ExperimentStorage, trackProxy: TrackProxy): ExperimentNamespace {
  const define = (name: string, options: ExperimentDefineOptions): void => {
    // Validate name
    if (!name || name.trim() === '') {
      throw new Error('Experiment name is required')
    }

    // Check for duplicate
    if (storage.experiments.has(name)) {
      throw new Error(`Experiment '${name}' already exists`)
    }

    // Validate variants
    if (options.variants.length < 2) {
      throw new Error('Experiment must have at least 2 variants')
    }

    // Check for duplicate variants
    const variantSet = new Set<string>()
    for (const v of options.variants) {
      if (!v || v.trim() === '') {
        throw new Error('Variant name cannot be empty')
      }
      if (variantSet.has(v)) {
        throw new Error(`Duplicate variant name: ${v}`)
      }
      variantSet.add(v)
    }

    // Validate weights
    let weights = options.weights
    if (weights) {
      if (weights.length !== options.variants.length) {
        throw new Error('Number of weights must match number of variants')
      }

      for (const w of weights) {
        if (w < 0) {
          throw new Error('Weight cannot be negative')
        }
        if (w === 0) {
          throw new Error('Weight cannot be zero')
        }
      }

      const sum = weights.reduce((a, b) => a + b, 0)
      // Allow small floating point errors
      if (Math.abs(sum - 1.0) > 0.01) {
        throw new Error(`Weights must sum to 1.0 (got ${sum})`)
      }
    } else {
      // Default to equal weights
      const equalWeight = 1 / options.variants.length
      weights = options.variants.map(() => equalWeight)
    }

    const experiment: ExperimentDefinition = {
      name,
      variants: options.variants,
      weights,
      goal: options.goal,
      audience: options.audience,
      duration: options.duration,
      minSampleSize: options.minSampleSize,
      status: 'draft',
      createdAt: Date.now(),
    }

    storage.experiments.set(name, experiment)
    storage.assignments.set(name, new Map())
    storage.events.set(name, [])
    storage.activations.set(name, new Set())
  }

  const list = async (filters?: ExperimentListFilters): Promise<ExperimentDefinition[]> => {
    const experiments = Array.from(storage.experiments.values())
    if (filters?.status) {
      return experiments.filter((e) => e.status === filters.status)
    }
    return experiments
  }

  const getInstance = (name: string): ExperimentInstance => {
    return {
      get: async (): Promise<ExperimentDefinition | undefined> => {
        return storage.experiments.get(name)
      },

      start: async (): Promise<void> => {
        const experiment = storage.experiments.get(name)
        if (!experiment) {
          throw new Error(`Experiment '${name}' not found`)
        }
        if (experiment.status === 'running') {
          throw new Error(`Experiment '${name}' is already running`)
        }
        if (experiment.status === 'stopped') {
          throw new Error(`Experiment '${name}' is stopped and cannot be restarted`)
        }
        if (experiment.status === 'graduated') {
          throw new Error(`Experiment '${name}' is graduated and cannot be restarted`)
        }

        experiment.status = 'running'
        if (!experiment.startedAt) {
          experiment.startedAt = Date.now()
        }
      },

      pause: async (): Promise<void> => {
        const experiment = storage.experiments.get(name)
        if (!experiment) {
          throw new Error(`Experiment '${name}' not found`)
        }
        if (experiment.status !== 'running') {
          throw new Error(`Experiment '${name}' is not running`)
        }
        experiment.status = 'paused'
      },

      stop: async (): Promise<void> => {
        const experiment = storage.experiments.get(name)
        if (!experiment) {
          throw new Error(`Experiment '${name}' not found`)
        }
        experiment.status = 'stopped'
        experiment.stoppedAt = Date.now()
      },

      graduate: async (variant: string): Promise<void> => {
        const experiment = storage.experiments.get(name)
        if (!experiment) {
          throw new Error(`Experiment '${name}' not found`)
        }
        if (experiment.status !== 'running' && experiment.status !== 'paused') {
          throw new Error(`Experiment '${name}' must be running or paused to graduate`)
        }
        if (!experiment.variants.includes(variant)) {
          throw new Error(`Invalid variant '${variant}'`)
        }

        experiment.status = 'graduated'
        experiment.graduatedVariant = variant
        experiment.stoppedAt = Date.now()
      },

      assign: async (userId: string, user?: any): Promise<VariantAssignment> => {
        const experiment = storage.experiments.get(name)

        // Return not in experiment for nonexistent
        if (!experiment) {
          return { variant: null, inExperiment: false }
        }

        // Return graduated variant for graduated experiments
        if (experiment.status === 'graduated') {
          return { variant: experiment.graduatedVariant!, inExperiment: true }
        }

        // Get existing assignment
        const assignments = storage.assignments.get(name)!
        const existingVariant = assignments.get(userId)

        // For paused experiments, return existing assignments only
        if (experiment.status === 'paused') {
          if (existingVariant) {
            return { variant: existingVariant, inExperiment: true }
          }
          return { variant: null, inExperiment: false }
        }

        // Return not in experiment for non-running experiments
        if (experiment.status !== 'running') {
          return { variant: null, inExperiment: false }
        }

        // Return existing assignment if any
        if (existingVariant) {
          return { variant: existingVariant, inExperiment: true }
        }

        // Check audience filter
        if (experiment.audience && user) {
          if (!experiment.audience(user)) {
            return { variant: null, inExperiment: false }
          }
        }

        // Assign using MurmurHash for determinism
        const variant = assignVariant(name, userId, experiment.variants, experiment.weights!)
        assignments.set(userId, variant)

        return { variant, inExperiment: true }
      },

      assignBatch: async (userIds: string[]): Promise<VariantAssignment[]> => {
        const experiment = storage.experiments.get(name)
        if (!experiment || experiment.status !== 'running') {
          return userIds.map(() => ({ variant: null, inExperiment: false }))
        }

        const assignments = storage.assignments.get(name)!
        const results: VariantAssignment[] = []

        for (const userId of userIds) {
          const existingVariant = assignments.get(userId)
          if (existingVariant) {
            results.push({ variant: existingVariant, inExperiment: true })
          } else {
            const variant = assignVariant(name, userId, experiment.variants, experiment.weights!)
            assignments.set(userId, variant)
            results.push({ variant, inExperiment: true })
          }
        }

        return results
      },

      activate: async (userId: string, user?: any): Promise<string | null> => {
        const assignment = await getInstance(name).assign(userId, user)
        if (assignment.inExperiment) {
          const activations = storage.activations.get(name)!
          activations.add(userId)
        }
        return assignment.variant
      },

      results: async (): Promise<ExperimentResults> => {
        const experiment = storage.experiments.get(name)
        if (!experiment) {
          return {
            status: 'draft',
            variants: {},
            canCall: false,
          }
        }

        const assignments = storage.assignments.get(name)!
        const events = storage.events.get(name) || []

        // Count users per variant
        const variantUsers: Record<string, Set<string>> = {}
        const variantConversions: Record<string, Set<string>> = {}

        for (const variant of experiment.variants) {
          variantUsers[variant] = new Set()
          variantConversions[variant] = new Set()
        }

        // Count users by variant
        for (const [userId, variant] of assignments) {
          if (variantUsers[variant]) {
            variantUsers[variant].add(userId)
          }
        }

        // Count conversions per variant based on goal
        const goalNumerator = experiment.goal.numerator || experiment.goal.event
        const goalDenominator = experiment.goal.denominator

        // Track denominator events per user per variant
        const variantDenominator: Record<string, Set<string>> = {}
        for (const variant of experiment.variants) {
          variantDenominator[variant] = new Set()
        }

        for (const event of events) {
          const userId = event.data.userId
          const variant = event.variant
          if (!variant || !userId) continue

          // Check if this is the numerator event (conversion)
          if (goalNumerator && event.type === goalNumerator) {
            variantConversions[variant]?.add(userId)
          }

          // Check if this is the denominator event
          if (goalDenominator) {
            const denomEventType = goalDenominator.includes(':')
              ? goalDenominator.split(':')[0]
              : goalDenominator
            if (event.type === denomEventType) {
              variantDenominator[variant]?.add(userId)
            }
          }
        }

        // Build results
        const variantResults: Record<string, VariantResults> = {}
        const controlVariant = experiment.variants[0]
        let controlRate = 0

        for (const variant of experiment.variants) {
          const users = variantUsers[variant]!.size
          const conversions = variantConversions[variant]!.size
          const rate = users > 0 ? conversions / users : 0

          variantResults[variant] = {
            users,
            conversions,
            rate,
          }

          if (variant === controlVariant) {
            controlRate = rate
          }
        }

        // Calculate lift and p-value for non-control variants
        for (const variant of experiment.variants) {
          if (variant === controlVariant) continue

          const result = variantResults[variant]!

          // Calculate lift
          if (controlRate > 0) {
            const lift = ((result.rate - controlRate) / controlRate) * 100
            result.lift = lift >= 0 ? `+${Math.round(lift)}%` : `${Math.round(lift)}%`
          } else if (result.rate > 0) {
            result.lift = '+∞%'
          } else {
            // Both rates are 0 - no change
            result.lift = '+0%'
          }

          // Calculate p-value using chi-squared test
          const controlUsers = variantResults[controlVariant!]!.users
          const controlConversions = variantResults[controlVariant!]!.conversions
          const variantUsers = result.users
          const variantConversions = result.conversions

          result.pValue = calculatePValue(
            controlUsers,
            controlConversions,
            variantUsers,
            variantConversions
          )
        }

        // Determine winner
        let winner: string | undefined
        let confidence = 0
        let canCall = false

        // Find variant with best conversion rate and statistical significance
        let bestVariant: string | undefined
        let bestRate = 0
        let bestPValue = 1

        for (const variant of experiment.variants) {
          const result = variantResults[variant]!
          if (result.rate > bestRate) {
            bestRate = result.rate
            bestVariant = variant
            if (result.pValue !== undefined) {
              bestPValue = result.pValue
            }
          }
        }

        // Check if we have statistical significance (p < 0.05)
        if (bestVariant && bestVariant !== controlVariant && bestPValue < 0.05) {
          winner = bestVariant
          confidence = 1 - bestPValue
          canCall = true
        } else if (bestVariant === controlVariant) {
          // Check if control is significantly better than all variants
          let controlSignificant = true
          for (const variant of experiment.variants) {
            if (variant === controlVariant) continue
            const result = variantResults[variant]!
            if (result.pValue === undefined || result.pValue >= 0.05) {
              controlSignificant = false
              break
            }
          }
          if (controlSignificant && experiment.variants.length > 1) {
            winner = controlVariant
            confidence = 0.95
            canCall = true
          }
        }

        return {
          status: experiment.status,
          variants: variantResults,
          winner,
          confidence,
          canCall,
        }
      },

      _forceAssign: async (userId: string, variant: string): Promise<void> => {
        const assignments = storage.assignments.get(name)
        if (assignments) {
          assignments.set(userId, variant)
        }
      },
    }
  }

  // Create callable namespace
  const namespace = function (name: string): ExperimentInstance {
    return getInstance(name)
  } as ExperimentNamespace

  namespace.define = define
  namespace.list = list

  return namespace
}

/**
 * Assign a user to a variant using MurmurHash for consistent hashing
 */
function assignVariant(
  experimentName: string,
  userId: string,
  variants: string[],
  weights: number[]
): string {
  // Hash the combination of experiment name and user ID for determinism
  const hashInput = `${experimentName}:${userId}`
  const hash = murmurHash3(hashInput, 0)

  // Normalize hash to [0, 1)
  const normalizedHash = (hash >>> 0) / 0x100000000

  // Select variant based on weights
  let cumulative = 0
  for (let i = 0; i < variants.length; i++) {
    cumulative += weights[i]!
    if (normalizedHash < cumulative) {
      return variants[i]!
    }
  }

  // Fallback to last variant (shouldn't happen with proper weights)
  return variants[variants.length - 1]!
}

/**
 * Calculate p-value using chi-squared test for 2x2 contingency table
 */
function calculatePValue(
  controlTotal: number,
  controlSuccess: number,
  treatmentTotal: number,
  treatmentSuccess: number
): number {
  if (controlTotal === 0 || treatmentTotal === 0) {
    return 1
  }

  const controlFailure = controlTotal - controlSuccess
  const treatmentFailure = treatmentTotal - treatmentSuccess

  const total = controlTotal + treatmentTotal
  const totalSuccess = controlSuccess + treatmentSuccess
  const totalFailure = controlFailure + treatmentFailure

  // Expected values
  const expectedControlSuccess = (controlTotal * totalSuccess) / total
  const expectedControlFailure = (controlTotal * totalFailure) / total
  const expectedTreatmentSuccess = (treatmentTotal * totalSuccess) / total
  const expectedTreatmentFailure = (treatmentTotal * totalFailure) / total

  // Chi-squared statistic
  const chiSquared =
    Math.pow(controlSuccess - expectedControlSuccess, 2) / Math.max(expectedControlSuccess, 0.001) +
    Math.pow(controlFailure - expectedControlFailure, 2) / Math.max(expectedControlFailure, 0.001) +
    Math.pow(treatmentSuccess - expectedTreatmentSuccess, 2) / Math.max(expectedTreatmentSuccess, 0.001) +
    Math.pow(treatmentFailure - expectedTreatmentFailure, 2) / Math.max(expectedTreatmentFailure, 0.001)

  // Convert chi-squared to p-value using approximation
  // For df=1, use the complementary error function approximation
  return chiSquaredToPValue(chiSquared, 1)
}

/**
 * Convert chi-squared value to p-value
 * Using Wilson-Hilferty approximation for the chi-squared distribution
 */
function chiSquaredToPValue(chiSquared: number, df: number): number {
  if (chiSquared <= 0) return 1

  // For small chi-squared values
  if (chiSquared < 0.001) return 1

  // Use the regularized incomplete gamma function approximation
  // P(X > x) = 1 - P(X <= x) where X ~ chi-squared(df)
  // For df=1, this is related to the normal distribution

  if (df === 1) {
    // For df=1, chi-squared is the square of a standard normal
    // P(chi-sq > x) = 2 * P(Z > sqrt(x)) where Z ~ N(0,1)
    const z = Math.sqrt(chiSquared)
    return 2 * (1 - normalCdf(z))
  }

  // General approximation using Wilson-Hilferty
  const z = Math.pow(chiSquared / df, 1 / 3) - (1 - 2 / (9 * df))
  const zNorm = z / Math.sqrt(2 / (9 * df))
  return 1 - normalCdf(zNorm)
}

/**
 * Standard normal CDF approximation
 */
function normalCdf(x: number): number {
  // Approximation using error function
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989423 * Math.exp(-x * x / 2)
  const p =
    d *
    t *
    (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))

  return x > 0 ? 1 - p : p
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// =============================================================================
// TRACK CONTEXT FOR EXPERIMENT INTEGRATION
// =============================================================================

/**
 * Track context interface for experiment integration
 * This is a proxy that allows calling track.EventName(...) directly
 */
export type TrackContext = {
  [event: string]: (data: Record<string, any>, options?: { experiment?: string }) => Promise<void>
}

/**
 * Create a track context that integrates with experiment storage
 * This allows tracking events with experiment attribution
 */
export function createTrackContext(storage: ExperimentStorage): TrackContext {
  return new Proxy({} as TrackContext, {
    get(target, prop: string) {
      // Return a tracking function for any event name
      return async (data: Record<string, any>, options?: { experiment?: string }) => {
        if (options?.experiment) {
          const event: TrackedEvent = {
            id: generateId(),
            type: prop,
            data,
            timestamp: Date.now(),
            experiment: options.experiment,
          }

          // Get the user's variant
          const userId = data.userId
          if (userId) {
            const assignments = storage.assignments.get(options.experiment)
            const variant = assignments?.get(userId)
            if (variant) {
              event.variant = variant
            }
          }

          const events = storage.events.get(options.experiment) || []
          events.push(event)
          storage.events.set(options.experiment, events)
        }
      }
    },
  })
}
