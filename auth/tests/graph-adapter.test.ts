/**
 * Graph Auth Adapter Tests - better-auth Database Adapter using Graph Model
 *
 * RED PHASE: These tests define the contract for a better-auth database adapter
 * that stores auth entities (User, Session, Account) as Things in the graph model.
 *
 * @see dotdo-pciyq - [RED] better-auth Graph Adapter tests
 *
 * These tests FAIL until GraphAuthAdapter is implemented.
 *
 * Design:
 * - Auth entities are Things with specific type names (User, Session, Account)
 * - Relationships connect entities:
 *   - Session `belongsTo` User
 *   - Account `linkedTo` User
 * - Uses SQLiteGraphStore for storage (NO MOCKS)
 * - Adapter wraps graph operations to match better-auth interface
 *
 * Entity Representation:
 * ```typescript
 * // User as a Thing
 * Thing {
 *   type: 'User',
 *   data: {
 *     email: 'alice@example.com',
 *     name: 'Alice',
 *     emailVerified: true,
 *     image: 'https://...'
 *   }
 * }
 *
 * // Session as a Thing
 * Thing {
 *   type: 'Session',
 *   data: {
 *     token: 'session-token-xyz',
 *     expiresAt: Date.now() + 86400000,
 *     userAgent: '...',
 *     ipAddress: '...'
 *   }
 * }
 *
 * // Account as a Thing (OAuth providers)
 * Thing {
 *   type: 'Account',
 *   data: {
 *     providerId: 'github',
 *     providerAccountId: '12345',
 *     accessToken: '...',
 *     refreshToken: '...'
 *   }
 * }
 * ```
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../../db/graph/stores'
import {
  createGraphAuthAdapter,
  type GraphAuthAdapter,
  type User,
  type Session,
  type Account,
} from '../adapters'

// ============================================================================
// TEST SUITE
// ============================================================================

describe('[RED] GraphAuthAdapter - better-auth Graph Model Integration', () => {
  let store: SQLiteGraphStore
  let adapter: GraphAuthAdapter

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    // This will throw until implemented
    try {
      adapter = await createGraphAuthAdapter(store)
    } catch {
      // Expected to fail in RED phase
    }
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // ADAPTER CREATION TESTS
  // ==========================================================================

  describe('Adapter Creation', () => {
    it('creates GraphAuthAdapter from SQLiteGraphStore', async () => {
      // This test will fail until createGraphAuthAdapter is implemented
      const testAdapter = await createGraphAuthAdapter(store)
      expect(testAdapter).toBeDefined()
    })

    it('GraphAuthAdapter implements required interface', async () => {
      const testAdapter = await createGraphAuthAdapter(store)

      // User operations
      expect(typeof testAdapter.createUser).toBe('function')
      expect(typeof testAdapter.getUserById).toBe('function')
      expect(typeof testAdapter.getUserByEmail).toBe('function')
      expect(typeof testAdapter.updateUser).toBe('function')
      expect(typeof testAdapter.deleteUser).toBe('function')

      // Session operations
      expect(typeof testAdapter.createSession).toBe('function')
      expect(typeof testAdapter.getSession).toBe('function')
      expect(typeof testAdapter.getSessionAndUser).toBe('function')
      expect(typeof testAdapter.deleteSession).toBe('function')
      expect(typeof testAdapter.deleteUserSessions).toBe('function')
      expect(typeof testAdapter.deleteExpiredSessions).toBe('function')

      // Account operations
      expect(typeof testAdapter.linkAccount).toBe('function')
      expect(typeof testAdapter.getAccountByProvider).toBe('function')
      expect(typeof testAdapter.unlinkAccount).toBe('function')
      expect(typeof testAdapter.getAccountsByUserId).toBe('function')
    })
  })

  // ==========================================================================
  // USER OPERATIONS TESTS
  // ==========================================================================

  describe('User Operations', () => {
    describe('createUser', () => {
      it('creates User Thing with email and name', async () => {
        const user = await adapter.createUser({
          email: 'alice@example.com',
          name: 'Alice',
        })

        expect(user.id).toBeDefined()
        expect(user.email).toBe('alice@example.com')
        expect(user.name).toBe('Alice')
        expect(user.emailVerified).toBe(false)
        expect(user.image).toBeNull()
      })

      it('creates User Thing with all fields', async () => {
        const user = await adapter.createUser({
          email: 'bob@example.com',
          name: 'Bob Smith',
          emailVerified: true,
          image: 'https://example.com/bob.jpg',
        })

        expect(user.email).toBe('bob@example.com')
        expect(user.name).toBe('Bob Smith')
        expect(user.emailVerified).toBe(true)
        expect(user.image).toBe('https://example.com/bob.jpg')
      })

      it('auto-generates createdAt and updatedAt timestamps', async () => {
        const before = Date.now()

        const user = await adapter.createUser({
          email: 'timestamp@example.com',
          name: 'Timestamp User',
        })

        const after = Date.now()

        expect(user.createdAt.getTime()).toBeGreaterThanOrEqual(before)
        expect(user.createdAt.getTime()).toBeLessThanOrEqual(after)
        expect(user.updatedAt.getTime()).toBeGreaterThanOrEqual(before)
        expect(user.updatedAt.getTime()).toBeLessThanOrEqual(after)
      })

      it('generates unique user IDs', async () => {
        const user1 = await adapter.createUser({ email: 'user1@example.com' })
        const user2 = await adapter.createUser({ email: 'user2@example.com' })

        expect(user1.id).not.toBe(user2.id)
      })

      it('rejects duplicate email addresses', async () => {
        await adapter.createUser({ email: 'duplicate@example.com' })

        await expect(adapter.createUser({ email: 'duplicate@example.com' })).rejects.toThrow()
      })
    })

    describe('getUserById', () => {
      it('retrieves user by ID', async () => {
        const created = await adapter.createUser({
          email: 'getbyid@example.com',
          name: 'Get By ID',
        })

        const user = await adapter.getUserById(created.id)

        expect(user).not.toBeNull()
        expect(user?.id).toBe(created.id)
        expect(user?.email).toBe('getbyid@example.com')
        expect(user?.name).toBe('Get By ID')
      })

      it('returns null for non-existent ID', async () => {
        const user = await adapter.getUserById('non-existent-user-id')

        expect(user).toBeNull()
      })
    })

    describe('getUserByEmail', () => {
      it('retrieves user by email', async () => {
        await adapter.createUser({
          email: 'findme@example.com',
          name: 'Find Me',
        })

        const user = await adapter.getUserByEmail('findme@example.com')

        expect(user).not.toBeNull()
        expect(user?.email).toBe('findme@example.com')
        expect(user?.name).toBe('Find Me')
      })

      it('returns null for non-existent email', async () => {
        const user = await adapter.getUserByEmail('notfound@example.com')

        expect(user).toBeNull()
      })

      it('email lookup is case-insensitive', async () => {
        await adapter.createUser({
          email: 'CaseSensitive@Example.com',
          name: 'Case Sensitive',
        })

        const user = await adapter.getUserByEmail('casesensitive@example.com')

        expect(user).not.toBeNull()
        expect(user?.email).toBe('CaseSensitive@Example.com')
      })
    })

    describe('updateUser', () => {
      it('updates user name', async () => {
        const created = await adapter.createUser({
          email: 'update@example.com',
          name: 'Original Name',
        })

        const updated = await adapter.updateUser(created.id, {
          name: 'Updated Name',
        })

        expect(updated.name).toBe('Updated Name')
        expect(updated.email).toBe('update@example.com')
      })

      it('updates user email', async () => {
        const created = await adapter.createUser({
          email: 'oldemail@example.com',
          name: 'Email User',
        })

        const updated = await adapter.updateUser(created.id, {
          email: 'newemail@example.com',
        })

        expect(updated.email).toBe('newemail@example.com')
      })

      it('updates emailVerified status', async () => {
        const created = await adapter.createUser({
          email: 'verify@example.com',
          name: 'Verify Me',
        })

        expect(created.emailVerified).toBe(false)

        const updated = await adapter.updateUser(created.id, {
          emailVerified: true,
        })

        expect(updated.emailVerified).toBe(true)
      })

      it('updates user image', async () => {
        const created = await adapter.createUser({
          email: 'image@example.com',
          name: 'Image User',
        })

        const updated = await adapter.updateUser(created.id, {
          image: 'https://example.com/avatar.jpg',
        })

        expect(updated.image).toBe('https://example.com/avatar.jpg')
      })

      it('updates updatedAt timestamp', async () => {
        const created = await adapter.createUser({
          email: 'timestamp-update@example.com',
        })

        // Small delay to ensure timestamp difference
        await new Promise((resolve) => setTimeout(resolve, 10))

        const updated = await adapter.updateUser(created.id, {
          name: 'New Name',
        })

        expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime())
      })

      it('throws for non-existent user', async () => {
        await expect(adapter.updateUser('non-existent', { name: 'New Name' })).rejects.toThrow()
      })
    })

    describe('deleteUser', () => {
      it('deletes user by ID', async () => {
        const created = await adapter.createUser({
          email: 'delete@example.com',
          name: 'Delete Me',
        })

        await adapter.deleteUser(created.id)

        const user = await adapter.getUserById(created.id)
        expect(user).toBeNull()
      })

      it('deletes associated sessions when user is deleted', async () => {
        const user = await adapter.createUser({
          email: 'cascade-delete@example.com',
        })

        await adapter.createSession({
          userId: user.id,
          token: 'session-to-delete',
          expiresAt: new Date(Date.now() + 86400000),
        })

        await adapter.deleteUser(user.id)

        const session = await adapter.getSession('session-to-delete')
        expect(session).toBeNull()
      })

      it('deletes associated accounts when user is deleted', async () => {
        const user = await adapter.createUser({
          email: 'cascade-delete-accounts@example.com',
        })

        await adapter.linkAccount({
          userId: user.id,
          provider: 'github',
          providerAccountId: '12345',
        })

        await adapter.deleteUser(user.id)

        const account = await adapter.getAccountByProvider('github', '12345')
        expect(account).toBeNull()
      })

      it('does not throw for non-existent user', async () => {
        await expect(adapter.deleteUser('non-existent')).resolves.not.toThrow()
      })
    })
  })

  // ==========================================================================
  // SESSION OPERATIONS TESTS
  // ==========================================================================

  describe('Session Operations', () => {
    let testUser: User

    beforeEach(async () => {
      testUser = await adapter.createUser({
        email: 'session-test@example.com',
        name: 'Session Test User',
      })
    })

    describe('createSession', () => {
      it('creates session for user', async () => {
        const session = await adapter.createSession({
          userId: testUser.id,
          token: 'test-session-token',
          expiresAt: new Date(Date.now() + 86400000), // 24 hours
        })

        expect(session.id).toBeDefined()
        expect(session.token).toBe('test-session-token')
        expect(session.userId).toBe(testUser.id)
        expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now())
      })

      it('creates session with user agent and IP', async () => {
        const session = await adapter.createSession({
          userId: testUser.id,
          token: 'session-with-metadata',
          expiresAt: new Date(Date.now() + 86400000),
          userAgent: 'Mozilla/5.0 (Test Browser)',
          ipAddress: '192.168.1.1',
        })

        expect(session.userAgent).toBe('Mozilla/5.0 (Test Browser)')
        expect(session.ipAddress).toBe('192.168.1.1')
      })

      it('creates relationship between session and user', async () => {
        const session = await adapter.createSession({
          userId: testUser.id,
          token: 'session-relationship-test',
          expiresAt: new Date(Date.now() + 86400000),
        })

        // Verify the relationship exists in the graph store
        const rels = await store.queryRelationshipsFrom(`auth://sessions/${session.id}`)
        const belongsToRel = rels.find((r) => r.verb === 'belongsTo')

        expect(belongsToRel).toBeDefined()
        expect(belongsToRel?.to).toBe(`auth://users/${testUser.id}`)
      })

      it('generates unique session IDs', async () => {
        const session1 = await adapter.createSession({
          userId: testUser.id,
          token: 'token1',
          expiresAt: new Date(Date.now() + 86400000),
        })

        const session2 = await adapter.createSession({
          userId: testUser.id,
          token: 'token2',
          expiresAt: new Date(Date.now() + 86400000),
        })

        expect(session1.id).not.toBe(session2.id)
      })
    })

    describe('getSession', () => {
      it('retrieves session by token', async () => {
        await adapter.createSession({
          userId: testUser.id,
          token: 'find-me-token',
          expiresAt: new Date(Date.now() + 86400000),
        })

        const session = await adapter.getSession('find-me-token')

        expect(session).not.toBeNull()
        expect(session?.token).toBe('find-me-token')
        expect(session?.userId).toBe(testUser.id)
      })

      it('returns null for non-existent token', async () => {
        const session = await adapter.getSession('non-existent-token')

        expect(session).toBeNull()
      })

      it('returns null for expired session', async () => {
        await adapter.createSession({
          userId: testUser.id,
          token: 'expired-token',
          expiresAt: new Date(Date.now() - 1000), // Already expired
        })

        const session = await adapter.getSession('expired-token')

        expect(session).toBeNull()
      })
    })

    describe('getSessionAndUser', () => {
      it('retrieves session with associated user', async () => {
        await adapter.createSession({
          userId: testUser.id,
          token: 'session-with-user-token',
          expiresAt: new Date(Date.now() + 86400000),
        })

        const result = await adapter.getSessionAndUser('session-with-user-token')

        expect(result).not.toBeNull()
        expect(result?.session.token).toBe('session-with-user-token')
        expect(result?.user.id).toBe(testUser.id)
        expect(result?.user.email).toBe('session-test@example.com')
      })

      it('returns null for non-existent token', async () => {
        const result = await adapter.getSessionAndUser('non-existent')

        expect(result).toBeNull()
      })

      it('returns null for expired session', async () => {
        await adapter.createSession({
          userId: testUser.id,
          token: 'expired-session-user',
          expiresAt: new Date(Date.now() - 1000),
        })

        const result = await adapter.getSessionAndUser('expired-session-user')

        expect(result).toBeNull()
      })
    })

    describe('deleteSession', () => {
      it('deletes session by token', async () => {
        await adapter.createSession({
          userId: testUser.id,
          token: 'delete-me-token',
          expiresAt: new Date(Date.now() + 86400000),
        })

        await adapter.deleteSession('delete-me-token')

        const session = await adapter.getSession('delete-me-token')
        expect(session).toBeNull()
      })

      it('does not throw for non-existent token', async () => {
        await expect(adapter.deleteSession('non-existent')).resolves.not.toThrow()
      })
    })

    describe('deleteUserSessions', () => {
      it('deletes all sessions for a user', async () => {
        await adapter.createSession({
          userId: testUser.id,
          token: 'user-session-1',
          expiresAt: new Date(Date.now() + 86400000),
        })

        await adapter.createSession({
          userId: testUser.id,
          token: 'user-session-2',
          expiresAt: new Date(Date.now() + 86400000),
        })

        await adapter.createSession({
          userId: testUser.id,
          token: 'user-session-3',
          expiresAt: new Date(Date.now() + 86400000),
        })

        await adapter.deleteUserSessions(testUser.id)

        expect(await adapter.getSession('user-session-1')).toBeNull()
        expect(await adapter.getSession('user-session-2')).toBeNull()
        expect(await adapter.getSession('user-session-3')).toBeNull()
      })

      it('does not affect sessions of other users', async () => {
        const otherUser = await adapter.createUser({
          email: 'other@example.com',
        })

        await adapter.createSession({
          userId: testUser.id,
          token: 'test-user-session',
          expiresAt: new Date(Date.now() + 86400000),
        })

        await adapter.createSession({
          userId: otherUser.id,
          token: 'other-user-session',
          expiresAt: new Date(Date.now() + 86400000),
        })

        await adapter.deleteUserSessions(testUser.id)

        expect(await adapter.getSession('test-user-session')).toBeNull()
        expect(await adapter.getSession('other-user-session')).not.toBeNull()
      })
    })

    describe('deleteExpiredSessions', () => {
      it('deletes all expired sessions', async () => {
        // Create expired sessions
        await adapter.createSession({
          userId: testUser.id,
          token: 'expired-1',
          expiresAt: new Date(Date.now() - 1000),
        })

        await adapter.createSession({
          userId: testUser.id,
          token: 'expired-2',
          expiresAt: new Date(Date.now() - 2000),
        })

        // Create valid session
        await adapter.createSession({
          userId: testUser.id,
          token: 'valid-session',
          expiresAt: new Date(Date.now() + 86400000),
        })

        await adapter.deleteExpiredSessions()

        // Note: getSession already filters expired, but the data should be cleaned up
        // We need to verify via the store that the Things were actually deleted
        const sessions = await store.getThingsByType({ typeName: 'Session' })
        const sessionTokens = sessions.map((s) => (s.data as { token?: string })?.token)

        expect(sessionTokens).not.toContain('expired-1')
        expect(sessionTokens).not.toContain('expired-2')
        expect(sessionTokens).toContain('valid-session')
      })
    })
  })

  // ==========================================================================
  // ACCOUNT (OAuth) OPERATIONS TESTS
  // ==========================================================================

  describe('Account (OAuth) Operations', () => {
    let testUser: User

    beforeEach(async () => {
      testUser = await adapter.createUser({
        email: 'oauth-test@example.com',
        name: 'OAuth Test User',
      })
    })

    describe('linkAccount', () => {
      it('links OAuth account to user', async () => {
        const account = await adapter.linkAccount({
          userId: testUser.id,
          provider: 'github',
          providerAccountId: '12345',
          accessToken: 'gho_xxx',
        })

        expect(account.id).toBeDefined()
        expect(account.userId).toBe(testUser.id)
        expect(account.provider).toBe('github')
        expect(account.providerAccountId).toBe('12345')
        expect(account.accessToken).toBe('gho_xxx')
      })

      it('links account with all OAuth fields', async () => {
        const expiresAt = new Date(Date.now() + 3600000)
        const refreshExpiresAt = new Date(Date.now() + 86400000)

        const account = await adapter.linkAccount({
          userId: testUser.id,
          provider: 'google',
          providerAccountId: 'google-123',
          accessToken: 'ya29.xxx',
          refreshToken: '1//xxx',
          accessTokenExpiresAt: expiresAt,
          refreshTokenExpiresAt: refreshExpiresAt,
          scope: 'openid email profile',
        })

        expect(account.accessToken).toBe('ya29.xxx')
        expect(account.refreshToken).toBe('1//xxx')
        expect(account.accessTokenExpiresAt?.getTime()).toBe(expiresAt.getTime())
        expect(account.refreshTokenExpiresAt?.getTime()).toBe(refreshExpiresAt.getTime())
        expect(account.scope).toBe('openid email profile')
      })

      it('creates relationship between account and user', async () => {
        const account = await adapter.linkAccount({
          userId: testUser.id,
          provider: 'github',
          providerAccountId: '12345',
        })

        // Verify the relationship exists in the graph store
        const rels = await store.queryRelationshipsFrom(`auth://accounts/${account.id}`)
        const linkedToRel = rels.find((r) => r.verb === 'linkedTo')

        expect(linkedToRel).toBeDefined()
        expect(linkedToRel?.to).toBe(`auth://users/${testUser.id}`)
      })

      it('allows multiple providers for same user', async () => {
        await adapter.linkAccount({
          userId: testUser.id,
          provider: 'github',
          providerAccountId: 'github-123',
        })

        const googleAccount = await adapter.linkAccount({
          userId: testUser.id,
          provider: 'google',
          providerAccountId: 'google-456',
        })

        expect(googleAccount.provider).toBe('google')

        const accounts = await adapter.getAccountsByUserId(testUser.id)
        expect(accounts.length).toBe(2)
      })

      it('rejects duplicate provider+providerAccountId combination', async () => {
        await adapter.linkAccount({
          userId: testUser.id,
          provider: 'github',
          providerAccountId: '12345',
        })

        const otherUser = await adapter.createUser({
          email: 'other-oauth@example.com',
        })

        await expect(
          adapter.linkAccount({
            userId: otherUser.id,
            provider: 'github',
            providerAccountId: '12345',
          })
        ).rejects.toThrow()
      })
    })

    describe('getAccountByProvider', () => {
      it('retrieves account by provider and providerAccountId', async () => {
        await adapter.linkAccount({
          userId: testUser.id,
          provider: 'github',
          providerAccountId: 'gh-99999',
          accessToken: 'gho_findme',
        })

        const account = await adapter.getAccountByProvider('github', 'gh-99999')

        expect(account).not.toBeNull()
        expect(account?.provider).toBe('github')
        expect(account?.providerAccountId).toBe('gh-99999')
        expect(account?.userId).toBe(testUser.id)
        expect(account?.accessToken).toBe('gho_findme')
      })

      it('returns null for non-existent provider', async () => {
        const account = await adapter.getAccountByProvider('twitter', '12345')

        expect(account).toBeNull()
      })

      it('returns null for non-existent providerAccountId', async () => {
        await adapter.linkAccount({
          userId: testUser.id,
          provider: 'github',
          providerAccountId: 'existing',
        })

        const account = await adapter.getAccountByProvider('github', 'non-existent')

        expect(account).toBeNull()
      })
    })

    describe('unlinkAccount', () => {
      it('unlinks account by provider and providerAccountId', async () => {
        await adapter.linkAccount({
          userId: testUser.id,
          provider: 'github',
          providerAccountId: 'unlink-me',
        })

        await adapter.unlinkAccount('github', 'unlink-me')

        const account = await adapter.getAccountByProvider('github', 'unlink-me')
        expect(account).toBeNull()
      })

      it('does not throw for non-existent account', async () => {
        await expect(adapter.unlinkAccount('twitter', 'non-existent')).resolves.not.toThrow()
      })

      it('removes relationship from graph', async () => {
        const account = await adapter.linkAccount({
          userId: testUser.id,
          provider: 'github',
          providerAccountId: 'unlink-relationship',
        })

        await adapter.unlinkAccount('github', 'unlink-relationship')

        // Verify relationship is removed
        const rels = await store.queryRelationshipsFrom(`auth://accounts/${account.id}`)
        expect(rels.length).toBe(0)
      })
    })

    describe('getAccountsByUserId', () => {
      it('retrieves all accounts for a user', async () => {
        await adapter.linkAccount({
          userId: testUser.id,
          provider: 'github',
          providerAccountId: 'gh-111',
        })

        await adapter.linkAccount({
          userId: testUser.id,
          provider: 'google',
          providerAccountId: 'gl-222',
        })

        await adapter.linkAccount({
          userId: testUser.id,
          provider: 'discord',
          providerAccountId: 'dc-333',
        })

        const accounts = await adapter.getAccountsByUserId(testUser.id)

        expect(accounts.length).toBe(3)
        expect(accounts.map((a) => a.provider).sort()).toEqual(['discord', 'github', 'google'])
      })

      it('returns empty array for user with no accounts', async () => {
        const accounts = await adapter.getAccountsByUserId(testUser.id)

        expect(accounts).toHaveLength(0)
      })

      it('does not return accounts of other users', async () => {
        const otherUser = await adapter.createUser({
          email: 'other-user@example.com',
        })

        await adapter.linkAccount({
          userId: testUser.id,
          provider: 'github',
          providerAccountId: 'test-user-gh',
        })

        await adapter.linkAccount({
          userId: otherUser.id,
          provider: 'github',
          providerAccountId: 'other-user-gh',
        })

        const accounts = await adapter.getAccountsByUserId(testUser.id)

        expect(accounts.length).toBe(1)
        expect(accounts[0]?.providerAccountId).toBe('test-user-gh')
      })
    })
  })

  // ==========================================================================
  // GRAPH MODEL INTEGRATION TESTS
  // ==========================================================================

  describe('Graph Model Integration', () => {
    it('stores User as Thing with type "User"', async () => {
      const user = await adapter.createUser({
        email: 'graph-user@example.com',
        name: 'Graph User',
      })

      // Verify the Thing was created in the graph store
      const thing = await store.getThing(user.id)

      expect(thing).not.toBeNull()
      expect(thing?.typeName).toBe('User')
      expect((thing?.data as { email?: string })?.email).toBe('graph-user@example.com')
    })

    it('stores Session as Thing with type "Session"', async () => {
      const user = await adapter.createUser({
        email: 'session-graph@example.com',
      })

      const session = await adapter.createSession({
        userId: user.id,
        token: 'graph-session-token',
        expiresAt: new Date(Date.now() + 86400000),
      })

      // Verify the Thing was created in the graph store
      const thing = await store.getThing(session.id)

      expect(thing).not.toBeNull()
      expect(thing?.typeName).toBe('Session')
      expect((thing?.data as { token?: string })?.token).toBe('graph-session-token')
    })

    it('stores Account as Thing with type "Account"', async () => {
      const user = await adapter.createUser({
        email: 'account-graph@example.com',
      })

      const account = await adapter.linkAccount({
        userId: user.id,
        provider: 'github',
        providerAccountId: 'graph-test-123',
      })

      // Verify the Thing was created in the graph store
      const thing = await store.getThing(account.id)

      expect(thing).not.toBeNull()
      expect(thing?.typeName).toBe('Account')
      expect((thing?.data as { provider?: string })?.provider).toBe('github')
    })

    it('creates proper relationship URLs', async () => {
      const user = await adapter.createUser({
        email: 'rel-urls@example.com',
      })

      const session = await adapter.createSession({
        userId: user.id,
        token: 'rel-url-token',
        expiresAt: new Date(Date.now() + 86400000),
      })

      // Verify relationships use auth:// URL scheme
      const rels = await store.queryRelationshipsFrom(`auth://sessions/${session.id}`)

      expect(rels.length).toBeGreaterThan(0)
      expect(rels[0]?.from).toMatch(/^auth:\/\/sessions\//)
      expect(rels[0]?.to).toMatch(/^auth:\/\/users\//)
    })

    it('supports backward traversal to find user sessions', async () => {
      const user = await adapter.createUser({
        email: 'traversal@example.com',
      })

      await adapter.createSession({
        userId: user.id,
        token: 'traversal-session-1',
        expiresAt: new Date(Date.now() + 86400000),
      })

      await adapter.createSession({
        userId: user.id,
        token: 'traversal-session-2',
        expiresAt: new Date(Date.now() + 86400000),
      })

      // Find all sessions belonging to user via backward traversal
      const rels = await store.queryRelationshipsTo(`auth://users/${user.id}`, {
        verb: 'belongsTo',
      })

      expect(rels.length).toBe(2)
    })

    it('supports backward traversal to find user accounts', async () => {
      const user = await adapter.createUser({
        email: 'account-traversal@example.com',
      })

      await adapter.linkAccount({
        userId: user.id,
        provider: 'github',
        providerAccountId: 'acc-trav-1',
      })

      await adapter.linkAccount({
        userId: user.id,
        provider: 'google',
        providerAccountId: 'acc-trav-2',
      })

      // Find all accounts linked to user via backward traversal
      const rels = await store.queryRelationshipsTo(`auth://users/${user.id}`, {
        verb: 'linkedTo',
      })

      expect(rels.length).toBe(2)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles unicode in user name', async () => {
      const user = await adapter.createUser({
        email: 'unicode@example.com',
        name: 'Test User Name',
      })

      const retrieved = await adapter.getUserById(user.id)
      expect(retrieved?.name).toBe('Test User Name')
    })

    it('handles very long email addresses', async () => {
      const longEmail = 'a'.repeat(200) + '@example.com'

      const user = await adapter.createUser({
        email: longEmail,
        name: 'Long Email',
      })

      const retrieved = await adapter.getUserByEmail(longEmail)
      expect(retrieved?.id).toBe(user.id)
    })

    it('handles concurrent session creation', async () => {
      const user = await adapter.createUser({
        email: 'concurrent@example.com',
      })

      const promises = Array.from({ length: 10 }, (_, i) =>
        adapter.createSession({
          userId: user.id,
          token: `concurrent-token-${i}`,
          expiresAt: new Date(Date.now() + 86400000),
        })
      )

      const sessions = await Promise.all(promises)

      expect(sessions.length).toBe(10)
      expect(new Set(sessions.map((s) => s.id)).size).toBe(10)
    })

    it('handles concurrent account linking', async () => {
      const user = await adapter.createUser({
        email: 'concurrent-accounts@example.com',
      })

      const providers = ['github', 'google', 'discord', 'twitter', 'facebook']

      const promises = providers.map((provider, i) =>
        adapter.linkAccount({
          userId: user.id,
          provider,
          providerAccountId: `provider-${i}`,
        })
      )

      const accounts = await Promise.all(promises)

      expect(accounts.length).toBe(5)
      expect(new Set(accounts.map((a) => a.provider)).size).toBe(5)
    })
  })
})

// ============================================================================
// INTEGRATION WITH BETTER-AUTH (Future)
// ============================================================================

describe('better-auth Integration (Future)', () => {
  it.skip('adapter can be used with betterAuth() config', async () => {
    // This test will be enabled when the adapter is fully integrated with better-auth
    // Example:
    // const auth = betterAuth({
    //   database: graphAuthAdapter(store),
    //   ...
    // })
  })
})
