// Type definitions for the benchmark framework

export interface LatencyMetrics {
  p50: number
  p95: number
  p99: number
  min: number
  max: number
  avg: number
  stdDev: number
}

export interface ThroughputMetrics {
  opsPerSecond: number
  bytesPerSecond: number
}

export interface CostMetrics {
  rowWrites: number
  rowReads: number
  storageBytes: number
  storageGb: number
  estimatedCost: number
  breakdown: {
    writeCost: number
    readCost: number
    storageCost: number
  }
}

export interface ResourceMetrics {
  peakMemoryMb: number
  storageBytesUsed: number
}

export interface BenchmarkContext {
  name?: string
  store: string
  operation: string
  datasetSize: number
  iterations: number
  environment: 'local' | 'remote'
}

export interface BenchmarkMetrics {
  latency: LatencyMetrics
  throughput: ThroughputMetrics
  cost: CostMetrics
  resources: ResourceMetrics
}

export interface BenchmarkResult {
  name: string
  samples: number[]
  metrics: BenchmarkMetrics
  context: BenchmarkContext
}

export interface BenchmarkConfig {
  name?: string
  store?: string
  operation?: string
  warmup?: number
  iterations?: number
  timeout?: number
}
