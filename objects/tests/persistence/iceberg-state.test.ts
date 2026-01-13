// objects/tests/persistence/iceberg-state.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IcebergStateAdapter } from '../../persistence/iceberg-state'

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
})
