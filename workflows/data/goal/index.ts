/**
 * $.goal - OKR and Target Tracking API
 *
 * Part of the $ Data API for Business-as-Code.
 *
 * Usage:
 * ```typescript
 * // Define goals
 * $.goal.define('Q1-revenue', {
 *   target: $.measure.revenue.sum().reach(100_000),
 *   by: '2024-03-31',
 *   owner: 'founder',
 * })
 *
 * // Check progress
 * const progress = await $.goal('Q1-revenue').progress()
 * // { current: 72000, target: 100000, percent: 72, onTrack: true, ... }
 *
 * // Set alerts
 * $.goal('Q1-revenue').alert({
 *   when: 'off-track',
 *   notify: async (goal) => await $.Slack('founders').post(`Goal at risk: ${goal.name}`)
 * })
 *
 * // Track history
 * const history = await $.goal('Q1-revenue').history()
 * ```
 *
 * @module workflows/data/goal
 */

export * from './context'
