/**
 * CommandHandler Tests - TDD Implementation
 *
 * Tests for the Strategy pattern implementation of command handlers.
 * Each handler implements a CommandHandler interface and handles
 * specific categories of commands.
 *
 * @module tests/do/handlers/command-handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FsCapability } from '../../../src/types.js'
import type { BashResult, ExecOptions } from '../../../src/types.js'

// Handler imports
import type { CommandHandler, CommandHandlerContext } from '../../../src/do/handlers/types.js'
import {
  FsCommandHandler,
  createHandlerRegistry,
  findHandler,
  executeWithHandler,
} from '../../../src/do/handlers/index.js'

// ============================================================================
// MOCK SETUP
// ============================================================================

/**
 * Create a mock FsCapability for testing
 */
function createMockFs(): FsCapability {
  return {
    read: vi.fn().mockResolvedValue('file content\n'),
    write: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue([
      { name: 'file1.txt', isDirectory: () => false },
      { name: 'folder', isDirectory: () => true },
    ]),
    stat: vi.fn().mockResolvedValue({
      size: 100,
      isDirectory: () => false,
      isFile: () => true,
      createdAt: new Date(),
      modifiedAt: new Date(),
    }),
    mkdir: vi.fn().mockResolvedValue(undefined),
    rmdir: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
    move: vi.fn().mockResolvedValue(undefined),
  } as unknown as FsCapability
}

/**
 * Create a handler context for testing
 */
function createTestContext(overrides?: Partial<CommandHandlerContext>): CommandHandlerContext {
  return {
    fs: createMockFs(),
    ...overrides,
  }
}

// ============================================================================
// COMMAND HANDLER INTERFACE CONTRACT TESTS
// ============================================================================

describe('CommandHandler Interface Contract', () => {
  let handler: CommandHandler
  let context: CommandHandlerContext

  beforeEach(() => {
    context = createTestContext()
    handler = new FsCommandHandler(context)
  })

  it('should have a readonly name property', () => {
    expect(handler.name).toBeDefined()
    expect(typeof handler.name).toBe('string')
    expect(handler.name.length).toBeGreaterThan(0)
  })

  it('should implement canHandle method', () => {
    expect(typeof handler.canHandle).toBe('function')
  })

  it('should implement execute method', () => {
    expect(typeof handler.execute).toBe('function')
  })

  it('canHandle should return boolean', () => {
    const result = handler.canHandle('ls')
    expect(typeof result).toBe('boolean')
  })

  it('execute should return Promise<BashResult>', async () => {
    const result = await handler.execute('ls', [])
    expect(result).toBeDefined()
    expect(typeof result.exitCode).toBe('number')
    expect(typeof result.stdout).toBe('string')
    expect(typeof result.stderr).toBe('string')
  })
})

// ============================================================================
// FS COMMAND HANDLER - canHandle TESTS
// ============================================================================

describe('FsCommandHandler - canHandle', () => {
  let handler: FsCommandHandler
  let context: CommandHandlerContext

  beforeEach(() => {
    context = createTestContext()
    handler = new FsCommandHandler(context)
  })

  describe('should return true for supported commands', () => {
    const supportedCommands = ['ls', 'cat', 'head', 'tail', 'wc']

    it.each(supportedCommands)('canHandle("%s") returns true', (cmd) => {
      expect(handler.canHandle(cmd)).toBe(true)
    })
  })

  describe('should return false for unsupported commands', () => {
    const unsupportedCommands = ['grep', 'find', 'curl', 'wget', 'npm', 'git', 'echo', 'pwd']

    it.each(unsupportedCommands)('canHandle("%s") returns false', (cmd) => {
      expect(handler.canHandle(cmd)).toBe(false)
    })
  })

  it('should return false for empty string', () => {
    expect(handler.canHandle('')).toBe(false)
  })

  it('should be case-sensitive (unix commands are lowercase)', () => {
    expect(handler.canHandle('LS')).toBe(false)
    expect(handler.canHandle('Cat')).toBe(false)
  })
})

// ============================================================================
// FS COMMAND HANDLER - ls COMMAND TESTS
// ============================================================================

describe('FsCommandHandler - ls command', () => {
  let handler: FsCommandHandler
  let mockFs: ReturnType<typeof createMockFs>

  beforeEach(() => {
    mockFs = createMockFs()
    handler = new FsCommandHandler({ fs: mockFs })
  })

  it('should list files in current directory by default', async () => {
    const result = await handler.execute('ls', [])

    expect(mockFs.list).toHaveBeenCalledWith('.', { withFileTypes: true })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('file1.txt')
    expect(result.stdout).toContain('folder/')
  })

  it('should list files in specified directory', async () => {
    const result = await handler.execute('ls', ['/home/user'])

    expect(mockFs.list).toHaveBeenCalledWith('/home/user', { withFileTypes: true })
    expect(result.exitCode).toBe(0)
  })

  it('should ignore option flags when determining path', async () => {
    const result = await handler.execute('ls', ['-la', '/tmp'])

    expect(mockFs.list).toHaveBeenCalledWith('/tmp', { withFileTypes: true })
    expect(result.exitCode).toBe(0)
  })

  it('should append / to directory names', async () => {
    const result = await handler.execute('ls', [])

    expect(result.stdout).toContain('folder/')
    expect(result.stdout).not.toContain('file1.txt/')
  })

  it('should return valid BashResult structure', async () => {
    const result = await handler.execute('ls', [])

    expect(result.command).toBe('ls')
    expect(result.input).toBe('ls')
    expect(result.valid).toBe(true)
    expect(result.generated).toBe(false)
    expect(result.intent).toBeDefined()
    expect(result.classification).toBeDefined()
  })
})

// ============================================================================
// FS COMMAND HANDLER - cat COMMAND TESTS
// ============================================================================

describe('FsCommandHandler - cat command', () => {
  let handler: FsCommandHandler
  let mockFs: ReturnType<typeof createMockFs>

  beforeEach(() => {
    mockFs = createMockFs()
    handler = new FsCommandHandler({ fs: mockFs })
  })

  it('should read file content', async () => {
    const result = await handler.execute('cat', ['file.txt'])

    expect(mockFs.read).toHaveBeenCalledWith('file.txt', { encoding: 'utf-8' })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('file content\n')
  })

  it('should concatenate multiple files', async () => {
    mockFs.read = vi.fn()
      .mockResolvedValueOnce('first\n')
      .mockResolvedValueOnce('second\n')

    const result = await handler.execute('cat', ['file1.txt', 'file2.txt'])

    expect(mockFs.read).toHaveBeenCalledTimes(2)
    expect(result.stdout).toBe('first\nsecond\n')
  })

  it('should return error when no file specified', async () => {
    const result = await handler.execute('cat', [])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('missing operand')
  })

  it('should ignore option flags', async () => {
    const result = await handler.execute('cat', ['-n', 'file.txt'])

    expect(mockFs.read).toHaveBeenCalledWith('file.txt', { encoding: 'utf-8' })
    expect(result.exitCode).toBe(0)
  })
})

// ============================================================================
// FS COMMAND HANDLER - head COMMAND TESTS
// ============================================================================

describe('FsCommandHandler - head command', () => {
  let handler: FsCommandHandler
  let mockFs: ReturnType<typeof createMockFs>

  beforeEach(() => {
    mockFs = createMockFs()
    mockFs.read = vi.fn().mockResolvedValue('line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\n')
    handler = new FsCommandHandler({ fs: mockFs })
  })

  it('should return first 10 lines by default', async () => {
    const result = await handler.execute('head', ['file.txt'])

    expect(result.exitCode).toBe(0)
    const lines = result.stdout.trim().split('\n')
    expect(lines.length).toBe(10)
    expect(lines[0]).toBe('line1')
    expect(lines[9]).toBe('line10')
  })

  it('should return specified number of lines with -n', async () => {
    const result = await handler.execute('head', ['-n', '5', 'file.txt'])

    expect(result.exitCode).toBe(0)
    const lines = result.stdout.trim().split('\n')
    expect(lines.length).toBe(5)
  })

  it('should support combined -n flag (-n5)', async () => {
    const result = await handler.execute('head', ['-n5', 'file.txt'])

    expect(result.exitCode).toBe(0)
    const lines = result.stdout.trim().split('\n')
    expect(lines.length).toBe(5)
  })

  it('should read from stdin when no file specified', async () => {
    const result = await handler.execute('head', [], {
      stdin: 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\n',
    })

    expect(result.exitCode).toBe(0)
    const lines = result.stdout.trim().split('\n')
    expect(lines.length).toBe(10)
  })
})

// ============================================================================
// FS COMMAND HANDLER - tail COMMAND TESTS
// ============================================================================

describe('FsCommandHandler - tail command', () => {
  let handler: FsCommandHandler
  let mockFs: ReturnType<typeof createMockFs>

  beforeEach(() => {
    mockFs = createMockFs()
    mockFs.read = vi.fn().mockResolvedValue('line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\n')
    handler = new FsCommandHandler({ fs: mockFs })
  })

  it('should return last 10 lines by default', async () => {
    const result = await handler.execute('tail', ['file.txt'])

    expect(result.exitCode).toBe(0)
    const lines = result.stdout.trim().split('\n')
    expect(lines.length).toBe(10)
    expect(lines[0]).toBe('line3')
    expect(lines[9]).toBe('line12')
  })

  it('should return specified number of lines with -n', async () => {
    const result = await handler.execute('tail', ['-n', '5', 'file.txt'])

    expect(result.exitCode).toBe(0)
    const lines = result.stdout.trim().split('\n')
    expect(lines.length).toBe(5)
    expect(lines[0]).toBe('line8')
  })

  it('should support combined -n flag (-n5)', async () => {
    const result = await handler.execute('tail', ['-n5', 'file.txt'])

    expect(result.exitCode).toBe(0)
    const lines = result.stdout.trim().split('\n')
    expect(lines.length).toBe(5)
  })

  it('should read from stdin when no file specified', async () => {
    const result = await handler.execute('tail', [], {
      stdin: 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\n',
    })

    expect(result.exitCode).toBe(0)
    const lines = result.stdout.trim().split('\n')
    expect(lines.length).toBe(10)
    expect(lines[0]).toBe('line3')
  })
})

// ============================================================================
// FS COMMAND HANDLER - wc COMMAND TESTS
// ============================================================================

describe('FsCommandHandler - wc command', () => {
  let handler: FsCommandHandler
  let mockFs: ReturnType<typeof createMockFs>

  beforeEach(() => {
    mockFs = createMockFs()
    handler = new FsCommandHandler({ fs: mockFs })
  })

  it('should count lines, words, and characters', async () => {
    const result = await handler.execute('wc', [], {
      stdin: 'hello world\nfoo bar\n',
    })

    expect(result.exitCode).toBe(0)
    // 2 lines, 4 words, 20 chars
    expect(result.stdout).toContain('2')
    expect(result.stdout).toContain('4')
    expect(result.stdout).toContain('20')
  })

  it('should count only lines with -l flag', async () => {
    const result = await handler.execute('wc', ['-l'], {
      stdin: 'line1\nline2\nline3\n',
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('3')
  })

  it('should count only words with -w flag', async () => {
    const result = await handler.execute('wc', ['-w'], {
      stdin: 'hello world foo\n',
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('3')
  })

  it('should count only characters with -c flag', async () => {
    const result = await handler.execute('wc', ['-c'], {
      stdin: 'hello\n',
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('6')
  })

  it('should handle empty input', async () => {
    const result = await handler.execute('wc', [], { stdin: '' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('0')
  })
})

// ============================================================================
// FS COMMAND HANDLER - ERROR HANDLING TESTS
// ============================================================================

describe('FsCommandHandler - Error Handling', () => {
  let handler: FsCommandHandler
  let mockFs: ReturnType<typeof createMockFs>

  beforeEach(() => {
    mockFs = createMockFs()
    handler = new FsCommandHandler({ fs: mockFs })
  })

  it('should handle fs.read errors gracefully', async () => {
    mockFs.read = vi.fn().mockRejectedValue(new Error('File not found'))

    const result = await handler.execute('cat', ['nonexistent.txt'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('File not found')
  })

  it('should handle fs.list errors gracefully', async () => {
    mockFs.list = vi.fn().mockRejectedValue(new Error('Permission denied'))

    const result = await handler.execute('ls', ['/root'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Permission denied')
  })

  it('should throw for unsupported commands', async () => {
    await expect(handler.execute('unsupported', [])).rejects.toThrow()
  })
})

// ============================================================================
// FS COMMAND HANDLER - CONTEXT TESTS
// ============================================================================

describe('FsCommandHandler - Context', () => {
  it('should require fs capability in context', () => {
    expect(() => new FsCommandHandler({} as CommandHandlerContext)).toThrow()
  })

  it('should store fs capability from context', () => {
    const mockFs = createMockFs()
    const handler = new FsCommandHandler({ fs: mockFs })

    expect(handler.name).toBe('fs')
  })
})

// ============================================================================
// FS COMMAND HANDLER - NAME PROPERTY TESTS
// ============================================================================

describe('FsCommandHandler - name property', () => {
  it('should have name "fs"', () => {
    const mockFs = createMockFs()
    const handler = new FsCommandHandler({ fs: mockFs })

    expect(handler.name).toBe('fs')
  })
})

// ============================================================================
// HANDLER REGISTRY TESTS
// ============================================================================

describe('createHandlerRegistry', () => {
  it('should create a registry with FsCommandHandler when fs capability provided', () => {
    const mockFs = createMockFs()
    const registry = createHandlerRegistry({ fs: mockFs })

    expect(registry).toHaveLength(1)
    expect(registry[0].name).toBe('fs')
  })

  it('should create empty registry when no capabilities provided', () => {
    const registry = createHandlerRegistry({})

    expect(registry).toHaveLength(0)
  })

  it('should return handlers that implement CommandHandler interface', () => {
    const mockFs = createMockFs()
    const registry = createHandlerRegistry({ fs: mockFs })

    for (const handler of registry) {
      expect(typeof handler.name).toBe('string')
      expect(typeof handler.canHandle).toBe('function')
      expect(typeof handler.execute).toBe('function')
    }
  })
})

describe('findHandler', () => {
  let mockFs: ReturnType<typeof createMockFs>
  let registry: ReturnType<typeof createHandlerRegistry>

  beforeEach(() => {
    mockFs = createMockFs()
    registry = createHandlerRegistry({ fs: mockFs })
  })

  it('should find handler for ls command', () => {
    const handler = findHandler(registry, 'ls')

    expect(handler).toBeDefined()
    expect(handler?.name).toBe('fs')
  })

  it('should find handler for cat command', () => {
    const handler = findHandler(registry, 'cat')

    expect(handler).toBeDefined()
    expect(handler?.name).toBe('fs')
  })

  it('should return undefined for unknown command', () => {
    const handler = findHandler(registry, 'unknown')

    expect(handler).toBeUndefined()
  })

  it('should return undefined for empty command', () => {
    const handler = findHandler(registry, '')

    expect(handler).toBeUndefined()
  })
})

describe('executeWithHandler', () => {
  let mockFs: ReturnType<typeof createMockFs>
  let registry: ReturnType<typeof createHandlerRegistry>

  beforeEach(() => {
    mockFs = createMockFs()
    registry = createHandlerRegistry({ fs: mockFs })
  })

  it('should execute ls command through registry', async () => {
    const result = await executeWithHandler(registry, 'ls', [])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('file1.txt')
  })

  it('should execute cat command through registry', async () => {
    const result = await executeWithHandler(registry, 'cat', ['file.txt'])

    expect(result.exitCode).toBe(0)
    expect(mockFs.read).toHaveBeenCalled()
  })

  it('should throw for unknown command', async () => {
    await expect(executeWithHandler(registry, 'unknown', [])).rejects.toThrow(
      'No handler found for command: unknown'
    )
  })

  it('should pass options to handler', async () => {
    const result = await executeWithHandler(registry, 'wc', ['-l'], {
      stdin: 'line1\nline2\nline3\n',
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('3')
  })
})
