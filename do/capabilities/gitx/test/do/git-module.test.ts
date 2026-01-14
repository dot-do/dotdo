/**
 * @fileoverview Tests for GitModule DO integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GitModule, createGitModule, isGitModule } from '../../src/do/GitModule'
import type { FsCapability, R2BucketLike, R2ObjectLike, R2ObjectsLike } from '../../src/do/GitModule'

// Mock R2 Bucket
function createMockR2Bucket(): R2BucketLike {
  const storage = new Map<string, Uint8Array>()

  return {
    async get(key: string): Promise<R2ObjectLike | null> {
      const data = storage.get(key)
      if (!data) return null
      return {
        key,
        size: data.length,
        async arrayBuffer() {
          return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        },
        async text() {
          return new TextDecoder().decode(data)
        }
      }
    },
    async put(key: string, value: ArrayBuffer | Uint8Array | string) {
      const data = typeof value === 'string'
        ? new TextEncoder().encode(value)
        : value instanceof Uint8Array
          ? value
          : new Uint8Array(value)
      storage.set(key, data)
      return {
        key,
        size: data.length,
        async arrayBuffer() {
          return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        },
        async text() {
          return new TextDecoder().decode(data)
        }
      }
    },
    async delete(key: string | string[]) {
      const keys = Array.isArray(key) ? key : [key]
      for (const k of keys) {
        storage.delete(k)
      }
    },
    async list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<R2ObjectsLike> {
      const prefix = options?.prefix ?? ''
      const objects: R2ObjectLike[] = []
      for (const [key, data] of storage) {
        if (key.startsWith(prefix)) {
          objects.push({
            key,
            size: data.length,
            async arrayBuffer() {
              return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
            },
            async text() {
              return new TextDecoder().decode(data)
            }
          })
        }
      }
      return { objects, truncated: false }
    }
  }
}

// Mock FsCapability
function createMockFs(): FsCapability {
  const files = new Map<string, Buffer>()
  const dirs = new Set<string>()

  return {
    async readFile(path: string): Promise<string | Buffer> {
      const content = files.get(path)
      if (!content) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`)
      }
      return content
    },
    async writeFile(path: string, content: string | Buffer): Promise<void> {
      files.set(path, Buffer.from(content))
    },
    async readDir(path: string): Promise<string[]> {
      const entries: string[] = []
      for (const file of files.keys()) {
        if (file.startsWith(path)) {
          const relative = file.slice(path.length).replace(/^\//, '')
          const firstSegment = relative.split('/')[0]
          if (firstSegment && !entries.includes(firstSegment)) {
            entries.push(firstSegment)
          }
        }
      }
      return entries
    },
    async exists(path: string): Promise<boolean> {
      return files.has(path) || dirs.has(path)
    },
    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      if (options?.recursive) {
        const parts = path.split('/').filter(Boolean)
        let current = ''
        for (const part of parts) {
          current += '/' + part
          dirs.add(current)
        }
      } else {
        dirs.add(path)
      }
    },
    async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
      if (options?.recursive) {
        for (const key of files.keys()) {
          if (key.startsWith(path)) {
            files.delete(key)
          }
        }
        for (const dir of dirs) {
          if (dir.startsWith(path)) {
            dirs.delete(dir)
          }
        }
      } else {
        files.delete(path)
        dirs.delete(path)
      }
    }
  }
}

describe('GitModule', () => {
  describe('constructor and binding', () => {
    it('should create a GitModule with required options', () => {
      const git = new GitModule({
        repo: 'org/repo'
      })

      expect(git.name).toBe('git')
      expect(git.binding.repo).toBe('org/repo')
      expect(git.binding.branch).toBe('main')
    })

    it('should create a GitModule with all options', () => {
      const r2 = createMockR2Bucket()
      const fs = createMockFs()

      const git = new GitModule({
        repo: 'org/repo',
        branch: 'develop',
        path: 'packages/core',
        r2,
        fs,
        objectPrefix: 'custom/objects'
      })

      expect(git.binding.repo).toBe('org/repo')
      expect(git.binding.branch).toBe('develop')
      expect(git.binding.path).toBe('packages/core')
    })

    it('should report no commit initially', () => {
      const git = new GitModule({ repo: 'org/repo' })
      expect(git.binding.commit).toBeUndefined()
      expect(git.binding.lastSync).toBeUndefined()
    })
  })

  describe('createGitModule factory', () => {
    it('should create a GitModule instance', () => {
      const git = createGitModule({ repo: 'test/repo' })
      expect(git).toBeInstanceOf(GitModule)
      expect(git.binding.repo).toBe('test/repo')
    })
  })

  describe('isGitModule type guard', () => {
    it('should return true for GitModule instance', () => {
      const git = new GitModule({ repo: 'test/repo' })
      expect(isGitModule(git)).toBe(true)
    })

    it('should return false for non-GitModule values', () => {
      expect(isGitModule(null)).toBe(false)
      expect(isGitModule(undefined)).toBe(false)
      expect(isGitModule({})).toBe(false)
      expect(isGitModule({ name: 'git' })).toBe(false)
    })
  })

  describe('sync()', () => {
    it('should fail without R2 configured', async () => {
      const git = new GitModule({ repo: 'org/repo' })
      const result = await git.sync()

      expect(result.success).toBe(false)
      expect(result.error).toBe('R2 bucket not configured')
    })

    it('should fail without fs configured', async () => {
      const r2 = createMockR2Bucket()
      const git = new GitModule({ repo: 'org/repo', r2 })
      const result = await git.sync()

      expect(result.success).toBe(false)
      expect(result.error).toBe('Filesystem capability not available')
    })

    it('should handle empty repository (no ref)', async () => {
      const r2 = createMockR2Bucket()
      const fs = createMockFs()
      const git = new GitModule({ repo: 'org/repo', r2, fs })

      const result = await git.sync()

      expect(result.success).toBe(true)
      expect(result.objectsFetched).toBe(0)
      expect(result.filesWritten).toBe(0)
      expect(result.commit).toBeUndefined()
    })
  })

  describe('push()', () => {
    it('should fail without R2 configured', async () => {
      const git = new GitModule({ repo: 'org/repo' })
      const result = await git.push()

      expect(result.success).toBe(false)
      expect(result.error).toBe('R2 bucket not configured')
    })

    it('should fail without any commits', async () => {
      const r2 = createMockR2Bucket()
      const git = new GitModule({ repo: 'org/repo', r2 })
      const result = await git.push()

      expect(result.success).toBe(false)
      expect(result.error).toBe('No commits to push')
    })
  })

  describe('status()', () => {
    it('should return initial status', async () => {
      const git = new GitModule({ repo: 'org/repo', branch: 'main' })
      const status = await git.status()

      expect(status.branch).toBe('main')
      expect(status.head).toBeUndefined()
      expect(status.staged).toEqual([])
      expect(status.unstaged).toEqual([])
      expect(status.clean).toBe(true)
    })
  })

  describe('add()', () => {
    it('should stage a single file', async () => {
      const git = new GitModule({ repo: 'org/repo' })
      await git.add('src/index.ts')

      const status = await git.status()
      expect(status.staged).toContain('src/index.ts')
      expect(status.clean).toBe(false)
    })

    it('should stage multiple files', async () => {
      const git = new GitModule({ repo: 'org/repo' })
      await git.add(['src/a.ts', 'src/b.ts', 'src/c.ts'])

      const status = await git.status()
      expect(status.staged).toContain('src/a.ts')
      expect(status.staged).toContain('src/b.ts')
      expect(status.staged).toContain('src/c.ts')
      expect(status.staged.length).toBe(3)
    })
  })

  describe('commit()', () => {
    it('should fail with nothing staged', async () => {
      const git = new GitModule({ repo: 'org/repo' })

      await expect(git.commit('Test commit')).rejects.toThrow('Nothing to commit')
    })

    it('should create a commit with staged files', async () => {
      const git = new GitModule({ repo: 'org/repo' })
      await git.add('src/index.ts')

      const result = await git.commit('Add index.ts')

      expect(result).toBeDefined()
      const hash = typeof result === 'string' ? result : result.hash
      expect(hash).toMatch(/^[a-f0-9]{40}$/)
    })

    it('should clear staged files after commit', async () => {
      const git = new GitModule({ repo: 'org/repo' })
      await git.add('src/index.ts')
      await git.commit('Add index.ts')

      const status = await git.status()
      expect(status.staged).toEqual([])
      expect(status.clean).toBe(true)
    })

    it('should update head after commit', async () => {
      const git = new GitModule({ repo: 'org/repo' })
      await git.add('src/index.ts')
      const result = await git.commit('Add index.ts')

      const hash = typeof result === 'string' ? result : result.hash
      expect(git.binding.commit).toBe(hash)
    })
  })

  describe('diff()', () => {
    it('should return placeholder diff', async () => {
      const git = new GitModule({ repo: 'org/repo' })
      const diff = await git.diff()

      expect(diff).toContain('diff')
    })
  })

  describe('log()', () => {
    it('should return empty log for new repository', async () => {
      const git = new GitModule({ repo: 'org/repo' })
      const commits = await git.log()

      expect(commits).toEqual([])
    })

    it('should return commit after creating one', async () => {
      const git = new GitModule({ repo: 'org/repo' })
      await git.add('file.txt')
      await git.commit('Test commit')

      const commits = await git.log()
      expect(commits.length).toBe(1)
      expect(commits[0].hash).toBe(git.binding.commit)
    })
  })

  describe('pull()', () => {
    it('should be an alias for sync', async () => {
      const r2 = createMockR2Bucket()
      const fs = createMockFs()
      const git = new GitModule({ repo: 'org/repo', r2, fs })

      // Should not throw for empty repo
      await expect(git.pull()).resolves.toBeUndefined()
    })

    it('should throw error when sync fails', async () => {
      const git = new GitModule({ repo: 'org/repo' })

      await expect(git.pull()).rejects.toThrow('R2 bucket not configured')
    })
  })

  describe('initialize and dispose lifecycle', () => {
    it('should have initialize method', async () => {
      const git = new GitModule({ repo: 'org/repo' })
      await expect(git.initialize()).resolves.toBeUndefined()
    })

    it('should have dispose method', async () => {
      const git = new GitModule({ repo: 'org/repo' })
      await git.add('file.txt')
      await git.dispose()

      // After dispose, staged files should be cleared
      const status = await git.status()
      expect(status.staged).toEqual([])
    })
  })
})
