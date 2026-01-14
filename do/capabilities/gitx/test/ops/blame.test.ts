import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  blame,
  blameFile,
  blameLine,
  blameRange,
  BlameStorage,
  BlameOptions,
  BlameResult,
  BlameEntry,
  BlameLineInfo,
  BlameCommitInfo,
  getBlameForCommit,
  trackContentAcrossRenames,
  detectRenames,
  buildBlameHistory,
  formatBlame,
  parseBlameOutput
} from '../../src/ops/blame'
import { CommitObject, TreeObject, TreeEntry, Author } from '../../src/types/objects'

// ============================================================================
// Test Helpers
// ============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Generate a deterministic SHA-like string for testing
 */
function makeSha(prefix: string): string {
  return prefix.padEnd(40, '0')
}

/**
 * Create sample file content as Uint8Array
 */
function content(text: string): Uint8Array {
  return encoder.encode(text)
}

/**
 * Create a mock author for testing
 */
function createAuthor(name: string = 'Test User', timestamp: number = 1704067200): Author {
  return {
    name,
    email: `${name.toLowerCase().replace(' ', '.')}@example.com.ai`,
    timestamp,
    timezone: '+0000'
  }
}

/**
 * Create a mock commit object for testing
 */
function createCommit(
  treeSha: string,
  parents: string[] = [],
  message: string = 'Test commit',
  timestamp: number = 1704067200,
  authorName: string = 'Test User'
): CommitObject {
  return {
    type: 'commit',
    data: new Uint8Array(),
    tree: treeSha,
    parents,
    author: createAuthor(authorName, timestamp),
    committer: createAuthor(authorName, timestamp),
    message
  }
}

/**
 * Create a mock tree object
 */
function createTree(entries: TreeEntry[]): TreeObject {
  return {
    type: 'tree',
    data: new Uint8Array(),
    entries
  }
}

/**
 * Create a mock blame storage implementation for testing
 */
function createMockStorage(options: {
  commits?: Map<string, CommitObject>
  trees?: Map<string, TreeObject>
  blobs?: Map<string, Uint8Array>
  refs?: Map<string, string>
  renames?: Map<string, Map<string, string>> // commitSha -> oldPath -> newPath
} = {}): BlameStorage {
  const commits = options.commits ?? new Map()
  const trees = options.trees ?? new Map()
  const blobs = options.blobs ?? new Map()
  const refs = options.refs ?? new Map()
  const renames = options.renames ?? new Map()

  return {
    async getCommit(sha: string): Promise<CommitObject | null> {
      return commits.get(sha) ?? null
    },
    async getTree(sha: string): Promise<TreeObject | null> {
      return trees.get(sha) ?? null
    },
    async getBlob(sha: string): Promise<Uint8Array | null> {
      return blobs.get(sha) ?? null
    },
    async resolveRef(ref: string): Promise<string | null> {
      return refs.get(ref) ?? null
    },
    async getFileAtCommit(sha: string, path: string): Promise<Uint8Array | null> {
      const commit = commits.get(sha)
      if (!commit) return null
      const tree = trees.get(commit.tree)
      if (!tree) return null
      const entry = tree.entries.find(e => e.name === path)
      if (!entry) return null
      return blobs.get(entry.sha) ?? null
    },
    async getRenamesInCommit(sha: string): Promise<Map<string, string>> {
      return renames.get(sha) ?? new Map()
    },
    async getParentCommit(sha: string): Promise<string | null> {
      const commit = commits.get(sha)
      if (!commit || commit.parents.length === 0) return null
      return commit.parents[0]
    }
  }
}

// Sample SHA constants
const commit1 = makeSha('commit1')
const commit2 = makeSha('commit2')
const commit3 = makeSha('commit3')
const commit4 = makeSha('commit4')
const commit5 = makeSha('commit5')

const tree1 = makeSha('tree1')
const tree2 = makeSha('tree2')
const tree3 = makeSha('tree3')
const tree4 = makeSha('tree4')
const tree5 = makeSha('tree5')

const blob1 = makeSha('blob1')
const blob2 = makeSha('blob2')
const blob3 = makeSha('blob3')
const blob4 = makeSha('blob4')
const blob5 = makeSha('blob5')

// ============================================================================
// Test Suites
// ============================================================================

describe('Blame Algorithm', () => {

  // ==========================================================================
  // Line-by-Line Attribution
  // ==========================================================================

  describe('Line-by-Line Attribution', () => {
    describe('blame', () => {
      it('should attribute each line to its original commit', async () => {
        // Commit1: Initial file with 3 lines
        // Commit2: Modify line 2
        // Expected: Line 1 -> commit1, Line 2 -> commit2, Line 3 -> commit1
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial commit', 1704067200, 'Alice')],
            [commit2, createCommit(tree2, [commit1], 'Modify line 2', 1704070800, 'Bob')]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])],
            [tree2, createTree([{ mode: '100644', name: 'file.txt', sha: blob2 }])]
          ]),
          blobs: new Map([
            [blob1, content('line1\nline2\nline3')],
            [blob2, content('line1\nmodified-line2\nline3')]
          ]),
          refs: new Map([['HEAD', commit2]])
        })

        const result = await blame(storage, 'file.txt', commit2)

        expect(result.lines).toHaveLength(3)
        expect(result.lines[0].commitSha).toBe(commit1)
        expect(result.lines[1].commitSha).toBe(commit2)
        expect(result.lines[2].commitSha).toBe(commit1)
      })

      it('should include author information for each line', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial commit', 1704067200, 'Alice')],
            [commit2, createCommit(tree2, [commit1], 'Add line', 1704070800, 'Bob')]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])],
            [tree2, createTree([{ mode: '100644', name: 'file.txt', sha: blob2 }])]
          ]),
          blobs: new Map([
            [blob1, content('original')],
            [blob2, content('original\nnew line')]
          ]),
          refs: new Map([['HEAD', commit2]])
        })

        const result = await blame(storage, 'file.txt', commit2)

        expect(result.lines[0].author).toBe('Alice')
        expect(result.lines[1].author).toBe('Bob')
      })

      it('should include timestamp for each line', async () => {
        const timestamp1 = 1704067200
        const timestamp2 = 1704070800

        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial', timestamp1, 'Alice')],
            [commit2, createCommit(tree2, [commit1], 'Update', timestamp2, 'Bob')]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])],
            [tree2, createTree([{ mode: '100644', name: 'file.txt', sha: blob2 }])]
          ]),
          blobs: new Map([
            [blob1, content('line1')],
            [blob2, content('line1\nline2')]
          ]),
          refs: new Map([['HEAD', commit2]])
        })

        const result = await blame(storage, 'file.txt', commit2)

        expect(result.lines[0].timestamp).toBe(timestamp1)
        expect(result.lines[1].timestamp).toBe(timestamp2)
      })

      it('should include line content in result', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial', 1704067200)]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])]
          ]),
          blobs: new Map([
            [blob1, content('first line\nsecond line\nthird line')]
          ]),
          refs: new Map([['HEAD', commit1]])
        })

        const result = await blame(storage, 'file.txt', commit1)

        expect(result.lines[0].content).toBe('first line')
        expect(result.lines[1].content).toBe('second line')
        expect(result.lines[2].content).toBe('third line')
      })

      it('should include original line number in result', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial', 1704067200)]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])]
          ]),
          blobs: new Map([
            [blob1, content('line1\nline2\nline3')]
          ]),
          refs: new Map([['HEAD', commit1]])
        })

        const result = await blame(storage, 'file.txt', commit1)

        expect(result.lines[0].lineNumber).toBe(1)
        expect(result.lines[1].lineNumber).toBe(2)
        expect(result.lines[2].lineNumber).toBe(3)
      })

      it('should include original line number in original commit', async () => {
        // When a line is modified, track its original line number in the original commit
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial', 1704067200)],
            [commit2, createCommit(tree2, [commit1], 'Insert line', 1704070800)]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])],
            [tree2, createTree([{ mode: '100644', name: 'file.txt', sha: blob2 }])]
          ]),
          blobs: new Map([
            [blob1, content('line1\nline2')],
            [blob2, content('inserted\nline1\nline2')] // Insert at beginning
          ]),
          refs: new Map([['HEAD', commit2]])
        })

        const result = await blame(storage, 'file.txt', commit2)

        expect(result.lines[0].originalLineNumber).toBe(1) // New line
        expect(result.lines[1].originalLineNumber).toBe(1) // Was line 1 in commit1
        expect(result.lines[2].originalLineNumber).toBe(2) // Was line 2 in commit1
      })

      it('should handle empty file', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Empty file', 1704067200)]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])]
          ]),
          blobs: new Map([
            [blob1, content('')]
          ]),
          refs: new Map([['HEAD', commit1]])
        })

        const result = await blame(storage, 'file.txt', commit1)

        expect(result.lines).toHaveLength(0)
      })

      it('should handle single line file without trailing newline', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Single line', 1704067200)]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])]
          ]),
          blobs: new Map([
            [blob1, content('single line')]
          ]),
          refs: new Map([['HEAD', commit1]])
        })

        const result = await blame(storage, 'file.txt', commit1)

        expect(result.lines).toHaveLength(1)
        expect(result.lines[0].content).toBe('single line')
      })

      it('should handle file with only newlines', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Newlines only', 1704067200)]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])]
          ]),
          blobs: new Map([
            [blob1, content('\n\n\n')]
          ]),
          refs: new Map([['HEAD', commit1]])
        })

        const result = await blame(storage, 'file.txt', commit1)

        expect(result.lines.length).toBeGreaterThan(0)
      })

      it('should throw error when file does not exist', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'No file', 1704067200)]
          ]),
          trees: new Map([
            [tree1, createTree([])]
          ]),
          refs: new Map([['HEAD', commit1]])
        })

        await expect(blame(storage, 'nonexistent.txt', commit1)).rejects.toThrow()
      })

      it('should throw error when commit does not exist', async () => {
        const storage = createMockStorage({
          commits: new Map(),
          refs: new Map()
        })

        await expect(blame(storage, 'file.txt', 'nonexistent'.padEnd(40, '0'))).rejects.toThrow()
      })
    })

    describe('blameLine', () => {
      it('should return blame info for a specific line', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial', 1704067200, 'Alice')],
            [commit2, createCommit(tree2, [commit1], 'Update', 1704070800, 'Bob')]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])],
            [tree2, createTree([{ mode: '100644', name: 'file.txt', sha: blob2 }])]
          ]),
          blobs: new Map([
            [blob1, content('line1\nline2\nline3')],
            [blob2, content('line1\nmodified\nline3')]
          ]),
          refs: new Map([['HEAD', commit2]])
        })

        const lineInfo = await blameLine(storage, 'file.txt', 2, commit2)

        expect(lineInfo.commitSha).toBe(commit2)
        expect(lineInfo.author).toBe('Bob')
      })

      it('should throw error for invalid line number', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial', 1704067200)]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])]
          ]),
          blobs: new Map([
            [blob1, content('line1\nline2')]
          ]),
          refs: new Map([['HEAD', commit1]])
        })

        await expect(blameLine(storage, 'file.txt', 0, commit1)).rejects.toThrow()
        await expect(blameLine(storage, 'file.txt', 100, commit1)).rejects.toThrow()
      })
    })
  })

  // ==========================================================================
  // Tracking Content Across Renames
  // ==========================================================================

  describe('Tracking Content Across Renames', () => {
    it('should track blame through file renames', async () => {
      // Commit1: Create old.txt
      // Commit2: Rename old.txt -> new.txt
      const storage = createMockStorage({
        commits: new Map([
          [commit1, createCommit(tree1, [], 'Create file', 1704067200, 'Alice')],
          [commit2, createCommit(tree2, [commit1], 'Rename file', 1704070800, 'Bob')]
        ]),
        trees: new Map([
          [tree1, createTree([{ mode: '100644', name: 'old.txt', sha: blob1 }])],
          [tree2, createTree([{ mode: '100644', name: 'new.txt', sha: blob1 }])] // Same blob = pure rename
        ]),
        blobs: new Map([
          [blob1, content('content')]
        ]),
        refs: new Map([['HEAD', commit2]]),
        renames: new Map([
          [commit2, new Map([['old.txt', 'new.txt']])]
        ])
      })

      const result = await blame(storage, 'new.txt', commit2, { followRenames: true })

      expect(result.lines[0].commitSha).toBe(commit1)
      expect(result.lines[0].originalPath).toBe('old.txt')
    })

    it('should track blame through multiple renames', async () => {
      // Commit1: Create a.txt
      // Commit2: Rename a.txt -> b.txt
      // Commit3: Rename b.txt -> c.txt
      const storage = createMockStorage({
        commits: new Map([
          [commit1, createCommit(tree1, [], 'Create a.txt', 1704067200, 'Alice')],
          [commit2, createCommit(tree2, [commit1], 'Rename to b.txt', 1704070800, 'Bob')],
          [commit3, createCommit(tree3, [commit2], 'Rename to c.txt', 1704074400, 'Carol')]
        ]),
        trees: new Map([
          [tree1, createTree([{ mode: '100644', name: 'a.txt', sha: blob1 }])],
          [tree2, createTree([{ mode: '100644', name: 'b.txt', sha: blob1 }])],
          [tree3, createTree([{ mode: '100644', name: 'c.txt', sha: blob1 }])]
        ]),
        blobs: new Map([
          [blob1, content('original content')]
        ]),
        refs: new Map([['HEAD', commit3]]),
        renames: new Map([
          [commit2, new Map([['a.txt', 'b.txt']])],
          [commit3, new Map([['b.txt', 'c.txt']])]
        ])
      })

      const result = await blame(storage, 'c.txt', commit3, { followRenames: true })

      expect(result.lines[0].commitSha).toBe(commit1)
      expect(result.lines[0].originalPath).toBe('a.txt')
    })

    it('should track blame through rename with modifications', async () => {
      // Commit1: Create file with content
      // Commit2: Rename and modify some lines
      const storage = createMockStorage({
        commits: new Map([
          [commit1, createCommit(tree1, [], 'Create file', 1704067200, 'Alice')],
          [commit2, createCommit(tree2, [commit1], 'Rename and modify', 1704070800, 'Bob')]
        ]),
        trees: new Map([
          [tree1, createTree([{ mode: '100644', name: 'old.txt', sha: blob1 }])],
          [tree2, createTree([{ mode: '100644', name: 'new.txt', sha: blob2 }])]
        ]),
        blobs: new Map([
          [blob1, content('line1\nline2\nline3')],
          [blob2, content('line1\nmodified\nline3')]
        ]),
        refs: new Map([['HEAD', commit2]]),
        renames: new Map([
          [commit2, new Map([['old.txt', 'new.txt']])]
        ])
      })

      const result = await blame(storage, 'new.txt', commit2, { followRenames: true })

      expect(result.lines[0].commitSha).toBe(commit1) // line1 unchanged
      expect(result.lines[0].originalPath).toBe('old.txt')
      expect(result.lines[1].commitSha).toBe(commit2) // line2 modified
      expect(result.lines[2].commitSha).toBe(commit1) // line3 unchanged
      expect(result.lines[2].originalPath).toBe('old.txt')
    })

    it('should not track renames when followRenames is false', async () => {
      const storage = createMockStorage({
        commits: new Map([
          [commit1, createCommit(tree1, [], 'Create', 1704067200, 'Alice')],
          [commit2, createCommit(tree2, [commit1], 'Rename', 1704070800, 'Bob')]
        ]),
        trees: new Map([
          [tree1, createTree([{ mode: '100644', name: 'old.txt', sha: blob1 }])],
          [tree2, createTree([{ mode: '100644', name: 'new.txt', sha: blob1 }])]
        ]),
        blobs: new Map([
          [blob1, content('content')]
        ]),
        refs: new Map([['HEAD', commit2]]),
        renames: new Map([
          [commit2, new Map([['old.txt', 'new.txt']])]
        ])
      })

      const result = await blame(storage, 'new.txt', commit2, { followRenames: false })

      // Without following renames, line should be attributed to commit2
      // as that's when new.txt "appeared"
      expect(result.lines[0].commitSha).toBe(commit2)
    })

    describe('detectRenames', () => {
      it('should detect file renames between commits', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Commit 1', 1704067200)],
            [commit2, createCommit(tree2, [commit1], 'Commit 2', 1704070800)]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'old.txt', sha: blob1 }])],
            [tree2, createTree([{ mode: '100644', name: 'new.txt', sha: blob1 }])]
          ]),
          blobs: new Map([
            [blob1, content('content')]
          ])
        })

        const renames = await detectRenames(storage, commit1, commit2)

        expect(renames.get('old.txt')).toBe('new.txt')
      })

      it('should detect renames by content similarity', async () => {
        // Files with similar content should be detected as renames
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Commit 1', 1704067200)],
            [commit2, createCommit(tree2, [commit1], 'Commit 2', 1704070800)]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'old.txt', sha: blob1 }])],
            [tree2, createTree([{ mode: '100644', name: 'new.txt', sha: blob2 }])]
          ]),
          blobs: new Map([
            [blob1, content('line1\nline2\nline3\nline4\nline5')],
            [blob2, content('line1\nline2\nline3\nline4\nline5-modified')] // >50% similar
          ])
        })

        const renames = await detectRenames(storage, commit1, commit2, { threshold: 0.5 })

        expect(renames.has('old.txt')).toBe(true)
      })

      it('should respect similarity threshold', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Commit 1', 1704067200)],
            [commit2, createCommit(tree2, [commit1], 'Commit 2', 1704070800)]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'old.txt', sha: blob1 }])],
            [tree2, createTree([{ mode: '100644', name: 'new.txt', sha: blob2 }])]
          ]),
          blobs: new Map([
            [blob1, content('original')],
            [blob2, content('completely different')] // Very different content
          ])
        })

        const renames = await detectRenames(storage, commit1, commit2, { threshold: 0.9 })

        expect(renames.has('old.txt')).toBe(false)
      })
    })

    describe('trackContentAcrossRenames', () => {
      it('should return path history through renames', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Create', 1704067200)],
            [commit2, createCommit(tree2, [commit1], 'Rename 1', 1704070800)],
            [commit3, createCommit(tree3, [commit2], 'Rename 2', 1704074400)]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'a.txt', sha: blob1 }])],
            [tree2, createTree([{ mode: '100644', name: 'b.txt', sha: blob1 }])],
            [tree3, createTree([{ mode: '100644', name: 'c.txt', sha: blob1 }])]
          ]),
          blobs: new Map([
            [blob1, content('content')]
          ]),
          renames: new Map([
            [commit2, new Map([['a.txt', 'b.txt']])],
            [commit3, new Map([['b.txt', 'c.txt']])]
          ])
        })

        const history = await trackContentAcrossRenames(storage, 'c.txt', commit3)

        expect(history).toContainEqual({ commit: commit3, path: 'c.txt' })
        expect(history).toContainEqual({ commit: commit2, path: 'b.txt' })
        expect(history).toContainEqual({ commit: commit1, path: 'a.txt' })
      })
    })
  })

  // ==========================================================================
  // Multi-Commit Blame History
  // ==========================================================================

  describe('Multi-Commit Blame History', () => {
    it('should track lines through multiple commits', async () => {
      // Commit1: Initial file
      // Commit2: Add line at beginning
      // Commit3: Modify middle line
      // Commit4: Add line at end
      const storage = createMockStorage({
        commits: new Map([
          [commit1, createCommit(tree1, [], 'Initial', 1704067200, 'Alice')],
          [commit2, createCommit(tree2, [commit1], 'Add beginning', 1704070800, 'Bob')],
          [commit3, createCommit(tree3, [commit2], 'Modify middle', 1704074400, 'Carol')],
          [commit4, createCommit(tree4, [commit3], 'Add end', 1704078000, 'Dave')]
        ]),
        trees: new Map([
          [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])],
          [tree2, createTree([{ mode: '100644', name: 'file.txt', sha: blob2 }])],
          [tree3, createTree([{ mode: '100644', name: 'file.txt', sha: blob3 }])],
          [tree4, createTree([{ mode: '100644', name: 'file.txt', sha: blob4 }])]
        ]),
        blobs: new Map([
          [blob1, content('line1\nline2')],
          [blob2, content('new first\nline1\nline2')],
          [blob3, content('new first\nline1\nmodified\nline2')],
          [blob4, content('new first\nline1\nmodified\nline2\nlast line')]
        ]),
        refs: new Map([['HEAD', commit4]])
      })

      const result = await blame(storage, 'file.txt', commit4)

      expect(result.lines).toHaveLength(5)
      expect(result.lines[0].commitSha).toBe(commit2) // new first
      expect(result.lines[1].commitSha).toBe(commit1) // line1
      expect(result.lines[2].commitSha).toBe(commit3) // modified
      expect(result.lines[3].commitSha).toBe(commit1) // line2
      expect(result.lines[4].commitSha).toBe(commit4) // last line
    })

    it('should handle deleted and re-added lines', async () => {
      // Commit1: line1, line2, line3
      // Commit2: line1, line3 (line2 deleted)
      // Commit3: line1, line2, line3 (line2 re-added)
      const storage = createMockStorage({
        commits: new Map([
          [commit1, createCommit(tree1, [], 'Initial', 1704067200, 'Alice')],
          [commit2, createCommit(tree2, [commit1], 'Delete line2', 1704070800, 'Bob')],
          [commit3, createCommit(tree3, [commit2], 'Re-add line2', 1704074400, 'Carol')]
        ]),
        trees: new Map([
          [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])],
          [tree2, createTree([{ mode: '100644', name: 'file.txt', sha: blob2 }])],
          [tree3, createTree([{ mode: '100644', name: 'file.txt', sha: blob3 }])]
        ]),
        blobs: new Map([
          [blob1, content('line1\nline2\nline3')],
          [blob2, content('line1\nline3')],
          [blob3, content('line1\nline2\nline3')]
        ]),
        refs: new Map([['HEAD', commit3]])
      })

      const result = await blame(storage, 'file.txt', commit3)

      // Re-added line should be attributed to commit3, not commit1
      expect(result.lines[0].commitSha).toBe(commit1) // line1
      expect(result.lines[1].commitSha).toBe(commit3) // line2 (re-added)
      expect(result.lines[2].commitSha).toBe(commit1) // line3
    })

    it('should handle merge commits correctly', async () => {
      // Main: commit1 -> commit2
      // Branch: commit1 -> commit3
      // Merge: commit4 (merge of commit2 and commit3)
      const storage = createMockStorage({
        commits: new Map([
          [commit1, createCommit(tree1, [], 'Initial', 1704067200, 'Alice')],
          [commit2, createCommit(tree2, [commit1], 'Main branch', 1704070800, 'Bob')],
          [commit3, createCommit(tree3, [commit1], 'Feature branch', 1704074400, 'Carol')],
          [commit4, createCommit(tree4, [commit2, commit3], 'Merge', 1704078000, 'Dave')]
        ]),
        trees: new Map([
          [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])],
          [tree2, createTree([{ mode: '100644', name: 'file.txt', sha: blob2 }])],
          [tree3, createTree([{ mode: '100644', name: 'file.txt', sha: blob3 }])],
          [tree4, createTree([{ mode: '100644', name: 'file.txt', sha: blob4 }])]
        ]),
        blobs: new Map([
          [blob1, content('line1\nline2')],
          [blob2, content('line1\nmain change\nline2')],
          [blob3, content('line1\nline2\nfeature addition')],
          [blob4, content('line1\nmain change\nline2\nfeature addition')]
        ]),
        refs: new Map([['HEAD', commit4]])
      })

      const result = await blame(storage, 'file.txt', commit4)

      expect(result.lines).toHaveLength(4)
      expect(result.lines[0].commitSha).toBe(commit1) // line1
      expect(result.lines[1].commitSha).toBe(commit2) // main change
      expect(result.lines[2].commitSha).toBe(commit1) // line2
      expect(result.lines[3].commitSha).toBe(commit3) // feature addition
    })

    describe('buildBlameHistory', () => {
      it('should build complete blame history for a line', async () => {
        // Track all changes to a specific line across commits
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial', 1704067200, 'Alice')],
            [commit2, createCommit(tree2, [commit1], 'First edit', 1704070800, 'Bob')],
            [commit3, createCommit(tree3, [commit2], 'Second edit', 1704074400, 'Carol')]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])],
            [tree2, createTree([{ mode: '100644', name: 'file.txt', sha: blob2 }])],
            [tree3, createTree([{ mode: '100644', name: 'file.txt', sha: blob3 }])]
          ]),
          blobs: new Map([
            [blob1, content('original')],
            [blob2, content('first edit')],
            [blob3, content('second edit')]
          ]),
          refs: new Map([['HEAD', commit3]])
        })

        const history = await buildBlameHistory(storage, 'file.txt', 1, commit3)

        expect(history).toHaveLength(3)
        expect(history[0].commitSha).toBe(commit3)
        expect(history[0].content).toBe('second edit')
        expect(history[1].commitSha).toBe(commit2)
        expect(history[1].content).toBe('first edit')
        expect(history[2].commitSha).toBe(commit1)
        expect(history[2].content).toBe('original')
      })
    })

    describe('getBlameForCommit', () => {
      it('should get blame at a specific historical commit', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial', 1704067200, 'Alice')],
            [commit2, createCommit(tree2, [commit1], 'Update', 1704070800, 'Bob')]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])],
            [tree2, createTree([{ mode: '100644', name: 'file.txt', sha: blob2 }])]
          ]),
          blobs: new Map([
            [blob1, content('line1\nline2')],
            [blob2, content('line1\nmodified')]
          ]),
          refs: new Map([['HEAD', commit2]])
        })

        // Get blame at commit1 (historical)
        const result = await getBlameForCommit(storage, 'file.txt', commit1)

        expect(result.lines).toHaveLength(2)
        expect(result.lines[0].commitSha).toBe(commit1)
        expect(result.lines[1].commitSha).toBe(commit1)
      })
    })
  })

  // ==========================================================================
  // Range Blame (Specific Line Ranges)
  // ==========================================================================

  describe('Range Blame (Specific Line Ranges)', () => {
    describe('blameRange', () => {
      it('should return blame for a specific line range', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial', 1704067200, 'Alice')],
            [commit2, createCommit(tree2, [commit1], 'Update', 1704070800, 'Bob')]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])],
            [tree2, createTree([{ mode: '100644', name: 'file.txt', sha: blob2 }])]
          ]),
          blobs: new Map([
            [blob1, content('line1\nline2\nline3\nline4\nline5')],
            [blob2, content('line1\nmodified2\nmodified3\nline4\nline5')]
          ]),
          refs: new Map([['HEAD', commit2]])
        })

        const result = await blameRange(storage, 'file.txt', 2, 4, commit2)

        expect(result.lines).toHaveLength(3)
        expect(result.lines[0].lineNumber).toBe(2)
        expect(result.lines[1].lineNumber).toBe(3)
        expect(result.lines[2].lineNumber).toBe(4)
      })

      it('should throw error for invalid range', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial', 1704067200)]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])]
          ]),
          blobs: new Map([
            [blob1, content('line1\nline2\nline3')]
          ]),
          refs: new Map([['HEAD', commit1]])
        })

        // End before start
        await expect(blameRange(storage, 'file.txt', 3, 1, commit1)).rejects.toThrow()

        // Start less than 1
        await expect(blameRange(storage, 'file.txt', 0, 2, commit1)).rejects.toThrow()

        // End beyond file
        await expect(blameRange(storage, 'file.txt', 1, 100, commit1)).rejects.toThrow()
      })

      it('should handle range of single line', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial', 1704067200)]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])]
          ]),
          blobs: new Map([
            [blob1, content('line1\nline2\nline3')]
          ]),
          refs: new Map([['HEAD', commit1]])
        })

        const result = await blameRange(storage, 'file.txt', 2, 2, commit1)

        expect(result.lines).toHaveLength(1)
        expect(result.lines[0].lineNumber).toBe(2)
        expect(result.lines[0].content).toBe('line2')
      })

      it('should handle range at end of file', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial', 1704067200)]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])]
          ]),
          blobs: new Map([
            [blob1, content('line1\nline2\nline3\nline4\nline5')]
          ]),
          refs: new Map([['HEAD', commit1]])
        })

        const result = await blameRange(storage, 'file.txt', 4, 5, commit1)

        expect(result.lines).toHaveLength(2)
        expect(result.lines[0].lineNumber).toBe(4)
        expect(result.lines[1].lineNumber).toBe(5)
      })
    })

    describe('blame with -L option', () => {
      it('should support git-style -L line range', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial', 1704067200)]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])]
          ]),
          blobs: new Map([
            [blob1, content('line1\nline2\nline3\nline4\nline5')]
          ]),
          refs: new Map([['HEAD', commit1]])
        })

        const result = await blame(storage, 'file.txt', commit1, { lineRange: '2,4' })

        expect(result.lines).toHaveLength(3)
        expect(result.lines[0].lineNumber).toBe(2)
      })

      it('should support -L with relative offset', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial', 1704067200)]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])]
          ]),
          blobs: new Map([
            [blob1, content('line1\nline2\nline3\nline4\nline5')]
          ]),
          refs: new Map([['HEAD', commit1]])
        })

        // "2,+3" means from line 2, include 3 more lines (2,3,4,5)
        const result = await blame(storage, 'file.txt', commit1, { lineRange: '2,+3' })

        expect(result.lines).toHaveLength(4)
      })

      it('should support -L with regex pattern', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial', 1704067200)]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])]
          ]),
          blobs: new Map([
            [blob1, content('function foo() {\n  return 1;\n}\n\nfunction bar() {\n  return 2;\n}')]
          ]),
          refs: new Map([['HEAD', commit1]])
        })

        // Find the function "foo" and blame its contents
        const result = await blame(storage, 'file.txt', commit1, { lineRange: '/function foo/,/^}/' })

        expect(result.lines.length).toBeGreaterThan(0)
        expect(result.lines[0].content).toContain('function foo')
      })
    })
  })

  // ==========================================================================
  // Blame Output Formatting
  // ==========================================================================

  describe('Blame Output Formatting', () => {
    describe('formatBlame', () => {
      it('should format blame in default format', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial commit', 1704067200, 'Alice')]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])]
          ]),
          blobs: new Map([
            [blob1, content('line1\nline2')]
          ]),
          refs: new Map([['HEAD', commit1]])
        })

        const result = await blame(storage, 'file.txt', commit1)
        const formatted = formatBlame(result)

        expect(formatted).toContain(commit1.substring(0, 8))
        expect(formatted).toContain('Alice')
        expect(formatted).toContain('line1')
      })

      it('should format blame in porcelain format', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial', 1704067200, 'Alice')]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])]
          ]),
          blobs: new Map([
            [blob1, content('line1')]
          ]),
          refs: new Map([['HEAD', commit1]])
        })

        const result = await blame(storage, 'file.txt', commit1)
        const formatted = formatBlame(result, { format: 'porcelain' })

        // Porcelain format should include full SHA
        expect(formatted).toContain(commit1)
        expect(formatted).toContain('author Alice')
        expect(formatted).toContain('author-mail')
        expect(formatted).toContain('author-time')
      })

      it('should format blame with line numbers', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial', 1704067200)]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])]
          ]),
          blobs: new Map([
            [blob1, content('line1\nline2\nline3')]
          ]),
          refs: new Map([['HEAD', commit1]])
        })

        const result = await blame(storage, 'file.txt', commit1)
        const formatted = formatBlame(result, { showLineNumbers: true })

        expect(formatted).toContain('1)')
        expect(formatted).toContain('2)')
        expect(formatted).toContain('3)')
      })

      it('should format blame with date', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial', 1704067200)]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])]
          ]),
          blobs: new Map([
            [blob1, content('line1')]
          ]),
          refs: new Map([['HEAD', commit1]])
        })

        const result = await blame(storage, 'file.txt', commit1)
        const formatted = formatBlame(result, { showDate: true })

        expect(formatted).toMatch(/2024-01-01|Jan\s+1/)
      })

      it('should format blame with email instead of name', async () => {
        const storage = createMockStorage({
          commits: new Map([
            [commit1, createCommit(tree1, [], 'Initial', 1704067200, 'Test User')]
          ]),
          trees: new Map([
            [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])]
          ]),
          blobs: new Map([
            [blob1, content('line1')]
          ]),
          refs: new Map([['HEAD', commit1]])
        })

        const result = await blame(storage, 'file.txt', commit1)
        const formatted = formatBlame(result, { showEmail: true })

        expect(formatted).toContain('test.user@example.com.ai')
      })
    })

    describe('parseBlameOutput', () => {
      it('should parse porcelain blame output', () => {
        const porcelainOutput = `${commit1} 1 1 1
author Alice
author-mail <alice@example.com.ai>
author-time 1704067200
author-tz +0000
committer Alice
committer-mail <alice@example.com.ai>
committer-time 1704067200
committer-tz +0000
filename file.txt
\tline content here`

        const result = parseBlameOutput(porcelainOutput)

        expect(result.lines).toHaveLength(1)
        expect(result.lines[0].commitSha).toBe(commit1)
        expect(result.lines[0].author).toBe('Alice')
        expect(result.lines[0].content).toBe('line content here')
      })
    })
  })

  // ==========================================================================
  // Blame Options
  // ==========================================================================

  describe('Blame Options', () => {
    it('should respect maxCommits option', async () => {
      // Limit how far back blame will search
      const storage = createMockStorage({
        commits: new Map([
          [commit1, createCommit(tree1, [], 'Initial', 1704067200, 'Alice')],
          [commit2, createCommit(tree2, [commit1], 'Update', 1704070800, 'Bob')],
          [commit3, createCommit(tree3, [commit2], 'Latest', 1704074400, 'Carol')]
        ]),
        trees: new Map([
          [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])],
          [tree2, createTree([{ mode: '100644', name: 'file.txt', sha: blob2 }])],
          [tree3, createTree([{ mode: '100644', name: 'file.txt', sha: blob3 }])]
        ]),
        blobs: new Map([
          [blob1, content('original')],
          [blob2, content('updated')],
          [blob3, content('latest')]
        ]),
        refs: new Map([['HEAD', commit3]])
      })

      // With maxCommits=2, blame should only look at commit3 and commit2
      const result = await blame(storage, 'file.txt', commit3, { maxCommits: 2 })

      // Lines that would normally be attributed to commit1 should be
      // attributed to the oldest commit in the search window
      expect(result.options?.maxCommits).toBe(2)
    })

    it('should support --reverse option', async () => {
      // Show what revision introduced each line (vs what last touched it)
      const storage = createMockStorage({
        commits: new Map([
          [commit1, createCommit(tree1, [], 'Initial', 1704067200, 'Alice')],
          [commit2, createCommit(tree2, [commit1], 'Update', 1704070800, 'Bob')]
        ]),
        trees: new Map([
          [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])],
          [tree2, createTree([{ mode: '100644', name: 'file.txt', sha: blob2 }])]
        ]),
        blobs: new Map([
          [blob1, content('line1\nline2')],
          [blob2, content('line1\nline2')]
        ]),
        refs: new Map([['HEAD', commit2]])
      })

      const result = await blame(storage, 'file.txt', commit2, { reverse: true })

      // In reverse mode, show when lines were first introduced
      expect(result.lines[0].commitSha).toBe(commit1)
    })

    it('should support --since and --until date filters', async () => {
      const storage = createMockStorage({
        commits: new Map([
          [commit1, createCommit(tree1, [], 'Old commit', 1704067200, 'Alice')], // Jan 1
          [commit2, createCommit(tree2, [commit1], 'Recent commit', 1704240000, 'Bob')] // Jan 3
        ]),
        trees: new Map([
          [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])],
          [tree2, createTree([{ mode: '100644', name: 'file.txt', sha: blob2 }])]
        ]),
        blobs: new Map([
          [blob1, content('line1')],
          [blob2, content('line1\nline2')]
        ]),
        refs: new Map([['HEAD', commit2]])
      })

      // Only blame commits after Jan 2
      const result = await blame(storage, 'file.txt', commit2, {
        since: new Date(1704153600 * 1000) // Jan 2
      })

      // Lines from commit1 should show as "uncommitted" or attributed to boundary
      expect(result.options?.since).toBeDefined()
    })

    it('should support ignoring whitespace changes', async () => {
      const storage = createMockStorage({
        commits: new Map([
          [commit1, createCommit(tree1, [], 'Initial', 1704067200, 'Alice')],
          [commit2, createCommit(tree2, [commit1], 'Whitespace only', 1704070800, 'Bob')]
        ]),
        trees: new Map([
          [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])],
          [tree2, createTree([{ mode: '100644', name: 'file.txt', sha: blob2 }])]
        ]),
        blobs: new Map([
          [blob1, content('line1\nline2')],
          [blob2, content('line1\n  line2')] // Added whitespace to line2
        ]),
        refs: new Map([['HEAD', commit2]])
      })

      const result = await blame(storage, 'file.txt', commit2, { ignoreWhitespace: true })

      // With ignoreWhitespace, line2 should still be attributed to commit1
      expect(result.lines[1].commitSha).toBe(commit1)
    })

    it('should support ignoring specific revisions', async () => {
      const storage = createMockStorage({
        commits: new Map([
          [commit1, createCommit(tree1, [], 'Initial', 1704067200, 'Alice')],
          [commit2, createCommit(tree2, [commit1], 'Bulk reformat', 1704070800, 'Bot')],
          [commit3, createCommit(tree3, [commit2], 'Actual change', 1704074400, 'Carol')]
        ]),
        trees: new Map([
          [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])],
          [tree2, createTree([{ mode: '100644', name: 'file.txt', sha: blob2 }])],
          [tree3, createTree([{ mode: '100644', name: 'file.txt', sha: blob3 }])]
        ]),
        blobs: new Map([
          [blob1, content('line1\nline2')],
          [blob2, content('line1\nline2')], // Same content, formatting commit
          [blob3, content('line1\nline2\nline3')]
        ]),
        refs: new Map([['HEAD', commit3]])
      })

      // Ignore the bulk reformat commit
      const result = await blame(storage, 'file.txt', commit3, {
        ignoreRevisions: [commit2]
      })

      // Lines should skip commit2 in blame attribution
      expect(result.options?.ignoreRevisions).toContain(commit2)
    })
  })

  // ==========================================================================
  // Edge Cases and Error Handling
  // ==========================================================================

  describe('Edge Cases and Error Handling', () => {
    it('should handle binary files', async () => {
      const binaryContent = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00])

      const storage = createMockStorage({
        commits: new Map([
          [commit1, createCommit(tree1, [], 'Binary file', 1704067200)]
        ]),
        trees: new Map([
          [tree1, createTree([{ mode: '100644', name: 'image.png', sha: blob1 }])]
        ]),
        blobs: new Map([
          [blob1, binaryContent]
        ]),
        refs: new Map([['HEAD', commit1]])
      })

      await expect(blame(storage, 'image.png', commit1)).rejects.toThrow(/binary/)
    })

    it('should handle very large files', async () => {
      // Generate a file with many lines
      const lines = Array.from({ length: 10000 }, (_, i) => `line ${i + 1}`).join('\n')

      const storage = createMockStorage({
        commits: new Map([
          [commit1, createCommit(tree1, [], 'Large file', 1704067200)]
        ]),
        trees: new Map([
          [tree1, createTree([{ mode: '100644', name: 'large.txt', sha: blob1 }])]
        ]),
        blobs: new Map([
          [blob1, content(lines)]
        ]),
        refs: new Map([['HEAD', commit1]])
      })

      const result = await blame(storage, 'large.txt', commit1)

      expect(result.lines).toHaveLength(10000)
    })

    it('should handle unicode content', async () => {
      const storage = createMockStorage({
        commits: new Map([
          [commit1, createCommit(tree1, [], 'Unicode', 1704067200)]
        ]),
        trees: new Map([
          [tree1, createTree([{ mode: '100644', name: 'unicode.txt', sha: blob1 }])]
        ]),
        blobs: new Map([
          [blob1, content('Hello World\nBonjour\nHola')]
        ]),
        refs: new Map([['HEAD', commit1]])
      })

      const result = await blame(storage, 'unicode.txt', commit1)

      expect(result.lines).toHaveLength(3)
      expect(result.lines[0].content).toContain('Hello')
    })

    it('should handle files in subdirectories', async () => {
      const subTree = makeSha('subtree')

      const storage = createMockStorage({
        commits: new Map([
          [commit1, createCommit(tree1, [], 'Nested file', 1704067200)]
        ]),
        trees: new Map([
          [tree1, createTree([{ mode: '040000', name: 'src', sha: subTree }])],
          [subTree, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])]
        ]),
        blobs: new Map([
          [blob1, content('nested content')]
        ]),
        refs: new Map([['HEAD', commit1]])
      })

      const result = await blame(storage, 'src/file.txt', commit1)

      expect(result.lines).toHaveLength(1)
      expect(result.lines[0].content).toBe('nested content')
    })

    it('should handle symlinks', async () => {
      const storage = createMockStorage({
        commits: new Map([
          [commit1, createCommit(tree1, [], 'Symlink', 1704067200)]
        ]),
        trees: new Map([
          [tree1, createTree([
            { mode: '100644', name: 'target.txt', sha: blob1 },
            { mode: '120000', name: 'link.txt', sha: blob2 }
          ])]
        ]),
        blobs: new Map([
          [blob1, content('target content')],
          [blob2, content('target.txt')] // Symlink target
        ]),
        refs: new Map([['HEAD', commit1]])
      })

      // Blame should follow symlink and blame the target
      const result = await blame(storage, 'link.txt', commit1, { followSymlinks: true })

      expect(result.path).toBe('link.txt')
    })

    it('should handle file that was deleted and recreated', async () => {
      // Commit1: Create file
      // Commit2: Delete file
      // Commit3: Recreate file
      const storage = createMockStorage({
        commits: new Map([
          [commit1, createCommit(tree1, [], 'Create', 1704067200, 'Alice')],
          [commit2, createCommit(tree2, [commit1], 'Delete', 1704070800, 'Bob')],
          [commit3, createCommit(tree3, [commit2], 'Recreate', 1704074400, 'Carol')]
        ]),
        trees: new Map([
          [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])],
          [tree2, createTree([])], // File deleted
          [tree3, createTree([{ mode: '100644', name: 'file.txt', sha: blob3 }])]
        ]),
        blobs: new Map([
          [blob1, content('original')],
          [blob3, content('recreated')]
        ]),
        refs: new Map([['HEAD', commit3]])
      })

      const result = await blame(storage, 'file.txt', commit3)

      // Recreated file should be attributed to commit3
      expect(result.lines[0].commitSha).toBe(commit3)
    })

    it('should handle initial commit (no parent)', async () => {
      const storage = createMockStorage({
        commits: new Map([
          [commit1, createCommit(tree1, [], 'Initial', 1704067200)]
        ]),
        trees: new Map([
          [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])]
        ]),
        blobs: new Map([
          [blob1, content('first commit content')]
        ]),
        refs: new Map([['HEAD', commit1]])
      })

      const result = await blame(storage, 'file.txt', commit1)

      expect(result.lines).toHaveLength(1)
      expect(result.lines[0].commitSha).toBe(commit1)
      expect(result.commits.get(commit1)?.boundary).toBe(true)
    })

    it('should include commit summary information', async () => {
      const storage = createMockStorage({
        commits: new Map([
          [commit1, createCommit(tree1, [], 'Initial commit with detailed message', 1704067200, 'Alice')]
        ]),
        trees: new Map([
          [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])]
        ]),
        blobs: new Map([
          [blob1, content('line1')]
        ]),
        refs: new Map([['HEAD', commit1]])
      })

      const result = await blame(storage, 'file.txt', commit1)

      const commitInfo = result.commits.get(commit1)
      expect(commitInfo).toBeDefined()
      expect(commitInfo?.summary).toBe('Initial commit with detailed message')
      expect(commitInfo?.author).toBe('Alice')
    })
  })

  // ==========================================================================
  // Performance Considerations
  // ==========================================================================

  describe('Performance Considerations', () => {
    it('should efficiently handle incremental blame', async () => {
      // When blaming same file multiple times, should leverage caching
      const storage = createMockStorage({
        commits: new Map([
          [commit1, createCommit(tree1, [], 'Initial', 1704067200)]
        ]),
        trees: new Map([
          [tree1, createTree([{ mode: '100644', name: 'file.txt', sha: blob1 }])]
        ]),
        blobs: new Map([
          [blob1, content('line1\nline2\nline3')]
        ]),
        refs: new Map([['HEAD', commit1]])
      })

      // First call
      const result1 = await blame(storage, 'file.txt', commit1)

      // Second call should be faster (cached)
      const result2 = await blame(storage, 'file.txt', commit1, { useCache: true })

      expect(result1.lines).toEqual(result2.lines)
    })
  })
})
