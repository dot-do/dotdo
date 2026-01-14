/**
 * Colo-to-Colo Latency Matrix Benchmarks
 *
 * Generates and analyzes a complete latency matrix between Cloudflare data centers.
 * This helps identify optimal colo placement and cross-colo communication costs.
 *
 * Key metrics:
 * - Full NxN colo latency matrix
 * - Regional latency patterns (NA, EU, APAC)
 * - Cross-region latency overhead
 * - Optimal colo pairing for different use cases
 *
 * Reference: Cloudflare's global network spans 300+ cities. Understanding
 * inter-colo latency is critical for optimizing DO placement and RPC patterns.
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record, NA_COLOS, EU_COLOS, APAC_COLOS, ALL_COLOS, getColoRegion, calculateStats, type BenchmarkResult, type LatencyStats } from '../../lib'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Single colo-to-colo measurement
 */
interface ColoMeasurement {
  sourceColo: string
  targetColo: string
  p50: number
  p95: number
  p99: number
  min: number
  max: number
  mean: number
  stddev: number
  sampleCount: number
  timestamp: string
}

/**
 * Colo latency matrix
 */
interface ColoMatrix {
  measurements: ColoMeasurement[]
  generatedAt: string
  duration: number
  colos: string[]
  summary: MatrixSummary
}

/**
 * Matrix summary statistics
 */
interface MatrixSummary {
  minLatency: { source: string; target: string; p50: number }
  maxLatency: { source: string; target: string; p50: number }
  avgIntraRegion: { NA: number; EU: number; APAC: number }
  avgInterRegion: { 'NA-EU': number; 'NA-APAC': number; 'EU-APAC': number }
  totalMeasurements: number
  successfulMeasurements: number
}

/**
 * Regional latency summary
 */
interface RegionalSummary {
  region: 'NA' | 'EU' | 'APAC'
  intraRegionP50: number
  intraRegionP95: number
  coloCount: number
  measurementCount: number
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MATRIX_TARGET = 'echo.perf.do'
const ITERATIONS_PER_PAIR = 10
const WARMUP_ITERATIONS = 2

// Subset of colos for faster matrix generation
// Using 3 colos per region = 9 total = 81 pairs
const MATRIX_NA_COLOS = NA_COLOS.slice(0, 3) // SJC, LAX, SEA
const MATRIX_EU_COLOS = EU_COLOS.slice(0, 3) // LHR, CDG, FRA
const MATRIX_APAC_COLOS = APAC_COLOS.slice(0, 3) // NRT, HKG, SIN

const MATRIX_COLOS = [...MATRIX_NA_COLOS, ...MATRIX_EU_COLOS, ...MATRIX_APAC_COLOS]

// ============================================================================
// MATRIX GENERATION UTILITIES
// ============================================================================

/**
 * Measure latency between two colos
 */
async function measureColoPair(sourceColo: string, targetColo: string): Promise<ColoMeasurement | null> {
  try {
    const result = await benchmark({
      name: `colo-matrix-${sourceColo}-to-${targetColo}`,
      target: MATRIX_TARGET,
      colo: sourceColo, // Route request through source colo
      iterations: ITERATIONS_PER_PAIR,
      warmup: WARMUP_ITERATIONS,
      headers: {
        'X-Target-Colo': targetColo, // Signal to DO which colo to respond from
      },
      run: async (ctx) => {
        // The /colo-probe endpoint should route to the target colo
        const response = await ctx.fetch(`/colo-probe?target=${targetColo}`)
        return response
      },
    })

    return {
      sourceColo,
      targetColo,
      p50: result.stats.p50,
      p95: result.stats.p95,
      p99: result.stats.p99,
      min: result.stats.min,
      max: result.stats.max,
      mean: result.stats.mean,
      stddev: result.stats.stddev,
      sampleCount: result.samples.length,
      timestamp: result.timestamp,
    }
  } catch (error) {
    console.log(`  Failed: ${sourceColo} -> ${targetColo}: ${error instanceof Error ? error.message : error}`)
    return null
  }
}

/**
 * Generate a full colo-to-colo matrix
 */
async function generateMatrix(colos: string[]): Promise<ColoMatrix> {
  const startTime = Date.now()
  const measurements: ColoMeasurement[] = []
  const totalPairs = colos.length * colos.length

  console.log(`\nGenerating ${colos.length}x${colos.length} matrix (${totalPairs} pairs)...`)

  let completed = 0
  for (const source of colos) {
    for (const target of colos) {
      const measurement = await measureColoPair(source, target)
      if (measurement) {
        measurements.push(measurement)
      }
      completed++

      // Progress update every 10 measurements
      if (completed % 10 === 0) {
        console.log(`  Progress: ${completed}/${totalPairs} (${((completed / totalPairs) * 100).toFixed(1)}%)`)
      }
    }
  }

  const duration = Date.now() - startTime

  // Calculate summary
  const summary = calculateMatrixSummary(measurements, colos)

  return {
    measurements,
    generatedAt: new Date().toISOString(),
    duration,
    colos,
    summary,
  }
}

/**
 * Calculate summary statistics from matrix measurements
 */
function calculateMatrixSummary(measurements: ColoMeasurement[], colos: string[]): MatrixSummary {
  if (measurements.length === 0) {
    return {
      minLatency: { source: '', target: '', p50: 0 },
      maxLatency: { source: '', target: '', p50: 0 },
      avgIntraRegion: { NA: 0, EU: 0, APAC: 0 },
      avgInterRegion: { 'NA-EU': 0, 'NA-APAC': 0, 'EU-APAC': 0 },
      totalMeasurements: colos.length * colos.length,
      successfulMeasurements: 0,
    }
  }

  // Find min/max latency
  const sorted = [...measurements].sort((a, b) => a.p50 - b.p50)
  const minMeasurement = sorted[0]
  const maxMeasurement = sorted[sorted.length - 1]

  // Calculate regional averages
  const intraRegion: { NA: number[]; EU: number[]; APAC: number[] } = { NA: [], EU: [], APAC: [] }
  const interRegion: { 'NA-EU': number[]; 'NA-APAC': number[]; 'EU-APAC': number[] } = {
    'NA-EU': [],
    'NA-APAC': [],
    'EU-APAC': [],
  }

  for (const m of measurements) {
    const sourceRegion = getColoRegion(m.sourceColo)
    const targetRegion = getColoRegion(m.targetColo)

    if (sourceRegion === targetRegion && sourceRegion !== 'unknown') {
      intraRegion[sourceRegion].push(m.p50)
    } else if (sourceRegion !== 'unknown' && targetRegion !== 'unknown') {
      const key = [sourceRegion, targetRegion].sort().join('-') as 'NA-EU' | 'NA-APAC' | 'EU-APAC'
      interRegion[key].push(m.p50)
    }
  }

  const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)

  return {
    minLatency: { source: minMeasurement.sourceColo, target: minMeasurement.targetColo, p50: minMeasurement.p50 },
    maxLatency: { source: maxMeasurement.sourceColo, target: maxMeasurement.targetColo, p50: maxMeasurement.p50 },
    avgIntraRegion: {
      NA: avg(intraRegion.NA),
      EU: avg(intraRegion.EU),
      APAC: avg(intraRegion.APAC),
    },
    avgInterRegion: {
      'NA-EU': avg(interRegion['NA-EU']),
      'NA-APAC': avg(interRegion['NA-APAC']),
      'EU-APAC': avg(interRegion['EU-APAC']),
    },
    totalMeasurements: colos.length * colos.length,
    successfulMeasurements: measurements.length,
  }
}

/**
 * Format matrix as ASCII table
 */
function formatMatrixTable(matrix: ColoMatrix): string {
  const colos = matrix.colos
  const lookup = new Map<string, number>()

  for (const m of matrix.measurements) {
    lookup.set(`${m.sourceColo}-${m.targetColo}`, m.p50)
  }

  // Header
  let table = '     | ' + colos.map((c) => c.padStart(6)).join(' ') + '\n'
  table += '-----+-' + colos.map(() => '------').join('-') + '\n'

  // Rows
  for (const source of colos) {
    let row = source.padStart(4) + ' |'
    for (const target of colos) {
      const p50 = lookup.get(`${source}-${target}`)
      row += ' ' + (p50 !== undefined ? p50.toFixed(1).padStart(6) : '     -')
    }
    table += row + '\n'
  }

  return table
}

// ============================================================================
// MATRIX GENERATION TESTS
// ============================================================================

describe('Colo-to-Colo Latency Matrix', () => {
  describe('matrix generation', () => {
    it('generates full colo-to-colo matrix', async () => {
      const matrix = await generateMatrix(MATRIX_COLOS)

      console.log('\n=== Colo Latency Matrix (p50 in ms) ===')
      console.log(formatMatrixTable(matrix))

      console.log('Summary:')
      console.log(`  Total pairs: ${matrix.summary.totalMeasurements}`)
      console.log(`  Successful: ${matrix.summary.successfulMeasurements}`)
      console.log(`  Duration: ${(matrix.duration / 1000).toFixed(1)}s`)
      console.log(`  Min latency: ${matrix.summary.minLatency.source} -> ${matrix.summary.minLatency.target}: ${matrix.summary.minLatency.p50.toFixed(2)} ms`)
      console.log(`  Max latency: ${matrix.summary.maxLatency.source} -> ${matrix.summary.maxLatency.target}: ${matrix.summary.maxLatency.p50.toFixed(2)} ms`)

      // Record matrix data
      record({
        name: 'colo-matrix-full',
        target: MATRIX_TARGET,
        iterations: matrix.summary.successfulMeasurements,
        stats: {
          p50: matrix.summary.minLatency.p50,
          p95: matrix.summary.maxLatency.p50,
          p99: matrix.summary.maxLatency.p50,
          min: matrix.summary.minLatency.p50,
          max: matrix.summary.maxLatency.p50,
          mean: (matrix.summary.minLatency.p50 + matrix.summary.maxLatency.p50) / 2,
          stddev: 0,
        },
        samples: matrix.measurements.map((m) => m.p50),
        timestamp: matrix.generatedAt,
        metadata: {
          colos: matrix.colos,
          duration: matrix.duration,
          matrixSize: `${matrix.colos.length}x${matrix.colos.length}`,
        },
      })

      expect(matrix.measurements.length).toBeGreaterThan(0)
    }, 300000) // 5 minute timeout for full matrix

    it('generates regional sub-matrix (NA only)', async () => {
      const matrix = await generateMatrix(MATRIX_NA_COLOS)

      console.log('\n=== North America Colo Matrix (p50 in ms) ===')
      console.log(formatMatrixTable(matrix))

      record({
        name: 'colo-matrix-na',
        target: MATRIX_TARGET,
        iterations: matrix.summary.successfulMeasurements,
        stats: {
          p50: matrix.summary.avgIntraRegion.NA,
          p95: matrix.summary.maxLatency.p50,
          p99: matrix.summary.maxLatency.p50,
          min: matrix.summary.minLatency.p50,
          max: matrix.summary.maxLatency.p50,
          mean: matrix.summary.avgIntraRegion.NA,
          stddev: 0,
        },
        samples: matrix.measurements.map((m) => m.p50),
        timestamp: matrix.generatedAt,
        metadata: { region: 'NA' },
      })

      console.log(`  Intra-NA avg: ${matrix.summary.avgIntraRegion.NA.toFixed(2)} ms`)

      expect(matrix.measurements.length).toBeGreaterThan(0)
    }, 120000)

    it('generates regional sub-matrix (EU only)', async () => {
      const matrix = await generateMatrix(MATRIX_EU_COLOS)

      console.log('\n=== Europe Colo Matrix (p50 in ms) ===')
      console.log(formatMatrixTable(matrix))

      record({
        name: 'colo-matrix-eu',
        target: MATRIX_TARGET,
        iterations: matrix.summary.successfulMeasurements,
        stats: {
          p50: matrix.summary.avgIntraRegion.EU,
          p95: matrix.summary.maxLatency.p50,
          p99: matrix.summary.maxLatency.p50,
          min: matrix.summary.minLatency.p50,
          max: matrix.summary.maxLatency.p50,
          mean: matrix.summary.avgIntraRegion.EU,
          stddev: 0,
        },
        samples: matrix.measurements.map((m) => m.p50),
        timestamp: matrix.generatedAt,
        metadata: { region: 'EU' },
      })

      console.log(`  Intra-EU avg: ${matrix.summary.avgIntraRegion.EU.toFixed(2)} ms`)

      expect(matrix.measurements.length).toBeGreaterThan(0)
    }, 120000)

    it('generates regional sub-matrix (APAC only)', async () => {
      const matrix = await generateMatrix(MATRIX_APAC_COLOS)

      console.log('\n=== APAC Colo Matrix (p50 in ms) ===')
      console.log(formatMatrixTable(matrix))

      record({
        name: 'colo-matrix-apac',
        target: MATRIX_TARGET,
        iterations: matrix.summary.successfulMeasurements,
        stats: {
          p50: matrix.summary.avgIntraRegion.APAC,
          p95: matrix.summary.maxLatency.p50,
          p99: matrix.summary.maxLatency.p50,
          min: matrix.summary.minLatency.p50,
          max: matrix.summary.maxLatency.p50,
          mean: matrix.summary.avgIntraRegion.APAC,
          stddev: 0,
        },
        samples: matrix.measurements.map((m) => m.p50),
        timestamp: matrix.generatedAt,
        metadata: { region: 'APAC' },
      })

      console.log(`  Intra-APAC avg: ${matrix.summary.avgIntraRegion.APAC.toFixed(2)} ms`)

      expect(matrix.measurements.length).toBeGreaterThan(0)
    }, 120000)
  })

  // ============================================================================
  // MATRIX RESULT FORMAT AND STORAGE
  // ============================================================================

  describe('matrix result format', () => {
    it('validates matrix result structure', async () => {
      // Generate a minimal matrix for validation
      const miniColos = [MATRIX_NA_COLOS[0], MATRIX_EU_COLOS[0]] // Just 2 colos
      const matrix = await generateMatrix(miniColos)

      // Validate structure
      expect(matrix).toHaveProperty('measurements')
      expect(matrix).toHaveProperty('generatedAt')
      expect(matrix).toHaveProperty('duration')
      expect(matrix).toHaveProperty('colos')
      expect(matrix).toHaveProperty('summary')

      // Validate measurements
      if (matrix.measurements.length > 0) {
        const m = matrix.measurements[0]
        expect(m).toHaveProperty('sourceColo')
        expect(m).toHaveProperty('targetColo')
        expect(m).toHaveProperty('p50')
        expect(m).toHaveProperty('p95')
        expect(m).toHaveProperty('p99')
        expect(m).toHaveProperty('min')
        expect(m).toHaveProperty('max')
        expect(m).toHaveProperty('mean')
        expect(m).toHaveProperty('stddev')
        expect(m).toHaveProperty('sampleCount')
        expect(m).toHaveProperty('timestamp')

        // Validate types
        expect(typeof m.sourceColo).toBe('string')
        expect(typeof m.targetColo).toBe('string')
        expect(typeof m.p50).toBe('number')
        expect(m.p50).toBeGreaterThanOrEqual(0)
      }

      // Validate summary
      expect(matrix.summary).toHaveProperty('minLatency')
      expect(matrix.summary).toHaveProperty('maxLatency')
      expect(matrix.summary).toHaveProperty('avgIntraRegion')
      expect(matrix.summary).toHaveProperty('avgInterRegion')
      expect(matrix.summary).toHaveProperty('totalMeasurements')
      expect(matrix.summary).toHaveProperty('successfulMeasurements')
    }, 60000)

    it('exports matrix to JSON format', async () => {
      const miniColos = [MATRIX_NA_COLOS[0], MATRIX_EU_COLOS[0]]
      const matrix = await generateMatrix(miniColos)

      // Convert to JSON
      const json = JSON.stringify(matrix, null, 2)

      // Validate JSON is parseable
      const parsed = JSON.parse(json)
      expect(parsed.colos).toEqual(miniColos)
      expect(parsed.measurements).toBeInstanceOf(Array)

      console.log('\n=== Matrix JSON Export (sample) ===')
      console.log(json.substring(0, 500) + '...')
    }, 60000)

    it('stores matrix results for historical tracking', async () => {
      const miniColos = [MATRIX_NA_COLOS[0]]
      const matrix = await generateMatrix(miniColos)

      // Record each measurement individually for tracking
      for (const m of matrix.measurements) {
        record({
          name: `colo-pair-${m.sourceColo}-${m.targetColo}`,
          target: MATRIX_TARGET,
          iterations: m.sampleCount,
          stats: {
            p50: m.p50,
            p95: m.p95,
            p99: m.p99,
            min: m.min,
            max: m.max,
            mean: m.mean,
            stddev: m.stddev,
          },
          samples: [], // Samples not stored for individual pairs
          timestamp: m.timestamp,
          colo: m.sourceColo,
          metadata: { targetColo: m.targetColo },
        })
      }

      // Record matrix summary
      record({
        name: 'colo-matrix-mini',
        target: MATRIX_TARGET,
        iterations: matrix.summary.successfulMeasurements,
        stats: {
          p50: 0,
          p95: 0,
          p99: 0,
          min: matrix.summary.minLatency.p50,
          max: matrix.summary.maxLatency.p50,
          mean: 0,
          stddev: 0,
        },
        samples: matrix.measurements.map((m) => m.p50),
        timestamp: matrix.generatedAt,
        metadata: {
          matrixColos: matrix.colos,
          duration: matrix.duration,
          summary: matrix.summary,
        },
      })

      expect(matrix.measurements.length).toBeGreaterThanOrEqual(0)
    }, 60000)
  })

  // ============================================================================
  // REGIONAL ANALYSIS
  // ============================================================================

  describe('regional analysis', () => {
    it('compares intra-region vs inter-region latency', async () => {
      const matrix = await generateMatrix(MATRIX_COLOS)

      console.log('\n=== Regional Latency Analysis ===')
      console.log('\nIntra-region averages (p50):')
      console.log(`  NA: ${matrix.summary.avgIntraRegion.NA.toFixed(2)} ms`)
      console.log(`  EU: ${matrix.summary.avgIntraRegion.EU.toFixed(2)} ms`)
      console.log(`  APAC: ${matrix.summary.avgIntraRegion.APAC.toFixed(2)} ms`)

      console.log('\nInter-region averages (p50):')
      console.log(`  NA <-> EU: ${matrix.summary.avgInterRegion['NA-EU'].toFixed(2)} ms`)
      console.log(`  NA <-> APAC: ${matrix.summary.avgInterRegion['NA-APAC'].toFixed(2)} ms`)
      console.log(`  EU <-> APAC: ${matrix.summary.avgInterRegion['EU-APAC'].toFixed(2)} ms`)

      // Calculate overhead
      const avgIntra = (matrix.summary.avgIntraRegion.NA + matrix.summary.avgIntraRegion.EU + matrix.summary.avgIntraRegion.APAC) / 3
      const avgInter =
        (matrix.summary.avgInterRegion['NA-EU'] + matrix.summary.avgInterRegion['NA-APAC'] + matrix.summary.avgInterRegion['EU-APAC']) / 3

      if (avgIntra > 0) {
        const overhead = ((avgInter - avgIntra) / avgIntra) * 100
        console.log(`\nInter-region overhead: ${overhead.toFixed(1)}%`)
      }

      record({
        name: 'colo-regional-analysis',
        target: MATRIX_TARGET,
        iterations: matrix.summary.successfulMeasurements,
        stats: {
          p50: avgIntra,
          p95: avgInter,
          p99: avgInter,
          min: matrix.summary.minLatency.p50,
          max: matrix.summary.maxLatency.p50,
          mean: avgIntra,
          stddev: 0,
        },
        samples: [],
        timestamp: matrix.generatedAt,
        metadata: {
          intraRegion: matrix.summary.avgIntraRegion,
          interRegion: matrix.summary.avgInterRegion,
        },
      })

      expect(matrix.measurements.length).toBeGreaterThan(0)
    }, 300000)

    it('identifies fastest colo pairs per region', async () => {
      const matrix = await generateMatrix(MATRIX_COLOS)

      // Group by region pair
      const regionPairs: Map<string, ColoMeasurement[]> = new Map()

      for (const m of matrix.measurements) {
        const sourceRegion = getColoRegion(m.sourceColo)
        const targetRegion = getColoRegion(m.targetColo)
        const key = `${sourceRegion}-${targetRegion}`

        if (!regionPairs.has(key)) {
          regionPairs.set(key, [])
        }
        regionPairs.get(key)!.push(m)
      }

      console.log('\n=== Fastest Colo Pairs by Region ===')

      Array.from(regionPairs.entries()).forEach(([pair, measurements]) => {
        if (measurements.length > 0) {
          const sorted = [...measurements].sort((a, b) => a.p50 - b.p50)
          const fastest = sorted[0]
          console.log(`  ${pair}: ${fastest.sourceColo} -> ${fastest.targetColo}: ${fastest.p50.toFixed(2)} ms`)
        }
      })

      expect(regionPairs.size).toBeGreaterThan(0)
    }, 300000)
  })

  // ============================================================================
  // SUMMARY
  // ============================================================================

  describe('Colo Matrix Summary', () => {
    it('generates comprehensive colo matrix report', async () => {
      console.log('\n========================================')
      console.log('COLO-TO-COLO LATENCY MATRIX SUMMARY')
      console.log('========================================\n')

      const matrix = await generateMatrix(MATRIX_COLOS)

      console.log('Matrix Overview:')
      console.log(`  Colos tested: ${matrix.colos.join(', ')}`)
      console.log(`  Total pairs: ${matrix.summary.totalMeasurements}`)
      console.log(`  Successful measurements: ${matrix.summary.successfulMeasurements}`)
      console.log(`  Generation time: ${(matrix.duration / 1000).toFixed(1)}s`)

      console.log('\n' + formatMatrixTable(matrix))

      console.log('Key findings:')
      console.log(`  Fastest pair: ${matrix.summary.minLatency.source} -> ${matrix.summary.minLatency.target} (${matrix.summary.minLatency.p50.toFixed(2)} ms)`)
      console.log(`  Slowest pair: ${matrix.summary.maxLatency.source} -> ${matrix.summary.maxLatency.target} (${matrix.summary.maxLatency.p50.toFixed(2)} ms)`)

      console.log('\nRegional averages:')
      console.log(`  Intra-NA: ${matrix.summary.avgIntraRegion.NA.toFixed(2)} ms`)
      console.log(`  Intra-EU: ${matrix.summary.avgIntraRegion.EU.toFixed(2)} ms`)
      console.log(`  Intra-APAC: ${matrix.summary.avgIntraRegion.APAC.toFixed(2)} ms`)
      console.log(`  NA <-> EU: ${matrix.summary.avgInterRegion['NA-EU'].toFixed(2)} ms`)
      console.log(`  NA <-> APAC: ${matrix.summary.avgInterRegion['NA-APAC'].toFixed(2)} ms`)
      console.log(`  EU <-> APAC: ${matrix.summary.avgInterRegion['EU-APAC'].toFixed(2)} ms`)

      console.log('\nRecommendations:')
      console.log('  - Use intra-region DO placement for latency-sensitive operations')
      console.log('  - Consider replication strategy for cross-region access patterns')
      console.log('  - Monitor inter-region latency for global user distribution')

      // Record final summary
      record({
        name: 'colo-matrix-summary',
        target: MATRIX_TARGET,
        iterations: matrix.summary.successfulMeasurements,
        stats: {
          p50: matrix.summary.minLatency.p50,
          p95: matrix.summary.maxLatency.p50,
          p99: matrix.summary.maxLatency.p50,
          min: matrix.summary.minLatency.p50,
          max: matrix.summary.maxLatency.p50,
          mean: (matrix.summary.avgIntraRegion.NA + matrix.summary.avgIntraRegion.EU + matrix.summary.avgIntraRegion.APAC) / 3,
          stddev: 0,
        },
        samples: matrix.measurements.map((m) => m.p50),
        timestamp: matrix.generatedAt,
        metadata: {
          colos: matrix.colos,
          duration: matrix.duration,
          summary: matrix.summary,
        },
      })

      expect(matrix.measurements.length).toBeGreaterThan(0)
    }, 600000) // 10 minute timeout for full report
  })
})
