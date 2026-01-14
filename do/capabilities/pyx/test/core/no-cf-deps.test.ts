import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Tests to verify core/ directory has ZERO Cloudflare dependencies.
 *
 * These tests ensure the core module remains platform-agnostic and can
 * run in any JavaScript environment (Node.js, Deno, Bun, browsers, etc.)
 * without Cloudflare Workers-specific APIs.
 */

interface Violation {
  file: string
  line: number
  content: string
  type: string
}

// Patterns that indicate Cloudflare dependencies
const CF_PATTERNS = {
  // Package imports
  cloudflarePackageImport: /(?:import|from)\s+['"]@cloudflare\//,
  cloudflareModuleImport: /(?:import|from)\s+['"]cloudflare:/,

  // Durable Object types
  durableObjectType: /\bDurableObject\b/,
  durableObjectState: /\bDurableObjectState\b/,
  durableObjectStub: /\bDurableObjectStub\b/,
  durableObjectId: /\bDurableObjectId\b/,
  durableObjectNamespace: /\bDurableObjectNamespace\b/,

  // Storage types
  r2Bucket: /\bR2Bucket\b/,
  r2Object: /\bR2Object\b/,
  kvNamespace: /\bKVNamespace\b/,
  d1Database: /\bD1Database\b/,
  d1Result: /\bD1Result\b/,

  // Other CF-specific types
  executionContext: /\bExecutionContext\b/,
  scheduledEvent: /\bScheduledEvent\b/,
  queueMessage: /\bQueueMessage\b/,
  analyticsEngineDataset: /\bAnalyticsEngineDataset\b/,
  vectorizeIndex: /\bVectorizeIndex\b/,

  // Wrangler/env bindings patterns
  envBinding: /env\.(KV|R2|D1|DO|QUEUE|AI|VECTORIZE|ANALYTICS)/,
  wranglerToml: /wrangler\.toml/,
}

/**
 * Recursively find all TypeScript files in a directory
 */
function findTsFiles(dir: string): string[] {
  const files: string[] = []

  if (!fs.existsSync(dir)) {
    return files
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      // Skip node_modules and hidden directories
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
        files.push(...findTsFiles(fullPath))
      }
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(fullPath)
    }
  }

  return files
}

/**
 * Scan a file for Cloudflare dependency violations
 */
function scanFile(filePath: string): Violation[] {
  const violations: Violation[] = []
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    for (const [patternName, pattern] of Object.entries(CF_PATTERNS)) {
      if (pattern.test(line)) {
        violations.push({
          file: filePath,
          line: lineNum,
          content: line.trim(),
          type: patternName,
        })
      }
    }
  }

  return violations
}

/**
 * Format violations for readable error output
 */
function formatViolations(violations: Violation[]): string {
  if (violations.length === 0) return ''

  const grouped = violations.reduce((acc, v) => {
    const key = v.file
    if (!acc[key]) acc[key] = []
    acc[key].push(v)
    return acc
  }, {} as Record<string, Violation[]>)

  const lines: string[] = [
    '',
    '=== Cloudflare Dependency Violations Found ===',
    '',
  ]

  for (const [file, fileViolations] of Object.entries(grouped)) {
    lines.push(`File: ${file}`)
    for (const v of fileViolations) {
      lines.push(`  Line ${v.line} [${v.type}]: ${v.content}`)
    }
    lines.push('')
  }

  lines.push(`Total: ${violations.length} violation(s)`)

  return lines.join('\n')
}

describe('core/ zero Cloudflare dependencies', () => {
  const coreDir = path.resolve(__dirname, '../../core')
  let coreFiles: string[] = []

  beforeAll(() => {
    coreFiles = findTsFiles(coreDir)
  })

  it('should have a core/ directory', () => {
    expect(
      fs.existsSync(coreDir),
      `Expected core/ directory to exist at ${coreDir}`
    ).toBe(true)
  })

  it('should have TypeScript files in core/', () => {
    expect(
      coreFiles.length,
      'Expected at least one .ts file in core/ directory'
    ).toBeGreaterThan(0)
  })

  it('should not import from @cloudflare/* packages', () => {
    const violations = coreFiles.flatMap(scanFile)
      .filter(v => v.type === 'cloudflarePackageImport')

    expect(
      violations.length,
      formatViolations(violations)
    ).toBe(0)
  })

  it('should not import from cloudflare:* modules', () => {
    const violations = coreFiles.flatMap(scanFile)
      .filter(v => v.type === 'cloudflareModuleImport')

    expect(
      violations.length,
      formatViolations(violations)
    ).toBe(0)
  })

  it('should not use DurableObject types', () => {
    const durableObjectPatterns = [
      'durableObjectType',
      'durableObjectState',
      'durableObjectStub',
      'durableObjectId',
      'durableObjectNamespace',
    ]

    const violations = coreFiles.flatMap(scanFile)
      .filter(v => durableObjectPatterns.includes(v.type))

    expect(
      violations.length,
      formatViolations(violations)
    ).toBe(0)
  })

  it('should not use R2Bucket types', () => {
    const violations = coreFiles.flatMap(scanFile)
      .filter(v => v.type === 'r2Bucket' || v.type === 'r2Object')

    expect(
      violations.length,
      formatViolations(violations)
    ).toBe(0)
  })

  it('should not use KVNamespace types', () => {
    const violations = coreFiles.flatMap(scanFile)
      .filter(v => v.type === 'kvNamespace')

    expect(
      violations.length,
      formatViolations(violations)
    ).toBe(0)
  })

  it('should not use D1Database types', () => {
    const violations = coreFiles.flatMap(scanFile)
      .filter(v => v.type === 'd1Database' || v.type === 'd1Result')

    expect(
      violations.length,
      formatViolations(violations)
    ).toBe(0)
  })

  it('should not use other CF-specific types (ExecutionContext, ScheduledEvent, etc.)', () => {
    const cfSpecificPatterns = [
      'executionContext',
      'scheduledEvent',
      'queueMessage',
      'analyticsEngineDataset',
      'vectorizeIndex',
    ]

    const violations = coreFiles.flatMap(scanFile)
      .filter(v => cfSpecificPatterns.includes(v.type))

    expect(
      violations.length,
      formatViolations(violations)
    ).toBe(0)
  })

  it('should not use env bindings or wrangler-specific code', () => {
    const envPatterns = ['envBinding', 'wranglerToml']

    const violations = coreFiles.flatMap(scanFile)
      .filter(v => envPatterns.includes(v.type))

    expect(
      violations.length,
      formatViolations(violations)
    ).toBe(0)
  })

  it('should report all violations with file paths and line numbers', () => {
    const allViolations = coreFiles.flatMap(scanFile)

    expect(
      allViolations.length,
      formatViolations(allViolations)
    ).toBe(0)
  })
})
