/**
 * Social Feed Algorithm - Edge-Native Personalized Ranking
 *
 * Each user gets their own Durable Object running personalized feed ranking.
 * No centralized ML infrastructure. Ranking happens at the edge with ~15ms latency.
 *
 * Features:
 * - Engagement signals (likes, shares, dwell time)
 * - Content freshness decay
 * - Social graph influence
 * - Interest vector matching
 * - Feed caching per user
 * - Real-time WebSocket updates
 * - A/B testing different algorithms
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { DurableObject } from 'cloudflare:workers'

// ============================================================================
// TYPES
// ============================================================================

interface ContentItem {
  id: string
  authorId: string
  content: string
  mediaType?: 'text' | 'image' | 'video'
  createdAt: number // timestamp
  baseScore: number // quality/relevance baseline
  contentVector: number[] // embedding for interest matching
}

interface EngagementSignal {
  itemId: string
  action: 'view' | 'like' | 'share' | 'comment' | 'save'
  dwellTime?: number // ms spent viewing
  timestamp: number
}

interface ScoredItem extends ContentItem {
  score: number
  scoreBreakdown: {
    freshness: number
    engagement: number
    social: number
    interest: number
  }
}

interface FeedParams {
  limit?: number
  offset?: number
  refresh?: boolean
  variant?: string
}

interface AlgorithmVariant {
  name: string
  freshnessWeight: number
  engagementWeight: number
  socialWeight: number
  interestWeight: number
  freshnessHalfLife: number // hours
}

// ============================================================================
// ALGORITHM VARIANTS FOR A/B TESTING
// ============================================================================

const ALGORITHM_VARIANTS: Record<string, AlgorithmVariant> = {
  control: {
    name: 'control',
    freshnessWeight: 0.30,
    engagementWeight: 0.25,
    socialWeight: 0.25,
    interestWeight: 0.20,
    freshnessHalfLife: 12,
  },
  high_social: {
    name: 'high_social',
    freshnessWeight: 0.20,
    engagementWeight: 0.20,
    socialWeight: 0.40,
    interestWeight: 0.20,
    freshnessHalfLife: 12,
  },
  chronological: {
    name: 'chronological',
    freshnessWeight: 1.0,
    engagementWeight: 0.0,
    socialWeight: 0.0,
    interestWeight: 0.0,
    freshnessHalfLife: 24,
  },
  engagement_first: {
    name: 'engagement_first',
    freshnessWeight: 0.15,
    engagementWeight: 0.45,
    socialWeight: 0.20,
    interestWeight: 0.20,
    freshnessHalfLife: 18,
  },
  discovery: {
    name: 'discovery',
    freshnessWeight: 0.20,
    engagementWeight: 0.15,
    socialWeight: 0.15,
    interestWeight: 0.50,
    freshnessHalfLife: 24,
  },
}

// ============================================================================
// RANKING ALGORITHMS
// ============================================================================

/**
 * Calculate freshness decay using exponential decay
 * Score decays to 0.5 after halfLife hours
 */
function freshnessDecay(ageMs: number, halfLifeHours: number): number {
  const halfLifeMs = halfLifeHours * 60 * 60 * 1000
  return Math.pow(0.5, ageMs / halfLifeMs)
}

/**
 * Calculate engagement boost from aggregated signals
 */
function engagementBoost(stats: { likes: number; shares: number; comments: number; views: number }): number {
  // Weighted engagement score, normalized
  const rawScore = stats.likes * 1.0 + stats.shares * 2.5 + stats.comments * 1.5 + stats.views * 0.1
  // Logarithmic scaling to prevent viral content from dominating
  return Math.log10(1 + rawScore) / 5
}

/**
 * Calculate social graph influence
 * Higher score if friends have engaged with content
 */
function socialBoost(
  friendEngagements: Array<{ friendId: string; closeness: number; action: string }>,
): number {
  if (friendEngagements.length === 0) return 0

  let score = 0
  for (const eng of friendEngagements) {
    const actionWeight = eng.action === 'share' ? 1.0 : eng.action === 'like' ? 0.5 : 0.3
    score += eng.closeness * actionWeight
  }
  // Normalize to 0-1 range
  return Math.min(1, score / 3)
}

/**
 * Calculate interest match using cosine similarity
 */
function interestMatch(userVector: number[], contentVector: number[]): number {
  if (userVector.length !== contentVector.length || userVector.length === 0) return 0.5

  let dotProduct = 0
  let userMag = 0
  let contentMag = 0

  for (let i = 0; i < userVector.length; i++) {
    dotProduct += userVector[i] * contentVector[i]
    userMag += userVector[i] * userVector[i]
    contentMag += contentVector[i] * contentVector[i]
  }

  const magnitude = Math.sqrt(userMag) * Math.sqrt(contentMag)
  if (magnitude === 0) return 0.5

  // Cosine similarity is -1 to 1, normalize to 0 to 1
  return (dotProduct / magnitude + 1) / 2
}

/**
 * Apply diversity penalty for recently shown content types/authors
 */
function diversityPenalty(
  item: ContentItem,
  recentItems: ContentItem[],
  windowSize: number = 5,
): number {
  const recent = recentItems.slice(0, windowSize)
  let penalty = 1.0

  // Penalize same author in recent items
  const sameAuthorCount = recent.filter((r) => r.authorId === item.authorId).length
  penalty *= Math.pow(0.8, sameAuthorCount)

  // Penalize same media type in recent items
  const sameTypeCount = recent.filter((r) => r.mediaType === item.mediaType).length
  penalty *= Math.pow(0.9, sameTypeCount)

  return penalty
}

// ============================================================================
// FEED DURABLE OBJECT
// ============================================================================

interface Env {
  FEED_DO: DurableObjectNamespace
  ENVIRONMENT?: string
  FRESHNESS_WEIGHT?: string
  ENGAGEMENT_WEIGHT?: string
  SOCIAL_WEIGHT?: string
  INTEREST_WEIGHT?: string
  FEED_CACHE_TTL?: string
  FRESHNESS_HALF_LIFE?: string
}

export class FeedDO extends DurableObject<Env> {
  private sql: SqlStorage
  private userId: string = ''
  private interestVector: number[] = []
  private algorithmVariant: string = 'control'
  private cachedFeed: ScoredItem[] | null = null
  private cacheExpiry: number = 0
  private webSockets: Set<WebSocket> = new Set()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql

    // Initialize database schema
    this.initSchema()
  }

  private initSchema(): void {
    // Engagement signals table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS engagement_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT NOT NULL,
        action TEXT NOT NULL,
        dwell_time INTEGER,
        timestamp INTEGER NOT NULL,
        created_at INTEGER DEFAULT (unixepoch() * 1000)
      )
    `)

    // User interest vector table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS user_interests (
        dimension INTEGER PRIMARY KEY,
        value REAL NOT NULL,
        updated_at INTEGER DEFAULT (unixepoch() * 1000)
      )
    `)

    // Social graph cache table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS social_graph (
        friend_id TEXT PRIMARY KEY,
        closeness REAL NOT NULL,
        updated_at INTEGER DEFAULT (unixepoch() * 1000)
      )
    `)

    // Content engagement stats cache table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS content_stats (
        item_id TEXT PRIMARY KEY,
        likes INTEGER DEFAULT 0,
        shares INTEGER DEFAULT 0,
        comments INTEGER DEFAULT 0,
        views INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT (unixepoch() * 1000)
      )
    `)

    // A/B test assignment table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS ab_assignment (
        key TEXT PRIMARY KEY,
        variant TEXT NOT NULL,
        assigned_at INTEGER DEFAULT (unixepoch() * 1000)
      )
    `)

    // Create indexes
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_engagement_item ON engagement_signals(item_id);
      CREATE INDEX IF NOT EXISTS idx_engagement_timestamp ON engagement_signals(timestamp);
    `)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get personalized feed for this user
   */
  async getFeed(params: FeedParams = {}): Promise<ScoredItem[]> {
    const { limit = 20, offset = 0, refresh = false, variant } = params
    const now = Date.now()

    // Check cache unless refresh requested
    if (!refresh && this.cachedFeed && now < this.cacheExpiry) {
      return this.cachedFeed.slice(offset, offset + limit)
    }

    // Get algorithm variant
    const algo = ALGORITHM_VARIANTS[variant || this.algorithmVariant] || ALGORITHM_VARIANTS.control

    // Load user's interest vector
    await this.loadInterestVector()

    // Get candidate content (in real app, this would query a content service)
    const candidates = this.getCandidateContent()

    // Score all candidates
    const scored = await this.scoreContent(candidates, algo)

    // Apply diversity re-ranking
    const diversified = this.applyDiversityRanking(scored)

    // Cache the result
    const cacheTtl = parseInt(this.env.FEED_CACHE_TTL || '300') * 1000
    this.cachedFeed = diversified
    this.cacheExpiry = now + cacheTtl

    return diversified.slice(offset, offset + limit)
  }

  /**
   * Record user engagement signal
   */
  async recordEngagement(signal: EngagementSignal): Promise<void> {
    this.sql.exec(
      `INSERT INTO engagement_signals (item_id, action, dwell_time, timestamp)
       VALUES (?, ?, ?, ?)`,
      signal.itemId,
      signal.action,
      signal.dwellTime || null,
      signal.timestamp,
    )

    // Update content stats cache
    this.sql.exec(
      `INSERT INTO content_stats (item_id, ${signal.action === 'view' ? 'views' : signal.action + 's'})
       VALUES (?, 1)
       ON CONFLICT(item_id) DO UPDATE SET
         ${signal.action === 'view' ? 'views = views + 1' : signal.action + 's = ' + signal.action + 's + 1'},
         updated_at = unixepoch() * 1000`,
      signal.itemId,
    )

    // Update interest vector based on engagement
    await this.updateInterestVector(signal)

    // Invalidate cache
    this.cachedFeed = null

    // Notify WebSocket clients
    this.broadcastUpdate({
      type: 'engagement_recorded',
      signal,
    })
  }

  /**
   * Update user's interest vector
   */
  async updateInterests(vector: number[]): Promise<void> {
    const now = Date.now()

    // Clear existing interests
    this.sql.exec('DELETE FROM user_interests')

    // Insert new interest vector
    for (let i = 0; i < vector.length; i++) {
      this.sql.exec(
        'INSERT INTO user_interests (dimension, value, updated_at) VALUES (?, ?, ?)',
        i,
        vector[i],
        now,
      )
    }

    this.interestVector = vector
    this.cachedFeed = null
  }

  /**
   * Update social graph for this user
   */
  async updateSocialGraph(friends: Array<{ friendId: string; closeness: number }>): Promise<void> {
    const now = Date.now()

    for (const friend of friends) {
      this.sql.exec(
        `INSERT INTO social_graph (friend_id, closeness, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(friend_id) DO UPDATE SET
           closeness = excluded.closeness,
           updated_at = excluded.updated_at`,
        friend.friendId,
        friend.closeness,
        now,
      )
    }

    this.cachedFeed = null
  }

  /**
   * Get assigned A/B test variant
   */
  getVariant(): string {
    const rows = this.sql.exec('SELECT variant FROM ab_assignment WHERE key = ?', 'algorithm').toArray()

    if (rows.length > 0) {
      this.algorithmVariant = rows[0].variant as string
      return this.algorithmVariant
    }

    // Assign to a variant randomly
    const variants = Object.keys(ALGORITHM_VARIANTS)
    const assigned = variants[Math.floor(Math.random() * variants.length)]

    this.sql.exec(
      'INSERT INTO ab_assignment (key, variant) VALUES (?, ?)',
      'algorithm',
      assigned,
    )

    this.algorithmVariant = assigned
    return assigned
  }

  /**
   * Force set A/B variant (for testing)
   */
  setVariant(variant: string): void {
    if (!ALGORITHM_VARIANTS[variant]) {
      throw new Error(`Unknown variant: ${variant}`)
    }

    this.sql.exec(
      `INSERT INTO ab_assignment (key, variant)
       VALUES ('algorithm', ?)
       ON CONFLICT(key) DO UPDATE SET variant = excluded.variant`,
      variant,
    )

    this.algorithmVariant = variant
    this.cachedFeed = null
  }

  /**
   * Get engagement analytics for this user
   */
  getAnalytics(): {
    totalEngagements: number
    engagementsByAction: Record<string, number>
    avgDwellTime: number
    topInterests: number[]
  } {
    const total = this.sql.exec('SELECT COUNT(*) as count FROM engagement_signals').one()
    const byAction = this.sql
      .exec('SELECT action, COUNT(*) as count FROM engagement_signals GROUP BY action')
      .toArray()
    const avgDwell = this.sql
      .exec('SELECT AVG(dwell_time) as avg FROM engagement_signals WHERE dwell_time IS NOT NULL')
      .one()

    return {
      totalEngagements: (total?.count as number) || 0,
      engagementsByAction: Object.fromEntries(byAction.map((r) => [r.action, r.count])),
      avgDwellTime: (avgDwell?.avg as number) || 0,
      topInterests: this.interestVector.slice(0, 5),
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  private async loadInterestVector(): Promise<void> {
    const rows = this.sql.exec('SELECT dimension, value FROM user_interests ORDER BY dimension').toArray()

    if (rows.length > 0) {
      this.interestVector = rows.map((r) => r.value as number)
    } else {
      // Initialize with neutral interests
      this.interestVector = new Array(64).fill(0.5)
    }
  }

  private async updateInterestVector(signal: EngagementSignal): Promise<void> {
    // In a real system, this would update the vector based on content embeddings
    // For demo, we simulate interest drift based on engagement type
    const learningRate = signal.action === 'like' ? 0.1 : signal.action === 'share' ? 0.15 : 0.05

    // Simulate content vector (would come from content service)
    const contentVector = this.getContentVector(signal.itemId)

    for (let i = 0; i < this.interestVector.length; i++) {
      const delta = (contentVector[i] - this.interestVector[i]) * learningRate
      this.interestVector[i] = Math.max(0, Math.min(1, this.interestVector[i] + delta))
    }

    // Persist updated vector
    const now = Date.now()
    for (let i = 0; i < this.interestVector.length; i++) {
      this.sql.exec(
        `INSERT INTO user_interests (dimension, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(dimension) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
        i,
        this.interestVector[i],
        now,
      )
    }
  }

  private async scoreContent(items: ContentItem[], algo: AlgorithmVariant): Promise<ScoredItem[]> {
    const now = Date.now()
    const scored: ScoredItem[] = []

    for (const item of items) {
      const ageMs = now - item.createdAt

      // Calculate each scoring component
      const freshnessScore = freshnessDecay(ageMs, algo.freshnessHalfLife) * item.baseScore
      const engagementScore = engagementBoost(this.getContentStats(item.id))
      const socialScore = socialBoost(this.getFriendEngagements(item.id))
      const interestScore = interestMatch(this.interestVector, item.contentVector)

      // Weighted combination
      const score =
        freshnessScore * algo.freshnessWeight +
        engagementScore * algo.engagementWeight +
        socialScore * algo.socialWeight +
        interestScore * algo.interestWeight

      scored.push({
        ...item,
        score,
        scoreBreakdown: {
          freshness: freshnessScore * algo.freshnessWeight,
          engagement: engagementScore * algo.engagementWeight,
          social: socialScore * algo.socialWeight,
          interest: interestScore * algo.interestWeight,
        },
      })
    }

    // Sort by score descending
    return scored.sort((a, b) => b.score - a.score)
  }

  private applyDiversityRanking(items: ScoredItem[]): ScoredItem[] {
    const result: ScoredItem[] = []
    const remaining = [...items]

    while (remaining.length > 0 && result.length < items.length) {
      // Find best item considering diversity
      let bestIdx = 0
      let bestScore = -Infinity

      for (let i = 0; i < remaining.length; i++) {
        const penalty = diversityPenalty(remaining[i], result)
        const adjustedScore = remaining[i].score * penalty

        if (adjustedScore > bestScore) {
          bestScore = adjustedScore
          bestIdx = i
        }
      }

      result.push(remaining[bestIdx])
      remaining.splice(bestIdx, 1)
    }

    return result
  }

  private getContentStats(itemId: string): { likes: number; shares: number; comments: number; views: number } {
    const row = this.sql.exec('SELECT * FROM content_stats WHERE item_id = ?', itemId).one()

    if (row) {
      return {
        likes: (row.likes as number) || 0,
        shares: (row.shares as number) || 0,
        comments: (row.comments as number) || 0,
        views: (row.views as number) || 0,
      }
    }

    // Return demo stats for sample content
    return {
      likes: Math.floor(Math.random() * 1000),
      shares: Math.floor(Math.random() * 100),
      comments: Math.floor(Math.random() * 200),
      views: Math.floor(Math.random() * 10000),
    }
  }

  private getFriendEngagements(itemId: string): Array<{ friendId: string; closeness: number; action: string }> {
    // In real app, this would query friend engagement data
    // For demo, return simulated data
    const friends = this.sql.exec('SELECT friend_id, closeness FROM social_graph LIMIT 10').toArray()

    return friends
      .filter(() => Math.random() > 0.7) // 30% chance a friend engaged
      .map((f) => ({
        friendId: f.friend_id as string,
        closeness: f.closeness as number,
        action: Math.random() > 0.5 ? 'like' : 'share',
      }))
  }

  private getContentVector(itemId: string): number[] {
    // In real app, this would fetch from content embedding service
    // For demo, generate deterministic pseudo-random vector based on itemId
    const seed = itemId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
    const vector: number[] = []
    for (let i = 0; i < 64; i++) {
      vector.push(Math.abs(Math.sin(seed * (i + 1))) * 0.5 + 0.25)
    }
    return vector
  }

  private getCandidateContent(): ContentItem[] {
    // In real app, this would query content candidates from a content service
    // For demo, return sample content
    const now = Date.now()
    const hour = 60 * 60 * 1000

    return [
      {
        id: 'post-001',
        authorId: 'user-alice',
        content: 'Just shipped a new feature! Check it out.',
        mediaType: 'text',
        createdAt: now - 2 * hour,
        baseScore: 0.8,
        contentVector: this.getContentVector('post-001'),
      },
      {
        id: 'post-002',
        authorId: 'user-bob',
        content: 'Amazing sunset from my hike today',
        mediaType: 'image',
        createdAt: now - 4 * hour,
        baseScore: 0.7,
        contentVector: this.getContentVector('post-002'),
      },
      {
        id: 'post-003',
        authorId: 'user-charlie',
        content: 'Tutorial: Building edge-native apps with Durable Objects',
        mediaType: 'video',
        createdAt: now - 8 * hour,
        baseScore: 0.9,
        contentVector: this.getContentVector('post-003'),
      },
      {
        id: 'post-004',
        authorId: 'user-dana',
        content: 'Hot take: Serverless is the future of computing',
        mediaType: 'text',
        createdAt: now - 1 * hour,
        baseScore: 0.6,
        contentVector: this.getContentVector('post-004'),
      },
      {
        id: 'post-005',
        authorId: 'user-eve',
        content: 'New blog post on distributed systems patterns',
        mediaType: 'text',
        createdAt: now - 12 * hour,
        baseScore: 0.85,
        contentVector: this.getContentVector('post-005'),
      },
      {
        id: 'post-006',
        authorId: 'user-alice',
        content: 'Team outing photos from last week',
        mediaType: 'image',
        createdAt: now - 24 * hour,
        baseScore: 0.5,
        contentVector: this.getContentVector('post-006'),
      },
      {
        id: 'post-007',
        authorId: 'user-frank',
        content: 'Announcing our Series A!',
        mediaType: 'text',
        createdAt: now - 0.5 * hour,
        baseScore: 0.95,
        contentVector: this.getContentVector('post-007'),
      },
      {
        id: 'post-008',
        authorId: 'user-grace',
        content: 'Live coding session starting in 10 minutes',
        mediaType: 'video',
        createdAt: now - 0.2 * hour,
        baseScore: 0.75,
        contentVector: this.getContentVector('post-008'),
      },
    ]
  }

  private broadcastUpdate(data: unknown): void {
    const message = JSON.stringify(data)
    for (const ws of this.webSockets) {
      try {
        ws.send(message)
      } catch {
        this.webSockets.delete(ws)
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)

      this.ctx.acceptWebSocket(server)
      this.webSockets.add(server)

      // Send initial feed on connect
      const feed = await this.getFeed({ limit: 10 })
      server.send(JSON.stringify({ type: 'initial_feed', items: feed }))

      return new Response(null, { status: 101, webSocket: client })
    }

    // REST API endpoints
    if (url.pathname === '/feed' && request.method === 'GET') {
      const params: FeedParams = {
        limit: parseInt(url.searchParams.get('limit') || '20'),
        offset: parseInt(url.searchParams.get('offset') || '0'),
        refresh: url.searchParams.get('refresh') === 'true',
        variant: url.searchParams.get('variant') || undefined,
      }
      const feed = await this.getFeed(params)
      return Response.json(feed)
    }

    if (url.pathname === '/feed/refresh' && request.method === 'POST') {
      const feed = await this.getFeed({ refresh: true })
      return Response.json(feed)
    }

    if (url.pathname === '/signals' && request.method === 'POST') {
      const signal = (await request.json()) as EngagementSignal
      await this.recordEngagement({ ...signal, timestamp: signal.timestamp || Date.now() })
      return Response.json({ success: true })
    }

    if (url.pathname === '/interests' && request.method === 'PUT') {
      const { vector } = (await request.json()) as { vector: number[] }
      await this.updateInterests(vector)
      return Response.json({ success: true })
    }

    if (url.pathname === '/social' && request.method === 'PUT') {
      const { friends } = (await request.json()) as { friends: Array<{ friendId: string; closeness: number }> }
      await this.updateSocialGraph(friends)
      return Response.json({ success: true })
    }

    if (url.pathname === '/variant' && request.method === 'GET') {
      return Response.json({ variant: this.getVariant() })
    }

    if (url.pathname === '/variant' && request.method === 'PUT') {
      const { variant } = (await request.json()) as { variant: string }
      this.setVariant(variant)
      return Response.json({ success: true, variant })
    }

    if (url.pathname === '/analytics' && request.method === 'GET') {
      return Response.json(this.getAnalytics())
    }

    return new Response('Not Found', { status: 404 })
  }

  webSocketClose(ws: WebSocket): void {
    this.webSockets.delete(ws)
  }

  webSocketError(ws: WebSocket): void {
    this.webSockets.delete(ws)
  }
}

// ============================================================================
// HONO APP
// ============================================================================

const app = new Hono<{ Bindings: Env }>()

// Enable CORS
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Landing page
app.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Social Feed Algorithm - Edge-Native Ranking</title>
  <style>
    :root { --bg: #0a0a0a; --fg: #fafafa; --accent: #10b981; --muted: #71717a; }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 2rem; line-height: 1.6; }
    h1 { color: var(--accent); margin-bottom: 0.5rem; }
    .tagline { font-size: 1.25rem; color: var(--muted); margin-bottom: 2rem; }
    code { background: #1f1f1f; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9rem; }
    pre { background: #1f1f1f; padding: 1rem; border-radius: 8px; overflow-x: auto; }
    .endpoints { display: grid; gap: 1rem; margin: 2rem 0; }
    .endpoint { background: #1f1f1f; padding: 1rem; border-radius: 8px; border-left: 3px solid var(--accent); }
    .endpoint h3 { margin: 0 0 0.5rem 0; color: var(--accent); }
    .endpoint p { margin: 0; color: var(--muted); }
    a { color: var(--accent); }
    .try-it { display: inline-block; margin-top: 0.5rem; padding: 0.25rem 0.5rem; background: var(--accent); color: white; text-decoration: none; border-radius: 4px; font-size: 0.875rem; }
  </style>
</head>
<body>
  <h1>Social Feed Algorithm</h1>
  <p class="tagline">Your algorithm. Your data. Edge-native.</p>

  <p>Personalized content ranking running at the edge with ~15ms latency. Each user gets their own Durable Object for private, fast feed generation.</p>

  <h2>Try It</h2>
  <div class="endpoints">
    <div class="endpoint">
      <h3>GET /feed/:userId</h3>
      <p>Get personalized feed for a user</p>
      <a href="/feed/demo-user" class="try-it">Try: /feed/demo-user</a>
    </div>

    <div class="endpoint">
      <h3>GET /feed/:userId/analytics</h3>
      <p>View user engagement analytics</p>
      <a href="/feed/demo-user/analytics" class="try-it">Try: /feed/demo-user/analytics</a>
    </div>

    <div class="endpoint">
      <h3>GET /feed/:userId/variant</h3>
      <p>Get A/B test assignment</p>
      <a href="/feed/demo-user/variant" class="try-it">Try: /feed/demo-user/variant</a>
    </div>

    <div class="endpoint">
      <h3>POST /feed/:userId/signals</h3>
      <p>Record engagement (like, share, view)</p>
      <code>curl -X POST -d '{"itemId":"post-001","action":"like"}' /feed/demo-user/signals</code>
    </div>

    <div class="endpoint">
      <h3>WebSocket /ws/:userId</h3>
      <p>Real-time feed updates</p>
      <code>new WebSocket('wss://host/ws/demo-user')</code>
    </div>
  </div>

  <h2>Algorithm Variants</h2>
  <p>A/B test different ranking approaches:</p>
  <ul>
    <li><strong>control</strong> - Balanced weights across all factors</li>
    <li><strong>high_social</strong> - Prioritize friends' engagement</li>
    <li><strong>chronological</strong> - Pure time-based ranking</li>
    <li><strong>engagement_first</strong> - Favor viral content</li>
    <li><strong>discovery</strong> - Emphasize interest matching</li>
  </ul>

  <footer style="margin-top: 3rem; color: var(--muted); border-top: 1px solid #333; padding-top: 1rem;">
    <p>Powered by <a href="https://dotdo.dev">dotdo</a> - Build your 1-Person Unicorn</p>
  </footer>
</body>
</html>
  `)
})

// Helper to get user's Feed DO
function getFeedDO(c: { env: Env }, userId: string): DurableObjectStub {
  const id = c.env.FEED_DO.idFromName(userId)
  return c.env.FEED_DO.get(id)
}

// Feed routes
app.get('/feed/:userId', async (c) => {
  const userId = c.req.param('userId')
  const stub = getFeedDO(c, userId)

  const url = new URL(c.req.url)
  return stub.fetch(`https://feed.internal/feed?${url.searchParams.toString()}`)
})

app.post('/feed/:userId/refresh', async (c) => {
  const userId = c.req.param('userId')
  const stub = getFeedDO(c, userId)
  return stub.fetch('https://feed.internal/feed/refresh', { method: 'POST' })
})

app.post('/feed/:userId/signals', async (c) => {
  const userId = c.req.param('userId')
  const stub = getFeedDO(c, userId)
  return stub.fetch('https://feed.internal/signals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await c.req.text(),
  })
})

app.put('/feed/:userId/interests', async (c) => {
  const userId = c.req.param('userId')
  const stub = getFeedDO(c, userId)
  return stub.fetch('https://feed.internal/interests', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: await c.req.text(),
  })
})

app.put('/feed/:userId/social', async (c) => {
  const userId = c.req.param('userId')
  const stub = getFeedDO(c, userId)
  return stub.fetch('https://feed.internal/social', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: await c.req.text(),
  })
})

app.get('/feed/:userId/variant', async (c) => {
  const userId = c.req.param('userId')
  const stub = getFeedDO(c, userId)
  return stub.fetch('https://feed.internal/variant')
})

app.put('/feed/:userId/variant', async (c) => {
  const userId = c.req.param('userId')
  const stub = getFeedDO(c, userId)
  return stub.fetch('https://feed.internal/variant', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: await c.req.text(),
  })
})

app.get('/feed/:userId/analytics', async (c) => {
  const userId = c.req.param('userId')
  const stub = getFeedDO(c, userId)
  return stub.fetch('https://feed.internal/analytics')
})

// WebSocket upgrade
app.get('/ws/:userId', async (c) => {
  const userId = c.req.param('userId')
  const stub = getFeedDO(c, userId)
  return stub.fetch(c.req.raw)
})

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'social-feed-algorithm' })
})

export default app
