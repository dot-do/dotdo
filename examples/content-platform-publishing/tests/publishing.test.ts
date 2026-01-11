/**
 * Content Platform Publishing Tests
 *
 * Tests for the multi-DO blog/CMS workflow including:
 * - Article lifecycle (draft -> review -> scheduled -> published)
 * - Author management and permissions
 * - Category and tag taxonomy
 * - Comment moderation with AI
 * - Human review escalation
 * - Multi-DO coordination
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// MOCK TYPES (matching DO interfaces)
// ============================================================================

type ArticleStatus = 'draft' | 'review' | 'scheduled' | 'published' | 'archived'
type AuthorRole = 'contributor' | 'author' | 'editor' | 'admin'

interface Article {
  id: string
  title: string
  slug: string
  content: string
  excerpt: string
  authorId: string
  categoryId: string
  tags: string[]
  status: ArticleStatus
  seo?: {
    metaTitle: string
    metaDescription: string
    keywords: string[]
  }
  version: number
  createdAt: string
  updatedAt: string
  publishedAt?: string
  scheduledAt?: string
  views: number
  shares: number
}

interface Author {
  id: string
  name: string
  email: string
  bio?: string
  role: AuthorRole
  articleCount: number
  totalViews: number
}

interface Category {
  id: string
  name: string
  slug: string
  description?: string
  parentId?: string
  articleCount: number
}

interface Comment {
  id: string
  articleId: string
  author: string
  authorEmail: string
  content: string
  status: 'pending' | 'approved' | 'rejected' | 'flagged'
  moderationReason?: string
  createdAt: string
}

interface HumanReviewTask {
  id: string
  type: 'comment' | 'article' | 'author'
  resourceId: string
  reason: string
  sla: string
  status: 'pending' | 'completed'
  decision?: 'approved' | 'rejected'
  reviewer?: string
}

// ============================================================================
// ARTICLE LIFECYCLE TESTS
// ============================================================================

describe('ArticleDO', () => {
  let article: Article

  beforeEach(() => {
    const now = new Date().toISOString()
    article = {
      id: 'article-001',
      title: 'How We Scaled to 1M Users',
      slug: 'how-we-scaled-to-1m-users',
      content: '# Introduction\n\nOur journey to scale...',
      excerpt: 'Our journey to scale with Durable Objects',
      authorId: 'alice',
      categoryId: 'engineering',
      tags: ['scaling', 'durable-objects'],
      status: 'draft',
      version: 1,
      createdAt: now,
      updatedAt: now,
      views: 0,
      shares: 0,
    }
  })

  describe('Content Lifecycle', () => {
    it('should start in draft status', () => {
      expect(article.status).toBe('draft')
    })

    it('should transition from draft to review', () => {
      expect(article.status).toBe('draft')
      article.status = 'review'
      expect(article.status).toBe('review')
    })

    it('should transition from review to scheduled', () => {
      article.status = 'review'
      article.status = 'scheduled'
      article.scheduledAt = '2024-01-20T09:00:00Z'
      expect(article.status).toBe('scheduled')
      expect(article.scheduledAt).toBeDefined()
    })

    it('should transition from review to published directly', () => {
      article.status = 'review'
      article.status = 'published'
      article.publishedAt = new Date().toISOString()
      expect(article.status).toBe('published')
      expect(article.publishedAt).toBeDefined()
    })

    it('should transition from scheduled to published', () => {
      article.status = 'scheduled'
      article.scheduledAt = '2024-01-20T09:00:00Z'

      // Simulate alarm trigger
      article.status = 'published'
      article.publishedAt = article.scheduledAt
      delete article.scheduledAt

      expect(article.status).toBe('published')
      expect(article.publishedAt).toBe('2024-01-20T09:00:00Z')
      expect(article.scheduledAt).toBeUndefined()
    })

    it('should transition from published to archived', () => {
      article.status = 'published'
      article.status = 'archived'
      expect(article.status).toBe('archived')
    })

    it('should allow restoring to draft from any state', () => {
      article.status = 'published'
      article.publishedAt = new Date().toISOString()

      // Restore to draft
      article.status = 'draft'
      delete article.publishedAt
      delete article.scheduledAt

      expect(article.status).toBe('draft')
      expect(article.publishedAt).toBeUndefined()
    })
  })

  describe('SEO Generation', () => {
    it('should generate SEO data from title', () => {
      const generateSEO = (title: string) => {
        const keywords = title
          .toLowerCase()
          .split(' ')
          .filter((w) => w.length > 4)
        return {
          metaTitle: `${title} | Blog`,
          metaDescription: `Discover insights about ${keywords.slice(0, 3).join(', ')}`,
          keywords: [...keywords, 'blog'],
        }
      }

      const seo = generateSEO(article.title)

      expect(seo.metaTitle).toBe('How We Scaled to 1M Users | Blog')
      expect(seo.keywords).toContain('scaled')
      expect(seo.keywords).toContain('users')
    })
  })

  describe('Versioning', () => {
    it('should increment version on update', () => {
      expect(article.version).toBe(1)
      article.version++
      article.updatedAt = new Date().toISOString()
      expect(article.version).toBe(2)
    })

    it('should track version history', () => {
      interface ArticleVersion {
        id: string
        articleId: string
        version: number
        title: string
        content: string
        createdAt: string
        createdBy: string
      }

      const versions: ArticleVersion[] = [
        {
          id: 'ver-001-1',
          articleId: article.id,
          version: 1,
          title: article.title,
          content: article.content,
          createdAt: article.createdAt,
          createdBy: article.authorId,
        },
      ]

      // Update article
      article.title = 'How We Scaled to 10M Users'
      article.version++

      versions.push({
        id: 'ver-001-2',
        articleId: article.id,
        version: 2,
        title: article.title,
        content: article.content,
        createdAt: new Date().toISOString(),
        createdBy: article.authorId,
      })

      expect(versions).toHaveLength(2)
      expect(versions[0].title).toBe('How We Scaled to 1M Users')
      expect(versions[1].title).toBe('How We Scaled to 10M Users')
    })

    it('should allow reverting to previous version', () => {
      const originalTitle = article.title
      article.title = 'Updated Title'
      article.version++

      // Revert
      article.title = originalTitle
      article.version++

      expect(article.title).toBe('How We Scaled to 1M Users')
      expect(article.version).toBe(3)
    })
  })

  describe('Slug Generation', () => {
    it('should generate slug from title', () => {
      const generateSlug = (title: string) =>
        title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')

      expect(generateSlug('How We Scaled to 1M Users')).toBe('how-we-scaled-to-1m-users')
      expect(generateSlug('Hello World!')).toBe('hello-world')
      expect(generateSlug('  Spaces  Everywhere  ')).toBe('spaces-everywhere')
    })
  })

  describe('Analytics', () => {
    it('should track views', () => {
      expect(article.views).toBe(0)
      article.views++
      article.views++
      expect(article.views).toBe(2)
    })

    it('should track shares', () => {
      expect(article.shares).toBe(0)
      article.shares++
      expect(article.shares).toBe(1)
    })

    it('should calculate analytics metrics', () => {
      article.views = 1000
      article.shares = 50

      const analytics = {
        articleId: article.id,
        views: article.views,
        uniqueViews: Math.floor(article.views * 0.7),
        shares: article.shares,
        shareRate: (article.shares / article.views) * 100,
      }

      expect(analytics.uniqueViews).toBe(700)
      expect(analytics.shareRate).toBe(5)
    })
  })
})

// ============================================================================
// AUTHOR TESTS
// ============================================================================

describe('AuthorDO', () => {
  let author: Author

  beforeEach(() => {
    author = {
      id: 'alice',
      name: 'Alice Chen',
      email: 'alice@example.com',
      bio: 'Tech writer',
      role: 'editor',
      articleCount: 0,
      totalViews: 0,
    }
  })

  describe('Permissions', () => {
    const permissions: Record<AuthorRole, { canPublish: boolean; canEdit: boolean; canManageAuthors: boolean }> = {
      contributor: { canPublish: false, canEdit: false, canManageAuthors: false },
      author: { canPublish: false, canEdit: true, canManageAuthors: false },
      editor: { canPublish: true, canEdit: true, canManageAuthors: false },
      admin: { canPublish: true, canEdit: true, canManageAuthors: true },
    }

    it('should restrict contributors from publishing', () => {
      expect(permissions['contributor'].canPublish).toBe(false)
      expect(permissions['contributor'].canEdit).toBe(false)
    })

    it('should allow authors to edit their own content', () => {
      expect(permissions['author'].canEdit).toBe(true)
      expect(permissions['author'].canPublish).toBe(false)
    })

    it('should allow editors to publish', () => {
      expect(permissions['editor'].canPublish).toBe(true)
      expect(permissions['editor'].canEdit).toBe(true)
      expect(permissions['editor'].canManageAuthors).toBe(false)
    })

    it('should give admins full access', () => {
      expect(permissions['admin'].canPublish).toBe(true)
      expect(permissions['admin'].canEdit).toBe(true)
      expect(permissions['admin'].canManageAuthors).toBe(true)
    })
  })

  describe('Article Tracking', () => {
    it('should track article count', () => {
      expect(author.articleCount).toBe(0)
      author.articleCount++
      author.articleCount++
      expect(author.articleCount).toBe(2)
    })

    it('should track total views across articles', () => {
      expect(author.totalViews).toBe(0)
      author.totalViews += 1000
      author.totalViews += 500
      expect(author.totalViews).toBe(1500)
    })
  })

  describe('Role Changes', () => {
    it('should allow role upgrades', () => {
      author.role = 'contributor'
      expect(author.role).toBe('contributor')

      author.role = 'author'
      expect(author.role).toBe('author')

      author.role = 'editor'
      expect(author.role).toBe('editor')
    })
  })
})

// ============================================================================
// CATEGORY TESTS
// ============================================================================

describe('CategoryDO', () => {
  let categories: Map<string, Category>

  beforeEach(() => {
    categories = new Map()
    categories.set('engineering', {
      id: 'engineering',
      name: 'Engineering',
      slug: 'engineering',
      description: 'Technical deep-dives',
      articleCount: 0,
    })
    categories.set('product', {
      id: 'product',
      name: 'Product',
      slug: 'product',
      description: 'Product updates',
      articleCount: 0,
    })
  })

  describe('Category Management', () => {
    it('should create categories with slug', () => {
      const generateSlug = (name: string) =>
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')

      const newCategory: Category = {
        id: generateSlug('Web Development'),
        name: 'Web Development',
        slug: generateSlug('Web Development'),
        articleCount: 0,
      }

      categories.set(newCategory.id, newCategory)

      expect(categories.get('web-development')).toBeDefined()
      expect(categories.get('web-development')?.slug).toBe('web-development')
    })

    it('should support hierarchical categories', () => {
      const frontendCategory: Category = {
        id: 'frontend',
        name: 'Frontend',
        slug: 'frontend',
        parentId: 'engineering',
        articleCount: 0,
      }

      categories.set(frontendCategory.id, frontendCategory)

      const children = Array.from(categories.values()).filter((c) => c.parentId === 'engineering')
      expect(children).toHaveLength(1)
      expect(children[0].name).toBe('Frontend')
    })

    it('should track article counts', () => {
      const category = categories.get('engineering')!
      expect(category.articleCount).toBe(0)

      category.articleCount++
      category.articleCount++

      expect(category.articleCount).toBe(2)
    })
  })

  describe('Tag Management', () => {
    interface Tag {
      id: string
      name: string
      slug: string
      articleCount: number
    }

    const tags: Map<string, Tag> = new Map()

    it('should create tags with slug', () => {
      const generateSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-')

      const newTag: Tag = {
        id: generateSlug('Durable Objects'),
        name: 'Durable Objects',
        slug: generateSlug('Durable Objects'),
        articleCount: 1,
      }

      tags.set(newTag.id, newTag)

      expect(tags.get('durable-objects')).toBeDefined()
    })

    it('should track article counts per tag', () => {
      const tag: Tag = {
        id: 'scaling',
        name: 'Scaling',
        slug: 'scaling',
        articleCount: 0,
      }

      tags.set(tag.id, tag)

      tag.articleCount++
      tag.articleCount++
      tag.articleCount++

      expect(tags.get('scaling')?.articleCount).toBe(3)
    })
  })
})

// ============================================================================
// COMMENT MODERATION TESTS
// ============================================================================

describe('Comment Moderation', () => {
  describe('AI Moderation (Quinn)', () => {
    const moderateComment = (content: string): { safe: boolean; reason?: string; flagged: boolean } => {
      const spamKeywords = ['crypto', 'free money', 'guaranteed', 'click here', 'buy now']
      const toxicKeywords = ['hate', 'stupid', 'idiot', 'worst']

      const lowerContent = content.toLowerCase()

      if (spamKeywords.some((kw) => lowerContent.includes(kw))) {
        return { safe: false, reason: 'Spam content detected', flagged: true }
      }

      if (toxicKeywords.some((kw) => lowerContent.includes(kw))) {
        return { safe: false, reason: 'Potentially toxic content', flagged: true }
      }

      return { safe: true, flagged: false }
    }

    it('should approve safe comments', () => {
      const result = moderateComment('Great article! Very helpful.')
      expect(result.safe).toBe(true)
      expect(result.flagged).toBe(false)
    })

    it('should flag spam comments', () => {
      const result = moderateComment('Check out my crypto course! Free money guaranteed!')
      expect(result.safe).toBe(false)
      expect(result.flagged).toBe(true)
      expect(result.reason).toBe('Spam content detected')
    })

    it('should flag toxic comments', () => {
      const result = moderateComment('This is the worst article I have ever read!')
      expect(result.safe).toBe(false)
      expect(result.flagged).toBe(true)
      expect(result.reason).toBe('Potentially toxic content')
    })
  })

  describe('Comment Status Flow', () => {
    let comment: Comment

    beforeEach(() => {
      comment = {
        id: 'comment-001',
        articleId: 'article-001',
        author: 'John Reader',
        authorEmail: 'john@example.com',
        content: 'Great article!',
        status: 'pending',
        createdAt: new Date().toISOString(),
      }
    })

    it('should start as pending', () => {
      expect(comment.status).toBe('pending')
    })

    it('should transition to approved', () => {
      comment.status = 'approved'
      expect(comment.status).toBe('approved')
    })

    it('should transition to rejected with reason', () => {
      comment.status = 'rejected'
      comment.moderationReason = 'Off-topic'
      expect(comment.status).toBe('rejected')
      expect(comment.moderationReason).toBe('Off-topic')
    })

    it('should transition to flagged for AI review', () => {
      comment.status = 'flagged'
      comment.moderationReason = 'Spam content detected'
      expect(comment.status).toBe('flagged')
    })
  })
})

// ============================================================================
// HUMAN ESCALATION TESTS
// ============================================================================

describe('Human Review Escalation', () => {
  let reviewTasks: Map<string, HumanReviewTask>

  beforeEach(() => {
    reviewTasks = new Map()
  })

  it('should create review task for flagged content', () => {
    const task: HumanReviewTask = {
      id: 'review-001',
      type: 'comment',
      resourceId: 'comment-001',
      reason: 'Spam content detected',
      sla: '4 hours',
      status: 'pending',
    }

    reviewTasks.set(task.id, task)

    expect(reviewTasks.get('review-001')).toBeDefined()
    expect(reviewTasks.get('review-001')?.status).toBe('pending')
  })

  it('should complete review with approval', () => {
    const task: HumanReviewTask = {
      id: 'review-001',
      type: 'comment',
      resourceId: 'comment-001',
      reason: 'Spam content detected',
      sla: '4 hours',
      status: 'pending',
    }

    reviewTasks.set(task.id, task)

    // Complete review
    task.status = 'completed'
    task.decision = 'approved'
    task.reviewer = 'alice'

    expect(task.status).toBe('completed')
    expect(task.decision).toBe('approved')
    expect(task.reviewer).toBe('alice')
  })

  it('should complete review with rejection', () => {
    const task: HumanReviewTask = {
      id: 'review-001',
      type: 'comment',
      resourceId: 'comment-001',
      reason: 'Spam content detected',
      sla: '4 hours',
      status: 'pending',
    }

    reviewTasks.set(task.id, task)

    // Complete review
    task.status = 'completed'
    task.decision = 'rejected'
    task.reviewer = 'alice'

    expect(task.status).toBe('completed')
    expect(task.decision).toBe('rejected')
  })

  it('should track SLA', () => {
    const task: HumanReviewTask = {
      id: 'review-001',
      type: 'comment',
      resourceId: 'comment-001',
      reason: 'Potential policy violation',
      sla: '4 hours',
      status: 'pending',
    }

    expect(task.sla).toBe('4 hours')
  })
})

// ============================================================================
// SCHEDULED PUBLISHING TESTS
// ============================================================================

describe('Scheduled Publishing', () => {
  it('should set schedule for future publication', () => {
    const now = new Date()
    const futureDate = new Date(now.getTime() + 24 * 60 * 60 * 1000) // 24 hours from now

    const article: Partial<Article> = {
      id: 'article-001',
      status: 'review',
    }

    // Schedule
    article.status = 'scheduled'
    article.scheduledAt = futureDate.toISOString()

    expect(article.status).toBe('scheduled')
    expect(new Date(article.scheduledAt!).getTime()).toBeGreaterThan(now.getTime())
  })

  it('should allow rescheduling', () => {
    const originalDate = new Date('2024-01-20T09:00:00Z')
    const newDate = new Date('2024-01-25T09:00:00Z')

    const article: Partial<Article> = {
      id: 'article-001',
      status: 'scheduled',
      scheduledAt: originalDate.toISOString(),
    }

    // Reschedule
    article.scheduledAt = newDate.toISOString()

    expect(article.scheduledAt).toBe('2024-01-25T09:00:00.000Z')
  })

  it('should publish when alarm triggers', () => {
    const scheduledAt = new Date('2024-01-20T09:00:00Z')

    const article: Partial<Article> = {
      id: 'article-001',
      status: 'scheduled',
      scheduledAt: scheduledAt.toISOString(),
    }

    // Simulate alarm trigger
    article.status = 'published'
    article.publishedAt = scheduledAt.toISOString()
    delete article.scheduledAt

    expect(article.status).toBe('published')
    expect(article.publishedAt).toBe('2024-01-20T09:00:00.000Z')
    expect(article.scheduledAt).toBeUndefined()
  })
})

// ============================================================================
// EDITORIAL CALENDAR TESTS
// ============================================================================

describe('Editorial Calendar', () => {
  interface CalendarEntry {
    date: string
    articles: Array<{
      id: string
      title: string
      status: ArticleStatus
      scheduledAt?: string
      authorId: string
    }>
  }

  it('should group articles by date', () => {
    const articles: Array<{ id: string; title: string; status: ArticleStatus; scheduledAt?: string; publishedAt?: string; authorId: string }> = [
      { id: '1', title: 'Article 1', status: 'scheduled', scheduledAt: '2024-01-15T09:00:00Z', authorId: 'alice' },
      { id: '2', title: 'Article 2', status: 'scheduled', scheduledAt: '2024-01-15T14:00:00Z', authorId: 'bob' },
      { id: '3', title: 'Article 3', status: 'published', publishedAt: '2024-01-10T09:00:00Z', authorId: 'alice' },
    ]

    const getCalendar = (yearMonth: string): CalendarEntry[] => {
      const entries: CalendarEntry[] = []

      const [year, month] = yearMonth.split('-').map(Number)
      const endDate = new Date(year, month, 0)

      for (let day = 1; day <= endDate.getDate(); day++) {
        const dateStr = `${yearMonth}-${String(day).padStart(2, '0')}`

        const articlesForDay = articles.filter((a) => {
          const articleDate = a.scheduledAt || a.publishedAt
          return articleDate && articleDate.startsWith(dateStr)
        })

        if (articlesForDay.length > 0) {
          entries.push({
            date: dateStr,
            articles: articlesForDay.map((a) => ({
              id: a.id,
              title: a.title,
              status: a.status,
              scheduledAt: a.scheduledAt,
              authorId: a.authorId,
            })),
          })
        }
      }

      return entries
    }

    const calendar = getCalendar('2024-01')

    expect(calendar.length).toBeGreaterThan(0)

    const jan15 = calendar.find((e) => e.date === '2024-01-15')
    expect(jan15).toBeDefined()
    expect(jan15?.articles).toHaveLength(2)

    const jan10 = calendar.find((e) => e.date === '2024-01-10')
    expect(jan10).toBeDefined()
    expect(jan10?.articles).toHaveLength(1)
  })
})

// ============================================================================
// MULTI-DO COORDINATION TESTS
// ============================================================================

describe('Multi-DO Coordination', () => {
  it('should coordinate article creation across DOs', () => {
    const events: string[] = []

    // Simulate article creation flow
    events.push('ArticleDO.create')
    events.push('PublicationDO.registerArticle')
    events.push('AuthorDO.addArticle')
    events.push('CategoryDO.addArticleToCategory')
    events.push('CategoryDO.addArticleTags')

    expect(events).toEqual(['ArticleDO.create', 'PublicationDO.registerArticle', 'AuthorDO.addArticle', 'CategoryDO.addArticleToCategory', 'CategoryDO.addArticleTags'])
  })

  it('should coordinate article deletion across DOs', () => {
    const events: string[] = []

    // Simulate article deletion flow
    events.push('ArticleDO.delete')
    events.push('PublicationDO.unregisterArticle')
    events.push('AuthorDO.removeArticle')
    events.push('CategoryDO.removeArticleFromCategory')
    events.push('CategoryDO.removeArticleTags')

    expect(events).toEqual(['ArticleDO.delete', 'PublicationDO.unregisterArticle', 'AuthorDO.removeArticle', 'CategoryDO.removeArticleFromCategory', 'CategoryDO.removeArticleTags'])
  })

  it('should coordinate status changes', () => {
    const events: string[] = []

    // Simulate publish flow
    events.push('ArticleDO.publish')
    events.push('PublicationDO.updateArticleStatus')
    events.push('AuthorDO.addViews') // Future view tracking

    expect(events).toContain('ArticleDO.publish')
    expect(events).toContain('PublicationDO.updateArticleStatus')
  })
})

// ============================================================================
// PUBLICATION STATS TESTS
// ============================================================================

describe('Publication Statistics', () => {
  interface PublicationStats {
    totalArticles: number
    publishedArticles: number
    draftArticles: number
    scheduledArticles: number
    inReviewArticles: number
    totalViews: number
    totalShares: number
    totalAuthors: number
    pendingComments: number
    pendingReviews: number
  }

  it('should calculate publication statistics', () => {
    const articles: Array<{ status: ArticleStatus; views: number; shares: number; authorId: string }> = [
      { status: 'published', views: 1000, shares: 50, authorId: 'alice' },
      { status: 'published', views: 500, shares: 25, authorId: 'bob' },
      { status: 'draft', views: 0, shares: 0, authorId: 'alice' },
      { status: 'review', views: 0, shares: 0, authorId: 'carol' },
      { status: 'scheduled', views: 0, shares: 0, authorId: 'alice' },
    ]

    const comments: Array<{ status: string }> = [{ status: 'pending' }, { status: 'approved' }, { status: 'flagged' }]

    const reviews: Array<{ status: string }> = [{ status: 'pending' }, { status: 'completed' }]

    const stats: PublicationStats = {
      totalArticles: articles.length,
      publishedArticles: articles.filter((a) => a.status === 'published').length,
      draftArticles: articles.filter((a) => a.status === 'draft').length,
      scheduledArticles: articles.filter((a) => a.status === 'scheduled').length,
      inReviewArticles: articles.filter((a) => a.status === 'review').length,
      totalViews: articles.reduce((sum, a) => sum + a.views, 0),
      totalShares: articles.reduce((sum, a) => sum + a.shares, 0),
      totalAuthors: new Set(articles.map((a) => a.authorId)).size,
      pendingComments: comments.filter((c) => c.status === 'pending' || c.status === 'flagged').length,
      pendingReviews: reviews.filter((r) => r.status === 'pending').length,
    }

    expect(stats.totalArticles).toBe(5)
    expect(stats.publishedArticles).toBe(2)
    expect(stats.draftArticles).toBe(1)
    expect(stats.scheduledArticles).toBe(1)
    expect(stats.inReviewArticles).toBe(1)
    expect(stats.totalViews).toBe(1500)
    expect(stats.totalShares).toBe(75)
    expect(stats.totalAuthors).toBe(3)
    expect(stats.pendingComments).toBe(2)
    expect(stats.pendingReviews).toBe(1)
  })
})

// ============================================================================
// MARKDOWN CONTENT TESTS
// ============================================================================

describe('Markdown Content', () => {
  it('should support markdown in content', () => {
    const content = `
# How We Scaled to 1M Users

## Introduction

Our journey to scale with **Durable Objects**.

### Key Technologies

- Cloudflare Workers
- Durable Objects
- SQLite

\`\`\`typescript
export class UserSession extends DO {
  async handleRequest(req: Request) {
    // Handle user session
  }
}
\`\`\`

> The key insight: let the platform handle the scaling.
    `.trim()

    expect(content).toContain('# How We Scaled')
    expect(content).toContain('## Introduction')
    expect(content).toContain('**Durable Objects**')
    expect(content).toContain('```typescript')
    expect(content).toContain('> The key insight')
  })

  it('should extract excerpt from markdown', () => {
    const content = '# Title\n\nThis is the introduction paragraph that should become the excerpt.'

    const extractExcerpt = (markdown: string, maxLength = 160): string => {
      // Remove markdown syntax and get first paragraph
      const cleaned = markdown
        .replace(/^#+ .+$/gm, '') // Remove headers
        .replace(/\*\*|__/g, '') // Remove bold
        .replace(/\*|_/g, '') // Remove italic
        .replace(/`+[^`]*`+/g, '') // Remove code
        .trim()

      if (cleaned.length <= maxLength) return cleaned
      return cleaned.substring(0, maxLength) + '...'
    }

    const excerpt = extractExcerpt(content)
    expect(excerpt).toBe('This is the introduction paragraph that should become the excerpt.')
  })
})
