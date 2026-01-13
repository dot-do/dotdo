/**
 * Two-Phase Generation System Tests
 *
 * Tests the draft->resolve pattern for schema-driven entity generation:
 * 1. DraftGenerator - creates entities with label placeholders
 * 2. LabelResolver - converts labels to $refs via embedding search
 * 3. BatchResolver - efficient batch label resolution
 *
 * No mocks used - all tests use real implementations with in-memory stores.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  DraftGenerator,
  LabelResolver,
  BatchResolver,
  createMemoryStore,
  createMockEmbeddingProvider,
  cosineSimilarity,
  type DraftEntity,
  type ResolvedEntity,
  type EntityStore,
  type EmbeddingProvider,
  type TypeDefinition,
} from '../two-phase'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('Two-Phase Generation System', () => {
  let store: EntityStore
  let embeddings: EmbeddingProvider
  let idCounter: number

  beforeEach(() => {
    store = createMemoryStore()
    embeddings = createMockEmbeddingProvider()
    idCounter = 0
  })

  const generateTestId = (type: string) => `${type.toLowerCase()}-test-${++idCounter}`

  // ==========================================================================
  // DRAFT GENERATOR TESTS
  // ==========================================================================

  describe('DraftGenerator', () => {
    let generator: DraftGenerator

    beforeEach(() => {
      generator = new DraftGenerator({ generateId: generateTestId })
    })

    describe('createDraft', () => {
      it('creates a draft entity with basic data', () => {
        const draft = generator.createDraft('Project', {
          name: 'E-commerce Platform',
          description: 'An online marketplace',
        })

        expect(draft.$id).toMatch(/^project-test-\d+$/)
        expect(draft.$type).toBe('Project')
        expect(draft.$labels).toEqual({})
        expect(draft.data).toEqual({
          name: 'E-commerce Platform',
          description: 'An online marketplace',
        })
      })

      it('extracts $label from single reference field', () => {
        const draft = generator.createDraft('Project', {
          name: 'My Project',
          owner: { $label: 'John Smith from Engineering' },
        })

        expect(draft.$labels).toEqual({
          owner: 'John Smith from Engineering',
        })
        expect(draft.data).toEqual({
          name: 'My Project',
        })
        expect(draft.data.owner).toBeUndefined()
      })

      it('extracts $labels from array reference fields', () => {
        const draft = generator.createDraft('Project', {
          name: 'Tagged Project',
          tags: [{ $label: 'web' }, { $label: 'commerce' }, { $label: 'startup' }],
        })

        expect(draft.$labels).toEqual({
          tags: ['web', 'commerce', 'startup'],
        })
        expect(draft.data).toEqual({
          name: 'Tagged Project',
        })
      })

      it('handles mixed data with labels and non-labels', () => {
        const draft = generator.createDraft('Task', {
          title: 'Implement feature',
          priority: 1,
          assignee: { $label: 'Alice Developer' },
          subtasks: [{ $label: 'Design' }, { $label: 'Code' }],
          status: 'pending',
        })

        expect(draft.$labels).toEqual({
          assignee: 'Alice Developer',
          subtasks: ['Design', 'Code'],
        })
        expect(draft.data).toEqual({
          title: 'Implement feature',
          priority: 1,
          status: 'pending',
        })
      })

      it('preserves existing ID when provided', () => {
        const draft = generator.createDraft(
          'Project',
          { name: 'Test' },
          'existing-id-123'
        )

        expect(draft.$id).toBe('existing-id-123')
      })

      it('ignores system fields starting with $', () => {
        const draft = generator.createDraft('Project', {
          name: 'Test',
          $version: 1,
          $metadata: { foo: 'bar' },
        })

        expect(draft.data).toEqual({ name: 'Test' })
        expect(draft.$labels).toEqual({})
      })
    })

    describe('createDrafts', () => {
      it('creates multiple drafts in batch', () => {
        const drafts = generator.createDrafts([
          { type: 'Project', data: { name: 'Project 1' } },
          { type: 'Task', data: { title: 'Task 1', assignee: { $label: 'Bob' } } },
          { type: 'User', data: { name: 'Alice' }, id: 'user-alice' },
        ])

        expect(drafts).toHaveLength(3)
        expect(drafts[0]!.$type).toBe('Project')
        expect(drafts[1]!.$labels.assignee).toBe('Bob')
        expect(drafts[2]!.$id).toBe('user-alice')
      })
    })

    describe('parseAIContent', () => {
      const schema: TypeDefinition = {
        fields: {
          owner: { type: 'reference', isReference: true, referenceType: 'User' },
          tags: {
            type: 'array',
            isArray: true,
            isReference: true,
            referenceType: 'Tag',
          },
          name: { type: 'string' },
        },
      }

      it('converts reference fields to $label format using schema', () => {
        const draft = generator.parseAIContent(
          'Project',
          {
            name: 'AI Project',
            owner: 'John Smith',
            tags: ['machine-learning', 'python'],
          },
          schema
        )

        expect(draft.$labels).toEqual({
          owner: 'John Smith',
          tags: ['machine-learning', 'python'],
        })
        expect(draft.data.name).toBe('AI Project')
      })

      it('detects bracket notation [Reference Name] without schema', () => {
        const draft = generator.parseAIContent('Task', {
          title: 'Review code',
          assigned: '[Alice Developer]',
        })

        expect(draft.$labels.assigned).toBe('Alice Developer')
      })

      it('handles null and undefined reference values', () => {
        const draft = generator.parseAIContent(
          'Project',
          {
            name: 'Test',
            owner: null,
          },
          schema
        )

        expect(draft.$labels.owner).toBeUndefined()
        expect(draft.data.name).toBe('Test')
      })
    })
  })

  // ==========================================================================
  // LABEL RESOLVER TESTS
  // ==========================================================================

  describe('LabelResolver', () => {
    let resolver: LabelResolver

    beforeEach(async () => {
      resolver = new LabelResolver({
        threshold: 0.8,
        store,
        embeddings,
        createOnMiss: false,
        generateId: generateTestId,
      })

      // Seed store with some users
      await store.add({ $id: 'user-1', $type: 'User', name: 'John Smith', department: 'Engineering' })
      await store.add({ $id: 'user-2', $type: 'User', name: 'Jane Doe', department: 'Marketing' })
      await store.add({ $id: 'user-3', $type: 'User', name: 'Bob Johnson', department: 'Sales' })
    })

    describe('resolveLabel', () => {
      it('resolves label to existing entity with high similarity', async () => {
        const result = await resolver.resolveLabel('User', 'John Smith Engineering')

        expect(result.resolvedId).toBe('user-1')
        expect(result.similarity).toBeGreaterThan(0.8)
        expect(result.created).toBe(false)
      })

      it('resolves partial match to closest entity', async () => {
        const result = await resolver.resolveLabel('User', 'Jane from Marketing')

        expect(result.resolvedId).toBe('user-2')
        expect(result.created).toBe(false)
      })

      it('returns null when no candidates exist', async () => {
        const result = await resolver.resolveLabel('NonExistentType', 'Any Label')

        expect(result.resolvedId).toBeNull()
        expect(result.similarity).toBe(0)
        expect(result.created).toBe(false)
      })

      it('returns best match below threshold when createOnMiss is false', async () => {
        // Create resolver with very high threshold
        const strictResolver = new LabelResolver({
          threshold: 0.99,
          store,
          embeddings,
          createOnMiss: false,
        })

        const result = await strictResolver.resolveLabel('User', 'Completely Different Person')

        // Should return best match but below threshold
        expect(result.resolvedId).not.toBeNull()
        expect(result.similarity).toBeLessThan(0.99)
        expect(result.created).toBe(false)
      })
    })

    describe('resolveLabel with createOnMiss', () => {
      beforeEach(() => {
        resolver = new LabelResolver({
          threshold: 0.95, // High threshold to trigger creation
          store,
          embeddings,
          createOnMiss: true,
          generateId: generateTestId,
        })
      })

      it('creates new entity when no match found', async () => {
        const result = await resolver.resolveLabel('User', 'Completely New Person')

        expect(result.resolvedId).toMatch(/^user-test-\d+$/)
        expect(result.similarity).toBe(1.0)
        expect(result.created).toBe(true)

        // Verify entity was added to store
        const users = await store.getByType('User')
        const newUser = users.find((u) => u.$id === result.resolvedId)
        expect(newUser).toBeDefined()
        expect(newUser!.name).toBe('Completely New Person')
      })

      it('creates entities when type has no existing candidates', async () => {
        const result = await resolver.resolveLabel('NewType', 'First Entity')

        expect(result.created).toBe(true)
        expect(result.resolvedId).toBeDefined()
      })
    })

    describe('resolveDraft', () => {
      it('resolves all labels in a draft entity', async () => {
        const draft: DraftEntity = {
          $id: 'project-1',
          $type: 'Project',
          $labels: {
            owner: 'John Smith',
            reviewer: 'Jane Doe',
          },
          data: {
            name: 'Test Project',
          },
        }

        const typeMapping = {
          owner: 'User',
          reviewer: 'User',
        }

        const { entity, resolutions } = await resolver.resolveDraft(draft, typeMapping)

        expect(entity.$id).toBe('project-1')
        expect(entity.$type).toBe('Project')
        expect(entity.data.name).toBe('Test Project')
        expect((entity.data.owner as { $ref: string }).$ref).toBe('user-1')
        expect((entity.data.reviewer as { $ref: string }).$ref).toBe('user-2')
        expect(resolutions).toHaveLength(2)
      })

      it('resolves array labels to array of $refs', async () => {
        // Add some tags
        await store.add({ $id: 'tag-web', $type: 'Tag', name: 'web' })
        await store.add({ $id: 'tag-api', $type: 'Tag', name: 'api' })

        const draft: DraftEntity = {
          $id: 'project-1',
          $type: 'Project',
          $labels: {
            tags: ['web', 'api'],
          },
          data: { name: 'Tagged Project' },
        }

        const { entity, resolutions } = await resolver.resolveDraft(draft, { tags: 'Tag' })

        expect(Array.isArray(entity.data.tags)).toBe(true)
        const tags = entity.data.tags as Array<{ $ref: string }>
        expect(tags).toHaveLength(2)
        expect(tags[0]!.$ref).toBe('tag-web')
        expect(tags[1]!.$ref).toBe('tag-api')
        expect(resolutions).toHaveLength(2)
      })

      it('skips fields not in type mapping', async () => {
        const draft: DraftEntity = {
          $id: 'project-1',
          $type: 'Project',
          $labels: {
            owner: 'John Smith',
            unmappedField: 'Some Value',
          },
          data: { name: 'Test' },
        }

        const { entity } = await resolver.resolveDraft(draft, { owner: 'User' })

        expect(entity.data.owner).toBeDefined()
        expect(entity.data.unmappedField).toBeUndefined()
      })
    })
  })

  // ==========================================================================
  // BATCH RESOLVER TESTS
  // ==========================================================================

  describe('BatchResolver', () => {
    let batchResolver: BatchResolver

    beforeEach(async () => {
      batchResolver = new BatchResolver({
        threshold: 0.8,
        store,
        embeddings,
        createOnMiss: true,
        generateId: generateTestId,
      })

      // Seed store with users
      await store.add({ $id: 'user-john', $type: 'User', name: 'John Smith', role: 'Developer' })
      await store.add({ $id: 'user-jane', $type: 'User', name: 'Jane Doe', role: 'Designer' })
      await store.add({ $id: 'user-bob', $type: 'User', name: 'Bob Wilson', role: 'Manager' })
    })

    describe('resolveBatch', () => {
      it('resolves multiple drafts efficiently', async () => {
        const drafts: DraftEntity[] = [
          {
            $id: 'project-1',
            $type: 'Project',
            $labels: { owner: 'John Smith' },
            data: { name: 'Project Alpha' },
          },
          {
            $id: 'project-2',
            $type: 'Project',
            $labels: { owner: 'Jane Doe' },
            data: { name: 'Project Beta' },
          },
        ]

        const result = await batchResolver.resolveBatch(drafts, { owner: 'User' })

        expect(result.resolvedEntities).toHaveLength(2)
        // BatchResolver deduplicates labels - 2 unique labels
        expect(result.stats.totalLabels).toBe(2)
        // Both entities should be resolved (found or created)
        expect(result.stats.resolved + result.stats.created).toBe(2)
      })

      it('deduplicates labels across drafts', async () => {
        const drafts: DraftEntity[] = [
          {
            $id: 'task-1',
            $type: 'Task',
            $labels: { assignee: 'John Smith' },
            data: { title: 'Task 1' },
          },
          {
            $id: 'task-2',
            $type: 'Task',
            $labels: { assignee: 'John Smith' }, // Same label
            data: { title: 'Task 2' },
          },
          {
            $id: 'task-3',
            $type: 'Task',
            $labels: { assignee: 'Jane Doe' },
            data: { title: 'Task 3' },
          },
        ]

        const result = await batchResolver.resolveBatch(drafts, { assignee: 'User' })

        // Both task-1 and task-2 should resolve to same user
        const task1Owner = (result.resolvedEntities[0]!.data.assignee as { $ref: string }).$ref
        const task2Owner = (result.resolvedEntities[1]!.data.assignee as { $ref: string }).$ref

        expect(task1Owner).toBe(task2Owner)
        expect(result.resolvedEntities).toHaveLength(3)
      })

      it('creates relationships during resolution', async () => {
        const drafts: DraftEntity[] = [
          {
            $id: 'project-1',
            $type: 'Project',
            $labels: { owner: 'John Smith', reviewer: 'Jane Doe' },
            data: { name: 'Test Project' },
          },
        ]

        const result = await batchResolver.resolveBatch(drafts, {
          owner: 'User',
          reviewer: 'User',
        })

        expect(result.relationships).toHaveLength(2)
        expect(result.relationships[0]!.from).toBe('project-1')
        expect(result.relationships[0]!.verb).toMatch(/owner|reviewer/)
      })

      it('creates new entities when no match found and createOnMiss is true', async () => {
        const drafts: DraftEntity[] = [
          {
            $id: 'project-1',
            $type: 'Project',
            $labels: { owner: 'Completely New Person' },
            data: { name: 'New Project' },
          },
        ]

        // Use high threshold to force creation
        const strictResolver = new BatchResolver({
          threshold: 0.99,
          store,
          embeddings,
          createOnMiss: true,
          generateId: generateTestId,
        })

        const result = await strictResolver.resolveBatch(drafts, { owner: 'User' })

        expect(result.stats.created).toBe(1)
        expect(result.createdEntities).toHaveLength(1)
        expect(result.createdEntities[0]!.$type).toBe('User')
      })

      it('handles array labels in batch', async () => {
        await store.add({ $id: 'tag-1', $type: 'Tag', name: 'frontend' })
        await store.add({ $id: 'tag-2', $type: 'Tag', name: 'backend' })

        const drafts: DraftEntity[] = [
          {
            $id: 'project-1',
            $type: 'Project',
            $labels: { tags: ['frontend', 'backend'] },
            data: { name: 'Full Stack Project' },
          },
        ]

        const result = await batchResolver.resolveBatch(drafts, { tags: 'Tag' })

        const tags = result.resolvedEntities[0]!.data.tags as Array<{ $ref: string }>
        expect(tags).toHaveLength(2)
        expect(result.relationships.length).toBeGreaterThanOrEqual(2)
      })

      it('returns comprehensive stats', async () => {
        const drafts: DraftEntity[] = [
          {
            $id: 'p1',
            $type: 'Project',
            $labels: { owner: 'John Smith', tags: ['tag1', 'tag2'] },
            data: { name: 'P1' },
          },
        ]

        const result = await batchResolver.resolveBatch(drafts, {
          owner: 'User',
          tags: 'Tag',
        })

        expect(result.stats.totalLabels).toBe(3) // 1 owner + 2 tags
        expect(result.stats.resolved + result.stats.created).toBe(result.stats.totalLabels - result.stats.failed)
      })

      it('handles empty drafts array', async () => {
        const result = await batchResolver.resolveBatch([], { owner: 'User' })

        expect(result.resolvedEntities).toHaveLength(0)
        expect(result.relationships).toHaveLength(0)
        expect(result.stats.totalLabels).toBe(0)
      })

      it('handles drafts with no labels', async () => {
        const drafts: DraftEntity[] = [
          {
            $id: 'project-1',
            $type: 'Project',
            $labels: {},
            data: { name: 'Simple Project' },
          },
        ]

        const result = await batchResolver.resolveBatch(drafts, { owner: 'User' })

        expect(result.resolvedEntities).toHaveLength(1)
        expect(result.resolvedEntities[0]!.data.name).toBe('Simple Project')
        expect(result.relationships).toHaveLength(0)
      })

      it('skips fields not in type mapping', async () => {
        const drafts: DraftEntity[] = [
          {
            $id: 'project-1',
            $type: 'Project',
            $labels: {
              owner: 'John Smith',
              unmappedRef: 'Some Reference',
            },
            data: { name: 'Test' },
          },
        ]

        const result = await batchResolver.resolveBatch(drafts, { owner: 'User' })

        expect(result.stats.totalLabels).toBe(1) // Only owner, not unmappedRef
      })
    })

    describe('batch efficiency', () => {
      it('processes large batches with label deduplication', async () => {
        // Create many drafts with 3 unique labels (deduplication optimization)
        const drafts: DraftEntity[] = Array.from({ length: 50 }, (_, i) => ({
          $id: `task-${i}`,
          $type: 'Task',
          $labels: { assignee: i % 3 === 0 ? 'John Smith' : i % 3 === 1 ? 'Jane Doe' : 'Bob Wilson' },
          data: { title: `Task ${i}` },
        }))

        const result = await batchResolver.resolveBatch(drafts, { assignee: 'User' })

        // All 50 drafts are resolved
        expect(result.resolvedEntities).toHaveLength(50)
        // BatchResolver deduplicates - only 3 unique labels
        expect(result.stats.totalLabels).toBe(3)
        // All 3 unique labels should resolve to existing users
        expect(result.stats.resolved + result.stats.created).toBe(3)
      })

      it('creates relationships for all resolved references', async () => {
        // 50 drafts with same 3 labels = 50 relationships (one per draft)
        const drafts: DraftEntity[] = Array.from({ length: 50 }, (_, i) => ({
          $id: `task-${i}`,
          $type: 'Task',
          $labels: { assignee: i % 3 === 0 ? 'John Smith' : i % 3 === 1 ? 'Jane Doe' : 'Bob Wilson' },
          data: { title: `Task ${i}` },
        }))

        const result = await batchResolver.resolveBatch(drafts, { assignee: 'User' })

        // Each draft gets its relationship, even with deduplicated labels
        expect(result.relationships).toHaveLength(50)
      })
    })
  })

  // ==========================================================================
  // UTILITY FUNCTION TESTS
  // ==========================================================================

  describe('Utility Functions', () => {
    describe('cosineSimilarity', () => {
      it('returns 1 for identical vectors', () => {
        const a = [1, 2, 3, 4]
        const b = [1, 2, 3, 4]

        expect(cosineSimilarity(a, b)).toBeCloseTo(1.0)
      })

      it('returns -1 for opposite vectors', () => {
        const a = [1, 0, 0]
        const b = [-1, 0, 0]

        expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0)
      })

      it('returns 0 for orthogonal vectors', () => {
        const a = [1, 0]
        const b = [0, 1]

        expect(cosineSimilarity(a, b)).toBeCloseTo(0)
      })

      it('throws for mismatched lengths', () => {
        const a = [1, 2, 3]
        const b = [1, 2]

        expect(() => cosineSimilarity(a, b)).toThrow('Vectors must have same length')
      })

      it('returns 0 for zero vectors', () => {
        const a = [0, 0, 0]
        const b = [1, 2, 3]

        expect(cosineSimilarity(a, b)).toBe(0)
      })
    })

    describe('createMemoryStore', () => {
      it('stores and retrieves entities by type', async () => {
        const memStore = createMemoryStore()

        await memStore.add({ $id: 'user-1', $type: 'User', name: 'Alice' })
        await memStore.add({ $id: 'user-2', $type: 'User', name: 'Bob' })
        await memStore.add({ $id: 'task-1', $type: 'Task', title: 'Do work' })

        const users = await memStore.getByType('User')
        const tasks = await memStore.getByType('Task')
        const nonExistent = await memStore.getByType('NonExistent')

        expect(users).toHaveLength(2)
        expect(tasks).toHaveLength(1)
        expect(nonExistent).toHaveLength(0)
      })

      it('overwrites entity with same ID', async () => {
        const memStore = createMemoryStore()

        await memStore.add({ $id: 'user-1', $type: 'User', name: 'Alice' })
        await memStore.add({ $id: 'user-1', $type: 'User', name: 'Alice Updated' })

        const users = await memStore.getByType('User')

        expect(users).toHaveLength(1)
        expect(users[0]!.name).toBe('Alice Updated')
      })
    })

    describe('createMockEmbeddingProvider', () => {
      it('generates consistent embeddings for same text', async () => {
        const provider = createMockEmbeddingProvider()

        const embed1 = await provider.embed('hello world')
        const embed2 = await provider.embed('hello world')

        expect(embed1).toEqual(embed2)
      })

      it('generates different embeddings for different text', async () => {
        const provider = createMockEmbeddingProvider()

        const embed1 = await provider.embed('hello world')
        const embed2 = await provider.embed('goodbye universe')

        expect(embed1).not.toEqual(embed2)
      })

      it('batch embedding returns array of embeddings', async () => {
        const provider = createMockEmbeddingProvider()

        const embeddings = await provider.embedBatch(['text1', 'text2', 'text3'])

        expect(embeddings).toHaveLength(3)
        expect(embeddings[0]).toHaveLength(64)
      })

      it('similar text produces similar embeddings', async () => {
        const provider = createMockEmbeddingProvider()

        const embed1 = await provider.embed('John Smith Engineer')
        const embed2 = await provider.embed('John Smith Engineering')
        const embed3 = await provider.embed('Completely Different Person')

        const sim12 = provider.similarity(embed1, embed2)
        const sim13 = provider.similarity(embed1, embed3)

        // Similar texts should have higher similarity
        expect(sim12).toBeGreaterThan(sim13)
      })
    })
  })

  // ==========================================================================
  // INTEGRATION TESTS
  // ==========================================================================

  describe('Integration: Full Two-Phase Flow', () => {
    it('generates drafts and resolves them end-to-end', async () => {
      // Setup
      await store.add({ $id: 'user-alice', $type: 'User', name: 'Alice Developer', role: 'Engineer' })
      await store.add({ $id: 'user-bob', $type: 'User', name: 'Bob Manager', role: 'Manager' })
      await store.add({ $id: 'tag-urgent', $type: 'Tag', name: 'urgent' })

      const generator = new DraftGenerator({ generateId: generateTestId })
      const batchResolver = new BatchResolver({
        threshold: 0.8,
        store,
        embeddings,
        createOnMiss: true,
        generateId: generateTestId,
      })

      // Phase 1: Draft generation (simulating AI output)
      const aiOutput = [
        {
          type: 'Task',
          data: {
            title: 'Implement authentication',
            description: 'Add OAuth2 support',
            assignee: { $label: 'Alice Developer' },
            reviewer: { $label: 'Bob Manager' },
            tags: [{ $label: 'urgent' }, { $label: 'security' }],
          },
        },
        {
          type: 'Task',
          data: {
            title: 'Write documentation',
            assignee: { $label: 'Alice Developer' },
            tags: [{ $label: 'docs' }],
          },
        },
      ]

      const drafts = generator.createDrafts(aiOutput)

      expect(drafts).toHaveLength(2)
      expect(drafts[0]!.$labels.assignee).toBe('Alice Developer')
      expect(drafts[0]!.$labels.tags).toEqual(['urgent', 'security'])

      // Phase 2: Resolution
      const typeMapping = {
        assignee: 'User',
        reviewer: 'User',
        tags: 'Tag',
      }

      const result = await batchResolver.resolveBatch(drafts, typeMapping)

      // Verify resolution
      expect(result.resolvedEntities).toHaveLength(2)
      expect(result.relationships.length).toBeGreaterThan(0)

      // First task should have Alice as assignee
      const task1 = result.resolvedEntities[0]!
      expect((task1.data.assignee as { $ref: string }).$ref).toBe('user-alice')

      // Tags array should be resolved
      const task1Tags = task1.data.tags as Array<{ $ref: string }>
      expect(task1Tags.some((t) => t.$ref === 'tag-urgent')).toBe(true)

      // 'security' and 'docs' tags should have been created
      expect(result.stats.created).toBeGreaterThanOrEqual(2)
    })

    it('handles AI content with bracket notation', async () => {
      await store.add({ $id: 'user-sarah', $type: 'User', name: 'Sarah Connor', role: 'Lead' })

      const generator = new DraftGenerator({ generateId: generateTestId })
      const resolver = new LabelResolver({
        threshold: 0.8,
        store,
        embeddings,
        createOnMiss: false,
        generateId: generateTestId,
      })

      // Simulate AI generating natural text with references
      const aiContent = {
        summary: 'This task was assigned to [Sarah Connor]',
        priority: 'high',
      }

      const draft = generator.parseAIContent('Task', aiContent)

      expect(draft.$labels.summary).toBe('Sarah Connor')

      // Resolve using single resolver
      const { entity } = await resolver.resolveDraft(draft, { summary: 'User' })

      expect((entity.data.summary as { $ref: string }).$ref).toBe('user-sarah')
    })

    it('preserves data integrity through the pipeline', async () => {
      const generator = new DraftGenerator({ generateId: generateTestId })
      const batchResolver = new BatchResolver({
        threshold: 0.8,
        store,
        embeddings,
        createOnMiss: true,
        generateId: generateTestId,
      })

      const originalData = {
        title: 'Important Task',
        description: 'This is a detailed description with special chars: <>&"\'',
        priority: 1,
        isActive: true,
        metadata: { nested: { deeply: 'value' } },
        assignee: { $label: 'New Assignee' },
      }

      const drafts = generator.createDrafts([{ type: 'Task', data: originalData }])
      const result = await batchResolver.resolveBatch(drafts, { assignee: 'User' })

      const resolved = result.resolvedEntities[0]!

      expect(resolved.data.title).toBe('Important Task')
      expect(resolved.data.description).toBe('This is a detailed description with special chars: <>&"\'')
      expect(resolved.data.priority).toBe(1)
      expect(resolved.data.isActive).toBe(true)
      expect(resolved.data.metadata).toEqual({ nested: { deeply: 'value' } })
    })
  })
})
