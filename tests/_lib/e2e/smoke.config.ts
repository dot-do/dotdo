/**
 * ACID Test Suite - Phase 5: Smoke Test Configuration
 *
 * Smoke test specific configuration with fast timeouts and
 * fail-fast behavior for quick deployment verification.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 5 E2E Pipeline
 */

import { type E2EConfig, createE2EConfig, getE2EConfig } from './config'

// ============================================================================
// SMOKE TEST CONFIGURATION
// ============================================================================

/**
 * Smoke test configuration options
 */
export interface SmokeTestConfig {
  /** Maximum time for entire smoke test suite (ms) */
  maxSuiteDuration: number
  /** Timeout per individual test (ms) */
  testTimeout: number
  /** Timeout for health check (ms) */
  healthCheckTimeout: number
  /** Timeout for CRUD operations (ms) */
  crudTimeout: number
  /** Timeout for clone operations (ms) */
  cloneTimeout: number
  /** Number of retries for flaky tests */
  retries: number
  /** Delay between retries (ms) */
  retryDelay: number
  /** Stop on first failure */
  bail: boolean
  /** Fail if any binding is unavailable */
  strictBindings: boolean
  /** Bindings to verify */
  requiredBindings: Array<'kv' | 'r2' | 'd1' | 'pipeline' | 'do'>
}

/**
 * Default smoke test configuration
 * Optimized for fast feedback (< 60 seconds)
 */
export const DEFAULT_SMOKE_CONFIG: SmokeTestConfig = {
  maxSuiteDuration: 60000, // 60 seconds total
  testTimeout: 10000, // 10 seconds per test
  healthCheckTimeout: 5000, // 5 seconds for health check
  crudTimeout: 5000, // 5 seconds for CRUD ops
  cloneTimeout: 15000, // 15 seconds for clone
  retries: 2, // 2 retries
  retryDelay: 500, // 500ms between retries
  bail: true, // Stop on first failure
  strictBindings: false, // Allow degraded state
  requiredBindings: ['do', 'kv'], // Minimum required bindings
}

/**
 * Strict smoke test configuration
 * For production deployments where all bindings must work
 */
export const STRICT_SMOKE_CONFIG: SmokeTestConfig = {
  maxSuiteDuration: 90000, // 90 seconds total
  testTimeout: 15000, // 15 seconds per test
  healthCheckTimeout: 5000, // 5 seconds for health check
  crudTimeout: 8000, // 8 seconds for CRUD ops
  cloneTimeout: 20000, // 20 seconds for clone
  retries: 3, // 3 retries
  retryDelay: 1000, // 1s between retries
  bail: true, // Stop on first failure
  strictBindings: true, // All bindings must work
  requiredBindings: ['do', 'kv', 'r2', 'd1', 'pipeline'],
}

/**
 * Minimal smoke test configuration
 * For quick sanity checks (< 30 seconds)
 */
export const MINIMAL_SMOKE_CONFIG: SmokeTestConfig = {
  maxSuiteDuration: 30000, // 30 seconds total
  testTimeout: 5000, // 5 seconds per test
  healthCheckTimeout: 3000, // 3 seconds for health check
  crudTimeout: 3000, // 3 seconds for CRUD ops
  cloneTimeout: 10000, // 10 seconds for clone
  retries: 1, // 1 retry
  retryDelay: 250, // 250ms between retries
  bail: true, // Stop on first failure
  strictBindings: false, // Allow degraded state
  requiredBindings: ['do'], // Only DO required
}

// ============================================================================
// CONFIGURATION MANAGEMENT
// ============================================================================

let currentSmokeConfig: SmokeTestConfig = DEFAULT_SMOKE_CONFIG

/**
 * Get current smoke test configuration
 */
export function getSmokeConfig(): SmokeTestConfig {
  return currentSmokeConfig
}

/**
 * Configure smoke tests
 */
export function configureSmokeTests(overrides: Partial<SmokeTestConfig>): SmokeTestConfig {
  currentSmokeConfig = {
    ...DEFAULT_SMOKE_CONFIG,
    ...overrides,
  }
  return currentSmokeConfig
}

/**
 * Reset smoke test configuration to defaults
 */
export function resetSmokeConfig(): void {
  currentSmokeConfig = DEFAULT_SMOKE_CONFIG
}

/**
 * Use strict smoke test configuration
 */
export function useStrictSmokeConfig(): void {
  currentSmokeConfig = STRICT_SMOKE_CONFIG
}

/**
 * Use minimal smoke test configuration
 */
export function useMinimalSmokeConfig(): void {
  currentSmokeConfig = MINIMAL_SMOKE_CONFIG
}

// ============================================================================
// SMOKE TEST E2E CONFIG FACTORY
// ============================================================================

/**
 * Create E2E config optimized for smoke tests
 */
export function createSmokeE2EConfig(overrides: Partial<E2EConfig> = {}): E2EConfig {
  const smokeConfig = getSmokeConfig()

  return createE2EConfig({
    ...overrides,
    timeouts: {
      test: smokeConfig.testTimeout,
      assertion: 3000, // Fast assertions
      pipelineDelivery: smokeConfig.crudTimeout,
      icebergFlush: smokeConfig.cloneTimeout,
      healthCheck: smokeConfig.healthCheckTimeout,
      cleanup: 5000, // 5 seconds for cleanup
      ...overrides.timeouts,
    },
    retries: {
      testRetries: smokeConfig.retries,
      retryDelay: smokeConfig.retryDelay,
      backoffMultiplier: 1.5,
      maxRetryDelay: 5000,
      ...overrides.retries,
    },
    cleanup: {
      enabled: true,
      prefix: 'smoke-',
      maxAge: 3600, // 1 hour
      beforeTests: true,
      afterTests: true,
      ...overrides.cleanup,
    },
    smoke: {
      maxDuration: smokeConfig.maxSuiteDuration,
      bail: smokeConfig.bail,
      ...overrides.smoke,
    },
  })
}

// ============================================================================
// VITEST SMOKE TEST CONFIGURATION
// ============================================================================

/**
 * Get Vitest test options for smoke tests
 */
export function getVitestSmokeOptions(): {
  timeout: number
  retry: number
  bail: number
  testTimeout: number
  hookTimeout: number
} {
  const config = getSmokeConfig()

  return {
    timeout: config.maxSuiteDuration,
    retry: config.retries,
    bail: config.bail ? 1 : 0,
    testTimeout: config.testTimeout,
    hookTimeout: config.testTimeout,
  }
}

// ============================================================================
// ENVIRONMENT PRESETS
// ============================================================================

/**
 * Smoke test presets for different environments
 */
export const SMOKE_PRESETS = {
  local: {
    ...MINIMAL_SMOKE_CONFIG,
    strictBindings: false,
    requiredBindings: ['do'] as const,
  },
  staging: {
    ...DEFAULT_SMOKE_CONFIG,
    strictBindings: false,
    requiredBindings: ['do', 'kv', 'r2'] as const,
  },
  preview: {
    ...DEFAULT_SMOKE_CONFIG,
    strictBindings: false,
    requiredBindings: ['do', 'kv'] as const,
  },
  production: {
    ...STRICT_SMOKE_CONFIG,
    strictBindings: true,
    requiredBindings: ['do', 'kv', 'r2', 'd1', 'pipeline'] as const,
  },
} as const

/**
 * Get smoke test preset for current environment
 */
export function getSmokePreset(): SmokeTestConfig {
  const e2eConfig = getE2EConfig()
  const preset = SMOKE_PRESETS[e2eConfig.environment]
  return preset || DEFAULT_SMOKE_CONFIG
}

/**
 * Apply environment-specific smoke test preset
 */
export function applySmokePreset(): void {
  currentSmokeConfig = getSmokePreset()
}

// ============================================================================
// EXPORTS
// ============================================================================

export const smokeConfig = {
  get: getSmokeConfig,
  configure: configureSmokeTests,
  reset: resetSmokeConfig,
  useStrict: useStrictSmokeConfig,
  useMinimal: useMinimalSmokeConfig,
  createE2EConfig: createSmokeE2EConfig,
  getVitestOptions: getVitestSmokeOptions,
  getPreset: getSmokePreset,
  applyPreset: applySmokePreset,
  presets: SMOKE_PRESETS,
}

export default smokeConfig
