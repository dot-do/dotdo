/**
 * @dotdo/analytics - Mixpanel SDK Compat Layer Tests
 *
 * Tests for Mixpanel-compatible API.
 * Following TDD: These tests are written first and should FAIL initially.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  Mixpanel,
  createMixpanel,
  InMemoryTransport,
  _clear,
} from '../index'

describe('@dotdo/analytics/mixpanel - Mixpanel SDK Compat Layer', () => {
  beforeEach(() => {
    _clear()
  })

  // ===========================================================================
  // Mixpanel Initialization
  // ===========================================================================

  describe('Initialization', () => {
    it('should create Mixpanel instance with token', () => {
      const mixpanel = new Mixpanel({ token: 'test-token' })
      expect(mixpanel).toBeDefined()
      expect(mixpanel.token).toBe('test-token')
    })

    it('should create using factory function', () => {
      const mixpanel = createMixpanel({ token: 'test-token' })
      expect(mixpanel).toBeDefined()
    })

    it('should support debug mode', () => {
      const mixpanel = new Mixpanel({
        token: 'test-token',
        debug: true,
      })
      expect(mixpanel.debug).toBe(true)
    })

    it('should support custom API host', () => {
      const mixpanel = new Mixpanel({
        token: 'test-token',
        api_host: 'https://custom.mixpanel.com',
      })
      expect(mixpanel.config.api_host).toBe('https://custom.mixpanel.com')
    })
  })

  // ===========================================================================
  // Track API
  // ===========================================================================

  describe('Track', () => {
    it('should track events using Mixpanel format', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.track('Button Clicked', {
        button_id: 'signup',
      })

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.event).toBe('Button Clicked')
      expect(events[0]?.properties?.button_id).toBe('signup')
      expect(events[0]?.properties?.token).toBe('test-token')
    })

    it('should include distinct_id in events', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.identify('user123')
      mixpanel.track('Test')

      const events = transport.getEvents()
      expect(events.find((e) => e.event === 'Test')?.properties?.distinct_id).toBe('user123')
    })

    it('should include time property', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.track('Test')

      const events = transport.getEvents()
      expect(events[0]?.properties?.time).toBeDefined()
    })

    it('should support track with callback', async () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      const callback = vi.fn()
      mixpanel.track('Test', {}, callback)

      await mixpanel.flush()
      // Callback is called with (error, result)
      expect(callback).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Identify API
  // ===========================================================================

  describe('Identify', () => {
    it('should identify user', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.identify('user123')

      // Subsequent events should use this ID
      mixpanel.track('Test')
      const events = transport.getEvents()
      expect(events.find((e) => e.event === 'Test')?.properties?.distinct_id).toBe('user123')
    })

    it('should get distinct_id', () => {
      const mixpanel = new Mixpanel({ token: 'test-token' })

      mixpanel.identify('user123')
      expect(mixpanel.get_distinct_id()).toBe('user123')
    })
  })

  // ===========================================================================
  // Alias API
  // ===========================================================================

  describe('Alias', () => {
    it('should create alias', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.alias('new-id', 'old-id')

      const events = transport.getEvents()
      const aliasEvent = events.find((e) => e.event === '$create_alias')
      expect(aliasEvent).toBeDefined()
      expect(aliasEvent?.properties?.alias).toBe('new-id')
      expect(aliasEvent?.properties?.distinct_id).toBe('old-id')
    })

    it('should use current distinct_id if original not provided', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.identify('anon-456')
      mixpanel.alias('new-id')

      const events = transport.getEvents()
      const aliasEvent = events.find((e) => e.event === '$create_alias')
      expect(aliasEvent?.properties?.distinct_id).toBe('anon-456')
    })
  })

  // ===========================================================================
  // People API
  // ===========================================================================

  describe('People', () => {
    it('should set user properties', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.identify('user123')
      mixpanel.people.set({
        $name: 'John Doe',
        $email: 'john@example.com',
        plan: 'premium',
      })

      const events = transport.getEvents()
      const profileEvent = events.find((e) => e.$set)
      expect(profileEvent?.$set?.$name).toBe('John Doe')
      expect(profileEvent?.$set?.plan).toBe('premium')
    })

    it('should set_once user properties', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.identify('user123')
      mixpanel.people.set_once({
        first_login: '2024-01-15',
      })

      const events = transport.getEvents()
      const profileEvent = events.find((e) => e.$set_once)
      expect(profileEvent?.$set_once?.first_login).toBe('2024-01-15')
    })

    it('should increment numeric properties', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.identify('user123')
      mixpanel.people.increment('logins', 1)
      mixpanel.people.increment({ logins: 1, purchases: 5 })

      const events = transport.getEvents()
      const addEvents = events.filter((e) => e.$add)
      expect(addEvents.length).toBeGreaterThanOrEqual(1)
    })

    it('should append to list properties', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.identify('user123')
      mixpanel.people.append('tags', 'vip')

      const events = transport.getEvents()
      expect(events.find((e) => e.$append)).toBeDefined()
    })

    it('should union to list properties', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.identify('user123')
      mixpanel.people.union('categories', ['tech', 'sports'])

      const events = transport.getEvents()
      expect(events.find((e) => e.$union)).toBeDefined()
    })

    it('should remove from list properties', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.identify('user123')
      mixpanel.people.remove('categories', 'old-category')

      const events = transport.getEvents()
      expect(events.find((e) => e.$remove)).toBeDefined()
    })

    it('should unset properties', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.identify('user123')
      mixpanel.people.unset('temp_flag')

      const events = transport.getEvents()
      expect(events.find((e) => e.$unset)).toBeDefined()
    })

    it('should delete user', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.identify('user123')
      mixpanel.people.delete_user()

      const events = transport.getEvents()
      expect(events.find((e) => e.$delete)).toBeDefined()
    })

    it('should track charge (revenue)', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.identify('user123')
      mixpanel.people.track_charge(99.99, {
        product: 'Premium Plan',
      })

      const events = transport.getEvents()
      const chargeEvent = events.find((e) => e.$append?.$transactions)
      expect(chargeEvent).toBeDefined()
    })

    it('should clear charges', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.identify('user123')
      mixpanel.people.clear_charges()

      const events = transport.getEvents()
      expect(events.find((e) => e.$unset?.includes('$transactions'))).toBeDefined()
    })
  })

  // ===========================================================================
  // Group Analytics
  // ===========================================================================

  describe('Group Analytics', () => {
    it('should set group', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.set_group('company', 'company_123')

      const events = transport.getEvents()
      expect(events.find((e) => e.$set?.company)).toBeDefined()
    })

    it('should add group', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.add_group('company', 'company_456')

      const events = transport.getEvents()
      expect(events.find((e) => e.$union?.company)).toBeDefined()
    })

    it('should remove group', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.remove_group('company', 'company_123')

      const events = transport.getEvents()
      expect(events.find((e) => e.$remove?.company)).toBeDefined()
    })

    it('should get group', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      const group = mixpanel.get_group('company', 'company_123')
      expect(group).toBeDefined()
      expect(group.set).toBeDefined()
      expect(group.set_once).toBeDefined()
    })
  })

  // ===========================================================================
  // Super Properties
  // ===========================================================================

  describe('Super Properties', () => {
    it('should register super properties', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.register({
        app_version: '1.0.0',
        platform: 'web',
      })

      mixpanel.track('Test')

      const events = transport.getEvents()
      expect(events[0]?.properties?.app_version).toBe('1.0.0')
      expect(events[0]?.properties?.platform).toBe('web')
    })

    it('should register_once', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.register({ key: 'original' })
      mixpanel.register_once({ key: 'new' })

      mixpanel.track('Test')

      const events = transport.getEvents()
      expect(events[0]?.properties?.key).toBe('original')
    })

    it('should unregister', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.register({ temp: 'value' })
      mixpanel.unregister('temp')

      mixpanel.track('Test')

      const events = transport.getEvents()
      expect(events[0]?.properties?.temp).toBeUndefined()
    })

    it('should get property', () => {
      const mixpanel = new Mixpanel({ token: 'test-token' })

      mixpanel.register({ key: 'value' })
      expect(mixpanel.get_property('key')).toBe('value')
    })
  })

  // ===========================================================================
  // Time Events
  // ===========================================================================

  describe('Time Events', () => {
    it('should time event', async () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.time_event('Checkout')

      await new Promise((resolve) => setTimeout(resolve, 50))

      mixpanel.track('Checkout')

      const events = transport.getEvents()
      // Mixpanel uses seconds for duration, not milliseconds
      expect(events[0]?.properties?.$duration).toBeGreaterThanOrEqual(0.05)
    })
  })

  // ===========================================================================
  // Opt-out
  // ===========================================================================

  describe('Opt-out', () => {
    it('should opt out of tracking', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.opt_out_tracking()
      mixpanel.track('Should Not Track')

      expect(transport.getEvents()).toHaveLength(0)
    })

    it('should opt in to tracking', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.opt_out_tracking()
      mixpanel.opt_in_tracking()
      mixpanel.track('Should Track')

      expect(transport.getEvents()).toHaveLength(1)
    })

    it('should check opt-out status', () => {
      const mixpanel = new Mixpanel({ token: 'test-token' })

      expect(mixpanel.has_opted_out_tracking()).toBe(false)
      mixpanel.opt_out_tracking()
      expect(mixpanel.has_opted_out_tracking()).toBe(true)
    })

    it('should clear data on opt-out', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.identify('user123')
      mixpanel.register({ key: 'value' })
      mixpanel.opt_out_tracking({ clear_persistence: true })

      mixpanel.opt_in_tracking()
      expect(mixpanel.get_distinct_id()).not.toBe('user123')
    })
  })

  // ===========================================================================
  // Reset
  // ===========================================================================

  describe('Reset', () => {
    it('should reset state', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.identify('user123')
      mixpanel.register({ key: 'value' })
      mixpanel.reset()

      mixpanel.track('Test')

      const events = transport.getEvents()
      expect(events[0]?.properties?.distinct_id).not.toBe('user123')
      expect(events[0]?.properties?.key).toBeUndefined()
    })
  })

  // ===========================================================================
  // Batch/Flush
  // ===========================================================================

  describe('Batch/Flush', () => {
    it('should flush events', async () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
        batch_size: 100,
      })

      mixpanel.track('Event 1')
      mixpanel.track('Event 2')

      await mixpanel.flush()

      expect(transport.getBatches().length).toBeGreaterThanOrEqual(1)
    })
  })
})
