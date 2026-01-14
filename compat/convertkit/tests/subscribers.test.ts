/**
 * @dotdo/convertkit - Subscriber API Tests (RED Phase)
 *
 * Comprehensive tests for ConvertKit (Kit) API v4 subscriber management.
 * These tests are written to FAIL initially (RED phase of TDD).
 *
 * ConvertKit/Kit API v4 Documentation: https://developers.kit.com/v4.html
 *
 * Test coverage:
 * - Subscriber CRUD operations (create, read, update, list)
 * - Unsubscribe functionality
 * - Tag management (add/remove tags from subscribers)
 * - Custom fields (set/update custom fields)
 * - Sequence management (add/remove subscribers from sequences)
 * - Bulk operations (bulk create subscribers)
 * - Subscriber stats (email engagement metrics)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ConvertKitClient,
  // Subscriber operations
  createSubscriber,
  getSubscriber,
  updateSubscriber,
  listSubscribers,
  unsubscribeSubscriber,
  getSubscriberStats,
  // Tag operations
  addTagToSubscriber,
  removeTagFromSubscriber,
  listSubscriberTags,
  // Sequence operations
  addSubscriberToSequence,
  removeSubscriberFromSequence,
  listSubscriberSequences,
  // Custom field operations
  setSubscriberCustomField,
  setSubscriberCustomFields,
  // Bulk operations
  bulkCreateSubscribers,
  // Types
  type Subscriber,
  type SubscriberState,
  type Tag,
  type Sequence,
  type CustomField,
  type SubscriberStats,
  type CreateSubscriberInput,
  type UpdateSubscriberInput,
  type BulkCreateResult,
  type PaginatedResponse,
  type ConvertKitError,
} from '../index'

describe('@dotdo/convertkit - Subscribers API', () => {
  let originalFetch: typeof globalThis.fetch
  let client: ConvertKitClient

  beforeEach(() => {
    originalFetch = globalThis.fetch
    client = new ConvertKitClient({ apiKey: 'ck_test_api_key' })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // ==========================================================================
  // Client Configuration
  // ==========================================================================

  describe('ConvertKitClient', () => {
    it('should create a client with API key', () => {
      const ck = new ConvertKitClient({ apiKey: 'ck_test_key' })
      expect(ck).toBeInstanceOf(ConvertKitClient)
    })

    it('should create a client with OAuth token', () => {
      const ck = new ConvertKitClient({ accessToken: 'oauth_token_123' })
      expect(ck).toBeInstanceOf(ConvertKitClient)
    })

    it('should throw if no credentials provided', () => {
      expect(() => new ConvertKitClient({})).toThrow('API key or access token is required')
    })

    it('should prefer OAuth token over API key when both provided', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ subscriber: { id: 1 } }),
      })

      const ck = new ConvertKitClient({
        apiKey: 'ck_api_key',
        accessToken: 'oauth_token',
      })
      await ck.subscribers.get(1)

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer oauth_token',
          }),
        })
      )
    })

    it('should use X-Kit-Api-Key header when using API key auth', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ subscriber: { id: 1 } }),
      })

      await client.subscribers.get(1)

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Kit-Api-Key': 'ck_test_api_key',
          }),
        })
      )
    })

    it('should use api.kit.com as base URL', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ subscribers: [] }),
      })

      await client.subscribers.list()

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api.kit.com/v4/'),
        expect.any(Object)
      )
    })
  })

  // ==========================================================================
  // Create Subscriber
  // ==========================================================================

  describe('createSubscriber()', () => {
    it('should create a new subscriber with email only', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          subscriber: {
            id: 123,
            email_address: 'alice@example.com',
            first_name: null,
            state: 'active',
            created_at: '2024-01-15T10:00:00Z',
            fields: {},
          },
        }),
      })

      const subscriber = await client.subscribers.create({
        email_address: 'alice@example.com',
      })

      expect(subscriber.id).toBe(123)
      expect(subscriber.email_address).toBe('alice@example.com')
      expect(subscriber.state).toBe('active')
    })

    it('should create subscriber with first name', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          subscriber: {
            id: 124,
            email_address: 'bob@example.com',
            first_name: 'Bob',
            state: 'active',
            created_at: '2024-01-15T10:00:00Z',
            fields: {},
          },
        }),
      })

      const subscriber = await client.subscribers.create({
        email_address: 'bob@example.com',
        first_name: 'Bob',
      })

      expect(subscriber.first_name).toBe('Bob')
    })

    it('should create subscriber with custom fields', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          subscriber: {
            id: 125,
            email_address: 'carol@example.com',
            first_name: 'Carol',
            state: 'active',
            created_at: '2024-01-15T10:00:00Z',
            fields: {
              company: 'Acme Inc',
              role: 'Developer',
              plan: 'pro',
            },
          },
        }),
      })

      const subscriber = await client.subscribers.create({
        email_address: 'carol@example.com',
        first_name: 'Carol',
        fields: {
          company: 'Acme Inc',
          role: 'Developer',
          plan: 'pro',
        },
      })

      expect(subscriber.fields.company).toBe('Acme Inc')
      expect(subscriber.fields.role).toBe('Developer')
      expect(subscriber.fields.plan).toBe('pro')
    })

    it('should support up to 140 custom fields', async () => {
      const fields: Record<string, string> = {}
      for (let i = 1; i <= 140; i++) {
        fields[`field_${i}`] = `value_${i}`
      }

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          subscriber: {
            id: 126,
            email_address: 'test@example.com',
            first_name: null,
            state: 'active',
            created_at: '2024-01-15T10:00:00Z',
            fields,
          },
        }),
      })

      const subscriber = await client.subscribers.create({
        email_address: 'test@example.com',
        fields,
      })

      expect(Object.keys(subscriber.fields).length).toBe(140)
    })

    it('should upsert existing subscriber by email', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200, // 200 for upsert (existing subscriber)
        json: async () => ({
          subscriber: {
            id: 100, // Same ID as existing
            email_address: 'existing@example.com',
            first_name: 'Updated Name',
            state: 'active',
            created_at: '2024-01-10T10:00:00Z',
            fields: {},
          },
        }),
      })

      const subscriber = await client.subscribers.create({
        email_address: 'existing@example.com',
        first_name: 'Updated Name',
      })

      expect(subscriber.id).toBe(100)
      expect(subscriber.first_name).toBe('Updated Name')
    })

    it('should throw validation error for invalid email', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          errors: [{ message: 'Email address is invalid', field: 'email_address' }],
        }),
      })

      await expect(
        client.subscribers.create({ email_address: 'not-an-email' })
      ).rejects.toThrow('Email address is invalid')
    })

    it('should handle rate limiting', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '60' }),
        json: async () => ({ error: 'Rate limit exceeded' }),
      })

      await expect(
        client.subscribers.create({ email_address: 'test@example.com' })
      ).rejects.toThrow(/rate limit/i)
    })
  })

  // ==========================================================================
  // Get Subscriber
  // ==========================================================================

  describe('getSubscriber()', () => {
    it('should get subscriber by ID', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          subscriber: {
            id: 123,
            email_address: 'alice@example.com',
            first_name: 'Alice',
            state: 'active',
            created_at: '2024-01-15T10:00:00Z',
            fields: { company: 'Acme' },
          },
        }),
      })

      const subscriber = await client.subscribers.get(123)

      expect(subscriber.id).toBe(123)
      expect(subscriber.email_address).toBe('alice@example.com')
      expect(subscriber.first_name).toBe('Alice')
      expect(subscriber.fields.company).toBe('Acme')
    })

    it('should throw 404 for non-existent subscriber', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not Found' }),
      })

      await expect(client.subscribers.get(999999)).rejects.toThrow(/not found/i)
    })

    it('should throw 401 for invalid API key', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'The access token is invalid' }),
      })

      await expect(client.subscribers.get(123)).rejects.toThrow(/invalid/i)
    })
  })

  // ==========================================================================
  // Update Subscriber
  // ==========================================================================

  describe('updateSubscriber()', () => {
    it('should update subscriber first name', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          subscriber: {
            id: 123,
            email_address: 'alice@example.com',
            first_name: 'Alicia',
            state: 'active',
            created_at: '2024-01-15T10:00:00Z',
            fields: {},
          },
        }),
      })

      const subscriber = await client.subscribers.update(123, {
        first_name: 'Alicia',
      })

      expect(subscriber.first_name).toBe('Alicia')
    })

    it('should update subscriber email address', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          subscriber: {
            id: 123,
            email_address: 'newemail@example.com',
            first_name: 'Alice',
            state: 'active',
            created_at: '2024-01-15T10:00:00Z',
            fields: {},
          },
        }),
      })

      const subscriber = await client.subscribers.update(123, {
        email_address: 'newemail@example.com',
      })

      expect(subscriber.email_address).toBe('newemail@example.com')
    })

    it('should update subscriber custom fields', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          subscriber: {
            id: 123,
            email_address: 'alice@example.com',
            first_name: 'Alice',
            state: 'active',
            created_at: '2024-01-15T10:00:00Z',
            fields: {
              company: 'New Company',
              role: 'CTO',
            },
          },
        }),
      })

      const subscriber = await client.subscribers.update(123, {
        fields: {
          company: 'New Company',
          role: 'CTO',
        },
      })

      expect(subscriber.fields.company).toBe('New Company')
      expect(subscriber.fields.role).toBe('CTO')
    })

    it('should throw 404 for non-existent subscriber', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not Found' }),
      })

      await expect(
        client.subscribers.update(999999, { first_name: 'Test' })
      ).rejects.toThrow(/not found/i)
    })
  })

  // ==========================================================================
  // List Subscribers
  // ==========================================================================

  describe('listSubscribers()', () => {
    it('should list subscribers with cursor-based pagination', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          subscribers: [
            { id: 1, email_address: 'user1@example.com', first_name: 'User 1', state: 'active' },
            { id: 2, email_address: 'user2@example.com', first_name: 'User 2', state: 'active' },
          ],
          pagination: {
            has_previous_page: false,
            has_next_page: true,
            start_cursor: 'abc123',
            end_cursor: 'xyz789',
            per_page: 50,
          },
        }),
      })

      const result = await client.subscribers.list()

      expect(result.subscribers).toHaveLength(2)
      expect(result.pagination.has_next_page).toBe(true)
      expect(result.pagination.end_cursor).toBe('xyz789')
    })

    it('should support pagination with after cursor', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          subscribers: [
            { id: 3, email_address: 'user3@example.com', first_name: 'User 3', state: 'active' },
          ],
          pagination: {
            has_previous_page: true,
            has_next_page: false,
            start_cursor: 'xyz789',
            end_cursor: 'end123',
            per_page: 50,
          },
        }),
      })

      const result = await client.subscribers.list({ after: 'xyz789' })

      expect(result.subscribers).toHaveLength(1)
      expect(result.pagination.has_previous_page).toBe(true)
    })

    it('should filter by email address', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          subscribers: [
            { id: 1, email_address: 'specific@example.com', first_name: 'Specific', state: 'active' },
          ],
          pagination: {
            has_previous_page: false,
            has_next_page: false,
          },
        }),
      })

      const result = await client.subscribers.list({
        email_address: 'specific@example.com',
      })

      expect(result.subscribers).toHaveLength(1)
      expect(result.subscribers[0].email_address).toBe('specific@example.com')
    })

    it('should filter by subscriber state', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          subscribers: [
            { id: 1, email_address: 'active@example.com', first_name: 'Active', state: 'active' },
          ],
          pagination: {
            has_previous_page: false,
            has_next_page: false,
          },
        }),
      })

      await client.subscribers.list({ state: 'active' })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('state=active'),
        expect.any(Object)
      )
    })

    it('should filter by created_after date', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          subscribers: [],
          pagination: { has_previous_page: false, has_next_page: false },
        }),
      })

      await client.subscribers.list({
        created_after: new Date('2024-01-01'),
      })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('created_after='),
        expect.any(Object)
      )
    })

    it('should filter by tag_id', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          subscribers: [],
          pagination: { has_previous_page: false, has_next_page: false },
        }),
      })

      await client.subscribers.list({ tag_id: 12345 })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('tag_id=12345'),
        expect.any(Object)
      )
    })
  })

  // ==========================================================================
  // Unsubscribe Subscriber
  // ==========================================================================

  describe('unsubscribeSubscriber()', () => {
    it('should unsubscribe a subscriber by ID', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          subscriber: {
            id: 123,
            email_address: 'unsubbed@example.com',
            first_name: 'Unsubbed',
            state: 'cancelled',
            created_at: '2024-01-15T10:00:00Z',
            fields: {},
          },
        }),
      })

      const subscriber = await client.subscribers.unsubscribe(123)

      expect(subscriber.state).toBe('cancelled')
    })

    it('should call the correct endpoint', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          subscriber: { id: 123, state: 'cancelled' },
        }),
      })

      await client.subscribers.unsubscribe(123)

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v4/subscribers/123/unsubscribe'),
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('should throw 404 for non-existent subscriber', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not Found' }),
      })

      await expect(client.subscribers.unsubscribe(999999)).rejects.toThrow(/not found/i)
    })
  })

  // ==========================================================================
  // Subscriber Stats
  // ==========================================================================

  describe('getSubscriberStats()', () => {
    it('should get subscriber email engagement stats', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          stats: {
            emails_sent: 50,
            emails_opened: 35,
            emails_clicked: 15,
            open_rate: 0.7,
            click_rate: 0.3,
          },
        }),
      })

      const stats = await client.subscribers.getStats(123)

      expect(stats.emails_sent).toBe(50)
      expect(stats.emails_opened).toBe(35)
      expect(stats.open_rate).toBe(0.7)
    })

    it('should support date range filtering', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          stats: { emails_sent: 10, emails_opened: 8, emails_clicked: 3 },
        }),
      })

      await client.subscribers.getStats(123, {
        from: new Date('2024-01-01'),
        to: new Date('2024-01-31'),
      })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/from=.*to=/),
        expect.any(Object)
      )
    })
  })

  // ==========================================================================
  // Tag Operations
  // ==========================================================================

  describe('Tag Operations', () => {
    describe('addTagToSubscriber()', () => {
      it('should add tag to subscriber by subscriber ID and tag ID', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 201,
          json: async () => ({
            subscriber: {
              id: 123,
              email_address: 'alice@example.com',
              first_name: 'Alice',
              state: 'active',
            },
          }),
        })

        const subscriber = await client.tags.addSubscriber(456, 123)

        expect(subscriber.id).toBe(123)
        expect(globalThis.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/v4/tags/456/subscribers/123'),
          expect.objectContaining({ method: 'POST' })
        )
      })

      it('should add tag to subscriber by email', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 201,
          json: async () => ({
            subscriber: {
              id: 123,
              email_address: 'alice@example.com',
              first_name: 'Alice',
              state: 'active',
            },
          }),
        })

        const subscriber = await client.tags.addSubscriberByEmail(456, 'alice@example.com')

        expect(subscriber.email_address).toBe('alice@example.com')
      })

      it('should return 200 if subscriber already has tag', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200, // Already tagged
          json: async () => ({
            subscriber: { id: 123, email_address: 'alice@example.com' },
          }),
        })

        const subscriber = await client.tags.addSubscriber(456, 123)

        expect(subscriber.id).toBe(123)
      })

      it('should throw 404 for non-existent tag', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          json: async () => ({ error: 'Not Found' }),
        })

        await expect(client.tags.addSubscriber(999999, 123)).rejects.toThrow(/not found/i)
      })
    })

    describe('removeTagFromSubscriber()', () => {
      it('should remove tag from subscriber', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 204, // No content
        })

        await client.tags.removeSubscriber(456, 123)

        expect(globalThis.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/v4/tags/456/subscribers/123'),
          expect.objectContaining({ method: 'DELETE' })
        )
      })

      it('should not throw if subscriber does not have tag', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 204,
        })

        // Should not throw
        await expect(client.tags.removeSubscriber(456, 123)).resolves.not.toThrow()
      })
    })

    describe('listSubscriberTags()', () => {
      it('should list all tags for a subscriber', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            tags: [
              { id: 1, name: 'newsletter', created_at: '2024-01-01T00:00:00Z' },
              { id: 2, name: 'premium', created_at: '2024-01-02T00:00:00Z' },
            ],
            pagination: {
              has_previous_page: false,
              has_next_page: false,
            },
          }),
        })

        const result = await client.subscribers.listTags(123)

        expect(result.tags).toHaveLength(2)
        expect(result.tags[0].name).toBe('newsletter')
        expect(result.tags[1].name).toBe('premium')
      })
    })

    describe('listTagSubscribers()', () => {
      it('should list all subscribers with a specific tag', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            subscribers: [
              { id: 1, email_address: 'user1@example.com', state: 'active' },
              { id: 2, email_address: 'user2@example.com', state: 'active' },
            ],
            pagination: {
              has_previous_page: false,
              has_next_page: false,
            },
          }),
        })

        const result = await client.tags.listSubscribers(456)

        expect(result.subscribers).toHaveLength(2)
        expect(globalThis.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/v4/tags/456/subscribers'),
          expect.any(Object)
        )
      })
    })
  })

  // ==========================================================================
  // Sequence Operations
  // ==========================================================================

  describe('Sequence Operations', () => {
    describe('addSubscriberToSequence()', () => {
      it('should add subscriber to sequence by ID', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 201,
          json: async () => ({
            subscriber: {
              id: 883,
              first_name: 'Alice',
              email_address: 'alice@example.com',
              state: 'active',
              created_at: '2023-02-17T11:43:55Z',
              added_at: '2023-02-17T11:43:55Z',
              fields: {},
            },
          }),
        })

        const subscriber = await client.sequences.addSubscriber(789, 883)

        expect(subscriber.id).toBe(883)
        expect(globalThis.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/v4/sequences/789/subscribers'),
          expect.objectContaining({ method: 'POST' })
        )
      })

      it('should add subscriber to sequence by email address', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 201,
          json: async () => ({
            subscriber: {
              id: 883,
              email_address: 'alice@example.com',
              state: 'active',
            },
          }),
        })

        const subscriber = await client.sequences.addSubscriberByEmail(789, 'alice@example.com')

        expect(subscriber.email_address).toBe('alice@example.com')
        expect(globalThis.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/v4/sequences/789/subscribers'),
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('alice@example.com'),
          })
        )
      })

      it('should return 200 if subscriber already in sequence', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200, // Already in sequence
          json: async () => ({
            subscriber: { id: 883, email_address: 'alice@example.com' },
          }),
        })

        const subscriber = await client.sequences.addSubscriberByEmail(789, 'alice@example.com')

        expect(subscriber.id).toBe(883)
      })

      it('should throw 422 if sequence is inactive', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 422,
          json: async () => ({ error: 'Sequence is inactive' }),
        })

        await expect(
          client.sequences.addSubscriberByEmail(789, 'test@example.com')
        ).rejects.toThrow(/inactive/i)
      })

      it('should throw 404 for non-existent subscriber (subscriber must exist first)', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          json: async () => ({ error: 'Not Found' }),
        })

        await expect(
          client.sequences.addSubscriberByEmail(789, 'nonexistent@example.com')
        ).rejects.toThrow(/not found/i)
      })
    })

    describe('removeSubscriberFromSequence()', () => {
      it('should remove subscriber from sequence', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 204,
        })

        await client.sequences.removeSubscriber(789, 883)

        expect(globalThis.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/v4/sequences/789/subscribers/883'),
          expect.objectContaining({ method: 'DELETE' })
        )
      })
    })

    describe('listSequenceSubscribers()', () => {
      it('should list subscribers in a sequence', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            subscribers: [
              { id: 1, email_address: 'user1@example.com', added_at: '2024-01-01T00:00:00Z' },
              { id: 2, email_address: 'user2@example.com', added_at: '2024-01-02T00:00:00Z' },
            ],
            pagination: {
              has_previous_page: false,
              has_next_page: true,
              end_cursor: 'cursor123',
            },
          }),
        })

        const result = await client.sequences.listSubscribers(789)

        expect(result.subscribers).toHaveLength(2)
      })
    })

    describe('listSubscriberSequences()', () => {
      it('should list all sequences a subscriber is enrolled in', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            sequences: [
              { id: 1, name: 'Welcome Series', state: 'active' },
              { id: 2, name: 'Product Launch', state: 'active' },
            ],
            pagination: {
              has_previous_page: false,
              has_next_page: false,
            },
          }),
        })

        const result = await client.subscribers.listSequences(123)

        expect(result.sequences).toHaveLength(2)
        expect(result.sequences[0].name).toBe('Welcome Series')
      })
    })
  })

  // ==========================================================================
  // Custom Fields
  // ==========================================================================

  describe('Custom Fields', () => {
    describe('setSubscriberCustomField()', () => {
      it('should set a single custom field', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            subscriber: {
              id: 123,
              email_address: 'alice@example.com',
              fields: { company: 'Acme Inc' },
            },
          }),
        })

        const subscriber = await client.subscribers.setField(123, 'company', 'Acme Inc')

        expect(subscriber.fields.company).toBe('Acme Inc')
      })
    })

    describe('setSubscriberCustomFields()', () => {
      it('should set multiple custom fields at once', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            subscriber: {
              id: 123,
              email_address: 'alice@example.com',
              fields: {
                company: 'Acme Inc',
                role: 'Developer',
                location: 'San Francisco',
              },
            },
          }),
        })

        const subscriber = await client.subscribers.setFields(123, {
          company: 'Acme Inc',
          role: 'Developer',
          location: 'San Francisco',
        })

        expect(subscriber.fields.company).toBe('Acme Inc')
        expect(subscriber.fields.role).toBe('Developer')
        expect(subscriber.fields.location).toBe('San Francisco')
      })

      it('should support setting up to 140 custom fields', async () => {
        const fields: Record<string, string> = {}
        for (let i = 1; i <= 140; i++) {
          fields[`field_${i}`] = `value_${i}`
        }

        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            subscriber: { id: 123, email_address: 'test@example.com', fields },
          }),
        })

        const subscriber = await client.subscribers.setFields(123, fields)

        expect(Object.keys(subscriber.fields).length).toBe(140)
      })

      it('should clear a custom field by setting null', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            subscriber: {
              id: 123,
              email_address: 'alice@example.com',
              fields: { company: null },
            },
          }),
        })

        const subscriber = await client.subscribers.setFields(123, {
          company: null,
        })

        expect(subscriber.fields.company).toBeNull()
      })
    })

    describe('listCustomFields()', () => {
      it('should list all available custom fields', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            custom_fields: [
              { id: 1, key: 'company', label: 'Company' },
              { id: 2, key: 'role', label: 'Job Role' },
              { id: 3, key: 'plan', label: 'Subscription Plan' },
            ],
          }),
        })

        const fields = await client.customFields.list()

        expect(fields).toHaveLength(3)
        expect(fields[0].key).toBe('company')
        expect(fields[1].label).toBe('Job Role')
      })
    })

    describe('createCustomField()', () => {
      it('should create a new custom field', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 201,
          json: async () => ({
            custom_field: {
              id: 4,
              key: 'team_size',
              label: 'Team Size',
            },
          }),
        })

        const field = await client.customFields.create({
          label: 'Team Size',
        })

        expect(field.id).toBe(4)
        expect(field.key).toBe('team_size')
      })
    })
  })

  // ==========================================================================
  // Bulk Operations
  // ==========================================================================

  describe('Bulk Operations', () => {
    describe('bulkCreateSubscribers()', () => {
      it('should bulk create subscribers synchronously for small batch', async () => {
        const subscribers = [
          { email_address: 'user1@example.com', first_name: 'User 1' },
          { email_address: 'user2@example.com', first_name: 'User 2' },
        ]

        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 201,
          json: async () => ({
            subscribers: [
              { id: 1, email_address: 'user1@example.com', first_name: 'User 1', state: 'active' },
              { id: 2, email_address: 'user2@example.com', first_name: 'User 2', state: 'active' },
            ],
            failures: [],
          }),
        })

        const result = await client.subscribers.bulkCreate(subscribers)

        expect(result.subscribers).toHaveLength(2)
        expect(result.failures).toHaveLength(0)
      })

      it('should return failures for invalid subscribers', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 201,
          json: async () => ({
            subscribers: [
              { id: 1, email_address: 'valid@example.com', state: 'active' },
            ],
            failures: [
              { email_address: 'invalid', error: 'Invalid email address' },
            ],
          }),
        })

        const result = await client.subscribers.bulkCreate([
          { email_address: 'valid@example.com' },
          { email_address: 'invalid' },
        ])

        expect(result.subscribers).toHaveLength(1)
        expect(result.failures).toHaveLength(1)
        expect(result.failures[0].error).toBe('Invalid email address')
      })

      it('should support async callback for large batch', async () => {
        const largeBatch = Array.from({ length: 1000 }, (_, i) => ({
          email_address: `user${i}@example.com`,
        }))

        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 202, // Accepted for async processing
          json: async () => ({
            job_id: 'job_abc123',
            status: 'pending',
            callback_url: 'https://api.kit.com/v4/bulk/jobs/job_abc123',
          }),
        })

        const result = await client.subscribers.bulkCreate(largeBatch, {
          callback_url: 'https://myapp.com/webhook',
        })

        expect(result.job_id).toBe('job_abc123')
        expect(result.status).toBe('pending')
      })

      it('should add all subscribers to a specific tag', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 201,
          json: async () => ({
            subscribers: [{ id: 1, email_address: 'user@example.com' }],
            failures: [],
          }),
        })

        await client.subscribers.bulkCreate(
          [{ email_address: 'user@example.com' }],
          { tag_id: 456 }
        )

        expect(globalThis.fetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: expect.stringContaining('tag_id'),
          })
        )
      })
    })

    describe('getBulkJobStatus()', () => {
      it('should check status of async bulk job', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            job_id: 'job_abc123',
            status: 'completed',
            created: 950,
            failures: 50,
            completed_at: '2024-01-15T12:00:00Z',
          }),
        })

        const status = await client.bulk.getJobStatus('job_abc123')

        expect(status.status).toBe('completed')
        expect(status.created).toBe(950)
        expect(status.failures).toBe(50)
      })
    })
  })

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('should throw ConvertKitError with proper structure', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          errors: [
            { message: 'Email is required', field: 'email_address' },
            { message: 'First name is too long', field: 'first_name' },
          ],
        }),
      })

      try {
        await client.subscribers.create({ email_address: '' })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        const ckError = error as ConvertKitError
        expect(ckError.status).toBe(422)
        expect(ckError.errors).toHaveLength(2)
        expect(ckError.errors[0].field).toBe('email_address')
      }
    })

    it('should handle network errors', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      await expect(client.subscribers.list()).rejects.toThrow(/network/i)
    })

    it('should handle timeout', async () => {
      globalThis.fetch = vi.fn().mockImplementation(
        () => new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 100)
        )
      )

      const timeoutClient = new ConvertKitClient({
        apiKey: 'test',
        timeout: 50,
      })

      await expect(timeoutClient.subscribers.list()).rejects.toThrow(/timeout/i)
    })
  })

  // ==========================================================================
  // Standalone Functions (convenience exports)
  // ==========================================================================

  describe('Standalone Functions', () => {
    beforeEach(() => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          subscriber: { id: 123, email_address: 'test@example.com', state: 'active' },
        }),
      })
    })

    it('should support createSubscriber() as standalone function', async () => {
      const subscriber = await createSubscriber(
        { email_address: 'test@example.com' },
        { apiKey: 'test_key' }
      )

      expect(subscriber.id).toBe(123)
    })

    it('should support getSubscriber() as standalone function', async () => {
      const subscriber = await getSubscriber(123, { apiKey: 'test_key' })

      expect(subscriber.id).toBe(123)
    })

    it('should support updateSubscriber() as standalone function', async () => {
      const subscriber = await updateSubscriber(
        123,
        { first_name: 'Updated' },
        { apiKey: 'test_key' }
      )

      expect(subscriber.id).toBe(123)
    })

    it('should support listSubscribers() as standalone function', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          subscribers: [{ id: 1, email_address: 'test@example.com' }],
          pagination: { has_next_page: false },
        }),
      })

      const result = await listSubscribers({}, { apiKey: 'test_key' })

      expect(result.subscribers).toHaveLength(1)
    })

    it('should support addTagToSubscriber() as standalone function', async () => {
      const subscriber = await addTagToSubscriber(456, 123, { apiKey: 'test_key' })

      expect(subscriber.id).toBe(123)
    })

    it('should support addSubscriberToSequence() as standalone function', async () => {
      const subscriber = await addSubscriberToSequence(789, 123, { apiKey: 'test_key' })

      expect(subscriber.id).toBe(123)
    })

    it('should support bulkCreateSubscribers() as standalone function', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          subscribers: [{ id: 1, email_address: 'test@example.com' }],
          failures: [],
        }),
      })

      const result = await bulkCreateSubscribers(
        [{ email_address: 'test@example.com' }],
        { apiKey: 'test_key' }
      )

      expect(result.subscribers).toHaveLength(1)
    })
  })
})
