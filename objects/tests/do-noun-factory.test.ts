/**
 * DO Noun Factory Tests
 *
 * Tests demonstrating the DO(Noun) pattern - creating typed Durable Objects
 * from Noun definitions with automatic schema validation.
 *
 * This pattern enables:
 * - Type-safe DO classes from Noun schemas
 * - Automatic data validation via Zod
 * - Extension via standard class inheritance
 * - Collection CRUD operations for multi-entity DOs
 *
 * @example
 * ```typescript
 * // Create a DO class from a Noun
 * const StartupDO = createDO(Startup)
 *
 * // Extend with custom business logic
 * class MyStartupDO extends createDO(Startup) {
 *   async calculateRunway() {
 *     const data = await this.data()
 *     return data.cashBalance / data.burnRate
 *   }
 * }
 * ```
 *
 * NOTE: This test file tests the Noun definitions and factory patterns
 * without requiring the full DO runtime (which has SQLite dependencies).
 * For full integration tests with real DOs, see the Workers workspace tests.
 */

import { describe, it, expect, vi } from 'vitest'
import { Startup, StartupSchema } from '../../nouns/business/Startup'
import { Worker, WorkerSchema } from '../../nouns/workers/Worker'
import { defineNoun, type Noun } from '../../nouns/types'
import { z } from 'zod'

// ============================================================================
// TYPE DEFINITIONS (mirrors DOFactory types for testing)
// ============================================================================

/**
 * Type helper to extract the inferred type from a Noun's schema
 */
type NounData<N extends Noun> = N extends Noun<infer T> ? z.infer<T> : never

// ============================================================================
// MOCK DO BASE CLASS (simulates the core DO functionality)
// ============================================================================

/**
 * Mock Durable Object ID
 */
interface MockDOId {
  toString(): string
  name: string
}

/**
 * Mock storage interface
 */
interface MockStorage {
  data: Map<string, unknown>
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<boolean>
  list<T>(options?: { type?: string; limit?: number; offset?: number }): Promise<T[]>
}

/**
 * Mock DO state
 */
interface MockState {
  id: MockDOId
  storage: MockStorage
}

/**
 * Create mock storage for testing
 */
function createMockStorage(): MockStorage {
  const data = new Map<string, unknown>()
  return {
    data,
    async get<T>(key: string): Promise<T | undefined> {
      return data.get(key) as T | undefined
    },
    async put(key: string, value: unknown): Promise<void> {
      data.set(key, value)
    },
    async delete(key: string): Promise<boolean> {
      return data.delete(key)
    },
    async list<T>(options?: { type?: string; limit?: number; offset?: number }): Promise<T[]> {
      const items: T[] = []
      for (const [key, value] of data) {
        if (key.startsWith('thing:') && (!options?.type || (value as any)?.$type === options.type)) {
          items.push(value as T)
        }
      }
      const offset = options?.offset ?? 0
      const limit = options?.limit ?? items.length
      return items.slice(offset, offset + limit)
    },
  }
}

/**
 * Create mock state for testing
 */
function createMockState(name: string = 'test-id'): MockState {
  return {
    id: { toString: () => name, name },
    storage: createMockStorage(),
  }
}

/**
 * Base Mock DO class (simulates core DO behavior)
 */
class MockDO {
  protected ctx: MockState
  protected env: unknown

  constructor(ctx: MockState, env: unknown) {
    this.ctx = ctx
    this.env = env
  }

  get id() {
    return {
      full: `DO/${this.ctx.id.name}`,
    }
  }

  get things() {
    const storage = this.ctx.storage
    return {
      async get(id: string) {
        return storage.get(`thing:${id}`)
      },
      async create(data: unknown) {
        const $id = (data as any).$id
        await storage.put(`thing:${$id}`, data)
        return data
      },
      async upsert(data: unknown) {
        const $id = (data as any).$id
        await storage.put(`thing:${$id}`, data)
        return data
      },
      async delete(id: string) {
        return storage.delete(`thing:${id}`)
      },
      async list(options?: { type?: string; limit?: number; offset?: number }) {
        return storage.list(options)
      },
    }
  }

  toJSON() {
    return {
      id: this.ctx.id.name,
    }
  }
}

// ============================================================================
// FACTORY FUNCTIONS (mirrors DOFactory implementation)
// ============================================================================

/**
 * Create a DO class from a Noun definition
 */
function createDO<N extends Noun>(noun: N) {
  return class NounBasedDO extends MockDO {
    readonly noun = noun

    /**
     * Get the validated data for this entity
     */
    async data(): Promise<NounData<N>> {
      const thing = await this.things.get(this.id.full)
      if (!thing) {
        if (noun.defaults) {
          return {
            $id: this.id.full,
            $type: noun.$type,
            ...noun.defaults,
          } as NounData<N>
        }
        throw new Error(`${noun.noun} not found: ${this.id.full}`)
      }
      return this.validate(thing)
    }

    /**
     * Update the entity data with validation
     */
    async update(data: Partial<NounData<N>>): Promise<NounData<N>> {
      const current = await this.data()
      const updated = { ...current, ...data }
      const validated = this.validate(updated)

      await this.things.upsert({
        $id: this.id.full,
        $type: noun.$type,
        ...validated,
      })

      return validated
    }

    /**
     * Validate data against the Noun schema
     */
    validate(data: unknown): NounData<N> {
      return noun.schema.parse(data) as NounData<N>
    }

    toJSON() {
      return {
        ...super.toJSON(),
        noun: noun.noun,
        $type: noun.$type,
      }
    }
  }
}

/**
 * Create a Collection DO class from a Noun definition
 */
function createCollectionDO<N extends Noun>(noun: N) {
  return class CollectionBasedDO extends MockDO {
    readonly itemNoun = noun

    /**
     * List all items in the collection
     */
    async list(options?: { limit?: number; offset?: number }): Promise<NounData<N>[]> {
      const items = await this.things.list({
        type: noun.$type,
        limit: options?.limit ?? 100,
        offset: options?.offset ?? 0,
      })
      return items.map((item) => noun.schema.parse(item) as NounData<N>)
    }

    /**
     * Get a single item by ID
     */
    async get(id: string): Promise<NounData<N> | null> {
      const item = await this.things.get(id)
      if (!item) return null
      return noun.schema.parse(item) as NounData<N>
    }

    /**
     * Create a new item in the collection
     */
    async create(data: Omit<NounData<N>, '$id' | '$type'>): Promise<NounData<N>> {
      const $id = `${noun.noun}/${crypto.randomUUID()}`
      const item = {
        $id,
        $type: noun.$type,
        ...noun.defaults,
        ...data,
      }
      const validated = noun.schema.parse(item) as NounData<N>
      await this.things.create(validated)
      return validated
    }

    /**
     * Update an item in the collection
     */
    async update(id: string, data: Partial<NounData<N>>): Promise<NounData<N>> {
      const existing = await this.get(id)
      if (!existing) {
        throw new Error(`${noun.noun} not found: ${id}`)
      }
      const updated = { ...existing, ...data }
      const validated = noun.schema.parse(updated) as NounData<N>
      await this.things.upsert(validated)
      return validated
    }

    /**
     * Delete an item from the collection
     */
    async delete(id: string): Promise<boolean> {
      const existing = await this.get(id)
      if (!existing) return false
      await this.things.delete(id)
      return true
    }

    /**
     * Count items in the collection
     */
    async count(): Promise<number> {
      const allItems = await this.things.list({ type: noun.$type, limit: 1000000 })
      return allItems.length
    }

    toJSON() {
      return {
        ...super.toJSON(),
        collection: noun.plural,
        itemType: noun.$type,
      }
    }
  }
}

// ============================================================================
// TESTS: Noun Definitions
// ============================================================================

describe('DO Noun Factory', () => {
  // ==========================================================================
  // TESTS: Noun Definition Structure
  // ==========================================================================

  describe('Noun Definitions', () => {
    it('Startup noun has correct structure', () => {
      expect(Startup.noun).toBe('Startup')
      expect(Startup.plural).toBe('Startups')
      expect(Startup.$type).toBe('https://schema.org.ai/Startup')
      expect(Startup.schema).toBeDefined()
      expect(Startup.extends).toBe('SaaS')
    })

    it('Worker noun has correct structure', () => {
      expect(Worker.noun).toBe('Worker')
      expect(Worker.plural).toBe('Workers')
      expect(Worker.$type).toBe('https://schema.org.ai/Worker')
      expect(Worker.schema).toBeDefined()
    })

    it('Worker noun has defaults', () => {
      expect(Worker.defaults).toBeDefined()
      expect(Worker.defaults?.status).toBe('available')
      expect(Worker.defaults?.skills).toEqual([])
    })

    it('Startup noun has OKRs defined', () => {
      expect(Startup.okrs).toBeDefined()
      expect(Startup.okrs).toContain('Revenue')
      expect(Startup.okrs).toContain('Runway')
      expect(Startup.okrs).toContain('BurnRate')
    })
  })

  // ==========================================================================
  // TESTS: Schema Validation
  // ==========================================================================

  describe('Schema Validation', () => {
    it('should validate valid Startup data', () => {
      const validStartup = {
        $id: 'Startup/test-1',
        $type: 'https://schema.org.ai/Startup' as const,
        name: 'Acme Inc',
        fundingStage: 'seed' as const,
      }

      const result = StartupSchema.safeParse(validStartup)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('Acme Inc')
        expect(result.data.fundingStage).toBe('seed')
      }
    })

    it('should reject invalid Startup data (missing name)', () => {
      const invalidStartup = {
        $id: 'Startup/test-1',
        $type: 'https://schema.org.ai/Startup',
        // name is missing
      }

      const result = StartupSchema.safeParse(invalidStartup)
      expect(result.success).toBe(false)
    })

    it('should validate valid Worker data', () => {
      const validWorker = {
        $id: 'Worker/test-1',
        $type: 'https://schema.org.ai/Worker' as const,
        name: 'Agent-1',
        skills: ['coding', 'testing'],
        status: 'available' as const,
      }

      const result = WorkerSchema.safeParse(validWorker)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('Agent-1')
        expect(result.data.skills).toContain('coding')
        expect(result.data.status).toBe('available')
      }
    })

    it('should reject invalid Worker data (invalid status)', () => {
      const invalidWorker = {
        $id: 'Worker/test-1',
        $type: 'https://schema.org.ai/Worker',
        name: 'Agent-1',
        skills: [],
        status: 'invalid-status', // Not a valid status enum value
      }

      const result = WorkerSchema.safeParse(invalidWorker)
      expect(result.success).toBe(false)
    })
  })

  // ==========================================================================
  // TESTS: createDO Factory Function
  // ==========================================================================

  describe('createDO', () => {
    it('should create a DO class from a Noun', () => {
      const StartupDO = createDO(Startup)

      expect(StartupDO).toBeDefined()
      expect(typeof StartupDO).toBe('function')
      expect(StartupDO.prototype).toBeDefined()
    })

    it('should have noun reference on instance', () => {
      const StartupDO = createDO(Startup)
      const mockState = createMockState('startup-noun')
      const instance = new StartupDO(mockState, {})

      expect(instance.noun).toBe(Startup)
    })

    it('should have data method', () => {
      const StartupDO = createDO(Startup)

      expect(typeof StartupDO.prototype.data).toBe('function')
    })

    it('should have update method', () => {
      const StartupDO = createDO(Startup)

      expect(typeof StartupDO.prototype.update).toBe('function')
    })

    it('should have validate method', () => {
      const StartupDO = createDO(Startup)

      expect(typeof StartupDO.prototype.validate).toBe('function')
    })

    it('should validate data correctly', () => {
      const StartupDO = createDO(Startup)
      const mockState = createMockState('startup-1')
      const instance = new StartupDO(mockState, {})

      const validData = {
        $id: 'Startup/test-1',
        $type: 'https://schema.org.ai/Startup' as const,
        name: 'Test Startup',
      }

      const result = instance.validate(validData)
      expect(result.name).toBe('Test Startup')
    })

    it('should throw on invalid data during validation', () => {
      const StartupDO = createDO(Startup)
      const mockState = createMockState('startup-1')
      const instance = new StartupDO(mockState, {})

      const invalidData = {
        $id: 'Startup/test-1',
        $type: 'https://schema.org.ai/Startup',
        // name is missing
      }

      expect(() => instance.validate(invalidData)).toThrow()
    })

    it('should serialize with noun metadata', () => {
      const StartupDO = createDO(Startup)
      const mockState = createMockState('startup-json')
      const instance = new StartupDO(mockState, {})

      const json = instance.toJSON()

      expect(json.noun).toBe('Startup')
      expect(json.$type).toBe('https://schema.org.ai/Startup')
    })
  })

  // ==========================================================================
  // TESTS: createCollectionDO Factory Function
  // ==========================================================================

  describe('createCollectionDO', () => {
    it('should create a collection DO from a Noun', () => {
      const WorkersDO = createCollectionDO(Worker)

      expect(WorkersDO).toBeDefined()
      expect(typeof WorkersDO).toBe('function')
    })

    it('should have itemNoun reference on instance', () => {
      const WorkersDO = createCollectionDO(Worker)
      const mockState = createMockState('workers-noun')
      const instance = new WorkersDO(mockState, {})

      expect(instance.itemNoun).toBe(Worker)
    })

    it('should have list method', () => {
      const WorkersDO = createCollectionDO(Worker)

      expect(typeof WorkersDO.prototype.list).toBe('function')
    })

    it('should have get method', () => {
      const WorkersDO = createCollectionDO(Worker)

      expect(typeof WorkersDO.prototype.get).toBe('function')
    })

    it('should have create method', () => {
      const WorkersDO = createCollectionDO(Worker)

      expect(typeof WorkersDO.prototype.create).toBe('function')
    })

    it('should have update method', () => {
      const WorkersDO = createCollectionDO(Worker)

      expect(typeof WorkersDO.prototype.update).toBe('function')
    })

    it('should have delete method', () => {
      const WorkersDO = createCollectionDO(Worker)

      expect(typeof WorkersDO.prototype.delete).toBe('function')
    })

    it('should have count method', () => {
      const WorkersDO = createCollectionDO(Worker)

      expect(typeof WorkersDO.prototype.count).toBe('function')
    })

    it('should serialize with collection metadata', () => {
      const WorkersDO = createCollectionDO(Worker)
      const mockState = createMockState('workers-json')
      const instance = new WorkersDO(mockState, {})

      const json = instance.toJSON()

      expect(json.collection).toBe('Workers')
      expect(json.itemType).toBe('https://schema.org.ai/Worker')
    })
  })

  // ==========================================================================
  // TESTS: Extending Created DOs
  // ==========================================================================

  describe('extending created DOs', () => {
    it('should allow extending with custom methods', () => {
      class MyStartupDO extends createDO(Startup) {
        calculateRunwayMonths(): number {
          return 18
        }

        isLateStageFunding(stage: string): boolean {
          const lateStages = ['series-c', 'series-d', 'series-e', 'growth', 'pre-ipo']
          return lateStages.includes(stage)
        }
      }

      // Custom methods are accessible
      expect(typeof MyStartupDO.prototype.calculateRunwayMonths).toBe('function')
      expect(typeof MyStartupDO.prototype.isLateStageFunding).toBe('function')

      // Inherited methods are still present
      expect(typeof MyStartupDO.prototype.data).toBe('function')
      expect(typeof MyStartupDO.prototype.update).toBe('function')
      expect(typeof MyStartupDO.prototype.validate).toBe('function')
    })

    it('should allow extending collection DO with custom query methods', () => {
      class MyWorkersDO extends createCollectionDO(Worker) {
        async findAvailable(): Promise<NounData<typeof Worker>[]> {
          const all = await this.list()
          return all.filter((w) => w.status === 'available')
        }

        async findBySkill(skill: string): Promise<NounData<typeof Worker>[]> {
          const all = await this.list()
          return all.filter((w) => w.skills.includes(skill))
        }
      }

      // Custom methods are accessible
      expect(typeof MyWorkersDO.prototype.findAvailable).toBe('function')
      expect(typeof MyWorkersDO.prototype.findBySkill).toBe('function')

      // Inherited collection methods are still present
      expect(typeof MyWorkersDO.prototype.list).toBe('function')
      expect(typeof MyWorkersDO.prototype.get).toBe('function')
      expect(typeof MyWorkersDO.prototype.create).toBe('function')
      expect(typeof MyWorkersDO.prototype.update).toBe('function')
      expect(typeof MyWorkersDO.prototype.delete).toBe('function')
    })

    it('should maintain noun reference in extended class', () => {
      class MyStartupDO extends createDO(Startup) {}

      const mockState = createMockState('startup-extended')
      const instance = new MyStartupDO(mockState, {})

      expect(instance.noun).toBe(Startup)
      expect(instance.noun.$type).toBe('https://schema.org.ai/Startup')
    })
  })

  // ==========================================================================
  // TESTS: Collection CRUD Operations
  // ==========================================================================

  describe('Collection CRUD Operations', () => {
    it('should create and retrieve items', async () => {
      const WorkersDO = createCollectionDO(Worker)
      const mockState = createMockState('workers-crud')
      const instance = new WorkersDO(mockState, {})

      // Create a worker
      const created = await instance.create({
        name: 'Agent-1',
        skills: ['coding'],
        status: 'available',
      } as Omit<NounData<typeof Worker>, '$id' | '$type'>)

      expect(created.$id).toBeDefined()
      expect(created.$id).toMatch(/^Worker\//)
      expect(created.name).toBe('Agent-1')

      // Retrieve by ID
      const retrieved = await instance.get(created.$id)
      expect(retrieved).toBeDefined()
      expect(retrieved?.name).toBe('Agent-1')
    })

    it('should list all items', async () => {
      const WorkersDO = createCollectionDO(Worker)
      const mockState = createMockState('workers-list')
      const instance = new WorkersDO(mockState, {})

      // Create multiple workers
      await instance.create({
        name: 'Agent-1',
        skills: ['coding'],
        status: 'available',
      } as Omit<NounData<typeof Worker>, '$id' | '$type'>)

      await instance.create({
        name: 'Agent-2',
        skills: ['testing'],
        status: 'busy',
      } as Omit<NounData<typeof Worker>, '$id' | '$type'>)

      const all = await instance.list()
      expect(all.length).toBe(2)
    })

    it('should update items', async () => {
      const WorkersDO = createCollectionDO(Worker)
      const mockState = createMockState('workers-update')
      const instance = new WorkersDO(mockState, {})

      const created = await instance.create({
        name: 'Agent-1',
        skills: ['coding'],
        status: 'available',
      } as Omit<NounData<typeof Worker>, '$id' | '$type'>)

      const updated = await instance.update(created.$id, {
        status: 'busy',
      })

      expect(updated.status).toBe('busy')
      expect(updated.name).toBe('Agent-1') // Unchanged
    })

    it('should delete items', async () => {
      const WorkersDO = createCollectionDO(Worker)
      const mockState = createMockState('workers-delete')
      const instance = new WorkersDO(mockState, {})

      const created = await instance.create({
        name: 'Agent-1',
        skills: ['coding'],
        status: 'available',
      } as Omit<NounData<typeof Worker>, '$id' | '$type'>)

      const deleted = await instance.delete(created.$id)
      expect(deleted).toBe(true)

      const retrieved = await instance.get(created.$id)
      expect(retrieved).toBeNull()
    })

    it('should count items', async () => {
      const WorkersDO = createCollectionDO(Worker)
      const mockState = createMockState('workers-count')
      const instance = new WorkersDO(mockState, {})

      expect(await instance.count()).toBe(0)

      await instance.create({
        name: 'Agent-1',
        skills: ['coding'],
        status: 'available',
      } as Omit<NounData<typeof Worker>, '$id' | '$type'>)

      expect(await instance.count()).toBe(1)

      await instance.create({
        name: 'Agent-2',
        skills: ['testing'],
        status: 'available',
      } as Omit<NounData<typeof Worker>, '$id' | '$type'>)

      expect(await instance.count()).toBe(2)
    })
  })

  // ==========================================================================
  // TESTS: Custom Noun Definition
  // ==========================================================================

  describe('Custom Noun Definition', () => {
    it('should work with custom-defined nouns', () => {
      // Define a custom noun
      const CustomerSchema = z.object({
        $id: z.string(),
        $type: z.literal('https://example.com/Customer'),
        name: z.string(),
        email: z.string().email(),
        tier: z.enum(['free', 'pro', 'enterprise']).default('free'),
      })

      const Customer = defineNoun({
        noun: 'Customer',
        plural: 'Customers',
        $type: 'https://example.com/Customer',
        schema: CustomerSchema,
        defaults: {
          tier: 'free',
        },
      })

      // Create a DO class from the custom noun
      const CustomerDO = createDO(Customer)
      const mockState = createMockState('customer-1')
      const instance = new CustomerDO(mockState, {})

      // Validate data
      const validData = {
        $id: 'Customer/test-1',
        $type: 'https://example.com/Customer' as const,
        name: 'John Doe',
        email: 'john@example.com',
        tier: 'pro' as const,
      }

      const result = instance.validate(validData)
      expect(result.name).toBe('John Doe')
      expect(result.tier).toBe('pro')
    })

    it('should work with custom collection nouns', async () => {
      const TaskSchema = z.object({
        $id: z.string(),
        $type: z.literal('https://example.com/Task'),
        title: z.string(),
        completed: z.boolean().default(false),
        priority: z.number().min(1).max(5).default(3),
      })

      const Task = defineNoun({
        noun: 'Task',
        plural: 'Tasks',
        $type: 'https://example.com/Task',
        schema: TaskSchema,
        defaults: {
          completed: false,
          priority: 3,
        },
      })

      const TasksDO = createCollectionDO(Task)
      const mockState = createMockState('tasks-1')
      const instance = new TasksDO(mockState, {})

      // Create a task
      const created = await instance.create({
        title: 'Write tests',
        completed: false,
        priority: 1,
      } as Omit<NounData<typeof Task>, '$id' | '$type'>)

      expect(created.title).toBe('Write tests')
      expect(created.priority).toBe(1)
      expect(await instance.count()).toBe(1)
    })
  })
})
