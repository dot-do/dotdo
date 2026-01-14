/**
 * Product & Variant Model Tests
 *
 * Tests for Product and Variant domain models providing:
 * - Product creation with validation
 * - Variant options (size, color, etc.)
 * - Pricing per variant with inheritance
 * - SKU generation patterns
 * - Product-variant relationships
 * - Variant option validation against product options
 * - Inventory per variant integration
 * - Complex variant queries
 *
 * @module db/primitives/commerce/tests/product-variant
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createProduct,
  createVariant,
  createProductVariantStore,
  type ProductModel,
  type VariantModel,
  type ProductVariantStore,
} from '../product-variant'
import { createInventoryManager, type InventoryManager } from '../inventory'

// =============================================================================
// Product Model Tests
// =============================================================================

describe('ProductModel', () => {
  describe('creation', () => {
    it('should create a product with required fields', () => {
      const product = createProduct({
        name: 'Classic T-Shirt',
        basePrice: 2999,
      })

      expect(product.id).toBeDefined()
      expect(product.id).toMatch(/^prod_/)
      expect(product.name).toBe('Classic T-Shirt')
      expect(product.basePrice).toBe(2999)
      expect(product.status).toBe('draft')
      expect(product.createdAt).toBeInstanceOf(Date)
      expect(product.updatedAt).toBeInstanceOf(Date)
    })

    it('should create a product with all optional fields', () => {
      const product = createProduct({
        name: 'Premium Hoodie',
        basePrice: 5999,
        description: 'A warm and cozy hoodie',
        sku: 'HOODIE-001',
        compareAtPrice: 7999,
        tags: ['clothing', 'winter'],
        metadata: { brand: 'Acme' },
      })

      expect(product.description).toBe('A warm and cozy hoodie')
      expect(product.sku).toBe('HOODIE-001')
      expect(product.compareAtPrice).toBe(7999)
      expect(product.tags).toEqual(['clothing', 'winter'])
      expect(product.metadata?.brand).toBe('Acme')
    })

    it('should validate product name is not empty', () => {
      expect(() =>
        createProduct({
          name: '',
          basePrice: 1000,
        })
      ).toThrow('Product name is required')
    })

    it('should validate product name is not too long', () => {
      expect(() =>
        createProduct({
          name: 'A'.repeat(256),
          basePrice: 1000,
        })
      ).toThrow('Product name must be 255 characters or less')
    })

    it('should validate basePrice is non-negative', () => {
      expect(() =>
        createProduct({
          name: 'Test Product',
          basePrice: -100,
        })
      ).toThrow('Base price must be non-negative')
    })

    it('should validate compareAtPrice is greater than basePrice when set', () => {
      expect(() =>
        createProduct({
          name: 'Test Product',
          basePrice: 5000,
          compareAtPrice: 3000,
        })
      ).toThrow('Compare at price must be greater than base price')
    })
  })

  describe('product options', () => {
    let product: ProductModel

    beforeEach(() => {
      product = createProduct({
        name: 'Configurable T-Shirt',
        basePrice: 2999,
      })
    })

    it('should define product options', () => {
      product.setOptions([
        { name: 'Size', values: ['S', 'M', 'L', 'XL'] },
        { name: 'Color', values: ['Red', 'Blue', 'Green'] },
      ])

      expect(product.options).toHaveLength(2)
      expect(product.options[0].name).toBe('Size')
      expect(product.options[0].values).toEqual(['S', 'M', 'L', 'XL'])
      expect(product.options[1].name).toBe('Color')
    })

    it('should validate option names are unique', () => {
      expect(() =>
        product.setOptions([
          { name: 'Size', values: ['S', 'M'] },
          { name: 'Size', values: ['L', 'XL'] },
        ])
      ).toThrow('Option names must be unique')
    })

    it('should validate option values are unique within an option', () => {
      expect(() =>
        product.setOptions([{ name: 'Size', values: ['S', 'M', 'S'] }])
      ).toThrow('Option values must be unique')
    })

    it('should validate at least one value per option', () => {
      expect(() =>
        product.setOptions([{ name: 'Size', values: [] }])
      ).toThrow('Option must have at least one value')
    })

    it('should limit number of options', () => {
      expect(() =>
        product.setOptions([
          { name: 'Option1', values: ['A'] },
          { name: 'Option2', values: ['B'] },
          { name: 'Option3', values: ['C'] },
          { name: 'Option4', values: ['D'] },
        ])
      ).toThrow('Maximum 3 options allowed per product')
    })

    it('should generate variant combinations from options', () => {
      product.setOptions([
        { name: 'Size', values: ['S', 'M'] },
        { name: 'Color', values: ['Red', 'Blue'] },
      ])

      const combinations = product.getVariantCombinations()

      expect(combinations).toHaveLength(4)
      expect(combinations).toContainEqual({ Size: 'S', Color: 'Red' })
      expect(combinations).toContainEqual({ Size: 'S', Color: 'Blue' })
      expect(combinations).toContainEqual({ Size: 'M', Color: 'Red' })
      expect(combinations).toContainEqual({ Size: 'M', Color: 'Blue' })
    })

    it('should handle single option correctly', () => {
      product.setOptions([{ name: 'Size', values: ['S', 'M', 'L'] }])

      const combinations = product.getVariantCombinations()

      expect(combinations).toHaveLength(3)
      expect(combinations).toContainEqual({ Size: 'S' })
      expect(combinations).toContainEqual({ Size: 'M' })
      expect(combinations).toContainEqual({ Size: 'L' })
    })

    it('should return empty array when no options defined', () => {
      const combinations = product.getVariantCombinations()
      expect(combinations).toEqual([])
    })
  })

  describe('pricing', () => {
    it('should calculate effective price with no discount', () => {
      const product = createProduct({
        name: 'Test Product',
        basePrice: 5000,
      })

      expect(product.getEffectivePrice()).toBe(5000)
    })

    it('should calculate discount percentage when compareAtPrice is set', () => {
      const product = createProduct({
        name: 'Sale Product',
        basePrice: 2500,
        compareAtPrice: 5000,
      })

      expect(product.getDiscountPercentage()).toBe(50)
    })

    it('should return 0 discount when no compareAtPrice', () => {
      const product = createProduct({
        name: 'Regular Product',
        basePrice: 2500,
      })

      expect(product.getDiscountPercentage()).toBe(0)
    })

    it('should determine if product is on sale', () => {
      const regularProduct = createProduct({
        name: 'Regular',
        basePrice: 2500,
      })

      const saleProduct = createProduct({
        name: 'On Sale',
        basePrice: 2500,
        compareAtPrice: 5000,
      })

      expect(regularProduct.isOnSale()).toBe(false)
      expect(saleProduct.isOnSale()).toBe(true)
    })
  })

  describe('lifecycle', () => {
    let product: ProductModel

    beforeEach(() => {
      product = createProduct({
        name: 'Lifecycle Product',
        basePrice: 1000,
      })
    })

    it('should start in draft status', () => {
      expect(product.status).toBe('draft')
      expect(product.publishedAt).toBeUndefined()
    })

    it('should publish a product', () => {
      product.publish()

      expect(product.status).toBe('active')
      expect(product.publishedAt).toBeInstanceOf(Date)
    })

    it('should archive a product', () => {
      product.publish()
      product.archive()

      expect(product.status).toBe('archived')
    })

    it('should unpublish a product back to draft', () => {
      product.publish()
      product.unpublish()

      expect(product.status).toBe('draft')
    })

    it('should not allow publishing an archived product', () => {
      product.publish()
      product.archive()

      expect(() => product.publish()).toThrow('Cannot publish archived product')
    })

    it('should track updatedAt on status changes', () => {
      const initialUpdatedAt = product.updatedAt

      // Small delay to ensure different timestamp
      product.publish()

      expect(product.updatedAt.getTime()).toBeGreaterThanOrEqual(
        initialUpdatedAt.getTime()
      )
    })
  })
})

// =============================================================================
// Variant Model Tests
// =============================================================================

describe('VariantModel', () => {
  let product: ProductModel

  beforeEach(() => {
    product = createProduct({
      name: 'T-Shirt',
      basePrice: 2999,
    })
    product.setOptions([
      { name: 'Size', values: ['S', 'M', 'L'] },
      { name: 'Color', values: ['Red', 'Blue'] },
    ])
  })

  describe('creation', () => {
    it('should create a variant with valid options', () => {
      const variant = createVariant(product, {
        options: { Size: 'M', Color: 'Red' },
      })

      expect(variant.id).toBeDefined()
      expect(variant.id).toMatch(/^var_/)
      expect(variant.productId).toBe(product.id)
      expect(variant.options).toEqual({ Size: 'M', Color: 'Red' })
      expect(variant.createdAt).toBeInstanceOf(Date)
    })

    it('should create a variant with SKU', () => {
      const variant = createVariant(product, {
        options: { Size: 'M', Color: 'Red' },
        sku: 'TSHIRT-M-RED',
      })

      expect(variant.sku).toBe('TSHIRT-M-RED')
    })

    it('should create a variant with custom price', () => {
      const variant = createVariant(product, {
        options: { Size: 'M', Color: 'Red' },
        price: 3499,
      })

      expect(variant.price).toBe(3499)
    })

    it('should create a variant with compareAtPrice', () => {
      const variant = createVariant(product, {
        options: { Size: 'M', Color: 'Red' },
        price: 2999,
        compareAtPrice: 3999,
      })

      expect(variant.compareAtPrice).toBe(3999)
    })

    it('should create a variant with weight', () => {
      const variant = createVariant(product, {
        options: { Size: 'M', Color: 'Red' },
        weight: 250, // grams
      })

      expect(variant.weight).toBe(250)
    })

    it('should validate options match product options', () => {
      expect(() =>
        createVariant(product, {
          options: { Size: 'M', Material: 'Cotton' },
        })
      ).toThrow("Invalid option 'Material' - not defined on product")
    })

    it('should validate option values match product option values', () => {
      expect(() =>
        createVariant(product, {
          options: { Size: 'XXL', Color: 'Red' },
        })
      ).toThrow("Invalid value 'XXL' for option 'Size'")
    })

    it('should require all product options to be specified', () => {
      expect(() =>
        createVariant(product, {
          options: { Size: 'M' }, // Missing Color
        })
      ).toThrow("Missing required option 'Color'")
    })

    it('should validate price is non-negative', () => {
      expect(() =>
        createVariant(product, {
          options: { Size: 'M', Color: 'Red' },
          price: -100,
        })
      ).toThrow('Variant price must be non-negative')
    })

    it('should validate compareAtPrice is greater than price', () => {
      expect(() =>
        createVariant(product, {
          options: { Size: 'M', Color: 'Red' },
          price: 5000,
          compareAtPrice: 3000,
        })
      ).toThrow('Compare at price must be greater than variant price')
    })
  })

  describe('pricing inheritance', () => {
    it('should inherit base price from product when no price specified', () => {
      const variant = createVariant(product, {
        options: { Size: 'M', Color: 'Red' },
      })

      expect(variant.price).toBeUndefined()
      expect(variant.getEffectivePrice()).toBe(2999) // product.basePrice
    })

    it('should use variant price when specified', () => {
      const variant = createVariant(product, {
        options: { Size: 'M', Color: 'Red' },
        price: 3499,
      })

      expect(variant.getEffectivePrice()).toBe(3499)
    })

    it('should inherit compareAtPrice from product when not specified on variant', () => {
      const productWithSale = createProduct({
        name: 'Sale T-Shirt',
        basePrice: 2999,
        compareAtPrice: 4999,
      })
      productWithSale.setOptions([{ name: 'Size', values: ['M'] }])

      const variant = createVariant(productWithSale, {
        options: { Size: 'M' },
      })

      expect(variant.getEffectiveCompareAtPrice()).toBe(4999)
    })

    it('should use variant compareAtPrice when specified', () => {
      const productWithSale = createProduct({
        name: 'Sale T-Shirt',
        basePrice: 2999,
        compareAtPrice: 4999,
      })
      productWithSale.setOptions([{ name: 'Size', values: ['M'] }])

      const variant = createVariant(productWithSale, {
        options: { Size: 'M' },
        price: 3499,
        compareAtPrice: 5999,
      })

      expect(variant.getEffectiveCompareAtPrice()).toBe(5999)
    })
  })

  describe('SKU generation', () => {
    it('should generate SKU from pattern', () => {
      const variant = createVariant(product, {
        options: { Size: 'M', Color: 'Red' },
      })

      const sku = variant.generateSku('TSHIRT-{Size}-{Color}')

      expect(sku).toBe('TSHIRT-M-Red')
    })

    it('should generate SKU with uppercase values', () => {
      const variant = createVariant(product, {
        options: { Size: 'M', Color: 'Red' },
      })

      const sku = variant.generateSku('TSHIRT-{Size:upper}-{Color:upper}')

      expect(sku).toBe('TSHIRT-M-RED')
    })

    it('should generate SKU with lowercase values', () => {
      const variant = createVariant(product, {
        options: { Size: 'M', Color: 'Red' },
      })

      const sku = variant.generateSku('tshirt-{Size:lower}-{Color:lower}')

      expect(sku).toBe('tshirt-m-red')
    })

    it('should generate SKU with abbreviated values', () => {
      const variant = createVariant(product, {
        options: { Size: 'M', Color: 'Red' },
      })

      const sku = variant.generateSku('TS-{Size}-{Color:abbr3}')

      expect(sku).toBe('TS-M-RED')
    })

    it('should handle missing placeholders gracefully', () => {
      const variant = createVariant(product, {
        options: { Size: 'M', Color: 'Red' },
      })

      const sku = variant.generateSku('TSHIRT-{Size}-{Unknown}')

      expect(sku).toBe('TSHIRT-M-{Unknown}')
    })
  })

  describe('variant display', () => {
    it('should generate option display string', () => {
      const variant = createVariant(product, {
        options: { Size: 'M', Color: 'Red' },
      })

      expect(variant.getOptionsDisplay()).toBe('Size: M / Color: Red')
    })

    it('should generate option display with custom separator', () => {
      const variant = createVariant(product, {
        options: { Size: 'M', Color: 'Red' },
      })

      expect(variant.getOptionsDisplay(', ')).toBe('Size: M, Color: Red')
    })

    it('should generate title with product name and options', () => {
      const variant = createVariant(product, {
        options: { Size: 'M', Color: 'Red' },
      })

      expect(variant.getFullTitle()).toBe('T-Shirt - Size: M / Color: Red')
    })
  })

  describe('comparison', () => {
    it('should compare variants by options', () => {
      const variant1 = createVariant(product, {
        options: { Size: 'M', Color: 'Red' },
      })
      // Create a second product to test comparison across products
      const product2 = createProduct({
        name: 'Another T-Shirt',
        basePrice: 2999,
      })
      product2.setOptions([
        { name: 'Size', values: ['S', 'M', 'L'] },
        { name: 'Color', values: ['Red', 'Blue'] },
      ])
      const variant2 = createVariant(product2, {
        options: { Size: 'M', Color: 'Red' },
      })
      const variant3 = createVariant(product, {
        options: { Size: 'L', Color: 'Blue' },
      })

      expect(variant1.hasMatchingOptions(variant2)).toBe(true)
      expect(variant1.hasMatchingOptions(variant3)).toBe(false)
    })

    it('should match variant by option query', () => {
      const variant = createVariant(product, {
        options: { Size: 'M', Color: 'Red' },
      })

      expect(variant.matchesOptions({ Size: 'M' })).toBe(true)
      expect(variant.matchesOptions({ Color: 'Red' })).toBe(true)
      expect(variant.matchesOptions({ Size: 'M', Color: 'Red' })).toBe(true)
      expect(variant.matchesOptions({ Size: 'L' })).toBe(false)
    })
  })
})

// =============================================================================
// Product-Variant Integration Tests
// =============================================================================

describe('Product-Variant Integration', () => {
  describe('variant management on product', () => {
    let product: ProductModel

    beforeEach(() => {
      product = createProduct({
        name: 'Multi-Variant Product',
        basePrice: 2999,
      })
      product.setOptions([
        { name: 'Size', values: ['S', 'M', 'L'] },
        { name: 'Color', values: ['Red', 'Blue'] },
      ])
    })

    it('should add variant to product', () => {
      const variant = product.addVariant({
        options: { Size: 'M', Color: 'Red' },
      })

      expect(product.variants).toHaveLength(1)
      expect(product.variants[0].id).toBe(variant.id)
    })

    it('should prevent duplicate option combinations', () => {
      product.addVariant({
        options: { Size: 'M', Color: 'Red' },
      })

      expect(() =>
        product.addVariant({
          options: { Size: 'M', Color: 'Red' },
        })
      ).toThrow('Variant with these options already exists')
    })

    it('should find variant by options', () => {
      product.addVariant({
        options: { Size: 'S', Color: 'Red' },
      })
      product.addVariant({
        options: { Size: 'M', Color: 'Red' },
      })
      product.addVariant({
        options: { Size: 'M', Color: 'Blue' },
      })

      const found = product.findVariant({ Size: 'M', Color: 'Blue' })

      expect(found).toBeDefined()
      expect(found?.options).toEqual({ Size: 'M', Color: 'Blue' })
    })

    it('should return undefined when variant not found', () => {
      const found = product.findVariant({ Size: 'XXL', Color: 'Green' })
      expect(found).toBeUndefined()
    })

    it('should remove variant from product', () => {
      const variant = product.addVariant({
        options: { Size: 'M', Color: 'Red' },
      })

      product.removeVariant(variant.id)

      expect(product.variants).toHaveLength(0)
    })

    it('should bulk create variants from all combinations', () => {
      const variants = product.createAllVariants()

      expect(variants).toHaveLength(6) // 3 sizes x 2 colors
      expect(product.variants).toHaveLength(6)
    })

    it('should bulk create variants with SKU pattern', () => {
      const variants = product.createAllVariants({
        skuPattern: 'PROD-{Size}-{Color}',
      })

      const skus = variants.map((v) => v.sku)
      expect(skus).toContain('PROD-S-Red')
      expect(skus).toContain('PROD-M-Blue')
      expect(skus).toContain('PROD-L-Red')
    })

    it('should bulk create variants with price adjustments', () => {
      const variants = product.createAllVariants({
        priceAdjustments: {
          Size: { L: 500 }, // $5 extra for Large
          Color: { Blue: 200 }, // $2 extra for Blue
        },
      })

      const smallRed = variants.find(
        (v) => v.options.Size === 'S' && v.options.Color === 'Red'
      )
      const largeBlue = variants.find(
        (v) => v.options.Size === 'L' && v.options.Color === 'Blue'
      )

      expect(smallRed?.price).toBeUndefined() // No adjustment
      expect(largeBlue?.price).toBe(2999 + 500 + 200) // Base + size + color
    })

    it('should get price range across all variants', () => {
      product.addVariant({
        options: { Size: 'S', Color: 'Red' },
        // Uses base price: 2999
      })
      product.addVariant({
        options: { Size: 'M', Color: 'Red' },
        price: 3499,
      })
      product.addVariant({
        options: { Size: 'L', Color: 'Blue' },
        price: 3999,
      })

      const range = product.getPriceRange()

      expect(range.min).toBe(2999)
      expect(range.max).toBe(3999)
    })

    it('should return single price when all variants same price', () => {
      product.addVariant({
        options: { Size: 'S', Color: 'Red' },
      })
      product.addVariant({
        options: { Size: 'M', Color: 'Red' },
      })

      const range = product.getPriceRange()

      expect(range.min).toBe(2999)
      expect(range.max).toBe(2999)
    })
  })

  describe('SKU uniqueness across products', () => {
    it('should validate SKU uniqueness within product variants', () => {
      const product = createProduct({
        name: 'Test Product',
        basePrice: 1000,
      })
      product.setOptions([{ name: 'Size', values: ['S', 'M'] }])

      product.addVariant({
        options: { Size: 'S' },
        sku: 'SAME-SKU',
      })

      expect(() =>
        product.addVariant({
          options: { Size: 'M' },
          sku: 'SAME-SKU',
        })
      ).toThrow('SKU already exists')
    })
  })

  describe('default variant', () => {
    let product: ProductModel

    beforeEach(() => {
      product = createProduct({
        name: 'Product with Variants',
        basePrice: 2999,
      })
      product.setOptions([{ name: 'Size', values: ['S', 'M', 'L'] }])
    })

    it('should return first variant as default', () => {
      product.addVariant({ options: { Size: 'S' } })
      product.addVariant({ options: { Size: 'M' } })
      product.addVariant({ options: { Size: 'L' } })

      const defaultVariant = product.getDefaultVariant()

      expect(defaultVariant?.options.Size).toBe('S')
    })

    it('should return undefined when no variants', () => {
      const defaultVariant = product.getDefaultVariant()
      expect(defaultVariant).toBeUndefined()
    })

    it('should allow setting explicit default variant', () => {
      const v1 = product.addVariant({ options: { Size: 'S' } })
      const v2 = product.addVariant({ options: { Size: 'M' } })

      product.setDefaultVariant(v2.id)

      const defaultVariant = product.getDefaultVariant()
      expect(defaultVariant?.id).toBe(v2.id)
    })
  })
})

// =============================================================================
// Inventory Per Variant Tests
// =============================================================================

describe('Inventory Per Variant', () => {
  let inventory: InventoryManager
  let product: ProductModel

  beforeEach(async () => {
    inventory = createInventoryManager()
    product = createProduct({
      name: 'T-Shirt with Inventory',
      basePrice: 2999,
    })
    product.setOptions([
      { name: 'Size', values: ['S', 'M', 'L', 'XL'] },
      { name: 'Color', values: ['Red', 'Blue', 'Black'] },
    ])
  })

  describe('stock per variant', () => {
    it('should set and get stock for individual variants', async () => {
      const variantSmallRed = product.addVariant({
        options: { Size: 'S', Color: 'Red' },
        sku: 'TSHIRT-S-RED',
      })
      const variantMediumBlue = product.addVariant({
        options: { Size: 'M', Color: 'Blue' },
        sku: 'TSHIRT-M-BLUE',
      })

      await inventory.setStock(variantSmallRed.id, 50)
      await inventory.setStock(variantMediumBlue.id, 75)

      expect(await inventory.getStock(variantSmallRed.id)).toBe(50)
      expect(await inventory.getStock(variantMediumBlue.id)).toBe(75)
    })

    it('should track stock independently per variant', async () => {
      const variants = product.createAllVariants({
        skuPattern: 'TS-{Size}-{Color}',
      })

      // Set different stock levels for each size
      for (const variant of variants) {
        const baseStock =
          variant.options.Size === 'S'
            ? 100
            : variant.options.Size === 'M'
              ? 200
              : variant.options.Size === 'L'
                ? 150
                : 50 // XL

        await inventory.setStock(variant.id, baseStock)
      }

      // Verify each variant has independent stock
      const smallVariants = variants.filter((v) => v.options.Size === 'S')
      const mediumVariants = variants.filter((v) => v.options.Size === 'M')

      for (const v of smallVariants) {
        expect(await inventory.getStock(v.id)).toBe(100)
      }
      for (const v of mediumVariants) {
        expect(await inventory.getStock(v.id)).toBe(200)
      }
    })

    it('should allow selling down stock for specific variant', async () => {
      const variant = product.addVariant({
        options: { Size: 'M', Color: 'Black' },
      })

      await inventory.setStock(variant.id, 100)
      await inventory.adjustStock(variant.id, -25, 'Sale order #123')

      expect(await inventory.getStock(variant.id)).toBe(75)
    })

    it('should prevent overselling a specific variant', async () => {
      const variant = product.addVariant({
        options: { Size: 'L', Color: 'Red' },
      })

      await inventory.setStock(variant.id, 10)

      await expect(
        inventory.adjustStock(variant.id, -15, 'Over-sale attempt')
      ).rejects.toThrow('Insufficient stock')
    })
  })

  describe('variant availability', () => {
    it('should check availability for single variant', async () => {
      const variant = product.addVariant({
        options: { Size: 'M', Color: 'Blue' },
      })

      await inventory.setStock(variant.id, 25)

      expect(await inventory.isAvailable(variant.id, 20)).toBe(true)
      expect(await inventory.isAvailable(variant.id, 25)).toBe(true)
      expect(await inventory.isAvailable(variant.id, 30)).toBe(false)
    })

    it('should check availability for multiple variants in cart', async () => {
      const variant1 = product.addVariant({
        options: { Size: 'S', Color: 'Red' },
      })
      const variant2 = product.addVariant({
        options: { Size: 'M', Color: 'Blue' },
      })
      const variant3 = product.addVariant({
        options: { Size: 'L', Color: 'Black' },
      })

      await inventory.setStock(variant1.id, 10)
      await inventory.setStock(variant2.id, 5)
      await inventory.setStock(variant3.id, 0)

      const result = await inventory.checkAvailability([
        { variantId: variant1.id, quantity: 5 },
        { variantId: variant2.id, quantity: 5 },
        { variantId: variant3.id, quantity: 1 },
      ])

      expect(result.available).toBe(false)
      expect(result.items[0].available).toBe(true)
      expect(result.items[1].available).toBe(true)
      expect(result.items[2].available).toBe(false)
    })

    it('should return out of stock variants', async () => {
      const variants = product.createAllVariants()

      // Set some to zero stock
      await inventory.setStock(variants[0].id, 0)
      await inventory.setStock(variants[1].id, 0)
      await inventory.setStock(variants[2].id, 50)

      const outOfStock = await inventory.getOutOfStockItems()

      expect(outOfStock.length).toBe(2)
      expect(outOfStock.map((i) => i.variantId)).toContain(variants[0].id)
      expect(outOfStock.map((i) => i.variantId)).toContain(variants[1].id)
    })
  })

  describe('low stock alerts per variant', () => {
    it('should set low stock threshold per variant', async () => {
      const variant = product.addVariant({
        options: { Size: 'M', Color: 'Red' },
      })

      await inventory.setStock(variant.id, 100)
      await inventory.setLowStockThreshold(variant.id, 20)

      const level = await inventory.getInventoryLevel(variant.id)
      expect(level.lowStockThreshold).toBe(20)
    })

    it('should trigger alert when variant stock drops below threshold', async () => {
      const alertCallback = vi.fn()
      inventory = createInventoryManager({ onLowStock: alertCallback })

      const variant = product.addVariant({
        options: { Size: 'XL', Color: 'Black' },
      })

      await inventory.setStock(variant.id, 50)
      await inventory.setLowStockThreshold(variant.id, 15)

      // Drop stock below threshold
      await inventory.adjustStock(variant.id, -40, 'Big sale')

      expect(alertCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          variantId: variant.id,
          currentStock: 10,
          threshold: 15,
        })
      )
    })

    it('should identify all low stock variants', async () => {
      const variants = product.createAllVariants()

      // Set varied stock levels and thresholds
      await inventory.setStock(variants[0].id, 5)
      await inventory.setLowStockThreshold(variants[0].id, 10) // Low stock

      await inventory.setStock(variants[1].id, 100)
      await inventory.setLowStockThreshold(variants[1].id, 20) // Not low

      await inventory.setStock(variants[2].id, 3)
      await inventory.setLowStockThreshold(variants[2].id, 5) // Low stock

      const lowStock = await inventory.getLowStockItems()

      expect(lowStock.length).toBe(2)
      expect(lowStock.map((i) => i.variantId)).toContain(variants[0].id)
      expect(lowStock.map((i) => i.variantId)).toContain(variants[2].id)
    })
  })

  describe('reservations per variant', () => {
    it('should reserve stock for specific variant', async () => {
      const variant = product.addVariant({
        options: { Size: 'L', Color: 'Blue' },
      })

      await inventory.setStock(variant.id, 50)

      const reservation = await inventory.createReservation({
        variantId: variant.id,
        quantity: 10,
        referenceId: 'cart-123',
        referenceType: 'cart',
      })

      expect(reservation.variantId).toBe(variant.id)
      expect(reservation.quantity).toBe(10)

      const level = await inventory.getInventoryLevel(variant.id)
      expect(level.onHand).toBe(50)
      expect(level.reserved).toBe(10)
      expect(level.available).toBe(40)
    })

    it('should handle multiple reservations across variants', async () => {
      const variant1 = product.addVariant({
        options: { Size: 'S', Color: 'Red' },
      })
      const variant2 = product.addVariant({
        options: { Size: 'M', Color: 'Blue' },
      })

      await inventory.setStock(variant1.id, 30)
      await inventory.setStock(variant2.id, 20)

      const reservations = await inventory.createBulkReservation({
        items: [
          { variantId: variant1.id, quantity: 5 },
          { variantId: variant2.id, quantity: 3 },
        ],
        referenceId: 'order-456',
        referenceType: 'order',
      })

      expect(reservations).toHaveLength(2)

      const level1 = await inventory.getInventoryLevel(variant1.id)
      const level2 = await inventory.getInventoryLevel(variant2.id)

      expect(level1.available).toBe(25)
      expect(level2.available).toBe(17)
    })

    it('should confirm reservation and deduct stock for variant', async () => {
      const variant = product.addVariant({
        options: { Size: 'M', Color: 'Black' },
      })

      await inventory.setStock(variant.id, 100)

      const reservation = await inventory.createReservation({
        variantId: variant.id,
        quantity: 15,
        referenceId: 'cart-789',
        referenceType: 'cart',
      })

      await inventory.confirmReservation(reservation.id, 'order-999')

      const level = await inventory.getInventoryLevel(variant.id)
      expect(level.onHand).toBe(85)
      expect(level.reserved).toBe(0)
      expect(level.available).toBe(85)
    })
  })

  describe('stock movements per variant', () => {
    it('should track stock movements for individual variants', async () => {
      const variant = product.addVariant({
        options: { Size: 'L', Color: 'Red' },
      })

      await inventory.setStock(variant.id, 100)
      await inventory.adjustStock(variant.id, -20, 'Online sale')
      await inventory.adjustStock(variant.id, 50, 'Restock')
      await inventory.adjustStock(variant.id, -5, 'Return processed')

      const movements = await inventory.getStockMovements(variant.id)

      expect(movements.length).toBeGreaterThanOrEqual(3)
      expect(movements.some((m) => m.reason === 'Online sale')).toBe(true)
      expect(movements.some((m) => m.reason === 'Restock')).toBe(true)
    })

    it('should calculate historical stock for variant', async () => {
      const variant = product.addVariant({
        options: { Size: 'XL', Color: 'Blue' },
      })

      const startTime = new Date()
      await inventory.setStock(variant.id, 100)

      await new Promise((r) => setTimeout(r, 10))
      await inventory.adjustStock(variant.id, -30, 'Sales')

      await new Promise((r) => setTimeout(r, 10))
      await inventory.adjustStock(variant.id, 20, 'Returns')

      // Current stock should be 90
      expect(await inventory.getStock(variant.id)).toBe(90)

      // Historical stock at start
      const historicalStock = await inventory.getStockAsOf(variant.id, startTime)
      expect(historicalStock).toBeLessThanOrEqual(100)
    })
  })
})

// =============================================================================
// Variant Query Tests
// =============================================================================

describe('Variant Queries', () => {
  let product: ProductModel

  beforeEach(() => {
    product = createProduct({
      name: 'Queryable Product',
      basePrice: 4999,
    })
    product.setOptions([
      { name: 'Size', values: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
      { name: 'Color', values: ['White', 'Black', 'Navy', 'Gray', 'Red'] },
      { name: 'Material', values: ['Cotton', 'Polyester', 'Blend'] },
    ])
  })

  describe('filtering variants', () => {
    it('should find variants by single option value', () => {
      product.createAllVariants()

      const largeVariants = product.variants.filter((v) =>
        v.matchesOptions({ Size: 'L' })
      )

      // 5 colors * 3 materials = 15 large variants
      expect(largeVariants).toHaveLength(15)
      expect(largeVariants.every((v) => v.options.Size === 'L')).toBe(true)
    })

    it('should find variants by multiple option values', () => {
      product.createAllVariants()

      const mediumCottonVariants = product.variants.filter((v) =>
        v.matchesOptions({ Size: 'M', Material: 'Cotton' })
      )

      // 5 colors for M/Cotton
      expect(mediumCottonVariants).toHaveLength(5)
      expect(
        mediumCottonVariants.every(
          (v) => v.options.Size === 'M' && v.options.Material === 'Cotton'
        )
      ).toBe(true)
    })

    it('should find variants by color only', () => {
      product.createAllVariants()

      const blackVariants = product.variants.filter((v) =>
        v.matchesOptions({ Color: 'Black' })
      )

      // 6 sizes * 3 materials = 18 black variants
      expect(blackVariants).toHaveLength(18)
    })

    it('should find exact variant match', () => {
      product.createAllVariants()

      const exact = product.findVariant({
        Size: 'M',
        Color: 'Navy',
        Material: 'Blend',
      })

      expect(exact).toBeDefined()
      expect(exact?.options).toEqual({
        Size: 'M',
        Color: 'Navy',
        Material: 'Blend',
      })
    })

    it('should return undefined for non-existent combination', () => {
      product.createAllVariants()

      const notFound = product.findVariant({
        Size: 'XXXL', // Not in options
        Color: 'Black',
        Material: 'Cotton',
      })

      expect(notFound).toBeUndefined()
    })
  })

  describe('variant lookups', () => {
    it('should find variant by SKU', () => {
      product.createAllVariants({
        skuPattern: 'PROD-{Size}-{Color}-{Material}',
      })

      const variant = product.variants.find(
        (v) => v.sku === 'PROD-L-Navy-Blend'
      )

      expect(variant).toBeDefined()
      expect(variant?.options.Size).toBe('L')
      expect(variant?.options.Color).toBe('Navy')
      expect(variant?.options.Material).toBe('Blend')
    })

    it('should find variant by ID', () => {
      product.createAllVariants()
      const firstVariant = product.variants[0]

      const found = product.variants.find((v) => v.id === firstVariant.id)

      expect(found).toBe(firstVariant)
    })
  })

  describe('variant aggregations', () => {
    it('should get available options for filtering', () => {
      product.createAllVariants()

      const availableSizes = new Set(product.variants.map((v) => v.options.Size))
      const availableColors = new Set(product.variants.map((v) => v.options.Color))
      const availableMaterials = new Set(product.variants.map((v) => v.options.Material))

      expect(availableSizes.size).toBe(6)
      expect(availableColors.size).toBe(5)
      expect(availableMaterials.size).toBe(3)
    })

    it('should get available colors for a specific size', () => {
      product.createAllVariants()

      const xlVariants = product.variants.filter((v) => v.options.Size === 'XL')
      const colorsForXL = new Set(xlVariants.map((v) => v.options.Color))

      expect(colorsForXL.size).toBe(5) // All colors available in XL
    })

    it('should get available sizes for a specific color and material', () => {
      product.createAllVariants()

      const navyCottonVariants = product.variants.filter(
        (v) => v.options.Color === 'Navy' && v.options.Material === 'Cotton'
      )
      const sizesAvailable = new Set(navyCottonVariants.map((v) => v.options.Size))

      expect(sizesAvailable.size).toBe(6) // All sizes available in Navy/Cotton
    })

    it('should count variants per option value', () => {
      product.createAllVariants()

      const countBySize = new Map<string, number>()
      for (const variant of product.variants) {
        const size = variant.options.Size
        countBySize.set(size, (countBySize.get(size) ?? 0) + 1)
      }

      // Each size should have: 5 colors * 3 materials = 15 variants
      expect(countBySize.get('S')).toBe(15)
      expect(countBySize.get('M')).toBe(15)
      expect(countBySize.get('L')).toBe(15)
    })
  })

  describe('price range queries', () => {
    it('should get price range when variants have same price', () => {
      product.createAllVariants()

      const range = product.getPriceRange()

      expect(range.min).toBe(4999)
      expect(range.max).toBe(4999)
    })

    it('should get price range with varied variant prices', () => {
      product.createAllVariants({
        priceAdjustments: {
          Size: {
            XS: -500,
            S: -250,
            M: 0,
            L: 250,
            XL: 500,
            XXL: 750,
          },
          Material: {
            Cotton: 0,
            Polyester: -200,
            Blend: 300,
          },
        },
      })

      const range = product.getPriceRange()

      // Min: base(4999) + XS(-500) + Polyester(-200) = 4299
      // Max: base(4999) + XXL(750) + Blend(300) = 6049
      expect(range.min).toBe(4299)
      expect(range.max).toBe(6049)
    })

    it('should get variants in a price range', () => {
      product.createAllVariants({
        priceAdjustments: {
          Size: { XS: -1000, XXL: 1000 },
        },
      })

      // Find variants priced at base (4999) - no adjustments
      const standardPriced = product.variants.filter((v) => {
        const price = v.getEffectivePrice()
        return price >= 4500 && price <= 5500
      })

      // All sizes except XS and XXL
      expect(standardPriced.length).toBeGreaterThan(0)
      expect(
        standardPriced.every(
          (v) => v.options.Size !== 'XS' && v.options.Size !== 'XXL'
        )
      ).toBe(true)
    })
  })
})

// =============================================================================
// Product-Variant Store Integration Tests
// =============================================================================

describe('ProductVariantStore', () => {
  let store: ProductVariantStore

  beforeEach(() => {
    store = createProductVariantStore()
  })

  describe('product management', () => {
    it('should create and retrieve a product', async () => {
      const product = await store.createProduct({
        name: 'Store Test Product',
        basePrice: 1999,
      })

      expect(product.id).toBeDefined()

      const retrieved = await store.getProduct(product.id)
      expect(retrieved?.name).toBe('Store Test Product')
    })

    it('should list all products', async () => {
      await store.createProduct({ name: 'Product 1', basePrice: 1000 })
      await store.createProduct({ name: 'Product 2', basePrice: 2000 })
      await store.createProduct({ name: 'Product 3', basePrice: 3000 })

      const products = await store.listProducts()

      expect(products).toHaveLength(3)
    })

    it('should update a product', async () => {
      const product = await store.createProduct({
        name: 'Original Name',
        basePrice: 1000,
      })

      const updated = await store.updateProduct(product.id, {
        name: 'Updated Name',
        basePrice: 1500,
      })

      expect(updated.name).toBe('Updated Name')
      expect(updated.basePrice).toBe(1500)
    })

    it('should delete a product and its variants', async () => {
      const product = await store.createProduct({
        name: 'To Delete',
        basePrice: 999,
      })
      await store.setProductOptions(product.id, [
        { name: 'Size', values: ['S', 'M'] },
      ])
      await store.createVariantsFromOptions(product.id)

      await store.deleteProduct(product.id)

      const retrieved = await store.getProduct(product.id)
      expect(retrieved).toBeNull()

      const variants = await store.getVariantsByProduct(product.id)
      expect(variants).toHaveLength(0)
    })
  })

  describe('variant management', () => {
    it('should create variants for a product', async () => {
      const product = await store.createProduct({
        name: 'Variant Product',
        basePrice: 2499,
      })
      await store.setProductOptions(product.id, [
        { name: 'Size', values: ['S', 'M', 'L'] },
        { name: 'Color', values: ['Red', 'Blue'] },
      ])

      const variants = await store.createVariantsFromOptions(product.id)

      expect(variants).toHaveLength(6)
    })

    it('should find variant by SKU across all products', async () => {
      const product = await store.createProduct({
        name: 'SKU Product',
        basePrice: 1999,
      })
      await store.setProductOptions(product.id, [
        { name: 'Size', values: ['M'] },
      ])
      await store.createVariantsFromOptions(product.id, {
        skuPattern: 'UNIQUE-SKU-{Size}',
      })

      const variant = await store.findVariantBySku('UNIQUE-SKU-M')

      expect(variant).toBeDefined()
      expect(variant?.options.Size).toBe('M')
    })

    it('should get variant with product details', async () => {
      const product = await store.createProduct({
        name: 'Detail Product',
        basePrice: 3999,
      })
      await store.setProductOptions(product.id, [
        { name: 'Size', values: ['L'] },
      ])
      const variants = await store.createVariantsFromOptions(product.id)

      const variantWithProduct = await store.getVariantWithProduct(variants[0].id)

      expect(variantWithProduct?.variant.id).toBe(variants[0].id)
      expect(variantWithProduct?.product.name).toBe('Detail Product')
    })
  })

  describe('cross-product queries', () => {
    it('should find variants by option across products', async () => {
      const product1 = await store.createProduct({
        name: 'T-Shirt',
        basePrice: 2999,
      })
      const product2 = await store.createProduct({
        name: 'Hoodie',
        basePrice: 5999,
      })

      await store.setProductOptions(product1.id, [
        { name: 'Size', values: ['S', 'M', 'L'] },
      ])
      await store.setProductOptions(product2.id, [
        { name: 'Size', values: ['M', 'L', 'XL'] },
      ])

      await store.createVariantsFromOptions(product1.id)
      await store.createVariantsFromOptions(product2.id)

      const mediumVariants = await store.findVariantsByOption('Size', 'M')

      expect(mediumVariants).toHaveLength(2) // One from each product
    })

    it('should get all variants in a price range', async () => {
      const product = await store.createProduct({
        name: 'Price Range Product',
        basePrice: 5000,
      })
      await store.setProductOptions(product.id, [
        { name: 'Tier', values: ['Basic', 'Premium', 'Elite'] },
      ])
      await store.createVariantsFromOptions(product.id, {
        priceAdjustments: {
          Tier: {
            Basic: -2000,
            Premium: 0,
            Elite: 3000,
          },
        },
      })

      const midPriceVariants = await store.findVariantsInPriceRange(4000, 6000)

      // Basic (3000) excluded, Premium (5000) included, Elite (8000) excluded
      expect(midPriceVariants).toHaveLength(1)
      expect(
        midPriceVariants.every((v) => {
          const price = v.getEffectivePrice()
          return price >= 4000 && price <= 6000
        })
      ).toBe(true)
      expect(midPriceVariants[0].options.Tier).toBe('Premium')
    })
  })
})
