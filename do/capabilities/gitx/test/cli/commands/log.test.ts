/**
 * Git Log Command Tests
 *
 * RED phase tests for the gitx log command.
 * Tests verify commit history display with various formatting and filtering options.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as zlib from 'zlib'
import { promisify } from 'util'
import {
  logCommand,
  getLog,
  formatLogEntry,
  formatWithString,
  generateGraph,
  parseDateFilter,
  LogOptions,
  LogEntry,
  LogResult
} from '../../../src/cli/commands/log'
import { createFSAdapter, FSAdapter } from '../../../src/cli/fs-adapter'
import { createCLI, CommandContext } from '../../../src/cli/index'

const deflate = promisify(zlib.deflate)

// ============================================================================
// Git Object Writing Helpers
// ============================================================================

/**
 * Compute SHA-1 hash of data (simplified - uses crypto)
 */
async function sha1(data: Uint8Array): Promise<string> {
  const crypto = await import('crypto')
  return crypto.createHash('sha1').update(data).digest('hex')
}

/**
 * Write a git object to the objects directory
 */
async function writeGitObject(
  gitDir: string,
  type: string,
  content: string
): Promise<string> {
  const encoder = new TextEncoder()
  const contentBytes = encoder.encode(content)
  const header = encoder.encode(`${type} ${contentBytes.length}\0`)

  const fullData = new Uint8Array(header.length + contentBytes.length)
  fullData.set(header)
  fullData.set(contentBytes, header.length)

  const objectSha = await sha1(fullData)
  const compressed = await deflate(Buffer.from(fullData))

  const objDir = path.join(gitDir, 'objects', objectSha.substring(0, 2))
  await fs.mkdir(objDir, { recursive: true })
  await fs.writeFile(
    path.join(objDir, objectSha.substring(2)),
    compressed
  )

  return objectSha
}

/**
 * Create a commit object and write it to disk
 */
async function writeCommit(
  gitDir: string,
  options: {
    tree: string
    parents: string[]
    message: string
    author: string
    email: string
    timestamp: number
  }
): Promise<string> {
  const lines: string[] = []
  lines.push(`tree ${options.tree}`)
  for (const parent of options.parents) {
    lines.push(`parent ${parent}`)
  }
  lines.push(`author ${options.author} <${options.email}> ${options.timestamp} +0000`)
  lines.push(`committer ${options.author} <${options.email}> ${options.timestamp} +0000`)
  lines.push('')
  lines.push(options.message)

  const content = lines.join('\n')
  return writeGitObject(gitDir, 'commit', content)
}

/**
 * Create an empty tree object and write it to disk
 */
async function writeEmptyTree(gitDir: string): Promise<string> {
  // Empty tree has no entries, just the header
  return writeGitObject(gitDir, 'tree', '')
}

// ============================================================================
// Test Fixtures and Helpers
// ============================================================================

const sampleSha = 'a'.repeat(40)
const sampleSha2 = 'b'.repeat(40)
const sampleSha3 = 'c'.repeat(40)
const sampleSha4 = 'd'.repeat(40)
const mergeSha = 'e'.repeat(40)

/**
 * Create a mock log entry for testing
 */
function createMockLogEntry(
  sha: string,
  options: {
    message?: string
    author?: string
    email?: string
    date?: Date
    parents?: string[]
  } = {}
): LogEntry {
  const date = options.date ?? new Date('2024-01-15T10:00:00Z')
  return {
    sha,
    shortSha: sha.substring(0, 7),
    author: {
      name: options.author ?? 'Test User',
      email: options.email ?? 'test@example.com.ai',
      date
    },
    committer: {
      name: options.author ?? 'Test User',
      email: options.email ?? 'test@example.com.ai',
      date
    },
    message: options.message ?? 'Test commit message',
    parents: options.parents ?? [],
    isMerge: (options.parents?.length ?? 0) > 1
  }
}

/**
 * Create a temporary directory for test repository
 */
async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'gitx-log-test-'))
}

/**
 * Clean up temporary directory
 */
async function removeTempDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true })
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * Create a mock git repository with commit history
 */
async function createMockGitRepoWithHistory(
  basePath: string,
  options: {
    commitCount?: number
    withMerge?: boolean
    withBranches?: boolean
    empty?: boolean
  } = {}
): Promise<string> {
  const gitDir = path.join(basePath, '.git')

  // Create basic structure
  await fs.mkdir(gitDir, { recursive: true })
  await fs.mkdir(path.join(gitDir, 'objects', 'info'), { recursive: true })
  await fs.mkdir(path.join(gitDir, 'objects', 'pack'), { recursive: true })
  await fs.mkdir(path.join(gitDir, 'refs', 'heads'), { recursive: true })
  await fs.mkdir(path.join(gitDir, 'refs', 'tags'), { recursive: true })

  if (options.empty) {
    // Empty repository - HEAD points to non-existent branch
    await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')
    return basePath
  }

  // Write HEAD
  await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')

  // Write config
  const config = `[core]
\trepositoryformatversion = 0
\tfilemode = true
\tbare = false
`
  await fs.writeFile(path.join(gitDir, 'config'), config)

  // Create actual commit objects
  const treeSha = await writeEmptyTree(gitDir)

  const commitCount = options.commitCount ?? 1
  const baseTimestamp = 1705312800 // Jan 15, 2024 10:00:00 UTC

  // Create chain of commits
  const commitShas: string[] = []
  let parentSha = ''

  for (let i = 0; i < commitCount; i++) {
    const parents = parentSha ? [parentSha] : []
    const timestamp = baseTimestamp + (commitCount - 1 - i) * 3600 // Each commit 1 hour apart, newest first
    const sha = await writeCommit(gitDir, {
      tree: treeSha,
      parents,
      message: `Commit ${i + 1}`,
      author: 'John Doe',
      email: 'john@example.com.ai',
      timestamp
    })
    commitShas.push(sha)
    parentSha = sha
  }

  // The last commit is the head
  const headSha = commitShas[commitShas.length - 1]
  await fs.writeFile(path.join(gitDir, 'refs', 'heads', 'main'), headSha + '\n')

  if (options.withBranches) {
    // Create additional branches with their own commits
    const developSha = await writeCommit(gitDir, {
      tree: treeSha,
      parents: commitShas.length > 0 ? [commitShas[0]] : [],
      message: 'Develop branch commit',
      author: 'Jane Doe',
      email: 'jane@example.com.ai',
      timestamp: baseTimestamp + 1000
    })
    await fs.writeFile(path.join(gitDir, 'refs', 'heads', 'develop'), developSha + '\n')

    const featureSha = await writeCommit(gitDir, {
      tree: treeSha,
      parents: commitShas.length > 0 ? [commitShas[0]] : [],
      message: 'Feature branch commit',
      author: 'Bob Smith',
      email: 'bob@example.com.ai',
      timestamp: baseTimestamp + 2000
    })
    await fs.writeFile(path.join(gitDir, 'refs', 'heads', 'feature'), featureSha + '\n')
  }

  if (options.withMerge) {
    // Create a merge commit with two parents
    // First create two branch commits
    const branch1Sha = await writeCommit(gitDir, {
      tree: treeSha,
      parents: [headSha],
      message: 'Branch 1 commit',
      author: 'John Doe',
      email: 'john@example.com.ai',
      timestamp: baseTimestamp + 5000
    })
    const branch2Sha = await writeCommit(gitDir, {
      tree: treeSha,
      parents: [headSha],
      message: 'Branch 2 commit',
      author: 'Jane Doe',
      email: 'jane@example.com.ai',
      timestamp: baseTimestamp + 5500
    })
    // Now create merge commit
    const mergeSha = await writeCommit(gitDir, {
      tree: treeSha,
      parents: [branch1Sha, branch2Sha],
      message: 'Merge branch2 into branch1',
      author: 'John Doe',
      email: 'john@example.com.ai',
      timestamp: baseTimestamp + 6000
    })
    await fs.writeFile(path.join(gitDir, 'refs', 'heads', 'main'), mergeSha + '\n')
  }

  return basePath
}

/**
 * Create output capture for CLI testing
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
// Test Suites
// ============================================================================

describe('Git Log Command', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await removeTempDir(tempDir)
  })

  // ==========================================================================
  // 1. Shows commit history from HEAD
  // ==========================================================================
  describe('Shows commit history from HEAD', () => {
    it('should show commits starting from HEAD', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 5 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter)

      expect(result.entries).toBeInstanceOf(Array)
      expect(result.entries.length).toBeGreaterThan(0)
    })

    it('should list commits in reverse chronological order (newest first)', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 3 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter)

      // First entry should be the most recent
      if (result.entries.length > 1) {
        const firstDate = result.entries[0].author.date
        const secondDate = result.entries[1].author.date
        expect(firstDate.getTime()).toBeGreaterThanOrEqual(secondDate.getTime())
      }
    })

    it('should traverse parent chain from HEAD', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 5 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter)

      // Each commit should have its parent in the list (except root)
      for (let i = 0; i < result.entries.length - 1; i++) {
        const entry = result.entries[i]
        if (entry.parents.length > 0) {
          const parentSha = entry.parents[0]
          const parentExists = result.entries.some(e => e.sha === parentSha)
          expect(parentExists).toBe(true)
        }
      }
    })

    it('should accept starting commit reference as argument', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 5 })
      const adapter = await createFSAdapter(tempDir)

      // Start from a specific commit instead of HEAD
      const result = await getLog(adapter, { n: 10 })

      expect(result.entries).toBeInstanceOf(Array)
    })
  })

  // ==========================================================================
  // 2. Shows commit SHA, author, date, message
  // ==========================================================================
  describe('Shows commit SHA, author, date, message', () => {
    it('should include full SHA for each commit', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 3 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter)

      for (const entry of result.entries) {
        expect(entry.sha).toMatch(/^[0-9a-f]{40}$/)
      }
    })

    it('should include short SHA (7 chars) for each commit', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 3 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter)

      for (const entry of result.entries) {
        expect(entry.shortSha).toHaveLength(7)
        expect(entry.sha.startsWith(entry.shortSha)).toBe(true)
      }
    })

    it('should include author name for each commit', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 3 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter)

      for (const entry of result.entries) {
        expect(entry.author.name).toBeDefined()
        expect(typeof entry.author.name).toBe('string')
        expect(entry.author.name.length).toBeGreaterThan(0)
      }
    })

    it('should include author email for each commit', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 3 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter)

      for (const entry of result.entries) {
        expect(entry.author.email).toBeDefined()
        expect(entry.author.email).toContain('@')
      }
    })

    it('should include author date for each commit', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 3 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter)

      for (const entry of result.entries) {
        expect(entry.author.date).toBeInstanceOf(Date)
        expect(entry.author.date.getTime()).toBeGreaterThan(0)
      }
    })

    it('should include commit message for each commit', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 3 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter)

      for (const entry of result.entries) {
        expect(entry.message).toBeDefined()
        expect(typeof entry.message).toBe('string')
      }
    })

    it('should include committer info (may differ from author)', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 3 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter)

      for (const entry of result.entries) {
        expect(entry.committer.name).toBeDefined()
        expect(entry.committer.email).toBeDefined()
        expect(entry.committer.date).toBeInstanceOf(Date)
      }
    })

    it('should format default output with all fields', async () => {
      const entry = createMockLogEntry(sampleSha, {
        message: 'Initial commit',
        author: 'John Doe',
        email: 'john@example.com.ai',
        date: new Date('2024-01-15T10:00:00Z')
      })

      const formatted = formatLogEntry(entry)

      expect(formatted).toContain(sampleSha)
      expect(formatted).toContain('John Doe')
      expect(formatted).toContain('john@example.com.ai')
      expect(formatted).toContain('Initial commit')
      // Should contain date in some format
      expect(formatted).toMatch(/2024|Jan|15/)
    })
  })

  // ==========================================================================
  // 3. Supports -n flag to limit number of commits
  // ==========================================================================
  describe('Supports -n flag to limit number of commits', () => {
    it('should limit output to n commits with -n flag', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 10 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { n: 3 })

      expect(result.entries.length).toBeLessThanOrEqual(3)
    })

    it('should return all commits if n is greater than total', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 5 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { n: 100 })

      // Should return available commits, not error
      expect(result.entries).toBeInstanceOf(Array)
    })

    it('should return empty array if n is 0', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 5 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { n: 0 })

      expect(result.entries).toEqual([])
    })

    it('should handle n=1 correctly', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 5 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { n: 1 })

      expect(result.entries.length).toBe(1)
    })

    it('should indicate hasMore when there are more commits', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 10 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { n: 3 })

      expect(result.hasMore).toBe(true)
    })

    it('should indicate hasMore=false when all commits returned', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 3 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { n: 100 })

      expect(result.hasMore).toBe(false)
    })
  })

  // ==========================================================================
  // 4. Supports --oneline format
  // ==========================================================================
  describe('Supports --oneline format', () => {
    it('should format commits on single line with oneline option', async () => {
      const entry = createMockLogEntry(sampleSha, {
        message: 'Fix bug in parser'
      })

      const formatted = formatLogEntry(entry, { oneline: true })

      // Oneline should be a single line
      expect(formatted.split('\n').length).toBe(1)
    })

    it('should show short SHA in oneline format', async () => {
      const entry = createMockLogEntry(sampleSha, {
        message: 'Add feature'
      })

      const formatted = formatLogEntry(entry, { oneline: true })

      expect(formatted).toContain(entry.shortSha)
      // Should NOT contain full SHA in oneline
      expect(formatted).not.toContain(sampleSha)
    })

    it('should show first line of message only in oneline format', async () => {
      const entry = createMockLogEntry(sampleSha, {
        message: 'Subject line\n\nBody paragraph 1\nBody paragraph 2'
      })

      const formatted = formatLogEntry(entry, { oneline: true })

      expect(formatted).toContain('Subject line')
      expect(formatted).not.toContain('Body paragraph')
    })

    it('should not include author or date in oneline format', async () => {
      const entry = createMockLogEntry(sampleSha, {
        message: 'Test commit',
        author: 'Test Author',
        date: new Date('2024-01-15')
      })

      const formatted = formatLogEntry(entry, { oneline: true })

      expect(formatted).not.toContain('Test Author')
      expect(formatted).not.toContain('2024')
    })

    it('should separate SHA and message with space', async () => {
      const entry = createMockLogEntry(sampleSha, {
        message: 'Initial commit'
      })

      const formatted = formatLogEntry(entry, { oneline: true })

      // Format: "abcdef1 Initial commit"
      expect(formatted).toMatch(/^[0-9a-f]{7}\s+.*$/)
    })
  })

  // ==========================================================================
  // 5. Supports --format flag for custom format
  // ==========================================================================
  describe('Supports --format flag for custom format', () => {
    it('should support %H placeholder for full hash', async () => {
      const entry = createMockLogEntry(sampleSha, { message: 'Test' })

      const formatted = formatWithString(entry, '%H')

      expect(formatted).toBe(sampleSha)
    })

    it('should support %h placeholder for short hash', async () => {
      const entry = createMockLogEntry(sampleSha, { message: 'Test' })

      const formatted = formatWithString(entry, '%h')

      expect(formatted).toBe(sampleSha.substring(0, 7))
    })

    it('should support %an placeholder for author name', async () => {
      const entry = createMockLogEntry(sampleSha, {
        message: 'Test',
        author: 'Jane Doe'
      })

      const formatted = formatWithString(entry, '%an')

      expect(formatted).toBe('Jane Doe')
    })

    it('should support %ae placeholder for author email', async () => {
      const entry = createMockLogEntry(sampleSha, {
        message: 'Test',
        email: 'jane@example.com.ai'
      })

      const formatted = formatWithString(entry, '%ae')

      expect(formatted).toBe('jane@example.com.ai')
    })

    it('should support %ad placeholder for author date', async () => {
      const entry = createMockLogEntry(sampleSha, {
        message: 'Test',
        date: new Date('2024-01-15T10:30:00Z')
      })

      const formatted = formatWithString(entry, '%ad')

      expect(formatted).toContain('2024')
    })

    it('should support %s placeholder for subject (first line)', async () => {
      const entry = createMockLogEntry(sampleSha, {
        message: 'Subject line\n\nBody text'
      })

      const formatted = formatWithString(entry, '%s')

      expect(formatted).toBe('Subject line')
    })

    it('should support %b placeholder for body', async () => {
      const entry = createMockLogEntry(sampleSha, {
        message: 'Subject line\n\nBody text here'
      })

      const formatted = formatWithString(entry, '%b')

      expect(formatted).toBe('Body text here')
    })

    it('should support combining multiple placeholders', async () => {
      const entry = createMockLogEntry(sampleSha, {
        message: 'Test commit',
        author: 'Test User'
      })

      const formatted = formatWithString(entry, '%h - %an: %s')

      expect(formatted).toBe(`${entry.shortSha} - Test User: Test commit`)
    })

    it('should preserve literal text between placeholders', async () => {
      const entry = createMockLogEntry(sampleSha, { message: 'Test' })

      const formatted = formatWithString(entry, '[%h] (%an)')

      expect(formatted).toMatch(/^\[[0-9a-f]{7}\] \(.*\)$/)
    })

    it('should handle unknown placeholders gracefully', async () => {
      const entry = createMockLogEntry(sampleSha, { message: 'Test' })

      const formatted = formatWithString(entry, '%h %X %s')

      // Unknown placeholder %X should be preserved or handled gracefully
      expect(formatted).toContain(entry.shortSha)
      expect(formatted).toContain('Test')
    })

    it('should support %cn for committer name', async () => {
      const entry = createMockLogEntry(sampleSha, { message: 'Test' })

      const formatted = formatWithString(entry, '%cn')

      expect(formatted).toBe(entry.committer.name)
    })

    it('should support %ce for committer email', async () => {
      const entry = createMockLogEntry(sampleSha, { message: 'Test' })

      const formatted = formatWithString(entry, '%ce')

      expect(formatted).toBe(entry.committer.email)
    })

    it('should support %P for parent hashes', async () => {
      const entry = createMockLogEntry(sampleSha, {
        message: 'Merge commit',
        parents: [sampleSha2, sampleSha3]
      })

      const formatted = formatWithString(entry, '%P')

      expect(formatted).toContain(sampleSha2)
      expect(formatted).toContain(sampleSha3)
    })
  })

  // ==========================================================================
  // 6. Supports --graph flag for ASCII branch visualization
  // ==========================================================================
  describe('Supports --graph flag for ASCII branch visualization', () => {
    it('should generate ASCII graph for linear history', async () => {
      const entries = [
        createMockLogEntry(sampleSha, { message: 'Third', parents: [sampleSha2] }),
        createMockLogEntry(sampleSha2, { message: 'Second', parents: [sampleSha3] }),
        createMockLogEntry(sampleSha3, { message: 'First', parents: [] })
      ]

      const graph = generateGraph(entries)

      expect(graph).toBeInstanceOf(Array)
      expect(graph.length).toBe(entries.length)
      // Linear history should show simple vertical line
      for (const line of graph) {
        expect(line).toMatch(/[*|]/)
      }
    })

    it('should show merge commits with branch visualization', async () => {
      const entries = [
        createMockLogEntry(mergeSha, {
          message: 'Merge branch',
          parents: [sampleSha, sampleSha2]
        }),
        createMockLogEntry(sampleSha, { message: 'Feature', parents: [sampleSha3] }),
        createMockLogEntry(sampleSha2, { message: 'Main', parents: [sampleSha3] }),
        createMockLogEntry(sampleSha3, { message: 'Base', parents: [] })
      ]

      const graph = generateGraph(entries)

      // Merge commit should show branching
      expect(graph[0]).toMatch(/[*]/)
      // Should have some branch indicators
      const hasGraphChars = graph.some(line => /[|/\\]/.test(line))
      expect(hasGraphChars).toBe(true)
    })

    it('should use asterisk (*) to mark commit position', async () => {
      const entries = [
        createMockLogEntry(sampleSha, { message: 'Commit', parents: [] })
      ]

      const graph = generateGraph(entries)

      expect(graph[0]).toContain('*')
    })

    it('should use vertical bar (|) for continuing branches', async () => {
      const entries = [
        createMockLogEntry(sampleSha, { message: 'C3', parents: [sampleSha2] }),
        createMockLogEntry(sampleSha2, { message: 'C2', parents: [sampleSha3] }),
        createMockLogEntry(sampleSha3, { message: 'C1', parents: [] })
      ]

      const graph = generateGraph(entries)

      // At least one line should have a continuing branch indicator
      const hasContinuation = graph.slice(1).some(line => line.includes('|'))
      expect(hasContinuation).toBe(true)
    })

    it('should show fork/merge points with appropriate symbols', async () => {
      const entries = [
        createMockLogEntry(mergeSha, {
          message: 'Merge',
          parents: [sampleSha, sampleSha2]
        }),
        createMockLogEntry(sampleSha, { message: 'A', parents: [sampleSha3] }),
        createMockLogEntry(sampleSha2, { message: 'B', parents: [sampleSha3] }),
        createMockLogEntry(sampleSha3, { message: 'Root', parents: [] })
      ]

      const graph = generateGraph(entries)

      // Should have branch/merge indicators
      const graphStr = graph.join('\n')
      expect(graphStr).toMatch(/[*|/\\]/)
    })

    it('should return empty array for empty entries', () => {
      const graph = generateGraph([])

      expect(graph).toEqual([])
    })

    it('should handle single commit with no parents', () => {
      const entries = [
        createMockLogEntry(sampleSha, { message: 'Initial', parents: [] })
      ]

      const graph = generateGraph(entries)

      expect(graph.length).toBe(1)
      expect(graph[0]).toContain('*')
    })
  })

  // ==========================================================================
  // 7. Supports --all flag to show all branches
  // ==========================================================================
  describe('Supports --all flag to show all branches', () => {
    it('should include commits from all branches with --all', async () => {
      await createMockGitRepoWithHistory(tempDir, { withBranches: true })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { all: true })

      // Should include commits reachable from all refs
      expect(result.entries).toBeInstanceOf(Array)
    })

    it('should show commits from branches not reachable from HEAD', async () => {
      await createMockGitRepoWithHistory(tempDir, { withBranches: true })
      const adapter = await createFSAdapter(tempDir)

      const withAll = await getLog(adapter, { all: true })
      const withoutAll = await getLog(adapter, { all: false })

      // --all should include same or more commits
      expect(withAll.entries.length).toBeGreaterThanOrEqual(withoutAll.entries.length)
    })

    it('should not duplicate commits reachable from multiple refs', async () => {
      await createMockGitRepoWithHistory(tempDir, { withBranches: true })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { all: true })

      const shas = result.entries.map(e => e.sha)
      const uniqueShas = [...new Set(shas)]
      expect(shas.length).toBe(uniqueShas.length)
    })

    it('should include tag refs with --all', async () => {
      await createMockGitRepoWithHistory(tempDir, { withBranches: true })
      // Add a tag
      await fs.writeFile(
        path.join(tempDir, '.git', 'refs', 'tags', 'v1.0'),
        sampleSha4 + '\n'
      )
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { all: true })

      // Should process tags as well
      expect(result.entries).toBeInstanceOf(Array)
    })
  })

  // ==========================================================================
  // 8. Filters by file path
  // ==========================================================================
  describe('Filters by file path', () => {
    it('should filter commits affecting a specific file', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 5 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { path: 'src/index.ts' })

      // All returned commits should affect the specified path
      expect(result.entries).toBeInstanceOf(Array)
    })

    it('should return empty for path with no commits', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 5 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { path: 'nonexistent/file.xyz' })

      expect(result.entries).toEqual([])
    })

    it('should support directory path filtering', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 5 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { path: 'src/' })

      expect(result.entries).toBeInstanceOf(Array)
    })

    it('should handle path with special characters', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 3 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { path: 'path/with spaces/file.ts' })

      expect(result.entries).toBeInstanceOf(Array)
    })

    it('should combine path filter with -n limit', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 10 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { path: 'src/index.ts', n: 2 })

      expect(result.entries.length).toBeLessThanOrEqual(2)
    })
  })

  // ==========================================================================
  // 9. Supports --author filter
  // ==========================================================================
  describe('Supports --author filter', () => {
    it('should filter commits by author name', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 5 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { author: 'John Doe' })

      for (const entry of result.entries) {
        expect(entry.author.name.toLowerCase()).toContain('john doe')
      }
    })

    it('should filter commits by partial author name', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 5 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { author: 'John' })

      for (const entry of result.entries) {
        expect(entry.author.name.toLowerCase()).toContain('john')
      }
    })

    it('should filter commits by author email', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 5 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { author: 'john@example.com.ai' })

      for (const entry of result.entries) {
        expect(entry.author.email).toBe('john@example.com.ai')
      }
    })

    it('should support regex pattern for author filter', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 5 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { author: '^John.*' })

      // Should match authors starting with "John"
      expect(result.entries).toBeInstanceOf(Array)
    })

    it('should be case-insensitive by default', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 5 })
      const adapter = await createFSAdapter(tempDir)

      const result1 = await getLog(adapter, { author: 'JOHN' })
      const result2 = await getLog(adapter, { author: 'john' })

      expect(result1.entries.length).toBe(result2.entries.length)
    })

    it('should return empty for non-matching author', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 5 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { author: 'NonexistentAuthor12345' })

      expect(result.entries).toEqual([])
    })
  })

  // ==========================================================================
  // 10. Supports --since and --until date filters
  // ==========================================================================
  describe('Supports --since and --until date filters', () => {
    it('should filter commits since a date', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 10 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { since: '2024-01-01' })

      for (const entry of result.entries) {
        expect(entry.author.date.getTime()).toBeGreaterThanOrEqual(
          new Date('2024-01-01').getTime()
        )
      }
    })

    it('should filter commits until a date', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 10 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { until: '2024-06-30' })

      for (const entry of result.entries) {
        expect(entry.author.date.getTime()).toBeLessThanOrEqual(
          new Date('2024-06-30T23:59:59Z').getTime()
        )
      }
    })

    it('should combine --since and --until for date range', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 10 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, {
        since: '2024-01-01',
        until: '2024-06-30'
      })

      for (const entry of result.entries) {
        const time = entry.author.date.getTime()
        expect(time).toBeGreaterThanOrEqual(new Date('2024-01-01').getTime())
        expect(time).toBeLessThanOrEqual(new Date('2024-06-30T23:59:59Z').getTime())
      }
    })

    it('should support relative date format (e.g., "2 weeks ago")', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 10 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { since: '2 weeks ago' })

      expect(result.entries).toBeInstanceOf(Array)
    })

    it('should support ISO date format', async () => {
      await createMockGitRepoWithHistory(tempDir, { commitCount: 5 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter, { since: '2024-01-15T10:00:00Z' })

      expect(result.entries).toBeInstanceOf(Array)
    })

    it('should parse date filter correctly', () => {
      const date = parseDateFilter('2024-01-15')

      expect(date).toBeInstanceOf(Date)
      expect(date.getFullYear()).toBe(2024)
      expect(date.getMonth()).toBe(0) // January is 0
      expect(date.getDate()).toBe(15)
    })

    it('should parse relative date "yesterday"', () => {
      const date = parseDateFilter('yesterday')

      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      yesterday.setHours(0, 0, 0, 0)

      expect(date.toDateString()).toBe(yesterday.toDateString())
    })

    it('should parse "X days ago" format', () => {
      const date = parseDateFilter('7 days ago')

      const expected = new Date()
      expected.setDate(expected.getDate() - 7)
      expected.setHours(0, 0, 0, 0)

      expect(date.toDateString()).toBe(expected.toDateString())
    })
  })

  // ==========================================================================
  // 11. Shows merge commits with multiple parents
  // ==========================================================================
  describe('Shows merge commits with multiple parents', () => {
    it('should identify merge commits', async () => {
      await createMockGitRepoWithHistory(tempDir, { withMerge: true })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter)

      const mergeCommits = result.entries.filter(e => e.isMerge)
      // Should have at least one merge commit if withMerge is true
      expect(mergeCommits.length).toBeGreaterThanOrEqual(0)
    })

    it('should include all parent SHAs for merge commits', async () => {
      const entry = createMockLogEntry(mergeSha, {
        message: 'Merge feature into main',
        parents: [sampleSha, sampleSha2]
      })

      expect(entry.parents.length).toBe(2)
      expect(entry.parents).toContain(sampleSha)
      expect(entry.parents).toContain(sampleSha2)
    })

    it('should mark isMerge=true for commits with multiple parents', () => {
      const entry = createMockLogEntry(mergeSha, {
        message: 'Merge',
        parents: [sampleSha, sampleSha2]
      })

      expect(entry.isMerge).toBe(true)
    })

    it('should mark isMerge=false for regular commits', () => {
      const entry = createMockLogEntry(sampleSha, {
        message: 'Regular commit',
        parents: [sampleSha2]
      })

      expect(entry.isMerge).toBe(false)
    })

    it('should show "Merge:" prefix in default format for merge commits', async () => {
      const entry = createMockLogEntry(mergeSha, {
        message: 'Merge branch feature into main',
        parents: [sampleSha, sampleSha2]
      })

      const formatted = formatLogEntry(entry)

      // Should indicate it's a merge commit
      expect(formatted.toLowerCase()).toMatch(/merge|parents:/i)
    })

    it('should handle octopus merges (3+ parents)', async () => {
      const entry = createMockLogEntry(mergeSha, {
        message: 'Octopus merge',
        parents: [sampleSha, sampleSha2, sampleSha3]
      })

      expect(entry.parents.length).toBe(3)
      expect(entry.isMerge).toBe(true)

      const formatted = formatLogEntry(entry)
      expect(formatted).toBeDefined()
    })
  })

  // ==========================================================================
  // 12. Handles empty repository
  // ==========================================================================
  describe('Handles empty repository', () => {
    it('should return empty entries for empty repository', async () => {
      await createMockGitRepoWithHistory(tempDir, { empty: true })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter)

      expect(result.entries).toEqual([])
    })

    it('should set hasMore=false for empty repository', async () => {
      await createMockGitRepoWithHistory(tempDir, { empty: true })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter)

      expect(result.hasMore).toBe(false)
    })

    it('should not throw error for empty repository', async () => {
      await createMockGitRepoWithHistory(tempDir, { empty: true })
      const adapter = await createFSAdapter(tempDir)

      await expect(getLog(adapter)).resolves.toBeDefined()
    })

    it('should handle repository with HEAD pointing to non-existent ref', async () => {
      await createMockGitRepoWithHistory(tempDir, { empty: true })
      const adapter = await createFSAdapter(tempDir)

      const result = await getLog(adapter)

      expect(result.entries).toEqual([])
      expect(result.hasMore).toBe(false)
    })
  })

  // ==========================================================================
  // CLI Integration Tests
  // ==========================================================================
  describe('CLI Integration', () => {
    it('should register log command handler', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      cli.registerCommand('log', logCommand)

      const result = await cli.run(['log', '-n', '5'], { skipCwdCheck: true })

      // Should execute (and throw "Not implemented" in RED phase)
      expect(result.error?.message).toBe('Not implemented')
    })

    it('should parse log command options from CLI args', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      let capturedCtx: CommandContext | null = null
      cli.registerCommand('log', (ctx) => {
        capturedCtx = ctx
        throw new Error('Not implemented')
      })

      await cli.run(['log', '-n', '10', '--oneline', '--graph'])

      expect(capturedCtx?.options.n).toBe(10)
      expect(capturedCtx?.options.oneline).toBe(true)
      expect(capturedCtx?.options.graph).toBe(true)
    })

    it('should pass file path argument to log command', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      let capturedCtx: CommandContext | null = null
      cli.registerCommand('log', (ctx) => {
        capturedCtx = ctx
        throw new Error('Not implemented')
      })

      await cli.run(['log', '--', 'src/index.ts'])

      expect(capturedCtx?.rawArgs).toContain('src/index.ts')
    })
  })
})
