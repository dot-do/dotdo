// Type definitions for remote benchmark execution

export interface RemoteConfig {
  endpoint: string
  apiKey: string
  timeout?: number
}

export interface BenchmarkRequest {
  store: string
  operation: string
  dataset?: { size?: number; seed?: number }
  iterations: number
  warmup?: number
}

export interface BenchmarkResponse {
  metrics: {
    latency: {
      p50: number
      p95: number
      p99: number
      min: number
      max: number
      avg: number
      stdDev: number
    }
    throughput: { opsPerSecond: number; bytesPerSecond: number }
    cost: {
      rowWrites: number
      rowReads: number
      storageBytes: number
      storageGb: number
      estimatedCost: number
      breakdown: { writeCost: number; readCost: number; storageCost: number }
    }
    resources: { peakMemoryMb: number; storageBytesUsed: number }
  }
  raw: number[]
  environment: 'production' | 'staging'
}

export interface MultiRunResult {
  runs: BenchmarkResponse[]
  aggregated: {
    latency: {
      p50: number
      p95: number
      p99: number
      min: number
      max: number
      avg: number
      stdDev: number
    }
  }
}

export interface ComparisonResult {
  significant: boolean
  regressions: string[]
  improvements: string[]
  unchanged: string[]
}
