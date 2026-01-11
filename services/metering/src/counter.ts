/**
 * Usage Counter Module
 *
 * Per-agent usage counters stored in DO SQLite for fast local writes.
 * Supports atomic increment/decrement operations with period-based resets.
 *
 * @module services/metering/counter
 */

import type {
  CounterKey,
  CounterValue,
  CounterStorage,
  BillingPeriod,
  MeteringService,
} from './types'

// ============================================================================
// Counter Key Utilities
// ============================================================================

/**
 * Generate a unique key string from counter key components
 */
export function counterKeyToString(key: CounterKey): string {
  const periodStr = key.periodTimestamp.toISOString().split('T')[0]
  return `${key.agentId}:${key.service}:${key.metric}:${key.period}:${periodStr}`
}

/**
 * Parse a key string back to counter key components
 */
export function stringToCounterKey(keyStr: string): CounterKey {
  const [agentId, service, metric, period, periodStr] = keyStr.split(':')
  return {
    agentId,
    service: service as MeteringService,
    metric,
    period: period as BillingPeriod,
    periodTimestamp: new Date(periodStr),
  }
}

/**
 * Generate a service:metric key for getAll results
 */
export function serviceMetricKey(service: string, metric: string): string {
  return `${service}:${metric}`
}

// ============================================================================
// In-Memory Counter Storage (for testing)
// ============================================================================

/**
 * In-memory implementation of CounterStorage for development/testing
 */
export class InMemoryCounterStorage implements CounterStorage {
  private counters: Map<string, CounterValue> = new Map()
  private mutex: Map<string, Promise<void>> = new Map()

  /**
   * Increment a counter atomically
   */
  async increment(key: CounterKey, amount: number): Promise<number> {
    const keyStr = counterKeyToString(key)

    // Simple mutex implementation for atomicity
    const existing = this.mutex.get(keyStr)
    if (existing) {
      await existing
    }

    let resolve: () => void
    const promise = new Promise<void>((r) => {
      resolve = r
    })
    this.mutex.set(keyStr, promise)

    try {
      const current = this.counters.get(keyStr) || {
        value: 0,
        updatedAt: new Date(),
        incrementCount: 0,
      }

      const newValue: CounterValue = {
        value: current.value + amount,
        updatedAt: new Date(),
        incrementCount: current.incrementCount + 1,
      }

      this.counters.set(keyStr, newValue)
      return newValue.value
    } finally {
      resolve!()
      this.mutex.delete(keyStr)
    }
  }

  /**
   * Get current counter value
   */
  async get(key: CounterKey): Promise<number> {
    const keyStr = counterKeyToString(key)
    const counter = this.counters.get(keyStr)
    return counter?.value ?? 0
  }

  /**
   * Reset a counter (for new billing period)
   */
  async reset(key: CounterKey): Promise<void> {
    const keyStr = counterKeyToString(key)
    this.counters.delete(keyStr)
  }

  /**
   * Get all counters for an agent in a period
   */
  async getAll(agentId: string, period: BillingPeriod): Promise<Map<string, number>> {
    const result = new Map<string, number>()
    const prefix = `${agentId}:`

    for (const [keyStr, counter] of this.counters) {
      if (keyStr.startsWith(prefix)) {
        const parts = keyStr.split(':')
        // Format: agentId:service:metric:period:periodStr
        if (parts[3] === period) {
          const service = parts[1]
          const metric = parts[2]
          result.set(serviceMetricKey(service, metric), counter.value)
        }
      }
    }

    return result
  }

  /**
   * Clear all counters (for testing)
   */
  clear(): void {
    this.counters.clear()
  }

  /**
   * Get all counter values (for debugging)
   */
  getCounters(): Map<string, CounterValue> {
    return new Map(this.counters)
  }
}

// ============================================================================
// SQLite Counter Storage (for DO)
// ============================================================================

/**
 * SQL schema for counters table
 */
export const COUNTERS_SCHEMA = `
CREATE TABLE IF NOT EXISTS usage_counters (
  agent_id TEXT NOT NULL,
  service TEXT NOT NULL,
  metric TEXT NOT NULL,
  period TEXT NOT NULL,
  period_timestamp TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  increment_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, service, metric, period, period_timestamp)
);

CREATE INDEX IF NOT EXISTS idx_counters_agent_period
  ON usage_counters(agent_id, period);
`

/**
 * Database statement result interface
 */
interface DBStatement {
  bind(...args: unknown[]): DBStatement
  first(): { value: number } | null
  all(): { results?: Array<{ service: string; metric: string; value: number }> }
  run(): void
}

/**
 * Database interface for SQLite storage
 */
interface SQLiteDB {
  exec(sql: string): void
  prepare(sql: string): DBStatement
}

/**
 * SQLite-backed counter storage for Durable Objects
 */
export class SQLiteCounterStorage implements CounterStorage {
  constructor(private db: SQLiteDB) {
    // Initialize schema
    this.db.exec(COUNTERS_SCHEMA)
  }

  /**
   * Increment a counter atomically using SQLite UPSERT
   */
  async increment(key: CounterKey, amount: number): Promise<number> {
    const periodStr = key.periodTimestamp.toISOString()
    const now = new Date().toISOString()

    // Use UPSERT for atomic increment
    const sql = `
      INSERT INTO usage_counters (agent_id, service, metric, period, period_timestamp, value, increment_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT (agent_id, service, metric, period, period_timestamp)
      DO UPDATE SET
        value = value + excluded.value,
        increment_count = increment_count + 1,
        updated_at = excluded.updated_at
      RETURNING value
    `

    const result = this.db.prepare(sql).bind(
      key.agentId,
      key.service,
      key.metric,
      key.period,
      periodStr,
      amount,
      now
    ).first()

    return result?.value ?? amount
  }

  /**
   * Get current counter value
   */
  async get(key: CounterKey): Promise<number> {
    const periodStr = key.periodTimestamp.toISOString()

    const sql = `
      SELECT value FROM usage_counters
      WHERE agent_id = ? AND service = ? AND metric = ? AND period = ? AND period_timestamp = ?
    `

    const result = this.db.prepare(sql).bind(
      key.agentId,
      key.service,
      key.metric,
      key.period,
      periodStr
    ).first()

    return result?.value ?? 0
  }

  /**
   * Reset a counter
   */
  async reset(key: CounterKey): Promise<void> {
    const periodStr = key.periodTimestamp.toISOString()

    const sql = `
      DELETE FROM usage_counters
      WHERE agent_id = ? AND service = ? AND metric = ? AND period = ? AND period_timestamp = ?
    `

    this.db.prepare(sql).bind(
      key.agentId,
      key.service,
      key.metric,
      key.period,
      periodStr
    ).run()
  }

  /**
   * Get all counters for an agent in a period
   */
  async getAll(agentId: string, period: BillingPeriod): Promise<Map<string, number>> {
    const sql = `
      SELECT service, metric, value FROM usage_counters
      WHERE agent_id = ? AND period = ?
    `

    const results = this.db.prepare(sql).bind(agentId, period).all()

    const result = new Map<string, number>()
    for (const row of results.results || []) {
      result.set(serviceMetricKey(row.service, row.metric), row.value)
    }

    return result
  }
}

// ============================================================================
// Period Utilities
// ============================================================================

/**
 * Get the start of the current period for a billing period type
 */
export function getPeriodStart(period: BillingPeriod, now: Date = new Date()): Date {
  const date = new Date(now)

  switch (period) {
    case 'hourly':
      date.setUTCMinutes(0, 0, 0)
      return date

    case 'daily':
      date.setUTCHours(0, 0, 0, 0)
      return date

    case 'weekly':
      // Start of week (Sunday = 0)
      const dayOfWeek = date.getUTCDay()
      date.setUTCDate(date.getUTCDate() - dayOfWeek)
      date.setUTCHours(0, 0, 0, 0)
      return date

    case 'monthly':
      date.setUTCDate(1)
      date.setUTCHours(0, 0, 0, 0)
      return date

    default:
      return date
  }
}

/**
 * Get the end of the current period
 */
export function getPeriodEnd(period: BillingPeriod, now: Date = new Date()): Date {
  const start = getPeriodStart(period, now)
  const end = new Date(start)

  switch (period) {
    case 'hourly':
      end.setUTCHours(end.getUTCHours() + 1)
      break
    case 'daily':
      end.setUTCDate(end.getUTCDate() + 1)
      break
    case 'weekly':
      end.setUTCDate(end.getUTCDate() + 7)
      break
    case 'monthly':
      end.setUTCMonth(end.getUTCMonth() + 1)
      break
  }

  return end
}

/**
 * Get the duration of a period in milliseconds
 */
export function getPeriodDuration(period: BillingPeriod): number {
  switch (period) {
    case 'hourly':
      return 60 * 60 * 1000
    case 'daily':
      return 24 * 60 * 60 * 1000
    case 'weekly':
      return 7 * 24 * 60 * 60 * 1000
    case 'monthly':
      // Approximate - actual month length varies
      return 30 * 24 * 60 * 60 * 1000
  }
}
