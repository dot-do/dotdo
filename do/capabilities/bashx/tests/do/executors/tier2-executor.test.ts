/**
 * Tier2Executor Integration Tests (RED Phase)
 *
 * Tests verifying that TieredExecutor properly delegates Tier 2 execution
 * to the RpcExecutor module. This ensures the Tier 2 logic is properly
 * extracted and the delegation works correctly.
 *
 * Key test areas:
 * - Tier2Executor implements TierExecutor interface
 * - Routes to correct RPC endpoint based on command
 * - Uses parseRpcResponse() for validation (no `as any` casts)
 * - Handles RPC errors and timeouts
 * - Handles retry logic if applicable
 *
 * @module tests/do/executors/tier2-executor
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

import {
  RpcExecutor,
  createRpcExecutor,
  parseRpcResponse,
  isRpcResponse,
  RpcResponseError,
  DEFAULT_RPC_SERVICES,
  type RpcExecutorConfig,
  type RpcServiceBinding,
} from '../../../src/do/executors/rpc-executor.js'

import {
  Tier2Executor,
  createTier2Executor,
  type Tier2ExecutorConfig,
} from '../../../src/do/executors/tier2-executor.js'

import {
  TieredExecutor,
  type TierClassification,
  type RpcServiceBinding as TieredRpcServiceBinding,
} from '../../../src/do/tiered-executor.js'

import type { TierExecutor } from '../../../src/do/executors/types.js'
import type { BashResult, ExecOptions } from '../../../src/types.js'

// ============================================================================
// MOCK HELPERS
// ============================================================================

/**
 * Create a mock fetch function for RPC testing
 */
function createMockFetch(response?: Partial<{ stdout: string; stderr: string; exitCode: number }>): Mock {
  return vi.fn(async (url: string, init?: RequestInit) => {
    return new Response(
      JSON.stringify({
        stdout: response?.stdout ?? 'mock output',
        stderr: response?.stderr ?? '',
        exitCode: response?.exitCode ?? 0,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  })
}

/**
 * Create a mock service binding with fetch method
 */
function createMockServiceBinding(
  name: string = 'mock-service',
  response?: Partial<{ stdout: string; stderr: string; exitCode: number }>
): { fetch: Mock } {
  return {
    fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          stdout: response?.stdout ?? 'binding output',
          stderr: response?.stderr ?? '',
          exitCode: response?.exitCode ?? 0,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }),
  }
}

/**
 * Create a mock sandbox for fallback testing
 */
function createMockSandbox() {
  return {
    execute: vi.fn(async (command: string): Promise<BashResult> => ({
      input: command,
      command,
      valid: true,
      generated: false,
      stdout: `sandbox: ${command}\n`,
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
        type: 'execute',
        impact: 'medium',
        reversible: false,
        reason: 'Executed via sandbox',
      },
    })),
  }
}

// ============================================================================
// Tier2Executor TierExecutor INTERFACE COMPLIANCE TESTS
// ============================================================================

describe('Tier2Executor TierExecutor Interface', () => {
  describe('Interface Implementation', () => {
    it('implements TierExecutor interface correctly', () => {
      const executor = new Tier2Executor()

      // Must have canExecute method
      expect(typeof executor.canExecute).toBe('function')

      // Must have execute method
      expect(typeof executor.execute).toBe('function')
    })

    it('canExecute returns boolean for any command string', () => {
      const executor = new Tier2Executor()

      // RPC commands should return true
      expect(typeof executor.canExecute('jq')).toBe('boolean')
      expect(typeof executor.canExecute('npm install')).toBe('boolean')
      expect(typeof executor.canExecute('git status')).toBe('boolean')

      // Non-RPC commands should return false
      expect(typeof executor.canExecute('docker ps')).toBe('boolean')
      expect(typeof executor.canExecute('echo hello')).toBe('boolean')
    })

    it('execute returns Promise<BashResult>', async () => {
      const mockFetch = createMockFetch()
      globalThis.fetch = mockFetch

      const executor = new Tier2Executor()
      const result = await executor.execute('jq .name', { stdin: '{"name":"test"}' })

      // Verify BashResult structure
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

    it('can be used as TierExecutor type', () => {
      // This should compile without errors
      const executor: TierExecutor = new Tier2Executor()

      expect(executor.canExecute('jq')).toBe(true)
    })
  })
})

// ============================================================================
// Tier2Executor COMMAND CLASSIFICATION TESTS
// ============================================================================

describe('Tier2Executor Command Classification', () => {
  let executor: Tier2Executor

  beforeEach(() => {
    executor = new Tier2Executor()
  })

  describe('RPC command detection', () => {
    it('identifies jq as RPC command', () => {
      expect(executor.canExecute('jq')).toBe(true)
      expect(executor.canExecute('jq .name')).toBe(true)
      expect(executor.canExecute('jq ".name | keys"')).toBe(true)
    })

    it('identifies npm commands as RPC commands', () => {
      expect(executor.canExecute('npm')).toBe(true)
      expect(executor.canExecute('npm install')).toBe(true)
      expect(executor.canExecute('npx prettier --write .')).toBe(true)
      expect(executor.canExecute('yarn add lodash')).toBe(true)
      expect(executor.canExecute('pnpm install')).toBe(true)
      expect(executor.canExecute('bun install')).toBe(true)
    })

    it('identifies git commands as RPC commands', () => {
      expect(executor.canExecute('git')).toBe(true)
      expect(executor.canExecute('git status')).toBe(true)
      expect(executor.canExecute('git commit -m "test"')).toBe(true)
    })

    it('identifies python commands as RPC commands', () => {
      expect(executor.canExecute('python')).toBe(true)
      expect(executor.canExecute('python3 script.py')).toBe(true)
      expect(executor.canExecute('pip install requests')).toBe(true)
      expect(executor.canExecute('pip3 install numpy')).toBe(true)
      expect(executor.canExecute('pipx run black')).toBe(true)
      expect(executor.canExecute('uvx ruff check')).toBe(true)
      expect(executor.canExecute('pyx run black')).toBe(true)
    })
  })

  describe('Non-RPC command rejection', () => {
    it('rejects Tier 1 commands', () => {
      expect(executor.canExecute('echo hello')).toBe(false)
      expect(executor.canExecute('cat file.txt')).toBe(false)
      expect(executor.canExecute('ls -la')).toBe(false)
    })

    it('rejects Tier 4 commands', () => {
      expect(executor.canExecute('docker ps')).toBe(false)
      expect(executor.canExecute('kubectl get pods')).toBe(false)
      expect(executor.canExecute('gcc main.c')).toBe(false)
    })

    it('rejects unknown commands', () => {
      expect(executor.canExecute('unknown-tool')).toBe(false)
      expect(executor.canExecute('my-custom-script')).toBe(false)
    })
  })

  describe('Service identification', () => {
    it('identifies correct service for command', () => {
      expect(executor.getServiceForCommand('jq')).toBe('jq')
      expect(executor.getServiceForCommand('npm install')).toBe('npm')
      expect(executor.getServiceForCommand('npx')).toBe('npm')
      expect(executor.getServiceForCommand('yarn')).toBe('npm')
      expect(executor.getServiceForCommand('git status')).toBe('git')
      expect(executor.getServiceForCommand('python')).toBe('pyx')
      expect(executor.getServiceForCommand('pip')).toBe('pyx')
    })

    it('returns null for unknown commands', () => {
      expect(executor.getServiceForCommand('docker')).toBeNull()
      expect(executor.getServiceForCommand('unknown')).toBeNull()
    })
  })
})

// ============================================================================
// Tier2Executor DELEGATION TO RpcExecutor TESTS
// ============================================================================

describe('Tier2Executor Delegation to RpcExecutor', () => {
  describe('Internal RpcExecutor usage', () => {
    it('delegates canExecute to RpcExecutor', () => {
      const executor = new Tier2Executor()

      // Should match RpcExecutor behavior
      const rpcExecutor = new RpcExecutor()
      expect(executor.canExecute('jq')).toBe(rpcExecutor.canExecute('jq'))
      expect(executor.canExecute('npm')).toBe(rpcExecutor.canExecute('npm'))
      expect(executor.canExecute('docker')).toBe(rpcExecutor.canExecute('docker'))
    })

    it('delegates execute to RpcExecutor', async () => {
      const mockFetch = createMockFetch({ stdout: 'delegated output', exitCode: 0 })
      globalThis.fetch = mockFetch

      const executor = new Tier2Executor()
      const result = await executor.execute('jq .name')

      expect(result.stdout).toBe('delegated output')
      expect(result.exitCode).toBe(0)
    })

    it('passes options through to RpcExecutor', async () => {
      const mockFetch = createMockFetch()
      globalThis.fetch = mockFetch

      const executor = new Tier2Executor()
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
  })

  describe('Custom bindings', () => {
    it('accepts custom RPC bindings', () => {
      const executor = new Tier2Executor({
        bindings: {
          custom: {
            name: 'custom',
            endpoint: 'https://custom.do',
            commands: ['custom-cmd'],
          },
        },
      })

      expect(executor.canExecute('custom-cmd')).toBe(true)
      expect(executor.getServiceForCommand('custom-cmd')).toBe('custom')
    })

    it('supports service binding objects', async () => {
      const mockBinding = createMockServiceBinding('test', { stdout: 'binding result' })

      const executor = new Tier2Executor({
        bindings: {
          test: {
            name: 'test',
            endpoint: mockBinding,
            commands: ['test-cmd'],
          },
        },
      })

      const result = await executor.execute('test-cmd arg1')

      expect(mockBinding.fetch).toHaveBeenCalled()
      expect(result.stdout).toBe('binding result')
    })
  })
})

// ============================================================================
// Tier2Executor RPC RESPONSE VALIDATION TESTS
// ============================================================================

describe('Tier2Executor uses parseRpcResponse() for validation', () => {
  let executor: Tier2Executor
  let mockFetch: Mock

  beforeEach(() => {
    mockFetch = vi.fn()
    globalThis.fetch = mockFetch
    executor = new Tier2Executor()
  })

  it('validates response using parseRpcResponse()', async () => {
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

  it('throws RpcResponseError for invalid response', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          // Missing required fields
          data: 'invalid',
        }),
        { status: 200 }
      )
    )

    await expect(executor.execute('jq .name')).rejects.toThrow(/invalid.*rpc.*response/i)
  })

  it('throws RpcResponseError for wrong field types', async () => {
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

  it('handles extra fields in response (structural typing)', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          stdout: 'output',
          stderr: '',
          exitCode: 0,
          duration: 100,
          extra: 'field',
        }),
        { status: 200 }
      )
    )

    const result = await executor.execute('jq .name')

    expect(result.stdout).toBe('output')
    expect(result.exitCode).toBe(0)
  })
})

// ============================================================================
// Tier2Executor ERROR HANDLING TESTS
// ============================================================================

describe('Tier2Executor Error Handling', () => {
  let executor: Tier2Executor
  let mockFetch: Mock

  beforeEach(() => {
    mockFetch = vi.fn()
    globalThis.fetch = mockFetch
    executor = new Tier2Executor()
  })

  describe('HTTP errors', () => {
    it('handles HTTP 500 error', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Internal Server Error', { status: 500 })
      )

      const result = await executor.execute('jq .name')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('RPC error')
    })

    it('handles HTTP 404 error', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Not Found', { status: 404 })
      )

      const result = await executor.execute('jq .name')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('RPC error')
    })

    it('handles network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(executor.execute('jq .name')).rejects.toThrow('Tier 2 RPC execution failed')
    })
  })

  describe('Command errors', () => {
    it('throws for commands without RPC binding', async () => {
      await expect(executor.execute('unknown-cmd')).rejects.toThrow(
        'No RPC service available for command'
      )
    })

    it('throws for empty command', async () => {
      await expect(executor.execute('')).rejects.toThrow()
    })
  })
})

// ============================================================================
// Tier2Executor TIMEOUT HANDLING TESTS
// ============================================================================

describe('Tier2Executor Timeout Handling', () => {
  let mockFetch: Mock

  beforeEach(() => {
    mockFetch = createMockFetch()
    globalThis.fetch = mockFetch
  })

  it('uses default timeout when not specified', async () => {
    const executor = new Tier2Executor({ defaultTimeout: 30000 })

    await executor.execute('jq .name')

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body)

    expect(body.timeout).toBe(30000)
  })

  it('uses custom timeout from options', async () => {
    const executor = new Tier2Executor({ defaultTimeout: 30000 })

    await executor.execute('jq .name', { timeout: 5000 })

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body)

    expect(body.timeout).toBe(5000)
  })

  it('uses executor default timeout', async () => {
    const executor = new Tier2Executor({ defaultTimeout: 60000 })

    await executor.execute('jq .name')

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body)

    expect(body.timeout).toBe(60000)
  })
})

// ============================================================================
// TieredExecutor INTEGRATION TESTS
// ============================================================================

describe('TieredExecutor Tier 2 Integration', () => {
  describe('Classification', () => {
    it('classifies RPC commands as Tier 2', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      // git is tier 2 RPC (jq has a native implementation, so it's tier 1)
      const classification = executor.classifyCommand('git status')

      expect(classification.tier).toBe(2)
      expect(classification.handler).toBe('rpc')
    })

    it('includes capability (service name) in classification', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      // Note: jq is now tier 1 native, so we skip checking it for tier 2 capability
      const gitClassification = executor.classifyCommand('git status')
      expect(gitClassification.capability).toBe('git')
    })

    it('includes executor in classification for Tier 2', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      // git is tier 2 RPC
      const classification = executor.classifyCommand('git status')

      expect(classification.executor).toBeDefined()
      expect(typeof classification.executor?.execute).toBe('function')
    })
  })

  describe('Execution delegation', () => {
    it('delegates Tier 2 execution to RpcExecutor', async () => {
      const mockFetch = createMockFetch({ stdout: 'rpc output' })
      globalThis.fetch = mockFetch

      const sandbox = createMockSandbox()
      const executor = new TieredExecutor({
        sandbox,
      })

      // git is tier 2 RPC
      const result = await executor.execute('git status')

      // Should go through RPC, not sandbox
      expect(mockFetch).toHaveBeenCalled()
      expect(sandbox.execute).not.toHaveBeenCalled()
      expect(result.stdout).toBe('rpc output')
    })

    it('routes to correct RPC endpoint based on command', async () => {
      const mockFetch = createMockFetch()
      globalThis.fetch = mockFetch

      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      // git is tier 2 RPC
      await executor.execute('git status')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('git.do'),
        expect.any(Object)
      )

      // Note: npm install may be native for some operations, skip this assertion
      // python goes through LanguageRouter, not directly to RPC, so skip that too
    })
  })

  describe('Capability reporting', () => {
    it('reports Tier 2 availability correctly', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      const capabilities = executor.getCapabilities()

      expect(capabilities.tier2.available).toBe(true)
      expect(capabilities.tier2.services).toContain('jq')
      expect(capabilities.tier2.services).toContain('npm')
      expect(capabilities.tier2.services).toContain('git')
    })

    it('checks tier availability for specific commands', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      expect(executor.isTierAvailable(2, 'jq .name')).toBe(true)
      expect(executor.isTierAvailable(2, 'npm install')).toBe(true)
      expect(executor.isTierAvailable(2, 'docker ps')).toBe(false)
    })
  })
})

// ============================================================================
// RESULT FORMAT TESTS
// ============================================================================

describe('Tier2Executor Result Format', () => {
  let executor: Tier2Executor
  let mockFetch: Mock

  beforeEach(() => {
    mockFetch = createMockFetch()
    globalThis.fetch = mockFetch
    executor = new Tier2Executor()
  })

  it('returns properly formatted BashResult', async () => {
    const result = await executor.execute('jq .name')

    // Verify full BashResult structure
    expect(result.input).toBe('jq .name')
    expect(result.command).toBe('jq .name')
    expect(result.valid).toBe(true)
    expect(result.generated).toBe(false)
    expect(typeof result.stdout).toBe('string')
    expect(typeof result.stderr).toBe('string')
    expect(typeof result.exitCode).toBe('number')

    // Verify intent structure
    expect(result.intent).toHaveProperty('commands')
    expect(result.intent).toHaveProperty('reads')
    expect(result.intent).toHaveProperty('writes')
    expect(result.intent).toHaveProperty('deletes')
    expect(result.intent).toHaveProperty('network')
    expect(result.intent).toHaveProperty('elevated')

    // Verify classification structure
    expect(result.classification).toHaveProperty('type')
    expect(result.classification).toHaveProperty('impact')
    expect(result.classification).toHaveProperty('reversible')
    expect(result.classification).toHaveProperty('reason')
  })

  it('includes Tier 2 in classification reason', async () => {
    const result = await executor.execute('jq .name')

    expect(result.classification.reason).toContain('Tier 2')
  })

  it('marks intent.network as true for RPC commands', async () => {
    const result = await executor.execute('jq .name')

    expect(result.intent.network).toBe(true)
  })
})

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createTier2Executor Factory Function', () => {
  it('creates Tier2Executor with no config', () => {
    const executor = createTier2Executor()

    expect(executor).toBeInstanceOf(Tier2Executor)
    expect(executor.canExecute('jq')).toBe(true)
  })

  it('creates Tier2Executor with custom bindings', () => {
    const executor = createTier2Executor({
      bindings: {
        custom: {
          name: 'custom',
          endpoint: 'https://custom.do',
          commands: ['custom-cmd'],
        },
      },
    })

    expect(executor.canExecute('custom-cmd')).toBe(true)
  })

  it('creates Tier2Executor with custom timeout', async () => {
    const mockFetch = createMockFetch()
    globalThis.fetch = mockFetch

    const executor = createTier2Executor({ defaultTimeout: 45000 })

    await executor.execute('jq .name')

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body)

    expect(body.timeout).toBe(45000)
  })
})

// ============================================================================
// TYPE EXPORTS TESTS
// ============================================================================

describe('Tier2Executor Type Exports', () => {
  it('exports Tier2Executor class', async () => {
    const { Tier2Executor } = await import('../../../src/do/executors/tier2-executor.js')
    expect(Tier2Executor).toBeDefined()
  })

  it('exports createTier2Executor factory', async () => {
    const { createTier2Executor } = await import('../../../src/do/executors/tier2-executor.js')
    expect(createTier2Executor).toBeDefined()
    expect(typeof createTier2Executor).toBe('function')
  })

  it('exports Tier2ExecutorConfig type', async () => {
    // TypeScript compile-time check - if this compiles, the type is exported
    const config: Tier2ExecutorConfig = {
      defaultTimeout: 30000,
    }
    expect(config).toBeDefined()
  })
})
