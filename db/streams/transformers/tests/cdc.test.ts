/**
 * CDC Events Transformer Tests
 *
 * Tests transformation of database change data capture events
 * to the unified event schema.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { transformCdcEvent, type CdcEvent } from '../cdc'

// Mock crypto.randomUUID for deterministic tests
const mockUUID = '123e4567-e89b-12d3-a456-426614174000'
vi.stubGlobal('crypto', {
  randomUUID: vi.fn(() => mockUUID),
})

describe('transformCdcEvent', () => {
  const testNs = 'https://api.example.com/tenant-1'
  const testTimestamp = new Date('2024-06-15T10:30:00Z')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('operation mapping', () => {
    it('maps INSERT operation to db_operation', () => {
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'users',
        primaryKey: 'user-123',
        after: { id: 'user-123', name: 'Alice' },
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.db_operation).toBe('INSERT')
    })

    it('maps UPDATE operation to db_operation', () => {
      const cdc: CdcEvent = {
        operation: 'UPDATE',
        table: 'users',
        primaryKey: 'user-123',
        before: { id: 'user-123', name: 'Alice' },
        after: { id: 'user-123', name: 'Alice Smith' },
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.db_operation).toBe('UPDATE')
    })

    it('maps DELETE operation to db_operation', () => {
      const cdc: CdcEvent = {
        operation: 'DELETE',
        table: 'users',
        primaryKey: 'user-123',
        before: { id: 'user-123', name: 'Alice' },
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.db_operation).toBe('DELETE')
    })
  })

  describe('table and resource mapping', () => {
    it('maps table to db_table and resource_type', () => {
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'orders',
        primaryKey: 'order-456',
        after: { id: 'order-456', total: 99.99 },
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.db_table).toBe('orders')
      expect(event.resource_type).toBe('orders')
    })
  })

  describe('schema mapping', () => {
    it('maps schema to db_name', () => {
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'users',
        schema: 'tenant_db',
        primaryKey: 'user-123',
        after: { id: 'user-123' },
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.db_name).toBe('tenant_db')
    })

    it('sets db_name to null when schema not provided', () => {
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'users',
        primaryKey: 'user-123',
        after: { id: 'user-123' },
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.db_name).toBeNull()
    })
  })

  describe('primary key mapping', () => {
    it('maps string primaryKey to db_row_id and resource_id', () => {
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'users',
        primaryKey: 'user-123',
        after: { id: 'user-123' },
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.db_row_id).toBe('user-123')
      expect(event.resource_id).toBe(`${testNs}/users/user-123`)
    })

    it('maps composite primaryKey (object) to JSON string for db_row_id', () => {
      const compositeKey = { tenant_id: 't1', user_id: 'u1' }
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'tenant_users',
        primaryKey: compositeKey,
        after: { tenant_id: 't1', user_id: 'u1', name: 'Bob' },
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.db_row_id).toBe(JSON.stringify(compositeKey))
      expect(event.resource_id).toBe(`${testNs}/tenant_users/${JSON.stringify(compositeKey)}`)
    })
  })

  describe('before/after mapping', () => {
    it('maps before to db_before for UPDATE', () => {
      const before = { id: 'user-123', name: 'Alice', email: 'alice@old.com' }
      const cdc: CdcEvent = {
        operation: 'UPDATE',
        table: 'users',
        primaryKey: 'user-123',
        before,
        after: { id: 'user-123', name: 'Alice', email: 'alice@new.com' },
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.db_before).toBe(JSON.stringify(before))
    })

    it('maps before to db_before for DELETE', () => {
      const before = { id: 'user-123', name: 'Alice' }
      const cdc: CdcEvent = {
        operation: 'DELETE',
        table: 'users',
        primaryKey: 'user-123',
        before,
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.db_before).toBe(JSON.stringify(before))
    })

    it('maps after to db_after for INSERT', () => {
      const after = { id: 'user-123', name: 'Alice', created_at: '2024-06-15' }
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'users',
        primaryKey: 'user-123',
        after,
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.db_after).toBe(JSON.stringify(after))
    })

    it('maps after to db_after for UPDATE', () => {
      const after = { id: 'user-123', name: 'Alice Smith' }
      const cdc: CdcEvent = {
        operation: 'UPDATE',
        table: 'users',
        primaryKey: 'user-123',
        before: { id: 'user-123', name: 'Alice' },
        after,
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.db_after).toBe(JSON.stringify(after))
    })

    it('sets db_before to null for INSERT (no before state)', () => {
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'users',
        primaryKey: 'user-123',
        after: { id: 'user-123' },
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.db_before).toBeNull()
    })

    it('sets db_after to null for DELETE (no after state)', () => {
      const cdc: CdcEvent = {
        operation: 'DELETE',
        table: 'users',
        primaryKey: 'user-123',
        before: { id: 'user-123' },
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.db_after).toBeNull()
    })
  })

  describe('transaction fields mapping', () => {
    it('maps transactionId to transaction_id', () => {
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'users',
        primaryKey: 'user-123',
        after: { id: 'user-123' },
        transactionId: 'txn-789',
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.transaction_id).toBe('txn-789')
    })

    it('sets transaction_id to null when not provided', () => {
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'users',
        primaryKey: 'user-123',
        after: { id: 'user-123' },
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.transaction_id).toBeNull()
    })
  })

  describe('lsn mapping', () => {
    it('maps lsn to db_lsn as string', () => {
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'users',
        primaryKey: 'user-123',
        after: { id: 'user-123' },
        lsn: 12345678,
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.db_lsn).toBe('12345678')
    })

    it('sets db_lsn to null when not provided', () => {
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'users',
        primaryKey: 'user-123',
        after: { id: 'user-123' },
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.db_lsn).toBeNull()
    })
  })

  describe('version mapping', () => {
    it('maps version to db_version', () => {
      const cdc: CdcEvent = {
        operation: 'UPDATE',
        table: 'users',
        primaryKey: 'user-123',
        before: { id: 'user-123', name: 'Alice' },
        after: { id: 'user-123', name: 'Alice Smith' },
        version: 5,
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.db_version).toBe(5)
    })

    it('sets db_version to null when not provided', () => {
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'users',
        primaryKey: 'user-123',
        after: { id: 'user-123' },
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.db_version).toBeNull()
    })
  })

  describe('event_type and event_name', () => {
    it('sets event_type to cdc', () => {
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'users',
        primaryKey: 'user-123',
        after: { id: 'user-123' },
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.event_type).toBe('cdc')
    })

    it('sets event_name to {table}.{operation} for INSERT', () => {
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'users',
        primaryKey: 'user-123',
        after: { id: 'user-123' },
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.event_name).toBe('users.INSERT')
    })

    it('sets event_name to {table}.{operation} for UPDATE', () => {
      const cdc: CdcEvent = {
        operation: 'UPDATE',
        table: 'orders',
        primaryKey: 'order-456',
        before: { status: 'pending' },
        after: { status: 'shipped' },
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.event_name).toBe('orders.UPDATE')
    })

    it('sets event_name to {table}.{operation} for DELETE', () => {
      const cdc: CdcEvent = {
        operation: 'DELETE',
        table: 'sessions',
        primaryKey: 'sess-789',
        before: { id: 'sess-789' },
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.event_name).toBe('sessions.DELETE')
    })
  })

  describe('data field mapping', () => {
    it('maps after to data for INSERT', () => {
      const after = { id: 'user-123', name: 'Alice', age: 30 }
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'users',
        primaryKey: 'user-123',
        after,
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.data).toEqual(after)
    })

    it('maps after to data for UPDATE', () => {
      const after = { id: 'user-123', name: 'Alice Smith' }
      const cdc: CdcEvent = {
        operation: 'UPDATE',
        table: 'users',
        primaryKey: 'user-123',
        before: { id: 'user-123', name: 'Alice' },
        after,
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.data).toEqual(after)
    })

    it('maps before to data for DELETE (fallback)', () => {
      const before = { id: 'user-123', name: 'Alice' }
      const cdc: CdcEvent = {
        operation: 'DELETE',
        table: 'users',
        primaryKey: 'user-123',
        before,
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.data).toEqual(before)
    })
  })

  describe('core identity fields', () => {
    it('generates unique id using crypto.randomUUID', () => {
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'users',
        primaryKey: 'user-123',
        after: { id: 'user-123' },
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.id).toBe(mockUUID)
      expect(crypto.randomUUID).toHaveBeenCalledTimes(1)
    })

    it('uses provided namespace as ns', () => {
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'users',
        primaryKey: 'user-123',
        after: { id: 'user-123' },
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.ns).toBe(testNs)
    })
  })

  describe('timestamp mapping', () => {
    it('converts Date timestamp to ISO string', () => {
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'users',
        primaryKey: 'user-123',
        after: { id: 'user-123' },
        timestamp: new Date('2024-06-15T10:30:00.000Z'),
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.timestamp).toBe('2024-06-15T10:30:00.000Z')
    })
  })

  describe('db_system default', () => {
    it('sets db_system to sqlite by default', () => {
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'users',
        primaryKey: 'user-123',
        after: { id: 'user-123' },
        timestamp: testTimestamp,
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.db_system).toBe('sqlite')
    })

    it('uses provided dbSystem when specified', () => {
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'users',
        primaryKey: 'user-123',
        after: { id: 'user-123' },
        timestamp: testTimestamp,
        dbSystem: 'postgres',
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.db_system).toBe('postgres')
    })
  })

  describe('full transformation integration', () => {
    it('transforms a complete INSERT CDC event', () => {
      const cdc: CdcEvent = {
        operation: 'INSERT',
        table: 'customers',
        schema: 'public',
        primaryKey: 'cust-001',
        after: { id: 'cust-001', name: 'Acme Corp', tier: 'enterprise' },
        transactionId: 'txn-123',
        lsn: 98765,
        version: 1,
        timestamp: new Date('2024-06-15T14:30:00.000Z'),
        dbSystem: 'postgres',
      }

      const event = transformCdcEvent(cdc, testNs)

      // Core identity
      expect(event.id).toBe(mockUUID)
      expect(event.event_type).toBe('cdc')
      expect(event.event_name).toBe('customers.INSERT')
      expect(event.ns).toBe(testNs)

      // Database CDC fields
      expect(event.db_system).toBe('postgres')
      expect(event.db_name).toBe('public')
      expect(event.db_table).toBe('customers')
      expect(event.db_operation).toBe('INSERT')
      expect(event.db_row_id).toBe('cust-001')
      expect(event.db_lsn).toBe('98765')
      expect(event.db_version).toBe(1)
      expect(event.db_before).toBeNull()
      expect(event.db_after).toBe(JSON.stringify(cdc.after))

      // Resource fields
      expect(event.resource_type).toBe('customers')
      expect(event.resource_id).toBe(`${testNs}/customers/cust-001`)

      // Other fields
      expect(event.transaction_id).toBe('txn-123')
      expect(event.timestamp).toBe('2024-06-15T14:30:00.000Z')
      expect(event.data).toEqual(cdc.after)
    })

    it('transforms a complete UPDATE CDC event', () => {
      const before = { id: 'user-123', status: 'active', updated_at: '2024-06-14' }
      const after = { id: 'user-123', status: 'suspended', updated_at: '2024-06-15' }
      const cdc: CdcEvent = {
        operation: 'UPDATE',
        table: 'users',
        primaryKey: 'user-123',
        before,
        after,
        transactionId: 'txn-456',
        lsn: 100000,
        version: 3,
        timestamp: new Date('2024-06-15T16:00:00.000Z'),
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.event_name).toBe('users.UPDATE')
      expect(event.db_operation).toBe('UPDATE')
      expect(event.db_before).toBe(JSON.stringify(before))
      expect(event.db_after).toBe(JSON.stringify(after))
      expect(event.data).toEqual(after)
    })

    it('transforms a complete DELETE CDC event', () => {
      const before = { id: 'session-xyz', user_id: 'user-123', created_at: '2024-06-01' }
      const cdc: CdcEvent = {
        operation: 'DELETE',
        table: 'sessions',
        primaryKey: 'session-xyz',
        before,
        transactionId: 'txn-789',
        timestamp: new Date('2024-06-15T18:00:00.000Z'),
      }

      const event = transformCdcEvent(cdc, testNs)

      expect(event.event_name).toBe('sessions.DELETE')
      expect(event.db_operation).toBe('DELETE')
      expect(event.db_before).toBe(JSON.stringify(before))
      expect(event.db_after).toBeNull()
      expect(event.data).toEqual(before)
    })
  })
})
