/**
 * ContractRegistry DO Tests
 *
 * RED TDD: These tests should FAIL because ContractRegistry doesn't exist yet.
 *
 * ContractRegistry is a Durable Object that manages DataContract schemas with:
 * - Contract registration and versioning
 * - Schema discovery by namespace, owner, and tags
 * - Lineage tracking (producer/consumer relationships)
 * - Contract search and filtering
 *
 * Storage Design:
 * - Metadata in DO SQLite for fast queries
 * - Schema content in R2 for large schemas
 * - Lineage graph in DO for relationship queries
 */

import { describe, it, expect, beforeEach } from 'vitest'

// These imports will FAIL - ContractRegistry doesn't exist yet
import {
  ContractRegistry,
  DiscoveryService,
  LineageTracker,
  type DataContract,
  type ContractVersion,
  type ContractSummary,
  type ContractFilter,
  type LineageGraph,
  type ContractStatus,
} from '../registry'

// ============================================================================
// TYPE DEFINITIONS (expected interfaces)
// ============================================================================

/**
 * DataContract - Schema definition with metadata
 */
interface ExpectedDataContract {
  name: string // 'user.profile'
  namespace: string // 'user'
  version: string // '1.0.0' (semver)
  schema: object // JSON Schema or Zod-compatible schema
  owner: string // team/user who owns this contract
  description?: string
  tags?: string[]
  status: 'draft' | 'active' | 'deprecated'
  compatibility?: 'backward' | 'forward' | 'full' | 'none'
  createdAt?: Date
  updatedAt?: Date
}

/**
 * ContractVersion - Published version record
 */
interface ExpectedContractVersion {
  name: string
  version: string
  schemaHash: string // SHA-256 of schema content
  r2Key: string // R2 storage key for schema
  publishedAt: Date
  publishedBy: string
}

/**
 * ContractSummary - Lightweight contract info for listings
 */
interface ExpectedContractSummary {
  name: string
  namespace: string
  latestVersion: string
  owner: string
  status: 'draft' | 'active' | 'deprecated'
  tags: string[]
  description?: string
}

/**
 * ContractFilter - Filter options for listing/searching
 */
interface ExpectedContractFilter {
  namespace?: string
  owner?: string
  tags?: string[]
  status?: 'draft' | 'active' | 'deprecated'
  search?: string // Full-text search on name/description
}

/**
 * LineageGraph - Dependency graph for a contract
 */
interface ExpectedLineageGraph {
  contract: string
  providers: LineageNode[] // Contracts this depends on
  consumers: LineageNode[] // Contracts that depend on this
  depth: number // How many levels were traversed
}

interface LineageNode {
  contract: string
  version: string
  relationship: 'blocks' | 'related' | 'parent-child'
}

// ============================================================================
// TEST DATA FIXTURES
// ============================================================================

const mockUserProfileContract: ExpectedDataContract = {
  name: 'user.profile',
  namespace: 'user',
  version: '1.0.0',
  owner: 'platform-team',
  description: 'User profile data contract',
  status: 'active',
  compatibility: 'backward',
  tags: ['user', 'core', 'pii'],
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      name: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'email'],
  },
}

const mockOrderContract: ExpectedDataContract = {
  name: 'order.created',
  namespace: 'order',
  version: '1.0.0',
  owner: 'commerce-team',
  description: 'Order creation event contract',
  status: 'active',
  compatibility: 'full',
  tags: ['order', 'event', 'commerce'],
  schema: {
    type: 'object',
    properties: {
      orderId: { type: 'string' },
      userId: { type: 'string' },
      total: { type: 'number' },
      items: { type: 'array' },
    },
    required: ['orderId', 'userId'],
  },
}

const mockPaymentContract: ExpectedDataContract = {
  name: 'payment.processed',
  namespace: 'payment',
  version: '2.1.0',
  owner: 'payments-team',
  description: 'Payment processing result',
  status: 'active',
  compatibility: 'backward',
  tags: ['payment', 'event', 'finance'],
  schema: {
    type: 'object',
    properties: {
      paymentId: { type: 'string' },
      orderId: { type: 'string' },
      amount: { type: 'number' },
      status: { type: 'string', enum: ['success', 'failed', 'pending'] },
    },
    required: ['paymentId', 'orderId', 'amount', 'status'],
  },
}

// ============================================================================
// MOCK DO STATE (for testing without Workers runtime)
// ============================================================================

function createMockDOState() {
  const storage = new Map<string, unknown>()
  return {
    id: { toString: () => 'test-registry-do' },
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        storage.set(key, value)
      },
      delete: async (key: string) => storage.delete(key),
      list: async (options?: { prefix?: string }) => {
        const result = new Map<string, unknown>()
        for (const [k, v] of storage.entries()) {
          if (!options?.prefix || k.startsWith(options.prefix)) {
            result.set(k, v)
          }
        }
        return result
      },
    },
    blockConcurrencyWhile: async (fn: () => Promise<void>) => fn(),
  }
}

function createMockEnv() {
  const r2Storage = new Map<string, ArrayBuffer>()
  return {
    SCHEMAS: {
      get: async (key: string) => r2Storage.get(key) ?? null,
      put: async (key: string, value: ArrayBuffer) => {
        r2Storage.set(key, value)
      },
      delete: async (key: string) => r2Storage.delete(key),
      list: async () => ({ objects: [] }),
    },
  }
}

// ============================================================================
// CONTRACT REGISTRATION AND LOOKUP TESTS
// ============================================================================

describe('ContractRegistry', () => {
  let registry: ContractRegistry
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    registry = new ContractRegistry(mockState as DurableObjectState, mockEnv as unknown as Env)
  })

  describe('Contract Registration', () => {
    it('should publish a new contract and return version info', async () => {
      const result = await registry.publish(mockUserProfileContract as DataContract)

      expect(result).toBeDefined()
      expect(result.name).toBe('user.profile')
      expect(result.version).toBe('1.0.0')
      expect(result.schemaHash).toBeDefined()
      expect(result.r2Key).toMatch(/^schemas\/user\.profile\/1\.0\.0/)
      expect(result.publishedAt).toBeInstanceOf(Date)
    })

    it('should reject publishing duplicate version', async () => {
      await registry.publish(mockUserProfileContract as DataContract)

      await expect(
        registry.publish(mockUserProfileContract as DataContract)
      ).rejects.toThrow(/already exists/)
    })

    it('should allow publishing new version of existing contract', async () => {
      await registry.publish(mockUserProfileContract as DataContract)

      const v2 = {
        ...mockUserProfileContract,
        version: '1.1.0',
        schema: {
          ...mockUserProfileContract.schema,
          properties: {
            ...(mockUserProfileContract.schema as Record<string, unknown>).properties,
            nickname: { type: 'string' },
          },
        },
      }

      const result = await registry.publish(v2 as DataContract)
      expect(result.version).toBe('1.1.0')
    })

    it('should validate semver format', async () => {
      const invalid = { ...mockUserProfileContract, version: 'not-semver' }

      await expect(
        registry.publish(invalid as DataContract)
      ).rejects.toThrow(/invalid version/)
    })

    it('should require schema field', async () => {
      const { schema, ...noSchema } = mockUserProfileContract

      await expect(
        registry.publish(noSchema as unknown as DataContract)
      ).rejects.toThrow(/schema required/)
    })
  })

  describe('Contract Lookup', () => {
    beforeEach(async () => {
      await registry.publish(mockUserProfileContract as DataContract)
    })

    it('should get contract by name with latest version', async () => {
      const contract = await registry.get('user.profile')

      expect(contract).toBeDefined()
      expect(contract!.name).toBe('user.profile')
      expect(contract!.version).toBe('1.0.0')
      expect(contract!.schema).toEqual(mockUserProfileContract.schema)
    })

    it('should get contract by name and specific version', async () => {
      // Publish v1.1.0
      await registry.publish({
        ...mockUserProfileContract,
        version: '1.1.0',
      } as DataContract)

      const v1 = await registry.get('user.profile', '1.0.0')
      expect(v1!.version).toBe('1.0.0')

      const v11 = await registry.get('user.profile', '1.1.0')
      expect(v11!.version).toBe('1.1.0')
    })

    it('should return null for non-existent contract', async () => {
      const contract = await registry.get('does.not.exist')
      expect(contract).toBeNull()
    })

    it('should return null for non-existent version', async () => {
      const contract = await registry.get('user.profile', '9.9.9')
      expect(contract).toBeNull()
    })
  })

  describe('Contract Listing', () => {
    beforeEach(async () => {
      await registry.publish(mockUserProfileContract as DataContract)
      await registry.publish(mockOrderContract as DataContract)
      await registry.publish(mockPaymentContract as DataContract)
    })

    it('should list all contracts', async () => {
      const contracts = await registry.list()

      expect(contracts).toHaveLength(3)
      expect(contracts.map(c => c.name)).toContain('user.profile')
      expect(contracts.map(c => c.name)).toContain('order.created')
      expect(contracts.map(c => c.name)).toContain('payment.processed')
    })

    it('should filter by namespace', async () => {
      const contracts = await registry.list({ namespace: 'user' })

      expect(contracts).toHaveLength(1)
      expect(contracts[0].name).toBe('user.profile')
    })

    it('should filter by owner', async () => {
      const contracts = await registry.list({ owner: 'platform-team' })

      expect(contracts).toHaveLength(1)
      expect(contracts[0].owner).toBe('platform-team')
    })

    it('should filter by tags', async () => {
      const contracts = await registry.list({ tags: ['event'] })

      expect(contracts).toHaveLength(2)
      expect(contracts.map(c => c.name)).toContain('order.created')
      expect(contracts.map(c => c.name)).toContain('payment.processed')
    })

    it('should filter by status', async () => {
      // Deprecate one contract
      await registry.deprecate('user.profile', '1.0.0')

      const active = await registry.list({ status: 'active' })
      expect(active).toHaveLength(2)

      const deprecated = await registry.list({ status: 'deprecated' })
      expect(deprecated).toHaveLength(1)
      expect(deprecated[0].name).toBe('user.profile')
    })

    it('should support pagination', async () => {
      const page1 = await registry.list({ limit: 2 })
      expect(page1).toHaveLength(2)

      const page2 = await registry.list({ limit: 2, offset: 2 })
      expect(page2).toHaveLength(1)
    })
  })

  describe('Contract Deprecation', () => {
    beforeEach(async () => {
      await registry.publish(mockUserProfileContract as DataContract)
    })

    it('should deprecate a contract version', async () => {
      await registry.deprecate('user.profile', '1.0.0')

      const contract = await registry.get('user.profile', '1.0.0')
      expect(contract!.status).toBe('deprecated')
    })

    it('should throw for non-existent contract', async () => {
      await expect(
        registry.deprecate('does.not.exist', '1.0.0')
      ).rejects.toThrow(/not found/)
    })

    it('should not affect other versions', async () => {
      await registry.publish({
        ...mockUserProfileContract,
        version: '1.1.0',
      } as DataContract)

      await registry.deprecate('user.profile', '1.0.0')

      const v11 = await registry.get('user.profile', '1.1.0')
      expect(v11!.status).toBe('active')
    })
  })
})

// ============================================================================
// VERSION MANAGEMENT TESTS
// ============================================================================

describe('ContractRegistry Version Management', () => {
  let registry: ContractRegistry
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    registry = new ContractRegistry(mockState as DurableObjectState, mockEnv as unknown as Env)
  })

  it('should track all versions of a contract', async () => {
    await registry.publish({ ...mockUserProfileContract, version: '1.0.0' } as DataContract)
    await registry.publish({ ...mockUserProfileContract, version: '1.1.0' } as DataContract)
    await registry.publish({ ...mockUserProfileContract, version: '2.0.0' } as DataContract)

    const versions = await registry.getVersions('user.profile')

    expect(versions).toHaveLength(3)
    expect(versions.map(v => v.version)).toEqual(['1.0.0', '1.1.0', '2.0.0'])
  })

  it('should return latest version correctly', async () => {
    await registry.publish({ ...mockUserProfileContract, version: '1.0.0' } as DataContract)
    await registry.publish({ ...mockUserProfileContract, version: '1.1.0' } as DataContract)
    await registry.publish({ ...mockUserProfileContract, version: '2.0.0' } as DataContract)

    const latest = await registry.getLatestVersion('user.profile')

    expect(latest).toBe('2.0.0')
  })

  it('should handle pre-release versions', async () => {
    await registry.publish({ ...mockUserProfileContract, version: '1.0.0' } as DataContract)
    await registry.publish({ ...mockUserProfileContract, version: '2.0.0-alpha.1' } as DataContract)

    // Latest stable should be 1.0.0
    const latestStable = await registry.getLatestVersion('user.profile', { includePrerelease: false })
    expect(latestStable).toBe('1.0.0')

    // Latest including prerelease should be 2.0.0-alpha.1
    const latest = await registry.getLatestVersion('user.profile', { includePrerelease: true })
    expect(latest).toBe('2.0.0-alpha.1')
  })

  it('should compare versions correctly', async () => {
    await registry.publish({ ...mockUserProfileContract, version: '1.0.0' } as DataContract)
    await registry.publish({ ...mockUserProfileContract, version: '1.0.1' } as DataContract)
    await registry.publish({ ...mockUserProfileContract, version: '1.1.0' } as DataContract)

    const diff = await registry.compareVersions('user.profile', '1.0.0', '1.1.0')

    expect(diff.breaking).toBe(false) // Minor version bump
    expect(diff.added).toBeDefined()
    expect(diff.removed).toBeDefined()
  })
})

// ============================================================================
// DISCOVERY SERVICE TESTS
// ============================================================================

describe('DiscoveryService', () => {
  let registry: ContractRegistry
  let discovery: DiscoveryService
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(async () => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    registry = new ContractRegistry(mockState as DurableObjectState, mockEnv as unknown as Env)
    discovery = new DiscoveryService(registry)

    // Seed with test data
    await registry.publish(mockUserProfileContract as DataContract)
    await registry.publish(mockOrderContract as DataContract)
    await registry.publish(mockPaymentContract as DataContract)
  })

  describe('Search', () => {
    it('should search contracts by text query', async () => {
      const results = await discovery.search('user')

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('user.profile')
    })

    it('should search in description', async () => {
      const results = await discovery.search('payment processing')

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('payment.processed')
    })

    it('should return empty array for no matches', async () => {
      const results = await discovery.search('nonexistent')

      expect(results).toHaveLength(0)
    })

    it('should support fuzzy matching', async () => {
      const results = await discovery.search('profil') // Missing 'e'

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].name).toBe('user.profile')
    })
  })

  describe('By Owner', () => {
    it('should find contracts by owner', async () => {
      const results = await discovery.byOwner('platform-team')

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('user.profile')
    })

    it('should return all contracts for owner with multiple', async () => {
      // Publish another contract with same owner
      await registry.publish({
        ...mockUserProfileContract,
        name: 'user.settings',
        namespace: 'user',
        version: '1.0.0',
      } as DataContract)

      const results = await discovery.byOwner('platform-team')

      expect(results).toHaveLength(2)
    })
  })

  describe('By Tag', () => {
    it('should find contracts by single tag', async () => {
      const results = await discovery.byTag('pii')

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('user.profile')
    })

    it('should find contracts by multiple tags (OR)', async () => {
      const results = await discovery.byTags(['user', 'commerce'])

      expect(results).toHaveLength(2)
    })

    it('should find contracts by multiple tags (AND)', async () => {
      const results = await discovery.byTags(['event', 'commerce'], { match: 'all' })

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('order.created')
    })
  })

  describe('By Namespace', () => {
    it('should find contracts in namespace', async () => {
      const results = await discovery.byNamespace('order')

      expect(results).toHaveLength(1)
      expect(results[0].namespace).toBe('order')
    })

    it('should support namespace wildcards', async () => {
      const results = await discovery.byNamespace('*') // All namespaces

      expect(results).toHaveLength(3)
    })
  })

  describe('Schema Compatibility', () => {
    it('should check if schema is compatible with contract', async () => {
      const testData = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        email: 'test@example.com',
        name: 'Test User',
      }

      const isCompatible = await discovery.isCompatible('user.profile', testData)

      expect(isCompatible).toBe(true)
    })

    it('should detect incompatible data', async () => {
      const invalidData = {
        id: 'not-a-uuid',
        // Missing required email field
      }

      const isCompatible = await discovery.isCompatible('user.profile', invalidData)

      expect(isCompatible).toBe(false)
    })
  })
})

// ============================================================================
// LINEAGE TRACKER TESTS
// ============================================================================

describe('LineageTracker', () => {
  let registry: ContractRegistry
  let lineage: LineageTracker
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(async () => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    registry = new ContractRegistry(mockState as DurableObjectState, mockEnv as unknown as Env)
    lineage = new LineageTracker(registry)

    // Seed with test data
    await registry.publish(mockUserProfileContract as DataContract)
    await registry.publish(mockOrderContract as DataContract)
    await registry.publish(mockPaymentContract as DataContract)
  })

  describe('Dependency Registration', () => {
    it('should add dependency between contracts', async () => {
      // order.created depends on user.profile (needs userId)
      await lineage.addDependency('order.created', 'user.profile')

      const deps = await lineage.getProviders('order.created')

      expect(deps).toHaveLength(1)
      expect(deps[0]).toBe('user.profile')
    })

    it('should track multiple dependencies', async () => {
      await lineage.addDependency('payment.processed', 'order.created')
      await lineage.addDependency('payment.processed', 'user.profile')

      const deps = await lineage.getProviders('payment.processed')

      expect(deps).toHaveLength(2)
      expect(deps).toContain('order.created')
      expect(deps).toContain('user.profile')
    })

    it('should reject self-dependency', async () => {
      await expect(
        lineage.addDependency('user.profile', 'user.profile')
      ).rejects.toThrow(/self-dependency/)
    })

    it('should detect circular dependencies', async () => {
      await lineage.addDependency('order.created', 'user.profile')
      await lineage.addDependency('user.profile', 'payment.processed')

      await expect(
        lineage.addDependency('payment.processed', 'order.created')
      ).rejects.toThrow(/circular dependency/)
    })
  })

  describe('Consumer Tracking', () => {
    beforeEach(async () => {
      await lineage.addDependency('order.created', 'user.profile')
      await lineage.addDependency('payment.processed', 'user.profile')
    })

    it('should get consumers of a contract', async () => {
      const consumers = await lineage.getConsumers('user.profile')

      expect(consumers).toHaveLength(2)
      expect(consumers).toContain('order.created')
      expect(consumers).toContain('payment.processed')
    })

    it('should return empty array for no consumers', async () => {
      const consumers = await lineage.getConsumers('payment.processed')

      expect(consumers).toHaveLength(0)
    })
  })

  describe('Lineage Graph', () => {
    beforeEach(async () => {
      // Build a dependency chain: payment -> order -> user
      await lineage.addDependency('order.created', 'user.profile')
      await lineage.addDependency('payment.processed', 'order.created')
    })

    it('should get full lineage graph', async () => {
      const graph = await lineage.getLineage('payment.processed')

      expect(graph.contract).toBe('payment.processed')
      expect(graph.providers).toHaveLength(1)
      expect(graph.providers[0].contract).toBe('order.created')
    })

    it('should traverse to specified depth', async () => {
      const graph = await lineage.getLineage('payment.processed', { depth: 2 })

      expect(graph.depth).toBe(2)
      // Should include order.created and user.profile
      const allProviders = flattenLineage(graph)
      expect(allProviders).toContain('order.created')
      expect(allProviders).toContain('user.profile')
    })

    it('should get upstream impact', async () => {
      // If user.profile changes, what's affected?
      const impact = await lineage.getUpstreamImpact('user.profile')

      expect(impact).toContain('order.created')
      expect(impact).toContain('payment.processed')
    })

    it('should get downstream dependencies', async () => {
      // What does payment.processed depend on?
      const deps = await lineage.getDownstreamDependencies('payment.processed')

      expect(deps).toContain('order.created')
      expect(deps).toContain('user.profile')
    })
  })

  describe('Dependency Removal', () => {
    beforeEach(async () => {
      await lineage.addDependency('order.created', 'user.profile')
    })

    it('should remove dependency', async () => {
      await lineage.removeDependency('order.created', 'user.profile')

      const deps = await lineage.getProviders('order.created')
      expect(deps).toHaveLength(0)
    })

    it('should update consumer list on removal', async () => {
      await lineage.removeDependency('order.created', 'user.profile')

      const consumers = await lineage.getConsumers('user.profile')
      expect(consumers).not.toContain('order.created')
    })
  })
})

// ============================================================================
// SEARCH AND FILTERING TESTS
// ============================================================================

describe('ContractRegistry Search and Filtering', () => {
  let registry: ContractRegistry
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(async () => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    registry = new ContractRegistry(mockState as DurableObjectState, mockEnv as unknown as Env)

    // Create many contracts for search testing
    await registry.publish(mockUserProfileContract as DataContract)
    await registry.publish(mockOrderContract as DataContract)
    await registry.publish(mockPaymentContract as DataContract)
    await registry.publish({
      name: 'user.settings',
      namespace: 'user',
      version: '1.0.0',
      owner: 'platform-team',
      status: 'active',
      tags: ['user', 'settings'],
      schema: { type: 'object' },
    } as DataContract)
    await registry.publish({
      name: 'order.shipped',
      namespace: 'order',
      version: '1.0.0',
      owner: 'commerce-team',
      status: 'draft',
      tags: ['order', 'event', 'shipping'],
      schema: { type: 'object' },
    } as DataContract)
  })

  it('should search with combined filters', async () => {
    const results = await registry.search('order', {
      namespace: 'order',
      status: 'active',
    })

    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('order.created')
  })

  it('should search by partial name match', async () => {
    const results = await registry.search('user')

    expect(results).toHaveLength(2) // user.profile and user.settings
  })

  it('should filter by multiple tags', async () => {
    const results = await registry.list({
      tags: ['event', 'commerce'],
    })

    expect(results.length).toBeGreaterThan(0)
  })

  it('should sort results by relevance', async () => {
    const results = await registry.search('order event', {
      sortBy: 'relevance',
    })

    // Most relevant should be first
    expect(results[0].name).toBe('order.created')
  })

  it('should sort results by name', async () => {
    const results = await registry.list({
      sortBy: 'name',
      sortOrder: 'asc',
    })

    const names = results.map(r => r.name)
    const sortedNames = [...names].sort()
    expect(names).toEqual(sortedNames)
  })

  it('should sort results by updated date', async () => {
    const results = await registry.list({
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    })

    // Most recently updated first
    expect(results.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// R2 STORAGE INTEGRATION TESTS
// ============================================================================

describe('ContractRegistry R2 Storage', () => {
  let registry: ContractRegistry
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    registry = new ContractRegistry(mockState as DurableObjectState, mockEnv as unknown as Env)
  })

  it('should store large schemas in R2', async () => {
    const largeSchema = {
      type: 'object',
      properties: {} as Record<string, unknown>,
    }
    // Create a large schema with many properties
    for (let i = 0; i < 100; i++) {
      largeSchema.properties[`field${i}`] = {
        type: 'string',
        description: `Field ${i} with a longer description to increase size`,
      }
    }

    const contract = {
      ...mockUserProfileContract,
      name: 'large.schema',
      schema: largeSchema,
    }

    const result = await registry.publish(contract as DataContract)

    expect(result.r2Key).toBeDefined()
    expect(result.r2Key).toMatch(/^schemas\//)
  })

  it('should retrieve schema from R2', async () => {
    await registry.publish(mockUserProfileContract as DataContract)

    const contract = await registry.get('user.profile')

    expect(contract!.schema).toEqual(mockUserProfileContract.schema)
  })

  it('should compute correct schema hash', async () => {
    const result = await registry.publish(mockUserProfileContract as DataContract)

    // Hash should be deterministic
    const result2 = await registry.publish({
      ...mockUserProfileContract,
      name: 'user.profile.copy',
    } as DataContract)

    expect(result.schemaHash).toBe(result2.schemaHash)
  })

  it('should deduplicate identical schemas in R2', async () => {
    await registry.publish(mockUserProfileContract as DataContract)
    await registry.publish({
      ...mockUserProfileContract,
      name: 'user.profile.alias',
    } as DataContract)

    // Both should point to same R2 object (same hash)
    const contract1 = await registry.get('user.profile')
    const contract2 = await registry.get('user.profile.alias')

    // Implementation detail: same hash = same R2 key
    expect(contract1!.schema).toEqual(contract2!.schema)
  })
})

// ============================================================================
// PAGINATION TESTS
// ============================================================================

describe('ContractRegistry Pagination', () => {
  let registry: ContractRegistry
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(async () => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    registry = new ContractRegistry(mockState as DurableObjectState, mockEnv as unknown as Env)

    // Create 25 contracts for pagination testing
    for (let i = 0; i < 25; i++) {
      await registry.publish({
        name: `test.contract.${i.toString().padStart(2, '0')}`,
        namespace: 'test',
        version: '1.0.0',
        owner: 'test-team',
        status: 'active',
        tags: ['test'],
        schema: { type: 'object' },
      } as DataContract)
    }
  })

  it('should paginate with limit', async () => {
    const page1 = await registry.list({ limit: 10 })

    expect(page1).toHaveLength(10)
  })

  it('should paginate with offset', async () => {
    const page1 = await registry.list({ limit: 10, offset: 0 })
    const page2 = await registry.list({ limit: 10, offset: 10 })

    expect(page1).toHaveLength(10)
    expect(page2).toHaveLength(10)

    // Pages should have different contracts
    const page1Names = new Set(page1.map(c => c.name))
    const page2Names = new Set(page2.map(c => c.name))
    const overlap = [...page1Names].filter(n => page2Names.has(n))
    expect(overlap).toHaveLength(0)
  })

  it('should return total count with pagination', async () => {
    const result = await registry.list({ limit: 10, includeTotalCount: true })

    expect(result).toHaveLength(10)
    // Total count available in metadata or response wrapper
  })

  it('should handle last page correctly', async () => {
    const lastPage = await registry.list({ limit: 10, offset: 20 })

    expect(lastPage).toHaveLength(5) // 25 total, offset 20 = 5 remaining
  })

  it('should support cursor-based pagination', async () => {
    const page1 = await registry.list({ limit: 10 })
    const cursor = page1[page1.length - 1].name // Use last item as cursor

    const page2 = await registry.list({ limit: 10, after: cursor })

    expect(page2).toHaveLength(10)
    expect(page2[0].name).not.toBe(page1[0].name)
  })
})

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Flatten lineage graph to list of contract names
 */
function flattenLineage(graph: ExpectedLineageGraph): string[] {
  const contracts: string[] = []

  function traverse(nodes: LineageNode[]) {
    for (const node of nodes) {
      if (!contracts.includes(node.contract)) {
        contracts.push(node.contract)
      }
    }
  }

  traverse(graph.providers)
  traverse(graph.consumers)

  return contracts
}
