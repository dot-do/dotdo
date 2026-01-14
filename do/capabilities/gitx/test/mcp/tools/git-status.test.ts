/**
 * git_status MCP Tool Tests
 *
 * RED phase tests for git_status tree-from-index comparison functionality.
 * These tests verify proper comparison between:
 * 1. Working tree vs index (unstaged changes)
 * 2. Index vs HEAD commit (staged changes)
 * 3. Untracked files detection
 *
 * The git_status tool currently has a TODO for building tree from index entries
 * for proper staging area comparison. These tests should fail until that
 * functionality is implemented.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  setRepositoryContext,
  invokeTool,
  getTool,
  RepositoryContext,
} from '../../../src/mcp/tools'
import type { CommitObject, TreeObject, TreeEntry } from '../../../src/types/objects'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock blob SHA from content for testing
 */
function mockBlobSha(content: string): string {
  // Simple mock SHA based on content hash (not real SHA-1)
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash) + content.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash).toString(16).padStart(40, '0').slice(0, 40)
}

/**
 * Create mock repository context for testing
 */
function createMockContext(options: {
  headCommit?: CommitObject | null
  headSha?: string | null
  headTree?: TreeObject | null
  indexEntries?: Array<{ path: string; mode: string; sha: string; stage: number }>
  workdirFiles?: Array<{ path: string; mode: string; sha: string }>
  blobs?: Map<string, Uint8Array>
  trees?: Map<string, TreeObject>
  currentBranch?: string
}): RepositoryContext {
  const {
    headCommit = null,
    headSha = null,
    headTree = null,
    indexEntries = [],
    workdirFiles = [],
    blobs = new Map(),
    trees = new Map(),
    currentBranch = 'main',
  } = options

  return {
    objectStore: {
      getObject: async (sha: string) => {
        if (headSha && sha === headSha && headCommit) {
          const encoder = new TextEncoder()
          return {
            type: 'commit',
            data: encoder.encode(
              `tree ${headCommit.tree}\n` +
              headCommit.parents.map(p => `parent ${p}\n`).join('') +
              `author ${headCommit.author.name} <${headCommit.author.email}> ${headCommit.author.timestamp} ${headCommit.author.timezone}\n` +
              `committer ${headCommit.committer.name} <${headCommit.committer.email}> ${headCommit.committer.timestamp} ${headCommit.committer.timezone}\n\n` +
              headCommit.message
            ),
          }
        }
        const blob = blobs.get(sha)
        if (blob) {
          return { type: 'blob', data: blob }
        }
        if (headTree && sha === headCommit?.tree) {
          return { type: 'tree', data: new Uint8Array() }
        }
        return null
      },
      getCommit: async (sha: string) => {
        if (headSha && sha === headSha) {
          return headCommit
        }
        return null
      },
      getTree: async (sha: string) => {
        const tree = trees.get(sha)
        if (tree) return tree
        if (headTree && headCommit && sha === headCommit.tree) {
          return headTree
        }
        return null
      },
      getBlob: async (sha: string) => {
        return blobs.get(sha) || null
      },
      storeObject: async () => 'newsha123',
      hasObject: async (sha: string) => {
        return blobs.has(sha) || trees.has(sha) || sha === headSha
      },
    },
    refStore: {
      getRef: async (ref: string) => {
        if (ref === `refs/heads/${currentBranch}`) {
          return headSha
        }
        return null
      },
      setRef: async () => {},
      deleteRef: async () => {},
      listRefs: async () => [],
      getSymbolicRef: async (name: string) => {
        if (name === 'HEAD') {
          return `refs/heads/${currentBranch}`
        }
        return null
      },
      setSymbolicRef: async () => {},
      getHead: async () => headSha,
    },
    index: {
      getEntries: async () => indexEntries,
    },
    workdir: {
      getFiles: async () => workdirFiles,
    },
  }
}

/**
 * Create a tree object from entries
 */
function createTree(entries: Array<{ mode: string; name: string; sha: string; type: 'blob' | 'tree' }>): TreeObject {
  return {
    entries: entries.map(e => ({
      mode: e.mode,
      name: e.name,
      sha: e.sha,
      type: e.type,
    })),
  }
}

/**
 * Create a commit object
 */
function createCommit(treeSha: string, message: string, parents: string[] = []): CommitObject {
  return {
    tree: treeSha,
    parents,
    author: {
      name: 'Test Author',
      email: 'test@example.com.ai',
      timestamp: 1234567890,
      timezone: '+0000',
    },
    committer: {
      name: 'Test Author',
      email: 'test@example.com.ai',
      timestamp: 1234567890,
      timezone: '+0000',
    },
    message,
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('git_status MCP Tool - Tree-from-Index Comparison', () => {
  beforeEach(() => {
    setRepositoryContext(null)
  })

  // ==========================================================================
  // Tool Definition Tests
  // ==========================================================================
  describe('Tool definition', () => {
    it('should have git_status tool registered', () => {
      const tool = getTool('git_status')
      expect(tool).toBeDefined()
      expect(tool?.name).toBe('git_status')
    })

    it('should have correct description mentioning staged and unstaged', () => {
      const tool = getTool('git_status')
      expect(tool?.description.toLowerCase()).toContain('status')
      expect(tool?.description.toLowerCase()).toMatch(/staged|unstaged|untracked/)
    })

    it('should have short parameter in schema', () => {
      const tool = getTool('git_status')
      expect(tool?.inputSchema.properties).toHaveProperty('short')
      expect(tool?.inputSchema.properties?.short?.type).toBe('boolean')
    })
  })

  // ==========================================================================
  // 1. Staged Changes Detection (Index vs HEAD)
  // ==========================================================================
  describe('Staged changes detection (index vs HEAD)', () => {
    it('should detect newly staged file (file in index but not in HEAD)', async () => {
      const blobSha = mockBlobSha('new file content')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'new-file.txt', mode: '100644', sha: blobSha, stage: 0 },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('new-file.txt')
      expect(result.content[0].text).toMatch(/new file|staged|to be committed/i)
    })

    it('should detect staged modification (file in index differs from HEAD)', async () => {
      const oldBlobSha = mockBlobSha('old content')
      const newBlobSha = mockBlobSha('modified content')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([
        { mode: '100644', name: 'existing.txt', sha: oldBlobSha, type: 'blob' },
      ])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'existing.txt', mode: '100644', sha: newBlobSha, stage: 0 },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('existing.txt')
      expect(result.content[0].text).toMatch(/modified|staged|to be committed/i)
    })

    it('should detect staged deletion (file in HEAD but not in index)', async () => {
      const blobSha = mockBlobSha('content to delete')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([
        { mode: '100644', name: 'to-delete.txt', sha: blobSha, type: 'blob' },
      ])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [], // File removed from index
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('to-delete.txt')
      expect(result.content[0].text).toMatch(/deleted|staged|to be committed/i)
    })

    it('should detect staged mode change (executable bit changed)', async () => {
      const blobSha = mockBlobSha('script content')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([
        { mode: '100644', name: 'script.sh', sha: blobSha, type: 'blob' },
      ])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'script.sh', mode: '100755', sha: blobSha, stage: 0 }, // Same content, different mode
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('script.sh')
      expect(result.content[0].text).toMatch(/mode|typechange|modified|staged/i)
    })

    it('should detect multiple staged files', async () => {
      const blob1 = mockBlobSha('file1 content')
      const blob2 = mockBlobSha('file2 content')
      const blob3 = mockBlobSha('file3 content')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([
        { mode: '100644', name: 'file1.txt', sha: blob1, type: 'blob' },
      ])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'file1.txt', mode: '100644', sha: mockBlobSha('modified file1'), stage: 0 },
          { path: 'file2.txt', mode: '100644', sha: blob2, stage: 0 },
          { path: 'file3.txt', mode: '100644', sha: blob3, stage: 0 },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('file1.txt')
      expect(result.content[0].text).toContain('file2.txt')
      expect(result.content[0].text).toContain('file3.txt')
    })

    it('should detect staged file in subdirectory', async () => {
      const blobSha = mockBlobSha('nested file content')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'src/lib/utils.ts', mode: '100644', sha: blobSha, stage: 0 },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('src/lib/utils.ts')
    })
  })

  // ==========================================================================
  // 2. Unstaged Changes Detection (Working Tree vs Index)
  // ==========================================================================
  describe('Unstaged changes detection (working tree vs index)', () => {
    it('should detect modified file in working tree (not staged)', async () => {
      const indexBlobSha = mockBlobSha('index content')
      const workdirBlobSha = mockBlobSha('working directory content')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([
        { mode: '100644', name: 'modified.txt', sha: indexBlobSha, type: 'blob' },
      ])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'modified.txt', mode: '100644', sha: indexBlobSha, stage: 0 },
        ],
        workdirFiles: [
          { path: 'modified.txt', mode: '100644', sha: workdirBlobSha },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('modified.txt')
      expect(result.content[0].text).toMatch(/modified|not staged|unstaged/i)
    })

    it('should detect deleted file from working tree (not staged)', async () => {
      const blobSha = mockBlobSha('content')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([
        { mode: '100644', name: 'deleted.txt', sha: blobSha, type: 'blob' },
      ])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'deleted.txt', mode: '100644', sha: blobSha, stage: 0 },
        ],
        workdirFiles: [], // File removed from working directory
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('deleted.txt')
      expect(result.content[0].text).toMatch(/deleted|not staged|unstaged/i)
    })

    it('should detect mode change in working tree (not staged)', async () => {
      const blobSha = mockBlobSha('script content')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([
        { mode: '100644', name: 'script.sh', sha: blobSha, type: 'blob' },
      ])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'script.sh', mode: '100644', sha: blobSha, stage: 0 },
        ],
        workdirFiles: [
          { path: 'script.sh', mode: '100755', sha: blobSha }, // Mode changed to executable
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('script.sh')
    })

    it('should detect multiple unstaged modifications', async () => {
      const blob1 = mockBlobSha('file1 original')
      const blob2 = mockBlobSha('file2 original')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([
        { mode: '100644', name: 'file1.txt', sha: blob1, type: 'blob' },
        { mode: '100644', name: 'file2.txt', sha: blob2, type: 'blob' },
      ])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'file1.txt', mode: '100644', sha: blob1, stage: 0 },
          { path: 'file2.txt', mode: '100644', sha: blob2, stage: 0 },
        ],
        workdirFiles: [
          { path: 'file1.txt', mode: '100644', sha: mockBlobSha('file1 modified') },
          { path: 'file2.txt', mode: '100644', sha: mockBlobSha('file2 modified') },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('file1.txt')
      expect(result.content[0].text).toContain('file2.txt')
    })
  })

  // ==========================================================================
  // 3. Untracked Files Detection
  // ==========================================================================
  describe('Untracked files detection', () => {
    it('should detect untracked file (in workdir but not in index)', async () => {
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [],
        workdirFiles: [
          { path: 'untracked.txt', mode: '100644', sha: mockBlobSha('untracked content') },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('untracked.txt')
      expect(result.content[0].text).toMatch(/untracked|new|not added/i)
    })

    it('should detect multiple untracked files', async () => {
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [],
        workdirFiles: [
          { path: 'file1.txt', mode: '100644', sha: mockBlobSha('content1') },
          { path: 'file2.txt', mode: '100644', sha: mockBlobSha('content2') },
          { path: 'file3.txt', mode: '100644', sha: mockBlobSha('content3') },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('file1.txt')
      expect(result.content[0].text).toContain('file2.txt')
      expect(result.content[0].text).toContain('file3.txt')
    })

    it('should detect untracked files in subdirectories', async () => {
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [],
        workdirFiles: [
          { path: 'src/components/Button.tsx', mode: '100644', sha: mockBlobSha('button code') },
          { path: 'tests/unit/button.test.ts', mode: '100644', sha: mockBlobSha('test code') },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toMatch(/src\/components\/Button\.tsx|src\//i)
      expect(result.content[0].text).toMatch(/tests\/unit\/button\.test\.ts|tests\//i)
    })

    it('should distinguish untracked files from staged new files', async () => {
      const stagedBlobSha = mockBlobSha('staged content')
      const untrackedBlobSha = mockBlobSha('untracked content')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'staged-new.txt', mode: '100644', sha: stagedBlobSha, stage: 0 },
        ],
        workdirFiles: [
          { path: 'staged-new.txt', mode: '100644', sha: stagedBlobSha },
          { path: 'untracked.txt', mode: '100644', sha: untrackedBlobSha },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      // Staged new files should be in "Changes to be committed"
      expect(result.content[0].text).toContain('staged-new.txt')
      // Untracked files should be in "Untracked files"
      expect(result.content[0].text).toContain('untracked.txt')
    })
  })

  // ==========================================================================
  // 4. Mixed States (Staged + Unstaged + Untracked)
  // ==========================================================================
  describe('Mixed states (staged, unstaged, and untracked)', () => {
    it('should show file that is both staged and modified in working tree', async () => {
      const headBlobSha = mockBlobSha('original content')
      const indexBlobSha = mockBlobSha('staged changes')
      const workdirBlobSha = mockBlobSha('more changes after staging')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([
        { mode: '100644', name: 'file.txt', sha: headBlobSha, type: 'blob' },
      ])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'file.txt', mode: '100644', sha: indexBlobSha, stage: 0 },
        ],
        workdirFiles: [
          { path: 'file.txt', mode: '100644', sha: workdirBlobSha },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      // File should appear in both staged and unstaged sections
      const text = result.content[0].text
      expect(text).toContain('file.txt')
      // Should indicate both staged changes and unstaged changes
      expect(text).toMatch(/staged|to be committed/i)
      expect(text).toMatch(/not staged|unstaged|modified/i)
    })

    it('should correctly categorize all three types together', async () => {
      const headBlob = mockBlobSha('original')
      const stagedBlob = mockBlobSha('staged new file')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([
        { mode: '100644', name: 'tracked.txt', sha: headBlob, type: 'blob' },
      ])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'tracked.txt', mode: '100644', sha: headBlob, stage: 0 },
          { path: 'staged.txt', mode: '100644', sha: stagedBlob, stage: 0 },
        ],
        workdirFiles: [
          { path: 'tracked.txt', mode: '100644', sha: mockBlobSha('modified in workdir') },
          { path: 'staged.txt', mode: '100644', sha: stagedBlob },
          { path: 'untracked.txt', mode: '100644', sha: mockBlobSha('untracked') },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      const text = result.content[0].text
      // Should have staged new file
      expect(text).toContain('staged.txt')
      // Should have unstaged modification
      expect(text).toContain('tracked.txt')
      // Should have untracked file
      expect(text).toContain('untracked.txt')
    })

    it('should handle staged deletion with untracked file of same name', async () => {
      const originalBlob = mockBlobSha('original file')
      const newBlob = mockBlobSha('new file with same name')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([
        { mode: '100644', name: 'file.txt', sha: originalBlob, type: 'blob' },
      ])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [], // File deleted from index
        workdirFiles: [
          { path: 'file.txt', mode: '100644', sha: newBlob }, // New file in workdir
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      const text = result.content[0].text
      expect(text).toContain('file.txt')
      // Should show as deleted in staging area
      expect(text).toMatch(/deleted|staged/i)
      // And as untracked in working tree
      expect(text).toMatch(/untracked/i)
    })
  })

  // ==========================================================================
  // 5. Renamed Files Detection
  // ==========================================================================
  describe('Renamed files detection', () => {
    it('should detect renamed file in staging area', async () => {
      const blobSha = mockBlobSha('file content')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([
        { mode: '100644', name: 'old-name.txt', sha: blobSha, type: 'blob' },
      ])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'new-name.txt', mode: '100644', sha: blobSha, stage: 0 },
        ],
        workdirFiles: [
          { path: 'new-name.txt', mode: '100644', sha: blobSha },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      const text = result.content[0].text
      expect(text).toMatch(/renamed|old-name\.txt.*new-name\.txt|new-name\.txt.*old-name\.txt/i)
    })

    it('should detect rename with modification', async () => {
      const oldBlob = mockBlobSha('original content')
      const newBlob = mockBlobSha('modified content after rename')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([
        { mode: '100644', name: 'old.ts', sha: oldBlob, type: 'blob' },
      ])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const blobs = new Map<string, Uint8Array>()
      blobs.set(oldBlob, new TextEncoder().encode('original content'))
      blobs.set(newBlob, new TextEncoder().encode('modified content after rename'))

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'new.ts', mode: '100644', sha: newBlob, stage: 0 },
        ],
        workdirFiles: [
          { path: 'new.ts', mode: '100644', sha: newBlob },
        ],
        blobs,
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      const text = result.content[0].text
      // Should detect the rename (old.ts -> new.ts) even with modification
      expect(text).toMatch(/old\.ts|new\.ts/i)
    })

    it('should detect file moved to subdirectory', async () => {
      const blobSha = mockBlobSha('file content')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([
        { mode: '100644', name: 'utils.ts', sha: blobSha, type: 'blob' },
      ])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'src/lib/utils.ts', mode: '100644', sha: blobSha, stage: 0 },
        ],
        workdirFiles: [
          { path: 'src/lib/utils.ts', mode: '100644', sha: blobSha },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      const text = result.content[0].text
      expect(text).toMatch(/utils\.ts|src\/lib\/utils\.ts/i)
    })
  })

  // ==========================================================================
  // 6. Binary File Handling
  // ==========================================================================
  describe('Binary file handling', () => {
    it('should detect binary file addition', async () => {
      const binaryBlob = 'binary00000000000000000000000000000000000'
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const blobs = new Map<string, Uint8Array>()
      blobs.set(binaryBlob, new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) // PNG header

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'image.png', mode: '100644', sha: binaryBlob, stage: 0 },
        ],
        workdirFiles: [
          { path: 'image.png', mode: '100644', sha: binaryBlob },
        ],
        blobs,
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('image.png')
    })

    it('should detect binary file modification', async () => {
      const oldBinaryBlob = 'oldbinary000000000000000000000000000000'
      const newBinaryBlob = 'newbinary000000000000000000000000000000'
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([
        { mode: '100644', name: 'data.bin', sha: oldBinaryBlob, type: 'blob' },
      ])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const blobs = new Map<string, Uint8Array>()
      blobs.set(oldBinaryBlob, new Uint8Array([0x00, 0x01, 0x02, 0x03]))
      blobs.set(newBinaryBlob, new Uint8Array([0x00, 0x01, 0x02, 0x04]))

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'data.bin', mode: '100644', sha: newBinaryBlob, stage: 0 },
        ],
        blobs,
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('data.bin')
    })

    it('should handle large binary files', async () => {
      const largeBinaryBlob = 'largebinary0000000000000000000000000000'
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([])
      const headCommit = createCommit(treeSha, 'Initial commit')

      // 1MB binary file
      const largeData = new Uint8Array(1024 * 1024)
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256
      }

      const blobs = new Map<string, Uint8Array>()
      blobs.set(largeBinaryBlob, largeData)

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'large-video.mp4', mode: '100644', sha: largeBinaryBlob, stage: 0 },
        ],
        blobs,
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('large-video.mp4')
    })
  })

  // ==========================================================================
  // 7. Edge Cases
  // ==========================================================================
  describe('Edge cases', () => {
    it('should handle empty repository (no HEAD commit)', async () => {
      const context = createMockContext({
        headCommit: null,
        headSha: null,
        headTree: null,
        indexEntries: [
          { path: 'initial.txt', mode: '100644', sha: mockBlobSha('first file'), stage: 0 },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('initial.txt')
    })

    it('should handle repository with empty tree', async () => {
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([])
      const headCommit = createCommit(treeSha, 'Empty commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [],
        workdirFiles: [],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toMatch(/nothing to commit|clean/i)
    })

    it('should handle file with special characters in name', async () => {
      const blobSha = mockBlobSha('special content')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'file with spaces.txt', mode: '100644', sha: blobSha, stage: 0 },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('file with spaces.txt')
    })

    it('should handle deeply nested file paths', async () => {
      const blobSha = mockBlobSha('deep content')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'a/b/c/d/e/f/g/deep-file.txt', mode: '100644', sha: blobSha, stage: 0 },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('deep-file.txt')
    })

    it('should handle symlink files', async () => {
      const symlinkTarget = 'target0000000000000000000000000000000000'
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const blobs = new Map<string, Uint8Array>()
      blobs.set(symlinkTarget, new TextEncoder().encode('target.txt'))

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'symlink', mode: '120000', sha: symlinkTarget, stage: 0 },
        ],
        blobs,
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('symlink')
    })

    it('should handle empty files', async () => {
      const emptyBlob = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391' // Git's empty blob SHA
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const blobs = new Map<string, Uint8Array>()
      blobs.set(emptyBlob, new Uint8Array([]))

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'empty.txt', mode: '100644', sha: emptyBlob, stage: 0 },
        ],
        blobs,
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('empty.txt')
    })

    it('should handle file type change (file to directory conflict)', async () => {
      const fileBlobSha = mockBlobSha('file content')
      const newFileBlobSha = mockBlobSha('new nested file')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([
        { mode: '100644', name: 'config', sha: fileBlobSha, type: 'blob' },
      ])
      const headCommit = createCommit(treeSha, 'Initial commit')

      // Now 'config' is a directory with a file inside
      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'config/settings.json', mode: '100644', sha: newFileBlobSha, stage: 0 },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      // Should show deletion of 'config' file and addition of 'config/settings.json'
      const text = result.content[0].text
      expect(text).toMatch(/config|settings\.json/i)
    })
  })

  // ==========================================================================
  // 8. Error Cases
  // ==========================================================================
  describe('Error cases', () => {
    it('should return error when repository context is not set', async () => {
      setRepositoryContext(null)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/repository context|not available/i)
    })

    it('should handle missing index gracefully', async () => {
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context: RepositoryContext = {
        objectStore: {
          getObject: async () => null,
          getCommit: async () => headCommit,
          getTree: async () => createTree([]),
          getBlob: async () => null,
          storeObject: async () => 'sha',
          hasObject: async () => false,
        },
        refStore: {
          getRef: async () => headSha,
          setRef: async () => {},
          deleteRef: async () => {},
          listRefs: async () => [],
          getSymbolicRef: async () => 'refs/heads/main',
          setSymbolicRef: async () => {},
          getHead: async () => headSha,
        },
        // No index property
      }
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      // Should handle gracefully - either work without index or show appropriate message
      expect(result).toBeDefined()
      expect(result.content).toBeDefined()
    })

    it('should handle missing workdir gracefully', async () => {
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context: RepositoryContext = {
        objectStore: {
          getObject: async () => null,
          getCommit: async () => headCommit,
          getTree: async () => createTree([]),
          getBlob: async () => null,
          storeObject: async () => 'sha',
          hasObject: async () => false,
        },
        refStore: {
          getRef: async () => headSha,
          setRef: async () => {},
          deleteRef: async () => {},
          listRefs: async () => [],
          getSymbolicRef: async () => 'refs/heads/main',
          setSymbolicRef: async () => {},
          getHead: async () => headSha,
        },
        index: {
          getEntries: async () => [],
        },
        // No workdir property
      }
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      // Should handle gracefully
      expect(result).toBeDefined()
      expect(result.content).toBeDefined()
    })

    it('should handle corrupt tree object gracefully', async () => {
      const headSha = 'head0000000000000000000000000000000000000'
      const headCommit = createCommit('invalid-tree-sha', 'Bad commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree: null, // Tree cannot be resolved
        indexEntries: [
          { path: 'file.txt', mode: '100644', sha: mockBlobSha('content'), stage: 0 },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      // Should either handle error or still show index/workdir state
      expect(result).toBeDefined()
      expect(result.content).toBeDefined()
    })
  })

  // ==========================================================================
  // 9. Short Format Output
  // ==========================================================================
  describe('Short format output', () => {
    it('should output short format with --short flag', async () => {
      const blobSha = mockBlobSha('content')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'staged.txt', mode: '100644', sha: blobSha, stage: 0 },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', { short: true })

      expect(result.isError).toBe(false)
      // Short format should be more compact
      const text = result.content[0].text
      expect(text.length).toBeLessThan(500) // Should be compact
      expect(text).toContain('staged.txt')
    })

    it('should use XY format for short output (staged new file: A )', async () => {
      const blobSha = mockBlobSha('new file')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'new.txt', mode: '100644', sha: blobSha, stage: 0 },
        ],
        workdirFiles: [
          { path: 'new.txt', mode: '100644', sha: blobSha },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', { short: true })

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toMatch(/A\s+new\.txt|A\s.*new\.txt/)
    })

    it('should use XY format for short output (modified: M )', async () => {
      const oldBlobSha = mockBlobSha('old content')
      const newBlobSha = mockBlobSha('new content')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([
        { mode: '100644', name: 'file.txt', sha: oldBlobSha, type: 'blob' },
      ])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'file.txt', mode: '100644', sha: newBlobSha, stage: 0 },
        ],
        workdirFiles: [
          { path: 'file.txt', mode: '100644', sha: newBlobSha },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', { short: true })

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toMatch(/M\s+file\.txt|M\s.*file\.txt/)
    })

    it('should use XY format for short output (deleted: D )', async () => {
      const blobSha = mockBlobSha('content to delete')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([
        { mode: '100644', name: 'deleted.txt', sha: blobSha, type: 'blob' },
      ])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [], // File removed from index
        workdirFiles: [],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', { short: true })

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toMatch(/D\s+deleted\.txt|D\s.*deleted\.txt/)
    })

    it('should use XY format for short output (untracked: ??)', async () => {
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [],
        workdirFiles: [
          { path: 'untracked.txt', mode: '100644', sha: mockBlobSha('untracked') },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', { short: true })

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toMatch(/\?\?\s+untracked\.txt/)
    })

    it('should show MM for staged and modified in workdir', async () => {
      const headBlobSha = mockBlobSha('original')
      const indexBlobSha = mockBlobSha('staged changes')
      const workdirBlobSha = mockBlobSha('more changes')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([
        { mode: '100644', name: 'file.txt', sha: headBlobSha, type: 'blob' },
      ])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'file.txt', mode: '100644', sha: indexBlobSha, stage: 0 },
        ],
        workdirFiles: [
          { path: 'file.txt', mode: '100644', sha: workdirBlobSha },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', { short: true })

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toMatch(/MM\s+file\.txt/)
    })
  })

  // ==========================================================================
  // 10. Branch Display
  // ==========================================================================
  describe('Branch display', () => {
    it('should show current branch name in long format', async () => {
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        currentBranch: 'feature/my-feature',
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toMatch(/On branch|feature\/my-feature/i)
    })

    it('should handle detached HEAD state', async () => {
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context: RepositoryContext = {
        objectStore: {
          getObject: async () => null,
          getCommit: async (sha) => sha === headSha ? headCommit : null,
          getTree: async () => headTree,
          getBlob: async () => null,
          storeObject: async () => 'sha',
          hasObject: async () => false,
        },
        refStore: {
          getRef: async () => null,
          setRef: async () => {},
          deleteRef: async () => {},
          listRefs: async () => [],
          getSymbolicRef: async () => null, // No symbolic ref means detached HEAD
          setSymbolicRef: async () => {},
          getHead: async () => headSha,
        },
        index: {
          getEntries: async () => [],
        },
      }
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toMatch(/HEAD detached|detached/i)
    })
  })

  // ==========================================================================
  // 11. Merge Conflict States
  // ==========================================================================
  describe('Merge conflict states', () => {
    it('should detect file with merge conflict (stage > 0)', async () => {
      const baseBlobSha = mockBlobSha('base content')
      const oursBlobSha = mockBlobSha('our changes')
      const theirsBlobSha = mockBlobSha('their changes')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([
        { mode: '100644', name: 'conflicted.txt', sha: baseBlobSha, type: 'blob' },
      ])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'conflicted.txt', mode: '100644', sha: baseBlobSha, stage: 1 },  // base
          { path: 'conflicted.txt', mode: '100644', sha: oursBlobSha, stage: 2 },  // ours
          { path: 'conflicted.txt', mode: '100644', sha: theirsBlobSha, stage: 3 }, // theirs
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('conflicted.txt')
      expect(result.content[0].text).toMatch(/unmerged|conflict|both modified/i)
    })

    it('should show UU in short format for both-modified conflict', async () => {
      const baseBlobSha = mockBlobSha('base')
      const oursBlobSha = mockBlobSha('ours')
      const theirsBlobSha = mockBlobSha('theirs')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([
        { mode: '100644', name: 'conflict.txt', sha: baseBlobSha, type: 'blob' },
      ])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          { path: 'conflict.txt', mode: '100644', sha: baseBlobSha, stage: 1 },
          { path: 'conflict.txt', mode: '100644', sha: oursBlobSha, stage: 2 },
          { path: 'conflict.txt', mode: '100644', sha: theirsBlobSha, stage: 3 },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', { short: true })

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toMatch(/UU\s+conflict\.txt|U\s+conflict\.txt/)
    })

    it('should detect add/add conflict (AU)', async () => {
      const oursBlobSha = mockBlobSha('our new file')
      const theirsBlobSha = mockBlobSha('their new file')
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([])
      const headCommit = createCommit(treeSha, 'Initial commit')

      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [
          // No stage 1 means file didn't exist in base
          { path: 'new-conflict.txt', mode: '100644', sha: oursBlobSha, stage: 2 },
          { path: 'new-conflict.txt', mode: '100644', sha: theirsBlobSha, stage: 3 },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('new-conflict.txt')
    })
  })

  // ==========================================================================
  // 12. Ignored Files (NOT shown by default)
  // ==========================================================================
  describe('Ignored files behavior', () => {
    it('should not show ignored files by default', async () => {
      const treeSha = 'tree0000000000000000000000000000000000000'
      const headSha = 'head0000000000000000000000000000000000000'

      const headTree = createTree([])
      const headCommit = createCommit(treeSha, 'Initial commit')

      // Simulate .gitignore matching node_modules
      const context = createMockContext({
        headCommit,
        headSha,
        headTree,
        indexEntries: [],
        workdirFiles: [
          // These would normally be ignored but we're testing that they don't show
          { path: 'node_modules/package/index.js', mode: '100644', sha: mockBlobSha('ignored') },
          { path: 'real-file.txt', mode: '100644', sha: mockBlobSha('real') },
        ],
      })
      setRepositoryContext(context)

      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(false)
      // In a proper implementation, node_modules should be filtered out
      expect(result.content[0].text).toContain('real-file.txt')
      // This test documents expected behavior - implementation may vary
    })
  })
})
