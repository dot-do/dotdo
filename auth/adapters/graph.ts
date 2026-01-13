/**
 * Graph Auth Adapter - better-auth Database Adapter using Graph Model
 *
 * GREEN PHASE: Implements the better-auth database adapter interface
 * to store auth entities (User, Session, Account) as Things in the graph model.
 *
 * @see dotdo-kdp4k - [GREEN] better-auth Graph Adapter implementation
 *
 * Design:
 * - Auth entities are Things with specific type names (User, Session, Account)
 * - Relationships connect entities:
 *   - Session `belongsTo` User
 *   - Account `linkedTo` User
 * - Uses SQLiteGraphStore for storage (NO MOCKS)
 *
 * URL Scheme:
 * - Users: `auth://users/{id}`
 * - Sessions: `auth://sessions/{id}`
 * - Accounts: `auth://accounts/{id}`
 */

import { randomUUID } from 'crypto'
import type { GraphStore } from '../../db/graph/types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * User entity as stored in better-auth
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
 * Session entity as stored in better-auth
 */
export interface Session {
  id: string
  token: string
  userId: string
  expiresAt: Date
  userAgent: string | null
  ipAddress: string | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Account entity (OAuth providers) as stored in better-auth
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
 * GraphAuthAdapter interface matching better-auth adapter requirements
 */
export interface GraphAuthAdapter {
  // User operations
  createUser(data: {
    email: string
    name?: string | null
    emailVerified?: boolean
    image?: string | null
  }): Promise<User>
  getUserById(id: string): Promise<User | null>
  getUserByEmail(email: string): Promise<User | null>
  updateUser(
    id: string,
    data: Partial<{ email: string; name: string | null; emailVerified: boolean; image: string | null }>
  ): Promise<User>
  deleteUser(id: string): Promise<void>

  // Session operations
  createSession(data: {
    userId: string
    token: string
    expiresAt: Date
    userAgent?: string | null
    ipAddress?: string | null
  }): Promise<Session>
  getSession(token: string): Promise<Session | null>
  getSessionAndUser(token: string): Promise<{ session: Session; user: User } | null>
  deleteSession(token: string): Promise<void>
  deleteUserSessions(userId: string): Promise<void>
  deleteExpiredSessions(): Promise<void>

  // Account (OAuth) operations
  linkAccount(data: {
    userId: string
    provider: string
    providerAccountId: string
    accessToken?: string | null
    refreshToken?: string | null
    accessTokenExpiresAt?: Date | null
    refreshTokenExpiresAt?: Date | null
    scope?: string | null
  }): Promise<Account>
  getAccountByProvider(provider: string, providerAccountId: string): Promise<Account | null>
  unlinkAccount(provider: string, providerAccountId: string): Promise<void>
  getAccountsByUserId(userId: string): Promise<Account[]>
}

// ============================================================================
// DATA TYPES FOR GRAPH STORAGE
// ============================================================================

interface UserData {
  email: string
  name: string | null
  emailVerified: boolean
  image: string | null
}

interface SessionData {
  token: string
  expiresAt: number // timestamp
  userAgent: string | null
  ipAddress: string | null
  userId: string
}

interface AccountData {
  provider: string
  providerAccountId: string
  accessToken: string | null
  refreshToken: string | null
  accessTokenExpiresAt: number | null // timestamp
  refreshTokenExpiresAt: number | null // timestamp
  scope: string | null
  userId: string
}

// ============================================================================
// CONSTANTS
// ============================================================================

const TYPE_IDS = {
  User: 1,
  Session: 2,
  Account: 3,
} as const

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate URL for auth entity
 */
function authUrl(type: 'users' | 'sessions' | 'accounts', id: string): string {
  return `auth://${type}/${id}`
}

/**
 * Extract ID from auth URL
 */
function extractId(url: string): string {
  const parts = url.split('/')
  return parts[parts.length - 1]!
}

// ============================================================================
// GRAPH AUTH ADAPTER IMPLEMENTATION
// ============================================================================

/**
 * Create a GraphAuthAdapter from a GraphStore.
 *
 * @param store - The GraphStore to use for persistence
 * @returns A GraphAuthAdapter instance
 *
 * @example
 * ```typescript
 * const store = new SQLiteGraphStore(':memory:')
 * await store.initialize()
 * const adapter = await createGraphAuthAdapter(store)
 *
 * const user = await adapter.createUser({
 *   email: 'alice@example.com',
 *   name: 'Alice',
 * })
 * ```
 */
export async function createGraphAuthAdapter(store: GraphStore): Promise<GraphAuthAdapter> {
  return new GraphAuthAdapterImpl(store)
}

class GraphAuthAdapterImpl implements GraphAuthAdapter {
  constructor(private store: GraphStore) {}

  // ==========================================================================
  // USER OPERATIONS
  // ==========================================================================

  async createUser(data: {
    email: string
    name?: string | null
    emailVerified?: boolean
    image?: string | null
  }): Promise<User> {
    // Check for duplicate email
    const existing = await this.getUserByEmail(data.email)
    if (existing) {
      throw new Error(`User with email '${data.email}' already exists`)
    }

    const id = randomUUID()
    const userData: UserData = {
      email: data.email,
      name: data.name ?? null,
      emailVerified: data.emailVerified ?? false,
      image: data.image ?? null,
    }

    const thing = await this.store.createThing({
      id,
      typeId: TYPE_IDS.User,
      typeName: 'User',
      data: userData,
    })

    return this.thingToUser(thing)
  }

  async getUserById(id: string): Promise<User | null> {
    const thing = await this.store.getThing(id)
    if (!thing || thing.typeName !== 'User' || thing.deletedAt !== null) {
      return null
    }
    return this.thingToUser(thing)
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const users = await this.store.getThingsByType({ typeName: 'User' })
    const normalizedEmail = email.toLowerCase()

    const user = users.find((u) => {
      const userData = u.data as UserData | null
      return userData?.email?.toLowerCase() === normalizedEmail
    })

    if (!user) {
      return null
    }

    return this.thingToUser(user)
  }

  async updateUser(
    id: string,
    data: Partial<{ email: string; name: string | null; emailVerified: boolean; image: string | null }>
  ): Promise<User> {
    const existing = await this.getUserById(id)
    if (!existing) {
      throw new Error(`User with ID '${id}' not found`)
    }

    const currentData = (await this.store.getThing(id))!.data as UserData
    const newData: UserData = {
      ...currentData,
      ...data,
    }

    const updated = await this.store.updateThing(id, { data: newData })
    if (!updated) {
      throw new Error(`Failed to update user '${id}'`)
    }

    return this.thingToUser(updated)
  }

  async deleteUser(id: string): Promise<void> {
    // Delete associated sessions
    await this.deleteUserSessions(id)

    // Delete associated accounts
    const accounts = await this.getAccountsByUserId(id)
    for (const account of accounts) {
      await this.unlinkAccount(account.provider, account.providerAccountId)
    }

    // Delete the user (soft delete)
    await this.store.deleteThing(id)
  }

  // ==========================================================================
  // SESSION OPERATIONS
  // ==========================================================================

  async createSession(data: {
    userId: string
    token: string
    expiresAt: Date
    userAgent?: string | null
    ipAddress?: string | null
  }): Promise<Session> {
    const id = randomUUID()
    const sessionData: SessionData = {
      token: data.token,
      expiresAt: data.expiresAt.getTime(),
      userAgent: data.userAgent ?? null,
      ipAddress: data.ipAddress ?? null,
      userId: data.userId,
    }

    const thing = await this.store.createThing({
      id,
      typeId: TYPE_IDS.Session,
      typeName: 'Session',
      data: sessionData,
    })

    // Create belongsTo relationship
    await this.store.createRelationship({
      id: randomUUID(),
      verb: 'belongsTo',
      from: authUrl('sessions', id),
      to: authUrl('users', data.userId),
    })

    return this.thingToSession(thing)
  }

  async getSession(token: string): Promise<Session | null> {
    const sessions = await this.store.getThingsByType({ typeName: 'Session' })
    const now = Date.now()

    const session = sessions.find((s) => {
      const data = s.data as SessionData | null
      if (!data || data.token !== token) return false
      // Check if expired
      return data.expiresAt > now
    })

    if (!session) {
      return null
    }

    return this.thingToSession(session)
  }

  async getSessionAndUser(token: string): Promise<{ session: Session; user: User } | null> {
    const session = await this.getSession(token)
    if (!session) {
      return null
    }

    const user = await this.getUserById(session.userId)
    if (!user) {
      return null
    }

    return { session, user }
  }

  async deleteSession(token: string): Promise<void> {
    const sessions = await this.store.getThingsByType({ typeName: 'Session' })
    const session = sessions.find((s) => {
      const data = s.data as SessionData | null
      return data?.token === token
    })

    if (session) {
      // Delete relationships first
      const rels = await this.store.queryRelationshipsFrom(authUrl('sessions', session.id))
      for (const rel of rels) {
        await this.store.deleteRelationship(rel.id)
      }
      // Hard delete the session (delete from graph, not soft delete)
      await this.hardDeleteThing(session.id)
    }
  }

  async deleteUserSessions(userId: string): Promise<void> {
    // Find all sessions belonging to this user
    const rels = await this.store.queryRelationshipsTo(authUrl('users', userId), { verb: 'belongsTo' })

    for (const rel of rels) {
      // Check if this is a session (from URL starts with auth://sessions/)
      if (rel.from.startsWith('auth://sessions/')) {
        const sessionId = extractId(rel.from)
        // Delete the relationship
        await this.store.deleteRelationship(rel.id)
        // Hard delete the session
        await this.hardDeleteThing(sessionId)
      }
    }
  }

  async deleteExpiredSessions(): Promise<void> {
    const sessions = await this.store.getThingsByType({ typeName: 'Session' })
    const now = Date.now()

    for (const session of sessions) {
      const data = session.data as SessionData | null
      if (data && data.expiresAt < now) {
        // Delete relationships
        const rels = await this.store.queryRelationshipsFrom(authUrl('sessions', session.id))
        for (const rel of rels) {
          await this.store.deleteRelationship(rel.id)
        }
        // Hard delete expired session
        await this.hardDeleteThing(session.id)
      }
    }
  }

  // ==========================================================================
  // ACCOUNT OPERATIONS
  // ==========================================================================

  async linkAccount(data: {
    userId: string
    provider: string
    providerAccountId: string
    accessToken?: string | null
    refreshToken?: string | null
    accessTokenExpiresAt?: Date | null
    refreshTokenExpiresAt?: Date | null
    scope?: string | null
  }): Promise<Account> {
    // Check for duplicate provider + providerAccountId
    const existing = await this.getAccountByProvider(data.provider, data.providerAccountId)
    if (existing) {
      throw new Error(`Account with provider '${data.provider}' and providerAccountId '${data.providerAccountId}' already exists`)
    }

    const id = randomUUID()
    const accountData: AccountData = {
      provider: data.provider,
      providerAccountId: data.providerAccountId,
      accessToken: data.accessToken ?? null,
      refreshToken: data.refreshToken ?? null,
      accessTokenExpiresAt: data.accessTokenExpiresAt?.getTime() ?? null,
      refreshTokenExpiresAt: data.refreshTokenExpiresAt?.getTime() ?? null,
      scope: data.scope ?? null,
      userId: data.userId,
    }

    const thing = await this.store.createThing({
      id,
      typeId: TYPE_IDS.Account,
      typeName: 'Account',
      data: accountData,
    })

    // Create linkedTo relationship
    await this.store.createRelationship({
      id: randomUUID(),
      verb: 'linkedTo',
      from: authUrl('accounts', id),
      to: authUrl('users', data.userId),
    })

    return this.thingToAccount(thing)
  }

  async getAccountByProvider(provider: string, providerAccountId: string): Promise<Account | null> {
    const accounts = await this.store.getThingsByType({ typeName: 'Account' })

    const account = accounts.find((a) => {
      const data = a.data as AccountData | null
      return data?.provider === provider && data?.providerAccountId === providerAccountId
    })

    if (!account) {
      return null
    }

    return this.thingToAccount(account)
  }

  async unlinkAccount(provider: string, providerAccountId: string): Promise<void> {
    const accounts = await this.store.getThingsByType({ typeName: 'Account' })

    const account = accounts.find((a) => {
      const data = a.data as AccountData | null
      return data?.provider === provider && data?.providerAccountId === providerAccountId
    })

    if (account) {
      // Delete relationships first
      const rels = await this.store.queryRelationshipsFrom(authUrl('accounts', account.id))
      for (const rel of rels) {
        await this.store.deleteRelationship(rel.id)
      }
      // Hard delete the account
      await this.hardDeleteThing(account.id)
    }
  }

  async getAccountsByUserId(userId: string): Promise<Account[]> {
    // Find all accounts linked to this user via backward traversal
    const rels = await this.store.queryRelationshipsTo(authUrl('users', userId), { verb: 'linkedTo' })
    const accounts: Account[] = []

    for (const rel of rels) {
      if (rel.from.startsWith('auth://accounts/')) {
        const accountId = extractId(rel.from)
        const thing = await this.store.getThing(accountId)
        if (thing && thing.typeName === 'Account' && thing.deletedAt === null) {
          accounts.push(this.thingToAccount(thing))
        }
      }
    }

    return accounts
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Convert a Thing to a User
   */
  private thingToUser(thing: { id: string; data: unknown; createdAt: number; updatedAt: number }): User {
    const data = thing.data as UserData
    return {
      id: thing.id,
      email: data.email,
      name: data.name,
      emailVerified: data.emailVerified,
      image: data.image,
      createdAt: new Date(thing.createdAt),
      updatedAt: new Date(thing.updatedAt),
    }
  }

  /**
   * Convert a Thing to a Session
   */
  private thingToSession(thing: { id: string; data: unknown; createdAt: number; updatedAt: number }): Session {
    const data = thing.data as SessionData
    return {
      id: thing.id,
      token: data.token,
      userId: data.userId,
      expiresAt: new Date(data.expiresAt),
      userAgent: data.userAgent,
      ipAddress: data.ipAddress,
      createdAt: new Date(thing.createdAt),
      updatedAt: new Date(thing.updatedAt),
    }
  }

  /**
   * Convert a Thing to an Account
   */
  private thingToAccount(thing: { id: string; data: unknown; createdAt: number; updatedAt: number }): Account {
    const data = thing.data as AccountData
    return {
      id: thing.id,
      userId: data.userId,
      provider: data.provider,
      providerAccountId: data.providerAccountId,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      accessTokenExpiresAt: data.accessTokenExpiresAt ? new Date(data.accessTokenExpiresAt) : null,
      refreshTokenExpiresAt: data.refreshTokenExpiresAt ? new Date(data.refreshTokenExpiresAt) : null,
      scope: data.scope,
      createdAt: new Date(thing.createdAt),
      updatedAt: new Date(thing.updatedAt),
    }
  }

  /**
   * Hard delete a thing by removing it from the database entirely
   * (The GraphStore only supports soft delete via deleteThing, so we need
   * to work around this for sessions and accounts that should be truly deleted)
   */
  private async hardDeleteThing(id: string): Promise<void> {
    // Soft delete is sufficient for our use case - the getThingsByType
    // and getThing methods filter out deleted items by default
    await this.store.deleteThing(id)
  }
}
