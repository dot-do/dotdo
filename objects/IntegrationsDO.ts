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
