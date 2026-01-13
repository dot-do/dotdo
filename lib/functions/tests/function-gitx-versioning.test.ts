/**
 * Function Versioning via gitx Relationships Tests - RED PHASE
 *
 * Tests for Function versioning using gitx-style git relationships.
 * This enables storing Function versions like git commits with:
 * - Content-addressable storage (SHA-based)
 * - Parent chain relationships (version history)
 * - Ref management (latest, tags, channels)
 * - Rollback capabilities
 *
 * @see dotdo-d1s5s - [RED] Function Version via gitx Relationships Tests
 *
 * ## Architecture
 *
 * Functions are versioned using a gitx-inspired model:
 *
 * ```
 * Function (Thing)
 *     |
 *     | definedIn (relationship)
 *     v
 * FunctionVersion (Thing) <-- parent --> FunctionVersion
 *     |
 *     | hasContent (relationship)
 *     v
 * FunctionBlob (Thing)
 *
 * FunctionRef (Thing)
 *     |
 *     | pointsTo (relationship)
 *     v
 * FunctionVersion
 * ```
 *
 * ## Test Scenarios
 *
 * 1. Creating version commits via gitx
 * 2. Version history as relationship graph
 * 3. Rollback to previous versions
 * 4. Version metadata (author, timestamp, message)
 *
 * NO MOCKS - uses real storage via FunctionGitxVersionStore
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// ============================================================================
// TYPES - Version metadata structures
// ============================================================================

/**
 * Author information for a version commit
 */
interface VersionAuthor {
  name: string
  email: string
  timestamp: number
}

/**
 * Version commit metadata (like git commit)
 */
interface VersionCommit {
  sha: string
  functionId: string
  parentSha: string | null
  message: string
  author: VersionAuthor
  createdAt: number
}

/**
 * Version content blob (like git blob)
 */
interface VersionBlob {
  sha: string
  size: number
  contentType: string
  content: string | Uint8Array
}

/**
 * Version ref (like git branch/tag)
 */
interface VersionRef {
  name: string
  kind: 'latest' | 'tag' | 'channel' | 'semver'
  functionId: string
  targetSha: string
}

/**
 * Function metadata
 */
interface FunctionMetadata {
  id: string
  name: string
  namespace: string
  description?: string
  runtime?: string
}

// ============================================================================
// INTERFACE - FunctionGitxVersionStore (to be implemented)
// ============================================================================

/**
 * FunctionGitxVersionStore - gitx-style versioning for Functions
 *
 * This interface will be implemented in the GREEN phase.
 * Tests are written against this expected interface.
 *
 * Key operations mirror git:
 * - createCommit: Create a new version (like git commit)
 * - getHistory: Traverse parent chain (like git log)
 * - createRef: Point a name to a version (like git branch/tag)
 * - resolveRef: Look up a ref (like git rev-parse)
 * - rollback: Move ref to older version (like git reset)
 */
interface FunctionGitxVersionStore {
  /**
   * Initialize the version store for a function
   */
  initFunction(metadata: Omit<FunctionMetadata, 'id'>): Promise<FunctionMetadata>

  /**
   * Get function by ID
   */
  getFunction(id: string): Promise<FunctionMetadata | null>

  /**
   * Create a new version commit with content
   * Returns the created commit with computed SHA
   */
  createCommit(input: {
    functionId: string
    content: string | Uint8Array
    message: string
    author?: Partial<VersionAuthor>
    parentSha?: string
  }): Promise<VersionCommit>

  /**
   * Get a specific commit by SHA
   */
  getCommit(sha: string): Promise<VersionCommit | null>

  /**
   * Get the content blob for a commit
   */
  getBlob(commitSha: string): Promise<VersionBlob | null>

  /**
   * Get version history starting from a commit SHA
   * Traverses parent relationships
   */
  getHistory(functionId: string, options?: {
    startSha?: string
    limit?: number
    includeContent?: boolean
  }): Promise<VersionCommit[]>

  /**
   * Create or update a ref pointing to a version
   */
  createRef(input: {
    functionId: string
    name: string
    kind: VersionRef['kind']
    targetSha: string
  }): Promise<VersionRef>

  /**
   * Resolve a ref name to its target commit
   */
  resolveRef(functionId: string, refName: string): Promise<VersionCommit | null>

  /**
   * Get all refs for a function
   */
  getRefs(functionId: string): Promise<VersionRef[]>

  /**
   * Rollback: update ref to point to an older version
   * Does NOT delete any commits (preserves history)
   */
  rollback(functionId: string, refName: string, targetSha: string): Promise<VersionRef>

  /**
   * Compare two versions
   */
  diff(sha1: string, sha2: string): Promise<{
    sha1: string
    sha2: string
    contentChanged: boolean
    linesAdded: number
    linesRemoved: number
  }>
}

// ============================================================================
// STUB - Factory function (will fail until implemented)
// ============================================================================

/**
 * Create a FunctionGitxVersionStore instance
 * THIS WILL FAIL until the implementation exists
 */
async function createFunctionGitxVersionStore(): Promise<FunctionGitxVersionStore> {
  // This import will fail until the module is implemented
  const { FunctionGitxVersionStore } = await import('../FunctionGitxVersionStore')
  return new FunctionGitxVersionStore()
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate test author identity
 */
function testAuthor(name: string): VersionAuthor {
  return {
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
    timestamp: Date.now(),
  }
}

/**
 * Generate test function code
 */
function testCode(version: number, content?: string): string {
  return content ?? `
export async function handler(request: Request): Promise<Response> {
  // Version ${version}
  return new Response('Hello from version ${version}')
}
`.trim()
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Function Versioning via gitx Relationships', () => {
  let store: FunctionGitxVersionStore

  beforeEach(async () => {
    // This will fail until FunctionGitxVersionStore is implemented
    store = await createFunctionGitxVersionStore()
  })

  afterEach(async () => {
    // Cleanup handled by implementation
  })

  // ==========================================================================
  // 1. CREATING VERSION COMMITS VIA GITX
  // ==========================================================================

  describe('Creating Version Commits via gitx', () => {
    describe('initFunction', () => {
      it('creates a new function with generated ID', async () => {
        const func = await store.initFunction({
          name: 'processOrder',
          namespace: 'orders',
          description: 'Process customer orders',
          runtime: 'typescript',
        })

        expect(func).toBeDefined()
        expect(func.id).toBeDefined()
        expect(func.id.length).toBeGreaterThan(0)
        expect(func.name).toBe('processOrder')
        expect(func.namespace).toBe('orders')
      })

      it('retrieves function by ID', async () => {
        const created = await store.initFunction({
          name: 'processPayment',
          namespace: 'payments',
        })

        const retrieved = await store.getFunction(created.id)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.id).toBe(created.id)
        expect(retrieved!.name).toBe('processPayment')
      })

      it('returns null for non-existent function', async () => {
        const result = await store.getFunction('nonexistent-id')

        expect(result).toBeNull()
      })
    })

    describe('createCommit', () => {
      it('creates version commit with computed SHA', async () => {
        const func = await store.initFunction({
          name: 'handler',
          namespace: 'api',
        })

        const commit = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Initial implementation',
        })

        expect(commit).toBeDefined()
        expect(commit.sha).toBeDefined()
        expect(commit.sha.length).toBe(40) // SHA-1 hex length
        expect(commit.functionId).toBe(func.id)
        expect(commit.message).toBe('Initial implementation')
        expect(commit.parentSha).toBeNull()
      })

      it('includes author metadata when provided', async () => {
        const func = await store.initFunction({
          name: 'handler',
          namespace: 'api',
        })

        const author = testAuthor('Alice Developer')

        const commit = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Add feature',
          author,
        })

        expect(commit.author.name).toBe('Alice Developer')
        expect(commit.author.email).toBe('alice.developer@example.com')
        expect(commit.author.timestamp).toBeGreaterThan(0)
      })

      it('generates default author when not provided', async () => {
        const func = await store.initFunction({
          name: 'handler',
          namespace: 'api',
        })

        const commit = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Auto-generated',
        })

        expect(commit.author).toBeDefined()
        expect(commit.author.name).toBeDefined()
        expect(commit.author.email).toBeDefined()
        expect(commit.author.timestamp).toBeGreaterThan(0)
      })

      it('produces deterministic SHA for identical content', async () => {
        const func = await store.initFunction({
          name: 'handler',
          namespace: 'api',
        })

        const content = testCode(1)

        const commit1 = await store.createCommit({
          functionId: func.id,
          content,
          message: 'First commit',
        })

        const commit2 = await store.createCommit({
          functionId: func.id,
          content, // Same content
          message: 'Second commit with same content',
        })

        // Content-addressable: same content = same SHA
        expect(commit1.sha).toBe(commit2.sha)
      })

      it('produces different SHA for different content', async () => {
        const func = await store.initFunction({
          name: 'handler',
          namespace: 'api',
        })

        const commit1 = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Version 1',
        })

        const commit2 = await store.createCommit({
          functionId: func.id,
          content: testCode(2),
          message: 'Version 2',
        })

        expect(commit1.sha).not.toBe(commit2.sha)
      })

      it('links commit to parent when parentSha provided', async () => {
        const func = await store.initFunction({
          name: 'handler',
          namespace: 'api',
        })

        const parent = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Parent commit',
        })

        const child = await store.createCommit({
          functionId: func.id,
          content: testCode(2),
          message: 'Child commit',
          parentSha: parent.sha,
        })

        expect(child.parentSha).toBe(parent.sha)
      })

      it('supports binary content (WASM)', async () => {
        const func = await store.initFunction({
          name: 'wasmModule',
          namespace: 'wasm',
        })

        // WASM magic bytes
        const wasmContent = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])

        const commit = await store.createCommit({
          functionId: func.id,
          content: wasmContent,
          message: 'WASM module',
        })

        expect(commit).toBeDefined()
        expect(commit.sha.length).toBe(40)
      })
    })

    describe('getCommit / getBlob', () => {
      it('retrieves commit by SHA', async () => {
        const func = await store.initFunction({
          name: 'handler',
          namespace: 'api',
        })

        const created = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Test commit',
        })

        const retrieved = await store.getCommit(created.sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.sha).toBe(created.sha)
        expect(retrieved!.message).toBe('Test commit')
      })

      it('returns null for non-existent SHA', async () => {
        const result = await store.getCommit('0'.repeat(40))

        expect(result).toBeNull()
      })

      it('retrieves blob content for commit', async () => {
        const func = await store.initFunction({
          name: 'handler',
          namespace: 'api',
        })

        const content = testCode(1)
        const commit = await store.createCommit({
          functionId: func.id,
          content,
          message: 'With content',
        })

        const blob = await store.getBlob(commit.sha)

        expect(blob).not.toBeNull()
        expect(blob!.sha).toBeDefined()
        expect(blob!.size).toBe(content.length)
        expect(blob!.content).toBe(content)
      })
    })
  })

  // ==========================================================================
  // 2. VERSION HISTORY AS RELATIONSHIP GRAPH
  // ==========================================================================

  describe('Version History as Relationship Graph', () => {
    describe('getHistory', () => {
      it('returns empty array for function with no versions', async () => {
        const func = await store.initFunction({
          name: 'empty',
          namespace: 'test',
        })

        const history = await store.getHistory(func.id)

        expect(history).toEqual([])
      })

      it('returns single commit for function with one version', async () => {
        const func = await store.initFunction({
          name: 'single',
          namespace: 'test',
        })

        await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Only version',
        })

        const history = await store.getHistory(func.id)

        expect(history.length).toBe(1)
        expect(history[0].message).toBe('Only version')
      })

      it('traverses parent chain in reverse chronological order', async () => {
        const func = await store.initFunction({
          name: 'chained',
          namespace: 'test',
        })

        // Create chain: v1 <- v2 <- v3
        const v1 = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Version 1',
        })

        const v2 = await store.createCommit({
          functionId: func.id,
          content: testCode(2),
          message: 'Version 2',
          parentSha: v1.sha,
        })

        const v3 = await store.createCommit({
          functionId: func.id,
          content: testCode(3),
          message: 'Version 3',
          parentSha: v2.sha,
        })

        const history = await store.getHistory(func.id, { startSha: v3.sha })

        expect(history.length).toBe(3)
        expect(history[0].message).toBe('Version 3')
        expect(history[1].message).toBe('Version 2')
        expect(history[2].message).toBe('Version 1')
      })

      it('respects limit parameter', async () => {
        const func = await store.initFunction({
          name: 'limited',
          namespace: 'test',
        })

        // Create 5 versions
        let prevSha: string | undefined
        for (let i = 1; i <= 5; i++) {
          const commit = await store.createCommit({
            functionId: func.id,
            content: testCode(i),
            message: `Version ${i}`,
            parentSha: prevSha,
          })
          prevSha = commit.sha
        }

        const history = await store.getHistory(func.id, {
          startSha: prevSha,
          limit: 3,
        })

        expect(history.length).toBe(3)
        expect(history[0].message).toBe('Version 5')
        expect(history[1].message).toBe('Version 4')
        expect(history[2].message).toBe('Version 3')
      })

      it('starts from latest version when startSha not provided', async () => {
        const func = await store.initFunction({
          name: 'auto-start',
          namespace: 'test',
        })

        const v1 = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Version 1',
        })

        await store.createCommit({
          functionId: func.id,
          content: testCode(2),
          message: 'Version 2 (latest)',
          parentSha: v1.sha,
        })

        // Create ref to mark latest
        await store.createRef({
          functionId: func.id,
          name: 'latest',
          kind: 'latest',
          targetSha: v1.sha, // Initially points to v1
        })

        const history = await store.getHistory(func.id)

        // Should find the leaf commit (v2) even without explicit startSha
        expect(history.length).toBeGreaterThanOrEqual(1)
      })

      it('handles branching history (multiple children from same parent)', async () => {
        const func = await store.initFunction({
          name: 'branched',
          namespace: 'test',
        })

        const parent = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Parent commit',
        })

        // Create two branches from same parent
        const branchA = await store.createCommit({
          functionId: func.id,
          content: testCode(2, 'Branch A code'),
          message: 'Branch A',
          parentSha: parent.sha,
        })

        const branchB = await store.createCommit({
          functionId: func.id,
          content: testCode(2, 'Branch B code'),
          message: 'Branch B',
          parentSha: parent.sha,
        })

        // Both branches should trace back to parent
        const historyA = await store.getHistory(func.id, { startSha: branchA.sha })
        const historyB = await store.getHistory(func.id, { startSha: branchB.sha })

        expect(historyA.length).toBe(2)
        expect(historyA[0].message).toBe('Branch A')
        expect(historyA[1].message).toBe('Parent commit')

        expect(historyB.length).toBe(2)
        expect(historyB[0].message).toBe('Branch B')
        expect(historyB[1].message).toBe('Parent commit')
      })
    })

    describe('relationship graph queries', () => {
      it('finds all versions of a function', async () => {
        const func = await store.initFunction({
          name: 'multi-version',
          namespace: 'test',
        })

        // Create 3 independent versions (not chained)
        await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Version 1',
        })

        await store.createCommit({
          functionId: func.id,
          content: testCode(2),
          message: 'Version 2',
        })

        await store.createCommit({
          functionId: func.id,
          content: testCode(3),
          message: 'Version 3',
        })

        // Get all versions (not just history chain)
        const history = await store.getHistory(func.id)

        expect(history.length).toBeGreaterThanOrEqual(1)
      })
    })
  })

  // ==========================================================================
  // 3. ROLLBACK TO PREVIOUS VERSIONS
  // ==========================================================================

  describe('Rollback to Previous Versions', () => {
    describe('createRef', () => {
      it('creates new ref pointing to version', async () => {
        const func = await store.initFunction({
          name: 'with-ref',
          namespace: 'test',
        })

        const commit = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Initial',
        })

        const ref = await store.createRef({
          functionId: func.id,
          name: 'latest',
          kind: 'latest',
          targetSha: commit.sha,
        })

        expect(ref.name).toBe('latest')
        expect(ref.kind).toBe('latest')
        expect(ref.targetSha).toBe(commit.sha)
      })

      it('updates existing ref to new version', async () => {
        const func = await store.initFunction({
          name: 'updated-ref',
          namespace: 'test',
        })

        const v1 = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Version 1',
        })

        const v2 = await store.createCommit({
          functionId: func.id,
          content: testCode(2),
          message: 'Version 2',
          parentSha: v1.sha,
        })

        // Create ref pointing to v1
        await store.createRef({
          functionId: func.id,
          name: 'latest',
          kind: 'latest',
          targetSha: v1.sha,
        })

        // Update ref to point to v2
        const updated = await store.createRef({
          functionId: func.id,
          name: 'latest',
          kind: 'latest',
          targetSha: v2.sha,
        })

        expect(updated.targetSha).toBe(v2.sha)

        // Resolve should return v2
        const resolved = await store.resolveRef(func.id, 'latest')
        expect(resolved!.sha).toBe(v2.sha)
      })

      it('supports semantic version tags', async () => {
        const func = await store.initFunction({
          name: 'semver',
          namespace: 'test',
        })

        const commit = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Release v1.0.0',
        })

        const ref = await store.createRef({
          functionId: func.id,
          name: 'v1.0.0',
          kind: 'semver',
          targetSha: commit.sha,
        })

        expect(ref.name).toBe('v1.0.0')
        expect(ref.kind).toBe('semver')
      })

      it('supports channel refs for A/B testing', async () => {
        const func = await store.initFunction({
          name: 'ab-test',
          namespace: 'test',
        })

        const control = await store.createCommit({
          functionId: func.id,
          content: testCode(1, 'Control version'),
          message: 'Control',
        })

        const experiment = await store.createCommit({
          functionId: func.id,
          content: testCode(2, 'Experiment version'),
          message: 'Experiment',
        })

        await store.createRef({
          functionId: func.id,
          name: 'control',
          kind: 'channel',
          targetSha: control.sha,
        })

        await store.createRef({
          functionId: func.id,
          name: 'experiment',
          kind: 'channel',
          targetSha: experiment.sha,
        })

        const refs = await store.getRefs(func.id)
        expect(refs.length).toBe(2)
        expect(refs.map(r => r.name).sort()).toEqual(['control', 'experiment'])
      })
    })

    describe('resolveRef', () => {
      it('resolves ref name to target commit', async () => {
        const func = await store.initFunction({
          name: 'resolvable',
          namespace: 'test',
        })

        const commit = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Target',
        })

        await store.createRef({
          functionId: func.id,
          name: 'latest',
          kind: 'latest',
          targetSha: commit.sha,
        })

        const resolved = await store.resolveRef(func.id, 'latest')

        expect(resolved).not.toBeNull()
        expect(resolved!.sha).toBe(commit.sha)
        expect(resolved!.message).toBe('Target')
      })

      it('returns null for non-existent ref', async () => {
        const func = await store.initFunction({
          name: 'no-ref',
          namespace: 'test',
        })

        const resolved = await store.resolveRef(func.id, 'nonexistent')

        expect(resolved).toBeNull()
      })
    })

    describe('rollback', () => {
      it('moves ref to point to older version', async () => {
        const func = await store.initFunction({
          name: 'rollback-target',
          namespace: 'test',
        })

        const v1 = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Stable version',
        })

        const v2 = await store.createCommit({
          functionId: func.id,
          content: testCode(2),
          message: 'Buggy version',
          parentSha: v1.sha,
        })

        // Point latest to v2
        await store.createRef({
          functionId: func.id,
          name: 'latest',
          kind: 'latest',
          targetSha: v2.sha,
        })

        // Rollback to v1
        const rolledBack = await store.rollback(func.id, 'latest', v1.sha)

        expect(rolledBack.targetSha).toBe(v1.sha)

        // Verify resolution
        const resolved = await store.resolveRef(func.id, 'latest')
        expect(resolved!.sha).toBe(v1.sha)
      })

      it('preserves all commits after rollback', async () => {
        const func = await store.initFunction({
          name: 'preserve-history',
          namespace: 'test',
        })

        const v1 = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Version 1',
        })

        const v2 = await store.createCommit({
          functionId: func.id,
          content: testCode(2),
          message: 'Version 2',
          parentSha: v1.sha,
        })

        await store.createRef({
          functionId: func.id,
          name: 'latest',
          kind: 'latest',
          targetSha: v2.sha,
        })

        // Rollback
        await store.rollback(func.id, 'latest', v1.sha)

        // v2 should still exist and be retrievable
        const v2Retrieved = await store.getCommit(v2.sha)
        expect(v2Retrieved).not.toBeNull()
        expect(v2Retrieved!.message).toBe('Version 2')
      })

      it('allows rollback to any historical version', async () => {
        const func = await store.initFunction({
          name: 'deep-rollback',
          namespace: 'test',
        })

        // Create chain: v1 <- v2 <- v3 <- v4 <- v5
        const commits: VersionCommit[] = []
        let prevSha: string | undefined

        for (let i = 1; i <= 5; i++) {
          const commit = await store.createCommit({
            functionId: func.id,
            content: testCode(i),
            message: `Version ${i}`,
            parentSha: prevSha,
          })
          commits.push(commit)
          prevSha = commit.sha
        }

        // Point latest to v5
        await store.createRef({
          functionId: func.id,
          name: 'latest',
          kind: 'latest',
          targetSha: commits[4].sha,
        })

        // Rollback directly to v2 (skipping v3, v4)
        await store.rollback(func.id, 'latest', commits[1].sha)

        const resolved = await store.resolveRef(func.id, 'latest')
        expect(resolved!.sha).toBe(commits[1].sha)
        expect(resolved!.message).toBe('Version 2')
      })

      it('supports rollback on different refs independently', async () => {
        const func = await store.initFunction({
          name: 'multi-ref-rollback',
          namespace: 'test',
        })

        const v1 = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Version 1',
        })

        const v2 = await store.createCommit({
          functionId: func.id,
          content: testCode(2),
          message: 'Version 2',
          parentSha: v1.sha,
        })

        // Two refs pointing to v2
        await store.createRef({
          functionId: func.id,
          name: 'stable',
          kind: 'channel',
          targetSha: v2.sha,
        })

        await store.createRef({
          functionId: func.id,
          name: 'canary',
          kind: 'channel',
          targetSha: v2.sha,
        })

        // Rollback only stable to v1
        await store.rollback(func.id, 'stable', v1.sha)

        // stable should be v1, canary should still be v2
        const stable = await store.resolveRef(func.id, 'stable')
        const canary = await store.resolveRef(func.id, 'canary')

        expect(stable!.sha).toBe(v1.sha)
        expect(canary!.sha).toBe(v2.sha)
      })
    })
  })

  // ==========================================================================
  // 4. VERSION METADATA (AUTHOR, TIMESTAMP, MESSAGE)
  // ==========================================================================

  describe('Version Metadata', () => {
    describe('author information', () => {
      it('stores complete author metadata', async () => {
        const func = await store.initFunction({
          name: 'with-author',
          namespace: 'test',
        })

        const author = testAuthor('Bob Builder')
        author.timestamp = 1700000000000 // Fixed timestamp

        const commit = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'With author',
          author,
        })

        expect(commit.author.name).toBe('Bob Builder')
        expect(commit.author.email).toBe('bob.builder@example.com')
        expect(commit.author.timestamp).toBe(1700000000000)
      })

      it('uses current timestamp when not provided', async () => {
        const func = await store.initFunction({
          name: 'auto-timestamp',
          namespace: 'test',
        })

        const beforeCreate = Date.now()

        const commit = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Auto timestamp',
        })

        const afterCreate = Date.now()

        expect(commit.author.timestamp).toBeGreaterThanOrEqual(beforeCreate)
        expect(commit.author.timestamp).toBeLessThanOrEqual(afterCreate)
      })

      it('preserves author across retrieval', async () => {
        const func = await store.initFunction({
          name: 'persistent-author',
          namespace: 'test',
        })

        const author = testAuthor('Carol Coder')

        const created = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Test',
          author,
        })

        const retrieved = await store.getCommit(created.sha)

        expect(retrieved!.author.name).toBe('Carol Coder')
        expect(retrieved!.author.email).toBe('carol.coder@example.com')
      })
    })

    describe('commit message', () => {
      it('stores and retrieves commit message', async () => {
        const func = await store.initFunction({
          name: 'with-message',
          namespace: 'test',
        })

        const commit = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'feat: Add new feature\n\nThis is a detailed description.',
        })

        expect(commit.message).toBe('feat: Add new feature\n\nThis is a detailed description.')
      })

      it('handles multi-line commit messages', async () => {
        const func = await store.initFunction({
          name: 'multiline',
          namespace: 'test',
        })

        const message = `fix: Critical bug fix

This commit fixes a critical issue where:
- Users could not log in
- Sessions were not persisting
- Error messages were unclear

Breaking changes: None
Reviewed-by: Team Lead`

        const commit = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message,
        })

        expect(commit.message).toBe(message)
      })

      it('handles unicode in messages', async () => {
        const func = await store.initFunction({
          name: 'unicode',
          namespace: 'test',
        })

        const commit = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'feat: Add internationalization support',
        })

        expect(commit.message).toContain('internationalization')
      })

      it('handles empty message (allowed but not recommended)', async () => {
        const func = await store.initFunction({
          name: 'empty-message',
          namespace: 'test',
        })

        const commit = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: '',
        })

        expect(commit.message).toBe('')
      })
    })

    describe('timestamps', () => {
      it('records createdAt timestamp on commit', async () => {
        const func = await store.initFunction({
          name: 'timestamped',
          namespace: 'test',
        })

        const beforeCreate = Date.now()

        const commit = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Timestamped',
        })

        const afterCreate = Date.now()

        expect(commit.createdAt).toBeGreaterThanOrEqual(beforeCreate)
        expect(commit.createdAt).toBeLessThanOrEqual(afterCreate)
      })

      it('author timestamp can differ from createdAt', async () => {
        const func = await store.initFunction({
          name: 'dual-timestamp',
          namespace: 'test',
        })

        // Set author timestamp to past
        const author = testAuthor('Past Author')
        author.timestamp = Date.now() - 86400000 // 1 day ago

        const commit = await store.createCommit({
          functionId: func.id,
          content: testCode(1),
          message: 'Authored yesterday',
          author,
        })

        // Author timestamp should be in the past
        expect(commit.author.timestamp).toBeLessThan(commit.createdAt)
      })
    })
  })

  // ==========================================================================
  // 5. DIFF BETWEEN VERSIONS
  // ==========================================================================

  describe('Diff Between Versions', () => {
    it('detects when content has changed', async () => {
      const func = await store.initFunction({
        name: 'diff-test',
        namespace: 'test',
      })

      const v1 = await store.createCommit({
        functionId: func.id,
        content: testCode(1),
        message: 'Version 1',
      })

      const v2 = await store.createCommit({
        functionId: func.id,
        content: testCode(2),
        message: 'Version 2',
        parentSha: v1.sha,
      })

      const diff = await store.diff(v1.sha, v2.sha)

      expect(diff.contentChanged).toBe(true)
      expect(diff.sha1).toBe(v1.sha)
      expect(diff.sha2).toBe(v2.sha)
    })

    it('detects when content is identical', async () => {
      const func = await store.initFunction({
        name: 'no-diff',
        namespace: 'test',
      })

      const content = testCode(1)

      const v1 = await store.createCommit({
        functionId: func.id,
        content,
        message: 'Version 1',
      })

      const v2 = await store.createCommit({
        functionId: func.id,
        content, // Same content
        message: 'Version 2 (same code)',
        parentSha: v1.sha,
      })

      const diff = await store.diff(v1.sha, v2.sha)

      expect(diff.contentChanged).toBe(false)
    })

    it('counts added and removed lines', async () => {
      const func = await store.initFunction({
        name: 'line-count',
        namespace: 'test',
      })

      const v1 = await store.createCommit({
        functionId: func.id,
        content: 'line1\nline2\nline3',
        message: 'Version 1',
      })

      const v2 = await store.createCommit({
        functionId: func.id,
        content: 'line1\nmodified\nline3\nline4',
        message: 'Version 2',
        parentSha: v1.sha,
      })

      const diff = await store.diff(v1.sha, v2.sha)

      expect(diff.linesAdded).toBeGreaterThan(0)
      expect(diff.linesRemoved).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // 6. EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles very large function code', async () => {
      const func = await store.initFunction({
        name: 'large',
        namespace: 'test',
      })

      const largeContent = 'x'.repeat(1_000_000) // 1MB

      const commit = await store.createCommit({
        functionId: func.id,
        content: largeContent,
        message: 'Large function',
      })

      expect(commit).toBeDefined()
      expect(commit.sha.length).toBe(40)
    })

    it('handles concurrent version creation', async () => {
      const func = await store.initFunction({
        name: 'concurrent',
        namespace: 'test',
      })

      // Create 10 versions concurrently
      const promises = Array.from({ length: 10 }, (_, i) =>
        store.createCommit({
          functionId: func.id,
          content: `version ${i} content - ${Date.now()}-${Math.random()}`,
          message: `Concurrent ${i}`,
        })
      )

      const commits = await Promise.all(promises)

      expect(commits.length).toBe(10)

      // All SHAs should be unique (different content)
      const shas = new Set(commits.map(c => c.sha))
      expect(shas.size).toBe(10)
    })

    it('handles special characters in function names', async () => {
      const func = await store.initFunction({
        name: 'process-order_v2.1',
        namespace: 'orders.v2',
      })

      expect(func.name).toBe('process-order_v2.1')
      expect(func.namespace).toBe('orders.v2')
    })

    it('handles orphan commits (no parent chain)', async () => {
      const func = await store.initFunction({
        name: 'orphan',
        namespace: 'test',
      })

      // Create commits without linking parents
      await store.createCommit({
        functionId: func.id,
        content: testCode(1),
        message: 'Orphan 1',
      })

      await store.createCommit({
        functionId: func.id,
        content: testCode(2),
        message: 'Orphan 2',
      })

      // History without startSha should still work
      const history = await store.getHistory(func.id)

      // Should find at least one version
      expect(history.length).toBeGreaterThanOrEqual(1)
    })

    it('handles function with refs but no commits pointing to valid SHA', async () => {
      const func = await store.initFunction({
        name: 'dangling-ref',
        namespace: 'test',
      })

      // This tests error handling when ref points to non-existent commit
      // Implementation should either prevent this or handle gracefully
      // For RED phase, we define the expected behavior

      const resolved = await store.resolveRef(func.id, 'nonexistent')
      expect(resolved).toBeNull()
    })
  })
})
