import { describe, it, expect, beforeEach } from 'vitest'
import {
  merge,
  mergeContent,
  isBinaryFile,
  findMergeBase,
  resolveConflict,
  MergeStorage,
  MergeState,
  ConflictMarker
} from '../../src/ops/merge'
import { TreeEntry, TreeObject, CommitObject } from '../../src/types/objects'

// ============================================================================
// Test Helpers
// ============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Generate a deterministic SHA-like string for testing
 * Converts prefix to hex representation to ensure valid hex output
 */
function makeSha(prefix: string): string {
  // Convert each character to its hex code to ensure valid hex
  const hexPrefix = Array.from(prefix)
    .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
  return hexPrefix.padEnd(40, '0').slice(0, 40)
}

// Sample SHA constants
const baseSha = makeSha('base')
const oursSha = makeSha('ours')
const theirsSha = makeSha('theirs')
const baseTreeSha = makeSha('basetree')
const oursTreeSha = makeSha('ourstree')
const theirsTreeSha = makeSha('theirstree')

/**
 * Create sample file content as Uint8Array
 */
function content(text: string): Uint8Array {
  return encoder.encode(text)
}

/**
 * Convert hex string to bytes
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(20)
  for (let i = 0; i < 40; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

/**
 * Serialize tree entries to raw tree data format
 */
function serializeTreeData(entries: TreeEntry[]): Uint8Array {
  const parts: Uint8Array[] = []
  for (const entry of entries) {
    const modeName = encoder.encode(`${entry.mode} ${entry.name}\0`)
    const shaBytes = hexToBytes(entry.sha)
    const entryData = new Uint8Array(modeName.length + 20)
    entryData.set(modeName)
    entryData.set(shaBytes, modeName.length)
    parts.push(entryData)
  }

  const totalLength = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

/**
 * Create a mock tree object
 */
function createTree(entries: TreeEntry[]): TreeObject {
  return {
    type: 'tree',
    data: serializeTreeData(entries),
    entries
  }
}

/**
 * Serialize commit data to raw format
 */
function serializeCommitData(treeSha: string, parents: string[], message: string): Uint8Array {
  const lines: string[] = []
  lines.push(`tree ${treeSha}`)
  for (const parent of parents) {
    lines.push(`parent ${parent}`)
  }
  lines.push('author Test User <test@example.com.ai> 1704067200 +0000')
  lines.push('committer Test User <test@example.com.ai> 1704067200 +0000')
  lines.push('')
  lines.push(message)
  return encoder.encode(lines.join('\n'))
}

/**
 * Create a mock commit object
 */
function createCommit(treeSha: string, parents: string[], message: string): CommitObject {
  return {
    type: 'commit',
    data: serializeCommitData(treeSha, parents, message),
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
        return { type: 'commit', data: commit.data }
      }
      if (trees.has(sha)) {
        const tree = trees.get(sha)!
        return { type: 'tree', data: tree.data }
      }
      if (blobs.has(sha)) {
        return { type: 'blob', data: blobs.get(sha)! }
      }
      return null
    },
    async writeObject(type: string, data: Uint8Array) {
      const sha = makeSha(`written${Date.now()}`)
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
// Three-Way Merge Algorithm Tests
// ============================================================================

describe('Three-Way Merge Algorithm', () => {

  // =========================================================================
  // Clean Merges (No Conflicts)
  // =========================================================================

  describe('Clean Merges (No Conflicts)', () => {
    it('should merge when only ours has changes', async () => {
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
          [baseBlob, content('line1\nline2\nline3\nline4\nline5')],
          [oursBlob, content('line1-modified\nline2\nline3\nline4\nline5')],
          [theirsBlob, content('line1\nline2\nline3\nline4\nline5-modified')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
      expect(result.conflicts).toBeUndefined()
    })

    it('should merge independent file additions from both sides', async () => {
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
    })
  })

  // =========================================================================
  // Conflict Detection
  // =========================================================================

  describe('Conflict Detection', () => {
    it('should detect content conflict when both sides modify same lines', async () => {
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

    it('should detect add-add conflict when both sides add same file with different content', async () => {
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

    it('should detect modify-delete conflict when ours modifies and theirs deletes', async () => {
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
          [theirsTreeSha, createTree([])]
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

    it('should detect delete-modify conflict when ours deletes and theirs modifies', async () => {
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
          [oursTreeSha, createTree([])],
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

    it('should detect directory-file conflict when types differ', async () => {
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

    it('should handle multiple conflicts in a single merge', async () => {
      const baseBlob1 = makeSha('baseblob1')
      const baseBlob2 = makeSha('baseblob2')
      const oursBlob1 = makeSha('oursblob1')
      const oursBlob2 = makeSha('oursblob2')
      const theirsBlob1 = makeSha('theirsblob1')
      const theirsBlob2 = makeSha('theirsblob2')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base commit')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'our commit')],
          [theirsSha, createCommit(theirsTreeSha, [baseSha], 'their commit')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([
            { mode: '100644', name: 'file1.txt', sha: baseBlob1 },
            { mode: '100644', name: 'file2.txt', sha: baseBlob2 }
          ])],
          [oursTreeSha, createTree([
            { mode: '100644', name: 'file1.txt', sha: oursBlob1 },
            { mode: '100644', name: 'file2.txt', sha: oursBlob2 }
          ])],
          [theirsTreeSha, createTree([
            { mode: '100644', name: 'file1.txt', sha: theirsBlob1 },
            { mode: '100644', name: 'file2.txt', sha: theirsBlob2 }
          ])]
        ]),
        blobs: new Map([
          [baseBlob1, content('base1')],
          [baseBlob2, content('base2')],
          [oursBlob1, content('ours1')],
          [oursBlob2, content('ours2')],
          [theirsBlob1, content('theirs1')],
          [theirsBlob2, content('theirs2')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('conflicted')
      expect(result.conflicts).toBeDefined()
      expect(result.conflicts!.length).toBe(2)
    })
  })

  // =========================================================================
  // Conflict Markers Generation
  // =========================================================================

  describe('Conflict Markers Generation', () => {
    it('should include standard conflict markers in conflicted content', async () => {
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

    it('should generate diff3-style markers with base content', async () => {
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
          [baseBlob, content('base content')],
          [oursBlob, content('ours content')],
          [theirsBlob, content('theirs content')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.conflicts![0].markers).toBeDefined()
      expect(result.conflicts![0].markers!.length).toBeGreaterThan(0)

      const marker = result.conflicts![0].markers![0]
      expect(marker.baseContent).toBeDefined()
      expect(marker.oursContent).toBeDefined()
      expect(marker.theirsContent).toBeDefined()
    })

    it('should preserve line numbers in conflict markers', async () => {
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
          [baseBlob, content('line1\nline2\nline3\nline4\nline5')],
          [oursBlob, content('line1\nline2\nours-line3\nline4\nline5')],
          [theirsBlob, content('line1\nline2\ntheirs-line3\nline4\nline5')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      const marker = result.conflicts![0].markers![0]
      expect(marker.startLine).toBeGreaterThan(0)
      expect(marker.endLine).toBeGreaterThanOrEqual(marker.startLine)
    })

    it('should handle multiple conflict regions in single file', async () => {
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
          [baseBlob, content('line1\nline2\nline3\nline4\nline5\nline6\nline7')],
          [oursBlob, content('ours1\nline2\nline3\nline4\nline5\nline6\nours7')],
          [theirsBlob, content('theirs1\nline2\nline3\nline4\nline5\nline6\ntheirs7')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.conflicts![0].markers).toBeDefined()
      // Should have two conflict regions (line 1 and line 7)
      expect(result.conflicts![0].markers!.length).toBeGreaterThanOrEqual(2)
    })
  })

  // =========================================================================
  // Base/Ours/Theirs Resolution
  // =========================================================================

  describe('Base/Ours/Theirs Resolution', () => {
    it('should resolve conflict using ours version', async () => {
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

    it('should resolve conflict using theirs version', async () => {
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
      expect(result.remainingConflicts).toBe(0)
    })

    it('should resolve conflict using base version', async () => {
      const mergeState: MergeState = {
        mergeHead: theirsSha,
        origHead: oursSha,
        message: 'Merge',
        unresolvedConflicts: [{
          type: 'content',
          path: 'file.txt',
          baseSha: makeSha('base'),
          oursSha: makeSha('ours'),
          theirsSha: makeSha('theirs')
        }],
        resolvedConflicts: [],
        options: {}
      }

      const storage = createMockStorage({
        mergeState,
        blobs: new Map([
          [makeSha('base'), content('base content')]
        ])
      })

      const result = await resolveConflict(storage, 'file.txt', { resolution: 'base' })

      expect(result.success).toBe(true)
      expect(result.remainingConflicts).toBe(0)
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
      const customContent = content('manually merged content')

      const result = await resolveConflict(storage, 'file.txt', {
        resolution: 'custom',
        customContent
      })

      expect(result.success).toBe(true)
    })

    it('should track resolution and decrement remaining conflicts', async () => {
      const mergeState: MergeState = {
        mergeHead: theirsSha,
        origHead: oursSha,
        message: 'Merge',
        unresolvedConflicts: [
          { type: 'content', path: 'file1.txt', oursSha: makeSha('a'), theirsSha: makeSha('b') },
          { type: 'content', path: 'file2.txt', oursSha: makeSha('c'), theirsSha: makeSha('d') },
          { type: 'content', path: 'file3.txt', oursSha: makeSha('e'), theirsSha: makeSha('f') }
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

      expect(result.remainingConflicts).toBe(2)
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

    it('should handle resolution of modify-delete conflicts', async () => {
      const mergeState: MergeState = {
        mergeHead: theirsSha,
        origHead: oursSha,
        message: 'Merge',
        unresolvedConflicts: [{
          type: 'modify-delete',
          path: 'file.txt',
          oursSha: makeSha('ours'),
          theirsSha: undefined // deleted
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

      // Resolve by keeping our modified version
      const result = await resolveConflict(storage, 'file.txt', { resolution: 'ours' })

      expect(result.success).toBe(true)
    })
  })

  // =========================================================================
  // Binary File Handling
  // =========================================================================

  describe('Binary File Handling', () => {
    it('should detect binary files with null bytes', () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0x00])

      expect(isBinaryFile(binaryData)).toBe(true)
    })

    it('should not detect text files as binary', () => {
      const textData = encoder.encode('Hello, World!\nThis is text.')

      expect(isBinaryFile(textData)).toBe(false)
    })

    it('should detect PNG header as binary', () => {
      // PNG magic bytes
      const pngData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

      expect(isBinaryFile(pngData)).toBe(true)
    })

    it('should detect JPEG header as binary', () => {
      // JPEG magic bytes
      const jpegData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

      expect(isBinaryFile(jpegData)).toBe(true)
    })

    it('should detect GIF header as binary', () => {
      // GIF magic bytes "GIF89a"
      const gifData = encoder.encode('GIF89a')
      gifData[6] = 0x00 // Add null byte

      expect(isBinaryFile(gifData)).toBe(true)
    })

    it('should handle empty content', () => {
      const emptyData = new Uint8Array(0)

      // Empty files are typically considered text
      expect(isBinaryFile(emptyData)).toBe(false)
    })

    it('should conflict on binary files modified by both sides', async () => {
      const baseBlob = makeSha('baseblob')
      const oursBlob = makeSha('oursblob')
      const theirsBlob = makeSha('theirsblob')

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
      // Binary conflicts should NOT have conflictedContent with text markers
      expect(result.conflicts![0].conflictedContent).toBeUndefined()
    })

    it('should take ours when only ours modifies binary file', async () => {
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

    it('should take theirs when only theirs modifies binary file', async () => {
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

    it('should track binary files changed in stats', async () => {
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

  // =========================================================================
  // mergeContent (Low-level text merge)
  // =========================================================================

  describe('mergeContent (Low-level Text Merge)', () => {
    it('should merge non-overlapping changes from both sides', () => {
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

    it('should merge additions by ours in different locations', () => {
      const base = content('line1\nline3')
      const ours = content('line1\nline2-ours\nline3')
      const theirs = content('line1\nline3\nline4-theirs')

      const result = mergeContent(base, ours, theirs)

      expect(result.hasConflicts).toBe(false)
      const merged = decoder.decode(result.merged)
      expect(merged).toContain('line2-ours')
      expect(merged).toContain('line4-theirs')
    })

    it('should handle deletion by one side', () => {
      const base = content('line1\nline2\nline3')
      const ours = content('line1\nline3')
      const theirs = content('line1\nline2\nline3')

      const result = mergeContent(base, ours, theirs)

      expect(result.hasConflicts).toBe(false)
      expect(decoder.decode(result.merged)).toBe('line1\nline3')
    })

    it('should conflict when one side edits and other deletes same line', () => {
      const base = content('line1\nline2\nline3')
      const ours = content('line1\nline3')
      const theirs = content('line1\nmodified-line2\nline3')

      const result = mergeContent(base, ours, theirs)

      expect(result.hasConflicts).toBe(true)
    })

    it('should handle empty base (new file by both)', () => {
      const base = new Uint8Array(0)
      const ours = content('our content')
      const theirs = content('their content')

      const result = mergeContent(base, ours, theirs)

      expect(result.hasConflicts).toBe(true)
    })

    it('should handle empty result when both delete all content', () => {
      const base = content('content')
      const ours = new Uint8Array(0)
      const theirs = new Uint8Array(0)

      const result = mergeContent(base, ours, theirs)

      expect(result.hasConflicts).toBe(false)
      expect(result.merged.length).toBe(0)
    })

    it('should provide line numbers in conflict markers', () => {
      const base = content('line1\nline2\nline3\nline4\nline5')
      const ours = content('line1\nline2\nours-line3\nline4\nline5')
      const theirs = content('line1\nline2\ntheirs-line3\nline4\nline5')

      const result = mergeContent(base, ours, theirs)

      expect(result.hasConflicts).toBe(true)
      expect(result.markers[0].startLine).toBe(3)
    })

    it('should include base content in conflict markers', () => {
      const base = content('original')
      const ours = content('ours')
      const theirs = content('theirs')

      const result = mergeContent(base, ours, theirs)

      expect(result.hasConflicts).toBe(true)
      expect(result.markers[0].baseContent).toBe('original')
    })

    it('should handle windows-style line endings', () => {
      const base = content('line1\r\nline2\r\nline3')
      const ours = content('line1-ours\r\nline2\r\nline3')
      const theirs = content('line1\r\nline2\r\nline3-theirs')

      const result = mergeContent(base, ours, theirs)

      expect(result.hasConflicts).toBe(false)
    })

    it('should handle mixed line endings', () => {
      const base = content('line1\nline2\r\nline3')
      const ours = content('line1-ours\nline2\r\nline3')
      const theirs = content('line1\nline2\r\nline3-theirs')

      const result = mergeContent(base, ours, theirs)

      expect(result.hasConflicts).toBe(false)
    })
  })

  // =========================================================================
  // findMergeBase
  // =========================================================================

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

    it('should return null when no common ancestor exists', async () => {
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

    it('should handle criss-cross merge history', async () => {
      // Complex case: A -> B, A -> C, B + C merge both ways
      const a = makeSha('a')
      const b = makeSha('b')
      const c = makeSha('c')
      const bc = makeSha('bc')
      const cb = makeSha('cb')

      const storage = createMockStorage({
        commits: new Map([
          [a, createCommit(baseTreeSha, [], 'a')],
          [b, createCommit(baseTreeSha, [a], 'b')],
          [c, createCommit(baseTreeSha, [a], 'c')],
          [bc, createCommit(baseTreeSha, [b, c], 'bc')],
          [cb, createCommit(baseTreeSha, [c, b], 'cb')]
        ])
      })

      const base = await findMergeBase(storage, bc, cb)

      // Should find a valid merge base (either b or c, or recursive base)
      expect(base).toBeDefined()
    })
  })

  // =========================================================================
  // Edge Cases
  // =========================================================================

  describe('Edge Cases', () => {
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

    it('should handle very long file paths', async () => {
      const longPathBlob = makeSha('longpathblob')
      const longPath = 'a/'.repeat(50) + 'file.txt'

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'ours')],
          [theirsSha, createCommit(baseTreeSha, [baseSha], 'theirs')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([])],
          [oursTreeSha, createTree([{ mode: '100644', name: longPath, sha: longPathBlob }])]
        ]),
        blobs: new Map([
          [longPathBlob, content('content')]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
    })

    it('should handle empty files', async () => {
      const emptyBlob = makeSha('emptyblob')

      const storage = createMockStorage({
        commits: new Map([
          [baseSha, createCommit(baseTreeSha, [], 'base')],
          [oursSha, createCommit(oursTreeSha, [baseSha], 'ours')],
          [theirsSha, createCommit(baseTreeSha, [baseSha], 'theirs')]
        ]),
        trees: new Map([
          [baseTreeSha, createTree([])],
          [oursTreeSha, createTree([{ mode: '100644', name: 'empty.txt', sha: emptyBlob }])]
        ]),
        blobs: new Map([
          [emptyBlob, new Uint8Array(0)]
        ])
      })

      const result = await merge(storage, oursSha, theirsSha)

      expect(result.status).toBe('merged')
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
          [linkBlob, content('target.txt')]
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

    it('should handle merge with self (same commit)', async () => {
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

    it('should handle very deep commit history for merge base', async () => {
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
  })
})
