/**
 * IntegrationsDO - Provider Registry Durable Object
 *
 * Manages integration providers (GitHub, Stripe, Google, etc.) with:
 * - OAuth configuration
 * - Webhook verification
 * - Rate limiting
 * - Action definitions
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface OAuthConfig {
  authUrl: string
  tokenUrl: string
  scopes: string[]
  clientIdEnvVar: string
  clientSecretEnvVar: string
}

export interface WebhookConfig {
  signatureHeader: string
  algorithm: 'sha256' | 'sha1'
  secretEnvVar: string
}

export interface RateLimitConfig {
  max: number
  windowMs: number
}

export interface ProviderAction {
  name: string
  description: string
  scopes: string[]
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
}

/**
 * JSON Schema type for input/output validation
 */
export interface JSONSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean'
  properties?: Record<string, JSONSchema>
  required?: string[]
  items?: JSONSchema
}

/**
 * Extended ProviderAction with input/output schemas and rate limits
 */
export interface ExtendedProviderAction {
  name: string
  description: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  endpoint: string
  scopes: string[]
  inputSchema?: JSONSchema
  outputSchema?: JSONSchema
  rateLimit?: RateLimitConfig
}

/**
 * Provider with extended actions
 */
export interface ProviderWithActions {
  slug: string
  name: string
  accountType: string
  icon: string
  oauthConfig: OAuthConfig
  webhookConfig?: WebhookConfig
  actions: ExtendedProviderAction[]
  rateLimit?: RateLimitConfig
}

/**
 * SDK configuration options
 */
export interface SDKOptions {
  maxRetries?: number
  retryDelayMs?: number
  timeout?: number
}

/**
 * SDK error with request ID and typed error codes
 */
export type SDKErrorCode = 'UNAUTHORIZED' | 'RATE_LIMITED' | 'SERVER_ERROR' | 'VALIDATION_ERROR' | 'NETWORK_ERROR'

export class SDKError extends Error {
  code: SDKErrorCode
  requestId: string
  statusCode?: number
  retryable: boolean

  constructor(message: string, code: SDKErrorCode, requestId: string, statusCode?: number, retryable = false) {
    super(message)
    this.name = 'SDKError'
    this.code = code
    this.requestId = requestId
    this.statusCode = statusCode
    this.retryable = retryable
  }
}

/**
 * Rate limit info returned in responses
 */
export interface RateLimitInfo {
  remaining: number
  limit: number
  resetAt: Date
}

/**
 * Rate limit state for tracking
 */
export interface RateLimitState {
  requestCount: number
  windowStart: number
}

/**
 * Token data from Vault
 */
interface TokenData {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

/**
 * SDK metadata
 */
interface SDKMetadata {
  provider: string
  linkedAccountId: string
  actions: string[]
  options: SDKOptions
}

/**
 * Validation result
 */
interface ValidationResult {
  valid: boolean
  errors: string[]
}

export interface Provider {
  id: string
  slug: string
  name: string
  accountType: string
  icon: string
  oauthConfig: OAuthConfig
  webhookConfig?: WebhookConfig
  actions: ProviderAction[]
  rateLimit?: RateLimitConfig
}

export interface AccountType {
  id: string
  slug: string // 'devtools'
  name: string // 'Developer Tools'
  icon: string // 'code'
  description: string
  providers: string[] // ['github', 'gitlab', 'bitbucket']
}

// ============================================================================
// BUILT-IN PROVIDERS
// ============================================================================

const BUILT_IN_PROVIDERS: Provider[] = [
  {
    id: 'github',
    slug: 'github',
    name: 'GitHub',
    accountType: 'devtools',
    icon: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
    oauthConfig: {
      authUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: ['repo', 'user', 'read:org'],
      clientIdEnvVar: 'GITHUB_CLIENT_ID',
      clientSecretEnvVar: 'GITHUB_CLIENT_SECRET',
    },
    webhookConfig: {
      signatureHeader: 'X-Hub-Signature-256',
      algorithm: 'sha256',
      secretEnvVar: 'GITHUB_WEBHOOK_SECRET',
    },
    actions: [
      {
        name: 'listRepos',
        description: 'List repositories for the authenticated user',
        scopes: ['repo'],
        method: 'GET',
        path: '/user/repos',
      },
      {
        name: 'createIssue',
        description: 'Create an issue in a repository',
        scopes: ['repo'],
        method: 'POST',
        path: '/repos/{owner}/{repo}/issues',
      },
    ],
    rateLimit: { max: 5000, windowMs: 3600000 },
  },
  {
    id: 'stripe',
    slug: 'stripe',
    name: 'Stripe',
    accountType: 'payments',
    icon: 'https://stripe.com/img/v3/home/social.png',
    oauthConfig: {
      authUrl: 'https://connect.stripe.com/oauth/authorize',
      tokenUrl: 'https://connect.stripe.com/oauth/token',
      scopes: ['read_write'],
      clientIdEnvVar: 'STRIPE_CLIENT_ID',
      clientSecretEnvVar: 'STRIPE_CLIENT_SECRET',
    },
    webhookConfig: {
      signatureHeader: 'Stripe-Signature',
      algorithm: 'sha256',
      secretEnvVar: 'STRIPE_WEBHOOK_SECRET',
    },
    actions: [
      {
        name: 'createPaymentIntent',
        description: 'Create a payment intent',
        scopes: ['read_write'],
        method: 'POST',
        path: '/v1/payment_intents',
      },
      {
        name: 'listCustomers',
        description: 'List all customers',
        scopes: ['read_write'],
        method: 'GET',
        path: '/v1/customers',
      },
    ],
    rateLimit: { max: 100, windowMs: 1000 },
  },
  {
    id: 'google',
    slug: 'google',
    name: 'Google',
    accountType: 'productivity',
    icon: 'https://www.google.com/favicon.ico',
    oauthConfig: {
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: ['openid', 'email', 'profile'],
      clientIdEnvVar: 'GOOGLE_CLIENT_ID',
      clientSecretEnvVar: 'GOOGLE_CLIENT_SECRET',
    },
    actions: [
      {
        name: 'getUserInfo',
        description: 'Get authenticated user info',
        scopes: ['openid', 'email', 'profile'],
        method: 'GET',
        path: '/oauth2/v2/userinfo',
      },
    ],
  },
]

const BUILT_IN_SLUGS = new Set(BUILT_IN_PROVIDERS.map((p) => p.slug))

// ============================================================================
// BUILT-IN ACCOUNT TYPES
// ============================================================================

const BUILT_IN_ACCOUNT_TYPES: AccountType[] = [
  {
    id: 'devtools',
    slug: 'devtools',
    name: 'Developer Tools',
    icon: 'code',
    description: 'Tools for software development, version control, and CI/CD',
    providers: [],
  },
  {
    id: 'crm',
    slug: 'crm',
    name: 'Customer Relationship Management',
    icon: 'users',
    description: 'Customer relationship and sales management tools',
    providers: [],
  },
  {
    id: 'payments',
    slug: 'payments',
    name: 'Payments',
    icon: 'credit-card',
    description: 'Payment processing and financial services',
    providers: [],
  },
  {
    id: 'communication',
    slug: 'communication',
    name: 'Communication',
    icon: 'message-circle',
    description: 'Messaging, email, and communication platforms',
    providers: [],
  },
  {
    id: 'productivity',
    slug: 'productivity',
    name: 'Productivity',
    icon: 'briefcase',
    description: 'Productivity and collaboration tools',
    providers: [],
  },
  {
    id: 'storage',
    slug: 'storage',
    name: 'Storage',
    icon: 'hard-drive',
    description: 'Cloud storage and file management services',
    providers: [],
  },
]

const BUILT_IN_ACCOUNT_TYPE_SLUGS = new Set(BUILT_IN_ACCOUNT_TYPES.map((t) => t.slug))

// ============================================================================
// INTEGRATIONS DO
// ============================================================================

/**
 * IntegrationsDO - standalone implementation for provider registry
 *
 * This class doesn't extend DO directly to allow for testing in node environment.
 * It uses the same patterns and will be compatible with Cloudflare Workers runtime.
 */
export class IntegrationsDO {
  readonly ns = 'https://integrations.do'

  protected ctx: DurableObjectState
  protected env: Record<string, unknown>

  // Registered providers (custom providers + re-registered built-ins)
  private registeredProviders: Map<string, Provider> = new Map()
  // Track deleted slugs (so we don't fall back to built-ins for deleted providers)
  private deletedSlugs: Set<string> = new Set()
  // Registered account types (custom account types + re-registered built-ins)
  private registeredAccountTypes: Map<string, AccountType> = new Map()
  // Track deleted account type slugs (so we don't fall back to built-ins for deleted types)
  private deletedAccountTypeSlugs: Set<string> = new Set()
  private initialized = false

  // Providers with extended actions (SDK support)
  private providersWithActions: Map<string, ProviderWithActions> = new Map()

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    this.ctx = ctx
    this.env = env
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return

    // Load custom providers from storage (not built-ins)
    const storedProviders = await this.ctx.storage.list<Provider>({ prefix: 'provider:' })
    for (const [, provider] of storedProviders) {
      this.registeredProviders.set(provider.slug, provider)
    }

    // Load custom account types from storage (not built-ins)
    const storedAccountTypes = await this.ctx.storage.list<AccountType>({ prefix: 'accountType:' })
    for (const [, accountType] of storedAccountTypes) {
      this.registeredAccountTypes.set(accountType.slug, accountType)
    }

    this.initialized = true
  }

  /**
   * Get a built-in provider by slug (returns a copy)
   */
  private getBuiltInProvider(slug: string): Provider | undefined {
    const builtIn = BUILT_IN_PROVIDERS.find((p) => p.slug === slug)
    if (builtIn) {
      return { ...builtIn, actions: [...builtIn.actions] }
    }
    return undefined
  }

  /**
   * Get a built-in account type by slug (returns a copy with dynamic providers list)
   */
  private getBuiltInAccountType(slug: string): AccountType | undefined {
    const builtIn = BUILT_IN_ACCOUNT_TYPES.find((t) => t.slug === slug)
    if (builtIn) {
      // Dynamically populate providers list from registered providers
      const providers = this.getProvidersForAccountType(slug)
      return { ...builtIn, providers }
    }
    return undefined
  }

  /**
   * Get provider slugs for a given account type
   */
  private getProvidersForAccountType(accountTypeSlug: string): string[] {
    const providers: string[] = []
    for (const provider of this.registeredProviders.values()) {
      if (provider.accountType === accountTypeSlug) {
        providers.push(provider.slug)
      }
    }
    return providers
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  private validateProvider(provider: Partial<Provider>): void {
    // Validate OAuth config
    if (!provider.oauthConfig) {
      throw new Error('Invalid provider: oauthConfig is required')
    }

    const { authUrl, tokenUrl, clientIdEnvVar, clientSecretEnvVar } = provider.oauthConfig

    if (!authUrl || authUrl.trim() === '') {
      throw new Error('Invalid provider: authUrl is required')
    }

    if (!tokenUrl || tokenUrl.trim() === '') {
      throw new Error('Invalid provider: tokenUrl is required')
    }

    if (!clientIdEnvVar || clientIdEnvVar.trim() === '') {
      throw new Error('Invalid provider: clientIdEnvVar is required')
    }

    if (!clientSecretEnvVar || clientSecretEnvVar.trim() === '') {
      throw new Error('Invalid provider: clientSecretEnvVar is required')
    }

    // Validate URLs
    try {
      new URL(authUrl)
    } catch {
      throw new Error('Invalid provider: authUrl is not a valid URL')
    }

    try {
      new URL(tokenUrl)
    } catch {
      throw new Error('Invalid provider: tokenUrl is not a valid URL')
    }

    // Validate rate limit if present
    if (provider.rateLimit) {
      if (provider.rateLimit.max <= 0) {
        throw new Error('Invalid provider: rateLimit.max must be positive')
      }
      if (provider.rateLimit.windowMs <= 0) {
        throw new Error('Invalid provider: rateLimit.windowMs must be positive')
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROVIDER CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  async registerProvider(provider: Omit<Provider, 'id'> | Provider): Promise<Provider> {
    await this.ensureInitialized()

    const slug = provider.slug
    const id = (provider as Provider).id || slug

    // Check for duplicates in registered providers
    if (this.registeredProviders.has(slug)) {
      throw new Error(`Provider with slug '${slug}' already exists`)
    }

    // Validate
    this.validateProvider(provider as Provider)

    const newProvider: Provider = {
      ...provider,
      id,
      actions: provider.actions ? [...provider.actions] : [],
    }

    // Store in registered providers
    this.registeredProviders.set(slug, newProvider)

    // Remove from deleted set (in case it was previously deleted)
    this.deletedSlugs.delete(slug)

    // Persist to storage
    await this.ctx.storage.put(`provider:${slug}`, newProvider)

    return newProvider
  }

  async getProvider(slug: string): Promise<Provider | null> {
    await this.ensureInitialized()

    // If this slug was explicitly deleted, return null
    if (this.deletedSlugs.has(slug)) {
      return null
    }

    // First check registered providers
    const registered = this.registeredProviders.get(slug)
    if (registered) {
      return registered
    }

    // Fall back to built-in providers
    return this.getBuiltInProvider(slug) || null
  }

  async getProviderById(id: string): Promise<Provider | null> {
    await this.ensureInitialized()

    // Check registered providers first
    for (const provider of this.registeredProviders.values()) {
      if (provider.id === id) {
        return provider
      }
    }

    // Check built-in providers
    const builtIn = BUILT_IN_PROVIDERS.find((p) => p.id === id)
    if (builtIn) {
      return { ...builtIn, actions: [...builtIn.actions] }
    }

    return null
  }

  async updateProvider(slug: string, updates: Partial<Provider>): Promise<Provider | null> {
    await this.ensureInitialized()

    // Get existing provider (from registered or built-in)
    const existing = this.registeredProviders.get(slug) || this.getBuiltInProvider(slug)
    if (!existing) {
      return null
    }

    // Cannot update slug
    if (updates.slug && updates.slug !== slug) {
      throw new Error('Cannot update slug: slug is immutable')
    }

    // Merge updates
    const updated: Provider = {
      ...existing,
      ...updates,
      id: existing.id, // Preserve id
      slug: existing.slug, // Preserve slug
    }

    // Validate the updated provider
    this.validateProvider(updated)

    // Store as registered (even for built-ins that get updated)
    this.registeredProviders.set(slug, updated)
    await this.ctx.storage.put(`provider:${slug}`, updated)

    return updated
  }

  async deleteProvider(slug: string, options?: { force?: boolean }): Promise<boolean> {
    await this.ensureInitialized()

    const isRegistered = this.registeredProviders.has(slug)
    const isBuiltIn = BUILT_IN_SLUGS.has(slug)
    const wasDeleted = this.deletedSlugs.has(slug)

    // If not registered, not built-in, and not previously deleted, nothing to delete
    if (!isRegistered && !isBuiltIn) {
      return false
    }

    // If already deleted, return false
    if (wasDeleted && !isRegistered) {
      return false
    }

    // Protect built-in providers that haven't been re-registered
    if (isBuiltIn && !isRegistered && !options?.force) {
      throw new Error(`Cannot delete built-in provider '${slug}' without force flag`)
    }

    // Remove from registered providers
    this.registeredProviders.delete(slug)
    await this.ctx.storage.delete(`provider:${slug}`)

    // Mark as deleted so getProvider won't return built-in
    this.deletedSlugs.add(slug)

    return true
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCOUNT TYPE CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  async registerAccountType(type: Omit<AccountType, 'id'> | AccountType): Promise<AccountType> {
    await this.ensureInitialized()

    const slug = type.slug
    const id = (type as AccountType).id || slug

    // Check if slug already exists in registered account types (not built-ins)
    // This allows registering custom types that override built-ins
    if (this.registeredAccountTypes.has(slug)) {
      throw new Error(`Account type with slug '${slug}' already exists`)
    }

    const newType: AccountType = {
      ...type,
      id,
      providers: type.providers ? [...type.providers] : [],
    }

    // Store in registered account types
    this.registeredAccountTypes.set(slug, newType)

    // Remove from deleted set (in case it was previously deleted)
    this.deletedAccountTypeSlugs.delete(slug)

    // Persist to storage
    await this.ctx.storage.put(`accountType:${slug}`, newType)

    return newType
  }

  async getAccountType(slug: string): Promise<AccountType | null> {
    await this.ensureInitialized()

    // If this slug was explicitly deleted, return null
    if (this.deletedAccountTypeSlugs.has(slug)) {
      return null
    }

    // First check registered account types
    const registered = this.registeredAccountTypes.get(slug)
    if (registered) {
      // Merge explicitly registered providers with dynamically discovered ones
      const dynamicProviders = this.getProvidersForAccountType(slug)
      const explicitProviders = registered.providers || []
      const allProviders = new Set([...explicitProviders, ...dynamicProviders])
      return { ...registered, providers: Array.from(allProviders) }
    }

    // Fall back to built-in account types
    return this.getBuiltInAccountType(slug) || null
  }

  async updateAccountType(slug: string, updates: Partial<AccountType>): Promise<AccountType | null> {
    await this.ensureInitialized()

    // Cannot update slug
    if (updates.slug && updates.slug !== slug) {
      throw new Error('Cannot update slug: slug is immutable')
    }

    // Get existing account type (from registered or built-in)
    const existing = this.registeredAccountTypes.get(slug) || this.getBuiltInAccountType(slug)
    if (!existing) {
      return null
    }

    // Merge updates (but don't allow slug or id to change)
    const { slug: _slug, id: _id, ...safeUpdates } = updates
    const updated: AccountType = {
      ...existing,
      ...safeUpdates,
      id: existing.id,
      slug: existing.slug,
    }

    // Store as registered (even for built-ins that get updated)
    this.registeredAccountTypes.set(slug, updated)
    await this.ctx.storage.put(`accountType:${slug}`, updated)

    // Dynamically populate providers list
    const providers = this.getProvidersForAccountType(slug)
    return { ...updated, providers }
  }

  async deleteAccountType(slug: string, options?: { force?: boolean }): Promise<boolean> {
    await this.ensureInitialized()

    const isRegistered = this.registeredAccountTypes.has(slug)
    const isBuiltIn = BUILT_IN_ACCOUNT_TYPE_SLUGS.has(slug)
    const wasDeleted = this.deletedAccountTypeSlugs.has(slug)

    // If not registered, not built-in, and not previously deleted, nothing to delete
    if (!isRegistered && !isBuiltIn) {
      return false
    }

    // If already deleted, return false
    if (wasDeleted && !isRegistered) {
      return false
    }

    // Protect built-in account types that haven't been re-registered
    if (isBuiltIn && !isRegistered && !options?.force) {
      throw new Error(`Cannot delete built-in account type '${slug}' without force flag`)
    }

    // Remove from registered account types
    this.registeredAccountTypes.delete(slug)
    await this.ctx.storage.delete(`accountType:${slug}`)

    // Mark as deleted so getAccountType won't return built-in
    this.deletedAccountTypeSlugs.add(slug)

    return true
  }

  async listAccountTypes(): Promise<AccountType[]> {
    await this.ensureInitialized()

    const typesMap = new Map<string, AccountType>()

    // Add built-in account types that haven't been deleted
    for (const builtIn of BUILT_IN_ACCOUNT_TYPES) {
      if (!this.deletedAccountTypeSlugs.has(builtIn.slug)) {
        const providers = this.getProvidersForAccountType(builtIn.slug)
        typesMap.set(builtIn.slug, { ...builtIn, providers })
      }
    }

    // Add/override with registered account types
    for (const [slug, type] of this.registeredAccountTypes) {
      const providers = this.getProvidersForAccountType(slug)
      typesMap.set(slug, { ...type, providers })
    }

    return Array.from(typesMap.values())
  }

  async listBuiltInAccountTypes(): Promise<AccountType[]> {
    await this.ensureInitialized()

    // Return copies of built-in account types with dynamic providers
    return BUILT_IN_ACCOUNT_TYPES.map((t) => {
      const providers = this.getProvidersForAccountType(t.slug)
      return { ...t, providers }
    })
  }

  async isBuiltInAccountType(slug: string): Promise<boolean> {
    return BUILT_IN_ACCOUNT_TYPE_SLUGS.has(slug)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LISTING
  // ═══════════════════════════════════════════════════════════════════════════

  async listProviders(options?: { limit?: number; offset?: number }): Promise<Provider[]> {
    await this.ensureInitialized()

    // Only return registered providers (not built-ins unless they were registered)
    const all = Array.from(this.registeredProviders.values())
    const limit = options?.limit ?? all.length
    const offset = options?.offset ?? 0

    return all.slice(offset, offset + limit)
  }

  async listProvidersByAccountType(accountType: string): Promise<Provider[]> {
    await this.ensureInitialized()

    // Search in registered providers only
    return Array.from(this.registeredProviders.values()).filter((p) => p.accountType === accountType)
  }

  async searchProviders(query: string): Promise<Provider[]> {
    await this.ensureInitialized()

    const lowerQuery = query.toLowerCase()
    // Search in registered providers only
    return Array.from(this.registeredProviders.values()).filter(
      (p) => p.name.toLowerCase().includes(lowerQuery) || p.slug.toLowerCase().includes(lowerQuery),
    )
  }

  async getAccountTypes(): Promise<string[]> {
    await this.ensureInitialized()

    const types = new Set<string>()
    // Get types from registered providers only
    for (const provider of this.registeredProviders.values()) {
      types.add(provider.accountType)
    }
    return Array.from(types)
  }

  async listBuiltInProviders(): Promise<Provider[]> {
    // Return copies of built-in providers
    return BUILT_IN_PROVIDERS.map((p) => ({ ...p, actions: [...p.actions] }))
  }

  async isBuiltIn(slug: string): Promise<boolean> {
    return BUILT_IN_SLUGS.has(slug)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  async getActionsByScope(slug: string, scope: string): Promise<ProviderAction[]> {
    await this.ensureInitialized()

    // Get provider from registered or built-in
    const provider = this.registeredProviders.get(slug) || this.getBuiltInProvider(slug)
    if (!provider) {
      return []
    }

    return provider.actions.filter((a) => a.scopes.includes(scope))
  }

  async addAction(slug: string, action: ProviderAction): Promise<void> {
    await this.ensureInitialized()

    // Get provider (must be registered to modify)
    const provider = this.registeredProviders.get(slug)
    if (!provider) {
      throw new Error(`Provider '${slug}' not found`)
    }

    provider.actions.push(action)
    this.registeredProviders.set(slug, provider)
    await this.ctx.storage.put(`provider:${slug}`, provider)
  }

  async removeAction(slug: string, actionName: string): Promise<void> {
    await this.ensureInitialized()

    // Get provider (must be registered to modify)
    const provider = this.registeredProviders.get(slug)
    if (!provider) {
      throw new Error(`Provider '${slug}' not found`)
    }

    provider.actions = provider.actions.filter((a) => a.name !== actionName)
    this.registeredProviders.set(slug, provider)
    await this.ctx.storage.put(`provider:${slug}`, provider)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROVIDER ACTIONS SDK
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Register a provider with extended action definitions (input/output schemas, rate limits)
   */
  async registerProviderWithActions(provider: ProviderWithActions): Promise<ProviderWithActions> {
    await this.ensureInitialized()

    const slug = provider.slug

    // Store in providers with actions map
    this.providersWithActions.set(slug, provider)

    // Persist to storage
    await this.ctx.storage.put(`providerWithActions:${slug}`, provider)

    return provider
  }

  /**
   * Get a specific action from a provider
   */
  async getAction(providerSlug: string, actionName: string): Promise<ExtendedProviderAction | null> {
    await this.ensureInitialized()

    const provider = this.providersWithActions.get(providerSlug)
    if (!provider) {
      return null
    }

    const action = provider.actions.find((a) => a.name === actionName)
    return action || null
  }

  /**
   * Get all actions for a provider
   */
  async getActions(providerSlug: string): Promise<ExtendedProviderAction[]> {
    await this.ensureInitialized()

    const provider = this.providersWithActions.get(providerSlug)
    if (!provider) {
      return []
    }

    return provider.actions
  }

  /**
   * Get the effective rate limit for an action (action-level or provider-level)
   */
  async getEffectiveRateLimit(providerSlug: string, actionName: string): Promise<RateLimitConfig> {
    await this.ensureInitialized()

    const provider = this.providersWithActions.get(providerSlug)
    if (!provider) {
      throw new Error(`Provider '${providerSlug}' not found`)
    }

    const action = provider.actions.find((a) => a.name === actionName)

    // Action-level rate limit takes precedence
    if (action?.rateLimit) {
      return action.rateLimit
    }

    // Fall back to provider-level rate limit
    if (provider.rateLimit) {
      return provider.rateLimit
    }

    // Default rate limit if none specified
    return { max: 1000, windowMs: 60000 }
  }

  /**
   * Validate input against an action's input schema
   */
  async validateActionInput(
    providerSlug: string,
    actionName: string,
    input: Record<string, unknown>,
  ): Promise<ValidationResult> {
    await this.ensureInitialized()

    const action = await this.getAction(providerSlug, actionName)
    if (!action) {
      return { valid: false, errors: [`Action '${actionName}' not found`] }
    }

    if (!action.inputSchema) {
      // No schema means any input is valid
      return { valid: true, errors: [] }
    }

    const errors: string[] = []

    // Validate required fields
    if (action.inputSchema.required) {
      for (const field of action.inputSchema.required) {
        if (input[field] === undefined) {
          errors.push(`${field} is required`)
        }
      }
    }

    // Validate type of provided fields
    if (action.inputSchema.properties) {
      for (const [field, value] of Object.entries(input)) {
        const schema = action.inputSchema.properties[field]
        if (schema) {
          const typeValid = this.validateType(value, schema)
          if (!typeValid) {
            errors.push(`${field} has invalid type`)
          }
        }
      }
    }

    return { valid: errors.length === 0, errors }
  }

  /**
   * Helper to validate value against schema type
   */
  private validateType(value: unknown, schema: JSONSchema): boolean {
    switch (schema.type) {
      case 'string':
        return typeof value === 'string'
      case 'number':
        return typeof value === 'number'
      case 'boolean':
        return typeof value === 'boolean'
      case 'array':
        return Array.isArray(value)
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value)
      default:
        return true
    }
  }

  /**
   * Fetch token from Vault DO
   */
  private async fetchTokenFromVault(linkedAccountId: string): Promise<TokenData | null> {
    const vaultDO = this.env.VAULT_DO as DurableObjectNamespace
    if (!vaultDO) {
      return null
    }

    const doId = vaultDO.idFromName ? vaultDO.idFromName(linkedAccountId) : linkedAccountId as any
    const stub = vaultDO.get(doId)
    const response = await stub.fetch(new Request(`http://vault/token/${linkedAccountId}`))

    if (!response.ok) {
      return null
    }

    // Clone response before reading to handle test mocks that reuse same Response object
    try {
      const data = (await response.clone().json()) as TokenData
      return data
    } catch {
      // If clone fails, try reading directly
      const data = (await response.json()) as TokenData
      return data
    }
  }

  /**
   * Refresh token in Vault DO
   */
  private async refreshTokenInVault(linkedAccountId: string): Promise<TokenData | null> {
    const vaultDO = this.env.VAULT_DO as DurableObjectNamespace
    if (!vaultDO) {
      return null
    }

    const doId = vaultDO.idFromName ? vaultDO.idFromName(linkedAccountId) : linkedAccountId as any
    const stub = vaultDO.get(doId)
    const response = await stub.fetch(
      new Request(`http://vault/token/${linkedAccountId}/refresh`, { method: 'POST' }),
    )

    if (!response.ok) {
      return null
    }

    // Clone response before reading to handle test mocks that reuse same Response object
    try {
      const data = (await response.clone().json()) as TokenData
      return data
    } catch {
      // If clone fails, try reading directly
      const data = (await response.json()) as TokenData
      return data
    }
  }

  /**
   * Create a typed SDK for a provider
   */
  async createSDK(
    providerSlug: string,
    linkedAccountId: string,
    options: SDKOptions = {},
  ): Promise<Record<string, unknown>> {
    await this.ensureInitialized()

    const provider = this.providersWithActions.get(providerSlug)
    if (!provider) {
      throw new Error(`Provider '${providerSlug}' not found`)
    }

    // Fetch initial token
    const tokenData = await this.fetchTokenFromVault(linkedAccountId)
    if (!tokenData) {
      throw new Error(`Linked account '${linkedAccountId}' not found - no valid token`)
    }

    // Default options
    const sdkOptions: SDKOptions = {
      maxRetries: options.maxRetries ?? 3,
      retryDelayMs: options.retryDelayMs ?? 100,
      timeout: options.timeout ?? 30000,
    }

    // Track rate limits per action
    const rateLimitStates: Map<string, RateLimitState> = new Map()

    // Token state (mutable for refresh)
    let currentToken = tokenData

    // Generate request ID
    const generateRequestId = () => `sdk-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

    // Helper to sleep
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    // Check and update rate limit
    const checkRateLimit = async (actionName: string): Promise<boolean> => {
      const rateLimit = await this.getEffectiveRateLimit(providerSlug, actionName)
      const now = Date.now()

      let state = rateLimitStates.get(actionName)
      if (!state || now - state.windowStart > rateLimit.windowMs) {
        // Reset window
        state = { requestCount: 0, windowStart: now }
        rateLimitStates.set(actionName, state)
      }

      if (state.requestCount >= rateLimit.max) {
        return false // Rate limited
      }

      state.requestCount++
      return true
    }

    // Get rate limit state for an action
    const getRateLimitState = (actionName: string): RateLimitState | undefined => {
      return rateLimitStates.get(actionName)
    }

    // Execute action with retry logic
    const executeAction = async (
      action: ExtendedProviderAction,
      params: Record<string, unknown>,
      callOptions?: { queue?: boolean; includeRateLimit?: boolean },
    ): Promise<unknown> => {
      const requestId = generateRequestId()

      // Validate input
      const validation = await this.validateActionInput(providerSlug, action.name, params)
      if (!validation.valid) {
        throw new SDKError(
          `Validation failed: ${validation.errors.join(', ')}`,
          'VALIDATION_ERROR',
          requestId,
          400,
          false,
        )
      }

      // Check rate limit
      if (!callOptions?.queue) {
        const allowed = await checkRateLimit(action.name)
        if (!allowed) {
          throw new SDKError('Rate limit exceeded', 'RATE_LIMITED', requestId, 429, true)
        }
      }

      // Build URL with path parameters
      let url = action.endpoint
      const bodyParams: Record<string, unknown> = {}

      for (const [key, value] of Object.entries(params)) {
        const placeholder = `{${key}}`
        if (url.includes(placeholder)) {
          url = url.replace(placeholder, String(value))
        } else {
          bodyParams[key] = value
        }
      }

      // Retry loop
      let lastError: Error | null = null
      let retryCount = 0
      const maxRetries = sdkOptions.maxRetries!

      while (retryCount <= maxRetries) {
        try {
          // Check if token is expired and refresh
          if (currentToken.expiresAt < Date.now()) {
            const newToken = await this.refreshTokenInVault(linkedAccountId)
            if (newToken) {
              currentToken = newToken
            }
          }

          const fetchOptions: RequestInit = {
            method: action.method,
            headers: {
              Authorization: `Bearer ${currentToken.accessToken}`,
              'Content-Type': 'application/json',
            },
          }

          if (action.method !== 'GET' && Object.keys(bodyParams).length > 0) {
            fetchOptions.body = JSON.stringify(bodyParams)
          }

          const response = await fetch(`https://api.example.com${url}`, fetchOptions)

          // Handle response - clone before reading to handle test mocks that reuse Response objects
          if (response.ok) {
            let data: unknown
            try {
              data = await response.clone().json()
            } catch {
              data = await response.json()
            }

            if (callOptions?.includeRateLimit) {
              const rateLimitInfo: RateLimitInfo = {
                remaining: parseInt(response.headers.get('X-RateLimit-Remaining') || '0', 10),
                limit: parseInt(response.headers.get('X-RateLimit-Limit') || '0', 10),
                resetAt: new Date(parseInt(response.headers.get('X-RateLimit-Reset') || '0', 10) * 1000),
              }
              return { data, rateLimit: rateLimitInfo }
            }

            return data
          }

          // Get request ID from response
          const responseRequestId = response.headers.get('X-Request-Id') || requestId

          // Handle specific status codes
          if (response.status === 401) {
            // Try to refresh token
            const newToken = await this.refreshTokenInVault(linkedAccountId)
            if (newToken && retryCount < maxRetries) {
              currentToken = newToken
              retryCount++
              continue
            }
            throw new SDKError('Unauthorized', 'UNAUTHORIZED', responseRequestId, 401, false)
          }

          if (response.status === 429) {
            if (retryCount < maxRetries) {
              const retryAfter = parseInt(response.headers.get('Retry-After') || '1', 10)
              await sleep(retryAfter * 1000)
              retryCount++
              continue
            }
            throw new SDKError('Rate limited', 'RATE_LIMITED', responseRequestId, 429, true)
          }

          if (response.status >= 400 && response.status < 500) {
            // Client errors (except 401, 429) are not retryable
            throw new SDKError(
              `Client error: ${response.status}`,
              'VALIDATION_ERROR',
              responseRequestId,
              response.status,
              false,
            )
          }

          if (response.status >= 500) {
            // Server errors are retryable
            if (retryCount < maxRetries) {
              const delay = sdkOptions.retryDelayMs! * Math.pow(2, retryCount)
              await sleep(delay)
              retryCount++
              continue
            }
            throw new SDKError(
              `Server error: ${response.status}`,
              'SERVER_ERROR',
              responseRequestId,
              response.status,
              true,
            )
          }
        } catch (error) {
          if (error instanceof SDKError) {
            throw error
          }

          // Network error
          if (retryCount < maxRetries) {
            const delay = sdkOptions.retryDelayMs! * Math.pow(2, retryCount)
            await sleep(delay)
            retryCount++
            lastError = error as Error
            continue
          }

          throw new SDKError(
            `Network error: ${(error as Error).message}`,
            'NETWORK_ERROR',
            requestId,
            undefined,
            true,
          )
        }
      }

      throw lastError || new SDKError('Max retries exceeded', 'SERVER_ERROR', requestId, undefined, true)
    }

    // Build SDK object with methods for each action
    const sdk: Record<string, unknown> = {}

    for (const action of provider.actions) {
      sdk[action.name] = async (
        params: Record<string, unknown>,
        callOptions?: { queue?: boolean; includeRateLimit?: boolean },
      ) => {
        return executeAction(action, params, callOptions)
      }
    }

    // Add metadata
    sdk._metadata = {
      provider: providerSlug,
      linkedAccountId,
      actions: provider.actions.map((a) => a.name),
      options: sdkOptions,
    } as SDKMetadata

    // Add rate limit state getter
    sdk.getRateLimitState = getRateLimitState

    return sdk
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WEBHOOK VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  async verifyWebhookSignature(slug: string, payload: string, signature: string): Promise<boolean> {
    await this.ensureInitialized()

    // Get provider from registered or built-in
    const provider = this.registeredProviders.get(slug) || this.getBuiltInProvider(slug)
    if (!provider || !provider.webhookConfig) {
      return false
    }

    const { algorithm, secretEnvVar } = provider.webhookConfig
    const secret = this.env[secretEnvVar] as string

    if (!secret) {
      return false
    }

    try {
      // Extract the signature hash part (e.g., "sha256=abc123" -> "abc123")
      const [algo, hash] = signature.split('=')
      if (!hash) {
        return false
      }

      // Verify algorithm matches
      if (algo !== algorithm) {
        return false
      }

      // Compute expected signature using Web Crypto API
      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: algorithm === 'sha256' ? 'SHA-256' : 'SHA-1' },
        false,
        ['sign'],
      )

      const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))

      const expectedHash = Array.from(new Uint8Array(signatureBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      // Constant-time comparison
      if (hash.length !== expectedHash.length) {
        return false
      }

      let result = 0
      for (let i = 0; i < hash.length; i++) {
        result |= hash.charCodeAt(i) ^ expectedHash.charCodeAt(i)
      }

      return result === 0
    } catch {
      return false
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP API
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method
    const path = url.pathname

    try {
      // GET /providers
      if (method === 'GET' && path === '/providers') {
        const accountType = url.searchParams.get('accountType')
        const search = url.searchParams.get('search')

        let providers: Provider[]

        if (accountType) {
          providers = await this.listProvidersByAccountType(accountType)
        } else if (search) {
          providers = await this.searchProviders(search)
        } else {
          providers = await this.listProviders()
        }

        return Response.json(providers)
      }

      // GET /providers/:slug
      const providerMatch = path.match(/^\/providers\/([^/]+)$/)
      if (method === 'GET' && providerMatch) {
        const slug = providerMatch[1]
        const provider = await this.getProvider(slug)

        if (!provider) {
          return new Response('Provider not found', { status: 404 })
        }

        return Response.json(provider)
      }

      // POST /providers
      if (method === 'POST' && path === '/providers') {
        const body = (await request.json()) as Omit<Provider, 'id'>
        const provider = await this.registerProvider(body)
        return Response.json(provider, { status: 201 })
      }

      // PUT /providers/:slug
      if (method === 'PUT' && providerMatch) {
        const slug = providerMatch[1]
        const body = (await request.json()) as Partial<Provider>
        const provider = await this.updateProvider(slug, body)

        if (!provider) {
          return new Response('Provider not found', { status: 404 })
        }

        return Response.json(provider)
      }

      // DELETE /providers/:slug
      if (method === 'DELETE' && providerMatch) {
        const slug = providerMatch[1]
        const deleted = await this.deleteProvider(slug)

        if (!deleted) {
          return new Response('Provider not found', { status: 404 })
        }

        return Response.json({ success: true })
      }

      // POST /providers/:slug/verify-webhook
      const webhookMatch = path.match(/^\/providers\/([^/]+)\/verify-webhook$/)
      if (method === 'POST' && webhookMatch) {
        const slug = webhookMatch[1]
        const body = (await request.json()) as { payload: string; signature: string }
        const valid = await this.verifyWebhookSignature(slug, body.payload, body.signature)
        return Response.json({ valid })
      }

      // GET /account-types - list all account types as objects
      if (method === 'GET' && path === '/account-types') {
        const types = await this.listAccountTypes()
        return Response.json(types)
      }

      // Account type routes
      const accountTypeMatch = path.match(/^\/account-types\/([^/]+)$/)

      // GET /account-types/:slug
      if (method === 'GET' && accountTypeMatch) {
        const slug = accountTypeMatch[1]
        const accountType = await this.getAccountType(slug)

        if (!accountType) {
          return new Response('Account type not found', { status: 404 })
        }

        return Response.json(accountType)
      }

      // POST /account-types
      if (method === 'POST' && path === '/account-types') {
        const body = (await request.json()) as Omit<AccountType, 'id'>
        // Check if this slug already exists (as built-in or registered)
        const existing = await this.getAccountType(body.slug)
        if (existing) {
          return Response.json({ error: `Account type with slug '${body.slug}' already exists` }, { status: 400 })
        }
        const accountType = await this.registerAccountType(body)
        return Response.json(accountType, { status: 201 })
      }

      // PUT /account-types/:slug
      if (method === 'PUT' && accountTypeMatch) {
        const slug = accountTypeMatch[1]
        const body = (await request.json()) as Partial<AccountType>
        const accountType = await this.updateAccountType(slug, body)

        if (!accountType) {
          return new Response('Account type not found', { status: 404 })
        }

        return Response.json(accountType)
      }

      // DELETE /account-types/:slug
      if (method === 'DELETE' && accountTypeMatch) {
        const slug = accountTypeMatch[1]
        try {
          const deleted = await this.deleteAccountType(slug)

          if (!deleted) {
            return new Response('Account type not found', { status: 404 })
          }

          return Response.json({ success: true })
        } catch (error) {
          // Built-in account types can't be deleted without force
          const message = error instanceof Error ? error.message : 'Unknown error'
          return Response.json({ error: message }, { status: 400 })
        }
      }

      // GET /providers/:slug/actions - list all actions for a provider
      const actionsListMatch = path.match(/^\/providers\/([^/]+)\/actions$/)
      if (method === 'GET' && actionsListMatch) {
        const slug = actionsListMatch[1]
        const actions = await this.getActions(slug)
        return Response.json(actions)
      }

      // GET /providers/:slug/actions/:action - get single action
      const actionMatch = path.match(/^\/providers\/([^/]+)\/actions\/([^/]+)$/)
      if (method === 'GET' && actionMatch) {
        const slug = actionMatch[1]
        const actionName = actionMatch[2]
        const action = await this.getAction(slug, actionName)

        if (!action) {
          return new Response('Action not found', { status: 404 })
        }

        return Response.json(action)
      }

      // POST /providers/:slug/actions/:action/validate - validate action input
      const validateMatch = path.match(/^\/providers\/([^/]+)\/actions\/([^/]+)\/validate$/)
      if (method === 'POST' && validateMatch) {
        const slug = validateMatch[1]
        const actionName = validateMatch[2]
        const body = (await request.json()) as Record<string, unknown>
        const validation = await this.validateActionInput(slug, actionName, body)
        return Response.json(validation)
      }

      // POST /providers/:slug/actions/:action/execute - execute action via SDK
      const executeMatch = path.match(/^\/providers\/([^/]+)\/actions\/([^/]+)\/execute$/)
      if (method === 'POST' && executeMatch) {
        const slug = executeMatch[1]
        const actionName = executeMatch[2]
        const body = (await request.json()) as { linkedAccountId: string; params: Record<string, unknown> }

        const sdk = await this.createSDK(slug, body.linkedAccountId)
        const actionFn = sdk[actionName] as (params: Record<string, unknown>) => Promise<unknown>

        if (!actionFn) {
          return new Response('Action not found', { status: 404 })
        }

        const result = await actionFn(body.params)
        return Response.json(result)
      }

      // Health check
      if (path === '/health') {
        return Response.json({ status: 'ok', ns: this.ns })
      }

      return new Response('Not Found', { status: 404 })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return Response.json({ error: message }, { status: 400 })
    }
  }
}

export default IntegrationsDO
