/**
 * Tests for readdir operation (RED phase - should fail)
 * These tests drive the implementation of the readdir function
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { readdir, readdirIterator } from './readdir'
import { Dirent } from '../types'
import { ENOENT, ENOTDIR } from '../errors'

describe('readdir', () => {
  describe('basic directory listing', () => {
    it('should return an array of strings by default', async () => {
      const result = await readdir('/test/dir')

      expect(Array.isArray(result)).toBe(true)
      expect(result.every(item => typeof item === 'string')).toBe(true)
    })

    it('should list files in a directory', async () => {
      const result = await readdir('/test/dir-with-files')

      expect(result).toContain('file1.txt')
      expect(result).toContain('file2.txt')
    })

    it('should list subdirectories in a directory', async () => {
      const result = await readdir('/test/dir-with-subdirs')

      expect(result).toContain('subdir1')
      expect(result).toContain('subdir2')
    })

    it('should list both files and subdirectories', async () => {
      const result = await readdir('/test/mixed-dir')

      expect(result).toContain('file.txt')
      expect(result).toContain('subdir')
    })

    it('should not include . and .. entries', async () => {
      const result = await readdir('/test/dir')

      expect(result).not.toContain('.')
      expect(result).not.toContain('..')
    })
  })

  describe('empty directory', () => {
    it('should return empty array for empty directory', async () => {
      const result = await readdir('/test/empty-dir')

      expect(result).toEqual([])
    })
  })

  describe('withFileTypes option', () => {
    it('should return Dirent objects when withFileTypes is true', async () => {
      const result = await readdir('/test/dir', { withFileTypes: true })

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toBeInstanceOf(Dirent)
    })

    it('should return Dirent with correct name property', async () => {
      const result = await readdir('/test/dir-with-files', { withFileTypes: true })

      const names = result.map(dirent => dirent.name)
      expect(names).toContain('file1.txt')
    })

    it('should return Dirent with correct parentPath property', async () => {
      const result = await readdir('/test/dir', { withFileTypes: true })

      expect(result[0].parentPath).toBe('/test/dir')
    })

    it('should identify files correctly via Dirent.isFile()', async () => {
      const result = await readdir('/test/dir-with-files', { withFileTypes: true })

      const fileDirent = result.find(d => d.name === 'file1.txt')
      expect(fileDirent).toBeDefined()
      expect(fileDirent!.isFile()).toBe(true)
      expect(fileDirent!.isDirectory()).toBe(false)
    })

    it('should identify directories correctly via Dirent.isDirectory()', async () => {
      const result = await readdir('/test/dir-with-subdirs', { withFileTypes: true })

      const dirDirent = result.find(d => d.name === 'subdir1')
      expect(dirDirent).toBeDefined()
      expect(dirDirent!.isDirectory()).toBe(true)
      expect(dirDirent!.isFile()).toBe(false)
    })

    it('should identify symlinks correctly via Dirent.isSymbolicLink()', async () => {
      const result = await readdir('/test/dir-with-symlinks', { withFileTypes: true })

      const linkDirent = result.find(d => d.name === 'mylink')
      expect(linkDirent).toBeDefined()
      expect(linkDirent!.isSymbolicLink()).toBe(true)
      expect(linkDirent!.isFile()).toBe(false)
      expect(linkDirent!.isDirectory()).toBe(false)
    })
  })

  describe('recursive option', () => {
    it('should list only immediate children when recursive is false', async () => {
      const result = await readdir('/test/nested-dir', { recursive: false })

      expect(result).toContain('child')
      expect(result).not.toContain('grandchild')
    })

    it('should list all descendants when recursive is true', async () => {
      const result = await readdir('/test/nested-dir', { recursive: true })

      expect(result).toContain('child')
      expect(result.some(name => name.includes('grandchild'))).toBe(true)
    })

    it('should return relative paths for recursive listing', async () => {
      const result = await readdir('/test/nested-dir', { recursive: true })

      // Should include paths like 'child/grandchild'
      expect(result.some(name => name.includes('/'))).toBe(true)
    })

    it('should work with both recursive and withFileTypes options', async () => {
      const result = await readdir('/test/nested-dir', {
        recursive: true,
        withFileTypes: true
      })

      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toBeInstanceOf(Dirent)
    })

    it('should list deeply nested files when recursive is true', async () => {
      const result = await readdir('/test/deep-nested', { recursive: true })

      // Should find files at multiple levels
      expect(result.length).toBeGreaterThan(1)
    })

    it('should return empty array for empty directory with recursive option', async () => {
      const result = await readdir('/test/empty-dir', { recursive: true })

      expect(result).toEqual([])
    })
  })

  describe('error handling', () => {
    describe('ENOENT - path does not exist', () => {
      it('should throw ENOENT when directory does not exist', async () => {
        await expect(readdir('/nonexistent/path')).rejects.toThrow()
      })

      it('should throw ENOENT with correct error code', async () => {
        try {
          await readdir('/nonexistent/path')
          expect.fail('Should have thrown an error')
        } catch (error) {
          expect(error).toBeInstanceOf(ENOENT)
          expect((error as ENOENT).code).toBe('ENOENT')
          expect((error as ENOENT).errno).toBe(-2)
        }
      })

      it('should throw ENOENT with correct syscall', async () => {
        try {
          await readdir('/nonexistent/path')
          expect.fail('Should have thrown an error')
        } catch (error) {
          expect((error as ENOENT).syscall).toBe('scandir')
        }
      })

      it('should throw ENOENT with correct path', async () => {
        const testPath = '/nonexistent/specific/path'
        try {
          await readdir(testPath)
          expect.fail('Should have thrown an error')
        } catch (error) {
          expect((error as ENOENT).path).toBe(testPath)
        }
      })
    })

    describe('ENOTDIR - path is not a directory', () => {
      it('should throw ENOTDIR when path is a file', async () => {
        await expect(readdir('/test/file.txt')).rejects.toThrow()
      })

      it('should throw ENOTDIR with correct error code', async () => {
        try {
          await readdir('/test/file.txt')
          expect.fail('Should have thrown an error')
        } catch (error) {
          expect(error).toBeInstanceOf(ENOTDIR)
          expect((error as ENOTDIR).code).toBe('ENOTDIR')
          expect((error as ENOTDIR).errno).toBe(-20)
        }
      })

      it('should throw ENOTDIR with correct syscall', async () => {
        try {
          await readdir('/test/file.txt')
          expect.fail('Should have thrown an error')
        } catch (error) {
          expect((error as ENOTDIR).syscall).toBe('scandir')
        }
      })

      it('should throw ENOTDIR with correct path', async () => {
        const testPath = '/test/specific-file.txt'
        try {
          await readdir(testPath)
          expect.fail('Should have thrown an error')
        } catch (error) {
          expect((error as ENOTDIR).path).toBe(testPath)
        }
      })
    })
  })

  describe('hidden files', () => {
    it('should include hidden files (starting with dot)', async () => {
      const result = await readdir('/test/dir-with-hidden')

      expect(result).toContain('.hidden')
      expect(result).toContain('.gitignore')
    })

    it('should include hidden directories', async () => {
      const result = await readdir('/test/dir-with-hidden')

      expect(result).toContain('.hidden-dir')
    })
  })

  describe('special entries', () => {
    it('should handle files with special characters in names', async () => {
      const result = await readdir('/test/dir-with-special')

      expect(result).toContain('file with spaces.txt')
      expect(result).toContain('file-with-dashes.txt')
      expect(result).toContain('file_with_underscores.txt')
    })

    it('should handle unicode filenames', async () => {
      const result = await readdir('/test/dir-with-unicode')

      expect(result.some(name => /[\u4e00-\u9fa5]/.test(name))).toBe(true) // Chinese characters
    })
  })

  describe('sorting behavior', () => {
    it('should return entries in a consistent order', async () => {
      const result1 = await readdir('/test/dir')
      const result2 = await readdir('/test/dir')

      expect(result1).toEqual(result2)
    })
  })

  describe('path normalization', () => {
    it('should handle paths with trailing slash', async () => {
      const result1 = await readdir('/test/dir')
      const result2 = await readdir('/test/dir/')

      expect(result1).toEqual(result2)
    })

    it('should handle paths with multiple slashes', async () => {
      const result = await readdir('/test//dir')

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('return type inference', () => {
    it('should return string[] when no options provided', async () => {
      const result = await readdir('/test/dir')

      // TypeScript should infer this as string[]
      const firstItem: string = result[0]
      expect(typeof firstItem).toBe('string')
    })

    it('should return string[] when withFileTypes is false', async () => {
      const result = await readdir('/test/dir', { withFileTypes: false })

      const firstItem: string = result[0]
      expect(typeof firstItem).toBe('string')
    })

    it('should return Dirent[] when withFileTypes is true', async () => {
      const result = await readdir('/test/dir', { withFileTypes: true })

      const firstItem: Dirent = result[0]
      expect(firstItem).toBeInstanceOf(Dirent)
    })
  })

  // =============================================================================
  // Cursor-based Pagination Tests (RED Phase - TDD)
  // =============================================================================
  describe('cursor-based pagination', () => {
    describe('limit option', () => {
      it('should return only the specified number of entries when limit is set', async () => {
        // /test/dir has 3 entries: a.txt, b.txt, subdir
        const result = await readdir('/test/dir', { limit: 2 })

        expect(result.entries).toHaveLength(2)
      })

      it('should return all entries when limit exceeds directory size', async () => {
        const result = await readdir('/test/dir-with-files', { limit: 100 })

        expect(result.entries).toHaveLength(2) // file1.txt and file2.txt
      })

      it('should return empty array with empty cursor for empty directory', async () => {
        const result = await readdir('/test/empty-dir', { limit: 10 })

        expect(result.entries).toHaveLength(0)
        expect(result.cursor).toBeNull()
      })

      it('should work with withFileTypes option', async () => {
        const result = await readdir('/test/dir', { limit: 2, withFileTypes: true })

        expect(result.entries).toHaveLength(2)
        expect(result.entries[0]).toBeInstanceOf(Dirent)
      })
    })

    describe('cursor option', () => {
      it('should return a cursor when more entries exist', async () => {
        const result = await readdir('/test/dir', { limit: 1 })

        expect(result.cursor).toBeDefined()
        expect(result.cursor).not.toBeNull()
        expect(typeof result.cursor).toBe('string')
      })

      it('should return null cursor when all entries returned', async () => {
        const result = await readdir('/test/dir-with-files', { limit: 10 })

        expect(result.cursor).toBeNull()
      })

      it('should continue from cursor position', async () => {
        // First page
        const firstPage = await readdir('/test/dir', { limit: 1 })
        expect(firstPage.entries).toHaveLength(1)
        const firstEntry = firstPage.entries[0]

        // Second page using cursor
        const secondPage = await readdir('/test/dir', {
          limit: 1,
          cursor: firstPage.cursor!,
        })
        expect(secondPage.entries).toHaveLength(1)
        const secondEntry = secondPage.entries[0]

        // Entries should be different
        expect(secondEntry).not.toBe(firstEntry)
      })

      it('should maintain consistent ordering across pages', async () => {
        // Get all entries without pagination
        const allEntries = await readdir('/test/dir')

        // Get entries with pagination
        const firstPage = await readdir('/test/dir', { limit: 1 })
        const secondPage = await readdir('/test/dir', {
          limit: 1,
          cursor: firstPage.cursor!,
        })
        const thirdPage = await readdir('/test/dir', {
          limit: 1,
          cursor: secondPage.cursor!,
        })

        // Combine paginated results
        const paginatedEntries = [
          ...firstPage.entries,
          ...secondPage.entries,
          ...thirdPage.entries,
        ]

        expect(paginatedEntries).toEqual(allEntries)
      })

      it('should return empty entries array for exhausted cursor', async () => {
        // Get to the last page
        const firstPage = await readdir('/test/dir-with-files', { limit: 2 })
        expect(firstPage.cursor).toBeNull() // All entries returned

        // Trying to paginate further should return empty
        const result = await readdir('/test/dir-with-files', {
          limit: 10,
          cursor: 'exhausted-cursor',
        })
        expect(result.entries).toHaveLength(0)
        expect(result.cursor).toBeNull()
      })
    })

    describe('cursor stability', () => {
      it('should produce stable cursors across identical calls', async () => {
        const result1 = await readdir('/test/dir', { limit: 1 })
        const result2 = await readdir('/test/dir', { limit: 1 })

        expect(result1.cursor).toBe(result2.cursor)
      })

      it('cursor should be valid after directory read', async () => {
        const firstPage = await readdir('/test/dir', { limit: 1 })

        // Simulate some time passing (cursor should still be valid)
        const secondPage = await readdir('/test/dir', {
          limit: 1,
          cursor: firstPage.cursor!,
        })

        expect(secondPage.entries).toHaveLength(1)
      })
    })

    describe('backward compatibility', () => {
      it('should return array directly when no pagination options used', async () => {
        const result = await readdir('/test/dir')

        // Without limit/cursor, should return plain array (backward compatible)
        expect(Array.isArray(result)).toBe(true)
        expect((result as string[]).every(item => typeof item === 'string')).toBe(true)
      })

      it('should return paginated result object when limit is specified', async () => {
        const result = await readdir('/test/dir', { limit: 2 })

        // With limit, should return { entries, cursor } object
        expect(result).toHaveProperty('entries')
        expect(result).toHaveProperty('cursor')
      })
    })
  })

  // =============================================================================
  // Async Iterator Tests (RED Phase - TDD)
  // =============================================================================
  describe('readdirIterator', () => {
    it('should be exported as a function', () => {
      // RED: readdirIterator should be exported
      expect(typeof readdirIterator).toBe('function')
    })

    it('should yield entries one at a time', async () => {
      // Skip if not implemented yet
      if (typeof readdirIterator !== 'function') {
        expect.fail('readdirIterator is not implemented')
      }
      const entries: string[] = []
      for await (const entry of readdirIterator('/test/dir')) {
        entries.push(entry)
      }

      expect(entries.length).toBeGreaterThan(0)
      expect(entries).toContain('a.txt')
    })

    it('should yield Dirent objects when withFileTypes is true', async () => {
      if (typeof readdirIterator !== 'function') {
        expect.fail('readdirIterator is not implemented')
      }
      const entries: Dirent[] = []
      for await (const entry of readdirIterator('/test/dir', { withFileTypes: true })) {
        entries.push(entry)
      }

      expect(entries.length).toBeGreaterThan(0)
      expect(entries[0]).toBeInstanceOf(Dirent)
    })

    it('should yield entries in sorted order', async () => {
      if (typeof readdirIterator !== 'function') {
        expect.fail('readdirIterator is not implemented')
      }
      const entries: string[] = []
      for await (const entry of readdirIterator('/test/dir')) {
        entries.push(entry)
      }

      const sortedEntries = [...entries].sort((a, b) => a.localeCompare(b))
      expect(entries).toEqual(sortedEntries)
    })

    it('should handle empty directory', async () => {
      if (typeof readdirIterator !== 'function') {
        expect.fail('readdirIterator is not implemented')
      }
      const entries: string[] = []
      for await (const entry of readdirIterator('/test/empty-dir')) {
        entries.push(entry)
      }

      expect(entries).toHaveLength(0)
    })

    it('should throw ENOENT for non-existent directory', async () => {
      if (typeof readdirIterator !== 'function') {
        expect.fail('readdirIterator is not implemented')
      }
      const entries: string[] = []
      await expect(async () => {
        for await (const entry of readdirIterator('/nonexistent')) {
          entries.push(entry)
        }
      }).rejects.toThrow(ENOENT)
    })

    it('should support early termination with break', async () => {
      if (typeof readdirIterator !== 'function') {
        expect.fail('readdirIterator is not implemented')
      }
      const entries: string[] = []
      for await (const entry of readdirIterator('/test/dir')) {
        entries.push(entry)
        if (entries.length >= 1) break
      }

      expect(entries).toHaveLength(1)
    })

    it('should work with recursive option', async () => {
      if (typeof readdirIterator !== 'function') {
        expect.fail('readdirIterator is not implemented')
      }
      const entries: string[] = []
      for await (const entry of readdirIterator('/test/nested-dir', { recursive: true })) {
        entries.push(entry)
      }

      // Should include entries from nested directories
      expect(entries.some(e => e.includes('/'))).toBe(true)
    })
  })

  // =============================================================================
  // Large Directory Performance Tests (RED Phase - TDD)
  // =============================================================================
  describe('large directory handling', () => {
    it('should handle directory with many entries efficiently', async () => {
      // This test ensures pagination doesn't load all entries into memory
      // Using /test directory which has the most entries
      const result = await readdir('/test', { limit: 5 }) as { entries: string[]; cursor: string | null }

      expect(result.entries).toHaveLength(5)
      expect(result.cursor).not.toBeNull()
    })

    it('should iterate through large directory without loading all entries', async () => {
      if (typeof readdirIterator !== 'function') {
        expect.fail('readdirIterator is not implemented')
      }
      // Memory-efficient iteration test
      let count = 0
      for await (const _entry of readdirIterator('/test')) {
        count++
        if (count >= 3) break // Early termination
      }

      expect(count).toBe(3)
    })

    it('should return consistent total when paginating through entire directory', async () => {
      const allEntries = await readdir('/test') as string[]
      let paginatedCount = 0
      let cursor: string | null = null

      do {
        const result = await readdir('/test', { limit: 3, cursor: cursor ?? undefined }) as { entries: string[]; cursor: string | null }
        paginatedCount += result.entries.length
        cursor = result.cursor
      } while (cursor !== null)

      expect(paginatedCount).toBe(allEntries.length)
    })
  })
})
