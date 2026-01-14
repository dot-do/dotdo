/**
 * Session Replay Transformer Tests
 *
 * Tests for transforming rrweb-style session replay events
 * to the unified event schema.
 *
 * rrweb event types:
 * - 0: DomContentLoaded
 * - 1: Load
 * - 2: FullSnapshot
 * - 3: IncrementalSnapshot
 * - 4: Meta
 * - 5: Custom
 *
 * IncrementalSnapshot sources:
 * - 0: Mutation, 1: MouseMove, 2: MouseInteraction, 3: Scroll
 * - 4: ViewportResize, 5: Input, 6: TouchMove, 7: MediaInteraction
 * - 8: StyleSheetRule, 9: CanvasMutation, 10: Font, 11: Log, 12: Drag
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  transformSessionReplay,
  EVENT_TYPES,
  SOURCES,
  type RrwebEvent,
  type SessionReplayContext,
} from '../../db/streams/transformers/session-replay'

describe('transformSessionReplay', () => {
  const mockContext: SessionReplayContext = {
    sessionId: 'session-123',
    pageUrl: 'https://example.com/dashboard',
    ns: 'test-tenant',
    sequence: 42,
  }

  // Mock crypto.randomUUID for deterministic tests
  beforeEach(() => {
    vi.stubGlobal('crypto', {
      randomUUID: () => 'test-uuid-1234',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('event_type mapping', () => {
    it('sets event_type to "replay" for all events', () => {
      const event: RrwebEvent = {
        type: 2, // FullSnapshot
        data: { node: {} },
        timestamp: 1704067200000,
      }

      const result = transformSessionReplay(event, mockContext)

      expect(result.event_type).toBe('replay')
    })
  })

  describe('replay_type mapping', () => {
    it.each([
      [0, 'DomContentLoaded'],
      [1, 'Load'],
      [2, 'FullSnapshot'],
      [3, 'IncrementalSnapshot'],
      [4, 'Meta'],
      [5, 'Custom'],
    ])('maps type %i to replay_type "%s"', (typeNum, expectedType) => {
      const event: RrwebEvent = {
        type: typeNum,
        data: {},
        timestamp: 1704067200000,
      }

      const result = transformSessionReplay(event, mockContext)

      expect(result.replay_type).toBe(expectedType)
    })

    it('handles unknown type values gracefully', () => {
      const event: RrwebEvent = {
        type: 99,
        data: {},
        timestamp: 1704067200000,
      }

      const result = transformSessionReplay(event, mockContext)

      expect(result.replay_type).toBe('Unknown(99)')
    })
  })

  describe('replay_source mapping (for IncrementalSnapshot)', () => {
    it.each([
      [0, 'Mutation'],
      [1, 'MouseMove'],
      [2, 'MouseInteraction'],
      [3, 'Scroll'],
      [4, 'ViewportResize'],
      [5, 'Input'],
      [6, 'TouchMove'],
      [7, 'MediaInteraction'],
      [8, 'StyleSheetRule'],
      [9, 'CanvasMutation'],
      [10, 'Font'],
      [11, 'Log'],
      [12, 'Drag'],
    ])('maps source %i to replay_source "%s"', (sourceNum, expectedSource) => {
      const event: RrwebEvent = {
        type: 3, // IncrementalSnapshot
        source: sourceNum,
        data: {},
        timestamp: 1704067200000,
      }

      const result = transformSessionReplay(event, mockContext)

      expect(result.replay_source).toBe(expectedSource)
    })

    it('sets replay_source to null for non-IncrementalSnapshot events', () => {
      const event: RrwebEvent = {
        type: 2, // FullSnapshot
        data: {},
        timestamp: 1704067200000,
      }

      const result = transformSessionReplay(event, mockContext)

      expect(result.replay_source).toBeNull()
    })

    it('handles unknown source values gracefully', () => {
      const event: RrwebEvent = {
        type: 3, // IncrementalSnapshot
        source: 99,
        data: {},
        timestamp: 1704067200000,
      }

      const result = transformSessionReplay(event, mockContext)

      expect(result.replay_source).toBe('Unknown(99)')
    })
  })

  describe('replay_data mapping', () => {
    it('preserves raw data object as JSON string', () => {
      const eventData = {
        node: { type: 0, childNodes: [] },
        initialOffset: { top: 0, left: 0 },
      }
      const event: RrwebEvent = {
        type: 2, // FullSnapshot
        data: eventData,
        timestamp: 1704067200000,
      }

      const result = transformSessionReplay(event, mockContext)

      expect(result.replay_data).toBe(JSON.stringify(eventData))
    })

    it('serializes complex nested data', () => {
      const eventData = {
        mutations: [
          { type: 'childList', addedNodes: [{ id: 1, tagName: 'div' }] },
        ],
        positions: [[100, 200, 300]],
      }
      const event: RrwebEvent = {
        type: 3, // IncrementalSnapshot
        source: 0, // Mutation
        data: eventData,
        timestamp: 1704067200000,
      }

      const result = transformSessionReplay(event, mockContext)

      expect(result.replay_data).toBe(JSON.stringify(eventData))
    })

    it('handles empty data object', () => {
      const event: RrwebEvent = {
        type: 4, // Meta
        data: {},
        timestamp: 1704067200000,
      }

      const result = transformSessionReplay(event, mockContext)

      expect(result.replay_data).toBe('{}')
    })
  })

  describe('timestamp mapping', () => {
    it('converts Unix millisecond timestamp to ISO string', () => {
      const event: RrwebEvent = {
        type: 2,
        data: {},
        timestamp: 1704067200000, // 2024-01-01T00:00:00.000Z
      }

      const result = transformSessionReplay(event, mockContext)

      expect(result.timestamp).toBe('2024-01-01T00:00:00.000Z')
    })

    it('preserves millisecond precision', () => {
      const event: RrwebEvent = {
        type: 2,
        data: {},
        timestamp: 1704067200123, // 2024-01-01T00:00:00.123Z
      }

      const result = transformSessionReplay(event, mockContext)

      expect(result.timestamp).toBe('2024-01-01T00:00:00.123Z')
    })
  })

  describe('replay_sequence mapping', () => {
    it('sets replay_sequence from context', () => {
      const event: RrwebEvent = {
        type: 2,
        data: {},
        timestamp: 1704067200000,
      }

      const result = transformSessionReplay(event, { ...mockContext, sequence: 99 })

      expect(result.replay_sequence).toBe(99)
    })

    it('handles sequence 0', () => {
      const event: RrwebEvent = {
        type: 2,
        data: {},
        timestamp: 1704067200000,
      }

      const result = transformSessionReplay(event, { ...mockContext, sequence: 0 })

      expect(result.replay_sequence).toBe(0)
    })
  })

  describe('session_id mapping', () => {
    it('sets session_id from context', () => {
      const event: RrwebEvent = {
        type: 2,
        data: {},
        timestamp: 1704067200000,
      }

      const result = transformSessionReplay(event, mockContext)

      expect(result.session_id).toBe('session-123')
    })

    it('uses session_id as trace_id', () => {
      const event: RrwebEvent = {
        type: 2,
        data: {},
        timestamp: 1704067200000,
      }

      const result = transformSessionReplay(event, mockContext)

      expect(result.trace_id).toBe('session-123')
    })
  })

  describe('page_url / http_url mapping', () => {
    it('sets http_url from context pageUrl', () => {
      const event: RrwebEvent = {
        type: 2,
        data: {},
        timestamp: 1704067200000,
      }

      const result = transformSessionReplay(event, mockContext)

      expect(result.http_url).toBe('https://example.com/dashboard')
    })
  })

  describe('event_name construction', () => {
    it('uses type name for non-IncrementalSnapshot events', () => {
      const event: RrwebEvent = {
        type: 2, // FullSnapshot
        data: {},
        timestamp: 1704067200000,
      }

      const result = transformSessionReplay(event, mockContext)

      expect(result.event_name).toBe('FullSnapshot')
    })

    it('combines type and source for IncrementalSnapshot events', () => {
      const event: RrwebEvent = {
        type: 3, // IncrementalSnapshot
        source: 0, // Mutation
        data: {},
        timestamp: 1704067200000,
      }

      const result = transformSessionReplay(event, mockContext)

      expect(result.event_name).toBe('IncrementalSnapshot.Mutation')
    })

    it('creates correct event_name for scroll events', () => {
      const event: RrwebEvent = {
        type: 3, // IncrementalSnapshot
        source: 3, // Scroll
        data: { x: 0, y: 100 },
        timestamp: 1704067200000,
      }

      const result = transformSessionReplay(event, mockContext)

      expect(result.event_name).toBe('IncrementalSnapshot.Scroll')
    })

    it('creates correct event_name for input events', () => {
      const event: RrwebEvent = {
        type: 3, // IncrementalSnapshot
        source: 5, // Input
        data: { text: 'hello', id: 42 },
        timestamp: 1704067200000,
      }

      const result = transformSessionReplay(event, mockContext)

      expect(result.event_name).toBe('IncrementalSnapshot.Input')
    })
  })

  describe('ns mapping', () => {
    it('sets ns from context', () => {
      const event: RrwebEvent = {
        type: 2,
        data: {},
        timestamp: 1704067200000,
      }

      const result = transformSessionReplay(event, mockContext)

      expect(result.ns).toBe('test-tenant')
    })
  })

  describe('id generation', () => {
    it('generates unique id for each event', () => {
      const event: RrwebEvent = {
        type: 2,
        data: {},
        timestamp: 1704067200000,
      }

      const result = transformSessionReplay(event, mockContext)

      expect(result.id).toBe('test-uuid-1234')
    })
  })

  describe('CoreIdentity fields', () => {
    it('returns all required CoreIdentity fields', () => {
      const event: RrwebEvent = {
        type: 2,
        data: {},
        timestamp: 1704067200000,
      }

      const result = transformSessionReplay(event, mockContext)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('event_type')
      expect(result).toHaveProperty('event_name')
      expect(result).toHaveProperty('ns')
    })
  })

  describe('exported constants', () => {
    it('exports EVENT_TYPES array with correct values', () => {
      expect(EVENT_TYPES).toEqual([
        'DomContentLoaded',
        'Load',
        'FullSnapshot',
        'IncrementalSnapshot',
        'Meta',
        'Custom',
      ])
    })

    it('exports SOURCES array with correct values', () => {
      expect(SOURCES).toEqual([
        'Mutation',
        'MouseMove',
        'MouseInteraction',
        'Scroll',
        'ViewportResize',
        'Input',
        'TouchMove',
        'MediaInteraction',
        'StyleSheetRule',
        'CanvasMutation',
        'Font',
        'Log',
        'Drag',
      ])
    })
  })
})
