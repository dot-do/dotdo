/**
 * Core Zero Cloudflare Dependencies Tests
 *
 * Verifies that @dotdo/bashx core has zero Cloudflare-specific dependencies.
 * The core package must be platform-agnostic and runnable in any JavaScript environment.
 *
 * These tests ensure architectural integrity by detecting any CF-specific imports
 * that would couple the core library to the Cloudflare Workers platform.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const CORE_DIR = path.resolve(__dirname, '../../core')

// Cloudflare-specific patterns that should NOT appear in core
const CF_IMPORT_PATTERNS = [
  // Package imports
  /from\s+['"]@cloudflare\//,
  /from\s+['"]cloudflare:/,
  /from\s+['"]wrangler/,
  /import\s+.*['"]@cloudflare\//,
  /import\s+.*['"]cloudflare:/,
  /import\s+.*['"]wrangler/,
  /require\s*\(\s*['"]@cloudflare\//,
  /require\s*\(\s*['"]cloudflare:/,
  /require\s*\(\s*['"]wrangler/,
]

// Cloudflare-specific type references that should NOT appear in core
const CF_TYPE_PATTERNS = [
  /DurableObject\b/,
  /DurableObjectStub\b/,
  /DurableObjectNamespace\b/,
  /DurableObjectId\b/,
  /DurableObjectState\b/,
  /DurableObjectStorage\b/,
  /DurableObjectTransaction\b/,
  /WorkerEntrypoint\b/,
  /Fetcher\b/,
  /KVNamespace\b/,
  /R2Bucket\b/,
  /R2Object\b/,
  /D1Database\b/,
  /D1PreparedStatement\b/,
  /D1Result\b/,
  /Queue\b.*Message/,
  /AnalyticsEngine\b/,
  /Vectorize\b/,
  /Hyperdrive\b/,
  /ExecutionContext\b/,
  /ScheduledController\b/,
  /MessageBatch\b/,
  /WebSocket.*Pair/,
]

// Cloudflare-specific dependency names
const CF_DEPENDENCY_NAMES = [
  '@cloudflare/workers-types',
  '@cloudflare/vitest-pool-workers',
  '@cloudflare/kv-asset-handler',
  '@cloudflare/ai',
  '@cloudflare/d1',
  'wrangler',
  'miniflare',
]

/**
 * Recursively find all TypeScript files in a directory
 */
function findTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return []
  }

  const files: string[] = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      files.push(...findTsFiles(fullPath))
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }

  return files
}

/**
 * Scan file content for pattern matches
 */
function scanFileForPatterns(
  filePath: string,
  patterns: RegExp[]
): { pattern: RegExp; line: number; content: string }[] {
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const matches: { pattern: RegExp; line: number; content: string }[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        matches.push({
          pattern,
          line: i + 1,
          content: line.trim(),
        })
      }
    }
  }

  return matches
}

describe('Core Zero Cloudflare Dependencies', () => {
  let coreExists: boolean
  let coreFiles: string[]

  beforeAll(() => {
    coreExists = fs.existsSync(CORE_DIR)
    coreFiles = coreExists ? findTsFiles(CORE_DIR) : []
  })

  describe('Core Directory Structure', () => {
    it('should have core/ directory', () => {
      expect(coreExists).toBe(true)
    })

    it('should have TypeScript files in core/', () => {
      expect(coreFiles.length).toBeGreaterThan(0)
    })

    it('should have core/index.ts as main entry point', () => {
      const indexPath = path.join(CORE_DIR, 'index.ts')
      expect(fs.existsSync(indexPath)).toBe(true)
    })
  })

  describe('Import Scanning', () => {
    it('should have no @cloudflare imports in core files', () => {
      const violations: { file: string; line: number; content: string }[] = []

      for (const file of coreFiles) {
        const matches = scanFileForPatterns(file, CF_IMPORT_PATTERNS)
        for (const match of matches) {
          violations.push({
            file: path.relative(CORE_DIR, file),
            line: match.line,
            content: match.content,
          })
        }
      }

      if (violations.length > 0) {
        const message = violations
          .map((v) => `  ${v.file}:${v.line}: ${v.content}`)
          .join('\n')
        expect.fail(
          `Found ${violations.length} Cloudflare import(s) in core:\n${message}`
        )
      }

      expect(violations).toHaveLength(0)
    })

    it('should not import from cloudflare: namespace', () => {
      const cfNamespacePattern = /from\s+['"]cloudflare:/

      for (const file of coreFiles) {
        const content = fs.readFileSync(file, 'utf-8')
        const hasMatch = cfNamespacePattern.test(content)
        if (hasMatch) {
          expect.fail(
            `File ${path.relative(CORE_DIR, file)} imports from cloudflare: namespace`
          )
        }
      }
    })

    it('should not import wrangler utilities', () => {
      const wranglerPattern = /['"]wrangler/

      for (const file of coreFiles) {
        const content = fs.readFileSync(file, 'utf-8')
        const hasMatch = wranglerPattern.test(content)
        if (hasMatch) {
          expect.fail(
            `File ${path.relative(CORE_DIR, file)} imports wrangler`
          )
        }
      }
    })
  })

  describe('Type References', () => {
    it('should have no DurableObject type references in core', () => {
      const violations: { file: string; line: number; content: string }[] = []

      for (const file of coreFiles) {
        const matches = scanFileForPatterns(file, CF_TYPE_PATTERNS)
        for (const match of matches) {
          violations.push({
            file: path.relative(CORE_DIR, file),
            line: match.line,
            content: match.content,
          })
        }
      }

      if (violations.length > 0) {
        const message = violations
          .map((v) => `  ${v.file}:${v.line}: ${v.content}`)
          .join('\n')
        expect.fail(
          `Found ${violations.length} CF type reference(s) in core:\n${message}`
        )
      }

      expect(violations).toHaveLength(0)
    })

    it('should not reference DurableObjectStub', () => {
      const pattern = /DurableObjectStub/

      for (const file of coreFiles) {
        const content = fs.readFileSync(file, 'utf-8')
        expect(pattern.test(content)).toBe(false)
      }
    })

    it('should not reference DurableObjectNamespace', () => {
      const pattern = /DurableObjectNamespace/

      for (const file of coreFiles) {
        const content = fs.readFileSync(file, 'utf-8')
        expect(pattern.test(content)).toBe(false)
      }
    })

    it('should not reference KVNamespace', () => {
      const pattern = /KVNamespace/

      for (const file of coreFiles) {
        const content = fs.readFileSync(file, 'utf-8')
        expect(pattern.test(content)).toBe(false)
      }
    })

    it('should not reference R2Bucket', () => {
      const pattern = /R2Bucket/

      for (const file of coreFiles) {
        const content = fs.readFileSync(file, 'utf-8')
        expect(pattern.test(content)).toBe(false)
      }
    })

    it('should not reference D1Database', () => {
      const pattern = /D1Database/

      for (const file of coreFiles) {
        const content = fs.readFileSync(file, 'utf-8')
        expect(pattern.test(content)).toBe(false)
      }
    })
  })

  describe('Package.json Dependencies', () => {
    const packageJsonPath = path.join(CORE_DIR, 'package.json')

    it('should have core/package.json', () => {
      expect(fs.existsSync(packageJsonPath)).toBe(true)
    })

    it('should have no @cloudflare dependencies', () => {
      if (!fs.existsSync(packageJsonPath)) {
        expect.fail('core/package.json does not exist')
        return
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.peerDependencies,
      }

      const cfDeps = Object.keys(allDeps).filter(
        (dep) =>
          dep.startsWith('@cloudflare/') ||
          CF_DEPENDENCY_NAMES.includes(dep)
      )

      if (cfDeps.length > 0) {
        expect.fail(
          `Found Cloudflare dependencies in core/package.json: ${cfDeps.join(', ')}`
        )
      }

      expect(cfDeps).toHaveLength(0)
    })

    it('should have no wrangler in dependencies', () => {
      if (!fs.existsSync(packageJsonPath)) {
        expect.fail('core/package.json does not exist')
        return
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.peerDependencies,
      }

      expect(allDeps['wrangler']).toBeUndefined()
    })

    it('should have no miniflare in dependencies', () => {
      if (!fs.existsSync(packageJsonPath)) {
        expect.fail('core/package.json does not exist')
        return
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.peerDependencies,
      }

      expect(allDeps['miniflare']).toBeUndefined()
    })
  })

  describe('Core Export Integrity', () => {
    it('should export platform-agnostic types only', () => {
      const indexPath = path.join(CORE_DIR, 'index.ts')
      if (!fs.existsSync(indexPath)) {
        expect.fail('core/index.ts does not exist')
        return
      }

      const content = fs.readFileSync(indexPath, 'utf-8')
      const cfPatterns = [...CF_IMPORT_PATTERNS, ...CF_TYPE_PATTERNS]
      const matches = cfPatterns.filter((p) => p.test(content))

      if (matches.length > 0) {
        expect.fail(
          `core/index.ts contains CF-specific patterns: ${matches.map((p) => p.source).join(', ')}`
        )
      }

      expect(matches).toHaveLength(0)
    })

    it('should not re-export Durable Object types', () => {
      const indexPath = path.join(CORE_DIR, 'index.ts')
      if (!fs.existsSync(indexPath)) {
        expect.fail('core/index.ts does not exist')
        return
      }

      const content = fs.readFileSync(indexPath, 'utf-8')

      // Check for DO-related exports
      const doExportPatterns = [
        /export.*DurableObject/,
        /export.*\bDO\b/,
        /export.*Worker.*Entrypoint/,
      ]

      for (const pattern of doExportPatterns) {
        expect(pattern.test(content)).toBe(false)
      }
    })
  })

  describe('Backend Interface Abstraction', () => {
    it('should have ShellBackend interface in core', () => {
      // Core should define abstract ShellBackend interface
      // CF-specific implementations should live outside core
      const backendPath = path.join(CORE_DIR, 'backend.ts')
      expect(fs.existsSync(backendPath)).toBe(true)
    })

    it('should not have CF-specific backend implementations in core', () => {
      // Implementations like DurableObjectBackend should be in src/do/
      const doBackendInCore = coreFiles.some((f) =>
        /durable.*object.*backend/i.test(f)
      )
      expect(doBackendInCore).toBe(false)
    })
  })

  describe('Runtime Compatibility', () => {
    it('should only use standard web APIs in core', () => {
      // Core should work in any JavaScript runtime
      // Check for CF-specific globals
      const cfGlobals = [
        /\benv\./,  // Workers env binding
        /\bctx\./,  // Workers context
        /\bwaitUntil\b/,  // Workers lifecycle
        /\bpassThroughOnException\b/,  // Workers error handling
      ]

      for (const file of coreFiles) {
        // Skip type definition files
        if (file.endsWith('.d.ts')) continue

        const content = fs.readFileSync(file, 'utf-8')
        const matches = cfGlobals.filter((p) => p.test(content))

        // env. and ctx. could be legitimate variable names
        // Only flag if combined with Workers-specific patterns
        const hasWorkersPatterns =
          content.includes('DurableObject') ||
          content.includes('ExecutionContext') ||
          content.includes('export default {')

        if (hasWorkersPatterns && matches.length > 0) {
          expect.fail(
            `File ${path.relative(CORE_DIR, file)} uses Workers-specific patterns`
          )
        }
      }
    })
  })
})
