/**
 * ACID Test Suite - Phase 1: move() - Comprehensive Move Operations
 *
 * RED TDD: These tests define the expected behavior for move() operations.
 *
 * This test suite covers TWO types of move operations:
 * 1. DO Relocation (move DO to different Cloudflare colo)
 * 2. State/Thing Moves (relocate things within DO or between DOs)
 *
 * Additionally covers filesystem-level moves for fsx:
 * - File moves
 * - Directory moves
 * - Move with history preservation
 * - Conflict handling
 *
 * ACID Properties Tested:
 * - Atomicity: Complete transfer before old entity cleanup
 * - Consistency: State unchanged during move
 * - Isolation: Move doesn't affect ongoing operations
 * - Durability: New location persists and is discoverable
 *
 * @see objects/DOFull.ts for move implementation
 * @see objects/tests/do-move.test.ts for basic move tests
 * @see primitives/fsx for filesystem move operations
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace } from '../../do'
import { DO } from '../../../objects/DO'

// ============================================================================
// TYPE DEFINITIONS FOR MOVE API
// ============================================================================

/**
 * Valid Cloudflare colo codes and region hints
 */
const VALID_COLOS = new Set([
  // Region hints
  'wnam', 'enam', 'sam', 'weur', 'eeur', 'apac', 'oc', 'afr', 'me',
  // Specific colo codes
  'ewr', 'lax', 'cdg', 'sin', 'syd', 'nrt', 'hkg', 'gru',
  'ord', 'dfw', 'iad', 'sjc', 'atl', 'mia', 'sea', 'den',
  'ams', 'fra', 'lhr', 'mad', 'mxp', 'zrh', 'vie', 'arn',
  'bom', 'del', 'hnd', 'icn', 'kix', 'mel', 'akl', 'jnb',
])

/**
 * Options for the DO move() operation
 */
interface MoveOptions {
  /** Target colo code (e.g., 'ewr', 'lax', 'cdg') */
  colo: string
  /** Correlation ID for tracing */
  correlationId?: string
  /** Force move even if already at target colo */
  force?: boolean
}

/**
 * Result of a DO move operation
 */
interface MoveResult {
  /** Previous colo */
  fromColo: string | null
  /** New colo */
  toColo: string
  /** New DO ID */
  newDoId: string
  /** Duration in ms */
  durationMs?: number
}

/**
 * Options for filesystem move operation
 */
interface FsMoveOptions {
  /** Overwrite existing file/directory */
  overwrite?: boolean
  /** Preserve history/versions */
  preserveHistory?: boolean
  /** Move as atomic operation */
  atomic?: boolean
}

/**
 * Result of filesystem move operation
 */
interface FsMoveResult {
  /** Source path */
  from: string
  /** Destination path */
  to: string
  /** Whether it was a directory */
  isDirectory: boolean
  /** Number of items moved (for directories) */
  itemCount?: number
  /** History entries preserved */
  historyPreserved?: number
}

/**
 * Move event types
 */
type MoveEventType =
  | 'move.started'
  | 'move.completed'
  | 'move.failed'
  | 'fs.move.started'
  | 'fs.move.completed'
  | 'fs.move.failed'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create sample thing data for testing
 */
function createSampleThing(overrides: Partial<{
  id: string
  type: number
  branch: string | null
  name: string
  data: Record<string, unknown>
  deleted: boolean
  rowid: number
}> = {}) {
  return {
    id: overrides.id ?? 'thing-001',
    type: overrides.type ?? 1,
    branch: overrides.branch ?? null,
    name: overrides.name ?? 'Test Thing',
    data: overrides.data ?? { key: 'value' },
    deleted: overrides.deleted ?? false,
    rowid: overrides.rowid ?? 1,
  }
}

/**
 * Create sample file entry for fsx testing
 */
function createSampleFile(overrides: Partial<{
  path: string
  content: string
  mtime: Date
  ctime: Date
  size: number
  isDirectory: boolean
  version: number
}> = {}) {
  return {
    path: overrides.path ?? '/test/file.txt',
    content: overrides.content ?? 'Hello, World!',
    mtime: overrides.mtime ?? new Date(),
    ctime: overrides.ctime ?? new Date(),
    size: overrides.size ?? 13,
    isDirectory: overrides.isDirectory ?? false,
    version: overrides.version ?? 1,
  }
}

/**
 * Create sample file history entry
 */
function createSampleHistory(overrides: Partial<{
  path: string
  version: number
  content: string
  timestamp: Date
  author: string
}> = {}) {
  return {
    path: overrides.path ?? '/test/file.txt',
    version: overrides.version ?? 1,
    content: overrides.content ?? 'Original content',
    timestamp: overrides.timestamp ?? new Date(),
    author: overrides.author ?? 'user',
  }
}

// ============================================================================
// DO RELOCATION TESTS
// ============================================================================

describe('ACID Phase 1: move() - DO Relocation', () => {
  let mockResult: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    mockResult = createMockDO(DO, {
      id: 'test-do',
      ns: 'https://test.example.com',
    })

    // Set up initial state
    mockResult.sqlData.set('things', [
      createSampleThing({ id: 'customer-1', name: 'Alice' }),
      createSampleThing({ id: 'customer-2', name: 'Bob' }),
    ])

    // Mock newUniqueId to track locationHint
    mockResult.env.DO.newUniqueId = vi.fn().mockImplementation((options?: { locationHint?: string }) => ({
      toString: () => `new-id-${options?.locationHint || 'default'}`,
      locationHint: options?.locationHint,
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BASIC MOVE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Basic Move Operations', () => {
    it('should move DO to a different colo', async () => {
      const result = await mockResult.instance.move({ colo: 'ewr' } as MoveOptions)

      expect(result).toHaveProperty('toColo', 'ewr')
      expect(result).toHaveProperty('newDoId')
      expect(typeof result.newDoId).toBe('string')
    })

    it('should create new DO with locationHint', async () => {
      await mockResult.instance.move({ colo: 'lax' } as MoveOptions)

      // Verify newUniqueId was called with locationHint
      expect(mockResult.env.DO.newUniqueId).toHaveBeenCalledWith(
        expect.objectContaining({ locationHint: 'lax' })
      )
    })

    it('should transfer all state to new DO', async () => {
      let transferredData: unknown = null

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'new-do-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            transferredData = await req.json()
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.move({ colo: 'cdg' } as MoveOptions)

      expect(transferredData).not.toBeNull()
    })

    it('should emit move.started and move.completed events', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      await mockResult.instance.move({ colo: 'sin' } as MoveOptions)

      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).toContain('move.started')
      expect(eventVerbs).toContain('move.completed')
    })

    it('should update objects registry', async () => {
      const objects = mockResult.sqlData.get('objects') as Array<{ id: string; colo: string }>

      await mockResult.instance.move({ colo: 'syd' } as MoveOptions)

      // Objects registry should reflect new location
      // Implementation may vary, but location should be recorded somewhere
      expect(mockResult.env.DO.newUniqueId).toHaveBeenCalled()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Validation', () => {
    it('should validate colo code', async () => {
      await expect(mockResult.instance.move({
        colo: 'invalid-colo-code',
      } as MoveOptions)).rejects.toThrow(/Invalid colo code/)
    })

    it('should prevent moving to current colo', async () => {
      // Set current colo
      mockResult.storage.data.set('colo', 'ewr')

      await expect(mockResult.instance.move({
        colo: 'ewr',
      } as MoveOptions)).rejects.toThrow(/Already at target colo|same colo/)
    })

    it('should allow force move to same colo', async () => {
      mockResult.storage.data.set('colo', 'ewr')

      // Force should bypass the same-colo check
      const result = await mockResult.instance.move({
        colo: 'ewr',
        force: true,
      } as MoveOptions)

      expect(result).toBeDefined()
    })

    it('should error when no state to move', async () => {
      mockResult.sqlData.set('things', [])

      await expect(mockResult.instance.move({
        colo: 'fra',
      } as MoveOptions)).rejects.toThrow(/No state to move|empty/)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ATOMICITY (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Atomicity', () => {
    it('should complete transfer before old DO cleanup', async () => {
      const operationOrder: string[] = []

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'new-do-id' },
        fetch: vi.fn().mockImplementation(async () => {
          operationOrder.push('transfer')
          return new Response('OK')
        }),
      })

      // Track state clearing
      const originalDelete = mockResult.storage.deleteAll
      mockResult.storage.deleteAll = vi.fn().mockImplementation(async () => {
        operationOrder.push('cleanup')
        return originalDelete.call(mockResult.storage)
      })

      await mockResult.instance.move({ colo: 'ams' } as MoveOptions)

      const transferIndex = operationOrder.indexOf('transfer')
      const cleanupIndex = operationOrder.indexOf('cleanup')

      if (transferIndex !== -1 && cleanupIndex !== -1) {
        expect(transferIndex).toBeLessThan(cleanupIndex)
      }
    })

    it('should not clean up old DO if transfer fails', async () => {
      const initialThings = [...(mockResult.sqlData.get('things') as unknown[])]

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'new-do-id' },
        fetch: vi.fn().mockRejectedValue(new Error('Transfer failed')),
      })

      await expect(mockResult.instance.move({
        colo: 'fra',
      } as MoveOptions)).rejects.toThrow()

      // Original state should remain
      const currentThings = mockResult.sqlData.get('things') as unknown[]
      expect(currentThings.length).toBe(initialThings.length)
    })

    it('should emit move.failed on error', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'new-do-id' },
        fetch: vi.fn().mockRejectedValue(new Error('Network error')),
      })

      await expect(mockResult.instance.move({
        colo: 'lhr',
      } as MoveOptions)).rejects.toThrow()

      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).toContain('move.started')
      expect(eventVerbs).not.toContain('move.completed')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSISTENCY (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Consistency', () => {
    it('should preserve all state data during move', async () => {
      let transferredThings: unknown[] = []

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'new-do-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            const body = await req.json() as { things?: unknown[] }
            transferredThings = body.things || []
          }
          return new Response('OK')
        }),
      })

      const originalThings = mockResult.sqlData.get('things') as Array<{ id: string; name: string }>

      await mockResult.instance.move({ colo: 'mad' } as MoveOptions)

      // Verify all things were transferred with same data
      expect(transferredThings.length).toBe(originalThings.length)
    })

    it('should maintain type constraints', async () => {
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'typed-1', type: 7, data: { custom: true } }),
      ])

      let transferredData: { things?: Array<{ type: number }> } = {}

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'new-do-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            transferredData = await req.json()
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.move({ colo: 'mxp' } as MoveOptions)

      expect(transferredData.things?.[0]?.type).toBe(7)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ISOLATION (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Isolation', () => {
    it('should not affect source DO until transfer completes', async () => {
      const thingsBefore = [...(mockResult.sqlData.get('things') as unknown[])]

      // Slow transfer
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'new-do-id' },
        fetch: vi.fn().mockImplementation(async () => {
          // Source should still have data during transfer
          const thingsDuring = mockResult.sqlData.get('things') as unknown[]
          expect(thingsDuring.length).toBe(thingsBefore.length)
          return new Response('OK')
        }),
      })

      await mockResult.instance.move({ colo: 'zrh' } as MoveOptions)
    })

    it('should create independent DO at new location', async () => {
      const result = await mockResult.instance.move({ colo: 'vie' } as MoveOptions)

      expect(result.newDoId).not.toBe('test-do')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DURABILITY (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Durability', () => {
    it('should persist new location after move completes', async () => {
      const result = await mockResult.instance.move({ colo: 'arn' } as MoveOptions)

      expect(result.toColo).toBe('arn')
      expect(result.newDoId).toBeDefined()
    })

    it('should emit events before operation returns', async () => {
      await mockResult.instance.move({ colo: 'bom' } as MoveOptions)

      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>
      expect(events.some(e => e.verb === 'move.completed')).toBe(true)
    })

    it('should ensure new DO is accessible before returning', async () => {
      let newDOAccessed = false

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'new-do-id' },
        fetch: vi.fn().mockImplementation(async () => {
          newDOAccessed = true
          return new Response('OK')
        }),
      })

      await mockResult.instance.move({ colo: 'del' } as MoveOptions)

      expect(newDOAccessed).toBe(true)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // COLO VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Colo Code Validation', () => {
    it.each([
      'ewr', 'lax', 'cdg', 'sin', 'syd', // Major colos
      'wnam', 'enam', 'weur', 'apac', // Region hints
    ])('should accept valid colo code: %s', async (colo) => {
      // This test verifies that valid colos don't throw validation errors
      // The actual move may still fail for other reasons in the mock
      try {
        await mockResult.instance.move({ colo } as MoveOptions)
      } catch (err) {
        // Should not be a validation error
        expect((err as Error).message).not.toMatch(/Invalid colo/)
      }
    })

    it.each([
      'xyz', 'invalid', '123', 'test-colo', '',
    ])('should reject invalid colo code: %s', async (colo) => {
      await expect(mockResult.instance.move({
        colo,
      } as MoveOptions)).rejects.toThrow(/Invalid colo|empty/)
    })
  })
})

// ============================================================================
// FILE MOVE TESTS
// ============================================================================

describe('ACID Phase 1: move() - File Moves', () => {
  let mockResult: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    mockResult = createMockDO(DO, {
      id: 'test-do',
      ns: 'https://test.example.com',
    })

    // Set up initial filesystem state
    mockResult.sqlData.set('files', [
      createSampleFile({ path: '/documents/readme.txt', content: 'Hello' }),
      createSampleFile({ path: '/documents/data.json', content: '{}' }),
      createSampleFile({ path: '/temp/scratch.txt', content: 'temp data' }),
    ])

    mockResult.sqlData.set('file_history', [
      createSampleHistory({ path: '/documents/readme.txt', version: 1, content: 'Initial' }),
      createSampleHistory({ path: '/documents/readme.txt', version: 2, content: 'Updated' }),
      createSampleHistory({ path: '/documents/readme.txt', version: 3, content: 'Hello' }),
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BASIC FILE MOVES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Basic File Move Operations', () => {
    it('should move file from source to destination path', async () => {
      const result = await mockResult.instance.fs?.move(
        '/temp/scratch.txt',
        '/permanent/scratch.txt'
      )

      expect(result).toBeDefined()
      expect(result?.from).toBe('/temp/scratch.txt')
      expect(result?.to).toBe('/permanent/scratch.txt')
    })

    it('should remove file from source location after move', async () => {
      await mockResult.instance.fs?.move(
        '/temp/scratch.txt',
        '/permanent/scratch.txt'
      )

      const files = mockResult.sqlData.get('files') as Array<{ path: string }>
      const sourceExists = files.some(f => f.path === '/temp/scratch.txt')
      expect(sourceExists).toBe(false)
    })

    it('should create file at destination location after move', async () => {
      await mockResult.instance.fs?.move(
        '/temp/scratch.txt',
        '/permanent/scratch.txt'
      )

      const files = mockResult.sqlData.get('files') as Array<{ path: string }>
      const destExists = files.some(f => f.path === '/permanent/scratch.txt')
      expect(destExists).toBe(true)
    })

    it('should preserve file content during move', async () => {
      const originalContent = 'temp data'

      await mockResult.instance.fs?.move(
        '/temp/scratch.txt',
        '/permanent/scratch.txt'
      )

      const files = mockResult.sqlData.get('files') as Array<{ path: string; content: string }>
      const movedFile = files.find(f => f.path === '/permanent/scratch.txt')
      expect(movedFile?.content).toBe(originalContent)
    })

    it('should preserve file metadata during move', async () => {
      const originalFiles = mockResult.sqlData.get('files') as Array<{ path: string; ctime: Date }>
      const original = originalFiles.find(f => f.path === '/temp/scratch.txt')
      const originalCtime = original?.ctime

      await mockResult.instance.fs?.move(
        '/temp/scratch.txt',
        '/permanent/scratch.txt'
      )

      const files = mockResult.sqlData.get('files') as Array<{ path: string; ctime: Date }>
      const movedFile = files.find(f => f.path === '/permanent/scratch.txt')
      expect(movedFile?.ctime).toEqual(originalCtime)
    })

    it('should update mtime after move', async () => {
      const beforeMove = new Date()

      await mockResult.instance.fs?.move(
        '/temp/scratch.txt',
        '/permanent/scratch.txt'
      )

      const files = mockResult.sqlData.get('files') as Array<{ path: string; mtime: Date }>
      const movedFile = files.find(f => f.path === '/permanent/scratch.txt')
      expect(new Date(movedFile!.mtime).getTime()).toBeGreaterThanOrEqual(beforeMove.getTime())
    })

    it('should emit fs.move.started and fs.move.completed events', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      await mockResult.instance.fs?.move(
        '/temp/scratch.txt',
        '/permanent/scratch.txt'
      )

      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).toContain('fs.move.started')
      expect(eventVerbs).toContain('fs.move.completed')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // FILE MOVE VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('File Move Validation', () => {
    it('should throw if source file does not exist', async () => {
      await expect(mockResult.instance.fs?.move(
        '/nonexistent/file.txt',
        '/permanent/file.txt'
      )).rejects.toThrow(/not found|does not exist/i)
    })

    it('should throw if source path is empty', async () => {
      await expect(mockResult.instance.fs?.move(
        '',
        '/permanent/file.txt'
      )).rejects.toThrow(/invalid.*path|empty/i)
    })

    it('should throw if destination path is empty', async () => {
      await expect(mockResult.instance.fs?.move(
        '/temp/scratch.txt',
        ''
      )).rejects.toThrow(/invalid.*path|empty/i)
    })

    it('should throw if source and destination are same', async () => {
      await expect(mockResult.instance.fs?.move(
        '/temp/scratch.txt',
        '/temp/scratch.txt'
      )).rejects.toThrow(/same path|source.*destination/i)
    })

    it('should throw if trying to move to existing file without overwrite', async () => {
      // Add destination file
      const files = mockResult.sqlData.get('files') as Array<{ path: string; content: string }>
      files.push(createSampleFile({ path: '/permanent/scratch.txt', content: 'existing' }))

      await expect(mockResult.instance.fs?.move(
        '/temp/scratch.txt',
        '/permanent/scratch.txt'
      )).rejects.toThrow(/already exists|overwrite/i)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // FILE MOVE WITH OVERWRITE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('File Move with Overwrite', () => {
    beforeEach(() => {
      // Add destination file that will be overwritten
      const files = mockResult.sqlData.get('files') as Array<{ path: string; content: string }>
      files.push(createSampleFile({ path: '/permanent/scratch.txt', content: 'existing' }))
    })

    it('should overwrite existing file when overwrite option is true', async () => {
      await mockResult.instance.fs?.move(
        '/temp/scratch.txt',
        '/permanent/scratch.txt',
        { overwrite: true }
      )

      const files = mockResult.sqlData.get('files') as Array<{ path: string; content: string }>
      const destFile = files.find(f => f.path === '/permanent/scratch.txt')
      expect(destFile?.content).toBe('temp data') // Source content, not 'existing'
    })

    it('should preserve overwritten file in history when overwrite is true', async () => {
      await mockResult.instance.fs?.move(
        '/temp/scratch.txt',
        '/permanent/scratch.txt',
        { overwrite: true }
      )

      const history = mockResult.sqlData.get('file_history') as Array<{ path: string; content: string }>
      const destHistory = history.filter(h => h.path === '/permanent/scratch.txt')

      // Should have at least one history entry for the overwritten content
      expect(destHistory.length).toBeGreaterThan(0)
    })

    it('should remove only one file when overwriting', async () => {
      const filesBefore = mockResult.sqlData.get('files') as Array<{ path: string }>
      const countBefore = filesBefore.length

      await mockResult.instance.fs?.move(
        '/temp/scratch.txt',
        '/permanent/scratch.txt',
        { overwrite: true }
      )

      // Should have one less file (source removed, destination replaced)
      const filesAfter = mockResult.sqlData.get('files') as Array<{ path: string }>
      expect(filesAfter.length).toBe(countBefore - 1)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // FILE MOVE ATOMICITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('File Move Atomicity', () => {
    it('should not remove source if destination write fails', async () => {
      // Simulate destination write failure
      const originalExec = mockResult.storage.sql.exec
      let writeAttempted = false
      mockResult.storage.sql.exec = vi.fn().mockImplementation((query: string) => {
        if (query.toLowerCase().includes('insert') && query.toLowerCase().includes('permanent')) {
          writeAttempted = true
          throw new Error('Write failed')
        }
        return originalExec.call(mockResult.storage.sql, query)
      })

      await expect(mockResult.instance.fs?.move(
        '/temp/scratch.txt',
        '/permanent/scratch.txt'
      )).rejects.toThrow()

      // Source should still exist
      const files = mockResult.sqlData.get('files') as Array<{ path: string }>
      expect(files.some(f => f.path === '/temp/scratch.txt')).toBe(true)
    })

    it('should complete both operations in a single transaction', async () => {
      const transactionCalls: string[] = []

      // Track SQL operations
      const originalExec = mockResult.storage.sql.exec
      mockResult.storage.sql.exec = vi.fn().mockImplementation((query: string, ...params: unknown[]) => {
        transactionCalls.push(query.split(' ')[0]!.toUpperCase())
        return originalExec.call(mockResult.storage.sql, query, ...params)
      })

      await mockResult.instance.fs?.move(
        '/temp/scratch.txt',
        '/permanent/scratch.txt'
      )

      // Should see both INSERT and DELETE in the transaction
      expect(transactionCalls).toContain('INSERT')
      expect(transactionCalls).toContain('DELETE')
    })

    it('should emit fs.move.failed on error', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      // Force an error
      mockResult.storage.sql.exec = vi.fn().mockImplementation(() => {
        throw new Error('Database error')
      })

      await expect(mockResult.instance.fs?.move(
        '/temp/scratch.txt',
        '/permanent/scratch.txt'
      )).rejects.toThrow()

      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).toContain('fs.move.started')
      // Either fs.move.failed or no fs.move.completed
      expect(eventVerbs).not.toContain('fs.move.completed')
    })
  })
})

// ============================================================================
// DIRECTORY MOVE TESTS
// ============================================================================

describe('ACID Phase 1: move() - Directory Moves', () => {
  let mockResult: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    mockResult = createMockDO(DO, {
      id: 'test-do',
      ns: 'https://test.example.com',
    })

    // Set up directory structure
    mockResult.sqlData.set('files', [
      createSampleFile({ path: '/source', isDirectory: true }),
      createSampleFile({ path: '/source/file1.txt', content: 'File 1' }),
      createSampleFile({ path: '/source/file2.txt', content: 'File 2' }),
      createSampleFile({ path: '/source/nested', isDirectory: true }),
      createSampleFile({ path: '/source/nested/deep.txt', content: 'Deep' }),
      createSampleFile({ path: '/other', isDirectory: true }),
      createSampleFile({ path: '/other/file.txt', content: 'Other' }),
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BASIC DIRECTORY MOVES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Basic Directory Move Operations', () => {
    it('should move directory to new location', async () => {
      const result = await mockResult.instance.fs?.move(
        '/source',
        '/destination'
      )

      expect(result).toBeDefined()
      expect(result?.isDirectory).toBe(true)
    })

    it('should move all files within directory', async () => {
      await mockResult.instance.fs?.move(
        '/source',
        '/destination'
      )

      const files = mockResult.sqlData.get('files') as Array<{ path: string }>
      expect(files.some(f => f.path === '/destination/file1.txt')).toBe(true)
      expect(files.some(f => f.path === '/destination/file2.txt')).toBe(true)
    })

    it('should move nested directories recursively', async () => {
      await mockResult.instance.fs?.move(
        '/source',
        '/destination'
      )

      const files = mockResult.sqlData.get('files') as Array<{ path: string }>
      expect(files.some(f => f.path === '/destination/nested')).toBe(true)
      expect(files.some(f => f.path === '/destination/nested/deep.txt')).toBe(true)
    })

    it('should remove original directory and contents after move', async () => {
      await mockResult.instance.fs?.move(
        '/source',
        '/destination'
      )

      const files = mockResult.sqlData.get('files') as Array<{ path: string }>
      expect(files.some(f => f.path.startsWith('/source'))).toBe(false)
    })

    it('should not affect files outside the moved directory', async () => {
      await mockResult.instance.fs?.move(
        '/source',
        '/destination'
      )

      const files = mockResult.sqlData.get('files') as Array<{ path: string }>
      expect(files.some(f => f.path === '/other/file.txt')).toBe(true)
    })

    it('should return count of moved items', async () => {
      const result = await mockResult.instance.fs?.move(
        '/source',
        '/destination'
      )

      // 1 directory + 2 files + 1 nested dir + 1 deep file = 5 items
      expect(result?.itemCount).toBe(5)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DIRECTORY MOVE VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Directory Move Validation', () => {
    it('should throw if source directory does not exist', async () => {
      await expect(mockResult.instance.fs?.move(
        '/nonexistent',
        '/destination'
      )).rejects.toThrow(/not found|does not exist/i)
    })

    it('should throw if trying to move into itself', async () => {
      await expect(mockResult.instance.fs?.move(
        '/source',
        '/source/subfolder'
      )).rejects.toThrow(/cannot.*into itself|circular/i)
    })

    it('should throw if destination exists and is a file', async () => {
      // Add a file at destination
      const files = mockResult.sqlData.get('files') as Array<{ path: string; isDirectory: boolean }>
      files.push(createSampleFile({ path: '/destination', isDirectory: false }))

      await expect(mockResult.instance.fs?.move(
        '/source',
        '/destination'
      )).rejects.toThrow(/destination.*file|not a directory/i)
    })

    it('should throw if destination directory exists and not empty without overwrite', async () => {
      // Add destination with content
      const files = mockResult.sqlData.get('files') as Array<{ path: string; isDirectory: boolean }>
      files.push(createSampleFile({ path: '/destination', isDirectory: true }))
      files.push(createSampleFile({ path: '/destination/existing.txt', content: 'exists' }))

      await expect(mockResult.instance.fs?.move(
        '/source',
        '/destination'
      )).rejects.toThrow(/not empty|already exists/i)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DIRECTORY MOVE WITH OVERWRITE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Directory Move with Overwrite', () => {
    beforeEach(() => {
      // Add destination with conflicting content
      const files = mockResult.sqlData.get('files') as Array<{ path: string; isDirectory: boolean; content: string }>
      files.push(createSampleFile({ path: '/destination', isDirectory: true }))
      files.push(createSampleFile({ path: '/destination/file1.txt', content: 'original dest' }))
      files.push(createSampleFile({ path: '/destination/extra.txt', content: 'extra' }))
    })

    it('should merge directories when overwrite is true', async () => {
      await mockResult.instance.fs?.move(
        '/source',
        '/destination',
        { overwrite: true }
      )

      const files = mockResult.sqlData.get('files') as Array<{ path: string }>
      // Source file1.txt should have overwritten destination file1.txt
      // Source file2.txt should be added
      // Destination extra.txt should be preserved or handled per merge strategy
      expect(files.some(f => f.path === '/destination/file1.txt')).toBe(true)
      expect(files.some(f => f.path === '/destination/file2.txt')).toBe(true)
    })

    it('should overwrite conflicting files when overwrite is true', async () => {
      await mockResult.instance.fs?.move(
        '/source',
        '/destination',
        { overwrite: true }
      )

      const files = mockResult.sqlData.get('files') as Array<{ path: string; content: string }>
      const file1 = files.find(f => f.path === '/destination/file1.txt')
      expect(file1?.content).toBe('File 1') // Source content, not 'original dest'
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DIRECTORY MOVE ATOMICITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Directory Move Atomicity', () => {
    it('should move all files atomically or none', async () => {
      const originalFiles = [...(mockResult.sqlData.get('files') as unknown[])]

      // Fail partway through
      let moveCount = 0
      const originalExec = mockResult.storage.sql.exec
      mockResult.storage.sql.exec = vi.fn().mockImplementation((query: string, ...params: unknown[]) => {
        if (query.toLowerCase().includes('insert')) {
          moveCount++
          if (moveCount >= 3) {
            throw new Error('Simulated failure mid-move')
          }
        }
        return originalExec.call(mockResult.storage.sql, query, ...params)
      })

      await expect(mockResult.instance.fs?.move(
        '/source',
        '/destination'
      )).rejects.toThrow()

      // All original files should still exist (rollback)
      const currentFiles = mockResult.sqlData.get('files') as unknown[]
      expect(currentFiles.length).toBe(originalFiles.length)
    })

    it('should not leave partial state on failure', async () => {
      // Fail during cleanup of source
      const originalExec = mockResult.storage.sql.exec
      mockResult.storage.sql.exec = vi.fn().mockImplementation((query: string, ...params: unknown[]) => {
        if (query.toLowerCase().includes('delete') && query.toLowerCase().includes('source')) {
          throw new Error('Delete failed')
        }
        return originalExec.call(mockResult.storage.sql, query, ...params)
      })

      await expect(mockResult.instance.fs?.move(
        '/source',
        '/destination'
      )).rejects.toThrow()

      // Should not have destination files if source couldn't be deleted
      const files = mockResult.sqlData.get('files') as Array<{ path: string }>
      const hasDestination = files.some(f => f.path.startsWith('/destination'))
      const hasSource = files.some(f => f.path.startsWith('/source'))

      // Either both or neither - no partial state
      expect(hasDestination && !hasSource).toBe(false)
    })
  })
})

// ============================================================================
// MOVE WITH HISTORY PRESERVATION TESTS
// ============================================================================

describe('ACID Phase 1: move() - History Preservation', () => {
  let mockResult: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    mockResult = createMockDO(DO, {
      id: 'test-do',
      ns: 'https://test.example.com',
    })

    // Set up files with version history
    mockResult.sqlData.set('files', [
      createSampleFile({ path: '/docs/important.txt', content: 'Current version', version: 5 }),
    ])

    mockResult.sqlData.set('file_history', [
      createSampleHistory({ path: '/docs/important.txt', version: 1, content: 'v1', timestamp: new Date('2024-01-01') }),
      createSampleHistory({ path: '/docs/important.txt', version: 2, content: 'v2', timestamp: new Date('2024-02-01') }),
      createSampleHistory({ path: '/docs/important.txt', version: 3, content: 'v3', timestamp: new Date('2024-03-01') }),
      createSampleHistory({ path: '/docs/important.txt', version: 4, content: 'v4', timestamp: new Date('2024-04-01') }),
      createSampleHistory({ path: '/docs/important.txt', version: 5, content: 'Current version', timestamp: new Date('2024-05-01') }),
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // HISTORY PRESERVATION OPTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('History Preservation Options', () => {
    it('should preserve all history when preserveHistory is true', async () => {
      await mockResult.instance.fs?.move(
        '/docs/important.txt',
        '/archive/important.txt',
        { preserveHistory: true }
      )

      const history = mockResult.sqlData.get('file_history') as Array<{ path: string }>
      const newPathHistory = history.filter(h => h.path === '/archive/important.txt')
      expect(newPathHistory.length).toBe(5)
    })

    it('should discard history when preserveHistory is false', async () => {
      await mockResult.instance.fs?.move(
        '/docs/important.txt',
        '/archive/important.txt',
        { preserveHistory: false }
      )

      const history = mockResult.sqlData.get('file_history') as Array<{ path: string }>
      const newPathHistory = history.filter(h => h.path === '/archive/important.txt')

      // Only the current version should be in history (or none)
      expect(newPathHistory.length).toBeLessThanOrEqual(1)
    })

    it('should default to preserving history', async () => {
      await mockResult.instance.fs?.move(
        '/docs/important.txt',
        '/archive/important.txt'
      )

      const history = mockResult.sqlData.get('file_history') as Array<{ path: string }>
      const newPathHistory = history.filter(h => h.path === '/archive/important.txt')
      expect(newPathHistory.length).toBe(5)
    })

    it('should update history paths to new location', async () => {
      await mockResult.instance.fs?.move(
        '/docs/important.txt',
        '/archive/important.txt',
        { preserveHistory: true }
      )

      const history = mockResult.sqlData.get('file_history') as Array<{ path: string }>
      const oldPathHistory = history.filter(h => h.path === '/docs/important.txt')
      expect(oldPathHistory.length).toBe(0) // No history at old path
    })

    it('should preserve version ordering in history', async () => {
      await mockResult.instance.fs?.move(
        '/docs/important.txt',
        '/archive/important.txt',
        { preserveHistory: true }
      )

      const history = mockResult.sqlData.get('file_history') as Array<{ path: string; version: number }>
      const newPathHistory = history
        .filter(h => h.path === '/archive/important.txt')
        .sort((a, b) => a.version - b.version)

      for (let i = 0; i < newPathHistory.length; i++) {
        expect(newPathHistory[i]!.version).toBe(i + 1)
      }
    })

    it('should preserve timestamps in history', async () => {
      const originalHistory = mockResult.sqlData.get('file_history') as Array<{ path: string; timestamp: Date }>
      const originalTimestamps = originalHistory
        .filter(h => h.path === '/docs/important.txt')
        .map(h => new Date(h.timestamp).getTime())

      await mockResult.instance.fs?.move(
        '/docs/important.txt',
        '/archive/important.txt',
        { preserveHistory: true }
      )

      const history = mockResult.sqlData.get('file_history') as Array<{ path: string; timestamp: Date }>
      const newTimestamps = history
        .filter(h => h.path === '/archive/important.txt')
        .map(h => new Date(h.timestamp).getTime())

      expect(newTimestamps).toEqual(originalTimestamps)
    })

    it('should return historyPreserved count in result', async () => {
      const result = await mockResult.instance.fs?.move(
        '/docs/important.txt',
        '/archive/important.txt',
        { preserveHistory: true }
      )

      expect(result?.historyPreserved).toBe(5)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DIRECTORY HISTORY PRESERVATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Directory History Preservation', () => {
    beforeEach(() => {
      // Add more files with history
      const files = mockResult.sqlData.get('files') as unknown[]
      files.push(createSampleFile({ path: '/docs', isDirectory: true }))
      files.push(createSampleFile({ path: '/docs/other.txt', content: 'Other', version: 3 }))

      const history = mockResult.sqlData.get('file_history') as unknown[]
      history.push(createSampleHistory({ path: '/docs/other.txt', version: 1, content: 'o1' }))
      history.push(createSampleHistory({ path: '/docs/other.txt', version: 2, content: 'o2' }))
      history.push(createSampleHistory({ path: '/docs/other.txt', version: 3, content: 'Other' }))
    })

    it('should preserve history for all files in directory', async () => {
      await mockResult.instance.fs?.move(
        '/docs',
        '/archive',
        { preserveHistory: true }
      )

      const history = mockResult.sqlData.get('file_history') as Array<{ path: string }>
      const archiveHistory = history.filter(h => h.path.startsWith('/archive'))

      // important.txt: 5 versions + other.txt: 3 versions = 8 total
      expect(archiveHistory.length).toBe(8)
    })

    it('should update all history paths for nested files', async () => {
      await mockResult.instance.fs?.move(
        '/docs',
        '/archive',
        { preserveHistory: true }
      )

      const history = mockResult.sqlData.get('file_history') as Array<{ path: string }>
      const oldDocsHistory = history.filter(h => h.path.startsWith('/docs'))
      expect(oldDocsHistory.length).toBe(0)
    })
  })
})

// ============================================================================
// CONFLICT HANDLING TESTS
// ============================================================================

describe('ACID Phase 1: move() - Conflict Handling', () => {
  let mockResult: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    mockResult = createMockDO(DO, {
      id: 'test-do',
      ns: 'https://test.example.com',
    })

    // Set up source and destination with potential conflicts
    mockResult.sqlData.set('files', [
      createSampleFile({ path: '/source/file.txt', content: 'Source content', version: 3 }),
      createSampleFile({ path: '/dest/file.txt', content: 'Dest content', version: 5 }),
    ])

    mockResult.sqlData.set('file_history', [
      createSampleHistory({ path: '/source/file.txt', version: 1, content: 's1' }),
      createSampleHistory({ path: '/source/file.txt', version: 2, content: 's2' }),
      createSampleHistory({ path: '/source/file.txt', version: 3, content: 'Source content' }),
      createSampleHistory({ path: '/dest/file.txt', version: 1, content: 'd1' }),
      createSampleHistory({ path: '/dest/file.txt', version: 2, content: 'd2' }),
      createSampleHistory({ path: '/dest/file.txt', version: 3, content: 'd3' }),
      createSampleHistory({ path: '/dest/file.txt', version: 4, content: 'd4' }),
      createSampleHistory({ path: '/dest/file.txt', version: 5, content: 'Dest content' }),
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BASIC CONFLICT DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Conflict Detection', () => {
    it('should detect name conflict when destination exists', async () => {
      await expect(mockResult.instance.fs?.move(
        '/source/file.txt',
        '/dest/file.txt'
      )).rejects.toThrow(/already exists|conflict/i)
    })

    it('should not conflict when destination does not exist', async () => {
      const result = await mockResult.instance.fs?.move(
        '/source/file.txt',
        '/dest/newfile.txt'
      )

      expect(result).toBeDefined()
    })

    it('should detect conflict even with different case (case-insensitive)', async () => {
      // Add case-variant file
      const files = mockResult.sqlData.get('files') as unknown[]
      files.push(createSampleFile({ path: '/dest/FILE.txt', content: 'Upper case' }))

      await expect(mockResult.instance.fs?.move(
        '/source/file.txt',
        '/dest/File.txt'
      )).rejects.toThrow(/already exists|conflict|case/i)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFLICT RESOLUTION STRATEGIES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Conflict Resolution Strategies', () => {
    it('should replace destination when overwrite is true', async () => {
      await mockResult.instance.fs?.move(
        '/source/file.txt',
        '/dest/file.txt',
        { overwrite: true }
      )

      const files = mockResult.sqlData.get('files') as Array<{ path: string; content: string }>
      const destFile = files.find(f => f.path === '/dest/file.txt')
      expect(destFile?.content).toBe('Source content')
    })

    it('should merge histories when overwriting with preserveHistory', async () => {
      await mockResult.instance.fs?.move(
        '/source/file.txt',
        '/dest/file.txt',
        { overwrite: true, preserveHistory: true }
      )

      const history = mockResult.sqlData.get('file_history') as Array<{ path: string }>
      const destHistory = history.filter(h => h.path === '/dest/file.txt')

      // Should have both source and destination history
      // 3 from source + 5 from dest = 8, or just source's 3 depending on strategy
      expect(destHistory.length).toBeGreaterThanOrEqual(3)
    })

    it('should preserve destination history before overwrite', async () => {
      await mockResult.instance.fs?.move(
        '/source/file.txt',
        '/dest/file.txt',
        { overwrite: true }
      )

      const history = mockResult.sqlData.get('file_history') as Array<{ path: string; content: string }>
      const destHistory = history.filter(h => h.path === '/dest/file.txt')

      // Original destination content should be preserved in history
      expect(destHistory.some(h => h.content === 'Dest content')).toBe(true)
    })

    it('should increment version when overwriting existing file', async () => {
      const originalDest = (mockResult.sqlData.get('files') as Array<{ path: string; version: number }>)
        .find(f => f.path === '/dest/file.txt')
      const originalVersion = originalDest?.version ?? 0

      await mockResult.instance.fs?.move(
        '/source/file.txt',
        '/dest/file.txt',
        { overwrite: true }
      )

      const files = mockResult.sqlData.get('files') as Array<{ path: string; version: number }>
      const destFile = files.find(f => f.path === '/dest/file.txt')
      expect(destFile?.version).toBeGreaterThan(originalVersion)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DIRECTORY CONFLICTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Directory Conflict Handling', () => {
    beforeEach(() => {
      // Set up directory structures with conflicts
      const files = mockResult.sqlData.get('files') as unknown[]
      files.push(createSampleFile({ path: '/src', isDirectory: true }))
      files.push(createSampleFile({ path: '/src/a.txt', content: 'src-a' }))
      files.push(createSampleFile({ path: '/src/b.txt', content: 'src-b' }))
      files.push(createSampleFile({ path: '/target', isDirectory: true }))
      files.push(createSampleFile({ path: '/target/b.txt', content: 'target-b' }))
      files.push(createSampleFile({ path: '/target/c.txt', content: 'target-c' }))
    })

    it('should detect file conflicts within directories', async () => {
      await expect(mockResult.instance.fs?.move(
        '/src',
        '/target'
      )).rejects.toThrow(/conflict|already exists/i)
    })

    it('should merge directories when overwrite is true', async () => {
      await mockResult.instance.fs?.move(
        '/src',
        '/target',
        { overwrite: true }
      )

      const files = mockResult.sqlData.get('files') as Array<{ path: string }>

      // All files should be at target
      expect(files.some(f => f.path === '/target/a.txt')).toBe(true)
      expect(files.some(f => f.path === '/target/b.txt')).toBe(true)
      expect(files.some(f => f.path === '/target/c.txt')).toBe(true)
    })

    it('should overwrite conflicting files during directory merge', async () => {
      await mockResult.instance.fs?.move(
        '/src',
        '/target',
        { overwrite: true }
      )

      const files = mockResult.sqlData.get('files') as Array<{ path: string; content: string }>
      const bFile = files.find(f => f.path === '/target/b.txt')
      expect(bFile?.content).toBe('src-b') // Source content
    })

    it('should preserve non-conflicting destination files during merge', async () => {
      await mockResult.instance.fs?.move(
        '/src',
        '/target',
        { overwrite: true }
      )

      const files = mockResult.sqlData.get('files') as Array<{ path: string; content: string }>
      const cFile = files.find(f => f.path === '/target/c.txt')
      expect(cFile?.content).toBe('target-c')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CONCURRENT MODIFICATION CONFLICTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Concurrent Modification Conflicts', () => {
    it('should detect if source was modified during move', async () => {
      // Simulate concurrent modification
      let moveStarted = false
      const originalExec = mockResult.storage.sql.exec
      mockResult.storage.sql.exec = vi.fn().mockImplementation((query: string, ...params: unknown[]) => {
        if (query.toLowerCase().includes('insert') && !moveStarted) {
          moveStarted = true
          // Modify source file concurrently
          const files = mockResult.sqlData.get('files') as Array<{ path: string; content: string; version: number }>
          const sourceFile = files.find(f => f.path === '/source/file.txt')
          if (sourceFile) {
            sourceFile.content = 'Modified during move!'
            sourceFile.version = 999
          }
        }
        return originalExec.call(mockResult.storage.sql, query, ...params)
      })

      // The move should detect this and either fail or handle it
      try {
        await mockResult.instance.fs?.move(
          '/source/file.txt',
          '/dest/newfile.txt'
        )
        // If it doesn't throw, the new content should be moved
        const files = mockResult.sqlData.get('files') as Array<{ path: string; content: string }>
        const newFile = files.find(f => f.path === '/dest/newfile.txt')
        // Either the original or modified content, but consistent
        expect(newFile?.content).toBeDefined()
      } catch (error) {
        // Acceptable to throw on concurrent modification
        expect((error as Error).message).toMatch(/concurrent|modified|conflict/i)
      }
    })

    it('should handle destination appearing during move', async () => {
      // Simulate destination being created by another process
      let insertCount = 0
      const originalExec = mockResult.storage.sql.exec
      mockResult.storage.sql.exec = vi.fn().mockImplementation((query: string, ...params: unknown[]) => {
        if (query.toLowerCase().includes('insert')) {
          insertCount++
          if (insertCount === 1) {
            // Someone else creates the destination first
            const files = mockResult.sqlData.get('files') as unknown[]
            files.push(createSampleFile({ path: '/dest/newfile.txt', content: 'Race condition!' }))
          }
        }
        return originalExec.call(mockResult.storage.sql, query, ...params)
      })

      // Should either fail or handle the race
      try {
        await mockResult.instance.fs?.move(
          '/source/file.txt',
          '/dest/newfile.txt'
        )
      } catch (error) {
        expect((error as Error).message).toMatch(/already exists|conflict|race/i)
      }
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFLICT RECOVERY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Conflict Recovery', () => {
    it('should not corrupt data on conflict', async () => {
      const filesBefore = [...(mockResult.sqlData.get('files') as unknown[])]

      try {
        await mockResult.instance.fs?.move(
          '/source/file.txt',
          '/dest/file.txt'
        )
      } catch {
        // Expected to throw
      }

      // Both files should still exist with original content
      const files = mockResult.sqlData.get('files') as Array<{ path: string; content: string }>
      const sourceFile = files.find(f => f.path === '/source/file.txt')
      const destFile = files.find(f => f.path === '/dest/file.txt')

      expect(sourceFile?.content).toBe('Source content')
      expect(destFile?.content).toBe('Dest content')
    })

    it('should not leave partial moves on conflict', async () => {
      // Force conflict after partial work
      const originalExec = mockResult.storage.sql.exec
      let shouldFail = false
      mockResult.storage.sql.exec = vi.fn().mockImplementation((query: string, ...params: unknown[]) => {
        if (query.toLowerCase().includes('delete') && shouldFail) {
          throw new Error('Conflict during cleanup')
        }
        if (query.toLowerCase().includes('insert')) {
          shouldFail = true
        }
        return originalExec.call(mockResult.storage.sql, query, ...params)
      })

      try {
        await mockResult.instance.fs?.move(
          '/source/file.txt',
          '/dest/newfile.txt'
        )
      } catch {
        // Expected
      }

      // Should not have file at both locations
      const files = mockResult.sqlData.get('files') as Array<{ path: string }>
      const sourceExists = files.some(f => f.path === '/source/file.txt')
      const destExists = files.some(f => f.path === '/dest/newfile.txt')

      // Either both exist (rollback) or only dest exists (commit)
      // Should not have source deleted without dest created
      expect(sourceExists || destExists).toBe(true)
    })
  })
})
