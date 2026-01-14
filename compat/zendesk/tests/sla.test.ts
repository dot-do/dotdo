/**
 * @dotdo/zendesk - Zendesk SLA Policy Tests (RED Phase TDD)
 *
 * Failing tests for Zendesk SLA Policy functionality:
 * - SLA Policy CRUD operations (create, get, update, delete, list)
 * - SLA target tracking (first reply, next reply, resolution)
 * - Response time SLAs
 * - Resolution time SLAs
 * - SLA breach notifications/webhooks
 * - Business hours vs calendar hours
 * - Priority-based SLA metrics
 *
 * These tests define the expected API for SLA policies that
 * doesn't exist yet - they should all fail until implementation.
 *
 * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/sla_policies/
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Client,
  ZendeskError,
  type SLAPolicy,
  type SLAPolicyCondition,
  type SLAPolicyMetric,
  type SLAPolicyListResponse,
} from '../index'

// =============================================================================
// Test Helpers
// =============================================================================

function createMockFetch(responses: Map<string, { status: number; body: unknown }>) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const urlObj = new URL(url)
    const method = options?.method ?? 'GET'
    const key = `${method} ${urlObj.pathname}`

    const mockResponse = responses.get(key)
    if (!mockResponse) {
      return {
        ok: false,
        status: 404,
        headers: new Headers({ 'x-request-id': 'req_mock' }),
        json: async () => ({
          error: 'RecordNotFound',
          description: `No mock for ${key}`,
        }),
      }
    }

    return {
      ok: mockResponse.status >= 200 && mockResponse.status < 300,
      status: mockResponse.status,
      headers: new Headers({ 'x-request-id': 'req_mock' }),
      json: async () => mockResponse.body,
    }
  })
}

function mockSLAPolicy(overrides: Partial<SLAPolicy> = {}): SLAPolicy {
  return {
    id: 25,
    url: 'https://mycompany.zendesk.com/api/v2/slas/policies/25.json',
    title: 'Premium Support SLA',
    description: 'SLA policy for premium support customers',
    position: 1,
    filter: {
      all: [
        { field: 'type', operator: 'is', value: 'incident' },
        { field: 'custom_fields_12345', operator: 'is', value: 'premium' },
      ],
      any: [],
    },
    policy_metrics: [
      {
        priority: 'urgent',
        metric: 'first_reply_time',
        target: 30, // 30 minutes
        business_hours: true,
      },
      {
        priority: 'urgent',
        metric: 'requester_wait_time',
        target: 60, // 60 minutes
        business_hours: true,
      },
      {
        priority: 'high',
        metric: 'first_reply_time',
        target: 60, // 60 minutes
        business_hours: true,
      },
      {
        priority: 'high',
        metric: 'requester_wait_time',
        target: 240, // 4 hours
        business_hours: true,
      },
      {
        priority: 'normal',
        metric: 'first_reply_time',
        target: 480, // 8 hours
        business_hours: true,
      },
      {
        priority: 'low',
        metric: 'first_reply_time',
        target: 1440, // 24 hours
        business_hours: true,
      },
    ],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

// =============================================================================
// SLA Policies Resource Tests
// =============================================================================

describe('@dotdo/zendesk - SLA Policies', () => {
  describe('client.slas.policies - CRUD operations', () => {
    describe('list', () => {
      it('should list all SLA policies', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'GET /api/v2/slas/policies',
              {
                status: 200,
                body: {
                  sla_policies: [mockSLAPolicy(), mockSLAPolicy({ id: 26, title: 'Standard SLA' })],
                  count: 2,
                  next_page: null,
                  previous_page: null,
                },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const result = await client.slas.policies.list()

        expect(result.sla_policies).toHaveLength(2)
        expect(result.sla_policies[0].title).toBe('Premium Support SLA')
        expect(result.sla_policies[1].title).toBe('Standard SLA')
        expect(result.count).toBe(2)
      })

      it('should return empty list when no SLA policies exist', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'GET /api/v2/slas/policies',
              {
                status: 200,
                body: {
                  sla_policies: [],
                  count: 0,
                  next_page: null,
                  previous_page: null,
                },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const result = await client.slas.policies.list()

        expect(result.sla_policies).toHaveLength(0)
        expect(result.count).toBe(0)
      })
    })

    describe('get', () => {
      it('should get a single SLA policy by ID', async () => {
        const expectedPolicy = mockSLAPolicy()
        const mockFetch = createMockFetch(
          new Map([
            [
              'GET /api/v2/slas/policies/25',
              {
                status: 200,
                body: { sla_policy: expectedPolicy },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const policy = await client.slas.policies.get(25)

        expect(policy.id).toBe(25)
        expect(policy.title).toBe('Premium Support SLA')
        expect(policy.description).toBe('SLA policy for premium support customers')
        expect(policy.filter.all).toHaveLength(2)
        expect(policy.policy_metrics).toHaveLength(6)
      })

      it('should throw ZendeskError for non-existent policy', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'GET /api/v2/slas/policies/99999',
              {
                status: 404,
                body: {
                  error: 'RecordNotFound',
                  description: 'SLA policy not found',
                },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        await expect(client.slas.policies.get(99999)).rejects.toThrow(ZendeskError)
      })
    })

    describe('create', () => {
      it('should create a new SLA policy with basic settings', async () => {
        const createdPolicy = mockSLAPolicy({ id: 100, title: 'Enterprise SLA' })
        const mockFetch = createMockFetch(
          new Map([
            [
              'POST /api/v2/slas/policies',
              {
                status: 201,
                body: { sla_policy: createdPolicy },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const policy = await client.slas.policies.create({
          title: 'Enterprise SLA',
          filter: {
            all: [{ field: 'organization_id', operator: 'is', value: '123' }],
            any: [],
          },
          policy_metrics: [
            {
              priority: 'urgent',
              metric: 'first_reply_time',
              target: 15,
              business_hours: true,
            },
          ],
        })

        expect(policy.id).toBe(100)
        expect(policy.title).toBe('Enterprise SLA')
      })

      it('should create SLA policy with all priorities and metrics', async () => {
        const policyMetrics: SLAPolicyMetric[] = [
          { priority: 'urgent', metric: 'first_reply_time', target: 15, business_hours: true },
          { priority: 'urgent', metric: 'next_reply_time', target: 30, business_hours: true },
          { priority: 'urgent', metric: 'requester_wait_time', target: 60, business_hours: true },
          { priority: 'high', metric: 'first_reply_time', target: 60, business_hours: true },
          { priority: 'high', metric: 'next_reply_time', target: 120, business_hours: true },
          { priority: 'normal', metric: 'first_reply_time', target: 480, business_hours: true },
          { priority: 'low', metric: 'first_reply_time', target: 1440, business_hours: false },
        ]

        const createdPolicy = mockSLAPolicy({
          id: 101,
          title: 'Comprehensive SLA',
          policy_metrics: policyMetrics,
        })

        const mockFetch = createMockFetch(
          new Map([
            [
              'POST /api/v2/slas/policies',
              {
                status: 201,
                body: { sla_policy: createdPolicy },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const policy = await client.slas.policies.create({
          title: 'Comprehensive SLA',
          filter: { all: [], any: [] },
          policy_metrics: policyMetrics,
        })

        expect(policy.policy_metrics).toHaveLength(7)
        expect(policy.policy_metrics.some((m) => m.metric === 'next_reply_time')).toBe(true)
      })

      it('should create SLA policy with complex filter conditions', async () => {
        const filter = {
          all: [
            { field: 'type', operator: 'is', value: 'incident' },
            { field: 'group_id', operator: 'is', value: '12345' },
          ],
          any: [
            { field: 'tags', operator: 'includes', value: 'vip' },
            { field: 'tags', operator: 'includes', value: 'enterprise' },
          ],
        }

        const createdPolicy = mockSLAPolicy({
          id: 102,
          title: 'VIP/Enterprise SLA',
          filter,
        })

        const mockFetch = createMockFetch(
          new Map([
            [
              'POST /api/v2/slas/policies',
              {
                status: 201,
                body: { sla_policy: createdPolicy },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const policy = await client.slas.policies.create({
          title: 'VIP/Enterprise SLA',
          filter,
          policy_metrics: [
            { priority: 'urgent', metric: 'first_reply_time', target: 10, business_hours: true },
          ],
        })

        expect(policy.filter.all).toHaveLength(2)
        expect(policy.filter.any).toHaveLength(2)
      })

      it('should validate required fields on create', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'POST /api/v2/slas/policies',
              {
                status: 422,
                body: {
                  error: 'RecordInvalid',
                  description: 'Title is required',
                  details: {
                    title: [{ description: 'Title: is required', error: 'BlankValue' }],
                  },
                },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        await expect(
          client.slas.policies.create({
            title: '', // Empty title should fail
            filter: { all: [], any: [] },
            policy_metrics: [],
          })
        ).rejects.toThrow(ZendeskError)
      })
    })

    describe('update', () => {
      it('should update an existing SLA policy', async () => {
        const updatedPolicy = mockSLAPolicy({
          id: 25,
          title: 'Premium Support SLA v2',
          description: 'Updated description',
        })

        const mockFetch = createMockFetch(
          new Map([
            [
              'PUT /api/v2/slas/policies/25',
              {
                status: 200,
                body: { sla_policy: updatedPolicy },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const policy = await client.slas.policies.update(25, {
          title: 'Premium Support SLA v2',
          description: 'Updated description',
        })

        expect(policy.title).toBe('Premium Support SLA v2')
        expect(policy.description).toBe('Updated description')
      })

      it('should update SLA policy metrics', async () => {
        const newMetrics: SLAPolicyMetric[] = [
          { priority: 'urgent', metric: 'first_reply_time', target: 10, business_hours: true },
          { priority: 'high', metric: 'first_reply_time', target: 30, business_hours: true },
        ]

        const updatedPolicy = mockSLAPolicy({
          id: 25,
          policy_metrics: newMetrics,
        })

        const mockFetch = createMockFetch(
          new Map([
            [
              'PUT /api/v2/slas/policies/25',
              {
                status: 200,
                body: { sla_policy: updatedPolicy },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const policy = await client.slas.policies.update(25, {
          policy_metrics: newMetrics,
        })

        expect(policy.policy_metrics).toHaveLength(2)
        expect(policy.policy_metrics[0].target).toBe(10)
      })

      it('should update SLA policy filter conditions', async () => {
        const newFilter = {
          all: [{ field: 'brand_id', operator: 'is', value: '999' }],
          any: [],
        }

        const updatedPolicy = mockSLAPolicy({
          id: 25,
          filter: newFilter,
        })

        const mockFetch = createMockFetch(
          new Map([
            [
              'PUT /api/v2/slas/policies/25',
              {
                status: 200,
                body: { sla_policy: updatedPolicy },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const policy = await client.slas.policies.update(25, {
          filter: newFilter,
        })

        expect(policy.filter.all[0].field).toBe('brand_id')
      })

      it('should throw ZendeskError when updating non-existent policy', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'PUT /api/v2/slas/policies/99999',
              {
                status: 404,
                body: {
                  error: 'RecordNotFound',
                  description: 'SLA policy not found',
                },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        await expect(
          client.slas.policies.update(99999, { title: 'New Title' })
        ).rejects.toThrow(ZendeskError)
      })
    })

    describe('delete', () => {
      it('should delete an SLA policy', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'DELETE /api/v2/slas/policies/25',
              {
                status: 204,
                body: null,
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        // Should not throw
        await expect(client.slas.policies.delete(25)).resolves.toBeUndefined()
      })

      it('should throw ZendeskError when deleting non-existent policy', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'DELETE /api/v2/slas/policies/99999',
              {
                status: 404,
                body: {
                  error: 'RecordNotFound',
                  description: 'SLA policy not found',
                },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        await expect(client.slas.policies.delete(99999)).rejects.toThrow(ZendeskError)
      })
    })

    describe('reorder', () => {
      it('should reorder SLA policies', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'PUT /api/v2/slas/policies/reorder',
              {
                status: 200,
                body: {
                  sla_policies: [
                    mockSLAPolicy({ id: 26, position: 1 }),
                    mockSLAPolicy({ id: 25, position: 2 }),
                  ],
                },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const result = await client.slas.policies.reorder([26, 25])

        expect(result.sla_policies[0].id).toBe(26)
        expect(result.sla_policies[0].position).toBe(1)
        expect(result.sla_policies[1].id).toBe(25)
        expect(result.sla_policies[1].position).toBe(2)
      })
    })
  })

  // =============================================================================
  // Response Time SLA Tests
  // =============================================================================

  describe('Response Time SLAs', () => {
    describe('first_reply_time metric', () => {
      it('should create SLA with first reply time targets for all priorities', async () => {
        const policyMetrics: SLAPolicyMetric[] = [
          { priority: 'urgent', metric: 'first_reply_time', target: 15, business_hours: true },
          { priority: 'high', metric: 'first_reply_time', target: 60, business_hours: true },
          { priority: 'normal', metric: 'first_reply_time', target: 240, business_hours: true },
          { priority: 'low', metric: 'first_reply_time', target: 480, business_hours: true },
        ]

        const createdPolicy = mockSLAPolicy({ id: 200, policy_metrics: policyMetrics })

        const mockFetch = createMockFetch(
          new Map([
            [
              'POST /api/v2/slas/policies',
              { status: 201, body: { sla_policy: createdPolicy } },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const policy = await client.slas.policies.create({
          title: 'First Reply SLA',
          filter: { all: [], any: [] },
          policy_metrics: policyMetrics,
        })

        expect(policy.policy_metrics.filter((m) => m.metric === 'first_reply_time')).toHaveLength(4)
      })

      it('should support calendar hours for first reply time', async () => {
        const policyMetrics: SLAPolicyMetric[] = [
          { priority: 'urgent', metric: 'first_reply_time', target: 60, business_hours: false },
        ]

        const createdPolicy = mockSLAPolicy({ id: 201, policy_metrics: policyMetrics })

        const mockFetch = createMockFetch(
          new Map([
            [
              'POST /api/v2/slas/policies',
              { status: 201, body: { sla_policy: createdPolicy } },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const policy = await client.slas.policies.create({
          title: '24/7 First Reply SLA',
          filter: { all: [], any: [] },
          policy_metrics: policyMetrics,
        })

        expect(policy.policy_metrics[0].business_hours).toBe(false)
      })
    })

    describe('next_reply_time metric', () => {
      it('should create SLA with next reply time targets', async () => {
        const policyMetrics: SLAPolicyMetric[] = [
          { priority: 'urgent', metric: 'next_reply_time', target: 30, business_hours: true },
          { priority: 'high', metric: 'next_reply_time', target: 120, business_hours: true },
        ]

        const createdPolicy = mockSLAPolicy({ id: 202, policy_metrics: policyMetrics })

        const mockFetch = createMockFetch(
          new Map([
            [
              'POST /api/v2/slas/policies',
              { status: 201, body: { sla_policy: createdPolicy } },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const policy = await client.slas.policies.create({
          title: 'Next Reply SLA',
          filter: { all: [], any: [] },
          policy_metrics: policyMetrics,
        })

        expect(policy.policy_metrics.every((m) => m.metric === 'next_reply_time')).toBe(true)
      })
    })

    describe('periodic_update_time metric', () => {
      it('should create SLA with periodic update requirements', async () => {
        const policyMetrics: SLAPolicyMetric[] = [
          { priority: 'urgent', metric: 'periodic_update_time', target: 60, business_hours: true },
          { priority: 'high', metric: 'periodic_update_time', target: 240, business_hours: true },
        ]

        const createdPolicy = mockSLAPolicy({ id: 203, policy_metrics: policyMetrics })

        const mockFetch = createMockFetch(
          new Map([
            [
              'POST /api/v2/slas/policies',
              { status: 201, body: { sla_policy: createdPolicy } },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const policy = await client.slas.policies.create({
          title: 'Periodic Update SLA',
          filter: { all: [], any: [] },
          policy_metrics: policyMetrics,
        })

        expect(policy.policy_metrics[0].metric).toBe('periodic_update_time')
      })
    })
  })

  // =============================================================================
  // Resolution Time SLA Tests
  // =============================================================================

  describe('Resolution Time SLAs', () => {
    describe('requester_wait_time metric', () => {
      it('should create SLA with requester wait time (full resolution) targets', async () => {
        const policyMetrics: SLAPolicyMetric[] = [
          { priority: 'urgent', metric: 'requester_wait_time', target: 120, business_hours: true },
          { priority: 'high', metric: 'requester_wait_time', target: 480, business_hours: true },
          { priority: 'normal', metric: 'requester_wait_time', target: 1440, business_hours: true },
          { priority: 'low', metric: 'requester_wait_time', target: 2880, business_hours: true },
        ]

        const createdPolicy = mockSLAPolicy({ id: 300, policy_metrics: policyMetrics })

        const mockFetch = createMockFetch(
          new Map([
            [
              'POST /api/v2/slas/policies',
              { status: 201, body: { sla_policy: createdPolicy } },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const policy = await client.slas.policies.create({
          title: 'Resolution Time SLA',
          filter: { all: [], any: [] },
          policy_metrics: policyMetrics,
        })

        expect(policy.policy_metrics.filter((m) => m.metric === 'requester_wait_time')).toHaveLength(4)
      })
    })

    describe('agent_work_time metric', () => {
      it('should create SLA with agent work time targets', async () => {
        const policyMetrics: SLAPolicyMetric[] = [
          { priority: 'urgent', metric: 'agent_work_time', target: 60, business_hours: true },
          { priority: 'high', metric: 'agent_work_time', target: 240, business_hours: true },
        ]

        const createdPolicy = mockSLAPolicy({ id: 301, policy_metrics: policyMetrics })

        const mockFetch = createMockFetch(
          new Map([
            [
              'POST /api/v2/slas/policies',
              { status: 201, body: { sla_policy: createdPolicy } },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const policy = await client.slas.policies.create({
          title: 'Agent Work Time SLA',
          filter: { all: [], any: [] },
          policy_metrics: policyMetrics,
        })

        expect(policy.policy_metrics[0].metric).toBe('agent_work_time')
      })
    })

    describe('pausable_update_time metric', () => {
      it('should create SLA with pausable update time (excludes pending status)', async () => {
        const policyMetrics: SLAPolicyMetric[] = [
          { priority: 'urgent', metric: 'pausable_update_time', target: 30, business_hours: true },
        ]

        const createdPolicy = mockSLAPolicy({ id: 302, policy_metrics: policyMetrics })

        const mockFetch = createMockFetch(
          new Map([
            [
              'POST /api/v2/slas/policies',
              { status: 201, body: { sla_policy: createdPolicy } },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const policy = await client.slas.policies.create({
          title: 'Pausable Update SLA',
          filter: { all: [], any: [] },
          policy_metrics: policyMetrics,
        })

        expect(policy.policy_metrics[0].metric).toBe('pausable_update_time')
      })
    })
  })

  // =============================================================================
  // SLA Target Tracking Tests
  // =============================================================================

  describe('SLA Target Tracking', () => {
    describe('ticket SLA status', () => {
      it('should get SLA status for a ticket', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'GET /api/v2/tickets/123/slas',
              {
                status: 200,
                body: {
                  sla_status: {
                    policy_id: 25,
                    policy_title: 'Premium Support SLA',
                    metrics: [
                      {
                        metric: 'first_reply_time',
                        target: 30,
                        breached_at: null,
                        fulfilled_at: '2025-01-12T10:30:00Z',
                        status: 'fulfilled',
                        stage: 'completed',
                      },
                      {
                        metric: 'requester_wait_time',
                        target: 60,
                        breached_at: null,
                        fulfilled_at: null,
                        status: 'active',
                        stage: 'in_progress',
                        remaining_minutes: 45,
                      },
                    ],
                  },
                },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const slaStatus = await client.tickets.getSLAStatus(123)

        expect(slaStatus.policy_id).toBe(25)
        expect(slaStatus.metrics).toHaveLength(2)
        expect(slaStatus.metrics[0].status).toBe('fulfilled')
        expect(slaStatus.metrics[1].status).toBe('active')
        expect(slaStatus.metrics[1].remaining_minutes).toBe(45)
      })

      it('should return null when ticket has no SLA applied', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'GET /api/v2/tickets/456/slas',
              {
                status: 200,
                body: { sla_status: null },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const slaStatus = await client.tickets.getSLAStatus(456)

        expect(slaStatus).toBeNull()
      })
    })

    describe('breached tickets', () => {
      it('should list tickets with breached SLAs', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'GET /api/v2/slas/policies/25/breaches',
              {
                status: 200,
                body: {
                  breaches: [
                    {
                      ticket_id: 789,
                      policy_id: 25,
                      metric: 'first_reply_time',
                      breached_at: '2025-01-12T11:00:00Z',
                      target_minutes: 30,
                      actual_minutes: 45,
                    },
                    {
                      ticket_id: 790,
                      policy_id: 25,
                      metric: 'requester_wait_time',
                      breached_at: '2025-01-12T12:00:00Z',
                      target_minutes: 60,
                      actual_minutes: 75,
                    },
                  ],
                  count: 2,
                  next_page: null,
                  previous_page: null,
                },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const result = await client.slas.policies.getBreaches(25)

        expect(result.breaches).toHaveLength(2)
        expect(result.breaches[0].metric).toBe('first_reply_time')
        expect(result.breaches[0].actual_minutes).toBeGreaterThan(result.breaches[0].target_minutes)
      })

      it('should filter breaches by metric type', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'GET /api/v2/slas/policies/25/breaches',
              {
                status: 200,
                body: {
                  breaches: [
                    {
                      ticket_id: 789,
                      policy_id: 25,
                      metric: 'first_reply_time',
                      breached_at: '2025-01-12T11:00:00Z',
                      target_minutes: 30,
                      actual_minutes: 45,
                    },
                  ],
                  count: 1,
                  next_page: null,
                  previous_page: null,
                },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const result = await client.slas.policies.getBreaches(25, {
          metric: 'first_reply_time',
        })

        expect(result.breaches).toHaveLength(1)
        expect(result.breaches[0].metric).toBe('first_reply_time')
      })
    })

    describe('at-risk tickets', () => {
      it('should list tickets at risk of SLA breach', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'GET /api/v2/slas/policies/25/at_risk',
              {
                status: 200,
                body: {
                  at_risk: [
                    {
                      ticket_id: 800,
                      policy_id: 25,
                      metric: 'first_reply_time',
                      deadline: '2025-01-12T10:45:00Z',
                      remaining_minutes: 10,
                      risk_level: 'high',
                    },
                    {
                      ticket_id: 801,
                      policy_id: 25,
                      metric: 'requester_wait_time',
                      deadline: '2025-01-12T11:00:00Z',
                      remaining_minutes: 25,
                      risk_level: 'medium',
                    },
                  ],
                  count: 2,
                  next_page: null,
                  previous_page: null,
                },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const result = await client.slas.policies.getAtRisk(25)

        expect(result.at_risk).toHaveLength(2)
        expect(result.at_risk[0].risk_level).toBe('high')
        expect(result.at_risk[0].remaining_minutes).toBeLessThan(15)
      })

      it('should filter at-risk tickets by threshold', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'GET /api/v2/slas/policies/25/at_risk',
              {
                status: 200,
                body: {
                  at_risk: [
                    {
                      ticket_id: 800,
                      policy_id: 25,
                      metric: 'first_reply_time',
                      deadline: '2025-01-12T10:45:00Z',
                      remaining_minutes: 10,
                      risk_level: 'high',
                    },
                  ],
                  count: 1,
                  next_page: null,
                  previous_page: null,
                },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const result = await client.slas.policies.getAtRisk(25, {
          threshold_minutes: 15,
        })

        expect(result.at_risk).toHaveLength(1)
        expect(result.at_risk[0].remaining_minutes).toBeLessThanOrEqual(15)
      })
    })
  })

  // =============================================================================
  // SLA Breach Notifications Tests
  // =============================================================================

  describe('SLA Breach Notifications', () => {
    describe('webhook configuration for breach events', () => {
      it('should create a webhook for SLA breach notifications', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'POST /api/v2/webhooks',
              {
                status: 201,
                body: {
                  webhook: {
                    id: 'webhook_sla_123',
                    name: 'SLA Breach Notifications',
                    status: 'active',
                    endpoint: 'https://example.com/webhooks/sla-breach',
                    http_method: 'POST',
                    request_format: 'json',
                    subscriptions: ['conditional_ticket_events'],
                    created_at: new Date().toISOString(),
                    created_by: 'admin@example.com',
                    updated_at: new Date().toISOString(),
                    updated_by: 'admin@example.com',
                  },
                },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const webhook = await client.webhooks.create({
          name: 'SLA Breach Notifications',
          endpoint: 'https://example.com/webhooks/sla-breach',
          http_method: 'POST',
          request_format: 'json',
          subscriptions: ['conditional_ticket_events'],
        })

        expect(webhook.name).toBe('SLA Breach Notifications')
        expect(webhook.subscriptions).toContain('conditional_ticket_events')
      })

      it('should create a trigger that fires on SLA breach', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'POST /api/v2/triggers',
              {
                status: 201,
                body: {
                  trigger: {
                    id: 5001,
                    url: 'https://mycompany.zendesk.com/api/v2/triggers/5001.json',
                    title: 'Notify on SLA Breach',
                    active: true,
                    position: 1,
                    conditions: {
                      all: [
                        {
                          field: 'sla_breach',
                          operator: 'is',
                          value: 'true',
                        },
                      ],
                      any: [],
                    },
                    actions: [
                      {
                        field: 'notification_webhook',
                        value: ['webhook_sla_123', '{"ticket_id": "{{ticket.id}}", "breach_type": "{{ticket.sla_breach_metric}}", "policy": "{{ticket.sla_policy_name}}"}'],
                      },
                    ],
                    description: 'Sends webhook notification when SLA is breached',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  },
                },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const trigger = await client.triggers.create({
          title: 'Notify on SLA Breach',
          conditions: {
            all: [{ field: 'sla_breach', operator: 'is', value: 'true' }],
            any: [],
          },
          actions: [
            {
              field: 'notification_webhook',
              value: ['webhook_sla_123', '{"ticket_id": "{{ticket.id}}", "breach_type": "{{ticket.sla_breach_metric}}", "policy": "{{ticket.sla_policy_name}}"}'],
            },
          ],
          description: 'Sends webhook notification when SLA is breached',
        })

        expect(trigger.title).toBe('Notify on SLA Breach')
        expect(trigger.conditions.all[0].field).toBe('sla_breach')
      })
    })

    describe('approaching breach notifications', () => {
      it('should create a trigger for approaching SLA breach warning', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'POST /api/v2/triggers',
              {
                status: 201,
                body: {
                  trigger: {
                    id: 5002,
                    url: 'https://mycompany.zendesk.com/api/v2/triggers/5002.json',
                    title: 'Warn on Approaching SLA Breach',
                    active: true,
                    position: 2,
                    conditions: {
                      all: [
                        {
                          field: 'sla_next_breach_at',
                          operator: 'less_than',
                          value: '15',
                        },
                      ],
                      any: [],
                    },
                    actions: [
                      {
                        field: 'notification_user',
                        value: ['assignee@example.com', 'SLA Warning: Ticket {{ticket.id}} will breach in {{ticket.sla_time_until_breach}} minutes'],
                      },
                    ],
                    description: 'Warns assignee when SLA is about to breach',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  },
                },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const trigger = await client.triggers.create({
          title: 'Warn on Approaching SLA Breach',
          conditions: {
            all: [{ field: 'sla_next_breach_at', operator: 'less_than', value: '15' }],
            any: [],
          },
          actions: [
            {
              field: 'notification_user',
              value: ['assignee@example.com', 'SLA Warning: Ticket {{ticket.id}} will breach in {{ticket.sla_time_until_breach}} minutes'],
            },
          ],
          description: 'Warns assignee when SLA is about to breach',
        })

        expect(trigger.conditions.all[0].field).toBe('sla_next_breach_at')
        expect(trigger.conditions.all[0].operator).toBe('less_than')
      })
    })

    describe('breach escalation', () => {
      it('should create automation for escalating breached tickets', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'POST /api/v2/automations',
              {
                status: 201,
                body: {
                  automation: {
                    id: 6001,
                    url: 'https://mycompany.zendesk.com/api/v2/automations/6001.json',
                    title: 'Escalate SLA Breached Tickets',
                    active: true,
                    position: 1,
                    conditions: {
                      all: [
                        { field: 'status', operator: 'is', value: 'open' },
                        { field: 'sla_breach', operator: 'is', value: 'true' },
                        { field: 'HOURS_SINCE_SLA_BREACH', operator: 'greater_than', value: '1' },
                      ],
                      any: [],
                    },
                    actions: [
                      { field: 'priority', value: 'urgent' },
                      { field: 'group_id', value: 'escalation_team_id' },
                      { field: 'notification_user', value: ['manager@example.com', 'ESCALATION: Ticket {{ticket.id}} has breached SLA'] },
                    ],
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  },
                },
              },
            ],
          ])
        )

        const client = new Client({
          subdomain: 'mycompany',
          email: 'admin@example.com',
          token: 'api_token',
          fetch: mockFetch,
        })

        const automation = await client.automations.create({
          title: 'Escalate SLA Breached Tickets',
          conditions: {
            all: [
              { field: 'status', operator: 'is', value: 'open' },
              { field: 'sla_breach', operator: 'is', value: 'true' },
              { field: 'HOURS_SINCE_SLA_BREACH', operator: 'greater_than', value: '1' },
            ],
            any: [],
          },
          actions: [
            { field: 'priority', value: 'urgent' },
            { field: 'group_id', value: 'escalation_team_id' },
            { field: 'notification_user', value: ['manager@example.com', 'ESCALATION: Ticket {{ticket.id}} has breached SLA'] },
          ],
        })

        expect(automation.title).toBe('Escalate SLA Breached Tickets')
        expect(automation.conditions.all).toHaveLength(3)
      })
    })
  })

  // =============================================================================
  // Business Hours vs Calendar Hours Tests
  // =============================================================================

  describe('Business Hours Configuration', () => {
    it('should create SLA with business hours enabled', async () => {
      const policyMetrics: SLAPolicyMetric[] = [
        { priority: 'urgent', metric: 'first_reply_time', target: 30, business_hours: true },
        { priority: 'high', metric: 'first_reply_time', target: 60, business_hours: true },
      ]

      const createdPolicy = mockSLAPolicy({
        id: 400,
        title: 'Business Hours SLA',
        policy_metrics: policyMetrics,
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /api/v2/slas/policies',
            { status: 201, body: { sla_policy: createdPolicy } },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const policy = await client.slas.policies.create({
        title: 'Business Hours SLA',
        filter: { all: [], any: [] },
        policy_metrics: policyMetrics,
      })

      expect(policy.policy_metrics.every((m) => m.business_hours === true)).toBe(true)
    })

    it('should create SLA with calendar hours (24/7)', async () => {
      const policyMetrics: SLAPolicyMetric[] = [
        { priority: 'urgent', metric: 'first_reply_time', target: 30, business_hours: false },
        { priority: 'urgent', metric: 'requester_wait_time', target: 120, business_hours: false },
      ]

      const createdPolicy = mockSLAPolicy({
        id: 401,
        title: '24/7 SLA',
        policy_metrics: policyMetrics,
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /api/v2/slas/policies',
            { status: 201, body: { sla_policy: createdPolicy } },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const policy = await client.slas.policies.create({
        title: '24/7 SLA',
        filter: { all: [], any: [] },
        policy_metrics: policyMetrics,
      })

      expect(policy.policy_metrics.every((m) => m.business_hours === false)).toBe(true)
    })

    it('should create SLA with mixed business/calendar hours per metric', async () => {
      const policyMetrics: SLAPolicyMetric[] = [
        { priority: 'urgent', metric: 'first_reply_time', target: 30, business_hours: false }, // 24/7 for first response
        { priority: 'urgent', metric: 'requester_wait_time', target: 480, business_hours: true }, // business hours for resolution
      ]

      const createdPolicy = mockSLAPolicy({
        id: 402,
        title: 'Mixed Hours SLA',
        policy_metrics: policyMetrics,
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /api/v2/slas/policies',
            { status: 201, body: { sla_policy: createdPolicy } },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const policy = await client.slas.policies.create({
        title: 'Mixed Hours SLA',
        filter: { all: [], any: [] },
        policy_metrics: policyMetrics,
      })

      const firstReply = policy.policy_metrics.find((m) => m.metric === 'first_reply_time')
      const resolution = policy.policy_metrics.find((m) => m.metric === 'requester_wait_time')

      expect(firstReply?.business_hours).toBe(false)
      expect(resolution?.business_hours).toBe(true)
    })
  })

  // =============================================================================
  // SLA Policy Filter Conditions Tests
  // =============================================================================

  describe('SLA Policy Filter Conditions', () => {
    it('should filter by ticket type', async () => {
      const filter = {
        all: [{ field: 'type', operator: 'is', value: 'incident' }],
        any: [],
      }

      const createdPolicy = mockSLAPolicy({ id: 500, filter })

      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /api/v2/slas/policies',
            { status: 201, body: { sla_policy: createdPolicy } },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const policy = await client.slas.policies.create({
        title: 'Incident SLA',
        filter,
        policy_metrics: [
          { priority: 'urgent', metric: 'first_reply_time', target: 15, business_hours: true },
        ],
      })

      expect(policy.filter.all[0].field).toBe('type')
      expect(policy.filter.all[0].value).toBe('incident')
    })

    it('should filter by organization', async () => {
      const filter = {
        all: [{ field: 'organization_id', operator: 'is', value: '12345' }],
        any: [],
      }

      const createdPolicy = mockSLAPolicy({ id: 501, filter })

      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /api/v2/slas/policies',
            { status: 201, body: { sla_policy: createdPolicy } },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const policy = await client.slas.policies.create({
        title: 'Organization-Specific SLA',
        filter,
        policy_metrics: [
          { priority: 'urgent', metric: 'first_reply_time', target: 30, business_hours: true },
        ],
      })

      expect(policy.filter.all[0].field).toBe('organization_id')
    })

    it('should filter by tags', async () => {
      const filter = {
        all: [],
        any: [
          { field: 'tags', operator: 'includes', value: 'vip' },
          { field: 'tags', operator: 'includes', value: 'premium' },
        ],
      }

      const createdPolicy = mockSLAPolicy({ id: 502, filter })

      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /api/v2/slas/policies',
            { status: 201, body: { sla_policy: createdPolicy } },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const policy = await client.slas.policies.create({
        title: 'VIP/Premium SLA',
        filter,
        policy_metrics: [
          { priority: 'urgent', metric: 'first_reply_time', target: 10, business_hours: true },
        ],
      })

      expect(policy.filter.any).toHaveLength(2)
      expect(policy.filter.any[0].operator).toBe('includes')
    })

    it('should filter by custom field', async () => {
      const filter = {
        all: [{ field: 'custom_fields_12345', operator: 'is', value: 'enterprise' }],
        any: [],
      }

      const createdPolicy = mockSLAPolicy({ id: 503, filter })

      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /api/v2/slas/policies',
            { status: 201, body: { sla_policy: createdPolicy } },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const policy = await client.slas.policies.create({
        title: 'Enterprise Custom Field SLA',
        filter,
        policy_metrics: [
          { priority: 'urgent', metric: 'first_reply_time', target: 5, business_hours: true },
        ],
      })

      expect(policy.filter.all[0].field).toMatch(/^custom_fields_/)
    })

    it('should filter by brand', async () => {
      const filter = {
        all: [{ field: 'brand_id', operator: 'is', value: '999' }],
        any: [],
      }

      const createdPolicy = mockSLAPolicy({ id: 504, filter })

      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /api/v2/slas/policies',
            { status: 201, body: { sla_policy: createdPolicy } },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const policy = await client.slas.policies.create({
        title: 'Brand-Specific SLA',
        filter,
        policy_metrics: [
          { priority: 'urgent', metric: 'first_reply_time', target: 20, business_hours: true },
        ],
      })

      expect(policy.filter.all[0].field).toBe('brand_id')
    })

    it('should filter by group assignment', async () => {
      const filter = {
        all: [{ field: 'group_id', operator: 'is', value: '777' }],
        any: [],
      }

      const createdPolicy = mockSLAPolicy({ id: 505, filter })

      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /api/v2/slas/policies',
            { status: 201, body: { sla_policy: createdPolicy } },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const policy = await client.slas.policies.create({
        title: 'Support Team SLA',
        filter,
        policy_metrics: [
          { priority: 'urgent', metric: 'first_reply_time', target: 15, business_hours: true },
        ],
      })

      expect(policy.filter.all[0].field).toBe('group_id')
    })

    it('should combine multiple filter conditions', async () => {
      const filter = {
        all: [
          { field: 'type', operator: 'is', value: 'incident' },
          { field: 'priority', operator: 'is', value: 'urgent' },
          { field: 'organization_id', operator: 'is_not', value: 'null' },
        ],
        any: [
          { field: 'tags', operator: 'includes', value: 'production' },
          { field: 'tags', operator: 'includes', value: 'critical' },
        ],
      }

      const createdPolicy = mockSLAPolicy({ id: 506, filter })

      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /api/v2/slas/policies',
            { status: 201, body: { sla_policy: createdPolicy } },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const policy = await client.slas.policies.create({
        title: 'Critical Production Incidents SLA',
        filter,
        policy_metrics: [
          { priority: 'urgent', metric: 'first_reply_time', target: 5, business_hours: false },
        ],
      })

      expect(policy.filter.all).toHaveLength(3)
      expect(policy.filter.any).toHaveLength(2)
    })
  })
})
