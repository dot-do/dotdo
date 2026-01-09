/**
 * Feature Flag Context API for $.flag() and $.flags
 *
 * Provides a workflow context API for feature flag evaluation with support for:
 * - $.flag(id).isEnabled(userId) - Check if flag is enabled for user
 * - $.flag(id).get(userId) - Get full evaluation result with variant/payload
 * - $.flag(id).setTraffic(n) - Update traffic allocation
 * - $.flag(id).enable() - Enable flag for all users
 * - $.flag(id).disable() - Disable flag
 * - $.flags.fetch() - Fetch all flags from storage
 * - $.flags.evaluate(id, userId, flags) - Local evaluation without DB
 *
 * @module workflows/context/flag
 */

import { hashToInt } from '../hash'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Flag definition with variant support and status
 */
export interface Flag {
  id: string
  traffic: number
  status: 'active' | 'disabled' | 'archived'
  branches: Array<{
    key: string
    weight: number
    payload?: unknown
  }>
  stickiness: 'user_id' | 'session_id' | 'random'
  createdAt: Date
  updatedAt: Date
}

/**
 * Result from evaluating a flag for a user
 */
export interface FlagEvaluation {
  enabled: boolean
  variant: string | null
  payload?: unknown
}

/**
 * Flag instance returned by $.flag('id')
 */
export interface FlagContextInstance {
  isEnabled(userId: string): Promise<boolean>
  get(userId: string): Promise<FlagEvaluation>
  setTraffic(traffic: number): Promise<void>
  enable(): Promise<void>
  disable(): Promise<void>
}

/**
 * Flags collection API at $.flags
 */
export interface FlagsCollection {
  fetch(): Promise<Record<string, Flag>>
  evaluate(flagId: string, userId: string, flags: Record<string, Flag>): FlagEvaluation
}

/**
 * Mock storage interface for flags
 */
export interface MockStorage {
  flags: Map<string, Flag>
}

/**
 * Full context interface returned by createMockContext
 */
export interface FlagContext {
  flag: (id: string) => FlagContextInstance
  flags: FlagsCollection
  _storage: MockStorage
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Maximum value for 32-bit hash (2^32 - 1)
 */
const MAX_HASH_VALUE = 0xffffffff

// ============================================================================
// CORE EVALUATION LOGIC
// ============================================================================

/**
 * Check if user is in traffic allocation using deterministic hash
 */
function isInTraffic(flagId: string, userId: string, traffic: number): boolean {
  if (traffic <= 0) {
    return false
  }
  if (traffic >= 1) {
    return true
  }

  const hashInput = `${userId}:${flagId}`
  const hashValue = hashToInt(hashInput)
  const normalizedHash = hashValue / MAX_HASH_VALUE

  return normalizedHash < traffic
}

/**
 * Assign user to a branch based on weighted distribution using deterministic hash
 */
function assignBranch(
  flagId: string,
  userId: string,
  branches: Array<{ key: string; weight: number; payload?: unknown }>
): { key: string; weight: number; payload?: unknown } | null {
  if (!branches || branches.length === 0) {
    return null
  }

  // Calculate total weight
  const totalWeight = branches.reduce((sum, branch) => sum + branch.weight, 0)
  if (totalWeight === 0) {
    return null
  }

  // Use a different hash input for branch assignment to get independent randomization
  const hashInput = `${userId}:${flagId}:branch`
  const hashValue = hashToInt(hashInput)
  const normalizedHash = hashValue / MAX_HASH_VALUE
  const targetValue = normalizedHash * totalWeight

  // Find the branch based on cumulative weights
  let cumulativeWeight = 0
  for (const branch of branches) {
    cumulativeWeight += branch.weight
    if (targetValue < cumulativeWeight) {
      return branch
    }
  }

  // Fallback to last branch (should not happen with proper weights)
  return branches[branches.length - 1]
}

/**
 * Evaluate a flag for a given user
 *
 * Evaluation order:
 * 1. Check flag exists (non-existent = disabled)
 * 2. Check flag status (disabled = disabled)
 * 3. Check traffic allocation using deterministic hash
 * 4. Assign to branch using weighted distribution
 *
 * @param flag - The flag configuration (or undefined if not found)
 * @param userId - The user ID for deterministic assignment
 * @returns The evaluation result with enabled status, variant, and optional payload
 */
export function evaluateFlag(flag: Flag | undefined, userId: string): FlagEvaluation {
  // Flag doesn't exist - return disabled
  if (!flag) {
    return {
      enabled: false,
      variant: null,
    }
  }

  // Check if flag status is disabled
  if (flag.status === 'disabled' || flag.status === 'archived') {
    return {
      enabled: false,
      variant: null,
    }
  }

  // Check traffic allocation
  if (!isInTraffic(flag.id, userId, flag.traffic)) {
    return {
      enabled: false,
      variant: null,
    }
  }

  // Assign to branch
  const branch = assignBranch(flag.id, userId, flag.branches)
  if (branch) {
    return {
      enabled: true,
      variant: branch.key,
      payload: branch.payload,
    }
  }

  // No branches - just enabled
  return {
    enabled: true,
    variant: null,
  }
}

// ============================================================================
// CONTEXT FACTORY
// ============================================================================

/**
 * Creates a mock workflow context ($) with flag support for testing
 *
 * This factory creates a context object with:
 * - $.flag(id) - Returns a FlagContextInstance for per-flag operations
 * - $.flags - Collection-level operations (fetch, evaluate)
 * - $._storage - Internal storage for test setup
 *
 * @returns A FlagContext object with flag API methods
 */
export function createMockContext(): FlagContext {
  // Internal flag storage
  const storage: MockStorage = {
    flags: new Map<string, Flag>(),
  }

  /**
   * Create a FlagContextInstance for a specific flag ID
   */
  function createFlagInstance(id: string): FlagContextInstance {
    return {
      /**
       * Check if a user is enabled for this flag
       * Uses deterministic hashing for consistent per-user assignment
       */
      async isEnabled(userId: string): Promise<boolean> {
        const flag = storage.flags.get(id)
        const result = evaluateFlag(flag, userId)
        return result.enabled
      },

      /**
       * Get full evaluation result including variant and payload
       */
      async get(userId: string): Promise<FlagEvaluation> {
        const flag = storage.flags.get(id)
        return evaluateFlag(flag, userId)
      },

      /**
       * Update traffic allocation for this flag
       * @param traffic - Value between 0 and 1
       */
      async setTraffic(traffic: number): Promise<void> {
        // Validate traffic range
        if (traffic < 0 || traffic > 1) {
          throw new Error(`Traffic must be between 0 and 1, got ${traffic}`)
        }

        const flag = storage.flags.get(id)
        if (!flag) {
          throw new Error(`Flag '${id}' does not exist`)
        }

        flag.traffic = traffic
        flag.updatedAt = new Date()
        storage.flags.set(id, flag)
      },

      /**
       * Enable the flag for all users
       * Sets traffic to 1.0 and status to active
       */
      async enable(): Promise<void> {
        const flag = storage.flags.get(id)
        if (!flag) {
          throw new Error(`Flag '${id}' does not exist`)
        }

        flag.traffic = 1.0
        flag.status = 'active'
        flag.updatedAt = new Date()
        storage.flags.set(id, flag)
      },

      /**
       * Disable the flag for all users
       * Sets status to disabled but preserves traffic value
       */
      async disable(): Promise<void> {
        const flag = storage.flags.get(id)
        if (!flag) {
          throw new Error(`Flag '${id}' does not exist`)
        }

        flag.status = 'disabled'
        flag.updatedAt = new Date()
        storage.flags.set(id, flag)
      },
    }
  }

  /**
   * Flags collection API
   */
  const flagsCollection: FlagsCollection = {
    /**
     * Fetch all flags from storage
     * Returns a deep copy to prevent mutations
     */
    async fetch(): Promise<Record<string, Flag>> {
      const result: Record<string, Flag> = {}

      for (const [key, flag] of storage.flags.entries()) {
        // Create a deep copy to prevent mutations affecting storage
        result[key] = {
          ...flag,
          branches: flag.branches.map((b) => ({ ...b })),
          createdAt: new Date(flag.createdAt.getTime()),
          updatedAt: new Date(flag.updatedAt.getTime()),
        }
      }

      return result
    },

    /**
     * Evaluate a flag locally against provided flags object
     * This is synchronous and doesn't hit storage
     *
     * @param flagId - The flag ID to evaluate
     * @param userId - The user ID for deterministic assignment
     * @param flags - The flags object to evaluate against
     */
    evaluate(flagId: string, userId: string, flags: Record<string, Flag>): FlagEvaluation {
      const flag = flags[flagId]
      return evaluateFlag(flag, userId)
    },
  }

  return {
    flag: createFlagInstance,
    flags: flagsCollection,
    _storage: storage,
  }
}
