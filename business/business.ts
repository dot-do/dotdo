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
import { Hono } from 'hono'
import type { DurableObjectState } from '@cloudflare/workers-types'
import type {
  BusinessConfig,
  Experiment,
  Variant,
  FeatureFlag,
  Objective,
  KeyResult,
  OKRPeriod,
  BusinessMetrics,
} from './types'
import type { FinancialClient, SaaSMetrics } from '@dotdo/business-finance'
import { createStripeClient } from '@dotdo/business-finance'

// =============================================================================
// OKR Helper Functions
// =============================================================================

/**
 * Calculate progress percentage for a key result
 * Returns 0-1 range, handles division by zero
 */
function calculateKeyResultProgress(currentValue: number, targetValue: number): number {
  if (targetValue === 0) return 0
  return Math.min(currentValue / targetValue, 1)
}

/**
 * Determine status based on progress percentage
 * - completed: progress >= 1.0
 * - on-track: progress >= 0.6
 * - at-risk: progress >= 0.3
 * - behind: progress < 0.3
 */
function determineStatus(progress: number): 'on-track' | 'at-risk' | 'behind' | 'completed' {
  if (progress >= 1.0) return 'completed'
  if (progress >= 0.6) return 'on-track'
  if (progress >= 0.3) return 'at-risk'
  return 'behind'
}

/**
 * Parse a period string into OKRPeriod object
 * Supports: Q1-2024, H1-2024, 2024, January 2024, etc.
 */
function parsePeriod(periodStr: string): OKRPeriod {
  const now = new Date()
  const year = parseInt(periodStr.match(/\d{4}/)?.[0] ?? String(now.getFullYear()))

  // Quarter format: Q1-2024
  const quarterMatch = periodStr.match(/Q(\d)/i)
  if (quarterMatch?.[1]) {
    const quarter = parseInt(quarterMatch[1])
    const startMonth = (quarter - 1) * 3
    return {
      type: 'quarter',
      name: periodStr,
      start: new Date(year, startMonth, 1),
      end: new Date(year, startMonth + 3, 0),
    }
  }

  // Half format: H1-2024
  const halfMatch = periodStr.match(/H(\d)/i)
  if (halfMatch?.[1]) {
    const half = parseInt(halfMatch[1])
    const startMonth = (half - 1) * 6
    return {
      type: 'custom',
      name: periodStr,
      start: new Date(year, startMonth, 1),
      end: new Date(year, startMonth + 6, 0),
    }
  }

  // Year format: 2024
  if (/^\d{4}$/.test(periodStr)) {
    return {
      type: 'year',
      name: periodStr,
      start: new Date(year, 0, 1),
      end: new Date(year, 11, 31),
    }
  }

  // Default: treat as custom period spanning current year
  return {
    type: 'custom',
    name: periodStr,
    start: new Date(year, 0, 1),
    end: new Date(year, 11, 31),
  }
}

/**
 * Generate a unique ID for an objective
 */
function generateObjectiveId(): string {
  return `obj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Generate a unique ID for a key result
 */
function generateKeyResultId(): string {
  return `kr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

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
  // HTTP Routes - Override to add goals routes
  // ===========================================================================

  protected routes(app: Hono): void {
    // Create objective
    app.post('/goals', async (c) => {
      const body = await c.req.json() as {
        name: string
        description?: string
        keyResults: Array<{
          name: string
          target: number
          unit?: string
          metricKey?: string
        }>
        period: string
        owner?: string
      }

      const objective = await this.goals.createObjective(body)
      return c.json(objective)
    })

    // List objectives
    app.get('/goals', async (c) => {
      const period = c.req.query('period')
      const objectives = await this.goals.list(period)
      return c.json(objectives)
    })

    // Get objective progress
    app.get('/goals/:nameOrId/progress', async (c) => {
      const nameOrId = decodeURIComponent(c.req.param('nameOrId') ?? '')
      const progress = await this.goals.progress(nameOrId)
      return c.json(progress)
    })

    // Update objective
    app.patch('/goals/:id', async (c) => {
      const id = c.req.param('id') ?? ''
      const updates = await c.req.json() as Partial<Objective>
      const objective = await this.goals.updateObjective(id, updates)
      return c.json(objective)
    })
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
    return new FinanceAPI(this, this.businessConfig.finance)
  }

  // ===========================================================================
  // Analytics (delegated to @dotdo/clickhouse)
  // ===========================================================================

  get analytics(): AnalyticsAPI {
    return new AnalyticsAPI(this)
  }

  // ===========================================================================
  // Aggregation RPC Methods
  // ===========================================================================

  /**
   * Execute an aggregation query (exposed via RPC).
   *
   * @param query - The parsed query specification
   * @returns Aggregation result with value, data, or total
   *
   * @example
   * ```typescript
   * // Via RPC
   * const result = await rpc(stub, 'runAggregate', [{
   *   operation: 'sum',
   *   field: 'amount',
   *   collection: 'Purchase',
   *   where: { status: 'completed' }
   * }])
   * ```
   */
  async runAggregate(query: ParsedQuery): Promise<AggregateResult> {
    // Validate query
    if (!query.operation) {
      throw new Error('Operation is required')
    }
    if (!query.collection) {
      throw new Error('Collection is required')
    }

    return this.executeAggregation(query)
  }

  // ===========================================================================
  // Internal Methods
  // ===========================================================================

  /**
   * Execute an aggregation query against the things store.
   * Performs in-memory aggregation from things.list() results.
   */
  protected async executeAggregation(query: ParsedQuery): Promise<AggregateResult> {
    // Fetch all items of the specified type
    const items = await this.things.list({ type: query.collection })

    // Apply filters
    let filtered = items

    // Apply where clause
    if (query.where) {
      filtered = filterByWhere(filtered, query.where)
    }

    // Apply time range filter
    if (query.timeRange) {
      filtered = filterByTimeRange(filtered, query.timeRange)
    }

    // Execute aggregation
    if (query.groupBy) {
      return executeGroupedAggregation(filtered, query)
    } else {
      return executeSingleAggregation(filtered, query)
    }
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
   * Create an objective from data (used by HTTP route)
   */
  async createObjective(data: {
    name: string
    description?: string
    keyResults: Array<{
      name: string
      target: number
      unit?: string
      metricKey?: string
    }>
    period: string
    owner?: string
  }): Promise<Objective> {
    const now = new Date()
    const id = generateObjectiveId()

    // Convert key results to proper format
    const keyResults: KeyResult[] = data.keyResults.map((kr) => {
      const result: KeyResult = {
        id: generateKeyResultId(),
        name: kr.name,
        targetValue: kr.target,
        currentValue: 0,
        status: 'behind' as const,
      }
      if (kr.unit !== undefined) result.unit = kr.unit
      if (kr.metricKey !== undefined) result.metricKey = kr.metricKey
      return result
    })

    // Parse period string to OKRPeriod
    const period = parsePeriod(data.period)

    // Create the objective
    const objective: Objective = {
      id,
      name: data.name,
      period,
      status: 'behind',
      keyResults,
      createdAt: now,
      updatedAt: now,
    }
    if (data.description !== undefined) objective.description = data.description
    if (data.owner !== undefined) objective.owner = data.owner

    // Build thing data, only including defined values
    const thingData: { $type: string } & Record<string, string | number | boolean | null> = {
      $type: 'Objective',
      name: objective.name,
      period: JSON.stringify(period),
      status: objective.status,
      keyResults: JSON.stringify(keyResults),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }

    // Only add optional fields if they are defined
    if (objective.description !== undefined) {
      thingData['description'] = objective.description
    }
    if (objective.owner !== undefined) {
      thingData['owner'] = objective.owner
    }

    // Store in things (let the system generate the ID)
    const thing = await this.business.things.create(thingData as { $type: string } & Record<string, unknown>)

    // Update objective with the actual generated ID
    objective.id = thing.$id as string

    return objective
  }

  /**
   * Update an objective (used by HTTP route)
   */
  async updateObjective(id: string, updates: Partial<Objective>): Promise<Objective> {
    const thing = await this.business.things.get(id)
    if (!thing || thing.$type !== 'Objective') {
      throw new Error(`Objective not found: ${id}`)
    }

    const now = new Date()

    // Merge updates
    const updateData: Record<string, string | number | boolean | null> = {
      updatedAt: now.toISOString(),
    }

    if (updates.name !== undefined) updateData['name'] = updates.name
    if (updates.description !== undefined) updateData['description'] = updates.description
    if (updates.owner !== undefined) updateData['owner'] = updates.owner
    if (updates.status !== undefined) updateData['status'] = updates.status
    if (updates.keyResults !== undefined) {
      updateData['keyResults'] = JSON.stringify(updates.keyResults)
    }

    await this.business.things.update(id, updateData as Record<string, unknown>)

    // Return updated objective
    const updated = await this.business.things.get(id)
    return this.thingToObjective(updated!)
  }

  /**
   * Get all objectives for a period
   */
  async list(period?: string): Promise<Objective[]> {
    const things = await this.business.things.list({ type: 'Objective' })

    const objectives = things.map((thing) => this.thingToObjective(thing))

    // Filter by period if specified
    if (period) {
      return objectives.filter((obj) => obj.period.name === period)
    }

    return objectives
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
    // Find objective by name or id
    const objective = await this.findObjective(nameOrId)
    if (!objective) {
      throw new Error(`Objective not found: ${nameOrId}`)
    }

    // Calculate progress for each key result
    const keyResultsProgress = objective.keyResults.map((kr) => {
      const progress = calculateKeyResultProgress(kr.currentValue, kr.targetValue)
      const status = determineStatus(progress)
      return {
        name: kr.name,
        progress,
        status,
      }
    })

    // Calculate overall progress (average of all key results)
    const overall =
      keyResultsProgress.length > 0
        ? keyResultsProgress.reduce((sum, kr) => sum + kr.progress, 0) / keyResultsProgress.length
        : 0

    // Determine overall status
    const status = determineStatus(overall)

    return {
      overall,
      keyResults: keyResultsProgress,
      status,
    }
  }

  /**
   * Find an objective by name or id
   */
  private async findObjective(nameOrId: string): Promise<Objective | null> {
    // Try by ID first
    const byId = await this.business.things.get(nameOrId)
    if (byId && byId.$type === 'Objective') {
      return this.thingToObjective(byId)
    }

    // Try by name
    const all = await this.business.things.list({ type: 'Objective' })
    const byName = all.find((thing) => thing['name'] === nameOrId)
    if (byName) {
      return this.thingToObjective(byName)
    }

    return null
  }

  /**
   * Convert a Thing to an Objective
   */
  private thingToObjective(thing: Record<string, unknown>): Objective {
    const keyResults: KeyResult[] = typeof thing['keyResults'] === 'string'
      ? JSON.parse(thing['keyResults'] as string)
      : (thing['keyResults'] as KeyResult[]) ?? []

    const period: OKRPeriod = typeof thing['period'] === 'string'
      ? JSON.parse(thing['period'] as string)
      : (thing['period'] as OKRPeriod)

    const objective: Objective = {
      id: thing['$id'] as string,
      name: thing['name'] as string,
      period,
      status: (thing['status'] as Objective['status']) ?? 'behind',
      keyResults,
      createdAt: new Date(thing['createdAt'] as string),
      updatedAt: new Date(thing['updatedAt'] as string),
    }

    // Only set optional properties if they are defined
    if (thing['description'] !== undefined) {
      objective.description = thing['description'] as string
    }
    if (thing['owner'] !== undefined) {
      objective.owner = thing['owner'] as string
    }

    return objective
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
    const keyResult: { name: string; target: number; metric?: MetricRef; unit?: string } = {
      name,
      target: options.target
    }
    if (options.metric !== undefined) keyResult.metric = options.metric
    if (options.unit !== undefined) keyResult.unit = options.unit
    this._keyResults.push(keyResult)
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
    if (field !== undefined) this._field = field
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
      collection: this._collection
    }
    if (this._field !== undefined) query.field = this._field
    if (this._where !== undefined) query.where = this._where
    if (this._groupBy !== undefined) query.groupBy = this._groupBy
    if (this._timeRange !== undefined) query.timeRange = this._timeRange

    return (this.business as any).executeAggregation(query)
  }
}

// =============================================================================
// Aggregation Helper Functions
// =============================================================================

/**
 * Filter items by where clause conditions.
 * Supports exact equality matching for all fields.
 */
function filterByWhere<T extends Record<string, unknown>>(
  items: T[],
  where: Record<string, unknown>
): T[] {
  return items.filter(item => {
    for (const [key, value] of Object.entries(where)) {
      if (item[key] !== value) {
        return false
      }
    }
    return true
  })
}

/**
 * Filter items by time range.
 * Uses $createdAt field for time comparison.
 */
function filterByTimeRange<T extends Record<string, unknown>>(
  items: T[],
  timeRange: { value: number; unit: 'hours' | 'days' | 'weeks' | 'months' }
): T[] {
  const now = Date.now()
  let msPerUnit: number

  switch (timeRange.unit) {
    case 'hours':
      msPerUnit = 60 * 60 * 1000
      break
    case 'days':
      msPerUnit = 24 * 60 * 60 * 1000
      break
    case 'weeks':
      msPerUnit = 7 * 24 * 60 * 60 * 1000
      break
    case 'months':
      msPerUnit = 30 * 24 * 60 * 60 * 1000
      break
  }

  const cutoff = now - (timeRange.value * msPerUnit)

  return items.filter(item => {
    const createdAt = item['$createdAt'] as number | undefined
    return createdAt !== undefined && createdAt >= cutoff
  })
}

/**
 * Execute a single (non-grouped) aggregation operation.
 */
function executeSingleAggregation(
  items: Record<string, unknown>[],
  query: ParsedQuery
): AggregateResult {
  const field = query.field

  switch (query.operation) {
    case 'count':
      return { value: items.length }

    case 'sum': {
      if (!field) return { value: 0 }
      const sum = items.reduce((acc, item) => {
        const val = item[field]
        return acc + (typeof val === 'number' ? val : 0)
      }, 0)
      return { value: sum }
    }

    case 'avg': {
      if (!field || items.length === 0) return { value: 0 }
      const sum = items.reduce((acc, item) => {
        const val = item[field]
        return acc + (typeof val === 'number' ? val : 0)
      }, 0)
      return { value: sum / items.length }
    }

    case 'min': {
      if (!field || items.length === 0) return { value: 0 }
      const values = items
        .map(item => item[field])
        .filter((v): v is number => typeof v === 'number')
      if (values.length === 0) return { value: 0 }
      return { value: Math.min(...values) }
    }

    case 'max': {
      if (!field || items.length === 0) return { value: 0 }
      const values = items
        .map(item => item[field])
        .filter((v): v is number => typeof v === 'number')
      if (values.length === 0) return { value: 0 }
      return { value: Math.max(...values) }
    }

    case 'distinct': {
      if (!field) return { value: 0 }
      const uniqueValues = new Set(items.map(item => item[field]))
      return { value: uniqueValues.size }
    }

    default:
      return { value: 0 }
  }
}

/**
 * Execute a grouped aggregation operation.
 * Returns data array with {key, value} for each group plus total.
 */
function executeGroupedAggregation(
  items: Record<string, unknown>[],
  query: ParsedQuery
): AggregateResult {
  const groupBy = query.groupBy!
  const field = query.field

  // Group items by the groupBy field
  const groups = new Map<string, Record<string, unknown>[]>()
  for (const item of items) {
    const key = String(item[groupBy] ?? 'undefined')
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(item)
  }

  // Calculate aggregate for each group
  const data: Array<{ key: string; value: number }> = []
  let total = 0

  for (const [key, groupItems] of groups) {
    // Create a query without groupBy for single aggregation
    const singleQuery: ParsedQuery = {
      operation: query.operation,
      collection: query.collection
    }
    if (query.field !== undefined) singleQuery.field = query.field
    if (query.where !== undefined) singleQuery.where = query.where
    if (query.timeRange !== undefined) singleQuery.timeRange = query.timeRange

    const result = executeSingleAggregation(groupItems, singleQuery)
    const value = result.value ?? 0
    data.push({ key, value })
    total += value
  }

  return { data, total }
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

  if (!operationMatch || !fromMatch || !fromMatch[1] || !operationMatch[1]) {
    throw new Error('Invalid query syntax')
  }

  const result: ParsedQuery = {
    operation: operationMatch[1] as ParsedQuery['operation'],
    collection: fromMatch[1]
  }

  // Only assign optional properties if they have values
  const fieldValue = operationMatch[2]
  if (fieldValue) result.field = fieldValue

  if (whereMatch && whereMatch[1]) {
    result.where = parseWhereClause(whereMatch[1])
  }

  if (byMatch && byMatch[1]) {
    result.groupBy = byMatch[1]
  }

  if (lastMatch && lastMatch[1] && lastMatch[2]) {
    result.timeRange = {
      value: parseInt(lastMatch[1]),
      unit: lastMatch[2].replace(/s$/, '') as 'hours' | 'days' | 'weeks' | 'months'
    }
  }

  return result
}

/**
 * Parse a where clause string into a conditions object.
 *
 * Supports:
 * - Quoted strings: `status = "completed"` -> { status: 'completed' }
 * - Single-quoted strings: `status = 'completed'` -> { status: 'completed' }
 * - Unquoted strings: `status = completed` -> { status: 'completed' }
 * - Numbers: `amount = 100` -> { amount: 100 }
 * - Booleans: `active = true` -> { active: true }
 * - Null: `deleted = null` -> { deleted: null }
 * - Multiple conditions: `status = "done" and amount = 100`
 *
 * @param clause - The where clause string to parse
 * @returns A record of field names to their values
 *
 * @example
 * ```typescript
 * parseWhereClause('status = completed') // { status: 'completed' }
 * parseWhereClause('status = "completed" and amount = 100') // { status: 'completed', amount: 100 }
 * ```
 */
export function parseWhereClause(clause: string): Record<string, unknown> {
  // Simple parser for "key = value" conditions
  const conditions: Record<string, unknown> = {}
  const parts = clause.split(/\s+and\s+/i)

  for (const part of parts) {
    const match = part.match(/(\w+)\s*=\s*(.+)/)
    if (match && match[1] && match[2]) {
      const key = match[1]
      const value = match[2]
      try {
        conditions[key] = JSON.parse(value)
      } catch {
        // Treat as unquoted string literal - trim and remove surrounding quotes if present
        conditions[key] = value.trim().replace(/^['"]|['"]$/g, '')
      }
    }
  }

  return conditions
}

// =============================================================================
// Experiment Helper Functions
// =============================================================================

/**
 * Generate a deterministic hash from a string for experiments.
 * Uses a simple djb2 hash algorithm for consistent results.
 *
 * @param str - The string to hash
 * @returns A number between 0 and 1
 */
function hashStringForExperiment(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i)
    // Ensure we stay within 32-bit integer range
    hash = hash >>> 0
  }
  // Convert to 0-1 range
  return hash / 0xFFFFFFFF
}

/**
 * Select a variant based on a hash value and variant weights.
 *
 * @param variants - Array of variants with weights
 * @param hashValue - A number between 0 and 1
 * @returns The selected variant
 */
function selectVariantByWeight(variants: Variant[], hashValue: number): Variant {
  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0)
  const normalizedHash = hashValue * totalWeight

  let cumulative = 0
  for (const variant of variants) {
    cumulative += variant.weight
    if (normalizedHash <= cumulative) {
      return variant
    }
  }

  // Fallback to last variant (should never reach here)
  return variants[variants.length - 1]
}

class ExperimentsAPI {
  constructor(private business: Business) {}

  /**
   * Create a new experiment.
   *
   * @param data - Experiment data without id, createdAt, updatedAt
   * @returns The created experiment
   */
  async create(data: Omit<Experiment, 'id' | 'createdAt' | 'updatedAt'>): Promise<Experiment> {
    const now = new Date()

    // Build thing data for storage
    const thingData: { $type: string } & Record<string, string | number | boolean | null> = {
      $type: 'Experiment',
      key: data.key,
      name: data.name,
      status: data.status ?? 'draft',
      variants: JSON.stringify(data.variants),
      targetMetric: data.targetMetric,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }

    // Add optional fields if defined
    if (data.description !== undefined) {
      thingData['description'] = data.description
    }
    if (data.startDate !== undefined) {
      thingData['startDate'] = data.startDate.toISOString()
    }
    if (data.endDate !== undefined) {
      thingData['endDate'] = data.endDate.toISOString()
    }
    if (data.minSampleSize !== undefined) {
      thingData['minSampleSize'] = data.minSampleSize
    }
    if (data.metadata !== undefined) {
      thingData['metadata'] = JSON.stringify(data.metadata)
    }

    // Store in things
    const thing = await this.business.things.create(thingData as { $type: string } & Record<string, unknown>)

    return this.thingToExperiment(thing)
  }

  /**
   * Get an experiment by key.
   *
   * @param key - The experiment key
   * @returns The experiment or null if not found
   */
  async get(key: string): Promise<Experiment | null> {
    const experiments = await this.business.things.list({ type: 'Experiment' })
    const thing = experiments.find((e) => e['key'] === key)

    if (!thing) {
      return null
    }

    return this.thingToExperiment(thing)
  }

  /**
   * List all experiments.
   *
   * @returns Array of experiments
   */
  async list(): Promise<Experiment[]> {
    const things = await this.business.things.list({ type: 'Experiment' })
    return things.map((thing) => this.thingToExperiment(thing))
  }

  /**
   * Assign a user to a variant in an experiment.
   * Uses deterministic hashing for consistent assignment.
   *
   * @param experimentKey - The experiment key
   * @param userId - The user ID to assign
   * @returns The assigned variant
   */
  async assign(experimentKey: string, userId: string): Promise<Variant> {
    // Check for existing assignment
    const existingAssignment = await this.getAssignment(experimentKey, userId)
    if (existingAssignment) {
      // Return the stored variant
      const experiment = await this.get(experimentKey)
      if (!experiment) {
        throw new Error(`Experiment not found: ${experimentKey}`)
      }
      const variant = experiment.variants.find((v) => v.key === existingAssignment.variantKey)
      if (variant) {
        return variant
      }
    }

    // Get the experiment
    const experiment = await this.get(experimentKey)
    if (!experiment) {
      throw new Error(`Experiment not found: ${experimentKey}`)
    }

    // Generate deterministic hash from experiment key + user id
    const hashInput = `${experimentKey}:${userId}`
    const hashValue = hashStringForExperiment(hashInput)

    // Select variant based on weights
    const variant = selectVariantByWeight(experiment.variants, hashValue)

    // Store the assignment
    await this.storeAssignment(experimentKey, userId, variant.key)

    return variant
  }

  /**
   * Get the variant assigned to a user for an experiment.
   *
   * @param experimentKey - The experiment key
   * @param userId - The user ID
   * @returns The assigned variant or null
   */
  async getVariant(experimentKey: string, userId: string): Promise<Variant | null> {
    const assignment = await this.getAssignment(experimentKey, userId)
    if (!assignment) {
      return null
    }

    const experiment = await this.get(experimentKey)
    if (!experiment) {
      return null
    }

    return experiment.variants.find((v) => v.key === assignment.variantKey) ?? null
  }

  /**
   * Update the status of an experiment.
   *
   * @param key - The experiment key
   * @param status - The new status
   * @returns The updated experiment
   */
  async updateStatus(key: string, status: 'draft' | 'running' | 'paused' | 'completed'): Promise<Experiment> {
    const experiment = await this.get(key)
    if (!experiment) {
      throw new Error(`Experiment not found: ${key}`)
    }

    const now = new Date()

    await this.business.things.update(experiment.id, {
      status,
      updatedAt: now.toISOString(),
    } as Record<string, unknown>)

    // Return updated experiment
    const updated = await this.get(key)
    return updated!
  }

  /**
   * Get experiment results with conversion metrics.
   *
   * @param experimentKey - The experiment key
   * @returns Results with variant metrics
   */
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
    // This requires analytics integration
    throw new Error('Not implemented - requires @dotdo/clickhouse integration')
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Get an existing assignment for a user.
   */
  private async getAssignment(experimentKey: string, userId: string): Promise<{ variantKey: string } | null> {
    const assignments = await this.business.things.list({ type: 'ExperimentAssignment' })
    const assignment = assignments.find(
      (a) => a['experimentKey'] === experimentKey && a['userId'] === userId
    )

    if (!assignment) {
      return null
    }

    return { variantKey: assignment['variantKey'] as string }
  }

  /**
   * Store a new assignment.
   */
  private async storeAssignment(experimentKey: string, userId: string, variantKey: string): Promise<void> {
    const now = new Date()

    await this.business.things.create({
      $type: 'ExperimentAssignment',
      experimentKey,
      userId,
      variantKey,
      assignedAt: now.toISOString(),
    })
  }

  /**
   * Convert a Thing to an Experiment.
   */
  private thingToExperiment(thing: Record<string, unknown>): Experiment {
    const variants: Variant[] = typeof thing['variants'] === 'string'
      ? JSON.parse(thing['variants'] as string)
      : (thing['variants'] as Variant[]) ?? []

    const experiment: Experiment = {
      id: thing['$id'] as string,
      key: thing['key'] as string,
      name: thing['name'] as string,
      status: (thing['status'] as Experiment['status']) ?? 'draft',
      variants,
      targetMetric: thing['targetMetric'] as string,
      createdAt: new Date(thing['createdAt'] as string),
      updatedAt: new Date(thing['updatedAt'] as string),
    }

    // Add optional properties if they exist
    if (thing['description'] !== undefined) {
      experiment.description = thing['description'] as string
    }
    if (thing['startDate'] !== undefined) {
      experiment.startDate = new Date(thing['startDate'] as string)
    }
    if (thing['endDate'] !== undefined) {
      experiment.endDate = new Date(thing['endDate'] as string)
    }
    if (thing['minSampleSize'] !== undefined) {
      experiment.minSampleSize = thing['minSampleSize'] as number
    }
    if (thing['metadata'] !== undefined) {
      experiment.metadata = typeof thing['metadata'] === 'string'
        ? JSON.parse(thing['metadata'] as string)
        : thing['metadata'] as Record<string, unknown>
    }

    return experiment
  }
}

// =============================================================================
// Feature Flags Helper Functions
// =============================================================================

/**
 * Simple string hash function for deterministic percentage rollout.
 * Uses djb2 algorithm - fast and produces good distribution.
 *
 * @param str - String to hash (typically flagKey + userId)
 * @returns A number in range 0-99 for percentage comparison
 */
function hashForRollout(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i)
    // Ensure we stay within 32-bit integer range
    hash = hash >>> 0
  }
  return hash % 100
}

// =============================================================================
// FlagsAPI - Feature Flags
// =============================================================================

class FlagsAPI {
  constructor(private business: Business) {}

  /**
   * Create a new feature flag
   */
  async create(data: Omit<FeatureFlag, 'id' | 'createdAt' | 'updatedAt'>): Promise<FeatureFlag> {
    const now = new Date()

    // Build thing data with proper typing
    const thingData: { $type: string } & Record<string, string | number | boolean | null> = {
      $type: 'FeatureFlag',
      key: data.key,
      name: data.name,
      enabled: data.enabled,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }

    // Add optional fields only if defined
    if (data.description !== undefined) {
      thingData['description'] = data.description
    }
    if (data.rolloutPercentage !== undefined) {
      thingData['rolloutPercentage'] = data.rolloutPercentage
    }
    if (data.targetSegments !== undefined) {
      thingData['targetSegments'] = JSON.stringify(data.targetSegments)
    }
    if (data.overrides !== undefined) {
      thingData['overrides'] = JSON.stringify(data.overrides)
    }
    if (data.metadata !== undefined) {
      thingData['metadata'] = JSON.stringify(data.metadata)
    }

    const thing = await this.business.things.create(thingData as { $type: string } & Record<string, unknown>)
    return this.thingToFeatureFlag(thing)
  }

  /**
   * Get a feature flag by key
   */
  async get(key: string): Promise<FeatureFlag | null> {
    const flag = await this.findFlagByKey(key)
    return flag
  }

  /**
   * Check if a feature flag is enabled for a user.
   *
   * Evaluation order:
   * 1. If flag doesn't exist, return false
   * 2. If flag is disabled (enabled=false), return false (unless user has override)
   * 3. Check user-specific overrides first
   * 4. Check rollout percentage using deterministic hash
   * 5. If no rollout percentage, return flag.enabled
   */
  async isEnabled(key: string, userId?: string): Promise<boolean> {
    const flag = await this.findFlagByKey(key)

    // Flag doesn't exist
    if (!flag) {
      return false
    }

    // Check user-specific override first
    if (userId && flag.overrides && userId in flag.overrides) {
      return Boolean(flag.overrides[userId])
    }

    // If flag is disabled, return false
    if (!flag.enabled) {
      return false
    }

    // Check rollout percentage
    if (flag.rolloutPercentage !== undefined) {
      // If no userId, use empty string for deterministic result
      const hashInput = key + (userId ?? '')
      const bucket = hashForRollout(hashInput)
      return bucket < flag.rolloutPercentage
    }

    // Default to enabled status
    return flag.enabled
  }

  /**
   * List all feature flags
   */
  async list(): Promise<FeatureFlag[]> {
    const things = await this.business.things.list({ type: 'FeatureFlag' })
    return things.map((thing) => this.thingToFeatureFlag(thing))
  }

  /**
   * Update a feature flag by key
   */
  async update(key: string, data: Partial<FeatureFlag>): Promise<FeatureFlag> {
    const flag = await this.findFlagByKey(key)
    if (!flag) {
      throw new Error(`Feature flag not found: ${key}`)
    }

    const now = new Date()

    // Build update data
    const updateData: Record<string, string | number | boolean | null> = {
      updatedAt: now.toISOString(),
    }

    if (data.name !== undefined) updateData['name'] = data.name
    if (data.description !== undefined) updateData['description'] = data.description
    if (data.enabled !== undefined) updateData['enabled'] = data.enabled
    if (data.rolloutPercentage !== undefined) updateData['rolloutPercentage'] = data.rolloutPercentage
    if (data.targetSegments !== undefined) updateData['targetSegments'] = JSON.stringify(data.targetSegments)
    if (data.overrides !== undefined) updateData['overrides'] = JSON.stringify(data.overrides)
    if (data.metadata !== undefined) updateData['metadata'] = JSON.stringify(data.metadata)

    const updated = await this.business.things.update(flag.id, updateData as Record<string, unknown>)
    return this.thingToFeatureFlag(updated)
  }

  /**
   * Delete a feature flag by key
   */
  async delete(key: string): Promise<boolean> {
    const flag = await this.findFlagByKey(key)
    if (!flag) {
      return false
    }

    await this.business.things.delete(flag.id)
    return true
  }

  /**
   * Find a flag by its key (not by id)
   */
  private async findFlagByKey(key: string): Promise<FeatureFlag | null> {
    const all = await this.business.things.list({ type: 'FeatureFlag' })
    const match = all.find((thing) => thing['key'] === key)
    if (match) {
      return this.thingToFeatureFlag(match)
    }
    return null
  }

  /**
   * Convert a Thing to a FeatureFlag
   */
  private thingToFeatureFlag(thing: Record<string, unknown>): FeatureFlag {
    const result: FeatureFlag = {
      id: thing['$id'] as string,
      key: thing['key'] as string,
      name: thing['name'] as string,
      enabled: thing['enabled'] as boolean,
      createdAt: new Date(thing['createdAt'] as string),
      updatedAt: new Date(thing['updatedAt'] as string),
    }

    // Conditionally add optional properties only if they exist
    if (thing['description'] !== undefined) {
      result.description = thing['description'] as string
    }
    if (thing['rolloutPercentage'] !== undefined) {
      result.rolloutPercentage = thing['rolloutPercentage'] as number
    }
    if (thing['targetSegments'] !== undefined) {
      result.targetSegments = typeof thing['targetSegments'] === 'string'
        ? JSON.parse(thing['targetSegments'] as string)
        : thing['targetSegments'] as string[]
    }
    if (thing['overrides'] !== undefined) {
      result.overrides = typeof thing['overrides'] === 'string'
        ? JSON.parse(thing['overrides'] as string)
        : thing['overrides'] as Record<string, boolean | string | number>
    }
    if (thing['metadata'] !== undefined) {
      result.metadata = typeof thing['metadata'] === 'string'
        ? JSON.parse(thing['metadata'] as string)
        : thing['metadata'] as Record<string, unknown>
    }

    return result
  }
}

/**
 * Finance API - Delegates to FinancialClient (StripeProvider)
 *
 * Provides financial operations for SaaS businesses including:
 * - Customer management
 * - Subscription management
 * - Invoice operations
 * - Payment processing
 * - SaaS metrics (MRR, ARR, etc.)
 *
 * @example
 * ```typescript
 * // Access via Business instance
 * const customer = await business.finance.customers.create({
 *   email: 'alice@example.com',
 *   name: 'Alice',
 * })
 *
 * const metrics = await business.finance.metrics.getSaaSMetrics()
 * console.log(`MRR: $${metrics.mrr / 100}`)
 * ```
 */
class FinanceAPI {
  private provider: FinancialClient | null = null
  private config: BusinessConfig['finance']

  constructor(private business: Business | null, config: BusinessConfig['finance'] = {}) {
    this.config = config

    // Initialize Stripe provider if API key is provided
    if (config?.stripeApiKey) {
      const stripeConfig: { apiKey: string; webhookSecret?: string } = {
        apiKey: config.stripeApiKey,
      }
      if (config.webhookSecret) {
        stripeConfig.webhookSecret = config.webhookSecret
      }
      this.provider = createStripeClient(stripeConfig)
    }
  }

  /**
   * Ensure provider is configured, throw helpful error if not
   */
  private ensureProvider(): FinancialClient {
    if (!this.provider) {
      throw new Error('Stripe is not configured. Provide stripeApiKey in finance config.')
    }
    return this.provider
  }

  /**
   * Customer operations
   */
  get customers(): FinancialClient['customers'] {
    return this.ensureProvider().customers
  }

  /**
   * Subscription operations
   */
  get subscriptions(): FinancialClient['subscriptions'] {
    return this.ensureProvider().subscriptions
  }

  /**
   * Invoice operations
   */
  get invoices(): FinancialClient['invoices'] {
    return this.ensureProvider().invoices
  }

  /**
   * Payment operations
   */
  get payments(): FinancialClient['payments'] {
    return this.ensureProvider().payments
  }

  /**
   * SaaS metrics (MRR, ARR, etc.)
   */
  get metrics(): FinancialClient['metrics'] {
    return this.ensureProvider().metrics
  }

  /**
   * Webhook handling
   */
  get webhooks(): FinancialClient['webhooks'] {
    return this.ensureProvider().webhooks
  }
}

/**
 * FinanceAPI variant that accepts a pre-configured FinancialClient
 * This is primarily for testing with mocks
 */
class FinanceAPIWithProvider {
  private provider: FinancialClient

  constructor(
    private business: Business | null,
    config: BusinessConfig['finance'] = {},
    provider: FinancialClient
  ) {
    this.provider = provider
  }

  get customers(): FinancialClient['customers'] {
    return this.provider.customers
  }

  get subscriptions(): FinancialClient['subscriptions'] {
    return this.provider.subscriptions
  }

  get invoices(): FinancialClient['invoices'] {
    return this.provider.invoices
  }

  get payments(): FinancialClient['payments'] {
    return this.provider.payments
  }

  get metrics(): FinancialClient['metrics'] {
    return this.provider.metrics
  }

  get webhooks(): FinancialClient['webhooks'] {
    return this.provider.webhooks
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

export { GoalsAPI, AggregateBuilder, MetricRef, FinanceAPI, FinanceAPIWithProvider }
