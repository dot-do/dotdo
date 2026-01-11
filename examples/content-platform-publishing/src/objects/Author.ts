/**
 * Author DO - Author Profile Management
 *
 * Manages author profiles and their content:
 * - Profile information (bio, avatar, social links)
 * - Role-based permissions (contributor, author, editor, admin)
 * - Author statistics and metrics
 * - Multi-author collaboration support
 */

import { DurableObject } from 'cloudflare:workers'

// ============================================================================
// TYPES
// ============================================================================

export type AuthorRole = 'contributor' | 'author' | 'editor' | 'admin'

export interface SocialLinks {
  twitter?: string
  linkedin?: string
  github?: string
  website?: string
}

export interface Author {
  id: string
  name: string
  email: string
  bio?: string
  avatar?: string
  role: AuthorRole
  socialLinks?: SocialLinks
  createdAt: string
  updatedAt: string
  articleCount: number
  totalViews: number
}

export interface AuthorStats {
  authorId: string
  articleCount: number
  publishedCount: number
  draftCount: number
  totalViews: number
  totalShares: number
  avgViewsPerArticle: number
}

export interface AuthorPermissions {
  canCreate: boolean
  canEdit: boolean
  canPublish: boolean
  canDelete: boolean
  canManageAuthors: boolean
  canManageCategories: boolean
  canManageSettings: boolean
}

// ============================================================================
// ROLE PERMISSIONS
// ============================================================================

const ROLE_PERMISSIONS: Record<AuthorRole, AuthorPermissions> = {
  contributor: {
    canCreate: true,
    canEdit: false, // Can only edit own drafts
    canPublish: false,
    canDelete: false,
    canManageAuthors: false,
    canManageCategories: false,
    canManageSettings: false,
  },
  author: {
    canCreate: true,
    canEdit: true, // Can edit own articles
    canPublish: false,
    canDelete: false,
    canManageAuthors: false,
    canManageCategories: false,
    canManageSettings: false,
  },
  editor: {
    canCreate: true,
    canEdit: true, // Can edit any article
    canPublish: true,
    canDelete: true,
    canManageAuthors: false,
    canManageCategories: true,
    canManageSettings: false,
  },
  admin: {
    canCreate: true,
    canEdit: true,
    canPublish: true,
    canDelete: true,
    canManageAuthors: true,
    canManageCategories: true,
    canManageSettings: true,
  },
}

// ============================================================================
// AUTHOR DURABLE OBJECT
// ============================================================================

interface Env {
  ARTICLE_DO?: DurableObjectNamespace
}

export class AuthorDO extends DurableObject<Env> {
  private author: Author | null = null
  private articleIds: string[] = []
  private initialized = false

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return

    this.author = (await this.ctx.storage.get('author')) as Author | null
    this.articleIds = ((await this.ctx.storage.get('articleIds')) as string[]) ?? []
    this.initialized = true
  }

  private async save(): Promise<void> {
    if (this.author) {
      await this.ctx.storage.put('author', this.author)
    }
    await this.ctx.storage.put('articleIds', this.articleIds)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTHOR CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new author profile
   */
  async create(data: { name: string; email: string; bio?: string; avatar?: string; role?: AuthorRole; socialLinks?: SocialLinks }): Promise<Author> {
    await this.ensureInitialized()

    if (this.author) {
      throw new Error('Author already exists in this DO instance')
    }

    const now = new Date().toISOString()

    const author: Author = {
      id: this.ctx.id.toString(),
      name: data.name,
      email: data.email,
      bio: data.bio,
      avatar: data.avatar,
      role: data.role || 'contributor',
      socialLinks: data.socialLinks,
      createdAt: now,
      updatedAt: now,
      articleCount: 0,
      totalViews: 0,
    }

    this.author = author
    await this.save()

    console.log(`[Author.created] ${author.id}: ${author.name}`)
    return author
  }

  /**
   * Get the author profile
   */
  async get(): Promise<Author | null> {
    await this.ensureInitialized()
    return this.author
  }

  /**
   * Update author profile
   */
  async update(updates: Partial<Omit<Author, 'id' | 'createdAt' | 'articleCount' | 'totalViews'>>): Promise<Author | null> {
    await this.ensureInitialized()

    if (!this.author) return null

    if (updates.name) this.author.name = updates.name
    if (updates.email) this.author.email = updates.email
    if (updates.bio !== undefined) this.author.bio = updates.bio
    if (updates.avatar !== undefined) this.author.avatar = updates.avatar
    if (updates.role) this.author.role = updates.role
    if (updates.socialLinks) this.author.socialLinks = { ...this.author.socialLinks, ...updates.socialLinks }

    this.author.updatedAt = new Date().toISOString()
    await this.save()

    console.log(`[Author.updated] ${this.author.id}`)
    return this.author
  }

  /**
   * Delete the author profile
   */
  async delete(): Promise<boolean> {
    await this.ensureInitialized()

    if (!this.author) return false

    const id = this.author.id
    await this.ctx.storage.deleteAll()
    this.author = null
    this.articleIds = []
    this.initialized = false

    console.log(`[Author.deleted] ${id}`)
    return true
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PERMISSIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get author permissions based on role
   */
  async getPermissions(): Promise<AuthorPermissions | null> {
    await this.ensureInitialized()

    if (!this.author) return null

    return ROLE_PERMISSIONS[this.author.role]
  }

  /**
   * Check if author has specific permission
   */
  async hasPermission(permission: keyof AuthorPermissions): Promise<boolean> {
    await this.ensureInitialized()

    if (!this.author) return false

    return ROLE_PERMISSIONS[this.author.role][permission]
  }

  /**
   * Update author role (admin only)
   */
  async setRole(role: AuthorRole): Promise<Author | null> {
    await this.ensureInitialized()

    if (!this.author) return null

    this.author.role = role
    this.author.updatedAt = new Date().toISOString()
    await this.save()

    console.log(`[Author.roleChanged] ${this.author.id}: ${role}`)
    return this.author
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ARTICLE TRACKING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add an article to this author
   */
  async addArticle(articleId: string): Promise<void> {
    await this.ensureInitialized()

    if (!this.articleIds.includes(articleId)) {
      this.articleIds.push(articleId)
      if (this.author) {
        this.author.articleCount = this.articleIds.length
      }
      await this.save()
    }
  }

  /**
   * Remove an article from this author
   */
  async removeArticle(articleId: string): Promise<void> {
    await this.ensureInitialized()

    this.articleIds = this.articleIds.filter((id) => id !== articleId)
    if (this.author) {
      this.author.articleCount = this.articleIds.length
    }
    await this.save()
  }

  /**
   * Get all article IDs for this author
   */
  async getArticleIds(): Promise<string[]> {
    await this.ensureInitialized()
    return this.articleIds
  }

  /**
   * Update view count
   */
  async addViews(count: number): Promise<void> {
    await this.ensureInitialized()

    if (this.author) {
      this.author.totalViews += count
      await this.save()
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATISTICS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get author statistics
   */
  async getStats(): Promise<AuthorStats | null> {
    await this.ensureInitialized()

    if (!this.author) return null

    // In a real implementation, this would aggregate from article DOs
    return {
      authorId: this.author.id,
      articleCount: this.author.articleCount,
      publishedCount: Math.floor(this.author.articleCount * 0.7),
      draftCount: Math.floor(this.author.articleCount * 0.3),
      totalViews: this.author.totalViews,
      totalShares: Math.floor(this.author.totalViews * 0.02),
      avgViewsPerArticle: this.author.articleCount > 0 ? Math.floor(this.author.totalViews / this.author.articleCount) : 0,
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

export default AuthorDO
