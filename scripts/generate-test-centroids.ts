#!/usr/bin/env npx tsx
/**
 * Generate Test Centroid Files for Vector Distance POC
 *
 * Creates Float32 binary files with random centroid vectors for testing
 * vector distance computation in Snippet constraints.
 *
 * Output files:
 *   - centroids-256x384.bin  (256 centroids, 384 dims) = 393KB
 *   - centroids-512x384.bin  (512 centroids, 384 dims) = 786KB
 *   - centroids-1024x384.bin (1024 centroids, 384 dims) = 1.5MB
 *
 * Usage:
 *   npx tsx scripts/generate-test-centroids.ts
 *   npx tsx scripts/generate-test-centroids.ts --upload
 *
 * The --upload flag will upload to cdn.apis.do (requires CF credentials)
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env if exists
const envPath = resolve(__dirname, '../.env')
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=')
      const value = valueParts.join('=')
      if (key && value && !process.env[key]) {
        process.env[key] = value
      }
    }
  }
}

interface CentroidConfig {
  numCentroids: number
  dims: number
  filename: string
}

const CONFIGS: CentroidConfig[] = [
  { numCentroids: 256, dims: 384, filename: 'centroids-256x384.bin' },
  { numCentroids: 512, dims: 384, filename: 'centroids-512x384.bin' },
  { numCentroids: 1024, dims: 384, filename: 'centroids-1024x384.bin' },
]

/**
 * Generate normalized random vectors (unit length for cosine similarity)
 */
function generateCentroids(numCentroids: number, dims: number): Float32Array {
  const data = new Float32Array(numCentroids * dims)

  for (let i = 0; i < numCentroids; i++) {
    const offset = i * dims
    let norm = 0

    // Generate random values
    for (let j = 0; j < dims; j++) {
      // Use normal distribution for better vector properties
      const u1 = Math.random()
      const u2 = Math.random()
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
      data[offset + j] = z
      norm += z * z
    }

    // Normalize to unit length
    norm = Math.sqrt(norm)
    for (let j = 0; j < dims; j++) {
      data[offset + j] /= norm
    }
  }

  return data
}

/**
 * Generate a random query vector (normalized)
 */
function generateQueryVector(dims: number): Float32Array {
  const data = new Float32Array(dims)
  let norm = 0

  for (let j = 0; j < dims; j++) {
    const u1 = Math.random()
    const u2 = Math.random()
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    data[j] = z
    norm += z * z
  }

  norm = Math.sqrt(norm)
  for (let j = 0; j < dims; j++) {
    data[j] /= norm
  }

  return data
}

/**
 * Compute dot product distance (for normalized vectors, this is cosine similarity)
 */
function dotProduct(a: Float32Array, b: Float32Array, bOffset: number, dims: number): number {
  let sum = 0
  for (let i = 0; i < dims; i++) {
    sum += a[i] * b[bOffset + i]
  }
  return sum
}

/**
 * Find top-K centroids by dot product similarity
 */
function topK(
  query: Float32Array,
  centroids: Float32Array,
  numCentroids: number,
  dims: number,
  k: number
): Array<{ index: number; score: number }> {
  const scores: Array<{ index: number; score: number }> = []

  for (let i = 0; i < numCentroids; i++) {
    const score = dotProduct(query, centroids, i * dims, dims)
    scores.push({ index: i, score })
  }

  // Sort descending by score
  scores.sort((a, b) => b.score - a.score)

  return scores.slice(0, k)
}

/**
 * Benchmark the vector distance computation
 */
function benchmark(config: CentroidConfig, iterations: number = 100): void {
  const { numCentroids, dims, filename } = config

  console.log(`\nBenchmarking ${filename}...`)
  console.log(`  Centroids: ${numCentroids}, Dims: ${dims}`)
  console.log(`  Size: ${((numCentroids * dims * 4) / 1024).toFixed(1)}KB`)

  const centroids = generateCentroids(numCentroids, dims)
  const query = generateQueryVector(dims)

  // Warmup
  for (let i = 0; i < 10; i++) {
    topK(query, centroids, numCentroids, dims, 10)
  }

  // Benchmark
  const times: number[] = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    topK(query, centroids, numCentroids, dims, 10)
    times.push(performance.now() - start)
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length
  const min = Math.min(...times)
  const max = Math.max(...times)
  const p95 = times.sort((a, b) => a - b)[Math.floor(iterations * 0.95)]

  console.log(`  Results (${iterations} iterations):`)
  console.log(`    Avg: ${avg.toFixed(3)}ms`)
  console.log(`    Min: ${min.toFixed(3)}ms`)
  console.log(`    Max: ${max.toFixed(3)}ms`)
  console.log(`    P95: ${p95.toFixed(3)}ms`)
}

/**
 * Generate and save centroid files
 */
function generateFiles(): void {
  const outDir = resolve(__dirname, '../test-data')

  // Ensure output directory exists
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true })
  }

  for (const config of CONFIGS) {
    const { numCentroids, dims, filename } = config
    const filePath = resolve(outDir, filename)

    console.log(`Generating ${filename}...`)
    const centroids = generateCentroids(numCentroids, dims)

    // Write as raw Float32 binary
    const buffer = Buffer.from(centroids.buffer)
    writeFileSync(filePath, buffer)

    const sizeKB = (buffer.length / 1024).toFixed(1)
    console.log(`  Written: ${filePath} (${sizeKB}KB)`)
  }

  // Also generate a query vector for testing
  const queryPath = resolve(outDir, 'query-384.bin')
  const query = generateQueryVector(384)
  writeFileSync(queryPath, Buffer.from(query.buffer))
  console.log(`  Written: ${queryPath}`)
}

/**
 * Upload files to R2 via cdn.apis.do
 */
async function uploadFiles(): Promise<void> {
  const CF_API_TOKEN = process.env.CF_API_TOKEN
  const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID
  const R2_BUCKET = process.env.R2_BUCKET || 'cdn'

  if (!CF_API_TOKEN || !CF_ACCOUNT_ID) {
    console.error('Error: CF_API_TOKEN and CF_ACCOUNT_ID required for upload')
    console.error('Add to .env file')
    process.exit(1)
  }

  const outDir = resolve(__dirname, '../test-data')

  for (const config of CONFIGS) {
    const filePath = resolve(outDir, config.filename)

    if (!existsSync(filePath)) {
      console.error(`File not found: ${filePath}`)
      console.error('Run without --upload first to generate files')
      process.exit(1)
    }

    const data = readFileSync(filePath)
    const objectKey = `test/${config.filename}`

    console.log(`Uploading ${config.filename} to R2...`)

    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${R2_BUCKET}/objects/${objectKey}`

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/octet-stream',
      },
      body: data,
    })

    if (!response.ok) {
      const text = await response.text()
      console.error(`Upload failed: ${response.status} ${text}`)
      process.exit(1)
    }

    console.log(`  Uploaded: https://cdn.apis.do/test/${config.filename}`)
  }

  // Upload query vector
  const queryPath = resolve(outDir, 'query-384.bin')
  if (existsSync(queryPath)) {
    const data = readFileSync(queryPath)
    const objectKey = 'test/query-384.bin'

    console.log('Uploading query-384.bin to R2...')

    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${R2_BUCKET}/objects/${objectKey}`

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/octet-stream',
      },
      body: data,
    })

    if (!response.ok) {
      const text = await response.text()
      console.error(`Upload failed: ${response.status} ${text}`)
      process.exit(1)
    }

    console.log(`  Uploaded: https://cdn.apis.do/test/query-384.bin`)
  }
}

// Main
const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Generate Test Centroid Files for Vector Distance POC

Usage:
  npx tsx scripts/generate-test-centroids.ts           Generate files locally
  npx tsx scripts/generate-test-centroids.ts --upload  Upload to cdn.apis.do
  npx tsx scripts/generate-test-centroids.ts --bench   Run benchmarks only

Output:
  test-data/centroids-256x384.bin   (393KB)
  test-data/centroids-512x384.bin   (786KB)
  test-data/centroids-1024x384.bin  (1.5MB)
  test-data/query-384.bin           (1.5KB)
`)
  process.exit(0)
}

if (args.includes('--bench')) {
  console.log('Running benchmarks...')
  for (const config of CONFIGS) {
    benchmark(config)
  }
} else {
  console.log('Generating centroid files...')
  generateFiles()

  console.log('\nRunning local benchmarks...')
  for (const config of CONFIGS) {
    benchmark(config)
  }

  if (args.includes('--upload')) {
    console.log('\nUploading to cdn.apis.do...')
    await uploadFiles()
  } else {
    console.log('\nTo upload files, run:')
    console.log('  npx tsx scripts/generate-test-centroids.ts --upload')
  }
}
