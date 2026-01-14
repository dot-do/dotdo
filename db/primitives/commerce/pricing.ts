/**
 * Pricing Engine - Dynamic pricing primitive
 *
 * Provides pricing functionality:
 * - Dynamic pricing rules
 * - Discount codes and promotions
 * - Bulk/volume discounts
 * - Time-based pricing
 * - Customer segment pricing
 *
 * @module db/primitives/commerce/pricing
 */

// =============================================================================
// Types
// =============================================================================

export type DiscountType = 'percentage' | 'fixed' | 'buyXgetY'

export interface PriceRuleConditions {
  productIds?: string[]
  categoryIds?: string[]
  customerSegments?: string[]
  customerTags?: string[]
  minCartTotal?: number
  minQuantity?: number
  isFirstOrder?: boolean
}

export interface PriceRuleSchedule {
  startsAt?: Date
  endsAt?: Date
  daysOfWeek?: number[] // 0 = Sunday, 6 = Saturday
  timeOfDay?: {
    startHour: number
    endHour: number
  }
}

export interface PriceRule {
  id: string
  name: string
  type: DiscountType
  value: number
  conditions?: PriceRuleConditions
  schedule?: PriceRuleSchedule
  priority: number
  stackable?: boolean
  stopOnMatch?: boolean
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CreateRuleInput {
  name: string
  type: DiscountType
  value: number
  conditions?: PriceRuleConditions
  schedule?: PriceRuleSchedule
  priority?: number
  stackable?: boolean
  stopOnMatch?: boolean
  enabled?: boolean
}

export interface DiscountCode {
  id: string
  code: string
  type: DiscountType
  value: number
  minimumPurchase?: number
  usageLimit?: number
  usageLimitPerCustomer?: number
  usageCount: number
  customerUsage: Map<string, number>
  applicableProductIds?: string[]
  applicableCategoryIds?: string[]
  startsAt?: Date
  expiresAt?: Date
  enabled: boolean
  createdAt: Date
}

export interface CreateDiscountCodeInput {
  code: string
  type: DiscountType
  value: number
  minimumPurchase?: number
  usageLimit?: number
  usageLimitPerCustomer?: number
  applicableProductIds?: string[]
  applicableCategoryIds?: string[]
  startsAt?: Date
  expiresAt?: Date
}

export interface BulkDiscount {
  id: string
  productId: string
  type?: DiscountType
  tiers: { minQuantity: number; discount: number }[]
  buyQuantity?: number
  getQuantity?: number
  createdAt: Date
}

export interface CreateBulkDiscountInput {
  productId: string
  type?: DiscountType
  tiers?: { minQuantity: number; discount: number }[]
  buyQuantity?: number
  getQuantity?: number
}

export interface CustomerSegment {
  id: string
  name: string
  conditions?: {
    minLifetimeValue?: number
    minOrders?: number
    tags?: string[]
  }
  createdAt: Date
}

export interface CreateCustomerSegmentInput {
  id?: string
  name: string
  conditions?: {
    minLifetimeValue?: number
    minOrders?: number
    tags?: string[]
  }
}

export interface PricingContext {
  productId: string
  variantId: string
  basePrice: number
  compareAtPrice?: number
  quantity: number
  categoryIds?: string[]
  customerSegments?: string[]
  customerTags?: string[]
  currency?: string
}

export interface CartPricingContext {
  items: {
    productId: string
    variantId: string
    basePrice: number
    quantity: number
    categoryIds?: string[]
  }[]
  discountCode?: string
  customerId?: string
  customerSegments?: string[]
  customerTags?: string[]
  isFirstOrder?: boolean
  currency?: string
}

export interface AppliedRule {
  id: string
  name: string
  type: DiscountType
  discount: number
}

export interface PricingResult {
  originalPrice: number
  finalPrice: number
  unitPrice: number
  totalPrice: number
  discount: number
  savingsAmount?: number
  savingsPercent?: number
  compareAtPrice?: number
  freeItems?: number
  appliedRules: AppliedRule[]
  currency: string
}

export interface CartPricingResult {
  subtotal: number
  discount: number
  total: number
  appliedRules: AppliedRule[]
  appliedCode?: { code: string; discount: number }
  codeError?: string
  currency: string
}

export interface PriceHistory {
  price: number
  timestamp: Date
}

// =============================================================================
// PricingEngine Interface
// =============================================================================

export interface PricingEngine {
  // Price calculation
  calculatePrice(context: PricingContext): Promise<PricingResult>
  calculateCartTotal(context: CartPricingContext): Promise<CartPricingResult>

  // Price rules
  createRule(input: CreateRuleInput): Promise<PriceRule>
  getRule(id: string): Promise<PriceRule | null>
  updateRule(id: string, input: Partial<CreateRuleInput>): Promise<PriceRule>
  deleteRule(id: string): Promise<void>
  listRules(): Promise<PriceRule[]>
  enableRule(id: string): Promise<void>
  disableRule(id: string): Promise<void>

  // Discount codes
  createDiscountCode(input: CreateDiscountCodeInput): Promise<DiscountCode>
  getDiscountCode(code: string): Promise<DiscountCode | null>
  redeemCode(code: string, orderId: string, customerId?: string): Promise<void>
  validateCode(code: string, customerId?: string): Promise<{ valid: boolean; error?: string }>

  // Bulk discounts
  createBulkDiscount(input: CreateBulkDiscountInput): Promise<BulkDiscount>
  getBulkDiscount(productId: string): Promise<BulkDiscount | null>

  // Customer segments
  createCustomerSegment(input: CreateCustomerSegmentInput): Promise<CustomerSegment>
  getCustomerSegment(id: string): Promise<CustomerSegment | null>

  // Price history
  recordPrice(variantId: string, price: number): Promise<void>
  getPriceHistory(variantId: string): Promise<PriceHistory[]>

  // Formatting
  formatPrice(amount: number, currency: string): string
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `${prefix}_${timestamp}${random}`
}

// =============================================================================
// Implementation
// =============================================================================

class InMemoryPricingEngine implements PricingEngine {
  private rules: Map<string, PriceRule> = new Map()
  private discountCodes: Map<string, DiscountCode> = new Map()
  private bulkDiscounts: Map<string, BulkDiscount> = new Map()
  private customerSegments: Map<string, CustomerSegment> = new Map()
  private priceHistory: Map<string, PriceHistory[]> = new Map()

  private isRuleActive(rule: PriceRule): boolean {
    if (!rule.enabled) return false

    const now = new Date()

    if (rule.schedule) {
      // Check date range
      if (rule.schedule.startsAt && now < rule.schedule.startsAt) return false
      if (rule.schedule.endsAt && now > rule.schedule.endsAt) return false

      // Check day of week
      if (rule.schedule.daysOfWeek) {
        const day = now.getDay()
        if (!rule.schedule.daysOfWeek.includes(day)) return false
      }

      // Check time of day
      if (rule.schedule.timeOfDay) {
        const hour = now.getHours()
        if (
          hour < rule.schedule.timeOfDay.startHour ||
          hour >= rule.schedule.timeOfDay.endHour
        ) {
          return false
        }
      }
    }

    return true
  }

  private matchesConditions(
    rule: PriceRule,
    context: PricingContext | CartPricingContext,
    isCartLevel = false
  ): boolean {
    if (!rule.conditions) return true

    const cond = rule.conditions

    // Product filter (for single product context)
    if (cond.productIds && 'productId' in context) {
      if (!cond.productIds.includes(context.productId)) return false
    }

    // Category filter (for single product context)
    if (cond.categoryIds && 'categoryIds' in context && context.categoryIds) {
      const hasMatch = cond.categoryIds.some((cid) =>
        context.categoryIds!.includes(cid)
      )
      if (!hasMatch) return false
    }

    // Customer segment filter
    if (cond.customerSegments) {
      const segments = 'customerSegments' in context ? context.customerSegments : undefined
      if (!segments || !cond.customerSegments.some((s) => segments.includes(s))) {
        return false
      }
    }

    // Customer tag filter
    if (cond.customerTags) {
      const tags = 'customerTags' in context ? context.customerTags : undefined
      if (!tags || !cond.customerTags.some((t) => tags.includes(t))) {
        return false
      }
    }

    // First order filter - only check when explicitly set and in cart context
    if (cond.isFirstOrder !== undefined) {
      if ('isFirstOrder' in context) {
        if (cond.isFirstOrder !== context.isFirstOrder) return false
      } else {
        // Single product context without isFirstOrder - skip this rule
        return false
      }
    }

    // Min cart total (for cart context only)
    if (cond.minCartTotal !== undefined) {
      if (!isCartLevel) {
        // This rule should only apply at cart level, not per-item
        return false
      }
      if ('items' in context) {
        const subtotal = context.items.reduce(
          (sum, item) => sum + item.basePrice * item.quantity,
          0
        )
        if (subtotal < cond.minCartTotal) return false
      } else {
        return false
      }
    }

    return true
  }

  private applyDiscount(
    price: number,
    type: DiscountType,
    value: number
  ): { price: number; discount: number } {
    let discount = 0

    switch (type) {
      case 'percentage':
        discount = Math.round((price * value) / 100)
        break
      case 'fixed':
        discount = Math.min(value, price)
        break
    }

    return {
      price: Math.max(0, price - discount),
      discount,
    }
  }

  async calculatePrice(context: PricingContext): Promise<PricingResult> {
    let price = context.basePrice
    let totalDiscount = 0
    const appliedRules: AppliedRule[] = []
    const currency = context.currency ?? 'USD'

    // Get applicable bulk discount
    const bulkDiscount = this.bulkDiscounts.get(context.productId)
    let freeItems = 0

    if (bulkDiscount) {
      if (bulkDiscount.type === 'buyXgetY' && bulkDiscount.buyQuantity && bulkDiscount.getQuantity) {
        // Buy X get Y free
        const sets = Math.floor(
          context.quantity / (bulkDiscount.buyQuantity + bulkDiscount.getQuantity)
        )
        freeItems = sets * bulkDiscount.getQuantity
        const remaining = context.quantity % (bulkDiscount.buyQuantity + bulkDiscount.getQuantity)
        const extraFree = Math.max(0, remaining - bulkDiscount.buyQuantity)
        freeItems += extraFree
      } else if (bulkDiscount.tiers) {
        // Tier-based discount
        const applicableTier = bulkDiscount.tiers
          .filter((t) => context.quantity >= t.minQuantity)
          .sort((a, b) => b.minQuantity - a.minQuantity)[0]

        if (applicableTier) {
          const discountType = bulkDiscount.type ?? 'percentage'
          const result = this.applyDiscount(price, discountType, applicableTier.discount)
          price = result.price
          totalDiscount += result.discount * context.quantity
        }
      }
    }

    // Get and sort applicable rules by priority
    const activeRules = Array.from(this.rules.values())
      .filter((r) => this.isRuleActive(r) && this.matchesConditions(r, context))
      .sort((a, b) => a.priority - b.priority)

    for (const rule of activeRules) {
      const result = this.applyDiscount(price, rule.type, rule.value)

      if (result.discount > 0) {
        if (rule.stackable === false && appliedRules.length > 0) {
          continue
        }

        price = result.price
        totalDiscount += result.discount * context.quantity
        appliedRules.push({
          id: rule.id,
          name: rule.name,
          type: rule.type,
          discount: result.discount,
        })

        if (rule.stopOnMatch) {
          break
        }
      }
    }

    const originalTotal = context.basePrice * context.quantity
    const paidQuantity = context.quantity - freeItems
    const finalTotal = price * paidQuantity

    return {
      originalPrice: context.basePrice,
      finalPrice: price,
      unitPrice: price,
      totalPrice: finalTotal,
      discount: totalDiscount,
      savingsAmount: originalTotal - finalTotal,
      savingsPercent: originalTotal > 0
        ? Math.round(((originalTotal - finalTotal) / originalTotal) * 100)
        : 0,
      compareAtPrice: context.compareAtPrice,
      freeItems: freeItems > 0 ? freeItems : undefined,
      appliedRules,
      currency,
    }
  }

  async calculateCartTotal(context: CartPricingContext): Promise<CartPricingResult> {
    const currency = context.currency ?? 'USD'
    let subtotal = 0
    let totalDiscount = 0
    const appliedRules: AppliedRule[] = []
    let appliedCode: { code: string; discount: number } | undefined
    let codeError: string | undefined

    // Calculate item subtotals with individual discounts
    for (const item of context.items) {
      const result = await this.calculatePrice({
        productId: item.productId,
        variantId: item.variantId,
        basePrice: item.basePrice,
        quantity: item.quantity,
        categoryIds: item.categoryIds,
        customerSegments: context.customerSegments,
        customerTags: context.customerTags,
        currency,
      })

      subtotal += item.basePrice * item.quantity
      totalDiscount += result.discount

      for (const rule of result.appliedRules) {
        if (!appliedRules.find((r) => r.id === rule.id)) {
          appliedRules.push(rule)
        }
      }
    }

    // Apply cart-level rules (rules that have cart-only conditions like minCartTotal or isFirstOrder)
    const cartRules = Array.from(this.rules.values())
      .filter(
        (r) =>
          this.isRuleActive(r) &&
          this.matchesConditions(r, context, true) &&
          (r.conditions?.minCartTotal !== undefined || r.conditions?.isFirstOrder !== undefined)
      )
      .sort((a, b) => a.priority - b.priority)

    for (const rule of cartRules) {
      const result = this.applyDiscount(subtotal - totalDiscount, rule.type, rule.value)

      if (result.discount > 0) {
        totalDiscount += result.discount
        appliedRules.push({
          id: rule.id,
          name: rule.name,
          type: rule.type,
          discount: result.discount,
        })
      }
    }

    // Apply discount code
    if (context.discountCode) {
      const code = this.discountCodes.get(context.discountCode.toUpperCase())

      if (!code) {
        codeError = 'Invalid discount code'
      } else if (!code.enabled) {
        codeError = 'Discount code is inactive'
      } else if (code.expiresAt && new Date() > code.expiresAt) {
        codeError = 'Discount code has expired'
      } else if (code.startsAt && new Date() < code.startsAt) {
        codeError = 'Discount code is not yet active'
      } else if (code.usageLimit !== undefined && code.usageCount >= code.usageLimit) {
        codeError = 'Discount code usage limit reached'
      } else if (
        context.customerId &&
        code.usageLimitPerCustomer !== undefined &&
        (code.customerUsage.get(context.customerId) ?? 0) >= code.usageLimitPerCustomer
      ) {
        codeError = 'You have already used this discount code'
      } else if (
        code.minimumPurchase !== undefined &&
        subtotal < code.minimumPurchase
      ) {
        const minFormatted = this.formatPrice(code.minimumPurchase, currency)
        codeError = `Minimum purchase of ${minFormatted} required`
      } else {
        // Check product applicability
        let applicableAmount = subtotal

        if (code.applicableProductIds && code.applicableProductIds.length > 0) {
          applicableAmount = context.items
            .filter((i) => code.applicableProductIds!.includes(i.productId))
            .reduce((sum, i) => sum + i.basePrice * i.quantity, 0)
        }

        if (applicableAmount > 0) {
          const result = this.applyDiscount(applicableAmount, code.type, code.value)
          totalDiscount += result.discount
          appliedCode = {
            code: code.code,
            discount: result.discount,
          }
        }
      }
    }

    return {
      subtotal,
      discount: totalDiscount,
      total: Math.max(0, subtotal - totalDiscount),
      appliedRules,
      appliedCode,
      codeError,
      currency,
    }
  }

  // Price rules

  async createRule(input: CreateRuleInput): Promise<PriceRule> {
    const rule: PriceRule = {
      id: generateId('rule'),
      name: input.name,
      type: input.type,
      value: input.value,
      conditions: input.conditions,
      schedule: input.schedule,
      priority: input.priority ?? 10,
      stackable: input.stackable,
      stopOnMatch: input.stopOnMatch,
      enabled: input.enabled ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    this.rules.set(rule.id, rule)
    return rule
  }

  async getRule(id: string): Promise<PriceRule | null> {
    return this.rules.get(id) ?? null
  }

  async updateRule(id: string, input: Partial<CreateRuleInput>): Promise<PriceRule> {
    const rule = this.rules.get(id)
    if (!rule) {
      throw new Error('Rule not found')
    }

    const updated: PriceRule = {
      ...rule,
      ...input,
      updatedAt: new Date(),
    }

    this.rules.set(id, updated)
    return updated
  }

  async deleteRule(id: string): Promise<void> {
    this.rules.delete(id)
  }

  async listRules(): Promise<PriceRule[]> {
    return Array.from(this.rules.values()).sort((a, b) => a.priority - b.priority)
  }

  async enableRule(id: string): Promise<void> {
    const rule = this.rules.get(id)
    if (rule) {
      rule.enabled = true
      rule.updatedAt = new Date()
      this.rules.set(id, rule)
    }
  }

  async disableRule(id: string): Promise<void> {
    const rule = this.rules.get(id)
    if (rule) {
      rule.enabled = false
      rule.updatedAt = new Date()
      this.rules.set(id, rule)
    }
  }

  // Discount codes

  async createDiscountCode(input: CreateDiscountCodeInput): Promise<DiscountCode> {
    const code: DiscountCode = {
      id: generateId('code'),
      code: input.code.toUpperCase(),
      type: input.type,
      value: input.value,
      minimumPurchase: input.minimumPurchase,
      usageLimit: input.usageLimit,
      usageLimitPerCustomer: input.usageLimitPerCustomer,
      usageCount: 0,
      customerUsage: new Map(),
      applicableProductIds: input.applicableProductIds,
      applicableCategoryIds: input.applicableCategoryIds,
      startsAt: input.startsAt,
      expiresAt: input.expiresAt,
      enabled: true,
      createdAt: new Date(),
    }

    this.discountCodes.set(code.code, code)
    return code
  }

  async getDiscountCode(code: string): Promise<DiscountCode | null> {
    return this.discountCodes.get(code.toUpperCase()) ?? null
  }

  async redeemCode(code: string, orderId: string, customerId?: string): Promise<void> {
    const discount = this.discountCodes.get(code.toUpperCase())
    if (!discount) {
      throw new Error('Discount code not found')
    }

    discount.usageCount++

    if (customerId) {
      const currentUsage = discount.customerUsage.get(customerId) ?? 0
      discount.customerUsage.set(customerId, currentUsage + 1)
    }

    this.discountCodes.set(code.toUpperCase(), discount)
  }

  async validateCode(
    code: string,
    customerId?: string
  ): Promise<{ valid: boolean; error?: string }> {
    const discount = this.discountCodes.get(code.toUpperCase())

    if (!discount) {
      return { valid: false, error: 'Invalid discount code' }
    }

    if (!discount.enabled) {
      return { valid: false, error: 'Discount code is inactive' }
    }

    if (discount.expiresAt && new Date() > discount.expiresAt) {
      return { valid: false, error: 'Discount code has expired' }
    }

    if (discount.startsAt && new Date() < discount.startsAt) {
      return { valid: false, error: 'Discount code is not yet active' }
    }

    if (discount.usageLimit !== undefined && discount.usageCount >= discount.usageLimit) {
      return { valid: false, error: 'Discount code usage limit reached' }
    }

    if (
      customerId &&
      discount.usageLimitPerCustomer !== undefined &&
      (discount.customerUsage.get(customerId) ?? 0) >= discount.usageLimitPerCustomer
    ) {
      return { valid: false, error: 'You have already used this discount code' }
    }

    return { valid: true }
  }

  // Bulk discounts

  async createBulkDiscount(input: CreateBulkDiscountInput): Promise<BulkDiscount> {
    const bulk: BulkDiscount = {
      id: generateId('bulk'),
      productId: input.productId,
      type: input.type,
      tiers: input.tiers ?? [],
      buyQuantity: input.buyQuantity,
      getQuantity: input.getQuantity,
      createdAt: new Date(),
    }

    this.bulkDiscounts.set(input.productId, bulk)
    return bulk
  }

  async getBulkDiscount(productId: string): Promise<BulkDiscount | null> {
    return this.bulkDiscounts.get(productId) ?? null
  }

  // Customer segments

  async createCustomerSegment(input: CreateCustomerSegmentInput): Promise<CustomerSegment> {
    const segment: CustomerSegment = {
      id: input.id ?? generateId('seg'),
      name: input.name,
      conditions: input.conditions,
      createdAt: new Date(),
    }

    this.customerSegments.set(segment.id, segment)
    return segment
  }

  async getCustomerSegment(id: string): Promise<CustomerSegment | null> {
    return this.customerSegments.get(id) ?? null
  }

  // Price history

  async recordPrice(variantId: string, price: number): Promise<void> {
    if (!this.priceHistory.has(variantId)) {
      this.priceHistory.set(variantId, [])
    }

    this.priceHistory.get(variantId)!.push({
      price,
      timestamp: new Date(),
    })
  }

  async getPriceHistory(variantId: string): Promise<PriceHistory[]> {
    return this.priceHistory.get(variantId) ?? []
  }

  // Formatting

  formatPrice(amount: number, currency: string): string {
    const dollars = amount / 100

    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
      }).format(dollars)
    } catch {
      return `$${dollars.toFixed(2)}`
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createPricingEngine(): PricingEngine {
  return new InMemoryPricingEngine()
}
