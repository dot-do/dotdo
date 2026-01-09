/**
 * Feature Flag API for $.flag
 *
 * Provides deterministic feature flag evaluation using hashing for
 * per-user assignment. Supports traffic allocation for gradual rollouts.
 *
 * Usage:
 *   const enabled = await $.flag('new-checkout').isEnabled(userId)
 *   await $.Flag.create({ id: 'new-checkout', traffic: 0.5 })
 *   await $.flag('new-checkout').enable()   // Roll out to everyone
 *   await $.flag('new-checkout').disable()  // Roll back
 */

import { hashContext } from './hash'

/**
 * Flag data structure
 */
export interface Flag {
  id: string
  traffic: number
  createdAt: Date
}

/**
 * Options for creating a flag
 */
export interface CreateFlagOptions {
  id: string
  traffic?: number
}

/**
 * Flag store interface for persistence
 */
export interface FlagStore {
  get(id: string): Promise<Flag | undefined>
  set(id: string, flag: Flag): Promise<void>
  delete(id: string): Promise<void>
  list(): Promise<Flag[]>
  has(id: string): Promise<boolean>
}

/**
 * Creates an in-memory flag store for testing
 */
export function createFlagStore(): FlagStore {
  const flags = new Map<string, Flag>()

  return {
    async get(id: string): Promise<Flag | undefined> {
      return flags.get(id)
    },

    async set(id: string, flag: Flag): Promise<void> {
      flags.set(id, flag)
    },

    async delete(id: string): Promise<void> {
      flags.delete(id)
    },

    async list(): Promise<Flag[]> {
      return Array.from(flags.values())
    },

    async has(id: string): Promise<boolean> {
      return flags.has(id)
    },
  }
}

/**
 * Hash a userId and flagId combination to produce a deterministic
 * value between 0 and 1 for traffic allocation.
 *
 * Uses SHA-256 and converts the first 8 hex chars to a float in [0, 1).
 */
function hashToFloat(userId: string, flagId: string): number {
  // Create a deterministic hash from userId + flagId
  const combined = `${flagId}:${userId}`
  const hash = hashContext(combined)

  // Use first 8 hex chars (32 bits) for better distribution
  const hexSubset = hash.slice(0, 8)
  const intValue = parseInt(hexSubset, 16)

  // Convert to float in [0, 1)
  return intValue / 0x100000000
}

/**
 * Validates that traffic is a valid value between 0 and 1
 */
function validateTraffic(traffic: number): void {
  if (traffic < 0 || traffic > 1) {
    throw new Error(`Traffic must be between 0 and 1, got ${traffic}`)
  }
}

/**
 * Flag instance returned by $.flag(name)
 */
export interface FlagInstance {
  isEnabled(userId: string): Promise<boolean>
  enable(): Promise<void>
  disable(): Promise<void>
  setTraffic(traffic: number): Promise<void>
  get(): Promise<Flag | undefined>
  delete(): Promise<void>
}

/**
 * Flag class API for $.Flag
 */
export interface FlagClass {
  create(options: CreateFlagOptions): Promise<Flag>
  list(): Promise<Flag[]>
}

/**
 * The flag proxy API type
 */
export interface FlagProxy {
  flag(name: string): FlagInstance
  Flag: FlagClass
}

/**
 * Creates a flag proxy with the $ workflow API.
 *
 * @param store - The flag store for persistence
 * @returns An object with flag(name) method and Flag class methods
 */
export function createFlagProxy(store: FlagStore): FlagProxy {
  return {
    /**
     * Access a specific flag by name
     */
    flag(name: string): FlagInstance {
      return {
        /**
         * Check if a user is enabled for this flag.
         * Uses deterministic hashing for consistent per-user assignment.
         */
        async isEnabled(userId: string): Promise<boolean> {
          const flag = await store.get(name)

          // Flag doesn't exist - return false
          if (!flag) {
            return false
          }

          // 0% traffic - always false
          if (flag.traffic === 0) {
            return false
          }

          // 100% traffic - always true
          if (flag.traffic === 1) {
            return true
          }

          // Use deterministic hash to decide
          const hashValue = hashToFloat(userId, name)
          return hashValue < flag.traffic
        },

        /**
         * Enable the flag for all users (sets traffic to 1.0)
         */
        async enable(): Promise<void> {
          const flag = await store.get(name)
          if (!flag) {
            throw new Error(`Flag '${name}' does not exist`)
          }
          flag.traffic = 1.0
          await store.set(name, flag)
        },

        /**
         * Disable the flag for all users (sets traffic to 0.0)
         */
        async disable(): Promise<void> {
          const flag = await store.get(name)
          if (!flag) {
            throw new Error(`Flag '${name}' does not exist`)
          }
          flag.traffic = 0.0
          await store.set(name, flag)
        },

        /**
         * Set the traffic allocation for this flag
         */
        async setTraffic(traffic: number): Promise<void> {
          validateTraffic(traffic)

          const flag = await store.get(name)
          if (!flag) {
            throw new Error(`Flag '${name}' does not exist`)
          }

          flag.traffic = traffic
          await store.set(name, flag)
        },

        /**
         * Get the flag details
         */
        async get(): Promise<Flag | undefined> {
          return store.get(name)
        },

        /**
         * Delete this flag
         */
        async delete(): Promise<void> {
          await store.delete(name)
        },
      }
    },

    /**
     * Flag class methods for creating and listing flags
     */
    Flag: {
      /**
       * Create a new feature flag
       */
      async create(options: CreateFlagOptions): Promise<Flag> {
        const { id, traffic = 0 } = options

        // Validate traffic
        validateTraffic(traffic)

        // Check for duplicates
        if (await store.has(id)) {
          throw new Error(`Flag '${id}' already exists`)
        }

        const flag: Flag = {
          id,
          traffic,
          createdAt: new Date(),
        }

        await store.set(id, flag)
        return flag
      },

      /**
       * List all flags
       */
      async list(): Promise<Flag[]> {
        return store.list()
      },
    },
  }
}
