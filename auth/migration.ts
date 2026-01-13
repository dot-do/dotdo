/**
 * Auth Migration - Drizzle to Graph Migration Utilities
 *
 * This module provides utilities to migrate auth data from Drizzle/D1 tables
 * to the Graph model (Things and Relationships).
 *
 * ## Migration Flow
 *
 * 1. Read existing data from Drizzle tables (users, sessions, accounts, organizations, members)
 * 2. Create corresponding Things in the Graph store
 * 3. Create Relationships (belongsTo, linkedTo, memberOf)
 * 4. Verify migration integrity
 * 5. Switch to createAuthWithGraph()
 *
 * ## Usage
 *
 * ```typescript
 * import { migrateAuthToGraph, verifyMigration } from './auth/migration'
 *
 * // Migrate data
 * const result = await migrateAuthToGraph({ db, graphStore })
 *
 * // Verify migration
 * const verification = await verifyMigration({ db, graphStore })
 * if (verification.success) {
 *   console.log('Migration complete, switch to createAuthWithGraph()')
 * }
 * ```
 *
 * @see auth/config.ts - createAuthWithGraph()
 * @see auth/adapters/graph.ts - GraphAuthAdapter
 */

import { randomUUID } from 'crypto'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type * as schema from '../db'
import type { GraphStore } from '../db/graph/types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for migration
 */
export interface MigrationConfig {
  /**
   * Drizzle database instance with auth tables
   */
  db: DrizzleD1Database<typeof schema>

  /**
   * Target GraphStore for migrated data
   */
  graphStore: GraphStore

  /**
   * Batch size for migration operations
   * @default 100
   */
  batchSize?: number

  /**
   * Callback for progress updates
   */
  onProgress?: (progress: MigrationProgress) => void

  /**
   * Whether to skip existing entities (if already migrated)
   * @default true
   */
  skipExisting?: boolean
}

/**
 * Migration progress information
 */
export interface MigrationProgress {
  phase: 'users' | 'sessions' | 'accounts' | 'organizations' | 'members' | 'complete'
  total: number
  migrated: number
  skipped: number
  errors: number
}

/**
 * Migration result
 */
export interface MigrationResult {
  success: boolean
  users: { total: number; migrated: number; skipped: number; errors: number }
  sessions: { total: number; migrated: number; skipped: number; errors: number }
  accounts: { total: number; migrated: number; skipped: number; errors: number }
  organizations: { total: number; migrated: number; skipped: number; errors: number }
  members: { total: number; migrated: number; skipped: number; errors: number }
  errors: Array<{ entity: string; id: string; error: string }>
  durationMs: number
}

/**
 * Verification result
 */
export interface VerificationResult {
  success: boolean
  users: { drizzle: number; graph: number; match: boolean }
  sessions: { drizzle: number; graph: number; match: boolean }
  accounts: { drizzle: number; graph: number; match: boolean }
  organizations: { drizzle: number; graph: number; match: boolean }
  members: { drizzle: number; graph: number; match: boolean }
  mismatches: Array<{ entity: string; drizzleCount: number; graphCount: number }>
}

// ============================================================================
// CONSTANTS
// ============================================================================

const TYPE_IDS = {
  User: 1,
  Session: 2,
  Account: 3,
  Verification: 4,
  JWKS: 5,
  Organization: 6,
  Member: 7,
  Invitation: 8,
  ApiKey: 9,
} as const

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate auth URL for entity
 */
function authUrl(type: 'users' | 'sessions' | 'accounts' | 'organizations' | 'members', id: string): string {
  return `auth://${type}/${id}`
}

/**
 * Convert Date to timestamp (milliseconds)
 */
function toTimestamp(date: Date | null | undefined): number | null {
  return date ? date.getTime() : null
}

// ============================================================================
// MIGRATION FUNCTIONS
// ============================================================================

/**
 * Migrate all auth data from Drizzle to Graph.
 *
 * This function reads all auth entities from Drizzle tables and creates
 * corresponding Things and Relationships in the GraphStore.
 *
 * @example
 * ```typescript
 * const result = await migrateAuthToGraph({
 *   db: drizzleDb,
 *   graphStore: store,
 *   onProgress: (p) => console.log(`${p.phase}: ${p.migrated}/${p.total}`),
 * })
 *
 * if (result.success) {
 *   console.log(`Migrated ${result.users.migrated} users`)
 * }
 * ```
 */
export async function migrateAuthToGraph(config: MigrationConfig): Promise<MigrationResult> {
  const { db, graphStore, batchSize = 100, onProgress, skipExisting = true } = config
  const startTime = Date.now()

  const result: MigrationResult = {
    success: true,
    users: { total: 0, migrated: 0, skipped: 0, errors: 0 },
    sessions: { total: 0, migrated: 0, skipped: 0, errors: 0 },
    accounts: { total: 0, migrated: 0, skipped: 0, errors: 0 },
    organizations: { total: 0, migrated: 0, skipped: 0, errors: 0 },
    members: { total: 0, migrated: 0, skipped: 0, errors: 0 },
    errors: [],
    durationMs: 0,
  }

  try {
    // Phase 1: Migrate Users
    await migrateUsers(db, graphStore, result, { batchSize, skipExisting, onProgress })

    // Phase 2: Migrate Sessions (with belongsTo relationships)
    await migrateSessions(db, graphStore, result, { batchSize, skipExisting, onProgress })

    // Phase 3: Migrate Accounts (with linkedTo relationships)
    await migrateAccounts(db, graphStore, result, { batchSize, skipExisting, onProgress })

    // Phase 4: Migrate Organizations
    await migrateOrganizations(db, graphStore, result, { batchSize, skipExisting, onProgress })

    // Phase 5: Migrate Members (membership relationships)
    await migrateMembers(db, graphStore, result, { batchSize, skipExisting, onProgress })

    onProgress?.({
      phase: 'complete',
      total: 0,
      migrated: 0,
      skipped: 0,
      errors: result.errors.length,
    })
  } catch (error) {
    result.success = false
    result.errors.push({
      entity: 'migration',
      id: 'global',
      error: error instanceof Error ? error.message : String(error),
    })
  }

  result.durationMs = Date.now() - startTime
  return result
}

/**
 * Migrate users from Drizzle to Graph
 */
async function migrateUsers(
  db: DrizzleD1Database<typeof schema>,
  graphStore: GraphStore,
  result: MigrationResult,
  options: { batchSize: number; skipExisting: boolean; onProgress?: (p: MigrationProgress) => void }
): Promise<void> {
  const { batchSize, skipExisting, onProgress } = options

  // Get all users from Drizzle
  const users = await db.query.users.findMany()
  result.users.total = users.length

  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize)

    for (const user of batch) {
      try {
        // Check if already exists in Graph
        if (skipExisting) {
          const existing = await graphStore.getThing(user.id)
          if (existing && existing.typeName === 'User' && existing.deletedAt === null) {
            result.users.skipped++
            continue
          }
        }

        // Create User Thing
        await graphStore.createThing({
          id: user.id,
          typeId: TYPE_IDS.User,
          typeName: 'User',
          data: {
            email: user.email,
            name: user.name,
            emailVerified: user.emailVerified ?? false,
            image: user.image ?? null,
            role: user.role ?? 'user',
            banned: user.banned ?? false,
            banReason: user.banReason ?? null,
            banExpires: toTimestamp(user.banExpires),
            stripeCustomerId: user.stripeCustomerId ?? null,
          },
        })

        result.users.migrated++
      } catch (error) {
        result.users.errors++
        result.errors.push({
          entity: 'user',
          id: user.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    onProgress?.({
      phase: 'users',
      total: result.users.total,
      migrated: result.users.migrated,
      skipped: result.users.skipped,
      errors: result.users.errors,
    })
  }
}

/**
 * Migrate sessions from Drizzle to Graph
 */
async function migrateSessions(
  db: DrizzleD1Database<typeof schema>,
  graphStore: GraphStore,
  result: MigrationResult,
  options: { batchSize: number; skipExisting: boolean; onProgress?: (p: MigrationProgress) => void }
): Promise<void> {
  const { batchSize, skipExisting, onProgress } = options

  // Get all sessions from Drizzle
  const sessions = await db.query.sessions.findMany()
  result.sessions.total = sessions.length

  for (let i = 0; i < sessions.length; i += batchSize) {
    const batch = sessions.slice(i, i + batchSize)

    for (const session of batch) {
      try {
        // Check if already exists in Graph
        if (skipExisting) {
          const existing = await graphStore.getThing(session.id)
          if (existing && existing.typeName === 'Session' && existing.deletedAt === null) {
            result.sessions.skipped++
            continue
          }
        }

        // Create Session Thing
        await graphStore.createThing({
          id: session.id,
          typeId: TYPE_IDS.Session,
          typeName: 'Session',
          data: {
            token: session.token,
            expiresAt: toTimestamp(session.expiresAt),
            ipAddress: session.ipAddress ?? null,
            userAgent: session.userAgent ?? null,
            userId: session.userId,
            activeOrganizationId: session.activeOrganizationId ?? null,
            activeTeamId: session.activeTeamId ?? null,
            impersonatedBy: session.impersonatedBy ?? null,
          },
        })

        // Create belongsTo relationship
        await graphStore.createRelationship({
          id: randomUUID(),
          verb: 'belongsTo',
          from: authUrl('sessions', session.id),
          to: authUrl('users', session.userId),
        })

        result.sessions.migrated++
      } catch (error) {
        result.sessions.errors++
        result.errors.push({
          entity: 'session',
          id: session.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    onProgress?.({
      phase: 'sessions',
      total: result.sessions.total,
      migrated: result.sessions.migrated,
      skipped: result.sessions.skipped,
      errors: result.sessions.errors,
    })
  }
}

/**
 * Migrate accounts from Drizzle to Graph
 */
async function migrateAccounts(
  db: DrizzleD1Database<typeof schema>,
  graphStore: GraphStore,
  result: MigrationResult,
  options: { batchSize: number; skipExisting: boolean; onProgress?: (p: MigrationProgress) => void }
): Promise<void> {
  const { batchSize, skipExisting, onProgress } = options

  // Get all accounts from Drizzle
  const accounts = await db.query.accounts.findMany()
  result.accounts.total = accounts.length

  for (let i = 0; i < accounts.length; i += batchSize) {
    const batch = accounts.slice(i, i + batchSize)

    for (const account of batch) {
      try {
        // Check if already exists in Graph
        if (skipExisting) {
          const existing = await graphStore.getThing(account.id)
          if (existing && existing.typeName === 'Account' && existing.deletedAt === null) {
            result.accounts.skipped++
            continue
          }
        }

        // Create Account Thing
        await graphStore.createThing({
          id: account.id,
          typeId: TYPE_IDS.Account,
          typeName: 'Account',
          data: {
            provider: account.providerId,
            providerAccountId: account.accountId,
            accessToken: account.accessToken ?? null,
            refreshToken: account.refreshToken ?? null,
            accessTokenExpiresAt: toTimestamp(account.accessTokenExpiresAt),
            refreshTokenExpiresAt: toTimestamp(account.refreshTokenExpiresAt),
            scope: account.scope ?? null,
            idToken: account.idToken ?? null,
            userId: account.userId,
          },
        })

        // Create linkedTo relationship
        await graphStore.createRelationship({
          id: randomUUID(),
          verb: 'linkedTo',
          from: authUrl('accounts', account.id),
          to: authUrl('users', account.userId),
        })

        result.accounts.migrated++
      } catch (error) {
        result.accounts.errors++
        result.errors.push({
          entity: 'account',
          id: account.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    onProgress?.({
      phase: 'accounts',
      total: result.accounts.total,
      migrated: result.accounts.migrated,
      skipped: result.accounts.skipped,
      errors: result.accounts.errors,
    })
  }
}

/**
 * Migrate organizations from Drizzle to Graph
 */
async function migrateOrganizations(
  db: DrizzleD1Database<typeof schema>,
  graphStore: GraphStore,
  result: MigrationResult,
  options: { batchSize: number; skipExisting: boolean; onProgress?: (p: MigrationProgress) => void }
): Promise<void> {
  const { batchSize, skipExisting, onProgress } = options

  // Get all organizations from Drizzle
  const organizations = await db.query.organizations.findMany()
  result.organizations.total = organizations.length

  for (let i = 0; i < organizations.length; i += batchSize) {
    const batch = organizations.slice(i, i + batchSize)

    for (const org of batch) {
      try {
        // Check if already exists in Graph
        if (skipExisting) {
          const existing = await graphStore.getThing(org.id)
          if (existing && existing.typeName === 'Organization' && existing.deletedAt === null) {
            result.organizations.skipped++
            continue
          }
        }

        // Create Organization Thing
        await graphStore.createThing({
          id: org.id,
          typeId: TYPE_IDS.Organization,
          typeName: 'Organization',
          data: {
            name: org.name,
            slug: org.slug,
            logo: org.logo ?? null,
            metadata: org.metadata ?? null,
            tenantNs: org.tenantNs ?? org.slug,
            region: org.region ?? null,
          },
        })

        result.organizations.migrated++
      } catch (error) {
        result.organizations.errors++
        result.errors.push({
          entity: 'organization',
          id: org.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    onProgress?.({
      phase: 'organizations',
      total: result.organizations.total,
      migrated: result.organizations.migrated,
      skipped: result.organizations.skipped,
      errors: result.organizations.errors,
    })
  }
}

/**
 * Migrate members (organization memberships) from Drizzle to Graph
 */
async function migrateMembers(
  db: DrizzleD1Database<typeof schema>,
  graphStore: GraphStore,
  result: MigrationResult,
  options: { batchSize: number; skipExisting: boolean; onProgress?: (p: MigrationProgress) => void }
): Promise<void> {
  const { batchSize, skipExisting, onProgress } = options

  // Get all members from Drizzle
  const members = await db.query.members.findMany()
  result.members.total = members.length

  for (let i = 0; i < members.length; i += batchSize) {
    const batch = members.slice(i, i + batchSize)

    for (const member of batch) {
      try {
        // Check if memberOf relationship already exists
        if (skipExisting) {
          const existingRels = await graphStore.queryRelationshipsFrom(authUrl('users', member.userId), {
            verb: 'memberOf',
          })
          const existingMembership = existingRels.find((r) => r.to === authUrl('organizations', member.organizationId))
          if (existingMembership) {
            result.members.skipped++
            continue
          }
        }

        // Create memberOf relationship
        await graphStore.createRelationship({
          id: member.id,
          verb: 'memberOf',
          from: authUrl('users', member.userId),
          to: authUrl('organizations', member.organizationId),
          data: {
            role: member.role,
            joinedAt: toTimestamp(member.createdAt),
          },
        })

        result.members.migrated++
      } catch (error) {
        result.members.errors++
        result.errors.push({
          entity: 'member',
          id: member.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    onProgress?.({
      phase: 'members',
      total: result.members.total,
      migrated: result.members.migrated,
      skipped: result.members.skipped,
      errors: result.members.errors,
    })
  }
}

// ============================================================================
// VERIFICATION FUNCTIONS
// ============================================================================

/**
 * Verify migration integrity by comparing counts between Drizzle and Graph.
 *
 * @example
 * ```typescript
 * const verification = await verifyMigration({ db, graphStore })
 *
 * if (verification.success) {
 *   console.log('Migration verified successfully')
 * } else {
 *   console.log('Mismatches found:', verification.mismatches)
 * }
 * ```
 */
export async function verifyMigration(config: { db: DrizzleD1Database<typeof schema>; graphStore: GraphStore }): Promise<VerificationResult> {
  const { db, graphStore } = config

  const result: VerificationResult = {
    success: true,
    users: { drizzle: 0, graph: 0, match: false },
    sessions: { drizzle: 0, graph: 0, match: false },
    accounts: { drizzle: 0, graph: 0, match: false },
    organizations: { drizzle: 0, graph: 0, match: false },
    members: { drizzle: 0, graph: 0, match: false },
    mismatches: [],
  }

  // Count users
  const drizzleUsers = await db.query.users.findMany()
  const graphUsers = await graphStore.getThingsByType({ typeName: 'User' })
  result.users.drizzle = drizzleUsers.length
  result.users.graph = graphUsers.length
  result.users.match = result.users.drizzle === result.users.graph

  if (!result.users.match) {
    result.success = false
    result.mismatches.push({ entity: 'users', drizzleCount: result.users.drizzle, graphCount: result.users.graph })
  }

  // Count sessions
  const drizzleSessions = await db.query.sessions.findMany()
  const graphSessions = await graphStore.getThingsByType({ typeName: 'Session' })
  result.sessions.drizzle = drizzleSessions.length
  result.sessions.graph = graphSessions.length
  result.sessions.match = result.sessions.drizzle === result.sessions.graph

  if (!result.sessions.match) {
    result.success = false
    result.mismatches.push({ entity: 'sessions', drizzleCount: result.sessions.drizzle, graphCount: result.sessions.graph })
  }

  // Count accounts
  const drizzleAccounts = await db.query.accounts.findMany()
  const graphAccounts = await graphStore.getThingsByType({ typeName: 'Account' })
  result.accounts.drizzle = drizzleAccounts.length
  result.accounts.graph = graphAccounts.length
  result.accounts.match = result.accounts.drizzle === result.accounts.graph

  if (!result.accounts.match) {
    result.success = false
    result.mismatches.push({ entity: 'accounts', drizzleCount: result.accounts.drizzle, graphCount: result.accounts.graph })
  }

  // Count organizations
  const drizzleOrgs = await db.query.organizations.findMany()
  const graphOrgs = await graphStore.getThingsByType({ typeName: 'Organization' })
  result.organizations.drizzle = drizzleOrgs.length
  result.organizations.graph = graphOrgs.length
  result.organizations.match = result.organizations.drizzle === result.organizations.graph

  if (!result.organizations.match) {
    result.success = false
    result.mismatches.push({ entity: 'organizations', drizzleCount: result.organizations.drizzle, graphCount: result.organizations.graph })
  }

  // Count members (relationships)
  const drizzleMembers = await db.query.members.findMany()
  // For members, we need to count memberOf relationships
  // This is a bit tricky since we can't easily count all relationships by verb
  // For now, we'll iterate through organizations and count their members
  let graphMemberCount = 0
  for (const org of graphOrgs) {
    const rels = await graphStore.queryRelationshipsTo(authUrl('organizations', org.id), { verb: 'memberOf' })
    graphMemberCount += rels.length
  }
  result.members.drizzle = drizzleMembers.length
  result.members.graph = graphMemberCount
  result.members.match = result.members.drizzle === result.members.graph

  if (!result.members.match) {
    result.success = false
    result.mismatches.push({ entity: 'members', drizzleCount: result.members.drizzle, graphCount: result.members.graph })
  }

  return result
}

/**
 * Check if migration has been completed by verifying Graph has data.
 *
 * Returns true if GraphStore has auth data and Drizzle tables are empty
 * or have matching counts.
 */
export async function isMigrationComplete(config: { db: DrizzleD1Database<typeof schema>; graphStore: GraphStore }): Promise<boolean> {
  const verification = await verifyMigration(config)
  return verification.success
}

/**
 * Get migration status summary.
 */
export async function getMigrationStatus(config: { db: DrizzleD1Database<typeof schema>; graphStore: GraphStore }): Promise<{
  drizzleHasData: boolean
  graphHasData: boolean
  migrationNeeded: boolean
  migrationComplete: boolean
}> {
  const { db, graphStore } = config

  const drizzleUsers = await db.query.users.findMany({ limit: 1 })
  const graphUsers = await graphStore.getThingsByType({ typeName: 'User' })

  const drizzleHasData = drizzleUsers.length > 0
  const graphHasData = graphUsers.length > 0

  return {
    drizzleHasData,
    graphHasData,
    migrationNeeded: drizzleHasData && !graphHasData,
    migrationComplete: await isMigrationComplete(config),
  }
}
