/**
 * OKR (Objectives and Key Results) Module
 *
 * This module provides type definitions and utilities for OKRs:
 * - Objective: Strategic goals with associated key results
 * - KeyResult: Measurable outcomes with metrics, targets, and measurements
 * - Metric: PascalCase branded type for metric names
 * - defineOKR: Factory function to create typed OKRs with progress tracking
 * - defineMetric: Factory function to create reusable metric definitions
 *
 * @example
 * import { defineOKR, defineMetric } from 'lib/okrs'
 *
 * const okr = defineOKR({
 *   objective: 'Launch MVP successfully',
 *   keyResults: [
 *     { metric: 'ActiveUsers', target: 1000, current: 500 },
 *     { metric: 'NPS', target: 50, current: 30 },
 *   ],
 * })
 *
 * console.log(okr.progress())    // 0.55
 * console.log(okr.isComplete())  // false
 */

export type { Objective, KeyResult, Metric, PascalCase, MeasurementFunction } from './types'
export type {
  OKR,
  OKRConfig,
  OKRKeyResultConfig,
  MetricConfig,
  MetricDefinition,
  AnalyticsContext,
  PrebuiltMetricConfig,
  PrebuiltMetric,
} from './define'
export { defineOKR, defineMetric } from './define'

// Pre-built OKRs
export { ProductOKRs, FeatureAdoption, UserSatisfaction, TimeToValue } from './prebuilt/product'
export { SaaSKRs, MRR, Churn, NRR, CAC, LTV } from './prebuilt/saas'
export { GrowthOKRs, BrandAwareness, ContentEngagement, LeadGeneration } from './prebuilt/growth'
export {
  EngineeringOKRs,
  BuildVelocity,
  CodeQuality,
  SystemReliability,
  ReviewThroughput,
} from './prebuilt/engineering'
export { SalesOKRs, PipelineHealth, ConversionRate, RevenueGrowth } from './prebuilt/sales'
export {
  SupportOKRs,
  ResponseTime,
  ResolutionRate,
  CustomerSatisfaction,
  CustomerSuccessOKRs,
  NetRetention,
  ExpansionRevenue,
  ChurnPrevention,
} from './prebuilt/support'
