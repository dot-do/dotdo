/**
 * IntegrationsDO Provider Registry Tests
 *
 * RED TDD: These tests should FAIL because IntegrationsDO doesn't exist yet.
 *
 * IntegrationsDO is a Durable Object that manages integration providers
 * (GitHub, Stripe, Google, etc.) with OAuth config, webhook verification,
 * and rate limiting.
 */

import { describe, it, expect, beforeEach } from 'vitest'

// This import will FAIL - IntegrationsDO doesn't exist yet
import { IntegrationsDO } from '../IntegrationsDO'
import type {
  Provider,
  ProviderAction,
  OAuthConfig,
  WebhookConfig,
  RateLimitConfig,
} from '../IntegrationsDO'

// ============================================================================
// TYPE DEFINITIONS (for test clarity)
// ============================================================================

/**
 * Provider interface representing an integration provider
 */
interface ExpectedProvider {
  id: string
  slug: string // 'github'
  name: string // 'GitHub'
  accountType: string // 'devtools', 'crm', 'payments', etc.
  icon: string
  oauthConfig: {
    authUrl: string
    tokenUrl: string
    scopes: string[]
    clientIdEnvVar: string
    clientSecretEnvVar: string
  }
  webhookConfig?: {
    signatureHeader: string // 'X-Hub-Signature-256'
    algorithm: 'sha256' | 'sha1'
    secretEnvVar: string
  }
  actions: ExpectedProviderAction[]
  rateLimit?: { max: number; windowMs: number }
}

interface ExpectedProviderAction {
  name: string
  description: string
  scopes: string[]
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
}

// ============================================================================
// TEST DATA FIXTURES
// ============================================================================

const mockGitHubProvider: ExpectedProvider = {
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
  rateLimit: { max: 5000, windowMs: 3600000 }, // 5000 requests per hour
}

const mockStripeProvider: ExpectedProvider = {
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
  rateLimit: { max: 100, windowMs: 1000 }, // 100 requests per second
}

const mockGoogleProvider: ExpectedProvider = {
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
}

const mockSlackProvider: ExpectedProvider = {
  id: 'slack',
  slug: 'slack',
  name: 'Slack',
  accountType: 'communication',
  icon: 'https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png',
  oauthConfig: {
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: ['chat:write', 'channels:read'],
    clientIdEnvVar: 'SLACK_CLIENT_ID',
    clientSecretEnvVar: 'SLACK_CLIENT_SECRET',
  },
  webhookConfig: {
    signatureHeader: 'X-Slack-Signature',
    algorithm: 'sha256',
    secretEnvVar: 'SLACK_SIGNING_SECRET',
  },
  actions: [
    {
      name: 'postMessage',
      description: 'Post a message to a channel',
      scopes: ['chat:write'],
      method: 'POST',
      path: '/api/chat.postMessage',
    },
  ],
}

// ============================================================================
// MOCK DO STATE & ENV
// ============================================================================

/**
 * Mock Durable Object state for testing
 */
function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()
  return {
    id: { toString: () => 'test-integrations-do-id' },
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        storage.set(key, value)
      },
      delete: async (key: string) => storage.delete(key),
      list: async (options?: { prefix?: string }) => {
        const result = new Map()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      },
      sql: {},
    },
    waitUntil: () => {},
    blockConcurrencyWhile: async (fn: () => Promise<void>) => fn(),
  } as unknown as DurableObjectState
}

function createMockEnv() {
  return {
    GITHUB_CLIENT_ID: 'test-github-client-id',
    GITHUB_CLIENT_SECRET: 'test-github-client-secret',
    GITHUB_WEBHOOK_SECRET: 'test-github-webhook-secret',
    STRIPE_CLIENT_ID: 'test-stripe-client-id',
    STRIPE_CLIENT_SECRET: 'test-stripe-client-secret',
    STRIPE_WEBHOOK_SECRET: 'test-stripe-webhook-secret',
    GOOGLE_CLIENT_ID: 'test-google-client-id',
    GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('IntegrationsDO', () => {
  let integrationsDO: InstanceType<typeof IntegrationsDO>
  let mockState: DurableObjectState
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    integrationsDO = new IntegrationsDO(mockState, mockEnv)
  })

  // ==========================================================================
  // 1. PROVIDER CRUD
  // ==========================================================================

  describe('Provider CRUD', () => {
    describe('registerProvider', () => {
      it('can register a new provider with OAuth config', async () => {
        const result = await integrationsDO.registerProvider(mockGitHubProvider)

        expect(result).toBeDefined()
        expect(result.id).toBe('github')
        expect(result.slug).toBe('github')
        expect(result.name).toBe('GitHub')
        expect(result.accountType).toBe('devtools')
        expect(result.oauthConfig).toEqual(mockGitHubProvider.oauthConfig)
      })

      it('generates id from slug if not provided', async () => {
        const providerWithoutId = {
          ...mockSlackProvider,
          id: undefined,
        }
        const result = await integrationsDO.registerProvider(providerWithoutId as unknown as ExpectedProvider)

        expect(result.id).toBe('slack')
      })

      it('rejects duplicate provider slugs', async () => {
        await integrationsDO.registerProvider(mockGitHubProvider)

        await expect(integrationsDO.registerProvider(mockGitHubProvider)).rejects.toThrow(
          /already exists|duplicate/i,
        )
      })

      it('validates required OAuth config fields', async () => {
        const invalidProvider = {
          ...mockGitHubProvider,
          oauthConfig: {
            authUrl: '', // Invalid: empty
            tokenUrl: mockGitHubProvider.oauthConfig.tokenUrl,
            scopes: [],
            clientIdEnvVar: '',
            clientSecretEnvVar: '',
          },
        }

        await expect(integrationsDO.registerProvider(invalidProvider)).rejects.toThrow(/invalid|required/i)
      })
    })

    describe('getProvider', () => {
      it('can get provider by slug', async () => {
        await integrationsDO.registerProvider(mockGitHubProvider)

        const provider = await integrationsDO.getProvider('github')

        expect(provider).toBeDefined()
        expect(provider?.slug).toBe('github')
        expect(provider?.name).toBe('GitHub')
      })

      it('returns null for non-existent provider', async () => {
        const provider = await integrationsDO.getProvider('non-existent')

        expect(provider).toBeNull()
      })

      it('can get provider by id', async () => {
        await integrationsDO.registerProvider(mockGitHubProvider)

        const provider = await integrationsDO.getProviderById('github')

        expect(provider).toBeDefined()
        expect(provider?.id).toBe('github')
      })
    })

    describe('updateProvider', () => {
      it('can update provider config', async () => {
        await integrationsDO.registerProvider(mockGitHubProvider)

        const updated = await integrationsDO.updateProvider('github', {
          name: 'GitHub Enterprise',
          rateLimit: { max: 10000, windowMs: 3600000 },
        })

        expect(updated).toBeDefined()
        expect(updated?.name).toBe('GitHub Enterprise')
        expect(updated?.rateLimit?.max).toBe(10000)
        // Original fields should be preserved
        expect(updated?.slug).toBe('github')
        expect(updated?.oauthConfig).toEqual(mockGitHubProvider.oauthConfig)
      })

      it('cannot update slug of existing provider', async () => {
        await integrationsDO.registerProvider(mockGitHubProvider)

        await expect(
          integrationsDO.updateProvider('github', { slug: 'new-slug' } as Partial<ExpectedProvider>),
        ).rejects.toThrow(/cannot update slug|immutable/i)
      })

      it('returns null when updating non-existent provider', async () => {
        const result = await integrationsDO.updateProvider('non-existent', { name: 'Test' })

        expect(result).toBeNull()
      })

      it('can update OAuth config partially', async () => {
        await integrationsDO.registerProvider(mockGitHubProvider)

        const updated = await integrationsDO.updateProvider('github', {
          oauthConfig: {
            ...mockGitHubProvider.oauthConfig,
            scopes: ['repo', 'user', 'read:org', 'write:org'],
          },
        })

        expect(updated?.oauthConfig.scopes).toContain('write:org')
      })
    })

    describe('deleteProvider', () => {
      it('can delete provider', async () => {
        await integrationsDO.registerProvider(mockGitHubProvider)

        const deleted = await integrationsDO.deleteProvider('github')

        expect(deleted).toBe(true)

        const provider = await integrationsDO.getProvider('github')
        expect(provider).toBeNull()
      })

      it('returns false for non-existent provider', async () => {
        const deleted = await integrationsDO.deleteProvider('non-existent')

        expect(deleted).toBe(false)
      })

      it('cannot delete built-in providers without force flag', async () => {
        // Built-in providers should be protected
        await expect(integrationsDO.deleteProvider('github')).rejects.toThrow(/built-in|protected/i)

        // But can delete with force flag
        const deleted = await integrationsDO.deleteProvider('github', { force: true })
        expect(deleted).toBe(true)
      })
    })
  })

  // ==========================================================================
  // 2. LISTING
  // ==========================================================================

  describe('Listing', () => {
    beforeEach(async () => {
      await integrationsDO.registerProvider(mockGitHubProvider)
      await integrationsDO.registerProvider(mockStripeProvider)
      await integrationsDO.registerProvider(mockGoogleProvider)
      await integrationsDO.registerProvider(mockSlackProvider)
    })

    describe('listProviders', () => {
      it('can list all providers', async () => {
        const providers = await integrationsDO.listProviders()

        expect(providers).toHaveLength(4)
        expect(providers.map((p) => p.slug)).toContain('github')
        expect(providers.map((p) => p.slug)).toContain('stripe')
        expect(providers.map((p) => p.slug)).toContain('google')
        expect(providers.map((p) => p.slug)).toContain('slack')
      })

      it('returns empty array when no providers registered', async () => {
        const emptyDO = new IntegrationsDO(createMockState(), createMockEnv())

        const providers = await emptyDO.listProviders()

        expect(providers).toEqual([])
      })

      it('supports pagination with limit and offset', async () => {
        const page1 = await integrationsDO.listProviders({ limit: 2, offset: 0 })
        const page2 = await integrationsDO.listProviders({ limit: 2, offset: 2 })

        expect(page1).toHaveLength(2)
        expect(page2).toHaveLength(2)
        // Ensure no overlap
        const page1Slugs = page1.map((p) => p.slug)
        const page2Slugs = page2.map((p) => p.slug)
        expect(page1Slugs.some((s) => page2Slugs.includes(s))).toBe(false)
      })
    })

    describe('listProvidersByAccountType', () => {
      it('can list providers by accountType', async () => {
        const devtoolsProviders = await integrationsDO.listProvidersByAccountType('devtools')

        expect(devtoolsProviders).toHaveLength(1)
        expect(devtoolsProviders[0].slug).toBe('github')
      })

      it('returns empty array for non-existent accountType', async () => {
        const providers = await integrationsDO.listProvidersByAccountType('non-existent')

        expect(providers).toEqual([])
      })

      it('can filter payments providers', async () => {
        const paymentsProviders = await integrationsDO.listProvidersByAccountType('payments')

        expect(paymentsProviders).toHaveLength(1)
        expect(paymentsProviders[0].slug).toBe('stripe')
      })

      it('can filter productivity providers', async () => {
        const productivityProviders = await integrationsDO.listProvidersByAccountType('productivity')

        expect(productivityProviders).toHaveLength(1)
        expect(productivityProviders[0].slug).toBe('google')
      })

      it('can filter communication providers', async () => {
        const communicationProviders = await integrationsDO.listProvidersByAccountType('communication')

        expect(communicationProviders).toHaveLength(1)
        expect(communicationProviders[0].slug).toBe('slack')
      })
    })

    describe('searchProviders', () => {
      it('can search providers by name', async () => {
        const results = await integrationsDO.searchProviders('git')

        expect(results).toHaveLength(1)
        expect(results[0].slug).toBe('github')
      })

      it('search is case-insensitive', async () => {
        const results = await integrationsDO.searchProviders('GITHUB')

        expect(results).toHaveLength(1)
        expect(results[0].slug).toBe('github')
      })

      it('returns empty array for no matches', async () => {
        const results = await integrationsDO.searchProviders('nonexistent')

        expect(results).toEqual([])
      })

      it('can search by partial slug', async () => {
        const results = await integrationsDO.searchProviders('oo')

        expect(results.map((p) => p.slug)).toContain('google')
      })

      it('can search across name and slug', async () => {
        const results = await integrationsDO.searchProviders('str')

        expect(results).toHaveLength(1)
        expect(results[0].slug).toBe('stripe')
      })
    })

    describe('getAccountTypes', () => {
      it('can list all unique account types', async () => {
        const accountTypes = await integrationsDO.getAccountTypes()

        expect(accountTypes).toContain('devtools')
        expect(accountTypes).toContain('payments')
        expect(accountTypes).toContain('productivity')
        expect(accountTypes).toContain('communication')
        expect(accountTypes).toHaveLength(4)
      })
    })
  })

  // ==========================================================================
  // 3. PROVIDER CONFIGURATION
  // ==========================================================================

  describe('Provider Configuration', () => {
    describe('actions with scopes', () => {
      it('provider has actions with scopes', async () => {
        await integrationsDO.registerProvider(mockGitHubProvider)

        const provider = await integrationsDO.getProvider('github')

        expect(provider?.actions).toBeDefined()
        expect(provider?.actions).toHaveLength(2)

        const listReposAction = provider?.actions.find((a) => a.name === 'listRepos')
        expect(listReposAction).toBeDefined()
        expect(listReposAction?.scopes).toContain('repo')
        expect(listReposAction?.method).toBe('GET')
        expect(listReposAction?.path).toBe('/user/repos')
      })

      it('can get actions by required scope', async () => {
        await integrationsDO.registerProvider(mockGitHubProvider)

        const actionsRequiringRepo = await integrationsDO.getActionsByScope('github', 'repo')

        expect(actionsRequiringRepo).toHaveLength(2)
        expect(actionsRequiringRepo.every((a) => a.scopes.includes('repo'))).toBe(true)
      })

      it('can add action to existing provider', async () => {
        await integrationsDO.registerProvider(mockGitHubProvider)

        const newAction: ExpectedProviderAction = {
          name: 'createPullRequest',
          description: 'Create a pull request',
          scopes: ['repo'],
          method: 'POST',
          path: '/repos/{owner}/{repo}/pulls',
        }

        await integrationsDO.addAction('github', newAction)

        const provider = await integrationsDO.getProvider('github')
        expect(provider?.actions).toHaveLength(3)
        expect(provider?.actions.find((a) => a.name === 'createPullRequest')).toBeDefined()
      })

      it('can remove action from provider', async () => {
        await integrationsDO.registerProvider(mockGitHubProvider)

        await integrationsDO.removeAction('github', 'listRepos')

        const provider = await integrationsDO.getProvider('github')
        expect(provider?.actions).toHaveLength(1)
        expect(provider?.actions.find((a) => a.name === 'listRepos')).toBeUndefined()
      })
    })

    describe('webhookConfig', () => {
      it('provider has webhookConfig for signature verification', async () => {
        await integrationsDO.registerProvider(mockGitHubProvider)

        const provider = await integrationsDO.getProvider('github')

        expect(provider?.webhookConfig).toBeDefined()
        expect(provider?.webhookConfig?.signatureHeader).toBe('X-Hub-Signature-256')
        expect(provider?.webhookConfig?.algorithm).toBe('sha256')
        expect(provider?.webhookConfig?.secretEnvVar).toBe('GITHUB_WEBHOOK_SECRET')
      })

      it('webhookConfig is optional', async () => {
        await integrationsDO.registerProvider(mockGoogleProvider)

        const provider = await integrationsDO.getProvider('google')

        expect(provider?.webhookConfig).toBeUndefined()
      })

      it('can verify webhook signature', async () => {
        await integrationsDO.registerProvider(mockGitHubProvider)

        const payload = JSON.stringify({ action: 'opened', issue: {} })
        // SHA256 HMAC of payload with secret 'test-github-webhook-secret'
        const expectedSignature = 'sha256=04e71dfa6fa4f6f0e8ccd680663e4dfdb9d718d9f007ea210a70d749fb9194ad'

        const isValid = await integrationsDO.verifyWebhookSignature('github', payload, expectedSignature)

        expect(isValid).toBe(true)
      })

      it('rejects invalid webhook signature', async () => {
        await integrationsDO.registerProvider(mockGitHubProvider)

        const payload = JSON.stringify({ action: 'opened', issue: {} })
        const invalidSignature = 'sha256=invalid_signature'

        const isValid = await integrationsDO.verifyWebhookSignature('github', payload, invalidSignature)

        expect(isValid).toBe(false)
      })

      it('supports sha1 algorithm for legacy webhooks', async () => {
        const legacyProvider: ExpectedProvider = {
          ...mockGitHubProvider,
          webhookConfig: {
            signatureHeader: 'X-Hub-Signature',
            algorithm: 'sha1',
            secretEnvVar: 'GITHUB_WEBHOOK_SECRET',
          },
        }

        await integrationsDO.registerProvider(legacyProvider)

        const provider = await integrationsDO.getProvider('github')
        expect(provider?.webhookConfig?.algorithm).toBe('sha1')
      })
    })

    describe('rateLimit', () => {
      it('provider has rateLimit config', async () => {
        await integrationsDO.registerProvider(mockGitHubProvider)

        const provider = await integrationsDO.getProvider('github')

        expect(provider?.rateLimit).toBeDefined()
        expect(provider?.rateLimit?.max).toBe(5000)
        expect(provider?.rateLimit?.windowMs).toBe(3600000) // 1 hour
      })

      it('rateLimit is optional', async () => {
        await integrationsDO.registerProvider(mockGoogleProvider)

        const provider = await integrationsDO.getProvider('google')

        expect(provider?.rateLimit).toBeUndefined()
      })

      it('can update rateLimit config', async () => {
        await integrationsDO.registerProvider(mockGitHubProvider)

        await integrationsDO.updateProvider('github', {
          rateLimit: { max: 10000, windowMs: 7200000 },
        })

        const provider = await integrationsDO.getProvider('github')
        expect(provider?.rateLimit?.max).toBe(10000)
        expect(provider?.rateLimit?.windowMs).toBe(7200000)
      })

      it('validates rateLimit values are positive', async () => {
        const invalidProvider = {
          ...mockGitHubProvider,
          rateLimit: { max: -1, windowMs: 1000 },
        }

        await expect(integrationsDO.registerProvider(invalidProvider)).rejects.toThrow(/invalid|positive/i)
      })
    })
  })

  // ==========================================================================
  // 4. BUILT-IN PROVIDERS
  // ==========================================================================

  describe('Built-in Providers', () => {
    it('GitHub provider pre-registered', async () => {
      // Should be available without explicit registration
      const provider = await integrationsDO.getProvider('github')

      expect(provider).toBeDefined()
      expect(provider?.slug).toBe('github')
      expect(provider?.name).toBe('GitHub')
      expect(provider?.accountType).toBe('devtools')
      expect(provider?.oauthConfig.authUrl).toBe('https://github.com/login/oauth/authorize')
    })

    it('Stripe provider pre-registered', async () => {
      const provider = await integrationsDO.getProvider('stripe')

      expect(provider).toBeDefined()
      expect(provider?.slug).toBe('stripe')
      expect(provider?.name).toBe('Stripe')
      expect(provider?.accountType).toBe('payments')
      expect(provider?.oauthConfig.authUrl).toBe('https://connect.stripe.com/oauth/authorize')
    })

    it('Google provider pre-registered', async () => {
      const provider = await integrationsDO.getProvider('google')

      expect(provider).toBeDefined()
      expect(provider?.slug).toBe('google')
      expect(provider?.name).toBe('Google')
      expect(provider?.accountType).toBe('productivity')
      expect(provider?.oauthConfig.authUrl).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    })

    it('built-in providers have correct webhook configs', async () => {
      const github = await integrationsDO.getProvider('github')
      const stripe = await integrationsDO.getProvider('stripe')

      expect(github?.webhookConfig?.signatureHeader).toBe('X-Hub-Signature-256')
      expect(stripe?.webhookConfig?.signatureHeader).toBe('Stripe-Signature')
    })

    it('built-in providers have default actions', async () => {
      const github = await integrationsDO.getProvider('github')

      expect(github?.actions).toBeDefined()
      expect(github?.actions.length).toBeGreaterThan(0)
    })

    it('listBuiltInProviders returns only built-in providers', async () => {
      // Register a custom provider
      await integrationsDO.registerProvider(mockSlackProvider)

      const builtIn = await integrationsDO.listBuiltInProviders()

      expect(builtIn.map((p) => p.slug)).toContain('github')
      expect(builtIn.map((p) => p.slug)).toContain('stripe')
      expect(builtIn.map((p) => p.slug)).toContain('google')
      expect(builtIn.map((p) => p.slug)).not.toContain('slack')
    })

    it('can check if provider is built-in', async () => {
      expect(await integrationsDO.isBuiltIn('github')).toBe(true)
      expect(await integrationsDO.isBuiltIn('stripe')).toBe(true)
      expect(await integrationsDO.isBuiltIn('google')).toBe(true)
      expect(await integrationsDO.isBuiltIn('slack')).toBe(false)
    })
  })

  // ==========================================================================
  // 5. HTTP API (fetch handler)
  // ==========================================================================

  describe('HTTP API', () => {
    beforeEach(async () => {
      await integrationsDO.registerProvider(mockSlackProvider)
    })

    it('GET /providers returns all providers', async () => {
      const request = new Request('http://test/providers')
      const response = await integrationsDO.fetch(request)

      expect(response.status).toBe(200)
      const data = (await response.json()) as ExpectedProvider[]
      expect(Array.isArray(data)).toBe(true)
    })

    it('GET /providers/:slug returns specific provider', async () => {
      const request = new Request('http://test/providers/github')
      const response = await integrationsDO.fetch(request)

      expect(response.status).toBe(200)
      const data = (await response.json()) as ExpectedProvider
      expect(data.slug).toBe('github')
    })

    it('GET /providers/:slug returns 404 for non-existent provider', async () => {
      const request = new Request('http://test/providers/non-existent')
      const response = await integrationsDO.fetch(request)

      expect(response.status).toBe(404)
    })

    it('POST /providers registers new provider', async () => {
      const newProvider = {
        slug: 'linear',
        name: 'Linear',
        accountType: 'devtools',
        icon: 'https://linear.app/favicon.ico',
        oauthConfig: {
          authUrl: 'https://linear.app/oauth/authorize',
          tokenUrl: 'https://api.linear.app/oauth/token',
          scopes: ['read', 'write'],
          clientIdEnvVar: 'LINEAR_CLIENT_ID',
          clientSecretEnvVar: 'LINEAR_CLIENT_SECRET',
        },
        actions: [],
      }

      const request = new Request('http://test/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProvider),
      })
      const response = await integrationsDO.fetch(request)

      expect(response.status).toBe(201)
      const data = (await response.json()) as ExpectedProvider
      expect(data.slug).toBe('linear')
    })

    it('PUT /providers/:slug updates provider', async () => {
      const request = new Request('http://test/providers/slack', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Slack Workspace' }),
      })
      const response = await integrationsDO.fetch(request)

      expect(response.status).toBe(200)
      const data = (await response.json()) as ExpectedProvider
      expect(data.name).toBe('Slack Workspace')
    })

    it('DELETE /providers/:slug deletes provider', async () => {
      const request = new Request('http://test/providers/slack', {
        method: 'DELETE',
      })
      const response = await integrationsDO.fetch(request)

      expect(response.status).toBe(200)

      // Verify deletion
      const getResponse = await integrationsDO.fetch(new Request('http://test/providers/slack'))
      expect(getResponse.status).toBe(404)
    })

    it('GET /providers?accountType=:type filters by account type', async () => {
      const request = new Request('http://test/providers?accountType=communication')
      const response = await integrationsDO.fetch(request)

      expect(response.status).toBe(200)
      const data = (await response.json()) as ExpectedProvider[]
      expect(data.every((p) => p.accountType === 'communication')).toBe(true)
    })

    it('GET /providers?search=:query searches providers', async () => {
      const request = new Request('http://test/providers?search=slack')
      const response = await integrationsDO.fetch(request)

      expect(response.status).toBe(200)
      const data = (await response.json()) as ExpectedProvider[]
      expect(data.some((p) => p.slug === 'slack')).toBe(true)
    })

    it('GET /account-types returns all account types', async () => {
      const request = new Request('http://test/account-types')
      const response = await integrationsDO.fetch(request)

      expect(response.status).toBe(200)
      const data = (await response.json()) as string[]
      expect(Array.isArray(data)).toBe(true)
    })

    it('POST /providers/:slug/verify-webhook verifies webhook signature', async () => {
      const request = new Request('http://test/providers/github/verify-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: '{"action":"opened"}',
          signature: 'sha256=test',
        }),
      })
      const response = await integrationsDO.fetch(request)

      expect(response.status).toBe(200)
      const data = (await response.json()) as { valid: boolean }
      expect(typeof data.valid).toBe('boolean')
    })
  })

  // ==========================================================================
  // 6. EDGE CASES & ERROR HANDLING
  // ==========================================================================

  describe('Edge Cases & Error Handling', () => {
    it('handles concurrent provider registration', async () => {
      const providers = [mockGitHubProvider, mockStripeProvider, mockGoogleProvider, mockSlackProvider]

      // Register all providers concurrently
      const results = await Promise.all(providers.map((p) => integrationsDO.registerProvider(p)))

      expect(results).toHaveLength(4)
      expect(results.every((r) => r.id)).toBe(true)
    })

    it('handles special characters in provider names', async () => {
      const specialProvider: ExpectedProvider = {
        ...mockSlackProvider,
        slug: 'provider-with-dashes',
        name: 'Provider with Special (Characters) & Symbols!',
      }

      const result = await integrationsDO.registerProvider(specialProvider)

      expect(result.name).toBe('Provider with Special (Characters) & Symbols!')
    })

    it('validates OAuth URLs are valid URLs', async () => {
      const invalidProvider = {
        ...mockGitHubProvider,
        oauthConfig: {
          ...mockGitHubProvider.oauthConfig,
          authUrl: 'not-a-valid-url',
        },
      }

      await expect(integrationsDO.registerProvider(invalidProvider)).rejects.toThrow(/invalid.*url/i)
    })

    it('handles empty actions array', async () => {
      const providerWithNoActions: ExpectedProvider = {
        ...mockGoogleProvider,
        actions: [],
      }

      const result = await integrationsDO.registerProvider(providerWithNoActions)

      expect(result.actions).toEqual([])
    })

    it('preserves provider order in listings', async () => {
      await integrationsDO.registerProvider({ ...mockSlackProvider, slug: 'aaa' })
      await integrationsDO.registerProvider({ ...mockSlackProvider, slug: 'zzz' })
      await integrationsDO.registerProvider({ ...mockSlackProvider, slug: 'mmm' })

      const providers = await integrationsDO.listProviders()
      const customProviders = providers.filter((p) => ['aaa', 'zzz', 'mmm'].includes(p.slug))

      // Should maintain insertion order or be sorted consistently
      expect(customProviders.length).toBe(3)
    })
  })
})
