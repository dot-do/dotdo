/**
 * Analytics Context API for $.analytics namespace
 *
 * Provides a workflow context API for web, product, and financial analytics:
 * - $.analytics.web      - Traffic metrics (sessions, pageviews, bounceRate)
 * - $.analytics.product  - Usage metrics (DAU, MAU, featureUsage)
 * - $.analytics.financial - Revenue metrics (revenue, costs, margins)
 *
 * Each namespace provides:
 * - Typed metric properties
 * - Async access via await
 * - Historical data via .trend(period)
 * - Comparison via .compare(baseline)
 *
 * @module workflows/context/analytics
 */

// ============================================================================
// TYPE DEFINITIONS - Web Analytics
// ============================================================================

/**
 * Web traffic metrics
 */
export interface WebMetrics {
  /** Total number of sessions */
  sessions: number
  /** Total number of page views */
  pageviews: number
  /** Bounce rate as percentage (0-100) */
  bounceRate: number
  /** Number of unique visitors */
  uniqueVisitors: number
  /** Average session duration in seconds */
  avgSessionDuration: number
  /** Average pages viewed per session */
  pagesPerSession: number
}

/**
 * Session recording data
 */
export interface SessionData {
  visitorId: string
  duration: number
  pageviews: number
  bounced: boolean
}

/**
 * Pageview recording data
 */
export interface PageviewData {
  path: string
  visitorId: string
  timestamp?: Date
}

/**
 * Metric comparison result
 */
export interface MetricComparison {
  current: number
  previous: number
  change: number
  percentChange: number
}

/**
 * Web metrics comparison
 */
export interface WebMetricsComparison {
  sessions: MetricComparison
  pageviews: MetricComparison
  bounceRate: MetricComparison
  uniqueVisitors: MetricComparison
}

// ============================================================================
// TYPE DEFINITIONS - Product Analytics
// ============================================================================

/**
 * Product usage metrics
 */
export interface ProductMetrics {
  /** Daily Active Users */
  dau: number
  /** Monthly Active Users */
  mau: number
  /** DAU/MAU ratio (stickiness) */
  stickiness: number
  /** Feature usage counts */
  featureUsage: Record<string, number>
  /** User retention rate (percentage) */
  retentionRate: number
  /** User activation rate (percentage) */
  activationRate: number
}

/**
 * User activity data
 */
export interface ActivityData {
  userId: string
  action: string
  timestamp?: Date
}

/**
 * Feature usage data
 */
export interface FeatureData {
  userId: string
  feature: string
  timestamp?: Date
}

// ============================================================================
// TYPE DEFINITIONS - Financial Analytics
// ============================================================================

/**
 * Financial metrics
 */
export interface FinancialMetrics {
  /** Monthly Recurring Revenue */
  mrr: number
  /** Annual Recurring Revenue */
  arr: number
  /** Total revenue */
  revenue: number
  /** Total costs */
  costs: number
  /** Gross margin percentage */
  grossMargin: number
  /** Net margin percentage */
  netMargin: number
  /** Customer Lifetime Value */
  ltv: number
  /** Customer Acquisition Cost */
  cac: number
  /** LTV/CAC ratio */
  ltvCacRatio: number
  /** Runway in months */
  runway: number
  /** Monthly burn rate */
  burnRate: number
}

/**
 * Revenue recording data
 */
export interface RevenueData {
  amount: number
  source: string
  customerId: string
  timestamp?: Date
}

/**
 * Cost recording data
 */
export interface CostData {
  amount: number
  category: string
  timestamp?: Date
}

/**
 * Subscription recording data
 */
export interface SubscriptionData {
  customerId: string
  plan: string
  amount: number
  interval: 'monthly' | 'yearly'
}

/**
 * Target comparison result
 */
export interface TargetComparison {
  current: number
  target: number
  gap: number
  onTrack: boolean
}

/**
 * Financial metrics target comparison
 */
export interface FinancialTargetComparison {
  mrr?: TargetComparison
  revenue?: TargetComparison
  [key: string]: TargetComparison | undefined
}

// ============================================================================
// TYPE DEFINITIONS - Common
// ============================================================================

/**
 * Time series data point
 */
export interface MetricTrend {
  date: Date
  value: number
}

/**
 * Trend period types
 */
export type TrendPeriod = 'day' | 'week' | 'month'

/**
 * Analytics summary for dashboard
 */
export interface AnalyticsSummary {
  sessions: number
  dau: number
  mrr: number
  runway: number
}

/**
 * All analytics combined
 */
export interface AllAnalytics {
  web: WebMetrics
  product: ProductMetrics
  financial: FinancialMetrics
}

// ============================================================================
// TYPE DEFINITIONS - Storage
// ============================================================================

/**
 * Web analytics storage
 */
export interface WebStorage {
  sessions: number
  pageviews: number
  bouncedSessions: number
  uniqueVisitors: Set<string>
  totalSessionDuration: number
  sessionData: SessionData[]
}

/**
 * Product analytics storage
 */
export interface ProductStorage {
  dau: number
  mau: number
  featureUsage: Record<string, number>
  retentionRate: number
  activationRate: number
  dailyActiveUsers: Set<string>
  monthlyActiveUsers: Set<string>
}

/**
 * Financial analytics storage
 */
export interface FinancialStorage {
  mrr: number
  revenue: number
  costs: number
  ltv: number
  cac: number
  cash: number
  burnRate: number
  subscriptions: Map<string, SubscriptionData>
}

/**
 * Complete analytics storage
 */
export interface AnalyticsStorage {
  web: WebStorage
  product: ProductStorage
  financial: FinancialStorage
}

// ============================================================================
// TYPE DEFINITIONS - API Interfaces
// ============================================================================

/**
 * Web analytics API
 */
export interface WebAnalytics {
  sessions(): Promise<number>
  pageviews(): Promise<number>
  bounceRate(): Promise<number>
  uniqueVisitors(): Promise<number>
  avgSessionDuration(): Promise<number>
  pagesPerSession(): Promise<number>
  all(): Promise<WebMetrics>
  recordSession(data: SessionData): Promise<void>
  recordPageview(data: PageviewData): Promise<void>
  sessionsTrend(period: TrendPeriod): Promise<MetricTrend[]>
  compare(period: string): Promise<WebMetricsComparison>
}

/**
 * Product analytics API
 */
export interface ProductAnalytics {
  dau(): Promise<number>
  mau(): Promise<number>
  stickiness(): Promise<number>
  featureUsage(): Promise<Record<string, number>>
  retentionRate(): Promise<number>
  activationRate(): Promise<number>
  all(): Promise<ProductMetrics>
  trackActivity(data: ActivityData): Promise<void>
  trackFeature(data: FeatureData): Promise<void>
  dauTrend(period: TrendPeriod): Promise<MetricTrend[]>
  retentionTrend(period: TrendPeriod): Promise<MetricTrend[]>
  lowAdoptionFeatures(threshold: number): Promise<string[]>
}

/**
 * Financial analytics API
 */
export interface FinancialAnalytics {
  mrr(): Promise<number>
  arr(): Promise<number>
  revenue(): Promise<number>
  costs(): Promise<number>
  grossMargin(): Promise<number>
  netMargin(): Promise<number>
  ltv(): Promise<number>
  cac(): Promise<number>
  ltvCacRatio(): Promise<number>
  runway(): Promise<number>
  burnRate(): Promise<number>
  all(): Promise<FinancialMetrics>
  recordRevenue(data: RevenueData): Promise<void>
  recordCost(data: CostData): Promise<void>
  recordSubscription(data: SubscriptionData): Promise<void>
  mrrTrend(period: TrendPeriod): Promise<MetricTrend[]>
  revenueTrend(period: TrendPeriod): Promise<MetricTrend[]>
  compareToTarget(target: Partial<FinancialMetrics>): Promise<FinancialTargetComparison>
}

/**
 * Main analytics namespace API
 */
export interface Analytics {
  web: WebAnalytics
  product: ProductAnalytics
  financial: FinancialAnalytics
  all(): Promise<AllAnalytics>
  summary(): Promise<AnalyticsSummary>
}

/**
 * Full context interface returned by createAnalyticsContext
 */
export interface AnalyticsContext {
  analytics: Analytics
  _storage: AnalyticsStorage
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate trend data points
 */
function generateTrendData(period: TrendPeriod, baseValue: number): MetricTrend[] {
  const now = new Date()
  const points: MetricTrend[] = []

  let numPoints: number
  let msPerPoint: number

  switch (period) {
    case 'day':
      numPoints = 24
      msPerPoint = 60 * 60 * 1000 // 1 hour
      break
    case 'week':
      numPoints = 7
      msPerPoint = 24 * 60 * 60 * 1000 // 1 day
      break
    case 'month':
      numPoints = 4
      msPerPoint = 7 * 24 * 60 * 60 * 1000 // 1 week
      break
  }

  for (let i = numPoints - 1; i >= 0; i--) {
    // Add some variance to make trend data realistic
    const variance = (Math.random() - 0.5) * 0.2 * baseValue
    points.push({
      date: new Date(now.getTime() - i * msPerPoint),
      value: Math.max(0, baseValue + variance),
    })
  }

  return points
}

/**
 * Calculate percentage change
 */
function calculatePercentChange(current: number, previous: number): number {
  if (previous === 0) {
    return current === 0 ? 0 : Infinity
  }
  return ((current - previous) / previous) * 100
}

// ============================================================================
// STORAGE FACTORY
// ============================================================================

/**
 * Create default web storage
 */
function createDefaultWebStorage(): WebStorage {
  return {
    sessions: 0,
    pageviews: 0,
    bouncedSessions: 0,
    uniqueVisitors: new Set<string>(),
    totalSessionDuration: 0,
    sessionData: [],
  }
}

/**
 * Create default product storage
 */
function createDefaultProductStorage(): ProductStorage {
  return {
    dau: 0,
    mau: 0,
    featureUsage: {},
    retentionRate: 85,
    activationRate: 60,
    dailyActiveUsers: new Set<string>(),
    monthlyActiveUsers: new Set<string>(),
  }
}

/**
 * Create default financial storage
 */
function createDefaultFinancialStorage(): FinancialStorage {
  return {
    mrr: 0,
    revenue: 0,
    costs: 0,
    ltv: 5000,
    cac: 500,
    cash: 0,
    burnRate: 0,
    subscriptions: new Map<string, SubscriptionData>(),
  }
}

// ============================================================================
// WEB ANALYTICS IMPLEMENTATION
// ============================================================================

/**
 * Create web analytics API
 */
function createWebAnalytics(storage: AnalyticsStorage): WebAnalytics {
  return {
    async sessions(): Promise<number> {
      return storage.web.sessions
    },

    async pageviews(): Promise<number> {
      return storage.web.pageviews
    },

    async bounceRate(): Promise<number> {
      if (storage.web.sessions === 0) {
        return 0
      }
      return (storage.web.bouncedSessions / storage.web.sessions) * 100
    },

    async uniqueVisitors(): Promise<number> {
      return storage.web.uniqueVisitors.size
    },

    async avgSessionDuration(): Promise<number> {
      if (storage.web.sessions === 0) {
        return 0
      }
      return storage.web.totalSessionDuration / storage.web.sessions
    },

    async pagesPerSession(): Promise<number> {
      if (storage.web.sessions === 0) {
        return 0
      }
      return storage.web.pageviews / storage.web.sessions
    },

    async all(): Promise<WebMetrics> {
      return {
        sessions: storage.web.sessions,
        pageviews: storage.web.pageviews,
        bounceRate: await this.bounceRate(),
        uniqueVisitors: storage.web.uniqueVisitors.size,
        avgSessionDuration: await this.avgSessionDuration(),
        pagesPerSession: await this.pagesPerSession(),
      }
    },

    async recordSession(data: SessionData): Promise<void> {
      storage.web.sessions++
      storage.web.pageviews += data.pageviews
      storage.web.totalSessionDuration += data.duration
      storage.web.uniqueVisitors.add(data.visitorId)

      if (data.bounced) {
        storage.web.bouncedSessions++
      }

      storage.web.sessionData.push(data)
    },

    async recordPageview(data: PageviewData): Promise<void> {
      storage.web.pageviews++
      storage.web.uniqueVisitors.add(data.visitorId)
    },

    async sessionsTrend(period: TrendPeriod): Promise<MetricTrend[]> {
      return generateTrendData(period, storage.web.sessions)
    },

    async compare(period: string): Promise<WebMetricsComparison> {
      // Generate comparison based on current values with simulated previous values
      const sessions = storage.web.sessions
      const pageviews = storage.web.pageviews
      const bounceRate = await this.bounceRate()
      const uniqueVisitors = storage.web.uniqueVisitors.size

      // Simulate previous period (typically slightly lower)
      const factor = 0.9 + Math.random() * 0.2

      const prevSessions = Math.round(sessions * factor)
      const prevPageviews = Math.round(pageviews * factor)
      const prevBounceRate = bounceRate * (0.95 + Math.random() * 0.1)
      const prevUniqueVisitors = Math.round(uniqueVisitors * factor)

      return {
        sessions: {
          current: sessions,
          previous: prevSessions,
          change: sessions - prevSessions,
          percentChange: calculatePercentChange(sessions, prevSessions),
        },
        pageviews: {
          current: pageviews,
          previous: prevPageviews,
          change: pageviews - prevPageviews,
          percentChange: calculatePercentChange(pageviews, prevPageviews),
        },
        bounceRate: {
          current: bounceRate,
          previous: prevBounceRate,
          change: bounceRate - prevBounceRate,
          percentChange: calculatePercentChange(bounceRate, prevBounceRate),
        },
        uniqueVisitors: {
          current: uniqueVisitors,
          previous: prevUniqueVisitors,
          change: uniqueVisitors - prevUniqueVisitors,
          percentChange: calculatePercentChange(uniqueVisitors, prevUniqueVisitors),
        },
      }
    },
  }
}

// ============================================================================
// PRODUCT ANALYTICS IMPLEMENTATION
// ============================================================================

/**
 * Create product analytics API
 */
function createProductAnalytics(storage: AnalyticsStorage): ProductAnalytics {
  return {
    async dau(): Promise<number> {
      return storage.product.dau || storage.product.dailyActiveUsers.size
    },

    async mau(): Promise<number> {
      return storage.product.mau || storage.product.monthlyActiveUsers.size
    },

    async stickiness(): Promise<number> {
      const dau = await this.dau()
      const mau = await this.mau()

      if (mau === 0) {
        return 0
      }
      return dau / mau
    },

    async featureUsage(): Promise<Record<string, number>> {
      return { ...storage.product.featureUsage }
    },

    async retentionRate(): Promise<number> {
      return storage.product.retentionRate
    },

    async activationRate(): Promise<number> {
      return storage.product.activationRate
    },

    async all(): Promise<ProductMetrics> {
      return {
        dau: await this.dau(),
        mau: await this.mau(),
        stickiness: await this.stickiness(),
        featureUsage: await this.featureUsage(),
        retentionRate: await this.retentionRate(),
        activationRate: await this.activationRate(),
      }
    },

    async trackActivity(data: ActivityData): Promise<void> {
      storage.product.dailyActiveUsers.add(data.userId)
      storage.product.monthlyActiveUsers.add(data.userId)
      storage.product.dau = storage.product.dailyActiveUsers.size
      storage.product.mau = storage.product.monthlyActiveUsers.size
    },

    async trackFeature(data: FeatureData): Promise<void> {
      const current = storage.product.featureUsage[data.feature] || 0
      storage.product.featureUsage[data.feature] = current + 1

      // Also track user activity
      storage.product.dailyActiveUsers.add(data.userId)
      storage.product.monthlyActiveUsers.add(data.userId)
    },

    async dauTrend(period: TrendPeriod): Promise<MetricTrend[]> {
      const dau = await this.dau()
      return generateTrendData(period, dau || 100)
    },

    async retentionTrend(period: TrendPeriod): Promise<MetricTrend[]> {
      return generateTrendData(period, storage.product.retentionRate)
    },

    async lowAdoptionFeatures(threshold: number): Promise<string[]> {
      const usage = storage.product.featureUsage
      return Object.entries(usage)
        .filter(([_, count]) => count < threshold)
        .map(([feature]) => feature)
    },
  }
}

// ============================================================================
// FINANCIAL ANALYTICS IMPLEMENTATION
// ============================================================================

/**
 * Create financial analytics API
 */
function createFinancialAnalytics(storage: AnalyticsStorage): FinancialAnalytics {
  return {
    async mrr(): Promise<number> {
      return storage.financial.mrr
    },

    async arr(): Promise<number> {
      return storage.financial.mrr * 12
    },

    async revenue(): Promise<number> {
      return storage.financial.revenue
    },

    async costs(): Promise<number> {
      return storage.financial.costs
    },

    async grossMargin(): Promise<number> {
      const revenue = storage.financial.revenue
      const costs = storage.financial.costs

      if (revenue === 0) {
        return 0
      }
      return ((revenue - costs) / revenue) * 100
    },

    async netMargin(): Promise<number> {
      // Simplified: net margin similar to gross margin for this implementation
      return this.grossMargin()
    },

    async ltv(): Promise<number> {
      return storage.financial.ltv
    },

    async cac(): Promise<number> {
      return storage.financial.cac
    },

    async ltvCacRatio(): Promise<number> {
      if (storage.financial.cac === 0) {
        return Infinity
      }
      return storage.financial.ltv / storage.financial.cac
    },

    async runway(): Promise<number> {
      const cash = storage.financial.cash
      const burnRate = storage.financial.burnRate

      if (burnRate <= 0) {
        return Infinity
      }
      return cash / burnRate
    },

    async burnRate(): Promise<number> {
      return storage.financial.burnRate
    },

    async all(): Promise<FinancialMetrics> {
      return {
        mrr: await this.mrr(),
        arr: await this.arr(),
        revenue: await this.revenue(),
        costs: await this.costs(),
        grossMargin: await this.grossMargin(),
        netMargin: await this.netMargin(),
        ltv: await this.ltv(),
        cac: await this.cac(),
        ltvCacRatio: await this.ltvCacRatio(),
        runway: await this.runway(),
        burnRate: await this.burnRate(),
      }
    },

    async recordRevenue(data: RevenueData): Promise<void> {
      storage.financial.revenue += data.amount
    },

    async recordCost(data: CostData): Promise<void> {
      storage.financial.costs += data.amount
    },

    async recordSubscription(data: SubscriptionData): Promise<void> {
      const monthlyAmount = data.interval === 'yearly' ? data.amount / 12 : data.amount
      storage.financial.subscriptions.set(data.customerId, data)

      // Recalculate MRR
      let totalMrr = 0
      for (const [_, sub] of storage.financial.subscriptions) {
        totalMrr += sub.interval === 'yearly' ? sub.amount / 12 : sub.amount
      }
      storage.financial.mrr = totalMrr
    },

    async mrrTrend(period: TrendPeriod): Promise<MetricTrend[]> {
      return generateTrendData(period, storage.financial.mrr || 10000)
    },

    async revenueTrend(period: TrendPeriod): Promise<MetricTrend[]> {
      return generateTrendData(period, storage.financial.revenue || 15000)
    },

    async compareToTarget(target: Partial<FinancialMetrics>): Promise<FinancialTargetComparison> {
      const result: FinancialTargetComparison = {}

      if (target.mrr !== undefined) {
        const current = storage.financial.mrr
        result.mrr = {
          current,
          target: target.mrr,
          gap: target.mrr - current,
          onTrack: current >= target.mrr,
        }
      }

      if (target.revenue !== undefined) {
        const current = storage.financial.revenue
        result.revenue = {
          current,
          target: target.revenue,
          gap: target.revenue - current,
          onTrack: current >= target.revenue,
        }
      }

      return result
    },
  }
}

// ============================================================================
// CONTEXT FACTORY
// ============================================================================

/**
 * Creates a mock workflow context ($) with analytics support for testing
 *
 * This factory creates a context object with:
 * - $.analytics.web - Web traffic analytics
 * - $.analytics.product - Product usage analytics
 * - $.analytics.financial - Financial metrics
 * - $.analytics.all() - Get all metrics at once
 * - $.analytics.summary() - Get dashboard summary
 * - $._storage - Internal storage for test setup
 *
 * @returns An AnalyticsContext object with analytics API methods
 */
export function createAnalyticsContext(): AnalyticsContext {
  // Create storage for all analytics namespaces
  const storage: AnalyticsStorage = {
    web: createDefaultWebStorage(),
    product: createDefaultProductStorage(),
    financial: createDefaultFinancialStorage(),
  }

  // Create analytics namespace
  const web = createWebAnalytics(storage)
  const product = createProductAnalytics(storage)
  const financial = createFinancialAnalytics(storage)

  const analytics: Analytics = {
    web,
    product,
    financial,

    async all(): Promise<AllAnalytics> {
      return {
        web: await web.all(),
        product: await product.all(),
        financial: await financial.all(),
      }
    },

    async summary(): Promise<AnalyticsSummary> {
      return {
        sessions: await web.sessions(),
        dau: await product.dau(),
        mrr: await financial.mrr(),
        runway: await financial.runway(),
      }
    },
  }

  return {
    analytics,
    _storage: storage,
  }
}
