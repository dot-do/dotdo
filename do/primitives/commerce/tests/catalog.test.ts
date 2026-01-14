/**
 * Product Catalog Tests - TDD RED Phase
 *
 * Tests for the product catalog primitive providing:
 * - Product management with variants and options
 * - Category hierarchy
 * - Product search and filtering
 * - Product attributes and metadata
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createCatalog,
  type Catalog,
  type Product,
  type ProductVariant,
  type ProductOption,
  type Category,
  type ProductQuery,
} from '../catalog'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestCatalog(): Catalog {
  return createCatalog()
}

// =============================================================================
// Product Management Tests
// =============================================================================

describe('Catalog', () => {
  describe('product management', () => {
    let catalog: Catalog

    beforeEach(() => {
      catalog = createTestCatalog()
    })

    it('should create a simple product', async () => {
      const product = await catalog.createProduct({
        name: 'Basic T-Shirt',
        description: 'A comfortable cotton t-shirt',
        basePrice: 2999, // $29.99 in cents
        sku: 'TSHIRT-001',
      })

      expect(product.id).toBeDefined()
      expect(product.name).toBe('Basic T-Shirt')
      expect(product.description).toBe('A comfortable cotton t-shirt')
      expect(product.basePrice).toBe(2999)
      expect(product.sku).toBe('TSHIRT-001')
      expect(product.status).toBe('draft')
      expect(product.createdAt).toBeInstanceOf(Date)
    })

    it('should get a product by id', async () => {
      const created = await catalog.createProduct({
        name: 'Test Product',
        basePrice: 1000,
      })

      const retrieved = await catalog.getProduct(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
      expect(retrieved?.name).toBe('Test Product')
    })

    it('should return null for non-existent product', async () => {
      const result = await catalog.getProduct('nonexistent-id')
      expect(result).toBeNull()
    })

    it('should update a product', async () => {
      const product = await catalog.createProduct({
        name: 'Original Name',
        basePrice: 1000,
      })

      const updated = await catalog.updateProduct(product.id, {
        name: 'Updated Name',
        basePrice: 1500,
        description: 'New description',
      })

      expect(updated.name).toBe('Updated Name')
      expect(updated.basePrice).toBe(1500)
      expect(updated.description).toBe('New description')
      expect(updated.updatedAt).toBeInstanceOf(Date)
    })

    it('should throw when updating non-existent product', async () => {
      await expect(
        catalog.updateProduct('nonexistent', { name: 'Test' })
      ).rejects.toThrow('Product not found')
    })

    it('should delete a product', async () => {
      const product = await catalog.createProduct({
        name: 'To Delete',
        basePrice: 1000,
      })

      await catalog.deleteProduct(product.id)

      const result = await catalog.getProduct(product.id)
      expect(result).toBeNull()
    })

    it('should list all products', async () => {
      await catalog.createProduct({ name: 'Product 1', basePrice: 1000 })
      await catalog.createProduct({ name: 'Product 2', basePrice: 2000 })
      await catalog.createProduct({ name: 'Product 3', basePrice: 3000 })

      const products = await catalog.listProducts()

      expect(products.length).toBe(3)
    })

    it('should publish a product', async () => {
      const product = await catalog.createProduct({
        name: 'Draft Product',
        basePrice: 1000,
      })

      expect(product.status).toBe('draft')

      const published = await catalog.publishProduct(product.id)

      expect(published.status).toBe('active')
      expect(published.publishedAt).toBeInstanceOf(Date)
    })

    it('should archive a product', async () => {
      const product = await catalog.createProduct({
        name: 'Active Product',
        basePrice: 1000,
      })
      await catalog.publishProduct(product.id)

      const archived = await catalog.archiveProduct(product.id)

      expect(archived.status).toBe('archived')
    })
  })

  // =============================================================================
  // Product Variants Tests
  // =============================================================================

  describe('product variants', () => {
    let catalog: Catalog
    let productId: string

    beforeEach(async () => {
      catalog = createTestCatalog()
      const product = await catalog.createProduct({
        name: 'T-Shirt with Variants',
        basePrice: 2999,
      })
      productId = product.id
    })

    it('should add a variant to a product', async () => {
      const variant = await catalog.addVariant(productId, {
        sku: 'TSHIRT-RED-M',
        options: { color: 'Red', size: 'M' },
        price: 2999,
      })

      expect(variant.id).toBeDefined()
      expect(variant.productId).toBe(productId)
      expect(variant.sku).toBe('TSHIRT-RED-M')
      expect(variant.options).toEqual({ color: 'Red', size: 'M' })
      expect(variant.price).toBe(2999)
    })

    it('should add multiple variants to a product', async () => {
      await catalog.addVariant(productId, {
        sku: 'TSHIRT-RED-S',
        options: { color: 'Red', size: 'S' },
      })
      await catalog.addVariant(productId, {
        sku: 'TSHIRT-RED-M',
        options: { color: 'Red', size: 'M' },
      })
      await catalog.addVariant(productId, {
        sku: 'TSHIRT-BLUE-M',
        options: { color: 'Blue', size: 'M' },
      })

      const product = await catalog.getProduct(productId)
      expect(product?.variants).toHaveLength(3)
    })

    it('should get variants by product', async () => {
      await catalog.addVariant(productId, {
        sku: 'VAR-1',
        options: { size: 'S' },
      })
      await catalog.addVariant(productId, {
        sku: 'VAR-2',
        options: { size: 'M' },
      })

      const variants = await catalog.getVariants(productId)

      expect(variants).toHaveLength(2)
    })

    it('should update a variant', async () => {
      const variant = await catalog.addVariant(productId, {
        sku: 'VAR-ORIGINAL',
        options: { size: 'S' },
        price: 1000,
      })

      const updated = await catalog.updateVariant(variant.id, {
        sku: 'VAR-UPDATED',
        price: 1500,
      })

      expect(updated.sku).toBe('VAR-UPDATED')
      expect(updated.price).toBe(1500)
      expect(updated.options).toEqual({ size: 'S' }) // unchanged
    })

    it('should delete a variant', async () => {
      const variant = await catalog.addVariant(productId, {
        sku: 'TO-DELETE',
        options: { size: 'S' },
      })

      await catalog.deleteVariant(variant.id)

      const variants = await catalog.getVariants(productId)
      expect(variants).toHaveLength(0)
    })

    it('should support variant-specific pricing', async () => {
      const product = await catalog.getProduct(productId)
      expect(product?.basePrice).toBe(2999)

      const premiumVariant = await catalog.addVariant(productId, {
        sku: 'PREMIUM-VAR',
        options: { material: 'Premium Cotton' },
        price: 3999, // Higher price for premium
      })

      expect(premiumVariant.price).toBe(3999)
    })

    it('should inherit base price when variant price not specified', async () => {
      const variant = await catalog.addVariant(productId, {
        sku: 'BASIC-VAR',
        options: { size: 'M' },
        // no price specified
      })

      // Should inherit from product base price
      expect(variant.price).toBeUndefined()

      // When getting effective price
      const effectivePrice = await catalog.getVariantPrice(variant.id)
      expect(effectivePrice).toBe(2999)
    })

    it('should enforce unique SKUs across variants', async () => {
      await catalog.addVariant(productId, {
        sku: 'UNIQUE-SKU',
        options: { size: 'S' },
      })

      await expect(
        catalog.addVariant(productId, {
          sku: 'UNIQUE-SKU',
          options: { size: 'M' },
        })
      ).rejects.toThrow('SKU already exists')
    })

    it('should find variant by SKU', async () => {
      await catalog.addVariant(productId, {
        sku: 'FIND-ME-SKU',
        options: { size: 'L' },
      })

      const variant = await catalog.findVariantBySku('FIND-ME-SKU')

      expect(variant).not.toBeNull()
      expect(variant?.sku).toBe('FIND-ME-SKU')
    })
  })

  // =============================================================================
  // Product Options Tests
  // =============================================================================

  describe('product options', () => {
    let catalog: Catalog
    let productId: string

    beforeEach(async () => {
      catalog = createTestCatalog()
      const product = await catalog.createProduct({
        name: 'Configurable Product',
        basePrice: 5000,
      })
      productId = product.id
    })

    it('should define product options', async () => {
      await catalog.setProductOptions(productId, [
        {
          name: 'Size',
          values: ['S', 'M', 'L', 'XL'],
        },
        {
          name: 'Color',
          values: ['Red', 'Blue', 'Green'],
        },
      ])

      const product = await catalog.getProduct(productId)

      expect(product?.options).toHaveLength(2)
      expect(product?.options?.[0].name).toBe('Size')
      expect(product?.options?.[0].values).toEqual(['S', 'M', 'L', 'XL'])
    })

    it('should update product options', async () => {
      await catalog.setProductOptions(productId, [
        { name: 'Size', values: ['S', 'M'] },
      ])

      await catalog.setProductOptions(productId, [
        { name: 'Size', values: ['S', 'M', 'L'] },
        { name: 'Material', values: ['Cotton', 'Polyester'] },
      ])

      const product = await catalog.getProduct(productId)

      expect(product?.options).toHaveLength(2)
      expect(product?.options?.[0].values).toContain('L')
    })

    it('should generate variant matrix from options', async () => {
      await catalog.setProductOptions(productId, [
        { name: 'Size', values: ['S', 'M'] },
        { name: 'Color', values: ['Red', 'Blue'] },
      ])

      const matrix = await catalog.generateVariantMatrix(productId)

      expect(matrix).toHaveLength(4) // 2 sizes x 2 colors
      expect(matrix).toContainEqual({ Size: 'S', Color: 'Red' })
      expect(matrix).toContainEqual({ Size: 'S', Color: 'Blue' })
      expect(matrix).toContainEqual({ Size: 'M', Color: 'Red' })
      expect(matrix).toContainEqual({ Size: 'M', Color: 'Blue' })
    })

    it('should bulk create variants from matrix', async () => {
      await catalog.setProductOptions(productId, [
        { name: 'Size', values: ['S', 'M'] },
        { name: 'Color', values: ['Red', 'Blue'] },
      ])

      const variants = await catalog.createVariantsFromOptions(productId, {
        skuPattern: 'PROD-{Size}-{Color}',
      })

      expect(variants).toHaveLength(4)
      expect(variants.map((v) => v.sku)).toContain('PROD-S-Red')
      expect(variants.map((v) => v.sku)).toContain('PROD-M-Blue')
    })
  })

  // =============================================================================
  // Category Management Tests
  // =============================================================================

  describe('category management', () => {
    let catalog: Catalog

    beforeEach(() => {
      catalog = createTestCatalog()
    })

    it('should create a root category', async () => {
      const category = await catalog.createCategory({
        name: 'Clothing',
        slug: 'clothing',
      })

      expect(category.id).toBeDefined()
      expect(category.name).toBe('Clothing')
      expect(category.slug).toBe('clothing')
      expect(category.parentId).toBeUndefined()
    })

    it('should create a child category', async () => {
      const parent = await catalog.createCategory({
        name: 'Clothing',
        slug: 'clothing',
      })

      const child = await catalog.createCategory({
        name: 'T-Shirts',
        slug: 't-shirts',
        parentId: parent.id,
      })

      expect(child.parentId).toBe(parent.id)
    })

    it('should get category hierarchy', async () => {
      const root = await catalog.createCategory({ name: 'Root', slug: 'root' })
      const child1 = await catalog.createCategory({
        name: 'Child 1',
        slug: 'child-1',
        parentId: root.id,
      })
      const child2 = await catalog.createCategory({
        name: 'Child 2',
        slug: 'child-2',
        parentId: root.id,
      })
      const grandchild = await catalog.createCategory({
        name: 'Grandchild',
        slug: 'grandchild',
        parentId: child1.id,
      })

      const hierarchy = await catalog.getCategoryTree()

      expect(hierarchy).toHaveLength(1) // 1 root
      expect(hierarchy[0].children).toHaveLength(2) // 2 children
      expect(hierarchy[0].children?.[0].children).toHaveLength(1) // 1 grandchild
    })

    it('should get category by slug', async () => {
      await catalog.createCategory({
        name: 'Electronics',
        slug: 'electronics',
      })

      const category = await catalog.getCategoryBySlug('electronics')

      expect(category).not.toBeNull()
      expect(category?.name).toBe('Electronics')
    })

    it('should get category ancestors (breadcrumb)', async () => {
      const root = await catalog.createCategory({ name: 'Root', slug: 'root' })
      const child = await catalog.createCategory({
        name: 'Child',
        slug: 'child',
        parentId: root.id,
      })
      const grandchild = await catalog.createCategory({
        name: 'Grandchild',
        slug: 'grandchild',
        parentId: child.id,
      })

      const ancestors = await catalog.getCategoryAncestors(grandchild.id)

      expect(ancestors).toHaveLength(2)
      expect(ancestors[0].name).toBe('Root')
      expect(ancestors[1].name).toBe('Child')
    })

    it('should update a category', async () => {
      const category = await catalog.createCategory({
        name: 'Original',
        slug: 'original',
      })

      const updated = await catalog.updateCategory(category.id, {
        name: 'Updated Name',
        description: 'New description',
      })

      expect(updated.name).toBe('Updated Name')
      expect(updated.description).toBe('New description')
    })

    it('should delete a category', async () => {
      const category = await catalog.createCategory({
        name: 'To Delete',
        slug: 'to-delete',
      })

      await catalog.deleteCategory(category.id)

      const result = await catalog.getCategoryBySlug('to-delete')
      expect(result).toBeNull()
    })

    it('should assign product to category', async () => {
      const category = await catalog.createCategory({
        name: 'Shirts',
        slug: 'shirts',
      })
      const product = await catalog.createProduct({
        name: 'Blue Shirt',
        basePrice: 2500,
      })

      await catalog.assignProductToCategory(product.id, category.id)

      const updatedProduct = await catalog.getProduct(product.id)
      expect(updatedProduct?.categoryIds).toContain(category.id)
    })

    it('should get products by category', async () => {
      const category = await catalog.createCategory({
        name: 'Test Category',
        slug: 'test-category',
      })

      const product1 = await catalog.createProduct({
        name: 'Product 1',
        basePrice: 1000,
      })
      const product2 = await catalog.createProduct({
        name: 'Product 2',
        basePrice: 2000,
      })

      await catalog.assignProductToCategory(product1.id, category.id)
      await catalog.assignProductToCategory(product2.id, category.id)

      const products = await catalog.getProductsByCategory(category.id)

      expect(products).toHaveLength(2)
    })

    it('should include products from child categories', async () => {
      const parent = await catalog.createCategory({
        name: 'Parent',
        slug: 'parent',
      })
      const child = await catalog.createCategory({
        name: 'Child',
        slug: 'child',
        parentId: parent.id,
      })

      const parentProduct = await catalog.createProduct({
        name: 'Parent Product',
        basePrice: 1000,
      })
      const childProduct = await catalog.createProduct({
        name: 'Child Product',
        basePrice: 2000,
      })

      await catalog.assignProductToCategory(parentProduct.id, parent.id)
      await catalog.assignProductToCategory(childProduct.id, child.id)

      const products = await catalog.getProductsByCategory(parent.id, {
        includeChildren: true,
      })

      expect(products).toHaveLength(2)
    })
  })

  // =============================================================================
  // Product Search and Query Tests
  // =============================================================================

  describe('product search and query', () => {
    let catalog: Catalog

    beforeEach(async () => {
      catalog = createTestCatalog()

      // Create test products
      const shirt = await catalog.createProduct({
        name: 'Blue Cotton T-Shirt',
        description: 'Comfortable cotton t-shirt in blue',
        basePrice: 2999,
        sku: 'SHIRT-BLUE',
        tags: ['clothing', 'summer', 'cotton'],
      })
      await catalog.publishProduct(shirt.id)

      const pants = await catalog.createProduct({
        name: 'Black Denim Jeans',
        description: 'Classic denim jeans in black',
        basePrice: 5999,
        sku: 'PANTS-BLACK',
        tags: ['clothing', 'denim'],
      })
      await catalog.publishProduct(pants.id)

      const hat = await catalog.createProduct({
        name: 'Red Baseball Cap',
        description: 'Stylish baseball cap',
        basePrice: 1999,
        sku: 'HAT-RED',
        tags: ['accessories', 'summer'],
      })
      await catalog.publishProduct(hat.id)

      // Keep one as draft
      await catalog.createProduct({
        name: 'Draft Product',
        basePrice: 1000,
      })
    })

    it('should search products by name', async () => {
      const results = await catalog.searchProducts({ name: 'shirt' })

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Blue Cotton T-Shirt')
    })

    it('should search products by description', async () => {
      const results = await catalog.searchProducts({ description: 'cotton' })

      expect(results).toHaveLength(1)
    })

    it('should search products by full text', async () => {
      const results = await catalog.searchProducts({ q: 'blue' })

      expect(results).toHaveLength(1)
      expect(results[0].name).toContain('Blue')
    })

    it('should filter by price range', async () => {
      const results = await catalog.searchProducts({
        priceMin: 2000,
        priceMax: 4000,
      })

      expect(results).toHaveLength(1)
      expect(results[0].basePrice).toBe(2999)
    })

    it('should filter by tags', async () => {
      const results = await catalog.searchProducts({ tags: ['summer'] })

      expect(results).toHaveLength(2)
    })

    it('should filter by status', async () => {
      const activeResults = await catalog.searchProducts({ status: 'active' })
      expect(activeResults).toHaveLength(3)

      const draftResults = await catalog.searchProducts({ status: 'draft' })
      expect(draftResults).toHaveLength(1)
    })

    it('should combine multiple filters', async () => {
      const results = await catalog.searchProducts({
        tags: ['clothing'],
        priceMax: 4000,
      })

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Blue Cotton T-Shirt')
    })

    it('should paginate results', async () => {
      const page1 = await catalog.searchProducts({}, { limit: 2, offset: 0 })
      const page2 = await catalog.searchProducts({}, { limit: 2, offset: 2 })

      expect(page1).toHaveLength(2)
      expect(page2.length).toBeGreaterThanOrEqual(1)
    })

    it('should sort results', async () => {
      const ascending = await catalog.searchProducts(
        { status: 'active' },
        { sortBy: 'basePrice', sortOrder: 'asc' }
      )
      const descending = await catalog.searchProducts(
        { status: 'active' },
        { sortBy: 'basePrice', sortOrder: 'desc' }
      )

      expect(ascending[0].basePrice).toBeLessThan(ascending[ascending.length - 1].basePrice)
      expect(descending[0].basePrice).toBeGreaterThan(descending[descending.length - 1].basePrice)
    })
  })

  // =============================================================================
  // Product Attributes and Metadata Tests
  // =============================================================================

  describe('product attributes and metadata', () => {
    let catalog: Catalog
    let productId: string

    beforeEach(async () => {
      catalog = createTestCatalog()
      const product = await catalog.createProduct({
        name: 'Product with Attributes',
        basePrice: 5000,
      })
      productId = product.id
    })

    it('should set product attributes', async () => {
      await catalog.setProductAttributes(productId, {
        weight: '500g',
        dimensions: '10x20x5cm',
        material: 'Cotton',
      })

      const product = await catalog.getProduct(productId)

      expect(product?.attributes?.weight).toBe('500g')
      expect(product?.attributes?.material).toBe('Cotton')
    })

    it('should update individual attributes', async () => {
      await catalog.setProductAttributes(productId, {
        color: 'red',
        size: 'large',
      })

      await catalog.setAttribute(productId, 'color', 'blue')

      const product = await catalog.getProduct(productId)
      expect(product?.attributes?.color).toBe('blue')
      expect(product?.attributes?.size).toBe('large')
    })

    it('should remove an attribute', async () => {
      await catalog.setProductAttributes(productId, {
        temp: 'value',
        keep: 'this',
      })

      await catalog.removeAttribute(productId, 'temp')

      const product = await catalog.getProduct(productId)
      expect(product?.attributes?.temp).toBeUndefined()
      expect(product?.attributes?.keep).toBe('this')
    })

    it('should set product metadata', async () => {
      await catalog.setProductMetadata(productId, {
        seoTitle: 'Best Product Ever',
        seoDescription: 'Amazing product for everyone',
        customField: 'custom value',
      })

      const product = await catalog.getProduct(productId)

      expect(product?.metadata?.seoTitle).toBe('Best Product Ever')
    })

    it('should manage product images', async () => {
      await catalog.addProductImage(productId, {
        url: 'https://example.com/image1.jpg',
        alt: 'Product front view',
        position: 0,
      })
      await catalog.addProductImage(productId, {
        url: 'https://example.com/image2.jpg',
        alt: 'Product side view',
        position: 1,
      })

      const product = await catalog.getProduct(productId)

      expect(product?.images).toHaveLength(2)
      expect(product?.images?.[0].url).toBe('https://example.com/image1.jpg')
    })

    it('should set primary image', async () => {
      const img1 = await catalog.addProductImage(productId, {
        url: 'https://example.com/image1.jpg',
        alt: 'Image 1',
      })
      const img2 = await catalog.addProductImage(productId, {
        url: 'https://example.com/image2.jpg',
        alt: 'Image 2',
      })

      await catalog.setPrimaryImage(productId, img2.id)

      const product = await catalog.getProduct(productId)
      const primaryImage = product?.images?.find((i) => i.isPrimary)
      expect(primaryImage?.url).toBe('https://example.com/image2.jpg')
    })

    it('should remove product image', async () => {
      const image = await catalog.addProductImage(productId, {
        url: 'https://example.com/to-remove.jpg',
        alt: 'To remove',
      })

      await catalog.removeProductImage(productId, image.id)

      const product = await catalog.getProduct(productId)
      expect(product?.images).toHaveLength(0)
    })

    it('should set product tags', async () => {
      await catalog.setProductTags(productId, ['new', 'featured', 'sale'])

      const product = await catalog.getProduct(productId)
      expect(product?.tags).toContain('featured')
    })

    it('should add and remove individual tags', async () => {
      await catalog.setProductTags(productId, ['tag1', 'tag2'])

      await catalog.addProductTag(productId, 'tag3')
      let product = await catalog.getProduct(productId)
      expect(product?.tags).toHaveLength(3)

      await catalog.removeProductTag(productId, 'tag2')
      product = await catalog.getProduct(productId)
      expect(product?.tags).not.toContain('tag2')
    })
  })
})
