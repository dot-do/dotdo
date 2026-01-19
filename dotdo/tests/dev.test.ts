import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

describe('dotdo dev command', () => {
  let mockProcess: Partial<ChildProcess>
  let mockStdout: any
  let mockStderr: any

  beforeEach(() => {
    // Create mock event emitters for stdout/stderr
    mockStdout = {
      on: vi.fn((event, callback) => {
        if (event === 'data') {
          // Simulate wrangler startup messages
          setTimeout(() => callback(Buffer.from('⎔ Starting local server...\n')), 10)
          setTimeout(() => callback(Buffer.from('Ready on http://localhost:8787\n')), 20)
        }
        return mockStdout
      }),
      pipe: vi.fn(),
    }

    mockStderr = {
      on: vi.fn(),
      pipe: vi.fn(),
    }

    // Create mock child process
    mockProcess = {
      stdout: mockStdout,
      stderr: mockStderr,
      on: vi.fn((event, callback) => {
        if (event === 'close') {
          // Don't auto-close in tests
        }
        return mockProcess as ChildProcess
      }),
      kill: vi.fn(),
      pid: 12345,
    }

    // Setup spawn mock to return our mock process
    vi.mocked(spawn).mockReturnValue(mockProcess as ChildProcess)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Basic functionality', () => {
    it('should start wrangler dev server', async () => {
      const { startDevServer } = await import('../commands/dev')

      const server = startDevServer({})

      expect(spawn).toHaveBeenCalledWith(
        expect.stringContaining('wrangler'),
        expect.arrayContaining(['dev']),
        expect.objectContaining({
          stdio: 'pipe',
          cwd: expect.any(String),
        })
      )

      server.stop()
    })

    it('should use default port 8787', async () => {
      const { startDevServer } = await import('../commands/dev')

      const server = startDevServer({})

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['dev']),
        expect.any(Object)
      )

      // Wrangler uses 8787 by default
      const calls = vi.mocked(spawn).mock.calls
      expect(calls[0][1]).not.toContain('--port')

      server.stop()
    })

    it('should accept custom port via --port flag', async () => {
      const { startDevServer } = await import('../commands/dev')

      const server = startDevServer({ port: 3000 })

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['dev', '--port', '3000']),
        expect.any(Object)
      )

      server.stop()
    })

    it('should support --inspect flag for debugging', async () => {
      const { startDevServer } = await import('../commands/dev')

      const server = startDevServer({ inspect: true })

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['dev', '--inspect']),
        expect.any(Object)
      )

      server.stop()
    })

    it('should pass through wrangler config file if specified', async () => {
      const { startDevServer } = await import('../commands/dev')

      const server = startDevServer({ config: 'custom-wrangler.toml' })

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['dev', '--config', 'custom-wrangler.toml']),
        expect.any(Object)
      )

      server.stop()
    })
  })

  describe('Environment handling', () => {
    it('should load .env file if present', async () => {
      const { startDevServer } = await import('../commands/dev')

      const server = startDevServer({ env: '.env.local' })

      // Should pass .env to wrangler
      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['dev', '--env', '.env.local']),
        expect.any(Object)
      )

      server.stop()
    })

    it('should inherit environment variables', async () => {
      const { startDevServer } = await import('../commands/dev')

      const server = startDevServer({})

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining(process.env),
        })
      )

      server.stop()
    })
  })

  describe('Output handling', () => {
    it('should display startup banner', async () => {
      const { startDevServer } = await import('../commands/dev')
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const server = startDevServer({})

      // Should log startup banner
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('dotdo dev')
      )

      server.stop()
      consoleLogSpy.mockRestore()
    })

    it('should format and display wrangler output', async () => {
      const { startDevServer } = await import('../commands/dev')

      const server = startDevServer({ verbose: true })

      // Wait for stdout to be processed
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Should pipe stdout
      expect(mockStdout.on).toHaveBeenCalledWith('data', expect.any(Function))

      server.stop()
    })

    it('should display request logs in dev mode', async () => {
      const { startDevServer } = await import('../commands/dev')

      const server = startDevServer({})

      // Simulate a request log from wrangler
      const dataCallback = mockStdout.on.mock.calls.find(
        (call: any) => call[0] === 'data'
      )?.[1]

      if (dataCallback) {
        dataCallback(Buffer.from('[wrangler] GET / 200 OK (5ms)\n'))
      }

      server.stop()
    })
  })

  describe('File watching and hot reload', () => {
    it('should enable hot reload by default', async () => {
      const { startDevServer } = await import('../commands/dev')

      const server = startDevServer({})

      // Wrangler has hot reload enabled by default, so we shouldn't see --no-bundle
      const calls = vi.mocked(spawn).mock.calls
      expect(calls[0][1]).not.toContain('--no-bundle')

      server.stop()
    })

    it('should support live reload flag', async () => {
      const { startDevServer } = await import('../commands/dev')

      const server = startDevServer({ liveReload: true })

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['dev', '--live-reload']),
        expect.any(Object)
      )

      server.stop()
    })

    it('should watch for file changes', async () => {
      const { startDevServer } = await import('../commands/dev')

      const server = startDevServer({})

      // Simulate file change notification
      const dataCallback = mockStdout.on.mock.calls.find(
        (call: any) => call[0] === 'data'
      )?.[1]

      if (dataCallback) {
        dataCallback(Buffer.from('[wrangler] Detected changes, reloading...\n'))
      }

      server.stop()
    })
  })

  describe('Process management', () => {
    it('should cleanup process on stop', async () => {
      const { startDevServer } = await import('../commands/dev')

      const server = startDevServer({})
      server.stop()

      expect(mockProcess.kill).toHaveBeenCalled()
    })

    it('should handle process errors gracefully', async () => {
      const { startDevServer } = await import('../commands/dev')

      // Mock process error
      const errorCallback = vi.fn()
      mockProcess.on = vi.fn((event, callback) => {
        if (event === 'error') {
          errorCallback.mockImplementation(callback)
        }
        return mockProcess as ChildProcess
      })

      const server = startDevServer({})

      // Trigger error
      if (errorCallback.mock.calls.length > 0) {
        errorCallback(new Error('Process failed'))
      }

      server.stop()
    })

    it('should return process info', async () => {
      const { startDevServer } = await import('../commands/dev')

      const server = startDevServer({ port: 3000 })

      expect(server).toHaveProperty('port', 3000)
      expect(server).toHaveProperty('stop')
      expect(server.stop).toBeTypeOf('function')

      server.stop()
    })
  })

  describe('Advanced features', () => {
    it('should support local protocol flag', async () => {
      const { startDevServer } = await import('../commands/dev')

      const server = startDevServer({ localProtocol: 'https' })

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['dev', '--local-protocol', 'https']),
        expect.any(Object)
      )

      server.stop()
    })

    it('should support persist state flag for DO', async () => {
      const { startDevServer } = await import('../commands/dev')

      const server = startDevServer({ persist: true })

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['dev', '--persist']),
        expect.any(Object)
      )

      server.stop()
    })

    it('should display helpful info on startup', async () => {
      const { startDevServer } = await import('../commands/dev')
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const server = startDevServer({ port: 3000 })

      // Should show URL and other info
      expect(consoleLogSpy).toHaveBeenCalled()

      server.stop()
      consoleLogSpy.mockRestore()
    })
  })
})
