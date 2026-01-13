/**
 * Account (OAuth) as Thing: Graph Storage Tests with linkedTo Relationship
 *
 * TDD RED PHASE: These tests define the contract for storing OAuth Accounts
 * as Things in the graph model with linkedTo relationships to Users.
 *
 * @see dotdo-1cfnf - [RED] Account (OAuth) as Thing: Graph storage tests
 *
 * These tests FAIL until the AccountGraphStore is implemented.
 *
 * Design:
 * - Account entities are Things with type "Account"
 * - Account `linkedTo` User relationships
 * - Uses SQLiteGraphStore for storage (NO MOCKS)
 * - AccountGraphStore wraps graph operations
 *
 * Entity Representation:
 * ```typescript
 * Thing {
 *   type: 'Account',
 *   data: {
 *     provider: 'github',
 *     providerAccountId: '12345',
 *     accessToken: 'gho_xxx',
 *     refreshToken: '...',
 *     scope: 'user:email'
 *   }
 * }
 * ```
 *
 * Relationship:
 * ```typescript
 * Relationship {
 *   verb: 'linkedTo',
 *   from: 'auth://accounts/{accountId}',
 *   to: 'auth://users/{userId}'
 * }
 * ```
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../../db/graph/stores'

// ============================================================================
// TYPE DEFINITIONS - Contract for implementation
// ============================================================================

/**
 * Account entity representing an OAuth provider connection
 */
export interface Account {
  id: string
  userId: string
  provider: string
  providerAccountId: string
  accessToken: string | null
  refreshToken: string | null
  accessTokenExpiresAt: Date | null
  refreshTokenExpiresAt: Date | null
  scope: string | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Input for creating a new Account
 */
export interface CreateAccountInput {
  userId: string
  provider: string
  providerAccountId: string
  accessToken?: string | null
  refreshToken?: string | null
  accessTokenExpiresAt?: Date | null
  refreshTokenExpiresAt?: Date | null
  scope?: string | null
}

/**
 * User entity (for relationship testing)
 */
export interface User {
  id: string
  email: string
  name: string | null
  emailVerified: boolean
  image: string | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Input for creating a User
 */
export interface CreateUserInput {
  email: string
  name?: string | null
  emailVerified?: boolean
  image?: string | null
}

/**
 * AccountGraphStore interface - to be implemented
 */
export interface AccountGraphStore {
  // Account CRUD
  createAccount(input: CreateAccountInput): Promise<Account>
  getAccountById(id: string): Promise<Account | null>
  getAccountByProvider(provider: string, providerAccountId: string): Promise<Account | null>
  getAccountsByUserId(userId: string): Promise<Account[]>
  unlinkAccount(provider: string, providerAccountId: string): Promise<void>

  // User operations (for relationship testing)
  createUser(input: CreateUserInput): Promise<User>
  getUserById(id: string): Promise<User | null>
  deleteUser(id: string): Promise<void>

  // Relationship traversal
  getLinkedUser(accountId: string): Promise<User | null>
  getLinkedAccounts(userId: string): Promise<Account[]>
}

// ============================================================================
// TEST SUITE: Account as Thing
// ============================================================================

describe('[RED] Account as Thing', () => {
  let store: SQLiteGraphStore
  let accountStore: AccountGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    // This import will fail until AccountGraphStore is implemented
    try {
      const { createAccountGraphStore } = await import('../stores/account-graph')
      accountStore = await createAccountGraphStore(store)
    } catch {
      // Expected to fail in RED phase
    }
  })

  afterEach(async () => {
    await store.close()
  })

  it('should create Account Thing with provider, providerAccountId, tokens', async () => {
    const user = await accountStore.createUser({
      email: 'alice@example.com',
      name: 'Alice',
    })

    const account = await accountStore.createAccount({
      userId: user.id,
      provider: 'github',
      providerAccountId: '12345',
      accessToken: 'gho_xxx',
      refreshToken: 'ghr_yyy',
      scope: 'user:email',
    })

    expect(account.id).toBeDefined()
    expect(account.userId).toBe(user.id)
    expect(account.provider).toBe('github')
    expect(account.providerAccountId).toBe('12345')
    expect(account.accessToken).toBe('gho_xxx')
    expect(account.refreshToken).toBe('ghr_yyy')
    expect(account.scope).toBe('user:email')

    // Verify stored as Thing in graph
    const thing = await store.getThing(account.id)
    expect(thing).not.toBeNull()
    expect(thing?.typeName).toBe('Account')
    expect((thing?.data as Record<string, unknown>)?.provider).toBe('github')
  })

  it('should create linkedTo Relationship: Account -> User', async () => {
    const user = await accountStore.createUser({
      email: 'bob@example.com',
    })

    const account = await accountStore.createAccount({
      userId: user.id,
      provider: 'github',
      providerAccountId: 'gh-bob-123',
    })

    // Verify linkedTo relationship was created
    const relationships = await store.queryRelationshipsFrom(`auth://accounts/${account.id}`)
    const linkedToRel = relationships.find((r) => r.verb === 'linkedTo')

    expect(linkedToRel).toBeDefined()
    expect(linkedToRel?.from).toBe(`auth://accounts/${account.id}`)
    expect(linkedToRel?.to).toBe(`auth://users/${user.id}`)
  })

  it('should enforce unique constraint: provider + providerAccountId', async () => {
    const user1 = await accountStore.createUser({
      email: 'user1@example.com',
    })

    const user2 = await accountStore.createUser({
      email: 'user2@example.com',
    })

    // First account creation should succeed
    await accountStore.createAccount({
      userId: user1.id,
      provider: 'github',
      providerAccountId: 'gh-unique-123',
    })

    // Second account with same provider+providerAccountId should fail
    await expect(
      accountStore.createAccount({
        userId: user2.id,
        provider: 'github',
        providerAccountId: 'gh-unique-123',
      })
    ).rejects.toThrow()
  })

  it('should allow multiple providers per user', async () => {
    const user = await accountStore.createUser({
      email: 'multi@example.com',
    })

    const githubAccount = await accountStore.createAccount({
      userId: user.id,
      provider: 'github',
      providerAccountId: 'gh-multi-1',
    })

    const googleAccount = await accountStore.createAccount({
      userId: user.id,
      provider: 'google',
      providerAccountId: 'google-multi-1',
    })

    const discordAccount = await accountStore.createAccount({
      userId: user.id,
      provider: 'discord',
      providerAccountId: 'discord-multi-1',
    })

    expect(githubAccount.provider).toBe('github')
    expect(googleAccount.provider).toBe('google')
    expect(discordAccount.provider).toBe('discord')

    const accounts = await accountStore.getAccountsByUserId(user.id)
    expect(accounts.length).toBe(3)
    expect(accounts.map((a) => a.provider).sort()).toEqual(['discord', 'github', 'google'])
  })
})

// ============================================================================
// TEST SUITE: Account Queries
// ============================================================================

describe('[RED] Account Queries', () => {
  let store: SQLiteGraphStore
  let accountStore: AccountGraphStore
  let testUser: User

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    try {
      const { createAccountGraphStore } = await import('../stores/account-graph')
      accountStore = await createAccountGraphStore(store)
      testUser = await accountStore.createUser({
        email: 'query-test@example.com',
        name: 'Query Test User',
      })
    } catch {
      // Expected to fail in RED phase
    }
  })

  afterEach(async () => {
    await store.close()
  })

  it('should getAccountByProvider(provider, providerAccountId)', async () => {
    await accountStore.createAccount({
      userId: testUser.id,
      provider: 'github',
      providerAccountId: 'gh-query-123',
      accessToken: 'gho_findme',
    })

    const account = await accountStore.getAccountByProvider('github', 'gh-query-123')

    expect(account).not.toBeNull()
    expect(account?.provider).toBe('github')
    expect(account?.providerAccountId).toBe('gh-query-123')
    expect(account?.accessToken).toBe('gho_findme')
  })

  it('should getAccountsByUserId via backward traversal', async () => {
    // Create multiple accounts for the user
    await accountStore.createAccount({
      userId: testUser.id,
      provider: 'github',
      providerAccountId: 'gh-traverse-1',
    })

    await accountStore.createAccount({
      userId: testUser.id,
      provider: 'google',
      providerAccountId: 'gl-traverse-1',
    })

    // Get accounts via backward traversal (linkedTo)
    const accounts = await accountStore.getAccountsByUserId(testUser.id)

    expect(accounts.length).toBe(2)

    // Also verify via direct graph query
    const rels = await store.queryRelationshipsTo(`auth://users/${testUser.id}`, {
      verb: 'linkedTo',
    })
    expect(rels.length).toBe(2)
  })

  it('should return null for non-existent accounts', async () => {
    const byProvider = await accountStore.getAccountByProvider('twitter', 'non-existent')
    expect(byProvider).toBeNull()

    const byId = await accountStore.getAccountById('non-existent-id')
    expect(byId).toBeNull()
  })

  it('should getLinkedUser from account via forward traversal', async () => {
    const account = await accountStore.createAccount({
      userId: testUser.id,
      provider: 'github',
      providerAccountId: 'gh-linked-user',
    })

    const linkedUser = await accountStore.getLinkedUser(account.id)

    expect(linkedUser).not.toBeNull()
    expect(linkedUser?.id).toBe(testUser.id)
    expect(linkedUser?.email).toBe('query-test@example.com')
  })

  it('should getLinkedAccounts from user via backward traversal', async () => {
    await accountStore.createAccount({
      userId: testUser.id,
      provider: 'github',
      providerAccountId: 'gh-linked-acc-1',
    })

    await accountStore.createAccount({
      userId: testUser.id,
      provider: 'google',
      providerAccountId: 'gl-linked-acc-1',
    })

    const linkedAccounts = await accountStore.getLinkedAccounts(testUser.id)

    expect(linkedAccounts.length).toBe(2)
    expect(linkedAccounts.map((a) => a.provider).sort()).toEqual(['github', 'google'])
  })
})

// ============================================================================
// TEST SUITE: Account Unlinking
// ============================================================================

describe('[RED] Account Unlinking', () => {
  let store: SQLiteGraphStore
  let accountStore: AccountGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    try {
      const { createAccountGraphStore } = await import('../stores/account-graph')
      accountStore = await createAccountGraphStore(store)
    } catch {
      // Expected to fail in RED phase
    }
  })

  afterEach(async () => {
    await store.close()
  })

  it('should unlinkAccount removes Thing and Relationship', async () => {
    const user = await accountStore.createUser({
      email: 'unlink@example.com',
    })

    const account = await accountStore.createAccount({
      userId: user.id,
      provider: 'github',
      providerAccountId: 'gh-unlink-123',
    })

    // Verify account exists before unlink
    expect(await accountStore.getAccountById(account.id)).not.toBeNull()
    const relsBefore = await store.queryRelationshipsFrom(`auth://accounts/${account.id}`)
    expect(relsBefore.length).toBeGreaterThan(0)

    // Unlink the account
    await accountStore.unlinkAccount('github', 'gh-unlink-123')

    // Verify account Thing is removed
    const deletedAccount = await accountStore.getAccountByProvider('github', 'gh-unlink-123')
    expect(deletedAccount).toBeNull()

    // Verify relationship is removed
    const relsAfter = await store.queryRelationshipsFrom(`auth://accounts/${account.id}`)
    expect(relsAfter.length).toBe(0)
  })

  it('should cascade delete when user deleted', async () => {
    const user = await accountStore.createUser({
      email: 'cascade@example.com',
    })

    const account1 = await accountStore.createAccount({
      userId: user.id,
      provider: 'github',
      providerAccountId: 'gh-cascade-1',
    })

    const account2 = await accountStore.createAccount({
      userId: user.id,
      provider: 'google',
      providerAccountId: 'gl-cascade-1',
    })

    // Delete the user
    await accountStore.deleteUser(user.id)

    // Verify all accounts are deleted
    expect(await accountStore.getAccountById(account1.id)).toBeNull()
    expect(await accountStore.getAccountById(account2.id)).toBeNull()

    // Verify relationships are cleaned up
    const rels = await store.queryRelationshipsTo(`auth://users/${user.id}`)
    expect(rels.length).toBe(0)
  })

  it('should not throw when unlinking non-existent account', async () => {
    await expect(
      accountStore.unlinkAccount('twitter', 'non-existent')
    ).resolves.not.toThrow()
  })

  it('should unlink one provider without affecting others', async () => {
    const user = await accountStore.createUser({
      email: 'partial-unlink@example.com',
    })

    await accountStore.createAccount({
      userId: user.id,
      provider: 'github',
      providerAccountId: 'gh-partial',
    })

    const googleAccount = await accountStore.createAccount({
      userId: user.id,
      provider: 'google',
      providerAccountId: 'gl-partial',
    })

    // Unlink only GitHub
    await accountStore.unlinkAccount('github', 'gh-partial')

    // GitHub should be gone
    expect(await accountStore.getAccountByProvider('github', 'gh-partial')).toBeNull()

    // Google should still exist
    const remaining = await accountStore.getAccountByProvider('google', 'gl-partial')
    expect(remaining).not.toBeNull()
    expect(remaining?.id).toBe(googleAccount.id)

    // User should still have one account
    const accounts = await accountStore.getAccountsByUserId(user.id)
    expect(accounts.length).toBe(1)
    expect(accounts[0]?.provider).toBe('google')
  })
})

// ============================================================================
// TEST SUITE: Graph Storage Verification (Data Structure)
// ============================================================================

describe('[RED] Graph Storage Verification', () => {
  let store: SQLiteGraphStore
  let accountStore: AccountGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    try {
      const { createAccountGraphStore } = await import('../stores/account-graph')
      accountStore = await createAccountGraphStore(store)
    } catch {
      // Expected to fail in RED phase
    }
  })

  afterEach(async () => {
    await store.close()
  })

  it('should store Account as Thing with correct data structure', async () => {
    const user = await accountStore.createUser({
      email: 'structure@example.com',
    })

    const expiresAt = new Date(Date.now() + 3600000)

    const account = await accountStore.createAccount({
      userId: user.id,
      provider: 'github',
      providerAccountId: '12345',
      accessToken: 'gho_xxx',
      refreshToken: 'ghr_yyy',
      accessTokenExpiresAt: expiresAt,
      scope: 'user:email repo',
    })

    // Verify the Thing structure in graph store
    const thing = await store.getThing(account.id)

    expect(thing).not.toBeNull()
    expect(thing?.typeName).toBe('Account')

    // Verify data fields
    const data = thing?.data as Record<string, unknown>
    expect(data.provider).toBe('github')
    expect(data.providerAccountId).toBe('12345')
    expect(data.accessToken).toBe('gho_xxx')
    expect(data.refreshToken).toBe('ghr_yyy')
    expect(data.scope).toBe('user:email repo')
    expect(data.userId).toBe(user.id)
  })

  it('should use auth:// URL scheme for Account and User entities', async () => {
    const user = await accountStore.createUser({
      email: 'url-scheme@example.com',
    })

    const account = await accountStore.createAccount({
      userId: user.id,
      provider: 'github',
      providerAccountId: 'gh-url-scheme',
    })

    const relationships = await store.queryRelationshipsFrom(`auth://accounts/${account.id}`)

    expect(relationships.length).toBeGreaterThan(0)
    expect(relationships[0]?.from).toMatch(/^auth:\/\/accounts\//)
    expect(relationships[0]?.to).toMatch(/^auth:\/\/users\//)
  })

  it('should create linkedTo relationship with correct verb', async () => {
    const user = await accountStore.createUser({
      email: 'verb-test@example.com',
    })

    const account = await accountStore.createAccount({
      userId: user.id,
      provider: 'github',
      providerAccountId: 'gh-verb-test',
    })

    const relationships = await store.queryRelationshipsFrom(`auth://accounts/${account.id}`)
    const linkedTo = relationships.find((r) => r.verb === 'linkedTo')

    expect(linkedTo).toBeDefined()
    expect(linkedTo?.verb).toBe('linkedTo')
  })

  it('should auto-generate createdAt and updatedAt timestamps', async () => {
    const before = Date.now()

    const user = await accountStore.createUser({
      email: 'timestamp@example.com',
    })

    const account = await accountStore.createAccount({
      userId: user.id,
      provider: 'github',
      providerAccountId: 'gh-timestamps',
    })

    const after = Date.now()

    expect(account.createdAt).toBeInstanceOf(Date)
    expect(account.updatedAt).toBeInstanceOf(Date)
    expect(account.createdAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(account.createdAt.getTime()).toBeLessThanOrEqual(after)
    expect(account.updatedAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(account.updatedAt.getTime()).toBeLessThanOrEqual(after)
  })
})

// ============================================================================
// TEST SUITE: OAuth Token Fields
// ============================================================================

describe('[RED] OAuth Token Fields', () => {
  let store: SQLiteGraphStore
  let accountStore: AccountGraphStore
  let testUser: User

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    try {
      const { createAccountGraphStore } = await import('../stores/account-graph')
      accountStore = await createAccountGraphStore(store)
      testUser = await accountStore.createUser({
        email: 'oauth-tokens@example.com',
      })
    } catch {
      // Expected to fail in RED phase
    }
  })

  afterEach(async () => {
    await store.close()
  })

  it('should store and retrieve GitHub token format', async () => {
    const account = await accountStore.createAccount({
      userId: testUser.id,
      provider: 'github',
      providerAccountId: 'gh-token-format',
      accessToken: 'gho_16C7e42F292c6912E7710c838347Ae178B4a',
      refreshToken: 'ghr_1B4a2e77838347Ae12E7710c706C2F921e16',
    })

    const retrieved = await accountStore.getAccountById(account.id)
    expect(retrieved?.accessToken).toMatch(/^gho_/)
    expect(retrieved?.refreshToken).toMatch(/^ghr_/)
  })

  it('should store and retrieve Google token format', async () => {
    const account = await accountStore.createAccount({
      userId: testUser.id,
      provider: 'google',
      providerAccountId: 'google-token-format',
      accessToken: 'ya29.a0AbVbY6xxxxxxxxxxxxx',
      refreshToken: '1//0gxxxxxxxxx',
      scope: 'openid email profile https://www.googleapis.com/auth/calendar',
    })

    const retrieved = await accountStore.getAccountById(account.id)
    expect(retrieved?.accessToken).toMatch(/^ya29\./)
    expect(retrieved?.refreshToken).toMatch(/^1\/\//)
  })

  it('should handle null token fields', async () => {
    const account = await accountStore.createAccount({
      userId: testUser.id,
      provider: 'discord',
      providerAccountId: 'dc-null-tokens',
      // No tokens provided
    })

    expect(account.accessToken).toBeNull()
    expect(account.refreshToken).toBeNull()
    expect(account.accessTokenExpiresAt).toBeNull()
    expect(account.refreshTokenExpiresAt).toBeNull()
    expect(account.scope).toBeNull()
  })

  it('should preserve token expiration dates', async () => {
    const accessExpires = new Date(Date.now() + 3600000) // 1 hour
    const refreshExpires = new Date(Date.now() + 86400000) // 24 hours

    const account = await accountStore.createAccount({
      userId: testUser.id,
      provider: 'google',
      providerAccountId: 'google-expiry',
      accessToken: 'ya29.xxx',
      refreshToken: '1//xxx',
      accessTokenExpiresAt: accessExpires,
      refreshTokenExpiresAt: refreshExpires,
    })

    const retrieved = await accountStore.getAccountById(account.id)
    expect(retrieved?.accessTokenExpiresAt?.getTime()).toBe(accessExpires.getTime())
    expect(retrieved?.refreshTokenExpiresAt?.getTime()).toBe(refreshExpires.getTime())
  })

  it('should preserve special characters in tokens', async () => {
    const specialToken = 'token+with/special=chars=='

    const account = await accountStore.createAccount({
      userId: testUser.id,
      provider: 'custom',
      providerAccountId: 'custom-special-chars',
      accessToken: specialToken,
    })

    const retrieved = await accountStore.getAccountById(account.id)
    expect(retrieved?.accessToken).toBe(specialToken)
  })
})

// ============================================================================
// TEST SUITE: Edge Cases
// ============================================================================

describe('[RED] Edge Cases', () => {
  let store: SQLiteGraphStore
  let accountStore: AccountGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    try {
      const { createAccountGraphStore } = await import('../stores/account-graph')
      accountStore = await createAccountGraphStore(store)
    } catch {
      // Expected to fail in RED phase
    }
  })

  afterEach(async () => {
    await store.close()
  })

  it('should handle very long providerAccountId', async () => {
    const user = await accountStore.createUser({ email: 'long-id@example.com' })
    const longId = 'a'.repeat(500)

    const account = await accountStore.createAccount({
      userId: user.id,
      provider: 'custom',
      providerAccountId: longId,
    })

    expect(account.providerAccountId.length).toBe(500)

    const retrieved = await accountStore.getAccountByProvider('custom', longId)
    expect(retrieved?.providerAccountId.length).toBe(500)
  })

  it('should handle concurrent account creation for same user', async () => {
    const user = await accountStore.createUser({ email: 'concurrent@example.com' })

    const promises = Array.from({ length: 10 }, (_, i) =>
      accountStore.createAccount({
        userId: user.id,
        provider: `provider-${i}`,
        providerAccountId: `pid-${i}`,
      })
    )

    const accounts = await Promise.all(promises)

    expect(accounts.length).toBe(10)
    expect(new Set(accounts.map((a) => a.id)).size).toBe(10) // All unique IDs
    expect(new Set(accounts.map((a) => a.provider)).size).toBe(10) // All unique providers
  })

  it('should handle empty scope string', async () => {
    const user = await accountStore.createUser({ email: 'empty-scope@example.com' })

    const account = await accountStore.createAccount({
      userId: user.id,
      provider: 'custom',
      providerAccountId: 'custom-empty-scope',
      scope: '',
    })

    // Empty string should be stored as empty or converted to null
    expect(account.scope === '' || account.scope === null).toBe(true)
  })

  it('should handle unicode in provider names', async () => {
    const user = await accountStore.createUser({ email: 'unicode@example.com' })

    const account = await accountStore.createAccount({
      userId: user.id,
      provider: 'provider-unicode',
      providerAccountId: 'pid-123',
    })

    const retrieved = await accountStore.getAccountByProvider('provider-unicode', 'pid-123')
    expect(retrieved).not.toBeNull()
    expect(retrieved?.provider).toBe('provider-unicode')
  })

  it('should handle user with no accounts', async () => {
    const user = await accountStore.createUser({ email: 'no-accounts@example.com' })

    const accounts = await accountStore.getAccountsByUserId(user.id)
    expect(accounts).toEqual([])

    const linkedAccounts = await accountStore.getLinkedAccounts(user.id)
    expect(linkedAccounts).toEqual([])
  })
})
