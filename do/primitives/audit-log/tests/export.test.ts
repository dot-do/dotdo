/**
 * AuditLog Export Tests
 *
 * Tests for JSON and CSV export functionality with streaming support
 * and date range filtering.
 *
 * @see dotdo-anwkg - [REFACTOR] Audit log export (JSON, CSV)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createAuditLog, type AuditLog, type AuditEntry } from '../audit-log'
import {
  createAuditLogExporter,
  AuditLogExporter,
  exportToJSON,
  exportToCSV,
  streamJSONExport,
  streamCSVExport,
  DEFAULT_CSV_COLUMNS,
  type JsonExportOptions,
  type CsvExportOptions,
  type DateRangeFilter,
} from '../export'

// =============================================================================
// TEST SETUP
// =============================================================================

function createTestEntry(overrides: {
  actorId?: string
  action?: string
  resourceType?: string
  resourceId?: string
  timestamp?: Date
} = {}) {
  return {
    actor: { userId: overrides.actorId ?? 'user-123' },
    action: overrides.action ?? 'create',
    resource: {
      type: overrides.resourceType ?? 'Document',
      id: overrides.resourceId ?? `doc-${Math.random().toString(36).slice(2)}`,
    },
    timestamp: overrides.timestamp?.toISOString(),
    metadata: {
      ipAddress: '192.168.1.1',
      requestId: `req-${Math.random().toString(36).slice(2)}`,
    },
  }
}

describe('AuditLogExporter', () => {
  let auditLog: AuditLog
  let exporter: AuditLogExporter

  beforeEach(() => {
    auditLog = createAuditLog()
    exporter = createAuditLogExporter(auditLog)
  })

  // ===========================================================================
  // JSON EXPORT TESTS
  // ===========================================================================

  describe('JSON Export', () => {
    it('exports empty audit log as empty array', () => {
      const json = exporter.toJSON()
      expect(JSON.parse(json)).toEqual([])
    })

    it('exports entries as JSON array', () => {
      auditLog.append(createTestEntry({ actorId: 'user-1' }))
      auditLog.append(createTestEntry({ actorId: 'user-2' }))

      const json = exporter.toJSON()
      const parsed = JSON.parse(json)

      expect(parsed).toHaveLength(2)
      expect(parsed[0].actor.userId).toBe('user-1')
      expect(parsed[1].actor.userId).toBe('user-2')
    })

    it('supports pretty print option', () => {
      auditLog.append(createTestEntry())

      const minified = exporter.toJSON({ prettyPrint: false })
      const pretty = exporter.toJSON({ prettyPrint: true })

      expect(minified).not.toContain('\n')
      expect(pretty).toContain('\n')
      expect(pretty).toContain('  ') // indentation
    })

    it('exports with metadata wrapper', () => {
      auditLog.append(createTestEntry())
      auditLog.append(createTestEntry())

      const json = exporter.toJSON({ includeMetadata: true })
      const parsed = JSON.parse(json)

      expect(parsed.metadata).toBeDefined()
      expect(parsed.metadata.version).toBe(1)
      expect(parsed.metadata.entryCount).toBe(2)
      expect(parsed.metadata.format).toBe('json')
      expect(parsed.metadata.exportedAt).toBeDefined()
      expect(parsed.entries).toHaveLength(2)
    })

    it('filters entries by fields option', () => {
      auditLog.append(createTestEntry())

      const json = exporter.toJSON({ fields: ['id', 'actor.userId', 'action.type'] })
      const parsed = JSON.parse(json)

      expect(parsed).toHaveLength(1)
      expect(parsed[0].id).toBeDefined()
      expect(parsed[0].actor).toBeDefined()
      expect(parsed[0].action).toBeDefined()
      // Should not include other fields
      expect(parsed[0].resource).toBeUndefined()
      expect(parsed[0].metadata).toBeUndefined()
    })

    it('excludes fields with excludeFields option', () => {
      auditLog.append(createTestEntry())

      const json = exporter.toJSON({ excludeFields: ['metadata', 'correlation'] })
      const parsed = JSON.parse(json)

      expect(parsed).toHaveLength(1)
      expect(parsed[0].metadata).toBeUndefined()
      expect(parsed[0].id).toBeDefined()
      expect(parsed[0].actor).toBeDefined()
    })
  })

  // ===========================================================================
  // NDJSON EXPORT TESTS
  // ===========================================================================

  describe('NDJSON Export', () => {
    it('exports as newline-delimited JSON', () => {
      auditLog.append(createTestEntry({ actorId: 'user-1' }))
      auditLog.append(createTestEntry({ actorId: 'user-2' }))
      auditLog.append(createTestEntry({ actorId: 'user-3' }))

      const ndjson = exporter.toNDJSON()
      const lines = ndjson.split('\n')

      expect(lines).toHaveLength(3)
      expect(JSON.parse(lines[0]).actor.userId).toBe('user-1')
      expect(JSON.parse(lines[1]).actor.userId).toBe('user-2')
      expect(JSON.parse(lines[2]).actor.userId).toBe('user-3')
    })

    it('exports empty log as empty string', () => {
      const ndjson = exporter.toNDJSON()
      expect(ndjson).toBe('')
    })

    it('each line is valid JSON', () => {
      auditLog.append(createTestEntry())
      auditLog.append(createTestEntry())

      const ndjson = exporter.toNDJSON()
      const lines = ndjson.split('\n')

      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow()
      }
    })
  })

  // ===========================================================================
  // CSV EXPORT TESTS
  // ===========================================================================

  describe('CSV Export', () => {
    it('exports with header row by default', () => {
      auditLog.append(createTestEntry())

      const csv = exporter.toCSV()
      const lines = csv.split('\n')

      expect(lines.length).toBeGreaterThan(1)
      expect(lines[0]).toContain('id')
      expect(lines[0]).toContain('actor.userId')
    })

    it('exports without header when disabled', () => {
      auditLog.append(createTestEntry({ actorId: 'user-1' }))

      const csv = exporter.toCSV({ includeHeader: false })
      const lines = csv.split('\n')

      expect(lines).toHaveLength(1)
      // First line should be data, not header
      expect(lines[0]).not.toBe('id')
    })

    it('uses custom delimiter', () => {
      auditLog.append(createTestEntry())

      const csv = exporter.toCSV({ delimiter: ';' })

      expect(csv).toContain(';')
      expect(csv.split('\n')[0]!.split(';').length).toBeGreaterThan(1)
    })

    it('escapes values containing delimiter', () => {
      auditLog.append({
        actor: { userId: 'user,with,commas' },
        action: 'create',
        resource: { type: 'Doc', id: '1' },
      })

      const csv = exporter.toCSV()

      expect(csv).toContain('"user,with,commas"')
    })

    it('escapes values containing quotes', () => {
      auditLog.append({
        actor: { userId: 'user"with"quotes' },
        action: 'create',
        resource: { type: 'Doc', id: '1' },
      })

      const csv = exporter.toCSV()

      expect(csv).toContain('"user""with""quotes"')
    })

    it('escapes values containing newlines', () => {
      auditLog.append({
        actor: { userId: 'user\nwith\nnewlines' },
        action: 'create',
        resource: { type: 'Doc', id: '1' },
      })

      const csv = exporter.toCSV()

      expect(csv).toContain('"user\nwith\nnewlines"')
    })

    it('uses custom column mapping', () => {
      auditLog.append(createTestEntry())

      const csv = exporter.toCSV({
        columnMapping: {
          'actor.userId': 'User ID',
          'action.type': 'Action Type',
        },
      })
      const header = csv.split('\n')[0]!

      expect(header).toContain('User ID')
      expect(header).toContain('Action Type')
    })

    it('exports specific fields only', () => {
      auditLog.append(createTestEntry())

      const csv = exporter.toCSV({
        fields: ['id', 'actor.userId', 'action.type'],
      })
      const header = csv.split('\n')[0]!
      const columns = header.split(',')

      expect(columns).toHaveLength(3)
      expect(columns).toContain('id')
      expect(columns).toContain('actor.userId')
      expect(columns).toContain('action.type')
    })

    it('formats timestamps based on dateFormat option', () => {
      const testDate = new Date('2024-06-15T10:30:00.000Z')
      auditLog.append(createTestEntry({ timestamp: testDate }))

      // ISO format (default)
      const csvIso = exporter.toCSV({ dateFormat: 'iso' })
      expect(csvIso).toContain('2024-06-15')

      // Epoch format
      const csvEpoch = exporter.toCSV({ dateFormat: 'epoch' })
      expect(csvEpoch).toContain(String(testDate.getTime()))
    })
  })

  // ===========================================================================
  // DATE RANGE FILTER TESTS
  // ===========================================================================

  describe('Date Range Filtering', () => {
    beforeEach(() => {
      // Add entries at different times
      const now = Date.now()
      const oneDay = 24 * 60 * 60 * 1000

      auditLog.append(createTestEntry({
        actorId: 'old-user',
        timestamp: new Date(now - 3 * oneDay)
      }))
      auditLog.append(createTestEntry({
        actorId: 'recent-user-1',
        timestamp: new Date(now - 1 * oneDay)
      }))
      auditLog.append(createTestEntry({
        actorId: 'recent-user-2',
        timestamp: new Date(now - 0.5 * oneDay)
      }))
    })

    it('filters entries by from date', () => {
      const now = Date.now()
      const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000)

      const json = exporter.toJSON({
        dateRange: { from: twoDaysAgo },
      })
      const parsed = JSON.parse(json)

      expect(parsed).toHaveLength(2)
      expect(parsed.every((e: AuditEntry) => e.actor.userId !== 'old-user')).toBe(true)
    })

    it('filters entries by to date', () => {
      const now = Date.now()
      const halfDayAgo = new Date(now - 0.6 * 24 * 60 * 60 * 1000)

      const json = exporter.toJSON({
        dateRange: { to: halfDayAgo },
      })
      const parsed = JSON.parse(json)

      expect(parsed).toHaveLength(2)
      expect(parsed.every((e: AuditEntry) => e.actor.userId !== 'recent-user-2')).toBe(true)
    })

    it('filters entries by from and to date', () => {
      const now = Date.now()
      const oneDay = 24 * 60 * 60 * 1000
      const twoDaysAgo = new Date(now - 2 * oneDay)
      const halfDayAgo = new Date(now - 0.6 * oneDay)

      const json = exporter.toJSON({
        dateRange: { from: twoDaysAgo, to: halfDayAgo },
      })
      const parsed = JSON.parse(json)

      expect(parsed).toHaveLength(1)
      expect(parsed[0].actor.userId).toBe('recent-user-1')
    })

    it('accepts various date formats', () => {
      const now = Date.now()
      const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000

      // As Date object
      const json1 = exporter.toJSON({
        dateRange: { from: new Date(twoDaysAgo) },
      })

      // As ISO string
      const json2 = exporter.toJSON({
        dateRange: { from: new Date(twoDaysAgo).toISOString() },
      })

      // As timestamp number
      const json3 = exporter.toJSON({
        dateRange: { from: twoDaysAgo },
      })

      expect(JSON.parse(json1)).toHaveLength(2)
      expect(JSON.parse(json2)).toHaveLength(2)
      expect(JSON.parse(json3)).toHaveLength(2)
    })

    it('applies date filter to CSV export', () => {
      const now = Date.now()
      const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000)

      const csv = exporter.toCSV({
        dateRange: { from: twoDaysAgo },
      })
      const lines = csv.split('\n')

      // Header + 2 data rows
      expect(lines).toHaveLength(3)
    })
  })

  // ===========================================================================
  // STREAMING EXPORT TESTS
  // ===========================================================================

  describe('Streaming JSON Export', () => {
    beforeEach(() => {
      // Add multiple entries
      for (let i = 0; i < 25; i++) {
        auditLog.append(createTestEntry({ actorId: `user-${i}` }))
      }
    })

    it('streams entries in batches', async () => {
      const chunks: string[] = []
      let totalEntries = 0

      for await (const chunk of exporter.streamJSON({ batchSize: 10 })) {
        chunks.push(chunk.data)
        totalEntries += chunk.entryCount
      }

      expect(chunks.length).toBe(3) // 10 + 10 + 5
      expect(totalEntries).toBe(25)
    })

    it('sets isLast flag correctly', async () => {
      let lastChunk = false
      let chunkCount = 0

      for await (const chunk of exporter.streamJSON({ batchSize: 10 })) {
        chunkCount++
        if (chunk.isLast) {
          lastChunk = true
          expect(chunk.entryCount).toBe(5) // Last batch has 5 entries
        } else {
          expect(chunk.entryCount).toBe(10)
        }
      }

      expect(lastChunk).toBe(true)
      expect(chunkCount).toBe(3)
    })

    it('streams valid NDJSON by default', async () => {
      const allData: string[] = []

      for await (const chunk of exporter.streamJSON({ batchSize: 10 })) {
        allData.push(chunk.data)
      }

      const combined = allData.join('')
      const lines = combined.split('\n').filter((l) => l.trim())

      expect(lines).toHaveLength(25)
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow()
      }
    })

    it('handles empty audit log', async () => {
      const emptyLog = createAuditLog()
      const emptyExporter = createAuditLogExporter(emptyLog)

      const chunks: string[] = []
      for await (const chunk of emptyExporter.streamJSON()) {
        chunks.push(chunk.data)
        expect(chunk.isLast).toBe(true)
        expect(chunk.entryCount).toBe(0)
      }

      expect(chunks).toHaveLength(1)
    })

    it('applies date filter to streaming', async () => {
      const now = Date.now()
      const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000)

      // All entries are recent, so filter should include all
      let totalEntries = 0
      for await (const chunk of exporter.streamJSON({
        batchSize: 10,
        dateRange: { from: oneDayAgo },
      })) {
        totalEntries += chunk.entryCount
      }

      expect(totalEntries).toBe(25)
    })
  })

  describe('Streaming CSV Export', () => {
    beforeEach(() => {
      for (let i = 0; i < 25; i++) {
        auditLog.append(createTestEntry({ actorId: `user-${i}` }))
      }
    })

    it('streams CSV with header in first chunk', async () => {
      const chunks: string[] = []

      for await (const chunk of exporter.streamCSV({ batchSize: 10 })) {
        chunks.push(chunk.data)
      }

      // First chunk should have header
      expect(chunks[0]).toContain('id')
      expect(chunks[0]).toContain('actor.userId')

      // Second chunk should not have header
      expect(chunks[1]!.split('\n')[0]).not.toContain('id,')
    })

    it('concatenated chunks form valid CSV', async () => {
      const chunks: string[] = []

      for await (const chunk of exporter.streamCSV({ batchSize: 10 })) {
        chunks.push(chunk.data)
      }

      const fullCsv = chunks.join('')
      const lines = fullCsv.split('\n').filter((l) => l.trim())

      // Header + 25 data rows
      expect(lines).toHaveLength(26)
    })

    it('handles empty audit log', async () => {
      const emptyLog = createAuditLog()
      const emptyExporter = createAuditLogExporter(emptyLog)

      const chunks: string[] = []
      for await (const chunk of emptyExporter.streamCSV()) {
        chunks.push(chunk.data)
        expect(chunk.isLast).toBe(true)
        expect(chunk.entryCount).toBe(0)
      }

      expect(chunks).toHaveLength(1)
      // Should still have header
      expect(chunks[0]).toContain('id')
    })
  })

  // ===========================================================================
  // EXPORT STATS TESTS
  // ===========================================================================

  describe('Export Stats', () => {
    it('returns correct stats for empty log', () => {
      const stats = exporter.getExportStats()

      expect(stats.totalEntries).toBe(0)
      expect(stats.filteredEntries).toBe(0)
    })

    it('returns correct stats with entries', () => {
      auditLog.append(createTestEntry())
      auditLog.append(createTestEntry())
      auditLog.append(createTestEntry())

      const stats = exporter.getExportStats()

      expect(stats.totalEntries).toBe(3)
      expect(stats.filteredEntries).toBe(3)
    })

    it('returns filtered count with date range', () => {
      const now = Date.now()
      const oneDay = 24 * 60 * 60 * 1000

      auditLog.append(createTestEntry({ timestamp: new Date(now - 3 * oneDay) }))
      auditLog.append(createTestEntry({ timestamp: new Date(now - 1 * oneDay) }))
      auditLog.append(createTestEntry({ timestamp: new Date(now) }))

      const stats = exporter.getExportStats({
        from: new Date(now - 2 * oneDay),
      })

      expect(stats.totalEntries).toBe(3)
      expect(stats.filteredEntries).toBe(2)
      expect(stats.dateRange?.from).toBeDefined()
    })
  })
})

// =============================================================================
// STANDALONE FUNCTION TESTS
// =============================================================================

describe('Standalone Export Functions', () => {
  const createMockEntries = (count: number): AuditEntry[] => {
    const entries: AuditEntry[] = []
    const baseTime = Date.now()

    for (let i = 0; i < count; i++) {
      entries.push({
        id: `entry-${i}`,
        actor: { userId: `user-${i}` },
        action: { type: 'create' },
        resource: { type: 'Document', id: `doc-${i}` },
        timestamp: {
          iso: new Date(baseTime - i * 60000).toISOString(),
          epochMs: baseTime - i * 60000,
        },
        createdAt: new Date(baseTime - i * 60000).toISOString(),
        schemaVersion: 1,
      })
    }

    return entries
  }

  describe('exportToJSON', () => {
    it('exports entries array to JSON', () => {
      const entries = createMockEntries(3)
      const json = exportToJSON(entries)
      const parsed = JSON.parse(json)

      expect(parsed).toHaveLength(3)
    })

    it('applies date filter', () => {
      const entries = createMockEntries(10)
      const json = exportToJSON(entries, {
        dateRange: {
          from: entries[5]!.timestamp!.epochMs,
        },
      })
      const parsed = JSON.parse(json)

      expect(parsed.length).toBeLessThan(10)
    })
  })

  describe('exportToCSV', () => {
    it('exports entries array to CSV', () => {
      const entries = createMockEntries(3)
      const csv = exportToCSV(entries)
      const lines = csv.split('\n')

      expect(lines).toHaveLength(4) // header + 3 rows
    })

    it('applies date filter', () => {
      const entries = createMockEntries(10)
      const csv = exportToCSV(entries, {
        dateRange: {
          from: entries[5]!.timestamp!.epochMs,
        },
      })
      const lines = csv.split('\n')

      expect(lines.length).toBeLessThan(11)
    })
  })

  describe('streamJSONExport', () => {
    it('streams entries in batches', async () => {
      const entries = createMockEntries(25)
      const chunks: string[] = []

      for await (const chunk of streamJSONExport(entries, { batchSize: 10 })) {
        chunks.push(chunk.data)
      }

      expect(chunks).toHaveLength(3)
    })

    it('handles empty array', async () => {
      const chunks: string[] = []

      for await (const chunk of streamJSONExport([], { batchSize: 10 })) {
        chunks.push(chunk.data)
        expect(chunk.isLast).toBe(true)
      }

      expect(chunks).toHaveLength(1)
    })
  })

  describe('streamCSVExport', () => {
    it('streams entries in batches', async () => {
      const entries = createMockEntries(25)
      const chunks: string[] = []

      for await (const chunk of streamCSVExport(entries, { batchSize: 10 })) {
        chunks.push(chunk.data)
      }

      expect(chunks).toHaveLength(3)
    })

    it('handles empty array', async () => {
      const chunks: string[] = []

      for await (const chunk of streamCSVExport([], { batchSize: 10 })) {
        chunks.push(chunk.data)
        expect(chunk.isLast).toBe(true)
      }

      expect(chunks).toHaveLength(1)
    })
  })
})

// =============================================================================
// DEFAULT_CSV_COLUMNS TESTS
// =============================================================================

describe('DEFAULT_CSV_COLUMNS', () => {
  it('includes essential audit fields', () => {
    expect(DEFAULT_CSV_COLUMNS).toContain('id')
    expect(DEFAULT_CSV_COLUMNS).toContain('createdAt')
    expect(DEFAULT_CSV_COLUMNS).toContain('actor.userId')
    expect(DEFAULT_CSV_COLUMNS).toContain('action.type')
    expect(DEFAULT_CSV_COLUMNS).toContain('resource.type')
    expect(DEFAULT_CSV_COLUMNS).toContain('resource.id')
  })

  it('includes timestamp fields', () => {
    expect(DEFAULT_CSV_COLUMNS).toContain('timestamp.iso')
    expect(DEFAULT_CSV_COLUMNS).toContain('timestamp.epochMs')
  })

  it('includes metadata fields', () => {
    expect(DEFAULT_CSV_COLUMNS).toContain('metadata.ipAddress')
    expect(DEFAULT_CSV_COLUMNS).toContain('metadata.requestId')
  })

  it('includes correlation fields', () => {
    expect(DEFAULT_CSV_COLUMNS).toContain('correlation.correlationId')
    expect(DEFAULT_CSV_COLUMNS).toContain('correlation.transactionId')
  })
})
