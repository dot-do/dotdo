/**
 * RED Phase Tests for npx Execution via Tier 2 RPC
 *
 * These tests verify npx command execution through the TieredExecutor's
 * RPC-based Tier 2 system. npx commands are routed to npm.do for execution.
 *
 * Test categories:
 * 1. Basic npx package execution
 * 2. npx with arguments and options
 * 3. npx package versioning (@version syntax)
 * 4. npx error handling and edge cases
 * 5. npx environment and cwd handling
 * 6. npx with stdin/stdout piping
 *
 * @module bashx/tests/do/npx-execution
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  TieredExecutor,
  type TieredExecutorConfig,
  type RpcServiceBinding,
} from '../../src/do/tiered-executor.js'

// ============================================================================
// MOCK HELPERS
// ============================================================================

/**
 * Create a mock npm.do RPC endpoint that simulates various npx responses
 */
function createMockNpmRpc(responses: Record<string, { stdout: string; stderr: string; exitCode: number }>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string || '{}')
    const command = body.command as string

    // Find matching response based on command prefix
    for (const [pattern, response] of Object.entries(responses)) {
      if (command.startsWith(pattern) || command.includes(pattern)) {
        return {
          ok: true,
          json: async () => response,
        }
      }
    }

    // Default: command not found
    return {
      ok: true,
      json: async () => ({
        stdout: '',
        stderr: `npx: command not found: ${command.split(' ')[1] || 'unknown'}`,
        exitCode: 127,
      }),
    }
  })
}

function createExecutorWithMockNpm(
  mockFetch: ReturnType<typeof vi.fn>,
  additionalConfig?: Partial<TieredExecutorConfig>
) {
  vi.stubGlobal('fetch', mockFetch)

  return new TieredExecutor({
    rpcBindings: {
      npm: {
        name: 'npm',
        endpoint: 'https://npm.do',
        commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
      },
    },
    ...additionalConfig,
  })
}

// ============================================================================
// BASIC NPX PACKAGE EXECUTION
// ============================================================================

describe('npx Execution - Basic Package Execution', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('executes npx with a simple package name', async () => {
    const mockFetch = createMockNpmRpc({
      'npx cowsay': {
        stdout: ' _____\n< moo >\n -----\n        \\   ^__^\n         \\  (oo)\\_______\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx cowsay moo')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://npm.do/execute',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('moo')
  })

  it('executes npx vitest for testing', async () => {
    const mockFetch = createMockNpmRpc({
      'npx vitest': {
        stdout: '✓ All 42 tests passed\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx vitest run')

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('tests passed')
  })

  it('executes npx prettier for code formatting', async () => {
    const mockFetch = createMockNpmRpc({
      'npx prettier': {
        stdout: 'const x = 1;\nconst y = 2;\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx prettier --write src/index.ts')

    expect(result.exitCode).toBe(0)
  })

  it('executes npx eslint for linting', async () => {
    const mockFetch = createMockNpmRpc({
      'npx eslint': {
        stdout: '',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx eslint src/')

    expect(result.exitCode).toBe(0)
  })

  it('executes npx tsc for TypeScript compilation', async () => {
    const mockFetch = createMockNpmRpc({
      'npx tsc': {
        stdout: '',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx tsc --noEmit')

    expect(result.exitCode).toBe(0)
  })

  it('executes npx create-react-app for project scaffolding', async () => {
    const mockFetch = createMockNpmRpc({
      'npx create-react-app': {
        stdout: 'Created my-app successfully!\nTo start: cd my-app && npm start\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx create-react-app my-app')

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Created')
  })
})

// ============================================================================
// NPX WITH ARGUMENTS AND OPTIONS
// ============================================================================

describe('npx Execution - Arguments and Options', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes --yes/-y flag to skip prompts', async () => {
    const mockFetch = createMockNpmRpc({
      'npx -y': {
        stdout: 'Package installed and executed\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx -y some-package')

    expect(result.exitCode).toBe(0)
    // Verify the -y flag was passed in the request
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('-y'),
      })
    )
  })

  it('passes --no flag to deny prompts', async () => {
    const mockFetch = createMockNpmRpc({
      'npx --no': {
        stdout: '',
        stderr: 'Need to install package. Denied by --no flag.\n',
        exitCode: 1,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx --no unknown-package')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Denied')
  })

  it('passes -c/--call flag for command execution', async () => {
    const mockFetch = createMockNpmRpc({
      'npx -c': {
        stdout: 'Command output\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx -c "echo hello"')

    expect(result.exitCode).toBe(0)
  })

  it('passes -p/--package flag for specific package', async () => {
    const mockFetch = createMockNpmRpc({
      'npx -p': {
        stdout: 'Using specified package\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx -p typescript tsc --version')

    expect(result.exitCode).toBe(0)
  })

  it('handles multiple -p flags for multiple packages', async () => {
    const mockFetch = createMockNpmRpc({
      'npx -p typescript -p eslint': {
        stdout: 'Both packages loaded\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx -p typescript -p eslint tsc --version')

    expect(result.exitCode).toBe(0)
  })

  it('passes --ignore-existing to skip local packages', async () => {
    const mockFetch = createMockNpmRpc({
      'npx --ignore-existing': {
        stdout: 'Fetched fresh from registry\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx --ignore-existing prettier --version')

    expect(result.exitCode).toBe(0)
  })

  it('handles -- separator for package args', async () => {
    const mockFetch = createMockNpmRpc({
      'npx vitest': {
        stdout: 'Running specific tests\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx vitest run -- --reporter=verbose')

    expect(result.exitCode).toBe(0)
  })
})

// ============================================================================
// NPX PACKAGE VERSIONING
// ============================================================================

describe('npx Execution - Package Versioning', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('executes package@version syntax', async () => {
    const mockFetch = createMockNpmRpc({
      'npx typescript@5.0.0': {
        stdout: 'TypeScript 5.0.0\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx typescript@5.0.0 --version')

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('5.0.0')
  })

  it('executes package@latest syntax', async () => {
    const mockFetch = createMockNpmRpc({
      'npx typescript@latest': {
        stdout: 'TypeScript 5.3.2\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx typescript@latest --version')

    expect(result.exitCode).toBe(0)
  })

  it('executes package@next syntax for prerelease', async () => {
    const mockFetch = createMockNpmRpc({
      'npx react@next': {
        stdout: 'React 19.0.0-beta.1\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx react@next --version')

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('beta')
  })

  it('executes scoped package @scope/package', async () => {
    const mockFetch = createMockNpmRpc({
      'npx @angular/cli': {
        stdout: 'Angular CLI: 17.0.0\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx @angular/cli --version')

    expect(result.exitCode).toBe(0)
  })

  it('executes scoped package with version @scope/package@version', async () => {
    const mockFetch = createMockNpmRpc({
      'npx @vue/cli@5.0.0': {
        stdout: '@vue/cli 5.0.0\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx @vue/cli@5.0.0 --version')

    expect(result.exitCode).toBe(0)
  })

  it('handles semver range syntax', async () => {
    const mockFetch = createMockNpmRpc({
      'npx typescript@^5': {
        stdout: 'TypeScript 5.3.2\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx typescript@^5 --version')

    expect(result.exitCode).toBe(0)
  })
})

// ============================================================================
// NPX ERROR HANDLING
// ============================================================================

describe('npx Execution - Error Handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('handles package not found error', async () => {
    const mockFetch = createMockNpmRpc({
      'npx nonexistent-package-xyz': {
        stdout: '',
        stderr: 'npm ERR! 404 Not Found - GET https://registry.npmjs.org/nonexistent-package-xyz - Not found\n',
        exitCode: 1,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx nonexistent-package-xyz')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('404')
    expect(result.stderr).toContain('Not found')
  })

  it('handles network timeout error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stdout: '',
        stderr: 'npm ERR! network timeout at: https://registry.npmjs.org/some-package\n',
        exitCode: 1,
      }),
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx some-package')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('timeout')
  })

  it('handles permission denied error', async () => {
    const mockFetch = createMockNpmRpc({
      'npx': {
        stdout: '',
        stderr: 'npm ERR! EACCES: permission denied\n',
        exitCode: 1,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx some-protected-package')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('EACCES')
  })

  it('handles RPC service unavailable', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => 'Service temporarily unavailable',
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx some-package')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('RPC error')
  })

  it('handles package execution failure', async () => {
    const mockFetch = createMockNpmRpc({
      'npx failing-script': {
        stdout: '',
        stderr: 'Error: Script threw an exception\n    at Object.<anonymous> (/tmp/script.js:1:1)\n',
        exitCode: 1,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx failing-script')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Error')
  })

  it('handles invalid package name', async () => {
    const mockFetch = createMockNpmRpc({
      'npx': {
        stdout: '',
        stderr: 'npm ERR! Invalid package name "..bad-name": name cannot start with a period\n',
        exitCode: 1,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx ..bad-name')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Invalid package name')
  })

  it('falls back to sandbox when RPC fails', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
    const mockSandbox = {
      execute: vi.fn(async (command: string) => ({
        input: command,
        command,
        valid: true,
        generated: false,
        stdout: 'Executed in sandbox\n',
        stderr: '',
        exitCode: 0,
        intent: {
          commands: ['npx'],
          reads: [],
          writes: [],
          deletes: [],
          network: true,
          elevated: false,
        },
        classification: {
          type: 'execute' as const,
          impact: 'medium' as const,
          reversible: false,
          reason: 'Fallback to sandbox',
        },
      })),
    }

    vi.stubGlobal('fetch', mockFetch)
    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
      sandbox: mockSandbox,
    })

    const result = await executor.execute('npx some-package')

    expect(mockFetch).toHaveBeenCalled()
    expect(mockSandbox.execute).toHaveBeenCalled()
    expect(result.stdout).toContain('sandbox')
  })
})

// ============================================================================
// NPX ENVIRONMENT AND CWD HANDLING
// ============================================================================

describe('npx Execution - Environment and CWD', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes cwd option to RPC', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stdout: '/project/src\n',
        stderr: '',
        exitCode: 0,
      }),
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    await executor.execute('npx pwd', { cwd: '/project/src' })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('/project/src'),
      })
    )
  })

  it('passes env variables to RPC', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stdout: 'production\n',
        stderr: '',
        exitCode: 0,
      }),
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    await executor.execute('npx print-env NODE_ENV', { env: { NODE_ENV: 'production' } })

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.env).toEqual({ NODE_ENV: 'production' })
  })

  it('passes timeout option to RPC', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stdout: 'done\n',
        stderr: '',
        exitCode: 0,
      }),
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    await executor.execute('npx long-running-task', { timeout: 60000 })

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.timeout).toBe(60000)
  })

  it('uses default timeout when not specified', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stdout: 'done\n',
        stderr: '',
        exitCode: 0,
      }),
    })

    vi.stubGlobal('fetch', mockFetch)
    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
      defaultTimeout: 45000,
    })

    await executor.execute('npx some-task')

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.timeout).toBe(45000)
  })
})

// ============================================================================
// NPX WITH STDIN/STDOUT PIPING
// ============================================================================

describe('npx Execution - Stdin/Stdout Piping', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('pipes stdin to npx command', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stdout: '{"formatted": true}\n',
        stderr: '',
        exitCode: 0,
      }),
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx prettier --parser json', {
      stdin: '{"formatted":false}',
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('formatted')
  })

  it('handles large stdout output', async () => {
    const largeOutput = 'x'.repeat(100000) + '\n'
    const mockFetch = createMockNpmRpc({
      'npx generate-large': {
        stdout: largeOutput,
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx generate-large-output')

    expect(result.exitCode).toBe(0)
    expect(result.stdout.length).toBeGreaterThan(100000)
  })

  it('handles stderr output separately', async () => {
    const mockFetch = createMockNpmRpc({
      'npx warn': {
        stdout: 'Result data\n',
        stderr: 'Warning: deprecated feature used\n',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx warn-example')

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Result')
    expect(result.stderr).toContain('Warning')
  })

  it('works in pipeline with other commands', async () => {
    const mockFetch = createMockNpmRpc({
      'npx json-formatter': {
        stdout: '{\n  "name": "test"\n}\n',
        stderr: '',
        exitCode: 0,
      },
    })

    vi.stubGlobal('fetch', mockFetch)
    const executor = new TieredExecutor({
      fs: {
        read: async () => '{"name":"test"}',
        exists: async () => true,
        list: async () => [],
        stat: async () => ({
          size: 100,
          isDirectory: () => false,
          isFile: () => true,
        }),
      } as any,
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    // Note: Pipeline execution would need to be tested separately
    // This tests that npx can receive stdin
    const result = await executor.execute('npx json-formatter', {
      stdin: '{"name":"test"}',
    })

    expect(result.exitCode).toBe(0)
  })
})

// ============================================================================
// NPX BINARY RESOLUTION
// ============================================================================

describe('npx Execution - Binary Resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves bin field from package.json', async () => {
    const mockFetch = createMockNpmRpc({
      'npx cowsay': {
        stdout: 'Moo!\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    // cowsay package has bin: { cowsay: './cli.js' }
    const result = await executor.execute('npx cowsay')

    expect(result.exitCode).toBe(0)
  })

  it('handles packages with multiple binaries', async () => {
    const mockFetch = createMockNpmRpc({
      'npx esbuild': {
        stdout: '0.19.0\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    // esbuild has both 'esbuild' and 'esbuild-wasm' binaries
    const result = await executor.execute('npx esbuild --version')

    expect(result.exitCode).toBe(0)
  })

  it('uses specific binary with --package flag', async () => {
    const mockFetch = createMockNpmRpc({
      'npx -p @babel/core': {
        stdout: '7.23.0\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx -p @babel/core babel --version')

    expect(result.exitCode).toBe(0)
  })
})

// ============================================================================
// NPX CACHING BEHAVIOR
// ============================================================================

describe('npx Execution - Caching Behavior', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('executes from cache on second run', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          stdout: 'First run - downloaded\n',
          stderr: '',
          exitCode: 0,
          cached: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          stdout: 'Second run - from cache\n',
          stderr: '',
          exitCode: 0,
          cached: true,
        }),
      })

    const executor = createExecutorWithMockNpm(mockFetch)

    const result1 = await executor.execute('npx some-package')
    const result2 = await executor.execute('npx some-package')

    expect(result1.exitCode).toBe(0)
    expect(result2.exitCode).toBe(0)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('bypasses cache with --ignore-existing', async () => {
    const mockFetch = createMockNpmRpc({
      'npx --ignore-existing': {
        stdout: 'Fresh download\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx --ignore-existing some-package')

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Fresh')
  })
})

// ============================================================================
// NPX COMPATIBILITY WITH OTHER PACKAGE MANAGERS
// ============================================================================

describe('npx Execution - Package Manager Compatibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('pnpm is classified as Tier 2 (npm service)', () => {
    const executor = new TieredExecutor({})

    // pnpm itself is in the npm commands list
    const classification = executor.classifyCommand('pnpm dlx vitest')

    expect(classification.tier).toBe(2)
    expect(classification.capability).toBe('npm')
  })

  it('yarn is classified as Tier 2 (npm service)', () => {
    const executor = new TieredExecutor({})

    // yarn itself is in the npm commands list
    const classification = executor.classifyCommand('yarn dlx vitest')

    expect(classification.tier).toBe(2)
    expect(classification.capability).toBe('npm')
  })

  // RED: bunx should be added to npm commands list
  it.skip('bunx is classified as Tier 2 (npm service)', () => {
    const executor = new TieredExecutor({})

    // bunx is bun's npx equivalent, should be in npm commands
    const classification = executor.classifyCommand('bunx vitest')

    // Currently fails because 'bunx' is not in the commands list (only 'bun' is)
    expect(classification.tier).toBe(2)
    expect(classification.capability).toBe('npm')
  })

  it('executes pnpm dlx through RPC', async () => {
    const mockFetch = createMockNpmRpc({
      'pnpm dlx vitest': {
        stdout: 'vitest v1.0.0\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('pnpm dlx vitest --version')

    expect(result.exitCode).toBe(0)
  })

  it('executes bun x through RPC', async () => {
    const mockFetch = createMockNpmRpc({
      'bun x vitest': {
        stdout: 'vitest v1.0.0\n',
        stderr: '',
        exitCode: 0,
      },
    })

    vi.stubGlobal('fetch', mockFetch)
    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('bun x vitest --version')

    expect(result.exitCode).toBe(0)
  })
})

// ============================================================================
// NPX RESULT STRUCTURE
// ============================================================================

describe('npx Execution - Result Structure', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns complete BashResult structure', async () => {
    const mockFetch = createMockNpmRpc({
      'npx vitest': {
        stdout: 'Tests passed\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx vitest run')

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

  it('includes correct command in result', async () => {
    const mockFetch = createMockNpmRpc({
      'npx cowsay': {
        stdout: 'Moo\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx cowsay hello')

    expect(result.command).toBe('npx cowsay hello')
    expect(result.input).toBe('npx cowsay hello')
  })

  it('marks result as valid for successful execution', async () => {
    const mockFetch = createMockNpmRpc({
      'npx vitest': {
        stdout: 'OK\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx vitest')

    expect(result.valid).toBe(true)
    expect(result.exitCode).toBe(0)
  })

  it('marks result as valid even for failed execution', async () => {
    const mockFetch = createMockNpmRpc({
      'npx failing': {
        stdout: '',
        stderr: 'Error occurred\n',
        exitCode: 1,
      },
    })
    const executor = createExecutorWithMockNpm(mockFetch)

    const result = await executor.execute('npx failing-script')

    // valid means the command was syntactically correct, not that it succeeded
    expect(result.valid).toBe(true)
    expect(result.exitCode).toBe(1)
  })
})

// ============================================================================
// RED TESTS: FEATURES NOT YET IMPLEMENTED
// These tests document expected behavior for future implementation
// ============================================================================

describe('npx Execution - Streaming Output (RED)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // RED: Streaming output support via spawn
  it.skip('supports streaming stdout for long-running commands', async () => {
    // This would require spawn() support for npx commands
    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx'],
        },
      },
    })

    const handle = await executor.spawn('npx', ['vitest', '--watch'])

    const chunks: string[] = []
    handle.stdout.on('data', (chunk) => chunks.push(chunk))

    // Wait for some output
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(chunks.length).toBeGreaterThan(0)
    await handle.kill()
  })

  // RED: Progress reporting for package downloads
  it.skip('reports download progress for package installation', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stdout: 'Done\n',
        stderr: '',
        exitCode: 0,
        progress: [
          { phase: 'download', package: 'react', percent: 100 },
          { phase: 'extract', package: 'react', percent: 100 },
        ],
      }),
    })

    vi.stubGlobal('fetch', mockFetch)
    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx'],
        },
      },
    })

    const result = await executor.execute('npx create-react-app my-app')

    // Progress information should be available in the result
    expect((result as any).progress).toBeDefined()
  })
})

describe('npx Execution - Native Tier 1 Mode (RED)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // RED: Some npx commands could run in Tier 1 with worker_loaders
  it.skip('executes simple packages natively via worker_loaders (Tier 3)', async () => {
    // For packages like prettier, eslint that can run in Workers
    const executor = new TieredExecutor({
      workerLoaders: {
        prettier: {
          name: 'prettier',
          load: async () => ({ format: (code: string) => code.trim() }),
          modules: ['prettier'],
        },
      },
    })

    const classification = executor.classifyCommand('npx prettier --check src/')

    // When worker_loaders are available, prefer Tier 3 over Tier 2 RPC
    expect(classification.tier).toBe(3)
    expect(classification.capability).toBe('prettier')
  })

  // RED: Detect packages that can run natively
  it.skip('detects which npx packages can run in Tier 1/3', () => {
    const executor = new TieredExecutor({})

    const prettierClassification = executor.classifyCommand('npx prettier --version')
    const dockerClassification = executor.classifyCommand('npx @devcontainers/cli up')

    // prettier can run in Workers, docker-based tools cannot
    expect(prettierClassification.handler).not.toBe('sandbox')
    expect(dockerClassification.handler).toBe('sandbox')
  })
})

describe('npx Execution - Package Isolation (RED)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // RED: Each npx invocation should be isolated
  it.skip('isolates package execution between invocations', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          stdout: 'First package\n',
          stderr: '',
          exitCode: 0,
          isolationId: 'iso-123',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          stdout: 'Second package\n',
          stderr: '',
          exitCode: 0,
          isolationId: 'iso-456',
        }),
      })

    vi.stubGlobal('fetch', mockFetch)
    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx'],
        },
      },
    })

    const result1 = await executor.execute('npx package-a')
    const result2 = await executor.execute('npx package-b')

    // Each execution should have a different isolation context
    expect((result1 as any).isolationId).not.toBe((result2 as any).isolationId)
  })

  // RED: Package execution should not affect filesystem
  it.skip('does not pollute the workspace with node_modules', async () => {
    const mockFetch = createMockNpmRpc({
      'npx cowsay': {
        stdout: 'Moo\n',
        stderr: '',
        exitCode: 0,
      },
    })
    const mockFs = {
      exists: vi.fn().mockResolvedValue(false),
      read: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      stat: vi.fn(),
    }

    vi.stubGlobal('fetch', mockFetch)
    const executor = new TieredExecutor({
      fs: mockFs as any,
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx'],
        },
      },
    })

    await executor.execute('npx cowsay moo')

    // Verify no node_modules was created
    expect(mockFs.exists).not.toHaveBeenCalledWith(expect.stringContaining('node_modules'))
  })
})

describe('npx Execution - Security Constraints (RED)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // RED: Block dangerous packages
  it.skip('blocks known malicious packages', async () => {
    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx'],
        },
      },
    })

    const result = await executor.execute('npx known-malicious-package')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('blocked')
  })

  // RED: Prevent postinstall script execution for untrusted packages
  it.skip('warns about packages with postinstall scripts', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stdout: 'Installed\n',
        stderr: '',
        exitCode: 0,
        warnings: ['Package has postinstall script: "npm run build"'],
      }),
    })

    vi.stubGlobal('fetch', mockFetch)
    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx'],
        },
      },
    })

    const result = await executor.execute('npx package-with-postinstall')

    // Should include warnings about scripts
    expect((result as any).warnings).toBeDefined()
    expect((result as any).warnings).toContain(expect.stringContaining('postinstall'))
  })

  // RED: Sandbox network access control
  it.skip('restricts network access for executed packages', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stdout: '',
        stderr: 'Error: Network access denied\n',
        exitCode: 1,
        networkBlocked: true,
      }),
    })

    vi.stubGlobal('fetch', mockFetch)
    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx'],
        },
      },
    })

    // Try to run a package that makes network requests
    const result = await executor.execute('npx network-heavy-package')

    expect((result as any).networkBlocked).toBe(true)
  })
})

describe('npx Execution - Workspace Integration (RED)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // RED: Access workspace files during execution
  it.skip('provides workspace file access to packages', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stdout: '{"name": "my-project"}\n',
        stderr: '',
        exitCode: 0,
      }),
    })
    const mockFs = {
      read: vi.fn().mockResolvedValue('{"name": "my-project"}'),
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue([]),
      stat: vi.fn(),
    }

    vi.stubGlobal('fetch', mockFetch)
    const executor = new TieredExecutor({
      fs: mockFs as any,
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx'],
        },
      },
    })

    // npx should be able to read package.json
    const result = await executor.execute('npx read-package-json', {
      cwd: '/workspace',
    })

    // The RPC should include workspace file information
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.cwd).toBe('/workspace')
  })

  // RED: Write output files back to workspace
  it.skip('writes generated files back to workspace', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stdout: 'Generated 3 files\n',
        stderr: '',
        exitCode: 0,
        generatedFiles: [
          { path: '/workspace/dist/index.js', content: 'console.log("built")' },
          { path: '/workspace/dist/index.d.ts', content: 'export {}' },
        ],
      }),
    })
    const mockFs = {
      read: vi.fn(),
      exists: vi.fn(),
      list: vi.fn(),
      stat: vi.fn(),
      write: vi.fn(),
    }

    vi.stubGlobal('fetch', mockFetch)
    const executor = new TieredExecutor({
      fs: mockFs as any,
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx'],
        },
      },
    })

    await executor.execute('npx tsc', { cwd: '/workspace' })

    // Generated files should be written to the workspace
    expect(mockFs.write).toHaveBeenCalledWith(
      '/workspace/dist/index.js',
      expect.any(String)
    )
  })
})
