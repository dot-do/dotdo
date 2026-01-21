/**
 * @dotdo/do - BusinessDO
 *
 * Business-as-Code Durable Object that extends DO with analytics, finance,
 * experiments, OKRs, and typed collections for Products and Services.
 *
 * ## Features
 *
 * - **Analytics**: ClickHouse WASM for queries, DO SQLite for hot data
 * - **SaaS Metrics**: MRR, ARR, NRR, GRR, CAC, LTV, Churn
 * - **OKRs & Goals**: Hierarchical goal tracking with key results
 * - **Experiments & Feature Flags**: A/B testing with statistical analysis
 * - **Financial Ledger**: Stripe integration for payments and subscriptions
 * - **Products & Services**: Typed collections with per-entity analytics
 *
 * @module @dotdo/do
 *
 * @example
 * ```typescript
 * import { BusinessDO } from '@dotdo/do'
 *
 * class MyBusinessDO extends BusinessDO {
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env, {
 *       analytics: { enabled: true },
 *       finance: { stripeApiKey: env.STRIPE_SECRET_KEY }
 *     })
 *   }
 * }
 *
 * // Usage
 * const metrics = await business.calculateMetrics(thisMonth)
 * console.log(`MRR: $${metrics.mrr.current}`)
 *
 * const health = await business.okrs.health()
 * console.log(`${health.onTrack} OKRs on track`)
 * ```
 */

import { DO, type DOEnv, type DOOptions } from './DO'

// =============================================================================
// Analytics & Finance Types (lazy imports for tree-shaking)
// =============================================================================

// Re-declare types locally to avoid import path issues across package boundaries
// The actual implementations are dynamically imported when needed

/**
 * Analytics client interface (from @dotdo/clickhouse)
 */
export interface AnalyticsClient {
  track(event: AnalyticsEventInput): Promise<void>
  pageview(input: unknown): Promise<void>
  trackBatch(events: AnalyticsEventInput[]): Promise<void>
  query<T = unknown>(sql: string, options?: unknown): Promise<{ data: T[]; rows: number }>
  funnel(steps: FunnelStep[], period: DateRange): Promise<FunnelResult>
  calculateSaaSMetrics(period: MetricPeriod): Promise<SaaSMetrics>
  getCurrentMRR(): Promise<number>
  getMRRHistory(period: DateRange): Promise<Array<{ date: string; mrr: number }>>
  getProductAnalytics(productId: string, period: DateRange): Promise<ProductAnalyticsResult>
  flush(): Promise<void>
  clearCache(): void
  dispose(): Promise<void>
}

/**
 * Financial client interface (from @dotdo/finance)
 */
export interface FinancialClient {
  customers: {
    create(input: unknown): Promise<unknown>
    get(id: string): Promise<unknown>
  }
  subscriptions: {
    create(input: unknown): Promise<unknown>
    get(id: string): Promise<unknown>
  }
  webhooks: {
    handleWebhook(request: Request): Promise<{ handled: boolean; error?: Error }>
  }
  metrics: {
    getMRR(): Promise<number>
    getSaaSMetrics(period?: MetricPeriod): Promise<SaaSMetrics>
  }
}

// Analytics types
export interface AnalyticsEventInput {
  type: string
  properties?: Record<string, unknown>
  visitorId?: string
  sessionId?: string
}

export interface DateRange {
  start: Date
  end: Date
}

export interface MetricPeriod extends DateRange {
  granularity?: 'day' | 'week' | 'month' | 'year'
}

export interface FunnelStep {
  name: string
  event: string
  filter?: Record<string, unknown>
}

export interface FunnelResult {
  steps: Array<{
    name: string
    count: number
    conversionRate: number
    dropoffRate: number
  }>
  overallConversionRate: number
}

export interface SaaSMetrics {
  mrr: {
    current: number
    new: number
    expansion: number
    contraction: number
    churned: number
    netNew: number
    beginning: number
    growthRate: number
  }
  arr: number
  churn: {
    customerChurnRate: number
    revenueChurnRate: number
    netRevenueChurn: number
    churnedCustomers: number
    churnedRevenue: number
  }
  ltv: {
    average: number
  }
  nrr?: number
  grr?: number
  quickRatio?: number
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Analytics configuration for BusinessDO
 */
export interface BusinessAnalyticsConfig {
  /**
   * Enable analytics
   * @default false
   */
  enabled?: boolean

  /**
   * ClickHouse WASM profile (affects bundle size)
   * - 'minimal': Core SQL only (~2MB)
   * - 'standard': SQL + basic analytics (~5MB)
   * - 'full': All features including ML (~10MB)
   * @default 'standard'
   */
  profile?: 'minimal' | 'standard' | 'full'
}

/**
 * Finance configuration for BusinessDO
 */
export interface BusinessFinanceConfig {
  /**
   * Stripe API key (required for finance features)
   */
  stripeApiKey?: string

  /**
   * Stripe webhook secret for signature verification
   */
  webhookSecret?: string

  /**
   * Default currency (ISO 4217)
   * @default 'usd'
   */
  defaultCurrency?: string
}

/**
 * OKR/Goal configuration
 */
export interface OKRConfig {
  /**
   * Enable OKR tracking
   * @default true
   */
  enabled?: boolean

  /**
   * Automatically update OKRs when related metrics change
   * @default true
   */
  autoUpdate?: boolean
}

/**
 * BusinessDO configuration options
 */
export interface BusinessDOConfig extends DOOptions {
  /**
   * Analytics configuration
   */
  analytics?: BusinessAnalyticsConfig

  /**
   * Finance configuration
   */
  finance?: BusinessFinanceConfig

  /**
   * OKR configuration
   */
  okrs?: OKRConfig

  /**
   * Business namespace (for multi-tenant isolation)
   */
  namespace?: string
}

// =============================================================================
// Entity Types
// =============================================================================

/**
 * Product entity with analytics metadata
 */
export interface Product {
  $type: 'Product'
  $id: string

  /** Product name */
  name: string

  /** Product description */
  description?: string

  /** SKU or product code */
  sku?: string

  /** Whether the product is active */
  active: boolean

  /** Pricing information */
  prices: ProductPrice[]

  /** Stripe product ID (if synced) */
  stripeId?: string

  /** Related service IDs */
  services?: string[]

  /** Custom metadata */
  metadata?: Record<string, unknown>

  /** Creation timestamp (Unix ms) */
  createdAt: number

  /** Last update timestamp (Unix ms) */
  updatedAt: number
}

/**
 * Product price configuration
 */
export interface ProductPrice {
  /** Unique price ID */
  id: string

  /** Amount in smallest currency unit (e.g., cents) */
  amount: number

  /** Currency code (ISO 4217) */
  currency: string

  /** Billing interval (null for one-time) */
  interval?: 'day' | 'week' | 'month' | 'year'

  /** Stripe price ID (if synced) */
  stripeId?: string
}

/**
 * Service entity with usage tracking
 */
export interface Service {
  $type: 'Service'
  $id: string

  /** Service name */
  name: string

  /** Service description */
  description?: string

  /** API endpoint (if applicable) */
  endpoint?: string

  /** Whether the service is active */
  active: boolean

  /** Products that include this service */
  products?: string[]

  /** Custom metadata */
  metadata?: Record<string, unknown>

  /** Creation timestamp (Unix ms) */
  createdAt: number

  /** Last update timestamp (Unix ms) */
  updatedAt: number
}

/**
 * OKR (Objectives and Key Results)
 */
export interface OKR {
  $type: 'OKR'
  $id: string

  /** Objective title */
  objective: string

  /** Detailed description */
  description?: string

  /** Owner (user/team ID) */
  owner?: string

  /** Status */
  status: 'draft' | 'active' | 'completed' | 'cancelled'

  /** Confidence level (0-100) */
  confidence: number

  /** Time period (Unix ms timestamps) */
  period?: {
    start: number
    end: number
  }

  /** Key results */
  keyResults: KeyResult[]

  /** Parent OKR ID (for hierarchical OKRs) */
  parentId?: string

  /** Creation timestamp (Unix ms) */
  createdAt: number

  /** Last update timestamp (Unix ms) */
  updatedAt: number
}

/**
 * Key Result within an OKR
 */
export interface KeyResult {
  /** Unique ID */
  id: string

  /** Key result title */
  title: string

  /** Target metric */
  metric: string

  /** Target value */
  target: number

  /** Current value */
  current: number

  /** Unit of measurement */
  unit?: string

  /** Expected progress (for pacing) */
  expected?: number
}

/**
 * Product analytics result
 */
export interface ProductAnalyticsResult {
  productId: string
  period: DateRange
  totalEvents: number
  uniqueUsers: number
  conversions: number
  revenue: number
  conversionRate: number
  daily: Array<{
    date: string
    events: number
    uniqueUsers: number
    conversions: number
    revenue: number
  }>
}

/**
 * Service analytics result
 */
export interface ServiceAnalyticsResult {
  serviceId: string
  period: DateRange
  totalRequests: number
  avgLatency: number
  p95Latency: number
  errorRate: number
  hourly: Array<{
    hour: string
    requests: number
    avgLatency: number
    p95Latency: number
    errors: number
    errorRate: number
  }>
}

/**
 * OKR health dashboard
 */
export interface OKRHealth {
  /** Number of OKRs on track (confidence >= 70) */
  onTrack: number

  /** Number of OKRs at risk (40 <= confidence < 70) */
  atRisk: number

  /** Number of OKRs off track (confidence < 40) */
  offTrack: number

  /** Overall average confidence */
  overallConfidence: number
}

// =============================================================================
// BusinessDO Class
// =============================================================================

/**
 * BusinessDO - Durable Object for Business-as-Code
 *
 * Extends the base DO with analytics, finance, experiments, and OKRs.
 * Products and Services are stored as Things with typed accessors.
 */
export class BusinessDO extends DO {
  protected config: BusinessDOConfig

  // Lazy-loaded clients
  private _analytics: AnalyticsClient | null = null
  private _finance: FinancialClient | null = null

  constructor(
    state: DurableObjectState,
    env: DOEnv,
    config: BusinessDOConfig = {}
  ) {
    super(state, env, config)
    this.config = config

    // Set up event handlers for automatic metrics tracking
    if (config.okrs?.autoUpdate !== false) {
      this.setupMetricsHandlers()
    }
  }

  // ==========================================================================
  // Analytics
  // ==========================================================================

  /**
   * Analytics client - lazily loads ClickHouse WASM when first accessed.
   *
   * @throws Error if analytics is not enabled in config
   */
  get analytics(): AnalyticsClient {
    if (!this.config.analytics?.enabled) {
      throw new Error(
        'Analytics is not enabled. Set analytics.enabled: true in BusinessDO config.'
      )
    }

    if (!this._analytics) {
      // Note: createClickHouseClient is async but we return sync for better DX.
      // The actual initialization happens on first use of an async method.
      throw new Error(
        'Analytics client not initialized. Call await business.initAnalytics() first.'
      )
    }

    return this._analytics
  }

  /**
   * Initialize the analytics client.
   * Call this before using analytics features.
   */
  async initAnalytics(): Promise<AnalyticsClient> {
    if (!this.config.analytics?.enabled) {
      throw new Error(
        'Analytics is not enabled. Set analytics.enabled: true in BusinessDO config.'
      )
    }

    if (!this._analytics) {
      // Dynamic import to avoid bundling when not used
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clickhouse = await import('../clickhouse/src/client') as any
      const client = await clickhouse.createClickHouseClient(this.state.storage, {
        profile: this.config.analytics?.profile ?? 'standard',
        namespace: this.config.namespace ?? undefined
      })
      this._analytics = client as AnalyticsClient
    }

    return this._analytics as AnalyticsClient
  }

  /**
   * Track an analytics event
   */
  async track(event: AnalyticsEventInput): Promise<void> {
    const analytics = await this.initAnalytics()
    await analytics.track(event)
  }

  /**
   * Calculate SaaS metrics for a period
   */
  async calculateMetrics(period: MetricPeriod): Promise<SaaSMetrics> {
    const analytics = await this.initAnalytics()
    return analytics.calculateSaaSMetrics(period)
  }

  /**
   * Get current MRR
   */
  async getMRR(): Promise<number> {
    const analytics = await this.initAnalytics()
    return analytics.getCurrentMRR()
  }

  /**
   * Run a funnel analysis
   */
  async funnel(steps: FunnelStep[], period: DateRange): Promise<FunnelResult> {
    const analytics = await this.initAnalytics()
    return analytics.funnel(steps, period)
  }

  // ==========================================================================
  // Finance
  // ==========================================================================

  /**
   * Financial client - lazily initialized when first accessed.
   *
   * @throws Error if finance is not configured
   */
  get finance(): FinancialClient {
    if (!this.config.finance?.stripeApiKey) {
      throw new Error(
        'Finance is not configured. Set finance.stripeApiKey in BusinessDO config.'
      )
    }

    if (!this._finance) {
      throw new Error(
        'Finance client not initialized. Call await business.initFinance() first.'
      )
    }

    return this._finance
  }

  /**
   * Initialize the finance client.
   * Call this before using finance features.
   */
  async initFinance(): Promise<FinancialClient> {
    if (!this.config.finance?.stripeApiKey) {
      throw new Error(
        'Finance is not configured. Set finance.stripeApiKey in BusinessDO config.'
      )
    }

    if (!this._finance) {
      // Dynamic import to avoid bundling when not used
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const finance = await import('../finance/src/client') as any
      const financeConfig = {
        stripeApiKey: this.config.finance.stripeApiKey,
        webhookSecret: this.config.finance.webhookSecret,
        defaultCurrency: this.config.finance.defaultCurrency ?? 'usd',
        namespace: this.config.namespace ?? undefined,
        storage: this.state.storage
      }
      const client = await finance.createStripeClient(financeConfig)
      this._finance = client as FinancialClient
    }

    return this._finance as FinancialClient
  }

  /**
   * Handle incoming Stripe webhook
   */
  async handleStripeWebhook(request: Request): Promise<Response> {
    const finance = await this.initFinance()
    const result = await finance.webhooks.handleWebhook(request)

    if (result.error) {
      return new Response(JSON.stringify({ error: result.error.message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ handled: result.handled }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // ==========================================================================
  // Products
  // ==========================================================================

  /**
   * Products collection with analytics
   */
  get products(): ProductsCollection {
    return {
      // Basic CRUD delegating to things store
      create: async (data: Omit<Product, '$type' | '$id' | 'createdAt' | 'updatedAt'>) => {
        const now = Date.now()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const product = await this.things.create({
          $type: 'Product',
          ...data,
          createdAt: now,
          updatedAt: now
        } as any)
        return product as unknown as Product
      },

      get: async (id: string) => {
        const product = await this.things.get(id)
        if (product?.$type !== 'Product') return null
        return product as unknown as Product
      },

      list: async (options?: { active?: boolean; limit?: number }) => {
        // Note: filtering by active requires post-filtering since things.list only supports type filter
        const products = await this.things.list({
          type: 'Product',
          limit: options?.limit ?? 100
        })
        const filtered = options?.active !== undefined
          ? products.filter(p => (p as unknown as Product).active === options.active)
          : products
        return filtered as unknown as Product[]
      },

      update: async (id: string, data: Partial<Product>) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updated = await this.things.update(id, {
          ...data,
          updatedAt: Date.now()
        } as any)
        return updated as unknown as Product
      },

      delete: async (id: string) => {
        await this.things.delete(id)
        return true
      },

      // Analytics extension
      analytics: async (productId: string, period: DateRange): Promise<ProductAnalyticsResult> => {
        if (!this.config.analytics?.enabled) {
          throw new Error('Analytics not enabled')
        }
        const analytics = await this.initAnalytics()
        return analytics.getProductAnalytics(productId, period)
      },

      funnel: async (productId: string, steps: FunnelStep[], period: DateRange): Promise<FunnelResult> => {
        if (!this.config.analytics?.enabled) {
          throw new Error('Analytics not enabled')
        }
        const analytics = await this.initAnalytics()
        // Add product filter to each step
        const productSteps = steps.map(step => ({
          ...step,
          filter: { ...step.filter, productId }
        }))
        return analytics.funnel(productSteps, period)
      }
    }
  }

  // ==========================================================================
  // Services
  // ==========================================================================

  /**
   * Services collection with analytics
   */
  get services(): ServicesCollection {
    return {
      // Basic CRUD
      create: async (data: Omit<Service, '$type' | '$id' | 'createdAt' | 'updatedAt'>) => {
        const now = Date.now()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const service = await this.things.create({
          $type: 'Service',
          ...data,
          createdAt: now,
          updatedAt: now
        } as any)
        return service as unknown as Service
      },

      get: async (id: string) => {
        const service = await this.things.get(id)
        if (service?.$type !== 'Service') return null
        return service as unknown as Service
      },

      list: async (options?: { active?: boolean; limit?: number }) => {
        // Note: filtering by active requires post-filtering since things.list only supports type filter
        const services = await this.things.list({
          type: 'Service',
          limit: options?.limit ?? 100
        })
        const filtered = options?.active !== undefined
          ? services.filter(s => (s as unknown as Service).active === options.active)
          : services
        return filtered as unknown as Service[]
      },

      update: async (id: string, data: Partial<Service>) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updated = await this.things.update(id, {
          ...data,
          updatedAt: Date.now()
        } as any)
        return updated as unknown as Service
      },

      delete: async (id: string) => {
        await this.things.delete(id)
        return true
      },

      // Analytics extension
      analytics: async (serviceId: string, period: DateRange): Promise<ServiceAnalyticsResult> => {
        if (!this.config.analytics?.enabled) {
          throw new Error('Analytics not enabled')
        }
        const analytics = await this.initAnalytics()

        // Query service-specific analytics
        const result = await analytics.query<{
          hour: string
          requests: number
          avgLatency: number
          p95Latency: number
          errors: number
        }>(`
          SELECT
            formatDateTime(fromUnixTimestamp64Milli(timestamp), '%Y-%m-%d %H:00:00') as hour,
            count() as requests,
            avg(JSONExtractFloat(properties, 'duration_ms')) as avgLatency,
            quantile(0.95)(JSONExtractFloat(properties, 'duration_ms')) as p95Latency,
            countIf(JSONExtractInt(properties, 'status') >= 400) as errors
          FROM events
          WHERE JSONExtractString(properties, 'serviceId') = '${serviceId}'
            AND timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
          GROUP BY hour
          ORDER BY hour
        `)

        const totalRequests = result.data.reduce((sum, r) => sum + r.requests, 0)
        const totalErrors = result.data.reduce((sum, r) => sum + r.errors, 0)
        const avgLatency = result.data.length > 0
          ? result.data.reduce((sum, r) => sum + r.avgLatency * r.requests, 0) / totalRequests
          : 0
        const p95Latency = result.data.length > 0
          ? Math.max(...result.data.map(r => r.p95Latency))
          : 0

        return {
          serviceId,
          period,
          totalRequests,
          avgLatency,
          p95Latency,
          errorRate: totalRequests > 0 ? totalErrors / totalRequests : 0,
          hourly: result.data.map(r => ({
            hour: r.hour,
            requests: r.requests,
            avgLatency: r.avgLatency,
            p95Latency: r.p95Latency,
            errors: r.errors,
            errorRate: r.requests > 0 ? r.errors / r.requests : 0
          }))
        }
      }
    }
  }

  // ==========================================================================
  // OKRs
  // ==========================================================================

  /**
   * OKRs collection with health tracking
   */
  get okrs(): OKRsCollection {
    return {
      // Basic CRUD
      create: async (data: Omit<OKR, '$type' | '$id' | 'createdAt' | 'updatedAt'>) => {
        const now = Date.now()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const okr = await this.things.create({
          $type: 'OKR',
          ...data,
          // Provide defaults only if not specified
          status: data.status ?? 'draft',
          confidence: data.confidence ?? 50,
          createdAt: now,
          updatedAt: now
        } as any)
        return okr as unknown as OKR
      },

      get: async (id: string) => {
        const okr = await this.things.get(id)
        if (okr?.$type !== 'OKR') return null
        return okr as unknown as OKR
      },

      list: async (options?: { status?: OKR['status']; limit?: number }) => {
        // Note: filtering by status requires post-filtering since things.list only supports type filter
        const okrs = await this.things.list({
          type: 'OKR',
          limit: options?.limit ?? 100
        })
        const filtered = options?.status !== undefined
          ? okrs.filter(o => (o as unknown as OKR).status === options.status)
          : okrs
        return filtered as unknown as OKR[]
      },

      update: async (id: string, data: Partial<OKR>) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updated = await this.things.update(id, {
          ...data,
          updatedAt: Date.now()
        } as any)
        return updated as unknown as OKR
      },

      delete: async (id: string) => {
        await this.things.delete(id)
        return true
      },

      // OKR-specific methods
      health: async (): Promise<OKRHealth> => {
        const allOkrs = await this.things.list({
          type: 'OKR'
        })
        const okrs = (allOkrs as unknown as OKR[]).filter(o => o.status === 'active')

        const onTrack = okrs.filter(o => o.confidence >= 70).length
        const atRisk = okrs.filter(o => o.confidence >= 40 && o.confidence < 70).length
        const offTrack = okrs.filter(o => o.confidence < 40).length

        const overallConfidence = okrs.length > 0
          ? okrs.reduce((sum, o) => sum + o.confidence, 0) / okrs.length
          : 0

        return { onTrack, atRisk, offTrack, overallConfidence }
      },

      updateKeyResult: async (okrId: string, keyResultId: string, current: number) => {
        const okr = await this.things.get(okrId) as unknown as OKR | null
        if (!okr || okr.$type !== 'OKR') {
          throw new Error(`OKR not found: ${okrId}`)
        }

        const keyResults = okr.keyResults.map(kr => {
          if (kr.id === keyResultId) {
            return { ...kr, current }
          }
          return kr
        })

        // Recalculate confidence based on key result progress
        const progress = keyResults.reduce((sum, kr) => {
          const krProgress = kr.target > 0 ? Math.min(kr.current / kr.target, 1) : 0
          return sum + krProgress
        }, 0)
        const confidence = Math.round((progress / keyResults.length) * 100)

        return this.okrs.update(okrId, { keyResults, confidence })
      },

      getAtRisk: async (): Promise<OKR[]> => {
        const allOkrs = await this.things.list({
          type: 'OKR'
        })
        const okrs = (allOkrs as unknown as OKR[]).filter(o => o.status === 'active')

        return okrs.filter(o => {
          // Check if any key result is behind expected progress
          return o.keyResults.some(kr =>
            kr.expected !== undefined && kr.current < kr.expected
          )
        })
      }
    }
  }

  // ==========================================================================
  // Experiments
  // ==========================================================================

  /**
   * Get variant for a user in an experiment
   */
  async getVariant(userId: string, experimentKey: string): Promise<{ key: string; value: unknown } | null> {
    if (!this.config.analytics?.enabled) {
      return null
    }

    // Check for existing assignment
    const assignmentKey = `experiment:${experimentKey}:${userId}`
    const existingAssignment = await this.state.storage.get<string>(assignmentKey)

    if (existingAssignment) {
      const experiment = await this.state.storage.get<{
        variants: Array<{ key: string; value: unknown }>
      }>(`experiment:${experimentKey}`)

      if (experiment) {
        const variant = experiment.variants.find(v => v.key === existingAssignment)
        return variant ? { key: variant.key, value: variant.value } : null
      }
    }

    return null
  }

  /**
   * Evaluate a feature flag for a user
   */
  async flag(userId: string, flagKey: string): Promise<boolean | string | number> {
    const flagData = await this.state.storage.get<{
      type: 'boolean' | 'string' | 'number'
      value: boolean | string | number
      rules?: Array<{
        conditions: Record<string, unknown>
        value: boolean | string | number
      }>
    }>(`flag:${flagKey}`)

    if (!flagData) {
      return false // Default for missing flags
    }

    // For now, return the default value
    // TODO: Implement rule evaluation based on user properties
    return flagData.value
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Set up event handlers for automatic metrics updates
   */
  private setupMetricsHandlers(): void {
    // Track subscription events for OKR updates
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.$.on.Subscription.created(async (event: any) => {
      const mrr = event?.payload?.mrr ?? 0
      await this.updateOKRsFromMetric('mrr', mrr)
      if (this.config.analytics?.enabled) {
        await this.track({
          type: 'subscription.created',
          properties: event?.payload ?? {}
        })
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.$.on.Subscription.cancelled(async (event: any) => {
      await this.updateOKRsFromMetric('churn', 1)
      if (this.config.analytics?.enabled) {
        await this.track({
          type: 'subscription.cancelled',
          properties: event?.payload ?? {}
        })
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.$.on.Customer.created(async (event: any) => {
      await this.updateOKRsFromMetric('customers', 1)
      if (this.config.analytics?.enabled) {
        await this.track({
          type: 'customer.created',
          properties: event?.payload ?? {}
        })
      }
    })
  }

  /**
   * Update OKRs when a related metric changes
   */
  private async updateOKRsFromMetric(metricKey: string, delta: number): Promise<void> {
    const allOkrs = await this.things.list({
      type: 'OKR'
    })
    const okrs = (allOkrs as unknown as OKR[]).filter(o => o.status === 'active')

    for (const okr of okrs) {
      for (const kr of okr.keyResults) {
        if (kr.metric === metricKey) {
          await this.okrs.updateKeyResult(okr.$id, kr.id, kr.current + delta)
        }
      }
    }
  }
}

// =============================================================================
// Collection Types
// =============================================================================

/**
 * Products collection interface
 */
export interface ProductsCollection {
  create(data: Omit<Product, '$type' | '$id' | 'createdAt' | 'updatedAt'>): Promise<Product>
  get(id: string): Promise<Product | null>
  list(options?: { active?: boolean; limit?: number }): Promise<Product[]>
  update(id: string, data: Partial<Product>): Promise<Product>
  delete(id: string): Promise<boolean>
  analytics(productId: string, period: DateRange): Promise<ProductAnalyticsResult>
  funnel(productId: string, steps: FunnelStep[], period: DateRange): Promise<FunnelResult>
}

/**
 * Services collection interface
 */
export interface ServicesCollection {
  create(data: Omit<Service, '$type' | '$id' | 'createdAt' | 'updatedAt'>): Promise<Service>
  get(id: string): Promise<Service | null>
  list(options?: { active?: boolean; limit?: number }): Promise<Service[]>
  update(id: string, data: Partial<Service>): Promise<Service>
  delete(id: string): Promise<boolean>
  analytics(serviceId: string, period: DateRange): Promise<ServiceAnalyticsResult>
}

/**
 * OKRs collection interface
 */
export interface OKRsCollection {
  create(data: Omit<OKR, '$type' | '$id' | 'createdAt' | 'updatedAt'>): Promise<OKR>
  get(id: string): Promise<OKR | null>
  list(options?: { status?: OKR['status']; limit?: number }): Promise<OKR[]>
  update(id: string, data: Partial<OKR>): Promise<OKR>
  delete(id: string): Promise<boolean>
  health(): Promise<OKRHealth>
  updateKeyResult(okrId: string, keyResultId: string, current: number): Promise<OKR>
  getAtRisk(): Promise<OKR[]>
}

export default BusinessDO
