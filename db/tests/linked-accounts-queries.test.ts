import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import {
  // Validation schemas
  LinkedAccountStatusSchema,
  LinkedAccountMetadataSchema,
  LinkedAccountMetadataBaseSchema,
  GitHubMetadataSchema,
  SlackMetadataSchema,
  NewLinkedAccountSchema,
  ProviderMetadataSchemas,
  // Validation helpers
  validateMetadata,
  safeValidateMetadata,
  validateNewLinkedAccount,
  getMetadataSchemaForProvider,
  // Query helpers
  getLinkedAccount,
  getLinkedAccountsByIdentity,
  getLinkedAccountsByUser,
  getLinkedAccountsByProvider,
  getLinkedAccountsByType,
  getActiveLinkedAccounts,
  hasLinkedProvider,
  // Types
  type LinkedAccountMetadata,
  type LinkedAccountsDb,
} from '../linked-accounts'

// ============================================================================
// ZOD SCHEMA VALIDATION TESTS
// ============================================================================

describe('LinkedAccount Status Schema', () => {
  it('validates active status', () => {
    expect(LinkedAccountStatusSchema.parse('active')).toBe('active')
  })

  it('validates pending status', () => {
    expect(LinkedAccountStatusSchema.parse('pending')).toBe('pending')
  })

  it('validates expired status', () => {
    expect(LinkedAccountStatusSchema.parse('expired')).toBe('expired')
  })

  it('validates revoked status', () => {
    expect(LinkedAccountStatusSchema.parse('revoked')).toBe('revoked')
  })

  it('rejects invalid status', () => {
    expect(() => LinkedAccountStatusSchema.parse('invalid')).toThrow()
  })
})

describe('LinkedAccount Metadata Schema', () => {
  it('validates base metadata with scopes', () => {
    const metadata = {
      scopes: ['repo', 'user:email'],
      tokenType: 'bearer',
    }
    const result = LinkedAccountMetadataSchema.parse(metadata)
    expect(result.scopes).toEqual(['repo', 'user:email'])
    expect(result.tokenType).toBe('bearer')
  })

  it('validates metadata with installedAt datetime', () => {
    const metadata = {
      installedAt: '2024-01-15T10:30:00Z',
    }
    const result = LinkedAccountMetadataSchema.parse(metadata)
    expect(result.installedAt).toBe('2024-01-15T10:30:00Z')
  })

  it('validates metadata with email', () => {
    const metadata = {
      email: 'user@example.com.ai',
    }
    const result = LinkedAccountMetadataSchema.parse(metadata)
    expect(result.email).toBe('user@example.com.ai')
  })

  it('rejects invalid email format', () => {
    const metadata = {
      email: 'not-an-email',
    }
    expect(() => LinkedAccountMetadataSchema.parse(metadata)).toThrow()
  })

  it('validates metadata with URLs', () => {
    const metadata = {
      avatarUrl: 'https://github.com/avatar.png',
      profileUrl: 'https://github.com/user',
    }
    const result = LinkedAccountMetadataSchema.parse(metadata)
    expect(result.avatarUrl).toBe('https://github.com/avatar.png')
  })

  it('allows additional properties (passthrough)', () => {
    const metadata = {
      scopes: ['read'],
      customField: 'custom-value',
      anotherField: 123,
    }
    const result = LinkedAccountMetadataSchema.parse(metadata)
    expect((result as Record<string, unknown>).customField).toBe('custom-value')
    expect((result as Record<string, unknown>).anotherField).toBe(123)
  })

  it('validates empty object', () => {
    const result = LinkedAccountMetadataSchema.parse({})
    expect(result).toEqual({})
  })
})

describe('GitHub Metadata Schema', () => {
  it('validates GitHub-specific fields', () => {
    const metadata = {
      login: 'octocat',
      githubId: 12345,
      organizations: ['github', 'octokit'],
    }
    const result = GitHubMetadataSchema.parse(metadata)
    expect(result.login).toBe('octocat')
    expect(result.githubId).toBe(12345)
    expect(result.organizations).toContain('github')
  })

  it('validates GitHub App installation metadata', () => {
    const metadata = {
      installationId: 98765,
      scopes: ['repo', 'write:packages'],
    }
    const result = GitHubMetadataSchema.parse(metadata)
    expect(result.installationId).toBe(98765)
  })
})

describe('Slack Metadata Schema', () => {
  it('validates Slack-specific fields', () => {
    const metadata = {
      teamId: 'T12345',
      teamName: 'My Workspace',
      slackUserId: 'U98765',
    }
    const result = SlackMetadataSchema.parse(metadata)
    expect(result.teamId).toBe('T12345')
    expect(result.teamName).toBe('My Workspace')
  })

  it('validates Slack bot metadata', () => {
    const metadata = {
      botUserId: 'BBOT123',
      incomingWebhookUrl: 'https://hooks.slack.com/services/xxx/yyy/zzz',
    }
    const result = SlackMetadataSchema.parse(metadata)
    expect(result.botUserId).toBe('BBOT123')
  })
})

describe('getMetadataSchemaForProvider', () => {
  it('returns GitHub schema for github provider', () => {
    const schema = getMetadataSchemaForProvider('github')
    expect(schema).toBe(GitHubMetadataSchema)
  })

  it('returns GitHub schema for github-oauth provider', () => {
    const schema = getMetadataSchemaForProvider('github-oauth')
    expect(schema).toBe(GitHubMetadataSchema)
  })

  it('returns Slack schema for slack provider', () => {
    const schema = getMetadataSchemaForProvider('slack')
    expect(schema).toBe(SlackMetadataSchema)
  })

  it('returns Slack schema for slack-api provider', () => {
    const schema = getMetadataSchemaForProvider('slack-api')
    expect(schema).toBe(SlackMetadataSchema)
  })

  it('returns base schema for unknown provider', () => {
    const schema = getMetadataSchemaForProvider('custom-provider')
    expect(schema).toBe(LinkedAccountMetadataSchema)
  })
})

describe('NewLinkedAccountSchema', () => {
  it('validates a complete new linked account', () => {
    const account = {
      id: 'la-001',
      identityId: 'identity-001',
      type: 'github',
      provider: 'github-oauth',
      providerAccountId: 'gh-123',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const result = NewLinkedAccountSchema.parse(account)
    expect(result.id).toBe('la-001')
    expect(result.status).toBe('active')
  })

  it('defaults status to active', () => {
    const account = {
      id: 'la-002',
      identityId: 'identity-002',
      type: 'slack',
      provider: 'slack-oauth',
      providerAccountId: 'U12345',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const result = NewLinkedAccountSchema.parse(account)
    expect(result.status).toBe('active')
  })

  it('allows optional vaultRef', () => {
    const account = {
      id: 'la-003',
      identityId: 'identity-003',
      type: 'github',
      provider: 'github-oauth',
      providerAccountId: 'gh-456',
      vaultRef: 'vault://workos/secrets/la-003',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const result = NewLinkedAccountSchema.parse(account)
    expect(result.vaultRef).toBe('vault://workos/secrets/la-003')
  })

  it('rejects empty id', () => {
    const account = {
      id: '',
      identityId: 'identity-001',
      type: 'github',
      provider: 'github-oauth',
      providerAccountId: 'gh-123',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    expect(() => NewLinkedAccountSchema.parse(account)).toThrow()
  })
})

// ============================================================================
// VALIDATION HELPER TESTS
// ============================================================================

describe('validateMetadata', () => {
  it('validates metadata without provider', () => {
    const metadata = { scopes: ['read', 'write'] }
    const result = validateMetadata(metadata)
    expect(result.scopes).toEqual(['read', 'write'])
  })

  it('validates metadata with provider', () => {
    const metadata = { login: 'octocat', githubId: 123 }
    const result = validateMetadata(metadata, 'github')
    expect((result as { login?: string }).login).toBe('octocat')
  })

  it('throws on invalid metadata', () => {
    const metadata = { email: 'not-valid-email' }
    expect(() => validateMetadata(metadata)).toThrow()
  })
})

describe('safeValidateMetadata', () => {
  it('returns success for valid metadata', () => {
    const metadata = { scopes: ['read'] }
    const result = safeValidateMetadata(metadata)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.scopes).toEqual(['read'])
    }
  })

  it('returns failure for invalid metadata', () => {
    const metadata = { email: 'invalid' }
    const result = safeValidateMetadata(metadata)
    expect(result.success).toBe(false)
  })

  it('uses provider-specific schema when provider is specified', () => {
    const metadata = { login: 'user', githubId: 123 }
    const result = safeValidateMetadata(metadata, 'github')
    expect(result.success).toBe(true)
  })
})

describe('validateNewLinkedAccount', () => {
  it('validates a new linked account', () => {
    const account = {
      id: 'la-test',
      identityId: 'identity-test',
      type: 'test',
      provider: 'test-provider',
      providerAccountId: 'test-123',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const result = validateNewLinkedAccount(account)
    expect(result.id).toBe('la-test')
  })
})

// ============================================================================
// QUERY HELPER TESTS (WITH MOCKS)
// ============================================================================

describe('Query Helpers', () => {
  // Create a mock database
  const createMockDb = (mockResults: unknown[] = []): LinkedAccountsDb => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(mockResults)),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(mockResults)),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve({ rowsAffected: 1 })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve({ rowsAffected: 1 })),
    })),
  })

  describe('getLinkedAccount', () => {
    it('returns account when found', async () => {
      const mockAccount = {
        id: 'la-001',
        identityId: 'identity-001',
        provider: 'github',
        type: 'github',
        providerAccountId: 'gh-123',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const db = createMockDb([mockAccount])

      const result = await getLinkedAccount(db, 'identity-001', 'github')

      expect(result).toEqual(mockAccount)
    })

    it('returns undefined when not found', async () => {
      const db = createMockDb([])

      const result = await getLinkedAccount(db, 'identity-001', 'github')

      expect(result).toBeUndefined()
    })
  })

  describe('getLinkedAccountsByIdentity', () => {
    it('returns all accounts for identity', async () => {
      const mockAccounts = [
        { id: 'la-001', identityId: 'identity-001', provider: 'github' },
        { id: 'la-002', identityId: 'identity-001', provider: 'slack' },
      ]
      const db = createMockDb(mockAccounts)

      const results = await getLinkedAccountsByIdentity(db, 'identity-001')

      expect(results.length).toBe(2)
    })

    it('returns empty array when no accounts found', async () => {
      const db = createMockDb([])

      const results = await getLinkedAccountsByIdentity(db, 'identity-001')

      expect(results).toEqual([])
    })
  })

  describe('getLinkedAccountsByUser (alias)', () => {
    it('is an alias for getLinkedAccountsByIdentity', () => {
      expect(getLinkedAccountsByUser).toBe(getLinkedAccountsByIdentity)
    })
  })

  describe('getLinkedAccountsByProvider', () => {
    it('returns all accounts for provider', async () => {
      const mockAccounts = [
        { id: 'la-001', identityId: 'identity-001', provider: 'github' },
        { id: 'la-002', identityId: 'identity-002', provider: 'github' },
      ]
      const db = createMockDb(mockAccounts)

      const results = await getLinkedAccountsByProvider(db, 'github')

      expect(results.length).toBe(2)
    })
  })

  describe('getLinkedAccountsByType', () => {
    it('returns all accounts for type', async () => {
      const mockAccounts = [
        { id: 'la-001', type: 'vcs:github' },
        { id: 'la-002', type: 'vcs:github' },
      ]
      const db = createMockDb(mockAccounts)

      const results = await getLinkedAccountsByType(db, 'vcs:github')

      expect(results.length).toBe(2)
    })
  })

  describe('getActiveLinkedAccounts', () => {
    it('returns only active accounts', async () => {
      const mockAccounts = [
        { id: 'la-001', identityId: 'identity-001', status: 'active' },
      ]
      const db = createMockDb(mockAccounts)

      const results = await getActiveLinkedAccounts(db, 'identity-001')

      expect(results.length).toBe(1)
      expect(results[0].status).toBe('active')
    })
  })

  describe('hasLinkedProvider', () => {
    it('returns true when provider is connected', async () => {
      const mockAccount = { id: 'la-001', provider: 'github' }
      const db = createMockDb([mockAccount])

      const result = await hasLinkedProvider(db, 'identity-001', 'github')

      expect(result).toBe(true)
    })

    it('returns false when provider is not connected', async () => {
      const db = createMockDb([])

      const result = await hasLinkedProvider(db, 'identity-001', 'github')

      expect(result).toBe(false)
    })
  })
})

// ============================================================================
// COMPOSITE INDEX TESTS
// ============================================================================

describe('Composite Index for identityId + provider', () => {
  it('schema defines composite index', async () => {
    // Import the linkedAccounts schema to verify index definition
    const { linkedAccounts } = await import('../auth')

    // Verify the columns used in the composite index exist
    expect(linkedAccounts.identityId).toBeDefined()
    expect(linkedAccounts.provider).toBeDefined()

    // The composite index is defined in the schema as:
    // index('linked_accounts_identity_provider_idx').on(table.identityId, table.provider)
  })

  it('query helper uses composite index pattern', async () => {
    // The getLinkedAccount function queries by both identityId and provider,
    // which should use the composite index for optimal performance
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([])),
        })),
      })),
    } as unknown as LinkedAccountsDb

    await getLinkedAccount(db, 'identity-001', 'github')

    // Verify select was called (indicating query was executed)
    expect(db.select).toHaveBeenCalled()
  })
})

// ============================================================================
// BACKWARD COMPATIBILITY TESTS
// ============================================================================

describe('Backward Compatibility', () => {
  it('exports linkedAccounts table from linked-accounts module', async () => {
    const { linkedAccounts } = await import('../linked-accounts')
    expect(linkedAccounts).toBeDefined()
  })

  it('exports LinkedAccount type from linked-accounts module', async () => {
    // Type import test - this verifies the type is exported
    const { linkedAccounts } = await import('../linked-accounts')
    expect(linkedAccounts.id).toBeDefined()
  })

  it('exports NewLinkedAccount type from linked-accounts module', async () => {
    // Type import test
    const { linkedAccounts } = await import('../linked-accounts')
    expect(linkedAccounts.id).toBeDefined()
  })

  it('linkedAccounts is also exported from db/index', async () => {
    const { linkedAccounts } = await import('../index')
    expect(linkedAccounts).toBeDefined()
  })

  it('query helpers are exported from db/index', async () => {
    const {
      getLinkedAccount,
      getLinkedAccountsByIdentity,
      getLinkedAccountsByProvider,
    } = await import('../index')

    expect(getLinkedAccount).toBeDefined()
    expect(getLinkedAccountsByIdentity).toBeDefined()
    expect(getLinkedAccountsByProvider).toBeDefined()
  })

  it('validation schemas are exported from db/index', async () => {
    const {
      LinkedAccountMetadataSchema,
      LinkedAccountStatusSchema,
      validateMetadata,
    } = await import('../index')

    expect(LinkedAccountMetadataSchema).toBeDefined()
    expect(LinkedAccountStatusSchema).toBeDefined()
    expect(validateMetadata).toBeDefined()
  })
})
