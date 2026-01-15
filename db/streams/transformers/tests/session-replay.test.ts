/**
 * Session Replay Transformer Tests
 *
 * Tests for transforming rrweb-style session replay events to the unified event schema.
 *
 * rrweb event types:
 * - 0: DomContentLoaded
 * - 1: Load
 * - 2: FullSnapshot
 * - 3: IncrementalSnapshot
 * - 4: Meta
 * - 5: Custom
 *
 * IncrementalSnapshot sources (type=3):
 * - 0: Mutation, 1: MouseMove, 2: MouseInteraction, 3: Scroll
 * - 4: ViewportResize, 5: Input, 6: TouchMove, 7: MediaInteraction
 * - 8: StyleSheetRule, 9: CanvasMutation, 10: Font, 11: Log, 12: Drag
 */

import { describe, expect, it } from 'vitest'
import {
  transformSessionReplay,
  EVENT_TYPES,
  SOURCES,
  type RrwebEvent,
  type SessionReplayContext,
} from '../session-replay'

describe('transformSessionReplay', () => {
  // Helper to create a minimal valid context
  function createContext(overrides: Partial<SessionReplayContext> = {}): SessionReplayContext {
    return {
      sessionId: 'session-123',
      pageUrl: 'https://example.com/page',
      ns: 'test-ns',
      sequence: 0,
      ...overrides,
    }
  }

  // Helper to create a minimal rrweb event
  function createEvent(overrides: Partial<RrwebEvent> = {}): RrwebEvent {
    return {
      type: 2, // FullSnapshot
      data: { node: { type: 0, childNodes: [] } },
      timestamp: 1704067200000, // 2024-01-01T00:00:00Z
      ...overrides,
    }
  }

  describe('EVENT_TYPES constant', () => {
    it('defines all 6 rrweb event types', () => {
      expect(EVENT_TYPES).toEqual([
        'DomContentLoaded',
        'Load',
        'FullSnapshot',
        'IncrementalSnapshot',
        'Meta',
        'Custom',
      ])
    })
  })

  describe('SOURCES constant', () => {
    it('defines all 13 IncrementalSnapshot sources', () => {
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

  describe('core identity mapping', () => {
    it('sets event_type to replay', () => {
      const event = createEvent()
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.event_type).toBe('replay')
    })

    it('generates a unique id', () => {
      const event = createEvent()
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.id).toBeDefined()
      expect(typeof result.id).toBe('string')
      expect(result.id.length).toBeGreaterThan(0)
    })

    it('generates different ids for different calls', () => {
      const event = createEvent()
      const context = createContext()
      const result1 = transformSessionReplay(event, context)
      const result2 = transformSessionReplay(event, context)

      expect(result1.id).not.toBe(result2.id)
    })

    it('sets ns from context', () => {
      const event = createEvent()
      const context = createContext({ ns: 'my-custom-ns' })
      const result = transformSessionReplay(event, context)

      expect(result.ns).toBe('my-custom-ns')
    })
  })

  describe('event type mapping', () => {
    it('maps type 0 to DomContentLoaded', () => {
      const event = createEvent({ type: 0 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.event_name).toBe('DomContentLoaded')
      expect(result.replay_type).toBe('DomContentLoaded')
    })

    it('maps type 1 to Load', () => {
      const event = createEvent({ type: 1 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.event_name).toBe('Load')
      expect(result.replay_type).toBe('Load')
    })

    it('maps type 2 to FullSnapshot', () => {
      const event = createEvent({ type: 2 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.event_name).toBe('FullSnapshot')
      expect(result.replay_type).toBe('FullSnapshot')
    })

    it('maps type 3 to IncrementalSnapshot', () => {
      const event = createEvent({ type: 3, source: 0 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.replay_type).toBe('IncrementalSnapshot')
    })

    it('maps type 4 to Meta', () => {
      const event = createEvent({ type: 4 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.event_name).toBe('Meta')
      expect(result.replay_type).toBe('Meta')
    })

    it('maps type 5 to Custom', () => {
      const event = createEvent({ type: 5 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.event_name).toBe('Custom')
      expect(result.replay_type).toBe('Custom')
    })

    it('handles unknown type gracefully', () => {
      const event = createEvent({ type: 99 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.event_name).toBe('Unknown(99)')
      expect(result.replay_type).toBe('Unknown(99)')
    })
  })

  describe('IncrementalSnapshot source mapping', () => {
    it('maps source 0 to Mutation', () => {
      const event = createEvent({ type: 3, source: 0 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.event_name).toBe('IncrementalSnapshot.Mutation')
      expect(result.replay_source).toBe('Mutation')
    })

    it('maps source 1 to MouseMove', () => {
      const event = createEvent({ type: 3, source: 1 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.event_name).toBe('IncrementalSnapshot.MouseMove')
      expect(result.replay_source).toBe('MouseMove')
    })

    it('maps source 2 to MouseInteraction', () => {
      const event = createEvent({ type: 3, source: 2 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.event_name).toBe('IncrementalSnapshot.MouseInteraction')
      expect(result.replay_source).toBe('MouseInteraction')
    })

    it('maps source 3 to Scroll', () => {
      const event = createEvent({ type: 3, source: 3 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.event_name).toBe('IncrementalSnapshot.Scroll')
      expect(result.replay_source).toBe('Scroll')
    })

    it('maps source 4 to ViewportResize', () => {
      const event = createEvent({ type: 3, source: 4 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.event_name).toBe('IncrementalSnapshot.ViewportResize')
      expect(result.replay_source).toBe('ViewportResize')
    })

    it('maps source 5 to Input', () => {
      const event = createEvent({ type: 3, source: 5 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.event_name).toBe('IncrementalSnapshot.Input')
      expect(result.replay_source).toBe('Input')
    })

    it('maps source 6 to TouchMove', () => {
      const event = createEvent({ type: 3, source: 6 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.event_name).toBe('IncrementalSnapshot.TouchMove')
      expect(result.replay_source).toBe('TouchMove')
    })

    it('maps source 7 to MediaInteraction', () => {
      const event = createEvent({ type: 3, source: 7 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.event_name).toBe('IncrementalSnapshot.MediaInteraction')
      expect(result.replay_source).toBe('MediaInteraction')
    })

    it('maps source 8 to StyleSheetRule', () => {
      const event = createEvent({ type: 3, source: 8 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.event_name).toBe('IncrementalSnapshot.StyleSheetRule')
      expect(result.replay_source).toBe('StyleSheetRule')
    })

    it('maps source 9 to CanvasMutation', () => {
      const event = createEvent({ type: 3, source: 9 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.event_name).toBe('IncrementalSnapshot.CanvasMutation')
      expect(result.replay_source).toBe('CanvasMutation')
    })

    it('maps source 10 to Font', () => {
      const event = createEvent({ type: 3, source: 10 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.event_name).toBe('IncrementalSnapshot.Font')
      expect(result.replay_source).toBe('Font')
    })

    it('maps source 11 to Log', () => {
      const event = createEvent({ type: 3, source: 11 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.event_name).toBe('IncrementalSnapshot.Log')
      expect(result.replay_source).toBe('Log')
    })

    it('maps source 12 to Drag', () => {
      const event = createEvent({ type: 3, source: 12 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.event_name).toBe('IncrementalSnapshot.Drag')
      expect(result.replay_source).toBe('Drag')
    })

    it('handles unknown source gracefully', () => {
      const event = createEvent({ type: 3, source: 99 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.event_name).toBe('IncrementalSnapshot.Unknown(99)')
      expect(result.replay_source).toBe('Unknown(99)')
    })

    it('sets replay_source to null for non-IncrementalSnapshot events', () => {
      const event = createEvent({ type: 2 }) // FullSnapshot
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.replay_source).toBeNull()
    })
  })

  describe('session and trace mapping', () => {
    it('maps sessionId to session_id', () => {
      const event = createEvent()
      const context = createContext({ sessionId: 'my-session-xyz' })
      const result = transformSessionReplay(event, context)

      expect(result.session_id).toBe('my-session-xyz')
    })

    it('maps sessionId to trace_id for trace correlation', () => {
      const event = createEvent()
      const context = createContext({ sessionId: 'session-for-trace' })
      const result = transformSessionReplay(event, context)

      expect(result.trace_id).toBe('session-for-trace')
    })
  })

  describe('replay-specific fields', () => {
    it('maps sequence to replay_sequence', () => {
      const event = createEvent()
      const context = createContext({ sequence: 42 })
      const result = transformSessionReplay(event, context)

      expect(result.replay_sequence).toBe(42)
    })

    it('serializes data to replay_data as JSON', () => {
      const eventData = { node: { type: 0, childNodes: [{ id: 1 }] } }
      const event = createEvent({ data: eventData })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.replay_data).toBe(JSON.stringify(eventData))
    })

    it('handles complex nested data in replay_data', () => {
      const complexData = {
        adds: [{ parentId: 1, node: { type: 2, tagName: 'div', attributes: { class: 'test' } } }],
        removes: [{ parentId: 2, id: 3 }],
        texts: [{ id: 4, value: 'Hello' }],
      }
      const event = createEvent({ type: 3, source: 0, data: complexData })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.replay_data).toBe(JSON.stringify(complexData))
    })
  })

  describe('http context mapping', () => {
    it('maps pageUrl to http_url', () => {
      const event = createEvent()
      const context = createContext({ pageUrl: 'https://app.example.com/dashboard' })
      const result = transformSessionReplay(event, context)

      expect(result.http_url).toBe('https://app.example.com/dashboard')
    })
  })

  describe('timestamp mapping', () => {
    it('converts timestamp to ISO string', () => {
      const event = createEvent({ timestamp: 1704067200000 }) // 2024-01-01T00:00:00Z
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.timestamp).toBe('2024-01-01T00:00:00.000Z')
    })

    it('preserves millisecond precision', () => {
      const event = createEvent({ timestamp: 1704067200123 })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.timestamp).toBe('2024-01-01T00:00:00.123Z')
    })
  })

  describe('complete event transformation', () => {
    it('transforms a full FullSnapshot event', () => {
      const event: RrwebEvent = {
        type: 2,
        data: {
          node: {
            type: 0,
            childNodes: [
              { type: 2, tagName: 'html', attributes: {}, childNodes: [] },
            ],
          },
          initialOffset: { top: 0, left: 0 },
        },
        timestamp: 1704067200500,
      }
      const context: SessionReplayContext = {
        sessionId: 'full-snapshot-session',
        pageUrl: 'https://shop.example.com/products',
        ns: 'shop-replay',
        sequence: 5,
      }

      const result = transformSessionReplay(event, context)

      // Core identity
      expect(result.id).toBeDefined()
      expect(result.event_type).toBe('replay')
      expect(result.event_name).toBe('FullSnapshot')
      expect(result.ns).toBe('shop-replay')

      // Causality
      expect(result.session_id).toBe('full-snapshot-session')
      expect(result.trace_id).toBe('full-snapshot-session')

      // Replay-specific
      expect(result.replay_type).toBe('FullSnapshot')
      expect(result.replay_source).toBeNull()
      expect(result.replay_sequence).toBe(5)
      expect(result.replay_data).toBe(JSON.stringify(event.data))

      // HTTP context
      expect(result.http_url).toBe('https://shop.example.com/products')

      // Timing
      expect(result.timestamp).toBe('2024-01-01T00:00:00.500Z')
    })

    it('transforms a full IncrementalSnapshot.Input event', () => {
      const event: RrwebEvent = {
        type: 3,
        source: 5, // Input
        data: {
          source: 5,
          id: 42,
          text: 'user@example.com',
          isChecked: false,
        },
        timestamp: 1704067201000,
      }
      const context: SessionReplayContext = {
        sessionId: 'input-session',
        pageUrl: 'https://app.example.com/login',
        ns: 'app-replay',
        sequence: 15,
      }

      const result = transformSessionReplay(event, context)

      // Core identity
      expect(result.event_type).toBe('replay')
      expect(result.event_name).toBe('IncrementalSnapshot.Input')
      expect(result.ns).toBe('app-replay')

      // Replay-specific
      expect(result.replay_type).toBe('IncrementalSnapshot')
      expect(result.replay_source).toBe('Input')
      expect(result.replay_sequence).toBe(15)

      // Timing
      expect(result.timestamp).toBe('2024-01-01T00:00:01.000Z')
    })

    it('transforms a MouseInteraction event', () => {
      const event: RrwebEvent = {
        type: 3,
        source: 2, // MouseInteraction
        data: {
          source: 2,
          type: 2, // click
          id: 100,
          x: 450,
          y: 320,
        },
        timestamp: 1704067202500,
      }
      const context: SessionReplayContext = {
        sessionId: 'click-session',
        pageUrl: 'https://app.example.com/button',
        ns: 'click-replay',
        sequence: 25,
      }

      const result = transformSessionReplay(event, context)

      expect(result.event_name).toBe('IncrementalSnapshot.MouseInteraction')
      expect(result.replay_type).toBe('IncrementalSnapshot')
      expect(result.replay_source).toBe('MouseInteraction')
      expect(result.replay_sequence).toBe(25)
    })
  })

  describe('edge cases', () => {
    it('handles sequence 0', () => {
      const event = createEvent()
      const context = createContext({ sequence: 0 })
      const result = transformSessionReplay(event, context)

      expect(result.replay_sequence).toBe(0)
    })

    it('handles empty data object', () => {
      const event = createEvent({ data: {} })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.replay_data).toBe('{}')
    })

    it('handles null data', () => {
      const event = createEvent({ data: null })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.replay_data).toBe('null')
    })

    it('handles very large sequence numbers', () => {
      const event = createEvent()
      const context = createContext({ sequence: 999999 })
      const result = transformSessionReplay(event, context)

      expect(result.replay_sequence).toBe(999999)
    })

    it('handles future timestamps', () => {
      const futureTimestamp = Date.now() + 365 * 24 * 60 * 60 * 1000 // 1 year from now
      const event = createEvent({ timestamp: futureTimestamp })
      const context = createContext()
      const result = transformSessionReplay(event, context)

      expect(result.timestamp).toBeDefined()
      expect(new Date(result.timestamp!).getTime()).toBe(futureTimestamp)
    })
  })
})
