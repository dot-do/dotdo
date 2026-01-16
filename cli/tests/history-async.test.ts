/**
 * History Manager Async Tests
 *
 * Tests for the new async/optimized features:
 * - Async initialization
 * - Debounced writes
 * - File locking
 * - Lazy loading
 * - Pagination
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'

// Import the real module for integration tests
import { HistoryManager } from '../src/history-manager.js'

describe('HistoryManager - Async Features', () => {
  let tempDir: string
  let historyPath: string

  beforeEach(async () => {
    // Create a real temp directory for integration tests
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'history-test-'))
    historyPath = path.join(tempDir, 'repl_history')
  })

  afterEach(async () => {
    // Cleanup temp directory
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  describe('async initialization', () => {
    it('should initialize asynchronously', async () => {
      const manager = new HistoryManager({ historyPath })
      await manager.initializeAsync()

      expect(manager.size).toBe(0)
      expect(manager.getHistory()).toEqual([])
    })

    it('should load existing history asynchronously', async () => {
      // Create history file
      await writeFile(historyPath, 'cmd1\ncmd2\ncmd3', 'utf-8')

      const manager = new HistoryManager({ historyPath })
      await manager.initializeAsync()

      expect(manager.getHistory()).toEqual(['cmd1', 'cmd2', 'cmd3'])
    })
  })

  describe('async add with debouncing', () => {
    it('should add entries asynchronously', async () => {
      const manager = new HistoryManager({ historyPath, debounceMs: 10 })
      await manager.initializeAsync()

      await manager.addAsync('test command')
      expect(manager.getHistory()).toContain('test command')
    })

    it('should batch multiple writes within debounce interval', async () => {
      const manager = new HistoryManager({ historyPath, debounceMs: 100 })
      await manager.initializeAsync()

      // Add multiple entries quickly
      await manager.addAsync('cmd1')
      await manager.addAsync('cmd2')
      await manager.addAsync('cmd3')

      // Flush and verify
      await manager.shutdown()

      // Read the file directly
      const content = await readFile(historyPath, 'utf-8')
      expect(content).toBe('cmd1\ncmd2\ncmd3')
    })
  })

  describe('lazy loading', () => {
    it('should load only recent entries initially when lazy load enabled', async () => {
      // Create a large history file
      const entries = Array.from({ length: 200 }, (_, i) => `cmd${i + 1}`)
      await writeFile(historyPath, entries.join('\n'), 'utf-8')

      const manager = new HistoryManager({
        historyPath,
        lazyLoad: true,
        initialLoadSize: 50,
      })
      await manager.initializeAsync()

      // Should only have loaded last 50 entries
      expect(manager.size).toBe(50)
      expect(manager.fullyLoaded).toBe(false)
      expect(manager.totalEntries).toBe(200)

      // Should have the most recent entries
      expect(manager.getEntry(49)).toBe('cmd200')
      expect(manager.getEntry(0)).toBe('cmd151')
    })

    it('should load more entries on demand', async () => {
      // Create a large history file
      const entries = Array.from({ length: 200 }, (_, i) => `cmd${i + 1}`)
      await writeFile(historyPath, entries.join('\n'), 'utf-8')

      const manager = new HistoryManager({
        historyPath,
        lazyLoad: true,
        initialLoadSize: 50,
      })
      await manager.initializeAsync()

      expect(manager.size).toBe(50)

      // Load 50 more
      const newEntries = await manager.loadMore(50)
      expect(newEntries.length).toBe(50)
      expect(manager.size).toBe(100)

      // Should have cmd101-cmd200 now
      expect(manager.getEntry(0)).toBe('cmd101')
    })

    it('should mark fully loaded when all entries loaded', async () => {
      const entries = Array.from({ length: 50 }, (_, i) => `cmd${i + 1}`)
      await writeFile(historyPath, entries.join('\n'), 'utf-8')

      const manager = new HistoryManager({
        historyPath,
        lazyLoad: true,
        initialLoadSize: 100, // More than available
      })
      await manager.initializeAsync()

      expect(manager.fullyLoaded).toBe(true)
      expect(manager.size).toBe(50)
    })
  })

  describe('pagination', () => {
    it('should return paginated history', async () => {
      const entries = Array.from({ length: 100 }, (_, i) => `cmd${i + 1}`)
      await writeFile(historyPath, entries.join('\n'), 'utf-8')

      const manager = new HistoryManager({ historyPath })
      await manager.initializeAsync()

      // Get page 1 (offset 0, limit 10)
      const page1 = manager.getHistoryPage(0, 10)
      expect(page1).toHaveLength(10)
      expect(page1[0]).toBe('cmd1')
      expect(page1[9]).toBe('cmd10')

      // Get page 2
      const page2 = manager.getHistoryPage(10, 10)
      expect(page2).toHaveLength(10)
      expect(page2[0]).toBe('cmd11')
    })

    it('should handle pagination beyond bounds', async () => {
      await writeFile(historyPath, 'cmd1\ncmd2\ncmd3', 'utf-8')

      const manager = new HistoryManager({ historyPath })
      await manager.initializeAsync()

      const page = manager.getHistoryPage(10, 10)
      expect(page).toHaveLength(0)
    })
  })

  describe('search pagination', () => {
    it('should return paginated search results', async () => {
      const entries = Array.from({ length: 100 }, (_, i) =>
        i % 2 === 0 ? `customer_${i}` : `order_${i}`
      )
      await writeFile(historyPath, entries.join('\n'), 'utf-8')

      const manager = new HistoryManager({ historyPath })
      await manager.initializeAsync()

      const { results, total } = manager.searchPaginated('customer', 0, 10)
      expect(total).toBe(50) // Half the entries match
      expect(results).toHaveLength(10)
      expect(results[0]).toBe('customer_0')
    })
  })

  describe('shutdown', () => {
    it('should flush pending writes on shutdown', async () => {
      const manager = new HistoryManager({ historyPath, debounceMs: 5000 }) // Long debounce
      await manager.initializeAsync()

      // Add without waiting for debounce
      manager.add('pending command')

      // Shutdown should flush
      await manager.shutdown()

      // Verify file was written
      const content = await readFile(historyPath, 'utf-8')
      expect(content).toBe('pending command')
    })
  })

  describe('async clear', () => {
    it('should clear history asynchronously', async () => {
      await writeFile(historyPath, 'cmd1\ncmd2\ncmd3', 'utf-8')

      const manager = new HistoryManager({ historyPath })
      await manager.initializeAsync()

      expect(manager.size).toBe(3)

      await manager.clearAsync()

      expect(manager.size).toBe(0)

      // Verify file is empty
      const content = await readFile(historyPath, 'utf-8')
      expect(content).toBe('')
    })
  })
})
