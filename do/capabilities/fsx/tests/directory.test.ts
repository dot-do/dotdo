/**
 * Tests for directory operations
 *
 * These tests cover directory management:
 * - mkdir: creating directories
 * - rmdir: removing directories
 * - readdir: listing directory contents
 * - isDirectory/isFile: type checking
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  InMemoryStorage,
  createTestFilesystem,
  createNestedDirs,
  MockDurableObjectStub,
} from './test-utils'

describe('mkdir', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('basic directory creation', () => {
    it('should create a new directory', () => {
      storage.addDirectory('/home/user/newdir')

      expect(storage.has('/home/user/newdir')).toBe(true)
      expect(storage.isDirectory('/home/user/newdir')).toBe(true)
    })

    it('should create directory at root level', () => {
      storage.addDirectory('/newdir')

      expect(storage.has('/newdir')).toBe(true)
      expect(storage.isDirectory('/newdir')).toBe(true)
    })

    it('should create directory with custom mode', () => {
      storage.addDirectory('/home/user/restricted', { mode: 0o700 })

      const entry = storage.get('/home/user/restricted')
      expect((entry?.mode ?? 0) & 0o777).toBe(0o700)
    })

    it('should create multiple sibling directories', () => {
      storage.addDirectory('/home/user/dir1')
      storage.addDirectory('/home/user/dir2')
      storage.addDirectory('/home/user/dir3')

      expect(storage.isDirectory('/home/user/dir1')).toBe(true)
      expect(storage.isDirectory('/home/user/dir2')).toBe(true)
      expect(storage.isDirectory('/home/user/dir3')).toBe(true)
    })
  })

  describe('recursive directory creation', () => {
    it('should create deeply nested directories', () => {
      storage.addDirectory('/home/user/a')
      storage.addDirectory('/home/user/a/b')
      storage.addDirectory('/home/user/a/b/c')

      expect(storage.isDirectory('/home/user/a/b/c')).toBe(true)
    })

    it('should handle very deep nesting', () => {
      createNestedDirs(storage, '/home/user', 10)

      let path = '/home/user'
      for (let i = 0; i < 10; i++) {
        path += `/level${i}`
        expect(storage.isDirectory(path)).toBe(true)
      }
    })
  })

  describe('directory metadata', () => {
    it('should set default directory mode', () => {
      storage.addDirectory('/home/user/newdir')

      const entry = storage.get('/home/user/newdir')
      // Default mode should include directory permissions
      expect((entry?.mode ?? 0) & 0o777).toBe(0o755)
    })

    it('should set directory timestamps', () => {
      const before = Date.now()
      storage.addDirectory('/home/user/timestamped')
      const after = Date.now()

      const entry = storage.get('/home/user/timestamped')
      expect(entry?.birthtime).toBeGreaterThanOrEqual(before)
      expect(entry?.birthtime).toBeLessThanOrEqual(after)
    })
  })

  describe('edge cases', () => {
    it('should create directory with special characters in name', () => {
      storage.addDirectory('/home/user/my-project_v2.0')

      expect(storage.isDirectory('/home/user/my-project_v2.0')).toBe(true)
    })

    it('should create hidden directory (starting with dot)', () => {
      storage.addDirectory('/home/user/.config')

      expect(storage.isDirectory('/home/user/.config')).toBe(true)
    })

    it('should create directory with spaces in name', () => {
      storage.addDirectory('/home/user/my folder')

      expect(storage.isDirectory('/home/user/my folder')).toBe(true)
    })

    it('should create directory with unicode characters', () => {
      storage.addDirectory('/home/user/folder')

      expect(storage.isDirectory('/home/user/folder')).toBe(true)
    })
  })
})

describe('rmdir', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('removing empty directories', () => {
    it('should remove an empty directory', () => {
      storage.addDirectory('/home/user/empty')
      expect(storage.has('/home/user/empty')).toBe(true)

      storage.remove('/home/user/empty')
      expect(storage.has('/home/user/empty')).toBe(false)
    })

    it('should remove nested empty directories one by one', () => {
      storage.addDirectory('/home/user/a')
      storage.addDirectory('/home/user/a/b')
      storage.addDirectory('/home/user/a/b/c')

      storage.remove('/home/user/a/b/c')
      expect(storage.has('/home/user/a/b/c')).toBe(false)
      expect(storage.has('/home/user/a/b')).toBe(true)

      storage.remove('/home/user/a/b')
      expect(storage.has('/home/user/a/b')).toBe(false)
      expect(storage.has('/home/user/a')).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should return false when directory does not exist', () => {
      const result = storage.remove('/nonexistent')
      expect(result).toBe(false)
    })

    it('should still remove files (storage.remove works on both)', () => {
      // Note: In actual rmdir, you can't remove files, but our storage.remove allows it
      storage.remove('/home/user/hello.txt')
      expect(storage.has('/home/user/hello.txt')).toBe(false)
    })
  })
})

describe('readdir', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('listing directory contents', () => {
    it('should list immediate children of directory', () => {
      const children = storage.getChildren('/home/user')

      expect(children).toContain('hello.txt')
      expect(children).toContain('data.json')
    })

    it('should list root directory contents', () => {
      const children = storage.getChildren('/')

      expect(children).toContain('home')
      expect(children).toContain('tmp')
      expect(children).toContain('var')
    })

    it('should return empty array for empty directory', () => {
      storage.addDirectory('/home/user/empty')
      const children = storage.getChildren('/home/user/empty')

      expect(children).toEqual([])
    })

    it('should not include nested children', () => {
      // Create nested structure
      storage.addDirectory('/home/user/projects')
      storage.addFile('/home/user/projects/readme.md', '# Project')

      const children = storage.getChildren('/home/user')

      // Should include projects but not projects/readme.md
      expect(children).toContain('projects')
      expect(children).not.toContain('readme.md')
    })

    it('should return sorted list', () => {
      storage.addFile('/home/user/zebra.txt', 'z')
      storage.addFile('/home/user/alpha.txt', 'a')

      const children = storage.getChildren('/home/user')

      // Check that it's sorted
      const sorted = [...children].sort()
      expect(children).toEqual(sorted)
    })
  })

  describe('listing with mixed content', () => {
    it('should list both files and directories', () => {
      storage.addDirectory('/home/user/subdir')

      const children = storage.getChildren('/home/user')

      expect(children).toContain('hello.txt') // file
      expect(children).toContain('subdir') // directory
    })

    it('should list hidden files and directories', () => {
      storage.addFile('/home/user/.hidden', 'secret')
      storage.addDirectory('/home/user/.config')

      const children = storage.getChildren('/home/user')

      expect(children).toContain('.hidden')
      expect(children).toContain('.config')
    })
  })
})

describe('isDirectory / isFile', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
  })

  describe('isDirectory', () => {
    it('should return true for directories', () => {
      expect(storage.isDirectory('/')).toBe(true)
      expect(storage.isDirectory('/home')).toBe(true)
      expect(storage.isDirectory('/home/user')).toBe(true)
    })

    it('should return false for files', () => {
      expect(storage.isDirectory('/home/user/hello.txt')).toBe(false)
    })

    it('should return false for nonexistent paths', () => {
      expect(storage.isDirectory('/nonexistent')).toBe(false)
    })
  })

  describe('isFile', () => {
    it('should return true for files', () => {
      expect(storage.isFile('/home/user/hello.txt')).toBe(true)
      expect(storage.isFile('/home/user/data.json')).toBe(true)
    })

    it('should return false for directories', () => {
      expect(storage.isFile('/home')).toBe(false)
      expect(storage.isFile('/home/user')).toBe(false)
    })

    it('should return false for nonexistent paths', () => {
      expect(storage.isFile('/nonexistent.txt')).toBe(false)
    })
  })
})

describe('path operations', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = new InMemoryStorage()
  })

  describe('normalizePath', () => {
    it('should normalize paths with double slashes', () => {
      storage.addDirectory('/home')
      storage.addFile('/home//test.txt', 'content')

      expect(storage.has('/home/test.txt')).toBe(true)
    })

    it('should resolve . in paths', () => {
      storage.addDirectory('/home')
      storage.addFile('/home/./test.txt', 'content')

      expect(storage.has('/home/test.txt')).toBe(true)
    })

    it('should resolve .. in paths', () => {
      storage.addDirectory('/home')
      storage.addDirectory('/home/user')
      storage.addFile('/home/user/../test.txt', 'content')

      expect(storage.has('/home/test.txt')).toBe(true)
    })

    it('should handle complex path normalization', () => {
      storage.addDirectory('/home')
      storage.addDirectory('/home/user')
      storage.addFile('/home/user/./foo/../test.txt', 'content')

      expect(storage.has('/home/user/test.txt')).toBe(true)
    })

    it('should add leading slash if missing', () => {
      const normalized = storage.normalizePath('home/user')
      expect(normalized).toBe('/home/user')
    })
  })

  describe('getParentPath', () => {
    it('should return parent path', () => {
      expect(storage.getParentPath('/home/user/file.txt')).toBe('/home/user')
    })

    it('should return / for root children', () => {
      expect(storage.getParentPath('/home')).toBe('/')
    })

    it('should return / for root', () => {
      expect(storage.getParentPath('/')).toBe('/')
    })
  })

  describe('getFileName', () => {
    it('should return file name', () => {
      expect(storage.getFileName('/home/user/file.txt')).toBe('file.txt')
    })

    it('should return directory name', () => {
      expect(storage.getFileName('/home/user')).toBe('user')
    })

    it('should return empty string for root', () => {
      expect(storage.getFileName('/')).toBe('')
    })
  })
})

describe('MockDurableObjectStub directory operations', () => {
  let stub: MockDurableObjectStub
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    stub = new MockDurableObjectStub(storage)
  })

  describe('mkdir RPC', () => {
    it('should create directory via RPC', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'mkdir',
          params: { path: '/home/user/newdir', recursive: false },
        }),
      })

      expect(response.status).toBe(200)
      expect(storage.isDirectory('/home/user/newdir')).toBe(true)
    })

    it('should create recursive directories via RPC', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'mkdir',
          params: { path: '/home/user/a/b/c', recursive: true },
        }),
      })

      expect(response.status).toBe(200)
      expect(storage.isDirectory('/home/user/a/b/c')).toBe(true)
      expect(storage.isDirectory('/home/user/a/b')).toBe(true)
      expect(storage.isDirectory('/home/user/a')).toBe(true)
    })

    it('should return 400 when parent does not exist and not recursive', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'mkdir',
          params: { path: '/nonexistent/parent/dir', recursive: false },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('ENOENT')
    })

    it('should return 400 when directory already exists and not recursive', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'mkdir',
          params: { path: '/home/user', recursive: false },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EEXIST')
    })

    it('should succeed when directory exists and recursive is true', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'mkdir',
          params: { path: '/home/user', recursive: true },
        }),
      })

      expect(response.status).toBe(200)
    })
  })

  describe('rmdir RPC', () => {
    it('should remove empty directory via RPC', async () => {
      storage.addDirectory('/home/user/empty')

      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'rmdir',
          params: { path: '/home/user/empty', recursive: false },
        }),
      })

      expect(response.status).toBe(200)
      expect(storage.has('/home/user/empty')).toBe(false)
    })

    it('should return 400 when directory is not empty and not recursive', async () => {
      // /home/user has files in it
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'rmdir',
          params: { path: '/home/user', recursive: false },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('ENOTEMPTY')
    })

    it('should remove directory and contents recursively', async () => {
      storage.addDirectory('/home/user/toremove')
      storage.addFile('/home/user/toremove/file.txt', 'content')
      storage.addDirectory('/home/user/toremove/subdir')

      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'rmdir',
          params: { path: '/home/user/toremove', recursive: true },
        }),
      })

      expect(response.status).toBe(200)
      expect(storage.has('/home/user/toremove')).toBe(false)
      expect(storage.has('/home/user/toremove/file.txt')).toBe(false)
      expect(storage.has('/home/user/toremove/subdir')).toBe(false)
    })

    it('should return 400 when directory does not exist', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'rmdir',
          params: { path: '/nonexistent', recursive: false },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('ENOENT')
    })

    it('should return 400 when path is a file', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'rmdir',
          params: { path: '/home/user/hello.txt', recursive: false },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('ENOTDIR')
    })
  })

  describe('readdir RPC', () => {
    it('should list directory contents via RPC', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readdir',
          params: { path: '/home/user', withFileTypes: false },
        }),
      })

      expect(response.status).toBe(200)
      const children = (await response.json()) as string[]
      expect(children).toContain('hello.txt')
      expect(children).toContain('data.json')
    })

    it('should return dirent objects with withFileTypes', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readdir',
          params: { path: '/home', withFileTypes: true },
        }),
      })

      expect(response.status).toBe(200)
      const children = (await response.json()) as Array<{ name: string; type: string }>
      const userEntry = children.find((c) => c.name === 'user')
      expect(userEntry).toBeDefined()
      expect(userEntry?.type).toBe('directory')
    })

    it('should return 400 for nonexistent directory', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readdir',
          params: { path: '/nonexistent', withFileTypes: false },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('ENOENT')
    })

    it('should return 400 for file path', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readdir',
          params: { path: '/home/user/hello.txt', withFileTypes: false },
        }),
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('ENOTDIR')
    })
  })
})
