import { describe, it, expect, beforeEach } from 'vitest'
import { createPayloadAdapterHarness } from '../../../src'
import type { PayloadAdapterHarness, PayloadField } from '../../../src'

/**
 * Relationship Population Tests
 *
 * These tests verify the adapter's relationship population functionality,
 * including depth control, circular reference handling, polymorphic relationships,
 * batch optimization, and edge cases.
 *
 * Reference: dotdo-1lfr - A17 RED: Relationship population tests
 */

// ============================================================================
// TEST FIXTURES
// ============================================================================

/** Sample Payload fields for a user collection */
const userFields: PayloadField[] = [
  { type: 'text', name: 'name', required: true },
  { type: 'email', name: 'email', required: true },
  { type: 'relationship', name: 'manager', relationTo: 'users' },
  { type: 'relationship', name: 'team', relationTo: 'users', hasMany: true },
]

/** Sample Payload fields for a blog post collection */
const postFields: PayloadField[] = [
  { type: 'text', name: 'title', required: true },
  { type: 'text', name: 'slug', required: true },
  { type: 'richText', name: 'content' },
  { type: 'relationship', name: 'author', relationTo: 'users' },
  { type: 'relationship', name: 'categories', relationTo: 'categories', hasMany: true },
  { type: 'upload', name: 'featuredImage', relationTo: 'media' },
  { type: 'relationship', name: 'relatedPosts', relationTo: 'posts', hasMany: true },
]

/** Sample Payload fields for a category collection */
const categoryFields: PayloadField[] = [
  { type: 'text', name: 'name', required: true },
  { type: 'text', name: 'slug', required: true },
  { type: 'relationship', name: 'parent', relationTo: 'categories' },
]

/** Sample Payload fields for a media collection */
const mediaFields: PayloadField[] = [
  { type: 'text', name: 'filename', required: true },
  { type: 'text', name: 'mimeType' },
  { type: 'text', name: 'url' },
  { type: 'number', name: 'filesize' },
  { type: 'number', name: 'width' },
  { type: 'number', name: 'height' },
  { type: 'text', name: 'alt' },
]

/** Sample Payload fields for polymorphic content */
const pageFields: PayloadField[] = [
  { type: 'text', name: 'title', required: true },
  { type: 'relationship', name: 'content', relationTo: ['posts', 'categories', 'media'] },
  { type: 'relationship', name: 'items', relationTo: ['posts', 'categories'], hasMany: true },
]

/** Sample Payload fields for a comment collection with self-reference */
const commentFields: PayloadField[] = [
  { type: 'text', name: 'body', required: true },
  { type: 'relationship', name: 'author', relationTo: 'users' },
  { type: 'relationship', name: 'post', relationTo: 'posts' },
  { type: 'relationship', name: 'parent', relationTo: 'comments' },
  { type: 'relationship', name: 'replies', relationTo: 'comments', hasMany: true },
]

// ============================================================================
// RELATIONSHIP POPULATION TESTS
// ============================================================================

describe('Relationship Population', () => {
  let harness: PayloadAdapterHarness

  beforeEach(() => {
    harness = createPayloadAdapterHarness({
      namespace: 'https://test.do',
      seed: {
        users: [
          { id: 'user-1', name: 'Alice', email: 'alice@test.com', manager: 'user-2' },
          { id: 'user-2', name: 'Bob', email: 'bob@test.com', manager: 'user-3' },
          { id: 'user-3', name: 'Charlie', email: 'charlie@test.com' },
          { id: 'user-4', name: 'Diana', email: 'diana@test.com', manager: 'user-1' },
        ],
        categories: [
          { id: 'cat-1', name: 'Technology', slug: 'tech', parent: null },
          { id: 'cat-2', name: 'JavaScript', slug: 'javascript', parent: 'cat-1' },
          { id: 'cat-3', name: 'TypeScript', slug: 'typescript', parent: 'cat-1' },
        ],
        media: [
          {
            id: 'media-1',
            filename: 'hero.jpg',
            mimeType: 'image/jpeg',
            url: '/media/hero.jpg',
            filesize: 102400,
            width: 1920,
            height: 1080,
            alt: 'Hero image',
          },
          {
            id: 'media-2',
            filename: 'thumb.png',
            mimeType: 'image/png',
            url: '/media/thumb.png',
            filesize: 51200,
            width: 400,
            height: 300,
            alt: 'Thumbnail',
          },
        ],
        posts: [
          {
            id: 'post-1',
            title: 'Introduction to TypeScript',
            slug: 'intro-typescript',
            author: 'user-1',
            categories: ['cat-2', 'cat-3'],
            featuredImage: 'media-1',
            relatedPosts: ['post-2'],
          },
          {
            id: 'post-2',
            title: 'Advanced JavaScript Patterns',
            slug: 'advanced-js',
            author: 'user-2',
            categories: ['cat-2'],
            featuredImage: 'media-2',
            relatedPosts: ['post-1'],
          },
          {
            id: 'post-3',
            title: 'Node.js Best Practices',
            slug: 'nodejs-best',
            author: 'user-1',
            categories: ['cat-2'],
            relatedPosts: [],
          },
        ],
      },
    })
  })

  // ============================================================================
  // POPULATE RELATIONSHIPS - DEPTH CONTROL
  // ============================================================================

  describe('populateRelationships', () => {
    it('should return document as-is at depth 0', async () => {
      const adapter = harness.adapter as any

      // Get post without population (depth 0)
      const result = await adapter.findOne({
        collection: 'posts',
        id: 'post-1',
        depth: 0,
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('post-1')
      expect(result.title).toBe('Introduction to TypeScript')

      // Relationships should remain as IDs only
      expect(result.author).toBe('user-1')
      expect(result.categories).toEqual(['cat-2', 'cat-3'])
      expect(result.featuredImage).toBe('media-1')
    })

    it('should populate hasOne relationships at depth 1', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.findOne({
        collection: 'posts',
        id: 'post-1',
        depth: 1,
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('post-1')

      // Author should be populated
      expect(result.author).toBeDefined()
      expect(typeof result.author).toBe('object')
      expect(result.author.id).toBe('user-1')
      expect(result.author.name).toBe('Alice')
      expect(result.author.email).toBe('alice@test.com')

      // Author's manager should NOT be populated at depth 1
      expect(result.author.manager).toBe('user-2')
    })

    it('should populate hasMany relationships as arrays', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.findOne({
        collection: 'posts',
        id: 'post-1',
        depth: 1,
      })

      expect(result).toBeDefined()

      // Categories should be populated as array of objects
      expect(Array.isArray(result.categories)).toBe(true)
      expect(result.categories).toHaveLength(2)

      expect(result.categories[0]).toBeDefined()
      expect(typeof result.categories[0]).toBe('object')
      expect(result.categories[0].id).toBe('cat-2')
      expect(result.categories[0].name).toBe('JavaScript')

      expect(result.categories[1]).toBeDefined()
      expect(typeof result.categories[1]).toBe('object')
      expect(result.categories[1].id).toBe('cat-3')
      expect(result.categories[1].name).toBe('TypeScript')
    })

    it('should populate nested relationships at depth 2', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.findOne({
        collection: 'posts',
        id: 'post-1',
        depth: 2,
      })

      expect(result).toBeDefined()

      // Author should be populated
      expect(result.author).toBeDefined()
      expect(typeof result.author).toBe('object')
      expect(result.author.id).toBe('user-1')

      // Author's manager should now be populated at depth 2
      expect(result.author.manager).toBeDefined()
      expect(typeof result.author.manager).toBe('object')
      expect(result.author.manager.id).toBe('user-2')
      expect(result.author.manager.name).toBe('Bob')

      // Manager's manager should NOT be populated at depth 2
      expect(result.author.manager.manager).toBe('user-3')

      // Category parent should also be populated at depth 2
      expect(result.categories[0].parent).toBeDefined()
      expect(typeof result.categories[0].parent).toBe('object')
      expect(result.categories[0].parent.id).toBe('cat-1')
      expect(result.categories[0].parent.name).toBe('Technology')
    })

    it('should stop at max depth', async () => {
      const adapter = harness.adapter as any

      // Create a deeper chain: user-1 -> user-2 -> user-3
      const result = await adapter.findOne({
        collection: 'users',
        id: 'user-1',
        depth: 3,
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('user-1')

      // Depth 1: manager populated
      expect(result.manager).toBeDefined()
      expect(typeof result.manager).toBe('object')
      expect(result.manager.id).toBe('user-2')

      // Depth 2: manager's manager populated
      expect(result.manager.manager).toBeDefined()
      expect(typeof result.manager.manager).toBe('object')
      expect(result.manager.manager.id).toBe('user-3')

      // Depth 3: manager's manager's manager should be null (no more managers)
      expect(result.manager.manager.manager).toBeNull()
    })

    it('should default to depth 1 when not specified', async () => {
      const adapter = harness.adapter as any

      // No depth specified - should default to 1
      const result = await adapter.findOne({
        collection: 'posts',
        id: 'post-1',
      })

      expect(result).toBeDefined()

      // Author should be populated at default depth
      expect(result.author).toBeDefined()
      expect(typeof result.author).toBe('object')
      expect(result.author.id).toBe('user-1')

      // Nested relationships should NOT be populated at default depth
      expect(result.author.manager).toBe('user-2')
    })
  })

  // ============================================================================
  // CIRCULAR REFERENCE HANDLING
  // ============================================================================

  describe('circular reference handling', () => {
    beforeEach(async () => {
      const adapter = harness.adapter as any

      // Create circular reference: user-1 -> user-2 -> user-1 (mutual managers)
      await adapter.update({
        collection: 'users',
        id: 'user-2',
        data: { manager: 'user-1' },
      })
    })

    it('should detect circular references', async () => {
      const adapter = harness.adapter as any

      // user-1's manager is user-2, user-2's manager is user-1 (circular)
      const result = await adapter.findOne({
        collection: 'users',
        id: 'user-1',
        depth: 3,
      })

      expect(result).toBeDefined()

      // First level populated
      expect(result.manager).toBeDefined()
      expect(typeof result.manager).toBe('object')
      expect(result.manager.id).toBe('user-2')

      // Second level - would be user-1 again, circular reference
      expect(result.manager.manager).toBeDefined()
    })

    it('should return ID instead of infinite loop', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.findOne({
        collection: 'users',
        id: 'user-1',
        depth: 10, // High depth to test circular prevention
      })

      expect(result).toBeDefined()

      // At some point, circular reference should return ID instead of infinite nesting
      let current = result
      let depth = 0
      const maxIterations = 15

      while (current?.manager && typeof current.manager === 'object' && depth < maxIterations) {
        current = current.manager
        depth++
      }

      // Should have stopped before max iterations
      expect(depth).toBeLessThan(maxIterations)

      // The last manager should be an ID string, not an object (circular break)
      if (depth > 0 && current) {
        // Either null, ID string, or still object but at max depth
        expect(
          current.manager === null ||
          typeof current.manager === 'string' ||
          depth < 10
        ).toBe(true)
      }
    })

    it('should handle self-referencing documents', async () => {
      const adapter = harness.adapter as any

      // Create a comment that replies to itself (edge case)
      await adapter.create({
        collection: 'comments',
        data: {
          id: 'comment-self',
          body: 'Self-referencing comment',
          author: 'user-1',
          post: 'post-1',
          parent: 'comment-self', // Self-reference
        },
      })

      const result = await adapter.findOne({
        collection: 'comments',
        id: 'comment-self',
        depth: 5,
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('comment-self')

      // Self-reference should be detected and not cause infinite loop
      // Parent should either be ID string or populated once then break
      expect(result.parent).toBeDefined()

      if (typeof result.parent === 'object') {
        // If populated, should not infinitely nest
        expect(result.parent.id).toBe('comment-self')
        // Next level should be ID or handled gracefully
        expect(
          result.parent.parent === 'comment-self' ||
          result.parent.parent === null ||
          (typeof result.parent.parent === 'object' && result.parent.parent.id === 'comment-self')
        ).toBe(true)
      }
    })
  })

  // ============================================================================
  // POLYMORPHIC RELATIONSHIPS
  // ============================================================================

  describe('polymorphic relationships', () => {
    beforeEach(async () => {
      const adapter = harness.adapter as any

      // Create pages with polymorphic content references
      await adapter.create({
        collection: 'pages',
        data: {
          id: 'page-1',
          title: 'Home Page',
          content: { relationTo: 'posts', value: 'post-1' },
        },
      })

      await adapter.create({
        collection: 'pages',
        data: {
          id: 'page-2',
          title: 'Media Gallery',
          content: { relationTo: 'media', value: 'media-1' },
        },
      })

      await adapter.create({
        collection: 'pages',
        data: {
          id: 'page-3',
          title: 'Mixed Content',
          items: [
            { relationTo: 'posts', value: 'post-1' },
            { relationTo: 'categories', value: 'cat-1' },
            { relationTo: 'posts', value: 'post-2' },
          ],
        },
      })
    })

    it('should populate polymorphic hasOne', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.findOne({
        collection: 'pages',
        id: 'page-1',
        depth: 1,
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('page-1')

      // Polymorphic content should be populated
      expect(result.content).toBeDefined()
      expect(typeof result.content).toBe('object')
      expect(result.content.value).toBeDefined()
      expect(typeof result.content.value).toBe('object')
      expect(result.content.value.id).toBe('post-1')
      expect(result.content.value.title).toBe('Introduction to TypeScript')
    })

    it('should populate polymorphic hasMany', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.findOne({
        collection: 'pages',
        id: 'page-3',
        depth: 1,
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('page-3')

      // Polymorphic items array should be populated
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items).toHaveLength(3)

      // First item - post
      expect(result.items[0]).toBeDefined()
      expect(result.items[0].relationTo).toBe('posts')
      expect(typeof result.items[0].value).toBe('object')
      expect(result.items[0].value.id).toBe('post-1')

      // Second item - category
      expect(result.items[1]).toBeDefined()
      expect(result.items[1].relationTo).toBe('categories')
      expect(typeof result.items[1].value).toBe('object')
      expect(result.items[1].value.id).toBe('cat-1')

      // Third item - post
      expect(result.items[2]).toBeDefined()
      expect(result.items[2].relationTo).toBe('posts')
      expect(typeof result.items[2].value).toBe('object')
      expect(result.items[2].value.id).toBe('post-2')
    })

    it('should include relationTo in populated doc', async () => {
      const adapter = harness.adapter as any

      // Test post content
      const postPage = await adapter.findOne({
        collection: 'pages',
        id: 'page-1',
        depth: 1,
      })

      expect(postPage.content.relationTo).toBe('posts')

      // Test media content
      const mediaPage = await adapter.findOne({
        collection: 'pages',
        id: 'page-2',
        depth: 1,
      })

      expect(mediaPage.content.relationTo).toBe('media')
      expect(typeof mediaPage.content.value).toBe('object')
      expect(mediaPage.content.value.id).toBe('media-1')
      expect(mediaPage.content.value.filename).toBe('hero.jpg')
    })
  })

  // ============================================================================
  // BATCH POPULATION OPTIMIZATION
  // ============================================================================

  describe('batch population', () => {
    it('should batch relationship lookups', async () => {
      const adapter = harness.adapter as any

      // Clear any existing operation tracking
      harness.operations.length = 0

      // Find multiple posts - should batch author lookups
      const result = await adapter.find({
        collection: 'posts',
        depth: 1,
      })

      expect(result.docs).toHaveLength(3)

      // All authors should be populated
      expect(result.docs[0].author).toBeDefined()
      expect(typeof result.docs[0].author).toBe('object')
      expect(result.docs[1].author).toBeDefined()
      expect(typeof result.docs[1].author).toBe('object')

      // Count user collection queries - should be batched
      const userQueries = harness.operations.filter(
        (op) => op.collection === 'users' && (op.type === 'find' || op.type === 'findOne')
      )

      // Should have minimal queries due to batching
      // Instead of 3 separate queries for 3 posts' authors, should be 1-2 batched queries
      expect(userQueries.length).toBeLessThanOrEqual(2)
    })

    it('should avoid N+1 queries', async () => {
      const adapter = harness.adapter as any

      // Clear operations
      harness.operations.length = 0

      // Get posts with categories (hasMany relationship)
      const result = await adapter.find({
        collection: 'posts',
        depth: 1,
      })

      expect(result.docs).toHaveLength(3)

      // Categories should be populated
      expect(Array.isArray(result.docs[0].categories)).toBe(true)
      expect(result.docs[0].categories.length).toBeGreaterThan(0)
      expect(typeof result.docs[0].categories[0]).toBe('object')

      // Count category queries
      const categoryQueries = harness.operations.filter(
        (op) => op.collection === 'categories' && (op.type === 'find' || op.type === 'findOne')
      )

      // Should NOT be N+1 (3 posts * 2 categories each = 6 queries)
      // Should be batched to 1-2 queries max
      expect(categoryQueries.length).toBeLessThanOrEqual(2)
    })

    it('should use single query for same collection', async () => {
      const adapter = harness.adapter as any

      // Clear operations
      harness.operations.length = 0

      // relatedPosts is relationship to same collection (posts)
      const result = await adapter.findOne({
        collection: 'posts',
        id: 'post-1',
        depth: 1,
      })

      expect(result).toBeDefined()
      expect(Array.isArray(result.relatedPosts)).toBe(true)

      // Check that related posts are populated
      if (result.relatedPosts.length > 0) {
        expect(typeof result.relatedPosts[0]).toBe('object')
        expect(result.relatedPosts[0].id).toBe('post-2')
      }

      // Self-referencing collection relationships should also be batched
      const postQueries = harness.operations.filter(
        (op) => op.collection === 'posts' && op.type === 'find'
      )

      // Should batch related posts lookup
      expect(postQueries.length).toBeLessThanOrEqual(2)
    })
  })

  // ============================================================================
  // UPLOAD FIELDS
  // ============================================================================

  describe('upload fields', () => {
    it('should populate upload fields like relationships', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.findOne({
        collection: 'posts',
        id: 'post-1',
        depth: 1,
      })

      expect(result).toBeDefined()

      // Featured image should be populated
      expect(result.featuredImage).toBeDefined()
      expect(typeof result.featuredImage).toBe('object')
      expect(result.featuredImage.id).toBe('media-1')
      expect(result.featuredImage.filename).toBe('hero.jpg')
    })

    it('should include media metadata', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.findOne({
        collection: 'posts',
        id: 'post-1',
        depth: 1,
      })

      expect(result).toBeDefined()
      expect(result.featuredImage).toBeDefined()

      // Media metadata should be included
      expect(result.featuredImage.url).toBe('/media/hero.jpg')
      expect(result.featuredImage.mimeType).toBe('image/jpeg')
      expect(result.featuredImage.filesize).toBe(102400)
      expect(result.featuredImage.width).toBe(1920)
      expect(result.featuredImage.height).toBe(1080)
      expect(result.featuredImage.alt).toBe('Hero image')
    })

    it('should handle upload at depth 0', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.findOne({
        collection: 'posts',
        id: 'post-1',
        depth: 0,
      })

      expect(result).toBeDefined()

      // At depth 0, upload should remain as ID
      expect(result.featuredImage).toBe('media-1')
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle null relationship values', async () => {
      const adapter = harness.adapter as any

      // Create post with null author
      await adapter.create({
        collection: 'posts',
        data: {
          id: 'post-null-author',
          title: 'Post with No Author',
          slug: 'no-author',
          author: null,
          categories: ['cat-1'],
        },
      })

      const result = await adapter.findOne({
        collection: 'posts',
        id: 'post-null-author',
        depth: 1,
      })

      expect(result).toBeDefined()
      expect(result.author).toBeNull()

      // Other relationships should still be populated
      expect(Array.isArray(result.categories)).toBe(true)
      expect(typeof result.categories[0]).toBe('object')
    })

    it('should handle deleted related documents', async () => {
      const adapter = harness.adapter as any

      // Create a post referencing a user, then delete the user
      await adapter.create({
        collection: 'posts',
        data: {
          id: 'post-deleted-ref',
          title: 'Post with Deleted Author',
          slug: 'deleted-author',
          author: 'user-deleted',
          categories: ['cat-1'],
        },
      })

      // Note: user-deleted doesn't exist in seed data

      const result = await adapter.findOne({
        collection: 'posts',
        id: 'post-deleted-ref',
        depth: 1,
      })

      expect(result).toBeDefined()

      // Deleted/missing reference should either be null or remain as ID
      expect(
        result.author === null ||
        result.author === 'user-deleted' ||
        (typeof result.author === 'object' && result.author === null)
      ).toBe(true)
    })

    it('should handle empty hasMany arrays', async () => {
      const adapter = harness.adapter as any

      // post-3 has empty relatedPosts array
      const result = await adapter.findOne({
        collection: 'posts',
        id: 'post-3',
        depth: 1,
      })

      expect(result).toBeDefined()
      expect(Array.isArray(result.relatedPosts)).toBe(true)
      expect(result.relatedPosts).toHaveLength(0)
    })

    it('should handle undefined relationship fields', async () => {
      const adapter = harness.adapter as any

      // Create post without optional relationship fields
      await adapter.create({
        collection: 'posts',
        data: {
          id: 'post-minimal',
          title: 'Minimal Post',
          slug: 'minimal',
        },
      })

      const result = await adapter.findOne({
        collection: 'posts',
        id: 'post-minimal',
        depth: 1,
      })

      expect(result).toBeDefined()
      expect(result.title).toBe('Minimal Post')

      // Undefined relationships should remain undefined or null
      expect(
        result.author === undefined ||
        result.author === null
      ).toBe(true)
    })

    it('should handle mixed populated and unpopulated in hasMany', async () => {
      const adapter = harness.adapter as any

      // Create post with categories array containing mix of valid and invalid IDs
      await adapter.create({
        collection: 'posts',
        data: {
          id: 'post-mixed-refs',
          title: 'Mixed References',
          slug: 'mixed-refs',
          categories: ['cat-1', 'cat-deleted', 'cat-2'],
        },
      })

      const result = await adapter.findOne({
        collection: 'posts',
        id: 'post-mixed-refs',
        depth: 1,
      })

      expect(result).toBeDefined()
      expect(Array.isArray(result.categories)).toBe(true)

      // Valid references should be populated
      const validCategories = result.categories.filter(
        (c: any) => typeof c === 'object' && c !== null && c.id
      )
      expect(validCategories.length).toBeGreaterThanOrEqual(2)

      // Check cat-1 and cat-2 are populated
      const catIds = validCategories.map((c: any) => c.id)
      expect(catIds).toContain('cat-1')
      expect(catIds).toContain('cat-2')
    })

    it('should preserve order in hasMany relationships', async () => {
      const adapter = harness.adapter as any

      // post-1 has categories: ['cat-2', 'cat-3']
      const result = await adapter.findOne({
        collection: 'posts',
        id: 'post-1',
        depth: 1,
      })

      expect(result).toBeDefined()
      expect(Array.isArray(result.categories)).toBe(true)
      expect(result.categories).toHaveLength(2)

      // Order should be preserved
      expect(result.categories[0].id).toBe('cat-2')
      expect(result.categories[1].id).toBe('cat-3')
    })

    it('should handle deeply nested structures', async () => {
      const adapter = harness.adapter as any

      // Category hierarchy: cat-2 -> parent: cat-1 -> parent: null
      const result = await adapter.findOne({
        collection: 'categories',
        id: 'cat-2',
        depth: 3,
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('cat-2')
      expect(result.name).toBe('JavaScript')

      // Parent should be populated
      expect(result.parent).toBeDefined()
      expect(typeof result.parent).toBe('object')
      expect(result.parent.id).toBe('cat-1')
      expect(result.parent.name).toBe('Technology')

      // Grandparent should be null (top of hierarchy)
      expect(result.parent.parent).toBeNull()
    })
  })

  // ============================================================================
  // FIND OPERATION WITH POPULATION
  // ============================================================================

  describe('find with population', () => {
    it('should populate relationships in find results', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        depth: 1,
      })

      expect(result.docs).toBeDefined()
      expect(result.docs.length).toBeGreaterThan(0)

      // Each doc should have populated relationships
      for (const doc of result.docs) {
        if (doc.author) {
          expect(typeof doc.author).toBe('object')
          expect(doc.author.id).toBeDefined()
          expect(doc.author.name).toBeDefined()
        }
      }
    })

    it('should respect depth in find operation', async () => {
      const adapter = harness.adapter as any

      // Depth 0 - no population
      const depth0Result = await adapter.find({
        collection: 'posts',
        depth: 0,
      })

      for (const doc of depth0Result.docs) {
        if (doc.author) {
          expect(typeof doc.author).toBe('string')
        }
      }

      // Depth 1 - first level population
      const depth1Result = await adapter.find({
        collection: 'posts',
        depth: 1,
      })

      for (const doc of depth1Result.docs) {
        if (doc.author) {
          expect(typeof doc.author).toBe('object')
          // Nested relationships should be IDs
          if (doc.author.manager) {
            expect(typeof doc.author.manager).toBe('string')
          }
        }
      }
    })

    it('should handle pagination with population', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.find({
        collection: 'posts',
        depth: 1,
        limit: 2,
        page: 1,
      })

      expect(result.docs).toHaveLength(2)
      expect(result.totalDocs).toBe(3)
      expect(result.hasNextPage).toBe(true)

      // Populated relationships should work with pagination
      for (const doc of result.docs) {
        if (doc.author) {
          expect(typeof doc.author).toBe('object')
        }
      }
    })
  })
})
