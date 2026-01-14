/**
 * Tests for Multi-Table Coordinator
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  MultiTableCoordinator,
  createMultiTableCoordinator,
  MultiTableWALDemuxer,
  createMultiTableWALDemuxer,
  type TableConfig,
  type TableGroup,
  type ForeignKeyRelation,
  type MultiTableTransaction,
  type CoordinatedSnapshotState,
} from '../multi-table-coordinator'
import { type WALEntry, type WALPosition, WALOperationType, type WALReader } from '../wal-reader'
import { type TableScanner } from '../snapshot-manager'

// ============================================================================
// TEST HELPERS
// ============================================================================

interface TestUser {
  id: string
  name: string
  email: string
  department_id?: string
}

interface TestDepartment {
  id: string
  name: string
  company_id?: string
}

interface TestCompany {
  id: string
  name: string
}

interface TestOrder {
  id: string
  user_id: string
  product_id: string
  quantity: number
}

interface TestProduct {
  id: string
  name: string
  price: number
}

function createMockWALEntry<T>(
  table: string,
  operation: WALOperationType,
  data: T,
  options: Partial<WALEntry<T>> = {}
): WALEntry<T> {
  return {
    position: { sequence: Date.now(), timestamp: Date.now() },
    operation,
    table,
    schema: 'public',
    before: operation === WALOperationType.DELETE ? data : null,
    after: operation === WALOperationType.DELETE ? null : data,
    timestamp: Date.now(),
    ...options,
  }
}

function createMockScanner<T>(records: T[], primaryKey: string = 'id'): TableScanner<T> {
  let currentIndex = 0
  return {
    getTableName: () => 'test_table',
    getRowCount: async () => records.length,
    getPrimaryKey: (record: T) => String((record as Record<string, unknown>)[primaryKey]),
    scanChunk: async (cursor: string | null, chunkSize: number) => {
      const startIndex = cursor ? parseInt(cursor, 10) : 0
      const chunk = records.slice(startIndex, startIndex + chunkSize)
      const nextCursor =
        startIndex + chunkSize < records.length ? String(startIndex + chunkSize) : null
      return {
        records: chunk,
        nextCursor,
        hasMore: nextCursor !== null,
      }
    },
  }
}

function createMockWALReader<T>(entries: WALEntry<T>[]): WALReader<T> {
  let index = 0
  let connected = false
  let position: WALPosition = { sequence: 0 }
  let acknowledgedPosition: WALPosition | null = null

  return {
    connect: async () => {
      connected = true
    },
    disconnect: async () => {
      connected = false
    },
    isConnected: () => connected,
    getPosition: () => position,
    getAcknowledgedPosition: () => acknowledgedPosition,
    acknowledge: async (pos: WALPosition) => {
      acknowledgedPosition = pos
    },
    getState: () => ({
      connected,
      position,
      acknowledgedPosition,
      entriesProcessed: index,
      errorCount: 0,
    }),
    [Symbol.asyncIterator]: async function* () {
      while (index < entries.length) {
        const entry = entries[index++]!
        position = entry.position
        yield entry
      }
    },
  }
}

// ============================================================================
// TESTS - TABLE MANAGEMENT
// ============================================================================

describe('MultiTableCoordinator - Table Management', () => {
  let coordinator: MultiTableCoordinator

  beforeEach(() => {
    coordinator = createMultiTableCoordinator({
      tables: [
        { name: 'users', primaryKey: 'id' },
        { name: 'orders', primaryKey: 'id' },
      ],
    })
  })

  it('should initialize with configured tables', () => {
    expect(coordinator.hasTable('users')).toBe(true)
    expect(coordinator.hasTable('orders')).toBe(true)
    expect(coordinator.hasTable('unknown')).toBe(false)
  })

  it('should add new tables', () => {
    coordinator.addTable({ name: 'products', primaryKey: 'id' })
    expect(coordinator.hasTable('products')).toBe(true)
    expect(coordinator.getTableNames()).toContain('products')
  })

  it('should remove tables', () => {
    expect(coordinator.removeTable('users')).toBe(true)
    expect(coordinator.hasTable('users')).toBe(false)
    expect(coordinator.removeTable('nonexistent')).toBe(false)
  })

  it('should get table configuration', () => {
    const config = coordinator.getTable('users')
    expect(config).toBeDefined()
    expect(config?.name).toBe('users')
    expect(config?.primaryKey).toBe('id')
  })

  it('should list all table names', () => {
    const names = coordinator.getTableNames()
    expect(names).toHaveLength(2)
    expect(names).toContain('users')
    expect(names).toContain('orders')
  })
})

// ============================================================================
// TESTS - GROUP MANAGEMENT
// ============================================================================

describe('MultiTableCoordinator - Group Management', () => {
  let coordinator: MultiTableCoordinator

  beforeEach(() => {
    coordinator = createMultiTableCoordinator({
      tables: [
        { name: 'users', primaryKey: 'id' },
        { name: 'orders', primaryKey: 'id' },
        { name: 'products', primaryKey: 'id' },
      ],
      groups: [
        { id: 'core', name: 'Core Tables', tables: ['users', 'orders'], enabled: true },
      ],
    })
  })

  it('should initialize with configured groups', () => {
    const group = coordinator.getGroup('core')
    expect(group).toBeDefined()
    expect(group?.name).toBe('Core Tables')
    expect(group?.tables).toContain('users')
  })

  it('should add new groups', () => {
    coordinator.addGroup({
      id: 'inventory',
      name: 'Inventory',
      tables: ['products'],
      enabled: true,
    })
    expect(coordinator.getGroup('inventory')).toBeDefined()
  })

  it('should remove groups', () => {
    expect(coordinator.removeGroup('core')).toBe(true)
    expect(coordinator.getGroup('core')).toBeUndefined()
  })

  it('should enable/disable groups', () => {
    expect(coordinator.setGroupEnabled('core', false)).toBe(true)
    expect(coordinator.getGroup('core')?.enabled).toBe(false)

    expect(coordinator.setGroupEnabled('core', true)).toBe(true)
    expect(coordinator.getGroup('core')?.enabled).toBe(true)
  })

  it('should get tables in a group', () => {
    const tables = coordinator.getGroupTables('core')
    expect(tables).toHaveLength(2)
    expect(tables).toContain('users')
    expect(tables).toContain('orders')
  })

  it('should return empty array for unknown group', () => {
    expect(coordinator.getGroupTables('unknown')).toEqual([])
  })
})

// ============================================================================
// TESTS - DEPENDENCY ORDERING
// ============================================================================

describe('MultiTableCoordinator - Dependency Ordering', () => {
  it('should compute correct dependency order for simple FK chain', () => {
    const coordinator = createMultiTableCoordinator({
      tables: [
        {
          name: 'users',
          primaryKey: 'id',
          foreignKeys: [
            { sourceTable: 'users', sourceColumns: ['department_id'], targetTable: 'departments', targetColumns: ['id'] },
          ],
        },
        {
          name: 'departments',
          primaryKey: 'id',
          foreignKeys: [
            { sourceTable: 'departments', sourceColumns: ['company_id'], targetTable: 'companies', targetColumns: ['id'] },
          ],
        },
        { name: 'companies', primaryKey: 'id' },
      ],
    })

    const order = coordinator.getDependencyOrder()

    // Companies should come first (no dependencies)
    // Departments should come second (depends on companies)
    // Users should come last (depends on departments)
    const companiesIdx = order.indexOf('companies')
    const departmentsIdx = order.indexOf('departments')
    const usersIdx = order.indexOf('users')

    expect(companiesIdx).toBeLessThan(departmentsIdx)
    expect(departmentsIdx).toBeLessThan(usersIdx)
  })

  it('should compute correct reverse dependency order', () => {
    const coordinator = createMultiTableCoordinator({
      tables: [
        { name: 'orders', primaryKey: 'id', foreignKeys: [
          { sourceTable: 'orders', sourceColumns: ['user_id'], targetTable: 'users', targetColumns: ['id'] },
        ]},
        { name: 'users', primaryKey: 'id' },
      ],
    })

    const reverseOrder = coordinator.getReverseDependencyOrder()

    // For deletes: orders should be deleted before users
    const ordersIdx = reverseOrder.indexOf('orders')
    const usersIdx = reverseOrder.indexOf('users')

    expect(ordersIdx).toBeLessThan(usersIdx)
  })

  it('should get foreign keys for a table', () => {
    const coordinator = createMultiTableCoordinator({
      tables: [
        {
          name: 'orders',
          primaryKey: 'id',
          foreignKeys: [
            { sourceTable: 'orders', sourceColumns: ['user_id'], targetTable: 'users', targetColumns: ['id'] },
            { sourceTable: 'orders', sourceColumns: ['product_id'], targetTable: 'products', targetColumns: ['id'] },
          ],
        },
        { name: 'users', primaryKey: 'id' },
        { name: 'products', primaryKey: 'id' },
      ],
    })

    const fks = coordinator.getForeignKeys('orders')
    expect(fks).toHaveLength(2)
    expect(fks[0]?.targetTable).toBe('users')
    expect(fks[1]?.targetTable).toBe('products')
  })

  it('should get dependent tables', () => {
    const coordinator = createMultiTableCoordinator({
      tables: [
        { name: 'users', primaryKey: 'id' },
        { name: 'orders', primaryKey: 'id', foreignKeys: [
          { sourceTable: 'orders', sourceColumns: ['user_id'], targetTable: 'users', targetColumns: ['id'] },
        ]},
        { name: 'comments', primaryKey: 'id', foreignKeys: [
          { sourceTable: 'comments', sourceColumns: ['user_id'], targetTable: 'users', targetColumns: ['id'] },
        ]},
      ],
    })

    const dependents = coordinator.getDependentTables('users')
    expect(dependents).toContain('orders')
    expect(dependents).toContain('comments')
    expect(dependents).toHaveLength(2)
  })

  it('should get table dependencies', () => {
    const coordinator = createMultiTableCoordinator({
      tables: [
        { name: 'users', primaryKey: 'id' },
        { name: 'products', primaryKey: 'id' },
        { name: 'orders', primaryKey: 'id', foreignKeys: [
          { sourceTable: 'orders', sourceColumns: ['user_id'], targetTable: 'users', targetColumns: ['id'] },
          { sourceTable: 'orders', sourceColumns: ['product_id'], targetTable: 'products', targetColumns: ['id'] },
        ]},
      ],
    })

    const deps = coordinator.getTableDependencies('orders')
    expect(deps).toContain('users')
    expect(deps).toContain('products')
    expect(deps).toHaveLength(2)
  })

  it('should handle tables with no dependencies', () => {
    const coordinator = createMultiTableCoordinator({
      tables: [
        { name: 'table_a', primaryKey: 'id' },
        { name: 'table_b', primaryKey: 'id' },
        { name: 'table_c', primaryKey: 'id' },
      ],
    })

    const deps = coordinator.getTableDependencies('table_a')
    expect(deps).toEqual([])

    const dependents = coordinator.getDependentTables('table_a')
    expect(dependents).toEqual([])
  })

  it('should respect snapshot priority when ordering', () => {
    const coordinator = createMultiTableCoordinator({
      tables: [
        { name: 'alpha', primaryKey: 'id', snapshotPriority: 3 },
        { name: 'beta', primaryKey: 'id', snapshotPriority: 1 },
        { name: 'gamma', primaryKey: 'id', snapshotPriority: 2 },
      ],
    })

    const order = coordinator.getDependencyOrder()

    // With no FK dependencies, priority should determine order
    expect(order.indexOf('beta')).toBeLessThan(order.indexOf('gamma'))
    expect(order.indexOf('gamma')).toBeLessThan(order.indexOf('alpha'))
  })
})

// ============================================================================
// TESTS - WAL DEMULTIPLEXING
// ============================================================================

describe('MultiTableCoordinator - WAL Demultiplexing', () => {
  it('should route WAL entries to correct table handlers', async () => {
    const userHandler = vi.fn()
    const orderHandler = vi.fn()
    const globalHandler = vi.fn()

    const coordinator = createMultiTableCoordinator({
      tables: [
        { name: 'users', primaryKey: 'id', onChange: userHandler },
        { name: 'orders', primaryKey: 'id', onChange: orderHandler },
      ],
      onChange: globalHandler,
    })

    const userEntry = createMockWALEntry('users', WALOperationType.INSERT, { id: '1', name: 'Alice' })
    const orderEntry = createMockWALEntry('orders', WALOperationType.INSERT, { id: '1', user_id: '1' })

    await coordinator.routeWALEntry(userEntry)
    await coordinator.routeWALEntry(orderEntry)

    expect(userHandler).toHaveBeenCalledTimes(1)
    expect(orderHandler).toHaveBeenCalledTimes(1)
    expect(globalHandler).toHaveBeenCalledTimes(2)
  })

  it('should skip entries for unconfigured tables', async () => {
    const globalHandler = vi.fn()

    const coordinator = createMultiTableCoordinator({
      tables: [{ name: 'users', primaryKey: 'id' }],
      onChange: globalHandler,
    })

    const unknownEntry = createMockWALEntry('unknown', WALOperationType.INSERT, { id: '1' })
    await coordinator.routeWALEntry(unknownEntry)

    expect(globalHandler).not.toHaveBeenCalled()
  })

  it('should call group handlers for tables in enabled groups', async () => {
    const groupHandler = vi.fn()

    const coordinator = createMultiTableCoordinator({
      tables: [
        { name: 'users', primaryKey: 'id' },
        { name: 'products', primaryKey: 'id' },
      ],
      groups: [
        { id: 'core', name: 'Core', tables: ['users'], enabled: true, onChange: groupHandler },
      ],
    })

    const userEntry = createMockWALEntry('users', WALOperationType.INSERT, { id: '1' })
    const productEntry = createMockWALEntry('products', WALOperationType.INSERT, { id: '1' })

    await coordinator.routeWALEntry(userEntry)
    await coordinator.routeWALEntry(productEntry)

    // Group handler should only be called for users (in the group)
    expect(groupHandler).toHaveBeenCalledTimes(1)
    expect(groupHandler).toHaveBeenCalledWith(expect.anything(), 'users')
  })

  it('should not call group handlers for disabled groups', async () => {
    const groupHandler = vi.fn()

    const coordinator = createMultiTableCoordinator({
      tables: [{ name: 'users', primaryKey: 'id' }],
      groups: [
        { id: 'core', name: 'Core', tables: ['users'], enabled: false, onChange: groupHandler },
      ],
    })

    const userEntry = createMockWALEntry('users', WALOperationType.INSERT, { id: '1' })
    await coordinator.routeWALEntry(userEntry)

    expect(groupHandler).not.toHaveBeenCalled()
  })
})

// ============================================================================
// TESTS - TRANSACTION MANAGEMENT
// ============================================================================

describe('MultiTableCoordinator - Transaction Management', () => {
  it('should group changes by transaction', async () => {
    const transactionHandler = vi.fn()

    const coordinator = createMultiTableCoordinator({
      tables: [
        { name: 'users', primaryKey: 'id' },
        { name: 'orders', primaryKey: 'id' },
      ],
      groupByTransaction: true,
      onTransaction: transactionHandler,
    })

    const txId = 'tx-1'
    const entries = [
      createMockWALEntry('users', WALOperationType.INSERT, { id: '1' }, { transactionId: txId }),
      createMockWALEntry('orders', WALOperationType.INSERT, { id: '1', user_id: '1' }, { transactionId: txId }),
    ]

    coordinator.beginTransaction(txId, { sequence: 1 })
    for (const entry of entries) {
      await coordinator.routeWALEntry(entry)
    }
    await coordinator.commitTransaction(txId, { sequence: 2 })

    expect(transactionHandler).toHaveBeenCalledTimes(1)
    const transaction = transactionHandler.mock.calls[0]![0] as MultiTableTransaction
    expect(transaction.transactionId).toBe(txId)
    expect(transaction.changeCount).toBe(2)
    expect(transaction.changesByTable.has('users')).toBe(true)
    expect(transaction.changesByTable.has('orders')).toBe(true)
  })

  it('should track active transactions', () => {
    const coordinator = createMultiTableCoordinator({
      tables: [{ name: 'users', primaryKey: 'id' }],
      groupByTransaction: true,
    })

    expect(coordinator.getPendingTransactionCount()).toBe(0)

    coordinator.beginTransaction('tx-1', { sequence: 1 })
    coordinator.beginTransaction('tx-2', { sequence: 2 })

    expect(coordinator.getPendingTransactionCount()).toBe(2)
    expect(coordinator.getActiveTransactions()).toHaveLength(2)
  })

  it('should rollback transactions', () => {
    const coordinator = createMultiTableCoordinator({
      tables: [{ name: 'users', primaryKey: 'id' }],
      groupByTransaction: true,
    })

    coordinator.beginTransaction('tx-1', { sequence: 1 })
    expect(coordinator.getPendingTransactionCount()).toBe(1)

    coordinator.rollbackTransaction('tx-1')
    expect(coordinator.getPendingTransactionCount()).toBe(0)
  })

  it('should not create duplicate transactions', () => {
    const coordinator = createMultiTableCoordinator({
      tables: [{ name: 'users', primaryKey: 'id' }],
      groupByTransaction: true,
    })

    coordinator.beginTransaction('tx-1', { sequence: 1 })
    coordinator.beginTransaction('tx-1', { sequence: 2 }) // Duplicate - should be ignored

    expect(coordinator.getPendingTransactionCount()).toBe(1)
    const txs = coordinator.getActiveTransactions()
    expect(txs[0]?.startPosition.sequence).toBe(1) // Original position preserved
  })
})

// ============================================================================
// TESTS - REFERENTIAL INTEGRITY
// ============================================================================

describe('MultiTableCoordinator - Referential Integrity', () => {
  it('should validate insert references', () => {
    const coordinator = createMultiTableCoordinator({
      tables: [
        { name: 'users', primaryKey: 'id' },
        { name: 'orders', primaryKey: 'id', foreignKeys: [
          { sourceTable: 'orders', sourceColumns: ['user_id'], targetTable: 'users', targetColumns: ['id'] },
        ]},
      ],
    })

    const existingRecords = new Map<string, Set<string>>([
      ['users', new Set(['1', '2'])],
    ])

    // Valid reference
    const validOrder = { id: '1', user_id: '1' }
    const validMissing = coordinator.validateInsertReferences('orders', validOrder, existingRecords)
    expect(validMissing).toHaveLength(0)

    // Invalid reference
    const invalidOrder = { id: '2', user_id: '999' }
    const invalidMissing = coordinator.validateInsertReferences('orders', invalidOrder, existingRecords)
    expect(invalidMissing).toHaveLength(1)
    expect(invalidMissing[0]?.targetTable).toBe('users')
  })

  it('should allow null FK values for optional relationships', () => {
    const coordinator = createMultiTableCoordinator({
      tables: [
        { name: 'users', primaryKey: 'id' },
        { name: 'orders', primaryKey: 'id', foreignKeys: [
          { sourceTable: 'orders', sourceColumns: ['user_id'], targetTable: 'users', targetColumns: ['id'], optional: true },
        ]},
      ],
    })

    const existingRecords = new Map<string, Set<string>>([
      ['users', new Set(['1'])],
    ])

    const orderWithNullFK = { id: '1', user_id: null }
    const missing = coordinator.validateInsertReferences('orders', orderWithNullFK, existingRecords)
    expect(missing).toHaveLength(0)
  })

  it('should order changes for referential integrity', () => {
    const coordinator = createMultiTableCoordinator({
      tables: [
        { name: 'companies', primaryKey: 'id' },
        { name: 'departments', primaryKey: 'id', foreignKeys: [
          { sourceTable: 'departments', sourceColumns: ['company_id'], targetTable: 'companies', targetColumns: ['id'] },
        ]},
        { name: 'employees', primaryKey: 'id', foreignKeys: [
          { sourceTable: 'employees', sourceColumns: ['department_id'], targetTable: 'departments', targetColumns: ['id'] },
        ]},
      ],
    })

    const changes = [
      { table: 'employees', operation: WALOperationType.INSERT, record: { id: '1' } },
      { table: 'companies', operation: WALOperationType.INSERT, record: { id: '1' } },
      { table: 'departments', operation: WALOperationType.INSERT, record: { id: '1' } },
      { table: 'employees', operation: WALOperationType.DELETE, record: { id: '1' } },
      { table: 'companies', operation: WALOperationType.DELETE, record: { id: '1' } },
    ]

    const ordered = coordinator.orderChangesForReferentialIntegrity(changes)

    // Inserts should be: companies, departments, employees
    const insertIndices = ordered
      .map((c, i) => c.operation === WALOperationType.INSERT ? { table: c.table, index: i } : null)
      .filter(Boolean) as Array<{ table: string; index: number }>

    const companyInsertIdx = insertIndices.find((i) => i.table === 'companies')!.index
    const deptInsertIdx = insertIndices.find((i) => i.table === 'departments')!.index
    const empInsertIdx = insertIndices.find((i) => i.table === 'employees')!.index

    expect(companyInsertIdx).toBeLessThan(deptInsertIdx)
    expect(deptInsertIdx).toBeLessThan(empInsertIdx)

    // Deletes should be: employees, companies (children before parents)
    const deleteIndices = ordered
      .map((c, i) => c.operation === WALOperationType.DELETE ? { table: c.table, index: i } : null)
      .filter(Boolean) as Array<{ table: string; index: number }>

    const empDeleteIdx = deleteIndices.find((i) => i.table === 'employees')!.index
    const companyDeleteIdx = deleteIndices.find((i) => i.table === 'companies')!.index

    expect(empDeleteIdx).toBeLessThan(companyDeleteIdx)
  })
})

// ============================================================================
// TESTS - COORDINATED SNAPSHOTS
// ============================================================================

describe('MultiTableCoordinator - Coordinated Snapshots', () => {
  it('should snapshot tables in dependency order', async () => {
    const snapshotOrder: string[] = []

    const companyRecords: TestCompany[] = [{ id: '1', name: 'Acme' }]
    const deptRecords: TestDepartment[] = [{ id: '1', name: 'Engineering', company_id: '1' }]
    const userRecords: TestUser[] = [{ id: '1', name: 'Alice', email: 'alice@test.com', department_id: '1' }]

    const coordinator = createMultiTableCoordinator({
      tables: [
        {
          name: 'users',
          primaryKey: 'id',
          foreignKeys: [
            { sourceTable: 'users', sourceColumns: ['department_id'], targetTable: 'departments', targetColumns: ['id'] },
          ],
          scanner: {
            getTableName: () => 'users',
            getRowCount: async () => userRecords.length,
            getPrimaryKey: (r: TestUser) => r.id,
            scanChunk: async () => ({ records: userRecords, nextCursor: null, hasMore: false }),
          },
        },
        {
          name: 'departments',
          primaryKey: 'id',
          foreignKeys: [
            { sourceTable: 'departments', sourceColumns: ['company_id'], targetTable: 'companies', targetColumns: ['id'] },
          ],
          scanner: {
            getTableName: () => 'departments',
            getRowCount: async () => deptRecords.length,
            getPrimaryKey: (r: TestDepartment) => r.id,
            scanChunk: async () => ({ records: deptRecords, nextCursor: null, hasMore: false }),
          },
        },
        {
          name: 'companies',
          primaryKey: 'id',
          scanner: {
            getTableName: () => 'companies',
            getRowCount: async () => companyRecords.length,
            getPrimaryKey: (r: TestCompany) => r.id,
            scanChunk: async () => ({ records: companyRecords, nextCursor: null, hasMore: false }),
          },
        },
      ],
      onSnapshotProgress: async (progress) => {
        if (progress.currentTable && !snapshotOrder.includes(progress.currentTable)) {
          snapshotOrder.push(progress.currentTable)
        }
      },
    })

    await coordinator.startCoordinatedSnapshot({
      chunkSize: 100,
      onEvent: async () => {},
    })

    // Verify dependency order: companies -> departments -> users
    expect(snapshotOrder.indexOf('companies')).toBeLessThan(snapshotOrder.indexOf('departments'))
    expect(snapshotOrder.indexOf('departments')).toBeLessThan(snapshotOrder.indexOf('users'))
  })

  it('should capture WAL position before snapshot', async () => {
    const records = [{ id: '1', name: 'Test' }]

    const coordinator = createMultiTableCoordinator({
      tables: [
        {
          name: 'items',
          primaryKey: 'id',
          scanner: {
            getTableName: () => 'items',
            getRowCount: async () => records.length,
            getPrimaryKey: (r) => r.id,
            scanChunk: async () => ({ records, nextCursor: null, hasMore: false }),
          },
        },
      ],
    })

    const mockReader = createMockWALReader<unknown>([])
    await mockReader.connect()

    let capturedState: CoordinatedSnapshotState | null = null

    await coordinator.startCoordinatedSnapshot({
      walReader: mockReader,
      onEvent: async () => {},
    })

    const state = coordinator.getSnapshotState()
    expect(state).toBeDefined()
    expect(state?.walPositionAtStart).toBeDefined()
  })

  it('should report snapshot progress', async () => {
    const records = Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: `Item ${i}` }))
    const progressUpdates: number[] = []

    const coordinator = createMultiTableCoordinator({
      tables: [
        {
          name: 'items',
          primaryKey: 'id',
          scanner: {
            getTableName: () => 'items',
            getRowCount: async () => records.length,
            getPrimaryKey: (r) => r.id,
            scanChunk: async (cursor, chunkSize) => {
              const start = cursor ? parseInt(cursor, 10) : 0
              const chunk = records.slice(start, start + chunkSize)
              const nextCursor = start + chunkSize < records.length ? String(start + chunkSize) : null
              return { records: chunk, nextCursor, hasMore: nextCursor !== null }
            },
          },
        },
      ],
      onSnapshotProgress: async (progress) => {
        progressUpdates.push(progress.percentComplete)
      },
    })

    await coordinator.startCoordinatedSnapshot({
      chunkSize: 10,
      onEvent: async () => {},
    })

    expect(progressUpdates.length).toBeGreaterThan(0)
    expect(progressUpdates[progressUpdates.length - 1]).toBe(100)
  })

  it('should throw error when no tables have scanners', async () => {
    const coordinator = createMultiTableCoordinator({
      tables: [
        { name: 'users', primaryKey: 'id' }, // No scanner
      ],
    })

    await expect(
      coordinator.startCoordinatedSnapshot({ onEvent: async () => {} })
    ).rejects.toThrow('No tables configured for snapshot')
  })

  it('should respect includeInSnapshot flag', async () => {
    const snapshotted: string[] = []

    const coordinator = createMultiTableCoordinator({
      tables: [
        {
          name: 'included',
          primaryKey: 'id',
          includeInSnapshot: true,
          scanner: {
            getTableName: () => 'included',
            getRowCount: async () => 1,
            getPrimaryKey: () => '1',
            scanChunk: async () => ({ records: [{ id: '1' }], nextCursor: null, hasMore: false }),
          },
        },
        {
          name: 'excluded',
          primaryKey: 'id',
          includeInSnapshot: false,
          scanner: {
            getTableName: () => 'excluded',
            getRowCount: async () => 1,
            getPrimaryKey: () => '1',
            scanChunk: async () => ({ records: [{ id: '1' }], nextCursor: null, hasMore: false }),
          },
        },
      ],
    })

    await coordinator.startCoordinatedSnapshot({
      onEvent: async (table) => {
        if (!snapshotted.includes(table)) {
          snapshotted.push(table)
        }
      },
    })

    expect(snapshotted).toContain('included')
    expect(snapshotted).not.toContain('excluded')
  })
})

// ============================================================================
// TESTS - WAL DEMUXER
// ============================================================================

describe('MultiTableWALDemuxer', () => {
  it('should demultiplex entries to correct handlers', async () => {
    const userHandler = vi.fn()
    const orderHandler = vi.fn()

    const entries = [
      createMockWALEntry('users', WALOperationType.INSERT, { id: '1' }),
      createMockWALEntry('orders', WALOperationType.INSERT, { id: '1' }),
      createMockWALEntry('users', WALOperationType.UPDATE, { id: '1' }),
    ]

    const reader = createMockWALReader(entries)
    const demuxer = createMultiTableWALDemuxer({
      reader,
      handlers: new Map([
        ['users', userHandler],
        ['orders', orderHandler],
      ]),
    })

    await reader.connect()
    await demuxer.start()

    expect(userHandler).toHaveBeenCalledTimes(2)
    expect(orderHandler).toHaveBeenCalledTimes(1)
  })

  it('should filter unmatched tables by default', async () => {
    const defaultHandler = vi.fn()

    const entries = [
      createMockWALEntry('unknown', WALOperationType.INSERT, { id: '1' }),
    ]

    const reader = createMockWALReader(entries)
    const demuxer = createMultiTableWALDemuxer({
      reader,
      handlers: new Map(),
      defaultHandler,
      filterUnmatched: true,
    })

    await reader.connect()
    await demuxer.start()

    expect(defaultHandler).not.toHaveBeenCalled()
  })

  it('should call default handler when filterUnmatched is false', async () => {
    const defaultHandler = vi.fn()

    const entries = [
      createMockWALEntry('unknown', WALOperationType.INSERT, { id: '1' }),
    ]

    const reader = createMockWALReader(entries)
    const demuxer = createMultiTableWALDemuxer({
      reader,
      handlers: new Map(),
      defaultHandler,
      filterUnmatched: false,
    })

    await reader.connect()
    await demuxer.start()

    expect(defaultHandler).toHaveBeenCalledTimes(1)
  })

  it('should group entries by transaction', async () => {
    const commitHandler = vi.fn()
    const txId = 'tx-123'

    const entries = [
      createMockWALEntry('users', WALOperationType.INSERT, { id: '1' }, { transactionId: txId }),
      createMockWALEntry('orders', WALOperationType.INSERT, { id: '1' }, { transactionId: txId }),
    ]

    const reader = createMockWALReader(entries)
    const demuxer = createMultiTableWALDemuxer({
      reader,
      handlers: new Map([
        ['users', vi.fn()],
        ['orders', vi.fn()],
      ]),
      groupByTransaction: true,
      onTransactionCommit: commitHandler,
    })

    await reader.connect()
    await demuxer.start()

    expect(commitHandler).toHaveBeenCalledTimes(1)
    expect(commitHandler).toHaveBeenCalledWith(expect.any(Array), txId)

    const [committedEntries] = commitHandler.mock.calls[0]!
    expect(committedEntries).toHaveLength(2)
  })

  it('should stop demultiplexing when stop() is called', async () => {
    const handler = vi.fn()
    let processedCount = 0

    // Create many entries
    const entries = Array.from({ length: 100 }, (_, i) =>
      createMockWALEntry('users', WALOperationType.INSERT, { id: String(i) })
    )

    const reader = createMockWALReader(entries)
    const demuxer = createMultiTableWALDemuxer({
      reader,
      handlers: new Map([
        ['users', async (entry) => {
          processedCount++
          handler(entry)
          if (processedCount >= 10) {
            demuxer.stop()
          }
        }],
      ]),
    })

    await reader.connect()
    await demuxer.start()

    // Should have stopped early
    expect(handler.mock.calls.length).toBeLessThanOrEqual(10)
  })
})

// ============================================================================
// TESTS - PROCESSING WAL READER
// ============================================================================

describe('MultiTableCoordinator - processWALReader', () => {
  it('should process all entries from WAL reader', async () => {
    const handler = vi.fn()

    const entries = [
      createMockWALEntry('users', WALOperationType.INSERT, { id: '1' }),
      createMockWALEntry('users', WALOperationType.UPDATE, { id: '1' }),
      createMockWALEntry('users', WALOperationType.DELETE, { id: '1' }),
    ]

    const reader = createMockWALReader(entries)
    const coordinator = createMultiTableCoordinator({
      tables: [{ name: 'users', primaryKey: 'id', onChange: handler }],
    })

    await reader.connect()
    await coordinator.processWALReader(reader)

    expect(handler).toHaveBeenCalledTimes(3)
  })

  it('should stop processing when stop() is called', async () => {
    const handler = vi.fn()
    let callCount = 0

    const entries = Array.from({ length: 100 }, (_, i) =>
      createMockWALEntry('users', WALOperationType.INSERT, { id: String(i) })
    )

    const reader = createMockWALReader(entries)
    const coordinator = createMultiTableCoordinator({
      tables: [{
        name: 'users',
        primaryKey: 'id',
        onChange: async (entry) => {
          callCount++
          handler(entry)
          if (callCount >= 5) {
            coordinator.stop()
          }
        },
      }],
    })

    await reader.connect()
    await coordinator.processWALReader(reader)

    expect(handler.mock.calls.length).toBeLessThanOrEqual(5)
  })

  it('should flush pending transactions at end of processing', async () => {
    const transactionHandler = vi.fn()
    const txId = 'tx-1'

    const entries = [
      createMockWALEntry('users', WALOperationType.INSERT, { id: '1' }, { transactionId: txId }),
      createMockWALEntry('users', WALOperationType.INSERT, { id: '2' }, { transactionId: txId }),
      // No explicit commit - should flush at end
    ]

    const reader = createMockWALReader(entries)
    const coordinator = createMultiTableCoordinator({
      tables: [{ name: 'users', primaryKey: 'id' }],
      groupByTransaction: true,
      onTransaction: transactionHandler,
    })

    await reader.connect()
    await coordinator.processWALReader(reader)

    // Transaction should be flushed even without explicit commit
    expect(transactionHandler).toHaveBeenCalledTimes(1)
  })
})

// ============================================================================
// TESTS - EDGE CASES
// ============================================================================

describe('MultiTableCoordinator - Edge Cases', () => {
  it('should handle circular foreign key references', () => {
    // This would be a cycle: A -> B -> A
    const coordinator = createMultiTableCoordinator({
      tables: [
        {
          name: 'table_a',
          primaryKey: 'id',
          foreignKeys: [
            { sourceTable: 'table_a', sourceColumns: ['b_id'], targetTable: 'table_b', targetColumns: ['id'] },
          ],
        },
        {
          name: 'table_b',
          primaryKey: 'id',
          foreignKeys: [
            { sourceTable: 'table_b', sourceColumns: ['a_id'], targetTable: 'table_a', targetColumns: ['id'] },
          ],
        },
      ],
    })

    // Should fall back to alphabetical order
    const order = coordinator.getDependencyOrder()
    expect(order).toHaveLength(2)
    expect(order).toContain('table_a')
    expect(order).toContain('table_b')
  })

  it('should handle empty table list', () => {
    const coordinator = createMultiTableCoordinator({ tables: [] })

    expect(coordinator.getTableNames()).toEqual([])
    expect(coordinator.getDependencyOrder()).toEqual([])
  })

  it('should handle FK to non-existent table', () => {
    const coordinator = createMultiTableCoordinator({
      tables: [
        {
          name: 'orders',
          primaryKey: 'id',
          foreignKeys: [
            { sourceTable: 'orders', sourceColumns: ['user_id'], targetTable: 'users', targetColumns: ['id'] },
          ],
        },
        // 'users' table is not configured
      ],
    })

    // Should not throw
    const order = coordinator.getDependencyOrder()
    expect(order).toContain('orders')
  })

  it('should handle composite foreign keys', () => {
    const coordinator = createMultiTableCoordinator({
      tables: [
        { name: 'order_items', primaryKey: ['order_id', 'product_id'], foreignKeys: [
          {
            sourceTable: 'order_items',
            sourceColumns: ['order_id'],
            targetTable: 'orders',
            targetColumns: ['id'],
          },
          {
            sourceTable: 'order_items',
            sourceColumns: ['product_id'],
            targetTable: 'products',
            targetColumns: ['id'],
          },
        ]},
        { name: 'orders', primaryKey: 'id' },
        { name: 'products', primaryKey: 'id' },
      ],
    })

    const deps = coordinator.getTableDependencies('order_items')
    expect(deps).toContain('orders')
    expect(deps).toContain('products')
  })

  it('should handle multiple groups with overlapping tables', async () => {
    const groupAHandler = vi.fn()
    const groupBHandler = vi.fn()

    const coordinator = createMultiTableCoordinator({
      tables: [{ name: 'shared', primaryKey: 'id' }],
      groups: [
        { id: 'group_a', name: 'A', tables: ['shared'], enabled: true, onChange: groupAHandler },
        { id: 'group_b', name: 'B', tables: ['shared'], enabled: true, onChange: groupBHandler },
      ],
    })

    const entry = createMockWALEntry('shared', WALOperationType.INSERT, { id: '1' })
    await coordinator.routeWALEntry(entry)

    // Both group handlers should be called
    expect(groupAHandler).toHaveBeenCalledTimes(1)
    expect(groupBHandler).toHaveBeenCalledTimes(1)
  })
})
