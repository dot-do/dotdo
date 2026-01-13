/**
 * Function Versioning via gitx Relationships Tests - RED PHASE
 *
 * Tests for Function versioning using gitx-style Relationships. This enables:
 * - Function versions stored as graph nodes (Things)
 * - Version history via parent relationships (like git commits)
 * - Refs for named versions (latest, v1.0.0, canary, etc.)
 * - A/B testing via multiple active refs
 *
 * @see dotdo-arc8z - [RED] Function Version via gitx Relationships Tests
 *
 * Design:
 * - Function -> Thing with type='Function', data={name, namespace}
 * - FunctionVersion -> Thing with type='FunctionVersion', data={sha, message, author, timestamp}
 * - FunctionBlob -> Thing with type='FunctionBlob', data={size, contentRef}
 * - FunctionRef -> Thing with type='FunctionRef', data={name, kind}
 *
 * Relationships (gitx-style):
 * - FunctionVersion `definedIn` Function (version belongs to function)
 * - FunctionVersion `parent` FunctionVersion (version history chain)
 * - FunctionVersion `hasContent` FunctionBlob (code content reference)
 * - FunctionRef `pointsTo` FunctionVersion (named version reference)
 *
 * NO MOCKS - uses real SQLiteGraphStore
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores'
import type { GraphStore, GraphThing, GraphRelationship } from '../types'

// ============================================================================
// TEST FIXTURES - Function Version Types as Thing Data
// ============================================================================

/**
 * Function Thing data structure
 */
interface FunctionData {
  name: string
  namespace: string
  description?: string
  runtime?: string // e.g., 'typescript', 'javascript', 'python'
}

/**
 * FunctionVersion Thing data structure (like a git commit)
 */
interface FunctionVersionData {
  sha: string // Content-addressable hash
  message: string // Version message (like commit message)
  author: {
    name: string
    email: string
    timestamp: number
  }
  functionId: string // Reference to parent Function
  parentSha?: string // Previous version SHA (null for initial version)
}

/**
 * FunctionBlob Thing data structure (like a git blob)
 */
interface FunctionBlobData {
  size: number
  contentRef: string // External storage reference (e.g., 'r2:functions/sha256-abc')
  contentType: string // 'text/typescript', 'application/javascript', etc.
  hash: string // SHA-256 of content
}

/**
 * FunctionRef Thing data structure (like git branch/tag)
 */
interface FunctionRefData {
  name: string // 'latest', 'v1.0.0', 'canary', 'stable', etc.
  kind: 'latest' | 'version' | 'tag' | 'channel' // Type of ref
  functionId: string // Which function this ref belongs to
}

// ============================================================================
// FUNCTIONVERSIONADAPTER INTERFACE (to be implemented in GREEN phase)
// ============================================================================

/**
 * FunctionVersionAdapter - bridges function versioning with GraphStore
 *
 * This adapter will be implemented in the GREEN phase.
 * Tests are written against this expected interface.
 */
interface FunctionVersionAdapter {
  /**
   * Create a Function as a Thing
   */
  createFunction(data: {
    name: string
    namespace: string
    description?: string
    runtime?: string
  }): Promise<GraphThing>

  /**
   * Create a new version of a function (like git commit)
   */
  createVersion(data: {
    functionId: string
    content: string | Uint8Array
    message: string
    author?: { name: string; email: string }
    parentSha?: string
  }): Promise<GraphThing>

  /**
   * Create or update a ref pointing to a version
   */
  createRef(
    functionId: string,
    name: string,
    kind: FunctionRefData['kind'],
    versionSha: string
  ): Promise<GraphThing>

  /**
   * Resolve a ref name to its target version Thing
   */
  resolveRef(functionId: string, refName: string): Promise<GraphThing | null>

  /**
   * Get version history by traversing parent relationships
   */
  getVersionHistory(
    functionId: string,
    startSha?: string,
    options?: { limit?: number }
  ): Promise<GraphThing[]>

  /**
   * Get a specific version by SHA
   */
  getVersion(sha: string): Promise<GraphThing | null>

  /**
   * Get all versions of a function
   */
  getAllVersions(functionId: string): Promise<GraphThing[]>

  /**
   * Get all refs for a function
   */
  getRefs(functionId: string): Promise<GraphThing[]>

  /**
   * Rollback: create new ref pointing to an older version
   */
  rollback(functionId: string, refName: string, targetSha: string): Promise<GraphThing>
}

// ============================================================================
// TEST HELPER STUBS (will fail until FunctionVersionAdapter is implemented)
// ============================================================================

/**
 * Create a FunctionVersionAdapter - THIS WILL FAIL until implemented
 */
async function createFunctionVersionAdapter(_store: GraphStore): Promise<FunctionVersionAdapter> {
  // Import will fail until module exists
  const { FunctionVersionAdapter } = await import('../adapters/function-version-adapter')
  return new FunctionVersionAdapter(_store)
}

/**
 * Generate a test SHA-like ID
 */
function testSha(content: string): string {
  // Simple hash-like string for testing
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  const hashStr = Math.abs(hash).toString(16).padStart(8, '0')
  return hashStr.padEnd(40, '0')
}

/**
 * Create test author identity
 */
function testAuthor(name: string): { name: string; email: string } {
  return {
    name,
    email: `${name.toLowerCase().replace(/\s/g, '.')}@example.com`,
  }
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Function Versioning via gitx Relationships', () => {
  let store: SQLiteGraphStore
  let adapter: FunctionVersionAdapter

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    // This will fail until FunctionVersionAdapter is implemented
    adapter = await createFunctionVersionAdapter(store)
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // 1. VERSION CREATION
  // ==========================================================================

  describe('Version Creation', () => {
    describe('createFunction', () => {
      it('creates Function Thing with correct type', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        expect(func).toBeDefined()
        expect(func.typeName).toBe('Function')
        expect(func.id).toBeDefined()
      })

      it('stores function metadata in Thing data', async () => {
        const func = await adapter.createFunction({
          name: 'processPayment',
          namespace: 'payments',
          description: 'Process customer payments',
          runtime: 'typescript',
        })

        const data = func.data as FunctionData
        expect(data.name).toBe('processPayment')
        expect(data.namespace).toBe('payments')
        expect(data.description).toBe('Process customer payments')
        expect(data.runtime).toBe('typescript')
      })
    })

    describe('createVersion', () => {
      it('creates FunctionVersion Thing with SHA', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        const version = await adapter.createVersion({
          functionId: func.id,
          content: 'export function processOrder() { return true }',
          message: 'Initial implementation',
        })

        expect(version).toBeDefined()
        expect(version.typeName).toBe('FunctionVersion')
        const data = version.data as FunctionVersionData
        expect(data.sha).toBeDefined()
        expect(data.sha.length).toBe(40) // SHA-like format
      })

      it('links Version to Function via definedIn relationship', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        const version = await adapter.createVersion({
          functionId: func.id,
          content: 'export function processOrder() {}',
          message: 'Initial',
        })

        // Query relationships from version
        const data = version.data as FunctionVersionData
        const rels = await store.queryRelationshipsFrom(`do://functions/versions/${data.sha}`, {
          verb: 'definedIn',
        })

        expect(rels.length).toBe(1)
        expect(rels[0].to).toContain(func.id)
      })

      it('stores version metadata (author, message, timestamp)', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        const author = testAuthor('Alice Developer')

        const version = await adapter.createVersion({
          functionId: func.id,
          content: 'export function processOrder() { /* v1 */ }',
          message: 'Add order processing logic',
          author,
        })

        const data = version.data as FunctionVersionData
        expect(data.message).toBe('Add order processing logic')
        expect(data.author.name).toBe('Alice Developer')
        expect(data.author.email).toBe('alice.developer@example.com')
        expect(data.author.timestamp).toBeGreaterThan(0)
      })

      it('creates hasContent relationship to FunctionBlob', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        const content = 'export function processOrder(order: Order) { return order.process() }'
        const version = await adapter.createVersion({
          functionId: func.id,
          content,
          message: 'Add order processing',
        })

        const data = version.data as FunctionVersionData
        const rels = await store.queryRelationshipsFrom(`do://functions/versions/${data.sha}`, {
          verb: 'hasContent',
        })

        expect(rels.length).toBe(1)
        expect(rels[0].to).toContain('do://functions/blobs/')
      })

      it('links version to parent via parent relationship', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        const v1 = await adapter.createVersion({
          functionId: func.id,
          content: 'export function processOrder() { /* v1 */ }',
          message: 'Initial version',
        })

        const v1Data = v1.data as FunctionVersionData

        const v2 = await adapter.createVersion({
          functionId: func.id,
          content: 'export function processOrder() { /* v2 */ }',
          message: 'Add validation',
          parentSha: v1Data.sha,
        })

        const v2Data = v2.data as FunctionVersionData
        const rels = await store.queryRelationshipsFrom(`do://functions/versions/${v2Data.sha}`, {
          verb: 'parent',
        })

        expect(rels.length).toBe(1)
        expect(rels[0].to).toContain(v1Data.sha)
      })

      it('initial version has no parent relationship', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        const version = await adapter.createVersion({
          functionId: func.id,
          content: 'export function processOrder() {}',
          message: 'Initial',
        })

        const data = version.data as FunctionVersionData
        const rels = await store.queryRelationshipsFrom(`do://functions/versions/${data.sha}`, {
          verb: 'parent',
        })

        expect(rels.length).toBe(0)
      })

      it('generates deterministic SHA from content', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        const content = 'export function processOrder() { return true }'

        const v1 = await adapter.createVersion({
          functionId: func.id,
          content,
          message: 'Version 1',
        })

        const v2 = await adapter.createVersion({
          functionId: func.id,
          content, // Same content
          message: 'Version 2', // Different message
        })

        const v1Data = v1.data as FunctionVersionData
        const v2Data = v2.data as FunctionVersionData

        // Same content should produce same SHA (content-addressable)
        expect(v1Data.sha).toBe(v2Data.sha)
      })
    })
  })

  // ==========================================================================
  // 2. VERSION HISTORY
  // ==========================================================================

  describe('Version History', () => {
    describe('getVersionHistory', () => {
      it('traverses version chain via parent relationships', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        // Create version chain: v1 <- v2 <- v3
        const v1 = await adapter.createVersion({
          functionId: func.id,
          content: 'v1 content',
          message: 'First version',
        })
        const v1Data = v1.data as FunctionVersionData

        const v2 = await adapter.createVersion({
          functionId: func.id,
          content: 'v2 content',
          message: 'Second version',
          parentSha: v1Data.sha,
        })
        const v2Data = v2.data as FunctionVersionData

        const v3 = await adapter.createVersion({
          functionId: func.id,
          content: 'v3 content',
          message: 'Third version',
          parentSha: v2Data.sha,
        })
        const v3Data = v3.data as FunctionVersionData

        const history = await adapter.getVersionHistory(func.id, v3Data.sha)

        expect(history.length).toBe(3)
        expect((history[0].data as FunctionVersionData).message).toBe('Third version')
        expect((history[1].data as FunctionVersionData).message).toBe('Second version')
        expect((history[2].data as FunctionVersionData).message).toBe('First version')
      })

      it('queries all versions of a function', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        // Create multiple versions
        await adapter.createVersion({
          functionId: func.id,
          content: 'v1 content',
          message: 'Version 1',
        })
        await adapter.createVersion({
          functionId: func.id,
          content: 'v2 content',
          message: 'Version 2',
        })
        await adapter.createVersion({
          functionId: func.id,
          content: 'v3 content',
          message: 'Version 3',
        })

        const allVersions = await adapter.getAllVersions(func.id)

        expect(allVersions.length).toBe(3)
      })

      it('respects version limit parameter', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        // Create 5 versions in a chain
        let prevSha: string | undefined
        for (let i = 1; i <= 5; i++) {
          const version = await adapter.createVersion({
            functionId: func.id,
            content: `version ${i} content`,
            message: `Version ${i}`,
            parentSha: prevSha,
          })
          prevSha = (version.data as FunctionVersionData).sha
        }

        const history = await adapter.getVersionHistory(func.id, prevSha, { limit: 2 })

        expect(history.length).toBe(2)
      })

      it('returns empty array for non-existent function', async () => {
        const history = await adapter.getVersionHistory('nonexistent-function')

        expect(history).toEqual([])
      })
    })

    describe('getVersion', () => {
      it('retrieves version by SHA', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        const version = await adapter.createVersion({
          functionId: func.id,
          content: 'test content',
          message: 'Test version',
        })

        const versionData = version.data as FunctionVersionData
        const retrieved = await adapter.getVersion(versionData.sha)

        expect(retrieved).not.toBeNull()
        expect((retrieved!.data as FunctionVersionData).sha).toBe(versionData.sha)
      })

      it('returns null for non-existent SHA', async () => {
        const retrieved = await adapter.getVersion('nonexistent' + '0'.repeat(31))

        expect(retrieved).toBeNull()
      })
    })
  })

  // ==========================================================================
  // 3. VERSION RESOLUTION (Refs)
  // ==========================================================================

  describe('Version Resolution', () => {
    describe('createRef', () => {
      it('creates FunctionRef Thing for latest', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        const version = await adapter.createVersion({
          functionId: func.id,
          content: 'export function processOrder() {}',
          message: 'Initial',
        })
        const versionData = version.data as FunctionVersionData

        const ref = await adapter.createRef(func.id, 'latest', 'latest', versionData.sha)

        expect(ref.typeName).toBe('FunctionRef')
        const refData = ref.data as FunctionRefData
        expect(refData.name).toBe('latest')
        expect(refData.kind).toBe('latest')
      })

      it('creates pointsTo relationship to version', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        const version = await adapter.createVersion({
          functionId: func.id,
          content: 'export function processOrder() {}',
          message: 'Initial',
        })
        const versionData = version.data as FunctionVersionData

        const ref = await adapter.createRef(func.id, 'latest', 'latest', versionData.sha)

        const rels = await store.queryRelationshipsFrom(`do://functions/refs/${ref.id}`, {
          verb: 'pointsTo',
        })

        expect(rels.length).toBe(1)
        expect(rels[0].to).toContain(versionData.sha)
      })

      it('updates existing ref to new version', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        const v1 = await adapter.createVersion({
          functionId: func.id,
          content: 'v1 content',
          message: 'Version 1',
        })
        const v1Data = v1.data as FunctionVersionData

        const v2 = await adapter.createVersion({
          functionId: func.id,
          content: 'v2 content',
          message: 'Version 2',
          parentSha: v1Data.sha,
        })
        const v2Data = v2.data as FunctionVersionData

        // Create ref pointing to v1
        await adapter.createRef(func.id, 'latest', 'latest', v1Data.sha)

        // Update ref to point to v2
        await adapter.createRef(func.id, 'latest', 'latest', v2Data.sha)

        // Resolve should return v2
        const resolved = await adapter.resolveRef(func.id, 'latest')
        expect((resolved!.data as FunctionVersionData).sha).toBe(v2Data.sha)
      })
    })

    describe('resolveRef', () => {
      it('resolves "latest" ref to most recent version', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        const version = await adapter.createVersion({
          functionId: func.id,
          content: 'export function processOrder() {}',
          message: 'Latest version',
        })
        const versionData = version.data as FunctionVersionData

        await adapter.createRef(func.id, 'latest', 'latest', versionData.sha)

        const resolved = await adapter.resolveRef(func.id, 'latest')

        expect(resolved).not.toBeNull()
        expect(resolved!.typeName).toBe('FunctionVersion')
        expect((resolved!.data as FunctionVersionData).sha).toBe(versionData.sha)
      })

      it('resolves semantic version tags (v1.0.0)', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        const version = await adapter.createVersion({
          functionId: func.id,
          content: 'stable release content',
          message: 'Release v1.0.0',
        })
        const versionData = version.data as FunctionVersionData

        await adapter.createRef(func.id, 'v1.0.0', 'version', versionData.sha)

        const resolved = await adapter.resolveRef(func.id, 'v1.0.0')

        expect(resolved).not.toBeNull()
        expect((resolved!.data as FunctionVersionData).sha).toBe(versionData.sha)
      })

      it('returns null for non-existent ref', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        const resolved = await adapter.resolveRef(func.id, 'nonexistent')

        expect(resolved).toBeNull()
      })

      it('resolves channel refs (canary, stable)', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        const stableVersion = await adapter.createVersion({
          functionId: func.id,
          content: 'stable content',
          message: 'Stable release',
        })
        const stableData = stableVersion.data as FunctionVersionData

        await adapter.createRef(func.id, 'stable', 'channel', stableData.sha)

        const resolved = await adapter.resolveRef(func.id, 'stable')
        expect((resolved!.data as FunctionVersionData).sha).toBe(stableData.sha)
      })
    })

    describe('A/B Testing via Multiple Refs', () => {
      it('supports multiple refs for A/B testing', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        // Create two different versions
        const versionA = await adapter.createVersion({
          functionId: func.id,
          content: 'export function processOrder() { /* version A */ }',
          message: 'Version A - original',
        })
        const versionAData = versionA.data as FunctionVersionData

        const versionB = await adapter.createVersion({
          functionId: func.id,
          content: 'export function processOrder() { /* version B - experimental */ }',
          message: 'Version B - experimental',
        })
        const versionBData = versionB.data as FunctionVersionData

        // Create refs for A/B testing
        await adapter.createRef(func.id, 'control', 'channel', versionAData.sha)
        await adapter.createRef(func.id, 'experiment', 'channel', versionBData.sha)

        // Resolve both refs
        const control = await adapter.resolveRef(func.id, 'control')
        const experiment = await adapter.resolveRef(func.id, 'experiment')

        expect(control).not.toBeNull()
        expect(experiment).not.toBeNull()
        expect((control!.data as FunctionVersionData).sha).toBe(versionAData.sha)
        expect((experiment!.data as FunctionVersionData).sha).toBe(versionBData.sha)
      })

      it('getRefs returns all refs for a function', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        const version = await adapter.createVersion({
          functionId: func.id,
          content: 'content',
          message: 'Release',
        })
        const versionData = version.data as FunctionVersionData

        // Create multiple refs pointing to same version
        await adapter.createRef(func.id, 'latest', 'latest', versionData.sha)
        await adapter.createRef(func.id, 'v1.0.0', 'version', versionData.sha)
        await adapter.createRef(func.id, 'stable', 'channel', versionData.sha)

        const refs = await adapter.getRefs(func.id)

        expect(refs.length).toBe(3)
        expect(refs.map((r) => (r.data as FunctionRefData).name).sort()).toEqual([
          'latest',
          'stable',
          'v1.0.0',
        ])
      })

      it('supports percentage-based traffic routing metadata', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        const versionA = await adapter.createVersion({
          functionId: func.id,
          content: 'version A',
          message: 'Control',
        })
        const versionAData = versionA.data as FunctionVersionData

        const versionB = await adapter.createVersion({
          functionId: func.id,
          content: 'version B',
          message: 'Experiment',
        })
        const versionBData = versionB.data as FunctionVersionData

        // Create refs with traffic percentage in data
        const controlRef = await adapter.createRef(func.id, 'production-90', 'channel', versionAData.sha)
        const experimentRef = await adapter.createRef(func.id, 'production-10', 'channel', versionBData.sha)

        // Both refs should exist
        const refs = await adapter.getRefs(func.id)
        expect(refs.length).toBeGreaterThanOrEqual(2)
      })
    })
  })

  // ==========================================================================
  // 4. ROLLBACK OPERATIONS
  // ==========================================================================

  describe('Rollback Operations', () => {
    describe('rollback', () => {
      it('creates new ref pointing to older version', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        // Create version chain
        const v1 = await adapter.createVersion({
          functionId: func.id,
          content: 'v1 content - stable',
          message: 'Version 1 - stable',
        })
        const v1Data = v1.data as FunctionVersionData

        const v2 = await adapter.createVersion({
          functionId: func.id,
          content: 'v2 content - buggy',
          message: 'Version 2 - has bugs',
          parentSha: v1Data.sha,
        })
        const v2Data = v2.data as FunctionVersionData

        // Point latest to v2
        await adapter.createRef(func.id, 'latest', 'latest', v2Data.sha)

        // Rollback to v1
        await adapter.rollback(func.id, 'latest', v1Data.sha)

        // Verify latest now points to v1
        const resolved = await adapter.resolveRef(func.id, 'latest')
        expect((resolved!.data as FunctionVersionData).sha).toBe(v1Data.sha)
      })

      it('preserves version history after rollback', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        const v1 = await adapter.createVersion({
          functionId: func.id,
          content: 'v1 content',
          message: 'Version 1',
        })
        const v1Data = v1.data as FunctionVersionData

        const v2 = await adapter.createVersion({
          functionId: func.id,
          content: 'v2 content',
          message: 'Version 2',
          parentSha: v1Data.sha,
        })
        const v2Data = v2.data as FunctionVersionData

        // Rollback
        await adapter.rollback(func.id, 'latest', v1Data.sha)

        // All versions should still exist
        const allVersions = await adapter.getAllVersions(func.id)
        expect(allVersions.length).toBe(2)

        // v2 should still be retrievable
        const v2Retrieved = await adapter.getVersion(v2Data.sha)
        expect(v2Retrieved).not.toBeNull()
      })

      it('allows rollback to any historical version', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        // Create chain: v1 <- v2 <- v3 <- v4
        let prevSha: string | undefined
        const versions: string[] = []
        for (let i = 1; i <= 4; i++) {
          const version = await adapter.createVersion({
            functionId: func.id,
            content: `version ${i} content`,
            message: `Version ${i}`,
            parentSha: prevSha,
          })
          prevSha = (version.data as FunctionVersionData).sha
          versions.push(prevSha)
        }

        // Point latest to v4
        await adapter.createRef(func.id, 'latest', 'latest', versions[3])

        // Rollback directly to v1
        await adapter.rollback(func.id, 'latest', versions[0])

        const resolved = await adapter.resolveRef(func.id, 'latest')
        expect((resolved!.data as FunctionVersionData).sha).toBe(versions[0])
      })
    })
  })

  // ==========================================================================
  // 5. GRAPH QUERY PATTERNS
  // ==========================================================================

  describe('Graph Query Patterns', () => {
    describe('reverse traversals', () => {
      it('finds all versions of a function via definedIn', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        // Create multiple versions
        await adapter.createVersion({
          functionId: func.id,
          content: 'v1',
          message: 'V1',
        })
        await adapter.createVersion({
          functionId: func.id,
          content: 'v2',
          message: 'V2',
        })

        // Query backwards: which versions belong to this function?
        const rels = await store.queryRelationshipsTo(`do://functions/${func.id}`, {
          verb: 'definedIn',
        })

        expect(rels.length).toBe(2)
      })

      it('finds refs pointing to a version', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        const version = await adapter.createVersion({
          functionId: func.id,
          content: 'content',
          message: 'Release',
        })
        const versionData = version.data as FunctionVersionData

        // Multiple refs can point to same version
        await adapter.createRef(func.id, 'latest', 'latest', versionData.sha)
        await adapter.createRef(func.id, 'v1.0.0', 'version', versionData.sha)

        const rels = await store.queryRelationshipsTo(`do://functions/versions/${versionData.sha}`, {
          verb: 'pointsTo',
        })

        expect(rels.length).toBe(2)
      })

      it('finds child versions (versions with this as parent)', async () => {
        const func = await adapter.createFunction({
          name: 'processOrder',
          namespace: 'orders',
        })

        const parent = await adapter.createVersion({
          functionId: func.id,
          content: 'parent',
          message: 'Parent',
        })
        const parentData = parent.data as FunctionVersionData

        // Create two children from same parent (branching)
        await adapter.createVersion({
          functionId: func.id,
          content: 'child 1',
          message: 'Child 1',
          parentSha: parentData.sha,
        })
        await adapter.createVersion({
          functionId: func.id,
          content: 'child 2',
          message: 'Child 2',
          parentSha: parentData.sha,
        })

        const rels = await store.queryRelationshipsTo(`do://functions/versions/${parentData.sha}`, {
          verb: 'parent',
        })

        expect(rels.length).toBe(2)
      })
    })

    describe('type filtering', () => {
      it('queries all Function Things', async () => {
        await adapter.createFunction({ name: 'func1', namespace: 'ns1' })
        await adapter.createFunction({ name: 'func2', namespace: 'ns2' })

        const functions = await store.getThingsByType({ typeName: 'Function' })

        expect(functions.length).toBeGreaterThanOrEqual(2)
        expect(functions.every((t) => t.typeName === 'Function')).toBe(true)
      })

      it('queries all FunctionVersion Things', async () => {
        const func = await adapter.createFunction({ name: 'func1', namespace: 'ns1' })
        await adapter.createVersion({ functionId: func.id, content: 'v1', message: 'V1' })
        await adapter.createVersion({ functionId: func.id, content: 'v2', message: 'V2' })

        const versions = await store.getThingsByType({ typeName: 'FunctionVersion' })

        expect(versions.length).toBeGreaterThanOrEqual(2)
        expect(versions.every((t) => t.typeName === 'FunctionVersion')).toBe(true)
      })

      it('queries all FunctionRef Things', async () => {
        const func = await adapter.createFunction({ name: 'func1', namespace: 'ns1' })
        const version = await adapter.createVersion({
          functionId: func.id,
          content: 'content',
          message: 'Release',
        })
        const versionData = version.data as FunctionVersionData

        await adapter.createRef(func.id, 'latest', 'latest', versionData.sha)
        await adapter.createRef(func.id, 'v1.0.0', 'version', versionData.sha)

        const refs = await store.getThingsByType({ typeName: 'FunctionRef' })

        expect(refs.length).toBeGreaterThanOrEqual(2)
        expect(refs.every((t) => t.typeName === 'FunctionRef')).toBe(true)
      })
    })
  })

  // ==========================================================================
  // 6. EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles empty function (no versions)', async () => {
      const func = await adapter.createFunction({
        name: 'emptyFunc',
        namespace: 'test',
      })

      const versions = await adapter.getAllVersions(func.id)
      expect(versions).toEqual([])

      const resolved = await adapter.resolveRef(func.id, 'latest')
      expect(resolved).toBeNull()
    })

    it('handles very long function code', async () => {
      const func = await adapter.createFunction({
        name: 'longFunc',
        namespace: 'test',
      })

      const longContent = 'x'.repeat(100000) // 100KB of code

      const version = await adapter.createVersion({
        functionId: func.id,
        content: longContent,
        message: 'Large function',
      })

      expect(version).toBeDefined()
    })

    it('handles special characters in function names', async () => {
      const func = await adapter.createFunction({
        name: 'process-order_v2',
        namespace: 'orders.v2',
      })

      const data = func.data as FunctionData
      expect(data.name).toBe('process-order_v2')
      expect(data.namespace).toBe('orders.v2')
    })

    it('handles unicode in version messages', async () => {
      const func = await adapter.createFunction({
        name: 'internationalFunc',
        namespace: 'i18n',
      })

      const version = await adapter.createVersion({
        functionId: func.id,
        content: 'export function greet() {}',
        message: 'Add internationalization support',
      })

      const data = version.data as FunctionVersionData
      expect(data.message).toContain('internationalization')
    })

    it('handles binary content in function', async () => {
      const func = await adapter.createFunction({
        name: 'wasmFunc',
        namespace: 'wasm',
      })

      // WASM magic bytes
      const wasmContent = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])

      const version = await adapter.createVersion({
        functionId: func.id,
        content: wasmContent,
        message: 'WASM module',
      })

      expect(version).toBeDefined()
    })

    it('handles concurrent version creation', async () => {
      const func = await adapter.createFunction({
        name: 'concurrentFunc',
        namespace: 'test',
      })

      // Create multiple versions concurrently
      const promises = Array.from({ length: 5 }, (_, i) =>
        adapter.createVersion({
          functionId: func.id,
          content: `version ${i} content - unique ${Date.now()}-${Math.random()}`,
          message: `Concurrent version ${i}`,
        })
      )

      const versions = await Promise.all(promises)

      expect(versions.length).toBe(5)
      const shas = new Set(versions.map((v) => (v.data as FunctionVersionData).sha))
      expect(shas.size).toBe(5) // All should be unique
    })
  })
})
