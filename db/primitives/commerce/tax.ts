/**
 * Tax Calculation Engine - Stub for TDD RED Phase
 *
 * This is a stub file with type definitions. Implementation to be completed.
 *
 * @module db/primitives/commerce/tax
 */

// =============================================================================
// Types
// =============================================================================

export interface TaxJurisdiction {
  country: string
  state?: string
  county?: string
  city?: string
  postalCode?: string
}

export interface TaxRateComponents {
  state?: number
  county?: number
  city?: number
  district?: number
  gst?: number
  pst?: number
  qst?: number
}

export interface TaxRate {
  rate: number
  type: 'vat' | 'sales_tax' | 'gst' | 'hst' | 'pst' | 'qst' | 'custom' | 'use_tax'
  name?: string
  components?: TaxRateComponents
  compound?: boolean
}

export interface TaxCategory {
  id: string
  code: string
  name: string
  description?: string
  rateOverrides?: Array<{
    jurisdiction: TaxJurisdiction
    rate: number
    taxTypes?: string[]
  }>
  createdAt: Date
}

export interface CreateTaxCategoryInput {
  code: string
  name: string
  description?: string
  rateOverrides?: Array<{
    jurisdiction: TaxJurisdiction
    rate: number
    taxTypes?: string[]
  }>
}

export interface TaxExemption {
  id: string
  type: 'customer' | 'product'
  customerId?: string
  productIds?: string[]
  reason?: string
  certificateNumber?: string
  jurisdictions?: TaxJurisdiction[]
  validFrom?: Date
  validTo?: Date
  createdAt: Date
}

export interface CreateExemptionInput {
  type: 'customer' | 'product'
  customerId?: string
  productIds?: string[]
  reason?: string
  certificateNumber?: string
  jurisdictions?: TaxJurisdiction[]
  validFrom?: Date
  validTo?: Date
}

export interface TaxLineItem {
  productId: string
  price: number
  quantity: number
  taxCategory?: string
  priceIncludesTax?: boolean
}

export interface TaxContext {
  items: TaxLineItem[]
  shippingAddress: TaxJurisdiction
  shippingCost?: number
  customerId?: string
  orderId?: string
  transactionDate?: Date
  pricesIncludeTax?: boolean
  currency?: string
  displayCurrency?: string
  customerVatNumber?: string
  isBusinessCustomer?: boolean
  sellerJurisdiction?: TaxJurisdiction
  isSmallSeller?: boolean
  sellerId?: string
  isMarketplaceSale?: boolean
  marketplaceId?: string
  isUseTax?: boolean
}

export interface ItemTax {
  productId: string
  taxAmount: number
  rate: number
}

export interface TaxBreakdown {
  state?: number
  county?: number
  city?: number
  district?: number
  gst?: number
  pst?: number
  qst?: number
}

export interface TaxResult {
  subtotal: number
  taxAmount: number
  itemsTaxAmount: number
  shippingTax?: number
  total: number
  grossPrice?: number
  netPrice?: number
  taxType?: string
  taxJurisdiction?: TaxJurisdiction
  taxBreakdown?: TaxBreakdown
  itemTaxes?: ItemTax[]
  exemptionApplied?: boolean
  exemptionReason?: string
  reverseCharge?: boolean
  reverseChargeNote?: string
  taxHolidayApplied?: boolean
  collectedBy?: 'seller' | 'marketplace'
  currency?: string
  displayCurrency?: string
}

export interface TaxTransaction {
  orderId: string
  result: TaxResult
  recordedAt: Date
}

export interface TaxSummary {
  byJurisdiction?: Record<string, { total: number; count: number }>
  totalTax: number
  totalTransactions: number
}

export interface RefundTaxResult {
  taxRefund: number
  netRefund: number
}

export interface TaxEngine {
  // Tax rate lookup
  getTaxRate(jurisdiction: TaxJurisdiction): Promise<TaxRate | null>
  registerTaxRate(input: {
    jurisdiction: TaxJurisdiction
    rate: number
    type: string
    name?: string
    compound?: boolean
  }): Promise<void>

  // Tax calculation
  calculateTax(context: TaxContext): Promise<TaxResult>

  // Tax categories
  createTaxCategory(input: CreateTaxCategoryInput): Promise<TaxCategory>
  getTaxCategory(code: string): Promise<TaxCategory | null>
  listTaxCategories(): Promise<TaxCategory[]>

  // Exemptions
  createExemption(input: CreateExemptionInput): Promise<TaxExemption>
  listExemptions(filter: { customerId?: string }): Promise<TaxExemption[]>
  validateExemption(input: {
    customerId: string
    certificateNumber: string
    jurisdiction: TaxJurisdiction
  }): Promise<{ valid: boolean; error?: string }>

  // Shipping tax
  setShippingTaxable(input: {
    jurisdiction: TaxJurisdiction
    taxable: boolean
  }): Promise<void>

  // Pricing mode
  setDefaultPricingMode(input: {
    jurisdiction: TaxJurisdiction
    pricesIncludeTax: boolean
  }): Promise<void>

  // VAT validation
  validateVatNumber(vatNumber: string): Promise<{
    valid: boolean
    countryCode?: string
  }>

  // Nexus
  registerNexus(input: {
    sellerId: string
    jurisdictions: TaxJurisdiction[]
  }): Promise<void>

  // Reporting
  recordTaxTransaction(input: {
    orderId: string
    result: TaxResult
  }): Promise<void>
  getTaxTransactions(filter: {
    startDate: Date
    endDate: Date
  }): Promise<TaxTransaction[]>
  getTaxSummary(input: {
    startDate: Date
    endDate: Date
    groupBy?: 'jurisdiction'
  }): Promise<TaxSummary>
  exportTaxData(input: {
    startDate: Date
    endDate: Date
    format: 'csv' | 'json'
    jurisdiction?: TaxJurisdiction
  }): Promise<{ format: string; data: string }>
  calculateRefundTax(input: {
    originalOrderId: string
    refundAmount: number
  }): Promise<RefundTaxResult>

  // Validation
  validateJurisdiction(jurisdiction: TaxJurisdiction): Promise<{ valid: boolean }>
}

// =============================================================================
// Factory - Stub Implementation (throws NotImplementedError)
// =============================================================================

class NotImplementedError extends Error {
  constructor(method: string) {
    super(`TaxEngine.${method} is not implemented - TDD RED phase`)
    this.name = 'NotImplementedError'
  }
}

class StubTaxEngine implements TaxEngine {
  async getTaxRate(_jurisdiction: TaxJurisdiction): Promise<TaxRate | null> {
    throw new NotImplementedError('getTaxRate')
  }

  async registerTaxRate(_input: {
    jurisdiction: TaxJurisdiction
    rate: number
    type: string
    name?: string
    compound?: boolean
  }): Promise<void> {
    throw new NotImplementedError('registerTaxRate')
  }

  async calculateTax(_context: TaxContext): Promise<TaxResult> {
    throw new NotImplementedError('calculateTax')
  }

  async createTaxCategory(_input: CreateTaxCategoryInput): Promise<TaxCategory> {
    throw new NotImplementedError('createTaxCategory')
  }

  async getTaxCategory(_code: string): Promise<TaxCategory | null> {
    throw new NotImplementedError('getTaxCategory')
  }

  async listTaxCategories(): Promise<TaxCategory[]> {
    throw new NotImplementedError('listTaxCategories')
  }

  async createExemption(_input: CreateExemptionInput): Promise<TaxExemption> {
    throw new NotImplementedError('createExemption')
  }

  async listExemptions(_filter: { customerId?: string }): Promise<TaxExemption[]> {
    throw new NotImplementedError('listExemptions')
  }

  async validateExemption(_input: {
    customerId: string
    certificateNumber: string
    jurisdiction: TaxJurisdiction
  }): Promise<{ valid: boolean; error?: string }> {
    throw new NotImplementedError('validateExemption')
  }

  async setShippingTaxable(_input: {
    jurisdiction: TaxJurisdiction
    taxable: boolean
  }): Promise<void> {
    throw new NotImplementedError('setShippingTaxable')
  }

  async setDefaultPricingMode(_input: {
    jurisdiction: TaxJurisdiction
    pricesIncludeTax: boolean
  }): Promise<void> {
    throw new NotImplementedError('setDefaultPricingMode')
  }

  async validateVatNumber(_vatNumber: string): Promise<{
    valid: boolean
    countryCode?: string
  }> {
    throw new NotImplementedError('validateVatNumber')
  }

  async registerNexus(_input: {
    sellerId: string
    jurisdictions: TaxJurisdiction[]
  }): Promise<void> {
    throw new NotImplementedError('registerNexus')
  }

  async recordTaxTransaction(_input: {
    orderId: string
    result: TaxResult
  }): Promise<void> {
    throw new NotImplementedError('recordTaxTransaction')
  }

  async getTaxTransactions(_filter: {
    startDate: Date
    endDate: Date
  }): Promise<TaxTransaction[]> {
    throw new NotImplementedError('getTaxTransactions')
  }

  async getTaxSummary(_input: {
    startDate: Date
    endDate: Date
    groupBy?: 'jurisdiction'
  }): Promise<TaxSummary> {
    throw new NotImplementedError('getTaxSummary')
  }

  async exportTaxData(_input: {
    startDate: Date
    endDate: Date
    format: 'csv' | 'json'
    jurisdiction?: TaxJurisdiction
  }): Promise<{ format: string; data: string }> {
    throw new NotImplementedError('exportTaxData')
  }

  async calculateRefundTax(_input: {
    originalOrderId: string
    refundAmount: number
  }): Promise<RefundTaxResult> {
    throw new NotImplementedError('calculateRefundTax')
  }

  async validateJurisdiction(_jurisdiction: TaxJurisdiction): Promise<{ valid: boolean }> {
    throw new NotImplementedError('validateJurisdiction')
  }
}

/**
 * Create a tax engine instance
 */
export function createTaxEngine(): TaxEngine {
  return new StubTaxEngine()
}
