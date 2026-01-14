/**
 * Zapier Webhook Trigger Tests - RED Phase
 *
 * Comprehensive failing tests for Zapier webhook triggers:
 * - Webhook subscription registration
 * - Webhook URL generation
 * - Incoming webhook handling
 * - Payload transformation to Zapier format
 * - Subscription lifecycle (subscribe, unsubscribe)
 * - performSubscribe/performUnsubscribe hooks
 * - Sample data for Zap editor
 * - Webhook verification handshake
 * - performList for initial data fetch
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  App,
  createZObject,
  createHookTrigger,
  WebhookHandler,
  WebhookSubscriptionManager,
  WebhookTriggerManager,
  Trigger,
  generateVerificationToken,
  parseEventType,
  extractWebhookData,
  webhookSuccess,
  webhookError,
  WebhookRetryManager,
  type Bundle,
  type ZObject,
  type HookTriggerConfig,
  type WebhookSubscription,
  type RawRequest,
} from '../index'

describe('Zapier Webhook Triggers', () => {
  let z: ZObject
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'webhook-123' }), { status: 200 })
    )
    vi.stubGlobal('fetch', mockFetch)
    z = createZObject()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // ============================================================================
  // WEBHOOK SUBSCRIPTION REGISTRATION
  // ============================================================================

  describe('Webhook Subscription Registration', () => {
    it('should register a webhook subscription with target URL', async () => {
      const trigger = createHookTrigger({
        key: 'new_order',
        noun: 'Order',
        display: { label: 'New Order', description: 'Triggers on new orders' },
        performSubscribe: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/webhooks',
            method: 'POST',
            json: {
              url: bundle.targetUrl,
              events: ['order.created'],
            },
            skipThrowForStatus: true,
          })
          return response.data as { id: string }
        },
        performUnsubscribe: async (z, bundle) => {
          const subscriptionId = (bundle.subscribeData as { id: string }).id
          await z.request({
            url: `https://api.example.com/webhooks/${subscriptionId}`,
            method: 'DELETE',
            skipThrowForStatus: true,
          })
        },
        perform: async (z, bundle) => [bundle.cleanedRequest],
      })

      const manager = new WebhookSubscriptionManager()
      const bundle: Bundle = {
        inputData: {},
        authData: { api_key: 'test-key' },
        targetUrl: 'https://hooks.zapier.com/hooks/standard/12345/abcdef',
      }

      const subscription = await manager.subscribe(trigger, z, bundle)

      expect(subscription.id).toBe('webhook-123')
      expect(subscription.targetUrl).toBe('https://hooks.zapier.com/hooks/standard/12345/abcdef')
      expect(manager.hasSubscription('webhook-123')).toBe(true)
    })

    it('should store subscription metadata from performSubscribe response', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'sub-456',
            secret: 'webhook-secret-123',
            createdAt: '2024-01-15T12:00:00Z',
          }),
          { status: 201 }
        )
      )

      const trigger = createHookTrigger({
        key: 'new_payment',
        noun: 'Payment',
        display: { label: 'New Payment', description: 'Triggers on payments' },
        performSubscribe: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.stripe.com/webhooks',
            method: 'POST',
            json: { url: bundle.targetUrl },
            skipThrowForStatus: true,
          })
          return response.data as { id: string; secret: string }
        },
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => [bundle.cleanedRequest],
      })

      const manager = new WebhookSubscriptionManager()
      const bundle: Bundle = {
        inputData: {},
        authData: {},
        targetUrl: 'https://hooks.zapier.com/hooks/123',
      }

      const subscription = await manager.subscribe(trigger, z, bundle)

      expect(subscription.metadata).toBeDefined()
      expect(subscription.metadata?.secret).toBe('webhook-secret-123')
    })

    it('should support event-specific webhook subscriptions', async () => {
      const trigger = createHookTrigger({
        key: 'customer_event',
        noun: 'Customer',
        display: { label: 'Customer Event', description: 'Customer events' },
        performSubscribe: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/webhooks',
            method: 'POST',
            json: {
              url: bundle.targetUrl,
              event: bundle.inputData.event,
            },
            skipThrowForStatus: true,
          })
          return response.data as { id: string }
        },
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => [bundle.cleanedRequest],
        inputFields: [
          {
            key: 'event',
            label: 'Event Type',
            choices: ['customer.created', 'customer.updated', 'customer.deleted'],
            required: true,
          },
        ],
      })

      const manager = new WebhookSubscriptionManager()
      const bundle: Bundle = {
        inputData: { event: 'customer.created' },
        authData: {},
        targetUrl: 'https://hooks.zapier.com/hooks/123',
      }

      const subscription = await manager.subscribe(trigger, z, bundle)

      expect(subscription.event).toBe('customer.created')
    })

    it('should handle subscription registration failures gracefully', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: 'Invalid URL format' }),
          { status: 400 }
        )
      )

      const trigger = createHookTrigger({
        key: 'failing_webhook',
        noun: 'Item',
        display: { label: 'Item', description: 'Item events' },
        performSubscribe: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/webhooks',
            method: 'POST',
            json: { url: bundle.targetUrl },
          })
          return response.data as { id: string }
        },
        performUnsubscribe: async () => ({}),
        perform: async () => [],
      })

      const manager = new WebhookSubscriptionManager()
      const bundle: Bundle = {
        inputData: {},
        authData: {},
        targetUrl: 'invalid-url',
      }

      await expect(manager.subscribe(trigger, z, bundle)).rejects.toThrow()
    })
  })

  // ============================================================================
  // WEBHOOK URL GENERATION
  // ============================================================================

  describe('Webhook URL Generation', () => {
    it('should generate unique webhook URLs per subscription', () => {
      const url1 = z.generateCallbackUrl()
      const url2 = z.generateCallbackUrl()

      expect(url1).toContain('hooks.zapier.com')
      expect(url2).toContain('hooks.zapier.com')
      // URLs should be unique (contain unique identifiers)
      expect(url1).not.toBe(url2)
    })

    it('should generate webhook URLs with proper structure', () => {
      const url = z.generateCallbackUrl()

      // URL should follow Zapier hook URL pattern
      expect(url).toMatch(/^https:\/\/hooks\.zapier\.com\/hooks\/[a-zA-Z0-9\/]+$/)
    })

    it('should include zap identifier in webhook URL', () => {
      // Create Z object with zap context
      const zWithZap = createZObject()

      const url = zWithZap.generateCallbackUrl()

      // URL should contain identifiable parts
      expect(url).toContain('hooks')
    })

    it('should support custom webhook URL patterns for enterprise', async () => {
      // Test that custom webhook URL generators can be provided
      const customUrlGenerator = () => 'https://webhooks.mycompany.com/zapier/hook/123'

      const zCustom = createZObject({
        callbackUrlGenerator: customUrlGenerator,
      })

      const url = zCustom.generateCallbackUrl()

      expect(url).toBe('https://webhooks.mycompany.com/zapier/hook/123')
    })
  })

  // ============================================================================
  // INCOMING WEBHOOK HANDLING
  // ============================================================================

  describe('Incoming Webhook Handling', () => {
    it('should handle JSON webhook payloads', async () => {
      const trigger = createHookTrigger({
        key: 'json_webhook',
        noun: 'Event',
        display: { label: 'Event', description: 'JSON events' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => {
          const data = bundle.cleanedRequest as Record<string, unknown>
          return [{ id: data.id, type: data.event, timestamp: Date.now() }]
        },
      })

      const handler = new WebhookHandler()
      const request = new Request('https://hooks.zapier.com/123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'evt-123', event: 'order.created', data: { orderId: 456 } }),
      })

      const result = await handler.handleRequest(request, trigger, z)

      expect(result.status).toBe(200)
      expect(result.data).toHaveLength(1)
      expect(result.data[0]).toMatchObject({ id: 'evt-123', type: 'order.created' })
    })

    it('should handle form-urlencoded webhook payloads', async () => {
      const trigger = createHookTrigger({
        key: 'form_webhook',
        noun: 'Form',
        display: { label: 'Form', description: 'Form submissions' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => [bundle.cleanedRequest],
      })

      const handler = new WebhookHandler()
      const request = new Request('https://hooks.zapier.com/123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'name=John&email=john%40example.com&action=submit',
      })

      const result = await handler.handleRequest(request, trigger, z)

      expect(result.data).toHaveLength(1)
      expect(result.data[0]).toMatchObject({
        name: 'John',
        email: 'john@example.com',
        action: 'submit',
      })
    })

    it('should handle multipart form data webhooks', async () => {
      const trigger = createHookTrigger({
        key: 'multipart_webhook',
        noun: 'Upload',
        display: { label: 'Upload', description: 'File uploads' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => [bundle.cleanedRequest],
      })

      const handler = new WebhookHandler()
      const formData = new FormData()
      formData.append('filename', 'document.pdf')
      formData.append('size', '12345')

      const request = new Request('https://hooks.zapier.com/123', {
        method: 'POST',
        body: formData,
      })

      const result = await handler.handleRequest(request, trigger, z)

      expect(result.data[0]).toMatchObject({
        filename: 'document.pdf',
        size: '12345',
      })
    })

    it('should provide raw request in bundle', async () => {
      let capturedBundle: Bundle | null = null

      const trigger = createHookTrigger({
        key: 'raw_request_test',
        noun: 'Request',
        display: { label: 'Request', description: 'Raw request access' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => {
          capturedBundle = bundle
          return [bundle.cleanedRequest]
        },
      })

      const handler = new WebhookHandler()
      const request = new Request('https://hooks.zapier.com/123?query=value', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Custom-Header': 'custom-value',
        },
        body: JSON.stringify({ test: true }),
      })

      await handler.handleRequest(request, trigger, z)

      expect(capturedBundle?.rawRequest).toBeDefined()
      expect(capturedBundle?.rawRequest?.method).toBe('POST')
      expect(capturedBundle?.rawRequest?.headers['content-type']).toBe('application/json')
      expect(capturedBundle?.rawRequest?.headers['x-custom-header']).toBe('custom-value')
      expect(capturedBundle?.rawRequest?.querystring).toBe('query=value')
      expect(capturedBundle?.rawRequest?.content).toContain('test')
    })

    it('should handle empty webhook bodies gracefully', async () => {
      const trigger = createHookTrigger({
        key: 'empty_body',
        noun: 'Ping',
        display: { label: 'Ping', description: 'Ping events' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => [{ ping: true, received: Date.now() }],
      })

      const handler = new WebhookHandler()
      const request = new Request('https://hooks.zapier.com/123', {
        method: 'POST',
      })

      const result = await handler.handleRequest(request, trigger, z)

      expect(result.status).toBe(200)
      expect(result.data).toHaveLength(1)
    })
  })

  // ============================================================================
  // PAYLOAD TRANSFORMATION TO ZAPIER FORMAT
  // ============================================================================

  describe('Payload Transformation to Zapier Format', () => {
    it('should transform nested payload to flat Zapier format', async () => {
      const trigger = createHookTrigger({
        key: 'nested_transform',
        noun: 'Contact',
        display: { label: 'Contact', description: 'Contact events' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => {
          const data = bundle.cleanedRequest as Record<string, unknown>
          // Transform nested data to flat structure
          const contact = data.contact as Record<string, unknown>
          const address = contact.address as Record<string, unknown>
          return [{
            id: contact.id,
            name: contact.name,
            email: contact.email,
            address_street: address.street,
            address_city: address.city,
            address_zip: address.zip,
          }]
        },
      })

      const handler = new WebhookHandler()
      const request = new Request('https://hooks.zapier.com/123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact: {
            id: 'c-123',
            name: 'John Doe',
            email: 'john@example.com',
            address: {
              street: '123 Main St',
              city: 'Anytown',
              zip: '12345',
            },
          },
        }),
      })

      const result = await handler.handleRequest(request, trigger, z)

      expect(result.data[0]).toMatchObject({
        id: 'c-123',
        name: 'John Doe',
        email: 'john@example.com',
        address_street: '123 Main St',
        address_city: 'Anytown',
        address_zip: '12345',
      })
    })

    it('should ensure each result has a unique id field', async () => {
      const trigger = createHookTrigger({
        key: 'ensure_id',
        noun: 'Item',
        display: { label: 'Item', description: 'Items' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => {
          const items = (bundle.cleanedRequest as { items: unknown[] }).items
          return items.map((item: any, index) => ({
            id: item.id || `generated-${index}-${Date.now()}`,
            ...item,
          }))
        },
      })

      const handler = new WebhookHandler()
      const request = new Request('https://hooks.zapier.com/123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            { name: 'Item 1' }, // No id
            { name: 'Item 2', id: 'existing-id' },
          ],
        }),
      })

      const result = await handler.handleRequest(request, trigger, z)

      expect(result.data[0]).toHaveProperty('id')
      expect(result.data[1]).toHaveProperty('id', 'existing-id')
    })

    it('should convert arrays to line items format', async () => {
      const trigger = createHookTrigger({
        key: 'line_items',
        noun: 'Order',
        display: { label: 'Order', description: 'Orders with line items' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => {
          const order = bundle.cleanedRequest as Record<string, unknown>
          const lineItems = order.items as Array<{ sku: string; qty: number; price: number }>

          return [{
            id: order.id,
            customer: order.customer,
            // Convert array to numbered fields for Zapier line items
            line_items: lineItems.map((item, i) => ({
              [`sku`]: item.sku,
              [`qty`]: item.qty,
              [`price`]: item.price,
            })),
            line_item_count: lineItems.length,
          }]
        },
      })

      const handler = new WebhookHandler()
      const request = new Request('https://hooks.zapier.com/123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'order-123',
          customer: 'john@example.com',
          items: [
            { sku: 'SKU-001', qty: 2, price: 29.99 },
            { sku: 'SKU-002', qty: 1, price: 49.99 },
          ],
        }),
      })

      const result = await handler.handleRequest(request, trigger, z)

      expect(result.data[0]).toHaveProperty('line_items')
      expect(result.data[0]).toHaveProperty('line_item_count', 2)
    })

    it('should format dates to ISO 8601 format', async () => {
      const trigger = createHookTrigger({
        key: 'date_format',
        noun: 'Event',
        display: { label: 'Event', description: 'Events with dates' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => {
          const event = bundle.cleanedRequest as Record<string, unknown>
          // Convert Unix timestamp to ISO 8601
          const timestamp = event.timestamp as number
          return [{
            id: event.id,
            created_at: new Date(timestamp * 1000).toISOString(),
          }]
        },
      })

      const handler = new WebhookHandler()
      const request = new Request('https://hooks.zapier.com/123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'evt-123',
          timestamp: 1705320000, // Unix timestamp
        }),
      })

      const result = await handler.handleRequest(request, trigger, z)

      expect(result.data[0]).toHaveProperty('created_at')
      expect(result.data[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })
  })

  // ============================================================================
  // SUBSCRIPTION LIFECYCLE
  // ============================================================================

  describe('Subscription Lifecycle', () => {
    it('should complete full subscribe/unsubscribe cycle', async () => {
      const subscribeCalls: any[] = []
      const unsubscribeCalls: any[] = []

      const trigger = createHookTrigger({
        key: 'lifecycle_test',
        noun: 'Event',
        display: { label: 'Event', description: 'Lifecycle test' },
        performSubscribe: async (z, bundle) => {
          subscribeCalls.push({ targetUrl: bundle.targetUrl, inputData: bundle.inputData })
          return { id: 'sub-123', secret: 'secret-abc' }
        },
        performUnsubscribe: async (z, bundle) => {
          unsubscribeCalls.push({
            subscribeData: bundle.subscribeData,
          })
          return {}
        },
        perform: async (z, bundle) => [bundle.cleanedRequest],
      })

      const manager = new WebhookSubscriptionManager()

      // Subscribe
      const subscribeBundle: Bundle = {
        inputData: { event: 'order.created' },
        authData: { api_key: 'test' },
        targetUrl: 'https://hooks.zapier.com/hooks/123',
      }

      const subscription = await manager.subscribe(trigger, z, subscribeBundle)

      expect(subscribeCalls).toHaveLength(1)
      expect(subscribeCalls[0].targetUrl).toBe('https://hooks.zapier.com/hooks/123')
      expect(subscription.id).toBe('sub-123')

      // Unsubscribe
      const unsubscribeBundle: Bundle = {
        inputData: {},
        authData: { api_key: 'test' },
        subscribeData: { id: 'sub-123', secret: 'secret-abc' },
      }

      await manager.unsubscribe(trigger, z, unsubscribeBundle)

      expect(unsubscribeCalls).toHaveLength(1)
      expect(unsubscribeCalls[0].subscribeData).toMatchObject({ id: 'sub-123' })
      expect(manager.hasSubscription('sub-123')).toBe(false)
    })

    it('should persist subscriptions across manager instances', async () => {
      const storage = new Map<string, unknown>()

      const trigger = createHookTrigger({
        key: 'persist_test',
        noun: 'Event',
        display: { label: 'Event', description: 'Persistence test' },
        performSubscribe: async () => ({ id: 'persistent-sub' }),
        performUnsubscribe: async () => ({}),
        perform: async () => [],
      })

      // Create manager with storage
      const manager1 = new WebhookSubscriptionManager({
        get: async (key) => storage.get(key),
        set: async (key, value) => { storage.set(key, value) },
        delete: async (key) => { storage.delete(key) },
      })

      const bundle: Bundle = {
        inputData: {},
        authData: {},
        targetUrl: 'https://hooks.zapier.com/123',
      }

      await manager1.subscribe(trigger, z, bundle)

      // Create new manager with same storage
      const manager2 = new WebhookSubscriptionManager({
        get: async (key) => storage.get(key),
        set: async (key, value) => { storage.set(key, value) },
        delete: async (key) => { storage.delete(key) },
      })

      const retrieved = await manager2.getSubscription('persistent-sub')

      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe('persistent-sub')
    })

    it('should handle multiple concurrent subscriptions', async () => {
      const trigger = createHookTrigger({
        key: 'concurrent_test',
        noun: 'Event',
        display: { label: 'Event', description: 'Concurrent test' },
        performSubscribe: async (z, bundle) => ({
          id: `sub-${bundle.inputData.zapId}`,
        }),
        performUnsubscribe: async () => ({}),
        perform: async () => [],
      })

      const manager = new WebhookSubscriptionManager()

      const bundles = [
        { inputData: { zapId: '1' }, authData: {}, targetUrl: 'https://hooks.zapier.com/1' },
        { inputData: { zapId: '2' }, authData: {}, targetUrl: 'https://hooks.zapier.com/2' },
        { inputData: { zapId: '3' }, authData: {}, targetUrl: 'https://hooks.zapier.com/3' },
      ]

      await Promise.all(bundles.map((bundle) => manager.subscribe(trigger, z, bundle)))

      const allSubs = manager.getAllSubscriptions()

      expect(allSubs).toHaveLength(3)
      expect(manager.hasSubscription('sub-1')).toBe(true)
      expect(manager.hasSubscription('sub-2')).toBe(true)
      expect(manager.hasSubscription('sub-3')).toBe(true)
    })

    it('should cleanup stale subscriptions', async () => {
      const manager = new WebhookSubscriptionManager()

      // Manually add an old subscription
      const oldSubscription: WebhookSubscription = {
        id: 'old-sub',
        targetUrl: 'https://old.hook.com',
        createdAt: Date.now() - 90 * 24 * 60 * 60 * 1000, // 90 days ago
      }

      manager.registerSubscription(oldSubscription)

      expect(manager.hasSubscription('old-sub')).toBe(true)

      // Run cleanup for subscriptions older than 30 days
      const cleaned = manager.cleanupStale(30 * 24 * 60 * 60 * 1000)

      expect(cleaned).toBe(1)
      expect(manager.hasSubscription('old-sub')).toBe(false)
    })
  })

  // ============================================================================
  // performSubscribe/performUnsubscribe HOOKS
  // ============================================================================

  describe('performSubscribe Hook', () => {
    it('should pass targetUrl in bundle', async () => {
      let capturedTargetUrl: string | undefined

      const trigger = createHookTrigger({
        key: 'target_url_test',
        noun: 'Event',
        display: { label: 'Event', description: 'Target URL test' },
        performSubscribe: async (z, bundle) => {
          capturedTargetUrl = bundle.targetUrl
          return { id: 'sub-1' }
        },
        performUnsubscribe: async () => ({}),
        perform: async () => [],
      })

      const manager = new WebhookSubscriptionManager()
      const bundle: Bundle = {
        inputData: {},
        authData: {},
        targetUrl: 'https://hooks.zapier.com/hooks/standard/123/abc',
      }

      await manager.subscribe(trigger, z, bundle)

      expect(capturedTargetUrl).toBe('https://hooks.zapier.com/hooks/standard/123/abc')
    })

    it('should pass inputData in bundle for filtered subscriptions', async () => {
      let capturedInputData: Record<string, unknown> | undefined

      const trigger = createHookTrigger({
        key: 'filtered_sub',
        noun: 'Order',
        display: { label: 'Order', description: 'Filtered orders' },
        performSubscribe: async (z, bundle) => {
          capturedInputData = bundle.inputData
          return { id: 'sub-1' }
        },
        performUnsubscribe: async () => ({}),
        perform: async () => [],
        inputFields: [
          { key: 'status', label: 'Order Status', choices: ['pending', 'completed', 'cancelled'] },
        ],
      })

      const manager = new WebhookSubscriptionManager()
      const bundle: Bundle = {
        inputData: { status: 'completed' },
        authData: {},
        targetUrl: 'https://hooks.zapier.com/123',
      }

      await manager.subscribe(trigger, z, bundle)

      expect(capturedInputData?.status).toBe('completed')
    })

    it('should pass authData in bundle', async () => {
      let capturedAuthData: Record<string, unknown> | undefined

      const trigger = createHookTrigger({
        key: 'auth_test',
        noun: 'Event',
        display: { label: 'Event', description: 'Auth test' },
        performSubscribe: async (z, bundle) => {
          capturedAuthData = bundle.authData
          return { id: 'sub-1' }
        },
        performUnsubscribe: async () => ({}),
        perform: async () => [],
      })

      const manager = new WebhookSubscriptionManager()
      const bundle: Bundle = {
        inputData: {},
        authData: { access_token: 'secret-token', account_id: 'acc-123' },
        targetUrl: 'https://hooks.zapier.com/123',
      }

      await manager.subscribe(trigger, z, bundle)

      expect(capturedAuthData?.access_token).toBe('secret-token')
      expect(capturedAuthData?.account_id).toBe('acc-123')
    })

    it('should return object with required id field', async () => {
      const trigger = createHookTrigger({
        key: 'id_required',
        noun: 'Event',
        display: { label: 'Event', description: 'ID required' },
        performSubscribe: async () => ({
          id: 'webhook-id-123',
          additionalField: 'extra-data',
        }),
        performUnsubscribe: async () => ({}),
        perform: async () => [],
      })

      const manager = new WebhookSubscriptionManager()
      const bundle: Bundle = {
        inputData: {},
        authData: {},
        targetUrl: 'https://hooks.zapier.com/123',
      }

      const result = await manager.subscribe(trigger, z, bundle)

      expect(result.id).toBe('webhook-id-123')
      expect(result.metadata?.additionalField).toBe('extra-data')
    })
  })

  describe('performUnsubscribe Hook', () => {
    it('should pass subscribeData in bundle', async () => {
      let capturedSubscribeData: Record<string, unknown> | undefined

      const trigger = createHookTrigger({
        key: 'unsub_data_test',
        noun: 'Event',
        display: { label: 'Event', description: 'Unsubscribe data test' },
        performSubscribe: async () => ({ id: 'sub-123', webhookSecret: 'secret' }),
        performUnsubscribe: async (z, bundle) => {
          capturedSubscribeData = bundle.subscribeData
          return {}
        },
        perform: async () => [],
      })

      const manager = new WebhookSubscriptionManager()

      // First subscribe
      const subscribeBundle: Bundle = {
        inputData: {},
        authData: {},
        targetUrl: 'https://hooks.zapier.com/123',
      }
      await manager.subscribe(trigger, z, subscribeBundle)

      // Then unsubscribe
      const unsubscribeBundle: Bundle = {
        inputData: {},
        authData: {},
        subscribeData: { id: 'sub-123', webhookSecret: 'secret' },
      }
      await manager.unsubscribe(trigger, z, unsubscribeBundle)

      expect(capturedSubscribeData?.id).toBe('sub-123')
      expect(capturedSubscribeData?.webhookSecret).toBe('secret')
    })

    it('should make DELETE request to webhook endpoint', async () => {
      const trigger = createHookTrigger({
        key: 'delete_webhook',
        noun: 'Event',
        display: { label: 'Event', description: 'Delete webhook' },
        performSubscribe: async () => ({ id: 'hook-456' }),
        performUnsubscribe: async (z, bundle) => {
          const hookId = (bundle.subscribeData as { id: string }).id
          await z.request({
            url: `https://api.example.com/webhooks/${hookId}`,
            method: 'DELETE',
            skipThrowForStatus: true,
          })
          return {}
        },
        perform: async () => [],
      })

      const manager = new WebhookSubscriptionManager()

      // Subscribe
      await manager.subscribe(trigger, z, {
        inputData: {},
        authData: {},
        targetUrl: 'https://hooks.zapier.com/123',
      })

      // Unsubscribe
      await manager.unsubscribe(trigger, z, {
        inputData: {},
        authData: {},
        subscribeData: { id: 'hook-456' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/webhooks/hook-456',
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('should handle unsubscribe failures gracefully', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'hook-1' }), { status: 200 })
      )
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
      )

      const trigger = createHookTrigger({
        key: 'unsub_fail',
        noun: 'Event',
        display: { label: 'Event', description: 'Unsubscribe failure' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/webhooks/hook-1',
            method: 'DELETE',
            skipThrowForStatus: true,
          })
          // Should not throw even if webhook already deleted
          if (response.status === 404) {
            return {} // Already deleted, that's fine
          }
          return response.data
        },
        perform: async () => [],
      })

      const manager = new WebhookSubscriptionManager()

      await manager.subscribe(trigger, z, {
        inputData: {},
        authData: {},
        targetUrl: 'https://hooks.zapier.com/123',
      })

      // Should not throw
      await expect(
        manager.unsubscribe(trigger, z, {
          inputData: {},
          authData: {},
          subscribeData: { id: 'hook-1' },
        })
      ).resolves.not.toThrow()
    })
  })

  // ============================================================================
  // SAMPLE DATA FOR ZAP EDITOR
  // ============================================================================

  describe('Sample Data for Zap Editor', () => {
    it('should return static sample data when defined', async () => {
      const trigger = createHookTrigger({
        key: 'static_sample',
        noun: 'Order',
        display: { label: 'Order', description: 'Orders' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => [bundle.cleanedRequest],
        sample: {
          id: 'order-sample-123',
          customer_email: 'sample@example.com',
          total: 99.99,
          currency: 'USD',
          status: 'completed',
          created_at: '2024-01-15T10:00:00Z',
        },
      })

      const triggerInstance = new Trigger(trigger)
      const sample = triggerInstance.getSample()

      expect(sample).toMatchObject({
        id: 'order-sample-123',
        customer_email: 'sample@example.com',
        total: 99.99,
      })
    })

    it('should use performList to fetch real sample data', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: 'real-1', name: 'Real Order 1' },
            { id: 'real-2', name: 'Real Order 2' },
          ]),
          { status: 200 }
        )
      )

      const trigger = createHookTrigger({
        key: 'performlist_sample',
        noun: 'Order',
        display: { label: 'Order', description: 'Orders' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => [bundle.cleanedRequest],
        performList: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/orders',
            params: { limit: '3', sort: 'created_at:desc' },
            skipThrowForStatus: true,
          })
          return response.data as unknown[]
        },
      })

      const manager = new WebhookTriggerManager()
      const bundle: Bundle = { inputData: {}, authData: {} }

      const samples = await manager.getSamples(new Trigger(trigger), z, bundle)

      expect(samples).toHaveLength(2)
      expect(samples[0]).toMatchObject({ id: 'real-1', name: 'Real Order 1' })
    })

    it('should fall back to static sample when performList fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const trigger = createHookTrigger({
        key: 'sample_fallback',
        noun: 'Order',
        display: { label: 'Order', description: 'Orders' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => [bundle.cleanedRequest],
        performList: async (z) => {
          const response = await z.request('https://api.example.com/orders')
          return response.data as unknown[]
        },
        sample: {
          id: 'fallback-sample',
          name: 'Sample Order',
        },
      })

      const manager = new WebhookTriggerManager()
      const bundle: Bundle = { inputData: {}, authData: {} }

      const samples = await manager.getSamples(new Trigger(trigger), z, bundle)

      expect(samples).toHaveLength(1)
      expect(samples[0]).toMatchObject({ id: 'fallback-sample' })
    })

    it('should return empty array when no sample data available', async () => {
      const trigger = createHookTrigger({
        key: 'no_sample',
        noun: 'Event',
        display: { label: 'Event', description: 'Events' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async () => [],
        // No sample or performList defined
      })

      const manager = new WebhookTriggerManager()
      const bundle: Bundle = { inputData: {}, authData: {} }

      const samples = await manager.getSamples(new Trigger(trigger), z, bundle)

      expect(samples).toEqual([])
    })

    it('should respect meta.isLoadingSample flag', async () => {
      let wasLoadingSample = false

      const trigger = createHookTrigger({
        key: 'loading_sample',
        noun: 'Order',
        display: { label: 'Order', description: 'Orders' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async () => [],
        performList: async (z, bundle) => {
          wasLoadingSample = bundle.meta?.isLoadingSample || false
          return [{ id: 'sample-1' }]
        },
      })

      const manager = new WebhookTriggerManager()
      const bundle: Bundle = {
        inputData: {},
        authData: {},
        meta: { isLoadingSample: true },
      }

      await manager.getSamples(new Trigger(trigger), z, bundle)

      expect(wasLoadingSample).toBe(true)
    })
  })

  // ============================================================================
  // WEBHOOK VERIFICATION HANDSHAKE
  // ============================================================================

  describe('Webhook Verification Handshake', () => {
    it('should validate HMAC SHA256 signature', async () => {
      const handler = new WebhookHandler()
      const payload = JSON.stringify({ event: 'test', data: {} })
      const secret = 'webhook-secret-123'

      // Generate valid signature
      const encoder = new TextEncoder()
      const keyData = encoder.encode(secret)
      const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
      const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
      const signature = Array.from(new Uint8Array(signatureBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const isValid = await handler.validateSignature(payload, signature, secret, 'sha256')

      expect(isValid).toBe(true)
    })

    it('should reject invalid HMAC signature', async () => {
      const handler = new WebhookHandler()
      const payload = JSON.stringify({ event: 'test' })
      const secret = 'webhook-secret-123'
      const invalidSignature = 'invalid-signature-abc123'

      const isValid = await handler.validateSignature(payload, invalidSignature, secret, 'sha256')

      expect(isValid).toBe(false)
    })

    it('should handle signature with sha256= prefix', async () => {
      const handler = new WebhookHandler()
      const payload = '{"test": true}'
      const secret = 'secret'

      const encoder = new TextEncoder()
      const keyData = encoder.encode(secret)
      const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
      const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
      const rawSignature = Array.from(new Uint8Array(signatureBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const isValid = await handler.validateSignature(payload, `sha256=${rawSignature}`, secret, 'sha256')

      expect(isValid).toBe(true)
    })

    it('should respond to verification challenge requests', async () => {
      const trigger = createHookTrigger({
        key: 'verify_challenge',
        noun: 'Event',
        display: { label: 'Event', description: 'Challenge verification' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => {
          // Handle verification challenge
          const request = bundle.cleanedRequest as Record<string, unknown>
          if (request.type === 'url_verification') {
            return [{ challenge: request.challenge }]
          }
          return [request]
        },
      })

      const handler = new WebhookHandler()
      const request = new Request('https://hooks.zapier.com/123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'url_verification',
          challenge: 'challenge-token-xyz',
        }),
      })

      const result = await handler.handleRequest(request, trigger, z)

      expect(result.data[0]).toMatchObject({ challenge: 'challenge-token-xyz' })
    })

    it('should verify webhook source by IP allowlist', async () => {
      const handler = new WebhookHandler()

      // Register allowed IP ranges
      handler.setAllowedIPs([
        '192.168.1.0/24',
        '10.0.0.1',
      ])

      expect(handler.isIPAllowed('192.168.1.100')).toBe(true)
      expect(handler.isIPAllowed('10.0.0.1')).toBe(true)
      expect(handler.isIPAllowed('172.16.0.1')).toBe(false)
    })
  })

  // ============================================================================
  // PERFORMLIST FOR INITIAL DATA FETCH
  // ============================================================================

  describe('performList for Initial Data Fetch', () => {
    it('should fetch recent records when Zap is enabled', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: '1', created_at: '2024-01-15T12:00:00Z' },
            { id: '2', created_at: '2024-01-15T11:00:00Z' },
            { id: '3', created_at: '2024-01-15T10:00:00Z' },
          ]),
          { status: 200 }
        )
      )

      const trigger = createHookTrigger({
        key: 'initial_fetch',
        noun: 'Order',
        display: { label: 'Order', description: 'Orders' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => [bundle.cleanedRequest],
        performList: async (z, bundle) => {
          const limit = bundle.meta?.limit || 100
          const response = await z.request({
            url: 'https://api.example.com/orders',
            params: { limit: String(limit), sort: '-created_at' },
            skipThrowForStatus: true,
          })
          return response.data as unknown[]
        },
      })

      const manager = new WebhookTriggerManager()
      const bundle: Bundle = {
        inputData: {},
        authData: {},
        meta: { limit: 100 },
      }

      const results = await manager.getSamples(new Trigger(trigger), z, bundle)

      expect(results).toHaveLength(3)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=100'),
        expect.anything()
      )
    })

    it('should use inputData filters in performList', async () => {
      let capturedParams: Record<string, string> | undefined

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: '1' }]), { status: 200 })
      )

      const trigger = createHookTrigger({
        key: 'filtered_list',
        noun: 'Order',
        display: { label: 'Order', description: 'Filtered orders' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async () => [],
        performList: async (z, bundle) => {
          capturedParams = {
            status: bundle.inputData.status as string,
          }
          const response = await z.request({
            url: 'https://api.example.com/orders',
            params: capturedParams,
            skipThrowForStatus: true,
          })
          return response.data as unknown[]
        },
        inputFields: [
          { key: 'status', label: 'Status', choices: ['pending', 'completed'] },
        ],
      })

      const manager = new WebhookTriggerManager()
      const bundle: Bundle = {
        inputData: { status: 'completed' },
        authData: {},
      }

      await manager.getSamples(new Trigger(trigger), z, bundle)

      expect(capturedParams?.status).toBe('completed')
    })

    it('should handle pagination in performList', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: '1' }, { id: '2' }],
            nextCursor: 'cursor-abc',
          }),
          { status: 200 }
        )
      )

      const trigger = createHookTrigger({
        key: 'paginated_list',
        noun: 'Item',
        display: { label: 'Item', description: 'Paginated items' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async () => [],
        performList: async (z, bundle) => {
          const cursor = await z.cursor.get()
          const response = await z.request({
            url: 'https://api.example.com/items',
            params: cursor ? { cursor } : {},
            skipThrowForStatus: true,
          })
          const data = response.data as { data: unknown[]; nextCursor?: string }
          if (data.nextCursor) {
            await z.cursor.set(data.nextCursor)
          }
          return data.data
        },
      })

      const manager = new WebhookTriggerManager()
      const bundle: Bundle = { inputData: {}, authData: {} }

      const results = await manager.getSamples(new Trigger(trigger), z, bundle)

      expect(results).toHaveLength(2)
    })

    it('should deduplicate results from performList', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: '1', name: 'Item 1' },
            { id: '2', name: 'Item 2' },
            { id: '1', name: 'Item 1 Duplicate' }, // Duplicate
          ]),
          { status: 200 }
        )
      )

      const trigger = createHookTrigger({
        key: 'dedupe_list',
        noun: 'Item',
        display: { label: 'Item', description: 'Deduped items' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async () => [],
        performList: async (z) => {
          const response = await z.request({
            url: 'https://api.example.com/items',
            skipThrowForStatus: true,
          })
          return response.data as unknown[]
        },
      })

      const manager = new WebhookTriggerManager()
      const bundle: Bundle = { inputData: {}, authData: {} }

      const results = await manager.getSamples(new Trigger(trigger), z, bundle)

      // Should be deduplicated by id
      const uniqueIds = new Set(results.map((r: any) => r.id))
      expect(uniqueIds.size).toBe(results.length)
    })
  })

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================

  describe('Integration Tests', () => {
    it('should complete full webhook trigger flow', async () => {
      const eventLog: string[] = []

      // Mock external API
      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 'webhook-integration-123' }), { status: 201 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify([{ id: 'recent-1' }]), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(null, { status: 200 })
        )

      const trigger = createHookTrigger({
        key: 'integration_test',
        noun: 'Order',
        display: { label: 'New Order', description: 'Triggers on new orders' },
        performSubscribe: async (z, bundle) => {
          eventLog.push('subscribe')
          const response = await z.request({
            url: 'https://api.shop.com/webhooks',
            method: 'POST',
            json: {
              url: bundle.targetUrl,
              events: ['order.created'],
            },
            skipThrowForStatus: true,
          })
          return response.data as { id: string }
        },
        performUnsubscribe: async (z, bundle) => {
          eventLog.push('unsubscribe')
          const webhookId = (bundle.subscribeData as { id: string }).id
          await z.request({
            url: `https://api.shop.com/webhooks/${webhookId}`,
            method: 'DELETE',
            skipThrowForStatus: true,
          })
        },
        perform: async (z, bundle) => {
          eventLog.push('perform')
          const order = bundle.cleanedRequest as Record<string, unknown>
          return [{
            id: order.id,
            customer_email: order.email,
            total: order.total,
            currency: order.currency,
          }]
        },
        performList: async (z) => {
          eventLog.push('performList')
          const response = await z.request({
            url: 'https://api.shop.com/orders?limit=3',
            skipThrowForStatus: true,
          })
          return response.data as unknown[]
        },
        sample: {
          id: 'order-sample',
          customer_email: 'sample@example.com',
          total: 99.99,
          currency: 'USD',
        },
      })

      const subscriptionManager = new WebhookSubscriptionManager()
      const triggerManager = new WebhookTriggerManager()
      const handler = new WebhookHandler()

      // Step 1: Subscribe to webhook
      const subscribeBundle: Bundle = {
        inputData: {},
        authData: { api_key: 'shop-api-key' },
        targetUrl: 'https://hooks.zapier.com/hooks/standard/123/abc',
      }

      const subscription = await subscriptionManager.subscribe(trigger, z, subscribeBundle)
      expect(subscription.id).toBe('webhook-integration-123')
      expect(eventLog).toContain('subscribe')

      // Step 2: Get sample data for Zap editor
      const sampleBundle: Bundle = {
        inputData: {},
        authData: { api_key: 'shop-api-key' },
        meta: { isLoadingSample: true },
      }

      const samples = await triggerManager.getSamples(new Trigger(trigger), z, sampleBundle)
      expect(samples.length).toBeGreaterThan(0)
      expect(eventLog).toContain('performList')

      // Step 3: Handle incoming webhook
      const webhookRequest = new Request('https://hooks.zapier.com/123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'order-789',
          email: 'customer@example.com',
          total: 149.99,
          currency: 'USD',
        }),
      })

      const webhookResult = await handler.handleRequest(webhookRequest, trigger, z)
      expect(webhookResult.status).toBe(200)
      expect(webhookResult.data[0]).toMatchObject({
        id: 'order-789',
        customer_email: 'customer@example.com',
        total: 149.99,
      })
      expect(eventLog).toContain('perform')

      // Step 4: Unsubscribe
      const unsubscribeBundle: Bundle = {
        inputData: {},
        authData: { api_key: 'shop-api-key' },
        subscribeData: { id: 'webhook-integration-123' },
      }

      await subscriptionManager.unsubscribe(trigger, z, unsubscribeBundle)
      expect(eventLog).toContain('unsubscribe')
    })

    it('should work within Zapier App definition', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ id: 'hook-app-test' }), { status: 200 })
      )

      const app = new App({
        version: '1.0.0',
        platformVersion: '14.0.0',
        triggers: {
          new_customer: createHookTrigger({
            key: 'new_customer',
            noun: 'Customer',
            display: { label: 'New Customer', description: 'Triggers on new customers' },
            performSubscribe: async (z, bundle) => {
              await z.request({
                url: 'https://api.crm.com/webhooks',
                method: 'POST',
                json: { url: bundle.targetUrl, event: 'customer.created' },
                skipThrowForStatus: true,
              })
              return { id: 'hook-app-test' }
            },
            performUnsubscribe: async () => ({}),
            perform: async (z, bundle) => [bundle.cleanedRequest],
            sample: {
              id: 'cust-sample',
              email: 'sample@example.com',
              name: 'Sample Customer',
            },
          }),
        },
        actions: {},
        searches: {},
      })

      // Validate app
      const validation = app.validate()
      expect(validation.valid).toBe(true)

      // Get trigger
      const trigger = app.getTrigger('new_customer')
      expect(trigger).toBeDefined()
      expect(trigger?.isHook()).toBe(true)

      // Get sample
      const sample = trigger?.getSample()
      expect(sample).toMatchObject({ id: 'cust-sample' })
    })
  })

  // ============================================================================
  // INPUT FIELD DEFINITIONS
  // ============================================================================

  describe('Input Field Definitions', () => {
    it('should define input fields for webhook trigger filtering', async () => {
      const trigger = createHookTrigger({
        key: 'filtered_webhook',
        noun: 'Event',
        display: { label: 'Event', description: 'Filtered events' },
        performSubscribe: async (z, bundle) => {
          // Input fields should be accessible for filtering webhook registration
          expect(bundle.inputData.event_type).toBeDefined()
          return { id: 'hook-1' }
        },
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => [bundle.cleanedRequest],
        inputFields: [
          {
            key: 'event_type',
            label: 'Event Type',
            type: 'string',
            required: true,
            choices: ['order.created', 'order.updated', 'order.cancelled'],
            helpText: 'Select which event type to trigger on',
          },
          {
            key: 'store_id',
            label: 'Store',
            type: 'string',
            dynamic: 'stores.id.name',
            helpText: 'Optionally filter by store',
          },
        ],
      })

      const triggerInstance = new Trigger(trigger)
      const inputFields = triggerInstance.getInputFields()

      expect(inputFields).toHaveLength(2)
      expect(inputFields[0].key).toBe('event_type')
      expect(inputFields[0].required).toBe(true)
      expect(inputFields[0].choices).toContain('order.created')
      expect(inputFields[1].dynamic).toBe('stores.id.name')
    })

    it('should support dynamic input fields that load from API', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: 'store-1', name: 'Main Store' },
            { id: 'store-2', name: 'Outlet Store' },
          ]),
          { status: 200 }
        )
      )

      const trigger = createHookTrigger({
        key: 'dynamic_fields',
        noun: 'Event',
        display: { label: 'Event', description: 'Dynamic fields' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async () => [],
        inputFields: [
          async (z, bundle) => {
            const response = await z.request({
              url: 'https://api.example.com/stores',
              skipThrowForStatus: true,
            })
            const stores = response.data as Array<{ id: string; name: string }>
            return [{
              key: 'store_id',
              label: 'Store',
              choices: stores.map(s => ({ value: s.id, label: s.name })),
            }]
          },
        ],
      })

      const triggerInstance = new Trigger(trigger)
      const bundle: Bundle = { inputData: {}, authData: {} }

      const resolvedFields = await triggerInstance.resolveInputFields(z, bundle)

      expect(resolvedFields).toHaveLength(1)
      expect(resolvedFields[0].choices).toHaveLength(2)
    })

    it('should validate required input fields before subscription', async () => {
      const trigger = createHookTrigger({
        key: 'validated_fields',
        noun: 'Event',
        display: { label: 'Event', description: 'Validated fields' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async () => [],
        inputFields: [
          { key: 'required_field', label: 'Required', required: true },
          { key: 'optional_field', label: 'Optional' },
        ],
      })

      const triggerInstance = new Trigger(trigger)

      // Missing required field should fail validation
      const validation1 = triggerInstance.validateInput({ optional_field: 'value' })
      expect(validation1.valid).toBe(false)
      expect(validation1.errors).toContain('required_field is required')

      // With required field should pass
      const validation2 = triggerInstance.validateInput({
        required_field: 'present',
        optional_field: 'value',
      })
      expect(validation2.valid).toBe(true)
    })

    it('should support altersDynamicFields for cascading dropdowns', async () => {
      let capturedCountry: string | undefined

      mockFetch.mockResolvedValue(
        new Response(JSON.stringify([{ id: 'ny', name: 'New York' }]), { status: 200 })
      )

      const trigger = createHookTrigger({
        key: 'cascading_fields',
        noun: 'Location',
        display: { label: 'Location', description: 'Location events' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async () => [],
        inputFields: [
          {
            key: 'country',
            label: 'Country',
            choices: ['US', 'CA', 'UK'],
            altersDynamicFields: true,
          },
          async (z, bundle) => {
            capturedCountry = bundle.inputData.country as string
            if (!capturedCountry) {
              return []
            }
            const response = await z.request({
              url: `https://api.example.com/states?country=${capturedCountry}`,
              skipThrowForStatus: true,
            })
            return [{
              key: 'state',
              label: 'State/Province',
              choices: (response.data as any[]).map(s => ({ value: s.id, label: s.name })),
            }]
          },
        ],
      })

      const triggerInstance = new Trigger(trigger)
      const bundle: Bundle = { inputData: { country: 'US' }, authData: {} }

      const resolvedFields = await triggerInstance.resolveInputFields(z, bundle)

      expect(capturedCountry).toBe('US')
      expect(resolvedFields.find(f => f.key === 'state')).toBeDefined()
    })

    it('should support list input fields for multiple values', async () => {
      const trigger = createHookTrigger({
        key: 'list_fields',
        noun: 'Event',
        display: { label: 'Event', description: 'List fields' },
        performSubscribe: async (z, bundle) => {
          const tags = bundle.inputData.tags as string[]
          expect(Array.isArray(tags)).toBe(true)
          return { id: 'hook-1' }
        },
        performUnsubscribe: async () => ({}),
        perform: async () => [],
        inputFields: [
          {
            key: 'tags',
            label: 'Tags',
            type: 'string',
            list: true,
            helpText: 'Filter by tags (can select multiple)',
          },
        ],
      })

      const manager = new WebhookSubscriptionManager()
      const bundle: Bundle = {
        inputData: { tags: ['urgent', 'important', 'follow-up'] },
        authData: {},
        targetUrl: 'https://hooks.zapier.com/123',
      }

      await manager.subscribe(trigger, z, bundle)
    })
  })

  // ============================================================================
  // AUTHENTICATION HEADER INJECTION
  // ============================================================================

  describe('Authentication Header Injection', () => {
    it('should inject Bearer token from authData', async () => {
      let capturedHeaders: Record<string, string> | undefined

      const trigger = createHookTrigger({
        key: 'bearer_auth',
        noun: 'Event',
        display: { label: 'Event', description: 'Bearer auth events' },
        performSubscribe: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/webhooks',
            method: 'POST',
            headers: {
              Authorization: `Bearer ${bundle.authData.access_token}`,
            },
            json: { url: bundle.targetUrl },
            skipThrowForStatus: true,
          })
          capturedHeaders = Object.fromEntries(
            mockFetch.mock.calls[0][1].headers.entries?.() || []
          )
          return response.data as { id: string }
        },
        performUnsubscribe: async () => ({}),
        perform: async () => [],
      })

      const manager = new WebhookSubscriptionManager()
      const bundle: Bundle = {
        inputData: {},
        authData: { access_token: 'oauth-token-xyz' },
        targetUrl: 'https://hooks.zapier.com/123',
      }

      await manager.subscribe(trigger, z, bundle)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/webhooks',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer oauth-token-xyz',
          }),
        })
      )
    })

    it('should inject API key from authData into headers', async () => {
      const trigger = createHookTrigger({
        key: 'api_key_auth',
        noun: 'Event',
        display: { label: 'Event', description: 'API key events' },
        performSubscribe: async (z, bundle) => {
          await z.request({
            url: 'https://api.example.com/webhooks',
            method: 'POST',
            headers: {
              'X-API-Key': bundle.authData.api_key as string,
            },
            json: { url: bundle.targetUrl },
            skipThrowForStatus: true,
          })
          return { id: 'hook-1' }
        },
        performUnsubscribe: async () => ({}),
        perform: async () => [],
      })

      const manager = new WebhookSubscriptionManager()
      const bundle: Bundle = {
        inputData: {},
        authData: { api_key: 'secret-api-key-123' },
        targetUrl: 'https://hooks.zapier.com/123',
      }

      await manager.subscribe(trigger, z, bundle)

      // Verify the request included the API key header
      const requestCall = mockFetch.mock.calls[0]
      expect(requestCall).toBeDefined()
    })

    it('should inject Basic auth from authData', async () => {
      const trigger = createHookTrigger({
        key: 'basic_auth',
        noun: 'Event',
        display: { label: 'Event', description: 'Basic auth events' },
        performSubscribe: async (z, bundle) => {
          const credentials = btoa(
            `${bundle.authData.username}:${bundle.authData.password}`
          )
          await z.request({
            url: 'https://api.example.com/webhooks',
            method: 'POST',
            headers: {
              Authorization: `Basic ${credentials}`,
            },
            json: { url: bundle.targetUrl },
            skipThrowForStatus: true,
          })
          return { id: 'hook-1' }
        },
        performUnsubscribe: async () => ({}),
        perform: async () => [],
      })

      const manager = new WebhookSubscriptionManager()
      const bundle: Bundle = {
        inputData: {},
        authData: { username: 'user', password: 'secret' },
        targetUrl: 'https://hooks.zapier.com/123',
      }

      await manager.subscribe(trigger, z, bundle)

      expect(mockFetch).toHaveBeenCalled()
    })

    it('should include session token from authData', async () => {
      const trigger = createHookTrigger({
        key: 'session_auth',
        noun: 'Event',
        display: { label: 'Event', description: 'Session auth events' },
        performSubscribe: async (z, bundle) => {
          await z.request({
            url: 'https://api.example.com/webhooks',
            method: 'POST',
            headers: {
              'X-Session-Token': bundle.authData.sessionKey as string,
            },
            json: { url: bundle.targetUrl },
            skipThrowForStatus: true,
          })
          return { id: 'hook-1' }
        },
        performUnsubscribe: async () => ({}),
        perform: async () => [],
      })

      const manager = new WebhookSubscriptionManager()
      const bundle: Bundle = {
        inputData: {},
        authData: { sessionKey: 'session-token-abc' },
        targetUrl: 'https://hooks.zapier.com/123',
      }

      await manager.subscribe(trigger, z, bundle)
    })

    it('should use authData in webhook handler for authenticated endpoints', async () => {
      const trigger = createHookTrigger({
        key: 'auth_handler',
        noun: 'Event',
        display: { label: 'Event', description: 'Auth handler' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => {
          // Access authData to make authenticated downstream calls
          if (bundle.authData.access_token) {
            await z.request({
              url: 'https://api.example.com/enrich',
              headers: {
                Authorization: `Bearer ${bundle.authData.access_token}`,
              },
              json: bundle.cleanedRequest,
              skipThrowForStatus: true,
            })
          }
          return [bundle.cleanedRequest]
        },
      })

      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ enriched: true }), { status: 200 })
      )

      const handler = new WebhookHandler()
      const request = new Request('https://hooks.zapier.com/123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'test' }),
      })

      await handler.handleRequest(request, trigger, z, { access_token: 'token-123' })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('should throw ExpiredAuthError when token is expired', async () => {
      const trigger = createHookTrigger({
        key: 'expired_auth',
        noun: 'Event',
        display: { label: 'Event', description: 'Expired auth' },
        performSubscribe: async (z, bundle) => {
          // Simulate checking token expiration
          const expiresAt = bundle.authData.expires_at as number
          if (expiresAt && expiresAt < Date.now()) {
            throw new z.errors.ExpiredAuthError('OAuth token has expired')
          }
          return { id: 'hook-1' }
        },
        performUnsubscribe: async () => ({}),
        perform: async () => [],
      })

      const manager = new WebhookSubscriptionManager()
      const bundle: Bundle = {
        inputData: {},
        authData: {
          access_token: 'expired-token',
          expires_at: Date.now() - 3600000, // Expired 1 hour ago
        },
        targetUrl: 'https://hooks.zapier.com/123',
      }

      await expect(manager.subscribe(trigger, z, bundle)).rejects.toThrow(
        'OAuth token has expired'
      )
    })
  })

  // ============================================================================
  // BUNDLE CONTEXT (authData, inputData)
  // ============================================================================

  describe('Bundle Context (authData, inputData)', () => {
    it('should pass complete bundle context to performSubscribe', async () => {
      let capturedBundle: Bundle | undefined

      const trigger = createHookTrigger({
        key: 'bundle_context',
        noun: 'Event',
        display: { label: 'Event', description: 'Bundle context' },
        performSubscribe: async (z, bundle) => {
          capturedBundle = bundle
          return { id: 'hook-1' }
        },
        performUnsubscribe: async () => ({}),
        perform: async () => [],
      })

      const manager = new WebhookSubscriptionManager()
      const bundle: Bundle = {
        inputData: {
          event_type: 'order.created',
          priority: 'high',
        },
        authData: {
          access_token: 'token-123',
          account_id: 'acc-456',
          subdomain: 'mycompany',
        },
        targetUrl: 'https://hooks.zapier.com/hooks/standard/123/abc',
        meta: {
          zap: { id: 'zap-789', name: 'My Zap' },
        },
      }

      await manager.subscribe(trigger, z, bundle)

      expect(capturedBundle).toBeDefined()
      expect(capturedBundle?.inputData).toEqual({
        event_type: 'order.created',
        priority: 'high',
      })
      expect(capturedBundle?.authData).toEqual({
        access_token: 'token-123',
        account_id: 'acc-456',
        subdomain: 'mycompany',
      })
      expect(capturedBundle?.targetUrl).toBe(
        'https://hooks.zapier.com/hooks/standard/123/abc'
      )
    })

    it('should pass subscribeData to performUnsubscribe', async () => {
      let capturedSubscribeData: Record<string, unknown> | undefined

      const trigger = createHookTrigger({
        key: 'subscribe_data',
        noun: 'Event',
        display: { label: 'Event', description: 'Subscribe data' },
        performSubscribe: async () => ({
          id: 'webhook-id-123',
          secret: 'signing-secret',
          endpoint: 'https://api.example.com/webhooks/123',
        }),
        performUnsubscribe: async (z, bundle) => {
          capturedSubscribeData = bundle.subscribeData
          return {}
        },
        perform: async () => [],
      })

      const manager = new WebhookSubscriptionManager()

      // Subscribe
      await manager.subscribe(trigger, z, {
        inputData: {},
        authData: {},
        targetUrl: 'https://hooks.zapier.com/123',
      })

      // Unsubscribe
      await manager.unsubscribe(trigger, z, {
        inputData: {},
        authData: {},
        subscribeData: {
          id: 'webhook-id-123',
          secret: 'signing-secret',
          endpoint: 'https://api.example.com/webhooks/123',
        },
      })

      expect(capturedSubscribeData).toBeDefined()
      expect(capturedSubscribeData?.id).toBe('webhook-id-123')
      expect(capturedSubscribeData?.secret).toBe('signing-secret')
    })

    it('should pass cleanedRequest and rawRequest to perform', async () => {
      let capturedCleanedRequest: Record<string, unknown> | undefined
      let capturedRawRequest: RawRequest | undefined

      const trigger = createHookTrigger({
        key: 'request_data',
        noun: 'Event',
        display: { label: 'Event', description: 'Request data' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => {
          capturedCleanedRequest = bundle.cleanedRequest
          capturedRawRequest = bundle.rawRequest
          return [bundle.cleanedRequest]
        },
      })

      const handler = new WebhookHandler()
      const request = new Request('https://hooks.zapier.com/123?source=api', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': 'secret-value',
          'User-Agent': 'Shopify-Webhooks/1.0',
        },
        body: JSON.stringify({
          id: 'order-123',
          event: 'order.created',
          data: { total: 99.99 },
        }),
      })

      await handler.handleRequest(request, trigger, z)

      expect(capturedCleanedRequest).toBeDefined()
      expect(capturedCleanedRequest?.event).toBe('order.created')
      expect(capturedRawRequest).toBeDefined()
      expect(capturedRawRequest?.method).toBe('POST')
      expect(capturedRawRequest?.headers['x-webhook-secret']).toBe('secret-value')
      expect(capturedRawRequest?.querystring).toBe('source=api')
    })

    it('should include meta.isLoadingSample in bundle for sample requests', async () => {
      let wasLoadingSample: boolean | undefined

      const trigger = createHookTrigger({
        key: 'sample_meta',
        noun: 'Event',
        display: { label: 'Event', description: 'Sample meta' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async () => [],
        performList: async (z, bundle) => {
          wasLoadingSample = bundle.meta?.isLoadingSample
          // Return limited data for samples
          return wasLoadingSample ? [{ id: 'sample-1' }] : []
        },
      })

      const manager = new WebhookTriggerManager()
      const bundle: Bundle = {
        inputData: {},
        authData: {},
        meta: { isLoadingSample: true },
      }

      await manager.getSamples(new Trigger(trigger), z, bundle)

      expect(wasLoadingSample).toBe(true)
    })
  })

  // ============================================================================
  // ERROR RESPONSE FORMATTING
  // ============================================================================

  describe('Error Response Formatting', () => {
    it('should format error response with status and message', () => {
      const response = webhookError(400, 'Invalid webhook payload')

      expect(response.status).toBe(400)
    })

    it('should format error response with error code', () => {
      const response = webhookError(422, 'Validation failed', 'VALIDATION_ERROR')

      expect(response.status).toBe(422)
    })

    it('should handle 401 unauthorized errors', () => {
      const response = webhookError(401, 'Invalid API key')

      expect(response.status).toBe(401)
    })

    it('should handle 403 forbidden errors', () => {
      const response = webhookError(403, 'Access denied to this resource')

      expect(response.status).toBe(403)
    })

    it('should handle 404 not found errors', () => {
      const response = webhookError(404, 'Webhook endpoint not found')

      expect(response.status).toBe(404)
    })

    it('should handle 429 rate limit errors', () => {
      const response = webhookError(429, 'Rate limit exceeded', 'RATE_LIMITED')

      expect(response.status).toBe(429)
    })

    it('should handle 500 internal server errors', () => {
      const response = webhookError(500, 'Internal server error')

      expect(response.status).toBe(500)
    })

    it('should format success response with data', () => {
      const response = webhookSuccess({
        processed: true,
        items_count: 3,
      })

      expect(response.status).toBe(200)
    })

    it('should handle webhook handler errors gracefully', async () => {
      const trigger = createHookTrigger({
        key: 'error_handler',
        noun: 'Event',
        display: { label: 'Event', description: 'Error handler' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async () => {
          throw new Error('Processing failed')
        },
      })

      const handler = new WebhookHandler()
      const request = new Request('https://hooks.zapier.com/123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
      })

      await expect(
        handler.handleRequest(request, trigger, z)
      ).rejects.toThrow('Processing failed')
    })

    it('should handle malformed JSON in webhook payload', async () => {
      const trigger = createHookTrigger({
        key: 'malformed_json',
        noun: 'Event',
        display: { label: 'Event', description: 'Malformed JSON' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => [bundle.cleanedRequest],
      })

      const handler = new WebhookHandler()
      const request = new Request('https://hooks.zapier.com/123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ invalid json }',
      })

      // Should handle gracefully without crashing
      const result = await handler.handleRequest(request, trigger, z)

      expect(result.status).toBe(200)
      expect(result.data).toHaveLength(1)
      // cleanedRequest should be empty object when JSON parse fails
      expect(result.data[0]).toEqual({})
    })

    it('should handle empty webhook payload', async () => {
      const trigger = createHookTrigger({
        key: 'empty_payload',
        noun: 'Ping',
        display: { label: 'Ping', description: 'Empty payload' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => [{
          received: true,
          timestamp: Date.now(),
        }],
      })

      const handler = new WebhookHandler()
      const request = new Request('https://hooks.zapier.com/123', {
        method: 'POST',
      })

      const result = await handler.handleRequest(request, trigger, z)

      expect(result.status).toBe(200)
      expect(result.data[0]).toHaveProperty('received', true)
    })

    it('should handle ThrottledError with retry delay', async () => {
      const trigger = createHookTrigger({
        key: 'throttled',
        noun: 'Event',
        display: { label: 'Event', description: 'Throttled' },
        performSubscribe: async (z) => {
          throw new z.errors.ThrottledError('Rate limit exceeded', 60000)
        },
        performUnsubscribe: async () => ({}),
        perform: async () => [],
      })

      const manager = new WebhookSubscriptionManager()
      const bundle: Bundle = {
        inputData: {},
        authData: {},
        targetUrl: 'https://hooks.zapier.com/123',
      }

      await expect(manager.subscribe(trigger, z, bundle)).rejects.toThrow(
        'Rate limit exceeded'
      )
    })

    it('should handle HaltedError to stop processing', async () => {
      const trigger = createHookTrigger({
        key: 'halted',
        noun: 'Event',
        display: { label: 'Event', description: 'Halted' },
        performSubscribe: async () => ({ id: 'hook-1' }),
        performUnsubscribe: async () => ({}),
        perform: async (z, bundle) => {
          const data = bundle.cleanedRequest as Record<string, unknown>
          if (data.should_halt) {
            throw new z.errors.HaltedError('User requested halt')
          }
          return [data]
        },
      })

      const handler = new WebhookHandler()
      const request = new Request('https://hooks.zapier.com/123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ should_halt: true }),
      })

      await expect(
        handler.handleRequest(request, trigger, z)
      ).rejects.toThrow('User requested halt')
    })

    it('should format ResponseError with original response details', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: 'Resource not found' }),
          { status: 404 }
        )
      )

      const trigger = createHookTrigger({
        key: 'response_error',
        noun: 'Event',
        display: { label: 'Event', description: 'Response error' },
        performSubscribe: async (z) => {
          // This should throw ResponseError due to 404
          const response = await z.request({
            url: 'https://api.example.com/webhooks',
            method: 'POST',
          })
          return response.data as { id: string }
        },
        performUnsubscribe: async () => ({}),
        perform: async () => [],
      })

      const manager = new WebhookSubscriptionManager()
      const bundle: Bundle = {
        inputData: {},
        authData: {},
        targetUrl: 'https://hooks.zapier.com/123',
      }

      await expect(manager.subscribe(trigger, z, bundle)).rejects.toThrow()
    })
  })
})
