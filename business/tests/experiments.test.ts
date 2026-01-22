/**
 * Experiments API Tests (A/B Testing)
 *
 * TDD Red-Green-Refactor tests for the ExperimentsAPI.
 *
 * Tests cover:
 * - create() - create experiment with variants
 * - assign() - assign user to variant (deterministic hash)
 * - Consistent assignment - same user always gets same variant
 * - Weight distribution - variants assigned proportionally
 * - get() - get experiment by key
 * - list() - list all experiments
 * - Experiment status lifecycle (draft, running, paused, completed)
 *
 * Uses HTTP fetch API pattern per DO testing conventions.
 *
 * @module business/tests/experiments.test
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import type { Experiment, Variant, ExperimentAssignment } from '../types'
import { generateTestId } from '@dotdo/test-utils/helpers'

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get a fresh Business DO stub for testing
 */
function getStub(name?: string) {
  const testName = name ?? generateTestId('experiments')
  const id = env.BUSINESS.idFromName(testName)
  return env.BUSINESS.get(id)
}

/**
 * Create an experiment via RPC
 */
async function createExperiment(
  stub: DurableObjectStub,
  data: {
    key: string
    name: string
    description?: string
    variants: Array<{ key: string; name: string; weight: number; isControl?: boolean }>
    targetMetric: string
    status?: 'draft' | 'running' | 'paused' | 'completed'
  }
): Promise<Experiment> {
  // Use RPC directly on stub
  const result = await (stub as any).experiments.create(data)
  return result as Experiment
}

/**
 * Assign a user to an experiment via RPC
 */
async function assignUser(
  stub: DurableObjectStub,
  experimentKey: string,
  userId: string
): Promise<Variant> {
  const result = await (stub as any).experiments.assign(experimentKey, userId)
  return result as Variant
}

/**
 * Get an experiment by key via RPC
 */
async function getExperiment(
  stub: DurableObjectStub,
  key: string
): Promise<Experiment | null> {
  const result = await (stub as any).experiments.get(key)
  return result as Experiment | null
}

/**
 * List all experiments via RPC
 */
async function listExperiments(stub: DurableObjectStub): Promise<Experiment[]> {
  const result = await (stub as any).experiments.list()
  return result as Experiment[]
}

/**
 * Update experiment status via RPC
 */
async function updateExperimentStatus(
  stub: DurableObjectStub,
  key: string,
  status: 'draft' | 'running' | 'paused' | 'completed'
): Promise<Experiment> {
  const result = await (stub as any).experiments.updateStatus(key, status)
  return result as Experiment
}

// ============================================================================
// EXPERIMENT CREATION TESTS
// ============================================================================

describe('ExperimentsAPI.create()', () => {
  it('should create an experiment with key and name', async () => {
    const stub = getStub()

    const experiment = await createExperiment(stub, {
      key: 'checkout-button-color',
      name: 'Checkout Button Color Test',
      variants: [
        { key: 'control', name: 'Blue (Control)', weight: 50, isControl: true },
        { key: 'variant-a', name: 'Green', weight: 50 },
      ],
      targetMetric: 'checkout.completed',
    })

    expect(experiment).toBeDefined()
    expect(experiment.key).toBe('checkout-button-color')
    expect(experiment.name).toBe('Checkout Button Color Test')
  })

  it('should create an experiment with multiple variants', async () => {
    const stub = getStub()

    const experiment = await createExperiment(stub, {
      key: 'pricing-page',
      name: 'Pricing Page Variants',
      variants: [
        { key: 'control', name: 'Original', weight: 34, isControl: true },
        { key: 'variant-a', name: 'Simplified', weight: 33 },
        { key: 'variant-b', name: 'Detailed', weight: 33 },
      ],
      targetMetric: 'subscription.started',
    })

    expect(experiment.variants).toHaveLength(3)
    expect(experiment.variants.map((v) => v.key)).toEqual(['control', 'variant-a', 'variant-b'])
  })

  it('should set target metric correctly', async () => {
    const stub = getStub()

    const experiment = await createExperiment(stub, {
      key: 'test-metric',
      name: 'Metric Test',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'variant', name: 'Variant', weight: 50 },
      ],
      targetMetric: 'purchase.completed',
    })

    expect(experiment.targetMetric).toBe('purchase.completed')
  })

  it('should default status to draft', async () => {
    const stub = getStub()

    const experiment = await createExperiment(stub, {
      key: 'status-test',
      name: 'Status Test',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'variant', name: 'Variant', weight: 50 },
      ],
      targetMetric: 'conversion',
    })

    expect(experiment.status).toBe('draft')
  })

  it('should generate unique id on create', async () => {
    const stub = getStub()

    const experiment = await createExperiment(stub, {
      key: 'id-test',
      name: 'ID Test',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'variant', name: 'Variant', weight: 50 },
      ],
      targetMetric: 'conversion',
    })

    expect(experiment.id).toBeDefined()
    expect(typeof experiment.id).toBe('string')
    expect(experiment.id.length).toBeGreaterThan(0)
  })

  it('should set createdAt and updatedAt timestamps', async () => {
    const stub = getStub()
    const beforeCreate = new Date()

    const experiment = await createExperiment(stub, {
      key: 'timestamp-test',
      name: 'Timestamp Test',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'variant', name: 'Variant', weight: 50 },
      ],
      targetMetric: 'conversion',
    })

    expect(experiment.createdAt).toBeDefined()
    expect(experiment.updatedAt).toBeDefined()
    expect(new Date(experiment.createdAt).getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime())
  })

  it('should store variant weights correctly', async () => {
    const stub = getStub()

    const experiment = await createExperiment(stub, {
      key: 'weight-test',
      name: 'Weight Test',
      variants: [
        { key: 'control', name: 'Control', weight: 80, isControl: true },
        { key: 'variant', name: 'Variant', weight: 20 },
      ],
      targetMetric: 'conversion',
    })

    expect(experiment.variants[0].weight).toBe(80)
    expect(experiment.variants[1].weight).toBe(20)
  })

  it('should mark control variant correctly', async () => {
    const stub = getStub()

    const experiment = await createExperiment(stub, {
      key: 'control-test',
      name: 'Control Test',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'variant', name: 'Variant', weight: 50 },
      ],
      targetMetric: 'conversion',
    })

    const controlVariant = experiment.variants.find((v) => v.isControl)
    expect(controlVariant).toBeDefined()
    expect(controlVariant?.key).toBe('control')
  })
})

// ============================================================================
// EXPERIMENT ASSIGNMENT TESTS
// ============================================================================

describe('ExperimentsAPI.assign()', () => {
  it('should assign a user to a variant', async () => {
    const stub = getStub()

    await createExperiment(stub, {
      key: 'assign-test',
      name: 'Assignment Test',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'variant', name: 'Variant', weight: 50 },
      ],
      targetMetric: 'conversion',
      status: 'running',
    })

    const variant = await assignUser(stub, 'assign-test', 'user-123')

    expect(variant).toBeDefined()
    expect(['control', 'variant']).toContain(variant.key)
  })

  it('should return consistent assignment for same user', async () => {
    const stub = getStub()

    await createExperiment(stub, {
      key: 'consistency-test',
      name: 'Consistency Test',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'variant', name: 'Variant', weight: 50 },
      ],
      targetMetric: 'conversion',
      status: 'running',
    })

    const userId = 'consistent-user-456'

    // Assign same user multiple times
    const variant1 = await assignUser(stub, 'consistency-test', userId)
    const variant2 = await assignUser(stub, 'consistency-test', userId)
    const variant3 = await assignUser(stub, 'consistency-test', userId)

    // All assignments should be the same
    expect(variant1.key).toBe(variant2.key)
    expect(variant2.key).toBe(variant3.key)
  })

  it('should assign different users to different variants', async () => {
    const stub = getStub()

    await createExperiment(stub, {
      key: 'distribution-test',
      name: 'Distribution Test',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'variant', name: 'Variant', weight: 50 },
      ],
      targetMetric: 'conversion',
      status: 'running',
    })

    // Assign many users and count distribution
    const assignments: Record<string, number> = { control: 0, variant: 0 }

    for (let i = 0; i < 100; i++) {
      const variant = await assignUser(stub, 'distribution-test', `user-${i}`)
      assignments[variant.key]++
    }

    // With 50/50 split, both should have some assignments
    // (not perfectly 50 each due to hash distribution, but both > 0)
    expect(assignments['control']).toBeGreaterThan(0)
    expect(assignments['variant']).toBeGreaterThan(0)
  })

  it('should respect variant weights in distribution', async () => {
    const stub = getStub()

    await createExperiment(stub, {
      key: 'weighted-test',
      name: 'Weighted Distribution Test',
      variants: [
        { key: 'control', name: 'Control', weight: 90, isControl: true },
        { key: 'variant', name: 'Variant', weight: 10 },
      ],
      targetMetric: 'conversion',
      status: 'running',
    })

    // Assign many users and count distribution
    const assignments: Record<string, number> = { control: 0, variant: 0 }

    for (let i = 0; i < 200; i++) {
      const variant = await assignUser(stub, 'weighted-test', `weighted-user-${i}`)
      assignments[variant.key]++
    }

    // With 90/10 split, control should have significantly more
    expect(assignments['control']).toBeGreaterThan(assignments['variant'])
    // Control should have at least 60% (being generous for hash variance)
    expect(assignments['control'] / 200).toBeGreaterThan(0.6)
  })

  it('should use deterministic hash for assignment', async () => {
    // Create two separate stubs with same experiment
    const stub1 = getStub('hash-test-1')
    const stub2 = getStub('hash-test-2')

    const experimentData = {
      key: 'deterministic-hash-test',
      name: 'Deterministic Hash Test',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'variant', name: 'Variant', weight: 50 },
      ],
      targetMetric: 'conversion',
      status: 'running' as const,
    }

    await createExperiment(stub1, experimentData)
    await createExperiment(stub2, experimentData)

    const userId = 'deterministic-user-789'

    // Same experiment key + user id should produce same variant
    // even across different DO instances
    const variant1 = await assignUser(stub1, 'deterministic-hash-test', userId)
    const variant2 = await assignUser(stub2, 'deterministic-hash-test', userId)

    expect(variant1.key).toBe(variant2.key)
  })
})

// ============================================================================
// EXPERIMENT GET/LIST TESTS
// ============================================================================

describe('ExperimentsAPI.get()', () => {
  it('should get experiment by key', async () => {
    const stub = getStub()

    await createExperiment(stub, {
      key: 'get-test',
      name: 'Get Test',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'variant', name: 'Variant', weight: 50 },
      ],
      targetMetric: 'conversion',
    })

    const experiment = await getExperiment(stub, 'get-test')

    expect(experiment).toBeDefined()
    expect(experiment?.key).toBe('get-test')
    expect(experiment?.name).toBe('Get Test')
  })

  it('should return null for non-existent experiment', async () => {
    const stub = getStub()

    const experiment = await getExperiment(stub, 'non-existent')

    expect(experiment).toBeNull()
  })
})

describe('ExperimentsAPI.list()', () => {
  it('should return empty array when no experiments exist', async () => {
    const stub = getStub()

    const experiments = await listExperiments(stub)

    expect(experiments).toEqual([])
  })

  it('should return all experiments', async () => {
    const stub = getStub()

    await createExperiment(stub, {
      key: 'exp-1',
      name: 'Experiment 1',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'variant', name: 'Variant', weight: 50 },
      ],
      targetMetric: 'metric-1',
    })

    await createExperiment(stub, {
      key: 'exp-2',
      name: 'Experiment 2',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'variant', name: 'Variant', weight: 50 },
      ],
      targetMetric: 'metric-2',
    })

    const experiments = await listExperiments(stub)

    expect(experiments).toHaveLength(2)
    expect(experiments.map((e) => e.key)).toContain('exp-1')
    expect(experiments.map((e) => e.key)).toContain('exp-2')
  })
})

// ============================================================================
// EXPERIMENT STATUS LIFECYCLE TESTS
// ============================================================================

describe('Experiment Status Lifecycle', () => {
  it('should allow transitioning from draft to running', async () => {
    const stub = getStub()

    await createExperiment(stub, {
      key: 'lifecycle-1',
      name: 'Lifecycle Test 1',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'variant', name: 'Variant', weight: 50 },
      ],
      targetMetric: 'conversion',
    })

    const updated = await updateExperimentStatus(stub, 'lifecycle-1', 'running')

    expect(updated.status).toBe('running')
  })

  it('should allow pausing a running experiment', async () => {
    const stub = getStub()

    await createExperiment(stub, {
      key: 'lifecycle-2',
      name: 'Lifecycle Test 2',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'variant', name: 'Variant', weight: 50 },
      ],
      targetMetric: 'conversion',
      status: 'running',
    })

    const updated = await updateExperimentStatus(stub, 'lifecycle-2', 'paused')

    expect(updated.status).toBe('paused')
  })

  it('should allow completing an experiment', async () => {
    const stub = getStub()

    await createExperiment(stub, {
      key: 'lifecycle-3',
      name: 'Lifecycle Test 3',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'variant', name: 'Variant', weight: 50 },
      ],
      targetMetric: 'conversion',
      status: 'running',
    })

    const updated = await updateExperimentStatus(stub, 'lifecycle-3', 'completed')

    expect(updated.status).toBe('completed')
  })

  it('should allow resuming a paused experiment', async () => {
    const stub = getStub()

    await createExperiment(stub, {
      key: 'lifecycle-4',
      name: 'Lifecycle Test 4',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'variant', name: 'Variant', weight: 50 },
      ],
      targetMetric: 'conversion',
      status: 'paused',
    })

    const updated = await updateExperimentStatus(stub, 'lifecycle-4', 'running')

    expect(updated.status).toBe('running')
  })

  it('should update the updatedAt timestamp on status change', async () => {
    const stub = getStub()

    const experiment = await createExperiment(stub, {
      key: 'lifecycle-5',
      name: 'Lifecycle Test 5',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'variant', name: 'Variant', weight: 50 },
      ],
      targetMetric: 'conversion',
    })

    const beforeUpdate = new Date(experiment.updatedAt)

    // Small delay to ensure timestamp difference
    await new Promise((resolve) => setTimeout(resolve, 10))

    const updated = await updateExperimentStatus(stub, 'lifecycle-5', 'running')

    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(beforeUpdate.getTime())
  })
})

// ============================================================================
// ASSIGNMENT PERSISTENCE TESTS
// ============================================================================

describe('Assignment Persistence', () => {
  it('should store assignment in things store', async () => {
    const stub = getStub()

    await createExperiment(stub, {
      key: 'persist-test',
      name: 'Persistence Test',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'variant', name: 'Variant', weight: 50 },
      ],
      targetMetric: 'conversion',
      status: 'running',
    })

    await assignUser(stub, 'persist-test', 'persist-user-1')

    // Get variant again - should retrieve stored assignment
    const variant = await assignUser(stub, 'persist-test', 'persist-user-1')

    expect(variant).toBeDefined()
    expect(['control', 'variant']).toContain(variant.key)
  })

  it('should retrieve existing assignment without recalculating', async () => {
    const stub = getStub()

    await createExperiment(stub, {
      key: 'retrieve-test',
      name: 'Retrieve Test',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'variant', name: 'Variant', weight: 50 },
      ],
      targetMetric: 'conversion',
      status: 'running',
    })

    // First assignment
    const variant1 = await assignUser(stub, 'retrieve-test', 'retrieve-user-1')

    // Second call should return the same stored assignment
    const variant2 = await assignUser(stub, 'retrieve-test', 'retrieve-user-1')

    expect(variant1.key).toBe(variant2.key)
  })
})
