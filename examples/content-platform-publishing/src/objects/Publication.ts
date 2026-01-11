/**
 * Publication DO - Publication Settings and Coordination
 *
 * Manages publication-wide settings and coordinates multi-DO workflows:
 * - Publication settings (name, branding, defaults)
 * - Editorial calendar management
 * - Comment moderation queue
 * - Human review escalation
 * - Cross-article statistics
 * - Event-driven publishing workflows
 */

import { DurableObject } from 'cloudflare:workers'

// ============================================================================
// TYPES
// ============================================================================

export interface PublicationSettings {
  name: string
  tagline?: string
  logo?: string
  favicon?: string
  defaultAuthorId?: string
  defaultCategoryId: string
  moderationEnabled: boolean
  autoPublishApproved: boolean
  socialSharing: {
    twitter: boolean
    linkedin: boolean
    newsletter: boolean
  }
  seoDefaults: {
    titleSuffix: string
    ogImageTemplate?: string
  }
}

export interface Comment {
  id: string
  articleId: string
  author: string
  authorEmail: string
  content: string
  status: 'pending' | 'approved' | 'rejected' | 'flagged'
  moderationReason?: string
  createdAt: string
  parentId?: string
}

export interface HumanReviewTask {
  id: string
  type: 'comment' | 'article' | 'author'
  resourceId: string
  reason: string
  sla: string
  status: 'pending' | 'completed'
  createdAt: string
  completedAt?: string
  decision?: 'approved' | 'rejected'
  reviewer?: string
}

export interface CalendarEntry {
  date: string
  articles: Array<{
    id: string
    title: string
    status: string
    scheduledAt?: string
    authorId: string
  }>
}

export interface PublicationStats {
  totalArticles: number
  publishedArticles: number
  draftArticles: number
  scheduledArticles: number
  inReviewArticles: number
  totalViews: number
  totalShares: number
  totalAuthors: number
  totalCategories: number
  pendingComments: number
  pendingReviews: number
}

// ============================================================================
// SIMULATED AI AGENT (QUINN - MODERATION)
// ============================================================================

function simulateQuinnModerate(content: string): { safe: boolean; reason?: string; flagged: boolean } {
  const spamKeywords = ['crypto', 'free money', 'guaranteed', 'click here', 'buy now', 'winner']
  const toxicKeywords = ['hate', 'stupid', 'idiot', 'worst', 'terrible']

  const lowerContent = content.toLowerCase()

  if (spamKeywords.some((kw) => lowerContent.includes(kw))) {
    return { safe: false, reason: 'Spam content detected', flagged: true }
  }

  if (toxicKeywords.some((kw) => lowerContent.includes(kw))) {
    return { safe: false, reason: 'Potentially toxic content', flagged: true }
  }

  return { safe: true, flagged: false }
}

// ============================================================================
// PUBLICATION DURABLE OBJECT
// ============================================================================

interface Env {
  ARTICLE_DO?: DurableObjectNamespace
  AUTHOR_DO?: DurableObjectNamespace
  CATEGORY_DO?: DurableObjectNamespace
}

export class PublicationDO extends DurableObject<Env> {
  private settings: PublicationSettings | null = null
  private comments: Map<string, Comment> = new Map()
  private humanReviewTasks: Map<string, HumanReviewTask> = new Map()
  private articleIndex: Map<string, { title: string; status: string; authorId: string; categoryId: string; scheduledAt?: string; publishedAt?: string; views: number; shares: number }> = new Map()
  private initialized = false

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return

    this.settings = (await this.ctx.storage.get('settings')) as PublicationSettings | null
    const commentsData = (await this.ctx.storage.get('comments')) as [string, Comment][] | undefined
    const reviewsData = (await this.ctx.storage.get('humanReviewTasks')) as [string, HumanReviewTask][] | undefined
    const indexData = (await this.ctx.storage.get('articleIndex')) as [string, { title: string; status: string; authorId: string; categoryId: string; scheduledAt?: string; publishedAt?: string; views: number; shares: number }][] | undefined

    if (commentsData) this.comments = new Map(commentsData)
    if (reviewsData) this.humanReviewTasks = new Map(reviewsData)
    if (indexData) this.articleIndex = new Map(indexData)

    // Initialize default settings if not set
    if (!this.settings) {
      this.settings = {
        name: 'My Publication',
        defaultCategoryId: 'uncategorized',
        moderationEnabled: true,
        autoPublishApproved: false,
        socialSharing: {
          twitter: true,
          linkedin: true,
          newsletter: false,
        },
        seoDefaults: {
          titleSuffix: '| Blog',
        },
      }
      await this.save()
    }

    this.initialized = true
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put('settings', this.settings)
    await this.ctx.storage.put('comments', Array.from(this.comments.entries()))
    await this.ctx.storage.put('humanReviewTasks', Array.from(this.humanReviewTasks.entries()))
    await this.ctx.storage.put('articleIndex', Array.from(this.articleIndex.entries()))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SETTINGS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get publication settings
   */
  async getSettings(): Promise<PublicationSettings | null> {
    await this.ensureInitialized()
    return this.settings
  }

  /**
   * Update publication settings
   */
  async updateSettings(updates: Partial<PublicationSettings>): Promise<PublicationSettings | null> {
    await this.ensureInitialized()

    if (!this.settings) return null

    this.settings = { ...this.settings, ...updates }
    await this.save()

    console.log(`[Publication.settingsUpdated]`)
    return this.settings
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ARTICLE INDEX (for cross-article queries)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Register an article in the publication index
   */
  async registerArticle(articleId: string, data: { title: string; status: string; authorId: string; categoryId: string; scheduledAt?: string; publishedAt?: string; views?: number; shares?: number }): Promise<void> {
    await this.ensureInitialized()

    this.articleIndex.set(articleId, {
      title: data.title,
      status: data.status,
      authorId: data.authorId,
      categoryId: data.categoryId,
      scheduledAt: data.scheduledAt,
      publishedAt: data.publishedAt,
      views: data.views || 0,
      shares: data.shares || 0,
    })

    await this.save()
    console.log(`[Publication.articleRegistered] ${articleId}`)
  }

  /**
   * Update article status in index
   */
  async updateArticleStatus(articleId: string, status: string, scheduledAt?: string, publishedAt?: string): Promise<void> {
    await this.ensureInitialized()

    const article = this.articleIndex.get(articleId)
    if (article) {
      article.status = status
      if (scheduledAt !== undefined) article.scheduledAt = scheduledAt
      if (publishedAt !== undefined) article.publishedAt = publishedAt
      await this.save()
    }
  }

  /**
   * Update article metrics in index
   */
  async updateArticleMetrics(articleId: string, views: number, shares: number): Promise<void> {
    await this.ensureInitialized()

    const article = this.articleIndex.get(articleId)
    if (article) {
      article.views = views
      article.shares = shares
      await this.save()
    }
  }

  /**
   * Remove article from index
   */
  async unregisterArticle(articleId: string): Promise<void> {
    await this.ensureInitialized()

    this.articleIndex.delete(articleId)
    await this.save()
    console.log(`[Publication.articleUnregistered] ${articleId}`)
  }

  /**
   * List articles with optional filters
   */
  async listArticles(filters?: { status?: string; authorId?: string; categoryId?: string }): Promise<Array<{ id: string; title: string; status: string; authorId: string; categoryId: string }>> {
    await this.ensureInitialized()

    let results = Array.from(this.articleIndex.entries()).map(([id, data]) => ({ id, ...data }))

    if (filters?.status) {
      results = results.filter((a) => a.status === filters.status)
    }
    if (filters?.authorId) {
      results = results.filter((a) => a.authorId === filters.authorId)
    }
    if (filters?.categoryId) {
      results = results.filter((a) => a.categoryId === filters.categoryId)
    }

    return results
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EDITORIAL CALENDAR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get editorial calendar for a month
   */
  async getCalendar(yearMonth: string): Promise<CalendarEntry[]> {
    await this.ensureInitialized()

    const [year, month] = yearMonth.split('-').map(Number)
    const endDate = new Date(year, month, 0)
    const entries: CalendarEntry[] = []

    for (let day = 1; day <= endDate.getDate(); day++) {
      const dateStr = `${yearMonth}-${String(day).padStart(2, '0')}`

      const articlesForDay = Array.from(this.articleIndex.entries())
        .filter(([_, data]) => {
          const articleDate = data.scheduledAt || data.publishedAt
          return articleDate && articleDate.startsWith(dateStr)
        })
        .map(([id, data]) => ({
          id,
          title: data.title,
          status: data.status,
          scheduledAt: data.scheduledAt,
          authorId: data.authorId,
        }))

      if (articlesForDay.length > 0) {
        entries.push({ date: dateStr, articles: articlesForDay })
      }
    }

    return entries
  }

  /**
   * Get upcoming scheduled articles
   */
  async getUpcomingArticles(limit = 10): Promise<Array<{ id: string; title: string; scheduledAt: string; authorId: string }>> {
    await this.ensureInitialized()

    const now = new Date().toISOString()

    return Array.from(this.articleIndex.entries())
      .filter(([_, data]) => data.status === 'scheduled' && data.scheduledAt && data.scheduledAt > now)
      .map(([id, data]) => ({
        id,
        title: data.title,
        scheduledAt: data.scheduledAt!,
        authorId: data.authorId,
      }))
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
      .slice(0, limit)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMMENTS & MODERATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add a comment with AI moderation
   */
  async addComment(articleId: string, comment: { author: string; authorEmail: string; content: string; parentId?: string }): Promise<Comment> {
    await this.ensureInitialized()

    const id = `comment-${Date.now()}`
    const now = new Date().toISOString()

    // AI moderation via Quinn agent
    const moderation = this.settings?.moderationEnabled ? simulateQuinnModerate(comment.content) : { safe: true, flagged: false }

    const newComment: Comment = {
      id,
      articleId,
      author: comment.author,
      authorEmail: comment.authorEmail,
      content: comment.content,
      status: moderation.safe ? 'pending' : 'flagged',
      moderationReason: moderation.reason,
      createdAt: now,
      parentId: comment.parentId,
    }

    this.comments.set(id, newComment)

    // If flagged, create human review task
    if (moderation.flagged) {
      await this.createHumanReview({
        type: 'comment',
        resourceId: id,
        reason: moderation.reason || 'AI flagged for review',
        sla: '4 hours',
      })
    }

    await this.save()

    console.log(`[Comment.created] ${id} (status: ${newComment.status})`)
    return newComment
  }

  /**
   * Get comments for an article
   */
  async getComments(articleId: string, includeAll = false): Promise<Comment[]> {
    await this.ensureInitialized()

    const articleComments = Array.from(this.comments.values()).filter((c) => c.articleId === articleId)

    if (includeAll) {
      return articleComments
    }

    return articleComments.filter((c) => c.status === 'approved')
  }

  /**
   * Approve a comment
   */
  async approveComment(commentId: string): Promise<Comment | null> {
    await this.ensureInitialized()

    const comment = this.comments.get(commentId)
    if (!comment) return null

    comment.status = 'approved'
    await this.save()

    console.log(`[Comment.approved] ${commentId}`)
    return comment
  }

  /**
   * Reject a comment
   */
  async rejectComment(commentId: string, reason?: string): Promise<Comment | null> {
    await this.ensureInitialized()

    const comment = this.comments.get(commentId)
    if (!comment) return null

    comment.status = 'rejected'
    if (reason) comment.moderationReason = reason
    await this.save()

    console.log(`[Comment.rejected] ${commentId}`)
    return comment
  }

  /**
   * Get moderation queue
   */
  async getModerationQueue(): Promise<Comment[]> {
    await this.ensureInitialized()

    return Array.from(this.comments.values())
      .filter((c) => c.status === 'pending' || c.status === 'flagged')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HUMAN ESCALATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a human review task
   */
  async createHumanReview(task: { type: 'comment' | 'article' | 'author'; resourceId: string; reason: string; sla: string }): Promise<HumanReviewTask> {
    await this.ensureInitialized()

    const id = `review-${Date.now()}`
    const now = new Date().toISOString()

    const reviewTask: HumanReviewTask = {
      id,
      type: task.type,
      resourceId: task.resourceId,
      reason: task.reason,
      sla: task.sla,
      status: 'pending',
      createdAt: now,
    }

    this.humanReviewTasks.set(id, reviewTask)
    await this.save()

    console.log(`[HumanReview.created] ${id}: ${task.reason}`)
    return reviewTask
  }

  /**
   * Complete a human review task
   */
  async completeHumanReview(taskId: string, decision: 'approved' | 'rejected', reviewer: string): Promise<HumanReviewTask | null> {
    await this.ensureInitialized()

    const task = this.humanReviewTasks.get(taskId)
    if (!task) return null

    task.status = 'completed'
    task.decision = decision
    task.reviewer = reviewer
    task.completedAt = new Date().toISOString()

    // Apply decision to the resource
    if (task.type === 'comment') {
      if (decision === 'approved') {
        await this.approveComment(task.resourceId)
      } else {
        await this.rejectComment(task.resourceId, 'Rejected by human reviewer')
      }
    }

    await this.save()

    console.log(`[HumanReview.completed] ${taskId}: ${decision}`)
    return task
  }

  /**
   * Get human review queue
   */
  async getHumanReviewQueue(): Promise<HumanReviewTask[]> {
    await this.ensureInitialized()

    return Array.from(this.humanReviewTasks.values())
      .filter((t) => t.status === 'pending')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATISTICS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get publication statistics
   */
  async getStats(): Promise<PublicationStats> {
    await this.ensureInitialized()

    const articles = Array.from(this.articleIndex.values())
    const comments = Array.from(this.comments.values())
    const reviews = Array.from(this.humanReviewTasks.values())

    const authorIds = new Set(articles.map((a) => a.authorId))
    const categoryIds = new Set(articles.map((a) => a.categoryId))

    return {
      totalArticles: articles.length,
      publishedArticles: articles.filter((a) => a.status === 'published').length,
      draftArticles: articles.filter((a) => a.status === 'draft').length,
      scheduledArticles: articles.filter((a) => a.status === 'scheduled').length,
      inReviewArticles: articles.filter((a) => a.status === 'review').length,
      totalViews: articles.reduce((sum, a) => sum + a.views, 0),
      totalShares: articles.reduce((sum, a) => sum + a.shares, 0),
      totalAuthors: authorIds.size,
      totalCategories: categoryIds.size,
      pendingComments: comments.filter((c) => c.status === 'pending' || c.status === 'flagged').length,
      pendingReviews: reviews.filter((r) => r.status === 'pending').length,
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

export default PublicationDO
