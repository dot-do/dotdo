/**
 * TypeScript types for TimeSeriesStore
 */

export interface DataPoint<T = unknown> {
  key: string
  value: T
  timestamp: number
}

export interface AggregateResult {
  bucket: string
  min?: number
  max?: number
  avg?: number
  count?: number
  sum?: number
  p50?: number
  p99?: number
}

export interface RetentionConfig {
  hot?: string
  warm?: string
  cold?: string
}

export interface TimeSeriesOptions<T = unknown> {
  retention?: RetentionConfig
  retentionMs?: number
  maxVersionsPerKey?: number
  table?: string
  onCDC?: (event: CDCEvent) => void
}

export interface RangeQuery {
  start: number | Date | string
  end: number | Date | string
}

export interface AggregateQuery {
  start: number | string
  end: number | string
  bucket: string
  metrics: string[]
}

export interface RollupOptions {
  olderThan: string
  bucket: string
  aggregates: string[]
}

export interface ArchiveOptions {
  olderThan: string
}

export interface CompactOptions {
  maxVersionsPerKey: number
}

export interface CDCEvent {
  type: string
  op: string
  store: string
  table: string
  key?: string
  timestamp?: string
  after?: unknown
  partition?: string
  count?: number
  aggregates?: Record<string, number>
}

export interface Snapshot<T> {
  id: string
  data: Map<string, Array<{ value: T; timestamp: number }>>
  warmData: Map<string, AggregateResult[]>
  coldData: Map<string, Array<{ value: T; timestamp: number }>>
  createdAt: number
}
