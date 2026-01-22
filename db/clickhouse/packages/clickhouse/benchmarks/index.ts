/**
 * ClickBench Benchmark Module
 *
 * Provides tools for running ClickBench benchmarks across different backends.
 */

// Export configuration
export {
  benchmarkConfig,
  CLICKBENCH_QUERIES,
  getR2DataUrl,
  getQuery,
  getQueryCount,
  defaultBackendConfigs,
  type BenchmarkConfig,
  type BackendType,
  type BackendConfig,
} from './config';

// Export runner
export {
  runBenchmarks,
  createClientForBackend,
  formatResults,
  formatResultsJson,
  formatResultsCsv,
  type BenchmarkResult,
  type BenchmarkOptions,
  type BenchmarkProgress,
  type BenchmarkClient,
  type QueryResult,
  type ClientInfo,
} from './runner';

// Export Workers benchmark module
export {
  benchmarkWorkers,
  benchmarkWorkersAdvanced,
  benchmarkWorkersMultiRegion,
  formatWorkersResults,
  generateWorkersSummary,
  runWorkersBenchmarkCli,
  type WorkersBenchmarkOptions,
  type WorkersBenchmarkProgress,
  type WorkersBenchmarkResult,
  type WorkersBenchmarkSummary,
} from './workers';

// Export Sandbox (Container) benchmark module
export {
  benchmarkSandbox,
  benchmarkSandboxWithOptions,
  benchmarkSingleQuery,
  compareSandboxResults,
  type SandboxBenchmarkOptions,
  type SandboxBenchmarkResult,
  // Container configuration
  type ContainerResourceLimits,
  type ContainerNetworkConfig,
  type ContainerStorageConfig,
  type ContainerRuntimeConfig,
  type ContainerDeploymentConfig,
  type BenchmarkDeploymentSettings,
  DEFAULT_RESOURCE_LIMITS,
  HIGH_PERFORMANCE_RESOURCE_LIMITS,
  MINIMAL_RESOURCE_LIMITS,
  DEFAULT_NETWORK_CONFIG,
  R2_ENABLED_NETWORK_CONFIG,
  DEFAULT_STORAGE_CONFIG,
  PERSISTENT_STORAGE_CONFIG,
  DEFAULT_RUNTIME_CONFIG,
  DEFAULT_BENCHMARK_SETTINGS,
  PERFORMANCE_BENCHMARK_SETTINGS,
  createDefaultConfig,
  createHighPerformanceConfig,
  createMinimalConfig,
  validateConfig,
  mergeWithDefaults,
  toWranglerConfig,
  exportConfigJson,
} from './sandbox';

// Export Durable Objects benchmark module
export {
  BenchmarkDO,
  benchmarkDurableObjects,
  runBatchQueries,
  getHealthStatus,
  calculateStatistics,
  generateReport,
  formatReportMarkdown,
  testConcurrentAccess,
  type Env as DOEnv,
  type ChdbInstance,
  type DOQueryResult,
  type BatchQueryRequest,
  type BatchQueryResponse,
  type HealthCheckResponse,
  type DOBenchmarkOptions,
  type DOBenchmarkProgress,
  type DOBenchmarkResult,
  type QueryStatistics,
  type DOBenchmarkReport,
} from './durable-objects';
