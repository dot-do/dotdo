/**
 * Tests for CloudflareContainerExecutor - External executor integration for Cloudflare Containers
 *
 * This test file covers:
 * - Executor initialization and configuration
 * - Session management and isolation
 * - HTTP exec operations
 * - WebSocket streaming
 * - Error handling and timeouts
 * - Utility methods
 *
 * @module durable-object/container-executor.test
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import {
  CloudflareContainerExecutor,
  createContainerExecutor,
  createIsolatedExecutor,
  type ContainerBinding,
  type ContainerInstance,
  type ContainerExecutorConfig,
  type ContainerExecResult,
  type ExecOptions,
} from './container-executor.js'

// ============================================================================
// Mock Container Implementation
// ============================================================================

/**
 * Mock container instance for testing
 */
class MockContainerInstance implements ContainerInstance {
  private execHandler: ((command: string, options: Record<string, unknown>) => Promise<{
    exitCode: number
    stdout: string
    stderr: string
    killed?: boolean
    signal?: string
  }>) | null = null

  private healthStatus: { status: string; lastChange: number } = {
    status: 'running',
    lastChange: Date.now(),
  }

  setExecHandler(handler: typeof this.execHandler): void {
    this.execHandler = handler
  }

  setHealthStatus(status: string): void {
    this.healthStatus = { status, lastChange: Date.now() }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Handle WebSocket upgrade - in real CF environment this returns 101
    // In Node.js tests we simulate with a mock that throws
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      // Return mock response - in real environment CF handles WebSocket upgrade
      // For testing we return a 200 with a special header to indicate WS mock
      return new Response(JSON.stringify({ type: 'websocket_mock' }), {
        status: 200,
        headers: { 'X-WebSocket-Mock': 'true' },
      })
    }

    return this.handleRequest(request, url)
  }

  async containerFetch(requestOrUrl: Request | string | URL, initOrPort?: RequestInit | number, port?: number): Promise<Response> {
    let request: Request
    if (requestOrUrl instanceof Request) {
      request = requestOrUrl
    } else {
      const init = typeof initOrPort === 'object' ? initOrPort : undefined
      request = new Request(String(requestOrUrl), init)
    }

    const url = new URL(request.url)
    return this.handleRequest(request, url)
  }

  private async handleRequest(request: Request, url: URL): Promise<Response> {
    // Health endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify(this.healthStatus), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Exec endpoint
    if (url.pathname === '/exec' && request.method === 'POST') {
      const body = await request.json() as {
        command: string
        cwd?: string
        env?: Record<string, string>
        stdin?: string
        combineOutput?: boolean
        timeout?: number
      }

      if (this.execHandler) {
        const result = await this.execHandler(body.command, body)
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Default successful response
      return new Response(JSON.stringify({
        exitCode: 0,
        stdout: `Executed: ${body.command}`,
        stderr: '',
        killed: false,
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not Found', { status: 404 })
  }
}

/**
 * Mock container binding for testing
 */
class MockContainerBinding implements ContainerBinding {
  private instances: Map<string, MockContainerInstance> = new Map()
  private idCounter = 0

  get(id: string | DurableObjectId): ContainerInstance {
    const key = typeof id === 'string' ? id : id.toString()
    if (!this.instances.has(key)) {
      this.instances.set(key, new MockContainerInstance())
    }
    return this.instances.get(key)!
  }

  idFromName(name: string): DurableObjectId {
    return { toString: () => `id-${name}` } as DurableObjectId
  }

  newUniqueId(): DurableObjectId {
    return { toString: () => `unique-${++this.idCounter}` } as DurableObjectId
  }

  // Test helper to get mock instance - ensures instance is created first
  getMockInstance(sessionId: string): MockContainerInstance {
    const id = this.idFromName(sessionId)
    const key = id.toString()
    // Ensure instance is created (simulates executor.exec() calling getContainerInstance)
    if (!this.instances.has(key)) {
      this.instances.set(key, new MockContainerInstance())
    }
    return this.instances.get(key) as MockContainerInstance
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('CloudflareContainerExecutor', () => {
  let mockBinding: MockContainerBinding
  let executor: CloudflareContainerExecutor

  beforeEach(() => {
    mockBinding = new MockContainerBinding()
    executor = new CloudflareContainerExecutor({
      container: mockBinding,
      sessionId: 'test-session',
    })
  })

  // ==========================================================================
  // Initialization Tests
  // ==========================================================================

  describe('initialization', () => {
    it('should create executor with default options', () => {
      const exec = new CloudflareContainerExecutor({
        container: mockBinding,
      })
      expect(exec.getSessionId()).toBeDefined()
      expect(exec.getCwd()).toBe('/')
    })

    it('should accept custom session ID', () => {
      expect(executor.getSessionId()).toBe('test-session')
    })

    it('should accept custom working directory', () => {
      const exec = new CloudflareContainerExecutor({
        container: mockBinding,
        cwd: '/app',
      })
      expect(exec.getCwd()).toBe('/app')
    })

    it('should accept custom environment variables', () => {
      const exec = new CloudflareContainerExecutor({
        container: mockBinding,
        env: { NODE_ENV: 'production' },
      })
      expect(exec.getEnv('NODE_ENV')).toBe('production')
    })

    it('should use factory function to create executor', () => {
      const exec = createContainerExecutor(mockBinding, 'factory-session')
      expect(exec.getSessionId()).toBe('factory-session')
    })

    it('should create isolated executor with unique session', () => {
      const exec1 = createIsolatedExecutor(mockBinding)
      const exec2 = createIsolatedExecutor(mockBinding)
      expect(exec1.getSessionId()).not.toBe(exec2.getSessionId())
    })
  })

  // ==========================================================================
  // Session Management Tests
  // ==========================================================================

  describe('session management', () => {
    it('should get current session ID', () => {
      expect(executor.getSessionId()).toBe('test-session')
    })

    it('should change session ID', () => {
      executor.setSessionId('new-session')
      expect(executor.getSessionId()).toBe('new-session')
    })

    it('should create new session', () => {
      const originalSession = executor.getSessionId()
      const newSession = executor.createSession()
      expect(newSession).not.toBe(originalSession)
      expect(executor.getSessionId()).toBe(newSession)
    })

    it('should isolate different sessions', async () => {
      // Set up different handlers for different sessions
      const exec1 = createContainerExecutor(mockBinding, 'session-1')
      const exec2 = createContainerExecutor(mockBinding, 'session-2')

      // Execute on session 1 - should get default response
      const result1 = await exec1.exec('echo hello')
      expect(result1.sessionId).toBe('session-1')

      // Execute on session 2 - should get default response
      const result2 = await exec2.exec('echo world')
      expect(result2.sessionId).toBe('session-2')
    })
  })

  // ==========================================================================
  // HTTP Exec Tests
  // ==========================================================================

  describe('exec', () => {
    it('should execute simple command', async () => {
      const result = await executor.exec('echo hello')
      expect(result.exitCode).toBe(0)
      expect(result.success).toBe(true)
      expect(result.command).toBe('echo hello')
      expect(result.sessionId).toBe('test-session')
    })

    it('should include execution duration', async () => {
      const result = await executor.exec('sleep 0.1')
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })

    it('should pass working directory option', async () => {
      const mockInstance = mockBinding.getMockInstance('test-session')
      let capturedCwd = ''

      mockInstance.setExecHandler(async (command, options) => {
        capturedCwd = options.cwd as string
        return { exitCode: 0, stdout: '', stderr: '' }
      })

      await executor.exec('ls', { cwd: '/custom/dir' })
      expect(capturedCwd).toBe('/custom/dir')
    })

    it('should pass environment variables', async () => {
      const mockInstance = mockBinding.getMockInstance('test-session')
      let capturedEnv: Record<string, string> = {}

      mockInstance.setExecHandler(async (command, options) => {
        capturedEnv = options.env as Record<string, string>
        return { exitCode: 0, stdout: '', stderr: '' }
      })

      await executor.exec('printenv', { env: { MY_VAR: 'my_value' } })
      expect(capturedEnv.MY_VAR).toBe('my_value')
    })

    it('should handle command failure', async () => {
      const mockInstance = mockBinding.getMockInstance('test-session')

      mockInstance.setExecHandler(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'command not found',
      }))

      const result = await executor.exec('nonexistent')
      expect(result.exitCode).toBe(1)
      expect(result.success).toBe(false)
      expect(result.stderr).toContain('command not found')
    })

    it('should handle killed commands', async () => {
      const mockInstance = mockBinding.getMockInstance('test-session')

      mockInstance.setExecHandler(async () => ({
        exitCode: 137,
        stdout: '',
        stderr: '',
        killed: true,
        signal: 'SIGKILL',
      }))

      const result = await executor.exec('sleep 1000')
      expect(result.exitCode).toBe(137)
      expect(result.killed).toBe(true)
      expect(result.signal).toBe('SIGKILL')
    })

    it('should handle HTTP errors', async () => {
      const mockInstance = mockBinding.getMockInstance('test-session')

      // Override to return error
      const originalFetch = mockInstance.containerFetch.bind(mockInstance)
      mockInstance.containerFetch = async () => {
        return new Response('Internal Server Error', { status: 500 })
      }

      const result = await executor.exec('echo test')
      expect(result.exitCode).toBe(1)
      expect(result.success).toBe(false)
      expect(result.stderr).toContain('Container exec failed')

      // Restore
      mockInstance.containerFetch = originalFetch
    })

    it('should handle network errors', async () => {
      const mockInstance = mockBinding.getMockInstance('test-session')

      mockInstance.containerFetch = async () => {
        throw new Error('Network error')
      }

      const result = await executor.exec('echo test')
      expect(result.exitCode).toBe(1)
      expect(result.success).toBe(false)
      expect(result.stderr).toContain('Exec error')
    })
  })

  // ==========================================================================
  // Exec All Tests
  // ==========================================================================

  describe('execAll', () => {
    it('should execute multiple commands in sequence', async () => {
      const results = await executor.execAll(['echo 1', 'echo 2', 'echo 3'])
      expect(results).toHaveLength(3)
      expect(results.every(r => r.success)).toBe(true)
    })

    it('should stop on first failure', async () => {
      const mockInstance = mockBinding.getMockInstance('test-session')
      let callCount = 0

      mockInstance.setExecHandler(async (command) => {
        callCount++
        if (command === 'fail') {
          return { exitCode: 1, stdout: '', stderr: 'failed' }
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      })

      const results = await executor.execAll(['echo 1', 'fail', 'echo 3'])
      expect(results).toHaveLength(2)
      expect(callCount).toBe(2) // Should not execute third command
    })
  })

  // ==========================================================================
  // Exec Stdout Tests
  // ==========================================================================

  describe('execStdout', () => {
    it('should return stdout on success', async () => {
      const mockInstance = mockBinding.getMockInstance('test-session')

      mockInstance.setExecHandler(async () => ({
        exitCode: 0,
        stdout: 'hello world',
        stderr: '',
      }))

      const stdout = await executor.execStdout('echo hello world')
      expect(stdout).toBe('hello world')
    })

    it('should throw on failure', async () => {
      const mockInstance = mockBinding.getMockInstance('test-session')

      mockInstance.setExecHandler(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'error message',
      }))

      await expect(executor.execStdout('fail')).rejects.toThrow('error message')
    })
  })

  // ==========================================================================
  // Container State Tests
  // ==========================================================================

  describe('getState', () => {
    it('should return running state', async () => {
      const mockInstance = mockBinding.getMockInstance('test-session')
      mockInstance.setHealthStatus('running')

      const state = await executor.getState()
      expect(state.status).toBe('running')
      expect(state.lastChange).toBeDefined()
    })

    it('should return stopped state', async () => {
      const mockInstance = mockBinding.getMockInstance('test-session')
      mockInstance.setHealthStatus('stopped')

      const state = await executor.getState()
      expect(state.status).toBe('stopped')
    })

    it('should handle health check failure', async () => {
      const mockInstance = mockBinding.getMockInstance('test-session')
      mockInstance.containerFetch = async () => {
        throw new Error('Connection refused')
      }

      const state = await executor.getState()
      expect(state.status).toBe('stopped')
    })
  })

  // ==========================================================================
  // Ready Check Tests
  // ==========================================================================

  describe('isReady', () => {
    it('should return true when running', async () => {
      const mockInstance = mockBinding.getMockInstance('test-session')
      mockInstance.setHealthStatus('running')

      const ready = await executor.isReady()
      expect(ready).toBe(true)
    })

    it('should return false when stopped', async () => {
      const mockInstance = mockBinding.getMockInstance('test-session')
      mockInstance.setHealthStatus('stopped')

      const ready = await executor.isReady()
      expect(ready).toBe(false)
    })
  })

  // ==========================================================================
  // Utility Method Tests
  // ==========================================================================

  describe('utility methods', () => {
    describe('cwd', () => {
      it('should get default cwd', () => {
        expect(executor.getCwd()).toBe('/')
      })

      it('should set cwd', () => {
        executor.setCwd('/app')
        expect(executor.getCwd()).toBe('/app')
      })

      it('should use cwd in exec', async () => {
        const mockInstance = mockBinding.getMockInstance('test-session')
        let capturedCwd = ''

        mockInstance.setExecHandler(async (command, options) => {
          capturedCwd = options.cwd as string
          return { exitCode: 0, stdout: '', stderr: '' }
        })

        executor.setCwd('/custom')
        await executor.exec('pwd')
        expect(capturedCwd).toBe('/custom')
      })
    })

    describe('env', () => {
      it('should get env variable', () => {
        executor.setEnv('MY_VAR', 'my_value')
        expect(executor.getEnv('MY_VAR')).toBe('my_value')
      })

      it('should return undefined for missing env', () => {
        expect(executor.getEnv('MISSING')).toBeUndefined()
      })

      it('should get all env variables', () => {
        executor.setEnv('VAR1', 'value1')
        executor.setEnv('VAR2', 'value2')
        const allEnv = executor.getAllEnv()
        expect(allEnv.VAR1).toBe('value1')
        expect(allEnv.VAR2).toBe('value2')
      })

      it('should clear all env variables', () => {
        executor.setEnv('VAR1', 'value1')
        executor.clearEnv()
        expect(executor.getAllEnv()).toEqual({})
      })

      it('should merge default and option env in exec', async () => {
        const mockInstance = mockBinding.getMockInstance('test-session')
        let capturedEnv: Record<string, string> = {}

        mockInstance.setExecHandler(async (command, options) => {
          capturedEnv = options.env as Record<string, string>
          return { exitCode: 0, stdout: '', stderr: '' }
        })

        executor.setEnv('DEFAULT', 'default_value')
        await executor.exec('printenv', { env: { OPTION: 'option_value' } })

        expect(capturedEnv.DEFAULT).toBe('default_value')
        expect(capturedEnv.OPTION).toBe('option_value')
      })
    })
  })

  // ==========================================================================
  // Streaming Tests
  // ==========================================================================

  describe('createStreamingExec', () => {
    it('should create streaming session with session ID', () => {
      const session = executor.createStreamingExec('echo hello')
      expect(session.sessionId).toBe('test-session')
    })

    it('should have events async iterator', () => {
      const session = executor.createStreamingExec('echo hello')
      expect(session.events).toBeDefined()
      expect(typeof session.events[Symbol.asyncIterator]).toBe('function')
    })

    it('should have done promise', () => {
      const session = executor.createStreamingExec('echo hello')
      expect(session.done).toBeInstanceOf(Promise)
    })

    it('should have write method', () => {
      const session = executor.createStreamingExec('cat')
      expect(typeof session.write).toBe('function')
    })

    it('should have kill method', () => {
      const session = executor.createStreamingExec('sleep 1000')
      expect(typeof session.kill).toBe('function')
    })

    it('should have close method', () => {
      const session = executor.createStreamingExec('echo hello')
      expect(typeof session.close).toBe('function')
      session.close() // Should not throw
    })
  })

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  describe('integration scenarios', () => {
    it('should handle typical build workflow', async () => {
      const exec = createContainerExecutor(mockBinding, 'build-session', {
        cwd: '/app',
        env: { NODE_ENV: 'production' },
      })

      const mockInstance = mockBinding.getMockInstance('build-session')
      const executedCommands: string[] = []

      mockInstance.setExecHandler(async (command) => {
        executedCommands.push(command)
        return { exitCode: 0, stdout: `Executed: ${command}`, stderr: '' }
      })

      // Simulate build workflow
      await exec.exec('npm install')
      await exec.exec('npm run build')
      await exec.exec('npm test')

      expect(executedCommands).toEqual([
        'npm install',
        'npm run build',
        'npm test',
      ])
    })

    it('should handle session per user pattern', async () => {
      // User 1 session
      const user1Exec = createContainerExecutor(mockBinding, 'user-1')
      const user1Result = await user1Exec.exec('echo user1')
      expect(user1Result.sessionId).toBe('user-1')

      // User 2 session
      const user2Exec = createContainerExecutor(mockBinding, 'user-2')
      const user2Result = await user2Exec.exec('echo user2')
      expect(user2Result.sessionId).toBe('user-2')

      // Sessions are isolated
      expect(user1Result.sessionId).not.toBe(user2Result.sessionId)
    })

    it('should handle ephemeral session pattern', async () => {
      // Create new isolated session for each operation
      const sessions: string[] = []

      for (let i = 0; i < 3; i++) {
        const exec = createIsolatedExecutor(mockBinding)
        sessions.push(exec.getSessionId())
        await exec.exec('whoami')
      }

      // All sessions should be unique
      const uniqueSessions = new Set(sessions)
      expect(uniqueSessions.size).toBe(3)
    })
  })
})
