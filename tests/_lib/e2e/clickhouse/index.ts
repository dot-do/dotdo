/**
 * ACID Test Suite - ClickHouse Analytics Pipeline E2E Module
 *
 * End-to-end testing utilities for the ClickHouse analytics pipeline.
 * Provides helpers for testing the full data flow from DO SQLite
 * through Cloudflare Pipelines to ClickHouse.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 5 E2E Pipeline
 */

// Re-export test utilities from parent modules
export {
  createE2EContext,
  createE2EContextWithConfig,
  skipIfNoE2E,
  skipIfReadOnly,
  skipIfNoCredentials,
  withRetry,
  type E2ETestContext,
  type PipelineEvent,
  type IcebergPartition,
  type PartitionInfo,
} from '../context'

export {
  verifyEventInPipeline,
  waitForEvents,
  measureE2ELatency,
  measurePipelineLatency,
  waitForPipelineSync,
  getPipelineStats,
  verifyIcebergPartition,
  getCurrentPartition,
  waitForPartitionData,
  verifySLACompliance,
  generateCorrelationId,
} from '../pipeline/helpers'

export {
  createPhase5ThingFixture,
  createPhase5ThingBatch,
  createPhase5EventFixture,
  createPhase5EventBatch,
  PHASE5_EVENT_TYPES,
  PHASE5_SLA_TARGETS,
  createPhase5TestNamespace,
  createPhase5CorrelationId,
  sleep,
  type Phase5Event,
  type Phase5ThingFixture,
} from '../../acid/fixtures/phase5'

// ============================================================================
// CLICKHOUSE-SPECIFIC HELPERS
// ============================================================================

import {
  createClickHouseClient,
  createClientFromEnv,
  query,
  queryOne,
  ping,
  tableExists,
  close,
  type ClickHouseClient,
  type ClickHouseConfig,
  type QueryResult,
} from '../../../db/clickhouse'

import type {
  Thing,
  Relationship,
  Action,
  Event,
  SearchChunk,
  Artifact,
  ThingWithReferences,
  SqidsTuple,
  Visibility,
} from '../../../db/clickhouse/types'

// Re-export ClickHouse client utilities
export {
  createClickHouseClient,
  createClientFromEnv,
  query,
  queryOne,
  ping,
  tableExists,
  close,
  type ClickHouseClient,
  type ClickHouseConfig,
  type QueryResult,
}

// Re-export ClickHouse types
export type {
  Thing,
  Relationship,
  Action,
  Event,
  SearchChunk,
  Artifact,
  ThingWithReferences,
  SqidsTuple,
  Visibility,
}

/**
 * ClickHouse test environment configuration
 */
export interface ClickHouseTestEnv {
  CLICKHOUSE_URL: string
  CLICKHOUSE_USER: string
  CLICKHOUSE_PASSWORD: string
  CLICKHOUSE_DATABASE?: string
}

/**
 * Get ClickHouse test environment from process.env
 */
export function getClickHouseTestEnv(): ClickHouseTestEnv | null {
  const url = process.env.CLICKHOUSE_URL
  if (!url) {
    return null
  }

  return {
    CLICKHOUSE_URL: url,
    CLICKHOUSE_USER: process.env.CLICKHOUSE_USER || 'default',
    CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD || '',
    CLICKHOUSE_DATABASE: process.env.CLICKHOUSE_DATABASE,
  }
}

/**
 * Check if ClickHouse is available for testing
 */
export async function isClickHouseAvailable(): Promise<boolean> {
  const env = getClickHouseTestEnv()
  if (!env) {
    return false
  }

  try {
    const client = createClientFromEnv(env)
    const available = await ping(client)
    await close(client)
    return available
  } catch {
    return false
  }
}

/**
 * Create ClickHouse client for tests
 */
export function createTestClickHouseClient(): ClickHouseClient | null {
  const env = getClickHouseTestEnv()
  if (!env) {
    return null
  }

  return createClientFromEnv(env)
}

/**
 * Wait for data to appear in a ClickHouse table
 */
export async function waitForClickHouseData<T>(
  client: ClickHouseClient,
  sql: string,
  options: {
    minCount?: number
    timeout?: number
    pollInterval?: number
  } = {}
): Promise<T[]> {
  const minCount = options.minCount || 1
  const timeout = options.timeout || 120000
  const pollInterval = options.pollInterval || 5000
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      const result = await query<T>(client, { sql })
      if (result.data.length >= minCount) {
        return result.data
      }
    } catch (error) {
      // Query failed, continue polling
      console.debug(`ClickHouse poll failed: ${error}`)
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }

  throw new Error(`Timeout waiting for ClickHouse data after ${timeout}ms`)
}

/**
 * Verify ClickHouse table has expected schema
 */
export async function verifyTableSchema(
  client: ClickHouseClient,
  table: string,
  expectedColumns: string[]
): Promise<boolean> {
  try {
    const result = await query<{ name: string }>(client, {
      sql: `
        SELECT name
        FROM system.columns
        WHERE table = {table:String}
      `,
      params: { table },
    })

    const columnNames = result.data.map((c) => c.name)

    for (const expected of expectedColumns) {
      if (!columnNames.includes(expected)) {
        console.warn(`Missing column ${expected} in table ${table}`)
        return false
      }
    }

    return true
  } catch (error) {
    console.error(`Failed to verify schema for ${table}:`, error)
    return false
  }
}

/**
 * Clean up test data from ClickHouse
 */
export async function cleanupTestData(
  client: ClickHouseClient,
  namespace: string
): Promise<void> {
  const tables = ['Things', 'Relationships', 'Actions', 'Events']

  for (const table of tables) {
    try {
      // SECURITY: table is from hardcoded array, namespace is escaped to prevent SQL injection
      // Using ClickHouse parameterized syntax for the namespace value
      await client.command({
        query: `ALTER TABLE ${table} DELETE WHERE ns = {namespace:String}`,
        query_params: { namespace },
      })
    } catch (error) {
      // Ignore errors - table might not exist or be read-only
      console.debug(`Failed to cleanup ${table} for namespace ${namespace}:`, error)
    }
  }
}
