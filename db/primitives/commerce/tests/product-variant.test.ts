/**
 * Product & Variant Model Tests - TDD RED Phase
 *
 * Tests for Product and Variant domain models providing:
 * - Product creation with validation
 * - Variant options (size, color, etc.)
 * - Pricing per variant with inheritance
 * - SKU generation patterns
 * - Product-variant relationships
 * - Variant option validation against product options
 *
 * @module db/primitives/commerce/tests/product-variant
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createProduct,
  createVariant,
  type ProductModel,
  type VariantModel,
  type ProductOptions,
  type VariantOptions,
  type SKUPattern,
} from '../product-variant'

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
      const variant2 = createVariant(product, {
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
