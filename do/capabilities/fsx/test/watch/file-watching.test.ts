/**
 * Tests for file watching functionality
 *
 * These tests verify that the watch() method properly detects file system changes.
 * The WatchManager hooks into FSx operations to emit events to registered watchers.
 *
 * Tests cover:
 * - Callback fires when file content changes
 * - Callback fires when file is created
 * - Callback fires when file is deleted
 * - Recursive option detects nested changes
 * - Watcher can be closed
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FSx } from '../../core/fsx'
import { MemoryBackend } from '../../core/backend'

describe('watch()', () => {
  let fsx: FSx
  let backend: MemoryBackend

  beforeEach(async () => {
    backend = new MemoryBackend()
    fsx = new FSx(backend)

    // Create test directory structure
    await backend.mkdir('/home', { recursive: true })
    await backend.mkdir('/home/user', { recursive: true })
    await backend.mkdir('/tmp', { recursive: true })

    // Create test files
    const encoder = new TextEncoder()
    await backend.writeFile('/home/user/hello.txt', encoder.encode('Hello, World!'))
    await backend.writeFile('/home/user/data.json', encoder.encode('{"key": "value"}'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('file content changes', () => {
    it('should fire callback when file content changes', async () => {
      // Arrange
      const listener = vi.fn()
      const watcher = fsx.watch('/home/user/hello.txt', {}, listener)

      // Act - modify the file
      await fsx.writeFile('/home/user/hello.txt', 'Modified content')

      // Allow time for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Assert - the listener should have been called with 'change' event
      // This test will FAIL because watch() is a stub that never fires callbacks
      expect(listener).toHaveBeenCalled()
      expect(listener).toHaveBeenCalledWith('change', 'hello.txt')

      watcher.close()
    })

    it('should fire callback multiple times for multiple changes', async () => {
      // Arrange
      const listener = vi.fn()
      const watcher = fsx.watch('/home/user/hello.txt', {}, listener)

      // Act - modify the file multiple times
      await fsx.writeFile('/home/user/hello.txt', 'First change')
      await fsx.writeFile('/home/user/hello.txt', 'Second change')
      await fsx.writeFile('/home/user/hello.txt', 'Third change')

      // Allow time for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Assert - listener should be called for each change
      // This test will FAIL because watch() is a stub
      expect(listener).toHaveBeenCalledTimes(3)

      watcher.close()
    })
  })

  describe('file creation', () => {
    it('should fire callback when file is created in watched directory', async () => {
      // Arrange
      const listener = vi.fn()
      const watcher = fsx.watch('/home/user', {}, listener)

      // Act - create a new file
      await fsx.writeFile('/home/user/new-file.txt', 'New content')

      // Allow time for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Assert - should fire with 'rename' event for new file
      // This test will FAIL because watch() is a stub
      expect(listener).toHaveBeenCalled()
      expect(listener).toHaveBeenCalledWith('rename', 'new-file.txt')

      watcher.close()
    })

    it('should fire callback when directory is created', async () => {
      // Arrange
      const listener = vi.fn()
      const watcher = fsx.watch('/home/user', {}, listener)

      // Act - create a new directory
      await fsx.mkdir('/home/user/new-dir')

      // Allow time for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Assert - should fire with 'rename' event for new directory
      // This test will FAIL because watch() is a stub
      expect(listener).toHaveBeenCalled()
      expect(listener).toHaveBeenCalledWith('rename', 'new-dir')

      watcher.close()
    })
  })

  describe('file deletion', () => {
    it('should fire callback when file is deleted', async () => {
      // Arrange
      const listener = vi.fn()
      const watcher = fsx.watch('/home/user', {}, listener)

      // Act - delete a file
      await fsx.unlink('/home/user/hello.txt')

      // Allow time for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Assert - should fire with 'rename' event for deletion
      // This test will FAIL because watch() is a stub
      expect(listener).toHaveBeenCalled()
      expect(listener).toHaveBeenCalledWith('rename', 'hello.txt')

      watcher.close()
    })

    it('should fire callback when directory is deleted', async () => {
      // Arrange
      await fsx.mkdir('/home/user/empty-dir')
      const listener = vi.fn()
      const watcher = fsx.watch('/home/user', {}, listener)

      // Act - delete the directory
      await fsx.rmdir('/home/user/empty-dir')

      // Allow time for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Assert - should fire with 'rename' event for deletion
      // This test will FAIL because watch() is a stub
      expect(listener).toHaveBeenCalled()
      expect(listener).toHaveBeenCalledWith('rename', 'empty-dir')

      watcher.close()
    })
  })

  describe('recursive watching', () => {
    it('should detect changes in nested directories with recursive option', async () => {
      // Arrange
      await fsx.mkdir('/home/user/nested/deep', { recursive: true })
      await fsx.writeFile('/home/user/nested/deep/file.txt', 'initial')

      const listener = vi.fn()
      const watcher = fsx.watch('/home/user', { recursive: true }, listener)

      // Act - modify nested file
      await fsx.writeFile('/home/user/nested/deep/file.txt', 'modified')

      // Allow time for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Assert - should detect changes in nested paths
      // This test will FAIL because watch() is a stub
      expect(listener).toHaveBeenCalled()
      // The filename should include the relative path from the watched directory
      expect(listener).toHaveBeenCalledWith('change', expect.stringContaining('file.txt'))

      watcher.close()
    })

    it('should detect file creation in nested directories', async () => {
      // Arrange
      await fsx.mkdir('/home/user/nested/deep', { recursive: true })

      const listener = vi.fn()
      const watcher = fsx.watch('/home/user', { recursive: true }, listener)

      // Act - create a file in nested directory
      await fsx.writeFile('/home/user/nested/deep/new.txt', 'new content')

      // Allow time for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Assert - should detect file creation in nested paths
      // This test will FAIL because watch() is a stub
      expect(listener).toHaveBeenCalled()
      expect(listener).toHaveBeenCalledWith('rename', expect.stringContaining('new.txt'))

      watcher.close()
    })

    it('should not detect nested changes without recursive option', async () => {
      // Arrange
      await fsx.mkdir('/home/user/nested', { recursive: true })
      await fsx.writeFile('/home/user/nested/file.txt', 'initial')

      const listener = vi.fn()
      // Watch WITHOUT recursive option
      const watcher = fsx.watch('/home/user', { recursive: false }, listener)

      // Act - modify file in subdirectory
      await fsx.writeFile('/home/user/nested/file.txt', 'modified')

      // Allow time for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Assert - should NOT detect changes in nested directories
      // This test will technically PASS with the stub (since nothing is called)
      // but the test documents expected behavior
      expect(listener).not.toHaveBeenCalled()

      watcher.close()
    })
  })

  describe('watcher lifecycle', () => {
    it('should return a closeable watcher', () => {
      // Arrange
      const listener = vi.fn()

      // Act
      const watcher = fsx.watch('/home/user', {}, listener)

      // Assert - watcher should have close method
      expect(watcher).toBeDefined()
      expect(typeof watcher.close).toBe('function')

      // Should not throw when closing
      expect(() => watcher.close()).not.toThrow()
    })

    it('should stop firing callbacks after close()', async () => {
      // Arrange
      const listener = vi.fn()
      const watcher = fsx.watch('/home/user', {}, listener)

      // Close immediately
      watcher.close()

      // Act - modify file after closing
      await fsx.writeFile('/home/user/hello.txt', 'Modified after close')

      // Allow time for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Assert - listener should NOT be called after close
      // This test will technically PASS with the stub (since nothing is called)
      // but documents expected behavior
      expect(listener).not.toHaveBeenCalled()
    })

    it('should support ref() and unref() methods', () => {
      // Arrange
      const listener = vi.fn()

      // Act
      const watcher = fsx.watch('/home/user', {}, listener)

      // Assert - should have ref and unref methods that return the watcher
      expect(typeof watcher.ref).toBe('function')
      expect(typeof watcher.unref).toBe('function')

      // ref() and unref() should return the watcher for chaining
      expect(watcher.ref()).toBe(watcher)
      expect(watcher.unref()).toBe(watcher)

      watcher.close()
    })
  })

  describe('watching specific files', () => {
    it('should watch a specific file for changes', async () => {
      // Arrange
      const listener = vi.fn()
      const watcher = fsx.watch('/home/user/hello.txt', {}, listener)

      // Act - modify the watched file
      await fsx.writeFile('/home/user/hello.txt', 'Updated content')

      // Allow time for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Assert
      // This test will FAIL because watch() is a stub
      expect(listener).toHaveBeenCalled()
      expect(listener).toHaveBeenCalledWith('change', 'hello.txt')

      watcher.close()
    })

    it('should fire rename event when watched file is deleted', async () => {
      // Arrange
      const listener = vi.fn()
      const watcher = fsx.watch('/home/user/hello.txt', {}, listener)

      // Act - delete the watched file
      await fsx.unlink('/home/user/hello.txt')

      // Allow time for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Assert
      // This test will FAIL because watch() is a stub
      expect(listener).toHaveBeenCalled()
      expect(listener).toHaveBeenCalledWith('rename', 'hello.txt')

      watcher.close()
    })
  })

  describe('file rename detection', () => {
    it('should fire callback when file is renamed', async () => {
      // Arrange
      const listener = vi.fn()
      const watcher = fsx.watch('/home/user', {}, listener)

      // Act - rename a file
      await fsx.rename('/home/user/hello.txt', '/home/user/renamed.txt')

      // Allow time for async event propagation
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Assert - should receive rename events for both old and new names
      // This test will FAIL because watch() is a stub
      expect(listener).toHaveBeenCalled()
      // Typically both the old name (removal) and new name (creation) trigger events
      expect(listener.mock.calls.length).toBeGreaterThanOrEqual(1)

      watcher.close()
    })
  })
})
