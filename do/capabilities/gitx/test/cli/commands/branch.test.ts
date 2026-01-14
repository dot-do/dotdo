/**
 * gitx branch command tests
 *
 * RED phase tests for the branch command implementation.
 * These tests verify branch listing, creation, deletion, and management.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import {
  branchCommand,
  listBranches,
  createBranch,
  deleteBranch,
  renameBranch,
  getBranchesWithUpstream,
  type BranchInfo,
  type BranchListOptions
} from '../../../src/cli/commands/branch'
import { createCLI } from '../../../src/cli/index'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a temporary directory for testing
 */
async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'gitx-branch-test-'))
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
  branches?: Array<{
    name: string
    sha: string
    isCurrent?: boolean
    upstream?: { remote: string; branch: string; ahead?: number; behind?: number }
  }>
  detached?: boolean
  currentSha?: string
} = {}): Promise<string> {
  const gitDir = path.join(basePath, '.git')

  // Create basic git structure
  await fs.mkdir(gitDir, { recursive: true })
  await fs.mkdir(path.join(gitDir, 'objects'), { recursive: true })
  await fs.mkdir(path.join(gitDir, 'refs', 'heads'), { recursive: true })
  await fs.mkdir(path.join(gitDir, 'refs', 'remotes', 'origin'), { recursive: true })

  const branches = options.branches ?? [{ name: 'main', sha: 'a'.repeat(40), isCurrent: true }]
  const currentBranch = branches.find(b => b.isCurrent) ?? branches[0]

  // Write HEAD
  if (options.detached) {
    await fs.writeFile(path.join(gitDir, 'HEAD'), (options.currentSha ?? 'a'.repeat(40)) + '\n')
  } else {
    await fs.writeFile(path.join(gitDir, 'HEAD'), `ref: refs/heads/${currentBranch.name}\n`)
  }

  // Write branch refs
  for (const branch of branches) {
    const branchRefPath = path.join(gitDir, 'refs', 'heads', branch.name)
    // Create parent directories for branches with slashes (e.g., feature/my-feature)
    await fs.mkdir(path.dirname(branchRefPath), { recursive: true })
    await fs.writeFile(branchRefPath, branch.sha + '\n')
  }

  // Write config with upstream tracking
  let config = `[core]
\trepositoryformatversion = 0
\tfilemode = true
\tbare = false
`

  for (const branch of branches) {
    if (branch.upstream) {
      config += `[remote "${branch.upstream.remote}"]
\turl = https://github.com/example/repo.git
\tfetch = +refs/heads/*:refs/remotes/${branch.upstream.remote}/*
[branch "${branch.name}"]
\tremote = ${branch.upstream.remote}
\tmerge = refs/heads/${branch.upstream.branch}
`
      // Write remote tracking ref
      await fs.writeFile(
        path.join(gitDir, 'refs', 'remotes', branch.upstream.remote, branch.upstream.branch),
        'b'.repeat(40) + '\n'
      )

      // Write mock ahead/behind file if specified
      if (branch.upstream.ahead !== undefined || branch.upstream.behind !== undefined) {
        const ahead = branch.upstream.ahead ?? 0
        const behind = branch.upstream.behind ?? 0
        await fs.writeFile(
          path.join(gitDir, `mock-ahead-behind-${branch.name}`),
          `ahead=${ahead} behind=${behind}`
        )
      }
    }
  }

  await fs.writeFile(path.join(gitDir, 'config'), config)

  // Create a valid commit object for branch creation tests
  const commitSha = currentBranch.sha
  const objDir = path.join(gitDir, 'objects', commitSha.substring(0, 2))
  await fs.mkdir(objDir, { recursive: true })

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

describe('gitx branch command', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await removeTempDir(tempDir)
  })

  // ==========================================================================
  // 1. Lists all branches with current branch indicator (*)
  // ==========================================================================
  describe('Lists all branches with current branch indicator', () => {
    it('should list all local branches', async () => {
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40), isCurrent: true },
          { name: 'feature', sha: 'b'.repeat(40) },
          { name: 'develop', sha: 'c'.repeat(40) }
        ]
      })

      const branches = await listBranches(tempDir)

      expect(branches).toHaveLength(3)
      expect(branches.map(b => b.name)).toContain('main')
      expect(branches.map(b => b.name)).toContain('feature')
      expect(branches.map(b => b.name)).toContain('develop')
    })

    it('should mark current branch with asterisk (*)', async () => {
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40), isCurrent: true }
        ]
      })

      const branches = await listBranches(tempDir)
      const currentBranch = branches.find(b => b.isCurrent)

      expect(currentBranch).toBeDefined()
      expect(currentBranch!.name).toBe('feature')
    })

    it('should format output with asterisk prefix for current branch', async () => {
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40), isCurrent: true },
          { name: 'other', sha: 'b'.repeat(40) }
        ]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('branch', branchCommand)

      await cli.run(['branch', '--cwd', tempDir])

      const output = capture.output.stdout.join('\n')
      expect(output).toMatch(/\*\s+main/)
      expect(output).toMatch(/\s+other/)
      expect(output).not.toMatch(/\*\s+other/)
    })

    it('should sort branches alphabetically', async () => {
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'zebra', sha: 'a'.repeat(40) },
          { name: 'alpha', sha: 'b'.repeat(40), isCurrent: true },
          { name: 'middle', sha: 'c'.repeat(40) }
        ]
      })

      const branches = await listBranches(tempDir)
      const names = branches.map(b => b.name)

      expect(names).toEqual(['alpha', 'middle', 'zebra'])
    })

    it('should handle single branch repository', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{ name: 'main', sha: 'a'.repeat(40), isCurrent: true }]
      })

      const branches = await listBranches(tempDir)

      expect(branches).toHaveLength(1)
      expect(branches[0].name).toBe('main')
      expect(branches[0].isCurrent).toBe(true)
    })
  })

  // ==========================================================================
  // 2. Creates new branch from HEAD
  // ==========================================================================
  describe('Creates new branch from HEAD', () => {
    it('should create a new branch pointing to HEAD', async () => {
      const headSha = 'a'.repeat(40)
      await createMockGitRepo(tempDir, {
        branches: [{ name: 'main', sha: headSha, isCurrent: true }]
      })

      await createBranch(tempDir, 'feature-branch')

      const branches = await listBranches(tempDir)
      const newBranch = branches.find(b => b.name === 'feature-branch')

      expect(newBranch).toBeDefined()
      expect(newBranch!.sha).toBe(headSha)
    })

    it('should not switch to the new branch', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{ name: 'main', sha: 'a'.repeat(40), isCurrent: true }]
      })

      await createBranch(tempDir, 'new-branch')

      const branches = await listBranches(tempDir)
      const currentBranch = branches.find(b => b.isCurrent)

      expect(currentBranch!.name).toBe('main')
    })

    it('should throw error if branch already exists', async () => {
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40), isCurrent: true },
          { name: 'existing', sha: 'b'.repeat(40) }
        ]
      })

      await expect(createBranch(tempDir, 'existing')).rejects.toThrow(/already exists/i)
    })

    it('should create branch via CLI', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{ name: 'main', sha: 'a'.repeat(40), isCurrent: true }]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('branch', branchCommand)

      const result = await cli.run(['branch', 'new-feature', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)

      const branches = await listBranches(tempDir)
      expect(branches.map(b => b.name)).toContain('new-feature')
    })
  })

  // ==========================================================================
  // 3. Creates new branch from specific commit
  // ==========================================================================
  describe('Creates new branch from specific commit', () => {
    it('should create branch at specified commit SHA', async () => {
      const targetSha = 'c'.repeat(40)
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40), isCurrent: true },
          { name: 'old', sha: targetSha }
        ]
      })

      await createBranch(tempDir, 'from-commit', targetSha)

      const branches = await listBranches(tempDir)
      const newBranch = branches.find(b => b.name === 'from-commit')

      expect(newBranch).toBeDefined()
      expect(newBranch!.sha).toBe(targetSha)
    })

    it('should create branch from short SHA', async () => {
      const fullSha = 'abcd123'.padEnd(40, '0')
      await createMockGitRepo(tempDir, {
        branches: [{ name: 'main', sha: fullSha, isCurrent: true }]
      })

      await createBranch(tempDir, 'from-short', 'abcd123')

      const branches = await listBranches(tempDir)
      const newBranch = branches.find(b => b.name === 'from-short')

      expect(newBranch).toBeDefined()
    })

    it('should throw error for invalid commit reference', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{ name: 'main', sha: 'a'.repeat(40), isCurrent: true }]
      })

      await expect(createBranch(tempDir, 'bad-branch', 'nonexistent')).rejects.toThrow()
    })

    it('should create branch from another branch name', async () => {
      const targetSha = 'b'.repeat(40)
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40), isCurrent: true },
          { name: 'source', sha: targetSha }
        ]
      })

      await createBranch(tempDir, 'from-branch', 'source')

      const branches = await listBranches(tempDir)
      const newBranch = branches.find(b => b.name === 'from-branch')

      expect(newBranch).toBeDefined()
      expect(newBranch!.sha).toBe(targetSha)
    })
  })

  // ==========================================================================
  // 4. Deletes branch with -d flag
  // ==========================================================================
  describe('Deletes branch with -d flag', () => {
    it('should delete a fully merged branch', async () => {
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40), isCurrent: true },
          { name: 'merged-feature', sha: 'a'.repeat(40) } // Same SHA = merged
        ]
      })

      await deleteBranch(tempDir, 'merged-feature', { force: false })

      const branches = await listBranches(tempDir)
      expect(branches.map(b => b.name)).not.toContain('merged-feature')
    })

    it('should refuse to delete unmerged branch with -d', async () => {
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40), isCurrent: true },
          { name: 'unmerged', sha: 'b'.repeat(40) }
        ]
      })

      await expect(deleteBranch(tempDir, 'unmerged', { force: false }))
        .rejects.toThrow(/not fully merged/i)
    })

    it('should delete branch via CLI with -d flag', async () => {
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40), isCurrent: true },
          { name: 'to-delete', sha: 'a'.repeat(40) }
        ]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('branch', branchCommand)

      const result = await cli.run(['branch', '-d', 'to-delete', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)

      const branches = await listBranches(tempDir)
      expect(branches.map(b => b.name)).not.toContain('to-delete')
    })

    it('should show deletion confirmation message', async () => {
      const sha = 'a'.repeat(40)
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha, isCurrent: true },
          { name: 'deleted-branch', sha }
        ]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('branch', branchCommand)

      await cli.run(['branch', '-d', 'deleted-branch', '--cwd', tempDir])

      const output = capture.output.stdout.join('\n')
      expect(output).toMatch(/deleted.*deleted-branch/i)
    })

    it('should throw error for non-existent branch', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{ name: 'main', sha: 'a'.repeat(40), isCurrent: true }]
      })

      await expect(deleteBranch(tempDir, 'nonexistent', { force: false }))
        .rejects.toThrow(/not found/i)
    })
  })

  // ==========================================================================
  // 5. Force deletes unmerged branch with -D flag
  // ==========================================================================
  describe('Force deletes unmerged branch with -D flag', () => {
    it('should force delete unmerged branch', async () => {
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40), isCurrent: true },
          { name: 'unmerged', sha: 'b'.repeat(40) }
        ]
      })

      await deleteBranch(tempDir, 'unmerged', { force: true })

      const branches = await listBranches(tempDir)
      expect(branches.map(b => b.name)).not.toContain('unmerged')
    })

    it('should delete via CLI with -D flag', async () => {
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40), isCurrent: true },
          { name: 'force-delete', sha: 'b'.repeat(40) }
        ]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('branch', branchCommand)

      const result = await cli.run(['branch', '-D', 'force-delete', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })

    it('should show warning when force deleting', async () => {
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40), isCurrent: true },
          { name: 'unmerged', sha: 'b'.repeat(40) }
        ]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('branch', branchCommand)

      await cli.run(['branch', '-D', 'unmerged', '--cwd', tempDir])

      const output = capture.output.stdout.join('\n')
      expect(output).toMatch(/deleted.*unmerged/i)
    })
  })

  // ==========================================================================
  // 6. Renames branch with -m flag
  // ==========================================================================
  describe('Renames branch with -m flag', () => {
    it('should rename a branch', async () => {
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40), isCurrent: true },
          { name: 'old-name', sha: 'b'.repeat(40) }
        ]
      })

      await renameBranch(tempDir, 'old-name', 'new-name')

      const branches = await listBranches(tempDir)
      expect(branches.map(b => b.name)).not.toContain('old-name')
      expect(branches.map(b => b.name)).toContain('new-name')
    })

    it('should preserve branch SHA after rename', async () => {
      const branchSha = 'b'.repeat(40)
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40), isCurrent: true },
          { name: 'original', sha: branchSha }
        ]
      })

      await renameBranch(tempDir, 'original', 'renamed')

      const branches = await listBranches(tempDir)
      const renamedBranch = branches.find(b => b.name === 'renamed')

      expect(renamedBranch!.sha).toBe(branchSha)
    })

    it('should rename current branch', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{ name: 'old-main', sha: 'a'.repeat(40), isCurrent: true }]
      })

      await renameBranch(tempDir, 'old-main', 'new-main')

      const branches = await listBranches(tempDir)
      const currentBranch = branches.find(b => b.isCurrent)

      expect(currentBranch!.name).toBe('new-main')
    })

    it('should throw error if new name already exists', async () => {
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40), isCurrent: true },
          { name: 'feature', sha: 'b'.repeat(40) },
          { name: 'existing', sha: 'c'.repeat(40) }
        ]
      })

      await expect(renameBranch(tempDir, 'feature', 'existing'))
        .rejects.toThrow(/already exists/i)
    })

    it('should rename via CLI with -m flag', async () => {
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40), isCurrent: true },
          { name: 'to-rename', sha: 'b'.repeat(40) }
        ]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('branch', branchCommand)

      const result = await cli.run(['branch', '-m', 'to-rename', 'renamed', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)

      const branches = await listBranches(tempDir)
      expect(branches.map(b => b.name)).toContain('renamed')
    })

    it('should throw error if source branch does not exist', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{ name: 'main', sha: 'a'.repeat(40), isCurrent: true }]
      })

      await expect(renameBranch(tempDir, 'nonexistent', 'new-name'))
        .rejects.toThrow(/not found/i)
    })
  })

  // ==========================================================================
  // 7. Shows upstream tracking info with -vv flag
  // ==========================================================================
  describe('Shows upstream tracking info with -vv flag', () => {
    it('should show upstream branch name', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{
          name: 'main',
          sha: 'a'.repeat(40),
          isCurrent: true,
          upstream: { remote: 'origin', branch: 'main' }
        }]
      })

      const branches = await getBranchesWithUpstream(tempDir)
      const main = branches.find(b => b.name === 'main')

      expect(main!.upstream).toBe('origin/main')
    })

    it('should show ahead/behind counts', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{
          name: 'main',
          sha: 'a'.repeat(40),
          isCurrent: true,
          upstream: { remote: 'origin', branch: 'main', ahead: 3, behind: 2 }
        }]
      })

      const branches = await getBranchesWithUpstream(tempDir)
      const main = branches.find(b => b.name === 'main')

      expect(main!.ahead).toBe(3)
      expect(main!.behind).toBe(2)
    })

    it('should format verbose output correctly', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{
          name: 'main',
          sha: 'a'.repeat(40),
          isCurrent: true,
          upstream: { remote: 'origin', branch: 'main', ahead: 1, behind: 0 }
        }]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('branch', branchCommand)

      await cli.run(['branch', '-vv', '--cwd', tempDir])

      const output = capture.output.stdout.join('\n')
      expect(output).toContain('origin/main')
      expect(output).toMatch(/ahead\s+1|ahead 1|\[ahead 1\]/i)
    })

    it('should show commit SHA in verbose mode', async () => {
      const sha = 'abc1234'.padEnd(40, '0')
      await createMockGitRepo(tempDir, {
        branches: [{
          name: 'main',
          sha,
          isCurrent: true,
          upstream: { remote: 'origin', branch: 'main' }
        }]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('branch', branchCommand)

      await cli.run(['branch', '-vv', '--cwd', tempDir])

      const output = capture.output.stdout.join('\n')
      expect(output).toContain('abc1234')
    })

    it('should indicate "gone" when upstream is deleted', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{
          name: 'orphan',
          sha: 'a'.repeat(40),
          isCurrent: true,
          upstream: { remote: 'origin', branch: 'deleted-upstream' }
        }]
      })
      // Remove the upstream ref to simulate deleted remote branch
      await fs.rm(path.join(tempDir, '.git', 'refs', 'remotes', 'origin', 'deleted-upstream'))

      const branches = await getBranchesWithUpstream(tempDir)
      const orphan = branches.find(b => b.name === 'orphan')

      expect(orphan!.upstreamGone).toBe(true)
    })
  })

  // ==========================================================================
  // 8. Handles invalid branch names
  // ==========================================================================
  describe('Handles invalid branch names', () => {
    it('should reject branch names starting with dash', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{ name: 'main', sha: 'a'.repeat(40), isCurrent: true }]
      })

      await expect(createBranch(tempDir, '-invalid'))
        .rejects.toThrow(/invalid.*branch.*name/i)
    })

    it('should reject branch names with double dots', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{ name: 'main', sha: 'a'.repeat(40), isCurrent: true }]
      })

      await expect(createBranch(tempDir, 'invalid..name'))
        .rejects.toThrow(/invalid.*branch.*name/i)
    })

    it('should reject branch names ending with .lock', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{ name: 'main', sha: 'a'.repeat(40), isCurrent: true }]
      })

      await expect(createBranch(tempDir, 'branch.lock'))
        .rejects.toThrow(/invalid.*branch.*name/i)
    })

    it('should reject branch names with spaces', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{ name: 'main', sha: 'a'.repeat(40), isCurrent: true }]
      })

      await expect(createBranch(tempDir, 'invalid name'))
        .rejects.toThrow(/invalid.*branch.*name/i)
    })

    it('should reject branch names with control characters', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{ name: 'main', sha: 'a'.repeat(40), isCurrent: true }]
      })

      await expect(createBranch(tempDir, 'invalid\x00name'))
        .rejects.toThrow(/invalid.*branch.*name/i)
    })

    it('should reject branch names with tilde', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{ name: 'main', sha: 'a'.repeat(40), isCurrent: true }]
      })

      await expect(createBranch(tempDir, 'invalid~name'))
        .rejects.toThrow(/invalid.*branch.*name/i)
    })

    it('should reject branch names with caret', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{ name: 'main', sha: 'a'.repeat(40), isCurrent: true }]
      })

      await expect(createBranch(tempDir, 'invalid^name'))
        .rejects.toThrow(/invalid.*branch.*name/i)
    })

    it('should reject branch names with colon', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{ name: 'main', sha: 'a'.repeat(40), isCurrent: true }]
      })

      await expect(createBranch(tempDir, 'invalid:name'))
        .rejects.toThrow(/invalid.*branch.*name/i)
    })

    it('should accept valid branch names with slashes', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{ name: 'main', sha: 'a'.repeat(40), isCurrent: true }]
      })

      await createBranch(tempDir, 'feature/new-feature')

      const branches = await listBranches(tempDir)
      expect(branches.map(b => b.name)).toContain('feature/new-feature')
    })
  })

  // ==========================================================================
  // 9. Prevents deleting current branch
  // ==========================================================================
  describe('Prevents deleting current branch', () => {
    it('should throw error when trying to delete current branch', async () => {
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40), isCurrent: true },
          { name: 'other', sha: 'b'.repeat(40) }
        ]
      })

      await expect(deleteBranch(tempDir, 'main', { force: false }))
        .rejects.toThrow(/cannot delete.*checked out/i)
    })

    it('should throw error even with force flag', async () => {
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40), isCurrent: true },
          { name: 'other', sha: 'b'.repeat(40) }
        ]
      })

      await expect(deleteBranch(tempDir, 'main', { force: true }))
        .rejects.toThrow(/cannot delete.*checked out/i)
    })

    it('should show appropriate error message via CLI', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{ name: 'main', sha: 'a'.repeat(40), isCurrent: true }]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('branch', branchCommand)

      const result = await cli.run(['branch', '-d', 'main', '--cwd', tempDir])

      expect(result.exitCode).toBe(1)
      expect(capture.output.stderr.join('\n')).toMatch(/cannot delete.*checked out/i)
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================
  describe('Edge Cases', () => {
    it('should handle non-git directory', async () => {
      const nonGitDir = await createTempDir()

      try {
        await expect(listBranches(nonGitDir)).rejects.toThrow(/not a git repository/i)
      } finally {
        await removeTempDir(nonGitDir)
      }
    })

    it('should handle detached HEAD state', async () => {
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'other', sha: 'b'.repeat(40) }
        ],
        detached: true,
        currentSha: 'c'.repeat(40)
      })

      const branches = await listBranches(tempDir)

      // No branch should be marked as current in detached HEAD state
      expect(branches.every(b => !b.isCurrent)).toBe(true)
    })

    it('should handle branch with slash in name', async () => {
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40), isCurrent: true },
          { name: 'feature/my-feature', sha: 'b'.repeat(40) }
        ]
      })

      const branches = await listBranches(tempDir)
      expect(branches.map(b => b.name)).toContain('feature/my-feature')
    })

    it('should handle empty branch list argument', async () => {
      await createMockGitRepo(tempDir, {
        branches: [{ name: 'main', sha: 'a'.repeat(40), isCurrent: true }]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('branch', branchCommand)

      // Just 'branch' with no args should list branches
      const result = await cli.run(['branch', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
      expect(capture.output.stdout.join('\n')).toContain('main')
    })
  })

  // ==========================================================================
  // CLI Integration
  // ==========================================================================
  describe('CLI Integration', () => {
    it('should register branch command with CLI', () => {
      const cli = createCLI()
      cli.registerCommand('branch', branchCommand)

      expect(() => cli.registerCommand('branch', branchCommand)).not.toThrow()
    })

    it('should handle --list flag explicitly', async () => {
      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40), isCurrent: true },
          { name: 'feature', sha: 'b'.repeat(40) }
        ]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('branch', branchCommand)

      await cli.run(['branch', '--list', '--cwd', tempDir])

      const output = capture.output.stdout.join('\n')
      expect(output).toContain('main')
      expect(output).toContain('feature')
    })

    it('should handle -v flag for verbose output', async () => {
      const sha = 'abc1234'.padEnd(40, '0')
      await createMockGitRepo(tempDir, {
        branches: [{ name: 'main', sha, isCurrent: true }]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('branch', branchCommand)

      await cli.run(['branch', '-v', '--cwd', tempDir])

      const output = capture.output.stdout.join('\n')
      expect(output).toContain('abc1234')
    })
  })
})
