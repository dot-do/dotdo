/**
 * @dotdo/analytics - PostHog SDK Compat Layer Tests
 *
 * Tests for PostHog-compatible API.
 * Following TDD: These tests are written first and should FAIL initially.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  PostHog,
  createPostHog,
  InMemoryTransport,
  _clear,
} from '../index'

describe('@dotdo/analytics/posthog - PostHog SDK Compat Layer', () => {
  beforeEach(() => {
    _clear()
  })

  // ===========================================================================
  // PostHog Initialization
  // ===========================================================================

  describe('Initialization', () => {
    it('should create PostHog instance with API key', () => {
      const posthog = new PostHog({ apiKey: 'phc_test_key' })
      expect(posthog).toBeDefined()
      expect(posthog.apiKey).toBe('phc_test_key')
    })

    it('should create using factory function', () => {
      const posthog = createPostHog({ apiKey: 'phc_test_key' })
      expect(posthog).toBeDefined()
    })

    it('should support custom host', () => {
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        host: 'https://custom.posthog.com',
      })
      expect(posthog.config.host).toBe('https://custom.posthog.com')
    })

    it('should support persistence configuration', () => {
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        persistence: 'localStorage',
      })
      expect(posthog.config.persistence).toBe('localStorage')
    })
  })

  // ===========================================================================
  // Capture API (PostHog's track equivalent)
  // ===========================================================================

  describe('Capture', () => {
    it('should capture events', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.capture('Button Clicked', {
        button_id: 'signup',
      })

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.event).toBe('Button Clicked')
      expect(events[0]?.properties?.button_id).toBe('signup')
    })

    it('should include distinct_id', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.identify('user123')
      posthog.capture('Test')

      const events = transport.getEvents()
      expect(events.find((e) => e.event === 'Test')?.distinct_id).toBe('user123')
    })

    it('should include timestamp', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.capture('Test')

      const events = transport.getEvents()
      expect(events[0]?.timestamp).toBeDefined()
    })

    it('should include $lib information', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.capture('Test')

      const events = transport.getEvents()
      expect(events[0]?.properties?.$lib).toBeDefined()
    })
  })

  // ===========================================================================
  // Identify API
  // ===========================================================================

  describe('Identify', () => {
    it('should identify user', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.identify('user123', {
        name: 'John Doe',
        email: 'john@example.com',
      })

      const events = transport.getEvents()
      const identifyEvent = events.find((e) => e.event === '$identify')
      expect(identifyEvent?.distinct_id).toBe('user123')
      expect(identifyEvent?.$set?.name).toBe('John Doe')
    })

    it('should set $set_once properties', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.identify('user123', {}, {
        first_seen: '2024-01-15',
      })

      const events = transport.getEvents()
      const identifyEvent = events.find((e) => e.event === '$identify')
      expect(identifyEvent?.$set_once?.first_seen).toBe('2024-01-15')
    })

    it('should get distinct_id', () => {
      const posthog = new PostHog({ apiKey: 'phc_test_key' })

      posthog.identify('user123')
      expect(posthog.get_distinct_id()).toBe('user123')
    })
  })

  // ===========================================================================
  // Alias API
  // ===========================================================================

  describe('Alias', () => {
    it('should create alias', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.alias('new-id', 'old-id')

      const events = transport.getEvents()
      const aliasEvent = events.find((e) => e.event === '$create_alias')
      expect(aliasEvent?.properties?.alias).toBe('new-id')
      expect(aliasEvent?.distinct_id).toBe('old-id')
    })
  })

  // ===========================================================================
  // Group API
  // ===========================================================================

  describe('Group', () => {
    it('should set group', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.group('company', 'company_123', {
        name: 'Acme Inc',
        employees: 100,
      })

      const events = transport.getEvents()
      const groupEvent = events.find((e) => e.event === '$groupidentify')
      expect(groupEvent?.$group_type).toBe('company')
      expect(groupEvent?.$group_key).toBe('company_123')
      expect(groupEvent?.$group_set?.name).toBe('Acme Inc')
    })

    it('should reset groups', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.group('company', 'company_123')
      posthog.resetGroups()

      posthog.capture('Test')

      const events = transport.getEvents()
      const trackEvent = events.find((e) => e.event === 'Test')
      expect(trackEvent?.properties?.$groups?.company).toBeUndefined()
    })
  })

  // ===========================================================================
  // Person Properties
  // ===========================================================================

  describe('Person Properties', () => {
    it('should set person properties', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.setPersonProperties({
        name: 'John Doe',
        plan: 'premium',
      })

      const events = transport.getEvents()
      expect(events.find((e) => e.$set?.name === 'John Doe')).toBeDefined()
    })

    it('should set person properties once', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.setPersonPropertiesForFlags({
        first_login: '2024-01-15',
      })

      // These are set locally for flag evaluation
      expect(posthog.getPersonProperties().first_login).toBe('2024-01-15')
    })
  })

  // ===========================================================================
  // Feature Flags
  // ===========================================================================

  describe('Feature Flags', () => {
    it('should check if feature is enabled', () => {
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        bootstrap: {
          featureFlags: {
            'new-checkout': true,
            'dark-mode': false,
          },
        },
      })

      expect(posthog.isFeatureEnabled('new-checkout')).toBe(true)
      expect(posthog.isFeatureEnabled('dark-mode')).toBe(false)
      expect(posthog.isFeatureEnabled('unknown')).toBe(false)
    })

    it('should get feature flag value', () => {
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        bootstrap: {
          featureFlags: {
            'button-color': 'blue',
          },
        },
      })

      expect(posthog.getFeatureFlag('button-color')).toBe('blue')
    })

    it('should get feature flag payload', () => {
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        bootstrap: {
          featureFlags: {
            'pricing-experiment': 'variant-a',
          },
          featureFlagPayloads: {
            'pricing-experiment': { price: 9.99, discount: 0.1 },
          },
        },
      })

      expect(posthog.getFeatureFlagPayload('pricing-experiment')).toEqual({
        price: 9.99,
        discount: 0.1,
      })
    })

    it('should reload feature flags', async () => {
      const posthog = new PostHog({ apiKey: 'phc_test_key' })

      posthog.identify('user123')
      await posthog.reloadFeatureFlags()

      // Should make a request to reload flags
      expect(posthog.getFeatureFlagsAndPayloads).toBeDefined()
    })

    it('should callback on feature flag loaded', async () => {
      const posthog = new PostHog({ apiKey: 'phc_test_key' })

      const callback = vi.fn()
      posthog.onFeatureFlags(callback)

      // Trigger flag load
      await posthog.reloadFeatureFlags()

      expect(callback).toHaveBeenCalled()
    })

    it('should get all feature flags', () => {
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        bootstrap: {
          featureFlags: {
            'flag-1': true,
            'flag-2': 'variant-b',
          },
        },
      })

      const flags = posthog.getAllFlags()
      expect(flags).toEqual({
        'flag-1': true,
        'flag-2': 'variant-b',
      })
    })
  })

  // ===========================================================================
  // Page/Screen Views
  // ===========================================================================

  describe('Page/Screen Views', () => {
    it('should capture pageview', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.capture('$pageview', {
        $current_url: 'https://example.com/page',
        $referrer: 'https://google.com',
      })

      const events = transport.getEvents()
      expect(events[0]?.event).toBe('$pageview')
      expect(events[0]?.properties?.$current_url).toBe('https://example.com/page')
    })

    it('should capture screen (mobile)', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.screen('Dashboard', {
        section: 'Overview',
      })

      const events = transport.getEvents()
      expect(events[0]?.event).toBe('$screen')
      expect(events[0]?.properties?.$screen_name).toBe('Dashboard')
    })
  })

  // ===========================================================================
  // Super Properties
  // ===========================================================================

  describe('Super Properties', () => {
    it('should register super properties', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.register({
        app_version: '1.0.0',
        platform: 'web',
      })

      posthog.capture('Test')

      const events = transport.getEvents()
      expect(events[0]?.properties?.app_version).toBe('1.0.0')
      expect(events[0]?.properties?.platform).toBe('web')
    })

    it('should register once', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.register({ key: 'original' })
      posthog.register_once({ key: 'new' })

      posthog.capture('Test')

      const events = transport.getEvents()
      expect(events[0]?.properties?.key).toBe('original')
    })

    it('should unregister', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.register({ temp: 'value' })
      posthog.unregister('temp')

      posthog.capture('Test')

      const events = transport.getEvents()
      expect(events[0]?.properties?.temp).toBeUndefined()
    })
  })

  // ===========================================================================
  // Opt Out
  // ===========================================================================

  describe('Opt Out', () => {
    it('should opt out of capturing', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.opt_out_capturing()
      posthog.capture('Should Not Track')

      expect(transport.getEvents()).toHaveLength(0)
    })

    it('should opt in to capturing', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.opt_out_capturing()
      posthog.opt_in_capturing()
      posthog.capture('Should Track')

      expect(transport.getEvents()).toHaveLength(1)
    })

    it('should check opt-out status', () => {
      const posthog = new PostHog({ apiKey: 'phc_test_key' })

      expect(posthog.has_opted_out_capturing()).toBe(false)
      posthog.opt_out_capturing()
      expect(posthog.has_opted_out_capturing()).toBe(true)
    })
  })

  // ===========================================================================
  // Reset
  // ===========================================================================

  describe('Reset', () => {
    it('should reset state', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.identify('user123')
      posthog.register({ key: 'value' })
      posthog.reset()

      posthog.capture('Test')

      const events = transport.getEvents()
      // Last event (after reset) should have new anonymous ID
      const lastEvent = events[events.length - 1]
      expect(lastEvent?.distinct_id).not.toBe('user123')
      expect(lastEvent?.properties?.key).toBeUndefined()
    })
  })

  // ===========================================================================
  // Session Recording (Stubs)
  // ===========================================================================

  describe('Session Recording', () => {
    it('should have session recording methods', () => {
      const posthog = new PostHog({ apiKey: 'phc_test_key' })

      expect(posthog.startSessionRecording).toBeDefined()
      expect(posthog.stopSessionRecording).toBeDefined()
      expect(posthog.isSessionRecordingActive).toBeDefined()
    })

    it('should return session ID', () => {
      const posthog = new PostHog({ apiKey: 'phc_test_key' })

      // Session recording is a stub in edge environment
      expect(posthog.getSessionId()).toBeDefined()
    })
  })

  // ===========================================================================
  // Surveys (Stubs)
  // ===========================================================================

  describe('Surveys', () => {
    it('should have survey methods', () => {
      const posthog = new PostHog({ apiKey: 'phc_test_key' })

      expect(posthog.getActiveMatchingSurveys).toBeDefined()
      expect(posthog.getSurveys).toBeDefined()
    })
  })

  // ===========================================================================
  // Flush
  // ===========================================================================

  describe('Flush', () => {
    it('should flush events', async () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
        flushAt: 100,
      })

      posthog.capture('Event 1')
      posthog.capture('Event 2')

      await posthog.flush()

      expect(transport.getBatches().length).toBeGreaterThanOrEqual(1)
    })
  })

  // ===========================================================================
  // Debug
  // ===========================================================================

  describe('Debug', () => {
    it('should enable debug mode', () => {
      const posthog = new PostHog({ apiKey: 'phc_test_key' })

      posthog.debug()
      expect(posthog.config.debug).toBe(true)
    })

    it('should disable debug mode', () => {
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        debug: true,
      })

      posthog.debug(false)
      expect(posthog.config.debug).toBe(false)
    })
  })

  // ===========================================================================
  // Shutdown
  // ===========================================================================

  describe('Shutdown', () => {
    it('should shutdown and flush', async () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
        flushAt: 100,
      })

      posthog.capture('Final Event')

      await posthog.shutdown()

      expect(transport.getBatches()).toHaveLength(1)
    })
  })
})
