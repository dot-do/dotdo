/**
 * Event Transformers
 *
 * Transforms various event formats to the UnifiedEvent schema.
 * Each transformer maps source-specific fields to the 162-column unified schema.
 *
 * @module db/streams/transformers
 */

export {
  transformDoEvent,
  transformDoEvents,
  type DoEventInput,
} from './do-event'

export {
  transformCdcEvent,
  type CdcEvent,
  type CdcOperation,
} from './cdc'

export {
  transformDoAction,
  type ActionInput,
} from './do-action'

export {
  transformSegmentTrack,
  type SegmentTrackEvent,
} from './segment-track'

export {
  mapSegmentContext,
  mapPageContext,
  mapCampaignContext,
  mapDeviceContext,
  mapOsContext,
  normalizeTimestamp,
  generateEventId,
  type SegmentContext,
  type SegmentPageContext,
  type SegmentCampaignContext,
  type SegmentDeviceContext,
  type SegmentOsContext,
} from './segment-context'

export {
  transformOtelSpan,
  SpanKind,
  StatusCode,
  type OtlpSpan,
  type OtlpResource,
  type OtlpStatus,
  type OtlpAttribute,
  type OtlpAttributeValue,
} from './otel-span'

export {
  transformTailEvent,
  type TailEvent,
} from './tail'

// Re-export shared utilities
export * from './shared'
