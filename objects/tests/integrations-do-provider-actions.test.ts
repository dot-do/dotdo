/**
 * IntegrationsDO Provider Actions SDK Tests
 *
 * RED TDD: These tests should FAIL because SDK generation doesn't exist yet.
 *
 * Tests for generating typed SDKs from provider action definitions.
 * SDKs provide a typed interface for calling provider APIs with:
 * - Automatic token management (refresh from Vault)
 * - Rate limiting per action
 * - Retry logic with exponential backoff
 * - Typed errors with request IDs
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import { IntegrationsDO } from '../IntegrationsDO'
import type { Provider, ProviderAction } from '../IntegrationsDO'

// ============================================================================
// TYPE DEFINITIONS (expected interfaces for SDK generation)
// ============================================================================

/**
 * Extended ProviderAction with input/output schemas and rate limits
 */
interface ExtendedProviderAction {
  name: string // 'createIssue'
  description: string // 'Create a new issue in a repository'
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  endpoint: string // '/repos/{owner}/{repo}/issues'
  scopes: string[] // ['repo']
  inputSchema?: JSONSchema
  outputSchema?: JSONSchema
  rateLimit?: { max: number; windowMs: number }
}

/**
 * JSON Schema type for input/output validation
 */
interface JSONSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean'
  properties?: Record<string, JSONSchema>
  required?: string[]
  items?: JSONSchema
}

/**
 * SDK instance for calling provider actions
 */
interface ProviderSDK {
  // Dynamic methods based on provider actions
  [actionName: string]: (params: Record<string, unknown>) => Promise<unknown>
}

/**
 * SDK configuration options
 */
interface SDKOptions {
  maxRetries?: number
  retryDelayMs?: number
  timeout?: number
}

/**
 * SDK error with request ID and typed error codes
 */
interface SDKError extends Error {
  code: 'UNAUTHORIZED' | 'RATE_LIMITED' | 'SERVER_ERROR' | 'VALIDATION_ERROR' | 'NETWORK_ERROR'
  requestId: string
  statusCode?: number
  retryable: boolean
}

/**
 * Rate limit info returned in responses
 */
interface RateLimitInfo {
  remaining: number
  limit: number
  resetAt: Date
}

// ============================================================================
// TEST DATA FIXTURES
// ============================================================================

const mockGitHubActionsProvider: Omit<Provider, 'id'> & { actions: ExtendedProviderAction[] } = {
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
      name: 'createIssue',
      description: 'Create a new issue in a repository',
      method: 'POST',
      endpoint: '/repos/{owner}/{repo}/issues',
      scopes: ['repo'],
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' } },
        },
        required: ['owner', 'repo', 'title'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          number: { type: 'number' },
          title: { type: 'string' },
          state: { type: 'string' },
          html_url: { type: 'string' },
        },
      },
      rateLimit: { max: 30, windowMs: 60000 }, // 30 per minute
    },
    {
      name: 'listRepos',
      description: 'List repositories for the authenticated user',
      method: 'GET',
      endpoint: '/user/repos',
      scopes: ['repo'],
      outputSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            name: { type: 'string' },
            full_name: { type: 'string' },
            private: { type: 'boolean' },
          },
        },
      },
    },
    {
      name: 'getUser',
      description: 'Get the authenticated user',
      method: 'GET',
      endpoint: '/user',
      scopes: ['user'],
      outputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          login: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
        },
      },
    },
  ],
  rateLimit: { max: 5000, windowMs: 3600000 },
}

const mockStripeActionsProvider: Omit<Provider, 'id'> & { actions: ExtendedProviderAction[] } = {
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
  actions: [
    {
      name: 'createPaymentIntent',
      description: 'Create a payment intent',
      method: 'POST',
      endpoint: '/v1/payment_intents',
      scopes: ['read_write'],
      inputSchema: {
        type: 'object',
        properties: {
          amount: { type: 'number' },
          currency: { type: 'string' },
          customer: { type: 'string' },
        },
        required: ['amount', 'currency'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          amount: { type: 'number' },
          status: { type: 'string' },
        },
      },
      rateLimit: { max: 100, windowMs: 1000 }, // 100 per second
    },
  ],
  rateLimit: { max: 100, windowMs: 1000 },
}

// ============================================================================
// MOCK DO STATE & ENV
// ============================================================================

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
    // Mock Vault DO binding
    VAULT_DO: {
      get: vi.fn().mockReturnValue({
        fetch: vi.fn(),
      }),
    },
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('IntegrationsDO Provider Actions SDK', () => {
  let integrationsDO: InstanceType<typeof IntegrationsDO>
  let mockState: DurableObjectState
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    integrationsDO = new IntegrationsDO(mockState, mockEnv)
    vi.clearAllMocks()
  })

  // ==========================================================================
  // 1. ACTION DEFINITIONS
  // ==========================================================================

  describe('Action Definitions', () => {
    describe('basic action properties', () => {
      it('provider actions have name, method, endpoint, scopes', async () => {
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        await integrationsDO.registerProviderWithActions(mockGitHubActionsProvider)

        // @ts-expect-error - method doesn't exist yet (RED TDD)
        const action = await integrationsDO.getAction('github', 'createIssue')

        expect(action).toBeDefined()
        expect(action.name).toBe('createIssue')
        expect(action.method).toBe('POST')
        expect(action.endpoint).toBe('/repos/{owner}/{repo}/issues')
        expect(action.scopes).toContain('repo')
      })

      it('actions can have input schemas', async () => {
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        await integrationsDO.registerProviderWithActions(mockGitHubActionsProvider)

        // @ts-expect-error - method doesn't exist yet (RED TDD)
        const action = await integrationsDO.getAction('github', 'createIssue')

        expect(action.inputSchema).toBeDefined()
        expect(action.inputSchema.type).toBe('object')
        expect(action.inputSchema.properties).toHaveProperty('title')
        expect(action.inputSchema.required).toContain('owner')
        expect(action.inputSchema.required).toContain('repo')
        expect(action.inputSchema.required).toContain('title')
      })

      it('actions can have output schemas', async () => {
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        await integrationsDO.registerProviderWithActions(mockGitHubActionsProvider)

        // @ts-expect-error - method doesn't exist yet (RED TDD)
        const action = await integrationsDO.getAction('github', 'createIssue')

        expect(action.outputSchema).toBeDefined()
        expect(action.outputSchema.type).toBe('object')
        expect(action.outputSchema.properties).toHaveProperty('id')
        expect(action.outputSchema.properties).toHaveProperty('number')
        expect(action.outputSchema.properties).toHaveProperty('html_url')
      })

      it('actions can have individual rate limits', async () => {
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        await integrationsDO.registerProviderWithActions(mockGitHubActionsProvider)

        // @ts-expect-error - method doesn't exist yet (RED TDD)
        const action = await integrationsDO.getAction('github', 'createIssue')

        expect(action.rateLimit).toBeDefined()
        expect(action.rateLimit.max).toBe(30)
        expect(action.rateLimit.windowMs).toBe(60000)
      })

      it('actions inherit provider rate limit if not specified', async () => {
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        await integrationsDO.registerProviderWithActions(mockGitHubActionsProvider)

        // listRepos action has no individual rate limit
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        const action = await integrationsDO.getAction('github', 'listRepos')

        // Should use provider-level rate limit
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        const effectiveRateLimit = await integrationsDO.getEffectiveRateLimit('github', 'listRepos')
        expect(effectiveRateLimit.max).toBe(5000)
        expect(effectiveRateLimit.windowMs).toBe(3600000)
      })
    })

    describe('action validation', () => {
      it('validates input against inputSchema', async () => {
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        await integrationsDO.registerProviderWithActions(mockGitHubActionsProvider)

        // Missing required field 'title'
        const invalidInput = {
          owner: 'org',
          repo: 'repo',
          // title is missing
        }

        // @ts-expect-error - method doesn't exist yet (RED TDD)
        const validation = await integrationsDO.validateActionInput('github', 'createIssue', invalidInput)

        expect(validation.valid).toBe(false)
        expect(validation.errors).toContain('title is required')
      })

      it('passes valid input against inputSchema', async () => {
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        await integrationsDO.registerProviderWithActions(mockGitHubActionsProvider)

        const validInput = {
          owner: 'org',
          repo: 'repo',
          title: 'Bug fix',
          body: 'Description',
        }

        // @ts-expect-error - method doesn't exist yet (RED TDD)
        const validation = await integrationsDO.validateActionInput('github', 'createIssue', validInput)

        expect(validation.valid).toBe(true)
        expect(validation.errors).toEqual([])
      })
    })
  })

  // ==========================================================================
  // 2. SDK GENERATION
  // ==========================================================================

  describe('SDK Generation', () => {
    const mockLinkedAccountId = 'linked-account-123'

    beforeEach(async () => {
      // Register provider with actions
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await integrationsDO.registerProviderWithActions(mockGitHubActionsProvider)

      // Mock Vault to return token
      mockEnv.VAULT_DO.get.mockReturnValue({
        fetch: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              accessToken: 'mock-access-token',
              refreshToken: 'mock-refresh-token',
              expiresAt: Date.now() + 3600000, // 1 hour from now
            }),
          ),
        ),
      })
    })

    it('can generate typed SDK for a provider', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId)

      expect(sdk).toBeDefined()
      expect(typeof sdk).toBe('object')
    })

    it('SDK methods match provider actions', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId)

      // Should have methods for each action
      expect(typeof sdk.createIssue).toBe('function')
      expect(typeof sdk.listRepos).toBe('function')
      expect(typeof sdk.getUser).toBe('function')
    })

    it('SDK methods are callable with parameters', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId)

      // Mock the actual API call
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 123,
            number: 1,
            title: 'Bug fix',
            state: 'open',
            html_url: 'https://github.com/org/repo/issues/1',
          }),
        ),
      )

      const issue = await sdk.createIssue({
        owner: 'org',
        repo: 'repo',
        title: 'Bug fix',
        body: 'Description',
      })

      expect(issue).toBeDefined()
      expect(issue.id).toBe(123)
      expect(issue.title).toBe('Bug fix')
    })

    it('SDK includes metadata about available methods', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId)

      // @ts-expect-error - metadata property (RED TDD)
      const metadata = sdk._metadata

      expect(metadata).toBeDefined()
      expect(metadata.provider).toBe('github')
      expect(metadata.linkedAccountId).toBe(mockLinkedAccountId)
      expect(metadata.actions).toContain('createIssue')
      expect(metadata.actions).toContain('listRepos')
      expect(metadata.actions).toContain('getUser')
    })

    it('SDK can be created with custom options', async () => {
      const options: SDKOptions = {
        maxRetries: 5,
        retryDelayMs: 500,
        timeout: 30000,
      }

      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId, options)

      // @ts-expect-error - metadata property (RED TDD)
      expect(sdk._metadata.options.maxRetries).toBe(5)
      // @ts-expect-error - metadata property (RED TDD)
      expect(sdk._metadata.options.retryDelayMs).toBe(500)
      // @ts-expect-error - metadata property (RED TDD)
      expect(sdk._metadata.options.timeout).toBe(30000)
    })

    it('throws error for non-existent provider', async () => {
      await expect(
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        integrationsDO.createSDK('non-existent', mockLinkedAccountId),
      ).rejects.toThrow(/provider.*not found/i)
    })

    it('throws error for non-existent linked account', async () => {
      // Mock Vault to return 404
      mockEnv.VAULT_DO.get.mockReturnValue({
        fetch: vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })),
      })

      await expect(
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        integrationsDO.createSDK('github', 'non-existent-account'),
      ).rejects.toThrow(/linked account.*not found/i)
    })
  })

  // ==========================================================================
  // 3. TOKEN HANDLING
  // ==========================================================================

  describe('Token Handling', () => {
    const mockLinkedAccountId = 'linked-account-123'

    beforeEach(async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await integrationsDO.registerProviderWithActions(mockGitHubActionsProvider)
    })

    it('SDK fetches token from Vault', async () => {
      mockEnv.VAULT_DO.get.mockReturnValue({
        fetch: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              accessToken: 'mock-access-token',
              refreshToken: 'mock-refresh-token',
              expiresAt: Date.now() + 3600000,
            }),
          ),
        ),
      })

      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId)

      // Mock API call
      global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([])))

      await sdk.listRepos({})

      // Verify token was fetched
      expect(mockEnv.VAULT_DO.get).toHaveBeenCalled()
    })

    it('SDK handles token refresh from Vault', async () => {
      const vaultFetch = vi.fn()

      // First call returns expired token
      vaultFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessToken: 'expired-token',
            refreshToken: 'mock-refresh-token',
            expiresAt: Date.now() - 1000, // Expired
          }),
        ),
      )

      // Second call returns refreshed token
      vaultFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
            expiresAt: Date.now() + 3600000,
          }),
        ),
      )

      mockEnv.VAULT_DO.get.mockReturnValue({ fetch: vaultFetch })

      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId)

      global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([])))

      await sdk.listRepos({})

      // Token should have been refreshed
      expect(vaultFetch).toHaveBeenCalledTimes(2)
    })

    it('SDK retries on 401 with refreshed token', async () => {
      const vaultFetch = vi.fn()

      // Initial token
      vaultFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessToken: 'initial-token',
            refreshToken: 'mock-refresh-token',
            expiresAt: Date.now() + 3600000,
          }),
        ),
      )

      // Refreshed token after 401
      vaultFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessToken: 'refreshed-token',
            refreshToken: 'new-refresh-token',
            expiresAt: Date.now() + 3600000,
          }),
        ),
      )

      mockEnv.VAULT_DO.get.mockReturnValue({ fetch: vaultFetch })

      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId)

      // First API call returns 401, second succeeds
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
        .mockResolvedValueOnce(new Response(JSON.stringify([])))

      const repos = await sdk.listRepos({})

      expect(repos).toEqual([])
      // Should have tried twice
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    it('SDK fails if no valid token available', async () => {
      mockEnv.VAULT_DO.get.mockReturnValue({
        fetch: vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })),
      })

      await expect(
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        integrationsDO.createSDK('github', mockLinkedAccountId),
      ).rejects.toThrow(/no valid token|token not found/i)
    })

    it('SDK fails after max refresh attempts', async () => {
      const vaultFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            accessToken: 'token',
            refreshToken: 'refresh',
            expiresAt: Date.now() + 3600000,
          }),
        ),
      )

      mockEnv.VAULT_DO.get.mockReturnValue({ fetch: vaultFetch })

      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId)

      // Always return 401
      global.fetch = vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }))

      await expect(sdk.listRepos({})).rejects.toThrow(/unauthorized|token refresh failed/i)
    })
  })

  // ==========================================================================
  // 4. RATE LIMITING
  // ==========================================================================

  describe('Rate Limiting', () => {
    const mockLinkedAccountId = 'linked-account-123'

    beforeEach(async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await integrationsDO.registerProviderWithActions(mockGitHubActionsProvider)

      mockEnv.VAULT_DO.get.mockReturnValue({
        fetch: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              accessToken: 'mock-access-token',
              refreshToken: 'mock-refresh-token',
              expiresAt: Date.now() + 3600000,
            }),
          ),
        ),
      })
    })

    it('SDK respects rate limits per action', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId)

      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 1, title: 'Test' })),
      )

      // createIssue has rate limit of 30/minute
      // Make 30 requests quickly
      const promises = []
      for (let i = 0; i < 31; i++) {
        promises.push(
          sdk.createIssue({ owner: 'org', repo: 'repo', title: `Issue ${i}` }).catch((e: Error) => e),
        )
      }

      const results = await Promise.all(promises)

      // 31st request should be rate limited
      const rateLimitedResult = results[30] as SDKError
      expect(rateLimitedResult).toBeInstanceOf(Error)
      expect(rateLimitedResult.code).toBe('RATE_LIMITED')
    })

    it('SDK queues requests when rate limited', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId, {
        // Enable queuing behavior
      })

      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 1, title: 'Test' })),
      )

      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const result = await sdk.createIssue(
        { owner: 'org', repo: 'repo', title: 'Queued Issue' },
        { queue: true }, // Queue if rate limited instead of failing
      )

      expect(result).toBeDefined()
    })

    it('SDK returns rate limit headers in response', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId)

      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 1, title: 'Test' }), {
          headers: {
            'X-RateLimit-Limit': '5000',
            'X-RateLimit-Remaining': '4999',
            'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
          },
        }),
      )

      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const response = await sdk.createIssue(
        { owner: 'org', repo: 'repo', title: 'Test' },
        { includeRateLimit: true },
      )

      expect(response.data).toBeDefined()
      expect(response.rateLimit).toBeDefined()
      expect(response.rateLimit.remaining).toBe(4999)
      expect(response.rateLimit.limit).toBe(5000)
    })

    it('SDK tracks rate limit state per action', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId)

      global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([])))

      // Make some requests
      await sdk.listRepos({})
      await sdk.listRepos({})

      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const rateLimitState = sdk.getRateLimitState('listRepos')

      expect(rateLimitState).toBeDefined()
      expect(rateLimitState.requestCount).toBe(2)
      expect(rateLimitState.windowStart).toBeDefined()
    })
  })

  // ==========================================================================
  // 5. RETRY LOGIC
  // ==========================================================================

  describe('Retry Logic', () => {
    const mockLinkedAccountId = 'linked-account-123'

    beforeEach(async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await integrationsDO.registerProviderWithActions(mockGitHubActionsProvider)

      mockEnv.VAULT_DO.get.mockReturnValue({
        fetch: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              accessToken: 'mock-access-token',
              refreshToken: 'mock-refresh-token',
              expiresAt: Date.now() + 3600000,
            }),
          ),
        ),
      })
    })

    it('SDK retries on 5xx errors', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId)

      // First two calls fail with 500, third succeeds
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }))
        .mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }))
        .mockResolvedValueOnce(new Response(JSON.stringify([])))

      const repos = await sdk.listRepos({})

      expect(repos).toEqual([])
      expect(global.fetch).toHaveBeenCalledTimes(3)
    })

    it('SDK uses exponential backoff', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId, {
        retryDelayMs: 100,
      })

      const callTimes: number[] = []
      global.fetch = vi.fn().mockImplementation(() => {
        callTimes.push(Date.now())
        if (callTimes.length < 3) {
          return Promise.resolve(new Response('Server Error', { status: 500 }))
        }
        return Promise.resolve(new Response(JSON.stringify([])))
      })

      await sdk.listRepos({})

      // Check exponential backoff delays
      // First retry: ~100ms, second retry: ~200ms
      const delay1 = callTimes[1] - callTimes[0]
      const delay2 = callTimes[2] - callTimes[1]

      expect(delay1).toBeGreaterThanOrEqual(90) // ~100ms with some tolerance
      expect(delay2).toBeGreaterThanOrEqual(180) // ~200ms with some tolerance
      expect(delay2).toBeGreaterThan(delay1) // Exponential increase
    })

    it('SDK respects max retries', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId, {
        maxRetries: 2,
        retryDelayMs: 10, // Fast retries for testing
      })

      // Always fail with 500
      global.fetch = vi.fn().mockResolvedValue(new Response('Server Error', { status: 500 }))

      await expect(sdk.listRepos({})).rejects.toThrow()

      // Initial + 2 retries = 3 calls
      expect(global.fetch).toHaveBeenCalledTimes(3)
    })

    it('SDK does not retry on 4xx errors (except 401, 429)', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId)

      global.fetch = vi.fn().mockResolvedValue(new Response('Bad Request', { status: 400 }))

      await expect(sdk.listRepos({})).rejects.toThrow()

      // Should not retry
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('SDK retries on 429 with Retry-After header', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId)

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response('Too Many Requests', {
            status: 429,
            headers: { 'Retry-After': '1' },
          }),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify([])))

      const repos = await sdk.listRepos({})

      expect(repos).toEqual([])
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })
  })

  // ==========================================================================
  // 6. ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    const mockLinkedAccountId = 'linked-account-123'

    beforeEach(async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await integrationsDO.registerProviderWithActions(mockGitHubActionsProvider)

      mockEnv.VAULT_DO.get.mockReturnValue({
        fetch: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              accessToken: 'mock-access-token',
              refreshToken: 'mock-refresh-token',
              expiresAt: Date.now() + 3600000,
            }),
          ),
        ),
      })
    })

    it('SDK returns typed errors', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId)

      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Bad Request', errors: [] }), { status: 400 }),
      )

      try {
        await sdk.listRepos({})
        expect.fail('Should have thrown')
      } catch (error) {
        const sdkError = error as SDKError
        expect(sdkError.code).toBe('VALIDATION_ERROR')
        expect(sdkError.statusCode).toBe(400)
        expect(sdkError.retryable).toBe(false)
      }
    })

    it('SDK includes request ID in errors', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId)

      global.fetch = vi.fn().mockResolvedValue(
        new Response('Server Error', {
          status: 500,
          headers: { 'X-Request-Id': 'req-12345' },
        }),
      )

      try {
        await sdk.listRepos({})
        expect.fail('Should have thrown')
      } catch (error) {
        const sdkError = error as SDKError
        expect(sdkError.requestId).toBeDefined()
        expect(sdkError.requestId).toBe('req-12345')
      }
    })

    it('SDK generates request ID if not in response', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId)

      global.fetch = vi.fn().mockResolvedValue(new Response('Server Error', { status: 500 }))

      try {
        await sdk.listRepos({})
        expect.fail('Should have thrown')
      } catch (error) {
        const sdkError = error as SDKError
        expect(sdkError.requestId).toBeDefined()
        expect(sdkError.requestId).toMatch(/^sdk-/) // Generated ID format
      }
    })

    it('SDK returns UNAUTHORIZED error code for 401', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId)

      // Always return 401 to exhaust retries
      global.fetch = vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }))

      try {
        await sdk.listRepos({})
        expect.fail('Should have thrown')
      } catch (error) {
        const sdkError = error as SDKError
        expect(sdkError.code).toBe('UNAUTHORIZED')
        expect(sdkError.retryable).toBe(false)
      }
    })

    it('SDK returns RATE_LIMITED error code for 429', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId, {
        maxRetries: 0, // No retries to immediately get the error
      })

      global.fetch = vi.fn().mockResolvedValue(new Response('Too Many Requests', { status: 429 }))

      try {
        await sdk.listRepos({})
        expect.fail('Should have thrown')
      } catch (error) {
        const sdkError = error as SDKError
        expect(sdkError.code).toBe('RATE_LIMITED')
        expect(sdkError.retryable).toBe(true)
      }
    })

    it('SDK returns SERVER_ERROR code for 5xx', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId, {
        maxRetries: 0, // No retries
      })

      global.fetch = vi.fn().mockResolvedValue(new Response('Internal Error', { status: 500 }))

      try {
        await sdk.listRepos({})
        expect.fail('Should have thrown')
      } catch (error) {
        const sdkError = error as SDKError
        expect(sdkError.code).toBe('SERVER_ERROR')
        expect(sdkError.retryable).toBe(true)
      }
    })

    it('SDK returns NETWORK_ERROR for fetch failures', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId, {
        maxRetries: 0,
      })

      global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'))

      try {
        await sdk.listRepos({})
        expect.fail('Should have thrown')
      } catch (error) {
        const sdkError = error as SDKError
        expect(sdkError.code).toBe('NETWORK_ERROR')
        expect(sdkError.retryable).toBe(true)
      }
    })

    it('SDK validates input before making request', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const sdk = await integrationsDO.createSDK('github', mockLinkedAccountId)

      // Missing required 'title' field
      try {
        await sdk.createIssue({ owner: 'org', repo: 'repo' })
        expect.fail('Should have thrown')
      } catch (error) {
        const sdkError = error as SDKError
        expect(sdkError.code).toBe('VALIDATION_ERROR')
        expect(sdkError.message).toContain('title')
      }

      // fetch should not have been called due to validation error
      expect(global.fetch).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // 7. HTTP API FOR SDK
  // ==========================================================================

  describe('HTTP API', () => {
    const mockLinkedAccountId = 'linked-account-123'

    beforeEach(async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await integrationsDO.registerProviderWithActions(mockGitHubActionsProvider)
    })

    it('POST /providers/:slug/actions/:action/execute executes action', async () => {
      mockEnv.VAULT_DO.get.mockReturnValue({
        fetch: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              accessToken: 'mock-token',
              refreshToken: 'mock-refresh',
              expiresAt: Date.now() + 3600000,
            }),
          ),
        ),
      })

      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 123,
            number: 1,
            title: 'Test Issue',
            state: 'open',
          }),
        ),
      )

      const request = new Request('http://test/providers/github/actions/createIssue/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          linkedAccountId: mockLinkedAccountId,
          params: {
            owner: 'org',
            repo: 'repo',
            title: 'Test Issue',
          },
        }),
      })

      const response = await integrationsDO.fetch(request)

      expect(response.status).toBe(200)
      const data = (await response.json()) as { id: number; title: string }
      expect(data.id).toBe(123)
      expect(data.title).toBe('Test Issue')
    })

    it('GET /providers/:slug/actions returns all actions', async () => {
      const request = new Request('http://test/providers/github/actions')
      const response = await integrationsDO.fetch(request)

      expect(response.status).toBe(200)
      const data = (await response.json()) as ExtendedProviderAction[]
      expect(Array.isArray(data)).toBe(true)
      expect(data.length).toBe(3)
      expect(data.map((a) => a.name)).toContain('createIssue')
      expect(data.map((a) => a.name)).toContain('listRepos')
      expect(data.map((a) => a.name)).toContain('getUser')
    })

    it('GET /providers/:slug/actions/:action returns single action', async () => {
      const request = new Request('http://test/providers/github/actions/createIssue')
      const response = await integrationsDO.fetch(request)

      expect(response.status).toBe(200)
      const data = (await response.json()) as ExtendedProviderAction
      expect(data.name).toBe('createIssue')
      expect(data.inputSchema).toBeDefined()
      expect(data.outputSchema).toBeDefined()
    })

    it('POST /providers/:slug/actions/:action/validate validates input', async () => {
      const request = new Request('http://test/providers/github/actions/createIssue/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: 'org',
          // Missing required fields
        }),
      })

      const response = await integrationsDO.fetch(request)

      expect(response.status).toBe(200)
      const data = (await response.json()) as { valid: boolean; errors: string[] }
      expect(data.valid).toBe(false)
      expect(data.errors.length).toBeGreaterThan(0)
    })
  })
})
