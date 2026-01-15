/**
 * @fileoverview Tests for matchesTopic utility function
 *
 * TDD RED Phase - These tests should FAIL until the shared module is created.
 *
 * The matchesTopic function supports:
 * - Exact match: "orders" matches "orders"
 * - Global wildcard: "*" matches everything
 * - Single-level wildcard: "orders.*" matches "orders.created" but not "orders.item.added"
 * - Multi-level wildcard: "orders.**" matches "orders.created" and "orders.item.added"
 */

import { describe, it, expect } from 'vitest'
import { matchesTopic } from './topic-matcher'

describe('matchesTopic', () => {
  // ==========================================================================
  // EXACT MATCH
  // ==========================================================================
  describe('exact match', () => {
    it('should return true for identical strings', () => {
      expect(matchesTopic('orders', 'orders')).toBe(true)
    })

    it('should return true for multi-part identical strings', () => {
      expect(matchesTopic('orders.created', 'orders.created')).toBe(true)
    })

    it('should return false for non-matching strings', () => {
      expect(matchesTopic('orders', 'customers')).toBe(false)
    })

    it('should be case-sensitive', () => {
      expect(matchesTopic('Orders', 'orders')).toBe(false)
    })
  })

  // ==========================================================================
  // GLOBAL WILDCARD (*)
  // ==========================================================================
  describe('global wildcard (*)', () => {
    it('should match any single-part topic', () => {
      expect(matchesTopic('*', 'orders')).toBe(true)
    })

    it('should match any multi-part topic', () => {
      expect(matchesTopic('*', 'orders.created')).toBe(true)
    })

    it('should match deeply nested topics', () => {
      expect(matchesTopic('*', 'orders.item.added.confirmed')).toBe(true)
    })

    it('should match empty string topic', () => {
      expect(matchesTopic('*', '')).toBe(true)
    })
  })

  // ==========================================================================
  // SINGLE-LEVEL WILDCARD (.*)
  // ==========================================================================
  describe('single-level wildcard (.*)', () => {
    it('should match topic with exactly one level after prefix', () => {
      expect(matchesTopic('orders.*', 'orders.created')).toBe(true)
    })

    it('should match different single-level suffixes', () => {
      expect(matchesTopic('orders.*', 'orders.updated')).toBe(true)
      expect(matchesTopic('orders.*', 'orders.deleted')).toBe(true)
    })

    it('should NOT match topics with multiple levels after prefix', () => {
      expect(matchesTopic('orders.*', 'orders.item.added')).toBe(false)
    })

    it('should NOT match exact prefix (no suffix)', () => {
      expect(matchesTopic('orders.*', 'orders')).toBe(false)
    })

    it('should NOT match topics that share prefix but are different roots', () => {
      expect(matchesTopic('orders.*', 'ordersXYZ.created')).toBe(false)
    })

    it('should work with multi-part prefixes', () => {
      expect(matchesTopic('system.events.*', 'system.events.started')).toBe(true)
      expect(matchesTopic('system.events.*', 'system.events.sub.topic')).toBe(false)
    })
  })

  // ==========================================================================
  // MULTI-LEVEL WILDCARD (.**)
  // ==========================================================================
  describe('multi-level wildcard (.**)', () => {
    it('should match exact prefix', () => {
      expect(matchesTopic('orders.**', 'orders')).toBe(true)
    })

    it('should match topic with one level after prefix', () => {
      expect(matchesTopic('orders.**', 'orders.created')).toBe(true)
    })

    it('should match topic with multiple levels after prefix', () => {
      expect(matchesTopic('orders.**', 'orders.item.added')).toBe(true)
    })

    it('should match deeply nested topics', () => {
      expect(matchesTopic('orders.**', 'orders.a.b.c.d.e')).toBe(true)
    })

    it('should NOT match topics that share prefix but are different roots', () => {
      expect(matchesTopic('orders.**', 'ordersXYZ')).toBe(false)
      expect(matchesTopic('orders.**', 'ordersXYZ.created')).toBe(false)
    })

    it('should work with multi-part prefixes', () => {
      expect(matchesTopic('system.events.**', 'system.events')).toBe(true)
      expect(matchesTopic('system.events.**', 'system.events.started')).toBe(true)
      expect(matchesTopic('system.events.**', 'system.events.sub.topic')).toBe(true)
    })
  })

  // ==========================================================================
  // NO MATCH CASES
  // ==========================================================================
  describe('no match', () => {
    it('should return false for completely different topics', () => {
      expect(matchesTopic('orders', 'users')).toBe(false)
    })

    it('should return false when pattern is more specific than topic', () => {
      expect(matchesTopic('orders.created', 'orders')).toBe(false)
    })

    it('should return false for partial prefix matches without wildcards', () => {
      expect(matchesTopic('ord', 'orders')).toBe(false)
    })

    it('should return false when topic is longer without wildcard support', () => {
      expect(matchesTopic('orders', 'orders.created')).toBe(false)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================
  describe('edge cases', () => {
    it('should handle empty pattern', () => {
      expect(matchesTopic('', '')).toBe(true)
      expect(matchesTopic('', 'orders')).toBe(false)
    })

    it('should handle empty topic', () => {
      expect(matchesTopic('orders', '')).toBe(false)
    })

    it('should handle pattern with only dots', () => {
      expect(matchesTopic('.', '.')).toBe(true)
      expect(matchesTopic('..', '..')).toBe(true)
    })

    it('should handle topics with leading/trailing dots', () => {
      expect(matchesTopic('.orders', '.orders')).toBe(true)
      expect(matchesTopic('orders.', 'orders.')).toBe(true)
    })

    it('should handle wildcard at root level', () => {
      expect(matchesTopic('.*', '.test')).toBe(true)
      expect(matchesTopic('.**', '')).toBe(true)
    })

    it('should handle consecutive dots in pattern', () => {
      expect(matchesTopic('a..b', 'a..b')).toBe(true)
    })

    it('should handle special characters in topics', () => {
      expect(matchesTopic('orders-v2', 'orders-v2')).toBe(true)
      expect(matchesTopic('orders_v2', 'orders_v2')).toBe(true)
      expect(matchesTopic('orders:created', 'orders:created')).toBe(true)
    })

    it('should handle numeric topics', () => {
      expect(matchesTopic('123', '123')).toBe(true)
      expect(matchesTopic('123.*', '123.456')).toBe(true)
    })

    it('should handle unicode characters', () => {
      expect(matchesTopic('orders', 'orders')).toBe(true)
    })

    it('should NOT treat internal wildcards as special', () => {
      // Wildcards only have meaning at the end of patterns
      expect(matchesTopic('orders.*.created', 'orders.item.created')).toBe(false)
      expect(matchesTopic('orders.**.created', 'orders.item.created')).toBe(false)
    })
  })

  // ==========================================================================
  // ARGUMENT ORDER
  // ==========================================================================
  describe('argument order', () => {
    it('should treat first argument as pattern, second as topic', () => {
      // Pattern with wildcard should match topic
      expect(matchesTopic('orders.*', 'orders.created')).toBe(true)
      // Topic with wildcard should NOT match pattern (wildcard is literal in topic)
      expect(matchesTopic('orders.created', 'orders.*')).toBe(false)
    })
  })
})
