/**
 * EdgeVec - HNSW Vector Search for Durable Objects
 *
 * EdgeVec provides two components:
 * 1. EdgeVecDO - Durable Object for vector index persistence
 * 2. EdgeVecServiceImpl - WorkerEntrypoint for RPC access
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────────────────────────────────┐
 * │           Your App Worker                    │
 * │   vector: { engine: 'edgevec' }             │
 * └──────────────────┬──────────────────────────┘
 *                    │ Service Binding (RPC)
 *                    ▼
 * ┌─────────────────────────────────────────────┐
 * │         EdgeVec Worker (217KB WASM)         │
 * │   EdgeVecServiceImpl (WorkerEntrypoint)     │
 * │         ↓                                    │
 * │   EdgeVecDO (Durable Object storage)        │
 * └─────────────────────────────────────────────┘
 * ```
 *
 * @module db/edgevec
 * @see docs/plans/2026-01-09-compat-layer-design.md
 */

// Durable Object for persistence
export {
  EdgeVecDO,
  type EdgeVecConfig,
  type VectorRecord,
  type IndexStats,
  type BackupManifest,
  type StorageUsage,
  type VectorListResult,
  type SearchResult,
  EdgeVecStorageError,
  EdgeVecIndexError,
  EdgeVecBackupError,
} from './EdgeVecDO'

// WorkerEntrypoint for RPC access
export { EdgeVecServiceImpl } from './service'

// WASM loader
export {
  initWASM,
  getWASMModule,
  isWASMLoaded,
  loadEdgeVecWASM,
  unloadWASM,
  type WASMModule,
  type SIMDCapabilities,
  type WASMInitOptions,
} from './wasm-loader'

// Service types
export type {
  // Error types
  EdgeVecError,
  EdgeVecErrorCode,
  // Configuration
  DistanceMetric,
  IndexConfig,
  ResolvedIndexConfig,
  IndexInfo,
  // Vector types
  Vector,
  MetadataFilter,
  // Search types
  SearchOptions,
  SearchMatch,
  SearchResult as ServiceSearchResult,
  SearchError,
  // Operation results
  CreateIndexResult,
  InsertResult,
  DeleteResult,
  DescribeIndexResult,
  ListIndexesResult,
  DeleteIndexResult,
  PersistResult,
  PersistAllResult,
  LoadResult,
  LoadAllResult,
  BatchSearchItem,
  BatchSearchResult,
  // Service interface
  EdgeVecService,
} from './types'
