/**
 * Network Simulator for Benchmark Testing
 *
 * Simulates network latency between workers, Durable Objects, and across colos.
 * Used for benchmarking and testing without real CF infrastructure.
 *
 * Features:
 * - Configurable base latencies for same-colo and cross-colo communication
 * - Jitter simulation for realistic variance
 * - Proxy overhead simulation
 * - WebSocket connection and message latency simulation
 * - Latency matrix generation for colo-to-colo measurements
 * - Statistical analysis (mean, median, percentiles, stddev)
 * - Statistical significance testing
 */

// ============================================
// Type Definitions
// ============================================

export interface NetworkConfig {
  sameColoLatency: number // base latency in ms for same-colo communication
  crossColoLatency: number // additional latency for cross-colo
  jitter: number // random variation (+/- percentage, e.g., 0.1 = 10%)
  proxyOverhead: number // additional latency per proxy hop
}

export interface LatencyMatrix {
  colos: string[]
  matrix: number[][] // [from][to] latencies in ms
  iterations: number
  timestamp: number
}

export interface DetailedLatencyMatrix extends LatencyMatrix {
  stats: LatencyStats[][] // Per-cell statistics
}

export interface LatencyStats {
  min: number
  max: number
  mean: number
  median: number
  p95: number
  p99: number
  stdDev: number
}

export interface BenchmarkResult {
  operation: string
  from: string
  to: string
  stats: LatencyStats
  rawSamples: number[]
}

export interface WebSocketLatencyResult {
  connectionTime: number
  messageRoundTrip: number
  disconnectTime: number
}

export interface ConfidenceInterval {
  lower: number
  upper: number
  level: number
}

export interface OutlierResult {
  cleaned: number[]
  outliers: number[]
}

export interface BenchmarkConfig {
  operation: string
  from: string
  to: string
  iterations: number
}

export interface ExportedResults {
  benchmarks: BenchmarkResult[]
  config: NetworkConfig
  timestamp: number
}

// ============================================
// Colo Distance Matrix (simulated)
// ============================================

// Approximate inter-colo latencies in ms based on geographic distance
// These are simulated values for testing purposes
const COLO_DISTANCES: Record<string, Record<string, number>> = {
  iad: { iad: 0, dfw: 25, ord: 15, sfo: 65, lax: 60, lhr: 80, fra: 90, sin: 200, nrt: 170, syd: 220 },
  dfw: { iad: 25, dfw: 0, ord: 15, sfo: 35, lax: 30, lhr: 100, fra: 110, sin: 190, nrt: 160, syd: 200 },
  ord: { iad: 15, dfw: 15, ord: 0, sfo: 45, lax: 40, lhr: 85, fra: 95, sin: 195, nrt: 165, syd: 210 },
  sfo: { iad: 65, dfw: 35, ord: 45, sfo: 0, lax: 10, lhr: 140, fra: 150, sin: 170, nrt: 100, syd: 130 },
  lax: { iad: 60, dfw: 30, ord: 40, sfo: 10, lax: 0, lhr: 145, fra: 155, sin: 165, nrt: 95, syd: 125 },
  lhr: { iad: 80, dfw: 100, ord: 85, sfo: 140, lax: 145, lhr: 0, fra: 15, sin: 160, nrt: 180, syd: 280 },
  fra: { iad: 90, dfw: 110, ord: 95, sfo: 150, lax: 155, lhr: 15, fra: 0, sin: 150, nrt: 170, syd: 270 },
  sin: { iad: 200, dfw: 190, ord: 195, sfo: 170, lax: 165, lhr: 160, fra: 150, sin: 0, nrt: 70, syd: 100 },
  nrt: { iad: 170, dfw: 160, ord: 165, sfo: 100, lax: 95, lhr: 180, fra: 170, sin: 70, nrt: 0, syd: 120 },
  syd: { iad: 220, dfw: 200, ord: 210, sfo: 130, lax: 125, lhr: 280, fra: 270, sin: 100, nrt: 120, syd: 0 },
}

// Default distance for unknown colos
const DEFAULT_CROSS_COLO_LATENCY = 50

// ============================================
// Helper Functions
// ============================================

/**
 * Creates a network configuration with defaults
 */
export function createNetworkConfig(partial: Partial<NetworkConfig> = {}): NetworkConfig {
  return {
    sameColoLatency: partial.sameColoLatency ?? 0.5,
    crossColoLatency: partial.crossColoLatency ?? 50,
    jitter: partial.jitter ?? 0.1,
    proxyOverhead: partial.proxyOverhead ?? 0.2,
  }
}

/**
 * Calculates statistical metrics from a sample array
 */
export function calculateStats(samples: number[]): LatencyStats {
  if (samples.length === 0) {
    return { min: 0, max: 0, mean: 0, median: 0, p95: 0, p99: 0, stdDev: 0 }
  }

  const sorted = [...samples].sort((a, b) => a - b)
  const n = sorted.length

  const min = sorted[0]
  const max = sorted[n - 1]
  const mean = samples.reduce((a, b) => a + b, 0) / n
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)]
  const p95 = sorted[Math.floor(n * 0.95)]
  const p99 = sorted[Math.floor(n * 0.99)]

  const variance = samples.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / n
  const stdDev = Math.sqrt(variance)

  return { min, max, mean, median, p95, p99, stdDev }
}

/**
 * Performs a two-sample t-test to determine statistical significance
 * Returns true if the difference is statistically significant at the given alpha level
 */
export function isStatisticallySignificant(sample1: number[], sample2: number[], alpha: number = 0.05): boolean {
  const n1 = sample1.length
  const n2 = sample2.length

  // Require minimum sample size
  if (n1 < 5 || n2 < 5) {
    return false
  }

  const mean1 = sample1.reduce((a, b) => a + b, 0) / n1
  const mean2 = sample2.reduce((a, b) => a + b, 0) / n2

  const var1 = sample1.reduce((sum, x) => sum + Math.pow(x - mean1, 2), 0) / (n1 - 1)
  const var2 = sample2.reduce((sum, x) => sum + Math.pow(x - mean2, 2), 0) / (n2 - 1)

  // Pooled standard error
  const se = Math.sqrt(var1 / n1 + var2 / n2)
  if (se === 0) return false

  // t-statistic
  const t = Math.abs(mean1 - mean2) / se

  // Degrees of freedom (Welch's approximation)
  const df =
    Math.pow(var1 / n1 + var2 / n2, 2) /
    (Math.pow(var1 / n1, 2) / (n1 - 1) + Math.pow(var2 / n2, 2) / (n2 - 1))

  // Critical t-value (approximation for common alpha levels)
  // Using simplified lookup for common alpha values
  const criticalT = getCriticalT(df, alpha)

  return t > criticalT
}

/**
 * Simplified critical t-value lookup
 */
function getCriticalT(df: number, alpha: number): number {
  // Approximation for two-tailed t-test
  // Based on Student's t-distribution
  if (df < 1) return Infinity

  // Common critical values (two-tailed)
  if (alpha <= 0.01) {
    if (df >= 120) return 2.617
    if (df >= 60) return 2.66
    if (df >= 30) return 2.75
    if (df >= 20) return 2.845
    if (df >= 10) return 3.169
    return 3.5
  }
  if (alpha <= 0.05) {
    if (df >= 120) return 1.98
    if (df >= 60) return 2.0
    if (df >= 30) return 2.042
    if (df >= 20) return 2.086
    if (df >= 10) return 2.228
    return 2.5
  }
  return 1.645 // alpha = 0.10
}

// ============================================
// Network Simulator Class
// ============================================

export class NetworkSimulator {
  private config: NetworkConfig
  private random: () => number

  constructor(config: NetworkConfig, seed?: number) {
    this.config = config
    // Use seeded random for reproducibility in tests, or Math.random otherwise
    this.random = seed !== undefined ? this.createSeededRandom(seed) : Math.random
  }

  /**
   * Creates a seeded random number generator for reproducible tests
   */
  private createSeededRandom(seed: number): () => number {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
  }

  /**
   * Extracts colo code from an endpoint identifier
   * Format: type:colo or type:colo:id (e.g., "worker:iad", "do:sfo:user-123")
   */
  private extractColo(endpoint: string): string {
    const parts = endpoint.split(':')
    return parts.length >= 2 ? parts[1] : 'unknown'
  }

  /**
   * Gets the base latency between two colos
   */
  private getColoLatency(fromColo: string, toColo: string): number {
    if (fromColo === toColo) {
      return this.config.sameColoLatency
    }

    // Look up in distance matrix
    const fromDistances = COLO_DISTANCES[fromColo]
    if (fromDistances && fromDistances[toColo] !== undefined) {
      return fromDistances[toColo]
    }

    // Default cross-colo latency if not in matrix
    return this.config.crossColoLatency
  }

  /**
   * Applies jitter to a latency value
   */
  private applyJitter(latency: number): number {
    const jitterRange = latency * this.config.jitter
    const jitter = (this.random() * 2 - 1) * jitterRange
    return Math.max(0, latency + jitter)
  }

  /**
   * Simulates async delay
   */
  private async simulateDelay(ms: number): Promise<void> {
    // For benchmarking purposes, we don't actually delay
    // Just calculate and return the latency
  }

  /**
   * Measures latency between two endpoints
   */
  async measureLatency(from: string, to: string): Promise<number> {
    const fromColo = this.extractColo(from)
    const toColo = this.extractColo(to)
    const baseLatency = this.getColoLatency(fromColo, toColo)
    return this.applyJitter(baseLatency)
  }

  /**
   * Measures latency multiple times and returns samples
   */
  async measureLatencyBatch(from: string, to: string, iterations: number): Promise<number[]> {
    const samples: number[] = []
    for (let i = 0; i < iterations; i++) {
      samples.push(await this.measureLatency(from, to))
    }
    return samples
  }

  /**
   * Measures latency through a proxy (source -> proxy -> target)
   */
  async measureProxiedLatency(source: string, proxy: string, target: string): Promise<number> {
    const leg1 = await this.measureLatency(source, proxy)
    const leg2 = await this.measureLatency(proxy, target)
    return leg1 + leg2 + this.config.proxyOverhead * 2
  }

  /**
   * Measures latency across multiple hops
   */
  async measureMultiHopLatency(hops: string[]): Promise<number> {
    if (hops.length < 2) return 0

    let totalLatency = 0
    for (let i = 0; i < hops.length - 1; i++) {
      totalLatency += await this.measureLatency(hops[i], hops[i + 1])
      if (i > 0) {
        totalLatency += this.config.proxyOverhead
      }
    }
    return totalLatency
  }

  /**
   * Simulates WebSocket connection establishment
   */
  async measureWebSocketConnection(
    client: string,
    server: string,
    options: { tls?: boolean } = {}
  ): Promise<WebSocketLatencyResult> {
    const baseLatency = await this.measureLatency(client, server)

    // WebSocket handshake is typically 1-2 round trips
    // HTTP Upgrade + potential TLS handshake
    const handshakeRoundTrips = options.tls ? 3 : 2
    const connectionTime = this.applyJitter(baseLatency * handshakeRoundTrips)

    // Single message round-trip (after connection)
    const messageRoundTrip = this.applyJitter(baseLatency * 2)

    // Disconnect is typically 1 round trip (close frame exchange)
    const disconnectTime = this.applyJitter(baseLatency * 2)

    return { connectionTime, messageRoundTrip, disconnectTime }
  }

  /**
   * Measures WebSocket message round-trip time
   */
  async measureWebSocketRoundTrip(client: string, server: string): Promise<WebSocketLatencyResult> {
    const baseLatency = await this.measureLatency(client, server)

    return {
      connectionTime: 0, // Already connected
      messageRoundTrip: this.applyJitter(baseLatency * 2),
      disconnectTime: 0,
    }
  }

  /**
   * Measures WebSocket round-trip multiple times
   */
  async measureWebSocketRoundTripBatch(client: string, server: string, iterations: number): Promise<number[]> {
    const samples: number[] = []
    for (let i = 0; i < iterations; i++) {
      const result = await this.measureWebSocketRoundTrip(client, server)
      samples.push(result.messageRoundTrip)
    }
    return samples
  }

  /**
   * Simulates WebSocket ping/pong latency
   */
  async measurePingPong(client: string, server: string): Promise<number> {
    const baseLatency = await this.measureLatency(client, server)
    // Ping/pong is minimal - just 1 round trip with small payload overhead
    return this.applyJitter(baseLatency * 2)
  }

  /**
   * Generates a latency matrix for specified colos
   */
  async generateMatrix(colos: string[], iterations: number): Promise<LatencyMatrix> {
    const matrix: number[][] = []

    for (let i = 0; i < colos.length; i++) {
      matrix[i] = []
      for (let j = 0; j < colos.length; j++) {
        const samples = await this.measureLatencyBatch(`do:${colos[i]}`, `do:${colos[j]}`, iterations)
        matrix[i][j] = calculateStats(samples).mean
      }
    }

    return {
      colos,
      matrix,
      iterations,
      timestamp: Date.now(),
    }
  }

  /**
   * Generates a detailed latency matrix with per-cell statistics
   */
  async generateDetailedMatrix(colos: string[], iterations: number): Promise<DetailedLatencyMatrix> {
    const matrix: number[][] = []
    const stats: LatencyStats[][] = []

    for (let i = 0; i < colos.length; i++) {
      matrix[i] = []
      stats[i] = []
      for (let j = 0; j < colos.length; j++) {
        const samples = await this.measureLatencyBatch(`do:${colos[i]}`, `do:${colos[j]}`, iterations)
        const cellStats = calculateStats(samples)
        matrix[i][j] = cellStats.mean
        stats[i][j] = cellStats
      }
    }

    return {
      colos,
      matrix,
      stats,
      iterations,
      timestamp: Date.now(),
    }
  }

  /**
   * Aggregates multiple latency matrices into one
   */
  aggregateMatrices(matrices: LatencyMatrix[]): LatencyMatrix {
    if (matrices.length === 0) {
      return { colos: [], matrix: [], iterations: 0, timestamp: Date.now() }
    }

    const colos = matrices[0].colos
    const totalIterations = matrices.reduce((sum, m) => sum + m.iterations, 0)

    // Compute weighted average for each cell
    const aggregatedMatrix: number[][] = []
    for (let i = 0; i < colos.length; i++) {
      aggregatedMatrix[i] = []
      for (let j = 0; j < colos.length; j++) {
        let weightedSum = 0
        for (const m of matrices) {
          weightedSum += m.matrix[i][j] * m.iterations
        }
        aggregatedMatrix[i][j] = weightedSum / totalIterations
      }
    }

    return {
      colos,
      matrix: aggregatedMatrix,
      iterations: totalIterations,
      timestamp: Date.now(),
    }
  }

  /**
   * Calculates confidence interval for a sample
   */
  calculateConfidenceInterval(samples: number[], level: number = 0.95): ConfidenceInterval {
    const n = samples.length
    if (n < 2) {
      const val = samples[0] ?? 0
      return { lower: val, upper: val, level }
    }

    const mean = samples.reduce((a, b) => a + b, 0) / n
    const variance = samples.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / (n - 1)
    const stdErr = Math.sqrt(variance / n)

    // Z-score for confidence level
    const z = level >= 0.99 ? 2.576 : level >= 0.95 ? 1.96 : 1.645

    return {
      lower: mean - z * stdErr,
      upper: mean + z * stdErr,
      level,
    }
  }

  /**
   * Removes outliers using IQR method
   */
  removeOutliers(samples: number[]): OutlierResult {
    if (samples.length < 4) {
      return { cleaned: [...samples], outliers: [] }
    }

    const sorted = [...samples].sort((a, b) => a - b)
    const n = sorted.length
    const q1 = sorted[Math.floor(n * 0.25)]
    const q3 = sorted[Math.floor(n * 0.75)]
    const iqr = q3 - q1
    const lowerBound = q1 - 1.5 * iqr
    const upperBound = q3 + 1.5 * iqr

    const cleaned: number[] = []
    const outliers: number[] = []

    for (const value of samples) {
      if (value >= lowerBound && value <= upperBound) {
        cleaned.push(value)
      } else {
        outliers.push(value)
      }
    }

    return { cleaned, outliers }
  }

  /**
   * Runs a complete benchmark with configuration
   */
  async runBenchmark(config: BenchmarkConfig): Promise<BenchmarkResult> {
    const samples = await this.measureLatencyBatch(config.from, config.to, config.iterations)
    const stats = calculateStats(samples)

    return {
      operation: config.operation,
      from: config.from,
      to: config.to,
      stats,
      rawSamples: samples,
    }
  }

  /**
   * Formats a benchmark result for human-readable output
   */
  formatResult(result: BenchmarkResult): string {
    const { operation, from, to, stats } = result
    const fromColo = this.extractColo(from)
    const toColo = this.extractColo(to)

    return [
      `Benchmark: ${operation}`,
      `  Route: ${fromColo} -> ${toColo}`,
      `  Samples: ${result.rawSamples.length}`,
      `  Stats:`,
      `    mean: ${stats.mean.toFixed(3)} ms`,
      `    median: ${stats.median.toFixed(3)} ms`,
      `    p95: ${stats.p95.toFixed(3)} ms`,
      `    p99: ${stats.p99.toFixed(3)} ms`,
      `    min: ${stats.min.toFixed(3)} ms`,
      `    max: ${stats.max.toFixed(3)} ms`,
      `    stdDev: ${stats.stdDev.toFixed(3)} ms`,
    ].join('\n')
  }

  /**
   * Exports results as JSON
   */
  exportResultsAsJson(results: BenchmarkResult[]): string {
    const exported: ExportedResults = {
      benchmarks: results,
      config: this.config,
      timestamp: Date.now(),
    }
    return JSON.stringify(exported, null, 2)
  }
}
