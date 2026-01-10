/**
 * Primitives Integration Tests
 *
 * Tests for the integration between fs, git, and bash capabilities
 * in the DOWithPrimitives preset. These tests verify that the capabilities
 * work together as expected for common workflows.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DOWithPrimitives } from '../presets/primitives'

// ============================================================================
// MOCK SETUP
// ============================================================================

// In-memory filesystem storage for integration testing
const createMockStorage = () => {
  const files = new Map<string, string>()
  const metadata = new Map<string, { size: number; isDirectory: boolean; createdAt: string; modifiedAt: string }>()
  const directories = new Set<string>()

  return {
    files,
    metadata,
    directories,
    get: vi.fn(async <T>(key: string): Promise<T | undefined> => {
      if (key.startsWith('fsx:file:')) {
        return files.get(key) as T | undefined
      }
      if (key.startsWith('fsx:meta:')) {
        return metadata.get(key) as T | undefined
      }
      if (key.startsWith('fsx:dir:')) {
        return directories.has(key) ? (true as T) : undefined
      }
      return undefined
    }),
    put: vi.fn(async (key: string, value: unknown) => {
      if (key.startsWith('fsx:file:')) {
        files.set(key, value as string)
      } else if (key.startsWith('fsx:meta:')) {
        metadata.set(key, value as any)
      } else if (key.startsWith('fsx:dir:')) {
        directories.add(key)
      }
    }),
    delete: vi.fn(async (key: string) => {
      files.delete(key)
      metadata.delete(key)
      directories.delete(key)
    }),
    list: vi.fn(async <T>(options?: { prefix?: string }): Promise<Map<string, T>> => {
      const result = new Map<string, T>()
      const prefix = options?.prefix || ''

      for (const [key, value] of files) {
        if (key.startsWith(prefix)) {
          result.set(key, value as T)
        }
      }
      for (const dir of directories) {
        if (dir.startsWith(prefix)) {
          result.set(dir, true as T)
        }
      }
      return result
    }),
  }
}

// Mock DurableObjectState
const createMockState = () => {
  const storage = createMockStorage()
  return {
    id: { toString: () => 'test-id-123' } as DurableObjectId,
    storage: {
      ...storage,
      sql: {
        exec: vi.fn().mockReturnValue({ results: [] }),
        raw: vi.fn().mockReturnValue([]),
      },
    },
    blockConcurrencyWhile: vi.fn(async (fn) => fn()),
    waitUntil: vi.fn(),
    _storage: storage, // Expose for test verification
  }
}

// Mock environment with R2 bucket
const createMockEnv = () => ({
  R2_BUCKET: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn().mockResolvedValue({ objects: [] }),
  },
})

// Mock bash executor that tracks commands
const createMockBashExecutor = () => {
  const executedCommands: Array<{ command: string; options?: any }> = []

  return {
    executedCommands,
    execute: vi.fn(async (command: string, options?: any) => {
      executedCommands.push({ command, options })

      // Simulate basic command execution
      return {
        input: command,
        command,
        valid: true,
        generated: false,
        stdout: `executed: ${command}`,
        stderr: '',
        exitCode: 0,
        code: 0,
        success: true,
        intent: {
          commands: [command.split(' ')[0]],
          reads: [],
          writes: [],
          deletes: [],
          network: false,
          elevated: false,
        },
        classification: {
          type: 'read' as const,
          impact: 'none' as const,
          reversible: true,
          reason: 'Mock execution',
        },
      }
    }),
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('Primitives Integration', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    vi.clearAllMocks()
  })

  describe('fs + bash integration', () => {
    it('should read file created by $.fs using $.bash cat (native ops)', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      const testContent = 'Hello from fs.write!'
      const testPath = '/test-file.txt'

      // Write file using $.fs
      await instance.$.fs.write(testPath, testContent)

      // Verify file was written to storage
      expect(mockState.storage.put).toHaveBeenCalled()

      // Read using $.bash.exec with 'cat' command
      // Note: bash.exec uses native ops when fs is available for cat/ls/head/tail
      const result = await instance.$.bash.exec('cat', [testPath])

      // The native cat implementation reads from $.fs
      expect(result.stdout).toBe(testContent)
      expect(result.exitCode).toBe(0)
    })

    it('should list directory using $.bash ls after creating files with $.fs', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)

      // Create multiple files
      await instance.$.fs.write('/dir/file1.txt', 'content1')
      await instance.$.fs.write('/dir/file2.txt', 'content2')
      await instance.$.fs.mkdir('/dir/subdir')

      // List using $.bash ls
      const result = await instance.$.bash.exec('ls', ['/dir'])

      // Native ls should return directory contents
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('file1.txt')
      expect(result.stdout).toContain('file2.txt')
      expect(result.stdout).toContain('subdir/')
    })

    it('should use $.bash head to read first lines of $.fs file', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      const multilineContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\nLine 11'

      // Write multiline file
      await instance.$.fs.write('/multiline.txt', multilineContent)

      // Use head to get first 5 lines
      const result = await instance.$.bash.exec('head', ['-n', '5', '/multiline.txt'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Line 1\nLine 2\nLine 3\nLine 4\nLine 5')
    })

    it('should use $.bash tail to read last lines of $.fs file', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)
      const multilineContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10'

      // Write multiline file
      await instance.$.fs.write('/multiline.txt', multilineContent)

      // Use tail to get last 3 lines
      const result = await instance.$.bash.exec('tail', ['-n', '3', '/multiline.txt'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Line 8\nLine 9\nLine 10\n')
    })

    it('should handle $.bash cat error when file does not exist', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)

      // Try to cat a non-existent file
      const result = await instance.$.bash.exec('cat', ['/nonexistent.txt'])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('ENOENT')
    })
  })

  describe('fs + git integration', () => {
    it('should commit files created by $.fs', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)

      // Configure git
      instance.$.git.configure({
        repo: 'test/repo',
        branch: 'main',
      })

      // Initialize git repository
      await instance.$.git.init()

      // Write file using $.fs
      await instance.$.fs.write('/src/index.ts', 'export const hello = "world"')

      // Stage and commit
      await instance.$.git.add('/src/index.ts')
      const commitResult = await instance.$.git.commit('feat: add index.ts')

      // Verify commit was created
      expect(commitResult.hash).toBeDefined()
      expect(commitResult.hash).toHaveLength(40) // SHA-1 hash

      // Verify status is clean after commit
      const status = await instance.$.git.status()
      expect(status.staged).toHaveLength(0)
      expect(status.clean).toBe(true)
    })

    it('should track multiple files and commit them together', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)

      // Configure and init git
      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })
      await instance.$.git.init()

      // Write multiple files
      await instance.$.fs.write('/package.json', '{"name": "test"}')
      await instance.$.fs.write('/src/main.ts', 'console.log("hello")')
      await instance.$.fs.write('/src/utils.ts', 'export const add = (a, b) => a + b')

      // Stage all files
      await instance.$.git.add('.')

      // Check status before commit
      const statusBeforeCommit = await instance.$.git.status()
      expect(statusBeforeCommit.staged.length).toBeGreaterThanOrEqual(3)

      // Commit
      const commitResult = await instance.$.git.commit('chore: initial commit')

      expect(commitResult.hash).toBeDefined()
      expect(commitResult.hash).toHaveLength(40)

      // Verify commit history
      const log = await instance.$.git.log({ limit: 1 })
      expect(log).toHaveLength(1)
      expect(log[0].message).toBe('chore: initial commit')
      expect(log[0].hash).toBe(commitResult.hash)
    })

    it('should detect uncommitted changes after modifying $.fs files', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)

      // Configure and init git
      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })
      await instance.$.git.init()

      // Write and commit initial file
      await instance.$.fs.write('/readme.md', '# Initial')
      await instance.$.git.add('/readme.md')
      await instance.$.git.commit('docs: add readme')

      // Modify the file
      await instance.$.fs.write('/readme.md', '# Updated Content')

      // Check status - should detect unstaged changes
      const status = await instance.$.git.status()
      expect(status.clean).toBe(false)
      expect(status.unstaged).toContain('/readme.md')
    })
  })

  describe('full workflow: fs + git + bash', () => {
    it('should create, commit, and verify files using all primitives', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)

      // Configure git
      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })
      await instance.$.git.init()

      // Step 1: Create project structure with $.fs
      await instance.$.fs.mkdir('/project', { recursive: true })
      await instance.$.fs.mkdir('/project/src', { recursive: true })
      await instance.$.fs.write('/project/package.json', JSON.stringify({
        name: 'my-app',
        version: '1.0.0',
      }))
      await instance.$.fs.write('/project/src/index.ts', 'export const main = () => console.log("Hello!")')

      // Step 2: Stage and commit with $.git
      await instance.$.git.add('.')
      const commit1 = await instance.$.git.commit('feat: initial project structure')

      expect(commit1.hash).toBeDefined()

      // Step 3: Verify files exist using $.bash
      const lsResult = await instance.$.bash.exec('ls', ['/project'])
      expect(lsResult.stdout).toContain('package.json')
      expect(lsResult.stdout).toContain('src/')

      const catResult = await instance.$.bash.exec('cat', ['/project/package.json'])
      expect(catResult.stdout).toContain('my-app')

      // Step 4: Make changes and verify git detects them
      await instance.$.fs.write('/project/src/utils.ts', 'export const sum = (a: number, b: number) => a + b')

      // Check untracked files
      const status = await instance.$.git.status()
      expect(status.clean).toBe(false)

      // Commit the new file
      await instance.$.git.add('/project/src/utils.ts')
      const commit2 = await instance.$.git.commit('feat: add utils')

      expect(commit2.hash).not.toBe(commit1.hash)

      // Verify commit history
      const log = await instance.$.git.log({ limit: 2 })
      expect(log).toHaveLength(2)
      expect(log[0].message).toBe('feat: add utils')
      expect(log[1].message).toBe('feat: initial project structure')
    })

    it('should handle build workflow simulation', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)

      // Configure git
      instance.$.git.configure({ repo: 'test/build-repo', branch: 'main' })
      await instance.$.git.init()

      // Create source files
      await instance.$.fs.write('/src/app.ts', 'export class App { run() { console.log("Running") } }')
      await instance.$.fs.write('/src/config.ts', 'export const config = { debug: true }')

      // Commit source
      await instance.$.git.add('.')
      await instance.$.git.commit('feat: add source files')

      // Simulate build output (would normally be done by actual build tool)
      await instance.$.fs.mkdir('/dist', { recursive: true })
      await instance.$.fs.write('/dist/bundle.js', '// Built output\nconsole.log("App running")')

      // Verify build output with bash
      const buildCheck = await instance.$.bash.exec('ls', ['/dist'])
      expect(buildCheck.stdout).toContain('bundle.js')

      const bundleContent = await instance.$.bash.exec('cat', ['/dist/bundle.js'])
      expect(bundleContent.stdout).toContain('Built output')

      // Commit build output
      await instance.$.git.add('/dist/bundle.js')
      const buildCommit = await instance.$.git.commit('chore: build output')

      expect(buildCommit.hash).toBeDefined()

      // Final status should be clean
      const finalStatus = await instance.$.git.status()
      expect(finalStatus.staged).toHaveLength(0)
    })

    it('should support file copy workflow with fs and bash verification', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)

      // Create original file
      const originalContent = 'This is the original content'
      await instance.$.fs.write('/original.txt', originalContent)

      // Copy file using $.fs
      await instance.$.fs.copy('/original.txt', '/backup/copy.txt')

      // Verify both files exist and have same content using bash
      const originalRead = await instance.$.bash.exec('cat', ['/original.txt'])
      const copyRead = await instance.$.bash.exec('cat', ['/backup/copy.txt'])

      expect(originalRead.stdout).toBe(originalContent)
      expect(copyRead.stdout).toBe(originalContent)
      expect(originalRead.stdout).toBe(copyRead.stdout)
    })

    it('should handle move workflow with fs and bash verification', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)

      // Create file
      const content = 'File to be moved'
      await instance.$.fs.write('/temp/file.txt', content)

      // Move file
      await instance.$.fs.move('/temp/file.txt', '/permanent/file.txt')

      // Verify original doesn't exist
      const originalExists = await instance.$.fs.exists('/temp/file.txt')
      expect(originalExists).toBe(false)

      // Verify new location has content using bash
      const movedContent = await instance.$.bash.exec('cat', ['/permanent/file.txt'])
      expect(movedContent.stdout).toBe(content)
      expect(movedContent.exitCode).toBe(0)
    })
  })

  describe('error handling across primitives', () => {
    it('should propagate fs errors through bash native ops', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)

      // Try to read non-existent file through bash
      const result = await instance.$.bash.exec('cat', ['/does/not/exist.txt'])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toBeTruthy()
    })

    it('should handle git commit with no staged files', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })
      await instance.$.git.init()

      // Try to commit without staging anything
      await expect(instance.$.git.commit('empty commit')).rejects.toThrow('Nothing to commit')
    })

    it('should handle bash command analysis for dangerous operations', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)

      // Check that dangerous command detection works
      const analysis = instance.$.bash.analyze('rm -rf /')
      expect(analysis.classification.impact).toBe('critical')
      expect(analysis.classification.reversible).toBe(false)

      const dangerCheck = instance.$.bash.isDangerous('rm -rf /')
      expect(dangerCheck.dangerous).toBe(true)
    })
  })

  describe('npm capability integration', () => {
    it('should have npm capability accessible', () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)

      expect(instance.$.npm).toBeDefined()
      expect(typeof instance.$.npm.resolve).toBe('function')
      expect(typeof instance.$.npm.install).toBe('function')
      expect(typeof instance.$.npm.list).toBe('function')
    })

    it('should work with fs for package.json operations', async () => {
      const instance = new DOWithPrimitives(mockState as any, mockEnv)

      // Write a package.json
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        dependencies: {
          lodash: '^4.17.21',
        },
      }
      await instance.$.fs.write('/package.json', JSON.stringify(packageJson, null, 2))

      // Read it back with bash to verify
      const result = await instance.$.bash.exec('cat', ['/package.json'])
      expect(result.stdout).toContain('test-package')
      expect(result.stdout).toContain('lodash')
    })
  })
})
