/**
 * Business - Multi-tenant organization
 *
 * Top-level container for Apps, Sites, and organizational data.
 * Examples: 'acme-corp', 'startup-inc'
 *
 * Provides pre-configured OKRs for common business metrics:
 * - Revenue: Track MRR and ARR targets
 * - Costs: Track OpEx and COGS
 * - Profit: Track GrossMargin and NetMargin percentages
 */

import { DO, Env, type OKR } from '../core/DO'
import { Business as BusinessNoun } from '../../nouns/business/Business'

export interface BusinessConfig {
  name: string
  slug: string
  plan?: 'free' | 'pro' | 'enterprise'
  settings?: Record<string, unknown>
}

export class Business extends DO {
  static override readonly $type: string = BusinessNoun.$type
  static readonly noun = BusinessNoun

  private config: BusinessConfig | null = null

  /**
   * Pre-configured OKRs for business financial metrics.
   *
   * - Revenue: Track monthly and annual recurring revenue (MRR, ARR)
   * - Costs: Track operating expenses and cost of goods sold (OpEx, COGS)
   * - Profit: Track gross and net profit margins (GrossMargin, NetMargin)
   *
   * Subclasses can extend or override OKRs in their constructor:
   * ```typescript
   * class MyBusiness extends Business {
   *   constructor(ctx: DurableObjectState, env: Env) {
   *     super(ctx, env)
   *     // Add custom OKRs
   *     this.okrs.CustomerGrowth = this.defineOKR({
   *       objective: 'Grow customer base',
   *       keyResults: [{ name: 'TotalCustomers', target: 1000 }],
   *     })
   *     // Or override defaults with custom targets
   *     this.okrs.Revenue = this.defineOKR({
   *       objective: 'Hit aggressive revenue targets',
   *       keyResults: [
   *         { name: 'MRR', target: 50000, current: 0, unit: '$' },
   *         { name: 'ARR', target: 600000, current: 0, unit: '$' },
   *       ],
   *     })
   *   }
   * }
   * ```
   */
  override okrs: Record<string, OKR> = {
    Revenue: this.defineOKR({
      objective: 'Achieve revenue targets',
      keyResults: [
        { name: 'MRR', target: 10000, current: 0, unit: '$' },
        { name: 'ARR', target: 120000, current: 0, unit: '$' },
      ],
    }),
    Costs: this.defineOKR({
      objective: 'Manage costs efficiently',
      keyResults: [
        { name: 'OpEx', target: 5000, current: 0, unit: '$' },
        { name: 'COGS', target: 3000, current: 0, unit: '$' },
      ],
    }),
    Profit: this.defineOKR({
      objective: 'Achieve profitability targets',
      keyResults: [
        { name: 'GrossMargin', target: 70, current: 0, unit: '%' },
        { name: 'NetMargin', target: 20, current: 0, unit: '%' },
      ],
    }),
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Initialize or get business configuration
   */
  async getConfig(): Promise<BusinessConfig | null> {
    if (!this.config) {
      this.config = (await this.ctx.storage.get('config')) as BusinessConfig | null
    }
    return this.config
  }

  /**
   * Set business configuration
   */
  async setConfig(config: BusinessConfig): Promise<void> {
    this.config = config
    await this.ctx.storage.put('config', config)
    await this.emit('business.configured', { config })
  }

  /**
   * Create an App within this business
   */
  async createApp(appId: string, name: string): Promise<void> {
    await this.link({
      doId: appId,
      doClass: 'App',
      role: 'child',
      data: { name },
    })
    await this.emit('app.created', { appId, name })
  }

  /**
   * List all Apps in this business
   */
  async listApps(): Promise<{ doId: string; name: string }[]> {
    const objects = await this.getLinkedObjects('child')
    return objects.filter((o) => o.doClass === 'App').map((o) => ({ doId: o.doId, name: (o.data as any)?.name || '' }))
  }

  /**
   * Get business members (Workers: Agents and Humans)
   */
  async listMembers(): Promise<{ doId: string; doClass: string; role: string }[]> {
    const objects = await this.getLinkedObjects()
    return objects
      .filter((o) => o.doClass === 'Agent' || o.doClass === 'Human')
      .map((o) => ({
        doId: o.doId,
        doClass: o.doClass || 'Worker',
        role: (o.data as Record<string, unknown> | undefined)?.role as string || o.relationType || 'member',
      }))
  }

  /**
   * Add a member to this business
   */
  async addMember(workerId: string, workerClass: 'Agent' | 'Human', role: string = 'member'): Promise<void> {
    await this.link({
      doId: workerId,
      doClass: workerClass,
      role,
    })
    await this.emit('member.added', { workerId, workerClass, role })
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/config') {
      if (request.method === 'GET') {
        const config = await this.getConfig()
        return new Response(JSON.stringify(config), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (request.method === 'PUT') {
        const config = (await request.json()) as BusinessConfig
        await this.setConfig(config)
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/apps') {
      const apps = await this.listApps()
      return new Response(JSON.stringify(apps), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/members') {
      const members = await this.listMembers()
      return new Response(JSON.stringify(members), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return super.fetch(request)
  }
}

export default Business
