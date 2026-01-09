import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

// ============================================================================
// VAULT - Secure credential storage
// ============================================================================
//
// WorkOS Vault-style credential storage for sensitive data like:
// - API keys
// - OAuth tokens
// - Secrets
// - Encrypted configuration
//
// Features:
// - User isolation (credentials scoped by userId)
// - TTL/expiration support
// - Encryption at rest (values are encrypted before storage)
// - Metadata support for additional context
//
// Usage:
//   const vault = createVaultContext().vault('user:123')
//   await vault.set('api-key', 'sk-secret-12345', { ttl: 3600 })
//   const credential = await vault.get('api-key')
// ============================================================================

/**
 * Vault credentials table - stores encrypted credentials per user.
 *
 * Key design decisions:
 * - `userId` + `key` form a unique constraint for credential lookup
 * - `value` is stored encrypted (encryption happens in the store layer)
 * - `expiresAt` enables TTL support for time-limited credentials
 * - `metadata` allows additional context (provider info, environment, etc.)
 *
 * @example
 * ```ts
 * // API key storage
 * {
 *   id: 'vault-001',
 *   userId: 'user:123',
 *   key: 'openai-api-key',
 *   value: 'encrypted:...', // Encrypted value
 *   metadata: { provider: 'openai', environment: 'production' },
 *   expiresAt: null, // No expiration
 * }
 *
 * // OAuth token with TTL
 * {
 *   id: 'vault-002',
 *   userId: 'user:123',
 *   key: 'github-access-token',
 *   value: 'encrypted:...',
 *   expiresAt: new Date('2026-01-10T12:00:00Z'),
 * }
 * ```
 */
export const vaultCredentials = sqliteTable(
  'vault_credentials',
  {
    /** Primary key - unique identifier for this credential */
    id: text('id').primaryKey(),

    /** User ID that owns this credential - enables user isolation */
    userId: text('user_id').notNull(),

    /** Credential key - unique within a user's vault */
    key: text('key').notNull(),

    /** Encrypted credential value */
    value: text('value').notNull(),

    /** Additional metadata stored as JSON */
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),

    /** Optional expiration timestamp for TTL support */
    expiresAt: integer('expires_at', { mode: 'timestamp' }),

    /** Timestamp when credential was created */
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),

    /** Timestamp when credential was last updated */
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    /** Index for looking up credentials by user */
    index('vault_credentials_user_idx').on(table.userId),
    /** Unique constraint: one credential per user+key combination */
    uniqueIndex('vault_credentials_user_key_idx').on(table.userId, table.key),
    /** Index for TTL cleanup queries */
    index('vault_credentials_expires_idx').on(table.expiresAt),
  ],
)

/**
 * TypeScript type for a vault credential record inferred from the schema.
 */
export type VaultCredential = typeof vaultCredentials.$inferSelect

/**
 * TypeScript type for inserting a new vault credential.
 */
export type NewVaultCredential = typeof vaultCredentials.$inferInsert

// ============================================================================
// OAUTH TOKENS - Stored OAuth tokens for providers
// ============================================================================

/**
 * OAuth tokens table - stores OAuth tokens for third-party providers.
 *
 * Separate from vault credentials to support OAuth-specific operations:
 * - Token refresh
 * - Provider-specific handling
 * - Scope tracking
 *
 * @example
 * ```ts
 * {
 *   id: 'oauth-001',
 *   userId: 'user:123',
 *   provider: 'google',
 *   accessToken: 'encrypted:...',
 *   refreshToken: 'encrypted:...',
 *   tokenType: 'Bearer',
 *   scope: 'openid email profile',
 *   expiresAt: new Date('2026-01-09T13:00:00Z'),
 * }
 * ```
 */
export const vaultOAuthTokens = sqliteTable(
  'vault_oauth_tokens',
  {
    /** Primary key - unique identifier for this token set */
    id: text('id').primaryKey(),

    /** User ID that owns these tokens */
    userId: text('user_id').notNull(),

    /** OAuth provider name (e.g., 'google', 'github') */
    provider: text('provider').notNull(),

    /** Encrypted access token */
    accessToken: text('access_token').notNull(),

    /** Encrypted refresh token (optional) */
    refreshToken: text('refresh_token'),

    /** Token type (e.g., 'Bearer') */
    tokenType: text('token_type').notNull().default('Bearer'),

    /** OAuth scopes granted */
    scope: text('scope'),

    /** Access token expiration timestamp */
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),

    /** Timestamp when tokens were created/stored */
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),

    /** Timestamp when tokens were last updated */
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    /** Index for looking up tokens by user */
    index('vault_oauth_tokens_user_idx').on(table.userId),
    /** Unique constraint: one token set per user+provider */
    uniqueIndex('vault_oauth_tokens_user_provider_idx').on(table.userId, table.provider),
    /** Index for token expiration queries */
    index('vault_oauth_tokens_expires_idx').on(table.expiresAt),
  ],
)

/**
 * TypeScript type for OAuth token record inferred from the schema.
 */
export type VaultOAuthToken = typeof vaultOAuthTokens.$inferSelect

/**
 * TypeScript type for inserting a new OAuth token.
 */
export type NewVaultOAuthToken = typeof vaultOAuthTokens.$inferInsert

// ============================================================================
// OAUTH STATES - Temporary state for OAuth flows
// ============================================================================

/**
 * OAuth states table - stores temporary state for OAuth authorization flows.
 *
 * States are one-time use and short-lived (typically 10 minutes).
 *
 * @example
 * ```ts
 * {
 *   state: 'abc123...',
 *   userId: 'user:123',
 *   provider: 'google',
 *   codeVerifier: 'xyz789...', // PKCE
 *   expiresAt: new Date('2026-01-09T12:10:00Z'),
 * }
 * ```
 */
export const vaultOAuthStates = sqliteTable(
  'vault_oauth_states',
  {
    /** State token - used as primary key */
    state: text('state').primaryKey(),

    /** User ID initiating the OAuth flow */
    userId: text('user_id').notNull(),

    /** OAuth provider name */
    provider: text('provider').notNull(),

    /** PKCE code verifier (for S256 challenge method) */
    codeVerifier: text('code_verifier'),

    /** OAuth config stored as JSON */
    config: text('config', { mode: 'json' }).$type<{
      clientId: string
      clientSecret: string
      scopes: string[]
      redirectUri: string
    }>(),

    /** State expiration timestamp (short-lived) */
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),

    /** Timestamp when state was created */
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    /** Index for state expiration cleanup */
    index('vault_oauth_states_expires_idx').on(table.expiresAt),
  ],
)

/**
 * TypeScript type for OAuth state record inferred from the schema.
 */
export type VaultOAuthState = typeof vaultOAuthStates.$inferSelect

/**
 * TypeScript type for inserting a new OAuth state.
 */
export type NewVaultOAuthState = typeof vaultOAuthStates.$inferInsert
