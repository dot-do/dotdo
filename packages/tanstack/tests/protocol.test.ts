import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  // Schemas
  SubscribeMessageSchema,
  UnsubscribeMessageSchema,
  InitialMessageSchema,
  ChangeMessageSchema,
  MutationResponseSchema,
  SyncMessageSchema,
  QueryOptionsSchema,
  ThingSchema,

  // Types
  type SubscribeMessage,
  type UnsubscribeMessage,
  type InitialMessage,
  type ChangeMessage,
  type MutationResponse,
  type SyncMessage,
  type QueryOptions,
  type Thing,

  // Type guards
  isSubscribeMessage,
  isUnsubscribeMessage,
  isInitialMessage,
  isChangeMessage,
  isMutationResponse,

  // Parser
  parseSyncMessage,
} from '../src/protocol'

// ============================================================================
// THING SCHEMA TESTS
// ============================================================================

describe('ThingSchema', () => {
  it('should validate a minimal Thing', () => {
    const thing = {
      $id: 'https://example.com/items/123',
      $type: 'https://example.com/Item',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const result = ThingSchema.safeParse(thing)
    expect(result.success).toBe(true)
  })

  it('should validate a Thing with all fields', () => {
    const thing = {
      $id: 'https://startups.studio/headless.ly',
      $type: 'https://startups.studio/Startup',
      name: 'Headless.ly',
      data: { description: 'A headless CMS' },
      meta: { featured: true },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
      deletedAt: '2024-01-03T00:00:00.000Z',
    }

    const result = ThingSchema.safeParse(thing)
    expect(result.success).toBe(true)
  })

  it('should reject Thing without $id', () => {
    const thing = {
      $type: 'https://example.com/Item',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const result = ThingSchema.safeParse(thing)
    expect(result.success).toBe(false)
  })

  it('should reject Thing without $type', () => {
    const thing = {
      $id: 'https://example.com/items/123',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const result = ThingSchema.safeParse(thing)
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// QUERY OPTIONS TESTS
// ============================================================================

describe('QueryOptionsSchema', () => {
  it('should validate empty query options', () => {
    const result = QueryOptionsSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('should validate query options with limit', () => {
    const result = QueryOptionsSchema.safeParse({ limit: 10 })
    expect(result.success).toBe(true)
  })

  it('should validate query options with offset', () => {
    const result = QueryOptionsSchema.safeParse({ offset: 5 })
    expect(result.success).toBe(true)
  })

  it('should validate query options with orderBy', () => {
    const result = QueryOptionsSchema.safeParse({
      orderBy: { field: 'createdAt', direction: 'desc' }
    })
    expect(result.success).toBe(true)
  })

  it('should validate query options with where clause', () => {
    const result = QueryOptionsSchema.safeParse({
      where: { status: 'active', priority: 1 }
    })
    expect(result.success).toBe(true)
  })

  it('should validate complete query options', () => {
    const options = {
      limit: 20,
      offset: 10,
      orderBy: { field: 'updatedAt', direction: 'asc' },
      where: { category: 'tech' },
    }

    const result = QueryOptionsSchema.safeParse(options)
    expect(result.success).toBe(true)
  })

  it('should reject invalid orderBy direction', () => {
    const result = QueryOptionsSchema.safeParse({
      orderBy: { field: 'name', direction: 'invalid' }
    })
    expect(result.success).toBe(false)
  })

  it('should reject non-integer limit', () => {
    const result = QueryOptionsSchema.safeParse({ limit: 'ten' })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// SUBSCRIBE MESSAGE TESTS
// ============================================================================

describe('SubscribeMessageSchema', () => {
  it('should validate a minimal subscribe message', () => {
    const message = {
      type: 'subscribe',
      collection: 'users',
    }

    const result = SubscribeMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('subscribe')
      expect(result.data.collection).toBe('users')
    }
  })

  it('should validate subscribe message with branch', () => {
    const message = {
      type: 'subscribe',
      collection: 'posts',
      branch: 'main',
    }

    const result = SubscribeMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.branch).toBe('main')
    }
  })

  it('should validate subscribe message with query options', () => {
    const message = {
      type: 'subscribe',
      collection: 'items',
      query: {
        limit: 100,
        where: { active: true },
      },
    }

    const result = SubscribeMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.query?.limit).toBe(100)
    }
  })

  it('should validate complete subscribe message', () => {
    const message = {
      type: 'subscribe',
      collection: 'tasks',
      branch: 'feature/new-ui',
      query: {
        limit: 50,
        offset: 0,
        orderBy: { field: 'priority', direction: 'desc' },
        where: { status: 'pending' },
      },
    }

    const result = SubscribeMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
  })

  it('should reject subscribe message without collection', () => {
    const message = {
      type: 'subscribe',
    }

    const result = SubscribeMessageSchema.safeParse(message)
    expect(result.success).toBe(false)
  })

  it('should reject subscribe message with wrong type', () => {
    const message = {
      type: 'unsubscribe',
      collection: 'users',
    }

    const result = SubscribeMessageSchema.safeParse(message)
    expect(result.success).toBe(false)
  })

  it('should reject subscribe message with empty collection', () => {
    const message = {
      type: 'subscribe',
      collection: '',
    }

    const result = SubscribeMessageSchema.safeParse(message)
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// UNSUBSCRIBE MESSAGE TESTS
// ============================================================================

describe('UnsubscribeMessageSchema', () => {
  it('should validate a valid unsubscribe message', () => {
    const message = {
      type: 'unsubscribe',
      collection: 'users',
    }

    const result = UnsubscribeMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('unsubscribe')
      expect(result.data.collection).toBe('users')
    }
  })

  it('should reject unsubscribe message without collection', () => {
    const message = {
      type: 'unsubscribe',
    }

    const result = UnsubscribeMessageSchema.safeParse(message)
    expect(result.success).toBe(false)
  })

  it('should reject unsubscribe message with wrong type', () => {
    const message = {
      type: 'subscribe',
      collection: 'users',
    }

    const result = UnsubscribeMessageSchema.safeParse(message)
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// INITIAL MESSAGE TESTS
// ============================================================================

describe('InitialMessageSchema', () => {
  it('should validate an initial message with empty data', () => {
    const message = {
      type: 'initial',
      collection: 'users',
      data: [],
      txid: 0,
    }

    const result = InitialMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('initial')
      expect(result.data.data).toEqual([])
      expect(result.data.txid).toBe(0)
    }
  })

  it('should validate an initial message with data', () => {
    const message = {
      type: 'initial',
      collection: 'items',
      data: [
        {
          $id: 'https://example.com/items/1',
          $type: 'https://example.com/Item',
          name: 'Item 1',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        {
          $id: 'https://example.com/items/2',
          $type: 'https://example.com/Item',
          name: 'Item 2',
          createdAt: '2024-01-02T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
      ],
      txid: 42,
    }

    const result = InitialMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.data.length).toBe(2)
      expect(result.data.txid).toBe(42)
    }
  })

  it('should reject initial message without txid', () => {
    const message = {
      type: 'initial',
      collection: 'users',
      data: [],
    }

    const result = InitialMessageSchema.safeParse(message)
    expect(result.success).toBe(false)
  })

  it('should reject initial message without collection', () => {
    const message = {
      type: 'initial',
      data: [],
      txid: 0,
    }

    const result = InitialMessageSchema.safeParse(message)
    expect(result.success).toBe(false)
  })

  it('should reject initial message with invalid Thing in data', () => {
    const message = {
      type: 'initial',
      collection: 'items',
      data: [
        { name: 'Invalid - missing $id and $type' },
      ],
      txid: 0,
    }

    const result = InitialMessageSchema.safeParse(message)
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// CHANGE MESSAGE TESTS
// ============================================================================

describe('ChangeMessageSchema', () => {
  describe('insert changes', () => {
    it('should validate an insert change message', () => {
      const message = {
        type: 'insert',
        collection: 'users',
        key: 'user-123',
        data: {
          $id: 'https://example.com/users/123',
          $type: 'https://example.com/User',
          name: 'John Doe',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        txid: 1,
      }

      const result = ChangeMessageSchema.safeParse(message)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.type).toBe('insert')
        expect(result.data.key).toBe('user-123')
        expect(result.data.data?.$id).toBe('https://example.com/users/123')
      }
    })

    it('should reject insert without data', () => {
      const message = {
        type: 'insert',
        collection: 'users',
        key: 'user-123',
        txid: 1,
      }

      const result = ChangeMessageSchema.safeParse(message)
      expect(result.success).toBe(false)
    })
  })

  describe('update changes', () => {
    it('should validate an update change message', () => {
      const message = {
        type: 'update',
        collection: 'users',
        key: 'user-123',
        data: {
          $id: 'https://example.com/users/123',
          $type: 'https://example.com/User',
          name: 'Jane Doe',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
        txid: 2,
      }

      const result = ChangeMessageSchema.safeParse(message)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.type).toBe('update')
      }
    })

    it('should reject update without data', () => {
      const message = {
        type: 'update',
        collection: 'users',
        key: 'user-123',
        txid: 2,
      }

      const result = ChangeMessageSchema.safeParse(message)
      expect(result.success).toBe(false)
    })
  })

  describe('delete changes', () => {
    it('should validate a delete change message without data', () => {
      const message = {
        type: 'delete',
        collection: 'users',
        key: 'user-123',
        txid: 3,
      }

      const result = ChangeMessageSchema.safeParse(message)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.type).toBe('delete')
        expect(result.data.data).toBeUndefined()
      }
    })

    it('should validate a delete change message with data (for soft delete)', () => {
      const message = {
        type: 'delete',
        collection: 'users',
        key: 'user-123',
        data: {
          $id: 'https://example.com/users/123',
          $type: 'https://example.com/User',
          name: 'John Doe',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          deletedAt: '2024-01-03T00:00:00.000Z',
        },
        txid: 3,
      }

      const result = ChangeMessageSchema.safeParse(message)
      expect(result.success).toBe(true)
    })
  })

  describe('common change message validation', () => {
    it('should reject change message without key', () => {
      const message = {
        type: 'insert',
        collection: 'users',
        data: {
          $id: 'https://example.com/users/123',
          $type: 'https://example.com/User',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        txid: 1,
      }

      const result = ChangeMessageSchema.safeParse(message)
      expect(result.success).toBe(false)
    })

    it('should reject change message without txid', () => {
      const message = {
        type: 'insert',
        collection: 'users',
        key: 'user-123',
        data: {
          $id: 'https://example.com/users/123',
          $type: 'https://example.com/User',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      }

      const result = ChangeMessageSchema.safeParse(message)
      expect(result.success).toBe(false)
    })

    it('should reject change message with invalid type', () => {
      const message = {
        type: 'upsert',
        collection: 'users',
        key: 'user-123',
        txid: 1,
      }

      const result = ChangeMessageSchema.safeParse(message)
      expect(result.success).toBe(false)
    })
  })
})

// ============================================================================
// MUTATION RESPONSE TESTS
// ============================================================================

describe('MutationResponseSchema', () => {
  it('should validate a successful mutation response without data', () => {
    const response = {
      success: true,
      rowid: 1,
    }

    const result = MutationResponseSchema.safeParse(response)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.success).toBe(true)
      expect(result.data.rowid).toBe(1)
    }
  })

  it('should validate a successful mutation response with data', () => {
    const response = {
      success: true,
      rowid: 42,
      data: {
        $id: 'https://example.com/items/42',
        $type: 'https://example.com/Item',
        name: 'New Item',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    }

    const result = MutationResponseSchema.safeParse(response)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.data?.$id).toBe('https://example.com/items/42')
    }
  })

  it('should validate a failed mutation response', () => {
    const response = {
      success: false,
      rowid: 0,
      error: 'Validation failed',
    }

    const result = MutationResponseSchema.safeParse(response)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.success).toBe(false)
      expect(result.data.error).toBe('Validation failed')
    }
  })

  it('should reject mutation response without success field', () => {
    const response = {
      rowid: 1,
    }

    const result = MutationResponseSchema.safeParse(response)
    expect(result.success).toBe(false)
  })

  it('should reject mutation response without rowid', () => {
    const response = {
      success: true,
    }

    const result = MutationResponseSchema.safeParse(response)
    expect(result.success).toBe(false)
  })

  it('should reject mutation response with non-integer rowid', () => {
    const response = {
      success: true,
      rowid: 'abc',
    }

    const result = MutationResponseSchema.safeParse(response)
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// SYNC MESSAGE (DISCRIMINATED UNION) TESTS
// ============================================================================

describe('SyncMessageSchema', () => {
  it('should parse subscribe message', () => {
    const message = {
      type: 'subscribe',
      collection: 'users',
    }

    const result = SyncMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('subscribe')
    }
  })

  it('should parse unsubscribe message', () => {
    const message = {
      type: 'unsubscribe',
      collection: 'users',
    }

    const result = SyncMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('unsubscribe')
    }
  })

  it('should parse initial message', () => {
    const message = {
      type: 'initial',
      collection: 'users',
      data: [],
      txid: 0,
    }

    const result = SyncMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('initial')
    }
  })

  it('should parse insert change message', () => {
    const message = {
      type: 'insert',
      collection: 'users',
      key: 'user-1',
      data: {
        $id: 'https://example.com/users/1',
        $type: 'https://example.com/User',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      txid: 1,
    }

    const result = SyncMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('insert')
    }
  })

  it('should parse update change message', () => {
    const message = {
      type: 'update',
      collection: 'users',
      key: 'user-1',
      data: {
        $id: 'https://example.com/users/1',
        $type: 'https://example.com/User',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
      txid: 2,
    }

    const result = SyncMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('update')
    }
  })

  it('should parse delete change message', () => {
    const message = {
      type: 'delete',
      collection: 'users',
      key: 'user-1',
      txid: 3,
    }

    const result = SyncMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('delete')
    }
  })

  it('should reject unknown message type', () => {
    const message = {
      type: 'unknown',
      collection: 'users',
    }

    const result = SyncMessageSchema.safeParse(message)
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// TYPE GUARD TESTS
// ============================================================================

describe('Type Guards', () => {
  describe('isSubscribeMessage', () => {
    it('should return true for subscribe message', () => {
      const message = { type: 'subscribe', collection: 'users' }
      expect(isSubscribeMessage(message)).toBe(true)
    })

    it('should return false for non-subscribe message', () => {
      const message = { type: 'unsubscribe', collection: 'users' }
      expect(isSubscribeMessage(message)).toBe(false)
    })

    it('should return false for invalid message', () => {
      const message = { type: 'subscribe' } // missing collection
      expect(isSubscribeMessage(message)).toBe(false)
    })

    it('should return false for null/undefined', () => {
      expect(isSubscribeMessage(null)).toBe(false)
      expect(isSubscribeMessage(undefined)).toBe(false)
    })
  })

  describe('isUnsubscribeMessage', () => {
    it('should return true for unsubscribe message', () => {
      const message = { type: 'unsubscribe', collection: 'users' }
      expect(isUnsubscribeMessage(message)).toBe(true)
    })

    it('should return false for non-unsubscribe message', () => {
      const message = { type: 'subscribe', collection: 'users' }
      expect(isUnsubscribeMessage(message)).toBe(false)
    })
  })

  describe('isInitialMessage', () => {
    it('should return true for initial message', () => {
      const message = {
        type: 'initial',
        collection: 'users',
        data: [],
        txid: 0
      }
      expect(isInitialMessage(message)).toBe(true)
    })

    it('should return false for non-initial message', () => {
      const message = { type: 'subscribe', collection: 'users' }
      expect(isInitialMessage(message)).toBe(false)
    })

    it('should return false for initial message missing txid', () => {
      const message = { type: 'initial', collection: 'users', data: [] }
      expect(isInitialMessage(message)).toBe(false)
    })
  })

  describe('isChangeMessage', () => {
    it('should return true for insert message', () => {
      const message = {
        type: 'insert',
        collection: 'users',
        key: 'user-1',
        data: {
          $id: 'https://example.com/users/1',
          $type: 'https://example.com/User',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        txid: 1,
      }
      expect(isChangeMessage(message)).toBe(true)
    })

    it('should return true for update message', () => {
      const message = {
        type: 'update',
        collection: 'users',
        key: 'user-1',
        data: {
          $id: 'https://example.com/users/1',
          $type: 'https://example.com/User',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
        txid: 2,
      }
      expect(isChangeMessage(message)).toBe(true)
    })

    it('should return true for delete message', () => {
      const message = {
        type: 'delete',
        collection: 'users',
        key: 'user-1',
        txid: 3,
      }
      expect(isChangeMessage(message)).toBe(true)
    })

    it('should return false for non-change message', () => {
      const message = { type: 'subscribe', collection: 'users' }
      expect(isChangeMessage(message)).toBe(false)
    })

    it('should return false for change message missing key', () => {
      const message = {
        type: 'insert',
        collection: 'users',
        txid: 1,
      }
      expect(isChangeMessage(message)).toBe(false)
    })
  })

  describe('isMutationResponse', () => {
    it('should return true for valid mutation response', () => {
      const response = { success: true, rowid: 1 }
      expect(isMutationResponse(response)).toBe(true)
    })

    it('should return false for invalid mutation response', () => {
      const response = { success: true } // missing rowid
      expect(isMutationResponse(response)).toBe(false)
    })

    it('should return false for non-object', () => {
      expect(isMutationResponse('not an object')).toBe(false)
      expect(isMutationResponse(123)).toBe(false)
    })
  })
})

// ============================================================================
// PARSER FUNCTION TESTS
// ============================================================================

describe('parseSyncMessage', () => {
  it('should parse valid JSON string to subscribe message', () => {
    const json = JSON.stringify({ type: 'subscribe', collection: 'users' })
    const result = parseSyncMessage(json)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('subscribe')
    }
  })

  it('should parse valid JSON string to initial message', () => {
    const json = JSON.stringify({
      type: 'initial',
      collection: 'users',
      data: [],
      txid: 0
    })
    const result = parseSyncMessage(json)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('initial')
    }
  })

  it('should return error for invalid JSON', () => {
    const result = parseSyncMessage('not valid json')
    expect(result.success).toBe(false)
  })

  it('should return error for valid JSON but invalid message', () => {
    const json = JSON.stringify({ invalid: 'message' })
    const result = parseSyncMessage(json)
    expect(result.success).toBe(false)
  })

  it('should handle object input (not just string)', () => {
    const message = { type: 'subscribe', collection: 'users' }
    const result = parseSyncMessage(message)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('subscribe')
    }
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  it('should handle very long collection names', () => {
    const longName = 'a'.repeat(1000)
    const message = { type: 'subscribe', collection: longName }

    const result = SubscribeMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
  })

  it('should handle special characters in collection names', () => {
    const message = { type: 'subscribe', collection: 'users-v2_test.items' }

    const result = SubscribeMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
  })

  it('should handle negative txid', () => {
    const message = {
      type: 'initial',
      collection: 'users',
      data: [],
      txid: -1,
    }

    // Negative txid should be rejected (txid must be non-negative)
    const result = InitialMessageSchema.safeParse(message)
    expect(result.success).toBe(false)
  })

  it('should handle very large txid', () => {
    const message = {
      type: 'initial',
      collection: 'users',
      data: [],
      txid: Number.MAX_SAFE_INTEGER,
    }

    const result = InitialMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
  })

  it('should handle Thing with extra properties (strip unknown)', () => {
    const thing = {
      $id: 'https://example.com/items/1',
      $type: 'https://example.com/Item',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      extraField: 'should be allowed in passthrough mode',
    }

    const result = ThingSchema.safeParse(thing)
    // Things should allow extra properties (passthrough)
    expect(result.success).toBe(true)
  })

  it('should handle empty key in change message', () => {
    const message = {
      type: 'delete',
      collection: 'users',
      key: '',
      txid: 1,
    }

    // Empty key should be rejected
    const result = ChangeMessageSchema.safeParse(message)
    expect(result.success).toBe(false)
  })
})
