import { describe, it, expect, beforeEach } from 'vitest'
import { createPayloadAdapterHarness } from '../../../src'
import type { PayloadAdapterHarness, PayloadField } from '../../../src'

/**
 * Relationship Mutation Tests
 *
 * These tests verify the adapter's relationship mutation functionality,
 * including direct CRUD operations on relationship edges in the Relationships table.
 *
 * Unlike document relationship fields (which implicitly create relationships),
 * these tests verify the direct relationship mutation API:
 * - createRelationship(): Add a new relationship edge
 * - updateRelationship(): Update relationship metadata
 * - deleteRelationship(): Remove a relationship edge
 * - bulkCreateRelationships(): Add multiple edges atomically
 * - bulkDeleteRelationships(): Remove multiple edges atomically
 *
 * Reference: dotdo-2g0e - A19 RED: Relationship mutation tests
 */

// ============================================================================
// TEST FIXTURES
// ============================================================================

/** Sample Payload fields for users */
const userFields: PayloadField[] = [
  { type: 'text', name: 'name', required: true },
  { type: 'email', name: 'email', required: true },
  { type: 'relationship', name: 'manager', relationTo: 'users' },
  { type: 'relationship', name: 'team', relationTo: 'users', hasMany: true },
]

/** Sample Payload fields for posts */
const postFields: PayloadField[] = [
  { type: 'text', name: 'title', required: true },
  { type: 'text', name: 'slug', required: true },
  { type: 'relationship', name: 'author', relationTo: 'users' },
  { type: 'relationship', name: 'categories', relationTo: 'categories', hasMany: true },
  { type: 'relationship', name: 'tags', relationTo: 'tags', hasMany: true },
]

/** Sample Payload fields for categories */
const categoryFields: PayloadField[] = [
  { type: 'text', name: 'name', required: true },
  { type: 'text', name: 'slug', required: true },
  { type: 'relationship', name: 'parent', relationTo: 'categories' },
]

/** Sample Payload fields for tags */
const tagFields: PayloadField[] = [
  { type: 'text', name: 'name', required: true },
  { type: 'text', name: 'slug', required: true },
]

// ============================================================================
// RELATIONSHIP MUTATION TESTS
// ============================================================================

describe('Relationship Mutations', () => {
  let harness: PayloadAdapterHarness

  beforeEach(() => {
    harness = createPayloadAdapterHarness({
      namespace: 'https://test.do',
      seed: {
        users: [
          { id: 'user-1', name: 'Alice', email: 'alice@test.com' },
          { id: 'user-2', name: 'Bob', email: 'bob@test.com' },
          { id: 'user-3', name: 'Charlie', email: 'charlie@test.com' },
        ],
        posts: [
          { id: 'post-1', title: 'First Post', slug: 'first-post' },
          { id: 'post-2', title: 'Second Post', slug: 'second-post' },
        ],
        categories: [
          { id: 'cat-1', name: 'Technology', slug: 'tech' },
          { id: 'cat-2', name: 'Science', slug: 'science' },
          { id: 'cat-3', name: 'Art', slug: 'art' },
        ],
        tags: [
          { id: 'tag-1', name: 'JavaScript', slug: 'javascript' },
          { id: 'tag-2', name: 'TypeScript', slug: 'typescript' },
          { id: 'tag-3', name: 'Testing', slug: 'testing' },
        ],
      },
    })
  })

  // ============================================================================
  // CREATE RELATIONSHIP
  // ============================================================================

  describe('createRelationship()', () => {
    it('should create a new relationship edge', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.createRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
      })

      expect(result).toBeDefined()
      expect(result.from).toBe('https://test.do/posts/post-1')
      expect(result.to).toBe('https://test.do/users/user-1')
      expect(result.verb).toBe('hasAuthor')
    })

    it('should store relationship in relationships table', async () => {
      const adapter = harness.adapter as any

      await adapter.createRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
      })

      // Verify in relationships store
      const relationships = harness.relationships.list({
        from: 'https://test.do/posts/post-1',
        verb: 'hasAuthor',
      })
      expect(relationships).toHaveLength(1)
      expect(relationships[0].to).toBe('https://test.do/users/user-1')
    })

    it('should support relationship metadata', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.createRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
        data: {
          role: 'primary',
          addedAt: '2026-01-09T12:00:00Z',
          order: 1,
        },
      })

      expect(result.data).toBeDefined()
      expect(result.data.role).toBe('primary')
      expect(result.data.addedAt).toBe('2026-01-09T12:00:00Z')
      expect(result.data.order).toBe(1)
    })

    it('should reject duplicate relationships', async () => {
      const adapter = harness.adapter as any

      // Create first relationship
      await adapter.createRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
      })

      // Attempt to create duplicate
      await expect(
        adapter.createRelationship({
          from: { collection: 'posts', id: 'post-1' },
          to: { collection: 'users', id: 'user-1' },
          verb: 'hasAuthor',
        })
      ).rejects.toThrow(/duplicate|already exists|conflict/i)
    })

    it('should allow same from/to with different verbs', async () => {
      const adapter = harness.adapter as any

      await adapter.createRelationship({
        from: { collection: 'users', id: 'user-1' },
        to: { collection: 'users', id: 'user-2' },
        verb: 'manages',
      })

      // Different verb should be allowed
      const result = await adapter.createRelationship({
        from: { collection: 'users', id: 'user-1' },
        to: { collection: 'users', id: 'user-2' },
        verb: 'mentors',
      })

      expect(result).toBeDefined()
      expect(result.verb).toBe('mentors')

      // Both relationships should exist
      const allRels = harness.relationships.list({
        from: 'https://test.do/users/user-1',
        to: 'https://test.do/users/user-2',
      })
      expect(allRels).toHaveLength(2)
    })

    it('should validate from entity exists', async () => {
      const adapter = harness.adapter as any

      await expect(
        adapter.createRelationship({
          from: { collection: 'posts', id: 'non-existent' },
          to: { collection: 'users', id: 'user-1' },
          verb: 'hasAuthor',
        })
      ).rejects.toThrow(/not found|does not exist/i)
    })

    it('should validate to entity exists', async () => {
      const adapter = harness.adapter as any

      await expect(
        adapter.createRelationship({
          from: { collection: 'posts', id: 'post-1' },
          to: { collection: 'users', id: 'non-existent' },
          verb: 'hasAuthor',
        })
      ).rejects.toThrow(/not found|does not exist/i)
    })

    it('should generate createdAt timestamp', async () => {
      const adapter = harness.adapter as any
      const before = Date.now()

      const result = await adapter.createRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
      })

      const after = Date.now()

      expect(result.createdAt).toBeDefined()
      const createdAt = new Date(result.createdAt).getTime()
      expect(createdAt).toBeGreaterThanOrEqual(before)
      expect(createdAt).toBeLessThanOrEqual(after)
    })

    it('should allow self-referencing relationships', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.createRelationship({
        from: { collection: 'categories', id: 'cat-2' },
        to: { collection: 'categories', id: 'cat-1' },
        verb: 'hasParent',
      })

      expect(result).toBeDefined()
      expect(result.from).toBe('https://test.do/categories/cat-2')
      expect(result.to).toBe('https://test.do/categories/cat-1')
    })
  })

  // ============================================================================
  // UPDATE RELATIONSHIP
  // ============================================================================

  describe('updateRelationship()', () => {
    beforeEach(async () => {
      const adapter = harness.adapter as any

      // Set up initial relationship
      await adapter.createRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
        data: { role: 'primary', order: 1 },
      })
    })

    it('should update relationship metadata', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.updateRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
        data: { role: 'co-author', order: 2 },
      })

      expect(result).toBeDefined()
      expect(result.data.role).toBe('co-author')
      expect(result.data.order).toBe(2)
    })

    it('should merge metadata by default', async () => {
      const adapter = harness.adapter as any

      // Update only the role
      const result = await adapter.updateRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
        data: { role: 'co-author' },
      })

      // Order should be preserved
      expect(result.data.role).toBe('co-author')
      expect(result.data.order).toBe(1)
    })

    it('should update updatedAt timestamp', async () => {
      const adapter = harness.adapter as any

      // Wait a small amount to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10))

      const result = await adapter.updateRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
        data: { role: 'updated' },
      })

      expect(result.updatedAt).toBeDefined()
      // updatedAt should be different from createdAt
      expect(new Date(result.updatedAt).getTime()).toBeGreaterThan(
        new Date(result.createdAt).getTime()
      )
    })

    it('should throw on non-existent relationship', async () => {
      const adapter = harness.adapter as any

      await expect(
        adapter.updateRelationship({
          from: { collection: 'posts', id: 'post-1' },
          to: { collection: 'users', id: 'user-2' }, // Different user
          verb: 'hasAuthor',
          data: { role: 'updated' },
        })
      ).rejects.toThrow(/not found|does not exist/i)
    })

    it('should support replacing metadata entirely', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.updateRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
        data: { newField: 'new value' },
        replace: true,
      })

      // Original fields should be gone
      expect(result.data.role).toBeUndefined()
      expect(result.data.order).toBeUndefined()
      // New field should exist
      expect(result.data.newField).toBe('new value')
    })

    it('should allow setting metadata to null/empty', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.updateRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
        data: null,
        replace: true,
      })

      expect(result.data).toBeNull()
    })
  })

  // ============================================================================
  // DELETE RELATIONSHIP
  // ============================================================================

  describe('deleteRelationship()', () => {
    beforeEach(async () => {
      const adapter = harness.adapter as any

      // Set up relationships
      await adapter.createRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
      })
      await adapter.createRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'categories', id: 'cat-1' },
        verb: 'hasCategory',
      })
    })

    it('should delete specific relationship edge', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.deleteRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
      })

      expect(result).toBeDefined()
      expect(result.deleted).toBe(true)

      // Verify relationship is removed
      const relationships = harness.relationships.list({
        from: 'https://test.do/posts/post-1',
        verb: 'hasAuthor',
      })
      expect(relationships).toHaveLength(0)
    })

    it('should return deleted relationship data', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.deleteRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
      })

      expect(result.from).toBe('https://test.do/posts/post-1')
      expect(result.to).toBe('https://test.do/users/user-1')
      expect(result.verb).toBe('hasAuthor')
    })

    it('should not affect other relationships', async () => {
      const adapter = harness.adapter as any

      await adapter.deleteRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
      })

      // Category relationship should still exist
      const categoryRels = harness.relationships.list({
        from: 'https://test.do/posts/post-1',
        verb: 'hasCategory',
      })
      expect(categoryRels).toHaveLength(1)
    })

    it('should throw on non-existent relationship', async () => {
      const adapter = harness.adapter as any

      await expect(
        adapter.deleteRelationship({
          from: { collection: 'posts', id: 'post-1' },
          to: { collection: 'users', id: 'user-2' }, // Different user
          verb: 'hasAuthor',
        })
      ).rejects.toThrow(/not found|does not exist/i)
    })

    it('should be idempotent with force flag', async () => {
      const adapter = harness.adapter as any

      // Delete first time
      await adapter.deleteRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
      })

      // Delete second time with force should not throw
      const result = await adapter.deleteRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
        force: true,
      })

      expect(result.deleted).toBe(false) // Already deleted
    })
  })

  // ============================================================================
  // BULK CREATE RELATIONSHIPS
  // ============================================================================

  describe('bulkCreateRelationships()', () => {
    it('should create multiple relationships atomically', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.bulkCreateRelationships({
        relationships: [
          {
            from: { collection: 'posts', id: 'post-1' },
            to: { collection: 'categories', id: 'cat-1' },
            verb: 'hasCategory',
          },
          {
            from: { collection: 'posts', id: 'post-1' },
            to: { collection: 'categories', id: 'cat-2' },
            verb: 'hasCategory',
          },
          {
            from: { collection: 'posts', id: 'post-1' },
            to: { collection: 'categories', id: 'cat-3' },
            verb: 'hasCategory',
          },
        ],
      })

      expect(result).toBeDefined()
      expect(result.created).toBe(3)
      expect(result.relationships).toHaveLength(3)

      // Verify all relationships exist
      const relationships = harness.relationships.list({
        from: 'https://test.do/posts/post-1',
        verb: 'hasCategory',
      })
      expect(relationships).toHaveLength(3)
    })

    it('should rollback on failure', async () => {
      const adapter = harness.adapter as any

      // Create a relationship first
      await adapter.createRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'categories', id: 'cat-1' },
        verb: 'hasCategory',
      })

      // Attempt bulk create with duplicate - should fail and rollback
      await expect(
        adapter.bulkCreateRelationships({
          relationships: [
            {
              from: { collection: 'posts', id: 'post-1' },
              to: { collection: 'categories', id: 'cat-2' },
              verb: 'hasCategory',
            },
            {
              // This duplicate should cause failure
              from: { collection: 'posts', id: 'post-1' },
              to: { collection: 'categories', id: 'cat-1' },
              verb: 'hasCategory',
            },
          ],
        })
      ).rejects.toThrow(/duplicate|already exists|conflict/i)

      // cat-2 relationship should NOT exist (rolled back)
      const cat2Rels = harness.relationships.list({
        from: 'https://test.do/posts/post-1',
        to: 'https://test.do/categories/cat-2',
      })
      expect(cat2Rels).toHaveLength(0)
    })

    it('should support skipOnDuplicate option', async () => {
      const adapter = harness.adapter as any

      // Create a relationship first
      await adapter.createRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'categories', id: 'cat-1' },
        verb: 'hasCategory',
      })

      // Bulk create with skipOnDuplicate
      const result = await adapter.bulkCreateRelationships({
        relationships: [
          {
            from: { collection: 'posts', id: 'post-1' },
            to: { collection: 'categories', id: 'cat-1' }, // Duplicate
            verb: 'hasCategory',
          },
          {
            from: { collection: 'posts', id: 'post-1' },
            to: { collection: 'categories', id: 'cat-2' }, // New
            verb: 'hasCategory',
          },
        ],
        skipOnDuplicate: true,
      })

      expect(result.created).toBe(1) // Only cat-2 was created
      expect(result.skipped).toBe(1) // cat-1 was skipped
    })

    it('should handle empty array', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.bulkCreateRelationships({
        relationships: [],
      })

      expect(result.created).toBe(0)
      expect(result.relationships).toHaveLength(0)
    })

    it('should apply metadata to all relationships', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.bulkCreateRelationships({
        relationships: [
          {
            from: { collection: 'posts', id: 'post-1' },
            to: { collection: 'tags', id: 'tag-1' },
            verb: 'hasTag',
            data: { order: 1 },
          },
          {
            from: { collection: 'posts', id: 'post-1' },
            to: { collection: 'tags', id: 'tag-2' },
            verb: 'hasTag',
            data: { order: 2 },
          },
        ],
      })

      expect(result.relationships[0].data.order).toBe(1)
      expect(result.relationships[1].data.order).toBe(2)
    })
  })

  // ============================================================================
  // BULK DELETE RELATIONSHIPS
  // ============================================================================

  describe('bulkDeleteRelationships()', () => {
    beforeEach(async () => {
      const adapter = harness.adapter as any

      // Set up multiple relationships
      await adapter.bulkCreateRelationships({
        relationships: [
          {
            from: { collection: 'posts', id: 'post-1' },
            to: { collection: 'categories', id: 'cat-1' },
            verb: 'hasCategory',
          },
          {
            from: { collection: 'posts', id: 'post-1' },
            to: { collection: 'categories', id: 'cat-2' },
            verb: 'hasCategory',
          },
          {
            from: { collection: 'posts', id: 'post-1' },
            to: { collection: 'categories', id: 'cat-3' },
            verb: 'hasCategory',
          },
          {
            from: { collection: 'posts', id: 'post-1' },
            to: { collection: 'users', id: 'user-1' },
            verb: 'hasAuthor',
          },
        ],
      })
    })

    it('should delete multiple specific relationships', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.bulkDeleteRelationships({
        relationships: [
          {
            from: { collection: 'posts', id: 'post-1' },
            to: { collection: 'categories', id: 'cat-1' },
            verb: 'hasCategory',
          },
          {
            from: { collection: 'posts', id: 'post-1' },
            to: { collection: 'categories', id: 'cat-2' },
            verb: 'hasCategory',
          },
        ],
      })

      expect(result.deleted).toBe(2)

      // cat-3 should still exist
      const remaining = harness.relationships.list({
        from: 'https://test.do/posts/post-1',
        verb: 'hasCategory',
      })
      expect(remaining).toHaveLength(1)
      expect(remaining[0].to).toBe('https://test.do/categories/cat-3')
    })

    it('should delete by verb (all relationships of type)', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.bulkDeleteRelationships({
        from: { collection: 'posts', id: 'post-1' },
        verb: 'hasCategory',
      })

      expect(result.deleted).toBe(3)

      // Author relationship should still exist
      const authorRels = harness.relationships.list({
        from: 'https://test.do/posts/post-1',
        verb: 'hasAuthor',
      })
      expect(authorRels).toHaveLength(1)
    })

    it('should delete all relationships from entity', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.bulkDeleteRelationships({
        from: { collection: 'posts', id: 'post-1' },
      })

      expect(result.deleted).toBe(4)

      // No relationships should remain
      const allRels = harness.relationships.list({
        from: 'https://test.do/posts/post-1',
      })
      expect(allRels).toHaveLength(0)
    })

    it('should handle non-existent relationships gracefully with force', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.bulkDeleteRelationships({
        relationships: [
          {
            from: { collection: 'posts', id: 'post-1' },
            to: { collection: 'categories', id: 'cat-1' },
            verb: 'hasCategory',
          },
          {
            from: { collection: 'posts', id: 'post-1' },
            to: { collection: 'categories', id: 'non-existent' },
            verb: 'hasCategory',
          },
        ],
        force: true,
      })

      expect(result.deleted).toBe(1)
      expect(result.notFound).toBe(1)
    })

    it('should throw on non-existent relationships without force', async () => {
      const adapter = harness.adapter as any

      await expect(
        adapter.bulkDeleteRelationships({
          relationships: [
            {
              from: { collection: 'posts', id: 'post-1' },
              to: { collection: 'categories', id: 'non-existent' },
              verb: 'hasCategory',
            },
          ],
        })
      ).rejects.toThrow(/not found|does not exist/i)
    })
  })

  // ============================================================================
  // QUERY RELATIONSHIPS
  // ============================================================================

  describe('queryRelationships()', () => {
    beforeEach(async () => {
      const adapter = harness.adapter as any

      // Set up relationships with metadata
      await adapter.bulkCreateRelationships({
        relationships: [
          {
            from: { collection: 'posts', id: 'post-1' },
            to: { collection: 'categories', id: 'cat-1' },
            verb: 'hasCategory',
            data: { order: 1, featured: true },
          },
          {
            from: { collection: 'posts', id: 'post-1' },
            to: { collection: 'categories', id: 'cat-2' },
            verb: 'hasCategory',
            data: { order: 2, featured: false },
          },
          {
            from: { collection: 'posts', id: 'post-1' },
            to: { collection: 'users', id: 'user-1' },
            verb: 'hasAuthor',
            data: { role: 'primary' },
          },
          {
            from: { collection: 'posts', id: 'post-2' },
            to: { collection: 'categories', id: 'cat-1' },
            verb: 'hasCategory',
            data: { order: 1 },
          },
        ],
      })
    })

    it('should query relationships by from entity', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.queryRelationships({
        from: { collection: 'posts', id: 'post-1' },
      })

      expect(result.relationships).toHaveLength(3)
    })

    it('should query relationships by verb', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.queryRelationships({
        verb: 'hasCategory',
      })

      expect(result.relationships).toHaveLength(3) // 2 from post-1, 1 from post-2
    })

    it('should query relationships by to entity', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.queryRelationships({
        to: { collection: 'categories', id: 'cat-1' },
      })

      expect(result.relationships).toHaveLength(2) // One from each post
    })

    it('should filter by metadata', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.queryRelationships({
        from: { collection: 'posts', id: 'post-1' },
        verb: 'hasCategory',
        where: {
          'data.featured': { equals: true },
        },
      })

      expect(result.relationships).toHaveLength(1)
      expect(result.relationships[0].to).toBe('https://test.do/categories/cat-1')
    })

    it('should support pagination', async () => {
      const adapter = harness.adapter as any

      const page1 = await adapter.queryRelationships({
        from: { collection: 'posts', id: 'post-1' },
        limit: 2,
        page: 1,
      })

      expect(page1.relationships).toHaveLength(2)
      expect(page1.hasNextPage).toBe(true)
      expect(page1.totalDocs).toBe(3)

      const page2 = await adapter.queryRelationships({
        from: { collection: 'posts', id: 'post-1' },
        limit: 2,
        page: 2,
      })

      expect(page2.relationships).toHaveLength(1)
      expect(page2.hasNextPage).toBe(false)
    })

    it('should support sorting', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.queryRelationships({
        from: { collection: 'posts', id: 'post-1' },
        verb: 'hasCategory',
        sort: '-data.order', // Descending order
      })

      expect(result.relationships).toHaveLength(2)
      expect(result.relationships[0].data.order).toBe(2)
      expect(result.relationships[1].data.order).toBe(1)
    })
  })

  // ============================================================================
  // RELATIONSHIP COUNTS
  // ============================================================================

  describe('countRelationships()', () => {
    beforeEach(async () => {
      const adapter = harness.adapter as any

      await adapter.bulkCreateRelationships({
        relationships: [
          {
            from: { collection: 'posts', id: 'post-1' },
            to: { collection: 'categories', id: 'cat-1' },
            verb: 'hasCategory',
          },
          {
            from: { collection: 'posts', id: 'post-1' },
            to: { collection: 'categories', id: 'cat-2' },
            verb: 'hasCategory',
          },
          {
            from: { collection: 'posts', id: 'post-1' },
            to: { collection: 'users', id: 'user-1' },
            verb: 'hasAuthor',
          },
        ],
      })
    })

    it('should count relationships by from entity', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.countRelationships({
        from: { collection: 'posts', id: 'post-1' },
      })

      expect(result.count).toBe(3)
    })

    it('should count relationships by verb', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.countRelationships({
        from: { collection: 'posts', id: 'post-1' },
        verb: 'hasCategory',
      })

      expect(result.count).toBe(2)
    })

    it('should count relationships to entity (reverse lookup)', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.countRelationships({
        to: { collection: 'categories', id: 'cat-1' },
      })

      expect(result.count).toBe(1)
    })
  })

  // ============================================================================
  // RELATIONSHIP EXISTENCE CHECK
  // ============================================================================

  describe('hasRelationship()', () => {
    beforeEach(async () => {
      const adapter = harness.adapter as any

      await adapter.createRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
      })
    })

    it('should return true for existing relationship', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.hasRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
      })

      expect(result).toBe(true)
    })

    it('should return false for non-existing relationship', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.hasRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-2' },
        verb: 'hasAuthor',
      })

      expect(result).toBe(false)
    })

    it('should return false for wrong verb', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.hasRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasEditor', // Different verb
      })

      expect(result).toBe(false)
    })
  })

  // ============================================================================
  // UPSERT RELATIONSHIP
  // ============================================================================

  describe('upsertRelationship()', () => {
    it('should create relationship if not exists', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.upsertRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
        data: { role: 'primary' },
      })

      expect(result.created).toBe(true)
      expect(result.relationship.data.role).toBe('primary')
    })

    it('should update relationship if exists', async () => {
      const adapter = harness.adapter as any

      // Create first
      await adapter.createRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
        data: { role: 'primary' },
      })

      // Upsert should update
      const result = await adapter.upsertRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
        data: { role: 'co-author' },
      })

      expect(result.created).toBe(false)
      expect(result.relationship.data.role).toBe('co-author')
    })
  })

  // ============================================================================
  // OPERATION TRACKING
  // ============================================================================

  describe('operation tracking', () => {
    it('should track createRelationship operation', async () => {
      const adapter = harness.adapter as any

      await adapter.createRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
      })

      expect(harness.operations).toContainEqual(
        expect.objectContaining({
          type: 'createRelationship',
          collection: 'relationships',
        })
      )
    })

    it('should track deleteRelationship operation', async () => {
      const adapter = harness.adapter as any

      await adapter.createRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
      })

      await adapter.deleteRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
      })

      expect(harness.operations).toContainEqual(
        expect.objectContaining({
          type: 'deleteRelationship',
          collection: 'relationships',
        })
      )
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle special characters in verbs', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.createRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'has:primary-author_v2',
      })

      expect(result.verb).toBe('has:primary-author_v2')
    })

    it('should handle large metadata objects', async () => {
      const adapter = harness.adapter as any

      const largeData: Record<string, unknown> = {}
      for (let i = 0; i < 100; i++) {
        largeData[`field${i}`] = `value${i}`.repeat(100)
      }

      const result = await adapter.createRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'users', id: 'user-1' },
        verb: 'hasAuthor',
        data: largeData,
      })

      expect(result.data.field50).toBe('value50'.repeat(100))
    })

    it('should handle concurrent relationship creation', async () => {
      const adapter = harness.adapter as any

      // Create many relationships concurrently
      const promises = Array.from({ length: 20 }, (_, i) =>
        adapter.createRelationship({
          from: { collection: 'posts', id: 'post-1' },
          to: { collection: 'tags', id: `tag-${i % 3 + 1}` },
          verb: `hasTag${i}`,
        })
      )

      const results = await Promise.all(promises)

      // All should succeed since verbs are different
      expect(results).toHaveLength(20)
      results.forEach((r) => expect(r).toBeDefined())
    })

    it('should preserve relationship order for hasMany', async () => {
      const adapter = harness.adapter as any

      // Create relationships in specific order
      await adapter.createRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'categories', id: 'cat-3' },
        verb: 'hasCategory',
        data: { order: 3 },
      })
      await adapter.createRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'categories', id: 'cat-1' },
        verb: 'hasCategory',
        data: { order: 1 },
      })
      await adapter.createRelationship({
        from: { collection: 'posts', id: 'post-1' },
        to: { collection: 'categories', id: 'cat-2' },
        verb: 'hasCategory',
        data: { order: 2 },
      })

      // Query with sort
      const result = await adapter.queryRelationships({
        from: { collection: 'posts', id: 'post-1' },
        verb: 'hasCategory',
        sort: 'data.order',
      })

      expect(result.relationships[0].to).toBe('https://test.do/categories/cat-1')
      expect(result.relationships[1].to).toBe('https://test.do/categories/cat-2')
      expect(result.relationships[2].to).toBe('https://test.do/categories/cat-3')
    })
  })
})
