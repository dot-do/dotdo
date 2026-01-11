/**
 * $.track Event Tracking API
 *
 * Provides comprehensive event tracking with analytics capabilities:
 * - Basic event tracking: $.track.Signup({ userId, plan })
 * - Batch tracking: $.track.batch([...])
 * - Query counts: $.track.Signup.count().since('7d')
 * - Funnel analysis: $.track.funnel([...]).within('7d')
 * - Cohort analysis: $.track.cohort({...})
 * - Subscriptions: $.track.Signup.subscribe(handler)
 *
 * @module workflows/data/track
 */

export {
  createTrackContext,
  $step,
  type TrackContext,
  type TrackedEvent,
  type EventSubscription,
  type FunnelStepResult,
  type FunnelResult,
  type CohortResult,
  type TimeSeriesPoint,
  type FilterOperators,
  type TrackOptions,
  type FunnelStep,
  type CohortConfig,
} from './context'
