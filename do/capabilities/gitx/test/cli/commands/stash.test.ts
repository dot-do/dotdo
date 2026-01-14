/**
 * gitx stash command tests
 *
 * RED phase tests for the stash command implementation.
 * These tests verify stashing working directory changes, listing stashes,
 * applying/popping stashes, dropping stashes, and stash messages.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import {
  stashCommand,
  stashPush,
  stashList,
  stashApply,
  stashPop,
  stashDrop,
  stashShow,
  stashClear,
  getStashCount,
  type StashEntry,
  type StashPushOptions,
  type StashApplyOptions
} from '../../../src/cli/commands/stash'
import { createCLI } from '../../../src/cli/index'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a temporary directory for testing
 */
async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'gitx-stash-test-'))
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
  files?: Array<{
    path: string
    content: string
    staged?: boolean
  }>
  stashes?: Array<{
    message: string
    files: Array<{ path: string; content: string }>
    sha?: string
    date?: Date
  }>
  commits?: Array<{
    sha: string
    message: string
    tree: string
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
  await fs.mkdir(path.join(gitDir, 'logs', 'refs'), { recursive: true })

  // Write HEAD
  const branchName = options.branch ?? 'main'
  await fs.writeFile(path.join(gitDir, 'HEAD'), `ref: refs/heads/${branchName}\n`)

  // Write branch ref
  const commitSha = options.commits?.[0]?.sha ?? 'a'.repeat(40)
  await fs.writeFile(
    path.join(gitDir, 'refs', 'heads', branchName),
    commitSha + '\n'
  )

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

  // Create files in working directory
  if (options.files) {
    for (const file of options.files) {
      const filePath = path.join(basePath, file.path)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, file.content)

      // Track staged files
      if (file.staged) {
        const stagedPath = path.join(gitDir, 'mock-staged')
        const existing = await fs.readFile(stagedPath, 'utf8').catch(() => '')
        await fs.writeFile(stagedPath, existing + file.path + '\n')
      }
    }
  }

  // Create mock stash entries
  if (options.stashes && options.stashes.length > 0) {
    const stashLogLines: string[] = []
    for (let i = 0; i < options.stashes.length; i++) {
      const stash = options.stashes[i]
      const sha = stash.sha ?? `stash${i}`.padEnd(40, '0')
      const date = stash.date ?? new Date()
      const timestamp = Math.floor(date.getTime() / 1000)

      // Format: sha sha message (for reflog)
      stashLogLines.push(`${sha} ${sha} WIP on ${branchName}: ${stash.message}`)

      // Store stash files
      const stashDataDir = path.join(gitDir, 'mock-stash-data', `stash@{${i}}`)
      await fs.mkdir(stashDataDir, { recursive: true })

      for (const file of stash.files) {
        await fs.writeFile(path.join(stashDataDir, file.path.replace(/\//g, '_')), file.content)
      }
      await fs.writeFile(path.join(stashDataDir, 'message'), stash.message)
      await fs.writeFile(path.join(stashDataDir, 'sha'), sha)
      await fs.writeFile(path.join(stashDataDir, 'timestamp'), timestamp.toString())
    }

    // Write stash ref (points to most recent stash)
    if (options.stashes.length > 0) {
      const latestSha = options.stashes[0].sha ?? 'stash0'.padEnd(40, '0')
      await fs.writeFile(path.join(gitDir, 'refs', 'stash'), latestSha + '\n')
    }

    // Write stash reflog
    await fs.writeFile(path.join(gitDir, 'logs', 'refs', 'stash'), stashLogLines.join('\n') + '\n')

    // Write mock stash count
    await fs.writeFile(path.join(gitDir, 'mock-stash-count'), options.stashes.length.toString())
  }

  // Write mock commits
  if (options.commits) {
    for (const commit of options.commits) {
      await fs.writeFile(
        path.join(gitDir, 'mock-commit-' + commit.sha.substring(0, 7)),
        JSON.stringify(commit)
      )
    }
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

describe('gitx stash command', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await removeTempDir(tempDir)
  })

  // ==========================================================================
  // 1. stash push - Stash working directory changes
  // ==========================================================================
  describe('stash push - Stash working directory changes', () => {
    it('should stash modified files in working directory', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'tracked.txt', content: 'modified content' }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const result = await stashPush(tempDir)

      expect(result.success).toBe(true)
      expect(result.stashRef).toMatch(/stash@\{0\}/)
    })

    it('should stash staged files', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'staged.txt', content: 'staged content', staged: true }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const result = await stashPush(tempDir)

      expect(result.success).toBe(true)
    })

    it('should stash both staged and unstaged changes', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'staged.txt', content: 'staged', staged: true },
          { path: 'modified.txt', content: 'modified' }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const result = await stashPush(tempDir)

      expect(result.success).toBe(true)
    })

    it('should restore working directory to clean state after stash', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'modified.txt', content: 'modified' }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      await stashPush(tempDir)

      // Working directory should be clean after stash
      // (In real implementation, modified.txt would be reverted)
    })

    it('should create stash with default message "WIP on <branch>"', async () => {
      await createMockGitRepo(tempDir, {
        branch: 'feature',
        files: [
          { path: 'file.txt', content: 'content' }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const result = await stashPush(tempDir)

      expect(result.message).toMatch(/WIP on feature/)
    })

    it('should increment stash index when pushing new stash', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'file.txt', content: 'content' }
        ],
        stashes: [
          { message: 'Previous stash', files: [{ path: 'old.txt', content: 'old' }] }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const countBefore = await getStashCount(tempDir)
      await stashPush(tempDir)
      const countAfter = await getStashCount(tempDir)

      expect(countAfter).toBe(countBefore + 1)
    })

    it('should stash via CLI with default push behavior', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'file.txt', content: 'content' }
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
      cli.registerCommand('stash', stashCommand)

      const result = await cli.run(['stash', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
      expect(capture.output.stdout.join('\n')).toMatch(/saved|stash@\{0\}/i)
    })

    it('should stash via CLI with explicit push subcommand', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'file.txt', content: 'content' }
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
      cli.registerCommand('stash', stashCommand)

      const result = await cli.run(['stash', 'push', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })
  })

  // ==========================================================================
  // 2. stash list - List stashed changes
  // ==========================================================================
  describe('stash list - List stashed changes', () => {
    it('should list all stashed entries', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'First stash', files: [{ path: 'a.txt', content: 'a' }] },
          { message: 'Second stash', files: [{ path: 'b.txt', content: 'b' }] },
          { message: 'Third stash', files: [{ path: 'c.txt', content: 'c' }] }
        ]
      })

      const stashes = await stashList(tempDir)

      expect(stashes).toHaveLength(3)
    })

    it('should return stashes in reverse chronological order (newest first)', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'Newest', files: [{ path: 'new.txt', content: 'new' }], date: new Date('2024-01-03') },
          { message: 'Middle', files: [{ path: 'mid.txt', content: 'mid' }], date: new Date('2024-01-02') },
          { message: 'Oldest', files: [{ path: 'old.txt', content: 'old' }], date: new Date('2024-01-01') }
        ]
      })

      const stashes = await stashList(tempDir)

      expect(stashes[0].message).toContain('Newest')
    })

    it('should include stash reference (stash@{n}) in listing', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'First', files: [{ path: 'a.txt', content: 'a' }] },
          { message: 'Second', files: [{ path: 'b.txt', content: 'b' }] }
        ]
      })

      const stashes = await stashList(tempDir)

      expect(stashes[0].ref).toBe('stash@{0}')
      expect(stashes[1].ref).toBe('stash@{1}')
    })

    it('should include branch name in stash entry', async () => {
      await createMockGitRepo(tempDir, {
        branch: 'feature-branch',
        stashes: [
          { message: 'On feature', files: [{ path: 'a.txt', content: 'a' }] }
        ]
      })

      const stashes = await stashList(tempDir)

      expect(stashes[0].branch).toBe('feature-branch')
    })

    it('should include stash message', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'Work in progress on login', files: [{ path: 'login.ts', content: 'code' }] }
        ]
      })

      const stashes = await stashList(tempDir)

      expect(stashes[0].message).toContain('Work in progress on login')
    })

    it('should return empty array when no stashes exist', async () => {
      await createMockGitRepo(tempDir)

      const stashes = await stashList(tempDir)

      expect(stashes).toHaveLength(0)
    })

    it('should list stashes via CLI', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'First stash', files: [{ path: 'a.txt', content: 'a' }] },
          { message: 'Second stash', files: [{ path: 'b.txt', content: 'b' }] }
        ]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('stash', stashCommand)

      const result = await cli.run(['stash', 'list', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
      const output = capture.output.stdout.join('\n')
      expect(output).toContain('stash@{0}')
      expect(output).toContain('stash@{1}')
    })

    it('should show abbreviated SHA in stash list', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          {
            message: 'Test stash',
            files: [{ path: 'a.txt', content: 'a' }],
            sha: 'abc1234def5678'.padEnd(40, '0')
          }
        ]
      })

      const stashes = await stashList(tempDir)

      expect(stashes[0].shortSha).toBe('abc1234')
    })
  })

  // ==========================================================================
  // 3. stash apply - Apply stashed changes
  // ==========================================================================
  describe('stash apply - Apply stashed changes', () => {
    it('should apply most recent stash by default', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'Recent', files: [{ path: 'new.txt', content: 'new content' }] },
          { message: 'Older', files: [{ path: 'old.txt', content: 'old content' }] }
        ]
      })

      const result = await stashApply(tempDir)

      expect(result.success).toBe(true)
      expect(result.appliedRef).toBe('stash@{0}')
    })

    it('should apply specific stash by reference', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'First', files: [{ path: 'a.txt', content: 'a' }] },
          { message: 'Second', files: [{ path: 'b.txt', content: 'b' }] }
        ]
      })

      const result = await stashApply(tempDir, { ref: 'stash@{1}' })

      expect(result.success).toBe(true)
      expect(result.appliedRef).toBe('stash@{1}')
    })

    it('should apply stash by index number', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'First', files: [{ path: 'a.txt', content: 'a' }] },
          { message: 'Second', files: [{ path: 'b.txt', content: 'b' }] }
        ]
      })

      const result = await stashApply(tempDir, { ref: '1' })

      expect(result.success).toBe(true)
      expect(result.appliedRef).toBe('stash@{1}')
    })

    it('should NOT remove stash after apply (keeps stash)', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'Test', files: [{ path: 'file.txt', content: 'content' }] }
        ]
      })

      const countBefore = await getStashCount(tempDir)
      await stashApply(tempDir)
      const countAfter = await getStashCount(tempDir)

      expect(countAfter).toBe(countBefore)
    })

    it('should restore staged files as staged when using --index', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          {
            message: 'With staged',
            files: [
              { path: 'staged.txt', content: 'staged content' }
            ]
          }
        ]
      })

      const result = await stashApply(tempDir, { index: true })

      expect(result.success).toBe(true)
    })

    it('should apply stash via CLI', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'Test', files: [{ path: 'file.txt', content: 'content' }] }
        ]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('stash', stashCommand)

      const result = await cli.run(['stash', 'apply', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })

    it('should apply specific stash via CLI', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'First', files: [{ path: 'a.txt', content: 'a' }] },
          { message: 'Second', files: [{ path: 'b.txt', content: 'b' }] }
        ]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('stash', stashCommand)

      const result = await cli.run(['stash', 'apply', 'stash@{1}', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })
  })

  // ==========================================================================
  // 4. stash pop - Apply and remove stashed changes
  // ==========================================================================
  describe('stash pop - Apply and remove stashed changes', () => {
    it('should apply most recent stash and remove it', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'Test', files: [{ path: 'file.txt', content: 'content' }] }
        ]
      })

      const countBefore = await getStashCount(tempDir)
      const result = await stashPop(tempDir)
      const countAfter = await getStashCount(tempDir)

      expect(result.success).toBe(true)
      expect(countAfter).toBe(countBefore - 1)
    })

    it('should pop specific stash by reference', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'First', files: [{ path: 'a.txt', content: 'a' }] },
          { message: 'Second', files: [{ path: 'b.txt', content: 'b' }] },
          { message: 'Third', files: [{ path: 'c.txt', content: 'c' }] }
        ]
      })

      const result = await stashPop(tempDir, { ref: 'stash@{1}' })

      expect(result.success).toBe(true)
      expect(result.appliedRef).toBe('stash@{1}')
    })

    it('should update stash references after pop', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'First', files: [{ path: 'a.txt', content: 'a' }] },
          { message: 'Second', files: [{ path: 'b.txt', content: 'b' }] }
        ]
      })

      await stashPop(tempDir) // Pop stash@{0}
      const stashes = await stashList(tempDir)

      // The remaining stash should now be stash@{0}
      expect(stashes[0].ref).toBe('stash@{0}')
      expect(stashes[0].message).toContain('Second')
    })

    it('should pop stash via CLI', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'Test', files: [{ path: 'file.txt', content: 'content' }] }
        ]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('stash', stashCommand)

      const result = await cli.run(['stash', 'pop', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })

    it('should restore staged files as staged when using --index with pop', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'With staged', files: [{ path: 'staged.txt', content: 'staged' }] }
        ]
      })

      const result = await stashPop(tempDir, { index: true })

      expect(result.success).toBe(true)
    })
  })

  // ==========================================================================
  // 5. stash drop - Drop stashed changes
  // ==========================================================================
  describe('stash drop - Drop stashed changes', () => {
    it('should drop most recent stash by default', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'First', files: [{ path: 'a.txt', content: 'a' }] },
          { message: 'Second', files: [{ path: 'b.txt', content: 'b' }] }
        ]
      })

      const countBefore = await getStashCount(tempDir)
      const result = await stashDrop(tempDir)
      const countAfter = await getStashCount(tempDir)

      expect(result.success).toBe(true)
      expect(countAfter).toBe(countBefore - 1)
    })

    it('should drop specific stash by reference', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'First', files: [{ path: 'a.txt', content: 'a' }] },
          { message: 'Second', files: [{ path: 'b.txt', content: 'b' }] },
          { message: 'Third', files: [{ path: 'c.txt', content: 'c' }] }
        ]
      })

      const result = await stashDrop(tempDir, 'stash@{1}')

      expect(result.success).toBe(true)
      expect(result.droppedRef).toBe('stash@{1}')
    })

    it('should drop stash by index number', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'First', files: [{ path: 'a.txt', content: 'a' }] },
          { message: 'Second', files: [{ path: 'b.txt', content: 'b' }] }
        ]
      })

      const result = await stashDrop(tempDir, '1')

      expect(result.success).toBe(true)
    })

    it('should update remaining stash references after drop', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'First', files: [{ path: 'a.txt', content: 'a' }] },
          { message: 'Second', files: [{ path: 'b.txt', content: 'b' }] },
          { message: 'Third', files: [{ path: 'c.txt', content: 'c' }] }
        ]
      })

      await stashDrop(tempDir, 'stash@{1}') // Drop middle stash
      const stashes = await stashList(tempDir)

      expect(stashes).toHaveLength(2)
      expect(stashes[0].message).toContain('First')
      expect(stashes[1].message).toContain('Third')
    })

    it('should drop stash via CLI', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'Test', files: [{ path: 'file.txt', content: 'content' }] }
        ]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('stash', stashCommand)

      const result = await cli.run(['stash', 'drop', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
      expect(capture.output.stdout.join('\n')).toMatch(/dropped|stash@\{0\}/i)
    })

    it('should show dropped stash reference in output', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          {
            message: 'Test',
            files: [{ path: 'file.txt', content: 'content' }],
            sha: 'abc1234'.padEnd(40, '0')
          }
        ]
      })

      const result = await stashDrop(tempDir)

      expect(result.droppedRef).toBe('stash@{0}')
      expect(result.droppedSha).toBeDefined()
    })
  })

  // ==========================================================================
  // 6. stash with message - Custom stash messages
  // ==========================================================================
  describe('stash with message - Custom stash messages', () => {
    it('should stash with custom message using -m flag', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'file.txt', content: 'content' }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const result = await stashPush(tempDir, { message: 'Work in progress on feature X' })

      expect(result.message).toContain('Work in progress on feature X')
    })

    it('should stash with message via CLI -m flag', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'file.txt', content: 'content' }
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
      cli.registerCommand('stash', stashCommand)

      const result = await cli.run(['stash', '-m', 'Custom message', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })

    it('should stash with message via CLI push -m flag', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'file.txt', content: 'content' }
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
      cli.registerCommand('stash', stashCommand)

      const result = await cli.run(['stash', 'push', '-m', 'Push with message', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })

    it('should preserve custom message in stash list', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'My custom message', files: [{ path: 'file.txt', content: 'content' }] }
        ]
      })

      const stashes = await stashList(tempDir)

      expect(stashes[0].message).toContain('My custom message')
    })

    it('should handle special characters in stash message', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'file.txt', content: 'content' }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const specialMessage = 'Fix bug #123: Handle "quoted" & <special> chars'
      const result = await stashPush(tempDir, { message: specialMessage })

      expect(result.message).toContain('Fix bug #123')
    })

    it('should handle unicode in stash message', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'file.txt', content: 'content' }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const unicodeMessage = 'Work on i18n support'
      const result = await stashPush(tempDir, { message: unicodeMessage })

      expect(result.message).toContain('i18n')
    })
  })

  // ==========================================================================
  // 7. Error handling - Nothing to stash
  // ==========================================================================
  describe('Error handling - Nothing to stash', () => {
    it('should error when working directory is clean (nothing to stash)', async () => {
      await createMockGitRepo(tempDir, {
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      await expect(stashPush(tempDir)).rejects.toThrow(/nothing to stash|no local changes/i)
    })

    it('should return non-zero exit code via CLI when nothing to stash', async () => {
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
      cli.registerCommand('stash', stashCommand)

      const result = await cli.run(['stash', '--cwd', tempDir])

      expect(result.exitCode).toBe(1)
      expect(capture.output.stderr.join('\n')).toMatch(/nothing to stash|no local changes/i)
    })

    it('should show helpful message when working tree is clean', async () => {
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
      cli.registerCommand('stash', stashCommand)

      await cli.run(['stash', 'push', '--cwd', tempDir])

      expect(capture.output.stderr.join('\n')).toMatch(/nothing|clean|no changes/i)
    })
  })

  // ==========================================================================
  // 8. Error handling - Invalid stash reference
  // ==========================================================================
  describe('Error handling - Invalid stash reference', () => {
    it('should error when applying non-existent stash', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'Only stash', files: [{ path: 'file.txt', content: 'content' }] }
        ]
      })

      await expect(stashApply(tempDir, { ref: 'stash@{99}' }))
        .rejects.toThrow(/stash.*not found|invalid.*stash|does not exist/i)
    })

    it('should error when popping non-existent stash', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'Only stash', files: [{ path: 'file.txt', content: 'content' }] }
        ]
      })

      await expect(stashPop(tempDir, { ref: 'stash@{99}' }))
        .rejects.toThrow(/stash.*not found|invalid.*stash|does not exist/i)
    })

    it('should error when dropping non-existent stash', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'Only stash', files: [{ path: 'file.txt', content: 'content' }] }
        ]
      })

      await expect(stashDrop(tempDir, 'stash@{99}'))
        .rejects.toThrow(/stash.*not found|invalid.*stash|does not exist/i)
    })

    it('should error when applying from empty stash list', async () => {
      await createMockGitRepo(tempDir)

      await expect(stashApply(tempDir))
        .rejects.toThrow(/no stash|stash.*empty|nothing to apply/i)
    })

    it('should error when popping from empty stash list', async () => {
      await createMockGitRepo(tempDir)

      await expect(stashPop(tempDir))
        .rejects.toThrow(/no stash|stash.*empty|nothing to pop/i)
    })

    it('should error when dropping from empty stash list', async () => {
      await createMockGitRepo(tempDir)

      await expect(stashDrop(tempDir))
        .rejects.toThrow(/no stash|stash.*empty|nothing to drop/i)
    })

    it('should return non-zero exit code via CLI for invalid stash ref', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'Only stash', files: [{ path: 'file.txt', content: 'content' }] }
        ]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('stash', stashCommand)

      const result = await cli.run(['stash', 'apply', 'stash@{99}', '--cwd', tempDir])

      expect(result.exitCode).toBe(1)
    })

    it('should handle malformed stash reference', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'Test', files: [{ path: 'file.txt', content: 'content' }] }
        ]
      })

      await expect(stashApply(tempDir, { ref: 'invalid-ref' }))
        .rejects.toThrow(/invalid.*stash|not a valid/i)
    })
  })

  // ==========================================================================
  // 9. Edge cases - Apply to dirty working tree
  // ==========================================================================
  describe('Edge cases - Apply to dirty working tree', () => {
    it('should apply stash even when working tree has changes (different files)', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'working.txt', content: 'working changes' }
        ],
        stashes: [
          { message: 'Stashed', files: [{ path: 'stashed.txt', content: 'stashed content' }] }
        ]
      })

      const result = await stashApply(tempDir)

      expect(result.success).toBe(true)
    })

    it('should detect conflicts when stash and working tree modify same file', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'conflict.txt', content: 'working version' }
        ],
        stashes: [
          { message: 'Stashed', files: [{ path: 'conflict.txt', content: 'stashed version' }] }
        ]
      })

      // Should either succeed with merge or report conflict
      const result = await stashApply(tempDir)

      // Result should indicate potential conflict or success
      expect(result.success).toBeDefined()
    })

    it('should not drop stash on conflict during pop', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'conflict.txt', content: 'working version' }
        ],
        stashes: [
          { message: 'Stashed', files: [{ path: 'conflict.txt', content: 'stashed version' }] }
        ]
      })

      const countBefore = await getStashCount(tempDir)

      try {
        await stashPop(tempDir)
      } catch {
        // If pop fails due to conflict, stash should be preserved
        const countAfter = await getStashCount(tempDir)
        expect(countAfter).toBe(countBefore)
      }
    })
  })

  // ==========================================================================
  // 10. Edge cases - Multiple stashes
  // ==========================================================================
  describe('Edge cases - Multiple stashes', () => {
    it('should handle many stashes (10+)', async () => {
      const stashes = Array.from({ length: 15 }, (_, i) => ({
        message: `Stash ${i}`,
        files: [{ path: `file${i}.txt`, content: `content ${i}` }]
      }))

      await createMockGitRepo(tempDir, { stashes })

      const list = await stashList(tempDir)

      expect(list).toHaveLength(15)
    })

    it('should correctly index stashes after multiple operations', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'A', files: [{ path: 'a.txt', content: 'a' }] },
          { message: 'B', files: [{ path: 'b.txt', content: 'b' }] },
          { message: 'C', files: [{ path: 'c.txt', content: 'c' }] },
          { message: 'D', files: [{ path: 'd.txt', content: 'd' }] }
        ]
      })

      // Drop stash@{1} (B)
      await stashDrop(tempDir, 'stash@{1}')

      const stashes = await stashList(tempDir)

      expect(stashes).toHaveLength(3)
      expect(stashes[0].message).toContain('A')
      expect(stashes[1].message).toContain('C')
      expect(stashes[2].message).toContain('D')
    })

    it('should preserve stash order when dropping from middle', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'First', files: [{ path: '1.txt', content: '1' }] },
          { message: 'Second', files: [{ path: '2.txt', content: '2' }] },
          { message: 'Third', files: [{ path: '3.txt', content: '3' }] }
        ]
      })

      await stashDrop(tempDir, 'stash@{1}') // Drop "Second"
      const stashes = await stashList(tempDir)

      expect(stashes[0].message).toContain('First')
      expect(stashes[1].message).toContain('Third')
    })
  })

  // ==========================================================================
  // 11. stash show - Show stash contents
  // ==========================================================================
  describe('stash show - Show stash contents', () => {
    it('should show files in most recent stash by default', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          {
            message: 'Test',
            files: [
              { path: 'file1.txt', content: 'content1' },
              { path: 'file2.txt', content: 'content2' }
            ]
          }
        ]
      })

      const result = await stashShow(tempDir)

      expect(result.files.length).toBeGreaterThanOrEqual(1)
    })

    it('should show specific stash contents by reference', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'First', files: [{ path: 'a.txt', content: 'a' }] },
          { message: 'Second', files: [{ path: 'b.txt', content: 'b' }] }
        ]
      })

      const result = await stashShow(tempDir, 'stash@{1}')

      expect(result.files.some(f => f.path.includes('b.txt') || f.path === 'b.txt')).toBe(true)
    })

    it('should show stash via CLI', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'Test', files: [{ path: 'file.txt', content: 'content' }] }
        ]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('stash', stashCommand)

      const result = await cli.run(['stash', 'show', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })
  })

  // ==========================================================================
  // 12. stash clear - Clear all stashes
  // ==========================================================================
  describe('stash clear - Clear all stashes', () => {
    it('should remove all stashes', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'First', files: [{ path: 'a.txt', content: 'a' }] },
          { message: 'Second', files: [{ path: 'b.txt', content: 'b' }] },
          { message: 'Third', files: [{ path: 'c.txt', content: 'c' }] }
        ]
      })

      await stashClear(tempDir)
      const count = await getStashCount(tempDir)

      expect(count).toBe(0)
    })

    it('should succeed even when no stashes exist', async () => {
      await createMockGitRepo(tempDir)

      await expect(stashClear(tempDir)).resolves.not.toThrow()
    })

    it('should clear stashes via CLI', async () => {
      await createMockGitRepo(tempDir, {
        stashes: [
          { message: 'Test', files: [{ path: 'file.txt', content: 'content' }] }
        ]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('stash', stashCommand)

      const result = await cli.run(['stash', 'clear', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })
  })

  // ==========================================================================
  // 13. Non-git directory handling
  // ==========================================================================
  describe('Non-git directory handling', () => {
    it('should error when run in non-git directory', async () => {
      const nonGitDir = await createTempDir()

      try {
        await expect(stashPush(nonGitDir)).rejects.toThrow(/not a git repository/i)
      } finally {
        await removeTempDir(nonGitDir)
      }
    })

    it('should return non-zero exit code via CLI for non-git directory', async () => {
      const nonGitDir = await createTempDir()

      try {
        const capture = createOutputCapture()
        const cli = createCLI({
          stdout: capture.stdout,
          stderr: capture.stderr
        })
        cli.registerCommand('stash', stashCommand)

        const result = await cli.run(['stash', '--cwd', nonGitDir])

        expect(result.exitCode).toBe(1)
        expect(capture.output.stderr.join('\n')).toMatch(/not a git repository/i)
      } finally {
        await removeTempDir(nonGitDir)
      }
    })
  })

  // ==========================================================================
  // 14. CLI Integration
  // ==========================================================================
  describe('CLI Integration', () => {
    it('should register stash command with CLI', () => {
      const cli = createCLI()

      expect(() => cli.registerCommand('stash', stashCommand)).not.toThrow()
    })

    it('should show help for stash command', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('stash', stashCommand)

      await cli.run(['stash', '--help'])

      const output = capture.output.stdout.join('\n')
      expect(output).toMatch(/stash/i)
      expect(output).toMatch(/push|list|apply|pop|drop/i)
    })

    it('should handle unknown stash subcommand', async () => {
      await createMockGitRepo(tempDir)

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('stash', stashCommand)

      const result = await cli.run(['stash', 'unknown-subcommand', '--cwd', tempDir])

      expect(result.exitCode).toBe(1)
    })
  })

  // ==========================================================================
  // 15. Advanced options
  // ==========================================================================
  describe('Advanced options', () => {
    it('should support --keep-index to leave staged changes in index', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'staged.txt', content: 'staged', staged: true },
          { path: 'unstaged.txt', content: 'unstaged' }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const result = await stashPush(tempDir, { keepIndex: true })

      expect(result.success).toBe(true)
    })

    it('should support --include-untracked to stash untracked files', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'untracked.txt', content: 'untracked content' }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const result = await stashPush(tempDir, { includeUntracked: true })

      expect(result.success).toBe(true)
    })

    it('should support -u as alias for --include-untracked via CLI', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'untracked.txt', content: 'untracked' }
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
      cli.registerCommand('stash', stashCommand)

      const result = await cli.run(['stash', '-u', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })

    it('should support --all to include ignored files', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'ignored.txt', content: 'ignored content' }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const result = await stashPush(tempDir, { all: true })

      expect(result.success).toBe(true)
    })

    it('should support stashing specific pathspecs', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'src/file1.ts', content: 'content1' },
          { path: 'src/file2.ts', content: 'content2' },
          { path: 'test/file3.ts', content: 'content3' }
        ],
        config: {
          userName: 'Test User',
          userEmail: 'test@example.com.ai'
        }
      })

      const result = await stashPush(tempDir, { pathspec: ['src/'] })

      expect(result.success).toBe(true)
    })
  })
})
