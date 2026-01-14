/**
 * RED Phase Tests: Verify core/ directory has ZERO Cloudflare dependencies
 *
 * These tests scan all TypeScript files in src/core/ to ensure the core
 * git implementation is completely platform-agnostic with no Cloudflare
 * runtime dependencies.
 *
 * Tests should FAIL initially because:
 * 1. src/core/ directory doesn't exist yet
 * 2. Once created, code may need to be cleaned of CF dependencies
 *
 * The goal is to have a pure git implementation that can run anywhere:
 * - Node.js
 * - Deno
 * - Browsers
 * - Cloudflare Workers (via adapter layer, not direct deps)
 * - Any JavaScript runtime
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Forbidden import patterns - Cloudflare-specific
const FORBIDDEN_PATTERNS = {
  // Package imports from @cloudflare/*
  cloudflarePackages: {
    pattern: /from\s+['"]@cloudflare\//g,
    description: '@cloudflare/* package imports',
  },

  // cloudflare: protocol imports (e.g., cloudflare:workers, cloudflare:sockets)
  cloudflareProtocol: {
    pattern: /from\s+['"]cloudflare:/g,
    description: 'cloudflare:* protocol imports',
  },

  // Direct import of cloudflare:workers module
  cloudflareWorkersImport: {
    pattern: /import\s+.*\s+from\s+['"]cloudflare:workers['"]/g,
    description: 'cloudflare:workers import',
  },
}

// Forbidden type patterns - Cloudflare runtime types
const FORBIDDEN_TYPES = {
  // Durable Objects
  DurableObject: {
    pattern: /\bDurableObject\b/g,
    description: 'DurableObject class/interface',
  },
  DurableObjectState: {
    pattern: /\bDurableObjectState\b/g,
    description: 'DurableObjectState type',
  },
  DurableObjectStub: {
    pattern: /\bDurableObjectStub\b/g,
    description: 'DurableObjectStub type',
  },
  DurableObjectId: {
    pattern: /\bDurableObjectId\b/g,
    description: 'DurableObjectId type',
  },
  DurableObjectNamespace: {
    pattern: /\bDurableObjectNamespace\b/g,
    description: 'DurableObjectNamespace type',
  },
  DurableObjectStorage: {
    pattern: /\bDurableObjectStorage\b/g,
    description: 'DurableObjectStorage type',
  },

  // Storage bindings
  R2Bucket: {
    pattern: /\bR2Bucket\b/g,
    description: 'R2Bucket storage binding',
  },
  R2Object: {
    pattern: /\bR2Object\b/g,
    description: 'R2Object type',
  },
  R2ObjectBody: {
    pattern: /\bR2ObjectBody\b/g,
    description: 'R2ObjectBody type',
  },
  KVNamespace: {
    pattern: /\bKVNamespace\b/g,
    description: 'KVNamespace storage binding',
  },
  D1Database: {
    pattern: /\bD1Database\b/g,
    description: 'D1Database binding',
  },
  D1Result: {
    pattern: /\bD1Result\b/g,
    description: 'D1Result type',
  },

  // Queue bindings
  Queue: {
    pattern: /\bQueue<\b/g,
    description: 'Queue binding',
  },
  MessageBatch: {
    pattern: /\bMessageBatch\b/g,
    description: 'MessageBatch type',
  },

  // AI/Vectorize
  Ai: {
    pattern: /\bAi\b/g,
    description: 'AI binding',
  },
  Vectorize: {
    pattern: /\bVectorize\b/g,
    description: 'Vectorize binding',
  },
  VectorizeIndex: {
    pattern: /\bVectorizeIndex\b/g,
    description: 'VectorizeIndex type',
  },

  // Hyperdrive
  Hyperdrive: {
    pattern: /\bHyperdrive\b/g,
    description: 'Hyperdrive binding',
  },

  // Service bindings
  Fetcher: {
    pattern: /\bFetcher\b/g,
    description: 'Fetcher service binding',
  },
  ServiceBinding: {
    pattern: /\bServiceBinding\b/g,
    description: 'Service binding type',
  },
}

// Forbidden wrangler/env patterns
const FORBIDDEN_ENV_PATTERNS = {
  // Env type with bindings
  envBindings: {
    pattern: /\bEnv\s*{[^}]*(?:R2|KV|D1|DO|Queue|AI|Vectorize)/gs,
    description: 'Env type with CF bindings',
  },

  // ctx.waitUntil (execution context)
  waitUntil: {
    pattern: /\bctx\.waitUntil\b/g,
    description: 'ctx.waitUntil (ExecutionContext)',
  },

  // env parameter pattern common in Workers
  envParam: {
    pattern: /\benv\s*:\s*Env\b/g,
    description: 'env: Env parameter (Workers pattern)',
  },

  // ExecutionContext
  ExecutionContext: {
    pattern: /\bExecutionContext\b/g,
    description: 'ExecutionContext type',
  },

  // wrangler-specific
  wranglerImport: {
    pattern: /from\s+['"]wrangler/g,
    description: 'wrangler import',
  },
}

interface Violation {
  file: string
  line: number
  column: number
  pattern: string
  description: string
  matchedText: string
}

interface ScanResult {
  violations: Violation[]
  filesScanned: number
  directoryExists: boolean
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
      files.push(...findTsFiles(fullPath))
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      files.push(fullPath)
    }
  }

  return files
}

/**
 * Get line and column number from string index
 */
function getLineAndColumn(
  content: string,
  index: number
): { line: number; column: number } {
  const lines = content.substring(0, index).split('\n')
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  }
}

/**
 * Scan a file for forbidden patterns
 */
function scanFile(
  filePath: string,
  patterns: Record<string, { pattern: RegExp; description: string }>
): Violation[] {
  const violations: Violation[] = []
  const content = fs.readFileSync(filePath, 'utf-8')
  const relativePath = path.relative(process.cwd(), filePath)

  for (const [name, { pattern, description }] of Object.entries(patterns)) {
    // Reset regex state
    const regex = new RegExp(pattern.source, pattern.flags)
    let match

    while ((match = regex.exec(content)) !== null) {
      const { line, column } = getLineAndColumn(content, match.index)

      // Skip if in a comment (basic heuristic)
      const lineStart = content.lastIndexOf('\n', match.index) + 1
      const lineEnd = content.indexOf('\n', match.index)
      const lineContent = content.substring(
        lineStart,
        lineEnd === -1 ? undefined : lineEnd
      )

      // Skip single-line comments
      const commentIndex = lineContent.indexOf('//')
      if (commentIndex !== -1 && match.index - lineStart > commentIndex) {
        continue
      }

      violations.push({
        file: relativePath,
        line,
        column,
        pattern: name,
        description,
        matchedText: match[0].substring(0, 50), // Truncate long matches
      })
    }
  }

  return violations
}

/**
 * Scan entire directory for CF dependencies
 */
function scanDirectory(coreDir: string): ScanResult {
  const violations: Violation[] = []

  if (!fs.existsSync(coreDir)) {
    return {
      violations: [],
      filesScanned: 0,
      directoryExists: false,
    }
  }

  const files = findTsFiles(coreDir)

  for (const file of files) {
    violations.push(...scanFile(file, FORBIDDEN_PATTERNS))
    violations.push(...scanFile(file, FORBIDDEN_TYPES))
    violations.push(...scanFile(file, FORBIDDEN_ENV_PATTERNS))
  }

  return {
    violations,
    filesScanned: files.length,
    directoryExists: true,
  }
}

/**
 * Format violations for readable test output
 */
function formatViolations(violations: Violation[]): string {
  if (violations.length === 0) return 'No violations found'

  const grouped = violations.reduce(
    (acc, v) => {
      if (!acc[v.file]) acc[v.file] = []
      acc[v.file].push(v)
      return acc
    },
    {} as Record<string, Violation[]>
  )

  const lines: string[] = [
    '',
    `Found ${violations.length} Cloudflare dependency violation(s):`,
    '',
  ]

  for (const [file, fileViolations] of Object.entries(grouped)) {
    lines.push(`  ${file}:`)
    for (const v of fileViolations) {
      lines.push(`    Line ${v.line}:${v.column} - ${v.description}`)
      lines.push(`      Pattern: ${v.pattern}`)
      lines.push(`      Match: "${v.matchedText}"`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

// Resolve the core directory path
const CORE_DIR = path.resolve(__dirname, '../../src/core')

describe('Core Directory: Zero Cloudflare Dependencies', () => {
  let scanResult: ScanResult

  beforeAll(() => {
    scanResult = scanDirectory(CORE_DIR)
  })

  describe('Directory Structure', () => {
    it('should have src/core/ directory', () => {
      expect(
        scanResult.directoryExists,
        `src/core/ directory does not exist at ${CORE_DIR}. ` +
          'Create the core directory with platform-agnostic git implementation.'
      ).toBe(true)
    })

    it('should contain TypeScript files', () => {
      expect(
        scanResult.filesScanned,
        'src/core/ should contain TypeScript files with the git implementation'
      ).toBeGreaterThan(0)
    })
  })

  describe('No @cloudflare/* Package Imports', () => {
    it('should not import from @cloudflare/workers-types', () => {
      const violations = scanResult.violations.filter((v) =>
        v.matchedText.includes('@cloudflare/')
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })

    it('should not import from cloudflare:* protocol', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'cloudflareProtocol'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })
  })

  describe('No Durable Object Types', () => {
    it('should not use DurableObject class', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'DurableObject'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })

    it('should not use DurableObjectState', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'DurableObjectState'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })

    it('should not use DurableObjectStub', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'DurableObjectStub'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })

    it('should not use DurableObjectId', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'DurableObjectId'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })

    it('should not use DurableObjectNamespace', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'DurableObjectNamespace'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })

    it('should not use DurableObjectStorage', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'DurableObjectStorage'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })
  })

  describe('No Storage Binding Types', () => {
    it('should not use R2Bucket', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'R2Bucket'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })

    it('should not use R2Object', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'R2Object'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })

    it('should not use R2ObjectBody', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'R2ObjectBody'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })

    it('should not use KVNamespace', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'KVNamespace'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })

    it('should not use D1Database', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'D1Database'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })

    it('should not use D1Result', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'D1Result'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })
  })

  describe('No Queue/Messaging Types', () => {
    it('should not use Queue binding', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'Queue'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })

    it('should not use MessageBatch', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'MessageBatch'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })
  })

  describe('No AI/Vectorize Types', () => {
    it('should not use Ai binding', () => {
      const violations = scanResult.violations.filter((v) => v.pattern === 'Ai')
      expect(violations.length, formatViolations(violations)).toBe(0)
    })

    it('should not use Vectorize binding', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'Vectorize'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })

    it('should not use VectorizeIndex', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'VectorizeIndex'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })
  })

  describe('No Hyperdrive Types', () => {
    it('should not use Hyperdrive binding', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'Hyperdrive'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })
  })

  describe('No Service Binding Types', () => {
    it('should not use Fetcher type', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'Fetcher'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })

    it('should not use ServiceBinding type', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'ServiceBinding'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })
  })

  describe('No Workers Environment Patterns', () => {
    it('should not use ctx.waitUntil', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'waitUntil'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })

    it('should not use ExecutionContext', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'ExecutionContext'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })

    it('should not use Env with CF bindings', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'envBindings'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })

    it('should not import from wrangler', () => {
      const violations = scanResult.violations.filter(
        (v) => v.pattern === 'wranglerImport'
      )
      expect(violations.length, formatViolations(violations)).toBe(0)
    })
  })

  describe('Summary', () => {
    it('should have zero total Cloudflare dependency violations', () => {
      expect(
        scanResult.violations.length,
        formatViolations(scanResult.violations)
      ).toBe(0)
    })
  })
})

describe('Core Directory: Expected Contents', () => {
  /**
   * These tests define the expected structure of the core/ directory.
   * They help guide the GREEN phase implementation.
   */

  it('should contain git object implementation', () => {
    const objectsPath = path.join(CORE_DIR, 'objects')
    const indexPath = path.join(CORE_DIR, 'objects.ts')
    const hasObjects = fs.existsSync(objectsPath) || fs.existsSync(indexPath)

    expect(
      hasObjects,
      'src/core/ should contain objects.ts or objects/ directory for git object types (blob, tree, commit, tag)'
    ).toBe(true)
  })

  it('should contain refs implementation', () => {
    const refsPath = path.join(CORE_DIR, 'refs')
    const indexPath = path.join(CORE_DIR, 'refs.ts')
    const hasRefs = fs.existsSync(refsPath) || fs.existsSync(indexPath)

    expect(
      hasRefs,
      'src/core/ should contain refs.ts or refs/ directory for reference management'
    ).toBe(true)
  })

  it('should contain pack format implementation', () => {
    const packPath = path.join(CORE_DIR, 'pack')
    const indexPath = path.join(CORE_DIR, 'pack.ts')
    const hasPack = fs.existsSync(packPath) || fs.existsSync(indexPath)

    expect(
      hasPack,
      'src/core/ should contain pack.ts or pack/ directory for packfile format'
    ).toBe(true)
  })

  it('should contain storage abstraction interface', () => {
    const storagePath = path.join(CORE_DIR, 'storage.ts')
    const interfacesPath = path.join(CORE_DIR, 'interfaces.ts')
    const typesPath = path.join(CORE_DIR, 'types.ts')
    const hasStorage =
      fs.existsSync(storagePath) ||
      fs.existsSync(interfacesPath) ||
      fs.existsSync(typesPath)

    expect(
      hasStorage,
      'src/core/ should define storage abstraction interface (not CF-specific implementation)'
    ).toBe(true)
  })
})
