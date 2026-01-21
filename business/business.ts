/**
 * @dotdo/business - Business Class
 *
 * The Business class extends DO with business-as-code capabilities:
 * - Products & Services with analytics
 * - Financial operations (Stripe)
 * - Experiments & Feature Flags
 * - Goals/OKRs with automatic metric tracking
 * - Elegant aggregation syntax
 */

import { DO } from '@dotdo/do'
import type { DurableObjectState } from '@cloudflare/workers-types'
import type {
  BusinessConfig,
  Product,
  Service,
  Experiment,
  Variant,
  FeatureFlag,
  Objective,
  KeyResult,
  OKRPeriod,
  BusinessMetrics,
  DateRange
} from './types'

// =============================================================================
// Business Class
// =============================================================================

/**
 * Business - A Digital Object for Business-as-Code
 *
 * @example
 * ```typescript
 * class MyBusiness extends Business {
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env, {
 *       finance: { stripeApiKey: env.STRIPE_API_KEY },
 *       analytics: { enabled: true }
 *     })
 *   }
 * }
 *
 * // Define OKRs with automatic metric tracking
 * const objective = await business.goals
 *   .objective('Increase Revenue')
 *   .keyResult('$100K MRR', { target: 100000, metric: $.mrr })
 *   .keyResult('1000 customers', { target: 1000, metric: $.customers.count })
 *   .period('Q1-2024')
 *
 * // Query with elegant aggregation syntax
 * const revenue = await business.aggregate
 *   .sum('amount')
 *   .from('purchases')
 *   .by('day')
 *   .last(30, 'days')
 *
 * // Or with template literals
 * const result = await business.query`
 *   sum(amount) from purchases by day last 30 days
 * `
 * ```
 */
export class Business extends DO {
  protected businessConfig: BusinessConfig

  constructor(
    state: DurableObjectState,
    env: Record<string, unknown>,
    config: BusinessConfig = {}
  ) {
    super(state, env, { backend: config.backend ?? 'db4' })
    this.businessConfig = config
  }

  // ===========================================================================
  // Goals / OKRs - Fluent API
  // ===========================================================================

  /**
   * Goals API for defining and tracking OKRs
   *
   * @example
   * ```typescript
   * const obj = await business.goals
   *   .objective('Double Revenue')
   *   .keyResult('$200K MRR', { target: 200000, metric: $.mrr })
   *   .keyResult('50% growth', { target: 50, metric: $.mrr.growth, unit: '%' })
   *   .period('Q2-2024')
   *   .owner('ceo')
   *   .save()
   *
   * // Check progress
   * const progress = await business.goals.progress('Double Revenue')
   * // { overall: 0.65, keyResults: [...], status: 'on-track' }
   * ```
   */
  get goals(): GoalsAPI {
    return new GoalsAPI(this)
  }

  // ===========================================================================
  // Aggregations - Fluent Query Builder
  // ===========================================================================

  /**
   * Aggregate API for elegant analytics queries
   *
   * @example
   * ```typescript
   * // Sum revenue by day for last 30 days
   * const revenue = await business.aggregate
   *   .sum('amount')
   *   .from('purchases')
   *   .where({ status: 'completed' })
   *   .by('day')
   *   .last(30, 'days')
   *
   * // Count users by country
   * const users = await business.aggregate
   *   .count()
   *   .from('users')
   *   .by('country')
   *   .all()
   *
   * // Average order value
   * const aov = await business.aggregate
   *   .avg('amount')
   *   .from('orders')
   *   .last(7, 'days')
   *   .value()
   * ```
   */
  get aggregate(): AggregateBuilder {
    return new AggregateBuilder(this)
  }

  /**
   * Query with template literal syntax
   *
   * @example
   * ```typescript
   * const result = await business.query`
   *   sum(amount) from purchases
   *   where status = 'completed'
   *   by day
   *   last 30 days
   * `
   *
   * // With interpolation
   * const productId = 'prod_123'
   * const sales = await business.query`
   *   count() from purchases
   *   where productId = ${productId}
   *   last 7 days
   * `
   * ```
   */
  async query(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<AggregateResult> {
    const query = parseQueryTemplate(strings, values)
    return this.executeAggregation(query)
  }

  // ===========================================================================
  // Metrics - Chainable Metric References
  // ===========================================================================

  /**
   * Metrics namespace for binding to OKRs
   *
   * @example
   * ```typescript
   * const $ = business.metrics
   *
   * // Use in OKRs
   * .keyResult('$100K MRR', { target: 100000, metric: $.mrr })
   * .keyResult('10% churn reduction', { target: -10, metric: $.churn.rate.delta })
   *
   * // Available metrics:
   * $.mrr                    // Current MRR
   * $.mrr.growth             // MRR growth rate
   * $.arr                    // Annual Recurring Revenue
   * $.customers.count        // Total customers
   * $.customers.paying       // Paying customers
   * $.churn.rate             // Churn rate
   * $.ltv                    // Lifetime value
   * $.nrr                    // Net Revenue Retention
   * $.grr                    // Gross Revenue Retention
   * $.products.revenue       // Product revenue
   * $.services.revenue       // Service revenue
   * ```
   */
  get metrics(): MetricRef {
    return createMetricRef(this)
  }

  // Alias for convenience
  get $(): MetricRef {
    return this.metrics
  }

  // ===========================================================================
  // Products
  // ===========================================================================

  get products(): ProductsAPI {
    return new ProductsAPI(this)
  }

  // ===========================================================================
  // Services
  // ===========================================================================

  get services(): ServicesAPI {
    return new ServicesAPI(this)
  }

  // ===========================================================================
  // Experiments
  // ===========================================================================

  get experiments(): ExperimentsAPI {
    return new ExperimentsAPI(this)
  }

  // ===========================================================================
  // Feature Flags
  // ===========================================================================

  get flags(): FlagsAPI {
    return new FlagsAPI(this)
  }

  // ===========================================================================
  // Finance (delegated to @dotdo/business-finance)
  // ===========================================================================

  get finance(): FinanceAPI {
    return new FinanceAPI(this)
  }

  // ===========================================================================
  // Analytics (delegated to @dotdo/clickhouse)
  // ===========================================================================

  get analytics(): AnalyticsAPI {
    return new AnalyticsAPI(this)
  }

  // ===========================================================================
  // Internal Methods
  // ===========================================================================

  protected async executeAggregation(query: ParsedQuery): Promise<AggregateResult> {
    // Implementation would use ClickHouse or DO SQLite
    throw new Error('Not implemented - requires @dotdo/clickhouse integration')
  }

  protected async getMetricValue(path: string[]): Promise<number> {
    // Implementation would fetch the metric value
    throw new Error('Not implemented - requires metric registry')
  }
}

// =============================================================================
// Goals API - Fluent OKR Builder
// =============================================================================

class GoalsAPI {
  constructor(private business: Business) {}

  /**
   * Start building an objective
   */
  objective(name: string): ObjectiveBuilder {
    return new ObjectiveBuilder(this.business, name)
  }

  /**
   * Get all objectives for a period
   */
  async list(period?: string): Promise<Objective[]> {
    // Implementation
    return []
  }

  /**
   * Get progress for an objective
   */
  async progress(nameOrId: string): Promise<{
    overall: number
    keyResults: Array<{ name: string; progress: number; status: string }>
    status: 'on-track' | 'at-risk' | 'behind' | 'completed'
    recommendations?: string[]
  }> {
    // Implementation would calculate progress from bound metrics
    throw new Error('Not implemented')
  }

  /**
   * Get AI recommendations for at-risk objectives
   */
  async recommendations(): Promise<Array<{
    objective: string
    risk: string
    suggestions: string[]
  }>> {
    // Implementation would use AI to analyze and suggest
    throw new Error('Not implemented')
  }
}

class ObjectiveBuilder {
  private _name: string
  private _description?: string
  private _keyResults: Array<{
    name: string
    target: number
    metric?: MetricRef
    unit?: string
  }> = []
  private _period?: string
  private _owner?: string

  constructor(private business: Business, name: string) {
    this._name = name
  }

  description(desc: string): this {
    this._description = desc
    return this
  }

  /**
   * Add a key result with automatic metric binding
   *
   * @example
   * ```typescript
   * .keyResult('$100K MRR', { target: 100000, metric: $.mrr })
   * .keyResult('1000 users', { target: 1000, metric: $.users.count, unit: 'users' })
   * ```
   */
  keyResult(
    name: string,
    options: { target: number; metric?: MetricRef; unit?: string }
  ): this {
    this._keyResults.push({
      name,
      target: options.target,
      metric: options.metric,
      unit: options.unit
    })
    return this
  }

  /**
   * Set the period (e.g., 'Q1-2024', '2024-H1', 'January 2024')
   */
  period(period: string): this {
    this._period = period
    return this
  }

  /**
   * Set the owner
   */
  owner(owner: string): this {
    this._owner = owner
    return this
  }

  /**
   * Save the objective
   */
  async save(): Promise<Objective> {
    // Implementation would store in DO
    throw new Error('Not implemented')
  }
}

// =============================================================================
// Aggregate Builder - Fluent Query API
// =============================================================================

interface ParsedQuery {
  operation: 'sum' | 'count' | 'avg' | 'min' | 'max' | 'distinct'
  field?: string
  collection: string
  where?: Record<string, unknown>
  groupBy?: string
  timeRange?: { value: number; unit: 'hours' | 'days' | 'weeks' | 'months' }
}

interface AggregateResult {
  value?: number
  data?: Array<{ key: string; value: number }>
  total?: number
}

class AggregateBuilder {
  private _operation?: ParsedQuery['operation']
  private _field?: string
  private _collection?: string
  private _where?: Record<string, unknown>
  private _groupBy?: string
  private _timeRange?: ParsedQuery['timeRange']

  constructor(private business: Business) {}

  sum(field: string): this {
    this._operation = 'sum'
    this._field = field
    return this
  }

  count(field?: string): this {
    this._operation = 'count'
    this._field = field
    return this
  }

  avg(field: string): this {
    this._operation = 'avg'
    this._field = field
    return this
  }

  min(field: string): this {
    this._operation = 'min'
    this._field = field
    return this
  }

  max(field: string): this {
    this._operation = 'max'
    this._field = field
    return this
  }

  distinct(field: string): this {
    this._operation = 'distinct'
    this._field = field
    return this
  }

  from(collection: string): this {
    this._collection = collection
    return this
  }

  where(conditions: Record<string, unknown>): this {
    this._where = conditions
    return this
  }

  by(field: string): this {
    this._groupBy = field
    return this
  }

  last(value: number, unit: 'hours' | 'days' | 'weeks' | 'months'): this {
    this._timeRange = { value, unit }
    return this
  }

  /**
   * Execute and return all results
   */
  async all(): Promise<AggregateResult> {
    return this.execute()
  }

  /**
   * Execute and return single value
   */
  async value(): Promise<number> {
    const result = await this.execute()
    return result.value ?? 0
  }

  private async execute(): Promise<AggregateResult> {
    if (!this._operation || !this._collection) {
      throw new Error('Operation and collection are required')
    }

    const query: ParsedQuery = {
      operation: this._operation,
      field: this._field,
      collection: this._collection,
      where: this._where,
      groupBy: this._groupBy,
      timeRange: this._timeRange
    }

    return (this.business as any).executeAggregation(query)
  }
}

// =============================================================================
// Metric References - Chainable Paths
// =============================================================================

interface MetricRef {
  readonly _path: string[]

  // SaaS Metrics
  readonly mrr: MetricRef & { growth: MetricRef }
  readonly arr: MetricRef
  readonly churn: MetricRef & { rate: MetricRef & { delta: MetricRef } }
  readonly ltv: MetricRef
  readonly nrr: MetricRef
  readonly grr: MetricRef
  readonly cac: MetricRef

  // Customers
  readonly customers: MetricRef & {
    count: MetricRef
    paying: MetricRef
    new: MetricRef
    churned: MetricRef
  }

  // Products & Services
  readonly products: MetricRef & {
    count: MetricRef
    revenue: MetricRef
  }
  readonly services: MetricRef & {
    count: MetricRef
    revenue: MetricRef
  }

  // Custom
  readonly [key: string]: MetricRef | string[]
}

function createMetricRef(business: Business, path: string[] = []): MetricRef {
  return new Proxy({} as MetricRef, {
    get(_, prop: string) {
      if (prop === '_path') return path
      return createMetricRef(business, [...path, prop])
    }
  })
}

// =============================================================================
// Template Parser
// =============================================================================

function parseQueryTemplate(
  strings: TemplateStringsArray,
  values: unknown[]
): ParsedQuery {
  // Combine template parts
  let query = ''
  strings.forEach((str, i) => {
    query += str
    if (i < values.length) {
      query += JSON.stringify(values[i])
    }
  })

  // Parse the query string
  // e.g., "sum(amount) from purchases where status = 'completed' by day last 30 days"
  const operationMatch = query.match(/^(sum|count|avg|min|max|distinct)\(([^)]*)\)/)
  const fromMatch = query.match(/from\s+(\w+)/)
  const whereMatch = query.match(/where\s+(.+?)(?=\s+by|\s+last|$)/)
  const byMatch = query.match(/by\s+(\w+)/)
  const lastMatch = query.match(/last\s+(\d+)\s+(hours?|days?|weeks?|months?)/)

  if (!operationMatch || !fromMatch) {
    throw new Error('Invalid query syntax')
  }

  return {
    operation: operationMatch[1] as ParsedQuery['operation'],
    field: operationMatch[2] || undefined,
    collection: fromMatch[1],
    where: whereMatch ? parseWhereClause(whereMatch[1]) : undefined,
    groupBy: byMatch?.[1],
    timeRange: lastMatch
      ? {
          value: parseInt(lastMatch[1]),
          unit: lastMatch[2].replace(/s$/, '') as 'hours' | 'days' | 'weeks' | 'months'
        }
      : undefined
  }
}

function parseWhereClause(clause: string): Record<string, unknown> {
  // Simple parser for "key = value" conditions
  const conditions: Record<string, unknown> = {}
  const parts = clause.split(/\s+and\s+/i)

  for (const part of parts) {
    const match = part.match(/(\w+)\s*=\s*(.+)/)
    if (match) {
      const [, key, value] = match
      conditions[key] = JSON.parse(value)
    }
  }

  return conditions
}

// =============================================================================
// Stub APIs (to be implemented)
// =============================================================================

class ProductsAPI {
  constructor(private business: Business) {}

  async create(data: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Promise<Product> {
    throw new Error('Not implemented')
  }

  async get(id: string): Promise<Product | null> {
    throw new Error('Not implemented')
  }

  async list(): Promise<Product[]> {
    throw new Error('Not implemented')
  }

  async update(id: string, data: Partial<Product>): Promise<Product> {
    throw new Error('Not implemented')
  }

  async delete(id: string): Promise<boolean> {
    throw new Error('Not implemented')
  }

  async analytics(id: string, period: DateRange): Promise<{
    views: number
    purchases: number
    revenue: number
    conversionRate: number
  }> {
    throw new Error('Not implemented')
  }
}

class ServicesAPI {
  constructor(private business: Business) {}

  async create(data: Omit<Service, 'id' | 'createdAt' | 'updatedAt'>): Promise<Service> {
    throw new Error('Not implemented')
  }

  async get(id: string): Promise<Service | null> {
    throw new Error('Not implemented')
  }

  async list(): Promise<Service[]> {
    throw new Error('Not implemented')
  }
}

class ExperimentsAPI {
  constructor(private business: Business) {}

  async create(data: Omit<Experiment, 'id' | 'createdAt' | 'updatedAt'>): Promise<Experiment> {
    throw new Error('Not implemented')
  }

  async assign(experimentKey: string, userId: string): Promise<Variant> {
    throw new Error('Not implemented')
  }

  async getVariant(experimentKey: string, userId: string): Promise<Variant | null> {
    throw new Error('Not implemented')
  }

  async results(experimentKey: string): Promise<{
    variants: Array<{
      key: string
      participants: number
      conversions: number
      conversionRate: number
      improvement?: number
      significant?: boolean
    }>
    winner?: string
  }> {
    throw new Error('Not implemented')
  }
}

class FlagsAPI {
  constructor(private business: Business) {}

  async get(key: string, userId?: string): Promise<boolean | string | number> {
    throw new Error('Not implemented')
  }

  async isEnabled(key: string, userId?: string): Promise<boolean> {
    throw new Error('Not implemented')
  }

  async set(key: string, value: boolean | string | number): Promise<void> {
    throw new Error('Not implemented')
  }

  async list(): Promise<FeatureFlag[]> {
    throw new Error('Not implemented')
  }
}

class FinanceAPI {
  constructor(private business: Business) {}

  // Delegate to @dotdo/business-finance
  get customers() {
    throw new Error('Not implemented - requires @dotdo/business-finance')
  }

  get subscriptions() {
    throw new Error('Not implemented - requires @dotdo/business-finance')
  }

  get invoices() {
    throw new Error('Not implemented - requires @dotdo/business-finance')
  }

  get payments() {
    throw new Error('Not implemented - requires @dotdo/business-finance')
  }

  get metrics() {
    throw new Error('Not implemented - requires @dotdo/business-finance')
  }
}

class AnalyticsAPI {
  constructor(private business: Business) {}

  // Delegate to @dotdo/clickhouse
  async track(event: { type: string; properties?: Record<string, unknown> }): Promise<void> {
    throw new Error('Not implemented - requires @dotdo/clickhouse')
  }

  async query<T>(sql: string): Promise<T[]> {
    throw new Error('Not implemented - requires @dotdo/clickhouse')
  }
}

// =============================================================================
// Export
// =============================================================================

export { GoalsAPI, AggregateBuilder, MetricRef }
