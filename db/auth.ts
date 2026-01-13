import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

// ============================================================================
// AUTH - better-auth Drizzle schema for SQLite
// ============================================================================
//
// Complete schema for better-auth with all enterprise plugins:
//   - Core: users, sessions, accounts, verifications
//   - Organization: organizations, members, invitations, teams
//   - Admin: role/ban fields on users, impersonation on sessions
//   - API Key: apiKeys for programmatic access
//   - SSO: ssoProviders for enterprise SAML/OIDC
//   - OAuth Provider: oauthClients, oauthTokens, oauthConsents
//   - Stripe: subscriptions for billing
//
// Generate/update with: npx @better-auth/cli generate
// ============================================================================

// ============================================================================
// CORE: USERS
// ============================================================================

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),

    // Admin plugin fields
    role: text('role').default('user'), // 'user', 'admin', 'owner'
    banned: integer('banned', { mode: 'boolean' }).default(false),
    banReason: text('ban_reason'),
    banExpires: integer('ban_expires', { mode: 'timestamp' }),

    // Stripe plugin field
    stripeCustomerId: text('stripe_customer_id'),

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [index('users_email_idx').on(table.email), index('users_stripe_customer_idx').on(table.stripeCustomerId)],
)

// ============================================================================
// CORE: SESSIONS
// ============================================================================

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),

    // Organization plugin fields
    activeOrganizationId: text('active_organization_id'),
    activeTeamId: text('active_team_id'),

    // Admin plugin field (impersonation)
    impersonatedBy: text('impersonated_by'),

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('sessions_user_idx').on(table.userId),
    index('sessions_token_idx').on(table.token),
    index('sessions_org_idx').on(table.activeOrganizationId),
  ],
)

// ============================================================================
// CORE: ACCOUNTS (OAuth/SSO provider links)
// ============================================================================

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(), // ID from the SSO provider
    providerId: text('provider_id').notNull(), // 'google', 'github', etc.
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
    scope: text('scope'),
    idToken: text('id_token'),
    /**
     * Hashed password for email/password authentication.
     *
     * @security NEVER store plaintext passwords in this field.
     * This field MUST contain a securely hashed password using bcrypt, argon2,
     * or another approved password hashing algorithm. The hashing is handled
     * by better-auth automatically.
     *
     * @example
     * ```ts
     * // WRONG - never do this
     * passwordHash: 'myplainpassword'
     *
     * // CORRECT - better-auth handles this automatically
     * // The value will be something like: '$2b$10$...'
     * ```
     */
    passwordHash: text('password_hash'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [index('accounts_user_idx').on(table.userId), index('accounts_provider_idx').on(table.providerId, table.accountId)],
)

// ============================================================================
// CORE: VERIFICATIONS (Email/password verification tokens)
// ============================================================================

export const verifications = sqliteTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(), // What's being verified (email, phone)
    value: text('value').notNull(), // The verification code/token
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)],
)

// ============================================================================
// ORGANIZATION: ORGANIZATIONS (Tenants)
// ============================================================================

export const organizations = sqliteTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    logo: text('logo'),
    metadata: text('metadata', { mode: 'json' }), // Custom org data

    // DO integration: maps to tenant DO
    tenantNs: text('tenant_ns'), // e.g., 'https://crm.headless.ly/acme'
    region: text('region'), // 'SFO', 'ORD', 'LHR'

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [index('organizations_slug_idx').on(table.slug), index('organizations_tenant_idx').on(table.tenantNs)],
)

// ============================================================================
// ORGANIZATION: MEMBERS (User <-> Org mapping)
// ============================================================================

export const members = sqliteTable(
  'members',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'), // 'owner', 'admin', 'member', or custom
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('members_user_idx').on(table.userId),
    index('members_org_idx').on(table.organizationId),
    uniqueIndex('members_user_org_idx').on(table.userId, table.organizationId),
  ],
)

// ============================================================================
// ORGANIZATION: INVITATIONS
// ============================================================================

export const invitations = sqliteTable(
  'invitations',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => users.id),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    status: text('status').notNull().default('pending'), // 'pending', 'accepted', 'rejected'
    teamId: text('team_id'), // Optional team assignment
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [index('invitations_email_idx').on(table.email), index('invitations_org_idx').on(table.organizationId)],
)

// ============================================================================
// ORGANIZATION: TEAMS (Sub-groups within orgs)
// ============================================================================

export const teams = sqliteTable(
  'teams',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [index('teams_org_idx').on(table.organizationId)],
)

export const teamMembers = sqliteTable(
  'team_members',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('team_members_team_idx').on(table.teamId),
    index('team_members_user_idx').on(table.userId),
    uniqueIndex('team_members_team_user_idx').on(table.teamId, table.userId),
  ],
)

// ============================================================================
// API KEY: API Keys for programmatic access
// ============================================================================

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    key: text('key').notNull(), // Hashed API key
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    prefix: text('prefix'), // Plaintext prefix for identification
    start: text('start'), // First N chars for UI display

    // Rate limiting
    rateLimitEnabled: integer('rate_limit_enabled', { mode: 'boolean' }),
    rateLimitTimeWindow: integer('rate_limit_time_window'),
    rateLimitMax: integer('rate_limit_max'),
    requestCount: integer('request_count').default(0),
    lastRequest: integer('last_request', { mode: 'timestamp' }),

    // Usage tracking & refill
    remaining: integer('remaining'),
    lastRefillAt: integer('last_refill_at', { mode: 'timestamp' }),
    refillInterval: integer('refill_interval'),
    refillAmount: integer('refill_amount'),

    // Lifecycle
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    enabled: integer('enabled', { mode: 'boolean' }).default(true),

    // Permissions & metadata
    permissions: text('permissions', { mode: 'json' }),
    metadata: text('metadata', { mode: 'json' }),

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [index('api_keys_user_idx').on(table.userId), index('api_keys_prefix_idx').on(table.prefix)],
)

// ============================================================================
// SSO: SSO Providers (Enterprise SAML/OIDC)
// ============================================================================

export const ssoProviders = sqliteTable(
  'sso_providers',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id').notNull().unique(), // Unique provider identifier
    issuer: text('issuer').notNull(), // OIDC/SAML issuer URL
    domain: text('domain').notNull(), // Associated email domain
    organizationId: text('organization_id').references(() => organizations.id),
    oidcConfig: text('oidc_config', { mode: 'json' }), // OIDC-specific configuration
    samlConfig: text('saml_config', { mode: 'json' }), // SAML-specific configuration
    mapping: text('mapping', { mode: 'json' }), // Attribute mapping
    domainVerified: integer('domain_verified', { mode: 'boolean' }).default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [index('sso_providers_domain_idx').on(table.domain), index('sso_providers_org_idx').on(table.organizationId)],
)

// ============================================================================
// OAUTH PROVIDER: OAuth Clients (when your app IS the OAuth provider)
// ============================================================================

export const oauthClients = sqliteTable(
  'oauth_clients',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull().unique(),
    clientSecret: text('client_secret'), // Hashed
    name: text('name'),
    uri: text('uri'),
    icon: text('icon'),
    redirectUris: text('redirect_uris', { mode: 'json' }),
    scopes: text('scopes', { mode: 'json' }),
    grantTypes: text('grant_types', { mode: 'json' }),
    responseTypes: text('response_types', { mode: 'json' }),
    tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
    type: text('type'), // 'web', 'native', 'user-agent-based'
    public: integer('public', { mode: 'boolean' }).default(false),
    disabled: integer('disabled', { mode: 'boolean' }).default(false),
    skipConsent: integer('skip_consent', { mode: 'boolean' }).default(false),
    userId: text('user_id').references(() => users.id),
    organizationId: text('organization_id').references(() => organizations.id),
    metadata: text('metadata', { mode: 'json' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [index('oauth_clients_client_id_idx').on(table.clientId), index('oauth_clients_user_idx').on(table.userId)],
)

// ============================================================================
// OAUTH PROVIDER: Access Tokens
// ============================================================================

export const oauthAccessTokens = sqliteTable(
  'oauth_access_tokens',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull(), // Hashed
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.id),
    userId: text('user_id').references(() => users.id),
    sessionId: text('session_id'),
    refreshId: text('refresh_id'),
    organizationId: text('organization_id'),
    scopes: text('scopes', { mode: 'json' }),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [index('oauth_access_tokens_client_idx').on(table.clientId), index('oauth_access_tokens_user_idx').on(table.userId)],
)

// ============================================================================
// OAUTH PROVIDER: Refresh Tokens
// ============================================================================

export const oauthRefreshTokens = sqliteTable(
  'oauth_refresh_tokens',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull(), // Hashed
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    sessionId: text('session_id'),
    organizationId: text('organization_id'),
    scopes: text('scopes', { mode: 'json' }),
    revoked: integer('revoked', { mode: 'timestamp' }),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [index('oauth_refresh_tokens_client_idx').on(table.clientId), index('oauth_refresh_tokens_user_idx').on(table.userId)],
)

// ============================================================================
// OAUTH PROVIDER: Consents
// ============================================================================

export const oauthConsents = sqliteTable(
  'oauth_consents',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.id),
    organizationId: text('organization_id'),
    scopes: text('scopes').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('oauth_consents_user_idx').on(table.userId),
    index('oauth_consents_client_idx').on(table.clientId),
    uniqueIndex('oauth_consents_user_client_idx').on(table.userId, table.clientId),
  ],
)

// ============================================================================
// OAUTH PROVIDER: Authorization Codes (short-lived)
// ============================================================================

export const oauthAuthorizationCodes = sqliteTable(
  'oauth_authorization_codes',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull().unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    redirectUri: text('redirect_uri').notNull(),
    scopes: text('scopes', { mode: 'json' }),
    codeChallenge: text('code_challenge'), // PKCE
    codeChallengeMethod: text('code_challenge_method'),
    state: text('state'),
    nonce: text('nonce'),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [index('oauth_auth_codes_client_idx').on(table.clientId), index('oauth_auth_codes_code_idx').on(table.code)],
)

// ============================================================================
// CUSTOM DOMAINS: Custom domain mapping for tenants
// ============================================================================

export const customDomains = sqliteTable(
  'custom_domains',
  {
    id: text('id').primaryKey(),
    domain: text('domain').notNull().unique(), // 'crm.acme.com'
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    tenantNs: text('tenant_ns').notNull(), // 'https://crm.headless.ly/acme'
    verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
    verificationToken: text('verification_token'), // DNS TXT record value
    verificationMethod: text('verification_method').default('dns_txt'), // 'dns_txt', 'http', 'cname'
    sslStatus: text('ssl_status').default('pending'), // 'pending', 'active', 'failed'
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    verifiedAt: integer('verified_at', { mode: 'timestamp' }),
  },
  (table) => [
    index('custom_domains_domain_idx').on(table.domain),
    index('custom_domains_org_idx').on(table.organizationId),
    index('custom_domains_tenant_idx').on(table.tenantNs),
  ],
)

// ============================================================================
// IDENTITIES: Multi-type identities extending better-auth users
// ============================================================================

/**
 * Valid identity types in the system.
 * - 'human': Primary user identity with profile info
 * - 'agent': AI assistants and bots owned by humans/services
 * - 'service': API integrations and webhooks
 */
export type IdentityType = 'human' | 'agent' | 'service'

/**
 * Valid identity status values.
 * - 'active': Identity can perform actions
 * - 'suspended': Temporarily disabled, cannot perform actions
 * - 'deleted': Soft-deleted, preserved for audit but inactive
 */
export type IdentityStatus = 'active' | 'suspended' | 'deleted'

/**
 * Identities table - extends better-auth users with multiple personas.
 *
 * Each identity links to a better-auth user but provides additional
 * type-specific fields for different identity types (human, agent, service).
 *
 * A single user can have multiple identities:
 * - One primary human identity
 * - Multiple agent identities they own
 * - Service identities for integrations
 *
 * @example
 * ```ts
 * // Human identity
 * { type: 'human', handle: 'alice', displayName: 'Alice Smith' }
 *
 * // Agent identity
 * { type: 'agent', handle: 'codebot', agentType: 'assistant', ownerId: 'id-alice' }
 *
 * // Service identity
 * { type: 'service', handle: 'github-webhook', serviceType: 'webhook' }
 * ```
 */
export const identities = sqliteTable(
  'identities',
  {
    /** Primary key - unique identifier for this identity */
    id: text('id').primaryKey(),

    /** Foreign key to better-auth users table - required for all identities */
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Type discriminator: 'human', 'agent', or 'service' */
    type: text('type').notNull().default('human').$type<IdentityType>(),

    /** Unique handle (e.g., @alice, @codebot) - stored without @ prefix */
    handle: text('handle').notNull().unique(),

    /** Display name shown in UI */
    displayName: text('display_name'),

    /** URL to avatar/profile image */
    avatarUrl: text('avatar_url'),

    /** Short biography or description */
    bio: text('bio'),

    /** Identity status: 'active', 'suspended', or 'deleted' */
    status: text('status').notNull().default('active').$type<IdentityStatus>(),

    // ---- Agent-specific fields ----

    /** Agent type classification: 'assistant', 'bot', 'tool', etc. */
    agentType: text('agent_type'),

    /** Owner identity ID (self-referencing) - required for agents */
    ownerId: text('owner_id'),

    /** JSON array of agent capabilities (e.g., ['code-review', 'testing']) */
    capabilities: text('capabilities', { mode: 'json' }).$type<string[]>(),

    /** AI model identifier (e.g., 'claude-opus-4-5-20251101') */
    modelId: text('model_id'),

    // ---- Service-specific fields ----

    /** Service type: 'api', 'webhook', 'integration' */
    serviceType: text('service_type'),

    /** Service endpoint URL */
    endpoint: text('endpoint'),

    // ---- Common fields ----

    /** Additional metadata stored as JSON */
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),

    /** Timestamp when identity was created */
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),

    /** Timestamp when identity was last updated */
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    /** Index for looking up identities by user */
    index('identities_user_idx').on(table.userId),
    /** Unique index ensuring handles are globally unique */
    uniqueIndex('identities_handle_idx').on(table.handle),
    /** Index for filtering by identity type */
    index('identities_type_idx').on(table.type),
    /** Index for finding agents by owner */
    index('identities_owner_idx').on(table.ownerId),
    /** Index for filtering by status */
    index('identities_status_idx').on(table.status),
    /** Composite index for efficient agent queries by type and owner */
    index('identities_type_owner_idx').on(table.type, table.ownerId),
  ],
)

/**
 * TypeScript type for an identity record inferred from the schema.
 * Use this type when working with identity data in application code.
 */
export type Identity = typeof identities.$inferSelect

/**
 * TypeScript type for inserting a new identity.
 * Use this type when creating new identity records.
 */
export type NewIdentity = typeof identities.$inferInsert

// ============================================================================
// LINKED ACCOUNTS: Third-party account connections
// ============================================================================

/**
 * Linked Accounts table - stores third-party account connections for identities.
 *
 * Key design decisions:
 * - The `type` field is a DYNAMIC STRING, not an enum
 * - Types come from integrations.do (e.g., 'github', 'slack', 'linear')
 * - This allows new integration types without schema changes
 * - Credentials are stored securely in WorkOS Vault, referenced by vaultRef
 *
 * @example
 * ```ts
 * // GitHub OAuth connection
 * {
 *   id: 'la-001',
 *   identityId: 'identity-alice',
 *   type: 'github',
 *   provider: 'github-oauth',
 *   providerAccountId: 'gh-12345',
 *   vaultRef: 'vault://workos/secrets/la-001',
 *   status: 'active',
 * }
 * ```
 */
export const linkedAccounts = sqliteTable(
  'linked_accounts',
  {
    /** Primary key - unique identifier for this linked account */
    id: text('id').primaryKey(),

    /** Foreign key to identities table - the identity this account belongs to */
    identityId: text('identity_id')
      .notNull()
      .references(() => identities.id, { onDelete: 'cascade' }),

    /** Dynamic type string - NOT an enum, types come from integrations.do */
    type: text('type').notNull(),

    /** OAuth provider or integration name (e.g., 'github-oauth', 'slack-api') */
    provider: text('provider').notNull(),

    /** Unique account identifier from the external provider */
    providerAccountId: text('provider_account_id').notNull(),

    /** WorkOS Vault reference for secure credential storage */
    vaultRef: text('vault_ref'),

    /** Account status: 'active', 'pending', 'expired', 'revoked' */
    status: text('status').notNull().default('active'),

    /** Token expiration timestamp */
    expiresAt: integer('expires_at', { mode: 'timestamp' }),

    /** Additional metadata stored as JSON */
    metadata: text('metadata', { mode: 'json' }),

    /** Timestamp when linked account was created */
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),

    /** Timestamp when linked account was last updated */
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    /** Index for looking up linked accounts by identity */
    index('linked_accounts_identity_idx').on(table.identityId),
    /** Index for filtering by integration type */
    index('linked_accounts_type_idx').on(table.type),
    /** Index for filtering by status */
    index('linked_accounts_status_idx').on(table.status),
    /** Composite index for efficient identity+provider lookups (common query pattern) */
    index('linked_accounts_identity_provider_idx').on(table.identityId, table.provider),
    /** Index for provider-based queries */
    index('linked_accounts_provider_idx').on(table.provider),
    /** Unique constraint: one linked account per identity+provider+providerAccountId */
    uniqueIndex('linked_accounts_unique_idx').on(table.identityId, table.provider, table.providerAccountId),
  ],
)

/**
 * TypeScript type for a linked account record inferred from the schema.
 */
export type LinkedAccount = typeof linkedAccounts.$inferSelect

/**
 * TypeScript type for inserting a new linked account.
 */
export type NewLinkedAccount = typeof linkedAccounts.$inferInsert

// ============================================================================
// STRIPE: Subscriptions
// ============================================================================

export const subscriptions = sqliteTable(
  'subscriptions',
  {
    id: text('id').primaryKey(),
    plan: text('plan').notNull(),
    referenceId: text('reference_id').notNull(), // User ID or Org ID
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    status: text('status').notNull().default('incomplete'),
    periodStart: integer('period_start', { mode: 'timestamp' }),
    periodEnd: integer('period_end', { mode: 'timestamp' }),
    cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' }).default(false),
    cancelAt: integer('cancel_at', { mode: 'timestamp' }),
    canceledAt: integer('canceled_at', { mode: 'timestamp' }),
    endedAt: integer('ended_at', { mode: 'timestamp' }),
    seats: integer('seats'),
    trialStart: integer('trial_start', { mode: 'timestamp' }),
    trialEnd: integer('trial_end', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('subscriptions_reference_idx').on(table.referenceId),
    index('subscriptions_stripe_customer_idx').on(table.stripeCustomerId),
    index('subscriptions_stripe_sub_idx').on(table.stripeSubscriptionId),
  ],
)
