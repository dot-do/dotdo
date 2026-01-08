/**
 * IntegrationsDO Account Types Tests
 *
 * RED TDD: These tests should FAIL because account type methods don't exist yet.
 *
 * Account types are dynamic categories for grouping providers (devtools, crm,
 * payments, communication, productivity, storage). Each account type has
 * metadata like icon and description, and tracks which providers belong to it.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { IntegrationsDO } from '../IntegrationsDO'
import type { Provider } from '../IntegrationsDO'

// ============================================================================
// TYPE DEFINITIONS (expected interface for AccountType)
// ============================================================================

/**
 * AccountType interface representing a category of integration providers
 */
interface AccountType {
  id: string
  slug: string // 'devtools'
  name: string // 'Developer Tools'
  icon: string // 'code'
  description: string
  providers: string[] // ['github', 'gitlab', 'bitbucket']
}

// ============================================================================
// TEST DATA FIXTURES
// ============================================================================

const mockDevtoolsType: AccountType = {
  id: 'devtools',
  slug: 'devtools',
  name: 'Developer Tools',
  icon: 'code',
  description: 'Tools for software development, version control, and CI/CD',
  providers: [],
}

const mockCrmType: AccountType = {
  id: 'crm',
  slug: 'crm',
  name: 'Customer Relationship Management',
  icon: 'users',
  description: 'Customer relationship and sales management tools',
  providers: [],
}

const mockPaymentsType: AccountType = {
  id: 'payments',
  slug: 'payments',
  name: 'Payments',
  icon: 'credit-card',
  description: 'Payment processing and financial services',
  providers: [],
}

const mockCommunicationType: AccountType = {
  id: 'communication',
  slug: 'communication',
  name: 'Communication',
  icon: 'message-circle',
  description: 'Messaging, email, and communication platforms',
  providers: [],
}

const mockProductivityType: AccountType = {
  id: 'productivity',
  slug: 'productivity',
  name: 'Productivity',
  icon: 'briefcase',
  description: 'Productivity and collaboration tools',
  providers: [],
}

const mockStorageType: AccountType = {
  id: 'storage',
  slug: 'storage',
  name: 'Storage',
  icon: 'hard-drive',
  description: 'Cloud storage and file management services',
  providers: [],
}

const mockGitHubProvider: Omit<Provider, 'id'> = {
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
  actions: [],
}

const mockGitLabProvider: Omit<Provider, 'id'> = {
  slug: 'gitlab',
  name: 'GitLab',
  accountType: 'devtools',
  icon: 'https://gitlab.com/favicon.ico',
  oauthConfig: {
    authUrl: 'https://gitlab.com/oauth/authorize',
    tokenUrl: 'https://gitlab.com/oauth/token',
    scopes: ['read_user', 'api'],
    clientIdEnvVar: 'GITLAB_CLIENT_ID',
    clientSecretEnvVar: 'GITLAB_CLIENT_SECRET',
  },
  actions: [],
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
    GITLAB_CLIENT_ID: 'test-gitlab-client-id',
    GITLAB_CLIENT_SECRET: 'test-gitlab-client-secret',
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('IntegrationsDO Account Types', () => {
  let integrationsDO: InstanceType<typeof IntegrationsDO>
  let mockState: DurableObjectState
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    integrationsDO = new IntegrationsDO(mockState, mockEnv)
  })

  // ==========================================================================
  // 1. ACCOUNT TYPE CRUD OPERATIONS
  // ==========================================================================

  describe('Account Type CRUD', () => {
    describe('registerAccountType', () => {
      it('can register a new account type', async () => {
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        const result = await integrationsDO.registerAccountType(mockDevtoolsType)

        expect(result).toBeDefined()
        expect(result.id).toBe('devtools')
        expect(result.slug).toBe('devtools')
        expect(result.name).toBe('Developer Tools')
      })

      it('generates id from slug if not provided', async () => {
        const typeWithoutId = {
          ...mockCrmType,
          id: undefined,
        }
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        const result = await integrationsDO.registerAccountType(typeWithoutId as unknown as AccountType)

        expect(result.id).toBe('crm')
      })

      it('rejects duplicate account type slugs', async () => {
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        await integrationsDO.registerAccountType(mockDevtoolsType)

        // @ts-expect-error - method doesn't exist yet (RED TDD)
        await expect(integrationsDO.registerAccountType(mockDevtoolsType)).rejects.toThrow(
          /already exists|duplicate/i,
        )
      })
    })

    describe('getAccountType', () => {
      it('can get account type by slug', async () => {
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        await integrationsDO.registerAccountType(mockDevtoolsType)

        // @ts-expect-error - method doesn't exist yet (RED TDD)
        const accountType = await integrationsDO.getAccountType('devtools')

        expect(accountType).toBeDefined()
        expect(accountType?.slug).toBe('devtools')
        expect(accountType?.name).toBe('Developer Tools')
      })

      it('returns null for non-existent account type', async () => {
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        const accountType = await integrationsDO.getAccountType('non-existent')

        expect(accountType).toBeNull()
      })
    })

    describe('updateAccountType', () => {
      it('can update account type metadata', async () => {
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        await integrationsDO.registerAccountType(mockDevtoolsType)

        // @ts-expect-error - method doesn't exist yet (RED TDD)
        const updated = await integrationsDO.updateAccountType('devtools', {
          name: 'Dev Tools',
          description: 'Updated description for developer tools',
        })

        expect(updated).toBeDefined()
        expect(updated?.name).toBe('Dev Tools')
        expect(updated?.description).toBe('Updated description for developer tools')
        // Original fields should be preserved
        expect(updated?.slug).toBe('devtools')
        expect(updated?.icon).toBe('code')
      })

      it('cannot update slug of existing account type', async () => {
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        await integrationsDO.registerAccountType(mockDevtoolsType)

        await expect(
          // @ts-expect-error - method doesn't exist yet (RED TDD)
          integrationsDO.updateAccountType('devtools', { slug: 'new-slug' } as Partial<AccountType>),
        ).rejects.toThrow(/cannot update slug|immutable/i)
      })

      it('returns null when updating non-existent account type', async () => {
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        const result = await integrationsDO.updateAccountType('non-existent', { name: 'Test' })

        expect(result).toBeNull()
      })
    })

    describe('deleteAccountType', () => {
      it('can delete account type', async () => {
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        await integrationsDO.registerAccountType(mockCrmType)

        // @ts-expect-error - method doesn't exist yet (RED TDD)
        const deleted = await integrationsDO.deleteAccountType('crm')

        expect(deleted).toBe(true)

        // @ts-expect-error - method doesn't exist yet (RED TDD)
        const accountType = await integrationsDO.getAccountType('crm')
        expect(accountType).toBeNull()
      })

      it('returns false for non-existent account type', async () => {
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        const deleted = await integrationsDO.deleteAccountType('non-existent')

        expect(deleted).toBe(false)
      })
    })
  })

  // ==========================================================================
  // 2. ACCOUNT TYPE PROPERTIES
  // ==========================================================================

  describe('Account Type Properties', () => {
    it('account type has icon and description', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await integrationsDO.registerAccountType(mockDevtoolsType)

      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const accountType = await integrationsDO.getAccountType('devtools')

      expect(accountType?.icon).toBe('code')
      expect(accountType?.description).toBe('Tools for software development, version control, and CI/CD')
    })

    it('account type lists providers that belong to it', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await integrationsDO.registerAccountType({
        ...mockDevtoolsType,
        providers: ['github', 'gitlab'],
      })

      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const accountType = await integrationsDO.getAccountType('devtools')

      expect(accountType?.providers).toContain('github')
      expect(accountType?.providers).toContain('gitlab')
      expect(accountType?.providers).toHaveLength(2)
    })

    it('slug must be unique', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await integrationsDO.registerAccountType(mockDevtoolsType)

      const duplicateType = {
        ...mockCrmType,
        slug: 'devtools', // Duplicate slug
      }

      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await expect(integrationsDO.registerAccountType(duplicateType)).rejects.toThrow(
        /already exists|duplicate|unique/i,
      )
    })
  })

  // ==========================================================================
  // 3. PROVIDER ASSOCIATION
  // ==========================================================================

  describe('Provider Association', () => {
    it('providers reference account types', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await integrationsDO.registerAccountType(mockDevtoolsType)
      await integrationsDO.registerProvider(mockGitHubProvider)

      const provider = await integrationsDO.getProvider('github')

      expect(provider?.accountType).toBe('devtools')
    })

    it('querying account type returns associated providers', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await integrationsDO.registerAccountType(mockDevtoolsType)
      await integrationsDO.registerProvider(mockGitHubProvider)
      await integrationsDO.registerProvider(mockGitLabProvider)

      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const accountType = await integrationsDO.getAccountType('devtools')

      expect(accountType?.providers).toContain('github')
      expect(accountType?.providers).toContain('gitlab')
    })

    it('adding provider auto-updates account type providers list', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await integrationsDO.registerAccountType(mockDevtoolsType)

      // @ts-expect-error - method doesn't exist yet (RED TDD)
      let accountType = await integrationsDO.getAccountType('devtools')
      expect(accountType?.providers).toHaveLength(0)

      // Register a provider with this account type
      await integrationsDO.registerProvider(mockGitHubProvider)

      // Account type should now include this provider
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      accountType = await integrationsDO.getAccountType('devtools')
      expect(accountType?.providers).toContain('github')
    })

    it('deleting provider removes it from account type providers list', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await integrationsDO.registerAccountType(mockDevtoolsType)
      await integrationsDO.registerProvider(mockGitHubProvider)

      // @ts-expect-error - method doesn't exist yet (RED TDD)
      let accountType = await integrationsDO.getAccountType('devtools')
      expect(accountType?.providers).toContain('github')

      // Delete the provider
      await integrationsDO.deleteProvider('github')

      // Account type should no longer include this provider
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      accountType = await integrationsDO.getAccountType('devtools')
      expect(accountType?.providers).not.toContain('github')
    })
  })

  // ==========================================================================
  // 4. BUILT-IN ACCOUNT TYPES
  // ==========================================================================

  describe('Built-in Account Types', () => {
    it('has pre-configured devtools account type', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const accountType = await integrationsDO.getAccountType('devtools')

      expect(accountType).toBeDefined()
      expect(accountType?.slug).toBe('devtools')
      expect(accountType?.name).toBe('Developer Tools')
    })

    it('has pre-configured crm account type', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const accountType = await integrationsDO.getAccountType('crm')

      expect(accountType).toBeDefined()
      expect(accountType?.slug).toBe('crm')
    })

    it('has pre-configured payments account type', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const accountType = await integrationsDO.getAccountType('payments')

      expect(accountType).toBeDefined()
      expect(accountType?.slug).toBe('payments')
    })

    it('has pre-configured communication account type', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const accountType = await integrationsDO.getAccountType('communication')

      expect(accountType).toBeDefined()
      expect(accountType?.slug).toBe('communication')
    })

    it('has pre-configured productivity account type', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const accountType = await integrationsDO.getAccountType('productivity')

      expect(accountType).toBeDefined()
      expect(accountType?.slug).toBe('productivity')
    })

    it('has pre-configured storage account type', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const accountType = await integrationsDO.getAccountType('storage')

      expect(accountType).toBeDefined()
      expect(accountType?.slug).toBe('storage')
    })

    it('built-in account types cannot be deleted', async () => {
      await expect(
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        integrationsDO.deleteAccountType('devtools'),
      ).rejects.toThrow(/built-in|protected|cannot delete/i)
    })

    it('built-in account types can be deleted with force flag', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const deleted = await integrationsDO.deleteAccountType('devtools', { force: true })
      expect(deleted).toBe(true)
    })

    it('listBuiltInAccountTypes returns only built-in types', async () => {
      // Register a custom account type
      const customType: AccountType = {
        id: 'custom',
        slug: 'custom',
        name: 'Custom Category',
        icon: 'star',
        description: 'A custom category',
        providers: [],
      }
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await integrationsDO.registerAccountType(customType)

      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const builtIn = await integrationsDO.listBuiltInAccountTypes()

      expect(builtIn.map((t: AccountType) => t.slug)).toContain('devtools')
      expect(builtIn.map((t: AccountType) => t.slug)).toContain('crm')
      expect(builtIn.map((t: AccountType) => t.slug)).toContain('payments')
      expect(builtIn.map((t: AccountType) => t.slug)).toContain('communication')
      expect(builtIn.map((t: AccountType) => t.slug)).toContain('productivity')
      expect(builtIn.map((t: AccountType) => t.slug)).toContain('storage')
      expect(builtIn.map((t: AccountType) => t.slug)).not.toContain('custom')
    })

    it('can check if account type is built-in', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      expect(await integrationsDO.isBuiltInAccountType('devtools')).toBe(true)
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      expect(await integrationsDO.isBuiltInAccountType('crm')).toBe(true)
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      expect(await integrationsDO.isBuiltInAccountType('payments')).toBe(true)
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      expect(await integrationsDO.isBuiltInAccountType('custom')).toBe(false)
    })
  })

  // ==========================================================================
  // 5. HTTP API ENDPOINTS
  // ==========================================================================

  describe('HTTP API', () => {
    describe('GET /account-types', () => {
      it('lists all account types as objects', async () => {
        const request = new Request('http://test/account-types')
        const response = await integrationsDO.fetch(request)

        expect(response.status).toBe(200)
        const data = (await response.json()) as AccountType[]
        expect(Array.isArray(data)).toBe(true)
        // Should return AccountType objects, not just strings
        if (data.length > 0) {
          expect(data[0]).toHaveProperty('id')
          expect(data[0]).toHaveProperty('slug')
          expect(data[0]).toHaveProperty('name')
          expect(data[0]).toHaveProperty('icon')
          expect(data[0]).toHaveProperty('description')
          expect(data[0]).toHaveProperty('providers')
        }
      })
    })

    describe('GET /account-types/:slug', () => {
      it('gets single account type', async () => {
        const request = new Request('http://test/account-types/devtools')
        const response = await integrationsDO.fetch(request)

        expect(response.status).toBe(200)
        const data = (await response.json()) as AccountType
        expect(data.slug).toBe('devtools')
        expect(data.name).toBeDefined()
        expect(data.icon).toBeDefined()
        expect(data.description).toBeDefined()
        expect(Array.isArray(data.providers)).toBe(true)
      })

      it('returns 404 for non-existent account type', async () => {
        const request = new Request('http://test/account-types/non-existent')
        const response = await integrationsDO.fetch(request)

        expect(response.status).toBe(404)
      })
    })

    describe('POST /account-types', () => {
      it('creates new account type', async () => {
        const newType: AccountType = {
          id: 'analytics',
          slug: 'analytics',
          name: 'Analytics',
          icon: 'bar-chart',
          description: 'Analytics and reporting tools',
          providers: [],
        }

        const request = new Request('http://test/account-types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newType),
        })
        const response = await integrationsDO.fetch(request)

        expect(response.status).toBe(201)
        const data = (await response.json()) as AccountType
        expect(data.slug).toBe('analytics')
        expect(data.name).toBe('Analytics')
      })

      it('returns 400 for duplicate slug', async () => {
        const existingType: AccountType = {
          id: 'devtools',
          slug: 'devtools',
          name: 'Duplicate Dev Tools',
          icon: 'code',
          description: 'Duplicate',
          providers: [],
        }

        const request = new Request('http://test/account-types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(existingType),
        })
        const response = await integrationsDO.fetch(request)

        expect(response.status).toBe(400)
      })
    })

    describe('PUT /account-types/:slug', () => {
      it('updates existing account type', async () => {
        // First create a custom account type
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        await integrationsDO.registerAccountType({
          id: 'custom',
          slug: 'custom',
          name: 'Custom',
          icon: 'star',
          description: 'Custom type',
          providers: [],
        })

        const request = new Request('http://test/account-types/custom', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Updated Custom', description: 'Updated description' }),
        })
        const response = await integrationsDO.fetch(request)

        expect(response.status).toBe(200)
        const data = (await response.json()) as AccountType
        expect(data.name).toBe('Updated Custom')
        expect(data.description).toBe('Updated description')
      })

      it('returns 404 for non-existent account type', async () => {
        const request = new Request('http://test/account-types/non-existent', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Test' }),
        })
        const response = await integrationsDO.fetch(request)

        expect(response.status).toBe(404)
      })
    })

    describe('DELETE /account-types/:slug', () => {
      it('deletes custom account type', async () => {
        // First create a custom account type
        // @ts-expect-error - method doesn't exist yet (RED TDD)
        await integrationsDO.registerAccountType({
          id: 'custom',
          slug: 'custom',
          name: 'Custom',
          icon: 'star',
          description: 'Custom type',
          providers: [],
        })

        const request = new Request('http://test/account-types/custom', {
          method: 'DELETE',
        })
        const response = await integrationsDO.fetch(request)

        expect(response.status).toBe(200)

        // Verify deletion
        const getResponse = await integrationsDO.fetch(new Request('http://test/account-types/custom'))
        expect(getResponse.status).toBe(404)
      })

      it('returns 400 when trying to delete built-in account type', async () => {
        const request = new Request('http://test/account-types/devtools', {
          method: 'DELETE',
        })
        const response = await integrationsDO.fetch(request)

        expect(response.status).toBe(400)
      })
    })
  })

  // ==========================================================================
  // 6. LISTING
  // ==========================================================================

  describe('Account Type Listing', () => {
    it('can list all account types', async () => {
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const types = await integrationsDO.listAccountTypes()

      expect(Array.isArray(types)).toBe(true)
      // Should include built-in types
      expect(types.map((t: AccountType) => t.slug)).toContain('devtools')
      expect(types.map((t: AccountType) => t.slug)).toContain('payments')
    })

    it('returns empty array when no custom types registered and no built-ins', async () => {
      // This tests the scenario if we were to remove built-ins
      const emptyDO = new IntegrationsDO(createMockState(), createMockEnv())

      // After deleting all built-in types with force
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await emptyDO.deleteAccountType('devtools', { force: true })
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await emptyDO.deleteAccountType('crm', { force: true })
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await emptyDO.deleteAccountType('payments', { force: true })
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await emptyDO.deleteAccountType('communication', { force: true })
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await emptyDO.deleteAccountType('productivity', { force: true })
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await emptyDO.deleteAccountType('storage', { force: true })

      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const types = await emptyDO.listAccountTypes()

      expect(types).toEqual([])
    })

    it('includes custom account types in listing', async () => {
      const customType: AccountType = {
        id: 'custom',
        slug: 'custom',
        name: 'Custom Category',
        icon: 'star',
        description: 'A custom category',
        providers: [],
      }
      // @ts-expect-error - method doesn't exist yet (RED TDD)
      await integrationsDO.registerAccountType(customType)

      // @ts-expect-error - method doesn't exist yet (RED TDD)
      const types = await integrationsDO.listAccountTypes()

      expect(types.map((t: AccountType) => t.slug)).toContain('custom')
    })
  })
})
