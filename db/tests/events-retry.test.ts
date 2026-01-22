/**
 * Events Retry Metrics Tests (do-7wcm.3)
 *
 * TDD tests for retry tracking functionality:
 * - Track retry attempts per event
 * - Record last error
 * - Calculate retry success rate
 * - Exponential backoff timing (durability config)
 *
 * RED: Write failing tests
 * GREEN: Verify implementation passes
 * REFACTOR: Extract metrics to separate module if needed
 *
 * @module db/tests/events-retry.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createEventsStore,
  createEventsStoreWithAdapter,
  type EventsStore,
  type EventRetryStatus,
  type RetryMetrics,
  type DurabilityConfig
} from '../events'
import { createMemoryStorageAdapter } from '../adapters/memory'

describe('Events Retry Metrics (do-7wcm.3)', () => {
  let events: EventsStore

  beforeEach(() => {
    events = createEventsStore()
  })

  describe('Event Retry Status Tracking', () => {
    it('should track retry attempts per event', async () => {
      const event = await events.emit({
        type: 'Order.process',
        payload: { orderId: '123' }
      })

      // Set retry status after first attempt
      events.setEventRetryStatus(event.$id, {
        attempts: 1,
        succeeded: false,
        lastAttempt: Date.now(),
        errors: ['NetworkError: Connection timeout']
      })

      const status = events.getEventRetryStatus(event.$id)
      expect(status).toBeDefined()
      expect(status?.attempts).toBe(1)
      expect(status?.succeeded).toBe(false)
      expect(status?.errors).toContain('NetworkError: Connection timeout')
    })

    it('should update retry status on subsequent attempts', async () => {
      const event = await events.emit({
        type: 'Payment.charge',
        payload: { amount: 100 }
      })

      // First attempt fails
      events.setEventRetryStatus(event.$id, {
        attempts: 1,
        succeeded: false,
        lastAttempt: Date.now() - 1000,
        errors: ['TimeoutError: Gateway timeout']
      })

      // Second attempt also fails
      events.setEventRetryStatus(event.$id, {
        attempts: 2,
        succeeded: false,
        lastAttempt: Date.now(),
        errors: ['TimeoutError: Gateway timeout', 'NetworkError: Retry failed']
      })

      const status = events.getEventRetryStatus(event.$id)
      expect(status?.attempts).toBe(2)
      expect(status?.errors?.length).toBe(2)
    })

    it('should mark event as succeeded after successful retry', async () => {
      const event = await events.emit({
        type: 'Email.send',
        payload: { to: 'user@example.com' }
      })

      // First attempt fails
      events.setEventRetryStatus(event.$id, {
        attempts: 1,
        succeeded: false,
        lastAttempt: Date.now() - 5000,
        errors: ['SMTPError: Server busy']
      })

      // Second attempt succeeds
      events.setEventRetryStatus(event.$id, {
        attempts: 2,
        succeeded: true,
        lastAttempt: Date.now(),
        errors: ['SMTPError: Server busy'] // Keep error history
      })

      const status = events.getEventRetryStatus(event.$id)
      expect(status?.succeeded).toBe(true)
      expect(status?.attempts).toBe(2)
    })

    it('should return undefined for events without retry status', async () => {
      const status = events.getEventRetryStatus('non-existent-event-id')
      expect(status).toBeUndefined()
    })

    it('should track last attempt timestamp', async () => {
      const event = await events.emit({
        type: 'Webhook.deliver',
        payload: { url: 'https://example.com/hook' }
      })

      const firstAttempt = Date.now()
      events.setEventRetryStatus(event.$id, {
        attempts: 1,
        succeeded: false,
        lastAttempt: firstAttempt
      })

      const status = events.getEventRetryStatus(event.$id)
      expect(status?.lastAttempt).toBe(firstAttempt)
    })
  })

  describe('Retry Metrics Recording', () => {
    it('should record retry attempts for event types', () => {
      // Record multiple events
      events.recordRetryAttempt('Order.process', true, 0)  // First try success
      events.recordRetryAttempt('Order.process', true, 1)  // 1 retry then success
      events.recordRetryAttempt('Order.process', false, 3) // 3 retries then failure

      const metrics = events.getRetryMetrics()

      expect(metrics['Order.process']).toBeDefined()
      expect(metrics['Order.process']?.totalEvents).toBe(3)
      expect(metrics['Order.process']?.totalRetries).toBe(4) // 0 + 1 + 3 = 4
    })

    it('should calculate success rate correctly', () => {
      // 2 successes, 1 failure
      events.recordRetryAttempt('Payment.charge', true, 0)
      events.recordRetryAttempt('Payment.charge', true, 2)
      events.recordRetryAttempt('Payment.charge', false, 3)

      const metrics = events.getRetryMetrics()
      expect(metrics['Payment.charge']?.successRate).toBeCloseTo(2 / 3, 2)
    })

    it('should track metrics per event type independently', () => {
      events.recordRetryAttempt('Email.send', true, 0)
      events.recordRetryAttempt('Email.send', true, 1)
      events.recordRetryAttempt('SMS.send', false, 2)
      events.recordRetryAttempt('SMS.send', false, 3)

      const metrics = events.getRetryMetrics()

      expect(metrics['Email.send']?.totalEvents).toBe(2)
      expect(metrics['Email.send']?.successRate).toBe(1.0)

      expect(metrics['SMS.send']?.totalEvents).toBe(2)
      expect(metrics['SMS.send']?.successRate).toBe(0.0)
    })

    it('should return empty metrics when no retries recorded', () => {
      const metrics = events.getRetryMetrics()
      expect(Object.keys(metrics).length).toBe(0)
    })

    it('should handle 100% success rate', () => {
      events.recordRetryAttempt('Task.execute', true, 0)
      events.recordRetryAttempt('Task.execute', true, 0)
      events.recordRetryAttempt('Task.execute', true, 1)

      const metrics = events.getRetryMetrics()
      expect(metrics['Task.execute']?.successRate).toBe(1.0)
    })

    it('should handle 0% success rate', () => {
      events.recordRetryAttempt('Task.fail', false, 3)
      events.recordRetryAttempt('Task.fail', false, 3)
      events.recordRetryAttempt('Task.fail', false, 3)

      const metrics = events.getRetryMetrics()
      expect(metrics['Task.fail']?.successRate).toBe(0.0)
      expect(metrics['Task.fail']?.totalRetries).toBe(9)
    })

    it('should accumulate metrics over time', () => {
      // Simulate metrics accumulating over a session
      for (let i = 0; i < 10; i++) {
        events.recordRetryAttempt('Batch.job', i % 3 === 0, i % 4)
      }

      const metrics = events.getRetryMetrics()
      expect(metrics['Batch.job']?.totalEvents).toBe(10)
      // Events at i=0, 3, 6, 9 succeed (4 successes)
      expect(metrics['Batch.job']?.successRate).toBeCloseTo(0.4, 2)
    })
  })

  describe('Durability Configuration', () => {
    it('should set and get durability config for event types', () => {
      events.setDurabilityConfig({
        'Order.process': { retries: 5, backoff: 'exponential', timeout: 30000 },
        'Email.send': { retries: 3, backoff: 'linear', timeout: 10000 }
      })

      const orderConfig = events.getDurabilityConfig('Order.process')
      expect(orderConfig.retries).toBe(5)
      expect(orderConfig.backoff).toBe('exponential')
      expect(orderConfig.timeout).toBe(30000)

      const emailConfig = events.getDurabilityConfig('Email.send')
      expect(emailConfig.retries).toBe(3)
      expect(emailConfig.backoff).toBe('linear')
    })

    it('should return default config for unconfigured event types', () => {
      events.setDurabilityConfig({
        'Order.process': { retries: 5 }
      })

      const defaultConfig = events.getDurabilityConfig('Unconfigured.type')
      expect(defaultConfig).toBeDefined()
      expect(defaultConfig.retries).toBe(3) // Default is 3
      expect(defaultConfig.backoff).toBe('exponential') // Default
    })

    it('should support wildcard config', () => {
      events.setDurabilityConfig({
        '*': { retries: 10, backoff: 'linear' },
        'Critical.event': { retries: 20, backoff: 'exponential' }
      })

      // Specific config takes precedence
      const criticalConfig = events.getDurabilityConfig('Critical.event')
      expect(criticalConfig.retries).toBe(20)

      // Wildcard for unconfigured types
      const wildcardConfig = events.getDurabilityConfig('Any.other.event')
      expect(wildcardConfig.retries).toBe(10)
      expect(wildcardConfig.backoff).toBe('linear')
    })

    it('should support exponential backoff configuration', () => {
      events.setDurabilityConfig({
        'Payment.retry': { retries: 5, backoff: 'exponential', timeout: 60000 }
      })

      const config = events.getDurabilityConfig('Payment.retry')
      expect(config.backoff).toBe('exponential')
      expect(config.timeout).toBe(60000)
    })

    it('should support linear backoff configuration', () => {
      events.setDurabilityConfig({
        'Notification.push': { retries: 3, backoff: 'linear', timeout: 5000 }
      })

      const config = events.getDurabilityConfig('Notification.push')
      expect(config.backoff).toBe('linear')
    })
  })

  describe('Integration: Retry Status and Metrics', () => {
    it('should integrate retry status tracking with metrics', async () => {
      // Simulate an event going through retry lifecycle
      const event = await events.emit({
        type: 'Integration.sync',
        payload: { target: 'crm' }
      })

      // First attempt - fails
      events.setEventRetryStatus(event.$id, {
        attempts: 1,
        succeeded: false,
        lastAttempt: Date.now() - 2000,
        errors: ['APIError: Rate limited']
      })

      // Second attempt - fails
      events.setEventRetryStatus(event.$id, {
        attempts: 2,
        succeeded: false,
        lastAttempt: Date.now() - 1000,
        errors: ['APIError: Rate limited', 'APIError: Still rate limited']
      })

      // Third attempt - succeeds
      events.setEventRetryStatus(event.$id, {
        attempts: 3,
        succeeded: true,
        lastAttempt: Date.now(),
        errors: ['APIError: Rate limited', 'APIError: Still rate limited']
      })

      // Record the final metrics (2 retries before success)
      events.recordRetryAttempt('Integration.sync', true, 2)

      const status = events.getEventRetryStatus(event.$id)
      expect(status?.succeeded).toBe(true)
      expect(status?.attempts).toBe(3)

      const metrics = events.getRetryMetrics()
      expect(metrics['Integration.sync']?.totalRetries).toBe(2)
      expect(metrics['Integration.sync']?.successRate).toBe(1.0)
    })

    it('should track failed events that exhaust retries', async () => {
      const event = await events.emit({
        type: 'Webhook.deliver',
        payload: { url: 'https://broken.endpoint.com' }
      })

      // Configure max 3 retries
      events.setDurabilityConfig({
        'Webhook.deliver': { retries: 3, backoff: 'exponential' }
      })

      // All attempts fail
      const errors: string[] = []
      for (let attempt = 1; attempt <= 3; attempt++) {
        errors.push(`HTTPError: 503 Service Unavailable (attempt ${attempt})`)
        events.setEventRetryStatus(event.$id, {
          attempts: attempt,
          succeeded: false,
          lastAttempt: Date.now(),
          errors: [...errors]
        })
      }

      // Record the final failure
      events.recordRetryAttempt('Webhook.deliver', false, 3)

      const status = events.getEventRetryStatus(event.$id)
      expect(status?.succeeded).toBe(false)
      expect(status?.attempts).toBe(3)
      expect(status?.errors?.length).toBe(3)

      const metrics = events.getRetryMetrics()
      expect(metrics['Webhook.deliver']?.successRate).toBe(0.0)
    })
  })

  describe('With Storage Adapter', () => {
    let adapterStore: EventsStore

    beforeEach(() => {
      adapterStore = createEventsStoreWithAdapter(createMemoryStorageAdapter())
    })

    it('should track retry status with storage adapter', async () => {
      const event = await adapterStore.emit({
        type: 'Adapter.event',
        payload: { test: true }
      })

      adapterStore.setEventRetryStatus(event.$id, {
        attempts: 2,
        succeeded: true,
        lastAttempt: Date.now()
      })

      const status = adapterStore.getEventRetryStatus(event.$id)
      expect(status?.attempts).toBe(2)
      expect(status?.succeeded).toBe(true)
    })

    it('should record retry metrics with storage adapter', () => {
      adapterStore.recordRetryAttempt('Adapter.process', true, 1)
      adapterStore.recordRetryAttempt('Adapter.process', false, 3)

      const metrics = adapterStore.getRetryMetrics()
      expect(metrics['Adapter.process']?.totalEvents).toBe(2)
      expect(metrics['Adapter.process']?.totalRetries).toBe(4)
      expect(metrics['Adapter.process']?.successRate).toBe(0.5)
    })

    it('should manage durability config with storage adapter', () => {
      adapterStore.setDurabilityConfig({
        'Adapter.critical': { retries: 10, backoff: 'exponential' }
      })

      const config = adapterStore.getDurabilityConfig('Adapter.critical')
      expect(config.retries).toBe(10)
    })
  })
})
