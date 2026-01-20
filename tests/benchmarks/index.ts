/**
 * Benchmark Suite Index
 *
 * Main entry point for the benchmark system.
 * Re-exports all benchmark utilities and types.
 */

// Types
export * from './types'

// Runner utilities
export {
  calculateMetrics,
  runBenchmark,
  runBenchmarkBatch,
  formatMetrics,
  createTimer,
  collectTimings,
} from './runner'

// Baseline management
export {
  DEFAULT_BASELINE_PATH,
  loadBaseline,
  saveBaseline,
  compareMetrics,
  generateReport,
  formatReport,
  getGitVersion,
} from './baseline'
