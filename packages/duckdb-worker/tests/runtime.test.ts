/**
 * Tests for memory-only runtime
 *
 * These tests validate the virtual filesystem used in Workers environment.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerFileBuffer,
  dropFile,
  getFileBuffer,
  hasFile,
  listFiles,
  getFileSize,
  clearAllFiles,
  getTotalMemoryUsage,
} from '../src/runtime.js'

describe('Memory Runtime', () => {
  beforeEach(() => {
    clearAllFiles()
  })

  describe('registerFileBuffer', () => {
    it('should register an ArrayBuffer', () => {
      const buffer = new ArrayBuffer(100)
      registerFileBuffer('test.parquet', buffer)

      expect(hasFile('test.parquet')).toBe(true)
      expect(getFileSize('test.parquet')).toBe(100)
    })

    it('should register a Uint8Array', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])
      registerFileBuffer('data.bin', data)

      expect(hasFile('data.bin')).toBe(true)
      expect(getFileSize('data.bin')).toBe(5)
    })

    it('should overwrite existing file', () => {
      registerFileBuffer('file.txt', new ArrayBuffer(50))
      registerFileBuffer('file.txt', new ArrayBuffer(100))

      expect(getFileSize('file.txt')).toBe(100)
    })

    it('should preserve buffer contents', () => {
      const original = new Uint8Array([10, 20, 30, 40, 50])
      registerFileBuffer('numbers.bin', original)

      const retrieved = getFileBuffer('numbers.bin')
      expect(retrieved).toBeDefined()
      expect(Array.from(retrieved!)).toEqual([10, 20, 30, 40, 50])
    })
  })

  describe('dropFile', () => {
    it('should remove registered file', () => {
      registerFileBuffer('temp.dat', new ArrayBuffer(10))
      expect(hasFile('temp.dat')).toBe(true)

      const result = dropFile('temp.dat')
      expect(result).toBe(true)
      expect(hasFile('temp.dat')).toBe(false)
    })

    it('should return false for non-existent file', () => {
      const result = dropFile('does-not-exist.txt')
      expect(result).toBe(false)
    })
  })

  describe('getFileBuffer', () => {
    it('should return undefined for non-existent file', () => {
      const result = getFileBuffer('missing.bin')
      expect(result).toBeUndefined()
    })

    it('should return the registered buffer', () => {
      const data = new Uint8Array([1, 2, 3])
      registerFileBuffer('test.bin', data)

      const result = getFileBuffer('test.bin')
      expect(result).toBeDefined()
      expect(result!.byteLength).toBe(3)
    })
  })

  describe('listFiles', () => {
    it('should return empty array when no files registered', () => {
      expect(listFiles()).toEqual([])
    })

    it('should list all registered files', () => {
      registerFileBuffer('a.txt', new ArrayBuffer(1))
      registerFileBuffer('b.txt', new ArrayBuffer(2))
      registerFileBuffer('c.txt', new ArrayBuffer(3))

      const files = listFiles()
      expect(files).toHaveLength(3)
      expect(files).toContain('a.txt')
      expect(files).toContain('b.txt')
      expect(files).toContain('c.txt')
    })
  })

  describe('getFileSize', () => {
    it('should return -1 for non-existent file', () => {
      expect(getFileSize('missing.bin')).toBe(-1)
    })

    it('should return correct size', () => {
      registerFileBuffer('sized.bin', new ArrayBuffer(1234))
      expect(getFileSize('sized.bin')).toBe(1234)
    })
  })

  describe('getTotalMemoryUsage', () => {
    it('should return 0 when no files', () => {
      expect(getTotalMemoryUsage()).toBe(0)
    })

    it('should sum all file sizes', () => {
      registerFileBuffer('a.bin', new ArrayBuffer(100))
      registerFileBuffer('b.bin', new ArrayBuffer(200))
      registerFileBuffer('c.bin', new ArrayBuffer(300))

      expect(getTotalMemoryUsage()).toBe(600)
    })

    it('should update after file removal', () => {
      registerFileBuffer('a.bin', new ArrayBuffer(100))
      registerFileBuffer('b.bin', new ArrayBuffer(200))
      expect(getTotalMemoryUsage()).toBe(300)

      dropFile('a.bin')
      expect(getTotalMemoryUsage()).toBe(200)
    })
  })

  describe('clearAllFiles', () => {
    it('should remove all files', () => {
      registerFileBuffer('a.bin', new ArrayBuffer(100))
      registerFileBuffer('b.bin', new ArrayBuffer(200))
      registerFileBuffer('c.bin', new ArrayBuffer(300))
      expect(listFiles()).toHaveLength(3)

      clearAllFiles()
      expect(listFiles()).toHaveLength(0)
      expect(getTotalMemoryUsage()).toBe(0)
    })
  })
})
