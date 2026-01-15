/**
 * Event Transformers
 *
 * Transforms various event formats to the UnifiedEvent schema.
 * Each transformer maps source-specific fields to the 162-column unified schema.
 *
 * @module db/streams/transformers
 */

// DO transformers
export {
  transformDoEvent,
  transformDoEvents,
  type DoEventInput,
} from './do-event'

export {
  transformDoAction,
  type ActionInput,
} from './do-action'

// CDC transformer
export {
  transformCdcEvent,
  type CdcEvent,
  type CdcOperation,
} from './cdc'

// Segment transformers
export {
  transformSegmentTrack,
  type SegmentTrackEvent,
} from './segment-track'

export {
  transformSegmentIdentify,
  type SegmentIdentifyEvent,
} from './segment-identify'

export {
  transformSegmentPage,
  type SegmentPageEvent,
  type SegmentPageProperties,
} from './segment-page'

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

// OTEL transformers
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
  transformOtelLog,
  severityNumberToLevel,
  type OtlpLogRecord,
} from './otel-log'

export {
  transformOtelMetric,
  type OtlpMetric,
  type DataPoint,
  type HistogramDataPoint,
  type SummaryDataPoint,
} from './otel-metric'

// Web Vitals transformer
export {
  transformWebVital,
  type WebVitalMetric,
  type WebVitalName,
  type WebVitalRating,
  type NavigationType,
  type TransformContext as WebVitalContext,
} from './web-vital'

// Session Replay transformer
export {
  transformSessionReplay,
  EVENT_TYPES as RRWEB_EVENT_TYPES,
  SOURCES as RRWEB_SOURCES,
  type RrwebEvent,
  type SessionReplayContext,
} from './session-replay'

// Snippet transformer
export {
  transformSnippet,
  type SnippetEvent,
} from './snippet'

// Tail transformer
export {
  transformTailEvent,
  type TailEvent,
} from './tail'

// EPCIS transformer
export {
  transformEPCISEvent,
  transformEPCISEvents,
  BUSINESS_STEPS,
  DISPOSITIONS,
  type EPCISEvent,
  type EPCISEventType,
  type EPCISAction,
  type EPCISBusinessTransaction,
  type EPCISSourceDest,
  type EPCISQuantityElement,
  type EPCISTransformContext,
} from './business-epcis'

// Transformer Registry
export {
  TransformerRegistry,
  registry,
  TRANSFORMER_NAMES,
  type TransformerFn,
  type TransformerMeta,
  type RegisteredTransformer,
  type TransformerName,
} from './registry'

// Re-export shared utilities
export * from './shared'
