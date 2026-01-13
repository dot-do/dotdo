/**
 * Product & Variant Domain Models
 *
 * Provides rich domain models for products and variants:
 * - Product creation with validation
 * - Variant options (size, color, etc.)
 * - Pricing per variant with inheritance
 * - SKU generation patterns
 * - Product-variant relationships
 * - Variant option validation against product options
 *
 * @module db/primitives/commerce/product-variant
 */

// =============================================================================
// Types
// =============================================================================

export type ProductStatus = 'draft' | 'active' | 'archived'

export interface ProductOption {
  name: string
  values: string[]
}

export interface CreateProductInput {
  name: string
  basePrice: number
  description?: string
  sku?: string
  compareAtPrice?: number
  tags?: string[]
  metadata?: Record<string, unknown>
}

export interface UpdateProductInput {
  name?: string
  basePrice?: number
  description?: string
  sku?: string
  compareAtPrice?: number
  tags?: string[]
  metadata?: Record<string, unknown>
}

export interface CreateVariantInput {
  options: Record<string, string>
  sku?: string
  price?: number
  compareAtPrice?: number
  weight?: number
}

export interface VariantMatrixOptions {
  skuPattern?: string
  priceAdjustments?: Record<string, Record<string, number>>
}

export interface PriceRange {
  min: number
  max: number
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `${prefix}_${timestamp}${random}`
}

function cartesianProduct<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]]
  const [first, ...rest] = arrays
  if (!first || first.length === 0) return [[]]
  const restProduct = cartesianProduct(rest)
  return first.flatMap((value) => restProduct.map((product) => [value, ...product]))
}

// =============================================================================
// Variant Model
// =============================================================================

export class VariantModel {
  readonly id: string
  readonly productId: string
  readonly options: Record<string, string>
  readonly createdAt: Date
  readonly updatedAt: Date

  sku?: string
  price?: number
  compareAtPrice?: number
  weight?: number

  private _product: ProductModel

  constructor(product: ProductModel, input: CreateVariantInput) {
    this.id = generateId('var')
    this.productId = product.id
    this.options = { ...input.options }
    this.sku = input.sku
    this.price = input.price
    this.compareAtPrice = input.compareAtPrice
    this.weight = input.weight
    this.createdAt = new Date()
    this.updatedAt = new Date()
    this._product = product
  }

  /**
   * Get effective price (variant price or inherited from product)
   */
  getEffectivePrice(): number {
    return this.price ?? this._product.basePrice
  }

  /**
   * Get effective compare at price
   */
  getEffectiveCompareAtPrice(): number | undefined {
    return this.compareAtPrice ?? this._product.compareAtPrice
  }

  /**
   * Generate SKU from a pattern
   */
  generateSku(pattern: string): string {
    let result = pattern

    for (const [key, value] of Object.entries(this.options)) {
      // Handle modifiers like {Size:upper}, {Color:lower}, {Color:abbr3}
      const modifierRegex = new RegExp(`\\{${key}(?::(\\w+))?\\}`, 'g')
      result = result.replace(modifierRegex, (_, modifier) => {
        if (!modifier) return value
        if (modifier === 'upper') return value.toUpperCase()
        if (modifier === 'lower') return value.toLowerCase()
        if (modifier.startsWith('abbr')) {
          const len = parseInt(modifier.slice(4), 10) || 3
          return value.slice(0, len).toUpperCase()
        }
        return value
      })
    }

    return result
  }

  /**
   * Get options display string
   */
  getOptionsDisplay(separator = ' / '): string {
    return Object.entries(this.options)
      .map(([key, value]) => `${key}: ${value}`)
      .join(separator)
  }

  /**
   * Get full title including product name and options
   */
  getFullTitle(): string {
    return `${this._product.name} - ${this.getOptionsDisplay()}`
  }

  /**
   * Check if this variant has matching options with another
   */
  hasMatchingOptions(other: VariantModel): boolean {
    const keys1 = Object.keys(this.options).sort()
    const keys2 = Object.keys(other.options).sort()

    if (keys1.length !== keys2.length) return false

    return keys1.every(
      (key, i) => key === keys2[i] && this.options[key] === other.options[key]
    )
  }

  /**
   * Check if variant matches a partial option query
   */
  matchesOptions(query: Record<string, string>): boolean {
    for (const [key, value] of Object.entries(query)) {
      if (this.options[key] !== value) return false
    }
    return true
  }
}

// =============================================================================
// Product Model
// =============================================================================

export class ProductModel {
  readonly id: string
  readonly createdAt: Date

  name: string
  basePrice: number
  description?: string
  sku?: string
  compareAtPrice?: number
  tags?: string[]
  metadata?: Record<string, unknown>
  status: ProductStatus
  publishedAt?: Date
  updatedAt: Date
  options: ProductOption[] = []
  variants: VariantModel[] = []

  private _defaultVariantId?: string

  constructor(input: CreateProductInput) {
    // Validation
    if (!input.name || input.name.trim() === '') {
      throw new Error('Product name is required')
    }
    if (input.name.length > 255) {
      throw new Error('Product name must be 255 characters or less')
    }
    if (input.basePrice < 0) {
      throw new Error('Base price must be non-negative')
    }
    if (
      input.compareAtPrice !== undefined &&
      input.compareAtPrice <= input.basePrice
    ) {
      throw new Error('Compare at price must be greater than base price')
    }

    this.id = generateId('prod')
    this.name = input.name
    this.basePrice = input.basePrice
    this.description = input.description
    this.sku = input.sku
    this.compareAtPrice = input.compareAtPrice
    this.tags = input.tags
    this.metadata = input.metadata
    this.status = 'draft'
    this.createdAt = new Date()
    this.updatedAt = new Date()
  }

  /**
   * Set product options (Size, Color, etc.)
   */
  setOptions(options: ProductOption[]): void {
    // Validate max 3 options
    if (options.length > 3) {
      throw new Error('Maximum 3 options allowed per product')
    }

    // Validate unique option names
    const names = options.map((o) => o.name)
    if (new Set(names).size !== names.length) {
      throw new Error('Option names must be unique')
    }

    // Validate each option has values and values are unique
    for (const option of options) {
      if (option.values.length === 0) {
        throw new Error('Option must have at least one value')
      }
      if (new Set(option.values).size !== option.values.length) {
        throw new Error('Option values must be unique')
      }
    }

    this.options = options
    this.updatedAt = new Date()
  }

  /**
   * Get all possible variant combinations from options
   */
  getVariantCombinations(): Record<string, string>[] {
    if (this.options.length === 0) return []

    const optionNames = this.options.map((o) => o.name)
    const optionValues = this.options.map((o) => o.values)
    const combinations = cartesianProduct(optionValues)

    return combinations.map((combo) => {
      const result: Record<string, string> = {}
      optionNames.forEach((name, i) => {
        result[name] = combo[i] ?? ''
      })
      return result
    })
  }

  /**
   * Add a variant to this product
   */
  addVariant(input: CreateVariantInput): VariantModel {
    // Validate options match product options
    const productOptionNames = new Set(this.options.map((o) => o.name))
    const inputOptionNames = Object.keys(input.options)

    // Check for invalid options
    for (const name of inputOptionNames) {
      if (!productOptionNames.has(name)) {
        throw new Error(`Invalid option '${name}' - not defined on product`)
      }
    }

    // Check for missing required options
    for (const option of this.options) {
      if (!(option.name in input.options)) {
        throw new Error(`Missing required option '${option.name}'`)
      }
      if (!option.values.includes(input.options[option.name])) {
        throw new Error(
          `Invalid value '${input.options[option.name]}' for option '${option.name}'`
        )
      }
    }

    // Validate price if provided
    if (input.price !== undefined && input.price < 0) {
      throw new Error('Variant price must be non-negative')
    }

    if (
      input.price !== undefined &&
      input.compareAtPrice !== undefined &&
      input.compareAtPrice <= input.price
    ) {
      throw new Error('Compare at price must be greater than variant price')
    }

    // Check for duplicate options
    const existingVariant = this.findVariant(input.options)
    if (existingVariant) {
      throw new Error('Variant with these options already exists')
    }

    // Check for duplicate SKU
    if (input.sku && this.variants.some((v) => v.sku === input.sku)) {
      throw new Error('SKU already exists')
    }

    const variant = new VariantModel(this, input)
    this.variants.push(variant)
    this.updatedAt = new Date()
    return variant
  }

  /**
   * Find a variant by exact options match
   */
  findVariant(options: Record<string, string>): VariantModel | undefined {
    return this.variants.find((v) => {
      const vKeys = Object.keys(v.options).sort()
      const qKeys = Object.keys(options).sort()

      if (vKeys.length !== qKeys.length) return false

      return vKeys.every(
        (key, i) => key === qKeys[i] && v.options[key] === options[key]
      )
    })
  }

  /**
   * Remove a variant by ID
   */
  removeVariant(variantId: string): void {
    this.variants = this.variants.filter((v) => v.id !== variantId)
    if (this._defaultVariantId === variantId) {
      this._defaultVariantId = undefined
    }
    this.updatedAt = new Date()
  }

  /**
   * Create variants for all option combinations
   */
  createAllVariants(options?: VariantMatrixOptions): VariantModel[] {
    const combinations = this.getVariantCombinations()
    const created: VariantModel[] = []

    for (const combo of combinations) {
      let sku: string | undefined
      if (options?.skuPattern) {
        sku = options.skuPattern
        for (const [key, value] of Object.entries(combo)) {
          sku = sku.replace(`{${key}}`, value)
        }
      }

      // Calculate price with adjustments
      let price: number | undefined
      if (options?.priceAdjustments) {
        let adjustment = 0
        for (const [optionName, optionValue] of Object.entries(combo)) {
          const optionAdjustments = options.priceAdjustments[optionName]
          if (optionAdjustments && optionValue in optionAdjustments) {
            adjustment += optionAdjustments[optionValue]
          }
        }
        if (adjustment !== 0) {
          price = this.basePrice + adjustment
        }
      }

      const variant = this.addVariant({
        options: combo,
        sku,
        price,
      })
      created.push(variant)
    }

    return created
  }

  /**
   * Get price range across all variants
   */
  getPriceRange(): PriceRange {
    if (this.variants.length === 0) {
      return { min: this.basePrice, max: this.basePrice }
    }

    const prices = this.variants.map((v) => v.getEffectivePrice())
    return {
      min: Math.min(...prices),
      max: Math.max(...prices),
    }
  }

  /**
   * Get effective price (base price)
   */
  getEffectivePrice(): number {
    return this.basePrice
  }

  /**
   * Calculate discount percentage
   */
  getDiscountPercentage(): number {
    if (!this.compareAtPrice) return 0
    return Math.round(
      ((this.compareAtPrice - this.basePrice) / this.compareAtPrice) * 100
    )
  }

  /**
   * Check if product is on sale
   */
  isOnSale(): boolean {
    return this.compareAtPrice !== undefined && this.compareAtPrice > this.basePrice
  }

  /**
   * Get the default variant
   */
  getDefaultVariant(): VariantModel | undefined {
    if (this._defaultVariantId) {
      return this.variants.find((v) => v.id === this._defaultVariantId)
    }
    return this.variants[0]
  }

  /**
   * Set the default variant
   */
  setDefaultVariant(variantId: string): void {
    if (!this.variants.some((v) => v.id === variantId)) {
      throw new Error('Variant not found')
    }
    this._defaultVariantId = variantId
    this.updatedAt = new Date()
  }

  /**
   * Publish the product
   */
  publish(): void {
    if (this.status === 'archived') {
      throw new Error('Cannot publish archived product')
    }
    this.status = 'active'
    this.publishedAt = new Date()
    this.updatedAt = new Date()
  }

  /**
   * Archive the product
   */
  archive(): void {
    this.status = 'archived'
    this.updatedAt = new Date()
  }

  /**
   * Unpublish the product (back to draft)
   */
  unpublish(): void {
    this.status = 'draft'
    this.updatedAt = new Date()
  }
}

// =============================================================================
// Product-Variant Store
// =============================================================================

export interface ProductVariantStore {
  // Products
  createProduct(input: CreateProductInput): Promise<ProductModel>
  getProduct(id: string): Promise<ProductModel | null>
  updateProduct(id: string, input: UpdateProductInput): Promise<ProductModel>
  deleteProduct(id: string): Promise<void>
  listProducts(): Promise<ProductModel[]>

  // Product options
  setProductOptions(productId: string, options: ProductOption[]): Promise<void>

  // Variants
  createVariantsFromOptions(
    productId: string,
    options?: VariantMatrixOptions
  ): Promise<VariantModel[]>
  getVariantsByProduct(productId: string): Promise<VariantModel[]>
  findVariantBySku(sku: string): Promise<VariantModel | null>
  getVariantWithProduct(
    variantId: string
  ): Promise<{ variant: VariantModel; product: ProductModel } | null>

  // Cross-product queries
  findVariantsByOption(
    optionName: string,
    optionValue: string
  ): Promise<VariantModel[]>
  findVariantsInPriceRange(
    minPrice: number,
    maxPrice: number
  ): Promise<VariantModel[]>
}

class InMemoryProductVariantStore implements ProductVariantStore {
  private products: Map<string, ProductModel> = new Map()

  async createProduct(input: CreateProductInput): Promise<ProductModel> {
    const product = new ProductModel(input)
    this.products.set(product.id, product)
    return product
  }

  async getProduct(id: string): Promise<ProductModel | null> {
    return this.products.get(id) ?? null
  }

  async updateProduct(
    id: string,
    input: UpdateProductInput
  ): Promise<ProductModel> {
    const product = this.products.get(id)
    if (!product) {
      throw new Error('Product not found')
    }

    if (input.name !== undefined) product.name = input.name
    if (input.basePrice !== undefined) product.basePrice = input.basePrice
    if (input.description !== undefined) product.description = input.description
    if (input.sku !== undefined) product.sku = input.sku
    if (input.compareAtPrice !== undefined)
      product.compareAtPrice = input.compareAtPrice
    if (input.tags !== undefined) product.tags = input.tags
    if (input.metadata !== undefined) product.metadata = input.metadata

    product.updatedAt = new Date()
    return product
  }

  async deleteProduct(id: string): Promise<void> {
    this.products.delete(id)
  }

  async listProducts(): Promise<ProductModel[]> {
    return Array.from(this.products.values())
  }

  async setProductOptions(
    productId: string,
    options: ProductOption[]
  ): Promise<void> {
    const product = this.products.get(productId)
    if (!product) {
      throw new Error('Product not found')
    }
    product.setOptions(options)
  }

  async createVariantsFromOptions(
    productId: string,
    options?: VariantMatrixOptions
  ): Promise<VariantModel[]> {
    const product = this.products.get(productId)
    if (!product) {
      throw new Error('Product not found')
    }
    return product.createAllVariants(options)
  }

  async getVariantsByProduct(productId: string): Promise<VariantModel[]> {
    const product = this.products.get(productId)
    if (!product) return []
    return product.variants
  }

  async findVariantBySku(sku: string): Promise<VariantModel | null> {
    for (const product of this.products.values()) {
      const variant = product.variants.find((v) => v.sku === sku)
      if (variant) return variant
    }
    return null
  }

  async getVariantWithProduct(
    variantId: string
  ): Promise<{ variant: VariantModel; product: ProductModel } | null> {
    for (const product of this.products.values()) {
      const variant = product.variants.find((v) => v.id === variantId)
      if (variant) return { variant, product }
    }
    return null
  }

  async findVariantsByOption(
    optionName: string,
    optionValue: string
  ): Promise<VariantModel[]> {
    const results: VariantModel[] = []
    for (const product of this.products.values()) {
      for (const variant of product.variants) {
        if (variant.options[optionName] === optionValue) {
          results.push(variant)
        }
      }
    }
    return results
  }

  async findVariantsInPriceRange(
    minPrice: number,
    maxPrice: number
  ): Promise<VariantModel[]> {
    const results: VariantModel[] = []
    for (const product of this.products.values()) {
      for (const variant of product.variants) {
        const price = variant.getEffectivePrice()
        if (price >= minPrice && price <= maxPrice) {
          results.push(variant)
        }
      }
    }
    return results
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

export function createProduct(input: CreateProductInput): ProductModel {
  return new ProductModel(input)
}

export function createVariant(
  product: ProductModel,
  input: CreateVariantInput
): VariantModel {
  return product.addVariant(input)
}

export function createProductVariantStore(): ProductVariantStore {
  return new InMemoryProductVariantStore()
}
