/**
 * No Cloudflare Dependencies Tests
 *
 * RED phase tests to verify the core/ directory has zero Cloudflare dependencies.
 * These tests scan actual file contents to ensure the core package remains
 * runtime-agnostic and can be used in Node.js, browsers, and other environments.
 *
 * The core package (@dotdo/fsx) should:
 * 1. Have NO imports from '@cloudflare/*', 'cloudflare:*', or 'wrangler'
 * 2. Have NO imports from service layers (../storage/, ../do/)
 * 3. Have NO Cloudflare dependencies in its package.json
 *
 * Run with: npx vitest run test/core/no-cf-deps.test.ts --config test/core/vitest.config.ts
 *
 * @see Architecture: core/ is pure logic, storage/ has CF backends, do/ has DO bindings
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// =============================================================================
// Test Configuration
// =============================================================================

// Get the directory of this test file
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Navigate from test/core/ to project root
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const CORE_DIR = path.join(PROJECT_ROOT, 'core')
const CORE_PACKAGE_JSON = path.join(CORE_DIR, 'package.json')

// Patterns that indicate Cloudflare dependencies
const CLOUDFLARE_IMPORT_PATTERNS = [
  // Direct Cloudflare packages
  /@cloudflare\//,
  /from\s+['"]cloudflare:/,
  /import\s+['"]cloudflare:/,
  // Wrangler
  /from\s+['"]wrangler['"]/,
  /import\s+['"]wrangler['"]/,
  // Cloudflare Workers types (should only be in devDependencies of root, not core)
  /@cloudflare\/workers-types/,
]

// Service layer imports that core should NOT have
const SERVICE_LAYER_PATTERNS = [
  // Storage backends (Cloudflare-specific implementations)
  /from\s+['"][^'"]*\.\.\/storage/,
  /import\s+['"][^'"]*\.\.\/storage/,
  // Durable Object bindings
  /from\s+['"][^'"]*\.\.\/do\//,
  /import\s+['"][^'"]*\.\.\/do\//,
  /from\s+['"][^'"]*\.\.\/durable-object\//,
  /import\s+['"][^'"]*\.\.\/durable-object\//,
]

// Cloudflare-specific package names in package.json
const CLOUDFLARE_PACKAGE_NAMES = [
  '@cloudflare/workers-types',
  '@cloudflare/vitest-pool-workers',
  '@cloudflare/kv-asset-handler',
  'wrangler',
  'miniflare',
]

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Recursively get all TypeScript files in a directory
 */
function getTypeScriptFiles(dir: string): string[] {
  const files: string[] = []

  if (!fs.existsSync(dir)) {
    return files
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      // Skip node_modules and dist
      if (entry.name !== 'node_modules' && entry.name !== 'dist') {
        files.push(...getTypeScriptFiles(fullPath))
      }
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      // Skip .d.ts files as they may have type-only imports
      if (!entry.name.endsWith('.d.ts')) {
        files.push(fullPath)
      }
    }
  }

  return files
}

/**
 * Check if file content contains any of the given patterns
 */
function containsPatterns(content: string, patterns: RegExp[]): { matches: boolean; pattern?: RegExp; match?: string } {
  for (const pattern of patterns) {
    const match = content.match(pattern)
    if (match) {
      return { matches: true, pattern, match: match[0] }
    }
  }
  return { matches: false }
}

// =============================================================================
// Test 1: Core TypeScript files have no Cloudflare imports
// =============================================================================

describe('Core TypeScript files have no Cloudflare imports', () => {
  let coreFiles: string[]

  beforeAll(() => {
    coreFiles = getTypeScriptFiles(CORE_DIR)
  })

  it('should find TypeScript files in core/ directory', () => {
    // This test will fail if core/ doesn't exist or has no .ts files
    expect(coreFiles.length).toBeGreaterThan(0)
  })

  it('should have no imports from @cloudflare/* packages', () => {
    const violations: { file: string; match: string }[] = []

    for (const file of coreFiles) {
      const content = fs.readFileSync(file, 'utf-8')
      const result = containsPatterns(content, CLOUDFLARE_IMPORT_PATTERNS)

      if (result.matches) {
        violations.push({
          file: path.relative(CORE_DIR, file),
          match: result.match!,
        })
      }
    }

    // Provide detailed error message showing all violations
    if (violations.length > 0) {
      const details = violations
        .map((v) => `  - ${v.file}: found "${v.match}"`)
        .join('\n')
      expect.fail(
        `Found ${violations.length} Cloudflare imports in core/:\n${details}\n\n` +
        'The core/ directory must have zero Cloudflare dependencies to remain runtime-agnostic.'
      )
    }

    expect(violations).toHaveLength(0)
  })

  it('should have no imports from cloudflare:* modules', () => {
    const cloudflareModulePattern = /cloudflare:/

    const violations: { file: string; line: string }[] = []

    for (const file of coreFiles) {
      const content = fs.readFileSync(file, 'utf-8')
      const lines = content.split('\n')

      for (let i = 0; i < lines.length; i++) {
        if (cloudflareModulePattern.test(lines[i])) {
          violations.push({
            file: path.relative(CORE_DIR, file),
            line: `Line ${i + 1}: ${lines[i].trim()}`,
          })
        }
      }
    }

    if (violations.length > 0) {
      const details = violations
        .map((v) => `  - ${v.file}\n    ${v.line}`)
        .join('\n')
      expect.fail(
        `Found ${violations.length} cloudflare:* module imports in core/:\n${details}`
      )
    }

    expect(violations).toHaveLength(0)
  })

  it('should have no imports from wrangler', () => {
    const wranglerPattern = /['"]wrangler['"]/

    const violations: string[] = []

    for (const file of coreFiles) {
      const content = fs.readFileSync(file, 'utf-8')

      if (wranglerPattern.test(content)) {
        violations.push(path.relative(CORE_DIR, file))
      }
    }

    if (violations.length > 0) {
      expect.fail(
        `Found wrangler imports in core/ files:\n${violations.map((f) => `  - ${f}`).join('\n')}`
      )
    }

    expect(violations).toHaveLength(0)
  })
})

// =============================================================================
// Test 2: Core TypeScript files have no service layer imports
// =============================================================================

describe('Core TypeScript files have no service layer imports', () => {
  let coreFiles: string[]

  beforeAll(() => {
    coreFiles = getTypeScriptFiles(CORE_DIR)
  })

  it('should have no imports from ../storage/ directory', () => {
    const storagePattern = /from\s+['"][^'"]*\.\.\/storage/

    const violations: { file: string; match: string }[] = []

    for (const file of coreFiles) {
      const content = fs.readFileSync(file, 'utf-8')
      const match = content.match(storagePattern)

      if (match) {
        violations.push({
          file: path.relative(CORE_DIR, file),
          match: match[0],
        })
      }
    }

    if (violations.length > 0) {
      const details = violations
        .map((v) => `  - ${v.file}: found "${v.match}"`)
        .join('\n')
      expect.fail(
        `Found ${violations.length} storage layer imports in core/:\n${details}\n\n` +
        'core/ should not import from storage/ - storage backends implement the FsBackend interface.'
      )
    }

    expect(violations).toHaveLength(0)
  })

  it('should have no imports from ../do/ or ../durable-object/ directory', () => {
    const doPattern = /from\s+['"][^'"]*\.\.\/(do|durable-object)/

    const violations: { file: string; match: string }[] = []

    for (const file of coreFiles) {
      const content = fs.readFileSync(file, 'utf-8')
      const match = content.match(doPattern)

      if (match) {
        violations.push({
          file: path.relative(CORE_DIR, file),
          match: match[0],
        })
      }
    }

    if (violations.length > 0) {
      const details = violations
        .map((v) => `  - ${v.file}: found "${v.match}"`)
        .join('\n')
      expect.fail(
        `Found ${violations.length} DO layer imports in core/:\n${details}\n\n` +
        'core/ should not import from do/ - DO bindings are in a separate layer.'
      )
    }

    expect(violations).toHaveLength(0)
  })

  it('should only have internal imports within core/ or from node: modules', () => {
    // Match any import statement
    const importPattern = /from\s+['"]([^'"]+)['"]/g

    const allowedPrefixes = [
      './', // Relative within core
      '../', // Parent within core (e.g., from core/glob to core/)
      'node:', // Node.js built-ins
      'vitest', // Test framework (allowed in .test.ts files)
    ]

    const violations: { file: string; import: string }[] = []

    for (const file of coreFiles) {
      const content = fs.readFileSync(file, 'utf-8')
      let match

      while ((match = importPattern.exec(content)) !== null) {
        const importPath = match[1]

        // Skip if it's an allowed import
        const isAllowed = allowedPrefixes.some((prefix) => importPath.startsWith(prefix))

        // Skip vitest imports in test files
        const isTestFile = file.endsWith('.test.ts')
        const isVitestImport = importPath === 'vitest' || importPath.startsWith('vitest/')

        if (!isAllowed && !(isTestFile && isVitestImport)) {
          // Check if it's trying to escape core/
          if (importPath.includes('../') && !importPath.startsWith('./') && !importPath.startsWith('../')) {
            continue // Skip malformed paths
          }

          // Count how many '../' segments there are
          const parentSegments = (importPath.match(/\.\.\//g) || []).length
          const fileName = path.relative(CORE_DIR, file)
          const depth = fileName.split('/').length - 1

          // If trying to go above core/, it's a violation
          if (parentSegments > depth) {
            violations.push({
              file: path.relative(CORE_DIR, file),
              import: importPath,
            })
          }
        }
      }
    }

    // This test documents the expectation but may need refinement
    // based on the actual import patterns in the codebase
    expect(violations.length).toBe(0)
  })
})

// =============================================================================
// Test 3: Core package.json has no Cloudflare dependencies
// =============================================================================

describe('Core package.json has no Cloudflare dependencies', () => {
  let packageJson: {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
  }

  beforeAll(() => {
    if (fs.existsSync(CORE_PACKAGE_JSON)) {
      const content = fs.readFileSync(CORE_PACKAGE_JSON, 'utf-8')
      packageJson = JSON.parse(content)
    } else {
      packageJson = {}
    }
  })

  it('should have a package.json in core/ directory', () => {
    expect(fs.existsSync(CORE_PACKAGE_JSON)).toBe(true)
  })

  it('should have no Cloudflare packages in dependencies', () => {
    const deps = packageJson.dependencies || {}
    const cfDeps = Object.keys(deps).filter((name) =>
      CLOUDFLARE_PACKAGE_NAMES.some((cf) => name.includes(cf) || name.startsWith('@cloudflare/'))
    )

    if (cfDeps.length > 0) {
      expect.fail(
        `Found Cloudflare packages in core/package.json dependencies:\n` +
        cfDeps.map((d) => `  - ${d}: ${deps[d]}`).join('\n')
      )
    }

    expect(cfDeps).toHaveLength(0)
  })

  it('should have no Cloudflare packages in devDependencies', () => {
    const deps = packageJson.devDependencies || {}
    const cfDeps = Object.keys(deps).filter((name) =>
      CLOUDFLARE_PACKAGE_NAMES.some((cf) => name.includes(cf) || name.startsWith('@cloudflare/'))
    )

    if (cfDeps.length > 0) {
      expect.fail(
        `Found Cloudflare packages in core/package.json devDependencies:\n` +
        cfDeps.map((d) => `  - ${d}: ${deps[d]}`).join('\n')
      )
    }

    expect(cfDeps).toHaveLength(0)
  })

  it('should have no Cloudflare packages in peerDependencies', () => {
    const deps = packageJson.peerDependencies || {}
    const cfDeps = Object.keys(deps).filter((name) =>
      CLOUDFLARE_PACKAGE_NAMES.some((cf) => name.includes(cf) || name.startsWith('@cloudflare/'))
    )

    if (cfDeps.length > 0) {
      expect.fail(
        `Found Cloudflare packages in core/package.json peerDependencies:\n` +
        cfDeps.map((d) => `  - ${d}: ${deps[d]}`).join('\n')
      )
    }

    expect(cfDeps).toHaveLength(0)
  })

  it('should have no wrangler in any dependency section', () => {
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.peerDependencies,
    }

    expect(allDeps).not.toHaveProperty('wrangler')
  })

  it('should have no miniflare in any dependency section', () => {
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.peerDependencies,
    }

    expect(allDeps).not.toHaveProperty('miniflare')
  })
})

// =============================================================================
// Test 4: Specific file checks for common violations
// =============================================================================

describe('Specific file checks for common violations', () => {
  const checkFile = (relativePath: string) => {
    const fullPath = path.join(CORE_DIR, relativePath)
    if (!fs.existsSync(fullPath)) {
      return null
    }
    return fs.readFileSync(fullPath, 'utf-8')
  }

  it('core/fsx.ts should not reference DurableObjectStub', () => {
    const content = checkFile('fsx.ts')
    if (content === null) {
      // File doesn't exist yet - this is expected in RED phase
      expect(true).toBe(true)
      return
    }

    expect(content).not.toMatch(/DurableObjectStub/)
    expect(content).not.toMatch(/DurableObjectNamespace/)
    expect(content).not.toMatch(/DurableObjectId/)
  })

  it('core/backend.ts should not import from Cloudflare', () => {
    const content = checkFile('backend.ts')
    if (content === null) {
      expect(true).toBe(true)
      return
    }

    expect(content).not.toMatch(/@cloudflare\//)
    expect(content).not.toMatch(/cloudflare:/)
  })

  it('core/types.ts should not import from Cloudflare', () => {
    const content = checkFile('types.ts')
    if (content === null) {
      expect(true).toBe(true)
      return
    }

    expect(content).not.toMatch(/@cloudflare\//)
    expect(content).not.toMatch(/cloudflare:/)
  })

  it('core/index.ts should not re-export from storage or do layers', () => {
    const content = checkFile('index.ts')
    if (content === null) {
      expect(true).toBe(true)
      return
    }

    expect(content).not.toMatch(/from\s+['"][^'"]*storage/)
    expect(content).not.toMatch(/from\s+['"][^'"]*\/do\//)
    expect(content).not.toMatch(/from\s+['"][^'"]*durable-object/)
  })
})

// =============================================================================
// Test 5: Summary test for CI/CD gate
// =============================================================================

describe('CI/CD Gate: Core package isolation', () => {
  it('should pass all isolation checks (summary)', () => {
    const coreFiles = getTypeScriptFiles(CORE_DIR)

    // Aggregate all violations
    const cloudflareViolations: string[] = []
    const serviceLayerViolations: string[] = []

    for (const file of coreFiles) {
      const content = fs.readFileSync(file, 'utf-8')
      const relativePath = path.relative(CORE_DIR, file)

      // Check for Cloudflare imports
      if (containsPatterns(content, CLOUDFLARE_IMPORT_PATTERNS).matches) {
        cloudflareViolations.push(relativePath)
      }

      // Check for service layer imports
      if (containsPatterns(content, SERVICE_LAYER_PATTERNS).matches) {
        serviceLayerViolations.push(relativePath)
      }
    }

    // Check package.json
    let packageJsonViolations: string[] = []
    if (fs.existsSync(CORE_PACKAGE_JSON)) {
      const pkg = JSON.parse(fs.readFileSync(CORE_PACKAGE_JSON, 'utf-8'))
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      }

      packageJsonViolations = Object.keys(allDeps).filter((name) =>
        name.startsWith('@cloudflare/') ||
        CLOUDFLARE_PACKAGE_NAMES.includes(name)
      )
    }

    // Generate comprehensive report
    const totalViolations =
      cloudflareViolations.length +
      serviceLayerViolations.length +
      packageJsonViolations.length

    if (totalViolations > 0) {
      let report = `\n${'='.repeat(60)}\n`
      report += `CORE PACKAGE ISOLATION VIOLATIONS: ${totalViolations}\n`
      report += `${'='.repeat(60)}\n\n`

      if (cloudflareViolations.length > 0) {
        report += `Cloudflare imports (${cloudflareViolations.length}):\n`
        report += cloudflareViolations.map((f) => `  - ${f}`).join('\n')
        report += '\n\n'
      }

      if (serviceLayerViolations.length > 0) {
        report += `Service layer imports (${serviceLayerViolations.length}):\n`
        report += serviceLayerViolations.map((f) => `  - ${f}`).join('\n')
        report += '\n\n'
      }

      if (packageJsonViolations.length > 0) {
        report += `Package.json CF dependencies (${packageJsonViolations.length}):\n`
        report += packageJsonViolations.map((f) => `  - ${f}`).join('\n')
        report += '\n\n'
      }

      report += `${'='.repeat(60)}\n`
      report += 'The core/ package must have zero Cloudflare dependencies.\n'
      report += 'Move CF-specific code to storage/ or do/ layers.\n'
      report += `${'='.repeat(60)}\n`

      expect.fail(report)
    }

    expect(totalViolations).toBe(0)
  })
})
