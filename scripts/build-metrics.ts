#!/usr/bin/env npx tsx
/**
 * Build Metrics Script
 *
 * Analyzes the app build output to track chunk sizes and ensure they stay
 * within acceptable limits for static prerendering.
 *
 * Usage: npx tsx scripts/build-metrics.ts [--json] [--threshold=500]
 *
 * @see docs/plans/2026-01-12-fumadocs-static-prerender-design.md
 */

import { readdir, stat } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'

interface ChunkInfo {
  name: string
  size: number
  sizeKB: string
  sizeFormatted: string
  category: 'docs' | 'vendor' | 'app' | 'other'
  isOverThreshold: boolean
}

interface BuildMetrics {
  timestamp: string
  totalChunks: number
  totalSizeKB: number
  docsChunks: ChunkInfo[]
  vendorChunks: ChunkInfo[]
  appChunks: ChunkInfo[]
  otherChunks: ChunkInfo[]
  largestChunk: ChunkInfo | null
  chunksOverThreshold: ChunkInfo[]
  thresholdKB: number
}

const DIST_DIR = join(process.cwd(), 'app', 'dist')
const ASSETS_DIR = join(DIST_DIR, 'client', 'assets')
const DEFAULT_THRESHOLD_KB = 500

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`
}

function categorizeChunk(name: string): ChunkInfo['category'] {
  if (name.startsWith('docs-')) return 'docs'
  if (name.includes('vendor') || name.includes('node_modules')) return 'vendor'
  if (name.includes('app') || name.includes('route')) return 'app'
  return 'other'
}

async function collectChunks(dir: string, thresholdKB: number): Promise<ChunkInfo[]> {
  const chunks: ChunkInfo[] = []

  try {
    const files = await readdir(dir)

    for (const file of files) {
      // Only analyze JS chunks
      if (extname(file) !== '.js') continue

      const filePath = join(dir, file)
      const stats = await stat(filePath)
      const sizeKB = stats.size / 1024
      const name = basename(file, '.js')
        .replace(/-[a-zA-Z0-9]{8}$/, '') // Remove hash suffix

      chunks.push({
        name,
        size: stats.size,
        sizeKB: sizeKB.toFixed(1),
        sizeFormatted: formatBytes(stats.size),
        category: categorizeChunk(name),
        isOverThreshold: sizeKB > thresholdKB,
      })
    }
  } catch {
    // Directory might not exist if build hasn't run
  }

  return chunks.sort((a, b) => b.size - a.size)
}

async function analyzeBuild(thresholdKB: number): Promise<BuildMetrics> {
  const chunks = await collectChunks(ASSETS_DIR, thresholdKB)

  const docsChunks = chunks.filter((c) => c.category === 'docs')
  const vendorChunks = chunks.filter((c) => c.category === 'vendor')
  const appChunks = chunks.filter((c) => c.category === 'app')
  const otherChunks = chunks.filter((c) => c.category === 'other')

  const totalSizeKB = chunks.reduce((sum, c) => sum + c.size, 0) / 1024
  const chunksOverThreshold = chunks.filter((c) => c.isOverThreshold)

  return {
    timestamp: new Date().toISOString(),
    totalChunks: chunks.length,
    totalSizeKB: Math.round(totalSizeKB),
    docsChunks,
    vendorChunks,
    appChunks,
    otherChunks,
    largestChunk: chunks[0] ?? null,
    chunksOverThreshold,
    thresholdKB,
  }
}

function printMetrics(metrics: BuildMetrics): void {
  console.log('\n=== Build Metrics ===\n')
  console.log(`Timestamp: ${metrics.timestamp}`)
  console.log(`Total chunks: ${metrics.totalChunks}`)
  console.log(`Total size: ${metrics.totalSizeKB}KB`)
  console.log(`Threshold: ${metrics.thresholdKB}KB\n`)

  if (metrics.largestChunk) {
    console.log(`Largest chunk: ${metrics.largestChunk.name} (${metrics.largestChunk.sizeFormatted})`)
  }

  if (metrics.chunksOverThreshold.length > 0) {
    console.log(`\n[WARNING] ${metrics.chunksOverThreshold.length} chunks exceed ${metrics.thresholdKB}KB threshold:`)
    for (const chunk of metrics.chunksOverThreshold) {
      console.log(`  - ${chunk.name}: ${chunk.sizeFormatted}`)
    }
  } else {
    console.log('\n[OK] All chunks within threshold')
  }

  if (metrics.docsChunks.length > 0) {
    console.log('\n--- Docs Chunks ---')
    for (const chunk of metrics.docsChunks) {
      const flag = chunk.isOverThreshold ? ' [OVER]' : ''
      console.log(`  ${chunk.name}: ${chunk.sizeFormatted}${flag}`)
    }
  }

  if (metrics.vendorChunks.length > 0) {
    console.log('\n--- Vendor Chunks (top 10) ---')
    for (const chunk of metrics.vendorChunks.slice(0, 10)) {
      const flag = chunk.isOverThreshold ? ' [OVER]' : ''
      console.log(`  ${chunk.name}: ${chunk.sizeFormatted}${flag}`)
    }
  }

  console.log('')
}

// Main
async function main() {
  const args = process.argv.slice(2)
  const jsonOutput = args.includes('--json')
  const thresholdArg = args.find((a) => a.startsWith('--threshold='))
  const thresholdKB = thresholdArg
    ? parseInt(thresholdArg.split('=')[1], 10)
    : DEFAULT_THRESHOLD_KB

  const metrics = await analyzeBuild(thresholdKB)

  if (jsonOutput) {
    console.log(JSON.stringify(metrics, null, 2))
  } else {
    printMetrics(metrics)
  }

  // Exit with error code if any chunks exceed threshold
  if (metrics.chunksOverThreshold.length > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Error analyzing build:', err)
  process.exit(1)
})
