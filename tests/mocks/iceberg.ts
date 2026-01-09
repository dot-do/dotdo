/**
 * Mock IcebergReader for testing
 *
 * Provides a test-friendly implementation of the IcebergReader interface
 * that accepts seeded data and tracks read operations for assertions.
 *
 * @module tests/mocks/iceberg
 */

import type {
  IcebergRecord,
  FindFileOptions,
  GetRecordOptions,
  FindFileResult,
  PartitionFilter,
} from '../../db/iceberg/types'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for getRecords batch retrieval
 */
export interface GetRecordsOptions {
  /** Table name */
  table: string
  /** Optional partition filter */
  partition?: Partial<PartitionFilter>
  /** Maximum number of records to return */
  limit?: number
}

/**
 * Tracked read operation for test assertions
 */
export interface TrackedReadOperation {
  /** Type of operation performed */
  type: 'findFile' | 'getRecord' | 'getRecords' | 'getMetadata'
  /** Table accessed */
  table: string
  /** Partition filter used (if any) */
  partition?: Partial<PartitionFilter>
  /** Record ID requested (if any) */
  id?: string
  /** Timestamp of the operation */
  timestamp: number
  /** Additional options passed */
  options?: Record<string, unknown>
}

/**
 * Seeded data structure for MockIcebergReader
 *
 * Maps table names to arrays of records
 */
export type SeededData<T extends IcebergRecord = IcebergRecord> = Record<string, T[]>

/**
 * Options for MockIcebergReader constructor
 */
export interface MockIcebergReaderOptions<T extends IcebergRecord = IcebergRecord> {
  /** Initial seeded data */
  data?: SeededData<T>
  /** Whether to track read operations (default: true) */
  trackReads?: boolean
  /** Simulated latency in milliseconds (default: 0) */
  latencyMs?: number
  /** Whether to throw on missing table (default: false) */
  throwOnMissingTable?: boolean
}

// ============================================================================
// MockIcebergReader Class
// ============================================================================

/**
 * Mock implementation of IcebergReader for testing
 *
 * Supports:
 * - Seeding data via constructor or addRecords()
 * - Partition filtering on getRecord/getRecords
 * - Tracking all read operations for assertions
 * - Simulated latency for timing tests
 *
 * @example Basic usage
 * ```typescript
 * const mock = new MockIcebergReader({
 *   data: {
 *     do_resources: [
 *       { ns: 'payments.do', type: 'Function', id: 'charge', ts: new Date() }
 *     ]
 *   }
 * })
 *
 * const record = await mock.getRecord({
 *   table: 'do_resources',
 *   partition: { ns: 'payments.do', type: 'Function' },
 *   id: 'charge'
 * })
 * ```
 *
 * @example Asserting read operations
 * ```typescript
 * const mock = new MockIcebergReader({ data: {...} })
 *
 * await mock.getRecord({ ... })
 *
 * expect(mock.getReadCount()).toBe(1)
 * expect(mock.getLastRead()).toMatchObject({
 *   type: 'getRecord',
 *   table: 'do_resources'
 * })
 * ```
 */
export class MockIcebergReader<T extends IcebergRecord = IcebergRecord> {
  private data: SeededData<T>
  private readonly trackReads: boolean
  private readonly latencyMs: number
  private readonly throwOnMissingTable: boolean
  private readonly readOperations: TrackedReadOperation[] = []

  constructor(options: MockIcebergReaderOptions<T> = {}) {
    this.data = options.data ?? {}
    this.trackReads = options.trackReads ?? true
    this.latencyMs = options.latencyMs ?? 0
    this.throwOnMissingTable = options.throwOnMissingTable ?? false
  }

  // ==========================================================================
  // Public API - IcebergReader Interface
  // ==========================================================================

  /**
   * Find the data file containing a specific record.
   * Mock implementation returns a synthetic file path based on partition.
   */
  async findFile(options: FindFileOptions): Promise<FindFileResult | null> {
    await this.simulateLatency()
    this.trackRead('findFile', options)

    const { table, partition, id } = options
    const records = this.data[table] ?? []

    const found = records.find(
      (r) => r.ns === partition.ns && r.type === partition.type && r.id === id
    )

    if (!found) {
      return null
    }

    return {
      filePath: `iceberg/${table}/data/ns=${partition.ns}/type=${partition.type}/00001.parquet`,
      fileFormat: 'PARQUET',
      recordCount: 1,
      fileSizeBytes: 4096,
      partition: { ns: partition.ns, type: partition.type },
    }
  }

  /**
   * Get a specific record by partition and id.
   */
  async getRecord<R extends T = T>(options: GetRecordOptions): Promise<R | null> {
    await this.simulateLatency()
    this.trackRead('getRecord', options)

    const { table, partition, id } = options

    if (this.throwOnMissingTable && !this.data[table]) {
      throw new Error(`Table not found: ${table}`)
    }

    const records = this.data[table] ?? []

    const found = records.find(
      (r) => r.ns === partition.ns && r.type === partition.type && r.id === id
    )

    return (found as R) ?? null
  }

  /**
   * Get multiple records with optional partition filtering.
   * This extends the base IcebergReader interface for batch operations.
   */
  async getRecords<R extends T = T>(options: GetRecordsOptions): Promise<R[]> {
    await this.simulateLatency()
    this.trackRead('getRecords', options)

    const { table, partition, limit } = options

    if (this.throwOnMissingTable && !this.data[table]) {
      throw new Error(`Table not found: ${table}`)
    }

    let records = this.data[table] ?? []

    // Apply partition filtering if provided
    if (partition) {
      records = records.filter((r) => {
        if (partition.ns !== undefined && r.ns !== partition.ns) {
          return false
        }
        if (partition.type !== undefined && r.type !== partition.type) {
          return false
        }
        return true
      })
    }

    // Apply limit if provided
    if (limit !== undefined && limit > 0) {
      records = records.slice(0, limit)
    }

    return records as R[]
  }

  /**
   * Clear the metadata cache (no-op in mock).
   */
  clearCache(): void {
    // No-op in mock - included for interface compatibility
  }

  // ==========================================================================
  // Data Management
  // ==========================================================================

  /**
   * Add records to a table.
   */
  addRecords(table: string, records: T[]): void {
    if (!this.data[table]) {
      this.data[table] = []
    }
    this.data[table].push(...records)
  }

  /**
   * Set all data for a table (replaces existing).
   */
  setTableData(table: string, records: T[]): void {
    this.data[table] = records
  }

  /**
   * Clear all data.
   */
  clearData(): void {
    this.data = {}
  }

  /**
   * Get all seeded data (for inspection).
   */
  getData(): SeededData<T> {
    return { ...this.data }
  }

  // ==========================================================================
  // Read Tracking
  // ==========================================================================

  /**
   * Get all tracked read operations.
   */
  getReadOperations(): TrackedReadOperation[] {
    return [...this.readOperations]
  }

  /**
   * Get count of read operations.
   */
  getReadCount(): number {
    return this.readOperations.length
  }

  /**
   * Get the last read operation.
   */
  getLastRead(): TrackedReadOperation | undefined {
    return this.readOperations[this.readOperations.length - 1]
  }

  /**
   * Get read operations filtered by type.
   */
  getReadsByType(type: TrackedReadOperation['type']): TrackedReadOperation[] {
    return this.readOperations.filter((op) => op.type === type)
  }

  /**
   * Get read operations filtered by table.
   */
  getReadsByTable(table: string): TrackedReadOperation[] {
    return this.readOperations.filter((op) => op.table === table)
  }

  /**
   * Clear tracked read operations.
   */
  clearReads(): void {
    this.readOperations.length = 0
  }

  /**
   * Assert that a specific read occurred.
   * Returns true if a matching read was found.
   */
  hasRead(criteria: Partial<TrackedReadOperation>): boolean {
    return this.readOperations.some((op) => {
      for (const [key, value] of Object.entries(criteria)) {
        if (key === 'partition' && value) {
          const partition = op.partition ?? {}
          const expected = value as Partial<PartitionFilter>
          if (expected.ns !== undefined && partition.ns !== expected.ns) return false
          if (expected.type !== undefined && partition.type !== expected.type) return false
        } else if (op[key as keyof TrackedReadOperation] !== value) {
          return false
        }
      }
      return true
    })
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private async simulateLatency(): Promise<void> {
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs))
    }
  }

  private trackRead(
    type: TrackedReadOperation['type'],
    options: FindFileOptions | GetRecordOptions | GetRecordsOptions
  ): void {
    if (!this.trackReads) return

    const operation: TrackedReadOperation = {
      type,
      table: options.table,
      timestamp: Date.now(),
    }

    if ('partition' in options && options.partition) {
      operation.partition = options.partition
    }

    if ('id' in options && options.id) {
      operation.id = options.id
    }

    // Track additional options
    const optionsRecord = options as unknown as Record<string, unknown>
    const { table: _t, partition: _p, id: _i, ...rest } = optionsRecord
    if (Object.keys(rest).length > 0) {
      operation.options = rest
    }

    this.readOperations.push(operation)
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a mock IcebergReader with seeded data.
 *
 * @example
 * ```typescript
 * const mock = createMockIcebergReader({
 *   do_resources: [
 *     { ns: 'payments.do', type: 'Function', id: 'charge', ts: new Date() }
 *   ]
 * })
 * ```
 */
export function createMockIcebergReader<T extends IcebergRecord = IcebergRecord>(
  data: SeededData<T>,
  options?: Omit<MockIcebergReaderOptions<T>, 'data'>
): MockIcebergReader<T> {
  return new MockIcebergReader({ data, ...options })
}
