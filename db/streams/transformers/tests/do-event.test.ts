/**
 * DO Event Transformer Tests
 *
 * Tests the transformation of DO Event records to the UnifiedEvent schema.
 * The transformer maps legacy DO event fields to the 162-column unified schema.
 *
 * @module db/streams/transformers/tests/do-event.test
 */

import { describe, it, expect } from 'vitest'
import { transformDoEvent, type DoEventInput } from '../do-event'
import type { UnifiedEvent } from '../../../../types/unified-event'

describe('transformDoEvent', () => {
  // ============================================================================
  // Core Mappings
  // ============================================================================

  describe('core identity mappings', () => {
    it('generates a new UUID for id field', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-1',
        data: {},
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      // id should be a new UUID, not the input id
      expect(result.id).toBeDefined()
      expect(result.id).not.toBe('evt-123')
      expect(result.id).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('maps verb to event_name', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'signup',
        source: 'Customer/cust-1',
        data: {},
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.event_name).toBe('signup')
    })

    it('sets event_type to track for DO events', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-1',
        data: {},
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.event_type).toBe('track')
    })

    it('maps ns parameter to ns field', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-1',
        data: {},
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://startups.studio')

      expect(result.ns).toBe('https://startups.studio')
    })
  })

  // ============================================================================
  // Causality Chain Mappings
  // ============================================================================

  describe('causality chain mappings', () => {
    it('maps id to span_id', () => {
      const input: DoEventInput = {
        id: 'evt-abc-123',
        verb: 'created',
        source: 'Customer/cust-1',
        data: {},
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.span_id).toBe('evt-abc-123')
    })

    it('maps actionId to trace_id when present', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-1',
        data: {},
        actionId: 'action-456',
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.trace_id).toBe('action-456')
    })

    it('sets trace_id to null when actionId is not present', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-1',
        data: {},
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.trace_id).toBeNull()
    })
  })

  // ============================================================================
  // Resource Mappings
  // ============================================================================

  describe('resource mappings', () => {
    it('maps source to resource_id qualified with ns', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-1',
        data: {},
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://startups.studio')

      expect(result.resource_id).toBe('https://startups.studio/Customer/cust-1')
    })

    it('handles source without leading slash', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Order/order-999',
        data: {},
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://api.example.com')

      expect(result.resource_id).toBe('https://api.example.com/Order/order-999')
    })

    it('maps sourceType to resource_type when present', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-1',
        sourceType: 'Customer',
        data: {},
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.resource_type).toBe('Customer')
    })

    it('sets resource_type to null when sourceType not present', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-1',
        data: {},
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.resource_type).toBeNull()
    })
  })

  // ============================================================================
  // DO-Specific Mappings
  // ============================================================================

  describe('DO-specific mappings', () => {
    it('maps verb to action_verb', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'updated',
        source: 'Customer/cust-1',
        data: {},
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.action_verb).toBe('updated')
    })
  })

  // ============================================================================
  // Timing Mappings
  // ============================================================================

  describe('timing mappings', () => {
    it('maps timestamp from input when present', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-1',
        data: {},
        timestamp: new Date('2024-01-08T14:30:00Z'),
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.timestamp).toBe('2024-01-08T14:30:00.000Z')
    })

    it('uses createdAt as timestamp when timestamp not present', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-1',
        data: {},
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.timestamp).toBe('2024-01-08T12:00:00.000Z')
    })

    it('handles string timestamps', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-1',
        data: {},
        timestamp: '2024-01-08T14:30:00Z',
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.timestamp).toBe('2024-01-08T14:30:00.000Z')
    })
  })

  // ============================================================================
  // Data Payload Mappings
  // ============================================================================

  describe('data payload mappings', () => {
    it('maps data to data field', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-1',
        data: { name: 'Alice', email: 'alice@example.com' },
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.data).toEqual({ name: 'Alice', email: 'alice@example.com' })
    })

    it('handles empty data object', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-1',
        data: {},
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.data).toEqual({})
    })

    it('handles null data', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-1',
        data: null,
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.data).toBeNull()
    })
  })

  // ============================================================================
  // Actor Mappings
  // ============================================================================

  describe('actor mappings', () => {
    it('maps actor to actor_id when present', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-1',
        data: {},
        actor: 'user-789',
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.actor_id).toBe('user-789')
    })

    it('sets actor_id to null when actor not present', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-1',
        data: {},
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.actor_id).toBeNull()
    })

    it('maps actorType to actor_type when present', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-1',
        data: {},
        actor: 'agent-123',
        actorType: 'agent',
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.actor_type).toBe('agent')
    })

    it('sets actor_type to null when actorType not present', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-1',
        data: {},
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.actor_type).toBeNull()
    })
  })

  // ============================================================================
  // EPCIS Extension Mappings
  // ============================================================================

  describe('EPCIS extension mappings', () => {
    it('maps bizStep to biz_step when present', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'shipping',
        source: 'Order/order-1',
        data: {},
        bizStep: 'urn:epcglobal:cbv:bizstep:shipping',
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.biz_step).toBe('urn:epcglobal:cbv:bizstep:shipping')
    })

    it('maps disposition to biz_disposition when present', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'shipped',
        source: 'Order/order-1',
        data: {},
        disposition: 'urn:epcglobal:cbv:disp:in_transit',
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.biz_disposition).toBe('urn:epcglobal:cbv:disp:in_transit')
    })

    it('maps bizTransaction to biz_transaction when present', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Order/order-1',
        data: {},
        bizTransaction: 'po:12345',
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.biz_transaction).toBe('po:12345')
    })

    it('maps bizLocation to biz_location when present', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'received',
        source: 'Order/order-1',
        data: {},
        bizLocation: 'urn:epc:id:sgln:0614141.00001.0',
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.biz_location).toBe('urn:epc:id:sgln:0614141.00001.0')
    })

    it('maps readPoint to biz_read_point when present', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'scanned',
        source: 'Product/prod-1',
        data: {},
        readPoint: 'urn:epc:id:sgln:0614141.00001.1',
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.biz_read_point).toBe('urn:epc:id:sgln:0614141.00001.1')
    })

    it('sets all EPCIS fields to null when not present', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-1',
        data: {},
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.biz_step).toBeNull()
      expect(result.biz_disposition).toBeNull()
      expect(result.biz_transaction).toBeNull()
      expect(result.biz_location).toBeNull()
      expect(result.biz_read_point).toBeNull()
    })
  })

  // ============================================================================
  // Complete Transformation
  // ============================================================================

  describe('complete transformation', () => {
    it('returns a valid UnifiedEvent with all required fields', () => {
      const input: DoEventInput = {
        id: 'evt-complete-123',
        verb: 'signup',
        source: 'Customer/cust-1',
        sourceType: 'Customer',
        data: { email: 'test@example.com', plan: 'pro' },
        actionId: 'action-789',
        actor: 'user-456',
        actorType: 'user',
        bizStep: 'registration',
        disposition: 'active',
        timestamp: new Date('2024-01-08T15:00:00Z'),
        createdAt: new Date('2024-01-08T14:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://app.example.com')

      // Core identity
      expect(result.id).toBeDefined()
      expect(result.event_type).toBe('track')
      expect(result.event_name).toBe('signup')
      expect(result.ns).toBe('https://app.example.com')

      // Causality
      expect(result.span_id).toBe('evt-complete-123')
      expect(result.trace_id).toBe('action-789')

      // Resource
      expect(result.resource_type).toBe('Customer')
      expect(result.resource_id).toBe('https://app.example.com/Customer/cust-1')

      // Actor
      expect(result.actor_id).toBe('user-456')
      expect(result.actor_type).toBe('user')

      // DO-specific
      expect(result.action_verb).toBe('signup')

      // Timing
      expect(result.timestamp).toBe('2024-01-08T15:00:00.000Z')

      // Data
      expect(result.data).toEqual({ email: 'test@example.com', plan: 'pro' })

      // EPCIS
      expect(result.biz_step).toBe('registration')
      expect(result.biz_disposition).toBe('active')
    })

    it('sets all other fields to null', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-1',
        data: {},
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      // Verify nullable fields are null
      expect(result.parent_id).toBeNull()
      expect(result.root_id).toBeNull()
      expect(result.session_id).toBeNull()
      expect(result.workflow_id).toBeNull()
      expect(result.transaction_id).toBeNull()
      expect(result.correlation_id).toBeNull()
      expect(result.http_method).toBeNull()
      expect(result.http_url).toBeNull()
      expect(result.geo_country).toBeNull()
      expect(result.service_name).toBeNull()
      expect(result.log_level).toBeNull()
      expect(result.metric_name).toBeNull()
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('handles source with special characters', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-with-special%20chars',
        data: {},
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.resource_id).toBe('https://example.com/Customer/cust-with-special%20chars')
    })

    it('handles ns with trailing slash', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Customer/cust-1',
        data: {},
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com/')

      // Should normalize to avoid double slashes
      expect(result.resource_id).toBe('https://example.com/Customer/cust-1')
      expect(result.ns).toBe('https://example.com')
    })

    it('handles complex nested data', () => {
      const input: DoEventInput = {
        id: 'evt-123',
        verb: 'created',
        source: 'Order/order-1',
        data: {
          items: [
            { sku: 'ABC123', qty: 2 },
            { sku: 'DEF456', qty: 1 },
          ],
          shipping: {
            address: { city: 'NYC', zip: '10001' },
            method: 'express',
          },
        },
        createdAt: new Date('2024-01-08T12:00:00Z'),
      }

      const result = transformDoEvent(input, 'https://example.com')

      expect(result.data).toEqual({
        items: [
          { sku: 'ABC123', qty: 2 },
          { sku: 'DEF456', qty: 1 },
        ],
        shipping: {
          address: { city: 'NYC', zip: '10001' },
          method: 'express',
        },
      })
    })
  })
})
