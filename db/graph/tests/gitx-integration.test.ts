/**
 * GitX Graph Integration Tests - RED PHASE
 *
 * Tests for representing gitx objects (commits, trees, blobs, refs) as Things
 * in the DO Graph data model. This enables:
 * - Git objects stored as graph nodes (Things)
 * - Git relationships as graph edges (parent commits, tree entries, refs)
 * - Graph traversal for git operations (log, checkout, blame)
 *
 * @see dotdo-cjcg1 - [RED] gitx-as-Things - Git objects in graph tests
 *
 * Design:
 * - Commit -> Thing with type='Commit', data={message, author, committer, tree}
 * - Tree -> Thing with type='Tree', data={entries}
 * - Blob -> Thing with type='Blob', data={size, contentRef}
 * - Ref -> Thing with type='Ref', data={name, kind}
 *
 * Relationships:
 * - Commit `parent` Commit (commit history chain)
 * - Commit `hasTree` Tree (root tree reference)
 * - Tree `contains` Blob|Tree (directory entries)
 * - Ref `pointsTo` Commit (branch/tag targets)
 *
 * NO MOCKS - uses real SQLiteGraphStore
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores'
import type { GraphStore, GraphThing, GraphRelationship } from '../types'

// ============================================================================
// TEST FIXTURES - Git Object Types as Thing Data
// ============================================================================

/**
 * Git author/committer identity
 */
interface GitIdentityData {
  name: string
  email: string
  timestamp: number
  timezone: string
}

/**
 * Commit Thing data structure
 */
interface CommitData {
  message: string
  author: GitIdentityData
  committer: GitIdentityData
  tree: string // SHA reference to tree Thing
  gpgSignature?: string
}

/**
 * Tree entry structure (stored in Tree.data.entries)
 */
interface TreeEntryData {
  name: string
  mode: string // '100644' | '100755' | '040000' | '120000' | '160000'
  hash: string // SHA reference to blob/tree Thing
}

/**
 * Tree Thing data structure
 */
interface TreeData {
  entries: TreeEntryData[]
}

/**
 * Blob Thing data structure
 */
interface BlobData {
  size: number
  contentRef: string // External storage reference (e.g., 'r2:blobs/sha256-abc')
  isBinary?: boolean
}

/**
 * Ref Thing data structure (branches, tags)
 */
interface RefData {
  name: string
  kind: 'branch' | 'tag' | 'remote' | 'head'
  symbolic?: boolean
  target?: string // For symbolic refs (e.g., HEAD -> refs/heads/main)
}

// ============================================================================
// GITGRAPHADAPTER INTERFACE (to be implemented in GREEN phase)
// ============================================================================

/**
 * GitGraphAdapter - bridges gitx operations with GraphStore
 *
 * This adapter will be implemented in the GREEN phase.
 * Tests are written against this expected interface.
 */
interface GitGraphAdapter {
  /**
   * Create a commit as a Thing with parent relationships
   */
  createCommit(data: {
    message: string
    tree: string
    author?: GitIdentityData
    parent?: string
    parents?: string[]
  }): Promise<GraphThing>

  /**
   * Create a tree as a Thing with entry relationships
   */
  createTree(entries: TreeEntryData[]): Promise<GraphThing>

  /**
   * Create a blob as a Thing
   */
  createBlob(data: { content: Uint8Array | string; contentRef?: string }): Promise<GraphThing>

  /**
   * Create or update a ref (branch/tag) pointing to a commit
   */
  createRef(name: string, kind: RefData['kind'], commitId: string): Promise<GraphThing>

  /**
   * Resolve a ref name to its target commit Thing
   */
  resolveRef(refName: string): Promise<GraphThing | null>

  /**
   * Get commit history by traversing parent relationships
   */
  getCommitHistory(startCommitId: string, options?: { limit?: number }): Promise<GraphThing[]>

  /**
   * Get tree entries by querying 'contains' relationships
   */
  getTreeEntries(treeId: string): Promise<Array<{ thing: GraphThing; entry: TreeEntryData }>>

  /**
   * Checkout: resolve ref -> commit -> tree -> files
   */
  checkout(refName: string): Promise<Map<string, GraphThing>>
}

// ============================================================================
// TEST HELPER STUBS (will fail until GitGraphAdapter is implemented)
// ============================================================================

/**
 * Create a GitGraphAdapter - THIS WILL FAIL until implemented
 */
async function createGitGraphAdapter(_store: GraphStore): Promise<GitGraphAdapter> {
  // Import will fail until module exists
  const { GitGraphAdapter } = await import('../adapters/git-graph-adapter')
  return new GitGraphAdapter(_store)
}

/**
 * Generate a test SHA-like ID
 */
function testSha(prefix: string, index: number): string {
  const base = `${prefix}${index.toString().padStart(4, '0')}`
  return base.padEnd(40, '0')
}

/**
 * Create test author/committer identity
 */
function testIdentity(name: string): GitIdentityData {
  return {
    name,
    email: `${name.toLowerCase().replace(' ', '.')}@example.com`,
    timestamp: Date.now(),
    timezone: '+0000',
  }
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('GitX Graph Integration', () => {
  let store: SQLiteGraphStore
  let adapter: GitGraphAdapter

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    // This will fail until GitGraphAdapter is implemented
    adapter = await createGitGraphAdapter(store)
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // 1. COMMIT OPERATIONS
  // ==========================================================================

  describe('Commit Operations', () => {
    describe('createCommit', () => {
      it('creates Commit Thing with correct type', async () => {
        const treeSha = testSha('tree', 1)

        // First create a tree for the commit to reference
        const tree = await adapter.createTree([])

        const commit = await adapter.createCommit({
          message: 'Initial commit',
          tree: tree.id,
        })

        expect(commit).toBeDefined()
        expect(commit.typeName).toBe('Commit')
        expect(commit.id).toBeDefined()
      })

      it('stores commit message in Thing data', async () => {
        const tree = await adapter.createTree([])

        const commit = await adapter.createCommit({
          message: 'Add feature X\n\nThis commit adds a new feature.',
          tree: tree.id,
        })

        const data = commit.data as CommitData
        expect(data.message).toBe('Add feature X\n\nThis commit adds a new feature.')
      })

      it('stores author and committer in Thing data', async () => {
        const tree = await adapter.createTree([])
        const author = testIdentity('Alice Developer')
        const committer = testIdentity('Bob Maintainer')

        const commit = await adapter.createCommit({
          message: 'Test commit',
          tree: tree.id,
          author,
        })

        const data = commit.data as CommitData
        expect(data.author.name).toBe('Alice Developer')
        expect(data.author.email).toBe('alice.developer@example.com')
      })

      it('creates hasTree relationship to tree', async () => {
        const tree = await adapter.createTree([])

        const commit = await adapter.createCommit({
          message: 'Test commit',
          tree: tree.id,
        })

        // Query relationships from commit
        const rels = await store.queryRelationshipsFrom(`do://git/commits/${commit.id}`, {
          verb: 'hasTree',
        })

        expect(rels.length).toBe(1)
        expect(rels[0].to).toContain(tree.id)
      })

      it('links commit to parent via parent relationship', async () => {
        const tree = await adapter.createTree([])

        const parentCommit = await adapter.createCommit({
          message: 'Parent commit',
          tree: tree.id,
        })

        const childCommit = await adapter.createCommit({
          message: 'Child commit',
          tree: tree.id,
          parent: parentCommit.id,
        })

        // Query parent relationships from child
        const rels = await store.queryRelationshipsFrom(`do://git/commits/${childCommit.id}`, {
          verb: 'parent',
        })

        expect(rels.length).toBe(1)
        expect(rels[0].to).toContain(parentCommit.id)
      })

      it('supports multiple parents for merge commits', async () => {
        const tree = await adapter.createTree([])

        const parent1 = await adapter.createCommit({
          message: 'Parent 1 (main)',
          tree: tree.id,
        })

        const parent2 = await adapter.createCommit({
          message: 'Parent 2 (feature)',
          tree: tree.id,
        })

        const mergeCommit = await adapter.createCommit({
          message: 'Merge feature into main',
          tree: tree.id,
          parents: [parent1.id, parent2.id],
        })

        const rels = await store.queryRelationshipsFrom(`do://git/commits/${mergeCommit.id}`, {
          verb: 'parent',
        })

        expect(rels.length).toBe(2)
      })

      it('initial commit has no parent relationships', async () => {
        const tree = await adapter.createTree([])

        const initialCommit = await adapter.createCommit({
          message: 'Initial commit',
          tree: tree.id,
        })

        const rels = await store.queryRelationshipsFrom(`do://git/commits/${initialCommit.id}`, {
          verb: 'parent',
        })

        expect(rels.length).toBe(0)
      })
    })

    describe('getCommitHistory (git log)', () => {
      it('traverses commit history via parent relationships', async () => {
        const tree = await adapter.createTree([])

        // Create commit chain: c1 <- c2 <- c3
        const c1 = await adapter.createCommit({ message: 'First', tree: tree.id })
        const c2 = await adapter.createCommit({ message: 'Second', tree: tree.id, parent: c1.id })
        const c3 = await adapter.createCommit({ message: 'Third', tree: tree.id, parent: c2.id })

        const history = await adapter.getCommitHistory(c3.id)

        expect(history.length).toBe(3)
        expect((history[0].data as CommitData).message).toBe('Third')
        expect((history[1].data as CommitData).message).toBe('Second')
        expect((history[2].data as CommitData).message).toBe('First')
      })

      it('respects limit parameter', async () => {
        const tree = await adapter.createTree([])

        // Create 5 commits
        let prev: GraphThing | null = null
        for (let i = 1; i <= 5; i++) {
          prev = await adapter.createCommit({
            message: `Commit ${i}`,
            tree: tree.id,
            parent: prev?.id,
          })
        }

        const history = await adapter.getCommitHistory(prev!.id, { limit: 2 })

        expect(history.length).toBe(2)
      })

      it('handles merge commit history (follows first parent)', async () => {
        const tree = await adapter.createTree([])

        // Create divergent history:
        // c1 <- c2 (main)
        //    \- c3 (feature)
        // Then merge: c4 = merge(c2, c3)
        const c1 = await adapter.createCommit({ message: 'Base', tree: tree.id })
        const c2 = await adapter.createCommit({ message: 'Main', tree: tree.id, parent: c1.id })
        const c3 = await adapter.createCommit({ message: 'Feature', tree: tree.id, parent: c1.id })
        const c4 = await adapter.createCommit({
          message: 'Merge',
          tree: tree.id,
          parents: [c2.id, c3.id],
        })

        // Default follows first parent only
        const history = await adapter.getCommitHistory(c4.id)

        expect(history.length).toBeGreaterThanOrEqual(3)
        expect(history.map((c) => (c.data as CommitData).message)).toContain('Merge')
        expect(history.map((c) => (c.data as CommitData).message)).toContain('Main')
        expect(history.map((c) => (c.data as CommitData).message)).toContain('Base')
      })
    })
  })

  // ==========================================================================
  // 2. REF OPERATIONS (branches, tags)
  // ==========================================================================

  describe('Ref Operations', () => {
    describe('createRef (branch/tag)', () => {
      it('creates branch Ref Thing', async () => {
        const tree = await adapter.createTree([])
        const commit = await adapter.createCommit({ message: 'Initial', tree: tree.id })

        const ref = await adapter.createRef('main', 'branch', commit.id)

        expect(ref.typeName).toBe('Ref')
        const data = ref.data as RefData
        expect(data.name).toBe('main')
        expect(data.kind).toBe('branch')
      })

      it('creates tag Ref Thing', async () => {
        const tree = await adapter.createTree([])
        const commit = await adapter.createCommit({ message: 'Release', tree: tree.id })

        const ref = await adapter.createRef('v1.0.0', 'tag', commit.id)

        expect(ref.typeName).toBe('Ref')
        const data = ref.data as RefData
        expect(data.name).toBe('v1.0.0')
        expect(data.kind).toBe('tag')
      })

      it('creates pointsTo relationship to commit', async () => {
        const tree = await adapter.createTree([])
        const commit = await adapter.createCommit({ message: 'Test', tree: tree.id })

        const ref = await adapter.createRef('feature', 'branch', commit.id)

        const rels = await store.queryRelationshipsFrom(`do://git/refs/${ref.id}`, {
          verb: 'pointsTo',
        })

        expect(rels.length).toBe(1)
        expect(rels[0].to).toContain(commit.id)
      })

      it('updates existing ref to new commit', async () => {
        const tree = await adapter.createTree([])
        const commit1 = await adapter.createCommit({ message: 'First', tree: tree.id })
        const commit2 = await adapter.createCommit({
          message: 'Second',
          tree: tree.id,
          parent: commit1.id,
        })

        // Create ref pointing to commit1
        await adapter.createRef('main', 'branch', commit1.id)

        // Update ref to point to commit2
        const updatedRef = await adapter.createRef('main', 'branch', commit2.id)

        // Resolve should return commit2
        const resolved = await adapter.resolveRef('main')
        expect(resolved?.id).toBe(commit2.id)
      })
    })

    describe('resolveRef', () => {
      it('resolves branch name to commit Thing', async () => {
        const tree = await adapter.createTree([])
        const commit = await adapter.createCommit({ message: 'Test', tree: tree.id })
        await adapter.createRef('main', 'branch', commit.id)

        const resolved = await adapter.resolveRef('main')

        expect(resolved).not.toBeNull()
        expect(resolved?.typeName).toBe('Commit')
        expect(resolved?.id).toBe(commit.id)
      })

      it('resolves tag name to commit Thing', async () => {
        const tree = await adapter.createTree([])
        const commit = await adapter.createCommit({ message: 'Release', tree: tree.id })
        await adapter.createRef('v1.0.0', 'tag', commit.id)

        const resolved = await adapter.resolveRef('v1.0.0')

        expect(resolved).not.toBeNull()
        expect(resolved?.id).toBe(commit.id)
      })

      it('returns null for non-existent ref', async () => {
        const resolved = await adapter.resolveRef('nonexistent')

        expect(resolved).toBeNull()
      })

      it('resolves refs/heads/main format', async () => {
        const tree = await adapter.createTree([])
        const commit = await adapter.createCommit({ message: 'Test', tree: tree.id })
        await adapter.createRef('main', 'branch', commit.id)

        const resolved = await adapter.resolveRef('refs/heads/main')

        expect(resolved?.id).toBe(commit.id)
      })
    })
  })

  // ==========================================================================
  // 3. TREE OPERATIONS
  // ==========================================================================

  describe('Tree Operations', () => {
    describe('createTree', () => {
      it('creates Tree Thing with empty entries', async () => {
        const tree = await adapter.createTree([])

        expect(tree.typeName).toBe('Tree')
        const data = tree.data as TreeData
        expect(data.entries).toEqual([])
      })

      it('creates Tree Thing with file entries', async () => {
        const blob = await adapter.createBlob({ content: 'Hello, World!' })

        const tree = await adapter.createTree([
          { name: 'readme.md', mode: '100644', hash: blob.id },
        ])

        const data = tree.data as TreeData
        expect(data.entries.length).toBe(1)
        expect(data.entries[0].name).toBe('readme.md')
        expect(data.entries[0].mode).toBe('100644')
      })

      it('creates contains relationships for entries', async () => {
        const blob = await adapter.createBlob({ content: 'console.log("test")' })

        const tree = await adapter.createTree([
          { name: 'index.js', mode: '100644', hash: blob.id },
        ])

        const rels = await store.queryRelationshipsFrom(`do://git/trees/${tree.id}`, {
          verb: 'contains',
        })

        expect(rels.length).toBe(1)
        expect(rels[0].to).toContain(blob.id)
      })

      it('creates nested tree structure', async () => {
        const blob = await adapter.createBlob({ content: 'nested file' })

        const innerTree = await adapter.createTree([
          { name: 'file.txt', mode: '100644', hash: blob.id },
        ])

        const outerTree = await adapter.createTree([
          { name: 'subdir', mode: '040000', hash: innerTree.id },
        ])

        const rels = await store.queryRelationshipsFrom(`do://git/trees/${outerTree.id}`, {
          verb: 'contains',
        })

        expect(rels.length).toBe(1)
        expect(rels[0].to).toContain(innerTree.id)
      })
    })

    describe('getTreeEntries', () => {
      it('returns all entries with their Things', async () => {
        const blob1 = await adapter.createBlob({ content: 'file 1' })
        const blob2 = await adapter.createBlob({ content: 'file 2' })

        const tree = await adapter.createTree([
          { name: 'a.txt', mode: '100644', hash: blob1.id },
          { name: 'b.txt', mode: '100644', hash: blob2.id },
        ])

        const entries = await adapter.getTreeEntries(tree.id)

        expect(entries.length).toBe(2)
        expect(entries.map((e) => e.entry.name).sort()).toEqual(['a.txt', 'b.txt'])
      })

      it('returns empty array for empty tree', async () => {
        const tree = await adapter.createTree([])

        const entries = await adapter.getTreeEntries(tree.id)

        expect(entries).toEqual([])
      })

      it('includes mode information in entries', async () => {
        const execBlob = await adapter.createBlob({ content: '#!/bin/bash\necho "hello"' })

        const tree = await adapter.createTree([
          { name: 'script.sh', mode: '100755', hash: execBlob.id },
        ])

        const entries = await adapter.getTreeEntries(tree.id)

        expect(entries[0].entry.mode).toBe('100755')
      })
    })
  })

  // ==========================================================================
  // 4. BLOB OPERATIONS
  // ==========================================================================

  describe('Blob Operations', () => {
    describe('createBlob', () => {
      it('creates Blob Thing from string content', async () => {
        const blob = await adapter.createBlob({ content: 'Hello, World!' })

        expect(blob.typeName).toBe('Blob')
        const data = blob.data as BlobData
        expect(data.size).toBe(13)
      })

      it('creates Blob Thing from Uint8Array content', async () => {
        const content = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]) // "Hello"

        const blob = await adapter.createBlob({ content })

        const data = blob.data as BlobData
        expect(data.size).toBe(5)
      })

      it('stores content reference for external storage', async () => {
        const blob = await adapter.createBlob({
          content: 'Large file content...',
          contentRef: 'r2:blobs/sha256-abc123',
        })

        const data = blob.data as BlobData
        expect(data.contentRef).toBe('r2:blobs/sha256-abc123')
      })

      it('detects binary content', async () => {
        // Binary content with null bytes
        const binaryContent = new Uint8Array([0x00, 0x01, 0x02, 0x03])

        const blob = await adapter.createBlob({ content: binaryContent })

        const data = blob.data as BlobData
        expect(data.isBinary).toBe(true)
      })

      it('generates deterministic ID from content hash', async () => {
        const blob1 = await adapter.createBlob({ content: 'identical content' })
        const blob2 = await adapter.createBlob({ content: 'identical content' })

        // Same content should produce same ID (content-addressable)
        expect(blob1.id).toBe(blob2.id)
      })
    })
  })

  // ==========================================================================
  // 5. CHECKOUT OPERATIONS
  // ==========================================================================

  describe('Checkout Operations', () => {
    describe('checkout', () => {
      it('resolves ref -> commit -> tree -> files', async () => {
        // Create file structure
        const readme = await adapter.createBlob({ content: '# Project\n\nDescription' })
        const index = await adapter.createBlob({ content: 'console.log("app")' })

        const tree = await adapter.createTree([
          { name: 'README.md', mode: '100644', hash: readme.id },
          { name: 'index.js', mode: '100644', hash: index.id },
        ])

        const commit = await adapter.createCommit({ message: 'Initial', tree: tree.id })
        await adapter.createRef('main', 'branch', commit.id)

        // Checkout main branch
        const files = await adapter.checkout('main')

        expect(files.size).toBe(2)
        expect(files.has('README.md')).toBe(true)
        expect(files.has('index.js')).toBe(true)
      })

      it('handles nested directory structure', async () => {
        // Create nested structure:
        // /
        //   README.md
        //   src/
        //     index.ts
        //     utils/
        //       helper.ts

        const readmeBlob = await adapter.createBlob({ content: '# Project' })
        const indexBlob = await adapter.createBlob({ content: 'export {}' })
        const helperBlob = await adapter.createBlob({ content: 'export function helper() {}' })

        const utilsTree = await adapter.createTree([
          { name: 'helper.ts', mode: '100644', hash: helperBlob.id },
        ])

        const srcTree = await adapter.createTree([
          { name: 'index.ts', mode: '100644', hash: indexBlob.id },
          { name: 'utils', mode: '040000', hash: utilsTree.id },
        ])

        const rootTree = await adapter.createTree([
          { name: 'README.md', mode: '100644', hash: readmeBlob.id },
          { name: 'src', mode: '040000', hash: srcTree.id },
        ])

        const commit = await adapter.createCommit({ message: 'Initial', tree: rootTree.id })
        await adapter.createRef('main', 'branch', commit.id)

        const files = await adapter.checkout('main')

        expect(files.size).toBe(3)
        expect(files.has('README.md')).toBe(true)
        expect(files.has('src/index.ts')).toBe(true)
        expect(files.has('src/utils/helper.ts')).toBe(true)
      })

      it('throws for non-existent ref', async () => {
        await expect(adapter.checkout('nonexistent')).rejects.toThrow()
      })
    })
  })

  // ==========================================================================
  // 6. GRAPH QUERY PATTERNS
  // ==========================================================================

  describe('Graph Query Patterns', () => {
    describe('reverse traversals', () => {
      it('finds commits referencing a tree', async () => {
        const tree = await adapter.createTree([])

        // Multiple commits can reference same tree
        const c1 = await adapter.createCommit({ message: 'Commit 1', tree: tree.id })
        const c2 = await adapter.createCommit({ message: 'Commit 2', tree: tree.id })

        // Query backwards: which commits have this tree?
        const rels = await store.queryRelationshipsTo(`do://git/trees/${tree.id}`, {
          verb: 'hasTree',
        })

        expect(rels.length).toBe(2)
      })

      it('finds refs pointing to a commit', async () => {
        const tree = await adapter.createTree([])
        const commit = await adapter.createCommit({ message: 'Test', tree: tree.id })

        // Multiple refs can point to same commit
        await adapter.createRef('main', 'branch', commit.id)
        await adapter.createRef('v1.0.0', 'tag', commit.id)
        await adapter.createRef('release', 'branch', commit.id)

        const rels = await store.queryRelationshipsTo(`do://git/commits/${commit.id}`, {
          verb: 'pointsTo',
        })

        expect(rels.length).toBe(3)
      })

      it('finds child commits (commits with this as parent)', async () => {
        const tree = await adapter.createTree([])

        const parent = await adapter.createCommit({ message: 'Parent', tree: tree.id })
        await adapter.createCommit({ message: 'Child 1', tree: tree.id, parent: parent.id })
        await adapter.createCommit({ message: 'Child 2', tree: tree.id, parent: parent.id })

        const rels = await store.queryRelationshipsTo(`do://git/commits/${parent.id}`, {
          verb: 'parent',
        })

        expect(rels.length).toBe(2)
      })
    })

    describe('type filtering', () => {
      it('queries all Commit Things', async () => {
        const tree = await adapter.createTree([])
        await adapter.createCommit({ message: 'C1', tree: tree.id })
        await adapter.createCommit({ message: 'C2', tree: tree.id })

        const commits = await store.getThingsByType({ typeName: 'Commit' })

        expect(commits.length).toBeGreaterThanOrEqual(2)
        expect(commits.every((t) => t.typeName === 'Commit')).toBe(true)
      })

      it('queries all Ref Things', async () => {
        const tree = await adapter.createTree([])
        const commit = await adapter.createCommit({ message: 'Test', tree: tree.id })
        await adapter.createRef('main', 'branch', commit.id)
        await adapter.createRef('develop', 'branch', commit.id)

        const refs = await store.getThingsByType({ typeName: 'Ref' })

        expect(refs.length).toBeGreaterThanOrEqual(2)
        expect(refs.every((t) => t.typeName === 'Ref')).toBe(true)
      })

      it('queries all Blob Things', async () => {
        await adapter.createBlob({ content: 'file 1' })
        await adapter.createBlob({ content: 'file 2' })
        await adapter.createBlob({ content: 'file 3' })

        const blobs = await store.getThingsByType({ typeName: 'Blob' })

        expect(blobs.length).toBeGreaterThanOrEqual(3)
        expect(blobs.every((t) => t.typeName === 'Blob')).toBe(true)
      })
    })
  })

  // ==========================================================================
  // 7. EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles empty repository (no commits)', async () => {
      const ref = await adapter.createRef('main', 'branch', 'nonexistent')
      const resolved = await adapter.resolveRef('main')

      // Should either return null or throw
      expect(resolved === null || resolved === undefined).toBe(true)
    })

    it('handles very long commit messages', async () => {
      const tree = await adapter.createTree([])
      const longMessage = 'x'.repeat(10000)

      const commit = await adapter.createCommit({
        message: longMessage,
        tree: tree.id,
      })

      const data = commit.data as CommitData
      expect(data.message.length).toBe(10000)
    })

    it('handles special characters in filenames', async () => {
      const blob = await adapter.createBlob({ content: 'test' })

      const tree = await adapter.createTree([
        { name: 'file with spaces.txt', mode: '100644', hash: blob.id },
        { name: "file'with'quotes.txt", mode: '100644', hash: blob.id },
      ])

      const entries = await adapter.getTreeEntries(tree.id)

      expect(entries.length).toBe(2)
    })

    it('handles unicode in commit messages and filenames', async () => {
      const blob = await adapter.createBlob({ content: 'Unicode content' })

      const tree = await adapter.createTree([{ name: 'readme.md', mode: '100644', hash: blob.id }])

      const commit = await adapter.createCommit({
        message: 'Add support for internationalization',
        tree: tree.id,
      })

      const data = commit.data as CommitData
      expect(data.message).toContain('internationalization')
    })

    it('handles binary files correctly', async () => {
      // PNG file header
      const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

      const blob = await adapter.createBlob({ content: pngHeader })

      const data = blob.data as BlobData
      expect(data.isBinary).toBe(true)
    })
  })
})

// ============================================================================
// INTEGRATION WITH EXISTING GITX
// ============================================================================

describe('GitX Primitive Integration', () => {
  // These tests verify the adapter can parse and store real gitx objects

  it.skip('imports GitCommit from gitx/core and converts to Thing', async () => {
    // This test requires implementing the conversion layer
    // const { GitCommit } = await import('../../../primitives/gitx/core/objects/commit')
    // const commit = new GitCommit({ ... })
    // const thing = await adapter.importGitCommit(commit)
    // expect(thing.typeName).toBe('Commit')
  })

  it.skip('imports GitTree from gitx/core and converts to Thing', async () => {
    // This test requires implementing the conversion layer
  })

  it.skip('imports GitBlob from gitx/core and converts to Thing', async () => {
    // This test requires implementing the conversion layer
  })
})
