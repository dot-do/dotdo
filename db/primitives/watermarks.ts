/**
 * Watermarks - Event-time progress tracking primitive
 *
 * Watermarks track the progress of event-time through a streaming system.
 * They represent the point in time up to which all events have been observed.
 *
 * Key concepts:
 * - Monotonic advancement (watermarks never go backwards)
 * - Multi-source aggregation (min across all sources)
 * - Idle source handling (don't block watermark on inactive sources)
 * - Bounded out-of-orderness (allow late events within a window)
 *
 * @module db/primitives/watermarks
 */

// Re-export everything from watermark-service for backwards compatibility
// The "Service" suffix is redundant - this is simply Watermarks
export {
  createWatermarkService,
  createWatermarkService as createWatermarks,
  WatermarkService,
  WatermarkService as Watermarks,
  type WatermarkServiceInterface,
  type WatermarkServiceInterface as WatermarksInterface,
  type Duration,
  type Unsubscribe,
} from './watermark-service'
