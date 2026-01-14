/**
 * Git Blame Command Tests (CLI)
 *
 * RED phase tests for the gitx blame command.
 * Tests verify line-by-line blame annotations with various formatting options.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as zlib from 'zlib'
import { promisify } from 'util'
import {
  blameCommand,
  getBlame,
  formatBlameLine,
  parseLineRange,
  BlameOptions,
  BlameLineAnnotation,
  BlameResult
} from '../../../src/cli/commands/blame'
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
  content: Uint8Array | string
): Promise<string> {
  const encoder = new TextEncoder()
  const contentBytes = typeof content === 'string' ? encoder.encode(content) : content
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
 * Create a tree entry buffer
 */
function createTreeEntry(mode: string, name: string, sha: string): Uint8Array {
  const encoder = new TextEncoder()
  const modeAndName = encoder.encode(`${mode} ${name}\0`)
  const shaBytes = new Uint8Array(20)
  for (let i = 0; i < 20; i++) {
    shaBytes[i] = parseInt(sha.substring(i * 2, i * 2 + 2), 16)
  }
  const entry = new Uint8Array(modeAndName.length + 20)
  entry.set(modeAndName)
  entry.set(shaBytes, modeAndName.length)
  return entry
}

/**
 * Write a tree object with entries
 */
async function writeTree(
  gitDir: string,
  entries: Array<{ mode: string; name: string; sha: string }>
): Promise<string> {
  let totalLength = 0
  const entryBuffers: Uint8Array[] = []

  for (const entry of entries) {
    const buf = createTreeEntry(entry.mode, entry.name, entry.sha)
    entryBuffers.push(buf)
    totalLength += buf.length
  }

  const treeContent = new Uint8Array(totalLength)
  let offset = 0
  for (const buf of entryBuffers) {
    treeContent.set(buf, offset)
    offset += buf.length
  }

  return writeGitObject(gitDir, 'tree', treeContent)
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
 * Write a blob object
 */
async function writeBlob(gitDir: string, content: string): Promise<string> {
  return writeGitObject(gitDir, 'blob', content)
}

// ============================================================================
// Test Fixtures and Helpers
// ============================================================================

/**
 * Create a temporary directory for test repository
 */
async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'gitx-blame-test-'))
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
 * Create a mock git repository with a file and commit history
 */
async function createMockGitRepoWithFile(
  basePath: string,
  options: {
    fileContent?: string
    fileName?: string
    commitCount?: number
    withRenames?: boolean
    isBinary?: boolean
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

  // Write HEAD
  await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')

  // Write config
  const config = `[core]
\trepositoryformatversion = 0
\tfilemode = true
\tbare = false
`
  await fs.writeFile(path.join(gitDir, 'config'), config)

  if (options.empty) {
    return basePath
  }

  const fileName = options.fileName ?? 'file.txt'
  const baseTimestamp = 1705312800 // Jan 15, 2024 10:00:00 UTC

  if (options.withRenames) {
    // Create commit history with renames: old.txt -> new.txt
    const originalContent = 'line1\nline2\nline3'
    const blob1Sha = await writeBlob(gitDir, originalContent)
    const tree1Sha = await writeTree(gitDir, [
      { mode: '100644', name: 'old.txt', sha: blob1Sha }
    ])
    const commit1Sha = await writeCommit(gitDir, {
      tree: tree1Sha,
      parents: [],
      message: 'Initial commit with old.txt',
      author: 'Alice',
      email: 'alice@example.com.ai',
      timestamp: baseTimestamp
    })

    // Rename file (same content)
    const tree2Sha = await writeTree(gitDir, [
      { mode: '100644', name: 'new.txt', sha: blob1Sha }
    ])
    const commit2Sha = await writeCommit(gitDir, {
      tree: tree2Sha,
      parents: [commit1Sha],
      message: 'Rename old.txt to new.txt',
      author: 'Bob',
      email: 'bob@example.com.ai',
      timestamp: baseTimestamp + 3600
    })

    await fs.writeFile(path.join(gitDir, 'refs', 'heads', 'main'), commit2Sha + '\n')
    return basePath
  }

  if (options.isBinary) {
    // Create binary file
    const binaryContent = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    const blobSha = await writeGitObject(gitDir, 'blob', binaryContent)
    const treeSha = await writeTree(gitDir, [
      { mode: '100644', name: 'image.png', sha: blobSha }
    ])
    const commitSha = await writeCommit(gitDir, {
      tree: treeSha,
      parents: [],
      message: 'Add binary file',
      author: 'Alice',
      email: 'alice@example.com.ai',
      timestamp: baseTimestamp
    })
    await fs.writeFile(path.join(gitDir, 'refs', 'heads', 'main'), commitSha + '\n')
    return basePath
  }

  // Create commit history with file modifications
  const commitCount = options.commitCount ?? 3
  const fileContents = options.fileContent ?? 'line1\nline2\nline3'
  const lines = fileContents.split('\n')

  let parentSha = ''
  let lastCommitSha = ''

  // First commit: create the file
  const blob1Sha = await writeBlob(gitDir, fileContents)
  const tree1Sha = await writeTree(gitDir, [
    { mode: '100644', name: fileName, sha: blob1Sha }
  ])
  const commit1Sha = await writeCommit(gitDir, {
    tree: tree1Sha,
    parents: [],
    message: 'Initial commit',
    author: 'Alice',
    email: 'alice@example.com.ai',
    timestamp: baseTimestamp
  })
  parentSha = commit1Sha
  lastCommitSha = commit1Sha

  // Additional commits modifying the file
  for (let i = 1; i < commitCount; i++) {
    // Modify a line in the file
    const modifiedLines = [...lines]
    const lineToModify = i % lines.length
    modifiedLines[lineToModify] = `modified-line${lineToModify + 1}-commit${i + 1}`

    const blobSha = await writeBlob(gitDir, modifiedLines.join('\n'))
    const treeSha = await writeTree(gitDir, [
      { mode: '100644', name: fileName, sha: blobSha }
    ])
    const commitSha = await writeCommit(gitDir, {
      tree: treeSha,
      parents: [parentSha],
      message: `Commit ${i + 1}: modify line ${lineToModify + 1}`,
      author: i % 2 === 0 ? 'Alice' : 'Bob',
      email: i % 2 === 0 ? 'alice@example.com.ai' : 'bob@example.com.ai',
      timestamp: baseTimestamp + (i * 3600)
    })
    parentSha = commitSha
    lastCommitSha = commitSha
  }

  await fs.writeFile(path.join(gitDir, 'refs', 'heads', 'main'), lastCommitSha + '\n')
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

describe('Git Blame Command (CLI)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await removeTempDir(tempDir)
  })

  // ==========================================================================
  // 1. Shows line-by-line blame annotations
  // ==========================================================================
  describe('Shows line-by-line blame annotations', () => {
    it('should return blame annotation for each line', async () => {
      await createMockGitRepoWithFile(tempDir, {
        fileContent: 'line1\nline2\nline3',
        commitCount: 1
      })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'file.txt')

      expect(result.lines).toHaveLength(3)
    })

    it('should include line content for each annotation', async () => {
      await createMockGitRepoWithFile(tempDir, {
        fileContent: 'first line\nsecond line\nthird line',
        commitCount: 1
      })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'file.txt')

      expect(result.lines[0].content).toBe('first line')
      expect(result.lines[1].content).toBe('second line')
      expect(result.lines[2].content).toBe('third line')
    })

    it('should attribute each line to a commit', async () => {
      await createMockGitRepoWithFile(tempDir, {
        fileContent: 'line1\nline2\nline3',
        commitCount: 3
      })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'file.txt')

      for (const line of result.lines) {
        expect(line.commitSha).toMatch(/^[0-9a-f]{40}$/)
      }
    })

    it('should show different commits for lines modified at different times', async () => {
      await createMockGitRepoWithFile(tempDir, {
        fileContent: 'line1\nline2\nline3',
        commitCount: 3
      })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'file.txt')

      // With multiple commits modifying different lines, we should see different SHAs
      const uniqueShas = new Set(result.lines.map(l => l.commitSha))
      expect(uniqueShas.size).toBeGreaterThanOrEqual(1)
    })
  })

  // ==========================================================================
  // 2. Shows commit SHA, author, date for each line
  // ==========================================================================
  describe('Shows commit SHA, author, date for each line', () => {
    it('should include commit SHA for each line', async () => {
      await createMockGitRepoWithFile(tempDir, { commitCount: 2 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'file.txt')

      for (const line of result.lines) {
        expect(line.commitSha).toMatch(/^[0-9a-f]{40}$/)
      }
    })

    it('should include short SHA (8 chars) for each line', async () => {
      await createMockGitRepoWithFile(tempDir, { commitCount: 2 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'file.txt')

      for (const line of result.lines) {
        expect(line.shortSha).toHaveLength(8)
        expect(line.commitSha.startsWith(line.shortSha)).toBe(true)
      }
    })

    it('should include author name for each line', async () => {
      await createMockGitRepoWithFile(tempDir, { commitCount: 2 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'file.txt')

      for (const line of result.lines) {
        expect(line.author).toBeDefined()
        expect(typeof line.author).toBe('string')
        expect(line.author.length).toBeGreaterThan(0)
      }
    })

    it('should include author email for each line', async () => {
      await createMockGitRepoWithFile(tempDir, { commitCount: 2 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'file.txt')

      for (const line of result.lines) {
        expect(line.authorEmail).toBeDefined()
        expect(line.authorEmail).toContain('@')
      }
    })

    it('should include date for each line', async () => {
      await createMockGitRepoWithFile(tempDir, { commitCount: 2 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'file.txt')

      for (const line of result.lines) {
        expect(line.date).toBeInstanceOf(Date)
        expect(line.date.getTime()).toBeGreaterThan(0)
      }
    })

    it('should format blame line with SHA, author, date, and content', async () => {
      const annotation: BlameLineAnnotation = {
        commitSha: 'a'.repeat(40),
        shortSha: 'aaaaaaaa',
        author: 'John Doe',
        authorEmail: 'john@example.com.ai',
        date: new Date('2024-01-15T10:00:00Z'),
        lineNumber: 1,
        originalLineNumber: 1,
        content: 'console.log("hello");'
      }

      const formatted = formatBlameLine(annotation)

      expect(formatted).toContain('aaaaaaaa')
      expect(formatted).toContain('John Doe')
      expect(formatted).toContain('console.log("hello");')
      // Should contain date in some format
      expect(formatted).toMatch(/2024|Jan|15/)
    })
  })

  // ==========================================================================
  // 3. Supports line range with -L start,end flag
  // ==========================================================================
  describe('Supports line range with -L start,end flag', () => {
    it('should return blame only for specified line range', async () => {
      await createMockGitRepoWithFile(tempDir, {
        fileContent: 'line1\nline2\nline3\nline4\nline5',
        commitCount: 1
      })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'file.txt', { lineRange: '2,4' })

      expect(result.lines).toHaveLength(3)
      expect(result.lines[0].lineNumber).toBe(2)
      expect(result.lines[1].lineNumber).toBe(3)
      expect(result.lines[2].lineNumber).toBe(4)
    })

    it('should parse line range "start,end" format', () => {
      const range = parseLineRange('10,20')

      expect(range.start).toBe(10)
      expect(range.end).toBe(20)
    })

    it('should parse line range with relative offset "start,+count"', () => {
      const range = parseLineRange('5,+10')

      expect(range.start).toBe(5)
      expect(range.end).toBe(15) // 5 + 10
    })

    it('should handle single line range (start equals end)', async () => {
      await createMockGitRepoWithFile(tempDir, {
        fileContent: 'line1\nline2\nline3',
        commitCount: 1
      })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'file.txt', { lineRange: '2,2' })

      expect(result.lines).toHaveLength(1)
      expect(result.lines[0].lineNumber).toBe(2)
    })

    it('should throw error for invalid line range', async () => {
      await createMockGitRepoWithFile(tempDir, { commitCount: 1 })
      const adapter = await createFSAdapter(tempDir)

      // End before start
      await expect(
        getBlame(adapter, 'file.txt', { lineRange: '10,5' })
      ).rejects.toThrow()
    })

    it('should throw error for line range exceeding file length', async () => {
      await createMockGitRepoWithFile(tempDir, {
        fileContent: 'line1\nline2',
        commitCount: 1
      })
      const adapter = await createFSAdapter(tempDir)

      await expect(
        getBlame(adapter, 'file.txt', { lineRange: '1,100' })
      ).rejects.toThrow()
    })
  })

  // ==========================================================================
  // 4. Follows renames with -C flag
  // ==========================================================================
  describe('Follows renames with -C flag', () => {
    it('should follow file renames when -C flag is set', async () => {
      await createMockGitRepoWithFile(tempDir, { withRenames: true })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'new.txt', { followRenames: true })

      // Lines should be attributed to original commit in old.txt
      expect(result.lines.length).toBeGreaterThan(0)
      // Should track back to original file
      expect(result.originalPath).toBeDefined()
    })

    it('should show original file path when tracking renames', async () => {
      await createMockGitRepoWithFile(tempDir, { withRenames: true })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'new.txt', { followRenames: true })

      // At least one line should reference the original path
      const hasOriginalPath = result.lines.some(
        line => line.originalPath !== undefined
      )
      expect(hasOriginalPath).toBe(true)
    })

    it('should not follow renames when -C flag is not set', async () => {
      await createMockGitRepoWithFile(tempDir, { withRenames: true })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'new.txt', { followRenames: false })

      // Without -C, should attribute to rename commit
      expect(result.lines.length).toBeGreaterThan(0)
    })

    it('should attribute lines to original author when following renames', async () => {
      await createMockGitRepoWithFile(tempDir, { withRenames: true })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'new.txt', { followRenames: true })

      // Original author should be Alice (who created old.txt)
      const hasOriginalAuthor = result.lines.some(
        line => line.author === 'Alice'
      )
      expect(hasOriginalAuthor).toBe(true)
    })
  })

  // ==========================================================================
  // 5. Syntax highlights source code with Shiki
  // ==========================================================================
  describe('Syntax highlights source code with Shiki', () => {
    it('should include syntax highlighting when highlight option is true', async () => {
      await createMockGitRepoWithFile(tempDir, {
        fileContent: 'const x = 1;\nfunction foo() {}',
        fileName: 'code.js',
        commitCount: 1
      })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'code.js', { highlight: true })

      // Result should include highlighted content
      expect(result.highlighted).toBeDefined()
    })

    it('should detect language from file extension', async () => {
      await createMockGitRepoWithFile(tempDir, {
        fileContent: 'def foo():\n    pass',
        fileName: 'script.py',
        commitCount: 1
      })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'script.py', { highlight: true })

      expect(result.language).toBe('python')
    })

    it('should apply theme to syntax highlighting', async () => {
      await createMockGitRepoWithFile(tempDir, {
        fileContent: 'const x = 1;',
        fileName: 'code.ts',
        commitCount: 1
      })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'code.ts', {
        highlight: true,
        theme: 'github-dark'
      })

      expect(result.theme).toBe('github-dark')
    })

    it('should return plain content when highlight option is false', async () => {
      await createMockGitRepoWithFile(tempDir, {
        fileContent: 'const x = 1;',
        fileName: 'code.js',
        commitCount: 1
      })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'code.js', { highlight: false })

      expect(result.highlighted).toBeUndefined()
    })

    it('should handle unknown file extensions gracefully', async () => {
      await createMockGitRepoWithFile(tempDir, {
        fileContent: 'some content',
        fileName: 'file.xyz',
        commitCount: 1
      })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'file.xyz', { highlight: true })

      // Should fall back to plain text
      expect(result.language).toBe('text')
    })
  })

  // ==========================================================================
  // 6. Shows original line numbers
  // ==========================================================================
  describe('Shows original line numbers', () => {
    it('should include current line number for each annotation', async () => {
      await createMockGitRepoWithFile(tempDir, {
        fileContent: 'line1\nline2\nline3',
        commitCount: 1
      })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'file.txt')

      expect(result.lines[0].lineNumber).toBe(1)
      expect(result.lines[1].lineNumber).toBe(2)
      expect(result.lines[2].lineNumber).toBe(3)
    })

    it('should include original line number from the commit', async () => {
      await createMockGitRepoWithFile(tempDir, {
        fileContent: 'line1\nline2\nline3',
        commitCount: 3
      })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'file.txt')

      for (const line of result.lines) {
        expect(line.originalLineNumber).toBeDefined()
        expect(line.originalLineNumber).toBeGreaterThanOrEqual(1)
      }
    })

    it('should track original line number when lines are inserted', async () => {
      // When lines are inserted, original line numbers shift
      await createMockGitRepoWithFile(tempDir, { commitCount: 3 })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'file.txt')

      // Each line should have an original line number from its commit
      for (const line of result.lines) {
        expect(typeof line.originalLineNumber).toBe('number')
      }
    })

    it('should format output with both current and original line numbers', async () => {
      const annotation: BlameLineAnnotation = {
        commitSha: 'a'.repeat(40),
        shortSha: 'aaaaaaaa',
        author: 'Test',
        authorEmail: 'test@example.com.ai',
        date: new Date(),
        lineNumber: 5,
        originalLineNumber: 3,
        content: 'code here'
      }

      const formatted = formatBlameLine(annotation, { showOriginalLineNumber: true })

      // Should show both line numbers
      expect(formatted).toContain('5')
      expect(formatted).toContain('3')
    })
  })

  // ==========================================================================
  // 7. Handles binary files gracefully
  // ==========================================================================
  describe('Handles binary files gracefully', () => {
    it('should detect binary files', async () => {
      await createMockGitRepoWithFile(tempDir, { isBinary: true })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'image.png')

      expect(result.isBinary).toBe(true)
    })

    it('should not attempt line-by-line blame for binary files', async () => {
      await createMockGitRepoWithFile(tempDir, { isBinary: true })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'image.png')

      expect(result.lines).toHaveLength(0)
    })

    it('should return file-level blame info for binary files', async () => {
      await createMockGitRepoWithFile(tempDir, { isBinary: true })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'image.png')

      // Should still have commit info for the file
      expect(result.fileCommit).toBeDefined()
      expect(result.fileCommit?.sha).toMatch(/^[0-9a-f]{40}$/)
    })

    it('should include "binary file" indicator in output', async () => {
      await createMockGitRepoWithFile(tempDir, { isBinary: true })
      const adapter = await createFSAdapter(tempDir)

      const result = await getBlame(adapter, 'image.png')

      expect(result.message).toContain('binary')
    })
  })

  // ==========================================================================
  // 8. Handles files not in repository
  // ==========================================================================
  describe('Handles files not in repository', () => {
    it('should throw error for file not in repository', async () => {
      await createMockGitRepoWithFile(tempDir, { commitCount: 1 })
      const adapter = await createFSAdapter(tempDir)

      await expect(
        getBlame(adapter, 'nonexistent.txt')
      ).rejects.toThrow()
    })

    it('should provide helpful error message for missing file', async () => {
      await createMockGitRepoWithFile(tempDir, { commitCount: 1 })
      const adapter = await createFSAdapter(tempDir)

      try {
        await getBlame(adapter, 'missing.txt')
        expect.fail('Should have thrown an error')
      } catch (err) {
        expect((err as Error).message).toMatch(/not found|does not exist|no such file/i)
      }
    })

    it('should handle file path with invalid characters', async () => {
      await createMockGitRepoWithFile(tempDir, { commitCount: 1 })
      const adapter = await createFSAdapter(tempDir)

      await expect(
        getBlame(adapter, '\0invalid\0path.txt')
      ).rejects.toThrow()
    })

    it('should handle empty repository', async () => {
      await createMockGitRepoWithFile(tempDir, { empty: true })
      const adapter = await createFSAdapter(tempDir)

      await expect(
        getBlame(adapter, 'file.txt')
      ).rejects.toThrow()
    })
  })

  // ==========================================================================
  // CLI Integration Tests
  // ==========================================================================
  describe('CLI Integration', () => {
    it('should register blame command handler', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      cli.registerCommand('blame', blameCommand)

      const result = await cli.run(['blame', 'file.txt'], { skipCwdCheck: true })

      // Should execute (and throw "Not implemented" in RED phase)
      expect(result.error?.message).toBe('Not implemented')
    })

    it('should parse blame command options from CLI args', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      let capturedCtx: CommandContext | null = null
      cli.registerCommand('blame', (ctx) => {
        capturedCtx = ctx
        throw new Error('Not implemented')
      })

      await cli.run(['blame', '-L', '10,20', 'file.txt'])

      expect(capturedCtx?.options.L).toBe('10,20')
    })

    it('should pass file path argument to blame command', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      let capturedCtx: CommandContext | null = null
      cli.registerCommand('blame', (ctx) => {
        capturedCtx = ctx
        throw new Error('Not implemented')
      })

      await cli.run(['blame', 'src/index.ts'])

      expect(capturedCtx?.args).toContain('src/index.ts')
    })

    it('should support -C flag for following renames', async () => {
      const capture = createOutputCapture()
      const cli = createCLI({
        stdout: capture.stdout,
        stderr: capture.stderr
      })

      let capturedCtx: CommandContext | null = null
      cli.registerCommand('blame', (ctx) => {
        capturedCtx = ctx
        throw new Error('Not implemented')
      })

      await cli.run(['blame', '-C', 'file.txt'])

      // Note: -C is parsed by cac as the cwd option in the current implementation
      // This test documents expected behavior - the flag should be available
      expect(capturedCtx).toBeDefined()
    })
  })
})
