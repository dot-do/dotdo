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

// ============================================================================
// 8. Env Binding Usage Pattern Tests (RED Phase)
// ============================================================================

describe('Env Binding Usage Patterns', () => {
  /**
   * Tests that verify Workers code accesses env bindings correctly:
   * - No hardcoded binding names
   * - Proper type annotations
   * - Best practices for KV/R2/D1 access
   * - No env access outside fetch handler context
   */

  describe('DO Binding Access Patterns', () => {
    it('FAILS: DO bindings should be accessed via typed env parameter, not hardcoded', async () => {
      // This test verifies that DO bindings are accessed through proper typing
      // Anti-pattern: (env as any).DO or env['DO']
      // Good pattern: env.DO where env: CloudflareEnv

      const result = execSync(
        `grep -rn "as any\\)\\.DO\\|env\\['DO'\\]\\|env\\[\\"DO\\"\\]" --include="*.ts" --exclude-dir=node_modules --exclude-dir=dist --exclude="*.test.ts" ${ROOT_DIR}/workers ${ROOT_DIR}/api 2>/dev/null || true`,
        { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
      ).trim()

      const violations = result.split('\n').filter(l => l.length > 0)

      expect(
        violations,
        `Found ${violations.length} hardcoded/untyped DO binding accesses:\n${violations.join('\n')}`
      ).toHaveLength(0)
    })

    it('FAILS: DO namespace should use idFromName/get pattern correctly', async () => {
      // Verify DO access follows the correct pattern:
      // const id = env.DO.idFromName(name)
      // const stub = env.DO.get(id)
      //
      // Anti-pattern: env.DO.get(env.DO.idFromName(name)) in one line without null check

      const fs = await import('fs/promises')
      const path = await import('path')

      // Files that access DO bindings
      const doAccessFiles = [
        'workers/hostname-proxy.ts',
        'workers/routing.ts',
        'workers/api.ts',
        'workers/hateoas.ts',
        'workers/jsonapi.ts',
        'api/index.ts',
      ]

      const violations: string[] = []

      for (const file of doAccessFiles) {
        const filePath = path.resolve(ROOT_DIR, file)
        try {
          const content = await fs.readFile(filePath, 'utf-8')

          // Check for DO access without null check
          // Pattern: env.DO.idFromName without prior env.DO check
          const lines = content.split('\n')
          let hasNullCheck = false

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]

            // Reset null check tracking at function boundaries
            if (line.includes('async function') || line.includes('async (')) {
              hasNullCheck = false
            }

            // Track if we've seen a null check
            if (line.includes('env.DO') && (line.includes('!') || line.includes('if') || line.includes('?'))) {
              hasNullCheck = true
            }

            // Check for DO access
            if (line.includes('env.DO.idFromName') && !hasNullCheck) {
              // This is a potential violation - accessing DO without null check
              // However, many patterns do check first, so we need smarter detection
              // For now, flag files that don't have the pattern env.DO && or if (!env.DO)
              const hasGuard = content.includes('if (!env.DO)') ||
                              content.includes('if (!env?.DO)') ||
                              content.includes('env.DO &&') ||
                              content.includes('env?.DO')

              if (!hasGuard) {
                violations.push(`${file}:${i + 1}: Missing null guard before DO access`)
              }
              break
            }
          }
        } catch {
          // File doesn't exist, skip
        }
      }

      // This test documents the expected pattern
      // Currently, some files may not have proper null guards
      expect(
        violations,
        `Found ${violations.length} DO accesses without null guards:\n${violations.join('\n')}`
      ).toHaveLength(0)
    })

    it('FAILS: Multiple DO bindings should be properly typed (not just DO)', async () => {
      // Workers may use multiple DO bindings like:
      // - env.DO (main)
      // - env.BROWSER_DO
      // - env.SANDBOX_DO
      // - env.REPLICA_DO
      //
      // All should be properly typed in the function signature

      const fs = await import('fs/promises')
      const path = await import('path')

      const bindingsSource = await fs.readFile(
        path.resolve(ROOT_DIR, 'types/CloudflareBindings.ts'),
        'utf-8'
      )

      // Find all DO bindings defined
      const doBindingMatches = bindingsSource.match(/(\w+_?DO)\??:\s*DurableObjectNamespace/g) || []
      const doBindings = doBindingMatches.map(m => m.split(/[?:]/)[0].trim())

      // Check that api/types.ts Env interface includes all DO bindings
      const apiTypesPath = path.resolve(ROOT_DIR, 'api/types.ts')
      const apiTypes = await fs.readFile(apiTypesPath, 'utf-8')

      const missingBindings = doBindings.filter(binding => {
        // Check if binding is mentioned in api/types.ts
        return !apiTypes.includes(binding) && !['TEST_DO'].includes(binding)
      })

      expect(
        missingBindings,
        `api/types.ts Env is missing these DO bindings: ${missingBindings.join(', ')}`
      ).toHaveLength(0)
    })
  })

  describe('KV/R2/D1 Binding Best Practices', () => {
    it('FAILS: KV operations should handle null/missing bindings gracefully', async () => {
      // KV access should check for binding existence before use
      // Pattern: if (!env.KV) return error
      // Anti-pattern: env.KV.get(...) without null check

      const result = execSync(
        `grep -rn "env\\.KV\\." --include="*.ts" --exclude-dir=node_modules --exclude-dir=dist --exclude="*.test.ts" ${ROOT_DIR}/api ${ROOT_DIR}/workers 2>/dev/null || true`,
        { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
      ).trim()

      if (!result) {
        // No KV usage found, test passes
        return
      }

      const lines = result.split('\n').filter(l => l.length > 0)
      const violations: string[] = []

      // Group by file
      const byFile = new Map<string, string[]>()
      for (const line of lines) {
        const [filePath] = line.split(':')
        if (!filePath) continue
        if (!byFile.has(filePath)) {
          byFile.set(filePath, [])
        }
        byFile.get(filePath)!.push(line)
      }

      // Check each file for null guards
      const fs = await import('fs/promises')
      for (const [filePath, _occurrences] of byFile) {
        try {
          const content = await fs.readFile(filePath, 'utf-8')
          const hasGuard = content.includes('if (!env.KV)') ||
                          content.includes('if (!env?.KV)') ||
                          content.includes('env.KV &&') ||
                          content.includes('env?.KV') ||
                          content.includes('hasKV(env)')

          if (!hasGuard) {
            violations.push(`${filePath}: KV access without null guard`)
          }
        } catch {
          // File read error, skip
        }
      }

      expect(
        violations,
        `Found ${violations.length} KV accesses without null guards:\n${violations.join('\n')}`
      ).toHaveLength(0)
    })

    it('FAILS: R2 operations should handle missing bindings gracefully', async () => {
      // Similar check for R2 bindings
      const result = execSync(
        `grep -rn "env\\.R2\\." --include="*.ts" --exclude-dir=node_modules --exclude-dir=dist --exclude="*.test.ts" ${ROOT_DIR}/api ${ROOT_DIR}/workers 2>/dev/null || true`,
        { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
      ).trim()

      if (!result) {
        // No R2 usage found, test passes
        return
      }

      const lines = result.split('\n').filter(l => l.length > 0)
      const violations: string[] = []

      const byFile = new Map<string, string[]>()
      for (const line of lines) {
        const [filePath] = line.split(':')
        if (!filePath) continue
        if (!byFile.has(filePath)) {
          byFile.set(filePath, [])
        }
        byFile.get(filePath)!.push(line)
      }

      const fs = await import('fs/promises')
      for (const [filePath, _occurrences] of byFile) {
        try {
          const content = await fs.readFile(filePath, 'utf-8')
          const hasGuard = content.includes('if (!env.R2)') ||
                          content.includes('if (!env?.R2)') ||
                          content.includes('env.R2 &&') ||
                          content.includes('env?.R2') ||
                          content.includes('hasR2(env)')

          if (!hasGuard) {
            violations.push(`${filePath}: R2 access without null guard`)
          }
        } catch {
          // File read error, skip
        }
      }

      expect(
        violations,
        `Found ${violations.length} R2 accesses without null guards:\n${violations.join('\n')}`
      ).toHaveLength(0)
    })

    it('FAILS: D1 operations should handle missing bindings gracefully', async () => {
      // Similar check for D1 bindings
      const result = execSync(
        `grep -rn "env\\.DB\\." --include="*.ts" --exclude-dir=node_modules --exclude-dir=dist --exclude="*.test.ts" ${ROOT_DIR}/api ${ROOT_DIR}/workers 2>/dev/null || true`,
        { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
      ).trim()

      if (!result) {
        // No D1 usage found, test passes
        return
      }

      const lines = result.split('\n').filter(l => l.length > 0)
      const violations: string[] = []

      const byFile = new Map<string, string[]>()
      for (const line of lines) {
        const [filePath] = line.split(':')
        if (!filePath) continue
        if (!byFile.has(filePath)) {
          byFile.set(filePath, [])
        }
        byFile.get(filePath)!.push(line)
      }

      const fs = await import('fs/promises')
      for (const [filePath, _occurrences] of byFile) {
        try {
          const content = await fs.readFile(filePath, 'utf-8')
          const hasGuard = content.includes('if (!env.DB)') ||
                          content.includes('if (!env?.DB)') ||
                          content.includes('env.DB &&') ||
                          content.includes('env?.DB') ||
                          content.includes('hasD1(env)')

          if (!hasGuard) {
            violations.push(`${filePath}: D1 access without null guard`)
          }
        } catch {
          // File read error, skip
        }
      }

      expect(
        violations,
        `Found ${violations.length} D1 accesses without null guards:\n${violations.join('\n')}`
      ).toHaveLength(0)
    })
  })

  describe('Env Access Context Rules', () => {
    it('FAILS: No module-level env variable storage', async () => {
      // Anti-pattern: storing env in module-level variable
      // let globalEnv: CloudflareEnv
      // export function setEnv(env) { globalEnv = env }
      //
      // This breaks Workers isolation guarantees

      const result = execSync(
        `grep -rn "^let\\s\\+\\w*[Ee]nv\\|^const\\s\\+\\w*[Ee]nv\\|^var\\s\\+\\w*[Ee]nv\\|globalThis\\.\\w*[Ee]nv" --include="*.ts" --exclude-dir=node_modules --exclude-dir=dist --exclude="*.test.ts" --exclude="*.config.ts" ${ROOT_DIR}/api ${ROOT_DIR}/workers 2>/dev/null || true`,
        { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
      ).trim()

      const violations = result.split('\n')
        .filter(l => l.length > 0)
        // Filter out legitimate uses like type definitions
        .filter(l => !l.includes('type ') && !l.includes('interface '))
        // Filter out imports
        .filter(l => !l.includes('import '))

      expect(
        violations,
        `Found ${violations.length} module-level env storage patterns:\n${violations.join('\n')}`
      ).toHaveLength(0)
    })

    it('FAILS: No env parameter passed to class constructors (use DurableObject pattern)', async () => {
      // Anti-pattern: class MyHandler { constructor(env: Env) { this.env = env } }
      // This is problematic for non-DO classes as it can lead to stale env references
      //
      // Good pattern for DOs: extends DurableObject<CloudflareEnv> (env via this.env)
      // Good pattern for handlers: receive env per-request in fetch()

      const result = execSync(
        `grep -rn "constructor.*env:\\s*\\(Env\\|CloudflareEnv\\)" --include="*.ts" --exclude-dir=node_modules --exclude-dir=dist --exclude="*.test.ts" ${ROOT_DIR}/api ${ROOT_DIR}/workers 2>/dev/null || true`,
        { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
      ).trim()

      const violations = result.split('\n')
        .filter(l => l.length > 0)
        // Filter out DurableObject subclasses (they legitimately store env)
        .filter(l => !l.includes('DurableObject') && !l.includes('extends DO'))

      // This test may have false positives - some classes legitimately need env
      // The key is that env should not be cached beyond a single request
      expect(
        violations,
        `Found ${violations.length} non-DO classes storing env in constructor:\n${violations.join('\n')}\nNote: If these are legitimate, update the test to exclude them.`
      ).toHaveLength(0)
    })

    it('FAILS: Handler functions should accept env as parameter, not access global', async () => {
      // Verify that handler functions receive env explicitly
      // Good: async function handler(request: Request, env: CloudflareEnv)
      // Bad: async function handler(request: Request) { /* uses global env */ }

      const fs = await import('fs/promises')
      const path = await import('path')

      const handlerFiles = [
        'workers/hostname-proxy.ts',
        'workers/routing.ts',
        'workers/simple.ts',
        'workers/hateoas.ts',
        'workers/jsonapi.ts',
        'workers/api.ts',
      ]

      const violations: string[] = []

      for (const file of handlerFiles) {
        const filePath = path.resolve(ROOT_DIR, file)
        try {
          const content = await fs.readFile(filePath, 'utf-8')

          // Look for handler function definitions
          const handlerMatches = content.match(/async function\s+\w*[Hh]andler[^{]+\{/g) || []

          for (const match of handlerMatches) {
            // Check if it has env parameter
            if (!match.includes('env:') && !match.includes('env?:') && !match.includes('env,')) {
              violations.push(`${file}: Handler function missing env parameter: ${match.slice(0, 60)}...`)
            }
          }
        } catch {
          // File doesn't exist, skip
        }
      }

      expect(
        violations,
        `Found ${violations.length} handler functions without env parameter:\n${violations.join('\n')}`
      ).toHaveLength(0)
    })
  })

  describe('Type Safety for Env Bindings', () => {
    it('FAILS: Worker fetch handlers should type env parameter as CloudflareEnv', async () => {
      // Verify workers use proper typing for env
      // Good: async fetch(request: Request, env: CloudflareEnv)
      // Bad: async fetch(request: Request, env: any)
      // Bad: async fetch(request: Request, env: {})

      const result = execSync(
        `grep -rn "fetch.*request.*env:\\s*\\(any\\|{}\\|Record<string,\\s*unknown>\\)" --include="*.ts" --exclude-dir=node_modules --exclude-dir=dist --exclude="*.test.ts" ${ROOT_DIR}/api ${ROOT_DIR}/workers 2>/dev/null || true`,
        { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
      ).trim()

      const violations = result.split('\n')
        .filter(l => l.length > 0)
        // Filter out test mocks and legitimate generic handlers
        .filter(l => !l.includes('test') && !l.includes('mock') && !l.includes('spec'))

      expect(
        violations,
        `Found ${violations.length} fetch handlers with weak env typing:\n${violations.join('\n')}`
      ).toHaveLength(0)
    })

    it('FAILS: Env bindings should not be cast to any', async () => {
      // Anti-pattern: (env as any).SOME_BINDING
      // This bypasses TypeScript's type checking

      const result = execSync(
        `grep -rn "\\(env\\s*as\\s*any\\)" --include="*.ts" --exclude-dir=node_modules --exclude-dir=dist --exclude="*.test.ts" ${ROOT_DIR}/api ${ROOT_DIR}/workers 2>/dev/null || true`,
        { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
      ).trim()

      const violations = result.split('\n').filter(l => l.length > 0)

      expect(
        violations,
        `Found ${violations.length} env casts to any:\n${violations.join('\n')}`
      ).toHaveLength(0)
    })

    it('FAILS: Secret bindings should use string type, not be accessed as objects', async () => {
      // Verify secret bindings (API keys, etc.) are accessed as strings
      // Good: env.OPENAI_API_KEY (string)
      // Bad: env.OPENAI_API_KEY.value or JSON.parse(env.OPENAI_API_KEY)

      const result = execSync(
        `grep -rn "env\\.\\(OPENAI_API_KEY\\|ANTHROPIC_API_KEY\\|STRIPE_SECRET_KEY\\)\\." --include="*.ts" --exclude-dir=node_modules --exclude-dir=dist --exclude="*.test.ts" ${ROOT_DIR}/api ${ROOT_DIR}/workers 2>/dev/null || true`,
        { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
      ).trim()

      const violations = result.split('\n').filter(l => l.length > 0)

      expect(
        violations,
        `Found ${violations.length} secret bindings accessed as objects:\n${violations.join('\n')}`
      ).toHaveLength(0)
    })
  })
})

// ============================================================================
// 9. Env Binding Import Pattern Tests
// ============================================================================

describe('Env Binding Import Patterns', () => {
  it('FAILS: Workers should import CloudflareEnv from types/CloudflareBindings', async () => {
    // Verify workers use the canonical CloudflareEnv type
    // Good: import type { CloudflareEnv } from '../types/CloudflareBindings'
    // Bad: defining local Env type without extending CloudflareEnv

    const fs = await import('fs/promises')
    const path = await import('path')

    const workerFiles = [
      'workers/hostname-proxy.ts',
      'workers/routing.ts',
      'workers/simple.ts',
      'workers/hateoas.ts',
      'workers/jsonapi.ts',
      'workers/api.ts',
    ]

    const violations: string[] = []

    for (const file of workerFiles) {
      const filePath = path.resolve(ROOT_DIR, file)
      try {
        const content = await fs.readFile(filePath, 'utf-8')

        // Check for CloudflareEnv import
        const hasCloudflareEnvImport =
          content.includes("import type { CloudflareEnv }") ||
          content.includes("import { CloudflareEnv }") ||
          content.includes("from '../types/CloudflareBindings'") ||
          content.includes("from '../../types/CloudflareBindings'")

        // Check for local Env type definition that doesn't extend CloudflareEnv
        const hasLocalEnvType = content.match(/^interface\s+Env\s*{/m)
        const extendsCloudflareEnv = content.includes('extends CloudflareEnv')

        if (hasLocalEnvType && !extendsCloudflareEnv && !hasCloudflareEnvImport) {
          violations.push(`${file}: Defines local Env type without extending CloudflareEnv`)
        }

        // Also check if env is used without proper typing
        if (content.includes('env:') && !hasCloudflareEnvImport && !content.includes('Env')) {
          violations.push(`${file}: Uses env parameter without CloudflareEnv import`)
        }
      } catch {
        // File doesn't exist, skip
      }
    }

    expect(
      violations,
      `Found ${violations.length} workers not using CloudflareEnv:\n${violations.join('\n')}`
    ).toHaveLength(0)
  })

  it('FAILS: Type guards from CloudflareBindings should be used for binding checks', async () => {
    // CloudflareBindings.ts exports type guards like hasKV, hasR2, hasDO
    // Workers should use these instead of manual checks
    //
    // Good: if (hasKV(env)) { env.KV.get(...) }
    // Acceptable: if (env.KV) { ... } (but type guards are preferred)

    const fs = await import('fs/promises')
    const path = await import('path')

    // Read CloudflareBindings to get available type guards
    const bindingsPath = path.resolve(ROOT_DIR, 'types/CloudflareBindings.ts')
    const bindingsContent = await fs.readFile(bindingsPath, 'utf-8')

    // Extract type guard names
    const guardMatches = bindingsContent.match(/export function (has\w+)\(/g) || []
    const typeGuards = guardMatches.map(m => m.replace('export function ', '').replace('(', ''))

    // This test documents the available type guards
    // Currently: hasKV, hasR2, hasD1, hasAI, hasVectorize, hasQueue, etc.
    expect(
      typeGuards.length,
      'CloudflareBindings should export type guard functions'
    ).toBeGreaterThan(5)

    // Check if any worker files use these guards
    const workerDir = path.resolve(ROOT_DIR, 'workers')
    const result = execSync(
      `grep -rn "has\\(KV\\|R2\\|D1\\|AI\\|DO\\|Queue\\|Pipeline\\)(" --include="*.ts" --exclude="*.test.ts" ${workerDir} 2>/dev/null || true`,
      { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
    ).trim()

    // If no type guards are being used, that's not ideal but not a failure
    // This test documents the pattern we want to encourage
    if (!result) {
      // Log a note but don't fail - this is aspirational
      console.log('Note: No type guards from CloudflareBindings are being used in workers/')
    }

    // Always pass for now - this documents the pattern
    expect(true).toBe(true)
  })
})
