/**
 * @dotdo/mixpanel - Mixpanel SDK Compat Layer Tests
 *
 * Comprehensive tests for the Mixpanel SDK compatibility layer.
 * Following TDD RED-GREEN-REFACTOR: These tests are written first.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Core classes
  Mixpanel,
  init,

  // InMemory transport for testing
  InMemoryTransport,

  // Types
  type MixpanelConfig,
  type TrackProperties,
  type PeopleProperties,
} from '../index'

describe('@dotdo/mixpanel - Mixpanel SDK Compat Layer', () => {
  // ===========================================================================
  // Initialization
  // ===========================================================================

  describe('Initialization', () => {
    it('should initialize with token', () => {
      const mixpanel = init('test-token')
      expect(mixpanel).toBeDefined()
      expect(mixpanel.token).toBe('test-token')
    })

    it('should accept configuration options', () => {
      const mixpanel = new Mixpanel({
        token: 'test-token',
        host: 'https://custom.mixpanel.com',
        debug: true,
      })
      expect(mixpanel.config.host).toBe('https://custom.mixpanel.com')
      expect(mixpanel.config.debug).toBe(true)
    })

    it('should have default configuration values', () => {
      const mixpanel = new Mixpanel({ token: 'test-token' })
      expect(mixpanel.config.host).toBe('https://api.mixpanel.com')
      expect(mixpanel.config.trackPath).toBe('/track')
      expect(mixpanel.config.engagePath).toBe('/engage')
    })

    it('should require token', () => {
      expect(() => new Mixpanel({ token: '' })).toThrow()
    })
  })

  // ===========================================================================
  // Track Events
  // ===========================================================================

  describe('Track', () => {
    it('should track an event with distinct_id', async () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport,
      })

      await mixpanel.track('Button Clicked', {
        distinct_id: 'user123',
        button_name: 'signup',
      })

      const events = transport.getTrackEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.event).toBe('Button Clicked')
      expect(events[0]?.properties.distinct_id).toBe('user123')
      expect(events[0]?.properties.button_name).toBe('signup')
    })

    it('should auto-generate $insert_id for deduplication', async () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport,
      })

      await mixpanel.track('Test Event', { distinct_id: 'u1' })

      const events = transport.getTrackEvents()
      expect(events[0]?.properties.$insert_id).toBeDefined()
      expect(typeof events[0]?.properties.$insert_id).toBe('string')
    })

    it('should auto-add timestamp', async () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport,
      })

      const before = Math.floor(Date.now() / 1000)
      await mixpanel.track('Test Event', { distinct_id: 'u1' })
      const after = Math.floor(Date.now() / 1000)

      const events = transport.getTrackEvents()
      expect(events[0]?.properties.time).toBeDefined()
      expect(events[0]?.properties.time).toBeGreaterThanOrEqual(before)
      expect(events[0]?.properties.time).toBeLessThanOrEqual(after)
    })

    it('should include token in properties', async () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport,
      })

      await mixpanel.track('Test Event', { distinct_id: 'u1' })

      const events = transport.getTrackEvents()
      expect(events[0]?.properties.token).toBe('test-token')
    })

    it('should support callback', async () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport,
      })

      const callback = vi.fn()
      await mixpanel.track('Test Event', { distinct_id: 'u1' }, callback)

      expect(callback).toHaveBeenCalled()
    })

    it('should require distinct_id', async () => {
      const mixpanel = new Mixpanel({ token: 'test-token' })

      await expect(mixpanel.track('Test Event', {})).rejects.toThrow()
    })
  })

  // ===========================================================================
  // People (User Profiles)
  // ===========================================================================

  describe('People', () => {
    describe('set', () => {
      it('should set user properties', async () => {
        const transport = new InMemoryTransport()
        const mixpanel = new Mixpanel({
          token: 'test-token',
          transport,
        })

        await mixpanel.people.set('user123', {
          $email: 'john@example.com',
          $name: 'John Doe',
          plan: 'premium',
        })

        const updates = transport.getEngageUpdates()
        expect(updates).toHaveLength(1)
        expect(updates[0]?.$distinct_id).toBe('user123')
        expect(updates[0]?.$set?.$email).toBe('john@example.com')
        expect(updates[0]?.$set?.$name).toBe('John Doe')
        expect(updates[0]?.$set?.plan).toBe('premium')
      })

      it('should set single property', async () => {
        const transport = new InMemoryTransport()
        const mixpanel = new Mixpanel({
          token: 'test-token',
          transport,
        })

        await mixpanel.people.set('user123', 'plan', 'enterprise')

        const updates = transport.getEngageUpdates()
        expect(updates[0]?.$set?.plan).toBe('enterprise')
      })
    })

    describe('set_once', () => {
      it('should set properties only once', async () => {
        const transport = new InMemoryTransport()
        const mixpanel = new Mixpanel({
          token: 'test-token',
          transport,
        })

        await mixpanel.people.set_once('user123', {
          $created: '2026-01-01',
          signup_source: 'organic',
        })

        const updates = transport.getEngageUpdates()
        expect(updates[0]?.$set_once?.$created).toBe('2026-01-01')
        expect(updates[0]?.$set_once?.signup_source).toBe('organic')
      })
    })

    describe('increment', () => {
      it('should increment numeric properties', async () => {
        const transport = new InMemoryTransport()
        const mixpanel = new Mixpanel({
          token: 'test-token',
          transport,
        })

        await mixpanel.people.increment('user123', {
          login_count: 1,
          points: 100,
        })

        const updates = transport.getEngageUpdates()
        expect(updates[0]?.$add?.login_count).toBe(1)
        expect(updates[0]?.$add?.points).toBe(100)
      })

      it('should increment single property with default value 1', async () => {
        const transport = new InMemoryTransport()
        const mixpanel = new Mixpanel({
          token: 'test-token',
          transport,
        })

        await mixpanel.people.increment('user123', 'login_count')

        const updates = transport.getEngageUpdates()
        expect(updates[0]?.$add?.login_count).toBe(1)
      })
    })

    describe('append', () => {
      it('should append to list properties', async () => {
        const transport = new InMemoryTransport()
        const mixpanel = new Mixpanel({
          token: 'test-token',
          transport,
        })

        await mixpanel.people.append('user123', {
          viewed_products: 'prod_123',
        })

        const updates = transport.getEngageUpdates()
        expect(updates[0]?.$append?.viewed_products).toBe('prod_123')
      })
    })

    describe('union', () => {
      it('should union with list properties', async () => {
        const transport = new InMemoryTransport()
        const mixpanel = new Mixpanel({
          token: 'test-token',
          transport,
        })

        await mixpanel.people.union('user123', {
          tags: ['vip', 'beta'],
        })

        const updates = transport.getEngageUpdates()
        expect(updates[0]?.$union?.tags).toEqual(['vip', 'beta'])
      })
    })

    describe('remove', () => {
      it('should remove from list properties', async () => {
        const transport = new InMemoryTransport()
        const mixpanel = new Mixpanel({
          token: 'test-token',
          transport,
        })

        await mixpanel.people.remove('user123', {
          tags: 'inactive',
        })

        const updates = transport.getEngageUpdates()
        expect(updates[0]?.$remove?.tags).toBe('inactive')
      })
    })

    describe('unset', () => {
      it('should unset properties', async () => {
        const transport = new InMemoryTransport()
        const mixpanel = new Mixpanel({
          token: 'test-token',
          transport,
        })

        await mixpanel.people.unset('user123', ['temporary_flag', 'old_property'])

        const updates = transport.getEngageUpdates()
        expect(updates[0]?.$unset).toEqual(['temporary_flag', 'old_property'])
      })

      it('should unset single property', async () => {
        const transport = new InMemoryTransport()
        const mixpanel = new Mixpanel({
          token: 'test-token',
          transport,
        })

        await mixpanel.people.unset('user123', 'deprecated_field')

        const updates = transport.getEngageUpdates()
        expect(updates[0]?.$unset).toEqual(['deprecated_field'])
      })
    })

    describe('deleteUser', () => {
      it('should delete user profile', async () => {
        const transport = new InMemoryTransport()
        const mixpanel = new Mixpanel({
          token: 'test-token',
          transport,
        })

        await mixpanel.people.deleteUser('user123')

        const updates = transport.getEngageUpdates()
        expect(updates[0]?.$delete).toBe(true)
      })
    })

    describe('track_charge', () => {
      it('should track revenue', async () => {
        const transport = new InMemoryTransport()
        const mixpanel = new Mixpanel({
          token: 'test-token',
          transport,
        })

        await mixpanel.people.track_charge('user123', 29.99, {
          product_id: 'premium_plan',
        })

        const updates = transport.getEngageUpdates()
        expect(updates[0]?.$append?.$transactions).toBeDefined()
        const transaction = updates[0]?.$append?.$transactions as Record<string, unknown>
        expect(transaction.$amount).toBe(29.99)
        expect(transaction.product_id).toBe('premium_plan')
      })
    })

    describe('clear_charges', () => {
      it('should clear all charges', async () => {
        const transport = new InMemoryTransport()
        const mixpanel = new Mixpanel({
          token: 'test-token',
          transport,
        })

        await mixpanel.people.clear_charges('user123')

        const updates = transport.getEngageUpdates()
        expect(updates[0]?.$set?.$transactions).toEqual([])
      })
    })
  })

  // ===========================================================================
  // Groups
  // ===========================================================================

  describe('Groups', () => {
    it('should set group properties', async () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport,
      })

      await mixpanel.groups.set('company', 'acme-inc', {
        $name: 'Acme Inc',
        industry: 'Technology',
      })

      const updates = transport.getGroupUpdates()
      expect(updates).toHaveLength(1)
      expect(updates[0]?.$group_key).toBe('company')
      expect(updates[0]?.$group_id).toBe('acme-inc')
      expect(updates[0]?.$set?.$name).toBe('Acme Inc')
    })

    it('should set_once group properties', async () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport,
      })

      await mixpanel.groups.set_once('company', 'acme-inc', {
        $created: '2026-01-01',
      })

      const updates = transport.getGroupUpdates()
      expect(updates[0]?.$set_once?.$created).toBe('2026-01-01')
    })

    it('should delete group', async () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport,
      })

      await mixpanel.groups.deleteGroup('company', 'acme-inc')

      const updates = transport.getGroupUpdates()
      expect(updates[0]?.$delete).toBe(true)
    })
  })

  // ===========================================================================
  // Alias
  // ===========================================================================

  describe('Alias', () => {
    it('should alias distinct IDs', async () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport,
      })

      await mixpanel.alias('user123', 'anon-456')

      const events = transport.getTrackEvents()
      expect(events[0]?.event).toBe('$create_alias')
      expect(events[0]?.properties.distinct_id).toBe('anon-456')
      expect(events[0]?.properties.alias).toBe('user123')
    })
  })

  // ===========================================================================
  // Import (Historical Data)
  // ===========================================================================

  describe('Import', () => {
    it('should import historical events', async () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        secret: 'test-secret',
        transport,
      })

      await mixpanel.import('Historical Event', {
        distinct_id: 'user123',
        time: 1609459200, // 2021-01-01
        property: 'value',
      })

      const imports = transport.getImports()
      expect(imports).toHaveLength(1)
      expect(imports[0]?.event).toBe('Historical Event')
      expect(imports[0]?.properties.time).toBe(1609459200)
    })

    it('should batch import multiple events', async () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        secret: 'test-secret',
        transport,
      })

      await mixpanel.import_batch([
        { event: 'Event 1', properties: { distinct_id: 'u1', time: 1609459200 } },
        { event: 'Event 2', properties: { distinct_id: 'u2', time: 1609459300 } },
      ])

      const imports = transport.getImports()
      expect(imports).toHaveLength(2)
    })
  })

  // ===========================================================================
  // Batching
  // ===========================================================================

  describe('Batching', () => {
    it('should batch track events', async () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport,
        batch: true,
        batchSize: 10,
      })

      // Track multiple events
      await mixpanel.track('Event 1', { distinct_id: 'u1' })
      await mixpanel.track('Event 2', { distinct_id: 'u2' })
      await mixpanel.track('Event 3', { distinct_id: 'u3' })

      // Manually flush
      await mixpanel.flush()

      const batches = transport.getBatches()
      expect(batches).toHaveLength(1)
      expect(batches[0]?.length).toBe(3)
    })

    it('should auto-flush when batch size reached', async () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport,
        batch: true,
        batchSize: 2,
      })

      await mixpanel.track('Event 1', { distinct_id: 'u1' })
      await mixpanel.track('Event 2', { distinct_id: 'u2' })

      // Should have auto-flushed
      await new Promise((r) => setTimeout(r, 50))
      expect(transport.getBatches()).toHaveLength(1)
    })
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should handle transport errors gracefully', async () => {
      const failingTransport = {
        track: vi.fn().mockRejectedValue(new Error('Network error')),
        engage: vi.fn().mockRejectedValue(new Error('Network error')),
        groups: vi.fn().mockRejectedValue(new Error('Network error')),
        getTrackEvents: () => [],
        getEngageUpdates: () => [],
        getGroupUpdates: () => [],
        getImports: () => [],
        getBatches: () => [],
      }

      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: failingTransport as any,
      })

      // Should not throw (errors are passed to callback)
      const callback = vi.fn()
      await mixpanel.track('Test', { distinct_id: 'u1' }, callback)

      expect(callback).toHaveBeenCalledWith(expect.any(Error))
    })
  })

  // ===========================================================================
  // Library Context
  // ===========================================================================

  describe('Library Context', () => {
    it('should include library info in events', async () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport,
      })

      await mixpanel.track('Test', { distinct_id: 'u1' })

      const events = transport.getTrackEvents()
      expect(events[0]?.properties.$lib_version).toBeDefined()
    })
  })

  // ===========================================================================
  // Distinct ID Management
  // ===========================================================================

  describe('Distinct ID', () => {
    it('should set default distinct_id', async () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport,
      })

      mixpanel.identify('default-user-123')

      // Track without distinct_id should use the identified user
      await mixpanel.track('Test', {})

      const events = transport.getTrackEvents()
      expect(events[0]?.properties.distinct_id).toBe('default-user-123')
    })

    it('should reset identity', async () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport,
      })

      mixpanel.identify('user-123')
      mixpanel.reset()

      // After reset, should require distinct_id
      await expect(mixpanel.track('Test', {})).rejects.toThrow()
    })
  })
})
