/**
 * OKR Type Definitions
 *
 * Defines types for Objectives and Key Results (OKRs):
 * - Objective: Strategic goal with name and associated key results
 * - KeyResult: Measurable outcome with metric, target, current value, and optional measurement function
 * - Metric: PascalCase branded string type for metric names
 * - PascalCase: Type helper for enforcing PascalCase naming convention
 */

/**
 * PascalCase type helper for enforcing naming conventions.
 * At compile time, this enforces that metric names follow PascalCase convention.
 * Runtime behavior is standard string.
 *
 * @example
 * const metric: PascalCase = 'MonthlyActiveUsers' as PascalCase // Valid
 */
export type PascalCase = string & { readonly __brand: 'PascalCase' }

/**
 * Metric type for OKR metric names.
 * Metrics should be named in PascalCase (e.g., MonthlyActiveUsers, Revenue, ChurnRate).
 * This is a branded type that can be used with string literals.
 *
 * @example
 * const metric: Metric = 'ConversionRate' as Metric
 */
export type Metric = string

/**
 * Measurement function type.
 * Can be synchronous or asynchronous, returns a numeric value representing the current measurement.
 *
 * @example
 * const measureUptime = () => 99.9
 * const measureFromAPI = async () => fetchMetricValue()
 */
export type MeasurementFunction = () => number | Promise<number>

/**
 * KeyResult represents a measurable outcome for an Objective.
 *
 * @property metric - The name of what is being measured (PascalCase convention)
 * @property target - The target value to achieve
 * @property current - The current value
 * @property measurement - Optional function reference for measuring the current value
 *
 * @example
 * const kr: KeyResult = {
 *   metric: 'MonthlyActiveUsers',
 *   target: 10000,
 *   current: 5000,
 *   measurement: async () => await fetchActiveUsers(),
 * }
 */
export interface KeyResult {
  /**
   * The name of the metric being measured.
   * Should follow PascalCase naming convention (e.g., MonthlyActiveUsers, Revenue, NPS).
   */
  metric: string

  /**
   * The target value to achieve for this key result.
   * Can be any number (positive, negative, zero, decimal).
   */
  target: number

  /**
   * The current value of this key result.
   * Can be any number (positive, negative, zero, decimal).
   */
  current: number

  /**
   * Optional function reference for measuring the current value.
   * When provided, can be called to get the latest measurement.
   * Can be synchronous or asynchronous.
   */
  measurement?: MeasurementFunction
}

/**
 * Objective represents a strategic goal with associated key results.
 *
 * @property name - The name/description of the objective
 * @property keyResults - Array of measurable key results for this objective
 *
 * @example
 * const objective: Objective = {
 *   name: 'Increase user engagement',
 *   keyResults: [
 *     { metric: 'DailyActiveUsers', target: 5000, current: 3000 },
 *     { metric: 'SessionDuration', target: 15, current: 10 },
 *   ],
 * }
 */
export interface Objective {
  /**
   * The name or description of the objective.
   * Should be a clear statement of what you want to achieve.
   */
  name: string

  /**
   * Array of key results that measure progress toward this objective.
   * Can be empty initially and populated as metrics are defined.
   */
  keyResults: KeyResult[]
}
