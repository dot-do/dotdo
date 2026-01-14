/**
 * Domain Class Hierarchy Tests
 *
 * Comprehensive tests verifying the complete domain class hierarchy:
 * - Product, Service, SaaS, Marketplace, Directory, App, Site, API, SDK, CLI
 *
 * The hierarchy is:
 * - DO (base)
 *   - Business (multi-tenant organization with OKRs)
 *     - DigitalBusiness (Traffic, Conversion, Engagement)
 *       - SaaS (MRR, Churn, NRR, CAC, LTV)
 *         - Startup (Runway, Burn, GrowthRate, PMFScore)
 *       - Marketplace (GMV, TakeRate, Liquidity)
 *       - API (APICalls, Latency, ErrorRate)
 *     - Service (AI-delivered Services-as-Software)
 *   - Entity (domain object with schema validation)
 *     - Product (sellable product with variants)
 *     - Collection (typed collection)
 *     - Directory (hierarchical organization)
 *     - Package (versioned package)
 *       - SDK (client SDK)
 *       - CLI (command-line interface)
 *   - App (application container)
 *   - Site (website/domain)
 */

import { describe, it, expect, vi } from 'vitest'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

interface MockSqlCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[]
}

function createMockSqlStorage() {
  return {
    exec(_query: string, ..._params: unknown[]): MockSqlCursor {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
  }
}

function createMockKvStorage() {
  const storage = new Map<string, unknown>()

  return {
    get: vi.fn(async <T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined> => {
      if (Array.isArray(key)) {
        const result = new Map<string, T>()
        for (const k of key) {
          const value = storage.get(k)
          if (value !== undefined) {
            result.set(k, value as T)
          }
        }
        return result as Map<string, T>
      }
      return storage.get(key) as T | undefined
    }),
    put: vi.fn(async <T>(key: string | Record<string, T>, value?: T): Promise<void> => {
      if (typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) {
          storage.set(k, v)
        }
      } else {
        storage.set(key, value)
      }
    }),
    delete: vi.fn(async (key: string | string[]): Promise<boolean | number> => {
      if (Array.isArray(key)) {
        let count = 0
        for (const k of key) {
          if (storage.delete(k)) count++
        }
        return count
      }
      return storage.delete(key)
    }),
    deleteAll: vi.fn(async (): Promise<void> => {
      storage.clear()
    }),
    list: vi.fn(async <T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> => {
      const result = new Map<string, T>()
      for (const [key, value] of storage) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.set(key, value as T)
        }
      }
      return result
    }),
    _storage: storage,
  }
}

interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  name?: string
}

function createMockDOId(name: string = 'test-id'): DurableObjectId {
  return {
    toString: () => name,
    equals: (other: DurableObjectId) => other.toString() === name,
    name,
  }
}

interface DurableObjectState {
  id: DurableObjectId
  storage: unknown
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

function createMockState(idName: string = 'test-id'): DurableObjectState {
  const kvStorage = createMockKvStorage()
  const sqlStorage = createMockSqlStorage()

  return {
    id: createMockDOId(idName),
    storage: {
      ...kvStorage,
      sql: sqlStorage,
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async <T>(callback: () => Promise<T>): Promise<T> => callback()),
  } as unknown as DurableObjectState
}

function createMockEnv() {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
  }
}

// ============================================================================
// HIERARCHY TESTS
// ============================================================================

describe('Domain Class Hierarchy', () => {
  describe('Business Hierarchy', () => {
    it('Business extends DO', async () => {
      const { Business } = await import('../Business')
      const { DO } = await import('../DO')

      const state = createMockState()
      const env = createMockEnv()
      const business = new Business(state, env)

      expect(business).toBeInstanceOf(DO)
      expect(Business.$type).toBe('Business')
    })

    it('Business has core OKRs (Revenue, Costs, Profit)', async () => {
      const { Business } = await import('../Business')

      const state = createMockState()
      const env = createMockEnv()
      const business = new Business(state, env)

      expect(business.okrs.Revenue).toBeDefined()
      expect(business.okrs.Costs).toBeDefined()
      expect(business.okrs.Profit).toBeDefined()
    })

    it('DigitalBusiness extends Business with digital OKRs', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')
      const { Business } = await import('../Business')

      const state = createMockState()
      const env = createMockEnv()
      const digitalBusiness = new DigitalBusiness(state, env)

      expect(digitalBusiness).toBeInstanceOf(Business)
      expect(digitalBusiness.okrs.Traffic).toBeDefined()
      expect(digitalBusiness.okrs.Conversion).toBeDefined()
      expect(digitalBusiness.okrs.Engagement).toBeDefined()
    })

    it('SaaS extends DigitalBusiness with SaaS OKRs', async () => {
      const { SaaS } = await import('../SaaS')
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const state = createMockState()
      const env = createMockEnv()
      const saas = new SaaS(state, env)

      expect(saas).toBeInstanceOf(DigitalBusiness)
      expect(SaaS.$type).toBe('SaaS')
      expect(saas.okrs.MRR).toBeDefined()
      expect(saas.okrs.Churn).toBeDefined()
      expect(saas.okrs.NRR).toBeDefined()
      expect(saas.okrs.CAC).toBeDefined()
      expect(saas.okrs.LTV).toBeDefined()
    })

    it('Startup extends SaaS with startup OKRs', async () => {
      const { Startup } = await import('../Startup')
      const { SaaS } = await import('../SaaS')

      const state = createMockState()
      const env = createMockEnv()
      const startup = new Startup(state, env)

      expect(startup).toBeInstanceOf(SaaS)
      expect(Startup.$type).toBe('Startup')
      expect(startup.okrs.Runway).toBeDefined()
      expect(startup.okrs.Burn).toBeDefined()
      expect(startup.okrs.GrowthRate).toBeDefined()
      expect(startup.okrs.PMFScore).toBeDefined()
    })

    it('Marketplace extends DigitalBusiness with marketplace OKRs', async () => {
      const { Marketplace } = await import('../Marketplace')
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const state = createMockState()
      const env = createMockEnv()
      const marketplace = new Marketplace(state, env)

      expect(marketplace).toBeInstanceOf(DigitalBusiness)
      expect(Marketplace.$type).toBe('Marketplace')
      expect(marketplace.okrs.GMV).toBeDefined()
      expect(marketplace.okrs.TakeRate).toBeDefined()
      expect(marketplace.okrs.Liquidity).toBeDefined()
    })

    it('API extends DigitalBusiness with API OKRs', async () => {
      const { API } = await import('../API')
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const state = createMockState()
      const env = createMockEnv()
      const api = new API(state, env)

      expect(api).toBeInstanceOf(DigitalBusiness)
      expect(API.$type).toBe('API')
      expect(api.okrs.APICalls).toBeDefined()
      expect(api.okrs.Latency).toBeDefined()
      expect(api.okrs.ErrorRate).toBeDefined()
    })

    it('Service extends Business', async () => {
      const { Service } = await import('../Service')
      const { Business } = await import('../Business')

      const state = createMockState()
      const env = createMockEnv()
      const service = new Service(state, env)

      expect(service).toBeInstanceOf(Business)
      expect(Service.$type).toBe('Service')
      expect(service.okrs.TasksCompleted).toBeDefined()
      expect(service.okrs.QualityScore).toBeDefined()
      expect(service.okrs.ResponseTime).toBeDefined()
      expect(service.okrs.HumanEscalationRate).toBeDefined()
    })
  })

  describe('Entity Hierarchy', () => {
    it('Entity extends DO', async () => {
      const { Entity } = await import('../Entity')
      const { DO } = await import('../DO')

      const state = createMockState()
      const env = createMockEnv()
      const entity = new Entity(state, env)

      expect(entity).toBeInstanceOf(DO)
    })

    it('Product extends Entity', async () => {
      const { Product } = await import('../Product')
      const { Entity } = await import('../Entity')

      const state = createMockState()
      const env = createMockEnv()
      const product = new Product(state, env)

      expect(product).toBeInstanceOf(Entity)
    })

    it('Directory extends Entity', async () => {
      const { Directory } = await import('../Directory')
      const { Entity } = await import('../Entity')

      const state = createMockState()
      const env = createMockEnv()
      const directory = new Directory(state, env)

      expect(directory).toBeInstanceOf(Entity)
    })

    it('Collection extends Entity', async () => {
      const { Collection } = await import('../Collection')
      const { Entity } = await import('../Entity')

      const state = createMockState()
      const env = createMockEnv()
      const collection = new Collection(state, env)

      expect(collection).toBeInstanceOf(Entity)
    })

    it('Package extends Entity', async () => {
      const { Package } = await import('../Package')
      const { Entity } = await import('../Entity')

      const state = createMockState()
      const env = createMockEnv()
      const pkg = new Package(state, env)

      expect(pkg).toBeInstanceOf(Entity)
    })

    it('SDK extends Package', async () => {
      const { SDK } = await import('../SDK')
      const { Package } = await import('../Package')

      const state = createMockState()
      const env = createMockEnv()
      const sdk = new SDK(state, env)

      expect(sdk).toBeInstanceOf(Package)
    })

    it('CLI extends Package', async () => {
      const { CLI } = await import('../CLI')
      const { Package } = await import('../Package')

      const state = createMockState()
      const env = createMockEnv()
      const cli = new CLI(state, env)

      expect(cli).toBeInstanceOf(Package)
    })
  })

  describe('Application Hierarchy', () => {
    it('App extends DO', async () => {
      const { App } = await import('../App')
      const { DO } = await import('../DO')

      const state = createMockState()
      const env = createMockEnv()
      const app = new App(state, env)

      expect(app).toBeInstanceOf(DO)
      expect(App.$type).toBe('App')
    })

    it('Site extends DO', async () => {
      const { Site } = await import('../Site')
      const { DO } = await import('../DO')

      const state = createMockState()
      const env = createMockEnv()
      const site = new Site(state, env)

      expect(site).toBeInstanceOf(DO)
      expect(Site.$type).toBe('Site')
    })
  })

  describe('All classes export from index.ts', () => {
    it('exports all domain classes', async () => {
      const objects = await import('../index')

      // Business hierarchy
      expect(objects.DO).toBeDefined()
      expect(objects.Business).toBeDefined()
      expect(objects.DigitalBusiness).toBeDefined()
      expect(objects.SaaS).toBeDefined()
      expect(objects.Startup).toBeDefined()
      expect(objects.Marketplace).toBeDefined()
      expect(objects.API).toBeDefined()
      expect(objects.Service).toBeDefined()

      // Entity hierarchy
      expect(objects.Entity).toBeDefined()
      expect(objects.Product).toBeDefined()
      expect(objects.Directory).toBeDefined()
      expect(objects.Collection).toBeDefined()
      expect(objects.Package).toBeDefined()
      expect(objects.SDK).toBeDefined()
      expect(objects.CLI).toBeDefined()

      // Application hierarchy
      expect(objects.App).toBeDefined()
      expect(objects.Site).toBeDefined()
    })
  })

  describe('OKR Completeness', () => {
    it('all OKRs have progress() and isComplete() methods', async () => {
      const objects = await import('../index')

      const state = createMockState()
      const env = createMockEnv()

      // Test SaaS OKRs as example
      const saas = new objects.SaaS(state, env)

      for (const okrName of Object.keys(saas.okrs)) {
        const okr = saas.okrs[okrName]
        expect(typeof okr.progress).toBe('function')
        expect(typeof okr.isComplete).toBe('function')
        expect(okr.objective).toBeDefined()
        expect(Array.isArray(okr.keyResults)).toBe(true)
      }
    })

    it('OKR hierarchy is correct (SaaS has all parent OKRs)', async () => {
      const { SaaS } = await import('../SaaS')

      const state = createMockState()
      const env = createMockEnv()
      const saas = new SaaS(state, env)

      // From Business
      expect(saas.okrs.Revenue).toBeDefined()
      expect(saas.okrs.Costs).toBeDefined()
      expect(saas.okrs.Profit).toBeDefined()

      // From DigitalBusiness
      expect(saas.okrs.Traffic).toBeDefined()
      expect(saas.okrs.Conversion).toBeDefined()
      expect(saas.okrs.Engagement).toBeDefined()

      // SaaS-specific
      expect(saas.okrs.MRR).toBeDefined()
      expect(saas.okrs.Churn).toBeDefined()
      expect(saas.okrs.NRR).toBeDefined()
      expect(saas.okrs.CAC).toBeDefined()
      expect(saas.okrs.LTV).toBeDefined()
    })
  })

  describe('Cross-DO Relationships', () => {
    it('Business can create Apps', async () => {
      const { Business } = await import('../Business')

      const state = createMockState()
      const env = createMockEnv()
      const business = new Business(state, env)

      expect(typeof business.createApp).toBe('function')
      expect(typeof business.listApps).toBe('function')
    })

    it('Business can manage members (Agents/Humans)', async () => {
      const { Business } = await import('../Business')

      const state = createMockState()
      const env = createMockEnv()
      const business = new Business(state, env)

      expect(typeof business.addMember).toBe('function')
      expect(typeof business.listMembers).toBe('function')
    })

    it('App can create Sites', async () => {
      const { App } = await import('../App')

      const state = createMockState()
      const env = createMockEnv()
      const app = new App(state, env)

      expect(typeof app.createSite).toBe('function')
      expect(typeof app.listSites).toBe('function')
    })

    it('Marketplace has seller/buyer/listing/transaction management', async () => {
      const { Marketplace } = await import('../Marketplace')

      const state = createMockState()
      const env = createMockEnv()
      const marketplace = new Marketplace(state, env)

      // Seller management
      expect(typeof marketplace.registerSeller).toBe('function')
      expect(typeof marketplace.getSeller).toBe('function')
      expect(typeof marketplace.listSellers).toBe('function')

      // Buyer management
      expect(typeof marketplace.registerBuyer).toBe('function')
      expect(typeof marketplace.getBuyer).toBe('function')

      // Listing management
      expect(typeof marketplace.createListing).toBe('function')
      expect(typeof marketplace.getListing).toBe('function')
      expect(typeof marketplace.searchListings).toBe('function')

      // Transaction management
      expect(typeof marketplace.createTransaction).toBe('function')
      expect(typeof marketplace.completeTransaction).toBe('function')
    })

    it('Service has agent assignment and task management', async () => {
      const { Service } = await import('../Service')

      const state = createMockState()
      const env = createMockEnv()
      const service = new Service(state, env)

      // Agent management
      expect(typeof service.assignAgent).toBe('function')
      expect(typeof service.getAssignedAgents).toBe('function')
      expect(typeof service.unassignAgent).toBe('function')
      expect(typeof service.getAvailableAgent).toBe('function')

      // Task management
      expect(typeof service.submitTask).toBe('function')
      expect(typeof service.getTask).toBe('function')
      expect(typeof service.listTasks).toBe('function')
      expect(typeof service.completeTask).toBe('function')
      expect(typeof service.escalateTask).toBe('function')
    })
  })

  describe('Lifecycle Management', () => {
    it('SaaS has subscription lifecycle', async () => {
      const { SaaS } = await import('../SaaS')

      const state = createMockState()
      const env = createMockEnv()
      const saas = new SaaS(state, env)

      expect(typeof saas.createSubscription).toBe('function')
      expect(typeof saas.getSubscription).toBe('function')
      expect(typeof saas.cancelSubscription).toBe('function')
      expect(typeof saas.changePlan).toBe('function')
      expect(typeof saas.recordUsage).toBe('function')
      expect(typeof saas.hasFeature).toBe('function')
      expect(typeof saas.checkLimit).toBe('function')
    })

    it('Product has variant and inventory lifecycle', async () => {
      const { Product } = await import('../Product')

      const state = createMockState()
      const env = createMockEnv()
      const product = new Product(state, env)

      expect(typeof product.configure).toBe('function')
      expect(typeof product.addVariant).toBe('function')
      expect(typeof product.updateVariant).toBe('function')
      expect(typeof product.removeVariant).toBe('function')
      expect(typeof product.checkInventory).toBe('function')
      expect(typeof product.reserveInventory).toBe('function')
      expect(typeof product.releaseInventory).toBe('function')
    })

    it('Directory has entry lifecycle', async () => {
      const { Directory } = await import('../Directory')

      const state = createMockState()
      const env = createMockEnv()
      const directory = new Directory(state, env)

      expect(typeof directory.createEntry).toBe('function')
      expect(typeof directory.getEntry).toBe('function')
      expect(typeof directory.getByPath).toBe('function')
      expect(typeof directory.listChildren).toBe('function')
      expect(typeof directory.moveEntry).toBe('function')
      expect(typeof directory.deleteEntry).toBe('function')
      expect(typeof directory.createFolder).toBe('function')
      expect(typeof directory.createFile).toBe('function')
    })

    it('API has route and rate limit lifecycle', async () => {
      const { API } = await import('../API')

      const state = createMockState()
      const env = createMockEnv()
      const api = new API(state, env)

      expect(typeof api.configureAPI).toBe('function')
      expect(typeof api.getAPIConfig).toBe('function')
      expect(typeof api.addRoute).toBe('function')
      expect(typeof api.checkRateLimit).toBe('function')
      expect(typeof api.validateAuth).toBe('function')
      expect(typeof api.getOpenAPISpec).toBe('function')
    })

    it('SDK has code generation lifecycle', async () => {
      const { SDK } = await import('../SDK')

      const state = createMockState()
      const env = createMockEnv()
      const sdk = new SDK(state, env)

      expect(typeof sdk.configureSDK).toBe('function')
      expect(typeof sdk.getSDKConfig).toBe('function')
      expect(typeof sdk.generate).toBe('function')
      expect(typeof sdk.buildAndPublish).toBe('function')
    })

    it('CLI has command execution lifecycle', async () => {
      const { CLI } = await import('../CLI')

      const state = createMockState()
      const env = createMockEnv()
      const cli = new CLI(state, env)

      expect(typeof cli.configureCLI).toBe('function')
      expect(typeof cli.getCLIConfig).toBe('function')
      expect(typeof cli.findCommand).toBe('function')
      expect(typeof cli.parseArgs).toBe('function')
      expect(typeof cli.execute).toBe('function')
      expect(typeof cli.generateHelp).toBe('function')
      expect(typeof cli.getExecutionHistory).toBe('function')
    })
  })
})
