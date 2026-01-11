/**
 * PublishingDO - Content Platform Publishing Workflow
 *
 * A complete CMS/blog publishing system with:
 * - Content lifecycle (Draft -> Review -> Schedule -> Publish)
 * - AI-assisted SEO optimization via Mark agent
 * - Automated social sharing
 * - Comment moderation with human escalation
 * - Content versioning
 * - Editorial calendar
 * - Analytics integration
 */

import { DurableObject } from 'cloudflare:workers'

// ============================================================================
// TYPES
// ============================================================================

type PostStatus = 'draft' | 'review' | 'scheduled' | 'published' | 'archived'

interface PostContent {
  title: string
  slug?: string
  content: string
  excerpt?: string
  author: string
  category?: string
  tags?: string[]
  featuredImage?: string
}

interface SEOData {
  metaTitle: string
  metaDescription: string
  keywords: string[]
  ogImage?: string
  canonicalUrl?: string
  structuredData?: Record<string, unknown>
}

interface Post {
  id: string
  title: string
  slug: string
  content: string
  excerpt: string
  author: string
  category: string
  tags: string[]
  featuredImage?: string
  status: PostStatus
  seo?: SEOData
  version: number
  createdAt: string
  updatedAt: string
  publishedAt?: string
  scheduledAt?: string
  views: number
  shares: number
}

interface PostVersion {
  id: string
  postId: string
  version: number
  title: string
  content: string
  createdAt: string
  createdBy: string
}

interface Comment {
  id: string
  postId: string
  author: string
  authorEmail: string
  content: string
  status: 'pending' | 'approved' | 'rejected' | 'flagged'
  moderationReason?: string
  createdAt: string
  parentId?: string
}

interface Author {
  id: string
  name: string
  email: string
  bio?: string
  avatar?: string
  role: 'contributor' | 'author' | 'editor' | 'admin'
}

interface Category {
  id: string
  name: string
  slug: string
  description?: string
  parentId?: string
}

interface AnalyticsData {
  postId: string
  views: number
  uniqueViews: number
  shares: number
  comments: number
  avgTimeOnPage: number
  bounceRate: number
  topReferrers: Array<{ source: string; count: number }>
}

interface CalendarEntry {
  date: string
  posts: Array<{
    id: string
    title: string
    status: PostStatus
    scheduledAt?: string
    author: string
  }>
}

interface HumanReviewTask {
  id: string
  type: 'comment' | 'post' | 'author'
  resourceId: string
  reason: string
  sla: string
  status: 'pending' | 'completed'
  createdAt: string
  completedAt?: string
  decision?: 'approved' | 'rejected'
  reviewer?: string
}

// ============================================================================
// DEMO DATA
// ============================================================================

const DEMO_AUTHORS: Record<string, Author> = {
  alice: {
    id: 'alice',
    name: 'Alice Chen',
    email: 'alice@example.com',
    bio: 'Tech writer and startup enthusiast',
    role: 'editor',
  },
  bob: {
    id: 'bob',
    name: 'Bob Martinez',
    email: 'bob@example.com',
    bio: 'Full-stack developer sharing lessons learned',
    role: 'author',
  },
  carol: {
    id: 'carol',
    name: 'Carol Williams',
    email: 'carol@example.com',
    bio: 'Product manager turned content creator',
    role: 'contributor',
  },
}

const DEMO_CATEGORIES: Record<string, Category> = {
  engineering: {
    id: 'engineering',
    name: 'Engineering',
    slug: 'engineering',
    description: 'Technical deep-dives and tutorials',
  },
  product: {
    id: 'product',
    name: 'Product',
    slug: 'product',
    description: 'Product updates and roadmap',
  },
  culture: {
    id: 'culture',
    name: 'Culture',
    slug: 'culture',
    description: 'Team stories and company culture',
  },
}

const DEMO_POSTS: Record<string, Post> = {
  'post-001': {
    id: 'post-001',
    title: 'How We Scaled to 1M Users with Durable Objects',
    slug: 'scaled-1m-users-durable-objects',
    content: `# How We Scaled to 1M Users with Durable Objects

When we hit 100K users, our traditional database started showing cracks. Queries slowed down, connection pools exhausted, and our ops team was on constant alert.

## The Breaking Point

At 100K concurrent users, we were seeing:
- 500ms average latency
- 10% error rate during peak hours
- $50K/month in database costs

## The Migration

We moved our user sessions to Durable Objects:

\`\`\`typescript
export class UserSession extends DO {
  async handleRequest(req: Request) {
    // Each user gets their own DO instance
    // No connection pooling, no locks, no conflicts
  }
}
\`\`\`

## The Results

After migration:
- 10ms average latency
- 0.01% error rate
- $5K/month infrastructure cost

The key insight: let the platform handle the scaling.`,
    excerpt: 'How we reduced latency by 50x and costs by 90% with Cloudflare Durable Objects',
    author: 'alice',
    category: 'engineering',
    tags: ['scaling', 'durable-objects', 'cloudflare', 'architecture'],
    status: 'published',
    seo: {
      metaTitle: 'How We Scaled to 1M Users with Durable Objects | Engineering Blog',
      metaDescription: 'Learn how we reduced latency by 50x and costs by 90% migrating to Cloudflare Durable Objects.',
      keywords: ['scaling', 'durable objects', 'cloudflare', 'serverless', 'edge computing'],
    },
    version: 3,
    createdAt: '2024-01-10T10:00:00Z',
    updatedAt: '2024-01-12T14:30:00Z',
    publishedAt: '2024-01-15T09:00:00Z',
    views: 15420,
    shares: 342,
  },
  'post-002': {
    id: 'post-002',
    title: 'Building AI Agents That Actually Work',
    slug: 'building-ai-agents-that-work',
    content: `# Building AI Agents That Actually Work

Everyone's building AI agents. Most of them are demos that break in production.

Here's what we learned shipping AI agents to thousands of users.

## The Reliability Problem

AI agents fail in subtle ways:
- Model hallucinations
- Context window overflow
- Rate limiting cascade failures

## Our Solution

We built a supervision layer:

\`\`\`typescript
import { quinn } from 'agents.do'

const result = await quinn\`verify: \${agentOutput}\`
if (!result.verified) {
  await $.human.review({ output: agentOutput })
}
\`\`\`

## Human-in-the-Loop

The secret to reliable AI: know when to escalate.`,
    excerpt: 'Lessons from shipping AI agents to production with human-in-the-loop supervision',
    author: 'bob',
    category: 'engineering',
    tags: ['ai', 'agents', 'llm', 'production'],
    status: 'review',
    version: 2,
    createdAt: '2024-01-18T11:00:00Z',
    updatedAt: '2024-01-19T16:00:00Z',
    views: 0,
    shares: 0,
  },
  'post-003': {
    id: 'post-003',
    title: 'Our Product Roadmap for Q1 2024',
    slug: 'product-roadmap-q1-2024',
    content: `# Our Product Roadmap for Q1 2024

We're excited to share what's coming next.

## January
- Improved analytics dashboard
- Team collaboration features

## February
- API v2 with GraphQL support
- Custom domains for all plans

## March
- Mobile app (iOS and Android)
- Advanced SEO tools`,
    excerpt: 'See what features are coming to the platform in Q1 2024',
    author: 'carol',
    category: 'product',
    tags: ['roadmap', 'product', 'updates'],
    status: 'scheduled',
    scheduledAt: '2024-01-20T09:00:00Z',
    version: 1,
    createdAt: '2024-01-17T09:00:00Z',
    updatedAt: '2024-01-17T09:00:00Z',
    views: 0,
    shares: 0,
  },
  'post-004': {
    id: 'post-004',
    title: 'Why We Chose a 4-Day Work Week',
    slug: 'four-day-work-week',
    content: `# Why We Chose a 4-Day Work Week

Six months ago, we switched to a 4-day work week. Here's what happened.

## The Experiment

We gave everyone Friday off, with full pay.

## The Results

- Productivity increased 20%
- Employee satisfaction up 40%
- Zero regrets

## How We Made It Work

The key was ruthless prioritization. Fewer meetings, more focus time.`,
    excerpt: 'Our experience switching to a 4-day work week and the surprising results',
    author: 'alice',
    category: 'culture',
    tags: ['culture', 'work-life-balance', 'productivity'],
    status: 'draft',
    version: 1,
    createdAt: '2024-01-19T14:00:00Z',
    updatedAt: '2024-01-19T14:00:00Z',
    views: 0,
    shares: 0,
  },
}

const DEMO_COMMENTS: Record<string, Comment> = {
  'comment-001': {
    id: 'comment-001',
    postId: 'post-001',
    author: 'John Developer',
    authorEmail: 'john@example.com',
    content: 'Great article! We had a similar experience migrating to Workers. The cold start times are incredible.',
    status: 'approved',
    createdAt: '2024-01-15T10:30:00Z',
  },
  'comment-002': {
    id: 'comment-002',
    postId: 'post-001',
    author: 'Sarah Engineer',
    authorEmail: 'sarah@example.com',
    content: 'Would love to see a follow-up on how you handle data consistency across DOs!',
    status: 'approved',
    createdAt: '2024-01-15T11:45:00Z',
  },
  'comment-003': {
    id: 'comment-003',
    postId: 'post-001',
    author: 'Spam Bot',
    authorEmail: 'spam@spam.com',
    content: 'Check out my crypto course! Free money guaranteed!!!',
    status: 'rejected',
    moderationReason: 'Spam content detected',
    createdAt: '2024-01-15T12:00:00Z',
  },
  'comment-004': {
    id: 'comment-004',
    postId: 'post-001',
    author: 'Curious Reader',
    authorEmail: 'curious@example.com',
    content: 'How do you handle the transition period? Any downtime during migration?',
    status: 'pending',
    createdAt: '2024-01-19T08:00:00Z',
  },
}

const DEMO_VERSIONS: Record<string, PostVersion[]> = {
  'post-001': [
    {
      id: 'ver-001-1',
      postId: 'post-001',
      version: 1,
      title: 'How We Scaled to 500K Users',
      content: '# Initial draft...',
      createdAt: '2024-01-10T10:00:00Z',
      createdBy: 'alice',
    },
    {
      id: 'ver-001-2',
      postId: 'post-001',
      version: 2,
      title: 'How We Scaled to 1M Users',
      content: '# Updated title and content...',
      createdAt: '2024-01-11T09:00:00Z',
      createdBy: 'alice',
    },
    {
      id: 'ver-001-3',
      postId: 'post-001',
      version: 3,
      title: 'How We Scaled to 1M Users with Durable Objects',
      content: '# Final version with better title...',
      createdAt: '2024-01-12T14:30:00Z',
      createdBy: 'alice',
    },
  ],
}

// ============================================================================
// SIMULATED AI AGENTS
// ============================================================================

/**
 * Simulated Mark agent for SEO optimization
 */
function simulateMarkSEO(title: string): SEOData {
  const keywords = title.toLowerCase().split(' ').filter(w => w.length > 4)
  return {
    metaTitle: `${title} | Blog`,
    metaDescription: `Discover insights about ${keywords.slice(0, 3).join(', ')}. Expert analysis and practical tips.`,
    keywords: [...keywords, 'blog', 'insights', 'tips'],
    ogImage: `https://og.example.com/generate?title=${encodeURIComponent(title)}`,
  }
}

/**
 * Simulated Mark agent for social content
 */
function simulateMarkSocial(title: string, platform: string): string {
  const templates: Record<string, string> = {
    twitter: `New post: "${title}" - A thread on what we learned. 1/`,
    linkedin: `Excited to share our latest insights: "${title}". Key takeaways in the comments.`,
    newsletter: `This week's feature: ${title}. Click through for the full story.`,
  }
  return templates[platform] || `Check out: ${title}`
}

/**
 * Simulated Quinn agent for comment moderation
 */
function simulateQuinnModerate(content: string): { safe: boolean; reason?: string; flagged: boolean } {
  const spamKeywords = ['crypto', 'free money', 'guaranteed', 'click here', 'buy now']
  const toxicKeywords = ['hate', 'stupid', 'idiot', 'worst']

  const lowerContent = content.toLowerCase()

  if (spamKeywords.some(kw => lowerContent.includes(kw))) {
    return { safe: false, reason: 'Spam content detected', flagged: true }
  }

  if (toxicKeywords.some(kw => lowerContent.includes(kw))) {
    return { safe: false, reason: 'Potentially toxic content', flagged: true }
  }

  return { safe: true, flagged: false }
}

// ============================================================================
// PUBLISHING DO CLASS
// ============================================================================

interface Env {
  ENVIRONMENT?: string
}

export class PublishingDO extends DurableObject<Env> {
  private posts: Record<string, Post> = { ...DEMO_POSTS }
  private comments: Record<string, Comment> = { ...DEMO_COMMENTS }
  private versions: Record<string, PostVersion[]> = { ...DEMO_VERSIONS }
  private humanReviewTasks: Record<string, HumanReviewTask> = {}
  private scheduledPublications: Map<string, number> = new Map()

  // ═══════════════════════════════════════════════════════════════════════════
  // POST CRUD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new post with AI-powered SEO optimization
   */
  async createPost(content: PostContent): Promise<Post> {
    const id = `post-${Date.now()}`
    const slug = content.slug || this.generateSlug(content.title)
    const now = new Date().toISOString()

    // Generate SEO suggestions via Mark agent
    const seo = simulateMarkSEO(content.title)

    const post: Post = {
      id,
      title: content.title,
      slug,
      content: content.content,
      excerpt: content.excerpt || content.content.substring(0, 160) + '...',
      author: content.author,
      category: content.category || 'uncategorized',
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

    this.posts[id] = post

    // Save initial version
    this.versions[id] = [{
      id: `ver-${id}-1`,
      postId: id,
      version: 1,
      title: post.title,
      content: post.content,
      createdAt: now,
      createdBy: content.author,
    }]

    return post
  }

  /**
   * Get a post by ID
   */
  Post(id: string): Post | null {
    return this.posts[id] || null
  }

  /**
   * List all posts with optional filters
   */
  Posts(filters?: { status?: PostStatus; author?: string; category?: string }): Post[] {
    let results = Object.values(this.posts)

    if (filters?.status) {
      results = results.filter(p => p.status === filters.status)
    }
    if (filters?.author) {
      results = results.filter(p => p.author === filters.author)
    }
    if (filters?.category) {
      results = results.filter(p => p.category === filters.category)
    }

    return results.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  }

  /**
   * Update a post and create new version
   */
  async updatePost(id: string, updates: Partial<PostContent & { seo?: SEOData }>): Promise<Post | null> {
    const post = this.posts[id]
    if (!post) return null

    const now = new Date().toISOString()
    const newVersion = post.version + 1

    // Apply updates
    if (updates.title) post.title = updates.title
    if (updates.content) post.content = updates.content
    if (updates.excerpt) post.excerpt = updates.excerpt
    if (updates.category) post.category = updates.category
    if (updates.tags) post.tags = updates.tags
    if (updates.featuredImage) post.featuredImage = updates.featuredImage
    if (updates.seo) post.seo = updates.seo

    post.version = newVersion
    post.updatedAt = now

    // Save version history
    if (!this.versions[id]) this.versions[id] = []
    this.versions[id].push({
      id: `ver-${id}-${newVersion}`,
      postId: id,
      version: newVersion,
      title: post.title,
      content: post.content,
      createdAt: now,
      createdBy: updates.author || post.author,
    })

    // Re-generate SEO if title changed
    if (updates.title) {
      post.seo = simulateMarkSEO(updates.title)
    }

    return post
  }

  /**
   * Delete a post
   */
  async deletePost(id: string): Promise<boolean> {
    if (!this.posts[id]) return false
    delete this.posts[id]
    delete this.versions[id]
    return true
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTENT LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Submit post for editorial review
   */
  async submitForReview(postId: string): Promise<Post | null> {
    const post = this.posts[postId]
    if (!post) return null
    if (post.status !== 'draft') return null

    post.status = 'review'
    post.updatedAt = new Date().toISOString()

    // Emit event for notification handlers
    console.log(`[Event] Post.submitted: ${postId}`)

    return post
  }

  /**
   * Approve post for publication
   */
  async approvePost(postId: string, scheduledAt?: Date): Promise<Post | null> {
    const post = this.posts[postId]
    if (!post) return null
    if (post.status !== 'review') return null

    if (scheduledAt) {
      return this.schedulePost(postId, scheduledAt)
    } else {
      return this.doPublish(postId)
    }
  }

  /**
   * Schedule post for future publication
   */
  async schedulePost(postId: string, scheduledAt: Date): Promise<Post | null> {
    const post = this.posts[postId]
    if (!post) return null

    post.status = 'scheduled'
    post.scheduledAt = scheduledAt.toISOString()
    post.updatedAt = new Date().toISOString()

    // Schedule the publication (simulated)
    const delay = scheduledAt.getTime() - Date.now()
    if (delay > 0) {
      const timeoutId = setTimeout(() => this.doPublish(postId), delay) as unknown as number
      this.scheduledPublications.set(postId, timeoutId)
    }

    console.log(`[Schedule] Post ${postId} scheduled for ${scheduledAt.toISOString()}`)

    return post
  }

  /**
   * Reschedule a scheduled post
   */
  async reschedulePost(postId: string, newScheduledAt: Date): Promise<Post | null> {
    const post = this.posts[postId]
    if (!post || post.status !== 'scheduled') return null

    // Cancel existing schedule
    const existingTimeout = this.scheduledPublications.get(postId)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      this.scheduledPublications.delete(postId)
    }

    return this.schedulePost(postId, newScheduledAt)
  }

  /**
   * Publish a post immediately
   */
  async publish(postId: string, scheduledAt?: Date): Promise<Post | null> {
    if (scheduledAt) {
      return this.schedulePost(postId, scheduledAt)
    }
    return this.doPublish(postId)
  }

  /**
   * Internal: Execute publication
   */
  private async doPublish(postId: string): Promise<Post | null> {
    const post = this.posts[postId]
    if (!post) return null

    const now = new Date().toISOString()
    post.status = 'published'
    post.publishedAt = now
    post.updatedAt = now
    delete post.scheduledAt

    // Clear any pending schedule
    this.scheduledPublications.delete(postId)

    // Auto-share to social platforms via Mark agent
    const twitterContent = simulateMarkSocial(post.title, 'twitter')
    const linkedinContent = simulateMarkSocial(post.title, 'linkedin')

    console.log(`[Social] Twitter: ${twitterContent}`)
    console.log(`[Social] LinkedIn: ${linkedinContent}`)

    // Emit publication event
    console.log(`[Event] Post.published: ${postId}`)

    return post
  }

  /**
   * Archive a published post
   */
  async archivePost(postId: string): Promise<Post | null> {
    const post = this.posts[postId]
    if (!post) return null

    post.status = 'archived'
    post.updatedAt = new Date().toISOString()

    return post
  }

  /**
   * Restore a post to draft status
   */
  async restoreToDraft(postId: string): Promise<Post | null> {
    const post = this.posts[postId]
    if (!post) return null

    post.status = 'draft'
    post.updatedAt = new Date().toISOString()
    delete post.publishedAt
    delete post.scheduledAt

    return post
  }

  /**
   * Revert post to a previous version
   */
  async revertToVersion(postId: string, version: number): Promise<Post | null> {
    const post = this.posts[postId]
    const postVersions = this.versions[postId]
    if (!post || !postVersions) return null

    const targetVersion = postVersions.find(v => v.version === version)
    if (!targetVersion) return null

    const now = new Date().toISOString()
    post.title = targetVersion.title
    post.content = targetVersion.content
    post.version = post.version + 1
    post.updatedAt = now

    // Save the revert as a new version
    postVersions.push({
      id: `ver-${postId}-${post.version}`,
      postId,
      version: post.version,
      title: post.title,
      content: post.content,
      createdAt: now,
      createdBy: 'system-revert',
    })

    return post
  }

  /**
   * Get version history for a post
   */
  getVersionHistory(postId: string): PostVersion[] {
    return this.versions[postId] || []
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMMENTS AND MODERATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add a comment to a post with AI moderation
   */
  async addComment(postId: string, comment: { author: string; authorEmail: string; content: string; parentId?: string }): Promise<Comment> {
    const post = this.posts[postId]
    if (!post || post.status !== 'published') {
      throw new Error('Cannot comment on unpublished posts')
    }

    const id = `comment-${Date.now()}`
    const now = new Date().toISOString()

    // AI moderation via Quinn agent
    const moderation = simulateQuinnModerate(comment.content)

    const newComment: Comment = {
      id,
      postId,
      author: comment.author,
      authorEmail: comment.authorEmail,
      content: comment.content,
      status: moderation.safe ? 'pending' : 'flagged',
      moderationReason: moderation.reason,
      createdAt: now,
      parentId: comment.parentId,
    }

    this.comments[id] = newComment

    // If flagged, create human review task
    if (moderation.flagged) {
      await this.createHumanReview({
        type: 'comment',
        resourceId: id,
        reason: moderation.reason || 'AI flagged for review',
        sla: '4 hours',
      })
    }

    console.log(`[Event] Comment.created: ${id} (status: ${newComment.status})`)

    return newComment
  }

  /**
   * Get comments for a post
   */
  getComments(postId: string, includeAll = false): Comment[] {
    const postComments = Object.values(this.comments).filter(c => c.postId === postId)

    if (includeAll) {
      return postComments
    }

    // Only return approved comments by default
    return postComments.filter(c => c.status === 'approved')
  }

  /**
   * Approve a pending comment
   */
  async approveComment(commentId: string): Promise<Comment | null> {
    const comment = this.comments[commentId]
    if (!comment) return null

    comment.status = 'approved'
    return comment
  }

  /**
   * Reject a comment
   */
  async rejectComment(commentId: string, reason?: string): Promise<Comment | null> {
    const comment = this.comments[commentId]
    if (!comment) return null

    comment.status = 'rejected'
    if (reason) comment.moderationReason = reason
    return comment
  }

  /**
   * Get pending moderation queue
   */
  getModerationQueue(): Comment[] {
    return Object.values(this.comments)
      .filter(c => c.status === 'pending' || c.status === 'flagged')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HUMAN ESCALATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a human review task
   */
  async createHumanReview(task: { type: 'comment' | 'post' | 'author'; resourceId: string; reason: string; sla: string }): Promise<HumanReviewTask> {
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

    this.humanReviewTasks[id] = reviewTask
    console.log(`[Human] Review task created: ${id} - ${task.reason}`)

    return reviewTask
  }

  /**
   * Complete a human review task
   */
  async completeHumanReview(taskId: string, decision: 'approved' | 'rejected', reviewer: string): Promise<HumanReviewTask | null> {
    const task = this.humanReviewTasks[taskId]
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

    return task
  }

  /**
   * Get pending human review tasks
   */
  getHumanReviewQueue(): HumanReviewTask[] {
    return Object.values(this.humanReviewTasks)
      .filter(t => t.status === 'pending')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EDITORIAL CALENDAR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get editorial calendar for a month
   */
  getCalendar(yearMonth: string): CalendarEntry[] {
    // Parse year-month (e.g., "2024-01")
    const [year, month] = yearMonth.split('-').map(Number)
    const startDate = new Date(year, month - 1, 1)
    const endDate = new Date(year, month, 0)

    const entries: CalendarEntry[] = []

    for (let day = 1; day <= endDate.getDate(); day++) {
      const dateStr = `${yearMonth}-${String(day).padStart(2, '0')}`

      const postsForDay = Object.values(this.posts)
        .filter(p => {
          const postDate = p.scheduledAt || p.publishedAt
          return postDate && postDate.startsWith(dateStr)
        })
        .map(p => ({
          id: p.id,
          title: p.title,
          status: p.status,
          scheduledAt: p.scheduledAt,
          author: p.author,
        }))

      if (postsForDay.length > 0) {
        entries.push({ date: dateStr, posts: postsForDay })
      }
    }

    return entries
  }

  /**
   * Get upcoming scheduled posts
   */
  getUpcomingPosts(limit = 10): Post[] {
    const now = new Date().toISOString()

    return Object.values(this.posts)
      .filter(p => p.status === 'scheduled' && p.scheduledAt && p.scheduledAt > now)
      .sort((a, b) => (a.scheduledAt || '').localeCompare(b.scheduledAt || ''))
      .slice(0, limit)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ANALYTICS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Track a page view
   */
  async trackView(postId: string): Promise<void> {
    const post = this.posts[postId]
    if (post) {
      post.views++
    }
  }

  /**
   * Track a share
   */
  async trackShare(postId: string): Promise<void> {
    const post = this.posts[postId]
    if (post) {
      post.shares++
    }
  }

  /**
   * Get analytics for a post
   */
  getAnalytics(postId: string): AnalyticsData | null {
    const post = this.posts[postId]
    if (!post) return null

    const comments = this.getComments(postId)

    return {
      postId,
      views: post.views,
      uniqueViews: Math.floor(post.views * 0.7), // Simulated unique views
      shares: post.shares,
      comments: comments.length,
      avgTimeOnPage: 180 + Math.random() * 120, // Simulated: 3-5 minutes
      bounceRate: 0.3 + Math.random() * 0.2, // Simulated: 30-50%
      topReferrers: [
        { source: 'twitter.com', count: Math.floor(post.views * 0.3) },
        { source: 'linkedin.com', count: Math.floor(post.views * 0.2) },
        { source: 'google.com', count: Math.floor(post.views * 0.25) },
        { source: 'direct', count: Math.floor(post.views * 0.15) },
        { source: 'other', count: Math.floor(post.views * 0.1) },
      ],
    }
  }

  /**
   * Get overall dashboard stats
   */
  getStats(): {
    totalPosts: number
    published: number
    drafts: number
    scheduled: number
    inReview: number
    totalViews: number
    totalShares: number
    pendingComments: number
    pendingReviews: number
  } {
    const posts = Object.values(this.posts)
    const comments = Object.values(this.comments)

    return {
      totalPosts: posts.length,
      published: posts.filter(p => p.status === 'published').length,
      drafts: posts.filter(p => p.status === 'draft').length,
      scheduled: posts.filter(p => p.status === 'scheduled').length,
      inReview: posts.filter(p => p.status === 'review').length,
      totalViews: posts.reduce((sum, p) => sum + p.views, 0),
      totalShares: posts.reduce((sum, p) => sum + p.shares, 0),
      pendingComments: comments.filter(c => c.status === 'pending').length,
      pendingReviews: Object.values(this.humanReviewTasks).filter(t => t.status === 'pending').length,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTHORS AND CATEGORIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get an author by ID
   */
  Author(id: string): Author | null {
    return DEMO_AUTHORS[id] || null
  }

  /**
   * List all authors
   */
  Authors(): Author[] {
    return Object.values(DEMO_AUTHORS)
  }

  /**
   * Get a category by ID
   */
  Category(id: string): Category | null {
    return DEMO_CATEGORIES[id] || null
  }

  /**
   * List all categories
   */
  Categories(): Category[] {
    return Object.values(DEMO_CATEGORIES)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SOCIAL SHARING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate social content for a post
   */
  async generateSocialContent(postId: string, platform: 'twitter' | 'linkedin' | 'newsletter'): Promise<string> {
    const post = this.posts[postId]
    if (!post) throw new Error('Post not found')

    return simulateMarkSocial(post.title, platform)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate URL-friendly slug from title
   */
  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Handle RPC endpoint
    if (url.pathname === '/rpc' && request.method === 'POST') {
      try {
        const body = await request.json() as {
          jsonrpc: string
          id: number
          method: string
          params?: unknown[]
        }
        const { method, params = [], id } = body

        // Call the method on this DO
        const methodFn = (this as unknown as Record<string, (...args: unknown[]) => unknown>)[method]
        if (typeof methodFn !== 'function') {
          return Response.json(
            {
              jsonrpc: '2.0',
              id,
              error: { code: -32601, message: `Method '${method}' not found` },
            },
            { status: 400 }
          )
        }

        const result = await methodFn.apply(this, params)
        return Response.json({ jsonrpc: '2.0', id, result })
      } catch (error) {
        return Response.json(
          {
            jsonrpc: '2.0',
            id: 0,
            error: { code: -32603, message: String(error) },
          },
          { status: 500 }
        )
      }
    }

    return new Response('Not Found', { status: 404 })
  }
}

export default PublishingDO
