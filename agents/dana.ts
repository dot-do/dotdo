/**
 * Dana - Data/Analytics Agent
 *
 * Dana is the Data/Analytics agent in the dotdo Business-as-Code framework.
 * Responsible for:
 * - Analyzing metrics and KPIs
 * - Generating data-driven insights
 * - Building reports and dashboards
 * - Tracking feature adoption and engagement
 * - Calculating business metrics (churn, retention, ARPU)
 *
 * @example
 * ```ts
 * import { dana } from 'agents.do'
 *
 * // Template literal syntax
 * const insights = await dana`which features have low adoption?`
 *
 * // Analyze specific metrics
 * const report = await dana`generate quarterly churn report`
 *
 * // Cohort analysis
 * const cohorts = await dana`analyze retention by signup cohort`
 * ```
 *
 * @see dotdo-7z40u - TDD: Dana agent (data/analytics)
 * @module agents/dana
 */

// Re-export dana from the named agents factory
export { dana } from './named/factory'

// Also export from named index for convenience
export { dana as default } from './named/factory'
