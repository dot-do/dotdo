/**
 * TDD RED Phase: Tests for file change events emitted during FSx operations
 *
 * These tests verify that the correct watch events are emitted when files
 * and directories are created, modified, deleted, or renamed through FSx.
 *
 * The tests use the FSx watch() API to subscribe to events and verify that
 * operations trigger the expected event types with correct metadata.
 *
 * Test cases:
 * - writeFile to new path emits 'rename' (create) event
 * - writeFile to existing path emits 'change' (modify) event
 * - unlink emits 'rename' (delete) event
 * - rename emits 'rename' event for both old and new paths
 * - mkdir emits 'rename' (create) event for directory
 * - rmdir emits 'rename' (delete) event for directory
 * - Events include correct path information
 *
 * @module tests/watch/file-events
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FSx } from '../../core/fsx'
import { MockBackend } from '../../core/mock-backend'
import type { WatchEvent } from '../../core/watch/events'
import { createWatchEvent } from '../../core/watch/events'

describe('File change events (TDD RED)', () => {
  let fsx: FSx
  let backend: MockBackend

  beforeEach(async () => {
    backend = new MockBackend()
    fsx = new FSx(backend)

    // Create initial test file structure
    await fsx.mkdir('/home', { recursive: true })
    await fsx.mkdir('/home/user', { recursive: true })
    await fsx.writeFile('/home/user/existing.txt', 'initial content')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // writeFile Events
  // ===========================================================================

  describe('writeFile events', () => {
    it('should emit "rename" event when creating a new file', async () => {
      // Arrange
      const events: Array<{ type: string; filename: string }> = []
      const watcher = fsx.watch('/home/user', {}, (eventType, filename) => {
        events.push({ type: eventType, filename })
      })

      // Act - create a new file
      await fsx.writeFile('/home/user/new-file.txt', 'new content')

      // Wait for async event propagation (microtasks)
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Assert - should emit 'rename' for new file creation
      expect(events.length).toBeGreaterThan(0)
      expect(events).toContainEqual({
        type: 'rename',
        filename: 'new-file.txt',
      })

      watcher.close()
    })

    it('should emit "change" event when modifying an existing file', async () => {
      // Arrange
      const events: Array<{ type: string; filename: string }> = []
      const watcher = fsx.watch('/home/user', {}, (eventType, filename) => {
        events.push({ type: eventType, filename })
      })

      // Act - modify existing file
      await fsx.writeFile('/home/user/existing.txt', 'modified content')

      // Wait for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Assert - should emit 'change' for file modification
      expect(events.length).toBeGreaterThan(0)
      expect(events).toContainEqual({
        type: 'change',
        filename: 'existing.txt',
      })

      watcher.close()
    })

    it('should distinguish between create and modify based on file existence', async () => {
      // Arrange
      const events: Array<{ type: string; filename: string }> = []
      const watcher = fsx.watch('/home/user', {}, (eventType, filename) => {
        events.push({ type: eventType, filename })
      })

      // Act - create new file then modify it
      await fsx.writeFile('/home/user/fresh.txt', 'first write')
      await new Promise((resolve) => setTimeout(resolve, 50))

      const createEvents = events.filter(
        (e) => e.filename === 'fresh.txt' && e.type === 'rename'
      )

      await fsx.writeFile('/home/user/fresh.txt', 'second write')
      await new Promise((resolve) => setTimeout(resolve, 50))

      const modifyEvents = events.filter(
        (e) => e.filename === 'fresh.txt' && e.type === 'change'
      )

      // Assert - first write is rename (create), second is change (modify)
      expect(createEvents.length).toBe(1)
      expect(modifyEvents.length).toBe(1)

      watcher.close()
    })
  })

  // ===========================================================================
  // unlink Events
  // ===========================================================================

  describe('unlink events', () => {
    it('should emit "rename" event when deleting a file', async () => {
      // Arrange
      const events: Array<{ type: string; filename: string }> = []
      const watcher = fsx.watch('/home/user', {}, (eventType, filename) => {
        events.push({ type: eventType, filename })
      })

      // Act - delete existing file
      await fsx.unlink('/home/user/existing.txt')

      // Wait for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Assert - should emit 'rename' for file deletion
      expect(events.length).toBeGreaterThan(0)
      expect(events).toContainEqual({
        type: 'rename',
        filename: 'existing.txt',
      })

      watcher.close()
    })

    it('should emit event to watchers of the parent directory', async () => {
      // Arrange
      const homeEvents: Array<{ type: string; filename: string }> = []
      const userEvents: Array<{ type: string; filename: string }> = []

      const homeWatcher = fsx.watch('/home', { recursive: true }, (type, filename) => {
        homeEvents.push({ type, filename })
      })
      const userWatcher = fsx.watch('/home/user', {}, (type, filename) => {
        userEvents.push({ type, filename })
      })

      // Act - delete file
      await fsx.unlink('/home/user/existing.txt')
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Assert - both watchers should receive the event
      expect(homeEvents.some((e) => e.filename.includes('existing.txt'))).toBe(true)
      expect(userEvents.some((e) => e.filename === 'existing.txt')).toBe(true)

      homeWatcher.close()
      userWatcher.close()
    })
  })

  // ===========================================================================
  // rename Events
  // ===========================================================================

  describe('rename events', () => {
    it('should emit "rename" events for both old and new paths', async () => {
      // Arrange
      const events: Array<{ type: string; filename: string }> = []
      const watcher = fsx.watch('/home/user', {}, (eventType, filename) => {
        events.push({ type: eventType, filename })
      })

      // Act - rename a file
      await fsx.rename('/home/user/existing.txt', '/home/user/renamed.txt')

      // Wait for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Assert - should emit rename events for both old and new names
      expect(events.length).toBeGreaterThanOrEqual(2)
      expect(events).toContainEqual({
        type: 'rename',
        filename: 'existing.txt',
      })
      expect(events).toContainEqual({
        type: 'rename',
        filename: 'renamed.txt',
      })

      watcher.close()
    })

    it('should emit events to watchers of both source and destination directories', async () => {
      // Arrange
      await fsx.mkdir('/home/other', { recursive: true })

      const userEvents: Array<{ type: string; filename: string }> = []
      const otherEvents: Array<{ type: string; filename: string }> = []

      const userWatcher = fsx.watch('/home/user', {}, (type, filename) => {
        userEvents.push({ type, filename })
      })
      const otherWatcher = fsx.watch('/home/other', {}, (type, filename) => {
        otherEvents.push({ type, filename })
      })

      // Act - move file between directories
      await fsx.rename('/home/user/existing.txt', '/home/other/moved.txt')
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Assert - source directory watcher sees deletion
      expect(userEvents).toContainEqual({
        type: 'rename',
        filename: 'existing.txt',
      })

      // Destination directory watcher sees creation
      expect(otherEvents).toContainEqual({
        type: 'rename',
        filename: 'moved.txt',
      })

      userWatcher.close()
      otherWatcher.close()
    })
  })

  // ===========================================================================
  // mkdir Events
  // ===========================================================================

  describe('mkdir events', () => {
    it('should emit "rename" event when creating a directory', async () => {
      // Arrange
      const events: Array<{ type: string; filename: string }> = []
      const watcher = fsx.watch('/home/user', {}, (eventType, filename) => {
        events.push({ type: eventType, filename })
      })

      // Act - create a new directory
      await fsx.mkdir('/home/user/new-dir')

      // Wait for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Assert - should emit 'rename' for directory creation
      expect(events.length).toBeGreaterThan(0)
      expect(events).toContainEqual({
        type: 'rename',
        filename: 'new-dir',
      })

      watcher.close()
    })

    it('should emit events for recursive directory creation', async () => {
      // Arrange
      const events: Array<{ type: string; filename: string }> = []
      const watcher = fsx.watch('/home/user', { recursive: true }, (eventType, filename) => {
        events.push({ type: eventType, filename })
      })

      // Act - create nested directories
      await fsx.mkdir('/home/user/a/b/c', { recursive: true })

      // Wait for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Assert - should emit event(s) for directory creation
      // Note: The exact number of events depends on implementation
      expect(events.length).toBeGreaterThan(0)

      watcher.close()
    })
  })

  // ===========================================================================
  // rmdir Events
  // ===========================================================================

  describe('rmdir events', () => {
    it('should emit "rename" event when deleting a directory', async () => {
      // Arrange
      await fsx.mkdir('/home/user/to-delete')

      const events: Array<{ type: string; filename: string }> = []
      const watcher = fsx.watch('/home/user', {}, (eventType, filename) => {
        events.push({ type: eventType, filename })
      })

      // Act - delete the directory
      await fsx.rmdir('/home/user/to-delete')

      // Wait for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Assert - should emit 'rename' for directory deletion
      expect(events.length).toBeGreaterThan(0)
      expect(events).toContainEqual({
        type: 'rename',
        filename: 'to-delete',
      })

      watcher.close()
    })

    it('should emit events for recursive directory deletion', async () => {
      // Arrange
      await fsx.mkdir('/home/user/tree/nested', { recursive: true })
      await fsx.writeFile('/home/user/tree/nested/file.txt', 'content')

      const events: Array<{ type: string; filename: string }> = []
      const watcher = fsx.watch('/home/user', { recursive: true }, (eventType, filename) => {
        events.push({ type: eventType, filename })
      })

      // Act - recursively delete directory tree
      await fsx.rmdir('/home/user/tree', { recursive: true })

      // Wait for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Assert - should emit event(s) for the deletion
      expect(events.length).toBeGreaterThan(0)

      watcher.close()
    })
  })

  // ===========================================================================
  // Event Metadata
  // ===========================================================================

  describe('event metadata', () => {
    it('event should include path information', () => {
      // Test event creation with path
      const event = createWatchEvent('create', '/home/user/file.txt')

      expect(event.path).toBe('/home/user/file.txt')
      expect(event.type).toBe('create')
    })

    it('event should include timestamp', () => {
      // Test event creation with timestamp
      const before = Date.now()
      const event = createWatchEvent('modify', '/home/user/file.txt')
      const after = Date.now()

      expect(event.timestamp).toBeDefined()
      expect(event.timestamp).toBeGreaterThanOrEqual(before)
      expect(event.timestamp).toBeLessThanOrEqual(after)
    })

    it('rename event should include oldPath', () => {
      // Test rename event with oldPath
      const event = createWatchEvent('rename', '/old/path.txt', '/new/path.txt')

      expect(event.type).toBe('rename')
      expect(event.path).toBe('/new/path.txt')
      expect(event.oldPath).toBe('/old/path.txt')
    })

    it('create event should not have oldPath', () => {
      const event = createWatchEvent('create', '/home/user/new.txt')

      expect(event.type).toBe('create')
      expect(event.oldPath).toBeUndefined()
    })

    it('delete event should not have oldPath', () => {
      const event = createWatchEvent('delete', '/home/user/deleted.txt')

      expect(event.type).toBe('delete')
      expect(event.oldPath).toBeUndefined()
    })

    it('event can include optional size metadata', () => {
      const event = createWatchEvent('create', '/home/user/file.txt', { size: 1024 })

      expect(event.size).toBe(1024)
    })

    it('event can include optional mtime metadata', () => {
      const mtime = Date.now() - 1000
      const event = createWatchEvent('modify', '/home/user/file.txt', { mtime })

      expect(event.mtime).toBe(mtime)
    })

    it('event can include optional isDirectory metadata', () => {
      const dirEvent = createWatchEvent('create', '/home/user/dir', { isDirectory: true })
      const fileEvent = createWatchEvent('create', '/home/user/file.txt', { isDirectory: false })

      expect(dirEvent.isDirectory).toBe(true)
      expect(fileEvent.isDirectory).toBe(false)
    })
  })

  // ===========================================================================
  // Copy File Events
  // ===========================================================================

  describe('copyFile events', () => {
    it('should emit "rename" event for the destination file', async () => {
      // Arrange
      const events: Array<{ type: string; filename: string }> = []
      const watcher = fsx.watch('/home/user', {}, (eventType, filename) => {
        events.push({ type: eventType, filename })
      })

      // Act - copy file to new location
      await fsx.copyFile('/home/user/existing.txt', '/home/user/copied.txt')

      // Wait for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Assert - should emit 'rename' for the new file created by copy
      expect(events.length).toBeGreaterThan(0)
      expect(events).toContainEqual({
        type: 'rename',
        filename: 'copied.txt',
      })

      watcher.close()
    })
  })

  // ===========================================================================
  // rm Events
  // ===========================================================================

  describe('rm events', () => {
    it('should emit "rename" event when removing a file with rm()', async () => {
      // Arrange
      const events: Array<{ type: string; filename: string }> = []
      const watcher = fsx.watch('/home/user', {}, (eventType, filename) => {
        events.push({ type: eventType, filename })
      })

      // Act - remove file using rm
      await fsx.rm('/home/user/existing.txt')

      // Wait for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Assert - should emit 'rename' for file deletion
      expect(events.length).toBeGreaterThan(0)
      expect(events).toContainEqual({
        type: 'rename',
        filename: 'existing.txt',
      })

      watcher.close()
    })

    it('should emit "rename" event when removing a directory with rm({ recursive: true })', async () => {
      // Arrange
      await fsx.mkdir('/home/user/dir-to-remove')

      const events: Array<{ type: string; filename: string }> = []
      const watcher = fsx.watch('/home/user', {}, (eventType, filename) => {
        events.push({ type: eventType, filename })
      })

      // Act - remove directory using rm with recursive
      await fsx.rm('/home/user/dir-to-remove', { recursive: true })

      // Wait for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Assert - should emit 'rename' for directory deletion
      expect(events.length).toBeGreaterThan(0)
      expect(events).toContainEqual({
        type: 'rename',
        filename: 'dir-to-remove',
      })

      watcher.close()
    })
  })

  // ===========================================================================
  // Event Type Constants
  // ===========================================================================

  describe('event type constants', () => {
    it('should have "create" event type', () => {
      const event = createWatchEvent('create', '/test/path')
      expect(event.type).toBe('create')
    })

    it('should have "modify" event type', () => {
      const event = createWatchEvent('modify', '/test/path')
      expect(event.type).toBe('modify')
    })

    it('should have "delete" event type', () => {
      const event = createWatchEvent('delete', '/test/path')
      expect(event.type).toBe('delete')
    })

    it('should have "rename" event type', () => {
      const event = createWatchEvent('rename', '/old/path', '/new/path')
      expect(event.type).toBe('rename')
    })
  })
})
