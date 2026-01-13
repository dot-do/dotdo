/**
 * Tamper Alert Notifier Tests
 *
 * Tests for the notification system integration with tamper detection alerts.
 *
 * @see dotdo-p2ulg - [REFACTOR] Tamper detection alerts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createTamperAlertNotifier,
  buildTamperNotificationPayload,
  getSeverityPriority,
  type TamperAlertNotifier,
  type TamperAlertNotifierOptions,
} from '../tamper-alert-notifier'
import { type TamperAlert, type AlertSeverity, type TamperType } from '../tamper-detection'

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Create a mock fetch that tracks calls
 */
function createMockFetch() {
  const calls: Array<{ url: string; options: RequestInit }> = []

  const mockFetch = vi.fn(async (url: string, options?: RequestInit) => {
    calls.push({ url, options: options ?? {} })
    return {
      ok: true,
      json: async () => ({ id: 'msg-123' }),
    } as Response
  })

  return { mockFetch, calls }
}

/**
 * Create a test alert
 */
function createTestAlert(overrides?: Partial<TamperAlert>): TamperAlert {
  return {
    id: 'alert-test-123',
    type: 'hash_chain_broken',
    severity: 'critical',
    message: 'Hash chain broken at index 42',
    index: 42,
    entryId: 'entry-42',
    expected: 'abc123',
    actual: 'xyz789',
    detectedAt: Date.now(),
    ...overrides,
  }
}

/**
 * Create notifier options with mock fetch
 */
function createTestOptions(
  mockFetch: ReturnType<typeof vi.fn>,
  overrides?: Partial<TamperAlertNotifierOptions>
): TamperAlertNotifierOptions {
  const baseOptions: TamperAlertNotifierOptions = {
    channels: {
      channels: [
        {
          type: 'webhook',
          url: 'https://test.webhook.com/alerts',
        },
      ],
      baseUrl: 'https://app.dotdo.dev',
      fetch: mockFetch,
      // Route all severities to webhook for testing
      routing: {
        urgent: ['webhook'],
        high: ['webhook'],
        normal: ['webhook'],
        low: ['webhook'],
      },
    },
    recipients: {
      default: {
        email: 'security@test.com',
        webhookUrl: 'https://test.webhook.com/alerts',
      },
    },
  }

  // Deep merge overrides
  if (overrides) {
    const merged = { ...baseOptions }
    if (overrides.channels) {
      merged.channels = {
        ...baseOptions.channels,
        ...overrides.channels,
        // Ensure fetch is preserved
        fetch: overrides.channels.fetch ?? mockFetch,
      }
    }
    if (overrides.recipients) {
      merged.recipients = {
        ...baseOptions.recipients,
        ...overrides.recipients,
      }
    }
    if (overrides.enableBatching !== undefined) {
      merged.enableBatching = overrides.enableBatching
    }
    if (overrides.batchWindowMs !== undefined) {
      merged.batchWindowMs = overrides.batchWindowMs
    }
    if (overrides.maxBatchSize !== undefined) {
      merged.maxBatchSize = overrides.maxBatchSize
    }
    return merged
  }

  return baseOptions
}

// =============================================================================
// getSeverityPriority TESTS
// =============================================================================

describe('getSeverityPriority', () => {
  it('should map critical to urgent', () => {
    expect(getSeverityPriority('critical')).toBe('urgent')
  })

  it('should map high to high', () => {
    expect(getSeverityPriority('high')).toBe('high')
  })

  it('should map medium to normal', () => {
    expect(getSeverityPriority('medium')).toBe('normal')
  })

  it('should map low to low', () => {
    expect(getSeverityPriority('low')).toBe('low')
  })

  it('should map info to low', () => {
    expect(getSeverityPriority('info')).toBe('low')
  })
})

// =============================================================================
// buildTamperNotificationPayload TESTS
// =============================================================================

describe('buildTamperNotificationPayload', () => {
  it('should build payload from alert', () => {
    const alert = createTestAlert()
    const payload = buildTamperNotificationPayload(alert)

    expect(payload.subject).toContain('[Security Alert]')
    expect(payload.subject).toContain('Hash chain')
    expect(payload.message).toContain('Hash chain integrity broken')
    expect(payload.message).toContain('CRITICAL')
    expect(payload.message).toContain('index 42')
    expect(payload.metadata.alertId).toBe(alert.id)
    expect(payload.metadata.severity).toBe('critical')
  })

  it('should include expected/actual values', () => {
    const alert = createTestAlert({
      expected: 'expected-hash',
      actual: 'actual-hash',
    })
    const payload = buildTamperNotificationPayload(alert)

    expect(payload.message).toContain('Expected:')
    expect(payload.message).toContain('expected-hash')
    expect(payload.message).toContain('Actual:')
    expect(payload.message).toContain('actual-hash')
  })

  it('should use custom subject prefix', () => {
    const alert = createTestAlert()
    const payload = buildTamperNotificationPayload(alert, {
      subjectPrefix: '[URGENT SECURITY]',
    })

    expect(payload.subject).toContain('[URGENT SECURITY]')
    expect(payload.subject).not.toContain('[Security Alert]')
  })

  it('should handle all tamper types', () => {
    const types: TamperType[] = [
      'hash_chain_broken',
      'hash_mismatch',
      'index_gap',
      'index_duplicate',
      'timestamp_anomaly',
      'timestamp_future',
      'actor_anomaly',
      'rate_anomaly',
      'deletion_detected',
      'modification_detected',
    ]

    for (const type of types) {
      const alert = createTestAlert({ type })
      const payload = buildTamperNotificationPayload(alert)
      expect(payload.subject).toBeTruthy()
      expect(payload.message).toBeTruthy()
    }
  })

  it('should handle alert without optional fields', () => {
    const alert: TamperAlert = {
      id: 'alert-minimal',
      type: 'rate_anomaly',
      severity: 'low',
      message: 'Unusual rate detected',
      detectedAt: Date.now(),
    }

    const payload = buildTamperNotificationPayload(alert)

    expect(payload.subject).toBeTruthy()
    expect(payload.message).toContain('Unusual rate detected')
    expect(payload.metadata.alertId).toBe('alert-minimal')
  })
})

// =============================================================================
// TamperAlertNotifier TESTS
// =============================================================================

describe('TamperAlertNotifier', () => {
  let notifier: TamperAlertNotifier
  let mockFetch: ReturnType<typeof vi.fn>
  let calls: Array<{ url: string; options: RequestInit }>

  beforeEach(() => {
    const mock = createMockFetch()
    mockFetch = mock.mockFetch
    calls = mock.calls
  })

  afterEach(async () => {
    if (notifier) {
      await notifier.dispose()
    }
  })

  describe('createHandler', () => {
    it('should create a handler function', () => {
      notifier = createTamperAlertNotifier(createTestOptions(mockFetch))

      const handler = notifier.createHandler()

      expect(typeof handler).toBe('function')
    })

    it('should send alert when handler is called', async () => {
      notifier = createTamperAlertNotifier(createTestOptions(mockFetch))

      const handler = notifier.createHandler()
      await handler(createTestAlert())

      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('createHandlersBySeverity', () => {
    it('should create handlers for all severities', () => {
      notifier = createTamperAlertNotifier(createTestOptions(mockFetch))

      const handlers = notifier.createHandlersBySeverity()

      expect(handlers.critical).toBeDefined()
      expect(handlers.high).toBeDefined()
      expect(handlers.medium).toBeDefined()
      expect(handlers.low).toBeDefined()
      expect(handlers.info).toBeDefined()
    })
  })

  describe('sendAlert', () => {
    it('should send an alert successfully', async () => {
      notifier = createTamperAlertNotifier(createTestOptions(mockFetch))

      const result = await notifier.sendAlert(createTestAlert())

      expect(result.success).toBe(true)
      expect(result.alert).toBeDefined()
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should include alert details in notification', async () => {
      notifier = createTamperAlertNotifier(createTestOptions(mockFetch))

      await notifier.sendAlert(createTestAlert())

      expect(calls.length).toBeGreaterThan(0)
      const body = JSON.parse(calls[0]!.options.body as string)
      expect(body.message).toContain('Hash chain')
      expect(body.priority).toBe('urgent') // critical maps to urgent
    })

    it('should handle send failure gracefully', async () => {
      const failingFetch = vi.fn(async () => {
        throw new Error('Network error')
      })

      notifier = createTamperAlertNotifier(createTestOptions(failingFetch))

      const result = await notifier.sendAlert(createTestAlert())

      expect(result.success).toBe(false)
      expect(result.error).toContain('Network error')
    })

    it('should use correct priority for different severities', async () => {
      notifier = createTamperAlertNotifier(createTestOptions(mockFetch))

      const severities: AlertSeverity[] = ['critical', 'high', 'medium', 'low', 'info']
      const expectedPriorities = ['urgent', 'high', 'normal', 'low', 'low']

      for (let i = 0; i < severities.length; i++) {
        calls.length = 0 // Reset calls

        await notifier.sendAlert(createTestAlert({ severity: severities[i] }))

        const body = JSON.parse(calls[0]!.options.body as string)
        expect(body.priority).toBe(expectedPriorities[i])
      }
    })
  })

  describe('sendBatch', () => {
    it('should send multiple alerts as a batch', async () => {
      notifier = createTamperAlertNotifier(createTestOptions(mockFetch))

      const alerts = [
        createTestAlert({ id: 'alert-1' }),
        createTestAlert({ id: 'alert-2', type: 'hash_mismatch' }),
        createTestAlert({ id: 'alert-3', type: 'index_gap', severity: 'high' }),
      ]

      const results = await notifier.sendBatch(alerts)

      expect(results).toHaveLength(3)
      expect(results.every((r) => r.success)).toBe(true)
      // Should send as single batch notification
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should send single alert directly', async () => {
      notifier = createTamperAlertNotifier(createTestOptions(mockFetch))

      const results = await notifier.sendBatch([createTestAlert()])

      expect(results).toHaveLength(1)
      expect(results[0]!.success).toBe(true)
    })

    it('should return empty for empty batch', async () => {
      notifier = createTamperAlertNotifier(createTestOptions(mockFetch))

      const results = await notifier.sendBatch([])

      expect(results).toHaveLength(0)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should include batch summary in message', async () => {
      notifier = createTamperAlertNotifier(createTestOptions(mockFetch))

      const alerts = [
        createTestAlert({ severity: 'critical' }),
        createTestAlert({ severity: 'high', type: 'hash_mismatch' }),
        createTestAlert({ severity: 'medium', type: 'index_gap' }),
      ]

      await notifier.sendBatch(alerts)

      const body = JSON.parse(calls[0]!.options.body as string)
      expect(body.message).toContain('3 Tamper Alerts')
      expect(body.message).toContain('Critical')
      expect(body.message).toContain('High')
    })
  })

  describe('batching', () => {
    it('should batch non-critical alerts when enabled', async () => {
      notifier = createTamperAlertNotifier(
        createTestOptions(mockFetch, {
          enableBatching: true,
          batchWindowMs: 100,
        })
      )

      const handler = notifier.createHandler()

      // Send high severity (should be batched)
      await handler(createTestAlert({ severity: 'high' }))

      // Alert should be pending
      expect(notifier.getPendingCount()).toBe(1)
      expect(mockFetch).not.toHaveBeenCalled()

      // Wait for batch window
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Should have been flushed
      expect(notifier.getPendingCount()).toBe(0)
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should send critical alerts immediately even with batching', async () => {
      notifier = createTamperAlertNotifier(
        createTestOptions(mockFetch, {
          enableBatching: true,
          batchWindowMs: 1000,
        })
      )

      const handler = notifier.createHandler()

      // Send critical alert (should NOT be batched)
      await handler(createTestAlert({ severity: 'critical' }))

      // Should be sent immediately
      expect(notifier.getPendingCount()).toBe(0)
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should flush when batch reaches max size', async () => {
      notifier = createTamperAlertNotifier(
        createTestOptions(mockFetch, {
          enableBatching: true,
          batchWindowMs: 10000, // Long window
          maxBatchSize: 3,
        })
      )

      const handler = notifier.createHandler()

      // Send 3 high severity alerts
      await handler(createTestAlert({ id: 'a1', severity: 'high' }))
      await handler(createTestAlert({ id: 'a2', severity: 'high' }))
      await handler(createTestAlert({ id: 'a3', severity: 'high' }))

      // Should have been flushed due to max size
      expect(notifier.getPendingCount()).toBe(0)
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should flush pending alerts on dispose', async () => {
      notifier = createTamperAlertNotifier(
        createTestOptions(mockFetch, {
          enableBatching: true,
          batchWindowMs: 10000,
        })
      )

      const handler = notifier.createHandler()
      await handler(createTestAlert({ severity: 'high' }))

      expect(notifier.getPendingCount()).toBe(1)

      await notifier.dispose()

      expect(notifier.getPendingCount()).toBe(0)
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should return pending count correctly', async () => {
      notifier = createTamperAlertNotifier(
        createTestOptions(mockFetch, {
          enableBatching: true,
          batchWindowMs: 10000,
        })
      )

      expect(notifier.getPendingCount()).toBe(0)

      const handler = notifier.createHandler()
      await handler(createTestAlert({ severity: 'high' }))
      expect(notifier.getPendingCount()).toBe(1)

      await handler(createTestAlert({ id: 'a2', severity: 'medium' }))
      expect(notifier.getPendingCount()).toBe(2)

      await notifier.flushBatch()
      expect(notifier.getPendingCount()).toBe(0)
    })
  })

  describe('flushBatch', () => {
    it('should flush all pending alerts', async () => {
      notifier = createTamperAlertNotifier(
        createTestOptions(mockFetch, {
          enableBatching: true,
          batchWindowMs: 10000,
        })
      )

      const handler = notifier.createHandler()
      await handler(createTestAlert({ id: 'a1', severity: 'high' }))
      await handler(createTestAlert({ id: 'a2', severity: 'medium' }))

      const results = await notifier.flushBatch()

      expect(results).toHaveLength(2)
      expect(notifier.getPendingCount()).toBe(0)
    })

    it('should return empty array if no pending', async () => {
      notifier = createTamperAlertNotifier(createTestOptions(mockFetch))

      const results = await notifier.flushBatch()

      expect(results).toHaveLength(0)
    })
  })

  describe('recipient routing', () => {
    it('should use default recipient', async () => {
      notifier = createTamperAlertNotifier(
        createTestOptions(mockFetch, {
          recipients: {
            default: {
              email: 'default@test.com',
              webhookUrl: 'https://test.webhook.com/alerts',
            },
          },
        })
      )

      await notifier.sendAlert(createTestAlert())

      const body = JSON.parse(calls[0]!.options.body as string)
      expect(body.recipient.email).toBe('default@test.com')
    })

    it('should use severity-specific recipient', async () => {
      notifier = createTamperAlertNotifier(
        createTestOptions(mockFetch, {
          recipients: {
            default: {
              email: 'default@test.com',
              webhookUrl: 'https://test.webhook.com/alerts',
            },
            bySeverity: {
              critical: {
                email: 'critical@test.com',
                webhookUrl: 'https://test.webhook.com/alerts',
              },
            },
          },
        })
      )

      await notifier.sendAlert(createTestAlert({ severity: 'critical' }))

      const body = JSON.parse(calls[0]!.options.body as string)
      expect(body.recipient.email).toBe('critical@test.com')
    })

    it('should use type-specific recipient', async () => {
      notifier = createTamperAlertNotifier(
        createTestOptions(mockFetch, {
          recipients: {
            default: {
              email: 'default@test.com',
              webhookUrl: 'https://test.webhook.com/alerts',
            },
            byType: {
              deletion_detected: {
                email: 'deletion-alert@test.com',
                webhookUrl: 'https://test.webhook.com/alerts',
              },
            },
          },
        })
      )

      await notifier.sendAlert(createTestAlert({ type: 'deletion_detected' }))

      const body = JSON.parse(calls[0]!.options.body as string)
      expect(body.recipient.email).toBe('deletion-alert@test.com')
    })
  })
})

// =============================================================================
// INTEGRATION WITH TAMPER DETECTOR TESTS
// =============================================================================

describe('Integration with TamperDetector', () => {
  it('should work as default handler', async () => {
    const { mockFetch } = createMockFetch()

    const notifier = createTamperAlertNotifier(
      createTestOptions(mockFetch, {
        enableBatching: false, // Disable batching for test
      })
    )

    // Simulate what TamperDetector does
    const handler = notifier.createHandler()

    // Simulate alert dispatch
    await handler(createTestAlert())

    expect(mockFetch).toHaveBeenCalled()

    await notifier.dispose()
  })

  it('should work with severity-specific handlers', async () => {
    const { mockFetch } = createMockFetch()

    const notifier = createTamperAlertNotifier(createTestOptions(mockFetch))
    const handlers = notifier.createHandlersBySeverity()

    // All handlers should work
    await handlers.critical(createTestAlert({ severity: 'critical' }))
    await handlers.high(createTestAlert({ severity: 'high' }))
    await handlers.medium(createTestAlert({ severity: 'medium' }))

    expect(mockFetch).toHaveBeenCalledTimes(3)

    await notifier.dispose()
  })
})
