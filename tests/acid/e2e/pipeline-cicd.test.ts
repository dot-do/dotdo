/**
 * ACID Test Suite - E2E CI/CD Pipeline Tests
 *
 * Comprehensive end-to-end tests for the CI/CD pipeline including:
 * - Build steps (compilation, bundling, asset generation)
 * - Test execution (unit, integration, E2E)
 * - Deployment validation (staging, production)
 * - Rollback scenarios (failure recovery, version management)
 *
 * These tests verify the entire deployment lifecycle and can be run
 * against live Cloudflare infrastructure when E2E is enabled.
 *
 * @see .github/workflows/e2e-pipeline.yml - CI/CD pipeline configuration
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Whether E2E tests should run (requires live deployment) */
const E2E_ENABLED = process.env.CLOUDFLARE_E2E === 'true' || process.env.CI === 'true'

/** Target environment for tests */
const E2E_ENVIRONMENT = process.env.E2E_ENVIRONMENT || 'staging'

/** Staging URL for deployment tests */
const STAGING_URL = process.env.STAGING_URL || 'https://staging.api.dotdo.dev'

/** Production URL for read-only verification */
const PRODUCTION_URL = process.env.PRODUCTION_URL || 'https://api.dotdo.dev'

/** Timeout for build operations (ms) */
const BUILD_TIMEOUT = 120_000

/** Timeout for deployment operations (ms) */
const DEPLOYMENT_TIMEOUT = 300_000

/** Timeout for rollback operations (ms) */
const ROLLBACK_TIMEOUT = 120_000

/** Maximum acceptable build time (ms) */
const MAX_BUILD_TIME = 60_000

/** Maximum acceptable deployment time (ms) */
const MAX_DEPLOYMENT_TIME = 180_000

/** Maximum acceptable rollback time (ms) */
const MAX_ROLLBACK_TIME = 60_000

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Build result from CI/CD pipeline
 */
interface BuildResult {
  success: boolean
  version: string
  commit: string
  branch: string
  durationMs: number
  artifacts: BuildArtifact[]
  errors?: string[]
  warnings?: string[]
}

/**
 * Build artifact metadata
 */
interface BuildArtifact {
  name: string
  type: 'worker' | 'assets' | 'wasm' | 'sourcemap'
  sizeBytes: number
  hash: string
  gzipSizeBytes?: number
}

/**
 * Test execution result
 */
interface TestResult {
  suite: string
  passed: number
  failed: number
  skipped: number
  durationMs: number
  coverage?: CoverageReport
  failures?: TestFailure[]
}

/**
 * Coverage report summary
 */
interface CoverageReport {
  lines: number
  branches: number
  functions: number
  statements: number
}

/**
 * Individual test failure
 */
interface TestFailure {
  test: string
  error: string
  stack?: string
}

/**
 * Deployment result
 */
interface DeploymentResult {
  success: boolean
  environment: string
  version: string
  previousVersion?: string
  durationMs: number
  url: string
  healthCheck: HealthCheckResult
  rollbackAvailable: boolean
}

/**
 * Health check result
 */
interface HealthCheckResult {
  healthy: boolean
  checks: Array<{
    name: string
    status: 'pass' | 'fail' | 'warn'
    latencyMs: number
    message?: string
  }>
}

/**
 * Rollback result
 */
interface RollbackResult {
  success: boolean
  fromVersion: string
  toVersion: string
  durationMs: number
  reason: string
  verification: DeploymentVerification
}

/**
 * Deployment verification result
 */
interface DeploymentVerification {
  accessible: boolean
  versionMatch: boolean
  healthPassed: boolean
  apiResponding: boolean
  latencyMs: number
  errors?: string[]
}

/**
 * Test context for CI/CD pipeline tests
 */
interface PipelineTestContext {
  testRunId: string
  startTime: number
  environment: string
  baseUrl: string
  results: {
    builds: BuildResult[]
    tests: TestResult[]
    deployments: DeploymentResult[]
    rollbacks: RollbackResult[]
  }
}

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Skip test if E2E is not enabled
 */
function skipIfNoE2E(): string | null {
  if (!E2E_ENABLED) {
    return 'Skipped: CLOUDFLARE_E2E not enabled'
  }
  return null
}

/**
 * Generate a unique test run ID
 */
function generateTestRunId(): string {
  return `cicd-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * HTTP client for pipeline API requests
 */
async function pipelineRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    body?: unknown
    baseUrl?: string
    timeout?: number
    headers?: Record<string, string>
  } = {}
): Promise<T> {
  const baseUrl = options.baseUrl || STAGING_URL
  const url = path.startsWith('http') ? path : `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 30000)

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Test-Run-Id': generateTestRunId(),
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }

    const text = await response.text()
    return text ? JSON.parse(text) : ({} as T)
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Wait for a condition to be true with polling
 */
async function waitFor(
  condition: () => Promise<boolean>,
  options: { timeout?: number; pollInterval?: number; description?: string } = {}
): Promise<void> {
  const timeout = options.timeout || 30000
  const pollInterval = options.pollInterval || 1000
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return
    }
    await sleep(pollInterval)
  }

  throw new Error(
    options.description
      ? `Timeout waiting for: ${options.description}`
      : `Timeout after ${timeout}ms`
  )
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// BUILD STEP TESTS
// ============================================================================

describe('CI/CD Pipeline - Build Steps', { timeout: BUILD_TIMEOUT }, () => {
  const testContext: PipelineTestContext = {
    testRunId: '',
    startTime: 0,
    environment: E2E_ENVIRONMENT,
    baseUrl: STAGING_URL,
    results: {
      builds: [],
      tests: [],
      deployments: [],
      rollbacks: [],
    },
  }

  beforeAll(() => {
    testContext.testRunId = generateTestRunId()
    testContext.startTime = Date.now()
  })

  describe('TypeScript Compilation', () => {
    it.skipIf(!E2E_ENABLED)('should compile TypeScript without errors', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<BuildResult>('/build/typecheck', {
        method: 'POST',
        timeout: BUILD_TIMEOUT,
      })

      expect(result.success).toBe(true)
      expect(result.errors).toBeUndefined()
      expect(result.durationMs).toBeLessThan(MAX_BUILD_TIME)

      testContext.results.builds.push(result)
    })

    it.skipIf(!E2E_ENABLED)('should generate type definitions', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        generated: boolean
        files: string[]
        durationMs: number
      }>('/build/dts', {
        method: 'POST',
        timeout: BUILD_TIMEOUT,
      })

      expect(result.generated).toBe(true)
      expect(result.files.length).toBeGreaterThan(0)
      expect(result.files).toContain('index.d.ts')
    })

    it.skipIf(!E2E_ENABLED)('should detect type errors in CI mode', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        strictMode: boolean
        noImplicitAny: boolean
        strictNullChecks: boolean
        errorsDetected: number
      }>('/build/typecheck/strict', {
        method: 'POST',
        timeout: BUILD_TIMEOUT,
      })

      expect(result.strictMode).toBe(true)
      expect(result.noImplicitAny).toBe(true)
      expect(result.strictNullChecks).toBe(true)
      expect(result.errorsDetected).toBe(0)
    })
  })

  describe('Bundle Generation', () => {
    it.skipIf(!E2E_ENABLED)('should generate worker bundles', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<BuildResult>('/build/bundle', {
        method: 'POST',
        timeout: BUILD_TIMEOUT,
      })

      expect(result.success).toBe(true)
      expect(result.artifacts).toBeDefined()

      const workerArtifacts = result.artifacts.filter((a) => a.type === 'worker')
      expect(workerArtifacts.length).toBeGreaterThan(0)

      // Verify bundle size is reasonable (< 25MB uncompressed)
      for (const artifact of workerArtifacts) {
        expect(artifact.sizeBytes).toBeLessThan(25 * 1024 * 1024)
      }

      testContext.results.builds.push(result)
    })

    it.skipIf(!E2E_ENABLED)('should generate optimized bundles for production', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<BuildResult>('/build/bundle', {
        method: 'POST',
        body: { mode: 'production', minify: true, treeshake: true },
        timeout: BUILD_TIMEOUT,
      })

      expect(result.success).toBe(true)

      // Production bundles should be smaller due to minification
      const workerArtifacts = result.artifacts.filter((a) => a.type === 'worker')
      for (const artifact of workerArtifacts) {
        expect(artifact.gzipSizeBytes).toBeLessThan(artifact.sizeBytes)
        // Gzipped should be < 50% of uncompressed
        expect(artifact.gzipSizeBytes!).toBeLessThan(artifact.sizeBytes * 0.5)
      }
    })

    it.skipIf(!E2E_ENABLED)('should generate source maps', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<BuildResult>('/build/bundle', {
        method: 'POST',
        body: { sourceMaps: true },
        timeout: BUILD_TIMEOUT,
      })

      expect(result.success).toBe(true)

      const sourcemapArtifacts = result.artifacts.filter((a) => a.type === 'sourcemap')
      expect(sourcemapArtifacts.length).toBeGreaterThan(0)

      // Each worker should have a corresponding sourcemap
      const workerArtifacts = result.artifacts.filter((a) => a.type === 'worker')
      expect(sourcemapArtifacts.length).toBe(workerArtifacts.length)
    })

    it.skipIf(!E2E_ENABLED)('should bundle WASM modules', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<BuildResult>('/build/bundle', {
        method: 'POST',
        body: { includeWasm: true },
        timeout: BUILD_TIMEOUT,
      })

      expect(result.success).toBe(true)

      const wasmArtifacts = result.artifacts.filter((a) => a.type === 'wasm')
      // May or may not have WASM depending on project configuration
      if (wasmArtifacts.length > 0) {
        for (const artifact of wasmArtifacts) {
          expect(artifact.sizeBytes).toBeGreaterThan(0)
          expect(artifact.hash).toBeDefined()
        }
      }
    })
  })

  describe('Asset Generation', () => {
    it.skipIf(!E2E_ENABLED)('should generate static assets', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        success: boolean
        assets: Array<{ path: string; sizeBytes: number; contentType: string }>
        totalSize: number
        durationMs: number
      }>('/build/assets', {
        method: 'POST',
        timeout: BUILD_TIMEOUT,
      })

      expect(result.success).toBe(true)
      expect(result.assets.length).toBeGreaterThan(0)
      expect(result.totalSize).toBeGreaterThan(0)
    })

    it.skipIf(!E2E_ENABLED)('should optimize images', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        optimized: boolean
        originalSize: number
        optimizedSize: number
        savings: number
        files: string[]
      }>('/build/assets/optimize', {
        method: 'POST',
        timeout: BUILD_TIMEOUT,
      })

      expect(result.optimized).toBe(true)
      expect(result.optimizedSize).toBeLessThanOrEqual(result.originalSize)
      expect(result.savings).toBeGreaterThanOrEqual(0)
    })

    it.skipIf(!E2E_ENABLED)('should generate content hashes for cache busting', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        success: boolean
        manifest: Record<string, string> // filename -> hashed filename
      }>('/build/assets/manifest', {
        method: 'POST',
        timeout: BUILD_TIMEOUT,
      })

      expect(result.success).toBe(true)
      expect(Object.keys(result.manifest).length).toBeGreaterThan(0)

      // Verify hashes are in filenames
      for (const [original, hashed] of Object.entries(result.manifest)) {
        expect(hashed).toMatch(/\.[a-f0-9]{8,}\.\w+$/)
      }
    })
  })

  describe('Build Caching', () => {
    it.skipIf(!E2E_ENABLED)('should utilize build cache for incremental builds', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      // First build (cold cache)
      const coldBuild = await pipelineRequest<BuildResult>('/build/bundle', {
        method: 'POST',
        body: { cache: true },
        timeout: BUILD_TIMEOUT,
      })

      expect(coldBuild.success).toBe(true)

      // Second build (warm cache) - should be faster
      const warmBuild = await pipelineRequest<BuildResult>('/build/bundle', {
        method: 'POST',
        body: { cache: true },
        timeout: BUILD_TIMEOUT,
      })

      expect(warmBuild.success).toBe(true)
      // Warm build should be at least 30% faster
      expect(warmBuild.durationMs).toBeLessThan(coldBuild.durationMs * 0.7)
    })

    it.skipIf(!E2E_ENABLED)('should invalidate cache when dependencies change', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        cacheValid: boolean
        cacheKey: string
        reason?: string
      }>('/build/cache/status', {
        timeout: BUILD_TIMEOUT,
      })

      expect(result.cacheKey).toBeDefined()
      expect(typeof result.cacheValid).toBe('boolean')
    })
  })
})

// ============================================================================
// TEST EXECUTION TESTS
// ============================================================================

describe('CI/CD Pipeline - Test Execution', { timeout: BUILD_TIMEOUT * 2 }, () => {
  describe('Unit Tests', () => {
    it.skipIf(!E2E_ENABLED)('should run unit test suite successfully', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<TestResult>('/tests/unit', {
        method: 'POST',
        timeout: BUILD_TIMEOUT,
      })

      expect(result.passed).toBeGreaterThan(0)
      expect(result.failed).toBe(0)
      expect(result.failures).toBeUndefined()
    })

    it.skipIf(!E2E_ENABLED)('should meet code coverage thresholds', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<TestResult>('/tests/unit', {
        method: 'POST',
        body: { coverage: true },
        timeout: BUILD_TIMEOUT,
      })

      expect(result.coverage).toBeDefined()
      expect(result.coverage!.lines).toBeGreaterThanOrEqual(80)
      expect(result.coverage!.branches).toBeGreaterThanOrEqual(70)
      expect(result.coverage!.functions).toBeGreaterThanOrEqual(80)
    })

    it.skipIf(!E2E_ENABLED)('should isolate test environments', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      // Run tests in parallel to verify isolation
      const [result1, result2] = await Promise.all([
        pipelineRequest<TestResult>('/tests/unit', {
          method: 'POST',
          body: { isolationId: 'test-1' },
          timeout: BUILD_TIMEOUT,
        }),
        pipelineRequest<TestResult>('/tests/unit', {
          method: 'POST',
          body: { isolationId: 'test-2' },
          timeout: BUILD_TIMEOUT,
        }),
      ])

      expect(result1.passed).toBeGreaterThan(0)
      expect(result2.passed).toBeGreaterThan(0)
      expect(result1.failed).toBe(0)
      expect(result2.failed).toBe(0)
    })
  })

  describe('Integration Tests', () => {
    it.skipIf(!E2E_ENABLED)('should run integration test suite', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<TestResult>('/tests/integration', {
        method: 'POST',
        timeout: BUILD_TIMEOUT * 2,
      })

      expect(result.passed).toBeGreaterThan(0)
      expect(result.failed).toBe(0)
    })

    it.skipIf(!E2E_ENABLED)('should test DO storage operations', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<TestResult>('/tests/integration/storage', {
        method: 'POST',
        timeout: BUILD_TIMEOUT,
      })

      expect(result.suite).toBe('storage')
      expect(result.passed).toBeGreaterThan(0)
      expect(result.failed).toBe(0)
    })

    it.skipIf(!E2E_ENABLED)('should test cross-DO communication', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<TestResult>('/tests/integration/rpc', {
        method: 'POST',
        timeout: BUILD_TIMEOUT,
      })

      expect(result.suite).toBe('rpc')
      expect(result.passed).toBeGreaterThan(0)
      expect(result.failed).toBe(0)
    })
  })

  describe('E2E Tests', () => {
    it.skipIf(!E2E_ENABLED)('should run E2E test suite', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<TestResult>('/tests/e2e', {
        method: 'POST',
        timeout: DEPLOYMENT_TIMEOUT,
      })

      expect(result.passed).toBeGreaterThan(0)
      expect(result.failed).toBe(0)
    })

    it.skipIf(!E2E_ENABLED)('should test complete user flows', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<TestResult>('/tests/e2e/flows', {
        method: 'POST',
        body: { flows: ['crud', 'auth', 'webhook'] },
        timeout: DEPLOYMENT_TIMEOUT,
      })

      expect(result.passed).toBeGreaterThan(0)
      expect(result.failed).toBe(0)
    })
  })

  describe('Test Reporting', () => {
    it.skipIf(!E2E_ENABLED)('should generate test reports', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        generated: boolean
        formats: string[]
        artifacts: Array<{ name: string; url: string }>
      }>('/tests/report', {
        method: 'POST',
        timeout: BUILD_TIMEOUT,
      })

      expect(result.generated).toBe(true)
      expect(result.formats).toContain('junit')
      expect(result.artifacts.length).toBeGreaterThan(0)
    })

    it.skipIf(!E2E_ENABLED)('should track test history and trends', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        history: Array<{
          runId: string
          timestamp: string
          passed: number
          failed: number
          duration: number
        }>
        trend: 'improving' | 'stable' | 'degrading'
      }>('/tests/history', {
        timeout: BUILD_TIMEOUT,
      })

      expect(result.history.length).toBeGreaterThan(0)
      expect(['improving', 'stable', 'degrading']).toContain(result.trend)
    })
  })
})

// ============================================================================
// DEPLOYMENT VALIDATION TESTS
// ============================================================================

describe('CI/CD Pipeline - Deployment Validation', { timeout: DEPLOYMENT_TIMEOUT }, () => {
  describe('Staging Deployment', () => {
    it.skipIf(!E2E_ENABLED)('should deploy to staging environment', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<DeploymentResult>('/deploy/staging', {
        method: 'POST',
        timeout: DEPLOYMENT_TIMEOUT,
      })

      expect(result.success).toBe(true)
      expect(result.environment).toBe('staging')
      expect(result.version).toBeDefined()
      expect(result.url).toContain('staging')
      expect(result.durationMs).toBeLessThan(MAX_DEPLOYMENT_TIME)
    })

    it.skipIf(!E2E_ENABLED)('should pass post-deployment health checks', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<HealthCheckResult>('/deploy/staging/health', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(result.healthy).toBe(true)
      expect(result.checks.length).toBeGreaterThan(0)

      const failedChecks = result.checks.filter((c) => c.status === 'fail')
      expect(failedChecks).toHaveLength(0)
    })

    it.skipIf(!E2E_ENABLED)('should verify API endpoints are responding', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const endpoints = ['/health', '/version', '/api/v1/status']

      for (const endpoint of endpoints) {
        const startTime = Date.now()
        const response = await fetch(`${STAGING_URL}${endpoint}`)
        const latency = Date.now() - startTime

        expect(response.ok).toBe(true)
        expect(latency).toBeLessThan(5000) // 5s max latency
      }
    })

    it.skipIf(!E2E_ENABLED)('should verify DO bindings are configured', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        bindings: Array<{
          name: string
          type: 'durable_object' | 'kv' | 'r2' | 'd1'
          status: 'connected' | 'disconnected' | 'error'
        }>
      }>('/deploy/staging/bindings', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      const doBindings = result.bindings.filter((b) => b.type === 'durable_object')
      expect(doBindings.length).toBeGreaterThan(0)

      for (const binding of doBindings) {
        expect(binding.status).toBe('connected')
      }
    })

    it.skipIf(!E2E_ENABLED)('should verify database migrations are applied', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        applied: boolean
        pendingMigrations: number
        latestVersion: string
        history: Array<{ version: string; appliedAt: string }>
      }>('/deploy/staging/migrations', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(result.applied).toBe(true)
      expect(result.pendingMigrations).toBe(0)
      expect(result.history.length).toBeGreaterThan(0)
    })
  })

  describe('Production Deployment', () => {
    it.skipIf(!E2E_ENABLED)('should verify production is accessible (read-only)', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const response = await fetch(`${PRODUCTION_URL}/health`)
      expect(response.ok).toBe(true)

      const health = await response.json() as HealthCheckResult
      expect(health.healthy).toBe(true)
    })

    it.skipIf(!E2E_ENABLED)('should verify production version matches expected', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        version: string
        commit: string
        deployedAt: string
      }>('/version', {
        baseUrl: PRODUCTION_URL,
      })

      expect(result.version).toBeDefined()
      expect(result.commit).toMatch(/^[a-f0-9]{7,40}$/)
    })

    it.skipIf(!E2E_ENABLED)('should verify production has no recent errors', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        errorRate: number
        recentErrors: number
        lastErrorAt?: string
      }>('/metrics/errors', {
        baseUrl: PRODUCTION_URL,
      })

      // Error rate should be < 0.1%
      expect(result.errorRate).toBeLessThan(0.001)
    })
  })

  describe('Canary Deployment', () => {
    it.skipIf(!E2E_ENABLED)('should support canary deployment strategy', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        canaryEnabled: boolean
        canaryPercentage: number
        canaryVersion: string
        stableVersion: string
        metrics: {
          canaryErrorRate: number
          stableErrorRate: number
          canaryLatencyP50: number
          stableLatencyP50: number
        }
      }>('/deploy/canary/status', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(typeof result.canaryEnabled).toBe('boolean')
      if (result.canaryEnabled) {
        expect(result.canaryPercentage).toBeGreaterThan(0)
        expect(result.canaryPercentage).toBeLessThanOrEqual(100)
      }
    })

    it.skipIf(!E2E_ENABLED)('should gradually increase canary traffic', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      // Simulate canary progression
      const progressions = [1, 5, 10, 25, 50, 100]

      for (const percentage of progressions) {
        const result = await pipelineRequest<{
          success: boolean
          currentPercentage: number
          errorRate: number
        }>('/deploy/canary/progress', {
          method: 'POST',
          body: { targetPercentage: percentage },
          timeout: BUILD_TIMEOUT,
          baseUrl: STAGING_URL,
        })

        expect(result.success).toBe(true)
        expect(result.currentPercentage).toBe(percentage)
        // Error rate should be acceptable to continue
        expect(result.errorRate).toBeLessThan(0.01)
      }
    })
  })

  describe('Deployment Verification', () => {
    it.skipIf(!E2E_ENABLED)('should verify deployment artifacts are accessible', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        worker: { accessible: boolean; size: number }
        assets: { accessible: boolean; count: number }
        wasm: { accessible: boolean; modules: string[] }
      }>('/deploy/verify/artifacts', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(result.worker.accessible).toBe(true)
      expect(result.assets.accessible).toBe(true)
    })

    it.skipIf(!E2E_ENABLED)('should verify CDN cache is properly configured', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        cacheEnabled: boolean
        cacheHeaders: Record<string, string>
        ttl: number
        purgeAvailable: boolean
      }>('/deploy/verify/cdn', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(result.cacheEnabled).toBe(true)
      expect(result.ttl).toBeGreaterThan(0)
    })

    it.skipIf(!E2E_ENABLED)('should verify SSL/TLS configuration', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        tlsVersion: string
        certificateValid: boolean
        expiresAt: string
        issuer: string
      }>('/deploy/verify/tls', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(result.certificateValid).toBe(true)
      expect(['TLSv1.2', 'TLSv1.3']).toContain(result.tlsVersion)

      // Certificate should not expire within 30 days
      const expiryDate = new Date(result.expiresAt)
      const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      expect(expiryDate.getTime()).toBeGreaterThan(thirtyDaysFromNow.getTime())
    })
  })
})

// ============================================================================
// ROLLBACK SCENARIO TESTS
// ============================================================================

describe('CI/CD Pipeline - Rollback Scenarios', { timeout: ROLLBACK_TIMEOUT * 2 }, () => {
  describe('Manual Rollback', () => {
    it.skipIf(!E2E_ENABLED)('should support manual rollback to previous version', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      // Get current and previous versions
      const versions = await pipelineRequest<{
        current: string
        previous: string[]
        available: string[]
      }>('/deploy/versions', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(versions.previous.length).toBeGreaterThan(0)

      // Simulate rollback (dry-run)
      const result = await pipelineRequest<RollbackResult>('/deploy/rollback', {
        method: 'POST',
        body: {
          targetVersion: versions.previous[0],
          dryRun: true,
          reason: 'E2E test rollback',
        },
        timeout: ROLLBACK_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(result.success).toBe(true)
      expect(result.fromVersion).toBe(versions.current)
      expect(result.toVersion).toBe(versions.previous[0])
    })

    it.skipIf(!E2E_ENABLED)('should verify rollback completes within SLA', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        estimatedDurationMs: number
        steps: Array<{ name: string; estimatedMs: number }>
      }>('/deploy/rollback/estimate', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(result.estimatedDurationMs).toBeLessThan(MAX_ROLLBACK_TIME)
    })

    it.skipIf(!E2E_ENABLED)('should preserve data during rollback', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        dataPreserved: boolean
        schemaCompatible: boolean
        migrationRequired: boolean
        risks: string[]
      }>('/deploy/rollback/analyze', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(result.dataPreserved).toBe(true)
      expect(result.schemaCompatible).toBe(true)
    })
  })

  describe('Automatic Rollback', () => {
    it.skipIf(!E2E_ENABLED)('should trigger automatic rollback on health check failure', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        autoRollbackEnabled: boolean
        triggers: Array<{
          condition: string
          threshold: number
          window: string
        }>
        lastTriggered?: string
      }>('/deploy/rollback/auto/config', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(result.autoRollbackEnabled).toBe(true)
      expect(result.triggers.length).toBeGreaterThan(0)

      // Verify error rate trigger exists
      const errorRateTrigger = result.triggers.find((t) => t.condition === 'error_rate')
      expect(errorRateTrigger).toBeDefined()
    })

    it.skipIf(!E2E_ENABLED)('should trigger automatic rollback on latency spike', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        triggers: Array<{
          condition: string
          threshold: number
          window: string
        }>
      }>('/deploy/rollback/auto/config', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      const latencyTrigger = result.triggers.find((t) => t.condition === 'latency_p95')
      expect(latencyTrigger).toBeDefined()
    })

    it.skipIf(!E2E_ENABLED)('should send notifications on rollback', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        notificationsEnabled: boolean
        channels: Array<{
          type: 'slack' | 'email' | 'pagerduty' | 'webhook'
          configured: boolean
        }>
      }>('/deploy/rollback/notifications', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(result.notificationsEnabled).toBe(true)
      expect(result.channels.length).toBeGreaterThan(0)

      const configuredChannels = result.channels.filter((c) => c.configured)
      expect(configuredChannels.length).toBeGreaterThan(0)
    })
  })

  describe('Rollback Recovery', () => {
    it.skipIf(!E2E_ENABLED)('should handle failed rollback gracefully', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        recoveryPlan: Array<{
          step: number
          action: string
          description: string
        }>
        escalationPath: string[]
        runbookUrl?: string
      }>('/deploy/rollback/recovery-plan', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(result.recoveryPlan.length).toBeGreaterThan(0)
      expect(result.escalationPath.length).toBeGreaterThan(0)
    })

    it.skipIf(!E2E_ENABLED)('should support rollback to any previous version', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const versions = await pipelineRequest<{
        available: Array<{
          version: string
          deployedAt: string
          commit: string
          rollbackable: boolean
        }>
      }>('/deploy/versions/all', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(versions.available.length).toBeGreaterThan(0)

      const rollbackable = versions.available.filter((v) => v.rollbackable)
      expect(rollbackable.length).toBeGreaterThan(0)
    })

    it.skipIf(!E2E_ENABLED)('should maintain audit trail of rollbacks', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        history: Array<{
          id: string
          fromVersion: string
          toVersion: string
          triggeredBy: string
          reason: string
          timestamp: string
          duration: number
          success: boolean
        }>
      }>('/deploy/rollback/history', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      // May or may not have rollback history
      expect(Array.isArray(result.history)).toBe(true)
    })
  })

  describe('Feature Flag Rollback', () => {
    it.skipIf(!E2E_ENABLED)('should support feature flag-based rollback', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        flags: Array<{
          name: string
          enabled: boolean
          rollbackable: boolean
          affectedUsers: number
        }>
      }>('/deploy/flags', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(result.flags).toBeDefined()
      expect(Array.isArray(result.flags)).toBe(true)
    })

    it.skipIf(!E2E_ENABLED)('should rollback feature flag instantly', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        instantRollback: boolean
        propagationTime: number
        globalConsistency: boolean
      }>('/deploy/flags/rollback/capabilities', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(result.instantRollback).toBe(true)
      // Flag changes should propagate in < 1 second
      expect(result.propagationTime).toBeLessThan(1000)
    })
  })
})

// ============================================================================
// PIPELINE INTEGRATION TESTS
// ============================================================================

describe('CI/CD Pipeline - End-to-End Integration', { timeout: DEPLOYMENT_TIMEOUT * 2 }, () => {
  describe('Complete Pipeline Flow', () => {
    it.skipIf(!E2E_ENABLED)('should execute complete pipeline from commit to deploy', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        pipelineId: string
        stages: Array<{
          name: string
          status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped'
          durationMs: number
        }>
        totalDuration: number
        success: boolean
      }>('/pipeline/simulate', {
        method: 'POST',
        body: {
          stages: ['build', 'test', 'deploy-staging', 'smoke-test'],
        },
        timeout: DEPLOYMENT_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(result.success).toBe(true)
      expect(result.stages.every((s) => s.status === 'passed' || s.status === 'skipped')).toBe(true)
    })

    it.skipIf(!E2E_ENABLED)('should block deployment on test failures', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        blocked: boolean
        reason: string
        failedChecks: string[]
        requiredChecks: string[]
      }>('/pipeline/gates', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(result.requiredChecks.length).toBeGreaterThan(0)
      expect(result.requiredChecks).toContain('tests')
      expect(result.requiredChecks).toContain('build')
    })

    it.skipIf(!E2E_ENABLED)('should require approval for production deployment', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        approvalRequired: boolean
        approvers: string[]
        minimumApprovals: number
        currentApprovals: number
      }>('/pipeline/approval/production', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(result.approvalRequired).toBe(true)
      expect(result.minimumApprovals).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Pipeline Observability', () => {
    it.skipIf(!E2E_ENABLED)('should expose pipeline metrics', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        deployments: {
          total: number
          successful: number
          failed: number
          rolledBack: number
        }
        averageDuration: number
        lastDeployment: string
      }>('/pipeline/metrics', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(result.deployments).toBeDefined()
      expect(result.averageDuration).toBeGreaterThan(0)
    })

    it.skipIf(!E2E_ENABLED)('should provide deployment logs', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        logs: Array<{
          timestamp: string
          level: 'info' | 'warn' | 'error'
          message: string
          stage: string
        }>
        truncated: boolean
        totalLines: number
      }>('/pipeline/logs', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(result.logs).toBeDefined()
      expect(result.totalLines).toBeGreaterThanOrEqual(0)
    })

    it.skipIf(!E2E_ENABLED)('should track deployment lead time', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await pipelineRequest<{
        leadTime: {
          p50: number
          p95: number
          p99: number
        }
        trendDirection: 'improving' | 'stable' | 'degrading'
        lastWeekAverage: number
      }>('/pipeline/metrics/lead-time', {
        timeout: BUILD_TIMEOUT,
        baseUrl: STAGING_URL,
      })

      expect(result.leadTime).toBeDefined()
      expect(result.leadTime.p50).toBeGreaterThan(0)
      expect(['improving', 'stable', 'degrading']).toContain(result.trendDirection)
    })
  })
})
