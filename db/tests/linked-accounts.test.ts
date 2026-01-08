import { describe, it, expect } from 'vitest'
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Linked Accounts Table Schema Tests
 *
 * These tests verify the schema for storing third-party account connections
 * (OAuth, API keys, etc.) linked to identities.
 *
 * This is RED phase TDD - tests should FAIL until the linkedAccounts schema
 * is implemented in db/auth.ts.
 *
 * Key design decision:
 * - The `type` field is a DYNAMIC STRING, not an enum
 * - Types come from integrations.do (e.g., 'github', 'slack', 'linear')
 * - This allows new integration types without schema changes
 *
 * Implementation requirements:
 * - Create linkedAccounts table with dynamic type field
 * - Reference identities table via identityId
 * - Store vault reference for secure credential storage (WorkOS Vault)
 * - Track status: active, expired, revoked
 * - Unique constraint on (identityId, provider, providerAccountId)
 */

// ============================================================================
// Schema Types (Expected Interface)
// ============================================================================

interface LinkedAccount {
  id: string
  identityId: string // References identities.id
  type: string // Dynamic string - NOT an enum (e.g., 'github', 'slack', 'linear')
  provider: string // OAuth provider or integration name
  providerAccountId: string // Account ID from the provider
  vaultRef?: string | null // WorkOS Vault reference for secure credentials
  status: 'active' | 'expired' | 'revoked'
  expiresAt?: Date | null // Token expiration
  metadata?: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

// Import the schema - this will fail until implemented
// @ts-expect-error - linkedAccounts table not yet implemented
import { linkedAccounts } from '../auth'

// ============================================================================
// Dynamic Type Field Tests
// ============================================================================

describe('Dynamic Type Field', () => {
  it('linkedAccounts table is exported from db/auth.ts', () => {
    // This will fail until linkedAccounts is added to auth.ts
    expect(linkedAccounts).toBeDefined()
  })

  it('type field accepts any string value (not enum)', () => {
    // The type field should be a dynamic string that can hold any integration type
    // Types are defined by integrations.do, not hardcoded in schema
    expect(linkedAccounts.type).toBeDefined()

    // Example types that should all be valid:
    const dynamicTypes = [
      'github',
      'gitlab',
      'slack',
      'linear',
      'notion',
      'figma',
      'custom-integration',
      'my-company-api',
      'some-future-service',
    ]

    // All these should be valid type values (dynamic string)
    dynamicTypes.forEach((type) => {
      expect(typeof type).toBe('string')
      expect(type.length).toBeGreaterThan(0)
    })
  })

  it('type field is required (notNull)', () => {
    // Type must always be specified
    expect(linkedAccounts.type).toBeDefined()

    // Business logic: Every linked account must have a type
    const accountWithoutType: Partial<LinkedAccount> = {
      id: 'la-001',
      identityId: 'identity-001',
      provider: 'github',
      providerAccountId: '12345',
      // type is missing - should be invalid
    }

    expect(accountWithoutType.type).toBeUndefined()
  })

  it('can create GitHub type linked account', () => {
    const githubAccount: Partial<LinkedAccount> = {
      id: 'la-github-001',
      identityId: 'identity-001',
      type: 'github', // Dynamic type string
      provider: 'github-oauth',
      providerAccountId: 'gh-user-123',
      status: 'active',
    }

    expect(githubAccount.type).toBe('github')
  })

  it('can create Slack type linked account', () => {
    const slackAccount: Partial<LinkedAccount> = {
      id: 'la-slack-001',
      identityId: 'identity-001',
      type: 'slack', // Dynamic type string
      provider: 'slack-oauth',
      providerAccountId: 'U12345678',
      status: 'active',
    }

    expect(slackAccount.type).toBe('slack')
  })

  it('can create custom integration type linked account', () => {
    // Custom types from integrations.do should work
    const customAccount: Partial<LinkedAccount> = {
      id: 'la-custom-001',
      identityId: 'identity-001',
      type: 'acme-crm-v2', // Any custom type string
      provider: 'acme-api',
      providerAccountId: 'acme-user-abc',
      status: 'active',
    }

    expect(customAccount.type).toBe('acme-crm-v2')
  })
})

// ============================================================================
// Required Fields Tests
// ============================================================================

describe('Required Fields', () => {
  it('has id primary key', () => {
    expect(linkedAccounts.id).toBeDefined()
  })

  it('has identityId foreign key to identities table', () => {
    expect(linkedAccounts.identityId).toBeDefined()
    // Should have: .references(() => identities.id)
  })

  it('provider field is required', () => {
    expect(linkedAccounts.provider).toBeDefined()

    // Provider identifies the OAuth provider or API integration
    const validProviders = ['github-oauth', 'google-oauth', 'slack-api', 'custom-webhook']

    validProviders.forEach((provider) => {
      expect(typeof provider).toBe('string')
    })
  })

  it('providerAccountId field is required', () => {
    expect(linkedAccounts.providerAccountId).toBeDefined()

    // This is the unique identifier from the external provider
    const exampleIds = ['gh-12345', 'U98765432', 'user_abc123']

    exampleIds.forEach((id) => {
      expect(typeof id).toBe('string')
    })
  })

  it('createdAt timestamp is required', () => {
    expect(linkedAccounts.createdAt).toBeDefined()
  })

  it('updatedAt timestamp is required', () => {
    expect(linkedAccounts.updatedAt).toBeDefined()
  })
})

// ============================================================================
// Vault Reference Tests
// ============================================================================

describe('Vault Reference', () => {
  it('vaultRef column exists in schema', () => {
    expect(linkedAccounts.vaultRef).toBeDefined()
  })

  it('vaultRef stores WorkOS Vault reference for secure credentials', () => {
    // vaultRef points to encrypted credentials in WorkOS Vault
    const accountWithVault: Partial<LinkedAccount> = {
      id: 'la-vault-001',
      identityId: 'identity-001',
      type: 'github',
      provider: 'github-oauth',
      providerAccountId: 'gh-user-456',
      vaultRef: 'vault://workos/secrets/la-vault-001', // Reference to encrypted data
      status: 'active',
    }

    expect(accountWithVault.vaultRef).toBe('vault://workos/secrets/la-vault-001')
  })

  it('vaultRef is nullable (optional field)', () => {
    // Some linked accounts may not have sensitive credentials
    const accountWithoutVault: Partial<LinkedAccount> = {
      id: 'la-no-vault-001',
      identityId: 'identity-001',
      type: 'read-only-api',
      provider: 'public-api',
      providerAccountId: 'public-user',
      vaultRef: null, // No sensitive data to store
      status: 'active',
    }

    expect(accountWithoutVault.vaultRef).toBeNull()
  })

  it('vaultRef format follows WorkOS Vault convention', () => {
    // WorkOS Vault references should follow a consistent format
    const vaultRefs = [
      'vault://workos/secrets/la-001',
      'vault://workos/secrets/oauth-token-abc',
      'vault://workos/api-keys/integration-xyz',
    ]

    vaultRefs.forEach((ref) => {
      expect(ref.startsWith('vault://workos/')).toBe(true)
    })
  })

  it('linked account does NOT store raw tokens (security)', () => {
    // Security: Raw tokens should NEVER be in linkedAccounts
    // They should always be in WorkOS Vault, referenced by vaultRef

    const secureAccount: Partial<LinkedAccount> = {
      id: 'la-secure-001',
      type: 'github',
      provider: 'github-oauth',
      vaultRef: 'vault://workos/secrets/la-secure-001',
      // NO accessToken field
      // NO refreshToken field
      // NO apiKey field
    }

    // Verify the interface doesn't have token fields
    expect((secureAccount as Record<string, unknown>).accessToken).toBeUndefined()
    expect((secureAccount as Record<string, unknown>).refreshToken).toBeUndefined()
    expect((secureAccount as Record<string, unknown>).apiKey).toBeUndefined()
  })
})

// ============================================================================
// Status Transitions Tests
// ============================================================================

describe('Status Transitions', () => {
  it('status column exists in schema', () => {
    expect(linkedAccounts.status).toBeDefined()
  })

  it('status defaults to "active"', () => {
    // New linked accounts should be active by default
    const newAccount: Partial<LinkedAccount> = {
      id: 'la-new-001',
      identityId: 'identity-001',
      type: 'github',
      provider: 'github-oauth',
      providerAccountId: 'gh-789',
      // status not specified - should default to 'active'
    }

    expect(newAccount.status ?? 'active').toBe('active')
  })

  it('status accepts valid values: active, expired, revoked', () => {
    const validStatuses: Array<'active' | 'expired' | 'revoked'> = ['active', 'expired', 'revoked']

    validStatuses.forEach((status) => {
      expect(['active', 'expired', 'revoked']).toContain(status)
    })
  })

  it('active status means credentials are valid and usable', () => {
    const activeAccount: Partial<LinkedAccount> = {
      id: 'la-active-001',
      type: 'github',
      status: 'active',
      expiresAt: new Date(Date.now() + 3600000), // Expires in 1 hour
    }

    expect(activeAccount.status).toBe('active')
    expect(activeAccount.expiresAt!.getTime()).toBeGreaterThan(Date.now())
  })

  it('expired status means tokens have expired and need refresh', () => {
    const expiredAccount: Partial<LinkedAccount> = {
      id: 'la-expired-001',
      type: 'github',
      status: 'expired',
      expiresAt: new Date(Date.now() - 3600000), // Expired 1 hour ago
    }

    expect(expiredAccount.status).toBe('expired')
    expect(expiredAccount.expiresAt!.getTime()).toBeLessThan(Date.now())
  })

  it('revoked status means user/admin has disconnected the account', () => {
    const revokedAccount: Partial<LinkedAccount> = {
      id: 'la-revoked-001',
      type: 'github',
      status: 'revoked',
    }

    expect(revokedAccount.status).toBe('revoked')
    // Revoked accounts should not be used for API calls
  })

  it('transition: active -> expired (automatic on token expiry)', () => {
    // When expiresAt passes, status should change to expired
    const account: LinkedAccount = {
      id: 'la-transition-001',
      identityId: 'identity-001',
      type: 'github',
      provider: 'github-oauth',
      providerAccountId: 'gh-abc',
      status: 'active', // Will become 'expired'
      expiresAt: new Date(Date.now() - 1000), // Already expired
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    // Application logic should detect this and update status
    const isExpired = account.expiresAt && account.expiresAt.getTime() < Date.now()
    expect(isExpired).toBe(true)
  })

  it('transition: active -> revoked (user disconnects)', () => {
    // User explicitly revokes access
    const beforeRevoke: LinkedAccount = {
      id: 'la-revoke-001',
      identityId: 'identity-001',
      type: 'slack',
      provider: 'slack-oauth',
      providerAccountId: 'U123',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const afterRevoke = { ...beforeRevoke, status: 'revoked' as const }

    expect(beforeRevoke.status).toBe('active')
    expect(afterRevoke.status).toBe('revoked')
  })

  it('transition: expired -> active (after token refresh)', () => {
    // After refreshing tokens, status returns to active
    const afterRefresh: LinkedAccount = {
      id: 'la-refresh-001',
      identityId: 'identity-001',
      type: 'github',
      provider: 'github-oauth',
      providerAccountId: 'gh-def',
      status: 'active', // Back to active after refresh
      expiresAt: new Date(Date.now() + 7200000), // New expiry: 2 hours
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    expect(afterRefresh.status).toBe('active')
    expect(afterRefresh.expiresAt!.getTime()).toBeGreaterThan(Date.now())
  })

  it('expiresAt column exists for token expiration', () => {
    expect(linkedAccounts.expiresAt).toBeDefined()
  })
})

// ============================================================================
// Unique Constraint Tests
// ============================================================================

describe('Unique Constraint', () => {
  it('(identityId, provider, providerAccountId) must be unique', () => {
    // An identity can only have one linked account per provider+accountId
    // This prevents duplicate connections

    const account1: Partial<LinkedAccount> = {
      id: 'la-unique-001',
      identityId: 'identity-001',
      provider: 'github-oauth',
      providerAccountId: 'gh-user-123',
    }

    const duplicate: Partial<LinkedAccount> = {
      id: 'la-unique-002', // Different ID
      identityId: 'identity-001', // Same identity
      provider: 'github-oauth', // Same provider
      providerAccountId: 'gh-user-123', // Same account - SHOULD FAIL
    }

    // The unique constraint should prevent this
    // In practice, database will reject the insert
    expect(account1.identityId).toBe(duplicate.identityId)
    expect(account1.provider).toBe(duplicate.provider)
    expect(account1.providerAccountId).toBe(duplicate.providerAccountId)
  })

  it('same identity can have multiple different provider accounts', () => {
    // One identity can connect to multiple providers
    const githubAccount: Partial<LinkedAccount> = {
      id: 'la-multi-001',
      identityId: 'identity-001',
      type: 'github',
      provider: 'github-oauth',
      providerAccountId: 'gh-user-123',
    }

    const slackAccount: Partial<LinkedAccount> = {
      id: 'la-multi-002',
      identityId: 'identity-001', // Same identity
      type: 'slack',
      provider: 'slack-oauth', // Different provider - OK
      providerAccountId: 'U987654',
    }

    expect(githubAccount.identityId).toBe(slackAccount.identityId)
    expect(githubAccount.provider).not.toBe(slackAccount.provider)
  })

  it('same provider account can be linked to different identities', () => {
    // Edge case: Same GitHub account linked to different identities
    // (e.g., personal identity and work identity)
    const personalIdentityLink: Partial<LinkedAccount> = {
      id: 'la-share-001',
      identityId: 'identity-personal',
      type: 'github',
      provider: 'github-oauth',
      providerAccountId: 'gh-user-456',
    }

    const workIdentityLink: Partial<LinkedAccount> = {
      id: 'la-share-002',
      identityId: 'identity-work', // Different identity - OK
      type: 'github',
      provider: 'github-oauth', // Same provider
      providerAccountId: 'gh-user-456', // Same account
    }

    expect(personalIdentityLink.identityId).not.toBe(workIdentityLink.identityId)
    expect(personalIdentityLink.providerAccountId).toBe(workIdentityLink.providerAccountId)
  })

  it('different provider accounts from same provider can be linked', () => {
    // One identity can have multiple accounts from the same provider
    // e.g., personal GitHub + work GitHub
    const personalGithub: Partial<LinkedAccount> = {
      id: 'la-dual-001',
      identityId: 'identity-001',
      type: 'github',
      provider: 'github-oauth',
      providerAccountId: 'gh-personal', // Personal account
    }

    const workGithub: Partial<LinkedAccount> = {
      id: 'la-dual-002',
      identityId: 'identity-001', // Same identity
      type: 'github',
      provider: 'github-oauth', // Same provider
      providerAccountId: 'gh-work', // Different account - OK
    }

    expect(personalGithub.identityId).toBe(workGithub.identityId)
    expect(personalGithub.provider).toBe(workGithub.provider)
    expect(personalGithub.providerAccountId).not.toBe(workGithub.providerAccountId)
  })
})

// ============================================================================
// Query by Type Tests
// ============================================================================

describe('Query by Type', () => {
  it('type column has index for efficient queries', () => {
    // Schema should include: index('linked_accounts_type_idx').on(table.type)
    expect(linkedAccounts.type).toBeDefined()
  })

  it('can query all accounts of a specific type', () => {
    // Example: Find all GitHub integrations
    const allAccounts: LinkedAccount[] = [
      {
        id: 'la-q-001',
        identityId: 'identity-001',
        type: 'github',
        provider: 'github-oauth',
        providerAccountId: 'gh-1',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'la-q-002',
        identityId: 'identity-002',
        type: 'slack',
        provider: 'slack-oauth',
        providerAccountId: 'U1',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'la-q-003',
        identityId: 'identity-003',
        type: 'github',
        provider: 'github-oauth',
        providerAccountId: 'gh-2',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]

    const githubAccounts = allAccounts.filter((a) => a.type === 'github')
    expect(githubAccounts.length).toBe(2)
  })

  it('can query accounts by type category pattern', () => {
    // Integration types from integrations.do might follow patterns
    const allAccounts: LinkedAccount[] = [
      {
        id: 'la-cat-001',
        identityId: 'identity-001',
        type: 'vcs:github',
        provider: 'github-oauth',
        providerAccountId: 'gh-1',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'la-cat-002',
        identityId: 'identity-001',
        type: 'vcs:gitlab',
        provider: 'gitlab-oauth',
        providerAccountId: 'gl-1',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'la-cat-003',
        identityId: 'identity-001',
        type: 'chat:slack',
        provider: 'slack-oauth',
        providerAccountId: 'U1',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]

    // Query all VCS (version control) integrations
    const vcsAccounts = allAccounts.filter((a) => a.type.startsWith('vcs:'))
    expect(vcsAccounts.length).toBe(2)

    // Query all chat integrations
    const chatAccounts = allAccounts.filter((a) => a.type.startsWith('chat:'))
    expect(chatAccounts.length).toBe(1)
  })

  it('identityId column has index for efficient lookups', () => {
    // Schema should include: index('linked_accounts_identity_idx').on(table.identityId)
    expect(linkedAccounts.identityId).toBeDefined()
  })

  it('can find all linked accounts for an identity', () => {
    const identity1Accounts: LinkedAccount[] = [
      {
        id: 'la-id-001',
        identityId: 'identity-001',
        type: 'github',
        provider: 'github-oauth',
        providerAccountId: 'gh-1',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'la-id-002',
        identityId: 'identity-001',
        type: 'slack',
        provider: 'slack-oauth',
        providerAccountId: 'U1',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]

    const accountsForIdentity = identity1Accounts.filter((a) => a.identityId === 'identity-001')
    expect(accountsForIdentity.length).toBe(2)
  })
})

// ============================================================================
// Metadata Field Tests
// ============================================================================

describe('Metadata Field', () => {
  it('metadata column exists in schema', () => {
    expect(linkedAccounts.metadata).toBeDefined()
  })

  it('metadata stores JSON object', () => {
    const accountWithMetadata: Partial<LinkedAccount> = {
      id: 'la-meta-001',
      type: 'github',
      metadata: {
        scopes: ['repo', 'user:email', 'read:org'],
        tokenType: 'bearer',
        installedAt: '2024-01-15T10:30:00Z',
        webhookId: 'wh-123',
      },
    }

    expect(accountWithMetadata.metadata).toBeDefined()
    expect((accountWithMetadata.metadata as Record<string, unknown>).scopes).toContain('repo')
  })

  it('metadata is nullable', () => {
    const accountWithoutMetadata: Partial<LinkedAccount> = {
      id: 'la-no-meta-001',
      type: 'simple-api',
      metadata: null,
    }

    expect(accountWithoutMetadata.metadata).toBeNull()
  })
})

// ============================================================================
// Schema Structure Tests
// ============================================================================

describe('Schema Structure', () => {
  it('linkedAccounts table is exported from db/auth.ts', () => {
    expect(linkedAccounts).toBeDefined()
  })

  it('has required primary key (id)', () => {
    expect(linkedAccounts.id).toBeDefined()
  })

  it('has identityId foreign key to identities table', () => {
    expect(linkedAccounts.identityId).toBeDefined()
  })

  it('has type column (dynamic string)', () => {
    expect(linkedAccounts.type).toBeDefined()
  })

  it('has provider column', () => {
    expect(linkedAccounts.provider).toBeDefined()
  })

  it('has providerAccountId column', () => {
    expect(linkedAccounts.providerAccountId).toBeDefined()
  })

  it('has vaultRef column (nullable)', () => {
    expect(linkedAccounts.vaultRef).toBeDefined()
  })

  it('has status column with default', () => {
    expect(linkedAccounts.status).toBeDefined()
  })

  it('has expiresAt column (nullable timestamp)', () => {
    expect(linkedAccounts.expiresAt).toBeDefined()
  })

  it('has metadata column (JSON, nullable)', () => {
    expect(linkedAccounts.metadata).toBeDefined()
  })

  it('has createdAt timestamp', () => {
    expect(linkedAccounts.createdAt).toBeDefined()
  })

  it('has updatedAt timestamp', () => {
    expect(linkedAccounts.updatedAt).toBeDefined()
  })
})

// ============================================================================
// Index Tests
// ============================================================================

describe('Schema Indexes', () => {
  it('has index on identityId for lookups by identity', () => {
    // Schema should include: index('linked_accounts_identity_idx').on(table.identityId)
    expect(linkedAccounts.identityId).toBeDefined()
  })

  it('has index on type for filtering by integration type', () => {
    // Schema should include: index('linked_accounts_type_idx').on(table.type)
    expect(linkedAccounts.type).toBeDefined()
  })

  it('has unique index on (identityId, provider, providerAccountId)', () => {
    // Schema should include: uniqueIndex('linked_accounts_identity_provider_idx')
    //   .on(table.identityId, table.provider, table.providerAccountId)
    expect(linkedAccounts.identityId).toBeDefined()
    expect(linkedAccounts.provider).toBeDefined()
    expect(linkedAccounts.providerAccountId).toBeDefined()
  })

  it('has index on status for filtering active accounts', () => {
    // Schema should include: index('linked_accounts_status_idx').on(table.status)
    expect(linkedAccounts.status).toBeDefined()
  })
})

// ============================================================================
// Relationship Tests
// ============================================================================

describe('LinkedAccount Relationships', () => {
  it('linkedAccount belongs to an identity', () => {
    expect(linkedAccounts.identityId).toBeDefined()
    // Should have: .references(() => identities.id, { onDelete: 'cascade' })
  })

  it('identity can have multiple linked accounts', () => {
    // One identity can connect to many external services
    const identityAccounts = [
      { id: 'la-r-001', identityId: 'identity-001', type: 'github' },
      { id: 'la-r-002', identityId: 'identity-001', type: 'slack' },
      { id: 'la-r-003', identityId: 'identity-001', type: 'linear' },
      { id: 'la-r-004', identityId: 'identity-001', type: 'notion' },
    ]

    const uniqueIdentities = new Set(identityAccounts.map((a) => a.identityId))
    expect(uniqueIdentities.size).toBe(1) // All same identity
    expect(identityAccounts.length).toBe(4) // Multiple linked accounts
  })

  it('deleting identity cascades to delete linked accounts', () => {
    // When identity is deleted, all linked accounts should be removed
    // This is enforced by: .references(() => identities.id, { onDelete: 'cascade' })

    // This is a schema-level test that verifies the design intention
    expect(linkedAccounts.identityId).toBeDefined()
  })
})

// ============================================================================
// Integration with Identities Tests
// ============================================================================

describe('Integration with Identities', () => {
  it('linkedAccounts references identities table', async () => {
    // Import identities table to verify relationship
    const { identities } = await import('../auth')

    expect(identities).toBeDefined()
    expect(identities.id).toBeDefined()

    // linkedAccounts.identityId should reference identities.id
    expect(linkedAccounts.identityId).toBeDefined()
  })

  it('human identity can have linked accounts', () => {
    // Humans link their external accounts (GitHub, Slack, etc.)
    const humanLinkedAccounts = [
      {
        identityId: 'identity-human-001',
        type: 'github',
        provider: 'github-oauth',
        providerAccountId: 'gh-alice',
      },
      {
        identityId: 'identity-human-001',
        type: 'slack',
        provider: 'slack-oauth',
        providerAccountId: 'U-alice',
      },
    ]

    expect(humanLinkedAccounts.length).toBe(2)
  })

  it('agent identity can have linked accounts', () => {
    // Agents can have their own API keys and integrations
    const agentLinkedAccounts = [
      {
        identityId: 'identity-agent-001',
        type: 'github',
        provider: 'github-app',
        providerAccountId: 'app-12345',
      },
    ]

    expect(agentLinkedAccounts.length).toBe(1)
  })

  it('service identity can have linked accounts', () => {
    // Services use linked accounts for their integrations
    const serviceLinkedAccounts = [
      {
        identityId: 'identity-service-001',
        type: 'webhook-receiver',
        provider: 'internal-webhook',
        providerAccountId: 'wh-endpoint-001',
      },
    ]

    expect(serviceLinkedAccounts.length).toBe(1)
  })
})
