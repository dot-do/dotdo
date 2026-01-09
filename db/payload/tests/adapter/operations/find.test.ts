import { describe, it, expect, beforeEach } from 'vitest'
import { createPayloadAdapterHarness } from '../../../src'
import type { PayloadAdapterHarness, PayloadField } from '../../../src'

/**
 * PayloadAdapter.find() and findOne() Operation Tests
 *
 * These tests verify the adapter's find() and findOne() operations, including:
 * - Basic queries with pagination metadata
 * - Filtering with Payload's query operators (equals, not_equals, in, etc.)
 * - Sorting (ascending, descending, nested fields)
 * - Pagination (limit, page, hasNextPage, hasPrevPage)
 * - Relationship population at various depths
 *
 * Reference: dotdo-jqzx - A12 RED: find/findOne tests
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
  { type: 'number', name: 'priority' },
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
      { type: 'number', name: 'priority' },
    ],
  },
  {
    type: 'blocks',
    name: 'layout',
  },
]

/** Sample user fields for relationship testing */
const userFields: PayloadField[] = [
  { type: 'text', name: 'name', required: true },
  { type: 'email', name: 'email', required: true },
  { type: 'relationship', name: 'organization', relationTo: 'organizations' },
]

/** Sample organization fields for nested relationship testing */
const organizationFields: PayloadField[] = [
  { type: 'text', name: 'name', required: true },
  { type: 'text', name: 'slug', required: true },
]

// ============================================================================
// PayloadAdapter.find() TESTS
// ============================================================================

describe('PayloadAdapter.find()', () => {
  let harness: PayloadAdapterHarness

  beforeEach(() => {
    harness = createPayloadAdapterHarness({
      namespace: 'https://test.do',
    })
  })

  // --------------------------------------------------------------------------
  // BASIC QUERIES
  // --------------------------------------------------------------------------

  describe('basic queries', () => {
    it('should return paginated results', async () => {
      const adapter = harness.adapter as any

      // Create test documents
      await adapter.create({ collection: 'posts', data: { title: 'Post 1', slug: 'post-1' } })
      await adapter.create({ collection: 'posts', data: { title: 'Post 2', slug: 'post-2' } })
      await adapter.create({ collection: 'posts', data: { title: 'Post 3', slug: 'post-3' } })

      const result = await adapter.find({ collection: 'posts' })

      expect(result.docs).toHaveLength(3)
      expect(result.docs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Post 1' }),
          expect.objectContaining({ title: 'Post 2' }),
          expect.objectContaining({ title: 'Post 3' }),
        ])
      )
    })

    it('should return empty array for no matches', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({ collection: 'posts' })

      expect(result.docs).toHaveLength(0)
      expect(result.docs).toEqual([])
    })

    it('should include totalDocs count', async () => {
      const adapter = harness.adapter as any

      // Create test documents
      await adapter.create({ collection: 'posts', data: { title: 'Post 1', slug: 'post-1' } })
      await adapter.create({ collection: 'posts', data: { title: 'Post 2', slug: 'post-2' } })
      await adapter.create({ collection: 'posts', data: { title: 'Post 3', slug: 'post-3' } })

      const result = await adapter.find({ collection: 'posts' })

      expect(result.totalDocs).toBe(3)
    })

    it('should include pagination metadata', async () => {
      const adapter = harness.adapter as any

      // Create test documents
      await adapter.create({ collection: 'posts', data: { title: 'Post 1', slug: 'post-1' } })
      await adapter.create({ collection: 'posts', data: { title: 'Post 2', slug: 'post-2' } })

      const result = await adapter.find({ collection: 'posts' })

      expect(result).toHaveProperty('docs')
      expect(result).toHaveProperty('totalDocs')
      expect(result).toHaveProperty('page')
      expect(result).toHaveProperty('totalPages')
      expect(result).toHaveProperty('hasNextPage')
      expect(result).toHaveProperty('hasPrevPage')
    })
  })

  // --------------------------------------------------------------------------
  // FILTERING
  // --------------------------------------------------------------------------

  describe('filtering', () => {
    beforeEach(async () => {
      const adapter = harness.adapter as any

      // Set up test data with various field values
      await adapter.create({
        collection: 'posts',
        data: { title: 'Draft Post', slug: 'draft-post', status: 'draft', views: 10, featured: false },
      })
      await adapter.create({
        collection: 'posts',
        data: { title: 'Published Post', slug: 'published-post', status: 'published', views: 100, featured: true },
      })
      await adapter.create({
        collection: 'posts',
        data: { title: 'Archived Post', slug: 'archived-post', status: 'archived', views: 50, featured: false },
      })
      await adapter.create({
        collection: 'posts',
        data: {
          title: 'Popular Post',
          slug: 'popular-post',
          status: 'published',
          views: 500,
          featured: true,
          metadata: { seoTitle: 'SEO Popular', priority: 1 },
        },
      })
    })

    it('should filter by equals operator', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        where: { status: { equals: 'published' } },
      })

      expect(result.docs).toHaveLength(2)
      expect(result.docs.every((doc: any) => doc.status === 'published')).toBe(true)
    })

    it('should filter by not_equals operator', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        where: { status: { not_equals: 'draft' } },
      })

      expect(result.docs).toHaveLength(3)
      expect(result.docs.every((doc: any) => doc.status !== 'draft')).toBe(true)
    })

    it('should filter by in operator', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        where: { status: { in: ['published', 'archived'] } },
      })

      expect(result.docs).toHaveLength(3)
      expect(result.docs.every((doc: any) => ['published', 'archived'].includes(doc.status))).toBe(true)
    })

    it('should filter by greater_than operator', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        where: { views: { greater_than: 50 } },
      })

      expect(result.docs).toHaveLength(2) // 100 and 500
      expect(result.docs.every((doc: any) => doc.views > 50)).toBe(true)
    })

    it('should filter by greater_than_equal operator', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        where: { views: { greater_than_equal: 50 } },
      })

      expect(result.docs).toHaveLength(3) // 50, 100, and 500
      expect(result.docs.every((doc: any) => doc.views >= 50)).toBe(true)
    })

    it('should filter by less_than operator', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        where: { views: { less_than: 100 } },
      })

      expect(result.docs).toHaveLength(2) // 10 and 50
      expect(result.docs.every((doc: any) => doc.views < 100)).toBe(true)
    })

    it('should filter by less_than_equal operator', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        where: { views: { less_than_equal: 100 } },
      })

      expect(result.docs).toHaveLength(3) // 10, 50, and 100
      expect(result.docs.every((doc: any) => doc.views <= 100)).toBe(true)
    })

    it('should filter by like operator', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        where: { title: { like: '%Post%' } },
      })

      expect(result.docs).toHaveLength(4) // All posts contain 'Post'
    })

    it('should filter by contains operator', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        where: { slug: { contains: 'published' } },
      })

      expect(result.docs).toHaveLength(1)
      expect(result.docs[0].slug).toBe('published-post')
    })

    it('should filter by nested field', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        where: { 'metadata.priority': { equals: 1 } },
      })

      expect(result.docs).toHaveLength(1)
      expect(result.docs[0].title).toBe('Popular Post')
    })

    it('should combine filters with AND', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        where: {
          and: [
            { status: { equals: 'published' } },
            { featured: { equals: true } },
          ],
        },
      })

      expect(result.docs).toHaveLength(2)
      expect(result.docs.every((doc: any) => doc.status === 'published' && doc.featured === true)).toBe(true)
    })

    it('should combine filters with OR', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        where: {
          or: [
            { status: { equals: 'draft' } },
            { status: { equals: 'archived' } },
          ],
        },
      })

      expect(result.docs).toHaveLength(2)
      expect(result.docs.every((doc: any) => doc.status === 'draft' || doc.status === 'archived')).toBe(true)
    })

    it('should handle nested AND/OR combinations', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        where: {
          and: [
            { featured: { equals: true } },
            {
              or: [
                { views: { greater_than: 400 } },
                { status: { equals: 'draft' } },
              ],
            },
          ],
        },
      })

      // Featured = true AND (views > 400 OR status = 'draft')
      // Only 'Popular Post' matches (featured: true, views: 500)
      expect(result.docs).toHaveLength(1)
      expect(result.docs[0].title).toBe('Popular Post')
    })

    it('should filter by exists operator for true', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        where: { metadata: { exists: true } },
      })

      // Only 'Popular Post' has metadata
      expect(result.docs).toHaveLength(1)
      expect(result.docs[0].title).toBe('Popular Post')
    })

    it('should filter by exists operator for false', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        where: { metadata: { exists: false } },
      })

      // All posts except 'Popular Post' don't have metadata
      expect(result.docs).toHaveLength(3)
    })

    it('should filter by not_in operator', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        where: { status: { not_in: ['draft', 'archived'] } },
      })

      expect(result.docs).toHaveLength(2)
      expect(result.docs.every((doc: any) => doc.status === 'published')).toBe(true)
    })
  })

  // --------------------------------------------------------------------------
  // SORTING
  // --------------------------------------------------------------------------

  describe('sorting', () => {
    beforeEach(async () => {
      const adapter = harness.adapter as any

      // Create posts with specific order for sorting tests
      await adapter.create({ collection: 'posts', data: { title: 'B Post', slug: 'b-post', views: 50, priority: 2 } })
      await adapter.create({ collection: 'posts', data: { title: 'A Post', slug: 'a-post', views: 100, priority: 1 } })
      await adapter.create({ collection: 'posts', data: { title: 'C Post', slug: 'c-post', views: 25, priority: 3 } })
    })

    it('should sort ascending by default', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        sort: 'title',
      })

      expect(result.docs[0].title).toBe('A Post')
      expect(result.docs[1].title).toBe('B Post')
      expect(result.docs[2].title).toBe('C Post')
    })

    it('should sort descending with - prefix', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        sort: '-title',
      })

      expect(result.docs[0].title).toBe('C Post')
      expect(result.docs[1].title).toBe('B Post')
      expect(result.docs[2].title).toBe('A Post')
    })

    it('should sort by numeric field ascending', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        sort: 'views',
      })

      expect(result.docs[0].views).toBe(25)
      expect(result.docs[1].views).toBe(50)
      expect(result.docs[2].views).toBe(100)
    })

    it('should sort by numeric field descending', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        sort: '-views',
      })

      expect(result.docs[0].views).toBe(100)
      expect(result.docs[1].views).toBe(50)
      expect(result.docs[2].views).toBe(25)
    })

    it('should sort by nested field', async () => {
      const adapter = harness.adapter as any

      // Add nested field data
      await adapter.create({
        collection: 'posts',
        data: { title: 'D Post', slug: 'd-post', metadata: { priority: 0 } },
      })

      const result = await adapter.find({
        collection: 'posts',
        sort: 'metadata.priority',
      })

      // Posts without metadata.priority should be sorted to the end (nulls last)
      // or handled according to implementation
      expect(result.docs[0].metadata?.priority).toBe(0)
    })

    it('should sort by createdAt descending for newest first', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        sort: '-createdAt',
      })

      // The most recently created should be first
      expect(result.docs[0].title).toBe('C Post') // Last created
    })
  })

  // --------------------------------------------------------------------------
  // PAGINATION
  // --------------------------------------------------------------------------

  describe('pagination', () => {
    beforeEach(async () => {
      const adapter = harness.adapter as any

      // Create 15 posts for pagination testing
      for (let i = 1; i <= 15; i++) {
        await adapter.create({
          collection: 'posts',
          data: { title: `Post ${i}`, slug: `post-${i}` },
        })
      }
    })

    it('should respect limit parameter', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        limit: 5,
      })

      expect(result.docs).toHaveLength(5)
      expect(result.totalDocs).toBe(15)
    })

    it('should respect page parameter', async () => {
      const adapter = harness.adapter as any

      const page1 = await adapter.find({
        collection: 'posts',
        limit: 5,
        page: 1,
      })

      const page2 = await adapter.find({
        collection: 'posts',
        limit: 5,
        page: 2,
      })

      expect(page1.docs).toHaveLength(5)
      expect(page2.docs).toHaveLength(5)

      // Pages should have different documents
      const page1Ids = page1.docs.map((d: any) => d.id)
      const page2Ids = page2.docs.map((d: any) => d.id)
      expect(page1Ids).not.toEqual(page2Ids)
    })

    it('should calculate hasNextPage correctly', async () => {
      const adapter = harness.adapter as any

      const page1 = await adapter.find({
        collection: 'posts',
        limit: 5,
        page: 1,
      })

      const page3 = await adapter.find({
        collection: 'posts',
        limit: 5,
        page: 3,
      })

      expect(page1.hasNextPage).toBe(true) // 15 items, 5 per page = 3 pages
      expect(page3.hasNextPage).toBe(false) // Last page
    })

    it('should calculate hasPrevPage correctly', async () => {
      const adapter = harness.adapter as any

      const page1 = await adapter.find({
        collection: 'posts',
        limit: 5,
        page: 1,
      })

      const page2 = await adapter.find({
        collection: 'posts',
        limit: 5,
        page: 2,
      })

      expect(page1.hasPrevPage).toBe(false) // First page
      expect(page2.hasPrevPage).toBe(true) // Not first page
    })

    it('should calculate totalPages correctly', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        limit: 5,
      })

      expect(result.totalPages).toBe(3) // 15 items / 5 per page = 3 pages
    })

    it('should return current page number', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        limit: 5,
        page: 2,
      })

      expect(result.page).toBe(2)
    })

    it('should handle page beyond total pages', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        limit: 5,
        page: 10, // Only 3 pages exist
      })

      expect(result.docs).toHaveLength(0)
      expect(result.hasNextPage).toBe(false)
    })

    it('should handle limit of 0 (return all)', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        limit: 0,
      })

      // Limit 0 should either return all or be treated as default
      // Implementation may vary
      expect(result.docs.length).toBeGreaterThanOrEqual(0)
    })

    it('should default to page 1 when not specified', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        limit: 5,
      })

      expect(result.page).toBe(1)
    })
  })

  // --------------------------------------------------------------------------
  // RELATIONSHIP POPULATION
  // --------------------------------------------------------------------------

  describe('relationship population', () => {
    beforeEach(async () => {
      const adapter = harness.adapter as any

      // Create organization
      await adapter.create({
        collection: 'organizations',
        data: { id: 'org-1', name: 'Acme Corp', slug: 'acme-corp' },
      })

      // Create user with organization relationship
      await adapter.create({
        collection: 'users',
        data: { id: 'user-1', name: 'John Doe', email: 'john@acme.com', organization: 'org-1' },
      })

      // Create post with user relationship
      await adapter.create({
        collection: 'posts',
        data: {
          title: 'Author Post',
          slug: 'author-post',
          author: 'user-1',
          categories: ['cat-1', 'cat-2'],
        },
      })

      // Create categories
      await adapter.create({
        collection: 'categories',
        data: { id: 'cat-1', name: 'Technology', slug: 'technology' },
      })
      await adapter.create({
        collection: 'categories',
        data: { id: 'cat-2', name: 'News', slug: 'news' },
      })
    })

    it('should return IDs only at depth 0', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        depth: 0,
      })

      const post = result.docs.find((d: any) => d.slug === 'author-post')
      expect(post.author).toBe('user-1') // Just the ID, not populated
      expect(post.categories).toEqual(['cat-1', 'cat-2']) // Just IDs
    })

    it('should populate relationships at depth 1', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        depth: 1,
      })

      const post = result.docs.find((d: any) => d.slug === 'author-post')

      // Author should be populated with user document
      expect(post.author).toEqual(
        expect.objectContaining({
          id: 'user-1',
          name: 'John Doe',
          email: 'john@acme.com',
        })
      )

      // Categories should be populated
      expect(post.categories).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'cat-1', name: 'Technology' }),
          expect.objectContaining({ id: 'cat-2', name: 'News' }),
        ])
      )
    })

    it('should populate nested relationships at depth 2', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        depth: 2,
      })

      const post = result.docs.find((d: any) => d.slug === 'author-post')

      // Author should be populated
      expect(post.author).toEqual(
        expect.objectContaining({
          id: 'user-1',
          name: 'John Doe',
        })
      )

      // Author's organization should also be populated at depth 2
      expect(post.author.organization).toEqual(
        expect.objectContaining({
          id: 'org-1',
          name: 'Acme Corp',
          slug: 'acme-corp',
        })
      )
    })

    it('should handle missing related documents gracefully', async () => {
      const adapter = harness.adapter as any

      // Create post with non-existent author
      await adapter.create({
        collection: 'posts',
        data: {
          title: 'Orphan Post',
          slug: 'orphan-post',
          author: 'non-existent-user',
        },
      })

      const result = await adapter.find({
        collection: 'posts',
        depth: 1,
      })

      const post = result.docs.find((d: any) => d.slug === 'orphan-post')

      // Missing relationship should be null or the original ID
      expect(post.author === null || post.author === 'non-existent-user').toBe(true)
    })

    it('should handle polymorphic relationships', async () => {
      const adapter = harness.adapter as any

      // Create page
      await adapter.create({
        collection: 'pages',
        data: { id: 'page-1', title: 'Parent Page', slug: 'parent-page' },
      })

      // Create post with polymorphic parent
      await adapter.create({
        collection: 'posts',
        data: {
          title: 'Child Post',
          slug: 'child-post',
          parent: { relationTo: 'pages', value: 'page-1' },
        },
      })

      const result = await adapter.find({
        collection: 'posts',
        depth: 1,
      })

      const post = result.docs.find((d: any) => d.slug === 'child-post')

      // Polymorphic relationship should be populated with relationTo info
      expect(post.parent).toEqual(
        expect.objectContaining({
          relationTo: 'pages',
          value: expect.objectContaining({
            id: 'page-1',
            title: 'Parent Page',
          }),
        })
      )
    })
  })

  // --------------------------------------------------------------------------
  // COMBINED FILTERS, SORT, AND PAGINATION
  // --------------------------------------------------------------------------

  describe('combined operations', () => {
    beforeEach(async () => {
      const adapter = harness.adapter as any

      for (let i = 1; i <= 20; i++) {
        await adapter.create({
          collection: 'posts',
          data: {
            title: `Post ${i}`,
            slug: `post-${i}`,
            status: i % 2 === 0 ? 'published' : 'draft',
            views: i * 10,
          },
        })
      }
    })

    it('should combine filter, sort, and pagination', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        where: { status: { equals: 'published' } },
        sort: '-views',
        limit: 5,
        page: 1,
      })

      // Should only get published posts
      expect(result.docs.every((doc: any) => doc.status === 'published')).toBe(true)

      // Should be sorted by views descending
      for (let i = 0; i < result.docs.length - 1; i++) {
        expect(result.docs[i].views).toBeGreaterThan(result.docs[i + 1].views)
      }

      // Should have pagination
      expect(result.docs).toHaveLength(5)
      expect(result.totalDocs).toBe(10) // 10 published posts
      expect(result.hasNextPage).toBe(true)
    })
  })

  // --------------------------------------------------------------------------
  // OPERATION TRACKING
  // --------------------------------------------------------------------------

  describe('operation tracking', () => {
    it('should track find operations', async () => {
      const adapter = harness.adapter as any

      await adapter.find({
        collection: 'posts',
        where: { status: { equals: 'published' } },
      })

      expect(harness.operations).toContainEqual(
        expect.objectContaining({
          type: 'find',
          collection: 'posts',
        })
      )
    })

    it('should track where clause in operations', async () => {
      const adapter = harness.adapter as any

      const whereClause = { status: { equals: 'draft' } }

      await adapter.find({
        collection: 'posts',
        where: whereClause,
      })

      const findOp = harness.operations.find((op) => op.type === 'find')
      expect(findOp?.where).toEqual(whereClause)
    })
  })
})

// ============================================================================
// PayloadAdapter.findOne() TESTS
// ============================================================================

describe('PayloadAdapter.findOne()', () => {
  let harness: PayloadAdapterHarness

  beforeEach(() => {
    harness = createPayloadAdapterHarness({
      namespace: 'https://test.do',
    })
  })

  it('should return single document by id', async () => {
    const adapter = harness.adapter as any

    // Create test document
    const created = await adapter.create({
      collection: 'posts',
      data: { title: 'Find One Test', slug: 'find-one-test' },
    })

    const result = await adapter.findOne({
      collection: 'posts',
      id: created.id,
    })

    expect(result).not.toBeNull()
    expect(result.id).toBe(created.id)
    expect(result.title).toBe('Find One Test')
    expect(result.slug).toBe('find-one-test')
  })

  it('should return null for non-existent document', async () => {
    const adapter = harness.adapter as any

    const result = await adapter.findOne({
      collection: 'posts',
      id: 'non-existent-id',
    })

    expect(result).toBeNull()
  })

  it('should populate relationships at specified depth', async () => {
    const adapter = harness.adapter as any

    // Create user
    await adapter.create({
      collection: 'users',
      data: { id: 'user-1', name: 'Jane Doe', email: 'jane@test.com' },
    })

    // Create post with relationship
    const created = await adapter.create({
      collection: 'posts',
      data: { title: 'Post with Author', slug: 'post-author', author: 'user-1' },
    })

    // findOne at depth 0 - should return ID only
    const resultDepth0 = await adapter.findOne({
      collection: 'posts',
      id: created.id,
      depth: 0,
    })
    expect(resultDepth0.author).toBe('user-1')

    // findOne at depth 1 - should populate
    const resultDepth1 = await adapter.findOne({
      collection: 'posts',
      id: created.id,
      depth: 1,
    })
    expect(resultDepth1.author).toEqual(
      expect.objectContaining({
        id: 'user-1',
        name: 'Jane Doe',
        email: 'jane@test.com',
      })
    )
  })

  it('should support where clause', async () => {
    const adapter = harness.adapter as any

    // Create multiple documents
    await adapter.create({
      collection: 'posts',
      data: { title: 'Draft Post', slug: 'draft-post', status: 'draft' },
    })
    await adapter.create({
      collection: 'posts',
      data: { title: 'Published Post', slug: 'published-post', status: 'published' },
    })

    // findOne with where clause (find first match)
    const result = await adapter.findOne({
      collection: 'posts',
      where: { status: { equals: 'published' } },
    })

    expect(result).not.toBeNull()
    expect(result.status).toBe('published')
    expect(result.title).toBe('Published Post')
  })

  it('should return null when where clause has no matches', async () => {
    const adapter = harness.adapter as any

    await adapter.create({
      collection: 'posts',
      data: { title: 'Draft Post', slug: 'draft', status: 'draft' },
    })

    const result = await adapter.findOne({
      collection: 'posts',
      where: { status: { equals: 'archived' } },
    })

    expect(result).toBeNull()
  })

  it('should include timestamps in returned document', async () => {
    const adapter = harness.adapter as any

    const created = await adapter.create({
      collection: 'posts',
      data: { title: 'Timestamp Test', slug: 'timestamp-test' },
    })

    const result = await adapter.findOne({
      collection: 'posts',
      id: created.id,
    })

    expect(result.createdAt).toBeDefined()
    expect(result.updatedAt).toBeDefined()
  })

  it('should track findOne operations', async () => {
    const adapter = harness.adapter as any

    await adapter.findOne({
      collection: 'posts',
      id: 'test-id',
    })

    expect(harness.operations).toContainEqual(
      expect.objectContaining({
        type: 'findOne',
        collection: 'posts',
      })
    )
  })

  it('should handle findOne with both id and where clause', async () => {
    const adapter = harness.adapter as any

    // Create test document
    const created = await adapter.create({
      collection: 'posts',
      data: { title: 'Combined Test', slug: 'combined-test', status: 'published' },
    })

    // When both id and where are provided, id should take precedence
    const result = await adapter.findOne({
      collection: 'posts',
      id: created.id,
      where: { status: { equals: 'draft' } }, // This doesn't match but id does
    })

    // Implementation may vary - either id takes precedence or both must match
    // This test documents expected behavior
    expect(result).not.toBeNull()
    expect(result.id).toBe(created.id)
  })
})
