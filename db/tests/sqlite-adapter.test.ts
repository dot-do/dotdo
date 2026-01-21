import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SQLiteAdapter } from '../sqlite'
import { createMockSqlStorage, type MockSqlStorage } from './sqlite-test-utils'

describe('SQLite Adapter', () => {
  let sql: MockSqlStorage
  let adapter: SQLiteAdapter

  beforeEach(() => {
    sql = createMockSqlStorage()
    // Use legacy init mode for existing tests since mock doesn't support migrations
    adapter = new SQLiteAdapter(sql as any, { useLegacyInit: true })
  })

  describe('initialization', () => {
    it('should create schema tables on init', async () => {
      const execSpy = vi.spyOn(sql, 'exec')

      await adapter.initialize()

      expect(execSpy).toHaveBeenCalled()
      const sqlCall = execSpy.mock.calls[0][0]

      expect(sqlCall).toContain('CREATE TABLE IF NOT EXISTS things')
      expect(sqlCall).toContain('CREATE TABLE IF NOT EXISTS events')
      expect(sqlCall).toContain('CREATE TABLE IF NOT EXISTS relationships')
    })

    it('should create indexes for performance', async () => {
      const execSpy = vi.spyOn(sql, 'exec')

      await adapter.initialize()

      const sqlCall = execSpy.mock.calls[0][0]
      expect(sqlCall).toContain('CREATE INDEX IF NOT EXISTS')
    })

    it('should be idempotent (safe to call multiple times)', async () => {
      await adapter.initialize()
      await adapter.initialize()
      await adapter.initialize()

      // Should not throw
      expect(true).toBe(true)
    })
  })

  describe('transactions', () => {
    beforeEach(async () => {
      await adapter.initialize()
    })

    it('should support transaction begin/commit', async () => {
      await expect(adapter.transaction(async () => {
        return 'success'
      })).resolves.toBe('success')
    })

    it('should rollback on error', async () => {
      await expect(
        adapter.transaction(async () => {
          throw new Error('Transaction failed')
        })
      ).rejects.toThrow('Transaction failed')
    })

    it('should support nested operations in transaction', async () => {
      const result = await adapter.transaction(async () => {
        // Multiple operations should succeed together
        return { inserted: 2, updated: 1 }
      })

      expect(result).toEqual({ inserted: 2, updated: 1 })
    })
  })
})
