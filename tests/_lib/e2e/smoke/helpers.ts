/**
 * ACID Test Suite - Phase 5: Smoke Test Helpers
 *
 * Helper functions for smoke tests that verify deployment health,
 * CRUD operations, clone integrity, and binding availability.
 *
 * Smoke tests should complete quickly (< 60 seconds total) and
 * provide fast feedback on deployment status.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 5 E2E Pipeline
 */

import type { E2ETestContext } from '../context'
import { getE2EConfig, generateTestResourceName } from '../config'

// ============================================================================
// HEALTH CHECK TYPES
// ============================================================================

/**
 * Individual binding status
 */
export interface BindingStatus {
  /** Binding name */
  name: string
  /** Binding type (KV, R2, D1, Pipeline, DO) */
  type: 'kv' | 'r2' | 'd1' | 'pipeline' | 'do' | 'queue' | 'ai'
  /** Whether the binding is available */
  available: boolean
  /** Response time in milliseconds */
  latencyMs: number
  /** Error message if unavailable */
  error?: string
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  /** Overall health status */
  status: 'healthy' | 'degraded' | 'unhealthy'
  /** HTTP status code from health endpoint */
  httpStatus: number
  /** Response time in milliseconds */
  latencyMs: number
  /** Individual binding statuses */
  bindings: BindingStatus[]
  /** Version info if available */
  version?: string
  /** Environment info */
  environment?: string
  /** Error message if unhealthy */
  error?: string
}

/**
 * Thing created for testing
 */
export interface TestThing {
  /** Thing ID */
  id: string
  /** Thing type */
  type: string
  /** Thing data */
  data: Record<string, unknown>
  /** Namespace where Thing was created */
  namespace: string
  /** Cleanup function */
  cleanup: () => Promise<void>
}

/**
 * Clone integrity verification result
 */
export interface CloneIntegrityResult {
  /** Whether source and target match */
  match: boolean
  /** Number of items compared */
  itemsCompared: number
  /** List of differences if any */
  differences?: Array<{
    id: string
    field: string
    sourceValue: unknown
    targetValue: unknown
  }>
  /** Items missing from target */
  missingInTarget?: string[]
  /** Items extra in target (not in source) */
  extraInTarget?: string[]
  /** Error message if verification failed */
  error?: string
}

/**
 * Resource cleanup result
 */
export interface CleanupResult {
  /** Number of resources cleaned up */
  cleaned: number
  /** Number of resources that failed to clean up */
  failed: number
  /** Error messages for failed cleanups */
  errors: string[]
  /** Duration of cleanup in milliseconds */
  durationMs: number
}

// ============================================================================
// HEALTH CHECK HELPERS
// ============================================================================

/**
 * Perform a health check on the deployment
 *
 * @param baseUrl - Base URL of the deployment
 * @param options - Health check options
 * @returns Health check result
 *
 * @example
 * ```ts
 * const result = await healthCheck('https://staging.dotdo.do')
 * expect(result.status).toBe('healthy')
 * expect(result.latencyMs).toBeLessThan(1000)
 * ```
 */
export async function healthCheck(
  baseUrl: string,
  options: {
    timeout?: number
    checkBindings?: boolean
  } = {}
): Promise<HealthCheckResult> {
  const config = getE2EConfig()
  const timeout = options.timeout || config.timeouts.healthCheck
  const checkBindings = options.checkBindings !== false

  const startTime = Date.now()
  const bindings: BindingStatus[] = []

  try {
    // Check main health endpoint
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(`${baseUrl}/api/health`, {
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    const latencyMs = Date.now() - startTime

    if (!response.ok) {
      return {
        status: 'unhealthy',
        httpStatus: response.status,
        latencyMs,
        bindings: [],
        error: `Health endpoint returned ${response.status}`,
      }
    }

    const healthData = await response.json() as {
      status?: string
      version?: string
      environment?: string
      bindings?: Record<string, boolean>
    }

    // Check individual bindings if requested
    if (checkBindings) {
      const bindingChecks = await checkAllBindings(baseUrl, timeout - latencyMs)
      bindings.push(...bindingChecks)
    }

    // Determine overall status
    const allBindingsHealthy = bindings.every((b) => b.available)
    const someBindingsHealthy = bindings.some((b) => b.available)

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy'
    if (!allBindingsHealthy) {
      status = someBindingsHealthy ? 'degraded' : 'unhealthy'
    }

    return {
      status,
      httpStatus: response.status,
      latencyMs,
      bindings,
      version: healthData.version,
      environment: healthData.environment,
    }
  } catch (error) {
    const latencyMs = Date.now() - startTime
    return {
      status: 'unhealthy',
      httpStatus: 0,
      latencyMs,
      bindings: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Check all Cloudflare bindings
 */
async function checkAllBindings(baseUrl: string, timeout: number): Promise<BindingStatus[]> {
  const bindings: BindingStatus[] = []
  const bindingTypes: Array<{ name: string; type: BindingStatus['type']; path: string }> = [
    { name: 'KV', type: 'kv', path: '/api/health/kv' },
    { name: 'R2', type: 'r2', path: '/api/health/r2' },
    { name: 'D1', type: 'd1', path: '/api/health/d1' },
    { name: 'Pipeline', type: 'pipeline', path: '/api/health/pipeline' },
    { name: 'DO', type: 'do', path: '/api/health/do' },
  ]

  // Check bindings in parallel with individual timeouts
  const checks = bindingTypes.map(async ({ name, type, path }) => {
    const startTime = Date.now()
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), Math.min(timeout, 5000))

      const response = await fetch(`${baseUrl}${path}`, {
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      return {
        name,
        type,
        available: response.ok,
        latencyMs: Date.now() - startTime,
        error: response.ok ? undefined : `Status ${response.status}`,
      }
    } catch (error) {
      return {
        name,
        type,
        available: false,
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  })

  const results = await Promise.all(checks)
  bindings.push(...results)

  return bindings
}

/**
 * Verify individual bindings are accessible
 */
export async function verifyBindings(
  ctx: E2ETestContext,
  bindings: Array<'kv' | 'r2' | 'd1' | 'pipeline' | 'do'>
): Promise<BindingStatus[]> {
  const results: BindingStatus[] = []

  for (const binding of bindings) {
    const startTime = Date.now()
    try {
      await ctx.get(`/api/health/${binding}`)
      results.push({
        name: binding.toUpperCase(),
        type: binding,
        available: true,
        latencyMs: Date.now() - startTime,
      })
    } catch (error) {
      results.push({
        name: binding.toUpperCase(),
        type: binding,
        available: false,
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return results
}

// ============================================================================
// THING CRUD HELPERS
// ============================================================================

/**
 * Create a test Thing with automatic cleanup
 *
 * @param ctx - E2E test context
 * @param options - Creation options
 * @returns Test Thing with cleanup function
 *
 * @example
 * ```ts
 * const thing = await createTestThing(ctx, {
 *   type: 'Customer',
 *   data: { name: 'Test Customer' },
 * })
 * // Use thing in tests...
 * await thing.cleanup()
 * ```
 */
export async function createTestThing(
  ctx: E2ETestContext,
  options: {
    namespace?: string
    type?: string
    data?: Record<string, unknown>
    prefix?: string
  } = {}
): Promise<TestThing> {
  const config = getE2EConfig()
  const namespace = options.namespace || ctx.testRunId
  const type = options.type || 'SmokeTestThing'
  const id = generateTestResourceName(options.prefix || 'thing')

  const data = {
    name: `Smoke Test ${id}`,
    createdAt: new Date().toISOString(),
    testRunId: ctx.testRunId,
    ...options.data,
  }

  // Create the Thing
  await ctx.post(`/do/${namespace}/things`, {
    $id: id,
    $type: type,
    ...data,
  })

  // Register for cleanup
  ctx.registerResource(`${namespace}/${id}`)

  return {
    id,
    type,
    data,
    namespace,
    cleanup: async () => {
      try {
        await ctx.post(`/do/${namespace}/things/${id}`, {
          $deleted: true,
        })
      } catch {
        // Ignore cleanup errors - thing might already be deleted
      }
    },
  }
}

/**
 * Read a Thing by ID
 */
export async function readThing(
  ctx: E2ETestContext,
  namespace: string,
  id: string
): Promise<{ id: string; type: string; data: Record<string, unknown> } | null> {
  try {
    const thing = await ctx.get<{
      $id: string
      $type: string
      [key: string]: unknown
    }>(`/do/${namespace}/things/${id}`)

    const { $id, $type, ...data } = thing
    return { id: $id, type: $type, data }
  } catch {
    return null
  }
}

/**
 * Update a Thing
 */
export async function updateThing(
  ctx: E2ETestContext,
  namespace: string,
  id: string,
  updates: Record<string, unknown>
): Promise<boolean> {
  try {
    await ctx.post(`/do/${namespace}/things/${id}`, updates)
    return true
  } catch {
    return false
  }
}

/**
 * Delete a Thing (soft delete)
 */
export async function deleteThing(
  ctx: E2ETestContext,
  namespace: string,
  id: string
): Promise<boolean> {
  try {
    await ctx.post(`/do/${namespace}/things/${id}`, {
      $deleted: true,
    })
    return true
  } catch {
    return false
  }
}

/**
 * Verify Thing exists
 */
export async function thingExists(
  ctx: E2ETestContext,
  namespace: string,
  id: string
): Promise<boolean> {
  const thing = await readThing(ctx, namespace, id)
  return thing !== null
}

// ============================================================================
// CLONE VERIFICATION HELPERS
// ============================================================================

/**
 * Verify clone integrity by comparing source and target state
 *
 * @param ctx - E2E test context
 * @param sourceNs - Source namespace
 * @param targetNs - Target namespace
 * @param options - Verification options
 * @returns Clone integrity result
 */
export async function verifyCloneIntegrity(
  ctx: E2ETestContext,
  sourceNs: string,
  targetNs: string,
  options: {
    compareFields?: string[]
    maxItems?: number
    skipDeleted?: boolean
  } = {}
): Promise<CloneIntegrityResult> {
  const maxItems = options.maxItems || 1000
  const skipDeleted = options.skipDeleted !== false

  try {
    // Get Things from source
    const sourceThings = await ctx.get<Array<{
      $id: string
      $type: string
      $deleted?: boolean
      [key: string]: unknown
    }>>(`/do/${sourceNs}/things?limit=${maxItems}`)

    // Get Things from target
    const targetThings = await ctx.get<Array<{
      $id: string
      $type: string
      $deleted?: boolean
      [key: string]: unknown
    }>>(`/do/${targetNs}/things?limit=${maxItems}`)

    // Filter deleted if requested
    const filteredSource = skipDeleted
      ? sourceThings.filter((t) => !t.$deleted)
      : sourceThings
    const filteredTarget = skipDeleted
      ? targetThings.filter((t) => !t.$deleted)
      : targetThings

    // Build maps for comparison
    const sourceMap = new Map(filteredSource.map((t) => [t.$id, t]))
    const targetMap = new Map(filteredTarget.map((t) => [t.$id, t]))

    const differences: CloneIntegrityResult['differences'] = []
    const missingInTarget: string[] = []
    const extraInTarget: string[] = []

    // Check for items in source but not in target
    for (const [id, sourceThing] of sourceMap) {
      const targetThing = targetMap.get(id)

      if (!targetThing) {
        missingInTarget.push(id)
        continue
      }

      // Compare fields
      const fieldsToCompare = options.compareFields || Object.keys(sourceThing)

      for (const field of fieldsToCompare) {
        if (field.startsWith('$')) continue // Skip system fields

        const sourceValue = sourceThing[field]
        const targetValue = targetThing[field]

        if (JSON.stringify(sourceValue) !== JSON.stringify(targetValue)) {
          differences.push({
            id,
            field,
            sourceValue,
            targetValue,
          })
        }
      }
    }

    // Check for items in target but not in source
    for (const [id] of targetMap) {
      if (!sourceMap.has(id)) {
        extraInTarget.push(id)
      }
    }

    const match = differences.length === 0 &&
      missingInTarget.length === 0 &&
      extraInTarget.length === 0

    return {
      match,
      itemsCompared: filteredSource.length,
      differences: differences.length > 0 ? differences : undefined,
      missingInTarget: missingInTarget.length > 0 ? missingInTarget : undefined,
      extraInTarget: extraInTarget.length > 0 ? extraInTarget : undefined,
    }
  } catch (error) {
    return {
      match: false,
      itemsCompared: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Perform a quick clone and verify integrity
 */
export async function verifyQuickClone(
  ctx: E2ETestContext,
  sourceNs: string
): Promise<{
  success: boolean
  targetNs?: string
  cloneDurationMs?: number
  integrityResult?: CloneIntegrityResult
  cleanup?: () => Promise<void>
  error?: string
}> {
  const targetNs = generateTestResourceName('clone-target')

  try {
    // Perform clone
    const cloneStart = Date.now()
    await ctx.post(`/do/${sourceNs}/clone`, {
      target: targetNs,
      mode: 'atomic',
    })
    const cloneDurationMs = Date.now() - cloneStart

    // Register for cleanup
    ctx.registerResource(targetNs)

    // Verify integrity
    const integrityResult = await verifyCloneIntegrity(ctx, sourceNs, targetNs)

    return {
      success: integrityResult.match,
      targetNs,
      cloneDurationMs,
      integrityResult,
      cleanup: async () => {
        await ctx.deleteTestNamespace(targetNs)
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ============================================================================
// CLEANUP HELPERS
// ============================================================================

/**
 * Clean up test resources by prefix
 *
 * @param ctx - E2E test context
 * @param options - Cleanup options
 * @returns Cleanup result
 */
export async function cleanupTestResources(
  ctx: E2ETestContext,
  options: {
    prefix?: string
    maxAge?: number
    dryRun?: boolean
  } = {}
): Promise<CleanupResult> {
  const config = getE2EConfig()
  const prefix = options.prefix || config.cleanup.prefix
  const maxAge = options.maxAge || config.cleanup.maxAge
  const dryRun = options.dryRun || false

  const startTime = Date.now()
  let cleaned = 0
  let failed = 0
  const errors: string[] = []

  try {
    // Get list of test namespaces
    const namespaces = await ctx.get<Array<{
      name: string
      createdAt: string
    }>>('/test/namespaces')

    const cutoffTime = Date.now() - maxAge * 1000

    for (const ns of namespaces) {
      // Check if namespace matches prefix
      if (!ns.name.startsWith(prefix)) {
        continue
      }

      // Check if namespace is old enough
      const createdAt = new Date(ns.createdAt).getTime()
      if (createdAt > cutoffTime) {
        continue
      }

      if (dryRun) {
        cleaned++
        continue
      }

      try {
        await ctx.deleteTestNamespace(ns.name)
        cleaned++
      } catch (error) {
        failed++
        errors.push(`Failed to cleanup ${ns.name}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }
  } catch (error) {
    errors.push(`Failed to list namespaces: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  return {
    cleaned,
    failed,
    errors,
    durationMs: Date.now() - startTime,
  }
}

/**
 * Verify cleanup was successful
 */
export async function verifyCleanup(
  ctx: E2ETestContext,
  resourceIds: string[]
): Promise<{
  allCleaned: boolean
  remaining: string[]
}> {
  const remaining: string[] = []

  for (const resourceId of resourceIds) {
    try {
      // Try to access the resource
      await ctx.get(`/do/${resourceId}`)
      // If we get here, resource still exists
      remaining.push(resourceId)
    } catch {
      // Resource doesn't exist - good
    }
  }

  return {
    allCleaned: remaining.length === 0,
    remaining,
  }
}

// ============================================================================
// SMOKE TEST UTILITIES
// ============================================================================

/**
 * Run a quick smoke test suite
 */
export async function quickSmokeTest(
  ctx: E2ETestContext
): Promise<{
  passed: boolean
  health: HealthCheckResult
  crud?: {
    create: boolean
    read: boolean
    update: boolean
    delete: boolean
  }
  totalDurationMs: number
  errors: string[]
}> {
  const startTime = Date.now()
  const errors: string[] = []

  // Health check
  const health = await healthCheck(ctx.baseUrl, { checkBindings: true })

  if (health.status === 'unhealthy') {
    return {
      passed: false,
      health,
      totalDurationMs: Date.now() - startTime,
      errors: [health.error || 'Health check failed'],
    }
  }

  // CRUD test
  let crud: { create: boolean; read: boolean; update: boolean; delete: boolean } | undefined

  try {
    // Create
    const thing = await createTestThing(ctx, { prefix: 'smoke' })
    const createSuccess = thing.id !== undefined

    // Read
    const readResult = await readThing(ctx, thing.namespace, thing.id)
    const readSuccess = readResult !== null

    // Update
    const updateSuccess = await updateThing(ctx, thing.namespace, thing.id, {
      updated: true,
    })

    // Delete
    const deleteSuccess = await deleteThing(ctx, thing.namespace, thing.id)

    crud = {
      create: createSuccess,
      read: readSuccess,
      update: updateSuccess,
      delete: deleteSuccess,
    }

    if (!createSuccess) errors.push('CRUD create failed')
    if (!readSuccess) errors.push('CRUD read failed')
    if (!updateSuccess) errors.push('CRUD update failed')
    if (!deleteSuccess) errors.push('CRUD delete failed')
  } catch (error) {
    errors.push(`CRUD test error: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  const passed = health.status !== 'unhealthy' &&
    errors.length === 0 &&
    (crud === undefined || Object.values(crud).every((v) => v))

  return {
    passed,
    health,
    crud,
    totalDurationMs: Date.now() - startTime,
    errors,
  }
}

/**
 * Assert smoke test conditions
 */
export function assertSmokeTestPassed(
  result: Awaited<ReturnType<typeof quickSmokeTest>>
): void {
  if (!result.passed) {
    const errorMessage = [
      'Smoke test failed:',
      `Health: ${result.health.status}`,
      result.crud ? `CRUD: create=${result.crud.create}, read=${result.crud.read}, update=${result.crud.update}, delete=${result.crud.delete}` : '',
      result.errors.length > 0 ? `Errors: ${result.errors.join(', ')}` : '',
    ].filter(Boolean).join('\n')

    throw new Error(errorMessage)
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  // Health check
  healthCheck,
  verifyBindings,

  // CRUD helpers
  createTestThing,
  readThing,
  updateThing,
  deleteThing,
  thingExists,

  // Clone verification
  verifyCloneIntegrity,
  verifyQuickClone,

  // Cleanup
  cleanupTestResources,
  verifyCleanup,

  // Smoke test utilities
  quickSmokeTest,
  assertSmokeTestPassed,
}
