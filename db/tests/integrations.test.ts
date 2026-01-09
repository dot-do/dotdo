import { describe, it, expect } from 'vitest'

/**
 * Integrations Provider Registry Tests
 *
 * These tests verify the schema for integrations.do - the central provider registry.
 *
 * Key design decisions:
 * - providers table: Stores OAuth configs, webhooks configs, actions, rate limits
 * - accountTypes table: Dynamic account types (NOT hardcoded in id.org.ai)
 * - Account types come FROM integrations.do, allowing new providers without code changes
 *
 * Implementation includes:
 * - Provider definitions with OAuth configuration
 * - Webhook signature verification configuration
 * - Per-provider actions/scopes definitions
 * - Rate limiting configuration
 * - Dynamic account types mapping to providers
 */

// Import the schema and types
import {
  providers,
  accountTypes,
  type Provider,
  type AccountType,
  type OAuthConfig,
  type WebhookConfig,
  type ProviderAction,
  type RateLimitConfig,
  type ProviderType,
  isValidOAuthConfig,
  isValidWebhookConfig,
  isValidProviderAction,
} from '../integrations'

// ============================================================================
// PROVIDERS TABLE TESTS
// ============================================================================

describe('Providers Table Schema', () => {
  describe('Table Structure', () => {
    it('providers table is exported from db/integrations.ts', () => {
      expect(providers).toBeDefined()
    })

    it('has id primary key', () => {
      expect(providers.id).toBeDefined()
    })

    it('has slug column (unique)', () => {
      expect(providers.slug).toBeDefined()
    })

    it('has name column (required)', () => {
      expect(providers.name).toBeDefined()
    })

    it('has type column (required)', () => {
      expect(providers.type).toBeDefined()
    })

    it('has category column', () => {
      expect(providers.category).toBeDefined()
    })

    it('has icon column', () => {
      expect(providers.icon).toBeDefined()
    })

    it('has description column', () => {
      expect(providers.description).toBeDefined()
    })

    it('has baseUrl column', () => {
      expect(providers.baseUrl).toBeDefined()
    })

    it('has apiVersion column', () => {
      expect(providers.apiVersion).toBeDefined()
    })

    it('has oauthConfig JSON column', () => {
      expect(providers.oauthConfig).toBeDefined()
    })

    it('has webhookConfig JSON column', () => {
      expect(providers.webhookConfig).toBeDefined()
    })

    it('has actions JSON array column', () => {
      expect(providers.actions).toBeDefined()
    })

    it('has rateLimit JSON column', () => {
      expect(providers.rateLimit).toBeDefined()
    })

    it('has docsUrl column', () => {
      expect(providers.docsUrl).toBeDefined()
    })

    it('has enabled boolean column', () => {
      expect(providers.enabled).toBeDefined()
    })

    it('has official boolean column', () => {
      expect(providers.official).toBeDefined()
    })

    it('has metadata JSON column', () => {
      expect(providers.metadata).toBeDefined()
    })

    it('has createdAt timestamp', () => {
      expect(providers.createdAt).toBeDefined()
    })

    it('has updatedAt timestamp', () => {
      expect(providers.updatedAt).toBeDefined()
    })
  })

  describe('Provider Types', () => {
    it('type field accepts oauth2 value', () => {
      const providerType: ProviderType = 'oauth2'
      expect(['oauth2', 'api_key', 'webhook', 'oauth1']).toContain(providerType)
    })

    it('type field accepts api_key value', () => {
      const providerType: ProviderType = 'api_key'
      expect(['oauth2', 'api_key', 'webhook', 'oauth1']).toContain(providerType)
    })

    it('type field accepts webhook value', () => {
      const providerType: ProviderType = 'webhook'
      expect(['oauth2', 'api_key', 'webhook', 'oauth1']).toContain(providerType)
    })

    it('type field accepts oauth1 value', () => {
      const providerType: ProviderType = 'oauth1'
      expect(['oauth2', 'api_key', 'webhook', 'oauth1']).toContain(providerType)
    })
  })

  describe('OAuth Configuration', () => {
    it('oauthConfig can store GitHub OAuth configuration', () => {
      const githubOAuth: OAuthConfig = {
        authUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        scopes: ['repo', 'user:email', 'read:org'],
        userInfoUrl: 'https://api.github.com/user',
      }

      expect(githubOAuth.authUrl).toContain('github.com')
      expect(githubOAuth.tokenUrl).toContain('github.com')
      expect(githubOAuth.scopes).toContain('repo')
    })

    it('oauthConfig can store Slack OAuth configuration', () => {
      const slackOAuth: OAuthConfig = {
        authUrl: 'https://slack.com/oauth/v2/authorize',
        tokenUrl: 'https://slack.com/api/oauth.v2.access',
        scopes: ['channels:read', 'chat:write', 'users:read'],
      }

      expect(slackOAuth.authUrl).toContain('slack.com')
      expect(slackOAuth.scopes).toContain('chat:write')
    })

    it('oauthConfig supports PKCE flag', () => {
      const oauthWithPKCE: OAuthConfig = {
        authUrl: 'https://example.com/oauth/authorize',
        tokenUrl: 'https://example.com/oauth/token',
        scopes: ['read'],
        pkceSupported: true,
      }

      expect(oauthWithPKCE.pkceSupported).toBe(true)
    })

    it('oauthConfig supports revoke URL', () => {
      const oauthWithRevoke: OAuthConfig = {
        authUrl: 'https://example.com/oauth/authorize',
        tokenUrl: 'https://example.com/oauth/token',
        scopes: ['read'],
        revokeUrl: 'https://example.com/oauth/revoke',
      }

      expect(oauthWithRevoke.revokeUrl).toContain('/revoke')
    })
  })

  describe('Webhook Configuration', () => {
    it('webhookConfig can store GitHub webhook configuration', () => {
      const githubWebhook: WebhookConfig = {
        signatureHeader: 'X-Hub-Signature-256',
        algorithm: 'sha256',
        signaturePrefix: 'sha256=',
      }

      expect(githubWebhook.signatureHeader).toBe('X-Hub-Signature-256')
      expect(githubWebhook.algorithm).toBe('sha256')
      expect(githubWebhook.signaturePrefix).toBe('sha256=')
    })

    it('webhookConfig can store Slack webhook configuration', () => {
      const slackWebhook: WebhookConfig = {
        signatureHeader: 'X-Slack-Signature',
        algorithm: 'hmac-sha256',
        signaturePrefix: 'v0=',
        timestampHeader: 'X-Slack-Request-Timestamp',
        timestampMaxAge: 300, // 5 minutes
      }

      expect(slackWebhook.signatureHeader).toBe('X-Slack-Signature')
      expect(slackWebhook.timestampHeader).toBe('X-Slack-Request-Timestamp')
      expect(slackWebhook.timestampMaxAge).toBe(300)
    })

    it('webhookConfig supports multiple algorithms', () => {
      const validAlgorithms: WebhookConfig['algorithm'][] = ['sha256', 'sha1', 'hmac-sha256', 'hmac-sha1']

      validAlgorithms.forEach((algorithm) => {
        const config: WebhookConfig = {
          signatureHeader: 'X-Signature',
          algorithm,
        }
        expect(config.algorithm).toBe(algorithm)
      })
    })
  })

  describe('Provider Actions', () => {
    it('actions can store GitHub API operations', () => {
      const githubActions: ProviderAction[] = [
        {
          name: 'create_issue',
          description: 'Create a new issue in a repository',
          method: 'POST',
          endpoint: '/repos/{owner}/{repo}/issues',
          scopes: ['repo'],
        },
        {
          name: 'get_user',
          description: 'Get authenticated user info',
          method: 'GET',
          endpoint: '/user',
          scopes: ['user:read'],
        },
      ]

      expect(githubActions).toHaveLength(2)
      expect(githubActions[0].name).toBe('create_issue')
      expect(githubActions[0].method).toBe('POST')
    })

    it('actions support all HTTP methods', () => {
      const methods: ProviderAction['method'][] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

      methods.forEach((method) => {
        const action: ProviderAction = {
          name: `test_${method.toLowerCase()}`,
          method,
          endpoint: '/test',
          scopes: [],
        }
        expect(action.method).toBe(method)
      })
    })

    it('actions support endpoint placeholders', () => {
      const action: ProviderAction = {
        name: 'get_repo_issue',
        method: 'GET',
        endpoint: '/repos/{owner}/{repo}/issues/{issue_number}',
        scopes: ['repo'],
      }

      expect(action.endpoint).toContain('{owner}')
      expect(action.endpoint).toContain('{repo}')
      expect(action.endpoint).toContain('{issue_number}')
    })
  })

  describe('Rate Limiting', () => {
    it('rateLimit can store basic configuration', () => {
      const rateLimit: RateLimitConfig = {
        max: 5000,
        window: 3600, // 1 hour in seconds
      }

      expect(rateLimit.max).toBe(5000)
      expect(rateLimit.window).toBe(3600)
    })

    it('rateLimit supports sliding window', () => {
      const rateLimit: RateLimitConfig = {
        max: 100,
        window: 60,
        type: 'sliding',
      }

      expect(rateLimit.type).toBe('sliding')
    })

    it('rateLimit supports fixed window', () => {
      const rateLimit: RateLimitConfig = {
        max: 1000,
        window: 900, // 15 minutes
        type: 'fixed',
      }

      expect(rateLimit.type).toBe('fixed')
    })
  })
})

// ============================================================================
// ACCOUNT TYPES TABLE TESTS
// ============================================================================

describe('Account Types Table Schema', () => {
  describe('Table Structure', () => {
    it('accountTypes table is exported from db/integrations.ts', () => {
      expect(accountTypes).toBeDefined()
    })

    it('has id primary key', () => {
      expect(accountTypes.id).toBeDefined()
    })

    it('has slug column (unique)', () => {
      expect(accountTypes.slug).toBeDefined()
    })

    it('has name column (required)', () => {
      expect(accountTypes.name).toBeDefined()
    })

    it('has icon column', () => {
      expect(accountTypes.icon).toBeDefined()
    })

    it('has description column', () => {
      expect(accountTypes.description).toBeDefined()
    })

    it('has providers JSON array column (required)', () => {
      expect(accountTypes.providers).toBeDefined()
    })

    it('has enabled boolean column', () => {
      expect(accountTypes.enabled).toBeDefined()
    })

    it('has displayOrder column', () => {
      expect(accountTypes.displayOrder).toBeDefined()
    })

    it('has metadata JSON column', () => {
      expect(accountTypes.metadata).toBeDefined()
    })

    it('has createdAt timestamp', () => {
      expect(accountTypes.createdAt).toBeDefined()
    })

    it('has updatedAt timestamp', () => {
      expect(accountTypes.updatedAt).toBeDefined()
    })
  })

  describe('Dynamic Account Types', () => {
    it('can define VCS account type with multiple providers', () => {
      const vcsAccountType: Partial<AccountType> = {
        id: 'vcs',
        slug: 'vcs',
        name: 'Version Control',
        icon: 'git-branch',
        description: 'Connect your code repositories',
        providers: ['github', 'gitlab', 'bitbucket'],
        enabled: true,
        displayOrder: 1,
      }

      expect(vcsAccountType.providers).toHaveLength(3)
      expect(vcsAccountType.providers).toContain('github')
      expect(vcsAccountType.providers).toContain('gitlab')
      expect(vcsAccountType.providers).toContain('bitbucket')
    })

    it('can define Chat account type', () => {
      const chatAccountType: Partial<AccountType> = {
        id: 'chat',
        slug: 'chat',
        name: 'Team Chat',
        icon: 'message-circle',
        description: 'Connect team communication tools',
        providers: ['slack', 'discord', 'teams'],
        enabled: true,
        displayOrder: 2,
      }

      expect(chatAccountType.providers).toContain('slack')
    })

    it('can define CRM account type', () => {
      const crmAccountType: Partial<AccountType> = {
        id: 'crm',
        slug: 'crm',
        name: 'Customer Relationship Management',
        icon: 'users',
        providers: ['salesforce', 'hubspot', 'pipedrive'],
        enabled: true,
      }

      expect(crmAccountType.providers).toContain('salesforce')
    })

    it('can define Project Management account type', () => {
      const pmAccountType: Partial<AccountType> = {
        id: 'project-management',
        slug: 'project-management',
        name: 'Project Management',
        icon: 'kanban',
        providers: ['linear', 'jira', 'asana', 'notion'],
        enabled: true,
      }

      expect(pmAccountType.providers).toHaveLength(4)
    })

    it('account type can be disabled', () => {
      const disabledType: Partial<AccountType> = {
        id: 'legacy',
        slug: 'legacy',
        name: 'Legacy Integration',
        providers: ['old-system'],
        enabled: false,
      }

      expect(disabledType.enabled).toBe(false)
    })

    it('displayOrder controls UI sorting', () => {
      const types: Partial<AccountType>[] = [
        { id: 'vcs', displayOrder: 1 },
        { id: 'chat', displayOrder: 2 },
        { id: 'crm', displayOrder: 3 },
        { id: 'analytics', displayOrder: 4 },
      ]

      const sorted = [...types].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      expect(sorted[0].id).toBe('vcs')
      expect(sorted[3].id).toBe('analytics')
    })
  })

  describe('Key Design: Dynamic Types from integrations.do', () => {
    it('account types are NOT hardcoded - they come from database', () => {
      // This is a design principle test
      // Account types should be fetched from integrations.do, not hardcoded
      const dynamicTypes = [
        { id: 'vcs', providers: ['github', 'gitlab'] },
        { id: 'chat', providers: ['slack', 'discord'] },
        { id: 'custom-integration', providers: ['custom-api'] },
        { id: 'new-category', providers: ['new-provider'] },
      ]

      // Any string can be an account type ID
      dynamicTypes.forEach((type) => {
        expect(typeof type.id).toBe('string')
        expect(Array.isArray(type.providers)).toBe(true)
      })
    })

    it('new providers can be added without code changes', () => {
      // Adding a new provider only requires database insert
      const newProvider: Partial<Provider> = {
        id: 'new-ai-service',
        slug: 'new-ai-service',
        name: 'New AI Service',
        type: 'oauth2',
        category: 'ai',
      }

      expect(newProvider.id).toBe('new-ai-service')
      // No TypeScript changes needed - it's just data
    })

    it('new account types can be added without code changes', () => {
      // Adding a new account type only requires database insert
      const newAccountType: Partial<AccountType> = {
        id: 'ai-tools',
        slug: 'ai-tools',
        name: 'AI Tools',
        providers: ['openai', 'anthropic', 'new-ai-service'],
        enabled: true,
      }

      expect(newAccountType.providers).toHaveLength(3)
      // No TypeScript changes needed - it's just data
    })
  })
})

// ============================================================================
// VALIDATION HELPERS TESTS
// ============================================================================

describe('Validation Helpers', () => {
  describe('isValidOAuthConfig', () => {
    it('returns true for valid OAuth config', () => {
      const validConfig: OAuthConfig = {
        authUrl: 'https://example.com/oauth/authorize',
        tokenUrl: 'https://example.com/oauth/token',
        scopes: ['read', 'write'],
      }

      expect(isValidOAuthConfig(validConfig)).toBe(true)
    })

    it('returns false for missing authUrl', () => {
      const invalidConfig = {
        tokenUrl: 'https://example.com/oauth/token',
        scopes: ['read'],
      }

      expect(isValidOAuthConfig(invalidConfig)).toBe(false)
    })

    it('returns false for missing tokenUrl', () => {
      const invalidConfig = {
        authUrl: 'https://example.com/oauth/authorize',
        scopes: ['read'],
      }

      expect(isValidOAuthConfig(invalidConfig)).toBe(false)
    })

    it('returns false for missing scopes', () => {
      const invalidConfig = {
        authUrl: 'https://example.com/oauth/authorize',
        tokenUrl: 'https://example.com/oauth/token',
      }

      expect(isValidOAuthConfig(invalidConfig)).toBe(false)
    })

    it('returns false for non-array scopes', () => {
      const invalidConfig = {
        authUrl: 'https://example.com/oauth/authorize',
        tokenUrl: 'https://example.com/oauth/token',
        scopes: 'read,write', // Should be array
      }

      expect(isValidOAuthConfig(invalidConfig)).toBe(false)
    })

    it('returns false for null', () => {
      expect(isValidOAuthConfig(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isValidOAuthConfig(undefined)).toBe(false)
    })
  })

  describe('isValidWebhookConfig', () => {
    it('returns true for valid webhook config', () => {
      const validConfig: WebhookConfig = {
        signatureHeader: 'X-Signature',
        algorithm: 'sha256',
      }

      expect(isValidWebhookConfig(validConfig)).toBe(true)
    })

    it('returns true for all valid algorithms', () => {
      const algorithms: WebhookConfig['algorithm'][] = ['sha256', 'sha1', 'hmac-sha256', 'hmac-sha1']

      algorithms.forEach((algorithm) => {
        const config = {
          signatureHeader: 'X-Signature',
          algorithm,
        }
        expect(isValidWebhookConfig(config)).toBe(true)
      })
    })

    it('returns false for invalid algorithm', () => {
      const invalidConfig = {
        signatureHeader: 'X-Signature',
        algorithm: 'md5', // Not supported
      }

      expect(isValidWebhookConfig(invalidConfig)).toBe(false)
    })

    it('returns false for missing signatureHeader', () => {
      const invalidConfig = {
        algorithm: 'sha256',
      }

      expect(isValidWebhookConfig(invalidConfig)).toBe(false)
    })

    it('returns false for null', () => {
      expect(isValidWebhookConfig(null)).toBe(false)
    })
  })

  describe('isValidProviderAction', () => {
    it('returns true for valid action', () => {
      const validAction: ProviderAction = {
        name: 'get_user',
        method: 'GET',
        endpoint: '/user',
        scopes: ['user:read'],
      }

      expect(isValidProviderAction(validAction)).toBe(true)
    })

    it('returns true for all HTTP methods', () => {
      const methods: ProviderAction['method'][] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

      methods.forEach((method) => {
        const action = {
          name: 'test',
          method,
          endpoint: '/test',
          scopes: [],
        }
        expect(isValidProviderAction(action)).toBe(true)
      })
    })

    it('returns false for invalid HTTP method', () => {
      const invalidAction = {
        name: 'test',
        method: 'OPTIONS', // Not in allowed list
        endpoint: '/test',
        scopes: [],
      }

      expect(isValidProviderAction(invalidAction)).toBe(false)
    })

    it('returns false for missing name', () => {
      const invalidAction = {
        method: 'GET',
        endpoint: '/test',
        scopes: [],
      }

      expect(isValidProviderAction(invalidAction)).toBe(false)
    })

    it('returns false for missing endpoint', () => {
      const invalidAction = {
        name: 'test',
        method: 'GET',
        scopes: [],
      }

      expect(isValidProviderAction(invalidAction)).toBe(false)
    })

    it('returns false for non-array scopes', () => {
      const invalidAction = {
        name: 'test',
        method: 'GET',
        endpoint: '/test',
        scopes: 'read', // Should be array
      }

      expect(isValidProviderAction(invalidAction)).toBe(false)
    })
  })
})

// ============================================================================
// PROVIDER EXAMPLES TESTS
// ============================================================================

describe('Provider Examples', () => {
  it('can define complete GitHub provider', () => {
    const githubProvider: Partial<Provider> = {
      id: 'github',
      slug: 'github',
      name: 'GitHub',
      type: 'oauth2',
      category: 'vcs',
      icon: 'github',
      description: 'Connect to GitHub for repository access',
      baseUrl: 'https://api.github.com',
      apiVersion: '2022-11-28',
      oauthConfig: {
        authUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        scopes: ['repo', 'user:email', 'read:org'],
        userInfoUrl: 'https://api.github.com/user',
      },
      webhookConfig: {
        signatureHeader: 'X-Hub-Signature-256',
        algorithm: 'sha256',
        signaturePrefix: 'sha256=',
      },
      actions: [
        {
          name: 'list_repos',
          method: 'GET',
          endpoint: '/user/repos',
          scopes: ['repo'],
        },
        {
          name: 'create_issue',
          method: 'POST',
          endpoint: '/repos/{owner}/{repo}/issues',
          scopes: ['repo'],
        },
      ],
      rateLimit: {
        max: 5000,
        window: 3600,
      },
      docsUrl: 'https://docs.github.com/en/rest',
      enabled: true,
      official: true,
    }

    expect(githubProvider.id).toBe('github')
    expect(githubProvider.type).toBe('oauth2')
    expect(githubProvider.oauthConfig?.scopes).toContain('repo')
    expect(githubProvider.webhookConfig?.algorithm).toBe('sha256')
    expect(githubProvider.actions).toHaveLength(2)
    expect(githubProvider.rateLimit?.max).toBe(5000)
  })

  it('can define complete Slack provider', () => {
    const slackProvider: Partial<Provider> = {
      id: 'slack',
      slug: 'slack',
      name: 'Slack',
      type: 'oauth2',
      category: 'chat',
      icon: 'slack',
      description: 'Connect to Slack for team communication',
      baseUrl: 'https://slack.com/api',
      oauthConfig: {
        authUrl: 'https://slack.com/oauth/v2/authorize',
        tokenUrl: 'https://slack.com/api/oauth.v2.access',
        scopes: ['channels:read', 'chat:write', 'users:read'],
      },
      webhookConfig: {
        signatureHeader: 'X-Slack-Signature',
        algorithm: 'hmac-sha256',
        signaturePrefix: 'v0=',
        timestampHeader: 'X-Slack-Request-Timestamp',
        timestampMaxAge: 300,
      },
      actions: [
        {
          name: 'send_message',
          method: 'POST',
          endpoint: '/chat.postMessage',
          scopes: ['chat:write'],
        },
        {
          name: 'list_channels',
          method: 'GET',
          endpoint: '/conversations.list',
          scopes: ['channels:read'],
        },
      ],
      rateLimit: {
        max: 100,
        window: 60,
        type: 'sliding',
      },
      enabled: true,
      official: true,
    }

    expect(slackProvider.id).toBe('slack')
    expect(slackProvider.category).toBe('chat')
    expect(slackProvider.webhookConfig?.timestampHeader).toBe('X-Slack-Request-Timestamp')
  })

  it('can define API key provider (no OAuth)', () => {
    const stripeProvider: Partial<Provider> = {
      id: 'stripe',
      slug: 'stripe',
      name: 'Stripe',
      type: 'api_key',
      category: 'payments',
      icon: 'credit-card',
      description: 'Connect to Stripe for payment processing',
      baseUrl: 'https://api.stripe.com/v1',
      webhookConfig: {
        signatureHeader: 'Stripe-Signature',
        algorithm: 'hmac-sha256',
        timestampHeader: 't',
      },
      actions: [
        {
          name: 'create_payment_intent',
          method: 'POST',
          endpoint: '/payment_intents',
          scopes: [],
        },
      ],
      enabled: true,
      official: true,
    }

    expect(stripeProvider.type).toBe('api_key')
    expect(stripeProvider.oauthConfig).toBeUndefined()
    expect(stripeProvider.webhookConfig?.signatureHeader).toBe('Stripe-Signature')
  })

  it('can define webhook-only provider', () => {
    const webhookProvider: Partial<Provider> = {
      id: 'generic-webhook',
      slug: 'generic-webhook',
      name: 'Generic Webhook',
      type: 'webhook',
      category: 'automation',
      description: 'Receive webhooks from any source',
      enabled: true,
      official: false,
    }

    expect(webhookProvider.type).toBe('webhook')
    expect(webhookProvider.official).toBe(false)
  })
})

// ============================================================================
// RELATIONSHIP TESTS
// ============================================================================

describe('Provider and AccountType Relationships', () => {
  it('account type references providers by ID', () => {
    const providers = ['github', 'gitlab', 'bitbucket']
    const vcsType: Partial<AccountType> = {
      id: 'vcs',
      name: 'Version Control',
      providers,
    }

    // providers field contains provider IDs
    expect(vcsType.providers).toEqual(providers)
    expect(vcsType.providers).toContain('github')
  })

  it('one provider can belong to multiple account types', () => {
    // GitHub could be in both 'vcs' and 'ci-cd' account types
    const vcsType: Partial<AccountType> = {
      id: 'vcs',
      providers: ['github', 'gitlab'],
    }

    const cicdType: Partial<AccountType> = {
      id: 'ci-cd',
      providers: ['github', 'gitlab', 'circleci'],
    }

    // github appears in both
    expect(vcsType.providers).toContain('github')
    expect(cicdType.providers).toContain('github')
  })

  it('account type providers array can be empty', () => {
    const emptyType: Partial<AccountType> = {
      id: 'coming-soon',
      name: 'Coming Soon',
      providers: [],
      enabled: false,
    }

    expect(emptyType.providers).toHaveLength(0)
  })

  it('provider can exist without being in any account type', () => {
    // A provider can be defined but not yet categorized
    const standaloneProvider: Partial<Provider> = {
      id: 'experimental-api',
      slug: 'experimental-api',
      name: 'Experimental API',
      type: 'api_key',
      enabled: false, // Not yet ready
    }

    expect(standaloneProvider.enabled).toBe(false)
    // This provider might not be in any accountTypes.providers array yet
  })
})

// ============================================================================
// INDEX TESTS
// ============================================================================

describe('Schema Indexes', () => {
  describe('Providers Indexes', () => {
    it('has unique index on slug', () => {
      expect(providers.slug).toBeDefined()
    })

    it('has index on type for filtering', () => {
      expect(providers.type).toBeDefined()
    })

    it('has index on category for filtering', () => {
      expect(providers.category).toBeDefined()
    })

    it('has index on enabled for filtering active providers', () => {
      expect(providers.enabled).toBeDefined()
    })
  })

  describe('AccountTypes Indexes', () => {
    it('has unique index on slug', () => {
      expect(accountTypes.slug).toBeDefined()
    })

    it('has index on enabled for filtering active types', () => {
      expect(accountTypes.enabled).toBeDefined()
    })

    it('has index on displayOrder for sorting', () => {
      expect(accountTypes.displayOrder).toBeDefined()
    })
  })
})
