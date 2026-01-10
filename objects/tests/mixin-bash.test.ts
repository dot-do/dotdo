/**
 * RED TDD: withBash Mixin Integration Tests
 *
 * These tests verify the withBash mixin integration with bashx.do:
 *
 * Key requirements:
 * 1. withBash requires withFs capability (dependency enforcement)
 * 2. withBash adds $.bash tagged template to WorkflowContext
 * 3. $.bash executes simple commands (echo, ls)
 * 4. $.bash interpolates variables safely (escapes malicious input)
 * 5. $.bash rejects dangerous commands (rm -rf /, chmod 777)
 * 6. $.bash.exec() provides raw execution with result object
 * 7. $.bash commands can read/write to $.fs
 * 8. $.bash returns classification metadata (type, impact, reversible)
 *
 * The tests use mock implementations to verify the expected interface
 * and behavior without requiring actual shell execution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Import the mixins we're testing
// Note: These imports reference the expected structure - tests will FAIL until implemented
import { withFs, type FsCapability } from '../../lib/mixins/fs'
import { withBash, type BashCapability, type WithBashContext } from '../../lib/mixins/bash'
import { DO } from '../DO'
import type { WorkflowContext } from '../../types/WorkflowContext'

// ============================================================================
// TEST FIXTURES & MOCKS
// ============================================================================

/**
 * Mock DurableObjectState for testing
 */
function createMockDOState(): DurableObjectState {
  const storage = new Map<string, unknown>()
  return {
    id: { toString: () => 'test-do-id' } as DurableObjectId,
    storage: {
      get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
      put: vi.fn((key: string, value: unknown) => {
        storage.set(key, value)
        return Promise.resolve()
      }),
      delete: vi.fn((key: string) => {
        storage.delete(key)
        return Promise.resolve(true)
      }),
      list: vi.fn(() => Promise.resolve(storage)),
      sql: {
        exec: vi.fn(),
      },
    } as unknown as DurableObjectStorage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn((fn: () => Promise<unknown>) => fn()),
  } as unknown as DurableObjectState
}

/**
 * Mock environment
 */
function createMockEnv() {
  return {
    DO: undefined,
    KV: undefined,
    R2: undefined,
    PIPELINE: undefined,
  }
}

/**
 * Mock executor that tracks executed commands
 */
function createMockExecutor() {
  const executedCommands: string[] = []
  return {
    execute: vi.fn(async (command: string, options?: any) => ({
      input: command,
      command: command,
      valid: true,
      generated: false,
      stdout: `output of: ${command}`,
      stderr: '',
      exitCode: 0,
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
    })),
    executedCommands,
  }
}

/**
 * Mock FsCapability for testing integration
 */
function createMockFsCapability(): FsCapability {
  const files = new Map<string, string>()
  files.set('/test/file.txt', 'Hello, World!')
  files.set('/test/data.json', '{"key": "value"}')

  return {
    name: 'fs' as const,
    read: vi.fn(async (path: string) => {
      const content = files.get(path)
      if (!content) throw new Error(`ENOENT: no such file or directory, open '${path}'`)
      return content
    }),
    write: vi.fn(async (path: string, content: string) => {
      files.set(path, content)
    }),
    exists: vi.fn(async (path: string) => files.has(path)),
    delete: vi.fn(async (path: string) => {
      if (!files.has(path)) throw new Error(`ENOENT: no such file or directory, unlink '${path}'`)
      files.delete(path)
    }),
    list: vi.fn(async (path: string) => {
      const entries: { name: string; isDirectory: boolean }[] = []
      for (const key of files.keys()) {
        if (key.startsWith(path + '/')) {
          const relativePath = key.substring(path.length + 1)
          const firstPart = relativePath.split('/')[0]
          if (!entries.find((e) => e.name === firstPart)) {
            entries.push({ name: firstPart, isDirectory: relativePath.includes('/') })
          }
        }
      }
      return entries
    }),
    mkdir: vi.fn(async () => {}),
    stat: vi.fn(async (path: string) => ({
      size: files.get(path)?.length ?? 0,
      isDirectory: false,
      isFile: true,
      createdAt: new Date(),
      modifiedAt: new Date(),
    })),
    copy: vi.fn(async (src: string, dest: string) => {
      const content = files.get(src)
      if (!content) throw new Error(`ENOENT: no such file or directory, copyfile '${src}'`)
      files.set(dest, content)
    }),
    move: vi.fn(async (src: string, dest: string) => {
      const content = files.get(src)
      if (!content) throw new Error(`ENOENT: no such file or directory, rename '${src}'`)
      files.set(dest, content)
      files.delete(src)
    }),
  }
}

// ============================================================================
// DEPENDENCY REQUIREMENTS TESTS
// ============================================================================

describe('withBash Mixin - Dependency Requirements', () => {
  describe('requires withFs capability', () => {
    it('should throw error when applied to DO without withFs', () => {
      const mockExecutor = createMockExecutor()

      // Applying withBash directly to DO (without withFs) should fail
      // This tests that withBash has a proper dependency on withFs
      expect(() => {
        const DOWithBash = withBash(DO, {
          executor: () => mockExecutor,
          requireFs: true, // Enable strict dependency check
        })
        const state = createMockDOState()
        const env = createMockEnv()
        new DOWithBash(state, env)
      }).toThrow(/requires.*withFs|FsCapability required|fs.*not.*available/i)
    })

    it('should work when applied after withFs', () => {
      const mockExecutor = createMockExecutor()

      // This should NOT throw - withFs provides the required capability
      const DOWithFsAndBash = withBash(withFs(DO), {
        executor: () => mockExecutor,
        requireFs: true,
      })

      const state = createMockDOState()
      const env = createMockEnv()
      const instance = new DOWithFsAndBash(state, env)

      expect(instance.$.fs).toBeDefined()
      expect(instance.$.bash).toBeDefined()
    })

    it('should allow optional fs dependency with requireFs: false', () => {
      const mockExecutor = createMockExecutor()

      // When requireFs is false, withBash should work without withFs
      const DOWithBash = withBash(DO, {
        executor: () => mockExecutor,
        requireFs: false,
      })

      const state = createMockDOState()
      const env = createMockEnv()
      const instance = new DOWithBash(state, env)

      expect(instance.$.bash).toBeDefined()
    })
  })
})

// ============================================================================
// TAGGED TEMPLATE LITERAL TESTS
// ============================================================================

describe('withBash Mixin - Tagged Template Support', () => {
  let instance: any

  beforeEach(() => {
    const mockExecutor = createMockExecutor()
    const DOWithFsAndBash = withBash(withFs(DO), {
      executor: () => mockExecutor,
    })
    const state = createMockDOState()
    const env = createMockEnv()
    instance = new DOWithFsAndBash(state, env)
  })

  describe('$.bash tagged template', () => {
    it('should add $.bash as a callable tagged template function', () => {
      // $.bash should be callable as a tagged template literal
      expect(typeof instance.$.bash).toBe('function')
    })

    it('should execute simple echo command via tagged template', async () => {
      // RED: This tests the tagged template syntax
      const result = await instance.$.bash`echo hello`

      expect(result).toBeDefined()
      expect(result.stdout).toBeDefined()
      expect(result.stdout.trim()).toContain('hello')
    })

    it('should execute ls command via tagged template', async () => {
      const result = await instance.$.bash`ls -la`

      expect(result).toBeDefined()
      expect(result.exitCode).toBe(0)
    })

    it('should handle multi-part commands', async () => {
      const result = await instance.$.bash`echo "hello world" && echo "goodbye"`

      expect(result).toBeDefined()
      expect(result.exitCode).toBe(0)
    })
  })
})

// ============================================================================
// VARIABLE INTERPOLATION & SAFETY TESTS
// ============================================================================

describe('withBash Mixin - Variable Interpolation & Safety', () => {
  let instance: any
  let mockExecutor: ReturnType<typeof createMockExecutor>

  beforeEach(() => {
    mockExecutor = createMockExecutor()
    const DOWithFsAndBash = withBash(withFs(DO), {
      executor: () => mockExecutor,
    })
    const state = createMockDOState()
    const env = createMockEnv()
    instance = new DOWithFsAndBash(state, env)
  })

  describe('safe variable interpolation', () => {
    it('should interpolate simple string variables', async () => {
      const filename = 'test.txt'
      await instance.$.bash`cat ${filename}`

      // The command should be called with escaped/quoted filename
      expect(mockExecutor.execute).toHaveBeenCalledWith(
        expect.stringContaining('test.txt'),
        expect.anything()
      )
    })

    it('should escape variables containing spaces', async () => {
      const filename = 'my file.txt'
      await instance.$.bash`cat ${filename}`

      // Should be quoted/escaped to handle spaces
      const calledWith = mockExecutor.execute.mock.calls[0][0]
      expect(calledWith).toMatch(/cat\s+['"]?my file\.txt['"]?|cat\s+'my file\.txt'/)
    })

    it('should escape shell metacharacters in variables', async () => {
      const maliciousInput = '; rm -rf /'
      await instance.$.bash`echo ${maliciousInput}`

      // The semicolon and rm command should be escaped, not executed
      const calledWith = mockExecutor.execute.mock.calls[0][0]

      // Should NOT contain unescaped command injection
      expect(calledWith).not.toMatch(/echo\s+;\s*rm/)

      // Should contain the escaped/quoted version
      expect(calledWith).toMatch(/echo\s+['"][^'"]*rm[^'"]*['"]|echo\s+';\s*rm -rf \/'/)
    })

    it('should escape command substitution attempts', async () => {
      const maliciousInput = '$(whoami)'
      await instance.$.bash`echo ${maliciousInput}`

      const calledWith = mockExecutor.execute.mock.calls[0][0]

      // Should be quoted to prevent execution
      expect(calledWith).toMatch(/echo\s+['"]\$\(whoami\)['"]/)
    })

    it('should escape backtick command substitution', async () => {
      const maliciousInput = '`whoami`'
      await instance.$.bash`echo ${maliciousInput}`

      const calledWith = mockExecutor.execute.mock.calls[0][0]

      // Should be quoted to prevent execution
      expect(calledWith).toMatch(/echo\s+['"]`whoami`['"]/)
    })

    it('should handle multiple interpolated variables', async () => {
      const src = 'source.txt'
      const dest = 'dest dir/target.txt'
      await instance.$.bash`cp ${src} ${dest}`

      const calledWith = mockExecutor.execute.mock.calls[0][0]

      // Both variables should be present
      expect(calledWith).toContain('source.txt')
      expect(calledWith).toContain('dest')
      expect(calledWith).toContain('target.txt')
    })

    it('should escape variables with newlines', async () => {
      const multiline = 'line1\nline2'
      await instance.$.bash`echo ${multiline}`

      const calledWith = mockExecutor.execute.mock.calls[0][0]

      // Should be properly escaped
      expect(calledWith).toBeDefined()
      // Newline should not break the command
      expect(calledWith.split('\n').length).toBeLessThanOrEqual(2) // At most one newline in quoted string
    })

    it('should escape glob patterns in variables', async () => {
      const pattern = '*.txt'
      await instance.$.bash`ls ${pattern}`

      const calledWith = mockExecutor.execute.mock.calls[0][0]

      // Glob should be quoted to prevent expansion
      expect(calledWith).toMatch(/ls\s+['"]\*\.txt['"]/)
    })
  })
})

// ============================================================================
// DANGEROUS COMMAND REJECTION TESTS
// ============================================================================

describe('withBash Mixin - Dangerous Command Rejection', () => {
  let instance: any
  let mockExecutor: ReturnType<typeof createMockExecutor>

  beforeEach(() => {
    mockExecutor = createMockExecutor()
    const DOWithFsAndBash = withBash(withFs(DO), {
      executor: () => mockExecutor,
    })
    const state = createMockDOState()
    const env = createMockEnv()
    instance = new DOWithFsAndBash(state, env)
  })

  describe('critical command blocking', () => {
    it('should reject rm -rf /', async () => {
      await expect(instance.$.bash`rm -rf /`).rejects.toThrow(/dangerous|blocked|critical|prohibited/i)

      // Executor should NOT have been called
      expect(mockExecutor.execute).not.toHaveBeenCalled()
    })

    it('should reject rm -rf /*', async () => {
      await expect(instance.$.bash`rm -rf /*`).rejects.toThrow(/dangerous|blocked|critical/i)
    })

    it('should reject rm -rf ~/', async () => {
      await expect(instance.$.bash`rm -rf ~/`).rejects.toThrow(/dangerous|blocked|critical/i)
    })

    it('should reject chmod 777 /', async () => {
      await expect(instance.$.bash`chmod 777 /`).rejects.toThrow(/dangerous|blocked|critical/i)
    })

    it('should reject chmod -R 777 /', async () => {
      await expect(instance.$.bash`chmod -R 777 /`).rejects.toThrow(/dangerous|blocked|critical/i)
    })

    it('should reject dd to disk devices', async () => {
      await expect(instance.$.bash`dd if=/dev/zero of=/dev/sda`).rejects.toThrow(/dangerous|blocked|critical/i)
    })

    it('should reject mkfs commands', async () => {
      await expect(instance.$.bash`mkfs.ext4 /dev/sda1`).rejects.toThrow(/dangerous|blocked|critical/i)
    })

    it('should reject shutdown command', async () => {
      await expect(instance.$.bash`shutdown -h now`).rejects.toThrow(/dangerous|blocked|critical/i)
    })

    it('should reject reboot command', async () => {
      await expect(instance.$.bash`reboot`).rejects.toThrow(/dangerous|blocked|critical/i)
    })

    it('should reject fork bomb', async () => {
      await expect(instance.$.bash`:(){ :|:& };:`).rejects.toThrow(/dangerous|blocked|critical/i)
    })
  })

  describe('dangerous command warning/confirmation', () => {
    it('should return blocked result for dangerous commands without throwing', async () => {
      // Using exec() instead of tagged template allows getting blocked result
      const result = await instance.$.bash.exec('rm', ['-rf', '/'])

      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)
      expect(result.classification.impact).toBe('critical')
    })

    it('should allow dangerous commands with confirm: true', async () => {
      // With explicit confirmation, dangerous commands should be allowed
      const result = await instance.$.bash.exec('rm', ['-rf', '/tmp/build'], { confirm: true })

      expect(mockExecutor.execute).toHaveBeenCalled()
      expect(result.blocked).toBeUndefined()
    })

    it('should identify sudo commands as elevated', async () => {
      const result = await instance.$.bash.exec('sudo', ['rm', '-rf', '/'])

      expect(result.blocked).toBe(true)
      expect(result.intent?.elevated).toBe(true)
    })
  })

  describe('safe command allowance', () => {
    it('should allow ls command', async () => {
      const result = await instance.$.bash`ls -la`

      expect(result.blocked).toBeUndefined()
      expect(mockExecutor.execute).toHaveBeenCalled()
    })

    it('should allow cat command', async () => {
      const result = await instance.$.bash`cat /etc/hostname`

      expect(result.blocked).toBeUndefined()
    })

    it('should allow pwd command', async () => {
      const result = await instance.$.bash`pwd`

      expect(result.blocked).toBeUndefined()
    })

    it('should allow echo command', async () => {
      const result = await instance.$.bash`echo "hello world"`

      expect(result.blocked).toBeUndefined()
    })

    it('should allow git status command', async () => {
      const result = await instance.$.bash`git status`

      expect(result.blocked).toBeUndefined()
    })
  })
})

// ============================================================================
// $.bash.exec() RAW EXECUTION TESTS
// ============================================================================

describe('withBash Mixin - $.bash.exec() Raw Execution', () => {
  let instance: any
  let mockExecutor: ReturnType<typeof createMockExecutor>

  beforeEach(() => {
    mockExecutor = createMockExecutor()
    const DOWithFsAndBash = withBash(withFs(DO), {
      executor: () => mockExecutor,
    })
    const state = createMockDOState()
    const env = createMockEnv()
    instance = new DOWithFsAndBash(state, env)
  })

  describe('exec() method', () => {
    it('should provide exec() method on $.bash', () => {
      expect(typeof instance.$.bash.exec).toBe('function')
    })

    it('should execute command with args array', async () => {
      const result = await instance.$.bash.exec('ls', ['-la', '/tmp'])

      expect(result).toBeDefined()
      expect(result.stdout).toBeDefined()
      expect(result.stderr).toBeDefined()
      expect(result.exitCode).toBeDefined()
    })

    it('should return complete BashResult structure', async () => {
      const result = await instance.$.bash.exec('echo', ['hello'])

      // Verify all required fields in BashResult
      expect(result).toHaveProperty('input')
      expect(result).toHaveProperty('command')
      expect(result).toHaveProperty('valid')
      expect(result).toHaveProperty('generated')
      expect(result).toHaveProperty('stdout')
      expect(result).toHaveProperty('stderr')
      expect(result).toHaveProperty('exitCode')
      expect(result).toHaveProperty('intent')
      expect(result).toHaveProperty('classification')
    })

    it('should accept execution options', async () => {
      await instance.$.bash.exec('npm', ['install'], {
        cwd: '/app',
        timeout: 60000,
        env: { NODE_ENV: 'production' },
      })

      expect(mockExecutor.execute).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          cwd: '/app',
          timeout: 60000,
          env: { NODE_ENV: 'production' },
        })
      )
    })

    it('should pass through dryRun option', async () => {
      const result = await instance.$.bash.exec('dangerous-command', [], { dryRun: true })

      expect(result.stdout).toContain('[DRY RUN]')
    })
  })
})

// ============================================================================
// FILESYSTEM INTEGRATION TESTS
// ============================================================================

describe('withBash Mixin - Filesystem Integration', () => {
  let instance: any
  let mockExecutor: ReturnType<typeof createMockExecutor>

  beforeEach(() => {
    mockExecutor = createMockExecutor()
    const DOWithFsAndBash = withBash(withFs(DO), {
      executor: () => mockExecutor,
      fs: (inst: any) => inst.$.fs, // Provide fs capability
    })
    const state = createMockDOState()
    const env = createMockEnv()
    instance = new DOWithFsAndBash(state, env)
  })

  describe('native fs operations', () => {
    it('should use $.fs.read for cat command when useNativeOps is true', async () => {
      // First write a file to fs
      await instance.$.fs.write('/test/native.txt', 'native content')

      // Then cat it - should use fs.read internally
      const result = await instance.$.bash.exec('cat', ['/test/native.txt'])

      // The result should come from fs, not from executor
      expect(result.stdout).toContain('native content')
    })

    it('should use $.fs.list for ls command when useNativeOps is true', async () => {
      await instance.$.fs.mkdir('/test/dir')
      await instance.$.fs.write('/test/dir/file1.txt', 'content1')
      await instance.$.fs.write('/test/dir/file2.txt', 'content2')

      const result = await instance.$.bash.exec('ls', ['/test/dir'])

      expect(result.stdout).toContain('file1.txt')
      expect(result.stdout).toContain('file2.txt')
    })

    it('should use $.fs.write for echo redirection', async () => {
      // This tests echo > file pattern
      await instance.$.bash`echo "test content" > /test/output.txt`

      // Verify file was written via fs
      const content = await instance.$.fs.read('/test/output.txt')
      expect(content).toContain('test content')
    })

    it('should use $.fs.read for head command', async () => {
      await instance.$.fs.write('/test/multiline.txt', 'line1\nline2\nline3\nline4\nline5')

      const result = await instance.$.bash.exec('head', ['-2', '/test/multiline.txt'])

      expect(result.stdout).toContain('line1')
      expect(result.stdout).toContain('line2')
      expect(result.stdout).not.toContain('line3')
    })

    it('should use $.fs.read for tail command', async () => {
      await instance.$.fs.write('/test/multiline.txt', 'line1\nline2\nline3\nline4\nline5')

      const result = await instance.$.bash.exec('tail', ['-2', '/test/multiline.txt'])

      expect(result.stdout).toContain('line4')
      expect(result.stdout).toContain('line5')
      expect(result.stdout).not.toContain('line1')
    })
  })

  describe('fallback to executor', () => {
    it('should fall back to executor for non-native commands', async () => {
      await instance.$.bash`npm install`

      // npm is not a native command, should use executor
      expect(mockExecutor.execute).toHaveBeenCalledWith(
        expect.stringContaining('npm'),
        expect.anything()
      )
    })

    it('should use executor when useNativeOps is false', async () => {
      const DOWithBashNoNative = withBash(withFs(DO), {
        executor: () => mockExecutor,
        fs: (inst: any) => inst.$.fs,
        useNativeOps: false,
      })
      const state = createMockDOState()
      const env = createMockEnv()
      const noNativeInstance = new DOWithBashNoNative(state, env)

      await noNativeInstance.$.bash`cat /test/file.txt`

      // Should use executor, not native fs
      expect(mockExecutor.execute).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// CLASSIFICATION METADATA TESTS
// ============================================================================

describe('withBash Mixin - Classification Metadata', () => {
  let instance: any

  beforeEach(() => {
    const mockExecutor = createMockExecutor()
    const DOWithFsAndBash = withBash(withFs(DO), {
      executor: () => mockExecutor,
    })
    const state = createMockDOState()
    const env = createMockEnv()
    instance = new DOWithFsAndBash(state, env)
  })

  describe('classification structure', () => {
    it('should return classification with type field', async () => {
      const result = await instance.$.bash`ls -la`

      expect(result.classification).toBeDefined()
      expect(result.classification.type).toBeDefined()
      expect(['read', 'write', 'delete', 'execute', 'network', 'system', 'mixed']).toContain(
        result.classification.type
      )
    })

    it('should return classification with impact field', async () => {
      const result = await instance.$.bash`ls -la`

      expect(result.classification.impact).toBeDefined()
      expect(['none', 'low', 'medium', 'high', 'critical']).toContain(result.classification.impact)
    })

    it('should return classification with reversible field', async () => {
      const result = await instance.$.bash`ls -la`

      expect(result.classification.reversible).toBeDefined()
      expect(typeof result.classification.reversible).toBe('boolean')
    })

    it('should return classification with reason field', async () => {
      const result = await instance.$.bash`ls -la`

      expect(result.classification.reason).toBeDefined()
      expect(typeof result.classification.reason).toBe('string')
      expect(result.classification.reason.length).toBeGreaterThan(0)
    })
  })

  describe('type classification', () => {
    it('should classify ls as read type', async () => {
      const result = await instance.$.bash`ls -la`

      expect(result.classification.type).toBe('read')
    })

    it('should classify cat as read type', async () => {
      const result = await instance.$.bash`cat /etc/hostname`

      expect(result.classification.type).toBe('read')
    })

    it('should classify rm as delete type', async () => {
      const result = await instance.$.bash.exec('rm', ['file.txt'])

      expect(result.classification.type).toBe('delete')
    })

    it('should classify mv as write type', async () => {
      const result = await instance.$.bash.exec('mv', ['old.txt', 'new.txt'])

      expect(result.classification.type).toBe('write')
    })

    it('should classify curl POST as network type', async () => {
      const result = await instance.$.bash.exec('curl', ['-X', 'POST', 'https://api.example.com'])

      expect(result.classification.type).toBe('network')
    })

    it('should classify git push as network type', async () => {
      const result = await instance.$.bash`git push origin main`

      expect(result.classification.type).toBe('network')
    })
  })

  describe('impact classification', () => {
    it('should classify read commands as no impact', async () => {
      const result = await instance.$.bash`ls -la`

      expect(result.classification.impact).toBe('none')
    })

    it('should classify single file rm as medium impact', async () => {
      const result = await instance.$.bash.exec('rm', ['file.txt'])

      expect(result.classification.impact).toBe('medium')
    })

    it('should classify recursive rm as high impact', async () => {
      const result = await instance.$.bash.exec('rm', ['-r', 'directory/'])

      expect(result.classification.impact).toBe('high')
    })

    it('should classify rm -rf / as critical impact', async () => {
      const result = await instance.$.bash.exec('rm', ['-rf', '/'])

      expect(result.classification.impact).toBe('critical')
    })
  })

  describe('reversibility classification', () => {
    it('should mark read commands as reversible', async () => {
      const result = await instance.$.bash`ls -la`

      expect(result.classification.reversible).toBe(true)
    })

    it('should mark delete commands as non-reversible', async () => {
      const result = await instance.$.bash.exec('rm', ['file.txt'])

      expect(result.classification.reversible).toBe(false)
    })

    it('should mark move commands as reversible', async () => {
      const result = await instance.$.bash.exec('mv', ['old.txt', 'new.txt'])

      expect(result.classification.reversible).toBe(true)
    })

    it('should mark chmod as reversible', async () => {
      const result = await instance.$.bash.exec('chmod', ['755', 'script.sh'])

      expect(result.classification.reversible).toBe(true)
    })
  })

  describe('intent extraction', () => {
    it('should extract command names in intent', async () => {
      const result = await instance.$.bash`ls -la`

      expect(result.intent).toBeDefined()
      expect(result.intent.commands).toContain('ls')
    })

    it('should identify network operations', async () => {
      const result = await instance.$.bash`curl https://example.com`

      expect(result.intent.network).toBe(true)
    })

    it('should identify elevated operations', async () => {
      const result = await instance.$.bash.exec('sudo', ['apt-get', 'update'])

      expect(result.intent.elevated).toBe(true)
    })

    it('should extract read paths', async () => {
      const result = await instance.$.bash`cat /etc/passwd`

      expect(result.intent.reads).toContain('/etc/passwd')
    })

    it('should extract delete paths', async () => {
      const result = await instance.$.bash.exec('rm', ['file.txt'])

      expect(result.intent.deletes).toContain('file.txt')
    })
  })
})

// ============================================================================
// TYPE SAFETY & EXPORTS TESTS
// ============================================================================

describe('withBash Mixin - Type Safety', () => {
  it('should export WithBashContext type', () => {
    // Type check - if this compiles, the type is exported correctly
    const _: WithBashContext = {} as WithBashContext
    expect(_).toBeDefined()
  })

  it('should export BashCapability type', () => {
    // Type check
    const _: BashCapability = {
      exec: vi.fn(),
      spawn: vi.fn(),
      run: vi.fn(),
      parse: vi.fn(),
      analyze: vi.fn(),
      isDangerous: vi.fn(),
    } as any
    expect(_).toBeDefined()
  })

  it('should properly type $.bash on instances', () => {
    const mockExecutor = createMockExecutor()
    const DOWithFsAndBash = withBash(withFs(DO), {
      executor: () => mockExecutor,
    })

    const state = createMockDOState()
    const env = createMockEnv()
    const instance = new DOWithFsAndBash(state, env)

    // TypeScript should recognize these methods
    expect(instance.$.bash.exec).toBeDefined()
    expect(instance.$.bash.run).toBeDefined()
    expect(instance.$.bash.spawn).toBeDefined()
    expect(instance.$.bash.parse).toBeDefined()
    expect(instance.$.bash.analyze).toBeDefined()
    expect(instance.$.bash.isDangerous).toBeDefined()
  })
})

// ============================================================================
// ADDITIONAL API TESTS
// ============================================================================

describe('withBash Mixin - Additional APIs', () => {
  let instance: any
  let mockExecutor: ReturnType<typeof createMockExecutor>

  beforeEach(() => {
    mockExecutor = createMockExecutor()
    const DOWithFsAndBash = withBash(withFs(DO), {
      executor: () => mockExecutor,
    })
    const state = createMockDOState()
    const env = createMockEnv()
    instance = new DOWithFsAndBash(state, env)
  })

  describe('parse()', () => {
    it('should parse command into AST without executing', () => {
      const ast = instance.$.bash.parse('ls -la /home')

      expect(ast).toBeDefined()
      expect(ast.type).toBe('Program')
    })

    it('should not call executor when parsing', () => {
      instance.$.bash.parse('rm -rf /')

      expect(mockExecutor.execute).not.toHaveBeenCalled()
    })
  })

  describe('analyze()', () => {
    it('should return safety classification without executing', () => {
      const analysis = instance.$.bash.analyze('rm -rf /tmp/build')

      expect(analysis.classification).toBeDefined()
      expect(analysis.intent).toBeDefined()
      expect(mockExecutor.execute).not.toHaveBeenCalled()
    })
  })

  describe('isDangerous()', () => {
    it('should identify dangerous commands', () => {
      const result = instance.$.bash.isDangerous('rm -rf /')

      expect(result.dangerous).toBe(true)
      expect(result.reason).toBeDefined()
    })

    it('should identify safe commands', () => {
      const result = instance.$.bash.isDangerous('ls -la')

      expect(result.dangerous).toBe(false)
    })

    it('should not execute commands', () => {
      instance.$.bash.isDangerous('rm -rf /')

      expect(mockExecutor.execute).not.toHaveBeenCalled()
    })
  })

  describe('run()', () => {
    it('should execute shell script', async () => {
      const result = await instance.$.bash.run('echo hello && echo world')

      expect(result).toBeDefined()
      expect(mockExecutor.execute).toHaveBeenCalled()
    })

    it('should throw on non-zero exit code', async () => {
      mockExecutor.execute.mockResolvedValueOnce({
        input: 'failing-command',
        command: 'failing-command',
        valid: true,
        generated: false,
        stdout: '',
        stderr: 'command failed',
        exitCode: 1,
        intent: { commands: [], reads: [], writes: [], deletes: [], network: false, elevated: false },
        classification: { type: 'execute', impact: 'low', reversible: true, reason: 'Test' },
      })

      await expect(instance.$.bash.run('failing-command')).rejects.toThrow()
    })
  })

  describe('spawn()', () => {
    it('should return spawn handle with pid', async () => {
      mockExecutor.spawn = vi.fn().mockResolvedValue({
        pid: 12345,
        done: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
        kill: vi.fn(),
        write: vi.fn(),
        closeStdin: vi.fn(),
      })

      const handle = await instance.$.bash.spawn('tail', ['-f', 'log.txt'])

      expect(handle.pid).toBe(12345)
    })

    it('should provide kill method on spawn handle', async () => {
      const killFn = vi.fn()
      mockExecutor.spawn = vi.fn().mockResolvedValue({
        pid: 12345,
        done: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
        kill: killFn,
        write: vi.fn(),
        closeStdin: vi.fn(),
      })

      const handle = await instance.$.bash.spawn('tail', ['-f', 'log.txt'])
      handle.kill('SIGTERM')

      expect(killFn).toHaveBeenCalledWith('SIGTERM')
    })
  })
})
