/**
 * RpcExecutor Module Tests (RED)
 *
 * Tests for the RpcExecutor module that will be extracted from TieredExecutor.
 * RpcExecutor handles Tier 2 operations: RPC bindings for external services.
 *
 * This includes:
 * - jq.do for jq processing
 * - npm.do for npm/npx/pnpm/yarn/bun commands
 * - git.do for git commands
 * - Custom RPC service bindings
 *
 * Tests are written to FAIL until the module is implemented.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'

// Import types and classes that don't exist yet - this will cause compilation errors
import type {
  RpcExecutorConfig,
  RpcServiceBinding,
  RpcEndpoint,
  RpcRequestPayload,
  RpcResponsePayload,
} from '../../../src/do/executors/rpc-executor.js'

import {
  RpcExecutor,
  createRpcExecutor,
  DEFAULT_RPC_SERVICES,
} from '../../../src/do/executors/rpc-executor.js'

import type { BashResult, ExecOptions } from '../../../src/types.js'

// ============================================================================
// Mock Fetch for RPC Testing
// ============================================================================

function createMockFetch(): Mock {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : {}

    // Default successful response
    return new Response(
      JSON.stringify({
        stdout: 'mock output',
        stderr: '',
        exitCode: 0,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  })
}

function createMockServiceBinding(): { fetch: typeof fetch } {
  return {
    fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {}

      return new Response(
        JSON.stringify({
          stdout: 'service binding output',
          stderr: '',
          exitCode: 0,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }) as typeof fetch,
  }
}

// ============================================================================
// RpcExecutor Class Tests
// ============================================================================

describe('RpcExecutor', () => {
  describe('Construction', () => {
    it('should create an instance with no config', () => {
      const executor = new RpcExecutor()

      expect(executor).toBeDefined()
      expect(executor).toBeInstanceOf(RpcExecutor)
    })

    it('should create an instance with custom bindings', () => {
      const executor = new RpcExecutor({
        bindings: {
          custom: {
            name: 'custom',
            endpoint: 'https://custom.do',
            commands: ['custom-cmd'],
          },
        },
      })

      expect(executor).toBeDefined()
      expect(executor.hasBinding('custom')).toBe(true)
    })

    it('should create an instance via factory function', () => {
      const executor = createRpcExecutor()

      expect(executor).toBeDefined()
      expect(executor).toBeInstanceOf(RpcExecutor)
    })

    it('should include default RPC services', () => {
      const executor = new RpcExecutor()

      expect(executor.hasBinding('jq')).toBe(true)
      expect(executor.hasBinding('npm')).toBe(true)
      expect(executor.hasBinding('git')).toBe(true)
      expect(executor.hasBinding('pyx')).toBe(true)
    })

    it('should allow overriding default services', () => {
      const executor = new RpcExecutor({
        bindings: {
          jq: {
            name: 'jq',
            endpoint: 'https://custom-jq.example.com',
            commands: ['jq'],
          },
        },
      })

      const binding = executor.getBinding('jq')
      expect(binding?.endpoint).toBe('https://custom-jq.example.com')
    })
  })

  describe('Command Classification', () => {
    let executor: RpcExecutor

    beforeEach(() => {
      executor = new RpcExecutor()
    })

    it('should identify RPC commands', () => {
      expect(executor.canExecute('jq')).toBe(true)
      expect(executor.canExecute('npm')).toBe(true)
      expect(executor.canExecute('npx')).toBe(true)
      expect(executor.canExecute('git')).toBe(true)
      expect(executor.canExecute('python')).toBe(true)
      expect(executor.canExecute('pip')).toBe(true)
      expect(executor.canExecute('pyx')).toBe(true)
    })

    it('should reject non-RPC commands', () => {
      expect(executor.canExecute('echo')).toBe(false)
      expect(executor.canExecute('cat')).toBe(false)
      expect(executor.canExecute('docker')).toBe(false)
    })

    it('should identify service for command', () => {
      expect(executor.getServiceForCommand('jq')).toBe('jq')
      expect(executor.getServiceForCommand('npm')).toBe('npm')
      expect(executor.getServiceForCommand('npx')).toBe('npm')
      expect(executor.getServiceForCommand('yarn')).toBe('npm')
      expect(executor.getServiceForCommand('git')).toBe('git')
      expect(executor.getServiceForCommand('python')).toBe('pyx')
      expect(executor.getServiceForCommand('pip')).toBe('pyx')
      expect(executor.getServiceForCommand('pipx')).toBe('pyx')
      expect(executor.getServiceForCommand('uvx')).toBe('pyx')
    })

    it('should return null for unknown commands', () => {
      expect(executor.getServiceForCommand('unknown')).toBeNull()
    })
  })

  describe('HTTP Endpoint Execution', () => {
    let executor: RpcExecutor
    let mockFetch: Mock

    beforeEach(() => {
      mockFetch = createMockFetch()
      globalThis.fetch = mockFetch

      executor = new RpcExecutor({
        bindings: {
          jq: {
            name: 'jq',
            endpoint: 'https://jq.do',
            commands: ['jq'],
          },
        },
      })
    })

    it('should make POST request to RPC endpoint', async () => {
      await executor.execute('jq .name')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://jq.do/execute',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      )
    })

    it('should include command in request body', async () => {
      await executor.execute('jq .name')

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body)

      expect(body.command).toBe('jq .name')
    })

    it('should include options in request body', async () => {
      await executor.execute('jq .name', {
        cwd: '/tmp',
        timeout: 5000,
        env: { KEY: 'value' },
      })

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body)

      expect(body.cwd).toBe('/tmp')
      expect(body.timeout).toBe(5000)
      expect(body.env).toEqual({ KEY: 'value' })
    })

    it('should parse successful response', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stdout: '"test"',
            stderr: '',
            exitCode: 0,
          }),
          { status: 200 }
        )
      )

      const result = await executor.execute('jq .name')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('"test"')
      expect(result.stderr).toBe('')
    })

    it('should handle error response', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Internal Server Error', { status: 500 })
      )

      const result = await executor.execute('jq .name')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('RPC error')
    })

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(executor.execute('jq .name')).rejects.toThrow('Tier 2 RPC execution failed')
    })
  })

  describe('Service Binding Execution', () => {
    let executor: RpcExecutor
    let mockBinding: { fetch: Mock }

    beforeEach(() => {
      mockBinding = {
        fetch: vi.fn(async () =>
          new Response(
            JSON.stringify({
              stdout: 'binding output',
              stderr: '',
              exitCode: 0,
            }),
            { status: 200 }
          )
        ),
      }

      executor = new RpcExecutor({
        bindings: {
          jq: {
            name: 'jq',
            endpoint: mockBinding,
            commands: ['jq'],
          },
        },
      })
    })

    it('should use fetch method from service binding', async () => {
      await executor.execute('jq .name')

      expect(mockBinding.fetch).toHaveBeenCalled()
    })

    it('should call binding fetch with correct path', async () => {
      await executor.execute('jq .name')

      expect(mockBinding.fetch).toHaveBeenCalledWith(
        '/',
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('should parse binding response', async () => {
      const result = await executor.execute('jq .name')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('binding output')
    })

    it('should handle binding error response', async () => {
      mockBinding.fetch.mockResolvedValueOnce(
        new Response('Service error', { status: 500 })
      )

      const result = await executor.execute('jq .name')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('RPC error')
    })
  })

  describe('Default RPC Services', () => {
    let executor: RpcExecutor
    let mockFetch: Mock

    beforeEach(() => {
      mockFetch = createMockFetch()
      globalThis.fetch = mockFetch
      executor = new RpcExecutor()
    })

    it('should use jq.do for jq commands', async () => {
      await executor.execute('jq .name')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('jq.do'),
        expect.any(Object)
      )
    })

    it('should use npm.do for npm commands', async () => {
      await executor.execute('npm install')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('npm.do'),
        expect.any(Object)
      )
    })

    it('should use npm.do for npx commands', async () => {
      await executor.execute('npx prettier --write .')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('npm.do'),
        expect.any(Object)
      )
    })

    it('should use npm.do for yarn commands', async () => {
      await executor.execute('yarn add lodash')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('npm.do'),
        expect.any(Object)
      )
    })

    it('should use npm.do for pnpm commands', async () => {
      await executor.execute('pnpm install')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('npm.do'),
        expect.any(Object)
      )
    })

    it('should use npm.do for bun commands', async () => {
      await executor.execute('bun install')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('npm.do'),
        expect.any(Object)
      )
    })

    it('should use git.do for git commands', async () => {
      await executor.execute('git status')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('git.do'),
        expect.any(Object)
      )
    })
  })

  describe('Timeout Handling', () => {
    let executor: RpcExecutor
    let mockFetch: Mock

    beforeEach(() => {
      mockFetch = createMockFetch()
      globalThis.fetch = mockFetch
      executor = new RpcExecutor({ defaultTimeout: 30000 })
    })

    it('should use default timeout when not specified', async () => {
      await executor.execute('jq .name')

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body)

      expect(body.timeout).toBe(30000)
    })

    it('should use custom timeout from options', async () => {
      await executor.execute('jq .name', { timeout: 5000 })

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body)

      expect(body.timeout).toBe(5000)
    })
  })

  describe('Custom Bindings', () => {
    it('should support adding custom service bindings', () => {
      const executor = new RpcExecutor({
        bindings: {
          myService: {
            name: 'myService',
            endpoint: 'https://my-service.do',
            commands: ['my-cmd', 'my-other-cmd'],
          },
        },
      })

      expect(executor.canExecute('my-cmd')).toBe(true)
      expect(executor.canExecute('my-other-cmd')).toBe(true)
      expect(executor.getServiceForCommand('my-cmd')).toBe('myService')
    })

    it('should execute custom service commands', async () => {
      const mockFetch = createMockFetch()
      globalThis.fetch = mockFetch

      const executor = new RpcExecutor({
        bindings: {
          myService: {
            name: 'myService',
            endpoint: 'https://my-service.do',
            commands: ['my-cmd'],
          },
        },
      })

      await executor.execute('my-cmd arg1 arg2')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://my-service.do/execute',
        expect.any(Object)
      )
    })
  })

  describe('Result Format', () => {
    let executor: RpcExecutor
    let mockFetch: Mock

    beforeEach(() => {
      mockFetch = createMockFetch()
      globalThis.fetch = mockFetch
      executor = new RpcExecutor()
    })

    it('should return BashResult compatible structure', async () => {
      const result = await executor.execute('jq .name')

      expect(result).toHaveProperty('input')
      expect(result).toHaveProperty('command')
      expect(result).toHaveProperty('stdout')
      expect(result).toHaveProperty('stderr')
      expect(result).toHaveProperty('exitCode')
      expect(result).toHaveProperty('valid')
      expect(result).toHaveProperty('generated')
      expect(result).toHaveProperty('intent')
      expect(result).toHaveProperty('classification')
    })

    it('should include tier information in classification', async () => {
      const result = await executor.execute('jq .name')

      expect(result.classification.reason).toContain('Tier 2')
    })
  })

  describe('Error Handling', () => {
    let executor: RpcExecutor

    beforeEach(() => {
      executor = new RpcExecutor()
    })

    it('should throw for commands without RPC binding', async () => {
      await expect(executor.execute('unknown-cmd')).rejects.toThrow(
        'No RPC service available for command'
      )
    })

    it('should throw when binding not found', async () => {
      // Force a state where service is identified but binding is missing
      const badExecutor = new RpcExecutor({
        bindings: {},
      })

      await expect(badExecutor.execute('jq .name')).rejects.toThrow()
    })
  })

  describe('Binding Management', () => {
    let executor: RpcExecutor

    beforeEach(() => {
      executor = new RpcExecutor()
    })

    it('should list available services', () => {
      const services = executor.getAvailableServices()

      expect(services).toContain('jq')
      expect(services).toContain('npm')
      expect(services).toContain('git')
    })

    it('should list commands for a service', () => {
      const commands = executor.getCommandsForService('npm')

      expect(commands).toContain('npm')
      expect(commands).toContain('npx')
      expect(commands).toContain('yarn')
      expect(commands).toContain('pnpm')
      expect(commands).toContain('bun')
    })

    it('should get binding by name', () => {
      const binding = executor.getBinding('jq')

      expect(binding).toBeDefined()
      expect(binding?.name).toBe('jq')
      expect(binding?.commands).toContain('jq')
    })

    it('should check if binding exists', () => {
      expect(executor.hasBinding('jq')).toBe(true)
      expect(executor.hasBinding('unknown')).toBe(false)
    })
  })
})

// ============================================================================
// DEFAULT_RPC_SERVICES Tests
// ============================================================================

describe('DEFAULT_RPC_SERVICES', () => {
  it('should export DEFAULT_RPC_SERVICES', () => {
    expect(DEFAULT_RPC_SERVICES).toBeDefined()
    expect(typeof DEFAULT_RPC_SERVICES).toBe('object')
  })

  it('should include jq service', () => {
    expect(DEFAULT_RPC_SERVICES.jq).toBeDefined()
    expect(DEFAULT_RPC_SERVICES.jq.endpoint).toBe('https://jq.do')
    expect(DEFAULT_RPC_SERVICES.jq.commands).toContain('jq')
  })

  it('should include npm service', () => {
    expect(DEFAULT_RPC_SERVICES.npm).toBeDefined()
    expect(DEFAULT_RPC_SERVICES.npm.endpoint).toBe('https://npm.do')
    expect(DEFAULT_RPC_SERVICES.npm.commands).toContain('npm')
    expect(DEFAULT_RPC_SERVICES.npm.commands).toContain('npx')
  })

  it('should include git service', () => {
    expect(DEFAULT_RPC_SERVICES.git).toBeDefined()
    expect(DEFAULT_RPC_SERVICES.git.endpoint).toBe('https://git.do')
    expect(DEFAULT_RPC_SERVICES.git.commands).toContain('git')
  })

  it('should include pyx service', () => {
    expect(DEFAULT_RPC_SERVICES.pyx).toBeDefined()
    expect(DEFAULT_RPC_SERVICES.pyx.endpoint).toBe('https://pyx.do')
    expect(DEFAULT_RPC_SERVICES.pyx.commands).toContain('python')
    expect(DEFAULT_RPC_SERVICES.pyx.commands).toContain('python3')
    expect(DEFAULT_RPC_SERVICES.pyx.commands).toContain('pip')
    expect(DEFAULT_RPC_SERVICES.pyx.commands).toContain('pip3')
    expect(DEFAULT_RPC_SERVICES.pyx.commands).toContain('pipx')
    expect(DEFAULT_RPC_SERVICES.pyx.commands).toContain('uvx')
    expect(DEFAULT_RPC_SERVICES.pyx.commands).toContain('pyx')
  })
})

// ============================================================================
// Pyx.do Python Integration Tests
// ============================================================================

describe('RpcExecutor Python Integration', () => {
  let executor: RpcExecutor
  let mockFetch: Mock

  beforeEach(() => {
    mockFetch = createMockFetch()
    globalThis.fetch = mockFetch
    executor = new RpcExecutor()
  })

  describe('Python Command Classification', () => {
    it('should identify python commands', () => {
      expect(executor.canExecute('python')).toBe(true)
      expect(executor.canExecute('python3')).toBe(true)
      expect(executor.canExecute('pip')).toBe(true)
      expect(executor.canExecute('pip3')).toBe(true)
      expect(executor.canExecute('pipx')).toBe(true)
      expect(executor.canExecute('uvx')).toBe(true)
      expect(executor.canExecute('pyx')).toBe(true)
    })

    it('should identify pyx service for python commands', () => {
      expect(executor.getServiceForCommand('python')).toBe('pyx')
      expect(executor.getServiceForCommand('python3')).toBe('pyx')
      expect(executor.getServiceForCommand('pip')).toBe('pyx')
      expect(executor.getServiceForCommand('pipx')).toBe('pyx')
      expect(executor.getServiceForCommand('uvx')).toBe('pyx')
    })
  })

  describe('Python Script Execution', () => {
    it('should execute python script via pyx.do', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stdout: 'Hello from Python!\n',
            stderr: '',
            exitCode: 0,
          }),
          { status: 200 }
        )
      )

      await executor.execute('python -c "print(\'Hello from Python!\')"')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('pyx.do'),
        expect.any(Object)
      )
    })

    it('should execute python3 script via pyx.do', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stdout: '3.11.0\n',
            stderr: '',
            exitCode: 0,
          }),
          { status: 200 }
        )
      )

      await executor.execute('python3 --version')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('pyx.do'),
        expect.any(Object)
      )
    })

    it('should handle python script errors', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stdout: '',
            stderr: 'NameError: name \'undefined_var\' is not defined\n',
            exitCode: 1,
          }),
          { status: 200 }
        )
      )

      const result = await executor.execute('python -c "print(undefined_var)"')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('NameError')
    })
  })

  describe('Package Installation', () => {
    it('should execute pip install via pyx.do', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stdout: 'Successfully installed requests-2.31.0\n',
            stderr: '',
            exitCode: 0,
          }),
          { status: 200 }
        )
      )

      await executor.execute('pip install requests')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('pyx.do'),
        expect.any(Object)
      )

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body)
      expect(body.command).toBe('pip install requests')
    })

    it('should execute pipx run via pyx.do', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stdout: 'Black version 24.1.0\n',
            stderr: '',
            exitCode: 0,
          }),
          { status: 200 }
        )
      )

      await executor.execute('pipx run black --version')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('pyx.do'),
        expect.any(Object)
      )
    })

    it('should execute uvx commands via pyx.do', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stdout: 'ruff 0.5.0\n',
            stderr: '',
            exitCode: 0,
          }),
          { status: 200 }
        )
      )

      await executor.execute('uvx ruff --version')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('pyx.do'),
        expect.any(Object)
      )
    })
  })

  describe('Direct pyx Command', () => {
    it('should execute pyx command directly', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stdout: 'Running black formatter...\n',
            stderr: '',
            exitCode: 0,
          }),
          { status: 200 }
        )
      )

      await executor.execute('pyx black --check .')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('pyx.do'),
        expect.any(Object)
      )
    })
  })
})

// ============================================================================
// Type Tests
// ============================================================================

describe('RpcExecutor Type Definitions', () => {
  it('should have correct RpcExecutorConfig shape', () => {
    const config: RpcExecutorConfig = {
      bindings: {
        test: {
          name: 'test',
          endpoint: 'https://test.do',
          commands: ['test'],
        },
      },
      defaultTimeout: 30000,
    }

    expect(config).toBeDefined()
  })

  it('should have correct RpcServiceBinding shape with string endpoint', () => {
    const binding: RpcServiceBinding = {
      name: 'test',
      endpoint: 'https://test.do',
      commands: ['test', 'test2'],
    }

    expect(binding).toBeDefined()
  })

  it('should have correct RpcServiceBinding shape with fetch endpoint', () => {
    const binding: RpcServiceBinding = {
      name: 'test',
      endpoint: { fetch: async () => new Response() },
      commands: ['test'],
    }

    expect(binding).toBeDefined()
  })

  it('should have correct RpcRequestPayload shape', () => {
    const payload: RpcRequestPayload = {
      command: 'jq .name',
      cwd: '/tmp',
      env: { KEY: 'value' },
      timeout: 5000,
    }

    expect(payload).toBeDefined()
  })

  it('should have correct RpcResponsePayload shape', () => {
    const response: RpcResponsePayload = {
      stdout: 'output',
      stderr: '',
      exitCode: 0,
    }

    expect(response).toBeDefined()
  })
})

// ============================================================================
// esm.do ESM Module Integration Tests
// ============================================================================

describe('RpcExecutor ESM Module Integration', () => {
  let executor: RpcExecutor
  let mockFetch: Mock

  beforeEach(() => {
    mockFetch = createMockFetch()
    globalThis.fetch = mockFetch
    executor = new RpcExecutor()
  })

  describe('ESM Command Classification', () => {
    it('should include esm service in default bindings', () => {
      expect(executor.hasBinding('esm')).toBe(true)
    })

    it('should identify esm commands', () => {
      expect(executor.canExecute('esm')).toBe(true)
    })

    it('should identify esm service for esm commands', () => {
      expect(executor.getServiceForCommand('esm')).toBe('esm')
    })

    it('should get commands for esm service', () => {
      const commands = executor.getCommandsForService('esm')
      expect(commands).toContain('esm')
    })
  })

  describe('DEFAULT_RPC_SERVICES esm binding', () => {
    it('should include esm service in DEFAULT_RPC_SERVICES', () => {
      expect(DEFAULT_RPC_SERVICES.esm).toBeDefined()
    })

    it('should have correct esm endpoint', () => {
      expect(DEFAULT_RPC_SERVICES.esm.endpoint).toBe('https://esm.do')
    })

    it('should have esm in commands list', () => {
      expect(DEFAULT_RPC_SERVICES.esm.commands).toContain('esm')
    })

    it('should have correct esm service name', () => {
      expect(DEFAULT_RPC_SERVICES.esm.name).toBe('esm')
    })
  })

  describe('ESM Module Creation', () => {
    it('should execute esm create via esm.do', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stdout: 'Created module: my-module\n',
            stderr: '',
            exitCode: 0,
          }),
          { status: 200 }
        )
      )

      await executor.execute('esm create my-module')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('esm.do'),
        expect.any(Object)
      )

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body)
      expect(body.command).toBe('esm create my-module')
    })

    it('should include environment variables in esm create', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stdout: 'Created module: my-module\n',
            stderr: '',
            exitCode: 0,
          }),
          { status: 200 }
        )
      )

      await executor.execute('esm create my-module', {
        env: { ESM_TOKEN: 'test-token' },
      })

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body)
      expect(body.env).toEqual({ ESM_TOKEN: 'test-token' })
    })
  })

  describe('ESM Module Testing', () => {
    it('should execute esm test via esm.do', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stdout: 'All tests passed (3/3)\n',
            stderr: '',
            exitCode: 0,
          }),
          { status: 200 }
        )
      )

      const result = await executor.execute('esm test my-module')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('esm.do'),
        expect.any(Object)
      )
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('All tests passed')
    })

    it('should handle test failures', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stdout: '',
            stderr: 'Test failed: expected 2 but got 3\n',
            exitCode: 1,
          }),
          { status: 200 }
        )
      )

      const result = await executor.execute('esm test my-module')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Test failed')
    })
  })

  describe('ESM Module Execution', () => {
    it('should execute esm run via esm.do', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stdout: 'Hello from ESM module!\n',
            stderr: '',
            exitCode: 0,
          }),
          { status: 200 }
        )
      )

      const result = await executor.execute('esm run my-module')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('esm.do'),
        expect.any(Object)
      )
      expect(result.stdout).toBe('Hello from ESM module!\n')
    })

    it('should pass arguments to esm run', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stdout: 'Result: 42\n',
            stderr: '',
            exitCode: 0,
          }),
          { status: 200 }
        )
      )

      await executor.execute('esm run my-module --input=42')

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body)
      expect(body.command).toBe('esm run my-module --input=42')
    })

    it('should handle runtime errors', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stdout: '',
            stderr: 'ReferenceError: x is not defined\n',
            exitCode: 1,
          }),
          { status: 200 }
        )
      )

      const result = await executor.execute('esm run broken-module')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('ReferenceError')
    })
  })

  describe('ESM Module Publishing', () => {
    it('should execute esm publish via esm.do', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stdout: 'Published my-module@1.0.0\n',
            stderr: '',
            exitCode: 0,
          }),
          { status: 200 }
        )
      )

      const result = await executor.execute('esm publish my-module')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('esm.do'),
        expect.any(Object)
      )
      expect(result.stdout).toContain('Published')
    })

    it('should handle authentication errors during publish', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stdout: '',
            stderr: 'Error: Authentication required. Please provide ESM_TOKEN.\n',
            exitCode: 1,
          }),
          { status: 200 }
        )
      )

      const result = await executor.execute('esm publish my-module')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Authentication required')
    })
  })

  describe('ESM HTTP Endpoint', () => {
    it('should make POST request to esm.do/execute', async () => {
      await executor.execute('esm create test-module')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://esm.do/execute',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      )
    })

    it('should handle esm.do server errors', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Internal Server Error', { status: 500 })
      )

      const result = await executor.execute('esm create test-module')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('RPC error')
    })

    it('should handle network errors to esm.do', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(executor.execute('esm create test-module')).rejects.toThrow(
        'Tier 2 RPC execution failed'
      )
    })
  })

  describe('ESM Result Format', () => {
    it('should return BashResult for esm commands', async () => {
      const result = await executor.execute('esm run my-module')

      expect(result).toHaveProperty('input')
      expect(result).toHaveProperty('command')
      expect(result).toHaveProperty('stdout')
      expect(result).toHaveProperty('stderr')
      expect(result).toHaveProperty('exitCode')
      expect(result).toHaveProperty('valid')
      expect(result).toHaveProperty('generated')
      expect(result).toHaveProperty('intent')
      expect(result).toHaveProperty('classification')
    })

    it('should include tier information for esm commands', async () => {
      const result = await executor.execute('esm run my-module')

      expect(result.classification.reason).toContain('Tier 2')
    })
  })
})

// ============================================================================
// RPC Response Validation Tests
// ============================================================================

describe('RPC Response Validation', () => {
  describe('isRpcResponse type guard', () => {
    // Import the type guard - will fail until implemented
    let isRpcResponse: (value: unknown) => value is RpcResponsePayload

    beforeEach(async () => {
      const module = await import('../../../src/do/executors/rpc-executor.js')
      isRpcResponse = module.isRpcResponse
    })

    it('should return true for valid RpcResponsePayload', () => {
      const validResponse = {
        stdout: 'output',
        stderr: '',
        exitCode: 0,
      }
      expect(isRpcResponse(validResponse)).toBe(true)
    })

    it('should return true for response with non-zero exit code', () => {
      const errorResponse = {
        stdout: '',
        stderr: 'error message',
        exitCode: 1,
      }
      expect(isRpcResponse(errorResponse)).toBe(true)
    })

    it('should return false for null', () => {
      expect(isRpcResponse(null)).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isRpcResponse(undefined)).toBe(false)
    })

    it('should return false for non-object', () => {
      expect(isRpcResponse('string')).toBe(false)
      expect(isRpcResponse(42)).toBe(false)
      expect(isRpcResponse(true)).toBe(false)
    })

    it('should return false for missing stdout', () => {
      const missingStdout = {
        stderr: '',
        exitCode: 0,
      }
      expect(isRpcResponse(missingStdout)).toBe(false)
    })

    it('should return false for missing stderr', () => {
      const missingStderr = {
        stdout: 'output',
        exitCode: 0,
      }
      expect(isRpcResponse(missingStderr)).toBe(false)
    })

    it('should return false for missing exitCode', () => {
      const missingExitCode = {
        stdout: 'output',
        stderr: '',
      }
      expect(isRpcResponse(missingExitCode)).toBe(false)
    })

    it('should return false for wrong stdout type', () => {
      const wrongStdoutType = {
        stdout: 123,
        stderr: '',
        exitCode: 0,
      }
      expect(isRpcResponse(wrongStdoutType)).toBe(false)
    })

    it('should return false for wrong stderr type', () => {
      const wrongStderrType = {
        stdout: 'output',
        stderr: null,
        exitCode: 0,
      }
      expect(isRpcResponse(wrongStderrType)).toBe(false)
    })

    it('should return false for wrong exitCode type', () => {
      const wrongExitCodeType = {
        stdout: 'output',
        stderr: '',
        exitCode: '0',
      }
      expect(isRpcResponse(wrongExitCodeType)).toBe(false)
    })

    it('should return true for response with extra properties', () => {
      const extraProps = {
        stdout: 'output',
        stderr: '',
        exitCode: 0,
        duration: 100,
        extra: 'field',
      }
      expect(isRpcResponse(extraProps)).toBe(true)
    })
  })

  describe('parseRpcResponse function', () => {
    let parseRpcResponse: (value: unknown) => RpcResponsePayload

    beforeEach(async () => {
      const module = await import('../../../src/do/executors/rpc-executor.js')
      parseRpcResponse = module.parseRpcResponse
    })

    it('should return valid response as-is', () => {
      const validResponse = {
        stdout: 'output',
        stderr: '',
        exitCode: 0,
      }
      const result = parseRpcResponse(validResponse)
      expect(result).toEqual(validResponse)
    })

    it('should throw RpcResponseError for invalid response', () => {
      const invalidResponse = {
        stdout: 'output',
        // missing stderr and exitCode
      }
      expect(() => parseRpcResponse(invalidResponse)).toThrow()
    })

    it('should throw with descriptive error message for null', () => {
      expect(() => parseRpcResponse(null)).toThrow(/invalid.*response/i)
    })

    it('should throw with descriptive error message for missing fields', () => {
      const missingFields = { stdout: 'output' }
      expect(() => parseRpcResponse(missingFields)).toThrow()
    })

    it('should throw with descriptive error message for wrong types', () => {
      const wrongTypes = {
        stdout: 123,
        stderr: '',
        exitCode: 0,
      }
      expect(() => parseRpcResponse(wrongTypes)).toThrow()
    })
  })

  describe('RpcResponseError class', () => {
    let RpcResponseError: new (message: string, received: unknown) => Error & { received: unknown }

    beforeEach(async () => {
      const module = await import('../../../src/do/executors/rpc-executor.js')
      RpcResponseError = module.RpcResponseError
    })

    it('should be an instance of Error', () => {
      const error = new RpcResponseError('test message', null)
      expect(error).toBeInstanceOf(Error)
    })

    it('should have correct error name', () => {
      const error = new RpcResponseError('test message', null)
      expect(error.name).toBe('RpcResponseError')
    })

    it('should store received value', () => {
      const received = { invalid: 'data' }
      const error = new RpcResponseError('test message', received)
      expect(error.received).toBe(received)
    })

    it('should have descriptive message', () => {
      const error = new RpcResponseError('Invalid RPC response', null)
      expect(error.message).toBe('Invalid RPC response')
    })
  })

  describe('RpcExecutor response validation integration', () => {
    let executor: RpcExecutor
    let mockFetch: Mock

    beforeEach(() => {
      mockFetch = vi.fn()
      globalThis.fetch = mockFetch
      executor = new RpcExecutor()
    })

    it('should throw RpcResponseError for malformed JSON response', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            // Missing required fields
            data: 'something',
          }),
          { status: 200 }
        )
      )

      await expect(executor.execute('jq .name')).rejects.toThrow(/invalid.*rpc.*response/i)
    })

    it('should throw RpcResponseError for wrong field types', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stdout: 123, // Should be string
            stderr: '',
            exitCode: 0,
          }),
          { status: 200 }
        )
      )

      await expect(executor.execute('jq .name')).rejects.toThrow(/invalid.*rpc.*response/i)
    })

    it('should handle valid response correctly', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stdout: 'valid output',
            stderr: '',
            exitCode: 0,
          }),
          { status: 200 }
        )
      )

      const result = await executor.execute('jq .name')
      expect(result.stdout).toBe('valid output')
      expect(result.exitCode).toBe(0)
    })

    it('should include received value in error for debugging', async () => {
      const invalidData = { bad: 'data' }
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(invalidData), { status: 200 })
      )

      try {
        await executor.execute('jq .name')
        expect.fail('Should have thrown')
      } catch (error) {
        // The error should wrap an RpcResponseError that contains the received value
        expect(error).toBeInstanceOf(Error)
      }
    })
  })
})
