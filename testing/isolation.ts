/**
 * Test Isolation Verification Module
 *
 * This module provides utilities to detect and prevent shared state leaks
 * between tests. It tracks known global state sources and provides helpers
 * to verify isolation.
 *
 * Key features:
 * 1. Tracks known global state locations in dotdo packages
 * 2. Provides snapshot/restore functionality for global state
 * 3. Detects unexpected state mutations between tests
 * 4. Provides cleanup hooks for beforeEach/afterEach
 *
 * Known global state sources in dotdo:
 * - ai/tracking.ts: globalTracker singleton
 * - ai/context.ts: asyncLocalStorage module variable
 * - integrations/registry.ts: integrationRegistry singleton
 * - api/resource.ts: resource registry (global and context)
 *
 * @see do-w5l6 - Add test isolation verification
 * @module testing/isolation
 */

import type { UsageTracker, UsageRecord } from '@dotdo/ai'

/**
 * Snapshot of global state for isolation verification
 */
export interface GlobalStateSnapshot {
  /** Timestamp when snapshot was taken */
  timestamp: number

  /** AI module state */
  ai?: {
    /** Global tracker records count */
    globalTrackerRecordsCount: number
    /** Global tracker budget limit */
    globalTrackerBudgetLimit: number
  }

  /** Integration registry state */
  integrations?: {
    /** Number of registered integrations */
    registrySize: number
    /** Names of registered integrations */
    registryNames: string[]
  }

  /** Custom tracked values */
  custom?: Record<string, unknown>
}

/**
 * Configuration for isolation tracking
 */
export interface IsolationConfig {
  /** Track AI module state */
  trackAI?: boolean
  /** Track integrations registry state */
  trackIntegrations?: boolean
  /** Custom state getters */
  customTrackers?: Record<string, () => unknown>
  /** Log isolation violations (default: true) */
  logViolations?: boolean
  /** Throw on isolation violations (default: false) */
  throwOnViolation?: boolean
}

/**
 * Isolation violation details
 */
export interface IsolationViolation {
  /** Type of state that leaked */
  type: string
  /** Description of the violation */
  description: string
  /** Expected value */
  expected: unknown
  /** Actual value */
  actual: unknown
}

// Default configuration
const defaultConfig: IsolationConfig = {
  trackAI: true,
  trackIntegrations: true,
  logViolations: true,
  throwOnViolation: false,
}

/**
 * Global state trackers - lazy loaded to avoid import cycles
 */
let globalTrackerModule: { globalTracker: UsageTracker } | null = null
let integrationRegistryModule: { integrationRegistry: { size: number; names: string[]; clear: () => void } } | null = null

/**
 * Lazily load the AI tracking module
 */
async function getGlobalTracker(): Promise<UsageTracker | null> {
  if (!globalTrackerModule) {
    try {
      globalTrackerModule = await import('@dotdo/ai')
    } catch {
      // Module not available
      return null
    }
  }
  return globalTrackerModule?.globalTracker ?? null
}

/**
 * Lazily load the integration registry module
 */
async function getIntegrationRegistry(): Promise<{ size: number; names: string[]; clear: () => void } | null> {
  if (!integrationRegistryModule) {
    try {
      integrationRegistryModule = await import('@dotdo/integrations')
    } catch {
      // Module not available
      return null
    }
  }
  return integrationRegistryModule.integrationRegistry
}

/**
 * Take a snapshot of current global state
 *
 * @param config - Configuration for what to track
 * @returns Snapshot of global state
 *
 * @example
 * ```ts
 * const snapshot = await takeGlobalStateSnapshot()
 * // ... run test ...
 * const violations = await verifyIsolation(snapshot)
 * ```
 */
export async function takeGlobalStateSnapshot(
  config: IsolationConfig = defaultConfig
): Promise<GlobalStateSnapshot> {
  const snapshot: GlobalStateSnapshot = {
    timestamp: Date.now(),
  }

  // Track AI module state
  if (config.trackAI !== false) {
    const tracker = await getGlobalTracker()
    if (tracker) {
      snapshot.ai = {
        globalTrackerRecordsCount: tracker.exportRecords().length,
        globalTrackerBudgetLimit: tracker.getBudgetLimit(),
      }
    }
  }

  // Track integration registry state
  if (config.trackIntegrations !== false) {
    const registry = await getIntegrationRegistry()
    if (registry) {
      snapshot.integrations = {
        registrySize: registry.size,
        registryNames: [...registry.names],
      }
    }
  }

  // Track custom state
  if (config.customTrackers) {
    snapshot.custom = {}
    for (const [key, getter] of Object.entries(config.customTrackers)) {
      try {
        snapshot.custom[key] = getter()
      } catch {
        // Ignore errors in custom trackers
      }
    }
  }

  return snapshot
}

/**
 * Verify that current state matches a baseline snapshot
 *
 * @param baseline - The baseline snapshot to compare against
 * @param config - Configuration for what to check
 * @returns Array of isolation violations found
 *
 * @example
 * ```ts
 * beforeEach(async () => {
 *   baselineSnapshot = await takeGlobalStateSnapshot()
 * })
 *
 * afterEach(async () => {
 *   const violations = await verifyIsolation(baselineSnapshot)
 *   expect(violations).toHaveLength(0)
 * })
 * ```
 */
export async function verifyIsolation(
  baseline: GlobalStateSnapshot,
  config: IsolationConfig = defaultConfig
): Promise<IsolationViolation[]> {
  const violations: IsolationViolation[] = []
  const current = await takeGlobalStateSnapshot(config)

  // Check AI module state
  if (config.trackAI !== false && baseline.ai && current.ai) {
    if (current.ai.globalTrackerRecordsCount !== baseline.ai.globalTrackerRecordsCount) {
      violations.push({
        type: 'ai.globalTracker.records',
        description: 'Global tracker records count changed',
        expected: baseline.ai.globalTrackerRecordsCount,
        actual: current.ai.globalTrackerRecordsCount,
      })
    }

    if (current.ai.globalTrackerBudgetLimit !== baseline.ai.globalTrackerBudgetLimit) {
      violations.push({
        type: 'ai.globalTracker.budgetLimit',
        description: 'Global tracker budget limit changed',
        expected: baseline.ai.globalTrackerBudgetLimit,
        actual: current.ai.globalTrackerBudgetLimit,
      })
    }
  }

  // Check integration registry state
  if (config.trackIntegrations !== false && baseline.integrations && current.integrations) {
    if (current.integrations.registrySize !== baseline.integrations.registrySize) {
      violations.push({
        type: 'integrations.registry.size',
        description: 'Integration registry size changed',
        expected: baseline.integrations.registrySize,
        actual: current.integrations.registrySize,
      })
    }

    // Check for new registrations
    const newNames = current.integrations.registryNames.filter(
      name => !baseline.integrations!.registryNames.includes(name)
    )
    if (newNames.length > 0) {
      violations.push({
        type: 'integrations.registry.additions',
        description: `New integrations registered: ${newNames.join(', ')}`,
        expected: baseline.integrations.registryNames,
        actual: current.integrations.registryNames,
      })
    }
  }

  // Check custom tracked state
  if (config.customTrackers && baseline.custom && current.custom) {
    for (const key of Object.keys(config.customTrackers)) {
      const baselineValue = baseline.custom[key]
      const currentValue = current.custom[key]

      if (JSON.stringify(baselineValue) !== JSON.stringify(currentValue)) {
        violations.push({
          type: `custom.${key}`,
          description: `Custom tracked value "${key}" changed`,
          expected: baselineValue,
          actual: currentValue,
        })
      }
    }
  }

  // Log violations if configured
  if (config.logViolations && violations.length > 0) {
    console.warn('[Test Isolation] Violations detected:')
    for (const v of violations) {
      console.warn(`  - ${v.type}: ${v.description}`)
      console.warn(`    Expected: ${JSON.stringify(v.expected)}`)
      console.warn(`    Actual: ${JSON.stringify(v.actual)}`)
    }
  }

  // Throw if configured
  if (config.throwOnViolation && violations.length > 0) {
    const message = violations.map(v => `${v.type}: ${v.description}`).join('\n')
    throw new Error(`Test isolation violations detected:\n${message}`)
  }

  return violations
}

/**
 * Reset all known global state to clean state
 *
 * Call this in beforeEach to ensure each test starts clean.
 *
 * @param config - Configuration for what to reset
 *
 * @example
 * ```ts
 * beforeEach(async () => {
 *   await resetGlobalState()
 * })
 * ```
 */
export async function resetGlobalState(
  config: IsolationConfig = defaultConfig
): Promise<void> {
  // Reset AI module state
  if (config.trackAI !== false) {
    const tracker = await getGlobalTracker()
    if (tracker) {
      tracker.reset()
      tracker.setBudgetLimit(Infinity)
    }
  }

  // Reset integration registry state
  if (config.trackIntegrations !== false) {
    const registry = await getIntegrationRegistry()
    if (registry) {
      registry.clear()
    }
  }
}

/**
 * Create isolation hooks for use with Vitest
 *
 * Returns beforeEach and afterEach handlers that automatically
 * track and verify test isolation.
 *
 * @param config - Configuration for isolation tracking
 * @returns Object with beforeEach and afterEach functions
 *
 * @example
 * ```ts
 * import { createIsolationHooks } from '@dotdo/testing/isolation'
 * import { beforeEach, afterEach } from 'vitest'
 *
 * const { setupIsolation, verifyIsolation } = createIsolationHooks()
 *
 * beforeEach(setupIsolation)
 * afterEach(verifyIsolation)
 * ```
 */
export function createIsolationHooks(config: IsolationConfig = defaultConfig): {
  setupIsolation: () => Promise<void>
  verifyIsolation: () => Promise<void>
} {
  let baseline: GlobalStateSnapshot | null = null

  return {
    async setupIsolation(): Promise<void> {
      // Reset state before taking baseline
      await resetGlobalState(config)
      baseline = await takeGlobalStateSnapshot(config)
    },

    async verifyIsolation(): Promise<void> {
      if (!baseline) {
        console.warn('[Test Isolation] No baseline snapshot - skipping verification')
        return
      }

      await verifyIsolation(baseline, config)

      // Reset state after test
      await resetGlobalState(config)
      baseline = null
    },
  }
}

/**
 * Generate a unique test identifier for isolation
 *
 * Use this to create unique DO names, test IDs, etc. to prevent
 * tests from interfering with each other.
 *
 * @param prefix - Optional prefix for the ID
 * @returns A unique test identifier
 *
 * @example
 * ```ts
 * const testId = generateIsolatedTestId('my-test')
 * const doStub = env.DO.get(env.DO.idFromName(testId))
 * ```
 */
export function generateIsolatedTestId(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Track state changes during a test for debugging
 *
 * @param testName - Name of the test being tracked
 * @param fn - The test function to run
 * @returns The result of the test function
 *
 * @example
 * ```ts
 * it('my test', () => trackStateChanges('my test', async () => {
 *   // Test code here
 * }))
 * ```
 */
export async function trackStateChanges<T>(
  testName: string,
  fn: () => Promise<T>
): Promise<T> {
  const before = await takeGlobalStateSnapshot()
  console.log(`[${testName}] State before:`, JSON.stringify(before, null, 2))

  try {
    const result = await fn()

    const after = await takeGlobalStateSnapshot()
    console.log(`[${testName}] State after:`, JSON.stringify(after, null, 2))

    const violations = await verifyIsolation(before, { ...defaultConfig, logViolations: false })
    if (violations.length > 0) {
      console.warn(`[${testName}] State changes detected:`)
      for (const v of violations) {
        console.warn(`  - ${v.type}: ${v.description}`)
      }
    }

    return result
  } catch (error) {
    const after = await takeGlobalStateSnapshot()
    console.log(`[${testName}] State after error:`, JSON.stringify(after, null, 2))
    throw error
  }
}

/**
 * Verify that a test function doesn't leak state
 *
 * Wraps a test function and verifies no global state changes persist.
 *
 * @param fn - The test function
 * @param config - Isolation configuration
 * @returns A wrapped function that verifies isolation
 *
 * @example
 * ```ts
 * it('my isolated test', withIsolation(async () => {
 *   // This test's state changes will be tracked
 * }))
 * ```
 */
export function withIsolation<T>(
  fn: () => Promise<T>,
  config: IsolationConfig = { ...defaultConfig, throwOnViolation: true }
): () => Promise<T> {
  return async () => {
    await resetGlobalState(config)
    const baseline = await takeGlobalStateSnapshot(config)

    try {
      return await fn()
    } finally {
      await verifyIsolation(baseline, config)
      await resetGlobalState(config)
    }
  }
}
