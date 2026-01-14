/**
 * @fileoverview Tests for CloudflareContainerExecutor
 *
 * These tests verify the CloudflareContainerExecutor class that provides
 * bash command execution in Cloudflare Containers via multiple backends:
 * - Sandbox SDK (exec/execStream)
 * - HTTP exec endpoint
 * - WebSocket streaming
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  CloudflareContainerExecutor,
  createContainerExecutor,
  createSandboxExecutor,
  createHttpExecutor,
  createWebSocketExecutor,
  isContainerExecutor,
  type CloudflareSandbox,
  type SandboxExecResult,
  type SandboxStreamResult,
  type SandboxStreamChunk,
  type SandboxProcessHandle,
  type ContainerExecutorOptions,
} from '../../src/do/container-executor'

// ============================================================================
// Mock Implementations
// ============================================================================

/**
 * Mock CloudflareSandbox implementation
 */
class MockSandbox implements CloudflareSandbox {
  public lastCommand: string | null = null
  public lastOptions: unknown = null
  public mockResult: SandboxExecResult = {
    stdout: 'mock output',
    stderr: '',
    exitCode: 0,
    success: true,
  }
  public shouldThrow = false
  public throwError: Error | null = null
  public files: Map<string, string | Uint8Array> = new Map()

  async exec(command: string, options?: unknown): Promise<SandboxExecResult> {
    this.lastCommand = command
    this.lastOptions = options

    if (this.shouldThrow) {
      throw this.throwError ?? new Error('Mock execution error')
    }

    return { ...this.mockResult }
  }

  // Mock execStream for streaming tests
  execStreamResult: SandboxStreamResult | null = null
  async execStream(command: string, options?: unknown): Promise<SandboxStreamResult> {
    this.lastCommand = command
    this.lastOptions = options

    if (this.execStreamResult) {
      return this.execStreamResult
    }

    // Default mock implementation
    const chunks: SandboxStreamChunk[] = [
      { type: 'stdout', data: 'line 1\n' },
      { type: 'stdout', data: 'line 2\n' },
      { type: 'stderr', data: 'warning\n' },
      { type: 'exit', data: 0 },
    ]

    let aborted = false
    const stream = new ReadableStream<SandboxStreamChunk>({
      async pull(controller) {
        if (aborted || chunks.length === 0) {
          controller.close()
          return
        }
        const chunk = chunks.shift()!
        controller.enqueue(chunk)
        if (chunk.type === 'exit') {
          controller.close()
        }
      },
    })

    return {
      stream,
      done: Promise.resolve({
        stdout: 'line 1\nline 2\n',
        stderr: 'warning\n',
        exitCode: 0,
        success: true,
      }),
      abort: () => {
        aborted = true
      },
    }
  }

  // Mock startProcess for background process tests
  startProcessHandle: SandboxProcessHandle | null = null
  async startProcess(command: string, options?: unknown): Promise<SandboxProcessHandle> {
    this.lastCommand = command
    this.lastOptions = options

    if (this.startProcessHandle) {
      return this.startProcessHandle
    }

    // Default mock implementation
    let killed = false
    const handle: SandboxProcessHandle = {
      pid: 12345,
      kill: vi.fn(async () => {
        killed = true
      }),
      write: vi.fn(async () => {}),
      closeStdin: vi.fn(async () => {}),
      exited: new Promise<SandboxExecResult>((resolve) => {
        setTimeout(() => {
          resolve({
            stdout: 'process output',
            stderr: '',
            exitCode: killed ? 137 : 0,
            success: !killed,
          })
        }, 10)
      }),
    }

    return handle
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    this.files.set(path, content)
  }

  async readFile(path: string): Promise<string | Uint8Array> {
    const content = this.files.get(path)
    if (content === undefined) {
      throw new Error(`File not found: ${path}`)
    }
    return content
  }

  // Test helpers
  _reset(): void {
    this.lastCommand = null
    this.lastOptions = null
    this.shouldThrow = false
    this.throwError = null
    this.mockResult = {
      stdout: 'mock output',
      stderr: '',
      exitCode: 0,
      success: true,
    }
    this.files.clear()
    this.execStreamResult = null
    this.startProcessHandle = null
  }
}

/**
 * Mock fetch function for HTTP executor tests
 */
function createMockFetch(responses: Map<string, Response>) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const response = responses.get(url)
    if (response) {
      return response.clone()
    }
    return new Response('Not found', { status: 404 })
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('CloudflareContainerExecutor', () => {
  let mockSandbox: MockSandbox

  beforeEach(() => {
    mockSandbox = new MockSandbox()
  })

  afterEach(() => {
    mockSandbox._reset()
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should create instance with default options', () => {
      const executor = new CloudflareContainerExecutor()
      expect(executor).toBeInstanceOf(CloudflareContainerExecutor)
    })

    it('should create instance with sandbox binding', () => {
      const executor = new CloudflareContainerExecutor({
        sandbox: mockSandbox,
      })
      expect(executor).toBeInstanceOf(CloudflareContainerExecutor)
    })

    it('should create instance with custom session ID', () => {
      const executor = new CloudflareContainerExecutor({
        sandbox: mockSandbox,
        sessionId: 'custom-session',
      })
      expect(executor.getSessionId()).toBe('custom-session')
    })

    it('should generate random session ID if not provided', () => {
      const executor = new CloudflareContainerExecutor({
        sandbox: mockSandbox,
      })
      expect(executor.getSessionId()).toBeTruthy()
      expect(executor.getSessionId().length).toBeGreaterThan(0)
    })

    it('should accept custom cwd and timeout', () => {
      const executor = new CloudflareContainerExecutor({
        sandbox: mockSandbox,
        cwd: '/app',
        timeout: 60000,
      })
      const state = executor.getSessionState()
      expect(state.cwd).toBe('/app')
    })

    it('should accept custom environment variables', () => {
      const executor = new CloudflareContainerExecutor({
        sandbox: mockSandbox,
        env: { NODE_ENV: 'production' },
      })
      const state = executor.getSessionState()
      expect(state.env.NODE_ENV).toBe('production')
    })
  })

  describe('execute() with Sandbox SDK', () => {
    it('should execute a command via sandbox', async () => {
      const executor = new CloudflareContainerExecutor({
        sandbox: mockSandbox,
      })

      const result = await executor.execute('ls -la')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('mock output')
      expect(mockSandbox.lastCommand).toBe('ls -la')
    })

    it('should pass cwd option to sandbox', async () => {
      const executor = new CloudflareContainerExecutor({
        sandbox: mockSandbox,
        cwd: '/default',
      })

      await executor.execute('pwd', { cwd: '/custom' })

      expect((mockSandbox.lastOptions as { cwd?: string })?.cwd).toBe('/custom')
    })

    it('should use default cwd when not specified', async () => {
      const executor = new CloudflareContainerExecutor({
        sandbox: mockSandbox,
        cwd: '/app',
      })

      await executor.execute('pwd')

      expect((mockSandbox.lastOptions as { cwd?: string })?.cwd).toBe('/app')
    })

    it('should pass timeout option to sandbox', async () => {
      const executor = new CloudflareContainerExecutor({
        sandbox: mockSandbox,
        timeout: 5000,
      })

      await executor.execute('sleep 1', { timeout: 10000 })

      expect((mockSandbox.lastOptions as { timeout?: number })?.timeout).toBe(10000)
    })

    it('should merge environment variables', async () => {
      const executor = new CloudflareContainerExecutor({
        sandbox: mockSandbox,
        env: { DEFAULT_VAR: 'default' },
      })

      await executor.execute('echo $VAR', { env: { CUSTOM_VAR: 'custom' } })

      const options = mockSandbox.lastOptions as { env?: Record<string, string> }
      expect(options?.env?.DEFAULT_VAR).toBe('default')
      expect(options?.env?.CUSTOM_VAR).toBe('custom')
    })

    it('should handle execution errors', async () => {
      mockSandbox.shouldThrow = true
      mockSandbox.throwError = new Error('Connection timeout')

      const executor = new CloudflareContainerExecutor({
        sandbox: mockSandbox,
      })

      const result = await executor.execute('ls')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Connection timeout')
    })

    it('should handle non-zero exit codes', async () => {
      mockSandbox.mockResult = {
        stdout: '',
        stderr: 'command not found',
        exitCode: 127,
        success: false,
      }

      const executor = new CloudflareContainerExecutor({
        sandbox: mockSandbox,
      })

      const result = await executor.execute('nonexistent')

      expect(result.exitCode).toBe(127)
      expect(result.stderr).toBe('command not found')
    })
  })

  describe('execute() with HTTP endpoint', () => {
    it('should execute a command via HTTP', async () => {
      const mockResponse = Response.json({
        stdout: 'http output',
        stderr: '',
        exitCode: 0,
        success: true,
      })

      const responses = new Map([
        ['https://container.example.com.ai/exec', mockResponse],
      ])

      const executor = new CloudflareContainerExecutor({
        httpExecEndpoint: 'https://container.example.com.ai/exec',
        fetch: createMockFetch(responses),
      })

      const result = await executor.execute('ls -la')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('http output')
    })

    it('should handle HTTP errors', async () => {
      const mockResponse = new Response('Internal Server Error', { status: 500 })

      const responses = new Map([
        ['https://container.example.com.ai/exec', mockResponse],
      ])

      const executor = new CloudflareContainerExecutor({
        httpExecEndpoint: 'https://container.example.com.ai/exec',
        fetch: createMockFetch(responses),
      })

      const result = await executor.execute('ls')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('500')
    })

    it('should include session ID in HTTP headers', async () => {
      let capturedHeaders: Headers | null = null

      const mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.headers) {
          capturedHeaders = new Headers(init.headers as HeadersInit)
        }
        return Response.json({ stdout: '', stderr: '', exitCode: 0 })
      }

      const executor = new CloudflareContainerExecutor({
        httpExecEndpoint: 'https://container.example.com.ai/exec',
        sessionId: 'test-session-123',
        fetch: mockFetch,
      })

      await executor.execute('ls')

      expect(capturedHeaders?.get('X-Session-Id')).toBe('test-session-123')
    })
  })

  describe('execute() without backend', () => {
    it('should return error when no backend is configured', async () => {
      const executor = new CloudflareContainerExecutor()

      const result = await executor.execute('ls')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('No execution backend configured')
    })
  })

  describe('spawn() with Sandbox SDK streaming', () => {
    it('should spawn a command with streaming output', async () => {
      const executor = new CloudflareContainerExecutor({
        sandbox: mockSandbox,
      })

      const stdoutChunks: string[] = []
      const stderrChunks: string[] = []
      let exitCode: number | null = null

      const handle = await executor.spawn('npm', ['run', 'build'], {
        onStdout: (chunk) => stdoutChunks.push(chunk),
        onStderr: (chunk) => stderrChunks.push(chunk),
        onExit: (code) => { exitCode = code },
      })

      expect(handle.pid).toBeDefined()

      const result = await handle.done

      expect(result.exitCode).toBe(0)
      expect(stdoutChunks.length).toBeGreaterThan(0)
      expect(exitCode).toBe(0)
    })

    it('should allow killing a spawned process', async () => {
      const executor = new CloudflareContainerExecutor({
        sandbox: mockSandbox,
      })

      const handle = await executor.spawn('tail', ['-f', '/var/log/test.log'])

      // Kill the process
      handle.kill('SIGTERM')

      // Process should eventually complete
      const result = await handle.done
      expect(result).toBeDefined()
    })
  })

  describe('spawn() with startProcess', () => {
    it('should use startProcess when execStream is not available', async () => {
      // Create a sandbox without execStream
      const sandboxWithProcess: CloudflareSandbox = {
        exec: mockSandbox.exec.bind(mockSandbox),
        startProcess: mockSandbox.startProcess.bind(mockSandbox),
      }

      const executor = new CloudflareContainerExecutor({
        sandbox: sandboxWithProcess,
      })

      const handle = await executor.spawn('sleep', ['10'])

      expect(handle.pid).toBe(12345)
      expect(handle.kill).toBeDefined()
      expect(handle.write).toBeDefined()
      expect(handle.closeStdin).toBeDefined()
    })
  })

  describe('spawn() fallback to exec', () => {
    it('should fallback to exec when no streaming is available', async () => {
      // Create a sandbox with only exec
      const basicSandbox: CloudflareSandbox = {
        exec: mockSandbox.exec.bind(mockSandbox),
      }

      const executor = new CloudflareContainerExecutor({
        sandbox: basicSandbox,
      })

      const stdoutChunks: string[] = []
      let exitCode: number | null = null

      const handle = await executor.spawn('echo', ['hello'], {
        onStdout: (chunk) => stdoutChunks.push(chunk),
        onExit: (code) => { exitCode = code },
      })

      const result = await handle.done

      expect(result.exitCode).toBe(0)
      expect(stdoutChunks.join('')).toBe('mock output')
      expect(exitCode).toBe(0)
    })
  })

  describe('session management', () => {
    it('should track session state', () => {
      const executor = new CloudflareContainerExecutor({
        sandbox: mockSandbox,
        sessionId: 'test-session',
        cwd: '/home/user',
        env: { SHELL: '/bin/bash' },
      })

      const state = executor.getSessionState()

      expect(state.id).toBe('test-session')
      expect(state.cwd).toBe('/home/user')
      expect(state.env.SHELL).toBe('/bin/bash')
    })

    it('should allow updating working directory', () => {
      const executor = new CloudflareContainerExecutor({
        sandbox: mockSandbox,
        cwd: '/home',
      })

      executor.setCwd('/app')

      const state = executor.getSessionState()
      expect(state.cwd).toBe('/app')
    })

    it('should allow updating environment variables', () => {
      const executor = new CloudflareContainerExecutor({
        sandbox: mockSandbox,
      })

      executor.setEnv({ PATH: '/usr/bin', NODE_ENV: 'test' })

      const state = executor.getSessionState()
      expect(state.env.PATH).toBe('/usr/bin')
      expect(state.env.NODE_ENV).toBe('test')
    })

    it('should allow unsetting environment variables', () => {
      const executor = new CloudflareContainerExecutor({
        sandbox: mockSandbox,
        env: { VAR1: 'value1', VAR2: 'value2', VAR3: 'value3' },
      })

      executor.unsetEnv(['VAR2'])

      const state = executor.getSessionState()
      expect(state.env.VAR1).toBe('value1')
      expect(state.env.VAR2).toBeUndefined()
      expect(state.env.VAR3).toBe('value3')
    })

    it('should update lastActivity on execute', async () => {
      const executor = new CloudflareContainerExecutor({
        sandbox: mockSandbox,
      })

      const before = Date.now()
      await executor.execute('ls')
      const after = Date.now()

      const state = executor.getSessionState()
      expect(state.lastActivity).toBeGreaterThanOrEqual(before)
      expect(state.lastActivity).toBeLessThanOrEqual(after)
    })

    it('should track active process count', async () => {
      // Create a sandbox with startProcess that tracks processes
      const sandboxWithProcess: CloudflareSandbox = {
        exec: mockSandbox.exec.bind(mockSandbox),
        startProcess: async () => {
          const handle: SandboxProcessHandle = {
            pid: Math.floor(Math.random() * 10000),
            kill: vi.fn(async () => {}),
            write: vi.fn(async () => {}),
            closeStdin: vi.fn(async () => {}),
            exited: new Promise<SandboxExecResult>((resolve) => {
              setTimeout(() => resolve({
                stdout: '',
                stderr: '',
                exitCode: 0,
                success: true,
              }), 100)
            }),
          }
          return handle
        },
      }

      const executor = new CloudflareContainerExecutor({
        sandbox: sandboxWithProcess,
      })

      // Start a process
      const handle = await executor.spawn('sleep', ['10'])
      expect(executor.getActiveProcessCount()).toBe(1)

      // Wait for it to complete
      await handle.done
      expect(executor.getActiveProcessCount()).toBe(0)
    })
  })

  describe('file operations', () => {
    it('should write files via sandbox', async () => {
      const executor = new CloudflareContainerExecutor({
        sandbox: mockSandbox,
      })

      await executor.writeFile('/test.txt', 'hello world')

      expect(mockSandbox.files.get('/test.txt')).toBe('hello world')
    })

    it('should read files via sandbox', async () => {
      mockSandbox.files.set('/test.txt', 'file content')

      const executor = new CloudflareContainerExecutor({
        sandbox: mockSandbox,
      })

      const content = await executor.readFile('/test.txt')

      expect(content).toBe('file content')
    })

    it('should throw when file operations not supported', async () => {
      const executor = new CloudflareContainerExecutor()

      await expect(executor.writeFile('/test.txt', 'content')).rejects.toThrow(
        'File operations not supported'
      )

      await expect(executor.readFile('/test.txt')).rejects.toThrow(
        'File operations not supported'
      )
    })
  })

  describe('killAll()', () => {
    it('should kill all active processes', async () => {
      const killMock = vi.fn(async () => {})
      const handles: SandboxProcessHandle[] = []

      const sandboxWithProcess: CloudflareSandbox = {
        exec: mockSandbox.exec.bind(mockSandbox),
        startProcess: async () => {
          const handle: SandboxProcessHandle = {
            pid: Math.floor(Math.random() * 10000),
            kill: killMock,
            write: vi.fn(async () => {}),
            closeStdin: vi.fn(async () => {}),
            exited: new Promise(() => {}), // Never resolves
          }
          handles.push(handle)
          return handle
        },
      }

      const executor = new CloudflareContainerExecutor({
        sandbox: sandboxWithProcess,
      })

      // Start multiple processes
      await executor.spawn('process1')
      await executor.spawn('process2')
      await executor.spawn('process3')

      expect(executor.getActiveProcessCount()).toBe(3)

      // Kill all
      await executor.killAll('SIGKILL')

      expect(killMock).toHaveBeenCalledTimes(3)
      expect(killMock).toHaveBeenCalledWith('SIGKILL')
      expect(executor.getActiveProcessCount()).toBe(0)
    })
  })
})

describe('Factory functions', () => {
  let mockSandbox: MockSandbox

  beforeEach(() => {
    mockSandbox = new MockSandbox()
  })

  describe('createContainerExecutor', () => {
    it('should create executor with options', () => {
      const executor = createContainerExecutor({
        sandbox: mockSandbox,
        sessionId: 'factory-session',
      })

      expect(executor).toBeInstanceOf(CloudflareContainerExecutor)
      expect(executor.getSessionId()).toBe('factory-session')
    })
  })

  describe('createSandboxExecutor', () => {
    it('should create executor from sandbox binding', () => {
      const executor = createSandboxExecutor(mockSandbox, 'sandbox-session')

      expect(executor).toBeInstanceOf(CloudflareContainerExecutor)
      expect(executor.getSessionId()).toBe('sandbox-session')
    })

    it('should generate session ID when not provided', () => {
      const executor = createSandboxExecutor(mockSandbox)

      expect(executor.getSessionId()).toBeTruthy()
    })
  })

  describe('createHttpExecutor', () => {
    it('should create executor from HTTP endpoint', () => {
      const executor = createHttpExecutor(
        'https://container.example.com.ai/exec',
        'http-session'
      )

      expect(executor).toBeInstanceOf(CloudflareContainerExecutor)
      expect(executor.getSessionId()).toBe('http-session')
    })
  })

  describe('createWebSocketExecutor', () => {
    it('should create executor from WebSocket endpoint', () => {
      const executor = createWebSocketExecutor(
        'wss://container.example.com.ai/ws',
        'ws-session'
      )

      expect(executor).toBeInstanceOf(CloudflareContainerExecutor)
      expect(executor.getSessionId()).toBe('ws-session')
    })
  })
})

describe('isContainerExecutor', () => {
  it('should return true for CloudflareContainerExecutor instance', () => {
    const executor = new CloudflareContainerExecutor()
    expect(isContainerExecutor(executor)).toBe(true)
  })

  it('should return false for plain object', () => {
    const obj = { execute: () => {} }
    expect(isContainerExecutor(obj)).toBe(false)
  })

  it('should return false for null', () => {
    expect(isContainerExecutor(null)).toBe(false)
  })

  it('should return false for undefined', () => {
    expect(isContainerExecutor(undefined)).toBe(false)
  })

  it('should return false for other types', () => {
    expect(isContainerExecutor('string')).toBe(false)
    expect(isContainerExecutor(123)).toBe(false)
    expect(isContainerExecutor(() => {})).toBe(false)
  })
})

describe('Executor interface', () => {
  it('should implement execute and spawn methods', async () => {
    const mockSandbox = new MockSandbox()
    mockSandbox.mockResult = {
      stdout: 'hello world',
      stderr: '',
      exitCode: 0,
      success: true,
    }

    const executor = new CloudflareContainerExecutor({
      sandbox: mockSandbox,
    })

    // Verify it implements the executor interface
    expect(typeof executor.execute).toBe('function')
    expect(typeof executor.spawn).toBe('function')

    const result = await executor.execute('echo hello')
    expect(result.command).toBe('echo hello')
    expect(result.stdout).toBe('hello world')
    expect(result.exitCode).toBe(0)
  })
})

describe('WebSocket streaming', () => {
  it('should handle WebSocket messages', async () => {
    // Create a mock WebSocket
    const mockWsMessages: Array<{ type: string; data?: string | number }> = [
      { type: 'stdout', data: 'ws line 1\n' },
      { type: 'stdout', data: 'ws line 2\n' },
      { type: 'stderr', data: 'ws warning\n' },
      { type: 'exit', data: 0 },
    ]

    // Mock WebSocket class using addEventListener pattern
    const originalWebSocket = globalThis.WebSocket
    const mockOnMessage = vi.fn()

    class MockWebSocket {
      static OPEN = 1
      readyState = 1
      private listeners: Map<string, Array<(event: unknown) => void>> = new Map()

      constructor(public url: string) {
        // Simulate async connection
        setTimeout(() => {
          this.dispatchEvent('open', {})

          // Send messages
          for (const msg of mockWsMessages) {
            this.dispatchEvent('message', { data: JSON.stringify(msg) })
          }

          this.dispatchEvent('close', {})
        }, 10)
      }

      addEventListener(type: string, listener: (event: unknown) => void) {
        const existing = this.listeners.get(type) || []
        existing.push(listener)
        this.listeners.set(type, existing)
      }

      removeEventListener(type: string, listener: (event: unknown) => void) {
        const existing = this.listeners.get(type) || []
        const index = existing.indexOf(listener)
        if (index >= 0) {
          existing.splice(index, 1)
        }
      }

      private dispatchEvent(type: string, event: unknown) {
        const listeners = this.listeners.get(type) || []
        for (const listener of listeners) {
          listener(event)
        }
      }

      send(data: string) {
        mockOnMessage(data)
      }

      close() {
        this.dispatchEvent('close', {})
      }
    }

    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket

    try {
      const executor = new CloudflareContainerExecutor({
        wsEndpoint: 'wss://container.example.com.ai/ws',
        sessionId: 'ws-test',
      })

      const stdoutChunks: string[] = []
      const stderrChunks: string[] = []
      let exitCode: number | null = null

      const handle = await executor.spawn('tail', ['-f', 'test.log'], {
        onStdout: (chunk) => stdoutChunks.push(chunk),
        onStderr: (chunk) => stderrChunks.push(chunk),
        onExit: (code) => { exitCode = code },
      })

      const result = await handle.done

      expect(stdoutChunks.join('')).toContain('ws line 1')
      expect(stderrChunks.join('')).toContain('ws warning')
      expect(exitCode).toBe(0)
      expect(result.exitCode).toBe(0)
    } finally {
      globalThis.WebSocket = originalWebSocket
    }
  })
})
