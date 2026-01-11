/**
 * Category DO - Content Taxonomy Management
 *
 * Manages content categories and tags:
 * - Hierarchical category structure
 * - Category metadata (name, slug, description)
 * - Article association and counts
 * - Tag management
 */

import { DurableObject } from 'cloudflare:workers'

// ============================================================================
// TYPES
// ============================================================================

export interface Category {
  id: string
  name: string
  slug: string
  description?: string
  parentId?: string
  color?: string
  icon?: string
  order: number
  articleCount: number
  createdAt: string
  updatedAt: string
}

export interface CategoryTree extends Category {
  children: CategoryTree[]
}

export interface Tag {
  id: string
  name: string
  slug: string
  articleCount: number
  createdAt: string
}

// ============================================================================
// UTILITIES
// ============================================================================

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// ============================================================================
// CATEGORY DURABLE OBJECT
// ============================================================================

interface Env {
  ARTICLE_DO?: DurableObjectNamespace
}

export class CategoryDO extends DurableObject<Env> {
  private categories: Map<string, Category> = new Map()
  private tags: Map<string, Tag> = new Map()
  private articlesByCategory: Map<string, string[]> = new Map()
  private articlesByTag: Map<string, string[]> = new Map()
  private initialized = false

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return

    const categoriesData = (await this.ctx.storage.get('categories')) as [string, Category][] | undefined
    const tagsData = (await this.ctx.storage.get('tags')) as [string, Tag][] | undefined
    const articlesByCategoryData = (await this.ctx.storage.get('articlesByCategory')) as [string, string[]][] | undefined
    const articlesByTagData = (await this.ctx.storage.get('articlesByTag')) as [string, string[]][] | undefined

    if (categoriesData) this.categories = new Map(categoriesData)
    if (tagsData) this.tags = new Map(tagsData)
    if (articlesByCategoryData) this.articlesByCategory = new Map(articlesByCategoryData)
    if (articlesByTagData) this.articlesByTag = new Map(articlesByTagData)

    // Seed default categories if empty
    if (this.categories.size === 0) {
      await this.seedDefaultCategories()
    }

    this.initialized = true
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put('categories', Array.from(this.categories.entries()))
    await this.ctx.storage.put('tags', Array.from(this.tags.entries()))
    await this.ctx.storage.put('articlesByCategory', Array.from(this.articlesByCategory.entries()))
    await this.ctx.storage.put('articlesByTag', Array.from(this.articlesByTag.entries()))
  }

  private async seedDefaultCategories(): Promise<void> {
    const defaults = [
      { name: 'Engineering', description: 'Technical deep-dives and tutorials', color: '#3b82f6', icon: 'code' },
      { name: 'Product', description: 'Product updates and roadmap', color: '#10b981', icon: 'cube' },
      { name: 'Culture', description: 'Team stories and company culture', color: '#f59e0b', icon: 'users' },
      { name: 'Uncategorized', description: 'Uncategorized content', color: '#6b7280', icon: 'folder' },
    ]

    const now = new Date().toISOString()
    defaults.forEach((cat, index) => {
      const id = generateSlug(cat.name)
      this.categories.set(id, {
        id,
        name: cat.name,
        slug: id,
        description: cat.description,
        color: cat.color,
        icon: cat.icon,
        order: index,
        articleCount: 0,
        createdAt: now,
        updatedAt: now,
      })
    })

    await this.save()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new category
   */
  async createCategory(data: { name: string; description?: string; parentId?: string; color?: string; icon?: string }): Promise<Category> {
    await this.ensureInitialized()

    const id = generateSlug(data.name)

    if (this.categories.has(id)) {
      throw new Error(`Category '${data.name}' already exists`)
    }

    const now = new Date().toISOString()

    const category: Category = {
      id,
      name: data.name,
      slug: id,
      description: data.description,
      parentId: data.parentId,
      color: data.color,
      icon: data.icon,
      order: this.categories.size,
      articleCount: 0,
      createdAt: now,
      updatedAt: now,
    }

    this.categories.set(id, category)
    this.articlesByCategory.set(id, [])
    await this.save()

    console.log(`[Category.created] ${id}: ${data.name}`)
    return category
  }

  /**
   * Get a category by ID
   */
  async getCategory(id: string): Promise<Category | null> {
    await this.ensureInitialized()
    return this.categories.get(id) || null
  }

  /**
   * List all categories
   */
  async listCategories(): Promise<Category[]> {
    await this.ensureInitialized()
    return Array.from(this.categories.values()).sort((a, b) => a.order - b.order)
  }

  /**
   * Get categories as a hierarchical tree
   */
  async getCategoryTree(): Promise<CategoryTree[]> {
    await this.ensureInitialized()

    const categories = Array.from(this.categories.values())
    const rootCategories = categories.filter((c) => !c.parentId)

    const buildTree = (category: Category): CategoryTree => {
      const children = categories.filter((c) => c.parentId === category.id).map(buildTree)
      return { ...category, children }
    }

    return rootCategories.map(buildTree).sort((a, b) => a.order - b.order)
  }

  /**
   * Update a category
   */
  async updateCategory(id: string, updates: Partial<Omit<Category, 'id' | 'slug' | 'createdAt' | 'articleCount'>>): Promise<Category | null> {
    await this.ensureInitialized()

    const category = this.categories.get(id)
    if (!category) return null

    if (updates.name) category.name = updates.name
    if (updates.description !== undefined) category.description = updates.description
    if (updates.parentId !== undefined) category.parentId = updates.parentId
    if (updates.color !== undefined) category.color = updates.color
    if (updates.icon !== undefined) category.icon = updates.icon
    if (updates.order !== undefined) category.order = updates.order

    category.updatedAt = new Date().toISOString()
    await this.save()

    console.log(`[Category.updated] ${id}`)
    return category
  }

  /**
   * Delete a category
   */
  async deleteCategory(id: string): Promise<boolean> {
    await this.ensureInitialized()

    if (!this.categories.has(id)) return false

    // Check if category has articles
    const articles = this.articlesByCategory.get(id) || []
    if (articles.length > 0) {
      throw new Error(`Cannot delete category with ${articles.length} articles`)
    }

    // Check if category has children
    const hasChildren = Array.from(this.categories.values()).some((c) => c.parentId === id)
    if (hasChildren) {
      throw new Error('Cannot delete category with child categories')
    }

    this.categories.delete(id)
    this.articlesByCategory.delete(id)
    await this.save()

    console.log(`[Category.deleted] ${id}`)
    return true
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TAG CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create or get a tag
   */
  async createTag(name: string): Promise<Tag> {
    await this.ensureInitialized()

    const id = generateSlug(name)

    if (this.tags.has(id)) {
      return this.tags.get(id)!
    }

    const now = new Date().toISOString()

    const tag: Tag = {
      id,
      name,
      slug: id,
      articleCount: 0,
      createdAt: now,
    }

    this.tags.set(id, tag)
    this.articlesByTag.set(id, [])
    await this.save()

    console.log(`[Tag.created] ${id}: ${name}`)
    return tag
  }

  /**
   * Get a tag by ID
   */
  async getTag(id: string): Promise<Tag | null> {
    await this.ensureInitialized()
    return this.tags.get(id) || null
  }

  /**
   * List all tags
   */
  async listTags(): Promise<Tag[]> {
    await this.ensureInitialized()
    return Array.from(this.tags.values()).sort((a, b) => b.articleCount - a.articleCount)
  }

  /**
   * Delete a tag
   */
  async deleteTag(id: string): Promise<boolean> {
    await this.ensureInitialized()

    if (!this.tags.has(id)) return false

    this.tags.delete(id)
    this.articlesByTag.delete(id)
    await this.save()

    console.log(`[Tag.deleted] ${id}`)
    return true
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ARTICLE ASSOCIATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add an article to a category
   */
  async addArticleToCategory(articleId: string, categoryId: string): Promise<void> {
    await this.ensureInitialized()

    const category = this.categories.get(categoryId)
    if (!category) {
      throw new Error(`Category '${categoryId}' not found`)
    }

    const articles = this.articlesByCategory.get(categoryId) || []
    if (!articles.includes(articleId)) {
      articles.push(articleId)
      this.articlesByCategory.set(categoryId, articles)
      category.articleCount = articles.length
      await this.save()
    }
  }

  /**
   * Remove an article from a category
   */
  async removeArticleFromCategory(articleId: string, categoryId: string): Promise<void> {
    await this.ensureInitialized()

    const category = this.categories.get(categoryId)
    if (!category) return

    const articles = (this.articlesByCategory.get(categoryId) || []).filter((id) => id !== articleId)
    this.articlesByCategory.set(categoryId, articles)
    category.articleCount = articles.length
    await this.save()
  }

  /**
   * Add tags to an article
   */
  async addArticleTags(articleId: string, tagNames: string[]): Promise<void> {
    await this.ensureInitialized()

    for (const tagName of tagNames) {
      const tag = await this.createTag(tagName)
      const articles = this.articlesByTag.get(tag.id) || []

      if (!articles.includes(articleId)) {
        articles.push(articleId)
        this.articlesByTag.set(tag.id, articles)
        tag.articleCount = articles.length
      }
    }

    await this.save()
  }

  /**
   * Remove tags from an article
   */
  async removeArticleTags(articleId: string, tagIds: string[]): Promise<void> {
    await this.ensureInitialized()

    for (const tagId of tagIds) {
      const tag = this.tags.get(tagId)
      if (!tag) continue

      const articles = (this.articlesByTag.get(tagId) || []).filter((id) => id !== articleId)
      this.articlesByTag.set(tagId, articles)
      tag.articleCount = articles.length
    }

    await this.save()
  }

  /**
   * Get articles for a category
   */
  async getArticlesByCategory(categoryId: string): Promise<string[]> {
    await this.ensureInitialized()
    return this.articlesByCategory.get(categoryId) || []
  }

  /**
   * Get articles for a tag
   */
  async getArticlesByTag(tagId: string): Promise<string[]> {
    await this.ensureInitialized()
    return this.articlesByTag.get(tagId) || []
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/rpc' && request.method === 'POST') {
      try {
        const body = (await request.json()) as {
          jsonrpc: string
          id: number
          method: string
          params?: unknown[]
        }
        const { method, params = [], id } = body

        const methodFn = (this as unknown as Record<string, (...args: unknown[]) => unknown>)[method]
        if (typeof methodFn !== 'function') {
          return Response.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method '${method}' not found` } }, { status: 400 })
        }

        const result = await methodFn.apply(this, params)
        return Response.json({ jsonrpc: '2.0', id, result })
      } catch (error) {
        return Response.json({ jsonrpc: '2.0', id: 0, error: { code: -32603, message: String(error) } }, { status: 500 })
      }
    }

    return new Response('Not Found', { status: 404 })
  }
}

export default CategoryDO
