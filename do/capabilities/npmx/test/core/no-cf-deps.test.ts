/**
 * RED Phase Tests: Verify core/ directory has ZERO Cloudflare dependencies
 *
 * These tests ensure the core/ directory remains platform-agnostic and free
 * from any Cloudflare-specific code. This enables the core logic to be reused
 * across different runtime environments (Node.js, Deno, Bun, browsers, etc.)
 *
 * The tests scan all .ts files in core/ recursively and report specific
 * files and line numbers for any violations found.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

// Cloudflare-specific import patterns to detect
const CF_IMPORT_PATTERNS = {
  // @cloudflare/* packages
  cloudflarePackages: /@cloudflare\//,
  // cloudflare:* built-in modules
  cloudflareModules: /cloudflare:/,
  // Specific cloudflare modules that might be imported
  cloudflareWorkers: /from\s+['"]cloudflare:workers['"]/,
  cloudflareEmail: /from\s+['"]cloudflare:email['"]/,
  cloudflareQueues: /from\s+['"]cloudflare:queues['"]/,
  cloudflareVectorize: /from\s+['"]cloudflare:vectorize['"]/,
  cloudflareSockets: /from\s+['"]cloudflare:sockets['"]/,
  cloudflareAi: /from\s+['"]cloudflare:ai['"]/,
}

// Cloudflare-specific type patterns to detect
const CF_TYPE_PATTERNS = {
  // Durable Object types
  durableObject: /\bDurableObject\b/,
  durableObjectState: /\bDurableObjectState\b/,
  durableObjectStub: /\bDurableObjectStub\b/,
  durableObjectId: /\bDurableObjectId\b/,
  durableObjectNamespace: /\bDurableObjectNamespace\b/,
  durableObjectStorage: /\bDurableObjectStorage\b/,
  durableObjectTransaction: /\bDurableObjectTransaction\b/,

  // R2 types
  r2Bucket: /\bR2Bucket\b/,
  r2Object: /\bR2Object\b/,
  r2ObjectBody: /\bR2ObjectBody\b/,
  r2Objects: /\bR2Objects\b/,
  r2UploadedPart: /\bR2UploadedPart\b/,
  r2MultipartUpload: /\bR2MultipartUpload\b/,

  // KV types
  kvNamespace: /\bKVNamespace\b/,

  // D1 types
  d1Database: /\bD1Database\b/,
  d1Result: /\bD1Result\b/,
  d1PreparedStatement: /\bD1PreparedStatement\b/,

  // Workers AI types
  ai: /\bAi\b(?!rport)/,  // Negative lookahead to avoid false positives like "Airport"

  // Queue types
  queue: /\bQueue\b(?!ue)/,  // Avoid false positives
  messageBatch: /\bMessageBatch\b/,
  message: /\bMessage\b(?!s?\s*[:=])/,

  // Vectorize types
  vectorizeIndex: /\bVectorizeIndex\b/,

  // Analytics Engine
  analyticsEngine: /\bAnalyticsEngineDataset\b/,

  // Hyperdrive
  hyperdrive: /\bHyperdrive\b/,

  // Service bindings
  fetcher: /\bFetcher\b/,
  serviceFetcher: /\bService\b(?:Binding)?\b/,

  // ExecutionContext
  executionContext: /\bExecutionContext\b/,

  // WebSocket hibernation
  webSocketRequestResponsePair: /\bWebSocketRequestResponsePair\b/,
}

// Wrangler/environment binding patterns
const WRANGLER_PATTERNS = {
  // Env binding patterns
  envBinding: /env\s*\.\s*(KV|R2|DO|D1|AI|QUEUE|VECTORIZE|HYPERDRIVE|ANALYTICS)/i,
  // Wrangler-specific comments or configs
  wranglerConfig: /wrangler\.toml/,
  // Worker exports
  workerFetch: /export\s+default\s*\{[^}]*fetch\s*:/,
  workerScheduled: /scheduled\s*\([^)]*ScheduledController/,
  workerQueue: /queue\s*\([^)]*MessageBatch/,
  workerEmail: /email\s*\([^)]*EmailMessage/,
}

interface Violation {
  file: string
  line: number
  column: number
  content: string
  pattern: string
  category: 'import' | 'type' | 'wrangler'
}

interface ScanResult {
  files: string[]
  violations: Violation[]
}

/**
 * Recursively collect all TypeScript files in a directory
 */
async function collectTsFiles(dir: string): Promise<string[]> {
  const files: string[] = []

  try {
    const entries = await readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)

      if (entry.isDirectory()) {
        // Skip node_modules and hidden directories
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const subFiles = await collectTsFiles(fullPath)
          files.push(...subFiles)
        }
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
        files.push(fullPath)
      }
    }
  } catch (error) {
    // Directory doesn't exist - this is expected in RED phase
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  return files
}

/**
 * Scan a file for Cloudflare dependency violations
 */
async function scanFileForViolations(filePath: string): Promise<Violation[]> {
  const violations: Violation[] = []
  const content = await readFile(filePath, 'utf-8')
  const lines = content.split('\n')

  lines.forEach((line, index) => {
    const lineNumber = index + 1

    // Check import patterns
    for (const [patternName, pattern] of Object.entries(CF_IMPORT_PATTERNS)) {
      const match = pattern.exec(line)
      if (match) {
        violations.push({
          file: filePath,
          line: lineNumber,
          column: match.index + 1,
          content: line.trim(),
          pattern: patternName,
          category: 'import',
        })
      }
    }

    // Check type patterns
    for (const [patternName, pattern] of Object.entries(CF_TYPE_PATTERNS)) {
      const match = pattern.exec(line)
      if (match) {
        // Skip if this is in a comment
        const beforeMatch = line.substring(0, match.index)
        if (beforeMatch.includes('//') || beforeMatch.includes('/*')) {
          continue
        }

        violations.push({
          file: filePath,
          line: lineNumber,
          column: match.index + 1,
          content: line.trim(),
          pattern: patternName,
          category: 'type',
        })
      }
    }

    // Check wrangler patterns
    for (const [patternName, pattern] of Object.entries(WRANGLER_PATTERNS)) {
      const match = pattern.exec(line)
      if (match) {
        // Skip if this is in a comment
        const beforeMatch = line.substring(0, match.index)
        if (beforeMatch.includes('//') || beforeMatch.includes('/*')) {
          continue
        }

        violations.push({
          file: filePath,
          line: lineNumber,
          column: match.index + 1,
          content: line.trim(),
          pattern: patternName,
          category: 'wrangler',
        })
      }
    }
  })

  return violations
}

/**
 * Scan the entire core directory for CF dependency violations
 */
async function scanCoreDirectory(): Promise<ScanResult> {
  const coreDir = join(process.cwd(), 'core')
  const files = await collectTsFiles(coreDir)
  const violations: Violation[] = []

  for (const file of files) {
    const fileViolations = await scanFileForViolations(file)
    violations.push(...fileViolations)
  }

  return { files, violations }
}

/**
 * Format violations for readable test output
 */
function formatViolations(violations: Violation[]): string {
  if (violations.length === 0) {
    return 'No violations found'
  }

  const cwd = process.cwd()
  const grouped = violations.reduce(
    (acc, v) => {
      const relPath = relative(cwd, v.file)
      if (!acc[relPath]) {
        acc[relPath] = []
      }
      acc[relPath].push(v)
      return acc
    },
    {} as Record<string, Violation[]>
  )

  let output = `Found ${violations.length} violation(s):\n\n`

  for (const [file, fileViolations] of Object.entries(grouped)) {
    output += `${file}:\n`
    for (const v of fileViolations) {
      output += `  Line ${v.line}: [${v.category}:${v.pattern}] ${v.content}\n`
    }
    output += '\n'
  }

  return output
}

// ============================================================================
// Test Suite
// ============================================================================

describe('core/ Zero Cloudflare Dependencies', () => {
  let scanResult: ScanResult

  beforeAll(async () => {
    scanResult = await scanCoreDirectory()
  })

  describe('Directory Existence', () => {
    it('should have a core/ directory', async () => {
      const coreDir = join(process.cwd(), 'core')
      let exists = false

      try {
        const stats = await stat(coreDir)
        exists = stats.isDirectory()
      } catch {
        exists = false
      }

      expect(exists, 'core/ directory must exist').toBe(true)
    })

    it('should have TypeScript files in core/', () => {
      expect(
        scanResult.files.length,
        'core/ directory must contain TypeScript files'
      ).toBeGreaterThan(0)
    })
  })

  describe('No @cloudflare/* Package Imports', () => {
    it('should not import from @cloudflare/* packages', () => {
      const violations = scanResult.violations.filter(
        (v) => v.category === 'import' && v.pattern === 'cloudflarePackages'
      )

      expect(violations, formatViolations(violations)).toHaveLength(0)
    })
  })

  describe('No cloudflare:* Module Imports', () => {
    it('should not import from cloudflare:* built-in modules', () => {
      const violations = scanResult.violations.filter(
        (v) => v.category === 'import' && v.pattern.startsWith('cloudflare')
      )

      expect(violations, formatViolations(violations)).toHaveLength(0)
    })
  })

  describe('No Durable Object Types', () => {
    it('should not use DurableObject type', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'durableObject'
      )

      expect(violations, formatViolations(violations)).toHaveLength(0)
    })

    it('should not use DurableObjectState type', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'durableObjectState'
      )

      expect(violations, formatViolations(violations)).toHaveLength(0)
    })

    it('should not use DurableObjectStub type', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'durableObjectStub'
      )

      expect(violations, formatViolations(violations)).toHaveLength(0)
    })

    it('should not use any Durable Object related types', () => {
      const doPatterns = [
        'durableObject',
        'durableObjectState',
        'durableObjectStub',
        'durableObjectId',
        'durableObjectNamespace',
        'durableObjectStorage',
        'durableObjectTransaction',
      ]

      const violations = scanResult.violations.filter((v) =>
        doPatterns.includes(v.pattern)
      )

      expect(violations, formatViolations(violations)).toHaveLength(0)
    })
  })

  describe('No R2 Storage Types', () => {
    it('should not use R2Bucket type', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'r2Bucket'
      )

      expect(violations, formatViolations(violations)).toHaveLength(0)
    })

    it('should not use any R2 related types', () => {
      const r2Patterns = [
        'r2Bucket',
        'r2Object',
        'r2ObjectBody',
        'r2Objects',
        'r2UploadedPart',
        'r2MultipartUpload',
      ]

      const violations = scanResult.violations.filter((v) =>
        r2Patterns.includes(v.pattern)
      )

      expect(violations, formatViolations(violations)).toHaveLength(0)
    })
  })

  describe('No KV Namespace Types', () => {
    it('should not use KVNamespace type', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'kvNamespace'
      )

      expect(violations, formatViolations(violations)).toHaveLength(0)
    })
  })

  describe('No D1 Database Types', () => {
    it('should not use D1Database type', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'd1Database'
      )

      expect(violations, formatViolations(violations)).toHaveLength(0)
    })

    it('should not use any D1 related types', () => {
      const d1Patterns = ['d1Database', 'd1Result', 'd1PreparedStatement']

      const violations = scanResult.violations.filter((v) =>
        d1Patterns.includes(v.pattern)
      )

      expect(violations, formatViolations(violations)).toHaveLength(0)
    })
  })

  describe('No Wrangler/Environment Bindings', () => {
    it('should not reference env.* bindings', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'envBinding'
      )

      expect(violations, formatViolations(violations)).toHaveLength(0)
    })

    it('should not have Worker-specific exports', () => {
      const workerPatterns = [
        'workerFetch',
        'workerScheduled',
        'workerQueue',
        'workerEmail',
      ]

      const violations = scanResult.violations.filter((v) =>
        workerPatterns.includes(v.pattern)
      )

      expect(violations, formatViolations(violations)).toHaveLength(0)
    })

    it('should not use ExecutionContext type', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'executionContext'
      )

      expect(violations, formatViolations(violations)).toHaveLength(0)
    })
  })

  describe('No Other CF-Specific Services', () => {
    it('should not use Workers AI types', () => {
      const violations = scanResult.violations.filter((v) => v.pattern === 'ai')

      expect(violations, formatViolations(violations)).toHaveLength(0)
    })

    it('should not use Vectorize types', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'vectorizeIndex'
      )

      expect(violations, formatViolations(violations)).toHaveLength(0)
    })

    it('should not use Hyperdrive types', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'hyperdrive'
      )

      expect(violations, formatViolations(violations)).toHaveLength(0)
    })

    it('should not use Analytics Engine types', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'analyticsEngine'
      )

      expect(violations, formatViolations(violations)).toHaveLength(0)
    })
  })

  describe('Summary', () => {
    it('should have ZERO total Cloudflare dependency violations', () => {
      const output = formatViolations(scanResult.violations)

      expect(
        scanResult.violations,
        `core/ must have zero Cloudflare dependencies.\n\n${output}`
      ).toHaveLength(0)
    })
  })
})

// ============================================================================
// Export utilities for use in other tests
// ============================================================================

export {
  collectTsFiles,
  scanFileForViolations,
  scanCoreDirectory,
  formatViolations,
  CF_IMPORT_PATTERNS,
  CF_TYPE_PATTERNS,
  WRANGLER_PATTERNS,
}

export type { Violation, ScanResult }
