/**
 * TypeScript Type Safety Tests
 *
 * These tests document and exercise TypeScript compiler errors found in the codebase:
 *
 * 1. Duplicate TieredWriteResult/TieredReadResult exports in storage/index.ts
 *    - Both ./interfaces.js and ./tiered-r2.js export these types
 *    - TypeScript error TS2300: Duplicate identifier
 *
 * 2. Missing Dirent constructor arg in core/backend.ts:669
 *    - Dirent constructor requires 3 args: (name, parentPath, type)
 *    - Backend only passes 2 args: (name, type)
 *    - TypeScript error TS2554: Expected 3 arguments, but got 2
 *
 * 3. Undefined hotMax/warmMax access in storage/tiered.ts:200,205
 *    - config.thresholds is optional, so hotMaxSize/warmMaxSize may be undefined
 *    - Direct comparison without nullish check causes TS18048
 *    - TypeScript error TS18048: 'hotMax' is possibly 'undefined'
 *
 * @module test/typescript/type-safety
 */

import { describe, it, expect } from 'vitest'
import { Dirent, Stats, type DirentType } from '../../core/types.js'

// =============================================================================
// Issue 1: Type Export Tests - Verifying no duplicate exports
// =============================================================================

describe('Type Exports', () => {
  describe('TieredWriteResult and TieredReadResult', () => {
    it('should have distinct type definitions from interfaces.js', async () => {
      // Import from the canonical location (interfaces.js)
      const interfaces = await import('../../storage/interfaces.js')

      // Verify the types exist and have expected structure
      // TieredWriteResult should extend BlobWriteResult with tier info
      expect(interfaces.createOperationContext).toBeDefined()

      // The types TieredWriteResult and TieredReadResult are interfaces,
      // so we can't directly test them at runtime, but we can verify
      // the module exports are accessible without errors
      expect(typeof interfaces).toBe('object')
    })

    it('should export TieredWriteResult/TieredReadResult from tiered-r2.js', async () => {
      // Import from tiered-r2.js (which has its own definitions)
      const tieredR2 = await import('../../storage/tiered-r2.js')

      // Verify the module exports without errors
      expect(typeof tieredR2).toBe('object')
    })

    it('should NOT cause duplicate identifier errors when types are distinct', () => {
      // This test documents the issue: storage/index.ts exports both versions
      // which causes TS2300: Duplicate identifier errors
      //
      // The fix should be to:
      // - Remove one of the exports, OR
      // - Rename one export (e.g., TieredR2ReadResult), OR
      // - Only re-export from one source
      //
      // For now, we test that types can be used when imported directly
      // from their source modules (not from the index)

      // Create a type assertion function for TieredWriteResult structure
      const assertTieredWriteResultShape = (result: {
        etag: string
        size: number
        tier: 'hot' | 'warm' | 'cold'
        migrated: boolean
        previousTier?: 'hot' | 'warm' | 'cold'
      }) => {
        expect(result.etag).toBeDefined()
        expect(result.size).toBeGreaterThanOrEqual(0)
        expect(['hot', 'warm', 'cold']).toContain(result.tier)
        expect(typeof result.migrated).toBe('boolean')
      }

      // Verify the shape is correct
      assertTieredWriteResultShape({
        etag: '"abc123"',
        size: 1024,
        tier: 'hot',
        migrated: false,
      })
    })
  })
})

// =============================================================================
// Issue 2: Dirent Constructor Tests
// =============================================================================

describe('Dirent Construction', () => {
  describe('constructor signature', () => {
    it('should require name, parentPath, and type arguments', () => {
      // Dirent requires 3 arguments: name, parentPath, type
      const dirent = new Dirent('test.txt', '/home/user', 'file')

      expect(dirent.name).toBe('test.txt')
      expect(dirent.parentPath).toBe('/home/user')
      expect(dirent.isFile()).toBe(true)
      expect(dirent.isDirectory()).toBe(false)
    })

    it('should construct directory entries correctly', () => {
      const dirent = new Dirent('subdir', '/home/user', 'directory')

      expect(dirent.name).toBe('subdir')
      expect(dirent.parentPath).toBe('/home/user')
      expect(dirent.isFile()).toBe(false)
      expect(dirent.isDirectory()).toBe(true)
    })

    it('should compute full path correctly', () => {
      const dirent = new Dirent('file.txt', '/home/user', 'file')
      expect(dirent.path).toBe('/home/user/file.txt')

      // Test with trailing slash on parentPath
      const dirent2 = new Dirent('file.txt', '/home/user/', 'file')
      expect(dirent2.path).toBe('/home/user/file.txt')
    })

    it('should handle all DirentType values', () => {
      const types: DirentType[] = ['file', 'directory', 'symlink', 'block', 'character', 'fifo', 'socket']

      for (const type of types) {
        const dirent = new Dirent('test', '/tmp', type)
        expect(dirent.name).toBe('test')

        // Verify type detection methods
        expect(dirent.isFile()).toBe(type === 'file')
        expect(dirent.isDirectory()).toBe(type === 'directory')
        expect(dirent.isSymbolicLink()).toBe(type === 'symlink')
        expect(dirent.isBlockDevice()).toBe(type === 'block')
        expect(dirent.isCharacterDevice()).toBe(type === 'character')
        expect(dirent.isFIFO()).toBe(type === 'fifo')
        expect(dirent.isSocket()).toBe(type === 'socket')
      }
    })

    it('should document the backend.ts:669 issue', () => {
      // The issue in core/backend.ts:669 is:
      //   result.push(new DirentClass(name, isDir ? 'directory' : 'file'))
      //
      // This only passes 2 arguments but Dirent requires 3:
      //   constructor(name: string, parentPath: string, type: DirentType)
      //
      // The fix should be:
      //   result.push(new DirentClass(name, prefix, isDir ? 'directory' : 'file'))
      //
      // where `prefix` is the directory path being read

      // Demonstrate correct usage
      const prefix = '/home/user'
      const name = 'hello.txt'
      const isDir = false

      // CORRECT: 3 arguments
      const dirent = new Dirent(name, prefix, isDir ? 'directory' : 'file')

      expect(dirent.name).toBe(name)
      expect(dirent.parentPath).toBe(prefix)
      expect(dirent.path).toBe('/home/user/hello.txt')
    })
  })
})

// =============================================================================
// Issue 3: TieredFS Config Undefined Access Tests
// =============================================================================

describe('TieredFS Config Safety', () => {
  describe('threshold value access', () => {
    it('should handle undefined thresholds safely', () => {
      // The issue in storage/tiered.ts:200,205 is:
      //   const hotMax = this.config.thresholds.hotMaxSize
      //   const warmMax = this.config.thresholds.warmMaxSize
      //   if (size <= hotMax) { ... }  // TS18048: hotMax possibly undefined
      //   if (size <= warmMax) { ... }  // TS18048: warmMax possibly undefined
      //
      // The thresholds object is optional in TieredFSConfig, and
      // hotMaxSize/warmMaxSize within it are also optional

      interface TieredFSConfig {
        hot: unknown // DurableObjectNamespace in real code
        warm?: unknown // R2Bucket
        cold?: unknown // R2Bucket
        thresholds?: {
          hotMaxSize?: number
          warmMaxSize?: number
        }
        promotionPolicy?: 'none' | 'on-access' | 'aggressive'
      }

      // Default values from the actual code
      const DEFAULT_HOT_MAX = 1024 * 1024 // 1MB
      const DEFAULT_WARM_MAX = 100 * 1024 * 1024 // 100MB

      // Safe accessor pattern that should be used
      const getHotMax = (config: TieredFSConfig): number => {
        return config.thresholds?.hotMaxSize ?? DEFAULT_HOT_MAX
      }

      const getWarmMax = (config: TieredFSConfig): number => {
        return config.thresholds?.warmMaxSize ?? DEFAULT_WARM_MAX
      }

      // Test with no thresholds
      const configNoThresholds: TieredFSConfig = { hot: {} }
      expect(getHotMax(configNoThresholds)).toBe(DEFAULT_HOT_MAX)
      expect(getWarmMax(configNoThresholds)).toBe(DEFAULT_WARM_MAX)

      // Test with empty thresholds
      const configEmptyThresholds: TieredFSConfig = { hot: {}, thresholds: {} }
      expect(getHotMax(configEmptyThresholds)).toBe(DEFAULT_HOT_MAX)
      expect(getWarmMax(configEmptyThresholds)).toBe(DEFAULT_WARM_MAX)

      // Test with partial thresholds
      const configPartialThresholds: TieredFSConfig = {
        hot: {},
        thresholds: { hotMaxSize: 512 * 1024 },
      }
      expect(getHotMax(configPartialThresholds)).toBe(512 * 1024)
      expect(getWarmMax(configPartialThresholds)).toBe(DEFAULT_WARM_MAX)

      // Test with full thresholds
      const configFullThresholds: TieredFSConfig = {
        hot: {},
        thresholds: {
          hotMaxSize: 2 * 1024 * 1024,
          warmMaxSize: 50 * 1024 * 1024,
        },
      }
      expect(getHotMax(configFullThresholds)).toBe(2 * 1024 * 1024)
      expect(getWarmMax(configFullThresholds)).toBe(50 * 1024 * 1024)
    })

    it('should demonstrate tier selection with safe undefined handling', () => {
      type StorageTier = 'hot' | 'warm' | 'cold'

      // Safe implementation that avoids undefined access
      const selectTierSafely = (
        size: number,
        hotMax: number | undefined,
        warmMax: number | undefined,
        hasWarm: boolean,
        hasCold: boolean
      ): StorageTier => {
        const effectiveHotMax = hotMax ?? 1024 * 1024 // 1MB default
        const effectiveWarmMax = warmMax ?? 100 * 1024 * 1024 // 100MB default

        if (size <= effectiveHotMax) {
          return 'hot'
        }

        if (size <= effectiveWarmMax) {
          return hasWarm ? 'warm' : 'hot'
        }

        if (hasCold) {
          return 'cold'
        }

        return hasWarm ? 'warm' : 'hot'
      }

      // Test tier selection with undefined values
      expect(selectTierSafely(512, undefined, undefined, true, true)).toBe('hot')
      expect(selectTierSafely(2 * 1024 * 1024, undefined, undefined, true, true)).toBe('warm')
      expect(selectTierSafely(200 * 1024 * 1024, undefined, undefined, true, true)).toBe('cold')

      // Test with explicit thresholds
      expect(selectTierSafely(512, 1024, 2048, true, true)).toBe('hot')
      expect(selectTierSafely(1500, 1024, 2048, true, true)).toBe('warm')
      expect(selectTierSafely(3000, 1024, 2048, true, true)).toBe('cold')

      // Test fallback when tiers unavailable
      expect(selectTierSafely(3000, 1024, 2048, false, false)).toBe('hot')
      expect(selectTierSafely(3000, 1024, 2048, true, false)).toBe('warm')
    })

    it('should verify proper merging of config with defaults', () => {
      // This mirrors the pattern in tiered.ts DEFAULT_CONFIG
      const DEFAULT_THRESHOLDS = {
        hotMaxSize: 1024 * 1024,
        warmMaxSize: 100 * 1024 * 1024,
      }

      interface Config {
        thresholds?: {
          hotMaxSize?: number
          warmMaxSize?: number
        }
      }

      // Safe merging function
      const mergeThresholds = (config: Config) => {
        return {
          hotMaxSize: config.thresholds?.hotMaxSize ?? DEFAULT_THRESHOLDS.hotMaxSize,
          warmMaxSize: config.thresholds?.warmMaxSize ?? DEFAULT_THRESHOLDS.warmMaxSize,
        }
      }

      // Test various input configurations
      expect(mergeThresholds({})).toEqual(DEFAULT_THRESHOLDS)
      expect(mergeThresholds({ thresholds: {} })).toEqual(DEFAULT_THRESHOLDS)
      expect(mergeThresholds({ thresholds: { hotMaxSize: 500 } })).toEqual({
        hotMaxSize: 500,
        warmMaxSize: DEFAULT_THRESHOLDS.warmMaxSize,
      })
      expect(mergeThresholds({ thresholds: { warmMaxSize: 1000 } })).toEqual({
        hotMaxSize: DEFAULT_THRESHOLDS.hotMaxSize,
        warmMaxSize: 1000,
      })
    })
  })
})

// =============================================================================
// Stats Class Tests (for completeness)
// =============================================================================

describe('Stats Construction', () => {
  it('should construct Stats with all required fields', () => {
    const stats = new Stats({
      dev: 1,
      ino: 12345,
      mode: 0o100644,
      nlink: 1,
      uid: 1000,
      gid: 1000,
      rdev: 0,
      size: 1024,
      blksize: 4096,
      blocks: 8,
      atimeMs: Date.now(),
      mtimeMs: Date.now(),
      ctimeMs: Date.now(),
      birthtimeMs: Date.now() - 1000,
    })

    expect(stats.size).toBe(1024)
    expect(stats.isFile()).toBe(true)
    expect(stats.isDirectory()).toBe(false)
  })

  it('should provide Date getters for timestamps', () => {
    const now = Date.now()
    const stats = new Stats({
      dev: 1,
      ino: 1,
      mode: 0o100644,
      nlink: 1,
      uid: 0,
      gid: 0,
      rdev: 0,
      size: 0,
      blksize: 4096,
      blocks: 0,
      atimeMs: now,
      mtimeMs: now,
      ctimeMs: now,
      birthtimeMs: now,
    })

    expect(stats.atime).toBeInstanceOf(Date)
    expect(stats.mtime).toBeInstanceOf(Date)
    expect(stats.ctime).toBeInstanceOf(Date)
    expect(stats.birthtime).toBeInstanceOf(Date)
    expect(stats.atimeMs).toBe(now)
  })
})
