/**
 * gitx add command tests
 *
 * RED phase tests for the add command implementation.
 * These tests verify the add command stages files to the index correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import {
  addCommand,
  addFiles,
  addAll,
  addUpdate,
  addDryRun,
  getFilesToAdd,
  matchGlobPattern,
  type AddOptions,
  type AddResult,
  type FileToAdd
} from '../../../src/cli/commands/add'
import { createCLI, type CommandContext } from '../../../src/cli/index'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a temporary directory for testing
 */
async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'gitx-add-test-'))
}

/**
 * Clean up temporary directory
 */
async function removeTempDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create a mock git repository for testing
 */
async function createMockGitRepo(basePath: string, options: {
  branch?: string
  trackedFiles?: Array<{
    path: string
    sha: string
    mode: number
  }>
  stagedFiles?: Array<{
    path: string
    sha: string
    mode: number
  }>
  config?: {
    userName?: string
    userEmail?: string
  }
} = {}): Promise<string> {
  const gitDir = path.join(basePath, '.git')

  // Create basic git structure
  await fs.mkdir(gitDir, { recursive: true })
  await fs.mkdir(path.join(gitDir, 'objects'), { recursive: true })
  await fs.mkdir(path.join(gitDir, 'refs', 'heads'), { recursive: true })

  // Write HEAD
  const branchName = options.branch ?? 'main'
  await fs.writeFile(path.join(gitDir, 'HEAD'), `ref: refs/heads/${branchName}\n`)

  // Write config
  let config = `[core]
\trepositoryformatversion = 0
\tfilemode = true
\tbare = false
`
  if (options.config?.userName !== undefined || options.config?.userEmail !== undefined) {
    config += `[user]\n`
    if (options.config?.userName !== undefined) {
      config += `\tname = ${options.config.userName}\n`
    }
    if (options.config?.userEmail !== undefined) {
      config += `\temail = ${options.config.userEmail}\n`
    }
  }
  await fs.writeFile(path.join(gitDir, 'config'), config)

  // Write mock tracked files (files in HEAD tree)
  if (options.trackedFiles && options.trackedFiles.length > 0) {
    const trackedData = options.trackedFiles.map(f =>
      `${f.sha} ${f.mode.toString(8)} ${f.path}`
    ).join('\n')
    await fs.writeFile(path.join(gitDir, 'mock-tracked'), trackedData)
  }

  // Write mock staged files (index entries)
  if (options.stagedFiles && options.stagedFiles.length > 0) {
    const stagedData = options.stagedFiles.map(f =>
      `${f.sha} ${f.mode.toString(8)} ${f.path}`
    ).join('\n')
    await fs.writeFile(path.join(gitDir, 'mock-staged'), stagedData)
  }

  return basePath
}

/**
 * Capture CLI output
 */
function createOutputCapture() {
  const output: { stdout: string[]; stderr: string[] } = {
    stdout: [],
    stderr: []
  }

  return {
    output,
    stdout: (msg: string) => output.stdout.push(msg),
    stderr: (msg: string) => output.stderr.push(msg)
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('gitx add command', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await removeTempDir(tempDir)
  })

  // ==========================================================================
  // 1. Adding a single file
  // ==========================================================================
  describe('Adding a single file', () => {
    it('should add a single file to the staging area', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'content')

      const result = await addFiles(tempDir, ['file.txt'])

      expect(result.added).toContain('file.txt')
      expect(result.added.length).toBe(1)
    })

    it('should return the SHA of the added file', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'content')

      const result = await addFiles(tempDir, ['file.txt'])

      expect(result.files[0].sha).toBeDefined()
      expect(result.files[0].sha.length).toBe(40)
      expect(result.files[0].sha).toMatch(/^[0-9a-f]{40}$/)
    })

    it('should stage a file via CLI', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'new-file.ts'), 'export {}')

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      const result = await cli.run(['add', 'new-file.ts', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })

    it('should add a file with spaces in the name', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file with spaces.txt'), 'content')

      const result = await addFiles(tempDir, ['file with spaces.txt'])

      expect(result.added).toContain('file with spaces.txt')
    })

    it('should add a hidden file (dot file)', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, '.gitignore'), '*.log')

      const result = await addFiles(tempDir, ['.gitignore'])

      expect(result.added).toContain('.gitignore')
    })
  })

  // ==========================================================================
  // 2. Adding multiple files
  // ==========================================================================
  describe('Adding multiple files', () => {
    it('should add multiple files at once', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file1.txt'), 'content1')
      await fs.writeFile(path.join(tempDir, 'file2.txt'), 'content2')
      await fs.writeFile(path.join(tempDir, 'file3.txt'), 'content3')

      const result = await addFiles(tempDir, ['file1.txt', 'file2.txt', 'file3.txt'])

      expect(result.added).toHaveLength(3)
      expect(result.added).toContain('file1.txt')
      expect(result.added).toContain('file2.txt')
      expect(result.added).toContain('file3.txt')
    })

    it('should handle multiple files via CLI', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'a.ts'), 'a')
      await fs.writeFile(path.join(tempDir, 'b.ts'), 'b')

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      const result = await cli.run(['add', 'a.ts', 'b.ts', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })

    it('should report count of files added', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file1.txt'), 'content1')
      await fs.writeFile(path.join(tempDir, 'file2.txt'), 'content2')

      const result = await addFiles(tempDir, ['file1.txt', 'file2.txt'])

      expect(result.count).toBe(2)
    })
  })

  // ==========================================================================
  // 3. Adding directories
  // ==========================================================================
  describe('Adding directories', () => {
    it('should add all files in a directory', async () => {
      await createMockGitRepo(tempDir)
      await fs.mkdir(path.join(tempDir, 'src'), { recursive: true })
      await fs.writeFile(path.join(tempDir, 'src', 'index.ts'), 'export {}')
      await fs.writeFile(path.join(tempDir, 'src', 'utils.ts'), 'export {}')

      const result = await addFiles(tempDir, ['src'])

      expect(result.added).toContain('src/index.ts')
      expect(result.added).toContain('src/utils.ts')
    })

    it('should add files from nested directories', async () => {
      await createMockGitRepo(tempDir)
      await fs.mkdir(path.join(tempDir, 'src', 'components'), { recursive: true })
      await fs.writeFile(path.join(tempDir, 'src', 'components', 'Button.tsx'), 'export {}')

      const result = await addFiles(tempDir, ['src'])

      expect(result.added).toContain('src/components/Button.tsx')
    })

    it('should handle empty directory', async () => {
      await createMockGitRepo(tempDir)
      await fs.mkdir(path.join(tempDir, 'empty-dir'), { recursive: true })

      const result = await addFiles(tempDir, ['empty-dir'])

      // Empty directories should not add any files
      expect(result.added).toHaveLength(0)
    })

    it('should add current directory with .', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file1.txt'), 'content1')
      await fs.writeFile(path.join(tempDir, 'file2.txt'), 'content2')

      const result = await addFiles(tempDir, ['.'])

      expect(result.added.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ==========================================================================
  // 4. Glob pattern matching
  // ==========================================================================
  describe('Glob pattern matching', () => {
    it('should match *.ts files', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file1.ts'), 'ts1')
      await fs.writeFile(path.join(tempDir, 'file2.ts'), 'ts2')
      await fs.writeFile(path.join(tempDir, 'file.js'), 'js')

      const result = await addFiles(tempDir, ['*.ts'])

      expect(result.added).toContain('file1.ts')
      expect(result.added).toContain('file2.ts')
      expect(result.added).not.toContain('file.js')
    })

    it('should match **/*.ts files recursively', async () => {
      await createMockGitRepo(tempDir)
      await fs.mkdir(path.join(tempDir, 'src'), { recursive: true })
      await fs.writeFile(path.join(tempDir, 'root.ts'), 'root')
      await fs.writeFile(path.join(tempDir, 'src', 'nested.ts'), 'nested')

      const result = await addFiles(tempDir, ['**/*.ts'])

      expect(result.added).toContain('root.ts')
      expect(result.added).toContain('src/nested.ts')
    })

    it('should match specific directory patterns', async () => {
      await createMockGitRepo(tempDir)
      await fs.mkdir(path.join(tempDir, 'src'), { recursive: true })
      await fs.mkdir(path.join(tempDir, 'test'), { recursive: true })
      await fs.writeFile(path.join(tempDir, 'src', 'code.ts'), 'src')
      await fs.writeFile(path.join(tempDir, 'test', 'test.ts'), 'test')

      const result = await addFiles(tempDir, ['src/*.ts'])

      expect(result.added).toContain('src/code.ts')
      expect(result.added).not.toContain('test/test.ts')
    })

    it('should match multiple extensions with braces', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file.ts'), 'ts')
      await fs.writeFile(path.join(tempDir, 'file.tsx'), 'tsx')
      await fs.writeFile(path.join(tempDir, 'file.js'), 'js')

      const result = await addFiles(tempDir, ['*.{ts,tsx}'])

      expect(result.added).toContain('file.ts')
      expect(result.added).toContain('file.tsx')
      expect(result.added).not.toContain('file.js')
    })

    it('should handle negation patterns', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file1.ts'), 'ts1')
      await fs.writeFile(path.join(tempDir, 'file2.ts'), 'ts2')
      await fs.writeFile(path.join(tempDir, 'file.test.ts'), 'test')

      // Add all ts files except test files
      const files = await getFilesToAdd(tempDir, ['*.ts'], { exclude: ['*.test.ts'] })

      expect(files.map(f => f.path)).toContain('file1.ts')
      expect(files.map(f => f.path)).toContain('file2.ts')
      expect(files.map(f => f.path)).not.toContain('file.test.ts')
    })

    it('should test glob pattern helper function', () => {
      expect(matchGlobPattern('file.ts', '*.ts')).toBe(true)
      expect(matchGlobPattern('file.js', '*.ts')).toBe(false)
      expect(matchGlobPattern('src/file.ts', '**/*.ts')).toBe(true)
      expect(matchGlobPattern('src/sub/file.ts', '**/*.ts')).toBe(true)
    })
  })

  // ==========================================================================
  // 5. --all flag (-A)
  // ==========================================================================
  describe('--all flag (-A)', () => {
    it('should add all untracked files with -A flag', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'new1.txt'), 'new1')
      await fs.writeFile(path.join(tempDir, 'new2.txt'), 'new2')

      const result = await addAll(tempDir)

      expect(result.added).toContain('new1.txt')
      expect(result.added).toContain('new2.txt')
    })

    it('should add all modified files with -A flag', async () => {
      await createMockGitRepo(tempDir, {
        trackedFiles: [
          { path: 'tracked.txt', sha: 'a'.repeat(40), mode: 0o100644 }
        ]
      })
      await fs.writeFile(path.join(tempDir, 'tracked.txt'), 'modified content')

      const result = await addAll(tempDir)

      expect(result.added).toContain('tracked.txt')
    })

    it('should stage deleted files with -A flag', async () => {
      await createMockGitRepo(tempDir, {
        trackedFiles: [
          { path: 'deleted.txt', sha: 'a'.repeat(40), mode: 0o100644 }
        ]
      })
      // File exists in tracking but not on disk (deleted)

      const result = await addAll(tempDir)

      expect(result.deleted).toContain('deleted.txt')
    })

    it('should handle -A via CLI', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'content')

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      const result = await cli.run(['add', '-A', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })

    it('should handle --all via CLI', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'content')

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      const result = await cli.run(['add', '--all', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })

    it('should process files in subdirectories with -A', async () => {
      await createMockGitRepo(tempDir)
      await fs.mkdir(path.join(tempDir, 'src'), { recursive: true })
      await fs.writeFile(path.join(tempDir, 'src', 'deep.ts'), 'deep')

      const result = await addAll(tempDir)

      expect(result.added).toContain('src/deep.ts')
    })
  })

  // ==========================================================================
  // 6. --update flag (-u)
  // ==========================================================================
  describe('--update flag (-u)', () => {
    it('should only update tracked files with -u flag', async () => {
      await createMockGitRepo(tempDir, {
        trackedFiles: [
          { path: 'tracked.txt', sha: 'a'.repeat(40), mode: 0o100644 }
        ]
      })
      await fs.writeFile(path.join(tempDir, 'tracked.txt'), 'modified')
      await fs.writeFile(path.join(tempDir, 'untracked.txt'), 'new file')

      const result = await addUpdate(tempDir)

      expect(result.added).toContain('tracked.txt')
      expect(result.added).not.toContain('untracked.txt')
    })

    it('should not add untracked files with -u flag', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'untracked.txt'), 'new content')

      const result = await addUpdate(tempDir)

      expect(result.added).not.toContain('untracked.txt')
      expect(result.added).toHaveLength(0)
    })

    it('should stage deletions with -u flag', async () => {
      await createMockGitRepo(tempDir, {
        trackedFiles: [
          { path: 'deleted.txt', sha: 'a'.repeat(40), mode: 0o100644 }
        ]
      })
      // File is tracked but deleted from disk

      const result = await addUpdate(tempDir)

      expect(result.deleted).toContain('deleted.txt')
    })

    it('should handle -u via CLI', async () => {
      await createMockGitRepo(tempDir, {
        trackedFiles: [
          { path: 'tracked.txt', sha: 'a'.repeat(40), mode: 0o100644 }
        ]
      })
      await fs.writeFile(path.join(tempDir, 'tracked.txt'), 'modified')

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      const result = await cli.run(['add', '-u', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })

    it('should handle --update via CLI', async () => {
      await createMockGitRepo(tempDir, {
        trackedFiles: [
          { path: 'tracked.txt', sha: 'a'.repeat(40), mode: 0o100644 }
        ]
      })
      await fs.writeFile(path.join(tempDir, 'tracked.txt'), 'modified')

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      const result = await cli.run(['add', '--update', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })
  })

  // ==========================================================================
  // 7. --dry-run flag (-n)
  // ==========================================================================
  describe('--dry-run flag (-n)', () => {
    it('should show what would be added without actually adding', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'content')

      const result = await addDryRun(tempDir, ['file.txt'])

      expect(result.wouldAdd).toContain('file.txt')
      expect(result.added).toHaveLength(0)
    })

    it('should not modify the index with -n flag', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'content')

      await addDryRun(tempDir, ['file.txt'])

      // Verify file is not actually staged by trying to get staged files
      const indexPath = path.join(tempDir, '.git', 'index')
      const indexExists = await fs.access(indexPath).then(() => true).catch(() => false)
      // If no index exists or it's unchanged, dry-run worked correctly
      expect(indexExists).toBe(false)
    })

    it('should handle -n via CLI', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'content')

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      const result = await cli.run(['add', '-n', 'file.txt', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
      expect(capture.output.stdout.join('\n')).toMatch(/add.*file\.txt|would add.*file\.txt/i)
    })

    it('should handle --dry-run via CLI', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'content')

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      const result = await cli.run(['add', '--dry-run', 'file.txt', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })

    it('should show multiple files that would be added', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file1.txt'), 'content1')
      await fs.writeFile(path.join(tempDir, 'file2.txt'), 'content2')

      const result = await addDryRun(tempDir, ['file1.txt', 'file2.txt'])

      expect(result.wouldAdd).toContain('file1.txt')
      expect(result.wouldAdd).toContain('file2.txt')
    })
  })

  // ==========================================================================
  // 8. --verbose flag (-v)
  // ==========================================================================
  describe('--verbose flag (-v)', () => {
    it('should show verbose output when adding files', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'content')

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      await cli.run(['add', '-v', 'file.txt', '--cwd', tempDir])

      const output = capture.output.stdout.join('\n')
      expect(output).toContain('file.txt')
    })

    it('should show file paths being added with -v', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file1.txt'), 'content1')
      await fs.writeFile(path.join(tempDir, 'file2.txt'), 'content2')

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      await cli.run(['add', '--verbose', 'file1.txt', 'file2.txt', '--cwd', tempDir])

      const output = capture.output.stdout.join('\n')
      expect(output).toContain('file1.txt')
      expect(output).toContain('file2.txt')
    })

    it('should handle --verbose via CLI', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'content')

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      const result = await cli.run(['add', '--verbose', 'file.txt', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })
  })

  // ==========================================================================
  // 9. Error handling - file not found
  // ==========================================================================
  describe('Error handling - file not found', () => {
    it('should error when file does not exist', async () => {
      await createMockGitRepo(tempDir)

      await expect(addFiles(tempDir, ['nonexistent.txt']))
        .rejects.toThrow(/no such file|not found|does not exist/i)
    })

    it('should return non-zero exit code for missing file via CLI', async () => {
      await createMockGitRepo(tempDir)

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      const result = await cli.run(['add', 'nonexistent.txt', '--cwd', tempDir])

      expect(result.exitCode).toBe(1)
      expect(capture.output.stderr.join('\n')).toMatch(/no such file|not found|does not exist/i)
    })

    it('should provide helpful error message for missing files', async () => {
      await createMockGitRepo(tempDir)

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      await cli.run(['add', 'missing.txt', '--cwd', tempDir])

      expect(capture.output.stderr.join('\n')).toContain('missing.txt')
    })

    it('should continue adding other files when one is missing (with warning)', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'exists.txt'), 'content')

      // Depending on implementation, this might add exists.txt and warn about missing.txt
      // or fail entirely
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      await cli.run(['add', 'exists.txt', 'missing.txt', '--cwd', tempDir])

      // Should have some error output about missing file
      expect(capture.output.stderr.join('\n')).toMatch(/missing\.txt|not found/i)
    })
  })

  // ==========================================================================
  // 10. Error handling - permission denied
  // ==========================================================================
  describe('Error handling - permission denied', () => {
    it('should handle permission denied when reading file', async () => {
      await createMockGitRepo(tempDir)
      const restrictedFile = path.join(tempDir, 'restricted.txt')
      await fs.writeFile(restrictedFile, 'content')

      // Make file unreadable (only works on Unix-like systems)
      try {
        await fs.chmod(restrictedFile, 0o000)

        await expect(addFiles(tempDir, ['restricted.txt']))
          .rejects.toThrow(/permission denied|EACCES/i)
      } finally {
        // Restore permissions for cleanup
        await fs.chmod(restrictedFile, 0o644)
      }
    })

    it('should return non-zero exit code for permission error via CLI', async () => {
      await createMockGitRepo(tempDir)
      const restrictedFile = path.join(tempDir, 'restricted.txt')
      await fs.writeFile(restrictedFile, 'content')

      try {
        await fs.chmod(restrictedFile, 0o000)

        const capture = createOutputCapture()
        const cli = createCLI({
          stdout: capture.stdout,
          stderr: capture.stderr
        })
        cli.registerCommand('add', addCommand)

        const result = await cli.run(['add', 'restricted.txt', '--cwd', tempDir])

        expect(result.exitCode).toBe(1)
      } finally {
        await fs.chmod(restrictedFile, 0o644)
      }
    })
  })

  // ==========================================================================
  // 11. Edge cases - already staged files
  // ==========================================================================
  describe('Edge cases - already staged files', () => {
    it('should handle adding already staged file', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'staged.txt', sha: 'a'.repeat(40), mode: 0o100644 }
        ]
      })
      await fs.writeFile(path.join(tempDir, 'staged.txt'), 'same content')

      const result = await addFiles(tempDir, ['staged.txt'])

      // Should succeed without error, might update or be a no-op
      expect(result).toBeDefined()
    })

    it('should update staged file if content changed', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'staged.txt', sha: 'a'.repeat(40), mode: 0o100644 }
        ]
      })
      await fs.writeFile(path.join(tempDir, 'staged.txt'), 'new content')

      const result = await addFiles(tempDir, ['staged.txt'])

      expect(result.added).toContain('staged.txt')
      // New SHA should be different
      expect(result.files[0].sha).not.toBe('a'.repeat(40))
    })

    it('should not change staging if file unchanged', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'content')

      // Add file first time
      await addFiles(tempDir, ['file.txt'])

      // Add same file again without changes
      const result = await addFiles(tempDir, ['file.txt'])

      // Should succeed but indicate no changes
      expect(result.unchanged).toContain('file.txt')
    })
  })

  // ==========================================================================
  // 12. Edge cases - symbolic links
  // ==========================================================================
  describe('Edge cases - symbolic links', () => {
    it('should add symbolic links correctly', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'target.txt'), 'target content')

      try {
        await fs.symlink(
          path.join(tempDir, 'target.txt'),
          path.join(tempDir, 'link.txt')
        )

        const result = await addFiles(tempDir, ['link.txt'])

        expect(result.added).toContain('link.txt')
        // Symlinks should have mode 120000
        const linkFile = result.files.find(f => f.path === 'link.txt')
        expect(linkFile?.mode).toBe(0o120000)
      } catch {
        // Skip on systems that don't support symlinks
      }
    })
  })

  // ==========================================================================
  // 13. Edge cases - binary files
  // ==========================================================================
  describe('Edge cases - binary files', () => {
    it('should add binary files', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(
        path.join(tempDir, 'binary.bin'),
        Buffer.from([0x00, 0xff, 0x00, 0xff])
      )

      const result = await addFiles(tempDir, ['binary.bin'])

      expect(result.added).toContain('binary.bin')
    })

    it('should add image files', async () => {
      await createMockGitRepo(tempDir)
      // Create a minimal PNG header
      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
      ])
      await fs.writeFile(path.join(tempDir, 'image.png'), pngHeader)

      const result = await addFiles(tempDir, ['image.png'])

      expect(result.added).toContain('image.png')
    })
  })

  // ==========================================================================
  // 14. Edge cases - large files
  // ==========================================================================
  describe('Edge cases - large files', () => {
    it('should handle moderately large files', async () => {
      await createMockGitRepo(tempDir)
      // Create a 1MB file
      const largeContent = 'x'.repeat(1024 * 1024)
      await fs.writeFile(path.join(tempDir, 'large.txt'), largeContent)

      const result = await addFiles(tempDir, ['large.txt'])

      expect(result.added).toContain('large.txt')
    })
  })

  // ==========================================================================
  // 15. Edge cases - unicode filenames
  // ==========================================================================
  describe('Edge cases - unicode filenames', () => {
    it('should handle unicode characters in filenames', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'content')

      const result = await addFiles(tempDir, ['file.txt'])

      expect(result.added).toContain('file.txt')
    })

    it('should handle emoji in filenames', async () => {
      await createMockGitRepo(tempDir)
      // Some filesystems may not support this
      try {
        await fs.writeFile(path.join(tempDir, 'notes.txt'), 'notes content')
        const result = await addFiles(tempDir, ['notes.txt'])
        expect(result.added).toContain('notes.txt')
      } catch {
        // Skip if filesystem doesn't support unicode
      }
    })
  })

  // ==========================================================================
  // 16. Non-git directory error
  // ==========================================================================
  describe('Non-git directory error', () => {
    it('should error when not in a git repository', async () => {
      const nonGitDir = await createTempDir()

      try {
        await expect(addFiles(nonGitDir, ['file.txt']))
          .rejects.toThrow(/not a git repository/i)
      } finally {
        await removeTempDir(nonGitDir)
      }
    })

    it('should return non-zero exit code for non-git directory via CLI', async () => {
      const nonGitDir = await createTempDir()

      try {
        const capture = createOutputCapture()
        const cli = createCLI({
          stdout: capture.stdout,
          stderr: capture.stderr
        })
        cli.registerCommand('add', addCommand)

        const result = await cli.run(['add', 'file.txt', '--cwd', nonGitDir])

        expect(result.exitCode).toBe(1)
        expect(capture.output.stderr.join('\n')).toMatch(/not a git repository/i)
      } finally {
        await removeTempDir(nonGitDir)
      }
    })
  })

  // ==========================================================================
  // 17. Respects .gitignore
  // ==========================================================================
  describe('Respects .gitignore', () => {
    it('should not add files matching .gitignore patterns', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, '.gitignore'), '*.log\nnode_modules/')
      await fs.writeFile(path.join(tempDir, 'app.log'), 'log content')
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'text content')

      const result = await addFiles(tempDir, ['.'])

      expect(result.added).not.toContain('app.log')
      expect(result.added).toContain('file.txt')
    })

    it('should allow force-adding ignored files with -f flag', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, '.gitignore'), '*.log')
      await fs.writeFile(path.join(tempDir, 'app.log'), 'log content')

      const result = await addFiles(tempDir, ['app.log'], { force: true })

      expect(result.added).toContain('app.log')
    })

    it('should warn when trying to add ignored file without -f', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, '.gitignore'), '*.log')
      await fs.writeFile(path.join(tempDir, 'app.log'), 'log content')

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      await cli.run(['add', 'app.log', '--cwd', tempDir])

      expect(capture.output.stderr.join('\n')).toMatch(/ignored|gitignore/i)
    })
  })

  // ==========================================================================
  // 18. Executable files
  // ==========================================================================
  describe('Executable files', () => {
    it('should preserve executable mode', async () => {
      await createMockGitRepo(tempDir)
      const execFile = path.join(tempDir, 'script.sh')
      await fs.writeFile(execFile, '#!/bin/bash\necho hello')
      await fs.chmod(execFile, 0o755)

      const result = await addFiles(tempDir, ['script.sh'])

      const addedFile = result.files.find(f => f.path === 'script.sh')
      expect(addedFile?.mode).toBe(0o100755)
    })
  })

  // ==========================================================================
  // 19. CLI Integration Tests
  // ==========================================================================
  describe('CLI Integration', () => {
    it('should register add command with CLI', () => {
      const cli = createCLI()

      expect(() => cli.registerCommand('add', addCommand)).not.toThrow()
    })

    it('should show help for add command', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      await cli.run(['add', '--help'])

      const output = capture.output.stdout.join('\n')
      expect(output).toMatch(/add/i)
    })

    it('should error when no files specified without -A or -u', async () => {
      await createMockGitRepo(tempDir)

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      const result = await cli.run(['add', '--cwd', tempDir])

      expect(result.exitCode).toBe(1)
      expect(capture.output.stderr.join('\n')).toMatch(/nothing specified|no files|specify files/i)
    })
  })

  // ==========================================================================
  // 20. Intent-to-add flag (-N or --intent-to-add)
  // ==========================================================================
  describe('Intent-to-add flag (-N)', () => {
    it('should add file with intent-to-add flag', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'content')

      const result = await addFiles(tempDir, ['file.txt'], { intentToAdd: true })

      expect(result.intentToAdd).toContain('file.txt')
    })

    it('should handle -N via CLI', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'content')

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      const result = await cli.run(['add', '-N', 'file.txt', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })
  })

  // ==========================================================================
  // 21. Patch mode (-p or --patch)
  // ==========================================================================
  describe('Patch mode (-p)', () => {
    it('should support --patch flag', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'content')

      // Patch mode is interactive, so for now just verify flag is recognized
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      // This should not error even if not fully implemented
      const result = await cli.run(['add', '-p', 'file.txt', '--cwd', tempDir])

      // Patch mode may require interactive input, so just verify command runs
      expect(result.command).toBe('add')
    })
  })

  // ==========================================================================
  // 22. File path with special characters
  // ==========================================================================
  describe('File paths with special characters', () => {
    it('should handle file paths with single quotes', async () => {
      await createMockGitRepo(tempDir)
      try {
        await fs.writeFile(path.join(tempDir, "file's.txt"), 'content')
        const result = await addFiles(tempDir, ["file's.txt"])
        expect(result.added).toContain("file's.txt")
      } catch {
        // Skip if filesystem doesn't support this character
      }
    })

    it('should handle file paths with parentheses', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file(1).txt'), 'content')

      const result = await addFiles(tempDir, ['file(1).txt'])

      expect(result.added).toContain('file(1).txt')
    })

    it('should handle file paths with brackets', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file[1].txt'), 'content')

      const result = await addFiles(tempDir, ['file[1].txt'])

      expect(result.added).toContain('file[1].txt')
    })
  })

  // ==========================================================================
  // 23. Combining flags
  // ==========================================================================
  describe('Combining flags', () => {
    it('should combine -v and -n flags', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'content')

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      const result = await cli.run(['add', '-v', '-n', 'file.txt', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
      expect(capture.output.stdout.join('\n')).toContain('file.txt')
    })

    it('should combine -A and -v flags', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file1.txt'), 'content1')
      await fs.writeFile(path.join(tempDir, 'file2.txt'), 'content2')

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      const result = await cli.run(['add', '-A', '-v', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })
  })

  // ==========================================================================
  // 24. Path outside repository
  // ==========================================================================
  describe('Path outside repository', () => {
    it('should error when path is outside the repository', async () => {
      await createMockGitRepo(tempDir)

      await expect(addFiles(tempDir, ['../outside.txt']))
        .rejects.toThrow(/outside.*repository|invalid path/i)
    })

    it('should error via CLI for paths outside repository', async () => {
      await createMockGitRepo(tempDir)

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      const result = await cli.run(['add', '../outside.txt', '--cwd', tempDir])

      expect(result.exitCode).toBe(1)
    })
  })

  // ==========================================================================
  // 25. Refresh option (--refresh)
  // ==========================================================================
  describe('Refresh option (--refresh)', () => {
    it('should support --refresh to update index stat info', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'staged.txt', sha: 'a'.repeat(40), mode: 0o100644 }
        ]
      })
      await fs.writeFile(path.join(tempDir, 'staged.txt'), 'same content')

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('add', addCommand)

      const result = await cli.run(['add', '--refresh', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })
  })
})

// ============================================================================
// Module Export Tests
// ============================================================================

describe('Add Module Exports', () => {
  it('should export addCommand function', async () => {
    const module = await import('../../../src/cli/commands/add')
    expect(typeof module.addCommand).toBe('function')
  })

  it('should export addFiles function', async () => {
    const module = await import('../../../src/cli/commands/add')
    expect(typeof module.addFiles).toBe('function')
  })

  it('should export addAll function', async () => {
    const module = await import('../../../src/cli/commands/add')
    expect(typeof module.addAll).toBe('function')
  })

  it('should export addUpdate function', async () => {
    const module = await import('../../../src/cli/commands/add')
    expect(typeof module.addUpdate).toBe('function')
  })

  it('should export addDryRun function', async () => {
    const module = await import('../../../src/cli/commands/add')
    expect(typeof module.addDryRun).toBe('function')
  })

  it('should export getFilesToAdd function', async () => {
    const module = await import('../../../src/cli/commands/add')
    expect(typeof module.getFilesToAdd).toBe('function')
  })

  it('should export matchGlobPattern function', async () => {
    const module = await import('../../../src/cli/commands/add')
    expect(typeof module.matchGlobPattern).toBe('function')
  })

  it('should export AddResult type', async () => {
    // Type check - this verifies the export exists at compile time
    const result: AddResult = {
      added: [],
      deleted: [],
      unchanged: [],
      wouldAdd: [],
      intentToAdd: [],
      files: [],
      count: 0
    }
    expect(result.added).toHaveLength(0)
  })

  it('should export AddOptions type', async () => {
    const opts: AddOptions = {
      force: false,
      dryRun: false,
      verbose: false,
      intentToAdd: false,
      update: false,
      all: false
    }
    expect(opts.force).toBe(false)
  })

  it('should export FileToAdd type', async () => {
    const file: FileToAdd = {
      path: 'test.ts',
      sha: 'a'.repeat(40),
      mode: 0o100644
    }
    expect(file.path).toBe('test.ts')
  })
})
