/**
 * Startup - SaaS application with startup-specific OKRs
 *
 * Extends SaaS (which extends App) to add startup-specific metrics tracking:
 * - Runway: Months of cash remaining
 * - Burn: Monthly burn rate
 * - GrowthRate: Month-over-month growth percentage
 * - PMFScore: Product-Market Fit score (0-100)
 *
 * @example
 * ```typescript
 * class MyStartup extends Startup {
 *   // Inherits: all SaaS metrics (subscriptions, usage, plans)
 *   // Has: Runway, Burn, GrowthRate, PMFScore OKRs
 *
 *   override okrs = {
 *     ...super.okrs,
 *     CustomerSatisfaction: this.defineOKR({
 *       objective: 'Achieve high customer satisfaction',
 *       keyResults: [{ name: 'NPS', target: 50, current: 0 }],
 *     }),
 *   }
 * }
 * ```
 */

import { SaaS } from './SaaS'
import { Env } from '../core/DO'
import type { OKR } from '../core/DOBase'
import { Startup as StartupNoun } from '../../nouns/business/Startup'
import type { AnyNoun } from '../../nouns/types'

export class Startup extends SaaS {
  static override readonly $type: string = StartupNoun.$type
  static override readonly noun: AnyNoun = StartupNoun

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Startup-specific OKRs for tracking key startup metrics.
   * Includes Runway, Burn, GrowthRate, and PMFScore.
   */
  override okrs: Record<string, OKR> = {
    /**
     * Runway OKR - Track months of cash remaining
     * Target: 18 months (healthy runway for Series A startups)
     */
    Runway: this.defineOKR({
      objective: 'Maintain healthy cash runway',
      keyResults: [
        { name: 'MonthsRemaining', target: 18, current: 0, unit: 'months' },
      ],
    }),

    /**
     * Burn OKR - Track monthly burn rate
     * Target: $50,000/month (typical early-stage startup)
     * Note: Lower is better, so current should approach target from above
     */
    Burn: this.defineOKR({
      objective: 'Control monthly burn rate',
      keyResults: [
        { name: 'MonthlyBurn', target: 50000, current: 0, unit: 'USD' },
      ],
    }),

    /**
     * GrowthRate OKR - Track month-over-month growth
     * Target: 15% MoM growth (healthy SaaS growth rate)
     */
    GrowthRate: this.defineOKR({
      objective: 'Achieve sustainable growth',
      keyResults: [
        { name: 'MoMGrowth', target: 15, current: 0, unit: '%' },
      ],
    }),

    /**
     * PMFScore OKR - Track Product-Market Fit score
     * Target: 100 (perfect PMF)
     * Based on Sean Ellis test: "How would you feel if you could no longer use this product?"
     * Score = % who say "Very disappointed"
     */
    PMFScore: this.defineOKR({
      objective: 'Achieve Product-Market Fit',
      keyResults: [
        { name: 'Score', target: 100, current: 0 },
      ],
    }),
  }
}

export default Startup
