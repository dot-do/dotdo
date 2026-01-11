import { describe, it, expect, beforeEach } from 'vitest'
import { createPayloadAdapterHarness } from '../../../src'
import type { PayloadAdapterHarness, PayloadField } from '../../../src'

/**
 * PayloadAdapter.updateOne() and deleteOne() Operation Tests
 *
 * These tests verify the adapter's update and delete operations, including:
 * - Basic document updates with versioning (append-only)
 * - Field updates (text, number, nested, array)
 * - Relationship updates (hasOne, hasMany)
 * - Soft delete behavior
 * - Lifecycle hooks (beforeUpdate, afterUpdate, beforeDelete, afterDelete)
 *
 * Reference: dotdo-0pws - A14 RED: update/delete tests
 */

// ============================================================================
// TEST FIXTURES
// ============================================================================

/** Sample Payload fields for a blog post collection */
const postFields: PayloadField[] = [
  { type: 'text', name: 'title', required: true },
  { type: 'text', name: 'slug', required: true },
  { type: 'richText', name: 'content' },
  { type: 'textarea', name: 'excerpt' },
  { type: 'date', name: 'publishedAt' },
  { type: 'number', name: 'views' },
  { type: 'checkbox', name: 'featured' },
  { type: 'select', name: 'status', options: ['draft', 'published', 'archived'] },
  { type: 'relationship', name: 'author', relationTo: 'users' },
  { type: 'relationship', name: 'categories', relationTo: 'categories', hasMany: true },
  { type: 'upload', name: 'featuredImage', relationTo: 'media' },
  {
    type: 'array',
    name: 'tags',
    fields: [{ type: 'text', name: 'tag' }],
  },
  {
    type: 'group',
    name: 'metadata',
    fields: [
      { type: 'text', name: 'seoTitle' },
      { type: 'textarea', name: 'seoDescription' },
    ],
  },
  {
    type: 'blocks',
    name: 'layout',
  },
]

// ============================================================================
// UPDATE ONE TESTS
// ============================================================================

describe('PayloadAdapter.updateOne()', () => {
  let harness: PayloadAdapterHarness

  beforeEach(() => {
    harness = createPayloadAdapterHarness({
      namespace: 'https://test.do',
      seed: {
        posts: [
          {
            id: 'post-1',
            title: 'Original Title',
            slug: 'original-slug',
            status: 'draft',
            views: 100,
            featured: false,
          },
          {
            id: 'post-2',
            title: 'Second Post',
            slug: 'second-post',
            status: 'published',
            views: 500,
          },
        ],
        users: [
          { id: 'user-1', email: 'john@example.com.ai', name: 'John Doe' },
          { id: 'user-2', email: 'jane@example.com.ai', name: 'Jane Smith' },
        ],
        categories: [
          { id: 'cat-1', name: 'Technology' },
          { id: 'cat-2', name: 'Science' },
          { id: 'cat-3', name: 'Art' },
        ],
      },
    })
  })

  // ============================================================================
  // BASIC UPDATES
  // ============================================================================

  describe('basic updates', () => {
    it('should update document and return updated version', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.updateOne({
        collection: 'posts',
        id: 'post-1',
        data: {
          title: 'Updated Title',
        },
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('post-1')
      expect(result.title).toBe('Updated Title')
    })

    it('should merge data by default', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.updateOne({
        collection: 'posts',
        id: 'post-1',
        data: {
          title: 'Updated Title',
        },
      })

      // Original fields should be preserved
      expect(result.slug).toBe('original-slug')
      expect(result.status).toBe('draft')
      expect(result.views).toBe(100)
    })

    it('should create new version (append-only)', async () => {
      const adapter = harness.adapter as any

      // Get the Thing before update
      const thingIdBefore = `https://test.do/posts/post-1`
      const thingBefore = harness.things.get(thingIdBefore)
      const versionBefore = thingBefore?.$version ?? 0

      await adapter.updateOne({
        collection: 'posts',
        id: 'post-1',
        data: {
          title: 'Updated Title',
        },
      })

      // Thing version should be incremented
      const thingAfter = harness.things.get(thingIdBefore)
      expect(thingAfter?.$version).toBeGreaterThan(versionBefore)
    })

    it('should update updatedAt timestamp', async () => {
      const adapter = harness.adapter as any

      // Get original updatedAt
      const originalDoc = await adapter.findOne({ collection: 'posts', id: 'post-1' })
      const originalUpdatedAt = new Date(originalDoc.updatedAt).getTime()

      // Wait a small amount to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10))

      const result = await adapter.updateOne({
        collection: 'posts',
        id: 'post-1',
        data: {
          title: 'Updated Title',
        },
      })

      const newUpdatedAt = new Date(result.updatedAt).getTime()
      expect(newUpdatedAt).toBeGreaterThan(originalUpdatedAt)
    })

    it('should throw on non-existent document', async () => {
      const adapter = harness.adapter as any

      await expect(
        adapter.updateOne({
          collection: 'posts',
          id: 'non-existent-id',
          data: {
            title: 'Updated',
          },
        })
      ).rejects.toThrow(/not found|does not exist/i)
    })
  })

  // ============================================================================
  // FIELD UPDATES
  // ============================================================================

  describe('field updates', () => {
    it('should update text fields', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.updateOne({
        collection: 'posts',
        id: 'post-1',
        data: {
          title: 'New Title',
          slug: 'new-slug',
        },
      })

      expect(result.title).toBe('New Title')
      expect(result.slug).toBe('new-slug')

      // Verify in Thing store
      const thingId = `https://test.do/posts/post-1`
      const thing = harness.things.get(thingId)
      expect(thing?.name).toBe('New Title')
      expect(thing?.data?.slug).toBe('new-slug')
    })

    it('should update number fields', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.updateOne({
        collection: 'posts',
        id: 'post-1',
        data: {
          views: 999,
        },
      })

      expect(result.views).toBe(999)

      // Verify in Thing store
      const thingId = `https://test.do/posts/post-1`
      const thing = harness.things.get(thingId)
      expect(thing?.data?.views).toBe(999)
    })

    it('should update nested fields', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.updateOne({
        collection: 'posts',
        id: 'post-1',
        data: {
          metadata: {
            seoTitle: 'Updated SEO Title',
            seoDescription: 'Updated SEO Description',
          },
        },
      })

      expect(result.metadata).toEqual({
        seoTitle: 'Updated SEO Title',
        seoDescription: 'Updated SEO Description',
      })

      // Verify in Thing store
      const thingId = `https://test.do/posts/post-1`
      const thing = harness.things.get(thingId)
      expect(thing?.data?.metadata).toEqual({
        seoTitle: 'Updated SEO Title',
        seoDescription: 'Updated SEO Description',
      })
    })

    it('should update array fields', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.updateOne({
        collection: 'posts',
        id: 'post-1',
        data: {
          tags: [{ tag: 'typescript' }, { tag: 'testing' }],
        },
      })

      expect(result.tags).toEqual([{ tag: 'typescript' }, { tag: 'testing' }])

      // Verify in Thing store (should be flattened for simple arrays)
      const thingId = `https://test.do/posts/post-1`
      const thing = harness.things.get(thingId)
      expect(thing?.data?.tags).toEqual(['typescript', 'testing'])
    })

    it('should handle null values', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.updateOne({
        collection: 'posts',
        id: 'post-1',
        data: {
          excerpt: null,
          publishedAt: null,
        },
      })

      expect(result.excerpt).toBeNull()
      expect(result.publishedAt).toBeNull()
    })
  })

  // ============================================================================
  // RELATIONSHIP UPDATES
  // ============================================================================

  describe('relationship updates', () => {
    it('should update hasOne relationships', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.updateOne({
        collection: 'posts',
        id: 'post-1',
        data: {
          author: 'user-2',
        },
      })

      expect(result.author).toBe('user-2')

      // Verify relationship in relationships store
      const thingId = `https://test.do/posts/post-1`
      const relationships = harness.relationships.list({ from: thingId, verb: 'hasAuthor' })
      expect(relationships).toHaveLength(1)
      expect(relationships[0].to).toBe('https://test.do/users/user-2')
    })

    it('should update hasMany relationships', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.updateOne({
        collection: 'posts',
        id: 'post-1',
        data: {
          categories: ['cat-1', 'cat-2', 'cat-3'],
        },
      })

      expect(result.categories).toEqual(['cat-1', 'cat-2', 'cat-3'])

      // Verify relationships in relationships store
      const thingId = `https://test.do/posts/post-1`
      const relationships = harness.relationships.list({ from: thingId, verb: 'hasCategories' })
      expect(relationships).toHaveLength(3)
    })

    it('should remove old relationships on update', async () => {
      const adapter = harness.adapter as any

      // First, set initial author
      await adapter.updateOne({
        collection: 'posts',
        id: 'post-1',
        data: {
          author: 'user-1',
        },
      })

      // Verify initial relationship
      const thingId = `https://test.do/posts/post-1`
      let relationships = harness.relationships.list({ from: thingId, verb: 'hasAuthor' })
      expect(relationships).toHaveLength(1)
      expect(relationships[0].to).toBe('https://test.do/users/user-1')

      // Now update to a different author
      await adapter.updateOne({
        collection: 'posts',
        id: 'post-1',
        data: {
          author: 'user-2',
        },
      })

      // Old relationship should be removed, new one added
      relationships = harness.relationships.list({ from: thingId, verb: 'hasAuthor' })
      expect(relationships).toHaveLength(1)
      expect(relationships[0].to).toBe('https://test.do/users/user-2')
    })
  })

  // ============================================================================
  // HOOKS
  // ============================================================================

  describe('hooks', () => {
    it('should call beforeUpdate hooks', async () => {
      const beforeUpdateCalls: Array<{ collection: string; id: string; data: Record<string, unknown> }> = []

      const harnessWithHooks = createPayloadAdapterHarness({
        namespace: 'https://test.do',
        seed: {
          posts: [{ id: 'post-1', title: 'Original', slug: 'original' }],
        },
      })

      // Register beforeUpdate hook
      const adapter = harnessWithHooks.adapter as any
      adapter.hooks = adapter.hooks || {}
      adapter.hooks.beforeUpdate = async (args: { collection: string; id: string; data: Record<string, unknown> }) => {
        beforeUpdateCalls.push({ collection: args.collection, id: args.id, data: { ...args.data } })
        return args.data
      }

      await adapter.updateOne({
        collection: 'posts',
        id: 'post-1',
        data: {
          title: 'Updated Title',
        },
      })

      expect(beforeUpdateCalls).toHaveLength(1)
      expect(beforeUpdateCalls[0].collection).toBe('posts')
      expect(beforeUpdateCalls[0].id).toBe('post-1')
      expect(beforeUpdateCalls[0].data.title).toBe('Updated Title')
    })

    it('should call afterUpdate hooks', async () => {
      const afterUpdateCalls: Array<{ collection: string; doc: Record<string, unknown> }> = []

      const harnessWithHooks = createPayloadAdapterHarness({
        namespace: 'https://test.do',
        seed: {
          posts: [{ id: 'post-1', title: 'Original', slug: 'original' }],
        },
      })

      const adapter = harnessWithHooks.adapter as any
      adapter.hooks = adapter.hooks || {}
      adapter.hooks.afterUpdate = async (args: { collection: string; doc: Record<string, unknown> }) => {
        afterUpdateCalls.push({ collection: args.collection, doc: { ...args.doc } })
      }

      await adapter.updateOne({
        collection: 'posts',
        id: 'post-1',
        data: {
          title: 'Updated Title',
        },
      })

      expect(afterUpdateCalls).toHaveLength(1)
      expect(afterUpdateCalls[0].collection).toBe('posts')
      expect(afterUpdateCalls[0].doc.title).toBe('Updated Title')
      expect(afterUpdateCalls[0].doc.id).toBe('post-1')
    })
  })

  // ============================================================================
  // OPERATION TRACKING
  // ============================================================================

  describe('operation tracking', () => {
    it('should track update operation in operations list', async () => {
      const adapter = harness.adapter as any

      await adapter.updateOne({
        collection: 'posts',
        id: 'post-1',
        data: {
          title: 'Updated',
        },
      })

      expect(harness.operations).toContainEqual(
        expect.objectContaining({
          type: 'update',
          collection: 'posts',
        })
      )
    })
  })
})

// ============================================================================
// DELETE ONE TESTS
// ============================================================================

describe('PayloadAdapter.deleteOne()', () => {
  let harness: PayloadAdapterHarness

  beforeEach(() => {
    harness = createPayloadAdapterHarness({
      namespace: 'https://test.do',
      seed: {
        posts: [
          {
            id: 'post-1',
            title: 'First Post',
            slug: 'first-post',
            author: 'user-1',
          },
          {
            id: 'post-2',
            title: 'Second Post',
            slug: 'second-post',
          },
        ],
        users: [{ id: 'user-1', email: 'john@example.com.ai' }],
      },
    })
  })

  it('should soft delete document by default', async () => {
    const adapter = harness.adapter as any

    await adapter.deleteOne({
      collection: 'posts',
      id: 'post-1',
    })

    // Document should be marked as deleted but still exist
    const thingId = `https://test.do/posts/post-1`
    const thing = harness.things.get(thingId)

    // Soft delete should set _deleted flag or deletedAt timestamp
    expect(thing?.$deleted || thing?.deletedAt).toBeTruthy()

    // Document should not appear in normal find queries
    const result = await adapter.find({ collection: 'posts' })
    expect(result.docs.find((d: any) => d.id === 'post-1')).toBeUndefined()
  })

  it('should remove relationships on delete', async () => {
    const adapter = harness.adapter as any

    // First, set up a relationship
    await adapter.updateOne({
      collection: 'posts',
      id: 'post-1',
      data: {
        author: 'user-1',
      },
    })

    // Verify relationship exists
    const thingId = `https://test.do/posts/post-1`
    let relationships = harness.relationships.list({ from: thingId })
    expect(relationships.length).toBeGreaterThan(0)

    // Delete the post
    await adapter.deleteOne({
      collection: 'posts',
      id: 'post-1',
    })

    // Relationships should be removed
    relationships = harness.relationships.list({ from: thingId })
    expect(relationships).toHaveLength(0)
  })

  it('should return deleted document', async () => {
    const adapter = harness.adapter as any

    const result = await adapter.deleteOne({
      collection: 'posts',
      id: 'post-1',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('post-1')
    expect(result.title).toBe('First Post')
  })

  it('should throw on non-existent document', async () => {
    const adapter = harness.adapter as any

    await expect(
      adapter.deleteOne({
        collection: 'posts',
        id: 'non-existent-id',
      })
    ).rejects.toThrow(/not found|does not exist/i)
  })

  it('should call beforeDelete hooks', async () => {
    const beforeDeleteCalls: Array<{ collection: string; id: string }> = []

    const harnessWithHooks = createPayloadAdapterHarness({
      namespace: 'https://test.do',
      seed: {
        posts: [{ id: 'post-1', title: 'To Delete', slug: 'to-delete' }],
      },
    })

    const adapter = harnessWithHooks.adapter as any
    adapter.hooks = adapter.hooks || {}
    adapter.hooks.beforeDelete = async (args: { collection: string; id: string }) => {
      beforeDeleteCalls.push({ collection: args.collection, id: args.id })
    }

    await adapter.deleteOne({
      collection: 'posts',
      id: 'post-1',
    })

    expect(beforeDeleteCalls).toHaveLength(1)
    expect(beforeDeleteCalls[0].collection).toBe('posts')
    expect(beforeDeleteCalls[0].id).toBe('post-1')
  })

  it('should call afterDelete hooks', async () => {
    const afterDeleteCalls: Array<{ collection: string; doc: Record<string, unknown> }> = []

    const harnessWithHooks = createPayloadAdapterHarness({
      namespace: 'https://test.do',
      seed: {
        posts: [{ id: 'post-1', title: 'To Delete', slug: 'to-delete' }],
      },
    })

    const adapter = harnessWithHooks.adapter as any
    adapter.hooks = adapter.hooks || {}
    adapter.hooks.afterDelete = async (args: { collection: string; doc: Record<string, unknown> }) => {
      afterDeleteCalls.push({ collection: args.collection, doc: { ...args.doc } })
    }

    await adapter.deleteOne({
      collection: 'posts',
      id: 'post-1',
    })

    expect(afterDeleteCalls).toHaveLength(1)
    expect(afterDeleteCalls[0].collection).toBe('posts')
    expect(afterDeleteCalls[0].doc.id).toBe('post-1')
    expect(afterDeleteCalls[0].doc.title).toBe('To Delete')
  })

  // ============================================================================
  // OPERATION TRACKING
  // ============================================================================

  describe('operation tracking', () => {
    it('should track delete operation in operations list', async () => {
      const adapter = harness.adapter as any

      await adapter.deleteOne({
        collection: 'posts',
        id: 'post-1',
      })

      expect(harness.operations).toContainEqual(
        expect.objectContaining({
          type: 'delete',
          collection: 'posts',
        })
      )
    })
  })
})

// ============================================================================
// DELETE MANY TESTS
// ============================================================================

describe('PayloadAdapter.deleteMany()', () => {
  let harness: PayloadAdapterHarness

  beforeEach(() => {
    harness = createPayloadAdapterHarness({
      namespace: 'https://test.do',
      seed: {
        posts: [
          { id: 'post-1', title: 'Draft Post 1', slug: 'draft-1', status: 'draft' },
          { id: 'post-2', title: 'Draft Post 2', slug: 'draft-2', status: 'draft' },
          { id: 'post-3', title: 'Published Post', slug: 'published', status: 'published' },
          { id: 'post-4', title: 'Draft Post 3', slug: 'draft-3', status: 'draft' },
        ],
      },
    })
  })

  it('should delete matching documents', async () => {
    const adapter = harness.adapter as any

    await adapter.deleteMany({
      collection: 'posts',
      where: {
        status: { equals: 'draft' },
      },
    })

    // Only published post should remain
    const result = await adapter.find({ collection: 'posts' })
    expect(result.docs).toHaveLength(1)
    expect(result.docs[0].status).toBe('published')
  })

  it('should return count of deleted documents', async () => {
    const adapter = harness.adapter as any

    const result = await adapter.deleteMany({
      collection: 'posts',
      where: {
        status: { equals: 'draft' },
      },
    })

    expect(result).toBeDefined()
    expect(result.deletedCount).toBe(3)
  })

  it('should respect where clause', async () => {
    const adapter = harness.adapter as any

    // Delete only posts with status 'published'
    await adapter.deleteMany({
      collection: 'posts',
      where: {
        status: { equals: 'published' },
      },
    })

    // All draft posts should remain
    const result = await adapter.find({ collection: 'posts' })
    expect(result.docs).toHaveLength(3)
    expect(result.docs.every((d: any) => d.status === 'draft')).toBe(true)
  })

  it('should delete all documents when no where clause', async () => {
    const adapter = harness.adapter as any

    await adapter.deleteMany({
      collection: 'posts',
    })

    const result = await adapter.find({ collection: 'posts' })
    expect(result.docs).toHaveLength(0)
  })

  it('should return 0 when no documents match', async () => {
    const adapter = harness.adapter as any

    const result = await adapter.deleteMany({
      collection: 'posts',
      where: {
        status: { equals: 'archived' },
      },
    })

    expect(result.deletedCount).toBe(0)
  })

  // ============================================================================
  // OPERATION TRACKING
  // ============================================================================

  describe('operation tracking', () => {
    it('should track deleteMany operation in operations list', async () => {
      const adapter = harness.adapter as any

      await adapter.deleteMany({
        collection: 'posts',
        where: {
          status: { equals: 'draft' },
        },
      })

      expect(harness.operations).toContainEqual(
        expect.objectContaining({
          type: 'deleteMany',
          collection: 'posts',
        })
      )
    })
  })
})

// ============================================================================
// UPDATE MANY TESTS
// ============================================================================

describe('PayloadAdapter.updateMany()', () => {
  let harness: PayloadAdapterHarness

  beforeEach(() => {
    harness = createPayloadAdapterHarness({
      namespace: 'https://test.do',
      seed: {
        posts: [
          { id: 'post-1', title: 'Draft Post 1', slug: 'draft-1', status: 'draft', featured: false },
          { id: 'post-2', title: 'Draft Post 2', slug: 'draft-2', status: 'draft', featured: false },
          { id: 'post-3', title: 'Published Post', slug: 'published', status: 'published', featured: true },
        ],
      },
    })
  })

  it('should update matching documents', async () => {
    const adapter = harness.adapter as any

    await adapter.updateMany({
      collection: 'posts',
      where: {
        status: { equals: 'draft' },
      },
      data: {
        status: 'published',
      },
    })

    // All posts should now be published
    const result = await adapter.find({ collection: 'posts' })
    expect(result.docs.every((d: any) => d.status === 'published')).toBe(true)
  })

  it('should return count of updated documents', async () => {
    const adapter = harness.adapter as any

    const result = await adapter.updateMany({
      collection: 'posts',
      where: {
        status: { equals: 'draft' },
      },
      data: {
        featured: true,
      },
    })

    expect(result).toBeDefined()
    expect(result.updatedCount).toBe(2)
  })

  it('should respect where clause', async () => {
    const adapter = harness.adapter as any

    // Update only published posts
    await adapter.updateMany({
      collection: 'posts',
      where: {
        status: { equals: 'published' },
      },
      data: {
        featured: false,
      },
    })

    // Published post should have featured set to false
    const publishedPost = await adapter.findOne({ collection: 'posts', id: 'post-3' })
    expect(publishedPost.featured).toBe(false)

    // Draft posts should still have featured as false (unchanged)
    const draftPost = await adapter.findOne({ collection: 'posts', id: 'post-1' })
    expect(draftPost.featured).toBe(false)
  })
})
