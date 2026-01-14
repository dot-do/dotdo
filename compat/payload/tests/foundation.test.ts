/**
 * @dotdo/payload - Foundation Tests
 *
 * Tests for the adapter types and test harness (A01 + A02 + A03).
 * These tests verify that the foundation is correctly implemented
 * before proceeding with field transformations and query building.
 *
 * @module compat/payload/tests/foundation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createMockPayloadAdapter,
  FIXTURES,
  FIELD_DEFINITIONS,
  createFieldDefinition,
  createRelationshipField,
  createCollectionWithFixtures,
  type MockAdapterResult,
} from '../testing'
import type {
  PayloadAdapterConfig,
  PayloadThingData,
  PayloadWhereClause,
  ThingsWhereClause,
  PayloadFieldDefinition,
} from '../types'

// ============================================================================
// TEST HARNESS TESTS
// ============================================================================

describe('Payload Adapter Test Harness', () => {
  let result: MockAdapterResult

  beforeEach(() => {
    result = createMockPayloadAdapter()
  })

  afterEach(() => {
    result.reset({ clearData: true })
  })

  describe('createMockPayloadAdapter', () => {
    it('should create adapter with default configuration', () => {
      const { adapter } = result

      expect(adapter).toBeDefined()
      expect(adapter.name).toBe('dotdo')
      expect(adapter.packageName).toBe('@dotdo/payload')
      expect(adapter.defaultIDType).toBe('text')
      expect(adapter.allowIDOnCreate).toBe(true)
    })

    it('should accept custom configuration', () => {
      const customResult = createMockPayloadAdapter({
        config: {
          ns: 'https://custom.payload.do',
          softDelete: false,
          defaultVisibility: 'public',
          typePrefix: 'cms_',
        },
      })

      expect(customResult.adapter.config.ns).toBe('https://custom.payload.do')
      expect(customResult.adapter.config.softDelete).toBe(false)
      expect(customResult.adapter.config.defaultVisibility).toBe('public')
      expect(customResult.adapter.config.typePrefix).toBe('cms_')
    })

    it('should provide operation tracking', () => {
      const { adapter, operations } = result

      expect(operations).toEqual([])
      expect(adapter.operations).toEqual([])
    })

    it('should provide reset function', () => {
      const { adapter, reset } = result

      // Add some data
      adapter.create({ collection: 'posts', data: { title: 'Test' } })

      // Reset tracking only
      reset()
      expect(adapter.operations).toEqual([])

      // Reset with data clear
      reset({ clearData: true })
      expect(adapter.collections.size).toBe(0)
    })
  })

  describe('Pre-populated fixtures', () => {
    it('should load collections with fixtures', () => {
      const withFixtures = createMockPayloadAdapter({
        collections: {
          posts: [FIXTURES.simplePost],
          users: [FIXTURES.user],
        },
      })

      expect(withFixtures.adapter.collections.get('posts')?._data.size).toBe(1)
      expect(withFixtures.adapter.collections.get('users')?._data.size).toBe(1)
    })

    it('should load globals with fixtures', () => {
      const withGlobals = createMockPayloadAdapter({
        globals: {
          settings: FIXTURES.settings,
        },
      })

      expect(withGlobals.adapter.globals._data.get('settings')).toEqual(FIXTURES.settings)
    })

    it('should load many posts for pagination tests', () => {
      const withManyPosts = createMockPayloadAdapter({
        collections: {
          posts: FIXTURES.manyPosts,
        },
      })

      expect(withManyPosts.adapter.collections.get('posts')?._data.size).toBe(25)
    })
  })
})

// ============================================================================
// CRUD OPERATION TESTS
// ============================================================================

describe('Payload Adapter CRUD Operations', () => {
  let result: MockAdapterResult

  beforeEach(() => {
    result = createMockPayloadAdapter()
  })

  afterEach(() => {
    result.reset({ clearData: true })
  })

  describe('create', () => {
    it('should create a document with auto-generated ID', async () => {
      const { adapter } = result

      const doc = await adapter.create({
        collection: 'posts',
        data: { title: 'New Post', content: 'Content here' },
      })

      expect(doc).toBeDefined()
      expect(doc.id).toBeDefined()
      expect(doc.title).toBe('New Post')
      expect(doc.createdAt).toBeDefined()
      expect(doc.updatedAt).toBeDefined()
    })

    it('should create a document with provided ID', async () => {
      const { adapter } = result

      const doc = await adapter.create({
        collection: 'posts',
        data: { id: 'custom-id', title: 'Custom ID Post' },
      })

      expect(doc.id).toBe('custom-id')
    })

    it('should track create operation', async () => {
      const { adapter, expectOperation } = result

      await adapter.create({
        collection: 'posts',
        data: { title: 'Tracked Post' },
      })

      expectOperation('create', 'posts')
    })
  })

  describe('findOne', () => {
    it('should find a document by ID', async () => {
      const { adapter } = result

      // Create first
      await adapter.create({
        collection: 'posts',
        data: { id: 'find-me', title: 'Find Me' },
      })

      // Find it
      const found = await adapter.findOne({
        collection: 'posts',
        where: { id: { equals: 'find-me' } },
      })

      expect(found).toBeDefined()
      expect(found?.id).toBe('find-me')
      expect(found?.title).toBe('Find Me')
    })

    it('should return null when document not found', async () => {
      const { adapter } = result

      const found = await adapter.findOne({
        collection: 'posts',
        where: { id: { equals: 'nonexistent' } },
      })

      expect(found).toBeNull()
    })

    it('should track findOne operation', async () => {
      const { adapter, expectOperation } = result

      await adapter.findOne({
        collection: 'posts',
        where: { id: { equals: 'any' } },
      })

      expectOperation('findOne', 'posts')
    })
  })

  describe('find', () => {
    it('should find multiple documents', async () => {
      const withPosts = createMockPayloadAdapter({
        collections: { posts: FIXTURES.manyPosts },
      })

      const result = await withPosts.adapter.find({
        collection: 'posts',
        limit: 10,
      })

      expect(result.docs).toHaveLength(10)
      expect(result.totalDocs).toBe(25)
      expect(result.totalPages).toBe(3)
      expect(result.hasNextPage).toBe(true)
    })

    it('should filter with where clause', async () => {
      const withPosts = createMockPayloadAdapter({
        collections: { posts: FIXTURES.manyPosts },
      })

      const result = await withPosts.adapter.find({
        collection: 'posts',
        where: { status: { equals: 'draft' } },
      })

      // Every third post is draft (i % 3 === 0), so 9 drafts in 25 posts
      expect(result.docs.every((d) => d.status === 'draft')).toBe(true)
    })

    it('should handle pagination', async () => {
      const withPosts = createMockPayloadAdapter({
        collections: { posts: FIXTURES.manyPosts },
      })

      const page1 = await withPosts.adapter.find({
        collection: 'posts',
        limit: 10,
        page: 1,
      })

      const page2 = await withPosts.adapter.find({
        collection: 'posts',
        limit: 10,
        page: 2,
      })

      expect(page1.page).toBe(1)
      expect(page2.page).toBe(2)
      expect(page1.hasPrevPage).toBe(false)
      expect(page1.hasNextPage).toBe(true)
      expect(page2.hasPrevPage).toBe(true)
    })
  })

  describe('count', () => {
    it('should count all documents', async () => {
      const withPosts = createMockPayloadAdapter({
        collections: { posts: FIXTURES.manyPosts },
      })

      const result = await withPosts.adapter.count({ collection: 'posts' })

      expect(result.totalDocs).toBe(25)
    })

    it('should count with filter', async () => {
      const withPosts = createMockPayloadAdapter({
        collections: { posts: FIXTURES.manyPosts },
      })

      const result = await withPosts.adapter.count({
        collection: 'posts',
        where: { status: { equals: 'published' } },
      })

      // 25 - 9 drafts = 16 published
      expect(result.totalDocs).toBe(16)
    })
  })

  describe('updateOne', () => {
    it('should update a document by ID', async () => {
      const { adapter } = result

      await adapter.create({
        collection: 'posts',
        data: { id: 'update-me', title: 'Original Title' },
      })

      const updated = await adapter.updateOne({
        collection: 'posts',
        id: 'update-me',
        data: { title: 'Updated Title' },
      })

      expect(updated.title).toBe('Updated Title')
      expect(updated.id).toBe('update-me')
    })

    it('should update a document by where clause', async () => {
      const { adapter } = result

      await adapter.create({
        collection: 'posts',
        data: { id: 'update-where', title: 'Find By Where' },
      })

      const updated = await adapter.updateOne({
        collection: 'posts',
        where: { title: { equals: 'Find By Where' } },
        data: { title: 'Found and Updated' },
      })

      expect(updated.title).toBe('Found and Updated')
    })

    it('should throw when document not found', async () => {
      const { adapter } = result

      await expect(
        adapter.updateOne({
          collection: 'posts',
          id: 'nonexistent',
          data: { title: 'New Title' },
        })
      ).rejects.toThrow()
    })
  })

  describe('updateMany', () => {
    it('should update multiple documents', async () => {
      const withPosts = createMockPayloadAdapter({
        collections: { posts: FIXTURES.manyPosts },
      })

      const updated = await withPosts.adapter.updateMany({
        collection: 'posts',
        where: { status: { equals: 'draft' } },
        data: { status: 'archived' },
      })

      expect(updated).not.toBeNull()
      expect(updated!.length).toBe(9) // 9 drafts
      expect(updated!.every((d) => d.status === 'archived')).toBe(true)
    })

    it('should respect limit', async () => {
      const withPosts = createMockPayloadAdapter({
        collections: { posts: FIXTURES.manyPosts },
      })

      const updated = await withPosts.adapter.updateMany({
        collection: 'posts',
        where: { status: { equals: 'draft' } },
        data: { status: 'archived' },
        limit: 3,
      })

      expect(updated!.length).toBe(3)
    })
  })

  describe('deleteOne', () => {
    it('should soft delete by default', async () => {
      const { adapter } = result

      await adapter.create({
        collection: 'posts',
        data: { id: 'delete-me', title: 'To Be Deleted' },
      })

      const deleted = await adapter.deleteOne({
        collection: 'posts',
        where: { id: { equals: 'delete-me' } },
      })

      expect(deleted).toBeDefined()
      expect((deleted as Record<string, unknown>)._deleted).toBe(true)
    })

    it('should hard delete when configured', async () => {
      const hardDeleteAdapter = createMockPayloadAdapter({
        config: { softDelete: false },
      })

      await hardDeleteAdapter.adapter.create({
        collection: 'posts',
        data: { id: 'hard-delete', title: 'Hard Delete' },
      })

      await hardDeleteAdapter.adapter.deleteOne({
        collection: 'posts',
        where: { id: { equals: 'hard-delete' } },
      })

      const found = await hardDeleteAdapter.adapter.findOne({
        collection: 'posts',
        where: { id: { equals: 'hard-delete' } },
      })

      expect(found).toBeNull()
    })
  })

  describe('deleteMany', () => {
    it('should delete multiple documents', async () => {
      const withPosts = createMockPayloadAdapter({
        collections: { posts: FIXTURES.manyPosts },
        config: { softDelete: false },
      })

      await withPosts.adapter.deleteMany({
        collection: 'posts',
        where: { status: { equals: 'draft' } },
      })

      const remaining = await withPosts.adapter.count({ collection: 'posts' })
      expect(remaining.totalDocs).toBe(16) // 25 - 9 drafts
    })
  })

  describe('upsert', () => {
    it('should create when document does not exist', async () => {
      const { adapter } = result

      const doc = await adapter.upsert({
        collection: 'posts',
        where: { id: { equals: 'upsert-new' } },
        data: { title: 'Upserted New' },
      })

      expect(doc.title).toBe('Upserted New')
    })

    it('should update when document exists', async () => {
      const { adapter } = result

      await adapter.create({
        collection: 'posts',
        data: { id: 'upsert-existing', title: 'Original' },
      })

      const doc = await adapter.upsert({
        collection: 'posts',
        where: { id: { equals: 'upsert-existing' } },
        data: { title: 'Upserted Update' },
      })

      expect(doc.title).toBe('Upserted Update')
    })
  })
})

// ============================================================================
// TRANSACTION TESTS
// ============================================================================

describe('Payload Adapter Transactions', () => {
  let result: MockAdapterResult

  beforeEach(() => {
    result = createMockPayloadAdapter()
  })

  afterEach(() => {
    result.reset({ clearData: true })
  })

  it('should begin transaction', async () => {
    const { adapter, expectOperation } = result

    const txId = await adapter.beginTransaction()

    expect(txId).toBeDefined()
    expect(typeof txId).toBe('string')
    expectOperation('beginTransaction')
  })

  it('should commit transaction', async () => {
    const { adapter, expectOperation } = result

    const txId = await adapter.beginTransaction()
    await adapter.commitTransaction(txId)

    expectOperation('commitTransaction')
  })

  it('should rollback transaction', async () => {
    const { adapter, expectOperation } = result

    const txId = await adapter.beginTransaction()
    await adapter.rollbackTransaction(txId)

    expectOperation('rollbackTransaction')
  })
})

// ============================================================================
// GLOBAL OPERATIONS TESTS
// ============================================================================

describe('Payload Adapter Global Operations', () => {
  let result: MockAdapterResult

  beforeEach(() => {
    result = createMockPayloadAdapter()
  })

  afterEach(() => {
    result.reset({ clearData: true })
  })

  describe('createGlobal', () => {
    it('should create a global document', async () => {
      const { adapter } = result

      const global = await adapter.createGlobal({
        slug: 'settings',
        data: { siteName: 'My Site' },
      })

      expect(global.id).toBe('settings')
      expect(global.siteName).toBe('My Site')
    })
  })

  describe('findGlobal', () => {
    it('should find a global document', async () => {
      const withSettings = createMockPayloadAdapter({
        globals: { settings: FIXTURES.settings },
      })

      const global = await withSettings.adapter.findGlobal({ slug: 'settings' })

      expect(global.siteName).toBe('Test Site')
    })

    it('should return empty global when not found', async () => {
      const { adapter } = result

      const global = await adapter.findGlobal({ slug: 'nonexistent' })

      expect(global.id).toBe('nonexistent')
    })
  })

  describe('updateGlobal', () => {
    it('should update a global document', async () => {
      const withSettings = createMockPayloadAdapter({
        globals: { settings: FIXTURES.settings },
      })

      const updated = await withSettings.adapter.updateGlobal({
        slug: 'settings',
        data: { siteName: 'Updated Site' },
      })

      expect(updated.siteName).toBe('Updated Site')
    })
  })
})

// ============================================================================
// VERSION OPERATIONS TESTS
// ============================================================================

describe('Payload Adapter Version Operations', () => {
  let result: MockAdapterResult

  beforeEach(() => {
    result = createMockPayloadAdapter()
  })

  afterEach(() => {
    result.reset({ clearData: true })
  })

  describe('createVersion', () => {
    it('should create a version', async () => {
      const { adapter } = result

      await adapter.create({
        collection: 'posts',
        data: { id: 'versioned-post', title: 'Version 1' },
      })

      const version = await adapter.createVersion({
        collectionSlug: 'posts',
        parent: 'versioned-post',
        versionData: { title: 'Version 1' },
        autosave: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      expect(version.parent).toBe('versioned-post')
      expect(version.version).toBeDefined()
    })
  })

  describe('findVersions', () => {
    it('should find versions for a collection', async () => {
      const { adapter } = result

      // Create a post and some versions
      await adapter.create({
        collection: 'posts',
        data: { id: 'post-with-versions', title: 'Original' },
      })

      await adapter.createVersion({
        collectionSlug: 'posts',
        parent: 'post-with-versions',
        versionData: { title: 'Version 1' },
        autosave: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      await adapter.createVersion({
        collectionSlug: 'posts',
        parent: 'post-with-versions',
        versionData: { title: 'Version 2' },
        autosave: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const versions = await adapter.findVersions({ collection: 'posts' })

      expect(versions.totalDocs).toBe(2)
    })
  })

  describe('deleteVersions', () => {
    it('should delete versions', async () => {
      const { adapter, expectOperation } = result

      await adapter.deleteVersions({
        collection: 'posts',
        where: { id: { equals: 'any' } },
      })

      expectOperation('deleteVersions', 'posts')
    })
  })
})

// ============================================================================
// TYPE MAPPING TESTS
// ============================================================================

describe('Payload Adapter Type Mapping', () => {
  let result: MockAdapterResult

  beforeEach(() => {
    result = createMockPayloadAdapter()
  })

  describe('getTypeUrl', () => {
    it('should generate correct type URL', () => {
      const { adapter } = result

      const url = adapter.getTypeUrl('posts')

      expect(url).toBe('https://test.payload.do/posts')
    })

    it('should include type prefix when configured', () => {
      const withPrefix = createMockPayloadAdapter({
        config: { typePrefix: 'cms_' },
      })

      const url = withPrefix.adapter.getTypeUrl('posts')

      expect(url).toBe('https://test.payload.do/cms_posts')
    })
  })

  describe('getThingId', () => {
    it('should generate correct Thing ID', () => {
      const { adapter } = result

      const id = adapter.getThingId('posts', 'abc123')

      expect(id).toBe('https://test.payload.do/posts/abc123')
    })
  })

  describe('toThing', () => {
    it('should transform Payload document to Thing', () => {
      const { adapter } = result

      const thing = adapter.toThing('posts', {
        id: 'post-1',
        title: 'My Post',
        content: 'Content here',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      })

      expect(thing.$id).toBe('https://test.payload.do/posts/post-1')
      expect(thing.$type).toBe('https://test.payload.do/posts')
      expect(thing.name).toBe('My Post')
      expect(thing._collection).toBe('posts')
      expect(thing._payloadId).toBe('post-1')
    })

    it('should use name field if title not present', () => {
      const { adapter } = result

      const thing = adapter.toThing('users', {
        id: 'user-1',
        name: 'John Doe',
        email: 'john@example.com',
      })

      expect(thing.name).toBe('John Doe')
    })
  })

  describe('fromThing', () => {
    it('should transform Thing back to Payload document', () => {
      const { adapter } = result

      const thing: PayloadThingData = {
        $id: 'https://test.payload.do/posts/post-1',
        $type: 'https://test.payload.do/posts',
        name: 'My Post',
        data: { title: 'My Post', content: 'Content' },
        visibility: 'user',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        _collection: 'posts',
        _payloadId: 'post-1',
      }

      const doc = adapter.fromThing(thing)

      expect(doc.id).toBe('post-1')
      expect(doc.title).toBe('My Post')
      expect(doc.createdAt).toBeDefined()
      expect(doc.updatedAt).toBeDefined()
    })
  })
})

// ============================================================================
// WHERE CLAUSE TRANSLATION TESTS
// ============================================================================

describe('Payload Adapter Query Translation', () => {
  let result: MockAdapterResult

  beforeEach(() => {
    result = createMockPayloadAdapter()
  })

  describe('translateWhere', () => {
    it('should translate equals operator', () => {
      const { adapter } = result

      const translated = adapter.translateWhere(
        { status: { equals: 'published' } },
        'posts'
      )

      expect(translated.field).toBe('status')
      expect(translated.operator).toBe('eq')
      expect(translated.value).toBe('published')
    })

    it('should translate not_equals operator', () => {
      const { adapter } = result

      const translated = adapter.translateWhere(
        { status: { not_equals: 'draft' } },
        'posts'
      )

      expect(translated.field).toBe('status')
      expect(translated.operator).toBe('ne')
      expect(translated.value).toBe('draft')
    })

    it('should translate greater_than operator', () => {
      const { adapter } = result

      const translated = adapter.translateWhere(
        { price: { greater_than: 100 } },
        'products'
      )

      expect(translated.field).toBe('price')
      expect(translated.operator).toBe('gt')
      expect(translated.value).toBe(100)
    })

    it('should translate less_than operator', () => {
      const { adapter } = result

      const translated = adapter.translateWhere(
        { quantity: { less_than: 10 } },
        'products'
      )

      expect(translated.field).toBe('quantity')
      expect(translated.operator).toBe('lt')
      expect(translated.value).toBe(10)
    })

    it('should translate in operator', () => {
      const { adapter } = result

      const translated = adapter.translateWhere(
        { category: { in: ['tech', 'science'] } },
        'posts'
      )

      expect(translated.field).toBe('category')
      expect(translated.operator).toBe('in')
      expect(translated.value).toEqual(['tech', 'science'])
    })

    it('should translate like operator', () => {
      const { adapter } = result

      const translated = adapter.translateWhere(
        { title: { like: 'Hello' } },
        'posts'
      )

      expect(translated.field).toBe('title')
      expect(translated.operator).toBe('like')
      expect(translated.value).toBe('Hello')
    })

    it('should translate contains operator', () => {
      const { adapter } = result

      const translated = adapter.translateWhere(
        { content: { contains: 'important' } },
        'posts'
      )

      expect(translated.field).toBe('content')
      expect(translated.operator).toBe('ilike')
      expect(translated.value).toBe('%important%')
    })
  })
})

// ============================================================================
// FIELD DEFINITION TESTS
// ============================================================================

describe('Payload Adapter Field Definitions', () => {
  describe('createFieldDefinition', () => {
    it('should create a simple field definition', () => {
      const field = createFieldDefinition('title', 'text')

      expect(field.name).toBe('title')
      expect(field.type).toBe('text')
    })

    it('should accept options', () => {
      const field = createFieldDefinition('email', 'email', {
        required: true,
        unique: true,
      })

      expect(field.required).toBe(true)
      expect(field.unique).toBe(true)
    })
  })

  describe('createRelationshipField', () => {
    it('should create a relationship field', () => {
      const field = createRelationshipField('author', 'users')

      expect(field.name).toBe('author')
      expect(field.type).toBe('relationship')
      expect(field.relationTo).toBe('users')
      expect(field.hasMany).toBe(false)
    })

    it('should create a hasMany relationship', () => {
      const field = createRelationshipField('tags', 'tags', true)

      expect(field.hasMany).toBe(true)
    })

    it('should support multiple relation targets', () => {
      const field = createRelationshipField('media', ['images', 'videos'])

      expect(field.relationTo).toEqual(['images', 'videos'])
    })
  })

  describe('FIELD_DEFINITIONS', () => {
    it('should have posts fields', () => {
      expect(FIELD_DEFINITIONS.posts).toBeDefined()
      expect(FIELD_DEFINITIONS.posts.length).toBeGreaterThan(0)

      const titleField = FIELD_DEFINITIONS.posts.find((f) => f.name === 'title')
      expect(titleField?.type).toBe('text')
      expect(titleField?.required).toBe(true)
    })

    it('should have users fields', () => {
      expect(FIELD_DEFINITIONS.users).toBeDefined()

      const emailField = FIELD_DEFINITIONS.users.find((f) => f.name === 'email')
      expect(emailField?.type).toBe('email')
      expect(emailField?.unique).toBe(true)
    })

    it('should have media fields', () => {
      expect(FIELD_DEFINITIONS.media).toBeDefined()

      const filenameField = FIELD_DEFINITIONS.media.find((f) => f.name === 'filename')
      expect(filenameField?.type).toBe('text')
    })
  })
})

// ============================================================================
// FIXTURES TESTS
// ============================================================================

describe('Payload Adapter Fixtures', () => {
  describe('FIXTURES', () => {
    it('should have simplePost fixture', () => {
      expect(FIXTURES.simplePost.id).toBe('post-1')
      expect(FIXTURES.simplePost.title).toBe('Test Post')
    })

    it('should have user fixture', () => {
      expect(FIXTURES.user.id).toBe('user-1')
      expect(FIXTURES.user.email).toBe('test@example.com')
    })

    it('should have postWithAuthor fixture with relationship', () => {
      expect(FIXTURES.postWithAuthor.author).toBe('user-1')
    })

    it('should have manyPosts for pagination tests', () => {
      expect(FIXTURES.manyPosts.length).toBe(25)
      expect(FIXTURES.manyPosts[0]?.title).toBe('Post 1')
      expect(FIXTURES.manyPosts[24]?.title).toBe('Post 25')
    })

    it('should have settings global fixture', () => {
      expect(FIXTURES.settings.siteName).toBe('Test Site')
    })
  })

  describe('createCollectionWithFixtures', () => {
    it('should create collection from array fixture', () => {
      const collections = createCollectionWithFixtures('manyPosts')

      expect(collections.posts).toBeDefined()
      expect(collections.posts.length).toBe(25)
    })

    it('should create collection from single fixture', () => {
      const collections = createCollectionWithFixtures('simplePost')

      expect(collections.posts).toBeDefined()
      expect(collections.posts.length).toBe(1)
    })

    it('should handle user fixture', () => {
      const collections = createCollectionWithFixtures('user')

      expect(collections.users).toBeDefined()
      expect(collections.users.length).toBe(1)
    })
  })
})

// ============================================================================
// ASSERTION HELPER TESTS
// ============================================================================

describe('Payload Adapter Assertion Helpers', () => {
  let result: MockAdapterResult

  beforeEach(() => {
    result = createMockPayloadAdapter()
  })

  describe('expectOperation', () => {
    it('should pass when operation exists', async () => {
      const { adapter, expectOperation } = result

      await adapter.create({
        collection: 'posts',
        data: { title: 'Test' },
      })

      // Should not throw
      expect(() => expectOperation('create', 'posts')).not.toThrow()
    })

    it('should throw when operation does not exist', () => {
      const { expectOperation } = result

      expect(() => expectOperation('create', 'posts')).toThrow('Expected operation')
    })

    it('should match by type only', async () => {
      const { adapter, expectOperation } = result

      await adapter.create({
        collection: 'posts',
        data: { title: 'Test' },
      })

      expect(() => expectOperation('create')).not.toThrow()
    })
  })

  describe('getOperations', () => {
    it('should return operations of specific type', async () => {
      const { adapter, getOperations } = result

      await adapter.create({ collection: 'posts', data: { title: 'Post 1' } })
      await adapter.create({ collection: 'posts', data: { title: 'Post 2' } })
      await adapter.findOne({ collection: 'posts', where: { id: { equals: 'any' } } })

      const creates = getOperations('create')
      expect(creates.length).toBe(2)

      const finds = getOperations('findOne')
      expect(finds.length).toBe(1)
    })
  })
})

// ============================================================================
// MIGRATION TESTS (Stubs)
// ============================================================================

describe('Payload Adapter Migration Operations', () => {
  let result: MockAdapterResult

  beforeEach(() => {
    result = createMockPayloadAdapter()
  })

  it('should track migrate operation', async () => {
    const { adapter, expectOperation } = result

    await adapter.migrate()

    expectOperation('migrate')
  })

  it('should track migrateDown operation', async () => {
    const { adapter, expectOperation } = result

    await adapter.migrateDown()

    expectOperation('migrateDown')
  })

  it('should track migrateFresh and clear data', async () => {
    const withData = createMockPayloadAdapter({
      collections: { posts: [FIXTURES.simplePost] },
    })

    expect(withData.adapter.collections.get('posts')?._data.size).toBe(1)

    await withData.adapter.migrateFresh({ forceAcceptWarning: true })

    withData.expectOperation('migrateFresh')
    expect(withData.adapter.collections.size).toBe(0)
  })
})
