/**
 * Experiment Context API for $.experiment()
 *
 * Provides a workflow context API for A/B testing experiments with support for:
 * - $.experiment(id).allocate(userId) - Allocate user to variant
 * - $.experiment(id).isEnabled() - Check if experiment is running
 * - $.experiment(id).variant(name) - Get variant configuration
 * - $.experiment(id).pause() / resume() / complete() - Lifecycle management
 * - $.experiment(id).setTraffic(n) - Update traffic allocation
 * - $.Experiment.create({...}) - Create new experiment
 * - $.Experiment.list() - List all experiments
 *
 * @module workflows/context/experiment
 */

import { hashToInt } from '../hash'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Experiment status values
 */
export type ExperimentStatus = 'running' | 'paused' | 'completed'

/**
 * Variant definition with weight and optional payload
 */
export interface Variant {
  key: string
  weight: number
  payload?: Record<string, unknown>
}

/**
 * Experiment definition
 */
export interface Experiment {
  id: string
  traffic: number
  status: ExperimentStatus
  variants: Variant[]
  createdAt: Date
  updatedAt: Date
}

/**
 * Result from allocating a user to an experiment
 */
export interface AllocationResult {
  inExperiment: boolean
  variant: string | null
  payload?: Record<string, unknown>
}

/**
 * Options for creating an experiment
 */
export interface CreateExperimentOptions {
  id: string
  variants: Array<{ key: string; weight: number; payload?: Record<string, unknown> }>
  traffic?: number
  status?: ExperimentStatus
}

/**
 * Experiment instance returned by $.experiment(id)
 */
export interface ExperimentInstance {
  allocate(userId: string): Promise<AllocationResult>
  isEnabled(): Promise<boolean>
  variant(name: string): Promise<Variant | undefined>
  get(): Promise<Experiment | undefined>
  pause(): Promise<void>
  resume(): Promise<void>
  complete(): Promise<void>
  setTraffic(traffic: number): Promise<void>
  delete(): Promise<void>
}

/**
 * Experiment collection API at $.Experiment
 */
export interface ExperimentCollection {
  create(options: CreateExperimentOptions): Promise<Experiment>
  list(): Promise<Experiment[]>
}

/**
 * Mock storage interface for experiments
 */
export interface ExperimentStorage {
  experiments: Map<string, Experiment>
}

/**
 * Full context interface returned by createExperimentContext
 */
export interface ExperimentContext {
  experiment: (id: string) => ExperimentInstance
  Experiment: ExperimentCollection
  _storage: ExperimentStorage
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Maximum value for 32-bit hash (2^32 - 1)
 */
const MAX_HASH_VALUE = 0xffffffff

// ============================================================================
// CORE ALLOCATION LOGIC
// ============================================================================

/**
 * Check if user is in traffic allocation using deterministic hash
 */
function isInTraffic(experimentId: string, userId: string, traffic: number): boolean {
  if (traffic <= 0) {
    return false
  }
  if (traffic >= 1) {
    return true
  }

  const hashInput = `${userId}:${experimentId}:traffic`
  const hashValue = hashToInt(hashInput)
  const normalizedHash = hashValue / MAX_HASH_VALUE

  return normalizedHash < traffic
}

/**
 * Assign user to a variant based on weighted distribution using deterministic hash
 */
function assignVariant(
  experimentId: string,
  userId: string,
  variants: Variant[]
): Variant | null {
  if (!variants || variants.length === 0) {
    return null
  }

  // Calculate total weight
  const totalWeight = variants.reduce((sum, variant) => sum + variant.weight, 0)
  if (totalWeight === 0) {
    return null
  }

  // Use a different hash input for variant assignment
  const hashInput = `${userId}:${experimentId}:variant`
  const hashValue = hashToInt(hashInput)
  const normalizedHash = hashValue / MAX_HASH_VALUE
  const targetValue = normalizedHash * totalWeight

  // Find the variant based on cumulative weights
  let cumulativeWeight = 0
  for (const variant of variants) {
    cumulativeWeight += variant.weight
    if (targetValue < cumulativeWeight) {
      return variant
    }
  }

  // Fallback to last variant (should not happen with proper weights)
  return variants[variants.length - 1]
}

/**
 * Allocate a user to an experiment
 *
 * Allocation order:
 * 1. Check experiment exists (non-existent = not in experiment)
 * 2. Check experiment status (not running = not in experiment)
 * 3. Check traffic allocation using deterministic hash
 * 4. Assign to variant using weighted distribution
 */
export function allocateUser(
  experiment: Experiment | undefined,
  userId: string
): AllocationResult {
  // Experiment doesn't exist
  if (!experiment) {
    return {
      inExperiment: false,
      variant: null,
    }
  }

  // Check if experiment is running
  if (experiment.status !== 'running') {
    return {
      inExperiment: false,
      variant: null,
    }
  }

  // Check traffic allocation
  if (!isInTraffic(experiment.id, userId, experiment.traffic)) {
    return {
      inExperiment: false,
      variant: null,
    }
  }

  // Assign to variant
  const variant = assignVariant(experiment.id, userId, experiment.variants)
  if (variant) {
    return {
      inExperiment: true,
      variant: variant.key,
      payload: variant.payload,
    }
  }

  // No variants assigned (shouldn't happen with valid experiment)
  return {
    inExperiment: true,
    variant: null,
  }
}

// ============================================================================
// CONTEXT FACTORY
// ============================================================================

/**
 * Creates an experiment context ($) with experiment support
 *
 * This factory creates a context object with:
 * - $.experiment(id) - Returns an ExperimentInstance for per-experiment operations
 * - $.Experiment - Collection-level operations (create, list)
 * - $._storage - Internal storage for test setup
 *
 * @param existingStorage - Optional existing storage to reuse (for testing consistency)
 * @returns An ExperimentContext object with experiment API methods
 */
export function createExperimentContext(existingStorage?: ExperimentStorage): ExperimentContext {
  // Internal experiment storage
  const storage: ExperimentStorage = existingStorage ?? {
    experiments: new Map<string, Experiment>(),
  }

  /**
   * Create an ExperimentInstance for a specific experiment ID
   */
  function createExperimentInstance(id: string): ExperimentInstance {
    return {
      /**
       * Allocate a user to this experiment
       * Uses deterministic hashing for consistent per-user assignment
       */
      async allocate(userId: string): Promise<AllocationResult> {
        const experiment = storage.experiments.get(id)
        return allocateUser(experiment, userId)
      },

      /**
       * Check if this experiment is enabled (running)
       */
      async isEnabled(): Promise<boolean> {
        const experiment = storage.experiments.get(id)
        if (!experiment) {
          return false
        }
        return experiment.status === 'running'
      },

      /**
       * Get a specific variant by name
       */
      async variant(name: string): Promise<Variant | undefined> {
        const experiment = storage.experiments.get(id)
        if (!experiment) {
          return undefined
        }
        return experiment.variants.find((v) => v.key === name)
      },

      /**
       * Get the full experiment configuration
       */
      async get(): Promise<Experiment | undefined> {
        return storage.experiments.get(id)
      },

      /**
       * Pause the experiment
       */
      async pause(): Promise<void> {
        const experiment = storage.experiments.get(id)
        if (!experiment) {
          throw new Error(`Experiment '${id}' does not exist`)
        }

        experiment.status = 'paused'
        experiment.updatedAt = new Date()
        storage.experiments.set(id, experiment)
      },

      /**
       * Resume a paused experiment
       */
      async resume(): Promise<void> {
        const experiment = storage.experiments.get(id)
        if (!experiment) {
          throw new Error(`Experiment '${id}' does not exist`)
        }

        experiment.status = 'running'
        experiment.updatedAt = new Date()
        storage.experiments.set(id, experiment)
      },

      /**
       * Complete the experiment
       */
      async complete(): Promise<void> {
        const experiment = storage.experiments.get(id)
        if (!experiment) {
          throw new Error(`Experiment '${id}' does not exist`)
        }

        experiment.status = 'completed'
        experiment.updatedAt = new Date()
        storage.experiments.set(id, experiment)
      },

      /**
       * Update traffic allocation
       * @param traffic - Value between 0 and 1
       */
      async setTraffic(traffic: number): Promise<void> {
        if (traffic < 0 || traffic > 1) {
          throw new Error(`Traffic must be between 0 and 1, got ${traffic}`)
        }

        const experiment = storage.experiments.get(id)
        if (!experiment) {
          throw new Error(`Experiment '${id}' does not exist`)
        }

        experiment.traffic = traffic
        experiment.updatedAt = new Date()
        storage.experiments.set(id, experiment)
      },

      /**
       * Delete the experiment
       */
      async delete(): Promise<void> {
        storage.experiments.delete(id)
      },
    }
  }

  /**
   * Experiment collection API
   */
  const experimentCollection: ExperimentCollection = {
    /**
     * Create a new experiment
     */
    async create(options: CreateExperimentOptions): Promise<Experiment> {
      // Validate experiment doesn't already exist
      if (storage.experiments.has(options.id)) {
        throw new Error(`Experiment '${options.id}' already exists`)
      }

      // Validate at least 2 variants
      if (!options.variants || options.variants.length < 2) {
        throw new Error('Experiment must have at least 2 variants')
      }

      // Validate all weights are positive
      for (const variant of options.variants) {
        if (variant.weight < 0) {
          throw new Error(`Variant weight must be non-negative, got ${variant.weight}`)
        }
      }

      // Validate traffic
      const traffic = options.traffic ?? 1.0
      if (traffic < 0 || traffic > 1) {
        throw new Error(`Traffic must be between 0 and 1, got ${traffic}`)
      }

      const now = new Date()
      const experiment: Experiment = {
        id: options.id,
        traffic,
        status: options.status ?? 'running',
        variants: options.variants.map((v) => ({
          key: v.key,
          weight: v.weight,
          payload: v.payload,
        })),
        createdAt: now,
        updatedAt: now,
      }

      storage.experiments.set(options.id, experiment)
      return experiment
    },

    /**
     * List all experiments
     */
    async list(): Promise<Experiment[]> {
      return Array.from(storage.experiments.values())
    },
  }

  return {
    experiment: createExperimentInstance,
    Experiment: experimentCollection,
    _storage: storage,
  }
}
