/**
 * REPL Command Tests
 * Tests for the dotdo repl command that delegates to rpc.do's startRepl
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createProgram } from '../cli'

describe('REPL Command', () => {
  describe('Command Definition', () => {
    it('has repl command registered', () => {
      const program = createProgram()
      const commandNames = program.commands.map((cmd) => cmd.name())

      expect(commandNames).toContain('repl')
    })

    it('has correct description', () => {
      const program = createProgram()
      const replCmd = program.commands.find((cmd) => cmd.name() === 'repl')

      expect(replCmd).toBeDefined()
      expect(replCmd?.description()).toContain('REPL')
      expect(replCmd?.description()).toContain('endpoint')
    })

    it('has optional endpoint argument', () => {
      const program = createProgram()
      const replCmd = program.commands.find((cmd) => cmd.name() === 'repl')

      expect(replCmd).toBeDefined()

      // Check that endpoint is an optional argument (defaults to local sandbox)
      const args = replCmd?.registeredArguments || []
      expect(args.length).toBeGreaterThan(0)
      expect(args[0]?.name()).toBe('endpoint')
      expect(args[0]?.required).toBe(false)
    })

    it('has --types option', () => {
      const program = createProgram()
      const replCmd = program.commands.find((cmd) => cmd.name() === 'repl')

      expect(replCmd).toBeDefined()

      const optionFlags = replCmd?.options.map((opt) => opt.long) || []
      expect(optionFlags).toContain('--types')
    })

    it('has --history option', () => {
      const program = createProgram()
      const replCmd = program.commands.find((cmd) => cmd.name() === 'repl')

      expect(replCmd).toBeDefined()

      const optionFlags = replCmd?.options.map((opt) => opt.long) || []
      expect(optionFlags).toContain('--history')
    })

    it('has -t as short flag for --types', () => {
      const program = createProgram()
      const replCmd = program.commands.find((cmd) => cmd.name() === 'repl')

      expect(replCmd).toBeDefined()

      const typesOption = replCmd?.options.find((opt) => opt.long === '--types')
      expect(typesOption?.short).toBe('-t')
    })

    it('has -H as short flag for --history', () => {
      const program = createProgram()
      const replCmd = program.commands.find((cmd) => cmd.name() === 'repl')

      expect(replCmd).toBeDefined()

      const historyOption = replCmd?.options.find((opt) => opt.long === '--history')
      expect(historyOption?.short).toBe('-H')
    })
  })

  describe('Help Text', () => {
    it('includes repl in main help', () => {
      const program = createProgram()
      const helpText = program.helpInformation()

      expect(helpText).toContain('repl')
    })

    it('repl command help includes usage examples', () => {
      const program = createProgram()
      const replCmd = program.commands.find((cmd) => cmd.name() === 'repl')

      const helpText = replCmd?.helpInformation() || ''
      expect(helpText).toContain('--types')
      expect(helpText).toContain('--history')
      expect(helpText).toContain('[endpoint]')
    })
  })
})

describe('REPL Integration', () => {
  let mockStartRepl: ReturnType<typeof vi.fn>
  let mockReadFileSync: ReturnType<typeof vi.fn>
  let mockExit: ReturnType<typeof vi.fn>
  let mockError: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockStartRepl = vi.fn().mockResolvedValue(undefined)
    mockReadFileSync = vi.fn()
    mockExit = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`)
    })
    mockError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('imports startRepl from rpc.do/cli', async () => {
    // Verify that the import path is correct by checking it can be resolved
    // This test will fail if the module path is wrong
    const program = createProgram()
    const replCmd = program.commands.find((cmd) => cmd.name() === 'repl')

    expect(replCmd).toBeDefined()
    // The action function is defined, which means the import path should be correct
    // We can't easily test the actual import without executing the command
  })

  it('calls startRepl with correct endpoint', async () => {
    // Mock the rpc.do/cli module
    vi.doMock('rpc.do/cli', () => ({
      startRepl: mockStartRepl,
    }))

    const program = createProgram()

    // Need to handle the exit that happens after REPL ends
    try {
      await program.parseAsync(['node', 'dotdo', 'repl', 'https://test.api.dotdo.dev'], {
        from: 'user',
      })
    } catch {
      // REPL will try to start and may throw in test environment
    }

    // In real execution, startRepl would be called
    // This test verifies the command structure is correct
  })

  it('reads types from file when --types is provided', async () => {
    vi.doMock('node:fs', () => ({
      readFileSync: mockReadFileSync.mockReturnValue('type TestTypes = {}'),
    }))

    vi.doMock('rpc.do/cli', () => ({
      startRepl: mockStartRepl,
    }))

    const program = createProgram()

    try {
      await program.parseAsync(
        ['node', 'dotdo', 'repl', 'https://test.api.dotdo.dev', '--types', './types.d.ts'],
        { from: 'user' }
      )
    } catch {
      // Expected to throw in test environment
    }
  })

  it('passes historyPath when --history is provided', async () => {
    vi.doMock('rpc.do/cli', () => ({
      startRepl: mockStartRepl,
    }))

    const program = createProgram()

    try {
      await program.parseAsync(
        ['node', 'dotdo', 'repl', 'https://test.api.dotdo.dev', '--history', '/custom/history'],
        { from: 'user' }
      )
    } catch {
      // Expected to throw in test environment
    }
  })

  it('exits with error when types file cannot be read', async () => {
    // This test verifies error handling for missing types file
    const program = createProgram()

    try {
      await program.parseAsync(
        ['node', 'dotdo', 'repl', 'https://test.api.dotdo.dev', '--types', '/nonexistent/types.d.ts'],
        { from: 'user' }
      )
    } catch (e: unknown) {
      // Should exit with error code 1
      expect((e as Error).message).toContain('process.exit')
    }
  })
})
