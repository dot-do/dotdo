/**
 * Marketplace DO Tests
 *
 * Tests for Marketplace Durable Object that extends DigitalBusiness
 * and adds marketplace-specific OKRs: GMV, TakeRate, Liquidity
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Marketplace } from '../Marketplace'
import { DigitalBusiness } from '../DigitalBusiness'
import { DO as DOBase } from '../core/DOBase'
import type { Env } from '../core/DO'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock SQL storage cursor result
 */
interface MockSqlCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[]
}

/**
 * Mock SQL storage that simulates Cloudflare's SqlStorage API
 */
function createMockSqlStorage() {
  return {
    exec(query: string, ...params: unknown[]): MockSqlCursor {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
  }
}

/**
 * Mock KV storage for Durable Object state
 */
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

/**
 * Create a mock DurableObjectId
 */
function createMockDOId(name: string = 'test-marketplace-id'): DurableObjectId {
  return {
    toString: () => name,
    equals: (other: DurableObjectId) => other.toString() === name,
    name,
  }
}

/**
 * Create a mock DurableObjectState with both KV and SQL storage
 */
function createMockState(idName: string = 'test-marketplace-id'): DurableObjectState {
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

/**
 * Create a mock environment
 */
function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
    ...overrides,
  }
}

// Type declarations for tests
interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  name?: string
}

interface DurableObjectState {
  id: DurableObjectId
  storage: DurableObjectStorage
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

interface DurableObjectStorage {
  get<T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined>
  put<T>(key: string | Record<string, T>, value?: T): Promise<void>
  delete(key: string | string[]): Promise<boolean | number>
  deleteAll(): Promise<void>
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>
  sql: unknown
}

// ============================================================================
// TESTS: MARKETPLACE DO CLASS
// ============================================================================

describe('Marketplace DO', () => {
  afterEach(() => {
    DOBase._resetTestState()
  })

  describe('inheritance hierarchy', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let marketplaceInstance: Marketplace

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      marketplaceInstance = new Marketplace(mockState, mockEnv)
    })

    it('Marketplace extends DigitalBusiness', () => {
      expect(marketplaceInstance).toBeInstanceOf(DigitalBusiness)
    })

    it('Marketplace has $type of "Marketplace"', () => {
      expect(Marketplace.$type).toBe('Marketplace')
    })
  })

  describe('inherited OKRs from DigitalBusiness', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let marketplaceInstance: Marketplace

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      marketplaceInstance = new Marketplace(mockState, mockEnv)
    })

    it('Marketplace has okrs property', () => {
      expect(marketplaceInstance).toHaveProperty('okrs')
    })

    it('Marketplace inherits Revenue OKR from Business', () => {
      expect(marketplaceInstance.okrs.Revenue).toBeDefined()
      expect(marketplaceInstance.okrs.Revenue.objective).toBeDefined()
    })

    it('Marketplace inherits Costs OKR from Business', () => {
      expect(marketplaceInstance.okrs.Costs).toBeDefined()
      expect(marketplaceInstance.okrs.Costs.objective).toBeDefined()
    })

    it('Marketplace inherits Profit OKR from Business', () => {
      expect(marketplaceInstance.okrs.Profit).toBeDefined()
      expect(marketplaceInstance.okrs.Profit.objective).toBeDefined()
    })

    it('Marketplace inherits Traffic OKR from DigitalBusiness', () => {
      expect(marketplaceInstance.okrs.Traffic).toBeDefined()
      expect(marketplaceInstance.okrs.Traffic.objective).toBeDefined()
    })

    it('Marketplace inherits Conversion OKR from DigitalBusiness', () => {
      expect(marketplaceInstance.okrs.Conversion).toBeDefined()
      expect(marketplaceInstance.okrs.Conversion.objective).toBeDefined()
    })

    it('Marketplace inherits Engagement OKR from DigitalBusiness', () => {
      expect(marketplaceInstance.okrs.Engagement).toBeDefined()
      expect(marketplaceInstance.okrs.Engagement.objective).toBeDefined()
    })
  })

  describe('Marketplace-specific OKRs', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let marketplaceInstance: Marketplace

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      marketplaceInstance = new Marketplace(mockState, mockEnv)
    })

    it('Marketplace has GMV OKR', () => {
      expect(marketplaceInstance.okrs.GMV).toBeDefined()
      expect(marketplaceInstance.okrs.GMV.objective).toBeDefined()
      expect(marketplaceInstance.okrs.GMV.keyResults.length).toBeGreaterThan(0)
    })

    it('GMV OKR has appropriate key results', () => {
      const gmvOKR = marketplaceInstance.okrs.GMV
      const keyResultNames = gmvOKR.keyResults.map((kr) => kr.name)
      expect(keyResultNames).toContain('GrossMerchandiseValue')
      expect(keyResultNames).toContain('GMVGrowthRate')
      expect(keyResultNames).toContain('AverageOrderValue')
    })

    it('Marketplace has TakeRate OKR', () => {
      expect(marketplaceInstance.okrs.TakeRate).toBeDefined()
      expect(marketplaceInstance.okrs.TakeRate.objective).toBeDefined()
      expect(marketplaceInstance.okrs.TakeRate.keyResults.length).toBeGreaterThan(0)
    })

    it('TakeRate OKR tracks commission metrics', () => {
      const takeRateOKR = marketplaceInstance.okrs.TakeRate
      const keyResultNames = takeRateOKR.keyResults.map((kr) => kr.name)
      expect(keyResultNames).toContain('TakeRatePercentage')
      expect(keyResultNames).toContain('TotalCommissions')
      expect(keyResultNames).toContain('TransactionVolume')
    })

    it('Marketplace has Liquidity OKR', () => {
      expect(marketplaceInstance.okrs.Liquidity).toBeDefined()
      expect(marketplaceInstance.okrs.Liquidity.objective).toBeDefined()
      expect(marketplaceInstance.okrs.Liquidity.keyResults.length).toBeGreaterThan(0)
    })

    it('Liquidity OKR tracks marketplace efficiency', () => {
      const liquidityOKR = marketplaceInstance.okrs.Liquidity
      const keyResultNames = liquidityOKR.keyResults.map((kr) => kr.name)
      expect(keyResultNames).toContain('SearchToTransactionRate')
      expect(keyResultNames).toContain('ListingSuccessRate')
      expect(keyResultNames).toContain('TimeToFirstSale')
    })
  })

  describe('OKR progress tracking', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let marketplaceInstance: Marketplace

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      marketplaceInstance = new Marketplace(mockState, mockEnv)
    })

    it('all Marketplace OKRs have progress() method', () => {
      const marketplaceOKRs = ['GMV', 'TakeRate', 'Liquidity']
      for (const okrName of marketplaceOKRs) {
        expect(typeof marketplaceInstance.okrs[okrName].progress).toBe('function')
      }
    })

    it('all Marketplace OKRs have isComplete() method', () => {
      const marketplaceOKRs = ['GMV', 'TakeRate', 'Liquidity']
      for (const okrName of marketplaceOKRs) {
        expect(typeof marketplaceInstance.okrs[okrName].isComplete).toBe('function')
      }
    })

    it('progress starts at 0 by default', () => {
      expect(marketplaceInstance.okrs.GMV.progress()).toBe(0)
    })
  })

  describe('complete OKR set', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let marketplaceInstance: Marketplace

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      marketplaceInstance = new Marketplace(mockState, mockEnv)
    })

    it('Marketplace has all expected OKRs (9 total)', () => {
      const expectedOKRs = [
        // Business OKRs
        'Revenue',
        'Costs',
        'Profit',
        // DigitalBusiness OKRs
        'Traffic',
        'Conversion',
        'Engagement',
        // Marketplace OKRs
        'GMV',
        'TakeRate',
        'Liquidity',
      ]

      for (const okrName of expectedOKRs) {
        expect(marketplaceInstance.okrs[okrName]).toBeDefined()
      }
    })

    it('Marketplace OKRs count matches expected', () => {
      // 3 from Business + 3 from DigitalBusiness + 3 from Marketplace = 9
      expect(Object.keys(marketplaceInstance.okrs).length).toBe(9)
    })
  })

  describe('seller management', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let marketplaceInstance: Marketplace

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      marketplaceInstance = new Marketplace(mockState, mockEnv)
    })

    it('can register a seller', async () => {
      const seller = await marketplaceInstance.registerSeller({
        name: 'Test Seller',
        email: 'seller@test.com',
      })

      expect(seller.id).toBeDefined()
      expect(seller.name).toBe('Test Seller')
      expect(seller.email).toBe('seller@test.com')
      expect(seller.status).toBe('pending')
      expect(seller.rating).toBe(0)
      expect(seller.reviewCount).toBe(0)
    })

    it('can get a seller by ID', async () => {
      const created = await marketplaceInstance.registerSeller({
        name: 'Test Seller',
        email: 'seller@test.com',
      })

      const fetched = await marketplaceInstance.getSeller(created.id)

      expect(fetched).toBeDefined()
      expect(fetched?.id).toBe(created.id)
    })

    it('can update seller status', async () => {
      const seller = await marketplaceInstance.registerSeller({
        name: 'Test Seller',
        email: 'seller@test.com',
      })

      const updated = await marketplaceInstance.updateSellerStatus(seller.id, 'active')

      expect(updated?.status).toBe('active')
      expect(updated?.verifiedAt).toBeDefined()
    })

    it('can list sellers', async () => {
      await marketplaceInstance.registerSeller({ name: 'Seller 1', email: 'seller1@test.com' })
      await marketplaceInstance.registerSeller({ name: 'Seller 2', email: 'seller2@test.com' })

      const sellers = await marketplaceInstance.listSellers()

      expect(sellers.length).toBe(2)
    })
  })

  describe('buyer management', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let marketplaceInstance: Marketplace

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      marketplaceInstance = new Marketplace(mockState, mockEnv)
    })

    it('can register a buyer', async () => {
      const buyer = await marketplaceInstance.registerBuyer({
        name: 'Test Buyer',
        email: 'buyer@test.com',
      })

      expect(buyer.id).toBeDefined()
      expect(buyer.name).toBe('Test Buyer')
      expect(buyer.email).toBe('buyer@test.com')
      expect(buyer.status).toBe('active')
    })

    it('can get a buyer by ID', async () => {
      const created = await marketplaceInstance.registerBuyer({
        name: 'Test Buyer',
        email: 'buyer@test.com',
      })

      const fetched = await marketplaceInstance.getBuyer(created.id)

      expect(fetched).toBeDefined()
      expect(fetched?.id).toBe(created.id)
    })
  })

  describe('listing management', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let marketplaceInstance: Marketplace
    let sellerId: string

    beforeEach(async () => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      marketplaceInstance = new Marketplace(mockState, mockEnv)

      // Create and activate a seller
      const seller = await marketplaceInstance.registerSeller({
        name: 'Test Seller',
        email: 'seller@test.com',
      })
      await marketplaceInstance.updateSellerStatus(seller.id, 'active')
      sellerId = seller.id
    })

    it('can create a listing', async () => {
      const listing = await marketplaceInstance.createListing(sellerId, {
        title: 'Test Product',
        description: 'A test product',
        price: 100,
        currency: 'USD',
      })

      expect(listing.id).toBeDefined()
      expect(listing.sellerId).toBe(sellerId)
      expect(listing.title).toBe('Test Product')
      expect(listing.price).toBe(100)
      expect(listing.status).toBe('draft')
    })

    it('can update a listing', async () => {
      const listing = await marketplaceInstance.createListing(sellerId, {
        title: 'Test Product',
        description: 'A test product',
        price: 100,
        currency: 'USD',
      })

      const updated = await marketplaceInstance.updateListing(listing.id, {
        status: 'active',
        price: 150,
      })

      expect(updated?.status).toBe('active')
      expect(updated?.price).toBe(150)
    })

    it('can search listings', async () => {
      await marketplaceInstance.createListing(sellerId, {
        title: 'Red Widget',
        description: 'A red widget',
        price: 50,
        currency: 'USD',
        category: 'widgets',
      })

      await marketplaceInstance.createListing(sellerId, {
        title: 'Blue Widget',
        description: 'A blue widget',
        price: 75,
        currency: 'USD',
        category: 'widgets',
      })

      const widgets = await marketplaceInstance.searchListings({ category: 'widgets' })
      expect(widgets.length).toBe(2)

      const expensive = await marketplaceInstance.searchListings({ minPrice: 60 })
      expect(expensive.length).toBe(1)
      expect(expensive[0].title).toBe('Blue Widget')
    })
  })

  describe('transaction handling', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let marketplaceInstance: Marketplace
    let sellerId: string
    let buyerId: string
    let listingId: string

    beforeEach(async () => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      marketplaceInstance = new Marketplace(mockState, mockEnv)

      // Configure marketplace
      await marketplaceInstance.configureMarketplace({
        name: 'Test Marketplace',
        commission: { rate: 10 },
      })

      // Create seller
      const seller = await marketplaceInstance.registerSeller({
        name: 'Test Seller',
        email: 'seller@test.com',
      })
      await marketplaceInstance.updateSellerStatus(seller.id, 'active')
      sellerId = seller.id

      // Create buyer
      const buyer = await marketplaceInstance.registerBuyer({
        name: 'Test Buyer',
        email: 'buyer@test.com',
      })
      buyerId = buyer.id

      // Create active listing
      const listing = await marketplaceInstance.createListing(sellerId, {
        title: 'Test Product',
        description: 'A test product',
        price: 100,
        currency: 'USD',
      })
      await marketplaceInstance.updateListing(listing.id, { status: 'active' })
      listingId = listing.id
    })

    it('can create a transaction', async () => {
      const transaction = await marketplaceInstance.createTransaction(listingId, buyerId)

      expect(transaction.id).toBeDefined()
      expect(transaction.listingId).toBe(listingId)
      expect(transaction.sellerId).toBe(sellerId)
      expect(transaction.buyerId).toBe(buyerId)
      expect(transaction.amount).toBe(100)
      expect(transaction.fee).toBe(10) // 10% of 100
      expect(transaction.netAmount).toBe(90)
      expect(transaction.status).toBe('pending')
    })

    it('can complete a transaction', async () => {
      const transaction = await marketplaceInstance.createTransaction(listingId, buyerId)
      const completed = await marketplaceInstance.completeTransaction(transaction.id)

      expect(completed?.status).toBe('completed')
      expect(completed?.completedAt).toBeDefined()
    })
  })

  describe('fee calculation', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let marketplaceInstance: Marketplace

    beforeEach(async () => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      marketplaceInstance = new Marketplace(mockState, mockEnv)
    })

    it('calculates percentage-based fees', async () => {
      await marketplaceInstance.configureMarketplace({
        name: 'Test Marketplace',
        commission: { rate: 15 },
      })

      const { fee, netAmount } = await marketplaceInstance.calculateFees(200)

      expect(fee).toBe(30) // 15% of 200
      expect(netAmount).toBe(170)
    })

    it('respects minimum fee', async () => {
      await marketplaceInstance.configureMarketplace({
        name: 'Test Marketplace',
        commission: { rate: 5, minFee: 10 },
      })

      const { fee, netAmount } = await marketplaceInstance.calculateFees(100)

      // 5% of 100 = 5, but minFee is 10
      expect(fee).toBe(10)
      expect(netAmount).toBe(90)
    })

    it('respects maximum fee', async () => {
      await marketplaceInstance.configureMarketplace({
        name: 'Test Marketplace',
        commission: { rate: 20, maxFee: 50 },
      })

      const { fee, netAmount } = await marketplaceInstance.calculateFees(500)

      // 20% of 500 = 100, but maxFee is 50
      expect(fee).toBe(50)
      expect(netAmount).toBe(450)
    })

    it('includes fixed fee', async () => {
      await marketplaceInstance.configureMarketplace({
        name: 'Test Marketplace',
        commission: { rate: 10, fixedFee: 5 },
      })

      const { fee, netAmount } = await marketplaceInstance.calculateFees(100)

      // 10% of 100 + 5 = 15
      expect(fee).toBe(15)
      expect(netAmount).toBe(85)
    })
  })

  describe('review/rating system', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let marketplaceInstance: Marketplace
    let sellerId: string
    let buyerId: string
    let transactionId: string

    beforeEach(async () => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      marketplaceInstance = new Marketplace(mockState, mockEnv)

      // Configure marketplace
      await marketplaceInstance.configureMarketplace({
        name: 'Test Marketplace',
        commission: { rate: 10 },
      })

      // Create seller
      const seller = await marketplaceInstance.registerSeller({
        name: 'Test Seller',
        email: 'seller@test.com',
      })
      await marketplaceInstance.updateSellerStatus(seller.id, 'active')
      sellerId = seller.id

      // Create buyer
      const buyer = await marketplaceInstance.registerBuyer({
        name: 'Test Buyer',
        email: 'buyer@test.com',
      })
      buyerId = buyer.id

      // Create and complete transaction
      const listing = await marketplaceInstance.createListing(sellerId, {
        title: 'Test Product',
        description: 'A test product',
        price: 100,
        currency: 'USD',
      })
      await marketplaceInstance.updateListing(listing.id, { status: 'active' })

      const transaction = await marketplaceInstance.createTransaction(listing.id, buyerId)
      await marketplaceInstance.completeTransaction(transaction.id)
      transactionId = transaction.id
    })

    it('can add a review', async () => {
      const review = await marketplaceInstance.addReview(transactionId, 5, 'Great product!')

      expect(review.id).toBeDefined()
      expect(review.transactionId).toBe(transactionId)
      expect(review.sellerId).toBe(sellerId)
      expect(review.buyerId).toBe(buyerId)
      expect(review.rating).toBe(5)
      expect(review.comment).toBe('Great product!')
    })

    it('updates seller rating after review', async () => {
      await marketplaceInstance.addReview(transactionId, 4, 'Good product')

      const { rating, reviewCount } = await marketplaceInstance.getSellerRating(sellerId)

      expect(rating).toBe(4)
      expect(reviewCount).toBe(1)
    })

    it('rejects invalid ratings', async () => {
      await expect(marketplaceInstance.addReview(transactionId, 0)).rejects.toThrow(
        'Rating must be between 1 and 5'
      )

      await expect(marketplaceInstance.addReview(transactionId, 6)).rejects.toThrow(
        'Rating must be between 1 and 5'
      )
    })

    it('can get seller reviews', async () => {
      await marketplaceInstance.addReview(transactionId, 5, 'Excellent!')

      const reviews = await marketplaceInstance.getSellerReviews(sellerId)

      expect(reviews.length).toBe(1)
      expect(reviews[0].rating).toBe(5)
    })
  })

  describe('user subclass pattern', () => {
    let mockState: DurableObjectState
    let mockEnv: Env

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
    })

    it('user can extend Marketplace and inherit all OKRs', () => {
      class MyMarketplace extends Marketplace {}

      const myMarketplace = new MyMarketplace(mockState, mockEnv)

      // Should have all inherited OKRs
      expect(myMarketplace.okrs.Revenue).toBeDefined()
      expect(myMarketplace.okrs.Traffic).toBeDefined()
      expect(myMarketplace.okrs.GMV).toBeDefined()
    })

    it('user can extend Marketplace and add custom OKRs via constructor', () => {
      class MyMarketplace extends Marketplace {
        constructor(ctx: DurableObjectState, env: Env) {
          super(ctx, env)
          // Add custom OKR after construction
          this.okrs.SellerSatisfaction = this.defineOKR({
            objective: 'Track seller satisfaction',
            keyResults: [{ name: 'NPS', target: 50, current: 0 }],
          })
        }
      }

      const myMarketplace = new MyMarketplace(mockState, mockEnv)

      // Should have all inherited OKRs plus custom
      expect(myMarketplace.okrs.Revenue).toBeDefined()
      expect(myMarketplace.okrs.GMV).toBeDefined()
      expect(myMarketplace.okrs.SellerSatisfaction).toBeDefined()
      expect(Object.keys(myMarketplace.okrs).length).toBe(10) // 9 + 1 custom
    })
  })
})
