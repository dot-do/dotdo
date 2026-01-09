import { describe, it, expect } from 'vitest'
import type { PayloadField } from '../../src/adapter/types'
import type { ThingData } from '../../../../types/Thing'
import type { NounSchema } from '../../../../types/Noun'
import {
  transformPayloadToThing,
  transformThingToPayload,
} from '../../src/adapter/transform'

/**
 * Field Transformation Tests
 *
 * These tests verify bidirectional field transformations between
 * Payload CMS documents and dotdo Things.
 *
 * Reference: dotdo-80c3 - A04 RED: Field transformation tests
 * Implementation: dotdo-eyas - A05 GREEN: Implement transforms
 */

// ============================================================================
// TEST FIXTURES
// ============================================================================

// Sample schema matching a Payload collection
const blogPostSchema: NounSchema = {
  title: 'string',
  slug: 'string',
  content: 'string',
  excerpt: 'string',
  publishedAt: 'date',
  views: 'number',
  isPublished: 'boolean',
  status: 'string',
  tags: 'string[]',
  author: '->User',
  featuredImage: '->Media',
  metadata: 'object',
}

const blogPostFields: PayloadField[] = [
  { type: 'text', name: 'title', required: true },
  { type: 'text', name: 'slug', required: true },
  { type: 'richText', name: 'content' },
  { type: 'textarea', name: 'excerpt' },
  { type: 'date', name: 'publishedAt' },
  { type: 'number', name: 'views' },
  { type: 'checkbox', name: 'isPublished' },
  {
    type: 'select',
    name: 'status',
    options: ['draft', 'review', 'published'] as const,
  },
  { type: 'array', name: 'tags', fields: [{ type: 'text', name: 'tag' }] },
  { type: 'relationship', name: 'author', relationTo: 'users' },
  { type: 'upload', name: 'featuredImage', relationTo: 'media' },
  {
    type: 'group',
    name: 'metadata',
    fields: [
      { type: 'text', name: 'seoTitle' },
      { type: 'textarea', name: 'seoDescription' },
    ],
  },
]

// Sample Payload document
const samplePayloadDoc = {
  id: 'post-123',
  title: 'Hello World',
  slug: 'hello-world',
  content: [
    {
      type: 'paragraph',
      children: [{ text: 'This is rich text content.' }],
    },
  ],
  excerpt: 'A short summary',
  publishedAt: new Date('2026-01-09T12:00:00.000Z'),
  views: 42,
  isPublished: true,
  status: 'published',
  tags: [{ tag: 'news' }, { tag: 'featured' }],
  author: 'user-456',
  featuredImage: 'media-789',
  metadata: {
    seoTitle: 'Hello World | Blog',
    seoDescription: 'Welcome to our blog',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-09T12:00:00.000Z',
}

// Sample Thing data
const sampleThingData: ThingData = {
  $id: 'https://example.do/posts/post-123',
  $type: 'https://example.do/Post',
  name: 'Hello World',
  data: {
    title: 'Hello World',
    slug: 'hello-world',
    content: JSON.stringify([
      {
        type: 'paragraph',
        children: [{ text: 'This is rich text content.' }],
      },
    ]),
    excerpt: 'A short summary',
    publishedAt: '2026-01-09T12:00:00.000Z',
    views: 42,
    isPublished: true,
    status: 'published',
    tags: ['news', 'featured'],
    author: 'user-456',
    featuredImage: 'media-789',
    metadata: {
      seoTitle: 'Hello World | Blog',
      seoDescription: 'Welcome to our blog',
    },
  },
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-09T12:00:00.000Z'),
}

// ============================================================================
// payloadToThing TRANSFORMATION TESTS
// ============================================================================

describe('Field Transformations', () => {
  describe('payloadToThing', () => {
    it('should transform text field to string', () => {
      const result = transformPayloadToThing(
        { id: '1', title: 'Hello' },
        'posts',
        'https://example.do',
        blogPostFields
      )
      expect(result.data?.title).toBe('Hello')
    })

    it('should transform number field to number', () => {
      const result = transformPayloadToThing(
        { id: '1', price: 99.99 },
        'products',
        'https://example.do',
        [{ type: 'number', name: 'price' }]
      )
      expect(result.data?.price).toBe(99.99)
    })

    it('should transform date field to ISO string', () => {
      const inputDate = new Date('2026-01-09T00:00:00.000Z')
      const result = transformPayloadToThing(
        { id: '1', publishedAt: inputDate },
        'posts',
        'https://example.do',
        [{ type: 'date', name: 'publishedAt' }]
      )
      expect(result.data?.publishedAt).toBe('2026-01-09T00:00:00.000Z')
    })

    it('should transform checkbox to boolean', () => {
      const result = transformPayloadToThing(
        { id: '1', isActive: true },
        'items',
        'https://example.do',
        [{ type: 'checkbox', name: 'isActive' }]
      )
      expect(result.data?.isActive).toBe(true)
    })

    it('should transform select to string', () => {
      const result = transformPayloadToThing(
        { id: '1', status: 'published' },
        'posts',
        'https://example.do',
        [{ type: 'select', name: 'status', options: ['draft', 'published'] }]
      )
      expect(result.data?.status).toBe('published')
    })

    it('should transform richText to JSON', () => {
      const richTextData = [
        { type: 'paragraph', children: [{ text: 'Hello world' }] },
      ]
      const result = transformPayloadToThing(
        { id: '1', content: richTextData },
        'posts',
        'https://example.do',
        [{ type: 'richText', name: 'content' }]
      )
      expect(typeof result.data?.content).toBe('string')
      expect(JSON.parse(result.data?.content as string)).toEqual(richTextData)
    })

    it('should transform array field to array', () => {
      const tagsData = [{ tag: 'news' }, { tag: 'featured' }]
      const result = transformPayloadToThing(
        { id: '1', tags: tagsData },
        'posts',
        'https://example.do',
        [{ type: 'array', name: 'tags', fields: [{ type: 'text', name: 'tag' }] }]
      )
      expect(Array.isArray(result.data?.tags)).toBe(true)
      expect(result.data?.tags).toEqual(['news', 'featured'])
    })

    it('should transform blocks field with blockType', () => {
      const blocksData = [
        { blockType: 'hero', heading: 'Welcome', image: 'img-1' },
        { blockType: 'content', text: 'Hello world' },
      ]
      const result = transformPayloadToThing(
        { id: '1', layout: blocksData },
        'pages',
        'https://example.do',
        [
          {
            type: 'blocks',
            name: 'layout',
          },
        ]
      )
      expect(Array.isArray(result.data?.layout)).toBe(true)
      expect((result.data?.layout as Array<{ blockType: string }>)[0].blockType).toBe('hero')
    })

    it('should transform group field to nested object', () => {
      const groupData = { seoTitle: 'Title', seoDescription: 'Desc' }
      const result = transformPayloadToThing(
        { id: '1', metadata: groupData },
        'posts',
        'https://example.do',
        [
          {
            type: 'group',
            name: 'metadata',
            fields: [
              { type: 'text', name: 'seoTitle' },
              { type: 'textarea', name: 'seoDescription' },
            ],
          },
        ]
      )
      expect(result.data?.metadata).toEqual(groupData)
    })

    it('should extract relationship IDs for relationship fields', () => {
      // Single relationship
      const result = transformPayloadToThing(
        { id: '1', author: 'user-456' },
        'posts',
        'https://example.do',
        [{ type: 'relationship', name: 'author', relationTo: 'users' }]
      )
      expect(result.data?.author).toBe('user-456')

      // With populated document
      const resultPopulated = transformPayloadToThing(
        { id: '1', author: { id: 'user-456', name: 'John' } },
        'posts',
        'https://example.do',
        [{ type: 'relationship', name: 'author', relationTo: 'users' }]
      )
      expect(resultPopulated.data?.author).toBe('user-456')
    })

    it('should handle upload field as URL reference', () => {
      const result = transformPayloadToThing(
        { id: '1', featuredImage: 'media-789' },
        'posts',
        'https://example.do',
        [{ type: 'upload', name: 'featuredImage', relationTo: 'media' }]
      )
      expect(result.data?.featuredImage).toBe('media-789')

      // With populated upload doc that has url
      const resultPopulated = transformPayloadToThing(
        { id: '1', featuredImage: { id: 'media-789', url: '/media/image.jpg' } },
        'posts',
        'https://example.do',
        [{ type: 'upload', name: 'featuredImage', relationTo: 'media' }]
      )
      expect(resultPopulated.data?.featuredImage).toBe('media-789')
    })

    it('should set Thing $id from collection and document id', () => {
      const result = transformPayloadToThing(
        { id: 'post-123', title: 'Test' },
        'posts',
        'https://example.do',
        blogPostFields
      )
      expect(result.$id).toBe('https://example.do/posts/post-123')
    })

    it('should set Thing $type from collection noun', () => {
      const result = transformPayloadToThing(
        { id: '1', title: 'Test' },
        'posts',
        'https://example.do',
        blogPostFields
      )
      expect(result.$type).toBe('https://example.do/Post')
    })

    it('should extract name from title field if present', () => {
      const result = transformPayloadToThing(
        { id: '1', title: 'My Blog Post' },
        'posts',
        'https://example.do',
        blogPostFields
      )
      expect(result.name).toBe('My Blog Post')
    })

    it('should parse timestamp strings to Date objects', () => {
      const result = transformPayloadToThing(
        {
          id: '1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-09T12:00:00.000Z',
        },
        'posts',
        'https://example.do',
        []
      )
      expect(result.createdAt).toBeInstanceOf(Date)
      expect(result.updatedAt).toBeInstanceOf(Date)
    })

    it('should handle hasMany relationship as array of IDs', () => {
      const result = transformPayloadToThing(
        { id: '1', categories: ['cat-1', 'cat-2', 'cat-3'] },
        'posts',
        'https://example.do',
        [{ type: 'relationship', name: 'categories', relationTo: 'categories', hasMany: true }]
      )
      expect(result.data?.categories).toEqual(['cat-1', 'cat-2', 'cat-3'])
    })
  })

  // ============================================================================
  // thingToPayload TRANSFORMATION TESTS
  // ============================================================================

  describe('thingToPayload', () => {
    it('should transform Thing data back to Payload document', () => {
      const result = transformThingToPayload(sampleThingData, blogPostFields)
      expect(result.id).toBe('post-123')
      expect(result.title).toBe('Hello World')
      expect(result.slug).toBe('hello-world')
    })

    it('should parse ISO date strings back to Date objects', () => {
      const thingWithDate: ThingData = {
        ...sampleThingData,
        data: {
          publishedAt: '2026-01-09T00:00:00.000Z',
        },
      }
      const result = transformThingToPayload(thingWithDate, [{ type: 'date', name: 'publishedAt' }])
      expect(result.publishedAt).toBeInstanceOf(Date)
      expect((result.publishedAt as Date).toISOString()).toBe('2026-01-09T00:00:00.000Z')
    })

    it('should preserve nested objects for group fields', () => {
      const thingWithGroup: ThingData = {
        ...sampleThingData,
        data: {
          metadata: {
            seoTitle: 'SEO Title',
            seoDescription: 'SEO Description',
          },
        },
      }
      const result = transformThingToPayload(thingWithGroup, [
        {
          type: 'group',
          name: 'metadata',
          fields: [
            { type: 'text', name: 'seoTitle' },
            { type: 'textarea', name: 'seoDescription' },
          ],
        },
      ])
      expect(result.metadata).toEqual({
        seoTitle: 'SEO Title',
        seoDescription: 'SEO Description',
      })
    })

    it('should handle null/undefined values', () => {
      const thingWithNulls: ThingData = {
        ...sampleThingData,
        data: {
          title: 'Test',
          subtitle: null,
          description: undefined,
        },
      }
      const result = transformThingToPayload(thingWithNulls, [
        { type: 'text', name: 'title' },
        { type: 'text', name: 'subtitle' },
        { type: 'textarea', name: 'description' },
      ])
      expect(result.title).toBe('Test')
      expect(result.subtitle).toBeNull()
      expect(result.description).toBeUndefined()
    })

    it('should convert JSON string back to richText structure', () => {
      const richTextJson = JSON.stringify([
        { type: 'paragraph', children: [{ text: 'Hello' }] },
      ])
      const thingWithRichText: ThingData = {
        ...sampleThingData,
        data: { content: richTextJson },
      }
      const result = transformThingToPayload(thingWithRichText, [{ type: 'richText', name: 'content' }])
      expect(Array.isArray(result.content)).toBe(true)
      expect((result.content as Array<{ type: string }>)[0].type).toBe('paragraph')
    })

    it('should extract document ID from Thing $id', () => {
      const result = transformThingToPayload(sampleThingData, blogPostFields)
      expect(result.id).toBe('post-123')
    })

    it('should convert flat array back to Payload array format', () => {
      const thingWithArray: ThingData = {
        ...sampleThingData,
        data: { tags: ['news', 'featured'] },
      }
      const result = transformThingToPayload(thingWithArray, [
        { type: 'array', name: 'tags', fields: [{ type: 'text', name: 'tag' }] },
      ])
      // Should convert back to Payload array format with named field
      expect(result.tags).toEqual([{ tag: 'news' }, { tag: 'featured' }])
    })

    it('should preserve blocks with blockType', () => {
      const thingWithBlocks: ThingData = {
        ...sampleThingData,
        data: {
          layout: [
            { blockType: 'hero', heading: 'Welcome' },
            { blockType: 'content', text: 'Body text' },
          ],
        },
      }
      const result = transformThingToPayload(thingWithBlocks, [
        {
          type: 'blocks',
          name: 'layout',
        },
      ])
      expect((result.layout as Array<{ blockType: string }>)[0].blockType).toBe('hero')
      expect((result.layout as Array<{ blockType: string }>)[1].blockType).toBe('content')
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle empty objects', () => {
      const emptyDoc = { id: '1' }
      const result = transformPayloadToThing(emptyDoc, 'items', 'https://example.do', [])
      expect(result.$id).toBe('https://example.do/items/1')
      expect(result.data).toEqual({})
    })

    it('should handle deeply nested data', () => {
      const deeplyNested = {
        id: '1',
        level1: {
          level2: {
            level3: {
              value: 'deep',
            },
          },
        },
      }
      const result = transformPayloadToThing(deeplyNested, 'items', 'https://example.do', [
        {
          type: 'group',
          name: 'level1',
          fields: [
            {
              type: 'group',
              name: 'level2',
              fields: [
                {
                  type: 'group',
                  name: 'level3',
                  fields: [{ type: 'text', name: 'value' }],
                },
              ],
            },
          ],
        },
      ])
      expect(
        (result.data?.level1 as { level2: { level3: { value: string } } })?.level2?.level3?.value
      ).toBe('deep')
    })

    it('should preserve unknown fields', () => {
      const docWithUnknown = {
        id: '1',
        title: 'Known',
        unknownField: 'should preserve',
        anotherUnknown: { nested: true },
      }
      const result = transformPayloadToThing(docWithUnknown, 'posts', 'https://example.do', [
        { type: 'text', name: 'title' },
      ])
      // Unknown fields should be preserved in data
      expect(result.data?.unknownField).toBe('should preserve')
      expect(result.data?.anotherUnknown).toEqual({ nested: true })
    })

    it('should handle special characters in field values', () => {
      const docWithSpecialChars = {
        id: '1',
        title: 'Test <script>alert("xss")</script>',
        content: 'Line1\nLine2\tTabbed',
      }
      const result = transformPayloadToThing(docWithSpecialChars, 'posts', 'https://example.do', [
        { type: 'text', name: 'title' },
        { type: 'textarea', name: 'content' },
      ])
      // Should preserve special characters as-is (sanitization is separate concern)
      expect(result.data?.title).toBe('Test <script>alert("xss")</script>')
      expect(result.data?.content).toBe('Line1\nLine2\tTabbed')
    })

    it('should handle polymorphic relationship values', () => {
      // Polymorphic relationships in Payload include relationTo in value
      const docWithPolymorphic = {
        id: '1',
        parent: { relationTo: 'pages', value: 'page-123' },
      }
      const result = transformPayloadToThing(docWithPolymorphic, 'posts', 'https://example.do', [
        { type: 'relationship', name: 'parent', relationTo: ['posts', 'pages'] },
      ])
      // Should extract the value and preserve relationTo context
      expect(result.data?.parent).toBe('page-123')
    })

    it('should handle empty arrays', () => {
      const docWithEmptyArrays = {
        id: '1',
        tags: [],
        categories: [],
      }
      const result = transformPayloadToThing(docWithEmptyArrays, 'posts', 'https://example.do', [
        { type: 'array', name: 'tags', fields: [] },
        { type: 'relationship', name: 'categories', relationTo: 'categories', hasMany: true },
      ])
      expect(result.data?.tags).toEqual([])
      expect(result.data?.categories).toEqual([])
    })

    it('should handle point field as [lng, lat] array', () => {
      const docWithPoint = {
        id: '1',
        location: [40.7128, -74.006], // [lng, lat]
      }
      const result = transformPayloadToThing(docWithPoint, 'locations', 'https://example.do', [
        { type: 'point', name: 'location' },
      ])
      expect(result.data?.location).toEqual([40.7128, -74.006])
    })

    it('should handle json field as raw JSON', () => {
      const docWithJson = {
        id: '1',
        settings: { theme: 'dark', notifications: true, items: [1, 2, 3] },
      }
      const result = transformPayloadToThing(docWithJson, 'users', 'https://example.do', [
        { type: 'json', name: 'settings' },
      ])
      // JSON fields should remain as objects (or stringify, depending on design)
      expect(result.data?.settings).toEqual({ theme: 'dark', notifications: true, items: [1, 2, 3] })
    })

    it('should handle code field as string', () => {
      const docWithCode = {
        id: '1',
        snippet: 'const x = 1;\nconsole.log(x);',
      }
      const result = transformPayloadToThing(docWithCode, 'snippets', 'https://example.do', [
        { type: 'code', name: 'snippet' },
      ])
      expect(result.data?.snippet).toBe('const x = 1;\nconsole.log(x);')
    })
  })

  // ============================================================================
  // ROUNDTRIP TESTS
  // ============================================================================

  describe('roundtrip transformations', () => {
    it('should preserve data through payload -> thing -> payload roundtrip', () => {
      const original = {
        id: 'test-1',
        title: 'Test Post',
        views: 100,
        isPublished: true,
        publishedAt: new Date('2026-01-09T00:00:00.000Z'),
        tags: [{ tag: 'test' }],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-09T00:00:00.000Z',
      }

      const thing = transformPayloadToThing(original, 'posts', 'https://example.do', blogPostFields)
      const roundtripped = transformThingToPayload(thing as ThingData, blogPostFields)

      expect(roundtripped.id).toBe(original.id)
      expect(roundtripped.title).toBe(original.title)
      expect(roundtripped.views).toBe(original.views)
      expect(roundtripped.isPublished).toBe(original.isPublished)
      expect((roundtripped.publishedAt as Date).toISOString()).toBe(
        original.publishedAt.toISOString()
      )
    })

    it('should preserve data through thing -> payload -> thing roundtrip', () => {
      const original = sampleThingData

      const payloadDoc = transformThingToPayload(original, blogPostFields)
      const roundtripped = transformPayloadToThing(
        payloadDoc as Record<string, unknown>,
        'posts',
        'https://example.do',
        blogPostFields
      )

      expect(roundtripped.$id).toBe(original.$id)
      expect(roundtripped.data?.title).toBe(original.data?.title)
      expect(roundtripped.data?.views).toBe(original.data?.views)
    })
  })
})
