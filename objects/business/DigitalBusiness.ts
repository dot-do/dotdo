/**
 * DigitalBusiness - Digital business with online metrics
 *
 * Extends Business with Traffic, Conversion, Engagement OKRs.
 * Base class for SaaS, Marketplace, API, and Directory business types.
 *
 * @example
 * ```typescript
 * class MyApp extends DigitalBusiness {
 *   // Inherits: Revenue, Costs, Profit, Traffic, Conversion, Engagement
 * }
 * ```
 */

import { Business, BusinessConfig } from './Business'
import { Env } from '../core/DO'
import type { OKR } from '../core/DOBase'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface DigitalBusinessConfig extends BusinessConfig {
  /** Primary domain for the digital business */
  domain?: string
  /** Analytics tracking ID */
  analyticsId?: string
}

// ============================================================================
// DIGITALBUSINESS CLASS
// ============================================================================

/**
 * OKR with serializable format for HTTP responses
 */
interface SerializedOKR {
  objective: string
  keyResults: Array<{
    name: string
    target: number
    current: number
    unit?: string
  }>
  progress: number
  isComplete: boolean
}

export class DigitalBusiness extends Business {
  static override readonly $type: string = 'DigitalBusiness'

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * OKRs for DigitalBusiness
   *
   * Includes inherited Business OKRs (Revenue, Costs, Profit)
   * plus digital-specific metrics (Traffic, Conversion, Engagement)
   */
  override okrs: Record<string, OKR> = {
    // Inherited from Business
    Revenue: this.defineOKR({
      objective: 'Grow revenue',
      keyResults: [
        { name: 'TotalRevenue', target: 100000, current: 0, unit: '$' },
        { name: 'RevenueGrowthRate', target: 20, current: 0, unit: '%' },
      ],
    }),
    Costs: this.defineOKR({
      objective: 'Optimize costs',
      keyResults: [
        { name: 'TotalCosts', target: 50000, current: 0, unit: '$' },
        { name: 'CostReduction', target: 10, current: 0, unit: '%' },
      ],
    }),
    Profit: this.defineOKR({
      objective: 'Maximize profit',
      keyResults: [
        { name: 'NetProfit', target: 50000, current: 0, unit: '$' },
        { name: 'ProfitMargin', target: 50, current: 0, unit: '%' },
      ],
    }),
    // Digital Business OKRs
    Traffic: this.defineOKR({
      objective: 'Increase website traffic',
      keyResults: [
        { name: 'MonthlyVisitors', target: 100000, current: 0 },
        { name: 'UniqueVisitors', target: 50000, current: 0 },
        { name: 'PageViews', target: 300000, current: 0 },
      ],
    }),
    Conversion: this.defineOKR({
      objective: 'Improve conversion rates',
      keyResults: [
        { name: 'VisitorToSignup', target: 10, current: 0, unit: '%' },
        { name: 'SignupToCustomer', target: 25, current: 0, unit: '%' },
        { name: 'OverallConversion', target: 2.5, current: 0, unit: '%' },
      ],
    }),
    Engagement: this.defineOKR({
      objective: 'Boost user engagement',
      keyResults: [
        { name: 'DAU', target: 10000, current: 0 },
        { name: 'MAU', target: 50000, current: 0 },
        { name: 'DAUMAURatio', target: 20, current: 0, unit: '%' },
        { name: 'SessionDuration', target: 300, current: 0, unit: 'seconds' },
      ],
    }),
  }

  // ==========================================================================
  // OKR HTTP API HELPERS
  // ==========================================================================

  /**
   * Serialize an OKR for HTTP response
   */
  private serializeOKR(okr: OKR): SerializedOKR {
    return {
      objective: okr.objective,
      keyResults: okr.keyResults.map((kr) => ({
        name: kr.name,
        target: kr.target,
        current: kr.current,
        unit: kr.unit,
      })),
      progress: okr.progress(),
      isComplete: okr.isComplete(),
    }
  }

  /**
   * Get all OKRs in serialized format
   */
  getAllOKRs(): Record<string, SerializedOKR> {
    const result: Record<string, SerializedOKR> = {}
    for (const [name, okr] of Object.entries(this.okrs)) {
      result[name] = this.serializeOKR(okr)
    }
    return result
  }

  /**
   * Get a specific OKR by name
   */
  getOKR(name: string): SerializedOKR | null {
    const okr = this.okrs[name]
    if (!okr) return null
    return this.serializeOKR(okr)
  }

  // ==========================================================================
  // HTTP ENDPOINTS
  // ==========================================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // /okrs - GET all OKRs
    if (url.pathname === '/okrs' && request.method === 'GET') {
      const okrs = this.getAllOKRs()
      return new Response(JSON.stringify(okrs), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // /okrs/:name - GET specific OKR
    const okrMatch = url.pathname.match(/^\/okrs\/(\w+)$/)
    if (okrMatch && request.method === 'GET') {
      const okrName = okrMatch[1]
      const okr = this.getOKR(okrName!)
      if (!okr) {
        return new Response(JSON.stringify({ error: `OKR "${okrName}" not found` }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(okr), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Fall through to parent Business handler
    return super.fetch(request)
  }
}

export default DigitalBusiness
