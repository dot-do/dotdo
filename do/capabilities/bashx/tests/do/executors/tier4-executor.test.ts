/**
 * Tier4Executor Integration Tests
 *
 * Tests for the Tier 4 (Sandbox) execution path in TieredExecutor.
 * Verifies that TieredExecutor correctly delegates to SandboxExecutor
 * for Tier 4 operations.
 *
 * This test file ensures:
 * - TieredExecutor delegates to SandboxExecutor for Tier 4 commands
 * - SandboxBinding integration is preserved
 * - Sandbox errors are handled gracefully
 * - Sandbox timeouts are handled
 * - Results include proper tier metadata
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { TieredExecutor, type TieredExecutorConfig, type SandboxBinding } from '../../../src/do/tiered-executor.js'
import { SandboxExecutor, createSandboxExecutor } from '../../../src/do/executors/sandbox-executor.js'
import type { TierExecutor } from '../../../src/do/executors/types.js'
import type { BashResult, ExecOptions, SpawnHandle } from '../../../src/types.js'

// ============================================================================
// Mock Factories
// ============================================================================

function createMockSandboxBinding(): SandboxBinding {
  return {
    execute: vi.fn(async (command: string, options?: ExecOptions): Promise<BashResult> => {
      return {
        input: command,
        command,
        stdout: `sandbox output: ${command}`,
        stderr: '',
        exitCode: 0,
        valid: true,
        generated: false,
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
          impact: 'none',
          reversible: true,
          reason: 'Sandbox execution',
        },
      }
    }),
    spawn: vi.fn(async (command: string, args?: string[]): Promise<SpawnHandle> => {
      return {
        pid: 12345,
        stdin: {
          write: vi.fn(async () => {}),
          close: vi.fn(async () => {}),
        },
        stdout: {
          on: vi.fn(),
        },
        stderr: {
          on: vi.fn(),
        },
        on: vi.fn(),
        kill: vi.fn(async () => {}),
        wait: vi.fn(async () => ({ exitCode: 0 })),
      }
    }),
  }
}

// ============================================================================
// TierExecutor Interface Compliance Tests
// ============================================================================

describe('SandboxExecutor implements TierExecutor', () => {
  let executor: SandboxExecutor

  beforeEach(() => {
    executor = createSandboxExecutor({ sandbox: createMockSandboxBinding() })
  })

  it('should implement TierExecutor interface', () => {
    // TierExecutor requires canExecute(command: string): boolean
    expect(typeof executor.canExecute).toBe('function')
    expect(executor.canExecute.length).toBe(1)

    // TierExecutor requires execute(command: string, options?: ExecOptions): Promise<BashResult>
    expect(typeof executor.execute).toBe('function')
  })

  it('should return boolean from canExecute', () => {
    const result = executor.canExecute('docker ps')
    expect(typeof result).toBe('boolean')
  })

  it('should return Promise<BashResult> from execute', async () => {
    const result = await executor.execute('docker ps')
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

  it('should be usable as TierExecutor type', () => {
    // This is a compile-time check - if it compiles, the interface is satisfied
    const tierExecutor: TierExecutor = executor
    expect(tierExecutor.canExecute('any')).toBe(true)
  })
})

// ============================================================================
// SandboxBinding Delegation Tests
// ============================================================================

describe('SandboxExecutor delegates to SandboxBinding', () => {
  let mockSandbox: SandboxBinding
  let executor: SandboxExecutor

  beforeEach(() => {
    mockSandbox = createMockSandboxBinding()
    executor = createSandboxExecutor({ sandbox: mockSandbox })
  })

  it('should delegate execute calls to sandbox binding', async () => {
    await executor.execute('docker ps')

    expect(mockSandbox.execute).toHaveBeenCalledWith(
      'docker ps',
      expect.any(Object)
    )
  })

  it('should pass options through to sandbox binding', async () => {
    const options: ExecOptions = {
      cwd: '/app',
      env: { DEBUG: 'true' },
      timeout: 5000,
    }

    await executor.execute('python script.py', options)

    expect(mockSandbox.execute).toHaveBeenCalledWith(
      'python script.py',
      expect.objectContaining({
        cwd: '/app',
        env: { DEBUG: 'true' },
        timeout: 5000,
      })
    )
  })

  it('should use default timeout when not specified', async () => {
    const customExecutor = createSandboxExecutor({
      sandbox: mockSandbox,
      defaultTimeout: 60000,
    })

    await customExecutor.execute('slow-command')

    expect(mockSandbox.execute).toHaveBeenCalledWith(
      'slow-command',
      expect.objectContaining({ timeout: 60000 })
    )
  })

  it('should override default timeout with options', async () => {
    const customExecutor = createSandboxExecutor({
      sandbox: mockSandbox,
      defaultTimeout: 60000,
    })

    await customExecutor.execute('fast-command', { timeout: 1000 })

    expect(mockSandbox.execute).toHaveBeenCalledWith(
      'fast-command',
      expect.objectContaining({ timeout: 1000 })
    )
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('SandboxExecutor error handling', () => {
  let mockSandbox: SandboxBinding
  let executor: SandboxExecutor

  beforeEach(() => {
    mockSandbox = createMockSandboxBinding()
    executor = createSandboxExecutor({ sandbox: mockSandbox })
  })

  it('should handle sandbox errors gracefully', async () => {
    ;(mockSandbox.execute as Mock).mockRejectedValueOnce(
      new Error('Sandbox connection failed')
    )

    await expect(executor.execute('command')).rejects.toThrow(
      'Sandbox connection failed'
    )
  })

  it('should handle non-Error sandbox failures', async () => {
    ;(mockSandbox.execute as Mock).mockRejectedValueOnce('string error')

    await expect(executor.execute('command')).rejects.toThrow(
      'string error'
    )
  })

  it('should return error result when no sandbox is configured', async () => {
    const noSandboxExecutor = createSandboxExecutor()

    const result = await noSandboxExecutor.execute('docker ps')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('No sandbox available')
  })
})

// ============================================================================
// Timeout Handling Tests
// ============================================================================

describe('SandboxExecutor timeout handling', () => {
  it('should handle sandbox timeouts', async () => {
    const mockSandbox = createMockSandboxBinding()
    ;(mockSandbox.execute as Mock).mockImplementation(
      () => new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Command timed out')), 50)
      )
    )

    const executor = createSandboxExecutor({
      sandbox: mockSandbox,
      defaultTimeout: 100,
    })

    await expect(executor.execute('slow command')).rejects.toThrow(
      'Command timed out'
    )
  })

  it('should pass timeout to sandbox binding', async () => {
    const mockSandbox = createMockSandboxBinding()
    const executor = createSandboxExecutor({
      sandbox: mockSandbox,
      defaultTimeout: 30000,
    })

    await executor.execute('command', { timeout: 5000 })

    expect(mockSandbox.execute).toHaveBeenCalledWith(
      'command',
      expect.objectContaining({ timeout: 5000 })
    )
  })
})

// ============================================================================
// Result Metadata Tests
// ============================================================================

describe('SandboxExecutor result metadata', () => {
  let mockSandbox: SandboxBinding
  let executor: SandboxExecutor

  beforeEach(() => {
    mockSandbox = createMockSandboxBinding()
    executor = createSandboxExecutor({ sandbox: mockSandbox })
  })

  it('should enhance result with tier metadata', async () => {
    const result = await executor.execute('docker ps')

    expect(result.classification.reason).toContain('Tier 4')
    expect(result.classification.reason).toContain('Sandbox')
  })

  it('should include command category in result', async () => {
    const result = await executor.execute('docker ps')

    expect(result.classification).toHaveProperty('category')
    expect(result.classification.category).toBe('container')
  })

  it('should preserve original result properties', async () => {
    ;(mockSandbox.execute as Mock).mockResolvedValueOnce({
      input: 'python script.py',
      command: 'python script.py',
      stdout: 'Hello World',
      stderr: '',
      exitCode: 0,
      valid: true,
      generated: false,
      intent: {
        commands: ['python'],
        reads: ['script.py'],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      },
      classification: {
        type: 'execute',
        impact: 'low',
        reversible: true,
        reason: 'Running python script',
      },
    })

    const result = await executor.execute('python script.py')

    expect(result.stdout).toBe('Hello World')
    expect(result.exitCode).toBe(0)
    expect(result.intent.commands).toContain('python')
  })
})

// ============================================================================
// TieredExecutor Integration Tests
// ============================================================================

describe('TieredExecutor Tier 4 integration', () => {
  let mockSandbox: SandboxBinding
  let executor: TieredExecutor

  beforeEach(() => {
    mockSandbox = createMockSandboxBinding()
    executor = new TieredExecutor({ sandbox: mockSandbox })
  })

  it('should classify sandbox-specific commands as Tier 4', () => {
    const classification = executor.classifyCommand('docker ps')

    expect(classification.tier).toBe(4)
    expect(classification.handler).toBe('sandbox')
  })

  it('should execute Tier 4 commands via sandbox', async () => {
    const result = await executor.execute('docker ps')

    expect(mockSandbox.execute).toHaveBeenCalled()
    expect(result.exitCode).toBe(0)
  })

  it('should fall back to Tier 4 for unknown commands', () => {
    const classification = executor.classifyCommand('unknown-command --arg')

    // Unknown commands should fall back to sandbox
    expect(classification.tier).toBe(4)
    expect(classification.handler).toBe('sandbox')
  })

  it('should fall back to sandbox when higher tier fails', async () => {
    // Configure with RPC that will fail
    const failingRpcExecutor = new TieredExecutor({
      sandbox: mockSandbox,
      rpcBindings: {
        custom: {
          name: 'custom',
          endpoint: 'https://custom.do',
          commands: ['customtool'],
        },
      },
    })

    // The RPC will fail, should fall back to sandbox
    const result = await failingRpcExecutor.execute('customtool --arg')

    // Either it goes to sandbox directly or falls back
    expect(mockSandbox.execute).toHaveBeenCalled()
  })

  it('should throw when sandbox not configured for Tier 4 command', async () => {
    const noSandboxExecutor = new TieredExecutor({})

    // Commands that specifically require sandbox should fail
    await expect(noSandboxExecutor.execute('docker ps')).rejects.toThrow(
      'Sandbox not configured'
    )
  })

  it('should include Tier 4 in capabilities when sandbox configured', () => {
    const capabilities = executor.getCapabilities()

    expect(capabilities.tier4.available).toBe(true)
  })

  it('should report Tier 4 unavailable when no sandbox', () => {
    const noSandboxExecutor = new TieredExecutor({})
    const capabilities = noSandboxExecutor.getCapabilities()

    expect(capabilities.tier4.available).toBe(false)
  })
})

// ============================================================================
// Spawn Tests
// ============================================================================

describe('SandboxExecutor spawn support', () => {
  let mockSandbox: SandboxBinding
  let executor: SandboxExecutor

  beforeEach(() => {
    mockSandbox = createMockSandboxBinding()
    executor = createSandboxExecutor({ sandbox: mockSandbox })
  })

  it('should report spawn capability when available', () => {
    expect(executor.canSpawn).toBe(true)
  })

  it('should delegate spawn to sandbox binding', async () => {
    await executor.spawn('python', ['-u', 'server.py'])

    expect(mockSandbox.spawn).toHaveBeenCalledWith(
      'python',
      ['-u', 'server.py'],
      expect.any(Object)
    )
  })

  it('should throw when spawn not available', async () => {
    const noSpawnSandbox: SandboxBinding = {
      execute: mockSandbox.execute,
      // No spawn method
    }
    const noSpawnExecutor = createSandboxExecutor({ sandbox: noSpawnSandbox })

    await expect(noSpawnExecutor.spawn('command', [])).rejects.toThrow(
      'No sandbox available for spawn'
    )
  })

  it('should report no spawn capability when unavailable', () => {
    const noSpawnSandbox: SandboxBinding = {
      execute: mockSandbox.execute,
    }
    const noSpawnExecutor = createSandboxExecutor({ sandbox: noSpawnSandbox })

    expect(noSpawnExecutor.canSpawn).toBe(false)
  })
})

// ============================================================================
// canExecute Tests
// ============================================================================

describe('SandboxExecutor canExecute behavior', () => {
  it('should accept any command when sandbox is configured', () => {
    const executor = createSandboxExecutor({ sandbox: createMockSandboxBinding() })

    expect(executor.canExecute('docker ps')).toBe(true)
    expect(executor.canExecute('unknown-command')).toBe(true)
    expect(executor.canExecute('any arbitrary input')).toBe(true)
  })

  it('should reject all commands when sandbox not configured', () => {
    const executor = createSandboxExecutor()

    expect(executor.canExecute('docker ps')).toBe(false)
    expect(executor.canExecute('any command')).toBe(false)
  })

  it('should identify sandbox-specific commands', () => {
    const executor = createSandboxExecutor({ sandbox: createMockSandboxBinding() })

    // These commands require sandbox
    expect(executor.requiresSandbox('docker')).toBe(true)
    expect(executor.requiresSandbox('kubectl')).toBe(true)
    expect(executor.requiresSandbox('python')).toBe(true)
    expect(executor.requiresSandbox('gcc')).toBe(true)

    // These don't specifically require sandbox (but sandbox can handle them)
    expect(executor.requiresSandbox('echo')).toBe(false)
    expect(executor.requiresSandbox('cat')).toBe(false)
  })
})
