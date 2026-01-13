/**
 * AccountThingStore - Domain-specific store for OAuth Account management
 *
 * GREEN PHASE: Implements the AccountThingStore interface to pass all tests
 * defined in db/graph/tests/account-thing-linkedto.test.ts.
 *
 * @see dotdo-pay1l - [GREEN] Account (OAuth) as Thing: Implementation
 *
 * Design:
 * - Uses GraphStore for Thing and Relationship operations
 * - Account Things have linkedTo relationships to User Things
 * - Supports multiple OAuth providers per user
 * - Provider + providerAccountId uniqueness enforced
 */

import type { GraphStore, GraphThing, GraphRelationship } from '../types'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Type ID for Account Things */
export const ACCOUNT_TYPE_ID = 3

/** Type name for Account Things */
export const ACCOUNT_TYPE_NAME = 'Account'

/** Type ID for User Things */
export const USER_TYPE_ID = 10

/** Type name for User Things */
export const USER_TYPE_NAME = 'User'

/** Verb for Account -> User relationship */
export const LINKED_TO_VERB = 'linkedTo'

// ============================================================================
// TYPE DEFINITIONS
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
 * AccountThingStore interface
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

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate a unique account ID (raw, without URL scheme)
 */
function generateAccountId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

/**
 * Generate a unique user ID (raw, without URL scheme)
 */
function generateUserId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

/**
 * Get auth:// URL for an account
 */
function accountUrl(id: string): string {
  return `auth://accounts/${id}`
}

/**
 * Get auth:// URL for a user
 */
function userUrl(id: string): string {
  return `auth://users/${id}`
}

/**
 * Convert a GraphThing to Account
 */
function thingToAccount(thing: GraphThing, userId: string): Account {
  const data = thing.data as Record<string, unknown>
  return {
    id: thing.id,
    userId,
    provider: data.provider as string,
    providerAccountId: data.providerAccountId as string,
    accessToken: (data.accessToken as string | null) ?? null,
    refreshToken: (data.refreshToken as string | null) ?? null,
    accessTokenExpiresAt: data.accessTokenExpiresAt
      ? new Date(data.accessTokenExpiresAt as number)
      : null,
    refreshTokenExpiresAt: data.refreshTokenExpiresAt
      ? new Date(data.refreshTokenExpiresAt as number)
      : null,
    scope: (data.scope as string | null) ?? null,
    createdAt: new Date(thing.createdAt),
    updatedAt: new Date(thing.updatedAt),
  }
}

/**
 * Convert a GraphThing to User
 */
function thingToUser(thing: GraphThing): User {
  const data = thing.data as Record<string, unknown>
  return {
    id: thing.id,
    email: data.email as string,
    name: (data.name as string | null) ?? null,
    emailVerified: (data.emailVerified as boolean) ?? false,
    image: (data.image as string | null) ?? null,
    createdAt: new Date(thing.createdAt),
    updatedAt: new Date(thing.updatedAt),
  }
}

// ============================================================================
// ACCOUNT THING STORE IMPLEMENTATION
// ============================================================================

/**
 * AccountThingStoreImpl wraps GraphStore for OAuth account management
 */
class AccountThingStoreImpl implements AccountThingStore {
  constructor(private store: GraphStore) {}

  // -------------------------------------------------------------------------
  // Account CRUD
  // -------------------------------------------------------------------------

  async createAccount(input: CreateAccountInput): Promise<Account> {
    const id = generateAccountId()

    // Create the Account Thing - relies on database unique constraint for race safety
    // The unique index on (provider, providerAccountId) prevents TOCTOU race conditions
    let thing
    try {
      thing = await this.store.createThing({
        id,
        typeId: ACCOUNT_TYPE_ID,
        typeName: ACCOUNT_TYPE_NAME,
        data: {
          provider: input.provider,
          providerAccountId: input.providerAccountId,
          accessToken: input.accessToken ?? null,
          refreshToken: input.refreshToken ?? null,
          accessTokenExpiresAt: input.accessTokenExpiresAt?.getTime() ?? null,
          refreshTokenExpiresAt: input.refreshTokenExpiresAt?.getTime() ?? null,
          scope: input.scope ?? null,
          userId: input.userId,
        },
      })
    } catch (error: unknown) {
      // Catch UNIQUE constraint violation from the database-level unique index
      // and convert to a friendly domain-specific error
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new Error(`Account already exists for provider ${input.provider} with id ${input.providerAccountId}`)
      }
      throw error
    }

    // Create linkedTo relationship from Account to User (using auth:// URL scheme)
    await this.store.createRelationship({
      id: `${accountUrl(id)}-linkedTo-${userUrl(input.userId)}`,
      verb: LINKED_TO_VERB,
      from: accountUrl(id),
      to: userUrl(input.userId),
    })

    return thingToAccount(thing, input.userId)
  }

  async getAccountById(id: string): Promise<Account | null> {
    const thing = await this.store.getThing(id)
    // Check if thing exists, is Account type, and is not soft-deleted
    if (!thing || thing.typeName !== ACCOUNT_TYPE_NAME || thing.deletedAt !== null) return null

    // Get the linkedTo relationship to find userId (using auth:// URL scheme)
    const rels = await this.store.queryRelationshipsFrom(accountUrl(id), { verb: LINKED_TO_VERB })
    // Extract raw userId from auth:// URL
    const rawUserId = rels.length > 0
      ? rels[0]!.to.replace('auth://users/', '')
      : ((thing.data as Record<string, unknown>).userId as string)

    return thingToAccount(thing, rawUserId)
  }

  async getAccountByProvider(provider: string, providerAccountId: string): Promise<Account | null> {
    // Query all Account Things
    const accounts = await this.store.getThingsByType({
      typeName: ACCOUNT_TYPE_NAME,
      limit: 1000,
    })

    for (const thing of accounts) {
      const data = thing.data as Record<string, unknown>
      if (data.provider === provider && data.providerAccountId === providerAccountId) {
        // Get userId from relationship or data (using auth:// URL scheme)
        const rels = await this.store.queryRelationshipsFrom(accountUrl(thing.id), { verb: LINKED_TO_VERB })
        const rawUserId = rels.length > 0
          ? rels[0]!.to.replace('auth://users/', '')
          : (data.userId as string)
        return thingToAccount(thing, rawUserId)
      }
    }

    return null
  }

  async getAccountsByUserId(userId: string): Promise<Account[]> {
    // Query relationships TO user with verb linkedTo (using auth:// URL scheme)
    const rels = await this.store.queryRelationshipsTo(userUrl(userId), { verb: LINKED_TO_VERB })

    const accounts: Account[] = []
    for (const rel of rels) {
      // Extract raw account ID from auth:// URL
      const rawAccountId = rel.from.replace('auth://accounts/', '')
      const account = await this.getAccountById(rawAccountId)
      if (account) {
        accounts.push(account)
      }
    }

    return accounts
  }

  async updateAccount(id: string, input: UpdateAccountInput): Promise<Account> {
    const existing = await this.getAccountById(id)
    if (!existing) {
      throw new Error(`Account not found: ${id}`)
    }

    const updates: Record<string, unknown> = {}
    if (input.accessToken !== undefined) updates.accessToken = input.accessToken
    if (input.refreshToken !== undefined) updates.refreshToken = input.refreshToken
    if (input.accessTokenExpiresAt !== undefined) {
      updates.accessTokenExpiresAt = input.accessTokenExpiresAt?.getTime() ?? null
    }
    if (input.refreshTokenExpiresAt !== undefined) {
      updates.refreshTokenExpiresAt = input.refreshTokenExpiresAt?.getTime() ?? null
    }
    if (input.scope !== undefined) updates.scope = input.scope

    const updated = await this.store.updateThing(id, { data: updates })
    return thingToAccount(updated!, existing.userId)
  }

  async deleteAccount(id: string): Promise<void> {
    // Delete the linkedTo relationship first (using auth:// URL scheme)
    const rels = await this.store.queryRelationshipsFrom(accountUrl(id), { verb: LINKED_TO_VERB })
    for (const rel of rels) {
      await this.store.deleteRelationship(rel.id)
    }

    // Delete the Account Thing
    await this.store.deleteThing(id)
  }

  // -------------------------------------------------------------------------
  // User Operations
  // -------------------------------------------------------------------------

  async createUser(input: CreateUserInput): Promise<User> {
    const id = generateUserId()

    const thing = await this.store.createThing({
      id,
      typeId: USER_TYPE_ID,
      typeName: USER_TYPE_NAME,
      data: {
        email: input.email,
        name: input.name ?? null,
        emailVerified: input.emailVerified ?? false,
        image: input.image ?? null,
        status: 'active',
      },
    })

    return thingToUser(thing)
  }

  async getUserById(id: string): Promise<User | null> {
    const thing = await this.store.getThing(id)
    // Check if thing exists, is User type, and is not soft-deleted
    if (!thing || thing.typeName !== USER_TYPE_NAME || thing.deletedAt !== null) return null
    return thingToUser(thing)
  }

  async deleteUser(id: string): Promise<void> {
    // Get all accounts linked to this user (cascade delete)
    const accounts = await this.getAccountsByUserId(id)
    for (const account of accounts) {
      await this.deleteAccount(account.id)
    }

    // Delete the User Thing
    await this.store.deleteThing(id)
  }

  // -------------------------------------------------------------------------
  // Relationship Queries
  // -------------------------------------------------------------------------

  async getLinkedUser(accountId: string): Promise<User | null> {
    // Query using auth:// URL scheme
    const rels = await this.store.queryRelationshipsFrom(accountUrl(accountId), { verb: LINKED_TO_VERB })
    if (rels.length === 0) return null
    // Extract raw userId from auth:// URL
    const rawUserId = rels[0]!.to.replace('auth://users/', '')
    return this.getUserById(rawUserId)
  }

  async getLinkedAccounts(userId: string): Promise<Account[]> {
    return this.getAccountsByUserId(userId)
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create an AccountThingStore instance
 *
 * @param store - GraphStore instance
 * @returns AccountThingStore
 */
export async function createAccountThingStore(store: GraphStore): Promise<AccountThingStore> {
  return new AccountThingStoreImpl(store)
}
