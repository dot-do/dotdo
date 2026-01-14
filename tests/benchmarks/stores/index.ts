/**
 * Store Benchmarks - Barrel Export
 *
 * RED PHASE: Export all store benchmark files for unified test runs.
 * These benchmarks test the core storage primitives of dotdo.
 *
 * @see do-a55 - Store Benchmarks
 *
 * Stores Covered:
 * - DocumentStore: Schema-free JSON documents with JSONPath queries
 * - VectorStore: Embedding storage with Matryoshka and hybrid search
 * - ColumnarStore: Analytics-optimized storage with 99.4% cost savings
 * - TimeSeriesStore: Three-tier time series with rollups
 * - GraphStore: Nodes and edges with traversal algorithms
 * - Stream: Kafka-inspired messaging with consumer groups
 * - Workflow: Durable workflow execution engine
 *
 * Run all benchmarks:
 * ```bash
 * npx vitest bench tests/benchmarks/stores/
 * ```
 *
 * Run specific store benchmark:
 * ```bash
 * npx vitest bench tests/benchmarks/stores/document/
 * npx vitest bench tests/benchmarks/stores/vector/
 * npx vitest bench tests/benchmarks/stores/columnar/
 * npx vitest bench tests/benchmarks/stores/timeseries/
 * npx vitest bench tests/benchmarks/stores/graph/
 * npx vitest bench tests/benchmarks/stores/stream/
 * npx vitest bench tests/benchmarks/stores/workflow/
 * ```
 */

// Document Store - CRUD and batch operations
export * from './document/crud.bench'

// Vector Store - Similarity search and hybrid search
export * from './vector/search.bench'

// Columnar Store - Cost-optimized analytics
export * from './columnar/cost.bench'

// Time Series Store - Range queries and rollups
export * from './timeseries/range.bench'

// Graph Store - Traversals and path finding
export * from './graph/traversal.bench'

// Stream - Produce/consume throughput
export * from './stream/throughput.bench'

// Workflow - Lifecycle operations
export * from './workflow/lifecycle.bench'
