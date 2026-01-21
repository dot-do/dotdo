/**
 * Integration tests for primitives (fsx, gitx, bashx) via $ context (do-5ljl)
 *
 * These tests verify that:
 * 1. Primitives are accessible via $ context ($.fs, $.git, $.bash)
 * 2. Basic operations work through the $ context
 * 3. Primitives are properly typed
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createContext,
  type WorkflowContext,
  type FsCapability,
  type GitCapability,
  type BashCapability,
} from '../workflow/context'

// Mock DurableObjectState
const mockState = {
  id: { toString: () => 'test-id' },
  storage: {
    get: vi.fn(),
    put: vi.fn(),
    list: vi.fn(() => Promise.resolve(new Map())),
  },
} as unknown as DurableObjectState

// Mock FsCapability
function createMockFsCapability(): FsCapability {
  const fileStore = new Map<string, string | Uint8Array>()
  const dirStore = new Set<string>(['/'])

  return {
    name: 'fs' as const,
    initialized: true,

    async initialize() {},
    async dispose() {},

    async readFile(path: string, options?: { encoding?: string }) {
      const content = fileStore.get(path)
      if (!content) {
        const error = new Error(`ENOENT: no such file or directory, open '${path}'`)
        ;(error as any).code = 'ENOENT'
        throw error
      }
      if (options?.encoding) {
        return typeof content === 'string' ? content : new TextDecoder().decode(content)
      }
      return typeof content === 'string' ? new TextEncoder().encode(content) : content
    },

    async writeFile(path: string, data: string | Uint8Array) {
      fileStore.set(path, data)
    },

    async exists(path: string) {
      return fileStore.has(path) || dirStore.has(path)
    },

    async mkdir(path: string, options?: { recursive?: boolean }) {
      if (options?.recursive) {
        const parts = path.split('/').filter(Boolean)
        let current = ''
        for (const part of parts) {
          current += '/' + part
          dirStore.add(current)
        }
      } else {
        dirStore.add(path)
      }
    },

    async readdir(path: string) {
      const entries: string[] = []
      for (const [filePath] of fileStore) {
        if (filePath.startsWith(path + '/')) {
          const relative = filePath.slice(path.length + 1)
          if (!relative.includes('/')) {
            entries.push(relative)
          }
        }
      }
      return entries
    },

    async stat(path: string) {
      const exists = fileStore.has(path) || dirStore.has(path)
      if (!exists) {
        const error = new Error(`ENOENT: no such file or directory, stat '${path}'`)
        ;(error as any).code = 'ENOENT'
        throw error
      }
      return {
        isFile: () => fileStore.has(path),
        isDirectory: () => dirStore.has(path),
        isSymbolicLink: () => false,
        size: fileStore.has(path) ? (fileStore.get(path)?.length || 0) : 0,
        mode: 0o644,
        mtime: new Date(),
        atime: new Date(),
        ctime: new Date(),
        birthtime: new Date(),
      }
    },

    async unlink(path: string) {
      fileStore.delete(path)
    },

    async rmdir(path: string) {
      dirStore.delete(path)
    },

    async rm(path: string, options?: { recursive?: boolean; force?: boolean }) {
      if (fileStore.has(path)) {
        fileStore.delete(path)
      } else if (dirStore.has(path)) {
        dirStore.delete(path)
      } else if (!options?.force) {
        const error = new Error(`ENOENT: no such file or directory, rm '${path}'`)
        ;(error as any).code = 'ENOENT'
        throw error
      }
    },
  } as FsCapability
}

// Mock GitCapability
function createMockGitCapability(): GitCapability {
  const stagedFiles = new Set<string>()
  let currentCommit: string | undefined
  let lastSync: Date | undefined

  return {
    name: 'git' as const,

    get binding() {
      return {
        repo: 'test-org/test-repo',
        branch: 'main',
        commit: currentCommit,
        lastSync,
      }
    },

    async initialize() {},
    async dispose() {},

    async sync() {
      lastSync = new Date()
      return {
        success: true,
        objectsFetched: 0,
        filesWritten: 0,
        commit: currentCommit,
      }
    },

    async push() {
      return {
        success: true,
        objectsPushed: stagedFiles.size,
        commit: currentCommit,
      }
    },

    async status() {
      return {
        branch: 'main',
        head: currentCommit,
        staged: Array.from(stagedFiles),
        unstaged: [],
        clean: stagedFiles.size === 0,
      }
    },

    async add(files: string | string[]) {
      const filesToAdd = Array.isArray(files) ? files : [files]
      for (const file of filesToAdd) {
        stagedFiles.add(file)
      }
    },

    async commit(message: string) {
      const hash = 'abc123' + Math.random().toString(36).slice(2, 8)
      currentCommit = hash
      stagedFiles.clear()
      return { hash }
    },

    async diff() {
      return 'diff --git a/ b/\n(mock diff)'
    },

    async log() {
      if (currentCommit) {
        return [{ hash: currentCommit, message: 'Test commit' }]
      }
      return []
    },

    async pull() {
      await this.sync()
    },
  } as GitCapability
}

// Mock BashCapability
function createMockBashCapability(): BashCapability {
  return {
    name: 'bash' as const,

    async initialize() {},
    async dispose() {},

    async exec(command: string, args?: string[], options?: { timeout?: number; cwd?: string }) {
      const fullCommand = args ? `${command} ${args.join(' ')}` : command

      // Simple mock responses
      if (command === 'echo') {
        return {
          command: fullCommand,
          stdout: (args || []).join(' ') + '\n',
          stderr: '',
          exitCode: 0,
        }
      }

      if (command === 'ls') {
        return {
          command: fullCommand,
          stdout: 'file1.txt\nfile2.txt\n',
          stderr: '',
          exitCode: 0,
        }
      }

      if (command === 'pwd') {
        return {
          command: fullCommand,
          stdout: options?.cwd || '/home/user\n',
          stderr: '',
          exitCode: 0,
        }
      }

      // Default response
      return {
        command: fullCommand,
        stdout: '',
        stderr: '',
        exitCode: 0,
      }
    },

    async run(script: string) {
      return {
        command: script,
        stdout: 'Script executed\n',
        stderr: '',
        exitCode: 0,
      }
    },

    parse(input: string) {
      return { type: 'Program', commands: [] } as any
    },

    analyze(input: string) {
      return {
        classification: { type: 'read', impact: 'none', reversible: true },
        intent: { commands: [], reads: [], writes: [], deletes: [], network: false, elevated: false },
      }
    },

    isDangerous(input: string) {
      if (input.includes('rm -rf /')) {
        return { dangerous: true, reason: 'Potentially destructive command' }
      }
      return { dangerous: false }
    },
  } as BashCapability
}

describe('Primitives via $ Context (do-5ljl)', () => {
  describe('$.fs (FsCapability)', () => {
    let $: WorkflowContext
    let mockFs: FsCapability

    beforeEach(() => {
      mockFs = createMockFsCapability()
      $ = createContext(mockState, {}, { fs: mockFs })
    })

    it('should have $.fs available when wired', () => {
      expect($.fs).toBeDefined()
      expect($.fs).toBe(mockFs)
    })

    it('should write and read files via $.fs', async () => {
      await $.fs!.writeFile('/test.txt', 'Hello, World!')
      const content = await $.fs!.readFile('/test.txt', { encoding: 'utf-8' })
      expect(content).toBe('Hello, World!')
    })

    it('should check file existence via $.fs', async () => {
      expect(await $.fs!.exists('/nonexistent.txt')).toBe(false)
      await $.fs!.writeFile('/exists.txt', 'content')
      expect(await $.fs!.exists('/exists.txt')).toBe(true)
    })

    it('should create directories via $.fs', async () => {
      await $.fs!.mkdir('/app/src', { recursive: true })
      expect(await $.fs!.exists('/app')).toBe(true)
      expect(await $.fs!.exists('/app/src')).toBe(true)
    })

    it('should list directory contents via $.fs', async () => {
      await $.fs!.mkdir('/project', { recursive: true })
      await $.fs!.writeFile('/project/index.ts', 'export {}')
      await $.fs!.writeFile('/project/package.json', '{}')
      const entries = await $.fs!.readdir('/project')
      expect(entries).toContain('index.ts')
      expect(entries).toContain('package.json')
    })

    it('should get file stats via $.fs', async () => {
      await $.fs!.writeFile('/file.txt', 'content')
      const stats = await $.fs!.stat('/file.txt')
      expect(stats.isFile()).toBe(true)
      expect(stats.isDirectory()).toBe(false)
    })

    it('should delete files via $.fs', async () => {
      await $.fs!.writeFile('/temp.txt', 'temporary')
      expect(await $.fs!.exists('/temp.txt')).toBe(true)
      await $.fs!.unlink('/temp.txt')
      expect(await $.fs!.exists('/temp.txt')).toBe(false)
    })
  })

  describe('$.git (GitCapability)', () => {
    let $: WorkflowContext
    let mockGit: GitCapability

    beforeEach(() => {
      mockGit = createMockGitCapability()
      $ = createContext(mockState, {}, { git: mockGit })
    })

    it('should have $.git available when wired', () => {
      expect($.git).toBeDefined()
      expect($.git).toBe(mockGit)
    })

    it('should get repository binding via $.git', () => {
      const binding = $.git!.binding
      expect(binding.repo).toBe('test-org/test-repo')
      expect(binding.branch).toBe('main')
    })

    it('should sync repository via $.git', async () => {
      const result = await $.git!.sync()
      expect(result.success).toBe(true)
    })

    it('should get repository status via $.git', async () => {
      const status = await $.git!.status()
      expect(status.branch).toBe('main')
      expect(status.clean).toBe(true)
    })

    it('should stage files via $.git', async () => {
      await $.git!.add('src/index.ts')
      const status = await $.git!.status()
      expect(status.staged).toContain('src/index.ts')
      expect(status.clean).toBe(false)
    })

    it('should commit changes via $.git', async () => {
      await $.git!.add('src/index.ts')
      const result = await $.git!.commit('feat: add index file')
      expect(result.hash).toBeDefined()

      // After commit, staged files should be cleared
      const status = await $.git!.status()
      expect(status.staged).toHaveLength(0)
      expect(status.head).toBe(result.hash)
    })

    it('should push changes via $.git', async () => {
      await $.git!.add('file.txt')
      await $.git!.commit('add file')
      const result = await $.git!.push()
      expect(result.success).toBe(true)
    })

    it('should get commit log via $.git', async () => {
      await $.git!.add('file.txt')
      await $.git!.commit('initial commit')
      const log = await $.git!.log()
      expect(log).toHaveLength(1)
      expect(log[0].hash).toBeDefined()
    })
  })

  describe('$.bash (BashCapability)', () => {
    let $: WorkflowContext
    let mockBash: BashCapability

    beforeEach(() => {
      mockBash = createMockBashCapability()
      $ = createContext(mockState, {}, { bash: mockBash })
    })

    it('should have $.bash available when wired', () => {
      expect($.bash).toBeDefined()
      expect($.bash).toBe(mockBash)
    })

    it('should execute simple commands via $.bash', async () => {
      const result = await $.bash!.exec('echo', ['Hello', 'World'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Hello World\n')
    })

    it('should execute ls command via $.bash', async () => {
      const result = await $.bash!.exec('ls')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('file1.txt')
    })

    it('should support cwd option via $.bash', async () => {
      const result = await $.bash!.exec('pwd', [], { cwd: '/app' })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('/app')
    })

    it('should run scripts via $.bash', async () => {
      const result = await $.bash!.run('npm install && npm run build')
      expect(result.exitCode).toBe(0)
    })

    it('should check dangerous commands via $.bash', () => {
      const safeCheck = $.bash!.isDangerous('ls -la')
      expect(safeCheck.dangerous).toBe(false)

      const dangerousCheck = $.bash!.isDangerous('rm -rf /')
      expect(dangerousCheck.dangerous).toBe(true)
      expect(dangerousCheck.reason).toBeDefined()
    })

    it('should analyze commands via $.bash', () => {
      const analysis = $.bash!.analyze('echo hello')
      expect(analysis.classification).toBeDefined()
      expect(analysis.intent).toBeDefined()
    })
  })

  describe('Combined primitives', () => {
    let $: WorkflowContext
    let mockFs: FsCapability
    let mockGit: GitCapability
    let mockBash: BashCapability

    beforeEach(() => {
      mockFs = createMockFsCapability()
      mockGit = createMockGitCapability()
      mockBash = createMockBashCapability()
      $ = createContext(mockState, {}, { fs: mockFs, git: mockGit, bash: mockBash })
    })

    it('should have all primitives available when wired together', () => {
      expect($.fs).toBeDefined()
      expect($.git).toBeDefined()
      expect($.bash).toBeDefined()
    })

    it('should support workflow combining fs and git operations', async () => {
      // Write a file
      await $.fs!.writeFile('/src/index.ts', 'console.log("Hello")')

      // Stage and commit
      await $.git!.add('/src/index.ts')
      const commit = await $.git!.commit('feat: add hello world')

      expect(commit.hash).toBeDefined()

      // Verify file still exists
      expect(await $.fs!.exists('/src/index.ts')).toBe(true)
    })

    it('should support workflow combining bash and fs operations', async () => {
      // Create a file using fs
      await $.fs!.mkdir('/project', { recursive: true })
      await $.fs!.writeFile('/project/script.sh', '#!/bin/bash\necho "Hello"')

      // Execute a command (mocked)
      const result = await $.bash!.exec('ls', [], { cwd: '/project' })
      expect(result.exitCode).toBe(0)

      // Clean up using fs
      await $.fs!.rm('/project/script.sh')
    })
  })

  describe('Context without primitives', () => {
    it('should have undefined primitives when not wired', () => {
      const $ = createContext(mockState, {})
      expect($.fs).toBeUndefined()
      expect($.git).toBeUndefined()
      expect($.bash).toBeUndefined()
    })

    it('should still have other context features without primitives', () => {
      const $ = createContext(mockState, {})
      expect($.send).toBeDefined()
      expect($.try).toBeDefined()
      expect($.do).toBeDefined()
      expect($.on).toBeDefined()
      expect($.every).toBeDefined()
      expect($.integrations).toBeDefined()
    })
  })
})
