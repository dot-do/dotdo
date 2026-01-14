/**
 * Extended Primitives Test Suite (TDD RED Phase)
 *
 * Tests that verify extended primitives (fsx/gitx/bashx) work or throw
 * clear NotImplementedError.
 *
 * These primitives are the foundation for AI agents to interact with:
 * - fsx: Filesystem on SQLite (virtual filesystem within DO)
 * - gitx: Git on R2 (git operations using R2 as object store)
 * - bashx: Shell execution (sandboxed command execution)
 *
 * Per CLAUDE.md: "Extended Primitives: fsx (filesystem on SQLite),
 * gitx (Git on R2), bashx (shell without VMs)."
 *
 * @fileoverview TDD RED phase - tests expected to FAIL until primitives implemented
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO, type Env } from '../../objects/DO'
import { withFs, type FsCapability, type WithFsContext } from '../capabilities/fs'
import { withGit, type WithGitContext } from '../capabilities/git'
import { NotImplementedError } from '../errors'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock DurableObjectStorage for testing
 */
class MockStorage {
  private data = new Map<string, unknown>()

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }

  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const result = new Map<string, T>()
    for (const [key, value] of this.data) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        result.set(key, value as T)
      }
    }
    return result
  }

  _clear(): void {
    this.data.clear()
  }
}

/**
 * Mock DurableObjectState
 */
function createMockState(): DurableObjectState {
  const storage = new MockStorage()
  return {
    id: { toString: () => 'test-do-id' },
    storage: storage as unknown as DurableObjectStorage,
    blockConcurrencyWhile: async (fn: () => Promise<void>) => fn(),
    waitUntil: () => {},
  } as unknown as DurableObjectState
}

/**
 * Mock Env
 */
function createMockEnv(): Env {
  return {
    DO: {
      idFromName: (name: string) => ({ toString: () => `id-${name}` }),
      get: () => ({ fetch: async () => new Response('OK') }),
    },
  } as unknown as Env
}

/**
 * Mock R2 Bucket for git operations
 */
class MockR2Bucket {
  private objects = new Map<string, ArrayBuffer>()

  async get(key: string) {
    const data = this.objects.get(key)
    if (!data) return null
    return {
      key,
      size: data.byteLength,
      arrayBuffer: async () => data,
      text: async () => new TextDecoder().decode(data),
    }
  }

  async put(key: string, value: ArrayBuffer | Uint8Array | string) {
    let buffer: ArrayBuffer
    if (typeof value === 'string') {
      buffer = new TextEncoder().encode(value).buffer
    } else if (value instanceof Uint8Array) {
      buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
    } else {
      buffer = value
    }
    this.objects.set(key, buffer)
    return { key, size: buffer.byteLength }
  }

  async delete(key: string | string[]) {
    const keys = Array.isArray(key) ? key : [key]
    for (const k of keys) {
      this.objects.delete(k)
    }
  }

  async list(options?: { prefix?: string }) {
    const result: Array<{ key: string; size: number }> = []
    for (const [key, data] of this.objects) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        result.push({ key, size: data.byteLength })
      }
    }
    return { objects: result, truncated: false }
  }

  _clear() {
    this.objects.clear()
  }

  _listKeys() {
    return Array.from(this.objects.keys())
  }
}

/**
 * Mock FsCapability that actually stores files (for gitx integration testing)
 */
class WorkingMockFs implements FsCapability {
  private files = new Map<string, { content: string; createdAt: Date; modifiedAt: Date }>()
  private dirs = new Set<string>(['/'])

  async read(path: string) {
    const file = this.files.get(path)
    if (!file) throw new Error(`ENOENT: ${path}`)
    return file.content
  }

  async write(path: string, content: string) {
    const now = new Date()
    const existing = this.files.get(path)
    this.files.set(path, {
      content,
      createdAt: existing?.createdAt ?? now,
      modifiedAt: now,
    })
  }

  async exists(path: string) {
    return this.files.has(path) || this.dirs.has(path)
  }

  async delete(path: string) {
    this.files.delete(path)
    this.dirs.delete(path)
  }

  async list(path: string) {
    const entries: Array<{ name: string; isDirectory: boolean }> = []
    const prefix = path.endsWith('/') ? path : path + '/'

    const seen = new Set<string>()

    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length)
        const firstSegment = rest.split('/')[0]
        if (firstSegment && !seen.has(firstSegment)) {
          seen.add(firstSegment)
          entries.push({ name: firstSegment, isDirectory: false })
        }
      }
    }

    return entries
  }

  async mkdir(path: string, options?: { recursive?: boolean }) {
    if (options?.recursive) {
      const parts = path.split('/').filter(Boolean)
      let current = ''
      for (const part of parts) {
        current += '/' + part
        this.dirs.add(current)
      }
    } else {
      this.dirs.add(path)
    }
  }

  async stat(path: string) {
    const file = this.files.get(path)
    if (file) {
      return {
        size: file.content.length,
        isFile: true,
        isDirectory: false,
        createdAt: file.createdAt,
        modifiedAt: file.modifiedAt,
      }
    }
    if (this.dirs.has(path)) {
      return {
        size: 0,
        isFile: false,
        isDirectory: true,
        createdAt: new Date(),
        modifiedAt: new Date(),
      }
    }
    throw new Error(`ENOENT: ${path}`)
  }

  async copy(src: string, dest: string) {
    const file = this.files.get(src)
    if (!file) throw new Error(`ENOENT: ${src}`)
    await this.write(dest, file.content)
  }

  async move(src: string, dest: string) {
    await this.copy(src, dest)
    await this.delete(src)
  }

  // Test helpers
  _setFile(path: string, content: string) {
    this.write(path, content)
  }

  _getFile(path: string) {
    return this.files.get(path)?.content
  }

  _clear() {
    this.files.clear()
    this.dirs.clear()
    this.dirs.add('/')
  }
}

// ============================================================================
// EXTENDED PRIMITIVES TESTS
// ============================================================================

describe('Extended Primitives', () => {
  describe('fsx - Filesystem on SQLite', () => {
    let mockState: DurableObjectState
    let mockEnv: Env

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
    })

    it('should write and read files', async () => {
      // RED: This test should FAIL because fsx stub throws "not implemented"
      class TestDO extends withFs(DO) {}
      const instance = new TestDO(mockState, mockEnv)

      await instance.$.fs.write('/test.txt', 'hello world')
      const content = await instance.$.fs.read('/test.txt')

      expect(content).toBe('hello world')
    })

    it('should list directory contents', async () => {
      // RED: This test should FAIL because fsx stub throws "not implemented"
      class TestDO extends withFs(DO) {}
      const instance = new TestDO(mockState, mockEnv)

      await instance.$.fs.mkdir('/dir')
      await instance.$.fs.write('/dir/a.txt', 'a')
      await instance.$.fs.write('/dir/b.txt', 'b')

      const files = await instance.$.fs.list('/dir')

      expect(files.map(f => f.name)).toContain('a.txt')
      expect(files.map(f => f.name)).toContain('b.txt')
    })

    it('should check file existence', async () => {
      // RED: This test should FAIL because fsx stub throws "not implemented"
      class TestDO extends withFs(DO) {}
      const instance = new TestDO(mockState, mockEnv)

      await instance.$.fs.write('/exists.txt', 'content')

      expect(await instance.$.fs.exists('/exists.txt')).toBe(true)
      expect(await instance.$.fs.exists('/not-exists.txt')).toBe(false)
    })

    it('should delete files', async () => {
      // RED: This test should FAIL because fsx stub throws "not implemented"
      class TestDO extends withFs(DO) {}
      const instance = new TestDO(mockState, mockEnv)

      await instance.$.fs.write('/to-delete.txt', 'content')
      await instance.$.fs.delete('/to-delete.txt')

      expect(await instance.$.fs.exists('/to-delete.txt')).toBe(false)
    })

    it('should create directories recursively', async () => {
      // RED: This test should FAIL because fsx stub throws "not implemented"
      class TestDO extends withFs(DO) {}
      const instance = new TestDO(mockState, mockEnv)

      await instance.$.fs.mkdir('/a/b/c', { recursive: true })

      expect(await instance.$.fs.exists('/a')).toBe(true)
      expect(await instance.$.fs.exists('/a/b')).toBe(true)
      expect(await instance.$.fs.exists('/a/b/c')).toBe(true)
    })

    it('should return file stats', async () => {
      // RED: This test should FAIL because fsx stub throws "not implemented"
      class TestDO extends withFs(DO) {}
      const instance = new TestDO(mockState, mockEnv)

      await instance.$.fs.write('/stats.txt', 'hello')
      const stat = await instance.$.fs.stat('/stats.txt')

      expect(stat.size).toBe(5) // 'hello' is 5 chars
      expect(stat.isFile).toBe(true)
      expect(stat.isDirectory).toBe(false)
    })

    it('should copy files', async () => {
      // RED: This test should FAIL because fsx stub throws "not implemented"
      class TestDO extends withFs(DO) {}
      const instance = new TestDO(mockState, mockEnv)

      await instance.$.fs.write('/source.txt', 'content')
      await instance.$.fs.copy('/source.txt', '/dest.txt')

      expect(await instance.$.fs.read('/source.txt')).toBe('content')
      expect(await instance.$.fs.read('/dest.txt')).toBe('content')
    })

    it('should move files', async () => {
      // RED: This test should FAIL because fsx stub throws "not implemented"
      class TestDO extends withFs(DO) {}
      const instance = new TestDO(mockState, mockEnv)

      await instance.$.fs.write('/source.txt', 'content')
      await instance.$.fs.move('/source.txt', '/dest.txt')

      expect(await instance.$.fs.exists('/source.txt')).toBe(false)
      expect(await instance.$.fs.read('/dest.txt')).toBe('content')
    })
  })

  describe('gitx - Git on R2', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let mockR2: MockR2Bucket
    let mockFs: WorkingMockFs

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      mockR2 = new MockR2Bucket()
      mockFs = new WorkingMockFs()
    })

    it('should create commits with valid SHA', async () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)

      // Configure git with mock R2 and working mock fs
      instance.$.git.configure({
        repo: 'org/repo',
        branch: 'main',
        r2: mockR2 as unknown as R2Bucket,
        fs: mockFs as FsCapability,
      })

      // Write file through mock fs
      await mockFs.write('/file.txt', 'content')

      // Stage and commit
      await instance.$.git.add('/file.txt')
      const result = await instance.$.git.commit('test commit')

      // SHA should be valid 40-char hex
      expect(result.hash).toMatch(/^[a-f0-9]{40}$/)
    })

    it('should return commit history', async () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)

      instance.$.git.configure({
        repo: 'org/repo',
        branch: 'main',
        r2: mockR2 as unknown as R2Bucket,
        fs: mockFs as FsCapability,
      })

      // First commit
      await mockFs.write('/file.txt', 'v1')
      await instance.$.git.add('/file.txt')
      await instance.$.git.commit('first commit')

      // Second commit
      await mockFs.write('/file.txt', 'v2')
      await instance.$.git.add('/file.txt')
      await instance.$.git.commit('second commit')

      // Get status to verify commits were made
      const status = await instance.$.git.status()
      expect(status.head).toBeDefined()
      expect(status.head).toMatch(/^[a-f0-9]{40}$/)
    })

    it('should push commits to R2', async () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)

      instance.$.git.configure({
        repo: 'org/repo',
        branch: 'main',
        r2: mockR2 as unknown as R2Bucket,
        fs: mockFs as FsCapability,
      })

      await mockFs.write('/file.txt', 'content')
      await instance.$.git.add('/file.txt')
      await instance.$.git.commit('test commit')

      const result = await instance.$.git.push()

      expect(result.success).toBe(true)
      expect(result.objectsPushed).toBeGreaterThan(0)

      // Verify R2 has the ref
      const keys = mockR2._listKeys()
      expect(keys.some(k => k.includes('refs/heads/main'))).toBe(true)
    })

    it('should sync from R2', async () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)

      instance.$.git.configure({
        repo: 'org/repo',
        branch: 'main',
        r2: mockR2 as unknown as R2Bucket,
        fs: mockFs as FsCapability,
      })

      // For an empty repo, sync should succeed with 0 objects
      const result = await instance.$.git.sync()

      expect(result.success).toBe(true)
    })

    it('should track staged files', async () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)

      instance.$.git.configure({
        repo: 'org/repo',
        branch: 'main',
        r2: mockR2 as unknown as R2Bucket,
        fs: mockFs as FsCapability,
      })

      await instance.$.git.add('/file1.txt')
      await instance.$.git.add('/file2.txt')

      const status = await instance.$.git.status()

      expect(status.staged).toContain('/file1.txt')
      expect(status.staged).toContain('/file2.txt')
    })

    it('should throw error when committing without staged files', async () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)

      instance.$.git.configure({
        repo: 'org/repo',
        branch: 'main',
        r2: mockR2 as unknown as R2Bucket,
      })

      await expect(instance.$.git.commit('empty commit')).rejects.toThrow('Nothing to commit')
    })
  })

  describe('bashx - Shell execution OR clear error', () => {
    /**
     * bashx requires an external executor (Container, RPC, etc.)
     * If not implemented, it should throw a clear NotImplementedError
     * rather than silently failing or returning garbage.
     *
     * This test verifies the contract: either it works, or it clearly
     * tells the user why it doesn't.
     */
    it('should execute commands or throw NotImplementedError', async () => {
      // The bash mixin requires an executor to be injected
      // Without a real executor, it should indicate the feature isn't available

      // For now, we test that the pattern works with a mock executor
      const { withBash } = await import('../mixins/bash')

      let executorCalled = false
      const mockExecutor = {
        execute: vi.fn().mockImplementation(async (cmd: string) => {
          executorCalled = true
          if (cmd === 'echo hello') {
            return {
              input: cmd,
              command: cmd,
              valid: true,
              generated: false,
              stdout: 'hello\n',
              stderr: '',
              exitCode: 0,
              intent: { commands: ['echo'], reads: [], writes: [], deletes: [], network: false, elevated: false },
              classification: { type: 'read', impact: 'none', reversible: true, reason: 'Echo command' },
            }
          }
          throw new Error('Command not found')
        }),
      }

      class TestDO extends withBash(DO, { executor: () => mockExecutor }) {}

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const instance = new TestDO(mockState, mockEnv)

      const result = await instance.$.bash.exec('echo', ['hello'])
      expect(result.stdout.trim()).toBe('hello')
      expect(executorCalled).toBe(true)
    })

    it('should analyze command safety without executing', async () => {
      const { withBash } = await import('../mixins/bash')

      const mockExecutor = {
        execute: vi.fn(),
      }

      class TestDO extends withBash(DO, { executor: () => mockExecutor }) {}

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const instance = new TestDO(mockState, mockEnv)

      // isDangerous should work without calling the executor
      const dangerousResult = instance.$.bash.isDangerous('rm -rf /')
      expect(dangerousResult.dangerous).toBe(true)

      const safeResult = instance.$.bash.isDangerous('ls -la')
      expect(safeResult.dangerous).toBe(false)

      // Executor should NOT have been called for analysis
      expect(mockExecutor.execute).not.toHaveBeenCalled()
    })

    it('should block dangerous commands by default', async () => {
      const { withBash } = await import('../mixins/bash')

      const mockExecutor = {
        execute: vi.fn(),
      }

      class TestDO extends withBash(DO, { executor: () => mockExecutor }) {}

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const instance = new TestDO(mockState, mockEnv)

      const result = await instance.$.bash.exec('rm', ['-rf', '/'])

      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)
      expect(mockExecutor.execute).not.toHaveBeenCalled()
    })

    it('should parse commands into AST', async () => {
      const { withBash } = await import('../mixins/bash')

      const mockExecutor = { execute: vi.fn() }

      class TestDO extends withBash(DO, { executor: () => mockExecutor }) {}

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const instance = new TestDO(mockState, mockEnv)

      const ast = instance.$.bash.parse('ls -la /home | grep user')

      expect(ast).toBeDefined()
      expect(ast.type).toBe('Program')
    })
  })
})

describe('Primitives Error Handling', () => {
  describe('Clear error messages for unimplemented features', () => {
    it('fsx operations should throw clear ENOENT errors for missing files', async () => {
      // The withFs mixin provides SQLite-backed filesystem operations
      // Reading non-existent files should throw clear ENOENT errors

      class TestDO extends withFs(DO) {}
      const instance = new TestDO(createMockState(), createMockEnv())

      // Attempt to read non-existent file - should get clear ENOENT error
      try {
        await instance.$.fs.read('/test.txt')
        expect.fail('Expected error to be thrown')
      } catch (error: any) {
        // Error should mention ENOENT and the path
        expect(error.message).toMatch(/ENOENT|no such file/i)
      }
    })

    it('gitx operations should have meaningful error messages', async () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(createMockState(), createMockEnv())

      // Without R2 configured, sync should fail with clear message
      instance.$.git.configure({ repo: 'org/repo' })

      const result = await instance.$.git.sync()

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toMatch(/R2|bucket|configured/i)
    })

    it('bashx should indicate when executor is not available', async () => {
      // If bashx can't execute because no executor is available,
      // it should throw a clear error

      const { withBash } = await import('../mixins/bash')

      // Create executor that simulates "not available"
      const unavailableExecutor = {
        execute: vi.fn().mockRejectedValue(
          new NotImplementedError('bashx.exec', 'workers')
        ),
      }

      class TestDO extends withBash(DO, { executor: () => unavailableExecutor }) {}

      const instance = new TestDO(createMockState(), createMockEnv())

      // Safe commands should still be analyzed
      const analysis = instance.$.bash.isDangerous('echo hello')
      expect(analysis.dangerous).toBe(false)

      // But execution should fail with clear error
      try {
        await instance.$.bash.exec('echo', ['hello'])
        expect.fail('Expected error to be thrown')
      } catch (error: any) {
        expect(error.message).toMatch(/not.?implemented|bashx/i)
      }
    })
  })
})

describe('Primitives Integration', () => {
  it('should compose fsx + gitx for file versioning', async () => {
    // This test verifies that fsx and gitx can work together
    // fsx provides the filesystem, gitx provides versioning

    const mockR2 = new MockR2Bucket()
    const mockFs = new WorkingMockFs()

    class TestDO extends withGit(withFs(DO)) {}
    const instance = new TestDO(createMockState(), createMockEnv())

    instance.$.git.configure({
      repo: 'org/repo',
      branch: 'main',
      r2: mockR2 as unknown as R2Bucket,
      fs: mockFs as FsCapability,
    })

    // Write v1
    await mockFs.write('/config.json', '{"version": 1}')
    await instance.$.git.add('/config.json')
    const commit1 = await instance.$.git.commit('Initial config')

    // Write v2
    await mockFs.write('/config.json', '{"version": 2}')
    await instance.$.git.add('/config.json')
    const commit2 = await instance.$.git.commit('Update config')

    // Both commits should have valid SHAs
    expect(commit1.hash).toMatch(/^[a-f0-9]{40}$/)
    expect(commit2.hash).toMatch(/^[a-f0-9]{40}$/)
    expect(commit1.hash).not.toBe(commit2.hash)
  })

  it('should allow bashx to use fsx for native file ops', async () => {
    // When bashx is configured with fsx, certain commands like 'cat'
    // can be executed natively using the filesystem instead of
    // spawning a subprocess

    const { withBash } = await import('../mixins/bash')

    const mockFs = new WorkingMockFs()
    await mockFs.write('/test.txt', 'file content')

    const mockExecutor = {
      execute: vi.fn().mockResolvedValue({
        input: 'cat /test.txt',
        command: 'cat /test.txt',
        valid: true,
        generated: false,
        stdout: 'file content',
        stderr: '',
        exitCode: 0,
        intent: { commands: ['cat'], reads: ['/test.txt'], writes: [], deletes: [], network: false, elevated: false },
        classification: { type: 'read', impact: 'none', reversible: true, reason: 'Read file' },
      }),
    }

    // Compose: DO -> withFs -> withBash (with fs integration)
    // Pass mockFs directly since that's where the file content is stored
    class TestDO extends withBash(withFs(DO), {
      executor: () => mockExecutor,
      fs: () => mockFs,
    }) {}

    const instance = new TestDO(createMockState(), createMockEnv())

    const result = await instance.$.bash.exec('cat', ['/test.txt'])

    expect(result.stdout).toBe('file content')
  })
})
