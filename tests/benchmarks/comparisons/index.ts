/**
 * Cross-Store Comparison Benchmarks - Barrel Export
 *
 * GREEN PHASE: Export all comparison benchmark files for unified test runs.
 * These benchmarks compare different stores for the same workloads.
 *
 * @see do-p7v - GREEN: Cross-Store Comparison Implementation
 *
 * Comparisons Covered:
 * - Document vs Relational: Schema flexibility vs strong typing trade-offs
 * - Columnar Cost Savings: 99.4% write cost reduction demonstration
 * - Vector Progressive Search: Multi-stage search pipeline optimization
 * - Tiering Performance: Hot/Warm/Cold access pattern benchmarks
 *
 * Run all comparison benchmarks:
 * ```bash
 * npx vitest bench tests/benchmarks/comparisons/
 * ```
 *
 * Run specific comparison:
 * ```bash
 * npx vitest bench tests/benchmarks/comparisons/document-vs-relational.bench.ts
 * npx vitest bench tests/benchmarks/comparisons/columnar-cost-savings.bench.ts
 * npx vitest bench tests/benchmarks/comparisons/vector-progressive.bench.ts
 * npx vitest bench tests/benchmarks/comparisons/tiering-performance.bench.ts
 * ```
 */

// Harness with mock stores for comparison benchmarks
export * from './harness'

// Document vs Relational - Schema flexibility trade-offs
export * from './document-vs-relational.bench'

// Columnar Cost Savings - 99.4% write cost reduction
export * from './columnar-cost-savings.bench'

// Vector Progressive Search - Multi-stage filtering pipeline
export * from './vector-progressive.bench'

// Tiering Performance - Hot/Warm/Cold access patterns
export * from './tiering-performance.bench'
