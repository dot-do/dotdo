/**
 * Auth Migration Tests - Drizzle to Graph Migration
 *
 * Tests for migrating auth data from Drizzle/D1 tables to the Graph model.
 *
 * @see auth/migration.ts - Migration utilities
 *
 * These tests verify:
 * - User migration with all fields
 * - Session migration with belongsTo relationships
 * - Account migration with linkedTo relationships
 * - Organization migration
 * - Member migration as memberOf relationships
 * - Migration verification
 * - Idempotent migration (skipExisting)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SQLiteGraphStore } from '../../db/graph/stores'
import type { GraphStore } from '../../db/graph/types'
import type {
  MigrationConfig,
  MigrationProgress,
  MigrationResult,
  VerificationResult,
} from '../migration'

// ============================================================================
// MOCK DRIZZLE DATABASE
// ============================================================================

/**
 * Mock user record from Drizzle
 */
interface MockUser {
  id: string
  email: string
  name: string
  emailVerified: boolean
  image: string | null
  role: string
  banned: boolean
  banReason: string | null
  banExpires: Date | null
  stripeCustomerId: string | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Mock session record from Drizzle
 */
interface MockSession {
  id: string
  userId: string
  token: string
  expiresAt: Date
  ipAddress: string | null
  userAgent: string | null
  activeOrganizationId: string | null
  activeTeamId: string | null
  impersonatedBy: string | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Mock account record from Drizzle
 */
interface MockAccount {
  id: string
  userId: string
  accountId: string
  providerId: string
  accessToken: string | null
  refreshToken: string | null
  accessTokenExpiresAt: Date | null
  refreshTokenExpiresAt: Date | null
  scope: string | null
  idToken: string | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Mock organization record from Drizzle
 */
interface MockOrganization {
  id: string
  name: string
  slug: string
  logo: string | null
  metadata: Record<string, unknown> | null
  tenantNs: string | null
  region: string | null
  createdAt: Date
}

/**
 * Mock member record from Drizzle
 */
interface MockMember {
  id: string
  userId: string
  organizationId: string
  role: string
  createdAt: Date
}

/**
 * Create a mock Drizzle database with test data
 */
function createMockDrizzleDb(data: {
  users?: MockUser[]
  sessions?: MockSession[]
  accounts?: MockAccount[]
  organizations?: MockOrganization[]
  members?: MockMember[]
}) {
  return {
    query: {
      users: {
        findMany: vi.fn().mockResolvedValue(data.users ?? []),
      },
      sessions: {
        findMany: vi.fn().mockResolvedValue(data.sessions ?? []),
      },
      accounts: {
        findMany: vi.fn().mockResolvedValue(data.accounts ?? []),
      },
      organizations: {
        findMany: vi.fn().mockResolvedValue(data.organizations ?? []),
      },
      members: {
        findMany: vi.fn().mockResolvedValue(data.members ?? []),
      },
    },
  }
}

/**
 * Create test user
 */
function createTestUser(overrides: Partial<MockUser> = {}): MockUser {
  const now = new Date()
  return {
    id: `user-${Math.random().toString(36).slice(2, 9)}`,
    email: `user-${Math.random().toString(36).slice(2, 9)}@example.com`,
    name: 'Test User',
    emailVerified: false,
    image: null,
    role: 'user',
    banned: false,
    banReason: null,
    banExpires: null,
    stripeCustomerId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/**
 * Create test session
 */
function createTestSession(userId: string, overrides: Partial<MockSession> = {}): MockSession {
  const now = new Date()
  return {
    id: `session-${Math.random().toString(36).slice(2, 9)}`,
    userId,
    token: `token-${Math.random().toString(36).slice(2, 20)}`,
    expiresAt: new Date(Date.now() + 86400000),
    ipAddress: null,
    userAgent: null,
    activeOrganizationId: null,
    activeTeamId: null,
    impersonatedBy: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/**
 * Create test account
 */
function createTestAccount(userId: string, overrides: Partial<MockAccount> = {}): MockAccount {
  const now = new Date()
  return {
    id: `account-${Math.random().toString(36).slice(2, 9)}`,
    userId,
    accountId: `provider-account-${Math.random().toString(36).slice(2, 9)}`,
    providerId: 'github',
    accessToken: null,
    refreshToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    scope: null,
    idToken: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/**
 * Create test organization
 */
function createTestOrganization(overrides: Partial<MockOrganization> = {}): MockOrganization {
  const slug = `org-${Math.random().toString(36).slice(2, 9)}`
  return {
    id: `org-${Math.random().toString(36).slice(2, 9)}`,
    name: 'Test Organization',
    slug,
    logo: null,
    metadata: null,
    tenantNs: slug,
    region: null,
    createdAt: new Date(),
    ...overrides,
  }
}

/**
 * Create test member
 */
function createTestMember(userId: string, organizationId: string, overrides: Partial<MockMember> = {}): MockMember {
  return {
    id: `member-${Math.random().toString(36).slice(2, 9)}`,
    userId,
    organizationId,
    role: 'member',
    createdAt: new Date(),
    ...overrides,
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Auth Migration - Drizzle to Graph', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // MIGRATION FUNCTION IMPORT TEST
  // ==========================================================================

  describe('Migration Module Import', () => {
    it('exports migrateAuthToGraph function', async () => {
      const migration = await import('../migration')
      expect(typeof migration.migrateAuthToGraph).toBe('function')
    })

    it('exports verifyMigration function', async () => {
      const migration = await import('../migration')
      expect(typeof migration.verifyMigration).toBe('function')
    })

    it('exports isMigrationComplete function', async () => {
      const migration = await import('../migration')
      expect(typeof migration.isMigrationComplete).toBe('function')
    })

    it('exports getMigrationStatus function', async () => {
      const migration = await import('../migration')
      expect(typeof migration.getMigrationStatus).toBe('function')
    })
  })

  // ==========================================================================
  // USER MIGRATION TESTS
  // ==========================================================================

  describe('User Migration', () => {
    it('migrates users to Graph store', async () => {
      const users = [
        createTestUser({ id: 'user-1', email: 'alice@example.com', name: 'Alice' }),
        createTestUser({ id: 'user-2', email: 'bob@example.com', name: 'Bob' }),
      ]

      const mockDb = createMockDrizzleDb({ users })
      const migration = await import('../migration')

      const result = await migration.migrateAuthToGraph({
        db: mockDb as any,
        graphStore: store,
      })

      expect(result.users.total).toBe(2)
      expect(result.users.migrated).toBe(2)
      expect(result.users.errors).toBe(0)

      // Verify users in Graph
      const graphUsers = await store.getThingsByType({ typeName: 'User' })
      expect(graphUsers.length).toBe(2)
    })

    it('preserves all user fields during migration', async () => {
      const user = createTestUser({
        id: 'user-full',
        email: 'full@example.com',
        name: 'Full User',
        emailVerified: true,
        image: 'https://example.com/avatar.jpg',
        role: 'admin',
        banned: true,
        banReason: 'test ban',
        banExpires: new Date(Date.now() + 86400000),
        stripeCustomerId: 'cus_123',
      })

      const mockDb = createMockDrizzleDb({ users: [user] })
      const migration = await import('../migration')

      await migration.migrateAuthToGraph({
        db: mockDb as any,
        graphStore: store,
      })

      const thing = await store.getThing('user-full')
      expect(thing).not.toBeNull()

      const data = thing?.data as Record<string, unknown>
      expect(data.email).toBe('full@example.com')
      expect(data.name).toBe('Full User')
      expect(data.emailVerified).toBe(true)
      expect(data.image).toBe('https://example.com/avatar.jpg')
      expect(data.role).toBe('admin')
      expect(data.banned).toBe(true)
      expect(data.banReason).toBe('test ban')
      expect(data.stripeCustomerId).toBe('cus_123')
    })

    it('skips existing users when skipExisting is true', async () => {
      // Pre-create a user in Graph
      await store.createThing({
        id: 'user-existing',
        typeId: 1,
        typeName: 'User',
        data: { email: 'existing@example.com', name: 'Existing' },
      })

      const users = [
        createTestUser({ id: 'user-existing', email: 'existing@example.com' }),
        createTestUser({ id: 'user-new', email: 'new@example.com' }),
      ]

      const mockDb = createMockDrizzleDb({ users })
      const migration = await import('../migration')

      const result = await migration.migrateAuthToGraph({
        db: mockDb as any,
        graphStore: store,
        skipExisting: true,
      })

      expect(result.users.total).toBe(2)
      expect(result.users.migrated).toBe(1)
      expect(result.users.skipped).toBe(1)
    })
  })

  // ==========================================================================
  // SESSION MIGRATION TESTS
  // ==========================================================================

  describe('Session Migration', () => {
    it('migrates sessions with belongsTo relationships', async () => {
      const user = createTestUser({ id: 'user-1' })
      const sessions = [
        createTestSession('user-1', { id: 'session-1' }),
        createTestSession('user-1', { id: 'session-2' }),
      ]

      const mockDb = createMockDrizzleDb({ users: [user], sessions })
      const migration = await import('../migration')

      const result = await migration.migrateAuthToGraph({
        db: mockDb as any,
        graphStore: store,
      })

      expect(result.sessions.migrated).toBe(2)

      // Verify belongsTo relationships
      const rels1 = await store.queryRelationshipsFrom('auth://sessions/session-1')
      expect(rels1.some((r) => r.verb === 'belongsTo' && r.to === 'auth://users/user-1')).toBe(true)

      const rels2 = await store.queryRelationshipsFrom('auth://sessions/session-2')
      expect(rels2.some((r) => r.verb === 'belongsTo' && r.to === 'auth://users/user-1')).toBe(true)
    })

    it('preserves session metadata', async () => {
      const user = createTestUser({ id: 'user-1' })
      const session = createTestSession('user-1', {
        id: 'session-meta',
        token: 'test-token-xyz',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        activeOrganizationId: 'org-1',
      })

      const mockDb = createMockDrizzleDb({ users: [user], sessions: [session] })
      const migration = await import('../migration')

      await migration.migrateAuthToGraph({
        db: mockDb as any,
        graphStore: store,
      })

      const thing = await store.getThing('session-meta')
      const data = thing?.data as Record<string, unknown>

      expect(data.token).toBe('test-token-xyz')
      expect(data.ipAddress).toBe('192.168.1.1')
      expect(data.userAgent).toBe('Mozilla/5.0')
      expect(data.activeOrganizationId).toBe('org-1')
    })
  })

  // ==========================================================================
  // ACCOUNT MIGRATION TESTS
  // ==========================================================================

  describe('Account Migration', () => {
    it('migrates accounts with linkedTo relationships', async () => {
      const user = createTestUser({ id: 'user-1' })
      const account = createTestAccount('user-1', {
        id: 'account-1',
        providerId: 'github',
        accountId: 'gh-12345',
      })

      const mockDb = createMockDrizzleDb({ users: [user], accounts: [account] })
      const migration = await import('../migration')

      const result = await migration.migrateAuthToGraph({
        db: mockDb as any,
        graphStore: store,
      })

      expect(result.accounts.migrated).toBe(1)

      // Verify linkedTo relationship
      const rels = await store.queryRelationshipsFrom('auth://accounts/account-1')
      expect(rels.some((r) => r.verb === 'linkedTo' && r.to === 'auth://users/user-1')).toBe(true)
    })

    it('preserves OAuth tokens', async () => {
      const user = createTestUser({ id: 'user-1' })
      const account = createTestAccount('user-1', {
        id: 'account-oauth',
        providerId: 'google',
        accessToken: 'ya29.xxx',
        refreshToken: '1//xxx',
        accessTokenExpiresAt: new Date(Date.now() + 3600000),
        scope: 'openid email profile',
      })

      const mockDb = createMockDrizzleDb({ users: [user], accounts: [account] })
      const migration = await import('../migration')

      await migration.migrateAuthToGraph({
        db: mockDb as any,
        graphStore: store,
      })

      const thing = await store.getThing('account-oauth')
      const data = thing?.data as Record<string, unknown>

      expect(data.provider).toBe('google')
      expect(data.accessToken).toBe('ya29.xxx')
      expect(data.refreshToken).toBe('1//xxx')
      expect(data.scope).toBe('openid email profile')
    })
  })

  // ==========================================================================
  // ORGANIZATION MIGRATION TESTS
  // ==========================================================================

  describe('Organization Migration', () => {
    it('migrates organizations to Graph store', async () => {
      const orgs = [
        createTestOrganization({ id: 'org-1', name: 'Acme Corp', slug: 'acme' }),
        createTestOrganization({ id: 'org-2', name: 'Beta Inc', slug: 'beta' }),
      ]

      const mockDb = createMockDrizzleDb({ organizations: orgs })
      const migration = await import('../migration')

      const result = await migration.migrateAuthToGraph({
        db: mockDb as any,
        graphStore: store,
      })

      expect(result.organizations.migrated).toBe(2)

      const graphOrgs = await store.getThingsByType({ typeName: 'Organization' })
      expect(graphOrgs.length).toBe(2)
    })

    it('preserves organization metadata', async () => {
      const org = createTestOrganization({
        id: 'org-meta',
        name: 'Meta Org',
        slug: 'meta-org',
        logo: 'https://example.com/logo.png',
        metadata: { industry: 'tech', size: 100 },
        tenantNs: 'custom-ns',
        region: 'us-west',
      })

      const mockDb = createMockDrizzleDb({ organizations: [org] })
      const migration = await import('../migration')

      await migration.migrateAuthToGraph({
        db: mockDb as any,
        graphStore: store,
      })

      const thing = await store.getThing('org-meta')
      const data = thing?.data as Record<string, unknown>

      expect(data.name).toBe('Meta Org')
      expect(data.slug).toBe('meta-org')
      expect(data.logo).toBe('https://example.com/logo.png')
      expect(data.metadata).toEqual({ industry: 'tech', size: 100 })
      expect(data.tenantNs).toBe('custom-ns')
      expect(data.region).toBe('us-west')
    })
  })

  // ==========================================================================
  // MEMBER MIGRATION TESTS
  // ==========================================================================

  describe('Member Migration', () => {
    it('migrates members as memberOf relationships', async () => {
      const user = createTestUser({ id: 'user-1' })
      const org = createTestOrganization({ id: 'org-1' })
      const member = createTestMember('user-1', 'org-1', { id: 'member-1', role: 'admin' })

      const mockDb = createMockDrizzleDb({
        users: [user],
        organizations: [org],
        members: [member],
      })
      const migration = await import('../migration')

      const result = await migration.migrateAuthToGraph({
        db: mockDb as any,
        graphStore: store,
      })

      expect(result.members.migrated).toBe(1)

      // Verify memberOf relationship
      const rels = await store.queryRelationshipsFrom('auth://users/user-1', { verb: 'memberOf' })
      expect(rels.length).toBe(1)
      expect(rels[0]?.to).toBe('auth://organizations/org-1')

      const data = rels[0]?.data as Record<string, unknown>
      expect(data.role).toBe('admin')
    })

    it('supports multiple memberships per user', async () => {
      const user = createTestUser({ id: 'user-1' })
      const orgs = [
        createTestOrganization({ id: 'org-1', slug: 'org1' }),
        createTestOrganization({ id: 'org-2', slug: 'org2' }),
        createTestOrganization({ id: 'org-3', slug: 'org3' }),
      ]
      const members = [
        createTestMember('user-1', 'org-1', { role: 'owner' }),
        createTestMember('user-1', 'org-2', { role: 'admin' }),
        createTestMember('user-1', 'org-3', { role: 'member' }),
      ]

      const mockDb = createMockDrizzleDb({
        users: [user],
        organizations: orgs,
        members,
      })
      const migration = await import('../migration')

      const result = await migration.migrateAuthToGraph({
        db: mockDb as any,
        graphStore: store,
      })

      expect(result.members.migrated).toBe(3)

      const rels = await store.queryRelationshipsFrom('auth://users/user-1', { verb: 'memberOf' })
      expect(rels.length).toBe(3)
    })
  })

  // ==========================================================================
  // VERIFICATION TESTS
  // ==========================================================================

  describe('Migration Verification', () => {
    it('verifyMigration returns success when counts match', async () => {
      const users = [createTestUser({ id: 'user-1' })]
      const sessions = [createTestSession('user-1', { id: 'session-1' })]
      const accounts = [createTestAccount('user-1', { id: 'account-1' })]
      const orgs = [createTestOrganization({ id: 'org-1' })]
      const members = [createTestMember('user-1', 'org-1')]

      const mockDb = createMockDrizzleDb({ users, sessions, accounts, organizations: orgs, members })
      const migration = await import('../migration')

      // First migrate
      await migration.migrateAuthToGraph({
        db: mockDb as any,
        graphStore: store,
      })

      // Then verify
      const verification = await migration.verifyMigration({
        db: mockDb as any,
        graphStore: store,
      })

      expect(verification.success).toBe(true)
      expect(verification.users.match).toBe(true)
      expect(verification.sessions.match).toBe(true)
      expect(verification.accounts.match).toBe(true)
      expect(verification.organizations.match).toBe(true)
      expect(verification.members.match).toBe(true)
    })

    it('verifyMigration reports mismatches', async () => {
      const users = [createTestUser({ id: 'user-1' }), createTestUser({ id: 'user-2' })]

      // Only migrate one user manually
      await store.createThing({
        id: 'user-1',
        typeId: 1,
        typeName: 'User',
        data: { email: 'user1@example.com' },
      })

      const mockDb = createMockDrizzleDb({ users })
      const migration = await import('../migration')

      const verification = await migration.verifyMigration({
        db: mockDb as any,
        graphStore: store,
      })

      expect(verification.success).toBe(false)
      expect(verification.users.match).toBe(false)
      expect(verification.users.drizzle).toBe(2)
      expect(verification.users.graph).toBe(1)
      expect(verification.mismatches.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // PROGRESS CALLBACK TESTS
  // ==========================================================================

  describe('Progress Callbacks', () => {
    it('calls onProgress during migration', async () => {
      const users = [createTestUser({ id: 'user-1' })]
      const sessions = [createTestSession('user-1')]

      const mockDb = createMockDrizzleDb({ users, sessions })
      const migration = await import('../migration')

      const progressCalls: MigrationProgress[] = []
      const onProgress = (p: MigrationProgress) => progressCalls.push({ ...p })

      await migration.migrateAuthToGraph({
        db: mockDb as any,
        graphStore: store,
        onProgress,
      })

      // Should have progress calls for each phase
      expect(progressCalls.some((p) => p.phase === 'users')).toBe(true)
      expect(progressCalls.some((p) => p.phase === 'sessions')).toBe(true)
      expect(progressCalls.some((p) => p.phase === 'complete')).toBe(true)
    })
  })

  // ==========================================================================
  // ERROR HANDLING TESTS
  // ==========================================================================

  describe('Error Handling', () => {
    it('continues migration after individual entity errors', async () => {
      const users = [
        createTestUser({ id: 'user-1' }),
        createTestUser({ id: 'user-1' }), // Duplicate ID will cause error
        createTestUser({ id: 'user-3' }),
      ]

      const mockDb = createMockDrizzleDb({ users })
      const migration = await import('../migration')

      const result = await migration.migrateAuthToGraph({
        db: mockDb as any,
        graphStore: store,
        skipExisting: false, // Don't skip so we hit the duplicate error
      })

      // Should have migrated 2 and failed 1
      expect(result.users.migrated).toBe(2)
      expect(result.users.errors).toBe(1)
      expect(result.errors.length).toBe(1)
    })

    it('records error details', async () => {
      const users = [
        createTestUser({ id: 'user-1' }),
        createTestUser({ id: 'user-1' }), // Duplicate
      ]

      const mockDb = createMockDrizzleDb({ users })
      const migration = await import('../migration')

      const result = await migration.migrateAuthToGraph({
        db: mockDb as any,
        graphStore: store,
        skipExisting: false,
      })

      expect(result.errors.length).toBe(1)
      expect(result.errors[0]?.entity).toBe('user')
      expect(result.errors[0]?.id).toBe('user-1')
      expect(result.errors[0]?.error).toBeDefined()
    })
  })

  // ==========================================================================
  // BATCH PROCESSING TESTS
  // ==========================================================================

  describe('Batch Processing', () => {
    it('processes entities in batches', async () => {
      // Create 250 users
      const users = Array.from({ length: 250 }, (_, i) =>
        createTestUser({ id: `user-${i}`, email: `user${i}@example.com` })
      )

      const mockDb = createMockDrizzleDb({ users })
      const migration = await import('../migration')

      const result = await migration.migrateAuthToGraph({
        db: mockDb as any,
        graphStore: store,
        batchSize: 50,
      })

      expect(result.users.migrated).toBe(250)

      const graphUsers = await store.getThingsByType({ typeName: 'User' })
      expect(graphUsers.length).toBe(250)
    })
  })

  // ==========================================================================
  // MIGRATION STATUS TESTS
  // ==========================================================================

  describe('Migration Status', () => {
    it('getMigrationStatus reports when migration is needed', async () => {
      const users = [createTestUser({ id: 'user-1' })]
      const mockDb = createMockDrizzleDb({ users })
      const migration = await import('../migration')

      const status = await migration.getMigrationStatus({
        db: mockDb as any,
        graphStore: store,
      })

      expect(status.drizzleHasData).toBe(true)
      expect(status.graphHasData).toBe(false)
      expect(status.migrationNeeded).toBe(true)
      expect(status.migrationComplete).toBe(false)
    })

    it('getMigrationStatus reports when migration is complete', async () => {
      const users = [createTestUser({ id: 'user-1' })]
      const mockDb = createMockDrizzleDb({ users })
      const migration = await import('../migration')

      // Migrate first
      await migration.migrateAuthToGraph({
        db: mockDb as any,
        graphStore: store,
      })

      const status = await migration.getMigrationStatus({
        db: mockDb as any,
        graphStore: store,
      })

      expect(status.drizzleHasData).toBe(true)
      expect(status.graphHasData).toBe(true)
      expect(status.migrationNeeded).toBe(false)
      expect(status.migrationComplete).toBe(true)
    })
  })

  // ==========================================================================
  // DURATION TRACKING TESTS
  // ==========================================================================

  describe('Duration Tracking', () => {
    it('tracks migration duration', async () => {
      const users = [createTestUser({ id: 'user-1' })]
      const mockDb = createMockDrizzleDb({ users })
      const migration = await import('../migration')

      const result = await migration.migrateAuthToGraph({
        db: mockDb as any,
        graphStore: store,
      })

      // Duration should be a non-negative number (can be 0 for very fast migrations)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
      expect(typeof result.durationMs).toBe('number')
    })
  })
})
