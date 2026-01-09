/**
 * TierManager tests
 *
 * Tests for tiered data storage:
 * - Hot tier size checking (SQLite limit)
 * - Promotion to warm tier (R2)
 * - Archival to cold tier (R2 Archive)
 * - Tiered get() lookups with fallback
 * - Size threshold parsing (1GB, 500MB, etc.)
 * - Age-based archival (30d, 90d, etc.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TierConfig } from './types'
import {
  TierManager,
  parseSize,
  parseDuration,
  formatSize,
  formatDuration,
} from './tier'

// ============================================================================
// SIZE PARSING TESTS
// ============================================================================

describe('parseSize', () => {
  it('should parse KB', () => {
    expect(parseSize('100KB')).toBe(100 * 1024)
    expect(parseSize('1KB')).toBe(1024)
  })

  it('should parse MB', () => {
    expect(parseSize('100MB')).toBe(100 * 1024 * 1024)
    expect(parseSize('500MB')).toBe(500 * 1024 * 1024)
  })

  it('should parse GB', () => {
    expect(parseSize('1GB')).toBe(1024 * 1024 * 1024)
    expect(parseSize('10GB')).toBe(10 * 1024 * 1024 * 1024)
  })

  it('should parse TB', () => {
    expect(parseSize('1TB')).toBe(1024 * 1024 * 1024 * 1024)
  })

  it('should be case insensitive', () => {
    expect(parseSize('1gb')).toBe(parseSize('1GB'))
    expect(parseSize('100mb')).toBe(parseSize('100MB'))
  })

  it('should handle decimal values', () => {
    expect(parseSize('1.5GB')).toBe(1.5 * 1024 * 1024 * 1024)
    expect(parseSize('0.5MB')).toBe(0.5 * 1024 * 1024)
  })

  it('should throw for invalid format', () => {
    expect(() => parseSize('invalid')).toThrow()
    expect(() => parseSize('100')).toThrow()
    expect(() => parseSize('')).toThrow()
  })
})

describe('formatSize', () => {
  it('should format to KB', () => {
    expect(formatSize(1024)).toBe('1KB')
    expect(formatSize(512)).toBe('0.5KB')
  })

  it('should format to MB', () => {
    expect(formatSize(1024 * 1024)).toBe('1MB')
    expect(formatSize(100 * 1024 * 1024)).toBe('100MB')
  })

  it('should format to GB', () => {
    expect(formatSize(1024 * 1024 * 1024)).toBe('1GB')
    expect(formatSize(1.5 * 1024 * 1024 * 1024)).toBe('1.5GB')
  })

  it('should choose appropriate unit', () => {
    expect(formatSize(500)).toMatch(/KB/)
    expect(formatSize(500 * 1024 * 1024)).toMatch(/MB/)
    expect(formatSize(5 * 1024 * 1024 * 1024)).toMatch(/GB/)
  })
})

// ============================================================================
// DURATION PARSING TESTS
// ============================================================================

describe('parseDuration', () => {
  it('should parse minutes', () => {
    expect(parseDuration('30m')).toBe(30 * 60 * 1000)
    expect(parseDuration('60m')).toBe(60 * 60 * 1000)
  })

  it('should parse hours', () => {
    expect(parseDuration('1h')).toBe(60 * 60 * 1000)
    expect(parseDuration('24h')).toBe(24 * 60 * 60 * 1000)
  })

  it('should parse days', () => {
    expect(parseDuration('1d')).toBe(24 * 60 * 60 * 1000)
    expect(parseDuration('30d')).toBe(30 * 24 * 60 * 60 * 1000)
    expect(parseDuration('90d')).toBe(90 * 24 * 60 * 60 * 1000)
  })

  it('should parse seconds', () => {
    expect(parseDuration('60s')).toBe(60 * 1000)
    expect(parseDuration('3600s')).toBe(3600 * 1000)
  })

  it('should be case insensitive', () => {
    expect(parseDuration('30D')).toBe(parseDuration('30d'))
    expect(parseDuration('1H')).toBe(parseDuration('1h'))
  })

  it('should throw for invalid format', () => {
    expect(() => parseDuration('invalid')).toThrow()
    expect(() => parseDuration('30')).toThrow()
    expect(() => parseDuration('')).toThrow()
  })
})

describe('formatDuration', () => {
  it('should format to seconds', () => {
    expect(formatDuration(30 * 1000)).toBe('30s')
  })

  it('should format to minutes', () => {
    expect(formatDuration(30 * 60 * 1000)).toBe('30m')
  })

  it('should format to hours', () => {
    expect(formatDuration(12 * 60 * 60 * 1000)).toBe('12h')
  })

  it('should format to days', () => {
    expect(formatDuration(30 * 24 * 60 * 60 * 1000)).toBe('30d')
  })
})

// ============================================================================
// MOCK STORAGE
// ============================================================================

const createMockR2 = () => ({
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  list: vi.fn().mockResolvedValue({ objects: [] }),
})

const createMockSqlite = () => ({
  getSize: vi.fn().mockReturnValue(0),
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
})

// ============================================================================
// TIER MANAGER TESTS
// ============================================================================

describe('TierManager', () => {
  let mockHot: ReturnType<typeof createMockSqlite>
  let mockWarm: ReturnType<typeof createMockR2>
  let mockCold: ReturnType<typeof createMockR2>
  let manager: TierManager

  beforeEach(() => {
    mockHot = createMockSqlite()
    mockWarm = createMockR2()
    mockCold = createMockR2()
  })

  describe('constructor', () => {
    it('should create with default config', () => {
      manager = new TierManager({
        hot: mockHot as any,
        warm: mockWarm as any,
        cold: mockCold as any,
      })
      expect(manager).toBeInstanceOf(TierManager)
    })

    it('should accept custom config', () => {
      const config: TierConfig = {
        hot: 'sqlite',
        warm: 'r2',
        cold: 'archive',
        hotThreshold: '500MB',
        coldAfter: '30d',
      }
      manager = new TierManager(
        {
          hot: mockHot as any,
          warm: mockWarm as any,
          cold: mockCold as any,
        },
        config
      )
      expect(manager.config.hotThreshold).toBe('500MB')
    })
  })

  describe('get', () => {
    it('should check hot tier first', async () => {
      mockHot.get.mockReturnValue({ id: 1, name: 'Alice' })

      manager = new TierManager({
        hot: mockHot as any,
        warm: mockWarm as any,
        cold: mockCold as any,
      })

      const result = await manager.get('user:1')

      expect(mockHot.get).toHaveBeenCalledWith('user:1')
      expect(result).toEqual({ id: 1, name: 'Alice' })
      expect(mockWarm.get).not.toHaveBeenCalled()
    })

    it('should fall back to warm tier if not in hot', async () => {
      mockHot.get.mockReturnValue(undefined)
      mockWarm.get.mockResolvedValue({
        body: { text: () => Promise.resolve(JSON.stringify({ id: 1, name: 'Bob' })) },
      })

      manager = new TierManager({
        hot: mockHot as any,
        warm: mockWarm as any,
        cold: mockCold as any,
      })

      const result = await manager.get('user:1')

      expect(mockHot.get).toHaveBeenCalled()
      expect(mockWarm.get).toHaveBeenCalledWith('user:1')
      expect(result).toEqual({ id: 1, name: 'Bob' })
    })

    it('should fall back to cold tier if not in warm', async () => {
      mockHot.get.mockReturnValue(undefined)
      mockWarm.get.mockResolvedValue(null)
      mockCold.get.mockResolvedValue({
        body: { text: () => Promise.resolve(JSON.stringify({ id: 1, archived: true })) },
      })

      manager = new TierManager({
        hot: mockHot as any,
        warm: mockWarm as any,
        cold: mockCold as any,
      })

      const result = await manager.get('user:1')

      expect(mockCold.get).toHaveBeenCalledWith('user:1')
      expect(result).toEqual({ id: 1, archived: true })
    })

    it('should return undefined if not found in any tier', async () => {
      mockHot.get.mockReturnValue(undefined)
      mockWarm.get.mockResolvedValue(null)
      mockCold.get.mockResolvedValue(null)

      manager = new TierManager({
        hot: mockHot as any,
        warm: mockWarm as any,
        cold: mockCold as any,
      })

      const result = await manager.get('user:999')

      expect(result).toBeUndefined()
    })
  })

  describe('put', () => {
    it('should write to hot tier', async () => {
      mockHot.getSize.mockReturnValue(100 * 1024 * 1024) // 100MB

      manager = new TierManager(
        {
          hot: mockHot as any,
          warm: mockWarm as any,
          cold: mockCold as any,
        },
        { hotThreshold: '1GB' }
      )

      await manager.put('user:1', { id: 1, name: 'Alice' })

      expect(mockHot.put).toHaveBeenCalledWith('user:1', { id: 1, name: 'Alice' })
    })
  })

  describe('shouldPromoteToWarm', () => {
    it('should return true when hot tier exceeds threshold', () => {
      mockHot.getSize.mockReturnValue(2 * 1024 * 1024 * 1024) // 2GB

      manager = new TierManager(
        {
          hot: mockHot as any,
          warm: mockWarm as any,
          cold: mockCold as any,
        },
        { hotThreshold: '1GB' }
      )

      expect(manager.shouldPromoteToWarm()).toBe(true)
    })

    it('should return false when under threshold', () => {
      mockHot.getSize.mockReturnValue(500 * 1024 * 1024) // 500MB

      manager = new TierManager(
        {
          hot: mockHot as any,
          warm: mockWarm as any,
          cold: mockCold as any,
        },
        { hotThreshold: '1GB' }
      )

      expect(manager.shouldPromoteToWarm()).toBe(false)
    })
  })

  describe('promoteToWarm', () => {
    it('should move data from hot to warm', async () => {
      const data = { id: 1, name: 'Alice' }
      mockHot.get.mockReturnValue(data)

      manager = new TierManager({
        hot: mockHot as any,
        warm: mockWarm as any,
        cold: mockCold as any,
      })

      await manager.promoteToWarm('user:1')

      expect(mockWarm.put).toHaveBeenCalledWith(
        'user:1',
        expect.any(String) // JSON stringified
      )
      expect(mockHot.delete).toHaveBeenCalledWith('user:1')
    })

    it('should not delete from hot if warm put fails', async () => {
      mockHot.get.mockReturnValue({ id: 1 })
      mockWarm.put.mockRejectedValue(new Error('R2 error'))

      manager = new TierManager({
        hot: mockHot as any,
        warm: mockWarm as any,
        cold: mockCold as any,
      })

      await expect(manager.promoteToWarm('user:1')).rejects.toThrow()
      expect(mockHot.delete).not.toHaveBeenCalled()
    })
  })

  describe('shouldArchiveCold', () => {
    it('should return true for data older than threshold', () => {
      const oldDate = Date.now() - 100 * 24 * 60 * 60 * 1000 // 100 days ago

      manager = new TierManager(
        {
          hot: mockHot as any,
          warm: mockWarm as any,
          cold: mockCold as any,
        },
        { coldAfter: '90d' }
      )

      expect(manager.shouldArchiveCold(oldDate)).toBe(true)
    })

    it('should return false for recent data', () => {
      const recentDate = Date.now() - 30 * 24 * 60 * 60 * 1000 // 30 days ago

      manager = new TierManager(
        {
          hot: mockHot as any,
          warm: mockWarm as any,
          cold: mockCold as any,
        },
        { coldAfter: '90d' }
      )

      expect(manager.shouldArchiveCold(recentDate)).toBe(false)
    })
  })

  describe('archiveCold', () => {
    it('should move data from warm to cold', async () => {
      mockWarm.get.mockResolvedValue({
        body: { text: () => Promise.resolve(JSON.stringify({ id: 1, archived: false })) },
      })

      manager = new TierManager({
        hot: mockHot as any,
        warm: mockWarm as any,
        cold: mockCold as any,
      })

      await manager.archiveCold('user:1')

      expect(mockCold.put).toHaveBeenCalledWith(
        'user:1',
        expect.any(String)
      )
      expect(mockWarm.delete).toHaveBeenCalledWith('user:1')
    })
  })

  describe('hotSize', () => {
    it('should return current hot tier size', () => {
      mockHot.getSize.mockReturnValue(500 * 1024 * 1024) // 500MB

      manager = new TierManager({
        hot: mockHot as any,
        warm: mockWarm as any,
        cold: mockCold as any,
      })

      expect(manager.hotSize).toBe(500 * 1024 * 1024)
    })
  })

  describe('hotThreshold', () => {
    it('should return configured threshold in bytes', () => {
      manager = new TierManager(
        {
          hot: mockHot as any,
          warm: mockWarm as any,
          cold: mockCold as any,
        },
        { hotThreshold: '1GB' }
      )

      expect(manager.hotThreshold).toBe(1024 * 1024 * 1024)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('TierManager integration', () => {
  it('should work with tiered storage flow', async () => {
    const mockHot = createMockSqlite()
    const mockWarm = createMockR2()
    const mockCold = createMockR2()

    // Start under threshold
    mockHot.getSize.mockReturnValue(500 * 1024 * 1024)

    const manager = new TierManager(
      {
        hot: mockHot as any,
        warm: mockWarm as any,
        cold: mockCold as any,
      },
      { hotThreshold: '1GB', coldAfter: '90d' }
    )

    // Write to hot tier
    await manager.put('user:1', { id: 1, name: 'Test' })
    expect(mockHot.put).toHaveBeenCalled()

    // Check promotion isn't needed yet
    expect(manager.shouldPromoteToWarm()).toBe(false)

    // Simulate hot tier growing
    mockHot.getSize.mockReturnValue(1.5 * 1024 * 1024 * 1024)
    expect(manager.shouldPromoteToWarm()).toBe(true)
  })
})
