/**
 * Article DO - Content Lifecycle Management
 *
 * Manages the full article lifecycle:
 * - Draft -> Review -> Scheduled -> Published -> Archived
 * - Version history and rollback
 * - AI-powered SEO optimization
 * - Scheduled publishing with alarms
 * - Analytics tracking
 */

import { DurableObject } from 'cloudflare:workers'

// ============================================================================
// TYPES
// ============================================================================

export type ArticleStatus = 'draft' | 'review' | 'scheduled' | 'published' | 'archived'

export interface SEOData {
  metaTitle: string
  metaDescription: string
  keywords: string[]
  ogImage?: string
  canonicalUrl?: string
  structuredData?: Record<string, unknown>
}

export interface ArticleContent {
  title: string
  slug?: string
  content: string // Markdown content
  excerpt?: string
  authorId: string
  categoryId?: string
  tags?: string[]
  featuredImage?: string
}

export interface Article {
  id: string
  title: string
  slug: string
  content: string
  excerpt: string
  authorId: string
  categoryId: string
  tags: string[]
  featuredImage?: string
  status: ArticleStatus
  seo?: SEOData
  version: number
  createdAt: string
  updatedAt: string
  publishedAt?: string
  scheduledAt?: string
  views: number
  shares: number
}

export interface ArticleVersion {
  id: string
  articleId: string
  version: number
  title: string
  content: string
  createdAt: string
  createdBy: string
}

export interface ArticleAnalytics {
  articleId: string
  views: number
  uniqueViews: number
  shares: number
  avgTimeOnPage: number
  bounceRate: number
  topReferrers: Array<{ source: string; count: number }>
}

// ============================================================================
// SIMULATED AI AGENTS
// ============================================================================

/**
 * Simulated Mark agent for SEO optimization
 */
function generateSEO(title: string, content: string): SEOData {
  const keywords = title
    .toLowerCase()
    .split(' ')
    .filter((w) => w.length > 4)
  const excerpt = content.substring(0, 160).replace(/[#*_`]/g, '')

  return {
    metaTitle: `${title} | Blog`,
    metaDescription: excerpt + '...',
    keywords: [...keywords, 'blog', 'insights'],
    ogImage: `https://og.example.com/generate?title=${encodeURIComponent(title)}`,
  }
}

/**
 * Generate URL-friendly slug from title
 */
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// ============================================================================
// ARTICLE DURABLE OBJECT
// ============================================================================

interface Env {
  AUTHOR_DO?: DurableObjectNamespace
  CATEGORY_DO?: DurableObjectNamespace
  PUBLICATION_DO?: DurableObjectNamespace
}

export class ArticleDO extends DurableObject<Env> {
  private article: Article | null = null
  private versions: ArticleVersion[] = []
  private initialized = false

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return

    // Load article from storage
    this.article = (await this.ctx.storage.get('article')) as Article | null
    this.versions = ((await this.ctx.storage.get('versions')) as ArticleVersion[]) ?? []
    this.initialized = true
  }

  private async save(): Promise<void> {
    if (this.article) {
      await this.ctx.storage.put('article', this.article)
    }
    await this.ctx.storage.put('versions', this.versions)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ARTICLE CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new article with AI-powered SEO
   */
  async create(content: ArticleContent): Promise<Article> {
    await this.ensureInitialized()

    if (this.article) {
      throw new Error('Article already exists in this DO instance')
    }

    const id = this.ctx.id.toString()
    const slug = content.slug || generateSlug(content.title)
    const now = new Date().toISOString()

    // Generate SEO suggestions
    const seo = generateSEO(content.title, content.content)

    const article: Article = {
      id,
      title: content.title,
      slug,
      content: content.content,
      excerpt: content.excerpt || content.content.substring(0, 160) + '...',
      authorId: content.authorId,
      categoryId: content.categoryId || 'uncategorized',
      tags: content.tags || [],
      featuredImage: content.featuredImage,
      status: 'draft',
      seo,
      version: 1,
      createdAt: now,
      updatedAt: now,
      views: 0,
      shares: 0,
    }

    this.article = article

    // Save initial version
    this.versions = [
      {
        id: `ver-${id}-1`,
        articleId: id,
        version: 1,
        title: article.title,
        content: article.content,
        createdAt: now,
        createdBy: content.authorId,
      },
    ]

    await this.save()

    console.log(`[Article.created] ${id}`)
    return article
  }

  /**
   * Get the article
   */
  async get(): Promise<Article | null> {
    await this.ensureInitialized()
    return this.article
  }

  /**
   * Update article content
   */
  async update(updates: Partial<ArticleContent & { seo?: SEOData }>): Promise<Article | null> {
    await this.ensureInitialized()

    if (!this.article) return null

    const now = new Date().toISOString()
    const newVersion = this.article.version + 1

    // Apply updates
    if (updates.title) this.article.title = updates.title
    if (updates.content) this.article.content = updates.content
    if (updates.excerpt) this.article.excerpt = updates.excerpt
    if (updates.categoryId) this.article.categoryId = updates.categoryId
    if (updates.tags) this.article.tags = updates.tags
    if (updates.featuredImage) this.article.featuredImage = updates.featuredImage
    if (updates.seo) this.article.seo = updates.seo

    this.article.version = newVersion
    this.article.updatedAt = now

    // Save version history
    this.versions.push({
      id: `ver-${this.article.id}-${newVersion}`,
      articleId: this.article.id,
      version: newVersion,
      title: this.article.title,
      content: this.article.content,
      createdAt: now,
      createdBy: updates.authorId || this.article.authorId,
    })

    // Re-generate SEO if title changed
    if (updates.title) {
      this.article.seo = generateSEO(updates.title, this.article.content)
    }

    await this.save()

    console.log(`[Article.updated] ${this.article.id} v${newVersion}`)
    return this.article
  }

  /**
   * Delete the article
   */
  async delete(): Promise<boolean> {
    await this.ensureInitialized()

    if (!this.article) return false

    const id = this.article.id
    await this.ctx.storage.deleteAll()
    this.article = null
    this.versions = []
    this.initialized = false

    console.log(`[Article.deleted] ${id}`)
    return true
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTENT LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Submit article for editorial review
   */
  async submitForReview(): Promise<Article | null> {
    await this.ensureInitialized()

    if (!this.article) return null
    if (this.article.status !== 'draft') {
      throw new Error('Can only submit drafts for review')
    }

    this.article.status = 'review'
    this.article.updatedAt = new Date().toISOString()
    await this.save()

    console.log(`[Article.submitted] ${this.article.id}`)
    return this.article
  }

  /**
   * Approve article and optionally schedule
   */
  async approve(scheduledAt?: Date): Promise<Article | null> {
    await this.ensureInitialized()

    if (!this.article) return null
    if (this.article.status !== 'review') {
      throw new Error('Can only approve articles in review')
    }

    if (scheduledAt) {
      return this.schedule(scheduledAt)
    } else {
      return this.publish()
    }
  }

  /**
   * Schedule article for future publication
   */
  async schedule(scheduledAt: Date): Promise<Article | null> {
    await this.ensureInitialized()

    if (!this.article) return null

    this.article.status = 'scheduled'
    this.article.scheduledAt = scheduledAt.toISOString()
    this.article.updatedAt = new Date().toISOString()

    // Set alarm for scheduled publication
    await this.ctx.storage.setAlarm(scheduledAt)

    await this.save()

    console.log(`[Article.scheduled] ${this.article.id} for ${scheduledAt.toISOString()}`)
    return this.article
  }

  /**
   * Reschedule a scheduled article
   */
  async reschedule(newScheduledAt: Date): Promise<Article | null> {
    await this.ensureInitialized()

    if (!this.article || this.article.status !== 'scheduled') return null

    // Cancel existing alarm
    await this.ctx.storage.deleteAlarm()

    return this.schedule(newScheduledAt)
  }

  /**
   * Publish article immediately
   */
  async publish(): Promise<Article | null> {
    await this.ensureInitialized()

    if (!this.article) return null

    const now = new Date().toISOString()
    this.article.status = 'published'
    this.article.publishedAt = now
    this.article.updatedAt = now
    delete this.article.scheduledAt

    // Cancel any pending alarm
    await this.ctx.storage.deleteAlarm()

    await this.save()

    console.log(`[Article.published] ${this.article.id}`)
    return this.article
  }

  /**
   * Archive a published article
   */
  async archive(): Promise<Article | null> {
    await this.ensureInitialized()

    if (!this.article) return null

    this.article.status = 'archived'
    this.article.updatedAt = new Date().toISOString()
    await this.save()

    console.log(`[Article.archived] ${this.article.id}`)
    return this.article
  }

  /**
   * Restore article to draft
   */
  async restoreToDraft(): Promise<Article | null> {
    await this.ensureInitialized()

    if (!this.article) return null

    this.article.status = 'draft'
    this.article.updatedAt = new Date().toISOString()
    delete this.article.publishedAt
    delete this.article.scheduledAt

    await this.save()

    console.log(`[Article.restored] ${this.article.id}`)
    return this.article
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VERSIONING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get version history
   */
  async getVersionHistory(): Promise<ArticleVersion[]> {
    await this.ensureInitialized()
    return this.versions
  }

  /**
   * Revert to a previous version
   */
  async revertToVersion(version: number): Promise<Article | null> {
    await this.ensureInitialized()

    if (!this.article) return null

    const targetVersion = this.versions.find((v) => v.version === version)
    if (!targetVersion) {
      throw new Error(`Version ${version} not found`)
    }

    const now = new Date().toISOString()
    this.article.title = targetVersion.title
    this.article.content = targetVersion.content
    this.article.version = this.article.version + 1
    this.article.updatedAt = now

    // Save the revert as a new version
    this.versions.push({
      id: `ver-${this.article.id}-${this.article.version}`,
      articleId: this.article.id,
      version: this.article.version,
      title: this.article.title,
      content: this.article.content,
      createdAt: now,
      createdBy: 'system-revert',
    })

    await this.save()

    console.log(`[Article.reverted] ${this.article.id} to v${version}`)
    return this.article
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ANALYTICS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Track a page view
   */
  async trackView(): Promise<void> {
    await this.ensureInitialized()

    if (this.article) {
      this.article.views++
      await this.save()
    }
  }

  /**
   * Track a share
   */
  async trackShare(): Promise<void> {
    await this.ensureInitialized()

    if (this.article) {
      this.article.shares++
      await this.save()
    }
  }

  /**
   * Get analytics for the article
   */
  async getAnalytics(): Promise<ArticleAnalytics | null> {
    await this.ensureInitialized()

    if (!this.article) return null

    return {
      articleId: this.article.id,
      views: this.article.views,
      uniqueViews: Math.floor(this.article.views * 0.7),
      shares: this.article.shares,
      avgTimeOnPage: 180 + Math.random() * 120,
      bounceRate: 0.3 + Math.random() * 0.2,
      topReferrers: [
        { source: 'twitter.com', count: Math.floor(this.article.views * 0.3) },
        { source: 'linkedin.com', count: Math.floor(this.article.views * 0.2) },
        { source: 'google.com', count: Math.floor(this.article.views * 0.25) },
        { source: 'direct', count: Math.floor(this.article.views * 0.15) },
        { source: 'other', count: Math.floor(this.article.views * 0.1) },
      ],
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ALARM HANDLER (Scheduled Publishing)
  // ═══════════════════════════════════════════════════════════════════════════

  async alarm(): Promise<void> {
    await this.ensureInitialized()

    if (this.article && this.article.status === 'scheduled') {
      await this.publish()
    }
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

export default ArticleDO
