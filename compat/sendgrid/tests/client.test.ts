/**
 * SendGrid Client Tests
 *
 * Tests for the SendGrid-compatible client with full API coverage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import types we'll implement
import type {
  SendGridClient,
  SendGridClientConfig,
  Template,
  TemplateCreateParams,
  TemplateUpdateParams,
  TemplateVersion,
  Contact,
  ContactCreateParams,
  ContactList,
  ContactListCreateParams,
  EmailStats,
  StatsParams,
} from '../client'

// Mock client implementation for TDD
const createMockClient = () => {
  const mockFetch = vi.fn()

  return {
    mockFetch,
    client: null as unknown as SendGridClient, // Will be set when implemented
  }
}

describe('SendGridClient', () => {
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
    it('should require an API key', async () => {
      const { SendGridClient } = await import('../client')
      expect(() => new SendGridClient({ apiKey: '' })).toThrow('API key is required')
    })

    it('should accept valid API key', async () => {
      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })
      expect(client).toBeDefined()
    })

    it('should support custom host', async () => {
      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({
        apiKey: 'SG.test-api-key',
        host: 'https://custom-api.sendgrid.com',
      })
      expect(client).toBeDefined()
    })

    it('should support timeout configuration', async () => {
      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({
        apiKey: 'SG.test-api-key',
        timeout: 30000,
      })
      expect(client).toBeDefined()
    })
  })

  describe('Mail API', () => {
    it('should expose mail resource', async () => {
      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })
      expect(client.mail).toBeDefined()
      expect(typeof client.mail.send).toBe('function')
    })

    it('should send email via mail.send()', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({}),
        headers: new Headers({ 'x-message-id': 'msg-123' }),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const response = await client.mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Test',
        text: 'Hello',
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support batch sending', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({}),
        headers: new Headers({ 'x-message-id': 'msg-456' }),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const response = await client.mail.sendMultiple({
        to: ['user1@example.com', 'user2@example.com'],
        from: 'sender@example.com',
        subject: 'Newsletter',
        text: 'Hello everyone!',
      })

      expect(response.statusCode).toBe(202)
    })
  })

  describe('Templates API', () => {
    it('should expose templates resource', async () => {
      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })
      expect(client.templates).toBeDefined()
    })

    it('should create a template', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          id: 'd-template-123',
          name: 'Welcome Email',
          generation: 'dynamic',
          updated_at: new Date().toISOString(),
        }),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const template = await client.templates.create({
        name: 'Welcome Email',
        generation: 'dynamic',
      })

      expect(template.id).toBe('d-template-123')
      expect(template.name).toBe('Welcome Email')
    })

    it('should retrieve a template by ID', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'd-template-123',
          name: 'Welcome Email',
          generation: 'dynamic',
          versions: [],
        }),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const template = await client.templates.retrieve('d-template-123')

      expect(template.id).toBe('d-template-123')
    })

    it('should update a template', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'd-template-123',
          name: 'Updated Welcome Email',
          generation: 'dynamic',
        }),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const template = await client.templates.update('d-template-123', {
        name: 'Updated Welcome Email',
      })

      expect(template.name).toBe('Updated Welcome Email')
    })

    it('should delete a template', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      await expect(client.templates.delete('d-template-123')).resolves.not.toThrow()
    })

    it('should list all templates', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          result: [
            { id: 'd-template-1', name: 'Template 1', generation: 'dynamic' },
            { id: 'd-template-2', name: 'Template 2', generation: 'dynamic' },
          ],
        }),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const templates = await client.templates.list()

      expect(templates.result).toHaveLength(2)
    })

    it('should filter templates by generation', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          result: [{ id: 'd-template-1', name: 'Dynamic Template', generation: 'dynamic' }],
        }),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const templates = await client.templates.list({ generations: 'dynamic' })

      expect(templates.result).toHaveLength(1)
      expect(templates.result[0].generation).toBe('dynamic')
    })

    describe('Template Versions', () => {
      it('should create a template version', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 201,
          json: async () => ({
            id: 'version-123',
            template_id: 'd-template-123',
            name: 'Version 1',
            subject: '{{subject}}',
            html_content: '<h1>Hello {{name}}</h1>',
            active: 1,
          }),
          headers: new Headers(),
        })

        const { SendGridClient } = await import('../client')
        const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

        const version = await client.templates.createVersion('d-template-123', {
          name: 'Version 1',
          subject: '{{subject}}',
          html_content: '<h1>Hello {{name}}</h1>',
          active: 1,
        })

        expect(version.id).toBe('version-123')
        expect(version.active).toBe(1)
      })

      it('should update a template version', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'version-123',
            template_id: 'd-template-123',
            name: 'Updated Version',
            active: 1,
          }),
          headers: new Headers(),
        })

        const { SendGridClient } = await import('../client')
        const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

        const version = await client.templates.updateVersion('d-template-123', 'version-123', {
          name: 'Updated Version',
        })

        expect(version.name).toBe('Updated Version')
      })

      it('should activate a template version', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'version-123',
            active: 1,
          }),
          headers: new Headers(),
        })

        const { SendGridClient } = await import('../client')
        const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

        const version = await client.templates.activateVersion('d-template-123', 'version-123')

        expect(version.active).toBe(1)
      })

      it('should delete a template version', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 204,
          json: async () => ({}),
          headers: new Headers(),
        })

        const { SendGridClient } = await import('../client')
        const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

        await expect(
          client.templates.deleteVersion('d-template-123', 'version-123')
        ).resolves.not.toThrow()
      })
    })
  })

  describe('Contacts API', () => {
    it('should expose contacts resource', async () => {
      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })
      expect(client.contacts).toBeDefined()
    })

    it('should add contacts', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({
          job_id: 'job-123',
        }),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const result = await client.contacts.add([
        { email: 'user1@example.com', first_name: 'John', last_name: 'Doe' },
        { email: 'user2@example.com', first_name: 'Jane', last_name: 'Doe' },
      ])

      expect(result.job_id).toBe('job-123')
    })

    it('should add contacts to specific lists', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({
          job_id: 'job-456',
        }),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const result = await client.contacts.add(
        [{ email: 'user@example.com' }],
        { list_ids: ['list-123', 'list-456'] }
      )

      expect(result.job_id).toBe('job-456')
    })

    it('should get contact by email', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          result: {
            'user@example.com': {
              contact: {
                id: 'contact-123',
                email: 'user@example.com',
                first_name: 'John',
              },
            },
          },
        }),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const result = await client.contacts.getByEmail(['user@example.com'])

      expect(result.result['user@example.com'].contact.id).toBe('contact-123')
    })

    it('should get contact by ID', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'contact-123',
          email: 'user@example.com',
          first_name: 'John',
        }),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const contact = await client.contacts.get('contact-123')

      expect(contact.id).toBe('contact-123')
    })

    it('should update contact', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({
          job_id: 'update-job-123',
        }),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const result = await client.contacts.update([
        { email: 'user@example.com', first_name: 'Updated' },
      ])

      expect(result.job_id).toBe('update-job-123')
    })

    it('should delete contacts', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({
          job_id: 'delete-job-123',
        }),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const result = await client.contacts.delete({ ids: ['contact-123', 'contact-456'] })

      expect(result.job_id).toBe('delete-job-123')
    })

    it('should delete all contacts', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({
          job_id: 'delete-all-job',
        }),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const result = await client.contacts.delete({ delete_all_contacts: true })

      expect(result.job_id).toBe('delete-all-job')
    })

    it('should search contacts', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          result: [
            { id: 'contact-1', email: 'john@example.com' },
            { id: 'contact-2', email: 'john.doe@example.com' },
          ],
          contact_count: 2,
        }),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const result = await client.contacts.search({
        query: "first_name LIKE 'John%'",
      })

      expect(result.result).toHaveLength(2)
    })

    it('should count contacts', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          contact_count: 1000,
          billable_count: 950,
        }),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const result = await client.contacts.count()

      expect(result.contact_count).toBe(1000)
    })

    it('should export contacts', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({
          id: 'export-123',
        }),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const result = await client.contacts.export()

      expect(result.id).toBe('export-123')
    })
  })

  describe('Contact Lists API', () => {
    it('should expose lists resource', async () => {
      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })
      expect(client.lists).toBeDefined()
    })

    it('should create a list', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          id: 'list-123',
          name: 'Newsletter Subscribers',
          contact_count: 0,
        }),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const list = await client.lists.create({
        name: 'Newsletter Subscribers',
      })

      expect(list.id).toBe('list-123')
      expect(list.name).toBe('Newsletter Subscribers')
    })

    it('should get a list by ID', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'list-123',
          name: 'Newsletter Subscribers',
          contact_count: 500,
        }),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const list = await client.lists.get('list-123')

      expect(list.id).toBe('list-123')
      expect(list.contact_count).toBe(500)
    })

    it('should update a list', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'list-123',
          name: 'Updated Name',
        }),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const list = await client.lists.update('list-123', {
        name: 'Updated Name',
      })

      expect(list.name).toBe('Updated Name')
    })

    it('should delete a list', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      await expect(client.lists.delete('list-123')).resolves.not.toThrow()
    })

    it('should list all lists', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          result: [
            { id: 'list-1', name: 'List 1', contact_count: 100 },
            { id: 'list-2', name: 'List 2', contact_count: 200 },
          ],
        }),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const lists = await client.lists.list()

      expect(lists.result).toHaveLength(2)
    })

    it('should add contacts to a list', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({
          job_id: 'add-job-123',
        }),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const result = await client.lists.addContacts('list-123', ['contact-1', 'contact-2'])

      expect(result.job_id).toBe('add-job-123')
    })

    it('should remove contacts from a list', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({
          job_id: 'remove-job-123',
        }),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const result = await client.lists.removeContacts('list-123', ['contact-1', 'contact-2'])

      expect(result.job_id).toBe('remove-job-123')
    })
  })

  describe('Stats API', () => {
    it('should expose stats resource', async () => {
      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })
      expect(client.stats).toBeDefined()
    })

    it('should get global stats', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ([
          {
            date: '2024-01-01',
            stats: [
              {
                metrics: {
                  requests: 1000,
                  delivered: 950,
                  opens: 500,
                  clicks: 100,
                  bounces: 10,
                  spam_reports: 2,
                },
              },
            ],
          },
        ]),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const stats = await client.stats.global({
        start_date: '2024-01-01',
        end_date: '2024-01-31',
      })

      expect(stats).toHaveLength(1)
      expect(stats[0].stats[0].metrics.delivered).toBe(950)
    })

    it('should get stats by category', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ([
          {
            date: '2024-01-01',
            stats: [
              {
                type: 'category',
                name: 'newsletter',
                metrics: {
                  requests: 500,
                  delivered: 480,
                },
              },
            ],
          },
        ]),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const stats = await client.stats.categories({
        categories: ['newsletter'],
        start_date: '2024-01-01',
      })

      expect(stats[0].stats[0].name).toBe('newsletter')
    })

    it('should get stats by subuser', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ([
          {
            date: '2024-01-01',
            stats: [
              {
                type: 'subuser',
                name: 'marketing_team',
                metrics: {
                  requests: 200,
                },
              },
            ],
          },
        ]),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const stats = await client.stats.subusers({
        subusers: ['marketing_team'],
        start_date: '2024-01-01',
      })

      expect(stats[0].stats[0].name).toBe('marketing_team')
    })

    it('should get stats aggregated by day', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ([
          { date: '2024-01-01', stats: [{ metrics: { requests: 100 } }] },
          { date: '2024-01-02', stats: [{ metrics: { requests: 150 } }] },
        ]),
        headers: new Headers(),
      })

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      const stats = await client.stats.global({
        start_date: '2024-01-01',
        end_date: '2024-01-07',
        aggregated_by: 'day',
      })

      expect(stats).toHaveLength(2)
    })
  })

  describe('Error Handling', () => {
    it('should throw SendGridError on API error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          errors: [
            { message: 'Invalid email address', field: 'to' },
          ],
        }),
        headers: new Headers(),
      })

      const { SendGridClient, SendGridError } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      await expect(
        client.mail.send({
          to: 'invalid',
          from: 'sender@example.com',
          subject: 'Test',
          text: 'Hello',
        })
      ).rejects.toThrow(SendGridError)
    })

    it('should include error details in SendGridError', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          errors: [
            { message: 'Invalid API key', field: null },
          ],
        }),
        headers: new Headers(),
      })

      const { SendGridClient, SendGridError } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.invalid' })

      try {
        await client.templates.list()
      } catch (error) {
        expect(error).toBeInstanceOf(SendGridError)
        expect((error as any).statusCode).toBe(401)
        expect((error as any).errors[0].message).toBe('Invalid API key')
      }
    })

    it('should handle network errors', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      await expect(client.templates.list()).rejects.toThrow('Network error')
    })

    it('should handle timeout', async () => {
      globalThis.fetch = vi.fn().mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100))
      )

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key', timeout: 50 })

      await expect(client.templates.list()).rejects.toThrow()
    })
  })

  describe('Request Options', () => {
    it('should support custom headers', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: [] }),
        headers: new Headers(),
      })
      globalThis.fetch = mockFetch

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      await client.templates.list({}, {
        headers: { 'X-Custom-Header': 'custom-value' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Custom-Header': 'custom-value',
          }),
        })
      )
    })

    it('should support on-subuser header', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: [] }),
        headers: new Headers(),
      })
      globalThis.fetch = mockFetch

      const { SendGridClient } = await import('../client')
      const client = new SendGridClient({ apiKey: 'SG.test-api-key' })

      await client.templates.list({}, {
        onBehalfOf: 'subuser-123',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'on-behalf-of': 'subuser-123',
          }),
        })
      )
    })
  })
})
