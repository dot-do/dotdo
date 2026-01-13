/**
 * Graph-backed Experiment Store Tests
 *
 * Tests for A/B experiment tracking using the graph model (Things and Relationships).
 * Verifies:
 * - Experiment CRUD operations with graph persistence
 * - Assignment tracking via graph Things and Relationships
 * - Conversion tracking via graph Things and Relationships
 * - Integration with experiment lifecycle management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  GraphExperimentStore,
  createGraphExperimentStore,
  EXPERIMENT_TYPE_ID,
  EXPERIMENT_TYPE_NAME,
  EXPERIMENT_ASSIGNMENT_TYPE_ID,
  EXPERIMENT_ASSIGNMENT_TYPE_NAME,
  EXPERIMENT_CONVERSION_TYPE_ID,
  EXPERIMENT_CONVERSION_TYPE_NAME,
  EXPERIMENT_GOAL_TYPE_ID,
  EXPERIMENT_GOAL_TYPE_NAME,
  VERB_ASSIGNED_TO,
  VERB_CONVERTED,
  VERB_HAS_GOAL,
  type AssignmentThingData,
  type ConversionThingData,
} from '../experiment-graph-store'
import { SQLiteGraphStore } from '../../../graph/stores/sqlite'
import type { GraphStore } from '../../../graph/types'

// Mock noun registry for tests
const mockNounRegistry = new Map<number, string>([
  [EXPERIMENT_TYPE_ID, EXPERIMENT_TYPE_NAME],
  [EXPERIMENT_ASSIGNMENT_TYPE_ID, EXPERIMENT_ASSIGNMENT_TYPE_NAME],
  [EXPERIMENT_CONVERSION_TYPE_ID, EXPERIMENT_CONVERSION_TYPE_NAME],
  [EXPERIMENT_GOAL_TYPE_ID, EXPERIMENT_GOAL_TYPE_NAME],
])

// Helper to create mock graph store with noun validation
async function createTestGraphStore(): Promise<SQLiteGraphStore> {
  const store = new SQLiteGraphStore(':memory:')
  await store.initialize()

  // Register noun types for the experiment domain
  // The SQLiteGraphStore validates typeIds against the noun registry
  // We need to pre-register these types
  const db = (store as any).sqlite
  if (db) {
    db.exec(`
      INSERT OR IGNORE INTO graph_things (id, type_id, type_name, data, created_at, updated_at)
      VALUES
        ('noun:${EXPERIMENT_TYPE_ID}', 0, 'Noun', '{"id":${EXPERIMENT_TYPE_ID},"name":"${EXPERIMENT_TYPE_NAME}"}', ${Date.now()}, ${Date.now()}),
        ('noun:${EXPERIMENT_ASSIGNMENT_TYPE_ID}', 0, 'Noun', '{"id":${EXPERIMENT_ASSIGNMENT_TYPE_ID},"name":"${EXPERIMENT_ASSIGNMENT_TYPE_NAME}"}', ${Date.now()}, ${Date.now()}),
        ('noun:${EXPERIMENT_CONVERSION_TYPE_ID}', 0, 'Noun', '{"id":${EXPERIMENT_CONVERSION_TYPE_ID},"name":"${EXPERIMENT_CONVERSION_TYPE_NAME}"}', ${Date.now()}, ${Date.now()}),
        ('noun:${EXPERIMENT_GOAL_TYPE_ID}', 0, 'Noun', '{"id":${EXPERIMENT_GOAL_TYPE_ID},"name":"${EXPERIMENT_GOAL_TYPE_NAME}"}', ${Date.now()}, ${Date.now()})
    `)
  }

  return store
}

describe('GraphExperimentStore', () => {
  let graphStore: SQLiteGraphStore
  let store: GraphExperimentStore

  beforeEach(async () => {
    graphStore = await createTestGraphStore()
    store = createGraphExperimentStore(graphStore)
  })

  afterEach(async () => {
    await graphStore.close()
  })

  // ===========================================================================
  // EXPERIMENT CRUD
  // ===========================================================================

  describe('Experiment CRUD Operations', () => {
    it('creates an experiment stored as a Thing', async () => {
      const experiment = await store.create({
        id: 'pricing-test',
        name: 'Pricing Page Test',
        variants: [
          { key: 'control', name: 'Original', isControl: true },
          { key: 'treatment', name: 'New Design' },
        ],
        goals: [
          { id: 'signup', name: 'Sign Up', eventName: 'user_signed_up' },
        ],
      })

      expect(experiment.id).toBe('pricing-test')
      expect(experiment.name).toBe('Pricing Page Test')
      expect(experiment.status).toBe('draft')
      expect(experiment.variants).toHaveLength(2)
      expect(experiment.goals).toHaveLength(1)

      // Verify Thing was created in graph store
      const thing = await graphStore.getThing('experiment:pricing-test')
      expect(thing).not.toBeNull()
      expect(thing!.typeName).toBe(EXPERIMENT_TYPE_NAME)
    })

    it('creates goal Things for each experiment goal', async () => {
      await store.create({
        id: 'goal-test',
        name: 'Goal Test',
        variants: [
          { key: 'control', name: 'Control' },
          { key: 'treatment', name: 'Treatment' },
        ],
        goals: [
          { id: 'signup', name: 'Sign Up', eventName: 'signup' },
          { id: 'purchase', name: 'Purchase', eventName: 'purchase', type: 'revenue' },
        ],
      })

      // Verify goal Things were created
      const signupGoal = await graphStore.getThing('experiment-goal:goal-test:signup')
      const purchaseGoal = await graphStore.getThing('experiment-goal:goal-test:purchase')

      expect(signupGoal).not.toBeNull()
      expect(signupGoal!.typeName).toBe(EXPERIMENT_GOAL_TYPE_NAME)

      expect(purchaseGoal).not.toBeNull()
      expect(purchaseGoal!.typeName).toBe(EXPERIMENT_GOAL_TYPE_NAME)
    })

    it('creates relationships between experiment and goals', async () => {
      await store.create({
        id: 'rel-test',
        name: 'Relationship Test',
        variants: [
          { key: 'a', name: 'A' },
          { key: 'b', name: 'B' },
        ],
        goals: [
          { id: 'conversion', name: 'Conversion', eventName: 'convert' },
        ],
      })

      // Verify relationship was created
      const rels = await graphStore.queryRelationshipsFrom('experiment:rel-test')
      const goalRel = rels.find(r => r.verb === VERB_HAS_GOAL)

      expect(goalRel).toBeDefined()
      expect(goalRel!.to).toBe('experiment-goal:rel-test:conversion')
    })

    it('retrieves experiment by ID', async () => {
      await store.create({
        id: 'get-test',
        name: 'Get Test',
        variants: [
          { key: 'control', name: 'Control' },
          { key: 'treatment', name: 'Treatment' },
        ],
        goals: [{ id: 'goal', name: 'Goal', eventName: 'event' }],
      })

      const experiment = await store.get('get-test')

      expect(experiment).not.toBeNull()
      expect(experiment!.id).toBe('get-test')
      expect(experiment!.name).toBe('Get Test')
    })

    it('returns null for non-existent experiment', async () => {
      const experiment = await store.get('non-existent')
      expect(experiment).toBeNull()
    })

    it('lists experiments with filters', async () => {
      await store.create({
        id: 'exp-1',
        name: 'Experiment 1',
        owner: 'alice@example.com',
        variants: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }],
        goals: [{ id: 'g', name: 'G', eventName: 'e' }],
      })

      await store.create({
        id: 'exp-2',
        name: 'Experiment 2',
        owner: 'bob@example.com',
        variants: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }],
        goals: [{ id: 'g', name: 'G', eventName: 'e' }],
      })

      await store.start('exp-1')

      // List all (draft only by default when not including completed)
      const drafts = await store.list({ status: 'draft' })
      expect(drafts).toHaveLength(1)
      expect(drafts[0].id).toBe('exp-2')

      // List running
      const running = await store.list({ status: 'running' })
      expect(running).toHaveLength(1)
      expect(running[0].id).toBe('exp-1')

      // List by owner
      const aliceExps = await store.list({ owner: 'alice@example.com' })
      expect(aliceExps.some(e => e.id === 'exp-1')).toBe(true)
    })

    it('updates experiment properties', async () => {
      await store.create({
        id: 'update-test',
        name: 'Original Name',
        variants: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }],
        goals: [{ id: 'g', name: 'G', eventName: 'e' }],
      })

      const updated = await store.update('update-test', {
        name: 'Updated Name',
        description: 'Added description',
      })

      expect(updated.name).toBe('Updated Name')
      expect(updated.description).toBe('Added description')

      // Verify persisted
      const retrieved = await store.get('update-test')
      expect(retrieved!.name).toBe('Updated Name')
    })

    it('deletes experiment and associated goals', async () => {
      await store.create({
        id: 'delete-test',
        name: 'Delete Test',
        variants: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }],
        goals: [
          { id: 'goal1', name: 'Goal 1', eventName: 'e1' },
          { id: 'goal2', name: 'Goal 2', eventName: 'e2' },
        ],
      })

      await store.delete('delete-test')

      // Verify experiment deleted
      const experiment = await store.get('delete-test')
      expect(experiment).toBeNull()

      // Verify goals deleted
      const goal1 = await graphStore.getThing('experiment-goal:delete-test:goal1')
      const goal2 = await graphStore.getThing('experiment-goal:delete-test:goal2')
      expect(goal1).toBeNull()
      expect(goal2).toBeNull()
    })

    it('prevents duplicate experiment IDs', async () => {
      await store.create({
        id: 'duplicate',
        name: 'First',
        variants: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }],
        goals: [{ id: 'g', name: 'G', eventName: 'e' }],
      })

      await expect(
        store.create({
          id: 'duplicate',
          name: 'Second',
          variants: [{ key: 'c', name: 'C' }, { key: 'd', name: 'D' }],
          goals: [{ id: 'g', name: 'G', eventName: 'e' }],
        })
      ).rejects.toThrow("already exists")
    })

    it('validates minimum variant count', async () => {
      await expect(
        store.create({
          id: 'single-variant',
          name: 'Single Variant',
          variants: [{ key: 'only', name: 'Only' }],
          goals: [{ id: 'g', name: 'G', eventName: 'e' }],
        })
      ).rejects.toThrow('at least 2 variants')
    })

    it('validates goal requirement', async () => {
      await expect(
        store.create({
          id: 'no-goals',
          name: 'No Goals',
          variants: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }],
          goals: [],
        })
      ).rejects.toThrow('at least 1 goal')
    })
  })

  // ===========================================================================
  // EXPERIMENT LIFECYCLE
  // ===========================================================================

  describe('Experiment Lifecycle', () => {
    beforeEach(async () => {
      await store.create({
        id: 'lifecycle-test',
        name: 'Lifecycle Test',
        variants: [
          { key: 'control', name: 'Control', isControl: true },
          { key: 'treatment', name: 'Treatment' },
        ],
        goals: [{ id: 'conversion', name: 'Conversion', eventName: 'converted' }],
      })
    })

    it('starts experiment', async () => {
      const experiment = await store.start('lifecycle-test')

      expect(experiment.status).toBe('running')
      expect(experiment.startedAt).toBeInstanceOf(Date)

      // Verify persisted
      const retrieved = await store.get('lifecycle-test')
      expect(retrieved!.status).toBe('running')
    })

    it('pauses running experiment', async () => {
      await store.start('lifecycle-test')
      const experiment = await store.pause('lifecycle-test')

      expect(experiment.status).toBe('paused')
    })

    it('resumes paused experiment', async () => {
      await store.start('lifecycle-test')
      await store.pause('lifecycle-test')
      const experiment = await store.resume('lifecycle-test')

      expect(experiment.status).toBe('running')
    })

    it('completes experiment with winner', async () => {
      await store.start('lifecycle-test')
      const experiment = await store.complete('lifecycle-test', 'treatment')

      expect(experiment.status).toBe('completed')
      expect(experiment.winner).toBe('treatment')
      expect(experiment.endedAt).toBeInstanceOf(Date)
    })

    it('prevents invalid state transitions', async () => {
      // Cannot start a running experiment
      await store.start('lifecycle-test')
      await expect(store.start('lifecycle-test')).rejects.toThrow()

      // Cannot pause a paused experiment
      await store.pause('lifecycle-test')
      await expect(store.pause('lifecycle-test')).rejects.toThrow()

      // Cannot resume a non-paused experiment
      await store.resume('lifecycle-test')
      await expect(store.resume('lifecycle-test')).rejects.toThrow()
    })
  })

  // ===========================================================================
  // VARIANT ALLOCATION
  // ===========================================================================

  describe('Variant Allocation', () => {
    beforeEach(async () => {
      await store.create({
        id: 'allocation-test',
        name: 'Allocation Test',
        variants: [
          { key: 'control', name: 'Control', weight: 50 },
          { key: 'treatment', name: 'Treatment', weight: 50 },
        ],
        goals: [{ id: 'goal', name: 'Goal', eventName: 'event' }],
      })
      await store.start('allocation-test')
    })

    it('allocates users to variants consistently', async () => {
      const result1 = await store.allocate('allocation-test', 'user-123')
      const result2 = await store.allocate('allocation-test', 'user-123')

      expect(result1.variant).toBe(result2.variant)
      expect(result1.inExperiment).toBe(true)
    })

    it('respects traffic allocation', async () => {
      await store.create({
        id: 'traffic-test',
        name: 'Traffic Test',
        trafficAllocation: 10, // Only 10% of users
        variants: [
          { key: 'control', name: 'Control', weight: 50 },
          { key: 'treatment', name: 'Treatment', weight: 50 },
        ],
        goals: [{ id: 'goal', name: 'Goal', eventName: 'event' }],
      })
      await store.start('traffic-test')

      let inExperiment = 0
      const totalUsers = 1000
      for (let i = 0; i < totalUsers; i++) {
        const result = await store.allocate('traffic-test', `user-${i}`)
        if (result.inExperiment) inExperiment++
      }

      // Should be approximately 10% (with some variance)
      const rate = inExperiment / totalUsers
      expect(rate).toBeGreaterThan(0.05)
      expect(rate).toBeLessThan(0.20)
    })

    it('returns not_in_experiment for non-running experiments', async () => {
      await store.create({
        id: 'draft-test',
        name: 'Draft Test',
        variants: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }],
        goals: [{ id: 'goal', name: 'Goal', eventName: 'event' }],
      })

      const result = await store.allocate('draft-test', 'user-123')

      expect(result.inExperiment).toBe(false)
      expect(result.reason).toBe('experiment_not_running')
    })

    it('returns experiment_not_found for missing experiments', async () => {
      const result = await store.allocate('non-existent', 'user-123')

      expect(result.inExperiment).toBe(false)
      expect(result.reason).toBe('experiment_not_found')
    })
  })

  // ===========================================================================
  // ASSIGNMENT TRACKING (Graph-backed)
  // ===========================================================================

  describe('Assignment Tracking', () => {
    beforeEach(async () => {
      await store.create({
        id: 'assignment-test',
        name: 'Assignment Test',
        variants: [
          { key: 'control', name: 'Control', weight: 50 },
          { key: 'treatment', name: 'Treatment', weight: 50 },
        ],
        goals: [{ id: 'goal', name: 'Goal', eventName: 'event' }],
      })
      await store.start('assignment-test')
    })

    it('tracks assignment as a Thing', async () => {
      const assignment = await store.trackAssignment('assignment-test', 'user-123', 'control')

      expect(assignment).not.toBeNull()
      expect(assignment.typeName).toBe(EXPERIMENT_ASSIGNMENT_TYPE_NAME)

      const data = assignment.data as AssignmentThingData
      expect(data.experimentId).toBe('assignment-test')
      expect(data.userId).toBe('user-123')
      expect(data.variant).toBe('control')
    })

    it('creates assignment relationship', async () => {
      await store.trackAssignment('assignment-test', 'user-456', 'treatment')

      const rels = await graphStore.queryRelationshipsFrom('user:user-456')
      const assignmentRel = rels.find(r => r.verb === VERB_ASSIGNED_TO)

      expect(assignmentRel).toBeDefined()
      expect(assignmentRel!.to).toBe('experiment:assignment-test')
      expect((assignmentRel!.data as any).variant).toBe('treatment')
    })

    it('deduplicates assignments', async () => {
      const first = await store.trackAssignment('assignment-test', 'user-789', 'control')
      const second = await store.trackAssignment('assignment-test', 'user-789', 'treatment') // Different variant

      // Should return the original assignment
      expect(second.id).toBe(first.id)
      expect((second.data as AssignmentThingData).variant).toBe('control')
    })

    it('retrieves assignment', async () => {
      await store.trackAssignment('assignment-test', 'user-get', 'treatment')

      const assignment = await store.getAssignment('assignment-test', 'user-get')

      expect(assignment).not.toBeNull()
      expect(assignment!.variant).toBe('treatment')
    })

    it('returns null for non-assigned user', async () => {
      const assignment = await store.getAssignment('assignment-test', 'non-assigned')
      expect(assignment).toBeNull()
    })

    it('tracks context with assignment', async () => {
      await store.trackAssignment('assignment-test', 'user-context', 'control', {
        context: {
          ip: '192.168.1.1',
          userAgent: 'Test Browser',
          country: 'US',
        },
      })

      const assignment = await store.getAssignment('assignment-test', 'user-context')

      expect(assignment!.context).toBeDefined()
      expect(assignment!.context!.ip).toBe('192.168.1.1')
      expect(assignment!.context!.country).toBe('US')
    })

    it('provides assignment summary', async () => {
      // Track multiple users
      for (let i = 0; i < 100; i++) {
        const variant = i % 2 === 0 ? 'control' : 'treatment'
        await store.trackAssignment('assignment-test', `user-${i}`, variant)
      }

      const summary = await store.getAssignmentSummary('assignment-test')

      expect(summary.totalAssignments).toBe(100)
      expect(summary.variantCounts.control).toBe(50)
      expect(summary.variantCounts.treatment).toBe(50)
    })
  })

  // ===========================================================================
  // CONVERSION TRACKING (Graph-backed)
  // ===========================================================================

  describe('Conversion Tracking', () => {
    beforeEach(async () => {
      await store.create({
        id: 'conversion-test',
        name: 'Conversion Test',
        variants: [
          { key: 'control', name: 'Control', weight: 50 },
          { key: 'treatment', name: 'Treatment', weight: 50 },
        ],
        goals: [
          { id: 'signup', name: 'Sign Up', eventName: 'user_signed_up', isPrimary: true },
          { id: 'purchase', name: 'Purchase', eventName: 'purchase_completed', type: 'revenue' },
        ],
      })
      await store.start('conversion-test')

      // Assign users
      await store.trackAssignment('conversion-test', 'user-1', 'control')
      await store.trackAssignment('conversion-test', 'user-2', 'treatment')
      await store.trackAssignment('conversion-test', 'user-3', 'treatment')
    })

    it('tracks conversion as a Thing', async () => {
      const conversion = await store.trackConversion('conversion-test', 'signup', 'user-1')

      expect(conversion).not.toBeNull()
      expect(conversion!.typeName).toBe(EXPERIMENT_CONVERSION_TYPE_NAME)

      const data = conversion!.data as ConversionThingData
      expect(data.experimentId).toBe('conversion-test')
      expect(data.goalId).toBe('signup')
      expect(data.userId).toBe('user-1')
      expect(data.variant).toBe('control')
    })

    it('creates conversion relationship', async () => {
      await store.trackConversion('conversion-test', 'signup', 'user-2')

      const goalThingId = 'experiment-goal:conversion-test:signup'
      const rels = await graphStore.queryRelationshipsTo(goalThingId)
      const conversionRel = rels.find(r => r.verb === VERB_CONVERTED)

      expect(conversionRel).toBeDefined()
      expect(conversionRel!.from).toBe('user:user-2')
      expect((conversionRel!.data as any).variant).toBe('treatment')
    })

    it('tracks conversion value', async () => {
      const conversion = await store.trackConversion('conversion-test', 'purchase', 'user-1', {
        value: 99.99,
      })

      const data = conversion!.data as ConversionThingData
      expect(data.value).toBe(99.99)
    })

    it('deduplicates conversions with key', async () => {
      const first = await store.trackConversion('conversion-test', 'purchase', 'user-1', {
        value: 100,
        deduplicationKey: 'order-123',
      })
      const second = await store.trackConversion('conversion-test', 'purchase', 'user-1', {
        value: 100,
        deduplicationKey: 'order-123',
      })

      expect(first).not.toBeNull()
      expect(second).toBeNull() // Deduplicated
    })

    it('returns null for non-assigned users', async () => {
      const conversion = await store.trackConversion('conversion-test', 'signup', 'non-assigned')
      expect(conversion).toBeNull()
    })

    it('tracks additional properties', async () => {
      const conversion = await store.trackConversion('conversion-test', 'signup', 'user-1', {
        properties: {
          source: 'email',
          campaign: 'winter-sale',
        },
      })

      const data = conversion!.data as ConversionThingData
      expect(data.properties).toBeDefined()
      expect(data.properties!.source).toBe('email')
    })

    it('provides goal conversion metrics', async () => {
      // Track conversions
      await store.trackConversion('conversion-test', 'signup', 'user-1')
      await store.trackConversion('conversion-test', 'signup', 'user-2')
      await store.trackConversion('conversion-test', 'purchase', 'user-2', { value: 50 })
      await store.trackConversion('conversion-test', 'purchase', 'user-3', { value: 75 })

      const signupMetrics = await store.getGoalConversions('conversion-test', 'signup')

      expect(signupMetrics.totalConversions).toBe(2)
      expect(signupMetrics.uniqueUsers).toBe(2)
      expect(signupMetrics.variantConversions.control.count).toBe(1)
      expect(signupMetrics.variantConversions.treatment.count).toBe(1)

      const purchaseMetrics = await store.getGoalConversions('conversion-test', 'purchase')

      expect(purchaseMetrics.totalConversions).toBe(2)
      expect(purchaseMetrics.variantConversions.treatment.totalValue).toBe(125)
    })
  })

  // ===========================================================================
  // INTEGRATION TESTS
  // ===========================================================================

  describe('End-to-End Integration', () => {
    it('runs complete experiment workflow with graph persistence', async () => {
      // 1. Create experiment
      const experiment = await store.create({
        id: 'e2e-test',
        name: 'E2E Test',
        hypothesis: 'Treatment increases signups',
        variants: [
          { key: 'control', name: 'Control', weight: 50, isControl: true },
          { key: 'treatment', name: 'Treatment', weight: 50 },
        ],
        goals: [
          { id: 'signup', name: 'Sign Up', eventName: 'signup', isPrimary: true },
        ],
        minSampleSize: 10,
      })

      expect(experiment.status).toBe('draft')

      // 2. Start experiment
      await store.start('e2e-test')

      // 3. Allocate and track users
      const users: Array<{ id: string; variant: string }> = []
      for (let i = 0; i < 50; i++) {
        const userId = `user-${i}`
        const allocation = await store.allocate('e2e-test', userId)

        if (allocation.inExperiment && allocation.variant) {
          await store.trackAssignment('e2e-test', userId, allocation.variant)
          users.push({ id: userId, variant: allocation.variant })
        }
      }

      expect(users.length).toBe(50)

      // 4. Simulate conversions (treatment converts better)
      for (const user of users) {
        const convertChance = user.variant === 'treatment' ? 0.30 : 0.10
        if (Math.random() < convertChance) {
          await store.trackConversion('e2e-test', 'signup', user.id)
        }
      }

      // 5. Get metrics
      const summary = await store.getAssignmentSummary('e2e-test')
      const conversions = await store.getGoalConversions('e2e-test', 'signup')

      expect(summary.totalAssignments).toBe(50)
      expect(conversions.totalConversions).toBeGreaterThan(0)

      // Verify data is persisted in graph
      const experimentThing = await graphStore.getThing('experiment:e2e-test')
      expect(experimentThing).not.toBeNull()

      const assignments = await graphStore.getThingsByType({
        typeId: EXPERIMENT_ASSIGNMENT_TYPE_ID,
      })
      expect(assignments.length).toBe(50)

      // 6. Complete experiment
      const completed = await store.complete('e2e-test', 'treatment')
      expect(completed.status).toBe('completed')
      expect(completed.winner).toBe('treatment')
    })

    it('persists data across store instances', async () => {
      // Create experiment with first store instance
      await store.create({
        id: 'persistence-test',
        name: 'Persistence Test',
        variants: [
          { key: 'a', name: 'A' },
          { key: 'b', name: 'B' },
        ],
        goals: [{ id: 'goal', name: 'Goal', eventName: 'event' }],
      })

      await store.start('persistence-test')
      await store.trackAssignment('persistence-test', 'user-persist', 'a')

      // Create new store instance with same graph store
      const store2 = createGraphExperimentStore(graphStore)

      // Verify data is available
      const experiment = await store2.get('persistence-test')
      expect(experiment).not.toBeNull()
      expect(experiment!.status).toBe('running')

      const assignment = await store2.getAssignment('persistence-test', 'user-persist')
      expect(assignment).not.toBeNull()
      expect(assignment!.variant).toBe('a')
    })
  })
})
