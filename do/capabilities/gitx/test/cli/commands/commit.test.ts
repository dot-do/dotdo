/**
 * gitx commit command tests
 *
 * RED phase tests for the commit command implementation.
 * These tests verify the commit command creates proper commit objects.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import {
  commitCommand,
  createCommit,
  validateCommitMessage,
  getStagedFiles,
  type CommitOptions,
  type CommitResult,
  type StagedFile
} from '../../../src/cli/commands/commit'
import { createCLI } from '../../../src/cli/index'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a temporary directory for testing
 */
async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'gitx-commit-test-'))
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
  stagedFiles?: Array<{
    path: string
    sha: string
    mode: number
  }>
  lastCommit?: {
    sha: string
    message: string
    author: string
    date: Date
    tree: string
    parents: string[]
  }
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

  // Write branch ref if there's a last commit
  if (options.lastCommit) {
    await fs.writeFile(
      path.join(gitDir, 'refs', 'heads', branchName),
      options.lastCommit.sha + '\n'
    )
  }

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

  // Write mock staged files (for testing)
  if (options.stagedFiles && options.stagedFiles.length > 0) {
    const stagedData = options.stagedFiles.map(f =>
      `${f.sha} ${f.mode.toString(8)} ${f.path}`
    ).join('\n')
    await fs.writeFile(path.join(gitDir, 'mock-staged'), stagedData)
  }

  // Write mock last commit (for testing)
  if (options.lastCommit) {
    await fs.writeFile(
      path.join(gitDir, 'mock-last-commit'),
      JSON.stringify(options.lastCommit)
    )
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

describe('gitx commit command', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await removeTempDir(tempDir)
  })

  // ==========================================================================
  // 1. Creates commit with -m message flag
  // ==========================================================================
  describe('Creates commit with -m message flag', () => {
    it('should create a commit with the provided message', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 'a'.repeat(40), mode: 0o100644 }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const result = await createCommit(tempDir, {
        message: 'Initial commit'
      })

      expect(result.message).toBe('Initial commit')
      expect(result.sha).toBeDefined()
      expect(result.sha.length).toBe(40)
    })

    it('should accept message via CLI -m flag', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'README.md', sha: 'b'.repeat(40), mode: 0o100644 }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('commit', commitCommand)

      const result = await cli.run(['commit', '-m', 'Add README', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
      expect(capture.output.stdout.join('\n')).toMatch(/[0-9a-f]{7,40}/)
    })

    it('should support multi-line commit messages', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'feature.ts', sha: 'c'.repeat(40), mode: 0o100644 }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const message = 'Add new feature\n\nThis is a longer description\nwith multiple lines.'
      const result = await createCommit(tempDir, { message })

      expect(result.message).toBe(message)
    })

    it('should trim whitespace from commit message', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 'd'.repeat(40), mode: 0o100644 }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const result = await createCommit(tempDir, {
        message: '  Trimmed message  \n\n'
      })

      expect(result.message).toBe('Trimmed message')
    })
  })

  // ==========================================================================
  // 2. Validates commit message format (not empty)
  // ==========================================================================
  describe('Validates commit message format', () => {
    it('should reject empty commit message', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 'a'.repeat(40), mode: 0o100644 }
        ]
      })

      await expect(createCommit(tempDir, { message: '' }))
        .rejects.toThrow(/empty|message required/i)
    })

    it('should reject whitespace-only commit message', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 'a'.repeat(40), mode: 0o100644 }
        ]
      })

      await expect(createCommit(tempDir, { message: '   \n\t  ' }))
        .rejects.toThrow(/empty|message required/i)
    })

    it('should validate message format correctly', () => {
      expect(validateCommitMessage('')).toBe(false)
      expect(validateCommitMessage('   ')).toBe(false)
      expect(validateCommitMessage('\n\n')).toBe(false)
      expect(validateCommitMessage('Valid message')).toBe(true)
      expect(validateCommitMessage('A')).toBe(true)
    })

    it('should return error via CLI when message is missing', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 'a'.repeat(40), mode: 0o100644 }
        ]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('commit', commitCommand)

      const result = await cli.run(['commit', '--cwd', tempDir])

      expect(result.exitCode).toBe(1)
      expect(capture.output.stderr.join('\n')).toMatch(/message|required|-m/i)
    })
  })

  // ==========================================================================
  // 3. Shows staged files before commit
  // ==========================================================================
  describe('Shows staged files before commit', () => {
    it('should return list of staged files', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file1.txt', sha: 'a'.repeat(40), mode: 0o100644 },
          { path: 'file2.txt', sha: 'b'.repeat(40), mode: 0o100644 },
          { path: 'src/index.ts', sha: 'c'.repeat(40), mode: 0o100644 }
        ]
      })

      const stagedFiles = await getStagedFiles(tempDir)

      expect(stagedFiles).toHaveLength(3)
      expect(stagedFiles.map(f => f.path)).toContain('file1.txt')
      expect(stagedFiles.map(f => f.path)).toContain('file2.txt')
      expect(stagedFiles.map(f => f.path)).toContain('src/index.ts')
    })

    it('should include file SHA in staged files', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 'abc123'.padEnd(40, '0'), mode: 0o100644 }
        ]
      })

      const stagedFiles = await getStagedFiles(tempDir)

      expect(stagedFiles[0].sha).toBe('abc123'.padEnd(40, '0'))
    })

    it('should include file mode in staged files', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'script.sh', sha: 'a'.repeat(40), mode: 0o100755 }
        ]
      })

      const stagedFiles = await getStagedFiles(tempDir)

      expect(stagedFiles[0].mode).toBe(0o100755)
    })

    it('should return empty array when nothing is staged', async () => {
      await createMockGitRepo(tempDir)

      const stagedFiles = await getStagedFiles(tempDir)

      expect(stagedFiles).toHaveLength(0)
    })
  })

  // ==========================================================================
  // 4. Handles empty commit (nothing staged) with error
  // ==========================================================================
  describe('Handles empty commit with error', () => {
    it('should reject commit when nothing is staged', async () => {
      await createMockGitRepo(tempDir, {
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      await expect(createCommit(tempDir, { message: 'Empty commit' }))
        .rejects.toThrow(/nothing to commit|no changes|empty/i)
    })

    it('should return non-zero exit code via CLI for empty commit', async () => {
      await createMockGitRepo(tempDir, {
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('commit', commitCommand)

      const result = await cli.run(['commit', '-m', 'Empty commit', '--cwd', tempDir])

      expect(result.exitCode).toBe(1)
      expect(capture.output.stderr.join('\n')).toMatch(/nothing to commit|no changes/i)
    })

    it('should provide helpful error message when working tree is clean', async () => {
      await createMockGitRepo(tempDir, {
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('commit', commitCommand)

      await cli.run(['commit', '-m', 'Test', '--cwd', tempDir])

      expect(capture.output.stderr.join('\n')).toMatch(/nothing to commit|working tree clean/i)
    })
  })

  // ==========================================================================
  // 5. Supports --amend flag to modify last commit
  // ==========================================================================
  describe('Supports --amend flag', () => {
    it('should modify the last commit with --amend', async () => {
      const lastCommitSha = 'e'.repeat(40)
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'amended.txt', sha: 'f'.repeat(40), mode: 0o100644 }
        ],
        lastCommit: {
          sha: lastCommitSha,
          message: 'Original message',
          author: 'Test User <test@example.com.ai>',
          date: new Date('2024-01-01'),
          tree: 'g'.repeat(40),
          parents: []
        },
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const result = await createCommit(tempDir, {
        message: 'Amended message',
        amend: true
      })

      expect(result.message).toBe('Amended message')
      expect(result.sha).not.toBe(lastCommitSha)
    })

    it('should keep original message if no new message provided with --amend', async () => {
      await createMockGitRepo(tempDir, {
        lastCommit: {
          sha: 'h'.repeat(40),
          message: 'Original message',
          author: 'Test User <test@example.com.ai>',
          date: new Date('2024-01-01'),
          tree: 'i'.repeat(40),
          parents: []
        },
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const result = await createCommit(tempDir, {
        amend: true
      })

      expect(result.message).toBe('Original message')
    })

    it('should preserve parent commits when amending', async () => {
      const parentSha = 'j'.repeat(40)
      await createMockGitRepo(tempDir, {
        lastCommit: {
          sha: 'k'.repeat(40),
          message: 'Original',
          author: 'Test User <test@example.com.ai>',
          date: new Date('2024-01-01'),
          tree: 'l'.repeat(40),
          parents: [parentSha]
        },
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const result = await createCommit(tempDir, {
        message: 'Amended',
        amend: true
      })

      expect(result.parents).toContain(parentSha)
    })

    it('should handle --amend via CLI', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 'm'.repeat(40), mode: 0o100644 }
        ],
        lastCommit: {
          sha: 'n'.repeat(40),
          message: 'Original',
          author: 'Test User <test@example.com.ai>',
          date: new Date('2024-01-01'),
          tree: 'o'.repeat(40),
          parents: []
        },
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('commit', commitCommand)

      const result = await cli.run(['commit', '--amend', '-m', 'New message', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })

    it('should error if --amend with no previous commit', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 'p'.repeat(40), mode: 0o100644 }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      await expect(createCommit(tempDir, {
        message: 'Amend nothing',
        amend: true
      })).rejects.toThrow(/no commit|cannot amend/i)
    })
  })

  // ==========================================================================
  // 6. Supports -a flag to auto-stage modified files
  // ==========================================================================
  describe('Supports -a flag for auto-staging', () => {
    it('should auto-stage modified tracked files with -a flag', async () => {
      await createMockGitRepo(tempDir, {
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })
      // Create a tracked file in working directory that's modified
      await fs.writeFile(path.join(tempDir, 'tracked.txt'), 'modified content')

      // Write mock tracked files list
      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-tracked'),
        'tracked.txt'
      )

      const result = await createCommit(tempDir, {
        message: 'Auto-staged commit',
        all: true
      })

      expect(result.sha).toBeDefined()
      expect(result.sha.length).toBe(40)
    })

    it('should not auto-stage untracked files with -a flag', async () => {
      await createMockGitRepo(tempDir, {
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })
      // Create an untracked file
      await fs.writeFile(path.join(tempDir, 'untracked.txt'), 'new content')

      await expect(createCommit(tempDir, {
        message: 'Should fail',
        all: true
      })).rejects.toThrow(/nothing to commit|no changes/i)
    })

    it('should handle -a flag via CLI', async () => {
      await createMockGitRepo(tempDir, {
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })
      await fs.writeFile(path.join(tempDir, 'tracked.txt'), 'modified')
      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-tracked'),
        'tracked.txt'
      )

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('commit', commitCommand)

      const result = await cli.run(['commit', '-a', '-m', 'Auto-staged', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })

    it('should combine -a with other flags', async () => {
      await createMockGitRepo(tempDir, {
        lastCommit: {
          sha: 'q'.repeat(40),
          message: 'Original',
          author: 'Test User <test@example.com.ai>',
          date: new Date('2024-01-01'),
          tree: 'r'.repeat(40),
          parents: []
        },
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })
      await fs.writeFile(path.join(tempDir, 'tracked.txt'), 'modified')
      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-tracked'),
        'tracked.txt'
      )

      const result = await createCommit(tempDir, {
        message: 'Amended with auto-stage',
        all: true,
        amend: true
      })

      expect(result.sha).toBeDefined()
    })
  })

  // ==========================================================================
  // 7. Creates proper commit object with author, date, tree, parents
  // ==========================================================================
  describe('Creates proper commit object', () => {
    it('should include author name and email', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 's'.repeat(40), mode: 0o100644 }
        ],
        config: {
          userName: 'John Doe',
          userEmail: 'john@example.com.ai'
        }
      })

      const result = await createCommit(tempDir, {
        message: 'Test commit'
      })

      expect(result.author).toContain('John Doe')
      expect(result.author).toContain('john@example.com.ai')
    })

    it('should include commit date', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 't'.repeat(40), mode: 0o100644 }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const before = new Date()
      const result = await createCommit(tempDir, {
        message: 'Test commit'
      })
      const after = new Date()

      expect(result.date).toBeDefined()
      expect(result.date.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(result.date.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should include tree SHA', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 'u'.repeat(40), mode: 0o100644 }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const result = await createCommit(tempDir, {
        message: 'Test commit'
      })

      expect(result.tree).toBeDefined()
      expect(result.tree.length).toBe(40)
      expect(result.tree).toMatch(/^[0-9a-f]{40}$/)
    })

    it('should include parent commits', async () => {
      const parentSha = 'v'.repeat(40)
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 'w'.repeat(40), mode: 0o100644 }
        ],
        lastCommit: {
          sha: parentSha,
          message: 'Parent commit',
          author: 'Test User <test@example.com.ai>',
          date: new Date('2024-01-01'),
          tree: 'x'.repeat(40),
          parents: []
        },
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const result = await createCommit(tempDir, {
        message: 'Child commit'
      })

      expect(result.parents).toContain(parentSha)
    })

    it('should have no parents for initial commit', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 'y'.repeat(40), mode: 0o100644 }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const result = await createCommit(tempDir, {
        message: 'Initial commit'
      })

      expect(result.parents).toHaveLength(0)
    })

    it('should include committer info (same as author for standard commits)', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 'z'.repeat(40), mode: 0o100644 }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const result = await createCommit(tempDir, {
        message: 'Test commit'
      })

      expect(result.committer).toBeDefined()
      expect(result.committer).toContain('Test User')
    })
  })

  // ==========================================================================
  // 8. Updates HEAD after commit
  // ==========================================================================
  describe('Updates HEAD after commit', () => {
    it('should update branch ref to new commit SHA', async () => {
      await createMockGitRepo(tempDir, {
        branch: 'main',
        stagedFiles: [
          { path: 'file.txt', sha: 'a1'.repeat(20), mode: 0o100644 }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const result = await createCommit(tempDir, {
        message: 'New commit'
      })

      // Read the branch ref to verify it was updated
      const branchRef = await fs.readFile(
        path.join(tempDir, '.git', 'refs', 'heads', 'main'),
        'utf8'
      )

      expect(branchRef.trim()).toBe(result.sha)
    })

    it('should update HEAD when detached', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 'b1'.repeat(20), mode: 0o100644 }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })
      // Make HEAD detached
      await fs.writeFile(
        path.join(tempDir, '.git', 'HEAD'),
        'c1'.repeat(20) + '\n'
      )

      const result = await createCommit(tempDir, {
        message: 'Detached commit'
      })

      const headContent = await fs.readFile(
        path.join(tempDir, '.git', 'HEAD'),
        'utf8'
      )

      expect(headContent.trim()).toBe(result.sha)
    })

    it('should handle concurrent commit attempts safely', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 'd1'.repeat(20), mode: 0o100644 }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      // This should not throw even if called in quick succession
      const result1 = await createCommit(tempDir, { message: 'Commit 1' })
      const result2 = await createCommit(tempDir, { message: 'Commit 2' })

      expect(result1.sha).not.toBe(result2.sha)
    })
  })

  // ==========================================================================
  // 9. Returns commit SHA on success
  // ==========================================================================
  describe('Returns commit SHA on success', () => {
    it('should return valid 40-character SHA', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 'e1'.repeat(20), mode: 0o100644 }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const result = await createCommit(tempDir, {
        message: 'Test commit'
      })

      expect(result.sha).toMatch(/^[0-9a-f]{40}$/)
    })

    it('should output commit SHA via CLI', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 'f1'.repeat(20), mode: 0o100644 }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('commit', commitCommand)

      await cli.run(['commit', '-m', 'Test', '--cwd', tempDir])

      const output = capture.output.stdout.join('\n')
      expect(output).toMatch(/[0-9a-f]{7,40}/)
    })

    it('should show abbreviated SHA in success message', async () => {
      await createMockGitRepo(tempDir, {
        branch: 'main',
        stagedFiles: [
          { path: 'file.txt', sha: 'g1'.repeat(20), mode: 0o100644 }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('commit', commitCommand)

      await cli.run(['commit', '-m', 'Test commit', '--cwd', tempDir])

      const output = capture.output.stdout.join('\n')
      // Should show something like: [main abc1234] Test commit
      expect(output).toMatch(/\[.*[0-9a-f]{7}.*\]/)
    })

    it('should show number of files changed in output', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file1.txt', sha: 'h1'.repeat(20), mode: 0o100644 },
          { path: 'file2.txt', sha: 'h2'.repeat(20), mode: 0o100644 },
          { path: 'file3.txt', sha: 'h3'.repeat(20), mode: 0o100644 }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('commit', commitCommand)

      await cli.run(['commit', '-m', 'Multiple files', '--cwd', tempDir])

      const output = capture.output.stdout.join('\n')
      expect(output).toMatch(/3.*file|file.*3/i)
    })
  })

  // ==========================================================================
  // Edge Cases and Error Handling
  // ==========================================================================
  describe('Edge Cases and Error Handling', () => {
    it('should handle non-git directory error', async () => {
      const nonGitDir = await createTempDir()

      try {
        await expect(createCommit(nonGitDir, { message: 'Test' }))
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
        cli.registerCommand('commit', commitCommand)

        const result = await cli.run(['commit', '-m', 'Test', '--cwd', nonGitDir])

        expect(result.exitCode).toBe(1)
      } finally {
        await removeTempDir(nonGitDir)
      }
    })

    it('should handle missing user.name config', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 'i1'.repeat(20), mode: 0o100644 }
        ]
        // No config provided
      })

      await expect(createCommit(tempDir, { message: 'Test' }))
        .rejects.toThrow(/user\.name|author|identity/i)
    })

    it('should handle missing user.email config', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 'j1'.repeat(20), mode: 0o100644 }
        ],
        config: {
          userName: 'Test User'
          // No email
        }
      })

      await expect(createCommit(tempDir, { message: 'Test' }))
        .rejects.toThrow(/user\.email|author|identity/i)
    })

    it('should handle special characters in commit message', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 'k1'.repeat(20), mode: 0o100644 }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const specialMessage = 'Fix bug #123: Handle "quoted" & <special> chars'
      const result = await createCommit(tempDir, { message: specialMessage })

      expect(result.message).toBe(specialMessage)
    })

    it('should handle unicode in commit message', async () => {
      await createMockGitRepo(tempDir, {
        stagedFiles: [
          { path: 'file.txt', sha: 'l1'.repeat(20), mode: 0o100644 }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const unicodeMessage = 'Add support for emojis and unicode characters'
      const result = await createCommit(tempDir, { message: unicodeMessage })

      expect(result.message).toBe(unicodeMessage)
    })
  })

  // ==========================================================================
  // CLI Integration Tests
  // ==========================================================================
  describe('CLI Integration', () => {
    it('should register commit command with CLI', () => {
      const cli = createCLI()

      expect(() => cli.registerCommand('commit', commitCommand)).not.toThrow()
    })

    it('should show help for commit command', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('commit', commitCommand)

      await cli.run(['commit', '--help'])

      const output = capture.output.stdout.join('\n')
      expect(output).toMatch(/commit/i)
    })
  })
})
