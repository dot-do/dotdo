/**
 * Product Catalog - Core product management primitive
 *
 * Provides product catalog functionality:
 * - Product CRUD operations
 * - Variants with options
 * - Category hierarchy
 * - Search and filtering
 * - Product attributes and metadata
 *
 * @module db/primitives/commerce/catalog
 */

// =============================================================================
// Types
// =============================================================================

export type ProductStatus = 'draft' | 'active' | 'archived'

export interface ProductImage {
  id: string
  url: string
  alt?: string
  position: number
  isPrimary?: boolean
}

export interface ProductOption {
  name: string
  values: string[]
}

export interface ProductVariant {
  id: string
  productId: string
  sku?: string
  options: Record<string, string>
  price?: number
  compareAtPrice?: number
  imageId?: string
  weight?: number
  createdAt: Date
  updatedAt: Date
}

export interface Product {
  id: string
  name: string
  description?: string
  sku?: string
  basePrice: number
  compareAtPrice?: number
  status: ProductStatus
  categoryIds?: string[]
  tags?: string[]
  options?: ProductOption[]
  variants?: ProductVariant[]
  attributes?: Record<string, string>
  metadata?: Record<string, unknown>
  images?: ProductImage[]
  createdAt: Date
  updatedAt: Date
  publishedAt?: Date
}

export interface Category {
  id: string
  name: string
  slug: string
  description?: string
  parentId?: string
  children?: CategoryWithChildren[]
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface CategoryWithChildren extends Category {
  children?: CategoryWithChildren[]
}

export interface CreateProductInput {
  name: string
  description?: string
  sku?: string
  basePrice: number
  compareAtPrice?: number
  categoryIds?: string[]
  tags?: string[]
}

export interface UpdateProductInput {
  name?: string
  description?: string
  sku?: string
  basePrice?: number
  compareAtPrice?: number
  categoryIds?: string[]
  tags?: string[]
}

export interface CreateVariantInput {
  sku?: string
  options: Record<string, string>
  price?: number
  compareAtPrice?: number
  imageId?: string
  weight?: number
}

export interface UpdateVariantInput {
  sku?: string
  price?: number
  compareAtPrice?: number
  imageId?: string
  weight?: number
}

export interface CreateCategoryInput {
  name: string
  slug: string
  description?: string
  parentId?: string
  metadata?: Record<string, unknown>
}

export interface UpdateCategoryInput {
  name?: string
  slug?: string
  description?: string
  parentId?: string
  metadata?: Record<string, unknown>
}

export interface ProductQuery {
  name?: string
  description?: string
  q?: string // Full text search
  priceMin?: number
  priceMax?: number
  tags?: string[]
  categoryIds?: string[]
  status?: ProductStatus
}

export interface QueryOptions {
  limit?: number
  offset?: number
  sortBy?: 'name' | 'basePrice' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
}

export interface ProductImageInput {
  url: string
  alt?: string
  position?: number
}

export interface VariantMatrixOptions {
  skuPattern?: string
  priceAdjustments?: Record<string, Record<string, number>>
}

export interface GetProductsByCategoryOptions {
  includeChildren?: boolean
}

// =============================================================================
// Catalog Interface
// =============================================================================

export interface Catalog {
  // Product CRUD
  createProduct(input: CreateProductInput): Promise<Product>
  getProduct(id: string): Promise<Product | null>
  updateProduct(id: string, input: UpdateProductInput): Promise<Product>
  deleteProduct(id: string): Promise<void>
  listProducts(options?: QueryOptions): Promise<Product[]>
  publishProduct(id: string): Promise<Product>
  archiveProduct(id: string): Promise<Product>

  // Variants
  addVariant(productId: string, input: CreateVariantInput): Promise<ProductVariant>
  getVariants(productId: string): Promise<ProductVariant[]>
  updateVariant(variantId: string, input: UpdateVariantInput): Promise<ProductVariant>
  deleteVariant(variantId: string): Promise<void>
  getVariantPrice(variantId: string): Promise<number>
  findVariantBySku(sku: string): Promise<ProductVariant | null>

  // Product Options
  setProductOptions(productId: string, options: ProductOption[]): Promise<void>
  generateVariantMatrix(productId: string): Promise<Record<string, string>[]>
  createVariantsFromOptions(
    productId: string,
    options?: VariantMatrixOptions
  ): Promise<ProductVariant[]>

  // Categories
  createCategory(input: CreateCategoryInput): Promise<Category>
  getCategory(id: string): Promise<Category | null>
  getCategoryBySlug(slug: string): Promise<Category | null>
  updateCategory(id: string, input: UpdateCategoryInput): Promise<Category>
  deleteCategory(id: string): Promise<void>
  getCategoryTree(): Promise<CategoryWithChildren[]>
  getCategoryAncestors(categoryId: string): Promise<Category[]>
  assignProductToCategory(productId: string, categoryId: string): Promise<void>
  getProductsByCategory(
    categoryId: string,
    options?: GetProductsByCategoryOptions
  ): Promise<Product[]>

  // Search
  searchProducts(query: ProductQuery, options?: QueryOptions): Promise<Product[]>

  // Attributes
  setProductAttributes(
    productId: string,
    attributes: Record<string, string>
  ): Promise<void>
  setAttribute(productId: string, key: string, value: string): Promise<void>
  removeAttribute(productId: string, key: string): Promise<void>

  // Metadata
  setProductMetadata(
    productId: string,
    metadata: Record<string, unknown>
  ): Promise<void>

  // Images
  addProductImage(productId: string, input: ProductImageInput): Promise<ProductImage>
  removeProductImage(productId: string, imageId: string): Promise<void>
  setPrimaryImage(productId: string, imageId: string): Promise<void>

  // Tags
  setProductTags(productId: string, tags: string[]): Promise<void>
  addProductTag(productId: string, tag: string): Promise<void>
  removeProductTag(productId: string, tag: string): Promise<void>
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
// Implementation
// =============================================================================

class InMemoryCatalog implements Catalog {
  private products: Map<string, Product> = new Map()
  private variants: Map<string, ProductVariant> = new Map()
  private categories: Map<string, Category> = new Map()
  private skuIndex: Map<string, string> = new Map() // sku -> variantId

  async createProduct(input: CreateProductInput): Promise<Product> {
    const product: Product = {
      id: generateId('prod'),
      name: input.name,
      description: input.description,
      sku: input.sku,
      basePrice: input.basePrice,
      compareAtPrice: input.compareAtPrice,
      status: 'draft',
      categoryIds: input.categoryIds || [],
      tags: input.tags || [],
      options: [],
      variants: [],
      attributes: {},
      metadata: {},
      images: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    this.products.set(product.id, product)
    return product
  }

  async getProduct(id: string): Promise<Product | null> {
    const product = this.products.get(id)
    if (!product) return null

    // Attach variants
    const variants = Array.from(this.variants.values()).filter(
      (v) => v.productId === id
    )
    return { ...product, variants }
  }

  async updateProduct(id: string, input: UpdateProductInput): Promise<Product> {
    const product = this.products.get(id)
    if (!product) {
      throw new Error('Product not found')
    }

    const updated: Product = {
      ...product,
      ...input,
      updatedAt: new Date(),
    }

    this.products.set(id, updated)
    return this.getProduct(id) as Promise<Product>
  }

  async deleteProduct(id: string): Promise<void> {
    // Delete variants
    for (const [variantId, variant] of this.variants) {
      if (variant.productId === id) {
        if (variant.sku) {
          this.skuIndex.delete(variant.sku)
        }
        this.variants.delete(variantId)
      }
    }
    this.products.delete(id)
  }

  async listProducts(options?: QueryOptions): Promise<Product[]> {
    let products = Array.from(this.products.values())

    // Sort
    if (options?.sortBy) {
      products.sort((a, b) => {
        const aVal = a[options.sortBy!]
        const bVal = b[options.sortBy!]
        if (aVal instanceof Date && bVal instanceof Date) {
          return options.sortOrder === 'desc'
            ? bVal.getTime() - aVal.getTime()
            : aVal.getTime() - bVal.getTime()
        }
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return options.sortOrder === 'desc' ? bVal - aVal : aVal - bVal
        }
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return options.sortOrder === 'desc'
            ? bVal.localeCompare(aVal)
            : aVal.localeCompare(bVal)
        }
        return 0
      })
    }

    // Paginate
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? products.length
    return products.slice(offset, offset + limit)
  }

  async publishProduct(id: string): Promise<Product> {
    const product = this.products.get(id)
    if (!product) {
      throw new Error('Product not found')
    }

    const updated: Product = {
      ...product,
      status: 'active',
      publishedAt: new Date(),
      updatedAt: new Date(),
    }

    this.products.set(id, updated)
    return this.getProduct(id) as Promise<Product>
  }

  async archiveProduct(id: string): Promise<Product> {
    const product = this.products.get(id)
    if (!product) {
      throw new Error('Product not found')
    }

    const updated: Product = {
      ...product,
      status: 'archived',
      updatedAt: new Date(),
    }

    this.products.set(id, updated)
    return this.getProduct(id) as Promise<Product>
  }

  // Variants

  async addVariant(
    productId: string,
    input: CreateVariantInput
  ): Promise<ProductVariant> {
    const product = this.products.get(productId)
    if (!product) {
      throw new Error('Product not found')
    }

    // Check SKU uniqueness
    if (input.sku && this.skuIndex.has(input.sku)) {
      throw new Error('SKU already exists')
    }

    const variant: ProductVariant = {
      id: generateId('var'),
      productId,
      sku: input.sku,
      options: input.options,
      price: input.price,
      compareAtPrice: input.compareAtPrice,
      imageId: input.imageId,
      weight: input.weight,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    this.variants.set(variant.id, variant)
    if (input.sku) {
      this.skuIndex.set(input.sku, variant.id)
    }

    return variant
  }

  async getVariants(productId: string): Promise<ProductVariant[]> {
    return Array.from(this.variants.values()).filter(
      (v) => v.productId === productId
    )
  }

  async updateVariant(
    variantId: string,
    input: UpdateVariantInput
  ): Promise<ProductVariant> {
    const variant = this.variants.get(variantId)
    if (!variant) {
      throw new Error('Variant not found')
    }

    // Handle SKU change
    if (input.sku && input.sku !== variant.sku) {
      if (this.skuIndex.has(input.sku)) {
        throw new Error('SKU already exists')
      }
      if (variant.sku) {
        this.skuIndex.delete(variant.sku)
      }
      this.skuIndex.set(input.sku, variantId)
    }

    const updated: ProductVariant = {
      ...variant,
      ...input,
      updatedAt: new Date(),
    }

    this.variants.set(variantId, updated)
    return updated
  }

  async deleteVariant(variantId: string): Promise<void> {
    const variant = this.variants.get(variantId)
    if (variant?.sku) {
      this.skuIndex.delete(variant.sku)
    }
    this.variants.delete(variantId)
  }

  async getVariantPrice(variantId: string): Promise<number> {
    const variant = this.variants.get(variantId)
    if (!variant) {
      throw new Error('Variant not found')
    }

    if (variant.price !== undefined) {
      return variant.price
    }

    const product = this.products.get(variant.productId)
    return product?.basePrice ?? 0
  }

  async findVariantBySku(sku: string): Promise<ProductVariant | null> {
    const variantId = this.skuIndex.get(sku)
    if (!variantId) return null
    return this.variants.get(variantId) ?? null
  }

  // Product Options

  async setProductOptions(
    productId: string,
    options: ProductOption[]
  ): Promise<void> {
    const product = this.products.get(productId)
    if (!product) {
      throw new Error('Product not found')
    }

    const updated: Product = {
      ...product,
      options,
      updatedAt: new Date(),
    }

    this.products.set(productId, updated)
  }

  async generateVariantMatrix(
    productId: string
  ): Promise<Record<string, string>[]> {
    const product = this.products.get(productId)
    if (!product) {
      throw new Error('Product not found')
    }

    const options = product.options ?? []
    if (options.length === 0) return []

    const optionNames = options.map((o) => o.name)
    const optionValues = options.map((o) => o.values)
    const combinations = cartesianProduct(optionValues)

    return combinations.map((combo) => {
      const result: Record<string, string> = {}
      optionNames.forEach((name, i) => {
        result[name] = combo[i] ?? ''
      })
      return result
    })
  }

  async createVariantsFromOptions(
    productId: string,
    options?: VariantMatrixOptions
  ): Promise<ProductVariant[]> {
    const matrix = await this.generateVariantMatrix(productId)
    const variants: ProductVariant[] = []

    for (const combo of matrix) {
      let sku: string | undefined
      if (options?.skuPattern) {
        sku = options.skuPattern
        for (const [key, value] of Object.entries(combo)) {
          sku = sku.replace(`{${key}}`, value)
        }
      }

      const variant = await this.addVariant(productId, {
        sku,
        options: combo,
      })
      variants.push(variant)
    }

    return variants
  }

  // Categories

  async createCategory(input: CreateCategoryInput): Promise<Category> {
    const category: Category = {
      id: generateId('cat'),
      name: input.name,
      slug: input.slug,
      description: input.description,
      parentId: input.parentId,
      metadata: input.metadata,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    this.categories.set(category.id, category)
    return category
  }

  async getCategory(id: string): Promise<Category | null> {
    return this.categories.get(id) ?? null
  }

  async getCategoryBySlug(slug: string): Promise<Category | null> {
    for (const category of this.categories.values()) {
      if (category.slug === slug) {
        return category
      }
    }
    return null
  }

  async updateCategory(
    id: string,
    input: UpdateCategoryInput
  ): Promise<Category> {
    const category = this.categories.get(id)
    if (!category) {
      throw new Error('Category not found')
    }

    const updated: Category = {
      ...category,
      ...input,
      updatedAt: new Date(),
    }

    this.categories.set(id, updated)
    return updated
  }

  async deleteCategory(id: string): Promise<void> {
    this.categories.delete(id)
  }

  async getCategoryTree(): Promise<CategoryWithChildren[]> {
    const allCategories = Array.from(this.categories.values())
    const categoryMap = new Map<string, CategoryWithChildren>()

    // Create nodes with children arrays
    for (const cat of allCategories) {
      categoryMap.set(cat.id, { ...cat, children: [] })
    }

    const roots: CategoryWithChildren[] = []

    // Build tree
    for (const cat of categoryMap.values()) {
      if (cat.parentId) {
        const parent = categoryMap.get(cat.parentId)
        if (parent) {
          parent.children = parent.children ?? []
          parent.children.push(cat)
        }
      } else {
        roots.push(cat)
      }
    }

    return roots
  }

  async getCategoryAncestors(categoryId: string): Promise<Category[]> {
    const ancestors: Category[] = []
    let current = this.categories.get(categoryId)

    while (current?.parentId) {
      const parent = this.categories.get(current.parentId)
      if (parent) {
        ancestors.unshift(parent)
        current = parent
      } else {
        break
      }
    }

    return ancestors
  }

  async assignProductToCategory(
    productId: string,
    categoryId: string
  ): Promise<void> {
    const product = this.products.get(productId)
    if (!product) {
      throw new Error('Product not found')
    }

    const categoryIds = product.categoryIds ?? []
    if (!categoryIds.includes(categoryId)) {
      categoryIds.push(categoryId)
    }

    this.products.set(productId, {
      ...product,
      categoryIds,
      updatedAt: new Date(),
    })
  }

  async getProductsByCategory(
    categoryId: string,
    options?: GetProductsByCategoryOptions
  ): Promise<Product[]> {
    const categoryIds = new Set([categoryId])

    // Include child categories if requested
    if (options?.includeChildren) {
      const addChildren = (parentId: string) => {
        for (const cat of this.categories.values()) {
          if (cat.parentId === parentId) {
            categoryIds.add(cat.id)
            addChildren(cat.id)
          }
        }
      }
      addChildren(categoryId)
    }

    const products: Product[] = []
    for (const product of this.products.values()) {
      const productCats = product.categoryIds ?? []
      if (productCats.some((cid) => categoryIds.has(cid))) {
        products.push(product)
      }
    }

    return products
  }

  // Search

  async searchProducts(
    query: ProductQuery,
    options?: QueryOptions
  ): Promise<Product[]> {
    let results = Array.from(this.products.values())

    // Filter by name
    if (query.name) {
      const search = query.name.toLowerCase()
      results = results.filter((p) => p.name.toLowerCase().includes(search))
    }

    // Filter by description
    if (query.description) {
      const search = query.description.toLowerCase()
      results = results.filter((p) =>
        p.description?.toLowerCase().includes(search)
      )
    }

    // Full text search
    if (query.q) {
      const search = query.q.toLowerCase()
      results = results.filter(
        (p) =>
          p.name.toLowerCase().includes(search) ||
          p.description?.toLowerCase().includes(search)
      )
    }

    // Filter by price range
    if (query.priceMin !== undefined) {
      results = results.filter((p) => p.basePrice >= query.priceMin!)
    }
    if (query.priceMax !== undefined) {
      results = results.filter((p) => p.basePrice <= query.priceMax!)
    }

    // Filter by tags
    if (query.tags && query.tags.length > 0) {
      results = results.filter((p) =>
        query.tags!.some((tag) => p.tags?.includes(tag))
      )
    }

    // Filter by status
    if (query.status) {
      results = results.filter((p) => p.status === query.status)
    }

    // Filter by categories
    if (query.categoryIds && query.categoryIds.length > 0) {
      results = results.filter((p) =>
        query.categoryIds!.some((cid) => p.categoryIds?.includes(cid))
      )
    }

    // Sort
    if (options?.sortBy) {
      results.sort((a, b) => {
        const aVal = a[options.sortBy!]
        const bVal = b[options.sortBy!]
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return options.sortOrder === 'desc' ? bVal - aVal : aVal - bVal
        }
        if (aVal instanceof Date && bVal instanceof Date) {
          return options.sortOrder === 'desc'
            ? bVal.getTime() - aVal.getTime()
            : aVal.getTime() - bVal.getTime()
        }
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return options.sortOrder === 'desc'
            ? bVal.localeCompare(aVal)
            : aVal.localeCompare(bVal)
        }
        return 0
      })
    }

    // Paginate
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? results.length
    return results.slice(offset, offset + limit)
  }

  // Attributes

  async setProductAttributes(
    productId: string,
    attributes: Record<string, string>
  ): Promise<void> {
    const product = this.products.get(productId)
    if (!product) {
      throw new Error('Product not found')
    }

    this.products.set(productId, {
      ...product,
      attributes,
      updatedAt: new Date(),
    })
  }

  async setAttribute(
    productId: string,
    key: string,
    value: string
  ): Promise<void> {
    const product = this.products.get(productId)
    if (!product) {
      throw new Error('Product not found')
    }

    const attributes = { ...product.attributes, [key]: value }
    this.products.set(productId, {
      ...product,
      attributes,
      updatedAt: new Date(),
    })
  }

  async removeAttribute(productId: string, key: string): Promise<void> {
    const product = this.products.get(productId)
    if (!product) {
      throw new Error('Product not found')
    }

    const attributes = { ...product.attributes }
    delete attributes[key]

    this.products.set(productId, {
      ...product,
      attributes,
      updatedAt: new Date(),
    })
  }

  // Metadata

  async setProductMetadata(
    productId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const product = this.products.get(productId)
    if (!product) {
      throw new Error('Product not found')
    }

    this.products.set(productId, {
      ...product,
      metadata,
      updatedAt: new Date(),
    })
  }

  // Images

  async addProductImage(
    productId: string,
    input: ProductImageInput
  ): Promise<ProductImage> {
    const product = this.products.get(productId)
    if (!product) {
      throw new Error('Product not found')
    }

    const images = product.images ?? []
    const image: ProductImage = {
      id: generateId('img'),
      url: input.url,
      alt: input.alt,
      position: input.position ?? images.length,
      isPrimary: images.length === 0,
    }

    images.push(image)
    images.sort((a, b) => a.position - b.position)

    this.products.set(productId, {
      ...product,
      images,
      updatedAt: new Date(),
    })

    return image
  }

  async removeProductImage(productId: string, imageId: string): Promise<void> {
    const product = this.products.get(productId)
    if (!product) {
      throw new Error('Product not found')
    }

    const images = (product.images ?? []).filter((i) => i.id !== imageId)

    this.products.set(productId, {
      ...product,
      images,
      updatedAt: new Date(),
    })
  }

  async setPrimaryImage(productId: string, imageId: string): Promise<void> {
    const product = this.products.get(productId)
    if (!product) {
      throw new Error('Product not found')
    }

    const images = (product.images ?? []).map((img) => ({
      ...img,
      isPrimary: img.id === imageId,
    }))

    this.products.set(productId, {
      ...product,
      images,
      updatedAt: new Date(),
    })
  }

  // Tags

  async setProductTags(productId: string, tags: string[]): Promise<void> {
    const product = this.products.get(productId)
    if (!product) {
      throw new Error('Product not found')
    }

    this.products.set(productId, {
      ...product,
      tags,
      updatedAt: new Date(),
    })
  }

  async addProductTag(productId: string, tag: string): Promise<void> {
    const product = this.products.get(productId)
    if (!product) {
      throw new Error('Product not found')
    }

    const tags = product.tags ?? []
    if (!tags.includes(tag)) {
      tags.push(tag)
    }

    this.products.set(productId, {
      ...product,
      tags,
      updatedAt: new Date(),
    })
  }

  async removeProductTag(productId: string, tag: string): Promise<void> {
    const product = this.products.get(productId)
    if (!product) {
      throw new Error('Product not found')
    }

    const tags = (product.tags ?? []).filter((t) => t !== tag)

    this.products.set(productId, {
      ...product,
      tags,
      updatedAt: new Date(),
    })
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createCatalog(): Catalog {
  return new InMemoryCatalog()
}
