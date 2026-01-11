/**
 * @dotdo/payload Integration Tests
 *
 * End-to-end tests verifying the full flow of adapter + auth + plugin working together.
 * These tests exercise the complete system behavior rather than individual components.
 *
 * Test Categories:
 * 1. Full CRUD Flow - Document lifecycle with versions and relationships
 * 2. Auth + Access Control Flow - Authentication and authorization integration
 * 3. Transaction Flow - Atomic operations with commit/rollback
 * 4. Global + Plugin Flow - Global settings and plugin hooks
 * 5. Migration Flow - Database migrations and schema management
 *
 * @module @dotdo/payload/tests/integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPayloadAdapterHarness, type PayloadAdapterHarness } from '../src'
import {
  createCollectionAccess,
  generateAccessFunctions,
  type PayloadRequest,
  type CollectionAccessConfig,
} from '../auth/collection-access'
import { authenticate, createBetterAuthStrategy, type StrategyConfig } from '../auth/strategy'

// ============================================================================
// Test Fixtures
// ============================================================================

/** Sample post data */
const samplePost = {
  title: 'Integration Test Post',
  slug: 'integration-test-post',
  content: 'This is content for integration testing',
  status: 'draft',
}

/** Sample user data */
const sampleUser = {
  name: 'Test User',
  email: 'test@example.com.ai',
}

/** Sample admin user data */
const sampleAdmin = {
  name: 'Admin User',
  email: 'admin@example.com.ai',
}

/** Sample category data */
const sampleCategory = {
  name: 'Technology',
  slug: 'technology',
}

/** Sample media data */
const sampleMedia = {
  filename: 'test-image.png',
  mimeType: 'image/png',
  url: '/uploads/test-image.png',
}

/** Sample global settings data */
const sampleSettings = {
  siteName: 'Integration Test Site',
  siteDescription: 'A site for integration testing',
  maintenanceMode: false,
  defaultLanguage: 'en',
}

/** Sample migration definition */
interface Migration {
  name: string
  timestamp: number
  up: () => Promise<void>
  down: () => Promise<void>
}

/** Create test migration */
function createTestMigration(name: string, timestamp: number): Migration {
  return {
    name,
    timestamp,
    up: async () => {},
    down: async () => {},
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Create a mock request with user info */
function createMockRequest(
  userOverrides: Partial<NonNullable<PayloadRequest['user']>> = {}
): PayloadRequest {
  return {
    user: {
      id: 'user-001',
      role: 'user',
      collection: 'users',
      activeOrganizationId: null,
      organizationRole: null,
      isSuperAdmin: false,
      ...userOverrides,
    },
  }
}

/** Create an admin request */
function createAdminRequest(
  overrides: Partial<NonNullable<PayloadRequest['user']>> = {}
): PayloadRequest {
  return createMockRequest({
    id: 'admin-001',
    role: 'admin',
    ...overrides,
  })
}

/** Create an unauthenticated request */
function createUnauthenticatedRequest(): PayloadRequest {
  return { user: null }
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration Tests', () => {
  // ==========================================================================
  // 1. Full CRUD Flow
  // ==========================================================================

  describe('Full CRUD Flow', () => {
    let harness: PayloadAdapterHarness

    beforeEach(() => {
      harness = createPayloadAdapterHarness({
        namespace: 'https://integration.test.do',
      })
    })

    it('should create, read, update, and delete a document', async () => {
      const adapter = harness.adapter as any

      // Create
      const created = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      expect(created.id).toBeDefined()
      expect(created.title).toBe('Integration Test Post')
      expect(created.createdAt).toBeDefined()
      expect(created.updatedAt).toBeDefined()

      // Read
      const found = await adapter.findOne({
        collection: 'posts',
        id: created.id,
      })

      expect(found).not.toBeNull()
      expect(found?.id).toBe(created.id)
      expect(found?.title).toBe('Integration Test Post')

      // Update
      const updated = await adapter.updateOne({
        collection: 'posts',
        id: created.id,
        data: { title: 'Updated Title', status: 'published' },
      })

      expect(updated.title).toBe('Updated Title')
      expect(updated.status).toBe('published')
      expect(updated.slug).toBe('integration-test-post') // Unchanged

      // Verify update persisted
      const afterUpdate = await adapter.findOne({
        collection: 'posts',
        id: created.id,
      })

      expect(afterUpdate?.title).toBe('Updated Title')

      // Delete
      await adapter.deleteOne({
        collection: 'posts',
        id: created.id,
      })

      // Verify deleted
      const afterDelete = await adapter.findOne({
        collection: 'posts',
        id: created.id,
      })

      expect(afterDelete).toBeNull()
    })

    it('should create document with versions tracked', async () => {
      const adapter = harness.adapter as any

      // Create document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create initial version
      const version1 = await adapter.createVersion({
        collection: 'posts',
        id: doc.id,
      })

      expect(version1.id).toBeDefined()
      expect(version1.parent).toBe(doc.id)
      expect(version1.versionNumber).toBe(1)
      expect(version1.version?.title).toBe('Integration Test Post')

      // Update document
      await adapter.updateOne({
        collection: 'posts',
        id: doc.id,
        data: { title: 'Version 2 Title' },
      })

      // Create second version
      const version2 = await adapter.createVersion({
        collection: 'posts',
        id: doc.id,
      })

      expect(version2.versionNumber).toBe(2)
      expect(version2.version?.title).toBe('Version 2 Title')

      // Find all versions
      const versions = await adapter.findVersions({
        collection: 'posts',
        id: doc.id,
      })

      expect(versions.totalDocs).toBe(2)
    })

    it('should track relationships between documents', async () => {
      const adapter = harness.adapter as any

      // Create author
      const author = await adapter.create({
        collection: 'users',
        data: sampleUser,
      })

      // Create category
      const category = await adapter.create({
        collection: 'categories',
        data: sampleCategory,
      })

      // Create post with relationships
      const post = await adapter.create({
        collection: 'posts',
        data: {
          ...samplePost,
          author: author.id,
          categories: [category.id],
        },
      })

      expect(post.author).toBe(author.id)
      expect(post.categories).toContain(category.id)

      // Verify relationships are stored
      const relationships = harness.relationships.list({
        verb: 'hasAuthor',
      })

      expect(relationships.length).toBeGreaterThan(0)
      expect(relationships.some((r) => r.to.includes(author.id))).toBe(true)
    })

    it('should sync documents to Things store', async () => {
      const adapter = harness.adapter as any

      // Create document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Check Things store
      const thingId = `https://integration.test.do/posts/${doc.id}`
      const thing = harness.things.get(thingId)

      expect(thing).toBeDefined()
      expect(thing?.$id).toBe(thingId)
      expect(thing?.$type).toBe('https://integration.test.do/posts')
      expect(thing?.data?.title).toBe('Integration Test Post')
    })

    it('should handle complex nested data in CRUD operations', async () => {
      const adapter = harness.adapter as any

      // Create document with nested data
      const doc = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Complex Post',
          slug: 'complex-post',
          metadata: {
            seoTitle: 'SEO Title',
            seoDescription: 'SEO Description',
          },
          tags: [{ tag: 'typescript' }, { tag: 'testing' }],
          layout: [
            { blockType: 'paragraph', text: 'Hello' },
            { blockType: 'image', url: '/img.png' },
          ],
        },
      })

      expect(doc.metadata.seoTitle).toBe('SEO Title')
      expect(doc.tags).toHaveLength(2)
      expect(doc.layout).toHaveLength(2)

      // Update nested data
      await adapter.updateOne({
        collection: 'posts',
        id: doc.id,
        data: {
          metadata: {
            seoTitle: 'Updated SEO Title',
            seoDescription: 'Updated SEO Description',
          },
        },
      })

      const updated = await adapter.findOne({
        collection: 'posts',
        id: doc.id,
      })

      expect(updated?.metadata.seoTitle).toBe('Updated SEO Title')
    })
  })

  // ==========================================================================
  // 2. Auth + Access Control Flow
  // ==========================================================================

  describe('Auth + Access Control Flow', () => {
    let harness: PayloadAdapterHarness
    let accessConfig: CollectionAccessConfig

    beforeEach(() => {
      harness = createPayloadAdapterHarness({
        namespace: 'https://auth.test.do',
      })

      accessConfig = {
        collection: 'posts',
        roles: {
          admin: { create: true, read: true, update: true, delete: true },
          user: { create: true, read: 'own', update: 'own', delete: false },
        },
        ownerField: 'createdBy',
        superAdminBypass: true,
      }
    })

    it('should authenticate with session token', async () => {
      // Create mock session validator
      const sessionValidator = {
        validate: vi.fn().mockResolvedValue({
          valid: true,
          user: { id: 'user-123', email: 'test@example.com.ai' },
        }),
      }

      const strategyConfig: StrategyConfig = {
        sessionValidator,
        config: {
          usersCollection: 'users',
          sessionCookieName: 'better-auth.session_token',
          apiKeyHeader: 'x-api-key',
          autoCreateUsers: false,
        },
      }

      // Create headers with session cookie (using default Better Auth cookie name)
      const headers = new Headers()
      headers.set('Cookie', 'better-auth.session_token=valid-token-123')

      const result = await authenticate(
        { payload: {}, headers },
        strategyConfig
      )

      expect(result.user).toBeDefined()
      expect(result.user?.id).toBe('user-123')
      expect(sessionValidator.validate).toHaveBeenCalledWith('valid-token-123')
    })

    it('should grant admin full access to all documents', async () => {
      const access = createCollectionAccess(accessConfig)
      const adminReq = createAdminRequest()

      const createResult = await access.create({ req: adminReq })
      const readResult = await access.read({ req: adminReq })
      const updateResult = await access.update({ req: adminReq })
      const deleteResult = await access.delete({ req: adminReq })

      expect(createResult).toBe(true)
      expect(readResult).toBe(true)
      expect(updateResult).toBe(true)
      expect(deleteResult).toBe(true)
    })

    it('should restrict user to own documents only', async () => {
      const access = createCollectionAccess(accessConfig)
      const userReq = createMockRequest({ id: 'user-456', role: 'user' })

      const readResult = await access.read({ req: userReq })
      const updateResult = await access.update({ req: userReq })
      const deleteResult = await access.delete({ req: userReq })

      // Read and update should return ownership filter
      expect(readResult).toEqual({ createdBy: { equals: 'user-456' } })
      expect(updateResult).toEqual({ createdBy: { equals: 'user-456' } })

      // Delete should be denied
      expect(deleteResult).toBe(false)
    })

    it('should deny unauthenticated users access', async () => {
      const access = createCollectionAccess(accessConfig)
      const unauthReq = createUnauthenticatedRequest()

      const createResult = await access.create({ req: unauthReq })
      const readResult = await access.read({ req: unauthReq })
      const updateResult = await access.update({ req: unauthReq })
      const deleteResult = await access.delete({ req: unauthReq })

      expect(createResult).toBe(false)
      expect(readResult).toBe(false)
      expect(updateResult).toBe(false)
      expect(deleteResult).toBe(false)
    })

    it('should integrate access control with adapter operations', async () => {
      const adapter = harness.adapter as any
      const access = createCollectionAccess(accessConfig)

      // Create document as admin
      const doc = await adapter.create({
        collection: 'posts',
        data: {
          ...samplePost,
          createdBy: 'user-123',
        },
      })

      // Verify user-123 can access their own document
      const userReq = createMockRequest({ id: 'user-123', role: 'user' })
      const readAccess = await access.read({ req: userReq })

      expect(readAccess).toEqual({ createdBy: { equals: 'user-123' } })

      // Verify different user cannot access the document
      const otherUserReq = createMockRequest({ id: 'user-456', role: 'user' })
      const otherReadAccess = await access.read({ req: otherUserReq })

      expect(otherReadAccess).toEqual({ createdBy: { equals: 'user-456' } })
    })

    it('should handle field-level access restrictions', async () => {
      const fieldAccessConfig: CollectionAccessConfig = {
        collection: 'users',
        roles: {
          admin: { read: true, update: true },
          user: { read: true, update: 'own' },
        },
        fields: {
          salary: {
            read: ['admin'],
            update: ['admin'],
          },
          email: {
            read: ['admin', 'user'],
            update: ['admin', 'user'],
          },
        },
      }

      const access = generateAccessFunctions(fieldAccessConfig)

      const adminReq = createAdminRequest()
      const userReq = createMockRequest({ role: 'user' })

      // Admin can read salary
      expect(await access.fields?.salary.read({ req: adminReq })).toBe(true)

      // User cannot read salary
      expect(await access.fields?.salary.read({ req: userReq })).toBe(false)

      // Both can read email
      expect(await access.fields?.email.read({ req: adminReq })).toBe(true)
      expect(await access.fields?.email.read({ req: userReq })).toBe(true)
    })

    it('should allow super-admin to bypass all restrictions', async () => {
      const restrictiveConfig: CollectionAccessConfig = {
        collection: 'sensitive-data',
        superAdminBypass: true,
        roles: {
          admin: { read: 'org', update: 'org', delete: false },
          user: { read: false, update: false, delete: false },
        },
      }

      const access = createCollectionAccess(restrictiveConfig)
      const superAdminReq = createMockRequest({
        id: 'superadmin-001',
        role: 'admin',
        isSuperAdmin: true,
      })

      expect(await access.read({ req: superAdminReq })).toBe(true)
      expect(await access.update({ req: superAdminReq })).toBe(true)
      expect(await access.delete({ req: superAdminReq })).toBe(true)
    })

    it('should create Better Auth strategy for Payload', () => {
      const sessionValidator = {
        validate: vi.fn().mockResolvedValue({ valid: true, user: { id: 'user-123', email: 'test@example.com.ai' } }),
      }

      const strategy = createBetterAuthStrategy({
        sessionValidator,
        config: {
          usersCollection: 'users',
          sessionCookieName: 'session_token',
          apiKeyHeader: 'x-api-key',
        },
      })

      expect(strategy.name).toBe('better-auth')
      expect(typeof strategy.authenticate).toBe('function')
    })
  })

  // ==========================================================================
  // 3. Transaction Flow
  // ==========================================================================

  describe('Transaction Flow', () => {
    let harness: PayloadAdapterHarness

    beforeEach(() => {
      harness = createPayloadAdapterHarness({
        namespace: 'https://tx.test.do',
      })
    })

    it('should commit transaction and persist all documents', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()

      // Create multiple documents in transaction
      const post1 = await adapter.create({
        collection: 'posts',
        data: { title: 'Post 1', slug: 'post-1' },
        transaction: tx,
      })

      const post2 = await adapter.create({
        collection: 'posts',
        data: { title: 'Post 2', slug: 'post-2' },
        transaction: tx,
      })

      const user = await adapter.create({
        collection: 'users',
        data: { name: 'Transaction User', email: 'tx@test.com' },
        transaction: tx,
      })

      // Commit transaction
      await adapter.commitTransaction(tx)

      // Verify all documents persisted
      const posts = await adapter.find({ collection: 'posts' })
      const users = await adapter.find({ collection: 'users' })

      expect(posts.docs).toHaveLength(2)
      expect(users.docs).toHaveLength(1)

      // Verify Things store synced
      expect(harness.things.list().length).toBe(3)
    })

    it('should rollback transaction and discard all changes', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()

      // Create documents in transaction
      await adapter.create({
        collection: 'posts',
        data: { title: 'Rollback Post 1', slug: 'rollback-1' },
        transaction: tx,
      })

      await adapter.create({
        collection: 'posts',
        data: { title: 'Rollback Post 2', slug: 'rollback-2' },
        transaction: tx,
      })

      // Rollback transaction
      await adapter.rollbackTransaction(tx)

      // Verify no documents persisted
      const posts = await adapter.find({ collection: 'posts' })
      expect(posts.docs).toHaveLength(0)

      // Verify Things store empty
      expect(harness.things.list().length).toBe(0)
    })

    it('should handle create, update, delete in single transaction', async () => {
      const adapter = harness.adapter as any

      // Pre-create some documents
      const existingPost = await adapter.create({
        collection: 'posts',
        data: { title: 'Existing Post', slug: 'existing' },
      })

      const toDeletePost = await adapter.create({
        collection: 'posts',
        data: { title: 'To Delete', slug: 'to-delete' },
      })

      const tx = await adapter.beginTransaction()

      // Create new
      await adapter.create({
        collection: 'posts',
        data: { title: 'New Post', slug: 'new-post' },
        transaction: tx,
      })

      // Update existing
      await adapter.updateOne({
        collection: 'posts',
        id: existingPost.id,
        data: { title: 'Updated Existing' },
        transaction: tx,
      })

      // Delete
      await adapter.deleteOne({
        collection: 'posts',
        id: toDeletePost.id,
        transaction: tx,
      })

      // Commit
      await adapter.commitTransaction(tx)

      // Verify final state
      const posts = await adapter.find({ collection: 'posts' })
      expect(posts.docs).toHaveLength(2)

      const titles = posts.docs.map((p: any) => p.title)
      expect(titles).toContain('Updated Existing')
      expect(titles).toContain('New Post')
      expect(titles).not.toContain('To Delete')
    })

    it('should use transaction callback style with auto-commit', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.transaction(async (tx: any) => {
        const post = await adapter.create({
          collection: 'posts',
          data: { title: 'Callback Post', slug: 'callback-post' },
          transaction: tx,
        })

        const user = await adapter.create({
          collection: 'users',
          data: { name: 'Callback User', email: 'callback@test.com' },
          transaction: tx,
        })

        return { post, user }
      })

      expect(result.post).toBeDefined()
      expect(result.user).toBeDefined()

      // Verify persisted
      const posts = await adapter.find({ collection: 'posts' })
      expect(posts.docs).toHaveLength(1)
    })

    it('should auto-rollback on transaction callback error', async () => {
      const adapter = harness.adapter as any

      await expect(
        adapter.transaction(async (tx: any) => {
          await adapter.create({
            collection: 'posts',
            data: { title: 'Will Rollback', slug: 'will-rollback' },
            transaction: tx,
          })

          throw new Error('Transaction failed!')
        })
      ).rejects.toThrow('Transaction failed!')

      // Verify nothing persisted
      const posts = await adapter.find({ collection: 'posts' })
      expect(posts.docs).toHaveLength(0)
    })

    it('should support savepoints within transaction', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()

      // Create first document
      await adapter.create({
        collection: 'posts',
        data: { title: 'Before Savepoint', slug: 'before-sp' },
        transaction: tx,
      })

      // Create savepoint
      const sp = await adapter.savepoint(tx, 'sp1')

      // Create second document after savepoint
      await adapter.create({
        collection: 'posts',
        data: { title: 'After Savepoint', slug: 'after-sp' },
        transaction: tx,
      })

      // Rollback to savepoint
      await adapter.rollbackToSavepoint(tx, sp)

      // Commit transaction
      await adapter.commitTransaction(tx)

      // Only first post should exist
      const posts = await adapter.find({ collection: 'posts' })
      expect(posts.docs).toHaveLength(1)
      expect(posts.docs[0].title).toBe('Before Savepoint')
    })
  })

  // ==========================================================================
  // 4. Global + Plugin Flow
  // ==========================================================================

  describe('Global + Plugin Flow', () => {
    let harness: PayloadAdapterHarness

    beforeEach(() => {
      harness = createPayloadAdapterHarness({
        namespace: 'https://global.test.do',
      })
    })

    it('should update global settings and persist', async () => {
      const adapter = harness.adapter as any

      // Update global
      const result = await adapter.updateGlobal({
        slug: 'settings',
        data: sampleSettings,
      })

      expect(result.siteName).toBe('Integration Test Site')
      expect(result.maintenanceMode).toBe(false)

      // Find global
      const found = await adapter.findGlobal({ slug: 'settings' })

      expect(found.siteName).toBe('Integration Test Site')
      expect(found.createdAt).toBeDefined()
      expect(found.updatedAt).toBeDefined()
    })

    it('should update existing global with merge', async () => {
      const adapter = harness.adapter as any

      // Create initial global
      await adapter.updateGlobal({
        slug: 'settings',
        data: sampleSettings,
      })

      // Update only some fields
      await adapter.updateGlobal({
        slug: 'settings',
        data: {
          siteName: 'Updated Site Name',
          maintenanceMode: true,
        },
      })

      // Verify merge
      const found = await adapter.findGlobal({ slug: 'settings' })

      expect(found.siteName).toBe('Updated Site Name')
      expect(found.maintenanceMode).toBe(true)
      expect(found.siteDescription).toBe('A site for integration testing') // Preserved
    })

    it('should store global as Thing with fixed path', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'settings',
        data: sampleSettings,
      })

      // Check Things store
      const thingId = 'https://global.test.do/globals/settings'
      const thing = harness.things.get(thingId)

      expect(thing).toBeDefined()
      expect(thing?.$id).toBe(thingId)
      expect(thing?.$type).toBe('https://global.test.do/globals')
    })

    it('should call plugin hooks on create', async () => {
      const beforeCreateCalls: Array<{ collection: string; data: any }> = []
      const afterCreateCalls: Array<{ collection: string; doc: any }> = []

      const adapter = harness.adapter as any
      adapter.hooks = {
        beforeCreate: async (args: { collection: string; data: any }) => {
          beforeCreateCalls.push({ collection: args.collection, data: { ...args.data } })
          return args.data
        },
        afterCreate: async (args: { collection: string; doc: any }) => {
          afterCreateCalls.push({ collection: args.collection, doc: { ...args.doc } })
        },
      }

      await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      expect(beforeCreateCalls).toHaveLength(1)
      expect(beforeCreateCalls[0].collection).toBe('posts')
      expect(beforeCreateCalls[0].data.title).toBe('Integration Test Post')

      expect(afterCreateCalls).toHaveLength(1)
      expect(afterCreateCalls[0].collection).toBe('posts')
      expect(afterCreateCalls[0].doc.title).toBe('Integration Test Post')
    })

    it('should support global versioning', async () => {
      const adapter = harness.adapter as any

      // Create global
      await adapter.updateGlobal({
        slug: 'settings',
        data: { siteName: 'Version 1' },
      })

      // Create version
      await adapter.createGlobalVersion({ slug: 'settings' })

      // Update global
      await adapter.updateGlobal({
        slug: 'settings',
        data: { siteName: 'Version 2' },
      })

      // Create another version
      await adapter.createGlobalVersion({ slug: 'settings' })

      // Find versions
      const versions = await adapter.findGlobalVersions({ slug: 'settings' })

      expect(versions.totalDocs).toBe(2)
    })

    it('should list all globals', async () => {
      const adapter = harness.adapter as any

      // Create multiple globals
      await adapter.updateGlobal({ slug: 'header', data: { logo: 'logo.png' } })
      await adapter.updateGlobal({ slug: 'footer', data: { copyright: '2026' } })
      await adapter.updateGlobal({ slug: 'settings', data: sampleSettings })

      // List all globals
      const globals = await adapter.getGlobals()

      expect(globals).toHaveLength(3)
      expect(globals.map((g: any) => g.slug).sort()).toEqual(['footer', 'header', 'settings'])
    })

    it('should restore global to previous version', async () => {
      const adapter = harness.adapter as any

      // Create global
      await adapter.updateGlobal({
        slug: 'settings',
        data: { siteName: 'Original', theme: 'light' },
      })

      // Create version 1
      await adapter.createGlobalVersion({ slug: 'settings' })

      // Update
      await adapter.updateGlobal({
        slug: 'settings',
        data: { siteName: 'Updated', theme: 'dark' },
      })

      // Verify current state
      const current = await adapter.findGlobal({ slug: 'settings' })
      expect(current.siteName).toBe('Updated')

      // Restore to version 1
      await adapter.restoreGlobalVersion({
        slug: 'settings',
        versionNumber: 1,
      })

      // Verify restored
      const restored = await adapter.findGlobal({ slug: 'settings' })
      expect(restored.siteName).toBe('Original')
      expect(restored.theme).toBe('light')
    })
  })

  // ==========================================================================
  // 5. Migration Flow
  // ==========================================================================

  describe('Migration Flow', () => {
    let harness: PayloadAdapterHarness

    beforeEach(() => {
      harness = createPayloadAdapterHarness({
        namespace: 'https://migration.test.do',
      })
    })

    it('should register and run migrations', async () => {
      const adapter = harness.adapter as any

      const migration1 = createTestMigration('20260109_001_create_posts', Date.parse('2026-01-09T00:00:00Z'))
      const migration2 = createTestMigration('20260109_002_add_views', Date.parse('2026-01-09T01:00:00Z'))

      adapter.registerMigrations([migration1, migration2])

      const result = await adapter.migrate()

      expect(result.ran).toHaveLength(2)
      expect(result.ran[0].name).toBe('20260109_001_create_posts')
      expect(result.ran[1].name).toBe('20260109_002_add_views')
    })

    it('should check migration status', async () => {
      const adapter = harness.adapter as any

      const migration1 = createTestMigration('20260109_001_create_posts', Date.parse('2026-01-09T00:00:00Z'))
      const migration2 = createTestMigration('20260109_002_add_views', Date.parse('2026-01-09T01:00:00Z'))

      adapter.registerMigrations([migration1, migration2])

      // Run only first migration
      await adapter.migrate({ only: '20260109_001_create_posts' })

      const status = await adapter.migrateStatus()

      expect(status.total).toBe(2)
      expect(status.ran).toBe(1)
      expect(status.pending).toBe(1)
    })

    it('should get migration history', async () => {
      const adapter = harness.adapter as any

      const migration1 = createTestMigration('20260109_001_create_posts', Date.parse('2026-01-09T00:00:00Z'))
      const migration2 = createTestMigration('20260109_002_add_views', Date.parse('2026-01-09T01:00:00Z'))

      adapter.registerMigrations([migration1, migration2])
      await adapter.migrate()

      const history = await adapter.getMigrationHistory()

      expect(history).toHaveLength(2)
      expect(history[0].name).toBe('20260109_001_create_posts')
      expect(history[0].batch).toBe(1)
      expect(history[0].ranAt).toBeDefined()
    })

    it('should rollback migrations with migrateDown', async () => {
      const adapter = harness.adapter as any
      const executionOrder: string[] = []

      const migration1 = {
        name: '20260109_001_create_posts',
        timestamp: Date.parse('2026-01-09T00:00:00Z'),
        up: async () => executionOrder.push('posts_up'),
        down: async () => executionOrder.push('posts_down'),
      }

      const migration2 = {
        name: '20260109_002_add_views',
        timestamp: Date.parse('2026-01-09T01:00:00Z'),
        up: async () => executionOrder.push('views_up'),
        down: async () => executionOrder.push('views_down'),
      }

      adapter.registerMigrations([migration1, migration2])
      await adapter.migrate()

      // Clear execution order
      executionOrder.length = 0

      // Rollback
      const result = await adapter.migrateDown()

      expect(result.rolledBack).toHaveLength(2)
      expect(executionOrder).toEqual(['views_down', 'posts_down'])
    })

    it('should refresh migrations (rollback and re-run)', async () => {
      const adapter = harness.adapter as any
      const executionOrder: string[] = []

      const migration = {
        name: '20260109_001_test',
        timestamp: Date.now(),
        up: async () => executionOrder.push('up'),
        down: async () => executionOrder.push('down'),
      }

      adapter.registerMigrations([migration])
      await adapter.migrate()

      executionOrder.length = 0

      // Refresh
      await adapter.migrateRefresh()

      expect(executionOrder).toEqual(['down', 'up'])
    })

    it('should run fresh migrations (drop all and re-run)', async () => {
      const adapter = harness.adapter as any

      // Create some data
      await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      const migration = createTestMigration('20260109_001_test', Date.now())
      adapter.registerMigrations([migration])
      await adapter.migrate()

      // Run fresh
      const result = await adapter.migrateFresh()

      expect(result.dropped).toBe(true)
      expect(result.ran).toHaveLength(1)

      // Data should be gone
      const posts = await adapter.find({ collection: 'posts' })
      expect(posts.docs).toHaveLength(0)
    })

    it('should create new migration file', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.migrateCreate({ name: 'add_users_table' })

      expect(result).toBeDefined()
      expect(result.name).toMatch(/add_users_table/)
      expect(result.path).toBeDefined()
      expect(result.template).toContain('up')
      expect(result.template).toContain('down')
    })

    it('should call schema hooks during migration', async () => {
      const adapter = harness.adapter as any
      const hookCalls: string[] = []

      adapter.hooks = {
        beforeSchemaInit: async ({ schema }: { schema: any }) => {
          hookCalls.push('beforeSchemaInit')
          return schema
        },
        afterSchemaInit: async ({ schema }: { schema: any }) => {
          hookCalls.push('afterSchemaInit')
          return schema
        },
      }

      const migration = createTestMigration('20260109_001_test', Date.now())
      adapter.registerMigrations([migration])

      await adapter.migrate()

      expect(hookCalls).toContain('beforeSchemaInit')
      expect(hookCalls).toContain('afterSchemaInit')
    })
  })

  // ==========================================================================
  // Cross-Cutting Concerns
  // ==========================================================================

  describe('Cross-Cutting Integration', () => {
    let harness: PayloadAdapterHarness

    beforeEach(() => {
      harness = createPayloadAdapterHarness({
        namespace: 'https://cross.test.do',
      })
    })

    it('should handle complete workflow: auth, create, version, update, transaction', async () => {
      const adapter = harness.adapter as any

      // Setup access control
      const access = createCollectionAccess({
        collection: 'posts',
        roles: {
          admin: { create: true, read: true, update: true, delete: true },
          user: { create: true, read: 'own', update: 'own', delete: false },
        },
      })

      // Verify admin has access
      const adminReq = createAdminRequest()
      expect(await access.create({ req: adminReq })).toBe(true)

      // Create user
      const user = await adapter.create({
        collection: 'users',
        data: { name: 'Workflow User', email: 'workflow@test.com' },
      })

      // Start transaction
      const tx = await adapter.beginTransaction()

      // Create post in transaction
      const post = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Workflow Post',
          slug: 'workflow-post',
          author: user.id,
          createdBy: user.id,
        },
        transaction: tx,
      })

      // Commit transaction
      await adapter.commitTransaction(tx)

      // Create version
      await adapter.createVersion({
        collection: 'posts',
        id: post.id,
      })

      // Update post
      await adapter.updateOne({
        collection: 'posts',
        id: post.id,
        data: { title: 'Updated Workflow Post', status: 'published' },
      })

      // Create another version
      await adapter.createVersion({
        collection: 'posts',
        id: post.id,
      })

      // Verify state
      const versions = await adapter.findVersions({
        collection: 'posts',
        id: post.id,
      })

      expect(versions.totalDocs).toBe(2)

      const finalPost = await adapter.findOne({
        collection: 'posts',
        id: post.id,
      })

      expect(finalPost?.title).toBe('Updated Workflow Post')
      expect(finalPost?.status).toBe('published')
    })

    it('should track all operations across different operation types', async () => {
      const adapter = harness.adapter as any

      // Create
      const post = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Find
      await adapter.find({ collection: 'posts' })

      // FindOne
      await adapter.findOne({ collection: 'posts', id: post.id })

      // Update
      await adapter.updateOne({
        collection: 'posts',
        id: post.id,
        data: { title: 'Updated' },
      })

      // CreateVersion
      await adapter.createVersion({ collection: 'posts', id: post.id })

      // UpdateGlobal
      await adapter.updateGlobal({ slug: 'settings', data: sampleSettings })

      // FindGlobal
      await adapter.findGlobal({ slug: 'settings' })

      // Count
      await adapter.count({ collection: 'posts' })

      // Delete
      await adapter.deleteOne({ collection: 'posts', id: post.id })

      // Check operations tracked
      const operationTypes = harness.operations.map((op) => op.type)

      expect(operationTypes).toContain('create')
      expect(operationTypes).toContain('find')
      expect(operationTypes).toContain('findOne')
      expect(operationTypes).toContain('update')
      expect(operationTypes).toContain('delete')
    })

    it('should maintain data consistency across stores', async () => {
      const adapter = harness.adapter as any

      // Create document
      const post = await adapter.create({
        collection: 'posts',
        data: {
          ...samplePost,
          author: 'user-123',
        },
      })

      // Verify collection store
      const collectionDocs = await adapter.find({ collection: 'posts' })
      expect(collectionDocs.docs).toHaveLength(1)

      // Verify Things store
      const things = harness.things.list({ type: 'https://cross.test.do/posts' })
      expect(things).toHaveLength(1)

      // Verify relationships store
      const relationships = harness.relationships.list({ verb: 'hasAuthor' })
      expect(relationships.some((r) => r.to.includes('user-123'))).toBe(true)

      // Update and verify consistency
      await adapter.updateOne({
        collection: 'posts',
        id: post.id,
        data: { title: 'Consistency Test Updated' },
      })

      const updatedThing = harness.things.get(`https://cross.test.do/posts/${post.id}`)
      expect(updatedThing?.data?.title).toBe('Consistency Test Updated')

      // Delete and verify consistency
      await adapter.deleteOne({ collection: 'posts', id: post.id })

      const deletedThing = harness.things.get(`https://cross.test.do/posts/${post.id}`)
      // Things store uses soft-delete (marks as deleted) rather than hard delete
      expect(deletedThing?.$deleted).toBe(true)
    })

    it('should handle reset and restore seed data', async () => {
      const seedHarness = createPayloadAdapterHarness({
        namespace: 'https://seed.test.do',
        seed: {
          posts: [
            { id: 'seed-1', title: 'Seed Post 1', slug: 'seed-1' },
            { id: 'seed-2', title: 'Seed Post 2', slug: 'seed-2' },
          ],
        },
        resetBehavior: 'restore-seed',
      })

      const adapter = seedHarness.adapter as any

      // Verify seed data
      let posts = await adapter.find({ collection: 'posts' })
      expect(posts.docs).toHaveLength(2)

      // Add more data
      await adapter.create({
        collection: 'posts',
        data: { title: 'New Post', slug: 'new-post' },
      })

      posts = await adapter.find({ collection: 'posts' })
      expect(posts.docs).toHaveLength(3)

      // Reset
      seedHarness.reset()

      // Should be back to seed state
      posts = await adapter.find({ collection: 'posts' })
      expect(posts.docs).toHaveLength(2)
      expect(posts.docs[0].title).toBe('Seed Post 1')
    })
  })
})
