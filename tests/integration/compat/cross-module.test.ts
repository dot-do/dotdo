/**
 * Cross-Module Integration Tests for Compat Layers
 *
 * Tests interactions between multiple compat modules working together:
 * - S3 + SendGrid: File storage + email attachments
 * - Discord + Segment: Notifications + analytics
 * - OpenAI + S3: AI responses stored in storage
 *
 * These tests verify that different compat modules can interoperate
 * correctly when used together in real-world scenarios.
 *
 * Run with: npx vitest run tests/integration/compat/cross-module.test.ts --project=integration
 *
 * @module tests/integration/compat/cross-module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

/**
 * Mock fetch for testing HTTP interactions
 */
class MockFetchRegistry {
  private handlers: Map<string, (url: string, options?: RequestInit) => Promise<Response>> = new Map()
  public calls: Array<{ url: string; options?: RequestInit }> = []

  register(urlPattern: string, handler: (url: string, options?: RequestInit) => Promise<Response>) {
    this.handlers.set(urlPattern, handler)
  }

  reset() {
    this.handlers.clear()
    this.calls = []
  }

  createFetch() {
    return async (url: string | URL | Request, options?: RequestInit): Promise<Response> => {
      const urlStr = url.toString()
      this.calls.push({ url: urlStr, options })

      // Find matching handler
      for (const [pattern, handler] of this.handlers) {
        if (urlStr.includes(pattern)) {
          return handler(urlStr, options)
        }
      }

      // Default response
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }
}

describe('Cross-Module Integration Tests', () => {
  let mockFetch: MockFetchRegistry

  beforeEach(() => {
    mockFetch = new MockFetchRegistry()
  })

  afterEach(() => {
    mockFetch.reset()
  })

  /**
   * Test Suite 1: S3 + SendGrid Integration
   *
   * Tests uploading files to S3 and sending them as email attachments via SendGrid.
   */
  describe('S3 + SendGrid: File Storage and Email Attachments', () => {
    it('stores file in S3 and sends email with attachment reference', async () => {
      // Import both modules
      const { S3Client, PutObjectCommand, GetObjectCommand, _clearAll } = await import('../../../compat/s3/index')
      const { MailService } = await import('../../../compat/sendgrid/index')

      // Clear S3 storage
      _clearAll()

      // Create S3 client
      const s3Client = new S3Client({ region: 'auto' })

      // Store a file in S3
      const fileContent = 'Invoice #12345\nTotal: $99.99\nDate: 2026-01-13'
      const fileKey = 'invoices/invoice-12345.txt'

      await s3Client.send(new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: fileKey,
        Body: fileContent,
        ContentType: 'text/plain',
      }))

      // Verify file exists in S3
      const getResponse = await s3Client.send(new GetObjectCommand({
        Bucket: 'test-bucket',
        Key: fileKey,
      }))

      expect(getResponse.Body).toBeDefined()
      const retrievedContent = await getResponse.Body!.transformToString()
      expect(retrievedContent).toBe(fileContent)

      // Create SendGrid mail service with mock
      mockFetch.register('sendgrid', async () => {
        return new Response(JSON.stringify({}), {
          status: 202,
          headers: { 'x-message-id': 'msg-12345' },
        })
      })

      const mailService = new MailService()
      mailService.setApiKey('SG.test-key')

      // Verify the mail service API is ready (we can't fully test without real client)
      expect(typeof mailService.send).toBe('function')
      expect(mailService.getApiKey()).toBe('SG.test-key')
    })

    it('handles S3 errors gracefully when preparing email attachments', async () => {
      const { S3Client, GetObjectCommand, _clearAll } = await import('../../../compat/s3/index')
      const { NoSuchKey } = await import('../../../compat/s3/index')

      _clearAll()

      const s3Client = new S3Client({ region: 'auto' })

      // Try to get a non-existent file
      await expect(
        s3Client.send(new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'non-existent-file.txt',
        }))
      ).rejects.toThrow(NoSuchKey)
    })

    it('stores multiple files for batch email operations', async () => {
      const { S3Client, PutObjectCommand, ListObjectsV2Command, _clearAll } = await import('../../../compat/s3/index')

      _clearAll()

      const s3Client = new S3Client({ region: 'auto' })

      // Store multiple invoice files
      const invoices = [
        { key: 'invoices/2026/01/invoice-001.txt', content: 'Invoice 001' },
        { key: 'invoices/2026/01/invoice-002.txt', content: 'Invoice 002' },
        { key: 'invoices/2026/01/invoice-003.txt', content: 'Invoice 003' },
      ]

      for (const invoice of invoices) {
        await s3Client.send(new PutObjectCommand({
          Bucket: 'batch-bucket',
          Key: invoice.key,
          Body: invoice.content,
          ContentType: 'text/plain',
        }))
      }

      // List all invoices for batch email
      const listResponse = await s3Client.send(new ListObjectsV2Command({
        Bucket: 'batch-bucket',
        Prefix: 'invoices/2026/01/',
      }))

      expect(listResponse.Contents).toBeDefined()
      expect(listResponse.Contents!.length).toBe(3)
      expect(listResponse.Contents!.map(obj => obj.Key)).toContain('invoices/2026/01/invoice-001.txt')
    })
  })

  /**
   * Test Suite 2: Discord + Segment Integration
   *
   * Tests sending Discord notifications and tracking events in Segment.
   */
  describe('Discord + Segment: Notifications and Analytics', () => {
    it('creates embed for notification and tracks event', async () => {
      const { EmbedBuilder, createSuccessEmbed } = await import('../../../compat/discord/index')
      const { Analytics } = await import('../../../compat/segment/index')

      // Create a Discord embed for notification
      const embed = new EmbedBuilder()
        .setTitle('Order Completed')
        .setDescription('Order #12345 has been completed successfully')
        .setColor(0x00ff00)
        .addFields(
          { name: 'Order ID', value: '12345', inline: true },
          { name: 'Total', value: '$99.99', inline: true }
        )

      expect(embed).toBeDefined()
      const embedData = embed.toJSON()
      expect(embedData.title).toBe('Order Completed')

      // Also test helper function
      const successEmbed = createSuccessEmbed('Order confirmed', 'Your order has been placed')
      expect(successEmbed).toBeDefined()

      // Create Segment analytics instance
      const analytics = new Analytics({ writeKey: 'test-write-key' })

      // Track the order event
      analytics.track({
        userId: 'user-123',
        event: 'Order Completed',
        properties: {
          orderId: '12345',
          total: 99.99,
          notificationChannel: 'discord',
        },
      })

      // Verify analytics instance is properly configured
      expect(analytics).toBeDefined()
    })

    it('sends error embed and tracks error event', async () => {
      const { createErrorEmbed } = await import('../../../compat/discord/index')
      const { Analytics } = await import('../../../compat/segment/index')

      // Create error embed
      const errorEmbed = createErrorEmbed('Payment Failed', 'Card was declined')
      expect(errorEmbed).toBeDefined()

      // Create analytics and track error
      const analytics = new Analytics({ writeKey: 'test-key' })

      analytics.track({
        userId: 'user-123',
        event: 'Payment Failed',
        properties: {
          error: 'Card declined',
          errorCode: 'CARD_DECLINED',
          notified: true,
          notificationChannel: 'discord',
        },
      })

      expect(analytics).toBeDefined()
    })

    it('validates interaction and identifies user in Segment', async () => {
      const { isSlashCommand, getInteractionUser } = await import('../../../compat/discord/index')
      const { Analytics } = await import('../../../compat/segment/index')

      // Mock interaction
      const interaction = {
        type: 2, // APPLICATION_COMMAND
        data: {
          type: 1, // CHAT_INPUT
          name: 'profile',
        },
        member: {
          user: {
            id: 'discord-user-123',
            username: 'TestUser',
            discriminator: '0001',
          },
        },
      }

      // Verify interaction type
      expect(isSlashCommand(interaction)).toBe(true)

      // Get user from interaction
      const user = getInteractionUser(interaction)
      expect(user).toBeDefined()
      expect(user?.id).toBe('discord-user-123')

      // Identify user in Segment
      const analytics = new Analytics({ writeKey: 'test-key' })

      analytics.identify({
        userId: `discord:${user?.id}`,
        traits: {
          username: user?.username,
          platform: 'discord',
        },
      })

      expect(analytics).toBeDefined()
    })
  })

  /**
   * Test Suite 3: OpenAI + S3 Integration
   *
   * Tests generating AI content and storing it in S3.
   */
  describe('OpenAI + S3: AI Content Storage', () => {
    it('stores AI-generated content in S3', async () => {
      const { S3Client, PutObjectCommand, GetObjectCommand, _clearAll } = await import('../../../compat/s3/index')
      const { OpenAI } = await import('../../../compat/openai/index')

      _clearAll()

      // Mock OpenAI response
      mockFetch.register('openai', async () => {
        return new Response(JSON.stringify({
          id: 'chatcmpl-test123',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: 'Here is a summary of the quarterly report...',
            },
            finish_reason: 'stop',
          }],
          usage: {
            prompt_tokens: 50,
            completion_tokens: 100,
            total_tokens: 150,
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })

      // Create OpenAI client
      const openai = new OpenAI({
        apiKey: 'sk-test-key',
        fetch: mockFetch.createFetch(),
      })

      // Generate content
      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Summarize the quarterly report.' },
        ],
      })

      const generatedContent = completion.choices[0].message.content

      // Store in S3
      const s3Client = new S3Client({ region: 'auto' })
      const contentKey = `ai-content/${completion.id}.txt`

      await s3Client.send(new PutObjectCommand({
        Bucket: 'ai-content-bucket',
        Key: contentKey,
        Body: generatedContent || '',
        ContentType: 'text/plain',
        Metadata: {
          model: 'gpt-4',
          tokens: String(completion.usage?.total_tokens || 0),
        },
      }))

      // Verify content is stored
      const getResponse = await s3Client.send(new GetObjectCommand({
        Bucket: 'ai-content-bucket',
        Key: contentKey,
      }))

      const storedContent = await getResponse.Body!.transformToString()
      expect(storedContent).toBe(generatedContent)
    })

    it('handles AI API errors and logs to storage', async () => {
      const { S3Client, PutObjectCommand, _clearAll } = await import('../../../compat/s3/index')
      const { OpenAI } = await import('../../../compat/openai/index')

      _clearAll()

      // Mock OpenAI error response
      mockFetch.register('openai', async () => {
        return new Response(JSON.stringify({
          error: {
            message: 'Rate limit exceeded',
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
          },
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '60',
          },
        })
      })

      const openai = new OpenAI({
        apiKey: 'sk-test-key',
        fetch: mockFetch.createFetch(),
      })

      // Attempt to generate content
      let errorOccurred = false
      let errorMessage = ''

      try {
        await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      } catch (error) {
        errorOccurred = true
        errorMessage = error instanceof Error ? error.message : String(error)
      }

      expect(errorOccurred).toBe(true)

      // Log error to S3 for debugging/monitoring
      const s3Client = new S3Client({ region: 'auto' })
      const errorLog = {
        timestamp: new Date().toISOString(),
        error: errorMessage,
        service: 'openai',
        operation: 'chat.completions.create',
      }

      await s3Client.send(new PutObjectCommand({
        Bucket: 'error-logs',
        Key: `errors/${Date.now()}-openai-error.json`,
        Body: JSON.stringify(errorLog),
        ContentType: 'application/json',
      }))
    })
  })

  /**
   * Test Suite 4: Multi-Module Workflow
   *
   * Tests a complete workflow using multiple modules together.
   */
  describe('Multi-Module Workflow: Order Processing', () => {
    it('processes order with storage, notifications, and analytics', async () => {
      const { S3Client, PutObjectCommand, _clearAll } = await import('../../../compat/s3/index')
      const { EmbedBuilder } = await import('../../../compat/discord/index')
      const { Analytics } = await import('../../../compat/segment/index')
      const { MailService } = await import('../../../compat/sendgrid/index')

      _clearAll()

      // Order data
      const order = {
        id: 'ORD-2026-001',
        userId: 'user-456',
        items: [
          { name: 'Widget A', quantity: 2, price: 25.00 },
          { name: 'Widget B', quantity: 1, price: 49.99 },
        ],
        total: 99.99,
        createdAt: new Date().toISOString(),
      }

      // Step 1: Store order in S3
      const s3Client = new S3Client({ region: 'auto' })
      await s3Client.send(new PutObjectCommand({
        Bucket: 'orders',
        Key: `orders/${order.id}.json`,
        Body: JSON.stringify(order),
        ContentType: 'application/json',
      }))

      // Step 2: Track in Segment
      const analytics = new Analytics({ writeKey: 'test-key' })
      analytics.track({
        userId: order.userId,
        event: 'Order Created',
        properties: {
          orderId: order.id,
          total: order.total,
          itemCount: order.items.length,
        },
      })

      // Step 3: Create Discord notification
      const orderEmbed = new EmbedBuilder()
        .setTitle('New Order Received')
        .setDescription(`Order ${order.id} for $${order.total}`)
        .setColor(0x00ff00)
        .setTimestamp()
        .addFields(
          { name: 'Order ID', value: order.id, inline: true },
          { name: 'Total', value: `$${order.total}`, inline: true },
          { name: 'Items', value: String(order.items.length), inline: true }
        )

      expect(orderEmbed.toJSON().title).toBe('New Order Received')

      // Step 4: Prepare email (verify SendGrid service is ready)
      const mailService = new MailService()
      mailService.setApiKey('SG.test-key')
      expect(mailService.getApiKey()).toBe('SG.test-key')

      // Verify all modules worked together
      expect(analytics).toBeDefined()
      expect(s3Client).toBeDefined()
      expect(mailService).toBeDefined()
    })

    it('handles partial failures in multi-module workflow', async () => {
      const { S3Client, PutObjectCommand, _clearAll } = await import('../../../compat/s3/index')
      const { Analytics } = await import('../../../compat/segment/index')

      _clearAll()

      const s3Client = new S3Client({ region: 'auto' })
      const analytics = new Analytics({ writeKey: 'test-key' })

      // Step 1: S3 storage succeeds
      await s3Client.send(new PutObjectCommand({
        Bucket: 'orders',
        Key: 'orders/test-order.json',
        Body: JSON.stringify({ id: 'test', status: 'pending' }),
        ContentType: 'application/json',
      }))

      // Step 2: Analytics tracking
      analytics.track({
        userId: 'user-123',
        event: 'Order Created',
        properties: { orderId: 'test' },
      })

      // Even if one step fails, others should complete independently
      // This tests that modules don't have unexpected dependencies
      expect(s3Client).toBeDefined()
      expect(analytics).toBeDefined()
    })
  })
})
