/**
 * gitx merge command tests
 *
 * RED phase tests for the merge command implementation.
 * These tests verify the merge command handles branch merging with various
 * strategies including fast-forward, 3-way merge, squash, and conflict handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import {
  mergeCommand,
  mergeBranches,
  canFastForward,
  getMergeStatus,
  abortMerge,
  continueMerge,
  type MergeOptions,
  type MergeResult,
  type MergeStatus
} from '../../src/cli/commands/merge'
import { createCLI } from '../../src/cli/index'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a temporary directory for testing
 */
async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'gitx-merge-test-'))
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
 * Create a mock git repository for testing merge scenarios
 */
async function createMockGitRepo(basePath: string, options: {
  currentBranch?: string
  branches?: Array<{
    name: string
    sha: string
    commits?: string[]
  }>
  detached?: boolean
  currentSha?: string
  mergeState?: {
    mergeHead: string
    origHead: string
    message: string
    conflicts?: Array<{ path: string; oursContent: string; theirsContent: string }>
  }
  uncommittedChanges?: Array<{ path: string; content: string }>
  stagedFiles?: Array<{ path: string; sha: string }>
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
  await fs.mkdir(path.join(gitDir, 'refs', 'remotes', 'origin'), { recursive: true })

  const branches = options.branches ?? [
    { name: 'main', sha: 'a'.repeat(40), commits: ['initial'] }
  ]
  const currentBranch = options.currentBranch ?? branches[0]?.name ?? 'main'

  // Write HEAD
  if (options.detached && options.currentSha) {
    await fs.writeFile(path.join(gitDir, 'HEAD'), options.currentSha + '\n')
  } else {
    await fs.writeFile(path.join(gitDir, 'HEAD'), `ref: refs/heads/${currentBranch}\n`)
  }

  // Write branch refs
  for (const branch of branches) {
    const branchRefPath = path.join(gitDir, 'refs', 'heads', branch.name)
    await fs.mkdir(path.dirname(branchRefPath), { recursive: true })
    await fs.writeFile(branchRefPath, branch.sha + '\n')
  }

  // Write config
  let config = `[core]
\trepositoryformatversion = 0
\tfilemode = true
\tbare = false
`
  if (options.config?.userName || options.config?.userEmail) {
    config += `[user]\n`
    if (options.config?.userName) {
      config += `\tname = ${options.config.userName}\n`
    }
    if (options.config?.userEmail) {
      config += `\temail = ${options.config.userEmail}\n`
    }
  }
  await fs.writeFile(path.join(gitDir, 'config'), config)

  // Write merge state if provided (for testing conflict scenarios)
  if (options.mergeState) {
    await fs.writeFile(path.join(gitDir, 'MERGE_HEAD'), options.mergeState.mergeHead + '\n')
    await fs.writeFile(path.join(gitDir, 'ORIG_HEAD'), options.mergeState.origHead + '\n')
    await fs.writeFile(path.join(gitDir, 'MERGE_MSG'), options.mergeState.message + '\n')

    // Write conflicted files if provided
    if (options.mergeState.conflicts) {
      for (const conflict of options.mergeState.conflicts) {
        const conflictedContent = `<<<<<<< HEAD
${conflict.oursContent}
=======
${conflict.theirsContent}
>>>>>>> ${options.mergeState.mergeHead.substring(0, 7)}`
        await fs.writeFile(path.join(basePath, conflict.path), conflictedContent)
      }
    }
  }

  // Write uncommitted changes if provided
  if (options.uncommittedChanges) {
    for (const change of options.uncommittedChanges) {
      const filePath = path.join(basePath, change.path)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, change.content)
    }
  }

  // Write staged files info (mock index)
  if (options.stagedFiles && options.stagedFiles.length > 0) {
    const stagedData = options.stagedFiles.map(f => f.sha + ' ' + f.path).join('\n')
    await fs.writeFile(path.join(gitDir, 'mock-staged'), stagedData)
  }

  // Write mock commit graph for testing merge scenarios
  const commitGraph: Record<string, { parents: string[]; tree: string }> = {}
  for (const branch of branches) {
    commitGraph[branch.sha] = {
      parents: [],
      tree: branch.sha.replace(/./g, 't').substring(0, 40)
    }
  }
  await fs.writeFile(path.join(gitDir, 'mock-commit-graph'), JSON.stringify(commitGraph))

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

describe('gitx merge command', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await removeTempDir(tempDir)
  })

  // ==========================================================================
  // 1. Fast-Forward Merge
  // ==========================================================================
  describe('Fast-forward merge', () => {
    it('should perform fast-forward merge when feature is ahead of main', async () => {
      const mainSha = 'a'.repeat(40)
      const featureSha = 'b'.repeat(40)

      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: mainSha },
          { name: 'feature', sha: featureSha }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const result = await mergeBranches(tempDir, 'feature')

      expect(result.status).toBe('fast-forward')
      expect(result.newHead).toBe(featureSha)
    })

    it('should update HEAD to target branch SHA on fast-forward', async () => {
      const mainSha = 'a'.repeat(40)
      const featureSha = 'b'.repeat(40)

      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: mainSha },
          { name: 'feature', sha: featureSha }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      await mergeBranches(tempDir, 'feature')

      const headRef = await fs.readFile(path.join(tempDir, '.git', 'refs', 'heads', 'main'), 'utf8')
      expect(headRef.trim()).toBe(featureSha)
    })

    it('should output "Fast-forward" message on successful fast-forward', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('merge', mergeCommand)

      await cli.run(['merge', 'feature', '--cwd', tempDir])

      expect(capture.output.stdout.join('\n')).toMatch(/fast-forward/i)
    })

    it('should report "already up-to-date" when target is ancestor', async () => {
      const sha = 'a'.repeat(40)

      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha },
          { name: 'feature', sha }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const result = await mergeBranches(tempDir, 'feature')

      expect(result.status).toBe('already-up-to-date')
    })

    it('should detect when fast-forward is possible', async () => {
      const baseSha = 'a'.repeat(40)
      const aheadSha = 'b'.repeat(40)

      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: baseSha },
          { name: 'feature', sha: aheadSha }
        ]
      })

      const canFF = await canFastForward(tempDir, 'main', 'feature')

      expect(canFF).toBe(true)
    })

    it('should detect when fast-forward is not possible (diverged branches)', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ]
      })

      // Simulate diverged branches by marking them as having independent commits
      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-diverged'),
        'main feature diverged\n'
      )

      const canFF = await canFastForward(tempDir, 'main', 'feature')

      expect(canFF).toBe(false)
    })
  })

  // ==========================================================================
  // 2. Three-Way Merge
  // ==========================================================================
  describe('Three-way merge', () => {
    it('should create merge commit when branches have diverged', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      // Mark branches as diverged
      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-diverged'),
        'main feature diverged\n'
      )

      const result = await mergeBranches(tempDir, 'feature')

      expect(result.status).toBe('merged')
      expect(result.mergeCommitSha).toBeDefined()
      expect(result.mergeCommitSha?.length).toBe(40)
    })

    it('should create merge commit with correct message', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-diverged'),
        'main feature diverged\n'
      )

      const result = await mergeBranches(tempDir, 'feature')

      expect(result.message).toMatch(/merge.*feature/i)
    })

    it('should have two parents in merge commit', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-diverged'),
        'main feature diverged\n'
      )

      const result = await mergeBranches(tempDir, 'feature')

      expect(result.parents).toHaveLength(2)
      expect(result.parents).toContain('a'.repeat(40))
      expect(result.parents).toContain('b'.repeat(40))
    })

    it('should update HEAD to merge commit SHA', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-diverged'),
        'main feature diverged\n'
      )

      const result = await mergeBranches(tempDir, 'feature')

      const headRef = await fs.readFile(
        path.join(tempDir, '.git', 'refs', 'heads', 'main'),
        'utf8'
      )
      expect(headRef.trim()).toBe(result.mergeCommitSha)
    })

    it('should merge successfully via CLI', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-diverged'),
        'main feature diverged\n'
      )

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('merge', mergeCommand)

      const result = await cli.run(['merge', 'feature', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
      expect(capture.output.stdout.join('\n')).toMatch(/merge.*made/i)
    })
  })

  // ==========================================================================
  // 3. --no-ff Flag (Force Merge Commit)
  // ==========================================================================
  describe('--no-ff flag (force merge commit)', () => {
    it('should create merge commit even when fast-forward is possible', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const result = await mergeBranches(tempDir, 'feature', { noFastForward: true })

      expect(result.status).toBe('merged')
      expect(result.mergeCommitSha).toBeDefined()
    })

    it('should have merge commit with two parents when using --no-ff', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const result = await mergeBranches(tempDir, 'feature', { noFastForward: true })

      expect(result.parents).toHaveLength(2)
    })

    it('should work via CLI with --no-ff flag', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('merge', mergeCommand)

      const result = await cli.run(['merge', '--no-ff', 'feature', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
      expect(capture.output.stdout.join('\n')).toMatch(/merge.*made/i)
    })

    it('should accept custom message with -m flag and --no-ff', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const result = await mergeBranches(tempDir, 'feature', {
        noFastForward: true,
        message: 'Custom merge message'
      })

      expect(result.message).toBe('Custom merge message')
    })
  })

  // ==========================================================================
  // 4. --squash Flag
  // ==========================================================================
  describe('--squash flag', () => {
    it('should stage merged changes without creating commit', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const result = await mergeBranches(tempDir, 'feature', { squash: true })

      expect(result.status).toBe('squashed')
      expect(result.mergeCommitSha).toBeUndefined()
    })

    it('should not update HEAD on squash merge', async () => {
      const mainSha = 'a'.repeat(40)

      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: mainSha },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      await mergeBranches(tempDir, 'feature', { squash: true })

      const headRef = await fs.readFile(
        path.join(tempDir, '.git', 'refs', 'heads', 'main'),
        'utf8'
      )
      expect(headRef.trim()).toBe(mainSha)
    })

    it('should output message about squashed changes', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('merge', mergeCommand)

      await cli.run(['merge', '--squash', 'feature', '--cwd', tempDir])

      expect(capture.output.stdout.join('\n')).toMatch(/squash|staged/i)
    })

    it('should require manual commit after squash merge', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const result = await mergeBranches(tempDir, 'feature', { squash: true })

      expect(result.requiresCommit).toBe(true)
    })

    it('should combine all feature commits into single change set', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40), commits: ['commit1', 'commit2', 'commit3'] }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const result = await mergeBranches(tempDir, 'feature', { squash: true })

      expect(result.squashedCommits).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // 5. Merge Conflict Detection
  // ==========================================================================
  describe('Merge conflict detection', () => {
    it('should detect content conflict in same file', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      // Mark branches as having conflicting changes
      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-conflicts'),
        'file.txt\n'
      )

      const result = await mergeBranches(tempDir, 'feature')

      expect(result.status).toBe('conflicted')
      expect(result.conflicts).toBeDefined()
      expect(result.conflicts?.length).toBeGreaterThan(0)
    })

    it('should report conflicted files in merge result', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-conflicts'),
        'file1.txt\nfile2.txt\n'
      )

      const result = await mergeBranches(tempDir, 'feature')

      expect(result.conflicts).toContain('file1.txt')
      expect(result.conflicts).toContain('file2.txt')
    })

    it('should write conflict markers to conflicted files', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-conflicts'),
        'file.txt\n'
      )
      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-conflict-content'),
        JSON.stringify({
          'file.txt': { ours: 'our content', theirs: 'their content' }
        })
      )

      await mergeBranches(tempDir, 'feature')

      const fileContent = await fs.readFile(path.join(tempDir, 'file.txt'), 'utf8')
      expect(fileContent).toContain('<<<<<<<')
      expect(fileContent).toContain('=======')
      expect(fileContent).toContain('>>>>>>>')
    })

    it('should create MERGE_HEAD file on conflict', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-conflicts'),
        'file.txt\n'
      )

      await mergeBranches(tempDir, 'feature')

      const mergeHead = await fs.readFile(
        path.join(tempDir, '.git', 'MERGE_HEAD'),
        'utf8'
      )
      expect(mergeHead.trim()).toBe('b'.repeat(40))
    })

    it('should return non-zero exit code on conflict via CLI', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-conflicts'),
        'file.txt\n'
      )

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('merge', mergeCommand)

      const result = await cli.run(['merge', 'feature', '--cwd', tempDir])

      expect(result.exitCode).toBe(1)
      expect(capture.output.stderr.join('\n')).toMatch(/conflict|fix conflicts/i)
    })

    it('should display list of conflicted files on CLI', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-conflicts'),
        'src/file1.txt\nsrc/file2.txt\n'
      )

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('merge', mergeCommand)

      await cli.run(['merge', 'feature', '--cwd', tempDir])

      const output = capture.output.stderr.join('\n')
      expect(output).toContain('src/file1.txt')
      expect(output).toContain('src/file2.txt')
    })
  })

  // ==========================================================================
  // 6. --abort Functionality
  // ==========================================================================
  describe('--abort functionality', () => {
    it('should abort in-progress merge', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        mergeState: {
          mergeHead: 'b'.repeat(40),
          origHead: 'a'.repeat(40),
          message: 'Merge branch feature',
          conflicts: [{ path: 'file.txt', oursContent: 'ours', theirsContent: 'theirs' }]
        }
      })

      const result = await abortMerge(tempDir)

      expect(result.success).toBe(true)
    })

    it('should restore HEAD to original commit', async () => {
      const origHead = 'a'.repeat(40)

      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: origHead },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        mergeState: {
          mergeHead: 'b'.repeat(40),
          origHead,
          message: 'Merge branch feature'
        }
      })

      await abortMerge(tempDir)

      const headRef = await fs.readFile(
        path.join(tempDir, '.git', 'refs', 'heads', 'main'),
        'utf8'
      )
      expect(headRef.trim()).toBe(origHead)
    })

    it('should remove MERGE_HEAD file', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        mergeState: {
          mergeHead: 'b'.repeat(40),
          origHead: 'a'.repeat(40),
          message: 'Merge branch feature'
        }
      })

      await abortMerge(tempDir)

      await expect(
        fs.access(path.join(tempDir, '.git', 'MERGE_HEAD'))
      ).rejects.toThrow()
    })

    it('should remove conflict markers from files', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        mergeState: {
          mergeHead: 'b'.repeat(40),
          origHead: 'a'.repeat(40),
          message: 'Merge branch feature',
          conflicts: [{ path: 'file.txt', oursContent: 'ours', theirsContent: 'theirs' }]
        }
      })

      await abortMerge(tempDir)

      const fileContent = await fs.readFile(path.join(tempDir, 'file.txt'), 'utf8')
      expect(fileContent).not.toContain('<<<<<<<')
      expect(fileContent).not.toContain('>>>>>>>')
    })

    it('should work via CLI with --abort flag', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        mergeState: {
          mergeHead: 'b'.repeat(40),
          origHead: 'a'.repeat(40),
          message: 'Merge branch feature'
        }
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('merge', mergeCommand)

      const result = await cli.run(['merge', '--abort', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
      expect(capture.output.stdout.join('\n')).toMatch(/aborted|canceled/i)
    })

    it('should fail when no merge in progress', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) }
        ]
      })

      await expect(abortMerge(tempDir)).rejects.toThrow(/no merge/i)
    })
  })

  // ==========================================================================
  // 7. Error Handling - Branch Not Found
  // ==========================================================================
  describe('Error handling - branch not found', () => {
    it('should throw error for non-existent branch', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) }
        ]
      })

      await expect(mergeBranches(tempDir, 'nonexistent'))
        .rejects.toThrow(/not found|does not exist/i)
    })

    it('should return non-zero exit code for non-existent branch via CLI', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) }
        ]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('merge', mergeCommand)

      const result = await cli.run(['merge', 'nonexistent', '--cwd', tempDir])

      expect(result.exitCode).toBe(1)
      expect(capture.output.stderr.join('\n')).toMatch(/not found|does not exist/i)
    })

    it('should suggest similar branch name if typo detected', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('merge', mergeCommand)

      await cli.run(['merge', 'featur', '--cwd', tempDir])

      expect(capture.output.stderr.join('\n')).toMatch(/did you mean.*feature/i)
    })
  })

  // ==========================================================================
  // 8. Error Handling - Uncommitted Changes
  // ==========================================================================
  describe('Error handling - uncommitted changes', () => {
    it('should fail when working directory has uncommitted changes', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        uncommittedChanges: [{ path: 'file.txt', content: 'modified' }]
      })

      await expect(mergeBranches(tempDir, 'feature'))
        .rejects.toThrow(/uncommitted|changes|commit.*first/i)
    })

    it('should return helpful error message about uncommitted changes', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        uncommittedChanges: [{ path: 'file.txt', content: 'modified' }]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('merge', mergeCommand)

      await cli.run(['merge', 'feature', '--cwd', tempDir])

      expect(capture.output.stderr.join('\n')).toMatch(/commit.*changes|stash/i)
    })

    it('should fail when there are staged but uncommitted files', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        stagedFiles: [{ path: 'staged.txt', sha: 'c'.repeat(40) }]
      })

      await expect(mergeBranches(tempDir, 'feature'))
        .rejects.toThrow(/staged|uncommitted/i)
    })
  })

  // ==========================================================================
  // 9. Edge Cases - Merge with Self
  // ==========================================================================
  describe('Edge case - merge with self', () => {
    it('should handle merge with current branch (no-op)', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) }
        ]
      })

      const result = await mergeBranches(tempDir, 'main')

      expect(result.status).toBe('already-up-to-date')
    })

    it('should output appropriate message for self-merge', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) }
        ]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('merge', mergeCommand)

      await cli.run(['merge', 'main', '--cwd', tempDir])

      expect(capture.output.stdout.join('\n')).toMatch(/already up.?to.?date/i)
    })
  })

  // ==========================================================================
  // 10. Edge Cases - Already Up-to-Date
  // ==========================================================================
  describe('Edge case - already up-to-date', () => {
    it('should detect when target is already merged', async () => {
      const sha = 'a'.repeat(40)

      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha },
          { name: 'feature', sha }
        ]
      })

      const result = await mergeBranches(tempDir, 'feature')

      expect(result.status).toBe('already-up-to-date')
      expect(result.mergeCommitSha).toBeUndefined()
    })

    it('should return exit code 0 for already up-to-date', async () => {
      const sha = 'a'.repeat(40)

      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha },
          { name: 'feature', sha }
        ]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('merge', mergeCommand)

      const result = await cli.run(['merge', 'feature', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })
  })

  // ==========================================================================
  // 11. Merge Message Customization
  // ==========================================================================
  describe('Merge message customization', () => {
    it('should use custom message with -m flag', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-diverged'),
        'main feature diverged\n'
      )

      const result = await mergeBranches(tempDir, 'feature', {
        message: 'My custom merge message'
      })

      expect(result.message).toBe('My custom merge message')
    })

    it('should generate default message if none provided', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-diverged'),
        'main feature diverged\n'
      )

      const result = await mergeBranches(tempDir, 'feature')

      expect(result.message).toMatch(/merge.*branch.*feature/i)
    })
  })

  // ==========================================================================
  // 12. Merge Status Checking
  // ==========================================================================
  describe('Merge status checking', () => {
    it('should detect merge in progress', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        mergeState: {
          mergeHead: 'b'.repeat(40),
          origHead: 'a'.repeat(40),
          message: 'Merge branch feature'
        }
      })

      const status = await getMergeStatus(tempDir)

      expect(status.inProgress).toBe(true)
      expect(status.mergeHead).toBe('b'.repeat(40))
    })

    it('should report no merge in progress when clean', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) }
        ]
      })

      const status = await getMergeStatus(tempDir)

      expect(status.inProgress).toBe(false)
    })

    it('should list unresolved conflicts', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        mergeState: {
          mergeHead: 'b'.repeat(40),
          origHead: 'a'.repeat(40),
          message: 'Merge branch feature',
          conflicts: [
            { path: 'file1.txt', oursContent: 'a', theirsContent: 'b' },
            { path: 'file2.txt', oursContent: 'c', theirsContent: 'd' }
          ]
        }
      })

      const status = await getMergeStatus(tempDir)

      expect(status.unresolvedConflicts).toHaveLength(2)
      expect(status.unresolvedConflicts).toContain('file1.txt')
      expect(status.unresolvedConflicts).toContain('file2.txt')
    })
  })

  // ==========================================================================
  // 13. Continue Merge After Resolving Conflicts
  // ==========================================================================
  describe('Continue merge after resolving conflicts', () => {
    it('should complete merge after conflicts are resolved', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        mergeState: {
          mergeHead: 'b'.repeat(40),
          origHead: 'a'.repeat(40),
          message: 'Merge branch feature'
        },
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      // Simulate resolved conflicts
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'resolved content')
      await fs.unlink(path.join(tempDir, '.git', 'mock-conflicts')).catch(() => {})

      const result = await continueMerge(tempDir)

      expect(result.success).toBe(true)
      expect(result.commitSha).toBeDefined()
    })

    it('should fail to continue if conflicts remain', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        mergeState: {
          mergeHead: 'b'.repeat(40),
          origHead: 'a'.repeat(40),
          message: 'Merge branch feature',
          conflicts: [{ path: 'file.txt', oursContent: 'ours', theirsContent: 'theirs' }]
        }
      })

      await expect(continueMerge(tempDir))
        .rejects.toThrow(/unresolved|conflict/i)
    })

    it('should work via CLI with --continue flag', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        mergeState: {
          mergeHead: 'b'.repeat(40),
          origHead: 'a'.repeat(40),
          message: 'Merge branch feature'
        },
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('merge', mergeCommand)

      const result = await cli.run(['merge', '--continue', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })
  })

  // ==========================================================================
  // 14. Non-Git Directory Error
  // ==========================================================================
  describe('Non-git directory error', () => {
    it('should throw error for non-git directory', async () => {
      const nonGitDir = await createTempDir()

      try {
        await expect(mergeBranches(nonGitDir, 'feature'))
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
        cli.registerCommand('merge', mergeCommand)

        const result = await cli.run(['merge', 'feature', '--cwd', nonGitDir])

        expect(result.exitCode).toBe(1)
        expect(capture.output.stderr.join('\n')).toMatch(/not a git repository/i)
      } finally {
        await removeTempDir(nonGitDir)
      }
    })
  })

  // ==========================================================================
  // 15. Merge by Commit SHA
  // ==========================================================================
  describe('Merge by commit SHA', () => {
    it('should accept commit SHA instead of branch name', async () => {
      const featureSha = 'b'.repeat(40)

      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: featureSha }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const result = await mergeBranches(tempDir, featureSha)

      expect(result.status).toBe('fast-forward')
    })

    it('should accept short SHA', async () => {
      const featureSha = 'b'.repeat(40)

      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: featureSha }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const result = await mergeBranches(tempDir, 'bbbbbbb')

      expect(result.status).toBe('fast-forward')
    })
  })

  // ==========================================================================
  // 16. Detached HEAD State
  // ==========================================================================
  describe('Detached HEAD state', () => {
    it('should allow merge in detached HEAD state', async () => {
      const currentSha = 'a'.repeat(40)
      const featureSha = 'b'.repeat(40)

      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: currentSha },
          { name: 'feature', sha: featureSha }
        ],
        detached: true,
        currentSha,
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const result = await mergeBranches(tempDir, 'feature')

      expect(result.status).toBe('fast-forward')
    })

    it('should update HEAD directly in detached state', async () => {
      const featureSha = 'b'.repeat(40)

      await createMockGitRepo(tempDir, {
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: featureSha }
        ],
        detached: true,
        currentSha: 'a'.repeat(40),
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      await mergeBranches(tempDir, 'feature')

      const head = await fs.readFile(path.join(tempDir, '.git', 'HEAD'), 'utf8')
      expect(head.trim()).toBe(featureSha)
    })
  })

  // ==========================================================================
  // 17. --ff-only Flag
  // ==========================================================================
  describe('--ff-only flag', () => {
    it('should succeed when fast-forward is possible', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const result = await mergeBranches(tempDir, 'feature', { fastForwardOnly: true })

      expect(result.status).toBe('fast-forward')
    })

    it('should fail when fast-forward is not possible', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ]
      })

      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-diverged'),
        'main feature diverged\n'
      )

      await expect(mergeBranches(tempDir, 'feature', { fastForwardOnly: true }))
        .rejects.toThrow(/fast-forward|not possible/i)
    })

    it('should work via CLI with --ff-only flag', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('merge', mergeCommand)

      const result = await cli.run(['merge', '--ff-only', 'feature', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })
  })

  // ==========================================================================
  // 18. CLI Help and Usage
  // ==========================================================================
  describe('CLI help and usage', () => {
    it('should show help for merge command', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('merge', mergeCommand)

      await cli.run(['merge', '--help'])

      const output = capture.output.stdout.join('\n')
      expect(output).toMatch(/merge/i)
      expect(output).toMatch(/--no-ff|--squash|--abort/i)
    })

    it('should show error when no branch argument provided', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) }
        ]
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('merge', mergeCommand)

      const result = await cli.run(['merge', '--cwd', tempDir])

      expect(result.exitCode).toBe(1)
      expect(capture.output.stderr.join('\n')).toMatch(/branch.*required|specify.*branch/i)
    })
  })

  // ==========================================================================
  // 19. Remote Branch Merge
  // ==========================================================================
  describe('Remote branch merge', () => {
    it('should merge from remote tracking branch', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      // Create remote tracking branch
      await fs.writeFile(
        path.join(tempDir, '.git', 'refs', 'remotes', 'origin', 'feature'),
        'b'.repeat(40) + '\n'
      )

      const result = await mergeBranches(tempDir, 'origin/feature')

      expect(result.status).toBe('fast-forward')
    })
  })

  // ==========================================================================
  // 20. Edge Case - Branch with Slash in Name
  // ==========================================================================
  describe('Edge case - branch with slash in name', () => {
    it('should handle branch names with slashes', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature/new-auth', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const result = await mergeBranches(tempDir, 'feature/new-auth')

      expect(result.status).toBe('fast-forward')
    })
  })

  // ==========================================================================
  // 21. Merge Statistics
  // ==========================================================================
  describe('Merge statistics', () => {
    it('should report files changed on successful merge', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-diverged'),
        'main feature diverged\n'
      )

      const result = await mergeBranches(tempDir, 'feature')

      expect(result.stats).toBeDefined()
      expect(typeof result.stats?.filesChanged).toBe('number')
    })

    it('should display statistics via CLI', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('merge', mergeCommand)

      await cli.run(['merge', 'feature', '--cwd', tempDir])

      expect(capture.output.stdout.join('\n')).toMatch(/\d+.*file|file.*\d+/i)
    })
  })

  // ==========================================================================
  // 22. Strategy Options (for future expansion)
  // ==========================================================================
  describe('Strategy options', () => {
    it('should accept --strategy option', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-diverged'),
        'main feature diverged\n'
      )

      const result = await mergeBranches(tempDir, 'feature', { strategy: 'recursive' })

      expect(result).toBeDefined()
    })

    it('should accept --strategy-option for ours', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-conflicts'),
        'file.txt\n'
      )

      const result = await mergeBranches(tempDir, 'feature', {
        strategyOption: 'ours'
      })

      expect(result.status).toBe('merged')
    })
  })

  // ==========================================================================
  // 23. Octopus Merge (multiple branches)
  // ==========================================================================
  describe('Octopus merge (multiple branches)', () => {
    it('should merge multiple branches at once', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature1', sha: 'b'.repeat(40) },
          { name: 'feature2', sha: 'c'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const result = await mergeBranches(tempDir, ['feature1', 'feature2'])

      expect(result.status).toBe('merged')
      expect(result.parents?.length).toBe(3)
    })

    it('should work via CLI with multiple branch arguments', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature1', sha: 'b'.repeat(40) },
          { name: 'feature2', sha: 'c'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('merge', mergeCommand)

      const result = await cli.run(['merge', 'feature1', 'feature2', '--cwd', tempDir])

      expect(result.exitCode).toBe(0)
    })
  })

  // ==========================================================================
  // 24. Missing User Configuration
  // ==========================================================================
  describe('Missing user configuration', () => {
    it('should fail merge commit without user.name', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userEmail: 'test@example.com.ai' } // Missing userName
      })

      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-diverged'),
        'main feature diverged\n'
      )

      await expect(mergeBranches(tempDir, 'feature'))
        .rejects.toThrow(/user\.name|identity/i)
    })

    it('should fail merge commit without user.email', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User' } // Missing userEmail
      })

      await fs.writeFile(
        path.join(tempDir, '.git', 'mock-diverged'),
        'main feature diverged\n'
      )

      await expect(mergeBranches(tempDir, 'feature'))
        .rejects.toThrow(/user\.email|identity/i)
    })
  })

  // ==========================================================================
  // 25. CLI Registration
  // ==========================================================================
  describe('CLI registration', () => {
    it('should register merge command with CLI', () => {
      const cli = createCLI()

      expect(() => cli.registerCommand('merge', mergeCommand)).not.toThrow()
    })

    it('should be callable after registration', async () => {
      await createMockGitRepo(tempDir, {
        currentBranch: 'main',
        branches: [
          { name: 'main', sha: 'a'.repeat(40) },
          { name: 'feature', sha: 'b'.repeat(40) }
        ],
        config: { userName: 'Test User', userEmail: 'test@example.com.ai' }
      })

      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })
      cli.registerCommand('merge', mergeCommand)

      const result = await cli.run(['merge', 'feature', '--cwd', tempDir])

      expect(typeof result.exitCode).toBe('number')
    })
  })
})
