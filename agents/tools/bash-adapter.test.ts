/**
 * Bash Tool Adapter Tests (RED Phase)
 *
 * Tests for the Bash tool adapter that maps Claude SDK Bash tool to bashx.do.
 * These are failing tests following TDD principles - the implementation
 * does not exist yet.
 *
 * @see dotdo-sla1o - [RED] Bash tool adapter tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BashCapability, BashResult } from '../../lib/mixins/bash'
import type { FsCapability } from '../../lib/mixins/fs'
import type { ToolDefinition, ToolContext } from '../types'

// ============================================================================
// Types for Bash Tool Adapter
// ============================================================================

interface BashToolInput {
  command: string
  timeout?: number
  cwd?: string
  confirm?: boolean
  description?: string
  run_in_background?: boolean
}

interface BashToolOutput {
  stdout: string
  stderr: string
  exit_code: number
  blocked?: boolean
  block_reason?: string
  tier?: 1 | 2 | 3 | 4
  duration_ms: number
}

// ============================================================================
// Mock Capabilities
// ============================================================================

function createMockBash(): BashCapability {
  return {
    exec: vi.fn(),
    run: vi.fn(),
    spawn: vi.fn(),
    parse: vi.fn(),
    analyze: vi.fn(),
    isDangerous: vi.fn(),
  } as unknown as BashCapability
}

function createMockFs(): FsCapability {
  return {
    read: vi.fn(),
    write: vi.fn(),
    exists: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    mkdir: vi.fn(),
    stat: vi.fn(),
  } as unknown as FsCapability
}

function createToolContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    agentId: 'test-agent',
    sessionId: 'test-session',
    ...overrides,
  }
}

// ============================================================================
// Import placeholder - will fail until implementation exists
// ============================================================================

// Placeholder until we implement the adapter
const createBashToolAdapter = (
  _bash: BashCapability,
  _fs?: FsCapability
): ToolDefinition<BashToolInput, BashToolOutput> => {
  throw new Error('Not implemented - RED phase')
}

// ============================================================================
// Bash Tool Adapter Tests
// ============================================================================

describe('Bash Tool Adapter', () => {
  let mockBash: BashCapability
  let mockFs: FsCapability
  let bashTool: ToolDefinition<BashToolInput, BashToolOutput>

  beforeEach(() => {
    mockBash = createMockBash()
    mockFs = createMockFs()
  })

  describe('Tool Definition', () => {
    it('creates a tool with name "Bash"', () => {
      bashTool = createBashToolAdapter(mockBash, mockFs)
      expect(bashTool.name).toBe('Bash')
    })

    it('has appropriate description for Claude SDK', () => {
      bashTool = createBashToolAdapter(mockBash, mockFs)
      expect(bashTool.description).toContain('command')
      expect(bashTool.description.toLowerCase()).toContain('bash')
    })

    it('has inputSchema with command as required', () => {
      bashTool = createBashToolAdapter(mockBash, mockFs)
      expect(bashTool.inputSchema).toBeDefined()
    })

    it('has inputSchema with optional timeout, cwd, confirm, description', () => {
      bashTool = createBashToolAdapter(mockBash, mockFs)
      expect(bashTool.inputSchema).toBeDefined()
    })
  })

  // ==========================================================================
  // Safety Analysis Tests
  // ==========================================================================

  describe('Safety Analysis', () => {
    it('executes safe commands immediately', async () => {
      const mockResult: BashResult = {
        stdout: 'file1.ts\nfile2.ts',
        stderr: '',
        exitCode: 0,
      }
      ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult)
      ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
        dangerous: false,
        classification: 'safe',
      })

      bashTool = createBashToolAdapter(mockBash, mockFs)
      const result = await bashTool.execute(
        { command: 'ls -la' },
        createToolContext()
      )

      expect(mockBash.exec).toHaveBeenCalled()
      expect(result.exit_code).toBe(0)
      expect(result.blocked).toBeFalsy()
    })

    it('blocks dangerous commands like rm -rf /', async () => {
      ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
        dangerous: true,
        reason: 'Recursive delete of root directory',
        classification: 'destructive',
      })

      bashTool = createBashToolAdapter(mockBash, mockFs)
      const result = await bashTool.execute(
        { command: 'rm -rf /' },
        createToolContext()
      )

      expect(result.blocked).toBe(true)
      expect(result.block_reason).toContain('Recursive delete')
      expect(mockBash.exec).not.toHaveBeenCalled()
    })

    it('allows dangerous commands with confirm: true', async () => {
      const mockResult: BashResult = {
        stdout: '',
        stderr: '',
        exitCode: 0,
      }
      ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult)
      ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
        dangerous: true,
        reason: 'Destructive operation',
        classification: 'destructive',
      })

      bashTool = createBashToolAdapter(mockBash, mockFs)
      const result = await bashTool.execute(
        { command: 'rm -rf temp/', confirm: true },
        createToolContext()
      )

      expect(mockBash.exec).toHaveBeenCalled()
      expect(result.blocked).toBeFalsy()
    })

    it('uses AST parsing for proper command structure analysis', async () => {
      ;(mockBash.parse as ReturnType<typeof vi.fn>).mockReturnValue({
        type: 'pipeline',
        commands: [{ name: 'cat', args: ['file.txt'] }],
      })
      ;(mockBash.analyze as ReturnType<typeof vi.fn>).mockReturnValue({
        dangerous: false,
        classification: 'safe',
        tier: 'native',
      })
      ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: 'content',
        stderr: '',
        exitCode: 0,
      })

      bashTool = createBashToolAdapter(mockBash, mockFs)
      await bashTool.execute({ command: 'cat file.txt' }, createToolContext())

      expect(mockBash.parse).toHaveBeenCalledWith('cat file.txt')
      expect(mockBash.analyze).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Tiered Execution Tests
  // ==========================================================================

  describe('Tiered Execution', () => {
    describe('Tier 1 - Native Operations (fsx.do)', () => {
      it('executes cat using fsx.do read (<1ms)', async () => {
        const fileContent = 'file contents here'
        ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(fileContent)
        ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
          dangerous: false,
        })

        bashTool = createBashToolAdapter(mockBash, mockFs)
        const result = await bashTool.execute(
          { command: 'cat config.json' },
          createToolContext()
        )

        expect(mockFs.read).toHaveBeenCalledWith('config.json', expect.any(Object))
        expect(result.stdout).toBe(fileContent)
        expect(result.tier).toBe(1)
      })

      it('executes ls using fsx.do list', async () => {
        const files = [{ name: 'file1.ts', isDirectory: false }, { name: 'dir', isDirectory: true }]
        ;(mockFs.list as ReturnType<typeof vi.fn>).mockResolvedValue(files)
        ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
          dangerous: false,
        })

        bashTool = createBashToolAdapter(mockBash, mockFs)
        const result = await bashTool.execute(
          { command: 'ls src/' },
          createToolContext()
        )

        expect(mockFs.list).toHaveBeenCalledWith('src/', expect.any(Object))
        expect(result.tier).toBe(1)
      })

      it('executes head using fsx.do read with limit', async () => {
        const fileContent = 'line1\nline2\nline3\nline4\nline5'
        ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(fileContent)
        ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
          dangerous: false,
        })

        bashTool = createBashToolAdapter(mockBash, mockFs)
        const result = await bashTool.execute(
          { command: 'head -n 3 file.txt' },
          createToolContext()
        )

        expect(result.stdout).toContain('line1')
        expect(result.tier).toBe(1)
      })

      it('executes tail using fsx.do read', async () => {
        const fileContent = 'line1\nline2\nline3\nline4\nline5'
        ;(mockFs.read as ReturnType<typeof vi.fn>).mockResolvedValue(fileContent)
        ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
          dangerous: false,
        })

        bashTool = createBashToolAdapter(mockBash, mockFs)
        const result = await bashTool.execute(
          { command: 'tail -n 2 file.txt' },
          createToolContext()
        )

        expect(result.tier).toBe(1)
      })
    })

    describe('Tier 2 - RPC Services (<5ms)', () => {
      it('routes git commands to gitx.do service', async () => {
        const mockResult: BashResult = {
          stdout: 'On branch main\nnothing to commit',
          stderr: '',
          exitCode: 0,
        }
        ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult)
        ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
          dangerous: false,
        })

        bashTool = createBashToolAdapter(mockBash, mockFs)
        const result = await bashTool.execute(
          { command: 'git status' },
          createToolContext()
        )

        expect(result.tier).toBe(2)
      })

      it('routes jq commands to jq.do service', async () => {
        const mockResult: BashResult = {
          stdout: '"extracted-value"',
          stderr: '',
          exitCode: 0,
        }
        ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult)
        ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
          dangerous: false,
        })

        bashTool = createBashToolAdapter(mockBash, mockFs)
        const result = await bashTool.execute(
          { command: 'jq ".name" package.json' },
          createToolContext()
        )

        expect(result.tier).toBe(2)
      })
    })

    describe('Tier 3 - Worker Loaders (<10ms)', () => {
      it('runs npm packages via esm.sh loader', async () => {
        const mockResult: BashResult = {
          stdout: 'processed',
          stderr: '',
          exitCode: 0,
        }
        ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult)
        ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
          dangerous: false,
        })

        bashTool = createBashToolAdapter(mockBash, mockFs)
        const result = await bashTool.execute(
          { command: 'npx prettier --check src/' },
          createToolContext()
        )

        expect(result.tier).toBe(3)
      })
    })

    describe('Tier 4 - Sandbox Execution (2-3s cold start)', () => {
      it('routes python commands to sandbox', async () => {
        const mockResult: BashResult = {
          stdout: 'Hello from Python',
          stderr: '',
          exitCode: 0,
        }
        ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult)
        ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
          dangerous: false,
        })

        bashTool = createBashToolAdapter(mockBash, mockFs)
        const result = await bashTool.execute(
          { command: 'python script.py' },
          createToolContext()
        )

        expect(result.tier).toBe(4)
      })

      it('routes binary tools to sandbox', async () => {
        const mockResult: BashResult = {
          stdout: '',
          stderr: '',
          exitCode: 0,
        }
        ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult)
        ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
          dangerous: false,
        })

        bashTool = createBashToolAdapter(mockBash, mockFs)
        const result = await bashTool.execute(
          { command: 'ffmpeg -i input.mp4 output.mp4' },
          createToolContext()
        )

        expect(result.tier).toBe(4)
      })
    })
  })

  // ==========================================================================
  // Output Handling Tests
  // ==========================================================================

  describe('Output Handling', () => {
    it('separates stdout and stderr streams', async () => {
      const mockResult: BashResult = {
        stdout: 'standard output',
        stderr: 'error output',
        exitCode: 0,
      }
      ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult)
      ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
        dangerous: false,
      })

      bashTool = createBashToolAdapter(mockBash, mockFs)
      const result = await bashTool.execute(
        { command: 'some-command' },
        createToolContext()
      )

      expect(result.stdout).toBe('standard output')
      expect(result.stderr).toBe('error output')
    })

    it('propagates exit code correctly', async () => {
      const mockResult: BashResult = {
        stdout: '',
        stderr: 'Error: command failed',
        exitCode: 1,
      }
      ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult)
      ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
        dangerous: false,
      })

      bashTool = createBashToolAdapter(mockBash, mockFs)
      const result = await bashTool.execute(
        { command: 'failing-command' },
        createToolContext()
      )

      expect(result.exit_code).toBe(1)
    })

    it('includes duration_ms in output', async () => {
      const mockResult: BashResult = {
        stdout: 'done',
        stderr: '',
        exitCode: 0,
      }
      ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult)
      ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
        dangerous: false,
      })

      bashTool = createBashToolAdapter(mockBash, mockFs)
      const result = await bashTool.execute(
        { command: 'echo done' },
        createToolContext()
      )

      expect(typeof result.duration_ms).toBe('number')
      expect(result.duration_ms).toBeGreaterThanOrEqual(0)
    })
  })

  // ==========================================================================
  // Timeout Tests
  // ==========================================================================

  describe('Timeout Handling', () => {
    it('respects timeout option', async () => {
      ;(mockBash.exec as ReturnType<typeof vi.fn>).mockImplementation(
        async (cmd, args, opts) => {
          if (opts?.timeout && opts.timeout < 1000) {
            const error = new Error('Command timed out')
            ;(error as any).timedOut = true
            throw error
          }
          return { stdout: '', stderr: '', exitCode: 0 }
        }
      )
      ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
        dangerous: false,
      })

      bashTool = createBashToolAdapter(mockBash, mockFs)

      await expect(
        bashTool.execute(
          { command: 'sleep 10', timeout: 100 },
          createToolContext()
        )
      ).rejects.toThrow(/timeout/i)
    })

    it('default timeout is 2 minutes (120000ms)', async () => {
      ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      })
      ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
        dangerous: false,
      })

      bashTool = createBashToolAdapter(mockBash, mockFs)
      await bashTool.execute({ command: 'echo test' }, createToolContext())

      expect(mockBash.exec).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ timeout: 120000 })
      )
    })

    it('maximum timeout is 10 minutes (600000ms)', async () => {
      ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      })
      ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
        dangerous: false,
      })

      bashTool = createBashToolAdapter(mockBash, mockFs)
      await bashTool.execute(
        { command: 'echo test', timeout: 1000000 },
        createToolContext()
      )

      // Should cap at 600000ms
      expect(mockBash.exec).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ timeout: 600000 })
      )
    })
  })

  // ==========================================================================
  // Working Directory Tests
  // ==========================================================================

  describe('Working Directory (cwd)', () => {
    it('uses cwd option for command execution', async () => {
      ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: 'package.json',
        stderr: '',
        exitCode: 0,
      })
      ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
        dangerous: false,
      })

      bashTool = createBashToolAdapter(mockBash, mockFs)
      await bashTool.execute(
        { command: 'ls', cwd: '/app/packages/core' },
        createToolContext()
      )

      expect(mockBash.exec).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ cwd: '/app/packages/core' })
      )
    })

    it('validates cwd is within workspace', async () => {
      bashTool = createBashToolAdapter(mockBash, mockFs)

      await expect(
        bashTool.execute(
          { command: 'ls', cwd: '/etc' },
          createToolContext()
        )
      ).rejects.toThrow(/invalid path|outside workspace|security/i)
    })
  })

  // ==========================================================================
  // Shell Feature Tests
  // ==========================================================================

  describe('Shell Features', () => {
    describe('Pipes', () => {
      it('supports command | command piping', async () => {
        ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
          stdout: 'filtered output',
          stderr: '',
          exitCode: 0,
        })
        ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
          dangerous: false,
        })

        bashTool = createBashToolAdapter(mockBash, mockFs)
        const result = await bashTool.execute(
          { command: 'cat data.json | jq ".users[]" | head -5' },
          createToolContext()
        )

        expect(result.exit_code).toBe(0)
      })
    })

    describe('Redirects', () => {
      it('supports > redirect operator', async () => {
        ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
          stdout: '',
          stderr: '',
          exitCode: 0,
        })
        ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
          dangerous: false,
        })

        bashTool = createBashToolAdapter(mockBash, mockFs)
        await bashTool.execute(
          { command: 'echo "test" > output.txt' },
          createToolContext()
        )

        expect(mockBash.exec).toHaveBeenCalled()
      })

      it('supports >> append redirect', async () => {
        ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
          stdout: '',
          stderr: '',
          exitCode: 0,
        })
        ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
          dangerous: false,
        })

        bashTool = createBashToolAdapter(mockBash, mockFs)
        await bashTool.execute(
          { command: 'echo "more" >> output.txt' },
          createToolContext()
        )

        expect(mockBash.exec).toHaveBeenCalled()
      })

      it('supports < input redirect', async () => {
        ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
          stdout: 'processed',
          stderr: '',
          exitCode: 0,
        })
        ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
          dangerous: false,
        })

        bashTool = createBashToolAdapter(mockBash, mockFs)
        await bashTool.execute(
          { command: 'sort < unsorted.txt' },
          createToolContext()
        )

        expect(mockBash.exec).toHaveBeenCalled()
      })
    })

    describe('Variables', () => {
      it('supports $VAR expansion', async () => {
        ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
          stdout: '/home/user',
          stderr: '',
          exitCode: 0,
        })
        ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
          dangerous: false,
        })

        bashTool = createBashToolAdapter(mockBash, mockFs)
        await bashTool.execute(
          { command: 'echo $HOME' },
          createToolContext()
        )

        expect(mockBash.exec).toHaveBeenCalled()
      })
    })

    describe('Subshells', () => {
      it('supports $(command) execution', async () => {
        ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
          stdout: 'v20.10.0',
          stderr: '',
          exitCode: 0,
        })
        ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
          dangerous: false,
        })

        bashTool = createBashToolAdapter(mockBash, mockFs)
        const result = await bashTool.execute(
          { command: 'echo "Node $(node --version)"' },
          createToolContext()
        )

        expect(result.exit_code).toBe(0)
      })
    })

    describe('Command Chaining', () => {
      it('supports && for sequential execution on success', async () => {
        ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
          stdout: 'success',
          stderr: '',
          exitCode: 0,
        })
        ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
          dangerous: false,
        })

        bashTool = createBashToolAdapter(mockBash, mockFs)
        await bashTool.execute(
          { command: 'npm install && npm run build' },
          createToolContext()
        )

        expect(mockBash.exec).toHaveBeenCalled()
      })

      it('supports || for sequential execution on failure', async () => {
        ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
          stdout: 'fallback',
          stderr: '',
          exitCode: 0,
        })
        ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
          dangerous: false,
        })

        bashTool = createBashToolAdapter(mockBash, mockFs)
        await bashTool.execute(
          { command: 'command1 || echo "fallback"' },
          createToolContext()
        )

        expect(mockBash.exec).toHaveBeenCalled()
      })

      it('supports ; for unconditional sequential execution', async () => {
        ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
          stdout: 'output',
          stderr: '',
          exitCode: 0,
        })
        ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
          dangerous: false,
        })

        bashTool = createBashToolAdapter(mockBash, mockFs)
        await bashTool.execute(
          { command: 'cmd1 ; cmd2 ; cmd3' },
          createToolContext()
        )

        expect(mockBash.exec).toHaveBeenCalled()
      })
    })
  })

  // ==========================================================================
  // Background Execution Tests
  // ==========================================================================

  describe('Background Execution', () => {
    it('supports run_in_background option', async () => {
      ;(mockBash.spawn as ReturnType<typeof vi.fn>).mockResolvedValue({
        pid: 12345,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        wait: vi.fn().mockResolvedValue(0),
      })
      ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
        dangerous: false,
      })

      bashTool = createBashToolAdapter(mockBash, mockFs)
      const result = await bashTool.execute(
        { command: 'npm run dev', run_in_background: true },
        createToolContext()
      )

      expect(mockBash.spawn).toHaveBeenCalled()
      expect(result.exit_code).toBe(0)
    })
  })

  // ==========================================================================
  // Command Description Tests
  // ==========================================================================

  describe('Command Description', () => {
    it('accepts optional description for logging', async () => {
      ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      })
      ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
        dangerous: false,
      })

      bashTool = createBashToolAdapter(mockBash, mockFs)
      await bashTool.execute(
        {
          command: 'npm test',
          description: 'Run unit tests',
        },
        createToolContext()
      )

      // Description should be logged/tracked for auditing
      expect(mockBash.exec).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Special Commands Tests
  // ==========================================================================

  describe('Special Command Handling', () => {
    it('blocks cd command (state not persisted)', async () => {
      bashTool = createBashToolAdapter(mockBash, mockFs)

      // cd doesn't make sense in stateless execution
      // Should suggest using cwd option instead
      await expect(
        bashTool.execute({ command: 'cd /tmp && ls' }, createToolContext())
      ).rejects.toThrow(/cd.*cwd|use cwd option/i)
    })

    it('blocks interactive commands (vim, nano, etc)', async () => {
      bashTool = createBashToolAdapter(mockBash, mockFs)

      await expect(
        bashTool.execute({ command: 'vim file.txt' }, createToolContext())
      ).rejects.toThrow(/interactive|not supported/i)
    })

    it('blocks commands that require TTY', async () => {
      bashTool = createBashToolAdapter(mockBash, mockFs)

      await expect(
        bashTool.execute({ command: 'sudo apt-get install' }, createToolContext())
      ).rejects.toThrow(/interactive|sudo|not supported/i)
    })
  })

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('Error Handling', () => {
    it('returns stderr content on command failure', async () => {
      ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: '',
        stderr: 'npm ERR! code ENOENT',
        exitCode: 1,
      })
      ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
        dangerous: false,
      })

      bashTool = createBashToolAdapter(mockBash, mockFs)
      const result = await bashTool.execute(
        { command: 'npm run nonexistent' },
        createToolContext()
      )

      expect(result.exit_code).toBe(1)
      expect(result.stderr).toContain('ENOENT')
    })

    it('handles command not found errors', async () => {
      ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: '',
        stderr: 'command not found: nonexistent',
        exitCode: 127,
      })
      ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
        dangerous: false,
      })

      bashTool = createBashToolAdapter(mockBash, mockFs)
      const result = await bashTool.execute(
        { command: 'nonexistent-command' },
        createToolContext()
      )

      expect(result.exit_code).toBe(127)
    })
  })

  // ==========================================================================
  // Output Truncation Tests
  // ==========================================================================

  describe('Output Truncation', () => {
    it('truncates output exceeding 30000 characters', async () => {
      const longOutput = 'x'.repeat(50000)
      ;(mockBash.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: longOutput,
        stderr: '',
        exitCode: 0,
      })
      ;(mockBash.isDangerous as ReturnType<typeof vi.fn>).mockReturnValue({
        dangerous: false,
      })

      bashTool = createBashToolAdapter(mockBash, mockFs)
      const result = await bashTool.execute(
        { command: 'cat large-file.txt' },
        createToolContext()
      )

      expect(result.stdout.length).toBeLessThanOrEqual(30000 + 100) // Allow for truncation message
    })
  })
})
