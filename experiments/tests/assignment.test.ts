/**
 * Tests for experiment assignment and bucketing
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createAssignmentManager, assignVariant } from '../assignment'
import type { ExperimentDefinition, ExperimentStorage } from '../types'

// Mock storage for testing - cast to ExperimentStorage
function createMockStorage(): ExperimentStorage {
  const store = new Map<string, unknown>()

  const storage = {
    get: async <T>(keyOrKeys: string | string[]): Promise<T | Map<string, T> | undefined> => {
      if (typeof keyOrKeys === 'string') {
        return store.get(keyOrKeys) as T | undefined
      }
      const result = new Map<string, T>()
      for (const key of keyOrKeys) {
        const value = store.get(key)
        if (value !== undefined) {
          result.set(key, value as T)
        }
      }
      return result
    },

    put: async <T>(keyOrEntries: string | Map<string, T>, value?: T): Promise<void> => {
      if (typeof keyOrEntries === 'string') {
        store.set(keyOrEntries, value)
      } else {
        for (const [k, v] of keyOrEntries) {
          store.set(k, v)
        }
      }
    },

    delete: async (keyOrKeys: string | string[]): Promise<boolean | number> => {
      if (typeof keyOrKeys === 'string') {
        return store.delete(keyOrKeys)
      }
      let count = 0
      for (const key of keyOrKeys) {
        if (store.delete(key)) count++
      }
      return count
    },

    list: async <T>(options?: { prefix?: string }): Promise<Map<string, T>> => {
      const result = new Map<string, T>()
      const prefix = options?.prefix ?? ''
      for (const [key, value] of store) {
        if (key.startsWith(prefix)) {
          result.set(key, value as T)
        }
      }
      return result
    },
  }

  // Cast to ExperimentStorage to satisfy strict type checking
  return storage as unknown as ExperimentStorage
}

describe('assignVariant', () => {
  const variants = [
    { id: 'control', name: 'Control', weight: 50 },
    { id: 'treatment', name: 'Treatment', weight: 50 },
  ]

  it('should consistently assign the same user to the same variant', () => {
    const userId = 'user-123'
    const experimentId = 'test-experiment'

    const variant1 = assignVariant(userId, experimentId, variants)
    const variant2 = assignVariant(userId, experimentId, variants)

    expect(variant1).toEqual(variant2)
  })

  it('should assign different users to different variants over many users', () => {
    const experimentId = 'test-experiment'
    const assignments = new Map<string, number>()

    for (let i = 0; i < 1000; i++) {
      const userId = `user-${i}`
      const variant = assignVariant(userId, experimentId, variants)
      if (variant) {
        assignments.set(variant.id, (assignments.get(variant.id) ?? 0) + 1)
      }
    }

    // Both variants should have assignments
    expect(assignments.get('control')).toBeGreaterThan(0)
    expect(assignments.get('treatment')).toBeGreaterThan(0)

    // Distribution should be roughly 50/50 (within 10%)
    const total = (assignments.get('control') ?? 0) + (assignments.get('treatment') ?? 0)
    const controlPercent = (assignments.get('control') ?? 0) / total
    expect(controlPercent).toBeGreaterThan(0.4)
    expect(controlPercent).toBeLessThan(0.6)
  })

  it('should respect variant weights', () => {
    const weightedVariants = [
      { id: 'a', name: 'A', weight: 80 },
      { id: 'b', name: 'B', weight: 20 },
    ]
    const experimentId = 'weighted-test'
    const assignments = new Map<string, number>()

    for (let i = 0; i < 1000; i++) {
      const userId = `user-${i}`
      const variant = assignVariant(userId, experimentId, weightedVariants)
      if (variant) {
        assignments.set(variant.id, (assignments.get(variant.id) ?? 0) + 1)
      }
    }

    // Variant A should have ~80% of assignments
    const total = (assignments.get('a') ?? 0) + (assignments.get('b') ?? 0)
    const aPercent = (assignments.get('a') ?? 0) / total
    expect(aPercent).toBeGreaterThan(0.7)
    expect(aPercent).toBeLessThan(0.9)
  })

  it('should return null for empty variants', () => {
    const result = assignVariant('user-123', 'test', [])
    expect(result).toBeNull()
  })
})

describe('createAssignmentManager', () => {
  let storage: ExperimentStorage
  let manager: ReturnType<typeof createAssignmentManager>

  const experiment: ExperimentDefinition = {
    id: 'signup-test',
    name: 'Signup Flow Test',
    active: true,
    variants: [
      { id: 'control', name: 'Control', weight: 50 },
      { id: 'treatment', name: 'Treatment', weight: 50 },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  beforeEach(() => {
    storage = createMockStorage()
    manager = createAssignmentManager(storage)
  })

  it('should assign a user to a variant', async () => {
    const variant = await manager.assignVariant('user-123', experiment)

    expect(variant).toBeDefined()
    expect(['control', 'treatment']).toContain(variant?.id)
  })

  it('should persist and return the same assignment', async () => {
    const variant1 = await manager.assignVariant('user-123', experiment)
    const variant2 = await manager.assignVariant('user-123', experiment)

    expect(variant1).toEqual(variant2)
  })

  it('should return null for inactive experiments', async () => {
    const inactiveExperiment = { ...experiment, active: false }
    const variant = await manager.assignVariant('user-123', inactiveExperiment)

    expect(variant).toBeNull()
  })

  it('should allow force assignment', async () => {
    const assignment = await manager.forceAssign('user-123', 'signup-test', 'treatment')

    expect(assignment.variantId).toBe('treatment')

    // Should now always return treatment
    const variant = await manager.assignVariant('user-123', experiment)
    expect(variant?.id).toBe('treatment')
  })

  it('should get existing assignment', async () => {
    await manager.assignVariant('user-123', experiment)
    const assignment = await manager.getAssignment('user-123', 'signup-test')

    expect(assignment).toBeDefined()
    expect(assignment?.userId).toBe('user-123')
    expect(assignment?.experimentId).toBe('signup-test')
  })

  it('should remove assignment', async () => {
    await manager.assignVariant('user-123', experiment)
    const removed = await manager.removeAssignment('user-123', 'signup-test')

    expect(removed).toBe(true)

    const assignment = await manager.getAssignment('user-123', 'signup-test')
    expect(assignment).toBeUndefined()
  })

  it('should get all assignments for an experiment', async () => {
    await manager.assignVariant('user-1', experiment)
    await manager.assignVariant('user-2', experiment)
    await manager.assignVariant('user-3', experiment)

    const assignments = await manager.getExperimentAssignments('signup-test')

    expect(assignments).toHaveLength(3)
  })

  it('should clear all assignments for an experiment', async () => {
    await manager.assignVariant('user-1', experiment)
    await manager.assignVariant('user-2', experiment)

    await manager.clearExperimentAssignments('signup-test')

    const assignments = await manager.getExperimentAssignments('signup-test')
    expect(assignments).toHaveLength(0)
  })

  describe('targeting rules', () => {
    it('should include users matching percentage targeting', async () => {
      const experimentWithTargeting: ExperimentDefinition = {
        ...experiment,
        targeting: [{ type: 'percentage', value: 100 }],
      }

      const variant = await manager.assignVariant('user-123', experimentWithTargeting)
      expect(variant).toBeDefined()
    })

    it('should exclude users not matching percentage targeting', async () => {
      const experimentWithTargeting: ExperimentDefinition = {
        ...experiment,
        targeting: [{ type: 'percentage', value: 0 }],
      }

      const variant = await manager.assignVariant('user-123', experimentWithTargeting)
      expect(variant).toBeNull()
    })

    it('should include users in userIds list', async () => {
      const experimentWithTargeting: ExperimentDefinition = {
        ...experiment,
        targeting: [{ type: 'userIds', value: ['user-123', 'user-456'] }],
      }

      const variant = await manager.assignVariant('user-123', experimentWithTargeting)
      expect(variant).toBeDefined()
    })

    it('should exclude users not in userIds list', async () => {
      const experimentWithTargeting: ExperimentDefinition = {
        ...experiment,
        targeting: [{ type: 'userIds', value: ['user-456', 'user-789'] }],
      }

      const variant = await manager.assignVariant('user-123', experimentWithTargeting)
      expect(variant).toBeNull()
    })

    it('should match attribute targeting rules', async () => {
      const experimentWithTargeting: ExperimentDefinition = {
        ...experiment,
        targeting: [{ type: 'attribute', attribute: 'plan', operator: 'equals', value: 'premium' }],
      }

      const variant = await manager.assignVariant('user-123', experimentWithTargeting, { plan: 'premium' })
      expect(variant).toBeDefined()

      const variantFree = await manager.assignVariant('user-456', experimentWithTargeting, { plan: 'free' })
      expect(variantFree).toBeNull()
    })
  })
})
