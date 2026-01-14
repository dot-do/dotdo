/**
 * ShellBackend Interface Tests (RED)
 *
 * These tests define the contract for ShellBackend - an abstraction layer
 * for shell execution that supports both real and mock implementations.
 *
 * Tests are written to FAIL until the interface is implemented.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Import types that don't exist yet - this will cause compilation errors
import type {
  ShellBackend,
  ExecOptions,
  ExecResult,
  SpawnOptions,
  ShellProcess,
} from '../../src/core/backend.js'

// Import MockShellBackend that doesn't exist yet
import { MockShellBackend, createMockBackend } from '../../src/core/mock-backend.js'

// ============================================================================
// ShellBackend Interface Tests
// ============================================================================

describe('ShellBackend Interface', () => {
  describe('execute()', () => {
    let backend: ShellBackend

    beforeEach(() => {
      backend = createMockBackend()
    })

    it('should execute a simple command and return result', async () => {
      const result = await backend.execute('echo "hello"')

      expect(result).toBeDefined()
      expect(result.stdout).toBe('hello\n')
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
    })

    it('should return non-zero exit code for failed commands', async () => {
      const result = await backend.execute('exit 1')

      expect(result.exitCode).toBe(1)
    })

    it('should capture stderr output', async () => {
      const result = await backend.execute('echo "error" >&2')

      expect(result.stderr).toContain('error')
    })

    it('should accept execution options', async () => {
      const options: ExecOptions = {
        cwd: '/tmp',
        timeout: 5000,
        env: { MY_VAR: 'test' },
      }

      const result = await backend.execute('pwd', options)

      expect(result.stdout).toContain('/tmp')
    })

    it('should respect timeout option', async () => {
      const options: ExecOptions = {
        timeout: 100,
      }

      // This should timeout
      const result = await backend.execute('sleep 10', options)

      expect(result.exitCode).not.toBe(0)
      expect(result.timedOut).toBe(true)
    })

    it('should support cancellation via AbortSignal', async () => {
      const controller = new AbortController()
      const options: ExecOptions = {
        signal: controller.signal,
      }

      // Start execution and abort immediately
      const promise = backend.execute('sleep 10', options)
      controller.abort()

      const result = await promise

      expect(result.aborted).toBe(true)
      expect(result.exitCode).not.toBe(0)
    })

    it('should pass environment variables to command', async () => {
      const options: ExecOptions = {
        env: { TEST_VAR: 'hello_from_env' },
      }

      const result = await backend.execute('echo $TEST_VAR', options)

      expect(result.stdout).toContain('hello_from_env')
    })
  })

  describe('spawn()', () => {
    let backend: ShellBackend

    beforeEach(() => {
      backend = createMockBackend()
    })

    it('should spawn a process and return ShellProcess handle', () => {
      const process = backend.spawn('cat')

      expect(process).toBeDefined()
      expect(process.pid).toBeDefined()
      expect(typeof process.pid).toBe('number')
    })

    it('should provide readable stdout stream', async () => {
      const process = backend.spawn('echo "streaming"')

      const chunks: string[] = []
      process.stdout.on('data', (chunk: string) => {
        chunks.push(chunk)
      })

      await process.wait()

      expect(chunks.join('')).toContain('streaming')
    })

    it('should provide readable stderr stream', async () => {
      const process = backend.spawn('echo "error" >&2')

      const chunks: string[] = []
      process.stderr.on('data', (chunk: string) => {
        chunks.push(chunk)
      })

      await process.wait()

      expect(chunks.join('')).toContain('error')
    })

    it('should provide writable stdin stream', async () => {
      const process = backend.spawn('cat')

      process.stdin.write('hello from stdin')
      process.stdin.end()

      const result = await process.wait()

      expect(result.stdout).toContain('hello from stdin')
    })

    it('should allow killing the process', async () => {
      const process = backend.spawn('sleep 100')

      // Kill after a short delay
      setTimeout(() => process.kill(), 50)

      const result = await process.wait()

      expect(result.killed).toBe(true)
    })

    it('should support different kill signals', async () => {
      const process = backend.spawn('sleep 100')

      process.kill('SIGKILL')

      const result = await process.wait()

      expect(result.killed).toBe(true)
      expect(result.signal).toBe('SIGKILL')
    })

    it('should accept spawn options', () => {
      const options: SpawnOptions = {
        cwd: '/tmp',
        env: { TEST: 'value' },
        shell: true,
      }

      const process = backend.spawn('pwd', options)

      expect(process).toBeDefined()
    })

    it('should return exit code via wait()', async () => {
      const process = backend.spawn('exit 42')

      const result = await process.wait()

      expect(result.exitCode).toBe(42)
    })
  })

  describe('getEnv()', () => {
    let backend: ShellBackend

    beforeEach(() => {
      backend = createMockBackend()
    })

    it('should return current environment variables', () => {
      const env = backend.getEnv()

      expect(env).toBeDefined()
      expect(typeof env).toBe('object')
    })

    it('should return a copy, not the original', () => {
      const env1 = backend.getEnv()
      const env2 = backend.getEnv()

      expect(env1).not.toBe(env2)
      expect(env1).toEqual(env2)
    })
  })

  describe('setEnv()', () => {
    let backend: ShellBackend

    beforeEach(() => {
      backend = createMockBackend()
    })

    it('should set an environment variable', () => {
      backend.setEnv('MY_TEST_VAR', 'test_value')

      const env = backend.getEnv()

      expect(env.MY_TEST_VAR).toBe('test_value')
    })

    it('should override existing environment variable', () => {
      backend.setEnv('MY_VAR', 'initial')
      backend.setEnv('MY_VAR', 'updated')

      const env = backend.getEnv()

      expect(env.MY_VAR).toBe('updated')
    })

    it('should affect subsequent command execution', async () => {
      backend.setEnv('GREETING', 'hello_world')

      const result = await backend.execute('echo $GREETING')

      expect(result.stdout).toContain('hello_world')
    })
  })

  describe('getCwd()', () => {
    let backend: ShellBackend

    beforeEach(() => {
      backend = createMockBackend()
    })

    it('should return current working directory', () => {
      const cwd = backend.getCwd()

      expect(cwd).toBeDefined()
      expect(typeof cwd).toBe('string')
      expect(cwd.length).toBeGreaterThan(0)
    })
  })

  describe('setCwd()', () => {
    let backend: ShellBackend

    beforeEach(() => {
      backend = createMockBackend()
    })

    it('should set current working directory', () => {
      backend.setCwd('/tmp')

      expect(backend.getCwd()).toBe('/tmp')
    })

    it('should affect subsequent command execution', async () => {
      backend.setCwd('/tmp')

      const result = await backend.execute('pwd')

      expect(result.stdout.trim()).toBe('/tmp')
    })

    it('should throw for non-existent directory', () => {
      expect(() => {
        backend.setCwd('/nonexistent/path/12345')
      }).toThrow()
    })
  })
})

// ============================================================================
// MockShellBackend Tests
// ============================================================================

describe('MockShellBackend', () => {
  describe('Recording', () => {
    let mock: MockShellBackend

    beforeEach(() => {
      mock = new MockShellBackend()
    })

    it('should record all execute() calls', async () => {
      await mock.execute('ls')
      await mock.execute('pwd')
      await mock.execute('echo "test"')

      const calls = mock.getExecuteCalls()

      expect(calls).toHaveLength(3)
      expect(calls[0].command).toBe('ls')
      expect(calls[1].command).toBe('pwd')
      expect(calls[2].command).toBe('echo "test"')
    })

    it('should record execute() options', async () => {
      await mock.execute('ls', { cwd: '/tmp', timeout: 5000 })

      const calls = mock.getExecuteCalls()

      expect(calls[0].options).toEqual({ cwd: '/tmp', timeout: 5000 })
    })

    it('should record all spawn() calls', () => {
      mock.spawn('cat')
      mock.spawn('tail -f log.txt')

      const calls = mock.getSpawnCalls()

      expect(calls).toHaveLength(2)
      expect(calls[0].command).toBe('cat')
      expect(calls[1].command).toBe('tail -f log.txt')
    })

    it('should record spawn() options', () => {
      mock.spawn('pwd', { cwd: '/home', shell: true })

      const calls = mock.getSpawnCalls()

      expect(calls[0].options).toEqual({ cwd: '/home', shell: true })
    })

    it('should track setEnv() calls', () => {
      mock.setEnv('VAR1', 'value1')
      mock.setEnv('VAR2', 'value2')

      const calls = mock.getSetEnvCalls()

      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ key: 'VAR1', value: 'value1' })
      expect(calls[1]).toEqual({ key: 'VAR2', value: 'value2' })
    })

    it('should track setCwd() calls', () => {
      mock.setCwd('/tmp')
      mock.setCwd('/home')

      const calls = mock.getSetCwdCalls()

      expect(calls).toHaveLength(2)
      expect(calls[0]).toBe('/tmp')
      expect(calls[1]).toBe('/home')
    })

    it('should clear all recordings', async () => {
      await mock.execute('ls')
      mock.spawn('cat')
      mock.setEnv('VAR', 'value')
      mock.setCwd('/tmp')

      mock.clearRecordings()

      expect(mock.getExecuteCalls()).toHaveLength(0)
      expect(mock.getSpawnCalls()).toHaveLength(0)
      expect(mock.getSetEnvCalls()).toHaveLength(0)
      expect(mock.getSetCwdCalls()).toHaveLength(0)
    })
  })

  describe('Configurable Results', () => {
    let mock: MockShellBackend

    beforeEach(() => {
      mock = new MockShellBackend()
    })

    it('should return configured result for execute()', async () => {
      mock.onExecute('ls').returns({
        stdout: 'file1.txt\nfile2.txt',
        stderr: '',
        exitCode: 0,
      })

      const result = await mock.execute('ls')

      expect(result.stdout).toBe('file1.txt\nfile2.txt')
      expect(result.exitCode).toBe(0)
    })

    it('should return configured error result', async () => {
      mock.onExecute('cat missing.txt').returns({
        stdout: '',
        stderr: 'cat: missing.txt: No such file or directory',
        exitCode: 1,
      })

      const result = await mock.execute('cat missing.txt')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('No such file or directory')
    })

    it('should throw configured error', async () => {
      mock.onExecute('crash').throws(new Error('Command crashed'))

      await expect(mock.execute('crash')).rejects.toThrow('Command crashed')
    })

    it('should match command patterns with regex', async () => {
      mock.onExecute(/^ls/).returns({
        stdout: 'matched by pattern',
        stderr: '',
        exitCode: 0,
      })

      const result1 = await mock.execute('ls -la')
      const result2 = await mock.execute('ls /tmp')

      expect(result1.stdout).toBe('matched by pattern')
      expect(result2.stdout).toBe('matched by pattern')
    })

    it('should use callback for dynamic results', async () => {
      mock.onExecute('echo').callback((command) => {
        const message = command.replace('echo ', '').replace(/"/g, '')
        return {
          stdout: message + '\n',
          stderr: '',
          exitCode: 0,
        }
      })

      const result = await mock.execute('echo "dynamic value"')

      expect(result.stdout).toBe('dynamic value\n')
    })

    it('should return default result for unconfigured commands', async () => {
      const result = await mock.execute('unknown-command')

      expect(result.exitCode).toBe(127)
      expect(result.stderr).toContain('command not found')
    })

    it('should support setting default result', async () => {
      mock.setDefaultResult({
        stdout: 'default output',
        stderr: '',
        exitCode: 0,
      })

      const result = await mock.execute('any-command')

      expect(result.stdout).toBe('default output')
    })
  })

  describe('Mock Process', () => {
    let mock: MockShellBackend

    beforeEach(() => {
      mock = new MockShellBackend()
    })

    it('should return mock process with configurable pid', () => {
      mock.onSpawn('cat').withPid(12345)

      const process = mock.spawn('cat')

      expect(process.pid).toBe(12345)
    })

    it('should emit configured stdout data', async () => {
      mock.onSpawn('cat').emitsStdout('line1\n', 'line2\n')

      const process = mock.spawn('cat')

      const chunks: string[] = []
      process.stdout.on('data', (chunk: string) => chunks.push(chunk))

      await process.wait()

      expect(chunks).toEqual(['line1\n', 'line2\n'])
    })

    it('should emit configured stderr data', async () => {
      mock.onSpawn('command').emitsStderr('warning\n')

      const process = mock.spawn('command')

      const chunks: string[] = []
      process.stderr.on('data', (chunk: string) => chunks.push(chunk))

      await process.wait()

      expect(chunks).toEqual(['warning\n'])
    })

    it('should return configured exit code', async () => {
      mock.onSpawn('exit').exitsWithCode(42)

      const process = mock.spawn('exit')
      const result = await process.wait()

      expect(result.exitCode).toBe(42)
    })

    it('should simulate kill behavior', async () => {
      mock.onSpawn('sleep').simulatesKill()

      const process = mock.spawn('sleep')
      process.kill('SIGTERM')

      const result = await process.wait()

      expect(result.killed).toBe(true)
      expect(result.signal).toBe('SIGTERM')
    })

    it('should capture stdin writes', async () => {
      const captured: string[] = []
      mock.onSpawn('cat').capturesStdin(captured)

      const process = mock.spawn('cat')
      process.stdin.write('hello')
      process.stdin.write(' world')
      process.stdin.end()

      await process.wait()

      expect(captured).toEqual(['hello', ' world'])
    })
  })

  describe('Timeout Handling', () => {
    let mock: MockShellBackend

    beforeEach(() => {
      mock = new MockShellBackend()
    })

    it('should simulate timeout for execute()', async () => {
      mock.onExecute('slow-command').timesOut()

      const result = await mock.execute('slow-command', { timeout: 100 })

      expect(result.timedOut).toBe(true)
      expect(result.exitCode).not.toBe(0)
    })

    it('should simulate delay before returning', async () => {
      mock.onExecute('delayed').delays(50).returns({
        stdout: 'done',
        stderr: '',
        exitCode: 0,
      })

      const start = Date.now()
      await mock.execute('delayed')
      const elapsed = Date.now() - start

      expect(elapsed).toBeGreaterThanOrEqual(50)
    })
  })

  describe('Abort/Cancellation', () => {
    let mock: MockShellBackend

    beforeEach(() => {
      mock = new MockShellBackend()
    })

    it('should respect AbortSignal for execute()', async () => {
      mock.onExecute('long-running').delays(1000)

      const controller = new AbortController()
      setTimeout(() => controller.abort(), 50)

      const result = await mock.execute('long-running', {
        signal: controller.signal,
      })

      expect(result.aborted).toBe(true)
    })

    it('should call abort callback when cancelled', async () => {
      const abortCallback = vi.fn()
      mock.onExecute('cancellable').onAbort(abortCallback)

      const controller = new AbortController()
      const promise = mock.execute('cancellable', { signal: controller.signal })

      controller.abort()
      await promise

      expect(abortCallback).toHaveBeenCalled()
    })
  })

  describe('Verification Helpers', () => {
    let mock: MockShellBackend

    beforeEach(() => {
      mock = new MockShellBackend()
    })

    it('should verify command was executed', async () => {
      await mock.execute('ls')

      expect(mock.wasExecuted('ls')).toBe(true)
      expect(mock.wasExecuted('pwd')).toBe(false)
    })

    it('should verify command was executed with options', async () => {
      await mock.execute('ls', { cwd: '/tmp' })

      expect(mock.wasExecutedWith('ls', { cwd: '/tmp' })).toBe(true)
      expect(mock.wasExecutedWith('ls', { cwd: '/home' })).toBe(false)
    })

    it('should verify spawn was called', () => {
      mock.spawn('tail -f')

      expect(mock.wasSpawned('tail -f')).toBe(true)
      expect(mock.wasSpawned('cat')).toBe(false)
    })

    it('should count execute calls', async () => {
      await mock.execute('ls')
      await mock.execute('ls')
      await mock.execute('pwd')

      expect(mock.executeCallCount('ls')).toBe(2)
      expect(mock.executeCallCount('pwd')).toBe(1)
      expect(mock.executeCallCount('unknown')).toBe(0)
    })

    it('should verify command order', async () => {
      await mock.execute('ls')
      await mock.execute('pwd')
      await mock.execute('cat file.txt')

      expect(mock.verifyOrder(['ls', 'pwd', 'cat file.txt'])).toBe(true)
      expect(mock.verifyOrder(['pwd', 'ls'])).toBe(false)
    })

    it('should assert no unmatched calls', async () => {
      mock.onExecute('ls').returns({ stdout: '', stderr: '', exitCode: 0 })

      await mock.execute('ls')
      await mock.execute('unknown')

      expect(() => mock.assertNoUnmatchedCalls()).toThrow()
    })
  })
})

// ============================================================================
// Type Tests (compile-time verification)
// ============================================================================

describe('Type Definitions', () => {
  it('should have correct ExecOptions shape', () => {
    const options: ExecOptions = {
      cwd: '/tmp',
      env: { KEY: 'value' },
      timeout: 5000,
      signal: new AbortController().signal,
    }

    expect(options).toBeDefined()
  })

  it('should have correct ExecResult shape', () => {
    const result: ExecResult = {
      stdout: 'output',
      stderr: 'error',
      exitCode: 0,
      timedOut: false,
      aborted: false,
      killed: false,
      signal: undefined,
    }

    expect(result.stdout).toBe('output')
    expect(result.exitCode).toBe(0)
  })

  it('should have correct SpawnOptions shape', () => {
    const options: SpawnOptions = {
      cwd: '/tmp',
      env: { KEY: 'value' },
      shell: true,
    }

    expect(options).toBeDefined()
  })

  it('should have correct ShellProcess shape', () => {
    // This is a compile-time check - we just verify the shape exists
    type _ProcessShape = {
      pid: number
      stdin: { write: (data: string) => void; end: () => void }
      stdout: { on: (event: string, cb: (data: string) => void) => void }
      stderr: { on: (event: string, cb: (data: string) => void) => void }
      kill: (signal?: string) => void
      wait: () => Promise<ExecResult>
    }

    // Type assertion that ShellProcess is assignable to our expected shape
    const _typeCheck: _ProcessShape extends ShellProcess ? true : false = true
    expect(_typeCheck).toBe(true)
  })

  it('should have correct ShellBackend interface', () => {
    // Verify interface methods exist at compile time
    type _BackendShape = {
      execute: (command: string, options?: ExecOptions) => Promise<ExecResult>
      spawn: (command: string, options?: SpawnOptions) => ShellProcess
      getEnv: () => Record<string, string>
      setEnv: (key: string, value: string) => void
      getCwd: () => string
      setCwd: (path: string) => void
    }

    const _typeCheck: _BackendShape extends ShellBackend ? true : false = true
    expect(_typeCheck).toBe(true)
  })
})
