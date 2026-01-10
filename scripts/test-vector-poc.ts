#!/usr/bin/env npx tsx
/**
 * Test Vector Distance POC
 *
 * This script tests the vector distance computation that will run in Snippets.
 * It fetches centroid data from the remote R2 bucket and measures performance.
 *
 * Usage:
 *   npx tsx scripts/test-vector-poc.ts
 *   npx tsx scripts/test-vector-poc.ts --centroids=512
 */

const CENTROID_URLS: Record<string, string> = {
  '256': 'https://assets.workers.do/test/centroids-256x384.bin',
  '512': 'https://assets.workers.do/test/centroids-512x384.bin',
  '1024': 'https://assets.workers.do/test/centroids-1024x384.bin',
}

const DIMS = 384
const TOP_K = 10

// Performance targets (in milliseconds)
const TARGETS: Record<string, number> = {
  '256': 1,
  '512': 2,
  '1024': 3,
}

async function testVector(centroidCount: string): Promise<void> {
  console.log(`\nTesting ${centroidCount} centroids...`)

  const url = CENTROID_URLS[centroidCount]
  const numCentroids = parseInt(centroidCount, 10)
  const targetMs = TARGETS[centroidCount]

  // Fetch centroids
  console.log(`  Fetching from ${url}...`)
  const fetchStart = performance.now()
  const res = await fetch(url)

  if (!res.ok) {
    console.error(`  Failed to fetch: ${res.status}`)
    return
  }

  const buffer = await res.arrayBuffer()
  const fetchTime = performance.now() - fetchStart
  console.log(`  Fetch time: ${fetchTime.toFixed(2)}ms (${buffer.byteLength} bytes)`)
  console.log(`  Cache status: ${res.headers.get('cf-cache-status') || 'N/A'}`)

  // Parse as Float32Array
  const parseStart = performance.now()
  const centroids = new Float32Array(buffer)
  const parseTime = performance.now() - parseStart
  console.log(`  Parse time: ${parseTime.toFixed(3)}ms`)

  // Generate random query vector (normalized)
  const query = new Float32Array(DIMS)
  let queryNorm = 0
  for (let i = 0; i < DIMS; i++) {
    const val = Math.sin(i * 12.9898 + Date.now() * 0.001) * 43758.5453
    query[i] = val - Math.floor(val)
    queryNorm += query[i] * query[i]
  }
  queryNorm = Math.sqrt(queryNorm)
  for (let i = 0; i < DIMS; i++) {
    query[i] /= queryNorm
  }

  // Warm up
  for (let warmup = 0; warmup < 10; warmup++) {
    const scores = new Float32Array(numCentroids)
    for (let c = 0; c < numCentroids; c++) {
      let dot = 0
      const offset = c * DIMS
      for (let d = 0; d < DIMS; d++) {
        dot += query[d] * centroids[offset + d]
      }
      scores[c] = dot
    }
  }

  // Benchmark compute time
  const iterations = 100
  const times: number[] = []

  for (let iter = 0; iter < iterations; iter++) {
    const computeStart = performance.now()

    // Compute dot product distances
    const scores = new Float32Array(numCentroids)
    for (let c = 0; c < numCentroids; c++) {
      let dot = 0
      const offset = c * DIMS
      for (let d = 0; d < DIMS; d++) {
        dot += query[d] * centroids[offset + d]
      }
      scores[c] = dot
    }

    // Find top-K
    const topK: Array<{ index: number; score: number }> = []
    const used = new Set<number>()

    for (let i = 0; i < TOP_K && i < numCentroids; i++) {
      let bestIdx = -1
      let bestScore = -Infinity

      for (let c = 0; c < numCentroids; c++) {
        if (!used.has(c) && scores[c] > bestScore) {
          bestScore = scores[c]
          bestIdx = c
        }
      }

      if (bestIdx >= 0) {
        used.add(bestIdx)
        topK.push({ index: bestIdx, score: bestScore })
      }
    }

    times.push(performance.now() - computeStart)
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length
  const min = Math.min(...times)
  const max = Math.max(...times)
  const sorted = [...times].sort((a, b) => a - b)
  const p95 = sorted[Math.floor(iterations * 0.95)]

  console.log(`  Compute results (${iterations} iterations):`)
  console.log(`    Avg: ${avg.toFixed(3)}ms`)
  console.log(`    Min: ${min.toFixed(3)}ms`)
  console.log(`    Max: ${max.toFixed(3)}ms`)
  console.log(`    P95: ${p95.toFixed(3)}ms`)
  console.log(`    Target: <${targetMs}ms`)

  const meetsTarget = avg < targetMs
  if (meetsTarget) {
    console.log(`    PASS: Average ${avg.toFixed(3)}ms < ${targetMs}ms target`)
  } else {
    console.log(`    FAIL: Average ${avg.toFixed(3)}ms >= ${targetMs}ms target`)
  }
}

// Main
const args = process.argv.slice(2)
const centroidsArg = args.find(a => a.startsWith('--centroids='))
const centroidCounts = centroidsArg
  ? [centroidsArg.split('=')[1]]
  : ['256', '512', '1024']

console.log('Vector Distance POC Test')
console.log('========================')
console.log('Testing centroid distance computation for Snippet constraints.')
console.log('')
console.log('Memory requirements:')
console.log('  256 x 384 x 4 = 393KB')
console.log('  512 x 384 x 4 = 786KB')
console.log('  1024 x 384 x 4 = 1.5MB')
console.log('')
console.log('Performance targets:')
console.log('  256 centroids: <1ms')
console.log('  512 centroids: <2ms')
console.log('  1024 centroids: <3ms')

for (const count of centroidCounts) {
  if (!CENTROID_URLS[count]) {
    console.error(`Invalid centroid count: ${count}`)
    continue
  }
  await testVector(count)
}

console.log('\n---')
console.log('Test complete. Results above show whether we meet Snippet constraints.')
