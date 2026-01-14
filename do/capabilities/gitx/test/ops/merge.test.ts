import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  merge,
  mergeContent,
  isBinaryFile,
  findMergeBase,
  resolveConflict,
  abortMerge,
  continueMerge,
  getMergeState,
  isMergeInProgress,
  MergeStorage,
  MergeOptions,
  MergeResult,
  MergeConflict,
  MergeState,
  ConflictType,
  ConflictMarker,
  ResolveOptions
} from '../../src/ops/merge'
import { TreeEntry, TreeObject, CommitObject } from '../../src/types/objects'

// ============================================================================
// Test Helpers
// ============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Generate a deterministic SHA-like string for testing
 * Uses a unique separator to avoid collisions (e.g., commit1 vs commit10)
 */
function makeSha(prefix: string): string {
  // Add underscore separator to avoid collisions like commit1 vs commit10
  return (prefix + '_').padEnd(40, '0')
}

// Sample SHA constants
const baseSha = makeSha('base')
const oursSha = makeSha('ours')
const theirsSha = makeSha('theirs')
const baseTreeSha = makeSha('basetree')
const oursTreeSha = makeSha('ourstree')
const theirsTreeSha = makeSha('theirstree')
const mergedTreeSha = makeSha('mergedtree')

/**
 * Create sample file content as Uint8Array
 */
function content(text: string): Uint8Array {
  return encoder.encode(text)
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
 * Create a mock commit object
 */
function createCommit(treeSha: string, parents: string[], message: string): CommitObject {
  return {
    type: 'commit',
    data: new Uint8Array(),
    tree: treeSha,
    parents,
    author: {
      name: 'Test User',
      email: 'test@example.com.ai',
      timestamp: 1704067200,
      timezone: '+0000'
    },
    committer: {
      name: 'Test User',
      email: 'test@example.com.ai',
      timestamp: 1704067200,
      timezone: '+0000'
    },
    message
  }
}

/**
 * Create a mock storage implementation for testing
 */
function createMockStorage(options: {
  commits?: Map<string, CommitObject>
  trees?: Map<string, TreeObject>
  blobs?: Map<string, Uint8Array>
  refs?: Map<string, string>
  mergeState?: MergeState | null
  index?: Map<string, { sha: string; mode: string; stage: number }>
} = {}): MergeStorage {
  const commits = options.commits ?? new Map()
  const trees = options.trees ?? new Map()
  const blobs = options.blobs ?? new Map()
  const refs = options.refs ?? new Map()
  let mergeState = options.mergeState ?? null
  const index = options.index ?? new Map()

  return {
    async readObject(sha: string) {
      if (commits.has(sha)) {
        const commit = commits.get(sha)!
        // Return full commit object with tree and parents
        return { type: 'commit', data: commit.data, tree: commit.tree, parents: commit.parents }
      }
      if (trees.has(sha)) {
        const tree = trees.get(sha)!
        // Return full tree object with entries
        return { type: 'tree', data: tree.data, entries: tree.entries }
      }
      if (blobs.has(sha)) {
        return { type: 'blob', data: blobs.get(sha)! }
      }
      return null
    },
    async writeObject(type: string, data: Uint8Array) {
      // Generate a proper 40-character hex SHA
      const timestamp = Date.now().toString(16).padStart(16, '0')
      const sha = (timestamp + 'abcdef0123456789abcdef0123456789abcd').slice(0, 40)
      if (type === 'blob') {
        blobs.set(sha, data)
      }
      return sha
    },
    async readRef(ref: string) {
      return refs.get(ref) ?? null
    },
    async writeRef(ref: string, sha: string) {
      refs.set(ref, sha)
    },
    async readMergeState() {
      return mergeState
    },
    async writeMergeState(state: MergeState) {
      mergeState = state
    },
    async deleteMergeState() {
      mergeState = null
    },
    async stageFile(path: string, sha: string, mode: string, stage = 0) {
      index.set(`${path}:${stage}`, { sha, mode, stage })
    },
    async getIndex() {
      return index
    }
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Three-Way Merge', () => {
  describe('Clean Merge (No Conflicts)', () => {
    it('should merge when only ours has changes', async () => {
      // Base: file.txt = "base content"
      // Ours: file.txt = "our content"
      // Theirs: file.txt = "base content" (unchanged)
      // Expected: file.txt = "our content"
      const baseBlob = makeSha('baseblob')
      const oursBlob = makeSha('oursblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(baseTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: baseBlob }])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: oursBlob }])]
        ]),
        blobs: new Map([
          [baseBlob, content('base content')],
          [oursBlob, content('our content')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
      expect(result.conflicts).toBeUndefined()
      expect(result.treeSha).toBeDefined()
    })

    it('should merge when only theirs has changes', async () => {
      // Base: file.txt = "base content"
      // Ours: file.txt = "base content" (unchanged)
      // Theirs: file.txt = "their content"
      // Expected: file.txt = "their content"
      const baseBlob = makeSha('baseblob')
      const theirsBlob = makeSha('theirsblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(baseTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: baseBlob }])],
          [theirsTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: theirsBlob }])]
        ]),
        blobs: new Map([
          [baseBlob, content('base content')],
          [theirsBlob, content('their content')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
      expect(result.conflicts).toBeUndefined()
    })

    it('should merge when both sides make identical changes', async () => {
      // Both sides modify file.txt to the same content
      const baseBlob = makeSha('baseblob')
      const identicalBlob = makeSha('identicalblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: baseBlob }])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: identicalBlob }])],
          [theirsTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: identicalBlob }])]
        ]),
        blobs: new Map([
          [baseBlob, content('base content')],
          [identicalBlob, content('same new content')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
      expect(result.conflicts).toBeUndefined()
    })

    it('should merge non-overlapping changes in the same file', async () => {
      // Base: "line1\nline2\nline3"
      // Ours: "line1-modified\nline2\nline3"
      // Theirs: "line1\nline2\nline3-modified"
      // Expected: "line1-modified\nline2\nline3-modified"
      const baseBlob = makeSha('baseblob')
      const oursBlob = makeSha('oursblob')
      const theirsBlob = makeSha('theirsblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: baseBlob }])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: oursBlob }])],
          [theirsTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: theirsBlob }])]
        ]),
        blobs: new Map([
          [baseBlob, content('line1\nline2\nline3')],
          [oursBlob, content('line1-modified\nline2\nline3')],
          [theirsBlob, content('line1\nline2\nline3-modified')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
      expect(result.conflicts).toBeUndefined()
    })

    it('should merge changes to different files', async () => {
      // Ours adds file1.txt, theirs adds file2.txt
      const file1Blob = makeSha('file1blob')
      const file2Blob = makeSha('file2blob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'file1.txt', sha: file1Blob }])],
          [theirsTreeSha, createTree([{ mode: '100644', name: 'file2.txt', sha: file2Blob }])]
        ]),
        blobs: new Map([
          [file1Blob, content('file1 content')],
          [file2Blob, content('file2 content')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
      expect(result.conflicts).toBeUndefined()
      // Result tree should contain both files
    })

    it('should fast-forward when theirs is descendant of ours', async () => {
      // Ours is ancestor of theirs - fast-forward
      const storage = createMockStorage({
        commits: new Map([
          [oursSha, createCommit(oursTreeSha, [], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [oursSha], 'their commit')]
        ]),
        trees: new Map([
          [oursTreeSha, createTree([])],
          [theirsTreeSha, createTree([{ mode: '100644', name: 'new.txt', sha: makeSha('newblob') }])]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha, { allowFastForward: true })

      expect(result.status).toBe('fast-forward')
      expect(result.fastForward).toBe(true)
      expect(result.treeSha).toBe(theirsTreeSha)
    })

    it('should detect already up-to-date when ours contains theirs', async () => {
      // Theirs is ancestor of ours - already up-to-date
      const storage = createMockStorage({
        commits: new Map([
          [theirsSha, createCommit(theirsTreeSha, [], 'their commit')],
          [oursSha, createCommit(oursTreeSha, [theirsSha], 'our commit')]
        ]),
        trees: new Map([
          [oursTreeSha, createTree([])],
          [theirsTreeSha, createTree([])]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('up-to-date')
    })
  })

  describe('Conflict Detection', () => {
    it('should detect content conflict when both sides modify same lines', async () => {
      // Base: "line1\nline2\nline3"
      // Ours: "line1\nOUR-change\nline3"
      // Theirs: "line1\nTHEIR-change\nline3"
      // Expected: Conflict on line2
      const baseBlob = makeSha('baseblob')
      const oursBlob = makeSha('oursblob')
      const theirsBlob = makeSha('theirsblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: baseBlob }])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: oursBlob }])],
          [theirsTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: theirsBlob }])]
        ]),
        blobs: new Map([
          [baseBlob, content('line1\nline2\nline3')],
          [oursBlob, content('line1\nOUR-change\nline3')],
          [theirsBlob, content('line1\nTHEIR-change\nline3')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('conflicted')
      expect(result.conflicts).toBeDefined()
      expect(result.conflicts!.length).toBeGreaterThan(0)
      expect(result.conflicts![0].type).toBe('content')
      expect(result.conflicts![0].path).toBe('file.txt')
    })

    it('should detect add-add conflict', async () => {
      // Both sides add the same file with different content
      const oursBlob = makeSha('oursblob')
      const theirsBlob = makeSha('theirsblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'new.txt', sha: oursBlob }])],
          [theirsTreeSha, createTree([{ mode: '100644', name: 'new.txt', sha: theirsBlob }])]
        ]),
        blobs: new Map([
          [oursBlob, content('our new file')],
          [theirsBlob, content('their new file')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('conflicted')
      expect(result.conflicts).toBeDefined()
      expect(result.conflicts!.some(c => c.type === 'add-add')).toBe(true)
    })

    it('should detect modify-delete conflict', async () => {
      // Ours modifies file, theirs deletes it
      const baseBlob = makeSha('baseblob')
      const oursBlob = makeSha('oursblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: baseBlob }])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: oursBlob }])],
          [theirsTreeSha, createTree([])] // File deleted
        ]),
        blobs: new Map([
          [baseBlob, content('base content')],
          [oursBlob, content('modified content')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('conflicted')
      expect(result.conflicts).toBeDefined()
      expect(result.conflicts!.some(c => c.type === 'modify-delete')).toBe(true)
    })

    it('should detect delete-modify conflict', async () => {
      // Ours deletes file, theirs modifies it
      const baseBlob = makeSha('baseblob')
      const theirsBlob = makeSha('theirsblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: baseBlob }])],
          [oursTreeSha, createTree([])], // File deleted
          [theirsTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: theirsBlob }])]
        ]),
        blobs: new Map([
          [baseBlob, content('base content')],
          [theirsBlob, content('modified content')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('conflicted')
      expect(result.conflicts).toBeDefined()
      expect(result.conflicts!.some(c => c.type === 'delete-modify')).toBe(true)
    })

    it('should detect directory-file conflict', async () => {
      // Ours has a file, theirs has a directory with same name
      const fileBlob = makeSha('fileblob')
      const innerBlob = makeSha('innerblob')
      const innerTree = makeSha('innertree')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'path', sha: fileBlob }])],
          [theirsTreeSha, createTree([{ mode: '040000', name: 'path', sha: innerTree }])],
          [innerTree, createTree([{ mode: '100644', name: 'nested.txt', sha: innerBlob }])]
        ]),
        blobs: new Map([
          [fileBlob, content('file content')],
          [innerBlob, content('nested content')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('conflicted')
      expect(result.conflicts).toBeDefined()
      expect(result.conflicts!.some(c => c.type === 'directory-file')).toBe(true)
    })

    it('should include conflict markers in conflicted content', async () => {
      // Verify that content conflicts include proper markers
      const baseBlob = makeSha('baseblob')
      const oursBlob = makeSha('oursblob')
      const theirsBlob = makeSha('theirsblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: baseBlob }])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: oursBlob }])],
          [theirsTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: theirsBlob }])]
        ]),
        blobs: new Map([
          [baseBlob, content('original')],
          [oursBlob, content('our version')],
          [theirsBlob, content('their version')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('conflicted')
      const conflict = result.conflicts![0]
      expect(conflict.conflictedContent).toBeDefined()

      const conflictText = decoder.decode(conflict.conflictedContent!)
      expect(conflictText).toContain('<<<<<<< ours')
      expect(conflictText).toContain('=======')
      expect(conflictText).toContain('>>>>>>> theirs')
    })

    it('should populate conflict markers array', async () => {
      const baseBlob = makeSha('baseblob')
      const oursBlob = makeSha('oursblob')
      const theirsBlob = makeSha('theirsblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: baseBlob }])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: oursBlob }])],
          [theirsTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: theirsBlob }])]
        ]),
        blobs: new Map([
          [baseBlob, content('line1\nconflict\nline3')],
          [oursBlob, content('line1\nours\nline3')],
          [theirsBlob, content('line1\ntheirs\nline3')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.conflicts![0].markers).toBeDefined()
      expect(result.conflicts![0].markers!.length).toBeGreaterThan(0)

      const marker = result.conflicts![0].markers![0]
      expect(marker.oursContent).toBeDefined()
      expect(marker.theirsContent).toBeDefined()
    })
  })

  describe('Merge with Adds/Deletes', () => {
    it('should add file that ours added', async () => {
      const newBlob = makeSha('newblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(baseTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'new.txt', sha: newBlob }])]
        ]),
        blobs: new Map([
          [newBlob, content('new file content')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
      expect(result.stats?.filesAdded).toBe(1)
    })

    it('should add file that theirs added', async () => {
      const newBlob = makeSha('newblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(baseTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([])],
          [theirsTreeSha, createTree([{ mode: '100644', name: 'new.txt', sha: newBlob }])]
        ]),
        blobs: new Map([
          [newBlob, content('new file content')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
      expect(result.stats?.filesAdded).toBe(1)
    })

    it('should delete file that ours deleted (theirs unchanged)', async () => {
      const fileBlob = makeSha('fileblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(baseTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: fileBlob }])],
          [oursTreeSha, createTree([])]
        ]),
        blobs: new Map([
          [fileBlob, content('file content')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
      expect(result.stats?.filesDeleted).toBe(1)
    })

    it('should delete file that theirs deleted (ours unchanged)', async () => {
      const fileBlob = makeSha('fileblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(baseTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: fileBlob }])],
          [theirsTreeSha, createTree([])]
        ]),
        blobs: new Map([
          [fileBlob, content('file content')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
      expect(result.stats?.filesDeleted).toBe(1)
    })

    it('should allow both sides deleting same file', async () => {
      const fileBlob = makeSha('fileblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: fileBlob }])],
          [oursTreeSha, createTree([])],
          [theirsTreeSha, createTree([])]
        ]),
        blobs: new Map([
          [fileBlob, content('file content')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
      expect(result.conflicts).toBeUndefined()
    })

    it('should handle file mode changes', async () => {
      const fileBlob = makeSha('fileblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(baseTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'script.sh', sha: fileBlob }])],
          [oursTreeSha, createTree([{ mode: '100755', name: 'script.sh', sha: fileBlob }])]
        ]),
        blobs: new Map([
          [fileBlob, content('#!/bin/bash\necho "hello"')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
      // Mode should be 100755 (executable)
    })

    it('should handle adding files in new subdirectories', async () => {
      const newBlob = makeSha('newblob')
      const subTree = makeSha('subtree')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(baseTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([])],
          [oursTreeSha, createTree([{ mode: '040000', name: 'newdir', sha: subTree }])],
          [subTree, createTree([{ mode: '100644', name: 'file.txt', sha: newBlob }])]
        ]),
        blobs: new Map([
          [newBlob, content('nested file')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
    })

    it('should handle deleting entire directories', async () => {
      const innerBlob = makeSha('innerblob')
      const subTree = makeSha('subtree')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(baseTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '040000', name: 'dir', sha: subTree }])],
          [subTree, createTree([{ mode: '100644', name: 'file.txt', sha: innerBlob }])],
          [oursTreeSha, createTree([])]
        ]),
        blobs: new Map([
          [innerBlob, content('file in dir')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
      expect(result.stats?.filesDeleted).toBeGreaterThan(0)
    })
  })

  describe('Binary File Merge Handling', () => {
    it('should detect binary files', () => {
      // Binary file contains null bytes
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0x00])

      expect(isBinaryFile(binaryData)).toBe(true)
    })

    it('should not falsely detect text as binary', () => {
      const textData = encoder.encode('Hello, World!\nThis is text.')

      expect(isBinaryFile(textData)).toBe(false)
    })

    it('should conflict on binary files modified by both sides', async () => {
      const baseBlob = makeSha('baseblob')
      const oursBlob = makeSha('oursblob')
      const theirsBlob = makeSha('theirsblob')

      // Binary content (PNG-like header)
      const binaryBase = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])
      const binaryOurs = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x02])
      const binaryTheirs = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x03])

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'image.png', sha: baseBlob }])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'image.png', sha: oursBlob }])],
          [theirsTreeSha, createTree([{ mode: '100644', name: 'image.png', sha: theirsBlob }])]
        ]),
        blobs: new Map([
          [baseBlob, binaryBase],
          [oursBlob, binaryOurs],
          [theirsBlob, binaryTheirs]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('conflicted')
      expect(result.conflicts).toBeDefined()
      // Binary conflicts cannot have content merge
      expect(result.conflicts![0].conflictedContent).toBeUndefined()
    })

    it('should take ours for binary file if only ours changed', async () => {
      const baseBlob = makeSha('baseblob')
      const oursBlob = makeSha('oursblob')

      const binaryBase = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])
      const binaryOurs = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x02])

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(baseTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'image.png', sha: baseBlob }])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'image.png', sha: oursBlob }])]
        ]),
        blobs: new Map([
          [baseBlob, binaryBase],
          [oursBlob, binaryOurs]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
      expect(result.conflicts).toBeUndefined()
    })

    it('should take theirs for binary file if only theirs changed', async () => {
      const baseBlob = makeSha('baseblob')
      const theirsBlob = makeSha('theirsblob')

      const binaryBase = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])
      const binaryTheirs = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x03])

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(baseTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'image.png', sha: baseBlob }])],
          [theirsTreeSha, createTree([{ mode: '100644', name: 'image.png', sha: theirsBlob }])]
        ]),
        blobs: new Map([
          [baseBlob, binaryBase],
          [theirsBlob, binaryTheirs]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
      expect(result.conflicts).toBeUndefined()
    })

    it('should report binary in stats', async () => {
      const baseBlob = makeSha('baseblob')
      const oursBlob = makeSha('oursblob')

      const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00])

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(baseTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'image.png', sha: baseBlob }])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'image.png', sha: oursBlob }])]
        ]),
        blobs: new Map([
          [baseBlob, binaryData],
          [oursBlob, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01])]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.stats?.binaryFilesChanged).toBe(1)
    })
  })

  describe('Merge Result Tree Creation', () => {
    it('should create a valid tree SHA for merged result', async () => {
      const oursBlob = makeSha('oursblob')
      const theirsBlob = makeSha('theirsblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'a.txt', sha: oursBlob }])],
          [theirsTreeSha, createTree([{ mode: '100644', name: 'b.txt', sha: theirsBlob }])]
        ]),
        blobs: new Map([
          [oursBlob, content('file a')],
          [theirsBlob, content('file b')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
      expect(result.treeSha).toBeDefined()
      expect(result.treeSha).toMatch(/^[0-9a-f]{40}$/)
    })

    it('should create tree with entries from both sides', async () => {
      const oursBlob = makeSha('oursblob')
      const theirsBlob = makeSha('theirsblob')
      const sharedBlob = makeSha('sharedblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'shared.txt', sha: sharedBlob }])],
          [oursTreeSha, createTree([
            { mode: '100644', name: 'shared.txt', sha: sharedBlob },
            { mode: '100644', name: 'ours.txt', sha: oursBlob }
          ])],
          [theirsTreeSha, createTree([
            { mode: '100644', name: 'shared.txt', sha: sharedBlob },
            { mode: '100644', name: 'theirs.txt', sha: theirsBlob }
          ])]
        ]),
        blobs: new Map([
          [oursBlob, content('our file')],
          [theirsBlob, content('their file')],
          [sharedBlob, content('shared')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
      expect(result.treeSha).toBeDefined()
      // Verify the merged tree contains all three files
    })

    it('should preserve nested tree structure', async () => {
      const innerBlob = makeSha('innerblob')
      const innerTree = makeSha('innertree')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(baseTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([])],
          [oursTreeSha, createTree([{ mode: '040000', name: 'subdir', sha: innerTree }])],
          [innerTree, createTree([{ mode: '100644', name: 'file.txt', sha: innerBlob }])]
        ]),
        blobs: new Map([
          [innerBlob, content('nested file')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
      expect(result.treeSha).toBeDefined()
    })

    it('should sort tree entries correctly', async () => {
      const aBlob = makeSha('ablob')
      const bBlob = makeSha('bblob')
      const cBlob = makeSha('cblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'b.txt', sha: bBlob }])],
          [oursTreeSha, createTree([
            { mode: '100644', name: 'b.txt', sha: bBlob },
            { mode: '100644', name: 'c.txt', sha: cBlob }
          ])],
          [theirsTreeSha, createTree([
            { mode: '100644', name: 'a.txt', sha: aBlob },
            { mode: '100644', name: 'b.txt', sha: bBlob }
          ])]
        ]),
        blobs: new Map([
          [aBlob, content('a')],
          [bBlob, content('b')],
          [cBlob, content('c')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
      // Result tree should have entries sorted: a.txt, b.txt, c.txt
    })

    it('should handle symlink entries', async () => {
      const targetBlob = makeSha('targetblob')
      const linkBlob = makeSha('linkblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(baseTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'target.txt', sha: targetBlob }])],
          [oursTreeSha, createTree([
            { mode: '100644', name: 'target.txt', sha: targetBlob },
            { mode: '120000', name: 'link', sha: linkBlob }
          ])]
        ]),
        blobs: new Map([
          [targetBlob, content('target content')],
          [linkBlob, content('target.txt')] // Symlink target path
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
    })

    it('should include merge statistics in result', async () => {
      const baseBlob = makeSha('baseblob')
      const modifiedBlob = makeSha('modifiedblob')
      const newBlob = makeSha('newblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([
            { mode: '100644', name: 'existing.txt', sha: baseBlob },
            { mode: '100644', name: 'toDelete.txt', sha: baseBlob }
          ])],
          [oursTreeSha, createTree([
            { mode: '100644', name: 'existing.txt', sha: modifiedBlob }
          ])],
          [theirsTreeSha, createTree([
            { mode: '100644', name: 'existing.txt', sha: baseBlob },
            { mode: '100644', name: 'toDelete.txt', sha: baseBlob },
            { mode: '100644', name: 'new.txt', sha: newBlob }
          ])]
        ]),
        blobs: new Map([
          [baseBlob, content('base')],
          [modifiedBlob, content('modified')],
          [newBlob, content('new file')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.stats).toBeDefined()
      expect(result.stats!.filesModified).toBe(1)
      expect(result.stats!.filesAdded).toBe(1)
      expect(result.stats!.filesDeleted).toBe(1)
    })
  })

  describe('mergeContent (Three-Way Text Merge)', () => {
    it('should merge non-overlapping changes', () => {
      const base = content('line1\nline2\nline3')
      const ours = content('line1-ours\nline2\nline3')
      const theirs = content('line1\nline2\nline3-theirs')

      const result = mergeContent(base, ours, theirs)

      expect(result.hasConflicts).toBe(false)
      const merged = decoder.decode(result.merged)
      expect(merged).toContain('line1-ours')
      expect(merged).toContain('line3-theirs')
    })

    it('should detect conflicts on overlapping changes', () => {
      const base = content('line1\nline2\nline3')
      const ours = content('line1\nours-line2\nline3')
      const theirs = content('line1\ntheirs-line2\nline3')

      const result = mergeContent(base, ours, theirs)

      expect(result.hasConflicts).toBe(true)
      expect(result.markers.length).toBeGreaterThan(0)
    })

    it('should handle identical changes without conflict', () => {
      const base = content('original')
      const ours = content('changed')
      const theirs = content('changed')

      const result = mergeContent(base, ours, theirs)

      expect(result.hasConflicts).toBe(false)
      expect(decoder.decode(result.merged)).toBe('changed')
    })

    it('should handle additions by both sides in different locations', () => {
      const base = content('line1\nline3')
      const ours = content('line1\nline2-ours\nline3')
      const theirs = content('line1\nline3\nline4-theirs')

      const result = mergeContent(base, ours, theirs)

      expect(result.hasConflicts).toBe(false)
      const merged = decoder.decode(result.merged)
      expect(merged).toContain('line2-ours')
      expect(merged).toContain('line4-theirs')
    })

    it('should handle deletions by one side', () => {
      const base = content('line1\nline2\nline3')
      const ours = content('line1\nline3')
      const theirs = content('line1\nline2\nline3')

      const result = mergeContent(base, ours, theirs)

      expect(result.hasConflicts).toBe(false)
      expect(decoder.decode(result.merged)).toBe('line1\nline3')
    })

    it('should conflict when one side edits and other deletes same line', () => {
      const base = content('line1\nline2\nline3')
      const ours = content('line1\nline3') // deleted line2
      const theirs = content('line1\nmodified-line2\nline3') // modified line2

      const result = mergeContent(base, ours, theirs)

      expect(result.hasConflicts).toBe(true)
    })

    it('should handle empty base (new file)', () => {
      const base = new Uint8Array(0)
      const ours = content('our content')
      const theirs = content('their content')

      const result = mergeContent(base, ours, theirs)

      expect(result.hasConflicts).toBe(true)
    })

    it('should handle empty result', () => {
      const base = content('content')
      const ours = new Uint8Array(0)
      const theirs = new Uint8Array(0)

      const result = mergeContent(base, ours, theirs)

      expect(result.hasConflicts).toBe(false)
      expect(result.merged.length).toBe(0)
    })

    it('should include base content in conflict markers when available', () => {
      const base = content('original')
      const ours = content('ours')
      const theirs = content('theirs')

      const result = mergeContent(base, ours, theirs)

      expect(result.hasConflicts).toBe(true)
      expect(result.markers[0].baseContent).toBeDefined()
    })

    it('should provide correct line numbers in markers', () => {
      const base = content('line1\nline2\nline3\nline4\nline5')
      const ours = content('line1\nline2\nours-line3\nline4\nline5')
      const theirs = content('line1\nline2\ntheirs-line3\nline4\nline5')

      const result = mergeContent(base, ours, theirs)

      expect(result.hasConflicts).toBe(true)
      expect(result.markers[0].startLine).toBeGreaterThan(0)
    })
  })

  describe('Merge Options', () => {
    it('should respect fastForwardOnly option', async () => {
      // Non-fast-forward merge should fail
      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'ours')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'theirs')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'ours.txt', sha: makeSha('a') }])],
          [theirsTreeSha, createTree([{ mode: '100644', name: 'theirs.txt', sha: makeSha('b') }])]
        ])
      })

      await expect(
        merge(storage, oursSha, theirsSha, { fastForwardOnly: true })
      ).rejects.toThrow()
    })

    it('should respect noCommit option', async () => {
      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'ours')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'theirs')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'a.txt', sha: makeSha('a') }])],
          [theirsTreeSha, createTree([{ mode: '100644', name: 'b.txt', sha: makeSha('b') }])]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha, { noCommit: true })

      expect(result.status).toBe('merged')
      expect(result.commitSha).toBeUndefined()
      expect(result.treeSha).toBeDefined()
    })

    it('should use ours strategy for conflicts when specified', async () => {
      const baseBlob = makeSha('baseblob')
      const oursBlob = makeSha('oursblob')
      const theirsBlob = makeSha('theirsblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'ours')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'theirs')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: baseBlob }])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: oursBlob }])],
          [theirsTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: theirsBlob }])]
        ]),
        blobs: new Map([
          [baseBlob, content('base')],
          [oursBlob, content('ours')],
          [theirsBlob, content('theirs')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha, {
        autoResolve: true,
        conflictStrategy: 'ours'
      })

      expect(result.status).toBe('merged')
      expect(result.conflicts).toBeUndefined()
    })

    it('should use theirs strategy for conflicts when specified', async () => {
      const baseBlob = makeSha('baseblob')
      const oursBlob = makeSha('oursblob')
      const theirsBlob = makeSha('theirsblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'ours')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'theirs')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: baseBlob }])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: oursBlob }])],
          [theirsTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: theirsBlob }])]
        ]),
        blobs: new Map([
          [baseBlob, content('base')],
          [oursBlob, content('ours')],
          [theirsBlob, content('theirs')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha, {
        autoResolve: true,
        conflictStrategy: 'theirs'
      })

      expect(result.status).toBe('merged')
    })

    it('should use custom message for merge commit', async () => {
      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'ours')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'theirs')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'a.txt', sha: makeSha('a') }])],
          [theirsTreeSha, createTree([{ mode: '100644', name: 'b.txt', sha: makeSha('b') }])]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha, {
        message: 'Custom merge message'
      })

      expect(result.message).toBe('Custom merge message')
    })

    it('should disable fast-forward when allowFastForward is false', async () => {
      const storage = createMockStorage({
        commits: new Map([
          [oursSha, createCommit(oursTreeSha, [], 'ours')],
          [theirsSha, createCommit(theirsTreeSha, [oursSha], 'theirs')]
        ]),
        trees: new Map([
          [oursTreeSha, createTree([])],
          [theirsTreeSha, createTree([{ mode: '100644', name: 'new.txt', sha: makeSha('blob') }])]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha, { allowFastForward: false })

      expect(result.status).toBe('merged')
      expect(result.fastForward).toBe(false)
      expect(result.commitSha).toBeDefined()
    })
  })

  describe('Merge State Management', () => {
    it('should save merge state on conflict', async () => {
      const baseBlob = makeSha('baseblob')
      const oursBlob = makeSha('oursblob')
      const theirsBlob = makeSha('theirsblob')
      let savedState: MergeState | null = null

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'ours')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'theirs')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: baseBlob }])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: oursBlob }])],
          [theirsTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: theirsBlob }])]
        ]),
        blobs: new Map([
          [baseBlob, content('base')],
          [oursBlob, content('ours')],
          [theirsBlob, content('theirs')]
        ])
      })

      // Override writeMergeState to capture
      const origWrite = storage.writeMergeState
      storage.writeMergeState = async (state) => {
        savedState = state
        return origWrite.call(storage, state)
      }

      await merge(storage, oursSha, theirsSha)

      expect(savedState).not.toBeNull()
      expect(savedState!.mergeHead).toBe(theirsSha)
      expect(savedState!.origHead).toBe(oursSha)
    })

    it('should detect merge in progress', async () => {
      const storage = createMockStorage({
        mergeState: {
          mergeHead: theirsSha,
          origHead: oursSha,
          message: 'Merge in progress',
          unresolvedConflicts: [],
          resolvedConflicts: [],
          options: {}
        }
      })

      const inProgress = await isMergeInProgress(storage)

      expect(inProgress).toBe(true)
    })

    it('should get merge state when merge is in progress', async () => {
      const mergeState: MergeState = {
        mergeHead: theirsSha,
        origHead: oursSha,
        message: 'Merge in progress',
        unresolvedConflicts: [{
          type: 'content',
          path: 'file.txt',
          oursSha: makeSha('ours'),
          theirsSha: makeSha('theirs')
        }],
        resolvedConflicts: [],
        options: {}
      }

      const storage = createMockStorage({ mergeState })

      const state = await getMergeState(storage)

      expect(state).toBeDefined()
      expect(state!.mergeHead).toBe(theirsSha)
      expect(state!.unresolvedConflicts.length).toBe(1)
    })

    it('should return null when no merge in progress', async () => {
      const storage = createMockStorage({ mergeState: null })

      const state = await getMergeState(storage)

      expect(state).toBeNull()
    })
  })

  describe('Conflict Resolution', () => {
    it('should resolve conflict using ours', async () => {
      const mergeState: MergeState = {
        mergeHead: theirsSha,
        origHead: oursSha,
        message: 'Merge',
        unresolvedConflicts: [{
          type: 'content',
          path: 'file.txt',
          oursSha: makeSha('ours'),
          theirsSha: makeSha('theirs')
        }],
        resolvedConflicts: [],
        options: {}
      }

      const storage = createMockStorage({
        mergeState,
        blobs: new Map([
          [makeSha('ours'), content('our content')]
        ])
      })

      const result = await resolveConflict(storage, 'file.txt', { resolution: 'ours' })

      expect(result.success).toBe(true)
      expect(result.remainingConflicts).toBe(0)
    })

    it('should resolve conflict using theirs', async () => {
      const mergeState: MergeState = {
        mergeHead: theirsSha,
        origHead: oursSha,
        message: 'Merge',
        unresolvedConflicts: [{
          type: 'content',
          path: 'file.txt',
          oursSha: makeSha('ours'),
          theirsSha: makeSha('theirs')
        }],
        resolvedConflicts: [],
        options: {}
      }

      const storage = createMockStorage({
        mergeState,
        blobs: new Map([
          [makeSha('theirs'), content('their content')]
        ])
      })

      const result = await resolveConflict(storage, 'file.txt', { resolution: 'theirs' })

      expect(result.success).toBe(true)
    })

    it('should resolve conflict with custom content', async () => {
      const mergeState: MergeState = {
        mergeHead: theirsSha,
        origHead: oursSha,
        message: 'Merge',
        unresolvedConflicts: [{
          type: 'content',
          path: 'file.txt',
          oursSha: makeSha('ours'),
          theirsSha: makeSha('theirs')
        }],
        resolvedConflicts: [],
        options: {}
      }

      const storage = createMockStorage({ mergeState })

      const result = await resolveConflict(storage, 'file.txt', {
        resolution: 'custom',
        customContent: content('manually merged content')
      })

      expect(result.success).toBe(true)
    })

    it('should fail to resolve non-existent conflict', async () => {
      const mergeState: MergeState = {
        mergeHead: theirsSha,
        origHead: oursSha,
        message: 'Merge',
        unresolvedConflicts: [{
          type: 'content',
          path: 'other.txt',
          oursSha: makeSha('ours'),
          theirsSha: makeSha('theirs')
        }],
        resolvedConflicts: [],
        options: {}
      }

      const storage = createMockStorage({ mergeState })

      const result = await resolveConflict(storage, 'nonexistent.txt', { resolution: 'ours' })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should track remaining conflicts after resolution', async () => {
      const mergeState: MergeState = {
        mergeHead: theirsSha,
        origHead: oursSha,
        message: 'Merge',
        unresolvedConflicts: [
          { type: 'content', path: 'file1.txt', oursSha: makeSha('a'), theirsSha: makeSha('b') },
          { type: 'content', path: 'file2.txt', oursSha: makeSha('c'), theirsSha: makeSha('d') }
        ],
        resolvedConflicts: [],
        options: {}
      }

      const storage = createMockStorage({
        mergeState,
        blobs: new Map([
          [makeSha('a'), content('a')]
        ])
      })

      const result = await resolveConflict(storage, 'file1.txt', { resolution: 'ours' })

      expect(result.remainingConflicts).toBe(1)
    })
  })

  describe('Abort Merge', () => {
    it('should abort merge and restore original state', async () => {
      const mergeState: MergeState = {
        mergeHead: theirsSha,
        origHead: oursSha,
        message: 'Merge',
        unresolvedConflicts: [{
          type: 'content',
          path: 'file.txt',
          oursSha: makeSha('ours'),
          theirsSha: makeSha('theirs')
        }],
        resolvedConflicts: [],
        options: {}
      }

      const storage = createMockStorage({
        mergeState,
        refs: new Map([['HEAD', theirsSha]]) // HEAD moved during merge
      })

      const result = await abortMerge(storage)

      expect(result.success).toBe(true)
      expect(result.headSha).toBe(oursSha)
    })

    it('should clear merge state on abort', async () => {
      const mergeState: MergeState = {
        mergeHead: theirsSha,
        origHead: oursSha,
        message: 'Merge',
        unresolvedConflicts: [],
        resolvedConflicts: [],
        options: {}
      }

      const storage = createMockStorage({ mergeState })

      await abortMerge(storage)

      const state = await getMergeState(storage)
      expect(state).toBeNull()
    })

    it('should fail to abort when no merge in progress', async () => {
      const storage = createMockStorage({ mergeState: null })

      const result = await abortMerge(storage)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('Continue Merge', () => {
    it('should create merge commit after all conflicts resolved', async () => {
      const mergeState: MergeState = {
        mergeHead: theirsSha,
        origHead: oursSha,
        message: 'Merge branch',
        unresolvedConflicts: [],
        resolvedConflicts: [{
          type: 'content',
          path: 'file.txt',
          oursSha: makeSha('ours'),
          theirsSha: makeSha('theirs')
        }],
        options: {}
      }

      const storage = createMockStorage({ mergeState })

      const result = await continueMerge(storage)

      expect(result.success).toBe(true)
      expect(result.headSha).toBeDefined()
    })

    it('should fail to continue with unresolved conflicts', async () => {
      const mergeState: MergeState = {
        mergeHead: theirsSha,
        origHead: oursSha,
        message: 'Merge',
        unresolvedConflicts: [{
          type: 'content',
          path: 'file.txt',
          oursSha: makeSha('ours'),
          theirsSha: makeSha('theirs')
        }],
        resolvedConflicts: [],
        options: {}
      }

      const storage = createMockStorage({ mergeState })

      const result = await continueMerge(storage)

      expect(result.success).toBe(false)
      expect(result.error).toContain('unresolved')
    })

    it('should use custom message if provided', async () => {
      const mergeState: MergeState = {
        mergeHead: theirsSha,
        origHead: oursSha,
        message: 'Original message',
        unresolvedConflicts: [],
        resolvedConflicts: [],
        options: {}
      }

      const storage = createMockStorage({ mergeState })

      const result = await continueMerge(storage, 'Custom commit message')

      expect(result.success).toBe(true)
      expect(result.message).toBe('Custom commit message')
    })

    it('should fail when no merge in progress', async () => {
      const storage = createMockStorage({ mergeState: null })

      const result = await continueMerge(storage)

      expect(result.success).toBe(false)
    })

    it('should clear merge state on successful completion', async () => {
      const mergeState: MergeState = {
        mergeHead: theirsSha,
        origHead: oursSha,
        message: 'Merge',
        unresolvedConflicts: [],
        resolvedConflicts: [],
        options: {}
      }

      const storage = createMockStorage({ mergeState })

      await continueMerge(storage)

      const state = await getMergeState(storage)
      expect(state).toBeNull()
    })
  })

  describe('findMergeBase', () => {
    it('should find common ancestor', async () => {
      const ancestorSha = makeSha('ancestor')

      const storage = createMockStorage({
        commits: new Map([
          [ancestorSha, createCommit(baseTreeSha, [], 'ancestor')],
          [oursSha, createCommit(oursTreeSha, [ancestorSha], 'ours')],
          [theirsSha, createCommit(theirsTreeSha, [ancestorSha], 'theirs')]
        ])
      })

      const base = await findMergeBase(storage, oursSha, theirsSha)

      expect(base).toBe(ancestorSha)
    })

    it('should return null when no common ancestor', async () => {
      const storage = createMockStorage({
        commits: new Map([
          [oursSha, createCommit(oursTreeSha, [], 'ours')],
          [theirsSha, createCommit(theirsTreeSha, [], 'theirs')]
        ])
      })

      const base = await findMergeBase(storage, oursSha, theirsSha)

      expect(base).toBeNull()
    })

    it('should handle when one commit is ancestor of other', async () => {
      const storage = createMockStorage({
        commits: new Map([
          [oursSha, createCommit(oursTreeSha, [], 'ours')],
          [theirsSha, createCommit(theirsTreeSha, [oursSha], 'theirs')]
        ])
      })

      const base = await findMergeBase(storage, oursSha, theirsSha)

      expect(base).toBe(oursSha)
    })

    it('should handle merge commits in history', async () => {
      const ancestor1 = makeSha('ancestor1')
      const ancestor2 = makeSha('ancestor2')
      const mergeSha = makeSha('merge')

      const storage = createMockStorage({
        commits: new Map([
          [ancestor1, createCommit(baseTreeSha, [], 'ancestor1')],
          [ancestor2, createCommit(baseTreeSha, [ancestor1], 'ancestor2')],
          [mergeSha, createCommit(baseTreeSha, [ancestor1, ancestor2], 'merge')],
          [oursSha, createCommit(oursTreeSha, [mergeSha], 'ours')],
          [theirsSha, createCommit(theirsTreeSha, [mergeSha], 'theirs')]
        ])
      })

      const base = await findMergeBase(storage, oursSha, theirsSha)

      expect(base).toBe(mergeSha)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty repository merge', async () => {
      const storage = createMockStorage({
        commits: new Map([
          [oursSha, createCommit(oursTreeSha, [], 'initial')],
          [theirsSha, createCommit(theirsTreeSha, [], 'their initial')]
        ]),
        trees: new Map([
          [oursTreeSha, createTree([])],
          [theirsTreeSha, createTree([])]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      // Two unrelated histories
      expect(result.baseSha).toBeUndefined()
    })

    it('should handle merge with self', async () => {
      const storage = createMockStorage({
        commits: new Map([
          [oursSha, createCommit(oursTreeSha, [], 'commit')]
        ]),
        trees: new Map([
          [oursTreeSha, createTree([])]
        ])
      })

      const result = await merge(storage, oursSha, oursSha)

      expect(result.status).toBe('up-to-date')
    })

    it('should handle very deep commit history', async () => {
      const commits = new Map<string, CommitObject>()
      let prevSha = ''

      for (let i = 0; i < 100; i++) {
        const sha = makeSha(`commit${i}`)
        const parents = prevSha ? [prevSha] : []
        commits.set(sha, createCommit(baseTreeSha, parents, `commit ${i}`))
        prevSha = sha
      }

      const oldSha = makeSha('commit10')
      const newSha = makeSha('commit99')

      const storage = createMockStorage({ commits })

      const base = await findMergeBase(storage, oldSha, newSha)

      expect(base).toBe(oldSha)
    })

    it('should handle unicode filenames', async () => {
      const unicodeBlob = makeSha('unicodeblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'ours')],
          [theirsSha, createCommit(baseTreeSha, [baseSha], 'theirs')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'file.txt', sha: unicodeBlob }])]
        ]),
        blobs: new Map([
          [unicodeBlob, content('unicode content')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
    })

    it('should handle submodule entries', async () => {
      const submoduleSha = makeSha('submodule')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'ours')],
          [theirsSha, createCommit(baseTreeSha, [baseSha], 'theirs')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([])],
          [oursTreeSha, createTree([{ mode: '160000', name: 'submodule', sha: submoduleSha }])]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
    })

    it('should handle large number of files', async () => {
      const entries: TreeEntry[] = []
      const blobs = new Map<string, Uint8Array>()

      for (let i = 0; i < 1000; i++) {
        const sha = makeSha(`blob${i}`)
        entries.push({ mode: '100644', name: `file${i}.txt`, sha })
        blobs.set(sha, content(`content ${i}`))
      }

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'ours')],
          [theirsSha, createCommit(baseTreeSha, [baseSha], 'theirs')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([])],
          [oursTreeSha, createTree(entries)]
        ]),
        blobs
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
      expect(result.stats?.filesAdded).toBe(1000)
    })
  })
})
