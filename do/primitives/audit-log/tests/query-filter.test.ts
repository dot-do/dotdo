/**
 * RED Phase: Audit Log Query/Filter Tests
 *
 * Tests for querying and filtering audit log entries. These tests define the expected
 * behavior of the AuditLogQuery engine for compliance and audit trail retrieval.
 *
 * All tests should FAIL until implementation is complete.
 *
 * @see dotdo-xxsw0 - [RED] Query/filter tests
 * @see dotdo-9xw2u - [PRIMITIVE] AuditLog - Immutable compliance and audit trail
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import {
  AuditLogQuery,
  createAuditLogQuery,
  type AuditQueryFilter,
  type AuditQueryOptions,
  type AuditQueryResult,
  type CursorPaginationOptions,
  type OffsetPaginationOptions,
  type AuditQueryProjection,
  type AuditQuerySort,
} from '../query'
import type { AuditEntry, Actor, Action, Resource, StandardAction } from './audit-entry'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createQuery(options?: AuditQueryOptions): AuditLogQuery {
  return createAuditLogQuery(options)
}

function createMockEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  const now = new Date().toISOString()
  return {
    id: `entry-${Math.random().toString(36).slice(2)}`,
    actor: { userId: 'user-123' },
    action: { type: 'read' },
    resource: { type: 'Document', id: 'doc-1' },
    timestamp: {
      iso: now,
      epochMs: Date.now(),
    },
    createdAt: now,
    schemaVersion: 1,
    ...overrides,
  }
}

async function seedEntries(query: AuditLogQuery, count: number, factory?: (index: number) => Partial<AuditEntry>): Promise<AuditEntry[]> {
  const entries: AuditEntry[] = []
  for (let i = 0; i < count; i++) {
    const overrides = factory ? factory(i) : {}
    const entry = createMockEntry(overrides)
    await query.insert(entry)
    entries.push(entry)
  }
  return entries
}

// ============================================================================
// QUERY BY ACTOR
// ============================================================================

describe('AuditLogQuery', () => {
  let query: AuditLogQuery

  beforeEach(() => {
    query = createQuery()
  })

  describe('query by actor', () => {
    it('should query by userId', async () => {
      await seedEntries(query, 5, (i) => ({
        actor: { userId: i < 3 ? 'user-alice' : 'user-bob' },
      }))

      const result = await query.find({
        actor: { userId: 'user-alice' },
      })

      expect(result.entries).toHaveLength(3)
      expect(result.entries.every((e) => e.actor.userId === 'user-alice')).toBe(true)
    })

    it('should query by serviceId', async () => {
      await seedEntries(query, 5, (i) => ({
        actor: i < 2 ? { serviceId: 'api-gateway' } : { userId: 'user-123' },
      }))

      const result = await query.find({
        actor: { serviceId: 'api-gateway' },
      })

      expect(result.entries).toHaveLength(2)
      expect(result.entries.every((e) => e.actor.serviceId === 'api-gateway')).toBe(true)
    })

    it('should query by system actor', async () => {
      await seedEntries(query, 5, (i) => ({
        actor: i === 0 ? { system: true } : { userId: `user-${i}` },
      }))

      const result = await query.find({
        actor: { system: true },
      })

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0]!.actor.system).toBe(true)
    })

    it('should query by multiple actor fields (OR within actor)', async () => {
      await seedEntries(query, 6, (i) => ({
        actor: i < 2 ? { userId: 'user-alice' } : i < 4 ? { serviceId: 'batch-job' } : { userId: 'user-charlie' },
      }))

      const result = await query.find({
        actor: {
          $or: [{ userId: 'user-alice' }, { serviceId: 'batch-job' }],
        },
      })

      expect(result.entries).toHaveLength(4)
    })

    it('should query by actor displayName', async () => {
      await seedEntries(query, 3, (i) => ({
        actor: { userId: `user-${i}`, displayName: i === 1 ? 'Alice Smith' : 'Other User' },
      }))

      const result = await query.find({
        actor: { displayName: 'Alice Smith' },
      })

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0]!.actor.displayName).toBe('Alice Smith')
    })

    it('should query by actor ipAddress', async () => {
      await seedEntries(query, 4, (i) => ({
        actor: { userId: `user-${i}`, ipAddress: i % 2 === 0 ? '192.168.1.100' : '10.0.0.50' },
      }))

      const result = await query.find({
        actor: { ipAddress: '192.168.1.100' },
      })

      expect(result.entries).toHaveLength(2)
    })
  })

  // ============================================================================
  // QUERY BY ACTION
  // ============================================================================

  describe('query by action', () => {
    it('should query by create action', async () => {
      await seedEntries(query, 6, (i) => ({
        action: { type: (['create', 'read', 'update', 'delete', 'create', 'read'] as const)[i] },
      }))

      const result = await query.find({
        action: { type: 'create' },
      })

      expect(result.entries).toHaveLength(2)
      expect(result.entries.every((e) => e.action.type === 'create')).toBe(true)
    })

    it('should query by read action', async () => {
      await seedEntries(query, 5, (i) => ({
        action: { type: i < 3 ? 'read' : 'update' },
      }))

      const result = await query.find({
        action: { type: 'read' },
      })

      expect(result.entries).toHaveLength(3)
    })

    it('should query by update action', async () => {
      await seedEntries(query, 4, (i) => ({
        action: { type: i === 2 ? 'update' : 'read' },
      }))

      const result = await query.find({
        action: { type: 'update' },
      })

      expect(result.entries).toHaveLength(1)
    })

    it('should query by delete action', async () => {
      await seedEntries(query, 5, (i) => ({
        action: { type: i >= 3 ? 'delete' : 'create' },
      }))

      const result = await query.find({
        action: { type: 'delete' },
      })

      expect(result.entries).toHaveLength(2)
    })

    it('should query by multiple action types (IN)', async () => {
      await seedEntries(query, 8, (i) => ({
        action: { type: (['create', 'read', 'update', 'delete', 'create', 'read', 'archive', 'restore'] as const)[i] as string },
      }))

      const result = await query.find({
        action: { type: { $in: ['create', 'delete'] } },
      })

      expect(result.entries).toHaveLength(3)
    })

    it('should query by custom action', async () => {
      await seedEntries(query, 4, (i) => ({
        action: { type: i === 1 ? 'custom:approve' : 'read', isCustom: i === 1 },
      }))

      const result = await query.find({
        action: { type: 'custom:approve' },
      })

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0]!.action.isCustom).toBe(true)
    })

    it('should query by action namespace', async () => {
      await seedEntries(query, 5, (i) => ({
        action: {
          type: i < 2 ? 'workflow:start' : 'crud:read',
          namespace: i < 2 ? 'workflow' : 'crud',
        },
      }))

      const result = await query.find({
        action: { namespace: 'workflow' },
      })

      expect(result.entries).toHaveLength(2)
    })
  })

  // ============================================================================
  // QUERY BY RESOURCE TYPE
  // ============================================================================

  describe('query by resource type', () => {
    it('should query by resource type', async () => {
      await seedEntries(query, 6, (i) => ({
        resource: { type: i < 3 ? 'User' : 'Order', id: `id-${i}` },
      }))

      const result = await query.find({
        resource: { type: 'User' },
      })

      expect(result.entries).toHaveLength(3)
      expect(result.entries.every((e) => e.resource.type === 'User')).toBe(true)
    })

    it('should query by multiple resource types', async () => {
      await seedEntries(query, 6, (i) => ({
        resource: { type: ['User', 'Order', 'Product'][i % 3]!, id: `id-${i}` },
      }))

      const result = await query.find({
        resource: { type: { $in: ['User', 'Order'] } },
      })

      expect(result.entries).toHaveLength(4)
    })

    it('should query by resource type with wildcard', async () => {
      await seedEntries(query, 5, (i) => ({
        resource: { type: ['UserProfile', 'UserSettings', 'Order', 'UserRole', 'Product'][i]!, id: `id-${i}` },
      }))

      const result = await query.find({
        resource: { type: { $regex: '^User' } },
      })

      expect(result.entries).toHaveLength(3)
    })
  })

  // ============================================================================
  // QUERY BY RESOURCE ID
  // ============================================================================

  describe('query by resource ID', () => {
    it('should query by exact resource ID', async () => {
      await seedEntries(query, 5, (i) => ({
        resource: { type: 'Document', id: `doc-${i}` },
      }))

      const result = await query.find({
        resource: { id: 'doc-2' },
      })

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0]!.resource.id).toBe('doc-2')
    })

    it('should query by multiple resource IDs', async () => {
      await seedEntries(query, 5, (i) => ({
        resource: { type: 'Document', id: `doc-${i}` },
      }))

      const result = await query.find({
        resource: { id: { $in: ['doc-1', 'doc-3'] } },
      })

      expect(result.entries).toHaveLength(2)
    })

    it('should query by resource type AND ID', async () => {
      await seedEntries(query, 6, (i) => ({
        resource: { type: i % 2 === 0 ? 'Document' : 'Folder', id: `item-${i % 3}` },
      }))

      const result = await query.find({
        resource: { type: 'Document', id: 'item-0' },
      })

      expect(result.entries).toHaveLength(1)
    })

    it('should query by resource path', async () => {
      await seedEntries(query, 4, (i) => ({
        resource: {
          type: 'File',
          id: `file-${i}`,
          path: i < 2 ? '/orgs/acme/projects/alpha' : '/orgs/beta/projects/gamma',
        },
      }))

      const result = await query.find({
        resource: { path: '/orgs/acme/projects/alpha' },
      })

      expect(result.entries).toHaveLength(2)
    })

    it('should query by resource path prefix', async () => {
      await seedEntries(query, 5, (i) => ({
        resource: {
          type: 'File',
          id: `file-${i}`,
          path: ['/orgs/acme/projects/alpha', '/orgs/acme/projects/beta', '/orgs/other/projects/gamma', '/orgs/acme/settings', '/users/personal'][i],
        },
      }))

      const result = await query.find({
        resource: { path: { $startsWith: '/orgs/acme' } },
      })

      expect(result.entries).toHaveLength(3)
    })
  })

  // ============================================================================
  // QUERY BY TIME RANGE
  // ============================================================================

  describe('query by time range', () => {
    it('should query by timestamp after', async () => {
      const baseTime = Date.now()
      await seedEntries(query, 5, (i) => ({
        timestamp: {
          iso: new Date(baseTime + i * 1000).toISOString(),
          epochMs: baseTime + i * 1000,
        },
      }))

      const result = await query.find({
        timestamp: { $gte: baseTime + 2000 },
      })

      expect(result.entries).toHaveLength(3) // indices 2, 3, 4
    })

    it('should query by timestamp before', async () => {
      const baseTime = Date.now()
      await seedEntries(query, 5, (i) => ({
        timestamp: {
          iso: new Date(baseTime + i * 1000).toISOString(),
          epochMs: baseTime + i * 1000,
        },
      }))

      const result = await query.find({
        timestamp: { $lt: baseTime + 2000 },
      })

      expect(result.entries).toHaveLength(2) // indices 0, 1
    })

    it('should query by timestamp range (between)', async () => {
      const baseTime = Date.now()
      await seedEntries(query, 10, (i) => ({
        timestamp: {
          iso: new Date(baseTime + i * 1000).toISOString(),
          epochMs: baseTime + i * 1000,
        },
      }))

      const result = await query.find({
        timestamp: {
          $gte: baseTime + 3000,
          $lte: baseTime + 7000,
        },
      })

      expect(result.entries).toHaveLength(5) // indices 3, 4, 5, 6, 7
    })

    it('should query by ISO timestamp string', async () => {
      const baseTime = new Date('2024-01-15T10:00:00Z')
      await seedEntries(query, 5, (i) => ({
        timestamp: {
          iso: new Date(baseTime.getTime() + i * 3600000).toISOString(), // hourly increments
          epochMs: baseTime.getTime() + i * 3600000,
        },
      }))

      const result = await query.find({
        timestamp: {
          $gte: '2024-01-15T12:00:00Z',
          $lt: '2024-01-15T15:00:00Z',
        },
      })

      expect(result.entries).toHaveLength(3) // hours 12, 13, 14
    })

    it('should query by Date object', async () => {
      const baseTime = new Date('2024-06-01T00:00:00Z')
      await seedEntries(query, 7, (i) => ({
        timestamp: {
          iso: new Date(baseTime.getTime() + i * 86400000).toISOString(), // daily increments
          epochMs: baseTime.getTime() + i * 86400000,
        },
      }))

      const result = await query.find({
        timestamp: {
          $gte: new Date('2024-06-03T00:00:00Z'),
          $lt: new Date('2024-06-06T00:00:00Z'),
        },
      })

      expect(result.entries).toHaveLength(3) // days 3, 4, 5
    })

    it('should support relative time queries', async () => {
      const now = Date.now()
      await seedEntries(query, 5, (i) => ({
        timestamp: {
          iso: new Date(now - (4 - i) * 3600000).toISOString(), // 4h ago, 3h ago, 2h ago, 1h ago, now
          epochMs: now - (4 - i) * 3600000,
        },
      }))

      // Last 2 hours
      const result = await query.find({
        timestamp: { $gte: { $relative: '-2h' } },
      })

      expect(result.entries).toHaveLength(3) // 2h ago, 1h ago, now
    })
  })

  // ============================================================================
  // PAGINATION - OFFSET/LIMIT
  // ============================================================================

  describe('pagination with offset/limit', () => {
    it('should limit results', async () => {
      await seedEntries(query, 10)

      const result = await query.find({}, { limit: 5 })

      expect(result.entries).toHaveLength(5)
    })

    it('should skip results with offset', async () => {
      await seedEntries(query, 10, (i) => ({
        id: `entry-${i.toString().padStart(3, '0')}`,
      }))

      const result = await query.find({}, { offset: 3, limit: 5, sort: { id: 'asc' } })

      expect(result.entries).toHaveLength(5)
      expect(result.entries[0]!.id).toBe('entry-003')
    })

    it('should return total count with pagination', async () => {
      await seedEntries(query, 25)

      const result = await query.find({}, { limit: 10, includeTotalCount: true })

      expect(result.entries).toHaveLength(10)
      expect(result.totalCount).toBe(25)
    })

    it('should handle offset beyond results', async () => {
      await seedEntries(query, 5)

      const result = await query.find({}, { offset: 10, limit: 5 })

      expect(result.entries).toHaveLength(0)
    })

    it('should handle limit larger than results', async () => {
      await seedEntries(query, 3)

      const result = await query.find({}, { limit: 10 })

      expect(result.entries).toHaveLength(3)
    })

    it('should paginate through all results', async () => {
      await seedEntries(query, 25)

      const allEntries: AuditEntry[] = []
      let offset = 0
      const pageSize = 7

      while (true) {
        const result = await query.find({}, { offset, limit: pageSize })
        if (result.entries.length === 0) break
        allEntries.push(...result.entries)
        offset += pageSize
      }

      expect(allEntries).toHaveLength(25)
    })
  })

  // ============================================================================
  // PAGINATION - CURSOR-BASED
  // ============================================================================

  describe('cursor-based pagination', () => {
    it('should return cursor with results', async () => {
      await seedEntries(query, 10)

      const result = await query.find({}, { limit: 5, useCursor: true })

      expect(result.entries).toHaveLength(5)
      expect(result.cursor).toBeDefined()
      expect(result.cursor?.next).toBeDefined()
    })

    it('should fetch next page with cursor', async () => {
      await seedEntries(query, 15, (i) => ({
        id: `entry-${i.toString().padStart(3, '0')}`,
      }))

      const page1 = await query.find({}, { limit: 5, useCursor: true, sort: { id: 'asc' } })
      expect(page1.entries).toHaveLength(5)
      expect(page1.entries[0]!.id).toBe('entry-000')

      const page2 = await query.find({}, { limit: 5, cursor: page1.cursor?.next })
      expect(page2.entries).toHaveLength(5)
      expect(page2.entries[0]!.id).toBe('entry-005')
    })

    it('should indicate hasMore correctly', async () => {
      await seedEntries(query, 12)

      const page1 = await query.find({}, { limit: 5, useCursor: true })
      expect(page1.cursor?.hasMore).toBe(true)

      const page2 = await query.find({}, { limit: 5, cursor: page1.cursor?.next })
      expect(page2.cursor?.hasMore).toBe(true)

      const page3 = await query.find({}, { limit: 5, cursor: page2.cursor?.next })
      expect(page3.entries).toHaveLength(2)
      expect(page3.cursor?.hasMore).toBe(false)
    })

    it('should support previous page cursor', async () => {
      await seedEntries(query, 15, (i) => ({
        id: `entry-${i.toString().padStart(3, '0')}`,
      }))

      const page1 = await query.find({}, { limit: 5, useCursor: true, sort: { id: 'asc' } })
      const page2 = await query.find({}, { limit: 5, cursor: page1.cursor?.next })

      // Go back to page 1
      const backToPage1 = await query.find({}, { limit: 5, cursor: page2.cursor?.previous })
      expect(backToPage1.entries[0]!.id).toBe('entry-000')
    })

    it('should encode cursor as opaque string', async () => {
      await seedEntries(query, 10)

      const result = await query.find({}, { limit: 5, useCursor: true })

      expect(typeof result.cursor?.next).toBe('string')
      // Should not expose internal structure
      expect(result.cursor?.next).not.toContain('offset')
    })

    it('should reject invalid cursor', async () => {
      await expect(
        query.find({}, { cursor: 'invalid-cursor-value' })
      ).rejects.toThrow()
    })

    it('should handle cursor with filters', async () => {
      await seedEntries(query, 20, (i) => ({
        action: { type: i % 2 === 0 ? 'read' : 'write' },
      }))

      const page1 = await query.find(
        { action: { type: 'read' } },
        { limit: 3, useCursor: true }
      )

      expect(page1.entries).toHaveLength(3)
      expect(page1.entries.every((e) => e.action.type === 'read')).toBe(true)

      const page2 = await query.find(
        { action: { type: 'read' } },
        { limit: 3, cursor: page1.cursor?.next }
      )

      expect(page2.entries.every((e) => e.action.type === 'read')).toBe(true)
    })
  })

  // ============================================================================
  // COMBINED FILTERS (AND)
  // ============================================================================

  describe('combined filters (AND)', () => {
    it('should combine actor and action filters', async () => {
      await seedEntries(query, 10, (i) => ({
        actor: { userId: i % 2 === 0 ? 'user-alice' : 'user-bob' },
        action: { type: i < 5 ? 'read' : 'write' },
      }))

      const result = await query.find({
        actor: { userId: 'user-alice' },
        action: { type: 'read' },
      })

      // Alice (even indices 0,2,4,6,8) AND read (indices 0-4)
      // Intersection: 0, 2, 4
      expect(result.entries).toHaveLength(3)
    })

    it('should combine actor, action, and resource filters', async () => {
      await seedEntries(query, 12, (i) => ({
        actor: { userId: ['alice', 'bob', 'charlie'][i % 3] },
        action: { type: i % 2 === 0 ? 'read' : 'write' },
        resource: { type: i < 6 ? 'Document' : 'Folder', id: `id-${i}` },
      }))

      const result = await query.find({
        actor: { userId: 'alice' },
        action: { type: 'read' },
        resource: { type: 'Document' },
      })

      // alice (indices 0,3) AND read (even) AND Document (0-5)
      // alice: 0, 3, 6, 9
      // read: 0, 2, 4, 6, 8, 10
      // Document: 0, 1, 2, 3, 4, 5
      // Intersection: 0
      expect(result.entries).toHaveLength(1)
    })

    it('should combine filters with time range', async () => {
      const baseTime = Date.now()
      await seedEntries(query, 10, (i) => ({
        actor: { userId: i % 2 === 0 ? 'user-alice' : 'user-bob' },
        timestamp: {
          iso: new Date(baseTime + i * 1000).toISOString(),
          epochMs: baseTime + i * 1000,
        },
      }))

      const result = await query.find({
        actor: { userId: 'user-alice' },
        timestamp: { $gte: baseTime + 4000 },
      })

      // Alice (even: 0,2,4,6,8) AND time >= 4 (4,5,6,7,8,9)
      // Intersection: 4, 6, 8
      expect(result.entries).toHaveLength(3)
    })

    it('should support explicit $and operator', async () => {
      await seedEntries(query, 8, (i) => ({
        actor: { userId: `user-${i % 4}` },
        action: { type: i % 2 === 0 ? 'read' : 'write' },
      }))

      const result = await query.find({
        $and: [
          { actor: { userId: 'user-0' } },
          { action: { type: 'read' } },
        ],
      })

      expect(result.entries).toHaveLength(1)
    })

    it('should combine with correlation filter', async () => {
      await seedEntries(query, 6, (i) => ({
        actor: { userId: 'user-alice' },
        correlation: i < 3 ? { correlationId: 'corr-123' } : { correlationId: 'corr-456' },
      }))

      const result = await query.find({
        actor: { userId: 'user-alice' },
        correlation: { correlationId: 'corr-123' },
      })

      expect(result.entries).toHaveLength(3)
    })
  })

  // ============================================================================
  // OR FILTERS
  // ============================================================================

  describe('OR filters', () => {
    it('should support $or at top level', async () => {
      await seedEntries(query, 10, (i) => ({
        actor: { userId: `user-${i}` },
      }))

      const result = await query.find({
        $or: [
          { actor: { userId: 'user-1' } },
          { actor: { userId: 'user-5' } },
          { actor: { userId: 'user-9' } },
        ],
      })

      expect(result.entries).toHaveLength(3)
    })

    it('should combine $or with other filters', async () => {
      await seedEntries(query, 12, (i) => ({
        actor: { userId: `user-${i % 4}` },
        action: { type: i % 2 === 0 ? 'read' : 'write' },
      }))

      const result = await query.find({
        action: { type: 'read' },
        $or: [
          { actor: { userId: 'user-0' } },
          { actor: { userId: 'user-2' } },
        ],
      })

      // read AND (user-0 OR user-2)
      expect(result.entries).toHaveLength(3)
    })

    it('should support nested $or', async () => {
      await seedEntries(query, 8, (i) => ({
        actor: { userId: `user-${i % 4}` },
        resource: { type: i % 2 === 0 ? 'Document' : 'Folder', id: `id-${i}` },
      }))

      const result = await query.find({
        $or: [
          {
            $and: [
              { actor: { userId: 'user-0' } },
              { resource: { type: 'Document' } },
            ],
          },
          {
            $and: [
              { actor: { userId: 'user-1' } },
              { resource: { type: 'Folder' } },
            ],
          },
        ],
      })

      expect(result.entries).toHaveLength(2)
    })

    it('should support $or on action types', async () => {
      await seedEntries(query, 8, (i) => ({
        action: { type: ['create', 'read', 'update', 'delete'][i % 4]! },
      }))

      const result = await query.find({
        $or: [
          { action: { type: 'create' } },
          { action: { type: 'delete' } },
        ],
      })

      expect(result.entries).toHaveLength(4)
    })

    it('should support $nor operator', async () => {
      await seedEntries(query, 6, (i) => ({
        action: { type: ['create', 'read', 'update', 'delete', 'archive', 'restore'][i]! },
      }))

      const result = await query.find({
        $nor: [
          { action: { type: 'read' } },
          { action: { type: 'update' } },
        ],
      })

      expect(result.entries).toHaveLength(4)
    })
  })

  // ============================================================================
  // PERFORMANCE WITH LARGE DATASETS
  // ============================================================================

  describe('performance with large datasets', () => {
    let largeQuery: AuditLogQuery

    beforeAll(async () => {
      largeQuery = createQuery({ enableIndexes: true })
      // Seed 10k+ entries
      await seedEntries(largeQuery, 10500, (i) => ({
        id: `entry-${i.toString().padStart(6, '0')}`,
        actor: { userId: `user-${i % 100}` },
        action: { type: (['create', 'read', 'update', 'delete'] as const)[i % 4] },
        resource: { type: ['Document', 'Folder', 'User', 'Order', 'Product'][i % 5]!, id: `id-${i}` },
        timestamp: {
          iso: new Date(Date.now() - (10500 - i) * 1000).toISOString(),
          epochMs: Date.now() - (10500 - i) * 1000,
        },
      }))
    }, 60000)

    afterAll(async () => {
      await largeQuery.clear()
    })

    it('should query by actor efficiently (<100ms)', async () => {
      const start = performance.now()
      const result = await largeQuery.find({ actor: { userId: 'user-42' } })
      const elapsed = performance.now() - start

      expect(result.entries.length).toBeGreaterThan(0)
      expect(elapsed).toBeLessThan(100)
    })

    it('should query by action efficiently (<100ms)', async () => {
      const start = performance.now()
      const result = await largeQuery.find({ action: { type: 'delete' } })
      const elapsed = performance.now() - start

      expect(result.entries.length).toBeGreaterThan(0)
      expect(elapsed).toBeLessThan(100)
    })

    it('should query by resource type efficiently (<100ms)', async () => {
      const start = performance.now()
      const result = await largeQuery.find({ resource: { type: 'Order' } })
      const elapsed = performance.now() - start

      expect(result.entries.length).toBeGreaterThan(0)
      expect(elapsed).toBeLessThan(100)
    })

    it('should query by time range efficiently (<100ms)', async () => {
      const now = Date.now()
      const start = performance.now()
      const result = await largeQuery.find({
        timestamp: {
          $gte: now - 3600000, // last hour
          $lt: now,
        },
      })
      const elapsed = performance.now() - start

      expect(result.entries.length).toBeGreaterThan(0)
      expect(elapsed).toBeLessThan(100)
    })

    it('should paginate through large results efficiently', async () => {
      const pageSize = 100
      let totalFetched = 0
      let cursor: string | undefined

      const start = performance.now()

      // Fetch first 10 pages
      for (let i = 0; i < 10; i++) {
        const result = await largeQuery.find(
          { action: { type: 'read' } },
          cursor ? { limit: pageSize, cursor } : { limit: pageSize, useCursor: true }
        )
        totalFetched += result.entries.length
        cursor = result.cursor?.next
        if (!result.cursor?.hasMore) break
      }

      const elapsed = performance.now() - start

      expect(totalFetched).toBe(1000)
      expect(elapsed).toBeLessThan(500) // All 10 pages in under 500ms
    })

    it('should handle complex combined queries efficiently (<200ms)', async () => {
      const start = performance.now()
      const result = await largeQuery.find({
        actor: { userId: { $in: ['user-10', 'user-20', 'user-30'] } },
        action: { type: { $in: ['create', 'update'] } },
        resource: { type: 'Document' },
        timestamp: { $gte: Date.now() - 7200000 }, // last 2 hours
      })
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(200)
    })

    it('should count efficiently (<50ms)', async () => {
      const start = performance.now()
      const count = await largeQuery.count({ action: { type: 'create' } })
      const elapsed = performance.now() - start

      expect(count).toBeGreaterThan(0)
      expect(elapsed).toBeLessThan(50)
    })
  })

  // ============================================================================
  // QUERY RESULT ORDERING
  // ============================================================================

  describe('query result ordering', () => {
    it('should order by timestamp chronologically (ascending)', async () => {
      const baseTime = Date.now()
      await seedEntries(query, 5, (i) => ({
        id: `entry-${i}`,
        timestamp: {
          iso: new Date(baseTime + i * 1000).toISOString(),
          epochMs: baseTime + i * 1000,
        },
      }))

      const result = await query.find({}, { sort: { timestamp: 'asc' } })

      for (let i = 1; i < result.entries.length; i++) {
        expect(result.entries[i]!.timestamp.epochMs).toBeGreaterThanOrEqual(
          result.entries[i - 1]!.timestamp.epochMs
        )
      }
    })

    it('should order by timestamp reverse chronologically (descending)', async () => {
      const baseTime = Date.now()
      await seedEntries(query, 5, (i) => ({
        id: `entry-${i}`,
        timestamp: {
          iso: new Date(baseTime + i * 1000).toISOString(),
          epochMs: baseTime + i * 1000,
        },
      }))

      const result = await query.find({}, { sort: { timestamp: 'desc' } })

      for (let i = 1; i < result.entries.length; i++) {
        expect(result.entries[i]!.timestamp.epochMs).toBeLessThanOrEqual(
          result.entries[i - 1]!.timestamp.epochMs
        )
      }
    })

    it('should default to reverse chronological order', async () => {
      const baseTime = Date.now()
      await seedEntries(query, 5, (i) => ({
        id: `entry-${i}`,
        timestamp: {
          iso: new Date(baseTime + i * 1000).toISOString(),
          epochMs: baseTime + i * 1000,
        },
      }))

      const result = await query.find({})

      // Latest entries first by default
      for (let i = 1; i < result.entries.length; i++) {
        expect(result.entries[i]!.timestamp.epochMs).toBeLessThanOrEqual(
          result.entries[i - 1]!.timestamp.epochMs
        )
      }
    })

    it('should support multi-field sorting', async () => {
      await seedEntries(query, 8, (i) => ({
        id: `entry-${i}`,
        actor: { userId: `user-${i % 2}` },
        action: { type: (['create', 'read', 'update', 'delete'] as const)[i % 4] },
      }))

      const result = await query.find({}, {
        sort: {
          'actor.userId': 'asc',
          'action.type': 'asc',
        },
      })

      // Verify primary sort by actor.userId
      let lastUserId = ''
      for (const entry of result.entries) {
        expect(entry.actor.userId! >= lastUserId).toBe(true)
        lastUserId = entry.actor.userId!
      }
    })

    it('should sort by resource type', async () => {
      await seedEntries(query, 5, (i) => ({
        resource: { type: ['Zebra', 'Apple', 'Mango', 'Banana', 'Cherry'][i]!, id: `id-${i}` },
      }))

      const result = await query.find({}, { sort: { 'resource.type': 'asc' } })

      const types = result.entries.map((e) => e.resource.type)
      expect(types).toEqual(['Apple', 'Banana', 'Cherry', 'Mango', 'Zebra'])
    })

    it('should sort by id', async () => {
      await seedEntries(query, 5, (i) => ({
        id: `entry-${String.fromCharCode(69 - i)}`, // E, D, C, B, A
      }))

      const result = await query.find({}, { sort: { id: 'asc' } })

      expect(result.entries.map((e) => e.id)).toEqual([
        'entry-A',
        'entry-B',
        'entry-C',
        'entry-D',
        'entry-E',
      ])
    })
  })

  // ============================================================================
  // FIELD PROJECTIONS
  // ============================================================================

  describe('field projections', () => {
    it('should include only specified fields', async () => {
      await seedEntries(query, 3, (i) => ({
        id: `entry-${i}`,
        actor: { userId: `user-${i}`, displayName: 'Test User', ipAddress: '127.0.0.1' },
        action: { type: 'read' },
        resource: { type: 'Document', id: `doc-${i}` },
        metadata: { requestId: `req-${i}`, userAgent: 'test-agent' },
      }))

      const result = await query.find({}, {
        projection: { include: ['id', 'actor.userId', 'action.type'] },
      })

      expect(result.entries[0]).toHaveProperty('id')
      expect(result.entries[0]).toHaveProperty('actor')
      expect(result.entries[0]!.actor).toHaveProperty('userId')
      expect(result.entries[0]!.actor).not.toHaveProperty('displayName')
      expect(result.entries[0]).toHaveProperty('action')
      expect(result.entries[0]).not.toHaveProperty('resource')
      expect(result.entries[0]).not.toHaveProperty('metadata')
    })

    it('should exclude specified fields', async () => {
      await seedEntries(query, 3, (i) => ({
        id: `entry-${i}`,
        actor: { userId: `user-${i}` },
        action: { type: 'read' },
        resource: { type: 'Document', id: `doc-${i}` },
        state: { before: { value: 1 }, after: { value: 2 } },
        metadata: { requestId: `req-${i}` },
      }))

      const result = await query.find({}, {
        projection: { exclude: ['state', 'metadata'] },
      })

      expect(result.entries[0]).toHaveProperty('id')
      expect(result.entries[0]).toHaveProperty('actor')
      expect(result.entries[0]).toHaveProperty('action')
      expect(result.entries[0]).toHaveProperty('resource')
      expect(result.entries[0]).not.toHaveProperty('state')
      expect(result.entries[0]).not.toHaveProperty('metadata')
    })

    it('should support nested field projections', async () => {
      await seedEntries(query, 2, (i) => ({
        actor: {
          userId: `user-${i}`,
          displayName: 'Test',
          ipAddress: '127.0.0.1',
        },
        metadata: {
          requestId: `req-${i}`,
          sessionId: `sess-${i}`,
          geoLocation: { country: 'US', city: 'NYC' },
        },
      }))

      const result = await query.find({}, {
        projection: {
          include: ['actor.userId', 'metadata.geoLocation.country'],
        },
      })

      expect(result.entries[0]!.actor.userId).toBeDefined()
      expect(result.entries[0]!.actor.displayName).toBeUndefined()
      expect(result.entries[0]!.metadata?.geoLocation?.country).toBeDefined()
      expect(result.entries[0]!.metadata?.geoLocation?.city).toBeUndefined()
    })

    it('should always include id even if not specified', async () => {
      await seedEntries(query, 2)

      const result = await query.find({}, {
        projection: { include: ['actor.userId'] },
      })

      // id should always be included for reference
      expect(result.entries[0]).toHaveProperty('id')
    })

    it('should handle wildcard projections', async () => {
      await seedEntries(query, 2, () => ({
        metadata: {
          custom: { field1: 'a', field2: 'b', field3: 'c' },
        },
      }))

      const result = await query.find({}, {
        projection: { include: ['metadata.custom.*'] },
      })

      expect(result.entries[0]!.metadata?.custom).toBeDefined()
      expect(Object.keys(result.entries[0]!.metadata!.custom!)).toHaveLength(3)
    })

    it('should return minimal entry with empty projection', async () => {
      await seedEntries(query, 2)

      const result = await query.find({}, {
        projection: { include: [] }, // Only id
      })

      expect(Object.keys(result.entries[0]!)).toEqual(['id'])
    })
  })

  // ============================================================================
  // ADDITIONAL QUERY FEATURES
  // ============================================================================

  describe('additional query features', () => {
    it('should support text search on metadata', async () => {
      await seedEntries(query, 5, (i) => ({
        metadata: {
          userAgent: ['Chrome/120', 'Firefox/121', 'Safari/17', 'Chrome/119', 'Edge/120'][i],
        },
      }))

      const result = await query.find({
        metadata: { userAgent: { $contains: 'Chrome' } },
      })

      expect(result.entries).toHaveLength(2)
    })

    it('should support exists operator', async () => {
      await seedEntries(query, 6, (i) => ({
        state: i < 3 ? { before: {}, after: {} } : undefined,
      }))

      const result = await query.find({
        state: { $exists: true },
      })

      expect(result.entries).toHaveLength(3)
    })

    it('should support $not operator', async () => {
      await seedEntries(query, 5, (i) => ({
        action: { type: (['create', 'read', 'read', 'read', 'delete'] as const)[i] },
      }))

      const result = await query.find({
        action: { type: { $not: 'read' } },
      })

      expect(result.entries).toHaveLength(2)
    })

    it('should support correlation ID query', async () => {
      await seedEntries(query, 6, (i) => ({
        correlation: {
          correlationId: i < 3 ? 'workflow-123' : 'workflow-456',
          causationId: i === 0 ? undefined : `event-${i - 1}`,
        },
      }))

      const result = await query.find({
        correlation: { correlationId: 'workflow-123' },
      })

      expect(result.entries).toHaveLength(3)
    })

    it('should support query by schema version', async () => {
      await seedEntries(query, 4, (i) => ({
        schemaVersion: i < 2 ? 1 : 2,
      }))

      const result = await query.find({
        schemaVersion: 2,
      })

      expect(result.entries).toHaveLength(2)
    })

    it('should return empty result for no matches', async () => {
      await seedEntries(query, 5, () => ({
        actor: { userId: 'existing-user' },
      }))

      const result = await query.find({
        actor: { userId: 'non-existent-user' },
      })

      expect(result.entries).toHaveLength(0)
      expect(result.totalCount).toBe(0)
    })

    it('should count matching entries', async () => {
      await seedEntries(query, 10, (i) => ({
        action: { type: i % 2 === 0 ? 'read' : 'write' },
      }))

      const count = await query.count({
        action: { type: 'read' },
      })

      expect(count).toBe(5)
    })
  })

  // ============================================================================
  // FACTORY FUNCTION
  // ============================================================================

  describe('factory function', () => {
    it('should create AuditLogQuery instance', () => {
      const q = createAuditLogQuery()
      expect(q).toBeInstanceOf(AuditLogQuery)
    })

    it('should accept configuration options', () => {
      const q = createAuditLogQuery({
        enableIndexes: true,
        defaultPageSize: 50,
        maxPageSize: 1000,
      })
      expect(q).toBeDefined()
    })

    it('should support custom storage backend', () => {
      const mockStorage = {
        insert: async () => {},
        find: async () => ({ entries: [], totalCount: 0 }),
        count: async () => 0,
        clear: async () => {},
      }

      const q = createAuditLogQuery({
        storage: mockStorage,
      })

      expect(q).toBeDefined()
    })
  })
})
