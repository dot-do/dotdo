/**
 * Account (OAuth) as Thing: Graph Storage Tests with linkedTo Relationship
 *
 * TDD RED PHASE: Tests for storing Account (OAuth) entities as Things in the
 * graph storage with linkedTo relationships connecting Accounts to Users.
 *
 * @see dotdo-1cfnf - [RED] Account (OAuth) as Thing: Graph storage tests
 *
 * Test Coverage:
 * - Account Thing CRUD operations via AccountThingStore
 * - linkedTo relationship between Account and User
 * - OAuth provider fields storage
 * - Multiple accounts per user
 * - Account lookup by provider
 *
 * NO MOCKS - uses real SQLiteGraphStore per project testing philosophy.
 *
 * TDD Rules: These tests are written FIRST and expected to FAIL until
 * the AccountThingStore abstraction is implemented.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores/sqlite'

// ============================================================================
// TYPE DEFINITIONS - These define the interface that needs to be implemented
// ============================================================================

/**
 * Account entity representing an OAuth connection.
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
 * Input for creating a new Account.
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
 * Input for updating an Account.
 */
export interface UpdateAccountInput {
  accessToken?: string | null
  refreshToken?: string | null
  accessTokenExpiresAt?: Date | null
  refreshTokenExpiresAt?: Date | null
  scope?: string | null
}

/**
 * User entity for relationship testing.
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
 * Input for creating a User.
 */
export interface CreateUserInput {
  email: string
  name?: string | null
  emailVerified?: boolean
  image?: string | null
}

/**
 * AccountThingStore provides a domain-specific interface for managing
 * Account Things with linkedTo relationships to Users.
 *
 * This abstraction wraps the low-level GraphStore operations to provide
 * a clean API for OAuth account management.
 */
export interface AccountThingStore {
  // Account CRUD
  createAccount(input: CreateAccountInput): Promise<Account>
  getAccountById(id: string): Promise<Account | null>
  getAccountByProvider(provider: string, providerAccountId: string): Promise<Account | null>
  getAccountsByUserId(userId: string): Promise<Account[]>
  updateAccount(id: string, input: UpdateAccountInput): Promise<Account>
  deleteAccount(id: string): Promise<void>

  // User operations (for relationship testing)
  createUser(input: CreateUserInput): Promise<User>
  getUserById(id: string): Promise<User | null>
  deleteUser(id: string): Promise<void>

  // Relationship queries
  getLinkedUser(accountId: string): Promise<User | null>
  getLinkedAccounts(userId: string): Promise<Account[]>
}

/**
 * Factory function to create an AccountThingStore from a GraphStore.
 * This is the function that needs to be implemented.
 */
// This import will fail until the module is created
// import { createAccountThingStore } from '../stores/account-thing'

// ============================================================================
// TEST SUITE: AccountThingStore Interface
// ============================================================================

describe('[RED] AccountThingStore Interface', () => {
  /**
   * These tests verify the AccountThingStore can be imported and created.
   * They will FAIL until the implementation exists.
   */

  it('AccountThingStore is exported from db/graph/stores', async () => {
    // This will fail until AccountThingStore is implemented
    const { createAccountThingStore } = await import('../stores/account-thing')
    expect(createAccountThingStore).toBeDefined()
    expect(typeof createAccountThingStore).toBe('function')
  })

  it('createAccountThingStore accepts a GraphStore', async () => {
    const { createAccountThingStore } = await import('../stores/account-thing')
    const graphStore = new SQLiteGraphStore(':memory:')
    await graphStore.initialize()

    const accountStore = await createAccountThingStore(graphStore)
    expect(accountStore).toBeDefined()

    await graphStore.close()
  })

  it('AccountThingStore has all required methods', async () => {
    const { createAccountThingStore } = await import('../stores/account-thing')
    const graphStore = new SQLiteGraphStore(':memory:')
    await graphStore.initialize()

    const accountStore = await createAccountThingStore(graphStore)

    // Account methods
    expect(typeof accountStore.createAccount).toBe('function')
    expect(typeof accountStore.getAccountById).toBe('function')
    expect(typeof accountStore.getAccountByProvider).toBe('function')
    expect(typeof accountStore.getAccountsByUserId).toBe('function')
    expect(typeof accountStore.updateAccount).toBe('function')
    expect(typeof accountStore.deleteAccount).toBe('function')

    // User methods
    expect(typeof accountStore.createUser).toBe('function')
    expect(typeof accountStore.getUserById).toBe('function')
    expect(typeof accountStore.deleteUser).toBe('function')

    // Relationship methods
    expect(typeof accountStore.getLinkedUser).toBe('function')
    expect(typeof accountStore.getLinkedAccounts).toBe('function')

    await graphStore.close()
  })
})

// ============================================================================
// TEST SUITE: Account CRUD via AccountThingStore
// ============================================================================

describe('[RED] Account CRUD via AccountThingStore', () => {
  let graphStore: SQLiteGraphStore
  let accountStore: AccountThingStore

  beforeEach(async () => {
    graphStore = new SQLiteGraphStore(':memory:')
    await graphStore.initialize()

    // This will fail until implemented
    const { createAccountThingStore } = await import('../stores/account-thing')
    accountStore = await createAccountThingStore(graphStore)
  })

  afterEach(async () => {
    await graphStore.close()
  })

  describe('createAccount', () => {
    let userId: string

    beforeEach(async () => {
      const user = await accountStore.createUser({ email: 'test@example.com' })
      userId = user.id
    })

    it('creates Account with minimal fields', async () => {
      const account = await accountStore.createAccount({
        userId,
        provider: 'github',
        providerAccountId: 'gh-12345',
      })

      expect(account.id).toBeDefined()
      expect(account.userId).toBe(userId)
      expect(account.provider).toBe('github')
      expect(account.providerAccountId).toBe('gh-12345')
      expect(account.accessToken).toBeNull()
      expect(account.refreshToken).toBeNull()
    })

    it('creates Account with all OAuth fields', async () => {
      const expiresAt = new Date(Date.now() + 3600000)
      const refreshExpiresAt = new Date(Date.now() + 86400000)

      const account = await accountStore.createAccount({
        userId,
        provider: 'google',
        providerAccountId: 'google-987654',
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

    it('automatically creates linkedTo relationship', async () => {
      const account = await accountStore.createAccount({
        userId,
        provider: 'github',
        providerAccountId: 'gh-auto-link',
      })

      // Verify relationship was created
      const linkedUser = await accountStore.getLinkedUser(account.id)
      expect(linkedUser).not.toBeNull()
      expect(linkedUser?.id).toBe(userId)
    })

    it('generates timestamps on create', async () => {
      const before = new Date()

      const account = await accountStore.createAccount({
        userId,
        provider: 'github',
        providerAccountId: 'gh-timestamps',
      })

      const after = new Date()

      expect(account.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(account.createdAt.getTime()).toBeLessThanOrEqual(after.getTime())
      expect(account.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    })

    it('rejects duplicate provider+providerAccountId', async () => {
      await accountStore.createAccount({
        userId,
        provider: 'github',
        providerAccountId: 'gh-duplicate',
      })

      await expect(
        accountStore.createAccount({
          userId,
          provider: 'github',
          providerAccountId: 'gh-duplicate',
        })
      ).rejects.toThrow()
    })
  })

  describe('getAccountById', () => {
    it('retrieves Account by ID', async () => {
      const user = await accountStore.createUser({ email: 'getbyid@example.com' })
      const created = await accountStore.createAccount({
        userId: user.id,
        provider: 'github',
        providerAccountId: 'gh-getbyid',
      })

      const account = await accountStore.getAccountById(created.id)

      expect(account).not.toBeNull()
      expect(account?.id).toBe(created.id)
      expect(account?.provider).toBe('github')
    })

    it('returns null for non-existent ID', async () => {
      const account = await accountStore.getAccountById('non-existent-id')

      expect(account).toBeNull()
    })
  })

  describe('getAccountByProvider', () => {
    it('finds Account by provider and providerAccountId', async () => {
      const user = await accountStore.createUser({ email: 'provider@example.com' })
      await accountStore.createAccount({
        userId: user.id,
        provider: 'github',
        providerAccountId: 'gh-provider-lookup',
        accessToken: 'gho_findme',
      })

      const account = await accountStore.getAccountByProvider('github', 'gh-provider-lookup')

      expect(account).not.toBeNull()
      expect(account?.provider).toBe('github')
      expect(account?.providerAccountId).toBe('gh-provider-lookup')
      expect(account?.accessToken).toBe('gho_findme')
    })

    it('returns null for non-existent provider', async () => {
      const account = await accountStore.getAccountByProvider('twitter', 'tw-12345')

      expect(account).toBeNull()
    })

    it('returns null for wrong providerAccountId', async () => {
      const user = await accountStore.createUser({ email: 'wrongid@example.com' })
      await accountStore.createAccount({
        userId: user.id,
        provider: 'github',
        providerAccountId: 'gh-exists',
      })

      const account = await accountStore.getAccountByProvider('github', 'gh-wrong')

      expect(account).toBeNull()
    })
  })

  describe('getAccountsByUserId', () => {
    it('retrieves all Accounts for a User', async () => {
      const user = await accountStore.createUser({ email: 'multi@example.com' })

      await accountStore.createAccount({
        userId: user.id,
        provider: 'github',
        providerAccountId: 'gh-multi-1',
      })

      await accountStore.createAccount({
        userId: user.id,
        provider: 'google',
        providerAccountId: 'gl-multi-1',
      })

      await accountStore.createAccount({
        userId: user.id,
        provider: 'discord',
        providerAccountId: 'dc-multi-1',
      })

      const accounts = await accountStore.getAccountsByUserId(user.id)

      expect(accounts.length).toBe(3)
      expect(accounts.map((a) => a.provider).sort()).toEqual(['discord', 'github', 'google'])
    })

    it('returns empty array for User with no Accounts', async () => {
      const user = await accountStore.createUser({ email: 'noaccounts@example.com' })

      const accounts = await accountStore.getAccountsByUserId(user.id)

      expect(accounts).toHaveLength(0)
    })

    it('does not return Accounts of other Users', async () => {
      const user1 = await accountStore.createUser({ email: 'user1@example.com' })
      const user2 = await accountStore.createUser({ email: 'user2@example.com' })

      await accountStore.createAccount({
        userId: user1.id,
        provider: 'github',
        providerAccountId: 'gh-user1',
      })

      await accountStore.createAccount({
        userId: user2.id,
        provider: 'github',
        providerAccountId: 'gh-user2',
      })

      const user1Accounts = await accountStore.getAccountsByUserId(user1.id)

      expect(user1Accounts.length).toBe(1)
      expect(user1Accounts[0]?.providerAccountId).toBe('gh-user1')
    })
  })

  describe('updateAccount', () => {
    let userId: string
    let accountId: string

    beforeEach(async () => {
      const user = await accountStore.createUser({ email: 'update@example.com' })
      userId = user.id

      const account = await accountStore.createAccount({
        userId,
        provider: 'github',
        providerAccountId: 'gh-update',
        accessToken: 'old_token',
      })
      accountId = account.id
    })

    it('updates access token', async () => {
      const updated = await accountStore.updateAccount(accountId, {
        accessToken: 'new_refreshed_token',
        accessTokenExpiresAt: new Date(Date.now() + 3600000),
      })

      expect(updated.accessToken).toBe('new_refreshed_token')
      expect(updated.accessTokenExpiresAt).not.toBeNull()
    })

    it('updates refresh token', async () => {
      const updated = await accountStore.updateAccount(accountId, {
        refreshToken: 'new_refresh_token',
        refreshTokenExpiresAt: new Date(Date.now() + 86400000),
      })

      expect(updated.refreshToken).toBe('new_refresh_token')
    })

    it('updates scope', async () => {
      const updated = await accountStore.updateAccount(accountId, {
        scope: 'user:email read:user repo',
      })

      expect(updated.scope).toBe('user:email read:user repo')
    })

    it('updates updatedAt timestamp', async () => {
      const original = await accountStore.getAccountById(accountId)

      await new Promise((resolve) => setTimeout(resolve, 10))

      const updated = await accountStore.updateAccount(accountId, {
        accessToken: 'token_after_delay',
      })

      expect(updated.updatedAt.getTime()).toBeGreaterThan(original!.updatedAt.getTime())
    })

    it('throws for non-existent Account', async () => {
      await expect(
        accountStore.updateAccount('non-existent', { accessToken: 'new' })
      ).rejects.toThrow()
    })
  })

  describe('deleteAccount', () => {
    it('deletes Account by ID', async () => {
      const user = await accountStore.createUser({ email: 'delete@example.com' })
      const account = await accountStore.createAccount({
        userId: user.id,
        provider: 'github',
        providerAccountId: 'gh-delete',
      })

      await accountStore.deleteAccount(account.id)

      const deleted = await accountStore.getAccountById(account.id)
      expect(deleted).toBeNull()
    })

    it('removes linkedTo relationship when Account is deleted', async () => {
      const user = await accountStore.createUser({ email: 'delete-rel@example.com' })
      const account = await accountStore.createAccount({
        userId: user.id,
        provider: 'github',
        providerAccountId: 'gh-delete-rel',
      })

      await accountStore.deleteAccount(account.id)

      const linkedAccounts = await accountStore.getLinkedAccounts(user.id)
      expect(linkedAccounts.find((a) => a.id === account.id)).toBeUndefined()
    })

    it('does not throw for non-existent Account', async () => {
      await expect(accountStore.deleteAccount('non-existent')).resolves.not.toThrow()
    })
  })
})

// ============================================================================
// TEST SUITE: linkedTo Relationship via AccountThingStore
// ============================================================================

describe('[RED] linkedTo Relationship via AccountThingStore', () => {
  let graphStore: SQLiteGraphStore
  let accountStore: AccountThingStore
  let userId: string
  let accountId: string

  beforeEach(async () => {
    graphStore = new SQLiteGraphStore(':memory:')
    await graphStore.initialize()

    const { createAccountThingStore } = await import('../stores/account-thing')
    accountStore = await createAccountThingStore(graphStore)

    const user = await accountStore.createUser({
      email: 'linkedto@example.com',
      name: 'LinkedTo User',
    })
    userId = user.id

    const account = await accountStore.createAccount({
      userId,
      provider: 'github',
      providerAccountId: 'gh-linkedto',
    })
    accountId = account.id
  })

  afterEach(async () => {
    await graphStore.close()
  })

  describe('getLinkedUser', () => {
    it('finds User linked to Account', async () => {
      const user = await accountStore.getLinkedUser(accountId)

      expect(user).not.toBeNull()
      expect(user?.id).toBe(userId)
      expect(user?.email).toBe('linkedto@example.com')
    })

    it('returns null for Account with no linkedTo relationship', async () => {
      // Create account without relationship (edge case)
      // This might not be possible through the normal API
      const user = await accountStore.getLinkedUser('orphan-account-id')

      expect(user).toBeNull()
    })
  })

  describe('getLinkedAccounts', () => {
    it('finds all Accounts linked to User', async () => {
      // Create additional accounts
      await accountStore.createAccount({
        userId,
        provider: 'google',
        providerAccountId: 'gl-linked',
      })

      await accountStore.createAccount({
        userId,
        provider: 'discord',
        providerAccountId: 'dc-linked',
      })

      const accounts = await accountStore.getLinkedAccounts(userId)

      expect(accounts.length).toBe(3)
      expect(accounts.map((a) => a.provider).sort()).toEqual(['discord', 'github', 'google'])
    })

    it('returns empty array for User with no linked Accounts', async () => {
      const newUser = await accountStore.createUser({ email: 'nolinks@example.com' })

      const accounts = await accountStore.getLinkedAccounts(newUser.id)

      expect(accounts).toHaveLength(0)
    })
  })
})

// ============================================================================
// TEST SUITE: User Cascade Deletion
// ============================================================================

describe('[RED] User Cascade Deletion', () => {
  let graphStore: SQLiteGraphStore
  let accountStore: AccountThingStore

  beforeEach(async () => {
    graphStore = new SQLiteGraphStore(':memory:')
    await graphStore.initialize()

    const { createAccountThingStore } = await import('../stores/account-thing')
    accountStore = await createAccountThingStore(graphStore)
  })

  afterEach(async () => {
    await graphStore.close()
  })

  it('deletes all linked Accounts when User is deleted', async () => {
    const user = await accountStore.createUser({ email: 'cascade@example.com' })

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

    await accountStore.deleteUser(user.id)

    expect(await accountStore.getAccountById(account1.id)).toBeNull()
    expect(await accountStore.getAccountById(account2.id)).toBeNull()
  })

  it('removes linkedTo relationships when User is deleted', async () => {
    const user = await accountStore.createUser({ email: 'cascade-rel@example.com' })

    await accountStore.createAccount({
      userId: user.id,
      provider: 'github',
      providerAccountId: 'gh-cascade-rel',
    })

    await accountStore.deleteUser(user.id)

    // Verify relationships are cleaned up via graph store
    const relationships = await graphStore.queryRelationshipsTo(`auth://users/${user.id}`)
    expect(relationships.length).toBe(0)
  })
})

// ============================================================================
// TEST SUITE: Multiple Providers Per User
// ============================================================================

describe('[RED] Multiple Providers Per User', () => {
  let graphStore: SQLiteGraphStore
  let accountStore: AccountThingStore

  beforeEach(async () => {
    graphStore = new SQLiteGraphStore(':memory:')
    await graphStore.initialize()

    const { createAccountThingStore } = await import('../stores/account-thing')
    accountStore = await createAccountThingStore(graphStore)
  })

  afterEach(async () => {
    await graphStore.close()
  })

  it('allows User to have accounts from 5+ providers', async () => {
    const user = await accountStore.createUser({ email: 'multi-provider@example.com' })

    const providers = ['github', 'google', 'discord', 'twitter', 'facebook', 'apple', 'microsoft']

    for (const provider of providers) {
      await accountStore.createAccount({
        userId: user.id,
        provider,
        providerAccountId: `${provider}-12345`,
      })
    }

    const accounts = await accountStore.getAccountsByUserId(user.id)
    expect(accounts.length).toBe(7)
  })

  it('can unlink one provider without affecting others', async () => {
    const user = await accountStore.createUser({ email: 'unlink@example.com' })

    const ghAccount = await accountStore.createAccount({
      userId: user.id,
      provider: 'github',
      providerAccountId: 'gh-unlink',
    })

    await accountStore.createAccount({
      userId: user.id,
      provider: 'google',
      providerAccountId: 'gl-unlink',
    })

    await accountStore.deleteAccount(ghAccount.id)

    const accounts = await accountStore.getAccountsByUserId(user.id)
    expect(accounts.length).toBe(1)
    expect(accounts[0]?.provider).toBe('google')
  })
})

// ============================================================================
// TEST SUITE: OAuth Token Management
// ============================================================================

describe('[RED] OAuth Token Management', () => {
  let graphStore: SQLiteGraphStore
  let accountStore: AccountThingStore
  let userId: string

  beforeEach(async () => {
    graphStore = new SQLiteGraphStore(':memory:')
    await graphStore.initialize()

    const { createAccountThingStore } = await import('../stores/account-thing')
    accountStore = await createAccountThingStore(graphStore)

    const user = await accountStore.createUser({ email: 'tokens@example.com' })
    userId = user.id
  })

  afterEach(async () => {
    await graphStore.close()
  })

  it('stores and retrieves GitHub token format', async () => {
    const account = await accountStore.createAccount({
      userId,
      provider: 'github',
      providerAccountId: 'gh-token-format',
      accessToken: 'gho_16C7e42F292c6912E7710c838347Ae178B4a',
      refreshToken: 'ghr_1B4a2e77838347Ae12E7710c706C2F921e16',
    })

    const retrieved = await accountStore.getAccountById(account.id)
    expect(retrieved?.accessToken).toMatch(/^gho_/)
    expect(retrieved?.refreshToken).toMatch(/^ghr_/)
  })

  it('stores and retrieves Google token format', async () => {
    const account = await accountStore.createAccount({
      userId,
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

  it('handles token refresh update', async () => {
    const account = await accountStore.createAccount({
      userId,
      provider: 'github',
      providerAccountId: 'gh-refresh',
      accessToken: 'old_token',
      accessTokenExpiresAt: new Date(Date.now() - 1000), // Expired
    })

    const newExpiresAt = new Date(Date.now() + 3600000)
    const updated = await accountStore.updateAccount(account.id, {
      accessToken: 'new_refreshed_token',
      accessTokenExpiresAt: newExpiresAt,
    })

    expect(updated.accessToken).toBe('new_refreshed_token')
    expect(updated.accessTokenExpiresAt?.getTime()).toBe(newExpiresAt.getTime())
  })

  it('preserves special characters in tokens', async () => {
    const specialToken = 'token+with/special=chars=='

    const account = await accountStore.createAccount({
      userId,
      provider: 'custom',
      providerAccountId: 'custom-special',
      accessToken: specialToken,
    })

    const retrieved = await accountStore.getAccountById(account.id)
    expect(retrieved?.accessToken).toBe(specialToken)
  })
})

// ============================================================================
// TEST SUITE: Graph Storage Verification
// ============================================================================

describe('[RED] Graph Storage Verification', () => {
  let graphStore: SQLiteGraphStore
  let accountStore: AccountThingStore

  beforeEach(async () => {
    graphStore = new SQLiteGraphStore(':memory:')
    await graphStore.initialize()

    const { createAccountThingStore } = await import('../stores/account-thing')
    accountStore = await createAccountThingStore(graphStore)
  })

  afterEach(async () => {
    await graphStore.close()
  })

  it('stores Account as Thing with typeName "Account"', async () => {
    const user = await accountStore.createUser({ email: 'thing@example.com' })
    const account = await accountStore.createAccount({
      userId: user.id,
      provider: 'github',
      providerAccountId: 'gh-thing',
    })

    // Verify via underlying graph store
    const thing = await graphStore.getThing(account.id)

    expect(thing).not.toBeNull()
    expect(thing?.typeName).toBe('Account')
  })

  it('stores User as Thing with typeName "User"', async () => {
    const user = await accountStore.createUser({ email: 'user-thing@example.com' })

    const thing = await graphStore.getThing(user.id)

    expect(thing).not.toBeNull()
    expect(thing?.typeName).toBe('User')
  })

  it('creates linkedTo relationship in graph store', async () => {
    const user = await accountStore.createUser({ email: 'graph-rel@example.com' })
    const account = await accountStore.createAccount({
      userId: user.id,
      provider: 'github',
      providerAccountId: 'gh-graph-rel',
    })

    // Query relationship via graph store
    const relationships = await graphStore.queryRelationshipsFrom(`auth://accounts/${account.id}`)

    const linkedTo = relationships.find((r) => r.verb === 'linkedTo')
    expect(linkedTo).toBeDefined()
    expect(linkedTo?.to).toBe(`auth://users/${user.id}`)
  })

  it('uses auth:// URL scheme for entities', async () => {
    const user = await accountStore.createUser({ email: 'url@example.com' })
    const account = await accountStore.createAccount({
      userId: user.id,
      provider: 'github',
      providerAccountId: 'gh-url',
    })

    const relationships = await graphStore.queryRelationshipsFrom(`auth://accounts/${account.id}`)

    expect(relationships.length).toBeGreaterThan(0)
    expect(relationships[0]?.from).toMatch(/^auth:\/\/accounts\//)
    expect(relationships[0]?.to).toMatch(/^auth:\/\/users\//)
  })
})

// ============================================================================
// TEST SUITE: Edge Cases
// ============================================================================

describe('[RED] Edge Cases', () => {
  let graphStore: SQLiteGraphStore
  let accountStore: AccountThingStore

  beforeEach(async () => {
    graphStore = new SQLiteGraphStore(':memory:')
    await graphStore.initialize()

    const { createAccountThingStore } = await import('../stores/account-thing')
    accountStore = await createAccountThingStore(graphStore)
  })

  afterEach(async () => {
    await graphStore.close()
  })

  it('handles very long providerAccountId', async () => {
    const user = await accountStore.createUser({ email: 'long@example.com' })
    const longId = 'a'.repeat(500)

    const account = await accountStore.createAccount({
      userId: user.id,
      provider: 'custom',
      providerAccountId: longId,
    })

    expect(account.providerAccountId.length).toBe(500)
  })

  it('handles concurrent Account creation', async () => {
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
    expect(new Set(accounts.map((a) => a.id)).size).toBe(10)
  })

  it('handles null token expiration dates', async () => {
    const user = await accountStore.createUser({ email: 'null-dates@example.com' })

    const account = await accountStore.createAccount({
      userId: user.id,
      provider: 'discord',
      providerAccountId: 'dc-null-dates',
      accessToken: 'token',
      refreshToken: 'refresh',
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
    })

    expect(account.accessTokenExpiresAt).toBeNull()
    expect(account.refreshTokenExpiresAt).toBeNull()
  })

  it('handles empty scope string', async () => {
    const user = await accountStore.createUser({ email: 'empty-scope@example.com' })

    const account = await accountStore.createAccount({
      userId: user.id,
      provider: 'custom',
      providerAccountId: 'custom-empty',
      scope: '',
    })

    // Empty string should be stored as empty, not null
    // (or converted to null - depends on implementation)
    expect(account.scope === '' || account.scope === null).toBe(true)
  })
})
