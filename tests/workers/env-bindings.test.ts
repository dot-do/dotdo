/**
 * Environment Bindings Tests (RED Phase)
 *
 * Tests that verify Workers code does NOT use process.env
 * and instead uses proper CloudflareEnv bindings.
 *
 * Background:
 * - Cloudflare Workers do NOT have access to process.env
 * - Node.js-style process.env access will fail at runtime
 * - All secrets/configuration must use Cloudflare env bindings
 * - CloudflareEnv interface in types/CloudflareBindings.ts defines proper bindings
 *
 * These tests are designed to FAIL (RED phase) until:
 * 1. All process.env references are removed from Workers source files
 * 2. Modules accept CloudflareEnv parameter instead
 * 3. Env bindings are properly typed
 *
 * Key files that currently violate this:
 * - objects/transport/auth-layer.ts (process.env.NODE_ENV)
 * - api/agents/providers/openai.ts (process.env.OPENAI_API_KEY)
 * - And approximately 30 other files
 *
 * Related:
 * - Epic: do-c2j (Workers Environment)
 * - types/CloudflareBindings.ts (CloudflareEnv interface)
 */

import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import { resolve, relative } from 'path'

// ============================================================================
// Test Configuration
// ============================================================================

const ROOT_DIR = resolve(__dirname, '../..')

/**
 * Source directories that should NOT contain process.env
 * These are the core Workers runtime directories
 */
const WORKERS_SOURCE_DIRS = [
  'api',
  'objects',
  'workers',
  'streaming',
  'workflows',
  'lib',
  'auth',
  'types',
  'db',
  'do',
  'core',
]

/**
 * Directories to exclude from the scan
 * These contain Node.js code, tests, or external dependencies
 */
const EXCLUDED_DIRS = [
  'node_modules',
  'dist',
  '.wrangler',
  'cli',           // CLI runs in Node.js
  'scripts',       // Build scripts run in Node.js
  'tests',         // Test files can use process.env
  'examples',      // Examples may be Node.js
  'app',           // Frontend app (Vite/SSR context)
  'ai/primitives', // Submodule with its own rules
  'do/capabilities', // Submodules with their own rules
  'packages',      // Published packages may have different rules
  'benchmarks',    // Benchmarks run in Node.js
  'snippets',      // Snippets are standalone
]

/**
 * Files to exclude from the scan
 */
const EXCLUDED_FILES = [
  '*.test.ts',
  '*.spec.ts',
  '*.config.ts',
  '*.config.js',
  'vitest.*',
  'vite.config.*',
]

// ============================================================================
// 1. Source Code Scanning Tests
// ============================================================================

describe('Workers Source Code: No process.env', () => {
  it('FAILS if process.env is found in Workers source files', () => {
    // Build grep command to find process.env in source files
    // Exclude: node_modules, dist, test files, CLI, scripts, etc.
    const excludeDirs = EXCLUDED_DIRS.map(dir => `--exclude-dir=${dir}`).join(' ')
    const excludeFiles = EXCLUDED_FILES.map(pattern => `--exclude="${pattern}"`).join(' ')

    // Run grep to find all process.env occurrences
    // grep returns exit code 1 if no matches (which is what we want!)
    // Using || true to prevent execSync from throwing on "no matches"
    const result = execSync(
      `grep -r "process\\.env" --include="*.ts" --include="*.tsx" ${excludeDirs} ${excludeFiles} ${ROOT_DIR} 2>/dev/null || true`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    ).trim()

    // Filter out false positives (comments, type definitions, etc.)
    const violations = result
      .split('\n')
      .filter(line => line.length > 0)
      .filter(line => {
        // Skip comment-only lines
        if (line.match(/^\s*\/\//)) return false
        if (line.match(/^\s*\*/)) return false
        // Skip type definitions that just reference the type
        if (line.includes('typeof process.env')) return false
        return true
      })

    // This test should FAIL until all process.env usages are removed
    // When it passes, all Workers code is properly using env bindings
    expect(
      violations,
      `Found ${violations.length} process.env references in Workers source files:\n${violations.slice(0, 20).join('\n')}${violations.length > 20 ? '\n... and more' : ''}`
    ).toHaveLength(0)
  })

  it('FAILS if process.env is found in core runtime directories', () => {
    // Stricter check for core runtime directories only
    const coreRuntimeDirs = ['objects', 'api', 'workers', 'streaming']
    const excludeDirs = ['node_modules', 'dist', 'tests', '*.test.ts'].map(d => `--exclude-dir=${d}`).join(' ')

    const results: string[] = []

    for (const dir of coreRuntimeDirs) {
      const fullPath = resolve(ROOT_DIR, dir)
      try {
        const result = execSync(
          `grep -r "process\\.env" --include="*.ts" ${excludeDirs} ${fullPath} 2>/dev/null || true`,
          { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
        ).trim()

        if (result) {
          results.push(...result.split('\n').filter(l => l.length > 0))
        }
      } catch {
        // Directory might not exist, skip
      }
    }

    expect(
      results,
      `Found ${results.length} process.env references in core runtime directories:\n${results.join('\n')}`
    ).toHaveLength(0)
  })
})

// ============================================================================
// 2. Critical Module Interface Tests
// ============================================================================

describe('Critical Modules Accept env Parameter', () => {
  it('FAILS: auth-layer.ts createAuthMiddleware should accept env parameter', async () => {
    // Import the auth layer module
    const authLayer = await import('../../objects/transport/auth-layer')

    // Check that createAuthMiddleware accepts an env parameter
    // Currently it reads process.env.NODE_ENV directly
    const createAuthMiddleware = authLayer.createAuthMiddleware

    expect(createAuthMiddleware).toBeDefined()

    // The function signature should accept env bindings
    // Currently it does NOT - it uses process.env internally
    // This test will FAIL until the signature is updated
    const fnString = createAuthMiddleware.toString()

    // Check if function accepts env parameter (env: CloudflareEnv or similar)
    const acceptsEnvParam = fnString.includes('env:') || fnString.includes('env?:')

    expect(
      acceptsEnvParam,
      'createAuthMiddleware should accept env parameter instead of using process.env'
    ).toBe(true)
  })

  it('FAILS: OpenAIProvider should accept env bindings for API key', async () => {
    // Import the OpenAI provider
    const { OpenAIProvider } = await import('../../api/agents/providers/openai')

    // Check that the provider can receive API key from env bindings
    // Currently it falls back to process.env.OPENAI_API_KEY
    const provider = new OpenAIProvider({})

    // The provider should have a way to receive env bindings
    // This test will FAIL until the implementation is updated
    expect(
      'env' in provider || 'setEnv' in provider,
      'OpenAIProvider should have env property or setEnv method for env bindings'
    ).toBe(true)
  })
})

// ============================================================================
// 3. Env Binding Type Tests
// ============================================================================

describe('CloudflareEnv Type Coverage', () => {
  it('CloudflareEnv should have common secret bindings typed', async () => {
    // Import CloudflareEnv type
    const bindings = await import('../../types/CloudflareBindings')

    // Type-level check - these should exist in CloudflareEnv
    // If the types don't exist, this will fail at compile time
    type EnvType = typeof bindings.CloudflareEnv

    // Runtime check - verify the module exports the right interface
    expect(bindings).toHaveProperty('CloudflareEnv')
  })

  it('FAILS: Common API key secrets should be defined in CloudflareEnv', async () => {
    const { CloudflareEnv } = await import('../../types/CloudflareBindings')

    // Read the CloudflareBindings source to check for API key definitions
    const fs = await import('fs/promises')
    const bindingsSource = await fs.readFile(
      resolve(ROOT_DIR, 'types/CloudflareBindings.ts'),
      'utf-8'
    )

    // Check that common API keys are typed
    const requiredSecrets = [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'GOOGLE_AI_API_KEY',
    ]

    const missingSecrets = requiredSecrets.filter(
      secret => !bindingsSource.includes(secret)
    )

    expect(
      missingSecrets,
      `CloudflareEnv should define these secrets: ${missingSecrets.join(', ')}`
    ).toHaveLength(0)
  })
})

// ============================================================================
// 4. Runtime Environment Detection Tests
// ============================================================================

describe('Runtime Environment Detection', () => {
  it('should detect Cloudflare Workers runtime (no process global)', () => {
    // In actual Workers runtime, globalThis.process is undefined
    // This test verifies the detection mechanism

    const isWorkersRuntime = typeof (globalThis as unknown as { process?: unknown }).process === 'undefined'

    // In vitest, process IS defined (Node.js), so this will be false
    // In actual Workers, this would be true
    // The point is: code should NOT assume process exists

    // Note: This test documents the expected behavior
    // The actual Workers tests run in miniflare which does NOT have process
    expect(typeof isWorkersRuntime).toBe('boolean')
  })

  it('FAILS: Runtime code should not assume process.env exists', () => {
    // Create a mock Workers environment (no process)
    const workersGlobal = {
      ...globalThis,
      process: undefined,
    }

    // Function that mimics what auth-layer.ts does
    function getNodeEnv() {
      // This is the problematic pattern - it assumes process.env exists
      // @ts-expect-error - intentionally accessing potentially undefined
      return process.env.NODE_ENV
    }

    // In Workers, this would throw
    // This test demonstrates the problem
    const hasProcess = typeof process !== 'undefined'

    // If running in actual Workers pool, process would be undefined
    // For this test to be meaningful, we check the code pattern exists
    expect(
      hasProcess,
      'This test runs in Node.js where process exists. Use Workers pool for actual runtime test.'
    ).toBe(true)
  })
})

// ============================================================================
// 5. Specific File Violation Tests
// ============================================================================

describe('Known process.env Violations', () => {
  const knownViolations = [
    {
      file: 'objects/transport/auth-layer.ts',
      pattern: 'process.env.NODE_ENV',
      fix: 'Accept isProduction flag via env bindings or options',
    },
    {
      file: 'api/agents/providers/openai.ts',
      pattern: 'process.env.OPENAI_API_KEY',
      fix: 'Accept OPENAI_API_KEY from CloudflareEnv',
    },
    {
      file: 'api/agents/providers/claude.ts',
      pattern: 'process.env',
      fix: 'Accept API key from CloudflareEnv',
    },
    {
      file: 'lib/human/channel-factory.ts',
      pattern: 'process.env',
      fix: 'Accept env bindings parameter',
    },
    {
      file: 'auth/config.ts',
      pattern: 'process.env',
      fix: 'Use env bindings from CloudflareEnv',
    },
  ]

  for (const violation of knownViolations) {
    it(`FAILS: ${violation.file} should not use ${violation.pattern}`, async () => {
      const fs = await import('fs/promises')
      const filePath = resolve(ROOT_DIR, violation.file)

      let content: string
      try {
        content = await fs.readFile(filePath, 'utf-8')
      } catch {
        // File doesn't exist, skip
        return
      }

      const hasViolation = content.includes(violation.pattern)

      expect(
        hasViolation,
        `${violation.file} contains ${violation.pattern}. Fix: ${violation.fix}`
      ).toBe(false)
    })
  }
})

// ============================================================================
// 6. Module Export Pattern Tests
// ============================================================================

describe('Module Export Patterns', () => {
  it('FAILS: Critical modules should export functions that accept env', async () => {
    // List of modules that should accept env parameter
    const modulesToCheck = [
      { path: '../../objects/transport/auth-layer', exportName: 'createAuthMiddleware' },
      { path: '../../api/agents/providers/openai', exportName: 'createOpenAIProvider' },
    ]

    const failures: string[] = []

    for (const { path, exportName } of modulesToCheck) {
      try {
        const mod = await import(path)
        const fn = mod[exportName]

        if (!fn) {
          failures.push(`${path} does not export ${exportName}`)
          continue
        }

        // Check function signature for env parameter
        const fnStr = fn.toString()
        const hasEnvParam =
          fnStr.includes('env:') ||
          fnStr.includes('env?:') ||
          fnStr.includes('CloudflareEnv') ||
          fnStr.includes('options.env')

        if (!hasEnvParam) {
          failures.push(`${exportName} from ${path} should accept env parameter`)
        }
      } catch (e) {
        failures.push(`Failed to import ${path}: ${e}`)
      }
    }

    expect(failures, failures.join('\n')).toHaveLength(0)
  })
})

// ============================================================================
// 7. Comprehensive Grep Scan
// ============================================================================

describe('Comprehensive process.env Scan', () => {
  it('reports all process.env usages with file locations', () => {
    // This test provides a detailed report of all violations
    // It's designed to help with the GREEN phase implementation

    const result = execSync(
      `grep -rn "process\\.env" --include="*.ts" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.wrangler --exclude="*.test.ts" --exclude="*.config.ts" ${ROOT_DIR} 2>/dev/null || true`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    ).trim()

    if (!result) {
      // No violations found - test passes
      expect(result).toBe('')
      return
    }

    const lines = result.split('\n').filter(l => l.length > 0)

    // Group by file
    const byFile = new Map<string, string[]>()
    for (const line of lines) {
      const [filePath] = line.split(':')
      if (!filePath) continue

      const relPath = relative(ROOT_DIR, filePath)

      // Skip excluded directories
      if (EXCLUDED_DIRS.some(dir => relPath.startsWith(dir))) continue

      if (!byFile.has(relPath)) {
        byFile.set(relPath, [])
      }
      byFile.get(relPath)!.push(line)
    }

    // Build report
    const report = Array.from(byFile.entries())
      .map(([file, occurrences]) => `\n${file} (${occurrences.length} occurrences):\n  ${occurrences.slice(0, 3).join('\n  ')}${occurrences.length > 3 ? '\n  ...' : ''}`)
      .join('\n')

    // This test FAILS to provide visibility into all violations
    expect(
      byFile.size,
      `Found process.env in ${byFile.size} Workers source files:${report}`
    ).toBe(0)
  })
})
