/**
 * gitx status command tests
 *
 * RED phase tests for the status command implementation.
 * These tests verify the status command output and behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import {
  statusCommand,
  getStatus,
  getBranchInfo,
  formatStatusLong,
  formatStatusShort,
  formatBranchOnly,
  type StatusResult,
  type BranchInfo,
  type FileStatus
} from '../../../src/cli/commands/status'
import { createCLI } from '../../../src/cli/index'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a temporary directory for testing
 */
async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'gitx-status-test-'))
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
  upstream?: { remote: string; branch: string; ahead?: number; behind?: number }
  files?: Array<{
    path: string
    status: { index: string; workingTree: string }
    origPath?: string
  }>
  detached?: boolean
} = {}): Promise<string> {
  const gitDir = path.join(basePath, '.git')

  // Create basic git structure
  await fs.mkdir(gitDir, { recursive: true })
  await fs.mkdir(path.join(gitDir, 'objects'), { recursive: true })
  await fs.mkdir(path.join(gitDir, 'refs', 'heads'), { recursive: true })
  await fs.mkdir(path.join(gitDir, 'refs', 'remotes', 'origin'), { recursive: true })

  // Write HEAD
  const branchName = options.branch ?? 'main'
  if (options.detached) {
    await fs.writeFile(path.join(gitDir, 'HEAD'), 'a'.repeat(40) + '\n')
  } else {
    await fs.writeFile(path.join(gitDir, 'HEAD'), `ref: refs/heads/${branchName}\n`)
  }

  // Write branch ref
  await fs.writeFile(
    path.join(gitDir, 'refs', 'heads', branchName),
    'a'.repeat(40) + '\n'
  )

  // Write config with upstream tracking
  let config = `[core]
\trepositoryformatversion = 0
\tfilemode = true
\tbare = false
`

  if (options.upstream) {
    config += `[remote "${options.upstream.remote}"]
\turl = https://github.com/example/repo.git
\tfetch = +refs/heads/*:refs/remotes/${options.upstream.remote}/*
[branch "${branchName}"]
\tremote = ${options.upstream.remote}
\tmerge = refs/heads/${options.upstream.branch}
`
    // Write remote tracking ref
    await fs.writeFile(
      path.join(gitDir, 'refs', 'remotes', options.upstream.remote, options.upstream.branch),
      'b'.repeat(40) + '\n'
    )
  }

  await fs.writeFile(path.join(gitDir, 'config'), config)

  // Write mock status file if files are specified
  if (options.files && options.files.length > 0) {
    const statusLines = options.files.map(f => {
      const line = `${f.status.index}${f.status.workingTree} ${f.path}`
      // For renamed files, origPath is the old name, path is the new name
      return f.origPath ? `${f.status.index}${f.status.workingTree} ${f.origPath} -> ${f.path}` : line
    })
    await fs.writeFile(path.join(gitDir, 'mock-status'), statusLines.join('\n'))
  }

  // Write mock ahead/behind file if specified
  if (options.upstream && (options.upstream.ahead !== undefined || options.upstream.behind !== undefined)) {
    const ahead = options.upstream.ahead ?? 0
    const behind = options.upstream.behind ?? 0
    await fs.writeFile(path.join(gitDir, 'mock-ahead-behind'), `ahead=${ahead} behind=${behind}`)
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

describe('gitx status command', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await removeTempDir(tempDir)
  })

  // ==========================================================================
  // 1. Shows untracked files (files not in index)
  // ==========================================================================
  describe('Shows untracked files', () => {
    it('should list files that are not in the index', async () => {
      await createMockGitRepo(tempDir)
      // Create an untracked file in working directory
      await fs.writeFile(path.join(tempDir, 'untracked.txt'), 'content')

      const result = await getStatus(tempDir)

      expect(result.files.some(f => f.path === 'untracked.txt' && f.workingTree === '?')).toBe(true)
    })

    it('should show untracked files with ?? prefix in short format', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'new-file.js'), 'console.log("hello")')

      const result = await getStatus(tempDir)
      const output = formatStatusShort(result)

      expect(output).toContain('?? new-file.js')
    })

    it('should show "Untracked files:" section in long format', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'untracked.txt'), 'content')

      const result = await getStatus(tempDir)
      const output = formatStatusLong(result)

      expect(output).toContain('Untracked files:')
      expect(output).toContain('untracked.txt')
    })

    it('should handle multiple untracked files', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file1.txt'), 'content1')
      await fs.writeFile(path.join(tempDir, 'file2.txt'), 'content2')
      await fs.writeFile(path.join(tempDir, 'file3.txt'), 'content3')

      const result = await getStatus(tempDir)
      const untrackedFiles = result.files.filter(f => f.workingTree === '?')

      expect(untrackedFiles.length).toBe(3)
    })

    it('should handle untracked files in subdirectories', async () => {
      await createMockGitRepo(tempDir)
      await fs.mkdir(path.join(tempDir, 'src'), { recursive: true })
      await fs.writeFile(path.join(tempDir, 'src', 'index.ts'), 'export {}')

      const result = await getStatus(tempDir)

      expect(result.files.some(f => f.path === 'src/index.ts' || f.path === 'src/')).toBe(true)
    })
  })

  // ==========================================================================
  // 2. Shows modified files (working tree differs from index)
  // ==========================================================================
  describe('Shows modified files', () => {
    it('should detect files modified in working tree but not staged', async () => {
      await createMockGitRepo(tempDir, {
        files: [{ path: 'README.md', status: { index: ' ', workingTree: 'M' } }]
      })

      const result = await getStatus(tempDir)

      expect(result.files.some(f => f.path === 'README.md' && f.workingTree === 'M')).toBe(true)
    })

    it('should show modified files with M prefix in short format', async () => {
      await createMockGitRepo(tempDir, {
        files: [{ path: 'app.js', status: { index: ' ', workingTree: 'M' } }]
      })

      const result = await getStatus(tempDir)
      const output = formatStatusShort(result)

      expect(output).toContain(' M app.js')
    })

    it('should show "Changes not staged for commit:" section in long format', async () => {
      await createMockGitRepo(tempDir, {
        files: [{ path: 'modified.txt', status: { index: ' ', workingTree: 'M' } }]
      })

      const result = await getStatus(tempDir)
      const output = formatStatusLong(result)

      expect(output).toContain('Changes not staged for commit:')
      expect(output).toContain('modified:')
      expect(output).toContain('modified.txt')
    })

    it('should distinguish between index modified and working tree modified', async () => {
      await createMockGitRepo(tempDir, {
        files: [{ path: 'both.js', status: { index: 'M', workingTree: 'M' } }]
      })

      const result = await getStatus(tempDir)
      const file = result.files.find(f => f.path === 'both.js')

      expect(file).toBeDefined()
      expect(file!.index).toBe('M')
      expect(file!.workingTree).toBe('M')
    })
  })

  // ==========================================================================
  // 3. Shows staged files (index differs from HEAD)
  // ==========================================================================
  describe('Shows staged files', () => {
    it('should detect files staged for commit (added to index)', async () => {
      await createMockGitRepo(tempDir, {
        files: [{ path: 'staged.ts', status: { index: 'A', workingTree: ' ' } }]
      })

      const result = await getStatus(tempDir)

      expect(result.files.some(f => f.path === 'staged.ts' && f.index === 'A')).toBe(true)
    })

    it('should show staged files with index status in short format', async () => {
      await createMockGitRepo(tempDir, {
        files: [{ path: 'new.ts', status: { index: 'A', workingTree: ' ' } }]
      })

      const result = await getStatus(tempDir)
      const output = formatStatusShort(result)

      expect(output).toContain('A  new.ts')
    })

    it('should show "Changes to be committed:" section in long format', async () => {
      await createMockGitRepo(tempDir, {
        files: [{ path: 'staged.ts', status: { index: 'A', workingTree: ' ' } }]
      })

      const result = await getStatus(tempDir)
      const output = formatStatusLong(result)

      expect(output).toContain('Changes to be committed:')
      expect(output).toContain('new file:')
      expect(output).toContain('staged.ts')
    })

    it('should show staged modifications correctly', async () => {
      await createMockGitRepo(tempDir, {
        files: [{ path: 'updated.js', status: { index: 'M', workingTree: ' ' } }]
      })

      const result = await getStatus(tempDir)
      const output = formatStatusLong(result)

      expect(output).toContain('Changes to be committed:')
      expect(output).toContain('modified:')
    })
  })

  // ==========================================================================
  // 4. Shows deleted files
  // ==========================================================================
  describe('Shows deleted files', () => {
    it('should detect files deleted from working tree', async () => {
      await createMockGitRepo(tempDir, {
        files: [{ path: 'removed.txt', status: { index: ' ', workingTree: 'D' } }]
      })

      const result = await getStatus(tempDir)

      expect(result.files.some(f => f.path === 'removed.txt' && f.workingTree === 'D')).toBe(true)
    })

    it('should detect files staged for deletion', async () => {
      await createMockGitRepo(tempDir, {
        files: [{ path: 'to-delete.txt', status: { index: 'D', workingTree: ' ' } }]
      })

      const result = await getStatus(tempDir)

      expect(result.files.some(f => f.path === 'to-delete.txt' && f.index === 'D')).toBe(true)
    })

    it('should show deleted files with D prefix in short format', async () => {
      await createMockGitRepo(tempDir, {
        files: [{ path: 'deleted.js', status: { index: 'D', workingTree: ' ' } }]
      })

      const result = await getStatus(tempDir)
      const output = formatStatusShort(result)

      expect(output).toContain('D  deleted.js')
    })

    it('should show "deleted:" in long format for deleted files', async () => {
      await createMockGitRepo(tempDir, {
        files: [{ path: 'removed.md', status: { index: 'D', workingTree: ' ' } }]
      })

      const result = await getStatus(tempDir)
      const output = formatStatusLong(result)

      expect(output).toContain('deleted:')
      expect(output).toContain('removed.md')
    })
  })

  // ==========================================================================
  // 5. Shows renamed files
  // ==========================================================================
  describe('Shows renamed files', () => {
    it('should detect renamed files in staging area', async () => {
      await createMockGitRepo(tempDir, {
        files: [{
          path: 'new-name.ts',
          status: { index: 'R', workingTree: ' ' },
          origPath: 'old-name.ts'
        }]
      })

      const result = await getStatus(tempDir)
      const renamed = result.files.find(f => f.index === 'R')

      expect(renamed).toBeDefined()
      expect(renamed!.origPath).toBe('old-name.ts')
      expect(renamed!.path).toBe('new-name.ts')
    })

    it('should show renamed files with R prefix and arrow in short format', async () => {
      await createMockGitRepo(tempDir, {
        files: [{
          path: 'renamed.ts',
          status: { index: 'R', workingTree: ' ' },
          origPath: 'original.ts'
        }]
      })

      const result = await getStatus(tempDir)
      const output = formatStatusShort(result)

      expect(output).toContain('R  original.ts -> renamed.ts')
    })

    it('should show "renamed:" in long format with both names', async () => {
      await createMockGitRepo(tempDir, {
        files: [{
          path: 'new.js',
          status: { index: 'R', workingTree: ' ' },
          origPath: 'old.js'
        }]
      })

      const result = await getStatus(tempDir)
      const output = formatStatusLong(result)

      expect(output).toContain('renamed:')
      expect(output).toContain('old.js')
      expect(output).toContain('new.js')
    })

    it('should handle renamed and modified files', async () => {
      await createMockGitRepo(tempDir, {
        files: [{
          path: 'new-modified.ts',
          status: { index: 'R', workingTree: 'M' },
          origPath: 'old.ts'
        }]
      })

      const result = await getStatus(tempDir)
      const file = result.files.find(f => f.path === 'new-modified.ts')

      expect(file).toBeDefined()
      expect(file!.index).toBe('R')
      expect(file!.workingTree).toBe('M')
    })
  })

  // ==========================================================================
  // 6. Shows branch name and tracking info
  // ==========================================================================
  describe('Shows branch name and tracking info', () => {
    it('should show current branch name', async () => {
      await createMockGitRepo(tempDir, { branch: 'feature-branch' })

      const branchInfo = await getBranchInfo(tempDir)

      expect(branchInfo.name).toBe('feature-branch')
    })

    it('should show upstream branch if configured', async () => {
      await createMockGitRepo(tempDir, {
        branch: 'main',
        upstream: { remote: 'origin', branch: 'main' }
      })

      const branchInfo = await getBranchInfo(tempDir)

      expect(branchInfo.upstream).toBe('origin/main')
    })

    it('should include branch info in long format output', async () => {
      await createMockGitRepo(tempDir, { branch: 'develop' })

      const result = await getStatus(tempDir)
      const output = formatStatusLong(result)

      expect(output).toContain('On branch develop')
    })

    it('should show detached HEAD state', async () => {
      await createMockGitRepo(tempDir, { detached: true })

      const branchInfo = await getBranchInfo(tempDir)

      expect(branchInfo.detached).toBe(true)
    })

    it('should format detached HEAD correctly in output', async () => {
      await createMockGitRepo(tempDir, { detached: true })

      const result = await getStatus(tempDir)
      const output = formatStatusLong(result)

      expect(output).toMatch(/HEAD detached|detached HEAD/)
    })
  })

  // ==========================================================================
  // 7. Shows "nothing to commit, working tree clean" when clean
  // ==========================================================================
  describe('Shows clean working tree message', () => {
    it('should indicate when working tree is clean', async () => {
      await createMockGitRepo(tempDir)

      const result = await getStatus(tempDir)

      expect(result.isClean).toBe(true)
    })

    it('should show "nothing to commit, working tree clean" in long format', async () => {
      await createMockGitRepo(tempDir)

      const result = await getStatus(tempDir)
      const output = formatStatusLong(result)

      expect(output).toContain('nothing to commit')
      expect(output).toContain('working tree clean')
    })

    it('should produce empty file list in short format when clean', async () => {
      await createMockGitRepo(tempDir)

      const result = await getStatus(tempDir)
      const output = formatStatusShort(result)

      // Short format with no files should be empty or just branch line
      expect(result.files.length).toBe(0)
    })

    it('should not be clean when there are staged changes', async () => {
      await createMockGitRepo(tempDir, {
        files: [{ path: 'staged.txt', status: { index: 'A', workingTree: ' ' } }]
      })

      const result = await getStatus(tempDir)

      expect(result.isClean).toBe(false)
    })

    it('should not be clean when there are unstaged changes', async () => {
      await createMockGitRepo(tempDir, {
        files: [{ path: 'modified.txt', status: { index: ' ', workingTree: 'M' } }]
      })

      const result = await getStatus(tempDir)

      expect(result.isClean).toBe(false)
    })
  })

  // ==========================================================================
  // 8. Handles non-git directory error
  // ==========================================================================
  describe('Handles non-git directory error', () => {
    it('should throw error when run in non-git directory', async () => {
      // tempDir without .git initialization
      const nonGitDir = await createTempDir()

      try {
        await expect(getStatus(nonGitDir)).rejects.toThrow()
      } finally {
        await removeTempDir(nonGitDir)
      }
    })

    it('should include helpful error message for non-git directory', async () => {
      const nonGitDir = await createTempDir()

      try {
        await expect(getStatus(nonGitDir)).rejects.toThrow(/not a git repository|fatal/i)
      } finally {
        await removeTempDir(nonGitDir)
      }
    })

    it('should return non-zero exit code via CLI for non-git directory', async () => {
      const nonGitDir = await createTempDir()
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('status', statusCommand)

      try {
        const result = await cli.run(['status', '--cwd', nonGitDir])

        expect(result.exitCode).toBe(1)
        expect(capture.output.stderr.join('\n')).toMatch(/not a git repository|error/i)
      } finally {
        await removeTempDir(nonGitDir)
      }
    })

    it('should handle missing .git directory gracefully', async () => {
      await fs.mkdir(tempDir, { recursive: true })
      // No .git directory created

      await expect(getStatus(tempDir)).rejects.toThrow()
    })
  })

  // ==========================================================================
  // 9. Supports --short flag for compact output
  // ==========================================================================
  describe('Supports --short flag', () => {
    it('should produce compact output with --short flag', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'modified.txt', status: { index: 'M', workingTree: ' ' } },
          { path: 'new.txt', status: { index: 'A', workingTree: ' ' } }
        ]
      })

      const result = await getStatus(tempDir)
      const shortOutput = formatStatusShort(result)
      const longOutput = formatStatusLong(result)

      expect(shortOutput.length).toBeLessThan(longOutput.length)
    })

    it('should use XY format for file status in short output', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'staged-modified.js', status: { index: 'M', workingTree: 'M' } }
        ]
      })

      const result = await getStatus(tempDir)
      const output = formatStatusShort(result)

      // Format: XY filename where X=index status, Y=working tree status
      expect(output).toMatch(/MM\s+staged-modified\.js/)
    })

    it('should handle --short flag via CLI', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'untracked.txt'), 'content')

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('status', statusCommand)

      await cli.run(['status', '--short', '--cwd', tempDir])

      // Short output should not contain verbose headers
      const output = capture.output.stdout.join('\n')
      expect(output).not.toContain('Changes to be committed:')
      expect(output).not.toContain('Changes not staged for commit:')
    })

    it('should list one file per line in short format', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'file1.txt', status: { index: 'A', workingTree: ' ' } },
          { path: 'file2.txt', status: { index: 'M', workingTree: ' ' } },
          { path: 'file3.txt', status: { index: ' ', workingTree: 'M' } }
        ]
      })

      const result = await getStatus(tempDir)
      const output = formatStatusShort(result)
      const lines = output.trim().split('\n').filter(l => l.length > 0)

      expect(lines.length).toBe(3)
    })
  })

  // ==========================================================================
  // 10. Supports --branch flag to show only branch info
  // ==========================================================================
  describe('Supports --branch flag', () => {
    it('should show only branch info with --branch flag', async () => {
      await createMockGitRepo(tempDir, { branch: 'feature-x' })

      const branchInfo = await getBranchInfo(tempDir)
      const output = formatBranchOnly(branchInfo)

      expect(output).toContain('feature-x')
    })

    it('should show tracking branch info with --branch flag', async () => {
      await createMockGitRepo(tempDir, {
        branch: 'main',
        upstream: { remote: 'origin', branch: 'main' }
      })

      const branchInfo = await getBranchInfo(tempDir)
      const output = formatBranchOnly(branchInfo)

      expect(output).toContain('origin/main')
    })

    it('should use ## prefix in short format with --branch', async () => {
      await createMockGitRepo(tempDir, { branch: 'develop' })

      const branchInfo = await getBranchInfo(tempDir)
      const output = formatBranchOnly(branchInfo)

      expect(output).toMatch(/^##/)
    })

    it('should handle --branch flag via CLI', async () => {
      await createMockGitRepo(tempDir, { branch: 'test-branch' })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('status', statusCommand)

      await cli.run(['status', '--branch', '--cwd', tempDir])

      const output = capture.output.stdout.join('\n')
      expect(output).toContain('test-branch')
    })

    it('should show only branch line when combined with --short', async () => {
      await createMockGitRepo(tempDir, { branch: 'main' })

      const branchInfo = await getBranchInfo(tempDir)
      const output = formatBranchOnly(branchInfo)
      const lines = output.trim().split('\n')

      expect(lines.length).toBe(1)
    })
  })

  // ==========================================================================
  // 11. Shows ahead/behind count for tracking branch
  // ==========================================================================
  describe('Shows ahead/behind count', () => {
    it('should show ahead count when local is ahead of remote', async () => {
      await createMockGitRepo(tempDir, {
        branch: 'main',
        upstream: { remote: 'origin', branch: 'main', ahead: 3, behind: 0 }
      })

      const branchInfo = await getBranchInfo(tempDir)

      expect(branchInfo.ahead).toBe(3)
    })

    it('should show behind count when local is behind remote', async () => {
      await createMockGitRepo(tempDir, {
        branch: 'main',
        upstream: { remote: 'origin', branch: 'main', ahead: 0, behind: 5 }
      })

      const branchInfo = await getBranchInfo(tempDir)

      expect(branchInfo.behind).toBe(5)
    })

    it('should show both ahead and behind when diverged', async () => {
      await createMockGitRepo(tempDir, {
        branch: 'main',
        upstream: { remote: 'origin', branch: 'main', ahead: 2, behind: 4 }
      })

      const branchInfo = await getBranchInfo(tempDir)

      expect(branchInfo.ahead).toBe(2)
      expect(branchInfo.behind).toBe(4)
    })

    it('should format ahead count in long output', async () => {
      await createMockGitRepo(tempDir, {
        branch: 'main',
        upstream: { remote: 'origin', branch: 'main', ahead: 3, behind: 0 }
      })

      const result = await getStatus(tempDir)
      const output = formatStatusLong(result)

      expect(output).toMatch(/ahead.*3|3.*ahead/i)
    })

    it('should format behind count in long output', async () => {
      await createMockGitRepo(tempDir, {
        branch: 'main',
        upstream: { remote: 'origin', branch: 'main', ahead: 0, behind: 2 }
      })

      const result = await getStatus(tempDir)
      const output = formatStatusLong(result)

      expect(output).toMatch(/behind.*2|2.*behind/i)
    })

    it('should format ahead/behind in short branch output', async () => {
      await createMockGitRepo(tempDir, {
        branch: 'main',
        upstream: { remote: 'origin', branch: 'main', ahead: 1, behind: 2 }
      })

      const branchInfo = await getBranchInfo(tempDir)
      const output = formatBranchOnly(branchInfo)

      // Format: ## branch...origin/branch [ahead 1, behind 2]
      expect(output).toMatch(/\[ahead\s+1.*behind\s+2\]|\[.*\+1.*-2.*\]/i)
    })

    it('should show "up to date" when no ahead/behind', async () => {
      await createMockGitRepo(tempDir, {
        branch: 'main',
        upstream: { remote: 'origin', branch: 'main', ahead: 0, behind: 0 }
      })

      const result = await getStatus(tempDir)
      const output = formatStatusLong(result)

      expect(output).toMatch(/up.to.date|up-to-date/i)
    })

    it('should handle no upstream configured', async () => {
      await createMockGitRepo(tempDir, { branch: 'local-only' })

      const branchInfo = await getBranchInfo(tempDir)

      expect(branchInfo.upstream).toBeUndefined()
      expect(branchInfo.ahead).toBeUndefined()
      expect(branchInfo.behind).toBeUndefined()
    })
  })

  // ==========================================================================
  // Integration Tests
  // ==========================================================================
  describe('CLI Integration', () => {
    it('should register status command with CLI', async () => {
      const cli = createCLI()
      cli.registerCommand('status', statusCommand)

      // Should not throw
      expect(() => cli.registerCommand('status', statusCommand)).not.toThrow()
    })

    it('should handle status command with working directory', async () => {
      await createMockGitRepo(tempDir)

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('status', statusCommand)

      const result = await cli.run(['status', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })

    it('should combine --short and --branch flags', async () => {
      await createMockGitRepo(tempDir, {
        branch: 'main',
        upstream: { remote: 'origin', branch: 'main' }
      })
      await fs.writeFile(path.join(tempDir, 'new.txt'), 'content')

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('status', statusCommand)

      await cli.run(['status', '--short', '--branch', '--cwd', tempDir])

      const output = capture.output.stdout.join('\n')
      expect(output).toMatch(/^##/) // Branch line
      expect(output).toContain('??') // Untracked file indicator
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================
  describe('Edge Cases', () => {
    it('should handle empty repository (no commits)', async () => {
      await createMockGitRepo(tempDir)
      // New repo with no commits

      const result = await getStatus(tempDir)

      expect(result.branch.name).toBeDefined()
    })

    it('should handle special characters in filenames', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'file with spaces.txt'), 'content')

      const result = await getStatus(tempDir)

      expect(result.files.some(f => f.path.includes('spaces'))).toBe(true)
    })

    it('should handle deeply nested files', async () => {
      await createMockGitRepo(tempDir)
      await fs.mkdir(path.join(tempDir, 'a', 'b', 'c', 'd'), { recursive: true })
      await fs.writeFile(path.join(tempDir, 'a', 'b', 'c', 'd', 'deep.txt'), 'content')

      const result = await getStatus(tempDir)

      expect(result.files.some(f => f.path.includes('deep.txt') || f.path.includes('a/'))).toBe(true)
    })

    it('should handle binary files', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'binary.bin'), Buffer.from([0x00, 0xff, 0x00, 0xff]))

      const result = await getStatus(tempDir)

      expect(result.files.some(f => f.path === 'binary.bin')).toBe(true)
    })

    it('should handle symbolic links', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, 'target.txt'), 'content')
      try {
        await fs.symlink(
          path.join(tempDir, 'target.txt'),
          path.join(tempDir, 'link.txt')
        )

        const result = await getStatus(tempDir)

        // Should show symlink as untracked or follow depending on config
        expect(result.files.length).toBeGreaterThanOrEqual(1)
      } catch {
        // Symlinks may not be supported on all systems, skip test
      }
    })

    it('should sort files alphabetically in output', async () => {
      await createMockGitRepo(tempDir, {
        files: [
          { path: 'zebra.txt', status: { index: 'A', workingTree: ' ' } },
          { path: 'alpha.txt', status: { index: 'A', workingTree: ' ' } },
          { path: 'middle.txt', status: { index: 'A', workingTree: ' ' } }
        ]
      })

      const result = await getStatus(tempDir)
      const paths = result.files.map(f => f.path)

      expect(paths).toEqual([...paths].sort())
    })
  })
})
