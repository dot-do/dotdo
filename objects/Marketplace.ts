/**
 * Marketplace - Two-sided marketplace for buyers and sellers
 *
 * Extends DigitalBusiness with marketplace-specific OKRs: GMV, Take Rate, Liquidity.
 * Includes seller/buyer management, listings, transactions, and review systems.
 *
 * Examples: 'freelance-marketplace', 'ecommerce-platform'
 *
 * @example
 * ```typescript
 * class MyMarketplace extends Marketplace {
 *   // Inherits: Revenue, Costs, Profit, Traffic, Conversion, Engagement
 *   // Adds: GMV, TakeRate, Liquidity (Marketplace metrics)
 * }
 * ```
 */

import { DigitalBusiness, DigitalBusinessConfig } from './DigitalBusiness'
import { Env } from './DO'
import type { OKR } from './DOBase'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface MarketplaceSeller {
  id: string
  name: string
  email: string
  status: 'pending' | 'active' | 'suspended'
  rating: number
  reviewCount: number
  createdAt: Date
  verifiedAt?: Date
  metadata?: Record<string, unknown>
}

export interface MarketplaceBuyer {
  id: string
  name: string
  email: string
  status: 'active' | 'suspended'
  createdAt: Date
  metadata?: Record<string, unknown>
}

export interface MarketplaceListing {
  id: string
  sellerId: string
  title: string
  description: string
  price: number
  currency: string
  status: 'draft' | 'active' | 'sold' | 'archived'
  category?: string
  tags?: string[]
  images?: string[]
  inventory?: number
  createdAt: Date
  updatedAt: Date
  metadata?: Record<string, unknown>
}

export interface MarketplaceTransaction {
  id: string
  listingId: string
  sellerId: string
  buyerId: string
  amount: number
  fee: number
  netAmount: number
  currency: string
  status: 'pending' | 'paid' | 'completed' | 'refunded' | 'disputed'
  createdAt: Date
  completedAt?: Date
  metadata?: Record<string, unknown>
}

export interface MarketplaceReview {
  id: string
  transactionId: string
  sellerId: string
  buyerId: string
  rating: number // 1-5
  comment?: string
  createdAt: Date
  metadata?: Record<string, unknown>
}

export interface CommissionConfig {
  rate: number // Percentage (0-100)
  minFee?: number
  maxFee?: number
  fixedFee?: number
}

export interface MarketplaceConfig extends DigitalBusinessConfig {
  name: string
  commission: CommissionConfig
  categories?: string[]
  supportedCurrencies?: string[]
}

// ============================================================================
// MARKETPLACE CLASS
// ============================================================================

export class Marketplace extends DigitalBusiness {
  static override readonly $type: string = 'Marketplace'

  private marketplaceConfig: MarketplaceConfig | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * OKRs for Marketplace
   *
   * Includes inherited DigitalBusiness OKRs (Revenue, Costs, Profit, Traffic, Conversion, Engagement)
   * plus marketplace-specific metrics (GMV, TakeRate, Liquidity)
   */
  override okrs: Record<string, OKR> = {
    // Inherited from Business (via DigitalBusiness)
    Revenue: this.defineOKR({
      objective: 'Grow revenue',
      keyResults: [
        { name: 'TotalRevenue', target: 100000, current: 0, unit: '$' },
        { name: 'RevenueGrowthRate', target: 20, current: 0, unit: '%' },
      ],
    }),
    Costs: this.defineOKR({
      objective: 'Optimize costs',
      keyResults: [
        { name: 'TotalCosts', target: 50000, current: 0, unit: '$' },
        { name: 'CostReduction', target: 10, current: 0, unit: '%' },
      ],
    }),
    Profit: this.defineOKR({
      objective: 'Maximize profit',
      keyResults: [
        { name: 'NetProfit', target: 50000, current: 0, unit: '$' },
        { name: 'ProfitMargin', target: 50, current: 0, unit: '%' },
      ],
    }),
    // Inherited from DigitalBusiness
    Traffic: this.defineOKR({
      objective: 'Increase website traffic',
      keyResults: [
        { name: 'MonthlyVisitors', target: 100000, current: 0 },
        { name: 'UniqueVisitors', target: 50000, current: 0 },
        { name: 'PageViews', target: 300000, current: 0 },
      ],
    }),
    Conversion: this.defineOKR({
      objective: 'Improve conversion rates',
      keyResults: [
        { name: 'VisitorToSignup', target: 10, current: 0, unit: '%' },
        { name: 'SignupToCustomer', target: 25, current: 0, unit: '%' },
        { name: 'OverallConversion', target: 2.5, current: 0, unit: '%' },
      ],
    }),
    Engagement: this.defineOKR({
      objective: 'Boost user engagement',
      keyResults: [
        { name: 'DAU', target: 10000, current: 0 },
        { name: 'MAU', target: 50000, current: 0 },
        { name: 'DAUMAURatio', target: 20, current: 0, unit: '%' },
        { name: 'SessionDuration', target: 300, current: 0, unit: 'seconds' },
      ],
    }),
    // Marketplace-specific OKRs
    GMV: this.defineOKR({
      objective: 'Grow Gross Merchandise Value',
      keyResults: [
        { name: 'GrossMerchandiseValue', target: 1000000, current: 0, unit: '$' },
        { name: 'GMVGrowthRate', target: 25, current: 0, unit: '%' },
        { name: 'AverageOrderValue', target: 100, current: 0, unit: '$' },
      ],
    }),
    TakeRate: this.defineOKR({
      objective: 'Optimize Take Rate',
      keyResults: [
        { name: 'TakeRatePercentage', target: 15, current: 0, unit: '%' },
        { name: 'TotalCommissions', target: 150000, current: 0, unit: '$' },
        { name: 'TransactionVolume', target: 10000, current: 0 },
      ],
    }),
    Liquidity: this.defineOKR({
      objective: 'Improve Marketplace Liquidity',
      keyResults: [
        { name: 'SearchToTransactionRate', target: 5, current: 0, unit: '%' },
        { name: 'ListingSuccessRate', target: 70, current: 0, unit: '%' },
        { name: 'TimeToFirstSale', target: 7, current: 0, unit: 'days' },
      ],
    }),
  }

  // ==========================================================================
  // CONFIGURATION
  // ==========================================================================

  /**
   * Get marketplace configuration
   */
  async getMarketplaceConfig(): Promise<MarketplaceConfig | null> {
    if (!this.marketplaceConfig) {
      this.marketplaceConfig = (await this.ctx.storage.get('marketplace_config')) as MarketplaceConfig | null
    }
    return this.marketplaceConfig
  }

  /**
   * Configure the marketplace
   */
  async configureMarketplace(config: MarketplaceConfig): Promise<void> {
    this.marketplaceConfig = config
    await this.ctx.storage.put('marketplace_config', config)
    await this.setConfig(config)
    await this.emit('marketplace.configured', { config })
  }

  /**
   * Set commission rate
   */
  async setCommissionRate(rate: number, minFee?: number, maxFee?: number, fixedFee?: number): Promise<CommissionConfig> {
    const config = await this.getMarketplaceConfig()
    if (!config) throw new Error('Marketplace not configured')

    const commission: CommissionConfig = {
      rate,
      minFee,
      maxFee,
      fixedFee,
    }

    config.commission = commission
    await this.ctx.storage.put('marketplace_config', config)
    await this.emit('marketplace.commissionUpdated', { commission })

    return commission
  }

  /**
   * Calculate fees for a given amount
   */
  async calculateFees(amount: number): Promise<{ fee: number; netAmount: number }> {
    const config = await this.getMarketplaceConfig()
    if (!config) throw new Error('Marketplace not configured')

    let fee = amount * (config.commission.rate / 100)

    if (config.commission.fixedFee) {
      fee += config.commission.fixedFee
    }

    if (config.commission.minFee && fee < config.commission.minFee) {
      fee = config.commission.minFee
    }

    if (config.commission.maxFee && fee > config.commission.maxFee) {
      fee = config.commission.maxFee
    }

    return {
      fee: Math.round(fee * 100) / 100, // Round to 2 decimal places
      netAmount: Math.round((amount - fee) * 100) / 100,
    }
  }

  // ==========================================================================
  // SELLER MANAGEMENT
  // ==========================================================================

  /**
   * Register a new seller
   */
  async registerSeller(
    data: Omit<MarketplaceSeller, 'id' | 'status' | 'rating' | 'reviewCount' | 'createdAt'>
  ): Promise<MarketplaceSeller> {
    const id = crypto.randomUUID()
    const now = new Date()

    const seller: MarketplaceSeller = {
      ...data,
      id,
      status: 'pending',
      rating: 0,
      reviewCount: 0,
      createdAt: now,
    }

    await this.ctx.storage.put(`seller:${id}`, seller)
    await this.emit('seller.registered', { seller })

    return seller
  }

  /**
   * Get seller by ID
   */
  async getSeller(sellerId: string): Promise<MarketplaceSeller | null> {
    return (await this.ctx.storage.get(`seller:${sellerId}`)) as MarketplaceSeller | null
  }

  /**
   * Update seller status
   */
  async updateSellerStatus(
    sellerId: string,
    status: MarketplaceSeller['status']
  ): Promise<MarketplaceSeller | null> {
    const seller = await this.getSeller(sellerId)
    if (!seller) return null

    seller.status = status
    if (status === 'active' && !seller.verifiedAt) {
      seller.verifiedAt = new Date()
    }

    await this.ctx.storage.put(`seller:${sellerId}`, seller)
    await this.emit('seller.statusUpdated', { sellerId, status })

    return seller
  }

  /**
   * List all sellers
   */
  async listSellers(status?: MarketplaceSeller['status']): Promise<MarketplaceSeller[]> {
    const map = await this.ctx.storage.list({ prefix: 'seller:' })
    let sellers = Array.from(map.values()) as MarketplaceSeller[]

    if (status) {
      sellers = sellers.filter((s) => s.status === status)
    }

    return sellers
  }

  // ==========================================================================
  // BUYER MANAGEMENT
  // ==========================================================================

  /**
   * Register a new buyer
   */
  async registerBuyer(
    data: Omit<MarketplaceBuyer, 'id' | 'status' | 'createdAt'>
  ): Promise<MarketplaceBuyer> {
    const id = crypto.randomUUID()
    const now = new Date()

    const buyer: MarketplaceBuyer = {
      ...data,
      id,
      status: 'active',
      createdAt: now,
    }

    await this.ctx.storage.put(`buyer:${id}`, buyer)
    await this.emit('buyer.registered', { buyer })

    return buyer
  }

  /**
   * Get buyer by ID
   */
  async getBuyer(buyerId: string): Promise<MarketplaceBuyer | null> {
    return (await this.ctx.storage.get(`buyer:${buyerId}`)) as MarketplaceBuyer | null
  }

  // ==========================================================================
  // LISTING MANAGEMENT
  // ==========================================================================

  /**
   * Create a new listing
   */
  async createListing(
    sellerId: string,
    data: Omit<MarketplaceListing, 'id' | 'sellerId' | 'status' | 'createdAt' | 'updatedAt'>
  ): Promise<MarketplaceListing> {
    const seller = await this.getSeller(sellerId)
    if (!seller) throw new Error(`Seller not found: ${sellerId}`)
    if (seller.status !== 'active') throw new Error(`Seller is not active: ${sellerId}`)

    const id = crypto.randomUUID()
    const now = new Date()

    const listing: MarketplaceListing = {
      ...data,
      id,
      sellerId,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    }

    await this.ctx.storage.put(`listing:${id}`, listing)
    await this.emit('listing.created', { listing })

    return listing
  }

  /**
   * Get listing by ID
   */
  async getListing(listingId: string): Promise<MarketplaceListing | null> {
    return (await this.ctx.storage.get(`listing:${listingId}`)) as MarketplaceListing | null
  }

  /**
   * Update listing
   */
  async updateListing(
    listingId: string,
    updates: Partial<Omit<MarketplaceListing, 'id' | 'sellerId' | 'createdAt'>>
  ): Promise<MarketplaceListing | null> {
    const listing = await this.getListing(listingId)
    if (!listing) return null

    const updated: MarketplaceListing = {
      ...listing,
      ...updates,
      updatedAt: new Date(),
    }

    await this.ctx.storage.put(`listing:${listingId}`, updated)
    await this.emit('listing.updated', { listing: updated })

    return updated
  }

  /**
   * Search listings
   */
  async searchListings(options?: {
    sellerId?: string
    status?: MarketplaceListing['status']
    category?: string
    minPrice?: number
    maxPrice?: number
    query?: string
  }): Promise<MarketplaceListing[]> {
    const map = await this.ctx.storage.list({ prefix: 'listing:' })
    let listings = Array.from(map.values()) as MarketplaceListing[]

    if (options?.sellerId) {
      listings = listings.filter((l) => l.sellerId === options.sellerId)
    }

    if (options?.status) {
      listings = listings.filter((l) => l.status === options.status)
    }

    if (options?.category) {
      listings = listings.filter((l) => l.category === options.category)
    }

    if (options?.minPrice !== undefined) {
      listings = listings.filter((l) => l.price >= options.minPrice!)
    }

    if (options?.maxPrice !== undefined) {
      listings = listings.filter((l) => l.price <= options.maxPrice!)
    }

    if (options?.query) {
      const q = options.query.toLowerCase()
      listings = listings.filter(
        (l) =>
          l.title.toLowerCase().includes(q) ||
          l.description.toLowerCase().includes(q) ||
          l.tags?.some((t) => t.toLowerCase().includes(q))
      )
    }

    return listings
  }

  // ==========================================================================
  // TRANSACTION HANDLING
  // ==========================================================================

  /**
   * Create a transaction
   */
  async createTransaction(
    listingId: string,
    buyerId: string
  ): Promise<MarketplaceTransaction> {
    const listing = await this.getListing(listingId)
    if (!listing) throw new Error(`Listing not found: ${listingId}`)
    if (listing.status !== 'active') throw new Error(`Listing is not active: ${listingId}`)

    const buyer = await this.getBuyer(buyerId)
    if (!buyer) throw new Error(`Buyer not found: ${buyerId}`)
    if (buyer.status !== 'active') throw new Error(`Buyer is not active: ${buyerId}`)

    const { fee, netAmount } = await this.calculateFees(listing.price)

    const id = crypto.randomUUID()
    const now = new Date()

    const transaction: MarketplaceTransaction = {
      id,
      listingId,
      sellerId: listing.sellerId,
      buyerId,
      amount: listing.price,
      fee,
      netAmount,
      currency: listing.currency,
      status: 'pending',
      createdAt: now,
    }

    await this.ctx.storage.put(`transaction:${id}`, transaction)
    await this.emit('transaction.created', { transaction })

    return transaction
  }

  /**
   * Get transaction by ID
   */
  async getTransaction(transactionId: string): Promise<MarketplaceTransaction | null> {
    return (await this.ctx.storage.get(`transaction:${transactionId}`)) as MarketplaceTransaction | null
  }

  /**
   * Complete a transaction
   */
  async completeTransaction(transactionId: string): Promise<MarketplaceTransaction | null> {
    const transaction = await this.getTransaction(transactionId)
    if (!transaction) return null

    transaction.status = 'completed'
    transaction.completedAt = new Date()

    await this.ctx.storage.put(`transaction:${transactionId}`, transaction)

    // Update listing status if single-sale
    const listing = await this.getListing(transaction.listingId)
    if (listing && (listing.inventory === undefined || listing.inventory <= 1)) {
      await this.updateListing(transaction.listingId, { status: 'sold' })
    } else if (listing && listing.inventory !== undefined) {
      await this.updateListing(transaction.listingId, { inventory: listing.inventory - 1 })
    }

    await this.emit('transaction.completed', { transaction })

    return transaction
  }

  /**
   * List transactions
   */
  async listTransactions(options?: {
    sellerId?: string
    buyerId?: string
    status?: MarketplaceTransaction['status']
  }): Promise<MarketplaceTransaction[]> {
    const map = await this.ctx.storage.list({ prefix: 'transaction:' })
    let transactions = Array.from(map.values()) as MarketplaceTransaction[]

    if (options?.sellerId) {
      transactions = transactions.filter((t) => t.sellerId === options.sellerId)
    }

    if (options?.buyerId) {
      transactions = transactions.filter((t) => t.buyerId === options.buyerId)
    }

    if (options?.status) {
      transactions = transactions.filter((t) => t.status === options.status)
    }

    return transactions
  }

  // ==========================================================================
  // REVIEW/RATING SYSTEM
  // ==========================================================================

  /**
   * Add a review
   */
  async addReview(
    transactionId: string,
    rating: number,
    comment?: string
  ): Promise<MarketplaceReview> {
    if (rating < 1 || rating > 5) {
      throw new Error('Rating must be between 1 and 5')
    }

    const transaction = await this.getTransaction(transactionId)
    if (!transaction) throw new Error(`Transaction not found: ${transactionId}`)
    if (transaction.status !== 'completed') {
      throw new Error('Can only review completed transactions')
    }

    // Check if review already exists
    const existingReview = await this.ctx.storage.get(`review:${transactionId}`)
    if (existingReview) {
      throw new Error('Review already exists for this transaction')
    }

    const id = transactionId // Use transaction ID as review ID for 1:1 mapping
    const now = new Date()

    const review: MarketplaceReview = {
      id,
      transactionId,
      sellerId: transaction.sellerId,
      buyerId: transaction.buyerId,
      rating,
      comment,
      createdAt: now,
    }

    await this.ctx.storage.put(`review:${id}`, review)

    // Update seller rating
    await this.updateSellerRating(transaction.sellerId)

    await this.emit('review.added', { review })

    return review
  }

  /**
   * Get seller's rating
   */
  async getSellerRating(sellerId: string): Promise<{ rating: number; reviewCount: number }> {
    const seller = await this.getSeller(sellerId)
    if (!seller) throw new Error(`Seller not found: ${sellerId}`)

    return {
      rating: seller.rating,
      reviewCount: seller.reviewCount,
    }
  }

  /**
   * Get reviews for a seller
   */
  async getSellerReviews(sellerId: string): Promise<MarketplaceReview[]> {
    const map = await this.ctx.storage.list({ prefix: 'review:' })
    const reviews = Array.from(map.values()) as MarketplaceReview[]
    return reviews.filter((r) => r.sellerId === sellerId)
  }

  /**
   * Update seller's aggregate rating
   */
  private async updateSellerRating(sellerId: string): Promise<void> {
    const reviews = await this.getSellerReviews(sellerId)
    const seller = await this.getSeller(sellerId)
    if (!seller) return

    if (reviews.length === 0) {
      seller.rating = 0
      seller.reviewCount = 0
    } else {
      const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0)
      seller.rating = Math.round((totalRating / reviews.length) * 10) / 10 // Round to 1 decimal
      seller.reviewCount = reviews.length
    }

    await this.ctx.storage.put(`seller:${sellerId}`, seller)
  }

  // ==========================================================================
  // HTTP ENDPOINTS
  // ==========================================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Configuration
    if (url.pathname === '/marketplace/config') {
      if (request.method === 'GET') {
        const config = await this.getMarketplaceConfig()
        return new Response(JSON.stringify(config), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (request.method === 'PUT') {
        const config = (await request.json()) as MarketplaceConfig
        await this.configureMarketplace(config)
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // Sellers
    if (url.pathname === '/marketplace/sellers' && request.method === 'GET') {
      const status = url.searchParams.get('status') as MarketplaceSeller['status'] | null
      const sellers = await this.listSellers(status ?? undefined)
      return new Response(JSON.stringify(sellers), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/marketplace/seller' && request.method === 'POST') {
      const data = (await request.json()) as Omit<MarketplaceSeller, 'id' | 'status' | 'rating' | 'reviewCount' | 'createdAt'>
      const seller = await this.registerSeller(data)
      return new Response(JSON.stringify(seller), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Buyers
    if (url.pathname === '/marketplace/buyer' && request.method === 'POST') {
      const data = (await request.json()) as Omit<MarketplaceBuyer, 'id' | 'status' | 'createdAt'>
      const buyer = await this.registerBuyer(data)
      return new Response(JSON.stringify(buyer), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Listings
    if (url.pathname === '/marketplace/listings' && request.method === 'GET') {
      const options: Parameters<typeof this.searchListings>[0] = {}
      if (url.searchParams.get('sellerId')) options.sellerId = url.searchParams.get('sellerId')!
      if (url.searchParams.get('status')) options.status = url.searchParams.get('status') as MarketplaceListing['status']
      if (url.searchParams.get('category')) options.category = url.searchParams.get('category')!
      if (url.searchParams.get('minPrice')) options.minPrice = parseFloat(url.searchParams.get('minPrice')!)
      if (url.searchParams.get('maxPrice')) options.maxPrice = parseFloat(url.searchParams.get('maxPrice')!)
      if (url.searchParams.get('q')) options.query = url.searchParams.get('q')!

      const listings = await this.searchListings(options)
      return new Response(JSON.stringify(listings), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/marketplace/listing' && request.method === 'POST') {
      const { sellerId, ...data } = (await request.json()) as { sellerId: string } & Omit<
        MarketplaceListing,
        'id' | 'sellerId' | 'status' | 'createdAt' | 'updatedAt'
      >
      const listing = await this.createListing(sellerId, data)
      return new Response(JSON.stringify(listing), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Transactions
    if (url.pathname === '/marketplace/transaction' && request.method === 'POST') {
      const { listingId, buyerId } = (await request.json()) as { listingId: string; buyerId: string }
      const transaction = await this.createTransaction(listingId, buyerId)
      return new Response(JSON.stringify(transaction), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname.startsWith('/marketplace/transaction/') && request.method === 'POST') {
      const transactionId = url.pathname.split('/')[3]!
      const action = url.pathname.split('/')[4]

      if (action === 'complete') {
        const transaction = await this.completeTransaction(transactionId)
        if (!transaction) {
          return new Response('Not Found', { status: 404 })
        }
        return new Response(JSON.stringify(transaction), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // Reviews
    if (url.pathname === '/marketplace/review' && request.method === 'POST') {
      const { transactionId, rating, comment } = (await request.json()) as {
        transactionId: string
        rating: number
        comment?: string
      }
      const review = await this.addReview(transactionId, rating, comment)
      return new Response(JSON.stringify(review), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname.startsWith('/marketplace/seller/') && url.pathname.endsWith('/rating')) {
      const sellerId = url.pathname.split('/')[3]!
      try {
        const rating = await this.getSellerRating(sellerId)
        return new Response(JSON.stringify(rating), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch {
        return new Response('Not Found', { status: 404 })
      }
    }

    // Fee calculation
    if (url.pathname === '/marketplace/calculate-fees' && request.method === 'POST') {
      const { amount } = (await request.json()) as { amount: number }
      const fees = await this.calculateFees(amount)
      return new Response(JSON.stringify(fees), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return super.fetch(request)
  }
}

export default Marketplace
