import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { eq, and, like } from 'drizzle-orm'

// ============================================================================
// INTEGRATIONS - Provider Registry for integrations.do
// ============================================================================
//
// This module implements the integrations.do Provider Registry which provides:
// 1. Provider registry (github, slack, salesforce, etc.)
// 2. Dynamic account types (not hardcoded)
// 3. OAuth configurations per provider
// 4. Scopes and actions per provider
// 5. Webhook signature verification config
// 6. Rate limiting configuration
//
// Key Insight: Account types come FROM integrations.do, not hardcoded.
// This allows adding new providers without code changes.
// ============================================================================

// ============================================================================
// PROVIDERS - Integration Provider Registry
// ============================================================================

/**
 * OAuth configuration stored in JSON format.
 */
export interface OAuthConfig {
  /** Authorization endpoint URL */
  authUrl: string
  /** Token exchange endpoint URL */
  tokenUrl: string
  /** Default scopes requested during OAuth flow */
  scopes: string[]
  /** User info endpoint URL (optional) */
  userInfoUrl?: string
  /** Token revocation endpoint URL (optional) */
  revokeUrl?: string
  /** Whether this provider supports PKCE */
  pkceSupported?: boolean
  /** Response type for OAuth flow */
  responseType?: 'code' | 'token'
}

/**
 * Webhook configuration for validating incoming webhooks.
 */
export interface WebhookConfig {
  /** HTTP header containing the signature */
  signatureHeader: string
  /** Algorithm used for signature verification */
  algorithm: 'sha256' | 'sha1' | 'hmac-sha256' | 'hmac-sha1'
  /** Prefix for the signature value (e.g., 'sha256=') */
  signaturePrefix?: string
  /** Timestamp header for replay protection */
  timestampHeader?: string
  /** Max age in seconds for timestamp validation */
  timestampMaxAge?: number
}

/**
 * Provider action definition for available API operations.
 */
export interface ProviderAction {
  /** Action name (e.g., 'create_issue', 'send_message') */
  name: string
  /** Human-readable description */
  description?: string
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Endpoint path (can contain {placeholders}) */
  endpoint: string
  /** Required OAuth scopes for this action */
  scopes: string[]
}

/**
 * Rate limiting configuration for API calls.
 */
export interface RateLimitConfig {
  /** Maximum requests allowed */
  max: number
  /** Time window in seconds */
  window: number
  /** Rate limit type */
  type?: 'sliding' | 'fixed'
}

/**
 * Provider type classification.
 */
export type ProviderType = 'oauth2' | 'api_key' | 'webhook' | 'oauth1'

/**
 * Providers table - Central registry of integration providers.
 *
 * This table stores the configuration for all available integrations.
 * Each provider defines how to authenticate, what actions are available,
 * and how to verify webhooks.
 *
 * @example
 * ```ts
 * // GitHub provider
 * {
 *   id: 'github',
 *   slug: 'github',
 *   name: 'GitHub',
 *   type: 'oauth2',
 *   category: 'vcs',
 *   oauthConfig: {
 *     authUrl: 'https://github.com/login/oauth/authorize',
 *     tokenUrl: 'https://github.com/login/oauth/access_token',
 *     scopes: ['repo', 'user:email']
 *   }
 * }
 * ```
 */
export const providers = sqliteTable(
  'providers',
  {
    /** Primary key - unique identifier (e.g., 'github', 'slack-oauth') */
    id: text('id').primaryKey(),

    /** URL-safe slug for the provider */
    slug: text('slug').notNull().unique(),

    /** Human-readable display name */
    name: text('name').notNull(),

    /** Provider type: oauth2, api_key, webhook, oauth1 */
    type: text('type').notNull().$type<ProviderType>(),

    /** Category for grouping (e.g., 'vcs', 'chat', 'crm', 'analytics') */
    category: text('category'),

    /** Icon URL or icon identifier */
    icon: text('icon'),

    /** Short description of the provider */
    description: text('description'),

    /** Base URL for API calls */
    baseUrl: text('base_url'),

    /** API version identifier */
    apiVersion: text('api_version'),

    /** OAuth configuration (JSON) */
    oauthConfig: text('oauth_config', { mode: 'json' }).$type<OAuthConfig>(),

    /** Webhook configuration for signature verification (JSON) */
    webhookConfig: text('webhook_config', { mode: 'json' }).$type<WebhookConfig>(),

    /** Available actions/operations (JSON array) */
    actions: text('actions', { mode: 'json' }).$type<ProviderAction[]>(),

    /** Rate limiting configuration (JSON) */
    rateLimit: text('rate_limit', { mode: 'json' }).$type<RateLimitConfig>(),

    /** Documentation URL */
    docsUrl: text('docs_url'),

    /** Whether this provider is enabled/active */
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),

    /** Whether this is an official/verified provider */
    official: integer('official', { mode: 'boolean' }).default(false),

    /** Additional metadata (JSON) */
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),

    /** Timestamp when provider was created */
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),

    /** Timestamp when provider was last updated */
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    /** Index for slug lookups */
    uniqueIndex('providers_slug_idx').on(table.slug),
    /** Index for filtering by type */
    index('providers_type_idx').on(table.type),
    /** Index for filtering by category */
    index('providers_category_idx').on(table.category),
    /** Index for filtering enabled providers */
    index('providers_enabled_idx').on(table.enabled),
  ],
)

/** TypeScript type for provider record */
export type Provider = typeof providers.$inferSelect

/** TypeScript type for inserting a new provider */
export type NewProvider = typeof providers.$inferInsert

// ============================================================================
// ACCOUNT TYPES - Dynamic Account Type Definitions
// ============================================================================

/**
 * Account Types table - Dynamic account type definitions from integrations.do.
 *
 * Account types define categories of linked accounts (e.g., 'vcs', 'chat', 'crm').
 * Each type maps to one or more providers, allowing new providers without code changes.
 *
 * Key Insight: This is what id.org.ai queries to get available account types.
 * Types are NOT hardcoded - they come from integrations.do.
 *
 * @example
 * ```ts
 * // VCS account type supporting multiple providers
 * {
 *   id: 'vcs',
 *   slug: 'vcs',
 *   name: 'Version Control',
 *   icon: 'git-branch',
 *   providers: ['github', 'gitlab', 'bitbucket']
 * }
 *
 * // Chat account type
 * {
 *   id: 'chat',
 *   slug: 'chat',
 *   name: 'Team Chat',
 *   icon: 'message-circle',
 *   providers: ['slack', 'discord', 'teams']
 * }
 * ```
 */
export const accountTypes = sqliteTable(
  'account_types',
  {
    /** Primary key - unique identifier (e.g., 'vcs', 'chat', 'crm') */
    id: text('id').primaryKey(),

    /** URL-safe slug for the account type */
    slug: text('slug').notNull().unique(),

    /** Human-readable display name */
    name: text('name').notNull(),

    /** Icon identifier or URL */
    icon: text('icon'),

    /** Description of this account type category */
    description: text('description'),

    /** Array of provider IDs that belong to this type (JSON) */
    providers: text('providers', { mode: 'json' }).notNull().$type<string[]>(),

    /** Whether this account type is enabled */
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),

    /** Display order for UI sorting */
    displayOrder: integer('display_order').default(0),

    /** Additional metadata (JSON) */
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),

    /** Timestamp when account type was created */
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),

    /** Timestamp when account type was last updated */
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    /** Unique index for slug lookups */
    uniqueIndex('account_types_slug_idx').on(table.slug),
    /** Index for filtering enabled types */
    index('account_types_enabled_idx').on(table.enabled),
    /** Index for ordering by display order */
    index('account_types_order_idx').on(table.displayOrder),
  ],
)

/** TypeScript type for account type record */
export type AccountType = typeof accountTypes.$inferSelect

/** TypeScript type for inserting a new account type */
export type NewAccountType = typeof accountTypes.$inferInsert

// ============================================================================
// DATABASE INTERFACE
// ============================================================================

/**
 * Database interface required for query helpers.
 */
export interface IntegrationsDb {
  select(): {
    from(table: typeof providers | typeof accountTypes): {
      where(condition: unknown): Promise<unknown[]>
    }
  }
  insert(table: typeof providers | typeof accountTypes): {
    values(values: unknown): {
      returning(): Promise<unknown[]>
    }
  }
  update(table: typeof providers | typeof accountTypes): {
    set(values: unknown): {
      where(condition: unknown): Promise<{ rowsAffected: number }>
    }
  }
}

// ============================================================================
// PROVIDER QUERY HELPERS
// ============================================================================

/**
 * Get a provider by ID.
 *
 * @param db - Drizzle database instance
 * @param id - The provider ID (e.g., 'github')
 * @returns The provider or undefined if not found
 */
export async function getProvider(
  db: IntegrationsDb,
  id: string
): Promise<Provider | undefined> {
  const results = await db
    .select()
    .from(providers)
    .where(eq(providers.id, id)) as Provider[]

  return results[0]
}

/**
 * Get a provider by slug.
 *
 * @param db - Drizzle database instance
 * @param slug - The provider slug
 * @returns The provider or undefined if not found
 */
export async function getProviderBySlug(
  db: IntegrationsDb,
  slug: string
): Promise<Provider | undefined> {
  const results = await db
    .select()
    .from(providers)
    .where(eq(providers.slug, slug)) as Provider[]

  return results[0]
}

/**
 * Get all enabled providers.
 *
 * @param db - Drizzle database instance
 * @returns Array of enabled providers
 */
export async function getEnabledProviders(
  db: IntegrationsDb
): Promise<Provider[]> {
  return db
    .select()
    .from(providers)
    .where(eq(providers.enabled, true)) as Promise<Provider[]>
}

/**
 * Get providers by category.
 *
 * @param db - Drizzle database instance
 * @param category - The category (e.g., 'vcs', 'chat')
 * @returns Array of providers in the category
 */
export async function getProvidersByCategory(
  db: IntegrationsDb,
  category: string
): Promise<Provider[]> {
  return db
    .select()
    .from(providers)
    .where(
      and(
        eq(providers.category, category),
        eq(providers.enabled, true)
      )
    ) as Promise<Provider[]>
}

/**
 * Get providers by type.
 *
 * @param db - Drizzle database instance
 * @param type - The provider type (oauth2, api_key, webhook, oauth1)
 * @returns Array of providers of the specified type
 */
export async function getProvidersByType(
  db: IntegrationsDb,
  type: ProviderType
): Promise<Provider[]> {
  return db
    .select()
    .from(providers)
    .where(
      and(
        eq(providers.type, type),
        eq(providers.enabled, true)
      )
    ) as Promise<Provider[]>
}

// ============================================================================
// ACCOUNT TYPE QUERY HELPERS
// ============================================================================

/**
 * Get an account type by ID.
 *
 * @param db - Drizzle database instance
 * @param id - The account type ID (e.g., 'vcs')
 * @returns The account type or undefined if not found
 */
export async function getAccountType(
  db: IntegrationsDb,
  id: string
): Promise<AccountType | undefined> {
  const results = await db
    .select()
    .from(accountTypes)
    .where(eq(accountTypes.id, id)) as AccountType[]

  return results[0]
}

/**
 * Get an account type by slug.
 *
 * @param db - Drizzle database instance
 * @param slug - The account type slug
 * @returns The account type or undefined if not found
 */
export async function getAccountTypeBySlug(
  db: IntegrationsDb,
  slug: string
): Promise<AccountType | undefined> {
  const results = await db
    .select()
    .from(accountTypes)
    .where(eq(accountTypes.slug, slug)) as AccountType[]

  return results[0]
}

/**
 * Get all enabled account types.
 *
 * @param db - Drizzle database instance
 * @returns Array of enabled account types
 */
export async function getEnabledAccountTypes(
  db: IntegrationsDb
): Promise<AccountType[]> {
  return db
    .select()
    .from(accountTypes)
    .where(eq(accountTypes.enabled, true)) as Promise<AccountType[]>
}

/**
 * Get all providers for an account type.
 *
 * @param db - Drizzle database instance
 * @param accountTypeId - The account type ID
 * @returns Array of providers for the account type
 */
export async function getProvidersForAccountType(
  db: IntegrationsDb,
  accountTypeId: string
): Promise<Provider[]> {
  const accountType = await getAccountType(db, accountTypeId)
  if (!accountType) {
    return []
  }

  const providerIds = accountType.providers
  const results: Provider[] = []

  for (const providerId of providerIds) {
    const provider = await getProvider(db, providerId)
    if (provider && provider.enabled) {
      results.push(provider)
    }
  }

  return results
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate OAuth configuration.
 *
 * @param config - OAuth configuration to validate
 * @returns True if valid, false otherwise
 */
export function isValidOAuthConfig(config: unknown): config is OAuthConfig {
  if (!config || typeof config !== 'object') return false
  const c = config as Record<string, unknown>
  return (
    typeof c.authUrl === 'string' &&
    typeof c.tokenUrl === 'string' &&
    Array.isArray(c.scopes) &&
    c.scopes.every((s: unknown) => typeof s === 'string')
  )
}

/**
 * Validate webhook configuration.
 *
 * @param config - Webhook configuration to validate
 * @returns True if valid, false otherwise
 */
export function isValidWebhookConfig(config: unknown): config is WebhookConfig {
  if (!config || typeof config !== 'object') return false
  const c = config as Record<string, unknown>
  return (
    typeof c.signatureHeader === 'string' &&
    ['sha256', 'sha1', 'hmac-sha256', 'hmac-sha1'].includes(c.algorithm as string)
  )
}

/**
 * Validate a provider action definition.
 *
 * @param action - Action to validate
 * @returns True if valid, false otherwise
 */
export function isValidProviderAction(action: unknown): action is ProviderAction {
  if (!action || typeof action !== 'object') return false
  const a = action as Record<string, unknown>
  return (
    typeof a.name === 'string' &&
    ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(a.method as string) &&
    typeof a.endpoint === 'string' &&
    Array.isArray(a.scopes) &&
    a.scopes.every((s: unknown) => typeof s === 'string')
  )
}

// ============================================================================
// WEBHOOK SIGNATURE VERIFICATION
// ============================================================================

/**
 * Verify a webhook signature using the provider's configuration.
 *
 * @param provider - The provider with webhook configuration
 * @param payload - The raw request body
 * @param signature - The signature from the request header
 * @param secret - The webhook secret
 * @returns True if signature is valid, false otherwise
 */
export async function verifyWebhookSignature(
  provider: Provider,
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const webhookConfig = provider.webhookConfig
  if (!webhookConfig) {
    throw new Error(`Provider ${provider.id} does not have webhook configuration`)
  }

  // Remove signature prefix if present
  let signatureValue = signature
  if (webhookConfig.signaturePrefix && signature.startsWith(webhookConfig.signaturePrefix)) {
    signatureValue = signature.slice(webhookConfig.signaturePrefix.length)
  }

  // Compute expected signature based on algorithm
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const payloadData = encoder.encode(payload)

  let algorithm: string
  switch (webhookConfig.algorithm) {
    case 'sha256':
    case 'hmac-sha256':
      algorithm = 'SHA-256'
      break
    case 'sha1':
    case 'hmac-sha1':
      algorithm = 'SHA-1'
      break
    default:
      throw new Error(`Unsupported algorithm: ${webhookConfig.algorithm}`)
  }

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign']
  )

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, payloadData)
  const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  // Timing-safe comparison
  return expectedSignature === signatureValue.toLowerCase()
}
