/**
 * Resend Client Tests
 *
 * Tests for the Resend-compatible client with full API coverage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('ResendClient', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      headers: new Headers(),
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('Configuration', () => {
    it('should accept API key', async () => {
      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })
      expect(client).toBeDefined()
    })

    it('should support custom base URL', async () => {
      const { ResendClient } = await import('../client')
      const client = new ResendClient({
        apiKey: 're_test_key',
        baseUrl: 'https://custom-api.resend.com',
      })
      expect(client).toBeDefined()
    })

    it('should support timeout configuration', async () => {
      const { ResendClient } = await import('../client')
      const client = new ResendClient({
        apiKey: 're_test_key',
        timeout: 30000,
      })
      expect(client).toBeDefined()
    })
  })

  describe('Emails API', () => {
    it('should expose emails resource', async () => {
      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })
      expect(client.emails).toBeDefined()
      expect(typeof client.emails.send).toBe('function')
    })

    it('should send email successfully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'email_123' }),
        headers: new Headers(),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.emails.send({
        from: 'sender@example.com',
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      })

      expect(error).toBeNull()
      expect(data?.id).toBe('email_123')
    })

    it('should send email with text content', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'email_124' }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.emails.send({
        from: 'sender@example.com',
        to: 'user@example.com',
        subject: 'Test',
        text: 'Hello World',
      })

      expect(error).toBeNull()
      expect(data?.id).toBe('email_124')
    })

    it('should send email with multiple recipients', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'email_125' }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.emails.send({
        from: 'sender@example.com',
        to: ['user1@example.com', 'user2@example.com'],
        subject: 'Test',
        html: '<p>Hello</p>',
      })

      expect(error).toBeNull()
      expect(data?.id).toBe('email_125')
    })

    it('should send email with CC and BCC', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'email_126' }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.emails.send({
        from: 'sender@example.com',
        to: 'user@example.com',
        cc: 'cc@example.com',
        bcc: ['bcc1@example.com', 'bcc2@example.com'],
        subject: 'Test',
        html: '<p>Hello</p>',
      })

      expect(error).toBeNull()
      expect(data?.id).toBe('email_126')
    })

    it('should send email with reply-to', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'email_127' }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.emails.send({
        from: 'sender@example.com',
        to: 'user@example.com',
        reply_to: 'reply@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      })

      expect(error).toBeNull()
      expect(data?.id).toBe('email_127')
    })

    it('should send email with attachments', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'email_128' }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.emails.send({
        from: 'sender@example.com',
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
        attachments: [
          {
            filename: 'test.txt',
            content: 'SGVsbG8gV29ybGQ=',
            content_type: 'text/plain',
          },
        ],
      })

      expect(error).toBeNull()
      expect(data?.id).toBe('email_128')
    })

    it('should send email with tags', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'email_129' }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.emails.send({
        from: 'sender@example.com',
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
        tags: [
          { name: 'campaign', value: 'promo' },
          { name: 'source', value: 'newsletter' },
        ],
      })

      expect(error).toBeNull()
      expect(data?.id).toBe('email_129')
    })

    it('should send scheduled email', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'email_130' }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const scheduledAt = new Date(Date.now() + 3600000).toISOString()
      const { data, error } = await client.emails.send({
        from: 'sender@example.com',
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
        scheduled_at: scheduledAt,
      })

      expect(error).toBeNull()
      expect(data?.id).toBe('email_130')
    })

    it('should send email with custom headers', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'email_131' }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.emails.send({
        from: 'sender@example.com',
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
        headers: {
          'X-Custom-Header': 'custom-value',
        },
      })

      expect(error).toBeNull()
      expect(data?.id).toBe('email_131')
    })

    it('should return validation error for missing from', async () => {
      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.emails.send({
        from: '',
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      })

      expect(data).toBeNull()
      expect(error?.message).toContain('from')
    })

    it('should return validation error for missing to', async () => {
      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.emails.send({
        from: 'sender@example.com',
        to: '',
        subject: 'Test',
        html: '<p>Hello</p>',
      })

      expect(data).toBeNull()
      expect(error?.message).toContain('to')
    })

    it('should return validation error for missing subject', async () => {
      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.emails.send({
        from: 'sender@example.com',
        to: 'user@example.com',
        subject: '',
        html: '<p>Hello</p>',
      })

      expect(data).toBeNull()
      expect(error?.message).toContain('subject')
    })

    it('should return validation error for missing content', async () => {
      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.emails.send({
        from: 'sender@example.com',
        to: 'user@example.com',
        subject: 'Test',
      } as any)

      expect(data).toBeNull()
      expect(error?.message).toContain('html')
    })

    it('should return validation error for invalid from email', async () => {
      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.emails.send({
        from: 'invalid-email',
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      })

      expect(data).toBeNull()
      expect(error?.message).toContain('valid email')
    })

    it('should accept "Name <email>" format', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'email_132' }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.emails.send({
        from: 'Sender Name <sender@example.com>',
        to: 'User Name <user@example.com>',
        subject: 'Test',
        html: '<p>Hello</p>',
      })

      expect(error).toBeNull()
      expect(data?.id).toBe('email_132')
    })

    it('should get email by ID', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'email_123',
          object: 'email',
          to: ['user@example.com'],
          from: 'sender@example.com',
          created_at: '2024-01-01T00:00:00Z',
          subject: 'Test',
          last_event: 'delivered',
        }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.emails.get('email_123')

      expect(error).toBeNull()
      expect(data?.id).toBe('email_123')
      expect(data?.last_event).toBe('delivered')
    })

    it('should cancel scheduled email', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'email_123' }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.emails.cancel('email_123')

      expect(error).toBeNull()
      expect(data?.id).toBe('email_123')
    })
  })

  describe('Batch API', () => {
    it('should expose batch resource', async () => {
      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })
      expect(client.batch).toBeDefined()
      expect(typeof client.batch.send).toBe('function')
    })

    it('should send batch emails', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: 'email_1' }, { id: 'email_2' }],
        }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.batch.send([
        {
          from: 'sender@example.com',
          to: 'user1@example.com',
          subject: 'Test 1',
          html: '<p>Hello 1</p>',
        },
        {
          from: 'sender@example.com',
          to: 'user2@example.com',
          subject: 'Test 2',
          html: '<p>Hello 2</p>',
        },
      ])

      expect(error).toBeNull()
      expect(data?.data).toHaveLength(2)
    })

    it('should return error for empty batch', async () => {
      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.batch.send([])

      expect(data).toBeNull()
      expect(error?.message).toContain('At least one email')
    })

    it('should return error for batch exceeding limit', async () => {
      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const emails = Array.from({ length: 101 }, (_, i) => ({
        from: 'sender@example.com',
        to: `user${i}@example.com`,
        subject: `Test ${i}`,
        html: `<p>Hello ${i}</p>`,
      }))

      const { data, error } = await client.batch.send(emails)

      expect(data).toBeNull()
      expect(error?.message).toContain('Maximum 100')
    })
  })

  describe('Domains API', () => {
    it('should expose domains resource', async () => {
      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })
      expect(client.domains).toBeDefined()
    })

    it('should create a domain', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'domain_123',
          name: 'example.com',
          status: 'pending',
          created_at: '2024-01-01T00:00:00Z',
          region: 'us-east-1',
        }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.domains.create({
        name: 'example.com',
      })

      expect(error).toBeNull()
      expect(data?.id).toBe('domain_123')
      expect(data?.name).toBe('example.com')
    })

    it('should create domain with region', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'domain_124',
          name: 'example.com',
          status: 'pending',
          region: 'eu-west-1',
        }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.domains.create({
        name: 'example.com',
        region: 'eu-west-1',
      })

      expect(error).toBeNull()
      expect(data?.region).toBe('eu-west-1')
    })

    it('should return error for missing domain name', async () => {
      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.domains.create({
        name: '',
      })

      expect(data).toBeNull()
      expect(error?.message).toContain('name')
    })

    it('should get domain by ID', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'domain_123',
          name: 'example.com',
          status: 'verified',
          records: [
            {
              record: 'SPF',
              name: 'example.com',
              type: 'TXT',
              value: 'v=spf1...',
              status: 'verified',
            },
          ],
        }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.domains.get('domain_123')

      expect(error).toBeNull()
      expect(data?.id).toBe('domain_123')
      expect(data?.records).toHaveLength(1)
    })

    it('should list domains', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: 'domain_1', name: 'domain1.com', status: 'verified' },
            { id: 'domain_2', name: 'domain2.com', status: 'pending' },
          ],
        }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.domains.list()

      expect(error).toBeNull()
      expect(data?.data).toHaveLength(2)
    })

    it('should update domain settings', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'domain_123',
          name: 'example.com',
        }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.domains.update('domain_123', {
        click_tracking: true,
        open_tracking: true,
      })

      expect(error).toBeNull()
      expect(data?.id).toBe('domain_123')
    })

    it('should delete domain', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ deleted: true }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.domains.remove('domain_123')

      expect(error).toBeNull()
      expect(data?.deleted).toBe(true)
    })

    it('should verify domain', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'domain_123',
          status: 'verified',
        }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.domains.verify('domain_123')

      expect(error).toBeNull()
      expect(data?.status).toBe('verified')
    })
  })

  describe('API Keys', () => {
    it('should expose apiKeys resource', async () => {
      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })
      expect(client.apiKeys).toBeDefined()
    })

    it('should create an API key', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'key_123',
          name: 'Production Key',
          token: 're_new_key_xxx',
          created_at: '2024-01-01T00:00:00Z',
        }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.apiKeys.create({
        name: 'Production Key',
      })

      expect(error).toBeNull()
      expect(data?.id).toBe('key_123')
      expect(data?.token).toBe('re_new_key_xxx')
    })

    it('should create API key with permissions', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'key_124',
          name: 'Sending Only Key',
        }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.apiKeys.create({
        name: 'Sending Only Key',
        permission: 'sending_access',
      })

      expect(error).toBeNull()
      expect(data?.id).toBe('key_124')
    })

    it('should return error for missing key name', async () => {
      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.apiKeys.create({
        name: '',
      })

      expect(data).toBeNull()
      expect(error?.message).toContain('name')
    })

    it('should list API keys', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: 'key_1', name: 'Key 1' },
            { id: 'key_2', name: 'Key 2' },
          ],
        }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.apiKeys.list()

      expect(error).toBeNull()
      expect(data?.data).toHaveLength(2)
    })

    it('should delete API key', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ deleted: true }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.apiKeys.remove('key_123')

      expect(error).toBeNull()
      expect(data?.deleted).toBe(true)
    })
  })

  describe('Audiences API', () => {
    it('should expose audiences resource', async () => {
      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })
      expect(client.audiences).toBeDefined()
    })

    it('should create an audience', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'audience_123',
          name: 'Newsletter Subscribers',
          created_at: '2024-01-01T00:00:00Z',
        }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.audiences.create({
        name: 'Newsletter Subscribers',
      })

      expect(error).toBeNull()
      expect(data?.id).toBe('audience_123')
      expect(data?.name).toBe('Newsletter Subscribers')
    })

    it('should return error for missing audience name', async () => {
      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.audiences.create({
        name: '',
      })

      expect(data).toBeNull()
      expect(error?.message).toContain('name')
    })

    it('should get audience by ID', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'audience_123',
          name: 'Newsletter Subscribers',
        }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.audiences.get('audience_123')

      expect(error).toBeNull()
      expect(data?.id).toBe('audience_123')
    })

    it('should list audiences', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: 'audience_1', name: 'Audience 1' },
            { id: 'audience_2', name: 'Audience 2' },
          ],
        }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.audiences.list()

      expect(error).toBeNull()
      expect(data?.data).toHaveLength(2)
    })

    it('should delete audience', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ deleted: true }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.audiences.remove('audience_123')

      expect(error).toBeNull()
      expect(data?.deleted).toBe(true)
    })
  })

  describe('Contacts API', () => {
    it('should expose contacts resource', async () => {
      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })
      expect(client.contacts).toBeDefined()
    })

    it('should create a contact', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'contact_123',
          email: 'user@example.com',
          first_name: 'John',
          last_name: 'Doe',
          unsubscribed: false,
          created_at: '2024-01-01T00:00:00Z',
        }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.contacts.create({
        email: 'user@example.com',
        first_name: 'John',
        last_name: 'Doe',
        audience_id: 'audience_123',
      })

      expect(error).toBeNull()
      expect(data?.id).toBe('contact_123')
      expect(data?.email).toBe('user@example.com')
    })

    it('should return error for missing contact email', async () => {
      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.contacts.create({
        email: '',
        audience_id: 'audience_123',
      })

      expect(data).toBeNull()
      expect(error?.message).toContain('email')
    })

    it('should return error for missing audience_id', async () => {
      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.contacts.create({
        email: 'user@example.com',
        audience_id: '',
      })

      expect(data).toBeNull()
      expect(error?.message).toContain('audience_id')
    })

    it('should get contact by ID', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'contact_123',
          email: 'user@example.com',
        }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.contacts.get('audience_123', 'contact_123')

      expect(error).toBeNull()
      expect(data?.id).toBe('contact_123')
    })

    it('should list contacts in audience', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: 'contact_1', email: 'user1@example.com' },
            { id: 'contact_2', email: 'user2@example.com' },
          ],
        }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.contacts.list('audience_123')

      expect(error).toBeNull()
      expect(data?.data).toHaveLength(2)
    })

    it('should update contact', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'contact_123',
          email: 'user@example.com',
          first_name: 'Updated',
        }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.contacts.update('audience_123', 'contact_123', {
        first_name: 'Updated',
      })

      expect(error).toBeNull()
      expect(data?.first_name).toBe('Updated')
    })

    it('should unsubscribe contact', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'contact_123',
          unsubscribed: true,
        }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.contacts.update('audience_123', 'contact_123', {
        unsubscribed: true,
      })

      expect(error).toBeNull()
      expect(data?.unsubscribed).toBe(true)
    })

    it('should delete contact', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ deleted: true }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.contacts.remove('audience_123', 'contact_123')

      expect(error).toBeNull()
      expect(data?.deleted).toBe(true)
    })
  })

  describe('Error Handling', () => {
    it('should return error on API failure', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          statusCode: 400,
          message: 'Invalid request',
          name: 'validation_error',
        }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.emails.send({
        from: 'sender@example.com',
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      })

      expect(data).toBeNull()
      expect(error?.statusCode).toBe(400)
      expect(error?.message).toBe('Invalid request')
    })

    it('should return error on authentication failure', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          statusCode: 401,
          message: 'Invalid API key',
          name: 'unauthorized',
        }),
      })

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_invalid' })

      const { data, error } = await client.domains.list()

      expect(data).toBeNull()
      expect(error?.statusCode).toBe(401)
    })

    it('should handle network errors', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key' })

      const { data, error } = await client.domains.list()

      expect(data).toBeNull()
      expect(error?.name).toBe('network_error')
    })

    it('should handle timeout', async () => {
      const abortError = new Error('Timeout')
      abortError.name = 'AbortError'
      globalThis.fetch = vi.fn().mockRejectedValue(abortError)

      const { ResendClient } = await import('../client')
      const client = new ResendClient({ apiKey: 're_test_key', timeout: 50 })

      const { data, error } = await client.domains.list()

      expect(data).toBeNull()
      expect(error?.name).toBe('timeout_error')
    })
  })

  describe('Resend SDK Wrapper', () => {
    it('should work with simple constructor', async () => {
      const { Resend } = await import('../index')
      const resend = new Resend('re_test_key')

      expect(resend.emails).toBeDefined()
      expect(resend.domains).toBeDefined()
      expect(resend.apiKeys).toBeDefined()
    })

    it('should work without API key', async () => {
      const { Resend } = await import('../index')
      const resend = new Resend()

      expect(resend).toBeDefined()
    })
  })
})
