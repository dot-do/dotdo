/**
 * Global Test Setup
 *
 * This file is included in all test workspaces via setupFiles.
 * It clears static state that accumulates across tests.
 *
 * IMPORTANT: Module-level state in JavaScript persists within the same
 * V8 isolate. This means state from one test can leak to another if not
 * explicitly cleared. This setup ensures test isolation.
 *
 * Global state that needs resetting:
 * - workflows/on.ts: eventHandlers, contextIndex (clearHandlers)
 * - workflows/domain.ts: domainRegistry (clearDomainRegistry)
 * - workflows/schedule-builder.ts: cronCache (clearCronCache)
 * - objects/DOBase.ts: _circuitBreakers (DO._resetTestState)
 *
 * @see dotdo-h0g23 - Issue tracking this fix
 */

import { beforeEach, afterEach, vi } from 'vitest'

// ============================================================================
// Module Import Caching
// ============================================================================

// Cache module references after first successful import to avoid repeated import overhead
interface ModuleCache {
  DOModule: { DO?: { _resetTestState?: () => void } } | null
  workflowsOnModule: { clearHandlers?: () => void } | null
  workflowsDomainModule: { clearDomainRegistry?: () => void } | null
  workflowsScheduleBuilderModule: { clearCronCache?: () => void } | null
}

const moduleCache: ModuleCache = {
  DOModule: null,
  workflowsOnModule: null,
  workflowsDomainModule: null,
  workflowsScheduleBuilderModule: null,
}

let importsAttempted = false

/**
 * Attempt to import all modules that have global state.
 * This is done once per test file to avoid import overhead.
 * Modules that fail to import are set to null and ignored.
 */
async function loadModulesOnce(): Promise<void> {
  if (importsAttempted) return
  importsAttempted = true

  // Set up a shared timeout for all imports
  const IMPORT_TIMEOUT = 2000

  const withTimeout = <T>(promise: Promise<T>): Promise<T | null> =>
    Promise.race([
      promise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), IMPORT_TIMEOUT)),
    ])

  // Import all modules in parallel for efficiency
  const [doModule, onModule, domainModule, scheduleModule] = await Promise.all([
    withTimeout(import('../../objects/DOBase')).catch(() => null),
    withTimeout(import('../../workflows/on')).catch(() => null),
    withTimeout(import('../../workflows/domain')).catch(() => null),
    withTimeout(import('../../workflows/schedule-builder')).catch(() => null),
  ])

  moduleCache.DOModule = doModule
  moduleCache.workflowsOnModule = onModule
  moduleCache.workflowsDomainModule = domainModule
  moduleCache.workflowsScheduleBuilderModule = scheduleModule
}

// ============================================================================
// Global State Reset
// ============================================================================

/**
 * Reset all global state before each test.
 * This ensures complete isolation between tests.
 */
beforeEach(async () => {
  // Load modules on first test
  await loadModulesOnce()

  // Reset DOBase static state (circuit breakers, etc.)
  moduleCache.DOModule?.DO?._resetTestState?.()

  // Reset workflows/on.ts global state (event handlers, context index)
  moduleCache.workflowsOnModule?.clearHandlers?.()

  // Reset workflows/domain.ts global state (domain registry)
  moduleCache.workflowsDomainModule?.clearDomainRegistry?.()

  // Reset workflows/schedule-builder.ts global state (cron cache)
  // Note: clearCronCache re-initializes with COMMON_PATTERNS
  moduleCache.workflowsScheduleBuilderModule?.clearCronCache?.()
})

/**
 * Clean up after each test.
 * Restore any mocked timers to prevent leaks.
 */
afterEach(() => {
  // Restore real timers if fake timers were used
  // This prevents timer state from leaking between tests
  vi.useRealTimers()
})
