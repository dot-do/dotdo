/**
 * CloudflareContainerExecutor Tests
 *
 * Tests for the CloudflareContainerExecutor class that executes
 * bash commands via Cloudflare Containers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  CloudflareContainerExecutor,
  createContainerExecutor,
  createSessionContainerExecutor,
  type ContainerStub,
  type ContainerExecutorConfig,
} from '../../src/do/container-executor.js'
import type { BashResult } from '../../src/types.js'

// Helper to create a mock container stub
function createMockContainerStub(
  responses: Record<string, { status?: number; json?: object; text?: string }> = {},
): ContainerStub {
  return {
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()

      // Find matching response
      for (const [pattern, response] of Object.entries(responses)) {
        if (url.includes(pattern)) {
          return new Response(
            response.json ? JSON.stringify(response.json) : response.text || '',
            { status: response.status ?? 200 },
          )
        }
      }

      // Default response
      return new Response(
        JSON.stringify({ stdout: '', stderr: '', exitCode: 0 }),
        { status: 200 },
      )
    }),
  }
}

describe('CloudflareContainerExecutor', () => {
  describe('constructor', () => {
    it('should create executor with container binding', () => {
      const containerBinding = createMockContainerStub()
      const executor = new CloudflareContainerExecutor({
        containerBinding,
      })

      expect(executor).toBeInstanceOf(CloudflareContainerExecutor)
    })

    it('should use default configuration values', () => {
      const containerBinding = createMockContainerStub()
      const executor = new CloudflareContainerExecutor({
        containerBinding,
      })

      // Verify defaults by making a request
      expect(executor).toBeDefined()
    })

    it('should accept custom configuration', () => {
      const containerBinding = createMockContainerStub()
      const executor = new CloudflareContainerExecutor({
        containerBinding,
        apiBasePath: '/custom/api',
        defaultTimeout: 60000,
        maxOutputSize: 2097152,
      })

      expect(executor).toBeDefined()
    })

    it('should accept getContainer function for named instances', () => {
      const containerBinding = {}
      const mockStub = createMockContainerStub()
      const getContainerFn = vi.fn().mockReturnValue(mockStub)

      const executor = new CloudflareContainerExecutor({
        containerBinding,
        getContainer: getContainerFn,
        containerName: 'test-session',
      })

      expect(executor).toBeDefined()
    })
  })

  describe('execute', () => {
    it('should execute a command and return result', async () => {
      const containerStub = createMockContainerStub({
        '/api/exec': {
          json: { stdout: 'hello world', stderr: '', exitCode: 0 },
        },
      })

      const executor = new CloudflareContainerExecutor({
        containerBinding: containerStub,
      })

      const result = await executor.execute('echo hello world')

      expect(result.stdout).toBe('hello world')
      expect(result.exitCode).toBe(0)
      expect(containerStub.fetch).toHaveBeenCalled()
    })

    it('should send correct request body', async () => {
      const containerStub = createMockContainerStub({
        '/api/exec': {
          json: { stdout: '', stderr: '', exitCode: 0 },
        },
      })

      const executor = new CloudflareContainerExecutor({
        containerBinding: containerStub,
      })

      await executor.execute('ls -la', {
        cwd: '/app',
        env: { NODE_ENV: 'test' },
        timeout: 5000,
      })

      const fetchCall = (containerStub.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)

      expect(body.command).toBe('ls -la')
      expect(body.cwd).toBe('/app')
      expect(body.env).toEqual({ NODE_ENV: 'test' })
      expect(body.timeout).toBe(5000)
    })

    it('should handle execution errors', async () => {
      const containerStub = createMockContainerStub({
        '/api/exec': {
          json: { stdout: '', stderr: 'command not found', exitCode: 127 },
        },
      })

      const executor = new CloudflareContainerExecutor({
        containerBinding: containerStub,
      })

      const result = await executor.execute('nonexistent-command')

      expect(result.exitCode).toBe(127)
      expect(result.stderr).toBe('command not found')
    })

    it('should handle HTTP errors', async () => {
      const containerStub = createMockContainerStub({
        '/api/exec': {
          status: 500,
          text: 'Internal Server Error',
        },
      })

      const executor = new CloudflareContainerExecutor({
        containerBinding: containerStub,
      })

      const result = await executor.execute('echo test')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Container request failed')
    })

    it('should handle network errors', async () => {
      const containerStub: ContainerStub = {
        fetch: vi.fn().mockRejectedValue(new Error('Network error')),
      }

      const executor = new CloudflareContainerExecutor({
        containerBinding: containerStub,
      })

      const result = await executor.execute('echo test')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Container execution failed')
      expect(result.stderr).toContain('Network error')
    })

    it('should use custom API base path', async () => {
      const containerStub = createMockContainerStub({
        '/custom/v2/exec': {
          json: { stdout: 'custom path', stderr: '', exitCode: 0 },
        },
      })

      const executor = new CloudflareContainerExecutor({
        containerBinding: containerStub,
        apiBasePath: '/custom/v2',
      })

      const result = await executor.execute('echo test')

      expect(result.stdout).toBe('custom path')
      const fetchCall = (containerStub.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toBe('/custom/v2/exec')
    })

    it('should cache container stub', async () => {
      const containerBinding = {}
      const mockStub = createMockContainerStub({
        '/api/exec': {
          json: { stdout: '', stderr: '', exitCode: 0 },
        },
      })
      const getContainerFn = vi.fn().mockReturnValue(mockStub)

      const executor = new CloudflareContainerExecutor({
        containerBinding,
        getContainer: getContainerFn,
        containerName: 'test-session',
      })

      await executor.execute('cmd1')
      await executor.execute('cmd2')

      // getContainer should only be called once
      expect(getContainerFn).toHaveBeenCalledTimes(1)
      expect(mockStub.fetch).toHaveBeenCalledTimes(2)
    })

    it('should include stdin in request when provided', async () => {
      const containerStub = createMockContainerStub({
        '/api/exec': {
          json: { stdout: 'received input', stderr: '', exitCode: 0 },
        },
      })

      const executor = new CloudflareContainerExecutor({
        containerBinding: containerStub,
      })

      await executor.execute('cat', { stdin: 'input data' })

      const fetchCall = (containerStub.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)

      expect(body.stdin).toBe('input data')
    })

    it('should use default timeout when not specified', async () => {
      const containerStub = createMockContainerStub({
        '/api/exec': {
          json: { stdout: '', stderr: '', exitCode: 0 },
        },
      })

      const executor = new CloudflareContainerExecutor({
        containerBinding: containerStub,
        defaultTimeout: 45000,
      })

      await executor.execute('long-command')

      const fetchCall = (containerStub.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)

      expect(body.timeout).toBe(45000)
    })

    it('should use default maxOutputSize when not specified', async () => {
      const containerStub = createMockContainerStub({
        '/api/exec': {
          json: { stdout: '', stderr: '', exitCode: 0 },
        },
      })

      const executor = new CloudflareContainerExecutor({
        containerBinding: containerStub,
        maxOutputSize: 2097152,
      })

      await executor.execute('large-output-command')

      const fetchCall = (containerStub.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)

      expect(body.maxOutputSize).toBe(2097152)
    })

    it('should return correct BashResult structure', async () => {
      const containerStub = createMockContainerStub({
        '/api/exec': {
          json: { stdout: 'output', stderr: 'error', exitCode: 1 },
        },
      })

      const executor = new CloudflareContainerExecutor({
        containerBinding: containerStub,
      })

      const result = await executor.execute('failing-command')

      expect(result).toMatchObject({
        input: 'failing-command',
        command: 'failing-command',
        valid: true,
        generated: false,
        stdout: 'output',
        stderr: 'error',
        exitCode: 1,
      })
      expect(result.intent).toBeDefined()
      expect(result.classification).toBeDefined()
    })
  })

  describe('spawn', () => {
    it('should spawn a command and return handle', async () => {
      const containerStub = createMockContainerStub({
        '/api/spawn': {
          json: { pid: 1234 },
        },
      })

      const executor = new CloudflareContainerExecutor({
        containerBinding: containerStub,
      })

      const handle = await executor.spawn('tail', ['-f', 'log.txt'])

      expect(handle.pid).toBe(1234)
      expect(handle.done).toBeInstanceOf(Promise)
      expect(typeof handle.kill).toBe('function')
      expect(typeof handle.write).toBe('function')
      expect(typeof handle.closeStdin).toBe('function')
    })

    it('should throw on spawn error', async () => {
      const containerStub = createMockContainerStub({
        '/api/spawn': {
          status: 500,
          text: 'Spawn failed',
        },
      })

      const executor = new CloudflareContainerExecutor({
        containerBinding: containerStub,
      })

      await expect(executor.spawn('command')).rejects.toThrow('Container spawn failed')
    })

    it('should send correct spawn request body', async () => {
      const containerStub = createMockContainerStub({
        '/api/spawn': {
          json: { pid: 1234 },
        },
      })

      const executor = new CloudflareContainerExecutor({
        containerBinding: containerStub,
      })

      await executor.spawn('node', ['server.js'], {
        cwd: '/app',
        env: { PORT: '3000' },
      })

      const fetchCall = (containerStub.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)

      expect(body.command).toBe('node')
      expect(body.args).toEqual(['server.js'])
      expect(body.cwd).toBe('/app')
      expect(body.env).toEqual({ PORT: '3000' })
    })

    it('should handle kill gracefully', async () => {
      const containerStub = createMockContainerStub({
        '/api/spawn': {
          json: { pid: 1234 },
        },
        '/api/kill': {
          json: { success: true },
        },
      })

      const executor = new CloudflareContainerExecutor({
        containerBinding: containerStub,
      })

      const handle = await executor.spawn('long-running')

      // Kill should not throw
      await expect(handle.kill('SIGTERM')).resolves.not.toThrow()

      const killCall = (containerStub.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0].includes('/api/kill'),
      )
      expect(killCall).toBeDefined()
      const body = JSON.parse(killCall[1].body)
      expect(body.pid).toBe(1234)
      expect(body.signal).toBe('SIGTERM')
    })

    it('should handle kill error silently', async () => {
      const containerStub = createMockContainerStub({
        '/api/spawn': {
          json: { pid: 1234 },
        },
      })
      // Make kill throw
      ;(containerStub.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
        if (url.includes('/kill')) {
          throw new Error('Kill failed')
        }
        return new Response(JSON.stringify({ pid: 1234 }), { status: 200 })
      })

      const executor = new CloudflareContainerExecutor({
        containerBinding: containerStub,
      })

      const handle = await executor.spawn('command')

      // Should not throw even on error
      await expect(handle.kill()).resolves.not.toThrow()
    })

    it('should handle write to stdin', async () => {
      const containerStub = createMockContainerStub({
        '/api/spawn': {
          json: { pid: 1234 },
        },
        '/api/stdin': {
          json: { success: true },
        },
      })

      const executor = new CloudflareContainerExecutor({
        containerBinding: containerStub,
      })

      const handle = await executor.spawn('cat')

      await handle.write('test input')

      const stdinCall = (containerStub.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === '/api/stdin',
      )
      expect(stdinCall).toBeDefined()
      const body = JSON.parse(stdinCall[1].body)
      expect(body.pid).toBe(1234)
      expect(body.data).toBe('test input')
    })

    it('should handle closeStdin', async () => {
      const containerStub = createMockContainerStub({
        '/api/spawn': {
          json: { pid: 1234 },
        },
        '/api/stdin/close': {
          json: { success: true },
        },
      })

      const executor = new CloudflareContainerExecutor({
        containerBinding: containerStub,
      })

      const handle = await executor.spawn('cat')

      await handle.closeStdin()

      const closeCall = (containerStub.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0].includes('/api/stdin/close'),
      )
      expect(closeCall).toBeDefined()
      const body = JSON.parse(closeCall[1].body)
      expect(body.pid).toBe(1234)
    })
  })
})

describe('createContainerExecutor', () => {
  it('should create executor from env binding', () => {
    const mockStub = createMockContainerStub()
    const env = {
      BASH_CONTAINER: mockStub,
    }

    const executor = createContainerExecutor(env, 'BASH_CONTAINER')

    expect(executor).toBeInstanceOf(CloudflareContainerExecutor)
  })

  it('should throw when binding not found', () => {
    const env = {}

    expect(() => createContainerExecutor(env, 'MISSING_BINDING')).toThrow(
      'Container binding "MISSING_BINDING" not found in environment',
    )
  })

  it('should pass additional options', () => {
    const mockStub = createMockContainerStub()
    const env = {
      BASH_CONTAINER: mockStub,
    }

    const executor = createContainerExecutor(env, 'BASH_CONTAINER', {
      apiBasePath: '/v2/api',
      defaultTimeout: 120000,
    })

    expect(executor).toBeInstanceOf(CloudflareContainerExecutor)
  })
})

describe('createSessionContainerExecutor', () => {
  it('should create executor with session isolation', () => {
    const mockStub = createMockContainerStub()
    const getContainer = vi.fn().mockReturnValue(mockStub)
    const env = {
      BASH_CONTAINER: {},
    }

    const executor = createSessionContainerExecutor(
      env,
      'BASH_CONTAINER',
      'session-123',
      getContainer,
    )

    expect(executor).toBeInstanceOf(CloudflareContainerExecutor)
  })

  it('should call getContainer with correct arguments on first use', async () => {
    const mockStub = createMockContainerStub({
      '/api/exec': {
        json: { stdout: '', stderr: '', exitCode: 0 },
      },
    })
    const getContainer = vi.fn().mockReturnValue(mockStub)
    const containerBinding = { id: 'binding-object' }
    const env = {
      BASH_CONTAINER: containerBinding,
    }

    const executor = createSessionContainerExecutor(
      env,
      'BASH_CONTAINER',
      'session-456',
      getContainer,
    )

    await executor.execute('test')

    expect(getContainer).toHaveBeenCalledWith(containerBinding, 'session-456')
  })

  it('should throw when binding not found', () => {
    const getContainer = vi.fn()
    const env = {}

    expect(() =>
      createSessionContainerExecutor(env, 'MISSING', 'session-id', getContainer),
    ).toThrow('Container binding "MISSING" not found in environment')
  })

  it('should pass additional options', () => {
    const mockStub = createMockContainerStub()
    const getContainer = vi.fn().mockReturnValue(mockStub)
    const env = {
      BASH_CONTAINER: {},
    }

    const executor = createSessionContainerExecutor(
      env,
      'BASH_CONTAINER',
      'session-789',
      getContainer,
      {
        apiBasePath: '/custom',
        defaultTimeout: 60000,
      },
    )

    expect(executor).toBeInstanceOf(CloudflareContainerExecutor)
  })
})

describe('BashModule integration with CloudflareContainerExecutor', () => {
  // Lazy import to avoid circular dependencies
  let BashModule: typeof import('../../src/do/index.js').BashModule

  beforeEach(async () => {
    const module = await import('../../src/do/index.js')
    BashModule = module.BashModule
  })

  it('should work with BashModule', async () => {
    const containerStub = createMockContainerStub({
      '/api/exec': {
        json: { stdout: 'hello from container', stderr: '', exitCode: 0 },
      },
    })

    const executor = new CloudflareContainerExecutor({
      containerBinding: containerStub,
    })

    const bash = new BashModule(executor)
    const result = await bash.exec('echo', ['hello', 'from', 'container'])

    expect(result.stdout).toBe('hello from container')
    expect(result.exitCode).toBe(0)
  })

  it('should work with BashModule.run for scripts', async () => {
    const containerStub = createMockContainerStub({
      '/api/exec': {
        json: { stdout: 'script output', stderr: '', exitCode: 0 },
      },
    })

    const executor = new CloudflareContainerExecutor({
      containerBinding: containerStub,
    })

    const bash = new BashModule(executor)
    const result = await bash.run(`
      set -e
      echo "script output"
    `)

    expect(result.stdout).toBe('script output')
  })

  it('should work with withBash mixin and CloudflareContainerExecutor', async () => {
    const containerStub = createMockContainerStub({
      '/api/exec': {
        json: { stdout: 'mixin result', stderr: '', exitCode: 0 },
      },
    })

    const { withBash } = await import('../../src/do/index.js')

    class MockDO {
      env = {
        CONTAINER: containerStub,
      }
    }

    const DOWithBash = withBash(MockDO, (instance) =>
      new CloudflareContainerExecutor({
        containerBinding: instance.env.CONTAINER,
      }),
    )

    const instance = new DOWithBash()
    const result = await instance.bash.exec('echo', ['mixin', 'result'])

    expect(result.stdout).toBe('mixin result')
  })
})
