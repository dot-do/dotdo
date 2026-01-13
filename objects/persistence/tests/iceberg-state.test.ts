/**
 * IcebergStateAdapter Tests (RED Phase - TDD)
 *
 * Tests for the IcebergStateAdapter that provides:
 * - SQLite to Iceberg snapshot serialization
 * - Iceberg snapshot to SQLite restoration
 * - Schema version validation
 * - Checksum integrity verification
 *
 * RED PHASE: All tests should FAIL initially.
 * GREEN PHASE: Implement IcebergStateAdapter to make tests pass.
 * REFACTOR: Optimize implementation.
 *
 * @module objects/persistence/tests/iceberg-state.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IcebergStateAdapter } from '../iceberg-state'

describe('IcebergStateAdapter', () => {
  describe('serialize', () => {
    let sqliteDb: any

    beforeEach(() => {
      // Mock SQLite database
      sqliteDb = {
        exec: vi.fn().mockReturnValue({ toArray: () => [] }),
      }
    })

    it('should serialize SQLite tables to snapshot', async () => {
      const adapter = new IcebergStateAdapter(sqliteDb)
      const snapshot = await adapter.createSnapshot()

      expect(snapshot.tables).toHaveProperty('things')
      expect(snapshot.tables).toHaveProperty('relationships')
      expect(snapshot.tables).toHaveProperty('actions')
      expect(snapshot.tables).toHaveProperty('events')
    })

    it('should include schema version in snapshot', async () => {
      const adapter = new IcebergStateAdapter(sqliteDb, { schemaVersion: 5 })
      const snapshot = await adapter.createSnapshot()
      expect(snapshot.schemaVersion).toBe(5)
    })

    it('should include snapshot sequence number', async () => {
      const adapter = new IcebergStateAdapter(sqliteDb)
      const s1 = await adapter.createSnapshot()
      const s2 = await adapter.createSnapshot()
      expect(s2.sequence).toBe(s1.sequence + 1)
    })

    it('should generate valid Iceberg metadata.json', async () => {
      const adapter = new IcebergStateAdapter(sqliteDb)
      const { metadata } = await adapter.createSnapshot()

      expect(metadata['format-version']).toBe(2)
      expect(metadata['table-uuid']).toBeDefined()
      expect(metadata.schemas).toBeInstanceOf(Array)
      expect(metadata.snapshots).toBeInstanceOf(Array)
    })

    it('should generate manifest list', async () => {
      const adapter = new IcebergStateAdapter(sqliteDb)
      const { manifests } = await adapter.createSnapshot()

      expect(manifests.length).toBeGreaterThan(0)
      manifests.forEach((m) => {
        expect(m.manifest_path).toBeDefined()
        expect(m.added_data_files_count).toBeGreaterThanOrEqual(0)
      })
    })

    it('should serialize table data to Parquet format', async () => {
      const adapter = new IcebergStateAdapter(sqliteDb)
      const { dataFiles } = await adapter.createSnapshot()

      dataFiles.forEach((df) => {
        expect(df.file_format).toBe('PARQUET')
        expect(df.file_path).toMatch(/\.parquet$/)
      })
    })

    it('should calculate checksum for integrity', async () => {
      const adapter = new IcebergStateAdapter(sqliteDb)
      const snapshot = await adapter.createSnapshot()
      expect(snapshot.checksum).toMatch(/^[a-f0-9]{64}$/) // SHA-256
    })
  })

  describe('restore', () => {
    let sqliteDb: any

    beforeEach(() => {
      sqliteDb = {
        exec: vi.fn().mockReturnValue({ toArray: () => [] })
      }
    })

    it('should restore SQLite tables from snapshot', async () => {
      const adapter = new IcebergStateAdapter(sqliteDb)

      // Mock data insertion
      sqliteDb.exec.mockReturnValueOnce({ toArray: () => [{ id: 't1', type: 'Test', data: '{}' }] })
      const snapshot = await adapter.createSnapshot()

      // Clear database
      sqliteDb.exec.mockReturnValueOnce({ toArray: () => [] })

      // Restore
      await adapter.restoreFromSnapshot(snapshot)

      // Verify restore called appropriate methods
      expect(sqliteDb.exec).toHaveBeenCalled()
    })

    it('should verify checksum before restore', async () => {
      const adapter = new IcebergStateAdapter(sqliteDb)
      const snapshot = await adapter.createSnapshot()

      // Corrupt checksum
      snapshot.checksum = 'invalid'

      await expect(adapter.restoreFromSnapshot(snapshot))
        .rejects.toThrow('Checksum mismatch')
    })

    it('should reject mismatched schema version', async () => {
      const adapter = new IcebergStateAdapter(sqliteDb, { schemaVersion: 2 })
      const snapshot = await adapter.createSnapshot()

      const adapter2 = new IcebergStateAdapter(sqliteDb, { schemaVersion: 3 })

      await expect(adapter2.restoreFromSnapshot(snapshot))
        .rejects.toThrow('Schema version mismatch')
    })

    it('should restore within transaction (atomic)', async () => {
      const adapter = new IcebergStateAdapter(sqliteDb)
      const snapshot = await adapter.createSnapshot()

      // Corrupt one table's parquet
      snapshot.tables.things = new ArrayBuffer(0)

      // Should rollback all changes on error
      await expect(adapter.restoreFromSnapshot(snapshot)).rejects.toThrow()

      // Verify ROLLBACK was called
      expect(sqliteDb.exec).toHaveBeenCalledWith('ROLLBACK')
    })

    it('should handle empty tables', async () => {
      const adapter = new IcebergStateAdapter(sqliteDb)
      const snapshot = await adapter.createSnapshot() // Empty tables

      await adapter.restoreFromSnapshot(snapshot)
      // Should succeed without error
    })
  })
})
