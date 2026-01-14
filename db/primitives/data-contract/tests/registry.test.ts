/**
 * ContractRegistry tests - Schema storage, discovery, and lineage tracking
 *
 * Tests the ContractRegistry implementation for:
 * - Schema registration and versioning
 * - Schema discovery (search by namespace/name/tag/owner)
 * - Lineage tracking (producer/consumer relationships)
 * - Deprecation lifecycle
 * - Validation against registered schemas
 * - Compatibility checking between versions
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  ContractRegistry,
  createContractRegistry,
  type ContractVersion,
  type ContractSummary,
  type LineageGraph,
  type LineageRelationship,
} from '../registry'
import type { JSONSchema } from '../index'

// ============================================================================
// MOCK DURABLE OBJECT STORAGE
// ============================================================================

class MockStorage implements DurableObjectStorage {
  private data = new Map<string, unknown>()

  async get<T = unknown>(key: string): Promise<T | undefined>
  async get<T = unknown>(keys: string[]): Promise<Map<string, T>>
  async get<T = unknown>(keyOrKeys: string | string[]): Promise<T | undefined | Map<string, T>> {
    if (Array.isArray(keyOrKeys)) {
      const result = new Map<string, T>()
      for (const key of keyOrKeys) {
        const value = this.data.get(key)
        if (value !== undefined) {
          result.set(key, value as T)
        }
      }
      return result
    }
    return this.data.get(keyOrKeys) as T | undefined
  }

  async put<T>(key: string, value: T): Promise<void>
  async put<T>(entries: Record<string, T>): Promise<void>
  async put<T>(keyOrEntries: string | Record<string, T>, value?: T): Promise<void> {
    if (typeof keyOrEntries === 'string') {
      this.data.set(keyOrEntries, value)
    } else {
      for (const [k, v] of Object.entries(keyOrEntries)) {
        this.data.set(k, v)
      }
    }
  }

  async delete(key: string): Promise<boolean>
  async delete(keys: string[]): Promise<number>
  async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
    if (Array.isArray(keyOrKeys)) {
      let count = 0
      for (const key of keyOrKeys) {
        if (this.data.delete(key)) count++
      }
      return count
    }
    return this.data.delete(keyOrKeys)
  }

  async list(options?: DurableObjectListOptions): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>()
    const prefix = options?.prefix || ''

    for (const [key, value] of this.data) {
      if (key.startsWith(prefix)) {
        result.set(key, value)
      }
    }
    return result
  }

  // Stub remaining required methods
  async deleteAll(): Promise<void> {
    this.data.clear()
  }

  async transaction<T>(closure: (txn: DurableObjectTransaction) => Promise<T>): Promise<T> {
    return closure(this as unknown as DurableObjectTransaction)
  }

  getAlarm(): Promise<number | null> {
    return Promise.resolve(null)
  }

  setAlarm(scheduledTime: number | Date): Promise<void> {
    return Promise.resolve()
  }

  deleteAlarm(): Promise<void> {
    return Promise.resolve()
  }

  sync(): Promise<void> {
    return Promise.resolve()
  }

  getCurrentBookmark(): Promise<string> {
    return Promise.resolve('')
  }

  getBookmarkForTime(timestamp: number | Date): Promise<string> {
    return Promise.resolve('')
  }

  onNextSessionRestoreBookmark(bookmark: string): void {}

  sql = {} as unknown as DurableObjectStorage['sql']
  transactionSync = (() => {}) as unknown as DurableObjectStorage['transactionSync']
}

// ============================================================================
// TESTS
// ============================================================================

describe('ContractRegistry', () => {
  let registry: ContractRegistry
  let storage: MockStorage

  beforeEach(() => {
    storage = new MockStorage()
    registry = createContractRegistry(storage as DurableObjectStorage)
  })

  // ============================================================================
  // SCHEMA REGISTRATION
  // ============================================================================

  describe('schema registration', () => {
    it('should publish a new contract', async () => {
      const result = await registry.publish({
        name: 'user',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string', format: 'email' },
          },
          required: ['id', 'email'],
        },
      })

      expect(result.name).toBe('user')
      expect(result.version).toBe('1.0.0')
      expect(result.createdAt).toBeInstanceOf(Date)
    })

    it('should publish contract with metadata', async () => {
      await registry.publish({
        name: 'order',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            orderId: { type: 'string' },
          },
        },
        metadata: {
          description: 'Order schema for e-commerce',
          owner: 'commerce-team',
          namespace: 'core',
          tags: ['commerce', 'orders'],
        },
      })

      const contract = await registry.get('order')
      expect(contract.metadata?.description).toBe('Order schema for e-commerce')
      expect(contract.metadata?.owner).toBe('commerce-team')
      expect(contract.metadata?.namespace).toBe('core')
      expect(contract.metadata?.tags).toContain('commerce')
    })

    it('should reject invalid version format', async () => {
      await expect(
        registry.publish({
          name: 'test',
          version: 'invalid',
          schema: { type: 'object' },
        })
      ).rejects.toThrow('Invalid version format')
    })

    it('should store multiple versions of same contract', async () => {
      await registry.publish({
        name: 'user',
        version: '1.0.0',
        schema: { type: 'object', properties: { id: { type: 'string' } } },
      })

      await registry.publish({
        name: 'user',
        version: '1.1.0',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
          },
        },
      })

      const v1 = await registry.get('user', '1.0.0')
      const v11 = await registry.get('user', '1.1.0')

      expect(v1.schema.properties?.email).toBeUndefined()
      expect(v11.schema.properties?.email).toBeDefined()
    })
  })

  // ============================================================================
  // RETRIEVAL
  // ============================================================================

  describe('retrieval', () => {
    beforeEach(async () => {
      await registry.publish({
        name: 'user',
        version: '1.0.0',
        schema: { type: 'object', properties: { id: { type: 'string' } } },
      })
      await registry.publish({
        name: 'user',
        version: '2.0.0',
        schema: { type: 'object', properties: { userId: { type: 'string' } } },
      })
    })

    it('should get specific version', async () => {
      const contract = await registry.get('user', '1.0.0')
      expect(contract.version).toBe('1.0.0')
      expect(contract.schema.properties?.id).toBeDefined()
    })

    it('should get latest version by default', async () => {
      const contract = await registry.get('user')
      expect(contract.version).toBe('2.0.0')
    })

    it('should throw for non-existent contract', async () => {
      await expect(registry.get('non-existent')).rejects.toThrow('Contract not found')
    })

    it('should throw for non-existent version', async () => {
      await expect(registry.get('user', '9.9.9')).rejects.toThrow('Contract version not found')
    })

    it('should check if contract exists', async () => {
      expect(await registry.exists('user')).toBe(true)
      expect(await registry.exists('user', '1.0.0')).toBe(true)
      expect(await registry.exists('user', '9.9.9')).toBe(false)
      expect(await registry.exists('non-existent')).toBe(false)
    })

    it('should get version history', async () => {
      const history = await registry.getVersionHistory('user')

      expect(history.length).toBe(2)
      expect(history.map((h) => h.version)).toContain('1.0.0')
      expect(history.map((h) => h.version)).toContain('2.0.0')
    })
  })

  // ============================================================================
  // DISCOVERY
  // ============================================================================

  describe('discovery', () => {
    beforeEach(async () => {
      await registry.publish({
        name: 'user',
        version: '1.0.0',
        schema: { type: 'object', properties: { id: { type: 'string' } } },
        metadata: {
          namespace: 'identity',
          owner: 'platform-team',
          tags: ['core', 'identity'],
          description: 'User profile schema',
        },
      })

      await registry.publish({
        name: 'order',
        version: '1.0.0',
        schema: { type: 'object', properties: { orderId: { type: 'string' } } },
        metadata: {
          namespace: 'commerce',
          owner: 'commerce-team',
          tags: ['commerce', 'transactions'],
          description: 'Order schema for purchases',
        },
      })

      await registry.publish({
        name: 'product',
        version: '1.0.0',
        schema: { type: 'object', properties: { sku: { type: 'string' } } },
        metadata: {
          namespace: 'commerce',
          owner: 'commerce-team',
          tags: ['commerce', 'catalog'],
        },
      })
    })

    it('should list all contracts', async () => {
      const contracts = await registry.list()
      expect(contracts.length).toBe(3)
    })

    it('should filter by namespace', async () => {
      const commerceSchemas = await registry.byNamespace('commerce')
      expect(commerceSchemas.length).toBe(2)
      expect(commerceSchemas.every((s) => s.namespace === 'commerce')).toBe(true)
    })

    it('should filter by owner', async () => {
      const commerceTeamSchemas = await registry.byOwner('commerce-team')
      expect(commerceTeamSchemas.length).toBe(2)
    })

    it('should filter by tag', async () => {
      const coreSchemas = await registry.byTag('core')
      expect(coreSchemas.length).toBe(1)
      expect(coreSchemas[0]!.name).toBe('user')
    })

    it('should search by name', async () => {
      const results = await registry.search('user')
      expect(results.length).toBe(1)
      expect(results[0]!.name).toBe('user')
    })

    it('should search by description', async () => {
      const results = await registry.search('purchases')
      expect(results.length).toBe(1)
      expect(results[0]!.name).toBe('order')
    })

    it('should support pagination', async () => {
      const page1 = await registry.list({ limit: 2 })
      expect(page1.length).toBe(2)

      const page2 = await registry.list({ limit: 2, offset: 2 })
      expect(page2.length).toBe(1)
    })

    it('should combine filters', async () => {
      const results = await registry.list({
        namespace: 'commerce',
        tags: ['transactions'],
      })
      expect(results.length).toBe(1)
      expect(results[0]!.name).toBe('order')
    })
  })

  // ============================================================================
  // DEPRECATION
  // ============================================================================

  describe('deprecation', () => {
    beforeEach(async () => {
      await registry.publish({
        name: 'legacy-user',
        version: '1.0.0',
        schema: { type: 'object', properties: { id: { type: 'string' } } },
      })
    })

    it('should mark contract as deprecated', async () => {
      await registry.deprecate('legacy-user', '1.0.0', {
        message: 'Use user schema instead',
      })

      const contract = await registry.get('legacy-user', '1.0.0')
      expect(contract.metadata?.deprecated).toBe(true)
      expect(contract.metadata?.deprecationMessage).toBe('Use user schema instead')
    })

    it('should check if contract is deprecated', async () => {
      expect(await registry.isDeprecated('legacy-user', '1.0.0')).toBe(false)

      await registry.deprecate('legacy-user', '1.0.0')

      expect(await registry.isDeprecated('legacy-user', '1.0.0')).toBe(true)
    })

    it('should undeprecate contract', async () => {
      await registry.deprecate('legacy-user', '1.0.0')
      expect(await registry.isDeprecated('legacy-user', '1.0.0')).toBe(true)

      await registry.undeprecate('legacy-user', '1.0.0')
      expect(await registry.isDeprecated('legacy-user', '1.0.0')).toBe(false)
    })

    it('should filter deprecated contracts in list', async () => {
      await registry.publish({
        name: 'active-user',
        version: '1.0.0',
        schema: { type: 'object', properties: { id: { type: 'string' } } },
      })

      await registry.deprecate('legacy-user', '1.0.0')

      const activeContracts = await registry.list({ deprecated: false })
      expect(activeContracts.length).toBe(1)
      expect(activeContracts[0]!.name).toBe('active-user')

      const deprecatedContracts = await registry.list({ deprecated: true })
      expect(deprecatedContracts.length).toBe(1)
      expect(deprecatedContracts[0]!.name).toBe('legacy-user')
    })

    it('should add lineage when replacing deprecated contract', async () => {
      await registry.publish({
        name: 'user-v2',
        version: '1.0.0',
        schema: { type: 'object', properties: { userId: { type: 'string' } } },
      })

      await registry.deprecate('legacy-user', '1.0.0', {
        replacedBy: { name: 'user-v2', version: '1.0.0' },
      })

      const lineage = await registry.getLineage('user-v2')
      expect(lineage.derivedFrom.length).toBe(1)
      expect(lineage.derivedFrom[0]!.toContract).toBe('legacy-user')
    })
  })

  // ============================================================================
  // LINEAGE TRACKING
  // ============================================================================

  describe('lineage tracking', () => {
    beforeEach(async () => {
      await registry.publish({
        name: 'user',
        version: '1.0.0',
        schema: { type: 'object', properties: { id: { type: 'string' } } },
      })

      await registry.publish({
        name: 'order',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            orderId: { type: 'string' },
            userId: { type: 'string' },
          },
        },
      })

      await registry.publish({
        name: 'analytics-event',
        version: '1.0.0',
        schema: { type: 'object', properties: { eventType: { type: 'string' } } },
      })
    })

    it('should add consumer dependency', async () => {
      const rel = await registry.addDependency('order', 'user', 'consumes', {
        description: 'Order references User by userId',
      })

      expect(rel.id).toBeDefined()
      expect(rel.type).toBe('consumes')
      expect(rel.fromContract).toBe('order')
      expect(rel.toContract).toBe('user')
    })

    it('should get lineage graph for a contract', async () => {
      await registry.addDependency('order', 'user', 'consumes')
      await registry.addDependency('analytics-event', 'order', 'consumes')

      const userLineage = await registry.getLineage('user')
      expect(userLineage.consumers.length).toBe(1)
      expect(userLineage.consumers[0]!.fromContract).toBe('order')

      const orderLineage = await registry.getLineage('order')
      expect(orderLineage.producers.length).toBe(1)
      expect(orderLineage.producers[0]!.toContract).toBe('user')
      expect(orderLineage.consumers.length).toBe(1)
      expect(orderLineage.consumers[0]!.fromContract).toBe('analytics-event')
    })

    it('should get all consumers of a contract', async () => {
      await registry.addDependency('order', 'user', 'consumes')
      await registry.addDependency('analytics-event', 'user', 'consumes')

      const consumers = await registry.getConsumers('user')
      expect(consumers.length).toBe(2)
      expect(consumers).toContain('order')
      expect(consumers).toContain('analytics-event')
    })

    it('should get all providers of a contract', async () => {
      await registry.addDependency('order', 'user', 'consumes')

      const providers = await registry.getProviders('order')
      expect(providers.length).toBe(1)
      expect(providers[0]).toBe('user')
    })

    it('should remove dependency', async () => {
      const rel = await registry.addDependency('order', 'user', 'consumes')
      await registry.removeDependency(rel.id)

      const lineage = await registry.getLineage('user')
      expect(lineage.consumers.length).toBe(0)
    })

    it('should track derived-from relationships', async () => {
      await registry.publish({
        name: 'user-v2',
        version: '1.0.0',
        schema: { type: 'object', properties: { userId: { type: 'string' } } },
      })

      await registry.addDependency('user-v2', 'user', 'derived-from', {
        description: 'Evolution of user schema',
      })

      const lineage = await registry.getLineage('user-v2')
      expect(lineage.derivedFrom.length).toBe(1)
      expect(lineage.derivedFrom[0]!.toContract).toBe('user')

      const userLineage = await registry.getLineage('user')
      expect(userLineage.derivatives.length).toBe(1)
    })
  })

  // ============================================================================
  // VALIDATION
  // ============================================================================

  describe('validation', () => {
    beforeEach(async () => {
      await registry.publish({
        name: 'user',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string', format: 'email' },
            age: { type: 'integer', minimum: 0, maximum: 150 },
          },
          required: ['id', 'email'],
        },
      })
    })

    it('should validate valid data', async () => {
      const result = await registry.validate('user', {
        id: 'user-123',
        email: 'alice@example.com',
        age: 30,
      })

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should fail validation for missing required fields', async () => {
      const result = await registry.validate('user', {
        id: 'user-123',
        // missing email
      })

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should fail validation for invalid format', async () => {
      const result = await registry.validate('user', {
        id: 'user-123',
        email: 'not-an-email',
      })

      expect(result.valid).toBe(false)
    })

    it('should validate against specific version', async () => {
      await registry.publish({
        name: 'user',
        version: '2.0.0',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
          },
          required: ['id', 'email', 'phone'],
        },
      })

      const data = { id: 'user-123', email: 'alice@example.com' }

      const v1Result = await registry.validate('user', data, '1.0.0')
      expect(v1Result.valid).toBe(true)

      const v2Result = await registry.validate('user', data, '2.0.0')
      expect(v2Result.valid).toBe(false)
    })
  })

  // ============================================================================
  // COMPATIBILITY CHECKING
  // ============================================================================

  describe('compatibility checking', () => {
    beforeEach(async () => {
      await registry.publish({
        name: 'user',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            name: { type: 'string' },
          },
          required: ['id', 'email'],
        },
      })
    })

    it('should detect compatible changes (added optional field)', async () => {
      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
          name: { type: 'string' },
          phone: { type: 'string' },
        },
        required: ['id', 'email'],
      }

      const result = await registry.checkCompatibility('user', '1.1.0', newSchema)

      expect(result.compatible).toBe(true)
      expect(result.breakingChanges).toHaveLength(0)
    })

    it('should detect breaking change: removed required field', async () => {
      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id'],
      }

      const result = await registry.checkCompatibility('user', '2.0.0', newSchema)

      expect(result.compatible).toBe(false)
      expect(result.breakingChanges.some((c) => c.includes('email'))).toBe(true)
    })

    it('should detect breaking change: type changed', async () => {
      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          email: { type: 'string' },
        },
        required: ['id', 'email'],
      }

      const result = await registry.checkCompatibility('user', '2.0.0', newSchema)

      expect(result.compatible).toBe(false)
      expect(result.breakingChanges.some((c) => c.includes('type'))).toBe(true)
    })

    it('should suggest appropriate version bump', async () => {
      // Compatible change -> minor
      const compatibleSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
        },
        required: ['id', 'email'],
      }

      const compatResult = await registry.checkCompatibility('user', '1.1.0', compatibleSchema)
      expect(compatResult.suggestedVersionBump).toBe('minor')

      // Breaking change -> major
      const breakingSchema: JSONSchema = {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['userId', 'email'],
      }

      const breakResult = await registry.checkCompatibility('user', '2.0.0', breakingSchema)
      expect(breakResult.suggestedVersionBump).toBe('major')
    })
  })

  // ============================================================================
  // MIGRATION
  // ============================================================================

  describe('migration', () => {
    beforeEach(async () => {
      await registry.publish({
        name: 'user',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            name: { type: 'string' },
          },
          required: ['id', 'email'],
        },
      })
    })

    it('should generate migration for schema changes', async () => {
      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
        },
        required: ['id', 'email'],
      }

      const migration = await registry.generateMigration('user', '1.0.0', newSchema)

      expect(migration.changes).toContainEqual(
        expect.objectContaining({
          type: 'remove',
          field: 'name',
        })
      )
      expect(migration.changes).toContainEqual(
        expect.objectContaining({
          type: 'add',
          field: 'phone',
        })
      )
    })

    it('should apply migration to data', async () => {
      const migration = {
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        changes: [
          { type: 'rename' as const, from: 'name', to: 'fullName' },
          { type: 'add' as const, field: 'phone', defaultValue: '' },
        ],
      }

      const oldData = {
        id: 'user-123',
        email: 'alice@example.com',
        name: 'Alice Smith',
      }

      const newData = registry.applyMigration(oldData, migration)

      expect(newData.fullName).toBe('Alice Smith')
      expect(newData.name).toBeUndefined()
      expect(newData.phone).toBe('')
    })
  })

  // ============================================================================
  // TYPESCRIPT GENERATION
  // ============================================================================

  describe('TypeScript generation', () => {
    it('should generate interface from schema', async () => {
      await registry.publish({
        name: 'user',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            age: { type: 'integer' },
            active: { type: 'boolean' },
          },
          required: ['id', 'email'],
        },
      })

      const types = await registry.generateTypes('user')

      expect(types).toContain('interface User')
      expect(types).toContain('id: string')
      expect(types).toContain('email: string')
      expect(types).toContain('age?: number')
      expect(types).toContain('active?: boolean')
    })

    it('should generate types for enums', async () => {
      await registry.publish({
        name: 'status',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['pending', 'active', 'closed'],
            },
          },
        },
      })

      const types = await registry.generateTypes('status')

      expect(types).toMatch(/status\?:\s*['"]pending['"]\s*\|\s*['"]active['"]\s*\|\s*['"]closed['"]/)
    })

    it('should generate types for arrays', async () => {
      await registry.publish({
        name: 'order',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      })

      const types = await registry.generateTypes('order')

      expect(types).toContain('items?: string[]')
    })
  })

  // ============================================================================
  // DELETION
  // ============================================================================

  describe('deletion', () => {
    it('should delete a contract version', async () => {
      await registry.publish({
        name: 'user',
        version: '1.0.0',
        schema: { type: 'object', properties: { id: { type: 'string' } } },
      })

      await registry.publish({
        name: 'user',
        version: '2.0.0',
        schema: { type: 'object', properties: { userId: { type: 'string' } } },
      })

      await registry.delete('user', '1.0.0')

      const versions = await registry.getVersions('user')
      expect(versions).toEqual(['2.0.0'])
    })

    it('should clean up lineage when deleting contract', async () => {
      await registry.publish({
        name: 'user',
        version: '1.0.0',
        schema: { type: 'object', properties: { id: { type: 'string' } } },
      })

      await registry.publish({
        name: 'order',
        version: '1.0.0',
        schema: { type: 'object', properties: { orderId: { type: 'string' } } },
      })

      await registry.addDependency('order', 'user', 'consumes')

      await registry.delete('user', '1.0.0')

      const lineage = await registry.getLineage('order')
      expect(lineage.producers.length).toBe(0)
    })
  })
})
