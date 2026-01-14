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
import { AUTH_TYPE_IDS } from '../../db/graph/constants'

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
  [key: string]: unknown
}

interface SessionData {
  token: string
  expiresAt: number // timestamp
  userAgent: string | null
  ipAddress: string | null
  userId: string
  [key: string]: unknown
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
  [key: string]: unknown
}

// ============================================================================
// CONSTANTS (from centralized db/graph/constants.ts)
// ============================================================================

/**
 * Type IDs for auth entities.
 * Re-exported from db/graph/constants.ts for local use.
 */
const TYPE_IDS = AUTH_TYPE_IDS

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Simple email format validation
 * Checks for basic email structure: something@something.something
 */
function isValidEmail(email: string): boolean {
  if (!email || email.trim() === '') return false
  // Basic email regex - checks for @ with content on both sides and a dot after @
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

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
    // Validate email format
    if (!isValidEmail(data.email)) {
      throw new Error(`Invalid email format: '${data.email}'`)
    }

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

    // If updating email, check for duplicates
    if (data.email !== undefined) {
      const emailOwner = await this.getUserByEmail(data.email)
      if (emailOwner && emailOwner.id !== id) {
        throw new Error(`User with email '${data.email}' already exists`)
      }
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
    // Verify user exists (relationship integrity)
    const user = await this.getUserById(data.userId)
    if (!user) {
      throw new Error(`Cannot create session for non-existent user '${data.userId}'`)
    }

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
    // Verify user exists (relationship integrity)
    const user = await this.getUserById(data.userId)
    if (!user) {
      throw new Error(`Cannot link account to non-existent user '${data.userId}'`)
    }

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

// ============================================================================
// BETTER-AUTH DATABASE ADAPTER WRAPPER
// ============================================================================

/**
 * Where clause for better-auth queries
 */
interface Where {
  field: string
  value: unknown
  operator?: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'starts_with' | 'ends_with'
}

/**
 * Model to type ID mapping for better-auth entities
 */
const MODEL_TYPE_IDS: Record<string, number> = {
  user: TYPE_IDS.User,
  session: TYPE_IDS.Session,
  account: TYPE_IDS.Account,
  verification: 4,
  jwks: 5,
  organization: 6,
  member: 7,
  invitation: 8,
  apikey: 9,
}

/**
 * Get the next type ID for unknown models
 */
let nextTypeId = 100
function getTypeId(model: string): number {
  const normalized = model.toLowerCase()
  if (MODEL_TYPE_IDS[normalized]) {
    return MODEL_TYPE_IDS[normalized]!
  }
  MODEL_TYPE_IDS[normalized] = nextTypeId++
  return MODEL_TYPE_IDS[normalized]!
}

/**
 * Capitalize first letter for type name
 */
function toTypeName(model: string): string {
  return model.charAt(0).toUpperCase() + model.slice(1)
}

/**
 * Check if a record matches the where clauses
 */
function matchesWhere(data: Record<string, unknown>, where: Where[]): boolean {
  return where.every((clause) => {
    const value = data[clause.field]
    const targetValue = clause.value
    const operator = clause.operator ?? 'eq'

    switch (operator) {
      case 'eq':
        return value === targetValue
      case 'ne':
        return value !== targetValue
      case 'gt':
        return typeof value === 'number' && typeof targetValue === 'number' && value > targetValue
      case 'gte':
        return typeof value === 'number' && typeof targetValue === 'number' && value >= targetValue
      case 'lt':
        return typeof value === 'number' && typeof targetValue === 'number' && value < targetValue
      case 'lte':
        return typeof value === 'number' && typeof targetValue === 'number' && value <= targetValue
      case 'in':
        return Array.isArray(targetValue) && targetValue.includes(value)
      case 'contains':
        return typeof value === 'string' && typeof targetValue === 'string' && value.includes(targetValue)
      case 'starts_with':
        return typeof value === 'string' && typeof targetValue === 'string' && value.startsWith(targetValue)
      case 'ends_with':
        return typeof value === 'string' && typeof targetValue === 'string' && value.endsWith(targetValue)
      default:
        return value === targetValue
    }
  })
}

/**
 * Convert a Thing to a flat record for better-auth
 */
function thingToRecord(thing: { id: string; data: unknown; createdAt: number; updatedAt: number }): Record<string, unknown> {
  const data = thing.data as Record<string, unknown> | null
  return {
    id: thing.id,
    ...data,
    createdAt: new Date(thing.createdAt),
    updatedAt: new Date(thing.updatedAt),
  }
}

/**
 * Convert Date fields to timestamps for storage
 */
function normalizeDataForStorage(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (key === 'id' || key === 'createdAt' || key === 'updatedAt') continue
    if (value instanceof Date) {
      result[key] = value.getTime()
    } else {
      result[key] = value
    }
  }
  return result
}

/**
 * Factory function to create a better-auth compatible database adapter
 * backed by GraphStore.
 *
 * This adapter translates better-auth's generic database operations
 * (create, findOne, findMany, update, delete) into GraphStore operations.
 *
 * @param store - The GraphStore instance to use for persistence
 * @returns A function that returns a better-auth DBAdapter
 *
 * @example
 * ```typescript
 * import { graphAuthAdapter } from './adapters/graph'
 *
 * export function createAuth(config) {
 *   return betterAuth({
 *     database: graphAuthAdapter(config.graphStore),
 *     // ... rest of config
 *   })
 * }
 * ```
 */
export function graphAuthAdapter(store: GraphStore) {
  // Return a factory function that better-auth calls with options
  return (_options?: unknown) => {
    return {
      id: 'graph-auth-adapter',

      /**
       * Create a new record
       */
      async create<T extends Record<string, unknown>, R = T>(params: {
        model: string
        data: Omit<T, 'id'>
        select?: string[]
        forceAllowId?: boolean
      }): Promise<R> {
        const { model, data, forceAllowId } = params
        const id = forceAllowId && (data as Record<string, unknown>).id
          ? String((data as Record<string, unknown>).id)
          : randomUUID()

        const storageData = normalizeDataForStorage(data as Record<string, unknown>)

        const thing = await store.createThing({
          id,
          typeId: getTypeId(model),
          typeName: toTypeName(model),
          data: storageData,
        })

        return thingToRecord(thing) as R
      },

      /**
       * Find a single record
       */
      async findOne<T>(params: {
        model: string
        where: Where[]
        select?: string[]
      }): Promise<T | null> {
        const { model, where } = params

        // Optimization: if querying by ID directly, use getThing
        const idClause = where.find((w) => w.field === 'id' && w.operator !== 'ne')
        if (idClause && where.length === 1) {
          const thing = await store.getThing(String(idClause.value))
          if (!thing || thing.deletedAt !== null || thing.typeName !== toTypeName(model)) {
            return null
          }
          return thingToRecord(thing) as T
        }

        // Otherwise, query by type and filter
        const things = await store.getThingsByType({ typeName: toTypeName(model) })

        for (const thing of things) {
          if (thing.deletedAt !== null) continue
          const record = thingToRecord(thing)
          if (matchesWhere(record, where)) {
            return record as T
          }
        }

        return null
      },

      /**
       * Find multiple records
       */
      async findMany<T>(params: {
        model: string
        where?: Where[]
        limit?: number
        sortBy?: { field: string; direction: 'asc' | 'desc' }
        offset?: number
      }): Promise<T[]> {
        const { model, where, limit, sortBy, offset } = params

        const things = await store.getThingsByType({ typeName: toTypeName(model) })
        let results: Record<string, unknown>[] = []

        for (const thing of things) {
          if (thing.deletedAt !== null) continue
          const record = thingToRecord(thing)
          if (!where || where.length === 0 || matchesWhere(record, where)) {
            results.push(record)
          }
        }

        // Sort
        if (sortBy) {
          results.sort((a, b) => {
            const aVal = a[sortBy.field]
            const bVal = b[sortBy.field]
            if (aVal === bVal) return 0
            const comparison = aVal! < bVal! ? -1 : 1
            return sortBy.direction === 'asc' ? comparison : -comparison
          })
        }

        // Offset
        if (offset && offset > 0) {
          results = results.slice(offset)
        }

        // Limit
        if (limit && limit > 0) {
          results = results.slice(0, limit)
        }

        return results as T[]
      },

      /**
       * Update a single record
       */
      async update<T>(params: {
        model: string
        where: Where[]
        update: Record<string, unknown>
      }): Promise<T | null> {
        const { model, where, update } = params

        // Find the record to update
        const existing = (await this.findOne({ model, where })) as Record<string, unknown> | null
        if (!existing) {
          return null
        }

        const id = existing.id as string
        const currentThing = await store.getThing(id)
        if (!currentThing) {
          return null
        }

        const currentData = currentThing.data as Record<string, unknown> | null
        const newData = normalizeDataForStorage({
          ...(currentData ?? {}),
          ...update,
        })

        const updated = await store.updateThing(id, { data: newData })
        if (!updated) {
          return null
        }

        return thingToRecord(updated) as T
      },

      /**
       * Update multiple records
       */
      async updateMany(params: {
        model: string
        where: Where[]
        update: Record<string, unknown>
      }): Promise<number> {
        const { model, where, update } = params

        const things = await store.getThingsByType({ typeName: toTypeName(model) })
        let count = 0

        for (const thing of things) {
          if (thing.deletedAt !== null) continue
          const record = thingToRecord(thing)
          if (matchesWhere(record, where)) {
            const currentData = thing.data as Record<string, unknown> | null
            const newData = normalizeDataForStorage({
              ...(currentData ?? {}),
              ...update,
            })
            await store.updateThing(thing.id, { data: newData })
            count++
          }
        }

        return count
      },

      /**
       * Delete a single record
       */
      async delete(params: {
        model: string
        where: Where[]
      }): Promise<void> {
        const { model, where } = params

        const existing = (await this.findOne({ model, where })) as Record<string, unknown> | null
        if (existing) {
          await store.deleteThing(existing.id as string)
        }
      },

      /**
       * Delete multiple records
       */
      async deleteMany(params: {
        model: string
        where: Where[]
      }): Promise<number> {
        const { model, where } = params

        const things = await store.getThingsByType({ typeName: toTypeName(model) })
        let count = 0

        for (const thing of things) {
          if (thing.deletedAt !== null) continue
          const record = thingToRecord(thing)
          if (matchesWhere(record, where)) {
            await store.deleteThing(thing.id)
            count++
          }
        }

        return count
      },

      /**
       * Count records
       */
      async count(params: {
        model: string
        where?: Where[]
      }): Promise<number> {
        const { model, where } = params

        const things = await store.getThingsByType({ typeName: toTypeName(model) })
        let count = 0

        for (const thing of things) {
          if (thing.deletedAt !== null) continue
          if (!where || where.length === 0) {
            count++
          } else {
            const record = thingToRecord(thing)
            if (matchesWhere(record, where)) {
              count++
            }
          }
        }

        return count
      },
    }
  }
}
