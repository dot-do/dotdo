/**
 * Shell RPC API Tests (RED)
 *
 * These tests define the contract for ShellApi and ShellStream interfaces.
 * They test exec(), spawn(), streaming callbacks, and disposal behavior.
 *
 * Tests are written in TDD RED style - they will FAIL because no implementation exists yet.
 * The goal is to define the expected behavior before implementation.
 *
 * Issue tracking:
 * - bashx-gfsk: Test ShellApi.exec() returns ShellResult
 * - bashx-59y9: Test ShellApi.spawn() returns streaming ShellStream
 * - bashx-2u2q: Test ShellStream callbacks receive data
 * - bashx-qz1r: Test ShellStream disposal cleanup
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import types from our new RPC module
import type {
  ShellApi,
  ShellStream,
  ShellResult,
  ShellExecOptions,
  ShellSpawnOptions,
  ShellDataCallback,
  ShellExitCallback,
} from '../../../core/rpc/index.js'

// Import real implementation
import { createShellApi } from '../../../src/rpc/index.js'

// ============================================================================
// Real Implementation Factory
// ============================================================================

/**
 * Create a ShellApi for testing purposes.
 * Uses the real ShellApiImpl implementation.
 */
function createTestShellApi(): ShellApi {
  return createShellApi()
}

/**
 * Create a mock ShellStream for testing callback behavior.
 * Returns a controllable stream that can simulate data events.
 */
function createMockShellStream(options: {
  pid?: number
  simulateData?: string[]
  simulateStderr?: string[]
  exitCode?: number
  exitSignal?: string
} = {}): ShellStream & {
  _emitData: (chunk: string) => void
  _emitStderr: (chunk: string) => void
  _emitExit: (code: number, signal?: string) => void
} {
  const dataCallbacks: ShellDataCallback[] = []
  const stderrCallbacks: ShellDataCallback[] = []
  const exitCallbacks: ShellExitCallback[] = []
  const stdoutBuffer: string[] = []
  const stderrBuffer: string[] = []
  let disposed = false
  let exited = false
  let finalResult: ShellResult | null = null

  const stream: ShellStream & {
    _emitData: (chunk: string) => void
    _emitStderr: (chunk: string) => void
    _emitExit: (code: number, signal?: string) => void
  } = {
    pid: options.pid ?? 12345,

    write: (_data: string) => {
      if (disposed) throw new Error('Stream disposed')
    },

    closeStdin: () => {
      if (disposed) throw new Error('Stream disposed')
    },

    kill: (_signal?: string) => {
      if (disposed) return
    },

    onData: (callback: ShellDataCallback) => {
      if (disposed) throw new Error('Stream disposed')
      dataCallbacks.push(callback)
      // Send buffered data to late subscribers
      for (const chunk of stdoutBuffer) {
        callback(chunk)
      }
      return () => {
        const idx = dataCallbacks.indexOf(callback)
        if (idx !== -1) dataCallbacks.splice(idx, 1)
      }
    },

    onStderr: (callback: ShellDataCallback) => {
      if (disposed) throw new Error('Stream disposed')
      stderrCallbacks.push(callback)
      // Send buffered data to late subscribers
      for (const chunk of stderrBuffer) {
        callback(chunk)
      }
      return () => {
        const idx = stderrCallbacks.indexOf(callback)
        if (idx !== -1) stderrCallbacks.splice(idx, 1)
      }
    },

    onExit: (callback: ShellExitCallback) => {
      if (disposed) throw new Error('Stream disposed')
      exitCallbacks.push(callback)
      // If already exited, call immediately
      if (exited && finalResult) {
        callback(finalResult.exitCode, finalResult.signal)
      }
      return () => {
        const idx = exitCallbacks.indexOf(callback)
        if (idx !== -1) exitCallbacks.splice(idx, 1)
      }
    },

    wait: async (): Promise<ShellResult> => {
      if (finalResult) return finalResult
      return new Promise((resolve) => {
        const unsubscribe = stream.onExit((exitCode, signal) => {
          unsubscribe()
          finalResult = {
            stdout: stdoutBuffer.join(''),
            stderr: stderrBuffer.join(''),
            exitCode,
            signal,
          }
          resolve(finalResult)
        })
      })
    },

    [Symbol.dispose]: () => {
      disposed = true
      dataCallbacks.length = 0
      stderrCallbacks.length = 0
      exitCallbacks.length = 0
    },

    // Test helpers to emit events
    _emitData: (chunk: string) => {
      stdoutBuffer.push(chunk)
      for (const cb of dataCallbacks) cb(chunk)
    },

    _emitStderr: (chunk: string) => {
      stderrBuffer.push(chunk)
      for (const cb of stderrCallbacks) cb(chunk)
    },

    _emitExit: (code: number, signal?: string) => {
      exited = true
      finalResult = {
        stdout: stdoutBuffer.join(''),
        stderr: stderrBuffer.join(''),
        exitCode: code,
        signal,
      }
      for (const cb of exitCallbacks) cb(code, signal)
    },
  }

  return stream
}

// ============================================================================
// bashx-gfsk: Test ShellApi.exec() returns ShellResult
// ============================================================================

describe('ShellApi.exec()', () => {
  let api: ShellApi

  beforeEach(() => {
    api = createTestShellApi()
  })

  describe('Basic Execution', () => {
    it('should return ShellResult with stdout, stderr, exitCode', async () => {
      // This test will fail because exec() throws "not implemented"
      // When implemented, it should return a proper ShellResult
      const result = await api.exec('echo "hello world"')

      expect(result).toBeDefined()
      expect(typeof result.stdout).toBe('string')
      expect(typeof result.stderr).toBe('string')
      expect(typeof result.exitCode).toBe('number')
      expect(result.stdout).toContain('hello world')
      expect(result.exitCode).toBe(0)
    })

    it('should capture stderr output separately from stdout', async () => {
      const result = await api.exec('echo "error message" >&2')

      expect(result.stderr).toContain('error message')
      expect(result.stdout).toBe('')
    })

    it('should return non-zero exit code for failed commands', async () => {
      const result = await api.exec('exit 42')

      expect(result.exitCode).toBe(42)
    })

    it('should include duration in result', async () => {
      const result = await api.exec('echo "test"')

      expect(result.duration).toBeDefined()
      expect(typeof result.duration).toBe('number')
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Timeout Option', () => {
    it('should respect timeout option and kill long-running commands', async () => {
      const result = await api.exec('sleep 60', { timeout: 100 })

      expect(result.exitCode).not.toBe(0)
      expect(result.timedOut).toBe(true)
    })

    it('should complete within timeout for fast commands', async () => {
      const result = await api.exec('echo "fast"', { timeout: 5000 })

      expect(result.exitCode).toBe(0)
      expect(result.timedOut).toBeFalsy()
    })

    it('should set signal when command is killed due to timeout', async () => {
      const result = await api.exec('sleep 60', { timeout: 100 })

      expect(result.signal).toBeDefined()
      // Could be SIGTERM or SIGKILL depending on implementation
      expect(['SIGTERM', 'SIGKILL']).toContain(result.signal)
    })
  })

  describe('Cwd Option', () => {
    it('should execute command in specified working directory', async () => {
      const result = await api.exec('pwd', { cwd: '/tmp' })

      // On macOS, /tmp is a symlink to /private/tmp
      expect(['/tmp', '/private/tmp']).toContain(result.stdout.trim())
      expect(result.exitCode).toBe(0)
    })

    it('should fail if cwd does not exist', async () => {
      const result = await api.exec('pwd', { cwd: '/nonexistent/path/12345' })

      expect(result.exitCode).not.toBe(0)
    })
  })

  describe('Env Option', () => {
    it('should pass environment variables to command', async () => {
      const result = await api.exec('echo $MY_TEST_VAR', {
        env: { MY_TEST_VAR: 'hello_from_env' },
      })

      expect(result.stdout).toContain('hello_from_env')
    })

    it('should merge with existing environment', async () => {
      const result = await api.exec('echo $PATH', {
        env: { MY_CUSTOM: 'value' },
      })

      // PATH should still be available (merged from process env)
      expect(result.stdout.length).toBeGreaterThan(0)
    })

    it('should allow overriding existing environment variables', async () => {
      const result = await api.exec('echo $HOME', {
        env: { HOME: '/custom/home' },
      })

      expect(result.stdout.trim()).toBe('/custom/home')
    })
  })

  describe('Error Handling', () => {
    it('should handle command not found', async () => {
      const result = await api.exec('nonexistent_command_12345')

      expect(result.exitCode).toBe(127) // Standard "command not found" exit code
      expect(result.stderr).toContain('not found')
    })

    it('should handle permission denied', async () => {
      // Try to execute a file without execute permission
      const result = await api.exec('/etc/passwd')

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.toLowerCase()).toMatch(/permission denied|cannot execute/i)
    })

    it('should handle syntax errors in command', async () => {
      const result = await api.exec('if then fi')

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// bashx-59y9: Test ShellApi.spawn() returns streaming ShellStream
// ============================================================================

describe('ShellApi.spawn()', () => {
  let api: ShellApi

  beforeEach(() => {
    api = createTestShellApi()
  })

  describe('Returns ShellStream', () => {
    it('should return ShellStream (not a resolved value)', () => {
      // spawn() should return synchronously, not a Promise
      const result = api.spawn('cat')

      // Verify it's not a Promise
      expect(result).not.toBeInstanceOf(Promise)
      // Verify it has ShellStream shape
      expect(result.pid).toBeDefined()
      expect(typeof result.write).toBe('function')
      expect(typeof result.closeStdin).toBe('function')
      expect(typeof result.kill).toBe('function')
      expect(typeof result.onData).toBe('function')
      expect(typeof result.onStderr).toBe('function')
      expect(typeof result.onExit).toBe('function')
      expect(typeof result.wait).toBe('function')
    })

    it('should have pid property as a number', () => {
      const stream = api.spawn('cat')

      expect(typeof stream.pid).toBe('number')
      expect(stream.pid).toBeGreaterThan(0)
    })

    it('should have read-only pid property', () => {
      const stream = api.spawn('cat')
      const originalPid = stream.pid

      // Attempting to modify should either throw or have no effect (readonly)
      // TypeScript getter-only properties throw on assignment in strict mode
      try {
        // @ts-expect-error - Testing runtime behavior
        stream.pid = 99999
      } catch {
        // Expected behavior in strict mode - assignment throws
      }

      // Regardless of throw or not, pid should retain original value
      expect(stream.pid).toBe(originalPid)

      // Clean up
      stream.kill()
    })
  })

  describe('ShellStream.write()', () => {
    it('should send data to process stdin', async () => {
      const stream = api.spawn('cat')
      const chunks: string[] = []

      stream.onData((chunk) => chunks.push(chunk))
      stream.write('hello stdin')
      stream.closeStdin()

      const result = await stream.wait()

      expect(result.stdout).toContain('hello stdin')
    })

    it('should support multiple write calls', async () => {
      const stream = api.spawn('cat')
      const chunks: string[] = []

      stream.onData((chunk) => chunks.push(chunk))
      stream.write('line1\n')
      stream.write('line2\n')
      stream.write('line3\n')
      stream.closeStdin()

      const result = await stream.wait()

      expect(result.stdout).toContain('line1')
      expect(result.stdout).toContain('line2')
      expect(result.stdout).toContain('line3')
    })

    it('should throw if stream is disposed', () => {
      const stream = api.spawn('cat')
      stream[Symbol.dispose]()

      expect(() => stream.write('test')).toThrow()
    })
  })

  describe('ShellStream.closeStdin()', () => {
    it('should close stdin and signal EOF to process', async () => {
      const stream = api.spawn('cat')

      stream.write('data')
      stream.closeStdin()

      // Cat should exit after stdin is closed
      const result = await stream.wait()
      expect(result.exitCode).toBe(0)
    })

    it('should be idempotent (safe to call multiple times)', async () => {
      const stream = api.spawn('cat')

      stream.closeStdin()
      stream.closeStdin() // Should not throw
      stream.closeStdin()

      const result = await stream.wait()
      expect(result.exitCode).toBe(0)
    })
  })

  describe('ShellStream.kill()', () => {
    it('should terminate the process', async () => {
      const stream = api.spawn('sleep 60')

      stream.kill()

      const result = await stream.wait()
      expect(result.exitCode).not.toBe(0)
    })

    it('should use SIGTERM by default', async () => {
      const stream = api.spawn('sleep 60')

      stream.kill()

      const result = await stream.wait()
      expect(result.signal).toBe('SIGTERM')
    })

    it('should accept custom signal', async () => {
      const stream = api.spawn('sleep 60')

      stream.kill('SIGKILL')

      const result = await stream.wait()
      expect(result.signal).toBe('SIGKILL')
    })

    it('should be safe to call on already-exited process', async () => {
      const stream = api.spawn('echo "quick"')

      await stream.wait()

      // Should not throw
      stream.kill()
    })
  })
})

// ============================================================================
// bashx-2u2q: Test ShellStream callbacks receive data
// ============================================================================

describe('ShellStream Callbacks', () => {
  describe('onData() callback', () => {
    it('should receive stdout chunks', async () => {
      const stream = createMockShellStream()
      const chunks: string[] = []

      stream.onData((chunk) => chunks.push(chunk))

      stream._emitData('line1\n')
      stream._emitData('line2\n')
      stream._emitExit(0)

      expect(chunks).toEqual(['line1\n', 'line2\n'])
    })

    it('should not receive stderr data', async () => {
      const stream = createMockShellStream()
      const stdoutChunks: string[] = []

      stream.onData((chunk) => stdoutChunks.push(chunk))

      stream._emitData('stdout data')
      stream._emitStderr('stderr data')
      stream._emitExit(0)

      expect(stdoutChunks).toEqual(['stdout data'])
      expect(stdoutChunks).not.toContain('stderr data')
    })

    it('should support multiple callbacks', async () => {
      const stream = createMockShellStream()
      const chunks1: string[] = []
      const chunks2: string[] = []

      stream.onData((chunk) => chunks1.push(chunk))
      stream.onData((chunk) => chunks2.push(chunk))

      stream._emitData('shared data')
      stream._emitExit(0)

      expect(chunks1).toEqual(['shared data'])
      expect(chunks2).toEqual(['shared data'])
    })

    it('should return unsubscribe function', async () => {
      const stream = createMockShellStream()
      const chunks: string[] = []

      const unsubscribe = stream.onData((chunk) => chunks.push(chunk))

      stream._emitData('before')
      unsubscribe()
      stream._emitData('after')
      stream._emitExit(0)

      expect(chunks).toEqual(['before'])
    })
  })

  describe('onStderr() callback', () => {
    it('should receive stderr chunks only', async () => {
      const stream = createMockShellStream()
      const stderrChunks: string[] = []

      stream.onStderr((chunk) => stderrChunks.push(chunk))

      stream._emitData('stdout data')
      stream._emitStderr('stderr data')
      stream._emitExit(0)

      expect(stderrChunks).toEqual(['stderr data'])
    })

    it('should support multiple stderr callbacks', async () => {
      const stream = createMockShellStream()
      const chunks1: string[] = []
      const chunks2: string[] = []

      stream.onStderr((chunk) => chunks1.push(chunk))
      stream.onStderr((chunk) => chunks2.push(chunk))

      stream._emitStderr('error message')
      stream._emitExit(1)

      expect(chunks1).toEqual(['error message'])
      expect(chunks2).toEqual(['error message'])
    })
  })

  describe('onExit() callback', () => {
    it('should receive exit code', async () => {
      const stream = createMockShellStream()
      let receivedCode: number | undefined
      let receivedSignal: string | undefined

      stream.onExit((code, signal) => {
        receivedCode = code
        receivedSignal = signal
      })

      stream._emitExit(0)

      expect(receivedCode).toBe(0)
      expect(receivedSignal).toBeUndefined()
    })

    it('should receive signal when process is killed', async () => {
      const stream = createMockShellStream()
      let receivedCode: number | undefined
      let receivedSignal: string | undefined

      stream.onExit((code, signal) => {
        receivedCode = code
        receivedSignal = signal
      })

      stream._emitExit(-1, 'SIGTERM')

      expect(receivedSignal).toBe('SIGTERM')
    })

    it('should support multiple exit callbacks', async () => {
      const stream = createMockShellStream()
      const exitCodes: number[] = []

      stream.onExit((code) => exitCodes.push(code))
      stream.onExit((code) => exitCodes.push(code * 2))

      stream._emitExit(5)

      expect(exitCodes).toEqual([5, 10])
    })
  })

  describe('Callback Ordering', () => {
    it('should fire data callbacks before exit callback', async () => {
      const stream = createMockShellStream()
      const events: string[] = []

      stream.onData(() => events.push('data'))
      stream.onExit(() => events.push('exit'))

      stream._emitData('chunk')
      stream._emitExit(0)

      expect(events).toEqual(['data', 'exit'])
    })

    it('should fire callbacks in registration order', async () => {
      const stream = createMockShellStream()
      const order: number[] = []

      stream.onData(() => order.push(1))
      stream.onData(() => order.push(2))
      stream.onData(() => order.push(3))

      stream._emitData('test')

      expect(order).toEqual([1, 2, 3])
    })
  })

  describe('Late-registered Callbacks', () => {
    it('should send buffered stdout data to late-registered callbacks', async () => {
      const stream = createMockShellStream()

      // Emit data before registering callback
      stream._emitData('early data')

      // Late registration
      const chunks: string[] = []
      stream.onData((chunk) => chunks.push(chunk))

      // Should receive buffered data
      expect(chunks).toEqual(['early data'])
    })

    it('should send buffered stderr data to late-registered callbacks', async () => {
      const stream = createMockShellStream()

      // Emit stderr before registering callback
      stream._emitStderr('early error')

      // Late registration
      const chunks: string[] = []
      stream.onStderr((chunk) => chunks.push(chunk))

      // Should receive buffered data
      expect(chunks).toEqual(['early error'])
    })

    it('should call exit callback immediately if process already exited', async () => {
      const stream = createMockShellStream()

      // Exit before registering callback
      stream._emitExit(42)

      // Late registration
      let receivedCode: number | undefined
      stream.onExit((code) => {
        receivedCode = code
      })

      // Should receive exit code immediately
      expect(receivedCode).toBe(42)
    })
  })
})

// ============================================================================
// bashx-qz1r: Test ShellStream disposal cleanup
// ============================================================================

describe('ShellStream Disposal', () => {
  describe('Symbol.dispose implementation', () => {
    // TODO: This test requires real ShellStream implementation
    // The mock doesn't call kill() on dispose, but real implementation should
    // When implementing, this test should verify that disposing a stream
    // with a running process calls kill() to clean up
    it.todo('should kill running process on dispose')

    it('should clear callback references on dispose', async () => {
      const stream = createMockShellStream()
      const callback = vi.fn()

      stream.onData(callback)
      stream[Symbol.dispose]()

      // Verify callback is cleared by attempting to emit
      // In our mock, this would throw, but in a real implementation
      // it should simply not call the callback
      expect(() => stream.onData(vi.fn())).toThrow('Stream disposed')
    })

    it('should be idempotent (safe to dispose multiple times)', () => {
      const stream = createMockShellStream()

      // Should not throw
      stream[Symbol.dispose]()
      stream[Symbol.dispose]()
      stream[Symbol.dispose]()
    })

    it('should work with using syntax', async () => {
      // This test verifies the Symbol.dispose contract
      // TypeScript's `using` keyword calls Symbol.dispose automatically
      const disposed: boolean[] = []

      {
        const stream = createMockShellStream()
        // Simulate `using stream = ...` behavior
        try {
          // Use the stream
          stream.onData(() => {})
        } finally {
          stream[Symbol.dispose]()
          disposed.push(true)
        }
      }

      expect(disposed).toEqual([true])
    })
  })

  describe('Post-disposal Behavior', () => {
    it('should throw on write() after disposal', () => {
      const stream = createMockShellStream()
      stream[Symbol.dispose]()

      expect(() => stream.write('test')).toThrow()
    })

    it('should throw on closeStdin() after disposal', () => {
      const stream = createMockShellStream()
      stream[Symbol.dispose]()

      expect(() => stream.closeStdin()).toThrow()
    })

    it('should not throw on kill() after disposal', () => {
      const stream = createMockShellStream()
      stream[Symbol.dispose]()

      // kill() should be safe even after disposal
      expect(() => stream.kill()).not.toThrow()
    })

    it('should throw on registering new callbacks after disposal', () => {
      const stream = createMockShellStream()
      stream[Symbol.dispose]()

      expect(() => stream.onData(vi.fn())).toThrow()
      expect(() => stream.onStderr(vi.fn())).toThrow()
      expect(() => stream.onExit(vi.fn())).toThrow()
    })
  })

  describe('Remote Stub Disposal', () => {
    // TODO: This test requires real RPC implementation
    // When the client disposes the ShellStream stub, the server
    // should be notified to clean up resources via RPC message
    it.todo('should trigger server-side cleanup on dispose')
  })

  describe('Connection Close Triggers Disposal', () => {
    // TODO: This test requires real RPC/WebSocket implementation
    // When the WebSocket/RPC connection is lost, all streams should be disposed
    // and enter disposed state (throwing on new callback registration)
    it.todo('should dispose stream when RPC connection closes')

    // TODO: This test requires real RPC/WebSocket implementation
    // Unexpected disconnection should clean up server-side resources
    // by killing processes to prevent orphans
    it.todo('should kill process when connection unexpectedly closes')
  })
})

// ============================================================================
// Integration Tests (Require Real Implementation)
// ============================================================================

describe('ShellApi Integration', () => {
  describe('exec() and spawn() interoperability', () => {
    it.skip('should execute same command via exec() and spawn() with same result', async () => {
      const api = createTestShellApi()

      // Using exec()
      const execResult = await api.exec('echo "test"')

      // Using spawn()
      const stream = api.spawn('echo "test"')
      const spawnResult = await stream.wait()

      expect(execResult.stdout).toBe(spawnResult.stdout)
      expect(execResult.exitCode).toBe(spawnResult.exitCode)
    })

    it.skip('should share environment between exec() and spawn()', async () => {
      const api = createTestShellApi()
      const env = { SHARED_VAR: 'shared_value' }

      const execResult = await api.exec('echo $SHARED_VAR', { env })

      const stream = api.spawn('echo $SHARED_VAR')
      // Note: spawn options would need to pass env in real implementation
      const spawnResult = await stream.wait()

      expect(execResult.stdout).toContain('shared_value')
    })
  })

  describe('Real-world Command Patterns', () => {
    it.skip('should handle piped commands', async () => {
      const api = createTestShellApi()

      const result = await api.exec('echo "hello world" | tr a-z A-Z')

      expect(result.stdout.trim()).toBe('HELLO WORLD')
    })

    it.skip('should handle interactive processes via spawn()', async () => {
      const api = createTestShellApi()

      const stream = api.spawn('sh')
      const outputs: string[] = []

      stream.onData((chunk) => outputs.push(chunk))

      stream.write('echo "first"\n')
      stream.write('echo "second"\n')
      stream.write('exit 0\n')

      const result = await stream.wait()

      expect(result.exitCode).toBe(0)
      expect(outputs.join('')).toContain('first')
      expect(outputs.join('')).toContain('second')
    })
  })
})

// ============================================================================
// Type Safety Tests (Compile-time verification)
// ============================================================================

describe('Type Safety', () => {
  it('should have correct ShellResult shape', () => {
    const result: ShellResult = {
      stdout: 'output',
      stderr: 'error',
      exitCode: 0,
      signal: undefined,
      timedOut: false,
      duration: 100,
    }

    expect(result.stdout).toBe('output')
    expect(result.exitCode).toBe(0)
  })

  it('should have correct ShellExecOptions shape', () => {
    const options: ShellExecOptions = {
      cwd: '/tmp',
      env: { KEY: 'value' },
      timeout: 5000,
      maxOutput: 1024 * 1024,
      shell: '/bin/bash',
    }

    expect(options.cwd).toBe('/tmp')
  })

  it('should have correct ShellSpawnOptions shape', () => {
    const options: ShellSpawnOptions = {
      cwd: '/home',
      env: { TERM: 'xterm' },
      shell: '/bin/bash',
      cols: 80,
      rows: 24,
    }

    expect(options.cols).toBe(80)
  })

  it('should have correct ShellStream interface', () => {
    // Compile-time check that ShellStream has all required members
    type RequiredMembers = {
      pid: number
      write: (data: string) => void
      closeStdin: () => void
      kill: (signal?: string) => void
      onData: (callback: ShellDataCallback) => () => void
      onStderr: (callback: ShellDataCallback) => () => void
      onExit: (callback: ShellExitCallback) => () => void
      wait: () => Promise<ShellResult>
      [Symbol.dispose]: () => void
    }

    // Type assertion - this would fail at compile time if types don't match
    const _typeCheck: RequiredMembers extends ShellStream ? true : false = true
    expect(_typeCheck).toBe(true)
  })

  it('should have correct ShellApi interface', () => {
    type RequiredApi = {
      exec: (command: string, options?: ShellExecOptions) => Promise<ShellResult>
      spawn: (command: string, options?: ShellSpawnOptions) => ShellStream
    }

    const _typeCheck: RequiredApi extends ShellApi ? true : false = true
    expect(_typeCheck).toBe(true)
  })
})
