import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import type { SQLiteSelect } from 'drizzle-orm/sqlite-core'
import { linkedAccounts, type LinkedAccount, type NewLinkedAccount } from './auth'

// ============================================================================
// LINKED ACCOUNTS - Query helpers and type validation
// ============================================================================
//
// This module provides:
// 1. Zod schemas for runtime validation of metadata and provider data
// 2. Query helper functions for common operations
// 3. Type-safe builders for linked account queries
//
// Usage:
//   import { getLinkedAccount, LinkedAccountMetadataSchema } from './linked-accounts'
//
//   // Query helper
//   const account = await getLinkedAccount(db, userId, 'github')
//
//   // Validate metadata
//   const result = LinkedAccountMetadataSchema.safeParse(metadata)
// ============================================================================

// ============================================================================
// ZOD SCHEMAS FOR VALIDATION
// ============================================================================

/**
 * Valid linked account status values
 */
export const LinkedAccountStatusSchema = z.enum(['active', 'pending', 'expired', 'revoked'])
export type LinkedAccountStatus = z.infer<typeof LinkedAccountStatusSchema>

/**
 * Base metadata schema - common fields across all provider types.
 * This is intentionally flexible to support various integration types.
 */
export const LinkedAccountMetadataBaseSchema = z.object({
  /** OAuth scopes granted to this connection */
  scopes: z.array(z.string()).optional(),

  /** Type of token (bearer, api_key, etc.) */
  tokenType: z.string().optional(),

  /** When the integration was first installed/connected */
  installedAt: z.string().datetime().optional(),

  /** Webhook ID if applicable */
  webhookId: z.string().optional(),

  /** Display name from the provider */
  displayName: z.string().optional(),

  /** Email from the provider */
  email: z.string().email().optional(),

  /** Avatar URL from the provider */
  avatarUrl: z.string().url().optional(),

  /** Profile URL on the provider platform */
  profileUrl: z.string().url().optional(),
})

/**
 * GitHub-specific metadata schema
 */
export const GitHubMetadataSchema = LinkedAccountMetadataBaseSchema.extend({
  /** GitHub username */
  login: z.string().optional(),

  /** GitHub user ID */
  githubId: z.number().optional(),

  /** List of organizations the user belongs to */
  organizations: z.array(z.string()).optional(),

  /** GitHub App installation ID (for GitHub Apps) */
  installationId: z.number().optional(),
})

/**
 * Slack-specific metadata schema
 */
export const SlackMetadataSchema = LinkedAccountMetadataBaseSchema.extend({
  /** Slack workspace ID */
  teamId: z.string().optional(),

  /** Slack workspace name */
  teamName: z.string().optional(),

  /** Slack user ID */
  slackUserId: z.string().optional(),

  /** Bot user ID (for bot tokens) */
  botUserId: z.string().optional(),

  /** Incoming webhook URL */
  incomingWebhookUrl: z.string().url().optional(),
})

/**
 * Generic metadata schema - allows additional properties beyond base fields.
 * Use this when you don't know the specific provider type.
 */
export const LinkedAccountMetadataSchema = LinkedAccountMetadataBaseSchema.passthrough()
export type LinkedAccountMetadata = z.infer<typeof LinkedAccountMetadataSchema>

/**
 * Provider-specific metadata schemas map
 */
export const ProviderMetadataSchemas = {
  github: GitHubMetadataSchema,
  slack: SlackMetadataSchema,
  // Add more provider-specific schemas as needed
} as const

/**
 * Get the appropriate metadata schema for a provider type
 */
export function getMetadataSchemaForProvider(provider: string): z.ZodType<LinkedAccountMetadata> {
  const providerKey = provider.toLowerCase().replace(/-oauth|-api|-app$/, '')
  if (providerKey in ProviderMetadataSchemas) {
    return ProviderMetadataSchemas[providerKey as keyof typeof ProviderMetadataSchemas]
  }
  return LinkedAccountMetadataSchema
}

/**
 * Schema for creating a new linked account (input validation)
 */
export const NewLinkedAccountSchema = z.object({
  id: z.string().min(1),
  identityId: z.string().min(1),
  type: z.string().min(1),
  provider: z.string().min(1),
  providerAccountId: z.string().min(1),
  vaultRef: z.string().optional().nullable(),
  status: LinkedAccountStatusSchema.default('active'),
  expiresAt: z.date().optional().nullable(),
  metadata: LinkedAccountMetadataSchema.optional().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate metadata for a linked account.
 * Returns the validated metadata or throws a ZodError.
 *
 * @param metadata - The metadata object to validate
 * @param provider - Optional provider name for provider-specific validation
 * @returns Validated metadata object
 */
export function validateMetadata(
  metadata: unknown,
  provider?: string
): LinkedAccountMetadata {
  const schema = provider ? getMetadataSchemaForProvider(provider) : LinkedAccountMetadataSchema
  return schema.parse(metadata)
}

/**
 * Safely validate metadata without throwing.
 *
 * @param metadata - The metadata object to validate
 * @param provider - Optional provider name for provider-specific validation
 * @returns Zod safe parse result
 */
export function safeValidateMetadata(
  metadata: unknown,
  provider?: string
): z.ZodSafeParseResult<LinkedAccountMetadata> {
  const schema = provider ? getMetadataSchemaForProvider(provider) : LinkedAccountMetadataSchema
  return schema.safeParse(metadata)
}

/**
 * Validate a new linked account object.
 *
 * @param account - The account object to validate
 * @returns Validated account object
 */
export function validateNewLinkedAccount(account: unknown): z.infer<typeof NewLinkedAccountSchema> {
  return NewLinkedAccountSchema.parse(account)
}

// ============================================================================
// QUERY HELPER TYPES
// ============================================================================

/**
 * Database interface required for query helpers.
 * This allows the helpers to work with any Drizzle database instance.
 */
export interface LinkedAccountsDb {
  select(): {
    from(table: typeof linkedAccounts): {
      where(condition: ReturnType<typeof eq> | ReturnType<typeof and>): Promise<LinkedAccount[]>
    }
  }
  insert(table: typeof linkedAccounts): {
    values(values: NewLinkedAccount): {
      returning(): Promise<LinkedAccount[]>
    }
  }
  update(table: typeof linkedAccounts): {
    set(values: Partial<LinkedAccount>): {
      where(condition: ReturnType<typeof eq> | ReturnType<typeof and>): Promise<{ rowsAffected: number }>
    }
  }
  delete(table: typeof linkedAccounts): {
    where(condition: ReturnType<typeof eq> | ReturnType<typeof and>): Promise<{ rowsAffected: number }>
  }
}

// ============================================================================
// QUERY HELPERS
// ============================================================================

/**
 * Get a single linked account by identity ID and provider.
 * Uses the composite index on (identityId, provider) for efficient lookup.
 *
 * @param db - Drizzle database instance
 * @param identityId - The identity ID to look up
 * @param provider - The provider name (e.g., 'github', 'slack')
 * @returns The linked account or undefined if not found
 *
 * @example
 * ```ts
 * const githubAccount = await getLinkedAccount(db, 'identity-123', 'github')
 * if (githubAccount) {
 *   console.log(`Connected as ${githubAccount.providerAccountId}`)
 * }
 * ```
 */
export async function getLinkedAccount(
  db: LinkedAccountsDb,
  identityId: string,
  provider: string
): Promise<LinkedAccount | undefined> {
  const results = await db
    .select()
    .from(linkedAccounts)
    .where(
      and(
        eq(linkedAccounts.identityId, identityId),
        eq(linkedAccounts.provider, provider)
      )
    )

  return results[0]
}

/**
 * Get all linked accounts for an identity.
 * Uses the identity index for efficient lookup.
 *
 * @param db - Drizzle database instance
 * @param identityId - The identity ID to look up
 * @returns Array of linked accounts for the identity
 *
 * @example
 * ```ts
 * const accounts = await getLinkedAccountsByIdentity(db, 'identity-123')
 * console.log(`User has ${accounts.length} connected accounts`)
 * ```
 */
export async function getLinkedAccountsByIdentity(
  db: LinkedAccountsDb,
  identityId: string
): Promise<LinkedAccount[]> {
  return db
    .select()
    .from(linkedAccounts)
    .where(eq(linkedAccounts.identityId, identityId))
}

/**
 * Alias for getLinkedAccountsByIdentity for backward compatibility.
 * @deprecated Use getLinkedAccountsByIdentity instead
 */
export const getLinkedAccountsByUser = getLinkedAccountsByIdentity

/**
 * Get all linked accounts for a specific provider.
 * Uses the provider index for efficient lookup.
 *
 * @param db - Drizzle database instance
 * @param provider - The provider name (e.g., 'github', 'slack')
 * @returns Array of linked accounts for the provider
 *
 * @example
 * ```ts
 * const githubAccounts = await getLinkedAccountsByProvider(db, 'github')
 * console.log(`${githubAccounts.length} users have connected GitHub`)
 * ```
 */
export async function getLinkedAccountsByProvider(
  db: LinkedAccountsDb,
  provider: string
): Promise<LinkedAccount[]> {
  return db
    .select()
    .from(linkedAccounts)
    .where(eq(linkedAccounts.provider, provider))
}

/**
 * Get all linked accounts by integration type.
 * Uses the type index for efficient lookup.
 *
 * @param db - Drizzle database instance
 * @param type - The integration type (e.g., 'github', 'slack', 'vcs:github')
 * @returns Array of linked accounts for the type
 *
 * @example
 * ```ts
 * const vcsAccounts = await getLinkedAccountsByType(db, 'vcs:github')
 * ```
 */
export async function getLinkedAccountsByType(
  db: LinkedAccountsDb,
  type: string
): Promise<LinkedAccount[]> {
  return db
    .select()
    .from(linkedAccounts)
    .where(eq(linkedAccounts.type, type))
}

/**
 * Get all active linked accounts for an identity.
 * Filters by status = 'active'.
 *
 * @param db - Drizzle database instance
 * @param identityId - The identity ID to look up
 * @returns Array of active linked accounts
 *
 * @example
 * ```ts
 * const activeAccounts = await getActiveLinkedAccounts(db, 'identity-123')
 * ```
 */
export async function getActiveLinkedAccounts(
  db: LinkedAccountsDb,
  identityId: string
): Promise<LinkedAccount[]> {
  return db
    .select()
    .from(linkedAccounts)
    .where(
      and(
        eq(linkedAccounts.identityId, identityId),
        eq(linkedAccounts.status, 'active')
      )
    )
}

/**
 * Check if an identity has a specific provider connected.
 *
 * @param db - Drizzle database instance
 * @param identityId - The identity ID to check
 * @param provider - The provider to check for
 * @returns Boolean indicating if the provider is connected
 *
 * @example
 * ```ts
 * const hasGithub = await hasLinkedProvider(db, 'identity-123', 'github')
 * if (!hasGithub) {
 *   // Prompt user to connect GitHub
 * }
 * ```
 */
export async function hasLinkedProvider(
  db: LinkedAccountsDb,
  identityId: string,
  provider: string
): Promise<boolean> {
  const account = await getLinkedAccount(db, identityId, provider)
  return account !== undefined
}

// ============================================================================
// EXPORT THE SCHEMA TABLE FOR CONVENIENCE
// ============================================================================

export { linkedAccounts, type LinkedAccount, type NewLinkedAccount }
