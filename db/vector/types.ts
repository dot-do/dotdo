/**
 * VectorStore Types
 *
 * TypeScript type definitions for VectorStore, HybridSearch, and related functionality.
 *
 * @module db/vector/types
 */

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

export interface VectorStoreOptions {
  dimension?: number
  matryoshkaDims?: number[]
  useBinaryPrefilter?: boolean
  lazyInit?: boolean
  onCDC?: (event: CDCEvent) => void
}

export interface InsertOptions {
  partition?: string
}

export interface SearchOptions {
  embedding: Float32Array
  limit: number
  filter?: Record<string, any>
  useBinaryPrefilter?: boolean
}

export interface HybridSearchOptions {
  query?: string
  embedding?: Float32Array
  limit: number
  ftsWeight?: number
  vectorWeight?: number
  fusion?: 'rrf' | 'linear'
}

export interface ProgressiveSearchOptions {
  embedding: Float32Array
  limit: number
  stages?: ProgressiveSearchStage[]
  returnTiming?: boolean
}

export interface ProgressiveSearchStage {
  type: 'binary' | 'matryoshka' | 'exact'
  dim?: number
  candidates: number
}

export interface ProgressiveSearchResult {
  results: SearchResult[]
  timing?: ProgressiveTiming
}

export interface ProgressiveTiming {
  total: number
  stages: { name: string; duration: number }[]
}

// ============================================================================
// DATA TYPES
// ============================================================================

export interface VectorDocument {
  id: string
  content: string
  embedding: Float32Array
  metadata?: Record<string, any>
}

export interface StoredDocument {
  id: string
  content: string
  embedding: Float32Array
  metadata: Record<string, any>
  mat_64?: Float32Array
  mat_256?: Float32Array
  binary_hash?: ArrayBuffer
}

export interface SearchResult {
  id: string
  content: string
  metadata: Record<string, any>
  similarity: number
  distance: number
  rrfScore?: number
  ftsRank?: number | null
  vectorRank?: number | null
}

// ============================================================================
// RRF TYPES
// ============================================================================

export interface RRFRankInput {
  rank: number | null
  weight: number
}

export interface RRFOptions {
  k?: number
}

// ============================================================================
// CDC EVENT TYPES
// ============================================================================

export interface CDCEvent {
  type: string
  op: 'c' | 'u' | 'd'
  store: string
  table?: string
  key?: string
  count?: number
  partition?: string
  timestamp: number
  after?: {
    dimension?: number
    matryoshkaDims?: number[]
    hasContent?: boolean
  }
}

// ============================================================================
// HYBRID SEARCH TYPES
// ============================================================================

export interface HybridQueryOptions {
  query: string
  embedding: Float32Array
  limit: number
  ftsWeight?: number
  vectorWeight?: number
  vectorDim?: number
  where?: Record<string, any>
}

// ============================================================================
// SUBSCRIPTION TYPES
// ============================================================================

export interface Subscription {
  unsubscribe: () => void
}

// ============================================================================
// MOCK DB TYPE
// ============================================================================

export interface MockDb {
  data: Map<string, any>
  ftsData: Map<string, string>
  events: any[]
  exec: (sql: string) => void
  prepare: (sql: string) => any
  onCDC?: (handler: (event: any) => void) => { unsubscribe: () => void }
  _emitCDC?: (event: any) => void
}
