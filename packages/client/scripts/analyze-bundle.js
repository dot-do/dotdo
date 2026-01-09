#!/usr/bin/env node

/**
 * Bundle size analyzer for @dotdo/client
 *
 * Reports minified sizes for all bundle entry points.
 */

import { readFileSync, statSync, readdirSync } from 'fs'
import { join, relative } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { gzipSync } from 'zlib'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const distDir = join(__dirname, '..', 'dist')

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B'
  const kb = bytes / 1024
  return kb.toFixed(2) + ' KB'
}

function analyzeFile(filePath) {
  try {
    const content = readFileSync(filePath)
    const gzipped = gzipSync(content)
    return {
      size: content.length,
      gzip: gzipped.length,
    }
  } catch {
    return null
  }
}

function walkDir(dir, files = []) {
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        walkDir(fullPath, files)
      } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.d.ts')) {
        files.push(fullPath)
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return files
}

console.log('\n@dotdo/client Bundle Analysis\n')
console.log('=' .repeat(60))

const files = walkDir(distDir)
let totalSize = 0
let totalGzip = 0

// Group by category
const categories = {
  'Core': [],
  'Transports': [],
  'Features': [],
}

for (const file of files) {
  const relPath = relative(distDir, file)
  const analysis = analyzeFile(file)

  if (!analysis) continue

  totalSize += analysis.size
  totalGzip += analysis.gzip

  const entry = { path: relPath, ...analysis }

  if (relPath.startsWith('transports/')) {
    categories['Transports'].push(entry)
  } else if (relPath.startsWith('features/')) {
    categories['Features'].push(entry)
  } else {
    categories['Core'].push(entry)
  }
}

for (const [category, items] of Object.entries(categories)) {
  if (items.length === 0) continue

  console.log(`\n${category}:`)
  console.log('-'.repeat(60))

  let categorySize = 0
  let categoryGzip = 0

  for (const item of items.sort((a, b) => a.path.localeCompare(b.path))) {
    // Only show ESM bundles (.js not .cjs)
    if (!item.path.endsWith('.cjs')) {
      console.log(`  ${item.path.padEnd(35)} ${formatBytes(item.size).padStart(10)} (gzip: ${formatBytes(item.gzip)})`)
    }
    categorySize += item.size
    categoryGzip += item.gzip
  }

  console.log('-'.repeat(60))
  console.log(`  Category Total:`.padEnd(35) + ` ${formatBytes(categorySize).padStart(10)} (gzip: ${formatBytes(categoryGzip)})`)
}

console.log('\n' + '='.repeat(60))
console.log(`TOTAL (all bundles):`.padEnd(35) + ` ${formatBytes(totalSize).padStart(10)} (gzip: ${formatBytes(totalGzip)})`)
console.log('='.repeat(60))

// Check targets
const coreBundle = files.find(f => f.endsWith('index.js') && !f.includes('transports') && !f.includes('features'))
if (coreBundle) {
  const analysis = analyzeFile(coreBundle)
  if (analysis) {
    const target = 10 * 1024 // 10KB
    const passed = analysis.size <= target
    console.log(`\nBundle Size Targets:`)
    console.log(`  Full bundle: ${formatBytes(analysis.size)} ${passed ? '< 10KB' : '> 10KB'} [${passed ? 'PASS' : 'FAIL'}]`)
  }
}

console.log('')
