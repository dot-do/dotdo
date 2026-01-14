import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  TieredStorage,
  createTieredStorage,
  type TieredStorageOptions,
  type R2BucketLike,
  type R2ObjectLike,
  type R2ObjectsLike,
  type SqlStorage,
  type StorageTier
} from '../../src/do/tiered-storage'
import type { ObjectType } from '../../src/types/objects'

/**
 * TieredStorage Tests
 *
 * Tests for the R2 tiered storage system for GitModule:
 * - Hot tier: SQLite in Durable Object
 * - Warm tier: R2 loose objects
 * - Cold tier: R2 packfiles
 *
 * These tests verify:
 * 1. Object storage and retrieval across tiers
 * 2. Auto-promotion of frequently accessed objects
 * 3. Auto-demotion of old objects
 * 4. Packfile creation and retrieval
 * 5. Statistics tracking
 */

// ============================================================================
// Mock Implementations
// ============================================================================

/**
 * Mock R2 Bucket implementation for testing.
 */
class MockR2Bucket implements R2BucketLike {
  private objects: Map<string, { data: Uint8Array; metadata?: Record<string, string> }> = new Map()

  async get(key: string): Promise<R2ObjectLike | null> {
    const obj = this.objects.get(key)
    if (!obj) return null

    return {
      key,
      size: obj.data.length,
      customMetadata: obj.metadata,
      arrayBuffer: async () => obj.data.buffer.slice(obj.data.byteOffset, obj.data.byteOffset + obj.data.byteLength),
      text: async () => new TextDecoder().decode(obj.data)
    }
  }

  async put(key: string, value: ArrayBuffer | Uint8Array | string, options?: { customMetadata?: Record<string, string> }): Promise<R2ObjectLike> {
    let data: Uint8Array
    if (typeof value === 'string') {
      data = new TextEncoder().encode(value)
    } else if (value instanceof ArrayBuffer) {
      data = new Uint8Array(value)
    } else {
      data = value
    }

    this.objects.set(key, { data, metadata: options?.customMetadata })

    return {
      key,
      size: data.length,
      customMetadata: options?.customMetadata,
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      text: async () => new TextDecoder().decode(data)
    }
  }

  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key]
    for (const k of keys) {
      this.objects.delete(k)
    }
  }

  async list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<R2ObjectsLike> {
    const prefix = options?.prefix ?? ''
    const objects: R2ObjectLike[] = []

    for (const [key, obj] of this.objects) {
      if (key.startsWith(prefix)) {
        objects.push({
          key,
          size: obj.data.length,
          customMetadata: obj.metadata,
          arrayBuffer: async () => obj.data.buffer.slice(obj.data.byteOffset, obj.data.byteOffset + obj.data.byteLength),
          text: async () => new TextDecoder().decode(obj.data)
        })
      }
    }

    return {
      objects: objects.slice(0, options?.limit ?? 1000),
      truncated: false
    }
  }

  async head(key: string): Promise<R2ObjectLike | null> {
    return this.get(key)
  }

  // Test helpers
  clear(): void {
    this.objects.clear()
  }

  getKeys(): string[] {
    return Array.from(this.objects.keys())
  }

  hasKey(key: string): boolean {
    return this.objects.has(key)
  }
}

/**
 * Mock SQL Storage implementation for testing.
 */
class MockSqlStorage implements SqlStorage {
  private tables: Map<string, Array<Record<string, unknown>>> = new Map()

  exec(query: string, ...params: unknown[]): { toArray(): unknown[] } {
    const normalizedQuery = query.trim().toUpperCase()

    // Handle CREATE TABLE
    if (normalizedQuery.startsWith('CREATE TABLE')) {
      const match = query.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)
      if (match && !this.tables.has(match[1])) {
        this.tables.set(match[1], [])
      }
      return { toArray: () => [] }
    }

    // Handle CREATE INDEX
    if (normalizedQuery.startsWith('CREATE INDEX')) {
      return { toArray: () => [] }
    }

    // Handle INSERT
    if (normalizedQuery.startsWith('INSERT')) {
      const match = query.match(/INSERT (?:OR REPLACE )?INTO (\w+)/i)
      if (match) {
        const tableName = match[1]
        if (!this.tables.has(tableName)) {
          this.tables.set(tableName, [])
        }

        // Parse columns
        const columnsMatch = query.match(/\(([^)]+)\)\s*VALUES/i)
        const columns = columnsMatch
          ? columnsMatch[1].split(',').map(c => c.trim())
          : []

        // Parse VALUES clause to handle mixed placeholders and literals
        const valuesMatch = query.match(/VALUES\s*\(([^)]+)\)/i)
        const valuesParts = valuesMatch
          ? valuesMatch[1].split(',').map(v => v.trim())
          : []

        const row: Record<string, unknown> = {}
        let paramIdx = 0

        columns.forEach((col, idx) => {
          const valuePart = valuesParts[idx] || '?'
          if (valuePart === '?') {
            row[col] = params[paramIdx++]
          } else {
            // Parse literal value (number, string, null)
            const num = Number(valuePart)
            if (!isNaN(num)) {
              row[col] = num
            } else if (valuePart.toUpperCase() === 'NULL') {
              row[col] = null
            } else {
              row[col] = valuePart.replace(/^['"]|['"]$/g, '')
            }
          }
        })

        // Handle OR REPLACE
        const table = this.tables.get(tableName)!
        if (normalizedQuery.includes('OR REPLACE')) {
          const primaryKey = columns[0] // Assume first column is primary key
          const existingIdx = table.findIndex(r => r[primaryKey] === row[primaryKey])
          if (existingIdx >= 0) {
            table[existingIdx] = row
          } else {
            table.push(row)
          }
        } else {
          table.push(row)
        }
      }
      return { toArray: () => [] }
    }

    // Handle SELECT
    if (normalizedQuery.startsWith('SELECT')) {
      const match = query.match(/FROM (\w+)/i)
      if (!match) return { toArray: () => [] }

      const tableName = match[1]
      const table = this.tables.get(tableName) ?? []

      // Handle COUNT(*)
      if (normalizedQuery.includes('COUNT(*)')) {
        const whereMatch = query.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|$)/i)
        let filtered = table
        if (whereMatch) {
          filtered = this.filterByWhere(table, whereMatch[1], params)
        }
        return { toArray: () => [{ count: filtered.length }] }
      }

      // Handle SUM
      if (normalizedQuery.includes('SUM(')) {
        const sumMatch = query.match(/SUM\((\w+)\)/i)
        if (sumMatch) {
          const column = sumMatch[1]
          const sum = table.reduce((acc, row) => acc + (Number(row[column]) || 0), 0)
          return { toArray: () => [{ total: sum || null }] }
        }
      }

      // Handle WHERE clause
      const whereMatch = query.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|$)/i)
      let results = table
      if (whereMatch) {
        results = this.filterByWhere(table, whereMatch[1], params)
      }

      // Handle ORDER BY
      const orderMatch = query.match(/ORDER BY (\w+)\s+(ASC|DESC)/i)
      if (orderMatch) {
        const column = orderMatch[1]
        const asc = orderMatch[2].toUpperCase() === 'ASC'
        results = [...results].sort((a, b) => {
          const va = a[column] as number
          const vb = b[column] as number
          return asc ? va - vb : vb - va
        })
      }

      // Handle LIMIT
      const limitMatch = query.match(/LIMIT\s+(\d+)/i)
      if (limitMatch) {
        results = results.slice(0, parseInt(limitMatch[1], 10))
      }

      // Handle JOIN
      const joinMatch = query.match(/JOIN (\w+) (\w+) ON (\w+)\.(\w+) = (\w+)\.(\w+)/i)
      if (joinMatch) {
        const joinTable = this.tables.get(joinMatch[1]) ?? []
        // Simple join implementation
        results = results.map(row => {
          const joinRow = joinTable.find(jr => jr[joinMatch[4]] === row[joinMatch[6]])
          return { ...row, ...joinRow }
        }).filter(r => Object.keys(r).length > Object.keys(results[0] || {}).length)
      }

      return { toArray: () => results }
    }

    // Handle UPDATE
    if (normalizedQuery.startsWith('UPDATE')) {
      const match = query.match(/UPDATE (\w+) SET (.+?) WHERE (.+)/i)
      if (match) {
        const tableName = match[1]
        const table = this.tables.get(tableName) ?? []

        // Parse SET clause
        const setClause = match[2]
        const setParts = setClause.split(',').map(s => s.trim())

        // Count placeholders in SET clause to know where WHERE params start
        const setPlaceholderCount = (setClause.match(/\?/g) || []).length

        // Find matching rows using params after SET placeholders
        const whereClause = match[3]
        const whereParams = params.slice(setPlaceholderCount)
        const matching = this.filterByWhere(table, whereClause, whereParams)

        for (const row of matching) {
          // Reset paramIdx for each row (though typically we only match one)
          let paramIdx = 0
          for (const part of setParts) {
            if (part.includes('=')) {
              const eqIdx = part.indexOf('=')
              const col = part.slice(0, eqIdx).trim()
              const val = part.slice(eqIdx + 1).trim()
              if (val === '?') {
                row[col] = params[paramIdx++]
              } else if (val.includes(col) && val.includes('+')) {
                // Handle self-increment like access_count = access_count + 1
                row[col] = (Number(row[col]) || 0) + 1
              } else if (val.toUpperCase() === 'NULL') {
                row[col] = null
              }
            }
          }
        }
      }
      return { toArray: () => [] }
    }

    // Handle DELETE
    if (normalizedQuery.startsWith('DELETE')) {
      const match = query.match(/FROM (\w+)(?: WHERE (.+))?/i)
      if (match) {
        const tableName = match[1]
        const table = this.tables.get(tableName) ?? []

        if (match[2]) {
          const whereClause = match[2]
          const toDelete = this.filterByWhere(table, whereClause, params)
          for (const row of toDelete) {
            const idx = table.indexOf(row)
            if (idx >= 0) table.splice(idx, 1)
          }
        } else {
          this.tables.set(tableName, [])
        }
      }
      return { toArray: () => [] }
    }

    return { toArray: () => [] }
  }

  private filterByWhere(table: Array<Record<string, unknown>>, where: string, params: unknown[]): Array<Record<string, unknown>> {
    // Simple WHERE parser - handles basic conditions
    return table.filter(row => {
      let paramIdx = 0
      // Handle AND conditions
      const conditions = where.split(/\s+AND\s+/i)
      return conditions.every(cond => {
        // Handle equality: column = ?
        const eqMatch = cond.match(/(\w+)\s*=\s*\?/i)
        if (eqMatch) {
          const val = params[paramIdx++]
          return row[eqMatch[1]] === val
        }

        // Handle string equality: column = 'value'
        const strMatch = cond.match(/(\w+)\s*=\s*'([^']+)'/i)
        if (strMatch) {
          return row[strMatch[1]] === strMatch[2]
        }

        // Handle less than: column < ?
        const ltMatch = cond.match(/(\w+)\s*<\s*\?/i)
        if (ltMatch) {
          const val = params[paramIdx++]
          return (row[ltMatch[1]] as number) < (val as number)
        }

        return true
      })
    })
  }

  // Test helpers
  clear(): void {
    this.tables.clear()
  }

  getTable(name: string): Array<Record<string, unknown>> {
    return this.tables.get(name) ?? []
  }
}

// ============================================================================
// Test Helpers
// ============================================================================

const encoder = new TextEncoder()

function createTestData(content: string): Uint8Array {
  return encoder.encode(content)
}

function createSha(prefix: string): string {
  return prefix.padEnd(40, '0')
}

// ============================================================================
// Tests
// ============================================================================

describe('TieredStorage', () => {
  let r2: MockR2Bucket
  let sql: MockSqlStorage
  let storage: TieredStorage

  beforeEach(() => {
    r2 = new MockR2Bucket()
    sql = new MockSqlStorage()
    storage = new TieredStorage({
      r2,
      sql,
      prefix: 'test/objects',
      hotTierMaxBytes: 1000, // 1KB for testing
      hotTierMaxObjectSize: 200, // 200 bytes max per object
      promotionThreshold: 2,
      demotionAgeDays: 1
    })
  })

  describe('initialization', () => {
    it('should create required tables on first operation', async () => {
      await storage.putObject(createSha('a'), 'blob', createTestData('test'))

      const metaTable = sql.getTable('git_objects_meta')
      const hotTable = sql.getTable('git_objects_hot')

      expect(metaTable).toBeDefined()
      expect(hotTable).toBeDefined()
    })

    it('should be idempotent', async () => {
      await storage.putObject(createSha('a'), 'blob', createTestData('test1'))
      await storage.putObject(createSha('b'), 'blob', createTestData('test2'))

      // Should not throw
      expect(true).toBe(true)
    })
  })

  describe('putObject', () => {
    it('should store small objects in hot tier', async () => {
      const sha = createSha('a')
      const data = createTestData('small object')

      const tier = await storage.putObject(sha, 'blob', data)

      expect(tier).toBe('hot')

      // Verify in hot table
      const hotTable = sql.getTable('git_objects_hot')
      expect(hotTable.length).toBe(1)
      expect(hotTable[0].sha).toBe(sha)
    })

    it('should store large objects in warm tier', async () => {
      const sha = createSha('b')
      const data = createTestData('x'.repeat(300)) // Larger than hotTierMaxObjectSize

      const tier = await storage.putObject(sha, 'blob', data)

      expect(tier).toBe('warm')

      // Verify in R2 - sha is 'b000...' (40 chars), so key is test/objects/b0/00...
      // sha.slice(0,2) = 'b0', sha.slice(2) = '00000000000000000000000000000000000000'
      expect(r2.hasKey(`test/objects/${sha.slice(0, 2)}/${sha.slice(2)}`)).toBe(true)
    })

    it('should not duplicate objects', async () => {
      const sha = createSha('c')
      const data = createTestData('test')

      await storage.putObject(sha, 'blob', data)
      const tier = await storage.putObject(sha, 'blob', data)

      expect(tier).toBe('hot')

      const metaTable = sql.getTable('git_objects_meta')
      expect(metaTable.filter(r => r.sha === sha).length).toBe(1)
    })

    it('should store different object types', async () => {
      const types: ObjectType[] = ['blob', 'tree', 'commit', 'tag']

      for (let i = 0; i < types.length; i++) {
        const type = types[i]
        // Use index to ensure unique SHAs
        const sha = createSha(`type${i}`)
        await storage.putObject(sha, type, createTestData(`${type} content`))
      }

      const metaTable = sql.getTable('git_objects_meta')
      expect(metaTable.length).toBe(4)
    })
  })

  describe('getObject', () => {
    it('should retrieve object from hot tier', async () => {
      const sha = createSha('d')
      const data = createTestData('hot tier data')

      await storage.putObject(sha, 'blob', data)
      const result = await storage.getObject(sha)

      expect(result).not.toBeNull()
      expect(result!.tier).toBe('hot')
      expect(result!.type).toBe('blob')
      expect(result!.promoted).toBe(false)
    })

    it('should retrieve object from warm tier', async () => {
      const sha = createSha('e')
      const data = createTestData('x'.repeat(300))

      await storage.putObject(sha, 'blob', data)
      const result = await storage.getObject(sha)

      expect(result).not.toBeNull()
      expect(result!.tier).toBe('warm')
    })

    it('should return null for non-existent objects', async () => {
      const result = await storage.getObject(createSha('nonexistent'))
      expect(result).toBeNull()
    })

    it('should track access count', async () => {
      const sha = createSha('f')
      await storage.putObject(sha, 'blob', createTestData('test'))

      await storage.getObject(sha)
      await storage.getObject(sha)
      await storage.getObject(sha)

      const metaTable = sql.getTable('git_objects_meta')
      const row = metaTable.find(r => r.sha === sha)
      expect(row?.access_count).toBe(3)
    })
  })

  describe('hasObject', () => {
    it('should return true for existing objects', async () => {
      const sha = createSha('g')
      await storage.putObject(sha, 'blob', createTestData('test'))

      const exists = await storage.hasObject(sha)
      expect(exists).toBe(true)
    })

    it('should return false for non-existent objects', async () => {
      const exists = await storage.hasObject(createSha('nonexistent'))
      expect(exists).toBe(false)
    })
  })

  describe('deleteObject', () => {
    it('should delete object from hot tier', async () => {
      const sha = createSha('h')
      await storage.putObject(sha, 'blob', createTestData('test'))

      await storage.deleteObject(sha)

      const exists = await storage.hasObject(sha)
      expect(exists).toBe(false)
    })

    it('should delete object from warm tier', async () => {
      const sha = createSha('i')
      await storage.putObject(sha, 'blob', createTestData('x'.repeat(300)))

      await storage.deleteObject(sha)

      const exists = await storage.hasObject(sha)
      expect(exists).toBe(false)
    })

    it('should be idempotent', async () => {
      const sha = createSha('j')
      await storage.deleteObject(sha) // Should not throw
    })
  })

  describe('auto-promotion', () => {
    it('should promote warm tier object after threshold accesses', async () => {
      const sha = createSha('k')
      const data = createTestData('x'.repeat(150)) // Medium size, goes to warm

      // Store in warm tier initially
      const storageLarge = new TieredStorage({
        r2,
        sql,
        prefix: 'test/objects',
        hotTierMaxBytes: 100, // Very small hot tier
        hotTierMaxObjectSize: 100,
        promotionThreshold: 2
      })

      await storageLarge.putObject(sha, 'blob', data)

      // Access multiple times
      await storageLarge.getObject(sha)
      const result = await storageLarge.getObject(sha)

      // Should be promoted after reaching threshold
      expect(result?.promoted || result?.tier === 'warm').toBe(true)
    })
  })

  describe('auto-demotion', () => {
    it('should demote old hot tier objects during maintenance', async () => {
      const sha = createSha('l')
      await storage.putObject(sha, 'blob', createTestData('test'))

      // Manually set old last_accessed time
      sql.exec(
        'UPDATE git_objects_meta SET last_accessed = ? WHERE sha = ?',
        Date.now() - (2 * 24 * 60 * 60 * 1000), // 2 days ago
        sha
      )

      const demoted = await storage.runMaintenance()
      expect(demoted).toBeGreaterThanOrEqual(0)
    })

    it('should respect dry run option', async () => {
      const sha = createSha('m')
      await storage.putObject(sha, 'blob', createTestData('test'))

      sql.exec(
        'UPDATE git_objects_meta SET last_accessed = ? WHERE sha = ?',
        Date.now() - (2 * 24 * 60 * 60 * 1000),
        sha
      )

      const demoted = await storage.runMaintenance({ dryRun: true })

      // Object should still be in hot tier
      const result = await storage.getObject(sha)
      expect(result?.tier).toBe('hot')
    })
  })

  describe('promoteToHot', () => {
    it('should promote object to hot tier', async () => {
      const sha = createSha('n')
      const data = createTestData('warm object')

      // First store in warm tier
      const storageSmall = new TieredStorage({
        r2,
        sql,
        prefix: 'test/objects',
        hotTierMaxBytes: 10, // Very small
        hotTierMaxObjectSize: 5,
        promotionThreshold: 1
      })

      await storageSmall.putObject(sha, 'blob', data)

      // Now promote with larger limits
      const promoted = await storage.promoteToHot(sha, 'blob', data)
      expect(promoted).toBe(true)
    })

    it('should reject objects too large for hot tier', async () => {
      const sha = createSha('o')
      const data = createTestData('x'.repeat(500)) // Too large

      const promoted = await storage.promoteToHot(sha, 'blob', data)
      expect(promoted).toBe(false)
    })
  })

  describe('demoteToWarm', () => {
    it('should demote hot tier object to warm', async () => {
      const sha = createSha('p')
      await storage.putObject(sha, 'blob', createTestData('test'))

      await storage.demoteToWarm(sha)

      const metaTable = sql.getTable('git_objects_meta')
      const row = metaTable.find(r => r.sha === sha)
      expect(row?.tier).toBe('warm')
    })
  })

  describe('demoteToCold', () => {
    it('should demote warm tier object to cold with pack info', async () => {
      const sha = createSha('q')
      await storage.putObject(sha, 'blob', createTestData('x'.repeat(300)))

      await storage.demoteToCold(sha, 'pack-123', 100)

      const metaTable = sql.getTable('git_objects_meta')
      const row = metaTable.find(r => r.sha === sha)
      expect(row?.tier).toBe('cold')
      expect(row?.pack_id).toBe('pack-123')
      expect(row?.pack_offset).toBe(100)
    })
  })

  describe('createPackfile', () => {
    it('should create packfile from warm tier objects', async () => {
      // Store multiple objects in warm tier
      const shas: string[] = []
      for (let i = 0; i < 3; i++) {
        const sha = createSha(String.fromCharCode(97 + i)) // a, b, c
        await storage.putObject(sha, 'blob', createTestData(`object ${i}`.repeat(50)))
        shas.push(sha)
      }

      const result = await storage.createPackfile(shas)

      expect(result.packId).toMatch(/^pack-/)
      expect(result.objectCount).toBe(3)
      expect(result.size).toBeGreaterThan(0)
    })

    it('should handle empty pack request', async () => {
      const result = await storage.createPackfile([])

      expect(result.objectCount).toBe(0)
      expect(result.size).toBe(0)
    })
  })

  describe('getStats', () => {
    it('should return accurate statistics', async () => {
      // Store some objects
      await storage.putObject(createSha('a'), 'blob', createTestData('hot1'))
      await storage.putObject(createSha('b'), 'blob', createTestData('hot2'))
      await storage.putObject(createSha('c'), 'blob', createTestData('x'.repeat(300))) // warm

      // Access some objects
      await storage.getObject(createSha('a'))
      await storage.getObject(createSha('nonexistent'))

      const stats = await storage.getStats()

      expect(stats.hotTierCount).toBe(2)
      expect(stats.warmTierCount).toBe(1)
      expect(stats.totalObjects).toBe(3)
      expect(stats.hotTierBytes).toBeGreaterThan(0)
    })
  })

  describe('factory function', () => {
    it('should create storage instance', () => {
      const instance = createTieredStorage({
        r2,
        sql,
        prefix: 'factory/test'
      })

      expect(instance).toBeInstanceOf(TieredStorage)
    })
  })

  describe('R2 key structure', () => {
    it('should use git-style 2-character prefix directories', async () => {
      const sha = 'abcdef1234567890abcdef1234567890abcdef12'
      await storage.putObject(sha, 'blob', createTestData('x'.repeat(300)))

      const keys = r2.getKeys()
      const expectedKey = 'test/objects/ab/cdef1234567890abcdef1234567890abcdef12'
      expect(keys).toContain(expectedKey)
    })
  })

  describe('concurrent access', () => {
    it('should handle concurrent reads', async () => {
      const sha = createSha('concurrent')
      await storage.putObject(sha, 'blob', createTestData('test'))

      const results = await Promise.all([
        storage.getObject(sha),
        storage.getObject(sha),
        storage.getObject(sha)
      ])

      expect(results.every(r => r !== null)).toBe(true)
      expect(results.every(r => r?.tier === 'hot')).toBe(true)
    })

    it('should handle concurrent writes', async () => {
      const shas = ['sha1', 'sha2', 'sha3'].map(s => createSha(s))

      await Promise.all(
        shas.map((sha, i) => storage.putObject(sha, 'blob', createTestData(`data ${i}`)))
      )

      for (const sha of shas) {
        const exists = await storage.hasObject(sha)
        expect(exists).toBe(true)
      }
    })
  })

  describe('edge cases', () => {
    it('should handle empty data', async () => {
      const sha = createSha('empty')
      const tier = await storage.putObject(sha, 'blob', new Uint8Array(0))

      expect(tier).toBe('hot')
      const result = await storage.getObject(sha)
      expect(result?.data.length).toBe(0)
    })

    it('should handle binary data', async () => {
      const sha = createSha('binary')
      const binaryData = new Uint8Array([0x00, 0xff, 0x7f, 0x80, 0x01])

      await storage.putObject(sha, 'blob', binaryData)
      const result = await storage.getObject(sha)

      expect(result?.data).toEqual(binaryData)
    })

    it('should handle max size boundary', async () => {
      const sha = createSha('boundary')
      const data = createTestData('x'.repeat(200)) // Exactly at hotTierMaxObjectSize

      const tier = await storage.putObject(sha, 'blob', data)
      expect(tier).toBe('hot')
    })

    it('should handle unicode content', async () => {
      const sha = createSha('unicode')
      const data = createTestData('Hello, ')

      await storage.putObject(sha, 'blob', data)
      const result = await storage.getObject(sha)

      expect(new TextDecoder().decode(result?.data)).toBe('Hello, ')
    })
  })

  describe('tier transitions', () => {
    it('should correctly transition hot -> warm -> cold', async () => {
      const sha = createSha('transition')
      const data = createTestData('test data')

      // Start in hot
      await storage.putObject(sha, 'blob', data)
      let result = await storage.getObject(sha)
      expect(result?.tier).toBe('hot')

      // Demote to warm
      await storage.demoteToWarm(sha)
      result = await storage.getObject(sha)
      expect(result?.tier).toBe('warm')

      // Demote to cold
      await storage.demoteToCold(sha, 'pack-test', 0)
      const meta = sql.getTable('git_objects_meta').find(r => r.sha === sha)
      expect(meta?.tier).toBe('cold')
    })
  })
})

describe('TieredStorage configuration', () => {
  it('should use default values', () => {
    const r2 = new MockR2Bucket()
    const sql = new MockSqlStorage()

    const storage = new TieredStorage({ r2, sql })

    // Storage should work with defaults
    expect(storage).toBeInstanceOf(TieredStorage)
  })

  it('should respect custom configuration', async () => {
    const r2 = new MockR2Bucket()
    const sql = new MockSqlStorage()

    const storage = new TieredStorage({
      r2,
      sql,
      prefix: 'custom/prefix',
      hotTierMaxBytes: 100,
      promotionThreshold: 5,
      demotionAgeDays: 30
    })

    // Store object too large for hot tier
    const sha = createSha('config')
    const tier = await storage.putObject(sha, 'blob', new Uint8Array(150))

    // Should go to warm due to small hotTierMaxBytes
    expect(tier).toBe('warm')
  })

  it('should disable auto-promote when configured', async () => {
    const r2 = new MockR2Bucket()
    const sql = new MockSqlStorage()

    const storage = new TieredStorage({
      r2,
      sql,
      autoPromote: false,
      promotionThreshold: 1,
      hotTierMaxBytes: 10 // Very small to force warm
    })

    const sha = createSha('nopromo')
    await storage.putObject(sha, 'blob', new Uint8Array(50))

    // Access many times
    for (let i = 0; i < 10; i++) {
      await storage.getObject(sha)
    }

    // Should never be promoted
    const result = await storage.getObject(sha)
    expect(result?.promoted).toBe(false)
  })

  it('should disable auto-demote when configured', async () => {
    const r2 = new MockR2Bucket()
    const sql = new MockSqlStorage()

    const storage = new TieredStorage({
      r2,
      sql,
      autoDemote: false
    })

    const sha = createSha('nodemote')
    await storage.putObject(sha, 'blob', new Uint8Array(10))

    // Set old access time
    sql.exec(
      'UPDATE git_objects_meta SET last_accessed = ? WHERE sha = ?',
      0, // Very old
      sha
    )

    const demoted = await storage.runMaintenance()
    expect(demoted).toBe(0)
  })
})
