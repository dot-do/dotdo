import { describe, it, expect, beforeEach } from 'vitest'
import { createPayloadAdapterHarness } from '../../../src'
import type { PayloadAdapterHarness, PayloadField } from '../../../src'

/**
 * PayloadAdapter.create() Operation Tests
 *
 * These tests verify the adapter's create() operation, including:
 * - Basic document creation with id generation
 * - Thing storage with proper $type and $id
 * - Field transformation to Thing data format
 * - Relationship handling for hasOne/hasMany/polymorphic fields
 * - All Payload field types
 * - Lifecycle hooks (beforeCreate, afterCreate)
 *
 * Reference: dotdo-osxg - A10 RED: create() tests
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
// BASIC DOCUMENT CREATION TESTS
// ============================================================================

describe('PayloadAdapter.create()', () => {
  let harness: PayloadAdapterHarness

  beforeEach(() => {
    harness = createPayloadAdapterHarness({
      namespace: 'https://test.do',
    })
  })

  describe('basic document creation', () => {
    it('should create a document and return it with generated id', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.create({
        collection: 'posts',
        data: {
          title: 'My First Post',
          slug: 'my-first-post',
          status: 'draft',
        },
      })

      expect(result).toBeDefined()
      expect(result.id).toBeDefined()
      expect(typeof result.id).toBe('string')
      expect(result.id.length).toBeGreaterThan(0)
      expect(result.title).toBe('My First Post')
      expect(result.slug).toBe('my-first-post')
      expect(result.status).toBe('draft')
    })

    it('should create a document with provided id', async () => {
      const adapter = harness.adapter as any
      const providedId = 'custom-post-id-123'

      const result = await adapter.create({
        collection: 'posts',
        data: {
          id: providedId,
          title: 'Post with Custom ID',
          slug: 'post-custom-id',
        },
      })

      expect(result.id).toBe(providedId)
    })

    it('should reject duplicate ids', async () => {
      const adapter = harness.adapter as any
      const duplicateId = 'duplicate-id'

      // Create first document
      await adapter.create({
        collection: 'posts',
        data: {
          id: duplicateId,
          title: 'First Post',
          slug: 'first-post',
        },
      })

      // Attempt to create second document with same id should fail
      await expect(
        adapter.create({
          collection: 'posts',
          data: {
            id: duplicateId,
            title: 'Second Post',
            slug: 'second-post',
          },
        })
      ).rejects.toThrow(/duplicate|already exists|conflict/i)
    })

    it('should set createdAt and updatedAt timestamps', async () => {
      const adapter = harness.adapter as any
      const before = new Date()

      const result = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Timestamped Post',
          slug: 'timestamped-post',
        },
      })

      const after = new Date()

      expect(result.createdAt).toBeDefined()
      expect(result.updatedAt).toBeDefined()

      // Parse timestamps
      const createdAt = new Date(result.createdAt)
      const updatedAt = new Date(result.updatedAt)

      // Timestamps should be between before and after
      expect(createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(createdAt.getTime()).toBeLessThanOrEqual(after.getTime())
      expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(updatedAt.getTime()).toBeLessThanOrEqual(after.getTime())

      // createdAt and updatedAt should be equal on creation
      expect(createdAt.getTime()).toBe(updatedAt.getTime())
    })
  })

  // ============================================================================
  // THING STORAGE TESTS
  // ============================================================================

  describe('Thing storage', () => {
    it('should store document as Thing with correct $type', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Thing Type Test',
          slug: 'thing-type-test',
        },
      })

      // Check the Thing was stored with correct $type
      const thingId = `https://test.do/posts/${result.id}`
      const thing = harness.things.get(thingId)

      expect(thing).toBeDefined()
      expect(thing?.$type).toBe('https://test.do/posts')
    })

    it('should store document as Thing with correct $id', async () => {
      const adapter = harness.adapter as any
      const customId = 'my-post-id'

      await adapter.create({
        collection: 'posts',
        data: {
          id: customId,
          title: 'Thing ID Test',
          slug: 'thing-id-test',
        },
      })

      const expectedThingId = `https://test.do/posts/${customId}`
      const thing = harness.things.get(expectedThingId)

      expect(thing).toBeDefined()
      expect(thing?.$id).toBe(expectedThingId)
    })

    it('should transform fields to Thing data format', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Data Transform Test',
          slug: 'data-transform',
          views: 100,
          featured: true,
          status: 'published',
        },
      })

      const thingId = `https://test.do/posts/${result.id}`
      const thing = harness.things.get(thingId)

      expect(thing).toBeDefined()
      expect(thing?.data).toBeDefined()
      // Data should be stored in Thing's data field
      expect(thing?.data?.slug).toBe('data-transform')
      expect(thing?.data?.views).toBe(100)
      expect(thing?.data?.featured).toBe(true)
      expect(thing?.data?.status).toBe('published')
    })

    it('should register collection as Noun on first create', async () => {
      const adapter = harness.adapter as any

      // Initially, no Nouns should be registered for 'articles'
      const nounBefore = harness.nouns.get('Article')
      expect(nounBefore).toBeUndefined()

      // Create a document in a new collection
      await adapter.create({
        collection: 'articles',
        data: {
          title: 'First Article',
          slug: 'first-article',
        },
      })

      // Now the Noun should be registered
      const nounAfter = harness.nouns.get('Article')
      expect(nounAfter).toBeDefined()
      expect(nounAfter?.noun).toBe('Article')
    })
  })

  // ============================================================================
  // RELATIONSHIP HANDLING TESTS
  // ============================================================================

  describe('relationship handling', () => {
    it('should create relationship entries for hasOne fields', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Post with Author',
          slug: 'post-with-author',
          author: 'user-123',
        },
      })

      // Check relationship was created
      const thingId = `https://test.do/posts/${result.id}`
      const relationships = harness.relationships.list({ from: thingId })

      expect(relationships).toContainEqual(
        expect.objectContaining({
          from: thingId,
          to: expect.stringContaining('user-123'),
          verb: 'hasAuthor',
        })
      )
    })

    it('should create relationship entries for hasMany fields', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Post with Categories',
          slug: 'post-with-categories',
          categories: ['cat-1', 'cat-2', 'cat-3'],
        },
      })

      const thingId = `https://test.do/posts/${result.id}`
      const relationships = harness.relationships.list({ from: thingId, verb: 'hasCategories' })

      expect(relationships).toHaveLength(3)
      expect(relationships).toContainEqual(
        expect.objectContaining({
          from: thingId,
          verb: 'hasCategories',
        })
      )
    })

    it('should handle polymorphic relationships', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Post with Polymorphic Ref',
          slug: 'post-polymorphic',
          // Polymorphic relationship format
          parent: { relationTo: 'pages', value: 'page-123' },
        },
      })

      const thingId = `https://test.do/posts/${result.id}`
      const relationships = harness.relationships.list({ from: thingId, verb: 'hasParent' })

      expect(relationships).toHaveLength(1)
      expect(relationships[0]).toEqual(
        expect.objectContaining({
          from: thingId,
          verb: 'hasParent',
          data: expect.objectContaining({
            relationTo: 'pages',
          }),
        })
      )
    })

    it('should handle upload fields as relationships', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Post with Image',
          slug: 'post-with-image',
          featuredImage: 'media-456',
        },
      })

      const thingId = `https://test.do/posts/${result.id}`
      const relationships = harness.relationships.list({ from: thingId, verb: 'hasFeaturedImage' })

      expect(relationships).toHaveLength(1)
      expect(relationships[0]).toEqual(
        expect.objectContaining({
          from: thingId,
          to: expect.stringContaining('media-456'),
          verb: 'hasFeaturedImage',
        })
      )
    })
  })

  // ============================================================================
  // FIELD TYPE TESTS
  // ============================================================================

  describe('field types', () => {
    it('should handle text fields', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Text Field Test',
          slug: 'text-field-test',
        },
      })

      expect(result.title).toBe('Text Field Test')
      expect(result.slug).toBe('text-field-test')

      const thingId = `https://test.do/posts/${result.id}`
      const thing = harness.things.get(thingId)
      expect(thing?.data?.title).toBe('Text Field Test')
    })

    it('should handle number fields', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Number Test',
          slug: 'number-test',
          views: 42,
        },
      })

      expect(result.views).toBe(42)

      const thingId = `https://test.do/posts/${result.id}`
      const thing = harness.things.get(thingId)
      expect(thing?.data?.views).toBe(42)
    })

    it('should handle date fields', async () => {
      const adapter = harness.adapter as any
      const testDate = new Date('2026-01-09T12:00:00.000Z')

      const result = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Date Test',
          slug: 'date-test',
          publishedAt: testDate,
        },
      })

      expect(result.publishedAt).toBeDefined()
      // Date should be stored as ISO string in Thing
      const thingId = `https://test.do/posts/${result.id}`
      const thing = harness.things.get(thingId)
      expect(thing?.data?.publishedAt).toBe('2026-01-09T12:00:00.000Z')
    })

    it('should handle richText fields', async () => {
      const adapter = harness.adapter as any
      const richTextContent = [
        { type: 'paragraph', children: [{ text: 'Hello world' }] },
        { type: 'heading', level: 2, children: [{ text: 'Subheading' }] },
      ]

      const result = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Rich Text Test',
          slug: 'rich-text-test',
          content: richTextContent,
        },
      })

      expect(result.content).toEqual(richTextContent)

      // Rich text should be stored as JSON string in Thing
      const thingId = `https://test.do/posts/${result.id}`
      const thing = harness.things.get(thingId)
      expect(typeof thing?.data?.content).toBe('string')
      expect(JSON.parse(thing?.data?.content as string)).toEqual(richTextContent)
    })

    it('should handle array fields', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Array Test',
          slug: 'array-test',
          tags: [{ tag: 'typescript' }, { tag: 'testing' }, { tag: 'vitest' }],
        },
      })

      expect(result.tags).toEqual([
        { tag: 'typescript' },
        { tag: 'testing' },
        { tag: 'vitest' },
      ])

      // Array with single text field should be flattened in Thing
      const thingId = `https://test.do/posts/${result.id}`
      const thing = harness.things.get(thingId)
      expect(thing?.data?.tags).toEqual(['typescript', 'testing', 'vitest'])
    })

    it('should handle blocks fields', async () => {
      const adapter = harness.adapter as any
      const blocksData = [
        { blockType: 'hero', heading: 'Welcome', image: 'img-1' },
        { blockType: 'content', body: 'Main content here' },
        { blockType: 'cta', buttonText: 'Click me', link: '/action' },
      ]

      const result = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Blocks Test',
          slug: 'blocks-test',
          layout: blocksData,
        },
      })

      expect(result.layout).toEqual(blocksData)

      // Blocks should preserve blockType in Thing
      const thingId = `https://test.do/posts/${result.id}`
      const thing = harness.things.get(thingId)
      expect(Array.isArray(thing?.data?.layout)).toBe(true)
      expect((thing?.data?.layout as any[])?.[0].blockType).toBe('hero')
    })

    it('should handle group fields', async () => {
      const adapter = harness.adapter as any
      const groupData = {
        seoTitle: 'SEO Optimized Title',
        seoDescription: 'A great description for search engines',
      }

      const result = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Group Test',
          slug: 'group-test',
          metadata: groupData,
        },
      })

      expect(result.metadata).toEqual(groupData)

      // Group should be preserved as nested object in Thing
      const thingId = `https://test.do/posts/${result.id}`
      const thing = harness.things.get(thingId)
      expect(thing?.data?.metadata).toEqual(groupData)
    })
  })

  // ============================================================================
  // HOOKS TESTS
  // ============================================================================

  describe('hooks', () => {
    it('should call beforeCreate hooks', async () => {
      const beforeCreateCalls: Array<{ collection: string; data: Record<string, unknown> }> = []

      const harnessWithHooks = createPayloadAdapterHarness({
        namespace: 'https://test.do',
      })

      // Register beforeCreate hook
      const adapter = harnessWithHooks.adapter as any
      adapter.hooks = adapter.hooks || {}
      adapter.hooks.beforeCreate = async (args: { collection: string; data: Record<string, unknown> }) => {
        beforeCreateCalls.push({ collection: args.collection, data: { ...args.data } })
        return args.data
      }

      await adapter.create({
        collection: 'posts',
        data: {
          title: 'Hook Test',
          slug: 'hook-test',
        },
      })

      expect(beforeCreateCalls).toHaveLength(1)
      expect(beforeCreateCalls[0].collection).toBe('posts')
      expect(beforeCreateCalls[0].data.title).toBe('Hook Test')
    })

    it('should call afterCreate hooks', async () => {
      const afterCreateCalls: Array<{ collection: string; doc: Record<string, unknown> }> = []

      const harnessWithHooks = createPayloadAdapterHarness({
        namespace: 'https://test.do',
      })

      const adapter = harnessWithHooks.adapter as any
      adapter.hooks = adapter.hooks || {}
      adapter.hooks.afterCreate = async (args: { collection: string; doc: Record<string, unknown> }) => {
        afterCreateCalls.push({ collection: args.collection, doc: { ...args.doc } })
      }

      await adapter.create({
        collection: 'posts',
        data: {
          title: 'After Hook Test',
          slug: 'after-hook-test',
        },
      })

      expect(afterCreateCalls).toHaveLength(1)
      expect(afterCreateCalls[0].collection).toBe('posts')
      expect(afterCreateCalls[0].doc.title).toBe('After Hook Test')
      expect(afterCreateCalls[0].doc.id).toBeDefined()
    })

    it('should abort on hook error', async () => {
      const harnessWithHooks = createPayloadAdapterHarness({
        namespace: 'https://test.do',
      })

      const adapter = harnessWithHooks.adapter as any
      adapter.hooks = adapter.hooks || {}
      adapter.hooks.beforeCreate = async () => {
        throw new Error('Validation failed in beforeCreate hook')
      }

      await expect(
        adapter.create({
          collection: 'posts',
          data: {
            title: 'Should Fail',
            slug: 'should-fail',
          },
        })
      ).rejects.toThrow('Validation failed in beforeCreate hook')

      // Document should not be created
      const result = await adapter.find({ collection: 'posts' })
      expect(result.docs).toHaveLength(0)
    })
  })

  // ============================================================================
  // EDGE CASES AND ERROR HANDLING
  // ============================================================================

  describe('edge cases', () => {
    it('should handle empty data object', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.create({
        collection: 'posts',
        data: {},
      })

      expect(result.id).toBeDefined()
      expect(result.createdAt).toBeDefined()
      expect(result.updatedAt).toBeDefined()
    })

    it('should handle null and undefined field values', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Null Test',
          slug: null,
          content: undefined,
        },
      })

      expect(result.title).toBe('Null Test')
      expect(result.slug).toBeNull()
      // Undefined fields may be omitted or undefined
      expect(result.content === undefined || !('content' in result)).toBe(true)
    })

    it('should handle special characters in field values', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Test <script>alert("xss")</script>',
          slug: 'test-xss',
          content: "Line1\nLine2\tTabbed\r\nWindows newline",
        },
      })

      expect(result.title).toBe('Test <script>alert("xss")</script>')
      expect(result.content).toBe("Line1\nLine2\tTabbed\r\nWindows newline")
    })

    it('should handle unicode characters', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Unicode: cafe, resume, naive',
          slug: 'unicode-test',
        },
      })

      expect(result.title).toBe('Unicode: cafe, resume, naive')

      const thingId = `https://test.do/posts/${result.id}`
      const thing = harness.things.get(thingId)
      expect(thing?.name).toBe('Unicode: cafe, resume, naive')
    })

    it('should handle very long field values', async () => {
      const adapter = harness.adapter as any
      const longContent = 'a'.repeat(100000) // 100KB string

      const result = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Long Content Test',
          slug: 'long-content',
          content: longContent,
        },
      })

      expect(result.content).toBe(longContent)
    })

    it('should handle deeply nested data', async () => {
      const adapter = harness.adapter as any
      const deeplyNested = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  value: 'deep',
                },
              },
            },
          },
        },
      }

      const result = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Deep Nesting Test',
          slug: 'deep-nesting',
          metadata: deeplyNested,
        },
      })

      expect(result.metadata).toEqual(deeplyNested)
    })
  })

  // ============================================================================
  // OPERATION TRACKING TESTS
  // ============================================================================

  describe('operation tracking', () => {
    it('should track create operation in operations list', async () => {
      const adapter = harness.adapter as any

      await adapter.create({
        collection: 'posts',
        data: {
          title: 'Tracked Post',
          slug: 'tracked-post',
        },
      })

      expect(harness.operations).toContainEqual(
        expect.objectContaining({
          type: 'create',
          collection: 'posts',
        })
      )
    })

    it('should record operation data for create', async () => {
      const adapter = harness.adapter as any

      await adapter.create({
        collection: 'posts',
        data: {
          title: 'Data Tracking Test',
          slug: 'data-tracking',
          views: 100,
        },
      })

      const createOp = harness.operations.find((op) => op.type === 'create')
      expect(createOp?.data).toEqual(
        expect.objectContaining({
          title: 'Data Tracking Test',
          views: 100,
        })
      )
    })

    it('should track timestamp of create operation', async () => {
      const adapter = harness.adapter as any
      const before = Date.now()

      await adapter.create({
        collection: 'posts',
        data: {
          title: 'Timestamp Test',
          slug: 'timestamp-test',
        },
      })

      const after = Date.now()
      const createOp = harness.operations.find((op) => op.type === 'create')

      expect(createOp?.timestamp).toBeGreaterThanOrEqual(before)
      expect(createOp?.timestamp).toBeLessThanOrEqual(after)
    })
  })
})
